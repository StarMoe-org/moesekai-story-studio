import fs from "node:fs";
import path from "node:path";

const pkgRoot = path.resolve(import.meta.dir, "..");
const srcDir = path.join(pkgRoot, "src");
const distDir = path.join(pkgRoot, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

console.log("[story-editor] Compiling production ESM (.js + .d.ts) with TypeScript...");
const tscProc = Bun.spawnSync(["bunx", "tsc", "-p", path.join(pkgRoot, "tsconfig.json")], {
    cwd: pkgRoot,
    stdout: "inherit",
    stderr: "inherit",
});
if (tscProc.exitCode !== 0) {
    console.error("[story-editor] TypeScript build failed.");
    process.exit(tscProc.exitCode);
}

function walkFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, out);
        else out.push(full);
    }
    return out;
}

function resolveRelativeEsmSpecifier(fromFile: string, specifier: string): string {
    if (!specifier.startsWith(".")) return specifier;
    if (/\.(?:mjs|cjs|js|json|css|webp|png|svg|wasm)$/.test(specifier)) return specifier;
    const baseDir = path.dirname(fromFile);
    const asFile = path.resolve(baseDir, `${specifier}.js`);
    if (fs.existsSync(asFile)) {
        return `${specifier}.js`;
    }
    const asIndex = path.resolve(baseDir, specifier, "index.js");
    if (fs.existsSync(asIndex)) {
        return `${specifier.replace(/\/$/, "")}/index.js`;
    }
    return specifier;
}

const UI_CLIENT_BARRELS = new Set([
    path.normalize(path.join(distDir, "index.js")),
    path.normalize(path.join(distDir, "md3/index.js")),
    path.normalize(path.join(distDir, "md3/icons.js")),
    path.normalize(path.join(distDir, "live2d/index.js")),
]);

console.log("[story-editor] Rewriting relative ESM specifiers to explicit .js paths...");
const jsFiles = walkFiles(distDir).filter(file => file.endsWith(".js"));
for (const file of jsFiles) {
    let code = fs.readFileSync(file, "utf8");

    // Rewrite static import/export specifiers: `from "./foo"` / `export * from "./bar"`
    code = code.replace(
        /(\b(?:from|import)\s*["'])(\.\.?\/[^"']+)(["'])/g,
        (_match, prefix: string, spec: string, suffix: string) =>
            `${prefix}${resolveRelativeEsmSpecifier(file, spec)}${suffix}`,
    );

    // Ensure UI entry barrels carry "use client"; at top for Next.js App Router
    if (UI_CLIENT_BARRELS.has(path.normalize(file)) && !code.startsWith('"use client"') && !code.startsWith("'use client'")) {
        code = `"use client";\n${code}`;
    }

    if (code.includes("react/jsx-dev-runtime") || code.includes("jsxDEV")) {
        console.error(`[story-editor] Found dev JSX runtime in ${file}!`);
        process.exit(1);
    }

    fs.writeFileSync(file, code, "utf8");
}

console.log("[story-editor] Copying CSS styles and static Live2D viewer / unit icon assets...");
fs.cpSync(path.join(srcDir, "styles"), path.join(distDir, "styles"), { recursive: true });
fs.cpSync(path.join(pkgRoot, "assets/live2d-viewer"), path.join(distDir, "live2d-viewer"), { recursive: true });
fs.cpSync(path.join(pkgRoot, "assets/unit-icons"), path.join(distDir, "unit-icons"), { recursive: true });

console.log(`[story-editor] Build complete -> dist/ (${jsFiles.length} ESM modules + .d.ts + styles + live2d-viewer + unit-icons)`);
