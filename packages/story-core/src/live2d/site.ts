/**
 * Canonical asset-site (`storage.pjsk.moe` / `storage.exmeaning.com`) helpers matching
 * `SekaiLive2DViewer` 0.2.x and `sekai-exporter` canonical serving specs:
 * - Directory listings (`directory-listing` v1) and `published_version` pinning
 * - Versioned base URLs (`<site>/<region>@<version>`)
 * - Nested `.asset.json` discovery (`Loader.asset(path, form)`) with `build*data` priority & form filtering
 * - Member URL resolution and `live2d-motions` clip name extraction
 */
import { getCoreFetch, getStoryCoreConfig } from "../config";
import { hasExplicitLive2DSite, live2dFetchUrl, type Live2DRegion, type Live2DSources } from "./config";

export interface AssetSiteDirectoryFile {
    name: string;
    sha256?: string;
    extension?: string;
    size?: number;
    media_type?: string;
}

export interface AssetSiteDirectoryListing {
    format: "directory-listing";
    version: 1;
    view?: string;
    published_version?: string;
    revision?: string;
    path?: string;
    directories: string[];
    files: AssetSiteDirectoryFile[];
}

export interface AssetSiteMember {
    role: string;
    sha256?: string;
    size?: number;
    extension: string;
    media_type?: string;
}

export interface AssetSiteDocument {
    format: "asset";
    version: 1;
    name: string;
    form: string;
    form_version?: number;
    fingerprint?: string;
    sources?: unknown;
    resources?: unknown;
    members: AssetSiteMember[];
    references?: unknown;
}

export interface AssetSiteFormListingAsset {
    name: string;
    fingerprint?: string;
    size?: number;
}

export interface AssetSiteFormListing {
    format: "form-listing";
    version: 1;
    view?: string;
    published_version?: string;
    revision?: string;
    form: string;
    assets: AssetSiteFormListingAsset[];
}

export type Live2DAssetForm = "live2d-model" | "live2d-motions";

export interface ResolvedLive2DAssetDocument {
    /** Parsed canonical `.asset.json` document. */
    doc: AssetSiteDocument;
    /** Resolved relative asset path on the site without `.asset.json` (matches `url`). */
    assetPath?: string;
    /** Exact versioned `.asset.json` fetch URL (proxy-wrapped when `sources.proxy` is set). */
    url: string;
    /** Versioned canonical base URL (`<site>/<region>@<version>`, unproxied). */
    baseUrl: string;
    /** Pinned `published_version`. */
    version: string;
    /** Optional dev proxy inherited from `sources`. */
    proxy?: string;
}

const PUBLISHED_VERSION_TTL_MS = 60_000;
const MAX_ASSET_WALK_DEPTH = 12;
const MAX_ASSET_WALK_DIRS = 64;
const LIVE2D_CONTAINER_DIR_RE = /^live2d\/(?:model|motion)\/[^/]+$/;
const MODEL_FORM_ASSET_RE = /^live2d\/model\/([^/]+)(?:\/.+)?$/;
const MOTION_FORM_ASSET_RE = /^live2d\/motion\/([^/]+)(?:\/.+)?$/;

function isCanonicalContainerForForm(cleanPath: string, form: Live2DAssetForm): boolean {
    if (!LIVE2D_CONTAINER_DIR_RE.test(cleanPath)) return false;
    return form === "live2d-model"
        ? cleanPath.startsWith("live2d/model/")
        : cleanPath.startsWith("live2d/motion/");
}

interface CachedVersionEntry {
    version: string;
    site: string;
    fetchedAt: number;
}

interface LatestFormIndexEntry {
    version?: string;
    map: Map<string, string>;
}

const versionCache = new Map<string, CachedVersionEntry>();
const versionInflight = new Map<string, Promise<{ version: string; site: string }>>();
const assetDocCache = new Map<string, ResolvedLive2DAssetDocument>();
const assetDocInflight = new Map<string, Promise<ResolvedLive2DAssetDocument | null>>();
const formAssetIndexByVersion = new Map<string, Map<string, string>>();
const formAssetIndexLatest = new Map<string, LatestFormIndexEntry>();
const formListingInflight = new Map<string, Promise<AssetSiteFormListing | null>>();
const formListingUnavailable = new Map<string, number>();

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

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function encodePathSegments(path: string): string {
    const clean = path.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return "";
    return clean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function cleanSiteRoot(site: string): string {
    return site.trim().replace(/\/+$/, "");
}

function applyProxy(url: string, proxy?: string | null): string {
    return proxy ? live2dFetchUrl(url, proxy) : url;
}

/**
 * Builds the version-pinned canonical base URL `<site>/<region>@<encodeURIComponent(version)>`
 * (without trailing slash and without proxy wrapping).
 */
export function live2dVersionedBaseUrl(site: string, region: Live2DRegion, version: string): string {
    const root = cleanSiteRoot(site);
    return `${root}/${encodeURIComponent(region)}@${encodeURIComponent(version.trim())}`;
}

/**
 * Builds a canonical directory listing URL (always ending with `/`, each path segment encoded,
 * and proxy-wrapped if `sources.proxy` is set):
 * - Without `sources.version`: `<site>/<region>/<dir>/`
 * - With `sources.version`: `<site>/<region>@<version>/<dir>/`
 */
export function live2dSiteListingUrl(sources: Live2DSources, dirPath?: string): string {
    const base = sources.version?.trim()
        ? live2dVersionedBaseUrl(sources.site, sources.region, sources.version)
        : `${cleanSiteRoot(sources.site)}/${encodeURIComponent(sources.region)}`;
    const encodedDir = dirPath ? encodePathSegments(dirPath) : "";
    const url = encodedDir ? `${base}/${encodedDir}/` : `${base}/`;
    return applyProxy(url, sources.proxy);
}

/**
 * Builds a canonical `sekai-serve` form-listing URL (proxy-wrapped if `sources.proxy` is set):
 * - Without `sources.version`: `<site>/listings/<region>/<view>/<form>`
 * - With `sources.version`: `<site>/listings/<region>/<view>@<version>/<form>`
 */
export function live2dFormListingUrl(
    sources: Live2DSources,
    form: Live2DAssetForm | string,
    view = "canonical",
): string {
    const root = cleanSiteRoot(sources.site);
    const regionSeg = encodeURIComponent(sources.region);
    const version = sources.version?.trim();
    const viewSeg = version
        ? `${encodeURIComponent(view)}@${encodeURIComponent(version)}`
        : encodeURIComponent(view);
    const formSeg = encodeURIComponent(form.trim());
    const url = `${root}/listings/${regionSeg}/${viewSeg}/${formSeg}`;
    return applyProxy(url, sources.proxy);
}

/**
 * Builds the exact member file URL `<base>/<encodePath(docName)>/<encodePath(member.role)>.<member.extension>`,
 * wrapped with `proxy` when provided.
 */
export function live2dMemberUrl(
    base: string,
    docName: string,
    member: Pick<AssetSiteMember, "role" | "extension">,
    proxy?: string,
): string {
    const cleanBase = base.trim().replace(/\/+$/, "");
    const encodedDoc = encodePathSegments(docName);
    const encodedRole = encodePathSegments(member.role);
    const ext = member.extension.trim().replace(/^\.+/, "");
    const leaf = ext ? `${encodedRole}.${encodeURIComponent(ext)}` : encodedRole;
    const url = encodedDoc ? `${cleanBase}/${encodedDoc}/${leaf}` : `${cleanBase}/${leaf}`;
    return applyProxy(url, proxy);
}

function parseDirectoryListing(url: string, raw: unknown): AssetSiteDirectoryListing {
    if (!raw || typeof raw !== "object") {
        throw new Error(`${url}: invalid directory listing`);
    }
    const obj = raw as Record<string, unknown>;
    if (obj.format !== "directory-listing" || obj.version !== 1
        || (obj.directories !== undefined && !Array.isArray(obj.directories))) {
        throw new Error(`${url}: unsupported listing ${String(obj.format)} ${String(obj.version)}`);
    }
    const directories = Array.isArray(obj.directories)
        ? obj.directories.filter((entry): entry is string => typeof entry === "string")
        : [];
    const files: AssetSiteDirectoryFile[] = [];
    if (Array.isArray(obj.files)) {
        for (const entry of obj.files) {
            if (typeof entry === "string") {
                files.push({ name: entry });
            } else if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
                const fileObj = entry as Record<string, unknown>;
                files.push({
                    name: fileObj.name as string,
                    ...(typeof fileObj.sha256 === "string" ? { sha256: fileObj.sha256 } : {}),
                    ...(typeof fileObj.extension === "string" ? { extension: fileObj.extension } : {}),
                    ...(typeof fileObj.size === "number" ? { size: fileObj.size } : {}),
                    ...(typeof fileObj.media_type === "string" ? { media_type: fileObj.media_type } : {}),
                });
            }
        }
    }
    return {
        format: "directory-listing",
        version: 1,
        ...(typeof obj.view === "string" ? { view: obj.view } : {}),
        ...(typeof obj.published_version === "string" ? { published_version: obj.published_version } : {}),
        ...(typeof obj.revision === "string" ? { revision: obj.revision } : {}),
        ...(typeof obj.path === "string" ? { path: obj.path } : {}),
        directories,
        files,
    };
}

function parseFormListing(raw: unknown, expectedForm: string): AssetSiteFormListing | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (obj.format !== "form-listing" || obj.version !== 1) return null;
    if (typeof obj.form !== "string" || obj.form !== expectedForm) return null;
    if (!Array.isArray(obj.assets)) return null;

    const assets: AssetSiteFormListingAsset[] = [];
    for (const entry of obj.assets) {
        if (typeof entry === "string") {
            const name = entry.trim();
            if (name) assets.push({ name });
        } else if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
            const item = entry as Record<string, unknown>;
            const name = (item.name as string).trim();
            if (!name) continue;
            assets.push({
                name,
                ...(typeof item.fingerprint === "string" ? { fingerprint: item.fingerprint } : {}),
                ...(typeof item.size === "number" ? { size: item.size } : {}),
            });
        }
    }

    return {
        format: "form-listing",
        version: 1,
        ...(typeof obj.view === "string" ? { view: obj.view } : {}),
        ...(typeof obj.published_version === "string" ? { published_version: obj.published_version } : {}),
        ...(typeof obj.revision === "string" ? { revision: obj.revision } : {}),
        form: obj.form,
        assets,
    };
}

function isBuildDataLeaf(assetName: string): boolean {
    const leaf = assetName.split("/").pop() ?? "";
    return /^build\w*data$/i.test(leaf);
}

function preferCanonicalFormAsset(existing: string | undefined, candidate: string): string {
    if (!existing) return candidate;
    const existingBuild = isBuildDataLeaf(existing);
    const candidateBuild = isBuildDataLeaf(candidate);
    if (candidateBuild !== existingBuild) return candidateBuild ? candidate : existing;
    return compareStrings(candidate, existing) < 0 ? candidate : existing;
}

/**
 * Builds a `live2d/{model,motion}/<id> -> exactCanonicalAssetName` lookup map from a
 * `form-listing` response's `assets` list, filtering out non-`live2d/{model,motion}/` entries
 * (such as `title_screen/...`) and prioritizing `build*data` leaves if multiple ever share an id.
 */
export function buildLive2DFormAssetIndex(
    form: Live2DAssetForm,
    assets: readonly (string | Pick<AssetSiteFormListingAsset, "name">)[],
): Map<string, string> {
    const pattern = form === "live2d-model" ? MODEL_FORM_ASSET_RE : MOTION_FORM_ASSET_RE;
    const prefix = form === "live2d-model" ? "live2d/model/" : "live2d/motion/";
    const out = new Map<string, string>();
    for (const entry of assets) {
        const raw = typeof entry === "string" ? entry : entry?.name;
        const clean = typeof raw === "string" ? raw.trim().replace(/^\/+|\/+$/g, "").replace(/\.asset\.json$/i, "") : "";
        if (!clean) continue;
        const match = pattern.exec(clean);
        if (!match) continue;
        const containerId = match[1];
        if (!containerId || containerId === "." || containerId === "..") continue;
        const containerKey = `${prefix}${containerId}`;
        out.set(containerKey, preferCanonicalFormAsset(out.get(containerKey), clean));
    }
    return out;
}

/**
 * Extracts deduplicated top-level container ids (`<id>` under `live2d/model/` or `<set>` under
 * `live2d/motion/`) from a canonical `form-listing` response, ignoring unrelated assets such as
 * `title_screen/...`.
 */
export function extractLive2DFormContainerIds(
    form: Live2DAssetForm,
    assets: readonly (string | Pick<AssetSiteFormListingAsset, "name">)[],
): string[] {
    const prefix = form === "live2d-model" ? "live2d/model/" : "live2d/motion/";
    const map = buildLive2DFormAssetIndex(form, assets);
    const ids: string[] = [];
    for (const containerKey of map.keys()) {
        ids.push(containerKey.slice(prefix.length));
    }
    return ids;
}

function formIndexSiteKey(site: string, region: Live2DRegion, proxy: string | undefined, form: Live2DAssetForm): string {
    return `${cleanSiteRoot(site)}|${region}|${proxy ?? ""}|${form}`;
}

function formIndexVersionKey(
    site: string,
    region: Live2DRegion,
    version: string,
    proxy: string | undefined,
    form: Live2DAssetForm,
): string {
    return `${cleanSiteRoot(site)}|${region}|${version.trim()}|${proxy ?? ""}|${form}`;
}

function isFormListingUnavailable(sources: Live2DSources, form: Live2DAssetForm): boolean {
    const key = formIndexSiteKey(sources.site, sources.region, sources.proxy, form);
    const failedAt = formListingUnavailable.get(key);
    if (failedAt === undefined) return false;
    if (Date.now() - failedAt < PUBLISHED_VERSION_TTL_MS) return true;
    formListingUnavailable.delete(key);
    return false;
}

function recordFormListingInCache(
    sources: Live2DSources,
    form: Live2DAssetForm,
    listing: AssetSiteFormListing,
): Map<string, string> {
    const site = cleanSiteRoot(sources.site) || "/";
    const map = buildLive2DFormAssetIndex(form, listing.assets);
    const resolvedVersion = listing.published_version?.trim() || sources.version?.trim() || "";
    const siteKey = formIndexSiteKey(site, sources.region, sources.proxy, form);
    formListingUnavailable.delete(siteKey);

    if (resolvedVersion) {
        formAssetIndexByVersion.set(
            formIndexVersionKey(site, sources.region, resolvedVersion, sources.proxy, form),
            map,
        );
        if (!sources.version?.trim()) {
            const vKey = versionCacheKey({ site, region: sources.region, proxy: sources.proxy });
            versionCache.set(vKey, { version: resolvedVersion, site, fetchedAt: Date.now() });
        }
    }

    if (!sources.version?.trim() || !formAssetIndexLatest.has(siteKey)) {
        formAssetIndexLatest.set(siteKey, {
            ...(resolvedVersion ? { version: resolvedVersion } : {}),
            map,
        });
    }

    return map;
}

function hasIndexedLive2DFormVersion(sources: Live2DSources, form: Live2DAssetForm): boolean {
    const version = sources.version?.trim();
    if (!version) return false;
    const site = cleanSiteRoot(sources.site) || "/";
    return formAssetIndexByVersion.has(
        formIndexVersionKey(site, sources.region, version, sources.proxy, form),
    );
}

function getIndexedLive2DFormMapForVersion(
    sources: Live2DSources,
    form: Live2DAssetForm,
): Map<string, string> | null {
    const version = sources.version?.trim();
    if (!version) return null;
    const site = cleanSiteRoot(sources.site) || "/";
    return formAssetIndexByVersion.get(
        formIndexVersionKey(site, sources.region, version, sources.proxy, form),
    ) ?? null;
}

function lookupIndexedLive2DAssetPath(
    sources: Live2DSources,
    cleanContainerPath: string,
    form: Live2DAssetForm,
): string | null {
    const site = cleanSiteRoot(sources.site) || "/";
    const explicitVersion = sources.version?.trim();
    if (explicitVersion) {
        const byVer = formAssetIndexByVersion.get(
            formIndexVersionKey(site, sources.region, explicitVersion, sources.proxy, form),
        );
        return byVer?.get(cleanContainerPath) ?? null;
    }

    const cachedBase = getCachedLive2DSiteBase(sources);
    if (cachedBase) {
        const byCachedVer = formAssetIndexByVersion.get(
            formIndexVersionKey(cachedBase.site, sources.region, cachedBase.version, sources.proxy, form),
        );
        const hit = byCachedVer?.get(cleanContainerPath);
        if (hit) return hit;
    }

    const latest = formAssetIndexLatest.get(formIndexSiteKey(site, sources.region, sources.proxy, form));
    return latest?.map.get(cleanContainerPath) ?? null;
}

/**
 * Fetches a canonical `sekai-serve` form listing (`<site>/listings/<region>/canonical[@<ver>]/<form>`)
 * and seeds the in-memory `dirPath -> exactCanonicalAssetName` index (plus `published_version`
 * cache when unpinned).
 *
 * Returns `null` cleanly on HTTP 404 or non-`form-listing` responses (older servers without
 * `/listings/`), and throws on transient 5xx/network failures so callers can fall back to backup lines.
 */
export async function fetchLive2DFormListing(
    sources: Live2DSources,
    form: Live2DAssetForm,
    signal?: AbortSignal,
): Promise<AssetSiteFormListing | null> {
    if (signal?.aborted) throw createAbortError();
    if (isFormListingUnavailable(sources, form)) return null;

    const url = live2dFormListingUrl(sources, form);
    let pending = formListingInflight.get(url);
    if (!pending) {
        pending = (async (): Promise<AssetSiteFormListing | null> => {
            const siteKey = formIndexSiteKey(sources.site, sources.region, sources.proxy, form);
            const response = await getCoreFetch()(url, {
                credentials: "omit",
                headers: { Accept: "application/json" },
            });
            if (response.status === 404) {
                formListingUnavailable.set(siteKey, Date.now());
                return null;
            }
            if (!response.ok) {
                throw new Error(`${url}: HTTP ${response.status}`);
            }
            if (typeof response.json !== "function") {
                formListingUnavailable.set(siteKey, Date.now());
                return null;
            }
            let raw: unknown;
            try {
                raw = await response.json();
            } catch {
                formListingUnavailable.set(siteKey, Date.now());
                return null;
            }
            const parsed = parseFormListing(raw, form);
            if (!parsed) {
                formListingUnavailable.set(siteKey, Date.now());
                return null;
            }
            recordFormListingInCache(sources, form, parsed);
            return parsed;
        })().finally(() => {
            formListingInflight.delete(url);
        });
        formListingInflight.set(url, pending);
    }

    return withAbortSignal(pending, signal);
}

async function fetchListingJson(url: string): Promise<AssetSiteDirectoryListing | null> {
    const fetchFn = getCoreFetch();
    const response = await fetchFn(url, {
        credentials: "omit",
        headers: { Accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return parseDirectoryListing(url, await response.json());
}

function getBackupSiteForDefaultDomain(site: string): string | null {
    if (hasExplicitLive2DSite()) return null;
    const cfg = getStoryCoreConfig();
    const main = cleanSiteRoot(cfg.assetDomainMain);
    const backup = cleanSiteRoot(cfg.assetDomainBackup);
    if (!main || !backup || main === backup) return null;
    const current = cleanSiteRoot(site);
    if (current === main) return backup;
    if (current === backup) return main;
    return null;
}

function versionCacheKey(sources: Live2DSources): string {
    return `${cleanSiteRoot(sources.site)}|${sources.region}|${sources.proxy ?? ""}`;
}

async function resolveSiteVersionEntry(
    sources: Live2DSources,
    signal?: AbortSignal,
): Promise<{ version: string; site: string }> {
    if (signal?.aborted) throw createAbortError();
    const explicitVersion = sources.version?.trim();
    if (explicitVersion) {
        return { version: explicitVersion, site: cleanSiteRoot(sources.site) || "/" };
    }

    const key = versionCacheKey(sources);
    const cached = versionCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < PUBLISHED_VERSION_TTL_MS) {
        return { version: cached.version, site: cached.site };
    }

    let pending = versionInflight.get(key);
    if (!pending) {
        pending = (async (): Promise<{ version: string; site: string }> => {
            const trySite = async (site: string): Promise<{ version: string; site: string }> => {
                const url = live2dSiteListingUrl({ site, region: sources.region, proxy: sources.proxy });
                const listing = await fetchListingJson(url);
                if (!listing) {
                    throw new Error(`${url}: HTTP 404`);
                }
                const version = listing.published_version?.trim();
                if (!version) {
                    throw new Error(`${url}: missing published_version`);
                }
                return { version, site: cleanSiteRoot(site) || "/" };
            };

            let lastError: unknown;
            try {
                const primary = await trySite(sources.site);
                versionCache.set(key, { ...primary, fetchedAt: Date.now() });
                return primary;
            } catch (err) {
                lastError = err;
            }

            const backupSite = getBackupSiteForDefaultDomain(sources.site);
            if (backupSite) {
                try {
                    const fallback = await trySite(backupSite);
                    versionCache.set(key, { ...fallback, fetchedAt: Date.now() });
                    return fallback;
                } catch (err) {
                    lastError ??= err;
                }
            }

            throw lastError ?? new Error(`Failed to resolve published_version for ${sources.region}`);
        })().finally(() => {
            versionInflight.delete(key);
        });
        versionInflight.set(key, pending);
    }

    return withAbortSignal(pending, signal);
}

/**
 * Resolves `published_version` for `sources`: returns `sources.version` immediately when pinned,
 * otherwise fetches `<site>/<region>/` directory listing (60s in-memory TTL with in-flight
 * deduplication and backup-line fallback when using default asset domains).
 */
export async function resolveLive2DPublishedVersion(
    sources: Live2DSources,
    signal?: AbortSignal,
): Promise<string> {
    const entry = await resolveSiteVersionEntry(sources, signal);
    return entry.version;
}

/**
 * Resolves the version-pinned canonical base URL (`<site>/<region>@<version>`, unproxied)
 * for `sources`.
 */
export async function resolveLive2DSiteBase(
    sources: Live2DSources,
    signal?: AbortSignal,
): Promise<string> {
    const entry = await resolveSiteVersionEntry(sources, signal);
    return live2dVersionedBaseUrl(entry.site, sources.region, entry.version);
}

/**
 * Returns the cached version-pinned base URL synchronously if `sources.version` is set or a fresh
 * `published_version` entry already sits in memory (zero network requests).
 */
export function getCachedLive2DSiteBase(
    sources: Live2DSources,
): { baseUrl: string; version: string; site: string; proxy?: string } | null {
    const explicitVersion = sources.version?.trim();
    if (explicitVersion) {
        const site = cleanSiteRoot(sources.site) || "/";
        return {
            baseUrl: live2dVersionedBaseUrl(site, sources.region, explicitVersion),
            version: explicitVersion,
            site,
            ...(sources.proxy ? { proxy: sources.proxy } : {}),
        };
    }
    const cached = versionCache.get(versionCacheKey(sources));
    if (!cached || Date.now() - cached.fetchedAt >= PUBLISHED_VERSION_TTL_MS) return null;
    return {
        baseUrl: live2dVersionedBaseUrl(cached.site, sources.region, cached.version),
        version: cached.version,
        site: cached.site,
        ...(sources.proxy ? { proxy: sources.proxy } : {}),
    };
}

function parseAssetDocument(raw: unknown): AssetSiteDocument | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (obj.format !== "asset" || obj.version !== 1) return null;
    if (typeof obj.name !== "string" || !obj.name.trim()) return null;
    if (typeof obj.form !== "string" || !obj.form.trim()) return null;
    if (!Array.isArray(obj.members)) return null;

    const members: AssetSiteMember[] = [];
    for (const item of obj.members) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        if (typeof m.role !== "string" || typeof m.extension !== "string") continue;
        members.push({
            role: m.role,
            extension: m.extension,
            ...(typeof m.sha256 === "string" ? { sha256: m.sha256 } : {}),
            ...(typeof m.size === "number" ? { size: m.size } : {}),
            ...(typeof m.media_type === "string" ? { media_type: m.media_type } : {}),
        });
    }

    return {
        format: "asset",
        version: 1,
        name: obj.name,
        form: obj.form,
        ...(typeof obj.form_version === "number" ? { form_version: obj.form_version } : {}),
        ...(typeof obj.fingerprint === "string" ? { fingerprint: obj.fingerprint } : {}),
        ...("sources" in obj ? { sources: obj.sources } : {}),
        ...("resources" in obj ? { resources: obj.resources } : {}),
        members,
        ...("references" in obj ? { references: obj.references } : {}),
    };
}

function assetDocCacheKey(
    baseUrl: string,
    proxy: string | undefined,
    cleanPath: string,
    expectedForm: Live2DAssetForm,
): string {
    return `${baseUrl}|${proxy ?? ""}|${cleanPath}|${expectedForm}`;
}

function normalizeAssetLookupPath(assetPath: string): string {
    return assetPath.trim().replace(/^\/+|\/+$/g, "").replace(/\.asset\.json$/i, "");
}

/**
 * Marks a top-level canonical Live2D container path (`live2d/model/<id>` or
 * `live2d/motion/<set>`) with a trailing `/` so `SekaiLive2DViewer`, `SekaiLive2DStage`,
 * and `resolveLive2DAssetDocument` treat it strictly as a directory and skip the
 * guaranteed-404 `<path>.asset.json` probe.
 *
 * Already-resolved nested exact asset paths (e.g. `.../buildmodeldata`), explicit
 * `.asset.json` paths, and custom non-directory paths are returned trimmed without
 * adding a trailing `/`. Paths that already end with `/` keep a single trailing `/`.
 */
export function live2dDirectoryPath(assetPath: string): string {
    const trimmed = assetPath.trim();
    if (!trimmed) return "";
    const withoutLeading = trimmed.replace(/^\/+/, "");
    const hadTrailingSlash = withoutLeading.endsWith("/");
    const clean = withoutLeading.replace(/\/+$/, "");
    if (!clean) return "";
    if (/\.asset\.json$/i.test(clean)) return clean;
    if (hadTrailingSlash || LIVE2D_CONTAINER_DIR_RE.test(clean)) {
        return `${clean}/`;
    }
    return clean;
}

/**
 * Returns the optimal asset path to pass to `SekaiLive2DViewer`, `SekaiLive2DStage`, or
 * `resolveLive2DAssetDocument` for `assetPath` (zero network requests):
 *
 * 1. Already-exact nested paths (e.g. `.../buildmodeldata`) and explicit `.asset.json` paths
 *    are returned untouched without trailing `/`.
 * 2. Top-level canonical container paths (`live2d/model/<id>` or `live2d/motion/<set>`, with
 *    or without trailing `/`) return the exact canonical asset name (`.../buildmodeldata` or
 *    `.../buildmotiondata`) whenever indexed in memory from `/listings/...` or previously
 *    resolved by `resolveLive2DAssetDocument` -> 1 direct request, 0 directory walks, 0 404s.
 * 3. Otherwise returns `live2dDirectoryPath(assetPath)` (with trailing `/`) so the worker or
 *    resolver skips the guaranteed-404 `<path>.asset.json` probe cleanly.
 */
export function live2dAssetRequestPath(
    sources: Live2DSources | null | undefined,
    assetPath: string,
    expectedForm?: Live2DAssetForm,
): string {
    const trimmed = assetPath.trim();
    if (!trimmed) return "";
    const clean = normalizeAssetLookupPath(trimmed);
    if (!clean) return "";
    if (!LIVE2D_CONTAINER_DIR_RE.test(clean) || /\.asset\.json$/i.test(trimmed.replace(/\/+$/, ""))) {
        return live2dDirectoryPath(trimmed);
    }
    if (sources) {
        const form: Live2DAssetForm = expectedForm
            ?? (clean.startsWith("live2d/model/") ? "live2d-model" : "live2d-motions");
        if (isCanonicalContainerForForm(clean, form)) {
            const indexed = lookupIndexedLive2DAssetPath(sources, clean, form);
            if (indexed) return indexed;
        }
        const cachedDoc = getCachedLive2DAssetDocument(sources, clean, form);
        const cachedPath = cachedDoc ? normalizeAssetLookupPath(cachedDoc.assetPath ?? cachedDoc.doc.name) : "";
        if (cachedPath && cachedPath.startsWith(`${clean}/`)) {
            return cachedPath;
        }
    }
    return live2dDirectoryPath(trimmed);
}

function sortAssetCandidateStems(stems: readonly string[]): string[] {
    return [...stems].sort((a, b) => {
        const aBuild = /^build\w*data$/i.test(a) ? 0 : 1;
        const bBuild = /^build\w*data$/i.test(b) ? 0 : 1;
        return aBuild - bBuild || compareStrings(a, b);
    });
}

/**
 * Returns a previously resolved `.asset.json` document synchronously from the in-memory cache
 * (zero network requests), or `null` if not cached yet.
 */
export function getCachedLive2DAssetDocument(
    sources: Live2DSources,
    assetPath: string,
    expectedForm: Live2DAssetForm,
): ResolvedLive2DAssetDocument | null {
    const cleanPath = normalizeAssetLookupPath(assetPath);
    if (!cleanPath) return null;
    const base = getCachedLive2DSiteBase(sources);
    if (!base) return null;
    return assetDocCache.get(assetDocCacheKey(base.baseUrl, base.proxy, cleanPath, expectedForm)) ?? null;
}

/**
 * Resolves a canonical `.asset.json` document matching `expectedForm` (`"live2d-model"` or
 * `"live2d-motions"`), mirroring `SekaiLive2DViewer`'s `Loader.asset(path, form)`:
 *
 * 1. When `assetPath` does NOT end with `/`, tries `<base>/<encodedPath>.asset.json` directly first
 *    (accepting only `format === "asset"` and `form === expectedForm`). When `assetPath` ends with
 *    `/`, treats it strictly as a directory and skips the direct `.asset.json` probe (zero 404s!).
 * 2. Walks `<base>/<encodedDir>/` directory listings (depth <= 12), sorting `/^build\w*data$/i`
 *    candidates first and ignoring non-matching `form` documents (e.g. `form: "text"`).
 *
 * Returns `null` when no matching document exists (404). Deduplicates in-flight requests and caches
 * resolved documents in memory by `(baseUrl, proxy, assetPath, expectedForm)`.
 */
export async function resolveLive2DAssetDocument(
    sources: Live2DSources,
    assetPath: string,
    expectedForm: Live2DAssetForm,
    signal?: AbortSignal,
): Promise<ResolvedLive2DAssetDocument | null> {
    if (signal?.aborted) throw createAbortError();
    const trimmed = assetPath.trim();
    const isExplicitAssetFile = /\.asset\.json$/i.test(trimmed.replace(/\/+$/, ""));
    const isExplicitDirectory = !isExplicitAssetFile && trimmed.endsWith("/");
    const cleanPath = normalizeAssetLookupPath(trimmed);
    if (!cleanPath) return null;

    const entry = await resolveSiteVersionEntry(sources, signal);
    if (signal?.aborted) throw createAbortError();

    const baseUrl = live2dVersionedBaseUrl(entry.site, sources.region, entry.version);
    const proxy = sources.proxy;
    const key = assetDocCacheKey(baseUrl, proxy, cleanPath, expectedForm);

    const cached = assetDocCache.get(key);
    if (cached && (!isExplicitDirectory || normalizeAssetLookupPath(cached.doc.name) !== cleanPath)) {
        return cached;
    }

    const inflightKey = `${key}|${isExplicitDirectory ? "dir" : "any"}`;
    let pending = assetDocInflight.get(inflightKey);
    if (!pending) {
        pending = (async (): Promise<ResolvedLive2DAssetDocument | null> => {
            const fetchDocAt = async (relDocPath: string): Promise<ResolvedLive2DAssetDocument | null> => {
                const encoded = encodePathSegments(relDocPath);
                const url = applyProxy(`${baseUrl}/${encoded}.asset.json`, proxy);
                const res = await getCoreFetch()(url, {
                    credentials: "omit",
                    headers: { Accept: "application/json" },
                });
                if (res.status === 404) return null;
                if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
                const parsed = parseAssetDocument(await res.json());
                if (!parsed || parsed.form !== expectedForm) return null;
                return {
                    doc: parsed,
                    assetPath: normalizeAssetLookupPath(relDocPath),
                    url,
                    baseUrl,
                    version: entry.version,
                    ...(proxy ? { proxy } : {}),
                };
            };

            const cacheMatch = (match: ResolvedLive2DAssetDocument): ResolvedLive2DAssetDocument => {
                assetDocCache.set(key, match);
                const resolvedPath = normalizeAssetLookupPath(match.assetPath ?? match.doc.name);
                if (resolvedPath && resolvedPath !== cleanPath) {
                    assetDocCache.set(assetDocCacheKey(baseUrl, proxy, resolvedPath, expectedForm), match);
                }
                const resolvedName = normalizeAssetLookupPath(match.doc.name);
                if (resolvedName && resolvedName !== cleanPath && resolvedName !== resolvedPath) {
                    assetDocCache.set(assetDocCacheKey(baseUrl, proxy, resolvedName, expectedForm), match);
                }
                return match;
            };

            // 0. Canonical form-listing index fast path for `live2d/{model,motion}/<id>` containers
            //    matching `expectedForm`'s prefix: reuses the in-memory `/listings/...` index (or fetches
            //    it lazily once per version) to load `.../build*data.asset.json` in 1 direct request.
            if (isCanonicalContainerForForm(cleanPath, expectedForm) && !isExplicitAssetFile) {
                const pinnedSources: Live2DSources = {
                    site: entry.site,
                    region: sources.region,
                    version: entry.version,
                    ...(proxy ? { proxy } : {}),
                };
                if (!hasIndexedLive2DFormVersion(pinnedSources, expectedForm) && !isFormListingUnavailable(pinnedSources, expectedForm)) {
                    await fetchLive2DFormListing(pinnedSources, expectedForm).catch(() => null);
                }
                const versionIndex = getIndexedLive2DFormMapForVersion(pinnedSources, expectedForm);
                if (versionIndex && versionIndex.size > 0) {
                    const indexedPath = versionIndex.get(cleanPath);
                    if (indexedPath) {
                        const indexedMatch = await fetchDocAt(indexedPath);
                        if (indexedMatch) {
                            return cacheMatch(indexedMatch);
                        }
                    } else if (isExplicitDirectory) {
                        // Authoritative version-pinned form listing does not contain this container.
                        return null;
                    }
                }
            }

            // 1. Direct `<path>.asset.json` lookup (skipped when trailing `/` explicitly marks a directory)
            if (!isExplicitDirectory) {
                const direct = await fetchDocAt(cleanPath);
                if (direct) {
                    return cacheMatch(direct);
                }
            }

            // 2. Bounded directory walk (depth <= 12), prioritizing `build*data.asset.json`
            const queue: Array<{ dir: string; depth: number }> = [{ dir: cleanPath, depth: 0 }];
            const visited = new Set<string>([cleanPath]);
            let inspectedDirs = 0;

            while (queue.length > 0 && inspectedDirs < MAX_ASSET_WALK_DIRS) {
                const current = queue.shift()!;
                inspectedDirs += 1;
                const listUrl = applyProxy(`${baseUrl}/${encodePathSegments(current.dir)}/`, proxy);
                const listing = await fetchListingJson(listUrl);
                if (!listing) continue;

                const stems: string[] = [];
                for (const file of listing.files) {
                    if (file.name.toLowerCase().endsWith(".asset.json")) {
                        const stem = file.name.slice(0, -".asset.json".length);
                        if (stem) stems.push(stem);
                    }
                }

                for (const stem of sortAssetCandidateStems(stems)) {
                    const candidatePath = `${current.dir}/${stem}`;
                    const match = await fetchDocAt(candidatePath);
                    if (match) {
                        return cacheMatch(match);
                    }
                }

                if (current.depth < MAX_ASSET_WALK_DEPTH) {
                    for (const sub of listing.directories) {
                        if (!sub || sub === "." || sub === ".." || sub.includes("/")) continue;
                        const nextDir = `${current.dir}/${sub}`;
                        if (visited.has(nextDir)) continue;
                        visited.add(nextDir);
                        queue.push({ dir: nextDir, depth: current.depth + 1 });
                    }
                }
            }

            return null;
        })().finally(() => {
            assetDocInflight.delete(inflightKey);
        });
        assetDocInflight.set(inflightKey, pending);
    }

    return withAbortSignal(pending, signal);
}

/**
 * Extracts sorted body motion and facial clip names from a `live2d-motions` `.asset.json`
 * document's `members` (`motion/<name>`, `facial/<name>`).
 */
export function extractLive2DMotionClips(doc: AssetSiteDocument): { motions: string[]; facials: string[] } {
    const motions = new Set<string>();
    const facials = new Set<string>();
    for (const member of doc.members ?? []) {
        const role = typeof member?.role === "string" ? member.role : "";
        if (role.startsWith("motion/")) {
            const name = role.slice("motion/".length);
            if (name) motions.add(name);
        } else if (role.startsWith("facial/")) {
            const name = role.slice("facial/".length);
            if (name) facials.add(name);
        }
    }
    return {
        motions: [...motions].sort(compareStrings),
        facials: [...facials].sort(compareStrings),
    };
}

/** Clears cached `published_version`, form-listing index, and `.asset.json` resolution entries (primarily for tests). */
export function clearLive2DSiteCache(): void {
    versionCache.clear();
    versionInflight.clear();
    assetDocCache.clear();
    assetDocInflight.clear();
    formAssetIndexByVersion.clear();
    formAssetIndexLatest.clear();
    formListingInflight.clear();
    formListingUnavailable.clear();
}
