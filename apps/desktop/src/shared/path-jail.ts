import fs from "node:fs";
import path from "node:path";

export class PathJailError extends Error {
    readonly code: "INVALID_ROOT" | "INVALID_PATH" | "PATH_ESCAPE" | "SYMLINK_ESCAPE" | "NOT_FOUND";

    constructor(
        code: PathJailError["code"],
        message: string,
    ) {
        super(message);
        this.name = "PathJailError";
        this.code = code;
    }
}

export interface ResolveJailedPathOptions {
    /** Allow resolving to the root directory itself (default: false). */
    allowRoot?: boolean;
    /** Require the resolved target to exist on disk (default: false). */
    mustExist?: boolean;
}

function normalizeForComparison(filePath: string): string {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Returns true if `candidate` is strictly inside `rootDir` (or equal when `allowRoot` is true).
 */
export function isPathInsideRoot(rootDir: string, candidate: string, allowRoot = false): boolean {
    const normRoot = normalizeForComparison(rootDir);
    const normCandidate = normalizeForComparison(candidate);
    if (normCandidate === normRoot) return allowRoot;
    const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
    return normCandidate.startsWith(prefix);
}

/**
 * Decodes and validates a relative path (from a URL pathname or user/manifest input).
 * Rejects traversal (`..`), null bytes, Windows drive prefixes, UNC paths, and malformed percent-encoding.
 */
export function sanitizeRelativeSubpath(rawSubpath: string): string {
    if (typeof rawSubpath !== "string") {
        throw new PathJailError("INVALID_PATH", "Subpath must be a string.");
    }
    if (rawSubpath.includes("\0") || /[\x00-\x1f]/.test(rawSubpath)) {
        throw new PathJailError("INVALID_PATH", "Subpath contains forbidden control characters.");
    }

    let decoded: string;
    try {
        decoded = decodeURIComponent(rawSubpath);
    } catch {
        throw new PathJailError("INVALID_PATH", "Subpath contains malformed URL encoding.");
    }

    if (decoded.includes("\0") || /[\x00-\x1f]/.test(decoded)) {
        throw new PathJailError("INVALID_PATH", "Decoded subpath contains forbidden control characters.");
    }

    // Reject double-encoded traversal attempts like `%2e%2e` or `%5c` left after decoding.
    if (/%2e/i.test(decoded) || /%2f/i.test(decoded) || /%5c/i.test(decoded)) {
        throw new PathJailError("PATH_ESCAPE", "Encoded path separator or traversal segment is forbidden.");
    }

    const unified = decoded.replace(/\\/g, "/");

    // Reject UNC paths (`//host/share`), absolute Windows drive letters (`C:/...`), or schemes (`file://`).
    if (unified.startsWith("//") || /^[a-zA-Z]:/.test(unified) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(unified)) {
        throw new PathJailError("PATH_ESCAPE", "Absolute or scheme-prefixed path is forbidden inside jail.");
    }

    const trimmed = unified.replace(/^\/+/, "");
    if (trimmed === "") return "";

    const rawSegments = trimmed.split("/");
    const cleanSegments: string[] = [];

    for (const seg of rawSegments) {
        if (seg === "" || seg === ".") continue;
        if (seg === ".." || /^[a-zA-Z]:/.test(seg)) {
            throw new PathJailError("PATH_ESCAPE", `Traversal segment "${seg}" is forbidden.`);
        }
        cleanSegments.push(seg);
    }

    return cleanSegments.join("/");
}

/**
 * Finds the deepest existing ancestor of `targetPath` so symlink escapes can be detected
 * even before a new file is written.
 */
function findDeepestExistingPath(targetPath: string): string | null {
    let current = path.resolve(targetPath);
    while (true) {
        if (fs.existsSync(current)) return current;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/**
 * Resolves `subpath` strictly inside `rootDir`.
 * Validates lexical containment AND realpath (symlink/junction) containment.
 */
export function resolveJailedPath(
    rootDir: string,
    subpath: string,
    options: ResolveJailedPathOptions = {},
): string {
    const { allowRoot = false, mustExist = false } = options;

    if (!rootDir || typeof rootDir !== "string" || rootDir.includes("\0")) {
        throw new PathJailError("INVALID_ROOT", "Root directory must be a non-empty valid path.");
    }

    const rootAbs = path.resolve(rootDir);
    const cleanRel = sanitizeRelativeSubpath(subpath);

    if (cleanRel === "" && !allowRoot) {
        throw new PathJailError("INVALID_PATH", "Empty relative path is not permitted.");
    }

    const resolved = cleanRel === "" ? rootAbs : path.resolve(rootAbs, ...cleanRel.split("/"));

    if (!isPathInsideRoot(rootAbs, resolved, allowRoot)) {
        throw new PathJailError("PATH_ESCAPE", `Resolved path escapes root directory: ${subpath}`);
    }

    // Realpath verification if root exists on disk.
    if (fs.existsSync(rootAbs)) {
        const realRoot = fs.realpathSync(rootAbs);
        if (fs.existsSync(resolved)) {
            const realTarget = fs.realpathSync(resolved);
            if (!isPathInsideRoot(realRoot, realTarget, allowRoot)) {
                throw new PathJailError("SYMLINK_ESCAPE", `Symlink target escapes root directory: ${subpath}`);
            }
            return realTarget;
        }

        if (mustExist) {
            throw new PathJailError("NOT_FOUND", `File does not exist inside jail: ${subpath}`);
        }

        // For non-existent write targets, ensure the deepest existing ancestor is inside realRoot.
        const ancestor = findDeepestExistingPath(resolved);
        if (ancestor) {
            const realAncestor = fs.realpathSync(ancestor);
            if (!isPathInsideRoot(realRoot, realAncestor, true)) {
                throw new PathJailError("SYMLINK_ESCAPE", `Ancestor symlink escapes root directory: ${subpath}`);
            }
        }
    } else if (mustExist) {
        throw new PathJailError("NOT_FOUND", `Root directory does not exist: ${rootAbs}`);
    }

    return resolved;
}

const VALID_UI_LOCALES = new Set(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]);

export function isValidLocaleCode(locale: string): boolean {
    return VALID_UI_LOCALES.has(locale);
}

/**
 * Produces a safe filename stem for exporting `.msk` or `.zip` files.
 */
export function sanitizeExportFilename(raw: string, fallback = "story"): string {
    const cleaned = raw
        .normalize("NFKC")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/^\.+/, "")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80);
    return cleaned || fallback;
}

const MIME_MAP: Record<string, string> = {
    ".wasm": "application/wasm",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".cjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".msk": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};

export function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? "application/octet-stream";
}
