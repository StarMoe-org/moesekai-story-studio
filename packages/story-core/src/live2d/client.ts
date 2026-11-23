import { getCoreFetch, getStoryCoreConfig } from "../config";
import { getAssetBaseUrl, type AssetLine } from "../pjskAssets";
import { hasExplicitLive2DSite, live2dSources, type Live2DRegion } from "./config";
import { live2dModelsFromListings, type Live2DModel } from "./models";
import {
    extractLive2DFormContainerIds,
    fetchLive2DFormListing,
    live2dSiteListingUrl,
} from "./site";

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
    if (listing.format !== "directory-listing" || listing.version !== 1
        || (listing.directories !== undefined && !Array.isArray(listing.directories))) {
        throw new Error(`${url}: unsupported listing ${String(listing.format)} ${String(listing.version)}`);
    }
    return Array.isArray(listing.directories)
        ? listing.directories.filter((entry): entry is string => typeof entry === "string")
        : [];
}

async function fetchModelsFromFormListingsOnLine(region: Live2DRegion, line: AssetLine): Promise<Live2DModel[] | null> {
    const sources = live2dSources(region, line);
    const [modelListing, motionListing] = await Promise.all([
        fetchLive2DFormListing(sources, "live2d-model"),
        fetchLive2DFormListing(sources, "live2d-motions").catch(() => null),
    ]);
    if (!modelListing) return null;
    const modelDirs = extractLive2DFormContainerIds("live2d-model", modelListing.assets);
    if (modelDirs.length === 0) return null;
    const motionDirs = motionListing
        ? extractLive2DFormContainerIds("live2d-motions", motionListing.assets)
        : (await fetchDirectorySubdirectories(live2dSiteListingUrl(sources, "live2d/motion/")).catch(() => null) ?? []);
    return live2dModelsFromListings(modelDirs, motionDirs);
}

async function fetchModelsFromListingsOnLine(region: Live2DRegion, line: AssetLine): Promise<Live2DModel[] | null> {
    const sources = live2dSources(region, line);
    const [modelDirs, motionDirs] = await Promise.all([
        fetchDirectorySubdirectories(live2dSiteListingUrl(sources, "live2d/model/")),
        fetchDirectorySubdirectories(live2dSiteListingUrl(sources, "live2d/motion/")),
    ]);
    if (!modelDirs || modelDirs.length === 0) return null;
    return live2dModelsFromListings(modelDirs, motionDirs ?? []);
}

async function fetchModelsOnLine(region: Live2DRegion, line: AssetLine): Promise<Live2DModel[] | null> {
    let formError: unknown = null;
    try {
        const fromForms = await fetchModelsFromFormListingsOnLine(region, line);
        if (fromForms && fromForms.length > 0) return fromForms;
    } catch (err) {
        formError = err;
    }

    try {
        const fromDirs = await fetchModelsFromListingsOnLine(region, line);
        if (fromDirs && fromDirs.length > 0) return fromDirs;
    } catch (err) {
        throw err;
    }

    if (formError) throw formError;
    return null;
}

/**
 * A server's Live2D models, preferring canonical `sekai-serve` form listings
 * (`<site>/listings/<region>/canonical/live2d-{model,motions}`, seeding the exact
 * `dirPath -> .../build*data` asset index and `published_version` in one pass) and falling back
 * gracefully to directory listings (`/<region>/live2d/{model,motion}/`) and the backup asset line
 * when using default storage domains.
 *
 * `Live2DModel.{asset,motion,motions}` remain bare (`live2d/model/<id>`, `live2d/motion/<set>`)
 * for backwards compatibility; pass paths through `live2dAssetRequestPath(sources, path)` when
 * calling `SekaiLive2DViewer` or `SekaiLive2DStage`.
 *
 * Returns `[]` when listings are not published (404).
 * Cached per `${region}|${primaryUrl}|${backupUrl}` (retries on rejection).
 */
export function fetchLive2DModels(region: Live2DRegion, signal?: AbortSignal): Promise<Live2DModel[]> {
    if (signal?.aborted) return Promise.reject(createAbortError());
    const cfg = getStoryCoreConfig();
    const primaryLine: AssetLine = cfg.defaultAssetLine;
    const backupLine: AssetLine = primaryLine === "main" ? "backup" : "main";
    const explicitSite = hasExplicitLive2DSite();
    const primarySources = live2dSources(region, primaryLine);
    const primaryModelListingUrl = live2dSiteListingUrl(primarySources, "live2d/model/");
    const canFallback = !explicitSite && cfg.assetDomainMain !== cfg.assetDomainBackup;
    const backupModelListingUrl = canFallback
        ? live2dSiteListingUrl(live2dSources(region, backupLine), "live2d/model/")
        : "";
    const key = `${region}|${primaryModelListingUrl}|${backupModelListingUrl}`;

    let cached = modelIndexCache.get(key);
    if (!cached) {
        const loading = (async (): Promise<Live2DModel[]> => {
            let lastError: unknown = null;
            try {
                const listed = await fetchModelsOnLine(region, primaryLine);
                if (listed && listed.length > 0) return listed;
            } catch (err) {
                lastError = err;
            }

            if (canFallback) {
                try {
                    const backupListed = await fetchModelsOnLine(region, backupLine);
                    if (backupListed && backupListed.length > 0) return backupListed;
                } catch (err) {
                    lastError ??= err;
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
    const url = `${getAssetBaseUrl(`${line}-${region}`)}/${BACKGROUND_DIRECTORY}`;
    const key = `${region}|${line}|${url}`;
    let cached = backgroundCache.get(key);
    if (!cached) {
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

/** Clears cached Live2D model catalog & background directory promises (primarily for tests). */
export function clearLive2DClientCaches(): void {
    modelIndexCache.clear();
    backgroundCache.clear();
}
