"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Button, Icon, LinearProgress, LoadingIndicator, Tooltip, cn } from "../md3";
import {
    mdClose, mdDragIndicator, mdErrorFill, mdInfo, mdLock, mdRefresh, mdWarningFill,
} from "../md3/icons";
import { useStoryI18n as useI18n, useStoryStudio } from "../context/StoryStudioContext";
import {
    SLOT_X, STORY_LIMITS, STORY_SLOTS, clampActorX, computeActorRenderOrders,
    getCharacterIconUrl, storyBackgroundUrl,
    type AssetLine, type StoryDocument, type StoryEffectColor, type StoryStageState,
    type StoryUiKit, type TelopActorVisibility,
} from "@moesekai/story-core";
import { md3EasingStandard } from "../md3/motion";
import { GameStageOverlay, type GameStageChoiceProp } from "./GameStageOverlay";
import { MoeSekaiWordmarkSvg } from "./MoeSekaiWordmarkSvg";
import type { StoryActorProblem, StoryStageLoadProgress, StoryStagePhase } from "./useStoryStage";

/** Screen colours of fades and flashes: the game's, not theme roles. */
export const SCREEN_COLORS: Record<StoryEffectColor, string> = { black: "#000", white: "#fff" };

export interface StageAdjustConfig {
    active: boolean;
    /** Live preview callback fired during pointer move so WebGPU & fallback portraits follow immediately. */
    onPreviewActorCoords?: (castKey: string, coords: { x: number; y: number }) => void;
    /** Commit callback fired on pointer-up to push a single undoable document edit. */
    onCommitActorCoords?: (castKey: string, coords: { x: number; y: number }) => void;
    /** Optional cancel callback fired on pointer-cancel. */
    onCancelDrag?: () => void;
    /** Optional castKey currently highlighted / selected. */
    selectedCastKey?: string | null;
}

/** Resolves portrait fallback opacity from `state.telop?.actorVisibility` (mirrors WebGPU `stageController`). */
export function resolveFallbackActorOpacity(actorVisibility?: TelopActorVisibility): number {
    if (actorVisibility === "hide") return 0;
    if (actorVisibility === "dim") return 0.28;
    return 1;
}

/** Clamps a vertical stage offset into `[STORY_LIMITS.yMin, STORY_LIMITS.yMax]` rounded to 0.01. */
export function clampStageActorY(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const clamped = Math.min(STORY_LIMITS.yMax, Math.max(STORY_LIMITS.yMin, value));
    return Math.round(clamped * 100) / 100;
}

/** Converts stage actor world coordinates `(x, y)` to clamped percentage anchor positions inside the 16:9 stage. */
export function actorCoordsToStagePercent(x: number, y: number): { leftPct: number; topPct: number } {
    const leftPct = Math.min(96, Math.max(4, 50 + x * 50));
    const topPct = Math.min(84, Math.max(16, 52 - y * 45));
    return { leftPct, topPct };
}

/**
 * Projects a pointer drag delta over a 16:9 stage container rectangle into clamped Live2D world coordinates
 * (`x` in `[-1.2, +1.2]`, `y` in `[-0.6, +0.6]`), exact inverse of `actorCoordsToStagePercent`.
 */
export function projectStagePointerToActorCoords(params: {
    clientX: number;
    clientY: number;
    rect: { width: number; height: number };
    startX: number;
    startY: number;
    startClientX: number;
    startClientY: number;
}): { x: number; y: number } {
    const halfWidth = Math.max(1, params.rect.width * 0.5);
    const ySpan = Math.max(1, params.rect.height * 0.45);
    const rawX = params.startX + (params.clientX - params.startClientX) / halfWidth;
    const rawY = params.startY - (params.clientY - params.startClientY) / ySpan;
    return {
        x: clampActorX(Math.round(rawX * 100) / 100),
        y: clampStageActorY(rawY),
    };
}

export interface StoryStageStatusProps {
    phase: StoryStagePhase;
    problems: Record<string, StoryActorProblem>;
    loadingActors: number;
    loadProgress?: StoryStageLoadProgress | null;
    onRetry: () => void;
}

interface StoryStageViewProps extends StoryStageStatusProps {
    doc: StoryDocument;
    state: StoryStageState;
    line: AssetLine;
    hostRef: RefObject<HTMLDivElement | null>;
    /** Loaded in-game UI kit sprites (null while loading or when using CSS/SVG fallback). */
    uiKit?: StoryUiKit | null;
    /** Hides the scenario UI overlay (used by the player's Hide UI mode). */
    uiHidden?: boolean;
    /** The dialogue's text as typed so far (the whole line when left out). */
    dialogueText?: string;
    /** Player AUTO mode active: shows `AutoSignal` inside `TalkWindow`. */
    autoPlay?: boolean;
    /** Shows the manual mode bouncing `EndSign` indicator in `TalkWindow`. */
    showEndSign?: boolean;
    /** Choice options rendered via `AnswerChoiceDialog` (interactive in player, preview in editor). */
    choice?: GameStageChoiceProp | null;
    /** Whether `AnswerChoiceDialog` buttons are clickable. */
    choiceInteractive?: boolean;
    onChoose?: (optionId: string, optionText: string) => void;
    onChoiceSound?: (url: string) => void;
    /** Renders the top-right circular `UIPartsMenuButton`. */
    showMenuButton?: boolean;
    menuOpen?: boolean;
    onMenuClick?: () => void;
    /** Animate cinemascope bars when narration appears (enabled in player mode). */
    animateCinemascope?: boolean;
    /** A flash to play (a new key plays it again). */
    flash?: { key: number; color: StoryEffectColor; seconds: number } | null;
    /** Seconds of the screen fade (fade effects, background transitions). */
    fadeSeconds?: number;
    /** Hides verbose engine details (the player shows banners elsewhere). */
    compactStatus?: boolean;
    /** Active solo/audition preview banner (lifts scene overlays so 0-actor & off-stage preview stays unobstructed). */
    soloPreview?: { name: string; onExit: () => void } | null;
    /** Optional Edit-mode interactive actor positioning overlay (5-slot guides + draggable actor handles). */
    stageAdjust?: StageAdjustConfig | null;
    /** Enables the non-intrusive MoeSekai attribution badge in the top-right corner (Playback / Playtest). */
    showAttribution?: boolean;
    onClick?: () => void;
    children?: ReactNode;
    className?: string;
}

/** Pure visibility predicate for the stage's non-intrusive MoeSekai resource attribution micro-pill. */
export function shouldShowStageAttribution(params: {
    stageEnabled?: boolean;
    providerEnabled?: boolean;
    uiHidden?: boolean;
    soloPreviewActive?: boolean;
}): boolean {
    return Boolean(
        params.stageEnabled
        && params.providerEnabled !== false
        && !params.uiHidden
        && !params.soloPreviewActive,
    );
}

const MISSING_KEYS = ["webgpu", "webgpu-adapter", "offscreen-canvas", "worker"] as const;

/** Top-right corner stack: translucent MoeSekai SVG watermark + engine status notes, clear of the game menu button. */
function StageTopRightOverlay({
    phase, problems: actorProblems, loadingActors, loadProgress, onRetry, doc, compact, offsetForMenu, showAttribution, onOpenNotices,
}: StoryStageStatusProps & {
    doc: StoryDocument;
    compact?: boolean;
    offsetForMenu?: boolean;
    showAttribution?: boolean;
    onOpenNotices?: () => void;
}) {
    const { t } = useI18n();
    const problems = Object.entries(actorProblems);
    const chip = "pointer-events-auto flex min-w-0 max-w-full items-center gap-2 rounded-md3-md glass px-3 py-1.5 type-label-m text-on-surface";
    const notes: ReactNode[] = [];
    if (showAttribution) {
        const badgeLabel = t("page.storyMaker.attribution.stageBadge");
        notes.push(
            <Tooltip
                key="moesekai-attribution"
                side="bottom"
                label={badgeLabel}
                className="pointer-events-auto"
            >
                <button
                    type="button"
                    data-testid="moesekai-attribution-badge"
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpenNotices?.();
                    }}
                    aria-label={badgeLabel}
                    className="sekai-attribution-badge"
                >
                    <MoeSekaiWordmarkSvg />
                </button>
            </Tooltip>,
        );
    }
    if (phase.kind === "loading" || phase.kind === "recovering" || loadingActors > 0) {
        const isActorBatch = phase.kind !== "loading" && phase.kind !== "recovering" && loadingActors > 0;
        const labelText = phase.kind === "recovering"
            ? t("page.storyMaker.engine.recovering")
            : phase.kind === "loading"
                ? t("page.storyMaker.engine.starting")
                : loadProgress && loadProgress.totalActors > 1
                    ? t("page.storyMaker.engine.loadingModelsProgress", {
                        completed: loadProgress.completedActors,
                        total: loadProgress.totalActors,
                    })
                    : t("page.storyMaker.engine.loadingModels");
        const percentText = isActorBatch && loadProgress && loadProgress.percent !== null
            ? `${loadProgress.percent}%`
            : null;
        notes.push(
            <div key="loading" data-testid="stage-loading-indicator" className={chip}>
                <LoadingIndicator size={18} className="shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{labelText}</span>
                        {percentText && (
                            <span className="shrink-0 font-mono type-label-s tabular-nums text-on-surface-variant">
                                {percentText}
                            </span>
                        )}
                    </div>
                    {isActorBatch && loadProgress && (
                        <LinearProgress
                            value={loadProgress.percent !== null ? loadProgress.percent / 100 : undefined}
                            stop={false}
                            aria-label={labelText}
                            className="mt-1 h-1 min-w-28"
                        />
                    )}
                </div>
            </div>,
        );
    } else if (phase.kind === "unavailable") {
        const title = phase.message
            ? `${t("page.storyMaker.engine.unavailableDescription")}\n${phase.message}`
            : t("page.storyMaker.engine.unavailableDescription");
        notes.push(
            <div key="unavailable" className={chip} title={title}>
                <Icon path={mdInfo} size={18} className="shrink-0 text-on-surface-variant" />
                <span className="min-w-0 truncate">{t("page.storyMaker.engine.unavailable")}</span>
            </div>,
        );
    } else if (phase.kind === "unsupported") {
        const missing = phase.missing.filter(item => (MISSING_KEYS as readonly string[]).includes(item));
        notes.push(
            <div key="unsupported" className={chip}>
                <Icon path={mdWarningFill} size={18} className="shrink-0 text-error" />
                <span className="min-w-0">
                    <span className="block truncate">{t("page.storyMaker.engine.unsupported")}</span>
                    {!compact && missing.map(item => (
                        <span key={item} className="block truncate type-label-s text-on-surface-variant">{t(`page.storyMaker.engine.missing.${item}`)}</span>
                    ))}
                </span>
            </div>,
        );
    } else if (phase.kind === "failed") {
        notes.push(
            <div key="failed" className={chip}>
                <Icon path={mdErrorFill} size={18} className="shrink-0 text-error" />
                <span className="min-w-0 truncate" title={phase.url ?? phase.message}>{t("page.storyMaker.engine.failed")}</span>
                <Button size="xs" variant="text" icon={mdRefresh} onClick={(event) => { event.stopPropagation(); onRetry(); }}>
                    {t("common.action.retry")}
                </Button>
            </div>,
        );
    }
    if (problems.length > 0) {
        const lines = problems.map(([key, problem]) => (
            t(`page.storyMaker.engine.actor.${problem}`, { name: doc.cast.find(member => member.key === key)?.name || key })
        ));
        notes.push(
            <div key="problems" className={chip} title={lines.join("\n")}>
                <Icon path={mdWarningFill} size={18} className="shrink-0 text-error" />
                <span className="min-w-0">
                    {compact ? (
                        <span className="block truncate">
                            {problems.length === 1 ? lines[0] : `${lines[0]} (+${problems.length - 1})`}
                        </span>
                    ) : (
                        lines.map((line, index) => (
                            <span key={problems[index]?.[0] ?? index} className="block truncate">{line}</span>
                        ))
                    )}
                </span>
            </div>,
        );
    }
    if (notes.length === 0) return null;
    return (
        <div
            className={cn(
                "pointer-events-none absolute top-2 z-30 flex max-w-[65%] flex-col items-end gap-1.5",
                offsetForMenu ? "right-[7.5%]" : "right-2",
            )}
        >
            {notes}
        </div>
    );
}

/**
 * The story's 16:9 stage: background under the WebGPU Live2D canvas, optional portrait stand-ins
 * only when the Live2D stage is unavailable/unsupported/failed, screen fade cover, the pixel-exact
 * 1920x1080 `GameStageOverlay` scenario UI, and transient screen flashes.
 */
export function StoryStageView({
    doc, state, line, hostRef, phase, problems, loadingActors, loadProgress = null, onRetry,
    uiKit = null, uiHidden = false, dialogueText, autoPlay = false, showEndSign = false,
    choice = null, choiceInteractive = false, onChoose, onChoiceSound,
    showMenuButton = false, menuOpen = false, onMenuClick, animateCinemascope = false,
    flash, fadeSeconds = 0.5, compactStatus, soloPreview = null, stageAdjust = null,
    showAttribution = false, onClick, children, className,
}: StoryStageViewProps) {
    const { t } = useI18n();
    const { showAttribution: providerShowAttribution, openNotices } = useStoryStudio();
    const reduced = useReducedMotion();
    const stageContainerRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{
        castKey: string;
        pointerId: number;
        startX: number;
        startY: number;
        startClientX: number;
        startClientY: number;
        latestX: number;
        latestY: number;
        moved: boolean;
    } | null>(null);
    const [draggingCastKey, setDraggingCastKey] = useState<string | null>(null);
    const background = state.background ? storyBackgroundUrl(state.background, doc.region, line) : null;
    const [failedBackground, setFailedBackground] = useState<string | null>(null);
    const showBackground = Boolean(background) && failedBackground !== background;
    const showPortraitFallback = phase.kind === "unavailable" || phase.kind === "unsupported" || phase.kind === "failed";
    const fade = reduced ? 0 : fadeSeconds;
    const isSoloPreviewActive = soloPreview !== null;
    const isStageAdjustActive = Boolean(stageAdjust?.active) && !isSoloPreviewActive;
    const fallbackRenderOrders = computeActorRenderOrders(state.actors, state.speaking);
    const fallbackOpacity = resolveFallbackActorOpacity(state.telop?.actorVisibility);
    const renderAttribution = shouldShowStageAttribution({
        stageEnabled: showAttribution,
        providerEnabled: providerShowAttribution,
        uiHidden,
        soloPreviewActive: isSoloPreviewActive,
    });

    const handleAdjustPointerDown = (
        castKey: string,
        actorX: number,
        actorY: number,
        event: ReactPointerEvent<HTMLDivElement>,
    ) => {
        if (!isStageAdjustActive || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            castKey,
            pointerId: event.pointerId,
            startX: actorX,
            startY: actorY,
            startClientX: event.clientX,
            startClientY: event.clientY,
            latestX: actorX,
            latestY: actorY,
            moved: false,
        };
        setDraggingCastKey(castKey);
    };

    const handleAdjustPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const container = stageContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const next = projectStagePointerToActorCoords({
            clientX: event.clientX,
            clientY: event.clientY,
            rect,
            startX: drag.startX,
            startY: drag.startY,
            startClientX: drag.startClientX,
            startClientY: drag.startClientY,
        });
        if (next.x !== drag.latestX || next.y !== drag.latestY) {
            drag.latestX = next.x;
            drag.latestY = next.y;
            drag.moved = true;
            stageAdjust?.onPreviewActorCoords?.(drag.castKey, next);
        }
    };

    const handleAdjustPointerFinish = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.stopPropagation();
        dragRef.current = null;
        setDraggingCastKey(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (commit && drag.moved) {
            stageAdjust?.onCommitActorCoords?.(drag.castKey, { x: drag.latestX, y: drag.latestY });
        } else {
            stageAdjust?.onCancelDrag?.();
        }
    };

    return (
        <div
            ref={stageContainerRef}
            className={cn("@container relative aspect-video w-full select-none overflow-hidden rounded-md3-lg bg-scrim", className)}
            onClick={onClick}
        >
            {/* Layer 0: Background */}
            <AnimatePresence initial={false}>
                {showBackground && background && (
                    <motion.img
                        key={background}
                        src={background}
                        crossOrigin="anonymous"
                        alt=""
                        draggable={false}
                        onError={() => setFailedBackground(background)}
                        className="absolute inset-0 z-0 size-full object-cover"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: fade }}
                    />
                )}
            </AnimatePresence>

            {/* Layer 1: WebGPU Live2D Stage canvas host */}
            <div ref={hostRef} className="absolute inset-0 z-[1]" />

            {/* Layer 2: Upper-body stand slot portraits ONLY when WebGPU stage cannot run */}
            {showPortraitFallback && state.actors.map((actor, order) => {
                const member = doc.cast.find(item => item.key === actor.cast);
                const isSpeaking = state.speaking === actor.cast;
                const displayName = member?.name || actor.cast;
                const renderOrder = fallbackRenderOrders[actor.cast] ?? order;
                return (
                    <div
                        key={actor.cast}
                        className="pointer-events-none absolute bottom-[27%] flex flex-col items-center gap-1.5 transition-[left,transform,opacity] duration-500 ease-md3-standard"
                        style={{
                            left: `${50 + actor.x * 50}%`,
                            zIndex: 2 + renderOrder,
                            opacity: fallbackOpacity,
                            transformOrigin: "bottom center",
                            transform: `translate(-50%, ${(-actor.y * 35).toFixed(2)}%) scale(${Math.min(1.5, Math.max(0.65, actor.scale)).toFixed(2)})`,
                        }}
                    >
                        <div
                            className={cn(
                                "relative overflow-hidden rounded-md3-xl bg-surface-container/90 p-[0.6cqw] shadow-elev-2 transition-transform duration-200",
                                isSpeaking ? "scale-105 ring-2 ring-primary" : "ring-1 ring-outline-variant/60",
                            )}
                        >
                            {member?.characterId ? (
                                <img
                                    src={getCharacterIconUrl(member.characterId)}
                                    alt=""
                                    draggable={false}
                                    className={cn(
                                        "size-[13cqw] rounded-md3-lg object-cover object-top",
                                        actor.mirror && "-scale-x-100",
                                    )}
                                />
                            ) : (
                                <span className="flex size-[13cqw] items-center justify-center rounded-md3-lg bg-secondary-container type-title-m text-on-secondary-container">
                                    {displayName.slice(0, 1)}
                                </span>
                            )}
                        </div>
                        <span className="max-w-[18cqw] truncate rounded-md3-sm bg-surface-container-high/92 px-2 py-0.5 type-label-s text-on-surface shadow-elev-1">
                            {displayName}
                        </span>
                    </div>
                );
            })}

            {/* Layer 3: Scene ColorFader (lifted during solo/audition preview so model stays unobstructed) */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[8] transition-opacity"
                style={{
                    backgroundColor: SCREEN_COLORS[state.screen.color],
                    opacity: state.screen.covered && !isSoloPreviewActive ? 1 : 0,
                    transitionDuration: `${fade}s`,
                }}
            />

            {/* Layer 4: 1920x1080 virtual in-game scenario UI overlay (suppressed during solo preview) */}
            {!uiHidden && !isSoloPreviewActive && (
                <GameStageOverlay
                    state={state}
                    kit={uiKit}
                    dialogueText={dialogueText}
                    autoPlay={autoPlay}
                    showEndSign={showEndSign}
                    choice={choice}
                    choiceInteractive={choiceInteractive}
                    onChoose={onChoose}
                    onChoiceSound={onChoiceSound}
                    showMenuButton={showMenuButton}
                    menuOpen={menuOpen}
                    onMenuClick={onMenuClick}
                    animateCinemascope={animateCinemascope}
                />
            )}

            {/* Layer 4.5: Edit-mode Interactive Stage Adjust Overlay (5-slot guides + draggable actor pills) */}
            {isStageAdjustActive && (
                <div
                    data-testid="stage-adjust-overlay"
                    className="pointer-events-none absolute inset-0 z-[15] overflow-hidden"
                    onClick={event => event.stopPropagation()}
                >
                    {/* Subtle 5-slot vertical guide lines */}
                    {STORY_SLOTS.map((slot) => {
                        const leftPct = 50 + SLOT_X[slot] * 50;
                        const isCenter = slot === "center";
                        return (
                            <div
                                key={slot}
                                aria-hidden
                                style={{ left: `${leftPct}%` }}
                                className={cn(
                                    "pointer-events-none absolute inset-y-0 -translate-x-1/2 border-l border-dashed",
                                    isCenter ? "border-primary/55" : "border-on-surface/25",
                                )}
                            >
                                <span className="mt-1.5 inline-block -translate-x-1/2 rounded-md3-xs bg-surface-container-high/85 px-1.5 py-0.5 type-label-s text-on-surface-variant shadow-elev-1">
                                    {t(`page.storyMaker.slot.${slot}`)}
                                </span>
                            </div>
                        );
                    })}

                    {/* Draggable actor anchor pills */}
                    {state.actors.map((actor) => {
                        const member = doc.cast.find(item => item.key === actor.cast);
                        const displayName = member?.name || actor.cast;
                        const { leftPct, topPct } = actorCoordsToStagePercent(actor.x, actor.y);
                        const isDragging = draggingCastKey === actor.cast;
                        const isPinned = Boolean(actor.lockX || actor.explicitX !== undefined);
                        const isSelected = stageAdjust?.selectedCastKey === actor.cast;
                        return (
                            <div
                                key={actor.cast}
                                role="slider"
                                tabIndex={0}
                                aria-label={`${displayName} X ${actor.x.toFixed(2)} Y ${actor.y.toFixed(2)}`}
                                aria-valuetext={`X ${actor.x.toFixed(2)}, Y ${actor.y.toFixed(2)}`}
                                data-testid={`stage-adjust-handle-${actor.cast}`}
                                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                                onPointerDown={event => handleAdjustPointerDown(actor.cast, actor.x, actor.y, event)}
                                onPointerMove={handleAdjustPointerMove}
                                onPointerUp={event => handleAdjustPointerFinish(event, true)}
                                onPointerCancel={event => handleAdjustPointerFinish(event, false)}
                                className={cn(
                                    "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center gap-1 rounded-md3-full border px-2.5 py-1 shadow-elev-2 transition-shadow active:cursor-grabbing",
                                    isDragging
                                        ? "z-20 border-primary bg-primary text-on-primary ring-2 ring-primary/45"
                                        : isSelected
                                            ? "z-10 border-primary bg-primary-container/95 text-on-primary-container"
                                            : "border-outline-variant/80 bg-surface-container-high/92 text-on-surface hover:border-primary",
                                )}
                            >
                                <Icon path={mdDragIndicator} size={14} className="shrink-0 opacity-75" />
                                <span className="max-w-24 truncate type-label-m font-medium">{displayName}</span>
                                <span className="shrink-0 font-mono type-label-s tabular-nums opacity-85">
                                    {actor.x >= 0 ? `+${actor.x.toFixed(2)}` : actor.x.toFixed(2)},
                                    {actor.y >= 0 ? `+${actor.y.toFixed(2)}` : actor.y.toFixed(2)}
                                </span>
                                {isPinned && <Icon path={mdLock} size={12} className="shrink-0 opacity-85" />}
                            </div>
                        );
                    })}

                    {/* Non-intrusive helper hint */}
                    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[85%] items-center">
                        <span className="rounded-md3-full glass px-2.5 py-1 type-label-s text-on-surface">
                            {state.actors.length > 0
                                ? t("page.storyMaker.inspector.stageAdjustHint")
                                : t("page.storyMaker.inspector.stageAdjustNoTarget")}
                        </span>
                    </div>
                </div>
            )}

            {/* Layer 5: Transient full-screen flash */}
            <AnimatePresence>
                {flash && !reduced && (
                    <motion.div
                        key={flash.key}
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-20"
                        style={{ backgroundColor: SCREEN_COLORS[flash.color] }}
                        initial={{ opacity: 0.9 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: Math.max(0.15, flash.seconds), ease: [...md3EasingStandard] }}
                    />
                )}
            </AnimatePresence>

            {/* Layer 6a: Non-intrusive Solo/Audition Preview indicator + quick exit */}
            {soloPreview && (
                <div className="pointer-events-none absolute left-2 top-2 z-30 flex max-w-[65%] items-center">
                    <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-md3-full glass px-3 py-1 type-label-m text-on-surface">
                        <span className="size-2 shrink-0 rounded-full bg-tertiary" aria-hidden />
                        <span className="min-w-0 truncate">
                            {t("page.storyMaker.nle.previewingModel", { name: soloPreview.name })}
                        </span>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                soloPreview.onExit();
                            }}
                            aria-label={t("page.storyMaker.nle.exitPreview")}
                            title={t("page.storyMaker.nle.exitPreview")}
                            className="state-layer focus-ring inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md3-full bg-surface-container-highest/80 px-2 py-0.5 type-label-s text-on-surface"
                        >
                            <Icon path={mdClose} size={13} />
                            <span>{t("page.storyMaker.nle.exitPreview")}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Layer 6b: Top-right MoeSekai attribution badge & engine status notes */}
            <StageTopRightOverlay
                phase={phase}
                problems={problems}
                loadingActors={loadingActors}
                loadProgress={loadProgress}
                onRetry={onRetry}
                doc={doc}
                compact={compactStatus}
                offsetForMenu={!uiHidden && showMenuButton}
                showAttribution={renderAttribution}
                onOpenNotices={openNotices}
            />

            {children}
        </div>
    );
}
