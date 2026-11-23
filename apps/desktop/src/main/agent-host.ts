import crypto from "node:crypto";
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
    AgentAuthoringMode,
    AgentFetchModelsResult,
    AgentKnownProviderInfo,
    AgentModelOption,
    AgentPresetPayload,
    AgentPromptPayload,
    AgentProviderConfigInput,
    AgentProviderConfigPublic,
    AgentResumedSession,
    AgentRuntimeStatus,
    AgentSessionSummary,
    AgentThinkingLevel,
    DesktopAgentEvent,
    WorkspaceSnapshotInfo,
} from "../shared/ipc.ts";
import type { DesktopSettingsStore } from "./settings.ts";
import type { WorkerMessage, WorkerRequest } from "./agent-worker.ts";

interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
}

const FALLBACK_KNOWN_PROVIDERS: AgentKnownProviderInfo[] = [
    {
        id: "anthropic",
        label: "Anthropic (Claude)",
        defaultModel: "claude-opus-5-5",
        defaultBaseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        sampleModels: [
            { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, isDefault: true, source: "curated" },
            { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, source: "curated" },
            { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 200_000, source: "curated" },
            { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, source: "curated" },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, source: "curated" },
            { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", reasoning: true, supportsThinking: true, contextWindow: 200_000, source: "curated" },
        ],
    },
    {
        id: "openai",
        label: "OpenAI",
        defaultModel: "gpt-6.2-astra",
        defaultBaseUrl: "https://api.openai.com/v1",
        api: "openai-responses",
        sampleModels: [
            { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, isDefault: true, source: "curated" },
            { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "gpt-5", name: "GPT-5", provider: "openai", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
        ],
    },
    {
        id: "google",
        label: "Google Gemini",
        defaultModel: "gemini-4-carbon",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        api: "google-generative-ai",
        sampleModels: [
            { id: "gemini-4-carbon", name: "Gemini 4 Carbon", provider: "google", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, isDefault: true, source: "curated" },
            { id: "gemini-4-neon", name: "Gemini 4 Neon", provider: "google", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, source: "curated" },
            { id: "gemini-4-argon", name: "Gemini 4 Argon", provider: "google", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, source: "curated" },
            { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", provider: "google", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, source: "curated" },
            { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "google", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, source: "curated" },
        ],
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        defaultModel: "anthropic/claude-opus-5.5",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        api: "openai-completions",
        sampleModels: [
            { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5 (OpenRouter)", provider: "openrouter", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, isDefault: true, source: "curated" },
            { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5 (OpenRouter)", provider: "openrouter", reasoning: true, supportsThinking: true, contextWindow: 1_000_000, source: "curated" },
            { id: "openai/gpt-6.2-astra", name: "GPT-6.2 Astra (OpenRouter)", provider: "openrouter", reasoning: true, supportsThinking: true, contextWindow: 400_000, source: "curated" },
            { id: "google/gemini-4-carbon", name: "Gemini 4 Carbon (OpenRouter)", provider: "openrouter", reasoning: true, supportsThinking: true, contextWindow: 1_048_576, source: "curated" },
            { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (OpenRouter)", provider: "openrouter", reasoning: true, supportsThinking: true, contextWindow: 128_000, source: "curated" },
        ],
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        defaultModel: "deepseek-v4-pro",
        defaultBaseUrl: "https://api.deepseek.com/v1",
        api: "openai-completions",
        sampleModels: [
            { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", reasoning: true, supportsThinking: true, contextWindow: 128_000, isDefault: true, source: "curated" },
            { id: "deepseek-flash", name: "DeepSeek Flash", provider: "deepseek", reasoning: true, supportsThinking: true, contextWindow: 128_000, source: "curated" },
        ],
    },
    {
        id: "custom",
        label: "Custom OpenAI-Compatible",
        defaultModel: "gpt-6.2-astra",
        defaultBaseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        sampleModels: [],
    },
];

export interface AgentHostOptions {
    workerPath: string;
    skillPath: string;
    settingsStore: DesktopSettingsStore;
    getWorkspace: () => { rootDir: string; storyFileName: string } | null;
    onEvent: (event: DesktopAgentEvent) => void;
}

/**
 * Main-process supervisor for the crash-isolated MoeSekai Agent `utilityProcess`.
 */
export class PiAgentHost {
    private readonly workerPath: string;
    private readonly skillPath: string;
    private readonly settingsStore: DesktopSettingsStore;
    private readonly getWorkspace: () => { rootDir: string; storyFileName: string } | null;
    private readonly onEvent: (event: DesktopAgentEvent) => void;

    private proc: UtilityProcess | null = null;
    private pending = new Map<string, PendingCall>();
    private initializedWorkspaceKey: string | null = null;
    private lastStatus: AgentRuntimeStatus;

    constructor(options: AgentHostOptions) {
        this.workerPath = options.workerPath;
        this.skillPath = options.skillPath;
        this.settingsStore = options.settingsStore;
        this.getWorkspace = options.getWorkspace;
        this.onEvent = options.onEvent;

        const pub = this.settingsStore.getPublicAgentConfig();
        this.lastStatus = {
            status: "idle",
            mode: pub.mode,
            provider: pub.provider,
            model: pub.model,
            thinkingLevel: pub.thinkingLevel,
            authoringMode: pub.authoringMode,
            planFirst: pub.planFirst,
            hasApiKey: pub.hasApiKey,
            isStreaming: false,
        };
    }

    getPublicConfig(): AgentProviderConfigPublic {
        return this.settingsStore.getPublicAgentConfig();
    }

    async saveConfig(input: AgentProviderConfigInput): Promise<AgentProviderConfigPublic> {
        const pub = this.settingsStore.saveAgentConfig(input);
        this.syncStatusFromConfig(pub);

        if (this.proc && this.initializedWorkspaceKey) {
            const resolved = this.settingsStore.getResolvedAgentConfigForWorker();
            await this.callWorker({
                id: crypto.randomUUID(),
                type: "update_config",
                config: resolved,
            });
        }

        return pub;
    }

    async setThinkingLevel(level: AgentThinkingLevel): Promise<AgentProviderConfigPublic> {
        const pub = this.settingsStore.patchAgentWorkflowPrefs({ thinkingLevel: level });
        this.syncStatusFromConfig(pub);

        if (this.proc && this.initializedWorkspaceKey) {
            await this.callWorker({
                id: crypto.randomUUID(),
                type: "set_thinking_level",
                thinkingLevel: pub.thinkingLevel,
            });
        }

        return pub;
    }

    async setAuthoringMode(mode: AgentAuthoringMode, planFirst?: boolean): Promise<AgentProviderConfigPublic> {
        const pub = this.settingsStore.patchAgentWorkflowPrefs({
            authoringMode: mode,
            ...(typeof planFirst === "boolean" ? { planFirst } : {}),
        });
        this.syncStatusFromConfig(pub);

        if (this.proc && this.initializedWorkspaceKey) {
            await this.callWorker({
                id: crypto.randomUUID(),
                type: "set_authoring_mode",
                authoringMode: pub.authoringMode,
            });
            if (typeof planFirst === "boolean") {
                await this.callWorker({
                    id: crypto.randomUUID(),
                    type: "set_plan_first",
                    planFirst: pub.planFirst,
                });
            }
        }

        return pub;
    }

    async setPlanFirst(planFirst: boolean): Promise<AgentProviderConfigPublic> {
        const pub = this.settingsStore.patchAgentWorkflowPrefs({ planFirst });
        this.syncStatusFromConfig(pub);

        if (this.proc && this.initializedWorkspaceKey) {
            await this.callWorker({
                id: crypto.randomUUID(),
                type: "set_plan_first",
                planFirst: pub.planFirst,
            });
        }

        return pub;
    }

    async approvePlan(planId: string, feedback?: string): Promise<{ ok: boolean }> {
        await this.ensureSessionInitialized();
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "approve_plan",
            planId,
            feedback,
        });
        return { ok: true };
    }

    async revisePlan(planId: string, feedback: string): Promise<{ ok: boolean }> {
        await this.ensureSessionInitialized();
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "revise_plan",
            planId,
            feedback,
        });
        return { ok: true };
    }

    async fetchModels(override?: Partial<AgentProviderConfigInput>): Promise<AgentFetchModelsResult> {
        const resolved = this.settingsStore.getResolvedAgentConfigForWorker();
        const effectiveConfig = {
            ...resolved,
            ...(override?.provider ? { provider: override.provider } : {}),
            ...(override?.model ? { model: override.model } : {}),
            ...(override?.baseUrl !== undefined ? { baseUrl: override.baseUrl.trim() || undefined } : {}),
            ...(override?.api !== undefined ? { api: override.api } : {}),
            ...(override?.clearApiKey
                ? { apiKey: undefined }
                : typeof override?.apiKey === "string" && override.apiKey.trim().length > 0
                    ? { apiKey: override.apiKey.trim() }
                    : {}),
        };

        try {
            this.ensureWorkerSpawned();
            const raw = await this.callWorker({
                id: crypto.randomUUID(),
                type: "fetch_models",
                config: effectiveConfig,
            });
            if (raw && typeof raw === "object" && Array.isArray((raw as AgentFetchModelsResult).models)) {
                return raw as AgentFetchModelsResult;
            }
        } catch (err) {
            const match = FALLBACK_KNOWN_PROVIDERS.find(p => p.id === effectiveConfig.provider);
            return {
                ok: false,
                provider: effectiveConfig.provider,
                source: "catalog",
                models: match?.sampleModels ?? [],
                error: err instanceof Error ? err.message : String(err),
            };
        }

        const match = FALLBACK_KNOWN_PROVIDERS.find(p => p.id === effectiveConfig.provider);
        return {
            ok: true,
            provider: effectiveConfig.provider,
            source: "catalog",
            models: match?.sampleModels ?? [],
        };
    }

    async getStatus(): Promise<AgentRuntimeStatus> {
        const pub = this.settingsStore.getPublicAgentConfig();
        const ws = this.getWorkspace();
        return {
            ...this.lastStatus,
            mode: pub.mode,
            provider: pub.provider,
            model: pub.model,
            thinkingLevel: pub.thinkingLevel,
            authoringMode: pub.authoringMode,
            planFirst: pub.planFirst,
            hasApiKey: pub.hasApiKey,
            workspaceDir: ws?.rootDir,
            storyFile: ws?.storyFileName,
        };
    }

    async listProviders(): Promise<AgentKnownProviderInfo[]> {
        try {
            this.ensureWorkerSpawned();
            const raw = await this.callWorker({
                id: crypto.randomUUID(),
                type: "list_providers",
            });
            if (Array.isArray(raw) && raw.length > 0) {
                return raw.map((item): AgentKnownProviderInfo => {
                    if (typeof item === "string") {
                        const match = FALLBACK_KNOWN_PROVIDERS.find(p => p.id === item);
                        return match ?? { id: item, label: item };
                    }
                    const obj = item as Record<string, unknown>;
                    const id = String(obj.id ?? obj.provider ?? obj.name ?? "custom");
                    const sampleModels = Array.isArray(obj.sampleModels)
                        ? (obj.sampleModels as AgentModelOption[])
                        : undefined;
                    const match = FALLBACK_KNOWN_PROVIDERS.find(p => p.id === id);
                    return {
                        id,
                        label: String(obj.label ?? obj.displayName ?? obj.name ?? match?.label ?? id),
                        defaultModel: typeof obj.defaultModel === "string"
                            ? obj.defaultModel
                            : sampleModels?.[0]?.id ?? match?.defaultModel,
                        defaultBaseUrl: typeof obj.defaultBaseUrl === "string" ? obj.defaultBaseUrl : match?.defaultBaseUrl,
                        api: typeof obj.api === "string" ? (obj.api as AgentKnownProviderInfo["api"]) : match?.api,
                        sampleModels: sampleModels && sampleModels.length > 0 ? sampleModels : match?.sampleModels,
                    };
                });
            }
        } catch {
            // Fallback to curated late-2026 frontier catalog if worker hasn't started yet
        }
        return FALLBACK_KNOWN_PROVIDERS;
    }

    async notifyWorkspaceChanged(options?: { forceReset?: boolean }): Promise<void> {
        const ws = this.getWorkspace();
        if (!ws) {
            this.initializedWorkspaceKey = null;
            this.lastStatus = {
                ...this.lastStatus,
                status: "idle",
                isStreaming: false,
                activeSessionId: null,
                lastError: undefined,
                workspaceDir: undefined,
                storyFile: undefined,
            };
            if (this.proc) {
                try {
                    await this.callWorker({ id: crypto.randomUUID(), type: "abort" });
                } catch {
                    // ignore
                }
                try {
                    await this.callWorker({ id: crypto.randomUUID(), type: "dispose" });
                } catch {
                    // ignore
                }
            }
            return;
        }

        const key = `${path.resolve(ws.rootDir)}::${ws.storyFileName}`;
        if (!options?.forceReset && this.initializedWorkspaceKey === key) return;

        // Always reset streaming status & tear down prior workspace session on switch
        this.initializedWorkspaceKey = null;
        this.lastStatus = {
            ...this.lastStatus,
            status: "idle",
            isStreaming: false,
            activeSessionId: null,
            lastError: undefined,
            workspaceDir: ws.rootDir,
            storyFile: ws.storyFileName,
        };

        if (!this.proc) return;
        try {
            await this.callWorker({ id: crypto.randomUUID(), type: "abort" });
        } catch {
            // ignore
        }
        await this.ensureSessionInitialized();
    }

    async prompt(payload: AgentPromptPayload): Promise<{ ok: boolean }> {
        await this.ensureSessionInitialized();
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "prompt",
            text: payload.prompt,
            context: payload.context,
        });
        return { ok: true };
    }

    async runPreset(payload: AgentPresetPayload): Promise<{ ok: boolean }> {
        await this.ensureSessionInitialized();
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "preset",
            preset: payload.preset,
            options: {
                brief: payload.brief,
                targetLocale: payload.targetLocale,
                region: payload.region,
                verifyAssets: payload.verifyAssets,
                context: payload.context,
            },
        });
        return { ok: true };
    }

    async abort(): Promise<void> {
        if (!this.proc) return;
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "abort",
        });
    }

    async reset(): Promise<void> {
        if (!this.proc) return;
        await this.callWorker({
            id: crypto.randomUUID(),
            type: "reset",
        });
        this.lastStatus = { ...this.lastStatus, activeSessionId: null };
    }

    async listSessions(): Promise<AgentSessionSummary[]> {
        if (!this.getWorkspace()) return [];
        await this.ensureSessionInitialized();
        const result = await this.callWorker({
            id: crypto.randomUUID(),
            type: "list_sessions",
        });
        return Array.isArray(result) ? (result as AgentSessionSummary[]) : [];
    }

    async resumeSession(sessionId: string): Promise<AgentResumedSession> {
        await this.ensureSessionInitialized();
        const resumed = (await this.callWorker({
            id: crypto.randomUUID(),
            type: "resume_session",
            sessionId,
        })) as AgentResumedSession;
        this.lastStatus = {
            ...this.lastStatus,
            activeSessionId: resumed?.summary?.id ?? sessionId,
            status: "idle",
            isStreaming: false,
            lastError: undefined,
        };
        return resumed;
    }

    async newSession(): Promise<{ sessionId: string }> {
        await this.ensureSessionInitialized();
        const created = (await this.callWorker({
            id: crypto.randomUUID(),
            type: "new_session",
        })) as { sessionId: string };
        this.lastStatus = {
            ...this.lastStatus,
            activeSessionId: created?.sessionId ?? null,
            status: "idle",
            isStreaming: false,
            lastError: undefined,
        };
        return created;
    }

    async deleteSession(sessionId: string): Promise<boolean> {
        if (!this.getWorkspace()) return false;
        await this.ensureSessionInitialized();
        const deleted = await this.callWorker({
            id: crypto.randomUUID(),
            type: "delete_session",
            sessionId,
        });
        if (deleted && this.lastStatus.activeSessionId === sessionId) {
            this.lastStatus = { ...this.lastStatus, activeSessionId: null };
        }
        return Boolean(deleted);
    }

    async listSnapshots(): Promise<WorkspaceSnapshotInfo[]> {
        if (!this.getWorkspace()) return [];
        await this.ensureSessionInitialized();
        const result = await this.callWorker({
            id: crypto.randomUUID(),
            type: "list_snapshots",
        });
        return Array.isArray(result) ? (result as WorkspaceSnapshotInfo[]) : [];
    }

    async rollbackSnapshot(snapshotId: string): Promise<unknown> {
        await this.ensureSessionInitialized();
        return this.callWorker({
            id: crypto.randomUUID(),
            type: "rollback",
            snapshotId,
        });
    }

    async dispose(): Promise<void> {
        if (this.proc) {
            try {
                await Promise.race([
                    this.callWorker({ id: crypto.randomUUID(), type: "dispose" }),
                    new Promise(resolve => setTimeout(resolve, 1500)),
                ]);
            } catch {
                // ignore
            }
            try {
                this.proc.kill();
            } catch {
                // ignore
            }
            this.proc = null;
        }
        this.initializedWorkspaceKey = null;
        this.rejectAllPending(new Error("Agent worker disposed."));
    }

    // ==================== Private ====================

    private syncStatusFromConfig(pub: AgentProviderConfigPublic): void {
        this.lastStatus = {
            ...this.lastStatus,
            mode: pub.mode,
            provider: pub.provider,
            model: pub.model,
            thinkingLevel: pub.thinkingLevel,
            authoringMode: pub.authoringMode,
            planFirst: pub.planFirst,
            hasApiKey: pub.hasApiKey,
        };
    }

    private ensureWorkerSpawned(): void {
        if (this.proc) return;

        const child = utilityProcess.fork(this.workerPath, [], {
            serviceName: "moesekai-story-agent",
            stdio: "pipe",
        });

        child.on("message", raw => {
            const msg = raw as WorkerMessage;
            if (!msg || typeof msg !== "object") return;

            if (msg.kind === "response") {
                const pending = this.pending.get(msg.id);
                if (!pending) return;
                this.pending.delete(msg.id);
                if (msg.ok) pending.resolve(msg.data);
                else pending.reject(new Error(msg.error));
                return;
            }

            if (msg.kind === "event") {
                const ev = msg.event as DesktopAgentEvent;
                this.updateStatusFromEvent(ev);
                this.onEvent(ev);
            }
        });

        child.on("exit", code => {
            this.proc = null;
            this.initializedWorkspaceKey = null;
            this.lastStatus = {
                ...this.lastStatus,
                status: code === 0 ? "idle" : "error",
                isStreaming: false,
                lastError: code && code !== 0 ? `MoeSekai Agent worker exited unexpectedly (code ${code}).` : undefined,
            };
            this.rejectAllPending(new Error(`MoeSekai Agent worker exited with code ${code ?? "unknown"}.`));
            if (code && code !== 0) {
                this.onEvent({
                    type: "error",
                    message: `MoeSekai Agent worker crashed (exit code ${code}). It will restart automatically on your next message.`,
                    code: "WORKER_CRASHED",
                    recoverable: true,
                    timestamp: Date.now(),
                });
            }
        });

        this.proc = child;
    }

    private async ensureSessionInitialized(): Promise<void> {
        const ws = this.getWorkspace();
        if (!ws) {
            throw new Error("Open or create a .msk workspace before starting MoeSekai Agent.");
        }
        this.ensureWorkerSpawned();

        const key = `${path.resolve(ws.rootDir)}::${ws.storyFileName}`;
        if (this.initializedWorkspaceKey === key) return;

        const config = this.settingsStore.getResolvedAgentConfigForWorker();
        const appSettings = this.settingsStore.getAppSettings();

        await this.callWorker({
            id: crypto.randomUUID(),
            type: "init",
            workspaceDir: ws.rootDir,
            storyFile: ws.storyFileName,
            skillPath: this.skillPath,
            assetLine: appSettings.assetLine,
            config,
        });
        this.initializedWorkspaceKey = key;
    }

    private callWorker(req: WorkerRequest): Promise<unknown> {
        if (!this.proc) {
            return Promise.reject(new Error("MoeSekai Agent worker process is not running."));
        }
        return new Promise((resolve, reject) => {
            this.pending.set(req.id, { resolve, reject });
            try {
                this.proc!.postMessage(req);
            } catch (err) {
                this.pending.delete(req.id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private updateStatusFromEvent(event: DesktopAgentEvent): void {
        if (event.type === "status") {
            this.lastStatus = {
                ...this.lastStatus,
                status: event.status,
                mode: event.mode,
                isStreaming:
                    event.status === "starting" ||
                    event.status === "thinking" ||
                    event.status === "streaming" ||
                    event.status === "tool_running" ||
                    event.status === "retrying",
                lastError: event.status === "error" ? event.message : undefined,
            };
        } else if (event.type === "retry_start") {
            this.lastStatus = {
                ...this.lastStatus,
                status: "retrying",
                isStreaming: true,
                lastError: event.errorMessage,
            };
        } else if (event.type === "retry_end") {
            this.lastStatus = {
                ...this.lastStatus,
                status: event.success ? "streaming" : "error",
                isStreaming: event.success,
                lastError: event.success ? undefined : event.finalError,
            };
        } else if (event.type === "done") {
            this.lastStatus = {
                ...this.lastStatus,
                status: event.aborted ? "aborted" : "idle",
                isStreaming: false,
            };
        } else if (event.type === "error") {
            this.lastStatus = {
                ...this.lastStatus,
                status: event.recoverable ? "retrying" : "error",
                isStreaming: Boolean(event.recoverable),
                lastError: event.message,
            };
        }
    }

    private rejectAllPending(err: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(err);
        }
        this.pending.clear();
    }
}
