import React, { useEffect, useRef, useState } from "react";
import {
    Banner,
    Button,
    Chip,
    Dialog,
    Icon,
    LinearProgress,
    Switch,
    cn,
} from "@moesekai/story-editor/md3";
import {
    mdCheckCircle,
    mdCode,
    mdDownload,
    mdErrorFill,
    mdFolder,
    mdInventory2,
    mdMyLocation,
    mdOpenInNew,
    mdRefresh,
    mdTranslate,
    mdWarningFill,
} from "@moesekai/story-editor/md3/icons";
import type {
    DesktopUiLocale,
    ExportOperationResult,
    ExportPreflightResult,
} from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";

export type ExportDialogMode = "msk" | "bundle-zip" | "bundle-folder" | "locales";

export interface ExportMskDialogProps {
    open: boolean;
    initialMode?: ExportDialogMode;
    locale: DesktopUiLocale;
    script: string;
    locales: Record<string, unknown>;
    voiceManifest: unknown | null;
    workspaceRoot: string | null;
    suggestedTitle: string;
    onClose: () => void;
    onFocusNode?: (nodeId: string) => void;
}

export const ExportMskDialog: React.FC<ExportMskDialogProps> = ({
    open,
    initialMode = "msk",
    locale,
    script,
    locales,
    voiceManifest,
    workspaceRoot,
    suggestedTitle,
    onClose,
    onFocusNode,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const [mode, setMode] = useState<ExportDialogMode>(initialMode);
    const [includePositions, setIncludePositions] = useState(false);
    const [checkLiveAssets, setCheckLiveAssets] = useState(false);
    const [preflight, setPreflight] = useState<ExportPreflightResult | null>(null);
    const [preflightLoading, setPreflightLoading] = useState(false);
    const [preflightError, setPreflightError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [exportResult, setExportResult] = useState<ExportOperationResult | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const requestSeqRef = useRef(0);

    useEffect(() => {
        if (open) {
            setMode(initialMode);
            setExportResult(null);
            setExportError(null);
        }
    }, [open, initialMode]);

    // Safe preflight runner with sequence guard & cleanup cancellation
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const seq = ++requestSeqRef.current;

        setPreflightLoading(true);
        setPreflightError(null);

        void window.moesekaiDesktop.exporter
            .preflight({
                script,
                includePositions,
                checkLiveAssets,
                locales,
                voiceManifest,
                workspaceRoot,
            })
            .then(result => {
                if (cancelled || seq !== requestSeqRef.current) return;
                setPreflight(result);
            })
            .catch(err => {
                if (cancelled || seq !== requestSeqRef.current) return;
                setPreflightError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (cancelled || seq !== requestSeqRef.current) return;
                setPreflightLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, script, includePositions, checkLiveAssets, locales, voiceManifest, workspaceRoot, refreshNonce]);

    const handleExport = async () => {
        setExporting(true);
        setExportError(null);
        setExportResult(null);

        try {
            let res: ExportOperationResult;
            if (mode === "msk") {
                res = await window.moesekaiDesktop.exporter.exportMsk({
                    script,
                    includePositions,
                    suggestedFileName: suggestedTitle,
                });
            } else if (mode === "bundle-zip" || mode === "bundle-folder") {
                res = await window.moesekaiDesktop.exporter.exportBundle({
                    script,
                    includePositions,
                    format: mode === "bundle-zip" ? "zip" : "folder",
                    locales,
                    voiceManifest,
                    workspaceRoot,
                    suggestedName: suggestedTitle,
                });
            } else {
                res = await window.moesekaiDesktop.exporter.exportLocales({
                    locales,
                    voiceManifest,
                });
            }

            if (!res.canceled) {
                setExportResult(res);
            }
        } catch (err) {
            setExportError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    const blocked = mode !== "locales" && Boolean(preflight && !preflight.canExportCleanMsk);

    const modeCards: Array<{
        id: ExportDialogMode;
        title: string;
        desc: string;
        icon: string;
    }> = [
        {
            id: "msk",
            title: t("exportModeMskTitle"),
            desc: t("exportModeMskDesc"),
            icon: mdCode,
        },
        {
            id: "bundle-zip",
            title: t("exportModeBundleZipTitle"),
            desc: t("exportModeBundleZipDesc"),
            icon: mdInventory2,
        },
        {
            id: "bundle-folder",
            title: t("exportModeBundleFolderTitle"),
            desc: t("exportModeBundleFolderDesc"),
            icon: mdFolder,
        },
        {
            id: "locales",
            title: t("exportModeLocalesTitle"),
            desc: t("exportModeLocalesDesc"),
            icon: mdTranslate,
        },
    ];

    return (
        <Dialog
            isOpen={open}
            onClose={() => !exporting && onClose()}
            title={t("exportDialogTitle")}
            supportingText={t("exportDialogSubtitle")}
            size="lg"
            syncHistory={false}
            actions={
                <div className="flex w-full items-center justify-between gap-2">
                    <Button
                        variant="text"
                        size="s"
                        icon={mdRefresh}
                        onClick={() => setRefreshNonce(n => n + 1)}
                        disabled={preflightLoading || exporting}
                    >
                        {t("exportRefreshPreflight")}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button variant="text" onClick={onClose} disabled={exporting}>
                            {t("close")}
                        </Button>
                        <Button
                            variant="filled"
                            icon={mdDownload}
                            onClick={() => void handleExport()}
                            disabled={exporting || preflightLoading || blocked}
                        >
                            {exporting ? t("exportingActionButton") : t("exportActionButton")}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4 py-1">
                {/* Preflight Status & Metrics */}
                {preflightLoading ? (
                    <div className="flex flex-col gap-2 rounded-md3-md bg-surface-container p-3">
                        <span className="type-label-m text-on-surface-variant">
                            {t("exportPreflightRunning")}
                        </span>
                        <LinearProgress />
                    </div>
                ) : preflightError ? (
                    <Banner tone="error">{preflightError}</Banner>
                ) : preflight ? (
                    <div className="flex flex-col gap-3 rounded-md3-lg border border-outline-variant bg-surface-container-low p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Icon
                                    path={preflight.ok ? mdCheckCircle : mdErrorFill}
                                    size={20}
                                    className={preflight.ok ? "text-success" : "text-error"}
                                />
                                <span className="type-title-s text-on-surface">
                                    {preflight.ok ? t("exportPreflightReady") : t("exportPreflightBlocked")}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                    className={cn(
                                        "type-label-s rounded-md3-full px-2.5 py-0.5 font-medium",
                                        preflight.errors.length > 0
                                            ? "bg-error-container text-on-error-container"
                                            : "bg-success-container text-on-success-container",
                                    )}
                                >
                                    {t("exportErrorsCount", { count: preflight.errors.length })}
                                </span>
                                <span
                                    className={cn(
                                        "type-label-s rounded-md3-full px-2.5 py-0.5 font-medium",
                                        preflight.warnings.length > 0
                                            ? "bg-warning-container text-on-warning-container"
                                            : "bg-surface-container-highest text-on-surface-variant",
                                    )}
                                >
                                    {t("exportWarningsCount", { count: preflight.warnings.length })}
                                </span>
                            </div>
                        </div>

                        {/* Story Metrics */}
                        <div className="flex flex-wrap gap-1.5">
                            <Chip variant="assist">
                                {t("exportNodesCount", { count: preflight.stats.nodeCount })}
                            </Chip>
                            <Chip variant="assist">
                                {t("exportBeatsCount", { count: preflight.stats.beatCount })}
                            </Chip>
                            <Chip variant="assist">
                                {t("exportEndingsCount", { count: preflight.stats.endingCount })}
                            </Chip>
                            <Chip variant="assist">
                                {t("exportLocalesCount", { count: preflight.stats.localeCount })}
                            </Chip>
                            <Chip variant="assist">
                                {t("exportVoicesCount", { count: preflight.stats.voiceLineCount })}
                            </Chip>
                        </div>

                        {/* Diagnostics List */}
                        {preflight.errors.length > 0 || preflight.warnings.length > 0 ? (
                            <div className="max-h-36 overflow-y-auto rounded-md3-md bg-surface-container-lowest p-2">
                                <ul className="flex flex-col gap-1">
                                    {[...preflight.errors, ...preflight.warnings].slice(0, 20).map((diag, idx) => (
                                        <li
                                            key={`${diag.code}-${diag.path}-${idx}`}
                                            className="flex items-center justify-between gap-2 rounded-md3-xs px-2 py-1 text-left"
                                        >
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                <Icon
                                                    path={diag.severity === "error" ? mdErrorFill : mdWarningFill}
                                                    size={15}
                                                    className={diag.severity === "error" ? "shrink-0 text-error" : "shrink-0 text-warning"}
                                                />
                                                <span className="type-label-s font-mono text-on-surface">
                                                    {diag.code}
                                                </span>
                                                <span className="type-body-s truncate text-on-surface-variant">
                                                    {diag.message || diag.path}
                                                </span>
                                            </div>
                                            {diag.nodeId && onFocusNode ? (
                                                <Button
                                                    variant="text"
                                                    size="xs"
                                                    icon={mdMyLocation}
                                                    onClick={() => {
                                                        onFocusNode(diag.nodeId!);
                                                        onClose();
                                                    }}
                                                >
                                                    {diag.nodeId}
                                                </Button>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {preflight.liveAssetIssues && preflight.liveAssetIssues.length > 0 ? (
                            <Banner tone="warning">
                                {preflight.liveAssetIssues.join(" · ")}
                            </Banner>
                        ) : null}
                    </div>
                ) : null}

                {/* Export Mode Cards */}
                <div className="flex flex-col gap-2">
                    <span className="type-label-l text-on-surface">{t("exportModeLabel")}</span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {modeCards.map(item => {
                            const selected = mode === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setMode(item.id)}
                                    className={cn(
                                        "state-layer focus-ring flex items-start gap-3 rounded-md3-lg border p-3 text-left transition-colors",
                                        selected
                                            ? "border-primary bg-primary-container text-on-primary-container"
                                            : "border-outline-variant bg-surface-card text-on-surface hover:bg-surface-container-low",
                                    )}
                                >
                                    <Icon
                                        path={item.icon}
                                        size={20}
                                        className={cn("mt-0.5 shrink-0", selected ? "text-on-primary-container" : "text-primary")}
                                    />
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="type-title-s">{item.title}</span>
                                        <span
                                            className={cn(
                                                "type-body-s",
                                                selected ? "text-on-primary-container/85" : "text-on-surface-variant",
                                            )}
                                        >
                                            {item.desc}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Export Options */}
                {mode !== "locales" ? (
                    <div className="flex flex-col gap-3 rounded-md3-lg bg-surface-container-low p-3.5">
                        <Switch
                            checked={includePositions}
                            onCheckedChange={setIncludePositions}
                            label={t("exportIncludePositions")}
                            description={t("exportIncludePositionsHint")}
                        />
                        <div className="h-px bg-outline-variant" />
                        <Switch
                            checked={checkLiveAssets}
                            onCheckedChange={setCheckLiveAssets}
                            label={t("exportCheckLiveAssets")}
                            description={t("exportCheckLiveAssetsHint")}
                        />
                    </div>
                ) : null}

                {/* Export Error / Success Result */}
                {exportError ? (
                    <Banner tone="error">{exportError}</Banner>
                ) : null}

                {exportResult && !exportResult.canceled && exportResult.outputPath ? (
                    <div className="flex items-center justify-between gap-3 rounded-md3-lg bg-success-container px-4 py-3 text-on-success-container">
                        <div className="flex min-w-0 flex-col">
                            <span className="type-title-s flex items-center gap-1.5">
                                <Icon path={mdCheckCircle} size={18} />
                                {t("exportSuccessTitle")}
                            </span>
                            <span className="type-body-s truncate">
                                {t("exportSuccessMeta", {
                                    bytes: exportResult.bytesWritten ?? 0,
                                    path: exportResult.outputPath,
                                })}
                            </span>
                        </div>
                        <Button
                            variant="tonal"
                            size="s"
                            icon={mdOpenInNew}
                            onClick={() => void window.moesekaiDesktop.workspace.revealPath(exportResult.outputPath)}
                        >
                            {t("revealInExplorer")}
                        </Button>
                    </div>
                ) : null}
            </div>
        </Dialog>
    );
};
