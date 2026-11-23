import { app, shell } from "electron";
import type { DesktopAppSettings, UpdateCheckRequest } from "../shared/ipc.ts";
import {
    checkForDesktopUpdates,
    DEFAULT_UPDATE_REPO_SLUG,
    isSafeHttpsUrl,
    normalizeVersion,
    shouldNotifyUpdate,
    type DesktopUpdateCheckResult,
} from "../shared/updater.ts";
import type { DesktopSettingsStore } from "./settings.ts";

export interface DesktopUpdateServiceOptions {
    settingsStore: DesktopSettingsStore;
    currentVersion?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

/**
 * Main-process Desktop Update Checker coordinating:
 * - CNB primary + automatic silent GitHub fallback
 * - Delayed non-blocking startup check when `autoCheckUpdates === true`
 * - Ignored-version suppression persisted via `DesktopSettingsStore`
 * - Strictly validated `https://` external download launches
 */
export class DesktopUpdateService {
    private readonly settingsStore: DesktopSettingsStore;
    private readonly currentVersion: string;
    private readonly platform: NodeJS.Platform;
    private readonly arch: string;
    private readonly fetchImpl?: typeof fetch;
    private readonly timeoutMs: number;
    private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
    private lastResult: DesktopUpdateCheckResult | null = null;

    constructor(options: DesktopUpdateServiceOptions) {
        this.settingsStore = options.settingsStore;
        this.currentVersion = options.currentVersion ?? app.getVersion();
        this.platform = options.platform ?? process.platform;
        this.arch = options.arch ?? process.arch;
        this.fetchImpl = options.fetchImpl;
        this.timeoutMs = options.timeoutMs ?? 8_000;
    }

    getLastResult(): DesktopUpdateCheckResult | null {
        return this.lastResult;
    }

    async check(req?: UpdateCheckRequest): Promise<DesktopUpdateCheckResult> {
        const settings = this.settingsStore.getAppSettings();
        const channel = req?.channel ?? settings.updateChannel;
        const repoSlug = process.env.MOESEKAI_UPDATE_REPO?.trim() || DEFAULT_UPDATE_REPO_SLUG;

        const result = await checkForDesktopUpdates({
            currentVersion: this.currentVersion,
            channel,
            platform: this.platform,
            arch: this.arch,
            repoSlug,
            cnbApiUrl: process.env.MOESEKAI_CNB_RELEASE_API,
            githubApiUrl: process.env.MOESEKAI_GITHUB_RELEASE_API,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.timeoutMs,
        });

        this.lastResult = result;
        return result;
    }

    ignoreVersion(version: string | null): DesktopAppSettings {
        const cleaned = version ? normalizeVersion(version) || null : null;
        return this.settingsStore.updateAppSettings({
            ignoredUpdateVersion: cleaned,
        });
    }

    async openDownload(url: string): Promise<void> {
        if (!isSafeHttpsUrl(url)) {
            throw new Error("Refused to open non-HTTPS update URL.");
        }
        await shell.openExternal(url);
    }

    /**
     * Schedules a single delayed non-blocking update check after startup.
     * Only notifies the renderer when `autoCheckUpdates === true`, an update is available,
     * and the latest version has not been ignored by the user.
     */
    scheduleAutoCheck(
        onUpdateAvailable: (result: DesktopUpdateCheckResult) => void,
        delayMs = 4_000,
    ): void {
        this.cancelAutoCheck();
        const initialSettings = this.settingsStore.getAppSettings();
        if (!initialSettings.autoCheckUpdates) return;

        this.autoCheckTimer = setTimeout(() => {
            this.autoCheckTimer = null;
            const currentSettings = this.settingsStore.getAppSettings();
            if (!currentSettings.autoCheckUpdates) return;

            void this.check({ channel: currentSettings.updateChannel, manual: false })
                .then(result => {
                    const latestSettings = this.settingsStore.getAppSettings();
                    if (shouldNotifyUpdate(result, latestSettings.ignoredUpdateVersion)) {
                        onUpdateAvailable(result);
                    }
                })
                .catch(() => {
                    // Silent background check never interrupts editing
                });
        }, delayMs);
    }

    cancelAutoCheck(): void {
        if (this.autoCheckTimer) {
            clearTimeout(this.autoCheckTimer);
            this.autoCheckTimer = null;
        }
    }

    dispose(): void {
        this.cancelAutoCheck();
    }
}
