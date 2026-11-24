"use client";
import { useEffect, useMemo, useState } from "react";
import { getServerDisplayCode } from "./ServerRegion";
import { Live2DBackgroundGrid } from "../live2d/Live2DBackgroundGrid";
import {
    Banner, Button, Chip, Dialog, Divider, Icon, IconButton, SegmentedButton, Select, Slider, Switch, TextField,
    type SelectOption,
} from "../md3";
import {
    mdAdd, mdAltRoute, mdArrowBack, mdBolt, mdCalculate, mdChat, mdClose, mdContentCopy, mdContentCut,
    mdDelete, mdFlag, mdGroup, mdHourglassTop, mdImage, mdKeyboardArrowDown, mdKeyboardArrowUp, mdLayers,
    mdLink, mdLinkOff, mdLock, mdMovie, mdMusicNote, mdMusicOff, mdNotes, mdNumbers, mdPerson, mdPlayArrow,
    mdPlayArrowFill, mdPlayCircle, mdRecordVoiceOver, mdRemove, mdRestartAlt, mdStopFill, mdSync, mdTitle,
    mdTune, mdVolumeUp, mdWarningFill,
} from "../md3/icons";
import { useStoryI18n as useI18n, useStoryStudio } from "../context/StoryStudioContext";
import type { AssetSourceType } from "@moesekai/story-core";
import { getCharacterIconUrl, type AssetLine } from "@moesekai/story-core";
import type { Live2DModel } from "@moesekai/story-core";
import type { Live2DActorInfo } from "../live2d/stage";
import {
    storyBackgroundUrl, storyBgmUrl, storySeCandidateUrls, storyVoiceCandidateUrls,
} from "@moesekai/story-core";
import {
    addActorToSceneCast, addCastKeyToScene, addChoiceOption, addConditionRule, connectEdge, createSceneBeat,
    defaultConditionForVariable, defaultVarOpForVariable, deferStageCastAfterTelop, disconnectPort, duplicateBeat,
    findLeadingTelopEndIndex, getIncomingEdges, getOutgoingEdge, insertBeat, removeActorFromSceneCast, removeBeat,
    removeChoiceOption, removeConditionRule, replaceBeat, setSceneBackground, setSceneBgm, setScenePlace,
    setSceneStageCast, setSceneTransition, updateActorInSceneCast, updateChoiceOption, updateConditionRule,
    updateNode, updateSceneStageCastSettings,
} from "@moesekai/story-core";
import {
    DEFAULT_STORY_BACKGROUND, DEFAULT_STORY_BGM, DEFAULT_STORY_SE, SLOT_X, STORY_FADE_SECONDS, STORY_LIMITS,
    clampActorX, clampDelay,
} from "@moesekai/story-core";
import { evaluateStageAt } from "@moesekai/story-core";
import {
    CONDITION_OPS, CUE_TYPES, EFFECT_COLORS, SCENE_BEAT_KINDS, STAGE_ACTION_KINDS, STAGE_CAST_ENTER_TIMINGS,
    STAGE_LAYOUT_MODES, STAGE_TRANSITION_STYLES, STORY_SLOTS, TELOP_ACTOR_VISIBILITIES, TELOP_POSITIONS,
    TRANSITION_KINDS, VOICE_KINDS,
    type ActorReaction, type BackgroundSlot, type BgmSlot, type ChoiceNode, type ConditionExpr, type ConditionNode,
    type ConditionOp, type CueBeat, type CueType, type EndNode, type NarrationBeat, type PlaceSlot,
    type SceneActorSlot, type SceneBeat, type SceneBeatKind, type SceneNode, type StageActionBeat,
    type StageActionItem, type StageActionKind, type StageCastEnterTiming, type StageCastSlot, type StageLayoutMode,
    type StageTransitionStyle, type StoryCastMember, type StoryCompileDiagnostic, type StoryDocument,
    type StoryEffectColor, type StoryNode, type StorySlot, type StoryVariable, type StoryVoiceKind,
    type StoryVoiceRef, type TalkBeat, type TelopActorVisibility, type TelopBeat, type TelopPosition,
    type TransitionKind, type VarOp, type VarOpBeat,
} from "@moesekai/story-core";
import { AssetNamePickerDialog } from "./AssetNamePickerDialog";
import { ClipPickerField } from "./ClipPickerField";
import { StoryIssueList } from "./StoryIssueList";
import { previewStorySound, type PreviewSoundOptions } from "./useStoryAudio";
import { VoicePickerDialog } from "./VoicePickerDialog";
import { VoiceTrimControl } from "./VoiceTrimControl";

const VOICE_PLACEHOLDERS: Record<StoryVoiceKind, { scenarioId: string; voiceId: string }> = {
    story: { scenarioId: "event_210_01", voiceId: "voice_ev_night_26_01_01_19" },
    card: { scenarioId: "001001_ichika01", voiceId: "voice_card_01_01a_01_01" },
    area: { scenarioId: "areatalk01_001", voiceId: "area1_001_001" },
    part: { scenarioId: "21miku_light_sound", voiceId: "partvoice_01_021_light_sound" },
};

const BEAT_ICONS: Record<SceneBeatKind, string> = {
    talk: mdChat,
    narration: mdNotes,
    telop: mdTitle,
    stageAction: mdPerson,
    cue: mdBolt,
    varOp: mdNumbers,
};

const TEXTAREA_CLS =
    "w-full rounded-md3-xs border border-outline bg-transparent px-3 py-2 type-body-m text-on-surface " +
    "placeholder:text-on-surface-variant focus:border-2 focus:border-primary focus:outline-none";

const SCALE_PRESETS = [
    { value: 0.85, labelKey: "page.storyMaker.inspector.scalePresetWide" },
    { value: 1.0, labelKey: "page.storyMaker.inspector.scalePresetStandard" },
    { value: 1.15, labelKey: "page.storyMaker.inspector.scalePresetNear" },
    { value: 1.3, labelKey: "page.storyMaker.inspector.scalePresetCloseup" },
] as const;

const PREFERRED_ACTOR_SLOTS: readonly StorySlot[] = ["left", "right", "center", "farLeft", "farRight"];

function formatSignedCoord(value: number): string {
    return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/**
 * Resolves the effective transition style displayed for a scene's `stageCast` (`mode === "set"`),
 * matching `buildStageCastApplyPlan`: explicit `enterTransition` always wins; otherwise defaults
 * to `"fade"` when deferred after telop, delayed, given an explicit duration, or paired with a
 * non-`none` scene transition, and `"instant"` on bare `transition.kind === "none"` scenes.
 */
export function resolveSceneCastEnterTransition(scene: SceneNode): StageTransitionStyle {
    if (scene.stageCast.mode !== "set") return "fade";
    const castSlot = scene.stageCast;
    if (castSlot.enterTransition !== undefined) return castSlot.enterTransition;
    const enterTiming: StageCastEnterTiming = castSlot.enterTiming ?? "immediate";
    const enterDelay = castSlot.enterDelay ?? 0;
    const hasFadeDefault =
        enterTiming === "afterTelop"
        || enterDelay > 0
        || castSlot.enterDuration !== undefined
        || scene.transition.kind !== "none";
    return hasFadeDefault ? "fade" : "instant";
}

/** Patches primary fields of a `StageActionBeat`, preserving explicit `false` flags on `move`/`pose`. */
export function patchStageActionPrimary(
    beat: StageActionBeat,
    patch: Partial<StageActionBeat>,
): StageActionBeat {
    const next: StageActionBeat = { ...beat, ...patch };
    if (next.x === undefined) delete next.x;
    if (next.y === undefined) delete next.y;
    if (next.scale === undefined) delete next.scale;
    if (next.z === undefined) delete next.z;
    if (next.lockX === undefined || (next.action === "enter" && !next.lockX)) delete next.lockX;
    if (next.mirror === undefined || (next.action === "enter" && !next.mirror)) delete next.mirror;
    if (next.allowOverlap === undefined || (next.action === "enter" && !next.allowOverlap)) delete next.allowOverlap;
    if (!next.motion) delete next.motion;
    if (!next.facial) delete next.facial;
    if (next.delay === undefined || next.delay <= 0) delete next.delay;
    if (next.duration === undefined) delete next.duration;
    if (next.transition === undefined) delete next.transition;
    if (!next.parallel) delete next.parallel;
    return next;
}

/** Patches a `StageActionItem` inside `beat.group`, preserving explicit `false` flags on `move`/`pose`. */
export function patchStageActionItem(
    item: StageActionItem,
    patch: Partial<StageActionItem>,
): StageActionItem {
    const next: StageActionItem = { ...item, ...patch };
    if (next.x === undefined) delete next.x;
    if (next.y === undefined) delete next.y;
    if (next.scale === undefined) delete next.scale;
    if (next.z === undefined) delete next.z;
    if (next.lockX === undefined || (next.action === "enter" && !next.lockX)) delete next.lockX;
    if (next.mirror === undefined || (next.action === "enter" && !next.mirror)) delete next.mirror;
    if (next.allowOverlap === undefined || (next.action === "enter" && !next.allowOverlap)) delete next.allowOverlap;
    if (!next.motion) delete next.motion;
    if (!next.facial) delete next.facial;
    if (next.delay === undefined) delete next.delay;
    if (next.duration === undefined) delete next.duration;
    if (next.transition === undefined) delete next.transition;
    return next;
}

/** Switches the primary action kind of a `StageActionBeat`, preserving explicit `false` overrides on `move`/`pose`. */
export function changeStageActionPrimaryKind(
    beat: StageActionBeat,
    action: StageActionKind,
): StageActionBeat {
    const next: StageActionBeat = {
        id: beat.id,
        kind: "stageAction",
        action,
        castKey: beat.castKey,
        ...(beat.delay !== undefined ? { delay: beat.delay } : {}),
        ...(beat.parallel ? { parallel: true } : {}),
        ...(beat.group && beat.group.length > 0 ? { group: beat.group } : {}),
    };
    if (action === "enter" || action === "move") {
        next.slot = beat.slot ?? "center";
        if (beat.x !== undefined) next.x = beat.x;
        if (beat.scale !== undefined) next.scale = beat.scale;
        if (beat.y !== undefined) next.y = beat.y;
        if (action === "move" ? beat.lockX !== undefined : Boolean(beat.lockX)) next.lockX = beat.lockX;
        if (action === "move" ? beat.allowOverlap !== undefined : Boolean(beat.allowOverlap)) {
            next.allowOverlap = beat.allowOverlap;
        }
    }
    if (action === "enter" || action === "move" || action === "exit") {
        if (beat.duration !== undefined) next.duration = beat.duration;
        else if (action === "move") next.duration = 0.5;
    }
    if (action === "enter" || action === "exit") {
        if (beat.transition) next.transition = beat.transition;
    }
    if (action !== "exit") {
        if (beat.z !== undefined) next.z = beat.z;
        if (action === "enter" ? Boolean(beat.mirror) : beat.mirror !== undefined) next.mirror = beat.mirror;
        if (action === "pose" && beat.lockX !== undefined) next.lockX = beat.lockX;
        if (beat.motion) next.motion = beat.motion;
        if (beat.facial) next.facial = beat.facial;
    }
    return next;
}

/** Switches the action kind of a `StageActionItem`, preserving explicit `false` overrides on `move`/`pose`. */
export function changeStageActionItemKind(
    cur: StageActionItem,
    nextAction: StageActionKind,
): StageActionItem {
    const next: StageActionItem = {
        action: nextAction,
        castKey: cur.castKey,
        ...(cur.delay !== undefined ? { delay: cur.delay } : {}),
        ...(cur.duration !== undefined ? { duration: cur.duration } : {}),
    };
    if (nextAction === "enter" || nextAction === "move") {
        next.slot = cur.slot ?? "center";
        if (cur.x !== undefined) next.x = cur.x;
        if (cur.scale !== undefined) next.scale = cur.scale;
        if (cur.y !== undefined) next.y = cur.y;
        if (nextAction === "move" ? cur.lockX !== undefined : Boolean(cur.lockX)) next.lockX = cur.lockX;
        if (nextAction === "move" ? cur.allowOverlap !== undefined : Boolean(cur.allowOverlap)) {
            next.allowOverlap = cur.allowOverlap;
        }
    }
    if (nextAction === "enter" || nextAction === "exit") {
        if (cur.transition) next.transition = cur.transition;
    }
    if (nextAction !== "exit") {
        if (cur.z !== undefined) next.z = cur.z;
        if (nextAction === "enter" ? Boolean(cur.mirror) : cur.mirror !== undefined) next.mirror = cur.mirror;
        if (nextAction === "pose" && cur.lockX !== undefined) next.lockX = cur.lockX;
        if (cur.motion) next.motion = cur.motion;
        if (cur.facial) next.facial = cur.facial;
    }
    return next;
}

export interface NodeInspectorProps {
    doc: StoryDocument;
    selectedNodeId: string | null;
    selectedBeatId: string | null;
    assetSource: AssetSourceType;
    models: readonly Live2DModel[];
    modelInfo: Record<string, Live2DActorInfo>;
    diagnostics: readonly StoryCompileDiagnostic[];
    onDocChange: (updater: (prev: StoryDocument) => StoryDocument) => void;
    onSelectNode: (nodeId: string) => void;
    onSelectBeat: (nodeId: string, beatId: string | null) => void;
    onPreviewClip?: (cast: StoryCastMember, clip: { motion?: string; facial?: string }) => void;
    onPlayFromScene?: (nodeId: string) => void;
    onContinueScene?: (
        sceneId: string,
        options?: {
            preset?: "inherit" | "bgmStop" | "bgmChange" | "bgChange";
            splitAtBeatId?: string;
        },
    ) => void;
    onPreviewEffect?: (cue: { cueType: "flash" | "shake"; color?: StoryEffectColor; duration?: number }) => void;
}

function getNodeLabel(node: StoryNode, t: (key: string) => string): string {
    if (node.type === "start") return t("page.storyMaker.v2.nodeTypes.start");
    return node.title.trim() || t(`page.storyMaker.v2.nodeTypes.${node.type}`);
}

/**
 * Context-sensitive inspector for `moesekai-story/2` graphs: edits `StartNode`, `SceneNode`
 * (5 single-slot stage components + beat quick-add), all 6 `SceneBeat` kinds (with live speaker
 * stage check, co-star reactions, cross-server voice search/trim, and accompanying SE),
 * `ChoiceNode` (options, unlock conditions, var effects), `ConditionNode`, and `EndNode`.
 */
export function NodeInspector({
    doc,
    selectedNodeId,
    selectedBeatId,
    assetSource,
    models,
    modelInfo,
    diagnostics,
    onDocChange,
    onSelectNode,
    onSelectBeat,
    onPreviewClip,
    onPlayFromScene,
    onContinueScene,
    onPreviewEffect,
}: NodeInspectorProps) {
    const { t, resolveLive2dSources } = useStoryStudio();
    const line: AssetLine = assetSource.startsWith("backup") ? "backup" : "main";
    const live2dSources = useMemo(() => resolveLive2dSources(doc.region), [doc.region, resolveLive2dSources]);

    const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] ?? null : null;
    const selectedScene = selectedNode?.type === "scene" ? selectedNode : null;
    const selectedBeatIndex = selectedScene && selectedBeatId
        ? selectedScene.beats.findIndex(b => b.id === selectedBeatId)
        : -1;
    const selectedBeat = selectedScene && selectedBeatIndex >= 0
        ? selectedScene.beats[selectedBeatIndex] ?? null
        : null;

    const selectionKey = `${selectedNodeId ?? ""}|${selectedBeat?.id ?? ""}`;

    const [bgPickerOpen, setBgPickerOpen] = useState(false);
    const [assetPicker, setAssetPicker] = useState<{ kind: "bgm" | "se"; target: "sceneBgm" | "beatSe" } | null>(null);
    const [voicePickerOpen, setVoicePickerOpen] = useState(false);
    const [failedBgUrl, setFailedBgUrl] = useState<string | null>(null);
    const [expandedActorKeys, setExpandedActorKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [fineTuneOpenKeys, setFineTuneOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [actorToAdd, setActorToAdd] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<{ scope: string; key: string } | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [trackedScope, setTrackedScope] = useState(selectionKey);

    if (selectionKey !== trackedScope) {
        setTrackedScope(selectionKey);
        setPreviewing(null);
        setPreviewError(null);
        setVoicePickerOpen(false);
        setAssetPicker(null);
        setBgPickerOpen(false);
        setActorToAdd(null);
    }

    const toggleFineTuneKey = (key: string) => {
        setFineTuneOpenKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleGroupKey = (key: string) => {
        setExpandedGroupKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    useEffect(() => () => previewStorySound(null), [selectionKey]);

    const togglePreview = (
        key: string,
        source: string | readonly string[],
        options?: Pick<PreviewSoundOptions, "volume" | "start" | "end">,
    ) => {
        setPreviewError(null);
        if (previewing?.scope === selectionKey && previewing.key === key) {
            previewStorySound(null);
            setPreviewing(null);
            return;
        }
        const token = { scope: selectionKey, key };
        setPreviewing(token);
        previewStorySound(source, {
            volume: options?.volume,
            start: options?.start,
            end: options?.end,
            onEnd: () => setPreviewing(curr => (curr === token ? null : curr)),
            onError: () => {
                setPreviewing(curr => (curr === token ? null : curr));
                setPreviewError(key);
            },
        });
    };

    const matchingDiagnostics = useMemo(() => {
        if (!selectedNode) return [];
        if (selectedBeat) {
            return diagnostics.filter(d => d.nodeId === selectedNode.id && d.beatId === selectedBeat.id);
        }
        return diagnostics.filter(d => d.nodeId === selectedNode.id);
    }, [diagnostics, selectedNode, selectedBeat]);

    const matchingErrors = useMemo(
        () => matchingDiagnostics.filter(d => d.severity === "error"),
        [matchingDiagnostics],
    );
    const matchingWarnings = useMemo(
        () => matchingDiagnostics.filter(d => d.severity === "warning"),
        [matchingDiagnostics],
    );

    const evaluatedAtSelection = useMemo(() => {
        if (!selectedScene) return null;
        return evaluateStageAt(doc, selectedScene.id, selectedBeat?.id);
    }, [doc, selectedScene, selectedBeat?.id]);

    if (!selectedNode) {
        return (
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-4 py-8 text-center">
                <p className="type-body-m text-on-surface-variant">{t("page.storyMaker.flow.selectNodeHint")}</p>
            </div>
        );
    }

    const castOptions: SelectOption<string>[] = doc.cast.map(member => ({
        value: member.key,
        label: member.name || member.modelId,
        textValue: `${member.name} ${member.modelId}`,
        leading: member.characterId ? (
            <img
                src={getCharacterIconUrl(member.characterId)}
                alt=""
                className="size-6 rounded-full bg-surface-container-highest object-cover"
            />
        ) : undefined,
    }));

    const talkSpeakerOptions: SelectOption<string>[] = [
        { value: "", label: t("page.storyMaker.v2.beats.speakerNone") },
        ...castOptions,
    ];

    const slotOptions = STORY_SLOTS.map(slot => ({
        value: slot,
        label: t(`page.storyMaker.slot.${slot}`),
    }));

    const targetNodeOptions: SelectOption<string>[] = Object.values(doc.nodes)
        .filter(n => n.type !== "start" && n.id !== doc.startNodeId)
        .map(n => ({
            value: n.id,
            label: getNodeLabel(n, t),
            trailing: <span className="font-mono type-label-s text-on-surface-variant">{n.id}</span>,
        }));

    const castMemberOf = (castKey: string | undefined): StoryCastMember | undefined => (
        castKey ? doc.cast.find(item => item.key === castKey) : undefined
    );

    const actorInfoOf = (castKey: string | undefined): Live2DActorInfo | undefined => {
        const member = castMemberOf(castKey);
        return member ? modelInfo[member.modelId] : undefined;
    };

    const motionAssetOf = (castKey: string | undefined): string | null => {
        const member = castMemberOf(castKey);
        if (!member) return null;
        const found = models.find(item => item.id === member.modelId);
        return found?.motion ?? found?.motions[0] ?? null;
    };

    const renderClipPair = (
        castKey: string | undefined,
        motion: string | undefined,
        facial: string | undefined,
        onMotionChange: (next: string | undefined) => void,
        onFacialChange: (next: string | undefined) => void,
        options?: { disabled?: boolean; showReplay?: boolean },
    ) => {
        const disabled = options?.disabled ?? false;
        const targetCast = castMemberOf(castKey);
        const canPreview = Boolean(!disabled && onPreviewClip && targetCast);
        return (
            <div className="min-w-0 space-y-2.5">
                {canPreview && targetCast && (options?.showReplay ?? true) && (motion || facial) && (
                    <div className="flex justify-end">
                        <Button
                            size="xs"
                            variant="tonal"
                            icon={mdPlayArrow}
                            className="shrink-0"
                            onClick={() => onPreviewClip?.(targetCast, {
                                ...(motion ? { motion } : {}),
                                ...(facial ? { facial } : {}),
                            })}
                        >
                            {t("page.storyMaker.nle.replayAction")}
                        </Button>
                    </div>
                )}
                <ClipPickerField
                    kind="motion"
                    value={motion}
                    info={actorInfoOf(castKey)}
                    sources={live2dSources}
                    modelId={targetCast?.modelId ?? null}
                    motionAsset={motionAssetOf(castKey)}
                    disabled={disabled}
                    onChange={onMotionChange}
                    onPreviewClip={canPreview && targetCast ? clipName => onPreviewClip?.(targetCast, { motion: clipName }) : undefined}
                />
                <ClipPickerField
                    kind="facial"
                    value={facial}
                    info={actorInfoOf(castKey)}
                    sources={live2dSources}
                    modelId={targetCast?.modelId ?? null}
                    motionAsset={motionAssetOf(castKey)}
                    disabled={disabled}
                    onChange={onFacialChange}
                    onPreviewClip={canPreview && targetCast ? clipName => onPreviewClip?.(targetCast, { facial: clipName }) : undefined}
                />
            </div>
        );
    };

    const renderDiagnostics = () => {
        if (matchingErrors.length === 0 && matchingWarnings.length === 0) return null;
        return (
            <div className="min-w-0 space-y-2">
                {matchingErrors.length > 0 && (
                    <div className="rounded-md3-md border border-error/35 bg-error-container/50 p-2.5">
                        <StoryIssueList
                            diagnostics={matchingErrors}
                            compact
                            onSelectDiagnostic={(nid, bid) => {
                                if (bid) onSelectBeat(nid, bid);
                                else onSelectNode(nid);
                            }}
                        />
                    </div>
                )}
                {matchingWarnings.length > 0 && (
                    <div className="rounded-md3-md border border-tertiary/35 bg-tertiary-container/50 p-2.5">
                        <StoryIssueList
                            diagnostics={matchingWarnings}
                            compact
                            onSelectDiagnostic={(nid, bid) => {
                                if (bid) onSelectBeat(nid, bid);
                                else onSelectNode(nid);
                            }}
                        />
                    </div>
                )}
            </div>
        );
    };

    const renderSeControls = (
        se: string | undefined,
        seVolume: number | undefined,
        onSeChange: (nextSe: string | undefined, nextVol?: number) => void,
        required: boolean,
    ) => {
        const seCandidates = se ? storySeCandidateUrls(se, doc.region, line) : [];
        const seKey = se ? `se:${doc.region}:${line}:${se}` : "";
        const playingSe = Boolean(seKey) && previewing?.scope === selectionKey && previewing.key === seKey;
        const effectiveVol = seVolume ?? 1;
        return (
            <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <TextField
                        label={t("page.storyMaker.inspector.seName")}
                        value={se ?? ""}
                        maxLength={STORY_LIMITS.audioPath}
                        placeholder={DEFAULT_STORY_SE}
                        onChange={event => {
                            const val = event.target.value.trim();
                            onSeChange(val || undefined, val ? effectiveVol : undefined);
                        }}
                        className="min-w-[8rem] flex-1 font-mono"
                    />
                    <div className="mt-1 flex shrink-0 items-center gap-1">
                        <Button
                            size="s"
                            variant="tonal"
                            icon={mdVolumeUp}
                            onClick={() => setAssetPicker({ kind: "se", target: "beatSe" })}
                        >
                            {t("page.storyMaker.inspector.browse")}
                        </Button>
                        <IconButton
                            size="s"
                            icon={playingSe ? mdStopFill : mdPlayArrowFill}
                            label={t(playingSe ? "page.storyMaker.inspector.stopPreview" : "page.storyMaker.inspector.previewAudio")}
                            disabled={seCandidates.length === 0}
                            onClick={() => seCandidates.length > 0 && togglePreview(seKey, seCandidates, { volume: effectiveVol })}
                        />
                        {!required && se && (
                            <IconButton
                                size="s"
                                icon={mdClose}
                                label={t("common.action.reset")}
                                onClick={() => onSeChange(undefined, undefined)}
                            />
                        )}
                    </div>
                </div>
                {previewError === seKey && seKey && (
                    <p role="alert" className="type-label-s text-error">
                        {t("page.storyMaker.inspector.audioPreviewFailed")}
                    </p>
                )}
                {se && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="type-label-m text-on-surface-variant">{t("page.storyMaker.inspector.volume")}</span>
                            <span className="font-mono type-label-m text-on-surface">{Math.round(effectiveVol * 100)}%</span>
                        </div>
                        <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            value={effectiveVol}
                            onValueChange={val => onSeChange(se, Number(val.toFixed(2)))}
                            aria-label={t("page.storyMaker.inspector.volume")}
                            formatValue={val => `${Math.round(val * 100)}%`}
                        />
                    </div>
                )}
            </div>
        );
    };

    const updateSelectedBeat = (nextBeat: SceneBeat) => {
        if (!selectedScene) return;
        onDocChange(prev => replaceBeat(prev, selectedScene.id, nextBeat.id, nextBeat));
    };

    const handleAddBeat = (kind: SceneBeatKind) => {
        if (!selectedScene) return;
        const created = createSceneBeat(kind, doc);
        onDocChange(prev => insertBeat(prev, selectedScene.id, created));
        onSelectBeat(selectedScene.id, created.id);
    };

    const handleDeleteSelectedBeat = () => {
        if (!selectedScene || !selectedBeat) return;
        const nextBeat = selectedScene.beats[selectedBeatIndex + 1]
            ?? selectedScene.beats[selectedBeatIndex - 1]
            ?? null;
        onDocChange(prev => removeBeat(prev, selectedScene.id, selectedBeat.id));
        onSelectBeat(selectedScene.id, nextBeat?.id ?? null);
    };

    const handleDuplicateSelectedBeat = () => {
        if (!selectedScene || !selectedBeat) return;
        const res = duplicateBeat(doc, selectedScene.id, selectedBeat.id);
        if (!res.beat) return;
        const duplicated = res.beat;
        onDocChange(prev => insertBeat(prev, selectedScene.id, duplicated, selectedBeatIndex + 1));
        onSelectBeat(selectedScene.id, duplicated.id);
    };

    const handleAddSpeakerToStage = (scene: SceneNode, speakerKey: string) => {
        onDocChange((prev) => {
            const currentNode = prev.nodes[scene.id];
            if (!currentNode || currentNode.type !== "scene") return prev;
            if (currentNode.stageCast.mode === "inherit") {
                const evaluatedStage = evaluateStageAt(prev, scene.id).stage;
                const actors: SceneActorSlot[] = evaluatedStage.actors.slice(0, STORY_LIMITS.stageActors).map(actor => ({
                    castKey: actor.cast,
                    slot: actor.slot,
                    ...(actor.explicitX !== undefined ? { x: actor.explicitX } : {}),
                    ...(actor.lockX ? { lockX: true } : {}),
                    ...(actor.mirror ? { mirror: true } : {}),
                    ...(actor.scale !== 1 ? { scale: actor.scale } : {}),
                    ...(actor.y !== 0 ? { y: actor.y } : {}),
                    ...(actor.z !== undefined ? { z: actor.z } : {}),
                    ...(actor.allowOverlap ? { allowOverlap: true } : {}),
                    ...(actor.motion ? { motion: actor.motion } : {}),
                    ...(actor.facial ? { facial: actor.facial } : {}),
                }));
                const withSeed = setSceneStageCast(prev, scene.id, {
                    mode: "set",
                    actors,
                    ...(evaluatedStage.layoutMode !== undefined ? { layoutMode: evaluatedStage.layoutMode } : {}),
                });
                return addCastKeyToScene(withSeed, scene.id, speakerKey);
            }
            return addCastKeyToScene(prev, scene.id, speakerKey);
        });
    };

    const nodesFull = Object.keys(doc.nodes).length >= STORY_LIMITS.nodes;

    return (
        <div className="min-w-0 space-y-4">
            {/* ==================== SCENE BEAT INSPECTOR ==================== */}
            {selectedScene && selectedBeat ? (
                <>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <Button
                            size="xs"
                            variant="tonal"
                            icon={mdArrowBack}
                            onClick={() => onSelectBeat(selectedScene.id, null)}
                            className="min-w-0"
                        >
                            <span className="truncate">
                                {getNodeLabel(selectedScene, t)} · {t("page.storyMaker.v2.slots.sectionTitle")}
                            </span>
                        </Button>
                        <div className="flex shrink-0 items-center gap-0.5">
                            <IconButton
                                size="xs"
                                icon={mdContentCopy}
                                label={t("page.storyMaker.editor.duplicateStep")}
                                onClick={handleDuplicateSelectedBeat}
                            />
                            <IconButton
                                size="xs"
                                icon={mdDelete}
                                label={t("page.storyMaker.editor.deleteStep")}
                                onClick={handleDeleteSelectedBeat}
                            />
                        </div>
                    </div>

                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-secondary-container text-on-secondary-container">
                                <Icon path={BEAT_ICONS[selectedBeat.kind]} size={18} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate type-title-s text-on-surface">
                                    {t(`page.storyMaker.v2.beats.${selectedBeat.kind}`)}
                                </p>
                                <p className="truncate font-mono type-label-s text-on-surface-variant">
                                    #{selectedBeatIndex + 1} / {selectedScene.beats.length} · {selectedBeat.id}
                                </p>
                            </div>
                        </div>
                        {onContinueScene && selectedBeatIndex > 0 && (
                            <Button
                                size="xs"
                                variant="outlined"
                                icon={mdContentCut}
                                disabled={nodesFull}
                                className="shrink-0"
                                onClick={() => onContinueScene(selectedScene.id, {
                                    preset: "inherit",
                                    splitAtBeatId: selectedBeat.id,
                                })}
                            >
                                {t("page.storyMaker.v2.scene.splitFromBeat")}
                            </Button>
                        )}
                    </div>

                    {renderDiagnostics()}
                    <Divider />

                    {selectedBeat.kind === "talk" && (() => {
                        const beat: TalkBeat = selectedBeat;
                        const speakerCast = castMemberOf(beat.speakerKey);
                        const isSpeakerInSceneSet = selectedScene.stageCast.mode === "set"
                            && Boolean(beat.speakerKey)
                            && selectedScene.stageCast.actors.some(a => a.castKey === beat.speakerKey);
                        const isSpeakerOnEffectiveStage = Boolean(
                            beat.speakerKey
                            && evaluatedAtSelection?.stage.actors.some(a => a.cast === beat.speakerKey),
                        );
                        const speakerNotOnStage = Boolean(
                            beat.speakerKey
                            && speakerCast
                            && (
                                (selectedScene.stageCast.mode === "set" && !isSpeakerInSceneSet)
                                || (selectedScene.stageCast.mode !== "set" && !isSpeakerOnEffectiveStage)
                            ),
                        );
                        const stageFull = selectedScene.stageCast.mode === "set"
                            && selectedScene.stageCast.actors.length >= STORY_LIMITS.stageActors;
                        const reactions = beat.reactions ?? [];

                        const patchTalk = (partial: Partial<TalkBeat>) => updateSelectedBeat({ ...beat, ...partial });

                        return (
                            <div className="min-w-0 space-y-4">
                                <Select<string>
                                    label={t("page.storyMaker.v2.beats.speaker")}
                                    value={beat.speakerKey ?? ""}
                                    onValueChange={(value) => {
                                        const next: TalkBeat = { ...beat };
                                        if (value) next.speakerKey = value;
                                        else delete next.speakerKey;
                                        updateSelectedBeat(next);
                                    }}
                                    options={talkSpeakerOptions}
                                />

                                {speakerNotOnStage && beat.speakerKey && (
                                    <div className="space-y-2 rounded-md3-md border border-tertiary/40 bg-tertiary-container/60 p-3 text-on-tertiary-container">
                                        <div className="flex items-start gap-2">
                                            <Icon path={mdWarningFill} size={18} className="mt-0.5 shrink-0 text-tertiary" />
                                            <p className="min-w-0 flex-1 break-words type-body-s">
                                                {t("page.storyMaker.v2.beats.speakerNotOnStage")}
                                            </p>
                                        </div>
                                        <Button
                                            size="xs"
                                            variant="filled"
                                            icon={mdAdd}
                                            disabled={stageFull}
                                            onClick={() => handleAddSpeakerToStage(selectedScene, beat.speakerKey!)}
                                        >
                                            {t("page.storyMaker.v2.beats.addSpeakerToStage")}
                                        </Button>
                                    </div>
                                )}

                                <TextField
                                    label={t("page.storyMaker.inspector.speakerName")}
                                    value={beat.speakerName ?? ""}
                                    maxLength={STORY_LIMITS.speakerName}
                                    placeholder={speakerCast?.name ?? t("page.storyMaker.inspector.speakerNamePlaceholder")}
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        const next: TalkBeat = { ...beat };
                                        if (value) next.speakerName = value;
                                        else delete next.speakerName;
                                        updateSelectedBeat(next);
                                    }}
                                />

                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor={`beat-talk-${beat.id}`} className="type-label-l text-on-surface-variant">
                                            {t("page.storyMaker.inspector.body")}
                                        </label>
                                        <span className="font-mono type-label-s text-on-surface-variant">
                                            {beat.body.length}/{STORY_LIMITS.body}
                                        </span>
                                    </div>
                                    <textarea
                                        id={`beat-talk-${beat.id}`}
                                        rows={4}
                                        maxLength={STORY_LIMITS.body}
                                        value={beat.body}
                                        placeholder={t("page.storyMaker.inspector.bodyPlaceholder")}
                                        onChange={event => patchTalk({ body: event.target.value })}
                                        className={TEXTAREA_CLS}
                                    />
                                    <VariableInsertRow
                                        variables={doc.variables}
                                        onInsert={token => patchTalk({ body: `${beat.body}${token}`.slice(0, STORY_LIMITS.body) })}
                                    />
                                </div>

                                {beat.speakerKey && (
                                    <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                        <p className="type-label-l text-on-surface">
                                            {t("page.storyMaker.v2.beats.speakerPerformance")}
                                        </p>
                                        {renderClipPair(
                                            beat.speakerKey,
                                            beat.motion,
                                            beat.facial,
                                            (motion) => {
                                                const next: TalkBeat = { ...beat };
                                                if (motion) next.motion = motion;
                                                else delete next.motion;
                                                updateSelectedBeat(next);
                                            },
                                            (facial) => {
                                                const next: TalkBeat = { ...beat };
                                                if (facial) next.facial = facial;
                                                else delete next.facial;
                                                updateSelectedBeat(next);
                                            },
                                        )}
                                    </div>
                                )}

                                {/* Co-Star Synchronized Reactions */}
                                <div className="space-y-2.5 rounded-md3-md border border-outline-variant/60 bg-surface-container-low p-3">
                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                        <span className="min-w-0 truncate type-label-l text-on-surface">
                                            {t("page.storyMaker.v2.beats.reactionsTitle")}
                                        </span>
                                        <span className="shrink-0 font-mono type-label-s text-on-surface-variant">
                                            {reactions.length}/{STORY_LIMITS.reactionsPerTalk}
                                        </span>
                                    </div>
                                    {reactions.length === 0 ? (
                                        <p className="type-body-s text-on-surface-variant">
                                            {t("page.storyMaker.v2.beats.noReactions")}
                                        </p>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {reactions.map((reaction, rIdx) => {
                                                const updateReaction = (patch: Partial<ActorReaction>) => {
                                                    const nextList = reactions.map((item, idx) => (
                                                        idx === rIdx ? { ...item, ...patch } : item
                                                    ));
                                                    patchTalk({ reactions: nextList });
                                                };
                                                const removeReaction = () => {
                                                    const nextList = reactions.filter((_, idx) => idx !== rIdx);
                                                    const next: TalkBeat = { ...beat };
                                                    if (nextList.length > 0) next.reactions = nextList;
                                                    else delete next.reactions;
                                                    updateSelectedBeat(next);
                                                };
                                                return (
                                                    <div key={`${reaction.castKey}-${rIdx}`} className="space-y-2.5 rounded-md3-sm bg-surface-container p-2.5">
                                                        <div className="flex items-start gap-1.5">
                                                            <div className="min-w-0 flex-1">
                                                                <Select<string>
                                                                    label={t("page.storyMaker.v2.beats.reactionActor")}
                                                                    value={reaction.castKey || null}
                                                                    onValueChange={castKey => updateReaction({ castKey })}
                                                                    options={castOptions}
                                                                    placeholder={t("page.storyMaker.inspector.selectCast")}
                                                                    noOptionsLabel={t("page.storyMaker.inspector.noCastOptions")}
                                                                />
                                                            </div>
                                                            <IconButton
                                                                size="xs"
                                                                icon={mdDelete}
                                                                label={t("page.storyMaker.cast.remove")}
                                                                onClick={removeReaction}
                                                                className="mt-1 shrink-0"
                                                            />
                                                        </div>
                                                        {renderClipPair(
                                                            reaction.castKey,
                                                            reaction.motion,
                                                            reaction.facial,
                                                            motion => updateReaction({ motion }),
                                                            facial => updateReaction({ facial }),
                                                            { disabled: !reaction.castKey },
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <Button
                                        size="xs"
                                        variant="tonal"
                                        icon={mdAdd}
                                        disabled={reactions.length >= STORY_LIMITS.reactionsPerTalk || doc.cast.length === 0}
                                        onClick={() => {
                                            const used = new Set([beat.speakerKey, ...reactions.map(r => r.castKey)].filter(Boolean));
                                            const pick = doc.cast.find(c => !used.has(c.key)) ?? doc.cast[0];
                                            if (!pick) return;
                                            patchTalk({ reactions: [...reactions, { castKey: pick.key }] });
                                        }}
                                    >
                                        {t("page.storyMaker.v2.beats.addReaction")}
                                    </Button>
                                </div>

                                <Divider />

                                {/* Voice Reference + Story Search + Trim Waveform */}
                                <div className="space-y-3">
                                    <div className="flex min-w-0 items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <Switch
                                                checked={Boolean(beat.voice)}
                                                onCheckedChange={(enabled) => {
                                                    const next: TalkBeat = { ...beat };
                                                    if (enabled) next.voice = { kind: "story", scenarioId: "", voiceId: "" };
                                                    else delete next.voice;
                                                    updateSelectedBeat(next);
                                                }}
                                                label={t("page.storyMaker.inspector.voiceRef")}
                                            />
                                        </div>
                                        {beat.voice?.region && beat.voice.region !== doc.region && (
                                            <span className="mt-0.5 shrink-0 rounded-md3-xs bg-tertiary-container px-1.5 py-0.5 font-mono type-label-s text-on-tertiary-container">
                                                {getServerDisplayCode(beat.voice.region)}
                                            </span>
                                        )}
                                    </div>
                                    {beat.voice && (() => {
                                        const voice = beat.voice;
                                        const placeholders = VOICE_PLACEHOLDERS[voice.kind];
                                        const voiceCandidates = voice.scenarioId && voice.voiceId
                                            ? storyVoiceCandidateUrls(voice, doc.region, line)
                                            : [];
                                        const voiceKey = voiceCandidates.length > 0
                                            ? `voice:${voice.region ?? ""}:${voice.kind}:${voice.scenarioId}:${voice.voiceId}`
                                            : "";
                                        const playingVoice = Boolean(voiceKey) && previewing?.scope === selectionKey && previewing.key === voiceKey;
                                        const updateVoiceClip = (partial: Partial<Pick<StoryVoiceRef, "kind" | "scenarioId" | "voiceId">>) => {
                                            const nextVoice: StoryVoiceRef = {
                                                kind: partial.kind ?? voice.kind,
                                                scenarioId: partial.scenarioId ?? voice.scenarioId,
                                                voiceId: partial.voiceId ?? voice.voiceId,
                                            };
                                            if (voice.region && voice.region !== doc.region) {
                                                nextVoice.region = voice.region;
                                            }
                                            const sameClip =
                                                nextVoice.kind === voice.kind
                                                && nextVoice.scenarioId === voice.scenarioId
                                                && nextVoice.voiceId === voice.voiceId;
                                            if (sameClip) {
                                                if (voice.start !== undefined) nextVoice.start = voice.start;
                                                if (voice.end !== undefined) nextVoice.end = voice.end;
                                            }
                                            patchTalk({ voice: nextVoice });
                                        };
                                        return (
                                            <div className="min-w-0 space-y-3 rounded-md3-md bg-surface-container p-3">
                                                <SegmentedButton<StoryVoiceKind>
                                                    density={-2}
                                                    value={voice.kind}
                                                    onValueChange={kind => updateVoiceClip({ kind })}
                                                    options={VOICE_KINDS.map(kind => ({
                                                        value: kind,
                                                        label: t(`page.storyMaker.voiceKind.${kind}`),
                                                    }))}
                                                    aria-label={t("page.storyMaker.inspector.voiceKind")}
                                                    className="[&>button]:px-1.5"
                                                />
                                                <TextField
                                                    label={t("page.storyMaker.inspector.scenarioId")}
                                                    value={voice.scenarioId}
                                                    maxLength={64}
                                                    placeholder={placeholders.scenarioId}
                                                    className="font-mono"
                                                    onChange={event => updateVoiceClip({ scenarioId: event.target.value.trim() })}
                                                />
                                                <TextField
                                                    label={t("page.storyMaker.inspector.voiceId")}
                                                    value={voice.voiceId}
                                                    maxLength={64}
                                                    placeholder={placeholders.voiceId}
                                                    className="font-mono"
                                                    onChange={event => updateVoiceClip({ voiceId: event.target.value.trim() })}
                                                />
                                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdRecordVoiceOver}
                                                        onClick={() => setVoicePickerOpen(true)}
                                                    >
                                                        {t("page.storyMaker.inspector.browse")}
                                                    </Button>
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={playingVoice ? mdStopFill : mdPlayArrowFill}
                                                        disabled={voiceCandidates.length === 0}
                                                        onClick={() => voiceCandidates.length > 0 && togglePreview(voiceKey, voiceCandidates, {
                                                            start: voice.start,
                                                            end: voice.end,
                                                        })}
                                                    >
                                                        {t(playingVoice ? "page.storyMaker.inspector.stopPreview" : "page.storyMaker.inspector.previewAudio")}
                                                    </Button>
                                                </div>
                                                {previewError === voiceKey && voiceKey && (
                                                    <p role="alert" className="type-label-s text-error">
                                                        {t("page.storyMaker.inspector.audioPreviewFailed")}
                                                    </p>
                                                )}
                                                {voiceCandidates.length > 0 && (
                                                    <VoiceTrimControl
                                                        urls={voiceCandidates}
                                                        start={voice.start}
                                                        end={voice.end}
                                                        onChange={(nextTrim) => {
                                                            const nextVoice: StoryVoiceRef = {
                                                                kind: voice.kind,
                                                                scenarioId: voice.scenarioId,
                                                                voiceId: voice.voiceId,
                                                            };
                                                            if (voice.region && voice.region !== doc.region) {
                                                                nextVoice.region = voice.region;
                                                            }
                                                            if (nextTrim.start !== undefined) nextVoice.start = nextTrim.start;
                                                            if (nextTrim.end !== undefined) nextVoice.end = nextTrim.end;
                                                            patchTalk({ voice: nextVoice });
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                <Divider />

                                {/* Accompanying SE */}
                                <div className="space-y-2">
                                    <p className="type-label-l text-on-surface-variant">
                                        {t("page.storyMaker.v2.beats.accompanyingSe")}
                                    </p>
                                    {renderSeControls(
                                        beat.se,
                                        beat.seVolume,
                                        (nextSe, nextVol) => {
                                            const next: TalkBeat = { ...beat };
                                            if (nextSe) next.se = nextSe;
                                            else delete next.se;
                                            if (nextSe && nextVol !== undefined) next.seVolume = nextVol;
                                            else delete next.seVolume;
                                            updateSelectedBeat(next);
                                        },
                                        false,
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {selectedBeat.kind === "narration" && (() => {
                        const beat: NarrationBeat = selectedBeat;
                        return (
                            <div className="min-w-0 space-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor={`beat-narration-${beat.id}`} className="type-label-l text-on-surface-variant">
                                            {t("page.storyMaker.inspector.narrationText")}
                                        </label>
                                        <span className="font-mono type-label-s text-on-surface-variant">
                                            {beat.body.length}/{STORY_LIMITS.body}
                                        </span>
                                    </div>
                                    <textarea
                                        id={`beat-narration-${beat.id}`}
                                        rows={5}
                                        maxLength={STORY_LIMITS.body}
                                        value={beat.body}
                                        placeholder={t("page.storyMaker.inspector.narrationPlaceholder")}
                                        onChange={event => updateSelectedBeat({ ...beat, body: event.target.value })}
                                        className={TEXTAREA_CLS}
                                    />
                                    <VariableInsertRow
                                        variables={doc.variables}
                                        onInsert={token => updateSelectedBeat({ ...beat, body: `${beat.body}${token}`.slice(0, STORY_LIMITS.body) })}
                                    />
                                </div>
                                <Divider />
                                <div className="space-y-2">
                                    <p className="type-label-l text-on-surface-variant">
                                        {t("page.storyMaker.v2.beats.accompanyingSe")}
                                    </p>
                                    {renderSeControls(
                                        beat.se,
                                        beat.seVolume,
                                        (nextSe, nextVol) => {
                                            const next: NarrationBeat = { ...beat };
                                            if (nextSe) next.se = nextSe;
                                            else delete next.se;
                                            if (nextSe && nextVol !== undefined) next.seVolume = nextVol;
                                            else delete next.seVolume;
                                            updateSelectedBeat(next);
                                        },
                                        false,
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {selectedBeat.kind === "telop" && (() => {
                        const beat: TelopBeat = selectedBeat;
                        const leadingTelopEnd = findLeadingTelopEndIndex(selectedScene.beats);
                        const isLeadingTelop = leadingTelopEnd >= 0 && selectedBeatIndex <= leadingTelopEnd;
                        const showDeferCastHint = Boolean(
                            isLeadingTelop
                            && selectedScene.stageCast.mode === "set"
                            && selectedScene.stageCast.actors.length > 0
                            && selectedScene.stageCast.enterTiming !== "afterTelop",
                        );
                        const actorVisibility: TelopActorVisibility = beat.actorVisibility ?? "keep";
                        const position: TelopPosition = beat.position ?? "center";
                        return (
                            <div className="min-w-0 space-y-4">
                                {showDeferCastHint && (
                                    <div className="space-y-2 rounded-md3-md border border-tertiary/40 bg-tertiary-container/60 p-3 text-on-tertiary-container">
                                        <div className="flex items-start gap-2">
                                            <Icon path={mdWarningFill} size={18} className="mt-0.5 shrink-0 text-tertiary" />
                                            <p className="min-w-0 flex-1 break-words type-body-s">
                                                {t("page.storyMaker.v2.slots.telopOverlapWarning")}
                                            </p>
                                        </div>
                                        <Button
                                            size="xs"
                                            variant="filled"
                                            icon={mdHourglassTop}
                                            onClick={() => onDocChange(prev => deferStageCastAfterTelop(prev, selectedScene.id, true))}
                                        >
                                            {t("page.storyMaker.v2.slots.deferCastAfterTelop")}
                                        </Button>
                                    </div>
                                )}

                                <div className="min-w-0 space-y-3">
                                    <TextField
                                        label={t("page.storyMaker.inspector.telopText")}
                                        value={beat.text}
                                        maxLength={STORY_LIMITS.telop}
                                        placeholder={t("page.storyMaker.inspector.telopPlaceholder")}
                                        onChange={event => updateSelectedBeat({ ...beat, text: event.target.value })}
                                    />
                                    <VariableInsertRow
                                        variables={doc.variables}
                                        onInsert={token => updateSelectedBeat({ ...beat, text: `${beat.text}${token}`.slice(0, STORY_LIMITS.telop) })}
                                    />
                                </div>

                                <div className="space-y-3 rounded-md3-md bg-surface-container p-3">
                                    <div className="space-y-1.5">
                                        <span className="block type-label-m text-on-surface-variant">
                                            {t("page.storyMaker.inspector.telopActorVisibility")}
                                        </span>
                                        <SegmentedButton<TelopActorVisibility>
                                            density={-2}
                                            value={actorVisibility}
                                            onValueChange={(nextVis) => {
                                                const next: TelopBeat = { ...beat };
                                                if (nextVis === "keep") delete next.actorVisibility;
                                                else next.actorVisibility = nextVis;
                                                updateSelectedBeat(next);
                                            }}
                                            options={TELOP_ACTOR_VISIBILITIES.map(vis => ({
                                                value: vis,
                                                label: t(
                                                    vis === "keep"
                                                        ? "page.storyMaker.inspector.telopActorsKeep"
                                                        : vis === "dim"
                                                            ? "page.storyMaker.inspector.telopActorsDim"
                                                            : "page.storyMaker.inspector.telopActorsHide",
                                                ),
                                            }))}
                                            aria-label={t("page.storyMaker.inspector.telopActorVisibility")}
                                            className="[&>button]:px-1.5"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <span className="block type-label-m text-on-surface-variant">
                                            {t("page.storyMaker.inspector.telopPosition")}
                                        </span>
                                        <SegmentedButton<TelopPosition>
                                            density={-2}
                                            value={position}
                                            onValueChange={(nextPos) => {
                                                const next: TelopBeat = { ...beat };
                                                if (nextPos === "center") delete next.position;
                                                else next.position = nextPos;
                                                updateSelectedBeat(next);
                                            }}
                                            options={TELOP_POSITIONS.map(pos => ({
                                                value: pos,
                                                label: t(
                                                    pos === "center"
                                                        ? "page.storyMaker.inspector.telopPosCenter"
                                                        : pos === "top"
                                                            ? "page.storyMaker.inspector.telopPosTop"
                                                            : "page.storyMaker.inspector.telopPosBottom",
                                                ),
                                            }))}
                                            aria-label={t("page.storyMaker.inspector.telopPosition")}
                                            className="[&>button]:px-1.5"
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {selectedBeat.kind === "stageAction" && (() => {
                        const beat: StageActionBeat = selectedBeat;
                        const actionLabelKey = (action: StageActionKind) => {
                            if (action === "enter") return "page.storyMaker.v2.beats.stageActionEnter";
                            if (action === "move") return "page.storyMaker.v2.beats.stageActionMove";
                            if (action === "pose") return "page.storyMaker.v2.beats.stageActionPose";
                            return "page.storyMaker.v2.beats.stageActionExit";
                        };
                        const group = beat.group ?? [];
                        const allActions: StageActionKind[] = [beat.action, ...group.map(item => item.action)];
                        const anyHasDuration = allActions.some(a => a === "enter" || a === "move" || a === "exit");
                        const anyHasTransition = allActions.some(a => a === "enter" || a === "exit");
                        const needsSlot = beat.action === "enter" || beat.action === "move";
                        const supportsClips = beat.action !== "exit";
                        const primaryFineTuneKey = `beat:${beat.id}:primary`;
                        const primaryFineTuneOpen = fineTuneOpenKeys.has(primaryFineTuneKey);
                        const primaryHasFineTune = Boolean(
                            beat.x !== undefined
                            || beat.y !== undefined
                            || beat.scale !== undefined
                            || beat.z !== undefined
                            || beat.lockX !== undefined
                            || beat.mirror !== undefined
                            || beat.allowOverlap !== undefined,
                        );

                        const patchPrimary = (patch: Partial<StageActionBeat>) => {
                            updateSelectedBeat(patchStageActionPrimary(beat, patch));
                        };

                        const updateGroupItem = (gIdx: number, updater: (item: StageActionItem) => StageActionItem) => {
                            const nextGroup = group.map((item, idx) => (idx === gIdx ? updater(item) : item));
                            updateSelectedBeat({ ...beat, group: nextGroup });
                        };

                        const removeGroupItem = (gIdx: number) => {
                            const nextGroup = group.filter((_, idx) => idx !== gIdx);
                            const next: StageActionBeat = { ...beat };
                            if (nextGroup.length > 0) next.group = nextGroup;
                            else delete next.group;
                            updateSelectedBeat(next);
                        };

                        const addGroupItem = () => {
                            if (1 + group.length >= STORY_LIMITS.stageActors || doc.cast.length === 0) return;
                            const usedCast = new Set([beat.castKey, ...group.map(item => item.castKey)].filter(Boolean));
                            const pickCast = doc.cast.find(c => !usedCast.has(c.key)) ?? doc.cast[0];
                            if (!pickCast) return;
                            const usedSlots = new Set<StorySlot>(
                                [beat.slot, ...group.map(item => item.slot)].filter((s): s is StorySlot => Boolean(s)),
                            );
                            const nextAction = beat.action;
                            const pickSlot = PREFERRED_ACTOR_SLOTS.find(s => !usedSlots.has(s)) ?? STORY_SLOTS[0];
                            const created: StageActionItem = {
                                action: nextAction,
                                castKey: pickCast.key,
                                ...(nextAction === "enter" || nextAction === "move" ? { slot: pickSlot } : {}),
                            };
                            const nextGroup = [...group, created];
                            updateSelectedBeat({ ...beat, group: nextGroup });
                            const newKey = `beat:${beat.id}:group:${nextGroup.length - 1}`;
                            setExpandedGroupKeys(prev => new Set([...prev, newKey]));
                        };

                        const effectiveBeatDuration = beat.duration ?? (beat.action === "move" ? 0.5 : STORY_FADE_SECONDS);
                        const effectiveBeatTransition: StageTransitionStyle = beat.transition ?? "fade";

                        return (
                            <div className="min-w-0 space-y-4">
                                {/* Primary Actor Choreography */}
                                <div className="min-w-0 space-y-3 rounded-md3-md border border-outline-variant/60 bg-surface-container p-3">
                                    {group.length > 0 && (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="inline-flex items-center gap-1.5 type-label-l text-on-surface">
                                                <Icon path={mdPerson} size={15} className="text-primary" />
                                                <span>{t("page.storyMaker.v2.beats.primaryActorBadge")}</span>
                                            </span>
                                            <span className="font-mono type-label-s text-on-surface-variant">#1</span>
                                        </div>
                                    )}

                                    <Select<StageActionKind>
                                        label={t("page.storyMaker.v2.beats.stageAction")}
                                        value={beat.action}
                                        onValueChange={(action) => {
                                            updateSelectedBeat(changeStageActionPrimaryKind(beat, action));
                                        }}
                                        options={STAGE_ACTION_KINDS.map(action => ({
                                            value: action,
                                            label: t(actionLabelKey(action)),
                                        }))}
                                    />

                                    <Select<string>
                                        label={t("page.storyMaker.inspector.castMember")}
                                        value={beat.castKey || null}
                                        onValueChange={castKey => patchPrimary({ castKey })}
                                        options={castOptions}
                                        placeholder={t("page.storyMaker.inspector.selectCast")}
                                        noOptionsLabel={t("page.storyMaker.inspector.noCastOptions")}
                                    />

                                    {needsSlot && (
                                        <div className="space-y-2.5">
                                            <div className="space-y-1.5">
                                                <div className="flex min-w-0 items-center justify-between gap-2">
                                                    <span className="min-w-0 truncate type-label-m text-on-surface-variant">
                                                        {t("page.storyMaker.inspector.slot")}
                                                    </span>
                                                    <Button
                                                        size="xs"
                                                        variant={primaryFineTuneOpen || primaryHasFineTune ? "filled" : "tonal"}
                                                        icon={mdTune}
                                                        onClick={() => toggleFineTuneKey(primaryFineTuneKey)}
                                                        className="shrink-0"
                                                    >
                                                        {t("page.storyMaker.inspector.fineTune")}
                                                    </Button>
                                                </div>
                                                <SegmentedButton<StorySlot>
                                                    density={-2}
                                                    value={beat.slot ?? "center"}
                                                    onValueChange={slot => patchPrimary({ slot, x: undefined })}
                                                    options={slotOptions}
                                                    aria-label={t("page.storyMaker.inspector.slot")}
                                                    className="[&>button]:px-1"
                                                />
                                            </div>

                                            {!primaryFineTuneOpen && primaryHasFineTune && (
                                                <div className="flex flex-wrap items-center gap-1">
                                                    {beat.x !== undefined && (
                                                        <span className="rounded-md3-xs bg-primary-container px-1.5 py-0.5 font-mono type-label-s text-on-primary-container">
                                                            X {formatSignedCoord(beat.x)}
                                                        </span>
                                                    )}
                                                    {(beat.lockX || beat.x !== undefined) && (
                                                        <span className="inline-flex items-center gap-0.5 rounded-md3-xs bg-secondary-container px-1.5 py-0.5 type-label-s text-on-secondary-container">
                                                            <Icon path={mdLock} size={11} />
                                                            <span>{t("page.storyMaker.inspector.lockBadge")}</span>
                                                        </span>
                                                    )}
                                                    {beat.mirror && (
                                                        <span className="rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 type-label-s text-on-surface-variant">
                                                            {t("page.storyMaker.inspector.mirrorBadge")}
                                                        </span>
                                                    )}
                                                    {beat.z !== undefined && (
                                                        <span className="rounded-md3-xs bg-secondary-container px-1.5 py-0.5 font-mono type-label-s text-on-secondary-container">
                                                            Z{beat.z > 0 ? `+${beat.z}` : beat.z}
                                                        </span>
                                                    )}
                                                    {beat.allowOverlap && (
                                                        <span className="rounded-md3-xs bg-tertiary-container px-1.5 py-0.5 type-label-s text-on-tertiary-container">
                                                            {t("page.storyMaker.v2.slots.overlapBadge")}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {primaryFineTuneOpen && (
                                                <ActorFramingControls
                                                    mode={beat.action === "move" ? "move" : "enter"}
                                                    slot={beat.slot ?? "center"}
                                                    x={beat.x}
                                                    scale={beat.scale}
                                                    y={beat.y}
                                                    z={beat.z}
                                                    lockX={beat.lockX}
                                                    mirror={beat.mirror}
                                                    allowOverlap={beat.allowOverlap}
                                                    onXChange={x => patchPrimary({ x })}
                                                    onScaleChange={scale => patchPrimary({ scale })}
                                                    onYChange={y => patchPrimary({ y })}
                                                    onZChange={z => patchPrimary({ z })}
                                                    onLockXChange={lockX => patchPrimary({ lockX })}
                                                    onMirrorChange={mirror => patchPrimary({ mirror })}
                                                    onAllowOverlapChange={allowOverlap => patchPrimary({ allowOverlap })}
                                                    onReset={() => patchPrimary({ x: undefined, scale: undefined, y: undefined })}
                                                />
                                            )}
                                        </div>
                                    )}

                                    {!needsSlot && supportsClips && (
                                        <div className="space-y-2.5">
                                            <Switch
                                                checked={Boolean(beat.mirror)}
                                                onCheckedChange={checked => patchPrimary({ mirror: checked })}
                                                label={t("page.storyMaker.inspector.mirror")}
                                            />
                                            <ActorZOrderControl
                                                value={beat.z}
                                                onChange={z => patchPrimary({ z })}
                                            />
                                        </div>
                                    )}

                                    {supportsClips && renderClipPair(
                                        beat.castKey,
                                        beat.motion,
                                        beat.facial,
                                        motion => patchPrimary({ motion }),
                                        facial => patchPrimary({ facial }),
                                        { disabled: !beat.castKey },
                                    )}
                                </div>

                                {/* Beat Timing & Synchronization */}
                                <div className="space-y-3 rounded-md3-md bg-surface-container p-3">
                                    <SecondsSlider
                                        label={t("page.storyMaker.inspector.delaySec")}
                                        value={beat.delay ?? 0}
                                        min={STORY_LIMITS.delayMin}
                                        max={STORY_LIMITS.delayMax}
                                        step={0.1}
                                        decimals={1}
                                        onChange={delay => patchPrimary({ delay: delay > 0 ? clampDelay(delay) : undefined })}
                                    />

                                    {anyHasTransition && (
                                        <div className="space-y-1.5">
                                            <span className="block type-label-m text-on-surface-variant">
                                                {t("page.storyMaker.inspector.transitionStyle")}
                                            </span>
                                            <SegmentedButton<StageTransitionStyle>
                                                density={-2}
                                                value={effectiveBeatTransition}
                                                onValueChange={style => patchPrimary({ transition: style === "fade" ? undefined : style })}
                                                options={STAGE_TRANSITION_STYLES.map(style => ({
                                                    value: style,
                                                    label: t(
                                                        style === "fade"
                                                            ? "page.storyMaker.inspector.transitionFade"
                                                            : "page.storyMaker.inspector.transitionInstant",
                                                    ),
                                                }))}
                                                aria-label={t("page.storyMaker.inspector.transitionStyle")}
                                                className="[&>button]:px-1.5"
                                            />
                                        </div>
                                    )}

                                    {anyHasDuration && (effectiveBeatTransition !== "instant" || allActions.includes("move")) && (
                                        <SecondsSlider
                                            label={t("page.storyMaker.inspector.duration")}
                                            value={effectiveBeatDuration}
                                            min={0}
                                            max={5}
                                            step={0.05}
                                            decimals={2}
                                            onChange={duration => patchPrimary({ duration })}
                                        />
                                    )}

                                    <Switch
                                        checked={Boolean(beat.parallel)}
                                        onCheckedChange={checked => patchPrimary({ parallel: checked || undefined })}
                                        label={t("page.storyMaker.v2.beats.parallelWithNext")}
                                    />
                                </div>

                                {/* Simultaneous Multi-Actor Group (1..5 total actors) */}
                                <div className="space-y-2.5 rounded-md3-md border border-outline-variant/60 bg-surface-container-low p-3">
                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                        <span className="flex min-w-0 items-center gap-1.5 type-label-l text-on-surface">
                                            <Icon path={mdGroup} size={16} className="shrink-0 text-primary" />
                                            <span className="truncate">{t("page.storyMaker.v2.beats.simultaneousGroupTitle")}</span>
                                        </span>
                                        <span className="shrink-0 font-mono type-label-s text-on-surface-variant">
                                            {1 + group.length}/{STORY_LIMITS.stageActors}
                                        </span>
                                    </div>

                                    {group.length > 0 && (
                                        <div className="space-y-2">
                                            {group.map((item, gIdx) => {
                                                const member = castMemberOf(item.castKey);
                                                const displayName = member?.name || item.castKey || t("page.storyMaker.inspector.selectCast");
                                                const groupCardKey = `beat:${beat.id}:group:${gIdx}`;
                                                const groupFineTuneKey = `${groupCardKey}:fineTune`;
                                                const isCardExpanded = expandedGroupKeys.has(groupCardKey);
                                                const isFineTuneOpen = fineTuneOpenKeys.has(groupFineTuneKey);
                                                const itemNeedsSlot = item.action === "enter" || item.action === "move";
                                                const itemSupportsClips = item.action !== "exit";
                                                const itemHasCustom = Boolean(
                                                    item.x !== undefined
                                                    || item.y !== undefined
                                                    || item.scale !== undefined
                                                    || item.z !== undefined
                                                    || item.lockX !== undefined
                                                    || item.mirror !== undefined
                                                    || item.allowOverlap !== undefined,
                                                );
                                                const itemHasTimingOverride = Boolean(
                                                    item.delay !== undefined
                                                    || item.duration !== undefined
                                                    || item.transition !== undefined,
                                                );

                                                const patchItem = (patch: Partial<StageActionItem>) => {
                                                    updateGroupItem(gIdx, cur => patchStageActionItem(cur, patch));
                                                };

                                                return (
                                                    <div
                                                        key={`${item.castKey}-${gIdx}`}
                                                        className="min-w-0 overflow-hidden rounded-md3-sm border border-outline-variant/70 bg-surface-container"
                                                    >
                                                        <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
                                                            <button
                                                                type="button"
                                                                aria-expanded={isCardExpanded}
                                                                onClick={() => toggleGroupKey(groupCardKey)}
                                                                className="state-layer focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md3-xs text-left"
                                                            >
                                                                {member?.characterId ? (
                                                                    <img
                                                                        src={getCharacterIconUrl(member.characterId)}
                                                                        alt=""
                                                                        className="size-6 shrink-0 rounded-full bg-surface-container-highest object-cover"
                                                                    />
                                                                ) : (
                                                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary-container type-label-s text-on-secondary-container">
                                                                        {displayName.slice(0, 1)}
                                                                    </span>
                                                                )}
                                                                <span className="min-w-0 flex-1 truncate type-label-m text-on-surface">
                                                                    {displayName}
                                                                </span>
                                                                <span className="shrink-0 rounded-md3-xs bg-primary-container/80 px-1.5 py-0.5 type-label-s text-on-primary-container">
                                                                    {t(actionLabelKey(item.action))}
                                                                </span>
                                                                {itemNeedsSlot && (
                                                                    <span className="shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 type-label-s text-on-surface-variant">
                                                                        {item.x !== undefined
                                                                            ? `X ${formatSignedCoord(item.x)}`
                                                                            : t(`page.storyMaker.slot.${item.slot ?? "center"}`)}
                                                                    </span>
                                                                )}
                                                                {(item.lockX || item.x !== undefined) && (
                                                                    <Icon path={mdLock} size={13} className="shrink-0 text-secondary" />
                                                                )}
                                                                <Icon
                                                                    path={isCardExpanded ? mdKeyboardArrowUp : mdKeyboardArrowDown}
                                                                    size={16}
                                                                    className="shrink-0 text-on-surface-variant"
                                                                />
                                                            </button>
                                                            {itemNeedsSlot && (
                                                                <IconButton
                                                                    size="xs"
                                                                    variant={isFineTuneOpen || itemHasCustom ? "tonal" : "standard"}
                                                                    icon={mdTune}
                                                                    label={t("page.storyMaker.inspector.fineTune")}
                                                                    onClick={() => {
                                                                        if (!isCardExpanded) {
                                                                            setExpandedGroupKeys(prev => new Set([...prev, groupCardKey]));
                                                                            setFineTuneOpenKeys(prev => new Set([...prev, groupFineTuneKey]));
                                                                        } else {
                                                                            toggleFineTuneKey(groupFineTuneKey);
                                                                        }
                                                                    }}
                                                                />
                                                            )}
                                                            <IconButton
                                                                size="xs"
                                                                icon={mdDelete}
                                                                label={t("page.storyMaker.cast.remove")}
                                                                onClick={() => removeGroupItem(gIdx)}
                                                            />
                                                        </div>

                                                        {isCardExpanded && (
                                                            <div className="space-y-3 border-t border-outline-variant/60 p-2.5">
                                                                <Select<StageActionKind>
                                                                    label={t("page.storyMaker.v2.beats.stageAction")}
                                                                    value={item.action}
                                                                    onValueChange={(nextAction) => {
                                                                        updateGroupItem(gIdx, cur => changeStageActionItemKind(cur, nextAction));
                                                                    }}
                                                                    options={STAGE_ACTION_KINDS.map(action => ({
                                                                        value: action,
                                                                        label: t(actionLabelKey(action)),
                                                                    }))}
                                                                />

                                                                <Select<string>
                                                                    label={t("page.storyMaker.inspector.castMember")}
                                                                    value={item.castKey || null}
                                                                    onValueChange={castKey => patchItem({ castKey })}
                                                                    options={castOptions}
                                                                    placeholder={t("page.storyMaker.inspector.selectCast")}
                                                                    noOptionsLabel={t("page.storyMaker.inspector.noCastOptions")}
                                                                />

                                                                {itemNeedsSlot && (
                                                                    <div className="space-y-2">
                                                                        <div className="space-y-1">
                                                                            <div className="flex min-w-0 items-center justify-between gap-2">
                                                                                <span className="min-w-0 truncate type-label-m text-on-surface-variant">
                                                                                    {t("page.storyMaker.inspector.slot")}
                                                                                </span>
                                                                                <Button
                                                                                    size="xs"
                                                                                    variant={isFineTuneOpen || itemHasCustom ? "filled" : "tonal"}
                                                                                    icon={mdTune}
                                                                                    onClick={() => toggleFineTuneKey(groupFineTuneKey)}
                                                                                    className="shrink-0"
                                                                                >
                                                                                    {t("page.storyMaker.inspector.fineTune")}
                                                                                </Button>
                                                                            </div>
                                                                            <SegmentedButton<StorySlot>
                                                                                density={-2}
                                                                                value={item.slot ?? "center"}
                                                                                onValueChange={slot => patchItem({ slot, x: undefined })}
                                                                                options={slotOptions}
                                                                                aria-label={t("page.storyMaker.inspector.slot")}
                                                                                className="[&>button]:px-1"
                                                                            />
                                                                        </div>

                                                                        {isFineTuneOpen && (
                                                                            <ActorFramingControls
                                                                                mode={item.action === "move" ? "move" : "enter"}
                                                                                slot={item.slot ?? "center"}
                                                                                x={item.x}
                                                                                scale={item.scale}
                                                                                y={item.y}
                                                                                z={item.z}
                                                                                lockX={item.lockX}
                                                                                mirror={item.mirror}
                                                                                allowOverlap={item.allowOverlap}
                                                                                onXChange={x => patchItem({ x })}
                                                                                onScaleChange={scale => patchItem({ scale })}
                                                                                onYChange={y => patchItem({ y })}
                                                                                onZChange={z => patchItem({ z })}
                                                                                onLockXChange={lockX => patchItem({ lockX })}
                                                                                onMirrorChange={mirror => patchItem({ mirror })}
                                                                                onAllowOverlapChange={allowOverlap => patchItem({ allowOverlap })}
                                                                                onReset={() => patchItem({ x: undefined, scale: undefined, y: undefined })}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {!itemNeedsSlot && itemSupportsClips && (
                                                                    <div className="space-y-2">
                                                                        <Switch
                                                                            checked={Boolean(item.mirror)}
                                                                            onCheckedChange={checked => patchItem({ mirror: checked })}
                                                                            label={t("page.storyMaker.inspector.mirror")}
                                                                        />
                                                                        <ActorZOrderControl
                                                                            value={item.z}
                                                                            onChange={z => patchItem({ z })}
                                                                        />
                                                                    </div>
                                                                )}

                                                                {/* Optional Per-Item Delay / Duration Override */}
                                                                <div className="space-y-2 rounded-md3-xs bg-surface-container-low p-2">
                                                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                                                        <span className="truncate type-label-s text-on-surface-variant">
                                                                            {t("page.storyMaker.v2.beats.timingOverride")}
                                                                        </span>
                                                                        {itemHasTimingOverride && (
                                                                            <Button
                                                                                size="xs"
                                                                                variant="text"
                                                                                icon={mdRestartAlt}
                                                                                onClick={() => patchItem({
                                                                                    delay: undefined,
                                                                                    duration: undefined,
                                                                                    transition: undefined,
                                                                                })}
                                                                            >
                                                                                {t("page.storyMaker.v2.beats.inheritBeatTiming")}
                                                                            </Button>
                                                                        )}
                                                                    </div>
                                                                    <SecondsSlider
                                                                        label={t("page.storyMaker.inspector.delaySec")}
                                                                        value={item.delay ?? beat.delay ?? 0}
                                                                        min={STORY_LIMITS.delayMin}
                                                                        max={STORY_LIMITS.delayMax}
                                                                        step={0.1}
                                                                        decimals={1}
                                                                        onChange={delay => patchItem({ delay: clampDelay(delay) })}
                                                                    />
                                                                    {(item.action === "enter" || item.action === "move" || item.action === "exit") && (
                                                                        <SecondsSlider
                                                                            label={t("page.storyMaker.inspector.duration")}
                                                                            value={item.duration ?? effectiveBeatDuration}
                                                                            min={0}
                                                                            max={5}
                                                                            step={0.05}
                                                                            decimals={2}
                                                                            onChange={duration => patchItem({ duration })}
                                                                        />
                                                                    )}
                                                                    {(item.action === "enter" || item.action === "exit") && (
                                                                        <SegmentedButton<StageTransitionStyle>
                                                                            density={-2}
                                                                            value={item.transition ?? effectiveBeatTransition}
                                                                            onValueChange={transition => patchItem({ transition })}
                                                                            options={STAGE_TRANSITION_STYLES.map(style => ({
                                                                                value: style,
                                                                                label: t(
                                                                                    style === "fade"
                                                                                        ? "page.storyMaker.inspector.transitionFade"
                                                                                        : "page.storyMaker.inspector.transitionInstant",
                                                                                ),
                                                                            }))}
                                                                            aria-label={t("page.storyMaker.inspector.transitionStyle")}
                                                                            className="[&>button]:px-1.5"
                                                                        />
                                                                    )}
                                                                </div>

                                                                {itemSupportsClips && renderClipPair(
                                                                    item.castKey,
                                                                    item.motion,
                                                                    item.facial,
                                                                    motion => patchItem({ motion }),
                                                                    facial => patchItem({ facial }),
                                                                    { disabled: !item.castKey },
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <Button
                                        size="xs"
                                        variant="tonal"
                                        icon={mdAdd}
                                        disabled={1 + group.length >= STORY_LIMITS.stageActors || doc.cast.length === 0}
                                        onClick={addGroupItem}
                                    >
                                        {t("page.storyMaker.v2.beats.addSimultaneousActor")}
                                    </Button>
                                </div>
                            </div>
                        );
                    })()}

                    {selectedBeat.kind === "cue" && (() => {
                        const beat: CueBeat = selectedBeat;
                        const cueLabelKey = (cueType: CueType) => {
                            if (cueType === "se") return "page.storyMaker.v2.beats.cueSe";
                            if (cueType === "flash") return "page.storyMaker.v2.beats.cueFlash";
                            if (cueType === "shake") return "page.storyMaker.v2.beats.cueShake";
                            return "page.storyMaker.v2.beats.cueWait";
                        };
                        return (
                            <div className="min-w-0 space-y-4">
                                <Select<CueType>
                                    label={t("page.storyMaker.v2.beats.cue")}
                                    value={beat.cueType}
                                    onValueChange={(cueType) => {
                                        if (cueType === "se") {
                                            updateSelectedBeat({
                                                id: beat.id,
                                                kind: "cue",
                                                cueType: "se",
                                                se: beat.se || DEFAULT_STORY_SE,
                                                seVolume: beat.seVolume ?? 1,
                                            });
                                        } else if (cueType === "flash") {
                                            updateSelectedBeat({
                                                id: beat.id,
                                                kind: "cue",
                                                cueType: "flash",
                                                color: beat.color ?? "white",
                                                duration: beat.duration ?? 0.4,
                                            });
                                        } else {
                                            updateSelectedBeat({
                                                id: beat.id,
                                                kind: "cue",
                                                cueType,
                                                duration: beat.duration ?? (cueType === "wait" ? 0.8 : 0.4),
                                            });
                                        }
                                    }}
                                    options={CUE_TYPES.map(cueType => ({
                                        value: cueType,
                                        label: t(cueLabelKey(cueType)),
                                    }))}
                                />

                                {beat.cueType === "se" && renderSeControls(
                                    beat.se,
                                    beat.seVolume,
                                    (nextSe, nextVol) => {
                                        updateSelectedBeat({
                                            ...beat,
                                            se: nextSe ?? "",
                                            ...(nextVol !== undefined ? { seVolume: nextVol } : {}),
                                        });
                                    },
                                    true,
                                )}

                                {beat.cueType === "flash" && (
                                    <div className="space-y-1.5">
                                        <span className="block type-label-l text-on-surface-variant">
                                            {t("page.storyMaker.inspector.effectColor")}
                                        </span>
                                        <SegmentedButton<StoryEffectColor>
                                            density={-1}
                                            value={beat.color ?? "white"}
                                            onValueChange={color => updateSelectedBeat({ ...beat, color })}
                                            options={EFFECT_COLORS.map(color => ({
                                                value: color,
                                                label: t(`page.storyMaker.color.${color}`),
                                            }))}
                                            aria-label={t("page.storyMaker.inspector.effectColor")}
                                        />
                                    </div>
                                )}

                                {beat.cueType !== "se" && (
                                    <DurationSlider
                                        label={t("page.storyMaker.inspector.duration")}
                                        value={beat.duration ?? 0.4}
                                        onChange={duration => updateSelectedBeat({ ...beat, duration })}
                                    />
                                )}

                                {onPreviewEffect && (beat.cueType === "flash" || beat.cueType === "shake") && (
                                    <Button
                                        size="s"
                                        variant="tonal"
                                        icon={mdPlayArrowFill}
                                        onClick={() => onPreviewEffect({
                                            cueType: beat.cueType === "flash" ? "flash" : "shake",
                                            color: beat.color,
                                            duration: beat.duration,
                                        })}
                                    >
                                        {t("page.storyMaker.inspector.previewEffect")}
                                    </Button>
                                )}
                            </div>
                        );
                    })()}

                    {selectedBeat.kind === "varOp" && (() => {
                        const beat: VarOpBeat = selectedBeat;
                        return (
                            <div className="min-w-0 space-y-3">
                                <VarOpListEditor
                                    variables={doc.variables}
                                    ops={beat.ops}
                                    addLabel={t("page.storyMaker.v2.variables.addEffect")}
                                    onChange={ops => updateSelectedBeat({ ...beat, ops })}
                                />
                            </div>
                        );
                    })()}
                </>
            ) : selectedNode.type === "start" ? (
                /* ==================== START NODE INSPECTOR ==================== */
                <>
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-primary text-on-primary">
                            <Icon path={mdPlayCircle} size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <p className="truncate type-title-s text-on-surface">
                                    {t("page.storyMaker.v2.nodeTypes.start")}
                                </p>
                                <span className="shrink-0 rounded-md3-full bg-primary-container px-2 py-0.5 type-label-s text-on-primary-container">
                                    {t("page.storyMaker.v2.ports.outOnly")}
                                </span>
                            </div>
                            <p className="truncate font-mono type-label-s text-on-surface-variant">{selectedNode.id}</p>
                        </div>
                    </div>

                    {renderDiagnostics()}
                    <Divider />

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="type-label-l text-on-surface-variant">
                                {t("page.storyMaker.v2.ports.outPort")}
                            </span>
                            <WireTargetChip
                                doc={doc}
                                fromNodeId={selectedNode.id}
                                fromPortId="out"
                                onSelectNode={onSelectNode}
                                onDisconnect={() => onDocChange(prev => disconnectPort(prev, selectedNode.id, "out"))}
                            />
                        </div>

                        {(() => {
                            const outEdge = getOutgoingEdge(doc, selectedNode.id, "out");
                            return (
                                <>
                                    {!outEdge && (
                                        <Banner tone="warning">
                                            {t("page.storyMaker.v2.ports.unconnected")} · {t("page.storyMaker.v2.ports.dragToWire")}
                                        </Banner>
                                    )}
                                    {targetNodeOptions.length > 0 && (
                                        <Select<string>
                                            label={t("page.storyMaker.v2.ports.outPort")}
                                            value={outEdge?.toNodeId ?? null}
                                            onValueChange={targetId => onDocChange(prev => connectEdge(prev, selectedNode.id, "out", targetId))}
                                            options={targetNodeOptions}
                                            placeholder={t("page.storyMaker.v2.ports.unconnected")}
                                        />
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </>
            ) : selectedNode.type === "scene" ? (
                /* ==================== SCENE NODE & STAGE SLOTS INSPECTOR ==================== */
                (() => {
                    const scene: SceneNode = selectedNode;
                    const bgAsset = scene.background.mode === "set" ? scene.background.asset : null;
                    const bgPreviewUrl = bgAsset ? storyBackgroundUrl(bgAsset, doc.region, line) : null;
                    const bgFailed = Boolean(bgPreviewUrl) && failedBgUrl === bgPreviewUrl;

                    const bgmName = scene.bgm.mode === "play" ? scene.bgm.name : "";
                    const bgmVol = scene.bgm.mode === "play" ? scene.bgm.volume : 0.75;
                    const bgmUrl = bgmName ? storyBgmUrl(bgmName, doc.region, line) : "";
                    const bgmKey = bgmUrl ? `bgm:${bgmUrl}` : "";
                    const playingBgm = Boolean(bgmKey) && previewing?.scope === selectionKey && previewing.key === bgmKey;

                    const sceneActors = scene.stageCast.mode === "set" ? scene.stageCast.actors : [];
                    const mountedKeys = new Set(sceneActors.map(a => a.castKey));
                    const availableCast = doc.cast.filter(member => !mountedKeys.has(member.key));
                    const availableCastOptions: SelectOption<string>[] = availableCast.map(member => ({
                        value: member.key,
                        label: member.name || member.modelId,
                        leading: member.characterId ? (
                            <img
                                src={getCharacterIconUrl(member.characterId)}
                                alt=""
                                className="size-6 rounded-full bg-surface-container-highest object-cover"
                            />
                        ) : undefined,
                    }));

                    const toggleActorExpanded = (castKey: string) => {
                        setExpandedActorKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(castKey)) next.delete(castKey);
                            else next.add(castKey);
                            return next;
                        });
                    };

                    return (
                        <>
                            <div className="flex min-w-0 items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-primary-container text-on-primary-container">
                                        <Icon path={mdMovie} size={18} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate type-title-s text-on-surface">
                                            {t("page.storyMaker.v2.nodeTypes.scene")}
                                        </p>
                                        <p className="truncate font-mono type-label-s text-on-surface-variant">{scene.id}</p>
                                    </div>
                                </div>
                                {onPlayFromScene && (
                                    <Button
                                        size="xs"
                                        variant="tonal"
                                        icon={mdPlayCircle}
                                        className="shrink-0"
                                        onClick={() => onPlayFromScene(scene.id)}
                                    >
                                        {t("page.storyMaker.v2.ending.playFromScene")}
                                    </Button>
                                )}
                            </div>

                            {renderDiagnostics()}

                            <TextField
                                label={t("page.storyMaker.v2.nodeTypes.scene")}
                                value={scene.title}
                                maxLength={STORY_LIMITS.nodeTitle}
                                placeholder={t("page.storyMaker.v2.nodeTypes.scene")}
                                onChange={event => onDocChange(prev => updateNode<SceneNode>(prev, scene.id, s => ({
                                    ...s,
                                    title: event.target.value,
                                })))}
                            />

                            <div className="flex min-w-0 items-center justify-between gap-2 rounded-md3-md bg-surface-container px-3 py-2">
                                <span className="type-label-m text-on-surface-variant">
                                    {t("page.storyMaker.v2.ports.outPort")}
                                </span>
                                <WireTargetChip
                                    doc={doc}
                                    fromNodeId={scene.id}
                                    fromPortId="out"
                                    onSelectNode={onSelectNode}
                                    onDisconnect={() => onDocChange(prev => disconnectPort(prev, scene.id, "out"))}
                                />
                            </div>

                            {onContinueScene && (
                                <div className="space-y-1.5 rounded-md3-md border border-outline-variant/60 bg-surface-container p-2.5">
                                    <Button
                                        size="xs"
                                        variant="tonal"
                                        icon={mdContentCut}
                                        disabled={nodesFull}
                                        onClick={() => onContinueScene(scene.id, { preset: "inherit" })}
                                        className="w-full justify-center"
                                    >
                                        {t("page.storyMaker.v2.scene.continueAndCut")}
                                    </Button>
                                    <div className="flex flex-wrap gap-1">
                                        <Button
                                            size="xs"
                                            variant="outlined"
                                            icon={mdMusicOff}
                                            disabled={nodesFull}
                                            onClick={() => onContinueScene(scene.id, { preset: "bgmStop" })}
                                        >
                                            {t("page.storyMaker.v2.scene.continueBgmStop")}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="outlined"
                                            icon={mdMusicNote}
                                            disabled={nodesFull}
                                            onClick={() => onContinueScene(scene.id, { preset: "bgmChange" })}
                                        >
                                            {t("page.storyMaker.v2.scene.continueBgmChange")}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="outlined"
                                            icon={mdImage}
                                            disabled={nodesFull}
                                            onClick={() => onContinueScene(scene.id, { preset: "bgChange" })}
                                        >
                                            {t("page.storyMaker.v2.scene.continueBgChange")}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <Divider />

                            {/* Stage Configuration Slots */}
                            <div className="space-y-3">
                                <p className="type-title-s text-on-surface">
                                    {t("page.storyMaker.v2.slots.sectionTitle")}
                                </p>

                                {/* 1. Background Slot */}
                                <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                    <span className="flex items-center gap-1.5 type-label-l text-on-surface">
                                        <Icon path={mdImage} size={16} className="text-primary" />
                                        <span>{t("page.storyMaker.v2.slots.background")}</span>
                                    </span>
                                    <SegmentedButton<BackgroundSlot["mode"]>
                                        density={-2}
                                        value={scene.background.mode}
                                        onValueChange={(mode) => {
                                            const slot: BackgroundSlot = mode === "set"
                                                ? { mode: "set", asset: bgAsset || DEFAULT_STORY_BACKGROUND }
                                                : { mode };
                                            onDocChange(prev => setSceneBackground(prev, scene.id, slot));
                                        }}
                                        options={[
                                            { value: "set", label: t("page.storyMaker.v2.slots.bgSet") },
                                            { value: "inherit", label: t("page.storyMaker.v2.slots.bgInherit") },
                                            { value: "clear", label: t("page.storyMaker.v2.slots.bgClear") },
                                        ]}
                                        aria-label={t("page.storyMaker.v2.slots.background")}
                                        className="[&>button]:px-1.5"
                                    />
                                    {scene.background.mode === "set" && (
                                        <div className="space-y-2">
                                            <div className="overflow-hidden rounded-md3-sm border border-outline-variant bg-surface-container-highest">
                                                {bgPreviewUrl && !bgFailed ? (
                                                    <img
                                                        key={bgPreviewUrl}
                                                        src={bgPreviewUrl}
                                                        alt=""
                                                        onError={() => setFailedBgUrl(bgPreviewUrl)}
                                                        className="aspect-video w-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex aspect-video items-center justify-center px-3 text-center type-body-s text-on-surface-variant">
                                                        {t(bgFailed ? "page.storyMaker.inspector.backgroundPreviewFailed" : "page.storyMaker.summary.noBackground")}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex min-w-0 flex-wrap items-start gap-2">
                                                <TextField
                                                    label={t("page.storyMaker.inspector.assetName")}
                                                    value={scene.background.asset}
                                                    maxLength={64}
                                                    onChange={event => onDocChange(prev => setSceneBackground(prev, scene.id, {
                                                        mode: "set",
                                                        asset: event.target.value.trim(),
                                                    }))}
                                                    className="min-w-[8rem] flex-1 font-mono"
                                                />
                                                <Button
                                                    size="s"
                                                    variant="tonal"
                                                    icon={mdImage}
                                                    onClick={() => setBgPickerOpen(true)}
                                                    className="mt-1 shrink-0"
                                                >
                                                    {t("page.storyMaker.inspector.browse")}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 2. BGM Slot */}
                                <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                    <span className="flex items-center gap-1.5 type-label-l text-on-surface">
                                        <Icon path={mdMusicNote} size={16} className="text-primary" />
                                        <span>{t("page.storyMaker.v2.slots.bgm")}</span>
                                    </span>
                                    <SegmentedButton<BgmSlot["mode"]>
                                        density={-2}
                                        value={scene.bgm.mode}
                                        onValueChange={(mode) => {
                                            const slot: BgmSlot = mode === "play"
                                                ? { mode: "play", name: bgmName || DEFAULT_STORY_BGM, volume: bgmVol }
                                                : { mode };
                                            onDocChange(prev => setSceneBgm(prev, scene.id, slot));
                                        }}
                                        options={[
                                            { value: "play", label: t("page.storyMaker.v2.slots.bgmPlay") },
                                            { value: "inherit", label: t("page.storyMaker.v2.slots.bgmInherit") },
                                            { value: "stop", label: t("page.storyMaker.v2.slots.bgmStop") },
                                        ]}
                                        aria-label={t("page.storyMaker.v2.slots.bgm")}
                                        className="[&>button]:px-1.5"
                                    />
                                    {scene.bgm.mode === "play" && (
                                        <div className="space-y-2.5">
                                            <div className="flex min-w-0 flex-wrap items-start gap-2">
                                                <TextField
                                                    label={t("page.storyMaker.inspector.bgmName")}
                                                    value={scene.bgm.name}
                                                    maxLength={STORY_LIMITS.audioPath}
                                                    placeholder={DEFAULT_STORY_BGM}
                                                    onChange={event => onDocChange(prev => setSceneBgm(prev, scene.id, {
                                                        mode: "play",
                                                        name: event.target.value.trim(),
                                                        volume: bgmVol,
                                                    }))}
                                                    className="min-w-[8rem] flex-1 font-mono"
                                                />
                                                <div className="mt-1 flex shrink-0 items-center gap-1">
                                                    <Button
                                                        size="s"
                                                        variant="tonal"
                                                        icon={mdMusicNote}
                                                        onClick={() => setAssetPicker({ kind: "bgm", target: "sceneBgm" })}
                                                    >
                                                        {t("page.storyMaker.inspector.browse")}
                                                    </Button>
                                                    <IconButton
                                                        size="s"
                                                        icon={playingBgm ? mdStopFill : mdPlayArrowFill}
                                                        label={t(playingBgm ? "page.storyMaker.inspector.stopPreview" : "page.storyMaker.inspector.previewAudio")}
                                                        disabled={!bgmUrl}
                                                        onClick={() => bgmUrl && togglePreview(bgmKey, bgmUrl, { volume: bgmVol })}
                                                    />
                                                </div>
                                            </div>
                                            {previewError === bgmKey && bgmKey && (
                                                <p role="alert" className="type-label-s text-error">
                                                    {t("page.storyMaker.inspector.audioPreviewFailed")}
                                                </p>
                                            )}
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="type-label-m text-on-surface-variant">{t("page.storyMaker.inspector.volume")}</span>
                                                    <span className="font-mono type-label-m text-on-surface">{Math.round(bgmVol * 100)}%</span>
                                                </div>
                                                <Slider
                                                    min={0}
                                                    max={1}
                                                    step={0.05}
                                                    value={bgmVol}
                                                    onValueChange={val => onDocChange(prev => setSceneBgm(prev, scene.id, {
                                                        mode: "play",
                                                        name: bgmName,
                                                        volume: Number(val.toFixed(2)),
                                                    }))}
                                                    aria-label={t("page.storyMaker.inspector.volume")}
                                                    formatValue={val => `${Math.round(val * 100)}%`}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 3. Place Slot */}
                                <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                    <span className="block type-label-l text-on-surface">
                                        {t("page.storyMaker.v2.slots.place")}
                                    </span>
                                    <SegmentedButton<PlaceSlot["mode"]>
                                        density={-2}
                                        value={scene.place.mode}
                                        onValueChange={(mode) => {
                                            const slot: PlaceSlot = mode === "set"
                                                ? { mode: "set", text: scene.place.mode === "set" ? scene.place.text : "" }
                                                : { mode };
                                            onDocChange(prev => setScenePlace(prev, scene.id, slot));
                                        }}
                                        options={[
                                            { value: "set", label: t("page.storyMaker.v2.slots.placeSet") },
                                            { value: "inherit", label: t("page.storyMaker.v2.slots.placeInherit") },
                                            { value: "hide", label: t("page.storyMaker.v2.slots.placeHide") },
                                        ]}
                                        aria-label={t("page.storyMaker.v2.slots.place")}
                                        className="[&>button]:px-1.5"
                                    />
                                    {scene.place.mode === "set" && (
                                        <div className="space-y-2">
                                            <TextField
                                                label={t("page.storyMaker.inspector.placeText")}
                                                value={scene.place.text}
                                                maxLength={STORY_LIMITS.place}
                                                placeholder={t("page.storyMaker.inspector.placePlaceholder")}
                                                onChange={event => onDocChange(prev => setScenePlace(prev, scene.id, {
                                                    mode: "set",
                                                    text: event.target.value,
                                                }))}
                                            />
                                            <VariableInsertRow
                                                variables={doc.variables}
                                                onInsert={token => onDocChange(prev => setScenePlace(prev, scene.id, {
                                                    mode: "set",
                                                    text: `${scene.place.mode === "set" ? scene.place.text : ""}${token}`.slice(0, STORY_LIMITS.place),
                                                }))}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 4. Transition Slot */}
                                <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                    <span className="block type-label-l text-on-surface">
                                        {t("page.storyMaker.v2.slots.transition")}
                                    </span>
                                    <SegmentedButton<TransitionKind>
                                        density={-2}
                                        value={scene.transition.kind}
                                        onValueChange={kind => onDocChange(prev => setSceneTransition(prev, scene.id, {
                                            kind,
                                            duration: scene.transition.duration,
                                        }))}
                                        options={TRANSITION_KINDS.map(kind => ({
                                            value: kind,
                                            label: t(
                                                kind === "none"
                                                    ? "page.storyMaker.v2.slots.transNone"
                                                    : kind === "fadeBlack"
                                                        ? "page.storyMaker.v2.slots.transFadeBlack"
                                                        : "page.storyMaker.v2.slots.transFadeWhite",
                                            ),
                                        }))}
                                        aria-label={t("page.storyMaker.v2.slots.transition")}
                                        className="[&>button]:px-1.5"
                                    />
                                    {scene.transition.kind !== "none" && (
                                        <DurationSlider
                                            label={t("page.storyMaker.v2.slots.durationSec")}
                                            value={scene.transition.duration}
                                            onChange={duration => onDocChange(prev => setSceneTransition(prev, scene.id, {
                                                kind: scene.transition.kind,
                                                duration,
                                            }))}
                                        />
                                    )}
                                </div>

                                {/* 5. Stage Cast Slot (0..5 unique actors) */}
                                <div className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 type-label-l text-on-surface">
                                            <Icon path={mdGroup} size={16} className="text-primary" />
                                            <span>{t("page.storyMaker.v2.slots.stageCast")}</span>
                                        </span>
                                        {scene.stageCast.mode === "set" && (
                                            <span className="font-mono type-label-s text-on-surface-variant">
                                                {sceneActors.length}/{STORY_LIMITS.stageActors}
                                            </span>
                                        )}
                                    </div>
                                    <SegmentedButton<StageCastSlot["mode"]>
                                        density={-2}
                                        value={scene.stageCast.mode}
                                        onValueChange={(mode) => {
                                            const slot: StageCastSlot = mode === "set"
                                                ? (scene.stageCast.mode === "set"
                                                    ? scene.stageCast
                                                    : { mode: "set", actors: sceneActors })
                                                : { mode };
                                            onDocChange(prev => setSceneStageCast(prev, scene.id, slot));
                                        }}
                                        options={[
                                            { value: "set", label: t("page.storyMaker.v2.slots.castSet") },
                                            { value: "inherit", label: t("page.storyMaker.v2.slots.castInherit") },
                                            { value: "clear", label: t("page.storyMaker.v2.slots.castClear") },
                                        ]}
                                        aria-label={t("page.storyMaker.v2.slots.stageCast")}
                                        className="[&>button]:px-1.5"
                                    />

                                    {scene.stageCast.mode === "set" && (() => {
                                        const castSlot = scene.stageCast;
                                        const layoutMode: StageLayoutMode = castSlot.layoutMode ?? "auto";
                                        const enterTiming: StageCastEnterTiming = castSlot.enterTiming ?? "immediate";
                                        const enterTransition: StageTransitionStyle = resolveSceneCastEnterTransition(scene);
                                        const enterDelay = castSlot.enterDelay ?? 0;
                                        const enterDuration = castSlot.enterDuration ?? STORY_FADE_SECONDS;
                                        const showTelopDeferBanner = sceneActors.length > 0
                                            && enterTiming !== "afterTelop"
                                            && findLeadingTelopEndIndex(scene.beats) >= 0;

                                        return (
                                            <div className="space-y-2.5">
                                                {showTelopDeferBanner && (
                                                    <div className="space-y-2 rounded-md3-md border border-tertiary/40 bg-tertiary-container/60 p-2.5 text-on-tertiary-container">
                                                        <div className="flex items-start gap-2">
                                                            <Icon path={mdWarningFill} size={16} className="mt-0.5 shrink-0 text-tertiary" />
                                                            <p className="min-w-0 flex-1 break-words type-body-s">
                                                                {t("page.storyMaker.v2.slots.telopOverlapWarning")}
                                                            </p>
                                                        </div>
                                                        <Button
                                                            size="xs"
                                                            variant="filled"
                                                            icon={mdHourglassTop}
                                                            onClick={() => onDocChange(prev => deferStageCastAfterTelop(prev, scene.id, true))}
                                                        >
                                                            {t("page.storyMaker.v2.slots.deferCastAfterTelop")}
                                                        </Button>
                                                    </div>
                                                )}

                                                {/* Scene-level Layout Mode & Entry Timing Controls */}
                                                <div className="space-y-2.5 rounded-md3-sm border border-outline-variant/60 bg-surface-container-low p-2.5">
                                                    <div className="space-y-1">
                                                        <span className="block type-label-s text-on-surface-variant">
                                                            {t("page.storyMaker.v2.slots.layoutMode")}
                                                        </span>
                                                        <SegmentedButton<StageLayoutMode>
                                                            density={-2}
                                                            value={layoutMode}
                                                            onValueChange={nextMode => onDocChange(prev => updateSceneStageCastSettings(prev, scene.id, {
                                                                layoutMode: nextMode === "auto" ? undefined : nextMode,
                                                            }))}
                                                            options={STAGE_LAYOUT_MODES.map(mode => ({
                                                                value: mode,
                                                                label: t(mode === "auto" ? "page.storyMaker.v2.slots.layoutAuto" : "page.storyMaker.v2.slots.layoutFixed"),
                                                            }))}
                                                            aria-label={t("page.storyMaker.v2.slots.layoutMode")}
                                                            className="[&>button]:px-1.5"
                                                        />
                                                    </div>

                                                    <div className="space-y-1">
                                                        <span className="block type-label-s text-on-surface-variant">
                                                            {t("page.storyMaker.v2.slots.enterTiming")}
                                                        </span>
                                                        <SegmentedButton<StageCastEnterTiming>
                                                            density={-2}
                                                            value={enterTiming}
                                                            onValueChange={nextTiming => onDocChange(prev => updateSceneStageCastSettings(prev, scene.id, {
                                                                enterTiming: nextTiming === "immediate" ? undefined : nextTiming,
                                                            }))}
                                                            options={STAGE_CAST_ENTER_TIMINGS.map(timing => ({
                                                                value: timing,
                                                                label: t(timing === "immediate" ? "page.storyMaker.v2.slots.enterImmediate" : "page.storyMaker.v2.slots.enterAfterTelop"),
                                                            }))}
                                                            aria-label={t("page.storyMaker.v2.slots.enterTiming")}
                                                            className="[&>button]:px-1.5"
                                                        />
                                                    </div>

                                                    <div className="space-y-1">
                                                        <span className="block type-label-s text-on-surface-variant">
                                                            {t("page.storyMaker.inspector.transitionStyle")}
                                                        </span>
                                                        <SegmentedButton<StageTransitionStyle>
                                                            density={-2}
                                                            value={enterTransition}
                                                            onValueChange={nextStyle => onDocChange(prev => updateSceneStageCastSettings(prev, scene.id, {
                                                                enterTransition: nextStyle,
                                                            }))}
                                                            options={STAGE_TRANSITION_STYLES.map(style => ({
                                                                value: style,
                                                                label: t(style === "fade" ? "page.storyMaker.inspector.transitionFade" : "page.storyMaker.inspector.transitionInstant"),
                                                            }))}
                                                            aria-label={t("page.storyMaker.inspector.transitionStyle")}
                                                            className="[&>button]:px-1.5"
                                                        />
                                                    </div>

                                                    <SecondsSlider
                                                        label={t("page.storyMaker.v2.slots.enterDelay")}
                                                        value={enterDelay}
                                                        min={STORY_LIMITS.delayMin}
                                                        max={STORY_LIMITS.delayMax}
                                                        step={0.1}
                                                        decimals={1}
                                                        onChange={val => onDocChange(prev => updateSceneStageCastSettings(prev, scene.id, {
                                                            enterDelay: val > 0 ? clampDelay(val) : undefined,
                                                        }))}
                                                    />

                                                    {enterTransition !== "instant" && (
                                                        <SecondsSlider
                                                            label={t("page.storyMaker.v2.slots.enterDuration")}
                                                            value={enterDuration}
                                                            min={0}
                                                            max={5}
                                                            step={0.05}
                                                            decimals={2}
                                                            onChange={val => onDocChange(prev => updateSceneStageCastSettings(prev, scene.id, {
                                                                enterDuration: val,
                                                            }))}
                                                        />
                                                    )}
                                                </div>

                                                {sceneActors.length >= STORY_LIMITS.stageActors ? (
                                                    <p className="type-label-s text-on-surface-variant">
                                                        {t("page.storyMaker.v2.slots.actorMaxReached")}
                                                    </p>
                                                ) : doc.cast.length === 0 ? (
                                                    <p className="type-body-s text-on-surface-variant">
                                                        {t("page.storyMaker.inspector.noCastOptions")}
                                                    </p>
                                                ) : availableCast.length > 0 ? (
                                                    <div className="flex min-w-0 items-end gap-1.5">
                                                        <div className="min-w-0 flex-1">
                                                            <Select<string>
                                                                label={t("page.storyMaker.v2.slots.addActor")}
                                                                value={actorToAdd && !mountedKeys.has(actorToAdd) ? actorToAdd : availableCast[0]?.key ?? null}
                                                                onValueChange={setActorToAdd}
                                                                options={availableCastOptions}
                                                                placeholder={t("page.storyMaker.inspector.selectCast")}
                                                            />
                                                        </div>
                                                        <Button
                                                            size="s"
                                                            variant="tonal"
                                                            icon={mdAdd}
                                                            className="shrink-0"
                                                            onClick={() => {
                                                                const key = actorToAdd && !mountedKeys.has(actorToAdd)
                                                                    ? actorToAdd
                                                                    : availableCast[0]?.key;
                                                                if (!key) return;
                                                                onDocChange(prev => addCastKeyToScene(prev, scene.id, key));
                                                                setExpandedActorKeys(prev => new Set([...prev, key]));
                                                                setActorToAdd(null);
                                                            }}
                                                        >
                                                            {t("page.storyMaker.v2.slots.addActor")}
                                                        </Button>
                                                    </div>
                                                ) : null}

                                                {sceneActors.length === 0 ? (
                                                    <p className="type-body-s text-on-surface-variant">
                                                        {t("page.storyMaker.v2.slots.emptyCastSlot")}
                                                    </p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {sceneActors.map((actor) => {
                                                            const member = castMemberOf(actor.castKey);
                                                            const expanded = expandedActorKeys.has(actor.castKey);
                                                            const actorFineTuneKey = `scene:${scene.id}:${actor.castKey}`;
                                                            const isFineTuneOpen = fineTuneOpenKeys.has(actorFineTuneKey);
                                                            const hasCustomFraming = Boolean(
                                                                actor.x !== undefined
                                                                || actor.y !== undefined
                                                                || actor.scale !== undefined
                                                                || actor.z !== undefined
                                                                || actor.lockX
                                                                || actor.mirror
                                                                || actor.allowOverlap,
                                                            );
                                                            const displayName = member?.name || actor.castKey;
                                                            const patchActor = (patch: Partial<Omit<SceneActorSlot, "castKey">>) => {
                                                                onDocChange(prev => updateActorInSceneCast(prev, scene.id, actor.castKey, patch));
                                                            };
                                                            return (
                                                                <div
                                                                    key={actor.castKey}
                                                                    className="min-w-0 overflow-hidden rounded-md3-sm border border-outline-variant/70 bg-surface-container-low"
                                                                >
                                                                    <div className="flex min-w-0 items-center gap-1 px-2 py-2">
                                                                        <button
                                                                            type="button"
                                                                            aria-expanded={expanded}
                                                                            onClick={() => toggleActorExpanded(actor.castKey)}
                                                                            className="state-layer focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md3-xs text-left"
                                                                        >
                                                                            {member?.characterId ? (
                                                                                <img
                                                                                    src={getCharacterIconUrl(member.characterId)}
                                                                                    alt=""
                                                                                    className="size-7 shrink-0 rounded-full bg-surface-container-highest object-cover"
                                                                                />
                                                                            ) : (
                                                                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-container type-label-m text-on-secondary-container">
                                                                                    {displayName.slice(0, 1)}
                                                                                </span>
                                                                            )}
                                                                            <span className="min-w-0 flex-1 truncate type-label-l text-on-surface">
                                                                                {displayName}
                                                                            </span>
                                                                            <span className="shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 type-label-s text-on-surface-variant">
                                                                                {actor.x !== undefined
                                                                                    ? `X ${formatSignedCoord(actor.x)}`
                                                                                    : t(`page.storyMaker.slot.${actor.slot}`)}
                                                                            </span>
                                                                            {(actor.lockX || actor.x !== undefined) && (
                                                                                <span
                                                                                    title={t("page.storyMaker.inspector.lockBadge")}
                                                                                    className="inline-flex shrink-0 items-center rounded-md3-xs bg-secondary-container px-1 py-0.5 text-on-secondary-container"
                                                                                >
                                                                                    <Icon path={mdLock} size={12} />
                                                                                </span>
                                                                            )}
                                                                            {actor.mirror && (
                                                                                <span className="shrink-0 rounded-md3-xs bg-surface-container-high px-1 py-0.5 type-label-s text-on-surface-variant">
                                                                                    {t("page.storyMaker.inspector.mirrorBadge")}
                                                                                </span>
                                                                            )}
                                                                            {actor.z !== undefined && (
                                                                                <span className="shrink-0 rounded-md3-xs bg-secondary-container px-1.5 py-0.5 font-mono type-label-s text-on-secondary-container">
                                                                                    Z{actor.z > 0 ? `+${actor.z}` : actor.z}
                                                                                </span>
                                                                            )}
                                                                            {actor.allowOverlap && (
                                                                                <span className="shrink-0 rounded-md3-xs bg-tertiary-container px-1.5 py-0.5 type-label-s text-on-tertiary-container">
                                                                                    {t("page.storyMaker.v2.slots.overlapBadge")}
                                                                                </span>
                                                                            )}
                                                                            <Icon
                                                                                path={expanded ? mdKeyboardArrowUp : mdKeyboardArrowDown}
                                                                                size={18}
                                                                                className="shrink-0 text-on-surface-variant"
                                                                            />
                                                                        </button>
                                                                        <IconButton
                                                                            size="xs"
                                                                            variant={isFineTuneOpen || hasCustomFraming ? "tonal" : "standard"}
                                                                            icon={mdTune}
                                                                            label={t("page.storyMaker.inspector.fineTune")}
                                                                            onClick={() => {
                                                                                if (!expanded) {
                                                                                    setExpandedActorKeys(prev => new Set([...prev, actor.castKey]));
                                                                                    setFineTuneOpenKeys(prev => new Set([...prev, actorFineTuneKey]));
                                                                                } else {
                                                                                    toggleFineTuneKey(actorFineTuneKey);
                                                                                }
                                                                            }}
                                                                        />
                                                                        <IconButton
                                                                            size="xs"
                                                                            icon={mdDelete}
                                                                            label={t("page.storyMaker.cast.remove")}
                                                                            onClick={() => onDocChange(prev => removeActorFromSceneCast(prev, scene.id, actor.castKey))}
                                                                        />
                                                                    </div>

                                                                    {expanded && (
                                                                        <div className="space-y-3 border-t border-outline-variant/60 p-2.5">
                                                                            <div className="space-y-1.5">
                                                                                <div className="flex min-w-0 items-center justify-between gap-2">
                                                                                    <span className="min-w-0 truncate type-label-m text-on-surface-variant">
                                                                                        {t("page.storyMaker.inspector.slot")}
                                                                                    </span>
                                                                                    <Button
                                                                                        size="xs"
                                                                                        variant={isFineTuneOpen || hasCustomFraming ? "filled" : "tonal"}
                                                                                        icon={mdTune}
                                                                                        onClick={() => toggleFineTuneKey(actorFineTuneKey)}
                                                                                        className="shrink-0"
                                                                                    >
                                                                                        {t("page.storyMaker.inspector.fineTune")}
                                                                                    </Button>
                                                                                </div>
                                                                                <SegmentedButton<StorySlot>
                                                                                    density={-2}
                                                                                    value={actor.slot}
                                                                                    onValueChange={slot => patchActor({ slot, x: undefined })}
                                                                                    options={slotOptions}
                                                                                    aria-label={t("page.storyMaker.inspector.slot")}
                                                                                    className="[&>button]:px-1"
                                                                                />
                                                                            </div>

                                                                            {isFineTuneOpen && (
                                                                                <ActorFramingControls
                                                                                    mode="enter"
                                                                                    slot={actor.slot}
                                                                                    x={actor.x}
                                                                                    scale={actor.scale}
                                                                                    y={actor.y}
                                                                                    z={actor.z}
                                                                                    lockX={actor.lockX}
                                                                                    mirror={actor.mirror}
                                                                                    allowOverlap={actor.allowOverlap}
                                                                                    onXChange={x => patchActor({ x })}
                                                                                    onScaleChange={scale => patchActor({ scale })}
                                                                                    onYChange={y => patchActor({ y })}
                                                                                    onZChange={z => patchActor({ z })}
                                                                                    onLockXChange={lockX => patchActor({ lockX })}
                                                                                    onMirrorChange={mirror => patchActor({ mirror })}
                                                                                    onAllowOverlapChange={allowOverlap => patchActor({ allowOverlap })}
                                                                                    onReset={() => onDocChange(prev => addActorToSceneCast(prev, scene.id, {
                                                                                        castKey: actor.castKey,
                                                                                        slot: actor.slot,
                                                                                        ...(actor.z !== undefined ? { z: actor.z } : {}),
                                                                                        ...(actor.lockX ? { lockX: true } : {}),
                                                                                        ...(actor.mirror ? { mirror: true } : {}),
                                                                                        ...(actor.allowOverlap ? { allowOverlap: true } : {}),
                                                                                        ...(actor.motion ? { motion: actor.motion } : {}),
                                                                                        ...(actor.facial ? { facial: actor.facial } : {}),
                                                                                    }))}
                                                                                />
                                                                            )}

                                                                            <div className="space-y-2">
                                                                                <p className="type-label-m text-on-surface-variant">
                                                                                    {t("page.storyMaker.v2.slots.idleMotion")} / {t("page.storyMaker.v2.slots.idleFacial")}
                                                                                </p>
                                                                                {renderClipPair(
                                                                                    actor.castKey,
                                                                                    actor.motion,
                                                                                    actor.facial,
                                                                                    motion => patchActor({ motion }),
                                                                                    facial => patchActor({ facial }),
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <Divider />

                            {/* Quick-Add Performance Beats */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="type-title-s text-on-surface">
                                        {t("page.storyMaker.v2.beats.sectionTitle")}
                                    </p>
                                    <span className="font-mono type-label-s text-on-surface-variant">
                                        {scene.beats.length}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {SCENE_BEAT_KINDS.map(kind => (
                                        <Button
                                            key={kind}
                                            size="xs"
                                            variant="tonal"
                                            icon={BEAT_ICONS[kind]}
                                            onClick={() => handleAddBeat(kind)}
                                        >
                                            {t(`page.storyMaker.v2.beats.${kind}`)}
                                        </Button>
                                    ))}
                                </div>
                                {scene.beats.length === 0 ? (
                                    <p className="type-body-s text-on-surface-variant">
                                        {t("page.storyMaker.v2.beats.emptyBeats")}
                                    </p>
                                ) : (
                                    <ul className="space-y-1">
                                        {scene.beats.map((beat, idx) => (
                                            <li key={beat.id} className="flex min-w-0 items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectBeat(scene.id, beat.id)}
                                                    className="state-layer focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md3-sm bg-surface-container px-2.5 py-1.5 text-left"
                                                >
                                                    <Icon path={BEAT_ICONS[beat.kind]} size={15} className="shrink-0 text-primary" />
                                                    <span className="shrink-0 font-mono type-label-s text-on-surface-variant">
                                                        {idx + 1}.
                                                    </span>
                                                    <span className="min-w-0 flex-1 truncate type-body-s text-on-surface">
                                                        {beat.kind === "talk"
                                                            ? (beat.body || t("page.storyMaker.v2.beats.talk"))
                                                            : beat.kind === "narration"
                                                                ? (beat.body || t("page.storyMaker.v2.beats.narration"))
                                                                : beat.kind === "telop"
                                                                    ? (beat.text || t("page.storyMaker.v2.beats.telop"))
                                                                    : beat.kind === "stageAction" && (beat.group?.length ?? 0) > 0
                                                                        ? `${t("page.storyMaker.v2.beats.stageAction")} (${1 + (beat.group?.length ?? 0)})`
                                                                        : t(`page.storyMaker.v2.beats.${beat.kind}`)}
                                                    </span>
                                                    {beat.kind === "stageAction" && beat.parallel && (
                                                        <Icon path={mdSync} size={13} className="shrink-0 text-tertiary" />
                                                    )}
                                                </button>
                                                {onContinueScene && idx > 0 && (
                                                    <IconButton
                                                        size="xs"
                                                        icon={mdContentCut}
                                                        label={t("page.storyMaker.v2.scene.splitFromBeat")}
                                                        title={t("page.storyMaker.v2.scene.splitFromBeat")}
                                                        disabled={nodesFull}
                                                        onClick={() => onContinueScene(scene.id, {
                                                            preset: "inherit",
                                                            splitAtBeatId: beat.id,
                                                        })}
                                                    />
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </>
                    );
                })()
            ) : selectedNode.type === "choice" ? (
                /* ==================== CHOICE NODE INSPECTOR ==================== */
                (() => {
                    const choice: ChoiceNode = selectedNode;
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-secondary-container text-on-secondary-container">
                                    <Icon path={mdAltRoute} size={18} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate type-title-s text-on-surface">
                                        {t("page.storyMaker.v2.nodeTypes.choice")}
                                    </p>
                                    <p className="truncate font-mono type-label-s text-on-surface-variant">{choice.id}</p>
                                </div>
                            </div>

                            {renderDiagnostics()}

                            <TextField
                                label={t("page.storyMaker.v2.nodeTypes.choice")}
                                value={choice.title}
                                maxLength={STORY_LIMITS.nodeTitle}
                                onChange={event => onDocChange(prev => updateNode<ChoiceNode>(prev, choice.id, n => ({
                                    ...n,
                                    title: event.target.value,
                                })))}
                            />

                            <Divider />

                            <div className="space-y-3">
                                {choice.options.map((option, idx) => (
                                    <div key={option.id} className="space-y-3 rounded-md3-md bg-surface-container p-3">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <span className="type-label-l text-on-surface">
                                                {t("page.storyMaker.inspector.choiceOption", { number: idx + 1 })}
                                            </span>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <WireTargetChip
                                                    doc={doc}
                                                    fromNodeId={choice.id}
                                                    fromPortId={option.id}
                                                    onSelectNode={onSelectNode}
                                                    onDisconnect={() => onDocChange(prev => disconnectPort(prev, choice.id, option.id))}
                                                />
                                                <IconButton
                                                    size="xs"
                                                    icon={mdDelete}
                                                    label={t("page.storyMaker.inspector.removeOption")}
                                                    disabled={choice.options.length <= STORY_LIMITS.choiceOptions.min}
                                                    onClick={() => onDocChange(prev => removeChoiceOption(prev, choice.id, option.id))}
                                                />
                                            </div>
                                        </div>

                                        <TextField
                                            label={t("page.storyMaker.inspector.choiceText")}
                                            value={option.text}
                                            maxLength={STORY_LIMITS.choiceText}
                                            onChange={event => onDocChange(prev => updateChoiceOption(prev, choice.id, option.id, {
                                                text: event.target.value,
                                            }))}
                                        />

                                        {/* Optional Prerequisite Condition */}
                                        <div className="space-y-2 rounded-md3-sm border border-outline-variant/60 bg-surface-container-low p-2.5">
                                            <Switch
                                                checked={Boolean(option.condition)}
                                                disabled={!option.condition && doc.variables.length === 0}
                                                onCheckedChange={(enabled) => {
                                                    if (enabled) {
                                                        const firstVar = doc.variables[0];
                                                        if (!firstVar) return;
                                                        onDocChange(prev => updateChoiceOption(prev, choice.id, option.id, {
                                                            condition: defaultConditionForVariable(firstVar),
                                                        }));
                                                    } else {
                                                        onDocChange(prev => updateChoiceOption(prev, choice.id, option.id, {
                                                            condition: undefined,
                                                        }));
                                                    }
                                                }}
                                                label={t("page.storyMaker.v2.variables.optionCondition")}
                                            />
                                            {!option.condition && doc.variables.length === 0 && (
                                                <p className="type-label-s text-on-surface-variant">
                                                    {t("page.storyMaker.v2.variables.noVariablesYet")}
                                                </p>
                                            )}
                                            {option.condition && (
                                                <ConditionExprEditor
                                                    variables={doc.variables}
                                                    expr={option.condition}
                                                    onChange={expr => onDocChange(prev => updateChoiceOption(prev, choice.id, option.id, {
                                                        condition: expr,
                                                    }))}
                                                />
                                            )}
                                        </div>

                                        {/* Optional On-Select Variable Effects */}
                                        <div className="space-y-2 rounded-md3-sm border border-outline-variant/60 bg-surface-container-low p-2.5">
                                            <p className="type-label-m text-on-surface-variant">
                                                {t("page.storyMaker.v2.variables.optionEffects")}
                                            </p>
                                            <VarOpListEditor
                                                variables={doc.variables}
                                                ops={option.effects ?? []}
                                                addLabel={t("page.storyMaker.v2.variables.addEffect")}
                                                compactEmpty
                                                onChange={effects => onDocChange(prev => updateChoiceOption(prev, choice.id, option.id, {
                                                    effects: effects.length > 0 ? effects : undefined,
                                                }))}
                                            />
                                        </div>
                                    </div>
                                ))}

                                <Button
                                    size="s"
                                    variant="tonal"
                                    icon={mdAdd}
                                    disabled={choice.options.length >= STORY_LIMITS.choiceOptions.max}
                                    onClick={() => onDocChange(prev => addChoiceOption(prev, choice.id, ""))}
                                >
                                    {t("page.storyMaker.inspector.addOption")}
                                </Button>
                            </div>
                        </>
                    );
                })()
            ) : selectedNode.type === "condition" ? (
                /* ==================== CONDITION NODE INSPECTOR ==================== */
                (() => {
                    const cond: ConditionNode = selectedNode;
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-tertiary-container text-on-tertiary-container">
                                    <Icon path={mdCalculate} size={18} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate type-title-s text-on-surface">
                                        {t("page.storyMaker.v2.nodeTypes.condition")}
                                    </p>
                                    <p className="truncate font-mono type-label-s text-on-surface-variant">{cond.id}</p>
                                </div>
                            </div>

                            {renderDiagnostics()}

                            <TextField
                                label={t("page.storyMaker.v2.nodeTypes.condition")}
                                value={cond.title}
                                maxLength={STORY_LIMITS.nodeTitle}
                                onChange={event => onDocChange(prev => updateNode<ConditionNode>(prev, cond.id, n => ({
                                    ...n,
                                    title: event.target.value,
                                })))}
                            />

                            <Divider />

                            <div className="space-y-3">
                                <p className="type-label-l text-on-surface-variant">
                                    {t("page.storyMaker.v2.variables.condTitle")}
                                </p>

                                {doc.variables.length === 0 && (
                                    <Banner tone="info">{t("page.storyMaker.v2.variables.noVariablesYet")}</Banner>
                                )}

                                {cond.rules.length === 0 ? (
                                    <p className="type-body-s text-on-surface-variant">
                                        {t("page.storyMaker.v2.variables.noRules")}
                                    </p>
                                ) : (
                                    <div className="space-y-2.5">
                                        {cond.rules.map((rule, idx) => (
                                            <div key={rule.id} className="space-y-2.5 rounded-md3-md bg-surface-container p-3">
                                                <div className="flex min-w-0 items-center justify-between gap-2">
                                                    <span className="font-mono type-label-m text-on-surface-variant">
                                                        #{idx + 1} · {rule.id}
                                                    </span>
                                                    <div className="flex shrink-0 items-center gap-1">
                                                        <WireTargetChip
                                                            doc={doc}
                                                            fromNodeId={cond.id}
                                                            fromPortId={rule.id}
                                                            onSelectNode={onSelectNode}
                                                            onDisconnect={() => onDocChange(prev => disconnectPort(prev, cond.id, rule.id))}
                                                        />
                                                        <IconButton
                                                            size="xs"
                                                            icon={mdDelete}
                                                            label={t("page.storyMaker.landing.delete")}
                                                            onClick={() => onDocChange(prev => removeConditionRule(prev, cond.id, rule.id))}
                                                        />
                                                    </div>
                                                </div>
                                                <TextField
                                                    label={t("page.storyMaker.v2.variables.ruleLabel")}
                                                    value={rule.label ?? ""}
                                                    maxLength={STORY_LIMITS.ruleLabel}
                                                    onChange={event => onDocChange(prev => updateConditionRule(prev, cond.id, rule.id, {
                                                        label: event.target.value || undefined,
                                                    }))}
                                                />
                                                <ConditionExprEditor
                                                    variables={doc.variables}
                                                    expr={rule.expr}
                                                    onChange={expr => onDocChange(prev => updateConditionRule(prev, cond.id, rule.id, {
                                                        expr,
                                                    }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <Button
                                    size="s"
                                    variant="tonal"
                                    icon={mdAdd}
                                    disabled={doc.variables.length === 0 || cond.rules.length >= STORY_LIMITS.conditionRules}
                                    onClick={() => onDocChange(prev => addConditionRule(prev, cond.id))}
                                >
                                    {t("page.storyMaker.v2.variables.addRule")}
                                </Button>

                                {/* Mandatory Else Fallback Port */}
                                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md3-md border border-outline-variant/70 bg-surface-container-low px-3 py-2.5">
                                    <span className="type-label-l text-on-surface">
                                        {t("page.storyMaker.v2.variables.elseBranch")}
                                    </span>
                                    <WireTargetChip
                                        doc={doc}
                                        fromNodeId={cond.id}
                                        fromPortId="else"
                                        onSelectNode={onSelectNode}
                                        onDisconnect={() => onDocChange(prev => disconnectPort(prev, cond.id, "else"))}
                                    />
                                </div>
                            </div>
                        </>
                    );
                })()
            ) : (
                /* ==================== END NODE INSPECTOR ==================== */
                (() => {
                    const end: EndNode = selectedNode;
                    const incoming = getIncomingEdges(doc, end.id);
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md3-sm bg-tertiary-container text-on-tertiary-container">
                                    <Icon path={mdFlag} size={18} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="truncate type-title-s text-on-surface">
                                            {t("page.storyMaker.v2.nodeTypes.end")}
                                        </p>
                                        <span className="shrink-0 rounded-md3-full bg-secondary-container px-2 py-0.5 type-label-s text-on-secondary-container">
                                            {t("page.storyMaker.v2.ports.inOnly")}
                                        </span>
                                    </div>
                                    <p className="truncate font-mono type-label-s text-on-surface-variant">{end.id}</p>
                                </div>
                            </div>

                            {renderDiagnostics()}
                            <Divider />

                            <div className="space-y-4">
                                <TextField
                                    label={t("page.storyMaker.v2.ending.titleLabel")}
                                    value={end.title}
                                    maxLength={STORY_LIMITS.nodeTitle}
                                    onChange={event => onDocChange(prev => updateNode<EndNode>(prev, end.id, n => ({
                                        ...n,
                                        title: event.target.value,
                                    })))}
                                />
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor={`end-subtitle-${end.id}`} className="type-label-l text-on-surface-variant">
                                            {t("page.storyMaker.v2.ending.subtitleLabel")}
                                        </label>
                                        <span className="font-mono type-label-s text-on-surface-variant">
                                            {(end.subtitle ?? "").length}/{STORY_LIMITS.endSubtitle}
                                        </span>
                                    </div>
                                    <textarea
                                        id={`end-subtitle-${end.id}`}
                                        rows={3}
                                        maxLength={STORY_LIMITS.endSubtitle}
                                        value={end.subtitle ?? ""}
                                        onChange={event => onDocChange(prev => updateNode<EndNode>(prev, end.id, n => ({
                                            ...n,
                                            subtitle: event.target.value,
                                        })))}
                                        className={TEXTAREA_CLS}
                                    />
                                    <VariableInsertRow
                                        variables={doc.variables}
                                        onInsert={token => onDocChange(prev => updateNode<EndNode>(prev, end.id, n => ({
                                            ...n,
                                            subtitle: `${n.subtitle ?? ""}${token}`.slice(0, STORY_LIMITS.endSubtitle),
                                        })))}
                                    />
                                </div>

                                <div className="space-y-2 rounded-md3-md bg-surface-container p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="type-label-l text-on-surface-variant">
                                            {t("page.storyMaker.v2.ports.inPort")}
                                        </span>
                                        <span className="rounded-md3-full bg-surface-container-high px-2 py-0.5 font-mono type-label-s text-on-surface">
                                            {incoming.length}
                                        </span>
                                    </div>
                                    {incoming.length === 0 ? (
                                        <p className="type-body-s text-on-surface-variant">
                                            {t("page.storyMaker.v2.ports.unconnected")}
                                        </p>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {incoming.map((edge) => {
                                                const src = doc.nodes[edge.fromNodeId];
                                                if (!src) return null;
                                                return (
                                                    <Chip
                                                        key={edge.id}
                                                        variant="assist"
                                                        icon={mdLink}
                                                        onClick={() => onSelectNode(src.id)}
                                                    >
                                                        {getNodeLabel(src, t)}
                                                    </Chip>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    );
                })()
            )}

            {/* ==================== PICKER DIALOGS ==================== */}
            {selectedScene && bgPickerOpen && (
                <Dialog
                    isOpen
                    onClose={() => setBgPickerOpen(false)}
                    title={t("page.storyMaker.inspector.pickBackground")}
                    size="lg"
                    fullscreenOnMobile
                >
                    <Live2DBackgroundGrid
                        key={`${doc.region}|${line}`}
                        region={doc.region}
                        line={line}
                        current={selectedScene.background.mode === "set" ? selectedScene.background.asset : null}
                        defaultCategory="scene"
                        onSelect={(name) => {
                            onDocChange(prev => setSceneBackground(
                                prev,
                                selectedScene.id,
                                name ? { mode: "set", asset: name } : { mode: "clear" },
                            ));
                            setBgPickerOpen(false);
                        }}
                    />
                </Dialog>
            )}

            {assetPicker && selectedScene && (
                <AssetNamePickerDialog
                    isOpen
                    onClose={() => setAssetPicker(null)}
                    kind={assetPicker.kind}
                    region={doc.region}
                    line={line}
                    current={
                        assetPicker.target === "sceneBgm"
                            ? (selectedScene.bgm.mode === "play" ? selectedScene.bgm.name : "")
                            : selectedBeat && (selectedBeat.kind === "talk" || selectedBeat.kind === "narration" || selectedBeat.kind === "cue")
                                ? (selectedBeat.se ?? "")
                                : ""
                    }
                    onSelect={(name) => {
                        if (assetPicker.target === "sceneBgm") {
                            const vol = selectedScene.bgm.mode === "play" ? selectedScene.bgm.volume : 0.75;
                            onDocChange(prev => setSceneBgm(prev, selectedScene.id, { mode: "play", name, volume: vol }));
                        } else if (selectedBeat) {
                            if (selectedBeat.kind === "talk" || selectedBeat.kind === "narration") {
                                updateSelectedBeat({ ...selectedBeat, se: name, seVolume: selectedBeat.seVolume ?? 1 });
                            } else if (selectedBeat.kind === "cue" && selectedBeat.cueType === "se") {
                                updateSelectedBeat({ ...selectedBeat, se: name, seVolume: selectedBeat.seVolume ?? 1 });
                            }
                        }
                    }}
                />
            )}

            {voicePickerOpen && selectedScene && selectedBeat?.kind === "talk" && selectedBeat.voice && (
                <VoicePickerDialog
                    key={`${selectedBeat.id}|${selectedBeat.voice.kind}|${doc.region}|${line}`}
                    isOpen
                    onClose={() => setVoicePickerOpen(false)}
                    kind={selectedBeat.voice.kind}
                    region={doc.region}
                    line={line}
                    currentScenarioId={selectedBeat.voice.scenarioId}
                    currentVoiceId={selectedBeat.voice.voiceId}
                    onSelect={(selectedVoice, suggestedText) => {
                        const prev = selectedBeat.voice;
                        const prevRegion = prev?.region ?? doc.region;
                        const nextRegion = selectedVoice.region ?? doc.region;
                        const sameClip = Boolean(
                            prev
                            && prev.kind === selectedVoice.kind
                            && prev.scenarioId === selectedVoice.scenarioId
                            && prev.voiceId === selectedVoice.voiceId
                            && prevRegion === nextRegion,
                        );
                        const nextVoice: StoryVoiceRef = {
                            kind: selectedVoice.kind,
                            scenarioId: selectedVoice.scenarioId,
                            voiceId: selectedVoice.voiceId,
                        };
                        if (selectedVoice.region && selectedVoice.region !== doc.region) {
                            nextVoice.region = selectedVoice.region;
                        }
                        if (sameClip && prev) {
                            if (prev.start !== undefined) nextVoice.start = prev.start;
                            if (prev.end !== undefined) nextVoice.end = prev.end;
                        }
                        const nextBeat: TalkBeat = { ...selectedBeat, voice: nextVoice };
                        if (suggestedText !== undefined) {
                            nextBeat.body = suggestedText.slice(0, STORY_LIMITS.body);
                        }
                        updateSelectedBeat(nextBeat);
                    }}
                />
            )}
        </div>
    );
}

// ==================== Shared Inspector Subcomponents ====================

function WireTargetChip({
    doc,
    fromNodeId,
    fromPortId,
    onSelectNode,
    onDisconnect,
}: {
    doc: StoryDocument;
    fromNodeId: string;
    fromPortId: string;
    onSelectNode: (nodeId: string) => void;
    onDisconnect?: () => void;
}) {
    const { t } = useI18n();
    const edge = getOutgoingEdge(doc, fromNodeId, fromPortId);
    const target = edge ? doc.nodes[edge.toNodeId] : undefined;

    if (!target) {
        return (
            <span className="inline-flex max-w-full items-center rounded-md3-full bg-surface-container-high px-2.5 py-0.5 type-label-s text-on-surface-variant">
                {t("page.storyMaker.v2.ports.unconnected")}
            </span>
        );
    }

    return (
        <span className="inline-flex max-w-[13rem] items-center overflow-hidden rounded-md3-full bg-secondary-container text-on-secondary-container">
            <button
                type="button"
                onClick={() => onSelectNode(target.id)}
                className="state-layer focus-ring inline-flex min-w-0 cursor-pointer items-center gap-1 px-2.5 py-0.5 type-label-s"
                title={target.id}
            >
                <Icon path={mdLink} size={13} className="shrink-0" />
                <span className="truncate">{getNodeLabel(target, t)}</span>
            </button>
            {onDisconnect && (
                <button
                    type="button"
                    aria-label={t("page.storyMaker.flow.clearTarget")}
                    title={t("page.storyMaker.flow.clearTarget")}
                    onClick={onDisconnect}
                    className="state-layer focus-ring inline-flex shrink-0 cursor-pointer items-center border-l border-on-secondary-container/20 px-1.5 py-0.5"
                >
                    <Icon path={mdLinkOff} size={13} />
                </button>
            )}
        </span>
    );
}

function VariableInsertRow({
    variables,
    onInsert,
}: {
    variables: readonly StoryVariable[];
    onInsert: (token: string) => void;
}) {
    const { t } = useI18n();
    if (variables.length === 0) return null;
    return (
        <div className="space-y-1">
            <span className="block type-label-s text-on-surface-variant">
                {t("page.storyMaker.v2.beats.insertVarPlaceholder")}
            </span>
            <div className="flex flex-wrap gap-1">
                {variables.map(v => (
                    <Chip
                        key={v.id}
                        variant="assist"
                        onClick={() => onInsert(`{{${v.id}}}`)}
                    >
                        <span className="font-mono">{`{{${v.name || v.id}}}`}</span>
                    </Chip>
                ))}
            </div>
        </div>
    );
}

function ConditionExprEditor({
    variables,
    expr,
    onChange,
}: {
    variables: readonly StoryVariable[];
    expr: ConditionExpr;
    onChange: (next: ConditionExpr) => void;
}) {
    const { t } = useI18n();
    const selectedVar = variables.find(v => v.id === expr.varId) ?? null;
    const isBool = selectedVar?.type === "boolean";
    const allowedOps: readonly ConditionOp[] = isBool ? ["==", "!="] : CONDITION_OPS;

    return (
        <div className="min-w-0 space-y-2">
            <Select<string>
                label={t("page.storyMaker.v2.variables.nameLabel")}
                value={expr.varId || null}
                onValueChange={(varId) => {
                    const nextVar = variables.find(v => v.id === varId);
                    if (nextVar) onChange(defaultConditionForVariable(nextVar));
                    else onChange({ ...expr, varId });
                }}
                options={variables.map(v => ({
                    value: v.id,
                    label: v.name || v.id,
                    trailing: (
                        <span className="font-mono type-label-s text-on-surface-variant">
                            {t(v.type === "number" ? "page.storyMaker.v2.variables.typeNumber" : "page.storyMaker.v2.variables.typeBoolean")}
                        </span>
                    ),
                }))}
                noOptionsLabel={t("page.storyMaker.v2.variables.noVariablesYet")}
            />
            <div className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2">
                <Select<ConditionOp>
                    value={allowedOps.includes(expr.op) ? expr.op : "=="}
                    onValueChange={op => onChange({ ...expr, op })}
                    options={allowedOps.map(op => ({ value: op, label: op }))}
                    aria-label={t("page.storyMaker.v2.nodeTypes.condition")}
                />
                {isBool ? (
                    <div className="flex items-center justify-between rounded-md3-xs border border-outline px-3 py-2">
                        <span className="font-mono type-label-l text-on-surface">
                            {expr.value ? "true" : "false"}
                        </span>
                        <Switch
                            checked={Boolean(expr.value)}
                            onCheckedChange={checked => onChange({ ...expr, value: checked })}
                            aria-label={t("page.storyMaker.v2.variables.typeBoolean")}
                        />
                    </div>
                ) : (
                    <TextField
                        type="number"
                        value={typeof expr.value === "number" ? String(expr.value) : "0"}
                        min={STORY_LIMITS.varNumberMin}
                        max={STORY_LIMITS.varNumberMax}
                        onChange={(event) => {
                            const num = Number(event.target.value);
                            if (Number.isFinite(num)) {
                                onChange({
                                    ...expr,
                                    value: Math.min(STORY_LIMITS.varNumberMax, Math.max(STORY_LIMITS.varNumberMin, num)),
                                });
                            }
                        }}
                        aria-label={t("page.storyMaker.v2.variables.typeNumber")}
                        className="font-mono"
                    />
                )}
            </div>
        </div>
    );
}

function VarOpListEditor({
    variables,
    ops,
    addLabel,
    compactEmpty = false,
    onChange,
}: {
    variables: readonly StoryVariable[];
    ops: readonly VarOp[];
    addLabel: string;
    compactEmpty?: boolean;
    onChange: (next: VarOp[]) => void;
}) {
    const { t } = useI18n();

    if (variables.length === 0 && ops.length === 0) {
        return compactEmpty ? (
            <p className="type-label-s text-on-surface-variant">{t("page.storyMaker.v2.variables.noVariablesYet")}</p>
        ) : (
            <Banner tone="info">{t("page.storyMaker.v2.variables.noVariablesYet")}</Banner>
        );
    }

    const updateRow = (index: number, nextOp: VarOp) => {
        onChange(ops.map((item, idx) => (idx === index ? nextOp : item)));
    };

    const removeRow = (index: number) => {
        onChange(ops.filter((_, idx) => idx !== index));
    };

    return (
        <div className="min-w-0 space-y-2.5">
            {ops.map((op, idx) => {
                const variable = variables.find(v => v.id === op.varId) ?? null;
                const isBool = variable?.type === "boolean";
                return (
                    <div key={`${op.varId}-${idx}`} className="space-y-2 rounded-md3-sm bg-surface-container p-2.5">
                        <div className="flex items-start gap-1.5">
                            <div className="min-w-0 flex-1">
                                <Select<string>
                                    label={t("page.storyMaker.v2.variables.nameLabel")}
                                    value={op.varId || null}
                                    onValueChange={(varId) => {
                                        const target = variables.find(v => v.id === varId);
                                        if (target) updateRow(idx, defaultVarOpForVariable(target));
                                        else updateRow(idx, { ...op, varId });
                                    }}
                                    options={variables.map(v => ({
                                        value: v.id,
                                        label: v.name || v.id,
                                    }))}
                                    noOptionsLabel={t("page.storyMaker.v2.variables.noVariablesYet")}
                                />
                            </div>
                            <IconButton
                                size="xs"
                                icon={mdDelete}
                                label={t("page.storyMaker.landing.delete")}
                                onClick={() => removeRow(idx)}
                                className="mt-1 shrink-0"
                            />
                        </div>

                        {isBool ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <Select<"set" | "toggle">
                                    value={op.op === "toggle" ? "toggle" : "set"}
                                    onValueChange={(nextOpKind) => {
                                        if (nextOpKind === "toggle") {
                                            updateRow(idx, { varId: op.varId, op: "toggle" });
                                        } else {
                                            updateRow(idx, { varId: op.varId, op: "set", value: true });
                                        }
                                    }}
                                    options={[
                                        { value: "set", label: t("page.storyMaker.v2.variables.opSet") },
                                        { value: "toggle", label: t("page.storyMaker.v2.variables.opToggle") },
                                    ]}
                                    aria-label={t("page.storyMaker.v2.beats.varOp")}
                                />
                                {op.op !== "toggle" && (
                                    <div className="flex items-center justify-between rounded-md3-xs border border-outline px-3 py-2">
                                        <span className="font-mono type-label-l text-on-surface">
                                            {op.value ? "true" : "false"}
                                        </span>
                                        <Switch
                                            checked={Boolean(op.value)}
                                            onCheckedChange={checked => updateRow(idx, { varId: op.varId, op: "set", value: checked })}
                                            aria-label={t("page.storyMaker.v2.variables.typeBoolean")}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)] items-center gap-2">
                                <Select<"set" | "add" | "sub">
                                    value={op.op === "add" || op.op === "sub" ? op.op : "set"}
                                    onValueChange={nextOpKind => updateRow(idx, {
                                        varId: op.varId,
                                        op: nextOpKind,
                                        value: typeof op.value === "number" ? op.value : 1,
                                    })}
                                    options={[
                                        { value: "set", label: t("page.storyMaker.v2.variables.opSet") },
                                        { value: "add", label: t("page.storyMaker.v2.variables.opAdd") },
                                        { value: "sub", label: t("page.storyMaker.v2.variables.opSub") },
                                    ]}
                                    aria-label={t("page.storyMaker.v2.beats.varOp")}
                                />
                                <TextField
                                    type="number"
                                    value={typeof op.value === "number" ? String(op.value) : "0"}
                                    min={STORY_LIMITS.varNumberMin}
                                    max={STORY_LIMITS.varNumberMax}
                                    onChange={(event) => {
                                        const num = Number(event.target.value);
                                        if (Number.isFinite(num)) {
                                            updateRow(idx, {
                                                varId: op.varId,
                                                op: op.op === "add" || op.op === "sub" ? op.op : "set",
                                                value: Math.min(STORY_LIMITS.varNumberMax, Math.max(STORY_LIMITS.varNumberMin, num)),
                                            });
                                        }
                                    }}
                                    aria-label={t("page.storyMaker.v2.variables.typeNumber")}
                                    className="font-mono"
                                />
                            </div>
                        )}
                    </div>
                );
            })}

            <Button
                size="xs"
                variant="tonal"
                icon={mdAdd}
                disabled={variables.length === 0 || ops.length >= STORY_LIMITS.varOpsPerBeat}
                onClick={() => {
                    const first = variables[0];
                    if (!first) return;
                    onChange([...ops, defaultVarOpForVariable(first)]);
                }}
            >
                {addLabel}
            </Button>
        </div>
    );
}

function ActorFramingControls({
    mode,
    slot,
    x,
    scale,
    y,
    z,
    lockX,
    mirror,
    allowOverlap,
    onXChange,
    onScaleChange,
    onYChange,
    onZChange,
    onLockXChange,
    onMirrorChange,
    onAllowOverlapChange,
    onReset,
}: {
    mode: "enter" | "move";
    slot: StorySlot;
    x: number | undefined;
    scale: number | undefined;
    y: number | undefined;
    z: number | undefined;
    lockX: boolean | undefined;
    mirror: boolean | undefined;
    allowOverlap: boolean | undefined;
    onXChange: (x: number | undefined) => void;
    onScaleChange: (scale: number | undefined) => void;
    onYChange: (y: number | undefined) => void;
    onZChange: (z: number | undefined) => void;
    onLockXChange: (lockX: boolean | undefined) => void;
    onMirrorChange: (mirror: boolean | undefined) => void;
    onAllowOverlapChange: (allowOverlap: boolean | undefined) => void;
    onReset: () => void;
}) {
    const { t } = useI18n();
    const slotDefaultX = SLOT_X[slot];
    const effectiveX = x ?? slotDefaultX;
    const sliderX = Math.min(1, Math.max(-1, effectiveX));
    const effectiveScale = scale ?? 1;
    const effectiveY = y ?? 0;
    const hasCustomX = x !== undefined;
    const hasCustomY = mode === "enter" ? (y !== undefined && Math.abs(y) > 0.001) : y !== undefined;
    const hasCustomScale = mode === "enter" ? (scale !== undefined && Math.abs(scale - 1) > 0.001) : scale !== undefined;
    const hasCustom = hasCustomX || hasCustomY || hasCustomScale;
    const effectiveLocked = Boolean(lockX || hasCustomX);

    const externalXText = x === undefined ? "" : x.toFixed(2);
    const [xDraft, setXDraft] = useState(externalXText);
    const [syncedExternalX, setSyncedExternalX] = useState(externalXText);
    if (externalXText !== syncedExternalX) {
        setSyncedExternalX(externalXText);
        setXDraft(externalXText);
    }

    const handleXInputChange = (raw: string) => {
        setXDraft(raw);
        const trimmed = raw.trim();
        if (trimmed === "") {
            setSyncedExternalX("");
            onXChange(undefined);
            return;
        }
        if (trimmed === "-" || trimmed === "+" || trimmed === "." || trimmed === "-." || trimmed === "+.") return;
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return;
        const clamped = clampActorX(parsed);
        setSyncedExternalX(clamped.toFixed(2));
        onXChange(clamped);
    };

    const handleXInputBlur = () => {
        const trimmed = xDraft.trim();
        if (trimmed === "") {
            if (x !== undefined) onXChange(undefined);
            setXDraft("");
            setSyncedExternalX("");
            return;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            const clamped = clampActorX(parsed);
            const formatted = clamped.toFixed(2);
            setXDraft(formatted);
            setSyncedExternalX(formatted);
            if (clamped !== x) onXChange(clamped);
        } else {
            setXDraft(externalXText);
        }
    };

    return (
        <div className="min-w-0 space-y-3 rounded-md3-md border border-outline-variant/60 bg-surface-container-low p-2.5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 type-label-m text-on-surface">
                    <Icon path={mdTune} size={15} className="shrink-0 text-primary" />
                    <span className="truncate">{t("page.storyMaker.inspector.actorFraming")}</span>
                </span>
                <Button
                    size="xs"
                    variant="text"
                    icon={mdRestartAlt}
                    disabled={!hasCustom}
                    onClick={onReset}
                >
                    {t("page.storyMaker.inspector.resetFraming")}
                </Button>
            </div>

            {/* Horizontal Position (X) Slider + Numeric Input (-1.20 .. +1.20) + Snap to Slot */}
            <div className="space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-1.5">
                    <span className="min-w-0 truncate type-label-s text-on-surface-variant">
                        {t("page.storyMaker.inspector.horizontalPosition")}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={xDraft}
                            placeholder={slotDefaultX.toFixed(2)}
                            aria-label={t("page.storyMaker.inspector.horizontalPosition")}
                            onChange={event => handleXInputChange(event.target.value)}
                            onBlur={handleXInputBlur}
                            className="focus-ring h-6 w-16 rounded-md3-xs border border-outline bg-surface-container-lowest px-1.5 text-center font-mono type-label-s text-on-surface placeholder:text-on-surface-variant"
                        />
                        {hasCustomX && (
                            <IconButton
                                size="xs"
                                icon={mdRestartAlt}
                                label={t("page.storyMaker.inspector.resetToSlot")}
                                onClick={() => onXChange(undefined)}
                            />
                        )}
                    </div>
                </div>
                <Slider
                    min={-1}
                    max={1}
                    step={0.01}
                    value={sliderX}
                    onValueChange={next => onXChange(clampActorX(Number(next.toFixed(2))))}
                    aria-label={t("page.storyMaker.inspector.horizontalPosition")}
                    formatValue={val => formatSignedCoord(val)}
                />
            </div>

            {/* Vertical Offset (Y) Slider + Reset */}
            <div className="space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate type-label-s text-on-surface-variant">
                        {t("page.storyMaker.inspector.verticalOffset")}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                        <span className="font-mono type-label-s text-on-surface">
                            {formatSignedCoord(effectiveY)}
                        </span>
                        {hasCustomY && (
                            <IconButton
                                size="xs"
                                icon={mdRestartAlt}
                                label={t("common.action.reset")}
                                onClick={() => onYChange(undefined)}
                            />
                        )}
                    </div>
                </div>
                <Slider
                    min={STORY_LIMITS.yMin}
                    max={STORY_LIMITS.yMax}
                    step={0.01}
                    value={effectiveY}
                    onValueChange={next => onYChange(Number(next.toFixed(2)))}
                    aria-label={t("page.storyMaker.inspector.verticalOffset")}
                    formatValue={val => formatSignedCoord(val)}
                />
            </div>

            {/* Scale Presets + Scale Slider + Reset */}
            <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1">
                    {SCALE_PRESETS.map(preset => (
                        <Chip
                            key={preset.value}
                            variant="filter"
                            showCheckmark={false}
                            selected={Math.abs(effectiveScale - preset.value) < 0.01 && (mode === "enter" || scale !== undefined)}
                            onClick={() => onScaleChange(preset.value)}
                        >
                            {t(preset.labelKey)}
                        </Chip>
                    ))}
                </div>
                <div className="space-y-1">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate type-label-s text-on-surface-variant">
                            {t("page.storyMaker.inspector.scale")}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                            <span className="font-mono type-label-s text-on-surface">{effectiveScale.toFixed(2)}×</span>
                            {hasCustomScale && (
                                <IconButton
                                    size="xs"
                                    icon={mdRestartAlt}
                                    label={t("common.action.reset")}
                                    onClick={() => onScaleChange(undefined)}
                                />
                            )}
                        </div>
                    </div>
                    <Slider
                        min={STORY_LIMITS.scaleMin}
                        max={STORY_LIMITS.scaleMax}
                        step={0.02}
                        value={effectiveScale}
                        onValueChange={next => onScaleChange(Number(next.toFixed(2)))}
                        aria-label={t("page.storyMaker.inspector.scale")}
                        formatValue={val => `${val.toFixed(2)}×`}
                    />
                </div>
            </div>

            {/* Z-Order Slider (-20..+20) + Numeric Stepper (-99..+99) */}
            <ActorZOrderControl
                value={z}
                onChange={onZChange}
            />

            {/* Lock Position, Mirror & Allow Overlap Switches */}
            <div className="space-y-2 border-t border-outline-variant/50 pt-2">
                <div className="space-y-0.5">
                    <Switch
                        checked={effectiveLocked}
                        disabled={hasCustomX}
                        onCheckedChange={checked => onLockXChange(mode === "move" ? checked : (checked || undefined))}
                        label={t("page.storyMaker.inspector.lockPosition")}
                    />
                    {hasCustomX && (
                        <p className="type-label-s text-on-surface-variant">
                            {t("page.storyMaker.inspector.lockPositionPinnedHint")}
                        </p>
                    )}
                </div>
                <Switch
                    checked={Boolean(mirror)}
                    onCheckedChange={checked => onMirrorChange(mode === "move" ? checked : (checked || undefined))}
                    label={t("page.storyMaker.inspector.mirror")}
                />
                <Switch
                    checked={Boolean(allowOverlap)}
                    onCheckedChange={checked => onAllowOverlapChange(mode === "move" ? checked : (checked || undefined))}
                    label={t("page.storyMaker.v2.slots.allowOverlap")}
                />
            </div>
        </div>
    );
}

function clampActorZ(value: number): number {
    return Math.min(STORY_LIMITS.zMax, Math.max(STORY_LIMITS.zMin, Math.trunc(value)));
}

function ActorZOrderControl({
    value,
    onChange,
}: {
    value: number | undefined;
    onChange: (next: number | undefined) => void;
}) {
    const { t } = useI18n();
    const externalText = value === undefined ? "" : String(value);
    const [draft, setDraft] = useState(externalText);
    const [syncedExternal, setSyncedExternal] = useState(externalText);

    if (externalText !== syncedExternal) {
        setSyncedExternal(externalText);
        setDraft(externalText);
    }

    const handleStep = (delta: -1 | 1) => {
        const base = value === undefined ? 0 : value;
        const next = clampActorZ(base + delta);
        setDraft(String(next));
        setSyncedExternal(String(next));
        onChange(next);
    };

    const handleInputChange = (raw: string) => {
        setDraft(raw);
        const trimmed = raw.trim();
        if (trimmed === "") {
            setSyncedExternal("");
            onChange(undefined);
            return;
        }
        if (trimmed === "-" || trimmed === "+") return;
        if (!/^[+-]?\d+$/.test(trimmed)) return;
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return;
        const clamped = clampActorZ(parsed);
        setSyncedExternal(String(clamped));
        onChange(clamped);
    };

    const handleBlur = () => {
        const trimmed = draft.trim();
        if (trimmed === "") {
            if (value !== undefined) onChange(undefined);
            setDraft("");
            setSyncedExternal("");
            return;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            const clamped = clampActorZ(parsed);
            setDraft(String(clamped));
            setSyncedExternal(String(clamped));
            if (clamped !== value) onChange(clamped);
        } else {
            setDraft(externalText);
        }
    };

    const sliderValue = Math.min(20, Math.max(-20, value ?? 0));

    return (
        <div className="min-w-0 space-y-1.5 rounded-md3-md bg-surface-container p-2.5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 type-label-m text-on-surface-variant">
                    <Icon path={mdLayers} size={15} className="shrink-0 text-on-surface-variant" />
                    <span className="truncate">{t("page.storyMaker.inspector.zOrder")}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                        size="xs"
                        icon={mdRemove}
                        label={`${t("page.storyMaker.inspector.zOrder")} -1`}
                        disabled={value !== undefined && value <= STORY_LIMITS.zMin}
                        onClick={() => handleStep(-1)}
                    />
                    <input
                        type="text"
                        inputMode="numeric"
                        value={draft}
                        placeholder={t("page.storyMaker.inspector.zOrderAuto")}
                        aria-label={t("page.storyMaker.inspector.zOrder")}
                        onChange={event => handleInputChange(event.target.value)}
                        onBlur={handleBlur}
                        className="focus-ring h-7 w-16 rounded-md3-xs border border-outline bg-surface-container-lowest px-2 text-center font-mono type-label-m text-on-surface placeholder:text-on-surface-variant"
                    />
                    <IconButton
                        size="xs"
                        icon={mdAdd}
                        label={`${t("page.storyMaker.inspector.zOrder")} +1`}
                        disabled={value !== undefined && value >= STORY_LIMITS.zMax}
                        onClick={() => handleStep(1)}
                    />
                    {value !== undefined && (
                        <IconButton
                            size="xs"
                            icon={mdClose}
                            label={t("common.action.reset")}
                            onClick={() => {
                                setDraft("");
                                setSyncedExternal("");
                                onChange(undefined);
                            }}
                        />
                    )}
                </div>
            </div>
            <Slider
                min={-20}
                max={20}
                step={1}
                value={sliderValue}
                onValueChange={next => {
                    const rounded = Math.trunc(next);
                    setDraft(String(rounded));
                    setSyncedExternal(String(rounded));
                    onChange(rounded);
                }}
                aria-label={t("page.storyMaker.inspector.zOrder")}
                formatValue={val => (val > 0 ? `+${val}` : String(val))}
            />
            <p className="type-label-s text-on-surface-variant">
                {t("page.storyMaker.inspector.zOrderHint")}
            </p>
        </div>
    );
}

function SecondsSlider({
    label,
    value,
    min = STORY_LIMITS.duration.min,
    max = STORY_LIMITS.duration.max,
    step = 0.1,
    decimals = 1,
    onChange,
}: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    decimals?: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="space-y-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate type-label-s text-on-surface-variant">{label}</span>
                <span className="shrink-0 font-mono type-label-s text-on-surface">{value.toFixed(decimals)}s</span>
            </div>
            <Slider
                min={min}
                max={max}
                step={step}
                value={Math.min(max, Math.max(min, value))}
                onValueChange={next => onChange(Number(next.toFixed(decimals)))}
                aria-label={label}
                formatValue={val => `${val.toFixed(decimals)}s`}
            />
        </div>
    );
}

function DurationSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <SecondsSlider
            label={label}
            value={value}
            min={STORY_LIMITS.duration.min}
            max={STORY_LIMITS.duration.max}
            step={0.1}
            decimals={1}
            onChange={onChange}
        />
    );
}
