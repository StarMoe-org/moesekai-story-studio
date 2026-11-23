import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distDir = path.join(appRoot, "dist");

const args = new Set(process.argv.slice(2));
const mainOnly = args.has("--main-only");
const rendererOnly = args.has("--renderer-only");

function copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function copyStaticEditorAssets(): void {
    const assetPairs: Array<{ label: string; sources: string[]; target: string }> = [
        {
            label: "live2d-viewer",
            sources: [
                path.resolve(appRoot, "../../packages/story-editor/dist/live2d-viewer"),
                path.resolve(appRoot, "../../packages/story-editor/assets/live2d-viewer"),
            ],
            target: path.join(distDir, "live2d-viewer"),
        },
        {
            label: "unit-icons",
            sources: [
                path.resolve(appRoot, "../../packages/story-editor/dist/unit-icons"),
                path.resolve(appRoot, "../../packages/story-editor/assets/unit-icons"),
            ],
            target: path.join(distDir, "unit-icons"),
        },
    ];

    for (const pair of assetPairs) {
        const source = pair.sources.find(dir => fs.existsSync(dir));
        if (!source) {
            console.warn(`[desktop:build] ${pair.label} assets not found yet; skipping copy.`);
            continue;
        }
        fs.rmSync(pair.target, { recursive: true, force: true });
        copyDirRecursive(source, pair.target);
        console.log(`[desktop:build] Copied ${pair.label} assets from ${path.relative(appRoot, source)}`);
    }
}

async function bundleNodeTarget(options: {
    label: string;
    entrypoint: string;
    outdir: string;
    naming: string;
    format: "esm" | "cjs";
    external?: string[];
}): Promise<void> {
    const result = await Bun.build({
        entrypoints: [options.entrypoint],
        outdir: options.outdir,
        naming: options.naming,
        target: "node",
        format: options.format,
        sourcemap: "linked",
        minify: false,
        external: options.external ?? ["electron"],
    });

    if (!result.success) {
        console.error(`[desktop:build] Failed to bundle ${options.label}:`);
        for (const log of result.logs) {
            console.error(" ", log);
        }
        process.exit(1);
    }

    const outputs = result.outputs.map(o => path.relative(appRoot, o.path)).join(", ");
    console.log(`[desktop:build] Built ${options.label} -> ${outputs}`);
}

export async function buildMainTargets(): Promise<void> {
    fs.mkdirSync(path.join(distDir, "main"), { recursive: true });
    fs.mkdirSync(path.join(distDir, "preload"), { recursive: true });

    await bundleNodeTarget({
        label: "main",
        entrypoint: path.join(appRoot, "src/main/index.ts"),
        outdir: path.join(distDir, "main"),
        naming: "index.js",
        format: "esm",
        external: ["electron"],
    });

    await bundleNodeTarget({
        label: "agent-worker",
        entrypoint: path.join(appRoot, "src/main/agent-worker.ts"),
        outdir: path.join(distDir, "main"),
        naming: "agent-worker.js",
        format: "esm",
        external: ["electron"],
    });

    await bundleNodeTarget({
        label: "preload",
        entrypoint: path.join(appRoot, "src/preload/index.ts"),
        outdir: path.join(distDir, "preload"),
        naming: "index.cjs",
        format: "cjs",
        external: ["electron"],
    });

    copyStaticEditorAssets();
}

async function buildRenderer(): Promise<void> {
    console.log("[desktop:build] Building renderer with Vite...");
    const proc = Bun.spawn(["bunx", "vite", "build"], {
        cwd: appRoot,
        stdout: "inherit",
        stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
        console.error(`[desktop:build] Vite build failed with exit code ${code}`);
        process.exit(code);
    }
    console.log("[desktop:build] Built renderer -> dist/renderer");
}

async function main(): Promise<void> {
    const start = performance.now();
    if (!rendererOnly) {
        await buildMainTargets();
    }
    if (!mainOnly) {
        await buildRenderer();
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    console.log(`[desktop:build] Complete in ${elapsed}s`);
}

if (import.meta.main) {
    await main();
}
