import {
    fetchMotionBundleClips,
    type Live2DModel,
    type StoryMotionBundleClips,
} from "@moesekai/story-core";

export interface ResolvedLive2DModelBundles {
    bundle: string;
    motion: string | null;
    fallbackMotionCandidates: string[];
    fromIndex: boolean;
}

export interface Live2DModelClipCatalog extends StoryMotionBundleClips {
    motionBundle: string | null;
}

export interface FetchLive2DModelClipsOptions {
    library: string;
    modelId?: string | null;
    motionBundle?: string | null;
    signal?: AbortSignal;
    /** Optional custom motion-bundle fetcher (defaults to `@moesekai/story-core` `fetchMotionBundleClips`). */
    fetchBundleClips?: (library: string, motionBundle: string, signal?: AbortSignal) => Promise<StoryMotionBundleClips>;
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
 * Derives ordered candidate motion bundles (`live2d/motion/<stem>_motion_base`) for any PJSK
 * Live2D `modelId`, mirroring `live2dMotionSet` conventions:
 * - Main character (`v2_17kanade_casual`) -> `v2_17kanade_motion_base`, `17kanade_motion_base`
 * - Gen 1 character (`21miku_night`) -> `21miku_motion_base`
 * - Sub/collab models (`sub_arisa02_lesson`) -> longest-to-shortest stems with/without trailing digits/`black`.
 */
export function candidateMotionBundlesForModelId(modelId: string | null | undefined): string[] {
    const id = modelId?.trim() ?? "";
    if (!id || !VALID_MODEL_ID_RE.test(id)) return [];

    const generation = id.startsWith("v2_") ? "v2_" : "";
    const rest = id.slice(generation.length);
    const prefixes = generation ? [generation, ""] : [""];
    const trimmed = (stem: string) => stem.replace(/(?:black|\d+)+$/, "");

    const character = /^(?:clb\d+_)?(\d{2}[a-z]+)/.exec(rest);
    const parts = rest.split("_").filter(Boolean);
    const rawStems = character
        ? [character[1], trimmed(character[1])]
        : parts.flatMap((_, index) => {
            const stem = parts.slice(0, parts.length - index).join("_");
            return [stem, trimmed(stem)];
        });

    const out: string[] = [];
    const seen = new Set<string>();
    for (const stem of rawStems) {
        if (!stem || stem === "sub") continue;
        for (const prefix of prefixes) {
            const bundle = `live2d/motion/${prefix}${stem}_motion_base`;
            if (!seen.has(bundle)) {
                seen.add(bundle);
                out.push(bundle);
            }
        }
    }
    return out;
}

/**
 * Resolves the Live2D model + motion bundle paths for `modelId`:
 * - Uses the exact entry from `models` when present.
 * - Otherwise derives deterministic `live2d/model/<id>` + candidate motion bundles so stage rendering
 *   and Solo Preview never fail solely because `models.json` returned 404 or omitted an entry.
 */
export function resolveModelBundlesForStage(
    modelId: string | null | undefined,
    models: readonly Live2DModel[] | null,
): ResolvedLive2DModelBundles | null {
    const id = modelId?.trim() ?? "";
    if (!id) return null;

    const indexed = models?.find(item => item.id === id);
    if (indexed) {
        const candidates = candidateMotionBundlesForModelId(id).filter(b => !indexed.motions.includes(b));
        return {
            bundle: indexed.bundle,
            motion: indexed.motions[0] ?? candidates[0] ?? null,
            fallbackMotionCandidates: [...indexed.motions.slice(1), ...(indexed.motions[0] ? candidates : candidates.slice(1))],
            fromIndex: true,
        };
    }

    if (!VALID_MODEL_ID_RE.test(id)) return null;
    const candidates = candidateMotionBundlesForModelId(id);
    return {
        bundle: `live2d/model/${id}`,
        motion: candidates[0] ?? null,
        fallbackMotionCandidates: candidates.slice(1),
        fromIndex: false,
    };
}

/**
 * Loads body motion & facial clip names directly from a model's motion bundle `_ripper.json`
 * manifest by `modelId` (and optional known `motionBundle`), without requiring WebGPU or the
 * character to be mounted on stage. Cached per `${library}|${modelId}|${motionBundle}`.
 */
export function fetchLive2DModelClips({
    library,
    modelId,
    motionBundle,
    signal,
    fetchBundleClips,
}: FetchLive2DModelClipsOptions): Promise<Live2DModelClipCatalog> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    const root = library.endsWith("/") ? library : `${library}/`;
    const cleanModelId = modelId?.trim() ?? "";
    const cleanMotion = motionBundle?.trim() ?? "";

    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [cleanMotion, ...candidateMotionBundlesForModelId(cleanModelId)]) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
    }

    if (candidates.length === 0) {
        return Promise.resolve({ motions: [], facials: [], motionBundle: null });
    }

    const loader = fetchBundleClips ?? fetchMotionBundleClips;
    const useCache = fetchBundleClips === undefined;
    const cacheKey = `${root}|${cleanModelId}|${cleanMotion}`;

    let shared = useCache ? clipCatalogCache.get(cacheKey) : undefined;
    if (!shared) {
        shared = (async (): Promise<Live2DModelClipCatalog> => {
            let lastError: unknown = null;
            let emptyHit: Live2DModelClipCatalog | null = null;
            for (const bundle of candidates) {
                try {
                    const clips = await loader(root, bundle);
                    const catalog: Live2DModelClipCatalog = {
                        motions: clips.motions,
                        facials: clips.facials,
                        motionBundle: bundle,
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
