/**
 * Deterministic Runtime VM and Editor Stage Evaluator for `moesekai-story/2`.
 *
 * Pure, zero-DOM execution engine:
 * - `initVariables`, `interpolateStoryText`, `evaluateCondition`, `applyVarOps`
 * - `createInitialRuntime(program, startNodeId?)`: runs from Start or from any Scene (reconstructing
 *   inherited background, BGM, place, stage cast, and variables along a valid graph path)
 * - `advanceRuntime(program, frame, choiceOptionId?)`: deterministic single-step transition to the
 *   next blocking beat (`talk` / `narration` / `telop`), `choice`, `end`, `disconnected`, or `loop`
 * - `evaluateStageAt(doc, nodeId, beatId?)`: instant stage + variable snapshot for the editor monitor
 */
import {
    getStageActionItems,
    type BackgroundSlot,
    type BgmSlot,
    type ConditionExpr,
    type PlaceSlot,
    type SceneBeat,
    type SceneNode,
    type StageActionItem,
    type StageCastSlot,
    type StageLayoutMode,
    type StoryActorState,
    type StoryCastMember,
    type StoryDocument,
    type StoryEdge,
    type StoryStageActorState,
    type StoryStageState,
    type StoryVarValues,
    type TransitionSlot,
    type VarOp,
} from "../types/storyMaker";
import { findLeadingTelopEndIndex, type CompiledStoryProgram, type StoryIR } from "./compiler";
import { getNodeOutPorts } from "./document";
import { SLOT_X, STORY_LIMITS, STORY_TEMPLATE_VAR_PATTERN, clampActorX, layoutStageActors } from "./limits";

export type { StoryActorState, StoryStageActorState, StoryStageState, StoryVarValues };

export const INITIAL_STAGE_STATE: StoryStageState = {
    background: null,
    place: null,
    actors: [],
    bgm: { name: null, volume: 1 },
    dialogue: null,
    narration: null,
    telop: null,
    screen: { color: "black", covered: false },
    speaking: null,
};

export interface StoryPendingChoiceOption {
    id: string;
    text: string;
    available: boolean;
    effects?: VarOp[];
    targetPc: number | null;
}

export interface StoryPendingChoice {
    nodeId: string;
    options: StoryPendingChoiceOption[];
}

export interface StoryEndingResult {
    nodeId: string;
    title: string;
    subtitle?: string;
}

export type StoryRuntimeStoppedReason = "blocking" | "choice" | "end" | "disconnected" | "loop";

export interface StoryRuntimeFrame {
    pc: number;
    nodeId: string | null;
    beatId: string | null;
    stage: StoryStageState;
    variables: StoryVarValues;
    pendingChoice: StoryPendingChoice | null;
    ending: StoryEndingResult | null;
    stoppedReason: StoryRuntimeStoppedReason;
    executedInstructions: StoryIR[];
    visitedNodeIds: string[];
    visitedEdgeIds: string[];
}

// ==================== Variables & Template Interpolation ====================

function clampVarNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(STORY_LIMITS.varNumberMax, Math.max(STORY_LIMITS.varNumberMin, value));
}

/** Initializes the runtime variable table from `doc.variables`. */
export function initVariables(doc: StoryDocument): StoryVarValues {
    const values: StoryVarValues = {};
    for (const variable of doc.variables) {
        values[variable.id] = variable.initial;
    }
    return values;
}

/** Replaces `{{varId}}` and `{{varName}}` placeholders using current variable values. */
export function interpolateStoryText(text: string, doc: StoryDocument, vars: StoryVarValues): string {
    if (!text || !text.includes("{{")) return text;
    const idByToken = new Map<string, string>();
    for (const variable of doc.variables) {
        idByToken.set(variable.id, variable.id);
        const trimmedName = variable.name.trim();
        if (trimmedName && !idByToken.has(trimmedName)) {
            idByToken.set(trimmedName, variable.id);
        }
    }
    STORY_TEMPLATE_VAR_PATTERN.lastIndex = 0;
    return text.replace(STORY_TEMPLATE_VAR_PATTERN, (full, rawToken: string) => {
        const token = rawToken.trim();
        const varId = idByToken.get(token);
        if (!varId) return full;
        const value = vars[varId];
        return value === undefined ? full : String(value);
    });
}

/** Evaluates a single `ConditionExpr` against `vars`. */
export function evaluateCondition(expr: ConditionExpr, vars: StoryVarValues): boolean {
    const actual = vars[expr.varId];
    if (actual === undefined) return false;
    if (typeof actual === "boolean" || typeof expr.value === "boolean") {
        if (typeof actual !== "boolean" || typeof expr.value !== "boolean") return false;
        if (expr.op === "==") return actual === expr.value;
        if (expr.op === "!=") return actual !== expr.value;
        return false;
    }
    if (typeof actual !== "number" || typeof expr.value !== "number") return false;
    switch (expr.op) {
        case "==": return actual === expr.value;
        case "!=": return actual !== expr.value;
        case ">": return actual > expr.value;
        case ">=": return actual >= expr.value;
        case "<": return actual < expr.value;
        case "<=": return actual <= expr.value;
    }
}

/** Purely applies a sequence of `VarOp` mutations to `vars`. */
export function applyVarOps(ops: readonly VarOp[], vars: StoryVarValues, doc: StoryDocument): StoryVarValues {
    if (ops.length === 0) return vars;
    const varById = new Map(doc.variables.map(v => [v.id, v]));
    const next: StoryVarValues = { ...vars };
    for (const op of ops) {
        const decl = varById.get(op.varId);
        if (!decl) continue;
        if (decl.type === "number") {
            const current = typeof next[op.varId] === "number" ? (next[op.varId] as number) : decl.initial;
            if (op.op === "set" && typeof op.value === "number") {
                next[op.varId] = clampVarNumber(op.value);
            } else if (op.op === "add" && typeof op.value === "number") {
                next[op.varId] = clampVarNumber(current + op.value);
            } else if (op.op === "sub" && typeof op.value === "number") {
                next[op.varId] = clampVarNumber(current - op.value);
            }
        } else {
            const current = typeof next[op.varId] === "boolean" ? (next[op.varId] as boolean) : decl.initial;
            if (op.op === "toggle") {
                next[op.varId] = !current;
            } else if (op.op === "set" && typeof op.value === "boolean") {
                next[op.varId] = op.value;
            }
        }
    }
    return next;
}

// ==================== Stage Z-Layer Ordering ====================

/**
 * Returns the next monotonic `autoOrder` value strictly above all other actors on stage.
 * Reuses `targetCastKey`'s current `autoOrder` if it is already strictly higher than every other
 * actor's `autoOrder` (preventing unnecessary object churn across consecutive lines by the same actor).
 */
function nextActorAutoOrder(actors: readonly StoryStageActorState[], targetCastKey?: string): number {
    let maxOther = 0;
    let current = 0;
    for (const actor of actors) {
        const order = typeof actor.autoOrder === "number" && Number.isFinite(actor.autoOrder) ? actor.autoOrder : 0;
        if (targetCastKey && actor.cast === targetCastKey) {
            current = order;
        } else if (order > maxOther) {
            maxOther = order;
        }
    }
    return current > maxOther ? current : maxOther + 1;
}

/**
 * Computes deterministic Live2D draw orders (`0 .. actors.length - 1`, higher renders in front)
 * according to the 4-tier Z-layer hierarchy:
 * 1. Explicit `z` (`actor.z ?? 0`) — higher `z` ALWAYS renders in front; negative `z` stays behind
 *    default `0`; author/Agent explicit `z` is never overridden by movement or speech.
 * 2. Automatic move/enter/speak recency (`actor.autoOrder ?? 0`) — higher `autoOrder` renders in front
 *    when `z` ties, preventing moving or newly entering actors from sliding behind stationary ones.
 * 3. Active speaker (`speakingKey`) — when `z` and `autoOrder` tie, the active speaker renders in
 *    front of silent neighbors so close/huddled speakers are never occluded.
 * 4. Original cast array order fallback (`index`) — deterministic tie-breaker matching legacy draw order.
 */
export function computeActorRenderOrders(
    actors: readonly Pick<StoryStageActorState, "cast" | "z" | "autoOrder">[],
    speakingKey?: string | null,
): Record<string, number> {
    const ranked = actors.map((actor, index) => ({
        cast: actor.cast,
        z: typeof actor.z === "number" && Number.isFinite(actor.z) ? actor.z : 0,
        autoOrder: typeof actor.autoOrder === "number" && Number.isFinite(actor.autoOrder) ? actor.autoOrder : 0,
        speaking: speakingKey && actor.cast === speakingKey ? 1 : 0,
        index,
    }));

    ranked.sort((a, b) =>
        a.z - b.z
        || a.autoOrder - b.autoOrder
        || a.speaking - b.speaking
        || a.index - b.index,
    );

    const orders: Record<string, number> = {};
    for (let i = 0; i < ranked.length; i += 1) {
        orders[ranked[i].cast] = i;
    }
    return orders;
}

// ==================== Stage Reducers ====================

function buildActorsFromStageCast(
    stageCast: Extract<StageCastSlot, { mode: "set" }>,
): StoryStageActorState[] {
    const layoutMode: StageLayoutMode = stageCast.layoutMode ?? "auto";
    return layoutStageActors(
        stageCast.actors.map((actor) => {
            const explicitX = actor.x !== undefined && Number.isFinite(actor.x)
                ? clampActorX(actor.x)
                : undefined;
            return {
                cast: actor.castKey,
                slot: actor.slot,
                x: explicitX ?? SLOT_X[actor.slot],
                ...(explicitX !== undefined ? { explicitX } : {}),
                ...(actor.lockX ? { lockX: true } : {}),
                y: actor.y ?? 0,
                scale: actor.scale ?? 1,
                mirror: actor.mirror ?? false,
                motion: actor.motion ?? null,
                facial: actor.facial ?? null,
                ...(actor.z !== undefined ? { z: actor.z } : {}),
                ...(actor.allowOverlap ? { allowOverlap: true } : {}),
            };
        }),
        { mode: "initial", layoutMode },
    );
}

function applyDeferredStageCast(
    stage: StoryStageState,
    stageCast: Extract<StageCastSlot, { mode: "set" }>,
): StoryStageState {
    const next: StoryStageState = {
        ...stage,
        actors: buildActorsFromStageCast(stageCast),
        telop: null,
        speaking: null,
    };
    if (stageCast.layoutMode !== undefined) {
        next.layoutMode = stageCast.layoutMode;
    } else {
        delete next.layoutMode;
    }
    return next;
}

/**
 * Atomically applies a simultaneous wave of `StageActionItem`s (from a single beat's
 * `getStageActionItems(beat)` and/or consecutive `parallel`-linked `stageAction` beats):
 * 1. Snapshots `stationaryKeys` from `stage.actors` BEFORE the wave.
 * 2. Processes all `exit` items (removing from actors & `stationaryKeys`).
 * 3. Processes all `pose` items in place (never modifies `x` or triggers layout).
 * 4. Processes all `move` / `enter` items (removing from `stationaryKeys` and updating transform/pose fields).
 * 5. Calls `layoutStageActors(..., { mode: "incremental", layoutMode, stationaryKeys })` ONCE iff
 *    the wave contained at least one `enter` or `move`.
 * 6. If the wave had ONLY `exit` and/or `pose`, skips `layoutStageActors` so surviving actors keep exact `x`.
 */
export function applyStageActionWave(
    stage: StoryStageState,
    items: readonly StageActionItem[],
    _castMap?: ReadonlyMap<string, StoryCastMember> | Readonly<Record<string, StoryCastMember>>,
): StoryStageState {
    const base: StoryStageState = { ...stage, telop: null, speaking: null };
    if (items.length === 0) return base;

    const stationaryKeys = new Set<string>(stage.actors.map(a => a.cast));
    let actors: StoryStageActorState[] = [...stage.actors];
    let hasEnterOrMove = false;

    // 1. Exits
    const exitingKeys = new Set<string>();
    for (const item of items) {
        if (item.action === "exit") {
            exitingKeys.add(item.castKey);
            stationaryKeys.delete(item.castKey);
        }
    }
    if (exitingKeys.size > 0) {
        actors = actors.filter(a => !exitingKeys.has(a.cast));
    }

    // 2. Poses in place (never modifies x or triggers layout)
    for (const item of items) {
        if (item.action !== "pose") continue;
        actors = actors.map((actor) => {
            if (actor.cast !== item.castKey) return actor;
            const nextZ = item.z !== undefined ? item.z : actor.z;
            const nextMirror = item.mirror !== undefined ? item.mirror : actor.mirror;
            const nextLockX = item.lockX !== undefined ? item.lockX : actor.lockX;
            const updated: StoryStageActorState = {
                ...actor,
                mirror: nextMirror,
                motion: item.motion ?? actor.motion,
                facial: item.facial ?? actor.facial,
                ...(nextZ !== undefined ? { z: nextZ } : {}),
            };
            if (nextLockX) updated.lockX = true;
            else delete updated.lockX;
            return updated;
        });
    }

    // 3. Moves & Enters
    for (const item of items) {
        if (item.action === "enter") {
            hasEnterOrMove = true;
            stationaryKeys.delete(item.castKey);
            const slot = item.slot ?? "center";
            const remaining = actors.filter(a => a.cast !== item.castKey);
            const autoOrder = nextActorAutoOrder(remaining);
            const explicitX = item.x !== undefined && Number.isFinite(item.x)
                ? clampActorX(item.x)
                : undefined;
            const entered: StoryStageActorState = {
                cast: item.castKey,
                slot,
                x: explicitX ?? SLOT_X[slot],
                ...(explicitX !== undefined ? { explicitX } : {}),
                ...(item.lockX ? { lockX: true } : {}),
                y: item.y ?? 0,
                scale: item.scale ?? 1,
                mirror: item.mirror ?? false,
                motion: item.motion ?? null,
                facial: item.facial ?? null,
                ...(item.z !== undefined ? { z: item.z } : {}),
                autoOrder,
                ...(item.allowOverlap ? { allowOverlap: true } : {}),
            };
            actors = [...remaining, entered];
        } else if (item.action === "move") {
            hasEnterOrMove = true;
            stationaryKeys.delete(item.castKey);
            const autoOrder = nextActorAutoOrder(actors, item.castKey);
            actors = actors.map((actor) => {
                if (actor.cast !== item.castKey) return actor;
                const nextSlot = item.slot ?? actor.slot;
                const nextOverlap = item.allowOverlap ?? actor.allowOverlap;
                const nextZ = item.z !== undefined ? item.z : actor.z;
                const nextMirror = item.mirror !== undefined ? item.mirror : actor.mirror;
                const hasExplicitX = item.x !== undefined && Number.isFinite(item.x);
                const nextExplicitX = hasExplicitX
                    ? clampActorX(item.x!)
                    : item.slot !== undefined
                        ? undefined
                        : actor.explicitX;
                const nextX = nextExplicitX !== undefined
                    ? nextExplicitX
                    : item.slot !== undefined
                        ? SLOT_X[nextSlot]
                        : actor.x;
                const nextLockX = item.lockX !== undefined ? item.lockX : actor.lockX;
                const moved: StoryStageActorState = {
                    ...actor,
                    slot: nextSlot,
                    x: nextX,
                    scale: item.scale ?? actor.scale,
                    y: item.y ?? actor.y,
                    mirror: nextMirror,
                    motion: item.motion ?? actor.motion,
                    facial: item.facial ?? actor.facial,
                    ...(nextZ !== undefined ? { z: nextZ } : {}),
                    autoOrder,
                };
                if (nextExplicitX !== undefined) moved.explicitX = nextExplicitX;
                else delete moved.explicitX;
                if (nextLockX) moved.lockX = true;
                else delete moved.lockX;
                if (nextOverlap) moved.allowOverlap = true;
                else delete moved.allowOverlap;
                return moved;
            });
        }
    }

    if (hasEnterOrMove) {
        actors = layoutStageActors(actors, {
            mode: "incremental",
            layoutMode: stage.layoutMode ?? "auto",
            stationaryKeys,
        });
    }

    return {
        ...base,
        actors,
    };
}

function applySceneSlots(
    stage: StoryStageState,
    slots: {
        background: BackgroundSlot;
        bgm: BgmSlot;
        place: PlaceSlot;
        transition: TransitionSlot;
        stageCast: StageCastSlot;
    },
    doc: StoryDocument,
    vars: StoryVarValues,
    options?: { deferStageCast?: boolean },
): StoryStageState {
    const background = slots.background.mode === "inherit"
        ? stage.background
        : slots.background.mode === "clear"
            ? null
            : slots.background.asset;

    const bgm = slots.bgm.mode === "inherit"
        ? stage.bgm
        : slots.bgm.mode === "stop"
            ? { name: null, volume: stage.bgm.volume }
            : { name: slots.bgm.name, volume: slots.bgm.volume };

    const place = slots.place.mode === "inherit"
        ? stage.place
        : slots.place.mode === "hide"
            ? null
            : (interpolateStoryText(slots.place.text, doc, vars).trim() || null);

    const nextLayoutMode: StageLayoutMode | undefined = slots.stageCast.mode === "inherit"
        ? stage.layoutMode
        : slots.stageCast.mode === "clear"
            ? undefined
            : slots.stageCast.layoutMode;

    const actors: StoryStageActorState[] = slots.stageCast.mode === "inherit"
        ? stage.actors
        : slots.stageCast.mode === "clear"
            ? []
            : options?.deferStageCast
                ? []
                : buildActorsFromStageCast(slots.stageCast);

    const screenColor = slots.transition.kind === "fadeWhite" ? "white" : "black";

    return {
        background,
        place,
        actors,
        ...(nextLayoutMode !== undefined ? { layoutMode: nextLayoutMode } : {}),
        bgm,
        dialogue: null,
        narration: null,
        telop: null,
        screen: { color: screenColor, covered: false },
        speaking: null,
    };
}

function applySceneBeat(
    stage: StoryStageState,
    vars: StoryVarValues,
    beat: SceneBeat,
    doc: StoryDocument,
): { stage: StoryStageState; variables: StoryVarValues } {
    const base: StoryStageState = { ...stage, telop: null, speaking: null };

    switch (beat.kind) {
        case "talk": {
            const member = beat.speakerKey ? doc.cast.find(item => item.key === beat.speakerKey) : undefined;
            const speaker = beat.speakerName
                ? interpolateStoryText(beat.speakerName, doc, vars)
                : (member?.name ?? "");
            const body = interpolateStoryText(beat.body, doc, vars);
            const onStage = Boolean(beat.speakerKey && stage.actors.some(a => a.cast === beat.speakerKey));

            const reactionByKey = new Map<string, { motion?: string; facial?: string }>();
            if (beat.speakerKey && (beat.motion || beat.facial)) {
                reactionByKey.set(beat.speakerKey, { motion: beat.motion, facial: beat.facial });
            }
            for (const reaction of beat.reactions ?? []) {
                if (reaction.motion || reaction.facial) {
                    const prev = reactionByKey.get(reaction.castKey);
                    reactionByKey.set(reaction.castKey, {
                        motion: reaction.motion ?? prev?.motion,
                        facial: reaction.facial ?? prev?.facial,
                    });
                }
            }

            const speakerAutoOrder = onStage && beat.speakerKey
                ? nextActorAutoOrder(stage.actors, beat.speakerKey)
                : undefined;
            const actors = reactionByKey.size === 0 && !onStage
                ? stage.actors
                : stage.actors.map((actor) => {
                    const pose = reactionByKey.get(actor.cast);
                    const bumpSpeaker = onStage && actor.cast === beat.speakerKey && speakerAutoOrder !== undefined && actor.autoOrder !== speakerAutoOrder;
                    if (!pose && !bumpSpeaker) return actor;
                    return {
                        ...actor,
                        ...(pose ? { motion: pose.motion ?? actor.motion, facial: pose.facial ?? actor.facial } : {}),
                        ...(bumpSpeaker ? { autoOrder: speakerAutoOrder } : {}),
                    };
                });

            return {
                stage: {
                    ...base,
                    actors,
                    narration: null,
                    dialogue: {
                        stepId: beat.id,
                        cast: beat.speakerKey ?? null,
                        speaker,
                        body,
                    },
                    speaking: onStage ? (beat.speakerKey ?? null) : null,
                },
                variables: vars,
            };
        }
        case "narration":
            return {
                stage: {
                    ...base,
                    dialogue: null,
                    narration: {
                        stepId: beat.id,
                        body: interpolateStoryText(beat.body, doc, vars),
                    },
                },
                variables: vars,
            };
        case "telop":
            return {
                stage: {
                    ...base,
                    dialogue: null,
                    narration: null,
                    telop: {
                        stepId: beat.id,
                        body: interpolateStoryText(beat.text, doc, vars),
                        ...(beat.actorVisibility !== undefined ? { actorVisibility: beat.actorVisibility } : {}),
                        ...(beat.position !== undefined ? { position: beat.position } : {}),
                    },
                },
                variables: vars,
            };
        case "stageAction":
            return {
                stage: applyStageActionWave(stage, getStageActionItems(beat)),
                variables: vars,
            };
        case "cue":
            return { stage: base, variables: vars };
        case "varOp":
            return { stage: base, variables: applyVarOps(beat.ops, vars, doc) };
    }
}

/**
 * Executes `node.beats[0..endIndex]` (inclusive, or all beats when `endIndex` is omitted),
 * coalescing consecutive `parallel`-linked `stageAction` beats into atomic waves and applying
 * deferred `afterTelop` `stageCast` immediately after the last leading `telop`.
 */
function applySceneBeatsRange(
    initialStage: StoryStageState,
    initialVars: StoryVarValues,
    node: SceneNode,
    doc: StoryDocument,
    options: { endIndex?: number; deferStageCast: boolean },
): { stage: StoryStageState; variables: StoryVarValues } {
    let stage = initialStage;
    let variables = initialVars;
    const deferIdx = options.deferStageCast && node.stageCast.mode === "set"
        ? findLeadingTelopEndIndex(node.beats)
        : -1;
    const limit = options.endIndex === undefined
        ? node.beats.length - 1
        : Math.min(options.endIndex, node.beats.length - 1);

    let i = 0;
    while (i <= limit) {
        const beat = node.beats[i];
        if (beat.kind === "stageAction") {
            const waveItems: StageActionItem[] = [...getStageActionItems(beat)];
            let endWave = i;
            while (
                endWave < limit
                && node.beats[endWave].kind === "stageAction"
                && (node.beats[endWave] as Extract<SceneBeat, { kind: "stageAction" }>).parallel === true
                && node.beats[endWave + 1]?.kind === "stageAction"
            ) {
                endWave += 1;
                waveItems.push(...getStageActionItems(node.beats[endWave] as Extract<SceneBeat, { kind: "stageAction" }>));
            }
            stage = applyStageActionWave(stage, waveItems);
            i = endWave + 1;
            continue;
        }

        const res = applySceneBeat(stage, variables, beat, doc);
        stage = res.stage;
        variables = res.variables;

        if (deferIdx >= 0 && i === deferIdx && node.stageCast.mode === "set") {
            // Apply deferred cast when continuing past the leading telop (either full replay or target beat is after deferIdx).
            if (options.endIndex === undefined || options.endIndex > deferIdx) {
                stage = applyDeferredStageCast(stage, node.stageCast);
            }
        }
        i += 1;
    }

    return { stage, variables };
}

// ==================== Graph Path Reconstruction (BFS) ====================

interface PathStep {
    nodeId: string;
    viaEdge?: StoryEdge;
}

/**
 * Finds a shortest valid directed path from `doc.startNodeId` to `targetNodeId` in deterministic
 * `doc.edges` order so inherited scene state and upstream variable mutations never fluctuate even
 * on multi-in-degree merge nodes.
 * Returns `null` when `targetNodeId` is unreachable from `startNodeId`.
 */
function findGraphPathFromStart(doc: StoryDocument, targetNodeId: string): PathStep[] | null {
    if (!doc.nodes[doc.startNodeId] || !doc.nodes[targetNodeId]) return null;
    if (targetNodeId === doc.startNodeId) return [{ nodeId: doc.startNodeId }];

    const seenPort = new Set<string>();
    const outgoingByNode = new Map<string, StoryEdge[]>();
    for (const edge of doc.edges) {
        const fromNode = doc.nodes[edge.fromNodeId];
        const toNode = doc.nodes[edge.toNodeId];
        if (!fromNode || fromNode.type === "end" || !toNode) continue;
        if (toNode.id === doc.startNodeId || toNode.type === "start") continue;
        if (!getNodeOutPorts(fromNode).includes(edge.fromPortId)) continue;
        const portKey = `${edge.fromNodeId}\0${edge.fromPortId}`;
        if (seenPort.has(portKey)) continue;
        seenPort.add(portKey);
        let list = outgoingByNode.get(edge.fromNodeId);
        if (!list) {
            list = [];
            outgoingByNode.set(edge.fromNodeId, list);
        }
        list.push(edge);
    }

    const visited = new Set<string>([doc.startNodeId]);
    const parent = new Map<string, { prev: string; edge: StoryEdge }>();
    const queue = [doc.startNodeId];

    for (let head = 0; head < queue.length; head++) {
        const currentId = queue[head];
        for (const edge of outgoingByNode.get(currentId) ?? []) {
            if (visited.has(edge.toNodeId)) continue;
            visited.add(edge.toNodeId);
            parent.set(edge.toNodeId, { prev: currentId, edge });
            if (edge.toNodeId === targetNodeId) {
                const steps: PathStep[] = [];
                let cursor: string | undefined = targetNodeId;
                while (cursor !== undefined) {
                    const link = parent.get(cursor);
                    steps.push({ nodeId: cursor, ...(link ? { viaEdge: link.edge } : {}) });
                    cursor = link?.prev;
                }
                steps.reverse();
                return steps;
            }
            queue.push(edge.toNodeId);
        }
    }

    return null;
}

/** Replays ancestor nodes strictly BEFORE the final target node along `path`. */
function replayAncestors(
    doc: StoryDocument,
    path: readonly PathStep[],
): { stage: StoryStageState; variables: StoryVarValues; visitedNodeIds: string[]; visitedEdgeIds: string[] } {
    let stage = INITIAL_STAGE_STATE;
    let variables = initVariables(doc);
    const visitedNodeIds: string[] = [];
    const visitedEdgeIds: string[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    const recordNode = (id: string) => {
        if (!seenNodes.has(id)) {
            seenNodes.add(id);
            visitedNodeIds.push(id);
        }
    };
    const recordEdge = (id: string | undefined) => {
        if (id && !seenEdges.has(id)) {
            seenEdges.add(id);
            visitedEdgeIds.push(id);
        }
    };

    for (let i = 0; i < path.length - 1; i++) {
        const step = path[i];
        const nextStep = path[i + 1];
        const node = doc.nodes[step.nodeId];
        if (!node) continue;
        recordNode(node.id);
        if (node.type === "scene") {
            const deferStageCast =
                node.stageCast.mode === "set"
                && node.stageCast.enterTiming === "afterTelop"
                && findLeadingTelopEndIndex(node.beats) >= 0;
            stage = applySceneSlots(stage, node, doc, variables, { deferStageCast });
            const res = applySceneBeatsRange(stage, variables, node, doc, { deferStageCast });
            stage = res.stage;
            variables = res.variables;
        } else if (node.type === "choice" && nextStep.viaEdge) {
            const option = node.options.find(opt => opt.id === nextStep.viaEdge!.fromPortId);
            if (option?.effects && option.effects.length > 0) {
                variables = applyVarOps(option.effects, variables, doc);
            }
        }
        recordEdge(nextStep.viaEdge?.id);
    }

    return { stage, variables, visitedNodeIds, visitedEdgeIds };
}

// ==================== Deterministic VM Execution ====================

function runFromPc(
    program: CompiledStoryProgram,
    startPc: number,
    initialStage: StoryStageState,
    initialVars: StoryVarValues,
    priorVisitedNodes: readonly string[],
    priorVisitedEdges: readonly string[],
    prefixInstructions: readonly StoryIR[] = [],
): StoryRuntimeFrame {
    const { doc, instructions } = program;
    let pc = startPc;
    let stage = initialStage;
    let variables = initialVars;
    const executedInstructions: StoryIR[] = [...prefixInstructions];
    const visitedNodeIds = [...priorVisitedNodes];
    const visitedNodeSet = new Set(visitedNodeIds);
    const visitedEdgeIds = [...priorVisitedEdges];
    const visitedEdgeSet = new Set(visitedEdgeIds);

    const recordNode = (nodeId: string) => {
        if (!visitedNodeSet.has(nodeId)) {
            visitedNodeSet.add(nodeId);
            visitedNodeIds.push(nodeId);
        }
    };
    const recordEdge = (edgeId: string | undefined) => {
        if (edgeId && !visitedEdgeSet.has(edgeId)) {
            visitedEdgeSet.add(edgeId);
            visitedEdgeIds.push(edgeId);
        }
    };

    const stepLimit = Math.min(STORY_LIMITS.maxRuntimeSteps, Math.max(256, instructions.length * 8));
    let steps = 0;

    while (pc >= 0 && pc < instructions.length) {
        if (steps >= stepLimit) {
            const inst = instructions[pc];
            return {
                pc,
                nodeId: inst?.nodeId ?? null,
                beatId: null,
                stage,
                variables,
                pendingChoice: null,
                ending: null,
                stoppedReason: "loop",
                executedInstructions,
                visitedNodeIds,
                visitedEdgeIds,
            };
        }
        steps += 1;

        const inst = instructions[pc];
        recordNode(inst.nodeId);
        executedInstructions.push(inst);

        switch (inst.op) {
            case "enterScene":
                stage = applySceneSlots(stage, inst, doc, variables, {
                    deferStageCast: inst.deferStageCast,
                });
                pc += 1;
                break;

            case "applyStageCast":
                stage = applyDeferredStageCast(stage, inst.stageCast);
                pc += 1;
                break;

            case "talk": {
                const res = applySceneBeat(stage, variables, inst.beat, doc);
                stage = res.stage;
                variables = res.variables;
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: inst.beatId,
                    stage,
                    variables,
                    pendingChoice: null,
                    ending: null,
                    stoppedReason: "blocking",
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
            }
            case "narration": {
                const res = applySceneBeat(stage, variables, inst.beat, doc);
                stage = res.stage;
                variables = res.variables;
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: inst.beatId,
                    stage,
                    variables,
                    pendingChoice: null,
                    ending: null,
                    stoppedReason: "blocking",
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
            }
            case "telop": {
                const res = applySceneBeat(stage, variables, inst.beat, doc);
                stage = res.stage;
                variables = res.variables;
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: inst.beatId,
                    stage,
                    variables,
                    pendingChoice: null,
                    ending: null,
                    stoppedReason: "blocking",
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
            }
            case "stageAction": {
                const waveItems: StageActionItem[] = [...getStageActionItems(inst.beat)];
                let cursor = pc;
                while (
                    instructions[cursor]?.op === "stageAction"
                    && (instructions[cursor] as Extract<StoryIR, { op: "stageAction" }>).beat.parallel === true
                    && instructions[cursor + 1]?.op === "stageAction"
                ) {
                    cursor += 1;
                    const nextInst = instructions[cursor] as Extract<StoryIR, { op: "stageAction" }>;
                    recordNode(nextInst.nodeId);
                    executedInstructions.push(nextInst);
                    waveItems.push(...getStageActionItems(nextInst.beat));
                }
                stage = applyStageActionWave(stage, waveItems);
                pc = cursor + 1;
                break;
            }
            case "cue": {
                const res = applySceneBeat(stage, variables, inst.beat, doc);
                stage = res.stage;
                variables = res.variables;
                pc += 1;
                break;
            }
            case "varOp":
                variables = applyVarOps(inst.ops, variables, doc);
                pc += 1;
                break;

            case "choice": {
                const options: StoryPendingChoiceOption[] = inst.options.map(opt => ({
                    id: opt.id,
                    text: interpolateStoryText(opt.text, doc, variables),
                    available: opt.condition ? evaluateCondition(opt.condition, variables) : true,
                    ...(opt.effects ? { effects: opt.effects } : {}),
                    targetPc: opt.targetPc,
                }));
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: null,
                    stage: { ...stage, telop: null, speaking: null },
                    variables,
                    pendingChoice: { nodeId: inst.nodeId, options },
                    ending: null,
                    stoppedReason: "choice",
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
            }

            case "condition": {
                let matched = false;
                for (const rule of inst.rules) {
                    if (evaluateCondition(rule.expr, variables)) {
                        matched = true;
                        recordEdge(rule.edgeId);
                        if (rule.targetPc === null) {
                            return {
                                pc,
                                nodeId: inst.nodeId,
                                beatId: null,
                                stage,
                                variables,
                                pendingChoice: null,
                                ending: null,
                                stoppedReason: "disconnected",
                                executedInstructions,
                                visitedNodeIds,
                                visitedEdgeIds,
                            };
                        }
                        pc = rule.targetPc;
                        break;
                    }
                }
                if (!matched) {
                    recordEdge(inst.elseEdgeId);
                    if (inst.elsePc === null) {
                        return {
                            pc,
                            nodeId: inst.nodeId,
                            beatId: null,
                            stage,
                            variables,
                            pendingChoice: null,
                            ending: null,
                            stoppedReason: "disconnected",
                            executedInstructions,
                            visitedNodeIds,
                            visitedEdgeIds,
                        };
                    }
                    pc = inst.elsePc;
                }
                break;
            }

            case "end": {
                const ending: StoryEndingResult = {
                    nodeId: inst.nodeId,
                    title: interpolateStoryText(inst.title, doc, variables),
                    ...(inst.subtitle !== undefined
                        ? { subtitle: interpolateStoryText(inst.subtitle, doc, variables) }
                        : {}),
                };
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: null,
                    stage: { ...stage, dialogue: null, narration: null, telop: null, speaking: null },
                    variables,
                    pendingChoice: null,
                    ending,
                    stoppedReason: "end",
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
            }

            case "jump":
                recordEdge(inst.edgeId);
                if (inst.targetPc < 0 || inst.targetPc >= instructions.length) {
                    return {
                        pc,
                        nodeId: inst.nodeId,
                        beatId: null,
                        stage,
                        variables,
                        pendingChoice: null,
                        ending: null,
                        stoppedReason: "disconnected",
                        executedInstructions,
                        visitedNodeIds,
                        visitedEdgeIds,
                    };
                }
                pc = inst.targetPc;
                break;

            case "halt":
                return {
                    pc,
                    nodeId: inst.nodeId,
                    beatId: null,
                    stage,
                    variables,
                    pendingChoice: null,
                    ending: null,
                    stoppedReason: inst.reason,
                    executedInstructions,
                    visitedNodeIds,
                    visitedEdgeIds,
                };
        }
    }

    return {
        pc,
        nodeId: null,
        beatId: null,
        stage,
        variables,
        pendingChoice: null,
        ending: null,
        stoppedReason: "disconnected",
        executedInstructions,
        visitedNodeIds,
        visitedEdgeIds,
    };
}

/**
 * Starts a fresh deterministic runtime from `doc.startNodeId` (default) OR from a specific
 * `startNodeId` ("Play from this Scene"), faithfully reconstructing inherited stage slots and
 * variables from a valid upstream graph path when reachable.
 */
export function createInitialRuntime(
    program: CompiledStoryProgram,
    startNodeId?: string,
): StoryRuntimeFrame {
    const targetNodeId = startNodeId ?? program.doc.startNodeId;
    const entryPc = program.nodeEntryPc[targetNodeId];
    if (entryPc === undefined) {
        return {
            pc: -1,
            nodeId: null,
            beatId: null,
            stage: INITIAL_STAGE_STATE,
            variables: initVariables(program.doc),
            pendingChoice: null,
            ending: null,
            stoppedReason: "disconnected",
            executedInstructions: [],
            visitedNodeIds: [],
            visitedEdgeIds: [],
        };
    }

    if (targetNodeId === program.doc.startNodeId) {
        return runFromPc(program, entryPc, INITIAL_STAGE_STATE, initVariables(program.doc), [], []);
    }

    const path = findGraphPathFromStart(program.doc, targetNodeId);
    if (!path) {
        // Isolated/unreachable scene: enter directly with clean initial state so authors can still test-play it.
        return runFromPc(program, entryPc, INITIAL_STAGE_STATE, initVariables(program.doc), [], []);
    }

    const ancestor = replayAncestors(program.doc, path);
    return runFromPc(
        program,
        entryPc,
        ancestor.stage,
        ancestor.variables,
        ancestor.visitedNodeIds,
        ancestor.visitedEdgeIds,
    );
}

/**
 * Purely advances `state` to the next blocking beat, choice, ending, or halt.
 * When `state.stoppedReason === "choice"`, `choiceOptionId` must specify an available option ID.
 */
export function advanceRuntime(
    program: CompiledStoryProgram,
    state: StoryRuntimeFrame,
    choiceOptionId?: string,
): StoryRuntimeFrame {
    if (state.stoppedReason === "end" || state.stoppedReason === "disconnected" || state.stoppedReason === "loop") {
        return state;
    }

    if (state.stoppedReason === "choice") {
        if (!choiceOptionId) return state;
        const inst = program.instructions[state.pc];
        if (!inst || inst.op !== "choice") return state;
        const opt = inst.options.find(item => item.id === choiceOptionId);
        if (!opt) return state;
        if (opt.condition && !evaluateCondition(opt.condition, state.variables)) {
            return state;
        }
        const nextVars = opt.effects && opt.effects.length > 0
            ? applyVarOps(opt.effects, state.variables, program.doc)
            : state.variables;
        const prefix: StoryIR[] = opt.effects && opt.effects.length > 0
            ? [{ op: "varOp", nodeId: inst.nodeId, ops: opt.effects }]
            : [];
        const nextEdges = opt.edgeId && !state.visitedEdgeIds.includes(opt.edgeId)
            ? [...state.visitedEdgeIds, opt.edgeId]
            : state.visitedEdgeIds;

        if (opt.targetPc === null) {
            return {
                pc: state.pc,
                nodeId: inst.nodeId,
                beatId: null,
                stage: state.stage,
                variables: nextVars,
                pendingChoice: null,
                ending: null,
                stoppedReason: "disconnected",
                executedInstructions: prefix,
                visitedNodeIds: state.visitedNodeIds,
                visitedEdgeIds: nextEdges,
            };
        }

        return runFromPc(
            program,
            opt.targetPc,
            state.stage,
            nextVars,
            state.visitedNodeIds,
            nextEdges,
            prefix,
        );
    }

    // Blocking beat (`talk` / `narration` / `telop`): advance from `pc + 1`.
    return runFromPc(
        program,
        state.pc + 1,
        state.stage,
        state.variables,
        state.visitedNodeIds,
        state.visitedEdgeIds,
    );
}

/**
 * Instant editor stage preview at `(nodeId, beatIdOrIndex?)`.
 * Reconstructs inherited BG/BGM/Place/Cast/Variables from a valid BFS path from `start` to `nodeId`
 * (or starts cleanly when `nodeId` is isolated):
 * - When `beatIdOrIndex` is omitted or `null` (inspecting the Scene node itself), mounts `stageCast`
 *   actors immediately even if `enterTiming === "afterTelop"` so authors can visually inspect/drag them.
 * - When `beatIdOrIndex` specifies a beat ID or 0-based beat index, applies beats through that beat
 *   inclusive, keeping `afterTelop` actors unmounted while previewing any leading `telop` beat.
 */
export function evaluateStageAt(
    doc: StoryDocument,
    nodeId: string,
    beatIdOrIndex?: string | number | null,
): { stage: StoryStageState; variables: StoryVarValues } {
    const node = doc.nodes[nodeId];
    if (!node) {
        return { stage: INITIAL_STAGE_STATE, variables: initVariables(doc) };
    }

    const path = findGraphPathFromStart(doc, nodeId);
    let stage: StoryStageState;
    let variables: StoryVarValues;
    if (path && path.length > 1) {
        const ancestor = replayAncestors(doc, path);
        stage = ancestor.stage;
        variables = ancestor.variables;
    } else {
        stage = INITIAL_STAGE_STATE;
        variables = initVariables(doc);
    }

    if (node.type === "scene") {
        if (beatIdOrIndex === undefined || beatIdOrIndex === null) {
            // Scene-level inspection: mount stageCast actors immediately so they remain editable on stage.
            stage = applySceneSlots(stage, node, doc, variables, { deferStageCast: false });
        } else {
            const deferStageCast =
                node.stageCast.mode === "set"
                && node.stageCast.enterTiming === "afterTelop"
                && findLeadingTelopEndIndex(node.beats) >= 0;
            stage = applySceneSlots(stage, node, doc, variables, { deferStageCast });

            let endIndex: number | undefined;
            if (typeof beatIdOrIndex === "number") {
                endIndex = beatIdOrIndex;
            } else {
                const hit = node.beats.findIndex(b => b.id === beatIdOrIndex);
                endIndex = hit !== -1 ? hit : undefined;
            }
            if (endIndex === undefined || endIndex >= 0) {
                const res = applySceneBeatsRange(stage, variables, node, doc, {
                    endIndex,
                    deferStageCast,
                });
                stage = res.stage;
                variables = res.variables;
            }
        }
    }

    return { stage, variables };
}

/**
 * Purely re-localizes a `StoryRuntimeFrame`'s displayed text (place banner, dialogue, narration,
 * telop, pending choices, ending, and executed instruction snapshots for backlog) against
 * `localizedDoc` (produced by `applyStoryLocaleOverlay`) so players can switch subtitle languages
 * mid-story with zero progress loss and zero Live2D stage reload.
 */
export function localizeRuntimeFrame(
    frame: StoryRuntimeFrame,
    localizedDoc: StoryDocument,
): StoryRuntimeFrame {
    const vars = frame.variables;

    const findSceneBeat = (nodeId: string | null, beatId: string): SceneBeat | undefined => {
        if (nodeId) {
            const node = localizedDoc.nodes[nodeId];
            if (node?.type === "scene") {
                const hit = node.beats.find(b => b.id === beatId);
                if (hit) return hit;
            }
        }
        for (const node of Object.values(localizedDoc.nodes)) {
            if (node.type === "scene") {
                const hit = node.beats.find(b => b.id === beatId);
                if (hit) return hit;
            }
        }
        return undefined;
    };

    let nextPlace = frame.stage.place;
    if (nextPlace !== null) {
        // Resolve latest explicit `place.mode === "set"` along visited path (including current node).
        const candidates = frame.nodeId && !frame.visitedNodeIds.includes(frame.nodeId)
            ? [...frame.visitedNodeIds, frame.nodeId]
            : frame.visitedNodeIds;
        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const node = localizedDoc.nodes[candidates[i]];
            if (node?.type === "scene") {
                if (node.place.mode === "hide") {
                    nextPlace = null;
                    break;
                }
                if (node.place.mode === "set") {
                    nextPlace = interpolateStoryText(node.place.text, localizedDoc, vars).trim() || null;
                    break;
                }
            }
        }
    }

    let nextDialogue = frame.stage.dialogue;
    if (nextDialogue) {
        const beat = findSceneBeat(frame.nodeId, nextDialogue.stepId);
        if (beat?.kind === "talk") {
            const member = beat.speakerKey ? localizedDoc.cast.find(item => item.key === beat.speakerKey) : undefined;
            const speaker = beat.speakerName
                ? interpolateStoryText(beat.speakerName, localizedDoc, vars)
                : (member?.name ?? "");
            nextDialogue = {
                ...nextDialogue,
                speaker,
                body: interpolateStoryText(beat.body, localizedDoc, vars),
            };
        }
    }

    let nextNarration = frame.stage.narration;
    if (nextNarration) {
        const beat = findSceneBeat(frame.nodeId, nextNarration.stepId);
        if (beat?.kind === "narration") {
            nextNarration = {
                ...nextNarration,
                body: interpolateStoryText(beat.body, localizedDoc, vars),
            };
        }
    }

    let nextTelop = frame.stage.telop;
    if (nextTelop) {
        const beat = findSceneBeat(frame.nodeId, nextTelop.stepId);
        if (beat?.kind === "telop") {
            nextTelop = {
                ...nextTelop,
                body: interpolateStoryText(beat.text, localizedDoc, vars),
            };
        }
    }

    let nextPendingChoice = frame.pendingChoice;
    if (nextPendingChoice) {
        const node = localizedDoc.nodes[nextPendingChoice.nodeId];
        if (node?.type === "choice") {
            nextPendingChoice = {
                ...nextPendingChoice,
                options: nextPendingChoice.options.map((opt) => {
                    const src = node.options.find(item => item.id === opt.id);
                    return src ? { ...opt, text: interpolateStoryText(src.text, localizedDoc, vars) } : opt;
                }),
            };
        }
    }

    let nextEnding = frame.ending;
    if (nextEnding) {
        const node = localizedDoc.nodes[nextEnding.nodeId];
        if (node?.type === "end") {
            nextEnding = {
                nodeId: node.id,
                title: interpolateStoryText(node.title, localizedDoc, vars),
                ...(node.subtitle !== undefined
                    ? { subtitle: interpolateStoryText(node.subtitle, localizedDoc, vars) }
                    : {}),
            };
        }
    }

    const nextExecuted = frame.executedInstructions.map((inst): StoryIR => {
        if (inst.op === "talk") {
            const beat = findSceneBeat(inst.nodeId, inst.beatId);
            return beat?.kind === "talk" ? { ...inst, beat } : inst;
        }
        if (inst.op === "narration") {
            const beat = findSceneBeat(inst.nodeId, inst.beatId);
            return beat?.kind === "narration" ? { ...inst, beat } : inst;
        }
        if (inst.op === "telop") {
            const beat = findSceneBeat(inst.nodeId, inst.beatId);
            return beat?.kind === "telop" ? { ...inst, beat } : inst;
        }
        if (inst.op === "enterScene") {
            const node = localizedDoc.nodes[inst.nodeId];
            return node?.type === "scene" ? { ...inst, title: node.title, place: node.place } : inst;
        }
        if (inst.op === "choice") {
            const node = localizedDoc.nodes[inst.nodeId];
            if (node?.type === "choice") {
                return {
                    ...inst,
                    title: node.title,
                    options: inst.options.map((opt) => {
                        const src = node.options.find(item => item.id === opt.id);
                        return src ? { ...opt, text: src.text } : opt;
                    }),
                };
            }
        }
        if (inst.op === "end") {
            const node = localizedDoc.nodes[inst.nodeId];
            if (node?.type === "end") {
                return {
                    ...inst,
                    title: node.title,
                    ...(node.subtitle !== undefined ? { subtitle: node.subtitle } : {}),
                };
            }
        }
        return inst;
    });

    return {
        ...frame,
        stage: {
            ...frame.stage,
            place: nextPlace,
            dialogue: nextDialogue,
            narration: nextNarration,
            telop: nextTelop,
        },
        pendingChoice: nextPendingChoice,
        ending: nextEnding,
        executedInstructions: nextExecuted,
    };
}
