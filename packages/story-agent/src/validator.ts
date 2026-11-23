import {
    ASSET_DOMAIN_BACKUP,
    ASSET_DOMAIN_MAIN,
    STORY_REGIONS,
    advanceRuntime,
    compileStoryGraph,
    createInitialRuntime,
    detectStageActorOverlaps,
    extractLive2DMotionClips,
    fetchLive2DModels,
    inferLive2DMotionBundleCandidates,
    live2dDirectoryPath,
    live2dSiteListingUrl,
    live2dSources,
    parseStoryScript,
    resolveLive2DAssetDocument,
    type CompiledStoryProgram,
    type Live2DModel,
    type Live2DSources,
    type StoryDocument,
    type StoryRegion,
    type StoryVoiceRef,
} from "@moesekai/story-core";
import { runWithStoryCoreLive2D } from "./live2d-core";
import type {
    StoryAssetReport,
    StoryAssetVerificationReport,
    StoryMissingAssetItem,
    StoryOffStageTalkWarning,
    StorySimulatedChoiceStep,
    StorySimulatedPath,
    StorySimulationReport,
    StoryStageOverlapWarning,
    StoryValidationReport,
} from "./types";
import { normalizeLineEndings, summarizeStoryDoc } from "./workspace";

const ASSET_CHECK_TIMEOUT_MS = 10_000;
const MAX_BLOCKING_STEPS_PER_PATH = 1000;

// ==================== Asset URL Builders ====================

function normalizeAssetPath(value: string | undefined): string {
    return String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function assetBase(region: StoryRegion, line: "main" | "backup"): string {
    const domain = line === "backup" ? ASSET_DOMAIN_BACKUP : ASSET_DOMAIN_MAIN;
    return `${domain}/sekai-${region}-assets`;
}

function buildBackgroundUrls(name: string, region: StoryRegion, line: "main" | "backup") {
    const base = assetBase(region, line);
    const trimmed = normalizeAssetPath(name);
    return {
        webp: `${base}/scenario/background/${trimmed}/${trimmed}.webp`,
        png: `${base}/scenario/background/${trimmed}/${trimmed}.png`,
    };
}

function buildBgmUrl(name: string, region: StoryRegion, line: "main" | "backup"): string {
    const base = assetBase(region, line);
    const trimmed = normalizeAssetPath(name);
    if (trimmed.startsWith("mysekai/") || trimmed.startsWith("sound/")) {
        return `${base}/${trimmed}.mp3`;
    }
    if (trimmed.includes("/")) {
        return `${base}/sound/scenario/bgm/${trimmed}.mp3`;
    }
    return `${base}/sound/scenario/bgm/${trimmed}/${trimmed}.mp3`;
}

function buildSeCandidateUrls(name: string, region: StoryRegion, line: "main" | "backup"): string[] {
    const base = assetBase(region, line);
    const trimmed = normalizeAssetPath(name);
    if (!trimmed) return [];
    if (trimmed.startsWith("sound/")) {
        return [`${base}/${trimmed}.mp3`];
    }
    if (trimmed.includes("/")) {
        return [`${base}/sound/scenario/se/${trimmed}.mp3`];
    }
    return [
        `${base}/sound/scenario/se/se_pack00001_b/${trimmed}.mp3`,
        `${base}/sound/scenario/se/se_pack00001/${trimmed}.mp3`,
    ];
}

function buildVoiceCandidateUrls(
    voice: StoryVoiceRef,
    docRegion: StoryRegion,
    line: "main" | "backup",
): string[] {
    const scenarioId = normalizeAssetPath(voice.scenarioId);
    const voiceId = normalizeAssetPath(voice.voiceId);
    if (!scenarioId || !voiceId) return [];

    const effectiveRegion = voice.region ?? docRegion;
    const base = assetBase(effectiveRegion, line);
    const storyUrl = (sc: string, v: string) => `${base}/sound/scenario/voice/${sc}/${v}.mp3`;

    let primary: string;
    switch (voice.kind) {
        case "card":
            primary = `${base}/sound/card_scenario/voice/${scenarioId}/${voiceId}.mp3`;
            break;
        case "area":
            primary = `${base}/sound/actionset/voice/${scenarioId}/${voiceId}.mp3`;
            break;
        case "part":
            primary = `${base}/sound/scenario/part_voice/${scenarioId}/${voiceId}.mp3`;
            break;
        default:
            primary = storyUrl(scenarioId, voiceId);
            break;
    }

    const urls = [primary];
    const add = (url: string) => {
        if (url && !urls.includes(url)) urls.push(url);
    };

    const isPartVoice = voice.kind === "part" || voiceId.startsWith("partvoice");
    if (isPartVoice) {
        if (voice.kind === "part") {
            const stripped = scenarioId.startsWith("part_voice_")
                ? scenarioId.slice("part_voice_".length)
                : scenarioId;
            if (stripped !== scenarioId) {
                add(`${base}/sound/scenario/part_voice/${stripped}/${voiceId}.mp3`);
            }
            const prefixed = scenarioId.startsWith("part_voice_")
                ? scenarioId
                : `part_voice_${scenarioId}`;
            add(storyUrl(prefixed, voiceId));
        } else if (scenarioId.startsWith("part_voice_")) {
            const chara = scenarioId.slice("part_voice_".length);
            if (chara) add(`${base}/sound/scenario/part_voice/${chara}/${voiceId}.mp3`);
        } else {
            add(`${base}/sound/scenario/part_voice/${scenarioId}/${voiceId}.mp3`);
            add(storyUrl(`part_voice_${scenarioId}`, voiceId));
        }
    }

    return urls;
}

export function collectAssetReport(
    doc: StoryDocument,
    region: StoryRegion,
    line: "main" | "backup" = "main",
): StoryAssetReport {
    const l2dSources = live2dSources(region, line);
    const live2dModelListingUrl = live2dSiteListingUrl(l2dSources, "live2d/model/");
    const live2dMotionListingUrl = live2dSiteListingUrl(l2dSources, "live2d/motion/");
    const castModelByKey = new Map<string, string>();
    const live2dMap = new Map<
        string,
        {
            modelId: string;
            castKeys: string[];
            modelAssetPath: string;
            motions: Set<string>;
            facials: Set<string>;
        }
    >();

    for (const member of doc.cast) {
        if (!member.modelId) continue;
        castModelByKey.set(member.key, member.modelId);
        let entry = live2dMap.get(member.modelId);
        if (!entry) {
            entry = {
                modelId: member.modelId,
                castKeys: [],
                modelAssetPath: `live2d/model/${member.modelId}`,
                motions: new Set(),
                facials: new Set(),
            };
            live2dMap.set(member.modelId, entry);
        }
        entry.castKeys.push(member.key);
    }

    const recordClips = (castKey?: string, motion?: string, facial?: string) => {
        if (!castKey) return;
        const modelId = castModelByKey.get(castKey);
        const entry = modelId ? live2dMap.get(modelId) : undefined;
        if (!entry) return;
        if (motion) entry.motions.add(motion);
        if (facial) entry.facials.add(facial);
    };

    const bgSeen = new Set<string>();
    const backgrounds: StoryAssetReport["backgrounds"] = [];
    const bgmSeen = new Set<string>();
    const bgm: StoryAssetReport["bgm"] = [];
    const seSeen = new Set<string>();
    const se: StoryAssetReport["se"] = [];
    const voiceSeen = new Set<string>();
    const voices: StoryAssetReport["voices"] = [];

    const recordSe = (name?: string) => {
        if (!name || seSeen.has(name)) return;
        seSeen.add(name);
        se.push({ name, urls: buildSeCandidateUrls(name, region, line) });
    };

    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "scene") continue;
        if (node.background.mode === "set" && node.background.asset && !bgSeen.has(node.background.asset)) {
            bgSeen.add(node.background.asset);
            const urls = buildBackgroundUrls(node.background.asset, region, line);
            backgrounds.push({ name: node.background.asset, webp: urls.webp, png: urls.png });
        }
        if (node.bgm.mode === "play" && node.bgm.name && !bgmSeen.has(node.bgm.name)) {
            bgmSeen.add(node.bgm.name);
            bgm.push({ name: node.bgm.name, url: buildBgmUrl(node.bgm.name, region, line) });
        }
        if (node.stageCast.mode === "set") {
            for (const actor of node.stageCast.actors) {
                recordClips(actor.castKey, actor.motion, actor.facial);
            }
        }
        for (const beat of node.beats) {
            if (beat.kind === "talk") {
                recordClips(beat.speakerKey, beat.motion, beat.facial);
                for (const r of beat.reactions ?? []) {
                    recordClips(r.castKey, r.motion, r.facial);
                }
                if (beat.voice && beat.voice.scenarioId && beat.voice.voiceId) {
                    const effectiveRegion = beat.voice.region ?? region;
                    const key = `${beat.voice.kind}|${effectiveRegion}|${beat.voice.scenarioId}|${beat.voice.voiceId}`;
                    if (!voiceSeen.has(key)) {
                        voiceSeen.add(key);
                        voices.push({
                            ref: beat.voice,
                            urls: buildVoiceCandidateUrls(beat.voice, region, line),
                        });
                    }
                }
                recordSe(beat.se);
            } else if (beat.kind === "narration") {
                recordSe(beat.se);
            } else if (beat.kind === "stageAction") {
                recordClips(beat.castKey, beat.motion, beat.facial);
            } else if (beat.kind === "cue" && beat.cueType === "se") {
                recordSe(beat.se);
            }
        }
    }

    const live2d = [...live2dMap.values()].map((item) => ({
        modelId: item.modelId,
        castKeys: item.castKeys,
        modelAssetPath: item.modelAssetPath,
        motions: [...item.motions].sort(),
        facials: [...item.facials].sort(),
    }));

    return {
        region,
        line,
        live2dSiteUrl: l2dSources.site,
        live2dModelListingUrl,
        live2dMotionListingUrl,
        ...(l2dSources.proxy ? { live2dProxyUrl: l2dSources.proxy } : {}),
        live2d,
        backgrounds,
        bgm,
        se,
        voices,
    };
}

// ==================== Live Asset Verifier & Clip Suggestions ====================

const CLIP_STOPWORDS = new Set([
    "face", "w", "m", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
]);

const CLIP_SYNONYMS: Record<string, string[]> = {
    worry: ["trouble", "sad", "serious"],
    happy: ["smile", "glad", "joy"],
    sparkling: ["kirakira", "smile", "glad"],
    kirakira: ["sparkling", "smile", "glad"],
    cry: ["sad", "tear", "heartbreak"],
    blush: ["shy", "blushed"],
    shy: ["blushed", "embarrass"],
    scared: ["surprise", "shock", "trouble"],
    angry: ["disgust", "serious", "sharp"],
    confused: ["confusion", "trouble", "tilthead"],
};

function tokenizeClipName(name: string): string[] {
    return String(name)
        .toLowerCase()
        .split(/[-_\s]+/)
        .map((t) => t.replace(/\d+$/, ""))
        .filter((t) => t.length >= 2 && !CLIP_STOPWORDS.has(t));
}

export function suggestClips(
    target: string,
    availableSet: ReadonlySet<string>,
    maxSuggestions = 5,
): string[] {
    const targetLower = String(target).toLowerCase();
    const targetTokens = tokenizeClipName(target);
    const synonymTokens = new Set<string>();
    for (const tok of targetTokens) {
        for (const syn of CLIP_SYNONYMS[tok] ?? []) synonymTokens.add(syn);
    }
    const targetPrefix = targetLower.startsWith("face_") ? "" : targetLower.slice(0, 8);
    const scored: Array<{ candidate: string; score: number }> = [];

    for (const candidate of availableSet) {
        const candLower = candidate.toLowerCase();
        let score = 0;
        if (candLower.includes(targetLower) || targetLower.includes(candLower)) score += 45;
        const candTokens = tokenizeClipName(candidate);
        for (const tok of targetTokens) {
            if (candTokens.includes(tok)) score += 28;
            else if (candTokens.some((c) => c.includes(tok) || tok.includes(c))) score += 14;
        }
        for (const syn of synonymTokens) {
            if (candTokens.includes(syn)) score += 22;
            else if (candTokens.some((c) => c.includes(syn))) score += 10;
        }
        if (targetPrefix.length >= 4 && candLower.startsWith(targetPrefix)) score += 8;
        if (score > 0) scored.push({ candidate, score });
    }

    scored.sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));
    if (scored.length > 0) {
        return scored.slice(0, maxSuggestions).map((s) => s.candidate);
    }
    return [...availableSet].sort().slice(0, maxSuggestions);
}

async function checkUrlExists(
    url: string,
    fetchImpl: typeof fetch,
    timeoutMs: number,
): Promise<{ ok: boolean; status: number; error?: string }> {
    let lastResult: { ok: boolean; status: number; error?: string } = {
        ok: false,
        status: 0,
        error: "unknown",
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        try {
            const res = await fetchImpl(url, {
                method: "HEAD",
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (res.ok) return { ok: true, status: res.status };
            if (res.status === 405 || res.status === 501) {
                const getRes = await fetchImpl(url, {
                    method: "GET",
                    headers: { Range: "bytes=0-0" },
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (getRes.ok) return { ok: true, status: getRes.status };
                lastResult = { ok: false, status: getRes.status };
                if (getRes.status >= 400 && getRes.status < 500) return lastResult;
                continue;
            }
            lastResult = { ok: false, status: res.status };
            if (res.status >= 400 && res.status < 500) return lastResult;
        } catch (err) {
            lastResult = {
                ok: false,
                status: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    return lastResult;
}

async function checkAnyCandidate(
    urls: string[],
    fetchImpl: typeof fetch,
    timeoutMs: number,
): Promise<{ ok: boolean; matchedUrl: string | null }> {
    for (const url of urls) {
        const res = await checkUrlExists(url, fetchImpl, timeoutMs);
        if (res.ok) return { ok: true, matchedUrl: url };
    }
    return { ok: false, matchedUrl: null };
}

export async function verifyAssetsLive(
    assetReport: StoryAssetReport,
    options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<StoryAssetVerificationReport> {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options?.timeoutMs ?? ASSET_CHECK_TIMEOUT_MS;
    const missing: StoryMissingAssetItem[] = [];
    const checked = {
        live2dModels: 0,
        live2dClips: 0,
        backgrounds: 0,
        bgm: 0,
        se: 0,
        voices: 0,
    };
    let live2dSource: StoryAssetVerificationReport["live2dSource"] = "asset-site-listings";
    let live2dPublishedVersion: string | undefined;

    if (assetReport.live2d.length > 0) {
        const l2dSources: Live2DSources = {
            site: assetReport.live2dSiteUrl,
            region: assetReport.region,
            ...(assetReport.live2dProxyUrl ? { proxy: assetReport.live2dProxyUrl } : {}),
        };

        await runWithStoryCoreLive2D(
            {
                fetchImpl: options?.fetchImpl,
                line: assetReport.line,
                siteOverride: assetReport.live2dSiteUrl,
                proxyOverride: assetReport.live2dProxyUrl,
                timeoutMs,
            },
            async () => {
                const modelById = new Map<string, Live2DModel>();
                let listingLoaded = false;

                try {
                    const listedModels = await fetchLive2DModels(assetReport.region);
                    if (listedModels.length > 0) {
                        listingLoaded = true;
                        for (const model of listedModels) {
                            modelById.set(model.id, model);
                        }
                    } else {
                        live2dSource = "asset-document-fallback";
                    }
                } catch {
                    live2dSource = "asset-document-fallback";
                }

                const motionBundleCache = new Map<
                    string,
                    { bundle: string; motions: Set<string>; facials: Set<string>; url: string } | null
                >();

                const loadMotionBundle = async (bundle: string) => {
                    if (!bundle) return null;
                    if (motionBundleCache.has(bundle)) return motionBundleCache.get(bundle) ?? null;
                    try {
                        const resolved = await resolveLive2DAssetDocument(
                            l2dSources,
                            live2dDirectoryPath(bundle),
                            "live2d-motions",
                        );
                        if (!resolved) {
                            motionBundleCache.set(bundle, null);
                            return null;
                        }
                        live2dPublishedVersion ??= resolved.version;
                        const { motions, facials } = extractLive2DMotionClips(resolved.doc);
                        const result = {
                            bundle,
                            motions: new Set(motions),
                            facials: new Set(facials),
                            url: resolved.url,
                        };
                        motionBundleCache.set(bundle, result);
                        return result;
                    } catch {
                        motionBundleCache.set(bundle, null);
                        return null;
                    }
                };

                for (const item of assetReport.live2d) {
                    checked.live2dModels += 1;
                    const indexed = modelById.get(item.modelId);
                    let modelVerified = Boolean(indexed);

                    if (!modelVerified) {
                        if (listingLoaded) {
                            missing.push({
                                category: "live2d-model",
                                name: item.modelId,
                                url: assetReport.live2dModelListingUrl,
                                reason: `Model '${item.modelId}' not found in canonical Live2D model listing`,
                            });
                            continue;
                        }

                        try {
                            const resolvedModel = await resolveLive2DAssetDocument(
                                l2dSources,
                                live2dDirectoryPath(item.modelAssetPath),
                                "live2d-model",
                            );
                            if (resolvedModel) {
                                live2dPublishedVersion ??= resolvedModel.version;
                                modelVerified = true;
                            }
                        } catch {
                            // handled as missing below
                        }

                        if (!modelVerified) {
                            missing.push({
                                category: "live2d-model",
                                name: item.modelId,
                                url: assetReport.live2dModelListingUrl,
                                reason: `Model '${item.modelAssetPath}' live2d-model .asset.json unavailable`,
                            });
                            continue;
                        }
                    }

                    if (item.motions.length > 0 || item.facials.length > 0) {
                        const candidates: string[] = [];
                        const addCandidate = (asset: string | null | undefined) => {
                            const clean = asset?.trim();
                            if (clean && !candidates.includes(clean)) candidates.push(clean);
                        };
                        addCandidate(indexed?.motion);
                        for (const m of indexed?.motions ?? []) {
                            addCandidate(m);
                        }
                        for (const inferred of inferLive2DMotionBundleCandidates(item.modelId)) {
                            addCandidate(inferred);
                        }

                        let manifest: {
                            bundle: string;
                            motions: Set<string>;
                            facials: Set<string>;
                            url: string;
                        } | null = null;
                        for (const bundle of candidates) {
                            const loaded = await loadMotionBundle(bundle);
                            if (loaded) {
                                manifest = loaded;
                                break;
                            }
                        }

                        if (!manifest) {
                            missing.push({
                                category: "live2d-motion-bundle",
                                name: `${item.modelId} (${candidates[0] ?? "none"})`,
                                url: assetReport.live2dMotionListingUrl,
                                reason: "Motion bundle live2d-motions .asset.json unavailable",
                            });
                            continue;
                        }

                        for (const motion of item.motions) {
                            checked.live2dClips += 1;
                            if (!manifest.motions.has(motion)) {
                                missing.push({
                                    category: "live2d-motion",
                                    name: `${item.modelId}:${motion}`,
                                    url: manifest.url,
                                    reason: `Motion not found in ${manifest.bundle}`,
                                    suggestions: suggestClips(motion, manifest.motions),
                                });
                            }
                        }

                        for (const facial of item.facials) {
                            checked.live2dClips += 1;
                            if (!manifest.facials.has(facial)) {
                                missing.push({
                                    category: "live2d-facial",
                                    name: `${item.modelId}:${facial}`,
                                    url: manifest.url,
                                    reason: `Facial not found in ${manifest.bundle}`,
                                    suggestions: suggestClips(facial, manifest.facials),
                                });
                            }
                        }
                    }
                }
            },
        );
    }

    for (const bg of assetReport.backgrounds) {
        checked.backgrounds += 1;
        const res = await checkUrlExists(bg.webp, fetchImpl, timeoutMs);
        if (!res.ok) {
            missing.push({ category: "background", name: bg.name, url: bg.webp, reason: `HTTP ${res.status}` });
        }
    }

    for (const track of assetReport.bgm) {
        checked.bgm += 1;
        const res = await checkUrlExists(track.url, fetchImpl, timeoutMs);
        if (!res.ok) {
            missing.push({ category: "bgm", name: track.name, url: track.url, reason: `HTTP ${res.status}` });
        }
    }

    for (const clip of assetReport.se) {
        checked.se += 1;
        const res = await checkAnyCandidate(clip.urls, fetchImpl, timeoutMs);
        if (!res.ok) {
            missing.push({
                category: "se",
                name: clip.name,
                urls: clip.urls,
                reason: "All candidate URLs failed",
            });
        }
    }

    for (const clip of assetReport.voices) {
        checked.voices += 1;
        const res = await checkAnyCandidate(clip.urls, fetchImpl, timeoutMs);
        if (!res.ok) {
            missing.push({
                category: "voice",
                name: `${clip.ref.kind}:${clip.ref.scenarioId}:${clip.ref.voiceId}`,
                urls: clip.urls,
                reason: "All candidate URLs failed",
            });
        }
    }

    return {
        ok: missing.length === 0,
        live2dSource,
        ...(live2dPublishedVersion ? { live2dPublishedVersion } : {}),
        checked,
        missing,
    };
}

// ==================== Exhaustive Branch & Ending Simulator ====================

export function simulateAllBranches(
    program: CompiledStoryProgram,
    maxPaths = 64,
): StorySimulationReport {
    const declaredEndings = Object.values(program.doc.nodes)
        .filter((n) => n.type === "end")
        .map((n) => n.id);

    const paths: StorySimulatedPath[] = [];
    const reachedEndingsSet = new Set<string>();
    const offStageTalkMap = new Map<string, StoryOffStageTalkWarning>();
    const stageOverlapMap = new Map<string, StoryStageOverlapWarning>();
    let truncated = false;

    const recordFrameAudits = (frame: ReturnType<typeof createInitialRuntime>) => {
        if (frame.nodeId && frame.stage.actors.length >= 2) {
            const audit = detectStageActorOverlaps(frame.stage.actors);
            for (const dup of audit.duplicateSlots) {
                const key = `dup:${frame.nodeId}:${frame.beatId ?? ""}:${dup.slot}:${dup.actors.join(",")}`;
                if (!stageOverlapMap.has(key)) {
                    stageOverlapMap.set(key, {
                        kind: "duplicateSlot",
                        nodeId: frame.nodeId,
                        ...(frame.beatId ? { beatId: frame.beatId } : {}),
                        slot: dup.slot,
                        actors: [...dup.actors],
                    });
                }
            }
            for (const ov of audit.overlaps) {
                const key = `ov:${frame.nodeId}:${frame.beatId ?? ""}:${ov.leftActor}:${ov.rightActor}`;
                if (!stageOverlapMap.has(key)) {
                    stageOverlapMap.set(key, {
                        kind: "overlap",
                        nodeId: frame.nodeId,
                        ...(frame.beatId ? { beatId: frame.beatId } : {}),
                        actors: [ov.leftActor, ov.rightActor],
                        gap: ov.gap,
                        minGap: ov.minGap,
                    });
                }
            }
        }
        if (frame.stoppedReason !== "blocking" || !frame.nodeId || !frame.beatId) return;
        const inst = program.instructions[frame.pc];
        if (inst?.op === "talk" && inst.beat.speakerKey && frame.stage.speaking === null) {
            const key = `${frame.nodeId}:${frame.beatId}:${inst.beat.speakerKey}`;
            if (!offStageTalkMap.has(key)) {
                offStageTalkMap.set(key, {
                    nodeId: frame.nodeId,
                    beatId: frame.beatId,
                    speakerKey: inst.beat.speakerKey,
                });
            }
        }
    };

    const initial = createInitialRuntime(program);
    const queue: Array<{
        frame: ReturnType<typeof createInitialRuntime>;
        choices: StorySimulatedChoiceStep[];
        beatCount: number;
        seenChoiceStates: Set<string>;
    }> = [
        {
            frame: initial,
            choices: [],
            beatCount: initial.stoppedReason === "blocking" ? 1 : 0,
            seenChoiceStates: new Set(),
        },
    ];

    while (queue.length > 0) {
        if (paths.length >= maxPaths) {
            truncated = true;
            break;
        }
        const entry = queue.shift()!;
        let cur: ReturnType<typeof createInitialRuntime> | null = entry.frame;
        let beatCount = entry.beatCount;
        let stepsInSegment = 0;

        recordFrameAudits(cur);

        while (cur && cur.stoppedReason === "blocking") {
            if (stepsInSegment >= MAX_BLOCKING_STEPS_PER_PATH) {
                paths.push({
                    index: paths.length + 1,
                    outcome: "step-limit",
                    choices: entry.choices,
                    ending: null,
                    finalNodeId: cur.nodeId,
                    variables: { ...cur.variables },
                    beatCount,
                    visitedNodeIds: [...cur.visitedNodeIds],
                });
                cur = null;
                break;
            }
            cur = advanceRuntime(program, cur);
            stepsInSegment += 1;
            recordFrameAudits(cur);
            if (cur.stoppedReason === "blocking") {
                beatCount += 1;
            }
        }

        if (!cur) continue;

        if (cur.stoppedReason === "choice" && cur.pendingChoice) {
            const available = cur.pendingChoice.options.filter((o) => o.available);
            if (available.length === 0) {
                paths.push({
                    index: paths.length + 1,
                    outcome: "deadlock",
                    choices: entry.choices,
                    ending: null,
                    finalNodeId: cur.nodeId,
                    variables: { ...cur.variables },
                    beatCount,
                    visitedNodeIds: [...cur.visitedNodeIds],
                });
                continue;
            }

            const varSig = JSON.stringify(cur.variables);
            for (const opt of available) {
                const stateKey = `${cur.nodeId}\0${opt.id}\0${varSig}`;
                const nextChoices: StorySimulatedChoiceStep[] = [
                    ...entry.choices,
                    { nodeId: cur.nodeId ?? "", optionId: opt.id, text: opt.text },
                ];
                if (entry.seenChoiceStates.has(stateKey)) {
                    paths.push({
                        index: paths.length + 1,
                        outcome: "choice-cycle",
                        choices: nextChoices,
                        ending: null,
                        finalNodeId: cur.nodeId,
                        variables: { ...cur.variables },
                        beatCount,
                        visitedNodeIds: [...cur.visitedNodeIds],
                    });
                    continue;
                }
                const nextSeen = new Set(entry.seenChoiceStates);
                nextSeen.add(stateKey);
                const nextFrame = advanceRuntime(program, cur, opt.id);
                queue.push({
                    frame: nextFrame,
                    choices: nextChoices,
                    beatCount: beatCount + (nextFrame.stoppedReason === "blocking" ? 1 : 0),
                    seenChoiceStates: nextSeen,
                });
            }
            continue;
        }

        if (cur.stoppedReason === "end" && cur.ending) {
            reachedEndingsSet.add(cur.ending.nodeId);
        }

        paths.push({
            index: paths.length + 1,
            outcome: cur.stoppedReason,
            choices: entry.choices,
            ending: cur.ending ? { ...cur.ending } : null,
            finalNodeId: cur.nodeId,
            variables: { ...cur.variables },
            beatCount,
            visitedNodeIds: [...cur.visitedNodeIds],
        });
    }

    const reachedEndings = [...reachedEndingsSet];
    const unreachedEndings = declaredEndings.filter((id) => !reachedEndingsSet.has(id));
    const disconnectedPaths = paths.filter((p) => p.outcome === "disconnected").length;
    const loopPaths = paths.filter(
        (p) => p.outcome === "loop" || p.outcome === "step-limit" || p.outcome === "choice-cycle",
    ).length;
    const deadlockPaths = paths.filter((p) => p.outcome === "deadlock").length;

    return {
        totalPaths: paths.length,
        truncated,
        declaredEndings,
        reachedEndings,
        unreachedEndings,
        disconnectedPaths,
        loopPaths,
        deadlockPaths,
        offStageTalks: [...offStageTalkMap.values()],
        stageOverlaps: [...stageOverlapMap.values()],
        paths,
    };
}

// ==================== Unified Validate + Simulate Entry ====================

export interface ValidateAndSimulateOptions {
    strict?: boolean;
    simulate?: boolean;
    assets?: boolean;
    verifyAssets?: boolean;
    maxPaths?: number;
    line?: "main" | "backup";
    regionOverride?: StoryRegion;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

export async function validateAndSimulateStory(
    source: string,
    options: ValidateAndSimulateOptions = {},
): Promise<StoryValidationReport> {
    const normalized = normalizeLineEndings(source);
    const parsed = parseStoryScript(normalized);
    if (!parsed.ok) {
        return {
            ok: false,
            strictOk: false,
            parseDiagnostics: parsed.diagnostics.map((d) => ({
                line: d.line,
                col: d.col,
                message: d.message,
            })),
            summary: null,
            errors: [],
            warnings: [],
        };
    }

    const doc = parsed.doc;
    const program = compileStoryGraph(doc);
    const effectiveRegion: StoryRegion =
        options.regionOverride && (STORY_REGIONS as readonly string[]).includes(options.regionOverride)
            ? options.regionOverride
            : doc.region;
    const line = options.line ?? "main";
    const shouldSimulate = options.simulate ?? true;
    const shouldCollectAssets = Boolean(options.assets || options.verifyAssets);

    let simulation: StorySimulationReport | undefined;
    if (shouldSimulate) {
        if (program.ok) {
            simulation = simulateAllBranches(program, Math.max(1, Math.min(1000, options.maxPaths ?? 64)));
        } else {
            simulation = {
                skipped: true,
                reason: "Compilation errors prevented simulation",
                totalPaths: 0,
                truncated: false,
                declaredEndings: [],
                reachedEndings: [],
                unreachedEndings: [],
                disconnectedPaths: 0,
                loopPaths: 0,
                deadlockPaths: 0,
                offStageTalks: [],
                stageOverlaps: [],
                paths: [],
            };
        }
    }

    const assets = shouldCollectAssets
        ? collectAssetReport(doc, effectiveRegion, line)
        : undefined;

    const assetVerification = options.verifyAssets && assets
        ? await verifyAssetsLive(assets, {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs,
        })
        : undefined;

    const ok = program.ok && (assetVerification ? assetVerification.ok : true);
    const hasSimProblems = Boolean(
        simulation
        && !simulation.skipped
        && (
            simulation.stageOverlaps.length > 0
            || simulation.unreachedEndings.length > 0
            || simulation.deadlockPaths > 0
            || simulation.disconnectedPaths > 0
            || simulation.loopPaths > 0
        ),
    );
    const strictOk = ok && program.warnings.length === 0 && !hasSimProblems;

    return {
        ok,
        strictOk,
        parseDiagnostics: [],
        summary: summarizeStoryDoc(doc, program),
        errors: program.errors,
        warnings: program.warnings,
        ...(simulation ? { simulation } : {}),
        ...(assets ? { assets } : {}),
        ...(assetVerification ? { assetVerification } : {}),
    };
}

export function formatValidationSummary(report: StoryValidationReport): string {
    const lines: string[] = [];
    const status = report.parseDiagnostics.length > 0
        ? "PARSE FAILED"
        : report.errors.length > 0
            ? "COMPILE FAILED"
            : report.assetVerification && !report.assetVerification.ok
                ? "ASSETS MISSING"
                : !report.strictOk
                    ? "STRICT CHECK FAILED"
                    : "OK (0 errors, 0 warnings, all checks green)";
    lines.push(`Status: ${status}`);

    if (report.parseDiagnostics.length > 0) {
        lines.push(`Parse Errors (${report.parseDiagnostics.length}):`);
        for (const d of report.parseDiagnostics) {
            lines.push(`  - Line ${d.line}:${d.col}: ${d.message}`);
        }
        return lines.join("\n");
    }

    if (report.summary) {
        const s = report.summary;
        lines.push(
            `Story "${s.title}" (id=${s.id}, region=${s.region}): `
            + `cast=${s.castCount}, vars=${s.variableCount}, nodes=${s.nodeCount} `
            + `(scene=${s.nodesByType.scene}, choice=${s.nodesByType.choice}, cond=${s.nodesByType.condition}, end=${s.nodesByType.end}), `
            + `beats=${s.beatCount}`,
        );
    }

    if (report.errors.length > 0) {
        lines.push(`Compiler Errors (${report.errors.length}):`);
        for (const e of report.errors) {
            const loc = e.nodeId ? (e.beatId ? `${e.nodeId}/${e.beatId}` : e.nodeId) : e.path;
            const params = e.params ? ` ${JSON.stringify(e.params)}` : "";
            lines.push(`  - [ERROR] ${e.code} @ ${loc} (${e.path})${params}`);
        }
    }

    if (report.warnings.length > 0) {
        lines.push(`Compiler Warnings (${report.warnings.length}):`);
        for (const w of report.warnings) {
            const loc = w.nodeId ? (w.beatId ? `${w.nodeId}/${w.beatId}` : w.nodeId) : w.path;
            const params = w.params ? ` ${JSON.stringify(w.params)}` : "";
            lines.push(`  - [WARNING] ${w.code} @ ${loc} (${w.path})${params}`);
        }
    }

    if (report.simulation) {
        const sim = report.simulation;
        if (sim.skipped) {
            lines.push(`Simulation: skipped (${sim.reason})`);
        } else {
            lines.push(
                `Simulation: ${sim.totalPaths} path(s)${sim.truncated ? " (truncated)" : ""}, `
                + `endings ${sim.reachedEndings.length}/${sim.declaredEndings.length}`
                + (sim.unreachedEndings.length > 0 ? ` [UNREACHED: ${sim.unreachedEndings.join(", ")}]` : "")
                + (sim.deadlockPaths > 0 ? `, deadlocks=${sim.deadlockPaths}` : "")
                + (sim.disconnectedPaths > 0 ? `, disconnected=${sim.disconnectedPaths}` : "")
                + (sim.loopPaths > 0 ? `, loops=${sim.loopPaths}` : ""),
            );
            if (sim.stageOverlaps.length > 0) {
                lines.push(`Stage Overlaps (${sim.stageOverlaps.length}):`);
                for (const item of sim.stageOverlaps) {
                    const loc = item.beatId ? `${item.nodeId}/${item.beatId}` : item.nodeId;
                    lines.push(
                        item.kind === "duplicateSlot"
                            ? `  - ${loc}: duplicate slot "${item.slot}" shared by [${item.actors.join(", ")}]`
                            : `  - ${loc}: tight spacing [${item.actors.join(", ")}] (gap=${item.gap}, minSafe=${item.minGap})`,
                    );
                }
            }
            if (sim.offStageTalks.length > 0) {
                lines.push(`Off-stage talks (${sim.offStageTalks.length}): ${sim.offStageTalks.map((t) => `${t.nodeId}/${t.beatId}:${t.speakerKey}`).join(", ")}`);
            }
        }
    }

    if (report.assetVerification) {
        const v = report.assetVerification;
        lines.push(`Asset Verification: ${v.ok ? "ALL OK" : `${v.missing.length} MISSING`} ${JSON.stringify(v.checked)}`);
        for (const m of v.missing) {
            const hint = m.suggestions && m.suggestions.length > 0
                ? ` (did you mean: ${m.suggestions.join(", ")})`
                : "";
            lines.push(`  - [MISSING] (${m.category}) ${m.name}: ${m.reason}${hint}`);
        }
    }

    return lines.join("\n");
}
