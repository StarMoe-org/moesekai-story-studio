import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    configureStoryCore,
    createStarterStoryFromScript,
    DEFAULT_STORY_CORE_CONFIG,
    DESKTOP_STORY_WORKSPACE_CAPABILITIES,
    parseStoryScript,
    serializeStoryScript,
    type StarterLocale,
    type StoryDocument,
    type StoryLocalePack,
    type StoryVoiceManifest,
    type UiLocale,
} from "@moesekai/story-core";
import {
    clampAgentPanelWidth,
    DEFAULT_AGENT_PANEL_WIDTH,
    getMaxAgentPanelWidth,
    MIN_AGENT_PANEL_WIDTH,
} from "../shared/agent-panel-state";
import { buildNewProjectDocument, type NewProjectTemplate } from "../shared/new-project";
import {
    StoryStudioEditor,
    StoryStudioPlayer,
    StoryStudioProvider,
    type StoryEditorWorkspaceMode,
    type StoryStudioEditorHandle,
} from "@moesekai/story-editor";
import { Snackbar, cn } from "@moesekai/story-editor/md3";
import type {
    AgentPresetId,
    AgentProviderConfigPublic,
    AgentStatus,
    AssetCacheStats,
    DesktopAppInfo,
    DesktopAppSettings,
    DesktopStageRenderQuality,
    DesktopStoryRegion,
    DesktopThemeMode,
    DesktopUiLocale,
    DesktopUpdateCheckResult,
    MenuCommand,
    RecentProjectEntry,
    UpdateChannel,
    WorkspaceProjectData,
    WorkspaceSnapshotInfo,
} from "../shared/ipc";
import { shouldNotifyUpdate } from "../shared/updater";
import {
    createElectronStoryExportAdapter,
    createElectronStoryStorageAdapter,
} from "./adapters/electronStoryAdapter";
import { AboutNoticesDialog } from "./components/AboutNoticesDialog";
import { AssetCacheDialog } from "./components/AssetCacheDialog";
import {
    DesktopEditorTopBar,
    DesktopPlayerTopBar,
    DesktopWelcomeTopBar,
} from "./components/DesktopTopBar";
import { ExportMskDialog, type ExportDialogMode } from "./components/ExportMskDialog";
import { PiAgentPanel, type PiAgentPanelHandle } from "./components/PiAgentPanel";
import { SettingsDialog, type SettingsDialogTab } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { WorkspaceWelcome } from "./components/WorkspaceWelcome";
import { formatDesktopMessage } from "./i18n/desktopMessages";

const CACHED_CUBISM_CORE_URL = "moesekai-cache://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

function applyDesktopStoryCoreCacheRouting(enabled: boolean): void {
    if (enabled) {
        configureStoryCore({
            assetDomainMain: "moesekai-cache://storage.pjsk.moe",
            assetDomainBackup: "moesekai-cache://storage.exmeaning.com",
            masterDataDomainMain: "moesekai-cache://metadata.pjsk.moe",
            masterDataDomainBackup: "moesekai-cache://metadata.exmeaning.com",
            moeStaticBaseUrl: "moesekai-cache://moe.exmeaning.com",
            live2dLibraryBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/",
            live2dIndexBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-live2d/",
            live2dCoreUrl: CACHED_CUBISM_CORE_URL,
            sseWebSite: "moesekai-cache://storage.pjsk.moe/",
        });
    } else {
        configureStoryCore({
            assetDomainMain: DEFAULT_STORY_CORE_CONFIG.assetDomainMain,
            assetDomainBackup: DEFAULT_STORY_CORE_CONFIG.assetDomainBackup,
            masterDataDomainMain: DEFAULT_STORY_CORE_CONFIG.masterDataDomainMain,
            masterDataDomainBackup: DEFAULT_STORY_CORE_CONFIG.masterDataDomainBackup,
            moeStaticBaseUrl: DEFAULT_STORY_CORE_CONFIG.moeStaticBaseUrl,
            live2dLibraryBase: DEFAULT_STORY_CORE_CONFIG.live2dLibraryBase,
            live2dIndexBase: DEFAULT_STORY_CORE_CONFIG.live2dIndexBase,
            live2dCoreUrl: DEFAULT_STORY_CORE_CONFIG.live2dCoreUrl,
            sseWebSite: DEFAULT_STORY_CORE_CONFIG.sseWebSite,
        });
    }
}

// Configure persistent `moesekai-cache://` routing BEFORE any editor/player mounts.
applyDesktopStoryCoreCacheRouting(true);

const DEFAULT_SETTINGS: DesktopAppSettings = {
    themeSeed: "21",
    themeMode: "light",
    locale: "zh-CN",
    assetLine: "main",
    agentPanelOpen: true,
    agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
    updateChannel: "auto",
    autoCheckUpdates: true,
    ignoredUpdateVersion: null,
    assetCacheEnabled: true,
    assetCacheMaxMb: 2048,
    stageRenderQuality: "high",
};

function parseProjectDoc(project: WorkspaceProjectData): StoryDocument | null {
    const parsed = parseStoryScript(project.script);
    if (!parsed.ok) return null;
    return {
        ...parsed.doc,
        id: project.id,
        locales: {
            ...(parsed.doc.locales ?? {}),
            ...(project.locales as Partial<Record<UiLocale, StoryLocalePack>>),
        },
    };
}

export const App: React.FC = () => {
    const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [settings, setSettings] = useState<DesktopAppSettings>(DEFAULT_SETTINGS);
    const [project, setProject] = useState<WorkspaceProjectData | null>(null);
    const [projectSessionSeq, setProjectSessionSeq] = useState<number>(0);
    const [activeDoc, setActiveDoc] = useState<StoryDocument | null>(null);
    const [liveScript, setLiveScript] = useState<string>("");
    const [voiceManifest, setVoiceManifest] = useState<StoryVoiceManifest | null>(null);
    const [snapshots, setSnapshots] = useState<WorkspaceSnapshotInfo[]>([]);
    const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
    const [viewMode, setViewMode] = useState<"welcome" | "editor" | "player">("welcome");
    const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
    const [selection, setSelection] = useState<{ nodeId: string | null; beatId: string | null }>({
        nodeId: null,
        beatId: null,
    });
    const [editorMode, setEditorMode] = useState<StoryEditorWorkspaceMode>("edit");

    // Dialogs
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [exportDialogMode, setExportDialogMode] = useState<ExportDialogMode>("msk");
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [settingsDialogTab, setSettingsDialogTab] = useState<SettingsDialogTab>("general");
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
    const [noticesDialogOpen, setNoticesDialogOpen] = useState(false);
    const [updateChecking, setUpdateChecking] = useState(false);
    const [updateResult, setUpdateResult] = useState<DesktopUpdateCheckResult | null>(null);
    const [cacheStats, setCacheStats] = useState<AssetCacheStats | null>(null);
    const [loadingCacheStats, setLoadingCacheStats] = useState(false);

    // MoeSekai Agent state
    const [agentConfig, setAgentConfig] = useState<AgentProviderConfigPublic | null>(null);
    const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
    const [externalPresetTrigger, setExternalPresetTrigger] = useState<{
        preset: AgentPresetId;
        nonce: number;
    } | null>(null);

    // Resizable Agent side panel state
    const [viewportWidth, setViewportWidth] = useState<number>(() =>
        typeof window !== "undefined" ? window.innerWidth : 1366,
    );
    const [liveAgentWidth, setLiveAgentWidth] = useState<number>(DEFAULT_AGENT_PANEL_WIDTH);
    const [isResizingAgent, setIsResizingAgent] = useState<boolean>(false);

    const [snack, setSnack] = useState<string | null>(null);

    const editorRef = useRef<StoryStudioEditorHandle | null>(null);
    const agentPanelRef = useRef<PiAgentPanelHandle | null>(null);
    const agentResizeDragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
    const liveAgentWidthRef = useRef<number>(DEFAULT_AGENT_PANEL_WIDTH);
    const projectRef = useRef<WorkspaceProjectData | null>(null);
    const voiceManifestRef = useRef<StoryVoiceManifest | null>(null);
    const localeRef = useRef<DesktopUiLocale>(settings.locale);

    useEffect(() => {
        const onResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        if (!isResizingAgent) {
            setLiveAgentWidth(settings.agentPanelWidth);
            liveAgentWidthRef.current = settings.agentPanelWidth;
        }
    }, [isResizingAgent, settings.agentPanelWidth]);

    // Ensure body selection / resize cursor are always restored on unmount
    useEffect(() => {
        return () => {
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
    }, []);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        voiceManifestRef.current = voiceManifest;
    }, [voiceManifest]);

    useEffect(() => {
        localeRef.current = settings.locale;
    }, [settings.locale]);

    // Sync MD3 Dynamic Color seed + light/dark scheme onto <html>
    useEffect(() => {
        const root = document.documentElement;
        root.dataset.seed = settings.themeSeed;
        root.dataset.theme = settings.themeMode;
        root.lang = settings.locale;
    }, [settings.themeSeed, settings.themeMode, settings.locale]);

    // Sync persistent `moesekai-cache://` routing whenever user toggles local asset cache
    useEffect(() => {
        applyDesktopStoryCoreCacheRouting(settings.assetCacheEnabled);
    }, [settings.assetCacheEnabled]);

    const applyOpenedProject = useCallback((proj: WorkspaceProjectData) => {
        projectRef.current = proj;
        setProject(proj);
        setProjectSessionSeq(seq => seq + 1);
        setLiveScript(proj.script);
        setSnapshots(proj.snapshots);
        setVoiceManifest((proj.voiceManifest as StoryVoiceManifest | null) ?? null);
        const parsed = parseProjectDoc(proj);
        setActiveDoc(parsed);
        setSelection({ nodeId: null, beatId: null });
        setEditorMode("edit");
        setAgentStatus("idle");
        setSaveState("saved");
        setViewMode("editor");
        void window.moesekaiDesktop.workspace.listRecent().then(setRecentProjects).catch(() => {});
    }, []);

    // Initial bootstrap (runs once on mount)
    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            window.moesekaiDesktop.app.getInfo(),
            window.moesekaiDesktop.app.getSettings(),
            window.moesekaiDesktop.workspace.listRecent(),
            window.moesekaiDesktop.workspace.getActive(),
            window.moesekaiDesktop.agent.getConfig(),
            window.moesekaiDesktop.agent.getStatus(),
        ])
            .then(([info, loadedSettings, recent, activeProj, agCfg, agStatus]) => {
                if (cancelled) return;
                setAppInfo(info);
                setIsFullscreen(Boolean(info.isFullscreen));
                setSettings(loadedSettings);
                setRecentProjects(recent);
                setAgentConfig(agCfg);
                setAgentStatus(agStatus.status);
                if (activeProj) {
                    applyOpenedProject(activeProj);
                }
            })
            .catch(err => {
                if (cancelled) return;
                setSnack(err instanceof Error ? err.message : String(err));
            });

        const unsubFullscreen = window.moesekaiDesktop.app.onFullscreenChange(next => {
            if (!cancelled) setIsFullscreen(next);
        });

        const unsubUpdates = window.moesekaiDesktop.updates.onUpdateAvailable(res => {
            if (!cancelled) setUpdateResult(res);
        });

        return () => {
            cancelled = true;
            unsubFullscreen();
            unsubUpdates();
        };
    }, [applyOpenedProject]);

    const persistSettings = useCallback((patch: Partial<DesktopAppSettings>) => {
        setSettings(prev => ({ ...prev, ...patch }));
        void window.moesekaiDesktop.app.updateSettings(patch).then(setSettings).catch(() => {});
    }, []);

    const runUpdateCheck = useCallback(async (channelOverride?: UpdateChannel) => {
        setUpdateChecking(true);
        try {
            const res = await window.moesekaiDesktop.updates.check({
                channel: channelOverride,
                manual: true,
            });
            setUpdateResult(res);
        } catch (err) {
            setUpdateResult({
                status: "error",
                currentVersion: appInfo?.version ?? "0.1.0",
                latestVersion: null,
                source: channelOverride === "github" ? "github" : "cnb",
                fallbackUsed: false,
                releaseName: "",
                releaseNotes: "",
                publishedAt: null,
                releasePageUrl: "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/latest",
                alternateReleasePageUrl: "https://github.com/StarMoe-org/moesekai-story-studio/releases/latest",
                downloadUrl: null,
                assetName: null,
                assetSize: null,
                checkedAt: Date.now(),
                errorMessage: err instanceof Error ? err.message : String(err),
            });
        } finally {
            setUpdateChecking(false);
        }
    }, [appInfo?.version]);

    const handleRefreshCacheStats = useCallback(async () => {
        setLoadingCacheStats(true);
        try {
            const stats = await window.moesekaiDesktop.cache.getStats();
            setCacheStats(stats);
        } catch {
            // Non-fatal
        } finally {
            setLoadingCacheStats(false);
        }
    }, []);

    const closeAllDialogs = useCallback(() => {
        setExportDialogOpen(false);
        setSettingsDialogOpen(false);
        setUpdateDialogOpen(false);
        setCacheDialogOpen(false);
        setNoticesDialogOpen(false);
    }, []);

    const handleOpenSettings = useCallback((tab: SettingsDialogTab = "general") => {
        closeAllDialogs();
        setSettingsDialogTab(tab);
        setSettingsDialogOpen(true);
    }, [closeAllDialogs]);

    const handleOpenUpdateDialog = useCallback(() => {
        closeAllDialogs();
        setUpdateDialogOpen(true);
        void runUpdateCheck();
    }, [closeAllDialogs, runUpdateCheck]);

    const handleOpenCacheDialog = useCallback(() => {
        closeAllDialogs();
        setCacheDialogOpen(true);
    }, [closeAllDialogs]);

    const handleOpenNoticesDialog = useCallback(() => {
        closeAllDialogs();
        setNoticesDialogOpen(true);
    }, [closeAllDialogs]);

    const handleOpenUpdateDownload = useCallback((url: string) => {
        void window.moesekaiDesktop.updates.openDownload(url).catch(err => {
            setSnack(err instanceof Error ? err.message : String(err));
        });
    }, []);

    const handleOpenExternal = useCallback((url: string) => {
        void window.moesekaiDesktop.app.openExternal(url).catch(err => {
            setSnack(err instanceof Error ? err.message : String(err));
        });
    }, []);

    const handleIgnoreUpdateVersion = useCallback(async (version: string) => {
        try {
            const updated = await window.moesekaiDesktop.updates.ignoreVersion(version);
            setSettings(updated);
            setUpdateDialogOpen(false);
            setSnack(formatDesktopMessage(localeRef.current, "updateVersionIgnoredNotice", { version }));
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const handleToggleCacheEnabled = useCallback(async (enabled: boolean) => {
        try {
            const stats = await window.moesekaiDesktop.cache.setEnabled(enabled);
            setCacheStats(stats);
            setSettings(prev => ({ ...prev, assetCacheEnabled: stats.enabled }));
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const handleChangeCacheMaxMb = useCallback(async (mb: number) => {
        try {
            const stats = await window.moesekaiDesktop.cache.setMaxMb(mb);
            setCacheStats(stats);
            setSettings(prev => ({ ...prev, assetCacheMaxMb: stats.maxMb }));
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const handleOpenCacheDir = useCallback(() => {
        void window.moesekaiDesktop.cache.openDir().catch(err => {
            setSnack(err instanceof Error ? err.message : String(err));
        });
    }, []);

    const handleClearCache = useCallback(async () => {
        setLoadingCacheStats(true);
        try {
            const stats = await window.moesekaiDesktop.cache.clear();
            setCacheStats(stats);
            setSnack(formatDesktopMessage(localeRef.current, "cacheClearedNotice"));
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        } finally {
            setLoadingCacheStats(false);
        }
    }, []);

    const handleCreateProject = useCallback(
        async (input: { title: string; region: DesktopStoryRegion; template: NewProjectTemplate }) => {
            const loc = localeRef.current;
            const built = buildNewProjectDocument({
                title: input.title,
                region: input.region,
                locale: loc,
                template: input.template,
            });
            const created = await window.moesekaiDesktop.workspace.pickAndCreate({
                title: input.title,
                region: input.region,
                initialScript: built.script,
                sourceLocale: loc,
            });
            if (created) {
                applyOpenedProject(created);
            }
        },
        [applyOpenedProject],
    );

    const handleOpenStarterDemo = useCallback(async () => {
        const loc = localeRef.current;
        const starterLocale: StarterLocale =
            loc === "en-US" || loc === "ko-KR" ? "en" : loc === "ja-JP" ? "ja" : "zh";
        const baseStarter = createStarterStoryFromScript("jp", starterLocale);
        const starterDoc: StoryDocument = {
            ...baseStarter,
            sourceLocale: loc,
        };
        const initialScript = serializeStoryScript(starterDoc);
        const opened = await window.moesekaiDesktop.workspace.openStarterDemo({
            title: starterDoc.meta.title || "Starter Story",
            region: starterDoc.region,
            initialScript,
            sourceLocale: loc,
        });
        applyOpenedProject(opened);
    }, [applyOpenedProject]);

    // Expose deterministic visual-capture hook used only by `scripts/capture-ui.ts`
    useEffect(() => {
        window.__moesekaiCaptureHook = {
            setTheme: mode => persistSettings({ themeMode: mode }),
            openCreateDialog: () => {
                setViewMode("welcome");
                setCreateDialogOpen(true);
            },
            closeCreateDialog: () => setCreateDialogOpen(false),
            openStarterDemo: () => handleOpenStarterDemo(),
            openExportDialog: () => {
                setExportDialogMode("msk");
                setExportDialogOpen(true);
            },
            focusClimaxTalkBeat: () => {
                const doc = editorRef.current?.getCurrentDoc();
                if (!doc) return null;
                const scenes = Object.values(doc.nodes).filter(n => n.type === "scene");
                // Prefer a scene with multiple stage actors and a talk beat that specifies motion/facial clips.
                const preferred =
                    scenes.find(s => s.id.includes("climax") && s.beats.some(b => b.kind === "talk" && b.speakerKey)) ??
                    scenes.find(s => s.beats.some(b => b.kind === "talk" && b.speakerKey && (b.motion || b.facial))) ??
                    scenes.find(s => s.beats.some(b => b.kind === "talk" && b.speakerKey));
                if (!preferred) return null;
                const talkBeat =
                    preferred.beats.find(b => b.kind === "talk" && b.speakerKey && (b.motion || b.facial)) ??
                    preferred.beats.find(b => b.kind === "talk" && b.speakerKey);
                if (!talkBeat) return null;
                editorRef.current?.selectBeat(preferred.id, talkBeat.id);
                return { nodeId: preferred.id, beatId: talkBeat.id };
            },
            injectAgentPreviewFixture: () => {
                if (!agentPanelRef.current) return false;
                const doc = editorRef.current?.getCurrentDoc();
                const climax = doc
                    ? Object.values(doc.nodes).find(n => n.type === "scene" && n.id.includes("climax"))?.id ??
                      Object.values(doc.nodes).find(n => n.type === "scene")?.id
                    : undefined;
                agentPanelRef.current.loadPreviewFixture(climax);
                return true;
            },
            setAgentHistoryDrawerOpen: (open: boolean, tab?: "conversations" | "snapshots") => {
                if (!agentPanelRef.current) return false;
                agentPanelRef.current.setHistoryDrawerOpen(open, tab);
                return true;
            },
            openSettingsDialog: (tab: SettingsDialogTab = "general") => {
                closeAllDialogs();
                setSettingsDialogTab(tab);
                setSettingsDialogOpen(true);
            },
            openUpdateDialogPreview: () => {
                closeAllDialogs();
                setUpdateChecking(false);
                setUpdateResult({
                    status: "update-available",
                    currentVersion: appInfo?.version ?? "0.1.2",
                    latestVersion: "0.2.0",
                    source: "cnb",
                    fallbackUsed: false,
                    releaseName: "MoeSekai Story Studio v0.2.0",
                    releaseNotes: [
                        "### 本次更新亮点",
                        "",
                        "- **Live2D 层级 (`z`) 与抗锯齿渲染**：默认开启高清 SSAA 抗锯齿，支持在偏好设置中随时切换画质。",
                        "- **本地常态资源缓存 (`moesekai-cache://`)**：自动缓存 Live2D 模型、动作、背景与音频，重启即秒开。",
                        "- **CNB 国内高速更新源**：默认优先从 CNB 检查新版本，网络波动时自动静默回退 GitHub。",
                    ].join("\n"),
                    publishedAt: "2026-11-23T10:00:00Z",
                    releasePageUrl: "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/tag/v0.2.0",
                    alternateReleasePageUrl: "https://github.com/StarMoe-org/moesekai-story-studio/releases/tag/v0.2.0",
                    downloadUrl: "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/download/v0.2.0/MoeSekai%20Story%20Studio%20Setup%200.2.0.exe",
                    assetName: "MoeSekai Story Studio Setup 0.2.0.exe",
                    assetSize: 114_122_578,
                    checkedAt: Date.now(),
                });
                setUpdateDialogOpen(true);
            },
            openCacheDialog: () => {
                closeAllDialogs();
                setCacheDialogOpen(true);
            },
            openNoticesDialog: () => {
                closeAllDialogs();
                setNoticesDialogOpen(true);
            },
            closeAllDialogs: () => {
                closeAllDialogs();
            },
            switchToPlaytestMode: () => {
                closeAllDialogs();
                setViewMode("editor");
                editorRef.current?.setWorkspaceMode("playtest");
            },
            setAgentPanelWidth: (width: number) => {
                const clamped = clampAgentPanelWidth(width, window.innerWidth);
                liveAgentWidthRef.current = clamped;
                setLiveAgentWidth(clamped);
                persistSettings({ agentPanelWidth: clamped, agentPanelOpen: true });
                return clamped;
            },
        };
        return () => {
            delete window.__moesekaiCaptureHook;
        };
    }, [appInfo?.version, closeAllDialogs, handleOpenStarterDemo, persistSettings]);

    const handleOpenFolder = useCallback(async () => {
        try {
            const opened = await window.moesekaiDesktop.workspace.openFolderDialog();
            if (opened) applyOpenedProject(opened);
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, [applyOpenedProject]);

    const handleOpenMskFile = useCallback(async () => {
        try {
            const opened = await window.moesekaiDesktop.workspace.openMskDialog();
            if (opened) applyOpenedProject(opened);
        } catch (err) {
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, [applyOpenedProject]);

    const handleOpenPath = useCallback(
        async (targetPath: string) => {
            try {
                const opened = await window.moesekaiDesktop.workspace.openPath(targetPath);
                applyOpenedProject(opened);
            } catch (err) {
                setSnack(err instanceof Error ? err.message : String(err));
            }
        },
        [applyOpenedProject],
    );

    const handleSaveDoc = useCallback(async (doc: StoryDocument) => {
        const currentProj = projectRef.current;
        if (!currentProj || (doc.id && doc.id !== currentProj.id)) {
            return;
        }
        setSaveState("saving");
        try {
            const script = serializeStoryScript(doc);
            const locales: Record<string, unknown> = {};
            if (doc.locales) {
                for (const [k, pack] of Object.entries(doc.locales)) {
                    if (pack) locales[k] = pack;
                }
            }
            await window.moesekaiDesktop.workspace.save({
                script,
                locales,
                voiceManifest: voiceManifestRef.current,
            });
            if (projectRef.current?.id !== currentProj.id) return;
            setActiveDoc(doc);
            setLiveScript(script);
            setSaveState("saved");
        } catch (err) {
            if (projectRef.current?.id !== currentProj.id) return;
            setSaveState("error");
            setSnack(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const handleManualSave = useCallback(async () => {
        if (editorRef.current) {
            await editorRef.current.saveNow();
            setSnack(formatDesktopMessage(localeRef.current, "saveSuccessNotice"));
            return;
        }
        if (activeDoc) {
            await handleSaveDoc(activeDoc);
            setSnack(formatDesktopMessage(localeRef.current, "saveSuccessNotice"));
        }
    }, [activeDoc, handleSaveDoc]);

    const handleCloseProject = useCallback(async () => {
        projectRef.current = null;
        await window.moesekaiDesktop.workspace.close();
        setProject(null);
        setProjectSessionSeq(seq => seq + 1);
        setActiveDoc(null);
        setLiveScript("");
        setVoiceManifest(null);
        setSnapshots([]);
        setSelection({ nodeId: null, beatId: null });
        setEditorMode("edit");
        setAgentStatus("idle");
        setViewMode("welcome");
        const recent = await window.moesekaiDesktop.workspace.listRecent();
        setRecentProjects(recent);
    }, []);

    const handleRollbackSnapshot = useCallback(async (snapshotId: string) => {
        const updated = await window.moesekaiDesktop.agent.rollbackSnapshot(snapshotId);
        setProject(updated);
        setLiveScript(updated.script);
        setSnapshots(updated.snapshots);
        setVoiceManifest((updated.voiceManifest as StoryVoiceManifest | null) ?? null);
        const parsed = parseProjectDoc(updated);
        if (parsed) setActiveDoc(parsed);
        editorRef.current?.reloadFromScript(updated.script, {
            preserveSelection: true,
            markSaved: true,
            silent: true,
        });
        setSaveState("saved");
        setSnack(formatDesktopMessage(localeRef.current, "rollbackSuccessNotice"));
    }, []);

    const handleRefreshSnapshots = useCallback(async () => {
        const list = await window.moesekaiDesktop.workspace.listSnapshots();
        setSnapshots(list);
    }, []);

    // External FS watcher hot-reload (VS Code, git, or MoeSekai Agent editing story.msk)
    useEffect(() => {
        return window.moesekaiDesktop.workspace.onExternalChange(change => {
            const currentProj = projectRef.current;
            if (!currentProj || currentProj.mskFilePath !== change.mskFilePath || currentProj.rootDir !== change.rootDir) {
                return;
            }
            setLiveScript(change.script);
            setSnapshots(change.snapshots);
            setVoiceManifest((change.voiceManifest as StoryVoiceManifest | null) ?? null);
            setProject(prev =>
                prev && prev.id === currentProj.id
                    ? {
                        ...prev,
                        script: change.script,
                        locales: change.locales,
                        voiceManifest: change.voiceManifest,
                        localVoiceFiles: change.localVoiceFiles,
                        snapshots: change.snapshots,
                        updatedAt: change.changedAt,
                    }
                    : prev,
            );
            const parsed = parseStoryScript(change.script);
            if (parsed.ok) {
                setActiveDoc({
                    ...parsed.doc,
                    id: currentProj.id,
                    locales: {
                        ...(parsed.doc.locales ?? {}),
                        ...(change.locales as Partial<Record<UiLocale, StoryLocalePack>>),
                    },
                });
            }
            editorRef.current?.reloadFromScript(change.script, {
                preserveSelection: true,
                markSaved: true,
                silent: true,
            });
            setSaveState("saved");
            setSnack(formatDesktopMessage(localeRef.current, "externalReloadNotice"));
        });
    }, []);

    // MoeSekai Agent status & live editor_action dispatch
    useEffect(() => {
        return window.moesekaiDesktop.agent.onEvent(ev => {
            if (ev.type === "status") {
                setAgentStatus(ev.status);
            } else if (ev.type === "retry_start") {
                setAgentStatus("retrying");
            } else if (ev.type === "retry_end") {
                setAgentStatus(ev.success ? "streaming" : "error");
            } else if (ev.type === "done") {
                setAgentStatus(ev.aborted ? "aborted" : "idle");
            } else if (ev.type === "error") {
                setAgentStatus(ev.recoverable ? "retrying" : "error");
            } else if (ev.type === "snapshot_created") {
                setSnapshots(prev => [ev.snapshot, ...prev.filter(s => s.id !== ev.snapshot.id)]);
            } else if (ev.type === "editor_action") {
                const action = ev.action;
                if (action.kind === "focus_node") {
                    setViewMode("editor");
                    editorRef.current?.focusNode(action.nodeId);
                } else if (action.kind === "select_beat") {
                    setViewMode("editor");
                    editorRef.current?.selectBeat(action.nodeId, action.beatId);
                } else if (action.kind === "switch_mode") {
                    setViewMode("editor");
                    editorRef.current?.setWorkspaceMode(action.mode === "flow" ? "edit" : action.mode);
                } else if (action.kind === "playtest_from_node") {
                    setViewMode("editor");
                    editorRef.current?.playtestFromNode(action.nodeId);
                } else if (action.kind === "open_export_dialog") {
                    const mapped: ExportDialogMode =
                        action.format === "bundle"
                            ? "bundle-zip"
                            : action.format === "i18n"
                                ? "locales"
                                : "msk";
                    setExportDialogMode(mapped);
                    setExportDialogOpen(true);
                }
            }
        });
    }, []);

    // Native Application Menu commands & OS `.msk` file launch requests
    useEffect(() => {
        const unsubCmd = window.moesekaiDesktop.menu.onCommand((cmd: MenuCommand) => {
            switch (cmd.type) {
                case "new-project":
                    setViewMode("welcome");
                    setCreateDialogOpen(true);
                    break;
                case "open-folder":
                    void handleOpenFolder();
                    break;
                case "open-msk":
                    void handleOpenMskFile();
                    break;
                case "open-recent":
                    void handleOpenPath(cmd.path);
                    break;
                case "save":
                    void handleManualSave();
                    break;
                case "export-msk":
                    setExportDialogMode("msk");
                    setExportDialogOpen(true);
                    break;
                case "export-bundle":
                    setExportDialogMode("bundle-zip");
                    setExportDialogOpen(true);
                    break;
                case "reveal-project":
                    void window.moesekaiDesktop.workspace.revealPath();
                    break;
                case "set-theme-mode":
                    persistSettings({ themeMode: cmd.mode });
                    break;
                case "set-theme-seed":
                    persistSettings({ themeSeed: cmd.seed });
                    break;
                case "set-locale":
                    persistSettings({ locale: cmd.locale });
                    break;
                case "toggle-agent-panel":
                    setSettings(prev => {
                        const nextOpen = !prev.agentPanelOpen;
                        void window.moesekaiDesktop.app.updateSettings({ agentPanelOpen: nextOpen });
                        return { ...prev, agentPanelOpen: nextOpen };
                    });
                    break;
                case "run-agent-preset":
                    persistSettings({ agentPanelOpen: true });
                    setExternalPresetTrigger({ preset: cmd.preset, nonce: Date.now() });
                    break;
                case "open-agent-settings":
                    handleOpenSettings("agent");
                    break;
                case "open-settings":
                    handleOpenSettings(cmd.tab ?? "general");
                    break;
                case "open-cache-dialog":
                    handleOpenCacheDialog();
                    break;
                case "check-for-updates":
                    handleOpenUpdateDialog();
                    break;
                case "open-notices":
                    handleOpenNoticesDialog();
                    break;
            }
        });

        const unsubOpen = window.moesekaiDesktop.menu.onOpenFileRequest(filePath => {
            void handleOpenPath(filePath);
        });

        return () => {
            unsubCmd();
            unsubOpen();
        };
    }, [
        handleManualSave,
        handleOpenCacheDialog,
        handleOpenFolder,
        handleOpenMskFile,
        handleOpenNoticesDialog,
        handleOpenPath,
        handleOpenSettings,
        handleOpenUpdateDialog,
        persistSettings,
    ]);

    // Global desktop shortcuts (Ctrl+,, Ctrl+S, Ctrl+Shift+E, Ctrl+Shift+A)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            if (key === "," && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                handleOpenSettings("general");
            } else if (key === "s" && !e.shiftKey && project) {
                e.preventDefault();
                void handleManualSave();
            } else if (key === "e" && e.shiftKey && project) {
                e.preventDefault();
                setExportDialogMode("msk");
                setExportDialogOpen(true);
            } else if (key === "a" && e.shiftKey && project) {
                e.preventDefault();
                persistSettings({ agentPanelOpen: !settings.agentPanelOpen });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleManualSave, handleOpenSettings, persistSettings, project, settings.agentPanelOpen]);

    const storageAdapter = useMemo(
        () =>
            createElectronStoryStorageAdapter(window.moesekaiDesktop, {
                onSaved: (_savedAt, doc) => {
                    setActiveDoc(doc);
                    setLiveScript(serializeStoryScript(doc));
                    setSaveState("saved");
                },
                getVoiceManifest: () => voiceManifestRef.current,
            }),
        [],
    );

    const exportAdapter = useMemo(
        () =>
            createElectronStoryExportAdapter(window.moesekaiDesktop, {
                getVoiceManifest: () => voiceManifestRef.current,
            }),
        [],
    );

    const knownNodeIds = useMemo(
        () => (activeDoc ? Object.keys(activeDoc.nodes) : []),
        [activeDoc],
    );

    const effectiveExportScript = useMemo(() => {
        const effectiveDoc = editorRef.current?.getEffectiveDoc() ?? activeDoc;
        if (effectiveDoc) return serializeStoryScript(effectiveDoc);
        return liveScript;
    }, [activeDoc, liveScript, exportDialogOpen]);

    const effectiveLocales = useMemo<Record<string, unknown>>(() => {
        const result: Record<string, unknown> = { ...(project?.locales ?? {}) };
        if (activeDoc?.locales) {
            for (const [k, pack] of Object.entries(activeDoc.locales)) {
                if (pack) result[k] = pack;
            }
        }
        return result;
    }, [activeDoc, project]);

    // Resolve Live2D & unit icon bases deterministically from location protocol on first render
    // so they never flip string identity when `appInfo` resolves asynchronously (avoiding Live2D worker restarts).
    const isCustomAppOrigin =
        typeof window !== "undefined" && window.location.protocol === "moesekai-app:";
    const live2dScriptBase =
        appInfo?.live2dScriptBase ?? (isCustomAppOrigin ? "moesekai-app://app/live2d-viewer/" : "/live2d-viewer/");
    const unitIconBaseUrl =
        (appInfo ? !appInfo.isDev : isCustomAppOrigin) ? "moesekai-app://app/unit-icons/" : "/unit-icons/";

    const platform = appInfo?.platform ?? "win32";
    const appVersion = appInfo?.version ?? "0.1.0";
    const availableUpdateVersion =
        updateResult && shouldNotifyUpdate(updateResult, settings.ignoredUpdateVersion)
            ? updateResult.latestVersion
            : null;
    const showWelcome = viewMode === "welcome" || !project || !activeDoc;
    const projectSessionKey = project ? `${project.id}:${project.mskFilePath}:${projectSessionSeq}` : "none";
    const handleOpenNewProject = useCallback(() => {
        setViewMode("welcome");
        setCreateDialogOpen(true);
    }, []);
    const handleOpenExportMsk = useCallback(() => {
        setExportDialogMode("msk");
        setExportDialogOpen(true);
    }, []);
    const handleOpenExportBundle = useCallback(() => {
        setExportDialogMode("bundle-zip");
        setExportDialogOpen(true);
    }, []);
    const handleToggleAgentPanel = useCallback(() => {
        persistSettings({ agentPanelOpen: !settings.agentPanelOpen });
    }, [persistSettings, settings.agentPanelOpen]);
    const handleRevealProject = useCallback(() => {
        void window.moesekaiDesktop.workspace.revealPath();
    }, []);

    const effectiveAgentWidth = clampAgentPanelWidth(liveAgentWidth, viewportWidth);
    const maxAgentWidth = getMaxAgentPanelWidth(viewportWidth);

    const handleAgentResizePointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const startWidth = clampAgentPanelWidth(liveAgentWidthRef.current, window.innerWidth);
            agentResizeDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth,
            };
            setIsResizingAgent(true);
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
        },
        [],
    );

    const handleAgentResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = agentResizeDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = drag.startX - event.clientX;
        const clamped = clampAgentPanelWidth(drag.startWidth + deltaX, window.innerWidth);
        liveAgentWidthRef.current = clamped;
        setLiveAgentWidth(clamped);
    }, []);

    const finishAgentResize = useCallback(
        (event: React.PointerEvent<HTMLDivElement>, persist: boolean) => {
            const drag = agentResizeDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            agentResizeDragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setIsResizingAgent(false);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            if (persist) {
                const finalWidth = clampAgentPanelWidth(liveAgentWidthRef.current, window.innerWidth);
                persistSettings({ agentPanelWidth: finalWidth });
            }
        },
        [persistSettings],
    );

    const handleAgentResizeDoubleClick = useCallback(() => {
        const resetWidth = clampAgentPanelWidth(DEFAULT_AGENT_PANEL_WIDTH, window.innerWidth);
        liveAgentWidthRef.current = resetWidth;
        setLiveAgentWidth(resetWidth);
        persistSettings({ agentPanelWidth: resetWidth });
    }, [persistSettings]);

    const handleAgentResizeKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            let next: number | null = null;
            if (event.key === "ArrowLeft") {
                next = clampAgentPanelWidth(effectiveAgentWidth + 20, window.innerWidth);
            } else if (event.key === "ArrowRight") {
                next = clampAgentPanelWidth(effectiveAgentWidth - 20, window.innerWidth);
            } else if (event.key === "Home") {
                next = MIN_AGENT_PANEL_WIDTH;
            } else if (event.key === "End") {
                next = maxAgentWidth;
            }
            if (next === null) return;
            event.preventDefault();
            liveAgentWidthRef.current = next;
            setLiveAgentWidth(next);
            persistSettings({ agentPanelWidth: next });
        },
        [effectiveAgentWidth, maxAgentWidth, persistSettings],
    );

    return (
        <StoryStudioProvider
            locale={settings.locale}
            assetLine={settings.assetLine}
            defaultRegion={activeDoc?.region ?? "jp"}
            live2dScriptBase={live2dScriptBase}
            unitIconBaseUrl={unitIconBaseUrl}
            themeSeed={settings.themeSeed}
            themeMode={settings.themeMode}
            stageRenderQuality={settings.stageRenderQuality}
            showAttribution={true}
            onOpenNotices={handleOpenNoticesDialog}
            storage={storageAdapter}
            exporter={exportAdapter}
            capabilities={DESKTOP_STORY_WORKSPACE_CAPABILITIES}
            navigate={href => {
                if (/^https?:\/\//i.test(href)) {
                    void window.moesekaiDesktop.app.openExternal(href);
                }
            }}
        >
            <div
                data-desktop-view={viewMode}
                className="flex h-screen w-screen flex-col overflow-hidden overflow-x-hidden bg-surface text-on-surface"
            >
                {showWelcome ? (
                    <DesktopWelcomeTopBar
                        platform={platform}
                        isFullscreen={isFullscreen}
                        settings={settings}
                        appVersion={appVersion}
                        availableUpdateVersion={availableUpdateVersion}
                        onNewProject={handleOpenNewProject}
                        onOpenFolder={() => void handleOpenFolder()}
                        onOpenMskFile={() => void handleOpenMskFile()}
                        onOpenSettings={handleOpenSettings}
                        onOpenCacheDialog={handleOpenCacheDialog}
                        onCheckForUpdates={handleOpenUpdateDialog}
                        onOpenNoticesDialog={handleOpenNoticesDialog}
                    />
                ) : null}

                <main className="relative flex min-h-0 flex-1 overflow-hidden">
                    {showWelcome ? (
                        <WorkspaceWelcome
                            locale={settings.locale}
                            recentProjects={recentProjects}
                            createDialogOpen={createDialogOpen}
                            onCreateDialogOpenChange={setCreateDialogOpen}
                            onCreateProject={handleCreateProject}
                            onOpenStarterDemo={handleOpenStarterDemo}
                            onOpenFolder={handleOpenFolder}
                            onOpenMskFile={handleOpenMskFile}
                            onOpenRecent={entry => handleOpenPath(entry.path)}
                            onRevealPath={targetPath => window.moesekaiDesktop.workspace.revealPath(targetPath)}
                            onRemoveRecent={async targetPath => {
                                const next = await window.moesekaiDesktop.workspace.removeRecent(targetPath);
                                setRecentProjects(next);
                            }}
                            onOpenNotices={handleOpenNoticesDialog}
                        />
                    ) : viewMode === "player" ? (
                        <div className="h-full w-full overflow-hidden">
                            <StoryStudioPlayer
                                key={projectSessionKey}
                                externalSource={{
                                    key: projectSessionKey,
                                    doc: activeDoc,
                                    voiceManifest,
                                    badge: project.storyFileName,
                                }}
                                initialLocale={settings.locale}
                                initialImmersive={true}
                                homeHref={null}
                                onBackToDrafts={() => setViewMode("editor")}
                                onEditDraft={() => setViewMode("editor")}
                                slots={{
                                    replaceTopBar: topCtx => (
                                        <DesktopPlayerTopBar
                                            ctx={topCtx}
                                            platform={platform}
                                            isFullscreen={isFullscreen}
                                            settings={settings}
                                            appVersion={appVersion}
                                            availableUpdateVersion={availableUpdateVersion}
                                            onBackToEditor={() => setViewMode("editor")}
                                            onOpenExport={handleOpenExportMsk}
                                            onOpenSettings={handleOpenSettings}
                                            onOpenCacheDialog={handleOpenCacheDialog}
                                            onCheckForUpdates={handleOpenUpdateDialog}
                                            onOpenNoticesDialog={handleOpenNoticesDialog}
                                        />
                                    ),
                                }}
                            />
                        </div>
                    ) : (
                        <div className="h-full w-full overflow-hidden">
                            <StoryStudioEditor
                                key={projectSessionKey}
                                ref={editorRef}
                                externalDoc={activeDoc}
                                externalDocKey={projectSessionKey}
                                onSaveDoc={handleSaveDoc}
                                onDocChange={nextDoc => {
                                    setActiveDoc(nextDoc);
                                    setSaveState("dirty");
                                }}
                                onSelectionChange={setSelection}
                                onModeChange={setEditorMode}
                                onRequestExport={handleOpenExportMsk}
                                onBackToDrafts={() => void handleCloseProject()}
                                homeHref={null}
                                enforceDesktopViewport={false}
                                initialImmersive={true}
                                initialVoiceManifest={voiceManifest}
                                slots={{
                                    replaceTopBar: topCtx => (
                                        <DesktopEditorTopBar
                                            ctx={topCtx}
                                            platform={platform}
                                            isFullscreen={isFullscreen}
                                            settings={settings}
                                            appVersion={appVersion}
                                            availableUpdateVersion={availableUpdateVersion}
                                            saveState={saveState}
                                            agentStatus={agentStatus}
                                            onBackToWelcome={() => void handleCloseProject()}
                                            onNewProject={handleOpenNewProject}
                                            onOpenFolder={() => void handleOpenFolder()}
                                            onOpenMskFile={() => void handleOpenMskFile()}
                                            onSave={() => void handleManualSave()}
                                            onOpenExport={handleOpenExportMsk}
                                            onOpenExportBundle={handleOpenExportBundle}
                                            onEnterTheater={() => setViewMode("player")}
                                            onRevealProject={handleRevealProject}
                                            onOpenSettings={handleOpenSettings}
                                            onOpenCacheDialog={handleOpenCacheDialog}
                                            onCheckForUpdates={handleOpenUpdateDialog}
                                            onOpenNoticesDialog={handleOpenNoticesDialog}
                                            onToggleAgentPanel={handleToggleAgentPanel}
                                        />
                                    ),
                                    hasExternalDialogOpen:
                                        exportDialogOpen ||
                                        settingsDialogOpen ||
                                        updateDialogOpen ||
                                        cacheDialogOpen ||
                                        noticesDialogOpen,
                                    sidePanel: () =>
                                        settings.agentPanelOpen ? (
                                            <div className="flex h-full shrink-0 items-stretch">
                                                {/* Left-edge drag resize handle (pointer capture + double-click reset to 340px) */}
                                                <div
                                                    role="separator"
                                                    tabIndex={0}
                                                    data-testid="agent-resize-handle"
                                                    aria-orientation="vertical"
                                                    aria-label={formatDesktopMessage(settings.locale, "agentResizeHandleTooltip")}
                                                    aria-valuenow={effectiveAgentWidth}
                                                    aria-valuemin={MIN_AGENT_PANEL_WIDTH}
                                                    aria-valuemax={maxAgentWidth}
                                                    title={formatDesktopMessage(settings.locale, "agentResizeHandleTooltip")}
                                                    onPointerDown={handleAgentResizePointerDown}
                                                    onPointerMove={handleAgentResizePointerMove}
                                                    onPointerUp={e => finishAgentResize(e, true)}
                                                    onPointerCancel={e => finishAgentResize(e, false)}
                                                    onDoubleClick={handleAgentResizeDoubleClick}
                                                    onKeyDown={handleAgentResizeKeyDown}
                                                    className="focus-ring group -ml-1 flex w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center rounded-md3-full"
                                                >
                                                    <span
                                                        className={cn(
                                                            "h-12 w-1 rounded-md3-full transition-colors",
                                                            isResizingAgent
                                                                ? "bg-primary"
                                                                : "bg-outline-variant/65 group-hover:bg-primary",
                                                        )}
                                                    />
                                                </div>
                                                <div
                                                    data-testid="agent-panel-container"
                                                    style={{ width: `${effectiveAgentWidth}px` }}
                                                    className="h-full min-w-0 shrink-0"
                                                >
                                                    <PiAgentPanel
                                                        ref={agentPanelRef}
                                                        key={projectSessionKey}
                                                        locale={settings.locale}
                                                        region={activeDoc.region}
                                                        hasActiveProject={true}
                                                        knownNodeIds={knownNodeIds}
                                                        selectedNodeId={selection.nodeId}
                                                        activeMode={editorMode === "edit" ? "flow" : editorMode}
                                                        providerConfig={agentConfig}
                                                        agentStatus={agentStatus}
                                                        snapshots={snapshots}
                                                        onConfigChange={setAgentConfig}
                                                        onOpenSettings={() => handleOpenSettings("agent")}
                                                        onCollapse={() => persistSettings({ agentPanelOpen: false })}
                                                        onFocusNode={nodeId => editorRef.current?.focusNode(nodeId)}
                                                        onRollbackSnapshot={handleRollbackSnapshot}
                                                        onRefreshSnapshots={handleRefreshSnapshots}
                                                        externalPresetTrigger={externalPresetTrigger}
                                                    />
                                                </div>
                                            </div>
                                        ) : null,
                                }}
                            />
                        </div>
                    )}
                </main>

                {/* Enhanced Export .msk & Bundle Dialog */}
                <ExportMskDialog
                    open={exportDialogOpen}
                    initialMode={exportDialogMode}
                    locale={settings.locale}
                    script={effectiveExportScript}
                    locales={effectiveLocales}
                    voiceManifest={voiceManifest}
                    workspaceRoot={project?.rootDir ?? null}
                    suggestedTitle={activeDoc?.meta.title || project?.storyFileName.replace(/\.msk$/i, "") || "story"}
                    onClose={() => setExportDialogOpen(false)}
                    onFocusNode={nodeId => editorRef.current?.focusNode(nodeId)}
                />

                {/* Unified 3-Tab Preferences Dialog (Appearance & Language / Stage & Cache / MoeSekai Agent) */}
                <SettingsDialog
                    open={settingsDialogOpen}
                    initialTab={settingsDialogTab}
                    settings={settings}
                    cacheStats={cacheStats}
                    loadingCacheStats={loadingCacheStats}
                    onChangeThemeMode={(mode: DesktopThemeMode) => persistSettings({ themeMode: mode })}
                    onChangeThemeSeed={seed => persistSettings({ themeSeed: seed })}
                    onChangeLocale={locale => persistSettings({ locale })}
                    onChangeStageRenderQuality={(stageRenderQuality: DesktopStageRenderQuality) =>
                        persistSettings({ stageRenderQuality })
                    }
                    onRefreshCacheStats={handleRefreshCacheStats}
                    onToggleCacheEnabled={enabled => void handleToggleCacheEnabled(enabled)}
                    onChangeCacheMaxMb={mb => void handleChangeCacheMaxMb(mb)}
                    onOpenCacheDir={handleOpenCacheDir}
                    onClearCache={() => void handleClearCache()}
                    onAgentConfigSaved={saved => {
                        setAgentConfig(saved);
                        setSnack(formatDesktopMessage(settings.locale, "agentSettingsSaved"));
                    }}
                    onClose={() => setSettingsDialogOpen(false)}
                />

                {/* Dedicated Software Update Dialog */}
                <UpdateDialog
                    open={updateDialogOpen}
                    locale={settings.locale}
                    currentVersion={appVersion}
                    channel={settings.updateChannel}
                    autoCheckUpdates={settings.autoCheckUpdates}
                    checking={updateChecking}
                    result={updateResult}
                    onClose={() => setUpdateDialogOpen(false)}
                    onChangeChannel={nextChannel => persistSettings({ updateChannel: nextChannel })}
                    onChangeAutoCheck={enabled => persistSettings({ autoCheckUpdates: enabled })}
                    onCheckNow={channelOverride => void runUpdateCheck(channelOverride)}
                    onOpenDownload={handleOpenUpdateDownload}
                    onIgnoreVersion={ver => void handleIgnoreUpdateVersion(ver)}
                />

                {/* Dedicated Local Asset Cache Dialog */}
                <AssetCacheDialog
                    open={cacheDialogOpen}
                    locale={settings.locale}
                    assetCacheEnabled={settings.assetCacheEnabled}
                    assetCacheMaxMb={settings.assetCacheMaxMb}
                    cacheStats={cacheStats}
                    loadingStats={loadingCacheStats}
                    onRefreshStats={handleRefreshCacheStats}
                    onToggleEnabled={enabled => void handleToggleCacheEnabled(enabled)}
                    onChangeMaxMb={mb => void handleChangeCacheMaxMb(mb)}
                    onOpenCacheDir={handleOpenCacheDir}
                    onClearCache={() => void handleClearCache()}
                    onClose={() => setCacheDialogOpen(false)}
                />

                {/* Dedicated About & Legal Notices Dialog (with Official MoeSekai Community Links) */}
                <AboutNoticesDialog
                    open={noticesDialogOpen}
                    locale={settings.locale}
                    currentVersion={appVersion}
                    onOpenExternal={handleOpenExternal}
                    onClose={() => setNoticesDialogOpen(false)}
                />

                <Snackbar
                    open={Boolean(snack)}
                    message={snack ?? ""}
                    onClose={() => setSnack(null)}
                />
            </div>
        </StoryStudioProvider>
    );
};
