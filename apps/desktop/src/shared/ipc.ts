/**
 * Shared IPC contracts between Electron Main, Preload, Renderer, and Agent UtilityProcess.
 * Aligned directly with `@moesekai/story-agent` public types and zero Electron runtime imports.
 */

import type {
    DesktopUpdateCheckResult,
    UpdateChannel,
    UpdateSource,
} from "./updater.ts";

export type { DesktopUpdateCheckResult, UpdateChannel, UpdateSource };

export type DesktopUiLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR";
export type DesktopThemeMode = "light" | "dark";
export type DesktopStoryRegion = "jp" | "cn" | "tw" | "kr" | "en";
export type DesktopStageRenderQuality = "standard" | "high" | "ultra";

export interface AssetCacheStats {
    enabled: boolean;
    maxMb: number;
    entries: number;
    totalBytes: number;
    hits: number;
    misses: number;
    staleHits: number;
    cacheDir: string;
}

export const IPC_CHANNELS = {
    // Workspace
    WORKSPACE_GET_ACTIVE: "workspace:get-active",
    WORKSPACE_CREATE: "workspace:create",
    WORKSPACE_PICK_AND_CREATE: "workspace:pick-and-create",
    WORKSPACE_OPEN_STARTER_DEMO: "workspace:open-starter-demo",
    WORKSPACE_OPEN_FOLDER_DIALOG: "workspace:open-folder-dialog",
    WORKSPACE_OPEN_MSK_DIALOG: "workspace:open-msk-dialog",
    WORKSPACE_OPEN_PATH: "workspace:open-path",
    WORKSPACE_SAVE: "workspace:save",
    WORKSPACE_CLOSE: "workspace:close",
    WORKSPACE_LIST_RECENT: "workspace:list-recent",
    WORKSPACE_REMOVE_RECENT: "workspace:remove-recent",
    WORKSPACE_LIST_SNAPSHOTS: "workspace:list-snapshots",
    WORKSPACE_CREATE_SNAPSHOT: "workspace:create-snapshot",
    WORKSPACE_ROLLBACK_SNAPSHOT: "workspace:rollback-snapshot",
    WORKSPACE_IMPORT_VOICE_FILE: "workspace:import-voice-file",
    WORKSPACE_REVEAL_PATH: "workspace:reveal-path",

    // Export
    EXPORT_PREFLIGHT: "export:preflight",
    EXPORT_MSK: "export:msk",
    EXPORT_BUNDLE: "export:bundle",
    EXPORT_LOCALES: "export:locales",

    // MoeSekai Agent
    AGENT_GET_CONFIG: "agent:get-config",
    AGENT_SAVE_CONFIG: "agent:save-config",
    AGENT_GET_STATUS: "agent:get-status",
    AGENT_LIST_PROVIDERS: "agent:list-providers",
    AGENT_FETCH_MODELS: "agent:fetch-models",
    AGENT_SET_THINKING_LEVEL: "agent:set-thinking-level",
    AGENT_SET_AUTHORING_MODE: "agent:set-authoring-mode",
    AGENT_SET_PLAN_FIRST: "agent:set-plan-first",
    AGENT_APPROVE_PLAN: "agent:approve-plan",
    AGENT_REVISE_PLAN: "agent:revise-plan",
    AGENT_PROMPT: "agent:prompt",
    AGENT_RUN_PRESET: "agent:run-preset",
    AGENT_ABORT: "agent:abort",
    AGENT_RESET: "agent:reset",
    AGENT_LIST_SESSIONS: "agent:list-sessions",
    AGENT_RESUME_SESSION: "agent:resume-session",
    AGENT_NEW_SESSION: "agent:new-session",
    AGENT_DELETE_SESSION: "agent:delete-session",
    AGENT_LIST_SNAPSHOTS: "agent:list-snapshots",
    AGENT_ROLLBACK_SNAPSHOT: "agent:rollback-snapshot",

    // App Settings & Shell
    SETTINGS_GET: "settings:get",
    SETTINGS_UPDATE: "settings:update",
    APP_GET_INFO: "app:get-info",
    APP_OPEN_EXTERNAL: "app:open-external",

    // Desktop Updates (CNB Primary + GitHub Fallback)
    UPDATES_CHECK: "updates:check",
    UPDATES_IGNORE_VERSION: "updates:ignore-version",
    UPDATES_OPEN_DOWNLOAD: "updates:open-download",

    // Persistent Local Disk Asset Cache (`moesekai-cache://`)
    CACHE_GET_STATS: "cache:get-stats",
    CACHE_CLEAR: "cache:clear",
    CACHE_OPEN_DIR: "cache:open-dir",
    CACHE_SET_MAX_MB: "cache:set-max-mb",
    CACHE_SET_ENABLED: "cache:set-enabled",

    // Push events (Main -> Renderer)
    EVENT_WORKSPACE_EXTERNAL_CHANGE: "event:workspace-external-change",
    EVENT_AGENT: "event:agent",
    EVENT_MENU_COMMAND: "event:menu-command",
    EVENT_OPEN_FILE_REQUEST: "event:open-file-request",
    EVENT_WINDOW_FULLSCREEN_CHANGED: "window:fullscreen-changed",
    EVENT_UPDATE_AVAILABLE: "event:update-available",
} as const;

export interface WorkspaceSnapshotInfo {
    id: string;
    filePath?: string;
    createdAt: string;
    reason: string;
    toolName?: string;
    storyFile?: string;
    nodeCount?: number;
    beatCount?: number;
    byteLength: number;
    sha256?: string;
}

export interface RecentProjectEntry {
    /** Canonical project root folder or standalone `.msk` file path. */
    path: string;
    /** Directory containing the project. */
    rootDir: string;
    /** Path to the active `.msk` file. */
    mskFilePath: string;
    title: string;
    region: DesktopStoryRegion;
    lastOpenedAt: number;
    isSingleFile: boolean;
}

export interface WorkspaceProjectData {
    id: string;
    rootDir: string;
    mskFilePath: string;
    storyFileName: string;
    isSingleFile: boolean;
    script: string;
    /** Parsed JSON locale packs keyed by locale code. */
    locales: Record<string, unknown>;
    /** Parsed `voices/manifest.json` if present. */
    voiceManifest: unknown | null;
    /** Relative paths of audio files under `voices/`. */
    localVoiceFiles: string[];
    snapshots: WorkspaceSnapshotInfo[];
    createdAt: number;
    updatedAt: number;
}

export interface CreateWorkspaceInput {
    dirPath: string;
    title: string;
    region: DesktopStoryRegion;
    initialScript: string;
    sourceLocale?: DesktopUiLocale;
    /**
     * Explicit opt-in to overwrite an existing `story.msk` inside `dirPath`.
     * Defaults to `false` so creating a new project never clobbers an existing project folder.
     */
    allowOverwrite?: boolean;
}

export interface SaveWorkspaceInput {
    script: string;
    locales?: Record<string, unknown>;
    voiceManifest?: unknown | null;
    createSnapshotReason?: string;
}

export interface SaveWorkspaceResult {
    savedAt: number;
    mskFilePath: string;
    bytesWritten: number;
    snapshot?: WorkspaceSnapshotInfo;
}

export interface WorkspaceExternalChangeEvent {
    rootDir: string;
    mskFilePath: string;
    kind: "msk" | "locales" | "voice-manifest" | "all";
    script: string;
    locales: Record<string, unknown>;
    voiceManifest: unknown | null;
    localVoiceFiles: string[];
    snapshots: WorkspaceSnapshotInfo[];
    changedAt: number;
}

// ==================== Export Pipeline ====================

export interface ExportDiagnosticItem {
    severity: "error" | "warning";
    code: string;
    path: string;
    message?: string;
    nodeId?: string;
    beatId?: string;
    params?: Record<string, string | number>;
}

export interface ExportPreflightStats {
    nodeCount: number;
    sceneCount: number;
    beatCount: number;
    endingCount: number;
    castCount: number;
    variableCount: number;
    localeCount: number;
    voiceLineCount: number;
    localVoiceFileCount: number;
}

export interface ExportPreflightRequest {
    script: string;
    includePositions: boolean;
    checkLiveAssets?: boolean;
    assetLine?: "main" | "backup";
    locales?: Record<string, unknown>;
    voiceManifest?: unknown | null;
    workspaceRoot?: string | null;
}

export interface ExportPreflightResult {
    ok: boolean;
    canExportCleanMsk: boolean;
    title: string;
    region: DesktopStoryRegion;
    errors: ExportDiagnosticItem[];
    warnings: ExportDiagnosticItem[];
    stats: ExportPreflightStats;
    previewScript: string;
    previewByteLength: number;
    liveAssetIssues?: string[];
}

export interface ExportMskRequest {
    script: string;
    includePositions: boolean;
    suggestedFileName?: string;
    /** Optional explicit output path (skips native Save dialog when provided). */
    outputPath?: string;
}

export interface ExportBundleRequest {
    script: string;
    includePositions: boolean;
    format: "zip" | "folder";
    locales?: Record<string, unknown>;
    voiceManifest?: unknown | null;
    workspaceRoot?: string | null;
    suggestedName?: string;
    /** Optional explicit output path (skips native Save/Folder dialog when provided). */
    outputPath?: string;
}

export interface ExportLocalesRequest {
    locales: Record<string, unknown>;
    voiceManifest?: unknown | null;
    /** Optional explicit output directory (skips native Folder dialog when provided). */
    outputDir?: string;
}

export interface ExportOperationResult {
    canceled: boolean;
    outputPath?: string;
    bytesWritten?: number;
    filesWritten?: string[];
    errorCount?: number;
    warningCount?: number;
}

// ==================== MoeSekai Agent (aligned with @moesekai/story-agent) ====================

export type AgentMode = "sdk" | "rpc";
export type AgentStatus = "idle" | "starting" | "thinking" | "streaming" | "tool_running" | "retrying" | "aborted" | "error";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentAuthoringMode = "create" | "edit";
export type AgentWorkflowStage = "outline" | "research" | "author" | "verify" | "inspect" | "patch";
export type AgentWorkflowStageStatus = "active" | "completed" | "skipped";
export type AgentWorkflowPlanStatus = "pending_approval" | "approved" | "revised";

export type AgentApiProtocol =
    | "openai-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "google-generative-ai";

export type AgentPresetId =
    | "author_story"
    | "fix_validation_issues"
    | "translate_story"
    | "prepare_tts_manifest";

export interface AgentWorkflowPlan {
    id: string;
    mode: AgentAuthoringMode;
    title: string;
    region: DesktopStoryRegion;
    premise: string;
    castPlan: Array<{ key: string; name: string; charId?: number; notes?: string }>;
    scenes: Array<{ id: string; title: string; summary: string }>;
    branches: string[];
    endings: Array<{ id: string; title: string; condition?: string }>;
    researchTargets: string[];
    status: AgentWorkflowPlanStatus;
}

export interface AgentModelOption {
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
    supportsThinking: boolean;
    contextWindow: number;
    maxTokens?: number;
    isDefault?: boolean;
    source: "curated" | "registry" | "live";
}

export interface AgentFetchModelsResult {
    ok: boolean;
    provider: string;
    source: "live" | "catalog";
    models: AgentModelOption[];
    error?: string;
}

export interface AgentProviderConfigInput {
    mode: AgentMode;
    provider: string;
    model: string;
    baseUrl?: string;
    api?: AgentApiProtocol;
    thinkingLevel?: AgentThinkingLevel;
    authoringMode?: AgentAuthoringMode;
    planFirst?: boolean;
    /** Omit or pass undefined when updating settings to preserve stored encrypted API key. */
    apiKey?: string;
    clearApiKey?: boolean;
    rpcCliPath?: string;
    rpcArgs?: string[];
}

export interface AgentProviderConfigPublic {
    mode: AgentMode;
    provider: string;
    model: string;
    baseUrl: string;
    api?: AgentApiProtocol;
    thinkingLevel: AgentThinkingLevel;
    authoringMode: AgentAuthoringMode;
    planFirst: boolean;
    hasApiKey: boolean;
    apiKeyHint: string;
    safeStorageAvailable: boolean;
    rpcCliPath: string;
    rpcArgs: string[];
}

export interface AgentKnownProviderInfo {
    id: string;
    label: string;
    defaultModel?: string;
    defaultBaseUrl?: string;
    api?: AgentApiProtocol;
    sampleModels?: AgentModelOption[];
}

export interface AgentRuntimeStatus {
    status: AgentStatus;
    mode: AgentMode;
    provider: string;
    model: string;
    thinkingLevel: AgentThinkingLevel;
    authoringMode: AgentAuthoringMode;
    planFirst: boolean;
    hasApiKey: boolean;
    isStreaming: boolean;
    activeSessionId?: string | null;
    workspaceDir?: string;
    storyFile?: string;
    lastError?: string;
}

export interface AgentSessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    authoringMode: AgentAuthoringMode;
    model?: string;
    provider?: string;
    messageCount: number;
    sessionFile: string;
}

export interface AgentPersistedToolCall {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: "running" | "done" | "error";
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    summary?: string;
    details?: unknown;
    collapsed: boolean;
}

export interface AgentPersistedRetry {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
    code?: string;
    startedAt: number;
    endedAt?: number;
    status: "retrying" | "recovered" | "failed";
}

export interface AgentPersistedTurn {
    id: string;
    role: "user" | "assistant";
    text: string;
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingEndedAt?: number;
    thinkingCollapsed: boolean;
    tools?: AgentPersistedToolCall[];
    diffs?: AgentMskDiffSummary[];
    plan?: AgentWorkflowPlan;
    planAwaitingApproval?: boolean;
    retries?: AgentPersistedRetry[];
    retryNoticeCollapsed: boolean;
    error?: string;
    aborted?: boolean;
    stats?: { inputTokens: number; outputTokens: number; totalTokens: number; toolCalls: number };
    timestamp: number;
    startedAt: number;
    endedAt?: number;
}

export interface AgentResumedSession {
    summary: AgentSessionSummary;
    transcript: AgentPersistedTurn[];
    activePlan: AgentWorkflowPlan | null;
}

export interface AgentPromptContextPayload {
    selectedNodeId?: string | null;
    selectedBeatId?: string | null;
    activeMode?: "flow" | "code" | "playtest";
    locale?: DesktopUiLocale;
    authoringMode?: AgentAuthoringMode;
    planFirst?: boolean;
    thinkingLevel?: AgentThinkingLevel;
}

export interface AgentPromptPayload {
    prompt: string;
    context?: AgentPromptContextPayload;
}

export interface AgentPresetPayload {
    preset: AgentPresetId;
    brief?: string;
    targetLocale?: DesktopUiLocale;
    region?: DesktopStoryRegion;
    verifyAssets?: boolean;
    context?: AgentPromptContextPayload;
}

export interface AgentMskDiffSummary {
    snapshotId: string | null;
    storyFile: string;
    addedNodeIds: string[];
    removedNodeIds: string[];
    modifiedNodeIds: string[];
    addedCastKeys: string[];
    removedCastKeys: string[];
    modifiedCastKeys: string[];
    addedVarIds: string[];
    removedVarIds: string[];
    modifiedVarIds: string[];
    nodeCountBefore: number;
    nodeCountAfter: number;
    beatCountBefore: number;
    beatCountAfter: number;
    beatCountDelta: number;
    compileOk: boolean;
    errorCount: number;
    warningCount: number;
    unifiedDiffPreview: string;
}

export type AgentEditorAction =
    | { kind: "focus_node"; nodeId: string }
    | { kind: "select_beat"; nodeId: string; beatId: string }
    | { kind: "switch_mode"; mode: "edit" | "flow" | "code" | "playtest" }
    | { kind: "playtest_from_node"; nodeId: string }
    | { kind: "open_export_dialog"; format?: "msk" | "bundle" | "i18n" };

export type DesktopAgentEvent =
    | { type: "status"; status: AgentStatus; mode: AgentMode; message?: string; timestamp: number }
    | { type: "text_delta"; delta: string; contentIndex?: number; timestamp: number }
    | { type: "thinking_delta"; delta: string; contentIndex?: number; timestamp: number }
    | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown>; timestamp: number }
    | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; details?: unknown; durationMs?: number; timestamp: number }
    | { type: "msk_diff"; diff: AgentMskDiffSummary; storyFile: string; timestamp: number }
    | { type: "snapshot_created"; snapshot: WorkspaceSnapshotInfo; timestamp: number }
    | { type: "editor_action"; action: AgentEditorAction; timestamp: number }
    | { type: "workflow_stage"; mode: AgentAuthoringMode; stage: AgentWorkflowStage; status: AgentWorkflowStageStatus; label?: string; detail?: string; timestamp: number }
    | { type: "plan_proposed"; plan: AgentWorkflowPlan; awaitingApproval: boolean; timestamp: number }
    | { type: "plan_resolved"; planId: string; decision: "approved" | "revise"; feedback?: string; timestamp: number }
    | { type: "retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string; code?: string; timestamp: number }
    | { type: "retry_end"; attempt: number; maxAttempts: number; success: boolean; finalError?: string; timestamp: number }
    | { type: "error"; message: string; code?: string; recoverable?: boolean; timestamp: number }
    | { type: "done"; aborted: boolean; finalText: string; stats?: { inputTokens: number; outputTokens: number; totalTokens: number; toolCalls: number }; timestamp: number };

// ==================== Desktop App Settings & Menu ====================

export interface DesktopAppSettings {
    themeSeed: string;
    themeMode: DesktopThemeMode;
    locale: DesktopUiLocale;
    assetLine: "main" | "backup";
    agentPanelOpen: boolean;
    agentPanelWidth: number;
    updateChannel: UpdateChannel;
    autoCheckUpdates: boolean;
    ignoredUpdateVersion: string | null;
    assetCacheEnabled: boolean;
    assetCacheMaxMb: number;
    stageRenderQuality: DesktopStageRenderQuality;
}

export interface UpdateCheckRequest {
    channel?: UpdateChannel;
    manual?: boolean;
}

export interface DesktopAppInfo {
    version: string;
    electronVersion: string;
    platform: NodeJS.Platform;
    isFullscreen: boolean;
    isDev: boolean;
    live2dScriptBase: string;
    workspaceProtocolBase: string;
    skillPath: string;
}

export type MenuCommand =
    | { type: "new-project" }
    | { type: "open-folder" }
    | { type: "open-msk" }
    | { type: "open-recent"; path: string }
    | { type: "save" }
    | { type: "export-msk" }
    | { type: "export-bundle" }
    | { type: "reveal-project" }
    | { type: "set-theme-mode"; mode: DesktopThemeMode }
    | { type: "set-theme-seed"; seed: string }
    | { type: "set-locale"; locale: DesktopUiLocale }
    | { type: "toggle-agent-panel" }
    | { type: "run-agent-preset"; preset: AgentPresetId }
    | { type: "open-agent-settings" }
    | { type: "open-settings"; tab?: "general" | "stage" | "agent" }
    | { type: "open-cache-dialog" }
    | { type: "check-for-updates" }
    | { type: "open-notices" };

export type UnsubscribeFn = () => void;

/**
 * Typed bridge exposed via `contextBridge.exposeInMainWorld("moesekaiDesktop", ...)`.
 */
export interface MoesekaiDesktopApi {
    app: {
        getInfo(): Promise<DesktopAppInfo>;
        getSettings(): Promise<DesktopAppSettings>;
        updateSettings(patch: Partial<DesktopAppSettings>): Promise<DesktopAppSettings>;
        openExternal(url: string): Promise<void>;
        onFullscreenChange(listener: (isFullscreen: boolean) => void): UnsubscribeFn;
    };
    workspace: {
        getActive(): Promise<WorkspaceProjectData | null>;
        pickAndCreate(input: Omit<CreateWorkspaceInput, "dirPath">): Promise<WorkspaceProjectData | null>;
        openStarterDemo(input: Omit<CreateWorkspaceInput, "dirPath">): Promise<WorkspaceProjectData>;
        create(input: CreateWorkspaceInput): Promise<WorkspaceProjectData>;
        openFolderDialog(): Promise<WorkspaceProjectData | null>;
        openMskDialog(): Promise<WorkspaceProjectData | null>;
        openPath(targetPath: string): Promise<WorkspaceProjectData>;
        save(input: SaveWorkspaceInput): Promise<SaveWorkspaceResult>;
        close(): Promise<void>;
        listRecent(): Promise<RecentProjectEntry[]>;
        removeRecent(targetPath: string): Promise<RecentProjectEntry[]>;
        listSnapshots(): Promise<WorkspaceSnapshotInfo[]>;
        createSnapshot(reason?: string): Promise<WorkspaceSnapshotInfo>;
        rollbackSnapshot(snapshotId: string): Promise<WorkspaceProjectData>;
        importVoiceFile(beatId?: string): Promise<{ relativePath: string; url: string; fileName: string; sizeBytes: number } | null>;
        revealPath(targetPath?: string): Promise<void>;
        onExternalChange(listener: (event: WorkspaceExternalChangeEvent) => void): UnsubscribeFn;
    };
    exporter: {
        preflight(req: ExportPreflightRequest): Promise<ExportPreflightResult>;
        exportMsk(req: ExportMskRequest): Promise<ExportOperationResult>;
        exportBundle(req: ExportBundleRequest): Promise<ExportOperationResult>;
        exportLocales(req: ExportLocalesRequest): Promise<ExportOperationResult>;
    };
    agent: {
        getConfig(): Promise<AgentProviderConfigPublic>;
        saveConfig(config: AgentProviderConfigInput): Promise<AgentProviderConfigPublic>;
        getStatus(): Promise<AgentRuntimeStatus>;
        listProviders(): Promise<AgentKnownProviderInfo[]>;
        fetchModels(override?: Partial<AgentProviderConfigInput>): Promise<AgentFetchModelsResult>;
        setThinkingLevel(level: AgentThinkingLevel): Promise<AgentProviderConfigPublic>;
        setAuthoringMode(mode: AgentAuthoringMode, planFirst?: boolean): Promise<AgentProviderConfigPublic>;
        setPlanFirst(planFirst: boolean): Promise<AgentProviderConfigPublic>;
        approvePlan(planId: string, feedback?: string): Promise<{ ok: boolean }>;
        revisePlan(planId: string, feedback: string): Promise<{ ok: boolean }>;
        prompt(payload: AgentPromptPayload): Promise<{ ok: boolean }>;
        runPreset(payload: AgentPresetPayload): Promise<{ ok: boolean }>;
        abort(): Promise<void>;
        reset(): Promise<void>;
        listSessions(): Promise<AgentSessionSummary[]>;
        resumeSession(sessionId: string): Promise<AgentResumedSession>;
        newSession(): Promise<{ sessionId: string }>;
        deleteSession(sessionId: string): Promise<boolean>;
        listSnapshots(): Promise<WorkspaceSnapshotInfo[]>;
        rollbackSnapshot(snapshotId: string): Promise<WorkspaceProjectData>;
        onEvent(listener: (event: DesktopAgentEvent) => void): UnsubscribeFn;
    };
    menu: {
        onCommand(listener: (command: MenuCommand) => void): UnsubscribeFn;
        onOpenFileRequest(listener: (filePath: string) => void): UnsubscribeFn;
    };
    updates: {
        check(opts?: UpdateCheckRequest): Promise<DesktopUpdateCheckResult>;
        ignoreVersion(version: string | null): Promise<DesktopAppSettings>;
        openDownload(url: string): Promise<void>;
        onUpdateAvailable(listener: (result: DesktopUpdateCheckResult) => void): UnsubscribeFn;
    };
    cache: {
        getStats(): Promise<AssetCacheStats>;
        clear(): Promise<AssetCacheStats>;
        openDir(): Promise<void>;
        setMaxMb(mb: number): Promise<AssetCacheStats>;
        setEnabled(enabled: boolean): Promise<AssetCacheStats>;
    };
}
