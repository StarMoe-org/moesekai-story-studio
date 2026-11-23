import { LIVE2D_VIEWER_PATH, type Live2DSources } from "@moesekai/story-core";

export type Live2DViewerErrorKind = "unsupported" | "not-found" | "network" | "internal";

export type Live2DViewerMissing = "webgpu" | "webgpu-adapter" | "offscreen-canvas" | "worker";

export interface Live2DViewerError extends Error {
    kind?: Live2DViewerErrorKind;
    missing?: Live2DViewerMissing[];
    url?: string;
    code?: string;
}

export interface Live2DViewerView {
    zoom: number;
    x: number;
    y: number;
}

/** Model descriptor matching `SekaiLive2DViewer` 0.2.x / `SekaiLive2DStage` 0.3.x. */
export interface Live2DViewerModel {
    /** Canonical `live2d-model` asset path (e.g. `live2d/model/01ichika_normal`). */
    asset: string;
    /** Optional canonical `live2d-motions` asset path (e.g. `live2d/motion/01ichika_motion_base`), or `null` for no motions. */
    motion?: string | null;
}

export interface Live2DViewerOptions {
    canvas: HTMLCanvasElement;
    js?: string;
    pkg?: string;
    core?: string;
    sources: Live2DSources;
    model: Live2DViewerModel;
    width: number;
    height: number;
    signal?: AbortSignal;
    onProgress?: (progress: { loaded: number; total: number }) => void;
}

export interface Live2DViewer extends EventTarget {
    /** Resolved published-version base URL on the asset site (`null` before ready). */
    readonly base?: string | null;
    /** Opened `live2d-model` asset name/path (`null` before ready). */
    readonly model: string | null;
    /** Opened `live2d-motions` asset name/path (`null` when the model has no motion set). */
    readonly motionSet: string | null;
    readonly motions: readonly string[];
    readonly facials: readonly string[];
    readonly motion: string | null;
    readonly facial: string | null;
    readonly defaultMotion: string | null;
    readonly defaultFacial: string | null;
    readonly hasPhysics: boolean;
    physics: boolean;
    breath: boolean;
    readonly paused: boolean;
    readonly view: Live2DViewerView;
    readonly error: { message: string; kind: Live2DViewerErrorKind; url?: string } | null;
    playMotion(name: string, options?: { loop?: boolean }): Promise<boolean>;
    setFacial(name: string): Promise<boolean>;
    play(): void;
    pause(): void;
    setView(view: Live2DViewerView): void;
    resize(width: number, height: number): void;
    destroy(): void;
}

export interface Live2DViewerStatic {
    supported(): Promise<{ ok: boolean; missing: Live2DViewerMissing[] }>;
    create(options: Live2DViewerOptions): Promise<Live2DViewer>;
}

export const LIVE2D_VIEWER_UNAVAILABLE = "live2d_viewer_unavailable";

/**
 * `@moesekai/story-editor` loads viewer/stage scripts from the host-served `live2dScriptBase`
 * at runtime rather than shipping a bundled release.
 */
export const LIVE2D_VIEWER_AVAILABLE = true;

function ensureTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}

/** Stable value-based cache/comparison key for a `Live2DSources` descriptor (`null` if incomplete). */
export function live2dSourcesKey(sources: Live2DSources | null | undefined): string | null {
    const site = sources?.site?.trim();
    const region = sources?.region?.trim();
    if (!site || !region) return null;
    const normalizedSite = site.replace(/\/+$/, "") || "/";
    const version = sources?.version?.trim() ?? "";
    const proxy = sources?.proxy?.trim() ?? "";
    return `${normalizedSite}|${region}|${version}|${proxy}`;
}

/**
 * Resolves the directory URL where host-served Live2D viewer scripts (`viewer.js`, `stage.js`,
 * workers, wasm) live. Defaults to `LIVE2D_VIEWER_PATH` (`"/live2d-viewer/"`) when no explicit
 * `live2dScriptBase` override is supplied by the host.
 */
export function live2dViewerScriptBase(override?: string | null): string {
    const raw = override?.trim() || LIVE2D_VIEWER_PATH;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
        return ensureTrailingSlash(raw);
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return ensureTrailingSlash(new URL(raw, origin).href);
}

/**
 * Resolves the module URL for `viewer.js` or `stage.js` under the host-served `live2dScriptBase`.
 * Appends `?v=<scriptVersion>` only when the host explicitly supplies a version/cache-bust token.
 */
export function live2dScriptModuleUrl(
    file: "viewer.js" | "stage.js",
    scriptBaseOverride?: string | null,
    scriptVersion?: string | null,
): string {
    const base = live2dViewerScriptBase(scriptBaseOverride);
    const version = scriptVersion?.trim();
    if (!version) return `${base}${file}`;
    return `${base}${file}?v=${encodeURIComponent(version)}`;
}

/** Loads the single-model `SekaiLive2DViewer` class from the host-served script base. */
export async function loadLive2DViewer(
    scriptBaseOverride?: string | null,
    scriptVersion?: string | null,
): Promise<Live2DViewerStatic> {
    const url = live2dScriptModuleUrl("viewer.js", scriptBaseOverride, scriptVersion);
    let loaded: { SekaiLive2DViewer?: Live2DViewerStatic };
    try {
        loaded = await import(/* webpackIgnore: true */ /* @vite-ignore */ url) as { SekaiLive2DViewer?: Live2DViewerStatic };
    } catch (cause) {
        const reason = cause instanceof Error && cause.message ? cause.message : String(cause);
        const error: Live2DViewerError = new Error(`${LIVE2D_VIEWER_UNAVAILABLE}: failed to load ${url} (${reason})`);
        error.name = "Live2DViewerUnavailableError";
        error.kind = "not-found";
        error.url = url;
        error.code = LIVE2D_VIEWER_UNAVAILABLE;
        throw error;
    }
    if (typeof loaded.SekaiLive2DViewer?.create !== "function") {
        const error: Live2DViewerError = new Error(
            `${LIVE2D_VIEWER_UNAVAILABLE}: SekaiLive2DViewer export not found at ${url}`,
        );
        error.name = "Live2DViewerUnavailableError";
        error.kind = "not-found";
        error.url = url;
        error.code = LIVE2D_VIEWER_UNAVAILABLE;
        throw error;
    }
    return loaded.SekaiLive2DViewer;
}
