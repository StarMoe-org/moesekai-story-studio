import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
    IPC_CHANNELS,
    type DesktopAgentEvent,
    type DesktopUpdateCheckResult,
    type MenuCommand,
    type MoesekaiDesktopApi,
    type UnsubscribeFn,
    type WorkspaceExternalChangeEvent,
} from "../shared/ipc.ts";

function subscribeChannel<T>(channel: string, listener: (payload: T) => void): UnsubscribeFn {
    const wrapped = (_event: IpcRendererEvent, payload: T) => {
        listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
        ipcRenderer.removeListener(channel, wrapped);
    };
}

const api: MoesekaiDesktopApi = {
    app: {
        getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
        getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
        updateSettings: patch => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch),
        openExternal: url => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
        onFullscreenChange: listener =>
            subscribeChannel<boolean>(IPC_CHANNELS.EVENT_WINDOW_FULLSCREEN_CHANGED, listener),
    },
    workspace: {
        getActive: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_ACTIVE),
        pickAndCreate: input => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_PICK_AND_CREATE, input),
        openStarterDemo: input => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_STARTER_DEMO, input),
        create: input => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE, input),
        openFolderDialog: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_FOLDER_DIALOG),
        openMskDialog: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_MSK_DIALOG),
        openPath: targetPath => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_PATH, targetPath),
        save: input => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE, input),
        close: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CLOSE),
        listRecent: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST_RECENT),
        removeRecent: targetPath => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_REMOVE_RECENT, targetPath),
        listSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST_SNAPSHOTS),
        createSnapshot: reason => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE_SNAPSHOT, reason),
        rollbackSnapshot: snapshotId => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_ROLLBACK_SNAPSHOT, snapshotId),
        importVoiceFile: beatId => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_IMPORT_VOICE_FILE, beatId),
        importVoiceFiles: req => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_IMPORT_VOICE_FILES, req),
        listVoiceFiles: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST_VOICE_FILES),
        saveVoiceManifest: manifest => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE_VOICE_MANIFEST, manifest),
        openVoicesDir: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_VOICES_DIR),
        revealPath: targetPath => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_REVEAL_PATH, targetPath),
        onExternalChange: listener =>
            subscribeChannel<WorkspaceExternalChangeEvent>(IPC_CHANNELS.EVENT_WORKSPACE_EXTERNAL_CHANGE, listener),
    },
    exporter: {
        preflight: req => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PREFLIGHT, req),
        exportMsk: req => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_MSK, req),
        exportBundle: req => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_BUNDLE, req),
        exportLocales: req => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_LOCALES, req),
    },
    agent: {
        getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_CONFIG),
        saveConfig: config => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SAVE_CONFIG, config),
        getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS),
        listProviders: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_LIST_PROVIDERS),
        fetchModels: override => ipcRenderer.invoke(IPC_CHANNELS.AGENT_FETCH_MODELS, override),
        setThinkingLevel: level => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SET_THINKING_LEVEL, level),
        setAuthoringMode: (mode, planFirst) =>
            ipcRenderer.invoke(IPC_CHANNELS.AGENT_SET_AUTHORING_MODE, { mode, planFirst }),
        setPlanFirst: planFirst => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SET_PLAN_FIRST, planFirst),
        approvePlan: (planId, feedback) =>
            ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVE_PLAN, { planId, feedback }),
        revisePlan: (planId, feedback) =>
            ipcRenderer.invoke(IPC_CHANNELS.AGENT_REVISE_PLAN, { planId, feedback }),
        prompt: payload => ipcRenderer.invoke(IPC_CHANNELS.AGENT_PROMPT, payload),
        runPreset: payload => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_PRESET, payload),
        abort: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_ABORT),
        reset: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESET),
        listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_LIST_SESSIONS),
        resumeSession: sessionId => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESUME_SESSION, sessionId),
        newSession: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_NEW_SESSION),
        deleteSession: sessionId => ipcRenderer.invoke(IPC_CHANNELS.AGENT_DELETE_SESSION, sessionId),
        listSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_LIST_SNAPSHOTS),
        rollbackSnapshot: snapshotId => ipcRenderer.invoke(IPC_CHANNELS.AGENT_ROLLBACK_SNAPSHOT, snapshotId),
        onEvent: listener => subscribeChannel<DesktopAgentEvent>(IPC_CHANNELS.EVENT_AGENT, listener),
    },
    menu: {
        onCommand: listener => subscribeChannel<MenuCommand>(IPC_CHANNELS.EVENT_MENU_COMMAND, listener),
        onOpenFileRequest: listener => subscribeChannel<string>(IPC_CHANNELS.EVENT_OPEN_FILE_REQUEST, listener),
    },
    updates: {
        check: opts => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK, opts),
        ignoreVersion: version => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_IGNORE_VERSION, version),
        openDownload: url => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_OPEN_DOWNLOAD, url),
        onUpdateAvailable: listener =>
            subscribeChannel<DesktopUpdateCheckResult>(IPC_CHANNELS.EVENT_UPDATE_AVAILABLE, listener),
    },
    cache: {
        getStats: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_GET_STATS),
        clear: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_CLEAR),
        openDir: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_OPEN_DIR),
        setMaxMb: mb => ipcRenderer.invoke(IPC_CHANNELS.CACHE_SET_MAX_MB, mb),
        setEnabled: enabled => ipcRenderer.invoke(IPC_CHANNELS.CACHE_SET_ENABLED, enabled),
    },
};

contextBridge.exposeInMainWorld("moesekaiDesktop", api);
