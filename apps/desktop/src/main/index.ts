import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol, safeStorage } from "electron";
import {
    IPC_CHANNELS,
    type DesktopAppInfo,
    type MenuCommand,
} from "../shared/ipc.ts";
import {
    resolvePlatformChromeLayout,
    TITLE_BAR_HEIGHT_PX,
} from "../shared/window-chrome.ts";
import { PiAgentHost } from "./agent-host.ts";
import { registerIpcHandlers } from "./ipc-handlers.ts";
import { buildAndApplyAppMenu } from "./menu.ts";
import {
    APP_PROTOCOL_SCHEME,
    createProtocolHandler,
    registerPrivilegedAppScheme,
} from "./protocol.ts";
import { DesktopSettingsStore, type SecretProtector } from "./settings.ts";
import { DesktopUpdateService } from "./updater.ts";
import { WorkspaceManager } from "./workspace.ts";

// Must run BEFORE app.whenReady()
registerPrivilegedAppScheme(protocol);
if (process.platform === "linux") {
    app.commandLine.appendSwitch("enable-unsafe-webgpu");
}

app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU" && details.reason !== "clean-exit") {
        console.warn(`[desktop:main] GPU process exited (${details.reason}, exitCode=${details.exitCode}); Chromium will recover automatically.`);
    }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..");
const appRoot = path.resolve(distRoot, "..");
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isSmokeTest = process.argv.includes("--smoke-test") || process.env.MOESEKAI_SMOKE_TEST === "1";
const captureArg = process.argv.find(a => a.startsWith("--capture-ui="));
const captureUiDir = captureArg
    ? path.resolve(captureArg.slice("--capture-ui=".length))
    : process.env.MOESEKAI_CAPTURE_UI_DIR
        ? path.resolve(process.env.MOESEKAI_CAPTURE_UI_DIR)
        : null;
const isAutomatedRun = isSmokeTest || Boolean(captureUiDir);

function resolveLive2DDir(): string {
    const candidates = [
        app.isPackaged ? path.join(process.resourcesPath, "live2d-viewer") : "",
        path.join(distRoot, "live2d-viewer"),
        path.resolve(appRoot, "../../packages/story-editor/dist/live2d-viewer"),
        path.resolve(appRoot, "../../packages/story-editor/assets/live2d-viewer"),
    ].filter(Boolean);
    return candidates.find(dir => fs.existsSync(dir)) ?? path.join(distRoot, "live2d-viewer");
}

function resolveUnitIconsDir(): string {
    const candidates = [
        app.isPackaged ? path.join(process.resourcesPath, "unit-icons") : "",
        path.join(distRoot, "unit-icons"),
        path.resolve(appRoot, "../../packages/story-editor/dist/unit-icons"),
        path.resolve(appRoot, "../../packages/story-editor/assets/unit-icons"),
    ].filter(Boolean);
    return candidates.find(dir => fs.existsSync(dir)) ?? path.join(distRoot, "unit-icons");
}

function resolveSkillPath(): string {
    const candidates = [
        app.isPackaged ? path.join(process.resourcesPath, "skills/moesekai-story-script") : "",
        path.resolve(appRoot, "../../skills/moesekai-story-script"),
    ].filter(Boolean);
    return candidates.find(dir => fs.existsSync(dir)) ?? path.resolve(appRoot, "../../skills/moesekai-story-script");
}

function resolveAppIconPath(): string | undefined {
    const preferredNames = process.platform === "win32" ? ["icon.ico", "icon.png"] : ["icon.png"];
    const candidates: string[] = [];
    for (const name of preferredNames) {
        if (app.isPackaged) {
            candidates.push(path.join(process.resourcesPath, name));
        }
        candidates.push(path.join(distRoot, name));
        candidates.push(path.join(appRoot, "build", name));
    }
    return candidates.find(filePath => fs.existsSync(filePath));
}

function extractMskArg(argv: string[]): string | null {
    for (const arg of argv.slice(1)) {
        if (!arg || arg.startsWith("-")) continue;
        if (arg.toLowerCase().endsWith(".msk") && fs.existsSync(arg)) {
            return path.resolve(arg);
        }
    }
    return null;
}

const safeStorageProtector: SecretProtector = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: plain => safeStorage.encryptString(plain),
    decryptString: enc => safeStorage.decryptString(enc),
};

let mainWindow: BrowserWindow | null = null;
let pendingOpenFile: string | null = extractMskArg(process.argv);

// Single-instance lock (skipped during smoke-test/capture-ui so automated runs never block)
const gotLock = isAutomatedRun ? true : app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (filePath.toLowerCase().endsWith(".msk")) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.EVENT_OPEN_FILE_REQUEST, filePath);
        } else {
            pendingOpenFile = filePath;
        }
    }
});

app.on("second-instance", (_event, argv) => {
    const mskArg = extractMskArg(argv);
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        if (mskArg) {
            mainWindow.webContents.send(IPC_CHANNELS.EVENT_OPEN_FILE_REQUEST, mskArg);
        }
    }
});

async function bootstrap(): Promise<void> {
    await app.whenReady();

    const userDataDir = app.getPath("userData");
    const rendererDir = path.join(distRoot, "renderer");
    const live2dDir = resolveLive2DDir();
    const unitIconsDir = resolveUnitIconsDir();
    const skillPath = resolveSkillPath();
    const workerPath = path.join(distRoot, "main", "agent-worker.js");

    const workspace = new WorkspaceManager({ userDataDir });
    const settingsStore = new DesktopSettingsStore(userDataDir, safeStorageProtector);

    // Register custom `moesekai-app://` protocol serving Live2D WASM/workers, workspace audio, and prod renderer.
    protocol.handle(
        APP_PROTOCOL_SCHEME,
        createProtocolHandler({
            rendererDir,
            live2dDir,
            unitIconsDir,
            getWorkspaceRoot: () => workspace.getActiveRootDir(),
        }),
    );

    const appInfo: DesktopAppInfo = {
        version: app.getVersion(),
        electronVersion: process.versions.electron ?? "unknown",
        platform: process.platform,
        isFullscreen: false,
        isDev,
        live2dScriptBase: isDev ? "/live2d-viewer/" : `${APP_PROTOCOL_SCHEME}://app/live2d-viewer/`,
        workspaceProtocolBase: `${APP_PROTOCOL_SCHEME}://workspace/`,
        skillPath,
    };

    const sendToRenderer = (channel: string, payload: unknown) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    };

    const agentHost = new PiAgentHost({
        workerPath,
        skillPath,
        settingsStore,
        getWorkspace: () => {
            const rootDir = workspace.getActiveRootDir();
            if (!rootDir) return null;
            return {
                rootDir,
                storyFileName: workspace.getActiveStoryFileName(),
            };
        },
        onEvent: event => {
            sendToRenderer(IPC_CHANNELS.EVENT_AGENT, event);
        },
    });

    workspace.onExternalChange(changeEvent => {
        sendToRenderer(IPC_CHANNELS.EVENT_WORKSPACE_EXTERNAL_CHANGE, changeEvent);
    });

    const sendMenuCommand = (cmd: MenuCommand) => {
        sendToRenderer(IPC_CHANNELS.EVENT_MENU_COMMAND, cmd);
    };

    const refreshMenu = () => {
        buildAndApplyAppMenu({
            settings: settingsStore.getAppSettings(),
            recentProjects: workspace.listRecentProjects(),
            hasActiveProject: workspace.getActiveRootDir() !== null,
            sendCommand: sendMenuCommand,
        });
    };

    const syncWindowChrome = (themeMode: "light" | "dark") => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const isDark = themeMode === "dark";
        const chrome = resolvePlatformChromeLayout(process.platform, mainWindow.isFullScreen());
        mainWindow.setBackgroundColor(isDark ? "#101417" : "#f7f9fc");
        if (chrome.useTitleBarOverlay && typeof mainWindow.setTitleBarOverlay === "function") {
            mainWindow.setTitleBarOverlay({
                color: "#00000000",
                symbolColor: isDark ? "#e2e2e6" : "#1b1c1f",
                height: TITLE_BAR_HEIGHT_PX,
            });
        }
    };

    const updater = new DesktopUpdateService({
        settingsStore,
        currentVersion: app.getVersion(),
    });

    registerIpcHandlers({
        getMainWindow: () => mainWindow,
        workspace,
        settings: settingsStore,
        agentHost,
        updater,
        appInfo,
        refreshMenu,
        syncWindowChrome,
    });

    refreshMenu();

    const createWindow = async () => {
        const initialDark = settingsStore.getAppSettings().themeMode === "dark";
        const isMac = process.platform === "darwin";
        const chrome = resolvePlatformChromeLayout(process.platform, false);
        const appIconPath = resolveAppIconPath();

        const win = new BrowserWindow({
            width: captureUiDir ? 1366 : 1480,
            height: captureUiDir ? 840 : 920,
            minWidth: 1024,
            minHeight: 680,
            show: !isSmokeTest,
            title: "MoeSekai Story Studio",
            ...(appIconPath ? { icon: appIconPath } : {}),
            backgroundColor: initialDark ? "#101417" : "#f7f9fc",
            autoHideMenuBar: !isMac,
            ...(chrome.useTitleBarOverlay
                ? {
                    titleBarStyle: "hidden" as const,
                    titleBarOverlay: {
                        color: "#00000000",
                        symbolColor: initialDark ? "#e2e2e6" : "#1b1c1f",
                        height: TITLE_BAR_HEIGHT_PX,
                    },
                }
                : chrome.useHiddenInset
                    ? {
                        titleBarStyle: "hiddenInset" as const,
                        trafficLightPosition: { x: 14, y: 14 },
                    }
                    : {
                        frame: true,
                    }),
            webPreferences: {
                preload: path.join(distRoot, "preload", "index.cjs"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
            },
        });

        if (!isMac) {
            win.setMenuBarVisibility(false);
        }

        mainWindow = win;

        win.on("enter-full-screen", () => {
            sendToRenderer(IPC_CHANNELS.EVENT_WINDOW_FULLSCREEN_CHANGED, true);
        });

        win.on("leave-full-screen", () => {
            sendToRenderer(IPC_CHANNELS.EVENT_WINDOW_FULLSCREEN_CHANGED, false);
        });

        win.on("closed", () => {
            if (mainWindow === win) mainWindow = null;
        });

        win.webContents.on("render-process-gone", (_ev, details) => {
            console.error(`[desktop:main] Renderer process gone (${details.reason}, exitCode=${details.exitCode})`);
        });

        if (isDev && process.env.VITE_DEV_SERVER_URL) {
            await win.loadURL(process.env.VITE_DEV_SERVER_URL);
        } else {
            await win.loadURL(`${APP_PROTOCOL_SCHEME}://app/index.html`);
        }

        if (pendingOpenFile && !isAutomatedRun) {
            const fileToOpen = pendingOpenFile;
            pendingOpenFile = null;
            win.webContents.send(IPC_CHANNELS.EVENT_OPEN_FILE_REQUEST, fileToOpen);
        }

        if (!isAutomatedRun) {
            updater.scheduleAutoCheck(result => {
                sendToRenderer(IPC_CHANNELS.EVENT_UPDATE_AVAILABLE, result);
            }, 4_000);
        }

        if (captureUiDir) {
            fs.mkdirSync(captureUiDir, { recursive: true });
            win.webContents.on("console-message", (_ev, level, message) => {
                if (level >= 3) console.error(`[desktop:capture:console] ${message}`);
            });
            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
            const snap = async (filename: string) => {
                await sleep(500);
                const img = await win.webContents.capturePage();
                const outPath = path.join(captureUiDir, filename);
                fs.writeFileSync(outPath, img.toPNG());
                console.log(`[desktop:capture] Saved ${outPath}`);
            };

            await sleep(700);
            // 1. Welcome Light (flat MD3, zero gradient)
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setTheme("light")`);
            await snap("01-welcome-light.png");

            // 2. Welcome Dark (flat MD3, zero gradient)
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setTheme("dark")`);
            await snap("02-welcome-dark.png");

            // 3. Create New Project Modal Dialog (Light)
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setTheme("light"); window.__moesekaiCaptureHook?.openCreateDialog();`);
            await snap("03-create-project-dialog.png");

            // 4. Editor workspace with Nightcord climax talk beat -> REAL Live2D characters on stage + enabled 浏览 + upgraded MoeSekai Agent (340px default)
            await win.webContents.executeJavaScript(
                `(async () => {
                    window.__moesekaiCaptureHook?.closeCreateDialog();
                    await window.__moesekaiCaptureHook?.openStarterDemo();
                    for (let i = 0; i < 60; i++) {
                        if (document.querySelector('[data-desktop-view="editor"] textarea')) break;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    window.__moesekaiCaptureHook?.focusClimaxTalkBeat();
                    window.__moesekaiCaptureHook?.setAgentPanelWidth(340);
                    window.__moesekaiCaptureHook?.injectAgentPreviewFixture();
                })()`,
            );
            // Wait for live CDN Live2D actors (all 4 Nightcord cast) to finish loading & scroll enabled `浏览` buttons into view
            await win.webContents.executeJavaScript(
                `(async () => {
                    const firstBrowse = Array.from(document.querySelectorAll("button")).find(
                        b => b.textContent?.includes("浏览"),
                    );
                    if (firstBrowse) {
                        firstBrowse.scrollIntoView({ block: "center", behavior: "instant" });
                    }
                    // Give stage initial startup time before polling for loading pill disappearance
                    await new Promise(r => setTimeout(r, 2500));
                    for (let i = 0; i < 80; i++) {
                        const text = document.body.innerText || "";
                        const stillLoading = text.includes("正在加载角色模型") || text.includes("正在启动 Live2D");
                        if (!stillLoading) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                })()`,
            );
            await sleep(700);

            const editorCheck = await win.webContents.executeJavaScript(`(() => {
                const header = document.querySelector('[data-desktop-topbar="editor"]');
                const spacer = document.querySelector('[data-drag-spacer="left"]');
                const agentBtn = document.querySelector('[data-testid="agent-toggle-btn"]');
                const resizeHandle = document.querySelector('[data-testid="agent-resize-handle"]');
                const newChatBtn = document.querySelector('[data-testid="agent-new-chat-btn"]');
                const historyBtn = document.querySelector('[data-testid="agent-history-btn"]');
                const agentContainer = document.querySelector('[data-testid="agent-panel-container"]');
                const thinkingBlock = document.querySelector('[data-testid="agent-thinking-block"]');
                const retryPill = document.querySelector('[data-testid="agent-retry-recovered-pill"]');
                const toolGroup = document.querySelector('[data-testid="agent-tool-group"]');
                const mdTable = document.querySelector('[data-testid="agent-markdown-table"]');
                const browseBtns = Array.from(document.querySelectorAll("button"))
                    .filter(b => b.textContent?.includes("浏览"))
                    .map(b => ({ text: b.textContent?.trim(), disabled: b.disabled }));
                const canvas = document.querySelector("canvas");
                return {
                    headerDrag: header ? getComputedStyle(header).webkitAppRegion : null,
                    spacerDrag: spacer ? getComputedStyle(spacer).webkitAppRegion : null,
                    spacerWidth: spacer ? Math.round(spacer.getBoundingClientRect().width) : 0,
                    agentBtnRight: agentBtn ? Math.round(agentBtn.getBoundingClientRect().right) : 0,
                    hasResizeHandle: Boolean(resizeHandle),
                    agentWidth: agentContainer ? Math.round(agentContainer.getBoundingClientRect().width) : 0,
                    thinkingCollapsed: thinkingBlock?.getAttribute("data-collapsed") ?? null,
                    retryCollapsed: retryPill?.getAttribute("data-collapsed") ?? null,
                    toolGroupCollapsed: toolGroup?.getAttribute("data-collapsed") ?? null,
                    hasGfmTable: Boolean(mdTable),
                    innerWidth: window.innerWidth,
                    canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
                    browseBtns,
                };
            })()`);
            console.log("[desktop:capture] editorCheck(1366x840 default 340px):", JSON.stringify(editorCheck));
            await snap("04-editor-agent-thread-default.png");

            // 5. Resized wider MoeSekai Agent panel (460px at 1366x840) -> crisp spacious Markdown/table & zero overflow
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setAgentPanelWidth(460);`);
            await sleep(500);
            const resizedCheck = await win.webContents.executeJavaScript(`(() => {
                const agentContainer = document.querySelector('[data-testid="agent-panel-container"]');
                const aside = document.querySelector("aside");
                return {
                    innerWidth: window.innerWidth,
                    agentWidth: agentContainer ? Math.round(agentContainer.getBoundingClientRect().width) : 0,
                    asideRight: aside ? Math.round(aside.getBoundingClientRect().right) : 0,
                };
            })()`);
            console.log("[desktop:capture] resizedCheck(1366x840 width 460px):", JSON.stringify(resizedCheck));
            await snap("05-editor-agent-resized-460.png");

            // 6. 2-tab Agent Conversation History & Snapshots Drawer (380px at 1366x840)
            await win.webContents.executeJavaScript(`
                window.__moesekaiCaptureHook?.setAgentPanelWidth(380);
                window.__moesekaiCaptureHook?.setAgentHistoryDrawerOpen(true, "conversations");
            `);
            await sleep(450);
            const historyCheck = await win.webContents.executeJavaScript(`(() => {
                const drawer = document.querySelector('[data-testid="agent-history-drawer"]');
                const convItems = document.querySelectorAll('[data-testid="agent-conversation-item"]').length;
                const newChatBtn = document.querySelector('[data-testid="agent-new-chat-btn"]');
                return {
                    hasHistoryDrawer: Boolean(drawer),
                    conversationItems: convItems,
                    hasNewChatBtn: Boolean(newChatBtn),
                };
            })()`);
            console.log("[desktop:capture] historyCheck(1366x840):", JSON.stringify(historyCheck));
            await snap("06-editor-agent-history-drawer.png");
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setAgentHistoryDrawerOpen(false);`);

            // 7. Resize to 1280x800 (reset back to default 340px) and verify ZERO right-edge clipping & auto-clamping
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.setAgentPanelWidth(340);`);
            win.setContentSize(1280, 800);
            await sleep(700);
            const compactCheck = await win.webContents.executeJavaScript(`(() => {
                const header = document.querySelector('[data-desktop-topbar="editor"]');
                const spacerL = document.querySelector('[data-drag-spacer="left"]');
                const spacerR = document.querySelector('[data-drag-spacer="right"]');
                const agentBtn = document.querySelector('[data-testid="agent-toggle-btn"]');
                const agentContainer = document.querySelector('[data-testid="agent-panel-container"]');
                const aside = document.querySelector("aside");
                return {
                    innerWidth: window.innerWidth,
                    headerDrag: header ? getComputedStyle(header).webkitAppRegion : null,
                    spacerLDrag: spacerL ? getComputedStyle(spacerL).webkitAppRegion : null,
                    spacerLWidth: spacerL ? Math.round(spacerL.getBoundingClientRect().width) : 0,
                    spacerRWidth: spacerR ? Math.round(spacerR.getBoundingClientRect().width) : 0,
                    agentBtnRight: agentBtn ? Math.round(agentBtn.getBoundingClientRect().right) : 0,
                    maxSafeRight: window.innerWidth - 140,
                    agentWidth: agentContainer ? Math.round(agentContainer.getBoundingClientRect().width) : 0,
                    asideRight: aside ? Math.round(aside.getBoundingClientRect().right) : 0,
                };
            })()`);
            console.log("[desktop:capture] compactCheck(1280x800):", JSON.stringify(compactCheck));
            await snap("07-editor-1280x800.png");

            // 8. Export .msk Dialog open (back at 1366x840)
            win.setContentSize(1366, 840);
            await sleep(300);
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.openExportDialog();`);
            await sleep(700);
            await snap("08-export-msk-dialog.png");

            // 9. Desktop Update Dialog open (capture-only deterministic CNB update-available fixture)
            await win.webContents.executeJavaScript(`window.__moesekaiCaptureHook?.openUpdateDialogPreview();`);
            await sleep(500);
            const updateDialogCheck = await win.webContents.executeJavaScript(`(() => {
                const dialogEl = document.querySelector('[data-testid="update-dialog-content"]');
                const badgeEl = document.querySelector('[data-testid="update-source-badge"]');
                const downloadBtn = document.querySelector('[data-testid="update-download-btn"]');
                const topbarPill = document.querySelector('[data-testid="topbar-update-pill"]');
                return {
                    hasUpdateDialog: Boolean(dialogEl),
                    sourceBadgeText: badgeEl?.textContent?.trim() ?? null,
                    hasDownloadBtn: Boolean(downloadBtn),
                    hasTopbarUpdatePill: Boolean(topbarPill),
                };
            })()`);
            console.log("[desktop:capture] updateDialogCheck(1366x840):", JSON.stringify(updateDialogCheck));
            await snap("09-update-dialog.png");

            console.log("MOESEKAI_CAPTURE_OK");
            updater.dispose();
            await agentHost.dispose();
            workspace.dispose();
            app.exit(0);
            return;
        }

        if (isSmokeTest) {
            const rendererErrors: string[] = [];
            win.webContents.on("console-message", (_ev, level, message) => {
                if (level >= 3) rendererErrors.push(message);
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            const bridgeCheck = await win.webContents.executeJavaScript(`(async () => {
                const api = window.moesekaiDesktop;
                const root = document.getElementById("root");
                const wasmRes = await fetch("moesekai-app://app/live2d-viewer/pkg/sekai_live2d_viewer_bg.wasm");
                const providers = await api.agent.listProviders();
                const cfg = await api.agent.getConfig();
                const anthropic = Array.isArray(providers) ? providers.find(p => p.id === "anthropic") : null;

                // Open Nightcord starter in Edit mode and focus climax talk beat to verify Live2D + ClipPicker + drag-region
                await window.__moesekaiCaptureHook?.openStarterDemo();
                for (let i = 0; i < 60; i++) {
                    if (document.querySelector('[data-desktop-view="editor"] textarea')) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                const focusedBeat = window.__moesekaiCaptureHook?.focusClimaxTalkBeat();
                await new Promise(r => setTimeout(r, 3000));

                const header = document.querySelector('[data-desktop-topbar="editor"]');
                const spacer = document.querySelector('[data-drag-spacer="left"]');
                const agentBtn = document.querySelector('[data-testid="agent-toggle-btn"]');
                const resizeHandle = document.querySelector('[data-testid="agent-resize-handle"]');
                const newChatBtn = document.querySelector('[data-testid="agent-new-chat-btn"]');
                const historyBtn = document.querySelector('[data-testid="agent-history-btn"]');
                const resizedWidth = window.__moesekaiCaptureHook?.setAgentPanelWidth(460) ?? 0;
                await new Promise(r => setTimeout(r, 120));
                const agentContainer = document.querySelector('[data-testid="agent-panel-container"]');
                const actualResizedWidth = agentContainer ? Math.round(agentContainer.getBoundingClientRect().width) : 0;
                window.__moesekaiCaptureHook?.setAgentPanelWidth(340);
                const canvas = document.querySelector("canvas");
                const browseBtns = Array.from(document.querySelectorAll("button"))
                    .filter(b => b.textContent?.includes("浏览"))
                    .map(b => ({ text: b.textContent?.trim(), disabled: b.disabled }));

                return {
                    hasBridge: Boolean(api),
                    hasWorkspaceApi: Boolean(api?.workspace?.openPath && api?.workspace?.save),
                    hasExporterApi: Boolean(api?.exporter?.preflight && api?.exporter?.exportMsk && api?.exporter?.exportBundle),
                    hasAgentApi: Boolean(
                        api?.agent?.prompt &&
                        api?.agent?.runPreset &&
                        api?.agent?.saveConfig &&
                        api?.agent?.fetchModels &&
                        api?.agent?.setThinkingLevel &&
                        api?.agent?.setAuthoringMode &&
                        api?.agent?.approvePlan &&
                        api?.agent?.listSessions &&
                        api?.agent?.resumeSession &&
                        api?.agent?.newSession &&
                        api?.agent?.deleteSession,
                    ),
                    hasFullscreenApi: Boolean(api?.app?.onFullscreenChange),
                    hasUpdatesApi: Boolean(
                        api?.updates?.check &&
                        api?.updates?.ignoreVersion &&
                        api?.updates?.openDownload &&
                        api?.updates?.onUpdateAvailable,
                    ),
                    hasRoot: Boolean(root),
                    rootMounted: Boolean(root && root.childElementCount > 0),
                    origin: window.location.origin,
                    live2dWasmStatus: wasmRes.status,
                    live2dWasmContentType: wasmRes.headers.get("content-type"),
                    providerCount: Array.isArray(providers) ? providers.length : 0,
                    anthropicDefaultModel: anthropic?.defaultModel ?? null,
                    activeModel: cfg?.model ?? null,
                    focusedBeat,
                    canvasReady: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
                    browseButtonsCount: browseBtns.length,
                    allBrowseEnabled: browseBtns.length >= 2 && browseBtns.every(b => !b.disabled),
                    headerDrag: header ? getComputedStyle(header).webkitAppRegion : null,
                    spacerDrag: spacer ? getComputedStyle(spacer).webkitAppRegion : null,
                    spacerWidth: spacer ? Math.round(spacer.getBoundingClientRect().width) : 0,
                    agentBtnFitsWindow: agentBtn ? agentBtn.getBoundingClientRect().right <= window.innerWidth - 136 : false,
                    hasResizeHandle: Boolean(resizeHandle),
                    hasNewChatBtn: Boolean(newChatBtn),
                    hasHistoryBtn: Boolean(historyBtn),
                    resizedWidth,
                    actualResizedWidth,
                };
            })()`);

            const appInfoFromBridge = await win.webContents.executeJavaScript(`window.moesekaiDesktop.app.getInfo()`);
            console.log("[desktop:smoke] bridgeCheck:", JSON.stringify(bridgeCheck));
            console.log("[desktop:smoke] appInfo:", JSON.stringify(appInfoFromBridge));
            if (rendererErrors.length > 0) {
                console.error("[desktop:smoke] rendererErrors:", rendererErrors);
            }

            const isDraggableOs = process.platform === "win32" || process.platform === "darwin";
            const dragOk = !isDraggableOs || (
                bridgeCheck?.headerDrag === "drag" &&
                bridgeCheck?.spacerDrag === "drag" &&
                bridgeCheck?.spacerWidth >= 16
            );

            if (
                !bridgeCheck?.hasBridge ||
                !bridgeCheck?.hasWorkspaceApi ||
                !bridgeCheck?.hasExporterApi ||
                !bridgeCheck?.hasAgentApi ||
                !bridgeCheck?.hasFullscreenApi ||
                !bridgeCheck?.hasUpdatesApi ||
                !bridgeCheck?.hasRoot ||
                !bridgeCheck?.rootMounted ||
                bridgeCheck?.live2dWasmStatus !== 200 ||
                bridgeCheck?.live2dWasmContentType !== "application/wasm" ||
                !(bridgeCheck?.providerCount > 0) ||
                !bridgeCheck?.canvasReady ||
                !bridgeCheck?.allBrowseEnabled ||
                !dragOk ||
                !bridgeCheck?.agentBtnFitsWindow ||
                !bridgeCheck?.hasResizeHandle ||
                !bridgeCheck?.hasNewChatBtn ||
                !bridgeCheck?.hasHistoryBtn ||
                bridgeCheck?.actualResizedWidth !== 460
            ) {
                console.error("[desktop:smoke] Verification failed!");
                await agentHost.dispose();
                workspace.dispose();
                app.exit(1);
                return;
            }

            console.log("MOESEKAI_SMOKE_OK");
            await agentHost.dispose();
            workspace.dispose();
            app.exit(0);
        }
    };

    await createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void createWindow();
        }
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("before-quit", () => {
        updater.dispose();
        workspace.dispose();
        void agentHost.dispose();
    });
}

if (gotLock) {
    void bootstrap().catch(err => {
        console.error("[desktop:main] Fatal startup error:", err);
        app.exit(1);
    });
}
