import React, { useEffect, useMemo, useState } from "react";
import {
    Button,
    Dialog,
    Icon,
    IconButton,
    SegmentedButton,
    Select,
    TextField,
    Tooltip,
} from "@moesekai/story-editor/md3";
import {
    mdAdd,
    mdChevronRight,
    mdDelete,
    mdDescription,
    mdFolder,
    mdFolderOpen,
    mdOpenInNew,
    mdPlayArrowFill,
    mdUploadFile,
} from "@moesekai/story-editor/md3/icons";
import type {
    DesktopStoryRegion,
    DesktopUiLocale,
    RecentProjectEntry,
} from "../../shared/ipc";
import type { NewProjectTemplate } from "../../shared/new-project";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { StudioLogo } from "./StudioLogo";

const REGION_OPTIONS_ZH: Array<{ value: DesktopStoryRegion; label: string }> = [
    { value: "jp", label: "JP — 日服" },
    { value: "cn", label: "CN — 国服" },
    { value: "tw", label: "TW — 繁中" },
    { value: "kr", label: "KR — 韩服" },
    { value: "en", label: "EN — 国际服" },
];

export interface WorkspaceWelcomeProps {
    locale: DesktopUiLocale;
    recentProjects: RecentProjectEntry[];
    createDialogOpen?: boolean;
    onCreateDialogOpenChange?: (open: boolean) => void;
    onCreateProject: (input: { title: string; region: DesktopStoryRegion; template: NewProjectTemplate }) => Promise<void>;
    onOpenStarterDemo: () => Promise<void>;
    onOpenFolder: () => Promise<void>;
    onOpenMskFile: () => Promise<void>;
    onOpenRecent: (entry: RecentProjectEntry) => Promise<void>;
    onRevealPath: (targetPath: string) => Promise<void>;
    onRemoveRecent: (targetPath: string) => Promise<void>;
    onOpenNotices?: () => void;
}

/**
 * Clean, distraction-free desktop studio launcher:
 * Brand + title, 4 crisp primary actions, and recent projects list.
 */
export const WorkspaceWelcome: React.FC<WorkspaceWelcomeProps> = ({
    locale,
    recentProjects,
    createDialogOpen,
    onCreateDialogOpenChange,
    onCreateProject,
    onOpenStarterDemo,
    onOpenFolder,
    onOpenMskFile,
    onOpenRecent,
    onRevealPath,
    onRemoveRecent,
    onOpenNotices,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const [internalCreateOpen, setInternalCreateOpen] = useState(false);
    const isCreateOpen = createDialogOpen !== undefined ? createDialogOpen : internalCreateOpen;
    const setCreateOpen = (next: boolean) => {
        setInternalCreateOpen(next);
        onCreateDialogOpenChange?.(next);
    };

    const [title, setTitle] = useState("");
    const [region, setRegion] = useState<DesktopStoryRegion>("jp");
    const [template, setTemplate] = useState<NewProjectTemplate>("blank");
    const [creating, setCreating] = useState(false);
    const [launchingDemo, setLaunchingDemo] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    useEffect(() => {
        if (!isCreateOpen) {
            setErrorText(null);
            setTemplate("blank");
        }
    }, [isCreateOpen]);

    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
        [locale],
    );

    const regionOptions = useMemo(() => {
        if (locale === "zh-CN" || locale === "zh-TW") return REGION_OPTIONS_ZH;
        return [
            { value: "jp" as const, label: "JP" },
            { value: "cn" as const, label: "CN" },
            { value: "tw" as const, label: "TW" },
            { value: "kr" as const, label: "KR" },
            { value: "en" as const, label: "EN" },
        ];
    }, [locale]);

    const handleConfirmCreate = async () => {
        setCreating(true);
        setErrorText(null);
        try {
            await onCreateProject({
                title: title.trim() || "Untitled Story",
                region,
                template,
            });
            setCreateOpen(false);
            setTitle("");
            setTemplate("blank");
        } catch (err) {
            setErrorText(err instanceof Error ? err.message : String(err));
        } finally {
            setCreating(false);
        }
    };

    const handleLaunchDemo = async () => {
        setLaunchingDemo(true);
        try {
            await onOpenStarterDemo();
        } finally {
            setLaunchingDemo(false);
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto bg-surface">
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-7 px-8 py-12">
                {/* Clean Flat Brand + Primary Actions Header (zero gradients) */}
                <section className="flex flex-col gap-5 border-b border-outline-variant/50 pb-7">
                    <div className="flex items-center gap-3.5">
                        <StudioLogo size={44} className="shrink-0" />
                        <h1 className="type-headline-l font-semibold tracking-tight text-on-surface">
                            {t("appName")}
                        </h1>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <Button
                            variant="filled"
                            size="m"
                            icon={mdAdd}
                            onClick={() => setCreateOpen(true)}
                        >
                            {t("newProject")}
                        </Button>
                        <Button
                            variant="tonal"
                            size="m"
                            icon={mdFolderOpen}
                            onClick={() => void onOpenFolder()}
                        >
                            {t("openFolder")}
                        </Button>
                        <Button
                            variant="outlined"
                            size="m"
                            icon={mdUploadFile}
                            onClick={() => void onOpenMskFile()}
                        >
                            {t("openMskFile")}
                        </Button>
                        <Button
                            variant="outlined"
                            size="m"
                            icon={mdPlayArrowFill}
                            disabled={launchingDemo}
                            onClick={() => void handleLaunchDemo()}
                        >
                            {t("trySample")}
                        </Button>
                    </div>
                </section>

                {/* Recent Projects */}
                <section className="flex flex-1 flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 px-0.5">
                        <div className="flex items-center gap-2">
                            <h2 className="type-title-m text-on-surface">{t("recentProjects")}</h2>
                            <span className="type-label-s rounded-md3-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">
                                {recentProjects.length}
                            </span>
                        </div>
                    </div>

                    {recentProjects.length === 0 ? (
                        <div className="rounded-md3-lg border border-outline-variant/60 bg-surface-container-low px-5 py-6 text-center">
                            <span className="type-body-m text-on-surface-variant">
                                {t("noRecentProjects")}
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {recentProjects.slice(0, 10).map(entry => (
                                <div
                                    key={entry.path}
                                    className="group flex items-center justify-between gap-3 rounded-md3-lg border border-outline-variant/60 bg-surface-container-low px-4 py-3 transition-colors hover:bg-surface-container"
                                >
                                    <button
                                        type="button"
                                        onClick={() => void onOpenRecent(entry)}
                                        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md3-sm text-left"
                                    >
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md3-md bg-primary-container/80 text-on-primary-container">
                                            <Icon
                                                path={entry.isSingleFile ? mdDescription : mdFolder}
                                                size={18}
                                            />
                                        </span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="type-title-s truncate text-on-surface">
                                                    {entry.title}
                                                </span>
                                                <span className="type-label-s shrink-0 rounded-md3-full bg-secondary-container px-2 py-0.5 text-on-secondary-container uppercase">
                                                    {entry.region}
                                                </span>
                                                <span className="type-label-s shrink-0 rounded-md3-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">
                                                    {entry.isSingleFile ? t("singleFileBadge") : t("folderBadge")}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="type-label-s truncate font-mono text-on-surface-variant">
                                                    {entry.path}
                                                </span>
                                                <span className="type-label-s shrink-0 text-on-surface-variant/75">
                                                    {dateFormatter.format(new Date(entry.lastOpenedAt))}
                                                </span>
                                            </div>
                                        </div>
                                    </button>

                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <Tooltip label={t("revealInExplorer")}>
                                            <IconButton
                                                variant="standard"
                                                size="xs"
                                                icon={mdOpenInNew}
                                                label={t("revealInExplorer")}
                                                onClick={() => void onRevealPath(entry.mskFilePath)}
                                            />
                                        </Tooltip>
                                        <Tooltip label={t("removeFromRecent")}>
                                            <IconButton
                                                variant="standard"
                                                size="xs"
                                                icon={mdDelete}
                                                label={t("removeFromRecent")}
                                                onClick={() => void onRemoveRecent(entry.path)}
                                            />
                                        </Tooltip>
                                        <Icon
                                            path={mdChevronRight}
                                            size={18}
                                            className="ml-0.5 text-on-surface-variant/60 transition-transform group-hover:translate-x-0.5"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Minimal Keyboard Shortcuts & Legal Notices Footer */}
                <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-outline-variant/60 pt-4 type-label-s text-on-surface-variant">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <span className="inline-flex items-center gap-1.5">
                            <kbd className="rounded-md3-xs border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">Ctrl+N</kbd>
                            <span>{t("newProject")}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <kbd className="rounded-md3-xs border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">Ctrl+O</kbd>
                            <span>{t("openFolder")}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <kbd className="rounded-md3-xs border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">Ctrl+S</kbd>
                            <span>{t("save")}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <kbd className="rounded-md3-xs border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">Ctrl+Shift+E</kbd>
                            <span>{t("exportMsk")}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <kbd className="rounded-md3-xs border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">Ctrl+Shift+A</kbd>
                            <span>{t("agentTitle")}</span>
                        </span>
                    </div>
                    {onOpenNotices ? (
                        <button
                            type="button"
                            data-testid="welcome-notices-link"
                            onClick={onOpenNotices}
                            className="focus-ring cursor-pointer rounded-md3-xs px-1.5 py-0.5 type-label-s text-on-surface-variant underline-offset-2 transition-colors hover:text-primary hover:underline"
                        >
                            {t("aboutAndNoticesLink")}
                        </button>
                    ) : null}
                </footer>
            </div>

            {/* New Project Modal Dialog */}
            <Dialog
                isOpen={isCreateOpen}
                onClose={() => !creating && setCreateOpen(false)}
                title={t("createProjectTitle")}
                size="sm"
                syncHistory={false}
                actions={
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            variant="text"
                            size="s"
                            onClick={() => setCreateOpen(false)}
                            disabled={creating}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            variant="filled"
                            size="s"
                            onClick={() => void handleConfirmCreate()}
                            disabled={creating}
                            icon={mdFolderOpen}
                        >
                            {t("chooseFolderAndCreate")}
                        </Button>
                    </div>
                }
            >
                <div className="flex flex-col gap-4 pt-1">
                    <TextField
                        label={t("projectTitleLabel")}
                        placeholder={t("projectTitlePlaceholder")}
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        autoFocus
                    />
                    <Select
                        label={t("projectRegionLabel")}
                        value={region}
                        onValueChange={val => setRegion(val)}
                        options={regionOptions}
                    />
                    <div className="flex flex-col gap-1.5">
                        <span className="type-label-m text-on-surface-variant">{t("projectTemplateLabel")}</span>
                        <SegmentedButton<NewProjectTemplate>
                            density={-1}
                            value={template}
                            onValueChange={val => setTemplate(val)}
                            options={[
                                { value: "blank", label: t("projectTemplateBlank") },
                                { value: "starter", label: t("projectTemplateStarter") },
                            ]}
                        />
                    </div>
                    {errorText ? (
                        <div className="type-body-s rounded-md3-md bg-error-container px-3 py-2 text-on-error-container">
                            {errorText}
                        </div>
                    ) : null}
                </div>
            </Dialog>
        </div>
    );
};
