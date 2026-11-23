import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
    IPC_CHANNELS,
    type AgentAuthoringMode,
    type AgentPresetPayload,
    type AgentPromptPayload,
    type AgentProviderConfigInput,
    type AgentThinkingLevel,
    type CreateWorkspaceInput,
    type DesktopAppInfo,
    type DesktopAppSettings,
    type ExportBundleRequest,
    type ExportLocalesRequest,
    type ExportMskRequest,
    type ExportPreflightRequest,
    type SaveWorkspaceInput,
    type UpdateCheckRequest,
} from "../shared/ipc.ts";
import { sanitizeExportFilename } from "../shared/path-jail.ts";
import type { PiAgentHost } from "./agent-host.ts";
import {
    exportCleanMskToFile,
    exportFullBundleToPath,
    exportLocalesToDirectory,
    runExportPreflight,
} from "./exporter.ts";
import type { DesktopSettingsStore } from "./settings.ts";
import type { DesktopUpdateService } from "./updater.ts";
import { resolveUniqueProjectDir, type WorkspaceManager } from "./workspace.ts";

export interface IpcHandlersDeps {
    getMainWindow: () => BrowserWindow | null;
    workspace: WorkspaceManager;
    settings: DesktopSettingsStore;
    agentHost: PiAgentHost;
    updater: DesktopUpdateService;
    appInfo: DesktopAppInfo;
    refreshMenu: () => void;
    syncWindowChrome?: (themeMode: "light" | "dark") => void;
}

function isAllowedExternalUrl(rawUrl: string): boolean {
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
        return false;
    }
}

export function registerIpcHandlers(deps: IpcHandlersDeps): void {
    const { getMainWindow, workspace, settings, agentHost, updater, appInfo, refreshMenu, syncWindowChrome } = deps;

    const getOwnerWindow = (): BrowserWindow | undefined => getMainWindow() ?? undefined;

    // ==================== App & Settings ====================

    ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, () => ({
        ...appInfo,
        isFullscreen: Boolean(getMainWindow()?.isFullScreen()),
    }));

    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settings.getAppSettings());

    ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_ev, patch: Partial<DesktopAppSettings>) => {
        const updated = settings.updateAppSettings(patch ?? {});
        refreshMenu();
        syncWindowChrome?.(updated.themeMode);
        return updated;
    });

    ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_ev, rawUrl: string) => {
        if (typeof rawUrl !== "string" || !isAllowedExternalUrl(rawUrl)) {
            throw new Error("Only http(s) URLs may be opened externally.");
        }
        await shell.openExternal(rawUrl);
    });

    // ==================== Desktop Updates (CNB Primary + GitHub Fallback) ====================

    ipcMain.handle(IPC_CHANNELS.UPDATES_CHECK, (_ev, req?: UpdateCheckRequest) =>
        updater.check(req),
    );

    ipcMain.handle(IPC_CHANNELS.UPDATES_IGNORE_VERSION, (_ev, version: string | null) =>
        updater.ignoreVersion(version),
    );

    ipcMain.handle(IPC_CHANNELS.UPDATES_OPEN_DOWNLOAD, (_ev, url: string) =>
        updater.openDownload(url),
    );

    // ==================== Workspace ====================

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_ACTIVE, () => workspace.getActiveProject());

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, async (_ev, input: CreateWorkspaceInput) => {
        const project = workspace.createProject(input);
        refreshMenu();
        await agentHost.notifyWorkspaceChanged({ forceReset: true });
        return project;
    });

    ipcMain.handle(
        IPC_CHANNELS.WORKSPACE_PICK_AND_CREATE,
        async (_ev, input: Omit<CreateWorkspaceInput, "dirPath">) => {
            const win = getOwnerWindow();
            const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
                title: "Choose Parent Folder for New Story Project",
                properties: ["openDirectory", "createDirectory"],
            });
            if (pick.canceled || pick.filePaths.length === 0) return null;
            const folderName = sanitizeExportFilename(input.title || "moesekai-story", "moesekai-story");
            const targetDir = resolveUniqueProjectDir(pick.filePaths[0], folderName);
            const project = workspace.createProject({
                ...input,
                dirPath: targetDir,
                allowOverwrite: false,
            });
            refreshMenu();
            await agentHost.notifyWorkspaceChanged({ forceReset: true });
            return project;
        },
    );

    ipcMain.handle(
        IPC_CHANNELS.WORKSPACE_OPEN_STARTER_DEMO,
        async (_ev, input: Omit<CreateWorkspaceInput, "dirPath">) => {
            const demoDir = path.join(app.getPath("userData"), "starter-demo");
            const project = workspace.createProject({
                ...input,
                dirPath: demoDir,
                allowOverwrite: true,
            });
            refreshMenu();
            await agentHost.notifyWorkspaceChanged({ forceReset: true });
            return project;
        },
    );

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_FOLDER_DIALOG, async () => {
        const win = getOwnerWindow();
        const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
            title: "Open MoeSekai Story Project Folder",
            properties: ["openDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        const project = workspace.openProject(result.filePaths[0]);
        refreshMenu();
        await agentHost.notifyWorkspaceChanged({ forceReset: true });
        return project;
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_MSK_DIALOG, async () => {
        const win = getOwnerWindow();
        const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
            title: "Open MoeSekai Story Script (.msk)",
            properties: ["openFile"],
            filters: [
                { name: "MoeSekai Story Script", extensions: ["msk"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        const project = workspace.openProject(result.filePaths[0]);
        refreshMenu();
        await agentHost.notifyWorkspaceChanged({ forceReset: true });
        return project;
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_PATH, async (_ev, targetPath: string) => {
        const project = workspace.openProject(targetPath);
        refreshMenu();
        await agentHost.notifyWorkspaceChanged({ forceReset: true });
        return project;
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_SAVE, (_ev, input: SaveWorkspaceInput) => {
        const res = workspace.saveProject(input);
        refreshMenu();
        return res;
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE, async () => {
        workspace.closeProject();
        refreshMenu();
        await agentHost.notifyWorkspaceChanged({ forceReset: true });
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST_RECENT, () => workspace.listRecentProjects());

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_REMOVE_RECENT, (_ev, targetPath: string) => {
        const next = workspace.removeRecentProject(targetPath);
        refreshMenu();
        return next;
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST_SNAPSHOTS, () => workspace.listSnapshots());

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE_SNAPSHOT, (_ev, reason?: string) =>
        workspace.createSnapshot(reason ?? "manual"),
    );

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_ROLLBACK_SNAPSHOT, (_ev, snapshotId: string) =>
        workspace.rollbackSnapshot(snapshotId),
    );

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_IMPORT_VOICE_FILE, async (_ev, beatId?: string) => {
        const win = getOwnerWindow();
        const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
            title: "Select Local Voice Audio File",
            properties: ["openFile"],
            filters: [
                { name: "Audio Files", extensions: ["ogg", "mp3", "wav", "m4a", "flac", "webm"] },
            ],
        });
        if (pick.canceled || pick.filePaths.length === 0) return null;
        const imported = workspace.importLocalVoiceFile(pick.filePaths[0], beatId);
        return {
            relativePath: imported.relativePath,
            url: `${appInfo.workspaceProtocolBase}${imported.relativePath}`,
            fileName: imported.fileName,
            sizeBytes: imported.sizeBytes,
        };
    });

    ipcMain.handle(IPC_CHANNELS.WORKSPACE_REVEAL_PATH, (_ev, targetPath?: string) => {
        const toReveal = targetPath || workspace.getActiveMskPath() || workspace.getActiveRootDir();
        if (!toReveal) return;
        shell.showItemInFolder(path.resolve(toReveal));
    });

    // ==================== Export Pipeline ====================

    ipcMain.handle(IPC_CHANNELS.EXPORT_PREFLIGHT, (_ev, req: ExportPreflightRequest) =>
        runExportPreflight({
            ...req,
            workspaceRoot: req.workspaceRoot ?? workspace.getActiveRootDir(),
        }),
    );

    ipcMain.handle(IPC_CHANNELS.EXPORT_MSK, async (_ev, req: ExportMskRequest) => {
        let outputPath = req.outputPath;
        if (!outputPath) {
            const win = getOwnerWindow();
            const suggested = `${sanitizeExportFilename(req.suggestedFileName || "story", "story")}.msk`;
            const defaultDir = workspace.getActiveRootDir() || app.getPath("documents");
            const save = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
                title: "Export MoeSekai Story Script (.msk)",
                defaultPath: path.join(defaultDir, suggested),
                filters: [{ name: "MoeSekai Story Script", extensions: ["msk"] }],
            });
            if (save.canceled || !save.filePath) return { canceled: true };
            outputPath = save.filePath;
        }
        return exportCleanMskToFile({ ...req, outputPath });
    });

    ipcMain.handle(IPC_CHANNELS.EXPORT_BUNDLE, async (_ev, req: ExportBundleRequest) => {
        let outputPath = req.outputPath;
        const baseName = sanitizeExportFilename(req.suggestedName || "story-bundle", "story-bundle");
        const defaultDir = workspace.getActiveRootDir() || app.getPath("documents");

        if (!outputPath) {
            const win = getOwnerWindow();
            if (req.format === "zip") {
                const save = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
                    title: "Export Full Story Bundle (.zip)",
                    defaultPath: path.join(defaultDir, `${baseName}.zip`),
                    filters: [{ name: "Story Bundle Archive", extensions: ["zip"] }],
                });
                if (save.canceled || !save.filePath) return { canceled: true };
                outputPath = save.filePath;
            } else {
                const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
                    title: "Select Destination Folder for Story Bundle",
                    defaultPath: defaultDir,
                    properties: ["openDirectory", "createDirectory"],
                });
                if (pick.canceled || pick.filePaths.length === 0) return { canceled: true };
                outputPath = path.join(pick.filePaths[0], baseName);
            }
        }

        return exportFullBundleToPath({
            ...req,
            workspaceRoot: req.workspaceRoot ?? workspace.getActiveRootDir(),
            outputPath,
        });
    });

    ipcMain.handle(IPC_CHANNELS.EXPORT_LOCALES, async (_ev, req: ExportLocalesRequest) => {
        let outputDir = req.outputDir;
        if (!outputDir) {
            const win = getOwnerWindow();
            const defaultDir = workspace.getActiveRootDir() || app.getPath("documents");
            const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
                title: "Export Locale Packs & Voice Manifest to Folder",
                defaultPath: defaultDir,
                properties: ["openDirectory", "createDirectory"],
            });
            if (pick.canceled || pick.filePaths.length === 0) return { canceled: true };
            outputDir = pick.filePaths[0];
        }
        return exportLocalesToDirectory({ ...req, outputDir });
    });

    // ==================== MoeSekai Agent ====================

    ipcMain.handle(IPC_CHANNELS.AGENT_GET_CONFIG, () => agentHost.getPublicConfig());

    ipcMain.handle(IPC_CHANNELS.AGENT_SAVE_CONFIG, (_ev, cfg: AgentProviderConfigInput) =>
        agentHost.saveConfig(cfg),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATUS, () => agentHost.getStatus());

    ipcMain.handle(IPC_CHANNELS.AGENT_LIST_PROVIDERS, () => agentHost.listProviders());

    ipcMain.handle(IPC_CHANNELS.AGENT_FETCH_MODELS, (_ev, override?: Partial<AgentProviderConfigInput>) =>
        agentHost.fetchModels(override),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_SET_THINKING_LEVEL, (_ev, level: AgentThinkingLevel) =>
        agentHost.setThinkingLevel(level),
    );

    ipcMain.handle(
        IPC_CHANNELS.AGENT_SET_AUTHORING_MODE,
        (_ev, payload: { mode: AgentAuthoringMode; planFirst?: boolean }) =>
            agentHost.setAuthoringMode(payload.mode, payload.planFirst),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_SET_PLAN_FIRST, (_ev, planFirst: boolean) =>
        agentHost.setPlanFirst(planFirst),
    );

    ipcMain.handle(
        IPC_CHANNELS.AGENT_APPROVE_PLAN,
        (_ev, payload: { planId: string; feedback?: string }) =>
            agentHost.approvePlan(payload.planId, payload.feedback),
    );

    ipcMain.handle(
        IPC_CHANNELS.AGENT_REVISE_PLAN,
        (_ev, payload: { planId: string; feedback: string }) =>
            agentHost.revisePlan(payload.planId, payload.feedback),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_PROMPT, (_ev, payload: AgentPromptPayload) =>
        agentHost.prompt(payload),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_RUN_PRESET, (_ev, payload: AgentPresetPayload) =>
        agentHost.runPreset(payload),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, () => agentHost.abort());

    ipcMain.handle(IPC_CHANNELS.AGENT_RESET, () => agentHost.reset());

    ipcMain.handle(IPC_CHANNELS.AGENT_LIST_SESSIONS, () => agentHost.listSessions());

    ipcMain.handle(IPC_CHANNELS.AGENT_RESUME_SESSION, (_ev, sessionId: string) =>
        agentHost.resumeSession(sessionId),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_NEW_SESSION, () => agentHost.newSession());

    ipcMain.handle(IPC_CHANNELS.AGENT_DELETE_SESSION, (_ev, sessionId: string) =>
        agentHost.deleteSession(sessionId),
    );

    ipcMain.handle(IPC_CHANNELS.AGENT_LIST_SNAPSHOTS, async () => {
        // Merge workspace-discovered snapshots with worker snapshots cleanly.
        const wsSnaps = workspace.listSnapshots();
        if (wsSnaps.length > 0) return wsSnaps;
        try {
            return await agentHost.listSnapshots();
        } catch {
            return [];
        }
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_ROLLBACK_SNAPSHOT, async (_ev, snapshotId: string) => {
        // Prefer WorkspaceManager's rollback so self-write suppression & fresh workspace state stay consistent.
        return workspace.rollbackSnapshot(snapshotId);
    });
}
