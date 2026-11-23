import React, { useMemo } from "react";
import {
    Banner,
    Button,
    Dialog,
    Icon,
    LinearProgress,
    SegmentedButton,
    Switch,
    cn,
} from "@moesekai/story-editor/md3";
import {
    mdCheckCircle,
    mdDownload,
    mdErrorFill,
    mdOpenInNew,
    mdRefresh,
    mdVerified,
} from "@moesekai/story-editor/md3/icons";
import type {
    DesktopUiLocale,
    DesktopUpdateCheckResult,
    UpdateChannel,
} from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { AgentMarkdown } from "./AgentMarkdown";

export interface UpdateDialogProps {
    open: boolean;
    locale: DesktopUiLocale;
    currentVersion: string;
    channel: UpdateChannel;
    autoCheckUpdates: boolean;
    checking: boolean;
    result: DesktopUpdateCheckResult | null;
    onClose: () => void;
    onChangeChannel: (channel: UpdateChannel) => void;
    onChangeAutoCheck: (enabled: boolean) => void;
    onCheckNow: (channelOverride?: UpdateChannel) => void;
    onOpenDownload: (url: string) => void;
    onIgnoreVersion: (version: string) => void;
}

const EMPTY_NODE_IDS = new Set<string>();
const NOOP_FOCUS = () => {};

function formatAssetSize(bytes: number | null): string | null {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
    open,
    locale,
    currentVersion,
    channel,
    autoCheckUpdates,
    checking,
    result,
    onClose,
    onChangeChannel,
    onChangeAutoCheck,
    onCheckNow,
    onOpenDownload,
    onIgnoreVersion,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const normalizedCurrent = currentVersion.replace(/^v/i, "") || "0.1.2";
    const isUpdateAvailable = result?.status === "update-available" && Boolean(result.latestVersion);
    const isUpToDate = result?.status === "up-to-date";
    const isError = result?.status === "error";

    const sourceBadgeLabel = useMemo(() => {
        if (!result) return null;
        return result.source === "cnb" ? t("updateSourceCnb") : t("updateSourceGithub");
    }, [locale, result]);

    const publishedLabel = useMemo(() => {
        if (!result?.publishedAt) return null;
        const dt = new Date(result.publishedAt);
        if (Number.isNaN(dt.getTime())) return null;
        return t("updatePublishedAtLabel", {
            date: dt.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }),
        });
    }, [locale, result?.publishedAt]);

    const sizeLabel = formatAssetSize(result?.assetSize ?? null);
    const primaryDownloadTarget = result?.downloadUrl || result?.releasePageUrl || null;

    return (
        <Dialog
            isOpen={open}
            onClose={onClose}
            title={t("updateDialogTitle")}
            size="md"
            className="max-w-[540px]"
            showClose
            syncHistory={false}
            actions={
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        {isUpdateAvailable && result?.latestVersion ? (
                            <Button
                                variant="text"
                                size="s"
                                data-testid="update-ignore-btn"
                                onClick={() => onIgnoreVersion(result.latestVersion!)}
                            >
                                {t("updateIgnoreVersion")}
                            </Button>
                        ) : (
                            <Button
                                variant="text"
                                size="s"
                                icon={mdRefresh}
                                disabled={checking}
                                onClick={() => onCheckNow()}
                            >
                                {checking ? t("updateCheckingNow") : t("updateCheckNow")}
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {result?.releasePageUrl ? (
                            <Button
                                variant="outlined"
                                size="s"
                                icon={mdOpenInNew}
                                data-testid="update-release-page-btn"
                                onClick={() => onOpenDownload(result.releasePageUrl)}
                            >
                                {t("updateOpenReleasePage")}
                            </Button>
                        ) : null}

                        {isUpdateAvailable && primaryDownloadTarget ? (
                            <Button
                                variant="filled"
                                size="s"
                                icon={mdDownload}
                                data-testid="update-download-btn"
                                onClick={() => onOpenDownload(primaryDownloadTarget)}
                            >
                                {t("updateDownloadInstaller")}
                            </Button>
                        ) : (
                            <Button variant="filled" size="s" onClick={onClose}>
                                {t("close")}
                            </Button>
                        )}
                    </div>
                </div>
            }
        >
            <div data-testid="update-dialog-content" className="flex flex-col gap-3 py-0.5">
                {checking ? (
                    <div className="flex flex-col gap-2.5 rounded-md3-lg border border-outline-variant bg-surface-container-low p-4">
                        <span className="type-label-l text-on-surface">{t("updateDialogChecking")}</span>
                        <LinearProgress />
                    </div>
                ) : isUpdateAvailable && result ? (
                    <div className="flex flex-col gap-2.5 rounded-md3-lg border border-primary/45 bg-surface-container-low p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md3-md bg-primary-container text-on-primary-container">
                                    <Icon path={mdVerified} size={18} />
                                </span>
                                <div className="flex flex-col">
                                    <span className="type-label-m text-on-surface-variant">
                                        {t("updateDialogAvailableTitle")}
                                    </span>
                                    <span
                                        data-testid="update-version-diff"
                                        className="font-mono type-title-m font-semibold text-on-surface"
                                    >
                                        v{normalizedCurrent} → v{result.latestVersion}
                                    </span>
                                </div>
                            </div>

                            {sourceBadgeLabel ? (
                                <span
                                    data-testid="update-source-badge"
                                    className={cn(
                                        "inline-flex shrink-0 items-center gap-1 rounded-md3-full px-2.5 py-1 type-label-s font-medium",
                                        result.source === "cnb"
                                            ? "bg-success-container text-on-success-container"
                                            : "bg-secondary-container text-on-secondary-container",
                                    )}
                                >
                                    {sourceBadgeLabel}
                                </span>
                            ) : null}
                        </div>

                        {result.fallbackUsed ? (
                            <p className="type-label-s text-on-surface-variant">
                                {t("updateFallbackNotice")}
                            </p>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/50 pt-2 type-label-s text-on-surface-variant">
                            {result.assetName ? (
                                <span className="inline-flex items-center gap-1 rounded-md3-sm bg-surface-container px-2 py-0.5 font-mono text-on-surface">
                                    <span>{t("updateMatchedAssetLabel")}:</span>
                                    <span className="max-w-[260px] truncate">{result.assetName}</span>
                                    {sizeLabel ? <span className="opacity-75">({sizeLabel})</span> : null}
                                </span>
                            ) : null}
                            {publishedLabel ? <span>{publishedLabel}</span> : null}
                        </div>
                    </div>
                ) : isUpToDate && result ? (
                    <div className="flex items-center justify-between gap-3 rounded-md3-lg border border-outline-variant bg-surface-container-low p-3.5">
                        <div className="flex items-center gap-2.5">
                            <Icon path={mdCheckCircle} size={22} className="shrink-0 text-success" />
                            <div className="flex flex-col">
                                <span className="type-title-s text-on-surface">
                                    {t("updateDialogUpToDateTitle")}
                                </span>
                                <span className="type-body-s text-on-surface-variant">
                                    {t("updateDialogUpToDateDesc", { version: normalizedCurrent })}
                                </span>
                            </div>
                        </div>
                        {sourceBadgeLabel ? (
                            <span
                                data-testid="update-source-badge"
                                className="shrink-0 rounded-md3-full bg-surface-container-high px-2.5 py-0.5 type-label-s text-on-surface-variant"
                            >
                                {sourceBadgeLabel}
                            </span>
                        ) : null}
                    </div>
                ) : isError && result ? (
                    <Banner tone="error" title={t("updateDialogErrorTitle")}>
                        <span className="font-mono type-label-s break-words">
                            {result.errorMessage || "Network error"}
                        </span>
                    </Banner>
                ) : (
                    <div className="flex items-center justify-between gap-2 rounded-md3-lg border border-outline-variant bg-surface-container-low p-3.5">
                        <div className="flex items-center gap-2">
                            <Icon path={mdErrorFill} size={18} className="text-on-surface-variant" />
                            <span className="font-mono type-body-m text-on-surface">
                                v{normalizedCurrent}
                            </span>
                        </div>
                        <Button variant="tonal" size="xs" icon={mdRefresh} onClick={() => onCheckNow()}>
                            {t("updateCheckNow")}
                        </Button>
                    </div>
                )}

                {result?.releaseNotes ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("updateReleaseNotesLabel")}
                            </span>
                            {result.releaseName ? (
                                <span className="type-label-s truncate text-on-surface-variant">
                                    {result.releaseName}
                                </span>
                            ) : null}
                        </div>
                        <div
                            data-testid="update-release-notes"
                            className="max-h-44 overflow-y-auto rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3"
                        >
                            <AgentMarkdown
                                text={result.releaseNotes}
                                knownNodeIds={EMPTY_NODE_IDS}
                                onFocusNode={NOOP_FOCUS}
                                jumpToNodeLabel={t("agentJumpToNode")}
                                copyLabel={t("agentCopyText")}
                                copiedLabel={t("agentCopied")}
                            />
                        </div>
                    </div>
                ) : null}

                <div className="flex flex-col gap-3 rounded-md3-lg border border-outline-variant/70 bg-surface-container-low p-3">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="type-label-m font-medium text-on-surface-variant">
                                {t("updateChannelLabel")}
                            </span>
                            <Button
                                variant="tonal"
                                size="xs"
                                icon={mdRefresh}
                                disabled={checking}
                                onClick={() => onCheckNow()}
                            >
                                {checking ? t("updateCheckingNow") : t("updateCheckNow")}
                            </Button>
                        </div>
                        <SegmentedButton<UpdateChannel>
                            density={-1}
                            value={channel}
                            onValueChange={nextChannel => {
                                onChangeChannel(nextChannel);
                                onCheckNow(nextChannel);
                            }}
                            aria-label={t("updateChannelLabel")}
                            options={[
                                { value: "auto", label: t("updateChannelAuto") },
                                { value: "cnb", label: t("updateChannelCnb") },
                                { value: "github", label: t("updateChannelGithub") },
                            ]}
                        />
                    </div>

                    <div className="h-px bg-outline-variant/60" />

                    <Switch
                        checked={autoCheckUpdates}
                        onCheckedChange={onChangeAutoCheck}
                        label={t("updateAutoCheckLabel")}
                    />
                </div>
            </div>
        </Dialog>
    );
};
