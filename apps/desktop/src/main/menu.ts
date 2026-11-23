import { Menu, app, shell, type MenuItemConstructorOptions } from "electron";
import type {
    DesktopAppSettings,
    MenuCommand,
    RecentProjectEntry,
} from "../shared/ipc.ts";
import { CHARACTER_THEME_SEEDS, DESKTOP_LOCALE_OPTIONS } from "../shared/theme-seeds.ts";

export interface BuildMenuContext {
    settings: DesktopAppSettings;
    recentProjects: RecentProjectEntry[];
    hasActiveProject: boolean;
    sendCommand: (cmd: MenuCommand) => void;
}

export function buildAndApplyAppMenu(ctx: BuildMenuContext): void {
    const isMac = process.platform === "darwin";

    const recentSubmenu: MenuItemConstructorOptions[] =
        ctx.recentProjects.length > 0
            ? ctx.recentProjects.slice(0, 10).map(item => ({
                label: `${item.title} (${item.isSingleFile ? "file" : "folder"})`,
                sublabel: item.path,
                click: () => ctx.sendCommand({ type: "open-recent", path: item.path }),
            }))
            : [{ label: "No Recent Projects", enabled: false }];

    const seedSubmenu: MenuItemConstructorOptions[] = CHARACTER_THEME_SEEDS.map(seed => ({
        label: `${seed.name} (${seed.unit})`,
        type: "radio",
        checked: ctx.settings.themeSeed === seed.id,
        click: () => ctx.sendCommand({ type: "set-theme-seed", seed: seed.id }),
    }));

    const localeSubmenu: MenuItemConstructorOptions[] = DESKTOP_LOCALE_OPTIONS.map(opt => ({
        label: opt.label,
        type: "radio",
        checked: ctx.settings.locale === opt.code,
        click: () => ctx.sendCommand({ type: "set-locale", locale: opt.code }),
    }));

    const template: MenuItemConstructorOptions[] = [
        ...(isMac
            ? ([
                {
                    label: app.name,
                    submenu: [
                        { role: "about" },
                        { type: "separator" },
                        {
                            label: "Preferences…",
                            accelerator: "CmdOrCtrl+,",
                            click: () => ctx.sendCommand({ type: "open-settings", tab: "general" }),
                        },
                        { type: "separator" },
                        { role: "services" },
                        { type: "separator" },
                        { role: "hide" },
                        { role: "hideOthers" },
                        { role: "unhide" },
                        { type: "separator" },
                        { role: "quit" },
                    ],
                },
            ] satisfies MenuItemConstructorOptions[])
            : []),
        {
            label: "File",
            submenu: [
                {
                    label: "New Story Project…",
                    accelerator: "CmdOrCtrl+N",
                    click: () => ctx.sendCommand({ type: "new-project" }),
                },
                {
                    label: "Open Project Folder…",
                    accelerator: "CmdOrCtrl+O",
                    click: () => ctx.sendCommand({ type: "open-folder" }),
                },
                {
                    label: "Open .msk File…",
                    accelerator: "CmdOrCtrl+Shift+O",
                    click: () => ctx.sendCommand({ type: "open-msk" }),
                },
                {
                    label: "Open Recent",
                    submenu: recentSubmenu,
                },
                { type: "separator" },
                {
                    label: "Save Project",
                    accelerator: "CmdOrCtrl+S",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "save" }),
                },
                { type: "separator" },
                {
                    label: "Export .msk…",
                    accelerator: "CmdOrCtrl+Shift+E",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "export-msk" }),
                },
                {
                    label: "Export Full Story Bundle…",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "export-bundle" }),
                },
                {
                    label: "Reveal Project Folder",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "reveal-project" }),
                },
                { type: "separator" },
                {
                    label: "Preferences…",
                    accelerator: "CmdOrCtrl+,",
                    click: () => ctx.sendCommand({ type: "open-settings", tab: "general" }),
                },
                { type: "separator" },
                isMac ? { role: "close" } : { role: "quit" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
            ],
        },
        {
            label: "View",
            submenu: [
                {
                    label: "Theme Mode",
                    submenu: [
                        {
                            label: "Light",
                            type: "radio",
                            checked: ctx.settings.themeMode === "light",
                            click: () => ctx.sendCommand({ type: "set-theme-mode", mode: "light" }),
                        },
                        {
                            label: "Dark",
                            type: "radio",
                            checked: ctx.settings.themeMode === "dark",
                            click: () => ctx.sendCommand({ type: "set-theme-mode", mode: "dark" }),
                        },
                    ],
                },
                {
                    label: "Character Theme Seed",
                    submenu: seedSubmenu,
                },
                {
                    label: "Language",
                    submenu: localeSubmenu,
                },
                { type: "separator" },
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            label: "Agent",
            submenu: [
                {
                    label: "Toggle MoeSekai Agent Panel",
                    accelerator: "CmdOrCtrl+Shift+A",
                    click: () => ctx.sendCommand({ type: "toggle-agent-panel" }),
                },
                { type: "separator" },
                {
                    label: "Validate & Auto-Fix Story",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "run-agent-preset", preset: "fix_validation_issues" }),
                },
                {
                    label: "Translate Story (i18n Pack)",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "run-agent-preset", preset: "translate_story" }),
                },
                {
                    label: "Generate Voice Cue Sheet & Manifest",
                    enabled: ctx.hasActiveProject,
                    click: () => ctx.sendCommand({ type: "run-agent-preset", preset: "prepare_tts_manifest" }),
                },
                { type: "separator" },
                {
                    label: "MoeSekai Agent Settings…",
                    click: () => ctx.sendCommand({ type: "open-agent-settings" }),
                },
            ],
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "Check for Updates…",
                    click: () => ctx.sendCommand({ type: "check-for-updates" }),
                },
                { type: "separator" },
                {
                    label: "Open MoeSekai Story Player (pjsk.moe)",
                    click: () => {
                        void shell.openExternal("https://pjsk.moe/story-maker/play");
                    },
                },
                { type: "separator" },
                {
                    label: "Local Asset Cache…",
                    click: () => ctx.sendCommand({ type: "open-cache-dialog" }),
                },
                {
                    label: "About & Legal Notices…",
                    click: () => ctx.sendCommand({ type: "open-notices" }),
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}
