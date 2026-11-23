import { describe, expect, test } from "bun:test";
import {
    clearLive2DSiteCache,
    configureStoryCore,
    fetchLive2DFormListing,
    INITIAL_STAGE_STATE,
    resetStoryCoreConfig,
    type Live2DSources,
    type StoryCastMember,
    type StoryStageState,
} from "@moesekai/story-core";
import { canBrowseClipPicker } from "../src/components/ClipPickerField";
import {
    candidateMotionBundlesForModelId,
    clearLive2DModelClipsCache,
    fetchLive2DModelClips,
    resolveModelBundlesForStage,
} from "../src/live2d/clipCatalog";
import {
    clearLive2DStageLoaderCache,
    createLive2DStageUnavailableError,
    isLive2DStageUnavailableError,
    LIVE2D_STAGE_UNAVAILABLE,
    loadLive2DStage,
    type Live2DActorInfo,
    type Live2DActorModel,
    type Live2DActorPlacement,
    type Live2DStage,
    type Live2DStageOptions,
    type Live2DStageStatic,
} from "../src/live2d/stage";
import {
    SOLO_PREVIEW_ACTOR_ID,
    StoryStageController,
    type StageCanvasSize,
    type StageHostAdapter,
} from "../src/live2d/stageController";
import { live2dScriptModuleUrl, live2dViewerScriptBase } from "../src/live2d/viewer";

const CAST_KANADE: StoryCastMember = { key: "kanade", name: "宵崎奏", modelId: "v2_17kanade_casual", characterId: 17 };
const CAST_MIKU: StoryCastMember = { key: "miku", name: "初音未来", modelId: "v2_21miku_night", characterId: 21 };
const CAST_MAFUYU: StoryCastMember = { key: "mafuyu", name: "朝比奈真冬", modelId: "v2_18mafuyu_casual", characterId: 18 };
const TEST_SOURCES: Live2DSources = { site: "https://storage.test", region: "jp" };

function waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeStageState(overrides: Partial<StoryStageState> = {}): StoryStageState {
    return { ...INITIAL_STAGE_STATE, ...overrides };
}

class MinimalHost implements StageHostAdapter {
    mountCanvas(): HTMLCanvasElement | null {
        return { id: Math.random() } as unknown as HTMLCanvasElement;
    }
    clearCanvas(): void {}
    measure(): StageCanvasSize {
        return { width: 1280, height: 720 };
    }
    isHidden(): boolean {
        return false;
    }
    observe(): () => void {
        return () => {};
    }
}

class FallbackTestStage extends EventTarget implements Live2DStage {
    base: string | null = null;
    readonly mounted = new Map<string, { asset: string; motionAsset: string | null; motion: string | null; facial: string | null }>();
    readonly addAttempts: Array<{ id: string; asset: string; motion: string | null }> = [];
    readonly missingModelAssets = new Set<string>();
    readonly missingMotionAssets = new Set<string>();
    readonly silentMissingMotionAssets = new Set<string>();
    readonly resolvedModelMap = new Map<string, string>();
    readonly resolvedMotionMap = new Map<string, string>();
    paused = false;

    get actors(): string[] {
        return [...this.mounted.keys()];
    }

    async addActor(
        id: string,
        model: Live2DActorModel,
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
    ): Promise<Live2DActorInfo> {
        const motionAsset = model.motion ?? null;
        this.addAttempts.push({ id, asset: model.asset, motion: motionAsset });
        await waitMs(2);
        const bareModel = model.asset.replace(/^\/+|\/+$/g, "");
        if (this.missingModelAssets.has(model.asset) || this.missingModelAssets.has(bareModel)) {
            throw Object.assign(new Error(`the published version has no model ${bareModel}`), {
                kind: "not-found",
                url: `https://storage.test/jp@1.0.0/${bareModel}`,
            });
        }
        const bareMotion = motionAsset ? motionAsset.replace(/^\/+|\/+$/g, "") : null;
        if (motionAsset && (this.missingMotionAssets.has(motionAsset) || (bareMotion && this.missingMotionAssets.has(bareMotion)))) {
            throw Object.assign(new Error(`the asset site has no ${bareMotion}`), {
                kind: "not-found",
                url: `https://storage.test/jp@1.0.0/${bareMotion}`,
            });
        }
        if (motionAsset && (this.silentMissingMotionAssets.has(motionAsset) || (bareMotion && this.silentMissingMotionAssets.has(bareMotion)))) {
            if (placement?.motion) {
                throw Object.assign(new Error(`no body motion ${placement.motion}`), { kind: "internal" });
            }
            if (placement?.facial) {
                throw Object.assign(new Error(`no facial ${placement.facial}`), { kind: "internal" });
            }
            const resolvedModel = this.resolvedModelMap.get(model.asset) ?? this.resolvedModelMap.get(bareModel) ?? model.asset;
            const emptyInfo: Live2DActorInfo = {
                model: resolvedModel,
                motionSet: null,
                motions: [],
                facials: [],
                defaultMotion: null,
                defaultFacial: null,
                hasPhysics: true,
            };
            this.mounted.set(id, {
                asset: model.asset,
                motionAsset: null,
                motion: null,
                facial: null,
            });
            return emptyInfo;
        }
        const resolvedModel = this.resolvedModelMap.get(model.asset) ?? this.resolvedModelMap.get(bareModel) ?? model.asset;
        const resolvedMotion = motionAsset
            ? (this.resolvedMotionMap.get(motionAsset) ?? (bareMotion ? this.resolvedMotionMap.get(bareMotion) : undefined) ?? motionAsset)
            : null;
        const info: Live2DActorInfo = {
            model: resolvedModel,
            motionSet: resolvedMotion,
            motions: ["w-normal01-tilthead", "w-normal15-nod", "w-kanade07-nod"],
            facials: ["face_normal_01", "face_smile_01", "face_sad_01"],
            defaultMotion: "w-normal01-tilthead",
            defaultFacial: "face_normal_01",
            hasPhysics: true,
        };
        this.mounted.set(id, {
            asset: model.asset,
            motionAsset,
            motion: placement?.motion ?? info.defaultMotion,
            facial: placement?.facial ?? info.defaultFacial,
        });
        return info;
    }

    removeActor(id: string): void {
        this.mounted.delete(id);
    }

    async setActor(_id: string, _placement: Live2DActorPlacement): Promise<boolean> {
        return true;
    }

    async playMotion(id: string, name: string): Promise<boolean> {
        const entry = this.mounted.get(id);
        if (!entry) return false;
        entry.motion = name;
        return true;
    }

    async setFacial(id: string, name: string): Promise<boolean> {
        const entry = this.mounted.get(id);
        if (!entry) return false;
        entry.facial = name;
        return true;
    }

    setTalking(): void {}
    setMouth(): void {}
    setPhysics(): void {}
    setBreath(): void {}
    async setCamera(): Promise<boolean> { return true; }
    finishTweens(): void {}
    play(): void { this.paused = false; }
    pause(): void { this.paused = true; }
    resize(): void {}
    destroy(): void {}
}

describe("Host-served Live2D script base & optional scriptVersion", () => {
    test("defaults to LIVE2D_VIEWER_PATH (/live2d-viewer/) and loads clean URLs without ?v= when scriptVersion is omitted", () => {
        expect(live2dViewerScriptBase()).toBe("http://localhost/live2d-viewer/");
        expect(live2dViewerScriptBase(null)).toBe("http://localhost/live2d-viewer/");
        expect(live2dViewerScriptBase("/live2d-viewer/0.3.0-abc123")).toBe("http://localhost/live2d-viewer/0.3.0-abc123/");
        expect(live2dViewerScriptBase("moesekai-app://app/live2d-viewer")).toBe("moesekai-app://app/live2d-viewer/");

        expect(live2dScriptModuleUrl("viewer.js", "/live2d-viewer/")).toBe("http://localhost/live2d-viewer/viewer.js");
        expect(live2dScriptModuleUrl("stage.js", "moesekai-app://app/live2d-viewer/")).toBe(
            "moesekai-app://app/live2d-viewer/stage.js",
        );
        expect(live2dScriptModuleUrl("stage.js", "/live2d-viewer/", "0.3.0-abc123")).toBe(
            "http://localhost/live2d-viewer/stage.js?v=0.3.0-abc123",
        );
    });

    test("loadLive2DStage surfaces a clean diagnostic Live2DStageUnavailableError when host lacks stage.js", async () => {
        clearLive2DStageLoaderCache();
        let caught: unknown = null;
        try {
            await loadLive2DStage("https://host-without-stage.invalid/live2d-viewer/0.2.0/");
        } catch (error) {
            caught = error;
        }
        expect(isLive2DStageUnavailableError(caught)).toBe(true);
        const err = caught as Error & { code?: string; kind?: string; url?: string };
        expect(err.code).toBe(LIVE2D_STAGE_UNAVAILABLE);
        expect(err.kind).toBe("not-found");
        expect(err.url).toBe("https://host-without-stage.invalid/live2d-viewer/0.2.0/stage.js");
        expect(err.message).toContain("stage.js");
    });
});

describe("ClipPickerField browse gating & direct modelId clip catalog", () => {
    test("enables Browse immediately with modelId + sources even when modelInfo is empty (0 actors on stage) and motionAsset is null", () => {
        expect(canBrowseClipPicker({
            disabled: false,
            info: undefined,
            sources: TEST_SOURCES,
            modelId: "v2_17kanade_casual",
            motionAsset: null,
        })).toBe(true);

        // Still disabled when field is explicitly disabled or no model/motion source exists.
        expect(canBrowseClipPicker({
            disabled: true,
            info: undefined,
            sources: TEST_SOURCES,
            modelId: "v2_17kanade_casual",
            motionAsset: null,
        })).toBe(false);

        expect(canBrowseClipPicker({
            disabled: false,
            info: undefined,
            sources: TEST_SOURCES,
            modelId: null,
            motionAsset: null,
        })).toBe(false);

        expect(canBrowseClipPicker({
            disabled: false,
            info: undefined,
            sources: null,
            modelId: "v2_17kanade_casual",
            motionAsset: null,
        })).toBe(false);
    });

    test("derives ordered candidate motion assets for v2, gen-1, and sub character modelIds", () => {
        expect(candidateMotionBundlesForModelId("v2_17kanade_casual")).toEqual([
            "live2d/motion/v2_17kanade_motion_base",
            "live2d/motion/17kanade_motion_base",
        ]);
        expect(candidateMotionBundlesForModelId("21miku_night")).toEqual([
            "live2d/motion/21miku_motion_base",
        ]);
        expect(candidateMotionBundlesForModelId("sub_arisa02_lesson")).toEqual([
            "live2d/motion/sub_arisa02_lesson_motion_base",
            "live2d/motion/sub_arisa02_motion_base",
            "live2d/motion/sub_arisa_motion_base",
        ]);
    });

    test("fetchLive2DModelClips loads clips directly by modelId and falls back cleanly across candidate motion assets", async () => {
        clearLive2DModelClipsCache();
        const tried: string[] = [];
        const catalog = await fetchLive2DModelClips({
            sources: TEST_SOURCES,
            modelId: "v2_21miku_night",
            motionAsset: null,
            fetchBundleClips: async (sources, motionAsset) => {
                expect(sources).toEqual(TEST_SOURCES);
                tried.push(motionAsset);
                if (motionAsset === "live2d/motion/v2_21miku_motion_base") {
                    throw new Error("HTTP 404");
                }
                return {
                    motions: ["w-normal01-nod", "w-normal15-nod"],
                    facials: ["face_normal_01", "face_smile_01"],
                };
            },
        });

        expect(tried).toEqual([
            "live2d/motion/v2_21miku_motion_base",
            "live2d/motion/21miku_motion_base",
        ]);
        expect(catalog.motionAsset).toBe("live2d/motion/21miku_motion_base");
        expect(catalog.motionBundle).toBe("live2d/motion/21miku_motion_base");
        expect(catalog.motions).toEqual(["w-normal01-nod", "w-normal15-nod"]);
        expect(catalog.facials).toEqual(["face_normal_01", "face_smile_01"]);
    });

    test("resolveModelBundlesForStage falls back deterministically when model catalog is empty", () => {
        const resolved = resolveModelBundlesForStage("v2_17kanade_casual", []);
        expect(resolved).toEqual({
            asset: "live2d/model/v2_17kanade_casual",
            motion: "live2d/motion/v2_17kanade_motion_base",
            fallbackMotionCandidates: ["live2d/motion/17kanade_motion_base"],
            fromIndex: false,
        });
    });
});

describe("StoryStageController — empty-catalog fallback, graceful missing stage.js & off-stage preview triggers", () => {
    test("renders stage actors and falls back across motion assets (both 404 throw and silent no-motion return) when model catalog is empty", async () => {
        const stage = new FallbackTestStage();
        stage.missingMotionAssets.add("live2d/motion/v2_21miku_motion_base");
        stage.silentMissingMotionAssets.add("live2d/motion/v2_18mafuyu_motion_base");

        let receivedSources: Live2DSources | null = null;
        const StageStatic: Live2DStageStatic = {
            supported: async () => ({ ok: true, missing: [] }),
            create: async (opts: Live2DStageOptions) => {
                receivedSources = opts.sources;
                return stage;
            },
        };

        const controller = new StoryStageController({
            loadStage: async () => StageStatic,
            resolveScriptBase: () => "https://example.test/live2d-viewer/",
            resolveCoreUrl: () => "https://example.test/core.js",
        });

        // Empty models list (e.g. directory listing unavailable).
        controller.setContext({ cast: [CAST_KANADE, CAST_MIKU, CAST_MAFUYU], models: [] });
        controller.setConfig({ sources: TEST_SOURCES });
        controller.setHost(new MinimalHost());
        await waitMs(15);

        expect(receivedSources).toEqual(TEST_SOURCES);

        await controller.apply(makeStageState({
            actors: [
                { cast: "kanade", slot: "left", x: -0.4, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
                { cast: "miku", slot: "right", x: 0.4, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });

        // Both actors rendered cleanly with explicit trailing `/` directory paths; Miku automatically fell back to 21miku_motion_base/!
        expect(stage.actors).toEqual(["kanade", "miku"]);
        expect(stage.mounted.get("kanade")?.asset).toBe("live2d/model/v2_17kanade_casual/");
        expect(stage.mounted.get("kanade")?.motionAsset).toBe("live2d/motion/v2_17kanade_motion_base/");
        expect(stage.mounted.get("miku")?.asset).toBe("live2d/model/v2_21miku_night/");
        expect(stage.mounted.get("miku")?.motionAsset).toBe("live2d/motion/21miku_motion_base/");
        expect(controller.getSnapshot().problems).toEqual({});

        // Off-stage speaker (Mafuyu): silent missing v2 motion set falls back to 18mafuyu_motion_base/ cleanly!
        await controller.previewClip(CAST_MAFUYU, { motion: "w-kanade07-nod", facial: "face_sad_01" });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(controller.getSnapshot().previewingCastKey).toBe("mafuyu");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.asset).toBe("live2d/model/v2_18mafuyu_casual/");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motionAsset).toBe("live2d/motion/18mafuyu_motion_base/");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-kanade07-nod");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_sad_01");

        // Exit solo preview and test inline replay on an ON-STAGE speaker (Kanade): replays in-place without entering solo!
        controller.clearClipPreview();
        await waitMs(15);
        await controller.previewClip(CAST_KANADE, { motion: "w-kanade07-nod" });
        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(stage.mounted.get("kanade")?.motion).toBe("w-kanade07-nod");

        // Re-entering Mafuyu AFTER infoCache is populated reuses the resolved motion set directly (zero wasted v2 retry)!
        const attemptsBeforeReenter = stage.addAttempts.length;
        await controller.apply(makeStageState({
            actors: [
                { cast: "mafuyu", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });
        expect(stage.actors).toEqual(["mafuyu"]);
        expect(stage.mounted.get("mafuyu")?.motionAsset).toBe("live2d/motion/18mafuyu_motion_base/");
        expect(stage.addAttempts.slice(attemptsBeforeReenter)).toEqual([
            { id: "mafuyu", asset: "live2d/model/v2_18mafuyu_casual/", motion: "live2d/motion/18mafuyu_motion_base/" },
        ]);
        expect(stage.mounted.get("mafuyu")?.motion).toBe("w-normal15-nod");
        expect(stage.mounted.get("mafuyu")?.facial).toBe("face_smile_01");
        expect(controller.getSnapshot().problems).toEqual({});

        controller.dispose();
    });

    test("reuses exact resolved info.model / info.motionSet on re-entry and falls back to trailing `/` directory if cached exact path turns stale", async () => {
        const stage = new FallbackTestStage();
        const exactModel = "live2d/model/v2_17kanade_casual/live2d/model/v2/main/17_kanade/v2_17kanade_casual/buildmodeldata";
        const exactMotion = "live2d/motion/v2_17kanade_motion_base/live2d/motion/v2/main/17_kanade/v2_17kanade_motion_base/buildmotiondata";
        stage.resolvedModelMap.set("live2d/model/v2_17kanade_casual", exactModel);
        stage.resolvedMotionMap.set("live2d/motion/v2_17kanade_motion_base", exactMotion);

        const StageStatic: Live2DStageStatic = {
            supported: async () => ({ ok: true, missing: [] }),
            create: async () => stage,
        };

        const controller = new StoryStageController({
            loadStage: async () => StageStatic,
            resolveScriptBase: () => "https://example.test/live2d-viewer/",
            resolveCoreUrl: () => "https://example.test/core.js",
        });

        controller.setContext({ cast: [CAST_KANADE], models: [] });
        controller.setConfig({ sources: TEST_SOURCES });
        controller.setHost(new MinimalHost());
        await waitMs(15);

        // 1. Cold load passes explicit directory trailing `/` (0 404 `.asset.json` probes!)
        await controller.apply(makeStageState({
            actors: [
                { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });
        expect(stage.addAttempts[0]).toEqual({
            id: "kanade",
            asset: "live2d/model/v2_17kanade_casual/",
            motion: "live2d/motion/v2_17kanade_motion_base/",
        });

        // 2. Actor leaves and re-enters -> reuses exact resolved `.../buildmodeldata` & `.../buildmotiondata` (NO trailing `/`, 0 walks!)
        await controller.apply(makeStageState({ actors: [] }), { instant: true });
        const attemptsBeforeWarm = stage.addAttempts.length;
        await controller.apply(makeStageState({
            actors: [
                { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-kanade07-nod", facial: "face_sad_01" },
            ],
        }), { instant: true });
        expect(stage.addAttempts.slice(attemptsBeforeWarm)).toEqual([
            { id: "kanade", asset: exactModel, motion: exactMotion },
        ]);

        // 3. Simulate version rollover where cached exact paths become 404 -> falls back cleanly to explicit trailing `/` directory paths!
        await controller.apply(makeStageState({ actors: [] }), { instant: true });
        stage.missingModelAssets.add(exactModel);
        stage.missingMotionAssets.add(exactMotion);
        const attemptsBeforeStale = stage.addAttempts.length;
        await controller.apply(makeStageState({
            actors: [
                { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });
        expect(stage.actors).toEqual(["kanade"]);
        expect(stage.mounted.get("kanade")?.asset).toBe("live2d/model/v2_17kanade_casual/");
        expect(stage.mounted.get("kanade")?.motionAsset).toBe("live2d/motion/v2_17kanade_motion_base/");
        expect(stage.addAttempts.slice(attemptsBeforeStale)).toEqual([
            { id: "kanade", asset: exactModel, motion: exactMotion },
            { id: "kanade", asset: "live2d/model/v2_17kanade_casual/", motion: exactMotion },
            { id: "kanade", asset: "live2d/model/v2_17kanade_casual/", motion: "live2d/motion/v2_17kanade_motion_base/" },
        ]);
        expect(controller.getSnapshot().problems).toEqual({});

        controller.dispose();
    });

    test("uses exact canonical asset paths from /listings/ form index on the very first cold addActor (0 walks, 0 404s) and falls back to `/` dir if stale", async () => {
        const VERSION = "7.1.0-stage-index";
        const exactModel = "live2d/model/v2_17kanade_casual/live2d/model/v2/main/17_kanade/v2_17kanade_casual/buildmodeldata";
        const exactMotion = "live2d/motion/v2_17kanade_motion_base/live2d/motion/v2/main/17_kanade/v2_17kanade_motion_base/buildmotiondata";
        const stage = new FallbackTestStage();
        stage.base = `https://storage.test/jp@${VERSION}/`;

        const StageStatic: Live2DStageStatic = {
            supported: async () => ({ ok: true, missing: [] }),
            create: async () => stage,
        };

        try {
            clearLive2DSiteCache();
            configureStoryCore({
                fetchImpl: (async (input: string | URL | Request) => {
                    const url = String(input);
                    if (url === "https://storage.test/listings/jp/canonical/live2d-model") {
                        return new Response(JSON.stringify({
                            format: "form-listing",
                            version: 1,
                            view: "canonical",
                            published_version: VERSION,
                            form: "live2d-model",
                            assets: [{ name: exactModel }],
                        }), { status: 200 });
                    }
                    if (url === "https://storage.test/listings/jp/canonical/live2d-motions") {
                        return new Response(JSON.stringify({
                            format: "form-listing",
                            version: 1,
                            view: "canonical",
                            published_version: VERSION,
                            form: "live2d-motions",
                            assets: [{ name: exactMotion }],
                        }), { status: 200 });
                    }
                    return new Response("Not Found", { status: 404 });
                }) as unknown as typeof fetch,
            });

            await fetchLive2DFormListing(TEST_SOURCES, "live2d-model");
            await fetchLive2DFormListing(TEST_SOURCES, "live2d-motions");

            const controller = new StoryStageController({
                loadStage: async () => StageStatic,
                resolveScriptBase: () => "https://example.test/live2d-viewer/",
                resolveCoreUrl: () => "https://example.test/core.js",
            });

            controller.setContext({ cast: [CAST_KANADE], models: [] });
            controller.setConfig({ sources: TEST_SOURCES });
            controller.setHost(new MinimalHost());
            await waitMs(15);

            // Cold first addActor uses exact `.../buildmodeldata` & `.../buildmotiondata` immediately!
            await controller.apply(makeStageState({
                actors: [
                    { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
                ],
            }), { instant: true });
            expect(stage.addAttempts).toEqual([
                { id: "kanade", asset: exactModel, motion: exactMotion },
            ]);
            expect(controller.getSnapshot().problems).toEqual({});

            controller.dispose();
        } finally {
            clearLive2DSiteCache();
            resetStoryCoreConfig();
        }
    });

    test("prefers version-matched /listings/ exact paths over stale v1 cachedInfo across crash recovery and never regresses to bare cachedInfo.model", async () => {
        const V1 = "7.1.0-v1";
        const V2 = "7.2.0-v2";
        const v1Model = "live2d/model/v2_17kanade_casual/v1/buildmodeldata";
        const v1Motion = "live2d/motion/v2_17kanade_motion_base/v1/buildmotiondata";
        const v2Model = "live2d/model/v2_17kanade_casual/v2/buildmodeldata";
        const v2Motion = "live2d/motion/v2_17kanade_motion_base/v2/buildmotiondata";

        const stage1 = new FallbackTestStage();
        stage1.base = `https://storage.test/jp@${V1}/`;
        // Simulate a mock/custom stage returning bare container path for info.model on stage1
        stage1.resolvedModelMap.set(v1Model, "live2d/model/v2_17kanade_casual");
        stage1.resolvedMotionMap.set(v1Motion, v1Motion);

        const stage2 = new FallbackTestStage();
        stage2.base = `https://storage.test/jp@${V2}/`;
        stage2.resolvedModelMap.set(v2Model, v2Model);
        stage2.resolvedMotionMap.set(v2Motion, v2Motion);

        const stages = [stage1, stage2];
        let createIdx = 0;
        const StageStatic: Live2DStageStatic = {
            supported: async () => ({ ok: true, missing: [] }),
            create: async () => stages[createIdx++]!,
        };

        try {
            clearLive2DSiteCache();
            configureStoryCore({
                fetchImpl: (async (input: string | URL | Request) => {
                    const url = String(input);
                    if (url === `https://storage.test/listings/jp/canonical@${V1}/live2d-model`) {
                        return new Response(JSON.stringify({
                            format: "form-listing", version: 1, published_version: V1, form: "live2d-model",
                            assets: [{ name: v1Model }],
                        }), { status: 200 });
                    }
                    if (url === `https://storage.test/listings/jp/canonical@${V1}/live2d-motions`) {
                        return new Response(JSON.stringify({
                            format: "form-listing", version: 1, published_version: V1, form: "live2d-motions",
                            assets: [{ name: v1Motion }],
                        }), { status: 200 });
                    }
                    if (url === `https://storage.test/listings/jp/canonical@${V2}/live2d-model`) {
                        return new Response(JSON.stringify({
                            format: "form-listing", version: 1, published_version: V2, form: "live2d-model",
                            assets: [{ name: v2Model }],
                        }), { status: 200 });
                    }
                    if (url === `https://storage.test/listings/jp/canonical@${V2}/live2d-motions`) {
                        return new Response(JSON.stringify({
                            format: "form-listing", version: 1, published_version: V2, form: "live2d-motions",
                            assets: [{ name: v2Motion }],
                        }), { status: 200 });
                    }
                    return new Response("Not Found", { status: 404 });
                }) as unknown as typeof fetch,
            });

            await fetchLive2DFormListing({ ...TEST_SOURCES, version: V1 }, "live2d-model");
            await fetchLive2DFormListing({ ...TEST_SOURCES, version: V1 }, "live2d-motions");
            await fetchLive2DFormListing({ ...TEST_SOURCES, version: V2 }, "live2d-model");
            await fetchLive2DFormListing({ ...TEST_SOURCES, version: V2 }, "live2d-motions");

            const controller = new StoryStageController({
                loadStage: async () => StageStatic,
                resolveScriptBase: () => "https://example.test/live2d-viewer/",
                resolveCoreUrl: () => "https://example.test/core.js",
                recoveryDelaysMs: [5],
            });

            controller.setContext({ cast: [CAST_KANADE], models: [] });
            controller.setConfig({ sources: TEST_SOURCES });
            controller.setHost(new MinimalHost());
            await waitMs(15);

            // 1. Mount on stage1 (V1); stage1 populates infoCache with bare `live2d/model/v2_17kanade_casual` & v1Motion.
            await controller.apply(makeStageState({
                actors: [{ cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" }],
            }), { instant: true });
            expect(stage1.addAttempts).toEqual([{ id: "kanade", asset: v1Model, motion: v1Motion }]);

            // 2. Re-enter on stage1 (V1): bare cachedInfo.model must NOT overwrite V1's exact `/listings/` path!
            await controller.apply(makeStageState({ actors: [] }), { instant: true });
            await controller.apply(makeStageState({
                actors: [{ cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" }],
            }), { instant: true });
            expect(stage1.addAttempts[1]).toEqual({ id: "kanade", asset: v1Model, motion: v1Motion });

            // 3. Crash stage1 -> recover onto stage2 (V2): V2's exact `/listings/` paths MUST win over stale V1 cachedInfo!
            stage1.dispatchEvent(new CustomEvent("error", { detail: { message: "GPU lost", kind: "internal" } }));
            await waitMs(40);
            expect(stage2.addAttempts).toEqual([{ id: "kanade", asset: v2Model, motion: v2Motion }]);
            expect(controller.getSnapshot().problems).toEqual({});

            controller.dispose();
        } finally {
            clearLive2DSiteCache();
            resetStoryCoreConfig();
        }
    });

    test("surfaces diagnostic message & url when host serves viewer release without stage.js", async () => {
        const missingUrl = "https://example.test/live2d-viewer/0.2.0/stage.js";
        const controller = new StoryStageController({
            loadStage: async () => {
                throw createLive2DStageUnavailableError(missingUrl, new Error("HTTP 404 Not Found"));
            },
            resolveScriptBase: () => "https://example.test/live2d-viewer/0.2.0/",
            recoveryDelaysMs: [5, 5],
        });

        controller.setContext({ cast: [CAST_KANADE], models: [] });
        controller.setConfig({
            sources: TEST_SOURCES,
            scriptBase: "/live2d-viewer/0.2.0/",
            scriptVersion: "0.2.0",
        });
        controller.setHost(new MinimalHost());
        await waitMs(25);

        const phase = controller.getSnapshot().phase;
        expect(phase.kind).toBe("unavailable");
        if (phase.kind === "unavailable") {
            expect(phase.url).toBe(missingUrl);
            expect(phase.message).toContain("HTTP 404 Not Found");
        }
        controller.dispose();
    });
});
