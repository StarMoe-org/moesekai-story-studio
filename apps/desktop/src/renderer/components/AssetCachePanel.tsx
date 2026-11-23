import React, { useMemo } from "react";
import {
    Button,
    SegmentedButton,
    Switch,
} from "@moesekai/story-editor/md3";
import {
    mdDelete,
    mdFolderOpen,
    mdRefresh,
} from "@moesekai/story-editor/md3/icons";
import type { AssetCacheStats, DesktopUiLocale } from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";

export interface AssetCachePanelProps {
    locale: DesktopUiLocale;
    assetCacheEnabled: boolean;
    assetCacheMaxMb: number;
    cacheStats: AssetCacheStats | null;
    loadingStats: boolean;
    showInlineActions?: boolean;
    onRefreshStats: () => void;
    onToggleEnabled: (enabled: boolean) => void;
    onChangeMaxMb: (mb: number) => void;
    onOpenCacheDir: () => void;
    onClearCache: () => void;
}

const CACHE_CAP_OPTIONS = [
    { value: "512", label: "512 MB" },
    { value: "1024", label: "1 GB" },
    { value: "2048", label: "2 GB" },
    { value: "4096", label: "4 GB" },
] as const;

function formatBytes(bytes: number | null | undefined): string {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const AssetCachePanel: React.FC<AssetCachePanelProps> = ({
    locale,
    assetCacheEnabled,
    assetCacheMaxMb,
    cacheStats,
    loadingStats,
    showInlineActions = false,
    onRefreshStats,
    onToggleEnabled,
    onChangeMaxMb,
    onOpenCacheDir,
    onClearCache,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const hitRateText = useMemo(() => {
        if (!cacheStats) return t("cacheNoRequestsYet");
        const totalReqs = cacheStats.hits + cacheStats.staleHits + cacheStats.misses;
        if (totalReqs <= 0) return t("cacheNoRequestsYet");
        const pct = Math.round(((cacheStats.hits + cacheStats.staleHits) / totalReqs) * 100);
        return `${pct}%`;
    }, [cacheStats, locale]);

    const nearestCapValue = useMemo(() => {
        const caps = [512, 1024, 2048, 4096];
        let best = 2048;
        let minDiff = Infinity;
        for (const c of caps) {
            const diff = Math.abs(assetCacheMaxMb - c);
            if (diff < minDiff) {
                minDiff = diff;
                best = c;
            }
        }
        return String(best);
    }, [assetCacheMaxMb]);

    return (
        <div className="flex flex-col gap-3">
            <div
                data-testid="cache-stats-card"
                className="flex flex-col gap-2.5 rounded-md3-lg border border-outline-variant/75 bg-surface-container-low p-3.5"
            >
                <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-0.5 rounded-md3-md bg-surface-container px-3 py-2">
                        <span className="type-label-s text-on-surface-variant">
                            {t("cacheEntriesLabel")}
                        </span>
                        <span className="font-mono type-title-m font-semibold text-on-surface">
                            {cacheStats?.entries ?? 0}
                        </span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-md3-md bg-surface-container px-3 py-2">
                        <span className="type-label-s text-on-surface-variant">
                            {t("cacheDiskUsageLabel")}
                        </span>
                        <span className="font-mono type-title-m font-semibold text-on-surface">
                            {formatBytes(cacheStats?.totalBytes ?? 0)}
                        </span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-md3-md bg-surface-container px-3 py-2">
                        <span className="type-label-s text-on-surface-variant">
                            {t("cacheHitRateLabel")}
                        </span>
                        <span className="font-mono type-title-m font-semibold text-on-surface">
                            {hitRateText}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-outline-variant/50 pt-2">
                    <div className="flex min-w-0 flex-col">
                        <span className="type-label-s text-on-surface-variant">
                            {t("cacheDirLabel")}
                        </span>
                        <span
                            title={cacheStats?.cacheDir ?? ""}
                            className="truncate font-mono type-label-s text-on-surface"
                        >
                            {cacheStats?.cacheDir ?? "—"}
                        </span>
                    </div>
                    <Button
                        variant="tonal"
                        size="xs"
                        icon={mdRefresh}
                        disabled={loadingStats}
                        onClick={onRefreshStats}
                    >
                        {t("cacheRefreshBtn")}
                    </Button>
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md3-lg border border-outline-variant/70 bg-surface-container-low p-3">
                <Switch
                    checked={assetCacheEnabled}
                    onCheckedChange={onToggleEnabled}
                    label={t("cacheEnableLabel")}
                />

                <div className="h-px bg-outline-variant/60" />

                <div className="flex flex-col gap-1.5">
                    <span className="type-label-m font-medium text-on-surface-variant">
                        {t("cacheMaxSizeLabel")}
                    </span>
                    <SegmentedButton<string>
                        density={-1}
                        value={nearestCapValue}
                        onValueChange={val => onChangeMaxMb(Number.parseInt(val, 10))}
                        aria-label={t("cacheMaxSizeLabel")}
                        options={CACHE_CAP_OPTIONS.map(opt => ({
                            value: opt.value,
                            label: opt.label,
                        }))}
                    />
                </div>

                {showInlineActions ? (
                    <>
                        <div className="h-px bg-outline-variant/60" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Button
                                variant="outlined"
                                size="xs"
                                icon={mdFolderOpen}
                                onClick={onOpenCacheDir}
                            >
                                {t("cacheOpenDirBtn")}
                            </Button>
                            <Button
                                variant="tonal"
                                size="xs"
                                icon={mdDelete}
                                disabled={loadingStats}
                                onClick={onClearCache}
                            >
                                {t("cacheClearBtn")}
                            </Button>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
};
