"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    createStoryDocument,
    downloadStoryScript,
    getCharacterIconUrl,
    SERVER_LABEL_KEYS,
    STORY_LIMITS,
    StoryDraftsUnavailableError,
    totalBeatCount,
    type StoryDocument,
    type StoryDraft,
} from "@moesekai/story-core";
import { StoryImportDialog } from "../components/StoryImportDialog";
import {
    StoryMetaDialog,
    applyMetaValuesToDoc,
    type StoryMetaValues,
} from "../components/StoryMetaDialog";
import { useStarterStory } from "../components/useStarterStory";
import { useStoryStudio } from "../context/StoryStudioContext";
import {
    Banner, Button, Card, Dialog, EmptyState, Icon, IconButton, LoadMore, LoadingState, Menu,
    PageContainer, PageHeader, Select, Snackbar, TextField, type MenuItemDef,
} from "../md3";
import {
    mdAccountTree, mdAdd, mdAutoStories, mdCode, mdContentCopy, mdDelete, mdEdit,
    mdFlag, mdMoreVert, mdPlayArrowFill, mdSearch, mdStar, mdTitle, mdUploadFile,
} from "../md3/icons";

export type StoryHubSortKey = "updated" | "created" | "title";

export interface StoryHubScrollRestore {
    displayCount: number;
    loadMore: () => void;
    resetDisplayCount: () => void;
}

export interface StoryStudioHubSlots {
    /** Extra actions rendered inside PageHeader actions alongside Play File / Import / New Story. */
    headerActions?: ReactNode;
    /** Extra actions rendered in each draft card footer alongside Play / Edit. */
    cardActions?: (draft: StoryDraft) => ReactNode;
    /** Extra menu items added to each draft card's overflow menu (before Delete). */
    cardMenuItems?: (draft: StoryDraft) => MenuItemDef[];
    /** Extra content or banner rendered above the draft grid. */
    beforeDrafts?: ReactNode;
}

export interface StoryStudioHubProps {
    initialSearch?: string;
    initialSortBy?: StoryHubSortKey;
    onFilterChange?: (filters: { search: string; sortBy: StoryHubSortKey }) => void;
    /** Optional host scroll-restore adapter (e.g. Web's `useScrollRestore`). */
    scrollRestore?: StoryHubScrollRestore;
    /** Notifies host when draft list loading state changes. */
    onLoadingChange?: (loading: boolean) => void;
    /** Show the mobile-only desktop recommendation banner (`lg:hidden`). Default: `true`. */
    showMobileNotice?: boolean;
    /** Href builder for editing a draft (defaults to `/story-maker/edit?id=<id>`). */
    getEditHref?: (draftId: string) => string;
    /** Href builder for playing a draft (defaults to `/story-maker/play?id=<id>`). */
    getPlayHref?: (draftId: string) => string;
    /** Href for "Play File" button (defaults to `/story-maker/play`; set `null` to omit unless `onPlayFile` is provided). */
    playFileHref?: string | null;
    /** Optional programmatic callback for opening a draft in the editor. */
    onOpenDraft?: (draftId: string) => void;
    /** Optional programmatic callback for playing a draft. */
    onPlayDraft?: (draftId: string) => void;
    /** Optional programmatic callback for "Play File". */
    onPlayFile?: () => void;
    /** Optional host slots. */
    slots?: StoryStudioHubSlots;
}

const DEFAULT_PAGE_SIZE = 12;

/**
 * Prepends a newly created or imported draft to the hub list, deduplicating by `id`
 * so the list reflects the draft immediately before or without a full page reload.
 */
export function prependStoryDraft(previous: readonly StoryDraft[], created: StoryDraft): StoryDraft[] {
    return [created, ...previous.filter(item => item.id !== created.id)];
}

export function StoryStudioHub({
    initialSearch = "",
    initialSortBy = "updated",
    onFilterChange,
    scrollRestore,
    onLoadingChange,
    showMobileNotice = true,
    getEditHref = (id) => `/story-maker/edit?id=${encodeURIComponent(id)}`,
    getPlayHref = (id) => `/story-maker/play?id=${encodeURIComponent(id)}`,
    playFileHref = "/story-maker/play",
    onOpenDraft,
    onPlayDraft,
    onPlayFile,
    slots,
}: StoryStudioHubProps) {
    const { t, locale, defaultRegion, storage, exporter, navigate } = useStoryStudio();
    const buildStarter = useStarterStory();

    const [drafts, setDrafts] = useState<StoryDraft[]>([]);
    const [loading, setLoading] = useState(true);
    const [storageError, setStorageError] = useState<"unavailable" | "failed" | null>(null);
    const [search, setSearch] = useState(initialSearch);
    const [sortBy, setSortBy] = useState<StoryHubSortKey>(initialSortBy);
    const [internalDisplayCount, setInternalDisplayCount] = useState(DEFAULT_PAGE_SIZE);

    const [creatingOpen, setCreatingOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [creatingDraft, setCreatingDraft] = useState(false);
    const [renaming, setRenaming] = useState<StoryDraft | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleting, setDeleting] = useState<StoryDraft | null>(null);
    const [snack, setSnack] = useState<string | null>(null);

    const onLoadingChangeRef = useRef(onLoadingChange);
    const refreshSeqRef = useRef(0);
    const mutationEpochRef = useRef(0);
    const creatingDraftRef = useRef(false);

    useEffect(() => {
        onLoadingChangeRef.current = onLoadingChange;
    }, [onLoadingChange]);

    const refresh = useCallback(async () => {
        const seq = ++refreshSeqRef.current;
        const startEpoch = mutationEpochRef.current;
        setLoading(true);
        onLoadingChangeRef.current?.(true);
        setStorageError(null);
        try {
            let loaded = await storage.listDrafts();
            if (seq !== refreshSeqRef.current) return;
            if (mutationEpochRef.current !== startEpoch) {
                loaded = await storage.listDrafts();
                if (seq !== refreshSeqRef.current) return;
            }
            setDrafts(loaded);
        } catch (error) {
            if (seq !== refreshSeqRef.current) return;
            setStorageError(error instanceof StoryDraftsUnavailableError ? "unavailable" : "failed");
        } finally {
            if (seq === refreshSeqRef.current) {
                setLoading(false);
                onLoadingChangeRef.current?.(false);
            }
        }
    }, [storage]);

    useEffect(() => {
        void refresh();
        return () => {
            refreshSeqRef.current += 1;
        };
    }, [refresh]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handlePageShow = (event: PageTransitionEvent) => {
            if (event.persisted) {
                void refresh();
            }
        };
        window.addEventListener("pageshow", handlePageShow);
        return () => window.removeEventListener("pageshow", handlePageShow);
    }, [refresh]);

    const displayCount = scrollRestore ? scrollRestore.displayCount : internalDisplayCount;
    const loadMore = useCallback(() => {
        if (scrollRestore) scrollRestore.loadMore();
        else setInternalDisplayCount(prev => prev + DEFAULT_PAGE_SIZE);
    }, [scrollRestore]);
    const resetDisplayCount = useCallback(() => {
        if (scrollRestore) scrollRestore.resetDisplayCount();
        else setInternalDisplayCount(DEFAULT_PAGE_SIZE);
    }, [scrollRestore]);

    const handleSearchChange = (value: string) => {
        setSearch(value);
        onFilterChange?.({ search: value, sortBy });
        resetDisplayCount();
    };

    const handleSortChange = (value: StoryHubSortKey) => {
        setSortBy(value);
        onFilterChange?.({ search, sortBy: value });
        resetDisplayCount();
    };

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const matches = needle
            ? drafts.filter(draft => (
                draft.doc.meta.title.toLowerCase().includes(needle)
                || draft.doc.meta.summary.toLowerCase().includes(needle)
                || draft.doc.meta.author.toLowerCase().includes(needle)
            ))
            : drafts;
        return [...matches].sort((a, b) => {
            if (sortBy === "created") return b.createdAt - a.createdAt;
            if (sortBy === "title") return (a.doc.meta.title || "").localeCompare(b.doc.meta.title || "", locale);
            return b.updatedAt - a.updatedAt;
        });
    }, [drafts, search, sortBy, locale]);

    const visibleDrafts = filtered.slice(0, displayCount);

    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
        [locale],
    );

    const openEditor = useCallback((id: string) => {
        if (onOpenDraft) onOpenDraft(id);
        else navigate(getEditHref(id));
    }, [getEditHref, navigate, onOpenDraft]);

    const handleCreate = async (values: StoryMetaValues) => {
        if (creatingDraftRef.current) return;
        creatingDraftRef.current = true;
        setCreatingDraft(true);
        try {
            const base = createStoryDocument(values.region, values.title);
            const doc = applyMetaValuesToDoc(base, values);
            const created = await storage.createDraft(doc);
            mutationEpochRef.current += 1;
            setDrafts(previous => prependStoryDraft(previous, created));
            setCreatingOpen(false);
            openEditor(created.id);
        } catch {
            setStorageError("failed");
        } finally {
            creatingDraftRef.current = false;
            setCreatingDraft(false);
        }
    };

    const handleCreateStarter = async () => {
        if (creatingDraftRef.current) return;
        creatingDraftRef.current = true;
        setCreatingDraft(true);
        try {
            const created = await storage.createDraft(buildStarter(defaultRegion));
            mutationEpochRef.current += 1;
            setDrafts(previous => prependStoryDraft(previous, created));
            openEditor(created.id);
        } catch {
            setStorageError("failed");
        } finally {
            creatingDraftRef.current = false;
            setCreatingDraft(false);
        }
    };

    const handleImport = async (doc: StoryDocument) => {
        if (creatingDraftRef.current) return;
        creatingDraftRef.current = true;
        setCreatingDraft(true);
        try {
            const created = await storage.createDraft(doc);
            mutationEpochRef.current += 1;
            setImportOpen(false);
            setDrafts(previous => prependStoryDraft(previous, created));
            setSnack(t("page.storyMaker.landing.importedToast"));
            openEditor(created.id);
        } catch {
            setStorageError("failed");
        } finally {
            creatingDraftRef.current = false;
            setCreatingDraft(false);
        }
    };

    const handleRename = async () => {
        if (!renaming) return;
        try {
            const updated = await storage.renameDraft(renaming.id, renameValue.trim().slice(0, STORY_LIMITS.title));
            if (updated) {
                mutationEpochRef.current += 1;
                setDrafts(previous => previous.map(item => (item.id === updated.id ? updated : item)));
                setSnack(t("page.storyMaker.landing.renamedToast"));
            }
            setRenaming(null);
        } catch {
            setStorageError("failed");
        }
    };

    const handleDuplicate = async (draft: StoryDraft) => {
        try {
            const copy = await storage.duplicateDraft(draft.id, t("page.storyMaker.landing.copySuffix"));
            if (copy) {
                mutationEpochRef.current += 1;
                setDrafts(previous => prependStoryDraft(previous, copy));
                setSnack(t("page.storyMaker.landing.duplicatedToast"));
            }
        } catch {
            setStorageError("failed");
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        try {
            await storage.deleteDraft(deleting.id);
            mutationEpochRef.current += 1;
            setDrafts(previous => previous.filter(item => item.id !== deleting.id));
            setSnack(t("page.storyMaker.landing.deletedToast"));
            setDeleting(null);
        } catch {
            setStorageError("failed");
        }
    };

    const handleExportDraft = (draft: StoryDraft) => {
        void exporter.exportMsk(draft.doc).then((res) => {
            if (res.ok && !res.canceled) {
                setSnack(t("page.storyMaker.v2.script.downloadScript"));
            }
        }).catch(() => {
            downloadStoryScript(draft.doc);
            setSnack(t("page.storyMaker.v2.script.downloadScript"));
        });
    };

    const rawTitle = t("page.storyMaker.title");
    const betaBadge = t("page.storyMaker.betaBadge");
    const displayTitle = rawTitle.endsWith(` ${betaBadge}`)
        ? rawTitle.slice(0, -(betaBadge.length + 1))
        : rawTitle;

    return (
        <PageContainer className="min-w-0">
            <PageHeader
                title={(
                    <span className="inline-flex flex-wrap items-center gap-2.5">
                        <span>{displayTitle}</span>
                        <span className="inline-flex items-center rounded-md3-full border border-tertiary/30 bg-tertiary-container px-2.5 py-0.5 align-middle type-label-m text-on-tertiary-container">
                            {betaBadge}
                        </span>
                    </span>
                )}
                description={t("page.storyMaker.description")}
                actions={(
                    <>
                        {slots?.headerActions}
                        {onPlayFile ? (
                            <Button variant="outlined" icon={mdPlayArrowFill} onClick={onPlayFile} className="px-3 sm:px-4">
                                {t("page.storyMaker.landing.playFile")}
                            </Button>
                        ) : playFileHref ? (
                            <Button variant="outlined" icon={mdPlayArrowFill} href={playFileHref} className="px-3 sm:px-4">
                                {t("page.storyMaker.landing.playFile")}
                            </Button>
                        ) : null}
                        <Button variant="tonal" icon={mdUploadFile} disabled={storageError !== null} onClick={() => setImportOpen(true)} className="px-3 sm:px-4">
                            {t("page.storyMaker.landing.importScript")}
                        </Button>
                        <Button variant="filled" icon={mdAdd} disabled={storageError !== null} onClick={() => setCreatingOpen(true)} className="px-3 sm:px-4">
                            {t("page.storyMaker.landing.newStory")}
                        </Button>
                    </>
                )}
            />

            {showMobileNotice && (
                <Banner tone="info" className="mb-4 lg:hidden">
                    {t("page.storyMaker.desktopOnly.landingNotice")}
                </Banner>
            )}

            {slots?.beforeDrafts}

            {storageError && (
                <Banner
                    tone="error"
                    title={t(storageError === "unavailable" ? "page.storyMaker.storage.unavailableTitle" : "page.storyMaker.storage.failedTitle")}
                    className="mb-6"
                    action={storageError === "failed" ? (
                        <Button size="xs" variant="text" color="error" onClick={() => void refresh()}>
                            {t("common.action.retry")}
                        </Button>
                    ) : undefined}
                >
                    {t(storageError === "unavailable" ? "page.storyMaker.storage.unavailableDescription" : "page.storyMaker.storage.failedDescription")}
                </Banner>
            )}

            <section className="min-w-0 space-y-4">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <h2 className="min-w-0 type-title-l text-on-surface">
                        {t("page.storyMaker.landing.myDrafts")}
                        {!loading && <span className="ml-2 type-label-l text-on-surface-variant">{filtered.length}</span>}
                    </h2>
                    {drafts.length > 0 && (
                        <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto">
                            <Button size="s" variant="text" icon={mdStar} onClick={() => void handleCreateStarter()}>
                                {t("page.storyMaker.landing.tryStarter")}
                            </Button>
                            <TextField
                                value={search}
                                onValueChange={handleSearchChange}
                                placeholder={t("page.storyMaker.landing.searchPlaceholder")}
                                icon={mdSearch}
                                clearable
                                aria-label={t("page.storyMaker.landing.searchPlaceholder")}
                                className="min-w-0 flex-1 basis-44 sm:w-56 sm:flex-none"
                            />
                            <Select<StoryHubSortKey>
                                value={sortBy}
                                onValueChange={handleSortChange}
                                options={[
                                    { value: "updated", label: t("page.storyMaker.landing.sortUpdated") },
                                    { value: "created", label: t("page.storyMaker.landing.sortCreated") },
                                    { value: "title", label: t("page.storyMaker.landing.sortTitle") },
                                ]}
                                aria-label={t("page.storyMaker.landing.sortBy")}
                                className="min-w-0 flex-1 basis-36 sm:w-40 sm:flex-none"
                            />
                        </div>
                    )}
                </div>

                {loading ? (
                    <LoadingState />
                ) : drafts.length === 0 ? (
                    <Card variant="filled" radius="xl">
                        <EmptyState
                            icon={mdAutoStories}
                            title={t("page.storyMaker.landing.emptyTitle")}
                            description={t("page.storyMaker.landing.emptyDescription")}
                            action={(
                                <div className="mt-2 flex flex-wrap justify-center gap-2">
                                    <Button variant="filled" icon={mdStar} disabled={storageError !== null} onClick={() => void handleCreateStarter()}>
                                        {t("page.storyMaker.landing.tryStarter")}
                                    </Button>
                                    <Button variant="tonal" icon={mdAdd} disabled={storageError !== null} onClick={() => setCreatingOpen(true)}>
                                        {t("page.storyMaker.landing.newStory")}
                                    </Button>
                                    <Button variant="outlined" icon={mdUploadFile} disabled={storageError !== null} onClick={() => setImportOpen(true)}>
                                        {t("page.storyMaker.landing.importScript")}
                                    </Button>
                                </div>
                            )}
                        />
                    </Card>
                ) : filtered.length === 0 ? (
                    <Card variant="filled" radius="lg">
                        <EmptyState
                            title={t("page.storyMaker.landing.noMatchesTitle")}
                            description={t("page.storyMaker.landing.noMatchesDescription")}
                        />
                    </Card>
                ) : (
                    <>
                        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {visibleDrafts.map((draft) => {
                                const allNodes = Object.values(draft.doc.nodes);
                                const nodeCount = allNodes.length;
                                const beatCount = totalBeatCount(draft.doc);
                                const endingCount = allNodes.filter(node => node.type === "end").length;
                                const extraMenu = slots?.cardMenuItems?.(draft) ?? [];

                                return (
                                    <Card key={draft.id} variant="filled" radius="lg" className="flex min-w-0 flex-col justify-between p-4">
                                        <div className="min-w-0 space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="truncate type-title-m text-on-surface">
                                                        {draft.doc.meta.title || t("page.storyMaker.untitled")}
                                                    </h3>
                                                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 type-label-m text-on-surface-variant">
                                                        <span className="shrink-0 rounded-md3-xs bg-secondary-container px-1.5 py-0.5 type-label-s text-on-secondary-container">
                                                            {t(SERVER_LABEL_KEYS[draft.doc.region])}
                                                        </span>
                                                        {draft.doc.meta.author && (
                                                            <span className="min-w-0 truncate">{draft.doc.meta.author}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <Menu
                                                    align="end"
                                                    items={[
                                                        {
                                                            key: "rename",
                                                            label: t("page.storyMaker.landing.rename"),
                                                            icon: mdTitle,
                                                            onSelect: () => {
                                                                setRenameValue(draft.doc.meta.title);
                                                                setRenaming(draft);
                                                            },
                                                        },
                                                        {
                                                            key: "duplicate",
                                                            label: t("page.storyMaker.landing.duplicate"),
                                                            icon: mdContentCopy,
                                                            onSelect: () => void handleDuplicate(draft),
                                                        },
                                                        {
                                                            key: "export-msk",
                                                            label: t("page.storyMaker.v2.script.downloadScript"),
                                                            icon: mdCode,
                                                            onSelect: () => handleExportDraft(draft),
                                                        },
                                                        ...extraMenu,
                                                        {
                                                            key: "delete",
                                                            label: t("page.storyMaker.landing.delete"),
                                                            icon: mdDelete,
                                                            dividerBefore: true,
                                                            onSelect: () => setDeleting(draft),
                                                        },
                                                    ]}
                                                    anchor={({ ref, onClick }) => (
                                                        <IconButton
                                                            ref={ref}
                                                            size="xs"
                                                            icon={mdMoreVert}
                                                            label={t("common.md3.more")}
                                                            onClick={onClick}
                                                        />
                                                    )}
                                                />
                                            </div>

                                            {draft.doc.meta.summary && (
                                                <p className="line-clamp-2 break-words type-body-s text-on-surface-variant">
                                                    {draft.doc.meta.summary}
                                                </p>
                                            )}

                                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center -space-x-1.5">
                                                    {draft.doc.cast.slice(0, 4).map(member => (
                                                        member.characterId ? (
                                                            <img
                                                                key={member.key}
                                                                src={getCharacterIconUrl(member.characterId)}
                                                                alt={member.name}
                                                                title={member.name}
                                                                className="size-7 rounded-full border border-surface-container bg-surface-container-highest object-cover"
                                                            />
                                                        ) : (
                                                            <span
                                                                key={member.key}
                                                                title={member.name}
                                                                className="flex size-7 items-center justify-center rounded-full border border-surface-container bg-secondary-container type-label-s text-on-secondary-container"
                                                            >
                                                                {(member.name || "?").slice(0, 1)}
                                                            </span>
                                                        )
                                                    ))}
                                                    {draft.doc.cast.length > 4 && (
                                                        <span className="flex size-7 items-center justify-center rounded-full border border-surface-container bg-surface-container-high type-label-s text-on-surface-variant">
                                                            +{draft.doc.cast.length - 4}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-1.5 type-label-s text-on-surface-variant">
                                                    <span className="inline-flex items-center gap-1 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5">
                                                        <Icon path={mdAccountTree} size={13} />
                                                        <span className="font-mono">{nodeCount}</span>
                                                        <span>{t("page.storyMaker.nle.tabNodes")}</span>
                                                    </span>
                                                    <span className="inline-flex items-center rounded-md3-xs bg-surface-container-high px-1.5 py-0.5">
                                                        {t("page.storyMaker.stats.steps", { count: beatCount })}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1 rounded-md3-xs bg-surface-container-high px-1.5 py-0.5">
                                                        <Icon path={mdFlag} size={13} />
                                                        <span className="font-mono">{endingCount}</span>
                                                        <span>{t("page.storyMaker.v2.nodeTypes.end")}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-outline-variant/60 pt-3">
                                            <span className="min-w-0 flex-1 truncate type-label-s text-on-surface-variant">
                                                {t("page.storyMaker.landing.updatedAt", { time: dateFormatter.format(new Date(draft.updatedAt)) })}
                                            </span>
                                            <div className="flex shrink-0 flex-wrap items-center gap-1">
                                                {slots?.cardActions?.(draft)}
                                                {onPlayDraft ? (
                                                    <Button
                                                        size="xs"
                                                        variant="text"
                                                        icon={mdPlayArrowFill}
                                                        onClick={() => onPlayDraft(draft.id)}
                                                    >
                                                        {t("page.storyMaker.action.play")}
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="xs"
                                                        variant="text"
                                                        icon={mdPlayArrowFill}
                                                        href={getPlayHref(draft.id)}
                                                    >
                                                        {t("page.storyMaker.action.play")}
                                                    </Button>
                                                )}
                                                {onOpenDraft ? (
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdEdit}
                                                        onClick={() => onOpenDraft(draft.id)}
                                                    >
                                                        {t("page.storyMaker.action.edit")}
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="xs"
                                                        variant="tonal"
                                                        icon={mdEdit}
                                                        href={getEditHref(draft.id)}
                                                    >
                                                        {t("page.storyMaker.action.edit")}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                        <LoadMore
                            label={t("page.storyMaker.landing.loadMore")}
                            shown={visibleDrafts.length}
                            total={filtered.length}
                            onLoadMore={loadMore}
                        />
                    </>
                )}
            </section>

            <StoryMetaDialog
                isOpen={creatingOpen}
                onClose={() => { if (!creatingDraft) setCreatingOpen(false); }}
                title={t("page.storyMaker.landing.newStory")}
                confirmLabel={t("page.storyMaker.landing.createConfirm")}
                initial={{ title: "", author: "", summary: "", region: defaultRegion }}
                syncHistory={false}
                submitting={creatingDraft}
                onSubmit={values => void handleCreate(values)}
            />

            <StoryImportDialog
                isOpen={importOpen}
                onClose={() => { if (!creatingDraft) setImportOpen(false); }}
                syncHistory={false}
                submitting={creatingDraft}
                onImport={doc => void handleImport(doc)}
            />

            <Dialog
                isOpen={renaming !== null}
                onClose={() => setRenaming(null)}
                title={t("page.storyMaker.landing.renameTitle")}
                size="sm"
                actions={(
                    <>
                        <Button variant="text" onClick={() => setRenaming(null)}>{t("common.action.cancel")}</Button>
                        <Button variant="filled" onClick={() => void handleRename()}>{t("common.action.confirm")}</Button>
                    </>
                )}
            >
                <TextField
                    label={t("page.storyMaker.meta.title")}
                    value={renameValue}
                    maxLength={STORY_LIMITS.title}
                    onChange={event => setRenameValue(event.target.value)}
                />
            </Dialog>

            <Dialog
                isOpen={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t("page.storyMaker.landing.deleteTitle")}
                size="sm"
                actions={(
                    <>
                        <Button variant="text" onClick={() => setDeleting(null)}>{t("common.action.cancel")}</Button>
                        <Button variant="filled" color="error" onClick={() => void handleDelete()}>
                            {t("page.storyMaker.landing.delete")}
                        </Button>
                    </>
                )}
            >
                <p className="type-body-m text-on-surface-variant">
                    {deleting && t("page.storyMaker.landing.deleteDescription", {
                        title: deleting.doc.meta.title || t("page.storyMaker.untitled"),
                    })}
                </p>
            </Dialog>

            <Snackbar open={snack !== null} message={snack ?? ""} onClose={() => setSnack(null)} />
        </PageContainer>
    );
}
