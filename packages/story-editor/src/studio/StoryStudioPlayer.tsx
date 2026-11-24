"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    compileStoryGraph,
    downloadStoryScript,
    parseAndValidateLocalePack,
    SERVER_LABEL_KEYS,
    StoryDraftsUnavailableError,
    SUPPORTED_UI_LOCALES,
    UI_LOCALE_LABELS,
    upsertStoryLocalePack,
    type StoryDocument,
    type StoryPreloadProgress,
    type StoryRegion,
    type StoryVoiceManifest,
    type UiLocale,
} from "@moesekai/story-core";
import { StoryImportDialog } from "../components/StoryImportDialog";
import { StoryPlayerView, type PlayerLayoutMode } from "../components/StoryPlayerView";
import { StoryVoiceManifestDialog } from "../components/StoryVoiceManifestDialog";
import { useStoryStudio } from "../context/StoryStudioContext";
import {
    Banner, Button, Card, Dialog, EmptyState, Icon, IconButton, LoadingState, Menu, PageContainer,
    PageHeader, SegmentedButton, Snackbar, StudioLink, cn, type MenuItemDef,
} from "../md3";
import {
    mdArrowBack, mdBookmarkAdd, mdCloseFullscreen, mdCloudDone, mdCode, mdDashboard, mdDownload, mdEdit,
    mdErrorFill, mdHome, mdMoreVert, mdOpenInFull, mdPlayArrowFill, mdRecordVoiceOver, mdRightPanelClose,
    mdRightPanelOpen, mdTheaters, mdTranslate, mdUploadFile, mdWarning,
} from "../md3/icons";

export interface StoryPlayerExternalSource {
    /** Stable key identifying this external story (e.g. `"community:42"` or `"workspace:story.msk"`). */
    key: string;
    doc: StoryDocument;
    voiceManifest?: StoryVoiceManifest | null;
    /** Optional badge text shown in header/eyebrow. */
    badge?: string;
}

export interface StoryPlayerExternalError {
    title: string;
    description: string;
    action?: ReactNode;
}

export interface StoryPlayerSlotContext {
    doc: StoryDocument | null;
    sourceKind: "empty" | "draft" | "external" | "imported";
    draftId: string | null;
    immersive: boolean;
    layoutMode: PlayerLayoutMode;
    notify: (message: string) => void;
    openImportDialog: () => void;
    openVoiceManifestDialog: () => void;
}

export interface PlayerTopBarSlotContext extends StoryPlayerSlotContext {
    /** Display title of the active story (falls back to localized player/untitled label). */
    title: string;
    /** Active story server region (null when no story is loaded). */
    region: StoryRegion | null;
    /** Localized display label for `region` (null when no story is loaded). */
    regionLabel: string | null;
    /** Switch between `"workspace"` and `"theater"` layout modes. */
    setLayoutMode: (mode: PlayerLayoutMode) => void;
    /** Toggle immersive full-viewport mode. */
    setImmersive: (immersive: boolean) => void;
    /** Export the active story as `.msk`. */
    exportScript: () => void;
    /** Open the file picker to load a `.i18n.json` locale pack. */
    openLocalePackPicker: () => void;
    /** Built-in overflow menu items for immersive mode. */
    moreItems: MenuItemDef[];
    /** True when a custom voice track manifest is mounted. */
    hasVoiceManifest: boolean;
    /** Save an imported script as a local draft when `sourceKind === "imported"`. */
    saveImportedAsDraft?: () => Promise<void>;
    /** Back & edit navigation hooks. */
    onBackToDrafts?: () => void;
    backToDraftsHref: string;
    onEditDraft?: (draftId: string) => void;
    editHref: string | null;
    /** Open the player's asset preload dialog from a custom top bar (when a story is loaded). */
    openPreloadDialog?: () => void;
    /** Live background preload state reported by `<StoryPlayerView>`. */
    preloadRunning?: boolean;
    preloadProgress?: StoryPreloadProgress | null;
    preloadReady?: boolean;
    /** True when `slots.companionPanel` renders non-null content for the active story. */
    hasCompanionPanel?: boolean;
    /** Whether the desktop right companion rail is expanded (Theater View only). */
    companionPanelOpen?: boolean;
    /** Toggle the desktop right companion rail open/closed. */
    toggleCompanionPanel?: () => void;
}

export interface StoryStudioPlayerSlots {
    /**
     * Replaces the built-in top bar (both immersive header bar and standard PageHeader).
     * When omitted (Web default), `<StoryStudioPlayer>` renders its standard header.
     */
    replaceTopBar?: (ctx: PlayerTopBarSlotContext) => ReactNode;
    /** Extra actions rendered in both the immersive header bar and the standard PageHeader. */
    headerActions?: (ctx: StoryPlayerSlotContext) => ReactNode;
    /** Extra menu items prepended to the immersive overflow menu. */
    immersiveMoreItems?: (ctx: StoryPlayerSlotContext) => MenuItemDef[];
    /** Custom action rendered on the ending overlay card (overrides default Edit / Open Script when returned non-nullish). */
    endAction?: (ctx: StoryPlayerSlotContext) => ReactNode;
    /**
     * Optional content rendered below the 16:9 stage + transport bar (and mobile inline ending card)
     * inside the main column in Theater View (e.g. video-site story title, author, like, Fork, description).
     * Auto-hidden in `"workspace"` mode without unmounting the Live2D stage.
     */
    belowStage?: (ctx: StoryPlayerSlotContext) => ReactNode;
    /**
     * Optional video-site companion pane (e.g. Community Comments):
     * - On `< lg` viewports in Theater View: stacked inline below `belowStage` in vertical scroll flow.
     * - On `lg:+` viewports in Theater View: docked as an independently scrollable right rail
     *   (`lg:w-[380px] xl:w-[420px]`), collapsible via the desktop top-bar toggle (open by default).
     * - Auto-hidden in `"workspace"` mode so Director Workspace keeps full width, without unmounting
     *   `<StoryPlayerView>` or resetting the WebGPU Live2D stage.
     */
    companionPanel?: (ctx: StoryPlayerSlotContext) => ReactNode;
}

export interface StoryStudioPlayerProps {
    draftId?: string | null;
    startNodeId?: string | null;
    initialLocale?: UiLocale | null;
    /** Optional controlled layout mode (`"workspace"` | `"theater"`). Overrides internal layout state when provided. */
    layoutMode?: PlayerLayoutMode;
    initialLayoutMode?: PlayerLayoutMode;
    initialImmersive?: boolean;
    /** Suppresses the built-in top bar completely (alternative to `slots.replaceTopBar` when host renders its own bar). */
    hideTopBar?: boolean;
    onLayoutModeChange?: (mode: PlayerLayoutMode) => void;
    /** Called when user toggles immersive mode (`meta.userTriggered === true`) or when effective immersive changes (`meta.effective`). */
    onImmersiveChange?: (immersive: boolean, meta: { effective: boolean; userTriggered: boolean }) => void;
    /** Dedicated callback receiving the effective immersive boolean (`Boolean(activeDoc) && immersive`) for shell chrome suppression. */
    onEffectiveImmersiveChange?: (effectiveImmersive: boolean) => void;
    /** External story injected by the host (e.g. Web Community Story `?postId=` or Desktop local file). */
    externalSource?: StoryPlayerExternalSource | null;
    externalLoading?: boolean;
    externalError?: StoryPlayerExternalError | null;
    /** Called when user imports a local `.msk` file so host can clear external source / URL params. */
    onClearExternalSource?: () => void;
    /** Called when an imported story is saved as a new draft in `storage`. */
    onSavedDraft?: (draftId: string) => void;
    /** Href for Back to Drafts button/link (default `"/story-maker"`). */
    backToDraftsHref?: string;
    /** Optional programmatic callback for Back to Drafts. */
    onBackToDrafts?: () => void;
    /** Href for Home menu item (default `"/"`; pass `null` to omit on Electron). */
    homeHref?: string | null;
    /** Href builder for Edit button when playing a saved draft. */
    getEditHref?: (draftId: string, immersive: boolean) => string;
    /** Optional programmatic callback for Edit button. */
    onEditDraft?: (draftId: string) => void;
    slots?: StoryStudioPlayerSlots;
}

/** Pure resolver preferring controlled `layoutMode` when passed, otherwise internal state. */
export function resolveEffectivePlayerLayoutMode(params: {
    controlledLayoutMode?: PlayerLayoutMode;
    internalLayoutMode: PlayerLayoutMode;
}): PlayerLayoutMode {
    return params.controlledLayoutMode ?? params.internalLayoutMode;
}

/** Pure visibility predicate for `belowStage` and `companionPanel` across Theater vs Workspace modes. */
export function resolvePlayerCompanionVisibility(params: {
    layoutMode: PlayerLayoutMode;
    hasBelowStage: boolean;
    hasCompanionPanel: boolean;
    companionPanelOpen: boolean;
}): {
    showBelowStage: boolean;
    showCompanionPanel: boolean;
    showCompanionDesktopRail: boolean;
    hasVideoSiteContent: boolean;
} {
    const isTheater = params.layoutMode === "theater";
    const showBelowStage = isTheater && params.hasBelowStage;
    const showCompanionPanel = isTheater && params.hasCompanionPanel;
    const showCompanionDesktopRail = showCompanionPanel && params.companionPanelOpen;
    return {
        showBelowStage,
        showCompanionPanel,
        showCompanionDesktopRail,
        hasVideoSiteContent: showBelowStage || showCompanionPanel,
    };
}

type InternalPlaySource =
    | { kind: "empty" }
    | { kind: "draft"; id: string; doc: StoryDocument }
    | { kind: "imported"; doc: StoryDocument; key: number };

export function StoryStudioPlayer({
    draftId = null,
    startNodeId = null,
    initialLocale = null,
    layoutMode: controlledLayoutMode,
    initialLayoutMode = "workspace",
    initialImmersive = true,
    hideTopBar = false,
    onLayoutModeChange,
    onImmersiveChange,
    onEffectiveImmersiveChange,
    externalSource = null,
    externalLoading = false,
    externalError = null,
    onClearExternalSource,
    onSavedDraft,
    backToDraftsHref = "/story-maker",
    onBackToDrafts,
    homeHref = "/",
    getEditHref = (id, immersive) => `/story-maker/edit?id=${encodeURIComponent(id)}${!immersive ? "&immersive=0" : ""}`,
    onEditDraft,
    slots,
}: StoryStudioPlayerProps) {
    const { t, assetLine, assetSource, brandLogoUrl, storage, exporter } = useStoryStudio();

    const [internalLayoutMode, setInternalLayoutMode] = useState<PlayerLayoutMode>(
        controlledLayoutMode ?? initialLayoutMode,
    );
    const sourceSessionKey = externalSource?.key
        ? `external:${externalSource.key}`
        : draftId
            ? `draft:${draftId}`
            : "empty";
    const [lastSessionKey, setLastSessionKey] = useState(sourceSessionKey);
    if (sourceSessionKey !== lastSessionKey) {
        setLastSessionKey(sourceSessionKey);
        if (controlledLayoutMode === undefined) {
            setInternalLayoutMode(initialLayoutMode);
        }
    }
    const layoutMode = resolveEffectivePlayerLayoutMode({
        controlledLayoutMode,
        internalLayoutMode,
    });
    const [companionPanelOpen, setCompanionPanelOpen] = useState<boolean>(true);
    const toggleCompanionPanel = useCallback(() => {
        setCompanionPanelOpen(prev => !prev);
    }, []);
    const [immersive, setImmersive] = useState<boolean>(initialImmersive);
    const [draftLoading, setDraftLoading] = useState<boolean>(Boolean(draftId && !externalSource));
    const [loadError, setLoadError] = useState<"missing" | "unavailable" | "failed" | null>(null);
    const [internalSource, setInternalSource] = useState<InternalPlaySource>({ kind: "empty" });
    const [externalDocOverlay, setExternalDocOverlay] = useState<{ key: string; doc: StoryDocument } | null>(null);
    const [voiceManifestOverride, setVoiceManifestOverride] = useState<{ key: string; manifest: StoryVoiceManifest | null } | null>(null);
    const [preferredLocale, setPreferredLocale] = useState<UiLocale | null>(initialLocale);
    const [importOpen, setImportOpen] = useState(false);
    const [voiceManifestOpen, setVoiceManifestOpen] = useState(false);
    const [issuesOpen, setIssuesOpen] = useState(false);
    const [snack, setSnack] = useState<string | null>(null);
    const [importCounter, setImportCounter] = useState(0);
    const [preloadStatus, setPreloadStatus] = useState<{
        running: boolean;
        ready: boolean;
        progress: StoryPreloadProgress | null;
    }>({ running: false, ready: false, progress: null });

    const preloadTriggerRef = useRef<(() => void) | null>(null);
    const handleRegisterPreloadTrigger = useCallback((open: (() => void) | null) => {
        preloadTriggerRef.current = open;
    }, []);
    const openPlayerPreloadDialog = useCallback(() => {
        preloadTriggerRef.current?.();
    }, []);
    const localePackInputRef = useRef<HTMLInputElement | null>(null);
    const loadSeqRef = useRef(0);
    const onImmersiveChangeRef = useRef(onImmersiveChange);
    const onEffectiveImmersiveChangeRef = useRef(onEffectiveImmersiveChange);
    useEffect(() => {
        onImmersiveChangeRef.current = onImmersiveChange;
        onEffectiveImmersiveChangeRef.current = onEffectiveImmersiveChange;
    }, [onEffectiveImmersiveChange, onImmersiveChange]);

    // Load draft from storage adapter when `draftId` is provided and no externalSource is active.
    useEffect(() => {
        if (externalSource || externalLoading || externalError) {
            setDraftLoading(false);
            return;
        }
        const seq = ++loadSeqRef.current;
        async function load() {
            setLoadError(null);
            if (!draftId) {
                setDraftLoading(false);
                return;
            }
            setDraftLoading(true);
            try {
                const draft = await storage.getDraft(draftId);
                if (seq !== loadSeqRef.current) return;
                if (!draft) {
                    setInternalSource({ kind: "empty" });
                    setLoadError("missing");
                } else {
                    setInternalSource({ kind: "draft", id: draft.id, doc: draft.doc });
                }
            } catch (error) {
                if (seq !== loadSeqRef.current) return;
                setInternalSource({ kind: "empty" });
                setLoadError(error instanceof StoryDraftsUnavailableError ? "unavailable" : "failed");
            } finally {
                if (seq === loadSeqRef.current) setDraftLoading(false);
            }
        }
        void load();
        return () => {
            loadSeqRef.current += 1;
        };
    }, [draftId, externalError, externalLoading, externalSource, storage]);

    const sourceKind: StoryPlayerSlotContext["sourceKind"] = externalSource
        ? "external"
        : internalSource.kind;

    const playerKey = externalSource
        ? `external:${externalSource.key}`
        : internalSource.kind === "draft"
            ? `draft:${internalSource.id}`
            : internalSource.kind === "imported"
                ? `imported:${internalSource.key}`
                : "empty";

    const activeDoc: StoryDocument | null = externalSource
        ? (externalDocOverlay?.key === externalSource.key ? externalDocOverlay.doc : externalSource.doc)
        : (internalSource.kind === "empty" ? null : internalSource.doc);

    const voiceManifest: StoryVoiceManifest | null = voiceManifestOverride?.key === playerKey
        ? voiceManifestOverride.manifest
        : (externalSource?.voiceManifest ?? null);

    const setVoiceManifest = useCallback((manifest: StoryVoiceManifest | null) => {
        setVoiceManifestOverride({ key: playerKey, manifest });
    }, [playerKey]);

    const loading = externalLoading || draftLoading;
    const program = useMemo(() => (activeDoc ? compileStoryGraph(activeDoc) : null), [activeDoc]);
    const diagnostics = useMemo(() => program?.diagnostics ?? [], [program]);
    const warnings = useMemo(() => program?.warnings ?? [], [program]);
    const hasBlockingErrors = Boolean(program && program.errors.length > 0);

    const isWorkspaceActive = Boolean(activeDoc) && layoutMode === "workspace";
    const isImmersiveActive = Boolean(activeDoc) && immersive;

    const handleLayoutModeChange = useCallback((next: PlayerLayoutMode) => {
        if (controlledLayoutMode === undefined) {
            setInternalLayoutMode(next);
        }
        onLayoutModeChange?.(next);
    }, [controlledLayoutMode, onLayoutModeChange]);

    const handleImmersiveChange = useCallback((next: boolean) => {
        setImmersive(next);
        onImmersiveChangeRef.current?.(next, {
            effective: Boolean(activeDoc) && next,
            userTriggered: true,
        });
    }, [activeDoc]);

    useEffect(() => {
        onEffectiveImmersiveChangeRef.current?.(isImmersiveActive);
        return () => {
            onEffectiveImmersiveChangeRef.current?.(false);
        };
    }, [isImmersiveActive]);

    useEffect(() => {
        if (!isImmersiveActive || typeof document === "undefined") return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [isImmersiveActive]);

    useEffect(() => {
        if (!isImmersiveActive) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            if (document.fullscreenElement) return;
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const target = event.target as HTMLElement | null;
            if (
                target
                && (
                    target.tagName === "INPUT"
                    || target.tagName === "TEXTAREA"
                    || target.tagName === "SELECT"
                    || target.isContentEditable
                )
            ) {
                return;
            }
            event.preventDefault();
            handleImmersiveChange(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleImmersiveChange, isImmersiveActive]);

    const handleImportForPlay = (doc: StoryDocument) => {
        const nextKey = importCounter + 1;
        setImportCounter(nextKey);
        setLoadError(null);
        setVoiceManifestOverride(null);
        setExternalDocOverlay(null);
        setPreferredLocale(null);
        setInternalSource({ kind: "imported", doc, key: nextKey });
        setImportOpen(false);
        onClearExternalSource?.();
    };

    const applyLocalePackToActive = useCallback((nextPack: Parameters<typeof upsertStoryLocalePack>[1]) => {
        if (externalSource) {
            setExternalDocOverlay((prev) => {
                const base = prev?.key === externalSource.key ? prev.doc : externalSource.doc;
                return { key: externalSource.key, doc: upsertStoryLocalePack(base, nextPack) };
            });
        } else {
            setInternalSource((prev) => {
                if (prev.kind === "empty") return prev;
                return { ...prev, doc: upsertStoryLocalePack(prev.doc, nextPack) };
            });
        }
        setPreferredLocale(nextPack.locale);
    }, [externalSource]);

    const handleLocalePackFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !activeDoc) return;
        try {
            const rawText = await file.text();
            const parsed = JSON.parse(rawText) as { locale?: unknown };
            const fileLocale = typeof parsed?.locale === "string"
                && (SUPPORTED_UI_LOCALES as readonly string[]).includes(parsed.locale)
                ? (parsed.locale as UiLocale)
                : null;
            if (!fileLocale) {
                setSnack(t("page.storyMaker.i18n.invalidLocalePackToast"));
                return;
            }
            const result = parseAndValidateLocalePack(rawText, activeDoc, fileLocale, {
                importSource: "file_upload",
            });
            if (!result.ok || !result.pack) {
                setSnack(t("page.storyMaker.i18n.invalidLocalePackToast"));
                return;
            }
            applyLocalePackToActive(result.pack);
            setSnack(t("page.storyMaker.i18n.loadedLocalePackToast", {
                locale: UI_LOCALE_LABELS[result.pack.locale],
            }));
        } catch {
            setSnack(t("page.storyMaker.i18n.invalidLocalePackToast"));
        }
    };

    const handleSaveImported = async () => {
        if (internalSource.kind !== "imported") return;
        try {
            const created = await storage.createDraft(internalSource.doc);
            setInternalSource({ kind: "draft", id: created.id, doc: created.doc });
            onSavedDraft?.(created.id);
            setSnack(t("page.storyMaker.player.savedDraftToast"));
        } catch {
            setSnack(t("page.storyMaker.storage.failedTitle"));
        }
    };

    const handleExportScript = (targetDoc: StoryDocument) => {
        void exporter.exportMsk(targetDoc).then((res) => {
            if (res.ok && !res.canceled) {
                setSnack(t("page.storyMaker.exportedToast"));
            }
        }).catch(() => {
            downloadStoryScript(targetDoc);
            setSnack(t("page.storyMaker.exportedToast"));
        });
    };

    const activeDraftId = !externalSource && internalSource.kind === "draft" ? internalSource.id : null;
    const editHref = activeDraftId ? getEditHref(activeDraftId, immersive) : null;

    const slotCtx: StoryPlayerSlotContext = {
        doc: activeDoc,
        sourceKind,
        draftId: activeDraftId,
        immersive,
        layoutMode,
        notify: setSnack,
        openImportDialog: () => setImportOpen(true),
        openVoiceManifestDialog: () => setVoiceManifestOpen(true),
    };

    const extraMoreItems = slots?.immersiveMoreItems?.(slotCtx) ?? [];
    const belowStageNode = activeDoc ? (slots?.belowStage?.(slotCtx) ?? null) : null;
    const companionPanelNode = activeDoc ? (slots?.companionPanel?.(slotCtx) ?? null) : null;
    const hasBelowStage = belowStageNode !== null && belowStageNode !== undefined && belowStageNode !== false;
    const hasCompanionPanel = companionPanelNode !== null && companionPanelNode !== undefined && companionPanelNode !== false;
    const {
        showBelowStage,
        showCompanionPanel,
        showCompanionDesktopRail,
        hasVideoSiteContent,
    } = resolvePlayerCompanionVisibility({
        layoutMode,
        hasBelowStage,
        hasCompanionPanel,
        companionPanelOpen,
    });

    const layoutModeOptions = useMemo(() => ([
        { value: "workspace" as const, label: t("page.storyMaker.nle.layoutWorkspace"), icon: mdDashboard },
        { value: "theater" as const, label: t("page.storyMaker.nle.layoutTheater"), icon: mdTheaters },
    ]), [t]);

    const immersiveMoreItems: MenuItemDef[] = activeDoc ? [
        ...extraMoreItems,
        ...(sourceKind === "imported" ? [{
            key: "save-draft",
            label: t("page.storyMaker.player.saveAsDraft"),
            icon: mdBookmarkAdd,
            onSelect: () => void handleSaveImported(),
        }] : []),
        {
            key: "open-preload",
            label: t("page.storyMaker.preload.buttonLabel"),
            icon: preloadStatus.ready ? mdCloudDone : mdDownload,
            dividerBefore: true,
            onSelect: openPlayerPreloadDialog,
        },
        {
            key: "load-voice-manifest",
            label: t("page.storyMaker.voiceTrack.action"),
            icon: mdRecordVoiceOver,
            onSelect: () => setVoiceManifestOpen(true),
        },
        {
            key: "load-locale-pack",
            label: t("page.storyMaker.i18n.loadLocalePackAction"),
            icon: mdTranslate,
            onSelect: () => localePackInputRef.current?.click(),
        },
        {
            key: "open-script",
            label: t("page.storyMaker.player.openScript"),
            icon: mdUploadFile,
            onSelect: () => setImportOpen(true),
        },
        {
            key: "export-msk",
            label: t("page.storyMaker.v2.script.downloadScript"),
            icon: mdCode,
            dividerBefore: true,
            onSelect: () => handleExportScript(activeDoc),
        },
        {
            key: "exit-immersive",
            label: t("page.storyMaker.nle.exitImmersive"),
            icon: mdCloseFullscreen,
            dividerBefore: true,
            onSelect: () => handleImmersiveChange(false),
        },
        ...(onBackToDrafts
            ? [{
                key: "back-drafts",
                label: t("page.storyMaker.action.backToDrafts"),
                icon: mdArrowBack,
                onSelect: onBackToDrafts,
            }]
            : [{
                key: "back-drafts",
                label: t("page.storyMaker.action.backToDrafts"),
                icon: mdArrowBack,
                href: backToDraftsHref,
            }]),
        ...(homeHref ? [{
            key: "back-home",
            label: t("page.storyMaker.v2.ide.backHome"),
            icon: mdHome,
            href: homeHref,
        }] : []),
    ] : [];

    const hasCustomTopBar = hideTopBar || typeof slots?.replaceTopBar === "function";
    const topBarCtx: PlayerTopBarSlotContext = {
        ...slotCtx,
        title: activeDoc
            ? (activeDoc.meta.title || t("page.storyMaker.untitled"))
            : t("page.storyMaker.player.pageTitle"),
        region: activeDoc?.region ?? null,
        regionLabel: activeDoc ? t(SERVER_LABEL_KEYS[activeDoc.region]) : null,
        setLayoutMode: handleLayoutModeChange,
        setImmersive: handleImmersiveChange,
        exportScript: () => {
            if (activeDoc) handleExportScript(activeDoc);
        },
        openLocalePackPicker: () => localePackInputRef.current?.click(),
        moreItems: immersiveMoreItems,
        hasVoiceManifest: Boolean(voiceManifest),
        saveImportedAsDraft: sourceKind === "imported" ? handleSaveImported : undefined,
        onBackToDrafts,
        backToDraftsHref,
        onEditDraft,
        editHref,
        openPreloadDialog: activeDoc ? openPlayerPreloadDialog : undefined,
        preloadRunning: preloadStatus.running,
        preloadProgress: preloadStatus.progress,
        preloadReady: preloadStatus.ready,
        hasCompanionPanel,
        companionPanelOpen,
        toggleCompanionPanel,
    };

    const slotEndAction = slots?.endAction?.(slotCtx);
    const resolvedEndAction = slotEndAction !== undefined && slotEndAction !== null
        ? slotEndAction
        : activeDraftId && onEditDraft ? (
            <Button variant="tonal" icon={mdEdit} onClick={() => onEditDraft(activeDraftId)}>
                {t("page.storyMaker.action.edit")}
            </Button>
        ) : editHref ? (
            <Button variant="tonal" icon={mdEdit} href={editHref}>
                {t("page.storyMaker.action.edit")}
            </Button>
        ) : (
            <Button variant="tonal" icon={mdUploadFile} onClick={() => setImportOpen(true)}>
                {t("page.storyMaker.player.openScript")}
            </Button>
        );

    return (
        <PageContainer
            wide={!isImmersiveActive && showCompanionPanel}
            className={cn(
                "min-w-0 overflow-x-clip",
                isWorkspaceActive && !isImmersiveActive && "xl:max-w-[1680px] xl:py-3",
                isImmersiveActive && (
                    hasCustomTopBar
                        ? "fixed inset-0 z-[150] flex h-dvh w-screen max-w-none flex-col overflow-hidden bg-surface p-0 sm:p-0"
                        : "fixed inset-0 z-[150] flex h-dvh w-screen max-w-none flex-col gap-1.5 overflow-hidden bg-surface p-1.5 sm:p-2"
                ),
            )}
        >
            {hideTopBar ? null : typeof slots?.replaceTopBar === "function" ? (
                slots.replaceTopBar(topBarCtx)
            ) : isImmersiveActive && activeDoc ? (
                <header
                    data-testid="story-player-immersive-header"
                    className="flex h-11 min-w-0 shrink-0 items-center justify-between gap-1.5 rounded-md3-lg border border-outline-variant/60 bg-surface-container-low px-1.5 sm:gap-2 sm:px-2"
                >
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden sm:gap-1.5">
                        {onBackToDrafts ? (
                            <button
                                type="button"
                                onClick={onBackToDrafts}
                                title={t("page.storyMaker.title")}
                                className="focus-ring flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md3-sm px-1 py-1 sm:px-1.5"
                            >
                                <span
                                    className="block h-4 w-11 bg-primary sm:h-5 sm:w-[3.25rem]"
                                    style={{
                                        maskImage: `url(${brandLogoUrl})`,
                                        maskSize: "contain",
                                        maskPosition: "center",
                                        maskRepeat: "no-repeat",
                                        WebkitMaskImage: `url(${brandLogoUrl})`,
                                        WebkitMaskSize: "contain",
                                        WebkitMaskPosition: "center",
                                        WebkitMaskRepeat: "no-repeat",
                                    }}
                                />
                                <span className="hidden rounded-md3-xs bg-tertiary-container px-1 py-0.5 text-[10px] font-semibold leading-none text-on-tertiary-container sm:inline-block">
                                    {t("page.storyMaker.betaBadge")}
                                </span>
                            </button>
                        ) : (
                            <StudioLink
                                href={backToDraftsHref}
                                title={t("page.storyMaker.title")}
                                className="focus-ring flex shrink-0 items-center gap-1.5 rounded-md3-sm px-1 py-1 sm:px-1.5"
                            >
                                <span
                                    className="block h-4 w-11 bg-primary sm:h-5 sm:w-[3.25rem]"
                                    style={{
                                        maskImage: `url(${brandLogoUrl})`,
                                        maskSize: "contain",
                                        maskPosition: "center",
                                        maskRepeat: "no-repeat",
                                        WebkitMaskImage: `url(${brandLogoUrl})`,
                                        WebkitMaskSize: "contain",
                                        WebkitMaskPosition: "center",
                                        WebkitMaskRepeat: "no-repeat",
                                    }}
                                />
                                <span className="hidden rounded-md3-xs bg-tertiary-container px-1 py-0.5 text-[10px] font-semibold leading-none text-on-tertiary-container sm:inline-block">
                                    {t("page.storyMaker.betaBadge")}
                                </span>
                            </StudioLink>
                        )}
                        <span aria-hidden className="hidden h-4 w-px shrink-0 bg-outline-variant/60 sm:block" />
                        <span className="min-w-0 truncate type-label-m text-on-surface sm:type-label-l">
                            {activeDoc.meta.title || t("page.storyMaker.untitled")}
                        </span>
                        <span className="hidden shrink-0 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 type-label-s text-on-surface-variant md:inline">
                            {t(SERVER_LABEL_KEYS[activeDoc.region])}
                        </span>
                        {sourceKind === "imported" && (
                            <span className="hidden shrink-0 rounded-md3-xs bg-secondary-container px-1.5 py-0.5 type-label-s text-on-secondary-container lg:inline">
                                {t("page.storyMaker.player.unsavedBadge")}
                            </span>
                        )}
                        {externalSource?.badge && (
                            <span className="hidden shrink-0 rounded-md3-xs bg-secondary-container px-1.5 py-0.5 type-label-s text-on-secondary-container lg:inline">
                                {externalSource.badge}
                            </span>
                        )}
                    </div>

                    {/* Compact icon-only switcher below md: so mobile top bar never overflows or clips */}
                    <SegmentedButton<PlayerLayoutMode>
                        density={-2}
                        iconOnly
                        value={layoutMode}
                        onValueChange={handleLayoutModeChange}
                        aria-label={t("page.storyMaker.nle.layoutWorkspace")}
                        className="w-auto shrink-0 md:hidden"
                        options={layoutModeOptions}
                    />
                    <SegmentedButton<PlayerLayoutMode>
                        density={-2}
                        value={layoutMode}
                        onValueChange={handleLayoutModeChange}
                        aria-label={t("page.storyMaker.nle.layoutWorkspace")}
                        className="hidden w-auto shrink-0 md:inline-grid"
                        options={layoutModeOptions}
                    />

                    <div className="flex shrink-0 items-center justify-end gap-0.5 sm:flex-1 sm:gap-1">
                        {slots?.headerActions?.(slotCtx)}
                        {activeDraftId && onEditDraft ? (
                            <Button size="xs" variant="tonal" icon={mdEdit} onClick={() => onEditDraft(activeDraftId)}>
                                {t("page.storyMaker.action.edit")}
                            </Button>
                        ) : editHref ? (
                            <Button size="xs" variant="tonal" icon={mdEdit} href={editHref}>
                                {t("page.storyMaker.action.edit")}
                            </Button>
                        ) : null}
                        {showCompanionPanel && (
                            <IconButton
                                size="xs"
                                variant={companionPanelOpen ? "tonal" : "standard"}
                                selected={companionPanelOpen}
                                icon={companionPanelOpen ? mdRightPanelClose : mdRightPanelOpen}
                                label={t(
                                    companionPanelOpen
                                        ? "page.storyMaker.player.hideCompanionPanel"
                                        : "page.storyMaker.player.showCompanionPanel",
                                )}
                                className="hidden lg:inline-flex"
                                onClick={toggleCompanionPanel}
                            />
                        )}
                        <IconButton
                            size="xs"
                            variant={voiceManifest ? "tonal" : "standard"}
                            icon={mdRecordVoiceOver}
                            label={t("page.storyMaker.voiceTrack.action")}
                            className="hidden sm:inline-flex"
                            onClick={() => setVoiceManifestOpen(true)}
                        />
                        <IconButton
                            size="xs"
                            icon={mdTranslate}
                            label={t("page.storyMaker.i18n.loadLocalePackAction")}
                            className="hidden sm:inline-flex"
                            onClick={() => localePackInputRef.current?.click()}
                        />
                        <IconButton
                            size="xs"
                            icon={mdUploadFile}
                            label={t("page.storyMaker.player.openScript")}
                            className="hidden sm:inline-flex"
                            onClick={() => setImportOpen(true)}
                        />
                        <Menu
                            align="end"
                            items={immersiveMoreItems}
                            anchor={({ ref, onClick, ...aria }) => (
                                <IconButton
                                    ref={ref}
                                    size="xs"
                                    icon={mdMoreVert}
                                    label={t("page.storyMaker.v2.ide.moreActions")}
                                    onClick={onClick}
                                    {...aria}
                                />
                            )}
                        />
                    </div>
                </header>
            ) : (
                <PageHeader
                    className={cn(isWorkspaceActive && "xl:mb-2.5")}
                    eyebrow={activeDoc ? (
                        <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 break-words">
                            <span className="inline-flex shrink-0 items-center rounded-full bg-tertiary-container px-2 py-0.5 type-label-s text-on-tertiary-container">
                                {t("page.storyMaker.betaBadge")}
                            </span>
                            <span>{t(SERVER_LABEL_KEYS[activeDoc.region])}</span>
                            {activeDoc.meta.author && (
                                <>
                                    <span>·</span>
                                    <span className="min-w-0 break-words">
                                        {t("page.storyMaker.meta.authorBy", { author: activeDoc.meta.author })}
                                    </span>
                                </>
                            )}
                            {sourceKind === "imported" && (
                                <>
                                    <span>·</span>
                                    <span>{t("page.storyMaker.player.unsavedBadge")}</span>
                                </>
                            )}
                            {externalSource?.badge && (
                                <>
                                    <span>·</span>
                                    <span>{externalSource.badge}</span>
                                </>
                            )}
                        </span>
                    ) : undefined}
                    title={activeDoc ? (
                        activeDoc.meta.title || t("page.storyMaker.untitled")
                    ) : (
                        <span className="inline-flex max-w-full flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words">{t("page.storyMaker.player.pageTitle")}</span>
                            <span className="inline-flex shrink-0 items-center rounded-full bg-tertiary-container px-2 py-0.5 type-label-s text-on-tertiary-container">
                                {t("page.storyMaker.betaBadge")}
                            </span>
                        </span>
                    )}
                    description={activeDoc
                        ? (activeDoc.meta.summary
                            ? <span className={cn(isWorkspaceActive && "xl:line-clamp-1")}>{activeDoc.meta.summary}</span>
                            : undefined)
                        : t("page.storyMaker.player.pageDescription")}
                    actions={(
                        <>
                            {activeDoc && (
                                <SegmentedButton<PlayerLayoutMode>
                                    density={-1}
                                    value={layoutMode}
                                    onValueChange={handleLayoutModeChange}
                                    aria-label={t("page.storyMaker.nle.layoutWorkspace")}
                                    className="w-auto max-w-full"
                                    options={[
                                        { value: "workspace", label: t("page.storyMaker.nle.layoutWorkspace"), icon: mdDashboard },
                                        { value: "theater", label: t("page.storyMaker.nle.layoutTheater"), icon: mdTheaters },
                                    ]}
                                />
                            )}
                            {activeDoc && (
                                <Button
                                    variant="tonal"
                                    icon={mdOpenInFull}
                                    onClick={() => handleImmersiveChange(true)}
                                    className="max-w-full px-3 sm:px-3.5"
                                >
                                    {t("page.storyMaker.nle.enterImmersive")}
                                </Button>
                            )}
                            {activeDoc && showCompanionPanel && (
                                <IconButton
                                    variant={companionPanelOpen ? "tonal" : "standard"}
                                    selected={companionPanelOpen}
                                    icon={companionPanelOpen ? mdRightPanelClose : mdRightPanelOpen}
                                    label={t(
                                        companionPanelOpen
                                            ? "page.storyMaker.player.hideCompanionPanel"
                                            : "page.storyMaker.player.showCompanionPanel",
                                    )}
                                    className="hidden lg:inline-flex"
                                    onClick={toggleCompanionPanel}
                                />
                            )}
                            {onBackToDrafts ? (
                                <Button variant="text" icon={mdArrowBack} onClick={onBackToDrafts} className="max-w-full px-3 sm:px-4">
                                    {t("page.storyMaker.action.backToDrafts")}
                                </Button>
                            ) : (
                                <Button variant="text" icon={mdArrowBack} href={backToDraftsHref} className="max-w-full px-3 sm:px-4">
                                    {t("page.storyMaker.action.backToDrafts")}
                                </Button>
                            )}
                            {slots?.headerActions?.(slotCtx)}
                            {activeDraftId && onEditDraft ? (
                                <Button variant="tonal" icon={mdEdit} onClick={() => onEditDraft(activeDraftId)} className="max-w-full px-3 sm:px-4">
                                    {t("page.storyMaker.action.edit")}
                                </Button>
                            ) : editHref ? (
                                <Button variant="tonal" icon={mdEdit} href={editHref} className="max-w-full px-3 sm:px-4">
                                    {t("page.storyMaker.action.edit")}
                                </Button>
                            ) : null}
                            {sourceKind === "imported" && (
                                <Button variant="tonal" icon={mdBookmarkAdd} onClick={() => void handleSaveImported()} className="max-w-full px-3 sm:px-4">
                                    {t("page.storyMaker.player.saveAsDraft")}
                                </Button>
                            )}
                            {activeDoc && (
                                <>
                                    <Button
                                        variant="outlined"
                                        icon={mdTranslate}
                                        className="max-w-full px-3 sm:px-4"
                                        onClick={() => localePackInputRef.current?.click()}
                                    >
                                        {t("page.storyMaker.i18n.loadLocalePackAction")}
                                    </Button>
                                    <Button
                                        variant={voiceManifest ? "tonal" : "outlined"}
                                        icon={mdRecordVoiceOver}
                                        className="max-w-full px-3 sm:px-4"
                                        onClick={() => setVoiceManifestOpen(true)}
                                    >
                                        {t("page.storyMaker.voiceTrack.action")}
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        icon={mdCode}
                                        className="max-w-full px-3 sm:px-4"
                                        onClick={() => handleExportScript(activeDoc)}
                                    >
                                        {t("page.storyMaker.v2.script.downloadScript")}
                                    </Button>
                                </>
                            )}
                            <Button variant={activeDoc ? "outlined" : "filled"} icon={mdUploadFile} onClick={() => setImportOpen(true)} className="max-w-full px-3 sm:px-4">
                                {t("page.storyMaker.player.openScript")}
                            </Button>
                        </>
                    )}
                />
            )}

            {loading ? (
                <LoadingState />
            ) : externalError ? (
                <Card variant="filled" radius="xl">
                    <EmptyState
                        title={externalError.title}
                        description={externalError.description}
                        action={(
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                {externalError.action}
                                {onBackToDrafts ? (
                                    <Button variant="tonal" icon={mdArrowBack} onClick={onBackToDrafts}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                ) : (
                                    <Button variant="tonal" icon={mdArrowBack} href={backToDraftsHref}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                )}
                            </div>
                        )}
                    />
                </Card>
            ) : loadError ? (
                <Card variant="filled" radius="xl">
                    <EmptyState
                        title={t(
                            loadError === "unavailable"
                                ? "page.storyMaker.storage.unavailableTitle"
                                : "page.storyMaker.editor.notFoundTitle",
                        )}
                        description={t(
                            loadError === "unavailable"
                                ? "page.storyMaker.storage.unavailableDescription"
                                : "page.storyMaker.editor.notFoundDescription",
                        )}
                        action={(
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                <Button variant="filled" icon={mdUploadFile} onClick={() => setImportOpen(true)}>
                                    {t("page.storyMaker.player.openScript")}
                                </Button>
                                {onBackToDrafts ? (
                                    <Button variant="tonal" icon={mdArrowBack} onClick={onBackToDrafts}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                ) : (
                                    <Button variant="tonal" icon={mdArrowBack} href={backToDraftsHref}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                )}
                            </div>
                        )}
                    />
                </Card>
            ) : !activeDoc ? (
                <Card variant="filled" radius="xl">
                    <EmptyState
                        icon={mdPlayArrowFill}
                        title={t("page.storyMaker.player.noStoryTitle")}
                        description={t("page.storyMaker.player.noStoryDescription")}
                        action={(
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                <Button variant="filled" icon={mdUploadFile} onClick={() => setImportOpen(true)}>
                                    {t("page.storyMaker.player.openScript")}
                                </Button>
                                {onBackToDrafts ? (
                                    <Button variant="tonal" icon={mdArrowBack} onClick={onBackToDrafts}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                ) : (
                                    <Button variant="tonal" icon={mdArrowBack} href={backToDraftsHref}>
                                        {t("page.storyMaker.action.backToDrafts")}
                                    </Button>
                                )}
                            </div>
                        )}
                    />
                </Card>
            ) : (
                <div
                    data-testid="story-player-shell-body"
                    className={cn(
                        "min-w-0",
                        isImmersiveActive
                            ? cn(
                                "flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden",
                                hasCustomTopBar && "p-1.5 sm:p-2",
                                layoutMode === "workspace"
                                    ? "overflow-y-auto xl:overflow-hidden"
                                    : showCompanionPanel
                                        ? "overflow-y-auto lg:flex-row lg:gap-3 lg:overflow-hidden"
                                        : "overflow-y-auto",
                            )
                            : cn(
                                "flex flex-col gap-3",
                                showCompanionDesktopRail && "lg:flex-row lg:items-start lg:gap-4",
                            ),
                    )}
                >
                    <div
                        data-testid="story-player-main-column"
                        className={cn(
                            "min-w-0",
                            isImmersiveActive
                                ? layoutMode === "workspace"
                                    ? "flex min-h-0 flex-1 flex-col gap-1.5"
                                    : showCompanionPanel
                                        ? "flex shrink-0 flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1"
                                        : showBelowStage
                                            ? "flex shrink-0 flex-col gap-2"
                                            : "flex shrink-0 flex-col gap-1.5 lg:min-h-0 lg:flex-1"
                                : "flex-1 space-y-3",
                        )}
                    >
                        {!hasBlockingErrors && warnings.length > 0 && (
                            <Banner
                                tone="warning"
                                title={t("page.storyMaker.v2.compiler.statusWarnings", { count: warnings.length })}
                                action={(
                                    <Button size="xs" variant="text" onClick={() => setIssuesOpen(true)}>
                                        {t("page.storyMaker.player.viewIssues")}
                                    </Button>
                                )}
                            >
                                {t("page.storyMaker.v2.compiler.warningsTitle")}
                            </Banner>
                        )}

                        <StoryPlayerView
                            key={playerKey}
                            doc={activeDoc}
                            line={assetLine}
                            assetSource={assetSource}
                            startNodeId={sourceKind === "draft" || sourceKind === "external" ? startNodeId : null}
                            layoutMode={layoutMode}
                            onLayoutModeChange={handleLayoutModeChange}
                            immersive={isImmersiveActive}
                            hasBelowStageContent={hasVideoSiteContent}
                            initialLocale={preferredLocale}
                            voiceManifest={voiceManifest}
                            onOpenVoiceManifest={() => setVoiceManifestOpen(true)}
                            endAction={resolvedEndAction}
                            onRegisterPreloadTrigger={handleRegisterPreloadTrigger}
                            onPreloadStatusChange={setPreloadStatus}
                        />

                        {hasBelowStage && (
                            <div
                                data-testid="story-player-below-stage"
                                className={cn("min-w-0 shrink-0", !showBelowStage && "hidden")}
                            >
                                {belowStageNode}
                            </div>
                        )}
                    </div>

                    {hasCompanionPanel && (
                        <aside
                            data-testid="story-player-companion-panel"
                            aria-label={t("page.storyMaker.player.companionPanel")}
                            className={cn(
                                "min-w-0",
                                !showCompanionPanel
                                    ? "hidden"
                                    : cn(
                                        "flex shrink-0 flex-col",
                                        showCompanionDesktopRail
                                            ? cn(
                                                "lg:w-[380px] xl:w-[420px]",
                                                isImmersiveActive
                                                    ? "lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-outline-variant/50 lg:pl-3"
                                                    : "lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:border-l lg:border-outline-variant/50 lg:pl-4",
                                            )
                                            : "lg:hidden",
                                    ),
                            )}
                        >
                            {companionPanelNode}
                        </aside>
                    )}
                </div>
            )}

            <StoryImportDialog
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={handleImportForPlay}
            />

            {activeDoc && (
                <StoryVoiceManifestDialog
                    isOpen={voiceManifestOpen}
                    onClose={() => setVoiceManifestOpen(false)}
                    doc={activeDoc}
                    currentManifest={voiceManifest}
                    onApplyManifest={setVoiceManifest}
                    onSwitchToStoryImport={handleImportForPlay}
                    onApplyLocalePack={applyLocalePackToActive}
                    onNotify={setSnack}
                />
            )}

            <Dialog
                isOpen={issuesOpen}
                onClose={() => setIssuesOpen(false)}
                title={t("page.storyMaker.editor.issuesDialogTitle", { count: diagnostics.length })}
                size="md"
            >
                {diagnostics.length === 0 ? (
                    <p className="type-body-m text-on-surface-variant">
                        {t("page.storyMaker.v2.compiler.noIssues")}
                    </p>
                ) : (
                    <ul className="max-h-96 min-w-0 space-y-1.5 overflow-y-auto">
                        {diagnostics.map((diag, index) => (
                            <li
                                key={`${diag.path}-${diag.code}-${index}`}
                                className="flex min-w-0 items-start gap-2 rounded-md3-md bg-surface-container px-2.5 py-2"
                            >
                                <Icon
                                    path={diag.severity === "error" ? mdErrorFill : mdWarning}
                                    size={18}
                                    className={cn("mt-0.5 shrink-0", diag.severity === "error" ? "text-error" : "text-tertiary")}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block break-words type-body-m text-on-surface">
                                        {t(`page.storyMaker.issue.${diag.code}`, diag.params ?? {})}
                                    </span>
                                    <span className="block break-all font-mono type-label-s text-on-surface-variant">
                                        {diag.path}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Dialog>

            <input
                ref={localePackInputRef}
                type="file"
                accept=".json,.i18n.json,application/json"
                className="sr-only"
                onChange={event => void handleLocalePackFile(event)}
            />

            <Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} />
        </PageContainer>
    );
}
