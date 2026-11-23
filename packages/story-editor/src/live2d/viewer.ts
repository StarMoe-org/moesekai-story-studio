import { LIVE2D_VIEWER_PATH } from "@moesekai/story-core";
import { LIVE2D_VIEWER_RELEASE } from "./release";

export type Live2DViewerErrorKind = "unsupported" | "not-found" | "network" | "internal";

export type Live2DViewerMissing = "webgpu" | "webgpu-adapter" | "offscreen-canvas" | "worker";

export interface Live2DViewerError extends Error {
    kind?: Live2DViewerErrorKind;
    missing?: Live2DViewerMissing[];
    url?: string;
}

export interface Live2DViewerView {
    zoom: number;
    x: number;
    y: number;
}

export interface Live2DViewerOptions {
    canvas: HTMLCanvasElement;
    js?: string;
    core?: string;
    library: string;
    model: { bundle: string; motion: string | null };
    width: number;
    height: number;
    signal?: AbortSignal;
    onProgress?: (progress: { loaded: number; total: number }) => void;
}

export interface Live2DViewer extends EventTarget {
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

export const LIVE2D_VIEWER_AVAILABLE = LIVE2D_VIEWER_RELEASE !== null;

function ensureTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Resolves the directory URL where Live2D viewer scripts (`viewer.js`, `stage.js`, workers, wasm)
 * are served from. Accepts an explicit host override (e.g. `moesekai-app://app/live2d-viewer/`
 * in Electron or `/live2d-viewer/<release>/` in Web).
 */
export function live2dViewerScriptBase(override?: string | null): string {
    const trimmed = override?.trim();
    if (trimmed) {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
            return ensureTrailingSlash(trimmed);
        }
        const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
        return ensureTrailingSlash(new URL(trimmed, origin).href);
    }
    if (!LIVE2D_VIEWER_RELEASE) throw new Error("live2d_viewer_unavailable");
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return ensureTrailingSlash(new URL(`${LIVE2D_VIEWER_PATH}${LIVE2D_VIEWER_RELEASE}/`, origin).href);
}

/** Loads the viewer class from the release directory. */
export async function loadLive2DViewer(scriptBaseOverride?: string | null): Promise<Live2DViewerStatic> {
    const url = `${live2dViewerScriptBase(scriptBaseOverride)}viewer.js`;
    const loaded = await import(/* webpackIgnore: true */ /* @vite-ignore */ url) as { SekaiLive2DViewer?: Live2DViewerStatic };
    if (typeof loaded.SekaiLive2DViewer?.create !== "function") throw new Error("live2d_viewer_unavailable");
    return loaded.SekaiLive2DViewer;
}
