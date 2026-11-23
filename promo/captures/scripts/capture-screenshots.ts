import fs from "node:fs";
import path from "node:path";
import { launchElectronCdp, waitForStageActors, type CdpClient } from "./cdp-client.ts";
import { setupDemoWorkspaces, USER_DATA_DIR } from "./setup-workspaces.ts";

const SHOTS_DIR = path.resolve("promo/captures/screenshots");

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

async function waitForAllImagesIn(cdp: CdpClient, containerSelector: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await cdp.evalJson<{ total: number; loaded: number }>(`(() => {
            const root = document.querySelector(${JSON.stringify(containerSelector)}) || document;
            const imgs = Array.from(root.querySelectorAll("img"));
            const loaded = imgs.filter(img => img.complete && img.naturalWidth > 0).length;
            return { total: imgs.length, loaded };
        })()`);
        if (status.total > 0 && status.loaded >= status.total) {
            await Bun.sleep(300);
            return;
        }
        await Bun.sleep(250);
    }
}

async function fitAndAutoLayoutCanvas(cdp: CdpClient): Promise<void> {
    await clickByAriaOrTitle(cdp, "自动排布");
    await Bun.sleep(350);
    await clickByAriaOrTitle(cdp, "适配画布");
    await Bun.sleep(450);
}

async function dismissToastsAndMenus(cdp: CdpClient): Promise<void> {
    await cdp.evalJson(`(() => {
        document.querySelectorAll('button').forEach(b => {
            const aria = b.getAttribute('aria-label') || '';
            const txt = (b.textContent || '').trim();
            if ((b.closest('[role="status"]') || b.closest('[role="alert"]')) && (aria.includes('关闭') || txt === '×')) b.click();
        });
    })()`);
}

async function openRecentProject(cdp: CdpClient, titleSubstring: string): Promise<void> {
    const onWelcome = await cdp.evalJson<boolean>(`Boolean(document.querySelector('[data-desktop-view="welcome"]'))`);
    if (!onWelcome) {
        await clickByAriaOrTitle(cdp, "返回欢迎页");
        await waitForSelector(cdp, '[data-desktop-view="welcome"]', 10_000);
        await Bun.sleep(500);
    }
    const clicked = await cdp.evalJson<boolean>(`(() => {
        const row = Array.from(document.querySelectorAll("li, div")).find(el => {
            const txt = el.textContent || "";
            return txt.includes(${JSON.stringify(titleSubstring)}) && el.querySelector("button");
        });
        if (row) {
            const openBtn = Array.from(row.querySelectorAll("button")).find(b =>
                (b.textContent || "").includes(${JSON.stringify(titleSubstring)}) || (b.textContent || "").trim() === "打开"
            ) || row.querySelector("button");
            if (openBtn) {
                openBtn.click();
                return true;
            }
        }
        return false;
    })()`);
    if (!clicked) throw new Error(`Could not find recent project matching: ${titleSubstring}`);
    await waitForSelector(cdp, '[data-desktop-view="editor"]', 15_000);
    await Bun.sleep(800);
}

async function setUiLocaleViaSettings(cdp: CdpClient, localeCode: "zh-CN" | "ja-JP"): Promise<void> {
    await cdp.evalJson(`window.__moesekaiCaptureHook?.openSettingsDialog("general")`);
    await waitForSelector(cdp, `[data-testid="settings-locale-${localeCode}"]`, 5000);
    await Bun.sleep(200);
    await cdp.evalJson(`document.querySelector('[data-testid="settings-locale-${localeCode}"]')?.click()`);
    await Bun.sleep(300);
    await cdp.evalJson(`window.__moesekaiCaptureHook?.closeAllDialogs()`);
    await Bun.sleep(450);
}

async function snapShot(cdp: CdpClient, filename: string, label: string): Promise<void> {
    await dismissToastsAndMenus(cdp);
    await Bun.sleep(350);
    const outPath = path.join(SHOTS_DIR, filename);
    const info = await cdp.capturePng(outPath);
    const actors = await cdp.evalJson<string[]>(`(window.__stageProbe?.actors ?? []).slice()`);
    console.log(`[shot] ${filename} (${info.width}x${info.height}, ${(info.bytes / 1024).toFixed(0)} KiB, actors=${actors.length}: [${actors.join(",")}]) — ${label}`);
}

async function main(): Promise<void> {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    setupDemoWorkspaces();

    const session = await launchElectronCdp({
        userDataDir: USER_DATA_DIR,
        port: 9244,
        width: 1920,
        height: 1080,
    });
    const { cdp } = session;

    try {
        // Ensure clean Light theme + Miku seed (21) + zh-CN + no auto-preload toast in screenshots
        await cdp.evalJson(`(() => {
            window.localStorage.setItem("moesekai.storyMaker.autoPreload", "0");
            window.__moesekaiCaptureHook?.setTheme("light");
        })()`);
        await Bun.sleep(400);

        // ============================================================
        // PROJECT 1: MORE MORE JUMP! (Minori Hanasato Showcase!)
        // ============================================================
        console.log("\n=== Opening MMJ Showcase Project ===");
        await openRecentProject(cdp, "闪耀吧！屋顶与舞台的安可曲");

        // Ensure Agent panel is collapsed for grand 3-pane Hero overview
        await cdp.evalJson(`(() => {
            if (document.querySelector('[data-testid="agent-panel-container"]')) {
                document.querySelector('[data-testid="agent-toggle-btn"] button')?.click();
            }
        })()`);
        await Bun.sleep(400);

        // Focus climax encore scene (5 actors on dazzling Stage SEKAI bg_b001001, Minori at center!)
        const focused = await cdp.evalJson(`window.__moesekaiCaptureHook?.focusClimaxTalkBeat()`);
        console.log("[mmj] focused climax beat:", focused);
        await fitAndAutoLayoutCanvas(cdp);
        await waitForStageActors(cdp, 5, { timeoutMs: 60_000, settleMs: 2200 });

        // SHOT 01: Hero Full Studio Overview (MMJ 5-actor Stage SEKAI + Branching Flow Graph + Light Theme)
        await snapShot(cdp, "01-hero-studio-mmj-light.png", "Hero full studio overview (MMJ 5-actor Stage SEKAI)");

        // SHOT 08: Character Cast, Expression, Motion & Costume Inspector
        await clickByText(cdp, '[role="tab"], button', "演员", true);
        await Bun.sleep(500);
        await cdp.evalJson(`(() => {
            const firstBrowse = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("浏览"));
            if (firstBrowse) firstBrowse.scrollIntoView({ block: "center", behavior: "instant" });
        })()`);
        await Bun.sleep(500);
        await snapShot(cdp, "08-cast-and-live2d-inspector.png", "Cast panel + Live2D expression/motion inspector");

        // SHOT 09: Live2D Model & Costume Picker Dialog (Minori Hanasato costumes — ALL 26 avatars loaded!)
        await cdp.evalJson(`(() => {
            const li = Array.from(document.querySelectorAll("li")).find(el => (el.textContent || "").includes("v2_05minori_unit"));
            if (!li) return false;
            const btns = Array.from(li.querySelectorAll("button"));
            const editBtn = btns.find(b => {
                const l = (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase();
                return l.includes("模型") || l.includes("更换") || l.includes("model");
            }) || btns[btns.length - 2];
            editBtn?.click();
            return true;
        })()`);
        await waitForSelector(cdp, '[role="dialog"]', 8000);
        await waitForAllImagesIn(cdp, '[role="dialog"]', 15_000);
        await snapShot(cdp, "09-asset-picker-costume-bg.png", "Live2D Model & Costume Picker for Minori Hanasato (all 26 icons loaded)");
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await Bun.sleep(400);
        await clickByText(cdp, '[role="tab"], button', "组件库", false);
        await Bun.sleep(300);

        // SHOT 04: Visual Node Flow Graph Focus!
        // 1) Move horizontal split handle UP smoothly with real buttons:1 drag so Flow Canvas gets ~64% height!
        // 2) Click choice_01_encore node card via real mouse press/release so Node Inspector shows Branching Choice Editor!
        // 3) Fit view + zoom in slightly so node cards & connections look ultra-crisp and prominent!
        const splitPos = await cdp.evalJson<{ x: number; y: number } | null>(`(() => {
            const horiz = Array.from(document.querySelectorAll('[role="separator"]')).find(s => s.getAttribute("aria-orientation") === "horizontal");
            if (!horiz) return null;
            const r = horiz.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (splitPos) {
            const targetY = Math.max(250, splitPos.y - 230);
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: splitPos.x, y: splitPos.y, button: "left", buttons: 1, clickCount: 1 });
            for (let step = 1; step <= 10; step++) {
                const y = Math.round(splitPos.y + ((targetY - splitPos.y) * step) / 10);
                await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: splitPos.x, y, button: "left", buttons: 1 });
                await Bun.sleep(25);
            }
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: splitPos.x, y: targetY, button: "left", buttons: 0, clickCount: 1 });
            await Bun.sleep(500);
        }
        await clickByAriaOrTitle(cdp, "适配画布");
        await Bun.sleep(500);
        // Click the Choice node card using mouse coordinates so React Flow/custom pointer handler selects it!
        const choicePos = await cdp.evalJson<{ x: number; y: number } | null>(`(() => {
            const el = Array.from(document.querySelectorAll("div, span, p, h3")).find(n =>
                (n.textContent || "").trim() === "决定安可曲的舞台演出方案！"
            );
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (choicePos) {
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: choicePos.x, y: choicePos.y, button: "left", buttons: 1, clickCount: 1 });
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: choicePos.x, y: choicePos.y, button: "left", buttons: 0, clickCount: 1 });
            await Bun.sleep(500);
        }
        await snapShot(cdp, "04-flow-graph-branching.png", "Expanded Visual Node Flow Graph with Choice node inspector");

        // Restore horizontal split back to original balanced height
        if (splitPos) {
            const curSplit = await cdp.evalJson<{ x: number; y: number } | null>(`(() => {
                const horiz = Array.from(document.querySelectorAll('[role="separator"]')).find(s => s.getAttribute("aria-orientation") === "horizontal");
                if (!horiz) return null;
                const r = horiz.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`);
            if (curSplit) {
                await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: curSplit.x, y: curSplit.y, button: "left", buttons: 1, clickCount: 1 });
                for (let step = 1; step <= 8; step++) {
                    const y = Math.round(curSplit.y + ((splitPos.y - curSplit.y) * step) / 8);
                    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: curSplit.x, y, button: "left", buttons: 1 });
                    await Bun.sleep(20);
                }
                await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: curSplit.x, y: splitPos.y, button: "left", buttons: 0, clickCount: 1 });
                await Bun.sleep(400);
            }
        }

        // Re-focus climax beat before Code mode so Stage stays on 5-actor Stage SEKAI
        await cdp.evalJson(`window.__moesekaiCaptureHook?.focusClimaxTalkBeat()`);
        await waitForStageActors(cdp, 5, { timeoutMs: 25_000, settleMs: 1000 });

        // SHOT 05: Bidirectional .msk Code Mode side-by-side with Live2D Stage
        const okCode = await switchEditorMode(cdp, "代码");
        console.log("[mmj] switched to Code mode:", okCode);
        await Bun.sleep(1000);
        await waitForStageActors(cdp, 5, { timeoutMs: 25_000, settleMs: 900 });
        await snapShot(cdp, "05-code-mode-msk-bidirectional.png", "Bidirectional .msk code workbench + Live2D stage split");

        // Return cleanly to Edit mode (NOT the top-left menu!)
        const okEdit = await switchEditorMode(cdp, "编辑");
        console.log("[mmj] returned to Edit mode:", okEdit);
        await Bun.sleep(700);
        await fitAndAutoLayoutCanvas(cdp);

        // SHOT 10: Multi-language i18n Localization Pack Proofreader (clean backdrop, ZERO stray dropdown!)
        await clickByAriaOrTitle(cdp, "多语言字幕");
        await waitForSelector(cdp, '[role="dialog"]', 6000);
        await Bun.sleep(400);
        await clickByText(cdp, '[role="dialog"] button', "日本語", false);
        await Bun.sleep(300);
        await clickByText(cdp, '[role="dialog"] [role="tab"], [role="dialog"] button', "双栏校对", false);
        await Bun.sleep(500);
        await waitForAllImagesIn(cdp, '[role="dialog"]', 8000);
        await snapShot(cdp, "10-i18n-multilang-proofread.png", "Multi-language i18n side-by-side proofreader (zh-CN <-> ja-JP)");
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await Bun.sleep(450);

        // SHOT 12: Custom Voice Manifest & Audio Bundler UI (20/20 matched, clean Edit backdrop!)
        await clickByAriaOrTitle(cdp, "自定义配音");
        await waitForSelector(cdp, '[role="dialog"]', 6000);
        await Bun.sleep(550);
        await snapShot(cdp, "12-voice-manifest-bundler.png", "Custom Voice Manifest & Audio Bundler dialog (20/20 matched)");
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await Bun.sleep(450);

        // SHOT 13: Preflight-checked .msk & Bundle Export Dialog (0 errors, 0 warnings, clean Edit backdrop!)
        await cdp.evalJson(`window.__moesekaiCaptureHook?.openExportDialog()`);
        await Bun.sleep(900);
        await clickByText(cdp, '[role="dialog"] button', "完整剧情包", false);
        await Bun.sleep(500);
        await snapShot(cdp, "13-export-preflight-dialog.png", "Preflight-checked .msk & .zip Bundle Export dialog");
        await cdp.evalJson(`window.__moesekaiCaptureHook?.closeAllDialogs()`);
        await Bun.sleep(400);

        // SHOT 14: Desktop Settings — 26 Character Dynamic Color Seeds & 5 UI Locales
        await cdp.evalJson(`window.__moesekaiCaptureHook?.openSettingsDialog("general")`);
        await Bun.sleep(600);
        await snapShot(cdp, "14-settings-themes-and-updater.png", "Desktop Preferences: 5 vector-flag locales + 26 character theme seeds");

        // SHOT 15: Dedicated Software Update Dialog (CNB domestic fast mirror + GitHub fallback)
        await cdp.evalJson(`window.__moesekaiCaptureHook?.openUpdateDialogPreview()`);
        await Bun.sleep(600);
        await snapShot(cdp, "15-update-dialog-cnb-github.png", "CNB domestic mirror + GitHub fallback auto-updater dialog");
        await cdp.evalJson(`window.__moesekaiCaptureHook?.closeAllDialogs()`);
        await Bun.sleep(400);

        // ============================================================
        // THEATER PLAYER SHOTS (MMJ Minori Hanasato!)
        // ============================================================
        console.log("\n=== Capturing Theater Player Shots (MMJ) ===");
        await cdp.evalJson(`window.__moesekaiCaptureHook?.switchToTheaterPlayer()`);
        await waitForSelector(cdp, '[data-desktop-view="player"]', 10_000);
        await Bun.sleep(800);

        await cdp.evalJson(`(() => {
            const btns = Array.from(document.querySelectorAll('[data-desktop-topbar="player"] button'));
            const tBtn = btns.find(b => (b.textContent || "").includes("影院") || (b.textContent || "").includes("剧场"));
            tBtn?.click();
        })()`);
        await Bun.sleep(1000);
        await waitForStageActors(cdp, 4, { timeoutMs: 45_000, settleMs: 1500 });

        // Advance through Rooftop dialogue to reach interactive 3-option Choice screen!
        await cdp.evalAsync(`
            const clickNext = () => {
                const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "下一句");
                if (btn && !btn.disabled) btn.click();
            };
            for (let i = 0; i < 40; i++) {
                const body = document.body.innerText || "";
                if (body.includes("前往「舞台的世界」") && body.includes("留在屋顶加练")) break;
                clickNext();
                await new Promise(r => setTimeout(r, 150));
            }
            await new Promise(r => setTimeout(r, 1200));
        `);

        // SHOT 03: Interactive Branching Choices in Theater Player (zero ellipsis, zero toast!)
        await snapShot(cdp, "03-player-branching-choices-minori.png", "Theater Player interactive 3-way branching choice on Miyamasuzaka Rooftop");

        // Click Option 1 -> enters dazzling 5-actor Stage SEKAI!
        await cdp.evalAsync(`
            const optBtn = Array.from(document.querySelectorAll('[data-desktop-view="player"] main button')).find(b =>
                (b.textContent || "").includes("前往「舞台的世界」")
            );
            optBtn?.click();
            await new Promise(r => setTimeout(r, 1000));
        `);
        await waitForStageActors(cdp, 5, { timeoutMs: 45_000, settleMs: 1500 });

        // Advance to Minori's enthusiastic line on Stage SEKAI
        await cdp.evalAsync(`
            const clickNext = () => {
                const btn = Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "下一句");
                if (btn && !btn.disabled) btn.click();
            };
            for (let i = 0; i < 20; i++) {
                const body = document.body.innerText || "";
                if (body.includes("有未来酱和大家并肩站在舞台上")) break;
                clickNext();
                await new Promise(r => setTimeout(r, 180));
            }
            await new Promise(r => setTimeout(r, 2400));
        `);

        // SHOT 02: Full-Screen Theater Player — 5-Actor Stage SEKAI Live2D Showcase (Minori Center!)
        await snapShot(cdp, "02-player-theater-minori-stage.png", "Theater Player 5-actor Stage SEKAI with Minori center & Miku");

        // SHOT 11: Multilingual Live Playback (TRUE Japanese ja-JP UI + Japanese story subtitles!)
        await setUiLocaleViaSettings(cdp, "ja-JP");
        const switchedSubtitleJa = await cdp.evalAsync<boolean>(`
            const sel = Array.from(document.querySelectorAll("select")).find(s =>
                Array.from(s.options).some(o => o.value === "ja-JP" || o.text.includes("日本語"))
            );
            if (!sel) return false;
            const opt = Array.from(sel.options).find(o => o.value === "ja-JP" || o.text.includes("日本語"));
            if (!opt) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
            setter?.call(sel, opt.value);
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise(r => setTimeout(r, 900));
            return (document.body.innerText || "").includes("花里みのり") || (document.body.innerText || "").includes("ミクちゃん");
        `);
        console.log("[player] switchedSubtitleJa:", switchedSubtitleJa);
        await Bun.sleep(600);
        await snapShot(cdp, "11-player-ja-locale-playback.png", "Multilingual Theater Player in Japanese (ja-JP UI + subtitles)");

        // Restore zh-CN locale and exit player back to Editor
        await setUiLocaleViaSettings(cdp, "zh-CN");
        await clickByText(cdp, '[data-desktop-topbar="player"] button', "返回编辑", false);
        await waitForSelector(cdp, '[data-desktop-view="editor"]', 10_000);
        await Bun.sleep(600);

        // ============================================================
        // PROJECT 2: 25-ji, Nightcord de. (AI Story Agent + Dark Theme!)
        // ============================================================
        console.log("\n=== Switching to Nightcord Project for AI Agent & Dark Mode Shots ===");
        await openRecentProject(cdp, "25时的未名余音");

        await cdp.evalJson(`window.__moesekaiCaptureHook?.focusClimaxTalkBeat()`);
        await fitAndAutoLayoutCanvas(cdp);
        await waitForStageActors(cdp, 4, { timeoutMs: 45_000, settleMs: 1800 });

        // SHOT 06: MoeSekai AI Story Agent Authoring Panel (mount panel FIRST, wait 600ms, THEN inject fixture!)
        await cdp.evalJson(`window.__moesekaiCaptureHook?.setAgentPanelWidth(420)`);
        await waitForSelector(cdp, '[data-testid="agent-panel-container"]', 5000);
        await Bun.sleep(600);
        const injected = await cdp.evalJson<boolean>(`Boolean(window.__moesekaiCaptureHook?.injectAgentPreviewFixture())`);
        console.log("[agent] injected preview fixture:", injected);
        await Bun.sleep(900);
        await snapShot(cdp, "06-ai-agent-authoring.png", "MoeSekai AI Story Agent panel with official mining, patch & table");

        // SHOT 07: AI Agent Snapshot Rollback Drawer (with active Agent thread behind it!)
        await cdp.evalJson(`window.__moesekaiCaptureHook?.setAgentHistoryDrawerOpen(true, "snapshots")`);
        await Bun.sleep(700);
        await snapShot(cdp, "07-ai-agent-snapshots-rollback.png", "AI Agent Snapshot History & one-click Rollback drawer");

        // Close history drawer & collapse Agent panel, switch to Dark Theme + Kanade Seed (17) via real UI!
        await cdp.evalJson(`window.__moesekaiCaptureHook?.setAgentHistoryDrawerOpen(false)`);
        await Bun.sleep(250);
        await cdp.evalJson(`document.querySelector('[data-testid="agent-toggle-btn"] button')?.click()`);
        await Bun.sleep(350);
        // Open Settings -> click Kanade seed (#bb6688) & Dark Mode ("深色") -> close Settings!
        await cdp.evalJson(`window.__moesekaiCaptureHook?.openSettingsDialog("general")`);
        await waitForSelector(cdp, '[data-testid="settings-dialog"]', 5000);
        await Bun.sleep(300);
        await cdp.evalJson(`(() => {
            const dlg = document.querySelector('[data-testid="settings-dialog"]');
            if (!dlg) return;
            const darkBtn = Array.from(dlg.querySelectorAll('button')).find(b => (b.textContent || '').trim() === '深色');
            darkBtn?.click();
            const kanadeSwatch = Array.from(dlg.querySelectorAll('button')).find(b => {
                const title = (b.getAttribute('title') || b.getAttribute('aria-label') || '');
                return title.includes('Kanade') || title.includes('宵崎奏');
            });
            kanadeSwatch?.click();
        })()`);
        await Bun.sleep(450);
        await cdp.evalJson(`window.__moesekaiCaptureHook?.closeAllDialogs()`);
        await Bun.sleep(900);
        await fitAndAutoLayoutCanvas(cdp);
        await waitForStageActors(cdp, 4, { timeoutMs: 25_000, settleMs: 1200 });

        // SHOT 16: Dark Theme Studio Comparison (Nightcord 4-actor stage + Kanade rose-mauve seed!)
        await snapShot(cdp, "16-studio-dark-theme-nightcord.png", "Dark Theme Studio with 25-ji Nightcord de. & Kanade seed");

        console.log("\n=== ALL 16 POLISHED SCREENSHOTS CAPTURED SUCCESSFULLY ===");
    } finally {
        await session.dispose();
    }
}

await main();
