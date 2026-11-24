import { describe, expect, test } from "bun:test";
import {
    GAME_LAYOUT,
    INITIAL_STAGE_STATE,
    STORY_FADE_SECONDS,
    advanceRuntime,
    compileStoryGraph,
    createInitialRuntime,
    createStoryDocument,
    parseLive2DModel,
    type Live2DModel,
    type Live2DSources,
    type SceneNode,
    type StageActionBeat,
    type StoryCastMember,
    type StoryDocument,
    type StoryStageState,
} from "@moesekai/story-core";
import { resolveTelopRects } from "../src/components/GameStageOverlay";
import {
    TELOP_VISIBILITY_FADE_SECONDS,
    buildStageActionWavePlan,
    buildStageCastApplyPlan,
    executeChoreographyFrame,
} from "../src/live2d/choreographyRunner";
import type {
    Live2DActorInfo,
    Live2DActorModel,
    Live2DActorPlacement,
    Live2DStage,
    Live2DStageOptions,
    Live2DStageStatic,
    Live2DStageTween,
} from "../src/live2d/stage";
import {
    StoryStageController,
    TELOP_DIM_ACTOR_ALPHA,
    resolveStageActorAlphaScale,
    type StageCanvasSize,
    type StageHostAdapter,
    type StoryStageApplyOptions,
} from "../src/live2d/stageController";

const CAST_ICHIKA: StoryCastMember = { key: "ichika", name: "星乃一歌", modelId: "01_ichika", characterId: 1 };
const CAST_SAKI: StoryCastMember = { key: "saki", name: "天马咲希", modelId: "02_saki", characterId: 2 };
const CAST_KANADE: StoryCastMember = { key: "kanade", name: "宵崎奏", modelId: "17_kanade", characterId: 17 };
const CAST_MAFUYU: StoryCastMember = { key: "mafuyu", name: "朝比奈真冬", modelId: "18_mafuyu", characterId: 18 };
const CAST_ENA: StoryCastMember = { key: "ena", name: "东云绘名", modelId: "19_ena", characterId: 19 };

const ALL_CAST = [CAST_ICHIKA, CAST_SAKI, CAST_KANADE, CAST_MAFUYU, CAST_ENA];

const TEST_SOURCES: Live2DSources = { site: "https://storage.test", region: "jp" };

const TEST_MODELS: Live2DModel[] = [
    parseLive2DModel({ id: "01_ichika", asset: "live2d/model/01_ichika", motion: "live2d/motion/01_ichika_motion_base", characterId: 1 }),
    parseLive2DModel({ id: "02_saki", asset: "live2d/model/02_saki", motion: "live2d/motion/02_saki_motion_base", characterId: 2 }),
    parseLive2DModel({ id: "17_kanade", asset: "live2d/model/17_kanade", motion: "live2d/motion/17_kanade_motion_base", characterId: 17 }),
    parseLive2DModel({ id: "18_mafuyu", asset: "live2d/model/18_mafuyu", motion: "live2d/motion/18_mafuyu_motion_base", characterId: 18 }),
    parseLive2DModel({ id: "19_ena", asset: "live2d/model/19_ena", motion: "live2d/motion/19_ena_motion_base", characterId: 19 }),
];

const DEFAULT_ACTOR_INFO: Live2DActorInfo = {
    motions: ["w-idle01", "w-nod01", "w-wave01"],
    facials: ["face_normal", "face_smile", "face_surprise"],
    defaultMotion: "w-idle01",
    defaultFacial: "face_normal",
    hasPhysics: true,
};

function makeStageState(overrides: Partial<StoryStageState> = {}): StoryStageState {
    return {
        ...INITIAL_STAGE_STATE,
        ...overrides,
    };
}

function waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function flushMicrotasks(ticks = 6): Promise<void> {
    let p = Promise.resolve();
    for (let i = 0; i < ticks; i += 1) {
        p = p.then(() => undefined);
    }
    return p;
}

class FakeHostAdapter implements StageHostAdapter {
    size: StageCanvasSize | null = { width: 1280, height: 720 };
    hidden = false;
    mountCanvas(initialSize?: StageCanvasSize): HTMLCanvasElement | null {
        return { width: initialSize?.width ?? 1280, height: initialSize?.height ?? 720 } as unknown as HTMLCanvasElement;
    }
    clearCanvas(): void {}
    measure(): StageCanvasSize | null {
        return this.hidden ? null : (this.size ? { ...this.size } : null);
    }
    isHidden(): boolean {
        return this.hidden;
    }
    observe(): () => void {
        return () => {};
    }
}

interface RecordedSetActorCall {
    id: string;
    placement: Live2DActorPlacement;
    tween?: Live2DStageTween;
    startedAt: number;
}

class ConcurrencyTrackingStage extends EventTarget implements Live2DStage {
    destroyed = false;
    paused = false;
    mounted = new Map<string, { placement: Live2DActorPlacement; motion: string | null; facial: string | null }>();
    setActorCalls: RecordedSetActorCall[] = [];
    removeCalls: string[] = [];
    finishTweensCount = 0;

    addActorDelayMs = 2;
    setActorTweenDelayMs = 0;
    inFlightAnimatedSetActors = 0;
    maxConcurrentAnimatedSetActors = 0;

    private actorAddGates = new Map<string, { promise: Promise<void>; release: () => void }>();
    private activeTweenFinishers = new Set<() => void>();

    get actors(): string[] {
        return [...this.mounted.keys()];
    }

    pauseAddActorFor(actorId: string): () => void {
        let releaseFn: () => void = () => {};
        const promise = new Promise<void>((resolve) => {
            releaseFn = () => {
                this.actorAddGates.delete(actorId);
                resolve();
            };
        });
        this.actorAddGates.set(actorId, { promise, release: releaseFn });
        return releaseFn;
    }

    async addActor(
        id: string,
        model: Live2DActorModel,
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
        onProgress?: (progress: { loaded: number; total: number }) => void,
    ): Promise<Live2DActorInfo> {
        onProgress?.({ loaded: 0, total: 10 });
        const gate = this.actorAddGates.get(id);
        if (gate) {
            onProgress?.({ loaded: 5, total: 10 });
            await gate.promise;
        }
        if (this.addActorDelayMs > 0) await waitMs(this.addActorDelayMs);
        onProgress?.({ loaded: 10, total: 10 });
        this.mounted.set(id, {
            placement: {
                x: placement?.x ?? 0,
                y: placement?.y ?? 0,
                scale: placement?.scale ?? 1,
                alpha: placement?.alpha ?? 1,
                mirror: placement?.mirror ?? false,
                order: placement?.order ?? 0,
            },
            motion: placement?.motion ?? DEFAULT_ACTOR_INFO.defaultMotion,
            facial: placement?.facial ?? DEFAULT_ACTOR_INFO.defaultFacial,
        });
        return { ...DEFAULT_ACTOR_INFO, model: model.asset, motionSet: model.motion ?? null };
    }

    removeActor(id: string): void {
        this.removeCalls.push(id);
        this.mounted.delete(id);
    }

    async setActor(id: string, placement: Live2DActorPlacement, tween?: Live2DStageTween): Promise<boolean> {
        const startedAt = performance.now();
        this.setActorCalls.push({
            id,
            placement: { ...placement },
            ...(tween ? { tween: { ...tween } } : {}),
            startedAt,
        });
        const animated = (tween?.duration ?? 0) > 0 && this.setActorTweenDelayMs > 0;
        if (animated) {
            this.inFlightAnimatedSetActors += 1;
            if (this.inFlightAnimatedSetActors > this.maxConcurrentAnimatedSetActors) {
                this.maxConcurrentAnimatedSetActors = this.inFlightAnimatedSetActors;
            }
            try {
                await new Promise<void>((resolve) => {
                    let done = false;
                    const finish = () => {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        this.activeTweenFinishers.delete(finish);
                        resolve();
                    };
                    const timer = setTimeout(finish, this.setActorTweenDelayMs);
                    this.activeTweenFinishers.add(finish);
                });
            } finally {
                this.inFlightAnimatedSetActors = Math.max(0, this.inFlightAnimatedSetActors - 1);
            }
        } else {
            await flushMicrotasks(1);
        }
        const entry = this.mounted.get(id);
        if (!entry || this.destroyed) return false;
        entry.placement = { ...entry.placement, ...placement };
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
    finishTweens(): void {
        this.finishTweensCount += 1;
        for (const fn of [...this.activeTweenFinishers]) fn();
    }
    play(): void { this.paused = false; }
    pause(): void { this.paused = true; }
    resize(): void {}
    destroy(): void {
        this.destroyed = true;
        this.finishTweens();
        for (const gate of [...this.actorAddGates.values()]) gate.release();
    }
}

async function createBootedStageHarness() {
    const host = new FakeHostAdapter();
    let stage: ConcurrencyTrackingStage | null = null;
    const StageStatic: Live2DStageStatic = {
        async supported() { return { ok: true, missing: [] }; },
        async create(_options: Live2DStageOptions) {
            stage = new ConcurrencyTrackingStage();
            return stage;
        },
    };
    const controller = new StoryStageController({
        loadStage: async () => StageStatic,
        resolveScriptBase: () => "https://example.test/live2d-viewer/",
        resolveCoreUrl: () => "https://example.test/core.js",
        resizeSettleMs: 10,
    });
    controller.setContext({ cast: ALL_CAST, models: TEST_MODELS });
    controller.setConfig({ sources: TEST_SOURCES });
    controller.setHost(host);
    await waitMs(15);
    await flushMicrotasks();
    return { controller, stage: stage! };
}

function buildCompiledStory(scene: Partial<SceneNode> & { id: string; beats: SceneNode["beats"] }): StoryDocument {
    const doc = createStoryDocument("jp", "Choreography Test");
    doc.cast = ALL_CAST;
    const endId = "end_1";
    const sceneNode: SceneNode = {
        id: scene.id,
        type: "scene",
        title: scene.title ?? "Test Scene",
        pos: { x: 200, y: 0 },
        background: scene.background ?? { mode: "set", asset: "bg_a000401" },
        bgm: scene.bgm ?? { mode: "inherit" },
        place: scene.place ?? { mode: "inherit" },
        transition: scene.transition ?? { kind: "none", duration: 0 },
        stageCast: scene.stageCast ?? { mode: "clear" },
        beats: scene.beats,
    };
    doc.nodes = {
        [doc.startNodeId]: { id: doc.startNodeId, type: "start", pos: { x: 0, y: 0 } },
        [scene.id]: sceneNode,
        [endId]: { id: endId, type: "end", title: "FIN", pos: { x: 400, y: 0 } },
    };
    doc.edges = [
        { id: "e_start", fromNodeId: doc.startNodeId, fromPortId: "out", toNodeId: scene.id },
        { id: "e_end", fromNodeId: scene.id, fromPortId: "out", toNodeId: endId },
    ];
    return doc;
}

describe("StoryStageController — parallel lockstep waves, load barrier & telop actorAlphaScale", () => {
    test("runs leaving fade-outs, existing-actor moves, and post-barrier arriving fade-ins CONCURRENTLY in lockstep", async () => {
        const { controller, stage } = await createBootedStageHarness();

        // Mount initial 3 actors: ichika (will leave), saki & kanade (will shift + mirror).
        await controller.apply(makeStageState({
            actors: [
                { cast: "ichika", slot: "farLeft", x: -0.75, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "saki", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "kanade", slot: "right", x: 0.365, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        }), { instant: true });

        stage.setActorCalls = [];
        stage.removeCalls = [];
        stage.setActorTweenDelayMs = 35;

        // Hold Ena behind a load gate while Mafuyu loads quickly -> verifies load barrier!
        const releaseEna = stage.pauseAddActorFor("ena");

        const wavePromise = controller.apply(makeStageState({
            actors: [
                { cast: "saki", slot: "left", x: -0.25, y: 0, scale: 1, mirror: true, motion: null, facial: null },
                { cast: "kanade", slot: "right", x: 0.25, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "mafuyu", slot: "farLeft", x: -0.75, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "ena", slot: "farRight", x: 0.75, y: 0, scale: 1, mirror: true, motion: null, facial: null },
            ],
        }), {
            instant: false,
            fade: true,
            fadeSeconds: 0.45,
            moveSeconds: 0.5,
            actorTweens: {
                ichika: { duration: 0.35, fade: true, easing: "out" },
                saki: { duration: 0.5, easing: "in-out" },
                kanade: { duration: 0.5, easing: "in-out" },
                mafuyu: { duration: 0.45, fade: true, easing: "in" },
                ena: { duration: 0.45, fade: true, easing: "in" },
            },
        });

        // Wait until Mafuyu finishes mounting while Ena is still blocked at the load barrier.
        const deadline = Date.now() + 500;
        while (!stage.mounted.has("mafuyu") && Date.now() < deadline) {
            await waitMs(5);
        }
        await waitMs(15);

        // Load barrier invariant: Mafuyu is mounted at alpha=0 and has NOT started fading in early!
        expect(stage.mounted.get("mafuyu")?.placement.alpha).toBe(0);
        expect(stage.setActorCalls.some(c => c.id === "mafuyu" && c.placement.alpha === 1)).toBe(false);
        // Leaving/moving actors have also waited for the barrier so the entire wave starts in unison!
        expect(stage.setActorCalls.some(c => c.id === "ichika" && c.placement.alpha === 0)).toBe(false);
        expect(stage.setActorCalls.some(c => c.id === "saki" && c.placement.x === -0.25)).toBe(false);

        // Release Ena -> all 5 animated setActor calls fire CONCURRENTLY!
        releaseEna();
        await wavePromise;

        // Every single one of the 5 animated actors (1 leaving + 2 moving + 2 arriving) ran concurrently!
        expect(stage.maxConcurrentAnimatedSetActors).toBe(5);

        // Verify custom per-actor durations & mirror were honored.
        const ichikaOut = stage.setActorCalls.find(c => c.id === "ichika" && c.placement.alpha === 0);
        const sakiMove = stage.setActorCalls.find(c => c.id === "saki" && c.placement.x === -0.25);
        const kanadeMove = stage.setActorCalls.find(c => c.id === "kanade" && c.placement.x === 0.25);
        const mafuyuIn = stage.setActorCalls.find(c => c.id === "mafuyu" && c.placement.alpha === 1);
        const enaIn = stage.setActorCalls.find(c => c.id === "ena" && c.placement.alpha === 1);

        expect(ichikaOut?.tween).toEqual({ duration: 0.35, easing: "out" });
        expect(sakiMove?.tween).toEqual({ duration: 0.5, easing: "in-out" });
        expect(sakiMove?.placement.mirror).toBe(true);
        expect(kanadeMove?.tween).toEqual({ duration: 0.5, easing: "in-out" });
        expect(mafuyuIn?.tween).toEqual({ duration: 0.45, easing: "in" });
        expect(enaIn?.tween).toEqual({ duration: 0.45, easing: "in" });
        expect(stage.mounted.get("ena")?.placement.mirror).toBe(true);

        // All 5 wave animations began on the same tick (spread well under single tween duration 35ms).
        const startTimes = [ichikaOut!, sakiMove!, kanadeMove!, mafuyuIn!, enaIn!].map(c => c.startedAt);
        expect(Math.max(...startTimes) - Math.min(...startTimes)).toBeLessThan(15);

        // Final mounted actors match target cleanly and Ichika was removed after fade-out.
        expect(stage.removeCalls).toContain("ichika");
        expect(stage.actors.sort()).toEqual(["ena", "kanade", "mafuyu", "saki"]);
        for (const id of ["saki", "kanade", "mafuyu", "ena"]) {
            expect(stage.mounted.get(id)?.placement.alpha).toBe(1);
        }

        controller.dispose();
    });

    test("honors per-actor delay and cancels pending delays immediately on finish()", async () => {
        const { controller, stage } = await createBootedStageHarness();
        stage.setActorTweenDelayMs = 15;

        const t0 = performance.now();
        const p = controller.apply(makeStageState({
            actors: [
                { cast: "ichika", slot: "left", x: -0.365, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "saki", slot: "right", x: 0.365, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        }), {
            instant: false,
            fade: true,
            actorTweens: {
                ichika: { delay: 0, duration: 0.2, fade: true, easing: "in" },
                saki: { delay: 2.0, duration: 0.2, fade: true, easing: "in" },
            },
        });

        // Wait for Ichika to mount & start fading, while Saki is sleeping on its 2.0s delay.
        await waitMs(35);
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("saki")?.placement.alpha).toBe(0);

        // Calling finish() cancels Saki's 2.0s timer immediately and snaps Saki to visible!
        controller.finish();
        await p;
        const elapsed = performance.now() - t0;

        expect(elapsed).toBeLessThan(500);
        expect(stage.mounted.get("saki")?.placement.alpha).toBe(1);
        const sakiSnap = stage.setActorCalls.find(c => c.id === "saki" && c.placement.alpha === 1);
        expect(sakiSnap?.tween?.duration).toBe(0);

        controller.dispose();
    });

    test("derives actorAlphaScale from telop.actorVisibility (hide=0, dim=0.28, keep=1) and updates Edit Mode visualKey", async () => {
        const { controller, stage } = await createBootedStageHarness();
        const baseActors = [
            { cast: "ichika", slot: "center" as const, x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
        ];

        await controller.apply(makeStageState({ actors: baseActors }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(1);

        // Instant Edit-mode switch to telop actorVisibility="hide" MUST NOT be deduped!
        await controller.apply(makeStageState({
            actors: baseActors,
            telop: { stepId: "t1", body: "数小时后", actorVisibility: "hide" },
        }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(0);

        // Switch to "dim" -> 0.28
        await controller.apply(makeStageState({
            actors: baseActors,
            telop: { stepId: "t1", body: "数小时后", actorVisibility: "dim" },
        }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.alpha).toBeCloseTo(TELOP_DIM_ACTOR_ALPHA, 4);

        // Identical instant re-apply deduplicates cleanly with zero extra setActor calls
        const callsBeforeDedup = stage.setActorCalls.length;
        await controller.apply(makeStageState({
            actors: baseActors,
            telop: { stepId: "t1", body: "数小时后", actorVisibility: "dim" },
        }), { instant: true });
        expect(stage.setActorCalls.length).toBe(callsBeforeDedup);

        // Clearing telop restores alpha=1 immediately
        await controller.apply(makeStageState({ actors: baseActors, telop: null }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(1);

        expect(resolveStageActorAlphaScale(makeStageState({ telop: { stepId: "t", body: "x", actorVisibility: "hide" } }))).toBe(0);
        expect(resolveStageActorAlphaScale(makeStageState({ telop: { stepId: "t", body: "x", actorVisibility: "dim" } }))).toBe(0.28);
        expect(resolveStageActorAlphaScale(makeStageState({ telop: { stepId: "t", body: "x", actorVisibility: "keep" } }))).toBe(1);

        controller.dispose();
    });
});

describe("buildStageActionWavePlan & executeChoreographyFrame", () => {
    test("buildStageActionWavePlan expands group, preserves surviving X on exit, and honors per-actor delay/duration/transition", () => {
        // User regression scenario: A(center) and B(right) on stage, C(left) enters -> A & B keep exact X!
        const twoActorStage = makeStageState({
            actors: [
                { cast: "ichika", slot: "center", x: -0.058, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "saki", slot: "right", x: 0.423, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        });

        const enterLeftBeat: StageActionBeat = {
            id: "b_enter_left",
            kind: "stageAction",
            action: "enter",
            castKey: "kanade",
            slot: "left",
            delay: 0.3,
            duration: 0.65,
            transition: "fade",
        };
        const enterPlan = buildStageActionWavePlan(twoActorStage, [enterLeftBeat]);
        expect(enterPlan.waveDelayMs).toBe(300);
        expect(enterPlan.applyOptions.fade).toBe(true);
        expect(enterPlan.applyOptions.fadeSeconds).toBe(0.65);
        expect(enterPlan.applyOptions.actorTweens?.kanade).toEqual({
            delay: 0,
            duration: 0.65,
            fade: true,
            easing: "in",
        });
        expect(enterPlan.nextStage.actors.find(a => a.cast === "ichika")?.x).toBe(-0.058);
        expect(enterPlan.nextStage.actors.find(a => a.cast === "saki")?.x).toBe(0.423);

        // Exit wave: Kanade leaves -> Ichika & Saki keep exact X (ZERO shift!)
        const exitBeat: StageActionBeat = {
            id: "b_exit_left",
            kind: "stageAction",
            action: "exit",
            castKey: "kanade",
            duration: 0.5,
            transition: "fade",
        };
        const exitPlan = buildStageActionWavePlan(enterPlan.nextStage, [exitBeat]);
        expect(exitPlan.nextStage.actors.map(a => a.cast)).toEqual(["ichika", "saki"]);
        expect(exitPlan.nextStage.actors.find(a => a.cast === "ichika")?.x).toBe(-0.058);
        expect(exitPlan.nextStage.actors.find(a => a.cast === "saki")?.x).toBe(0.423);
        expect(exitPlan.applyOptions.actorTweens?.kanade).toEqual({
            delay: 0,
            duration: 0.5,
            fade: true,
            easing: "out",
        });

        // Multi-actor group beat with staggered delays + instant transition
        const groupBeat: StageActionBeat = {
            id: "b_group",
            kind: "stageAction",
            action: "enter",
            castKey: "mafuyu",
            slot: "farLeft",
            delay: 0.2,
            duration: 0.7,
            group: [
                { action: "enter", castKey: "ena", slot: "farRight", delay: 0.6, duration: 0.35, transition: "fade" },
                { action: "exit", castKey: "ichika", delay: 0.2, transition: "instant" },
            ],
        };
        const groupPlan = buildStageActionWavePlan(twoActorStage, [groupBeat]);
        expect(groupPlan.waveDelayMs).toBe(200);
        expect(groupPlan.applyOptions.actorTweens?.mafuyu).toEqual({ delay: 0, duration: 0.7, fade: true, easing: "in" });
        expect(groupPlan.applyOptions.actorTweens?.ena).toEqual({ delay: 0.4, duration: 0.35, fade: true, easing: "in" });
        expect(groupPlan.applyOptions.actorTweens?.ichika).toEqual({ delay: 0, duration: 0, fade: false, easing: "out" });
        expect(groupPlan.nextStage.actors.map(a => a.cast).sort()).toEqual(["ena", "mafuyu", "saki"]);
    });

    test("executeChoreographyFrame coalesces group & parallel stageAction beats into single lockstep applyStage calls", async () => {
        const doc = buildCompiledStory({
            id: "scene_multi",
            stageCast: { mode: "clear" },
            beats: [
                {
                    id: "b_enter_1",
                    kind: "stageAction",
                    action: "enter",
                    castKey: "ichika",
                    slot: "left",
                    delay: 0.25,
                    duration: 0.6,
                    parallel: true,
                },
                {
                    id: "b_enter_2",
                    kind: "stageAction",
                    action: "enter",
                    castKey: "saki",
                    slot: "right",
                    delay: 0.25,
                    duration: 0.6,
                },
                {
                    id: "b_talk_1",
                    kind: "talk",
                    speakerKey: "ichika",
                    body: "我们一起登场！",
                },
                {
                    id: "b_exit_group",
                    kind: "stageAction",
                    action: "exit",
                    castKey: "ichika",
                    duration: 0.55,
                    group: [
                        { action: "exit", castKey: "saki", transition: "instant" },
                    ],
                },
                {
                    id: "b_talk_2",
                    kind: "talk",
                    speakerName: "旁白",
                    body: "两人同时退场。",
                },
            ],
        });

        const program = compileStoryGraph(doc);
        expect(program.errors).toEqual([]);

        // Frame 1: enterScene + [b_enter_1 || b_enter_2] + b_talk_1
        const frame1 = createInitialRuntime(program);
        const applyLog1: Array<{ actors: string[]; options: StoryStageApplyOptions }> = [];
        const waits1: number[] = [];

        const res1 = await executeChoreographyFrame(frame1, INITIAL_STAGE_STATE, {
            isCancelled: () => false,
            getDoc: () => doc,
            baseVars: {},
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target, options) => {
                applyLog1.push({ actors: target.actors.map(a => a.cast), options });
            },
            shakeStage: async () => {},
            waitMs: async (ms) => { waits1.push(ms); },
            playSe: () => {},
            onTalkBeat: () => {},
        });

        expect(res1.cancelled).toBe(false);
        expect(waits1).toEqual([250]);
        // Calls: [0] enterScene (empty), [1] SINGLE coalesced enter wave [ichika, saki], [2] talk
        expect(applyLog1.length).toBe(3);
        expect(applyLog1[0]!.actors).toEqual([]);
        expect(applyLog1[1]!.actors).toEqual(["ichika", "saki"]);
        expect(applyLog1[1]!.options.fade).toBe(true);
        expect(applyLog1[1]!.options.actorTweens?.ichika).toEqual({ delay: 0, duration: 0.6, fade: true, easing: "in" });
        expect(applyLog1[1]!.options.actorTweens?.saki).toEqual({ delay: 0, duration: 0.6, fade: true, easing: "in" });

        // Frame 2: [b_exit_group (ichika fade 0.55s + saki instant)] + b_talk_2
        const frame2 = advanceRuntime(program, frame1);
        const applyLog2: Array<{ actors: string[]; options: StoryStageApplyOptions }> = [];

        const res2 = await executeChoreographyFrame(frame2, frame1.stage, {
            isCancelled: () => false,
            getDoc: () => doc,
            baseVars: frame1.variables,
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target, options) => {
                applyLog2.push({ actors: target.actors.map(a => a.cast), options });
            },
            shakeStage: async () => {},
            waitMs: async () => {},
            playSe: () => {},
            onTalkBeat: () => {},
        });

        expect(res2.cancelled).toBe(false);
        // Calls: [0] SINGLE coalesced exit wave [], [1] talk
        expect(applyLog2.length).toBe(2);
        expect(applyLog2[0]!.actors).toEqual([]);
        expect(applyLog2[0]!.options.actorTweens?.ichika).toEqual({ delay: 0, duration: 0.55, fade: true, easing: "out" });
        expect(applyLog2[0]!.options.actorTweens?.saki).toEqual({ delay: 0, duration: 0, fade: false, easing: "out" });
    });

    test("executeChoreographyFrame defers stageCast when enterTiming='afterTelop' and mounts together on applyStageCast with delay/duration", async () => {
        const doc = buildCompiledStory({
            id: "scene_after_telop",
            stageCast: {
                mode: "set",
                enterTiming: "afterTelop",
                enterDelay: 0.4,
                enterDuration: 0.75,
                enterTransition: "fade",
                actors: [
                    { castKey: "ichika", slot: "left" },
                    { castKey: "saki", slot: "right" },
                ],
            },
            beats: [
                { id: "b_telop_open", kind: "telop", text: "放学后的教室" },
                { id: "b_talk_after", kind: "talk", speakerKey: "ichika", body: "大家久等了！" },
            ],
        });

        const program = compileStoryGraph(doc);
        expect(program.errors).toEqual([]);

        // Frame 1: enterScene(deferStageCast=true) + leading telop -> 0 actors mounted!
        const frame1 = createInitialRuntime(program);
        const applyLog1: Array<{ actors: string[]; options: StoryStageApplyOptions }> = [];
        const waits1: number[] = [];

        await executeChoreographyFrame(frame1, INITIAL_STAGE_STATE, {
            isCancelled: () => false,
            getDoc: () => doc,
            baseVars: {},
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target, options) => {
                applyLog1.push({ actors: target.actors.map(a => a.cast), options });
            },
            shakeStage: async () => {},
            waitMs: async (ms) => { waits1.push(ms); },
            playSe: () => {},
            onTalkBeat: () => {},
        });

        expect(waits1).toEqual([]);
        expect(applyLog1.every(entry => entry.actors.length === 0)).toBe(true);
        expect(frame1.stage.telop?.body).toBe("放学后的教室");

        // Frame 2: applyStageCast (wait 400ms, then lockstep fade 0.75s) + talk
        const frame2 = advanceRuntime(program, frame1);
        const applyLog2: Array<{ actors: string[]; options: StoryStageApplyOptions }> = [];
        const waits2: number[] = [];

        await executeChoreographyFrame(frame2, frame1.stage, {
            isCancelled: () => false,
            getDoc: () => doc,
            baseVars: frame1.variables,
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target, options) => {
                applyLog2.push({ actors: target.actors.map(a => a.cast), options });
            },
            shakeStage: async () => {},
            waitMs: async (ms) => { waits2.push(ms); },
            playSe: () => {},
            onTalkBeat: () => {},
        });

        expect(waits2).toEqual([400]);
        expect(applyLog2[0]!.actors).toEqual(["ichika", "saki"]);
        expect(applyLog2[0]!.options).toMatchObject({
            instant: false,
            fade: true,
            fadeSeconds: 0.75,
        });
    });

    test("executeChoreographyFrame honors telop.actorVisibility ('hide' -> 0, 'dim' -> 0.28) and restores 1 on next beat", async () => {
        const doc = buildCompiledStory({
            id: "scene_telop_vis",
            stageCast: {
                mode: "set",
                actors: [{ castKey: "ichika", slot: "center" }],
            },
            beats: [
                { id: "b_talk_0", kind: "talk", speakerKey: "ichika", body: "开场台词" },
                { id: "b_telop_hide", kind: "telop", text: "数小时后", actorVisibility: "hide" },
                { id: "b_telop_dim", kind: "telop", text: "傍晚", actorVisibility: "dim", position: "top" },
                { id: "b_talk_restore", kind: "talk", speakerKey: "ichika", body: "恢复显示" },
            ],
        });

        const program = compileStoryGraph(doc);
        const f1 = createInitialRuntime(program);
        const f2 = advanceRuntime(program, f1);
        const f3 = advanceRuntime(program, f2);
        const f4 = advanceRuntime(program, f3);

        const runFrame = async (frame: typeof f1, prev: StoryStageState) => {
            const calls: StoryStageApplyOptions[] = [];
            await executeChoreographyFrame(frame, prev, {
                isCancelled: () => false,
                getDoc: () => doc,
                baseVars: {},
                setStageState: () => {},
                setVariables: () => {},
                syncBgm: () => {},
                setFadeSeconds: () => {},
                setEffectActive: () => {},
                triggerFlash: () => {},
                applyStage: async (_target, options) => { calls.push(options); },
                shakeStage: async () => {},
                waitMs: async () => {},
                playSe: () => {},
                onTalkBeat: () => {},
            });
            return calls;
        };

        const callsHide = await runFrame(f2, f1.stage);
        expect(callsHide[callsHide.length - 1]).toMatchObject({
            instant: false,
            actorAlphaScale: 0,
            fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS,
        });

        const callsDim = await runFrame(f3, f2.stage);
        expect(callsDim[callsDim.length - 1]).toMatchObject({
            instant: false,
            actorAlphaScale: TELOP_DIM_ACTOR_ALPHA,
            fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS,
        });

        const callsRestore = await runFrame(f4, f3.stage);
        expect(callsRestore[callsRestore.length - 1]).toMatchObject({
            instant: false,
            actorAlphaScale: 1,
            fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS,
        });
    });

    test("buildStageCastApplyPlan preserves legacy pop-in defaults and honors custom enterDelay/enterDuration/enterTransition", () => {
        const legacyNone = buildStageCastApplyPlan({ mode: "set", actors: [{ castKey: "ichika", slot: "center" }] }, { defaultFade: false });
        expect(legacyNone).toEqual({
            delayMs: 0,
            applyOptions: { instant: false, fade: false, fadeSeconds: 0 },
        });

        const legacyFade = buildStageCastApplyPlan({ mode: "set", actors: [{ castKey: "ichika", slot: "center" }] }, { defaultFade: true });
        expect(legacyFade).toEqual({
            delayMs: 0,
            applyOptions: { instant: false, fade: true, fadeSeconds: STORY_FADE_SECONDS },
        });

        const customFade = buildStageCastApplyPlan({
            mode: "set",
            actors: [{ castKey: "ichika", slot: "center" }],
            enterDelay: 0.5,
            enterDuration: 0.9,
            enterTransition: "fade",
        });
        expect(customFade).toEqual({
            delayMs: 500,
            applyOptions: { instant: false, fade: true, fadeSeconds: 0.9 },
        });

        const customInstant = buildStageCastApplyPlan({
            mode: "set",
            actors: [{ castKey: "ichika", slot: "center" }],
            enterDelay: 0.3,
            enterTransition: "instant",
        });
        expect(customInstant).toEqual({
            delayMs: 300,
            applyOptions: { instant: false, fade: false, fadeSeconds: 0 },
        });
    });

    test("executeChoreographyFrame honors enterScene enterDelay > 0 and aborts cleanly when cancelled mid-delay", async () => {
        const doc = buildCompiledStory({
            id: "scene_delayed_cast",
            stageCast: {
                mode: "set",
                enterTiming: "immediate",
                enterDelay: 0.6,
                enterDuration: 0.5,
                enterTransition: "fade",
                actors: [
                    { castKey: "ichika", slot: "left" },
                    { castKey: "saki", slot: "right" },
                ],
            },
            beats: [
                { id: "b_talk_d", kind: "talk", speakerKey: "ichika", body: "稍后登场！" },
            ],
        });

        const program = compileStoryGraph(doc);
        const frame = createInitialRuntime(program);

        // Normal delayed entry: first clears/enters scene with 0 actors, waits 600ms, then mounts both actors together.
        const applyLog: Array<{ actors: string[]; options: StoryStageApplyOptions }> = [];
        const waits: number[] = [];
        const res = await executeChoreographyFrame(frame, INITIAL_STAGE_STATE, {
            isCancelled: () => false,
            getDoc: () => doc,
            baseVars: {},
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target, options) => {
                applyLog.push({ actors: target.actors.map(a => a.cast), options });
            },
            shakeStage: async () => {},
            waitMs: async (ms) => { waits.push(ms); },
            playSe: () => {},
            onTalkBeat: () => {},
        });

        expect(res.cancelled).toBe(false);
        expect(waits).toEqual([600]);
        expect(applyLog[0]!.actors).toEqual([]);
        expect(applyLog[1]!.actors).toEqual(["ichika", "saki"]);
        expect(applyLog[1]!.options).toMatchObject({ instant: false, fade: true, fadeSeconds: 0.5 });

        // Cancelled mid-delay: never mounts the deferred actors or runs the talk beat!
        let cancelled = false;
        const cancelLog: string[][] = [];
        let talked = false;
        const cancelRes = await executeChoreographyFrame(frame, INITIAL_STAGE_STATE, {
            isCancelled: () => cancelled,
            getDoc: () => doc,
            baseVars: {},
            setStageState: () => {},
            setVariables: () => {},
            syncBgm: () => {},
            setFadeSeconds: () => {},
            setEffectActive: () => {},
            triggerFlash: () => {},
            applyStage: async (target) => {
                cancelLog.push(target.actors.map(a => a.cast));
            },
            shakeStage: async () => {},
            waitMs: async () => { cancelled = true; },
            playSe: () => {},
            onTalkBeat: () => { talked = true; },
        });

        expect(cancelRes.cancelled).toBe(true);
        expect(cancelLog).toEqual([[]]);
        expect(talked).toBe(false);
    });
});

describe("GameStageOverlay — resolveTelopRects vertical placement", () => {
    test("computes center, top, and bottom rects with safe clearances", () => {
        const center = resolveTelopRects("center");
        expect(center.band).toEqual(GAME_LAYOUT.telop.band);
        expect(center.text).toEqual(GAME_LAYOUT.telop.text);
        expect(resolveTelopRects(undefined).band).toEqual(GAME_LAYOUT.telop.band);

        const top = resolveTelopRects("top");
        const placeBottom = GAME_LAYOUT.placeInfo.fullSpan[1] + GAME_LAYOUT.placeInfo.fullSpan[3];
        const menuBottom = GAME_LAYOUT.menu.button[1] + GAME_LAYOUT.menu.button[3];
        expect(top.band[1]).toBeGreaterThan(placeBottom);
        expect(top.band[1]).toBeGreaterThan(menuBottom);
        expect(top.band[1]).toBeLessThan(GAME_LAYOUT.telop.band[1]);
        expect(top.text[1]).toBe(top.band[1]);

        const bottom = resolveTelopRects("bottom");
        expect(bottom.band[1]).toBeGreaterThan(GAME_LAYOUT.telop.band[1]);
        expect(bottom.band[1] + bottom.band[3]).toBeLessThanOrEqual(GAME_LAYOUT.canvas.height);
        expect(bottom.text[1]).toBe(bottom.band[1]);
    });
});
