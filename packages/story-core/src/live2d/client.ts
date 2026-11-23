import { getCoreFetch, getStoryCoreConfig } from "../config";
import { getAssetBaseUrl, type AssetLine } from "../pjskAssets";
import { hasExplicitLive2DIndexBase, live2dListingUrl, live2dSources, type Live2DRegion } from "./config";
import { live2dModelsFromListings, parseLive2DModelIndex, type Live2DModel } from "./models";

/** Network loaders for a server's Live2D model catalog and story background listings. */

const modelIndexCache = new Map<string, Promise<Live2DModel[]>>();
const BACKGROUND_DIRECTORY = "scenario/background/";
const backgroundCache = new Map<string, Promise<string[]>>();

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

async function fetchDirectorySubdirectories(url: string): Promise<string[] | null> {
    const fetchFn = getCoreFetch();
    const response = await fetchFn(url, { credentials: "omit", headers: { Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const listing = await response.json() as { format?: unknown; version?: unknown; directories?: unknown };
    if (listing.format !== "directory-listing" || listing.version !== 1 || !Array.isArray(listing.directories)) {
        throw new Error(`${url}: unsupported listing ${String(listing.format)} ${String(listing.version)}`);
    }
    return listing.directories.filter((entry): entry is string => typeof entry === "string");
}

async function fetchModelsFromIndexJson(url: string): Promise<Live2DModel[] | null> {
    const fetchFn = getCoreFetch();
    const response = await fetchFn(url, { credentials: "omit", headers: { Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return parseLive2DModelIndex(await response.json());
}

async function fetchModelsFromListingsOnLine(region: Live2DRegion, line: AssetLine): Promise<Live2DModel[] | null> {
    const [modelDirs, motionDirs] = await Promise.all([
        fetchDirectorySubdirectories(live2dListingUrl(region, "live2d/model/", line)),
        fetchDirectorySubdirectories(live2dListingUrl(region, "live2d/motion/", line)),
    ]);
    if (!modelDirs || modelDirs.length === 0) return null;
    return live2dModelsFromListings(modelDirs, motionDirs ?? []);
}

/**
 * A server's Live2D models, resolved from `storage.pjsk.moe/<region>/live2d/{model,motion}/`
 * directory listings (with automatic backup-line fallback and optional `models.json` support
 * when `live2dIndexBase` / `NEXT_PUBLIC_LIVE2D_INDEX_BASE` is explicitly configured).
 *
 * Returns `[]` when neither directory listings nor `models.json` are published (404).
 * Cached per `${region}|${key}` (retries on rejection).
 */
export function fetchLive2DModels(region: Live2DRegion, signal?: AbortSignal): Promise<Live2DModel[]> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    const cfg = getStoryCoreConfig();
    const primaryLine: AssetLine = cfg.defaultAssetLine;
    const backupLine: AssetLine = primaryLine === "main" ? "backup" : "main";
    const explicitIndex = hasExplicitLive2DIndexBase();
    const indexUrl = live2dSources(region).index;
    const primaryModelListingUrl = live2dListingUrl(region, "live2d/model/", primaryLine);
    const key = `${region}|${explicitIndex ? indexUrl : primaryModelListingUrl}`;

    let cached = modelIndexCache.get(key);
    if (!cached) {
        const loading = (async (): Promise<Live2DModel[]> => {
            let lastError: unknown = null;
            if (explicitIndex) {
                try {
                    const indexed = await fetchModelsFromIndexJson(indexUrl);
                    if (indexed) return indexed;
                } catch (err) {
                    lastError = err;
                }
            }

            try {
                const listed = await fetchModelsFromListingsOnLine(region, primaryLine);
                if (listed && listed.length > 0) return listed;
            } catch (err) {
                lastError ??= err;
            }

            // Try backup storage domain if distinct from primary
            if (cfg.assetDomainMain !== cfg.assetDomainBackup) {
                try {
                    const backupListed = await fetchModelsFromListingsOnLine(region, backupLine);
                    if (backupListed && backupListed.length > 0) return backupListed;
                } catch (err) {
                    lastError ??= err;
                }
            }

            if (!explicitIndex) {
                try {
                    const indexed = await fetchModelsFromIndexJson(indexUrl);
                    if (indexed) return indexed;
                } catch {
                    // Ignore fallback 404/network errors when listings were 404
                }
            }

            if (lastError) throw lastError;
            return [];
        })();
        modelIndexCache.set(key, loading);
        loading.catch(() => {
            if (modelIndexCache.get(key) === loading) {
                modelIndexCache.delete(key);
            }
        });
        cached = loading;
    }
    return withAbortSignal(cached, signal);
}

/**
 * Whether a scenario background id is a story CG / still illustration rather than a reusable scene
 * (`bg_a000001`..`bg_a000099` and `bg_s*`).
 */
export function isStoryCgBackground(name: string): boolean {
    if (name.startsWith("bg_a")) {
        const num = Number.parseInt(name.slice(4), 10);
        return Number.isFinite(num) && num >= 1 && num <= 99;
    }
    return name.startsWith("bg_s");
}

/**
 * A server's story backgrounds (`bg_a000001`), the directories under `scenario/background/` of the
 * storage view on the chosen asset line. Cached per `${region}|${line}` (retries on rejection).
 */
export function fetchStoryBackgrounds(
    region: Live2DRegion,
    line: AssetLine = getStoryCoreConfig().defaultAssetLine,
    signal?: AbortSignal,
): Promise<string[]> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    const key = `${region}|${line}`;
    let cached = backgroundCache.get(key);
    if (!cached) {
        const url = `${getAssetBaseUrl(`${line}-${region}`)}/${BACKGROUND_DIRECTORY}`;
        const fetchFn = getCoreFetch();
        const loading = (async () => {
            const response = await fetchFn(url, { credentials: "omit", headers: { Accept: "application/json" } });
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            const listing = await response.json() as { format?: string; version?: number; directories?: string[] };
            if (listing.format !== "directory-listing" || listing.version !== 1) {
                throw new Error(`${url}: unsupported listing ${String(listing.format)} ${String(listing.version)}`);
            }
            // a few directories are not backgrounds of their own
            return (listing.directories ?? []).filter(name => /^bg/.test(name));
        })();
        backgroundCache.set(key, loading);
        loading.catch(() => backgroundCache.delete(key));
        cached = loading;
    }
    return withAbortSignal(cached, signal);
}

/** Clears cached Live2D model index & background directory promises (primarily for tests). */
export function clearLive2DClientCaches(): void {
    modelIndexCache.clear();
    backgroundCache.clear();
}
