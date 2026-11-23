import {
    fetchLive2DModelClips as fetchCoreLive2DModelClips,
    fetchMotionBundleClips,
    inferLive2DMotionBundleCandidates,
    type Live2DModel,
    type Live2DSources,
    type StoryMotionBundleClips,
} from "@moesekai/story-core";
import { live2dSourcesKey } from "./viewer";

export interface ResolvedLive2DModelBundles {
    /** Canonical `live2d-model` asset path on the asset site (`live2d/model/<id>`). */
    asset: string;
    /** Primary `live2d-motions` asset path (`live2d/motion/<set>`), or `null`. */
    motion: string | null;
    /** Ordered fallback `live2d-motions` asset paths to try if `motion` is missing. */
    fallbackMotionCandidates: string[];
    fromIndex: boolean;
}

export interface Live2DModelClipCatalog extends StoryMotionBundleClips {
    /** Resolved canonical `live2d-motions` asset path (e.g. `live2d/motion/v2_17kanade_motion_base`), or `null`. */
    motionAsset: string | null;
    /** @deprecated Alias of `motionAsset` kept for backwards compatibility. */
    motionBundle: string | null;
}

export interface FetchLive2DModelClipsOptions {
    sources: Live2DSources;
    modelId?: string | null;
    motionAsset?: string | null;
    signal?: AbortSignal;
    /** Optional custom motion-asset fetcher (defaults to `@moesekai/story-core` `fetchMotionBundleClips`). */
    fetchBundleClips?: (sources: Live2DSources, motionAsset: string, signal?: AbortSignal) => Promise<StoryMotionBundleClips>;
}

const VALID_MODEL_ID_RE = /^[a-z0-9_]+$/;

const clipCatalogCache = new Map<string, Promise<Live2DModelClipCatalog>>();

function createAbortError(): Error {
    if (typeof DOMException !== "undefined") {
        return new DOMException("The operation was aborted.", "AbortError");
    }
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    return err;
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createAbortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(createAbortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

/**
 * Derives ordered candidate motion asset paths (`live2d/motion/<stem>_motion_base`) for any PJSK
 * Live2D `modelId`, delegating to `@moesekai/story-core`'s canonical `inferLive2DMotionBundleCandidates`.
 */
export function candidateMotionBundlesForModelId(modelId: string | null | undefined): string[] {
    const id = modelId?.trim() ?? "";
    if (!id || !VALID_MODEL_ID_RE.test(id)) return [];
    return inferLive2DMotionBundleCandidates(id);
}

/**
 * Resolves the Live2D model + motion asset paths for `modelId`:
 * - Uses the exact entry from `models` (`asset`, `motion`, `motions`) when present.
 * - Otherwise derives deterministic `live2d/model/<id>` + candidate motion assets so stage rendering
 *   and Solo Preview never fail solely because the model listing returned empty or omitted an entry.
 */
export function resolveModelBundlesForStage(
    modelId: string | null | undefined,
    models: readonly Live2DModel[] | null,
): ResolvedLive2DModelBundles | null {
    const id = modelId?.trim() ?? "";
    if (!id) return null;

    const indexed = models?.find(item => item.id === id);
    if (indexed) {
        const orderedMotions: string[] = [];
        const seen = new Set<string>();
        const pushMotion = (candidate: string | null | undefined) => {
            const clean = candidate?.trim();
            if (clean && !seen.has(clean)) {
                seen.add(clean);
                orderedMotions.push(clean);
            }
        };
        pushMotion(indexed.motion);
        for (const candidate of indexed.motions ?? []) {
            pushMotion(candidate);
        }
        for (const candidate of candidateMotionBundlesForModelId(id)) {
            pushMotion(candidate);
        }
        return {
            asset: indexed.asset,
            motion: orderedMotions[0] ?? null,
            fallbackMotionCandidates: orderedMotions.slice(1),
            fromIndex: true,
        };
    }

    if (!VALID_MODEL_ID_RE.test(id)) return null;
    const candidates = candidateMotionBundlesForModelId(id);
    return {
        asset: `live2d/model/${id}`,
        motion: candidates[0] ?? null,
        fallbackMotionCandidates: candidates.slice(1),
        fromIndex: false,
    };
}

/**
 * Loads body motion & facial clip names directly from a model's canonical `live2d-motions`
 * `.asset.json` document on the asset site by `modelId` (and optional known `motionAsset`),
 * without requiring WebGPU or the character to be mounted on stage.
 * Cached per `${sourcesKey}|${modelId}|${motionAsset}`.
 */
export function fetchLive2DModelClips({
    sources,
    modelId,
    motionAsset,
    signal,
    fetchBundleClips,
}: FetchLive2DModelClipsOptions): Promise<Live2DModelClipCatalog> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    const sourcesKey = live2dSourcesKey(sources);
    if (!sourcesKey) {
        return Promise.resolve({ motions: [], facials: [], motionAsset: null, motionBundle: null });
    }
    const cleanModelId = modelId?.trim() ?? "";
    const cleanMotion = motionAsset?.trim() ?? "";

    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [cleanMotion, ...candidateMotionBundlesForModelId(cleanModelId)]) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
    }

    if (candidates.length === 0) {
        return Promise.resolve({ motions: [], facials: [], motionAsset: null, motionBundle: null });
    }

    const useCache = fetchBundleClips === undefined;
    const cacheKey = `${sourcesKey}|${cleanModelId}|${cleanMotion}`;

    let shared = useCache ? clipCatalogCache.get(cacheKey) : undefined;
    if (!shared) {
        shared = (async (): Promise<Live2DModelClipCatalog> => {
            if (!fetchBundleClips) {
                if (cleanModelId) {
                    const resolved = await fetchCoreLive2DModelClips(sources, cleanModelId, cleanMotion || null);
                    return {
                        motions: resolved.motions,
                        facials: resolved.facials,
                        motionAsset: resolved.motionBundle,
                        motionBundle: resolved.motionBundle,
                    };
                }
                const clips = await fetchMotionBundleClips(sources, cleanMotion);
                return {
                    motions: clips.motions,
                    facials: clips.facials,
                    motionAsset: cleanMotion,
                    motionBundle: cleanMotion,
                };
            }

            let lastError: unknown = null;
            let emptyHit: Live2DModelClipCatalog | null = null;
            for (const candidate of candidates) {
                try {
                    const clips = await fetchBundleClips(sources, candidate, signal);
                    const catalog: Live2DModelClipCatalog = {
                        motions: clips.motions,
                        facials: clips.facials,
                        motionAsset: candidate,
                        motionBundle: candidate,
                    };
                    if (clips.motions.length > 0 || clips.facials.length > 0) {
                        return catalog;
                    }
                    emptyHit ??= catalog;
                } catch (error) {
                    lastError = error;
                }
            }
            if (emptyHit) return emptyHit;
            throw lastError ?? new Error(`live2d_clips_unavailable:${cleanModelId || cleanMotion}`);
        })();

        if (useCache) {
            clipCatalogCache.set(cacheKey, shared);
            shared.catch(() => {
                if (clipCatalogCache.get(cacheKey) === shared) {
                    clipCatalogCache.delete(cacheKey);
                }
            });
        }
    }

    return withAbortSignal(shared, signal);
}

/** Clears the cached model clip-catalog promises (primarily for tests). */
export function clearLive2DModelClipsCache(): void {
    clipCatalogCache.clear();
}
