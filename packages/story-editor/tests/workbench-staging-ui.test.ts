import { describe, expect, test } from "bun:test";
import {
    addCastMember,
    connectEdge,
    createNode,
    createStoryDocument,
    deferStageCastAfterTelop,
    evaluateStageAt,
    findLeadingTelopEndIndex,
    insertBeat,
    setSceneStageCast,
    setSceneTransition,
    updateSceneStageCastSettings,
    type SceneNode,
    type StageActionBeat,
    type StageActionItem,
    type StoryDocument,
} from "@moesekai/story-core";
import { summarizeActiveBeat } from "../src/components/LivePhasePanel";
import {
    changeStageActionItemKind,
    changeStageActionPrimaryKind,
    patchStageActionItem,
    patchStageActionPrimary,
    resolveSceneCastEnterTransition,
} from "../src/components/NodeInspector";
import { collectCastFirstNodeMap } from "../src/components/StoryEditorBin";
import { formatStageActionBeatSummary } from "../src/components/StoryFlowCanvas";
import {
    actorCoordsToStagePercent,
    clampStageActorY,
    projectStagePointerToActorCoords,
    resolveFallbackActorOpacity,
} from "../src/components/StoryStageView";
import {
    STORY_MAKER_MESSAGES_BY_LOCALE,
    createStudioTranslator,
    type StoryStudioLocale,
} from "../src/messages";
import { commitStageActorDrag } from "../src/studio/StoryStudioEditor";

const ALL_LOCALES: StoryStudioLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    const out: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === "object" && !Array.isArray(val)) {
            out.push(...flattenKeys(val as Record<string, unknown>, path));
        } else {
            out.push(path);
        }
    }
    return out.sort();
}

function buildTestStory(): { doc: StoryDocument; sceneId: string } {
    let doc = createStoryDocument("jp", "Workbench Staging Test");
    doc = addCastMember(doc, { key: "ichika", modelId: "v2_01ichika_casual", name: "一歌", characterId: 1 });
    doc = addCastMember(doc, { key: "saki", modelId: "v2_02saki_casual", name: "咲希", characterId: 2 });
    doc = addCastMember(doc, { key: "honami", modelId: "v2_03honami_casual", name: "穂波", characterId: 3 });
    const created = createNode(doc, "scene", { x: 240, y: 120 }, { id: "scene_1", title: "Scene 1" });
    doc = connectEdge(created.doc, doc.startNodeId, "out", created.node!.id);
    return { doc, sceneId: created.node!.id };
}

describe("Human Workbench Staging, Fine-Tune & Choreography UI", () => {
    test("projectStagePointerToActorCoords projects 1:1 with actorCoordsToStagePercent and clamps to STORY_LIMITS", () => {
        const rect = { width: 1000, height: 562.5 };

        // Exact 1:1 horizontal delta: moving +100px on a 1000px stage (+0.20 in [-1, 1] space)
        const movedRight = projectStagePointerToActorCoords({
            clientX: 600,
            clientY: 300,
            rect,
            startX: 0,
            startY: 0,
            startClientX: 500,
            startClientY: 300,
        });
        expect(movedRight).toEqual({ x: 0.2, y: 0 });

        // Moving up increases Y; moving down decreases Y
        const movedUp = projectStagePointerToActorCoords({
            clientX: 500,
            clientY: 300 - rect.height * 0.45 * 0.25,
            rect,
            startX: -0.35,
            startY: 0,
            startClientX: 500,
            startClientY: 300,
        });
        expect(movedUp).toEqual({ x: -0.35, y: 0.25 });

        // Extreme pointer drags clamp cleanly to [-1.2, +1.2] for X and [-0.6, +0.6] for Y
        const clampedMax = projectStagePointerToActorCoords({
            clientX: 5000,
            clientY: -5000,
            rect,
            startX: 0,
            startY: 0,
            startClientX: 500,
            startClientY: 300,
        });
        expect(clampedMax).toEqual({ x: 1.2, y: 0.6 });

        const clampedMin = projectStagePointerToActorCoords({
            clientX: -5000,
            clientY: 5000,
            rect,
            startX: 0,
            startY: 0,
            startClientX: 500,
            startClientY: 300,
        });
        expect(clampedMin).toEqual({ x: -1.2, y: -0.6 });

        // Stage handle percent conversion stays comfortably grabbable inside [4..96]% x [16..84]%
        expect(actorCoordsToStagePercent(0, 0)).toEqual({ leftPct: 50, topPct: 52 });
        expect(actorCoordsToStagePercent(-1.2, 0.6)).toEqual({ leftPct: 4, topPct: 25 });
        expect(actorCoordsToStagePercent(1.2, -0.6)).toEqual({ leftPct: 96, topPct: 79 });
        expect(clampStageActorY(Number.NaN)).toBe(0);
    });

    test("resolveFallbackActorOpacity mirrors WebGPU telop actorVisibility semantics", () => {
        expect(resolveFallbackActorOpacity(undefined)).toBe(1);
        expect(resolveFallbackActorOpacity("keep")).toBe(1);
        expect(resolveFallbackActorOpacity("dim")).toBe(0.28);
        expect(resolveFallbackActorOpacity("hide")).toBe(0);
    });

    test("commitStageActorDrag updates stageCast, selected StageActionBeat primary/group, and inherited cast", () => {
        let { doc, sceneId } = buildTestStory();
        doc = setSceneStageCast(doc, sceneId, {
            mode: "set",
            actors: [
                { castKey: "ichika", slot: "left" },
                { castKey: "saki", slot: "right" },
            ],
        });

        // 1. Dragging while inspecting the SceneNode patches scene.stageCast actor (clamped)
        const afterSceneDrag = commitStageActorDrag(doc, {
            sceneId,
            beatId: null,
            castKey: "ichika",
            x: -0.42,
            y: 0.14,
        });
        const sceneAfterDrag = afterSceneDrag.nodes[sceneId] as SceneNode;
        expect(sceneAfterDrag.stageCast.mode).toBe("set");
        if (sceneAfterDrag.stageCast.mode === "set") {
            expect(sceneAfterDrag.stageCast.actors[0]).toMatchObject({ castKey: "ichika", x: -0.42, y: 0.14 });
            expect(sceneAfterDrag.stageCast.actors[1].x).toBeUndefined();
        }

        // 2. Dragging while a multi-actor StageActionBeat is selected patches either primary or group item
        const syncBeat: StageActionBeat = {
            id: "beat_sync",
            kind: "stageAction",
            action: "enter",
            castKey: "ichika",
            slot: "left",
            group: [
                { action: "enter", castKey: "saki", slot: "right" },
            ],
        };
        const withBeat = insertBeat(doc, sceneId, syncBeat);
        const afterGroupDrag = commitStageActorDrag(withBeat, {
            sceneId,
            beatId: "beat_sync",
            castKey: "saki",
            x: 0.58,
            y: -0.1,
        });
        const patchedBeat = (afterGroupDrag.nodes[sceneId] as SceneNode).beats[0] as StageActionBeat;
        expect(patchedBeat.x).toBeUndefined();
        expect(patchedBeat.group?.[0]).toMatchObject({ castKey: "saki", x: 0.58, y: -0.1 });

        // 3. Dragging on an inherit-cast downstream scene materializes stageCast preserving attributes & layoutMode
        const fixedUpstream = updateSceneStageCastSettings(afterSceneDrag, sceneId, { layoutMode: "fixed" });
        const scene2Res = createNode(fixedUpstream, "scene", { x: 640, y: 120 }, { id: "scene_2", title: "Scene 2" });
        const chainedDoc = connectEdge(scene2Res.doc, sceneId, "out", "scene_2");
        const afterInheritDrag = commitStageActorDrag(chainedDoc, {
            sceneId: "scene_2",
            beatId: null,
            castKey: "saki",
            x: 0.25,
            y: 0.08,
        });
        const scene2 = afterInheritDrag.nodes["scene_2"] as SceneNode;
        expect(scene2.stageCast.mode).toBe("set");
        if (scene2.stageCast.mode === "set") {
            expect(scene2.stageCast.layoutMode).toBe("fixed");
            expect(scene2.stageCast.actors.find(a => a.castKey === "saki")).toMatchObject({ x: 0.25, y: 0.08 });
            expect(scene2.stageCast.actors.find(a => a.castKey === "ichika")).toMatchObject({ x: -0.42, y: 0.14 });
        }
    });

    test("resolveSceneCastEnterTransition mirrors buildStageCastApplyPlan defaults and explicit overrides", () => {
        let { doc, sceneId } = buildTestStory();
        doc = setSceneStageCast(doc, sceneId, {
            mode: "set",
            actors: [{ castKey: "ichika", slot: "center" }],
        });
        doc = setSceneTransition(doc, sceneId, { kind: "none", duration: 0.4 });

        // Bare transition: none scene defaults to instant pop-in
        expect(resolveSceneCastEnterTransition(doc.nodes[sceneId] as SceneNode)).toBe("instant");

        // Explicit "fade" persists via updateSceneStageCastSettings and resolves to "fade"
        const explicitFadeDoc = updateSceneStageCastSettings(doc, sceneId, { enterTransition: "fade" });
        const explicitFadeScene = explicitFadeDoc.nodes[sceneId] as SceneNode;
        expect(explicitFadeScene.stageCast.mode === "set" && explicitFadeScene.stageCast.enterTransition).toBe("fade");
        expect(resolveSceneCastEnterTransition(explicitFadeScene)).toBe("fade");

        // Delay, explicit duration, afterTelop, or non-none scene transition default to "fade"
        expect(
            resolveSceneCastEnterTransition(
                updateSceneStageCastSettings(doc, sceneId, { enterDelay: 0.5 }).nodes[sceneId] as SceneNode,
            ),
        ).toBe("fade");
        expect(
            resolveSceneCastEnterTransition(
                updateSceneStageCastSettings(doc, sceneId, { enterDuration: 0.6 }).nodes[sceneId] as SceneNode,
            ),
        ).toBe("fade");
        expect(
            resolveSceneCastEnterTransition(
                updateSceneStageCastSettings(doc, sceneId, { enterTiming: "afterTelop" }).nodes[sceneId] as SceneNode,
            ),
        ).toBe("fade");
        const fadeBlackDoc = setSceneTransition(doc, sceneId, { kind: "fadeBlack", duration: 0.5 });
        expect(resolveSceneCastEnterTransition(fadeBlackDoc.nodes[sceneId] as SceneNode)).toBe("fade");

        // Explicit "instant" overrides fadeBlack / afterTelop fade defaults
        const explicitInstantDoc = updateSceneStageCastSettings(fadeBlackDoc, sceneId, {
            enterTiming: "afterTelop",
            enterTransition: "instant",
        });
        expect(resolveSceneCastEnterTransition(explicitInstantDoc.nodes[sceneId] as SceneNode)).toBe("instant");
    });

    test("stageAction primary and group patch/kind helpers preserve explicit false overrides on move/pose", () => {
        const moveBeat: StageActionBeat = {
            id: "b_move",
            kind: "stageAction",
            action: "move",
            castKey: "ichika",
            slot: "left",
            lockX: false,
            mirror: false,
            allowOverlap: false,
        };

        // Editing an unrelated field (slot/delay) must not strip explicit false flags on move
        const afterSlotEdit = patchStageActionPrimary(moveBeat, { slot: "right", delay: 0.5 });
        expect(afterSlotEdit.lockX).toBe(false);
        expect(afterSlotEdit.mirror).toBe(false);
        expect(afterSlotEdit.allowOverlap).toBe(false);
        expect(afterSlotEdit.delay).toBe(0.5);

        // Switching move -> pose preserves mirror: false and lockX: false; switching pose -> move keeps both
        const asPose = changeStageActionPrimaryKind(afterSlotEdit, "pose");
        expect(asPose.mirror).toBe(false);
        expect(asPose.lockX).toBe(false);
        const posePatched = patchStageActionPrimary(asPose, { motion: "w-cute-nod01" });
        expect(posePatched.mirror).toBe(false);
        expect(posePatched.lockX).toBe(false);
        const backToMove = changeStageActionPrimaryKind(posePatched, "move");
        expect(backToMove.mirror).toBe(false);
        expect(backToMove.lockX).toBe(false);

        // Switching to enter cleans redundant false flags (enter always starts fresh)
        const asEnter = changeStageActionPrimaryKind(moveBeat, "enter");
        expect(asEnter.lockX).toBeUndefined();
        expect(asEnter.mirror).toBeUndefined();
        expect(asEnter.allowOverlap).toBeUndefined();
        const enterPatched = patchStageActionPrimary(asEnter, { mirror: false, lockX: false, transition: "fade" });
        expect(enterPatched.mirror).toBeUndefined();
        expect(enterPatched.lockX).toBeUndefined();
        expect(enterPatched.transition).toBe("fade");

        // Group items preserve explicit false flags on move/pose and clean them on enter
        const moveItem: StageActionItem = {
            action: "move",
            castKey: "saki",
            slot: "right",
            lockX: false,
            mirror: false,
            allowOverlap: false,
        };
        const itemEdited = patchStageActionItem(moveItem, { duration: 0.8 });
        expect(itemEdited.lockX).toBe(false);
        expect(itemEdited.mirror).toBe(false);
        expect(itemEdited.allowOverlap).toBe(false);
        const itemAsPose = changeStageActionItemKind(itemEdited, "pose");
        expect(itemAsPose.mirror).toBe(false);
        expect(itemAsPose.lockX).toBe(false);
        const itemAsEnter = changeStageActionItemKind(itemEdited, "enter");
        expect(itemAsEnter.lockX).toBeUndefined();
        expect(itemAsEnter.mirror).toBeUndefined();
        expect(itemAsEnter.allowOverlap).toBeUndefined();
    });

    test("StoryEditorBin castFirstNode and LivePhasePanel summarizeActiveBeat handle multi-actor group beats", () => {
        let { doc, sceneId } = buildTestStory();
        const groupBeat: StageActionBeat = {
            id: "b_group",
            kind: "stageAction",
            action: "enter",
            castKey: "ichika",
            slot: "left",
            group: [
                { action: "enter", castKey: "saki", slot: "center" },
                { action: "exit", castKey: "honami" },
            ],
        };
        doc = insertBeat(doc, sceneId, groupBeat);

        // StoryEditorBin links group-only cast members (saki, honami) to their first scene
        const firstNodes = collectCastFirstNodeMap(doc.nodes);
        expect(firstNodes.get("ichika")).toBe(sceneId);
        expect(firstNodes.get("saki")).toBe(sceneId);
        expect(firstNodes.get("honami")).toBe(sceneId);

        // LivePhasePanel summarizes single and multi-actor stageAction beats consistently with StoryFlowCanvas
        const t = createStudioTranslator("en-US");
        expect(summarizeActiveBeat(groupBeat, doc, {}, t)).toBe("Stage Action (3) · 一歌、咲希 +1");
        const duoBeat: StageActionBeat = {
            id: "b_duo",
            kind: "stageAction",
            action: "exit",
            castKey: "ichika",
            group: [{ action: "exit", castKey: "saki" }],
        };
        expect(summarizeActiveBeat(duoBeat, doc, {}, t)).toBe("Exit stage (2) · 一歌、咲希");
    });

    test("formatStageActionBeatSummary summarizes single, uniform multi-actor, and mixed multi-actor beats", () => {
        const t = createStudioTranslator("en-US");
        const castMap = new Map([
            ["ichika", "Ichika"],
            ["saki", "Saki"],
            ["honami", "Honami"],
        ]);

        const singleBeat: StageActionBeat = {
            id: "b1",
            kind: "stageAction",
            action: "enter",
            castKey: "ichika",
            slot: "left",
        };
        expect(formatStageActionBeatSummary(singleBeat, castMap, t)).toBe("Enter stage · Ichika");

        const duoEnterBeat: StageActionBeat = {
            id: "b2",
            kind: "stageAction",
            action: "enter",
            castKey: "ichika",
            slot: "left",
            group: [{ action: "enter", castKey: "saki", slot: "right" }],
        };
        expect(formatStageActionBeatSummary(duoEnterBeat, castMap, t)).toBe("Enter stage (2) · Ichika、Saki");

        const mixedTrioBeat: StageActionBeat = {
            id: "b3",
            kind: "stageAction",
            action: "enter",
            castKey: "ichika",
            slot: "left",
            group: [
                { action: "exit", castKey: "saki" },
                { action: "move", castKey: "honami", slot: "right" },
            ],
        };
        expect(formatStageActionBeatSummary(mixedTrioBeat, castMap, t)).toBe("Stage Action (3) · Ichika、Saki +1");
    });

    test("telop deferral helper shifts stageCast to enter after leading telop", () => {
        let { doc, sceneId } = buildTestStory();
        doc = setSceneStageCast(doc, sceneId, {
            mode: "set",
            actors: [{ castKey: "ichika", slot: "center" }],
        });
        doc = insertBeat(doc, sceneId, { id: "telop_1", kind: "telop", text: "After School" });
        doc = insertBeat(doc, sceneId, { id: "talk_1", kind: "talk", speakerKey: "ichika", body: "Hello!" });

        const sceneBefore = doc.nodes[sceneId] as SceneNode;
        expect(findLeadingTelopEndIndex(sceneBefore.beats)).toBe(0);
        // Before deferral: actors are already mounted during the leading telop
        expect(evaluateStageAt(doc, sceneId, "telop_1").stage.actors.length).toBe(1);

        // One-click deferral sets enterTiming: "afterTelop"
        const deferred = deferStageCastAfterTelop(doc, sceneId, true);
        const sceneAfter = deferred.nodes[sceneId] as SceneNode;
        expect(sceneAfter.stageCast.mode === "set" && sceneAfter.stageCast.enterTiming).toBe("afterTelop");

        // During leading telop: zero actors on stage; on post-telop talk beat: actors mounted
        expect(evaluateStageAt(deferred, sceneId, "telop_1").stage.actors.length).toBe(0);
        expect(evaluateStageAt(deferred, sceneId, "talk_1").stage.actors.length).toBe(1);
    });

    test("all 5 locale dictionaries have identical key sets and non-empty staging/choreography strings", () => {
        const baseKeys = flattenKeys(STORY_MAKER_MESSAGES_BY_LOCALE["zh-CN"] as unknown as Record<string, unknown>);
        const requiredNewPaths = [
            "inspector.fineTune",
            "inspector.horizontalPosition",
            "inspector.resetToSlot",
            "inspector.lockPosition",
            "inspector.lockPositionPinnedHint",
            "inspector.lockBadge",
            "inspector.mirrorBadge",
            "inspector.delaySec",
            "inspector.transitionStyle",
            "inspector.transitionFade",
            "inspector.transitionInstant",
            "inspector.stageAdjustMode",
            "inspector.stageAdjustHint",
            "inspector.stageAdjustNoTarget",
            "inspector.telopActorVisibility",
            "inspector.telopActorsKeep",
            "inspector.telopActorsDim",
            "inspector.telopActorsHide",
            "inspector.telopPosition",
            "inspector.telopPosCenter",
            "inspector.telopPosTop",
            "inspector.telopPosBottom",
            "v2.slots.layoutMode",
            "v2.slots.layoutAuto",
            "v2.slots.layoutFixed",
            "v2.slots.enterTiming",
            "v2.slots.enterImmediate",
            "v2.slots.enterAfterTelop",
            "v2.slots.enterDelay",
            "v2.slots.enterDuration",
            "v2.slots.telopOverlapWarning",
            "v2.slots.deferCastAfterTelop",
            "v2.slots.afterTelopBadge",
            "v2.slots.fixedLayoutBadge",
            "v2.beats.simultaneousGroupTitle",
            "v2.beats.addSimultaneousActor",
            "v2.beats.primaryActorBadge",
            "v2.beats.parallelWithNext",
            "v2.beats.parallelBadge",
            "v2.beats.timingOverride",
            "v2.beats.inheritBeatTiming",
            "v2.beats.stageActionGroupPalette",
        ];

        for (const path of requiredNewPaths) {
            expect(baseKeys).toContain(path);
        }

        for (const locale of ALL_LOCALES) {
            const dict = STORY_MAKER_MESSAGES_BY_LOCALE[locale] as unknown as Record<string, unknown>;
            const localeKeys = flattenKeys(dict);
            expect(localeKeys).toEqual(baseKeys);

            const t = createStudioTranslator(locale);
            for (const path of requiredNewPaths) {
                const fullKey = `page.storyMaker.${path}`;
                const translated = t(fullKey);
                expect(translated).not.toBe(fullKey);
                expect(translated.trim().length).toBeGreaterThan(0);
            }
        }
    });
});
