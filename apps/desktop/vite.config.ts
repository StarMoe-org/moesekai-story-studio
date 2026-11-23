import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DEV_PING_APP_ID, DEV_PING_PATH } from "./scripts/dev-server-utils.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(__dirname, "src/renderer");
const outDir = path.resolve(__dirname, "dist/renderer");

function resolveAssetDir(subName: string): string | null {
    const candidates = [
        path.resolve(__dirname, "dist", subName),
        path.resolve(__dirname, "../../packages/story-editor/dist", subName),
        path.resolve(__dirname, "../../packages/story-editor/assets", subName),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(dir)) return dir;
    }
    return null;
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".wasm":
            return "application/wasm";
        case ".js":
        case ".mjs":
            return "application/javascript; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}

function mountStaticDir(server: { middlewares: { use: Function } }, mountPrefix: string, subName: string): void {
    server.middlewares.use(mountPrefix, (req: any, res: any, next: () => void) => {
        const assetDir = resolveAssetDir(subName);
        if (!assetDir) {
            next();
            return;
        }
        const rawPath = (req.url ?? "/").split("?")[0];
        const decoded = decodeURIComponent(rawPath).replace(/^\/+/, "");
        const resolved = path.resolve(assetDir, decoded);
        const rootPrefix = assetDir.endsWith(path.sep) ? assetDir : `${assetDir}${path.sep}`;
        if (resolved !== assetDir && !resolved.startsWith(rootPrefix)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
        }
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
            next();
            return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", getMimeType(resolved));
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(resolved).pipe(res);
    });
}

/**
 * Serves `live2d-viewer` (WASM + stage-worker.js) and `unit-icons` on the same origin
 * during Vite dev so Web Workers never hit cross-origin restrictions, and responds to
 * `/__moesekai_desktop_dev_ping__` with the session nonce so `scripts/dev.ts` never
 * attaches Electron to an unrelated process occupying a port.
 */
function serveLive2DViewerPlugin(): Plugin {
    return {
        name: "moesekai-serve-live2d-viewer",
        configureServer(server) {
            server.middlewares.use(DEV_PING_PATH, (_req, res) => {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                res.end(
                    JSON.stringify({
                        app: DEV_PING_APP_ID,
                        nonce: process.env.MOESEKAI_DEV_NONCE ?? "",
                    }),
                );
            });
            mountStaticDir(server, "/live2d-viewer", "live2d-viewer");
            mountStaticDir(server, "/unit-icons", "unit-icons");
        },
    };
}

export default defineConfig({
    root: rendererRoot,
    base: "./",
    plugins: [react(), tailwindcss(), serveLive2DViewerPlugin()],
    resolve: {
        alias: {
            "@shared": path.resolve(__dirname, "src/shared"),
            "@renderer": path.resolve(__dirname, "src/renderer"),
        },
    },
    build: {
        outDir,
        emptyOutDir: true,
        target: "es2022",
        sourcemap: true,
        rollupOptions: {
            input: path.resolve(rendererRoot, "index.html"),
        },
    },
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: false,
        fs: {
            allow: [path.resolve(__dirname, "../..")],
        },
    },
});
