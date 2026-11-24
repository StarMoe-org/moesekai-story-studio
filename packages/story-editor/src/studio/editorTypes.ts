import type { ReactNode } from "react";
import type { StoryDocument, StoryPreloadProgress, StoryRegion, StoryVoiceManifest } from "@moesekai/story-core";
import type { VoiceManifestUploadTabConfig } from "../components/StoryVoiceManifestDialog";
import type { EditorLayoutState } from "../components/useEditorLayout";
import type { MenuItemDef } from "../md3";

export type StoryEditorSaveStatus = "saved" | "dirty" | "saving" | "error";
export type StoryEditorWorkspaceMode = "edit" | "playtest" | "code";

export interface EditorSlotContext {
    /** Current committed `StoryDocument`. */
    doc: StoryDocument;
    /** Active document including live valid edits in Code mode (`codeEval.doc` when valid, else `doc`). */
    effectiveDoc: StoryDocument;
    /** Active draft identifier (or null in controlled/external-doc mode). */
    draftId: string | null;
    /** Current workspace mode (`"edit"` | `"playtest"` | `"code"`). */
    workspaceMode: StoryEditorWorkspaceMode;
    /** Currently selected graph node ID. */
    selectedNodeId: string | null;
    /** Currently selected beat ID within a scene node. */
    selectedBeatId: string | null;
    /** Compiler error count. */
    errorCount: number;
    /** Compiler warning count. */
    warningCount: number;
    /** True when `errorCount > 0`. */
    hasBlockingErrors: boolean;
    /** Current autosave/persistence status. */
    saveStatus: StoryEditorSaveStatus;
    /** Show a toast notification in the editor Snackbar. */
    notify: (message: string) => void;
    /** Open the custom voice track manifest dialog (defaults to the host upload tab when provided). */
    openVoiceManifestDialog: (tab?: "import" | "upload") => void;
    /** True when a custom voice track manifest with at least one line is mounted. */
    hasVoiceManifest: boolean;
    /** Currently mounted custom voice track manifest (or null when unmounted). */
    currentVoiceManifest: StoryVoiceManifest | null;
    /** Mount or clear the active playtest custom voice track manifest. */
    applyVoiceManifest: (manifest: StoryVoiceManifest | null) => void;
    /** Commit a document update onto the editor undo stack and mark dirty. */
    commitDoc: (updater: (current: StoryDocument) => StoryDocument) => void;
    /** Trigger `.msk` export (uses `onRequestExport` if provided, else `exporter.exportMsk`). */
    requestExport: () => void;
    /** Switch between `"edit"`, `"playtest"`, and `"code"` modes. */
    setWorkspaceMode: (mode: StoryEditorWorkspaceMode) => void;
}

export interface EditorTopBarSlotContext extends EditorSlotContext {
    /** Display title of the active story (falls back to localized untitled label). */
    title: string;
    /** Active story asset server region. */
    region: StoryRegion;
    /** Localized server display label for `region`. */
    regionLabel: string;
    /** Built-in File dropdown menu items (includes `slots.fileMenuItems`). */
    fileMenuItems: MenuItemDef[];
    /** Built-in Edit dropdown menu items. */
    editMenuItems: MenuItemDef[];
    /** Built-in View dropdown menu items. */
    viewMenuItems: MenuItemDef[];
    /** Undo / Redo availability & actions. */
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
    /** Localized label for `saveStatus`. */
    saveStatusLabel: string;
    /** Flush any pending unsaved changes immediately (returns `true` if persisted cleanly). */
    saveNow: () => Promise<boolean>;
    /** Number of attached translation locale packs on `doc`. */
    attachedLocaleCount: number;
    /** Built-in dialog openers for custom top bar controls. */
    openMetaDialog: () => void;
    openI18nDialog: () => void;
    openIssuesDialog: () => void;
    openPreloadDialog: () => void;
    openImportDialog: () => void;
    /** Background asset preload status (useful for displaying live preload state in custom host top bars). */
    preloadRunning?: boolean;
    preloadProgress?: StoryPreloadProgress | null;
    preloadReady?: boolean;
    /** Current pane layout state and toggle helpers. */
    layout: EditorLayoutState;
    toggleLeft: () => void;
    toggleRight: () => void;
    toggleBottom: () => void;
    resetLayout: () => void;
    /** Stage web-fullscreen state & toggle. */
    isFullscreen: boolean;
    toggleFullscreen: () => void;
    /** Optional programmatic callback for Back to Drafts. */
    onBackToDrafts?: () => void;
    /** Href for Back to Drafts link. */
    backToDraftsHref: string;
}

export interface StoryStudioEditorSlots {
    /**
     * Replaces the built-in IDE top bar completely (e.g. Electron unified 44px frameless title/toolbar).
     * When omitted (Web default), `<StoryStudioEditor>` renders its standard IDE header bar.
     */
    replaceTopBar?: (ctx: EditorTopBarSlotContext) => ReactNode;
    /** Optional bar rendered above the permanent IDE header (e.g. Electron native Workspace bar). */
    workspaceBar?: (ctx: EditorSlotContext) => ReactNode;
    /** Extra menu items inserted into the File dropdown menu (e.g. Web Publish/Update or Desktop Open Folder / Enhanced Export). */
    fileMenuItems?: (ctx: EditorSlotContext) => MenuItemDef[];
    /** Extra buttons/pills rendered in the right toolbar cluster (e.g. Web Publish button or Electron Pi Agent / Export toggles). */
    toolbarActions?: (ctx: EditorSlotContext) => ReactNode;
    /** Optional second tab rendered inside `StoryVoiceManifestDialog` (e.g. Web Community Audio Upload panel). */
    voiceManifestUploadTab?: (ctx: EditorSlotContext) => VoiceManifestUploadTabConfig | null;
    /** Host-owned dialogs rendered alongside the editor (e.g. Web `StoryPublishDialog`, Desktop Export/Agent Settings dialogs). */
    renderDialogs?: (ctx: EditorSlotContext) => ReactNode;
    /** Set true while any host-owned modal/dialog is open to pause editor keyboard shortcuts & playtest auto-advance. */
    hasExternalDialogOpen?: boolean;
    /** Optional collapsible docked side panel mounted beside the workspace without unmounting the Live2D stage (e.g. Electron Pi Agent panel). */
    sidePanel?: (ctx: EditorSlotContext) => ReactNode;
}

export interface ReloadFromScriptOptions {
    preserveSelection?: boolean;
    silent?: boolean;
    markSaved?: boolean;
}

export interface ReloadFromDocOptions {
    preserveSelection?: boolean;
    pushHistory?: boolean;
    markSaved?: boolean;
    silent?: boolean;
}

/** How an outside author (e.g. an AI agent) changed a node since the user last looked. */
export type StoryNodeChange = "added" | "modified";

export interface StoryStudioEditorHandle {
    /** Parse `.msk` script text and hot-reload the live editor canvas (e.g. from Electron FS watcher or Pi Agent). */
    reloadFromScript: (
        script: string,
        options?: ReloadFromScriptOptions,
    ) => { ok: boolean; error?: string; doc?: StoryDocument };
    /** Replace the live document directly (optionally preserving undo history or marking clean). */
    reloadFromDoc: (nextDoc: StoryDocument, options?: ReloadFromDocOptions) => void;
    /** Select and pan the Flow Canvas viewport to `nodeId` (and optional `beatId`). */
    focusNode: (nodeId: string, beatId?: string | null) => void;
    /** Select a specific beat within a scene node. */
    selectBeat: (nodeId: string, beatId: string | null) => void;
    /** Switch workspace mode (`"edit"` | `"playtest"` | `"code"`). */
    setWorkspaceMode: (mode: StoryEditorWorkspaceMode) => void;
    /** Start interactive playtest from `nodeId` (or story start node if omitted). */
    playtestFromNode: (nodeId?: string) => void;
    /** Returns the current committed `StoryDocument`, or null while loading. */
    getCurrentDoc: () => StoryDocument | null;
    /** Returns the effective document (including valid Code mode edits), or null while loading. */
    getEffectiveDoc: () => StoryDocument | null;
    /** Returns the currently selected graph node ID. */
    getSelectedNodeId: () => string | null;
    /** Returns the currently selected beat ID. */
    getSelectedBeatId: () => string | null;
    /** Returns the current workspace mode. */
    getWorkspaceMode: () => StoryEditorWorkspaceMode;
    /** Returns true when there are uncommitted Code mode edits, dirty document edits, or an in-flight/failed save. */
    hasUnsavedChanges: () => boolean;
    /** Immediately flush any pending unsaved changes (including valid Code mode edits). Returns `true` if saved cleanly. */
    saveNow: () => Promise<boolean>;
    /** Open the custom voice track manifest dialog. */
    openVoiceManifestDialog: (tab?: "import" | "upload") => void;
    /** Trigger export (`onRequestExport` or `exporter.exportMsk`). */
    openExportDialog: () => void;
    /** Marks nodes on the Flow Canvas as added or modified by an outside author; `null` clears the marks. */
    showNodeChanges: (changes: ReadonlyMap<string, StoryNodeChange> | null) => void;
}

export interface StoryStudioEditorProps {
    /** Draft ID loaded & saved via `<StoryStudioProvider storage>`. Optional if `initialDoc`/`externalDoc` is supplied. */
    draftId?: string | null;
    /** Optional directly-supplied document (e.g. Electron local `.msk` workspace). Overrides storage loading when provided. */
    externalDoc?: StoryDocument | null;
    /** Stable key identifying `externalDoc` (remounts/resets undo stacks when switching workspace files). */
    externalDocKey?: string;
    /** Optional custom save handler (used instead of `storage.saveDraft` when provided, e.g. Electron workspace file save). */
    onSaveDoc?: (doc: StoryDocument, draftId: string | null) => Promise<void> | void;
    /** Notifies host whenever the committed document changes in memory (`meta.dirty === false` on clean external reloads). */
    onDocChange?: (doc: StoryDocument, meta?: { dirty?: boolean }) => void;
    /** Notifies host when selection changes (useful for Pi Agent prompt context). */
    onSelectionChange?: (selection: { nodeId: string | null; beatId: string | null }) => void;
    /** Optional initial workspace mode (`"edit"` | `"playtest"` | `"code"`). */
    initialMode?: StoryEditorWorkspaceMode | null;
    /** Optional initial node ID (e.g. from `?node=` query param). */
    initialNodeId?: string | null;
    /** Whether to enter immersive full-viewport mode initially (default: `true`). */
    initialImmersive?: boolean;
    /** When true, displays the desktop-only notice below `1024px` without mounting WebGPU (Web sets `true`; Desktop leaves `false`). */
    enforceDesktopViewport?: boolean;
    /**
     * Shown below `1024px` in place of the desktop-only notice when `enforceDesktopViewport` is set
     * (e.g. a phone agent screen). It mounts only once the viewport width is known, never on wide screens.
     */
    narrowViewport?: ReactNode;
    /** Called when the user toggles immersive mode. */
    onImmersiveChange?: (immersive: boolean, meta: { effective: boolean; userTriggered: boolean }) => void;
    /** Called whenever effective immersive state (`immersive && !loadError`) changes, for host shell suppression. */
    onEffectiveImmersiveChange?: (effectiveImmersive: boolean) => void;
    /** Called whenever workspace mode changes. */
    onModeChange?: (mode: StoryEditorWorkspaceMode) => void;
    /** Optional override for `.msk` export action (e.g. Electron Enhanced Export Dialog). */
    onRequestExport?: (doc: StoryDocument) => void;
    /** Optional callback when creating a starter draft from the Not Found empty state. */
    onCreatedDraft?: (draftId: string) => void;
    /** Href for Back to Drafts link (default `"/story-maker"`). */
    backToDraftsHref?: string;
    /** Optional programmatic callback for Back to Drafts. */
    onBackToDrafts?: () => void;
    /** Href for Home menu item (default `"/"`; pass `null` to hide in Electron). */
    homeHref?: string | null;
    /** Href builder for Play button in the mobile desktop-only notice. */
    getDraftPlayHref?: (draftId: string) => string;
    /** Initial custom voice track manifest mounted for playtest (e.g. loaded from Desktop `voices/manifest.json`). */
    initialVoiceManifest?: StoryVoiceManifest | null;
    /** Called whenever the mounted custom voice track manifest is applied, updated, or cleared in the editor. */
    onVoiceManifestChange?: (manifest: StoryVoiceManifest | null) => void;
    /** Host slots for Web Community features or Electron Workspace / Pi Agent integration. */
    slots?: StoryStudioEditorSlots;
}
