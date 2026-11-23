import type { Live2DSources } from "@moesekai/story-core";
import {
    LIVE2D_VIEWER_AVAILABLE,
    live2dScriptModuleUrl,
    type Live2DViewerErrorKind,
    type Live2DViewerMissing,
    type Live2DViewerModel,
} from "./viewer";

export type Live2DStageErrorKind = Live2DViewerErrorKind;
export type Live2DStageMissing = Live2DViewerMissing;
export type Live2DActorModel = Live2DViewerModel;

export interface Live2DStageError extends Error {
    kind?: Live2DStageErrorKind;
    missing?: Live2DStageMissing[];
    url?: string;
    code?: string;
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
    /** Opened `live2d-model` asset name/path (reported by `SekaiLive2DStage` 0.3.0+). */
    model?: string | null;
    /** Opened `live2d-motions` asset name/path (`null` when loaded without a motion set). */
    motionSet?: string | null;
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
    sources: Live2DSources;
    width: number;
    height: number;
    signal?: AbortSignal;
}

export interface Live2DStage extends EventTarget {
    /** Resolved published-version base URL on the asset site (`null` before ready). */
    readonly base?: string | null;
    readonly actors: string[];
    readonly paused: boolean;
    addActor(
        id: string,
        model: Live2DActorModel,
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
        onProgress?: (progress: { loaded: number; total: number }) => void,
    ): Promise<Live2DActorInfo>;
    removeActor(id: string): void;
    actorInfo?(id: string): Live2DActorInfo | null;
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

/** Builds a structured diagnostic error when host-served `stage.js` is missing (404) or invalid. */
export function createLive2DStageUnavailableError(url: string, cause?: unknown): Live2DStageError {
    const reason = cause instanceof Error && cause.message
        ? cause.message
        : typeof cause === "string" && cause.trim()
            ? cause.trim()
            : "SekaiLive2DStage export not found (host viewer release may not include stage.js)";
    const error: Live2DStageError = new Error(
        `${LIVE2D_STAGE_UNAVAILABLE}: failed to load ${url} (${reason})`,
    );
    error.name = "Live2DStageUnavailableError";
    error.kind = "not-found";
    error.url = url;
    error.code = LIVE2D_STAGE_UNAVAILABLE;
    return error;
}

/** Returns true when `error` indicates that `stage.js` is not served/available on the host. */
export function isLive2DStageUnavailableError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const detail = error as { code?: unknown; message?: unknown };
    if (detail.code === LIVE2D_STAGE_UNAVAILABLE) return true;
    const message = typeof detail.message === "string" ? detail.message : "";
    return message === LIVE2D_STAGE_UNAVAILABLE || message.startsWith(`${LIVE2D_STAGE_UNAVAILABLE}:`);
}

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

/**
 * Loads the multi-actor `SekaiLive2DStage` class from the host-served script base
 * (cached per resolved URL; evicts failures so retry works).
 *
 * When a host serves a single-model viewer release without `stage.js` (e.g. SekaiLive2DViewer 0.2.0),
 * 404 / script-load failures reject cleanly with a structured `Live2DStageUnavailableError`
 * rather than hanging or crashing.
 */
export function loadLive2DStage(
    scriptBaseOverride?: string | null,
    scriptVersion?: string | null,
): Promise<Live2DStageStatic> {
    const url = live2dScriptModuleUrl("stage.js", scriptBaseOverride, scriptVersion);
    const cached = stageLoaderCache.get(url);
    if (cached) return cached;

    const loading = (async () => {
        let loaded: { SekaiLive2DStage?: Live2DStageStatic };
        try {
            loaded = await import(/* webpackIgnore: true */ /* @vite-ignore */ url) as { SekaiLive2DStage?: Live2DStageStatic };
        } catch (cause) {
            throw createLive2DStageUnavailableError(url, cause);
        }
        if (typeof loaded.SekaiLive2DStage?.create !== "function" || typeof loaded.SekaiLive2DStage.supported !== "function") {
            throw createLive2DStageUnavailableError(url);
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
