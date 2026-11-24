import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    RpcClient,
    SessionManager,
    SettingsManager,
    type AgentSession,
    type AgentSessionEvent,
    type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import {
    fetchLiveProviderModels,
    getCuratedDefaultModelId,
    inferModelSupportsThinking,
    listKnownProviders,
} from "./models";
import { buildPresetPrompt } from "./presets";
import {
    abortableSleep,
    computeRetryDelayMs,
    extractTransientErrorCode,
    formatErrorMessageWithCause,
    isAbortError,
    isTransientNetworkError,
    resolveRetryPolicy,
} from "./retry";
import {
    assertSafeSessionId,
    deleteWorkspaceSession,
    deriveSessionTitle,
    listWorkspaceSessions,
    loadWorkspaceSession,
    resolveSessionsDir,
    saveWorkspaceSessionSidecar,
} from "./session-store";
import {
    createDiskOfficialStoryCache,
    createNodeWorkspaceFiles,
    decodeBrotliWithZlib,
} from "./node";
import {
    buildStoryAgentSystemPrompt,
    formatUserPromptWithContext,
    summarizeToolResult,
} from "./prompt";
import { createStoryMakerTools } from "./tools";
import type {
    FetchProviderModelsResult,
    StoryActiveWorkflowStage,
    StoryAgentControllerState,
    StoryAgentCustomApi,
    StoryAgentEvent,
    StoryAgentEventListener,
    StoryAgentPersistedTurn,
    StoryAgentPresetId,
    StoryAgentPresetOptions,
    StoryAgentPromptContext,
    StoryAgentProviderConfig,
    StoryAgentResumedSession,
    StoryAgentRunStats,
    StoryAgentSessionController,
    StoryAgentSessionOptions,
    StoryAgentSessionSummary,
    StoryAgentStatus,
    StoryAgentWorkerRequest,
    StoryAgentWorkerResponse,
    StoryAuthoringMode,
    StoryRollbackResult,
    StorySnapshotMeta,
    StoryThinkingLevel,
    StoryWorkflowPlan,
} from "./types";
import {
    DEFAULT_STORY_FILE,
    computeMskDiff,
    listStorySnapshots,
    normalizeLineEndings,
    rollbackStorySnapshot,
} from "./workspace";

// ==================== Skill Path ====================

export function resolveDefaultSkillPath(workspaceDir?: string, explicitSkillPath?: string): string | undefined {
    const candidates: string[] = [];
    if (explicitSkillPath) candidates.push(explicitSkillPath);
    if (workspaceDir) {
        candidates.push(join(workspaceDir, "skills", "moesekai-story-script"));
    }
    const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        candidates.push(join(resourcesPath, "skills", "moesekai-story-script"));
    }
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        candidates.push(resolve(here, "../../../skills/moesekai-story-script"));
        candidates.push(resolve(here, "../../../../skills/moesekai-story-script"));
    } catch {
        // Ignore
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (existsSync(candidate)) {
            const skillMd = candidate.endsWith("SKILL.md") ? candidate : join(candidate, "SKILL.md");
            if (existsSync(skillMd)) {
                return candidate.endsWith("SKILL.md") ? dirname(candidate) : candidate;
            }
        }
    }
    return undefined;
}

// ==================== Provider / Model Resolution ====================

function inferCustomApi(providerId: string, explicit?: StoryAgentCustomApi): Api {
    if (explicit) return explicit;
    const lower = providerId.toLowerCase();
    if (lower.includes("anthropic") || lower.includes("claude")) return "anthropic-messages";
    if (lower.includes("google") || lower.includes("gemini")) return "google-generative-ai";
    return "openai-completions";
}

function providerEnvVarName(providerId: string): string | null {
    const map: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GEMINI_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        xai: "XAI_API_KEY",
        groq: "GROQ_API_KEY",
        mistral: "MISTRAL_API_KEY",
    };
    return map[providerId.toLowerCase()] ?? null;
}

export function resolveEffectiveThinkingLevel(
    requested: StoryThinkingLevel | undefined,
    modelReasoning: boolean,
): StoryThinkingLevel {
    if (requested) return requested;
    return modelReasoning ? "medium" : "off";
}

export async function resolveSdkModelRuntime(
    config: StoryAgentProviderConfig,
    testProvider?: StoryAgentSessionOptions["testProvider"],
): Promise<{ modelRuntime: ModelRuntime; model: Model<Api> }> {
    const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false,
    });

    if (testProvider) {
        modelRuntime.registerNativeProvider(testProvider.provider);
        return { modelRuntime, model: testProvider.model };
    }

    const providerId = (config.provider?.trim() || "anthropic").toLowerCase();
    const curatedDefault = getCuratedDefaultModelId(providerId);
    const requestedModelId = config.model?.trim() || curatedDefault;
    const apiKey = config.apiKey?.trim();
    const baseUrl = config.baseUrl?.trim();

    if (baseUrl) {
        const customProviderId = providerId === "custom" ? "custom-openai" : providerId;
        const modelId = requestedModelId || "gpt-6.2-astra";
        const api = inferCustomApi(customProviderId, config.api);
        const reasoning =
            (config.thinkingLevel !== undefined && config.thinkingLevel !== "off")
            || inferModelSupportsThinking(modelId);
        modelRuntime.registerProvider(customProviderId, {
            name: customProviderId,
            baseUrl,
            apiKey: apiKey || "not-required",
            api,
            ...(config.headers ? { headers: config.headers } : {}),
            models: [
                {
                    id: modelId,
                    name: modelId,
                    api,
                    baseUrl,
                    reasoning,
                    input: ["text", "image"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 400_000,
                    maxTokens: 64_000,
                },
            ],
        });
        if (apiKey) {
            await modelRuntime.setRuntimeApiKey(customProviderId, apiKey);
        }
        const registered = modelRuntime.getModel(customProviderId, modelId);
        if (!registered) {
            throw new Error(`Failed to resolve custom model "${customProviderId}/${modelId}" at "${baseUrl}".`);
        }
        return { modelRuntime, model: registered };
    }

    if (apiKey) {
        await modelRuntime.setRuntimeApiKey(providerId, apiKey);
    }

    const providerModels = modelRuntime.getModels(providerId);
    if (requestedModelId) {
        const exact = modelRuntime.getModel(providerId, requestedModelId);
        if (exact) {
            return { modelRuntime, model: exact };
        }
        const template = providerModels[0];
        if (template) {
            const reasoning =
                (config.thinkingLevel !== undefined && config.thinkingLevel !== "off")
                || inferModelSupportsThinking(requestedModelId);
            modelRuntime.registerProvider(providerId, {
                baseUrl: template.baseUrl,
                api: config.api ?? template.api,
                ...(apiKey ? { apiKey } : {}),
                ...(config.headers ? { headers: config.headers } : {}),
                models: [
                    {
                        id: requestedModelId,
                        name: requestedModelId,
                        api: config.api ?? template.api,
                        baseUrl: template.baseUrl,
                        reasoning,
                        input: ["text", "image"],
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                        contextWindow: template.contextWindow || 400_000,
                        maxTokens: template.maxTokens || 64_000,
                    },
                ],
            });
            const synthetic = modelRuntime.getModel(providerId, requestedModelId);
            if (synthetic) return { modelRuntime, model: synthetic };
        }
        throw new Error(
            `Unknown provider/model "${providerId}/${requestedModelId}". Choose a supported model provider or configure a custom baseUrl.`,
        );
    }

    if (providerModels.length > 0) {
        return { modelRuntime, model: providerModels[0] };
    }

    throw new Error(
        `No models available for provider "${providerId}". Configure a supported provider (anthropic, openai, google, openrouter, deepseek) or set baseUrl + model.`,
    );
}

// ==================== Tool Output Summarizer & Context Framing ====================

function buildPlanApprovedContinuationPrompt(plan: StoryWorkflowPlan, feedback?: string): string {
    const castLines = plan.castPlan
        .map((c) => `- ${c.key}: ${c.name}${c.charId ? ` (char=${c.charId})` : ""}${c.notes ? ` — ${c.notes}` : ""}`)
        .join("\n");
    const sceneLines = plan.scenes.map((s) => `- ${s.id} "${s.title}": ${s.summary}`).join("\n");
    const endingLines = plan.endings
        .map((e) => `- ${e.id} "${e.title}"${e.condition ? ` (${e.condition})` : ""}`)
        .join("\n");
    const researchLines = plan.researchTargets.map((t) => `- ${t}`).join("\n");

    const steps = plan.mode === "create"
        ? [
            "1. Call `story_report_stage(stage=\"outline\", status=\"completed\", mode=\"create\")`.",
            "2. Call `story_report_stage(stage=\"research\", status=\"active\", mode=\"create\")` and call `story_mine_official` (`study`, `search-text`, `inspect`, `catalog`) to gather authentic official dialogue/blocking references and verified `v2_` models, `(motion, facial)` pairs, backgrounds, BGMs, and pack-qualified SEs. Then mark `research` completed.",
            "3. Call `story_report_stage(stage=\"author\", status=\"active\", mode=\"create\")` and write the complete `.msk` script via `story_write_msk` (use `cast set afterTelop` or `telop \"...\" actors=hide` to keep center subtitles clean, `stage sync [ ...; ... ]` / `parallel` for simultaneous actor choreography, `x=<num>`/`lock`/`mirror` for pinned framing, and `z=<int>` for depth layering). Then mark `author` completed.",
            "4. Call `story_report_stage(stage=\"verify\", status=\"active\", mode=\"create\")` and run `story_validate_and_simulate(strict=true, simulate=true)`. Self-heal any errors, warnings, overlaps, or unreached endings with `story_patch_msk` until `strictOk === true`, then mark `verify` completed.",
            "5. Focus the opening scene with `story_editor_action(kind=\"focus_node\", ...)` and present a concise summary.",
        ]
        : [
            "1. Call `story_report_stage(stage=\"inspect\", status=\"completed\", mode=\"edit\")`.",
            "2. Call `story_report_stage(stage=\"patch\", status=\"active\", mode=\"edit\")`, mine any newly needed assets via `story_mine_official`, and apply minimal surgical edits via `story_patch_msk` preserving untouched scenes (using `cast set afterTelop`, `telop ... actors=hide`, `stage sync [...]`, `x=<num>`/`lock`, and `z=<int>` as needed). Then mark `patch` completed.",
            "3. Call `story_report_stage(stage=\"verify\", status=\"active\", mode=\"edit\")` and run `story_validate_and_simulate(strict=true, simulate=true)` until `strictOk === true`. Then mark `verify` completed.",
            "4. Focus the primary modified node with `story_editor_action(kind=\"focus_node\", ...)` and summarize your edits.",
        ];

    return [
        `The user APPROVED your plan (planId=${plan.id}, title="${plan.title}", mode="${plan.mode}").`,
        feedback?.trim() ? `User approval notes: ${feedback.trim()}` : "",
        "",
        "### Approved Plan Summary",
        `Premise: ${plan.premise}`,
        castLines ? `Cast:\n${castLines}` : "",
        sceneLines ? `Scenes:\n${sceneLines}` : "",
        plan.branches.length > 0 ? `Branches: ${plan.branches.join("; ")}` : "",
        endingLines ? `Endings:\n${endingLines}` : "",
        researchLines ? `Official Research Targets:\n${researchLines}` : "",
        "",
        "### Execute Remaining Stages Now",
        ...steps,
    ]
        .filter(Boolean)
        .join("\n");
}

// ==================== Internal Retry & Transcript Helpers ====================

interface ActiveRetryState {
    source: "sdk" | "outer";
    attempt: number;
    maxAttempts: number;
    lastError: string;
    code?: string;
}

interface PendingAssistantError {
    message: string;
    code?: string;
    isAborted: boolean;
    timestamp: number;
}

interface InFlightToolRecord {
    toolCallId: string;
    toolName: string;
    startedAt: number;
}

function omitTrailingFailedAssistantMessage(session: AgentSession): boolean {
    const branch = session.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type !== "message") continue;
        if (entry.message.role === "assistant") {
            const stopReason = (entry.message as { stopReason?: string }).stopReason;
            if (stopReason === "error") {
                session.sessionManager.appendContextEdit(entry.id, null);
                session.refreshContext();
                return true;
            }
            return false;
        }
        if (entry.message.role === "user") {
            return false;
        }
    }
    return false;
}

function canContinueSdkSession(session: AgentSession): boolean {
    const messages = session.agent.state.messages;
    if (messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return last.role === "user" || last.role === "toolResult";
}

function finalizeTurnThinking(turn: StoryAgentPersistedTurn, timestamp: number): void {
    if (!turn.thinking || turn.thinkingEndedAt !== undefined) return;
    turn.thinkingEndedAt = Math.max(timestamp, turn.thinkingStartedAt ?? timestamp);
    turn.thinkingCollapsed = true;
}

// ==================== Session Controller ====================

export function createStoryAgentSession(options: StoryAgentSessionOptions): StoryAgentSessionController {
    let workspaceDir = resolve(options.workspaceDir);
    let workspaceFiles = createNodeWorkspaceFiles(workspaceDir);
    const officialStoryCache = createDiskOfficialStoryCache();
    let storyFile = options.storyFile || DEFAULT_STORY_FILE;
    let config: StoryAgentProviderConfig = { ...options.config };
    const assetLine = options.assetLine ?? "main";
    const persistSessions = options.persistSessions ?? true;
    const retryPolicy = resolveRetryPolicy(options.retry);
    let selectedNodeId: string | null | undefined = null;

    let authoringMode: StoryAuthoringMode = config.authoringMode ?? "edit";
    let planFirst: boolean = config.planFirst ?? (authoringMode === "create");
    let thinkingLevel: StoryThinkingLevel = config.thinkingLevel ?? "medium";
    let pendingPlan: StoryWorkflowPlan | null = null;
    let planApprovedForTask = false;
    let haltTurnForPlanApproval = false;
    let activeStage: StoryActiveWorkflowStage | null = null;

    let status: StoryAgentStatus = "idle";
    let isStreaming = false;
    let disposed = false;

    // Persistent session & UI transcript state
    let activeSessionId: string | null = null;
    let activeSessionFile: string | null = null;
    let pendingResumeSessionFile: string | null = null;
    let sessionCreatedAt: string | null = null;
    let sessionTitle: string | null = null;
    let activeTranscript: StoryAgentPersistedTurn[] = [];
    let currentAssistantTurn: StoryAgentPersistedTurn | null = null;
    let turnSeq = 0;

    let sdkSession: AgentSession | null = null;
    let sdkUnsubscribe: (() => void) | null = null;
    let rpcClient: RpcClient | null = null;
    let rpcUnsubscribe: (() => void) | null = null;

    const listeners = new Set<StoryAgentEventListener>();

    // Run-scoped streaming, retry & tool-settlement tracking
    let managedRunActive = false;
    let runHasStartedOnce = false;
    let userAbortRequested = false;
    let sdkRetriedThisRun = false;
    let emittedTerminalErrorThisRun = false;
    let lastSettledAborted = false;
    let activeRetry: ActiveRetryState | null = null;
    let pendingAssistantError: PendingAssistantError | null = null;
    let outerRetryAbortController: AbortController | null = null;
    const inFlightTools = new Map<string, InFlightToolRecord>();
    const settledToolCallIds = new Set<string>();

    let activeFinalText = "";
    let activeStats: StoryAgentRunStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0 };

    const nextTurnId = (prefix: "u" | "a"): string => {
        turnSeq += 1;
        return `turn_${prefix}_${Date.now().toString(36)}_${turnSeq}`;
    };

    const recordEventInTranscript = (event: StoryAgentEvent) => {
        const turn = currentAssistantTurn;
        if (!turn) return;
        const ts = event.timestamp;

        switch (event.type) {
            case "thinking_delta":
                if (turn.thinkingStartedAt === undefined) {
                    turn.thinkingStartedAt = ts;
                }
                turn.thinking = (turn.thinking ?? "") + event.delta;
                turn.thinkingCollapsed = false;
                break;

            case "text_delta":
                finalizeTurnThinking(turn, ts);
                turn.text += event.delta;
                break;

            case "tool_start":
                finalizeTurnThinking(turn, ts);
                if (!turn.tools) turn.tools = [];
                turn.tools.push({
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                    status: "running",
                    startedAt: ts,
                    collapsed: false,
                });
                break;

            case "tool_end": {
                if (!turn.tools) turn.tools = [];
                const idx = turn.tools.findIndex((t) => t.toolCallId === event.toolCallId);
                if (idx >= 0) {
                    const existing = turn.tools[idx];
                    turn.tools[idx] = {
                        ...existing,
                        status: event.isError ? "error" : "done",
                        endedAt: ts,
                        durationMs: event.durationMs ?? Math.max(0, ts - existing.startedAt),
                        summary: event.summary,
                        ...(event.details !== undefined ? { details: event.details } : {}),
                        collapsed: !event.isError,
                    };
                } else {
                    turn.tools.push({
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        args: {},
                        status: event.isError ? "error" : "done",
                        startedAt: ts,
                        endedAt: ts,
                        durationMs: event.durationMs ?? 0,
                        summary: event.summary,
                        ...(event.details !== undefined ? { details: event.details } : {}),
                        collapsed: !event.isError,
                    });
                }
                break;
            }

            case "msk_diff":
                if (!turn.diffs) turn.diffs = [];
                turn.diffs.push(event.diff);
                break;

            case "plan_proposed":
                finalizeTurnThinking(turn, ts);
                turn.plan = event.plan;
                turn.planAwaitingApproval = event.awaitingApproval;
                break;

            case "plan_resolved": {
                for (let i = activeTranscript.length - 1; i >= 0; i--) {
                    const candidate = activeTranscript[i];
                    if (candidate.plan?.id === event.planId) {
                        candidate.plan = {
                            ...candidate.plan,
                            status: event.decision === "approved" ? "approved" : "revised",
                        };
                        candidate.planAwaitingApproval = false;
                        break;
                    }
                }
                break;
            }

            case "retry_start":
                if (!turn.retries) turn.retries = [];
                turn.retries.push({
                    attempt: event.attempt,
                    maxAttempts: event.maxAttempts,
                    delayMs: event.delayMs,
                    errorMessage: event.errorMessage,
                    ...(event.code ? { code: event.code } : {}),
                    startedAt: ts,
                    status: "retrying",
                });
                turn.retryNoticeCollapsed = false;
                break;

            case "retry_end":
                if (!turn.retries) turn.retries = [];
                for (let i = turn.retries.length - 1; i >= 0; i--) {
                    if (turn.retries[i].status === "retrying") {
                        turn.retries[i] = {
                            ...turn.retries[i],
                            status: event.success ? "recovered" : "failed",
                            endedAt: ts,
                        };
                    }
                }
                if (event.success) {
                    turn.retryNoticeCollapsed = true;
                    turn.error = undefined;
                }
                break;

            case "error":
                if (!event.recoverable) {
                    finalizeTurnThinking(turn, ts);
                    turn.error = event.message;
                }
                break;

            case "done":
                finalizeTurnThinking(turn, ts);
                turn.aborted = event.aborted;
                if (event.stats) {
                    turn.stats = { ...event.stats };
                }
                turn.endedAt = ts;
                if (turn.tools) {
                    for (const t of turn.tools) {
                        if (t.status === "running") {
                            t.status = "error";
                            t.endedAt = ts;
                            t.durationMs = Math.max(0, ts - t.startedAt);
                            t.collapsed = false;
                        }
                    }
                }
                break;

            default:
                break;
        }
    };

    const persistCurrentSessionSidecar = async (): Promise<void> => {
        if (!persistSessions) return;
        const sessionId = activeSessionId ?? sdkSession?.sessionManager.getSessionId() ?? null;
        if (!sessionId) return;
        const sessionFile = activeSessionFile ?? sdkSession?.sessionManager.getSessionFile() ?? `${sessionId}.jsonl`;
        if (activeTranscript.length === 0 && !existsSync(sessionFile)) return;

        const nowIso = new Date().toISOString();
        if (!sessionCreatedAt) sessionCreatedAt = nowIso;
        const firstUserTurn = activeTranscript.find((t) => t.role === "user");
        const title = sessionTitle || deriveSessionTitle(firstUserTurn?.text ?? "", "Conversation");
        sessionTitle = title;

        try {
            await saveWorkspaceSessionSidecar(workspaceDir, {
                schema: "moesekai-agent-session/1",
                summary: {
                    id: sessionId,
                    title,
                    createdAt: sessionCreatedAt,
                    updatedAt: nowIso,
                    authoringMode,
                    ...(config.model ? { model: config.model } : {}),
                    ...(config.provider ? { provider: config.provider } : {}),
                    messageCount: activeTranscript.length,
                    sessionFile: basename(sessionFile),
                },
                transcript: activeTranscript,
                activePlan: pendingPlan,
            });
        } catch {
            // Best-effort persistence; never crash an active turn on disk errors
        }
    };

    const emit = (event: StoryAgentEvent) => {
        recordEventInTranscript(event);
        for (const listener of listeners) {
            try {
                listener(event);
            } catch {
                // Keep session resilient if a subscriber throws
            }
        }
    };

    const setStatus = (next: StoryAgentStatus, message?: string) => {
        status = next;
        emit({
            type: "status",
            status: next,
            mode: config.mode,
            ...(message ? { message } : {}),
            timestamp: Date.now(),
        });
    };

    const resetRunAccumulators = () => {
        activeFinalText = "";
        activeStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0 };
        inFlightTools.clear();
        settledToolCallIds.clear();
    };

    const settleInFlightTools = (reason: string, isError: boolean) => {
        if (inFlightTools.size === 0) return;
        const now = Date.now();
        for (const entry of inFlightTools.values()) {
            if (settledToolCallIds.has(entry.toolCallId)) continue;
            settledToolCallIds.add(entry.toolCallId);
            emit({
                type: "tool_end",
                toolCallId: entry.toolCallId,
                toolName: entry.toolName,
                isError,
                summary: reason,
                durationMs: Math.max(0, now - entry.startedAt),
                timestamp: now,
            });
        }
        inFlightTools.clear();
    };

    const markActiveRetryRecovered = (timestamp: number) => {
        if (!activeRetry) return;
        const recovered = activeRetry;
        activeRetry = null;
        pendingAssistantError = null;
        emit({
            type: "retry_end",
            attempt: recovered.attempt,
            maxAttempts: recovered.maxAttempts,
            success: true,
            timestamp,
        });
    };

    const emitTerminalErrorOnce = (message: string, code: string | undefined, timestamp: number) => {
        if (emittedTerminalErrorThisRun) return;
        emittedTerminalErrorThisRun = true;
        pendingAssistantError = null;
        setStatus("error", message);
        emit({
            type: "error",
            message,
            ...(code ? { code } : {}),
            recoverable: false,
            timestamp,
        });
    };

    const handleRuntimeEvent = (ev: AgentSessionEvent | JsonAgentSessionEvent) => {
        const now = Date.now();
        switch (ev.type) {
            case "agent_start":
                isStreaming = true;
                if (!runHasStartedOnce) {
                    runHasStartedOnce = true;
                    resetRunAccumulators();
                }
                if (!activeRetry) {
                    setStatus("starting");
                }
                break;

            case "auto_retry_start": {
                sdkRetriedThisRun = true;
                pendingAssistantError = null;
                const code = extractTransientErrorCode(ev.errorMessage);
                activeRetry = {
                    source: "sdk",
                    attempt: ev.attempt,
                    maxAttempts: ev.maxAttempts,
                    lastError: ev.errorMessage,
                    code,
                };
                setStatus("retrying", ev.errorMessage);
                emit({
                    type: "retry_start",
                    attempt: ev.attempt,
                    maxAttempts: ev.maxAttempts,
                    delayMs: ev.delayMs,
                    errorMessage: ev.errorMessage,
                    ...(code ? { code } : {}),
                    timestamp: now,
                });
                break;
            }

            case "auto_retry_end": {
                const maxAttempts = activeRetry?.maxAttempts ?? retryPolicy.maxRetries;
                if (ev.success) {
                    if (activeRetry) {
                        activeRetry = null;
                        pendingAssistantError = null;
                        emit({
                            type: "retry_end",
                            attempt: ev.attempt,
                            maxAttempts,
                            success: true,
                            timestamp: now,
                        });
                    }
                } else {
                    const lastErr = ev.finalError || activeRetry?.lastError || pendingAssistantError?.message;
                    activeRetry = null;
                    emit({
                        type: "retry_end",
                        attempt: ev.attempt,
                        maxAttempts,
                        success: false,
                        ...(lastErr ? { finalError: lastErr } : {}),
                        timestamp: now,
                    });
                    if (!userAbortRequested && !isAbortError(ev.finalError)) {
                        const finalMsg = lastErr || "Request failed after automatic retries.";
                        const code = extractTransientErrorCode(finalMsg) ?? "retry_exhausted";
                        emitTerminalErrorOnce(finalMsg, code, now);
                    } else {
                        pendingAssistantError = null;
                    }
                }
                break;
            }

            case "message_update": {
                const sub = ev.assistantMessageEvent;
                if (sub.type === "thinking_start") {
                    markActiveRetryRecovered(now);
                    setStatus("thinking");
                } else if (sub.type === "thinking_delta") {
                    markActiveRetryRecovered(now);
                    emit({
                        type: "thinking_delta",
                        delta: sub.delta,
                        contentIndex: sub.contentIndex,
                        timestamp: now,
                    });
                } else if (sub.type === "text_start") {
                    markActiveRetryRecovered(now);
                    setStatus("streaming");
                } else if (sub.type === "text_delta") {
                    markActiveRetryRecovered(now);
                    activeFinalText += sub.delta;
                    emit({
                        type: "text_delta",
                        delta: sub.delta,
                        contentIndex: sub.contentIndex,
                        timestamp: now,
                    });
                } else if (sub.type === "error") {
                    const errMsg = sub.error?.errorMessage || `Provider stream ${sub.reason}`;
                    const isAborted = sub.reason === "aborted" || isAbortError(errMsg);
                    // Defer emitting terminal error until retry decision settles (avoid spamming red card on transient timeout)
                    pendingAssistantError = {
                        message: errMsg,
                        code: extractTransientErrorCode(errMsg) ?? sub.reason,
                        isAborted,
                        timestamp: now,
                    };
                }
                break;
            }

            case "tool_execution_start":
                markActiveRetryRecovered(now);
                activeStats.toolCalls += 1;
                inFlightTools.set(ev.toolCallId, {
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    startedAt: now,
                });
                setStatus("tool_running", ev.toolName);
                emit({
                    type: "tool_start",
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    args: (ev.args && typeof ev.args === "object" ? ev.args : {}) as Record<string, unknown>,
                    timestamp: now,
                });
                break;

            case "tool_execution_end": {
                const tracked = inFlightTools.get(ev.toolCallId);
                inFlightTools.delete(ev.toolCallId);
                if (settledToolCallIds.has(ev.toolCallId)) break;
                settledToolCallIds.add(ev.toolCallId);
                const details = (ev.result as { details?: unknown } | undefined)?.details;
                const durationMs = ev.durationMs ?? (tracked ? Math.max(0, now - tracked.startedAt) : undefined);
                emit({
                    type: "tool_end",
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    isError: Boolean(ev.isError),
                    summary: summarizeToolResult(ev.result),
                    ...(details !== undefined ? { details } : {}),
                    ...(durationMs !== undefined ? { durationMs } : {}),
                    timestamp: now,
                });
                break;
            }

            case "turn_end": {
                const msg = ev.message as {
                    role?: string;
                    usage?: { input?: number; output?: number; totalTokens?: number };
                    errorMessage?: string;
                    stopReason?: string;
                };
                if (msg?.role === "assistant" && msg.usage) {
                    activeStats.inputTokens += msg.usage.input ?? 0;
                    activeStats.outputTokens += msg.usage.output ?? 0;
                    activeStats.totalTokens += msg.usage.totalTokens ?? 0;
                }
                if (msg?.role === "assistant" && msg.stopReason === "error" && msg.errorMessage) {
                    pendingAssistantError = {
                        message: msg.errorMessage,
                        code: extractTransientErrorCode(msg.errorMessage) ?? "assistant_error",
                        isAborted: isAbortError(msg.errorMessage),
                        timestamp: now,
                    };
                } else if (msg?.role === "assistant" && msg.stopReason !== "error") {
                    pendingAssistantError = null;
                }
                break;
            }

            case "agent_end": {
                if (ev.willRetry) {
                    // Pi SDK is about to schedule an automatic retry; keep pending error suppressed
                    sdkRetriedThisRun = true;
                }
                break;
            }

            case "agent_settled": {
                lastSettledAborted = ev.aborted;
                if (!managedRunActive) {
                    settleInFlightTools(
                        ev.aborted ? "Cancelled before completion" : "Interrupted before completion",
                        true,
                    );
                    if (pendingAssistantError && !pendingAssistantError.isAborted && !ev.aborted) {
                        emitTerminalErrorOnce(
                            pendingAssistantError.message,
                            pendingAssistantError.code ?? "assistant_error",
                            now,
                        );
                    }
                    isStreaming = false;
                    const nextStatus: StoryAgentStatus = ev.aborted
                        ? "aborted"
                        : emittedTerminalErrorThisRun
                            ? "error"
                            : "idle";
                    setStatus(nextStatus);
                    emit({
                        type: "done",
                        aborted: ev.aborted,
                        finalText: activeFinalText,
                        stats: { ...activeStats },
                        timestamp: now,
                    });
                }
                break;
            }

            default:
                break;
        }
    };

    const disposeBackend = async () => {
        outerRetryAbortController?.abort();
        outerRetryAbortController = null;
        if (sdkUnsubscribe) {
            sdkUnsubscribe();
            sdkUnsubscribe = null;
        }
        if (sdkSession) {
            try {
                sdkSession.abortRetry();
                await sdkSession.abort();
            } catch {
                // Ignore abort error during cleanup
            }
            sdkSession.dispose();
            sdkSession = null;
        }
        if (rpcUnsubscribe) {
            rpcUnsubscribe();
            rpcUnsubscribe = null;
        }
        if (rpcClient) {
            try {
                await rpcClient.abortRetry().catch(() => undefined);
                await rpcClient.stop();
            } catch {
                // Ignore stop error during cleanup
            }
            rpcClient = null;
        }
        settleInFlightTools("Session disposed", true);
        isStreaming = false;
    };

    const ensureSdkSession = async (): Promise<AgentSession> => {
        if (sdkSession) return sdkSession;

        const { modelRuntime, model } = await resolveSdkModelRuntime(config, options.testProvider);
        const effectiveThinking = resolveEffectiveThinkingLevel(config.thinkingLevel, Boolean(model.reasoning));
        thinkingLevel = effectiveThinking;

        const settingsManager = SettingsManager.inMemory({
            cacheWarming: "off",
            retry: {
                enabled: retryPolicy.enabled,
                maxRetries: retryPolicy.maxRetries,
                baseDelayMs: retryPolicy.baseDelayMs,
                maxAgentDelayMs: retryPolicy.maxDelayMs,
            },
        });
        const skillDir = resolveDefaultSkillPath(workspaceDir, options.skillPath);

        let skillMd: string | undefined;
        if (skillDir) {
            try {
                skillMd = await readFile(join(skillDir, "SKILL.md"), "utf8");
            } catch {
                // Non-fatal; DefaultResourceLoader also loads skillDir
            }
        }

        const systemPrompt = buildStoryAgentSystemPrompt(authoringMode, planFirst, skillMd);
        const agentDir = join(tmpdir(), "moesekai-story-studio-agent");
        const resourceLoader = new DefaultResourceLoader({
            cwd: workspaceDir,
            agentDir,
            settingsManager,
            ...(skillDir ? { additionalSkillPaths: [skillDir] } : {}),
            noExtensions: true,
            noSkills: !skillDir,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt,
        });
        await resourceLoader.reload();

        let sessionManager: SessionManager;
        if (persistSessions) {
            const sessionsDir = resolveSessionsDir(workspaceDir);
            if (pendingResumeSessionFile && existsSync(pendingResumeSessionFile)) {
                sessionManager = SessionManager.open(pendingResumeSessionFile, sessionsDir, workspaceDir);
                pendingResumeSessionFile = null;
            } else {
                sessionManager = SessionManager.create(
                    workspaceDir,
                    sessionsDir,
                    activeSessionId ? { id: activeSessionId } : undefined,
                );
            }
            activeSessionId = sessionManager.getSessionId();
            activeSessionFile = sessionManager.getSessionFile() ?? activeSessionFile;
        } else {
            sessionManager = SessionManager.inMemory(
                workspaceDir,
                activeSessionId ? { id: activeSessionId } : undefined,
            );
            activeSessionId = sessionManager.getSessionId();
        }

        const customTools = createStoryMakerTools({
            getWorkspace: () => workspaceFiles,
            getStoryFile: () => storyFile,
            getAssetLine: () => assetLine,
            getSelectedNodeId: () => selectedNodeId,
            getAuthoringMode: () => authoringMode,
            isPlanApprovalRequired: () => planFirst && !planApprovedForTask,
            isMutationBlockedByPlan: () =>
                Boolean(planFirst && !planApprovedForTask),
            fetchImpl: options.fetchImpl,
            officialStoryCache,
            decodeBrotli: decodeBrotliWithZlib,
            onSnapshotCreated: (snapshot) => {
                emit({ type: "snapshot_created", snapshot, timestamp: Date.now() });
            },
            onMskDiff: (diff, file) => {
                emit({ type: "msk_diff", diff, storyFile: file, timestamp: Date.now() });
            },
            onEditorAction: (action) => {
                emit({ type: "editor_action", action, timestamp: Date.now() });
            },
            onWorkflowStage: (stageInfo) => {
                activeStage = stageInfo;
                emit({
                    type: "workflow_stage",
                    ...stageInfo,
                    timestamp: Date.now(),
                });
            },
            onPlanProposed: (plan, awaitingApproval) => {
                pendingPlan = awaitingApproval ? plan : null;
                if (awaitingApproval) {
                    haltTurnForPlanApproval = true;
                } else {
                    planApprovedForTask = true;
                }
                emit({
                    type: "plan_proposed",
                    plan,
                    awaitingApproval,
                    timestamp: Date.now(),
                });
            },
        });

        const { session } = await createAgentSession({
            cwd: workspaceDir,
            agentDir,
            modelRuntime,
            model,
            thinkingLevel: effectiveThinking,
            noTools: "builtin",
            customTools,
            resourceLoader,
            sessionManager,
            settingsManager,
        });

        const previousFinishTurn = session.agent.finishTurn;
        session.agent.finishTurn = async (turn, signal) => {
            const decision = await previousFinishTurn?.(turn, signal);
            if (haltTurnForPlanApproval) {
                haltTurnForPlanApproval = false;
                return { action: "end" as const };
            }
            return decision ? decision : undefined;
        };

        sdkUnsubscribe = session.subscribe(handleRuntimeEvent);
        sdkSession = session;
        return session;
    };

    const ensureRpcClient = async (): Promise<RpcClient> => {
        if (rpcClient) return rpcClient;

        const env: Record<string, string> = { ...(options.env ?? {}) };
        if (config.apiKey && config.provider) {
            const envKey = providerEnvVarName(config.provider);
            if (envKey) env[envKey] = config.apiKey;
        }
        const args: string[] = [...(config.rpcArgs ?? [])];
        const skillDir = resolveDefaultSkillPath(workspaceDir, options.skillPath);
        if (skillDir && !args.includes("--skill")) {
            args.push("--skill", skillDir);
        }

        const client = new RpcClient({
            cwd: workspaceDir,
            ...(config.rpcCliPath ? { cliPath: config.rpcCliPath } : {}),
            ...(config.provider ? { provider: config.provider } : {}),
            ...(config.model ? { model: config.model } : {}),
            ...(Object.keys(env).length > 0 ? { env } : {}),
            ...(args.length > 0 ? { args } : {}),
        });
        rpcUnsubscribe = client.onEvent(handleRuntimeEvent);
        await client.start();
        try {
            await client.setAutoRetry(retryPolicy.enabled);
        } catch {
            // Non-fatal if RPC server does not support toggling auto-retry
        }
        if (config.thinkingLevel) {
            try {
                await client.setThinkingLevel(config.thinkingLevel);
            } catch {
                // Non-fatal if RPC target model doesn't support requested level
            }
        }
        rpcClient = client;
        return client;
    };

    const readStoryRawSafe = async (): Promise<string> => {
        try {
            return normalizeLineEndings((await workspaceFiles.readText(storyFile)) ?? "");
        } catch {
            return "";
        }
    };

    const executePromptRaw = async (
        formattedPrompt: string,
        displayUserText?: string,
    ): Promise<void> => {
        const startTs = Date.now();
        if (displayUserText !== undefined) {
            if (!sessionTitle && displayUserText.trim()) {
                sessionTitle = deriveSessionTitle(displayUserText);
            }
            activeTranscript.push({
                id: nextTurnId("u"),
                role: "user",
                text: displayUserText,
                thinkingCollapsed: true,
                retryNoticeCollapsed: true,
                timestamp: startTs,
                startedAt: startTs,
                endedAt: startTs,
            });
        }
        currentAssistantTurn = {
            id: nextTurnId("a"),
            role: "assistant",
            text: "",
            thinking: "",
            thinkingCollapsed: false,
            tools: [],
            diffs: [],
            retries: [],
            retryNoticeCollapsed: true,
            timestamp: startTs + 1,
            startedAt: startTs + 1,
        };
        activeTranscript.push(currentAssistantTurn);

        managedRunActive = true;
        runHasStartedOnce = false;
        userAbortRequested = false;
        sdkRetriedThisRun = false;
        emittedTerminalErrorThisRun = false;
        lastSettledAborted = false;
        activeRetry = null;
        pendingAssistantError = null;
        outerRetryAbortController = new AbortController();
        resetRunAccumulators();

        let outerAttempt = 0;
        let finalAborted = false;
        let rpcBeforeRaw = "";
        let useSdkContinue = false;

        try {
            if (config.mode === "rpc") {
                rpcBeforeRaw = await readStoryRawSafe();
            }

            for (;;) {
                pendingAssistantError = null;
                lastSettledAborted = false;

                try {
                    if (config.mode === "rpc") {
                        const client = await ensureRpcClient();
                        const disposition = await client.prompt(formattedPrompt);
                        if (disposition !== "handled") {
                            await client.waitForIdle();
                        }
                    } else {
                        const session = await ensureSdkSession();
                        if (activeTranscript.length <= 2) {
                            await persistCurrentSessionSidecar();
                        }
                        if (useSdkContinue && canContinueSdkSession(session)) {
                            await session.agent.continue();
                            await session.agent.waitForIdle();
                        } else {
                            await session.prompt(formattedPrompt);
                            await session.waitForIdle();
                        }
                        activeSessionId = session.sessionManager.getSessionId();
                        activeSessionFile = session.sessionManager.getSessionFile() ?? activeSessionFile;
                    }
                } catch (err) {
                    const errMessage = formatErrorMessageWithCause(err);
                    const errCode = extractTransientErrorCode(err);

                    if (userAbortRequested || isAbortError(err)) {
                        if (activeRetry) {
                            const r = activeRetry;
                            activeRetry = null;
                            emit({
                                type: "retry_end",
                                attempt: r.attempt,
                                maxAttempts: r.maxAttempts,
                                success: false,
                                finalError: "Retry cancelled",
                                timestamp: Date.now(),
                            });
                        }
                        finalAborted = true;
                        break;
                    }

                    const canOuterRetry =
                        retryPolicy.enabled
                        && !sdkRetriedThisRun
                        && outerAttempt < retryPolicy.maxRetries
                        && isTransientNetworkError(err, errCode);

                    if (canOuterRetry) {
                        outerAttempt += 1;
                        const delayMs = computeRetryDelayMs(retryPolicy, outerAttempt);
                        activeRetry = {
                            source: "outer",
                            attempt: outerAttempt,
                            maxAttempts: retryPolicy.maxRetries,
                            lastError: errMessage,
                            code: errCode,
                        };
                        setStatus("retrying", errMessage);
                        emit({
                            type: "retry_start",
                            attempt: outerAttempt,
                            maxAttempts: retryPolicy.maxRetries,
                            delayMs,
                            errorMessage: errMessage,
                            ...(errCode ? { code: errCode } : {}),
                            timestamp: Date.now(),
                        });

                        try {
                            await abortableSleep(delayMs, outerRetryAbortController.signal);
                        } catch {
                            activeRetry = null;
                            emit({
                                type: "retry_end",
                                attempt: outerAttempt,
                                maxAttempts: retryPolicy.maxRetries,
                                success: false,
                                finalError: "Retry cancelled",
                                timestamp: Date.now(),
                            });
                            finalAborted = true;
                            break;
                        }

                        if (userAbortRequested) {
                            activeRetry = null;
                            emit({
                                type: "retry_end",
                                attempt: outerAttempt,
                                maxAttempts: retryPolicy.maxRetries,
                                success: false,
                                finalError: "Retry cancelled",
                                timestamp: Date.now(),
                            });
                            finalAborted = true;
                            break;
                        }

                        if (sdkSession) {
                            omitTrailingFailedAssistantMessage(sdkSession);
                            useSdkContinue = canContinueSdkSession(sdkSession);
                        }
                        continue;
                    }

                    // Non-retryable exception or retries exhausted
                    if (activeRetry) {
                        const r = activeRetry;
                        activeRetry = null;
                        emit({
                            type: "retry_end",
                            attempt: r.attempt,
                            maxAttempts: r.maxAttempts,
                            success: false,
                            finalError: errMessage,
                            timestamp: Date.now(),
                        });
                    }
                    settleInFlightTools("Interrupted by session error", true);
                    isStreaming = false;
                    emitTerminalErrorOnce(errMessage, errCode ?? "session_error", Date.now());
                    emit({
                        type: "done",
                        aborted: false,
                        finalText: activeFinalText,
                        stats: { ...activeStats },
                        timestamp: Date.now(),
                    });
                    await persistCurrentSessionSidecar();
                    throw err;
                }

                // Normal completion of a single attempt — check if an unretried transient assistant error occurred
                const pendingErr = pendingAssistantError as PendingAssistantError | null;
                if (userAbortRequested || lastSettledAborted || pendingErr?.isAborted) {
                    if (activeRetry) {
                        const r = activeRetry;
                        activeRetry = null;
                        emit({
                            type: "retry_end",
                            attempt: r.attempt,
                            maxAttempts: r.maxAttempts,
                            success: false,
                            finalError: "Retry cancelled",
                            timestamp: Date.now(),
                        });
                    }
                    finalAborted = true;
                    break;
                }

                if (pendingErr) {
                    const canOuterRetry =
                        retryPolicy.enabled
                        && !sdkRetriedThisRun
                        && outerAttempt < retryPolicy.maxRetries
                        && isTransientNetworkError(pendingErr.message, pendingErr.code);

                    if (canOuterRetry) {
                        outerAttempt += 1;
                        const delayMs = computeRetryDelayMs(retryPolicy, outerAttempt);
                        const errCode = pendingErr.code ?? extractTransientErrorCode(pendingErr.message);
                        activeRetry = {
                            source: "outer",
                            attempt: outerAttempt,
                            maxAttempts: retryPolicy.maxRetries,
                            lastError: pendingErr.message,
                            code: errCode,
                        };
                        pendingAssistantError = null;
                        setStatus("retrying", activeRetry.lastError);
                        emit({
                            type: "retry_start",
                            attempt: outerAttempt,
                            maxAttempts: retryPolicy.maxRetries,
                            delayMs,
                            errorMessage: activeRetry.lastError,
                            ...(errCode ? { code: errCode } : {}),
                            timestamp: Date.now(),
                        });

                        try {
                            await abortableSleep(delayMs, outerRetryAbortController.signal);
                        } catch {
                            activeRetry = null;
                            emit({
                                type: "retry_end",
                                attempt: outerAttempt,
                                maxAttempts: retryPolicy.maxRetries,
                                success: false,
                                finalError: "Retry cancelled",
                                timestamp: Date.now(),
                            });
                            finalAborted = true;
                            break;
                        }

                        if (userAbortRequested) {
                            activeRetry = null;
                            emit({
                                type: "retry_end",
                                attempt: outerAttempt,
                                maxAttempts: retryPolicy.maxRetries,
                                success: false,
                                finalError: "Retry cancelled",
                                timestamp: Date.now(),
                            });
                            finalAborted = true;
                            break;
                        }

                        if (sdkSession) {
                            omitTrailingFailedAssistantMessage(sdkSession);
                            useSdkContinue = canContinueSdkSession(sdkSession);
                        }
                        continue;
                    }

                    // Exhausted outer retries or non-retryable assistant error
                    if (activeRetry) {
                        const r = activeRetry;
                        activeRetry = null;
                        emit({
                            type: "retry_end",
                            attempt: r.attempt,
                            maxAttempts: r.maxAttempts,
                            success: false,
                            finalError: pendingErr.message,
                            timestamp: Date.now(),
                        });
                    }
                    emitTerminalErrorOnce(
                        pendingErr.message,
                        pendingErr.code ?? "assistant_error",
                        Date.now(),
                    );
                    break;
                }

                // Success! Ensure any active retry indicator is marked recovered
                if (activeRetry) {
                    markActiveRetryRecovered(Date.now());
                }
                break;
            }

            if (config.mode === "rpc") {
                const afterRaw = await readStoryRawSafe();
                if (afterRaw !== rpcBeforeRaw) {
                    const diff = computeMskDiff(rpcBeforeRaw, afterRaw, storyFile, null);
                    emit({ type: "msk_diff", diff, storyFile, timestamp: Date.now() });
                }
            }

            settleInFlightTools(
                finalAborted ? "Cancelled before completion" : "Interrupted before completion",
                true,
            );
            isStreaming = false;
            const finalStatus: StoryAgentStatus = finalAborted
                ? "aborted"
                : emittedTerminalErrorThisRun
                    ? "error"
                    : "idle";
            setStatus(finalStatus);
            emit({
                type: "done",
                aborted: finalAborted,
                finalText: activeFinalText,
                stats: { ...activeStats },
                timestamp: Date.now(),
            });
            await persistCurrentSessionSidecar();
        } finally {
            managedRunActive = false;
            outerRetryAbortController = null;
            currentAssistantTurn = null;
        }
    };

    const resetSessionMemory = (nextSessionId: string | null) => {
        activeSessionId = nextSessionId;
        activeSessionFile = null;
        pendingResumeSessionFile = null;
        sessionCreatedAt = null;
        sessionTitle = null;
        activeTranscript = [];
        currentAssistantTurn = null;
        pendingPlan = null;
        planApprovedForTask = false;
        haltTurnForPlanApproval = false;
        activeStage = null;
        activeRetry = null;
        pendingAssistantError = null;
        resetRunAccumulators();
    };

    const controller: StoryAgentSessionController = {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        async prompt(text, context) {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            selectedNodeId = context?.selectedNodeId ?? null;

            if (context?.authoringMode && context.authoringMode !== authoringMode) {
                authoringMode = context.authoringMode;
                config.authoringMode = authoringMode;
            }
            if (context?.planFirst !== undefined) {
                planFirst = context.planFirst;
                config.planFirst = planFirst;
            }
            if (context?.thinkingLevel && context.thinkingLevel !== thinkingLevel) {
                await controller.setThinkingLevel(context.thinkingLevel);
            }

            if (planFirst && pendingPlan?.status === "pending_approval") {
                const prevId = pendingPlan.id;
                pendingPlan = { ...pendingPlan, status: "revised" };
                planApprovedForTask = false;
                emit({
                    type: "plan_resolved",
                    planId: prevId,
                    decision: "revise",
                    feedback: text,
                    timestamp: Date.now(),
                });
            } else {
                planApprovedForTask = false;
                pendingPlan = null;
            }

            const formatted = formatUserPromptWithContext(
                text,
                authoringMode,
                planFirst,
                planApprovedForTask,
                context,
            );
            await executePromptRaw(formatted, text);
        },

        async runPreset(preset: StoryAgentPresetId, presetOpts?: StoryAgentPresetOptions) {
            const impliedMode: StoryAuthoringMode =
                presetOpts?.context?.authoringMode
                ?? (preset === "author_story" ? "create" : "edit");
            const impliedPlanFirst =
                presetOpts?.context?.planFirst
                ?? (preset === "author_story" ? planFirst : false);
            const promptText = buildPresetPrompt(preset, presetOpts);
            await controller.prompt(promptText, {
                ...(presetOpts?.context ?? {}),
                authoringMode: impliedMode,
                planFirst: impliedPlanFirst,
            });
        },

        async setThinkingLevel(level: StoryThinkingLevel) {
            thinkingLevel = level;
            config = { ...config, thinkingLevel: level };
            if (sdkSession) {
                sdkSession.setThinkingLevel(level);
            } else if (rpcClient) {
                await rpcClient.setThinkingLevel(level);
            }
        },

        async setAuthoringMode(mode: StoryAuthoringMode) {
            authoringMode = mode;
            config = { ...config, authoringMode: mode };
            if (pendingPlan && pendingPlan.mode !== mode) {
                pendingPlan = null;
                planApprovedForTask = false;
            }
        },

        async setPlanFirst(nextPlanFirst: boolean) {
            planFirst = nextPlanFirst;
            config = { ...config, planFirst: nextPlanFirst };
            if (!nextPlanFirst) {
                pendingPlan = null;
            }
        },

        async approvePlan(planId: string, feedback?: string) {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            if (!pendingPlan) {
                throw new Error(`No pending plan awaiting approval (requested planId="${planId}").`);
            }
            if (planId && pendingPlan.id !== planId) {
                throw new Error(`Pending plan "${pendingPlan.id}" does not match requested "${planId}".`);
            }
            const approved: StoryWorkflowPlan = { ...pendingPlan, status: "approved" };
            pendingPlan = null;
            planApprovedForTask = true;
            emit({
                type: "plan_resolved",
                planId: approved.id,
                decision: "approved",
                ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
                timestamp: Date.now(),
            });

            const continuationPrompt = buildPlanApprovedContinuationPrompt(approved, feedback);
            await executePromptRaw(
                continuationPrompt,
                feedback?.trim() ? feedback.trim() : undefined,
            );
        },

        async revisePlan(planId: string, feedback: string) {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            if (!pendingPlan) {
                throw new Error(`No pending plan to revise (requested planId="${planId}").`);
            }
            if (planId && pendingPlan.id !== planId) {
                throw new Error(`Pending plan "${pendingPlan.id}" does not match requested "${planId}".`);
            }
            const revised = pendingPlan;
            pendingPlan = { ...revised, status: "revised" };
            planApprovedForTask = false;
            emit({
                type: "plan_resolved",
                planId: revised.id,
                decision: "revise",
                feedback,
                timestamp: Date.now(),
            });

            const revisionPrompt = [
                `The user requested revisions to your plan (planId=${revised.id}, title="${revised.title}"):`,
                feedback,
                "",
                "Revise the plan accordingly and call `story_submit_plan` again. Do NOT modify `.msk` until the revised plan is approved.",
            ].join("\n");
            await executePromptRaw(revisionPrompt, feedback);
        },

        async fetchModels(overrideConfig?: Partial<StoryAgentProviderConfig>): Promise<FetchProviderModelsResult> {
            return fetchLiveProviderModels(
                { ...config, ...(overrideConfig ?? {}) },
                { fetchImpl: options.fetchImpl },
            );
        },

        async abort() {
            userAbortRequested = true;
            outerRetryAbortController?.abort();
            if (sdkSession) {
                sdkSession.abortRetry();
                await sdkSession.abort();
            } else if (rpcClient) {
                await rpcClient.abortRetry().catch(() => undefined);
                await rpcClient.abort();
            }
            settleInFlightTools("Cancelled by user", true);
            if (!managedRunActive) {
                isStreaming = false;
                setStatus("aborted");
            }
        },

        async reset() {
            await controller.newSession();
        },

        async newSession(): Promise<{ sessionId: string }> {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            await persistCurrentSessionSidecar();
            const nextId = randomUUID();
            if (config.mode === "rpc" && rpcClient) {
                await rpcClient.newSession();
            } else {
                await disposeBackend();
            }
            resetSessionMemory(nextId);
            setStatus("idle");
            return { sessionId: nextId };
        },

        async listSessions(): Promise<StoryAgentSessionSummary[]> {
            return listWorkspaceSessions(workspaceDir);
        },

        async resumeSession(sessionId: string): Promise<StoryAgentResumedSession> {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            const safeId = assertSafeSessionId(sessionId);
            await persistCurrentSessionSidecar();
            await disposeBackend();

            const loaded = await loadWorkspaceSession(workspaceDir, safeId);
            activeSessionId = loaded.summary.id;
            activeSessionFile = loaded.absSessionFile;
            pendingResumeSessionFile = loaded.absSessionFile;
            sessionCreatedAt = loaded.summary.createdAt;
            sessionTitle = loaded.summary.title;
            activeTranscript = structuredClone(loaded.transcript);
            pendingPlan = loaded.activePlan ? structuredClone(loaded.activePlan) : null;
            planApprovedForTask = false;
            haltTurnForPlanApproval = false;
            activeStage = null;
            activeRetry = null;
            pendingAssistantError = null;
            resetRunAccumulators();

            if (config.mode === "sdk" && existsSync(loaded.absSessionFile)) {
                try {
                    await ensureSdkSession();
                } catch {
                    // Keep pendingResumeSessionFile armed so next prompt opens it once provider config is valid
                }
            } else if (config.mode === "rpc" && rpcClient && existsSync(loaded.absSessionFile)) {
                try {
                    await rpcClient.switchSession(loaded.absSessionFile);
                } catch {
                    // Non-fatal in RPC mode
                }
            }

            setStatus("idle");
            return {
                summary: loaded.summary,
                transcript: structuredClone(activeTranscript),
                activePlan: pendingPlan ? structuredClone(pendingPlan) : null,
            };
        },

        async deleteSession(sessionId: string): Promise<boolean> {
            if (disposed) throw new Error("StoryAgentSessionController has been disposed.");
            const safeId = assertSafeSessionId(sessionId);
            if (activeSessionId === safeId) {
                await disposeBackend();
                resetSessionMemory(null);
                setStatus("idle");
            }
            return deleteWorkspaceSession(workspaceDir, safeId);
        },

        async saveSessionTranscript(
            sessionId: string,
            transcript: StoryAgentPersistedTurn[],
            activePlanOverride?: StoryWorkflowPlan | null,
        ): Promise<void> {
            if (!persistSessions) return;
            const safeId = assertSafeSessionId(sessionId);
            const nowIso = new Date().toISOString();
            const isActive = activeSessionId === safeId;
            if (isActive) {
                activeTranscript = structuredClone(transcript);
                if (activePlanOverride !== undefined) {
                    pendingPlan = activePlanOverride ? structuredClone(activePlanOverride) : null;
                }
            }
            const firstUser = transcript.find((t) => t.role === "user");
            const existingFile = isActive && activeSessionFile
                ? basename(activeSessionFile)
                : `${safeId}.jsonl`;
            await saveWorkspaceSessionSidecar(workspaceDir, {
                schema: "moesekai-agent-session/1",
                summary: {
                    id: safeId,
                    title: deriveSessionTitle(firstUser?.text ?? "", "Conversation"),
                    createdAt: (isActive && sessionCreatedAt) ? sessionCreatedAt : nowIso,
                    updatedAt: nowIso,
                    authoringMode,
                    ...(config.model ? { model: config.model } : {}),
                    ...(config.provider ? { provider: config.provider } : {}),
                    messageCount: transcript.length,
                    sessionFile: existingFile,
                },
                transcript: structuredClone(transcript),
                activePlan: activePlanOverride !== undefined ? activePlanOverride : (isActive ? pendingPlan : null),
            });
        },

        async updateConfig(patch) {
            const onlyRuntimeFlags = Object.keys(patch).every(
                (k) => k === "thinkingLevel" || k === "authoringMode" || k === "planFirst",
            );
            config = { ...config, ...patch };
            if (patch.authoringMode !== undefined) authoringMode = patch.authoringMode;
            if (patch.planFirst !== undefined) planFirst = patch.planFirst;
            if (patch.thinkingLevel !== undefined) {
                thinkingLevel = patch.thinkingLevel;
                if (onlyRuntimeFlags) {
                    if (sdkSession) sdkSession.setThinkingLevel(patch.thinkingLevel);
                    else if (rpcClient) await rpcClient.setThinkingLevel(patch.thinkingLevel);
                    return;
                }
            }
            if (onlyRuntimeFlags) {
                return;
            }
            // Preserve persisted session continuity when switching model/provider mid-conversation
            if (persistSessions && activeSessionFile && existsSync(activeSessionFile)) {
                pendingResumeSessionFile = activeSessionFile;
            }
            await disposeBackend();
            setStatus("idle");
        },

        async updateWorkspace(nextWorkspaceDir, nextStoryFile) {
            await persistCurrentSessionSidecar();
            workspaceDir = resolve(nextWorkspaceDir);
            workspaceFiles = createNodeWorkspaceFiles(workspaceDir);
            if (nextStoryFile !== undefined) {
                storyFile = nextStoryFile || DEFAULT_STORY_FILE;
            }
            await disposeBackend();
            resetSessionMemory(null);
            setStatus("idle");
        },

        async listSnapshots(): Promise<StorySnapshotMeta[]> {
            return listStorySnapshots(workspaceFiles);
        },

        async rollbackToSnapshot(snapshotId: string): Promise<StoryRollbackResult> {
            const result = await rollbackStorySnapshot(workspaceFiles, storyFile, snapshotId);
            emit({ type: "msk_diff", diff: result.diff, storyFile, timestamp: Date.now() });
            return result;
        },

        getState(): StoryAgentControllerState {
            return {
                status,
                mode: config.mode,
                workspaceDir,
                storyFile,
                activeSessionId,
                provider: config.provider,
                model: config.model,
                thinkingLevel,
                authoringMode,
                planFirst,
                pendingPlan,
                activeStage,
                isStreaming,
            };
        },

        async dispose() {
            await persistCurrentSessionSidecar();
            disposed = true;
            pendingPlan = null;
            activeStage = null;
            await disposeBackend();
            listeners.clear();
        },
    };

    return controller;
}

// ==================== Electron utilityProcess Worker Bridge ====================

/**
 * Convenience message dispatcher for Electron's `utilityProcess` (`agent-worker.ts`).
 * Accepts `StoryAgentWorkerRequest` messages and streams `StoryAgentWorkerResponse` back via `postResponse`.
 */
export function createStoryAgentWorkerHandler(
    postResponse: (msg: StoryAgentWorkerResponse) => void,
    runtimeOverrides?: Pick<StoryAgentSessionOptions, "fetchImpl" | "testProvider">,
): {
    handleRequest: (req: StoryAgentWorkerRequest) => Promise<void>;
    dispose: () => Promise<void>;
} {
    let controller: StoryAgentSessionController | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = async () => {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        if (controller) {
            await controller.dispose();
            controller = null;
        }
    };

    const requireController = (): StoryAgentSessionController => {
        if (!controller) {
            throw new Error("Agent session not initialized. Send { type: 'init', options } first.");
        }
        return controller;
    };

    const handleRequest = async (req: StoryAgentWorkerRequest): Promise<void> => {
        try {
            switch (req.type) {
                case "init": {
                    await cleanup();
                    controller = createStoryAgentSession({
                        ...req.options,
                        ...(runtimeOverrides ?? {}),
                    });
                    unsubscribe = controller.subscribe((event) => {
                        postResponse({ type: "event", event });
                    });
                    postResponse({ type: "reply", id: req.id, ok: true, data: controller.getState() });
                    return;
                }
                case "prompt": {
                    await requireController().prompt(req.text, req.context);
                    postResponse({ type: "reply", id: req.id, ok: true });
                    return;
                }
                case "run_preset": {
                    await requireController().runPreset(req.preset, req.options);
                    postResponse({ type: "reply", id: req.id, ok: true });
                    return;
                }
                case "abort": {
                    await requireController().abort();
                    postResponse({ type: "reply", id: req.id, ok: true });
                    return;
                }
                case "reset": {
                    await requireController().reset();
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "update_config": {
                    await requireController().updateConfig(req.config);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "set_thinking_level": {
                    await requireController().setThinkingLevel(req.thinkingLevel);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "set_authoring_mode": {
                    await requireController().setAuthoringMode(req.authoringMode);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "set_plan_first": {
                    await requireController().setPlanFirst(req.planFirst);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "approve_plan": {
                    await requireController().approvePlan(req.planId, req.feedback);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "revise_plan": {
                    await requireController().revisePlan(req.planId, req.feedback);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "fetch_models": {
                    const result = controller
                        ? await controller.fetchModels(req.config)
                        : await fetchLiveProviderModels(req.config ?? {}, {
                            fetchImpl: runtimeOverrides?.fetchImpl,
                        });
                    postResponse({ type: "reply", id: req.id, ok: true, data: result });
                    return;
                }
                case "update_workspace": {
                    await requireController().updateWorkspace(req.workspaceDir, req.storyFile);
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "list_snapshots": {
                    const list = await requireController().listSnapshots();
                    postResponse({ type: "reply", id: req.id, ok: true, data: list });
                    return;
                }
                case "rollback_snapshot": {
                    const res = await requireController().rollbackToSnapshot(req.snapshotId);
                    postResponse({ type: "reply", id: req.id, ok: true, data: res });
                    return;
                }
                case "list_sessions": {
                    const sessions = await requireController().listSessions();
                    postResponse({ type: "reply", id: req.id, ok: true, data: sessions });
                    return;
                }
                case "resume_session": {
                    const resumed = await requireController().resumeSession(req.sessionId);
                    postResponse({ type: "reply", id: req.id, ok: true, data: resumed });
                    return;
                }
                case "new_session": {
                    const created = await requireController().newSession();
                    postResponse({ type: "reply", id: req.id, ok: true, data: created });
                    return;
                }
                case "delete_session": {
                    const deleted = await requireController().deleteSession(req.sessionId);
                    postResponse({ type: "reply", id: req.id, ok: true, data: deleted });
                    return;
                }
                case "save_session_transcript": {
                    await requireController().saveSessionTranscript(req.sessionId, req.transcript, req.activePlan);
                    postResponse({ type: "reply", id: req.id, ok: true });
                    return;
                }
                case "get_state": {
                    postResponse({ type: "reply", id: req.id, ok: true, data: requireController().getState() });
                    return;
                }
                case "list_providers": {
                    const providers = await listKnownProviders();
                    postResponse({ type: "reply", id: req.id, ok: true, data: providers });
                    return;
                }
                case "dispose": {
                    await cleanup();
                    postResponse({ type: "reply", id: req.id, ok: true });
                    return;
                }
            }
        } catch (err) {
            postResponse({
                type: "reply",
                id: req.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    };

    return { handleRequest, dispose: cleanup };
}
