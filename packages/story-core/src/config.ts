/**
 * Runtime-configurable CDN endpoints and host hooks for `@moesekai/story-core`.
 *
 * Defaults directly to Moesekai's public CORS `*` endpoints (`storage.pjsk.moe`,
 * `assets.pjsk.moe`, `metadata.pjsk.moe`, `moe.exmeaning.com`) so the core package
 * works out-of-the-box in Web, Electron, Node, and Bun with zero host configuration.
 *
 * Hosts (such as `Snowy_Viewer/web` or Electron desktop) may call `configureStoryCore(...)`
 * once at startup to override CDN lines, inject a custom masterdata fetcher (e.g. IndexedDB
 * cache), or point `sse-web` / Live2D asset paths to a custom protocol.
 */
import type { StoryRegion } from "./types/storyMaker";

export type AssetLine = "main" | "backup";

export type MasterDataFetcher = <T>(server: StoryRegion, path: string) => Promise<T>;

export interface StoryCoreConfig {
    /** Main storage asset domain (default: `https://storage.pjsk.moe`). */
    assetDomainMain: string;
    /** Backup storage asset domain (default: `https://storage.exmeaning.com`). */
    assetDomainBackup: string;
    /** Main masterdata domain (default: `https://metadata.pjsk.moe`). */
    masterDataDomainMain: string;
    /** Backup masterdata domain (default: `https://metadata.exmeaning.com`). */
    masterDataDomainBackup: string;
    /** Static assets base URL (default: `https://moe.exmeaning.com`). */
    moeStaticBaseUrl: string;
    /** Default CDN line when callers pass an unqualified line or fetch masterdata. */
    defaultAssetLine: AssetLine;
    /** Default server region when an unqualified source string like `"main"` is passed. */
    defaultRegion: StoryRegion;
    /** Live2D story library base URL (trailing slash). */
    live2dLibraryBase: string;
    /** Live2D model index base URL (trailing slash). */
    live2dIndexBase: string;
    /** Optional Cubism Core JS URL override. */
    live2dCoreUrl: string | null;
    /** Optional dev proxy directory prefix for Live2D fetches. */
    live2dAssetProxy: string | null;
    /** sse-web site base URL (trailing slash). */
    sseWebSite: string;
    /** Optional override for the base URL serving `sse-web` worker scripts (e.g. `/sse-web/<ver>/` or `moesekai-app://sse-web/`). */
    sseWebScriptBase: string | null;
    /** Optional dev proxy directory prefix for sse-web fetches. */
    sseWebAssetProxy: string | null;
    /** Optional font base URL override for sse-web JP open fonts. */
    sseWebFontBase: string | null;
    /** Optional custom `fetch` implementation (defaults to `globalThis.fetch`). */
    fetchImpl: typeof fetch | null;
    /** Optional host-injected masterdata fetcher (e.g. Web's IndexedDB-cached `fetchMasterDataForServer`). */
    masterDataFetcher: MasterDataFetcher | null;
}

export const DEFAULT_STORY_CORE_CONFIG: Readonly<StoryCoreConfig> = Object.freeze({
    assetDomainMain: "https://storage.pjsk.moe",
    assetDomainBackup: "https://storage.exmeaning.com",
    masterDataDomainMain: "https://metadata.pjsk.moe",
    masterDataDomainBackup: "https://metadata.exmeaning.com",
    moeStaticBaseUrl: "https://moe.exmeaning.com",
    defaultAssetLine: "main",
    defaultRegion: "jp",
    live2dLibraryBase: "https://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/",
    live2dIndexBase: "https://assets.pjsk.moe/sekai-extra-assets/sekai-live2d/",
    live2dCoreUrl: null,
    live2dAssetProxy: null,
    sseWebSite: "https://storage.pjsk.moe/",
    sseWebScriptBase: null,
    sseWebAssetProxy: null,
    sseWebFontBase: null,
    fetchImpl: null,
    masterDataFetcher: null,
});

let currentConfig: StoryCoreConfig = { ...DEFAULT_STORY_CORE_CONFIG };

/** Returns the active runtime configuration snapshot. */
export function getStoryCoreConfig(): Readonly<StoryCoreConfig> {
    return currentConfig;
}

/** Updates one or more runtime configuration fields for `@moesekai/story-core`. */
export function configureStoryCore(patch: Partial<StoryCoreConfig>): Readonly<StoryCoreConfig> {
    currentConfig = { ...currentConfig, ...patch };
    return currentConfig;
}

/** Resets runtime configuration back to `DEFAULT_STORY_CORE_CONFIG` (primarily for tests). */
export function resetStoryCoreConfig(): Readonly<StoryCoreConfig> {
    currentConfig = { ...DEFAULT_STORY_CORE_CONFIG };
    return currentConfig;
}

/** Safe environment variable reader that works in Browser, Electron, Node, and Bun. */
export function readPublicEnv(name: string): string | undefined {
    if (typeof process === "undefined" || !process.env) return undefined;
    return process.env[name];
}

/** Resolves the configured `fetch` function or falls back to `globalThis.fetch`. */
export function getCoreFetch(): typeof fetch {
    return currentConfig.fetchImpl ?? globalThis.fetch;
}
