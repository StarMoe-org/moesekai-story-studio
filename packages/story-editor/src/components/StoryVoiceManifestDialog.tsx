"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    Banner, Button, Dialog, Divider, Icon, LoadingIndicator, Surface, Switch, Tabs, TextField,
} from "../md3";
import {
    mdCheckCircle, mdDelete, mdLink, mdRecordVoiceOver, mdTranslate, mdUploadFile,
} from "../md3/icons";
import { useStoryI18n as useI18n } from "../context/StoryStudioContext";
import {
    SUPPORTED_UI_LOCALES,
    UI_LOCALE_LABELS,
    detectJsonArtifactKind,
    isSafeVoiceManifestUrl,
    matchVoiceManifestToDoc,
    parseAndValidateLocalePack,
    parseStoryJson,
    parseStoryVoiceManifest,
    type StoryDocument,
    type StoryLocalePack,
    type StoryVoiceManifest,
    type UiLocale,
    type VoiceManifestMatchSummary,
} from "@moesekai/story-core";
import { VoiceCueSheetExportBar } from "./VoiceCueSheetExportBar";
import {
    detectAudioFilesForManifestDrop,
    resolveVoiceManifestDialogTab,
    type AudioFileDropDetection,
    type VoiceManifestDialogTab,
} from "./voiceTrackUtils";

export {
    detectAudioFilesForManifestDrop,
    resolveVoiceManifestDialogTab,
    type AudioFileDropDetection,
    type VoiceManifestDialogTab,
};

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export interface VoiceManifestUploadTabContext {
    closeDialog: () => void;
    applyManifest: (manifest: StoryVoiceManifest | null) => void;
    applyManifestUrl: (url: string) => Promise<void>;
    currentManifest: StoryVoiceManifest | null;
    notify: (msg: string) => void;
}

export interface VoiceManifestUploadTabConfig {
    label: string;
    render: (tabCtx: VoiceManifestUploadTabContext) => ReactNode;
}

export interface StoryVoiceManifestDialogProps {
    isOpen: boolean;
    onClose: () => void;
    doc: StoryDocument;
    currentManifest: StoryVoiceManifest | null;
    onApplyManifest: (manifest: StoryVoiceManifest | null) => void;
    /** Optional 1-click rescue when the user uploads/pastes a `.story.json` here instead of Story Import. */
    onSwitchToStoryImport?: (doc: StoryDocument) => void;
    /** Optional 1-click rescue when the user uploads/pastes a `.i18n.json` subtitle pack here. */
    onApplyLocalePack?: (pack: StoryLocalePack) => void;
    /** Optional host-injected primary tab (e.g. Web's Community Audio Upload panel or Desktop local voice directory matcher). */
    uploadTab?: VoiceManifestUploadTabConfig | null;
    /** Optional tab override when opening; defaults to `"upload"` when `uploadTab` is provided, else `"import"`. */
    initialTab?: VoiceManifestDialogTab;
    onNotify?: (message: string) => void;
}

export type ManifestEvaluation =
    | { kind: "manifest"; manifest: StoryVoiceManifest; match: VoiceManifestMatchSummary }
    | { kind: "story"; storyDoc: StoryDocument | null }
    | { kind: "localePack"; localePack: StoryLocalePack | null; locale: UiLocale | null }
    | AudioFileDropDetection
    | { kind: "invalid" };

export function evaluateManifestText(rawText: string, doc: StoryDocument): ManifestEvaluation {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return { kind: "invalid" };
    }

    const artifactKind = detectJsonArtifactKind(parsed);
    if (artifactKind === "story") {
        const storyRes = parseStoryJson(rawText);
        return { kind: "story", storyDoc: storyRes.ok ? storyRes.doc : null };
    }
    if (artifactKind === "localePack") {
        const rawLocale = typeof (parsed as { locale?: unknown }).locale === "string"
            ? (parsed as { locale: string }).locale
            : null;
        const validLocale = rawLocale && (SUPPORTED_UI_LOCALES as readonly string[]).includes(rawLocale)
            ? (rawLocale as UiLocale)
            : null;
        const packRes = validLocale
            ? parseAndValidateLocalePack(rawText, doc, validLocale, { importSource: "file_upload" })
            : null;
        return {
            kind: "localePack",
            localePack: packRes?.ok && packRes.pack ? packRes.pack : null,
            locale: validLocale,
        };
    }

    const manifest = parseStoryVoiceManifest(parsed);
    if (!manifest) {
        return { kind: "invalid" };
    }
    return {
        kind: "manifest",
        manifest,
        match: matchVoiceManifestToDoc(doc, manifest),
    };
}

/**
 * Interactive MD3 Expressive dialog for managing custom voice tracks: host-provided audio upload/local
 * directory management (`uploadTab`, shown first by default) plus advanced external `manifest.json`
 * (`moesekai-story-voice/1`) import via HTTPS URL, local file, or pasted JSON.
 */
export function StoryVoiceManifestDialog({
    isOpen,
    onClose,
    doc,
    currentManifest,
    onApplyManifest,
    onSwitchToStoryImport,
    onApplyLocalePack,
    uploadTab = null,
    initialTab,
    onNotify,
}: StoryVoiceManifestDialogProps) {
    const { t } = useI18n();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const requestSeqRef = useRef(0);
    const mountedRef = useRef(true);
    const hasUploadTab = Boolean(uploadTab);

    const [activeTab, setActiveTab] = useState<VoiceManifestDialogTab>(
        () => resolveVoiceManifestDialogTab(hasUploadTab, initialTab),
    );
    const [urlInput, setUrlInput] = useState("");
    const [fetching, setFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [text, setText] = useState("");
    const [fileError, setFileError] = useState<string | null>(null);
    const [evaluation, setEvaluation] = useState<ManifestEvaluation | null>(null);
    const [candidateOverrideOfficial, setCandidateOverrideOfficial] = useState(false);

    const effectiveTab: VoiceManifestDialogTab = hasUploadTab ? activeTab : "import";

    useEffect(() => {
        if (isOpen) {
            setActiveTab(resolveVoiceManifestDialogTab(hasUploadTab, initialTab));
        }
    }, [hasUploadTab, initialTab, isOpen]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.abort();
            abortRef.current = null;
        }
    }, [isOpen]);

    const currentMatch = useMemo(
        () => (currentManifest ? matchVoiceManifestToDoc(doc, currentManifest) : null),
        [doc, currentManifest],
    );

    const resetDraftState = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        requestSeqRef.current += 1;
        setFetching(false);
        setFetchError(null);
        setFileError(null);
        setText("");
        setEvaluation(null);
        setCandidateOverrideOfficial(false);
    };

    const handleClose = () => {
        resetDraftState();
        onClose();
    };

    const evaluate = (raw: string) => {
        setText(raw);
        setFileError(null);
        setFetchError(null);
        if (!raw.trim()) {
            setEvaluation(null);
            setCandidateOverrideOfficial(false);
            return;
        }
        const result = evaluateManifestText(raw, doc);
        setEvaluation(result);
        setCandidateOverrideOfficial(
            result.kind === "manifest" ? Boolean(result.manifest.overrideOfficialVoice) : false,
        );
    };

    const loadFiles = async (files: FileList | readonly File[] | null | undefined) => {
        if (!files || files.length === 0) return;
        setFetchError(null);
        setFileError(null);

        const audioDrop = detectAudioFilesForManifestDrop(files);
        if (audioDrop) {
            setText("");
            setEvaluation(audioDrop);
            setCandidateOverrideOfficial(false);
            return;
        }

        const file = files[0];
        if (!file) return;
        if (file.size > MAX_MANIFEST_BYTES) {
            setFileError(t("page.storyMaker.i18n.fileTooLarge"));
            setEvaluation(null);
            setCandidateOverrideOfficial(false);
            return;
        }
        try {
            const content = await file.text();
            evaluate(content);
        } catch {
            setFileError(t("page.storyMaker.i18n.readFailed"));
            setEvaluation(null);
            setCandidateOverrideOfficial(false);
        }
    };

    const handleFetchUrl = async () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        setFileError(null);
        setFetchError(null);

        if (!isSafeVoiceManifestUrl(trimmed)) {
            setFetchError(t("page.storyMaker.voiceTrack.unsafeUrl"));
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const seq = ++requestSeqRef.current;
        setFetching(true);

        try {
            const response = await fetch(trimmed, {
                mode: "cors",
                credentials: "omit",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentLength = Number(response.headers.get("content-length") ?? "0");
            if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
                throw new Error(t("page.storyMaker.i18n.fileTooLarge"));
            }
            const rawText = await response.text();
            if (!mountedRef.current || requestSeqRef.current !== seq) return;
            if (rawText.length > MAX_MANIFEST_BYTES) {
                throw new Error(t("page.storyMaker.i18n.fileTooLarge"));
            }

            const result = evaluateManifestText(rawText, doc);
            if (result.kind === "manifest" && result.match.matchedCount > 0) {
                onApplyManifest(result.manifest);
                onNotify?.(t("page.storyMaker.voiceTrack.loadedToast", {
                    count: result.match.matchedCount,
                }));
                resetDraftState();
                onClose();
                return;
            }
            setText(rawText);
            setEvaluation(result);
            setCandidateOverrideOfficial(
                result.kind === "manifest" ? Boolean(result.manifest.overrideOfficialVoice) : false,
            );
        } catch (error) {
            if (!mountedRef.current || requestSeqRef.current !== seq) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            const reason = error instanceof Error && error.message ? error.message : "Network error";
            setFetchError(t("page.storyMaker.voiceTrack.fetchFailed", { reason }));
        } finally {
            if (mountedRef.current && requestSeqRef.current === seq) {
                setFetching(false);
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
            }
        }
    };

    const handleApplyEvaluated = () => {
        if (!evaluation || evaluation.kind !== "manifest") return;
        const nextManifest: StoryVoiceManifest = {
            ...evaluation.manifest,
            overrideOfficialVoice: candidateOverrideOfficial,
        };
        onApplyManifest(nextManifest);
        onNotify?.(t("page.storyMaker.voiceTrack.loadedToast", {
            count: evaluation.match.matchedCount,
        }));
        resetDraftState();
        onClose();
    };

    const handleAutoMountPublishedManifest = async (manifestUrl: string) => {
        const trimmed = manifestUrl.trim();
        if (!trimmed || !isSafeVoiceManifestUrl(trimmed)) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const seq = ++requestSeqRef.current;
        try {
            const response = await fetch(trimmed, {
                mode: "cors",
                credentials: "omit",
                signal: controller.signal,
            });
            if (!response.ok) return;
            const rawText = await response.text();
            if (!mountedRef.current || requestSeqRef.current !== seq) return;
            if (rawText.length > MAX_MANIFEST_BYTES) return;
            const parsed = parseStoryVoiceManifest(JSON.parse(rawText));
            if (parsed) {
                onApplyManifest(parsed);
            }
        } catch {
            // Instant-published status is already shown; ignore optional preview auto-mount network errors.
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
        }
    };

    const handleClearCurrent = () => {
        onApplyManifest(null);
        onNotify?.(t("page.storyMaker.voiceTrack.clearedToast"));
    };

    const canSubmitCandidate = effectiveTab === "import" && evaluation?.kind === "manifest";
    const candidateZeroMatch = evaluation?.kind === "manifest" && evaluation.match.matchedCount === 0;

    return (
        <Dialog
            isOpen={isOpen}
            onClose={handleClose}
            title={t("page.storyMaker.voiceTrack.dialogTitle")}
            size="lg"
            fullscreenOnMobile
            actions={(
                <>
                    <Button variant="text" onClick={handleClose}>
                        {t("common.action.close")}
                    </Button>
                    {canSubmitCandidate && (
                        <Button
                            variant="filled"
                            icon={mdRecordVoiceOver}
                            onClick={handleApplyEvaluated}
                        >
                            {t(candidateZeroMatch
                                ? "page.storyMaker.voiceTrack.applyAnywayButton"
                                : "page.storyMaker.voiceTrack.applyButton")}
                        </Button>
                    )}
                </>
            )}
        >
            <div className="min-w-0 space-y-4">
                {uploadTab && (
                    <Tabs
                        items={[
                            { value: "upload", label: uploadTab.label },
                            { value: "import", label: t("page.storyMaker.voiceTrack.tabImport") },
                        ]}
                        value={effectiveTab}
                        onValueChange={setActiveTab}
                        variant="secondary"
                    />
                )}

                {effectiveTab === "upload" && uploadTab ? (
                    uploadTab.render({
                        closeDialog: handleClose,
                        applyManifest: onApplyManifest,
                        applyManifestUrl: handleAutoMountPublishedManifest,
                        currentManifest,
                        notify: (msg) => onNotify?.(msg),
                    })
                ) : (
                    <>
                        <p className="type-body-s text-on-surface-variant">
                            {t("page.storyMaker.voiceTrack.dialogSubtitle")}
                        </p>

                        {/* Current mounted voice track card (external manifest tab & standalone player; host uploadTab owns its integrated controls) */}
                        {currentManifest && currentMatch && (
                            <Surface tone="low" radius="lg" className="min-w-0 space-y-2.5 border border-outline-variant/60 p-3.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <Icon path={mdCheckCircle} size={18} className="shrink-0 text-primary" />
                                        <span className="type-title-s text-on-surface">
                                            {t("page.storyMaker.voiceTrack.currentTitle")}
                                        </span>
                                        {currentManifest.locale && (
                                            <span className="rounded-md3-full bg-secondary-container px-2 py-0.5 type-label-s text-on-secondary-container">
                                                {UI_LOCALE_LABELS[currentManifest.locale]}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        size="xs"
                                        variant="outlined"
                                        icon={mdDelete}
                                        onClick={handleClearCurrent}
                                    >
                                        {t("page.storyMaker.voiceTrack.clearAction")}
                                    </Button>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-body-s text-on-surface">
                                    <span>
                                        {t("page.storyMaker.voiceTrack.matchedSummary", {
                                            matched: currentMatch.matchedCount,
                                            total: currentMatch.totalTalkBeats,
                                            lines: currentMatch.totalManifestLines,
                                        })}
                                    </span>
                                    {(currentManifest.title || currentManifest.storyId) && (
                                        <span className="font-mono type-label-m text-on-surface-variant">
                                            · {currentManifest.title || currentManifest.storyId}
                                        </span>
                                    )}
                                </div>
                                <div className="rounded-md3-md border border-outline-variant/50 bg-surface-container px-3 py-2">
                                    <Switch
                                        checked={Boolean(currentManifest.overrideOfficialVoice)}
                                        onCheckedChange={(checked) => {
                                            onApplyManifest({
                                                ...currentManifest,
                                                overrideOfficialVoice: checked,
                                            });
                                        }}
                                        label={
                                            <span className="type-label-l text-on-surface">
                                                {t("page.storyMaker.voiceTrack.overrideOfficialLabel")}
                                            </span>
                                        }
                                        description={
                                            <span className="type-body-s text-on-surface-variant">
                                                {t("page.storyMaker.voiceTrack.overrideOfficialHint")}
                                            </span>
                                        }
                                    />
                                </div>
                                {currentMatch.matchedCount === 0 && (
                                    <Banner tone="warning">
                                        {t("page.storyMaker.voiceTrack.zeroMatchWarning", {
                                            total: currentMatch.totalTalkBeats,
                                        })}
                                    </Banner>
                                )}
                            </Surface>
                        )}

                        {/* Dialogue cue sheet export bar for manual manifest & external TTS workflows */}
                        <VoiceCueSheetExportBar doc={doc} onNotify={onNotify} />

                        {/* Section 1: Fetch online manifest.json URL */}
                        <div className="min-w-0 space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                                <TextField
                                    variant="outlined"
                                    label={t("page.storyMaker.voiceTrack.urlLabel")}
                                    placeholder={t("page.storyMaker.voiceTrack.urlPlaceholder")}
                                    icon={mdLink}
                                    value={urlInput}
                                    onValueChange={(next) => {
                                        setUrlInput(next);
                                        setFetchError(null);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" && !fetching && urlInput.trim()) {
                                            event.preventDefault();
                                            void handleFetchUrl();
                                        }
                                    }}
                                    clearable
                                    containerClassName="min-w-0 flex-1"
                                />
                                <Button
                                    variant="filled"
                                    disabled={fetching || !urlInput.trim()}
                                    onClick={() => void handleFetchUrl()}
                                    className="shrink-0 sm:mt-1.5"
                                >
                                    {fetching && <LoadingIndicator size={18} contained />}
                                    <span>
                                        {t(fetching
                                            ? "page.storyMaker.voiceTrack.fetching"
                                            : "page.storyMaker.voiceTrack.fetchButton")}
                                    </span>
                                </Button>
                            </div>
                            {fetchError && <Banner tone="error">{fetchError}</Banner>}
                        </div>

                        <Divider />

                        {/* Section 2: Local file upload + paste raw JSON */}
                        <div className="min-w-0 space-y-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".json,application/json"
                                className="hidden"
                                onChange={(event) => {
                                    void loadFiles(event.target.files);
                                    event.target.value = "";
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={event => event.preventDefault()}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    void loadFiles(event.dataTransfer.files);
                                }}
                                className="state-layer focus-ring flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md3-lg border-2 border-dashed border-outline-variant bg-surface-container px-4 py-5 text-center"
                            >
                                <Icon path={mdUploadFile} size={26} className="text-primary" />
                                <span className="type-title-s text-on-surface">
                                    {t("page.storyMaker.voiceTrack.fileDropLabel")}
                                </span>
                            </button>

                            <div className="space-y-1">
                                <label htmlFor="story-voice-manifest-json" className="block type-label-l text-on-surface-variant">
                                    {t("page.storyMaker.voiceTrack.pasteLabel")}
                                </label>
                                <textarea
                                    id="story-voice-manifest-json"
                                    rows={5}
                                    value={text}
                                    placeholder={t("page.storyMaker.voiceTrack.pastePlaceholder")}
                                    onChange={event => evaluate(event.target.value)}
                                    className="w-full rounded-md3-xs border border-outline bg-transparent px-3.5 py-2.5 font-mono type-body-s text-on-surface placeholder:text-on-surface-variant focus:border-2 focus:border-primary focus:outline-none"
                                />
                            </div>
                        </div>

                        {fileError && <Banner tone="error">{fileError}</Banner>}

                        {/* Audio file drop rescue: user dropped .mp3 / .ogg / .wav etc. into manifest.json tab */}
                        {evaluation?.kind === "audioFile" && (
                            <Banner
                                tone="warning"
                                action={uploadTab ? (
                                    <Button
                                        size="xs"
                                        variant="filled"
                                        icon={mdRecordVoiceOver}
                                        onClick={() => {
                                            resetDraftState();
                                            setActiveTab("upload");
                                        }}
                                    >
                                        {t("page.storyMaker.voiceTrack.switchToUploadTab")}
                                    </Button>
                                ) : undefined}
                            >
                                {evaluation.count > 1
                                    ? t("page.storyMaker.voiceTrack.wrongFormatAudioMulti", {
                                        fileName: evaluation.fileName,
                                        count: evaluation.count,
                                    })
                                    : t("page.storyMaker.voiceTrack.wrongFormatAudioSingle", {
                                        fileName: evaluation.fileName,
                                    })}
                            </Banner>
                        )}

                        {/* Cross-format rescue: user dropped .story.json */}
                        {evaluation?.kind === "story" && (
                            <Banner
                                tone="warning"
                                action={evaluation.storyDoc && onSwitchToStoryImport ? (
                                    <Button
                                        size="xs"
                                        variant="filled"
                                        onClick={() => {
                                            const rescuedDoc = evaluation.storyDoc;
                                            if (!rescuedDoc) return;
                                            resetDraftState();
                                            onClose();
                                            onSwitchToStoryImport(rescuedDoc);
                                        }}
                                    >
                                        {t("page.storyMaker.voiceTrack.importStoryInstead")}
                                    </Button>
                                ) : undefined}
                            >
                                {t("page.storyMaker.voiceTrack.wrongFormatStory")}
                            </Banner>
                        )}

                        {/* Cross-format rescue: user dropped .i18n.json */}
                        {evaluation?.kind === "localePack" && (
                            <Banner
                                tone="warning"
                                action={evaluation.localePack && onApplyLocalePack ? (
                                    <Button
                                        size="xs"
                                        variant="filled"
                                        icon={mdTranslate}
                                        onClick={() => {
                                            const pack = evaluation.localePack;
                                            if (!pack) return;
                                            onApplyLocalePack(pack);
                                            onNotify?.(t("page.storyMaker.i18n.loadedLocalePackToast", {
                                                locale: UI_LOCALE_LABELS[pack.locale],
                                            }));
                                            resetDraftState();
                                            onClose();
                                        }}
                                    >
                                        {t("page.storyMaker.voiceTrack.applyLocaleInstead")}
                                    </Button>
                                ) : undefined}
                            >
                                {t("page.storyMaker.voiceTrack.wrongFormatLocale")}
                            </Banner>
                        )}

                        {/* Invalid JSON / wrong schema */}
                        {evaluation?.kind === "invalid" && (
                            <Banner tone="error">
                                {t("page.storyMaker.voiceTrack.invalidToast")}
                            </Banner>
                        )}

                        {/* Valid manifest preview */}
                        {evaluation?.kind === "manifest" && (
                            <Surface tone="default" radius="md" className="min-w-0 space-y-2.5 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-primary">
                                        <Icon path={mdCheckCircle} size={20} />
                                        <span className="font-mono type-title-s">{evaluation.manifest.storyId}</span>
                                    </div>
                                    {evaluation.manifest.locale && (
                                        <span className="rounded-md3-full bg-secondary-container px-2.5 py-0.5 type-label-s text-on-secondary-container">
                                            {UI_LOCALE_LABELS[evaluation.manifest.locale]}
                                        </span>
                                    )}
                                </div>
                                {evaluation.manifest.title && (
                                    <p className="type-label-l text-on-surface">{evaluation.manifest.title}</p>
                                )}
                                <p className="type-body-s text-on-surface">
                                    {t("page.storyMaker.voiceTrack.matchedSummary", {
                                        matched: evaluation.match.matchedCount,
                                        total: evaluation.match.totalTalkBeats,
                                        lines: evaluation.match.totalManifestLines,
                                    })}
                                </p>
                                <div className="rounded-md3-md border border-outline-variant/50 bg-surface-container px-3 py-2">
                                    <Switch
                                        checked={candidateOverrideOfficial}
                                        onCheckedChange={setCandidateOverrideOfficial}
                                        label={
                                            <span className="type-label-l text-on-surface">
                                                {t("page.storyMaker.voiceTrack.overrideOfficialLabel")}
                                            </span>
                                        }
                                        description={
                                            <span className="type-body-s text-on-surface-variant">
                                                {t("page.storyMaker.voiceTrack.overrideOfficialHint")}
                                            </span>
                                        }
                                    />
                                </div>
                                {evaluation.match.matchedCount === 0 && (
                                    <Banner tone="warning">
                                        {t("page.storyMaker.voiceTrack.zeroMatchWarning", {
                                            total: evaluation.match.totalTalkBeats,
                                        })}
                                    </Banner>
                                )}
                            </Surface>
                        )}
                    </>
                )}
            </div>
        </Dialog>
    );
}
