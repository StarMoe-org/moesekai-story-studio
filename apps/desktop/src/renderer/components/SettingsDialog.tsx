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
    cn,
} from "@moesekai/story-editor/md3";
import {
    mdCheckCircle,
    mdDarkMode,
    mdDelete,
    mdInventory2,
    mdLightMode,
    mdLock,
    mdRefresh,
    mdSettings,
    mdWandStars,
} from "@moesekai/story-editor/md3/icons";
import type {
    AgentApiProtocol,
    AgentKnownProviderInfo,
    AgentMode,
    AgentModelOption,
    AgentProviderConfigPublic,
    AgentThinkingLevel,
    AssetCacheStats,
    DesktopAppSettings,
    DesktopStageRenderQuality,
    DesktopThemeMode,
    DesktopUiLocale,
} from "../../shared/ipc";
import { CHARACTER_THEME_SEEDS, DESKTOP_LOCALE_OPTIONS } from "../../shared/theme-seeds";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { AssetCachePanel } from "./AssetCachePanel";

export type SettingsDialogTab = "general" | "stage" | "agent";

const API_PROTOCOL_OPTIONS: Array<{ value: AgentApiProtocol; label: string }> = [
    { value: "openai-completions", label: "OpenAI Chat Completions" },
    { value: "openai-responses", label: "OpenAI Responses API" },
    { value: "anthropic-messages", label: "Anthropic Messages" },
    { value: "google-generative-ai", label: "Google Generative AI" },
];

/**
 * Crisp 18x12 inline flat vector flags so Windows/macOS/Linux render identically
 * without falling back to ASCII country letters. Traditional Chinese (`zh-TW`)
 * strictly uses the Hong Kong SAR crimson-red bauhinia flag.
 */
const LocaleFlagIcon: React.FC<{ locale: DesktopUiLocale }> = ({ locale }) => {
    switch (locale) {
        case "zh-CN":
            return (
                <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden className="shrink-0 rounded-[2px] border border-outline-variant/40">
                    <rect width="18" height="12" fill="#DE2910" />
                    <polygon points="3.6,1.8 4.1,3.3 5.6,3.3 4.4,4.2 4.8,5.7 3.6,4.8 2.4,5.7 2.8,4.2 1.6,3.3 3.1,3.3" fill="#FFDE00" />
                    <circle cx="6.8" cy="1.9" r="0.55" fill="#FFDE00" />
                    <circle cx="7.8" cy="3.1" r="0.55" fill="#FFDE00" />
                    <circle cx="7.8" cy="4.7" r="0.55" fill="#FFDE00" />
                    <circle cx="6.8" cy="5.9" r="0.55" fill="#FFDE00" />
                </svg>
            );
        case "zh-TW":
            // Hong Kong SAR flag: crimson red field with symmetric 5-petal white bauhinia
            return (
                <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden className="shrink-0 rounded-[2px] border border-outline-variant/40">
                    <rect width="18" height="12" fill="#DE2910" />
                    <g transform="translate(9 6)" fill="#FFFFFF">
                        <ellipse cx="0" cy="-2.2" rx="1.15" ry="2.1" transform="rotate(0)" />
                        <ellipse cx="0" cy="-2.2" rx="1.15" ry="2.1" transform="rotate(72)" />
                        <ellipse cx="0" cy="-2.2" rx="1.15" ry="2.1" transform="rotate(144)" />
                        <ellipse cx="0" cy="-2.2" rx="1.15" ry="2.1" transform="rotate(216)" />
                        <ellipse cx="0" cy="-2.2" rx="1.15" ry="2.1" transform="rotate(288)" />
                        <circle cx="0" cy="0" r="0.8" fill="#DE2910" />
                    </g>
                </svg>
            );
        case "en-US":
            return (
                <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden className="shrink-0 rounded-[2px] border border-outline-variant/40">
                    <rect width="18" height="12" fill="#FFFFFF" />
                    <rect y="0" width="18" height="1.7" fill="#B22234" />
                    <rect y="3.4" width="18" height="1.7" fill="#B22234" />
                    <rect y="6.8" width="18" height="1.7" fill="#B22234" />
                    <rect y="10.2" width="18" height="1.8" fill="#B22234" />
                    <rect width="8.5" height="6.8" fill="#3C3B6E" />
                    <circle cx="2.1" cy="1.8" r="0.5" fill="#FFFFFF" />
                    <circle cx="4.2" cy="1.8" r="0.5" fill="#FFFFFF" />
                    <circle cx="6.3" cy="1.8" r="0.5" fill="#FFFFFF" />
                    <circle cx="3.1" cy="3.4" r="0.5" fill="#FFFFFF" />
                    <circle cx="5.2" cy="3.4" r="0.5" fill="#FFFFFF" />
                    <circle cx="2.1" cy="5.0" r="0.5" fill="#FFFFFF" />
                    <circle cx="4.2" cy="5.0" r="0.5" fill="#FFFFFF" />
                    <circle cx="6.3" cy="5.0" r="0.5" fill="#FFFFFF" />
                </svg>
            );
        case "ja-JP":
            return (
                <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden className="shrink-0 rounded-[2px] border border-outline-variant/40">
                    <rect width="18" height="12" fill="#FFFFFF" />
                    <circle cx="9" cy="6" r="3.4" fill="#BC002D" />
                </svg>
            );
        case "ko-KR":
            return (
                <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden className="shrink-0 rounded-[2px] border border-outline-variant/40">
                    <rect width="18" height="12" fill="#FFFFFF" />
                    <path d="M 6.2 6 A 2.8 2.8 0 0 1 11.8 6 A 1.4 1.4 0 0 1 9 6 A 1.4 1.4 0 0 0 6.2 6 Z" fill="#CD2E3A" />
                    <path d="M 11.8 6 A 2.8 2.8 0 0 1 6.2 6 A 1.4 1.4 0 0 1 9 6 A 1.4 1.4 0 0 0 11.8 6 Z" fill="#0047A0" />
                    <rect x="2.2" y="2.0" width="2.4" height="0.8" transform="rotate(-32 3.4 2.4)" fill="#18181B" />
                    <rect x="13.4" y="2.0" width="2.4" height="0.8" transform="rotate(32 14.6 2.4)" fill="#18181B" />
                    <rect x="2.2" y="9.2" width="2.4" height="0.8" transform="rotate(32 3.4 9.6)" fill="#18181B" />
                    <rect x="13.4" y="9.2" width="2.4" height="0.8" transform="rotate(-32 14.6 9.6)" fill="#18181B" />
                </svg>
            );
    }
};

export interface SettingsDialogProps {
    open: boolean;
    initialTab: SettingsDialogTab;
    settings: DesktopAppSettings;
    cacheStats: AssetCacheStats | null;
    loadingCacheStats: boolean;
    onChangeThemeMode: (mode: DesktopThemeMode) => void;
    onChangeThemeSeed: (seed: string) => void;
    onChangeLocale: (locale: DesktopUiLocale) => void;
    onChangeStageRenderQuality: (quality: DesktopStageRenderQuality) => void;
    onRefreshCacheStats: () => void;
    onToggleCacheEnabled: (enabled: boolean) => void;
    onChangeCacheMaxMb: (mb: number) => void;
    onOpenCacheDir: () => void;
    onClearCache: () => void;
    onAgentConfigSaved: (config: AgentProviderConfigPublic) => void;
    onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
    open,
    initialTab,
    settings,
    cacheStats,
    loadingCacheStats,
    onChangeThemeMode,
    onChangeThemeSeed,
    onChangeLocale,
    onChangeStageRenderQuality,
    onRefreshCacheStats,
    onToggleCacheEnabled,
    onChangeCacheMaxMb,
    onOpenCacheDir,
    onClearCache,
    onAgentConfigSaved,
    onClose,
}) => {
    const locale = settings.locale;
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const [activeTab, setActiveTab] = useState<SettingsDialogTab>(initialTab);

    // Agent config draft state (loaded whenever dialog opens)
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
    const [savingAgent, setSavingAgent] = useState(false);
    const [agentErrorText, setAgentErrorText] = useState<string | null>(null);
    const [liveModels, setLiveModels] = useState<AgentModelOption[] | null>(null);
    const [liveSource, setLiveSource] = useState<"live" | "catalog" | null>(null);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [fetchNotice, setFetchNotice] = useState<string | null>(null);

    const loadSeqRef = useRef(0);
    const onRefreshCacheRef = useRef(onRefreshCacheStats);
    useEffect(() => {
        onRefreshCacheRef.current = onRefreshCacheStats;
    }, [onRefreshCacheStats]);

    useEffect(() => {
        if (open) {
            setActiveTab(initialTab);
        }
    }, [open, initialTab]);

    useEffect(() => {
        if (open && activeTab === "stage") {
            onRefreshCacheRef.current();
        }
    }, [open, activeTab]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const seq = ++loadSeqRef.current;
        setAgentErrorText(null);
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
                setAgentErrorText(err instanceof Error ? err.message : String(err));
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const activeSeed = useMemo(
        () => CHARACTER_THEME_SEEDS.find(s => s.id === settings.themeSeed) ?? CHARACTER_THEME_SEEDS[0],
        [settings.themeSeed],
    );

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
            if (res.error) setFetchNotice(res.error);
        } catch (err) {
            setFetchNotice(err instanceof Error ? err.message : String(err));
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSaveAgent = async () => {
        setSavingAgent(true);
        setAgentErrorText(null);
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
            setHasSavedKey(saved.hasApiKey);
            setSavedKeyHint(saved.apiKeyHint);
            setApiKeyDraft("");
            setClearApiKey(false);
            onAgentConfigSaved(saved);
            onClose();
        } catch (err) {
            setAgentErrorText(err instanceof Error ? err.message : String(err));
        } finally {
            setSavingAgent(false);
        }
    };

    return (
        <Dialog
            isOpen={open}
            onClose={() => !savingAgent && onClose()}
            title={t("settingsDialogTitle")}
            size="lg"
            className="max-w-[620px]"
            showClose
            syncHistory={false}
            actions={
                activeTab === "agent" ? (
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="text" size="s" onClick={onClose} disabled={savingAgent}>
                            {t("cancel")}
                        </Button>
                        <Button
                            variant="filled"
                            size="s"
                            icon={mdCheckCircle}
                            data-testid="settings-save-agent-btn"
                            onClick={() => void handleSaveAgent()}
                            disabled={savingAgent}
                        >
                            {t("agentSaveSettings")}
                        </Button>
                    </div>
                ) : (
                    <Button variant="filled" size="s" onClick={onClose}>
                        {t("close")}
                    </Button>
                )
            }
        >
            <div data-testid="settings-dialog" className="flex flex-col gap-3.5 py-0.5">
                <SegmentedButton<SettingsDialogTab>
                    density={-1}
                    value={activeTab}
                    onValueChange={nextTab => setActiveTab(nextTab)}
                    aria-label={t("settingsDialogTitle")}
                    options={[
                        { value: "general", label: t("settingsTabGeneral"), icon: mdSettings },
                        { value: "stage", label: t("settingsTabStage"), icon: mdInventory2 },
                        { value: "agent", label: t("settingsTabAgent"), icon: mdWandStars },
                    ]}
                />

                {/* TAB 1: Appearance & Language */}
                {activeTab === "general" ? (
                    <div data-testid="settings-tab-general" className="flex flex-col gap-3.5">
                        {/* 5-Locale Switcher with Crisp Inline SVG Flags (zh-TW strictly uses HK SAR flag) */}
                        <div className="flex flex-col gap-2 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3.5">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("languageLabel")}
                            </span>
                            <div data-testid="settings-locale-list" className="flex flex-wrap gap-1.5">
                                {DESKTOP_LOCALE_OPTIONS.map(opt => {
                                    const active = opt.code === locale;
                                    return (
                                        <button
                                            key={opt.code}
                                            type="button"
                                            data-testid={`settings-locale-${opt.code}`}
                                            onClick={() => onChangeLocale(opt.code)}
                                            className={cn(
                                                "state-layer focus-ring inline-flex cursor-pointer items-center gap-2 rounded-md3-full border px-3 py-1.5 type-label-m transition-colors",
                                                active
                                                    ? "border-primary bg-primary-container font-medium text-on-primary-container"
                                                    : "border-outline-variant/70 bg-surface-container text-on-surface hover:bg-surface-container-highest",
                                            )}
                                        >
                                            <LocaleFlagIcon locale={opt.code} />
                                            <span>{opt.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Light / Dark Mode */}
                        <div className="flex flex-col gap-2 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3.5">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("appearanceLabel")}
                            </span>
                            <SegmentedButton<DesktopThemeMode>
                                density={-1}
                                value={settings.themeMode}
                                onValueChange={val => onChangeThemeMode(val)}
                                options={[
                                    { value: "light", label: t("themeModeLight"), icon: mdLightMode },
                                    { value: "dark", label: t("themeModeDark"), icon: mdDarkMode },
                                ]}
                            />
                        </div>

                        {/* 26 Character Theme Seeds */}
                        <div className="flex flex-col gap-2 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="type-label-m font-medium text-on-surface-variant">
                                    {t("themeSeedLabel")}
                                </span>
                                <span className="type-label-m font-medium text-on-surface">
                                    {activeSeed.name}
                                </span>
                            </div>
                            <div className="grid grid-cols-9 gap-2 rounded-md3-md bg-surface-container p-2.5 sm:grid-cols-13">
                                {CHARACTER_THEME_SEEDS.map(seed => {
                                    const selected = seed.id === settings.themeSeed;
                                    return (
                                        <button
                                            key={seed.id}
                                            type="button"
                                            title={`${seed.name} · ${seed.unit}`}
                                            aria-label={seed.name}
                                            onClick={() => onChangeThemeSeed(seed.id)}
                                            className={cn(
                                                "focus-ring flex h-7 w-7 cursor-pointer items-center justify-center rounded-md3-full transition-transform hover:scale-110",
                                                selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface-container",
                                            )}
                                        >
                                            <span
                                                className="h-5 w-5 rounded-md3-full border border-outline-variant/60"
                                                style={{ backgroundColor: seed.hex }}
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* TAB 2: Stage Antialiasing & Local Asset Cache */}
                {activeTab === "stage" ? (
                    <div data-testid="settings-tab-stage" className="flex flex-col gap-3.5">
                        <div className="flex flex-col gap-2 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3.5">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("stageQualityLabel")}
                            </span>
                            <SegmentedButton<DesktopStageRenderQuality>
                                density={-1}
                                value={settings.stageRenderQuality}
                                onValueChange={val => onChangeStageRenderQuality(val)}
                                aria-label={t("stageQualityLabel")}
                                options={[
                                    { value: "standard", label: t("stageQualityStandard") },
                                    { value: "high", label: t("stageQualityHigh") },
                                    { value: "ultra", label: t("stageQualityUltra") },
                                ]}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("settingsLocalCacheLabel")}
                            </span>
                            <AssetCachePanel
                                locale={locale}
                                assetCacheEnabled={settings.assetCacheEnabled}
                                assetCacheMaxMb={settings.assetCacheMaxMb}
                                cacheStats={cacheStats}
                                loadingStats={loadingCacheStats}
                                showInlineActions={true}
                                onRefreshStats={onRefreshCacheStats}
                                onToggleEnabled={onToggleCacheEnabled}
                                onChangeMaxMb={onChangeCacheMaxMb}
                                onOpenCacheDir={onOpenCacheDir}
                                onClearCache={onClearCache}
                            />
                        </div>
                    </div>
                ) : null}

                {/* TAB 3: MoeSekai Agent Provider, Model & Credentials */}
                {activeTab === "agent" ? (
                    <div data-testid="settings-tab-agent" className="flex flex-col gap-3.5">
                        <div className="flex flex-col gap-1.5">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("agentModeLabel")}
                            </span>
                            <SegmentedButton<AgentMode>
                                density={-1}
                                value={mode}
                                onValueChange={val => setMode(val)}
                                options={[
                                    { value: "sdk", label: t("agentModeSdk") },
                                    { value: "rpc", label: t("agentModeRpc") },
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
                                        <span className="type-label-s text-on-surface-variant">
                                            {liveSource === "live"
                                                ? t("agentModelSourceLive", { count: displayedModels.length })
                                                : t("agentModelSourceCatalog")}
                                        </span>
                                    ) : null}

                                    {fetchNotice ? (
                                        <p className="type-label-s text-on-surface-variant">{fetchNotice}</p>
                                    ) : null}

                                    {displayedModels.length > 0 ? (
                                        <div className="flex max-h-[70px] flex-wrap gap-1.5 overflow-y-auto py-0.5">
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

                                <div className="flex flex-col gap-1.5">
                                    <span className="type-label-m font-medium text-on-surface-variant">
                                        {t("agentThinkingLevelLabel")}
                                    </span>
                                    <SegmentedButton<AgentThinkingLevel>
                                        density={-1}
                                        value={thinkingLevel}
                                        onValueChange={val => setThinkingLevel(val)}
                                        options={thinkingOptions}
                                    />
                                </div>

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

                        {agentErrorText ? <Banner tone="error">{agentErrorText}</Banner> : null}
                    </div>
                ) : null}
            </div>
        </Dialog>
    );
};
