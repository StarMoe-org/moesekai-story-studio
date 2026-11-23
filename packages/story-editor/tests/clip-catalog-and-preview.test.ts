import { describe, expect, test } from "bun:test";
import { INITIAL_STAGE_STATE, type Live2DSources, type StoryCastMember, type StoryStageState } from "@moesekai/story-core";
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
    readonly mounted = new Map<string, { asset: string; motionAsset: string | null; motion: string | null; facial: string | null }>();
    readonly addAttempts: Array<{ id: string; asset: string; motion: string | null }> = [];
    readonly missingMotionAssets = new Set<string>();
    readonly silentMissingMotionAssets = new Set<string>();
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
        if (motionAsset && this.missingMotionAssets.has(motionAsset)) {
            throw Object.assign(new Error(`the asset site has no ${motionAsset}`), {
                kind: "not-found",
                url: `https://storage.test/jp@1.0.0/${motionAsset}/buildmotiondata.asset.json`,
            });
        }
        if (motionAsset && this.silentMissingMotionAssets.has(motionAsset)) {
            if (placement?.motion) {
                throw Object.assign(new Error(`no body motion ${placement.motion}`), { kind: "internal" });
            }
            if (placement?.facial) {
                throw Object.assign(new Error(`no facial ${placement.facial}`), { kind: "internal" });
            }
            const emptyInfo: Live2DActorInfo = {
                model: model.asset,
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
        const info: Live2DActorInfo = {
            model: model.asset,
            motionSet: motionAsset,
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

        // Both actors rendered cleanly with deterministic assets; Miku automatically fell back to 21miku_motion_base!
        expect(stage.actors).toEqual(["kanade", "miku"]);
        expect(stage.mounted.get("kanade")?.asset).toBe("live2d/model/v2_17kanade_casual");
        expect(stage.mounted.get("kanade")?.motionAsset).toBe("live2d/motion/v2_17kanade_motion_base");
        expect(stage.mounted.get("miku")?.asset).toBe("live2d/model/v2_21miku_night");
        expect(stage.mounted.get("miku")?.motionAsset).toBe("live2d/motion/21miku_motion_base");
        expect(controller.getSnapshot().problems).toEqual({});

        // Off-stage speaker (Mafuyu): silent missing v2 motion set falls back to 18mafuyu_motion_base cleanly!
        await controller.previewClip(CAST_MAFUYU, { motion: "w-kanade07-nod", facial: "face_sad_01" });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(controller.getSnapshot().previewingCastKey).toBe("mafuyu");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.asset).toBe("live2d/model/v2_18mafuyu_casual");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motionAsset).toBe("live2d/motion/18mafuyu_motion_base");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-kanade07-nod");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_sad_01");

        // Exit solo preview and test inline replay on an ON-STAGE speaker (Kanade): replays in-place without entering solo!
        controller.clearClipPreview();
        await waitMs(15);
        await controller.previewClip(CAST_KANADE, { motion: "w-kanade07-nod" });
        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(stage.mounted.get("kanade")?.motion).toBe("w-kanade07-nod");

        // Re-entering Mafuyu AFTER infoCache is populated passes initialMotion/initialFacial to addActor;
        // SekaiLive2DStage 0.3.0 rejects missing v2 motion set with `no body motion ...`, and controller falls back cleanly!
        await controller.apply(makeStageState({
            actors: [
                { cast: "mafuyu", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });
        expect(stage.actors).toEqual(["mafuyu"]);
        expect(stage.mounted.get("mafuyu")?.motionAsset).toBe("live2d/motion/18mafuyu_motion_base");
        expect(stage.mounted.get("mafuyu")?.motion).toBe("w-normal15-nod");
        expect(stage.mounted.get("mafuyu")?.facial).toBe("face_smile_01");
        expect(controller.getSnapshot().problems).toEqual({});

        controller.dispose();
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
