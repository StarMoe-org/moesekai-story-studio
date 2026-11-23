import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type {
    StoryCompileDiagnostic,
    StoryDocument,
    StoryLocalePack,
    StoryRegion,
    StoryVoiceManifest,
    StoryVoiceRef,
    UiLocale,
} from "@moesekai/story-core";

// ==================== Mode, Status, Reasoning Effort & Authoring Workflow ====================

export type StoryAgentMode = "sdk" | "rpc";

export type StoryAgentStatus =
    | "idle"
    | "starting"
    | "thinking"
    | "streaming"
    | "tool_running"
    | "retrying"
    | "aborted"
    | "error";

export const STORY_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type StoryThinkingLevel = (typeof STORY_THINKING_LEVELS)[number];
/** Backwards-compatible union accepting all runtime thinking levels. */
export type StoryAgentThinkingLevel = StoryThinkingLevel | ThinkingLevel;

export const STORY_AUTHORING_MODES = ["create", "edit"] as const;
export type StoryAuthoringMode = (typeof STORY_AUTHORING_MODES)[number];

export const STORY_WORKFLOW_STAGES = [
    "outline",
    "research",
    "author",
    "verify",
    "inspect",
    "patch",
] as const;
export type StoryWorkflowStage = (typeof STORY_WORKFLOW_STAGES)[number];

export type StoryWorkflowStageStatus = "active" | "completed" | "skipped";

export type StoryWorkflowPlanStatus = "pending_approval" | "approved" | "revised";

export interface StoryWorkflowPlanCastItem {
    key: string;
    name: string;
    charId?: number;
    notes?: string;
}

export interface StoryWorkflowPlanSceneItem {
    id: string;
    title: string;
    summary: string;
}

export interface StoryWorkflowPlanEndingItem {
    id: string;
    title: string;
    condition?: string;
}

export interface StoryWorkflowPlan {
    id: string;
    mode: StoryAuthoringMode;
    title: string;
    region: StoryRegion;
    premise: string;
    castPlan: StoryWorkflowPlanCastItem[];
    scenes: StoryWorkflowPlanSceneItem[];
    branches: string[];
    endings: StoryWorkflowPlanEndingItem[];
    researchTargets: string[];
    status: StoryWorkflowPlanStatus;
}

export interface StoryActiveWorkflowStage {
    mode: StoryAuthoringMode;
    stage: StoryWorkflowStage;
    status: StoryWorkflowStageStatus;
    label?: string;
    detail?: string;
}

export type StoryAgentPresetId =
    | "author_story"
    | "fix_validation_issues"
    | "translate_story"
    | "prepare_tts_manifest";

export type StoryAgentCustomApi =
    | "openai-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "google-generative-ai";

export interface StoryAgentProviderConfig {
    mode: StoryAgentMode;
    /** Provider id (e.g. "anthropic", "openai", "google", "openrouter", "deepseek", "custom"). */
    provider?: string;
    /** Model id within the provider (e.g. "claude-opus-5-5", "gpt-6.2-astra", "gemini-4-carbon"). */
    model?: string;
    /** Provider API key (in-memory only; never written to external credential files). */
    apiKey?: string;
    /** Optional custom base URL for OpenAI-compatible, Anthropic-compatible, or Google-compatible endpoints. */
    baseUrl?: string;
    /** Wire API format when using a custom `baseUrl` or unregistered model (defaults to "openai-completions"). */
    api?: StoryAgentCustomApi;
    /** Custom HTTP headers for custom/compatible endpoints. */
    headers?: Record<string, string>;
    /** Codex-style reasoning/thinking effort level (defaults to "medium" for reasoning models). */
    thinkingLevel?: StoryThinkingLevel;
    /** Active authoring mode ("create" from scratch vs "edit" existing workspace story). */
    authoringMode?: StoryAuthoringMode;
    /** When true, require structured plan submission + user approval before modifying `.msk`. */
    planFirst?: boolean;
    /** Optional path to local CLI entry point or executable when `mode === "rpc"`. */
    rpcCliPath?: string;
    /** Additional CLI arguments passed in RPC mode. */
    rpcArgs?: string[];
}

export interface StoryModelOption {
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

export interface FetchProviderModelsResult {
    ok: boolean;
    provider: string;
    source: "live" | "catalog";
    models: StoryModelOption[];
    error?: string;
}

export interface KnownProviderInfo {
    id: string;
    name: string;
    defaultModel?: string;
    defaultBaseUrl?: string;
    api?: StoryAgentCustomApi;
    sampleModels: StoryModelOption[];
}

/** Backwards-compatible alias for `KnownProviderInfo`. */
export type KnownPiProviderInfo = KnownProviderInfo;

// ==================== Snapshots & Structured .msk Diff ====================

export interface StorySnapshotMeta {
    id: string;
    createdAt: string;
    reason: string;
    toolName?: string;
    storyFile: string;
    nodeCount: number;
    beatCount: number;
    byteLength: number;
    sha256: string;
}

export interface StoryMskDiff {
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

export interface StoryRollbackResult {
    ok: boolean;
    snapshot: StorySnapshotMeta;
    diff: StoryMskDiff;
    safetySnapshotId: string | null;
}

// ==================== Editor Actions & Streaming Events ====================

export type StoryEditorAction =
    | { kind: "focus_node"; nodeId: string }
    | { kind: "select_beat"; nodeId: string; beatId: string }
    | { kind: "switch_mode"; mode: "edit" | "flow" | "code" | "playtest" }
    | { kind: "playtest_from_node"; nodeId: string }
    | { kind: "open_export_dialog"; format?: "msk" | "bundle" | "i18n" };

export interface StoryAgentRunStats {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    toolCalls: number;
}

export type StoryAgentEvent =
    | {
        type: "status";
        status: StoryAgentStatus;
        mode: StoryAgentMode;
        message?: string;
        timestamp: number;
    }
    | {
        type: "text_delta";
        delta: string;
        contentIndex?: number;
        timestamp: number;
    }
    | {
        type: "thinking_delta";
        delta: string;
        contentIndex?: number;
        timestamp: number;
    }
    | {
        type: "tool_start";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        timestamp: number;
    }
    | {
        type: "tool_end";
        toolCallId: string;
        toolName: string;
        isError: boolean;
        summary: string;
        details?: unknown;
        durationMs?: number;
        timestamp: number;
    }
    | {
        type: "msk_diff";
        diff: StoryMskDiff;
        storyFile: string;
        timestamp: number;
    }
    | {
        type: "snapshot_created";
        snapshot: StorySnapshotMeta;
        timestamp: number;
    }
    | {
        type: "editor_action";
        action: StoryEditorAction;
        timestamp: number;
    }
    | {
        type: "workflow_stage";
        mode: StoryAuthoringMode;
        stage: StoryWorkflowStage;
        status: StoryWorkflowStageStatus;
        label?: string;
        detail?: string;
        timestamp: number;
    }
    | {
        type: "plan_proposed";
        plan: StoryWorkflowPlan;
        awaitingApproval: boolean;
        timestamp: number;
    }
    | {
        type: "plan_resolved";
        planId: string;
        decision: "approved" | "revise";
        feedback?: string;
        timestamp: number;
    }
    | {
        type: "retry_start";
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        errorMessage: string;
        code?: string;
        timestamp: number;
    }
    | {
        type: "retry_end";
        attempt: number;
        maxAttempts: number;
        success: boolean;
        finalError?: string;
        timestamp: number;
    }
    | {
        type: "error";
        message: string;
        code?: string;
        recoverable?: boolean;
        timestamp: number;
    }
    | {
        type: "done";
        aborted: boolean;
        finalText: string;
        stats?: StoryAgentRunStats;
        timestamp: number;
    };

export type StoryAgentEventListener = (event: StoryAgentEvent) => void;

// ==================== Validation, Simulation & Asset Verification ====================

export interface StoryParseDiagnosticItem {
    line: number;
    col: number;
    message: string;
}

export interface StoryDocSummary {
    id: string;
    title: string;
    region: StoryRegion;
    schema: string;
    castCount: number;
    variableCount: number;
    nodeCount: number;
    nodesByType: {
        start: number;
        scene: number;
        choice: number;
        condition: number;
        end: number;
    };
    edgeCount: number;
    beatCount: number;
    reachableNodeCount: number;
    endingCount: number;
}

export interface StorySimulatedChoiceStep {
    nodeId: string;
    optionId: string;
    text: string;
}

export interface StorySimulatedPath {
    index: number;
    outcome: string;
    choices: StorySimulatedChoiceStep[];
    ending: { nodeId: string; title: string; subtitle?: string } | null;
    finalNodeId: string | null;
    variables: Record<string, number | boolean>;
    beatCount: number;
    visitedNodeIds: string[];
}

export interface StoryOffStageTalkWarning {
    nodeId: string;
    beatId: string;
    speakerKey: string;
}

export interface StoryStageOverlapWarning {
    kind: "duplicateSlot" | "overlap";
    nodeId: string;
    beatId?: string;
    slot?: string;
    actors: string[];
    gap?: number;
    minGap?: number;
}

export interface StorySimulationReport {
    skipped?: boolean;
    reason?: string;
    totalPaths: number;
    truncated: boolean;
    declaredEndings: string[];
    reachedEndings: string[];
    unreachedEndings: string[];
    disconnectedPaths: number;
    loopPaths: number;
    deadlockPaths: number;
    offStageTalks: StoryOffStageTalkWarning[];
    stageOverlaps: StoryStageOverlapWarning[];
    paths: StorySimulatedPath[];
}

export interface StoryAssetReport {
    region: StoryRegion;
    line: "main" | "backup";
    live2dSiteUrl: string;
    live2dModelListingUrl: string;
    live2dMotionListingUrl: string;
    live2dProxyUrl?: string;
    live2d: Array<{
        modelId: string;
        castKeys: string[];
        modelAssetPath: string;
        motions: string[];
        facials: string[];
    }>;
    backgrounds: Array<{ name: string; webp: string; png: string }>;
    bgm: Array<{ name: string; url: string }>;
    se: Array<{ name: string; urls: string[] }>;
    voices: Array<{ ref: StoryVoiceRef; urls: string[] }>;
}

export interface StoryMissingAssetItem {
    category:
        | "live2d-model"
        | "live2d-motion-bundle"
        | "live2d-motion"
        | "live2d-facial"
        | "background"
        | "bgm"
        | "se"
        | "voice";
    name: string;
    url?: string;
    urls?: string[];
    reason: string;
    suggestions?: string[];
}

export interface StoryAssetVerificationReport {
    ok: boolean;
    live2dSource: "asset-site-listings" | "asset-document-fallback";
    live2dPublishedVersion?: string;
    checked: {
        live2dModels: number;
        live2dClips: number;
        backgrounds: number;
        bgm: number;
        se: number;
        voices: number;
    };
    missing: StoryMissingAssetItem[];
}

export interface StoryValidationReport {
    ok: boolean;
    strictOk: boolean;
    parseDiagnostics: StoryParseDiagnosticItem[];
    summary: StoryDocSummary | null;
    errors: StoryCompileDiagnostic[];
    warnings: StoryCompileDiagnostic[];
    simulation?: StorySimulationReport;
    assets?: StoryAssetReport;
    assetVerification?: StoryAssetVerificationReport;
}

// ==================== Workspace Outline & Voice Cue Candidates ====================

export interface StoryWorkspaceNodeOutline {
    id: string;
    type: "start" | "scene" | "choice" | "condition" | "end";
    title: string;
    beatCount?: number;
    optionCount?: number;
    ruleCount?: number;
    subtitle?: string;
    outgoingTargets: string[];
}

export interface StoryWorkspaceLocaleSummary {
    locale: UiLocale;
    filePath: string;
    origin: string;
    translatedBeats: number;
    outdatedBeats: number;
    missingBeats: number;
    totalBeats: number;
    modelHint?: string;
}

export interface StoryWorkspaceVoiceSummary {
    filePath: string;
    schema: string;
    locale?: UiLocale;
    title?: string;
    totalManifestLines: number;
    totalTalkBeats: number;
    matchedCount: number;
    storyIdMismatch: boolean;
}

export interface StoryWorkspaceSnapshot {
    workspaceDir: string;
    storyFile: string;
    exists: boolean;
    byteLength: number;
    lineCount: number;
    parseOk: boolean;
    parseDiagnostics: StoryParseDiagnosticItem[];
    docSummary: StoryDocSummary | null;
    cast: Array<{ key: string; name: string; modelId: string; characterId?: number }>;
    variables: Array<{ id: string; name: string; type: "number" | "boolean"; initial: number | boolean }>;
    nodes: StoryWorkspaceNodeOutline[];
    endings: Array<{ id: string; title: string; subtitle?: string }>;
    selectedNodeContext?: {
        nodeId: string;
        nodeType: string;
        title: string;
        mskSnippet: string;
        beatsPreview?: Array<{ id: string; kind: string; summary: string }>;
    };
    locales: StoryWorkspaceLocaleSummary[];
    voiceManifest: StoryWorkspaceVoiceSummary | null;
    snapshotCount: number;
    script?: string;
}

export interface StoryTtsCandidateLine {
    beatId: string;
    nodeId: string;
    sceneTitle: string;
    speakerKey?: string;
    speakerName: string;
    characterId?: number;
    locale: UiLocale;
    text: string;
    cleanTtsText: string;
    placeholders: string[];
    hasOfficialVoice: boolean;
    hasCustomVoice: boolean;
    recommendedFilename: string;
    speechHint?: {
        jpName: string;
        firstPerson: string;
        toneJa: string;
        toneEn: string;
    };
}

// ==================== Persistent Per-Project Session History & Retry ====================

export interface StoryAgentRetryPolicy {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

export interface StoryAgentPersistedToolCall {
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

export interface StoryAgentPersistedRetry {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
    code?: string;
    startedAt: number;
    endedAt?: number;
    status: "retrying" | "recovered" | "failed";
}

export interface StoryAgentPersistedTurn {
    id: string;
    role: "user" | "assistant";
    text: string;
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingEndedAt?: number;
    thinkingCollapsed: boolean;
    tools?: StoryAgentPersistedToolCall[];
    diffs?: StoryMskDiff[];
    plan?: StoryWorkflowPlan;
    planAwaitingApproval?: boolean;
    retries?: StoryAgentPersistedRetry[];
    retryNoticeCollapsed: boolean;
    error?: string;
    aborted?: boolean;
    stats?: StoryAgentRunStats;
    timestamp: number;
    startedAt: number;
    endedAt?: number;
}

export interface StoryAgentSessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    authoringMode: StoryAuthoringMode;
    model?: string;
    provider?: string;
    messageCount: number;
    sessionFile: string;
}

export interface StoryAgentResumedSession {
    summary: StoryAgentSessionSummary;
    transcript: StoryAgentPersistedTurn[];
    activePlan: StoryWorkflowPlan | null;
}

// ==================== Session Controller & UtilityProcess IPC ====================

export interface StoryAgentPromptContext {
    selectedNodeId?: string | null;
    selectedBeatId?: string | null;
    activeMode?: "edit" | "flow" | "code" | "playtest";
    locale?: string;
    authoringMode?: StoryAuthoringMode;
    planFirst?: boolean;
    thinkingLevel?: StoryThinkingLevel;
}

export interface StoryAgentPresetOptions {
    /** Story concept / cast / theme brief for `author_story`. */
    brief?: string;
    /** Target locale for `translate_story` or `prepare_tts_manifest`. */
    targetLocale?: UiLocale;
    /** Target game server region (`jp` | `cn` | `tw` | `kr` | `en`). */
    region?: StoryRegion;
    /** Whether `fix_validation_issues` / `author_story` should verify CDN assets live. */
    verifyAssets?: boolean;
    /** Active editor UI selection context. */
    context?: StoryAgentPromptContext;
}

export interface StoryAgentSessionOptions {
    workspaceDir: string;
    /** Active `.msk` file relative to `workspaceDir` (defaults to `"story.msk"`). */
    storyFile?: string;
    /** Path to `skills/moesekai-story-script` directory or `SKILL.md`. */
    skillPath?: string;
    config: StoryAgentProviderConfig;
    /** Persist conversation sessions under `<workspaceDir>/.moesekai-studio/sessions/` (defaults to `true`). */
    persistSessions?: boolean;
    /** Optional auto-retry policy overrides (defaults to enabled, 3 retries, 1500ms -> 3000ms -> 6000ms backoff). */
    retry?: Partial<StoryAgentRetryPolicy>;
    /** CDN line for official story mining & asset verification. */
    assetLine?: "main" | "backup";
    /** Optional environment overrides passed to provider/RPC. */
    env?: Record<string, string>;
    /** Optional custom fetch implementation (useful for offline tests or proxies). */
    fetchImpl?: typeof fetch;
    /** Optional native runtime `Provider` + `Model` override (used in offline tests). */
    testProvider?: {
        provider: Provider;
        model: Model<Api>;
    };
}

export interface StoryAgentControllerState {
    status: StoryAgentStatus;
    mode: StoryAgentMode;
    workspaceDir: string;
    storyFile: string;
    activeSessionId: string | null;
    provider?: string;
    model?: string;
    thinkingLevel: StoryThinkingLevel;
    authoringMode: StoryAuthoringMode;
    planFirst: boolean;
    pendingPlan: StoryWorkflowPlan | null;
    activeStage: StoryActiveWorkflowStage | null;
    isStreaming: boolean;
}

export interface StoryAgentSessionController {
    subscribe(listener: StoryAgentEventListener): () => void;
    prompt(text: string, context?: StoryAgentPromptContext): Promise<void>;
    runPreset(preset: StoryAgentPresetId, options?: StoryAgentPresetOptions): Promise<void>;
    abort(): Promise<void>;
    reset(): Promise<void>;
    updateConfig(config: Partial<StoryAgentProviderConfig>): Promise<void>;
    setThinkingLevel(level: StoryThinkingLevel): Promise<void>;
    setAuthoringMode(mode: StoryAuthoringMode): Promise<void>;
    setPlanFirst(planFirst: boolean): Promise<void>;
    approvePlan(planId: string, feedback?: string): Promise<void>;
    revisePlan(planId: string, feedback: string): Promise<void>;
    fetchModels(overrideConfig?: Partial<StoryAgentProviderConfig>): Promise<FetchProviderModelsResult>;
    updateWorkspace(workspaceDir: string, storyFile?: string): Promise<void>;
    listSnapshots(): Promise<StorySnapshotMeta[]>;
    rollbackToSnapshot(snapshotId: string): Promise<StoryRollbackResult>;
    listSessions(): Promise<StoryAgentSessionSummary[]>;
    resumeSession(sessionId: string): Promise<StoryAgentResumedSession>;
    newSession(): Promise<{ sessionId: string }>;
    deleteSession(sessionId: string): Promise<boolean>;
    saveSessionTranscript(
        sessionId: string,
        transcript: StoryAgentPersistedTurn[],
        activePlan?: StoryWorkflowPlan | null,
    ): Promise<void>;
    getState(): StoryAgentControllerState;
    dispose(): Promise<void>;
}

// ==================== Electron utilityProcess Worker IPC Protocol ====================

export type StoryAgentWorkerRequest =
    | {
        id: string;
        type: "init";
        options: Omit<StoryAgentSessionOptions, "fetchImpl" | "testProvider">;
    }
    | {
        id: string;
        type: "prompt";
        text: string;
        context?: StoryAgentPromptContext;
    }
    | {
        id: string;
        type: "run_preset";
        preset: StoryAgentPresetId;
        options?: StoryAgentPresetOptions;
    }
    | {
        id: string;
        type: "abort";
    }
    | {
        id: string;
        type: "reset";
    }
    | {
        id: string;
        type: "update_config";
        config: Partial<StoryAgentProviderConfig>;
    }
    | {
        id: string;
        type: "set_thinking_level";
        thinkingLevel: StoryThinkingLevel;
    }
    | {
        id: string;
        type: "set_authoring_mode";
        authoringMode: StoryAuthoringMode;
    }
    | {
        id: string;
        type: "set_plan_first";
        planFirst: boolean;
    }
    | {
        id: string;
        type: "approve_plan";
        planId: string;
        feedback?: string;
    }
    | {
        id: string;
        type: "revise_plan";
        planId: string;
        feedback: string;
    }
    | {
        id: string;
        type: "fetch_models";
        config?: Partial<StoryAgentProviderConfig>;
    }
    | {
        id: string;
        type: "update_workspace";
        workspaceDir: string;
        storyFile?: string;
    }
    | {
        id: string;
        type: "list_snapshots";
    }
    | {
        id: string;
        type: "rollback_snapshot";
        snapshotId: string;
    }
    | {
        id: string;
        type: "list_sessions";
    }
    | {
        id: string;
        type: "resume_session";
        sessionId: string;
    }
    | {
        id: string;
        type: "new_session";
    }
    | {
        id: string;
        type: "delete_session";
        sessionId: string;
    }
    | {
        id: string;
        type: "save_session_transcript";
        sessionId: string;
        transcript: StoryAgentPersistedTurn[];
        activePlan?: StoryWorkflowPlan | null;
    }
    | {
        id: string;
        type: "get_state";
    }
    | {
        id: string;
        type: "list_providers";
    }
    | {
        id: string;
        type: "dispose";
    };

export type StoryAgentWorkerResponse =
    | {
        type: "event";
        event: StoryAgentEvent;
    }
    | {
        type: "reply";
        id: string;
        ok: true;
        data?: unknown;
    }
    | {
        type: "reply";
        id: string;
        ok: false;
        error: string;
        code?: string;
    };

export type { StoryDocument, StoryLocalePack, StoryVoiceManifest, UiLocale, StoryRegion };
