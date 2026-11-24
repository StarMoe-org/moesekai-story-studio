// Context & Provider
export {
    StoryStudioProvider,
    useStoryStudio,
    useStoryI18n,
    type StoryStudioContextValue,
    type StoryStudioProviderProps,
} from "./context/StoryStudioContext";

// High-level Studio Surfaces (Hub, Editor, Player)
export {
    StoryStudioHub,
    prependStoryDraft,
    type StoryHubScrollRestore,
    type StoryHubSortKey,
    type StoryStudioHubProps,
    type StoryStudioHubSlots,
} from "./studio/StoryStudioHub";

export {
    StoryStudioEditor,
    mergeIncomingStoryDoc,
    resolveEffectiveSaveStatus,
} from "./studio/StoryStudioEditor";
export type {
    EditorSlotContext,
    EditorTopBarSlotContext,
    ReloadFromDocOptions,
    ReloadFromScriptOptions,
    StoryNodeChange,
    StoryEditorSaveStatus,
    StoryEditorWorkspaceMode,
    StoryStudioEditorHandle,
    StoryStudioEditorProps,
    StoryStudioEditorSlots,
} from "./studio/editorTypes";

export {
    StoryStudioPlayer,
    resolveEffectivePlayerLayoutMode,
    resolvePlayerCompanionVisibility,
    type PlayerTopBarSlotContext,
    type StoryPlayerExternalError,
    type StoryPlayerExternalSource,
    type StoryPlayerSlotContext,
    type StoryStudioPlayerProps,
    type StoryStudioPlayerSlots,
} from "./studio/StoryStudioPlayer";

// Reusable Story Maker UI Components & Hooks
export { AssetNamePickerDialog, type AssetNamePickerDialogProps } from "./components/AssetNamePickerDialog";
export {
    AssetPreloadDialog,
    STORY_AUTO_PRELOAD_STORAGE_KEY,
    readAutoPreloadPreference,
    writeAutoPreloadPreference,
} from "./components/AssetPreloadPanel";
export { CastPanel } from "./components/CastPanel";
export {
    ClipPickerField,
    canBrowseClipPicker,
    type ClipPickerFieldProps,
} from "./components/ClipPickerField";
export {
    GameStageOverlay,
    type GameStageChoiceOption,
    type GameStageChoiceProp,
    type GameStageOverlayProps,
} from "./components/GameStageOverlay";
export {
    LivePhasePanel,
    LivePhaseTelemetry,
    PHASE_META,
    getNodeDisplayLabel,
    type ActiveVoiceProgress,
    type LivePhaseBacklogItem,
    type StoryRuntimePhase,
} from "./components/LivePhasePanel";
export { NodeInspector } from "./components/NodeInspector";
export { ScriptCodeDialog, type ScriptCodeDialogProps } from "./components/ScriptCodeDialog";
export {
    StoryCodeWorkspace,
    type StoryCodeEvaluation,
    type StoryCodeWorkspaceProps,
} from "./components/StoryCodeWorkspace";
export { StoryEditorBin } from "./components/StoryEditorBin";
export { StoryFlowCanvas, type StoryFlowViewportActions } from "./components/StoryFlowCanvas";
export { StoryI18nDialog, originBadgeTone, type StoryI18nDialogProps } from "./components/StoryI18nDialog";
export { StoryImportDialog, type StoryImportDialogProps } from "./components/StoryImportDialog";
export { StoryIssueList } from "./components/StoryIssueList";
export {
    StoryMetaDialog,
    applyMetaValuesToDoc,
    metaValuesFromDoc,
    type StoryMetaDialogProps,
    type StoryMetaValues,
} from "./components/StoryMetaDialog";
export {
    StoryPlayerView,
    applyInstructionToStage,
    resolvePlayerStageLayout,
    shouldPromoteReplayTransport,
    shouldShowPlayerStageAttribution,
    type PlayerLayoutMode,
    type StoryPlayerStageLayout,
    type StoryPlayerViewProps,
} from "./components/StoryPlayerView";
export {
    MoeSekaiWordmarkSvg,
    MOESEKAI_WORDMARK_PATH,
    MOESEKAI_WORDMARK_VIEWBOX,
} from "./components/MoeSekaiWordmarkSvg";
export { StoryNoticesDialog, type StoryNoticesDialogProps } from "./components/StoryNoticesDialog";
export { StoryStageView, shouldShowStageAttribution } from "./components/StoryStageView";
export {
    StoryVoiceManifestDialog,
    detectAudioFilesForManifestDrop,
    evaluateManifestText,
    resolveVoiceManifestDialogTab,
    type AudioFileDropDetection,
    type ManifestEvaluation,
    type StoryVoiceManifestDialogProps,
    type VoiceManifestDialogTab,
    type VoiceManifestUploadTabConfig,
    type VoiceManifestUploadTabContext,
} from "./components/StoryVoiceManifestDialog";
export {
    VoiceCueSheetExportBar,
    type VoiceCueSheetExportBarProps,
} from "./components/VoiceCueSheetExportBar";
export {
    buildVoiceManifestUrlOptions,
    resolveMidSceneManifestVoiceAction,
    resolveTalkBeatVoicePlayback,
    type MidSceneManifestVoiceAction,
    type PickedFileLike,
    type ResolvedTalkBeatVoice,
} from "./components/voiceTrackUtils";
export { VariableManagerPanel } from "./components/VariableManagerPanel";
export { VoicePickerDialog, type VoicePickerDialogProps } from "./components/VoicePickerDialog";
export { VoiceTrimControl } from "./components/VoiceTrimControl";
export {
    ServerRegionIcon,
    ServerRegionLabel,
    getServerDisplayCode,
    type ServerRegionIconProps,
    type ServerRegionLabelProps,
} from "./components/ServerRegion";

export {
    DEFAULT_EDITOR_LAYOUT,
    EDITOR_LAYOUT_LIMITS,
    resetEditorLayout,
    updateEditorLayout,
    useEditorLayout,
    type EditorLayoutState,
} from "./components/useEditorLayout";
export { useStarterStory } from "./components/useStarterStory";
export {
    previewStorySound,
    useStoryAudio,
    type PreviewSoundOptions,
    type StoryAudioControls,
    type VoicePlayOptions,
} from "./components/useStoryAudio";
export { useStoryModels, type StoryModelList } from "./components/useStoryModels";
export {
    useStoryStage,
    type StoryActorProblem,
    type StoryClipPreviewRequest,
    type StoryStageApplyOptions,
    type StoryStageHandle,
    type StoryStageLoadProgress,
    type StoryStagePhase,
    type StoryStageRenderQuality,
    type UseStoryStageOptions,
} from "./components/useStoryStage";
export {
    useStoryUiKit,
    type StoryUiKitStatus,
    type UseStoryUiKitResult,
} from "./components/useStoryUiKit";

// Live2D Pickers & Stage Runtime
export * from "./live2d";

// PJSK Unit & Character Name Helpers
export * from "./data/pjskUnits";

// Messages & Translator Helpers
export {
    STORY_MAKER_MESSAGES_BY_LOCALE,
    STUDIO_MESSAGES_BY_LOCALE,
    createStudioTranslator,
    getStudioMessageByPath,
    interpolateStudioMessage,
    normalizeStudioLocale,
    type MessageInterpolationValue,
    type MessageInterpolationValues,
    type MessageTree,
    type StoryStudioLocale,
    type StudioTranslateFn,
} from "./messages";
