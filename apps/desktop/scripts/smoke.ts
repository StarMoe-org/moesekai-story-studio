import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

async function main(): Promise<void> {
    const timeoutMs = Number(process.env.MOESEKAI_SMOKE_TIMEOUT_MS ?? "25000");
    console.log("[desktop:smoke] Launching Electron in smoke-test mode...");

    const proc = Bun.spawn(["bunx", "electron", ".", "--smoke-test"], {
        cwd: appRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
            ...process.env,
            MOESEKAI_SMOKE_TEST: "1",
        },
    });

    const timer = setTimeout(() => {
        console.error(`[desktop:smoke] Timed out after ${timeoutMs}ms; killing Electron process.`);
        try {
            proc.kill();
        } catch {}
    }, timeoutMs);

    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    clearTimeout(timer);

    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());

    if (code !== 0) {
        console.error(`[desktop:smoke] FAILED with exit code ${code}`);
        process.exit(code ?? 1);
    }

    if (!stdout.includes("MOESEKAI_SMOKE_OK")) {
        console.error("[desktop:smoke] FAILED: did not observe MOESEKAI_SMOKE_OK marker");
        process.exit(1);
    }

    console.log("[desktop:smoke] PASSED");
}

await main();
