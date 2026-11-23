import fs from "node:fs";
import path from "node:path";
import {
    clampAgentPanelWidth,
    DEFAULT_AGENT_PANEL_WIDTH,
    MAX_AGENT_PANEL_WIDTH,
    MIN_AGENT_PANEL_WIDTH,
} from "../shared/agent-panel-state.ts";
import type {
    AgentAuthoringMode,
    AgentProviderConfigInput,
    AgentProviderConfigPublic,
    AgentThinkingLevel,
    DesktopAppSettings,
} from "../shared/ipc.ts";

export interface SecretProtector {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

const DEFAULT_APP_SETTINGS: DesktopAppSettings = {
    themeSeed: "21",
    themeMode: "light",
    locale: "zh-CN",
    assetLine: "main",
    agentPanelOpen: true,
    agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
    updateChannel: "auto",
    autoCheckUpdates: true,
    ignoredUpdateVersion: null,
};

interface StoredAgentConfig {
    mode: "sdk" | "rpc";
    provider: string;
    model: string;
    baseUrl: string;
    api?: AgentProviderConfigPublic["api"];
    thinkingLevel: AgentThinkingLevel;
    authoringMode: AgentAuthoringMode;
    planFirst: boolean;
    /** Base64-encoded safeStorage ciphertext when encrypted, or fallback plaintext marker. */
    apiKeyEncryptedBase64?: string;
    apiKeyPlainFallback?: string;
    apiKeyHint?: string;
    rpcCliPath: string;
    rpcArgs: string[];
}

const DEFAULT_STORED_AGENT_CONFIG: StoredAgentConfig = {
    mode: "sdk",
    provider: "anthropic",
    model: "claude-opus-5-5",
    baseUrl: "",
    thinkingLevel: "medium",
    authoringMode: "create",
    planFirst: true,
    rpcCliPath: "pi",
    rpcArgs: [],
};

function normalizeThinkingLevel(raw: unknown): AgentThinkingLevel {
    if (raw === "off" || raw === "minimal" || raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") {
        return raw;
    }
    if (raw === "max") return "xhigh";
    return "medium";
}

function normalizeAuthoringMode(raw: unknown): AgentAuthoringMode {
    return raw === "edit" ? "edit" : "create";
}

function maskApiKey(key: string): string {
    const trimmed = key.trim();
    if (!trimmed) return "";
    if (trimmed.length <= 8) return "••••••••";
    return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export class DesktopSettingsStore {
    private readonly settingsFile: string;
    private readonly agentConfigFile: string;
    private readonly protector: SecretProtector | null;

    constructor(userDataDir: string, protector: SecretProtector | null = null) {
        fs.mkdirSync(userDataDir, { recursive: true });
        this.settingsFile = path.join(userDataDir, "desktop-settings.json");
        this.agentConfigFile = path.join(userDataDir, "agent-config.json");
        this.protector = protector;
    }

    getAppSettings(): DesktopAppSettings {
        if (!fs.existsSync(this.settingsFile)) {
            return { ...DEFAULT_APP_SETTINGS };
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) as Partial<DesktopAppSettings>;
            return {
                themeSeed: typeof parsed.themeSeed === "string" ? parsed.themeSeed : DEFAULT_APP_SETTINGS.themeSeed,
                themeMode: parsed.themeMode === "dark" ? "dark" : "light",
                locale: this.normalizeLocale(parsed.locale),
                assetLine: parsed.assetLine === "backup" ? "backup" : "main",
                agentPanelOpen: typeof parsed.agentPanelOpen === "boolean" ? parsed.agentPanelOpen : DEFAULT_APP_SETTINGS.agentPanelOpen,
                agentPanelWidth:
                    typeof parsed.agentPanelWidth === "number" &&
                    parsed.agentPanelWidth >= MIN_AGENT_PANEL_WIDTH &&
                    parsed.agentPanelWidth <= MAX_AGENT_PANEL_WIDTH
                        ? Math.round(parsed.agentPanelWidth)
                        : DEFAULT_APP_SETTINGS.agentPanelWidth,
                updateChannel: this.normalizeUpdateChannel(parsed.updateChannel),
                autoCheckUpdates:
                    typeof parsed.autoCheckUpdates === "boolean"
                        ? parsed.autoCheckUpdates
                        : DEFAULT_APP_SETTINGS.autoCheckUpdates,
                ignoredUpdateVersion:
                    typeof parsed.ignoredUpdateVersion === "string" && parsed.ignoredUpdateVersion.trim()
                        ? parsed.ignoredUpdateVersion.trim()
                        : null,
            };
        } catch {
            return { ...DEFAULT_APP_SETTINGS };
        }
    }

    updateAppSettings(patch: Partial<DesktopAppSettings>): DesktopAppSettings {
        const next: DesktopAppSettings = {
            ...this.getAppSettings(),
            ...patch,
        };
        next.locale = this.normalizeLocale(next.locale);
        next.themeMode = next.themeMode === "dark" ? "dark" : "light";
        next.assetLine = next.assetLine === "backup" ? "backup" : "main";
        next.agentPanelWidth = clampAgentPanelWidth(next.agentPanelWidth);
        next.updateChannel = this.normalizeUpdateChannel(next.updateChannel);
        next.autoCheckUpdates = typeof next.autoCheckUpdates === "boolean" ? next.autoCheckUpdates : true;
        next.ignoredUpdateVersion =
            typeof next.ignoredUpdateVersion === "string" && next.ignoredUpdateVersion.trim()
                ? next.ignoredUpdateVersion.trim()
                : null;
        fs.writeFileSync(this.settingsFile, JSON.stringify(next, null, 2) + "\n", "utf8");
        return next;
    }

    private readStoredAgentConfig(): StoredAgentConfig {
        if (!fs.existsSync(this.agentConfigFile)) {
            return { ...DEFAULT_STORED_AGENT_CONFIG };
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.agentConfigFile, "utf8")) as Partial<StoredAgentConfig>;
            const authoringMode = normalizeAuthoringMode(parsed.authoringMode);
            // Upgrade legacy pre-2026 default model transparently if user hadn't configured a custom key yet.
            const rawModel = typeof parsed.model === "string" && parsed.model.trim()
                ? parsed.model.trim()
                : DEFAULT_STORED_AGENT_CONFIG.model;
            const model =
                rawModel === "claude-sonnet-4-5" && !parsed.apiKeyEncryptedBase64 && !parsed.apiKeyPlainFallback
                    ? DEFAULT_STORED_AGENT_CONFIG.model
                    : rawModel;
            return {
                mode: parsed.mode === "rpc" ? "rpc" : "sdk",
                provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider.trim() : DEFAULT_STORED_AGENT_CONFIG.provider,
                model,
                baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "",
                api: parsed.api,
                thinkingLevel: normalizeThinkingLevel(parsed.thinkingLevel),
                authoringMode,
                planFirst: typeof parsed.planFirst === "boolean" ? parsed.planFirst : authoringMode === "create",
                apiKeyEncryptedBase64: parsed.apiKeyEncryptedBase64,
                apiKeyPlainFallback: parsed.apiKeyPlainFallback,
                apiKeyHint: parsed.apiKeyHint,
                rpcCliPath: typeof parsed.rpcCliPath === "string" && parsed.rpcCliPath.trim() ? parsed.rpcCliPath.trim() : "pi",
                rpcArgs: Array.isArray(parsed.rpcArgs) ? parsed.rpcArgs.filter((v): v is string => typeof v === "string") : [],
            };
        } catch {
            return { ...DEFAULT_STORED_AGENT_CONFIG };
        }
    }

    private canEncrypt(): boolean {
        try {
            return Boolean(this.protector?.isEncryptionAvailable());
        } catch {
            return false;
        }
    }

    /**
     * Resolves the decrypted API key strictly inside Main process for passing to `utilityProcess`.
     * NEVER send this value back over IPC to the renderer!
     */
    getResolvedAgentConfigForWorker(): {
        mode: "sdk" | "rpc";
        provider: string;
        model: string;
        baseUrl?: string;
        api?: AgentProviderConfigPublic["api"];
        thinkingLevel: AgentThinkingLevel;
        authoringMode: AgentAuthoringMode;
        planFirst: boolean;
        apiKey?: string;
        rpcCliPath: string;
        rpcArgs: string[];
    } {
        const stored = this.readStoredAgentConfig();
        let apiKey: string | undefined;

        if (stored.apiKeyEncryptedBase64 && this.canEncrypt() && this.protector) {
            try {
                apiKey = this.protector.decryptString(Buffer.from(stored.apiKeyEncryptedBase64, "base64"));
            } catch {
                apiKey = undefined;
            }
        } else if (stored.apiKeyPlainFallback) {
            apiKey = stored.apiKeyPlainFallback;
        }

        return {
            mode: stored.mode,
            provider: stored.provider,
            model: stored.model,
            baseUrl: stored.baseUrl || undefined,
            api: stored.api,
            thinkingLevel: stored.thinkingLevel,
            authoringMode: stored.authoringMode,
            planFirst: stored.planFirst,
            apiKey: apiKey?.trim() || undefined,
            rpcCliPath: stored.rpcCliPath || "pi",
            rpcArgs: stored.rpcArgs,
        };
    }

    getPublicAgentConfig(): AgentProviderConfigPublic {
        const stored = this.readStoredAgentConfig();
        const hasApiKey = Boolean(stored.apiKeyEncryptedBase64 || stored.apiKeyPlainFallback);
        return {
            mode: stored.mode,
            provider: stored.provider,
            model: stored.model,
            baseUrl: stored.baseUrl,
            api: stored.api,
            thinkingLevel: stored.thinkingLevel,
            authoringMode: stored.authoringMode,
            planFirst: stored.planFirst,
            hasApiKey,
            apiKeyHint: hasApiKey ? (stored.apiKeyHint || "••••••••") : "",
            safeStorageAvailable: this.canEncrypt(),
            rpcCliPath: stored.rpcCliPath,
            rpcArgs: stored.rpcArgs,
        };
    }

    saveAgentConfig(input: AgentProviderConfigInput): AgentProviderConfigPublic {
        const current = this.readStoredAgentConfig();
        const next: StoredAgentConfig = {
            ...current,
            mode: input.mode === "rpc" ? "rpc" : "sdk",
            provider: input.provider.trim() || current.provider,
            model: input.model.trim() || current.model,
            baseUrl: (input.baseUrl ?? current.baseUrl ?? "").trim(),
            api: input.api !== undefined ? input.api : current.api,
            thinkingLevel: input.thinkingLevel !== undefined ? normalizeThinkingLevel(input.thinkingLevel) : current.thinkingLevel,
            authoringMode: input.authoringMode !== undefined ? normalizeAuthoringMode(input.authoringMode) : current.authoringMode,
            planFirst: typeof input.planFirst === "boolean" ? input.planFirst : current.planFirst,
            rpcCliPath: (input.rpcCliPath ?? current.rpcCliPath ?? "pi").trim() || "pi",
            rpcArgs: Array.isArray(input.rpcArgs)
                ? input.rpcArgs.filter((v): v is string => typeof v === "string")
                : current.rpcArgs,
        };

        if (input.clearApiKey) {
            delete next.apiKeyEncryptedBase64;
            delete next.apiKeyPlainFallback;
            delete next.apiKeyHint;
        } else if (typeof input.apiKey === "string" && input.apiKey.trim().length > 0) {
            const plain = input.apiKey.trim();
            next.apiKeyHint = maskApiKey(plain);
            if (this.canEncrypt() && this.protector) {
                next.apiKeyEncryptedBase64 = this.protector.encryptString(plain).toString("base64");
                delete next.apiKeyPlainFallback;
            } else {
                next.apiKeyPlainFallback = plain;
                delete next.apiKeyEncryptedBase64;
            }
        }

        fs.writeFileSync(this.agentConfigFile, JSON.stringify(next, null, 2) + "\n", {
            encoding: "utf8",
            mode: 0o600,
        });
        return this.getPublicAgentConfig();
    }

    patchAgentWorkflowPrefs(patch: {
        thinkingLevel?: AgentThinkingLevel;
        authoringMode?: AgentAuthoringMode;
        planFirst?: boolean;
        model?: string;
        provider?: string;
    }): AgentProviderConfigPublic {
        const current = this.readStoredAgentConfig();
        return this.saveAgentConfig({
            mode: current.mode,
            provider: patch.provider ?? current.provider,
            model: patch.model ?? current.model,
            baseUrl: current.baseUrl,
            api: current.api,
            thinkingLevel: patch.thinkingLevel ?? current.thinkingLevel,
            authoringMode: patch.authoringMode ?? current.authoringMode,
            planFirst: patch.planFirst ?? current.planFirst,
            rpcCliPath: current.rpcCliPath,
            rpcArgs: current.rpcArgs,
        });
    }

    private normalizeLocale(value: unknown): DesktopAppSettings["locale"] {
        if (value === "zh-CN" || value === "zh-TW" || value === "en-US" || value === "ja-JP" || value === "ko-KR") {
            return value;
        }
        return DEFAULT_APP_SETTINGS.locale;
    }

    private normalizeUpdateChannel(value: unknown): DesktopAppSettings["updateChannel"] {
        if (value === "auto" || value === "cnb" || value === "github") {
            return value;
        }
        return DEFAULT_APP_SETTINGS.updateChannel;
    }
}
