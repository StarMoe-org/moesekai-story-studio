/**
 * Configuration of the Live2D story player (`sse-web`) UI kit sources and fonts.
 *
 * Defaults directly to Moesekai's `https://storage.pjsk.moe/`, with runtime configuration
 * via `configureStoryCore(...)` and optional `NEXT_PUBLIC_SSE_WEB_*` env overrides.
 */
import { getStoryCoreConfig, readPublicEnv } from "../config";

/** Same-origin path the releases are served under, each in a directory of its own. */
export const SSE_WEB_PATH = "/sse-web/";

function parse(raw: string, name: string): URL {
    const invalid = new Error(`sse_web_config_invalid:${name}`);
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw invalid;
    }
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (/[?#\\\s]/.test(raw) || !(parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
        || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
        || parsed.pathname.split("/").some(part => part === "." || part === "..")
        || raw !== parsed.href) throw invalid;
    return parsed;
}

function directory(raw: string | null | undefined, name: string): string | null {
    const value = raw?.trim();
    if (!value) return null;
    const parsed = parse(value, name);
    if (!parsed.pathname.endsWith("/")) throw new Error(`sse_web_config_invalid:${name}`);
    return parsed.href;
}

/** The deployment's own copy of Cubism Core for Web, or null: the player then loads Live2D's. */
export function sseWebCoreUrl(): string | null {
    const value = readPublicEnv("NEXT_PUBLIC_SSE_WEB_CORE_URL")?.trim();
    if (!value) return null;
    const parsed = parse(value, "NEXT_PUBLIC_SSE_WEB_CORE_URL");
    if (!parsed.pathname.endsWith(".js")) throw new Error("sse_web_config_invalid:NEXT_PUBLIC_SSE_WEB_CORE_URL");
    return parsed.href;
}

/** The game servers whose stories the site publishes. */
export const SSE_WEB_REGIONS = ["jp", "cn", "tw", "kr", "en"] as const;

export type SseWebRegion = (typeof SSE_WEB_REGIONS)[number];

export interface SseWebSources {
    /** The site that publishes the story data: `<site>/<region>/` and `<site>/client/<region>/`. */
    site: string;
    region: SseWebRegion;
    /**
     * The client view is another server's: only the JP and CN clients are published, and the
     * other three servers' stories play with the CN client's UI and fonts.
     */
    borrowedUi: boolean;
    /** Development only: a relay put in front of `https://host/...`. */
    proxy?: string;
}

/**
 * Where the player reads the episodes of `region`'s server from, or null for a server the site
 * does not publish.
 */
export function sseWebSources(region: string): SseWebSources | null {
    if (!SSE_WEB_REGIONS.includes(region as SseWebRegion)) return null;
    const cfg = getStoryCoreConfig();
    const site = directory(readPublicEnv("NEXT_PUBLIC_SSE_WEB_SITE"), "NEXT_PUBLIC_SSE_WEB_SITE")
        ?? directory(cfg.sseWebSite, "storyCore.sseWebSite")!;
    const proxy = directory(cfg.sseWebAssetProxy, "storyCore.sseWebAssetProxy")
        ?? directory(readPublicEnv("NEXT_PUBLIC_SSE_WEB_ASSET_PROXY"), "NEXT_PUBLIC_SSE_WEB_ASSET_PROXY");
    return {
        site,
        region: region as SseWebRegion,
        borrowedUi: region !== "jp" && region !== "cn",
        ...(proxy ? { proxy } : {}),
    };
}

/** A font file the player draws text with: its URL and, for a variable font, the weight it is set to. */
export interface SseWebFontFile {
    url: string;
    weight?: number;
}

/** The fonts of the words and of the names: each a font and the fonts that fill in the characters it lacks. */
export interface SseWebFonts {
    body: SseWebFontFile[];
    name: SseWebFontFile[];
}

const FONT_TEXT = "MPLUS1[wght].ttf";
const FONT_FILL_BODY = "SourceHanSansJP-Medium.otf";
const FONT_FILL_NAME = "SourceHanSansJP-Heavy.otf";
const WEIGHT_BODY = 460;
const WEIGHT_NAME = 820;

/** Same-origin directory of the open fonts (`public/story-fonts`). */
export const SSE_WEB_FONT_PATH = "/story-fonts/";

/** The font files that directory has to hold. */
export const SSE_WEB_FONT_FILES: readonly string[] = [FONT_TEXT, FONT_FILL_BODY, FONT_FILL_NAME];

function enabled(raw: string | undefined, name: string): boolean {
    const value = raw?.trim().toLowerCase();
    if (!value || value === "0" || value === "false") return false;
    if (value === "1" || value === "true") return true;
    throw new Error(`sse_web_config_invalid:${name}`);
}

export function sseWebFonts(region: string): SseWebFonts | null {
    const cfg = getStoryCoreConfig();
    const named = directory(cfg.sseWebFontBase, "storyCore.sseWebFontBase")
        ?? directory(readPublicEnv("NEXT_PUBLIC_SSE_WEB_FONT_BASE"), "NEXT_PUBLIC_SSE_WEB_FONT_BASE");
    const client = enabled(readPublicEnv("NEXT_PUBLIC_SSE_WEB_CLIENT_FONTS"), "NEXT_PUBLIC_SSE_WEB_CLIENT_FONTS");
    const bundled = enabled(readPublicEnv("NEXT_PUBLIC_SSE_WEB_BUNDLED_FONTS"), "NEXT_PUBLIC_SSE_WEB_BUNDLED_FONTS");
    const base = named ?? (bundled ? SSE_WEB_FONT_PATH : null);
    if (region !== "jp" || client || !base) return null;
    const file = (name: string) => `${base}${encodeURIComponent(name)}`;
    return {
        body: [{ url: file(FONT_TEXT), weight: WEIGHT_BODY }, { url: file(FONT_FILL_BODY) }],
        name: [{ url: file(FONT_TEXT), weight: WEIGHT_NAME }, { url: file(FONT_FILL_NAME) }],
    };
}

/** Checks every value that `sseWebSources` and `sseWebFonts` read; a wrong one throws. */
export function sseWebCheckSources(): void {
    for (const region of SSE_WEB_REGIONS) {
        sseWebSources(region);
        sseWebFonts(region);
    }
}
