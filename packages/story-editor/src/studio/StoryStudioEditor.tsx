"use client";
import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { useReducedMotion } from "framer-motion";
import {
    GRAPH_COL_GAP,
    GRAPH_ORIGIN_X,
    GRAPH_ORIGIN_Y,
    INITIAL_STAGE_STATE,
    SERVER_LABEL_KEYS,
    STORY_FADE_SECONDS,
    STORY_LIMITS,
    StoryDraftsUnavailableError,
    UI_LOCALE_LABELS,
    acceptsTarget,
    advanceRuntime,
    applyDragPayloadToTarget,
    applyStoryLocaleOverlay,
    autoLayoutGraph,
    clampCoord,
    compileStoryGraph,
    connectEdge,
    continueAndCutScene,
    createInitialRuntime,
    createNode,
    disconnectEdge,
    disconnectPort,
    downloadStoryScript,
    duplicateBeat,
    duplicateNode,
    evaluateCondition,
    evaluateStageAt,
    getAvailableStoryLocales,
    getOutgoingEdge,
    inferStorySourceLocale,
    initVariables,
    interpolateStoryText,
    localizeRuntimeFrame,
    moveBeat,
    moveNode,
    parseStoryScript,
    removeBeat,
    removeNode,
    resolveVoiceManifestLineUrl,
    rewireEdgeSource,
    serializeStoryScript,
    storyBgmUrl,
    storySeCandidateUrls,
    storyVoiceCandidateUrls,
    upsertStoryLocalePack,
    type CompiledStoryProgram,
    type ContinueSceneOptions,
    type SceneNode,
    type StoryCastMember,
    type StoryDocument,
    type StoryDragPayload,
    type StoryDropTarget,
    type StoryEffectColor,
    type StoryNode,
    type StoryNodePos,
    type StoryRuntimeFrame,
    type StoryStageState,
    type StoryTranslationOrigin,
    type StoryVarValues,
    type StoryVoiceManifest,
    type UiLocale,
} from "@moesekai/story-core";
import { AssetPreloadDialog } from "../components/AssetPreloadPanel";
import type { GameStageChoiceProp } from "../components/GameStageOverlay";
import {
    LivePhasePanel,
    type ActiveVoiceProgress,
    type LivePhaseBacklogItem,
    type StoryRuntimePhase,
} from "../components/LivePhasePanel";
import { NodeInspector } from "../components/NodeInspector";
import { StoryCodeWorkspace, type StoryCodeEvaluation } from "../components/StoryCodeWorkspace";
import { StoryEditorBin } from "../components/StoryEditorBin";
import { StoryFlowCanvas, type StoryFlowViewportActions } from "../components/StoryFlowCanvas";
import { StoryI18nDialog } from "../components/StoryI18nDialog";
import { StoryImportDialog } from "../components/StoryImportDialog";
import { StoryIssueList } from "../components/StoryIssueList";
import {
    StoryMetaDialog,
    applyMetaValuesToDoc,
    metaValuesFromDoc,
    type StoryMetaValues,
} from "../components/StoryMetaDialog";
import { applyInstructionToStage } from "../components/StoryPlayerView";
import { StoryStageView } from "../components/StoryStageView";
import { StoryVoiceManifestDialog } from "../components/StoryVoiceManifestDialog";
import {
    DEFAULT_EDITOR_LAYOUT,
    EDITOR_LAYOUT_LIMITS,
    resetEditorLayout,
    updateEditorLayout,
    useEditorLayout,
} from "../components/useEditorLayout";
import { useStarterStory } from "../components/useStarterStory";
import { useStoryAudio } from "../components/useStoryAudio";
import { useStoryModels } from "../components/useStoryModels";
import { useStoryStage } from "../components/useStoryStage";
import { useStoryUiKit } from "../components/useStoryUiKit";
import { useStoryI18n, useStoryStudio } from "../context/StoryStudioContext";
import {
    Banner, Button, Card, Dialog, EmptyState, Icon, IconButton, LoadingState, Menu, PageContainer,
    SegmentedButton, Slider, Snackbar, StudioLink, Surface, cn, type MenuItemDef,
} from "../md3";
import {
    mdAccountTree, mdAltRoute, mdArrowBack, mdAutoplay, mdBottomPanelClose, mdBottomPanelOpen,
    mdCalculate, mdCheckCircle, mdChevronLeft, mdChevronRight, mdClose, mdCloseFullscreen, mdCloudDone, mdCode,
    mdContentCopy, mdDownload, mdEdit, mdErrorFill, mdFitScreen, mdFlag, mdFullscreen,
    mdFullscreenExit, mdHistory, mdHome, mdKeyboardArrowDown, mdLeftPanelClose, mdLeftPanelOpen, mdMovie,
    mdNumbers, mdPlayArrow, mdPlayArrowFill, mdPlayCircle, mdRecordVoiceOver, mdRedo, mdReplay,
    mdRestartAlt, mdRightPanelClose, mdRightPanelOpen, mdSettings, mdSkipNext, mdSkipPrevious,
    mdStar, mdTag, mdTranslate, mdUndo, mdUploadFile, mdViewQuilt, mdVisibility, mdVisibilityOff, mdVolumeOff,
    mdVolumeUp, mdWarning,
} from "../md3/icons";
import type {
    EditorSlotContext,
    EditorTopBarSlotContext,
    ReloadFromDocOptions,
    ReloadFromScriptOptions,
    StoryEditorSaveStatus,
    StoryEditorWorkspaceMode,
    StoryStudioEditorHandle,
    StoryStudioEditorProps,
} from "./editorTypes";

const MAX_UNDO = 50;
const AUTOSAVE_MS = 600;
const CHAR_INTERVAL_MS = 28;
const CODE_PREVIEW_DEBOUNCE_MS = 200;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

type SplitDragAxis = "horizontal" | "left" | "right" | "code";

interface PlaytestHistoryItem {
    frame: StoryRuntimeFrame;
    chosenText?: string;
}

function subscribeDesktopViewport(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
    }
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
}

function getDesktopViewportSnapshot(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function getDesktopViewportServerSnapshot(): null {
    return null;
}

function useDesktopViewport(): boolean | null {
    return useSyncExternalStore(
        subscribeDesktopViewport,
        getDesktopViewportSnapshot,
        getDesktopViewportServerSnapshot,
    );
}

function pickInitialNodeId(doc: StoryDocument): string {
    const startEdge = getOutgoingEdge(doc, doc.startNodeId, "out");
    if (startEdge && doc.nodes[startEdge.toNodeId]) {
        return startEdge.toNodeId;
    }
    const firstScene = Object.values(doc.nodes).find(n => n.type === "scene");
    if (firstScene) return firstScene.id;
    return doc.nodes[doc.startNodeId] ? doc.startNodeId : (Object.keys(doc.nodes)[0] ?? doc.startNodeId);
}

function getNodeDisplayName(node: StoryNode, t: (key: string) => string): string {
    if (node.type === "start") return t("page.storyMaker.v2.nodeTypes.start");
    return node.title.trim() || t(`page.storyMaker.v2.nodeTypes.${node.type}`);
}

function playOriginBadgeTone(origin: StoryTranslationOrigin): string {
    switch (origin) {
        case "original":
            return "bg-primary-container text-on-primary-container";
        case "human":
            return "bg-secondary-container text-on-secondary-container";
        case "ai_assisted":
            return "bg-tertiary-container text-on-tertiary-container";
        case "ai_raw":
            return "bg-surface-container-highest text-on-surface-variant";
    }
}

function DesktopOnlyNotice({
    draftId,
    backToDraftsHref,
    onBackToDrafts,
    getDraftPlayHref,
}: {
    draftId: string | null;
    backToDraftsHref: string;
    onBackToDrafts?: () => void;
    getDraftPlayHref: (id: string) => string;
}) {
    const { t } = useStoryI18n();
    return (
        <PageContainer className="flex min-h-[60vh] items-center justify-center py-8">
            <Card variant="filled" radius="xl" className="w-full max-w-md p-2">
                <EmptyState
                    icon={mdViewQuilt}
                    title={t("page.storyMaker.desktopOnly.title")}
                    description={t("page.storyMaker.desktopOnly.description")}
                    action={(
                        <div className="mt-2 flex flex-wrap justify-center gap-2">
                            {onBackToDrafts ? (
                                <Button variant="filled" icon={mdArrowBack} onClick={onBackToDrafts}>
                                    {t("page.storyMaker.action.backToDrafts")}
                                </Button>
                            ) : (
                                <Button variant="filled" icon={mdArrowBack} href={backToDraftsHref}>
                                    {t("page.storyMaker.action.backToDrafts")}
                                </Button>
                            )}
                            {draftId && (
                                <Button
                                    variant="tonal"
                                    icon={mdPlayArrowFill}
                                    href={getDraftPlayHref(draftId)}
                                >
                                    {t("page.storyMaker.action.play")}
                                </Button>
                            )}
                        </div>
                    )}
                />
            </Card>
        </PageContainer>
    );
}

function IdeMenuTrigger({
    label,
    items,
}: {
    label: string;
    items: ReadonlyArray<MenuItemDef>;
}) {
    return (
        <Menu
            align="start"
            items={items}
            anchor={({ ref, onClick, ...aria }) => (
                <button
                    ref={ref}
                    type="button"
                    onClick={onClick}
                    {...aria}
                    className="state-layer focus-ring inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md3-sm px-2 type-label-m text-on-surface hover:bg-surface-container-high"
                >
                    <span>{label}</span>
                    <Icon path={mdKeyboardArrowDown} size={15} className="text-on-surface-variant" />
                </button>
            )}
        />
    );
}

const StoryStudioEditorInner = forwardRef<StoryStudioEditorHandle, StoryStudioEditorProps>(
    function StoryStudioEditorInner(props, ref) {
        const {
            draftId = null,
            externalDoc = null,
            externalDocKey,
            onSaveDoc,
            onDocChange,
            onSelectionChange,
            initialMode = null,
            initialNodeId = null,
            initialImmersive = true,
            onImmersiveChange,
            onEffectiveImmersiveChange,
            onModeChange,
            onRequestExport,
            onCreatedDraft,
            backToDraftsHref = "/story-maker",
            onBackToDrafts,
            homeHref = "/",
            initialVoiceManifest = null,
            slots,
        } = props;

        const {
            t,
            assetLine: line,
            assetSource,
            brandLogoUrl,
            resolveLive2dSources,
            storage,
            exporter,
            navigate,
        } = useStoryStudio();
        const reduced = useReducedMotion();
        const buildStarter = useStarterStory();
        const layout = useEditorLayout();

        const hasExternalDoc = externalDoc !== null && externalDoc !== undefined;
        const resolvedExternalKey = externalDocKey ?? (hasExternalDoc ? "__external__" : null);

        const initialModeParamRef = useRef<StoryEditorWorkspaceMode | null>(initialMode);
        const initialNodeParamRef = useRef<string | null>(initialNodeId);

        const [loading, setLoading] = useState(!hasExternalDoc);
        const [loadError, setLoadError] = useState<"missing" | "unavailable" | "failed" | null>(null);
        const [doc, setDoc] = useState<StoryDocument | null>(hasExternalDoc ? externalDoc : null);
        const [past, setPast] = useState<StoryDocument[]>([]);
        const [future, setFuture] = useState<StoryDocument[]>([]);
        const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => (
            hasExternalDoc && externalDoc ? pickInitialNodeId(externalDoc) : null
        ));
        const [selectedBeatId, setSelectedBeatId] = useState<string | null>(() => {
            if (!hasExternalDoc || !externalDoc) return null;
            const firstId = pickInitialNodeId(externalDoc);
            const firstNode = externalDoc.nodes[firstId];
            return firstNode?.type === "scene" ? (firstNode.beats[0]?.id ?? null) : null;
        });
        const [saveStatus, setSaveStatus] = useState<StoryEditorSaveStatus>("saved");

        const [workspaceMode, setWorkspaceMode] = useState<StoryEditorWorkspaceMode>("edit");
        const [immersive, setImmersive] = useState<boolean>(initialImmersive);
        const [stageWebFullscreen, setStageWebFullscreen] = useState(false);
        const [activeDragPayload, setActiveDragPayload] = useState<StoryDragPayload | null>(null);

        // Code Preview Mode state
        const [codeText, setCodeText] = useState("");
        const [codeSyncedBase, setCodeSyncedBase] = useState("");
        const [codePreviewDoc, setCodePreviewDoc] = useState<StoryDocument | null>(null);
        const [codeSelectedNodeId, setCodeSelectedNodeId] = useState<string | null>(null);
        const [codeSelectedBeatId, setCodeSelectedBeatId] = useState<string | null>(null);

        const [metaOpen, setMetaOpen] = useState(false);
        const [i18nOpen, setI18nOpen] = useState(false);
        const [voiceManifestOpen, setVoiceManifestOpen] = useState(false);
        const [voiceManifestInitialTab, setVoiceManifestInitialTab] = useState<"import" | "upload">("import");
        const [issuesOpen, setIssuesOpen] = useState(false);
        const [importOpen, setImportOpen] = useState(false);
        const [preloadOpen, setPreloadOpen] = useState(false);
        const [playSelectedLocale, setPlaySelectedLocale] = useState<UiLocale | null>(null);
        const [playVoiceManifest, setPlayVoiceManifest] = useState<StoryVoiceManifest | null>(initialVoiceManifest);
        const [snack, setSnack] = useState<string | null>(null);
        const [flash, setFlash] = useState<{ key: number; color: StoryEffectColor; seconds: number } | null>(null);
        const playVoiceManifestRef = useRef<StoryVoiceManifest | null>(initialVoiceManifest);

        // Interactive Playtest runtime state (shares the persistently mounted WebGPU stage).
        const [playHistory, setPlayHistory] = useState<PlaytestHistoryItem[]>([]);
        const [playStageState, setPlayStageState] = useState<StoryStageState>(INITIAL_STAGE_STATE);
        const [playLiveVariables, setPlayLiveVariables] = useState<StoryVarValues>({});
        const [playRunning, setPlayRunning] = useState(false);
        const [playEffectActive, setPlayEffectActive] = useState(false);
        const [playAuto, setPlayAuto] = useState(false);
        const [playUiHidden, setPlayUiHidden] = useState(false);
        const [playFadeSeconds, setPlayFadeSeconds] = useState<number>(STORY_FADE_SECONDS);
        const [playTypedCount, setPlayTypedCount] = useState(0);
        const [playVoicePending, setPlayVoicePending] = useState(false);
        const [playVoiceProgress, setPlayVoiceProgress] = useState<ActiveVoiceProgress | null>(null);
        const [playVolume, setPlayVolume] = useState(0.8);
        const [playMuted, setPlayMuted] = useState(false);
        const [playFullscreen, setPlayFullscreen] = useState(false);

        const flashKeyRef = useRef(0);
        const dirtyDocRef = useRef<StoryDocument | null>(null);
        const docRef = useRef<StoryDocument | null>(doc);
        const nleContainerRef = useRef<HTMLDivElement | null>(null);
        const topRowRef = useRef<HTMLDivElement | null>(null);
        const stageFullscreenRef = useRef<HTMLDivElement | null>(null);
        const flowViewportRef = useRef<StoryFlowViewportActions | null>(null);
        const splitDragRef = useRef<{ axis: SplitDragAxis; pointerId: number } | null>(null);
        const playGenRef = useRef(0);
        const voiceTokenRef = useRef(0);
        const skipWaitRef = useRef<(() => void) | null>(null);
        const playStageStateRef = useRef(playStageState);
        const playLiveVariablesRef = useRef(playLiveVariables);
        const playHistoryRef = useRef(playHistory);
        const workspaceModeRef = useRef(workspaceMode);
        const pendingAutoModeRef = useRef<{ mode: "playtest" | "code"; nodeId?: string } | null>(null);

        // Store host callbacks in refs to avoid async fetch/effect re-trigger loops.
        const onSaveDocRef = useRef(onSaveDoc);
        const onDocChangeRef = useRef(onDocChange);
        const onSelectionChangeRef = useRef(onSelectionChange);
        const onImmersiveChangeRef = useRef(onImmersiveChange);
        const onEffectiveImmersiveChangeRef = useRef(onEffectiveImmersiveChange);
        const onModeChangeRef = useRef(onModeChange);
        const onRequestExportRef = useRef(onRequestExport);
        const tRef = useRef(t);

        useEffect(() => {
            docRef.current = doc;
        }, [doc]);
        useEffect(() => {
            onSaveDocRef.current = onSaveDoc;
            onDocChangeRef.current = onDocChange;
            onSelectionChangeRef.current = onSelectionChange;
            onImmersiveChangeRef.current = onImmersiveChange;
            onEffectiveImmersiveChangeRef.current = onEffectiveImmersiveChange;
            onModeChangeRef.current = onModeChange;
            onRequestExportRef.current = onRequestExport;
            tRef.current = t;
        }, [onDocChange, onEffectiveImmersiveChange, onImmersiveChange, onModeChange, onRequestExport, onSaveDoc, onSelectionChange, t]);

        useEffect(() => {
            playStageStateRef.current = playStageState;
        }, [playStageState]);
        useEffect(() => {
            playLiveVariablesRef.current = playLiveVariables;
        }, [playLiveVariables]);
        useEffect(() => {
            playHistoryRef.current = playHistory;
        }, [playHistory]);
        useEffect(() => {
            workspaceModeRef.current = workspaceMode;
        }, [workspaceMode]);
        useEffect(() => {
            playVoiceManifestRef.current = playVoiceManifest;
        }, [playVoiceManifest]);

        const externalDialogOpen = Boolean(slots?.hasExternalDialogOpen);

        const effectiveImmersive = immersive && !loadError;
        useEffect(() => {
            onEffectiveImmersiveChangeRef.current?.(effectiveImmersive);
            return () => {
                onEffectiveImmersiveChangeRef.current?.(false);
            };
        }, [effectiveImmersive]);

        useEffect(() => {
            if ((!effectiveImmersive && !stageWebFullscreen) || typeof document === "undefined") return;
            const prevOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = prevOverflow;
            };
        }, [effectiveImmersive, stageWebFullscreen]);

        const syncModeChange = useCallback((nextMode: StoryEditorWorkspaceMode) => {
            onModeChangeRef.current?.(nextMode);
        }, []);

        const handleImmersiveChange = useCallback((next: boolean) => {
            setImmersive(next);
            onImmersiveChangeRef.current?.(next, {
                effective: next && !loadError,
                userTriggered: true,
            });
        }, [loadError]);

        const {
            syncBgm, playSe, playVoice, stopVoice, stopAll: stopAllAudio, unlock: unlockAudio, audioBlocked,
        } = useStoryAudio(playVolume, playMuted);

        const togglePlayMute = useCallback(() => {
            const nextMuted = !playMuted;
            setPlayMuted(nextMuted);
            if (!nextMuted && playVolume > 0) unlockAudio(playVolume);
        }, [playMuted, playVolume, unlockAudio]);

        const handlePlayVolumeChange = useCallback((next: number) => {
            setPlayMuted(false);
            setPlayVolume(next);
            if (next > 0) unlockAudio(next);
        }, [unlockAudio]);

        // Load from externalDoc when `resolvedExternalKey` changes (Electron workspace file switch).
        const lastExternalKeyRef = useRef<string | null>(resolvedExternalKey);
        useEffect(() => {
            if (!hasExternalDoc || !externalDoc) return;
            if (lastExternalKeyRef.current === resolvedExternalKey && docRef.current) return;
            lastExternalKeyRef.current = resolvedExternalKey;
            setLoading(false);
            setLoadError(null);
            setPast([]);
            setFuture([]);
            setSaveStatus("saved");
            dirtyDocRef.current = null;
            playGenRef.current += 1;
            voiceTokenRef.current += 1;
            skipWaitRef.current?.();
            stopAllAudio();
            setWorkspaceMode("edit");
            setStageWebFullscreen(false);
            setPlayHistory([]);
            setPlayAuto(false);
            setPlayRunning(false);
            setPlayEffectActive(false);
            setPlayVoicePending(false);
            setPlayVoiceProgress(null);
            setPlaySelectedLocale(null);
            setPlayVoiceManifest(initialVoiceManifest);

            const initialNode = pickInitialNodeId(externalDoc);
            const nodeObj = externalDoc.nodes[initialNode];
            setDoc(externalDoc);
            setSelectedNodeId(initialNode);
            setSelectedBeatId(nodeObj?.type === "scene" ? (nodeObj.beats[0]?.id ?? null) : null);
            const serialized = serializeStoryScript(externalDoc);
            setCodeText(serialized);
            setCodeSyncedBase(serialized);
            setCodePreviewDoc(externalDoc);
            if (initialModeParamRef.current === "playtest" || initialModeParamRef.current === "code") {
                const mode = initialModeParamRef.current;
                initialModeParamRef.current = null;
                pendingAutoModeRef.current = {
                    mode,
                    nodeId: initialNodeParamRef.current ?? externalDoc.startNodeId,
                };
            }
        }, [externalDoc, hasExternalDoc, initialVoiceManifest, resolvedExternalKey, stopAllAudio]);

        // Load from storage adapter when `draftId` is used (and `externalDoc` is not supplied).
        const loadSeqRef = useRef(0);
        useEffect(() => {
            if (hasExternalDoc) return;
            const seq = ++loadSeqRef.current;
            async function load() {
                setLoading(true);
                setLoadError(null);
                setPast([]);
                setFuture([]);
                setSaveStatus("saved");
                dirtyDocRef.current = null;
                playGenRef.current += 1;
                voiceTokenRef.current += 1;
                skipWaitRef.current?.();
                stopAllAudio();
                setWorkspaceMode("edit");
                setStageWebFullscreen(false);
                setPlayHistory([]);
                setPlayAuto(false);
                setPlayRunning(false);
                setPlayEffectActive(false);
                setPlayVoicePending(false);
                setPlayVoiceProgress(null);
                setPlaySelectedLocale(null);
                setPlayVoiceManifest(initialVoiceManifest);

                if (!draftId) {
                    setDoc(null);
                    setSelectedNodeId(null);
                    setSelectedBeatId(null);
                    setLoadError("missing");
                    setLoading(false);
                    return;
                }
                try {
                    const draft = await storage.getDraft(draftId);
                    if (seq !== loadSeqRef.current) return;
                    if (!draft) {
                        setDoc(null);
                        setSelectedNodeId(null);
                        setSelectedBeatId(null);
                        setLoadError("missing");
                    } else {
                        const firstNodeId = pickInitialNodeId(draft.doc);
                        const firstNode = draft.doc.nodes[firstNodeId];
                        setDoc(draft.doc);
                        setSelectedNodeId(firstNodeId);
                        setSelectedBeatId(firstNode?.type === "scene" ? (firstNode.beats[0]?.id ?? null) : null);
                        if (initialModeParamRef.current === "playtest" || initialModeParamRef.current === "code") {
                            const mode = initialModeParamRef.current;
                            initialModeParamRef.current = null;
                            pendingAutoModeRef.current = {
                                mode,
                                nodeId: initialNodeParamRef.current ?? draft.doc.startNodeId,
                            };
                        }
                    }
                } catch (error) {
                    if (seq !== loadSeqRef.current) return;
                    setDoc(null);
                    setSelectedNodeId(null);
                    setSelectedBeatId(null);
                    setLoadError(error instanceof StoryDraftsUnavailableError ? "unavailable" : "failed");
                } finally {
                    if (seq === loadSeqRef.current) setLoading(false);
                }
            }
            void load();
            return () => {
                loadSeqRef.current += 1;
            };
        }, [draftId, hasExternalDoc, initialVoiceManifest, stopAllAudio, storage]);

        const persistDoc = useCallback(async (id: string | null, target: StoryDocument) => {
            if (onSaveDocRef.current) {
                await onSaveDocRef.current(target, id);
                return;
            }
            if (id) {
                await storage.saveDraft(id, target);
            }
        }, [storage]);

        const flushSave = useCallback(async (id: string | null, target: StoryDocument) => {
            if (!id && !onSaveDocRef.current) {
                setSaveStatus("saved");
                dirtyDocRef.current = null;
                return;
            }
            setSaveStatus("saving");
            try {
                await persistDoc(id, target);
                if (dirtyDocRef.current === target) {
                    dirtyDocRef.current = null;
                    setSaveStatus("saved");
                }
            } catch {
                setSaveStatus("error");
            }
        }, [persistDoc]);

        useEffect(() => {
            if (!doc || saveStatus !== "dirty") return;
            if (!draftId && !onSaveDocRef.current) return;
            dirtyDocRef.current = doc;
            const timer = window.setTimeout(() => {
                void flushSave(draftId, doc);
            }, AUTOSAVE_MS);
            return () => window.clearTimeout(timer);
        }, [doc, draftId, flushSave, saveStatus]);

        // Flush any pending unsaved changes immediately when hiding tab, closing page, or unmounting.
        useEffect(() => {
            if (!draftId && !onSaveDocRef.current) return;
            const flushPending = () => {
                const pending = dirtyDocRef.current;
                if (!pending) return;
                dirtyDocRef.current = null;
                void persistDoc(draftId, pending).catch(() => undefined);
            };
            const onVisibilityChange = () => {
                if (document.visibilityState === "hidden") flushPending();
            };
            window.addEventListener("pagehide", flushPending);
            document.addEventListener("visibilitychange", onVisibilityChange);
            return () => {
                window.removeEventListener("pagehide", flushPending);
                document.removeEventListener("visibilitychange", onVisibilityChange);
                flushPending();
            };
        }, [draftId, persistDoc]);

        useEffect(() => {
            if (saveStatus !== "dirty" && saveStatus !== "saving") return;
            const handleBeforeUnload = (event: BeforeUnloadEvent) => {
                event.preventDefault();
                event.returnValue = "";
            };
            window.addEventListener("beforeunload", handleBeforeUnload);
            return () => window.removeEventListener("beforeunload", handleBeforeUnload);
        }, [saveStatus]);

        const commit = useCallback((updater: (current: StoryDocument) => StoryDocument) => {
            setDoc((current) => {
                if (!current) return current;
                const next = updater(current);
                if (next === current) return current;
                setPast(history => [...history.slice(-(MAX_UNDO - 1)), current]);
                setFuture([]);
                setSaveStatus("dirty");
                onDocChangeRef.current?.(next);
                return next;
            });
        }, []);

        const undo = useCallback(() => {
            setPast((history) => {
                if (history.length === 0 || !docRef.current) return history;
                const current = docRef.current;
                const previous = history[history.length - 1];
                setFuture(redoStack => [current, ...redoStack.slice(0, MAX_UNDO - 1)]);
                setDoc(previous);
                setSaveStatus("dirty");
                onDocChangeRef.current?.(previous);
                return history.slice(0, -1);
            });
        }, []);

        const redo = useCallback(() => {
            setFuture((redoStack) => {
                if (redoStack.length === 0 || !docRef.current) return redoStack;
                const current = docRef.current;
                const next = redoStack[0];
                setPast(history => [...history.slice(-(MAX_UNDO - 1)), current]);
                setDoc(next);
                setSaveStatus("dirty");
                onDocChangeRef.current?.(next);
                return redoStack.slice(1);
            });
        }, []);

        // Safe derived selection that always remains valid across Undo/Redo/Delete/Code-Apply/External Reload.
        const activeNodeId = useMemo(() => {
            if (!doc) return null;
            if (selectedNodeId && doc.nodes[selectedNodeId]) return selectedNodeId;
            if (doc.nodes[doc.startNodeId]) return doc.startNodeId;
            return Object.keys(doc.nodes)[0] ?? null;
        }, [doc, selectedNodeId]);

        const activeNode = doc && activeNodeId ? doc.nodes[activeNodeId] ?? null : null;
        const activeScene: SceneNode | null = activeNode?.type === "scene" ? activeNode : null;

        const activeBeatId = useMemo(() => {
            if (!activeScene || !selectedBeatId) return null;
            return activeScene.beats.some(b => b.id === selectedBeatId) ? selectedBeatId : null;
        }, [activeScene, selectedBeatId]);

        useEffect(() => {
            onSelectionChangeRef.current?.({ nodeId: activeNodeId, beatId: activeBeatId });
        }, [activeBeatId, activeNodeId]);

        const activeBeatIndex = activeScene && activeBeatId
            ? activeScene.beats.findIndex(b => b.id === activeBeatId)
            : -1;
        const activeBeat = activeScene && activeBeatIndex >= 0
            ? activeScene.beats[activeBeatIndex] ?? null
            : null;

        const handleSelectNode = useCallback((nodeId: string) => {
            setSelectedNodeId(nodeId);
            setSelectedBeatId(null);
        }, []);

        const handleSelectBeat = useCallback((nodeId: string, beatId: string | null) => {
            setSelectedNodeId(nodeId);
            setSelectedBeatId(beatId);
        }, []);

        const handleDeleteNode = useCallback((nodeId: string) => {
            if (!doc) return;
            const target = doc.nodes[nodeId];
            if (!target || target.type === "start" || nodeId === doc.startNodeId) return;
            commit(current => removeNode(current, nodeId));
            if (activeNodeId === nodeId) {
                setSelectedNodeId(doc.startNodeId);
                setSelectedBeatId(null);
            }
        }, [activeNodeId, commit, doc]);

        const handleDeleteBeat = useCallback((nodeId: string, beatId: string) => {
            if (!doc) return;
            const node = doc.nodes[nodeId];
            if (!node || node.type !== "scene") return;
            const idx = node.beats.findIndex(b => b.id === beatId);
            if (idx === -1) return;
            const nextBeat = node.beats[idx + 1] ?? node.beats[idx - 1] ?? null;
            commit(current => removeBeat(current, nodeId, beatId));
            if (activeNodeId === nodeId && activeBeatId === beatId) {
                setSelectedBeatId(nextBeat?.id ?? null);
            }
        }, [activeBeatId, activeNodeId, commit, doc]);

        const program = useMemo(() => (doc ? compileStoryGraph(doc) : null), [doc]);
        const diagnostics = useMemo(() => program?.diagnostics ?? [], [program]);
        const errorCount = program?.errors.length ?? 0;
        const warningCount = program?.warnings.length ?? 0;

        // ==================== Playtest Multi-Language & Custom Voice Manifest Overlay ====================
        const availablePlayLocales = useMemo(() => (doc ? getAvailableStoryLocales(doc) : []), [doc]);
        const effectivePlayLocale: UiLocale = useMemo(() => {
            if (!doc) return "zh-CN";
            if (playSelectedLocale && availablePlayLocales.some(item => item.locale === playSelectedLocale)) {
                return playSelectedLocale;
            }
            return availablePlayLocales[0]?.locale ?? inferStorySourceLocale(doc);
        }, [availablePlayLocales, doc, playSelectedLocale]);
        const activePlayLocaleInfo = availablePlayLocales.find(item => item.locale === effectivePlayLocale) ?? availablePlayLocales[0];
        const playLocalizedDoc = useMemo(
            () => (doc ? applyStoryLocaleOverlay(doc, effectivePlayLocale) : null),
            [doc, effectivePlayLocale],
        );
        const playLocalizedDocRef = useRef<StoryDocument | null>(playLocalizedDoc);
        useEffect(() => {
            playLocalizedDocRef.current = playLocalizedDoc;
        }, [playLocalizedDoc]);
        const playProgram = useMemo(
            () => (playLocalizedDoc ? compileStoryGraph(playLocalizedDoc) : null),
            [playLocalizedDoc],
        );
        const hasPlayVoiceTrackManifest = Boolean(playVoiceManifest && Object.keys(playVoiceManifest.lines).length > 0);
        const playVoiceTrackBadgeLabel = playVoiceManifest?.locale
            ? `${t("page.storyMaker.voiceTrack.badge")} · ${UI_LOCALE_LABELS[playVoiceManifest.locale]}`
            : t("page.storyMaker.voiceTrack.badge");
        const attachedLocaleCount = doc?.locales ? Object.keys(doc.locales).length : 0;

        // ==================== Code Preview Mode Evaluation ====================
        const codeDirty = workspaceMode === "code" && codeText !== codeSyncedBase;

        const codeEval = useMemo<StoryCodeEvaluation>(() => {
            if (workspaceMode !== "code") {
                return doc && program
                    ? { ok: true, doc, program }
                    : { ok: false, diagnostics: [] };
            }
            const parsed = parseStoryScript(codeText);
            if (!parsed.ok) {
                return { ok: false, scriptErrors: parsed.diagnostics };
            }
            const compiled = compileStoryGraph(parsed.doc);
            if (!compiled.ok) {
                return { ok: false, diagnostics: compiled.errors };
            }
            return { ok: true, doc: parsed.doc, program: compiled };
        }, [workspaceMode, codeText, doc, program]);

        const effectiveDoc: StoryDocument | null = workspaceMode === "code" && codeEval.ok
            ? codeEval.doc
            : doc;
        const effectiveDocRef = useRef<StoryDocument | null>(effectiveDoc);
        useEffect(() => {
            effectiveDocRef.current = effectiveDoc;
        }, [effectiveDoc]);

        // Debounce live stage preview doc in Code mode so rapid typing never thrashes Live2D model loads.
        useEffect(() => {
            if (workspaceMode !== "code" || !codeEval.ok) return;
            const nextPreviewDoc = codeEval.doc;
            const timer = window.setTimeout(() => {
                setCodePreviewDoc(nextPreviewDoc);
            }, CODE_PREVIEW_DEBOUNCE_MS);
            return () => window.clearTimeout(timer);
        }, [workspaceMode, codeEval]);

        const stageDoc = workspaceMode === "code" ? (codePreviewDoc ?? doc) : doc;

        const codePreviewScenes = useMemo<SceneNode[]>(() => {
            if (!stageDoc) return [];
            return Object.values(stageDoc.nodes).filter((node): node is SceneNode => node.type === "scene");
        }, [stageDoc]);

        const effectiveCodeNodeId = useMemo(() => {
            if (!stageDoc) return null;
            if (codeSelectedNodeId && stageDoc.nodes[codeSelectedNodeId]) return codeSelectedNodeId;
            return pickInitialNodeId(stageDoc);
        }, [stageDoc, codeSelectedNodeId]);

        const effectiveCodeScene: SceneNode | null = stageDoc && effectiveCodeNodeId
            ? (stageDoc.nodes[effectiveCodeNodeId]?.type === "scene"
                ? stageDoc.nodes[effectiveCodeNodeId] as SceneNode
                : null)
            : null;

        const effectiveCodeBeatId = useMemo(() => {
            if (!effectiveCodeScene) return null;
            if (codeSelectedBeatId && effectiveCodeScene.beats.some(b => b.id === codeSelectedBeatId)) {
                return codeSelectedBeatId;
            }
            return effectiveCodeScene.beats[0]?.id ?? null;
        }, [effectiveCodeScene, codeSelectedBeatId]);

        const effectiveCodeBeatIndex = effectiveCodeScene && effectiveCodeBeatId
            ? effectiveCodeScene.beats.findIndex(b => b.id === effectiveCodeBeatId)
            : -1;

        // ==================== WebGPU Live2D Stage ====================
        const { list: modelList, models, retry: retryModels } = useStoryModels(stageDoc?.region ?? null);
        const stageModels = useMemo(
            () => (modelList.status === "ready" ? modelList.models : modelList.status === "error" ? [] : null),
            [modelList],
        );
        const { kit: uiKit } = useStoryUiKit(stageDoc?.region ?? null);
        const library = useMemo(
            () => (stageDoc ? resolveLive2dSources(stageDoc.region).library : null),
            [resolveLive2dSources, stageDoc],
        );
        const {
            hostRef: stageHostRef,
            phase: stagePhase,
            modelInfo,
            problems: stageProblems,
            loadingActors,
            apply: applyStage,
            previewClip,
            clearClipPreview,
            isSoloPreview,
            previewingCastKey,
            previewingCast,
            setTalking: setStageTalking,
            shake: shakeStage,
            finish: finishStage,
            retry: retryStage,
        } = useStoryStage({ library, cast: stageDoc?.cast ?? [], models: stageModels });

        const previewTargetNodeId = workspaceMode === "code" ? effectiveCodeNodeId : activeNodeId;
        const previewTargetBeatId = workspaceMode === "code" ? effectiveCodeBeatId : activeBeatId;

        const evaluated = useMemo(() => {
            if (!stageDoc || !previewTargetNodeId) {
                return { stage: INITIAL_STAGE_STATE, variables: {} };
            }
            return evaluateStageAt(stageDoc, previewTargetNodeId, previewTargetBeatId ?? undefined);
        }, [stageDoc, previewTargetNodeId, previewTargetBeatId]);

        const editStageState = evaluated.stage;

        // Always latch latest edit/code stage state into the controller (it safely queues until
        // stage & models are ready and deduplicates non-structural keystroke edits automatically).
        useEffect(() => {
            if ((workspaceMode !== "edit" && workspaceMode !== "code") || !stageDoc) return;
            void applyStage(editStageState, { instant: true });
        }, [workspaceMode, stageDoc, applyStage, editStageState]);

        useEffect(() => {
            if (workspaceModeRef.current !== "playtest" || stagePhase.kind !== "ready" || !models) return;
            void applyStage(playStageStateRef.current, { instant: true });
        }, [applyStage, stagePhase.kind, models]);

        // ==================== Interactive Playtest Engine ====================

        const stopActivePlayVoice = useCallback(() => {
            voiceTokenRef.current += 1;
            stopVoice();
            setPlayVoicePending(false);
            setPlayVoiceProgress(null);
        }, [stopVoice]);

        const startPlayVoice = useCallback((
            urls: string[],
            meta: { label: string; start?: number; end?: number },
            generation: number,
            trackPending: boolean,
        ) => {
            if (urls.length === 0) return;
            const token = ++voiceTokenRef.current;
            if (trackPending) setPlayVoicePending(true);
            setPlayVoiceProgress({
                currentSec: meta.start ?? 0,
                durationSec: meta.end ?? 0,
                start: meta.start,
                end: meta.end,
                label: meta.label,
            });
            void playVoice(urls, {
                start: meta.start,
                end: meta.end,
                onProgress: (currentSec, durationSec) => {
                    if (voiceTokenRef.current !== token) return;
                    setPlayVoiceProgress({
                        currentSec,
                        durationSec,
                        start: meta.start,
                        end: meta.end,
                        label: meta.label,
                    });
                },
            }).finally(() => {
                if (voiceTokenRef.current === token) {
                    setPlayVoiceProgress(null);
                }
                if (trackPending && playGenRef.current === generation) {
                    setPlayVoicePending(false);
                }
            });
        }, [playVoice]);

        const waitPlayMs = useCallback((ms: number, generation: number) => {
            if (ms <= 0 || reduced) return Promise.resolve();
            return new Promise<void>((resolve) => {
                const finish = () => {
                    if (skipWaitRef.current === cancel) skipWaitRef.current = null;
                    resolve();
                };
                const timer = window.setTimeout(finish, ms);
                const cancel = () => {
                    window.clearTimeout(timer);
                    finish();
                };
                if (playGenRef.current !== generation) {
                    cancel();
                    return;
                }
                skipWaitRef.current = cancel;
            });
        }, [reduced]);

        const executePlayFrame = useCallback(async (
            targetDoc: StoryDocument,
            nextHistory: PlaytestHistoryItem[],
            baseStage: StoryStageState,
            baseVars: StoryVarValues,
            frame: StoryRuntimeFrame,
            instant = false,
        ) => {
            const generation = ++playGenRef.current;
            skipWaitRef.current?.();
            stopActivePlayVoice();
            setStageTalking(null);
            setPlayEffectActive(false);
            setPlayHistory(nextHistory);

            if (instant || frame.executedInstructions.length === 0) {
                const finalFrame = localizeRuntimeFrame(frame, playLocalizedDocRef.current ?? targetDoc);
                finishStage();
                setFlash(null);
                setPlayStageState(finalFrame.stage);
                setPlayLiveVariables(finalFrame.variables);
                setPlayTypedCount(finalFrame.stage.dialogue?.body.length ?? 0);
                setPlayRunning(false);
                syncBgm(
                    finalFrame.stage.bgm.name ? storyBgmUrl(finalFrame.stage.bgm.name, targetDoc.region, line) : null,
                    finalFrame.stage.bgm.volume,
                );
                void applyStage(finalFrame.stage, { instant: true });
                if (finalFrame.stoppedReason !== "blocking") setPlayAuto(false);
                return;
            }

            setPlayRunning(true);
            let stage = baseStage;
            let vars = baseVars;

            for (const inst of frame.executedInstructions) {
                if (playGenRef.current !== generation) return;
                const activeDoc = playLocalizedDocRef.current ?? targetDoc;
                const stepped = applyInstructionToStage(stage, vars, inst, activeDoc);
                stage = stepped.stage;
                vars = stepped.variables;

                switch (inst.op) {
                    case "enterScene": {
                        setPlayStageState(stage);
                        syncBgm(
                            stage.bgm.name ? storyBgmUrl(stage.bgm.name, targetDoc.region, line) : null,
                            stage.bgm.volume,
                        );
                        if (inst.transition.kind === "fadeBlack" || inst.transition.kind === "fadeWhite") {
                            const dur = Math.max(0.1, inst.transition.duration);
                            const color: StoryEffectColor = inst.transition.kind === "fadeWhite" ? "white" : "black";
                            setPlayFadeSeconds(dur);
                            setPlayEffectActive(true);
                            try {
                                flashKeyRef.current += 1;
                                setFlash({ key: flashKeyRef.current, color, seconds: dur });
                                await Promise.all([
                                    applyStage(stage, { instant: false, fade: true }),
                                    waitPlayMs(dur * 1000 * 0.6, generation),
                                ]);
                            } finally {
                                if (playGenRef.current === generation) setPlayEffectActive(false);
                            }
                        } else {
                            setPlayFadeSeconds(0);
                            await applyStage(stage, { instant: false, fade: false });
                        }
                        break;
                    }
                    case "stageAction": {
                        setPlayStageState(stage);
                        const beat = inst.beat;
                        await applyStage(stage, {
                            instant: false,
                            fade: beat.action === "enter" || beat.action === "exit",
                            moveSeconds: beat.action === "move" ? (beat.duration ?? STORY_FADE_SECONDS) : undefined,
                        });
                        break;
                    }
                    case "cue": {
                        const beat = inst.beat;
                        setPlayStageState(stage);
                        if (beat.cueType === "se") {
                            if (beat.se) playSe(storySeCandidateUrls(beat.se, targetDoc.region, line), beat.seVolume);
                        } else {
                            setPlayEffectActive(true);
                            try {
                                if (beat.cueType === "flash") {
                                    const dur = beat.duration ?? 0.4;
                                    flashKeyRef.current += 1;
                                    setFlash({ key: flashKeyRef.current, color: beat.color ?? "white", seconds: dur });
                                    await waitPlayMs(Math.min(dur, 1.5) * 1000, generation);
                                } else if (beat.cueType === "shake") {
                                    await shakeStage(beat.duration ?? 0.4);
                                } else if (beat.cueType === "wait") {
                                    await waitPlayMs((beat.duration ?? 0.8) * 1000, generation);
                                }
                            } finally {
                                if (playGenRef.current === generation) setPlayEffectActive(false);
                            }
                        }
                        break;
                    }
                    case "varOp": {
                        setPlayLiveVariables(vars);
                        break;
                    }
                    case "talk": {
                        const beat = inst.beat;
                        setPlayStageState(stage);
                        setPlayLiveVariables(vars);
                        void applyStage(stage, { instant: false });
                        const body = stage.dialogue?.body ?? interpolateStoryText(beat.body, activeDoc, vars);
                        setPlayTypedCount(reduced ? body.length : 0);
                        if (beat.se) {
                            playSe(storySeCandidateUrls(beat.se, targetDoc.region, line), beat.seVolume);
                        }
                        if (beat.voice && beat.voice.scenarioId && beat.voice.voiceId) {
                            const urls = storyVoiceCandidateUrls(beat.voice, targetDoc.region, line);
                            startPlayVoice(
                                urls,
                                { label: beat.voice.voiceId, start: beat.voice.start, end: beat.voice.end },
                                generation,
                                true,
                            );
                        } else if (playVoiceManifestRef.current) {
                            const trackUrls = resolveVoiceManifestLineUrl(playVoiceManifestRef.current, beat.id);
                            if (trackUrls.length > 0) {
                                const manifestLine = playVoiceManifestRef.current.lines[beat.id];
                                startPlayVoice(
                                    trackUrls,
                                    { label: manifestLine?.speaker || beat.id },
                                    generation,
                                    true,
                                );
                            }
                        }
                        break;
                    }
                    case "narration": {
                        const beat = inst.beat;
                        setPlayStageState(stage);
                        void applyStage(stage, { instant: false });
                        if (beat.se) {
                            playSe(storySeCandidateUrls(beat.se, targetDoc.region, line), beat.seVolume);
                        }
                        break;
                    }
                    case "telop":
                    case "choice":
                    case "end": {
                        setPlayStageState(stage);
                        void applyStage(stage, { instant: false });
                        break;
                    }
                    default:
                        break;
                }
            }

            if (playGenRef.current !== generation) return;
            const finalFrame = localizeRuntimeFrame(frame, playLocalizedDocRef.current ?? targetDoc);
            setPlayStageState(finalFrame.stage);
            setPlayLiveVariables(finalFrame.variables);
            if (finalFrame.stage.dialogue && finalFrame.stage.dialogue.body !== stage.dialogue?.body) {
                setPlayTypedCount(reduced ? finalFrame.stage.dialogue.body.length : 0);
            }
            syncBgm(
                finalFrame.stage.bgm.name ? storyBgmUrl(finalFrame.stage.bgm.name, targetDoc.region, line) : null,
                finalFrame.stage.bgm.volume,
            );
            setPlayEffectActive(false);
            setPlayRunning(false);
            if (finalFrame.stoppedReason !== "blocking") setPlayAuto(false);
        }, [applyStage, finishStage, line, playSe, reduced, setStageTalking, shakeStage, startPlayVoice, stopActivePlayVoice, syncBgm, waitPlayMs]);

        const startPlaytestFrom = useCallback((
            targetNodeId?: string | null,
            docOverride?: StoryDocument,
            programOverride?: CompiledStoryProgram,
        ) => {
            const activeTargetDoc = docOverride
                ? applyStoryLocaleOverlay(docOverride, effectivePlayLocale)
                : (playLocalizedDoc ?? doc);
            if (!activeTargetDoc) return;
            const activeTargetProgram = docOverride
                ? (programOverride && activeTargetDoc === docOverride ? programOverride : compileStoryGraph(activeTargetDoc))
                : (playProgram ?? program);
            if (!activeTargetProgram || activeTargetProgram.errors.length > 0) return;
            voiceTokenRef.current += 1;
            stopAllAudio();
            setPlayVoicePending(false);
            setPlayVoiceProgress(null);
            setPlayEffectActive(false);
            setStageTalking(null);
            setPlayAuto(false);
            setPlayUiHidden(false);

            const resolvedNodeId = targetNodeId && activeTargetProgram.nodeEntryPc[targetNodeId] !== undefined
                ? targetNodeId
                : activeTargetDoc.startNodeId;
            const initialFrame = createInitialRuntime(activeTargetProgram, resolvedNodeId);
            const seed = resolvedNodeId !== activeTargetDoc.startNodeId
                ? evaluateStageAt(activeTargetDoc, resolvedNodeId)
                : { stage: INITIAL_STAGE_STATE, variables: initVariables(activeTargetDoc) };
            void executePlayFrame(activeTargetDoc, [{ frame: initialFrame }], seed.stage, seed.variables, initialFrame, false);
        }, [doc, effectivePlayLocale, executePlayFrame, playLocalizedDoc, playProgram, program, setStageTalking, stopAllAudio]);

        const stopPlaytestSession = useCallback(() => {
            playGenRef.current += 1;
            voiceTokenRef.current += 1;
            skipWaitRef.current?.();
            stopAllAudio();
            setStageTalking(null);
            finishStage();
            setFlash(null);
            setPlayAuto(false);
            setPlayRunning(false);
            setPlayEffectActive(false);
            setPlayVoicePending(false);
            setPlayVoiceProgress(null);
            setPlayUiHidden(false);
            if (typeof document !== "undefined" && document.fullscreenElement === stageFullscreenRef.current) {
                void document.exitFullscreen?.().catch(() => undefined);
            }
        }, [finishStage, setStageTalking, stopAllAudio]);

        const enterPlaytest = useCallback((
            fromNodeId?: string,
            docOverride?: StoryDocument,
            programOverride?: CompiledStoryProgram,
        ) => {
            const targetDoc = docOverride ?? doc;
            const targetProgram = programOverride ?? (docOverride ? compileStoryGraph(docOverride) : program);
            if (!targetDoc || !targetProgram) return;
            if (targetProgram.errors.length > 0) {
                setSnack(tRef.current("page.storyMaker.v2.mode.playtestBlockedErrors", { count: targetProgram.errors.length }));
                setIssuesOpen(true);
                return;
            }
            clearClipPreview();
            setActiveDragPayload(null);
            unlockAudio();
            setWorkspaceMode("playtest");
            syncModeChange("playtest");
            startPlaytestFrom(fromNodeId ?? targetDoc.startNodeId, targetDoc, targetProgram);
        }, [clearClipPreview, doc, program, startPlaytestFrom, syncModeChange, unlockAudio]);

        const exitPlaytest = useCallback((syncSelection = false) => {
            stopPlaytestSession();
            if (syncSelection && doc) {
                const latest = playHistoryRef.current[playHistoryRef.current.length - 1]?.frame;
                if (latest?.nodeId && doc.nodes[latest.nodeId]) {
                    const targetNode = doc.nodes[latest.nodeId];
                    setSelectedNodeId(latest.nodeId);
                    if (
                        targetNode.type === "scene"
                        && latest.beatId
                        && targetNode.beats.some(beat => beat.id === latest.beatId)
                    ) {
                        setSelectedBeatId(latest.beatId);
                    } else {
                        setSelectedBeatId(null);
                    }
                }
            }
            setWorkspaceMode("edit");
            syncModeChange("edit");
        }, [doc, stopPlaytestSession, syncModeChange]);

        const enterCodeMode = useCallback((sourceDoc?: StoryDocument) => {
            const targetDoc = sourceDoc ?? doc;
            if (!targetDoc) return;
            if (workspaceModeRef.current === "playtest") {
                stopPlaytestSession();
            }
            clearClipPreview();
            setActiveDragPayload(null);
            const serialized = serializeStoryScript(targetDoc);
            setCodeText(serialized);
            setCodeSyncedBase(serialized);
            setCodePreviewDoc(targetDoc);
            const targetNodeId = activeNodeId && targetDoc.nodes[activeNodeId]
                ? activeNodeId
                : pickInitialNodeId(targetDoc);
            setCodeSelectedNodeId(targetNodeId);
            const targetNode = targetDoc.nodes[targetNodeId];
            setCodeSelectedBeatId(
                targetNode?.type === "scene"
                    ? (activeBeatId && targetNode.beats.some(b => b.id === activeBeatId)
                        ? activeBeatId
                        : (targetNode.beats[0]?.id ?? null))
                    : null,
            );
            setWorkspaceMode("code");
            syncModeChange("code");
        }, [activeBeatId, activeNodeId, clearClipPreview, doc, stopPlaytestSession, syncModeChange]);

        const applyCodeDoc = useCallback((nextDoc: StoryDocument, silent = false, preserveLocales = true) => {
            const mergedDoc: StoryDocument = preserveLocales && doc
                ? {
                    ...nextDoc,
                    ...(nextDoc.sourceLocale ? {} : (doc.sourceLocale ? { sourceLocale: doc.sourceLocale } : {})),
                    ...(doc.locales && Object.keys(doc.locales).length > 0 ? { locales: doc.locales } : {}),
                }
                : nextDoc;
            commit(() => mergedDoc);
            const serialized = serializeStoryScript(mergedDoc);
            setCodeText(serialized);
            setCodeSyncedBase(serialized);
            setCodePreviewDoc(mergedDoc);
            const nextNodeId = activeNodeId && mergedDoc.nodes[activeNodeId]
                ? activeNodeId
                : pickInitialNodeId(mergedDoc);
            setSelectedNodeId(nextNodeId);
            const nextNode = mergedDoc.nodes[nextNodeId];
            setSelectedBeatId(nextNode?.type === "scene" ? (nextNode.beats[0]?.id ?? null) : null);
            setCodeSelectedNodeId(nextNodeId);
            setCodeSelectedBeatId(nextNode?.type === "scene" ? (nextNode.beats[0]?.id ?? null) : null);
            if (!silent) {
                setSnack(tRef.current("page.storyMaker.v2.mode.codeSyncedToast"));
            }
        }, [activeNodeId, commit, doc]);

        const handleWorkspaceModeChange = useCallback((nextMode: StoryEditorWorkspaceMode) => {
            if (!doc || nextMode === workspaceMode) return;

            let resolvedDoc = doc;
            let resolvedProgram = program ?? undefined;
            if (workspaceMode === "code" && codeDirty) {
                if (!codeEval.ok) {
                    setSnack(tRef.current("page.storyMaker.v2.mode.codeBlockedSwitch"));
                    return;
                }
                resolvedDoc = codeEval.doc;
                resolvedProgram = codeEval.program;
                applyCodeDoc(resolvedDoc, false);
            }

            if (nextMode === "code") {
                enterCodeMode(resolvedDoc);
            } else if (nextMode === "playtest") {
                enterPlaytest(undefined, resolvedDoc, resolvedProgram);
            } else {
                if (workspaceMode === "playtest") {
                    exitPlaytest(false);
                } else {
                    setWorkspaceMode("edit");
                    syncModeChange("edit");
                }
            }
        }, [
            applyCodeDoc, codeDirty, codeEval, doc, enterCodeMode, enterPlaytest,
            exitPlaytest, program, syncModeChange, workspaceMode,
        ]);

        const handleApplyCodeAndPlaytest = useCallback((nextDoc: StoryDocument) => {
            const mergedDoc: StoryDocument = doc
                ? {
                    ...nextDoc,
                    ...(nextDoc.sourceLocale ? {} : (doc.sourceLocale ? { sourceLocale: doc.sourceLocale } : {})),
                    ...(doc.locales && Object.keys(doc.locales).length > 0 ? { locales: doc.locales } : {}),
                }
                : nextDoc;
            const compiled = compileStoryGraph(mergedDoc);
            if (!compiled.ok) {
                setSnack(tRef.current("page.storyMaker.v2.mode.playtestBlockedErrors", { count: compiled.errors.length }));
                return;
            }
            if (codeDirty) {
                applyCodeDoc(mergedDoc, true, true);
            }
            enterPlaytest(undefined, mergedDoc, compiled);
        }, [applyCodeDoc, codeDirty, doc, enterPlaytest]);

        // Reload helper for imperative handle AND storage external change watcher.
        const reloadFromDocImpl = useCallback((nextDoc: StoryDocument, options?: ReloadFromDocOptions) => {
            const preserveSelection = options?.preserveSelection ?? true;
            const pushHistory = options?.pushHistory ?? false;
            const markSaved = options?.markSaved ?? true;

            if (workspaceModeRef.current === "playtest") {
                stopPlaytestSession();
                setWorkspaceMode("edit");
                syncModeChange("edit");
            }
            if (pushHistory && docRef.current) {
                const prev = docRef.current;
                setPast(history => [...history.slice(-(MAX_UNDO - 1)), prev]);
                setFuture([]);
            }
            setDoc(nextDoc);
            if (markSaved) {
                dirtyDocRef.current = null;
                setSaveStatus("saved");
            } else {
                dirtyDocRef.current = nextDoc;
                setSaveStatus("dirty");
            }

            const serialized = serializeStoryScript(nextDoc);
            setCodeText(serialized);
            setCodeSyncedBase(serialized);
            setCodePreviewDoc(nextDoc);

            const nextNodeId = preserveSelection && selectedNodeId && nextDoc.nodes[selectedNodeId]
                ? selectedNodeId
                : pickInitialNodeId(nextDoc);
            const nextNode = nextDoc.nodes[nextNodeId];
            const nextBeatId = preserveSelection
                && nextNode?.type === "scene"
                && selectedBeatId
                && nextNode.beats.some(b => b.id === selectedBeatId)
                ? selectedBeatId
                : (nextNode?.type === "scene" ? (nextNode.beats[0]?.id ?? null) : null);

            setSelectedNodeId(nextNodeId);
            setSelectedBeatId(nextBeatId);
            setCodeSelectedNodeId(nextNodeId);
            setCodeSelectedBeatId(nextBeatId);
            onDocChangeRef.current?.(nextDoc);
            if (!options?.silent) {
                setSnack(tRef.current("page.storyMaker.v2.mode.codeSyncedToast"));
            }
        }, [selectedBeatId, selectedNodeId, stopPlaytestSession, syncModeChange]);

        const reloadFromScriptImpl = useCallback((
            script: string,
            options?: ReloadFromScriptOptions,
        ): { ok: boolean; error?: string; doc?: StoryDocument } => {
            const parsed = parseStoryScript(script);
            if (!parsed.ok) {
                const firstErr = parsed.diagnostics[0];
                const message = firstErr ? `${firstErr.line}:${firstErr.col} ${firstErr.message}` : "parse_failed";
                return { ok: false, error: message };
            }
            const current = docRef.current;
            const mergedDoc: StoryDocument = current
                ? {
                    ...parsed.doc,
                    ...(parsed.doc.sourceLocale ? {} : (current.sourceLocale ? { sourceLocale: current.sourceLocale } : {})),
                    ...(current.locales && Object.keys(current.locales).length > 0 ? { locales: current.locales } : {}),
                }
                : parsed.doc;
            reloadFromDocImpl(mergedDoc, {
                preserveSelection: options?.preserveSelection ?? true,
                pushHistory: true,
                markSaved: options?.markSaved ?? true,
                silent: options?.silent ?? true,
            });
            return { ok: true, doc: mergedDoc };
        }, [reloadFromDocImpl]);

        // Auto-subscribe to external storage changes when supported by host storage adapter (e.g. Desktop FS watcher).
        useEffect(() => {
            if (hasExternalDoc || !draftId || typeof storage.watchExternalChanges !== "function") return;
            return storage.watchExternalChanges(draftId, (event) => {
                if (event.kind === "updated") {
                    if (event.doc) {
                        reloadFromDocImpl(event.doc, { preserveSelection: true, pushHistory: true, markSaved: true, silent: true });
                    } else if (typeof event.script === "string") {
                        reloadFromScriptImpl(event.script, { preserveSelection: true, markSaved: true, silent: true });
                    }
                }
            });
        }, [draftId, hasExternalDoc, reloadFromDocImpl, reloadFromScriptImpl, storage]);

        const handleExportAction = useCallback(() => {
            const target = effectiveDocRef.current ?? docRef.current;
            if (!target) return;
            if (onRequestExportRef.current) {
                onRequestExportRef.current(target);
                return;
            }
            void exporter.exportMsk(target).then((res) => {
                if (res.ok && !res.canceled) {
                    setSnack(tRef.current("page.storyMaker.exportedToast"));
                }
            }).catch(() => {
                downloadStoryScript(target);
                setSnack(tRef.current("page.storyMaker.exportedToast"));
            });
        }, [exporter]);

        // Imperative Handle for Electron FS watcher, Pi Agent automation, and external drivers.
        useImperativeHandle(ref, (): StoryStudioEditorHandle => ({
            reloadFromScript: reloadFromScriptImpl,
            reloadFromDoc: reloadFromDocImpl,
            focusNode: (nodeId: string, beatId?: string | null) => {
                const current = docRef.current;
                if (!current || !current.nodes[nodeId]) return;
                if (workspaceModeRef.current === "playtest") {
                    exitPlaytest(false);
                } else if (workspaceModeRef.current === "code") {
                    setCodeSelectedNodeId(nodeId);
                    setCodeSelectedBeatId(beatId ?? null);
                }
                setSelectedNodeId(nodeId);
                setSelectedBeatId(beatId ?? null);
                const node = current.nodes[nodeId];
                if (node) {
                    flowViewportRef.current?.ensureNodeVisible(nodeId, node.pos);
                }
            },
            selectBeat: (nodeId: string, beatId: string | null) => {
                const current = docRef.current;
                if (!current || !current.nodes[nodeId]) return;
                setSelectedNodeId(nodeId);
                setSelectedBeatId(beatId);
                setCodeSelectedNodeId(nodeId);
                setCodeSelectedBeatId(beatId);
                const node = current.nodes[nodeId];
                if (node) {
                    flowViewportRef.current?.ensureNodeVisible(nodeId, node.pos);
                }
            },
            setWorkspaceMode: (mode: StoryEditorWorkspaceMode) => {
                handleWorkspaceModeChange(mode);
            },
            playtestFromNode: (nodeId?: string) => {
                enterPlaytest(nodeId);
            },
            getCurrentDoc: () => docRef.current,
            getEffectiveDoc: () => effectiveDocRef.current ?? docRef.current,
            getSelectedNodeId: () => activeNodeId,
            getSelectedBeatId: () => activeBeatId,
            getWorkspaceMode: () => workspaceModeRef.current,
            saveNow: async () => {
                const current = docRef.current;
                if (!current) return;
                dirtyDocRef.current = current;
                await flushSave(draftId, current);
            },
            openVoiceManifestDialog: (tab: "import" | "upload" = "import") => {
                setVoiceManifestInitialTab(tab);
                setVoiceManifestOpen(true);
            },
            openExportDialog: () => {
                handleExportAction();
            },
        }), [
            activeBeatId,
            activeNodeId,
            draftId,
            enterPlaytest,
            exitPlaytest,
            flushSave,
            handleExportAction,
            handleWorkspaceModeChange,
            reloadFromDocImpl,
            reloadFromScriptImpl,
        ]);

        // Honor initial mode (`playtest` or `code`) once `doc` and `program` are ready.
        useEffect(() => {
            const pending = pendingAutoModeRef.current;
            if (!pending || !doc || !program) return;
            pendingAutoModeRef.current = null;
            const timer = window.setTimeout(() => {
                if (pending.mode === "code") {
                    enterCodeMode(doc);
                } else if (program.errors.length === 0) {
                    enterPlaytest(pending.nodeId);
                } else {
                    setSnack(tRef.current("page.storyMaker.v2.mode.playtestBlockedErrors", { count: program.errors.length }));
                    setIssuesOpen(true);
                }
            }, 0);
            return () => window.clearTimeout(timer);
        }, [doc, enterCodeMode, enterPlaytest, program]);

        useEffect(() => () => {
            playGenRef.current += 1;
            voiceTokenRef.current += 1;
            skipWaitRef.current?.();
        }, []);

        const playLatestItem = playHistory[playHistory.length - 1] ?? null;
        const playActiveFrame = playLatestItem?.frame ?? null;
        const playCurrentChoice = workspaceMode === "playtest" && !playRunning && playActiveFrame?.stoppedReason === "choice"
            ? playActiveFrame.pendingChoice
            : null;
        const playFullDialogueBody = playStageState.dialogue?.body ?? "";
        const playIsTyping = workspaceMode === "playtest"
            && !reduced
            && playFullDialogueBody.length > 0
            && playTypedCount < playFullDialogueBody.length;
        const playDisplayedDialogue = playStageState.dialogue
            ? (reduced ? playFullDialogueBody : playFullDialogueBody.slice(0, playTypedCount))
            : undefined;

        useEffect(() => {
            if (workspaceMode !== "playtest" || playRunning || reduced || !playStageState.dialogue) return;
            const targetLength = playStageState.dialogue.body.length;
            if (playTypedCount >= targetLength) return;
            const timer = window.setTimeout(() => {
                setPlayTypedCount(count => Math.min(targetLength, count + 1));
            }, CHAR_INTERVAL_MS);
            return () => window.clearTimeout(timer);
        }, [workspaceMode, playRunning, reduced, playStageState.dialogue, playTypedCount]);

        useEffect(() => {
            if (workspaceMode !== "playtest") return;
            const activeSpeaker = playStageState.speaking;
            const mouthMoving = Boolean(activeSpeaker) && !playRunning && (playIsTyping || playVoicePending);
            setStageTalking(mouthMoving ? activeSpeaker : null);
        }, [workspaceMode, setStageTalking, playStageState.speaking, playRunning, playIsTyping, playVoicePending]);

        const snapPlayFrame = useCallback(() => {
            if (!doc) return;
            const current = playHistoryRef.current;
            const latest = current[current.length - 1];
            if (!latest) return;
            playGenRef.current += 1;
            skipWaitRef.current?.();
            stopActivePlayVoice();
            finishStage();
            const finalFrame = latest.frame;
            setPlayStageState(finalFrame.stage);
            setPlayLiveVariables(finalFrame.variables);
            setPlayTypedCount(finalFrame.stage.dialogue?.body.length ?? 0);
            setPlayEffectActive(false);
            setPlayRunning(false);
            syncBgm(
                finalFrame.stage.bgm.name ? storyBgmUrl(finalFrame.stage.bgm.name, doc.region, line) : null,
                finalFrame.stage.bgm.volume,
            );
            void applyStage(finalFrame.stage, { instant: true });
        }, [applyStage, doc, finishStage, line, stopActivePlayVoice, syncBgm]);

        const lastAppliedPlayDocRef = useRef<StoryDocument | null>(playLocalizedDoc);
        useEffect(() => {
            if (lastAppliedPlayDocRef.current === playLocalizedDoc) return;
            lastAppliedPlayDocRef.current = playLocalizedDoc;
            if (workspaceMode !== "playtest" || !playLocalizedDoc) return;
            const current = playHistoryRef.current;
            if (current.length === 0) return;
            const nextHistory = current.map(item => ({
                ...item,
                frame: localizeRuntimeFrame(item.frame, playLocalizedDoc),
            }));
            const latest = nextHistory[nextHistory.length - 1]?.frame;
            setPlayHistory(nextHistory);
            if (latest) {
                setPlayStageState(latest.stage);
                setPlayTypedCount(latest.stage.dialogue?.body.length ?? 0);
            }
        }, [playLocalizedDoc, workspaceMode]);

        const handlePlayAdvance = useCallback(() => {
            const activeTargetDoc = playLocalizedDoc ?? doc;
            const activeTargetProgram = playProgram ?? program;
            if (!activeTargetDoc || !activeTargetProgram || activeTargetProgram.errors.length > 0) return;
            unlockAudio();
            if (playUiHidden) {
                setPlayUiHidden(false);
                return;
            }
            if (playRunning) {
                snapPlayFrame();
                return;
            }
            if (playIsTyping) {
                setPlayTypedCount(playFullDialogueBody.length);
                return;
            }
            const current = playHistoryRef.current;
            const latest = current[current.length - 1];
            if (!latest || latest.frame.stoppedReason !== "blocking") return;
            const nextFrame = advanceRuntime(activeTargetProgram, latest.frame);
            if (nextFrame === latest.frame) return;
            void executePlayFrame(
                activeTargetDoc,
                [...current, { frame: nextFrame }],
                playStageStateRef.current,
                playLiveVariablesRef.current,
                nextFrame,
                false,
            );
        }, [
            doc, executePlayFrame, playFullDialogueBody.length, playIsTyping, playLocalizedDoc, playProgram,
            playRunning, playUiHidden, program, snapPlayFrame, unlockAudio,
        ]);

        const handlePlayChoose = useCallback((optionId: string, optionText: string) => {
            const activeTargetDoc = playLocalizedDoc ?? doc;
            const activeTargetProgram = playProgram ?? program;
            if (!activeTargetDoc || !activeTargetProgram || activeTargetProgram.errors.length > 0) return;
            unlockAudio();
            const current = playHistoryRef.current;
            const latest = current[current.length - 1];
            if (!latest || latest.frame.stoppedReason !== "choice") return;
            const matched = latest.frame.pendingChoice?.options.find(opt => opt.id === optionId);
            if (!matched || !matched.available) return;
            const annotated = current.map((item, idx) => (
                idx === current.length - 1 ? { ...item, chosenText: optionText } : item
            ));
            const nextFrame = advanceRuntime(activeTargetProgram, latest.frame, optionId);
            if (nextFrame === latest.frame) return;
            void executePlayFrame(
                activeTargetDoc,
                [...annotated, { frame: nextFrame }],
                playStageStateRef.current,
                playLiveVariablesRef.current,
                nextFrame,
                false,
            );
        }, [doc, executePlayFrame, playLocalizedDoc, playProgram, program, unlockAudio]);

        const handlePlayPrevious = useCallback(() => {
            if (!doc) return;
            const current = playHistoryRef.current;
            if (current.length <= 1) return;
            playGenRef.current += 1;
            skipWaitRef.current?.();
            stopActivePlayVoice();
            setStageTalking(null);
            setPlayAuto(false);
            setPlayEffectActive(false);
            setPlayRunning(false);

            const nextHistory = current.slice(0, -1).map((item, idx, arr) => (
                idx === arr.length - 1 ? { ...item, chosenText: undefined } : item
            ));
            const prevFrame = nextHistory[nextHistory.length - 1].frame;
            setPlayHistory(nextHistory);
            setPlayStageState(prevFrame.stage);
            setPlayLiveVariables(prevFrame.variables);
            setPlayTypedCount(prevFrame.stage.dialogue?.body.length ?? 0);
            syncBgm(
                prevFrame.stage.bgm.name ? storyBgmUrl(prevFrame.stage.bgm.name, doc.region, line) : null,
                prevFrame.stage.bgm.volume,
            );
            void applyStage(prevFrame.stage, { instant: true });
        }, [applyStage, doc, line, setStageTalking, stopActivePlayVoice, syncBgm]);

        const jumpPlaytestToNode = useCallback((nodeId: string) => {
            const activeTargetDoc = playLocalizedDoc ?? doc;
            const activeTargetProgram = playProgram ?? program;
            if (!activeTargetDoc || !activeTargetProgram || activeTargetProgram.errors.length > 0 || activeTargetProgram.nodeEntryPc[nodeId] === undefined) return;
            setPlayAuto(false);
            const frame = createInitialRuntime(activeTargetProgram, nodeId);
            void executePlayFrame(activeTargetDoc, [{ frame }], frame.stage, frame.variables, frame, true);
        }, [doc, executePlayFrame, playLocalizedDoc, playProgram, program]);

        const jumpPlaytestToBeat = useCallback((nodeId: string, beatId: string) => {
            const activeTargetDoc = playLocalizedDoc ?? doc;
            const activeTargetProgram = playProgram ?? program;
            if (!activeTargetDoc || !activeTargetProgram || activeTargetProgram.errors.length > 0 || activeTargetProgram.nodeEntryPc[nodeId] === undefined) return;
            setPlayAuto(false);
            let cur = createInitialRuntime(activeTargetProgram, nodeId);
            const frames: PlaytestHistoryItem[] = [{ frame: cur }];
            const maxSteps = STORY_LIMITS.beatsPerScene + 4;

            for (let step = 0; step < maxSteps; step += 1) {
                const hitInBatch = cur.beatId === beatId
                    || cur.executedInstructions.some(inst => "beatId" in inst && inst.beatId === beatId);
                if (hitInBatch) break;
                if (cur.stoppedReason !== "blocking" || cur.nodeId !== nodeId) break;
                const next = advanceRuntime(activeTargetProgram, cur);
                if (next === cur) break;
                const nextHasBeat = next.beatId === beatId
                    || next.executedInstructions.some(inst => "beatId" in inst && inst.beatId === beatId);
                if (next.nodeId !== nodeId && !nextHasBeat) break;
                cur = next;
                frames.push({ frame: cur });
            }

            void executePlayFrame(activeTargetDoc, frames, cur.stage, cur.variables, cur, true);
        }, [doc, executePlayFrame, playLocalizedDoc, playProgram, program]);

        useEffect(() => {
            if (
                workspaceMode !== "playtest" || !playAuto || playRunning || playIsTyping
                || playVoicePending || preloadOpen || issuesOpen || i18nOpen || voiceManifestOpen
                || externalDialogOpen || playCurrentChoice
            ) {
                return;
            }
            if (!playActiveFrame || playActiveFrame.stoppedReason !== "blocking") return;
            const bodyLen = playStageState.dialogue?.body.length
                ?? playStageState.narration?.body.length
                ?? playStageState.telop?.body.length
                ?? 0;
            const delay = Math.max(1200, Math.min(4500, bodyLen * 60 + 800));
            const timer = window.setTimeout(() => {
                handlePlayAdvance();
            }, delay);
            return () => window.clearTimeout(timer);
        }, [
            workspaceMode, playActiveFrame, playAuto, playCurrentChoice, handlePlayAdvance,
            i18nOpen, issuesOpen, playIsTyping, preloadOpen, playRunning, playStageState, playVoicePending,
            externalDialogOpen, voiceManifestOpen,
        ]);

        const lastMountedPlayManifestRef = useRef<StoryVoiceManifest | null>(playVoiceManifest);
        const startPlayVoiceRef = useRef(startPlayVoice);
        const stopActivePlayVoiceRef = useRef(stopActivePlayVoice);
        const unlockAudioRef = useRef(unlockAudio);
        useEffect(() => {
            startPlayVoiceRef.current = startPlayVoice;
            stopActivePlayVoiceRef.current = stopActivePlayVoice;
            unlockAudioRef.current = unlockAudio;
        }, [startPlayVoice, stopActivePlayVoice, unlockAudio]);

        useEffect(() => {
            if (lastMountedPlayManifestRef.current === playVoiceManifest) return;
            const previous = lastMountedPlayManifestRef.current;
            lastMountedPlayManifestRef.current = playVoiceManifest;
            if (workspaceModeRef.current !== "playtest") return;
            if (!playVoiceManifest) {
                if (!previous) return;
                const stopTimer = window.setTimeout(() => {
                    stopActivePlayVoiceRef.current();
                }, 0);
                return () => window.clearTimeout(stopTimer);
            }
            const timer = window.setTimeout(() => {
                const stepId = playStageStateRef.current.dialogue?.stepId;
                const activeDoc = playLocalizedDocRef.current;
                if (!stepId || !activeDoc) return;
                for (const node of Object.values(activeDoc.nodes)) {
                    if (node.type !== "scene") continue;
                    const found = node.beats.find(beat => beat.kind === "talk" && beat.id === stepId);
                    if (!found || found.kind !== "talk") continue;
                    if (found.voice?.voiceId) return;
                    const trackUrls = resolveVoiceManifestLineUrl(playVoiceManifest, stepId);
                    const manifestLine = playVoiceManifest.lines[stepId];
                    if (trackUrls.length === 0 || !manifestLine) return;
                    unlockAudioRef.current();
                    startPlayVoiceRef.current(trackUrls, { label: manifestLine.speaker || stepId }, playGenRef.current, true);
                    return;
                }
            }, 0);
            return () => window.clearTimeout(timer);
        }, [playVoiceManifest]);

        useEffect(() => {
            const sync = () => setPlayFullscreen(document.fullscreenElement === stageFullscreenRef.current);
            document.addEventListener("fullscreenchange", sync);
            return () => document.removeEventListener("fullscreenchange", sync);
        }, []);

        const togglePlayFullscreen = useCallback(() => {
            const el = stageFullscreenRef.current;
            if (!el) return;
            if (document.fullscreenElement === el) {
                void document.exitFullscreen?.().catch(() => undefined);
            } else {
                void el.requestFullscreen?.().catch(() => undefined);
            }
        }, []);

        const playtestBacklogEntries = useMemo<LivePhaseBacklogItem[]>(() => {
            const activeTargetDoc = playLocalizedDoc ?? doc;
            if (!activeTargetDoc || workspaceMode !== "playtest") return [];
            const items: LivePhaseBacklogItem[] = [];
            playHistory.forEach((entry, frameIndex) => {
                const { frame } = entry;
                frame.executedInstructions.forEach((inst, instIdx) => {
                    if (inst.op === "talk") {
                        const beat = inst.beat;
                        const member = beat.speakerKey ? activeTargetDoc.cast.find(item => item.key === beat.speakerKey) : undefined;
                        const speaker = frame.stage.dialogue?.stepId === beat.id
                            ? frame.stage.dialogue.speaker
                            : beat.speakerName
                                ? interpolateStoryText(beat.speakerName, activeTargetDoc, frame.variables)
                                : (member?.name ?? "");
                        const body = frame.stage.dialogue?.stepId === beat.id
                            ? frame.stage.dialogue.body
                            : interpolateStoryText(beat.body, activeTargetDoc, frame.variables);
                        const hasVoice = Boolean(beat.voice && beat.voice.scenarioId && beat.voice.voiceId);
                        const officialUrls = hasVoice && beat.voice
                            ? storyVoiceCandidateUrls(beat.voice, activeTargetDoc.region, line)
                            : [];
                        const manifestUrls = !hasVoice && playVoiceManifest
                            ? resolveVoiceManifestLineUrl(playVoiceManifest, beat.id)
                            : [];
                        const voiceUrls = officialUrls.length > 0 ? officialUrls : manifestUrls;
                        items.push({
                            key: `${frameIndex}-${instIdx}-${beat.id}`,
                            kind: "talk",
                            speaker,
                            body,
                            voiceUrls: voiceUrls.length > 0 ? voiceUrls : undefined,
                            voiceStart: hasVoice ? beat.voice?.start : undefined,
                            voiceEnd: hasVoice ? beat.voice?.end : undefined,
                            voiceLabel: hasVoice
                                ? beat.voice?.voiceId
                                : (playVoiceManifest?.lines[beat.id]?.speaker || (manifestUrls.length > 0 ? beat.id : undefined)),
                        });
                    } else if (inst.op === "narration") {
                        const body = frame.stage.narration?.stepId === inst.beat.id
                            ? frame.stage.narration.body
                            : interpolateStoryText(inst.beat.body, activeTargetDoc, frame.variables);
                        items.push({
                            key: `${frameIndex}-${instIdx}-${inst.beat.id}`,
                            kind: "narration",
                            body,
                        });
                    } else if (inst.op === "telop") {
                        const body = frame.stage.telop?.stepId === inst.beat.id
                            ? frame.stage.telop.body
                            : interpolateStoryText(inst.beat.text, activeTargetDoc, frame.variables);
                        items.push({
                            key: `${frameIndex}-${instIdx}-${inst.beat.id}`,
                            kind: "telop",
                            body,
                        });
                    }
                });
                if (entry.chosenText) {
                    items.push({ key: `${frameIndex}-choice`, kind: "choice", body: entry.chosenText });
                }
            });
            return items;
        }, [doc, line, playHistory, playLocalizedDoc, playVoiceManifest, workspaceMode]);

        const handlePlayReplayBacklogVoice = useCallback((item: LivePhaseBacklogItem) => {
            if (!item.voiceUrls || item.voiceUrls.length === 0) return;
            startPlayVoice(
                item.voiceUrls,
                { label: item.voiceLabel ?? "", start: item.voiceStart, end: item.voiceEnd },
                playGenRef.current,
                false,
            );
        }, [startPlayVoice]);

        // ==================== Keyboard Shortcuts (Mode-Aware) ====================

        useEffect(() => {
            const onKeyDown = (event: KeyboardEvent) => {
                const target = event.target as HTMLElement | null;
                if (
                    target
                    && (
                        target.tagName === "INPUT"
                        || target.tagName === "TEXTAREA"
                        || target.tagName === "SELECT"
                        || target.isContentEditable
                        || target.getAttribute("role") === "separator"
                    )
                ) {
                    return;
                }
                const hasOpenOverlay = Boolean(
                    metaOpen
                    || i18nOpen
                    || voiceManifestOpen
                    || externalDialogOpen
                    || issuesOpen
                    || importOpen
                    || preloadOpen
                    || target?.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-clip-picker-drawer]')
                    || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [data-clip-picker-drawer]'),
                );
                if (hasOpenOverlay) return;

                if (event.key === "Escape") {
                    if (document.fullscreenElement) return;
                    if (stageWebFullscreen) {
                        event.preventDefault();
                        setStageWebFullscreen(false);
                        return;
                    }
                }

                if (workspaceMode === "playtest") {
                    if (event.key === "Delete" || event.key === "Backspace") return;
                    if (event.key === "Escape") {
                        if (playUiHidden) {
                            event.preventDefault();
                            setPlayUiHidden(false);
                            return;
                        }
                        if (!event.defaultPrevented) {
                            event.preventDefault();
                            exitPlaytest(false);
                        }
                        return;
                    }
                    if (event.key === " " || event.key === "Enter") {
                        if (target?.tagName === "BUTTON") return;
                        event.preventDefault();
                        handlePlayAdvance();
                    } else if (event.key === "ArrowRight") {
                        event.preventDefault();
                        handlePlayAdvance();
                    } else if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        handlePlayPrevious();
                    } else if (playCurrentChoice && /^[1-4]$/.test(event.key)) {
                        const option = playCurrentChoice.options[Number(event.key) - 1];
                        if (option && option.available) {
                            event.preventDefault();
                            if (uiKit?.decideSoundUrl) playSe(uiKit.decideSoundUrl);
                            handlePlayChoose(option.id, option.text || tRef.current("page.storyMaker.player.emptyOption"));
                        }
                    }
                    return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    if (doc) {
                        dirtyDocRef.current = doc;
                        void flushSave(draftId, doc);
                        setSnack(tRef.current("page.storyMaker.editor.saveStatus.saved"));
                    }
                    return;
                }

                if (workspaceMode === "code") {
                    if (
                        event.key === "Escape"
                        && immersive
                        && !event.defaultPrevented
                        && !document.querySelector('[role="menu"]')
                    ) {
                        event.preventDefault();
                        handleImmersiveChange(false);
                    }
                    return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    if (event.shiftKey) redo();
                    else undo();
                } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
                    event.preventDefault();
                    redo();
                } else if (
                    event.key === "Escape"
                    && !event.defaultPrevented
                    && !document.querySelector('[role="menu"], [data-flow-connecting="true"], [data-clip-picker-drawer]')
                ) {
                    if (isSoloPreview) {
                        event.preventDefault();
                        clearClipPreview();
                    } else if (immersive) {
                        event.preventDefault();
                        handleImmersiveChange(false);
                    }
                } else if (
                    (event.key === "Delete" || event.key === "Backspace")
                    && !event.ctrlKey
                    && !event.metaKey
                    && !event.altKey
                    && !document.querySelector('[role="menu"], [data-clip-picker-drawer]')
                ) {
                    if (activeScene && activeBeatId) {
                        event.preventDefault();
                        handleDeleteBeat(activeScene.id, activeBeatId);
                    } else if (activeNode && activeNode.type !== "start" && doc && activeNode.id !== doc.startNodeId) {
                        event.preventDefault();
                        handleDeleteNode(activeNode.id);
                    }
                }
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
        }, [
            workspaceMode, stageWebFullscreen, playUiHidden, exitPlaytest, handlePlayAdvance, handlePlayPrevious,
            playCurrentChoice, uiKit?.decideSoundUrl, playSe, handlePlayChoose,
            undo, redo, immersive, handleImmersiveChange, isSoloPreview, clearClipPreview,
            metaOpen, i18nOpen, voiceManifestOpen, externalDialogOpen, issuesOpen, importOpen, preloadOpen,
            activeScene, activeBeatId, activeNode, doc, draftId, flushSave,
            handleDeleteBeat, handleDeleteNode,
        ]);

        // ==================== Edit Preview & Graph Actions ====================

        const previewChoice = useMemo<GameStageChoiceProp | null>(() => {
            if (!stageDoc || !previewTargetNodeId) return null;
            const targetNode = stageDoc.nodes[previewTargetNodeId];
            if (!targetNode || targetNode.type !== "choice") return null;
            return {
                id: targetNode.id,
                options: targetNode.options.map(opt => ({
                    id: opt.id,
                    text: interpolateStoryText(opt.text, stageDoc, evaluated.variables),
                    available: opt.condition ? evaluateCondition(opt.condition, evaluated.variables) : true,
                })),
            };
        }, [stageDoc, previewTargetNodeId, evaluated.variables]);

        const previewingCastMember = useMemo(
            () => (
                (stageDoc && previewingCastKey
                    ? stageDoc.cast.find(member => member.key === previewingCastKey) ?? null
                    : null)
                ?? previewingCast
            ),
            [stageDoc, previewingCastKey, previewingCast],
        );

        const replayActionInfo = useMemo(() => {
            if (workspaceMode !== "edit" || !doc || !activeBeat) return null;
            if (activeBeat.kind === "talk" && activeBeat.speakerKey && (activeBeat.motion || activeBeat.facial)) {
                const member = doc.cast.find(item => item.key === activeBeat.speakerKey);
                if (!member) return null;
                return { member, clip: { motion: activeBeat.motion, facial: activeBeat.facial } };
            }
            if (activeBeat.kind === "stageAction" && activeBeat.castKey && (activeBeat.motion || activeBeat.facial)) {
                const member = doc.cast.find(item => item.key === activeBeat.castKey);
                if (!member) return null;
                return { member, clip: { motion: activeBeat.motion, facial: activeBeat.facial } };
            }
            return null;
        }, [workspaceMode, doc, activeBeat]);

        const stageRuntimeBlocked = stagePhase.kind === "unavailable" || stagePhase.kind === "unsupported";

        const handlePreviewClip = useCallback((castMember: StoryCastMember, clip?: { motion?: string; facial?: string }) => {
            if (stageRuntimeBlocked) {
                setSnack(tRef.current("page.storyMaker.nle.previewNeedsWebgpu"));
                return;
            }
            void previewClip(castMember, clip);
        }, [previewClip, stageRuntimeBlocked]);

        const handlePreviewEffect = useCallback((cue: { cueType: "flash" | "shake"; color?: StoryEffectColor; duration?: number }) => {
            if (cue.cueType === "flash") {
                flashKeyRef.current += 1;
                setFlash({ key: flashKeyRef.current, color: cue.color ?? "white", seconds: cue.duration ?? 0.4 });
            } else {
                void shakeStage(cue.duration ?? 0.4);
            }
        }, [shakeStage]);

        const defaultNewNodeTitle = useCallback((currentDoc: StoryDocument, nodeType: "scene" | "choice" | "condition" | "end") => {
            if (nodeType === "scene") {
                const count = Object.values(currentDoc.nodes).filter(n => n.type === "scene").length + 1;
                return tRef.current("page.storyMaker.flow.newSceneDefaultName", { n: count });
            }
            return tRef.current(`page.storyMaker.v2.nodeTypes.${nodeType}`);
        }, []);

        const nextNodePos = useCallback((
            currentDoc: StoryDocument,
            nodeType: "scene" | "choice" | "condition" | "end",
        ): StoryNodePos => {
            const viewportCenter = flowViewportRef.current?.getViewportCenterPos(nodeType) ?? null;
            let x: number;
            let y: number;
            if (viewportCenter) {
                x = viewportCenter.x;
                y = viewportCenter.y;
            } else {
                const anchor = activeNodeId ? currentDoc.nodes[activeNodeId] : undefined;
                if (anchor) {
                    x = anchor.pos.x + GRAPH_COL_GAP;
                    y = anchor.pos.y + 40;
                } else {
                    const count = Object.keys(currentDoc.nodes).length;
                    x = GRAPH_ORIGIN_X + count * 48;
                    y = GRAPH_ORIGIN_Y + count * 32;
                }
            }
            const existingNodes = Object.values(currentDoc.nodes);
            for (let step = 0; step < 24; step += 1) {
                const collides = existingNodes.some(
                    node => Math.abs(node.pos.x - x) < 24 && Math.abs(node.pos.y - y) < 24,
                );
                if (!collides) break;
                x = clampCoord(x + 32);
                y = clampCoord(y + 32);
            }
            return { x: clampCoord(x), y: clampCoord(y) };
        }, [activeNodeId]);

        const handleAddNode = useCallback((nodeType: "scene" | "choice" | "condition" | "end", pos?: StoryNodePos) => {
            if (!doc) return;
            const targetPos = pos ?? nextNodePos(doc, nodeType);
            const title = defaultNewNodeTitle(doc, nodeType);
            const res = createNode(doc, nodeType, targetPos, { title });
            if (!res.node) return;
            const createdId = res.node.id;
            commit(() => res.doc);
            setSelectedNodeId(createdId);
            setSelectedBeatId(null);
        }, [commit, defaultNewNodeTitle, doc, nextNodePos]);

        const handleContinueScene = useCallback((sceneId: string, options?: ContinueSceneOptions) => {
            if (!doc) return;
            const source = doc.nodes[sceneId];
            if (!source || source.type !== "scene") return;
            const baseTitle = source.title.trim() || defaultNewNodeTitle(doc, "scene");
            const suffix = tRef.current("page.storyMaker.v2.scene.continueSuffix");
            const title = options?.title ?? `${baseTitle} (${suffix})`;
            const res = continueAndCutScene(doc, sceneId, { ...options, title });
            if (!res.node) return;
            const createdNode = res.node;
            commit(() => res.doc);
            setSelectedNodeId(createdNode.id);
            setSelectedBeatId(createdNode.beats[0]?.id ?? null);
        }, [commit, defaultNewNodeTitle, doc]);

        const handleDuplicateNode = useCallback((nodeId: string) => {
            if (!doc) return;
            const res = duplicateNode(doc, nodeId);
            if (!res.node) return;
            const createdId = res.node.id;
            commit(() => res.doc);
            setSelectedNodeId(createdId);
            setSelectedBeatId(null);
        }, [commit, doc]);

        const handleDuplicateBeat = useCallback((nodeId: string, beatId: string) => {
            if (!doc) return;
            const res = duplicateBeat(doc, nodeId, beatId);
            if (!res.beat) return;
            const createdBeatId = res.beat.id;
            commit(() => res.doc);
            setSelectedNodeId(nodeId);
            setSelectedBeatId(createdBeatId);
        }, [commit, doc]);

        const handleDropPayload = useCallback((payload: StoryDragPayload, target: StoryDropTarget) => {
            setActiveDragPayload(null);
            if (!doc) return;
            const enrichedTarget: StoryDropTarget = target.zone === "canvas" && payload.kind === "node" && !target.title
                ? { ...target, title: defaultNewNodeTitle(doc, payload.nodeType) }
                : target;
            const res = applyDragPayloadToTarget(doc, payload, enrichedTarget);
            if (res.doc === doc) return;
            commit(() => res.doc);
            if (res.nodeId) {
                setSelectedNodeId(res.nodeId);
                setSelectedBeatId(res.beatId ?? null);
            }
        }, [commit, defaultNewNodeTitle, doc]);

        const handleQuickDrop = useCallback((payload: StoryDragPayload) => {
            if (!doc) return;
            if (payload.kind === "node") {
                handleAddNode(payload.nodeType);
                return;
            }
            const targetScene = activeScene ?? Object.values(doc.nodes).find((n): n is SceneNode => n.type === "scene") ?? null;
            if (!targetScene) {
                setSnack(tRef.current("page.storyMaker.v2.palette.dropTargetCanvas"));
                return;
            }
            const zones = acceptsTarget(payload);
            let zone = zones[0];
            if (
                payload.kind === "asset-cast"
                && targetScene.stageCast.mode === "set"
                && targetScene.stageCast.actors.some(a => a.castKey === payload.castKey)
            ) {
                zone = "beat-track";
            }
            if (!zone || zone === "canvas") return;
            const res = applyDragPayloadToTarget(doc, payload, { zone, nodeId: targetScene.id });
            if (res.doc === doc) return;
            commit(() => res.doc);
            setSelectedNodeId(targetScene.id);
            setSelectedBeatId(res.beatId ?? null);
            flowViewportRef.current?.ensureNodeVisible(targetScene.id, targetScene.pos);
        }, [activeScene, commit, doc, handleAddNode]);

        const handleUpdateMeta = (values: StoryMetaValues) => {
            if (!doc) return;
            const next = applyMetaValuesToDoc(doc, values);
            commit(() => next);
            if (workspaceMode === "code" && !codeDirty) {
                const serialized = serializeStoryScript(next);
                setCodeText(serialized);
                setCodeSyncedBase(serialized);
                setCodePreviewDoc(next);
            }
            setMetaOpen(false);
        };

        const handleImportIntoCurrentDraft = (importedDoc: StoryDocument) => {
            if (workspaceMode === "playtest") exitPlaytest(false);
            setImportOpen(false);
            setPlayVoiceManifest(null);
            setPlaySelectedLocale(null);
            applyCodeDoc(importedDoc, true, false);
            setSnack(t("page.storyMaker.landing.importedToast"));
        };

        const handleCopyScriptFromMenu = async () => {
            if (!doc) return;
            const source = workspaceMode === "code" ? codeText : serializeStoryScript(doc);
            try {
                await navigator.clipboard.writeText(source);
                setSnack(t("page.storyMaker.v2.script.copied"));
            } catch {
                // Clipboard write denied.
            }
        };

        const handleCreateStarterHere = async () => {
            const created = await storage.createDraft(buildStarter("jp"));
            if (onCreatedDraft) {
                onCreatedDraft(created.id);
            } else {
                navigate(`/story-maker/edit?id=${encodeURIComponent(created.id)}`);
            }
        };

        // ==================== Multi-Axis Resizable Splitters ====================

        const handleSplitPointerDown = (axis: SplitDragAxis, event: React.PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0 && event.pointerType === "mouse") return;
            event.currentTarget.setPointerCapture(event.pointerId);
            splitDragRef.current = { axis, pointerId: event.pointerId };
        };

        const handleSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
            const active = splitDragRef.current;
            if (!active || active.pointerId !== event.pointerId) return;

            if (active.axis === "horizontal") {
                const container = nleContainerRef.current;
                if (!container) return;
                const rect = container.getBoundingClientRect();
                if (rect.height <= 0) return;
                const rawPct = ((event.clientY - rect.top) / rect.height) * 100;
                updateEditorLayout({ topSplitPct: rawPct });
                return;
            }

            const row = topRowRef.current;
            if (!row) return;
            const rect = row.getBoundingClientRect();
            if (rect.width <= 0) return;

            if (active.axis === "code") {
                const rawPct = ((event.clientX - rect.left) / rect.width) * 100;
                updateEditorLayout({ codeSplitPct: rawPct });
                return;
            }

            const rightReserved = workspaceMode !== "code" && layout.showRightPane ? layout.rightWidthPx : 0;
            const leftReserved = layout.showLeftPane ? layout.leftWidthPx : 0;

            if (active.axis === "left") {
                const maxAllowed = Math.min(
                    EDITOR_LAYOUT_LIMITS.leftMax,
                    Math.max(EDITOR_LAYOUT_LIMITS.leftMin, rect.width - rightReserved - EDITOR_LAYOUT_LIMITS.centerMin),
                );
                const rawPx = event.clientX - rect.left;
                updateEditorLayout({ leftWidthPx: Math.min(maxAllowed, rawPx) });
            } else if (active.axis === "right") {
                const maxAllowed = Math.min(
                    EDITOR_LAYOUT_LIMITS.rightMax,
                    Math.max(EDITOR_LAYOUT_LIMITS.rightMin, rect.width - leftReserved - EDITOR_LAYOUT_LIMITS.centerMin),
                );
                const rawPx = rect.right - event.clientX;
                updateEditorLayout({ rightWidthPx: Math.min(maxAllowed, rawPx) });
            }
        };

        const handleSplitPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
            if (splitDragRef.current?.pointerId === event.pointerId) {
                splitDragRef.current = null;
            }
        };

        if (loading) {
            return <PageContainer wide><LoadingState /></PageContainer>;
        }

        if (loadError || !doc || !program || !stageDoc) {
            return (
                <PageContainer>
                    <EmptyState
                        title={t(loadError === "unavailable" ? "page.storyMaker.storage.unavailableTitle" : "page.storyMaker.editor.notFoundTitle")}
                        description={t(loadError === "unavailable" ? "page.storyMaker.storage.unavailableDescription" : "page.storyMaker.editor.notFoundDescription")}
                        action={(
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                {onBackToDrafts ? (
                                    <Button variant="filled" icon={mdArrowBack} onClick={onBackToDrafts}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                ) : (
                                    <Button variant="filled" icon={mdArrowBack} href={backToDraftsHref}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                )}
                                {loadError !== "unavailable" && (
                                    <Button variant="tonal" icon={mdStar} onClick={() => void handleCreateStarterHere()}>
                                        {t("page.storyMaker.landing.tryStarter")}
                                    </Button>
                                )}
                            </div>
                        )}
                    />
                </PageContainer>
            );
        }

        const isPlaytest = workspaceMode === "playtest";
        const isCodeMode = workspaceMode === "code";
        const isEditMode = workspaceMode === "edit";
        const saveStatusLabel = t(`page.storyMaker.editor.saveStatus.${saveStatus}`);
        const modelArray = models ?? [];

        const showLeftPane = isCodeMode || layout.showLeftPane;
        const showRightPane = !isCodeMode && layout.showRightPane;
        const showBottomPane = !isCodeMode && layout.showBottomPane;

        const playStoppedReason = playActiveFrame?.stoppedReason ?? null;
        const playReachedEnding = isPlaytest && !playRunning && playStoppedReason === "end" && Boolean(playActiveFrame?.ending);
        const playLooped = isPlaytest && !playRunning && playStoppedReason === "loop";
        const playDisconnected = isPlaytest && !playRunning && playStoppedReason === "disconnected";
        const playEnded = playReachedEnding || playLooped || playDisconnected;
        const playHasAnyContent = Object.values(doc.nodes).some(node => node.type !== "start");
        const playEmptyStory = isPlaytest && !playHasAnyContent;
        const playStageClickBlocked = Boolean(playCurrentChoice) || playEnded || playEmptyStory;
        const playShowEndSign = isPlaytest && !playUiHidden && !playRunning && !playIsTyping && !playAuto && !playCurrentChoice && Boolean(playStageState.dialogue);
        const playDisplayState: StoryStageState = playUiHidden
            ? { ...playStageState, place: null, dialogue: null, narration: null, telop: null }
            : playStageState;
        const playRuntimePhase: StoryRuntimePhase = playEnded || playEmptyStory
            ? "ended"
            : playCurrentChoice
                ? "choice"
                : playEffectActive
                    ? "effect"
                    : playIsTyping
                        ? "typing"
                        : playVoicePending
                            ? "voice"
                            : playRunning
                                ? "effect"
                                : playAuto
                                    ? "auto"
                                    : "waiting";

        const slotCtx: EditorSlotContext = {
            doc,
            effectiveDoc: effectiveDoc ?? doc,
            draftId,
            workspaceMode,
            selectedNodeId: activeNodeId,
            selectedBeatId: activeBeatId,
            errorCount,
            warningCount,
            hasBlockingErrors: errorCount > 0,
            saveStatus,
            notify: setSnack,
            openVoiceManifestDialog: (tab = "import") => {
                setVoiceManifestInitialTab(tab);
                setVoiceManifestOpen(true);
            },
            applyVoiceManifest: setPlayVoiceManifest,
            commitDoc: commit,
            requestExport: handleExportAction,
            setWorkspaceMode: handleWorkspaceModeChange,
        };

        const hostFileMenuItems = slots?.fileMenuItems?.(slotCtx) ?? [];
        const voiceUploadTab = slots?.voiceManifestUploadTab?.(slotCtx) ?? null;
        const sidePanelNode = slots?.sidePanel?.(slotCtx) ?? null;

        const fileMenuItems: MenuItemDef[] = [
            ...(onBackToDrafts
                ? [{
                    key: "back-drafts",
                    label: t("page.storyMaker.action.backToDrafts"),
                    icon: mdArrowBack,
                    onSelect: onBackToDrafts,
                }]
                : [{
                    key: "back-drafts",
                    label: t("page.storyMaker.action.backToDrafts"),
                    icon: mdArrowBack,
                    href: backToDraftsHref,
                }]),
            ...(homeHref ? [{
                key: "back-home",
                label: t("page.storyMaker.v2.ide.backHome"),
                icon: mdHome,
                href: homeHref,
            }] : []),
            {
                key: "meta",
                label: t("page.storyMaker.editor.storySettings"),
                icon: mdSettings,
                disabled: isPlaytest,
                dividerBefore: true,
                onSelect: () => setMetaOpen(true),
            },
            {
                key: "i18n-packs",
                label: t("page.storyMaker.i18n.toolbarButton"),
                icon: mdTranslate,
                disabled: isPlaytest,
                onSelect: () => setI18nOpen(true),
            },
            {
                key: "load-voice-manifest",
                label: t("page.storyMaker.voiceTrack.action"),
                icon: mdRecordVoiceOver,
                onSelect: () => {
                    setVoiceManifestInitialTab("import");
                    setVoiceManifestOpen(true);
                },
            },
            ...hostFileMenuItems,
            {
                key: "import-msk",
                label: t("page.storyMaker.v2.ide.importIntoDraft"),
                icon: mdUploadFile,
                disabled: isPlaytest,
                dividerBefore: hostFileMenuItems.length === 0,
                onSelect: () => setImportOpen(true),
            },
            {
                key: "copy-msk",
                label: t("page.storyMaker.v2.script.copyCode"),
                icon: mdContentCopy,
                onSelect: () => void handleCopyScriptFromMenu(),
            },
            {
                key: "export-msk",
                label: t("page.storyMaker.v2.script.downloadScript"),
                icon: mdDownload,
                onSelect: handleExportAction,
            },
            {
                key: "preload",
                label: t("page.storyMaker.preload.buttonLabel"),
                icon: mdDownload,
                dividerBefore: true,
                onSelect: () => setPreloadOpen(true),
            },
        ];

        const editMenuItems: MenuItemDef[] = [
            {
                key: "undo",
                label: t("page.storyMaker.editor.undo"),
                icon: mdUndo,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+Z</span>,
                disabled: !isEditMode || past.length === 0,
                onSelect: undo,
            },
            {
                key: "redo",
                label: t("page.storyMaker.editor.redo"),
                icon: mdRedo,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+Y</span>,
                disabled: !isEditMode || future.length === 0,
                onSelect: redo,
            },
            {
                key: "auto-layout",
                label: t("page.storyMaker.flow.autoLayout"),
                icon: mdAccountTree,
                disabled: !isEditMode,
                dividerBefore: true,
                onSelect: () => commit(current => autoLayoutGraph(current)),
            },
            {
                key: "add-scene",
                label: t("page.storyMaker.flow.addScene"),
                icon: mdMovie,
                disabled: !isEditMode,
                onSelect: () => handleAddNode("scene"),
            },
            {
                key: "add-choice",
                label: t("page.storyMaker.flow.addChoice"),
                icon: mdAltRoute,
                disabled: !isEditMode,
                onSelect: () => handleAddNode("choice"),
            },
            {
                key: "add-condition",
                label: t("page.storyMaker.v2.nodeTypes.condition"),
                icon: mdCalculate,
                disabled: !isEditMode,
                onSelect: () => handleAddNode("condition"),
            },
            {
                key: "add-end",
                label: t("page.storyMaker.v2.nodeTypes.end"),
                icon: mdFlag,
                disabled: !isEditMode,
                onSelect: () => handleAddNode("end"),
            },
        ];

        const viewMenuItems: MenuItemDef[] = [
            {
                key: "toggle-left",
                label: t("page.storyMaker.v2.ide.toggleLeftPane"),
                selected: layout.showLeftPane,
                disabled: isCodeMode,
                onSelect: () => updateEditorLayout(prev => ({ ...prev, showLeftPane: !prev.showLeftPane })),
            },
            {
                key: "toggle-bottom",
                label: t("page.storyMaker.v2.ide.toggleBottomPane"),
                selected: layout.showBottomPane,
                disabled: isCodeMode,
                onSelect: () => updateEditorLayout(prev => ({ ...prev, showBottomPane: !prev.showBottomPane })),
            },
            {
                key: "toggle-right",
                label: t("page.storyMaker.v2.ide.toggleRightPane"),
                selected: layout.showRightPane,
                disabled: isCodeMode,
                onSelect: () => updateEditorLayout(prev => ({ ...prev, showRightPane: !prev.showRightPane })),
            },
            {
                key: "web-fullscreen",
                label: t("page.storyMaker.v2.ide.webFullscreen"),
                selected: stageWebFullscreen,
                dividerBefore: true,
                onSelect: () => setStageWebFullscreen(prev => !prev),
            },
            {
                key: "immersive",
                label: t("page.storyMaker.nle.enterImmersive"),
                selected: immersive,
                onSelect: () => handleImmersiveChange(!immersive),
            },
            {
                key: "reset-layout",
                label: t("page.storyMaker.v2.ide.resetLayout"),
                icon: mdRestartAlt,
                dividerBefore: true,
                onSelect: resetEditorLayout,
            },
        ];

        const hasReplacedTopBar = typeof slots?.replaceTopBar === "function";
        const topBarCtx: EditorTopBarSlotContext = {
            ...slotCtx,
            title: doc.meta.title || t("page.storyMaker.untitled"),
            region: doc.region,
            regionLabel: t(SERVER_LABEL_KEYS[doc.region]),
            fileMenuItems,
            editMenuItems,
            viewMenuItems,
            canUndo: isEditMode && past.length > 0,
            canRedo: isEditMode && future.length > 0,
            undo,
            redo,
            saveStatusLabel,
            saveNow: async () => {
                dirtyDocRef.current = doc;
                await flushSave(draftId, doc);
            },
            attachedLocaleCount,
            hasVoiceManifest: hasPlayVoiceTrackManifest,
            openMetaDialog: () => setMetaOpen(true),
            openI18nDialog: () => setI18nOpen(true),
            openIssuesDialog: () => setIssuesOpen(true),
            openPreloadDialog: () => setPreloadOpen(true),
            openImportDialog: () => setImportOpen(true),
            layout,
            toggleLeft: () => updateEditorLayout(prev => ({ ...prev, showLeftPane: !prev.showLeftPane })),
            toggleRight: () => updateEditorLayout(prev => ({ ...prev, showRightPane: !prev.showRightPane })),
            toggleBottom: () => updateEditorLayout(prev => ({ ...prev, showBottomPane: !prev.showBottomPane })),
            resetLayout: resetEditorLayout,
            isFullscreen: stageWebFullscreen,
            toggleFullscreen: () => setStageWebFullscreen(prev => !prev),
            onBackToDrafts,
            backToDraftsHref,
        };

        return (
            <div
                key="editor-root"
                className={cn(
                    "min-w-0",
                    immersive
                        ? hasReplacedTopBar
                            ? "fixed inset-0 z-[150] flex flex-col overflow-hidden bg-surface"
                            : "fixed inset-0 z-[150] flex flex-col gap-1.5 overflow-hidden bg-surface p-1.5 sm:p-2"
                        : "mx-auto w-full max-w-[1720px] space-y-2 px-3 py-2.5 sm:px-5 sm:py-3",
                )}
            >
                {hasReplacedTopBar ? (
                    slots!.replaceTopBar!(topBarCtx)
                ) : (
                    <>
                        {/* Optional Host Workspace Bar (e.g. Electron native project bar) */}
                        {slots?.workspaceBar?.(slotCtx)}

                        {/* Slim Permanent IDE Menu Bar */}
                        <header
                            className={cn(
                                "flex h-11 min-w-0 shrink-0 items-center justify-between gap-2 rounded-md3-lg border bg-surface-container-low px-2 transition-colors",
                                isPlaytest ? "border-primary/45 bg-primary-container/10" : "border-outline-variant/60",
                            )}
                        >
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        {onBackToDrafts ? (
                            <button
                                type="button"
                                onClick={onBackToDrafts}
                                title={t("page.storyMaker.title")}
                                className="focus-ring flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md3-sm px-1.5 py-1"
                            >
                                <span
                                    className="block h-5 w-[3.25rem] bg-primary"
                                    style={{
                                        maskImage: `url(${brandLogoUrl})`,
                                        maskSize: "contain",
                                        maskPosition: "center",
                                        maskRepeat: "no-repeat",
                                        WebkitMaskImage: `url(${brandLogoUrl})`,
                                        WebkitMaskSize: "contain",
                                        WebkitMaskPosition: "center",
                                        WebkitMaskRepeat: "no-repeat",
                                    }}
                                />
                                <span className="rounded-md3-xs bg-tertiary-container px-1 py-0.5 text-[10px] font-semibold leading-none text-on-tertiary-container">
                                    {t("page.storyMaker.betaBadge")}
                                </span>
                            </button>
                        ) : (
                            <StudioLink
                                href={backToDraftsHref}
                                title={t("page.storyMaker.title")}
                                className="focus-ring flex shrink-0 items-center gap-1.5 rounded-md3-sm px-1.5 py-1"
                            >
                                <span
                                    className="block h-5 w-[3.25rem] bg-primary"
                                    style={{
                                        maskImage: `url(${brandLogoUrl})`,
                                        maskSize: "contain",
                                        maskPosition: "center",
                                        maskRepeat: "no-repeat",
                                        WebkitMaskImage: `url(${brandLogoUrl})`,
                                        WebkitMaskSize: "contain",
                                        WebkitMaskPosition: "center",
                                        WebkitMaskRepeat: "no-repeat",
                                    }}
                                />
                                <span className="rounded-md3-xs bg-tertiary-container px-1 py-0.5 text-[10px] font-semibold leading-none text-on-tertiary-container">
                                    {t("page.storyMaker.betaBadge")}
                                </span>
                            </StudioLink>
                        )}

                        <nav aria-label={t("page.storyMaker.title")} className="flex shrink-0 items-center gap-0.5">
                            <IdeMenuTrigger label={t("page.storyMaker.v2.ide.menuFile")} items={fileMenuItems} />
                            <IdeMenuTrigger label={t("page.storyMaker.v2.ide.menuEdit")} items={editMenuItems} />
                            <IdeMenuTrigger label={t("page.storyMaker.v2.ide.menuView")} items={viewMenuItems} />
                        </nav>

                        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-outline-variant/60" />

                        <button
                            type="button"
                            disabled={isPlaytest}
                            onClick={() => setMetaOpen(true)}
                            title={doc.meta.title || t("page.storyMaker.untitled")}
                            className={cn(
                                "state-layer focus-ring flex min-w-0 items-center gap-1.5 rounded-md3-sm px-1.5 py-0.5 text-left",
                                isPlaytest ? "cursor-default" : "cursor-pointer",
                            )}
                        >
                            <span className="max-w-[14rem] truncate type-label-l text-on-surface">
                                {doc.meta.title || t("page.storyMaker.untitled")}
                            </span>
                            <span className="hidden shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 type-label-s text-on-surface-variant xl:inline">
                                {t(SERVER_LABEL_KEYS[doc.region])}
                            </span>
                        </button>
                    </div>

                    <SegmentedButton<StoryEditorWorkspaceMode>
                        density={-2}
                        value={workspaceMode}
                        onValueChange={handleWorkspaceModeChange}
                        aria-label={t("page.storyMaker.v2.mode.edit")}
                        className="w-auto shrink-0"
                        options={[
                            { value: "edit", label: t("page.storyMaker.v2.mode.edit"), icon: mdEdit },
                            { value: "playtest", label: t("page.storyMaker.v2.mode.playtest"), icon: mdPlayArrowFill },
                            { value: "code", label: t("page.storyMaker.v2.mode.code"), icon: mdCode },
                        ]}
                    />

                    <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1">
                        {isEditMode && (
                            <div className={cn("shrink-0 items-center gap-0.5", showBottomPane ? "hidden xl:inline-flex" : "inline-flex")}>
                                <IconButton
                                    size="xs"
                                    icon={mdUndo}
                                    label={t("page.storyMaker.editor.undo")}
                                    disabled={past.length === 0}
                                    onClick={undo}
                                />
                                <IconButton
                                    size="xs"
                                    icon={mdRedo}
                                    label={t("page.storyMaker.editor.redo")}
                                    disabled={future.length === 0}
                                    onClick={redo}
                                />
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={isPlaytest}
                            onClick={() => setI18nOpen(true)}
                            title={t("page.storyMaker.i18n.toolbarButton")}
                            className={cn(
                                "state-layer focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md3-full px-2 type-label-s transition-colors",
                                isPlaytest
                                    ? "cursor-default bg-surface-container text-on-surface-variant opacity-50"
                                    : attachedLocaleCount > 0
                                        ? "cursor-pointer bg-primary-container text-on-primary-container"
                                        : "cursor-pointer bg-surface-container text-on-surface hover:bg-surface-container-high",
                            )}
                        >
                            <Icon path={mdTranslate} size={14} className="shrink-0" />
                            <span className="hidden xl:inline">{t("page.storyMaker.i18n.toolbarButton")}</span>
                            {attachedLocaleCount > 0 && (
                                <span className="rounded-md3-full bg-surface/70 px-1.5 font-mono tabular-nums text-on-surface">
                                    {attachedLocaleCount}
                                </span>
                            )}
                        </button>

                        <IconButton
                            size="xs"
                            variant={hasPlayVoiceTrackManifest ? "tonal" : "standard"}
                            icon={mdRecordVoiceOver}
                            label={t("page.storyMaker.voiceTrack.action")}
                            onClick={() => {
                                setVoiceManifestInitialTab("import");
                                setVoiceManifestOpen(true);
                            }}
                        />

                        {/* Host-injected toolbar actions (e.g. Web Publish pill or Desktop Pi Agent / Export buttons) */}
                        {slots?.toolbarActions?.(slotCtx)}

                        <button
                            type="button"
                            onClick={() => setIssuesOpen(true)}
                            title={
                                errorCount > 0
                                    ? t("page.storyMaker.v2.compiler.statusErrors", { count: errorCount })
                                    : warningCount > 0
                                        ? t("page.storyMaker.v2.compiler.statusWarnings", { count: warningCount })
                                        : t("page.storyMaker.v2.compiler.statusOk")
                            }
                            className={cn(
                                "state-layer focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md3-full px-2 type-label-s transition-colors",
                                errorCount > 0
                                    ? "bg-error-container text-on-error-container"
                                    : warningCount > 0
                                        ? "bg-tertiary-container text-on-tertiary-container"
                                        : "bg-surface-container text-on-surface-variant hover:text-on-surface",
                            )}
                        >
                            <Icon
                                path={errorCount > 0 ? mdErrorFill : warningCount > 0 ? mdWarning : mdCheckCircle}
                                size={14}
                                className={cn(
                                    "shrink-0",
                                    errorCount === 0 && warningCount === 0 && "text-primary",
                                )}
                            />
                            {errorCount > 0 ? (
                                <span className="font-mono tabular-nums">{errorCount}</span>
                            ) : warningCount > 0 ? (
                                <span className="font-mono tabular-nums">{warningCount}</span>
                            ) : (
                                <span className="hidden xl:inline">{t("page.storyMaker.v2.compiler.statusOk")}</span>
                            )}
                        </button>

                        <button
                            type="button"
                            disabled={saveStatus === "saving"}
                            onClick={() => {
                                if (saveStatus === "error" || saveStatus === "dirty") {
                                    dirtyDocRef.current = doc;
                                    void flushSave(draftId, doc);
                                }
                            }}
                            title={saveStatus === "error" ? `${saveStatusLabel} — ${t("common.action.retry")}` : saveStatusLabel}
                            className={cn(
                                "focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md3-full px-2 type-label-s transition-colors",
                                saveStatus === "error"
                                    ? "state-layer cursor-pointer bg-error-container text-on-error-container"
                                    : saveStatus === "dirty"
                                        ? "state-layer cursor-pointer bg-surface-container text-on-surface-variant hover:text-on-surface"
                                        : "cursor-default bg-surface-container text-on-surface-variant",
                            )}
                        >
                            <Icon
                                path={saveStatus === "error" ? mdErrorFill : mdCloudDone}
                                size={14}
                                className={cn("shrink-0", saveStatus === "saved" && "text-primary")}
                            />
                            <span className="whitespace-nowrap">{saveStatusLabel}</span>
                            {saveStatus === "error" && (
                                <span className="ml-0.5 underline">{t("common.action.retry")}</span>
                            )}
                        </button>

                        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-outline-variant/60" />

                        {!isCodeMode && (
                            <>
                                <IconButton
                                    size="xs"
                                    icon={layout.showLeftPane ? mdLeftPanelClose : mdLeftPanelOpen}
                                    label={t("page.storyMaker.v2.ide.toggleLeftPane")}
                                    selected={layout.showLeftPane}
                                    onClick={() => updateEditorLayout(prev => ({ ...prev, showLeftPane: !prev.showLeftPane }))}
                                />
                                <IconButton
                                    size="xs"
                                    icon={layout.showBottomPane ? mdBottomPanelClose : mdBottomPanelOpen}
                                    label={t("page.storyMaker.v2.ide.toggleBottomPane")}
                                    selected={layout.showBottomPane}
                                    onClick={() => updateEditorLayout(prev => ({ ...prev, showBottomPane: !prev.showBottomPane }))}
                                />
                                <IconButton
                                    size="xs"
                                    icon={layout.showRightPane ? mdRightPanelClose : mdRightPanelOpen}
                                    label={t("page.storyMaker.v2.ide.toggleRightPane")}
                                    selected={layout.showRightPane}
                                    onClick={() => updateEditorLayout(prev => ({ ...prev, showRightPane: !prev.showRightPane }))}
                                />
                            </>
                        )}

                        <IconButton
                            size="xs"
                            icon={stageWebFullscreen ? mdCloseFullscreen : mdFitScreen}
                            label={t(stageWebFullscreen ? "page.storyMaker.v2.ide.exitWebFullscreen" : "page.storyMaker.v2.ide.webFullscreen")}
                            selected={stageWebFullscreen}
                            onClick={() => setStageWebFullscreen(prev => !prev)}
                        />
                    </div>
                </header>
                    </>
                )}

                {stagePhase.kind === "unavailable" && (
                    <Banner
                        tone="info"
                        title={t("page.storyMaker.engine.unavailable")}
                        className={cn(immersive && hasReplacedTopBar && "mx-1.5 mt-1.5 sm:mx-2 sm:mt-2")}
                    >
                        {t("page.storyMaker.engine.unavailableBanner")}
                    </Banner>
                )}
                {stagePhase.kind === "unsupported" && (
                    <Banner
                        tone="warning"
                        title={t("page.storyMaker.engine.unsupported")}
                        className={cn(immersive && hasReplacedTopBar && "mx-1.5 mt-1.5 sm:mx-2 sm:mt-2")}
                    >
                        {t("page.storyMaker.engine.unsupportedBanner")}
                    </Banner>
                )}

                {/* Main Workspace Row: NLE Cockpit + Optional Docked Host Side Panel */}
                <div
                    className={cn(
                        "flex min-w-0 gap-1.5 overflow-hidden",
                        immersive
                            ? cn("min-h-0 flex-1", hasReplacedTopBar && "p-1.5 sm:p-2")
                            : "h-[calc(100svh-8rem)] min-h-[42rem]",
                    )}
                >
                    <div
                        ref={nleContainerRef}
                        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
                    >
                        <div
                            key="top-workspace-row"
                            ref={topRowRef}
                            style={showBottomPane ? { height: `${layout.topSplitPct}%` } : undefined}
                            className={cn(
                                "flex min-h-0 min-w-0 gap-0 overflow-hidden",
                                showBottomPane ? "shrink-0" : "flex-1",
                            )}
                        >
                            {showLeftPane && (
                                <Surface
                                    key="desktop-left-pane"
                                    tone="low"
                                    radius="xl"
                                    style={
                                        isCodeMode
                                            ? { width: `${layout.codeSplitPct}%` }
                                            : { width: `${layout.leftWidthPx}px` }
                                    }
                                    className={cn(
                                        "flex min-h-0 shrink-0 flex-col overflow-hidden border border-outline-variant/50",
                                        !isCodeMode && "max-w-[46%]",
                                        isPlaytest && "border-primary/35",
                                    )}
                                >
                                    {isCodeMode ? (
                                        <StoryCodeWorkspace
                                            doc={doc}
                                            codeText={codeText}
                                            isDirty={codeDirty}
                                            evaluation={codeEval}
                                            onChangeCode={setCodeText}
                                            onApply={nextDoc => applyCodeDoc(nextDoc, false)}
                                            onApplyAndPlaytest={handleApplyCodeAndPlaytest}
                                            onReset={() => {
                                                const serialized = serializeStoryScript(doc);
                                                setCodeText(serialized);
                                                setCodeSyncedBase(serialized);
                                                setCodePreviewDoc(doc);
                                            }}
                                            onSelectDiagnostic={(nodeId, beatId) => {
                                                setCodeSelectedNodeId(nodeId);
                                                setCodeSelectedBeatId(beatId ?? null);
                                            }}
                                            onNotify={setSnack}
                                            className="min-h-0 flex-1"
                                        />
                                    ) : isPlaytest ? (
                                        <LivePhasePanel
                                            doc={playLocalizedDoc ?? doc}
                                            program={playProgram ?? program}
                                            frame={playActiveFrame}
                                            runtimePhase={playRuntimePhase}
                                            stageState={playStageState}
                                            liveVariables={playLiveVariables}
                                            activeVoiceProgress={playVoiceProgress}
                                            onSelectNode={jumpPlaytestToNode}
                                            onSelectBeat={jumpPlaytestToBeat}
                                            docked
                                            className="min-h-0 flex-1"
                                        />
                                    ) : (
                                        <StoryEditorBin
                                            doc={doc}
                                            assetSource={assetSource}
                                            models={modelArray}
                                            modelInfo={modelInfo}
                                            modelList={modelList}
                                            onRetryModels={retryModels}
                                            activeNodeId={activeNodeId}
                                            previewingCastId={previewingCastKey}
                                            onDocChange={commit}
                                            onSelectNode={handleSelectNode}
                                            onQuickDrop={handleQuickDrop}
                                            onDragPayloadStart={setActiveDragPayload}
                                            onPreviewCast={handlePreviewClip}
                                            onClearPreview={clearClipPreview}
                                            className="min-h-0 flex-1"
                                        />
                                    )}
                                </Surface>
                            )}

                            {showLeftPane && (
                                <div
                                    key="left-splitter"
                                    role="separator"
                                    tabIndex={0}
                                    aria-orientation="vertical"
                                    aria-label={t("page.storyMaker.v2.ide.resizeColumn")}
                                    aria-valuenow={isCodeMode ? Math.round(layout.codeSplitPct) : layout.leftWidthPx}
                                    aria-valuemin={isCodeMode ? EDITOR_LAYOUT_LIMITS.codeMinPct : EDITOR_LAYOUT_LIMITS.leftMin}
                                    aria-valuemax={isCodeMode ? EDITOR_LAYOUT_LIMITS.codeMaxPct : EDITOR_LAYOUT_LIMITS.leftMax}
                                    title={t("page.storyMaker.v2.ide.resizeColumn")}
                                    onPointerDown={event => handleSplitPointerDown(isCodeMode ? "code" : "left", event)}
                                    onPointerMove={handleSplitPointerMove}
                                    onPointerUp={handleSplitPointerUp}
                                    onPointerCancel={() => { splitDragRef.current = null; }}
                                    onKeyDown={(event) => {
                                        if (event.key === "ArrowLeft") {
                                            event.preventDefault();
                                            if (isCodeMode) updateEditorLayout(prev => ({ ...prev, codeSplitPct: prev.codeSplitPct - 2 }));
                                            else updateEditorLayout(prev => ({ ...prev, leftWidthPx: prev.leftWidthPx - 16 }));
                                        } else if (event.key === "ArrowRight") {
                                            event.preventDefault();
                                            if (isCodeMode) updateEditorLayout(prev => ({ ...prev, codeSplitPct: prev.codeSplitPct + 2 }));
                                            else updateEditorLayout(prev => ({ ...prev, leftWidthPx: prev.leftWidthPx + 16 }));
                                        } else if (event.key === "Home") {
                                            event.preventDefault();
                                            if (isCodeMode) updateEditorLayout({ codeSplitPct: EDITOR_LAYOUT_LIMITS.codeMinPct });
                                            else updateEditorLayout({ leftWidthPx: EDITOR_LAYOUT_LIMITS.leftMin });
                                        } else if (event.key === "End") {
                                            event.preventDefault();
                                            if (isCodeMode) updateEditorLayout({ codeSplitPct: EDITOR_LAYOUT_LIMITS.codeMaxPct });
                                            else updateEditorLayout({ leftWidthPx: EDITOR_LAYOUT_LIMITS.leftMax });
                                        }
                                    }}
                                    onDoubleClick={() => {
                                        if (isCodeMode) updateEditorLayout({ codeSplitPct: DEFAULT_EDITOR_LAYOUT.codeSplitPct });
                                        else updateEditorLayout({ leftWidthPx: DEFAULT_EDITOR_LAYOUT.leftWidthPx });
                                    }}
                                    className="focus-ring group flex w-2.5 shrink-0 cursor-col-resize touch-none select-none items-center justify-center rounded-md3-full"
                                >
                                    <span className="h-9 w-1 rounded-full bg-outline-variant/65 transition-colors group-hover:bg-primary" />
                                </div>
                            )}

                            {/* Persistently Mounted Live 16:9 Stage (NEVER unmounts on mode/layout/sidePanel/web-fullscreen switch!) */}
                            <div
                                key="center-stage-pane"
                                ref={stageFullscreenRef}
                                className={cn(
                                    "flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden",
                                    stageWebFullscreen && !playFullscreen && "fixed inset-0 z-[170] h-dvh w-screen bg-surface p-2 sm:p-3",
                                    playFullscreen && "h-dvh w-full justify-center bg-surface p-4",
                                )}
                            >
                                <div
                                    key="stage-fit-outer"
                                    className={cn(
                                        "flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md3-xl bg-surface-container-low p-1 transition-shadow [container-type:size]",
                                        isPlaytest
                                            ? "border-2 border-primary ring-2 ring-primary/30"
                                            : "border border-outline-variant/60",
                                    )}
                                >
                                    <div
                                        key="stage-fit-inner"
                                        className="mx-auto h-[min(100cqh,calc(100cqw*9/16))] w-[min(100cqw,calc(100cqh*16/9))]"
                                    >
                                        <StoryStageView
                                            key="live-stage"
                                            doc={isPlaytest ? (playLocalizedDoc ?? stageDoc) : stageDoc}
                                            state={isPlaytest ? playDisplayState : editStageState}
                                            line={line}
                                            hostRef={stageHostRef}
                                            phase={stagePhase}
                                            problems={stageProblems}
                                            loadingActors={loadingActors}
                                            onRetry={retryStage}
                                            uiKit={uiKit}
                                            uiHidden={isPlaytest && playUiHidden}
                                            dialogueText={isPlaytest ? (playUiHidden ? undefined : playDisplayedDialogue) : undefined}
                                            autoPlay={isPlaytest && playAuto}
                                            showEndSign={isPlaytest ? playShowEndSign : (Boolean(editStageState.dialogue) && !previewChoice)}
                                            choice={isPlaytest ? (playUiHidden ? null : playCurrentChoice) : previewChoice}
                                            choiceInteractive={isPlaytest && !playUiHidden && Boolean(playCurrentChoice)}
                                            onChoose={isPlaytest ? handlePlayChoose : undefined}
                                            onChoiceSound={isPlaytest ? playSe : undefined}
                                            showMenuButton={false}
                                            animateCinemascope={isPlaytest}
                                            flash={flash}
                                            fadeSeconds={isPlaytest ? playFadeSeconds : undefined}
                                            compactStatus
                                            soloPreview={
                                                !isPlaytest && isSoloPreview && previewingCastMember
                                                    ? {
                                                        name: previewingCastMember.name || previewingCastMember.key,
                                                        onExit: clearClipPreview,
                                                    }
                                                    : null
                                            }
                                            onClick={isPlaytest && !playStageClickBlocked ? handlePlayAdvance : undefined}
                                            className={cn("h-full w-full", isPlaytest && !playStageClickBlocked && "cursor-pointer")}
                                        >
                                            {isPlaytest && !playUiHidden && playReachedEnding && playActiveFrame?.ending && (
                                                <div
                                                    className="absolute inset-0 z-[25] flex items-center justify-center bg-scrim/55 p-3"
                                                    onClick={event => event.stopPropagation()}
                                                >
                                                    <Surface
                                                        tone="high"
                                                        radius="xl"
                                                        elevation={2}
                                                        className="flex max-h-full w-full max-w-md flex-col items-center gap-2.5 overflow-y-auto border border-primary/30 p-5 text-center"
                                                    >
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-container px-3 py-1 type-label-m text-on-primary-container">
                                                            <Icon path={mdFlag} size={16} className="shrink-0" />
                                                            <span>{t("page.storyMaker.v2.ending.achievedBadge")}</span>
                                                        </span>
                                                        <p className="break-words type-title-l text-on-surface">
                                                            {playActiveFrame.ending.title || t("page.storyMaker.player.endTitle")}
                                                        </p>
                                                        <p className="whitespace-pre-wrap break-words type-body-m text-on-surface-variant">
                                                            {playActiveFrame.ending.subtitle || t("page.storyMaker.player.endDescription")}
                                                        </p>
                                                        {doc.variables.length > 0 && (
                                                            <div className="w-full min-w-0 space-y-1.5 rounded-md3-md border border-outline-variant/50 bg-surface-container p-2.5 text-left">
                                                                <div className="flex items-center gap-1.5 type-label-s text-on-surface-variant">
                                                                    <Icon path={mdCalculate} size={14} className="shrink-0 text-primary" />
                                                                    <span>{t("page.storyMaker.v2.ending.finalVariables")}</span>
                                                                </div>
                                                                <div className="flex min-w-0 flex-wrap gap-1.5">
                                                                    {doc.variables.map((variable) => {
                                                                        const val = playActiveFrame.variables[variable.id] ?? variable.initial;
                                                                        return (
                                                                            <span
                                                                                key={variable.id}
                                                                                className="inline-flex max-w-full items-center gap-1.5 rounded-md3-sm bg-surface-container-high px-2 py-0.5 type-label-s text-on-surface"
                                                                            >
                                                                                <Icon
                                                                                    path={variable.type === "number" ? mdNumbers : mdTag}
                                                                                    size={12}
                                                                                    className="shrink-0 text-primary"
                                                                                />
                                                                                <span className="max-w-28 truncate text-on-surface-variant">
                                                                                    {variable.name || variable.id}
                                                                                </span>
                                                                                <span className="shrink-0 font-mono tabular-nums text-primary">
                                                                                    {String(val)}
                                                                                </span>
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                                                            <Button variant="filled" icon={mdReplay} onClick={() => startPlaytestFrom(doc.startNodeId)}>
                                                                {t("page.storyMaker.v2.ending.replayOtherEndings")}
                                                            </Button>
                                                            <Button variant="tonal" icon={mdEdit} onClick={() => exitPlaytest(true)}>
                                                                {t("page.storyMaker.v2.mode.returnToEdit")}
                                                            </Button>
                                                        </div>
                                                    </Surface>
                                                </div>
                                            )}

                                            {isPlaytest && !playUiHidden && !playReachedEnding && (playEnded || playEmptyStory) && (
                                                <div
                                                    className="absolute inset-0 z-[25] flex items-center justify-center bg-scrim/45 p-3"
                                                    onClick={event => event.stopPropagation()}
                                                >
                                                    <Surface
                                                        tone="high"
                                                        radius="xl"
                                                        elevation={2}
                                                        className="flex max-h-full w-full max-w-sm flex-col items-center gap-2.5 overflow-y-auto p-5 text-center"
                                                    >
                                                        <p className="type-title-l text-on-surface">
                                                            {t(
                                                                playEmptyStory
                                                                    ? "page.storyMaker.player.emptyTitle"
                                                                    : playLooped
                                                                        ? "page.storyMaker.player.loopTitle"
                                                                        : "page.storyMaker.player.endTitle",
                                                            )}
                                                        </p>
                                                        <p className="type-body-m text-on-surface-variant">
                                                            {t(
                                                                playEmptyStory
                                                                    ? "page.storyMaker.player.emptyDescription"
                                                                    : playLooped
                                                                        ? "page.storyMaker.player.loopDescription"
                                                                        : "page.storyMaker.player.endDescription",
                                                            )}
                                                        </p>
                                                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                                                            {!playEmptyStory && (
                                                                <Button variant="filled" icon={mdReplay} onClick={() => startPlaytestFrom(doc.startNodeId)}>
                                                                    {t("page.storyMaker.player.replay")}
                                                                </Button>
                                                            )}
                                                            <Button variant="tonal" icon={mdEdit} onClick={() => exitPlaytest(true)}>
                                                                {t("page.storyMaker.v2.mode.returnToEdit")}
                                                            </Button>
                                                        </div>
                                                    </Surface>
                                                </div>
                                            )}

                                            {isPlaytest && playUiHidden && (
                                                <div className="absolute bottom-3 right-3 z-30">
                                                    <IconButton
                                                        variant="tonal"
                                                        icon={mdVisibility}
                                                        label={t("page.storyMaker.player.showUi")}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setPlayUiHidden(false);
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </StoryStageView>
                                    </div>
                                </div>

                                <div
                                    className={cn(
                                        "@container flex h-9 min-w-0 shrink-0 flex-nowrap items-center justify-between gap-1.5 overflow-x-auto overflow-y-hidden rounded-md3-lg border bg-surface-container-low px-2",
                                        isPlaytest ? "border-primary/40 bg-primary-container/10" : "border-outline-variant/50",
                                    )}
                                >
                                    {isPlaytest ? (
                                        <>
                                            <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-1">
                                                <span className="inline-flex shrink-0 items-center gap-1.5 px-1 type-label-s font-medium text-primary">
                                                    <span
                                                        aria-hidden
                                                        className={cn(
                                                            "inline-block size-2 shrink-0 rounded-full bg-primary",
                                                            !reduced && "animate-pulse",
                                                        )}
                                                    />
                                                    <span className="hidden @[460px]:inline">{t("page.storyMaker.v2.mode.playtest")}</span>
                                                </span>
                                                <IconButton
                                                    size="xs"
                                                    icon={mdSkipPrevious}
                                                    label={t("page.storyMaker.player.previous")}
                                                    disabled={playHistory.length <= 1}
                                                    onClick={handlePlayPrevious}
                                                />
                                                <Button
                                                    size="xs"
                                                    variant="tonal"
                                                    icon={mdSkipNext}
                                                    aria-label={t("page.storyMaker.player.next")}
                                                    title={t("page.storyMaker.player.next")}
                                                    disabled={Boolean(playCurrentChoice) || playEnded || playEmptyStory}
                                                    className="shrink-0 gap-1 px-2"
                                                    onClick={handlePlayAdvance}
                                                >
                                                    <span className="hidden @[400px]:inline">{t("page.storyMaker.player.next")}</span>
                                                </Button>
                                                <IconButton
                                                    size="xs"
                                                    icon={mdReplay}
                                                    label={t("page.storyMaker.player.replay")}
                                                    disabled={playEmptyStory}
                                                    onClick={() => startPlaytestFrom(doc.startNodeId)}
                                                />
                                                <IconButton
                                                    size="xs"
                                                    variant={playAuto ? "filled" : "standard"}
                                                    selected={playAuto}
                                                    icon={mdAutoplay}
                                                    label={t("page.storyMaker.player.auto")}
                                                    disabled={playEmptyStory || playEnded}
                                                    onClick={() => setPlayAuto(on => !on)}
                                                />
                                            </div>

                                            <div className="flex shrink-0 flex-nowrap items-center gap-0.5">
                                                {availablePlayLocales.length > 1 && (
                                                    <div className="mr-1 inline-flex shrink-0 items-center gap-1 rounded-md3-full bg-surface-container-high px-2 py-0.5">
                                                        <Icon path={mdTranslate} size={13} className="shrink-0 text-primary" />
                                                        <select
                                                            aria-label={t("page.storyMaker.i18n.subtitleLocaleLabel")}
                                                            value={effectivePlayLocale}
                                                            onChange={event => setPlaySelectedLocale(event.target.value as UiLocale)}
                                                            className="focus-ring bg-transparent type-label-s text-on-surface"
                                                        >
                                                            {availablePlayLocales.map(item => (
                                                                <option key={item.locale} value={item.locale}>
                                                                    {UI_LOCALE_LABELS[item.locale]}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        {activePlayLocaleInfo && (
                                                            <span
                                                                title={[activePlayLocaleInfo.modelHint, activePlayLocaleInfo.note].filter(Boolean).join(" · ") || undefined}
                                                                className={cn(
                                                                    "hidden shrink-0 rounded-md3-full px-1.5 py-0.5 type-label-s @[540px]:inline",
                                                                    playOriginBadgeTone(activePlayLocaleInfo.origin),
                                                                )}
                                                            >
                                                                {t(`page.storyMaker.i18n.origin.${activePlayLocaleInfo.origin}`)}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {hasPlayVoiceTrackManifest ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setVoiceManifestOpen(true)}
                                                        title={t("page.storyMaker.voiceTrack.manageButton")}
                                                        className="state-layer focus-ring mr-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md3-full bg-tertiary-container px-2 py-0.5 type-label-s text-on-tertiary-container"
                                                    >
                                                        <Icon path={mdRecordVoiceOver} size={12} className="shrink-0" />
                                                        <span className="hidden @[560px]:inline">{playVoiceTrackBadgeLabel}</span>
                                                    </button>
                                                ) : (
                                                    <IconButton
                                                        size="xs"
                                                        icon={mdRecordVoiceOver}
                                                        label={t("page.storyMaker.voiceTrack.action")}
                                                        onClick={() => setVoiceManifestOpen(true)}
                                                    />
                                                )}
                                                {audioBlocked && !playEmptyStory && !playEnded && (
                                                    <IconButton
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdVolumeUp}
                                                        label={t("page.storyMaker.player.tapToEnableAudio")}
                                                        onClick={() => unlockAudio()}
                                                    />
                                                )}
                                                <IconButton
                                                    size="xs"
                                                    icon={playUiHidden ? mdVisibility : mdVisibilityOff}
                                                    label={t(playUiHidden ? "page.storyMaker.player.showUi" : "page.storyMaker.player.hideUi")}
                                                    onClick={() => setPlayUiHidden(hidden => !hidden)}
                                                />
                                                <IconButton
                                                    size="xs"
                                                    icon={playMuted || playVolume === 0 ? mdVolumeOff : mdVolumeUp}
                                                    label={t(playMuted ? "page.storyMaker.player.unmute" : "page.storyMaker.player.mute")}
                                                    onClick={togglePlayMute}
                                                />
                                                <div className="hidden shrink-0 @[480px]:block">
                                                    <Slider
                                                        min={0}
                                                        max={1}
                                                        step={0.05}
                                                        value={playMuted ? 0 : playVolume}
                                                        onValueChange={handlePlayVolumeChange}
                                                        aria-label={t("page.storyMaker.player.volume")}
                                                        formatValue={val => `${Math.round(val * 100)}%`}
                                                        className="h-6 w-14"
                                                    />
                                                </div>
                                                <IconButton
                                                    size="xs"
                                                    icon={mdEdit}
                                                    label={t("page.storyMaker.v2.mode.stopAndEditHere")}
                                                    onClick={() => exitPlaytest(true)}
                                                />
                                                <IconButton
                                                    size="xs"
                                                    icon={stageWebFullscreen ? mdCloseFullscreen : mdFitScreen}
                                                    label={t(stageWebFullscreen ? "page.storyMaker.v2.ide.exitWebFullscreen" : "page.storyMaker.v2.ide.webFullscreen")}
                                                    selected={stageWebFullscreen}
                                                    onClick={() => setStageWebFullscreen(prev => !prev)}
                                                />
                                                <IconButton
                                                    size="xs"
                                                    icon={playFullscreen ? mdFullscreenExit : mdFullscreen}
                                                    label={t(playFullscreen ? "page.storyMaker.player.exitFullscreen" : "page.storyMaker.player.fullscreen")}
                                                    onClick={togglePlayFullscreen}
                                                />
                                            </div>
                                        </>
                                    ) : isCodeMode ? (
                                        <>
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                {codePreviewScenes.length > 0 && (
                                                    <select
                                                        aria-label={t("page.storyMaker.v2.script.previewScene")}
                                                        value={effectiveCodeScene?.id ?? ""}
                                                        onChange={(event) => {
                                                            const nextId = event.target.value;
                                                            setCodeSelectedNodeId(nextId);
                                                            const target = stageDoc.nodes[nextId];
                                                            setCodeSelectedBeatId(target?.type === "scene" ? (target.beats[0]?.id ?? null) : null);
                                                        }}
                                                        className="focus-ring h-7 max-w-[12rem] truncate rounded-md3-sm border border-outline-variant/60 bg-surface-container px-2 type-label-m text-on-surface"
                                                    >
                                                        {codePreviewScenes.map(scene => (
                                                            <option key={scene.id} value={scene.id}>
                                                                {getNodeDisplayName(scene, t)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}

                                                {effectiveCodeScene && effectiveCodeScene.beats.length > 0 && (
                                                    <div className="inline-flex shrink-0 items-center gap-0.5">
                                                        <IconButton
                                                            size="xs"
                                                            icon={mdChevronLeft}
                                                            label={t("page.storyMaker.editor.prevStep")}
                                                            disabled={effectiveCodeBeatIndex <= 0}
                                                            onClick={() => {
                                                                const target = effectiveCodeScene.beats[Math.max(0, effectiveCodeBeatIndex - 1)];
                                                                if (target) setCodeSelectedBeatId(target.id);
                                                            }}
                                                        />
                                                        <span className="min-w-10 text-center font-mono type-label-s tabular-nums text-on-surface-variant">
                                                            {effectiveCodeBeatIndex >= 0
                                                                ? `${effectiveCodeBeatIndex + 1}/${effectiveCodeScene.beats.length}`
                                                                : `0/${effectiveCodeScene.beats.length}`}
                                                        </span>
                                                        <IconButton
                                                            size="xs"
                                                            icon={mdChevronRight}
                                                            label={t("page.storyMaker.editor.nextStep")}
                                                            disabled={effectiveCodeBeatIndex >= effectiveCodeScene.beats.length - 1}
                                                            onClick={() => {
                                                                const nextIdx = effectiveCodeBeatIndex < 0
                                                                    ? 0
                                                                    : Math.min(effectiveCodeScene.beats.length - 1, effectiveCodeBeatIndex + 1);
                                                                const target = effectiveCodeScene.beats[nextIdx];
                                                                if (target) setCodeSelectedBeatId(target.id);
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex shrink-0 items-center gap-1">
                                                {codeEval.ok && (
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdPlayArrowFill}
                                                        onClick={() => handleApplyCodeAndPlaytest(codeEval.doc)}
                                                    >
                                                        {t("page.storyMaker.v2.mode.playtest")}
                                                    </Button>
                                                )}
                                                <IconButton
                                                    size="xs"
                                                    icon={stageWebFullscreen ? mdCloseFullscreen : mdFitScreen}
                                                    label={t(stageWebFullscreen ? "page.storyMaker.v2.ide.exitWebFullscreen" : "page.storyMaker.v2.ide.webFullscreen")}
                                                    selected={stageWebFullscreen}
                                                    onClick={() => setStageWebFullscreen(prev => !prev)}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                {activeNode && (
                                                    <span className="inline-flex max-w-[13rem] items-center gap-1.5 rounded-md3-full bg-surface-container px-2 py-0.5 type-label-s text-on-surface">
                                                        <span className="shrink-0 text-primary">
                                                            {t(`page.storyMaker.v2.nodeTypes.${activeNode.type}`)}
                                                        </span>
                                                        <span className="min-w-0 truncate">{getNodeDisplayName(activeNode, t)}</span>
                                                    </span>
                                                )}

                                                {activeScene && activeScene.beats.length > 0 && (
                                                    <div className="inline-flex shrink-0 items-center gap-0.5">
                                                        <IconButton
                                                            size="xs"
                                                            icon={mdChevronLeft}
                                                            label={t("page.storyMaker.editor.prevStep")}
                                                            disabled={activeBeatIndex <= 0}
                                                            onClick={() => {
                                                                const target = activeScene.beats[Math.max(0, activeBeatIndex - 1)];
                                                                if (target) setSelectedBeatId(target.id);
                                                            }}
                                                        />
                                                        <span className="min-w-10 text-center font-mono type-label-s tabular-nums text-on-surface-variant">
                                                            {activeBeatIndex >= 0
                                                                ? `${activeBeatIndex + 1}/${activeScene.beats.length}`
                                                                : `0/${activeScene.beats.length}`}
                                                        </span>
                                                        <IconButton
                                                            size="xs"
                                                            icon={mdChevronRight}
                                                            label={t("page.storyMaker.editor.nextStep")}
                                                            disabled={activeBeatIndex >= activeScene.beats.length - 1}
                                                            onClick={() => {
                                                                const nextIdx = activeBeatIndex < 0 ? 0 : Math.min(activeScene.beats.length - 1, activeBeatIndex + 1);
                                                                const target = activeScene.beats[nextIdx];
                                                                if (target) setSelectedBeatId(target.id);
                                                            }}
                                                        />
                                                    </div>
                                                )}

                                                {isSoloPreview && previewingCastMember && (
                                                    <span className="inline-flex max-w-[12rem] items-center gap-1 rounded-md3-full bg-tertiary-container px-2 py-0.5 type-label-s text-on-tertiary-container">
                                                        <span className="truncate">
                                                            {t("page.storyMaker.nle.previewingModel", {
                                                                name: previewingCastMember.name || previewingCastMember.key,
                                                            })}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={clearClipPreview}
                                                            className="state-layer focus-ring inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 text-on-surface"
                                                            aria-label={t("page.storyMaker.nle.exitPreview")}
                                                        >
                                                            <Icon path={mdClose} size={12} />
                                                        </button>
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex shrink-0 items-center gap-1">
                                                {replayActionInfo && (
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        color="tertiary"
                                                        icon={mdPlayArrow}
                                                        aria-label={t("page.storyMaker.nle.replayAction")}
                                                        disabled={stageRuntimeBlocked}
                                                        title={stageRuntimeBlocked ? t("page.storyMaker.nle.previewNeedsWebgpu") : t("page.storyMaker.nle.replayAction")}
                                                        className="shrink-0 gap-1 px-2"
                                                        onClick={() => handlePreviewClip(replayActionInfo.member, replayActionInfo.clip)}
                                                    >
                                                        <span className="hidden @[440px]:inline">{t("page.storyMaker.nle.replayAction")}</span>
                                                    </Button>
                                                )}
                                                {activeScene && (
                                                    <IconButton
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdPlayCircle}
                                                        label={t("page.storyMaker.v2.ending.playFromScene")}
                                                        onClick={() => enterPlaytest(activeScene.id)}
                                                    />
                                                )}
                                                <IconButton
                                                    size="xs"
                                                    icon={stageWebFullscreen ? mdCloseFullscreen : mdFitScreen}
                                                    label={t(stageWebFullscreen ? "page.storyMaker.v2.ide.exitWebFullscreen" : "page.storyMaker.v2.ide.webFullscreen")}
                                                    selected={stageWebFullscreen}
                                                    onClick={() => setStageWebFullscreen(prev => !prev)}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {showRightPane && (
                                <div
                                    key="right-splitter"
                                    role="separator"
                                    tabIndex={0}
                                    aria-orientation="vertical"
                                    aria-label={t("page.storyMaker.v2.ide.resizeColumn")}
                                    aria-valuenow={layout.rightWidthPx}
                                    aria-valuemin={EDITOR_LAYOUT_LIMITS.rightMin}
                                    aria-valuemax={EDITOR_LAYOUT_LIMITS.rightMax}
                                    title={t("page.storyMaker.v2.ide.resizeColumn")}
                                    onPointerDown={event => handleSplitPointerDown("right", event)}
                                    onPointerMove={handleSplitPointerMove}
                                    onPointerUp={handleSplitPointerUp}
                                    onPointerCancel={() => { splitDragRef.current = null; }}
                                    onKeyDown={(event) => {
                                        if (event.key === "ArrowLeft") {
                                            event.preventDefault();
                                            updateEditorLayout(prev => ({ ...prev, rightWidthPx: prev.rightWidthPx + 16 }));
                                        } else if (event.key === "ArrowRight") {
                                            event.preventDefault();
                                            updateEditorLayout(prev => ({ ...prev, rightWidthPx: prev.rightWidthPx - 16 }));
                                        } else if (event.key === "Home") {
                                            event.preventDefault();
                                            updateEditorLayout({ rightWidthPx: EDITOR_LAYOUT_LIMITS.rightMin });
                                        } else if (event.key === "End") {
                                            event.preventDefault();
                                            updateEditorLayout({ rightWidthPx: EDITOR_LAYOUT_LIMITS.rightMax });
                                        }
                                    }}
                                    onDoubleClick={() => updateEditorLayout({ rightWidthPx: DEFAULT_EDITOR_LAYOUT.rightWidthPx })}
                                    className="focus-ring group flex w-2.5 shrink-0 cursor-col-resize touch-none select-none items-center justify-center rounded-md3-full"
                                >
                                    <span className="h-9 w-1 rounded-full bg-outline-variant/65 transition-colors group-hover:bg-primary" />
                                </div>
                            )}

                            {showRightPane && (
                                <Surface
                                    key="desktop-inspector"
                                    tone="low"
                                    radius="xl"
                                    style={{ width: `${layout.rightWidthPx}px` }}
                                    className={cn(
                                        "flex min-h-0 max-w-[46%] shrink-0 flex-col overflow-hidden border",
                                        isPlaytest ? "border-primary/35" : "border-outline-variant/50",
                                    )}
                                >
                                    {isPlaytest ? (
                                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                                            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant/50 px-3 py-2">
                                                <span className="flex min-w-0 items-center gap-1.5 type-label-l text-on-surface">
                                                    <Icon path={mdHistory} size={17} className="shrink-0 text-primary" />
                                                    <span className="truncate">{t("page.storyMaker.player.backlog")}</span>
                                                    <span className="shrink-0 font-mono type-label-s tabular-nums text-on-surface-variant">
                                                        {playtestBacklogEntries.length}
                                                    </span>
                                                </span>
                                                <Button
                                                    size="xs"
                                                    variant="tonal"
                                                    icon={mdEdit}
                                                    onClick={() => exitPlaytest(true)}
                                                >
                                                    {t("page.storyMaker.v2.mode.returnToEdit")}
                                                </Button>
                                            </div>
                                            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                                                {playtestBacklogEntries.length === 0 ? (
                                                    <p className="rounded-md3-md bg-surface-container px-3 py-3 text-center type-body-s text-on-surface-variant">
                                                        {t("page.storyMaker.player.backlogEmpty")}
                                                    </p>
                                                ) : (
                                                    <ol className="min-w-0 space-y-2">
                                                        {playtestBacklogEntries.map(entry => (
                                                            <li
                                                                key={entry.key}
                                                                className={cn(
                                                                    "min-w-0 space-y-1 rounded-md3-md border p-2.5",
                                                                    entry.kind === "choice"
                                                                        ? "border-tertiary/45 bg-tertiary-container/30"
                                                                        : "border-outline-variant/40 bg-surface-container",
                                                                )}
                                                            >
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="min-w-0 truncate type-label-m text-primary">
                                                                        {entry.kind === "choice"
                                                                            ? t("page.storyMaker.player.chosenOption")
                                                                            : entry.kind === "narration"
                                                                                ? t("page.storyMaker.op.narration")
                                                                                : entry.kind === "telop"
                                                                                    ? t("page.storyMaker.op.telop")
                                                                                    : (entry.speaker || t("page.storyMaker.v2.beats.speakerNone"))}
                                                                    </span>
                                                                    {entry.voiceUrls && entry.voiceUrls.length > 0 && (
                                                                        <IconButton
                                                                            size="xs"
                                                                            icon={mdPlayArrowFill}
                                                                            label={t("page.storyMaker.player.replayVoice")}
                                                                            onClick={() => handlePlayReplayBacklogVoice(entry)}
                                                                        />
                                                                    )}
                                                                </div>
                                                                <p className="whitespace-pre-wrap break-words type-body-s text-on-surface">
                                                                    {entry.body}
                                                                </p>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                                            <NodeInspector
                                                doc={doc}
                                                selectedNodeId={activeNodeId}
                                                selectedBeatId={activeBeatId}
                                                assetSource={assetSource}
                                                models={modelArray}
                                                modelInfo={modelInfo}
                                                diagnostics={diagnostics}
                                                onDocChange={commit}
                                                onSelectNode={handleSelectNode}
                                                onSelectBeat={handleSelectBeat}
                                                onPreviewClip={handlePreviewClip}
                                                onPlayFromScene={nodeId => enterPlaytest(nodeId)}
                                                onContinueScene={handleContinueScene}
                                                onPreviewEffect={handlePreviewEffect}
                                            />
                                        </div>
                                    )}
                                </Surface>
                            )}
                        </div>

                        {showBottomPane && (
                            <div
                                key="bottom-splitter"
                                role="separator"
                                tabIndex={0}
                                aria-orientation="horizontal"
                                aria-label={t("page.storyMaker.nle.resizeSplit")}
                                aria-valuenow={Math.round(layout.topSplitPct)}
                                aria-valuemin={EDITOR_LAYOUT_LIMITS.topMinPct}
                                aria-valuemax={EDITOR_LAYOUT_LIMITS.topMaxPct}
                                title={t("page.storyMaker.nle.resizeSplit")}
                                onPointerDown={event => handleSplitPointerDown("horizontal", event)}
                                onPointerMove={handleSplitPointerMove}
                                onPointerUp={handleSplitPointerUp}
                                onPointerCancel={() => { splitDragRef.current = null; }}
                                onKeyDown={(event) => {
                                    if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        updateEditorLayout(prev => ({ ...prev, topSplitPct: prev.topSplitPct - 2 }));
                                    } else if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        updateEditorLayout(prev => ({ ...prev, topSplitPct: prev.topSplitPct + 2 }));
                                    } else if (event.key === "Home") {
                                        event.preventDefault();
                                        updateEditorLayout({ topSplitPct: EDITOR_LAYOUT_LIMITS.topMinPct });
                                    } else if (event.key === "End") {
                                        event.preventDefault();
                                        updateEditorLayout({ topSplitPct: EDITOR_LAYOUT_LIMITS.topMaxPct });
                                    }
                                }}
                                onDoubleClick={() => updateEditorLayout({ topSplitPct: DEFAULT_EDITOR_LAYOUT.topSplitPct })}
                                className="focus-ring group flex h-2.5 shrink-0 cursor-row-resize touch-none select-none items-center justify-center rounded-md3-full"
                            >
                                <span className="h-1 w-10 rounded-full bg-outline-variant/65 transition-colors group-hover:bg-primary" />
                            </div>
                        )}

                        <StoryFlowCanvas
                            key="desktop-flow-canvas"
                            doc={doc}
                            mode={isPlaytest ? "play" : "edit"}
                            activeNodeId={isPlaytest ? (playActiveFrame?.nodeId ?? null) : activeNodeId}
                            activeBeatId={isPlaytest ? (playActiveFrame?.beatId ?? null) : activeBeatId}
                            visitedNodeIds={isPlaytest ? (playActiveFrame?.visitedNodeIds ?? []) : undefined}
                            visitedEdgeIds={isPlaytest ? (playActiveFrame?.visitedEdgeIds ?? []) : undefined}
                            diagnostics={diagnostics}
                            activeDragPayload={isPlaytest ? null : activeDragPayload}
                            onSelectNode={isPlaytest ? jumpPlaytestToNode : handleSelectNode}
                            onSelectBeat={isPlaytest ? jumpPlaytestToBeat : handleSelectBeat}
                            onMoveNode={isPlaytest ? undefined : ((nodeId, pos) => commit(current => moveNode(current, nodeId, pos)))}
                            onConnect={isPlaytest ? undefined : ((fromNodeId, fromPortId, toNodeId) => {
                                commit(current => connectEdge(current, fromNodeId, fromPortId, toNodeId));
                                setSnack(t("page.storyMaker.flow.connected"));
                            })}
                            onRewireEdgeSource={isPlaytest ? undefined : ((edgeId, newFromNodeId, newFromPortId) => {
                                commit(current => rewireEdgeSource(current, edgeId, newFromNodeId, newFromPortId));
                                setSnack(t("page.storyMaker.flow.connected"));
                            })}
                            onDisconnectEdge={isPlaytest ? undefined : (edgeId => commit(current => disconnectEdge(current, edgeId)))}
                            onDisconnectPort={isPlaytest ? undefined : ((fromNodeId, fromPortId) => commit(current => disconnectPort(current, fromNodeId, fromPortId)))}
                            onDropPayload={isPlaytest ? undefined : handleDropPayload}
                            onMoveBeat={isPlaytest ? undefined : ((sourceNodeId, beatId, targetNodeId, insertIndex) => {
                                commit(current => moveBeat(current, sourceNodeId, beatId, targetNodeId, insertIndex));
                                setSelectedNodeId(targetNodeId);
                                setSelectedBeatId(beatId);
                            })}
                            onAddNode={isPlaytest ? undefined : handleAddNode}
                            onDuplicateNode={isPlaytest ? undefined : handleDuplicateNode}
                            onDeleteNode={isPlaytest ? undefined : handleDeleteNode}
                            onDeleteBeat={isPlaytest ? undefined : handleDeleteBeat}
                            onDuplicateBeat={isPlaytest ? undefined : handleDuplicateBeat}
                            onContinueScene={isPlaytest ? undefined : handleContinueScene}
                            onPlayFromNode={isPlaytest ? undefined : (nodeId => enterPlaytest(nodeId))}
                            onAutoLayout={isPlaytest ? undefined : (() => commit(current => autoLayoutGraph(current)))}
                            canUndo={past.length > 0}
                            canRedo={future.length > 0}
                            undoCount={past.length}
                            redoCount={future.length}
                            onUndo={isPlaytest ? undefined : undo}
                            onRedo={isPlaytest ? undefined : redo}
                            viewportActionsRef={flowViewportRef}
                            className={cn("min-h-0 flex-1", showBottomPane ? "flex" : "hidden")}
                        />
                    </div>

                    {/* Optional Host Docked Side Panel (e.g. Electron Pi Agent collapsible panel) */}
                    {sidePanelNode}
                </div>

                <StoryMetaDialog
                    isOpen={metaOpen}
                    onClose={() => setMetaOpen(false)}
                    title={t("page.storyMaker.editor.storySettings")}
                    confirmLabel={t("common.action.confirm")}
                    initial={metaValuesFromDoc(doc)}
                    showRegionHint
                    onSubmit={handleUpdateMeta}
                />

                <StoryImportDialog
                    isOpen={importOpen}
                    onClose={() => setImportOpen(false)}
                    onImport={handleImportIntoCurrentDraft}
                />

                <StoryI18nDialog
                    isOpen={i18nOpen}
                    onClose={() => setI18nOpen(false)}
                    doc={doc}
                    onDocChange={commit}
                    onNotify={setSnack}
                />

                <StoryVoiceManifestDialog
                    isOpen={voiceManifestOpen}
                    onClose={() => setVoiceManifestOpen(false)}
                    doc={doc}
                    currentManifest={playVoiceManifest}
                    onApplyManifest={setPlayVoiceManifest}
                    onSwitchToStoryImport={handleImportIntoCurrentDraft}
                    onApplyLocalePack={pack => commit(current => upsertStoryLocalePack(current, pack))}
                    uploadTab={voiceUploadTab}
                    initialTab={voiceManifestInitialTab}
                    onNotify={setSnack}
                />

                <AssetPreloadDialog
                    open={preloadOpen}
                    onClose={() => setPreloadOpen(false)}
                    doc={doc}
                    assetSource={assetSource}
                    models={models ?? undefined}
                    voiceManifest={playVoiceManifest}
                />

                <Dialog
                    isOpen={issuesOpen}
                    onClose={() => setIssuesOpen(false)}
                    title={t("page.storyMaker.editor.issuesDialogTitle", { count: diagnostics.length })}
                    size="md"
                >
                    <StoryIssueList
                        diagnostics={diagnostics}
                        onSelectDiagnostic={(nodeId, beatId) => {
                            if (workspaceMode === "playtest") {
                                exitPlaytest(false);
                            } else if (workspaceMode === "code") {
                                setCodeSelectedNodeId(nodeId);
                                setCodeSelectedBeatId(beatId ?? null);
                                setIssuesOpen(false);
                                return;
                            }
                            if (beatId) handleSelectBeat(nodeId, beatId);
                            else handleSelectNode(nodeId);
                            setIssuesOpen(false);
                        }}
                    />
                </Dialog>

                {/* Host-owned dialogs (e.g. Web StoryPublishDialog or Desktop Enhanced Export / Agent Settings) */}
                {slots?.renderDialogs?.(slotCtx)}

                <Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} />
            </div>
        );
    },
);

export const StoryStudioEditor = forwardRef<StoryStudioEditorHandle, StoryStudioEditorProps>(
    function StoryStudioEditor(props, ref) {
        const {
            enforceDesktopViewport = false,
            draftId = null,
            backToDraftsHref = "/story-maker",
            onBackToDrafts,
            getDraftPlayHref = (id) => `/story-maker/play?id=${encodeURIComponent(id)}`,
        } = props;
        const isDesktop = useDesktopViewport();

        if (enforceDesktopViewport) {
            if (isDesktop === null) {
                return (
                    <>
                        <div className="lg:hidden">
                            <DesktopOnlyNotice
                                draftId={draftId}
                                backToDraftsHref={backToDraftsHref}
                                onBackToDrafts={onBackToDrafts}
                                getDraftPlayHref={getDraftPlayHref}
                            />
                        </div>
                        <div className="hidden lg:block">
                            <PageContainer wide><LoadingState /></PageContainer>
                        </div>
                    </>
                );
            }
            if (!isDesktop) {
                return (
                    <DesktopOnlyNotice
                        draftId={draftId}
                        backToDraftsHref={backToDraftsHref}
                        onBackToDrafts={onBackToDrafts}
                        getDraftPlayHref={getDraftPlayHref}
                    />
                );
            }
        }

        return <StoryStudioEditorInner ref={ref} {...props} />;
    },
);
