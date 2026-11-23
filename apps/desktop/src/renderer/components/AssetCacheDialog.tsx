import React, { useEffect, useRef } from "react";
import { Button, Dialog } from "@moesekai/story-editor/md3";
import { mdDelete, mdFolderOpen } from "@moesekai/story-editor/md3/icons";
import type { AssetCacheStats, DesktopUiLocale } from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";
import { AssetCachePanel } from "./AssetCachePanel";

export interface AssetCacheDialogProps {
    open: boolean;
    locale: DesktopUiLocale;
    assetCacheEnabled: boolean;
    assetCacheMaxMb: number;
    cacheStats: AssetCacheStats | null;
    loadingStats: boolean;
    onRefreshStats: () => void;
    onToggleEnabled: (enabled: boolean) => void;
    onChangeMaxMb: (mb: number) => void;
    onOpenCacheDir: () => void;
    onClearCache: () => void;
    onClose: () => void;
}

export const AssetCacheDialog: React.FC<AssetCacheDialogProps> = ({
    open,
    locale,
    assetCacheEnabled,
    assetCacheMaxMb,
    cacheStats,
    loadingStats,
    onRefreshStats,
    onToggleEnabled,
    onChangeMaxMb,
    onOpenCacheDir,
    onClearCache,
    onClose,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const onRefreshRef = useRef(onRefreshStats);
    useEffect(() => {
        onRefreshRef.current = onRefreshStats;
    }, [onRefreshStats]);

    useEffect(() => {
        if (open) {
            onRefreshRef.current();
        }
    }, [open]);

    return (
        <Dialog
            isOpen={open}
            onClose={onClose}
            title={t("cacheDialogTitle")}
            size="md"
            className="max-w-[520px]"
            showClose
            syncHistory={false}
            actions={
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <Button
                        variant="outlined"
                        size="s"
                        icon={mdFolderOpen}
                        data-testid="cache-open-dir-btn"
                        onClick={onOpenCacheDir}
                    >
                        {t("cacheOpenDirBtn")}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="tonal"
                            size="s"
                            icon={mdDelete}
                            data-testid="cache-clear-btn"
                            disabled={loadingStats}
                            onClick={onClearCache}
                        >
                            {t("cacheClearBtn")}
                        </Button>
                        <Button variant="filled" size="s" onClick={onClose}>
                            {t("close")}
                        </Button>
                    </div>
                </div>
            }
        >
            <div data-testid="asset-cache-dialog" className="py-0.5">
                <AssetCachePanel
                    locale={locale}
                    assetCacheEnabled={assetCacheEnabled}
                    assetCacheMaxMb={assetCacheMaxMb}
                    cacheStats={cacheStats}
                    loadingStats={loadingStats}
                    showInlineActions={false}
                    onRefreshStats={onRefreshStats}
                    onToggleEnabled={onToggleEnabled}
                    onChangeMaxMb={onChangeMaxMb}
                    onOpenCacheDir={onOpenCacheDir}
                    onClearCache={onClearCache}
                />
            </div>
        </Dialog>
    );
};
