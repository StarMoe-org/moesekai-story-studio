import React, { useMemo } from "react";
import {
    useStoryI18n,
    type EditorTopBarSlotContext,
    type PlayerLayoutMode,
    type PlayerTopBarSlotContext,
    type StoryEditorWorkspaceMode,
} from "@moesekai/story-editor";
import {
    Button,
    Icon,
    IconButton,
    Menu,
    SegmentedButton,
    Tooltip,
    cn,
    type MenuItemDef,
} from "@moesekai/story-editor/md3";
import {
    mdAdd,
    mdArrowBack,
    mdAutoStories,
    mdCode,
    mdDashboard,
    mdDownload,
    mdEdit,
    mdErrorFill,
    mdFolderOpen,
    mdHome,
    mdInventory2,
    mdKeyboardArrowDown,
    mdOpenInNew,
    mdPlayArrowFill,
    mdPlayCircle,
    mdRecordVoiceOver,
    mdSave,
    mdSettings,
    mdSync,
    mdTheaters,
    mdTranslate,
    mdUploadFile,
    mdWandStars,
    mdWarning,
} from "@moesekai/story-editor/md3/icons";
import type {
    AgentStatus,
    DesktopAppSettings,
    DesktopThemeMode,
    DesktopUiLocale,
} from "../../shared/ipc";
import { resolvePlatformChromeLayout } from "../../shared/window-chrome";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { AppearancePopover } from "./AppearancePopover";

function TopBarMenuTrigger({
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
                    className="desktop-no-drag state-layer focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-md3-sm px-2 type-label-m text-on-surface hover:bg-surface-container-high"
                >
                    <span>{label}</span>
                    <Icon path={mdKeyboardArrowDown} size={15} className="text-on-surface-variant" />
                </button>
            )}
        />
    );
}

/* ==========================================================================
   1. Welcome Screen Unified 44px Frameless Top Bar
   ========================================================================== */

export interface DesktopWelcomeTopBarProps {
    platform: NodeJS.Platform;
    isFullscreen?: boolean;
    settings: DesktopAppSettings;
    appVersion?: string;
    availableUpdateVersion?: string | null;
    onNewProject: () => void;
    onOpenFolder: () => void;
    onOpenMskFile: () => void;
    onOpenAgentSettings: () => void;
    onCheckForUpdates: () => void;
    onChangeThemeMode: (mode: DesktopThemeMode) => void;
    onChangeThemeSeed: (seed: string) => void;
    onChangeLocale: (locale: DesktopUiLocale) => void;
}

export const DesktopWelcomeTopBar: React.FC<DesktopWelcomeTopBarProps> = ({
    platform,
    isFullscreen = false,
    settings,
    appVersion,
    availableUpdateVersion,
    onNewProject,
    onOpenFolder,
    onOpenMskFile,
    onOpenAgentSettings,
    onCheckForUpdates,
    onChangeThemeMode,
    onChangeThemeSeed,
    onChangeLocale,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(settings.locale, key, vars);

    const fileMenuItems = useMemo<MenuItemDef[]>(
        () => [
            {
                key: "welcome-new",
                label: t("newProject"),
                icon: mdAdd,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+N</span>,
                onSelect: onNewProject,
            },
            {
                key: "welcome-open-folder",
                label: t("openFolder"),
                icon: mdFolderOpen,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+O</span>,
                onSelect: onOpenFolder,
            },
            {
                key: "welcome-open-msk",
                label: t("openMskFile"),
                icon: mdUploadFile,
                onSelect: onOpenMskFile,
            },
            {
                key: "welcome-agent-settings",
                label: t("agentSettingsTooltip"),
                icon: mdSettings,
                dividerBefore: true,
                onSelect: onOpenAgentSettings,
            },
            {
                key: "welcome-check-updates",
                label: t("checkForUpdates"),
                icon: mdSync,
                trailing: appVersion ? (
                    <span className="font-mono type-label-s text-on-surface-variant">
                        v{appVersion.replace(/^v/i, "")}
                    </span>
                ) : undefined,
                onSelect: onCheckForUpdates,
            },
        ],
        [appVersion, onCheckForUpdates, onNewProject, onOpenAgentSettings, onOpenFolder, onOpenMskFile, settings.locale],
    );

    const chrome = resolvePlatformChromeLayout(platform, isFullscreen);

    return (
        <header
            data-desktop-topbar="welcome"
            style={{ paddingLeft: `${chrome.leftInsetPx}px`, paddingRight: `${chrome.rightInsetPx}px` }}
            className={cn(
                "relative z-30 flex h-11 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b border-outline-variant/60 bg-surface-container-low select-none",
                chrome.draggableHeader && "desktop-drag-region",
            )}
        >
            <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md3-sm bg-primary-container text-on-primary-container">
                    <Icon path={mdAutoStories} size={15} />
                </span>
                <span className="type-title-s truncate pr-1 font-semibold tracking-tight text-on-surface">
                    {t("appName")}
                </span>
                <TopBarMenuTrigger label={t("studioFileMenu")} items={fileMenuItems} />
            </div>

            {/* Dedicated draggable blank spacer filling all middle space */}
            <div
                data-drag-spacer="center"
                className={cn("h-full min-w-[24px] flex-1", chrome.draggableHeader && "desktop-drag-region")}
            />

            <div className="flex shrink-0 items-center gap-1.5">
                {availableUpdateVersion ? (
                    <button
                        type="button"
                        data-testid="topbar-update-pill"
                        onClick={onCheckForUpdates}
                        className="desktop-no-drag state-layer focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md3-full border border-primary/50 bg-primary-container px-2.5 type-label-s font-medium text-on-primary-container transition-colors"
                    >
                        <span className="inline-block h-1.5 w-1.5 rounded-md3-full bg-primary" />
                        <span className="whitespace-nowrap">
                            {t("updateAvailableBadge", { version: availableUpdateVersion })}
                        </span>
                    </button>
                ) : null}
                <AppearancePopover
                    themeSeed={settings.themeSeed}
                    themeMode={settings.themeMode}
                    locale={settings.locale}
                    appVersion={appVersion}
                    availableUpdateVersion={availableUpdateVersion}
                    onCheckForUpdates={onCheckForUpdates}
                    onChangeThemeSeed={onChangeThemeSeed}
                    onChangeThemeMode={onChangeThemeMode}
                    onChangeLocale={onChangeLocale}
                />
            </div>
        </header>
    );
};

/* ==========================================================================
   2. Editor Unified Single 44px Frameless Top Bar (via slots.replaceTopBar)
   ========================================================================== */

export interface DesktopEditorTopBarProps {
    ctx: EditorTopBarSlotContext;
    platform: NodeJS.Platform;
    isFullscreen?: boolean;
    settings: DesktopAppSettings;
    appVersion?: string;
    availableUpdateVersion?: string | null;
    saveState: "saved" | "saving" | "dirty" | "error";
    agentStatus: AgentStatus;
    onBackToWelcome: () => void;
    onNewProject: () => void;
    onOpenFolder: () => void;
    onOpenMskFile: () => void;
    onSave: () => void;
    onOpenExport: () => void;
    onOpenExportBundle: () => void;
    onEnterTheater: () => void;
    onRevealProject: () => void;
    onOpenAgentSettings: () => void;
    onCheckForUpdates: () => void;
    onToggleAgentPanel: () => void;
    onChangeThemeMode: (mode: DesktopThemeMode) => void;
    onChangeThemeSeed: (seed: string) => void;
    onChangeLocale: (locale: DesktopUiLocale) => void;
}

export const DesktopEditorTopBar: React.FC<DesktopEditorTopBarProps> = ({
    ctx,
    platform,
    isFullscreen = false,
    settings,
    appVersion,
    availableUpdateVersion,
    saveState,
    agentStatus,
    onBackToWelcome,
    onNewProject,
    onOpenFolder,
    onOpenMskFile,
    onSave,
    onOpenExport,
    onOpenExportBundle,
    onEnterTheater,
    onRevealProject,
    onOpenAgentSettings,
    onCheckForUpdates,
    onToggleAgentPanel,
    onChangeThemeMode,
    onChangeThemeSeed,
    onChangeLocale,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(settings.locale, key, vars);

    const isPlaytest = ctx.workspaceMode === "playtest";

    // Merge Desktop workspace actions + non-duplicate StoryStudioEditor File items into ONE clean File menu.
    const unifiedFileMenuItems = useMemo<MenuItemDef[]>(() => {
        const byKey = new Map(ctx.fileMenuItems.map(item => [item.key, item]));
        const metaItem = byKey.get("meta");
        const i18nItem = byKey.get("i18n-packs");
        const voiceItem = byKey.get("load-voice-manifest");
        const importItem = byKey.get("import-msk");
        const copyItem = byKey.get("copy-msk");
        const preloadItem = byKey.get("preload");

        const items: MenuItemDef[] = [
            {
                key: "desk-new",
                label: t("newProject"),
                icon: mdAdd,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+N</span>,
                onSelect: onNewProject,
            },
            {
                key: "desk-open-folder",
                label: t("openFolder"),
                icon: mdFolderOpen,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+O</span>,
                onSelect: onOpenFolder,
            },
            {
                key: "desk-open-msk",
                label: t("openMskFile"),
                icon: mdUploadFile,
                onSelect: onOpenMskFile,
            },
            {
                key: "desk-save",
                label: t("save"),
                icon: mdSave,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+S</span>,
                dividerBefore: true,
                onSelect: onSave,
            },
            {
                key: "desk-export-msk",
                label: t("exportMsk"),
                icon: mdDownload,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+Shift+E</span>,
                onSelect: onOpenExport,
            },
            {
                key: "desk-export-bundle",
                label: t("exportModeBundleZipTitle"),
                icon: mdInventory2,
                onSelect: onOpenExportBundle,
            },
        ];

        if (copyItem) items.push({ ...copyItem, dividerBefore: false });
        if (importItem) items.push({ ...importItem, dividerBefore: false });

        if (metaItem) items.push({ ...metaItem, dividerBefore: true });
        if (i18nItem) items.push({ ...i18nItem, dividerBefore: !metaItem });
        if (voiceItem) items.push({ ...voiceItem, dividerBefore: false });
        if (preloadItem) items.push({ ...preloadItem, dividerBefore: false });

        items.push(
            {
                key: "desk-theater",
                label: t("playMode"),
                icon: mdPlayCircle,
                onSelect: onEnterTheater,
            },
            {
                key: "desk-reveal",
                label: t("revealInExplorer"),
                icon: mdOpenInNew,
                dividerBefore: true,
                onSelect: onRevealProject,
            },
            {
                key: "desk-agent-settings",
                label: t("agentSettingsTooltip"),
                icon: mdSettings,
                onSelect: onOpenAgentSettings,
            },
            {
                key: "desk-check-updates",
                label: t("checkForUpdates"),
                icon: mdSync,
                trailing: appVersion ? (
                    <span className="font-mono type-label-s text-on-surface-variant">
                        v{appVersion.replace(/^v/i, "")}
                    </span>
                ) : undefined,
                onSelect: onCheckForUpdates,
            },
            {
                key: "desk-close",
                label: t("closeWorkspace"),
                icon: mdHome,
                dividerBefore: true,
                onSelect: onBackToWelcome,
            },
        );

        return items;
    }, [
        appVersion,
        ctx.fileMenuItems,
        onBackToWelcome,
        onCheckForUpdates,
        onEnterTheater,
        onNewProject,
        onOpenAgentSettings,
        onOpenExport,
        onOpenExportBundle,
        onOpenFolder,
        onOpenMskFile,
        onRevealProject,
        onSave,
        settings.locale,
    ]);

    // Filter out web-only "immersive" toggle (Desktop is always full-window) and add MoeSekai Agent toggle.
    const unifiedViewMenuItems = useMemo<MenuItemDef[]>(() => {
        const filtered = ctx.viewMenuItems.filter(item => item.key !== "immersive");
        return [
            ...filtered,
            {
                key: "desk-toggle-agent",
                label: t("agentTitle"),
                icon: mdWandStars,
                selected: settings.agentPanelOpen,
                trailing: <span className="font-mono type-label-s text-on-surface-variant">Ctrl+Shift+A</span>,
                dividerBefore: true,
                onSelect: onToggleAgentPanel,
            },
        ];
    }, [ctx.viewMenuItems, onToggleAgentPanel, settings.agentPanelOpen, settings.locale]);

    const effectiveSaveState =
        saveState === "error" || ctx.saveStatus === "error"
            ? "error"
            : saveState === "saving" || ctx.saveStatus === "saving"
                ? "saving"
                : saveState === "dirty" || ctx.saveStatus === "dirty"
                    ? "dirty"
                    : "saved";

    const saveDotColor =
        effectiveSaveState === "error"
            ? "bg-error"
            : effectiveSaveState === "dirty" || effectiveSaveState === "saving"
                ? "bg-warning"
                : "bg-success";

    const saveLabel =
        effectiveSaveState === "saving"
            ? t("saving")
            : effectiveSaveState === "dirty"
                ? t("unsaved")
                : t("saved");

    const isAgentBusy =
        agentStatus === "starting" ||
        agentStatus === "thinking" ||
        agentStatus === "streaming" ||
        agentStatus === "tool_running";

    const chrome = resolvePlatformChromeLayout(platform, isFullscreen);

    return (
        <header
            data-desktop-topbar="editor"
            style={{ paddingLeft: `${chrome.leftInsetPx}px`, paddingRight: `${chrome.rightInsetPx}px` }}
            className={cn(
                "relative z-30 flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b bg-surface-container-low select-none transition-colors",
                isPlaytest ? "border-primary/45 bg-primary-container/10" : "border-outline-variant/60",
                chrome.draggableHeader && "desktop-drag-region",
            )}
        >
            {/* Left cluster: ONLY leaf interactive controls get .desktop-no-drag */}
            <div className="flex min-w-0 items-center gap-1">
                <div className="desktop-no-drag shrink-0">
                    <Tooltip side="bottom" label={t("backToWelcome")}>
                        <IconButton
                            variant="standard"
                            size="xs"
                            icon={mdHome}
                            label={t("backToWelcome")}
                            onClick={onBackToWelcome}
                        />
                    </Tooltip>
                </div>

                <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md3-sm bg-primary-container text-on-primary-container"
                    aria-hidden
                >
                    <Icon path={mdAutoStories} size={14} />
                </span>

                <nav aria-label={t("appName")} className="flex shrink-0 items-center gap-0.5">
                    <TopBarMenuTrigger label={t("studioFileMenu")} items={unifiedFileMenuItems} />
                    <TopBarMenuTrigger label={t("studioEditMenu")} items={ctx.editMenuItems} />
                    <TopBarMenuTrigger label={t("studioViewMenu")} items={unifiedViewMenuItems} />
                </nav>

                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-outline-variant/60" />

                <button
                    type="button"
                    disabled={isPlaytest}
                    onClick={ctx.openMetaDialog}
                    title={ctx.title}
                    className={cn(
                        "desktop-no-drag state-layer focus-ring flex min-w-0 items-center gap-1 rounded-md3-sm px-1.5 py-0.5 text-left",
                        isPlaytest ? "cursor-default" : "cursor-pointer",
                    )}
                >
                    <span className="max-w-[96px] truncate type-label-l font-medium text-on-surface lg:max-w-[140px] xl:max-w-[200px]">
                        {ctx.title}
                    </span>
                    <span className="hidden shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none text-on-surface-variant lg:inline">
                        {ctx.region}
                    </span>
                </button>

                {/* Single Clean Status Indicator (compact dot below xl to protect 1280px budget) */}
                {ctx.errorCount > 0 ? (
                    <button
                        type="button"
                        onClick={ctx.openIssuesDialog}
                        className="desktop-no-drag state-layer focus-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md3-full bg-error-container px-2 type-label-s text-on-error-container"
                    >
                        <Icon path={mdErrorFill} size={13} className="shrink-0" />
                        <span className="font-mono tabular-nums">{ctx.errorCount}</span>
                    </button>
                ) : ctx.warningCount > 0 ? (
                    <button
                        type="button"
                        onClick={ctx.openIssuesDialog}
                        className="desktop-no-drag state-layer focus-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md3-full bg-tertiary-container px-2 type-label-s text-on-tertiary-container"
                    >
                        <Icon path={mdWarning} size={13} className="shrink-0" />
                        <span className="font-mono tabular-nums">{ctx.warningCount}</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            if (effectiveSaveState === "dirty" || effectiveSaveState === "error") {
                                onSave();
                            } else {
                                ctx.openIssuesDialog();
                            }
                        }}
                        title={`${saveLabel} · ${t("compileReady")}`}
                        className="desktop-no-drag state-layer focus-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md3-full bg-surface-container px-2 type-label-s text-on-surface-variant hover:text-on-surface"
                    >
                        <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-md3-full", saveDotColor)} />
                        <span className="hidden whitespace-nowrap xl:inline">{saveLabel}</span>
                    </button>
                )}
            </div>

            {/* Draggable Left Spacer */}
            <div
                data-drag-spacer="left"
                className={cn("h-full min-w-[16px] flex-1", chrome.draggableHeader && "desktop-drag-region")}
            />

            {/* Center: Mode Switch (Edit | Playtest | Code) */}
            <div className="desktop-no-drag shrink-0">
                <SegmentedButton<StoryEditorWorkspaceMode>
                    density={-2}
                    value={ctx.workspaceMode}
                    onValueChange={ctx.setWorkspaceMode}
                    aria-label={t("modeEdit")}
                    className="w-auto shrink-0"
                    options={[
                        { value: "edit", label: t("modeEdit"), icon: mdEdit },
                        { value: "playtest", label: t("modePlaytest"), icon: mdPlayArrowFill },
                        { value: "code", label: t("modeCode"), icon: mdCode },
                    ]}
                />
            </div>

            {/* Draggable Right Spacer */}
            <div
                data-drag-spacer="right"
                className={cn("h-full min-w-[16px] flex-1", chrome.draggableHeader && "desktop-drag-region")}
            />

            {/* Right cluster: compact, strictly shrink-0, guaranteed unclipped at 1024px-1280px */}
            <div className="flex shrink-0 items-center gap-1">
                <div className="desktop-no-drag shrink-0">
                    <Tooltip side="bottom" label={t("i18nTooltip")}>
                        <IconButton
                            variant={ctx.attachedLocaleCount > 0 ? "tonal" : "standard"}
                            size="xs"
                            icon={mdTranslate}
                            label={t("i18nTooltip")}
                            disabled={isPlaytest}
                            onClick={ctx.openI18nDialog}
                        />
                    </Tooltip>
                </div>

                <div className="desktop-no-drag shrink-0">
                    <Tooltip side="bottom" label={t("voiceTooltip")}>
                        <IconButton
                            variant={ctx.hasVoiceManifest ? "tonal" : "standard"}
                            size="xs"
                            icon={mdRecordVoiceOver}
                            label={t("voiceTooltip")}
                            onClick={() => ctx.openVoiceManifestDialog("import")}
                        />
                    </Tooltip>
                </div>

                {availableUpdateVersion ? (
                    <div className="desktop-no-drag shrink-0">
                        <Tooltip side="bottom" label={t("updateAvailableBadge", { version: availableUpdateVersion })}>
                            <button
                                type="button"
                                data-testid="topbar-update-pill"
                                onClick={onCheckForUpdates}
                                className="state-layer focus-ring inline-flex h-7 items-center gap-1 rounded-md3-full border border-primary/50 bg-primary-container px-2 type-label-s font-medium text-on-primary-container transition-colors"
                            >
                                <span className="inline-block h-1.5 w-1.5 rounded-md3-full bg-primary" />
                                <span className="font-mono whitespace-nowrap">v{availableUpdateVersion}</span>
                            </button>
                        </Tooltip>
                    </div>
                ) : null}

                <AppearancePopover
                    themeSeed={settings.themeSeed}
                    themeMode={settings.themeMode}
                    locale={settings.locale}
                    appVersion={appVersion}
                    availableUpdateVersion={availableUpdateVersion}
                    onCheckForUpdates={onCheckForUpdates}
                    onChangeThemeSeed={onChangeThemeSeed}
                    onChangeThemeMode={onChangeThemeMode}
                    onChangeLocale={onChangeLocale}
                />

                <div className="desktop-no-drag shrink-0">
                    <Button
                        variant="filled"
                        size="xs"
                        icon={mdDownload}
                        onClick={onOpenExport}
                        className="px-2.5"
                    >
                        <span className="whitespace-nowrap">{t("exportMsk")}</span>
                    </Button>
                </div>

                <div className="desktop-no-drag shrink-0" data-testid="agent-toggle-btn">
                    <Tooltip side="bottom" label={t("agentToggleTooltip")}>
                        <Button
                            variant={settings.agentPanelOpen ? "tonal" : "outlined"}
                            size="xs"
                            icon={mdWandStars}
                            onClick={onToggleAgentPanel}
                            className="px-2.5"
                        >
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <span className="hidden lg:inline">{t("agentTitle")}</span>
                                <span className="lg:hidden">Agent</span>
                                {isAgentBusy ? (
                                    <span className="inline-block h-1.5 w-1.5 rounded-md3-full bg-primary animate-pulse" />
                                ) : null}
                            </span>
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </header>
    );
};

/* ==========================================================================
   3. Player Unified Single 44px Frameless Top Bar (via slots.replaceTopBar)
   ========================================================================== */

export interface DesktopPlayerTopBarProps {
    ctx: PlayerTopBarSlotContext;
    platform: NodeJS.Platform;
    isFullscreen?: boolean;
    settings: DesktopAppSettings;
    appVersion?: string;
    availableUpdateVersion?: string | null;
    onBackToEditor: () => void;
    onOpenExport: () => void;
    onCheckForUpdates: () => void;
    onChangeThemeMode: (mode: DesktopThemeMode) => void;
    onChangeThemeSeed: (seed: string) => void;
    onChangeLocale: (locale: DesktopUiLocale) => void;
}

export const DesktopPlayerTopBar: React.FC<DesktopPlayerTopBarProps> = ({
    ctx,
    platform,
    isFullscreen = false,
    settings,
    appVersion,
    availableUpdateVersion,
    onBackToEditor,
    onOpenExport,
    onCheckForUpdates,
    onChangeThemeMode,
    onChangeThemeSeed,
    onChangeLocale,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(settings.locale, key, vars);
    const { t: tStudio } = useStoryI18n();
    const chrome = resolvePlatformChromeLayout(platform, isFullscreen);

    return (
        <header
            data-desktop-topbar="player"
            style={{ paddingLeft: `${chrome.leftInsetPx}px`, paddingRight: `${chrome.rightInsetPx}px` }}
            className={cn(
                "relative z-30 flex h-11 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b border-outline-variant/60 bg-surface-container-low select-none",
                chrome.draggableHeader && "desktop-drag-region",
            )}
        >
            <div className="flex min-w-0 items-center gap-1.5">
                <div className="desktop-no-drag shrink-0">
                    <Button
                        variant="tonal"
                        size="xs"
                        icon={mdArrowBack}
                        onClick={onBackToEditor}
                    >
                        {t("editMode")}
                    </Button>
                </div>
                <span aria-hidden className="h-4 w-px shrink-0 bg-outline-variant/60" />
                <span className="max-w-[140px] truncate type-label-l font-medium text-on-surface xl:max-w-[220px]">
                    {ctx.title}
                </span>
                {ctx.region ? (
                    <span className="hidden shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none text-on-surface-variant lg:inline">
                        {ctx.region}
                    </span>
                ) : null}
            </div>

            <div
                data-drag-spacer="left"
                className={cn("h-full min-w-[16px] flex-1", chrome.draggableHeader && "desktop-drag-region")}
            />

            <div className="desktop-no-drag shrink-0">
                <SegmentedButton<PlayerLayoutMode>
                    density={-2}
                    value={ctx.layoutMode}
                    onValueChange={ctx.setLayoutMode}
                    aria-label={tStudio("page.storyMaker.nle.layoutWorkspace")}
                    className="w-auto shrink-0"
                    options={[
                        { value: "workspace", label: tStudio("page.storyMaker.nle.layoutWorkspace"), icon: mdDashboard },
                        { value: "theater", label: tStudio("page.storyMaker.nle.layoutTheater"), icon: mdTheaters },
                    ]}
                />
            </div>

            <div
                data-drag-spacer="right"
                className={cn("h-full min-w-[16px] flex-1", chrome.draggableHeader && "desktop-drag-region")}
            />

            <div className="flex shrink-0 items-center gap-1">
                <div className="desktop-no-drag shrink-0">
                    <Tooltip side="bottom" label={t("voiceTooltip")}>
                        <IconButton
                            size="xs"
                            variant={ctx.hasVoiceManifest ? "tonal" : "standard"}
                            icon={mdRecordVoiceOver}
                            label={t("voiceTooltip")}
                            onClick={ctx.openVoiceManifestDialog}
                        />
                    </Tooltip>
                </div>
                <div className="desktop-no-drag shrink-0">
                    <Tooltip side="bottom" label={t("i18nTooltip")}>
                        <IconButton
                            size="xs"
                            icon={mdTranslate}
                            label={t("i18nTooltip")}
                            onClick={ctx.openLocalePackPicker}
                        />
                    </Tooltip>
                </div>
                {availableUpdateVersion ? (
                    <div className="desktop-no-drag shrink-0">
                        <Tooltip side="bottom" label={t("updateAvailableBadge", { version: availableUpdateVersion })}>
                            <button
                                type="button"
                                data-testid="topbar-update-pill"
                                onClick={onCheckForUpdates}
                                className="state-layer focus-ring inline-flex h-7 items-center gap-1 rounded-md3-full border border-primary/50 bg-primary-container px-2 type-label-s font-medium text-on-primary-container transition-colors"
                            >
                                <span className="inline-block h-1.5 w-1.5 rounded-md3-full bg-primary" />
                                <span className="font-mono whitespace-nowrap">v{availableUpdateVersion}</span>
                            </button>
                        </Tooltip>
                    </div>
                ) : null}

                <AppearancePopover
                    themeSeed={settings.themeSeed}
                    themeMode={settings.themeMode}
                    locale={settings.locale}
                    appVersion={appVersion}
                    availableUpdateVersion={availableUpdateVersion}
                    onCheckForUpdates={onCheckForUpdates}
                    onChangeThemeSeed={onChangeThemeSeed}
                    onChangeThemeMode={onChangeThemeMode}
                    onChangeLocale={onChangeLocale}
                />
                <div className="desktop-no-drag shrink-0">
                    <Button
                        variant="filled"
                        size="xs"
                        icon={mdDownload}
                        onClick={onOpenExport}
                        className="px-2.5"
                    >
                        {t("exportMsk")}
                    </Button>
                </div>
            </div>
        </header>
    );
};
