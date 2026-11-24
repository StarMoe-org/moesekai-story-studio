import {
    SLOT_X,
    STORY_FADE_SECONDS,
    applyStageActionWave,
    applyVarOps,
    clampActorX,
    clampDelay,
    getStageActionItems,
    interpolateStoryText,
    layoutStageActors,
    type StageActionBeat,
    type StageActionItem,
    type StageCastSlot,
    type StageLayoutMode,
    type StoryDocument,
    type StoryEffectColor,
    type StoryIR,
    type StoryRuntimeFrame,
    type StoryStageActorState,
    type StoryStageState,
    type StoryVarValues,
    type TalkBeat,
} from "@moesekai/story-core";
import {
    resolveStageActorAlphaScale,
    type StoryStageActorTweenOption,
    type StoryStageApplyOptions,
} from "./stageController";

/** Default fade duration (seconds) when dimming/hiding/restoring actors for `telop.actorVisibility`. */
export const TELOP_VISIBILITY_FADE_SECONDS = 0.25;

export interface StageActionWavePlan {
    /** Resolved stage state after applying all items in the wave atomically via `applyStageActionWave`. */
    nextStage: StoryStageState;
    /** Expanded ordered `StageActionItem`s included in this wave. */
    items: StageActionItem[];
    /** Shared leading wait (milliseconds) before the wave starts animating (`min(delay)` across all items). */
    waveDelayMs: number;
    /** Lockstep `StoryStageApplyOptions` (`fade`, `fadeSeconds`, `moveSeconds`, per-actor `actorTweens`). */
    applyOptions: StoryStageApplyOptions;
}

export interface StageCastApplyPlan {
    /** Leading wait (milliseconds) from `stageCast.enterDelay` before mounting actors. */
    delayMs: number;
    /** Lockstep `StoryStageApplyOptions` for mounting `stageCast.actors`. */
    applyOptions: StoryStageApplyOptions;
}

export interface ChoreographyExecutionHooks {
    /** Returns true if playback was cancelled/superseded (e.g. `playGenRef.current !== generation`). */
    isCancelled: () => boolean;
    /** Returns the active (possibly localized) `StoryDocument`. */
    getDoc: () => StoryDocument;
    /** Initial variables before `frame.executedInstructions` execute. */
    baseVars: StoryVarValues;
    /** Updates React stage state. */
    setStageState: (stage: StoryStageState) => void;
    /** Updates React live variables state. */
    setVariables: (vars: StoryVarValues) => void;
    /** Syncs BGM playback with `stage.bgm`. */
    syncBgm: (bgm: StoryStageState["bgm"]) => void;
    /** Updates screen fader transition duration in seconds. */
    setFadeSeconds: (seconds: number) => void;
    /** Marks whether a blocking transition, effect, or delay is actively running. */
    setEffectActive: (active: boolean) => void;
    /** Fires a transient screen flash overlay (`fadeBlack`/`fadeWhite` scene transition or `flash` cue). */
    triggerFlash: (color: StoryEffectColor, seconds: number) => void;
    /** Applies target stage snapshot to the Live2D stage controller. */
    applyStage: (target: StoryStageState, options: StoryStageApplyOptions) => Promise<void>;
    /** Plays camera shake for `seconds`. */
    shakeStage: (seconds: number) => Promise<void>;
    /** Cancellable sleep in milliseconds (aborted immediately on snap/skip/cancel). */
    waitMs: (ms: number) => Promise<void>;
    /** Plays a sound effect asset (`beat.se`) with optional volume. */
    playSe: (se: string, volume?: number) => void;
    /** Handles talk-beat UI & voice startup (typewriter reset + voice playback). */
    onTalkBeat: (beat: TalkBeat, stage: StoryStageState, vars: StoryVarValues, doc: StoryDocument) => void;
    /** When true (`prefers-reduced-motion`), skips delays and snaps stage transitions immediately. */
    reducedMotion?: boolean;
}

export interface ChoreographyExecutionResult {
    cancelled: boolean;
    stage: StoryStageState;
    variables: StoryVarValues;
}

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

/**
 * Pure incremental stage reducer mirroring `@moesekai/story-core`'s `runtime.ts` so both
 * `StoryPlayerView` and `StoryStudioEditor` Playtest animate each IR instruction faithfully
 * (including `deferStageCast`, `applyStageCast`, multi-actor `stageAction` waves, `telop`
 * actorVisibility/position, `mirror`, `explicitX`, and `lockX`) before settling on `frame.stage`.
 */
export function applyInstructionToStage(
    stage: StoryStageState,
    vars: StoryVarValues,
    inst: StoryIR,
    doc: StoryDocument,
): { stage: StoryStageState; variables: StoryVarValues } {
    switch (inst.op) {
        case "enterScene": {
            const background = inst.background.mode === "inherit"
                ? stage.background
                : inst.background.mode === "clear"
                    ? null
                    : inst.background.asset;
            const bgm = inst.bgm.mode === "inherit"
                ? stage.bgm
                : inst.bgm.mode === "stop"
                    ? { name: null, volume: stage.bgm.volume }
                    : { name: inst.bgm.name, volume: stage.bgm.volume };
            const place = inst.place.mode === "inherit"
                ? stage.place
                : inst.place.mode === "hide"
                    ? null
                    : (interpolateStoryText(inst.place.text, doc, vars).trim() || null);
            const nextLayoutMode: StageLayoutMode | undefined = inst.stageCast.mode === "inherit"
                ? stage.layoutMode
                : inst.stageCast.mode === "clear"
                    ? undefined
                    : inst.stageCast.layoutMode;
            const actors: StoryStageActorState[] = inst.stageCast.mode === "inherit"
                ? stage.actors
                : inst.stageCast.mode === "clear"
                    ? []
                    : inst.deferStageCast
                        ? []
                        : buildActorsFromStageCast(inst.stageCast);
            const screenColor: StoryEffectColor = inst.transition.kind === "fadeWhite" ? "white" : "black";
            return {
                stage: {
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
                },
                variables: vars,
            };
        }
        case "applyStageCast": {
            const nextStage: StoryStageState = {
                ...stage,
                actors: buildActorsFromStageCast(inst.stageCast),
                telop: null,
                speaking: null,
            };
            if (inst.stageCast.layoutMode !== undefined) {
                nextStage.layoutMode = inst.stageCast.layoutMode;
            } else {
                delete nextStage.layoutMode;
            }
            return { stage: nextStage, variables: vars };
        }
        case "talk": {
            const beat = inst.beat;
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
                    const bumpSpeaker = onStage
                        && actor.cast === beat.speakerKey
                        && speakerAutoOrder !== undefined
                        && actor.autoOrder !== speakerAutoOrder;
                    if (!pose && !bumpSpeaker) return actor;
                    return {
                        ...actor,
                        ...(pose ? { motion: pose.motion ?? actor.motion, facial: pose.facial ?? actor.facial } : {}),
                        ...(bumpSpeaker ? { autoOrder: speakerAutoOrder } : {}),
                    };
                });

            return {
                stage: {
                    ...stage,
                    actors,
                    narration: null,
                    telop: null,
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
                    ...stage,
                    dialogue: null,
                    telop: null,
                    speaking: null,
                    narration: {
                        stepId: inst.beat.id,
                        body: interpolateStoryText(inst.beat.body, doc, vars),
                    },
                },
                variables: vars,
            };
        case "telop":
            return {
                stage: {
                    ...stage,
                    dialogue: null,
                    narration: null,
                    speaking: null,
                    telop: {
                        stepId: inst.beat.id,
                        body: interpolateStoryText(inst.beat.text, doc, vars),
                        ...(inst.beat.actorVisibility !== undefined ? { actorVisibility: inst.beat.actorVisibility } : {}),
                        ...(inst.beat.position !== undefined ? { position: inst.beat.position } : {}),
                    },
                },
                variables: vars,
            };
        case "stageAction":
            return {
                stage: applyStageActionWave(stage, getStageActionItems(inst.beat)),
                variables: vars,
            };
        case "varOp":
            return {
                stage: { ...stage, telop: null, speaking: null },
                variables: applyVarOps(inst.ops, vars, doc),
            };
        case "choice":
            return {
                stage: { ...stage, telop: null, speaking: null },
                variables: vars,
            };
        case "end":
            return {
                stage: { ...stage, dialogue: null, narration: null, telop: null, speaking: null },
                variables: vars,
            };
        case "cue":
            return { stage: { ...stage, telop: null, speaking: null }, variables: vars };
        case "condition":
        case "jump":
        case "halt":
            return { stage, variables: vars };
    }
}

/**
 * Computes the leading delay and `StoryStageApplyOptions` for mounting a `StageCastSlot`
 * (`mode: "set"`), preserving legacy `transition: "none"` pop-in when no enter timing fields are set.
 */
export function buildStageCastApplyPlan(
    stageCast: Extract<StageCastSlot, { mode: "set" }>,
    options?: { defaultFade?: boolean },
): StageCastApplyPlan {
    const enterDelaySec = stageCast.enterDelay !== undefined && Number.isFinite(stageCast.enterDelay)
        ? clampDelay(stageCast.enterDelay)
        : 0;
    const delayMs = Math.round(enterDelaySec * 1000);
    const hasCustomEnterTiming =
        stageCast.enterTransition !== undefined
        || stageCast.enterDuration !== undefined
        || enterDelaySec > 0;
    const explicitDuration = stageCast.enterDuration !== undefined && Number.isFinite(stageCast.enterDuration)
        ? Math.max(0, stageCast.enterDuration)
        : undefined;
    const fade = stageCast.enterTransition === "instant"
        ? false
        : stageCast.enterTransition === "fade"
            ? (explicitDuration === undefined || explicitDuration > 0)
            : hasCustomEnterTiming
                ? (explicitDuration === undefined || explicitDuration > 0)
                : Boolean(options?.defaultFade);
    const fadeSeconds = fade
        ? (explicitDuration ?? STORY_FADE_SECONDS)
        : 0;

    return {
        delayMs,
        applyOptions: {
            instant: false,
            fade,
            fadeSeconds,
        },
    };
}

/**
 * Builds an atomic multi-actor choreography wave plan from one or more simultaneous
 * `StageActionBeat`s (expanding `beat.group` via `getStageActionItems` and chaining
 * `parallel: true` beats). Uses `@moesekai/story-core`'s `applyStageActionWave` directly
 * with zero duplicated layout math.
 */
export function buildStageActionWavePlan(
    prevStage: StoryStageState,
    beats: readonly StageActionBeat[],
    _doc?: StoryDocument,
): StageActionWavePlan {
    const items: StageActionItem[] = [];
    for (const beat of beats) {
        items.push(...getStageActionItems(beat));
    }

    const nextStage = applyStageActionWave(prevStage, items);
    if (items.length === 0) {
        return {
            nextStage,
            items,
            waveDelayMs: 0,
            applyOptions: { instant: false, fade: false },
        };
    }

    let minDelaySec = Number.POSITIVE_INFINITY;
    for (const item of items) {
        const d = item.delay !== undefined && Number.isFinite(item.delay) ? clampDelay(item.delay) : 0;
        if (d < minDelaySec) minDelaySec = d;
    }
    if (!Number.isFinite(minDelaySec)) minDelaySec = 0;
    const waveDelayMs = Math.round(minDelaySec * 1000);

    const actorTweens: Record<string, StoryStageActorTweenOption> = {};
    let hasAnimatedFade = false;
    let waveFadeSeconds: number | undefined;
    let waveMoveSeconds: number | undefined;

    for (const item of items) {
        const rawDelay = item.delay !== undefined && Number.isFinite(item.delay) ? clampDelay(item.delay) : 0;
        const relDelay = Math.max(0, Math.round((rawDelay - minDelaySec) * 1000) / 1000);
        const explicitDuration = item.duration !== undefined && Number.isFinite(item.duration)
            ? Math.max(0, item.duration)
            : undefined;
        const isInstant = item.transition === "instant" || explicitDuration === 0;

        if (item.action === "enter" || item.action === "exit") {
            const fade = !isInstant;
            const duration = isInstant ? 0 : (explicitDuration ?? STORY_FADE_SECONDS);
            if (fade) {
                hasAnimatedFade = true;
                if (waveFadeSeconds === undefined && explicitDuration !== undefined) {
                    waveFadeSeconds = explicitDuration;
                }
            }
            actorTweens[item.castKey] = {
                delay: relDelay,
                duration,
                fade,
                easing: item.action === "enter" ? "in" : "out",
            };
        } else if (item.action === "move") {
            const duration = isInstant ? 0 : (explicitDuration ?? STORY_FADE_SECONDS);
            if (waveMoveSeconds === undefined) {
                waveMoveSeconds = duration;
            }
            actorTweens[item.castKey] = {
                delay: relDelay,
                duration,
                easing: "in-out",
            };
        } else {
            // "pose"
            actorTweens[item.castKey] = {
                delay: relDelay,
                duration: 0,
            };
        }
    }

    const applyOptions: StoryStageApplyOptions = {
        instant: false,
        fade: hasAnimatedFade,
        fadeSeconds: waveFadeSeconds ?? STORY_FADE_SECONDS,
        moveSeconds: waveMoveSeconds ?? waveFadeSeconds ?? STORY_FADE_SECONDS,
        actorTweens,
        actorAlphaScale: resolveStageActorAlphaScale(nextStage),
    };

    return {
        nextStage,
        items,
        waveDelayMs,
        applyOptions,
    };
}

/**
 * Executes one compiled `StoryRuntimeFrame`'s `executedInstructions` in clean, lockstep
 * choreography waves for BOTH `StoryPlayerView` and `StoryStudioEditor` Playtest:
 * - Honors `enterScene` (`deferStageCast`, `enterDelay`, `enterDuration`, `enterTransition`)
 * - Honors `applyStageCast` (deferred post-telop cast entry with cancellable delay + lockstep fade)
 * - Coalesces `stageAction` (`beat.group` + consecutive `parallel: true` beats) into ONE atomic wave
 * - Honors `telop.actorVisibility` (`"keep" | "hide" | "dim"`) and restores actor opacity on next beat
 * - Preserves `talk`, `narration`, `cue`, `varOp`, `choice`, `end`, and cancellation/snap semantics.
 */
export async function executeChoreographyFrame(
    frame: StoryRuntimeFrame,
    prevStage: StoryStageState,
    hooks: ChoreographyExecutionHooks,
): Promise<ChoreographyExecutionResult> {
    const instructions = frame.executedInstructions;
    let stage = prevStage;
    let vars = hooks.baseVars;
    const instant = Boolean(hooks.reducedMotion);

    const runCancellableWait = async (ms: number): Promise<boolean> => {
        if (ms <= 0 || instant) return !hooks.isCancelled();
        hooks.setEffectActive(true);
        try {
            await hooks.waitMs(ms);
        } finally {
            if (!hooks.isCancelled()) hooks.setEffectActive(false);
        }
        return !hooks.isCancelled();
    };

    let idx = 0;
    while (idx < instructions.length) {
        if (hooks.isCancelled()) {
            return { cancelled: true, stage, variables: vars };
        }
        const inst = instructions[idx];
        const activeDoc = hooks.getDoc();
        const prevAlphaScale = resolveStageActorAlphaScale(stage);

        switch (inst.op) {
            case "enterScene": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                const targetStage = stepped.stage;
                vars = stepped.variables;
                const castPlan = inst.stageCast.mode === "set" && !inst.deferStageCast
                    ? buildStageCastApplyPlan(inst.stageCast, {
                        defaultFade: inst.transition.kind !== "none",
                    })
                    : null;
                const hasFadeTransition = inst.transition.kind === "fadeBlack" || inst.transition.kind === "fadeWhite";
                const transDur = hasFadeTransition ? Math.max(0.1, inst.transition.duration) : 0;
                const transColor: StoryEffectColor = inst.transition.kind === "fadeWhite" ? "white" : "black";

                if (castPlan && castPlan.delayMs > 0 && !instant) {
                    // Enter background/BGM/place immediately (clearing old actors), then wait `enterDelay`,
                    // then mount & animate `stageCast.actors` together in lockstep.
                    const preEnterStage: StoryStageState = { ...targetStage, actors: [] };
                    stage = preEnterStage;
                    hooks.setStageState(stage);
                    hooks.syncBgm(stage.bgm);

                    if (hasFadeTransition) {
                        hooks.setFadeSeconds(transDur);
                        hooks.setEffectActive(true);
                        try {
                            hooks.triggerFlash(transColor, transDur);
                            await Promise.all([
                                hooks.applyStage(preEnterStage, { instant: false, fade: true }),
                                hooks.waitMs(transDur * 1000 * 0.6),
                            ]);
                        } finally {
                            if (!hooks.isCancelled()) hooks.setEffectActive(false);
                        }
                    } else {
                        hooks.setFadeSeconds(0);
                        await hooks.applyStage(preEnterStage, { instant: false, fade: false });
                    }
                    if (hooks.isCancelled()) return { cancelled: true, stage, variables: vars };

                    const stillLive = await runCancellableWait(castPlan.delayMs);
                    if (!stillLive) return { cancelled: true, stage, variables: vars };

                    stage = targetStage;
                    hooks.setStageState(stage);
                    await hooks.applyStage(stage, castPlan.applyOptions);
                } else {
                    stage = targetStage;
                    hooks.setStageState(stage);
                    hooks.syncBgm(stage.bgm);

                    if (hasFadeTransition) {
                        hooks.setFadeSeconds(transDur);
                        hooks.setEffectActive(true);
                        try {
                            hooks.triggerFlash(transColor, transDur);
                            await Promise.all([
                                hooks.applyStage(
                                    stage,
                                    instant ? { instant: true } : (castPlan?.applyOptions ?? { instant: false, fade: true }),
                                ),
                                hooks.waitMs(transDur * 1000 * 0.6),
                            ]);
                        } finally {
                            if (!hooks.isCancelled()) hooks.setEffectActive(false);
                        }
                    } else {
                        hooks.setFadeSeconds(0);
                        await hooks.applyStage(
                            stage,
                            instant ? { instant: true } : (castPlan?.applyOptions ?? { instant: false, fade: false }),
                        );
                    }
                }
                idx += 1;
                break;
            }
            case "applyStageCast": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                const castPlan = buildStageCastApplyPlan(inst.stageCast, { defaultFade: true });
                if (castPlan.delayMs > 0 && !instant) {
                    if (stage.telop) {
                        stage = { ...stage, telop: null, speaking: null };
                        hooks.setStageState(stage);
                    }
                    const stillLive = await runCancellableWait(castPlan.delayMs);
                    if (!stillLive) return { cancelled: true, stage, variables: vars };
                }
                stage = stepped.stage;
                vars = stepped.variables;
                hooks.setStageState(stage);
                await hooks.applyStage(stage, instant ? { instant: true } : castPlan.applyOptions);
                idx += 1;
                break;
            }
            case "stageAction": {
                const waveBeats: StageActionBeat[] = [inst.beat];
                let endIdx = idx;
                while (
                    instructions[endIdx]?.op === "stageAction"
                    && (instructions[endIdx] as Extract<StoryIR, { op: "stageAction" }>).beat.parallel === true
                    && instructions[endIdx + 1]?.op === "stageAction"
                ) {
                    endIdx += 1;
                    waveBeats.push((instructions[endIdx] as Extract<StoryIR, { op: "stageAction" }>).beat);
                }

                const plan = buildStageActionWavePlan(stage, waveBeats, activeDoc);
                if (plan.waveDelayMs > 0 && !instant) {
                    if (stage.telop) {
                        stage = { ...stage, telop: null, speaking: null };
                        hooks.setStageState(stage);
                    }
                    const stillLive = await runCancellableWait(plan.waveDelayMs);
                    if (!stillLive) return { cancelled: true, stage, variables: vars };
                }
                stage = plan.nextStage;
                hooks.setStageState(stage);
                await hooks.applyStage(stage, instant ? { instant: true } : plan.applyOptions);
                idx = endIdx + 1;
                break;
            }
            case "cue": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                const beat = inst.beat;
                hooks.setStageState(stage);
                const nextAlphaScale = resolveStageActorAlphaScale(stage);
                if (Math.abs(nextAlphaScale - prevAlphaScale) > 1e-4) {
                    void hooks.applyStage(stage, {
                        instant,
                        actorAlphaScale: nextAlphaScale,
                        fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS,
                    });
                }
                if (beat.cueType === "se") {
                    if (beat.se) hooks.playSe(beat.se, beat.seVolume);
                } else {
                    hooks.setEffectActive(true);
                    try {
                        if (beat.cueType === "flash") {
                            const dur = beat.duration ?? 0.4;
                            hooks.triggerFlash(beat.color ?? "white", dur);
                            await hooks.waitMs(Math.min(dur, 1.5) * 1000);
                        } else if (beat.cueType === "shake") {
                            await hooks.shakeStage(beat.duration ?? 0.4);
                        } else if (beat.cueType === "wait") {
                            await hooks.waitMs((beat.duration ?? 0.8) * 1000);
                        }
                    } finally {
                        if (!hooks.isCancelled()) hooks.setEffectActive(false);
                    }
                }
                idx += 1;
                break;
            }
            case "varOp": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                hooks.setVariables(vars);
                idx += 1;
                break;
            }
            case "talk": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                const nextAlphaScale = resolveStageActorAlphaScale(stage);
                hooks.setStageState(stage);
                hooks.setVariables(vars);
                void hooks.applyStage(stage, {
                    instant,
                    actorAlphaScale: nextAlphaScale,
                    ...(Math.abs(nextAlphaScale - prevAlphaScale) > 1e-4
                        ? { fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS }
                        : {}),
                });
                if (inst.beat.se) {
                    hooks.playSe(inst.beat.se, inst.beat.seVolume);
                }
                hooks.onTalkBeat(inst.beat, stage, vars, activeDoc);
                idx += 1;
                break;
            }
            case "narration": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                const nextAlphaScale = resolveStageActorAlphaScale(stage);
                hooks.setStageState(stage);
                void hooks.applyStage(stage, {
                    instant,
                    actorAlphaScale: nextAlphaScale,
                    ...(Math.abs(nextAlphaScale - prevAlphaScale) > 1e-4
                        ? { fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS }
                        : {}),
                });
                if (inst.beat.se) {
                    hooks.playSe(inst.beat.se, inst.beat.seVolume);
                }
                idx += 1;
                break;
            }
            case "telop": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                const nextAlphaScale = resolveStageActorAlphaScale(stage);
                hooks.setStageState(stage);
                void hooks.applyStage(stage, {
                    instant,
                    actorAlphaScale: nextAlphaScale,
                    fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS,
                });
                idx += 1;
                break;
            }
            case "choice":
            case "end": {
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;
                const nextAlphaScale = resolveStageActorAlphaScale(stage);
                hooks.setStageState(stage);
                void hooks.applyStage(stage, {
                    instant,
                    actorAlphaScale: nextAlphaScale,
                    ...(Math.abs(nextAlphaScale - prevAlphaScale) > 1e-4
                        ? { fadeSeconds: TELOP_VISIBILITY_FADE_SECONDS }
                        : {}),
                });
                idx += 1;
                break;
            }
            case "condition":
            case "jump":
            case "halt":
            default:
                idx += 1;
                break;
        }
    }

    return {
        cancelled: hooks.isCancelled(),
        stage,
        variables: vars,
    };
}
