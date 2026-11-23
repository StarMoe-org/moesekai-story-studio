import { describe, expect, test } from "bun:test";
import { INITIAL_STAGE_STATE, type StoryCastMember, type StoryStageState } from "@moesekai/story-core";
import { canBrowseClipPicker } from "../src/components/ClipPickerField";
import {
    candidateMotionBundlesForModelId,
    clearLive2DModelClipsCache,
    fetchLive2DModelClips,
    resolveModelBundlesForStage,
} from "../src/live2d/clipCatalog";
import type { Live2DActorInfo, Live2DActorPlacement, Live2DStage, Live2DStageOptions, Live2DStageStatic } from "../src/live2d/stage";
import {
    SOLO_PREVIEW_ACTOR_ID,
    StoryStageController,
    type StageCanvasSize,
    type StageHostAdapter,
} from "../src/live2d/stageController";

const CAST_KANADE: StoryCastMember = { key: "kanade", name: "宵崎奏", modelId: "v2_17kanade_casual", characterId: 17 };
const CAST_MIKU: StoryCastMember = { key: "miku", name: "初音未来", modelId: "v2_21miku_night", characterId: 21 };
const CAST_MAFUYU: StoryCastMember = { key: "mafuyu", name: "朝比奈真冬", modelId: "v2_18mafuyu_casual", characterId: 18 };

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
    readonly mounted = new Map<string, { bundle: string; motionBundle: string | null; motion: string | null; facial: string | null }>();
    readonly addAttempts: Array<{ id: string; bundle: string; motion: string | null }> = [];
    readonly missingMotionBundles = new Set<string>();
    paused = false;

    get actors(): string[] {
        return [...this.mounted.keys()];
    }

    async addActor(
        id: string,
        model: { bundle: string; motion: string | null },
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
    ): Promise<Live2DActorInfo> {
        this.addAttempts.push({ id, bundle: model.bundle, motion: model.motion });
        await waitMs(2);
        if (model.motion && this.missingMotionBundles.has(model.motion)) {
            throw Object.assign(new Error(`the library has no ${model.motion}`), {
                kind: "not-found",
                url: `https://assets.test/jp/library/${model.motion}/_ripper.json`,
            });
        }
        const info: Live2DActorInfo = {
            motions: ["w-normal01-tilthead", "w-normal15-nod", "w-kanade07-nod"],
            facials: ["face_normal_01", "face_smile_01", "face_sad_01"],
            defaultMotion: "w-normal01-tilthead",
            defaultFacial: "face_normal_01",
            hasPhysics: true,
        };
        this.mounted.set(id, {
            bundle: model.bundle,
            motionBundle: model.motion,
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

describe("ClipPickerField browse gating & direct modelId clip catalog", () => {
    test("enables Browse immediately with modelId + library even when modelInfo is empty (0 actors on stage) and motionBundle is null", () => {
        expect(canBrowseClipPicker({
            disabled: false,
            info: undefined,
            library: "https://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/",
            modelId: "v2_17kanade_casual",
            motionBundle: null,
        })).toBe(true);

        // Still disabled when field is explicitly disabled or no model/motion source exists.
        expect(canBrowseClipPicker({
            disabled: true,
            info: undefined,
            library: "https://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/",
            modelId: "v2_17kanade_casual",
            motionBundle: null,
        })).toBe(false);

        expect(canBrowseClipPicker({
            disabled: false,
            info: undefined,
            library: "https://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/",
            modelId: null,
            motionBundle: null,
        })).toBe(false);
    });

    test("derives ordered candidate motion bundles for v2, gen-1, and sub character modelIds", () => {
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

    test("fetchLive2DModelClips loads clips directly by modelId and falls back cleanly across candidate motion bundles", async () => {
        clearLive2DModelClipsCache();
        const tried: string[] = [];
        const catalog = await fetchLive2DModelClips({
            library: "https://assets.test/jp/",
            modelId: "v2_21miku_night",
            motionBundle: null,
            fetchBundleClips: async (_lib, bundle) => {
                tried.push(bundle);
                if (bundle === "live2d/motion/v2_21miku_motion_base") {
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
        expect(catalog.motionBundle).toBe("live2d/motion/21miku_motion_base");
        expect(catalog.motions).toEqual(["w-normal01-nod", "w-normal15-nod"]);
        expect(catalog.facials).toEqual(["face_normal_01", "face_smile_01"]);
    });

    test("resolveModelBundlesForStage falls back deterministically when models.json is empty", () => {
        const resolved = resolveModelBundlesForStage("v2_17kanade_casual", []);
        expect(resolved).toEqual({
            bundle: "live2d/model/v2_17kanade_casual",
            motion: "live2d/motion/v2_17kanade_motion_base",
            fallbackMotionCandidates: ["live2d/motion/17kanade_motion_base"],
            fromIndex: false,
        });
    });
});

describe("StoryStageController — empty-index fallback & off-stage preview triggers", () => {
    test("renders stage actors and falls back across motion bundles even when models index is empty", async () => {
        const stage = new FallbackTestStage();
        stage.missingMotionBundles.add("live2d/motion/v2_21miku_motion_base");

        const StageStatic: Live2DStageStatic = {
            supported: async () => ({ ok: true, missing: [] }),
            create: async (_opts: Live2DStageOptions) => stage,
        };

        const controller = new StoryStageController({
            loadStage: async () => StageStatic,
            resolveScriptBase: () => "https://example.test/live2d-viewer/",
            resolveCoreUrl: () => "https://example.test/core.js",
        });

        // Empty models list (e.g. models.json 404).
        controller.setContext({ cast: [CAST_KANADE, CAST_MIKU, CAST_MAFUYU], models: [] });
        controller.setConfig({ library: "https://assets.test/jp/" });
        controller.setHost(new MinimalHost());
        await waitMs(15);

        await controller.apply(makeStageState({
            actors: [
                { cast: "kanade", slot: "left", x: -0.4, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
                { cast: "miku", slot: "right", x: 0.4, y: 0, scale: 1, mirror: false, motion: "w-normal15-nod", facial: "face_smile_01" },
            ],
        }), { instant: true });

        // Both actors rendered cleanly with deterministic bundles; Miku automatically fell back to 21miku_motion_base!
        expect(stage.actors).toEqual(["kanade", "miku"]);
        expect(stage.mounted.get("kanade")?.bundle).toBe("live2d/model/v2_17kanade_casual");
        expect(stage.mounted.get("kanade")?.motionBundle).toBe("live2d/motion/v2_17kanade_motion_base");
        expect(stage.mounted.get("miku")?.bundle).toBe("live2d/model/v2_21miku_night");
        expect(stage.mounted.get("miku")?.motionBundle).toBe("live2d/motion/21miku_motion_base");
        expect(controller.getSnapshot().problems).toEqual({});

        // Off-stage speaker `重播动作` / inline `▶` (Mafuyu is NOT on stage): routes automatically to Solo Preview!
        await controller.previewClip(CAST_MAFUYU, { motion: "w-kanade07-nod", facial: "face_sad_01" });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(controller.getSnapshot().previewingCastKey).toBe("mafuyu");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.bundle).toBe("live2d/model/v2_18mafuyu_casual");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-kanade07-nod");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_sad_01");

        // Exit solo preview and test inline `▶` on an ON-STAGE speaker (Kanade): replays in-place without entering solo!
        controller.clearClipPreview();
        await waitMs(15);
        await controller.previewClip(CAST_KANADE, { motion: "w-kanade07-nod" });
        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(stage.mounted.get("kanade")?.motion).toBe("w-kanade07-nod");

        controller.dispose();
    });
});
