import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getMimeType, PathJailError, resolveJailedPath } from "../shared/path-jail.ts";
import { CACHE_PROTOCOL_SCHEME } from "./asset-cache.ts";

export const APP_PROTOCOL_SCHEME = "moesekai-app";
export { CACHE_PROTOCOL_SCHEME };

export interface ProtocolContext {
    /** Directory containing compiled Vite renderer files (`dist/renderer`). */
    rendererDir: string;
    /** Directory containing Live2D viewer static assets (WASM + `stage-worker.js`). */
    live2dDir: string;
    /** Optional directory containing unit icon `.webp` assets (`dist/unit-icons`). */
    unitIconsDir?: string;
    /** Returns the currently open local project root directory, or `null` when closed. */
    getWorkspaceRoot: () => string | null;
}

export interface ProtocolResolution {
    filePath: string;
    cacheControl: string;
    allowCors: boolean;
}

/**
 * Pure request routing + path-jail resolution for `moesekai-app://` URLs.
 * Testable directly without Electron runtime.
 *
 * Supported routes:
 * - `moesekai-app://app/live2d-viewer/<file>` (same-origin with packaged renderer!)
 * - `moesekai-app://live2d-viewer/<file>`
 * - `moesekai-app://app/workspace/<file>` (same-origin local workspace audio/assets)
 * - `moesekai-app://workspace/<file>`
 * - `moesekai-app://app/<file>` (packaged renderer static assets)
 */
export function resolveProtocolRequest(urlString: string, ctx: ProtocolContext): ProtocolResolution {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new PathJailError("INVALID_PATH", `Malformed protocol URL: ${urlString}`);
    }

    if (parsed.protocol !== `${APP_PROTOCOL_SCHEME}:`) {
        throw new PathJailError("INVALID_PATH", `Unsupported protocol: ${parsed.protocol}`);
    }

    const host = parsed.hostname.toLowerCase();
    const rawPathname = parsed.pathname || "/";

    // 1. Live2D viewer assets (`moesekai-app://live2d-viewer/...` or `moesekai-app://app/live2d-viewer/...`)
    if (host === "live2d-viewer" || (host === "app" && (rawPathname === "/live2d-viewer" || rawPathname.startsWith("/live2d-viewer/")))) {
        const sub = host === "live2d-viewer"
            ? rawPathname
            : rawPathname.slice("/live2d-viewer".length);
        const filePath = resolveJailedPath(ctx.live2dDir, sub, { allowRoot: false, mustExist: true });
        return {
            filePath,
            cacheControl: "no-cache",
            allowCors: true,
        };
    }

    // 1.5 Unit icons (`moesekai-app://app/unit-icons/...`)
    if (ctx.unitIconsDir && host === "app" && (rawPathname === "/unit-icons" || rawPathname.startsWith("/unit-icons/"))) {
        const sub = rawPathname.slice("/unit-icons".length);
        const filePath = resolveJailedPath(ctx.unitIconsDir, sub, { allowRoot: false, mustExist: true });
        return {
            filePath,
            cacheControl: "public, max-age=86400",
            allowCors: true,
        };
    }

    // 2. Local workspace files (`moesekai-app://workspace/...` or `moesekai-app://app/workspace/...`)
    if (host === "workspace" || (host === "app" && (rawPathname === "/workspace" || rawPathname.startsWith("/workspace/")))) {
        const workspaceRoot = ctx.getWorkspaceRoot();
        if (!workspaceRoot) {
            throw new PathJailError("NOT_FOUND", "No workspace is currently open.");
        }
        const sub = host === "workspace"
            ? rawPathname
            : rawPathname.slice("/workspace".length);
        const filePath = resolveJailedPath(workspaceRoot, sub, { allowRoot: false, mustExist: true });
        return {
            filePath,
            cacheControl: "no-store",
            allowCors: true,
        };
    }

    // 3. Packaged renderer assets (`moesekai-app://app/...`)
    if (host === "app") {
        const sub = rawPathname === "/" || rawPathname === "" ? "index.html" : rawPathname;
        const filePath = resolveJailedPath(ctx.rendererDir, sub, { allowRoot: false, mustExist: true });
        return {
            filePath,
            cacheControl: path.extname(filePath).toLowerCase() === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
            allowCors: false,
        };
    }

    throw new PathJailError("NOT_FOUND", `Unknown moesekai-app host: ${host}`);
}

/**
 * Builds a Fetch `Response` for a jailed file with proper MIME type and HTTP Range support
 * (essential for HTML5 `<audio>` seeking on local voice files and streaming WASM).
 */
export function buildFileProtocolResponse(request: Request, resolution: ProtocolResolution): Response {
    const stat = fs.statSync(resolution.filePath);
    if (!stat.isFile()) {
        return new Response("Not Found", { status: 404 });
    }

    const mimeType = getMimeType(resolution.filePath);
    const headers = new Headers({
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": resolution.cacheControl,
        "X-Content-Type-Options": "nosniff",
    });

    if (resolution.allowCors) {
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    }

    if (request.method === "HEAD") {
        headers.set("Content-Length", String(stat.size));
        return new Response(null, { status: 200, headers });
    }

    const rangeHeader = request.headers.get("range");
    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader.trim())) {
        const [startStr, endStr] = rangeHeader.trim().slice(6).split("-");
        const start = startStr ? Number.parseInt(startStr, 10) : 0;
        const end = endStr ? Math.min(Number.parseInt(endStr, 10), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
            headers.set("Content-Range", `bytes */${stat.size}`);
            return new Response("Range Not Satisfiable", { status: 416, headers });
        }
        const chunkLength = end - start + 1;
        headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        headers.set("Content-Length", String(chunkLength));
        const nodeStream = fs.createReadStream(resolution.filePath, { start, end });
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
        return new Response(webStream, { status: 206, headers });
    }

    headers.set("Content-Length", String(stat.size));
    const nodeStream = fs.createReadStream(resolution.filePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, { status: 200, headers });
}

/**
 * Pure request handler matching Electron's `protocol.handle("moesekai-app", handler)` signature.
 */
export function createProtocolHandler(ctx: ProtocolContext): (request: Request) => Response {
    return (request: Request): Response => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method Not Allowed", { status: 405 });
        }
        try {
            const resolution = resolveProtocolRequest(request.url, ctx);
            return buildFileProtocolResponse(request, resolution);
        } catch (err) {
            if (err instanceof PathJailError) {
                const status = err.code === "NOT_FOUND" ? 404 : 403;
                return new Response(err.message, {
                    status,
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }
            return new Response("Internal Protocol Error", {
                status: 500,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
        }
    };
}

/**
 * Must be called BEFORE `app.whenReady()`.
 */
export function registerPrivilegedAppScheme(
    protocolModule: { registerSchemesAsPrivileged: (customSchemes: Array<{ scheme: string; privileges: Record<string, boolean> }>) => void },
): void {
    protocolModule.registerSchemesAsPrivileged([
        {
            scheme: APP_PROTOCOL_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
                allowServiceWorkers: true,
            },
        },
        {
            scheme: CACHE_PROTOCOL_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
    ]);
}
