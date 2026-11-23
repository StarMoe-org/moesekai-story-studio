"use client";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import type { Live2DModel, Live2DSources, StoryCastMember, StoryStageState } from "@moesekai/story-core";
import { useStoryStudio } from "../context/StoryStudioContext";
import type { Live2DActorInfo } from "../live2d/stage";
import {
    createBrowserStageHostAdapter,
    StoryStageController,
    type StageHostAdapter,
    type StoryActorProblem,
    type StoryClipPreviewRequest,
    type StoryStageApplyOptions,
    type StoryStageLoadProgress,
    type StoryStagePhase,
    type StoryStageRenderQuality,
} from "../live2d/stageController";

export type {
    StoryActorProblem,
    StoryClipPreviewRequest,
    StoryStageApplyOptions,
    StoryStageLoadProgress,
    StoryStagePhase,
    StoryStageRenderQuality,
};

export interface StoryStageHandle {
    hostRef: RefObject<HTMLDivElement | null>;
    phase: StoryStagePhase;
    modelInfo: Record<string, Live2DActorInfo>;
    problems: Record<string, StoryActorProblem>;
    loadingActors: number;
    loadProgress: StoryStageLoadProgress | null;
    apply: (target: StoryStageState, options: StoryStageApplyOptions) => Promise<void>;
    previewClip: (cast: StoryCastMember, clip?: StoryClipPreviewRequest) => Promise<void>;
    clearClipPreview: () => void;
    isSoloPreview: boolean;
    previewingCastKey: string | null;
    previewingCast: StoryCastMember | null;
    setTalking: (speaker: string | null) => void;
    shake: (seconds: number) => Promise<void>;
    finish: () => void;
    retry: () => void;
}

export interface UseStoryStageOptions {
    /** Canonical Live2D asset-site sources (`{ site, region, version?, proxy? }`); null while unknown. */
    sources: Live2DSources | null;
    cast: readonly StoryCastMember[];
    /** The server's models (null while loading). */
    models: readonly Live2DModel[] | null;
    /** Optional override for the Live2D viewer scripts directory (defaults to `<StoryStudioProvider live2dScriptBase>`). */
    scriptBase?: string | null;
    /** Optional cache-busting query token (`?v=...`) for `stage.js` (defaults to `<StoryStudioProvider live2dScriptVersion>`). */
    scriptVersion?: string | null;
    /** Optional override for Cubism Core JS URL (defaults to `<StoryStudioProvider live2dCoreUrl>`). */
    coreUrl?: string | null;
    /** Optional override for SSAA render quality preset (defaults to `<StoryStudioProvider stageRenderQuality>`). */
    renderQuality?: StoryStageRenderQuality;
}

export function useStoryStage({
    sources,
    cast,
    models,
    scriptBase,
    scriptVersion,
    coreUrl,
    renderQuality,
}: UseStoryStageOptions): StoryStageHandle {
    const studio = useStoryStudio();
    const effectiveScriptBase = scriptBase !== undefined ? scriptBase : studio.live2dScriptBase;
    const effectiveScriptVersion = scriptVersion !== undefined ? scriptVersion : studio.live2dScriptVersion;
    const effectiveCoreUrl = coreUrl !== undefined ? coreUrl : studio.live2dCoreUrl;
    const effectiveRenderQuality = renderQuality ?? studio.stageRenderQuality;

    const stableSources = useMemo<Live2DSources | null>(
        () => (sources ? { ...sources } : null),
        [sources?.site, sources?.region, sources?.version, sources?.proxy],
    );

    const controllerRef = useRef<StoryStageController | null>(null);
    if (controllerRef.current === null) {
        controllerRef.current = new StoryStageController();
    }
    const controller = controllerRef.current;

    const mountedRef = useRef(false);
    const rawHostRef = useRef<HTMLDivElement | null>(null);
    const boundHostElRef = useRef<HTMLDivElement | null>(null);
    const boundAdapterRef = useRef<StageHostAdapter | null>(null);

    const syncHostAdapter = useCallback(() => {
        if (!mountedRef.current) return;
        const nextEl = rawHostRef.current;
        if (nextEl === boundHostElRef.current) return;
        boundHostElRef.current = nextEl;
        boundAdapterRef.current = nextEl ? createBrowserStageHostAdapter(nextEl) : null;
        controller.setHost(boundAdapterRef.current);
    }, [controller]);

    // Reactive object ref compatible with `RefObject<HTMLDivElement | null>` that automatically
    // attaches/detaches the stage even when `<StoryStageView>` mounts conditionally after config is set.
    const hostRef = useMemo<RefObject<HTMLDivElement | null>>(() => {
        const refObj = {
            get current(): HTMLDivElement | null {
                return rawHostRef.current;
            },
            set current(el: HTMLDivElement | null) {
                if (rawHostRef.current === el) return;
                rawHostRef.current = el;
                if (mountedRef.current) {
                    queueMicrotask(() => {
                        syncHostAdapter();
                    });
                }
            },
        };
        return refObj as RefObject<HTMLDivElement | null>;
    }, [syncHostAdapter]);

    const snapshot = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
    );

    // Keep runtime configuration synced.
    useEffect(() => {
        controller.setConfig({
            sources: stableSources,
            scriptBase: effectiveScriptBase,
            scriptVersion: effectiveScriptVersion,
            coreUrl: effectiveCoreUrl,
        });
    }, [controller, effectiveCoreUrl, effectiveScriptBase, effectiveScriptVersion, stableSources]);

    // Keep dynamic cast & model catalog synced without recreating the WebGPU stage.
    useEffect(() => {
        controller.setContext({ cast, models });
    }, [cast, controller, models]);

    // Keep SSAA render quality synced dynamically via serialized resize (zero worker restart).
    useEffect(() => {
        controller.setRenderQuality(effectiveRenderQuality);
    }, [controller, effectiveRenderQuality]);

    // Mount / StrictMode remount / unmount lifecycle.
    useEffect(() => {
        mountedRef.current = true;
        controller.setRenderQuality(effectiveRenderQuality);
        controller.setConfig({
            sources: stableSources,
            scriptBase: effectiveScriptBase,
            scriptVersion: effectiveScriptVersion,
            coreUrl: effectiveCoreUrl,
        });
        controller.setContext({ cast, models });
        syncHostAdapter();
        return () => {
            mountedRef.current = false;
            boundHostElRef.current = null;
            boundAdapterRef.current = null;
            controller.detach();
        };
        // Intentionally run once per mount/unmount (config & context sync have dedicated effects above).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controller, syncHostAdapter]);

    const apply = useCallback(
        (target: StoryStageState, options: StoryStageApplyOptions) => controller.apply(target, options),
        [controller],
    );
    const previewClip = useCallback(
        (castMember: StoryCastMember, clip?: StoryClipPreviewRequest) => controller.previewClip(castMember, clip),
        [controller],
    );
    const clearClipPreview = useCallback(() => controller.clearClipPreview(), [controller]);
    const setTalking = useCallback((speaker: string | null) => controller.setTalking(speaker), [controller]);
    const shake = useCallback((seconds: number) => controller.shake(seconds), [controller]);
    const finish = useCallback(() => controller.finish(), [controller]);
    const retry = useCallback(() => controller.retry(), [controller]);

    return {
        hostRef,
        phase: snapshot.phase,
        modelInfo: snapshot.modelInfo,
        problems: snapshot.problems,
        loadingActors: snapshot.loadingActors,
        loadProgress: snapshot.loadProgress,
        apply,
        previewClip,
        clearClipPreview,
        isSoloPreview: snapshot.isSoloPreview,
        previewingCastKey: snapshot.previewingCastKey,
        previewingCast: snapshot.previewingCast,
        setTalking,
        shake,
        finish,
        retry,
    };
}
