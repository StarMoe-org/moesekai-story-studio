#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const distDir = resolve(pkgDir, "dist");

await rm(distDir, { recursive: true, force: true });

const entrypoints = [
    resolve(pkgDir, "src/index.ts"),
    resolve(pkgDir, "src/types/storyMaker.ts"),
    resolve(pkgDir, "src/host.ts"),
    resolve(pkgDir, "src/live2d/index.ts"),
    resolve(pkgDir, "src/story/assets.ts"),
    resolve(pkgDir, "src/story/i18nPack.ts"),
    resolve(pkgDir, "src/story/audioBundle.ts"),
    resolve(pkgDir, "src/story/script.ts"),
    resolve(pkgDir, "src/story/runtime.ts"),
    resolve(pkgDir, "src/story/compiler.ts"),
    resolve(pkgDir, "src/storySearch/index.ts"),
];

const buildResult = await Bun.build({
    entrypoints,
    root: resolve(pkgDir, "src"),
    outdir: distDir,
    format: "esm",
    target: "browser",
    splitting: true,
    sourcemap: "linked",
    minify: false,
});

if (!buildResult.success) {
    for (const log of buildResult.logs) {
        console.error(log);
    }
    process.exit(1);
}

const tsc = Bun.spawnSync(
    ["bunx", "tsc", "-p", resolve(pkgDir, "tsconfig.build.json")],
    {
        cwd: pkgDir,
        stdout: "inherit",
        stderr: "inherit",
    },
);

if (tsc.exitCode !== 0) {
    process.exit(tsc.exitCode ?? 1);
}

console.log(`Built @moesekai/story-core (${buildResult.outputs.length} JS/map artifacts + .d.ts) -> ${distDir}`);
