import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchElectronCdp, waitForStageActors, type CdpClient } from "./cdp-client.ts";
import { setupDemoWorkspaces, USER_DATA_DIR } from "./setup-workspaces.ts";

const CLIPS_DIR = path.resolve("promo/captures/clips");

interface ScreencastRecorder {
    stopAndEncode: (outMp4Path: string) => Promise<{ frames: number; durationSec: number; bytes: number }>;
}

async function startScreencast(cdp: CdpClient, clipName: string): Promise<ScreencastRecorder> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `moesekai-clip-${clipName}-`));
    const frames: Array<{ file: string; ts: number }> = [];
    let frameIndex = 0;
    let active = true;
    const startWall = performance.now() / 1000;

    const unsub = cdp.on("Page.screencastFrame", (params: { data: string; metadata?: { timestamp?: number }; sessionId: number }) => {
        if (!active) return;
        // Ack immediately so Chromium keeps streaming at full cadence
        void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
        const idx = ++frameIndex;
        const file = path.join(tmpDir, `f_${String(idx).padStart(5, "0")}.jpg`);
        fs.writeFileSync(file, Buffer.from(params.data, "base64"));
        const ts = typeof params.metadata?.timestamp === "number" && params.metadata.timestamp > 0
            ? params.metadata.timestamp
            : performance.now() / 1000;
        frames.push({ file, ts });
    });

    await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 94,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
    });

    // Capture an initial anchor PNG->JPG via captureScreenshot if screencast takes a beat to emit frame 1
    return {
        stopAndEncode: async (outMp4Path: string) => {
            active = false;
            const endWall = performance.now() / 1000;
            try {
                await cdp.send("Page.stopScreencast");
            } catch {}
            unsub();
            await Bun.sleep(150);

            if (frames.length < 2) {
                throw new Error(`Screencast ${clipName} captured only ${frames.length} frames!`);
            }

            // Normalize timestamps and build ffmpeg concat list matching real wall-clock pacing
            const concatLines: string[] = [];
            let totalDur = 0;
            for (let i = 0; i < frames.length; i++) {
                const cur = frames[i];
                const next = frames[i + 1];
                let dur = next ? next.ts - cur.ts : Math.max(0.05, Math.min(0.4, endWall - startWall - totalDur));
                if (!Number.isFinite(dur) || dur <= 0.004) dur = 1 / 60;
                if (dur > 1.5) dur = 0.5;
                totalDur += dur;
                const safePath = cur.file.replace(/\\/g, "/").replace(/'/g, "'\\''");
                concatLines.push(`file '${safePath}'`);
                concatLines.push(`duration ${dur.toFixed(6)}`);
            }
            // Repeat last frame per ffmpeg concat demuxer spec
            const lastSafe = frames[frames.length - 1].file.replace(/\\/g, "/").replace(/'/g, "'\\''");
            concatLines.push(`file '${lastSafe}'`);

            const listFile = path.join(tmpDir, "frames.txt");
            fs.writeFileSync(listFile, concatLines.join("\n") + "\n", "utf8");
            fs.mkdirSync(path.dirname(outMp4Path), { recursive: true });

            const enc = Bun.spawnSync(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    listFile,
                    "-vf",
                    "scale=1920:1080:force_original_aspect_ratio=decrease:in_range=pc:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=60,format=yuv420p",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "16",
                    "-pix_fmt",
                    "yuv420p",
                    "-color_range",
                    "tv",
                    "-movflags",
                    "+faststart",
                    outMp4Path,
                ],
                { stdout: "pipe", stderr: "pipe" },
            );
            if (enc.exitCode !== 0) {
                console.error(enc.stderr.toString());
                throw new Error(`ffmpeg failed encoding ${outMp4Path}`);
            }

            const bytes = fs.statSync(outMp4Path).size;
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {}

            console.log(`[clip] ${path.basename(outMp4Path)}: ${frames.length} raw frames -> ${totalDur.toFixed(2)}s @ 60fps (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
            return { frames: frames.length, durationSec: totalDur, bytes };
        },
    };
}

async function switchEditorMode(cdp: CdpClient, modeLabel: "编辑" | "试播" | "代码"): Promise<boolean> {
    return cdp.evalJson<boolean>(`(() => {
        const header = document.querySelector('[data-desktop-topbar="editor"]');
        if (!header) return false;
        const btns = Array.from(header.querySelectorAll('button')).filter(b => !b.closest('nav'));
        const target = btns.find(b => (b.textContent || "").trim() === ${JSON.stringify(modeLabel)});
        if (!target) return false;
        target.click();
        return true;
    })()`);
}

async function clickNodeByTitle(cdp: CdpClient, title: string): Promise<boolean> {
    const pos = await cdp.evalJson<{ x: number; y: number } | null>(`(() => {
        const el = Array.from(document.querySelectorAll("div, span, p, h3")).find(n =>
            (n.textContent || "").trim() === ${JSON.stringify(title)}
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!pos) return false;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", buttons: 0, clickCount: 1 });
    return true;
}

async function clickByText(cdp: CdpClient, selector: string, textMatch: string, exact = false): Promise<boolean> {
    return cdp.evalJson<boolean>(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const target = els.find(el => {
            const t = (el.textContent || "").trim();
            return ${exact} ? t === ${JSON.stringify(textMatch)} : t.includes(${JSON.stringify(textMatch)});
        });
        if (!target) return false;
        target.click();
        return true;
    })()`);
}

async function clickByAriaOrTitle(cdp: CdpClient, needle: string): Promise<boolean> {
    return cdp.evalJson<boolean>(`(() => {
        const els = Array.from(document.querySelectorAll("button, [role='button'], [role='tab']"));
        const target = els.find(el => {
            const a = el.getAttribute("aria-label") || "";
            const ti = el.getAttribute("title") || "";
            const txt = (el.textContent || "").trim();
            return a.includes(${JSON.stringify(needle)}) || ti.includes(${JSON.stringify(needle)}) || txt.includes(${JSON.stringify(needle)});
        });
        if (!target) return false;
        target.click();
        return true;
    })()`);
}

async function waitForSelector(cdp: CdpClient, selector: string, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await cdp.evalJson<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
        await Bun.sleep(150);
    }
    return false;
}

async function openMmjProject(cdp: CdpClient): Promise<void> {
    const onWelcome = await cdp.evalJson<boolean>(`Boolean(document.querySelector('[data-desktop-view="welcome"]'))`);
    if (onWelcome) {
        await cdp.evalJson(`(() => {
            const row = Array.from(document.querySelectorAll("li, div")).find(el =>
                (el.textContent || "").includes("闪耀吧！屋顶与舞台的安可曲") && el.querySelector("button")
            );
            const btn = row && (Array.from(row.querySelectorAll("button")).find(b =>
                (b.textContent || "").includes("闪耀吧") || (b.textContent || "").trim() === "打开"
            ) || row.querySelector("button"));
            btn?.click();
        })()`);
        await waitForSelector(cdp, '[data-desktop-view="editor"]', 15_000);
        await Bun.sleep(800);
    }
}

async function main(): Promise<void> {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
    setupDemoWorkspaces();

    const session = await launchElectronCdp({
        userDataDir: USER_DATA_DIR,
        port: 9242,
        width: 1920,
        height: 1080,
    });
    const { cdp } = session;

    try {
        await cdp.evalAsync(`
            window.__moesekaiCaptureHook?.setTheme("light");
            await window.moesekaiDesktop.app.updateSettings({
                themeSeed: "21",
                themeMode: "light",
                locale: "zh-CN",
                agentPanelOpen: false,
                stageRenderQuality: "high",
            });
        `);
        await Bun.sleep(500);
        await openMmjProject(cdp);

        // Collapse agent panel if open
        await cdp.evalJson(`(() => {
            if (document.querySelector('[data-testid="agent-panel-container"]')) {
                document.querySelector('[data-testid="agent-toggle-btn"] button')?.click();
            }
        })()`);
        await Bun.sleep(400);

        // Pre-warm MMJ 5 actors on climax scene so Live2D models are hot in memory & cache!
        await cdp.evalJson(`window.__moesekaiCaptureHook?.focusClimaxTalkBeat()`);
        await clickByAriaOrTitle(cdp, "自动排布");
        await Bun.sleep(300);
        await clickByAriaOrTitle(cdp, "适配画布");
        await waitForStageActors(cdp, 5, { timeoutMs: 60_000, settleMs: 1800 });

        // ============================================================
        // CLIP 03: Visual Node Flow Pan/Zoom + Live Stage/Inspector Sync (~8s)
        // ============================================================
        console.log("\n=== Recording Clip 03: Node Flow Pan & Live Stage Sync ===");
        const rec3 = await startScreencast(cdp, "flow");
        await Bun.sleep(900);

        // Smooth mouse pan across the flow canvas
        const canvasRect = await cdp.evalJson<{ x: number; y: number; w: number; h: number } | null>(`(() => {
            // Find the bottom flow canvas surface
            const el = Array.from(document.querySelectorAll("div")).find(d => {
                const r = d.getBoundingClientRect();
                return r.top > 380 && r.width > 900 && r.height > 260 && (d.textContent || "").includes("宫益坂屋顶的安可企划");
            });
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), w: r.width, h: r.height };
        })()`);

        if (canvasRect) {
            // Smooth gentle pan right then left using drag on empty canvas area near bottom
            const panY = Math.round(canvasRect.y + canvasRect.h * 0.38);
            const panX = Math.round(canvasRect.x);
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: panX, y: panY, button: "left", buttons: 1, clickCount: 1 });
            for (let step = 1; step <= 18; step++) {
                await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: panX - step * 10, y: panY, button: "left", buttons: 1 });
                await Bun.sleep(28);
            }
            for (let step = 1; step <= 18; step++) {
                await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: panX - 180 + step * 10, y: panY, button: "left", buttons: 1 });
                await Bun.sleep(28);
            }
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: panX, y: panY, button: "left", buttons: 0, clickCount: 1 });
        }
        await Bun.sleep(500);

        // Click Scene 1 (Rooftop) -> Live2D stage switches smoothly to sunny rooftop!
        await clickNodeByTitle(cdp, "宫益坂屋顶的安可企划");
        await Bun.sleep(2100);

        // Click Choice node -> Node Inspector updates to 3-option branching choice!
        await clickNodeByTitle(cdp, "决定安可曲的舞台演出方案！");
        await Bun.sleep(1600);

        // Click Climax Encore -> Stage switches back to dazzling 5-actor Stage SEKAI!
        await cdp.evalJson(`window.__moesekaiCaptureHook?.focusClimaxTalkBeat()`);
        await Bun.sleep(2200);

        await rec3.stopAndEncode(path.join(CLIPS_DIR, "clip-03-node-flow-and-inspector.mp4"));

        // ============================================================
        // CLIP 04: Bidirectional .msk Code Mode + Live Stage Sync (~7s)
        // ============================================================
        console.log("\n=== Recording Clip 04: Bidirectional .msk Code Live Sync ===");
        await waitForStageActors(cdp, 5, { timeoutMs: 20_000, settleMs: 800 });
        const rec4 = await startScreencast(cdp, "code");
        await Bun.sleep(700);

        // Switch to Code mode
        await switchEditorMode(cdp, "代码");
        await Bun.sleep(1400);

        // Smooth scroll down through the .msk script to show @cast, scene, talk, choice, condition
        await cdp.evalAsync(`
            const ta = document.querySelector("textarea");
            if (ta) {
                const maxScroll = Math.min(480, ta.scrollHeight - ta.clientHeight);
                for (let i = 0; i <= 30; i++) {
                    ta.scrollTop = Math.round((maxScroll * i) / 30);
                    ta.dispatchEvent(new Event("scroll"));
                    await new Promise(r => setTimeout(r, 45));
                }
                await new Promise(r => setTimeout(r, 700));
                for (let i = 30; i >= 0; i--) {
                    ta.scrollTop = Math.round((maxScroll * i) / 30);
                    ta.dispatchEvent(new Event("scroll"));
                    await new Promise(r => setTimeout(r, 35));
                }
            }
        `);
        await Bun.sleep(1600);
        await rec4.stopAndEncode(path.join(CLIPS_DIR, "clip-04-msk-code-live-sync.mp4"));

        // Back to Edit mode before Theater Player
        await switchEditorMode(cdp, "编辑");
        await Bun.sleep(500);

        // ============================================================
        // CLIP 02: Theater Player Interactive Branching Choice -> Stage SEKAI (~8s)
        // ============================================================
        console.log("\n=== Recording Clip 02: Branching Choice -> Stage SEKAI ===");
        await cdp.evalJson(`window.__moesekaiCaptureHook?.switchToTheaterPlayer()`);
        await waitForSelector(cdp, '[data-desktop-view="player"]', 10_000);
        await Bun.sleep(800);
        await cdp.evalJson(`(() => {
            const btns = Array.from(document.querySelectorAll('[data-desktop-topbar="player"] button'));
            const tBtn = btns.find(b => (b.textContent || "").includes("影院") || (b.textContent || "").includes("剧场"));
            tBtn?.click();
        })()`);
        await waitForStageActors(cdp, 4, { timeoutMs: 40_000, settleMs: 1200 });

        // Advance to Minori's final beat right BEFORE the choice
        await cdp.evalAsync(`
            const clickNext = () => {
                const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "下一句");
                if (btn && !btn.disabled) btn.click();
            };
            for (let i = 0; i < 30; i++) {
                const body = document.body.innerText || "";
                if (body.includes("其实我想到了三个超棒的点子")) break;
                clickNext();
                await new Promise(r => setTimeout(r, 140));
            }
            await new Promise(r => setTimeout(r, 1500));
        `);

        const rec2 = await startScreencast(cdp, "choice");
        await Bun.sleep(1100);
        // Click Next to pop open the 3-way interactive choice buttons!
        await clickByText(cdp, "button", "下一句", true);
        await Bun.sleep(1800);

        // Hover over Choice 1 and click it!
        const optPos = await cdp.evalJson<{ x: number; y: number } | null>(`(() => {
            const btn = Array.from(document.querySelectorAll('[data-desktop-view="player"] main button')).find(b =>
                (b.textContent || "").includes("前往「舞台的世界」")
            );
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (optPos) {
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: optPos.x, y: optPos.y });
            await Bun.sleep(600);
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: optPos.x, y: optPos.y, button: "left", clickCount: 1 });
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: optPos.x, y: optPos.y, button: "left", clickCount: 1 });
        }
        // Let transition & 5-actor Stage SEKAI entry play out cleanly!
        await waitForStageActors(cdp, 5, { timeoutMs: 25_000, settleMs: 2200 });
        await rec2.stopAndEncode(path.join(CLIPS_DIR, "clip-02-branching-choice-transition.mp4"));

        // ============================================================
        // CLIP 01: Theater Player Live2D Multi-Actor Stage Playback (~8s)
        // ============================================================
        console.log("\n=== Recording Clip 01: Live2D Multi-Actor Stage Playback (Minori + MMJ + Miku) ===");
        // Ensure we are at the start of Stage SEKAI talks (Miku -> Minori -> Haruka -> Airi)
        await waitForStageActors(cdp, 5, { timeoutMs: 20_000, settleMs: 600 });
        const rec1 = await startScreencast(cdp, "stage");
        await Bun.sleep(900);
        // Step through 4 beats smoothly so viewer sees typewriter dialogue + Live2D motion/facial changes!
        for (let step = 0; step < 4; step++) {
            await clickByText(cdp, "button", "下一句", true);
            await Bun.sleep(1900);
        }
        await Bun.sleep(900);
        await rec1.stopAndEncode(path.join(CLIPS_DIR, "clip-01-live2d-stage-playback.mp4"));

        console.log("\n=== ALL 4 LIVE MOTION CLIPS RECORDED SUCCESSFULLY ===");
    } finally {
        await session.dispose();
    }
}

await main();
