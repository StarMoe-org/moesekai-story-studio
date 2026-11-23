/**
 * Asset manifest collector, browser cache inspector, and bounded-concurrency preloader for
 * `moesekai-story/2` graph documents.
 *
 * Walks `doc.nodes` (`SceneNode` stage slots & performance beats) and preloads:
 * - Live2D canonical model `.asset.json` (`moc`, optional `physics`, `texture/*`) and referenced
 *   `live2d-motions` `.asset.json` + used motion/facial clip members (including `stageCast`,
 *   `talk`, `talk.reactions`, and `stageAction`) into Cache API `"sekai-live2d-v2"` keyed by exact
 *   version-pinned URLs matching `SekaiLive2DViewer` / `SekaiLive2DStage` 0.2.x workers.
 * - Story backgrounds via `new Image()` (`crossOrigin = "anonymous"`) + `img.decode()`.
 * - Story BGM into browser HTTP cache, and SE / Voice clips into both HTTP cache and the shared
 *   Web Audio `AudioBuffer` LRU cache (`audioCache.ts`).
 * - In-game scenario UI Kit into Cache API `"sse-ui-kit-v1"` via `loadStoryUiKit()`.
 */
import { getCoreFetch, getStoryCoreConfig } from "../config";
import { getAssetLine, type AssetLine, type AssetSourceType } from "../pjskAssets";
import { fetchLive2DModels } from "../live2d/client";
import { live2dFetchUrl, live2dSources, type Live2DSources } from "../live2d/config";
import { inferLive2DMotionBundleCandidates, type Live2DModel } from "../live2d/models";
import {
    getCachedLive2DAssetDocument,
    getCachedLive2DSiteBase,
    live2dMemberUrl,
    live2dSiteListingUrl,
    resolveLive2DAssetDocument,
    resolveLive2DPublishedVersion,
    resolveLive2DSiteBase,
    type AssetSiteMember,
    type ResolvedLive2DAssetDocument,
} from "../live2d/site";
import type { StoryDocument, StoryVoiceManifest, StoryVoiceRef } from "../types/storyMaker";
import {
    storyBackgroundUrl, storyBgmUrl, storySeCandidateUrls, storyVoiceCandidateUrls,
} from "./assets";
import { resolveVoiceManifestLineUrl } from "./i18nPack";
import { decodeStoryAudio, getCachedStoryAudio, getSharedAudioContext } from "./audioCache";
import { isStoryUiKitSupported, loadStoryUiKit } from "./uiKit";

export const LIVE2D_CACHE_NAME = "sekai-live2d-v2";
const UIKIT_CACHE_NAME = "sse-ui-kit-v1";
const PRELOAD_CONCURRENCY = 4;

/** In-session record of custom-protocol (e.g. `moesekai-cache://`) models fully warmed. */
const warmedCustomProtocolAssets = new Set<string>();

function isBrowserCacheableUrl(url: string): boolean {
    return /^https?:\/\//i.test(url) || url.startsWith("/");
}

function cacheUrlStartsWith(url: string, prefix: string): boolean {
    if (url.startsWith(prefix)) return true;
    if (prefix.startsWith("/")) {
        try {
            return new URL(url).pathname.startsWith(prefix);
        } catch {
            return false;
        }
    }
    return false;
}

function cacheUrlEquals(url: string, target: string): boolean {
    if (url === target) return true;
    if (target.startsWith("/")) {
        try {
            return new URL(url).pathname === target;
        } catch {
            return false;
        }
    }
    return false;
}

function isCustomCacheHit(response: Response): boolean {
    const header = response.headers?.get?.("x-moesekai-cache")?.trim().toUpperCase();
    return header === "HIT" || header === "STALE";
}

/** Clears in-session custom-protocol preload tracking (primarily for tests). */
export function clearPreloaderSessionCache(): void {
    warmedCustomProtocolAssets.clear();
}

export type StoryPreloadCategory = "live2d" | "background" | "audio" | "uikit";

export interface StoryPreloadLive2DItem {
    modelId: string;
    /** Canonical model asset path (`live2d/model/<id>`). */
    asset: string;
    /** Canonical motion asset path (`live2d/motion/<set>`), or `null`. */
    motionAsset: string | null;
    motions: string[];
    facials: string[];
}

export interface StoryPreloadBackgroundItem {
    name: string;
    url: string;
}

export interface StoryPreloadAudioItem {
    kind: "bgm" | "se" | "voice";
    label: string;
    urls: string[];
    voice?: StoryVoiceRef;
}

export interface StoryPreloadManifest {
    live2dSources: Live2DSources;
    live2d: StoryPreloadLive2DItem[];
    backgrounds: StoryPreloadBackgroundItem[];
    bgm: StoryPreloadAudioItem[];
    se: StoryPreloadAudioItem[];
    voices: StoryPreloadAudioItem[];
    includeUiKit: boolean;
    counts: {
        live2d: number;
        background: number;
        audio: number;
        uikit: number;
        total: number;
    };
}

export interface StoryPreloadCategoryProgress {
    completed: number;
    cached: number;
    failed: number;
    total: number;
}

export interface StoryPreloadProgress {
    total: number;
    completed: number;
    cached: number;
    failed: number;
    currentCategory: StoryPreloadCategory | null;
    currentLabel: string;
    byCategory: Record<StoryPreloadCategory, StoryPreloadCategoryProgress>;
    done: boolean;
    aborted: boolean;
}

export interface CollectStoryAssetsOptions {
    /** Asset line (`"main"` | `"backup"`) or full `AssetSourceType`. Defaults to active config `defaultAssetLine`. */
    assetSource?: AssetSourceType | AssetLine;
    /** Canonical Live2D asset-site sources (defaults to `live2dSources(doc.region, line)`). */
    live2dSources?: Live2DSources;
    /** Optional Live2D model catalog for exact `asset` & `motionAsset` resolution. */
    models?: readonly Live2DModel[] | null;
    /** Optional custom voice track manifest (`moesekai-story-voice/1`) for audio preloading. */
    voiceManifest?: StoryVoiceManifest | null;
    /** Include the in-game UI Kit in the manifest (default `true`). */
    includeUiKit?: boolean;
    /** Optional host callback checking whether custom-protocol URL prefixes are cached locally. */
    checkCachedUrlPrefixes?: (prefixes: readonly string[]) => Promise<boolean[]> | boolean[];
}

export interface PreloadStoryAssetsOptions extends CollectStoryAssetsOptions {
    /** Decode SE & voice clips into the shared Web Audio buffer cache (default `true`). */
    decodeAudio?: boolean;
    /** Progress callback invoked incrementally after every asset settles. */
    onProgress?: (progress: StoryPreloadProgress) => void;
    /** Optional cancellation signal. */
    signal?: AbortSignal;
}

export interface StoryCacheStatus {
    live2dCachedModels: number;
    live2dTotalModels: number;
    audioDecodedCount: number;
    audioTotalDecodable: number;
    uikitCached: boolean;
    /** True when local browser caches already hold at least all Live2D models (or UI kit when cast is empty). */
    hasLocalCache: boolean;
}

interface Live2DFileTask {
    modelAsset: string;
    url: string;
    label: string;
}

function encodePath(path: string): string {
    return path.trim().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function warmedKey(sources: Live2DSources, asset: string): string {
    return `${sources.site.replace(/\/+$/, "")}|${sources.region}|${asset}`;
}

function modelMemberOrder(role: string): number {
    if (role === "moc") return 0;
    if (role === "physics") return 1;
    const tex = /^texture\/(\d+)$/.exec(role);
    if (tex) return 10 + Number(tex[1]);
    return 1_000_000;
}

function selectModelMembers(members: readonly AssetSiteMember[]): AssetSiteMember[] {
    return members
        .filter(m => m.role === "moc" || m.role === "physics" || m.role.startsWith("texture/"))
        .sort((a, b) => modelMemberOrder(a.role) - modelMemberOrder(b.role) || compareStrings(a.role, b.role));
}

function pickDefaultClipMember(
    clips: Map<string, AssetSiteMember>,
    patterns: readonly RegExp[],
): AssetSiteMember | undefined {
    for (const pattern of patterns) {
        for (const [name, member] of clips.entries()) {
            if (pattern.test(name)) return member;
        }
    }
    return clips.values().next().value;
}

/**
 * Purely collects and deduplicates all Live2D models/clips, backgrounds, BGM, SE, voice clips,
 * and UI kit entries referenced by a `moesekai-story/2` document's `SceneNode`s.
 */
export function collectStoryAssets(
    doc: StoryDocument,
    options: CollectStoryAssetsOptions = {},
): StoryPreloadManifest {
    const line: AssetLine = getAssetLine((options.assetSource ?? getStoryCoreConfig().defaultAssetLine) as AssetSourceType);
    const resolvedSources: Live2DSources = options.live2dSources ?? live2dSources(doc.region, line);
    const includeUiKit = options.includeUiKit !== false;

    const modelById = new Map<string, Live2DModel>();
    for (const model of options.models ?? []) {
        modelById.set(model.id, model);
    }

    const castModelByKey = new Map<string, string>();
    const live2dMap = new Map<string, {
        modelId: string;
        asset: string;
        motionAsset: string | null;
        motions: Set<string>;
        facials: Set<string>;
    }>();

    for (const member of doc.cast) {
        if (!member.modelId) continue;
        castModelByKey.set(member.key, member.modelId);
        if (!live2dMap.has(member.modelId)) {
            const indexed = modelById.get(member.modelId);
            live2dMap.set(member.modelId, {
                modelId: member.modelId,
                asset: indexed?.asset ?? `live2d/model/${member.modelId}`,
                motionAsset: indexed ? (indexed.motion ?? indexed.motions?.[0] ?? null) : null,
                motions: new Set<string>(),
                facials: new Set<string>(),
            });
        }
    }

    const recordClips = (castKey: string | undefined, motion?: string, facial?: string) => {
        if (!castKey) return;
        const modelId = castModelByKey.get(castKey);
        const entry = modelId ? live2dMap.get(modelId) : undefined;
        if (!entry) return;
        if (motion) entry.motions.add(motion);
        if (facial) entry.facials.add(facial);
    };

    const bgSeen = new Set<string>();
    const backgrounds: StoryPreloadBackgroundItem[] = [];
    const bgmSeen = new Set<string>();
    const bgm: StoryPreloadAudioItem[] = [];
    const seSeen = new Set<string>();
    const se: StoryPreloadAudioItem[] = [];
    const voiceSeen = new Set<string>();
    const voices: StoryPreloadAudioItem[] = [];

    const recordSe = (name: string | undefined) => {
        if (!name || seSeen.has(name)) return;
        seSeen.add(name);
        const urls = storySeCandidateUrls(name, doc.region, line);
        if (urls.length > 0) {
            se.push({ kind: "se", label: name, urls });
        }
    };

    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "scene") continue;

        // 1. Background slot
        if (node.background.mode === "set" && node.background.asset) {
            const url = storyBackgroundUrl(node.background.asset, doc.region, line);
            if (!bgSeen.has(url)) {
                bgSeen.add(url);
                backgrounds.push({ name: node.background.asset, url });
            }
        }

        // 2. BGM slot
        if (node.bgm.mode === "play" && node.bgm.name) {
            const url = storyBgmUrl(node.bgm.name, doc.region, line);
            if (!bgmSeen.has(url)) {
                bgmSeen.add(url);
                bgm.push({ kind: "bgm", label: node.bgm.name, urls: [url] });
            }
        }

        // 3. StageCast slot clips
        if (node.stageCast.mode === "set") {
            for (const actor of node.stageCast.actors) {
                recordClips(actor.castKey, actor.motion, actor.facial);
            }
        }

        // 4. Performance beats
        for (const beat of node.beats) {
            switch (beat.kind) {
                case "talk": {
                    recordClips(beat.speakerKey, beat.motion, beat.facial);
                    for (const reaction of beat.reactions ?? []) {
                        recordClips(reaction.castKey, reaction.motion, reaction.facial);
                    }
                    if (beat.voice && beat.voice.scenarioId && beat.voice.voiceId) {
                        const effectiveRegion = beat.voice.region ?? doc.region;
                        const key = `${beat.voice.kind}|${effectiveRegion}|${beat.voice.scenarioId}|${beat.voice.voiceId}`;
                        if (!voiceSeen.has(key)) {
                            voiceSeen.add(key);
                            const urls = storyVoiceCandidateUrls(beat.voice, doc.region, line);
                            if (urls.length > 0) {
                                voices.push({
                                    kind: "voice",
                                    label: beat.voice.voiceId,
                                    urls,
                                    voice: beat.voice,
                                });
                            }
                        }
                    } else if (options.voiceManifest) {
                        const trackUrls = resolveVoiceManifestLineUrl(options.voiceManifest, beat.id);
                        const trackLine = options.voiceManifest.lines[beat.id];
                        if (trackUrls.length > 0 && trackLine) {
                            const key = `voice-track|${trackLine.audioHash || trackUrls[0]}`;
                            if (!voiceSeen.has(key)) {
                                voiceSeen.add(key);
                                voices.push({
                                    kind: "voice",
                                    label: trackLine.speaker || beat.id,
                                    urls: trackUrls,
                                });
                            }
                        }
                    }
                    recordSe(beat.se);
                    break;
                }
                case "narration": {
                    recordSe(beat.se);
                    break;
                }
                case "stageAction": {
                    recordClips(beat.castKey, beat.motion, beat.facial);
                    break;
                }
                case "cue": {
                    if (beat.cueType === "se") recordSe(beat.se);
                    break;
                }
                default:
                    break;
            }
        }
    }

    const live2d: StoryPreloadLive2DItem[] = [...live2dMap.values()].map((item) => ({
        modelId: item.modelId,
        asset: item.asset,
        motionAsset: item.motionAsset,
        motions: [...item.motions].sort(compareStrings),
        facials: [...item.facials].sort(compareStrings),
    }));

    const counts = {
        live2d: live2d.length,
        background: backgrounds.length,
        audio: bgm.length + se.length + voices.length,
        uikit: includeUiKit ? 1 : 0,
        total: live2d.length + backgrounds.length + bgm.length + se.length + voices.length + (includeUiKit ? 1 : 0),
    };

    return {
        live2dSources: resolvedSources,
        live2d,
        backgrounds,
        bgm,
        se,
        voices,
        includeUiKit,
        counts,
    };
}

async function openCacheSafe(name: string): Promise<Cache | null> {
    if (typeof caches === "undefined") return null;
    try {
        return await caches.open(name);
    } catch {
        return null;
    }
}

async function runPool<T>(
    items: readonly T[],
    concurrency: number,
    signal: AbortSignal | undefined,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length && !signal?.aborted) {
            const index = cursor++;
            await worker(items[index]);
        }
    });
    await Promise.all(workers);
}

async function preloadImage(url: string, signal?: AbortSignal): Promise<"cached" | "fetched" | "failed" | "aborted"> {
    if (signal?.aborted) return "aborted";
    if (typeof Image === "undefined") {
        // Non-DOM fallback: warm HTTP / custom-protocol cache directly.
        try {
            const res = await getCoreFetch()(url, { mode: "cors", credentials: "omit", signal });
            if (!res.ok) return "failed";
            await res.arrayBuffer();
            if (signal?.aborted) return "aborted";
            return isCustomCacheHit(res) ? "cached" : "fetched";
        } catch {
            return signal?.aborted ? "aborted" : "failed";
        }
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        let settled = false;
        const finish = (status: "fetched" | "failed" | "aborted") => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            img.onload = null;
            img.onerror = null;
            resolve(status);
        };
        const onAbort = () => {
            img.src = "";
            finish("aborted");
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const onLoaded = () => {
            if (typeof img.decode === "function") {
                img.decode().then(() => finish("fetched"), () => finish("fetched"));
            } else {
                finish("fetched");
            }
        };
        img.onload = onLoaded;
        img.onerror = () => finish("failed");
        img.src = url;
        if (img.complete && img.naturalWidth > 0) {
            onLoaded();
        }
    });
}

async function warmHttpAudio(urls: readonly string[], signal?: AbortSignal): Promise<"cached" | "fetched" | "failed" | "aborted"> {
    const fetchFn = getCoreFetch();
    for (const url of urls) {
        if (signal?.aborted) return "aborted";
        try {
            const response = await fetchFn(url, { mode: "cors", credentials: "omit", signal });
            if (!response.ok) continue;
            await response.arrayBuffer();
            if (signal?.aborted) return "aborted";
            return isCustomCacheHit(response) ? "cached" : "fetched";
        } catch {
            if (signal?.aborted) return "aborted";
        }
    }
    return signal?.aborted ? "aborted" : "failed";
}

function cloneProgress(state: StoryPreloadProgress): StoryPreloadProgress {
    return {
        ...state,
        byCategory: {
            live2d: { ...state.byCategory.live2d },
            background: { ...state.byCategory.background },
            audio: { ...state.byCategory.audio },
            uikit: { ...state.byCategory.uikit },
        },
    };
}

async function storeAssetDocInBrowserCache(cache: Cache | null, resolved: ResolvedLive2DAssetDocument): Promise<void> {
    if (!cache) return;
    try {
        const existing = await cache.match(resolved.url);
        if (!existing) {
            await cache.put(
                resolved.url,
                new Response(JSON.stringify(resolved.doc), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        }
    } catch {
        // Ignore private-mode / quota Cache API failures.
    }
}

async function resolveMotionDocForItem(
    pinnedSources: Live2DSources,
    item: StoryPreloadLive2DItem,
    signal?: AbortSignal,
): Promise<ResolvedLive2DAssetDocument | null> {
    const candidates: string[] = [];
    if (item.motionAsset) candidates.push(item.motionAsset);
    if (item.motions.length > 0 || item.facials.length > 0) {
        for (const inferred of inferLive2DMotionBundleCandidates(item.modelId)) {
            if (!candidates.includes(inferred)) candidates.push(inferred);
        }
    }
    for (const candidate of candidates) {
        if (signal?.aborted) return null;
        try {
            const resolved = await resolveLive2DAssetDocument(pinnedSources, candidate, "live2d-motions", signal);
            if (resolved) return resolved;
        } catch {
            // Try next candidate
        }
    }
    return null;
}

/**
 * Preloads all assets referenced by `doc` into persistent browser caches (`sekai-live2d-v2`,
 * `sse-ui-kit-v1`, HTTP cache, decoded image cache, and shared Web Audio LRU cache) with
 * bounded concurrency and incremental `onProgress` callbacks.
 */
export async function preloadStoryAssets(
    doc: StoryDocument,
    options: PreloadStoryAssetsOptions = {},
): Promise<StoryPreloadProgress> {
    const { onProgress, signal, decodeAudio = true } = options;

    let models = options.models;
    if ((!models || models.length === 0) && doc.cast.length > 0 && !signal?.aborted) {
        models = await fetchLive2DModels(doc.region, signal).catch(() => null);
    }

    const manifest = collectStoryAssets(doc, { ...options, models });
    const state: StoryPreloadProgress = {
        total: manifest.counts.total,
        completed: 0,
        cached: 0,
        failed: 0,
        currentCategory: null,
        currentLabel: "",
        byCategory: {
            live2d: { completed: 0, cached: 0, failed: 0, total: manifest.counts.live2d },
            background: { completed: 0, cached: 0, failed: 0, total: manifest.counts.background },
            audio: { completed: 0, cached: 0, failed: 0, total: manifest.counts.audio },
            uikit: { completed: 0, cached: 0, failed: 0, total: manifest.counts.uikit },
        },
        done: false,
        aborted: Boolean(signal?.aborted),
    };

    const emit = () => {
        state.total =
            state.byCategory.live2d.total
            + state.byCategory.background.total
            + state.byCategory.audio.total
            + state.byCategory.uikit.total;
        state.completed =
            state.byCategory.live2d.completed
            + state.byCategory.background.completed
            + state.byCategory.audio.completed
            + state.byCategory.uikit.completed;
        state.cached =
            state.byCategory.live2d.cached
            + state.byCategory.background.cached
            + state.byCategory.audio.cached
            + state.byCategory.uikit.cached;
        state.failed =
            state.byCategory.live2d.failed
            + state.byCategory.background.failed
            + state.byCategory.audio.failed
            + state.byCategory.uikit.failed;
        onProgress?.(cloneProgress(state));
    };

    const recordResult = (
        category: StoryPreloadCategory,
        label: string,
        outcome: "cached" | "fetched" | "failed" | "aborted",
    ) => {
        if (outcome === "aborted") {
            state.aborted = true;
            return;
        }
        state.currentCategory = category;
        state.currentLabel = label;
        const bucket = state.byCategory[category];
        bucket.completed += 1;
        if (outcome === "cached") bucket.cached += 1;
        else if (outcome === "failed") bucket.failed += 1;
        emit();
    };

    if (signal?.aborted) {
        state.aborted = true;
        emit();
        return cloneProgress(state);
    }

    emit();

    const sampleSiteUrl = live2dSiteListingUrl(manifest.live2dSources);
    const useBrowserLive2DCache = isBrowserCacheableUrl(sampleSiteUrl);
    const live2dCache = useBrowserLive2DCache && manifest.live2d.length > 0
        ? await openCacheSafe(LIVE2D_CACHE_NAME)
        : null;

    const live2dTasks: Live2DFileTask[] = [];
    const seenLive2DUrls = new Set<string>();
    let failedLive2DManifests = 0;

    if (manifest.live2d.length > 0 && !signal?.aborted) {
        let pinnedSources: Live2DSources | null = null;
        try {
            const resolvedBase = await resolveLive2DSiteBase(manifest.live2dSources, signal);
            const version = manifest.live2dSources.version?.trim()
                || (await resolveLive2DPublishedVersion(manifest.live2dSources, signal));
            const atIdx = resolvedBase.lastIndexOf(`/${encodeURIComponent(manifest.live2dSources.region)}@`);
            const effectiveSite = atIdx >= 0 ? (resolvedBase.slice(0, atIdx) || "/") : manifest.live2dSources.site;
            pinnedSources = {
                ...manifest.live2dSources,
                site: effectiveSite,
                version,
            };
        } catch {
            pinnedSources = null;
        }

        if (!pinnedSources) {
            if (!signal?.aborted) {
                failedLive2DManifests = manifest.live2d.length;
            }
        } else {
            const activeSources = pinnedSources;
            await runPool(manifest.live2d, PRELOAD_CONCURRENCY, signal, async (item) => {
                const [modelResolved, motionResolved] = await Promise.all([
                    resolveLive2DAssetDocument(activeSources, item.asset, "live2d-model", signal).catch(() => null),
                    resolveMotionDocForItem(activeSources, item, signal),
                ]);
                if (signal?.aborted) return;
                if (!modelResolved) {
                    failedLive2DManifests += 1;
                    return;
                }

                await storeAssetDocInBrowserCache(live2dCache, modelResolved);

                for (const member of selectModelMembers(modelResolved.doc.members)) {
                    const url = live2dMemberUrl(
                        modelResolved.baseUrl,
                        modelResolved.doc.name,
                        member,
                        modelResolved.proxy,
                    );
                    if (seenLive2DUrls.has(url)) continue;
                    seenLive2DUrls.add(url);
                    live2dTasks.push({
                        modelAsset: item.asset,
                        url,
                        label: `${item.modelId}/${member.role}.${member.extension}`,
                    });
                }

                if (motionResolved) {
                    await storeAssetDocInBrowserCache(live2dCache, motionResolved);
                    const motionMembers = new Map<string, AssetSiteMember>();
                    const facialMembers = new Map<string, AssetSiteMember>();
                    for (const member of motionResolved.doc.members) {
                        if (member.role.startsWith("motion/")) {
                            motionMembers.set(member.role.slice("motion/".length), member);
                        } else if (member.role.startsWith("facial/")) {
                            facialMembers.set(member.role.slice("facial/".length), member);
                        }
                    }

                    const wantedMembers: AssetSiteMember[] = [];
                    const wantedRoles = new Set<string>();
                    const addMember = (member: AssetSiteMember | undefined) => {
                        if (!member || wantedRoles.has(member.role)) return;
                        wantedRoles.add(member.role);
                        wantedMembers.push(member);
                    };

                    for (const m of item.motions) addMember(motionMembers.get(m));
                    for (const f of item.facials) addMember(facialMembers.get(f));
                    addMember(pickDefaultClipMember(motionMembers, [/normal01$/i, /idle/i]));
                    addMember(pickDefaultClipMember(facialMembers, [/^face_normal_01$/i, /^face_normal/i]));

                    for (const member of wantedMembers) {
                        const url = live2dMemberUrl(
                            motionResolved.baseUrl,
                            motionResolved.doc.name,
                            member,
                            motionResolved.proxy,
                        );
                        if (seenLive2DUrls.has(url)) continue;
                        seenLive2DUrls.add(url);
                        live2dTasks.push({
                            modelAsset: item.asset,
                            url,
                            label: `${item.modelId}/${member.role}.${member.extension}`,
                        });
                    }
                }
            });
        }

        state.byCategory.live2d.total = live2dTasks.length + failedLive2DManifests;
        if (failedLive2DManifests > 0) {
            state.byCategory.live2d.completed += failedLive2DManifests;
            state.byCategory.live2d.failed += failedLive2DManifests;
        }
        emit();
    }

    const canDecodeAudio = decodeAudio && typeof window !== "undefined" && getSharedAudioContext() !== null;
    const fetchFn = getCoreFetch();

    // Track per-model outcomes when running over custom protocols (e.g. `moesekai-cache://`)
    // so `inspectStoryCacheStatus()` reflects warmed models immediately without Cache Storage API.
    const customModelCounts = new Map<string, { remaining: number; failed: boolean }>();
    if (!useBrowserLive2DCache) {
        for (const file of live2dTasks) {
            const entry = customModelCounts.get(file.modelAsset) ?? { remaining: 0, failed: false };
            entry.remaining += 1;
            customModelCounts.set(file.modelAsset, entry);
        }
    }
    const markCustomModelFile = (modelAsset: string, succeeded: boolean) => {
        if (useBrowserLive2DCache) return;
        const entry = customModelCounts.get(modelAsset);
        if (!entry) return;
        if (!succeeded) entry.failed = true;
        entry.remaining -= 1;
        if (entry.remaining <= 0 && !entry.failed) {
            warmedCustomProtocolAssets.add(warmedKey(manifest.live2dSources, modelAsset));
        }
    };

    type WorkItem = () => Promise<void>;
    const tasks: WorkItem[] = [];

    for (const file of live2dTasks) {
        tasks.push(async () => {
            if (signal?.aborted) return;
            if (useBrowserLive2DCache) {
                try {
                    const hit = await live2dCache?.match(file.url);
                    if (hit) {
                        recordResult("live2d", file.label, "cached");
                        return;
                    }
                } catch {
                    // fall through to network fetch
                }
            }
            try {
                const response = await fetchFn(file.url, { mode: "cors", credentials: "omit", signal });
                if (!response.ok) {
                    markCustomModelFile(file.modelAsset, false);
                    recordResult("live2d", file.label, "failed");
                    return;
                }
                const bytes = await response.arrayBuffer();
                if (signal?.aborted) {
                    markCustomModelFile(file.modelAsset, false);
                    recordResult("live2d", file.label, "aborted");
                    return;
                }
                if (useBrowserLive2DCache) {
                    await live2dCache?.put(file.url, new Response(bytes)).catch(() => undefined);
                    recordResult("live2d", file.label, "fetched");
                } else {
                    markCustomModelFile(file.modelAsset, true);
                    recordResult("live2d", file.label, isCustomCacheHit(response) ? "cached" : "fetched");
                }
            } catch {
                markCustomModelFile(file.modelAsset, false);
                recordResult("live2d", file.label, signal?.aborted ? "aborted" : "failed");
            }
        });
    }

    for (const bg of manifest.backgrounds) {
        tasks.push(async () => {
            const outcome = await preloadImage(bg.url, signal);
            recordResult("background", bg.name, outcome);
        });
    }

    for (const track of manifest.bgm) {
        tasks.push(async () => {
            const outcome = await warmHttpAudio(track.urls, signal);
            recordResult("audio", track.label, outcome);
        });
    }

    for (const clip of [...manifest.se, ...manifest.voices]) {
        tasks.push(async () => {
            if (signal?.aborted) return;
            if (canDecodeAudio) {
                if (clip.urls.some(u => getCachedStoryAudio(u) !== null)) {
                    recordResult("audio", clip.label, "cached");
                    return;
                }
                const decoded = await decodeStoryAudio(clip.urls, signal);
                if (signal?.aborted) {
                    recordResult("audio", clip.label, "aborted");
                    return;
                }
                recordResult("audio", clip.label, decoded ? "fetched" : "failed");
                return;
            }
            const outcome = await warmHttpAudio(clip.urls, signal);
            recordResult("audio", clip.label, outcome);
        });
    }

    if (manifest.includeUiKit) {
        const uiKitSupported = await isStoryUiKitSupported();
        if (!uiKitSupported) {
            state.byCategory.uikit.total = 0;
            emit();
        } else {
            tasks.push(async () => {
                if (signal?.aborted) return;
                const kit = await loadStoryUiKit(doc.region, signal).catch(() => null);
                if (signal?.aborted) {
                    kit?.release();
                    recordResult("uikit", "UI Kit", "aborted");
                    return;
                }
                if (kit) {
                    const outcome = kit.cached ? "cached" : "fetched";
                    kit.release();
                    recordResult("uikit", "UI Kit", outcome);
                } else {
                    recordResult("uikit", "UI Kit", "failed");
                }
            });
        }
    }

    await runPool(tasks, PRELOAD_CONCURRENCY, signal, async (task) => task());

    state.aborted = Boolean(signal?.aborted);
    state.done = !state.aborted;
    emit();
    return cloneProgress(state);
}

/**
 * Inspects local Cache API (`sekai-live2d-v2`, `sse-ui-kit-v1`), custom-protocol disk cache
 * probes (`moesekai-cache://` / `checkCachedUrlPrefixes`), and in-memory decoded audio cache.
 */
export async function inspectStoryCacheStatus(
    doc: StoryDocument,
    options: CollectStoryAssetsOptions = {},
): Promise<StoryCacheStatus> {
    const manifest = collectStoryAssets(doc, options);
    let live2dCachedModels = 0;
    let uikitCached = false;

    const sampleSiteUrl = live2dSiteListingUrl(manifest.live2dSources);
    const useBrowserLive2DCache = isBrowserCacheableUrl(sampleSiteUrl);
    const cachedBase = getCachedLive2DSiteBase(manifest.live2dSources);

    if (manifest.live2d.length > 0) {
        if (useBrowserLive2DCache && typeof caches !== "undefined") {
            try {
                if (await caches.has(LIVE2D_CACHE_NAME)) {
                    const cache = await caches.open(LIVE2D_CACHE_NAME);
                    const keys = await cache.keys();
                    const urls = keys.map(req => req.url);
                    const cleanSite = manifest.live2dSources.site.replace(/\/+$/, "");
                    const regionVersionPrefix = live2dFetchUrl(
                        `${cleanSite}/${encodeURIComponent(manifest.live2dSources.region)}@`,
                        manifest.live2dSources.proxy ?? null,
                    );
                    for (const item of manifest.live2d) {
                        const encodedAsset = encodePath(item.asset);
                        const hit = cachedBase
                            ? urls.some((u) => {
                                const exactPrefix = live2dFetchUrl(
                                    `${cachedBase.baseUrl}/${encodedAsset}/`,
                                    cachedBase.proxy ?? null,
                                );
                                const exactDoc = live2dFetchUrl(
                                    `${cachedBase.baseUrl}/${encodedAsset}.asset.json`,
                                    cachedBase.proxy ?? null,
                                );
                                return cacheUrlStartsWith(u, exactPrefix) || cacheUrlEquals(u, exactDoc);
                            })
                            : urls.some((u) =>
                                cacheUrlStartsWith(u, regionVersionPrefix)
                                && (u.includes(`/${encodedAsset}/`) || u.endsWith(`/${encodedAsset}.asset.json`)),
                            );
                        if (hit) {
                            live2dCachedModels += 1;
                        }
                    }
                }
            } catch {
                // ignore private-mode / sandboxed Cache API failures
            }
        } else if (!useBrowserLive2DCache) {
            const cleanSite = manifest.live2dSources.site.replace(/\/+$/, "");
            const prefixChecker = options.checkCachedUrlPrefixes ?? getStoryCoreConfig().checkCachedUrlPrefixes;
            if (prefixChecker) {
                const prefixes = manifest.live2d.map((item) => {
                    const encodedAsset = encodePath(item.asset);
                    if (cachedBase) {
                        return `${cachedBase.baseUrl}/${encodedAsset}/`;
                    }
                    return `${cleanSite}/${encodeURIComponent(manifest.live2dSources.region)}/${encodedAsset}/`;
                });
                try {
                    const hits = await prefixChecker(prefixes);
                    for (let i = 0; i < manifest.live2d.length; i++) {
                        const wk = warmedKey(manifest.live2dSources, manifest.live2d[i].asset);
                        if (hits?.[i] || warmedCustomProtocolAssets.has(wk)) {
                            live2dCachedModels += 1;
                        }
                    }
                } catch {
                    for (const item of manifest.live2d) {
                        if (warmedCustomProtocolAssets.has(warmedKey(manifest.live2dSources, item.asset))) {
                            live2dCachedModels += 1;
                        }
                    }
                }
            } else if (sampleSiteUrl.toLowerCase().startsWith("moesekai-cache://")) {
                const fetchFn = getCoreFetch();
                const results = await Promise.all(
                    manifest.live2d.map(async (item) => {
                        if (warmedCustomProtocolAssets.has(warmedKey(manifest.live2dSources, item.asset))) {
                            return true;
                        }
                        try {
                            const resolved = getCachedLive2DAssetDocument(manifest.live2dSources, item.asset, "live2d-model")
                                ?? await resolveLive2DAssetDocument(manifest.live2dSources, item.asset, "live2d-model");
                            if (!resolved) return false;
                            const mocMember = resolved.doc.members.find(m => m.role === "moc");
                            const probeUrl = mocMember
                                ? live2dMemberUrl(resolved.baseUrl, resolved.doc.name, mocMember, resolved.proxy)
                                : resolved.url;
                            const res = await fetchFn(probeUrl, {
                                method: "HEAD",
                                credentials: "omit",
                                headers: { "X-MoeSekai-Cache-Probe": "1" },
                            });
                            return res.status === 200 && isCustomCacheHit(res);
                        } catch {
                            return false;
                        }
                    }),
                );
                for (const ok of results) {
                    if (ok) live2dCachedModels += 1;
                }
            } else {
                for (const item of manifest.live2d) {
                    if (warmedCustomProtocolAssets.has(warmedKey(manifest.live2dSources, item.asset))) {
                        live2dCachedModels += 1;
                    }
                }
            }
        }
    }

    const uiKitSupported = manifest.includeUiKit ? await isStoryUiKitSupported() : false;
    if (manifest.includeUiKit && typeof caches !== "undefined") {
        try {
            if (await caches.has(UIKIT_CACHE_NAME)) {
                const cache = await caches.open(UIKIT_CACHE_NAME);
                const keys = await cache.keys();
                uikitCached = keys.length > 0;
            }
        } catch {
            // ignore
        }
    }

    const decodable = [...manifest.se, ...manifest.voices];
    let audioDecodedCount = 0;
    for (const clip of decodable) {
        if (clip.urls.some(u => getCachedStoryAudio(u) !== null)) {
            audioDecodedCount += 1;
        }
    }

    const live2dReady = manifest.live2d.length === 0 || live2dCachedModels >= manifest.live2d.length;
    const uikitReady = !manifest.includeUiKit || !uiKitSupported || uikitCached;

    return {
        live2dCachedModels,
        live2dTotalModels: manifest.live2d.length,
        audioDecodedCount,
        audioTotalDecodable: decodable.length,
        uikitCached,
        hasLocalCache: (manifest.live2d.length > 0 || (manifest.includeUiKit && uiKitSupported)) && live2dReady && uikitReady,
    };
}
