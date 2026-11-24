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

const external = [
    "@moesekai/story-core",
    "@moesekai/story-core/*",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-ai/*",
    "typebox",
];

const nodeBuild = await Bun.build({
    entrypoints,
    root: resolve(pkgDir, "src"),
    outdir: distDir,
    format: "esm",
    target: "node",
    splitting: true,
    sourcemap: "linked",
    minify: false,
    external,
});

// The browser entry is bundled on its own for the browser, so no chunk it loads is shared with
// (or resolved like) the Node-only session modules.
const browserBuild = await Bun.build({
    entrypoints: [resolve(pkgDir, "src/browser.ts")],
    root: resolve(pkgDir, "src"),
    outdir: distDir,
    format: "esm",
    target: "browser",
    sourcemap: "linked",
    minify: false,
    external,
});

for (const result of [nodeBuild, browserBuild]) {
    if (!result.success) {
        for (const log of result.logs) {
            console.error(log);
        }
        process.exit(1);
    }
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

console.log(`Built @moesekai/story-agent (${nodeBuild.outputs.length + browserBuild.outputs.length} JS/map artifacts + .d.ts) -> ${distDir}`);
