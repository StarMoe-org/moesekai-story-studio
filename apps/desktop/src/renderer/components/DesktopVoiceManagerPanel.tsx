import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    SUPPORTED_AUDIO_EXTENSIONS,
    SUPPORTED_UI_LOCALES,
    UI_LOCALE_LABELS,
    buildVoiceCueSheetCsv,
    buildVoiceCueSheetJson,
    buildVoiceCueSheetText,
    clearStoryAudioCache,
    extractTalkBeatsForVoice,
    formatByteSize,
    formatDurationMs,
    inferStorySourceLocale,
    isSupportedAudioFilename,
    matchAudioFilesToTalkBeats,
    probeAudioDurationMs,
    resolveVoiceManifestLineUrl,
    type StoryDocument,
    type StoryVoiceManifest,
    type StoryVoiceManifestLine,
    type TalkBeatVoiceSlot,
    type UiLocale,
} from "@moesekai/story-core";
import type { VoiceManifestUploadTabContext } from "@moesekai/story-editor";
import {
    Banner,
    Button,
    Chip,
    Icon,
    IconButton,
    LoadingIndicator,
    Select,
    Surface,
    Switch,
    TextField,
    Tooltip,
    cn,
    type SelectOption,
} from "@moesekai/story-editor/md3";
import {
    mdCheckCircle,
    mdClose,
    mdDelete,
    mdDescription,
    mdDownload,
    mdFolder,
    mdFolderOpen,
    mdGraphicEq,
    mdLink,
    mdMusicNote,
    mdPlayArrowFill,
    mdRecordVoiceOver,
    mdRefresh,
    mdSearch,
    mdStopFill,
    mdUploadFile,
    mdVolumeUp,
} from "@moesekai/story-editor/md3/icons";
import type { DesktopUiLocale, ImportedVoiceFileResult } from "../../shared/ipc";
import { formatDesktopMessage } from "../i18n/desktopMessages";

const MAX_LOCAL_VOICE_BYTES = 50 * 1024 * 1024; // 50 MiB

type BeatListFilter = "all" | "unassigned" | "assigned";

type UnmatchedVoiceItem =
    | {
          id: string;
          kind: "dropped-file";
          fileName: string;
          sizeBytes: number;
          file: File;
          targetBeatId: string | null;
      }
    | {
          id: string;
          kind: "workspace-file";
          fileName: string;
          originalName: string;
          relativePath: string;
          url: string;
          sizeBytes: number;
          targetBeatId: string | null;
      };

export interface DesktopVoiceManagerPanelProps {
    doc: StoryDocument;
    locale: DesktopUiLocale;
    workspaceProtocolBase: string;
    tabCtx: VoiceManifestUploadTabContext;
}

function getDisplayFileName(line: StoryVoiceManifestLine): string {
    const raw = (line.objectKey || line.url || "").trim();
    if (!raw) return "";
    const withoutQuery = raw.split(/[?#]/, 1)[0] ?? raw;
    const base = withoutQuery.replace(/\\/g, "/").split("/").pop() ?? withoutQuery;
    try {
        return decodeURIComponent(base);
    } catch {
        return base;
    }
}

function sanitizeDownloadStem(raw: string): string {
    const cleaned = raw
        .normalize("NFKC")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/^\.+/, "")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 64);
    return cleaned || "story";
}

function triggerTextDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function appendCacheBuster(url: string): string {
    if (!url.startsWith("moesekai-app://")) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}t=${Date.now()}`;
}

export const DesktopVoiceManagerPanel: React.FC<DesktopVoiceManagerPanelProps> = ({
    doc,
    locale,
    workspaceProtocolBase,
    tabCtx,
}) => {
    const t = useCallback(
        (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
            formatDesktopMessage(locale, key, vars),
        [locale],
    );

    const talkBeats = useMemo<TalkBeatVoiceSlot[]>(() => extractTalkBeatsForVoice(doc), [doc]);
    const talkBeatById = useMemo(() => new Map(talkBeats.map(b => [b.beatId, b])), [talkBeats]);

    const currentManifest = tabCtx.currentManifest;
    const assignedLines = currentManifest?.lines ?? {};

    const [voiceLocale, setVoiceLocale] = useState<UiLocale>(
        () => currentManifest?.locale ?? inferStorySourceLocale(doc),
    );
    const [overrideOfficial, setOverrideOfficial] = useState<boolean>(
        () => Boolean(currentManifest?.overrideOfficialVoice),
    );
    const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedVoiceItem[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorBanner, setErrorBanner] = useState<string | null>(null);
    const [filter, setFilter] = useState<BeatListFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [playingKey, setPlayingKey] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const previewObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        if (currentManifest?.locale) {
            setVoiceLocale(currentManifest.locale);
        }
    }, [currentManifest?.locale]);

    useEffect(() => {
        if (currentManifest) {
            setOverrideOfficial(Boolean(currentManifest.overrideOfficialVoice));
        }
    }, [currentManifest]);

    const stopPreview = useCallback(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.src = "";
            audioRef.current = null;
        }
        if (previewObjectUrlRef.current) {
            URL.revokeObjectURL(previewObjectUrlRef.current);
            previewObjectUrlRef.current = null;
        }
        setPlayingKey(null);
    }, []);

    useEffect(() => stopPreview, [stopPreview]);

    const buildManifest = useCallback(
        (
            nextLines: Record<string, StoryVoiceManifestLine>,
            overrides?: { locale?: UiLocale; overrideOfficialVoice?: boolean },
        ): StoryVoiceManifest | null => {
            if (Object.keys(nextLines).length === 0) {
                return null;
            }
            const nextLocale = overrides?.locale ?? voiceLocale;
            const nextOverride = overrides?.overrideOfficialVoice ?? overrideOfficial;
            const {
                overrideOfficialVoice: _prevOverride,
                ...preservedBase
            } = currentManifest ?? {};
            const resolvedTitle = doc.meta.title?.trim() || currentManifest?.title;
            return {
                ...preservedBase,
                schema: "moesekai-story-voice/1",
                storyId: currentManifest?.storyId || doc.id,
                ...(resolvedTitle ? { title: resolvedTitle } : {}),
                locale: nextLocale,
                ...(nextOverride ? { overrideOfficialVoice: true } : {}),
                lines: nextLines,
            };
        },
        [currentManifest, doc.id, doc.meta.title, overrideOfficial, voiceLocale],
    );

    const commitLines = useCallback(
        (
            nextLines: Record<string, StoryVoiceManifestLine>,
            overrides?: { locale?: UiLocale; overrideOfficialVoice?: boolean },
        ) => {
            tabCtx.applyManifest(buildManifest(nextLines, overrides));
        },
        [buildManifest, tabCtx],
    );

    const handleChangeLocale = useCallback(
        (nextLocale: UiLocale) => {
            setVoiceLocale(nextLocale);
            if (currentManifest && Object.keys(currentManifest.lines).length > 0) {
                commitLines({ ...currentManifest.lines }, { locale: nextLocale });
            }
        },
        [commitLines, currentManifest],
    );

    const handleToggleOverride = useCallback(
        (next: boolean) => {
            setOverrideOfficial(next);
            if (currentManifest && Object.keys(currentManifest.lines).length > 0) {
                commitLines({ ...currentManifest.lines }, { overrideOfficialVoice: next });
            }
        },
        [commitLines, currentManifest],
    );

    const handleExportCueSheet = useCallback(
        (format: "csv" | "txt" | "json") => {
            const stem = sanitizeDownloadStem(doc.meta.title || doc.id);
            if (format === "csv") {
                const csv = buildVoiceCueSheetCsv(doc, { locale: voiceLocale });
                triggerTextDownload(csv, `${stem}.voice-cue-sheet.csv`, "text/csv;charset=utf-8");
            } else if (format === "txt") {
                const txt = buildVoiceCueSheetText(doc, { locale: voiceLocale });
                triggerTextDownload(txt, `${stem}.voice-cue-sheet.txt`, "text/plain;charset=utf-8");
            } else {
                const json = buildVoiceCueSheetJson(doc, { locale: voiceLocale });
                triggerTextDownload(json, `${stem}.voice-cue-sheet.json`, "application/json;charset=utf-8");
            }
            tabCtx.notify(t("voiceManagerCueSheetExportedToast", { format: format.toUpperCase() }));
        },
        [doc, t, tabCtx, voiceLocale],
    );

    const handleOpenVoicesDir = useCallback(async () => {
        setErrorBanner(null);
        try {
            await window.moesekaiDesktop.workspace.openVoicesDir();
        } catch (err) {
            setErrorBanner(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const mergeImportedIntoManifest = useCallback(
        (
            matchedEntries: Array<{
                beatId: string;
                imported: ImportedVoiceFileResult;
                durationMs?: number;
            }>,
        ) => {
            if (matchedEntries.length === 0) return;
            const nextLines: Record<string, StoryVoiceManifestLine> = {
                ...(currentManifest?.lines ?? {}),
            };
            for (const { beatId, imported, durationMs } of matchedEntries) {
                const beat = talkBeatById.get(beatId);
                nextLines[beatId] = {
                    url: imported.relativePath,
                    objectKey: imported.relativePath,
                    ...(beat?.speakerName ? { speaker: beat.speakerName } : {}),
                    ...(imported.sizeBytes > 0 ? { sizeBytes: imported.sizeBytes } : {}),
                    ...(durationMs && durationMs > 0 ? { durationMs } : {}),
                };
            }
            clearStoryAudioCache();
            commitLines(nextLines);
        },
        [commitLines, currentManifest?.lines, talkBeatById],
    );

    const handleDroppedFiles = useCallback(
        async (rawFiles: File[]) => {
            if (rawFiles.length === 0 || busy) return;
            setErrorBanner(null);
            setBusy(true);
            try {
                let skippedCount = 0;
                const candidateFiles: File[] = [];
                for (const file of rawFiles) {
                    if (!isSupportedAudioFilename(file.name) || file.size <= 0 || file.size > MAX_LOCAL_VOICE_BYTES) {
                        skippedCount += 1;
                        continue;
                    }
                    candidateFiles.push(file);
                }

                const matchResult = matchAudioFilesToTalkBeats(candidateFiles, talkBeats);
                skippedCount += matchResult.unsupported.length;

                const matchedPairs = Array.from(matchResult.matched.entries());
                if (matchedPairs.length > 0) {
                    const durationResults = await Promise.all(
                        matchedPairs.map(([, file]) => probeAudioDurationMs(file).catch(() => null)),
                    );
                    const bufferItems = await Promise.all(
                        matchedPairs.map(async ([beatId, file]) => ({
                            fileName: file.name,
                            beatId,
                            bytes: new Uint8Array(await file.arrayBuffer()),
                        })),
                    );
                    const importedList = await window.moesekaiDesktop.workspace.importVoiceFiles({
                        mode: "buffers",
                        items: bufferItems,
                    });
                    const entries = matchedPairs
                        .map(([beatId], idx) => {
                            const imported = importedList[idx];
                            if (!imported) return null;
                            const dur = durationResults[idx];
                            return {
                                beatId,
                                imported,
                                durationMs: dur ?? undefined,
                            };
                        })
                        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

                    mergeImportedIntoManifest(entries);
                }

                if (matchResult.unmatched.length > 0) {
                    setUnmatchedItems(prev => {
                        const existingKeys = new Set(prev.map(i => `${i.kind}:${i.fileName.toLowerCase()}`));
                        const added: UnmatchedVoiceItem[] = [];
                        for (const file of matchResult.unmatched) {
                            const dedupKey = `dropped-file:${file.name.toLowerCase()}`;
                            if (existingKeys.has(dedupKey)) continue;
                            existingKeys.add(dedupKey);
                            added.push({
                                id: `drop:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
                                kind: "dropped-file",
                                fileName: file.name,
                                sizeBytes: file.size,
                                file,
                                targetBeatId: null,
                            });
                        }
                        return [...prev, ...added];
                    });
                }

                if (matchedPairs.length > 0 && matchResult.unmatched.length > 0) {
                    tabCtx.notify(
                        t("voiceManagerMatchedWithUnmatchedToast", {
                            matched: matchedPairs.length,
                            unmatched: matchResult.unmatched.length,
                        }),
                    );
                } else if (matchedPairs.length > 0) {
                    tabCtx.notify(t("voiceManagerMatchedToast", { matched: matchedPairs.length }));
                } else if (matchResult.unmatched.length > 0) {
                    tabCtx.notify(t("voiceManagerUnmatchedOnlyToast", { count: matchResult.unmatched.length }));
                } else if (skippedCount > 0) {
                    tabCtx.notify(t("voiceManagerUnsupportedSkippedToast", { count: skippedCount }));
                }
            } catch (err) {
                setErrorBanner(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        },
        [busy, mergeImportedIntoManifest, t, tabCtx, talkBeats],
    );

    const handleNativeBatchImport = useCallback(
        async (mode: "files" | "folder") => {
            if (busy) return;
            setErrorBanner(null);
            setBusy(true);
            try {
                const imported = await window.moesekaiDesktop.workspace.importVoiceFiles({
                    mode,
                    knownBeatIds: talkBeats.map(b => b.beatId),
                });
                if (imported.length === 0) return;

                const matchResult = matchAudioFilesToTalkBeats(
                    imported.map(item => ({ ...item, name: item.fileName })),
                    talkBeats,
                );

                const matchedEntries = Array.from(matchResult.matched.entries()).map(([beatId, item]) => ({
                    beatId,
                    imported: item,
                }));
                mergeImportedIntoManifest(matchedEntries);

                if (matchResult.unmatched.length > 0) {
                    setUnmatchedItems(prev => {
                        const existingPaths = new Set(
                            prev
                                .filter((i): i is Extract<UnmatchedVoiceItem, { kind: "workspace-file" }> => i.kind === "workspace-file")
                                .map(i => i.relativePath.toLowerCase()),
                        );
                        const added: UnmatchedVoiceItem[] = [];
                        for (const item of matchResult.unmatched) {
                            if (existingPaths.has(item.relativePath.toLowerCase())) continue;
                            existingPaths.add(item.relativePath.toLowerCase());
                            added.push({
                                id: `ws:${item.relativePath}`,
                                kind: "workspace-file",
                                fileName: item.fileName,
                                originalName: item.originalName,
                                relativePath: item.relativePath,
                                url: item.url,
                                sizeBytes: item.sizeBytes,
                                targetBeatId: null,
                            });
                        }
                        return [...prev, ...added];
                    });
                }

                if (matchedEntries.length > 0 && matchResult.unmatched.length > 0) {
                    tabCtx.notify(
                        t("voiceManagerMatchedWithUnmatchedToast", {
                            matched: matchedEntries.length,
                            unmatched: matchResult.unmatched.length,
                        }),
                    );
                } else if (matchedEntries.length > 0) {
                    tabCtx.notify(t("voiceManagerMatchedToast", { matched: matchedEntries.length }));
                } else if (matchResult.unmatched.length > 0) {
                    tabCtx.notify(t("voiceManagerUnmatchedOnlyToast", { count: matchResult.unmatched.length }));
                }
            } catch (err) {
                setErrorBanner(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        },
        [busy, mergeImportedIntoManifest, t, tabCtx, talkBeats],
    );

    const handleRescanVoicesDir = useCallback(async () => {
        if (busy) return;
        setErrorBanner(null);
        setBusy(true);
        try {
            const files = await window.moesekaiDesktop.workspace.listVoiceFiles();
            if (files.length === 0) {
                tabCtx.notify(t("voiceManagerRescanEmptyToast"));
                return;
            }
            const matchResult = matchAudioFilesToTalkBeats(
                files.map(item => ({ ...item, name: item.fileName })),
                talkBeats,
            );
            const matchedEntries = Array.from(matchResult.matched.entries()).map(([beatId, item]) => ({
                beatId,
                imported: item,
            }));
            mergeImportedIntoManifest(matchedEntries);

            const normalizeWorkspaceRel = (raw?: string) => {
                if (!raw) return "";
                return raw
                    .trim()
                    .replace(/^moesekai-app:\/\/(?:app\/)?workspace\//i, "")
                    .replace(/^\/+/, "")
                    .split(/[?#]/, 1)[0]
                    .toLowerCase();
            };

            const boundRelPaths = new Set<string>();
            for (const line of Object.values(currentManifest?.lines ?? {})) {
                const k = normalizeWorkspaceRel(line.objectKey);
                const u = normalizeWorkspaceRel(line.url);
                if (k) boundRelPaths.add(k);
                if (u) boundRelPaths.add(u);
            }
            for (const entry of matchedEntries) {
                boundRelPaths.add(entry.imported.relativePath.toLowerCase());
            }

            const unboundWorkspaceFiles = matchResult.unmatched.filter(
                item => !boundRelPaths.has(item.relativePath.toLowerCase()),
            );
            if (unboundWorkspaceFiles.length > 0) {
                setUnmatchedItems(prev => {
                    const existingPaths = new Set(
                        prev
                            .filter((i): i is Extract<UnmatchedVoiceItem, { kind: "workspace-file" }> => i.kind === "workspace-file")
                            .map(i => i.relativePath.toLowerCase()),
                    );
                    const added: UnmatchedVoiceItem[] = [];
                    for (const item of unboundWorkspaceFiles) {
                        if (existingPaths.has(item.relativePath.toLowerCase())) continue;
                        existingPaths.add(item.relativePath.toLowerCase());
                        added.push({
                            id: `ws:${item.relativePath}`,
                            kind: "workspace-file",
                            fileName: item.fileName,
                            originalName: item.originalName,
                            relativePath: item.relativePath,
                            url: item.url,
                            sizeBytes: item.sizeBytes,
                            targetBeatId: null,
                        });
                    }
                    return [...prev, ...added];
                });
            }

            if (matchedEntries.length > 0) {
                tabCtx.notify(t("voiceManagerRescanResultToast", { matched: matchedEntries.length }));
            } else if (unboundWorkspaceFiles.length > 0) {
                tabCtx.notify(t("voiceManagerUnmatchedOnlyToast", { count: unboundWorkspaceFiles.length }));
            } else {
                tabCtx.notify(t("voiceManagerRescanEmptyToast"));
            }
        } catch (err) {
            setErrorBanner(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, [busy, currentManifest?.lines, mergeImportedIntoManifest, t, tabCtx, talkBeats]);

    const handlePickSingleBeatAudio = useCallback(
        async (beatId: string) => {
            if (busy) return;
            setErrorBanner(null);
            setBusy(true);
            try {
                const imported = await window.moesekaiDesktop.workspace.importVoiceFile(beatId);
                if (!imported) return;
                if (playingKey === `beat:${beatId}`) {
                    stopPreview();
                }
                const beat = talkBeatById.get(beatId);
                const nextLines: Record<string, StoryVoiceManifestLine> = {
                    ...(currentManifest?.lines ?? {}),
                    [beatId]: {
                        url: imported.relativePath,
                        objectKey: imported.relativePath,
                        ...(beat?.speakerName ? { speaker: beat.speakerName } : {}),
                        ...(imported.sizeBytes > 0 ? { sizeBytes: imported.sizeBytes } : {}),
                    },
                };
                clearStoryAudioCache();
                commitLines(nextLines);
                tabCtx.notify(t("voiceManagerBoundBeatToast", { beatId }));
            } catch (err) {
                setErrorBanner(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        },
        [busy, commitLines, currentManifest?.lines, playingKey, stopPreview, t, tabCtx, talkBeatById],
    );

    const handleRemoveBeatAudio = useCallback(
        (beatId: string) => {
            if (playingKey === `beat:${beatId}`) {
                stopPreview();
            }
            const nextLines: Record<string, StoryVoiceManifestLine> = {
                ...(currentManifest?.lines ?? {}),
            };
            delete nextLines[beatId];
            clearStoryAudioCache();
            commitLines(nextLines);
            tabCtx.notify(t("voiceManagerRemovedBeatToast", { beatId }));
        },
        [commitLines, currentManifest?.lines, playingKey, stopPreview, t, tabCtx],
    );

    const handleClearAll = useCallback(() => {
        stopPreview();
        clearStoryAudioCache();
        tabCtx.applyManifest(null);
        tabCtx.notify(t("voiceManagerClearedToast"));
    }, [stopPreview, t, tabCtx]);

    const handleBindUnmatched = useCallback(
        async (item: UnmatchedVoiceItem) => {
            if (!item.targetBeatId || busy) return;
            const beatId = item.targetBeatId;
            setErrorBanner(null);
            setBusy(true);
            try {
                if (playingKey === `unmatched:${item.id}` || playingKey === `beat:${beatId}`) {
                    stopPreview();
                }
                const beat = talkBeatById.get(beatId);
                if (item.kind === "dropped-file") {
                    const durationMs = await probeAudioDurationMs(item.file).catch(() => null);
                    const bytes = new Uint8Array(await item.file.arrayBuffer());
                    const [imported] = await window.moesekaiDesktop.workspace.importVoiceFiles({
                        mode: "buffers",
                        items: [{ fileName: item.fileName, beatId, bytes }],
                    });
                    if (!imported) return;
                    mergeImportedIntoManifest([
                        { beatId, imported, durationMs: durationMs ?? undefined },
                    ]);
                } else {
                    const nextLines: Record<string, StoryVoiceManifestLine> = {
                        ...(currentManifest?.lines ?? {}),
                        [beatId]: {
                            url: item.relativePath,
                            objectKey: item.relativePath,
                            ...(beat?.speakerName ? { speaker: beat.speakerName } : {}),
                            ...(item.sizeBytes > 0 ? { sizeBytes: item.sizeBytes } : {}),
                        },
                    };
                    clearStoryAudioCache();
                    commitLines(nextLines);
                }
                setUnmatchedItems(prev => prev.filter(entry => entry.id !== item.id));
                tabCtx.notify(t("voiceManagerBoundBeatToast", { beatId }));
            } catch (err) {
                setErrorBanner(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        },
        [busy, commitLines, currentManifest?.lines, mergeImportedIntoManifest, playingKey, stopPreview, t, tabCtx, talkBeatById],
    );

    const startAudioPreview = useCallback(
        (key: string, playbackUrl: string, ownedObjectUrl?: string) => {
            if (playingKey === key) {
                stopPreview();
                return;
            }
            stopPreview();
            if (ownedObjectUrl) {
                previewObjectUrlRef.current = ownedObjectUrl;
            }
            const audio = new Audio();
            audio.preload = "auto";
            audio.onended = () => {
                if (audioRef.current === audio) {
                    stopPreview();
                }
            };
            audio.onerror = () => {
                if (audioRef.current === audio) {
                    stopPreview();
                    tabCtx.notify(t("voiceManagerPreviewErrorToast"));
                }
            };
            audio.src = ownedObjectUrl ? playbackUrl : appendCacheBuster(playbackUrl);
            audioRef.current = audio;
            setPlayingKey(key);
            void audio.play().catch(() => {
                if (audioRef.current === audio) {
                    stopPreview();
                    tabCtx.notify(t("voiceManagerPreviewErrorToast"));
                }
            });
        },
        [playingKey, stopPreview, t, tabCtx],
    );

    const handleToggleBeatPreview = useCallback(
        (beatId: string) => {
            const key = `beat:${beatId}`;
            if (playingKey === key) {
                stopPreview();
                return;
            }
            const urls = resolveVoiceManifestLineUrl(currentManifest, beatId, {
                localWorkspaceBaseUrl: workspaceProtocolBase,
                allowBlobUrls: true,
            });
            const url = urls[0];
            if (!url) {
                tabCtx.notify(t("voiceManagerPreviewErrorToast"));
                return;
            }
            startAudioPreview(key, url);
        },
        [currentManifest, playingKey, startAudioPreview, stopPreview, t, tabCtx, workspaceProtocolBase],
    );

    const handleToggleUnmatchedPreview = useCallback(
        (item: UnmatchedVoiceItem) => {
            const key = `unmatched:${item.id}`;
            if (playingKey === key) {
                stopPreview();
                return;
            }
            if (item.kind === "dropped-file") {
                const blobUrl = URL.createObjectURL(item.file);
                startAudioPreview(key, blobUrl, blobUrl);
            } else {
                startAudioPreview(key, item.url);
            }
        },
        [playingKey, startAudioPreview, stopPreview],
    );

    const matchedCount = useMemo(
        () => talkBeats.filter(beat => Boolean(assignedLines[beat.beatId])).length,
        [assignedLines, talkBeats],
    );
    const unassignedCount = talkBeats.length - matchedCount;

    const beatSelectOptions = useMemo<SelectOption<string>[]>(
        () =>
            talkBeats.map(beat => {
                const speaker = beat.speakerName || t("voiceManagerNarratorFallback");
                const preview = beat.textPreview.length > 36
                    ? `${beat.textPreview.slice(0, 36)}…`
                    : beat.textPreview;
                const isAssigned = Boolean(assignedLines[beat.beatId]);
                return {
                    value: beat.beatId,
                    label: (
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="shrink-0 font-mono text-xs text-primary">{beat.beatId}</span>
                            <span className="shrink-0 text-xs font-medium text-on-surface">{speaker}:</span>
                            <span className="min-w-0 truncate text-xs text-on-surface-variant">{preview}</span>
                        </span>
                    ),
                    textValue: `${beat.beatId} ${speaker} ${beat.sceneTitle} ${beat.textPreview}`,
                    trailing: isAssigned ? (
                        <Icon path={mdCheckCircle} size={15} className="text-primary" />
                    ) : undefined,
                };
            }),
        [assignedLines, t, talkBeats],
    );

    const visibleBeats = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return talkBeats.filter(beat => {
            const hasAssigned = Boolean(assignedLines[beat.beatId]);
            if (filter === "assigned" && !hasAssigned) return false;
            if (filter === "unassigned" && hasAssigned) return false;
            if (!q) return true;
            return (
                beat.beatId.toLowerCase().includes(q) ||
                beat.sceneTitle.toLowerCase().includes(q) ||
                beat.speakerName.toLowerCase().includes(q) ||
                beat.textPreview.toLowerCase().includes(q)
            );
        });
    }, [assignedLines, filter, searchQuery, talkBeats]);

    return (
        <div className="min-w-0 space-y-4" data-testid="desktop-voice-manager-panel">
            <p className="type-body-s text-on-surface-variant">{t("voiceManagerSubtitle")}</p>

            {/* Voice language + override official voice settings */}
            <Surface tone="low" radius="lg" className="min-w-0 space-y-3 border border-outline-variant/60 p-3.5">
                <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="type-label-l text-on-surface">{t("voiceManagerLocaleLabel")}</span>
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-md3-full bg-secondary-container px-2.5 py-0.5 type-label-s text-on-secondary-container">
                                <Icon path={mdRecordVoiceOver} size={14} />
                                {t("voiceManagerProgressSummary", {
                                    matched: matchedCount,
                                    total: talkBeats.length,
                                })}
                            </span>
                            {Object.keys(assignedLines).length > 0 && (
                                <Button
                                    size="xs"
                                    variant="text"
                                    icon={mdDelete}
                                    disabled={busy}
                                    onClick={handleClearAll}
                                >
                                    {t("voiceManagerClearAll")}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {SUPPORTED_UI_LOCALES.map(loc => (
                            <Chip
                                key={loc}
                                variant="filter"
                                selected={voiceLocale === loc}
                                onClick={() => handleChangeLocale(loc)}
                            >
                                {UI_LOCALE_LABELS[loc]}
                            </Chip>
                        ))}
                    </div>
                </div>

                <div className="h-px bg-outline-variant/60" />

                <Switch
                    checked={overrideOfficial}
                    onCheckedChange={handleToggleOverride}
                    label={t("voiceManagerOverrideLabel")}
                    description={t("voiceManagerOverrideDesc")}
                />
            </Surface>

            {/* Cue sheet export & local voices/ folder actions */}
            <Surface tone="default" radius="lg" className="min-w-0 space-y-2.5 border border-outline-variant/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 type-label-l text-on-surface">
                            <Icon path={mdDescription} size={16} className="shrink-0 text-primary" />
                            <span>{t("voiceManagerCueSheetTitle")}</span>
                        </div>
                        <p className="type-body-s text-on-surface-variant">{t("voiceManagerCueSheetHint")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                            size="xs"
                            variant="outlined"
                            icon={mdDownload}
                            disabled={talkBeats.length === 0}
                            onClick={() => handleExportCueSheet("csv")}
                        >
                            {t("voiceManagerExportCsv")}
                        </Button>
                        <Button
                            size="xs"
                            variant="outlined"
                            icon={mdDownload}
                            disabled={talkBeats.length === 0}
                            onClick={() => handleExportCueSheet("txt")}
                        >
                            {t("voiceManagerExportTxt")}
                        </Button>
                        <Button
                            size="xs"
                            variant="outlined"
                            icon={mdDownload}
                            disabled={talkBeats.length === 0}
                            onClick={() => handleExportCueSheet("json")}
                        >
                            {t("voiceManagerExportJson")}
                        </Button>
                        <Button
                            size="xs"
                            variant="tonal"
                            icon={mdFolderOpen}
                            onClick={() => void handleOpenVoicesDir()}
                        >
                            {t("voiceManagerOpenFolder")}
                        </Button>
                        <Button
                            size="xs"
                            variant="text"
                            icon={mdRefresh}
                            disabled={busy}
                            onClick={() => void handleRescanVoicesDir()}
                        >
                            {t("voiceManagerRescanFolder")}
                        </Button>
                    </div>
                </div>
            </Surface>

            {/* Drag-and-drop zone + native multi-file / folder pickers */}
            <div
                onDragOver={event => {
                    event.preventDefault();
                    if (!isDragging) setIsDragging(true);
                }}
                onDragLeave={event => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setIsDragging(false);
                }}
                onDrop={event => {
                    event.preventDefault();
                    setIsDragging(false);
                    const files = Array.from(event.dataTransfer.files ?? []);
                    void handleDroppedFiles(files);
                }}
                className={cn(
                    "flex flex-col items-center justify-center gap-2.5 rounded-md3-lg border-2 border-dashed px-4 py-5 text-center transition-colors",
                    isDragging
                        ? "border-primary bg-primary-container/30"
                        : "border-outline-variant bg-surface-container-low",
                )}
            >
                <div className="flex items-center gap-2 text-primary">
                    {busy ? (
                        <LoadingIndicator size={22} contained />
                    ) : (
                        <Icon path={mdUploadFile} size={24} />
                    )}
                    <span className="type-title-s text-on-surface">{t("voiceManagerDropTitle")}</span>
                </div>
                <p className="type-body-s text-on-surface-variant">
                    {t("voiceManagerDropSubtitle", {
                        formats: SUPPORTED_AUDIO_EXTENSIONS.join(" / "),
                    })}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
                    <Button
                        size="s"
                        variant="filled"
                        icon={mdMusicNote}
                        disabled={busy}
                        onClick={() => void handleNativeBatchImport("files")}
                    >
                        {t("voiceManagerPickFiles")}
                    </Button>
                    <Button
                        size="s"
                        variant="tonal"
                        icon={mdFolder}
                        disabled={busy}
                        onClick={() => void handleNativeBatchImport("folder")}
                    >
                        {t("voiceManagerPickFolder")}
                    </Button>
                </div>
            </div>

            {errorBanner && <Banner tone="error">{errorBanner}</Banner>}

            {/* Unmatched files manual-binder list */}
            {unmatchedItems.length > 0 && (
                <Surface tone="low" radius="lg" className="min-w-0 space-y-2.5 border border-outline-variant/60 p-3.5">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 type-title-s text-on-surface">
                            <Icon path={mdLink} size={18} className="text-primary" />
                            <span>{t("voiceManagerUnmatchedTitle", { count: unmatchedItems.length })}</span>
                        </div>
                        <p className="type-body-s text-on-surface-variant">{t("voiceManagerUnmatchedDesc")}</p>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
                        {unmatchedItems.map(item => {
                            const isPlaying = playingKey === `unmatched:${item.id}`;
                            return (
                                <div
                                    key={item.id}
                                    className="flex flex-col gap-2 rounded-md3-md border border-outline-variant/50 bg-surface-container-lowest p-2.5 sm:flex-row sm:items-center"
                                >
                                    <div className="flex min-w-0 items-center gap-2 sm:w-52 sm:shrink-0">
                                        <Tooltip label={t(isPlaying ? "voiceManagerPreviewStop" : "voiceManagerPreviewPlay")}>
                                            <IconButton
                                                size="xs"
                                                variant={isPlaying ? "filled" : "tonal"}
                                                icon={isPlaying ? mdStopFill : mdPlayArrowFill}
                                                label={t(isPlaying ? "voiceManagerPreviewStop" : "voiceManagerPreviewPlay")}
                                                onClick={() => handleToggleUnmatchedPreview(item)}
                                            />
                                        </Tooltip>
                                        <div className="min-w-0">
                                            <div className="truncate font-mono type-label-m text-on-surface" title={item.fileName}>
                                                {item.fileName}
                                            </div>
                                            <div className="type-label-s text-on-surface-variant">
                                                {formatByteSize(item.sizeBytes)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <Select<string>
                                            searchable
                                            value={item.targetBeatId}
                                            onValueChange={nextBeatId =>
                                                setUnmatchedItems(prev =>
                                                    prev.map(entry =>
                                                        entry.id === item.id ? { ...entry, targetBeatId: nextBeatId } : entry,
                                                    ),
                                                )
                                            }
                                            options={beatSelectOptions}
                                            placeholder={t("voiceManagerBindBeatPlaceholder")}
                                        />
                                    </div>
                                    <div className="flex shrink-0 items-center justify-end gap-1">
                                        <Button
                                            size="xs"
                                            variant="filled"
                                            disabled={!item.targetBeatId || busy}
                                            onClick={() => void handleBindUnmatched(item)}
                                        >
                                            {t("voiceManagerBindAction")}
                                        </Button>
                                        <IconButton
                                            size="xs"
                                            variant="standard"
                                            icon={mdClose}
                                            label={t("voiceManagerRemoveAudio")}
                                            onClick={() => {
                                                if (isPlaying) stopPreview();
                                                setUnmatchedItems(prev => prev.filter(entry => entry.id !== item.id));
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Surface>
            )}

            {/* Talk beat list header & filter controls */}
            {talkBeats.length === 0 ? (
                <Surface tone="low" radius="lg" className="border border-outline-variant/50 p-6 text-center">
                    <p className="type-body-m text-on-surface-variant">{t("voiceManagerNoTalkBeats")}</p>
                </Surface>
            ) : (
                <div className="min-w-0 space-y-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Chip
                                variant="filter"
                                selected={filter === "all"}
                                onClick={() => setFilter("all")}
                            >
                                {t("voiceManagerFilterAll", { count: talkBeats.length })}
                            </Chip>
                            <Chip
                                variant="filter"
                                selected={filter === "unassigned"}
                                onClick={() => setFilter("unassigned")}
                            >
                                {t("voiceManagerFilterUnassigned", { count: unassignedCount })}
                            </Chip>
                            <Chip
                                variant="filter"
                                selected={filter === "assigned"}
                                onClick={() => setFilter("assigned")}
                            >
                                {t("voiceManagerFilterAssigned", { count: matchedCount })}
                            </Chip>
                        </div>
                        {talkBeats.length > 6 && (
                            <TextField
                                variant="outlined"
                                icon={mdSearch}
                                value={searchQuery}
                                onValueChange={setSearchQuery}
                                placeholder={t("voiceManagerSearchPlaceholder")}
                                clearable
                                containerClassName="sm:w-64"
                            />
                        )}
                    </div>

                    {visibleBeats.length === 0 ? (
                        <Surface tone="low" radius="md" className="border border-outline-variant/50 p-4 text-center">
                            <p className="type-body-s text-on-surface-variant">{t("voiceManagerNoFilterMatches")}</p>
                        </Surface>
                    ) : (
                        <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-0.5">
                            {visibleBeats.map(beat => {
                                const assigned = assignedLines[beat.beatId];
                                const isPlaying = playingKey === `beat:${beat.beatId}`;
                                const assignedFileName = assigned ? getDisplayFileName(assigned) : "";
                                const speakerLabel = beat.speakerName || t("voiceManagerNarratorFallback");

                                return (
                                    <div
                                        key={beat.beatId}
                                        className={cn(
                                            "flex flex-col gap-2 rounded-md3-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
                                            assigned
                                                ? "border-primary/35 bg-primary-container/10"
                                                : "border-outline-variant/50 bg-surface-container-lowest",
                                        )}
                                    >
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="rounded-md3-xs bg-surface-container-high px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                                                    {beat.beatId}
                                                </span>
                                                <span className="max-w-[140px] truncate rounded-md3-xs bg-surface-container px-1.5 py-0.5 type-label-s text-on-surface-variant">
                                                    {beat.sceneTitle}
                                                </span>
                                                <span className="type-label-m font-medium text-on-surface">
                                                    {speakerLabel}
                                                </span>
                                                {beat.hasOfficialVoice && (
                                                    <span className="inline-flex items-center gap-0.5 rounded-md3-full bg-tertiary-container px-2 py-0.5 text-[11px] font-medium text-on-tertiary-container">
                                                        <Icon path={mdVolumeUp} size={12} />
                                                        {t("voiceManagerOfficialVoiceBadge")}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="line-clamp-2 type-body-s text-on-surface-variant">
                                                {beat.textPreview || "—"}
                                            </p>
                                            {assigned && (
                                                <div className="flex flex-wrap items-center gap-1.5 type-label-s text-primary">
                                                    <Icon path={mdGraphicEq} size={14} className="shrink-0" />
                                                    <span className="max-w-[240px] truncate font-mono" title={assignedFileName}>
                                                        {assignedFileName}
                                                    </span>
                                                    {typeof assigned.durationMs === "number" && assigned.durationMs > 0 && (
                                                        <span className="text-on-surface-variant">
                                                            · {formatDurationMs(assigned.durationMs)}
                                                        </span>
                                                    )}
                                                    {typeof assigned.sizeBytes === "number" && assigned.sizeBytes > 0 && (
                                                        <span className="text-on-surface-variant">
                                                            · {formatByteSize(assigned.sizeBytes)}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center justify-end gap-1">
                                            {assigned ? (
                                                <>
                                                    <Tooltip label={t(isPlaying ? "voiceManagerPreviewStop" : "voiceManagerPreviewPlay")}>
                                                        <IconButton
                                                            size="xs"
                                                            variant={isPlaying ? "filled" : "tonal"}
                                                            icon={isPlaying ? mdStopFill : mdPlayArrowFill}
                                                            label={t(isPlaying ? "voiceManagerPreviewStop" : "voiceManagerPreviewPlay")}
                                                            onClick={() => handleToggleBeatPreview(beat.beatId)}
                                                        />
                                                    </Tooltip>
                                                    <Button
                                                        size="xs"
                                                        variant="outlined"
                                                        disabled={busy}
                                                        onClick={() => void handlePickSingleBeatAudio(beat.beatId)}
                                                    >
                                                        {t("voiceManagerReplaceAudio")}
                                                    </Button>
                                                    <Tooltip label={t("voiceManagerRemoveAudio")}>
                                                        <IconButton
                                                            size="xs"
                                                            variant="standard"
                                                            icon={mdDelete}
                                                            label={t("voiceManagerRemoveAudio")}
                                                            disabled={busy}
                                                            onClick={() => handleRemoveBeatAudio(beat.beatId)}
                                                        />
                                                    </Tooltip>
                                                </>
                                            ) : (
                                                <Button
                                                    size="xs"
                                                    variant="tonal"
                                                    icon={mdMusicNote}
                                                    disabled={busy}
                                                    onClick={() => void handlePickSingleBeatAudio(beat.beatId)}
                                                >
                                                    {t("voiceManagerPickBeatAudio")}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
