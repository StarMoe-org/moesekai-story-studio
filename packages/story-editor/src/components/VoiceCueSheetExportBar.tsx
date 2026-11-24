"use client";
import { useMemo } from "react";
import {
    buildVoiceCueSheetCsv,
    buildVoiceCueSheetJson,
    buildVoiceCueSheetText,
    extractTalkBeatsForVoice,
    type StoryDocument,
    type UiLocale,
} from "@moesekai/story-core";
import { useStoryI18n as useI18n } from "../context/StoryStudioContext";
import { Button, Icon, Surface, cn } from "../md3";
import { mdDescription, mdDownload } from "../md3/icons";

export interface VoiceCueSheetExportBarProps {
    doc: StoryDocument;
    /** Optional locale overlay applied to dialogue lines before exporting. */
    locale?: UiLocale;
    /** When true, only export talk beats without an official voice reference. */
    onlyMissingOfficialVoice?: boolean;
    /** Optional callback for toast notifications after downloading a cue sheet. */
    onNotify?: (message: string) => void;
    className?: string;
}

type CueSheetFormat = "csv" | "txt" | "json";

function sanitizeFileStem(rawId: string | undefined): string {
    const cleaned = (rawId ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "");
    return cleaned || "story";
}

function triggerTextDownload(content: string, fileName: string, mimeType: string): void {
    if (typeof document === "undefined" || typeof URL === "undefined") return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Compact MD3 Expressive bar allowing 1-click download of `.csv`, `.txt`, or `.json`
 * dialogue cue sheets for voice recording, external TTS batch generation, and `<beatId>` file matching.
 */
export function VoiceCueSheetExportBar({
    doc,
    locale,
    onlyMissingOfficialVoice = false,
    onNotify,
    className,
}: VoiceCueSheetExportBarProps) {
    const { t } = useI18n();

    const talkBeatCount = useMemo(() => {
        const slots = extractTalkBeatsForVoice(doc);
        return onlyMissingOfficialVoice
            ? slots.filter(slot => !slot.hasOfficialVoice).length
            : slots.length;
    }, [doc, onlyMissingOfficialVoice]);

    const handleExport = (format: CueSheetFormat) => {
        const stem = sanitizeFileStem(doc.id);
        const options = {
            ...(locale ? { locale } : {}),
            ...(onlyMissingOfficialVoice ? { onlyMissingOfficialVoice: true } : {}),
        };

        if (format === "csv") {
            triggerTextDownload(
                buildVoiceCueSheetCsv(doc, options),
                `${stem}.voice-cues.csv`,
                "text/csv;charset=utf-8",
            );
        } else if (format === "txt") {
            triggerTextDownload(
                buildVoiceCueSheetText(doc, options),
                `${stem}.voice-cues.txt`,
                "text/plain;charset=utf-8",
            );
        } else {
            triggerTextDownload(
                buildVoiceCueSheetJson(doc, options),
                `${stem}.voice-cues.json`,
                "application/json;charset=utf-8",
            );
        }

        onNotify?.(
            t("page.storyMaker.voiceTrack.cueSheetExportedToast", {
                format: format.toUpperCase(),
            }),
        );
    };

    return (
        <Surface
            tone="low"
            radius="md"
            className={cn(
                "min-w-0 space-y-2 border border-outline-variant/60 px-3.5 py-3",
                className,
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Icon path={mdDescription} size={17} className="shrink-0 text-primary" />
                    <span className="type-title-s text-on-surface">
                        {t("page.storyMaker.voiceTrack.cueSheetTitle")}
                    </span>
                    <span className="rounded-md3-full bg-secondary-container px-2 py-0.5 type-label-s text-on-secondary-container">
                        {t("page.storyMaker.voiceTrack.cueSheetCount", { count: talkBeatCount })}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {(["csv", "txt", "json"] as const).map((format) => (
                        <Button
                            key={format}
                            size="xs"
                            variant="outlined"
                            icon={mdDownload}
                            disabled={talkBeatCount === 0}
                            onClick={() => handleExport(format)}
                        >
                            {format.toUpperCase()}
                        </Button>
                    ))}
                </div>
            </div>
            <p className="type-body-s text-on-surface-variant">
                {t("page.storyMaker.voiceTrack.cueSheetNamingTip")}
            </p>
        </Surface>
    );
}
