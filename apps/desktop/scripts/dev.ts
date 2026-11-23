import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMainTargets } from "./build.ts";
import {
    findAvailableDevPort,
    ViteEarlyExitError,
    waitForOwnedDevServer,
} from "./dev-server-utils.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const devHost = "127.0.0.1";
const rawPreferred = Number(process.env.MOESEKAI_DEV_PORT ?? "5173");
const preferredPort = Number.isInteger(rawPreferred) && rawPreferred >= 1024 && rawPreferred <= 65535 ? rawPreferred : 5173;

async function main(): Promise<void> {
    await buildMainTargets();

    const portResult = await findAvailableDevPort(preferredPort, { host: devHost });
    const devUrl = `http://${devHost}:${portResult.port}`;
    const devNonce = crypto.randomUUID();

    if (portResult.fallbackUsed) {
        console.log(`[desktop:dev] Port ${portResult.preferredPort} is in use, using ${devUrl}`);
    } else {
        console.log(`[desktop:dev] Starting Vite dev server at ${devUrl}...`);
    }

    const viteProc = Bun.spawn(
        ["bunx", "vite", "--host", devHost, "--port", String(portResult.port), "--strictPort"],
        {
            cwd: appRoot,
            stdout: "inherit",
            stderr: "inherit",
            env: {
                ...process.env,
                MOESEKAI_DEV_NONCE: devNonce,
            },
        },
    );

    let electronProc: Bun.Subprocess | null = null;
    let shuttingDown = false;
    const watchers: fs.FSWatcher[] = [];

    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const w of watchers) {
            try {
                w.close();
            } catch {}
        }
        try {
            electronProc?.kill();
        } catch {}
        try {
            viteProc.kill();
        } catch {}
    };

    process.on("SIGINT", () => {
        shutdown();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        shutdown();
        process.exit(0);
    });

    const viteExited = viteProc.exited.then(code => code ?? 1);

    try {
        await waitForOwnedDevServer({
            url: devUrl,
            expectedNonce: devNonce,
            viteExited,
            timeoutMs: 25_000,
        });
    } catch (err) {
        if (err instanceof ViteEarlyExitError) {
            console.error(`[desktop:dev] ${err.message}`);
        } else {
            console.error(`[desktop:dev] ${err instanceof Error ? err.message : String(err)}`);
        }
        shutdown();
        process.exit(1);
    }

    void viteExited.then(code => {
        if (!shuttingDown) {
            console.error(`[desktop:dev] Vite dev server exited unexpectedly (code ${code}). Shutting down Electron...`);
            shutdown();
            process.exit(code || 1);
        }
    });

    console.log(`[desktop:dev] Launching Electron against ${devUrl}...`);
    electronProc = Bun.spawn(["bunx", "electron", "."], {
        cwd: appRoot,
        stdout: "inherit",
        stderr: "inherit",
        env: {
            ...process.env,
            VITE_DEV_SERVER_URL: devUrl,
        },
    });

    electronProc.exited.then(code => {
        if (!shuttingDown) {
            console.log(`[desktop:dev] Electron exited with code ${code}`);
            shutdown();
            process.exit(code ?? 0);
        }
    });

    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    const watchRoots = [
        path.join(appRoot, "src/main"),
        path.join(appRoot, "src/preload"),
        path.join(appRoot, "src/shared"),
    ];
    for (const dir of watchRoots) {
        if (!fs.existsSync(dir)) continue;
        const w = fs.watch(dir, { recursive: true }, () => {
            if (rebuildTimer) clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(async () => {
                console.log("[desktop:dev] Main/preload changed, rebuilding...");
                await buildMainTargets();
                console.log("[desktop:dev] Rebuild complete. Restart Electron to apply main-process changes.");
            }, 200);
        });
        watchers.push(w);
    }
}

await main();
