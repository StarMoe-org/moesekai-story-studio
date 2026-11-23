import { LIVE2D_VIEWER_AVAILABLE, live2dViewerScriptBase, type Live2DViewerErrorKind, type Live2DViewerMissing } from "./viewer";

export type Live2DStageErrorKind = Live2DViewerErrorKind;
export type Live2DStageMissing = Live2DViewerMissing;

export interface Live2DStageError extends Error {
    kind?: Live2DStageErrorKind;
    missing?: Live2DStageMissing[];
    url?: string;
}

export interface Live2DActorPlacement {
    x?: number;
    y?: number;
    scale?: number;
    alpha?: number;
    mirror?: boolean;
    order?: number;
}

export type Live2DStageEasing = "linear" | "in-out" | "in" | "out";

export interface Live2DStageTween {
    duration?: number;
    easing?: Live2DStageEasing;
}

export interface Live2DActorInfo {
    motions: string[];
    facials: string[];
    defaultMotion: string | null;
    defaultFacial: string | null;
    hasPhysics: boolean;
}

export interface Live2DStageOptions {
    canvas: HTMLCanvasElement;
    js?: string;
    pkg?: string;
    core?: string;
    library: string;
    width: number;
    height: number;
    signal?: AbortSignal;
}

export interface Live2DStage extends EventTarget {
    readonly actors: string[];
    readonly paused: boolean;
    addActor(
        id: string,
        model: { bundle: string; motion: string | null },
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
        onProgress?: (progress: { loaded: number; total: number }) => void,
    ): Promise<Live2DActorInfo>;
    removeActor(id: string): void;
    setActor(id: string, placement: Live2DActorPlacement, tween?: Live2DStageTween): Promise<boolean>;
    playMotion(id: string, name: string, options?: { loop?: boolean }): Promise<boolean>;
    setFacial(id: string, name: string): Promise<boolean>;
    setTalking(id: string, on: boolean): void;
    setMouth(id: string, value: number | null): void;
    setPhysics(on: boolean): void;
    setBreath(on: boolean): void;
    setCamera(camera: { zoom?: number; x?: number; y?: number }, tween?: Live2DStageTween): Promise<boolean>;
    finishTweens(): void;
    play(): void;
    pause(): void;
    resize(width: number, height: number): void;
    destroy(): void;
}

export interface Live2DStageStatic {
    supported(): Promise<{ ok: boolean; missing: Live2DStageMissing[] }>;
    create(options: Live2DStageOptions): Promise<Live2DStage>;
}

export const LIVE2D_STAGE_MAX_ACTORS = 8;
export const LIVE2D_STAGE_RELEASE_PRESENT = LIVE2D_VIEWER_AVAILABLE;
export const LIVE2D_STAGE_UNAVAILABLE = "live2d_stage_unavailable";

const stageLoaderCache = new Map<string, Promise<Live2DStageStatic>>();

/** Clears the dynamic module loader cache for `stage.js` (primarily for tests or forced reloads). */
export function clearLive2DStageLoaderCache(): void {
    stageLoaderCache.clear();
}

/** Returns true when `error` represents a benign cancellation/abort rather than a fatal runtime crash. */
export function isLive2DAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const detail = error as { name?: unknown; kind?: unknown };
    return detail.name === "AbortError" || detail.kind === "abort";
}

/** Loads the multi-actor stage class from the release directory (cached per URL; evicts failures so retry works). */
export function loadLive2DStage(scriptBaseOverride?: string | null): Promise<Live2DStageStatic> {
    if (!scriptBaseOverride && !LIVE2D_VIEWER_AVAILABLE) {
        return Promise.reject(new Error(LIVE2D_STAGE_UNAVAILABLE));
    }
    const url = `${live2dViewerScriptBase(scriptBaseOverride)}stage.js`;
    const cached = stageLoaderCache.get(url);
    if (cached) return cached;

    const loading = (async () => {
        let loaded: { SekaiLive2DStage?: Live2DStageStatic };
        try {
            loaded = await import(/* webpackIgnore: true */ /* @vite-ignore */ url) as { SekaiLive2DStage?: Live2DStageStatic };
        } catch {
            throw new Error(LIVE2D_STAGE_UNAVAILABLE);
        }
        if (typeof loaded.SekaiLive2DStage?.create !== "function" || typeof loaded.SekaiLive2DStage.supported !== "function") {
            throw new Error(LIVE2D_STAGE_UNAVAILABLE);
        }
        return loaded.SekaiLive2DStage;
    })();

    stageLoaderCache.set(url, loading);
    loading.catch(() => {
        if (stageLoaderCache.get(url) === loading) {
            stageLoaderCache.delete(url);
        }
    });
    return loading;
}
