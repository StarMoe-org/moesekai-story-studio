/**
 * Limits of a `moesekai-story/2` graph document and the stage geometry the story maker uses.
 * Shared by the validator, compiler, runtime VM, MoeSekai Script parser, editor inputs, and stage adapter.
 */
import type { StageLayoutMode, StorySlot } from "../types/storyMaker";

export const STORY_LIMITS = {
    nodes: 200,
    edges: 600,
    beatsPerScene: 200,
    totalBeats: 2000,
    cast: 8,
    /** Max unique actors mounted in a single SceneNode's `stageCast` slot (matches the 5 standing slots). */
    stageActors: 5,
    /** Max simultaneous off-speaker reactions attached to a single `TalkBeat`. */
    reactionsPerTalk: 4,
    variables: 32,
    varOpsPerBeat: 16,
    conditionRules: 12,
    title: 80,
    summary: 500,
    author: 40,
    castName: 40,
    varName: 32,
    nodeTitle: 60,
    endSubtitle: 160,
    ruleLabel: 40,
    body: 500,
    telop: 120,
    place: 80,
    speakerName: 40,
    /** Max length of audio asset paths (bare IDs, `<pack>/<file>`, or `mysekai/sound/bgm/...`). */
    audioPath: 128,
    choiceOptions: { min: 2, max: 4 },
    choiceText: 80,
    /** Seconds, for transitions, moves, flashes, shakes and waits. */
    duration: { min: 0, max: 10 },
    /** Start delay bounds in seconds (`stageCast` / `stageAction`). */
    delayMin: 0,
    delayMax: 10,
    volume: { min: 0, max: 1 },
    /** Bounded finite numeric range for low-code counter variables and expressions. */
    varNumberMin: -1_000_000,
    varNumberMax: 1_000_000,
    /** Character explicit horizontal stage coordinate bounds (`-1.2..1.2`, fractions of half a 16:9 frame width). */
    xMin: -1.2,
    xMax: 1.2,
    /** Character scale multiplier (`stageCast` / `stageAction`, default 1.0). */
    scaleMin: 0.5,
    scaleMax: 2.0,
    /** Character vertical offset in stage world units (`stageCast` / `stageAction`, default 0). */
    yMin: -0.6,
    yMax: 0.6,
    /** Explicit Live2D Z-layer integer bounds (`stageCast` / `stageAction`, higher renders in front, default 0). */
    zMin: -99,
    zMax: 99,
    /** Voice trim bounds in seconds (`0 <= start <= 600`, `0 < end <= 600`, `end - start >= 0.05`). */
    voiceTrimMax: 600,
    voiceTrimMinSpan: 0.05,
    /** Translation provenance `modelHint` and `note` max characters. */
    translationModelHint: 80,
    translationNote: 240,
    /** Flow graph node canvas coordinate bounds. */
    coordMin: -20000,
    coordMax: 20000,
    /** Alias retained for layout helpers. */
    flowCoordMin: -20000,
    flowCoordMax: 20000,
    /** Maximum IR instructions executed in a single runtime advance before declaring a zero-wait loop. */
    maxRuntimeSteps: 4000,
} as const;

/** Ids of documents, nodes, edges, beats, cast members, variables, choice options and condition rules. */
export const STORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** Beat ids accepted in custom voice manifests (`moesekai-story-voice/1`), matching backend storyaudio bounds. */
export const STORY_VOICE_MANIFEST_BEAT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Game asset names (single-segment ids: backgrounds, voice scenario / voice ids). */
export const STORY_ASSET_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * Audio asset paths (BGM and SE): bare ids (`bgm00020`), pack paths (`se_pack00001_b/se00001_b`,
 * `bgm00016_01/bgm00016_01_1`), or full asset paths (`mysekai/sound/bgm/music0001/music0001`).
 */
export const STORY_AUDIO_PATH_PATTERN = /^(?=.{1,128}$)[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,4}$/;
/** Model ids under `<region>/live2d/model/` on the canonical asset site. */
export const STORY_MODEL_PATTERN = /^[a-z0-9_]{1,64}$/;
/** Motion and facial names of a model's motion bundle (internal spaces allowed for real game clips like `face_ worry_01`). */
export const STORY_MOTION_PATTERN = /^[A-Za-z0-9_.-](?:[A-Za-z0-9_. -]{0,62}[A-Za-z0-9_.-])?$/;

/** Template placeholder syntax `{{varId}}` or `{{varName}}` supported inside story text. */
export const STORY_TEMPLATE_VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Base stage x of each slot, as a fraction of half the width of a 16:9 frame (`-1` left edge,
 * `+1` right edge; `sse-core/src/consts.rs`: `SIDE_X_DEFAULT = 350 / 960 ≈ 0.365` for 2-character
 * framing, `SIDE_X_THREE = 550 / 960 ≈ 0.573` for 3-character framing).
 */
export const SLOT_X: Record<StorySlot, number> = {
    farLeft: -0.75,
    left: -0.365,
    center: 0,
    right: 0.365,
    farRight: 0.75,
};

/** Safe horizontal stage geometry constants (fractions of half a 16:9 frame width). */
export const STAGE_SAFE_BOUNDS = {
    /** Approximate head/shoulder safe half-width of one Live2D character at `scale = 1.0`. */
    actorHalfWidth: 0.195,
    /** Snug cheek-to-cheek / shoulder-touching gap when `allowOverlap` (huddle) is explicitly declared. */
    huddleGap: 0.22,
    /** Outer horizontal center bound by actor count (`n <= 3`, `n === 4`, `n >= 5`). */
    maxEdge3: 0.75,
    maxEdge4: 0.75,
    maxEdge5: 0.8,
    /** Canonical 3-actor trio (`left`, `center`, `right`): `SIDE_X_THREE = 550 / 960`. */
    trioX: [-0.573, 0, 0.573] as const,
    /** Canonical 4-actor quartet (`farLeft`, `left`, `right`, `farRight`): uniform 0.50 spacing. */
    quartetX: [-0.75, -0.25, 0.25, 0.75] as const,
    /** Canonical 5-actor quintet (all 5 slots): uniform 0.40 spacing. */
    quintetX: [-0.8, -0.4, 0, 0.4, 0.8] as const,
} as const;

const SLOT_ORDER: Record<StorySlot, number> = {
    farLeft: 0,
    left: 1,
    center: 2,
    right: 3,
    farRight: 4,
};

function roundStageX(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Clamps an explicit actor horizontal world coordinate to `[STORY_LIMITS.xMin, STORY_LIMITS.xMax]` (`-1.2..1.2`). */
export function clampActorX(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const clamped = Math.min(STORY_LIMITS.xMax, Math.max(STORY_LIMITS.xMin, value));
    return roundStageX(clamped);
}

/** Clamps a choreography start delay (seconds) to `[STORY_LIMITS.delayMin, STORY_LIMITS.delayMax]` (`0..10`). */
export function clampDelay(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const clamped = Math.min(STORY_LIMITS.delayMax, Math.max(STORY_LIMITS.delayMin, value));
    return roundStageX(clamped);
}

export interface LayoutStageActorsOptions {
    /** `"initial"` (default, canonical scene entry framing) or `"incremental"` (preserves stationary actors). */
    mode?: "initial" | "incremental";
    /** `"auto"` (default anti-overlap) or `"fixed"` (exact authored/current coordinates, zero displacement). */
    layoutMode?: StageLayoutMode;
    /** Cast keys that did not enter or move in the current wave and should remain stationary whenever possible. */
    stationaryKeys?: ReadonlySet<string>;
}

type LayoutActorInput = {
    cast?: string;
    slot: StorySlot;
    x: number;
    scale?: number;
    allowOverlap?: boolean;
    explicitX?: number;
    lockX?: boolean;
};

function isPinnedActor(actor: LayoutActorInput): boolean {
    return (actor.explicitX !== undefined && Number.isFinite(actor.explicitX)) || actor.lockX === true;
}

function getPinnedActorX(actor: LayoutActorInput): number {
    if (actor.explicitX !== undefined && Number.isFinite(actor.explicitX)) {
        return roundStageX(actor.explicitX);
    }
    if (Number.isFinite(actor.x)) {
        return roundStageX(actor.x);
    }
    return SLOT_X[actor.slot];
}

function computePairGap(a: LayoutActorInput, b: LayoutActorInput, n: number): number {
    const baseNormal = n >= 5 ? 0.4 : 0.48;
    const pairScale = ((a.scale ?? 1) + (b.scale ?? 1)) / 2;
    const pairHuddle = Boolean(a.allowOverlap && b.allowOverlap);
    return (pairHuddle ? STAGE_SAFE_BOUNDS.huddleGap : baseNormal) * pairScale;
}

/**
 * Solves a contiguous movable run `[s..e]` via weighted 1D PAV subject to `[leftBound, rightBound]`
 * and pairwise minimum separations `internalGaps`. When `strictFeasible` is true, returns `null`
 * if `[leftBound, rightBound]` cannot accommodate `internalGaps` without shrinking.
 */
function solveWeightedRun(
    anchors: readonly number[],
    weights: readonly number[],
    internalGaps: readonly number[],
    leftBound: number,
    rightBound: number,
    strictFeasible: boolean,
): number[] | null {
    const m = anchors.length;
    if (m === 0) return [];

    const rawPrefix: number[] = [0];
    for (let i = 0; i < internalGaps.length; i += 1) {
        rawPrefix.push(rawPrefix[i] + internalGaps[i]);
    }
    const totalGap = rawPrefix[m - 1];
    const available = rightBound - leftBound;

    if (strictFeasible) {
        if (leftBound + totalGap > rightBound + 1e-9) {
            return null;
        }
    }

    let prefix: number[];
    let uMin: number;
    let uMax: number;
    if (available <= 1e-9) {
        // Hard bounds met or crossed: collapse to bounded midpoint (strictFeasible already returned null above).
        const mid = roundStageX((leftBound + rightBound) / 2);
        return new Array<number>(m).fill(mid);
    } else if (totalGap > available) {
        const gapScale = available / totalGap;
        prefix = rawPrefix.map(g => g * gapScale);
        uMin = leftBound;
        uMax = leftBound;
    } else {
        prefix = rawPrefix;
        uMin = leftBound;
        uMax = rightBound - totalGap;
    }

    const blocks: Array<{ start: number; count: number; wSum: number; wzSum: number }> = [];
    for (let i = 0; i < m; i += 1) {
        const z = anchors[i] - prefix[i];
        const w = weights[i];
        blocks.push({ start: i, count: 1, wSum: w, wzSum: w * z });
        while (blocks.length >= 2) {
            const last = blocks[blocks.length - 1];
            const prev = blocks[blocks.length - 2];
            if (prev.wzSum / prev.wSum <= last.wzSum / last.wSum) break;
            prev.count += last.count;
            prev.wSum += last.wSum;
            prev.wzSum += last.wzSum;
            blocks.pop();
        }
    }

    const out = new Array<number>(m);
    for (const block of blocks) {
        const u = Math.min(uMax, Math.max(uMin, block.wzSum / block.wSum));
        for (let k = 0; k < block.count; k += 1) {
            const idx = block.start + k;
            out[idx] = roundStageX(u + prefix[idx]);
        }
    }
    return out;
}

/**
 * Solves 1D positions for `ordered` actors where `fixedFlags[i]` marks hard immovable actors at
 * `fixedXs[i]`, and movable actors have anchor `anchors[i]` and weight `weights[i]`.
 */
function solveWithFixedObstacles(
    ordered: readonly { actor: LayoutActorInput; index: number }[],
    fixedFlags: readonly boolean[],
    fixedXs: readonly number[],
    anchors: readonly number[],
    weights: readonly number[],
    maxEdge: number,
    strictFeasible: boolean,
): number[] | null {
    const n = ordered.length;
    const xs = new Array<number>(n);

    let i = 0;
    while (i < n) {
        if (fixedFlags[i]) {
            xs[i] = roundStageX(fixedXs[i]);
            i += 1;
            continue;
        }
        const s = i;
        while (i < n && !fixedFlags[i]) i += 1;
        const e = i - 1;

        const leftBound = s === 0
            ? -maxEdge
            : Math.max(-maxEdge, fixedXs[s - 1] + computePairGap(ordered[s - 1].actor, ordered[s].actor, n));
        const rightBound = e === n - 1
            ? maxEdge
            : Math.min(maxEdge, fixedXs[e + 1] - computePairGap(ordered[e].actor, ordered[e + 1].actor, n));

        const runAnchors: number[] = [];
        const runWeights: number[] = [];
        const runGaps: number[] = [];
        for (let k = s; k <= e; k += 1) {
            runAnchors.push(anchors[k]);
            runWeights.push(weights[k]);
            if (k < e) {
                runGaps.push(computePairGap(ordered[k].actor, ordered[k + 1].actor, n));
            }
        }

        const solved = solveWeightedRun(runAnchors, runWeights, runGaps, leftBound, rightBound, strictFeasible);
        if (!solved) return null;
        for (let k = s; k <= e; k += 1) {
            xs[k] = solved[k - s];
        }
    }

    return xs;
}

/**
 * Computes balanced stage X coordinates for mounted actors while preserving left-to-right semantic
 * slot order, array draw order, authentic Project SEKAI framing, explicit `x` / `lockX` pinning,
 * `layoutMode: "fixed"`, incremental stationary-actor preservation, and explicit `allowOverlap`
 * (close huddle) declarations:
 * - `layoutMode === "fixed"`: uses exact `explicitX ?? x ?? SLOT_X[slot]` with zero displacement.
 * - Pinned actors (`explicitX !== undefined || lockX === true`): NEVER displaced by auto-layout.
 * - `mode === "initial"` (default): authentic `±0.365`, `±0.573/0`, `±0.75/±0.25`, `±0.80/±0.40/0`
 *   when unpinned, or constrained projection around pinned actors when partially pinned.
 * - `mode === "incremental"`: keeps stationary actors (`stationaryKeys`) at their exact current `x`
 *   in Phase 1 (zero-displacement placement around stationary + pinned obstacles), falling back to
 *   Phase 2 weighted constrained projection (pinned hard-fixed, stationary weight `8`, moving weight `1`)
 *   only when free stage space is genuinely exhausted.
 */
export function layoutStageActors<T extends LayoutActorInput>(
    actors: readonly T[],
    options?: LayoutStageActorsOptions,
): T[] {
    const n = actors.length;
    if (n === 0) return [];

    if (options?.layoutMode === "fixed") {
        return actors.map((actor) => {
            const nextX = actor.explicitX !== undefined && Number.isFinite(actor.explicitX)
                ? roundStageX(actor.explicitX)
                : Number.isFinite(actor.x)
                    ? roundStageX(actor.x)
                    : SLOT_X[actor.slot];
            return actor.x === nextX ? actor : { ...actor, x: nextX };
        });
    }

    const mode = options?.mode ?? "initial";
    const stationaryKeys = options?.stationaryKeys;

    if (n === 1) {
        const single = actors[0];
        let nextX: number;
        if (isPinnedActor(single)) {
            nextX = getPinnedActorX(single);
        } else if (
            mode === "incremental"
            && single.cast !== undefined
            && stationaryKeys?.has(single.cast)
            && Number.isFinite(single.x)
        ) {
            nextX = roundStageX(single.x);
        } else {
            nextX = SLOT_X[single.slot];
        }
        return single.x === nextX ? [...actors] : [{ ...single, x: nextX }];
    }

    const maxEdge = n >= 5
        ? STAGE_SAFE_BOUNDS.maxEdge5
        : n === 4
            ? STAGE_SAFE_BOUNDS.maxEdge4
            : STAGE_SAFE_BOUNDS.maxEdge3;

    const anyPinned = actors.some(isPinnedActor);

    // Classic initial scene-entry framing when no actors are pinned (100% legacy-preserving).
    if (mode === "initial" && !anyPinned) {
        const ordered = actors
            .map((actor, index) => ({ actor, index, slotRank: SLOT_ORDER[actor.slot] }))
            .sort((a, b) => a.slotRank - b.slotRank || a.index - b.index);

        const hasExplicitOverlap = ordered.some(item => Boolean(item.actor.allowOverlap));
        const slotsKey = ordered.map(item => item.actor.slot).join(",");
        let xs: number[] | null = null;

        if (!hasExplicitOverlap) {
            if (slotsKey === "left,center,right") {
                xs = [...STAGE_SAFE_BOUNDS.trioX];
            } else if (slotsKey === "farLeft,left,right,farRight") {
                xs = [...STAGE_SAFE_BOUNDS.quartetX];
            } else if (slotsKey === "farLeft,left,center,right,farRight") {
                xs = [...STAGE_SAFE_BOUNDS.quintetX];
            }
        }

        if (!xs) {
            const avgScale = ordered.reduce((sum, item) => sum + (item.actor.scale ?? 1), 0) / n;
            const baseNormalGap = (n >= 5 ? 0.4 : 0.48) * Math.min(1.15, Math.max(0.85, avgScale));
            const baseHuddleGap = STAGE_SAFE_BOUNDS.huddleGap * Math.min(1.15, Math.max(0.85, avgScale));

            const rawPairGaps: number[] = [];
            for (let i = 0; i < n - 1; i += 1) {
                const pairHuddle = Boolean(ordered[i].actor.allowOverlap && ordered[i + 1].actor.allowOverlap);
                rawPairGaps.push(pairHuddle ? baseHuddleGap : baseNormalGap);
            }
            const totalGap = rawPairGaps.reduce((sum, g) => sum + g, 0);
            const gapScale = totalGap > 2 * maxEdge ? (2 * maxEdge) / totalGap : 1;
            const prefixGap: number[] = [0];
            for (let i = 0; i < rawPairGaps.length; i += 1) {
                prefixGap.push(prefixGap[i] + rawPairGaps[i] * gapScale);
            }

            const uMin = -maxEdge;
            const uMax = maxEdge - prefixGap[n - 1];

            const blocks: Array<{ start: number; count: number; sum: number }> = [];
            for (let i = 0; i < n; i += 1) {
                const z = SLOT_X[ordered[i].actor.slot] - prefixGap[i];
                blocks.push({ start: i, count: 1, sum: z });
                while (blocks.length >= 2) {
                    const last = blocks[blocks.length - 1];
                    const prev = blocks[blocks.length - 2];
                    if (prev.sum / prev.count <= last.sum / last.count) break;
                    prev.count += last.count;
                    prev.sum += last.sum;
                    blocks.pop();
                }
            }
            xs = new Array<number>(n);
            for (const block of blocks) {
                const u = Math.min(uMax, Math.max(uMin, block.sum / block.count));
                for (let k = 0; k < block.count; k += 1) {
                    const idx = block.start + k;
                    xs[idx] = roundStageX(u + prefixGap[idx]);
                }
            }
        }

        const xByOrigIndex = new Array<number>(n);
        for (let i = 0; i < n; i += 1) {
            xByOrigIndex[ordered[i].index] = xs[i];
        }
        return actors.map((actor, index) => {
            const nextX = xByOrigIndex[index];
            return actor.x === nextX ? actor : { ...actor, x: nextX };
        });
    }

    // Pin-aware & incremental layout: sort by effective geometric anchor X (preserving pinned/stationary positions).
    const decorated = actors.map((actor, index) => {
        const pinned = isPinnedActor(actor);
        const stationary = !pinned
            && mode === "incremental"
            && actor.cast !== undefined
            && Boolean(stationaryKeys?.has(actor.cast))
            && Number.isFinite(actor.x);
        const anchorX = pinned
            ? getPinnedActorX(actor)
            : stationary
                ? roundStageX(actor.x)
                : SLOT_X[actor.slot];
        return {
            actor,
            index,
            pinned,
            stationary,
            anchorX,
            slotRank: SLOT_ORDER[actor.slot],
        };
    });

    decorated.sort((a, b) => a.anchorX - b.anchorX || a.slotRank - b.slotRank || a.index - b.index);

    const anchors = decorated.map(item => item.anchorX);
    const fixedXs = decorated.map(item => item.anchorX);
    let xs: number[] | null = null;

    if (mode === "incremental") {
        // Phase 1: Zero-displacement placement treating all stationary + pinned actors as hard immovable obstacles.
        const phase1Fixed = decorated.map(item => item.pinned || item.stationary);
        const phase1Weights = decorated.map(() => 1);
        xs = solveWithFixedObstacles(decorated, phase1Fixed, fixedXs, anchors, phase1Weights, maxEdge, true);
    }

    if (!xs) {
        // Phase 2 (or initial mode with pinned actors): weighted 1D constrained projection.
        // Pinned actors are hard-fixed; stationary actors have high anchor weight (8); dynamic actors have weight (1).
        const phase2Fixed = decorated.map(item => item.pinned);
        const phase2Weights = decorated.map(item => (item.stationary ? 8 : 1));
        xs = solveWithFixedObstacles(decorated, phase2Fixed, fixedXs, anchors, phase2Weights, maxEdge, false)!;
    }

    const xByOrigIndex = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
        xByOrigIndex[decorated[i].index] = xs[i];
    }
    return actors.map((actor, index) => {
        const nextX = xByOrigIndex[index];
        return actor.x === nextX ? actor : { ...actor, x: nextX };
    });
}

export interface StageSlotCollision {
    slot: StorySlot;
    actors: string[];
}

export interface StageOverlapWarning {
    leftActor: string;
    rightActor: string;
    gap: number;
    minGap: number;
}

export interface StageOverlapAudit {
    duplicateSlots: StageSlotCollision[];
    overlaps: StageOverlapWarning[];
}

/**
 * Checks a set of mounted actors for undeclared overlaps:
 * 1. `duplicateSlots`: two or more non-explicit-`x` actors sharing the same semantic `slot` unless
 *    all sharing actors explicitly declared `allowOverlap: true`.
 * 2. `overlaps`: adjacent actors whose actual resolved distance `|x_b - x_a|` is smaller than their
 *    combined safe visual envelope (`actorHalfWidth * (scale_a + scale_b)`) when neither actor
 *    explicitly declared `allowOverlap: true`.
 *
 * Audits actual finite `actor.x` directly without overwriting explicit or incremental positions;
 * only falls back to `layoutStageActors` if any actor lacks a finite `x`.
 */
export function detectStageActorOverlaps(
    actors: readonly {
        cast: string;
        slot: StorySlot;
        x?: number;
        scale?: number;
        allowOverlap?: boolean;
        explicitX?: number;
        lockX?: boolean;
    }[],
): StageOverlapAudit {
    const duplicateSlots: StageSlotCollision[] = [];
    const overlaps: StageOverlapWarning[] = [];
    if (actors.length < 2) return { duplicateSlots, overlaps };

    const bySlot = new Map<StorySlot, Array<{ cast: string; allowOverlap: boolean }>>();
    for (const actor of actors) {
        if (actor.explicitX !== undefined && Number.isFinite(actor.explicitX)) continue;
        const entry = { cast: actor.cast, allowOverlap: Boolean(actor.allowOverlap) };
        const list = bySlot.get(actor.slot);
        if (list) list.push(entry);
        else bySlot.set(actor.slot, [entry]);
    }
    for (const [slot, list] of bySlot) {
        if (list.length >= 2 && !list.every(item => item.allowOverlap)) {
            duplicateSlots.push({ slot, actors: list.map(item => item.cast) });
        }
    }

    const allHaveFiniteX = actors.every(
        actor => (actor.explicitX !== undefined && Number.isFinite(actor.explicitX))
            || (typeof actor.x === "number" && Number.isFinite(actor.x)),
    );
    const resolved = allHaveFiniteX
        ? actors.map(actor => ({
            ...actor,
            x: actor.explicitX !== undefined && Number.isFinite(actor.explicitX)
                ? roundStageX(actor.explicitX)
                : roundStageX(actor.x as number),
        }))
        : layoutStageActors(
            actors.map(actor => ({
                ...actor,
                x: typeof actor.x === "number" && Number.isFinite(actor.x) ? actor.x : SLOT_X[actor.slot],
            })),
        );

    const byX = [...resolved].sort((a, b) => a.x - b.x || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
    for (let i = 0; i < byX.length - 1; i += 1) {
        const left = byX[i];
        const right = byX[i + 1];
        if (left.allowOverlap || right.allowOverlap) continue;
        const leftScale = left.scale ?? 1;
        const rightScale = right.scale ?? 1;
        const gap = roundStageX(right.x - left.x);
        const minGap = roundStageX(STAGE_SAFE_BOUNDS.actorHalfWidth * (leftScale + rightScale));
        if (gap + 1e-4 < minGap) {
            overlaps.push({
                leftActor: left.cast,
                rightActor: right.cast,
                gap,
                minGap,
            });
        }
    }

    return { duplicateSlots, overlaps };
}

/** Seconds of default fades of transitions, stage enters and exits. */
export const STORY_FADE_SECONDS = 0.4;

/** Verified Miyamasuzaka Girls Academy daytime classroom scene background (available on all 5 servers). */
export const DEFAULT_STORY_BACKGROUND = "bg_a000401";

/** Verified everyday classroom BGM (paired with bg_a000401 in Leo/need unit story Ep. 9; HTTP 200 on all 5 servers). */
export const DEFAULT_STORY_BGM = "bgm00020";

/** Verified scenario sound effect in pack `se_pack00001_b` (HTTP 200 on all 5 servers). */
export const DEFAULT_STORY_SE = "se_pack00001_b/se00001_b";
