/**
 * Configuration of the Live2D model viewer & stage (`SekaiLive2DViewer` / `SekaiLive2DStage` 0.2.x).
 *
 * Defaults directly to Moesekai's canonical asset site (`https://storage.pjsk.moe` / backup
 * `https://storage.exmeaning.com`) derived from active `StoryCoreConfig`, while supporting
 * runtime overrides via `configureStoryCore(...)` and optional `NEXT_PUBLIC_LIVE2D_*` env vars.
 */
import { getStoryCoreConfig, readPublicEnv, type AssetLine } from "../config";

/** Same-origin path the releases are served under, each in a directory of its own. */
export const LIVE2D_VIEWER_PATH = "/live2d-viewer/";

/** The game servers published on the canonical asset site. */
export const LIVE2D_REGIONS = ["jp", "cn", "tw", "kr", "en"] as const;

export type Live2DRegion = (typeof LIVE2D_REGIONS)[number];

/** Asset-site source configuration matching `SekaiLive2DViewer` / `SekaiLive2DStage` 0.2.x. */
export interface Live2DSources {
    /** Asset site base URL without trailing slash (e.g. `https://storage.pjsk.moe`, `moesekai-cache://storage.pjsk.moe`, or `/assets`). */
    site: string;
    /** Game server region (`jp`, `cn`, `tw`, `kr`, `en`). */
    region: Live2DRegion;
    /** Optional pinned `published_version` (resolved from `<site>/<region>/` when omitted). */
    version?: string;
    /** Development only: a relay put in front of `https://host/...` URLs (`<proxy><host>/...`). */
    proxy?: string;
}

const ALLOWED_CUSTOM_PROTOCOLS = new Set(["moesekai-cache:", "moesekai-app:"]);

function hasPathTraversal(raw: string): boolean {
    if (/[\\]|%2e%2e/i.test(raw)) return true;
    const withoutScheme = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, "");
    return withoutScheme.split("/").some(part => part === "." || part === "..");
}

function isAllowedAbsoluteProtocol(parsed: URL, allowAnyHttp: boolean): boolean {
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
        if (allowAnyHttp) return true;
        return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return ALLOWED_CUSTOM_PROTOCOLS.has(parsed.protocol);
}

function parseAbsolute(raw: string, name: string, allowAnyHttp = false): URL {
    const invalid = new Error(`live2d_viewer_config_invalid:${name}`);
    if (/[?#\\\s]/.test(raw) || hasPathTraversal(raw)) throw invalid;
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw invalid;
    }
    if (!isAllowedAbsoluteProtocol(parsed, allowAnyHttp)
        || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
        || parsed.pathname.split("/").some(part => part === "." || part === "..")) {
        throw invalid;
    }
    const normalizedRaw = raw.replace(/\/+$/, "");
    const normalizedHref = parsed.href.replace(/\/+$/, "");
    if (normalizedRaw !== normalizedHref) throw invalid;
    return parsed;
}

function directory(raw: string | null | undefined, name: string): string | null {
    const value = raw?.trim();
    if (!value) return null;
    const parsed = parseAbsolute(value, name, false);
    if (!parsed.pathname.endsWith("/") || !value.endsWith("/")) {
        throw new Error(`live2d_viewer_config_invalid:${name}`);
    }
    return parsed.href;
}

/**
 * Validates and normalizes an asset site base URL (`https:`, `http:`, `moesekai-cache:`,
 * `moesekai-app:`, or relative `/...` path), stripping trailing slashes (preserving `"/"` as `"/"`).
 */
export function normalizeLive2DSiteUrl(raw: string, name = "storyCore.live2dSite"): string {
    const invalid = new Error(`live2d_viewer_config_invalid:${name}`);
    const value = raw.trim();
    if (!value || /[?#\\\s]/.test(value) || hasPathTraversal(value)) throw invalid;

    if (value.startsWith("/")) {
        if (value.startsWith("//")) throw invalid;
        const stripped = value.replace(/\/+$/, "");
        return stripped || "/";
    }

    const parsed = parseAbsolute(value, name, true);
    return parsed.href.replace(/\/+$/, "");
}

/**
 * The deployment's own copy of Cubism Core for Web, or null: the viewer then loads Live2D's.
 */
export function live2dCoreUrl(): string | null {
    const cfgCore = getStoryCoreConfig().live2dCoreUrl?.trim();
    if (cfgCore) {
        const parsed = parseAbsolute(cfgCore, "storyCore.live2dCoreUrl", false);
        if (!parsed.pathname.endsWith(".js")) throw new Error("live2d_viewer_config_invalid:storyCore.live2dCoreUrl");
        return parsed.href;
    }
    const own = readPublicEnv("NEXT_PUBLIC_LIVE2D_CORE_URL")?.trim();
    const name = own ? "NEXT_PUBLIC_LIVE2D_CORE_URL" : "NEXT_PUBLIC_SSE_WEB_CORE_URL";
    const value = own || readPublicEnv("NEXT_PUBLIC_SSE_WEB_CORE_URL")?.trim();
    if (!value) return null;
    const parsed = parseAbsolute(value, name, false);
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
export function live2dFetchUrl(url: string, proxyOverride?: string | null): string {
    const relay = proxyOverride !== undefined ? proxyOverride : proxy();
    if (!relay) return url;
    const cleanRelay = relay.endsWith("/") ? relay : `${relay}/`;
    return url.replace(/^https:\/\//, cleanRelay);
}

/** Returns true when a custom Live2D site was explicitly configured via config or env vars. */
export function hasExplicitLive2DSite(): boolean {
    const cfg = getStoryCoreConfig();
    return Boolean(
        cfg.live2dSite?.trim()
        || readPublicEnv("NEXT_PUBLIC_LIVE2D_SITE")?.trim()
        || readPublicEnv("NEXT_PUBLIC_SSE_WEB_SITE")?.trim(),
    );
}

/**
 * Resolves the canonical asset site sources for `region` matching `SekaiLive2DViewer` 0.2.x.
 *
 * Site resolution order:
 * 1. `storyCore.live2dSite` (when non-empty)
 * 2. `NEXT_PUBLIC_LIVE2D_SITE`
 * 3. `NEXT_PUBLIC_SSE_WEB_SITE`
 * 4. Active asset domain (`assetDomainMain` or `assetDomainBackup` per `line ?? defaultAssetLine`)
 */
export function live2dSources(region: Live2DRegion, line?: AssetLine): Live2DSources {
    const cfg = getStoryCoreConfig();
    const explicitConfigSite = cfg.live2dSite?.trim();

    let site: string;
    if (explicitConfigSite) {
        site = normalizeLive2DSiteUrl(explicitConfigSite, "storyCore.live2dSite");
    } else {
        const envSite = directory(readPublicEnv("NEXT_PUBLIC_LIVE2D_SITE"), "NEXT_PUBLIC_LIVE2D_SITE")
            ?? directory(readPublicEnv("NEXT_PUBLIC_SSE_WEB_SITE"), "NEXT_PUBLIC_SSE_WEB_SITE");
        if (envSite) {
            site = envSite.replace(/\/+$/, "");
        } else {
            const resolvedLine = line ?? cfg.defaultAssetLine;
            const domain = resolvedLine === "backup" ? cfg.assetDomainBackup : cfg.assetDomainMain;
            const fieldName = resolvedLine === "backup" ? "storyCore.assetDomainBackup" : "storyCore.assetDomainMain";
            site = normalizeLive2DSiteUrl(domain, fieldName);
        }
    }

    const relay = proxy();
    return {
        site,
        region,
        ...(relay ? { proxy: relay } : {}),
    };
}

/**
 * The listing URL of `dir` (e.g. `"live2d/model/"`, `"live2d/motion/"`) on the canonical asset site
 * for `region` (`<site>/<region>/<dir>/`), routed through the dev proxy when set.
 */
export function live2dListingUrl(
    region: Live2DRegion,
    dir: string,
    line?: AssetLine,
): string {
    const sources = live2dSources(region, line);
    const cleanSite = sources.site.replace(/\/+$/, "");
    const cleanDir = dir.trim().replace(/^\/+|\/+$/g, "");
    const encodedDir = cleanDir ? cleanDir.split("/").map(encodeURIComponent).join("/") : "";
    const url = encodedDir
        ? `${cleanSite}/${encodeURIComponent(region)}/${encodedDir}/`
        : `${cleanSite}/${encodeURIComponent(region)}/`;
    return live2dFetchUrl(url, sources.proxy ?? null);
}

/** Reads every setting once, so that a malformed one fails early. */
export function live2dCheckConfig(): void {
    live2dCoreUrl();
    for (const region of LIVE2D_REGIONS) live2dSources(region);
}

export function isLive2DRegion(value: string | null | undefined): value is Live2DRegion {
    return LIVE2D_REGIONS.includes(value as Live2DRegion);
}
