/**
 * Pure PJSK CDN asset URL builders and decoupled masterdata fetcher.
 *
 * Defaults to Moesekai's public CORS `*` CDN (`storage.pjsk.moe`, `storage.exmeaning.com`,
 * `metadata.pjsk.moe`, `metadata.exmeaning.com`, `moe.exmeaning.com`) with runtime overrides
 * via `configureStoryCore(...)`. Zero Next.js / React / localStorage hard coupling.
 */
import { ASSET_DOMAIN_BACKUP, ASSET_DOMAIN_MAIN } from "./assetDomains";
import { getCoreFetch, getStoryCoreConfig, type AssetLine } from "./config";
import type { StoryRegion } from "./types/storyMaker";

export { ASSET_DOMAIN_BACKUP, ASSET_DOMAIN_MAIN };
export type { AssetLine };

/**
 * Asset source identifier: either a bare CDN line (`"main"` | `"backup"`) or a region-qualified
 * line (`"main-jp"`, `"backup-cn"`, etc.).
 */
export type AssetSourceType =
    | AssetLine
    | `${AssetLine}-${StoryRegion}`;

export const MOE_STATIC_BASE_URL = "https://moe.exmeaning.com";
export const MOE_ASSETS_BASE_URL = `${MOE_STATIC_BASE_URL}/assets`;
export const MOE_LOGO_URL = `${MOE_ASSETS_BASE_URL}/logo.svg`;

export function getAssetLine(source: AssetSourceType | string): AssetLine {
    return source.startsWith("backup") ? "backup" : "main";
}

/** The asset site of the source's line (respecting `configureStoryCore` overrides). */
export function getAssetDomain(source: AssetSourceType | string): string {
    const cfg = getStoryCoreConfig();
    return getAssetLine(source) === "main" ? cfg.assetDomainMain : cfg.assetDomainBackup;
}

/** The game server a source reads: its own suffix, or `config.defaultRegion`. */
export function getAssetRegion(source: AssetSourceType | string): string {
    const hyphenIndex = source.indexOf("-");
    return hyphenIndex !== -1 ? source.substring(hyphenIndex + 1) : getStoryCoreConfig().defaultRegion;
}

export function getAssetBaseUrl(source: AssetSourceType | string): string {
    return `${getAssetDomain(source)}/sekai-${getAssetRegion(source)}-assets`;
}

/** The canonical view of the source's server: every asset in its own form, such as models as GLB. */
export function getCanonicalBaseUrl(source: AssetSourceType | string): string {
    return `${getAssetDomain(source)}/${getAssetRegion(source)}`;
}

function buildImageAssetUrl(source: AssetSourceType | string, assetPath: string): string {
    return `${getAssetBaseUrl(source)}/${assetPath}.webp`;
}

function buildAudioAssetUrl(source: AssetSourceType | string, assetPath: string): string {
    return `${getAssetBaseUrl(source)}/${assetPath}.mp3`;
}

function buildJsonAssetUrl(source: AssetSourceType | string, assetPath: string): string {
    return `${getAssetBaseUrl(source)}/${assetPath}.json`;
}

/** The lossless PNG beside a WebP image of the asset site; any other image stays as it is. */
export function getLosslessImageUrl(url: string): string {
    const cfg = getStoryCoreConfig();
    const domains = [cfg.assetDomainMain, cfg.assetDomainBackup, ASSET_DOMAIN_MAIN, ASSET_DOMAIN_BACKUP];
    const onAssetSite = domains.some(domain => url.startsWith(`${domain}/`));
    return onAssetSite && url.endsWith(".webp") ? `${url.slice(0, -".webp".length)}.png` : url;
}

export function buildRawAssetUrl(source: AssetSourceType | string, assetPath: string): string {
    return `${getAssetBaseUrl(source)}/${assetPath.replace(/^\/+/, "")}`;
}

export function getAssetSourceFallbackOrder(source: AssetSourceType): AssetSourceType[] {
    const base: AssetLine = source.startsWith("backup") ? "backup" : "main";
    const fallback: AssetLine = base === "main" ? "backup" : "main";

    const hyphenIndex = source.indexOf("-");
    if (hyphenIndex !== -1) {
        const region = source.substring(hyphenIndex + 1) as StoryRegion;
        return [source, `${fallback}-${region}`];
    }

    return [source, fallback];
}

// ==================== Character & Unit Icons ====================

export function getCharacterIconUrl(characterId: number): string {
    const base = getStoryCoreConfig().moeStaticBaseUrl;
    return `${base}/assets/chr_ts_${characterId}.png`;
}

export function getCharacterChibiIconUrl(characterId: number, source: AssetSourceType = "main-jp"): string {
    return `${getAssetDomain(source)}/client/jp/player/loose/Sprite/chr_il_${characterId}/image.png`;
}

export function getUnitLogoUrl(unitId: string, source: AssetSourceType = "main-jp"): string {
    return buildImageAssetUrl(source, `thumbnail/common/unit/${unitId}`);
}

export function getUnitOutlineLogoUrl(unitField: string, source: AssetSourceType = "main-jp"): string {
    return `${getAssetDomain(source)}/client/jp/player/common/logos_outline/logo_${unitField}.png`;
}

const UNIT_FIELD_TO_TAB_CODE: Record<string, string> = {
    light_sound: "ln",
    idol: "mj",
    street: "vb",
    theme_park: "ws",
    school_refusal: "25",
    piapro: "vs",
};

export function getUnitTabIconUrl(unitField: string, source: AssetSourceType = "main-jp"): string {
    const code = UNIT_FIELD_TO_TAB_CODE[unitField] ?? "vs";
    return `${getAssetDomain(source)}/client/jp/player/loose/Sprite/icon_tab_unit_${code}_on/image.png`;
}

// ==================== Story / Scenario Asset URLs ====================

export function getScenarioJsonUrl(scenarioPath: string, source: AssetSourceType = "main-jp"): string {
    return buildJsonAssetUrl(source, scenarioPath);
}

export function getBackgroundImageUrl(bgName: string, source: AssetSourceType = "main-jp"): string {
    return buildImageAssetUrl(source, `scenario/background/${bgName}/${bgName}`);
}

export function getStoryVoiceUrl(scenarioId: string, voiceId: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/scenario/voice/${scenarioId}/${voiceId}`);
}

export function getCardStoryVoiceUrl(scenarioId: string, voiceId: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/card_scenario/voice/${scenarioId}/${voiceId}`);
}

export function getAreaTalkVoiceUrl(scenarioId: string, voiceId: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/actionset/voice/${scenarioId}/${voiceId}`);
}

export function getSpecialStoryVoiceUrl(scenarioId: string, voiceId: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/scenario/voice/${scenarioId}/${voiceId}`);
}

export function getStoryBgmUrl(bgmName: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/scenario/bgm/${bgmName}/${bgmName}`);
}

export function getStorySoundEffectUrl(seName: string, source: AssetSourceType = "main-jp"): string {
    return buildAudioAssetUrl(source, `sound/scenario/se/${seName}`);
}

export function getStoryEpisodeImageUrl(assetbundleName: string, episodeNo: number, source: AssetSourceType = "main-jp"): string {
    const paddedNo = episodeNo.toString().padStart(2, "0");
    return buildImageAssetUrl(source, `event_story/${assetbundleName}/episode_image/${assetbundleName}_${paddedNo}`);
}

export function getUnitStoryEpisodeImageUrl(
    chapterAssetbundleName: string,
    episodeAssetbundleName: string,
    source: AssetSourceType = "main-jp",
): string {
    return buildImageAssetUrl(source, `story/episode_image/${chapterAssetbundleName}/${episodeAssetbundleName}`);
}

// ==================== Decoupled Masterdata Fetcher ====================

const masterDataMemoryCache = new Map<string, Promise<unknown>>();

export interface FetchMasterDataOptions {
    line?: AssetLine;
    signal?: AbortSignal;
    bypassCache?: boolean;
}

/**
 * Fetches a masterdata JSON file for `server` from Moesekai's public masterdata mirrors
 * (`metadata.pjsk.moe` with automatic fallback to `metadata.exmeaning.com`), or delegates
 * to a host-configured `masterDataFetcher` when set via `configureStoryCore(...)`.
 */
export function fetchMasterDataForServer<T>(
    server: StoryRegion,
    path: string,
    options: FetchMasterDataOptions = {},
): Promise<T> {
    const cfg = getStoryCoreConfig();
    if (cfg.masterDataFetcher && !options.bypassCache) {
        return cfg.masterDataFetcher<T>(server, path);
    }

    const cleanPath = path.replace(/^\/+/, "");
    const line = options.line ?? cfg.defaultAssetLine;
    const primaryDomain = line === "backup" ? cfg.masterDataDomainBackup : cfg.masterDataDomainMain;
    const fallbackDomain = line === "backup" ? cfg.masterDataDomainMain : cfg.masterDataDomainBackup;
    const cacheKey = `${server}|${line}|${primaryDomain}|${cleanPath}`;

    if (!options.bypassCache) {
        const cached = masterDataMemoryCache.get(cacheKey);
        if (cached) return cached as Promise<T>;
    }

    const urls = primaryDomain === fallbackDomain
        ? [`${primaryDomain}/${server}/master/${cleanPath}`]
        : [
            `${primaryDomain}/${server}/master/${cleanPath}`,
            `${fallbackDomain}/${server}/master/${cleanPath}`,
        ];

    const fetchFn = getCoreFetch();
    const loading = (async (): Promise<T> => {
        let lastError: unknown;
        for (const url of urls) {
            try {
                const res = await fetchFn(url, {
                    credentials: "omit",
                    headers: { Accept: "application/json" },
                    signal: options.signal,
                });
                if (!res.ok) {
                    lastError = new Error(`Failed to fetch masterdata ${url}: HTTP ${res.status}`);
                    continue;
                }
                return (await res.json()) as T;
            } catch (err) {
                lastError = err;
                if (options.signal?.aborted) throw err;
            }
        }
        throw lastError ?? new Error(`Failed to fetch masterdata ${server}/${cleanPath}`);
    })();

    if (!options.bypassCache) {
        masterDataMemoryCache.set(cacheKey, loading);
        loading.catch(() => {
            if (masterDataMemoryCache.get(cacheKey) === loading) {
                masterDataMemoryCache.delete(cacheKey);
            }
        });
    }

    return loading;
}

/** Clears the in-memory masterdata cache (useful for tests or manual refresh). */
export function clearMasterDataCache(): void {
    masterDataMemoryCache.clear();
}
