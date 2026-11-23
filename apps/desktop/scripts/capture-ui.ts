import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

async function main(): Promise<void> {
    const outArg = process.argv[2] ?? process.env.MOESEKAI_CAPTURE_UI_DIR;
    const outDir = outArg ? path.resolve(outArg) : path.join(appRoot, "dist", "screenshots");
    fs.mkdirSync(outDir, { recursive: true });

    const timeoutMs = Number(process.env.MOESEKAI_CAPTURE_TIMEOUT_MS ?? "110000");
    console.log(`[desktop:capture] Launching Electron (1366x840) to capture UI screenshots -> ${outDir}`);

    const proc = Bun.spawn(["bunx", "electron", ".", `--capture-ui=${outDir}`], {
        cwd: appRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
            ...process.env,
            MOESEKAI_CAPTURE_UI_DIR: outDir,
        },
    });

    const timer = setTimeout(() => {
        console.error(`[desktop:capture] Timed out after ${timeoutMs}ms; killing Electron.`);
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

    if (code !== 0 || !stdout.includes("MOESEKAI_CAPTURE_OK")) {
        console.error(`[desktop:capture] FAILED (exit=${code})`);
        process.exit(code || 1);
    }

    console.log(`[desktop:capture] PASSED -> ${outDir}`);
}

await main();
