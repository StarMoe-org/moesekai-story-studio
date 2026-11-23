import fs from "node:fs";
import path from "node:path";

export interface CdpClient {
    send: (method: string, params?: Record<string, unknown>) => Promise<any>;
    on: (event: string, listener: (params: any) => void) => () => void;
    evalJson: <T = any>(expression: string) => Promise<T>;
    evalAsync: <T = any>(asyncBody: string) => Promise<T>;
    capturePng: (outPath: string) => Promise<{ width: number; height: number; bytes: number }>;
    close: () => void;
}

export interface ElectronSession {
    cdp: CdpClient;
    dispose: () => Promise<void>;
}

export async function launchElectronCdp(options: {
    userDataDir: string;
    port?: number;
    width?: number;
    height?: number;
}): Promise<ElectronSession> {
    const appRoot = path.resolve("apps/desktop");
    const port = options.port ?? 9240;
    const width = options.width ?? 1920;
    const height = options.height ?? 1080;

    fs.mkdirSync(options.userDataDir, { recursive: true });

    const proc = Bun.spawn(
        [
            "bunx",
            "electron",
            ".",
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${options.userDataDir}`,
            "--force-device-scale-factor=1",
        ],
        {
            cwd: appRoot,
            stdout: "pipe",
            stderr: "pipe",
            env: {
                ...process.env,
                // Skip single-instance lock contention if needed, without triggering --capture-ui
            },
        },
    );

    let wsUrl = "";
    for (let i = 0; i < 80; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            if (res.ok) {
                const list = (await res.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
                const page = list.find(t => t.type === "page" && t.url.includes("moesekai-app"));
                if (page?.webSocketDebuggerUrl) {
                    wsUrl = page.webSocketDebuggerUrl;
                    break;
                }
            }
        } catch {}
        await Bun.sleep(250);
    }
    if (!wsUrl) {
        proc.kill();
        throw new Error(`Timed out waiting for Electron CDP on port ${port}`);
    }

    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    const listeners = new Map<string, Set<(params: any) => void>>();

    await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", e => reject(e));
    });

    ws.addEventListener("message", ev => {
        const msg = JSON.parse(String(ev.data));
        if (typeof msg.id === "number" && pending.has(msg.id)) {
            const p = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
            else p.resolve(msg.result);
        } else if (typeof msg.method === "string") {
            const set = listeners.get(msg.method);
            if (set) {
                for (const fn of set) {
                    try {
                        fn(msg.params);
                    } catch {}
                }
            }
        }
    });

    const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });

    const on = (event: string, listener: (params: any) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return () => {
            listeners.get(event)?.delete(listener);
        };
    };

    const evalJson = async <T = any>(expression: string): Promise<T> => {
        const res = await send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (res.exceptionDetails) {
            throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails.exception ?? res.exceptionDetails)}`);
        }
        return res.result?.value as T;
    };

    const evalAsync = async <T = any>(asyncBody: string): Promise<T> => {
        return evalJson<T>(`(async () => { ${asyncBody} })()`);
    };

    const capturePng = async (outPath: string) => {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const buf = Buffer.from(shot.data, "base64");
        fs.writeFileSync(outPath, buf);
        return {
            width: buf.readUInt32BE(16),
            height: buf.readUInt32BE(20),
            bytes: buf.length,
        };
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
    });

    // Wait for React capture hook to mount
    for (let i = 0; i < 60; i++) {
        const ready = await evalJson<boolean>(`Boolean(window.__moesekaiCaptureHook)`);
        if (ready) break;
        await Bun.sleep(150);
    }

    // Install Live2D Worker probe BEFORE opening any workspace
    await evalJson(`(() => {
        if (window.__stageProbeInstalled) return true;
        window.__stageProbeInstalled = true;
        window.__stageProbe = { actors: [], alpha: {}, errors: [], readyCount: 0 };
        const OrigWorker = window.Worker;
        window.Worker = function(url, opts) {
            const w = new OrigWorker(url, opts);
            const origPost = w.postMessage.bind(w);
            w.postMessage = function(msg, transfer) {
                if (msg && typeof msg === "object") {
                    if (msg.type === "add" && msg.actor) {
                        window.__stageProbe.alpha[msg.actor] = msg.placement?.alpha ?? 1;
                    } else if (msg.type === "set" && msg.actor && msg.placement?.alpha !== undefined) {
                        window.__stageProbe.alpha[msg.actor] = msg.placement.alpha;
                    } else if (msg.type === "remove" && msg.actor) {
                        delete window.__stageProbe.alpha[msg.actor];
                    } else if (msg.type === "init") {
                        window.__stageProbe.actors = [];
                        window.__stageProbe.alpha = {};
                    }
                }
                return origPost(msg, transfer);
            };
            w.addEventListener("message", ev => {
                const d = ev.data;
                if (!d || typeof d !== "object") return;
                if (d.type === "actors" && Array.isArray(d.ids)) {
                    window.__stageProbe.actors = d.ids.slice();
                    window.__stageProbe.readyCount += 1;
                } else if (d.type === "error") {
                    window.__stageProbe.errors.push(d);
                }
            });
            return w;
        };
        return true;
    })()`);

    const cdp: CdpClient = {
        send,
        on,
        evalJson,
        evalAsync,
        capturePng,
        close: () => ws.close(),
    };

    return {
        cdp,
        dispose: async () => {
            try {
                ws.close();
            } catch {}
            try {
                if (process.platform === "win32" && proc.pid) {
                    Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
                        stdout: "ignore",
                        stderr: "ignore",
                    });
                } else {
                    proc.kill();
                }
            } catch {}
            await Promise.race([proc.exited.catch(() => {}), Bun.sleep(1500)]);
        },
    };
}

export async function waitForStageActors(
    cdp: CdpClient,
    minActors: number,
    options: { timeoutMs?: number; settleMs?: number } = {},
): Promise<{ actors: string[]; errors: unknown[]; canvasW: number; canvasH: number }> {
    const timeoutMs = options.timeoutMs ?? 45_000;
    const settleMs = options.settleMs ?? 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const st = await cdp.evalJson<{
            actors: string[];
            errors: unknown[];
            loading: boolean;
            canvasW: number;
            canvasH: number;
        }>(`(() => {
            const text = document.body.innerText || "";
            const loading = text.includes("正在加载角色模型")
                || text.includes("正在启动 Live2D")
                || text.includes("Live2D を起動")
                || text.includes("Loading Live2D");
            const canvas = document.querySelector("canvas");
            return {
                actors: (window.__stageProbe?.actors ?? []).slice(),
                errors: (window.__stageProbe?.errors ?? []).slice(),
                loading,
                canvasW: canvas?.width ?? 0,
                canvasH: canvas?.height ?? 0,
            };
        })()`);

        if (st.actors.length >= minActors && !st.loading && st.canvasW > 0 && st.canvasH > 0) {
            await Bun.sleep(settleMs);
            return { actors: st.actors, errors: st.errors, canvasW: st.canvasW, canvasH: st.canvasH };
        }
        await Bun.sleep(250);
    }

    const finalSt = await cdp.evalJson<{ actors: string[]; errors: unknown[]; canvasW: number; canvasH: number }>(`(() => {
        const canvas = document.querySelector("canvas");
        return {
            actors: (window.__stageProbe?.actors ?? []).slice(),
            errors: (window.__stageProbe?.errors ?? []).slice(),
            canvasW: canvas?.width ?? 0,
            canvasH: canvas?.height ?? 0,
        };
    })()`);
    console.warn(`[waitForStageActors] Timed out waiting for >=${minActors} actors; got`, finalSt);
    return finalSt;
}
