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
    /** Opens or closes the 2-tab Agent History Drawer during capture runs. */
    setAgentHistoryDrawerOpen(open: boolean, tab?: "conversations" | "snapshots"): boolean;
    /** Opens UpdateDialog with a deterministic CNB update-available fixture (capture-only). */
    openUpdateDialogPreview(): void;
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
