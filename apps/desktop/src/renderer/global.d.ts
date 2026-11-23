import type { DesktopThemeMode, MoesekaiDesktopApi } from "../shared/ipc";

export interface MoesekaiCaptureHook {
    setTheme(mode: DesktopThemeMode): void;
    openCreateDialog(): void;
    closeCreateDialog(): void;
    openStarterDemo(): Promise<void>;
    openExportDialog(): void;
    /** Selects a live scene talk beat (preferring a climax scene with actors on stage) for Live2D + ClipPicker verification. */
    focusClimaxTalkBeat(): { nodeId: string; beatId: string } | null;
    /** Injects a realistic capture-only Agent thread fixture for visual UI verification. */
    injectAgentPreviewFixture(): boolean;
    /** Clears Agent thread to show minimalist empty Usage Guide during capture/smoke runs. */
    showAgentEmptyGuide(): boolean;
    /** Opens or closes the Agent footer Model Picker popover during capture runs. */
    setAgentModelPopoverOpen(open: boolean): boolean;
    /** Opens or closes the 2-tab Agent History Drawer during capture runs. */
    setAgentHistoryDrawerOpen(open: boolean, tab?: "conversations" | "snapshots"): boolean;
    /** Switches to Player (Theater) view directly during capture/smoke runs. */
    switchToTheaterPlayer(): void;
    /** Opens unified SettingsDialog on the requested tab during capture/smoke runs. */
    openSettingsDialog(tab?: "general" | "stage" | "agent"): void;
    /** Opens UpdateDialog with a deterministic CNB update-available fixture (capture-only). */
    openUpdateDialogPreview(): void;
    /** Opens dedicated AssetCacheDialog during capture/smoke runs. */
    openCacheDialog(): void;
    /** Opens dedicated AboutNoticesDialog during capture/smoke runs. */
    openNoticesDialog(): void;
    /** Closes all dialogs cleanly during capture/smoke runs. */
    closeAllDialogs(): void;
    /** Switches the editor workspace into Playtest mode (for verifying Player attribution badge). */
    switchToPlaytestMode(): void;
    /** Updates the Agent side panel width deterministically during capture/smoke runs. */
    setAgentPanelWidth(width: number): number;
}

declare global {
    interface Window {
        moesekaiDesktop: MoesekaiDesktopApi;
        __moesekaiCaptureHook?: MoesekaiCaptureHook;
    }
}

export {};
