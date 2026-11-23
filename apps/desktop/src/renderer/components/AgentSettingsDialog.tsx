import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Banner,
    Button,
    Chip,
    Dialog,
    Icon,
    SegmentedButton,
    Select,
    TextField,
} from "@moesekai/story-editor/md3";
import {
    mdCheckCircle,
    mdDelete,
    mdLock,
    mdRefresh,
} from "@moesekai/story-editor/md3/icons";
import type {
    AgentApiProtocol,
    AgentKnownProviderInfo,
    AgentMode,
    AgentModelOption,
    AgentProviderConfigPublic,
    AgentThinkingLevel,
    DesktopUiLocale,
} from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";

const API_PROTOCOL_OPTIONS: Array<{ value: AgentApiProtocol; label: string }> = [
    { value: "openai-completions", label: "OpenAI Chat Completions" },
    { value: "openai-responses", label: "OpenAI Responses API" },
    { value: "anthropic-messages", label: "Anthropic Messages" },
    { value: "google-generative-ai", label: "Google Generative AI" },
];

export interface AgentSettingsDialogProps {
    open: boolean;
    locale: DesktopUiLocale;
    onClose: () => void;
    onSaved: (config: AgentProviderConfigPublic) => void;
}

export const AgentSettingsDialog: React.FC<AgentSettingsDialogProps> = ({
    open,
    locale,
    onClose,
    onSaved,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const [providers, setProviders] = useState<AgentKnownProviderInfo[]>([]);
    const [mode, setMode] = useState<AgentMode>("sdk");
    const [provider, setProvider] = useState("anthropic");
    const [model, setModel] = useState("claude-opus-5-5");
    const [baseUrl, setBaseUrl] = useState("");
    const [apiProtocol, setApiProtocol] = useState<AgentApiProtocol>("openai-completions");
    const [thinkingLevel, setThinkingLevel] = useState<AgentThinkingLevel>("medium");
    const [apiKeyDraft, setApiKeyDraft] = useState("");
    const [hasSavedKey, setHasSavedKey] = useState(false);
    const [savedKeyHint, setSavedKeyHint] = useState("");
    const [safeStorageAvailable, setSafeStorageAvailable] = useState(false);
    const [clearApiKey, setClearApiKey] = useState(false);
    const [rpcCliPath, setRpcCliPath] = useState("pi");
    const [saving, setSaving] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    const [liveModels, setLiveModels] = useState<AgentModelOption[] | null>(null);
    const [liveSource, setLiveSource] = useState<"live" | "catalog" | null>(null);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [fetchNotice, setFetchNotice] = useState<string | null>(null);

    const loadSeqRef = useRef(0);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const seq = ++loadSeqRef.current;
        setErrorText(null);
        setFetchNotice(null);
        setLiveModels(null);
        setLiveSource(null);
        setApiKeyDraft("");
        setClearApiKey(false);

        void Promise.all([
            window.moesekaiDesktop.agent.getConfig(),
            window.moesekaiDesktop.agent.listProviders(),
        ])
            .then(([cfg, provs]) => {
                if (cancelled || seq !== loadSeqRef.current) return;
                setProviders(provs);
                setMode(cfg.mode);
                setProvider(cfg.provider);
                setModel(cfg.model);
                setBaseUrl(cfg.baseUrl);
                setApiProtocol(cfg.api ?? "openai-completions");
                setThinkingLevel(cfg.thinkingLevel ?? "medium");
                setHasSavedKey(cfg.hasApiKey);
                setSavedKeyHint(cfg.apiKeyHint);
                setSafeStorageAvailable(cfg.safeStorageAvailable);
                setRpcCliPath(cfg.rpcCliPath || "pi");
            })
            .catch(err => {
                if (cancelled || seq !== loadSeqRef.current) return;
                setErrorText(err instanceof Error ? err.message : String(err));
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const selectedProviderMeta = useMemo(
        () => providers.find(p => p.id === provider),
        [providers, provider],
    );

    const displayedModels = useMemo<AgentModelOption[]>(() => {
        if (liveModels && liveModels.length > 0) return liveModels;
        return selectedProviderMeta?.sampleModels ?? [];
    }, [liveModels, selectedProviderMeta]);

    const providerSelectOptions = useMemo(
        () =>
            providers.length > 0
                ? providers.map(p => ({ value: p.id, label: p.label }))
                : [
                    { value: "anthropic", label: "Anthropic (Claude)" },
                    { value: "openai", label: "OpenAI" },
                    { value: "google", label: "Google Gemini" },
                    { value: "openrouter", label: "OpenRouter" },
                    { value: "deepseek", label: "DeepSeek" },
                    { value: "custom", label: "Custom OpenAI-Compatible" },
                ],
        [providers],
    );

    const thinkingOptions = useMemo<Array<{ value: AgentThinkingLevel; label: string }>>(
        () => [
            { value: "off", label: t("agentThinkingOff") },
            { value: "minimal", label: t("agentThinkingMinimal") },
            { value: "low", label: t("agentThinkingLow") },
            { value: "medium", label: t("agentThinkingMedium") },
            { value: "high", label: t("agentThinkingHigh") },
            { value: "xhigh", label: t("agentThinkingXhigh") },
        ],
        [locale],
    );

    const handleProviderChange = (nextProvider: string) => {
        setProvider(nextProvider);
        setLiveModels(null);
        setLiveSource(null);
        setFetchNotice(null);
        const meta = providers.find(p => p.id === nextProvider);
        if (meta?.defaultModel) setModel(meta.defaultModel);
        if (meta?.defaultBaseUrl !== undefined) setBaseUrl(meta.defaultBaseUrl ?? "");
        if (meta?.api) setApiProtocol(meta.api);
    };

    const handleFetchLatestModels = async () => {
        setFetchingModels(true);
        setFetchNotice(null);
        try {
            const res = await window.moesekaiDesktop.agent.fetchModels({
                provider,
                model: model.trim() || undefined,
                baseUrl: baseUrl.trim(),
                api: baseUrl.trim() || provider === "custom" ? apiProtocol : undefined,
                apiKey: apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
                clearApiKey,
            });
            setLiveModels(res.models);
            setLiveSource(res.source);
            if (res.error) {
                setFetchNotice(res.error);
            }
        } catch (err) {
            setFetchNotice(err instanceof Error ? err.message : String(err));
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setErrorText(null);
        try {
            const saved = await window.moesekaiDesktop.agent.saveConfig({
                mode,
                provider,
                model: model.trim() || selectedProviderMeta?.defaultModel || "claude-opus-5-5",
                baseUrl: baseUrl.trim(),
                api: baseUrl.trim() || provider === "custom" ? apiProtocol : undefined,
                thinkingLevel,
                apiKey: apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
                clearApiKey,
                rpcCliPath: rpcCliPath.trim() || "pi",
            });
            onSaved(saved);
            onClose();
        } catch (err) {
            setErrorText(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            isOpen={open}
            onClose={() => !saving && onClose()}
            title={t("agentSettingsTitle")}
            size="md"
            syncHistory={false}
            actions={
                <div className="flex items-center justify-end gap-2">
                    <Button variant="text" onClick={onClose} disabled={saving}>
                        {t("cancel")}
                    </Button>
                    <Button
                        variant="filled"
                        icon={mdCheckCircle}
                        onClick={() => void handleSave()}
                        disabled={saving}
                    >
                        {t("agentSaveSettings")}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-4 py-1">
                {/* Runtime Mode */}
                <div className="flex flex-col gap-1.5">
                    <span className="type-label-l text-on-surface">{t("agentModeLabel")}</span>
                    <SegmentedButton
                        value={mode}
                        onValueChange={val => setMode(val)}
                        options={[
                            { value: "sdk" as const, label: t("agentModeSdk") },
                            { value: "rpc" as const, label: t("agentModeRpc") },
                        ]}
                    />
                </div>

                {mode === "sdk" ? (
                    <>
                        <Select
                            label={t("agentProviderLabel")}
                            value={provider}
                            onValueChange={val => handleProviderChange(String(val))}
                            options={providerSelectOptions}
                        />

                        {/* Model ID + Live Provider Model Discovery */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-end gap-2">
                                <div className="min-w-0 flex-1">
                                    <TextField
                                        label={t("agentModelLabel")}
                                        value={model}
                                        onChange={e => setModel(e.target.value)}
                                    />
                                </div>
                                <Button
                                    variant="tonal"
                                    size="s"
                                    icon={mdRefresh}
                                    disabled={fetchingModels}
                                    onClick={() => void handleFetchLatestModels()}
                                    className="shrink-0"
                                >
                                    {fetchingModels ? t("agentModelFetching") : t("agentModelFetchLatest")}
                                </Button>
                            </div>

                            {liveSource ? (
                                <div className="flex items-center justify-between gap-2">
                                    <span className="type-label-s text-on-surface-variant">
                                        {liveSource === "live"
                                            ? t("agentModelSourceLive", { count: displayedModels.length })
                                            : t("agentModelSourceCatalog")}
                                    </span>
                                </div>
                            ) : null}

                            {fetchNotice ? (
                                <p className="type-label-s text-on-surface-variant">{fetchNotice}</p>
                            ) : null}

                            {displayedModels.length > 0 ? (
                                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto py-0.5">
                                    {displayedModels.slice(0, 14).map(sm => (
                                        <Chip
                                            key={sm.id}
                                            variant="suggestion"
                                            selected={model === sm.id}
                                            onClick={() => setModel(sm.id)}
                                        >
                                            {sm.id}
                                        </Chip>
                                    ))}
                                </div>
                            ) : null}
                        </div>

                        <TextField
                            label={t("agentBaseUrlLabel")}
                            placeholder={t("agentBaseUrlPlaceholder")}
                            value={baseUrl}
                            onChange={e => setBaseUrl(e.target.value)}
                        />

                        {baseUrl.trim() || provider === "custom" ? (
                            <Select
                                label={t("agentApiProtocolLabel")}
                                value={apiProtocol}
                                onValueChange={val => setApiProtocol(val)}
                                options={API_PROTOCOL_OPTIONS}
                            />
                        ) : null}

                        {/* Codex-style 6-Level Thinking Effort */}
                        <div className="flex flex-col gap-1.5">
                            <span className="type-label-l text-on-surface">{t("agentThinkingLevelLabel")}</span>
                            <SegmentedButton
                                density={-1}
                                value={thinkingLevel}
                                onValueChange={val => setThinkingLevel(val)}
                                options={thinkingOptions}
                            />
                        </div>

                        {/* API Key */}
                        <div className="flex flex-col gap-1.5">
                            <TextField
                                label={t("agentApiKeyLabel")}
                                type="password"
                                placeholder={
                                    hasSavedKey && !clearApiKey
                                        ? t("agentApiKeySavedHint", { hint: savedKeyHint })
                                        : "sk-..."
                                }
                                value={apiKeyDraft}
                                onChange={e => {
                                    setApiKeyDraft(e.target.value);
                                    if (e.target.value) setClearApiKey(false);
                                }}
                            />
                            <div className="flex items-center justify-between gap-2">
                                {safeStorageAvailable ? (
                                    <span className="type-label-s inline-flex items-center gap-1 text-on-surface-variant">
                                        <Icon path={mdLock} size={14} className="text-primary" />
                                        {t("agentSafeStorageEncrypted")}
                                    </span>
                                ) : (
                                    <span />
                                )}
                                {hasSavedKey && !clearApiKey ? (
                                    <Button
                                        variant="text"
                                        size="xs"
                                        icon={mdDelete}
                                        onClick={() => setClearApiKey(true)}
                                    >
                                        {t("agentApiKeyClear")}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </>
                ) : (
                    <TextField
                        label={t("agentRpcCliPathLabel")}
                        placeholder="/usr/local/bin/agent-cli"
                        value={rpcCliPath}
                        onChange={e => setRpcCliPath(e.target.value)}
                    />
                )}

                {errorText ? (
                    <Banner tone="error">{errorText}</Banner>
                ) : null}
            </div>
        </Dialog>
    );
};
