/**
 * The story agent in a browser: the same Story Maker tools and `StoryAgentEvent` stream as the
 * desktop session, run in-page by `pi-agent-core` against an in-memory workspace. The model is
 * called straight from the page with the user's own API key.
 */
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, createModels, getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
    COMPACTION_SYSTEM_PROMPT,
    DEFAULT_COMPACTION_SETTINGS,
    compactTranscript,
    estimateTranscriptTokens,
    findCompactionCut,
    summaryRequest,
    type CompactionSettings,
} from "./compaction";
import type { StoryWorkspaceFiles } from "./files";
import type { BrotliDecoder, OfficialStoryCache } from "./official-story";
import { buildStoryAgentSystemPrompt, formatUserPromptWithContext, summarizeToolResult } from "./prompt";
import { STORY_SCRIPT_SKILL } from "./skill";
import { createStoryMakerTools } from "./tools";
import type {
    StoryAgentEvent,
    StoryAgentEventListener,
    StoryAgentPromptContext,
    StoryAgentRunStats,
    StoryAgentStatus,
    StoryAuthoringMode,
    StoryRollbackResult,
    StorySnapshotMeta,
} from "./types";
import { DEFAULT_STORY_FILE, listStorySnapshots, rollbackStorySnapshot } from "./workspace";

/**
 * Providers a page can call directly (their APIs answer cross-origin requests), with the models
 * offered from each.
 */
const BROWSER_PROVIDERS = {
    deepseek: { create: deepseekProvider, models: ["deepseek-flash"] },
} as const;

export type BrowserAgentProviderId = keyof typeof BROWSER_PROVIDERS;

export const BROWSER_AGENT_PROVIDER_IDS = Object.keys(BROWSER_PROVIDERS) as BrowserAgentProviderId[];

/** How hard a model thinks when nobody chose, before fitting it to what the model accepts. */
const DEFAULT_THINKING_LEVEL: ModelThinkingLevel = "medium";

export interface BrowserAgentModelInfo {
    id: string;
    name: string;
    reasoning: boolean;
    /** The thinking levels the model accepts, weakest first. */
    thinkingLevels: ModelThinkingLevel[];
    /** The level used when none is chosen. */
    defaultThinkingLevel: ModelThinkingLevel;
}

function providerModels(provider: BrowserAgentProviderId) {
    const models = createModels();
    models.setProvider(BROWSER_PROVIDERS[provider].create());
    return models;
}

const isOffered = (provider: BrowserAgentProviderId, modelId: string) =>
    (BROWSER_PROVIDERS[provider].models as readonly string[]).includes(modelId);

/** The chat models offered from `provider`, catalogue order. */
export function listBrowserAgentModels(provider: BrowserAgentProviderId): BrowserAgentModelInfo[] {
    return providerModels(provider)
        .getModels(provider)
        .filter((m) => isOffered(provider, m.id))
        .map((m) => ({
            id: m.id,
            name: m.name,
            reasoning: m.reasoning,
            thinkingLevels: getSupportedThinkingLevels(m),
            defaultThinkingLevel: clampThinkingLevel(m, DEFAULT_THINKING_LEVEL),
        }));
}

export interface BrowserStoryAgentOptions {
    provider: BrowserAgentProviderId;
    model: string;
    apiKey: string;
    /** The workspace the tools read and write; `storyFile` holds the `.msk` script. */
    files: StoryWorkspaceFiles;
    storyFile?: string;
    authoringMode?: StoryAuthoringMode;
    /** Fitted to the nearest level the model accepts. */
    thinkingLevel?: ModelThinkingLevel;
    getSelectedNodeId?: () => string | null | undefined;
    assetLine?: "main" | "backup";
    fetchImpl?: typeof fetch;
    officialStoryCache?: OfficialStoryCache;
    decodeBrotli?: BrotliDecoder;
    /** A conversation to continue, as returned by `transcript()`. */
    transcript?: AgentMessage[];
    compaction?: CompactionSettings;
    onEvent: StoryAgentEventListener;
}

export interface BrowserStoryAgent {
    /** Runs one user request to the end, compacting first when the conversation is long. */
    prompt(text: string, context?: StoryAgentPromptContext): Promise<void>;
    /** Replaces every turn before the latest request with a summary; false when there is only one. */
    compact(): Promise<boolean>;
    abort(): void;
    /** The conversation so far, to store and later continue. */
    transcript(): AgentMessage[];
    /** Estimated size of the conversation the next request sends. */
    contextTokens(): number;
    setAuthoringMode(mode: StoryAuthoringMode): void;
    /** Applies from the next model call, fitted to the nearest level the model accepts. */
    setThinkingLevel(level: ModelThinkingLevel): void;
    listSnapshots(): Promise<StorySnapshotMeta[]>;
    rollbackToSnapshot(snapshotId: string): Promise<StoryRollbackResult>;
}

/** Folds pi-agent-core's events of one run into `StoryAgentEvent`s. */
class RunReporter {
    private finalText = "";
    private stats: StoryAgentRunStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0 };
    private error: string | null = null;
    private readonly toolStarts = new Map<string, number>();

    constructor(
        private readonly emit: (event: StoryAgentEvent) => void,
        private readonly setStatus: (status: StoryAgentStatus, message?: string) => void,
    ) {}

    handle(ev: AgentEvent, aborted: () => boolean): void {
        const now = Date.now();
        switch (ev.type) {
            case "agent_start":
                this.setStatus("starting");
                break;
            case "message_update": {
                const sub = ev.assistantMessageEvent;
                if (sub.type === "thinking_start") this.setStatus("thinking");
                else if (sub.type === "text_start") this.setStatus("streaming");
                else if (sub.type === "thinking_delta") {
                    this.emit({ type: "thinking_delta", delta: sub.delta, contentIndex: sub.contentIndex, timestamp: now });
                } else if (sub.type === "text_delta") {
                    this.finalText += sub.delta;
                    this.emit({ type: "text_delta", delta: sub.delta, contentIndex: sub.contentIndex, timestamp: now });
                }
                break;
            }
            case "tool_execution_start":
                this.stats.toolCalls += 1;
                this.toolStarts.set(ev.toolCallId, now);
                this.setStatus("tool_running", ev.toolName);
                this.emit({
                    type: "tool_start",
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    args: ev.args && typeof ev.args === "object" ? ev.args : {},
                    timestamp: now,
                });
                break;
            case "tool_execution_end": {
                const startedAt = this.toolStarts.get(ev.toolCallId) ?? now;
                this.toolStarts.delete(ev.toolCallId);
                const details = (ev.result as { details?: unknown } | undefined)?.details;
                this.emit({
                    type: "tool_end",
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    isError: ev.isError,
                    summary: summarizeToolResult(ev.result),
                    ...(details !== undefined ? { details } : {}),
                    durationMs: ev.durationMs ?? now - startedAt,
                    timestamp: now,
                });
                break;
            }
            case "turn_end": {
                if (ev.message.role !== "assistant") break;
                const { usage, stopReason, errorMessage } = ev.message;
                this.stats.inputTokens += usage.input;
                this.stats.outputTokens += usage.output;
                this.stats.totalTokens += usage.totalTokens;
                if (stopReason === "error") this.error = errorMessage ?? "The model request failed.";
                break;
            }
            case "agent_end":
                this.finish(aborted(), now);
                break;
            default:
                break;
        }
    }

    private finish(aborted: boolean, now: number): void {
        if (this.error && !aborted) {
            this.setStatus("error", this.error);
            this.emit({ type: "error", message: this.error, recoverable: false, timestamp: now });
        } else {
            this.setStatus(aborted ? "aborted" : "idle");
        }
        this.emit({ type: "done", aborted, finalText: this.finalText, stats: { ...this.stats }, timestamp: now });
    }
}

export function createBrowserStoryAgent(options: BrowserStoryAgentOptions): BrowserStoryAgent {
    const storyFile = options.storyFile ?? DEFAULT_STORY_FILE;
    const compaction = options.compaction ?? DEFAULT_COMPACTION_SETTINGS;
    const { files, onEvent: emit } = options;
    let authoringMode: StoryAuthoringMode = options.authoringMode ?? "edit";
    let userAborted = false;
    let compacting: AbortController | null = null;

    const setStatus = (status: StoryAgentStatus, message?: string) =>
        emit({ type: "status", status, mode: "sdk", ...(message ? { message } : {}), timestamp: Date.now() });

    const tools = createStoryMakerTools({
        getWorkspace: () => files,
        getStoryFile: () => storyFile,
        getAssetLine: () => options.assetLine ?? "main",
        getSelectedNodeId: options.getSelectedNodeId,
        getAuthoringMode: () => authoringMode,
        fetchImpl: options.fetchImpl,
        officialStoryCache: options.officialStoryCache,
        decodeBrotli: options.decodeBrotli,
        onSnapshotCreated: (snapshot) => emit({ type: "snapshot_created", snapshot, timestamp: Date.now() }),
        onMskDiff: (diff, file) => emit({ type: "msk_diff", diff, storyFile: file, timestamp: Date.now() }),
        onEditorAction: (action) => emit({ type: "editor_action", action, timestamp: Date.now() }),
        onWorkflowStage: (stage) => emit({ type: "workflow_stage", ...stage, timestamp: Date.now() }),
        onPlanProposed: (plan, awaitingApproval) =>
            emit({ type: "plan_proposed", plan, awaitingApproval, timestamp: Date.now() }),
    });

    const models = providerModels(options.provider);
    const model = isOffered(options.provider, options.model) ? models.getModel(options.provider, options.model) : undefined;
    if (!model) throw new Error(`The ${options.provider} model "${options.model}" is not offered here.`);
    const agent = new Agent({
        initialState: {
            systemPrompt: buildStoryAgentSystemPrompt(authoringMode, false, STORY_SCRIPT_SKILL),
            model,
            thinkingLevel: clampThinkingLevel(model, options.thinkingLevel ?? DEFAULT_THINKING_LEVEL),
            tools,
            ...(options.transcript ? { messages: options.transcript } : {}),
        },
        streamFn: models.streamSimple.bind(models),
        getApiKey: () => options.apiKey,
    });

    const contextTokens = () => estimateTranscriptTokens(agent.state.messages);

    /** Asks the model to summarize the turns before `cut`, then swaps them for the summary. */
    async function compactBefore(cut: number): Promise<boolean> {
        const messages = agent.state.messages;
        const tokensBefore = estimateTranscriptTokens(messages);
        emit({ type: "compaction", phase: "start", tokensBefore, timestamp: Date.now() });
        compacting = new AbortController();
        try {
            const reply = await models.completeSimple(
                agent.state.model,
                { systemPrompt: COMPACTION_SYSTEM_PROMPT, messages: summaryRequest(messages.slice(0, cut)) },
                { apiKey: options.apiKey, signal: compacting.signal },
            );
            if (reply.stopReason === "error" || reply.stopReason === "aborted") {
                throw new Error(reply.errorMessage ?? "The summary request failed.");
            }
            const summary = reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
            agent.state.messages = compactTranscript(messages, cut, summary);
            emit({ type: "compaction", phase: "end", tokensBefore, tokensAfter: contextTokens(), timestamp: Date.now() });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            emit({ type: "compaction", phase: "end", tokensBefore, error: message, timestamp: Date.now() });
            return false;
        } finally {
            compacting = null;
        }
    }

    /** Summarizes the turns older than the most recent `keepRecentTokens`; false when none are. */
    const compactKeeping = async (keepRecentTokens: number): Promise<boolean> => {
        const cut = findCompactionCut(agent.state.messages, keepRecentTokens);
        return cut !== null && compactBefore(cut);
    };

    return {
        async prompt(text, context) {
            userAborted = false;
            if (contextTokens() > compaction.triggerTokens) await compactKeeping(compaction.keepRecentTokens);
            if (userAborted) return;
            const reporter = new RunReporter(emit, setStatus);
            const unsubscribe = agent.subscribe((ev) => reporter.handle(ev, () => userAborted));
            try {
                await agent.prompt(formatUserPromptWithContext(text, authoringMode, false, true, context));
            } finally {
                unsubscribe();
            }
        },
        compact: () => compactKeeping(0),
        abort() {
            userAborted = true;
            compacting?.abort();
            agent.abort();
        },
        transcript: () => [...agent.state.messages],
        contextTokens,
        setAuthoringMode(mode) {
            authoringMode = mode;
        },
        setThinkingLevel(level) {
            agent.state.thinkingLevel = clampThinkingLevel(agent.state.model, level);
        },
        listSnapshots: () => listStorySnapshots(files),
        async rollbackToSnapshot(snapshotId) {
            const result = await rollbackStorySnapshot(files, storyFile, snapshotId);
            emit({ type: "msk_diff", diff: result.diff, storyFile, timestamp: Date.now() });
            return result;
        },
    };
}

export { createMemoryWorkspaceFiles, type MemoryWorkspaceFiles, type StoryWorkspaceFiles } from "./files";
export type { AgentMessage } from "@earendil-works/pi-agent-core";
export type { ModelThinkingLevel } from "@earendil-works/pi-ai";
export { DEFAULT_COMPACTION_SETTINGS, estimateTranscriptTokens, type CompactionSettings } from "./compaction";
export type { BrotliDecoder, OfficialStoryCache } from "./official-story";
export type {
    StoryAgentEvent,
    StoryAgentStatus,
    StoryAuthoringMode,
    StoryAgentPromptContext,
    StoryEditorAction,
    StoryMskDiff,
    StoryThinkingLevel,
} from "./types";
