import {
    computeActorRenderOrders,
    live2dCoreUrl,
    STORY_FADE_SECONDS,
    type Live2DModel,
    type StoryActorState,
    type StoryCastMember,
    type StoryStageState,
} from "@moesekai/story-core";
import {
    isLive2DAbortError,
    LIVE2D_STAGE_MAX_ACTORS,
    LIVE2D_STAGE_UNAVAILABLE,
    loadLive2DStage,
    type Live2DActorInfo,
    type Live2DActorPlacement,
    type Live2DStage,
    type Live2DStageError,
    type Live2DStageErrorKind,
    type Live2DStageMissing,
    type Live2DStageStatic,
} from "./stage";
import { resolveModelBundlesForStage, type ResolvedLive2DModelBundles } from "./clipCatalog";
import { live2dViewerScriptBase } from "./viewer";

export type StoryStagePhase =
    | { kind: "idle" }
    | { kind: "unavailable" }
    | { kind: "loading" }
    | { kind: "recovering"; attempt: number; maxAttempts: number; message?: string }
    | { kind: "ready" }
    | { kind: "unsupported"; missing: Live2DStageMissing[] }
    | { kind: "failed"; error: Live2DStageErrorKind; message: string; url?: string };

/** Why one actor is not on the stage. */
export type StoryActorProblem = "modelMissing" | "loadFailed";

export interface StoryStageApplyOptions {
    /** Snap to the target (seeking) rather than play the changes. */
    instant: boolean;
    /** Seconds of moves (a move step's duration). */
    moveSeconds?: number;
    /** Fade actors in and out (appear / hide steps with `fade`). */
    fade?: boolean;
}

export interface StoryClipPreviewRequest {
    motion?: string;
    facial?: string;
}

export interface StoryStageLoadProgress {
    /** Total actors queued in the active loading batch. */
    totalActors: number;
    /** Actors in the batch that have finished mounting (or settled). */
    completedActors: number;
    /** Actors in the batch still loading. */
    activeActors: number;
    /** Aggregate file units reported loaded across the active batch. */
    loadedFiles: number;
    /** Aggregate total file units reported across the active batch. */
    totalFiles: number;
    /** Combined 0–100 integer progress across all actors in the batch (`null` while indeterminate). */
    percent: number | null;
}

export interface StoryStageSnapshot {
    phase: StoryStagePhase;
    modelInfo: Record<string, Live2DActorInfo>;
    problems: Record<string, StoryActorProblem>;
    loadingActors: number;
    loadProgress: StoryStageLoadProgress | null;
    isSoloPreview: boolean;
    previewingCastKey: string | null;
    previewingCast: StoryCastMember | null;
}

export interface StageCanvasSize {
    width: number;
    height: number;
}

export type StoryStageRenderQuality = "standard" | "high" | "ultra";

export interface StageCanvasSizeBounds {
    minDim?: number;
    maxDim?: number;
}

export interface StageHostAdapter {
    /** Mounts a fresh `<canvas>` inside the host element, replacing any prior transferred canvas. */
    mountCanvas(initialSize?: StageCanvasSize): HTMLCanvasElement | null;
    /** Removes any mounted `<canvas>` from the host element. */
    clearCanvas(): void;
    /** Measures valid non-zero drawing buffer pixel dimensions, or `null` when hidden/0x0/disconnected. */
    measure(quality?: StoryStageRenderQuality): StageCanvasSize | null;
    /** Optionally updates non-destructive `data-*` resolution metadata on the host/canvas. */
    syncCanvasSizeHint?(size: StageCanvasSize, quality: StoryStageRenderQuality): void;
    /** Returns true when the page/tab is hidden or host is disconnected from DOM. */
    isHidden(): boolean;
    /** Subscribes to resize & visibility events; returns an unsubscribe cleanup function. */
    observe(handlers: { onResize: () => void; onVisibilityChange: (hidden: boolean) => void }): () => void;
}

export interface StoryStageConfig {
    library: string | null;
    scriptBase?: string | null;
    coreUrl?: string | null;
}

export interface StoryStageContextData {
    cast: readonly StoryCastMember[];
    models: readonly Live2DModel[] | null;
}

export type StageTimerHandle = unknown;

export interface StoryStageControllerDeps {
    loadStage?: (scriptBase?: string | null) => Promise<Live2DStageStatic>;
    resolveScriptBase?: (scriptBase?: string | null) => string;
    resolveCoreUrl?: (coreUrl?: string | null) => string | undefined;
    setTimeout?: (fn: () => void, ms: number) => StageTimerHandle;
    clearTimeout?: (handle: StageTimerHandle) => void;
    now?: () => number;
    resizeSettleMs?: number;
    recoveryDelaysMs?: readonly number[];
    healthyResetMs?: number;
    minCanvasDimension?: number;
    maxCanvasDimension?: number;
}

interface AppliedActor {
    modelId: string;
    x: number;
    y: number;
    scale: number;
    mirror: boolean;
    order: number;
    alpha: number;
    motion: string | null;
    facial: string | null;
    info: Live2DActorInfo | null;
}

interface MountedSoloActor {
    castKey: string;
    modelId: string;
    info: Live2DActorInfo | null;
}

interface DesiredSceneState {
    state: StoryStageState;
    options: StoryStageApplyOptions;
    structureKey: string;
    visualKey: string;
    seq: number;
}

interface DesiredSoloState {
    cast: StoryCastMember;
    /** Cumulative motion/facial desired for crash-recovery replay. */
    activeClip: StoryClipPreviewRequest;
    /** Immediate delta clip to audition on the mounted solo actor. */
    pendingClip?: StoryClipPreviewRequest;
    seq: number;
    replayNonce: number;
}

interface PendingClipReplay {
    cast: StoryCastMember;
    clip: StoryClipPreviewRequest;
    nonce: number;
}

interface Waiter {
    targetSeq: number;
    resolve: () => void;
}

export const SOLO_PREVIEW_ACTOR_ID = "__story_clip_preview__";
export const DEFAULT_RESIZE_SETTLE_MS = 150;
export const DEFAULT_RECOVERY_DELAYS_MS: readonly number[] = [300, 900, 2200];
export const DEFAULT_HEALTHY_RESET_MS = 10_000;
export const DEFAULT_MIN_CANVAS_DIMENSION = 2;
export const DEFAULT_MAX_CANVAS_DIMENSION = 4096;
export const DEFAULT_STAGE_RENDER_QUALITY: StoryStageRenderQuality = "high";

export const STAGE_RENDER_QUALITY_PRESETS: Record<
    StoryStageRenderQuality,
    { minScale: number; dprMultiplier: number; minInternalWidth: number; maxDim: number }
> = {
    standard: { minScale: 1, dprMultiplier: 1, minInternalWidth: 0, maxDim: 2048 },
    high: { minScale: 2, dprMultiplier: 1.5, minInternalWidth: 1280, maxDim: 2560 },
    ultra: { minScale: 2.5, dprMultiplier: 2, minInternalWidth: 1920, maxDim: 3840 },
};

function classifyFailure(error: unknown): StoryStagePhase {
    if (error instanceof Error && error.message === LIVE2D_STAGE_UNAVAILABLE) {
        return { kind: "unavailable" };
    }
    const detail = error as Live2DStageError | undefined;
    if (detail?.kind === "unsupported") {
        return { kind: "unsupported", missing: detail.missing ?? [] };
    }
    return {
        kind: "failed",
        error: detail?.kind ?? "internal",
        message: error instanceof Error ? error.message : String(error),
        ...(detail?.url ? { url: detail.url } : {}),
    };
}

function isStageDestroyedError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const message = String((error as { message?: unknown }).message ?? "");
    return /stage is destroyed|stage was destroyed/i.test(message);
}

function isMotionBundleNotFoundError(error: unknown, triedMotion: string | null): boolean {
    if (!triedMotion || !error || typeof error !== "object") return false;
    const detail = error as { kind?: unknown; url?: unknown; message?: unknown };
    if (detail.kind !== "not-found") return false;
    const haystack = `${String(detail.url ?? "")} ${String(detail.message ?? "")}`;
    return haystack.includes(triedMotion) || haystack.includes("/live2d/motion/");
}

/** A clip the model has: `name`, else its fallback (null: leave it). */
function pickClip(name: string | null, list: readonly string[] | undefined, fallback: string | null): string | null {
    if (name && list?.includes(name)) return name;
    return fallback;
}

/**
 * Structural stage fingerprint covering background, place, active beat id, and mounted actor
 * identities/transforms (deliberately excluding per-actor motion/facial and dialogue text so
 * clip auditioning/picking and text editing on the same beat do not tear down solo preview).
 */
export function stageStructureKey(target: StoryStageState, castList: readonly StoryCastMember[]): string {
    const modelByKey = new Map(castList.map(member => [member.key, member.modelId]));
    const stepId = target.dialogue?.stepId ?? target.narration?.stepId ?? target.telop?.stepId ?? "";
    const actorsSig = target.actors
        .map(actor => `${actor.cast}:${modelByKey.get(actor.cast) ?? ""}:${actor.x}:${actor.y}:${actor.scale}:${actor.mirror ? 1 : 0}:${actor.z ?? ""}`)
        .join(",");
    return `${target.background ?? ""}|${target.place ?? ""}|${stepId}|${actorsSig}`;
}

/** Full actor visual fingerprint including Z-order, motion/facial, and speaker to deduplicate no-op instant applies. */
function stageVisualKey(target: StoryStageState, castList: readonly StoryCastMember[]): string {
    const modelByKey = new Map(castList.map(member => [member.key, member.modelId]));
    const orderByCast = computeActorRenderOrders(target.actors, target.speaking);
    const actorsSig = target.actors
        .map(actor => `${actor.cast}:${modelByKey.get(actor.cast) ?? ""}:${actor.x}:${actor.y}:${actor.scale}:${actor.mirror ? 1 : 0}:${actor.z ?? ""}:${actor.autoOrder ?? ""}:${orderByCast[actor.cast] ?? ""}:${actor.motion ?? ""}:${actor.facial ?? ""}`)
        .join(",");
    return `${target.speaking ?? ""}|${actorsSig}`;
}

/** Safely invokes `stage.playMotion` catching both synchronous validation throws and async rejections. */
function safePlayMotion(stage: Live2DStage, actorId: string, name: string, loop = false): Promise<boolean> {
    try {
        return stage.playMotion(actorId, name, { loop }).catch(() => false);
    } catch {
        return Promise.resolve(false);
    }
}

/** Safely invokes `stage.setFacial` catching both synchronous validation throws and async rejections. */
function safeSetFacial(stage: Live2DStage, actorId: string, name: string): Promise<boolean> {
    try {
        return stage.setFacial(actorId, name).catch(() => false);
    } catch {
        return Promise.resolve(false);
    }
}

function clampCanvasSize(
    raw: StageCanvasSize | null,
    minDim: number,
    maxDim: number,
): StageCanvasSize | null {
    if (!raw) return null;
    if (!Number.isFinite(raw.width) || !Number.isFinite(raw.height)) return null;
    if (raw.width < 1 || raw.height < 1) return null;
    return {
        width: Math.min(maxDim, Math.max(minDim, Math.round(raw.width))),
        height: Math.min(maxDim, Math.max(minDim, Math.round(raw.height))),
    };
}

/**
 * Computes GPU-safe Supersampling Anti-Aliasing (SSAA) drawing buffer dimensions for the Live2D
 * stage canvas while preserving exact aspect ratio and guarding against degenerate `0x0` sizes:
 * - `"standard"`: native `Math.min(dpr, 2)`, capped at `2048` (lowest GPU load).
 * - `"high"` (default): adaptive SSAA (`Math.max(dpr * 1.5, 2)`) with a minimum internal width
 *   floor of `1280` (scaled proportionally), capped at `2560` so small editor panes render crisp.
 * - `"ultra"`: high SSAA (`Math.max(dpr * 2, 2.5)`) with a minimum internal width floor of `1920`,
 *   capped at `3840`.
 */
export function computeStageCanvasSize(
    cssSize: StageCanvasSize | null,
    dpr = 1,
    quality: StoryStageRenderQuality = DEFAULT_STAGE_RENDER_QUALITY,
    bounds?: StageCanvasSizeBounds,
): StageCanvasSize | null {
    if (!cssSize) return null;
    if (!Number.isFinite(cssSize.width) || !Number.isFinite(cssSize.height)) return null;
    if (cssSize.width < 1 || cssSize.height < 1) return null;

    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const preset = STAGE_RENDER_QUALITY_PRESETS[quality] ?? STAGE_RENDER_QUALITY_PRESETS.high;
    const minDim = bounds?.minDim ?? DEFAULT_MIN_CANVAS_DIMENSION;
    const maxDim = Math.min(bounds?.maxDim ?? DEFAULT_MAX_CANVAS_DIMENSION, preset.maxDim);

    let scale: number;
    if (quality === "standard") {
        scale = Math.min(safeDpr, 2);
    } else {
        scale = Math.max(safeDpr * preset.dprMultiplier, preset.minScale);
        if (preset.minInternalWidth > 0) {
            scale = Math.max(scale, preset.minInternalWidth / cssSize.width);
        }
    }

    let width = cssSize.width * scale;
    let height = cssSize.height * scale;

    const largest = Math.max(width, height);
    if (largest > maxDim) {
        const downscale = maxDim / largest;
        width *= downscale;
        height *= downscale;
    }

    return {
        width: Math.min(maxDim, Math.max(minDim, Math.round(width))),
        height: Math.min(maxDim, Math.max(minDim, Math.round(height))),
    };
}

/** Creates a browser DOM adapter for a host `<div>` with `0x0`/hidden-tab guards, SSAA sizing, and `ResizeObserver`. */
export function createBrowserStageHostAdapter(
    host: HTMLDivElement,
    options?: {
        minCanvasDimension?: number;
        maxCanvasDimension?: number;
        renderQuality?: StoryStageRenderQuality;
    },
): StageHostAdapter {
    const minDim = options?.minCanvasDimension ?? DEFAULT_MIN_CANVAS_DIMENSION;
    const maxDim = options?.maxCanvasDimension ?? DEFAULT_MAX_CANVAS_DIMENSION;
    const defaultQuality = options?.renderQuality ?? DEFAULT_STAGE_RENDER_QUALITY;
    let mountedCanvas: HTMLCanvasElement | null = null;

    return {
        mountCanvas(initialSize?: StageCanvasSize): HTMLCanvasElement | null {
            if (!host.isConnected || typeof document === "undefined") return null;
            const canvas = document.createElement("canvas");
            canvas.className = "absolute inset-0 size-full";
            canvas.style.imageRendering = "auto";
            if (initialSize && initialSize.width >= 1 && initialSize.height >= 1) {
                canvas.width = Math.round(initialSize.width);
                canvas.height = Math.round(initialSize.height);
            }
            host.replaceChildren(canvas);
            mountedCanvas = canvas;
            return canvas;
        },
        clearCanvas(): void {
            mountedCanvas = null;
            host.replaceChildren();
        },
        measure(quality = defaultQuality): StageCanvasSize | null {
            if (!host.isConnected) return null;
            if (typeof document !== "undefined" && document.hidden) return null;
            const rect = host.getBoundingClientRect();
            if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
            if (rect.width < 1 || rect.height < 1) return null;
            const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
            return computeStageCanvasSize(
                { width: rect.width, height: rect.height },
                dpr,
                quality,
                { minDim, maxDim },
            );
        },
        syncCanvasSizeHint(size: StageCanvasSize, quality: StoryStageRenderQuality): void {
            const w = String(Math.round(size.width));
            const h = String(Math.round(size.height));
            host.dataset.renderWidth = w;
            host.dataset.renderHeight = h;
            host.dataset.renderQuality = quality;
            if (mountedCanvas) {
                mountedCanvas.dataset.renderWidth = w;
                mountedCanvas.dataset.renderHeight = h;
                mountedCanvas.dataset.renderQuality = quality;
            }
        },
        isHidden(): boolean {
            if (!host.isConnected) return true;
            return typeof document !== "undefined" && document.hidden;
        },
        observe({ onResize, onVisibilityChange }): () => void {
            let observer: ResizeObserver | null = null;
            if (typeof ResizeObserver !== "undefined") {
                observer = new ResizeObserver(() => onResize());
                observer.observe(host);
            } else if (typeof window !== "undefined") {
                window.addEventListener("resize", onResize);
            }
            const handleVisibility = () => {
                onVisibilityChange(typeof document !== "undefined" ? document.hidden : false);
            };
            if (typeof document !== "undefined") {
                document.addEventListener("visibilitychange", handleVisibility);
            }
            return () => {
                observer?.disconnect();
                if (!observer && typeof window !== "undefined") {
                    window.removeEventListener("resize", onResize);
                }
                if (typeof document !== "undefined") {
                    document.removeEventListener("visibilitychange", handleVisibility);
                }
            };
        },
    };
}

/**
 * Single-flight, crash-recovering Live2D Stage Controller / State Machine.
 *
 * Guarantees:
 * - Strictly serializes all stage mutations (`apply`, `previewClip`, `clearClipPreview`, `resize`,
 *   `setTalking`, `shake`, `finish`, `pause`/`play`, `destroy`) via a single-flight pump loop with
 *   latest-wins coalescing — no concurrent WASM/WebGPU calls or `RefCell` / `MAX_ACTORS` races.
 * - Guards against `0x0` dimensions, disconnected hosts, and background/hidden tabs (pausing rendering
 *   while hidden and deferring boot/resize until valid non-zero dimensions exist).
 * - Automatically recovers from worker crashes / WebGPU device loss with bounded backoff retries
 *   (fresh canvas + worker) and replays the latest desired scene or solo-preview state.
 * - First-class Solo / Audition Preview decoupled from scene actors: works with 0 actors on stage,
 *   from any node (`start`/`choice`/`condition`/`end`), and latches requests made while booting or
 *   waiting for the model list.
 */
export class StoryStageController {
    private readonly loadStage: (scriptBase?: string | null) => Promise<Live2DStageStatic>;
    private readonly resolveScriptBase: (scriptBase?: string | null) => string;
    private readonly resolveCoreUrl: (coreUrl?: string | null) => string | undefined;
    private readonly scheduleTimer: (fn: () => void, ms: number) => StageTimerHandle;
    private readonly cancelTimer: (handle: StageTimerHandle) => void;
    private readonly now: () => number;
    private readonly resizeSettleMs: number;
    private readonly recoveryDelaysMs: readonly number[];
    private readonly healthyResetMs: number;
    private readonly minCanvasDimension: number;
    private readonly maxCanvasDimension: number;

    private disposed = false;
    private config: StoryStageConfig = { library: null };
    private configKey: string | null = null;
    private cast: readonly StoryCastMember[] = [];
    private models: readonly Live2DModel[] | null = null;
    private host: StageHostAdapter | null = null;
    private hostUnsubscribe: (() => void) | null = null;
    private renderQuality: StoryStageRenderQuality = DEFAULT_STAGE_RENDER_QUALITY;

    // Lifecycle & worker state
    private sessionId = 0;
    private bootAbort: AbortController | null = null;
    private stage: Live2DStage | null = null;
    private stageErrorListener: ((event: Event) => void) | null = null;
    private booting = false;
    private deferredBoot = false;
    private lastCanvasSize: StageCanvasSize | null = null;
    private stagePaused = false;
    private supportedScriptBase: string | null = null;

    // Recovery & timers
    private recoveryAttempts = 0;
    private recoveryTimer: StageTimerHandle | null = null;
    private healthyResetTimer: StageTimerHandle | null = null;
    private resizeTimer: StageTimerHandle | null = null;

    // Mounted worker mirror
    private appliedActors = new Map<string, AppliedActor>();
    private mountedSolo: MountedSoloActor | null = null;
    private hiddenForSolo = new Set<string>();
    private infoCache = new Map<string, Live2DActorInfo>();
    private lastRenderedVisualKey: string | null = null;

    // Desired state (survives crash recovery and boot/model loading latency)
    private desiredScene: DesiredSceneState | null = null;
    private appliedSceneSeq = 0;
    private lastStructureKey: string | null = null;
    private desiredSolo: DesiredSoloState | null = null;
    private appliedSoloNonce = 0;
    private pendingClipReplay: PendingClipReplay | null = null;
    private desiredTalking: string | null = null;
    private appliedTalking: string | null = null;
    private pendingResize: StageCanvasSize | null = null;
    private pendingPaused: boolean | null = null;
    private pendingFinish = false;
    private pendingShake: { seconds: number; seq: number } | null = null;
    private commandSeq = 0;
    private completedSeq = 0;

    // Single-flight pump
    private pumping = false;
    private repumpRequested = false;
    private waiters: Waiter[] = [];

    // Observable snapshot
    private phase: StoryStagePhase = { kind: "idle" };
    private modelInfo: Record<string, Live2DActorInfo> = {};
    private problems: Record<string, StoryActorProblem> = {};
    private loadingActors = 0;
    private loadProgress: StoryStageLoadProgress | null = null;
    private loadBatchToken = 0;
    private abortRetryState: { seq: number; count: number } = { seq: 0, count: 0 };
    private snapshot: StoryStageSnapshot;
    private listeners = new Set<() => void>();

    constructor(deps: StoryStageControllerDeps = {}) {
        this.loadStage = deps.loadStage ?? loadLive2DStage;
        this.resolveScriptBase = deps.resolveScriptBase ?? ((base) => live2dViewerScriptBase(base));
        this.resolveCoreUrl = deps.resolveCoreUrl ?? ((override) => (override || live2dCoreUrl()) ?? undefined);
        this.scheduleTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
        this.cancelTimer = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>));
        this.now = deps.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        this.resizeSettleMs = deps.resizeSettleMs ?? DEFAULT_RESIZE_SETTLE_MS;
        this.recoveryDelaysMs = deps.recoveryDelaysMs ?? DEFAULT_RECOVERY_DELAYS_MS;
        this.healthyResetMs = deps.healthyResetMs ?? DEFAULT_HEALTHY_RESET_MS;
        this.minCanvasDimension = deps.minCanvasDimension ?? DEFAULT_MIN_CANVAS_DIMENSION;
        this.maxCanvasDimension = deps.maxCanvasDimension ?? DEFAULT_MAX_CANVAS_DIMENSION;
        this.snapshot = this.buildSnapshot();
    }

    /** Subscribes to snapshot updates (compatible with `useSyncExternalStore`). */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** Returns the current immutable snapshot (compatible with `useSyncExternalStore`). */
    getSnapshot = (): StoryStageSnapshot => this.snapshot;

    /** Attaches or detaches the stage host adapter (e.g. when `<div ref={hostRef} />` mounts/unmounts). */
    setHost(nextHost: StageHostAdapter | null): void {
        if (this.disposed || this.host === nextHost) return;
        this.detachHostObservers();
        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: true, clearRecovery: true });
        this.host = nextHost;

        if (nextHost) {
            this.hostUnsubscribe = nextHost.observe({
                onResize: () => this.handleHostResizeEvent(),
                onVisibilityChange: (hidden) => this.handleVisibilityChange(hidden),
            });
        }

        if (!nextHost || !this.config.library) {
            this.setPhase({ kind: "idle" });
            return;
        }
        this.recoveryAttempts = 0;
        this.startBoot({ isRecovery: false });
    }

    /** Updates stage runtime configuration (`library`, `scriptBase`, `coreUrl`). */
    setConfig(next: StoryStageConfig): void {
        if (this.disposed) return;
        const prevLibrary = this.config.library;
        const nextKey = next.library
            ? `${next.library}|${next.scriptBase ?? ""}|${next.coreUrl ?? ""}`
            : null;
        if (nextKey === this.configKey) return;

        this.config = { ...next };
        this.configKey = nextKey;

        if (prevLibrary !== next.library) {
            this.infoCache.clear();
            this.modelInfo = {};
            this.problems = {};
            this.lastStructureKey = null;
            this.desiredSolo = null;
            this.appliedSoloNonce = 0;
            this.pendingClipReplay = null;
        }

        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: true, clearRecovery: true });
        this.recoveryAttempts = 0;

        if (!nextKey || !this.host) {
            this.setPhase({ kind: "idle" });
            return;
        }
        this.startBoot({ isRecovery: false });
    }

    /** Updates SSAA render quality dynamically via serialized `resize()` without recreating the worker. */
    setRenderQuality(next: StoryStageRenderQuality): void {
        if (this.disposed || this.renderQuality === next) return;
        this.renderQuality = next;
        if (this.stage && !this.host?.isHidden()) {
            const nextSize = this.measureSafeSize();
            if (nextSize) {
                this.pendingResize = nextSize;
                this.schedulePump();
            }
        }
    }

    /** Updates dynamic story cast & model catalog without tearing down the WebGPU stage. */
    setContext(data: StoryStageContextData): void {
        if (this.disposed) return;
        const hadModels = this.models !== null;
        const prevModels = this.models;
        const prevCast = this.cast;
        this.cast = data.cast;
        this.models = data.models;

        // Keep displayed solo cast name fresh if user edits display name in CastPanel.
        if (this.desiredSolo && prevCast !== data.cast) {
            const updated = data.cast.find(member => member.key === this.desiredSolo?.cast.key);
            if (updated && updated.modelId === this.desiredSolo.cast.modelId && updated.name !== this.desiredSolo.cast.name) {
                this.desiredSolo = { ...this.desiredSolo, cast: updated };
                this.emit();
            }
        }

        const modelsArrivedOrChanged = data.models !== null && (!hadModels || data.models !== prevModels);
        if (modelsArrivedOrChanged) {
            // Re-run pending solo preview or scene actors that waited for `models.json`.
            if (this.desiredSolo !== null) {
                this.schedulePump();
            } else if (this.desiredScene !== null) {
                const nextSeq = ++this.commandSeq;
                this.desiredScene = { ...this.desiredScene, seq: nextSeq };
                this.schedulePump();
            }
        }
    }

    /** Brings the stage to `target`; resolves when the latest coalesced stage update settles. */
    apply(target: StoryStageState, options: StoryStageApplyOptions): Promise<void> {
        if (this.disposed) return Promise.resolve();

        const nextStructureKey = stageStructureKey(target, this.cast);
        const nextVisualKey = stageVisualKey(target, this.cast);
        const structureChanged = !options.instant
            || (this.lastStructureKey !== null && this.lastStructureKey !== nextStructureKey);
        this.lastStructureKey = nextStructureKey;

        const seq = ++this.commandSeq;
        this.desiredScene = {
            state: target,
            options,
            structureKey: nextStructureKey,
            visualKey: nextVisualKey,
            seq,
        };

        // Preserve active solo preview across non-structural edits on the same beat/node
        // (e.g. picking a motion/facial clip in ClipPickerField or typing dialogue text).
        if (this.desiredSolo !== null) {
            if (!structureChanged) {
                return Promise.resolve();
            }
            this.desiredSolo = null;
            this.appliedSoloNonce = 0;
            this.emit();
        }

        // Fast-path no-op dedup for instant edit-mode re-renders with identical live actors.
        if (
            options.instant
            && this.stage !== null
            && this.phase.kind === "ready"
            && !this.pumping
            && this.mountedSolo === null
            && this.hiddenForSolo.size === 0
            && this.pendingClipReplay === null
            && this.lastRenderedVisualKey === nextVisualKey
            && !this.hasMissingOrHiddenWantedActors(target)
        ) {
            this.appliedSceneSeq = seq;
            this.completedSeq = Math.max(this.completedSeq, seq);
            return Promise.resolve();
        }

        const promise = this.waitForSeq(seq);
        this.schedulePump();
        return promise;
    }

    /**
     * Auditions a character and/or clip on the Live2D stage:
     * - Works with 0 actors on stage, from any node (`start`/`choice`/`condition`/`end`), or from
     *   `CastPanel` / `StoryEditorBin` / `ClipPickerField` / `NodeInspector`.
     * - Latches requests made while the stage is booting, recovering, or waiting for `models.json`.
     * - Automatically triggers recovery retry if called while the stage is in `"failed"`.
     */
    previewClip(castMember: StoryCastMember, clip?: StoryClipPreviewRequest): Promise<void> {
        if (this.disposed) return Promise.resolve();
        if (this.phase.kind === "unavailable" || this.phase.kind === "unsupported") {
            return Promise.resolve();
        }

        const hasExplicitClip = Boolean(clip?.motion || clip?.facial);
        const seq = ++this.commandSeq;
        const alreadyInSolo = this.desiredSolo !== null;
        const castInScene = Boolean(this.desiredScene?.state.actors.some(a => a.cast === castMember.key));
        const sceneMemberModelId = this.cast.find(item => item.key === castMember.key)?.modelId ?? castMember.modelId;
        const canReplayInPlace = !alreadyInSolo
            && hasExplicitClip
            && castInScene
            && sceneMemberModelId === castMember.modelId
            && !(castMember.key in this.problems);

        if (canReplayInPlace && clip) {
            this.pendingClipReplay = {
                cast: castMember,
                clip: { ...clip },
                nonce: seq,
            };
        } else {
            this.pendingClipReplay = null;
            const prevSolo = this.desiredSolo;
            if (prevSolo && prevSolo.cast.key === castMember.key && prevSolo.cast.modelId === castMember.modelId) {
                const nextActiveClip: StoryClipPreviewRequest = {
                    ...(clip?.motion !== undefined ? { motion: clip.motion } : prevSolo.activeClip.motion ? { motion: prevSolo.activeClip.motion } : {}),
                    ...(clip?.facial !== undefined ? { facial: clip.facial } : prevSolo.activeClip.facial ? { facial: prevSolo.activeClip.facial } : {}),
                };
                this.desiredSolo = {
                    cast: castMember,
                    activeClip: nextActiveClip,
                    pendingClip: clip ? { ...clip } : undefined,
                    seq,
                    replayNonce: seq,
                };
            } else {
                this.desiredSolo = {
                    cast: castMember,
                    activeClip: clip ? { ...clip } : {},
                    pendingClip: clip ? { ...clip } : undefined,
                    seq,
                    replayNonce: seq,
                };
            }
            this.emit();
        }

        if (this.phase.kind === "failed") {
            this.retry();
        } else {
            this.schedulePump();
        }
        return this.waitForSeq(seq);
    }

    /** Exits any active solo preview and cleanly restores the exact scene state (including 0 actors). */
    clearClipPreview(): void {
        if (this.disposed) return;
        const hadSolo = this.desiredSolo !== null || this.mountedSolo !== null || this.hiddenForSolo.size > 0;
        this.desiredSolo = null;
        this.appliedSoloNonce = 0;
        this.pendingClipReplay = null;
        if (!hadSolo) return;

        const seq = ++this.commandSeq;
        if (this.desiredScene) {
            this.desiredScene = {
                ...this.desiredScene,
                options: { instant: true },
                seq,
            };
        }
        this.lastRenderedVisualKey = null;
        this.emit();
        this.schedulePump();
    }

    /** Sets the cast member whose mouth flaps (`null`: nobody). Serialized through the pump. */
    setTalking(speaker: string | null): void {
        if (this.disposed) return;
        if (this.desiredTalking === speaker && this.appliedTalking === speaker) return;
        this.desiredTalking = speaker;
        this.schedulePump();
    }

    /** Shakes the camera for `seconds` through the serialized pump (yields on navigation/finish). */
    shake(seconds: number): Promise<void> {
        if (this.disposed || !Number.isFinite(seconds) || seconds <= 0) return Promise.resolve();
        if (this.phase.kind === "unavailable" || this.phase.kind === "unsupported") return Promise.resolve();
        const seq = ++this.commandSeq;
        this.pendingShake = { seconds, seq };
        const promise = this.waitForSeq(seq);
        this.schedulePump();
        return promise;
    }

    /** Snaps every running tween to its end through the serialized pump. */
    finish(): void {
        if (this.disposed) return;
        this.pendingFinish = true;
        this.pendingShake = null;
        this.schedulePump();
    }

    /** Manually retries starting/recovering the stage, resetting the automatic recovery budget. */
    retry(): void {
        if (this.disposed || !this.host || !this.config.library) return;
        this.recoveryAttempts = 0;
        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: true, clearRecovery: true });
        this.startBoot({ isRecovery: false });
    }

    /**
     * Detaches host, terminates worker, clears canvas & timers, and resolves pending waiters,
     * while remaining reusable if a React StrictMode remount re-attaches a host afterwards.
     */
    detach(): void {
        if (this.disposed) return;
        this.detachHostObservers();
        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: true, clearRecovery: true });
        this.host = null;
        this.pendingShake = null;
        this.resolveAllWaiters();
        this.setPhase({ kind: "idle" });
    }

    /** Permanently disposes the controller, worker, canvas, timers, and observers. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.detachHostObservers();
        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: true, clearRecovery: true });
        this.infoCache.clear();
        this.desiredScene = null;
        this.desiredSolo = null;
        this.pendingClipReplay = null;
        this.pendingShake = null;
        this.resolveAllWaiters();
        this.listeners.clear();
    }

    // ==================== Lifecycle, Boot & Recovery ====================

    private buildSnapshot(): StoryStageSnapshot {
        return {
            phase: this.phase,
            modelInfo: this.modelInfo,
            problems: this.problems,
            loadingActors: this.loadingActors,
            loadProgress: this.loadProgress,
            isSoloPreview: this.desiredSolo !== null,
            previewingCastKey: this.desiredSolo?.cast.key ?? null,
            previewingCast: this.desiredSolo?.cast ?? null,
        };
    }

    private emit(): void {
        if (this.disposed) return;
        this.snapshot = this.buildSnapshot();
        for (const listener of this.listeners) {
            listener();
        }
    }

    private setPhase(next: StoryStagePhase): void {
        this.phase = next;
        this.emit();
        if (this.isTerminalPhase()) {
            this.resolveAllWaiters();
        }
    }

    private isTerminalPhase(): boolean {
        return this.phase.kind === "unavailable"
            || this.phase.kind === "unsupported"
            || this.phase.kind === "failed";
    }

    private clearRecoveryTimer(): void {
        if (this.recoveryTimer !== null) {
            this.cancelTimer(this.recoveryTimer);
            this.recoveryTimer = null;
        }
    }

    private clearHealthyResetTimer(): void {
        if (this.healthyResetTimer !== null) {
            this.cancelTimer(this.healthyResetTimer);
            this.healthyResetTimer = null;
        }
    }

    private clearResizeTimer(): void {
        if (this.resizeTimer !== null) {
            this.cancelTimer(this.resizeTimer);
            this.resizeTimer = null;
        }
    }

    private detachHostObservers(): void {
        this.clearResizeTimer();
        if (this.hostUnsubscribe) {
            this.hostUnsubscribe();
            this.hostUnsubscribe = null;
        }
    }

    private teardownStageInstance(options: {
        clearHostCanvas: boolean;
        abortBoot: boolean;
        clearRecovery: boolean;
    }): void {
        this.sessionId += 1;
        this.booting = false;
        this.deferredBoot = false;
        this.clearHealthyResetTimer();
        this.clearResizeTimer();
        if (options.clearRecovery) {
            this.clearRecoveryTimer();
        }
        if (options.abortBoot && this.bootAbort) {
            this.bootAbort.abort();
            this.bootAbort = null;
        }
        const deadStage = this.stage;
        this.stage = null;
        if (deadStage) {
            if (this.stageErrorListener) {
                try {
                    deadStage.removeEventListener("error", this.stageErrorListener);
                } catch {
                    // Ignore listener removal errors.
                }
                this.stageErrorListener = null;
            }
            try {
                deadStage.destroy();
            } catch {
                // Ignore destroy errors on already-terminated worker.
            }
        }
        if (options.clearHostCanvas) {
            try {
                this.host?.clearCanvas();
            } catch {
                // Ignore DOM cleanup errors.
            }
        }
        this.appliedActors.clear();
        this.mountedSolo = null;
        this.hiddenForSolo.clear();
        this.lastCanvasSize = null;
        this.stagePaused = false;
        this.appliedTalking = null;
        this.lastRenderedVisualKey = null;
        this.pendingResize = null;
        this.pendingPaused = null;
        this.pendingFinish = false;
        this.loadingActors = 0;
        this.loadProgress = null;
        this.loadBatchToken += 1;
        this.abortRetryState = { seq: 0, count: 0 };
    }

    private measureSafeSize(): StageCanvasSize | null {
        if (!this.host || this.host.isHidden()) return null;
        return clampCanvasSize(this.host.measure(this.renderQuality), this.minCanvasDimension, this.maxCanvasDimension);
    }

    private startBoot({ isRecovery }: { isRecovery: boolean }): void {
        if (this.disposed || !this.host || !this.config.library) return;
        this.clearRecoveryTimer();
        this.clearHealthyResetTimer();

        const initialSize = this.measureSafeSize();
        if (!initialSize) {
            // Host is currently 0x0 or tab is hidden — wait for ResizeObserver / visibilitychange
            // rather than initializing WebGPU with a degenerate 1x1 surface!
            this.deferredBoot = true;
            if (!isRecovery) {
                this.setPhase({ kind: "loading" });
            }
            return;
        }

        this.deferredBoot = false;
        this.booting = true;
        const mySession = ++this.sessionId;
        const controller = new AbortController();
        this.bootAbort = controller;
        const { signal } = controller;
        const library = this.config.library;
        const scriptBase = this.config.scriptBase;
        const coreUrl = this.config.coreUrl;

        if (!isRecovery) {
            this.setPhase({ kind: "loading" });
        }

        void (async () => {
            const Stage = await this.loadStage(scriptBase);
            if (signal.aborted || this.disposed || this.sessionId !== mySession) return;

            const resolvedJs = this.resolveScriptBase(scriptBase);
            if (this.supportedScriptBase !== resolvedJs) {
                const { ok, missing } = await Stage.supported();
                if (signal.aborted || this.disposed || this.sessionId !== mySession) return;
                if (!ok) {
                    this.booting = false;
                    this.setPhase({ kind: "unsupported", missing });
                    return;
                }
                this.supportedScriptBase = resolvedJs;
            }

            // Re-measure right before creating canvas/worker in case layout settled during async load.
            const liveSize = this.measureSafeSize();
            if (!liveSize) {
                this.booting = false;
                this.deferredBoot = true;
                return;
            }

            const canvas = this.host?.mountCanvas(liveSize) ?? null;
            if (!canvas || signal.aborted || this.disposed || this.sessionId !== mySession) {
                this.booting = false;
                return;
            }
            this.host?.syncCanvasSizeHint?.(liveSize, this.renderQuality);

            const core = this.resolveCoreUrl(coreUrl);
            const created = await Stage.create({
                canvas,
                js: resolvedJs,
                ...(core ? { core } : {}),
                library,
                width: liveSize.width,
                height: liveSize.height,
                signal,
            });

            if (signal.aborted || this.disposed || this.sessionId !== mySession) {
                try {
                    created.destroy();
                } catch {
                    // Ignore destroy errors.
                }
                return;
            }

            const onStageError = (event: Event) => {
                if (signal.aborted || this.disposed || this.stage !== created) return;
                const detail = (event as CustomEvent).detail as
                    | { message?: string; kind?: Live2DStageErrorKind; url?: string }
                    | undefined;
                const err = Object.assign(
                    new Error(detail?.message ?? "Live2D stage worker crashed"),
                    { kind: detail?.kind ?? "internal", url: detail?.url },
                );
                this.handleRuntimeFailure(created, err);
            };

            created.addEventListener("error", onStageError);
            this.stage = created;
            this.stageErrorListener = onStageError;
            this.lastCanvasSize = liveSize;
            this.stagePaused = false;
            this.booting = false;
            this.bootAbort = null;

            // If tab became hidden while Stage.create was finishing, pause immediately.
            if (this.host?.isHidden()) {
                this.pendingPaused = true;
            } else {
                const afterSize = this.measureSafeSize();
                if (afterSize && (afterSize.width !== liveSize.width || afterSize.height !== liveSize.height)) {
                    this.pendingResize = afterSize;
                }
            }

            // Force replay of latest desired scene/solo state onto the fresh stage instance.
            this.appliedSceneSeq = 0;
            this.appliedSoloNonce = 0;
            this.appliedTalking = null;
            this.lastRenderedVisualKey = null;

            // Reset crash attempt budget once the stage proves stable for `healthyResetMs`.
            if (this.recoveryAttempts > 0 && this.healthyResetMs > 0) {
                this.healthyResetTimer = this.scheduleTimer(() => {
                    this.healthyResetTimer = null;
                    if (!this.disposed && this.stage === created && this.phase.kind === "ready") {
                        this.recoveryAttempts = 0;
                    }
                }, this.healthyResetMs);
            }

            this.setPhase({ kind: "ready" });
            this.schedulePump();
        })().catch((error: unknown) => {
            if (signal.aborted || this.disposed || this.sessionId !== mySession || isLive2DAbortError(error)) {
                return;
            }
            this.booting = false;
            this.bootAbort = null;
            this.handleBootOrRuntimeError(error);
        });
    }

    private handleRuntimeFailure(failedStage: Live2DStage, error: unknown): void {
        if (this.disposed || this.stage !== failedStage) return;
        this.teardownStageInstance({ clearHostCanvas: true, abortBoot: false, clearRecovery: false });
        this.handleBootOrRuntimeError(error);
    }

    private handleBootOrRuntimeError(error: unknown): void {
        if (this.disposed) return;
        const classified = classifyFailure(error);

        // Permanent environment/packaging states: do not spin auto-recovery.
        if (classified.kind === "unavailable" || classified.kind === "unsupported") {
            this.setPhase(classified);
            return;
        }

        const maxAttempts = this.recoveryDelaysMs.length;
        if (this.recoveryAttempts < maxAttempts && this.host && this.config.library) {
            const delayMs = this.recoveryDelaysMs[this.recoveryAttempts];
            const nextAttempt = this.recoveryAttempts + 1;
            this.recoveryAttempts = nextAttempt;
            this.setPhase({
                kind: "recovering",
                attempt: nextAttempt,
                maxAttempts,
                message: classified.kind === "failed" ? classified.message : undefined,
            });
            this.clearRecoveryTimer();
            this.recoveryTimer = this.scheduleTimer(() => {
                this.recoveryTimer = null;
                if (this.disposed || !this.host || !this.config.library) return;
                this.startBoot({ isRecovery: true });
            }, delayMs);
            return;
        }

        this.setPhase(classified);
    }

    private handleHostResizeEvent(): void {
        if (this.disposed) return;
        this.clearResizeTimer();

        // If boot was deferred because the host was 0x0, boot immediately once non-zero!
        if (this.deferredBoot && !this.booting && !this.stage && this.config.library) {
            if (this.measureSafeSize() !== null) {
                this.startBoot({ isRecovery: this.phase.kind === "recovering" });
            }
            return;
        }

        // If host just collapsed to 0x0 while live, pause drawing immediately (no 0x0 resize!).
        const immediateSize = this.measureSafeSize();
        if (immediateSize === null) {
            if (this.stage && !this.stagePaused) {
                this.pendingPaused = true;
                this.schedulePump();
            }
            return;
        }

        this.resizeTimer = this.scheduleTimer(() => {
            this.resizeTimer = null;
            if (this.disposed) return;
            const settled = this.measureSafeSize();
            if (!settled) return;
            if (this.stage) {
                this.pendingResize = settled;
                if (this.stagePaused && !this.host?.isHidden()) {
                    this.pendingPaused = false;
                }
                this.schedulePump();
            }
        }, this.resizeSettleMs);
    }

    private handleVisibilityChange(hidden: boolean): void {
        if (this.disposed) return;
        if (hidden) {
            this.clearResizeTimer();
            if (this.stage) {
                this.pendingPaused = true;
                this.schedulePump();
            }
            return;
        }

        // Returning to foreground
        if (this.deferredBoot && !this.booting && !this.stage && this.config.library) {
            if (this.measureSafeSize() !== null) {
                this.startBoot({ isRecovery: this.phase.kind === "recovering" });
            }
            return;
        }

        if (this.stage) {
            const liveSize = this.measureSafeSize();
            if (liveSize) {
                this.pendingResize = liveSize;
                this.pendingPaused = false;
                this.schedulePump();
            }
        }
    }

    // ==================== Single-Flight Pump & Reconciliation ====================

    private waitForSeq(targetSeq: number): Promise<void> {
        if (this.disposed || this.isTerminalPhase() || this.completedSeq >= targetSeq) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.waiters.push({ targetSeq, resolve });
        });
    }

    private flushReachedWaiters(): void {
        if (this.waiters.length === 0) return;
        const remaining: Waiter[] = [];
        for (const waiter of this.waiters) {
            if (waiter.targetSeq <= this.completedSeq) {
                waiter.resolve();
            } else {
                remaining.push(waiter);
            }
        }
        this.waiters = remaining;
    }

    private resolveAllWaiters(): void {
        if (this.waiters.length === 0) return;
        const pending = this.waiters;
        this.waiters = [];
        for (const waiter of pending) {
            waiter.resolve();
        }
    }

    private schedulePump(): void {
        if (this.disposed) return;
        if (this.pumping) {
            this.repumpRequested = true;
            return;
        }
        void this.drain();
    }

    private needsSoloSync(): boolean {
        if (!this.desiredSolo) return false;
        if (this.appliedSoloNonce !== this.desiredSolo.replayNonce) return true;
        if (
            !this.mountedSolo
            || this.mountedSolo.castKey !== this.desiredSolo.cast.key
            || this.mountedSolo.modelId !== this.desiredSolo.cast.modelId
        ) {
            return true;
        }
        return false;
    }

    private syncAppliedActorsWithStage(activeStage: Live2DStage): void {
        const liveIds = new Set(activeStage.actors);
        for (const id of [...this.appliedActors.keys()]) {
            if (!liveIds.has(id)) {
                this.appliedActors.delete(id);
                this.hiddenForSolo.delete(id);
            }
        }
    }

    private hasMissingOrHiddenWantedActors(target: StoryStageState): boolean {
        const liveIds = this.stage ? new Set(this.stage.actors) : null;
        const castByKey = new Map(this.cast.map(member => [member.key, member]));
        for (const actor of target.actors) {
            const member = castByKey.get(actor.cast);
            if (!member) continue;
            const current = this.appliedActors.get(actor.cast);
            if (!current || current.modelId !== member.modelId || current.alpha !== 1) {
                return true;
            }
            if (liveIds && !liveIds.has(actor.cast)) {
                return true;
            }
        }
        return false;
    }

    private async drain(): Promise<void> {
        if (this.pumping || this.disposed) return;
        this.pumping = true;
        try {
            while (!this.disposed) {
                const activeStage = this.stage;
                if (!activeStage || this.phase.kind !== "ready") {
                    if (this.isTerminalPhase()) {
                        this.resolveAllWaiters();
                    }
                    break;
                }

                let didWork = false;

                // 1. Pause/resume for hidden tabs or collapsed hosts
                if (this.pendingPaused !== null) {
                    const wantPaused = this.pendingPaused;
                    this.pendingPaused = null;
                    if (wantPaused !== this.stagePaused) {
                        didWork = true;
                        try {
                            if (wantPaused) activeStage.pause();
                            else activeStage.play();
                            this.stagePaused = wantPaused;
                        } catch (err) {
                            this.handleRuntimeFailure(activeStage, err);
                            continue;
                        }
                    }
                }

                // 2. Validated non-zero canvas resize
                if (this.pendingResize !== null) {
                    const nextSize = this.pendingResize;
                    this.pendingResize = null;
                    if (
                        !this.lastCanvasSize
                        || this.lastCanvasSize.width !== nextSize.width
                        || this.lastCanvasSize.height !== nextSize.height
                    ) {
                        didWork = true;
                        try {
                            activeStage.resize(nextSize.width, nextSize.height);
                            this.lastCanvasSize = nextSize;
                            this.host?.syncCanvasSizeHint?.(nextSize, this.renderQuality);
                        } catch (err) {
                            this.handleRuntimeFailure(activeStage, err);
                            continue;
                        }
                    }
                }

                // 3. Snap tweens
                if (this.pendingFinish) {
                    this.pendingFinish = false;
                    didWork = true;
                    try {
                        activeStage.finishTweens();
                    } catch (err) {
                        this.handleRuntimeFailure(activeStage, err);
                        continue;
                    }
                }

                // 4. Solo Preview vs Scene State reconciliation
                if (this.desiredSolo !== null) {
                    if (this.models !== null && this.needsSoloSync()) {
                        didWork = true;
                        await this.executeSoloSync(activeStage);
                        if (this.stage !== activeStage || this.disposed) continue;
                    }
                } else {
                    if (this.mountedSolo !== null || this.hiddenForSolo.size > 0) {
                        didWork = true;
                        await this.executeSoloTeardown(activeStage);
                        if (this.stage !== activeStage || this.disposed) continue;
                    }

                    if (this.desiredScene !== null && this.models !== null && this.appliedSceneSeq < this.desiredScene.seq) {
                        didWork = true;
                        await this.executeSceneSync(activeStage);
                        if (this.stage !== activeStage || this.disposed) continue;
                    }

                    if (this.pendingClipReplay !== null && this.models !== null) {
                        const req = this.pendingClipReplay;
                        this.pendingClipReplay = null;
                        didWork = true;
                        await this.executeInPlaceClipReplay(activeStage, req);
                        if (this.stage !== activeStage || this.disposed) continue;
                    }
                }

                // 5. Lip-flap talking state & speaker Z-order tie-break (serialized, only on scene actors)
                if (this.desiredSolo === null && this.appliedTalking !== this.desiredTalking) {
                    didWork = true;
                    await this.executeTalkingSync(activeStage);
                    if (this.stage !== activeStage || this.disposed) continue;
                }

                // 6. Camera shake (yields early if scene/solo/finish/new-shake arrives)
                if (this.pendingShake !== null) {
                    const req = this.pendingShake;
                    this.pendingShake = null;
                    didWork = true;
                    await this.executeShake(activeStage, req);
                    if (this.stage !== activeStage || this.disposed) continue;
                }

                this.flushReachedWaiters();
                if (!didWork) break;
            }
        } finally {
            this.pumping = false;
            if (this.repumpRequested && !this.disposed) {
                this.repumpRequested = false;
                void this.drain();
            }
        }
    }

    private isSceneStepSuperseded(activeStage: Live2DStage, seq: number): boolean {
        return this.disposed
            || this.stage !== activeStage
            || this.desiredSolo !== null
            || (this.desiredScene !== null && this.desiredScene.seq !== seq);
    }

    private async addActorWithMotionFallback(
        activeStage: Live2DStage,
        actorId: string,
        resolved: ResolvedLive2DModelBundles,
        placement: Live2DActorPlacement & { motion?: string; facial?: string },
        onProgress?: (progress: { loaded: number; total: number }) => void,
    ): Promise<Live2DActorInfo> {
        const motionSequence: Array<string | null> = resolved.motion !== null
            ? [resolved.motion, ...resolved.fallbackMotionCandidates, null]
            : [null];
        let lastError: unknown = null;
        for (let i = 0; i < motionSequence.length; i += 1) {
            const motionBundle = motionSequence[i] ?? null;
            const nextPlacement = motionBundle !== null
                ? placement
                : (() => {
                    const stripped = { ...placement };
                    delete stripped.motion;
                    delete stripped.facial;
                    return stripped;
                })();
            if (i > 0) {
                onProgress?.({ loaded: 0, total: 0 });
            }
            try {
                return await activeStage.addActor(
                    actorId,
                    { bundle: resolved.bundle, motion: motionBundle },
                    nextPlacement,
                    onProgress,
                );
            } catch (err) {
                lastError = err;
                if (this.stage !== activeStage || this.disposed || isLive2DAbortError(err) || isStageDestroyedError(err)) {
                    throw err;
                }
                if (i < motionSequence.length - 1 && isMotionBundleNotFoundError(err, motionBundle)) {
                    continue;
                }
                throw err;
            }
        }
        throw lastError ?? new Error(`failed to add actor ${actorId}`);
    }

    private async executeSceneSync(activeStage: Live2DStage): Promise<void> {
        const currentDesired = this.desiredScene;
        const modelList = this.models;
        if (!currentDesired || !modelList) return;

        // Reconcile controller bookkeeping against the live worker actor list before diffing.
        this.syncAppliedActorsWithStage(activeStage);

        const { state: target, options, seq, visualKey } = currentDesired;
        const castByKey = new Map(this.cast.map(member => [member.key, member]));
        const fadeSeconds = options.instant ? 0 : STORY_FADE_SECONDS;
        const orderByCast = computeActorRenderOrders(target.actors, target.speaking);
        const wanted = new Map<string, { actor: StoryActorState; order: number; modelId: string }>();
        target.actors.forEach((actor, index) => {
            const member = castByKey.get(actor.cast);
            if (member) {
                const order = orderByCast[actor.cast] ?? index;
                wanted.set(actor.cast, { actor, order, modelId: member.modelId });
            }
        });

        const nextProblems: Record<string, StoryActorProblem> = {};

        // Step 1: Remove leaving or recast actors FIRST (frees MAX_ACTORS capacity before adding).
        for (const [id, current] of [...this.appliedActors]) {
            const want = wanted.get(id);
            if (want && want.modelId === current.modelId) continue;
            this.appliedActors.delete(id);
            this.hiddenForSolo.delete(id);
            try {
                if (!options.instant && options.fade && !want) {
                    await activeStage.setActor(id, { alpha: 0 }, { duration: fadeSeconds, easing: "out" }).catch(() => false);
                    if (this.stage !== activeStage || this.disposed) return;
                }
                activeStage.removeActor(id);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
            }
            if (this.isSceneStepSuperseded(activeStage, seq)) return;
        }

        // Step 2a: Apply live Z-order updates immediately (duration 0) BEFORE starting any move
        // tween so moving / speaking actors render in front of equal-z stationary neighbors on
        // the very first frame (while strictly honoring author/Agent explicit `z` values).
        for (const [id, { order }] of wanted) {
            const current = this.appliedActors.get(id);
            if (!current || current.order === order) continue;
            try {
                await activeStage.setActor(id, { order }, { duration: 0 }).catch(() => false);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
            }
            if (this.stage !== activeStage || this.disposed) return;
            current.order = order;
            if (this.isSceneStepSuperseded(activeStage, seq)) return;
        }

        // Step 2b: Update transforms, visibility (`alpha`), motions, and facials on already-mounted actors.
        for (const [id, { actor, order }] of wanted) {
            const current = this.appliedActors.get(id);
            if (!current) continue;

            const wasHiddenForSolo = this.hiddenForSolo.delete(id);
            const alphaHidden = current.alpha !== 1;
            const transformChanged = wasHiddenForSolo
                || alphaHidden
                || current.x !== actor.x
                || current.y !== actor.y
                || current.scale !== actor.scale
                || current.mirror !== actor.mirror
                || current.order !== order;

            if (transformChanged) {
                const moving = !wasHiddenForSolo
                    && (current.x !== actor.x || current.y !== actor.y || current.scale !== actor.scale)
                    && !options.instant;
                const revealingWithFade = !wasHiddenForSolo && alphaHidden && !options.instant && Boolean(options.fade);
                const duration = moving
                    ? (options.moveSeconds ?? STORY_FADE_SECONDS)
                    : revealingWithFade
                        ? STORY_FADE_SECONDS
                        : 0;
                try {
                    await activeStage.setActor(id, {
                        x: actor.x,
                        y: actor.y,
                        scale: actor.scale,
                        mirror: actor.mirror,
                        order,
                        alpha: 1,
                    }, {
                        duration,
                        easing: moving ? "in-out" : "in",
                    }).catch(() => false);
                } catch (err) {
                    if (isStageDestroyedError(err)) {
                        this.handleRuntimeFailure(activeStage, err);
                        return;
                    }
                }
                if (this.stage !== activeStage || this.disposed) return;
                current.x = actor.x;
                current.y = actor.y;
                current.scale = actor.scale;
                current.mirror = actor.mirror;
                current.order = order;
                current.alpha = 1;
            }

            const info = current.info;
            const motion = pickClip(actor.motion, info?.motions, info?.defaultMotion ?? null);
            if (motion && motion !== current.motion) {
                await safePlayMotion(activeStage, id, motion, false);
                if (this.stage !== activeStage || this.disposed) return;
                current.motion = motion;
            }

            const facial = pickClip(actor.facial, info?.facials, info?.defaultFacial ?? null);
            if (facial && facial !== current.facial) {
                await safeSetFacial(activeStage, id, facial);
                if (this.stage !== activeStage || this.disposed) return;
                current.facial = facial;
            }

            if (this.isSceneStepSuperseded(activeStage, seq)) return;
        }

        // Step 3: Load ALL arriving actors in parallel as a single tracked batch so multi-actor
        // scenes load ~2x-4x faster and the aggregate progress indicator stays visible until
        // EVERY target actor finishes (without blacking out actors that already rendered).
        const arrivingBatch: Array<{
            id: string;
            actor: StoryActorState;
            order: number;
            modelId: string;
            resolved: ResolvedLive2DModelBundles;
        }> = [];
        for (const [id, { actor, order, modelId }] of wanted) {
            if (this.appliedActors.has(id)) continue;
            const resolved = resolveModelBundlesForStage(modelId, modelList);
            if (!resolved) {
                nextProblems[id] = "modelMissing";
                continue;
            }
            arrivingBatch.push({ id, actor, order, modelId, resolved });
        }

        if (arrivingBatch.length > 0) {
            if (this.isSceneStepSuperseded(activeStage, seq)) return;

            const fadeIn = !options.instant && Boolean(options.fade);
            const batchToken = ++this.loadBatchToken;
            const tracker = new Map<string, { loaded: number; total: number; done: boolean }>();
            for (const item of arrivingBatch) {
                tracker.set(item.id, { loaded: 0, total: 0, done: false });
            }

            const publishBatchProgress = () => {
                if (this.stage !== activeStage || this.disposed || this.loadBatchToken !== batchToken) return;
                let completedActors = 0;
                let loadedFiles = 0;
                let totalFiles = 0;
                let sumFrac = 0;
                let hasDeterminate = false;
                for (const progress of tracker.values()) {
                    loadedFiles += progress.loaded;
                    totalFiles += progress.total;
                    if (progress.done) {
                        completedActors += 1;
                        sumFrac += 1;
                        hasDeterminate = true;
                    } else if (progress.total > 0) {
                        sumFrac += Math.min(0.99, progress.loaded / progress.total);
                        hasDeterminate = true;
                    }
                }
                const totalActors = tracker.size;
                const activeActors = Math.max(0, totalActors - completedActors);
                const percent = hasDeterminate
                    ? Math.min(100, Math.max(0, Math.round((sumFrac / totalActors) * 100)))
                    : null;
                const prev = this.loadProgress;
                const unchanged = this.loadingActors === activeActors
                    && (
                        activeActors === 0
                            ? prev === null
                            : prev !== null
                                && prev.totalActors === totalActors
                                && prev.completedActors === completedActors
                                && prev.activeActors === activeActors
                                && prev.loadedFiles === loadedFiles
                                && prev.totalFiles === totalFiles
                                && prev.percent === percent
                    );
                if (unchanged) return;
                this.loadingActors = activeActors;
                this.loadProgress = activeActors > 0
                    ? { totalActors, completedActors, activeActors, loadedFiles, totalFiles, percent }
                    : null;
                this.emit();
            };

            publishBatchProgress();

            let abortedCount = 0;
            let stageDestroyedError: unknown = null;

            try {
                await Promise.all(arrivingBatch.map(async ({ id, actor, order, modelId, resolved }) => {
                    const cached = this.infoCache.get(modelId);
                    const initialMotion = cached ? pickClip(actor.motion, cached.motions, null) : null;
                    const initialFacial = cached ? pickClip(actor.facial, cached.facials, null) : null;
                    try {
                        const info = await this.addActorWithMotionFallback(
                            activeStage,
                            id,
                            resolved,
                            {
                                x: actor.x,
                                y: actor.y,
                                scale: actor.scale,
                                mirror: actor.mirror,
                                order,
                                alpha: fadeIn ? 0 : 1,
                                ...(initialMotion ? { motion: initialMotion } : {}),
                                ...(initialFacial ? { facial: initialFacial } : {}),
                            },
                            (progress) => {
                                const state = tracker.get(id);
                                if (!state || state.done) return;
                                state.loaded = Math.max(0, progress.loaded);
                                state.total = Math.max(0, progress.total);
                                publishBatchProgress();
                            },
                        );

                        if (this.stage !== activeStage || this.disposed) return;

                        this.infoCache.set(modelId, info);
                        this.modelInfo = { ...this.modelInfo, [modelId]: info };
                        const wantMotion = pickClip(actor.motion, info.motions, info.defaultMotion);
                        const wantFacial = pickClip(actor.facial, info.facials, info.defaultFacial);
                        const entry: AppliedActor = {
                            modelId,
                            x: actor.x,
                            y: actor.y,
                            scale: actor.scale,
                            mirror: actor.mirror,
                            order,
                            alpha: fadeIn ? 0 : 1,
                            motion: initialMotion ?? info.defaultMotion,
                            facial: initialFacial ?? info.defaultFacial,
                            info,
                        };
                        this.appliedActors.set(id, entry);
                        this.emit();

                        // If superseded mid-load, leave entry.alpha === 0 accurately recorded so the
                        // superseding executeSceneSync restores alpha: 1 (or removes the actor) in Step 1/2b.
                        if (!this.isSceneStepSuperseded(activeStage, seq)) {
                            if (!initialMotion && wantMotion && wantMotion !== info.defaultMotion) {
                                await safePlayMotion(activeStage, id, wantMotion, false);
                                if (this.stage !== activeStage || this.disposed) return;
                                entry.motion = wantMotion;
                            }
                            if (!initialFacial && wantFacial && wantFacial !== info.defaultFacial) {
                                await safeSetFacial(activeStage, id, wantFacial);
                                if (this.stage !== activeStage || this.disposed) return;
                                entry.facial = wantFacial;
                            }
                            if (fadeIn && !this.isSceneStepSuperseded(activeStage, seq)) {
                                await activeStage.setActor(id, { alpha: 1 }, { duration: STORY_FADE_SECONDS, easing: "in" }).catch(() => false);
                                if (this.stage !== activeStage || this.disposed) return;
                                entry.alpha = 1;
                            }
                        }
                    } catch (err) {
                        if (this.stage !== activeStage || this.disposed) return;
                        if (isLive2DAbortError(err)) {
                            abortedCount += 1;
                            return;
                        }
                        if (isStageDestroyedError(err)) {
                            stageDestroyedError ??= err;
                            return;
                        }
                        nextProblems[id] = "loadFailed";
                    } finally {
                        const state = tracker.get(id);
                        if (state) {
                            state.done = true;
                            if (state.total > 0) state.loaded = state.total;
                        }
                        publishBatchProgress();
                    }
                }));
            } finally {
                if (this.loadBatchToken === batchToken && !this.disposed) {
                    if (this.loadingActors !== 0 || this.loadProgress !== null) {
                        this.loadingActors = 0;
                        this.loadProgress = null;
                        this.emit();
                    }
                }
            }

            if (stageDestroyedError !== null) {
                this.handleRuntimeFailure(activeStage, stageDestroyedError);
                return;
            }
            if (this.stage !== activeStage || this.disposed) return;
            if (this.isSceneStepSuperseded(activeStage, seq)) return;

            if (abortedCount > 0) {
                const retryCount = this.abortRetryState.seq === seq ? this.abortRetryState.count + 1 : 1;
                this.abortRetryState = { seq, count: retryCount };
                if (retryCount <= 2) {
                    // Self-heal benign one-shot aborts on the next drain cycle without marking failed.
                    return;
                }
                this.problems = nextProblems;
                this.appliedSceneSeq = seq;
                this.lastRenderedVisualKey = null;
                this.completedSeq = Math.max(this.completedSeq, seq);
                this.emit();
                return;
            }
        }

        if (this.stage !== activeStage || this.disposed) return;
        if (this.isSceneStepSuperseded(activeStage, seq)) return;

        if (options.instant) {
            try {
                activeStage.finishTweens();
            } catch (err) {
                this.handleRuntimeFailure(activeStage, err);
                return;
            }
        }

        const hasLoadFailure = Object.values(nextProblems).some(problem => problem === "loadFailed");
        this.problems = nextProblems;
        this.appliedSceneSeq = seq;
        this.lastRenderedVisualKey = hasLoadFailure ? null : visualKey;
        this.completedSeq = Math.max(this.completedSeq, seq);
        this.emit();
    }

    private async executeSoloSync(activeStage: Live2DStage): Promise<void> {
        const req = this.desiredSolo;
        const modelList = this.models;
        if (!req || !modelList) return;

        // Fast path: requested character is already mounted as the active solo preview actor.
        if (
            this.mountedSolo
            && this.mountedSolo.castKey === req.cast.key
            && this.mountedSolo.modelId === req.cast.modelId
        ) {
            const clip = req.pendingClip;
            const info = this.mountedSolo.info;
            if (clip?.motion && (!info || info.motions.includes(clip.motion))) {
                await safePlayMotion(activeStage, SOLO_PREVIEW_ACTOR_ID, clip.motion, false);
                if (this.stage !== activeStage || this.disposed) return;
            }
            if (clip?.facial && (!info || info.facials.includes(clip.facial))) {
                await safeSetFacial(activeStage, SOLO_PREVIEW_ACTOR_ID, clip.facial);
                if (this.stage !== activeStage || this.disposed) return;
            }
            if (this.desiredSolo?.replayNonce === req.replayNonce) {
                this.desiredSolo = { ...this.desiredSolo, pendingClip: undefined };
                this.appliedSoloNonce = req.replayNonce;
                this.completedSeq = Math.max(this.completedSeq, req.seq);
            }
            return;
        }

        const resolved = resolveModelBundlesForStage(req.cast.modelId, modelList);
        if (!resolved) {
            this.problems = { ...this.problems, [req.cast.key]: "modelMissing" };
            if (this.desiredSolo?.replayNonce === req.replayNonce) {
                this.desiredSolo = null;
                this.appliedSoloNonce = 0;
                this.completedSeq = Math.max(this.completedSeq, req.seq);
            }
            this.emit();
            return;
        }

        // Stow any active scene actors at alpha 0 (keeping them cached in worker memory).
        // If we somehow already hit MAX_ACTORS on stage, evict the oldest stowed actor to guarantee room.
        for (const id of [...this.appliedActors.keys()]) {
            if (this.appliedActors.size >= LIVE2D_STAGE_MAX_ACTORS) {
                this.appliedActors.delete(id);
                this.hiddenForSolo.delete(id);
                try {
                    activeStage.removeActor(id);
                } catch {
                    // Ignore removal failure.
                }
                continue;
            }
            if (!this.hiddenForSolo.has(id)) {
                this.hiddenForSolo.add(id);
                try {
                    await activeStage.setActor(id, { alpha: 0 }, { duration: 0 }).catch(() => false);
                } catch (err) {
                    if (isStageDestroyedError(err)) {
                        this.handleRuntimeFailure(activeStage, err);
                        return;
                    }
                }
                if (this.stage !== activeStage || this.disposed) return;
                const stowed = this.appliedActors.get(id);
                if (stowed) stowed.alpha = 0;
            }
        }

        // Remove any previous solo actor cleanly before mounting the new one.
        if (this.mountedSolo) {
            try {
                activeStage.removeActor(SOLO_PREVIEW_ACTOR_ID);
            } catch {
                // Ignore removal failure.
            }
            this.mountedSolo = null;
        }

        // Stop lip-flap on stowed scene actors while auditioning solo.
        if (this.appliedTalking !== null) {
            this.clearTalkingOnStage(activeStage);
        }

        // Check if solo preview was cancelled or switched before starting network load.
        if (
            !this.desiredSolo
            || this.desiredSolo.cast.key !== req.cast.key
            || this.desiredSolo.cast.modelId !== req.cast.modelId
        ) {
            return;
        }

        const cached = this.infoCache.get(req.cast.modelId);
        const wantMotion = req.pendingClip?.motion ?? req.activeClip.motion;
        const wantFacial = req.pendingClip?.facial ?? req.activeClip.facial;
        const initialMotion = cached
            ? (wantMotion && cached.motions.includes(wantMotion) ? wantMotion : (cached.defaultMotion ?? undefined))
            : undefined;
        const initialFacial = cached
            ? (wantFacial && cached.facials.includes(wantFacial) ? wantFacial : (cached.defaultFacial ?? undefined))
            : undefined;

        const batchToken = ++this.loadBatchToken;
        this.loadingActors = 1;
        this.loadProgress = {
            totalActors: 1,
            completedActors: 0,
            activeActors: 1,
            loadedFiles: 0,
            totalFiles: 0,
            percent: null,
        };
        this.emit();
        try {
            const info = await this.addActorWithMotionFallback(
                activeStage,
                SOLO_PREVIEW_ACTOR_ID,
                resolved,
                {
                    x: 0,
                    y: 0,
                    scale: 1.15,
                    alpha: 1,
                    order: 100,
                    ...(initialMotion ? { motion: initialMotion } : {}),
                    ...(initialFacial ? { facial: initialFacial } : {}),
                },
                (progress) => {
                    if (this.stage !== activeStage || this.disposed || this.loadBatchToken !== batchToken) return;
                    const loadedFiles = Math.max(0, progress.loaded);
                    const totalFiles = Math.max(0, progress.total);
                    const percent = totalFiles > 0
                        ? Math.min(100, Math.max(0, Math.round((loadedFiles / totalFiles) * 100)))
                        : null;
                    const prev = this.loadProgress;
                    if (
                        prev !== null
                        && prev.totalActors === 1
                        && prev.loadedFiles === loadedFiles
                        && prev.totalFiles === totalFiles
                        && prev.percent === percent
                    ) {
                        return;
                    }
                    this.loadProgress = {
                        totalActors: 1,
                        completedActors: 0,
                        activeActors: 1,
                        loadedFiles,
                        totalFiles,
                        percent,
                    };
                    this.emit();
                },
            );

            if (this.stage !== activeStage || this.disposed) return;

            this.infoCache.set(req.cast.modelId, info);
            this.modelInfo = { ...this.modelInfo, [req.cast.modelId]: info };
            this.mountedSolo = { castKey: req.cast.key, modelId: req.cast.modelId, info };
            if (req.cast.key in this.problems) {
                const nextProblems = { ...this.problems };
                delete nextProblems[req.cast.key];
                this.problems = nextProblems;
            }
            this.emit();

            // If user exited solo preview or switched to another character while loading, let next drain iteration handle it.
            const latest = this.desiredSolo;
            if (!latest || latest.cast.key !== req.cast.key || latest.cast.modelId !== req.cast.modelId) {
                return;
            }

            const finalMotion = latest.pendingClip?.motion ?? latest.activeClip.motion;
            const finalFacial = latest.pendingClip?.facial ?? latest.activeClip.facial;
            const replayTriggeredDuringLoad = latest.replayNonce !== req.replayNonce;

            if (finalMotion && info.motions.includes(finalMotion) && (finalMotion !== initialMotion || replayTriggeredDuringLoad)) {
                await safePlayMotion(activeStage, SOLO_PREVIEW_ACTOR_ID, finalMotion, false);
                if (this.stage !== activeStage || this.disposed) return;
            }
            if (finalFacial && info.facials.includes(finalFacial) && (finalFacial !== initialFacial || replayTriggeredDuringLoad)) {
                await safeSetFacial(activeStage, SOLO_PREVIEW_ACTOR_ID, finalFacial);
                if (this.stage !== activeStage || this.disposed) return;
            }

            if (this.desiredSolo?.replayNonce === latest.replayNonce) {
                this.desiredSolo = { ...this.desiredSolo, pendingClip: undefined };
                this.appliedSoloNonce = latest.replayNonce;
                this.completedSeq = Math.max(this.completedSeq, latest.seq);
            }
        } catch (err) {
            if (this.stage !== activeStage || this.disposed || isLive2DAbortError(err)) {
                return;
            }
            if (isStageDestroyedError(err)) {
                this.handleRuntimeFailure(activeStage, err);
                return;
            }
            this.problems = { ...this.problems, [req.cast.key]: "loadFailed" };
            if (this.desiredSolo?.replayNonce === req.replayNonce) {
                this.desiredSolo = null;
                this.appliedSoloNonce = 0;
                this.completedSeq = Math.max(this.completedSeq, req.seq);
            }
            this.emit();
        } finally {
            if (this.loadBatchToken === batchToken && !this.disposed) {
                this.loadingActors = 0;
                this.loadProgress = null;
                this.emit();
            }
        }
    }

    private async executeSoloTeardown(activeStage: Live2DStage): Promise<void> {
        if (this.mountedSolo) {
            try {
                activeStage.removeActor(SOLO_PREVIEW_ACTOR_ID);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
            }
            this.mountedSolo = null;
        }
        // If a pending instant scene sync will immediately follow, remove leaving actors directly
        // instead of flashing them back to alpha 1 for one frame before removal.
        const pendingInstantScene = this.desiredScene !== null
            && this.desiredScene.options.instant
            && this.models !== null
            && this.appliedSceneSeq < this.desiredScene.seq
            ? this.desiredScene.state
            : null;
        const nextSceneActorIds = pendingInstantScene
            ? new Set(pendingInstantScene.actors.map(actor => actor.cast))
            : null;
        if (this.hiddenForSolo.size > 0) {
            for (const id of [...this.hiddenForSolo]) {
                this.hiddenForSolo.delete(id);
                if (!this.appliedActors.has(id)) continue;
                if (nextSceneActorIds && !nextSceneActorIds.has(id)) {
                    this.appliedActors.delete(id);
                    try {
                        activeStage.removeActor(id);
                    } catch (err) {
                        if (isStageDestroyedError(err)) {
                            this.handleRuntimeFailure(activeStage, err);
                            return;
                        }
                    }
                    continue;
                }
                try {
                    await activeStage.setActor(id, { alpha: 1 }, { duration: 0 }).catch(() => false);
                } catch (err) {
                    if (isStageDestroyedError(err)) {
                        this.handleRuntimeFailure(activeStage, err);
                        return;
                    }
                }
                if (this.stage !== activeStage || this.disposed) return;
                const restored = this.appliedActors.get(id);
                if (restored) restored.alpha = 1;
            }
        }
        this.appliedTalking = null;
        this.lastRenderedVisualKey = null;
    }

    private async executeInPlaceClipReplay(activeStage: Live2DStage, req: PendingClipReplay): Promise<void> {
        const mounted = this.appliedActors.get(req.cast.key);
        if (!mounted || mounted.modelId !== req.cast.modelId) {
            // Actor is not mounted on stage (e.g. 0 actors on stage) — seamlessly promote to Solo Preview!
            this.desiredSolo = {
                cast: req.cast,
                activeClip: { ...req.clip },
                pendingClip: { ...req.clip },
                seq: req.nonce,
                replayNonce: req.nonce,
            };
            this.emit();
            return;
        }

        if (req.clip.motion) {
            const ok = await safePlayMotion(activeStage, req.cast.key, req.clip.motion, false);
            if (this.stage !== activeStage || this.disposed) return;
            if (ok && (!mounted.info || mounted.info.motions.includes(req.clip.motion))) {
                mounted.motion = req.clip.motion;
            }
        }
        if (req.clip.facial) {
            const ok = await safeSetFacial(activeStage, req.cast.key, req.clip.facial);
            if (this.stage !== activeStage || this.disposed) return;
            if (ok && (!mounted.info || mounted.info.facials.includes(req.clip.facial))) {
                mounted.facial = req.clip.facial;
            }
        }
        this.completedSeq = Math.max(this.completedSeq, req.nonce);
    }

    private clearTalkingOnStage(activeStage: Live2DStage): void {
        for (const id of this.appliedActors.keys()) {
            try {
                activeStage.setTalking(id, false);
            } catch {
                // Ignore if actor already removed.
            }
        }
        this.appliedTalking = null;
    }

    private async executeTalkingSync(activeStage: Live2DStage): Promise<void> {
        const speaker = this.desiredTalking;
        for (const id of this.appliedActors.keys()) {
            try {
                activeStage.setTalking(id, id === speaker);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
            }
        }
        this.appliedTalking = speaker;

        // Re-evaluate Z-order tie-break when live speaker changes (keeping active dialogue speaker
        // elevated even after lip-flap stops while the line remains on screen).
        const scene = this.desiredScene?.state;
        if (!scene || scene.actors.length === 0) return;
        const effectiveSpeaker = speaker ?? scene.speaking;
        const orderByCast = computeActorRenderOrders(scene.actors, effectiveSpeaker);
        for (const actor of scene.actors) {
            const current = this.appliedActors.get(actor.cast);
            const nextOrder = orderByCast[actor.cast];
            if (!current || nextOrder === undefined || current.order === nextOrder) continue;
            try {
                await activeStage.setActor(actor.cast, { order: nextOrder }, { duration: 0 }).catch(() => false);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
            }
            if (this.stage !== activeStage || this.disposed) return;
            current.order = nextOrder;
        }
    }

    private async executeShake(activeStage: Live2DStage, req: { seconds: number; seq: number }): Promise<void> {
        const end = this.now() + req.seconds * 1000;
        let sign = 1;
        while (this.now() < end) {
            if (
                this.disposed
                || this.stage !== activeStage
                || this.pendingFinish
                || this.pendingShake !== null
                || this.desiredSolo !== null
                || (this.desiredScene !== null && this.appliedSceneSeq < this.desiredScene.seq)
            ) {
                break;
            }
            sign = -sign;
            try {
                await activeStage.setCamera({ x: 0.02 * sign, y: 0.012 * -sign }, { duration: 0.05, easing: "linear" }).catch(() => false);
            } catch (err) {
                if (isStageDestroyedError(err)) {
                    this.handleRuntimeFailure(activeStage, err);
                    return;
                }
                break;
            }
        }
        if (!this.disposed && this.stage === activeStage) {
            try {
                await activeStage.setCamera({ x: 0, y: 0 }, { duration: this.pendingFinish ? 0 : 0.05 }).catch(() => false);
            } catch {
                // Ignore camera reset error on shutdown.
            }
        }
        this.completedSeq = Math.max(this.completedSeq, req.seq);
    }
}
