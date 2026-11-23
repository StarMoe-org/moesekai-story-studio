import { describe, expect, test } from "bun:test";
import {
    computeActorRenderOrders,
    createStoryDocument,
    INITIAL_STAGE_STATE,
    parseLive2DModel,
    type Live2DModel,
    type Live2DSources,
    type StoryCastMember,
    type StoryStageState,
} from "@moesekai/story-core";
import { applyInstructionToStage } from "../src/components/StoryPlayerView";
import {
    LIVE2D_STAGE_UNAVAILABLE,
    type Live2DActorInfo,
    type Live2DActorModel,
    type Live2DActorPlacement,
    type Live2DStage,
    type Live2DStageOptions,
    type Live2DStageStatic,
    type Live2DStageTween,
} from "../src/live2d/stage";
import {
    computeStageCanvasSize,
    SOLO_PREVIEW_ACTOR_ID,
    StoryStageController,
    type StageCanvasSize,
    type StageHostAdapter,
    type StoryStageRenderQuality,
} from "../src/live2d/stageController";

const CAST_ICHIKA: StoryCastMember = { key: "ichika", name: "星乃一歌", modelId: "01_ichika", characterId: 1 };
const CAST_SAKI: StoryCastMember = { key: "saki", name: "天马咲希", modelId: "02_saki", characterId: 2 };
const CAST_KANADE: StoryCastMember = { key: "kanade", name: "宵崎奏", modelId: "17_kanade", characterId: 17 };
const CAST_MAFUYU: StoryCastMember = { key: "mafuyu", name: "朝比奈真冬", modelId: "18_mafuyu", characterId: 18 };
const CAST_ENA: StoryCastMember = { key: "ena", name: "东云绘名", modelId: "19_ena", characterId: 19 };
const CAST_MIZUKI: StoryCastMember = { key: "mizuki", name: "晓山瑞希", modelId: "20_mizuki", characterId: 20 };

const TEST_SOURCES: Live2DSources = { site: "https://storage.test", region: "jp" };

const TEST_MODELS: Live2DModel[] = [
    parseLive2DModel({ id: "01_ichika", asset: "live2d/model/01_ichika", motion: "live2d/motion/01_ichika_motion_base", characterId: 1 }),
    parseLive2DModel({ id: "02_saki", asset: "live2d/model/02_saki", motion: "live2d/motion/02_saki_motion_base", characterId: 2 }),
    parseLive2DModel({ id: "17_kanade", asset: "live2d/model/17_kanade", motion: "live2d/motion/17_kanade_motion_base", characterId: 17 }),
    parseLive2DModel({ id: "18_mafuyu", asset: "live2d/model/18_mafuyu", motion: "live2d/motion/18_mafuyu_motion_base", characterId: 18 }),
    parseLive2DModel({ id: "19_ena", asset: "live2d/model/19_ena", motion: "live2d/motion/19_ena_motion_base", characterId: 19 }),
    parseLive2DModel({ id: "20_mizuki", asset: "live2d/model/20_mizuki", motion: "live2d/motion/20_mizuki_motion_base", characterId: 20 }),
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

function flushMicrotasks(ticks = 6): Promise<void> {
    let p = Promise.resolve();
    for (let i = 0; i < ticks; i += 1) {
        p = p.then(() => undefined);
    }
    return p;
}

function waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface FakeCanvas {
    id: number;
    transferred: boolean;
    width: number;
    height: number;
}

class FakeHostAdapter implements StageHostAdapter {
    size: StageCanvasSize | null = { width: 1280, height: 720 };
    cssSize: StageCanvasSize | null = null;
    dpr = 1;
    hidden = false;
    canvases: FakeCanvas[] = [];
    sizeHints: Array<{ size: StageCanvasSize; quality: StoryStageRenderQuality }> = [];
    clearCount = 0;
    private nextCanvasId = 1;
    private resizeHandler: (() => void) | null = null;
    private visibilityHandler: ((hidden: boolean) => void) | null = null;

    mountCanvas(initialSize?: StageCanvasSize): HTMLCanvasElement | null {
        const canvas: FakeCanvas = {
            id: this.nextCanvasId++,
            transferred: false,
            width: initialSize?.width ?? 300,
            height: initialSize?.height ?? 150,
        };
        this.canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
    }

    clearCanvas(): void {
        this.clearCount += 1;
    }

    measure(quality?: StoryStageRenderQuality): StageCanvasSize | null {
        if (this.hidden) return null;
        if (this.cssSize) {
            return computeStageCanvasSize(this.cssSize, this.dpr, quality ?? "high");
        }
        return this.size ? { ...this.size } : null;
    }

    syncCanvasSizeHint(size: StageCanvasSize, quality: StoryStageRenderQuality): void {
        this.sizeHints.push({ size: { ...size }, quality });
    }

    isHidden(): boolean {
        return this.hidden;
    }

    observe(handlers: { onResize: () => void; onVisibilityChange: (hidden: boolean) => void }): () => void {
        this.resizeHandler = handlers.onResize;
        this.visibilityHandler = handlers.onVisibilityChange;
        return () => {
            this.resizeHandler = null;
            this.visibilityHandler = null;
        };
    }

    triggerResize(nextSize: StageCanvasSize | null): void {
        this.size = nextSize;
        this.resizeHandler?.();
    }

    triggerVisibility(hidden: boolean): void {
        this.hidden = hidden;
        this.visibilityHandler?.(hidden);
    }
}

interface MountedFakeActor {
    asset: string;
    placement: Live2DActorPlacement;
    motion: string | null;
    facial: string | null;
    talking: boolean;
}

class FakeLive2DStage extends EventTarget implements Live2DStage {
    readonly instanceId: number;
    readonly initOptions: Live2DStageOptions;
    readonly canvasRef: FakeCanvas;
    destroyed = false;
    paused = false;
    mounted = new Map<string, MountedFakeActor>();
    calls: string[] = [];
    setActorCalls: Array<{ id: string; placement: Live2DActorPlacement; tween?: Live2DStageTween }> = [];
    resizeHistory: StageCanvasSize[] = [];
    inFlightOps = 0;
    maxConcurrentOps = 0;
    addActorDelayMs = 2;
    playMotionDelayMs = 1;
    failNextAddFor: Set<string> = new Set();
    abortNextAddFor: Set<string> = new Set();
    actorProgressSteps: Map<string, Array<{ loaded: number; total: number }>> = new Map();
    private actorAddGates = new Map<string, { promise: Promise<void>; release: () => void }>();
    private addGate: Promise<void> | null = null;
    private releaseAddGate: (() => void) | null = null;

    constructor(instanceId: number, options: Live2DStageOptions) {
        super();
        this.instanceId = instanceId;
        this.initOptions = options;
        this.canvasRef = options.canvas as unknown as FakeCanvas;
        if (this.canvasRef.transferred) {
            throw new Error("InvalidStateError: Cannot call transferControlToOffscreen twice on the same canvas");
        }
        this.canvasRef.transferred = true;
    }

    get actors(): string[] {
        return [...this.mounted.keys()];
    }

    pauseAddActor(): () => void {
        this.addGate = new Promise<void>((resolve) => {
            this.releaseAddGate = () => {
                this.addGate = null;
                this.releaseAddGate = null;
                resolve();
            };
        });
        return () => this.releaseAddGate?.();
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

    private enterAsync(label: string): void {
        this.calls.push(label);
        this.inFlightOps += 1;
        if (this.inFlightOps > this.maxConcurrentOps) {
            this.maxConcurrentOps = this.inFlightOps;
        }
    }

    private leaveAsync(): void {
        this.inFlightOps = Math.max(0, this.inFlightOps - 1);
    }

    async addActor(
        id: string,
        model: Live2DActorModel,
        placement?: Live2DActorPlacement & { motion?: string; facial?: string },
        onProgress?: (progress: { loaded: number; total: number }) => void,
    ): Promise<Live2DActorInfo> {
        if (this.destroyed) throw Object.assign(new Error("the stage is destroyed"), { kind: "internal" });
        this.enterAsync(`addActor:${id}:${model.asset}`);
        try {
            const customSteps = this.actorProgressSteps.get(id);
            if (customSteps && customSteps.length > 0) {
                onProgress?.(customSteps[0]!);
            } else {
                onProgress?.({ loaded: 0, total: 10 });
            }
            if (this.addGate) await this.addGate;
            const actorGate = this.actorAddGates.get(id);
            if (actorGate) {
                if (customSteps && customSteps.length > 1) {
                    onProgress?.(customSteps[1]!);
                } else {
                    onProgress?.({ loaded: 5, total: 10 });
                }
                await actorGate.promise;
            }
            if (this.addActorDelayMs > 0) await waitMs(this.addActorDelayMs);
            if (this.destroyed) throw new DOMException("the stage was destroyed", "AbortError");
            if (this.abortNextAddFor.has(id)) {
                this.abortNextAddFor.delete(id);
                throw new DOMException(`actor ${id} aborted`, "AbortError");
            }
            if (this.failNextAddFor.has(id)) {
                this.failNextAddFor.delete(id);
                throw Object.assign(new Error(`failed to fetch ${model.asset}`), { kind: "network" });
            }
            onProgress?.({ loaded: 10, total: 10 });
            this.mounted.set(id, {
                asset: model.asset,
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
                talking: false,
            });
            return { ...DEFAULT_ACTOR_INFO, model: model.asset, motionSet: model.motion ?? null };
        } finally {
            this.leaveAsync();
        }
    }

    removeActor(id: string): void {
        this.calls.push(`removeActor:${id}`);
        this.mounted.delete(id);
    }

    async setActor(id: string, placement: Live2DActorPlacement, tween?: Live2DStageTween): Promise<boolean> {
        if (this.destroyed) return false;
        this.setActorCalls.push({ id, placement: { ...placement }, ...(tween ? { tween: { ...tween } } : {}) });
        this.enterAsync(`setActor:${id}:a=${placement.alpha ?? ""}:x=${placement.x ?? ""}:o=${placement.order ?? ""}`);
        try {
            await flushMicrotasks(1);
            const entry = this.mounted.get(id);
            if (!entry || this.destroyed) return false;
            entry.placement = { ...entry.placement, ...placement };
            return true;
        } finally {
            this.leaveAsync();
        }
    }

    async playMotion(id: string, name: string, _options?: { loop?: boolean }): Promise<boolean> {
        if (this.destroyed) return false;
        this.enterAsync(`playMotion:${id}:${name}`);
        try {
            if (this.playMotionDelayMs > 0) await waitMs(this.playMotionDelayMs);
            const entry = this.mounted.get(id);
            if (!entry || this.destroyed) return false;
            entry.motion = name;
            return true;
        } finally {
            this.leaveAsync();
        }
    }

    async setFacial(id: string, name: string): Promise<boolean> {
        if (this.destroyed) return false;
        this.enterAsync(`setFacial:${id}:${name}`);
        try {
            if (this.playMotionDelayMs > 0) await waitMs(this.playMotionDelayMs);
            const entry = this.mounted.get(id);
            if (!entry || this.destroyed) return false;
            entry.facial = name;
            return true;
        } finally {
            this.leaveAsync();
        }
    }

    setTalking(id: string, on: boolean): void {
        this.calls.push(`setTalking:${id}:${on}`);
        const entry = this.mounted.get(id);
        if (entry) entry.talking = on;
    }

    setMouth(_id: string, _value: number | null): void {}
    setPhysics(_on: boolean): void {}
    setBreath(_on: boolean): void {}

    async setCamera(camera: { zoom?: number; x?: number; y?: number }, _tween?: Live2DStageTween): Promise<boolean> {
        if (this.destroyed) return false;
        this.enterAsync(`setCamera:${camera.x ?? 0},${camera.y ?? 0}`);
        try {
            await waitMs(1);
            return !this.destroyed;
        } finally {
            this.leaveAsync();
        }
    }

    finishTweens(): void {
        this.calls.push("finishTweens");
    }

    play(): void {
        this.paused = false;
        this.calls.push("play");
    }

    pause(): void {
        this.paused = true;
        this.calls.push("pause");
    }

    resize(width: number, height: number): void {
        this.calls.push(`resize:${width}x${height}`);
        this.resizeHistory.push({ width, height });
    }

    destroy(): void {
        this.destroyed = true;
        this.calls.push("destroy");
        this.releaseAddGate?.();
        for (const gate of [...this.actorAddGates.values()]) {
            gate.release();
        }
    }

    simulateCrash(message = "WebGPU device lost", kind: "internal" | "network" = "internal"): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.releaseAddGate?.();
        for (const gate of [...this.actorAddGates.values()]) {
            gate.release();
        }
        this.dispatchEvent(new CustomEvent("error", { detail: { message, kind } }));
    }
}

interface HarnessOptions {
    supported?: { ok: boolean; missing: ("webgpu" | "webgpu-adapter" | "offscreen-canvas" | "worker")[] };
    unavailable?: boolean;
    failCreateCount?: number;
    createDelayMs?: number;
    recoveryDelaysMs?: readonly number[];
    resizeSettleMs?: number;
    initialSize?: StageCanvasSize | null;
    initialHidden?: boolean;
}

function createHarness(opts: HarnessOptions = {}) {
    const host = new FakeHostAdapter();
    if ("initialSize" in opts) host.size = opts.initialSize ?? null;
    if (opts.initialHidden) host.hidden = true;

    const stages: FakeLive2DStage[] = [];
    let createCalls = 0;
    let remainingCreateFails = opts.failCreateCount ?? 0;

    const StageStatic: Live2DStageStatic = {
        async supported() {
            return opts.supported ?? { ok: true, missing: [] };
        },
        async create(options) {
            createCalls += 1;
            if (opts.createDelayMs) await waitMs(opts.createDelayMs);
            if (options.signal?.aborted) {
                throw new DOMException("aborted", "AbortError");
            }
            if (remainingCreateFails > 0) {
                remainingCreateFails -= 1;
                throw Object.assign(new Error("WebGPU adapter init failed"), { kind: "internal" });
            }
            const instance = new FakeLive2DStage(stages.length + 1, options);
            stages.push(instance);
            return instance;
        },
    };

    const controller = new StoryStageController({
        loadStage: async () => {
            if (opts.unavailable) throw new Error(LIVE2D_STAGE_UNAVAILABLE);
            return StageStatic;
        },
        resolveScriptBase: () => "https://example.test/live2d-viewer/",
        resolveCoreUrl: () => "https://example.test/core.js",
        resizeSettleMs: opts.resizeSettleMs ?? 15,
        recoveryDelaysMs: opts.recoveryDelaysMs ?? [10, 20, 30],
        healthyResetMs: 200,
    });

    const boot = async (withModels = true) => {
        controller.setContext({
            cast: [CAST_ICHIKA, CAST_SAKI, CAST_KANADE, CAST_MAFUYU, CAST_ENA, CAST_MIZUKI],
            models: withModels ? TEST_MODELS : null,
        });
        controller.setConfig({ sources: TEST_SOURCES });
        controller.setHost(host);
        await waitMs(15);
        await flushMicrotasks();
    };

    return {
        host,
        stages,
        controller,
        boot,
        getCreateCalls: () => createCalls,
        latestStage: () => stages[stages.length - 1] ?? null,
    };
}

describe("StoryStageController — serialized single-flight queue & coalescing", () => {
    test("serializes rapid concurrent apply bursts with zero overlapping WASM operations and latest-wins coalescing", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;
        expect(controller.getSnapshot().phase.kind).toBe("ready");

        // Fire 10 rapid scene switches concurrently (simulating aggressive scrubbing / node clicking).
        const promises: Promise<void>[] = [];
        for (let i = 0; i < 9; i += 1) {
            const castKey = i % 2 === 0 ? "ichika" : "saki";
            promises.push(controller.apply(makeStageState({
                background: `bg_${i}`,
                actors: [{ cast: castKey, slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" }],
            }), { instant: true }));
        }
        // Final winning state has only Kanade on stage.
        promises.push(controller.apply(makeStageState({
            background: "bg_final",
            actors: [{ cast: "kanade", slot: "right", x: 0.4, y: 0, scale: 1.1, mirror: false, motion: "w-wave01", facial: "face_surprise" }],
        }), { instant: true }));

        await Promise.all(promises);

        // Strict single-flight invariant: NEVER more than 1 async stage operation in-flight!
        expect(stage.maxConcurrentOps).toBe(1);
        expect(stage.actors).toEqual(["kanade"]);
        expect(stage.mounted.get("kanade")?.motion).toBe("w-wave01");
        expect(stage.mounted.get("kanade")?.facial).toBe("face_surprise");
        expect(stage.mounted.get("kanade")?.placement.x).toBe(0.4);
        // Intermediate churn was coalesced instead of loading all 10 scenes sequentially.
        const addCount = stage.calls.filter(c => c.startsWith("addActor:")).length;
        expect(addCount).toBeLessThanOrEqual(3);
        controller.dispose();
    });

    test("deduplicates no-op instant applies (e.g. typing dialogue text) with zero redundant worker calls", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        const baseActor = { cast: "ichika", slot: "center" as const, x: 0, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" };
        await controller.apply(makeStageState({
            dialogue: { stepId: "b1", cast: "ichika", speaker: "一歌", body: "你" },
            actors: [baseActor],
        }), { instant: true });

        const callsAfterFirst = stage.calls.length;

        // Simulate 5 keystrokes updating dialogue body on the same beat.
        for (const body of ["你好", "你好！", "你好！今天", "你好！今天天气", "你好！今天天气真好"]) {
            await controller.apply(makeStageState({
                dialogue: { stepId: "b1", cast: "ichika", speaker: "一歌", body },
                actors: [baseActor],
            }), { instant: true });
        }

        expect(stage.calls.length).toBe(callsAfterFirst);
        controller.dispose();
    });
});

describe("StoryStageController — first-class 0-actor Solo / Audition Preview", () => {
    test("previews character motion & facial cleanly when 0 actors are on stage and restores 0 actors on exit", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        // Scene explicitly has 0 actors on stage.
        await controller.apply(makeStageState({ actors: [] }), { instant: true });
        expect(stage.actors).toEqual([]);

        // Trigger solo audition preview with 0 actors on stage.
        await controller.previewClip(CAST_ICHIKA, { motion: "w-nod01", facial: "face_smile" });

        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(controller.getSnapshot().previewingCastKey).toBe("ichika");
        expect(controller.getSnapshot().modelInfo["01_ichika"]).toBeDefined();
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.placement).toMatchObject({
            x: 0,
            y: 0,
            scale: 1.15,
            alpha: 1,
            order: 100,
        });
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-nod01");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_smile");

        // Rapidly switch clips on the same solo actor: zero reload latency!
        const addCountBeforeSwitch = stage.calls.filter(c => c.startsWith("addActor:")).length;
        await controller.previewClip(CAST_ICHIKA, { motion: "w-wave01" });
        await controller.previewClip(CAST_ICHIKA, { facial: "face_surprise" });
        expect(stage.calls.filter(c => c.startsWith("addActor:")).length).toBe(addCountBeforeSwitch);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-wave01");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_surprise");

        // Switch to another character while in solo preview: replaces cleanly with zero leaked actors.
        await controller.previewClip(CAST_KANADE, { motion: "w-nod01" });
        expect(controller.getSnapshot().previewingCastKey).toBe("kanade");
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.asset).toBe("live2d/model/17_kanade/");

        // Exit solo preview: cleanly returns to 0 actors on stage!
        controller.clearClipPreview();
        await waitMs(15);
        await flushMicrotasks();
        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(controller.getSnapshot().previewingCastKey).toBeNull();
        expect(stage.actors).toEqual([]);
        expect(stage.maxConcurrentOps).toBe(1);
        controller.dispose();
    });

    test("works from non-scene nodes (start/choice/condition/end) and survives non-structural apply edits on same beat", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        // Non-scene node (e.g. start/choice/end) BEFORE any scene actors exist, or with baseline apply.
        await controller.previewClip(CAST_SAKI, { motion: "w-wave01" });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);

        // Initial baseline scene apply (0 actors, same beat) MUST NOT kill active solo preview!
        await controller.apply(makeStageState({
            dialogue: { stepId: "beat_offstage", cast: "saki", speaker: "咲希", body: "画外音台词" },
            actors: [],
        }), { instant: true });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);

        // Picking a clip in ClipPickerField triggers onChange -> apply(same structure) + previewClip!
        const pApply = controller.apply(makeStageState({
            dialogue: { stepId: "beat_offstage", cast: "saki", speaker: "咲希", body: "画外音台词（修改后）" },
            actors: [],
        }), { instant: true });
        const pPreview = controller.previewClip(CAST_SAKI, { facial: "face_smile" });
        await Promise.all([pApply, pPreview]);

        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_smile");

        // Navigating to a DIFFERENT beat/scene exits solo preview and renders the new scene.
        await controller.apply(makeStageState({
            background: "bg_rooftop",
            dialogue: { stepId: "beat_next", cast: "ichika", speaker: "一歌", body: "下一句" },
            actors: [{ cast: "ichika", slot: "left", x: -0.4, y: 0, scale: 1, mirror: false, motion: null, facial: null }],
        }), { instant: true });

        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(stage.actors).toEqual(["ichika"]);
        controller.dispose();
    });

    test("stows active scene actors on solo preview entry and restores them on exit without reloading", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        await controller.apply(makeStageState({
            actors: [
                { cast: "ichika", slot: "left", x: -0.4, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "saki", slot: "right", x: 0.4, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        }), { instant: true });
        expect(stage.actors).toEqual(["ichika", "saki"]);

        // Audition Kanade (who is not on stage) in solo preview.
        await controller.previewClip(CAST_KANADE, { motion: "w-nod01" });
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(0);
        expect(stage.mounted.get("saki")?.placement.alpha).toBe(0);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.placement.alpha).toBe(1);

        const ichikaAddsBeforeExit = stage.calls.filter(c => c.startsWith("addActor:ichika")).length;
        controller.clearClipPreview();
        await waitMs(15);
        await flushMicrotasks();

        expect(stage.actors).toEqual(["ichika", "saki"]);
        expect(stage.mounted.get("ichika")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("saki")?.placement.alpha).toBe(1);
        // Scene actors were kept cached in worker memory and restored with zero reload!
        expect(stage.calls.filter(c => c.startsWith("addActor:ichika")).length).toBe(ichikaAddsBeforeExit);
        controller.dispose();
    });

    test("latches solo preview requested while stage is booting and models are still loading", async () => {
        const { controller, boot, latestStage } = createHarness({ createDelayMs: 25 });
        // Start boot WITHOUT models yet (`models = null`).
        controller.setContext({ cast: [CAST_ICHIKA, CAST_KANADE], models: null });
        controller.setConfig({ sources: TEST_SOURCES });

        // User clicks preview immediately while stage isn't ready and models aren't loaded yet!
        const previewPromise = controller.previewClip(CAST_KANADE, { motion: "w-wave01", facial: "face_smile" });
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(controller.getSnapshot().previewingCastKey).toBe("kanade");

        // Now host attaches and stage boots, then models arrive.
        await boot(false);
        await waitMs(35);
        expect(controller.getSnapshot().phase.kind).toBe("ready");

        controller.setContext({ cast: [CAST_ICHIKA, CAST_KANADE], models: TEST_MODELS });
        await previewPromise;

        const stage = latestStage()!;
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.asset).toBe("live2d/model/17_kanade/");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-wave01");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_smile");
        controller.dispose();
    });

    test("replays explicit clip in-place when actor is already on stage, without entering solo preview", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        await controller.apply(makeStageState({
            actors: [{ cast: "ichika", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: "w-idle01", facial: "face_normal" }],
        }), { instant: true });

        await controller.previewClip(CAST_ICHIKA, { motion: "w-wave01" });
        expect(controller.getSnapshot().isSoloPreview).toBe(false);
        expect(stage.actors).toEqual(["ichika"]);
        expect(stage.mounted.get("ichika")?.motion).toBe("w-wave01");
        controller.dispose();
    });
});

describe("StoryStageController — crash recovery, state replay & error classification", () => {
    test("automatically recovers from worker/WebGPU crash with a fresh canvas and replays desired scene state", async () => {
        const { controller, host, stages, boot } = createHarness({ recoveryDelaysMs: [10, 20, 30] });
        await boot(true);
        const stage1 = stages[0]!;

        await controller.apply(makeStageState({
            actors: [
                { cast: "ichika", slot: "left", x: -0.4, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" },
            ],
        }), { instant: true });
        controller.setTalking("ichika");
        await waitMs(10);
        expect(stage1.mounted.get("ichika")?.talking).toBe(true);

        // Simulate WebGPU device lost / worker fatal error!
        stage1.simulateCrash("WebGPU surface lost", "internal");
        expect(controller.getSnapshot().phase.kind).toBe("recovering");
        expect(stage1.destroyed).toBe(true);

        // Wait for bounded auto-recovery timer + reboot + replay.
        await waitMs(50);
        await flushMicrotasks();

        expect(stages.length).toBe(2);
        const stage2 = stages[1]!;
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        // Fresh canvas was created (never reusing transferred canvas #1!).
        expect(host.canvases.length).toBe(2);
        expect(stage2.canvasRef.id).not.toBe(stage1.canvasRef.id);
        // Latest desired scene state + talking state were replayed automatically!
        expect(stage2.actors).toEqual(["ichika"]);
        expect(stage2.mounted.get("ichika")?.motion).toBe("w-nod01");
        expect(stage2.mounted.get("ichika")?.facial).toBe("face_smile");
        expect(stage2.mounted.get("ichika")?.talking).toBe(true);
        controller.dispose();
    });

    test("automatically replays active Solo Preview (including cumulative motion + facial) after worker crash", async () => {
        const { controller, stages, boot } = createHarness({ recoveryDelaysMs: [10, 20] });
        await boot(true);
        const stage1 = stages[0]!;

        // Enter solo preview with 0 actors on stage, audition motion then facial separately.
        await controller.previewClip(CAST_KANADE, { motion: "w-wave01" });
        await controller.previewClip(CAST_KANADE, { facial: "face_surprise" });
        expect(stage1.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-wave01");
        expect(stage1.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_surprise");

        // Crash worker mid-preview!
        stage1.simulateCrash("GPU reset");
        expect(controller.getSnapshot().phase.kind).toBe("recovering");
        expect(controller.getSnapshot().isSoloPreview).toBe(true);

        await waitMs(50);
        await flushMicrotasks();

        expect(stages.length).toBe(2);
        const stage2 = stages[1]!;
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        expect(stage2.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);
        expect(stage2.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.asset).toBe("live2d/model/17_kanade/");
        expect(stage2.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-wave01");
        expect(stage2.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_surprise");
        controller.dispose();
    });

    test("falls back to failed phase after bounded recovery budget is exhausted, and manual retry recovers cleanly", async () => {
        const { controller, stages, boot, getCreateCalls } = createHarness({
            failCreateCount: 3, // initial boot + 2 auto-recovery attempts fail; manual retry (#4) succeeds!
            recoveryDelaysMs: [10, 15],
        });
        await boot(true);
        await waitMs(80);
        await flushMicrotasks();

        expect(getCreateCalls()).toBe(3); // 1 initial + 2 retries
        expect(controller.getSnapshot().phase.kind).toBe("failed");

        // Manual retry resets recovery budget and boots cleanly.
        controller.retry();
        await waitMs(25);
        await flushMicrotasks();

        expect(getCreateCalls()).toBe(4);
        expect(stages.length).toBe(1);
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        controller.dispose();
    });

    test("calling previewClip while failed triggers recovery and mounts the requested solo actor", async () => {
        const { controller, stages, boot, getCreateCalls } = createHarness({
            failCreateCount: 2, // initial + 1 auto-recovery fail -> enters failed; previewClip triggers #3 which succeeds
            recoveryDelaysMs: [10],
        });
        await boot(true);
        await waitMs(45);
        await flushMicrotasks();
        expect(controller.getSnapshot().phase.kind).toBe("failed");

        await controller.previewClip(CAST_KANADE, { motion: "w-nod01", facial: "face_smile" });
        expect(getCreateCalls()).toBe(3);
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        expect(controller.getSnapshot().isSoloPreview).toBe(true);
        const stage = stages[0]!;
        expect(stage.actors).toEqual([SOLO_PREVIEW_ACTOR_ID]);
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.motion).toBe("w-nod01");
        expect(stage.mounted.get(SOLO_PREVIEW_ACTOR_ID)?.facial).toBe("face_smile");
        controller.dispose();
    });

    test("serializes camera shake with scene navigation and yields cleanly on finish/apply", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        const shakePromise = controller.shake(1.0);
        await waitMs(5);
        const applyPromise = controller.apply(makeStageState({
            actors: [{ cast: "ichika", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null }],
        }), { instant: true });

        await Promise.all([shakePromise, applyPromise]);
        expect(stage.maxConcurrentOps).toBe(1);
        expect(stage.actors).toEqual(["ichika"]);
        // Camera was reset to 0,0 when shake yielded.
        const camCalls = stage.calls.filter(c => c.startsWith("setCamera:"));
        expect(camCalls[camCalls.length - 1]).toBe("setCamera:0,0");
        controller.dispose();
    });

    test("does not auto-retry permanent unavailable/unsupported errors and ignores benign AbortError on addActor", async () => {
        const unavailableHarness = createHarness({ unavailable: true, recoveryDelaysMs: [5, 5] });
        await unavailableHarness.boot(true);
        await waitMs(30);
        expect(unavailableHarness.controller.getSnapshot().phase.kind).toBe("unavailable");
        expect(unavailableHarness.getCreateCalls()).toBe(0);
        unavailableHarness.controller.dispose();

        const unsupportedHarness = createHarness({
            supported: { ok: false, missing: ["webgpu"] },
            recoveryDelaysMs: [5, 5],
        });
        await unsupportedHarness.boot(true);
        await waitMs(30);
        expect(unsupportedHarness.controller.getSnapshot().phase).toEqual({ kind: "unsupported", missing: ["webgpu"] });
        expect(unsupportedHarness.getCreateCalls()).toBe(0);
        unsupportedHarness.controller.dispose();

        // Benign AbortError must never pollute `problems`.
        const abortHarness = createHarness();
        await abortHarness.boot(true);
        const stage = abortHarness.latestStage()!;
        stage.abortNextAddFor.add("ichika");
        await abortHarness.controller.apply(makeStageState({
            actors: [{ cast: "ichika", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null }],
        }), { instant: true });
        expect(abortHarness.controller.getSnapshot().problems).toEqual({});
        abortHarness.controller.dispose();
    });
});

describe("StoryStageController — 0x0 resize guard, hidden-tab pause/resume & StrictMode remount", () => {
    test("defers WebGPU boot on 0x0 host and never invokes resize with zero dimensions", async () => {
        const { controller, host, stages, boot, getCreateCalls } = createHarness({
            initialSize: { width: 0, height: 0 },
            resizeSettleMs: 10,
        });
        await boot(true);
        await waitMs(30);

        // Must NOT boot WebGPU at 0x0 or 1x1!
        expect(getCreateCalls()).toBe(0);
        expect(controller.getSnapshot().phase.kind).toBe("loading");

        // Once CSS layout gives real dimensions, boot proceeds immediately.
        host.triggerResize({ width: 960, height: 540 });
        await waitMs(25);
        await flushMicrotasks();

        expect(getCreateCalls()).toBe(1);
        const stage = stages[0]!;
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        expect(stage.initOptions.width).toBe(960);
        expect(stage.initOptions.height).toBe(540);

        // Collapsing host to 0x0 pauses stage instead of calling resize(0, 0) / resize(1, 1)!
        host.triggerResize({ width: 0, height: 0 });
        await waitMs(25);
        expect(stage.resizeHistory).toEqual([]);
        expect(stage.paused).toBe(true);

        // Restoring valid dimensions resumes stage and resizes cleanly.
        host.triggerResize({ width: 1440, height: 810 });
        await waitMs(30);
        expect(stage.paused).toBe(false);
        expect(stage.resizeHistory).toEqual([{ width: 1440, height: 810 }]);
        controller.dispose();
    });

    test("pauses rendering when tab is hidden and resumes with fresh size when visible again", async () => {
        const { controller, host, latestStage, boot } = createHarness({ resizeSettleMs: 10 });
        await boot(true);
        const stage = latestStage()!;
        expect(stage.paused).toBe(false);

        host.triggerVisibility(true);
        await waitMs(15);
        expect(stage.paused).toBe(true);

        // Resizes while hidden are ignored until tab returns.
        host.size = { width: 1600, height: 900 };
        host.triggerResize({ width: 1600, height: 900 });
        await waitMs(25);
        expect(stage.resizeHistory).toEqual([]);

        // Tab becomes visible again: applies new size and resumes rendering.
        host.triggerVisibility(false);
        await waitMs(15);
        expect(stage.paused).toBe(false);
        expect(stage.resizeHistory).toEqual([{ width: 1600, height: 900 }]);
        controller.dispose();
    });

    test("handles React StrictMode detach/remount mid-boot cleanly without leaking workers or reusing transferred canvases", async () => {
        const { controller, host, stages } = createHarness({ createDelayMs: 25 });
        controller.setContext({ cast: [CAST_ICHIKA], models: TEST_MODELS });
        controller.setConfig({ sources: TEST_SOURCES });

        // Mount #1 begins async Stage.create.
        controller.setHost(host);
        await waitMs(5);

        // StrictMode immediate cleanup detaches before Mount #1 resolves.
        controller.detach();

        // Mount #2 re-attaches host cleanly.
        controller.setHost(host);
        await waitMs(45);
        await flushMicrotasks();

        // Only Mount #2's stage survived; zero transferred canvas reuse error!
        expect(controller.getSnapshot().phase.kind).toBe("ready");
        expect(stages.length).toBe(1);
        expect(stages[0]!.destroyed).toBe(false);
        controller.dispose();
    });
});

describe("StoryStageController — Live2D Z-layer & move/speaker anti-occlusion", () => {
    test("elevates moving actor order at duration 0 BEFORE starting the moveActor tween", async () => {
        const { controller, latestStage, boot } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        // Initial 3-actor stage: ichika is back-most (index 0), saki (1), kanade (2).
        await controller.apply(
            makeStageState({
                actors: [
                    { cast: "ichika", slot: "left", x: -0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                    { cast: "saki", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                    { cast: "kanade", slot: "right", x: 0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                ],
            }),
            { instant: true },
        );

        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("saki")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);

        stage.setActorCalls = [];

        // Ichika moves from left to right with runtime-bumped autoOrder=1 while neighbors stay stationary.
        await controller.apply(
            makeStageState({
                actors: [
                    { cast: "ichika", slot: "right", x: 0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null, autoOrder: 1 },
                    { cast: "saki", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                    { cast: "kanade", slot: "left", x: -0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                ],
            }),
            { instant: false, moveSeconds: 0.45 },
        );

        // Find the immediate order-elevation call and the tweened move call for ichika.
        const orderElevateIdx = stage.setActorCalls.findIndex(
            c => c.id === "ichika" && c.placement.order === 2 && c.placement.x === undefined && c.tween?.duration === 0,
        );
        const sakiDropIdx = stage.setActorCalls.findIndex(
            c => c.id === "saki" && c.placement.order === 0 && c.placement.x === undefined && c.tween?.duration === 0,
        );
        const kanadeDropIdx = stage.setActorCalls.findIndex(
            c => c.id === "kanade" && c.placement.order === 1 && c.placement.x === undefined && c.tween?.duration === 0,
        );
        const moveTweenIdx = stage.setActorCalls.findIndex(
            c => c.id === "ichika" && c.placement.x === 0.573 && c.tween?.duration === 0.45,
        );

        expect(orderElevateIdx).toBeGreaterThanOrEqual(0);
        expect(sakiDropIdx).toBeGreaterThanOrEqual(0);
        expect(kanadeDropIdx).toBeGreaterThanOrEqual(0);
        expect(moveTweenIdx).toBeGreaterThan(orderElevateIdx);
        expect(moveTweenIdx).toBeGreaterThan(sakiDropIdx);
        expect(moveTweenIdx).toBeGreaterThan(kanadeDropIdx);

        expect(stage.mounted.get("ichika")?.placement.order).toBe(2);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(1);
        expect(stage.mounted.get("saki")?.placement.order).toBe(0);
        controller.dispose();
    });

    test("strictly respects explicit z over automatic move recency and active speaker tie-breaking", async () => {
        const { controller, latestStage, boot } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        // Ichika has explicit z=-1 (background), saki defaults to 0, kanade has explicit z=10 (foreground).
        // Even though ichika has highest autoOrder=5 AND is speaking, explicit z MUST win!
        await controller.apply(
            makeStageState({
                speaking: "ichika",
                actors: [
                    { cast: "ichika", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null, z: -1, autoOrder: 5 },
                    { cast: "saki", slot: "left", x: -0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                    { cast: "kanade", slot: "right", x: 0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null, z: 10 },
                ],
            }),
            { instant: true },
        );

        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("saki")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);

        // Moving ichika with explicit z=-1 keeps her behind saki (z=0) and kanade (z=10).
        await controller.apply(
            makeStageState({
                speaking: null,
                actors: [
                    { cast: "ichika", slot: "right", x: 0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null, z: -1, autoOrder: 6 },
                    { cast: "saki", slot: "left", x: -0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                    { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null, z: 10 },
                ],
            }),
            { instant: false, moveSeconds: 0.3 },
        );

        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("saki")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);

        // Calling setTalking("ichika") also never overrides explicit z=-1.
        controller.setTalking("ichika");
        await waitMs(15);
        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);
        controller.dispose();
    });

    test("updates stage actor order live when z or speaker changes via apply and setTalking", async () => {
        const { controller, latestStage, boot } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        // 1. Base 3-actor scene (all z unset, autoOrder unset, speaking null) -> ichika=0, saki=1, kanade=2
        const baseActors = [
            { cast: "ichika", slot: "center" as const, x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            { cast: "saki", slot: "left" as const, x: -0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            { cast: "kanade", slot: "right" as const, x: 0.573, y: 0, scale: 1, mirror: false, motion: null, facial: null },
        ];
        await controller.apply(makeStageState({ actors: baseActors, speaking: null }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("saki")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);

        // 2. Live setTalking("ichika") promotes ichika to front immediately, and setTalking(null) restores base order
        controller.setTalking("ichika");
        await waitMs(15);
        expect(stage.mounted.get("ichika")?.placement.order).toBe(2);
        expect(stage.mounted.get("saki")?.placement.order).toBe(0);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(1);

        controller.setTalking(null);
        await waitMs(15);
        expect(stage.mounted.get("ichika")?.placement.order).toBe(0);
        expect(stage.mounted.get("saki")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(2);

        // 3. Apply a talk beat with speaking="ichika" -> promotes ichika live even in instant mode (not deduped!)
        await controller.apply(makeStageState({ actors: baseActors, speaking: "ichika" }), { instant: true });
        expect(stage.mounted.get("ichika")?.placement.order).toBe(2);

        // Stopping mouth flap while dialogue line stays on screen keeps ichika in front!
        controller.setTalking("ichika");
        await waitMs(10);
        controller.setTalking(null);
        await waitMs(15);
        expect(stage.mounted.get("ichika")?.placement.order).toBe(2);

        // 4. Pose/edit setting explicit z=5 on saki immediately promotes saki above speaking ichika
        await controller.apply(
            makeStageState({
                speaking: "ichika",
                actors: [
                    baseActors[0]!,
                    { ...baseActors[1]!, z: 5 },
                    baseActors[2]!,
                ],
            }),
            { instant: true },
        );
        expect(stage.mounted.get("saki")?.placement.order).toBe(2);
        expect(stage.mounted.get("ichika")?.placement.order).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.order).toBe(0);
        controller.dispose();
    });

    test("applyInstructionToStage preserves explicit z and bumps autoOrder on enter, move, pose, and talk", () => {
        const doc = createStoryDocument("jp", "Z-Layer Playback Test");
        doc.cast = [CAST_ICHIKA, CAST_SAKI, CAST_KANADE];

        // 1. enterScene with explicit z on kanade
        const s1 = applyInstructionToStage(
            INITIAL_STAGE_STATE,
            {},
            {
                op: "enterScene",
                nodeId: "scene_1",
                background: { mode: "inherit" },
                bgm: { mode: "inherit" },
                place: { mode: "inherit" },
                transition: { kind: "none" },
                stageCast: {
                    mode: "set",
                    actors: [
                        { castKey: "ichika", slot: "center" },
                        { castKey: "saki", slot: "left" },
                        { castKey: "kanade", slot: "right", z: 10 },
                    ],
                },
            },
            doc,
        );
        expect(s1.stage.actors.find(a => a.cast === "kanade")?.z).toBe(10);
        expect(computeActorRenderOrders(s1.stage.actors)).toEqual({ ichika: 0, saki: 1, kanade: 2 });

        // 2. stage move bumps ichika autoOrder (moves ahead of equal-z saki, still behind explicit z=10 kanade)
        const s2 = applyInstructionToStage(
            s1.stage,
            s1.variables,
            {
                op: "stageAction",
                nodeId: "scene_1",
                beat: { id: "b1", kind: "stageAction", action: "move", castKey: "ichika", slot: "right", duration: 0.4 },
            },
            doc,
        );
        expect(s2.stage.actors.find(a => a.cast === "ichika")?.autoOrder).toBe(1);
        expect(computeActorRenderOrders(s2.stage.actors)).toEqual({ saki: 0, ichika: 1, kanade: 2 });

        // 3. stage pose with explicit z=15 lifts saki above kanade without altering autoOrder
        const s3 = applyInstructionToStage(
            s2.stage,
            s2.variables,
            {
                op: "stageAction",
                nodeId: "scene_1",
                beat: { id: "b2", kind: "stageAction", action: "pose", castKey: "saki", z: 15 },
            },
            doc,
        );
        expect(s3.stage.actors.find(a => a.cast === "saki")?.z).toBe(15);
        expect(s3.stage.actors.find(a => a.cast === "saki")?.autoOrder).toBeUndefined();
        expect(computeActorRenderOrders(s3.stage.actors)).toEqual({ ichika: 0, kanade: 1, saki: 2 });

        // 4. talk beat sets speaking and bumps autoOrder for on-stage speaker
        const s4 = applyInstructionToStage(
            s1.stage,
            s1.variables,
            {
                op: "talk",
                nodeId: "scene_1",
                beat: { id: "b3", kind: "talk", speakerKey: "ichika", body: "你好" },
            },
            doc,
        );
        expect(s4.stage.speaking).toBe("ichika");
        expect(s4.stage.actors.find(a => a.cast === "ichika")?.autoOrder).toBe(1);
        expect(computeActorRenderOrders(s4.stage.actors, s4.stage.speaking)).toEqual({ saki: 0, ichika: 1, kanade: 2 });
    });
});

describe("Live2D Stage SSAA Antialiasing (computeStageCanvasSize & dynamic quality)", () => {
    test("computes adaptive SSAA dimensions for compact editor pane (480x270) and theater (1280x720) across dpr 1 & 2", () => {
        // Compact 480x270 editor pane at dpr=1
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 1, "standard")).toEqual({ width: 480, height: 270 });
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 1, "high")).toEqual({ width: 1280, height: 720 });
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 1, "ultra")).toEqual({ width: 1920, height: 1080 });

        // Compact 480x270 editor pane at dpr=2
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 2, "standard")).toEqual({ width: 960, height: 540 });
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 2, "high")).toEqual({ width: 1440, height: 810 });
        expect(computeStageCanvasSize({ width: 480, height: 270 }, 2, "ultra")).toEqual({ width: 1920, height: 1080 });

        // Full 1280x720 theater stage at dpr=1
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 1, "standard")).toEqual({ width: 1280, height: 720 });
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 1, "high")).toEqual({ width: 2560, height: 1440 });
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 1, "ultra")).toEqual({ width: 3200, height: 1800 });

        // Full 1280x720 theater stage at dpr=2: safe upper caps (2048 / 2560 / 3840) preserving 16:9 aspect ratio
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 2, "standard")).toEqual({ width: 2048, height: 1152 });
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 2, "high")).toEqual({ width: 2560, height: 1440 });
        expect(computeStageCanvasSize({ width: 1280, height: 720 }, 2, "ultra")).toEqual({ width: 3840, height: 2160 });

        // Degenerate / zero sizes rejected cleanly
        expect(computeStageCanvasSize(null, 1, "high")).toBeNull();
        expect(computeStageCanvasSize({ width: 0, height: 270 }, 1, "high")).toBeNull();
        expect(computeStageCanvasSize({ width: 480, height: Number.NaN }, 1, "high")).toBeNull();
    });

    test("boots at default high SSAA resolution and switches quality dynamically via serialized resize without restarting worker", async () => {
        const { controller, host, stages, getCreateCalls } = createHarness();
        host.cssSize = { width: 480, height: 270 };
        host.dpr = 1;

        controller.setContext({ cast: [CAST_ICHIKA], models: TEST_MODELS });
        controller.setConfig({ sources: TEST_SOURCES });
        controller.setHost(host);
        await waitMs(25);
        await flushMicrotasks();

        // Default quality ("high") boots compact 480x270 pane at crisp 1280x720 SSAA!
        expect(getCreateCalls()).toBe(1);
        const stage = stages[0]!;
        expect(stage.initOptions.width).toBe(1280);
        expect(stage.initOptions.height).toBe(720);
        expect(host.canvases[0]?.width).toBe(1280);
        expect(host.canvases[0]?.height).toBe(720);
        expect(host.sizeHints[0]).toEqual({ size: { width: 1280, height: 720 }, quality: "high" });

        // Switch dynamically to "ultra" -> serialized resize(1920, 1080), zero worker recreation!
        controller.setRenderQuality("ultra");
        await waitMs(15);
        await flushMicrotasks();
        expect(getCreateCalls()).toBe(1);
        expect(stage.destroyed).toBe(false);
        expect(stage.resizeHistory).toEqual([{ width: 1920, height: 1080 }]);

        // Switch dynamically to "standard" -> serialized resize(480, 270), zero worker recreation!
        controller.setRenderQuality("standard");
        await waitMs(15);
        await flushMicrotasks();
        expect(getCreateCalls()).toBe(1);
        expect(stage.resizeHistory).toEqual([
            { width: 1920, height: 1080 },
            { width: 480, height: 270 },
        ]);
        expect(host.sizeHints[host.sizeHints.length - 1]).toEqual({
            size: { width: 480, height: 270 },
            quality: "standard",
        });

        controller.dispose();
    });
});

describe("StoryStageController — multi-actor parallel loading, alpha recovery & aggregate progress (#207/#209)", () => {
    test("loads 2-actor scenes in parallel and keeps aggregate loadProgress visible until ALL actors finish without blacking out actor 1", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;
        stage.addActorDelayMs = 4;

        // Let Kanade finish quickly while Mafuyu pauses midway at 5/10 files.
        const releaseMafuyu = stage.pauseAddActorFor("mafuyu");
        stage.actorProgressSteps.set("mafuyu", [
            { loaded: 0, total: 10 },
            { loaded: 5, total: 10 },
        ]);

        const snapshots: Array<{
            loadingActors: number;
            loadProgress: ReturnType<StoryStageController["getSnapshot"]>["loadProgress"];
        }> = [];
        const unsub = controller.subscribe(() => {
            const snap = controller.getSnapshot();
            snapshots.push({
                loadingActors: snap.loadingActors,
                loadProgress: snap.loadProgress ? { ...snap.loadProgress } : null,
            });
        });

        const applyPromise = controller.apply(makeStageState({
            background: "bg_kanade_room",
            actors: [
                { cast: "kanade", slot: "left", x: -0.35, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" },
                { cast: "mafuyu", slot: "right", x: 0.35, y: 0, scale: 1, mirror: false, motion: "w-wave01", facial: "face_normal" },
            ],
        }), { instant: true });

        // Wait deterministically for Kanade (addActor + motion + facial) to settle while Mafuyu stays gated.
        const deadline = Date.now() + 500;
        while ((controller.getSnapshot().loadProgress?.completedActors ?? 0) < 1 && Date.now() < deadline) {
            await waitMs(5);
            await flushMicrotasks();
        }

        // Both actors started loading concurrently!
        expect(stage.maxConcurrentOps).toBeGreaterThanOrEqual(2);
        // Kanade is ALREADY rendered and visible (not blacked out waiting for Mafuyu)!
        expect(stage.actors).toContain("kanade");
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        // Aggregate loading progress MUST remain active (`loadingActors === 1`, 1/2 completed, 75%)!
        const midSnap = controller.getSnapshot();
        expect(midSnap.loadingActors).toBe(1);
        expect(midSnap.loadProgress).toMatchObject({
            totalActors: 2,
            completedActors: 1,
            activeActors: 1,
            percent: 75,
        });

        // Now let Mafuyu complete.
        releaseMafuyu();
        await applyPromise;
        unsub();

        expect(stage.actors.sort()).toEqual(["kanade", "mafuyu"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("mafuyu")?.placement.alpha).toBe(1);
        expect(controller.getSnapshot().loadingActors).toBe(0);
        expect(controller.getSnapshot().loadProgress).toBeNull();
        expect(controller.getSnapshot().problems).toEqual({});
        // Initial batch snapshot had totalActors: 2 and never prematurely dropped to 0 before Mafuyu finished.
        expect(snapshots.some(s => s.loadProgress?.totalActors === 2 && s.loadProgress.completedActors === 1)).toBe(true);
        controller.dispose();
    });

    test("never leaves actor 1 stranded invisible at alpha=0 when a fade-in multi-actor apply is superseded mid-load by instant apply, setTalking, or resize", async () => {
        const { controller, host, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;
        stage.addActorDelayMs = 4;

        // Reproduce exact #207 scenario: enterScene fadeBlack (`instant: false, fade: true`)
        // starts loading Kanade + Mafuyu at alpha=0; while Mafuyu is still loading, user clicks
        // Next (snapCurrentFrame -> `instant: true`), speaker changes, and viewport resizes!
        const releaseMafuyu = stage.pauseAddActorFor("mafuyu");
        const sceneActors = [
            { cast: "kanade", slot: "left" as const, x: -0.35, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" },
            { cast: "mafuyu", slot: "right" as const, x: 0.35, y: 0, scale: 1, mirror: false, motion: "w-idle01", facial: "face_normal" },
        ];

        const p1 = controller.apply(makeStageState({
            background: "bg_kanade_room",
            actors: sceneActors,
        }), { instant: false, fade: true });

        // Wait until Kanade finishes addActor (mounted at alpha=0), then supersede BEFORE Mafuyu finishes!
        await waitMs(15);
        await flushMicrotasks();

        const p2 = controller.apply(makeStageState({
            background: "bg_kanade_room",
            speaking: "kanade",
            actors: sceneActors,
        }), { instant: true });
        controller.setTalking("kanade");
        host.triggerResize({ width: 1440, height: 810 });

        releaseMafuyu();
        await Promise.all([p1, p2]);
        await waitMs(25);
        await flushMicrotasks();

        // BOTH Kanade and Mafuyu MUST be mounted AND fully visible (`alpha === 1`)!
        expect(stage.actors.sort()).toEqual(["kanade", "mafuyu"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("mafuyu")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("kanade")?.placement.x).toBe(-0.35);
        expect(stage.mounted.get("mafuyu")?.placement.x).toBe(0.35);
        expect(stage.mounted.get("kanade")?.talking).toBe(true);
        // Kanade was NOT needlessly reloaded twice.
        expect(stage.calls.filter(c => c.startsWith("addActor:kanade")).length).toBe(1);
        controller.dispose();
    });

    test("recovers cleanly from a transient partial load failure on 1 of 2 actors without dropping or reloading the healthy actor", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;

        stage.failNextAddFor.add("mafuyu");
        const twoActorState = makeStageState({
            background: "bg_kanade_room",
            actors: [
                { cast: "kanade", slot: "left", x: -0.35, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" },
                { cast: "mafuyu", slot: "right", x: 0.35, y: 0, scale: 1, mirror: false, motion: "w-wave01", facial: "face_surprise" },
            ],
        });

        await controller.apply(twoActorState, { instant: true });
        expect(stage.actors).toEqual(["kanade"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        expect(controller.getSnapshot().problems).toEqual({ mafuyu: "loadFailed" });

        const kanadeAddsBeforeRetry = stage.calls.filter(c => c.startsWith("addActor:kanade")).length;

        // Re-applying the exact same scene state MUST retry Mafuyu (not short-circuit on cached visualKey!)
        // and MUST NOT reload Kanade!
        await controller.apply(twoActorState, { instant: true });
        expect(stage.actors.sort()).toEqual(["kanade", "mafuyu"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("mafuyu")?.placement.alpha).toBe(1);
        expect(controller.getSnapshot().problems).toEqual({});
        expect(stage.calls.filter(c => c.startsWith("addActor:kanade")).length).toBe(kanadeAddsBeforeRetry);
        controller.dispose();
    });

    test("reconciles rapid multi-scene transitions (1 -> 4 -> 0 -> 2 actors) and worker actor drift with exact final actor set and alpha=1", async () => {
        const { controller, boot, latestStage } = createHarness();
        await boot(true);
        const stage = latestStage()!;
        stage.addActorDelayMs = 3;

        const scene1 = makeStageState({
            background: "bg_scene_01",
            actors: [
                { cast: "kanade", slot: "center", x: 0, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        });
        const scene2FourActors = makeStageState({
            background: "bg_scene_02",
            speaking: "ena",
            actors: [
                { cast: "kanade", slot: "farLeft", x: -0.6, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "mafuyu", slot: "left", x: -0.2, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "ena", slot: "right", x: 0.2, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "mizuki", slot: "farRight", x: 0.6, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
        });
        const scene3Empty = makeStageState({
            background: "bg_scene_03",
            actors: [],
        });
        const scene4TwoActors = makeStageState({
            background: "bg_scene_04",
            speaking: "mafuyu",
            actors: [
                { cast: "kanade", slot: "left", x: -0.35, y: 0, scale: 1, mirror: false, motion: "w-nod01", facial: "face_smile" },
                { cast: "mafuyu", slot: "right", x: 0.35, y: 0, scale: 1, mirror: false, motion: "w-wave01", facial: "face_normal" },
            ],
        });

        // Fire rapid sequence mirroring fast player progression across nightcord_unspoken_echo.
        const p1 = controller.apply(scene1, { instant: false, fade: true });
        await waitMs(2);
        const p2 = controller.apply(scene2FourActors, { instant: false, fade: true });
        await waitMs(4);
        const p3 = controller.apply(scene3Empty, { instant: false, fade: true });
        const p4 = controller.apply(scene4TwoActors, { instant: false, fade: true });

        await Promise.all([p1, p2, p3, p4]);

        expect(stage.actors.sort()).toEqual(["kanade", "mafuyu"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("mafuyu")?.placement.alpha).toBe(1);
        expect(stage.mounted.get("mafuyu")!.placement.order!).toBeGreaterThan(stage.mounted.get("kanade")!.placement.order!);
        expect(controller.getSnapshot().loadingActors).toBe(0);
        expect(controller.getSnapshot().loadProgress).toBeNull();

        // Simulate 4-actor scene finishing completely with all 4 mounted & visible.
        await controller.apply(scene2FourActors, { instant: false, fade: true });
        expect(stage.actors.sort()).toEqual(["ena", "kanade", "mafuyu", "mizuki"]);
        for (const id of ["kanade", "mafuyu", "ena", "mizuki"]) {
            expect(stage.mounted.get(id)?.placement.alpha).toBe(1);
        }

        // Simulate worker-side drift dropping Kanade silently -> instant re-apply detects & heals it!
        stage.mounted.delete("kanade");
        expect(stage.actors.includes("kanade")).toBe(false);
        await controller.apply(scene2FourActors, { instant: true });
        expect(stage.actors.sort()).toEqual(["ena", "kanade", "mafuyu", "mizuki"]);
        expect(stage.mounted.get("kanade")?.placement.alpha).toBe(1);
        controller.dispose();
    });
});
