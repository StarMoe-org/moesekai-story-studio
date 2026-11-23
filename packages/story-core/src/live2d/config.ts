/**
 * Configuration of the Live2D model viewer (SekaiLive2DViewer).
 *
 * Defaults directly to Moesekai's public story libraries and model indexes
 * (`assets.pjsk.moe`), while supporting both runtime configuration via
 * `configureStoryCore(...)` and optional `NEXT_PUBLIC_LIVE2D_*` env overrides.
 */
import { DEFAULT_STORY_CORE_CONFIG, getStoryCoreConfig, readPublicEnv, type AssetLine } from "../config";

/** Same-origin path the releases are served under, each in a directory of its own. */
export const LIVE2D_VIEWER_PATH = "/live2d-viewer/";

/** The game servers a story library (and so a model index) is published for. */
export const LIVE2D_REGIONS = ["jp", "cn", "tw", "kr", "en"] as const;

export type Live2DRegion = (typeof LIVE2D_REGIONS)[number];

const ALLOWED_CUSTOM_PROTOCOLS = new Set(["moesekai-cache:", "moesekai-app:"]);

function isAllowedProtocol(parsed: URL): boolean {
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
        return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return ALLOWED_CUSTOM_PROTOCOLS.has(parsed.protocol);
}

function parse(raw: string, name: string): URL {
    const invalid = new Error(`live2d_viewer_config_invalid:${name}`);
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw invalid;
    }
    if (/[?#\\\s]/.test(raw) || !isAllowedProtocol(parsed)
        || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
        || parsed.pathname.split("/").some(part => part === "." || part === "..")
        || raw !== parsed.href) throw invalid;
    return parsed;
}

function directory(raw: string | null | undefined, name: string): string | null {
    const value = raw?.trim();
    if (!value) return null;
    const parsed = parse(value, name);
    if (!parsed.pathname.endsWith("/")) throw new Error(`live2d_viewer_config_invalid:${name}`);
    return parsed.href;
}

/**
 * The deployment's own copy of Cubism Core for Web, or null: the viewer then loads Live2D's.
 */
export function live2dCoreUrl(): string | null {
    const cfgCore = getStoryCoreConfig().live2dCoreUrl?.trim();
    if (cfgCore) {
        const parsed = parse(cfgCore, "storyCore.live2dCoreUrl");
        if (!parsed.pathname.endsWith(".js")) throw new Error("live2d_viewer_config_invalid:storyCore.live2dCoreUrl");
        return parsed.href;
    }
    const own = readPublicEnv("NEXT_PUBLIC_LIVE2D_CORE_URL")?.trim();
    const name = own ? "NEXT_PUBLIC_LIVE2D_CORE_URL" : "NEXT_PUBLIC_SSE_WEB_CORE_URL";
    const value = own || readPublicEnv("NEXT_PUBLIC_SSE_WEB_CORE_URL")?.trim();
    if (!value) return null;
    const parsed = parse(value, name);
    if (!parsed.pathname.endsWith(".js")) throw new Error(`live2d_viewer_config_invalid:${name}`);
    return parsed.href;
}

/** Development only: a relay put in front of `https://host/...` URLs (`<proxy><host>/...`). */
function proxy(): string | null {
    const cfg = getStoryCoreConfig();
    return directory(cfg.live2dAssetProxy, "storyCore.live2dAssetProxy")
        ?? directory(readPublicEnv("NEXT_PUBLIC_LIVE2D_ASSET_PROXY"), "NEXT_PUBLIC_LIVE2D_ASSET_PROXY")
        ?? directory(cfg.sseWebAssetProxy, "storyCore.sseWebAssetProxy")
        ?? directory(readPublicEnv("NEXT_PUBLIC_SSE_WEB_ASSET_PROXY"), "NEXT_PUBLIC_SSE_WEB_ASSET_PROXY");
}

/** `url` as the browser fetches it: through the development relay when one is set. */
export function live2dFetchUrl(url: string): string {
    const relay = proxy();
    return relay ? url.replace(/^https:\/\//, relay) : url;
}

export interface Live2DSources {
    /** The story library's root (holding `ripper.lock.json` and `library/`), as fetched. */
    library: string;
    /** The server's model index, as fetched (may be 404 when site serves directory listings instead). */
    index: string;
}

/**
 * The listing URL of `dir` (e.g. `"live2d/model/"`, `"live2d/motion/"`) on the storage asset site
 * for `region` (`<assetDomain>/<region>/<dir>`), routed through the dev proxy when set.
 */
export function live2dListingUrl(
    region: Live2DRegion,
    dir: string,
    line?: AssetLine,
): string {
    const cfg = getStoryCoreConfig();
    const resolvedLine = line ?? cfg.defaultAssetLine;
    const domain = (resolvedLine === "backup" ? cfg.assetDomainBackup : cfg.assetDomainMain).replace(/\/+$/, "");
    const cleanDir = dir.replace(/^\/+/, "");
    return live2dFetchUrl(`${domain}/${region}/${cleanDir}`);
}

/** Returns true when a non-default `models.json` index base was explicitly configured by env or host. */
export function hasExplicitLive2DIndexBase(): boolean {
    if (readPublicEnv("NEXT_PUBLIC_LIVE2D_INDEX_BASE")?.trim()) return true;
    const cfg = getStoryCoreConfig();
    const normalized = cfg.live2dIndexBase.replace(/^moesekai-cache:\/\//, "https://");
    return normalized !== DEFAULT_STORY_CORE_CONFIG.live2dIndexBase;
}

/**
 * Where the viewer reads `region`'s models from.
 */
export function live2dSources(region: Live2DRegion): Live2DSources {
    const cfg = getStoryCoreConfig();
    const libraries = directory(readPublicEnv("NEXT_PUBLIC_LIVE2D_LIBRARY_BASE"), "NEXT_PUBLIC_LIVE2D_LIBRARY_BASE")
        ?? directory(cfg.live2dLibraryBase, "storyCore.live2dLibraryBase")!;
    const indexes = directory(readPublicEnv("NEXT_PUBLIC_LIVE2D_INDEX_BASE"), "NEXT_PUBLIC_LIVE2D_INDEX_BASE")
        ?? directory(cfg.live2dIndexBase, "storyCore.live2dIndexBase")!;
    return {
        library: live2dFetchUrl(`${libraries}${region}/`),
        index: live2dFetchUrl(`${indexes}${region}/models.json`),
    };
}

/** Reads every setting once, so that a malformed one fails early. */
export function live2dCheckConfig(): void {
    live2dCoreUrl();
    for (const region of LIVE2D_REGIONS) live2dSources(region);
}

export function isLive2DRegion(value: string | null | undefined): value is Live2DRegion {
    return LIVE2D_REGIONS.includes(value as Live2DRegion);
}
