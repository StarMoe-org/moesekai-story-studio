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
    resolve(pkgDir, "src/types.ts"),
    resolve(pkgDir, "src/workspace.ts"),
    resolve(pkgDir, "src/validator.ts"),
    resolve(pkgDir, "src/official-story.ts"),
    resolve(pkgDir, "src/i18n-tools.ts"),
    resolve(pkgDir, "src/tools.ts"),
    resolve(pkgDir, "src/presets.ts"),
    resolve(pkgDir, "src/models.ts"),
];

const buildResult = await Bun.build({
    entrypoints,
    root: resolve(pkgDir, "src"),
    outdir: distDir,
    format: "esm",
    target: "node",
    splitting: true,
    sourcemap: "linked",
    minify: false,
    external: [
        "@moesekai/story-core",
        "@moesekai/story-core/*",
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-agent-core",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-ai/*",
        "typebox",
    ],
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

console.log(`Built @moesekai/story-agent (${buildResult.outputs.length} JS/map artifacts + .d.ts) -> ${distDir}`);
