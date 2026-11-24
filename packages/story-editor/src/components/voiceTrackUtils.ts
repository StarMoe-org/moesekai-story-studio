import {
    isSupportedAudioFilename,
    resolveVoiceManifestLineUrl,
    storyVoiceCandidateUrls,
    type AssetLine,
    type ResolveVoiceManifestUrlOptions,
    type StoryDocument,
    type StoryVoiceManifest,
    type StoryVoiceRef,
} from "@moesekai/story-core";

export type VoiceManifestDialogTab = "import" | "upload";

export interface PickedFileLike {
    name: string;
    type?: string;
}

export interface AudioFileDropDetection {
    kind: "audioFile";
    fileName: string;
    count: number;
}

export interface ResolvedTalkBeatVoice {
    source: "official" | "manifest";
    urls: string[];
    label: string;
    start?: number;
    end?: number;
}

export type MidSceneManifestVoiceAction =
    | { action: "play"; urls: string[]; label: string }
    | { action: "stop" }
    | { action: "noop" };

/** Builds `ResolveVoiceManifestUrlOptions` from the provider's optional `voiceWorkspaceBaseUrl`. */
export function buildVoiceManifestUrlOptions(
    voiceWorkspaceBaseUrl?: string | null,
): ResolveVoiceManifestUrlOptions {
    return {
        localWorkspaceBaseUrl: voiceWorkspaceBaseUrl || undefined,
        allowBlobUrls: true,
    };
}

/**
 * Resolves which tab `StoryVoiceManifestDialog` should open on.
 * When a host `uploadTab` is available, defaults to `"upload"` unless `"import"` was explicitly requested.
 * When `uploadTab` is absent, always falls back to `"import"`.
 */
export function resolveVoiceManifestDialogTab(
    hasUploadTab: boolean,
    requestedTab?: VoiceManifestDialogTab,
): VoiceManifestDialogTab {
    if (!hasUploadTab) return "import";
    return requestedTab ?? "upload";
}

/**
 * Detects whether dropped/picked file(s) in the external manifest import tab are actually audio files,
 * so creators receive a helpful redirect banner instead of a cryptic JSON parse error.
 */
export function detectAudioFilesForManifestDrop(
    files: readonly PickedFileLike[] | ArrayLike<PickedFileLike> | null | undefined,
): AudioFileDropDetection | null {
    if (!files || files.length === 0) return null;
    const list = Array.from(files);
    const audioFiles = list.filter((file) =>
        isSupportedAudioFilename(file.name)
        || (typeof file.type === "string" && file.type.toLowerCase().startsWith("audio/")),
    );
    if (audioFiles.length === 0) return null;
    return {
        kind: "audioFile",
        fileName: audioFiles[0].name,
        count: audioFiles.length,
    };
}

/**
 * Resolves the effective voice audio playback candidates for a `talk` beat:
 * - When `voiceManifest?.overrideOfficialVoice` is true and the manifest resolves playable URL(s)
 *   for `beat.id`, custom voice takes priority over official `beat.voice` (without official trim offsets).
 * - Otherwise preserves default priority: official `beat.voice` first, manifest fallback when unvoiced.
 */
export function resolveTalkBeatVoicePlayback(params: {
    beat: { id: string; voice?: StoryVoiceRef };
    region: StoryDocument["region"];
    line: AssetLine;
    voiceManifest: StoryVoiceManifest | null | undefined;
    urlOptions?: ResolveVoiceManifestUrlOptions;
}): ResolvedTalkBeatVoice | null {
    const { beat, region, line, voiceManifest, urlOptions } = params;
    const hasOfficial = Boolean(beat.voice && beat.voice.scenarioId && beat.voice.voiceId);
    const manifestUrls = voiceManifest
        ? resolveVoiceManifestLineUrl(voiceManifest, beat.id, urlOptions)
        : [];
    const manifestLine = voiceManifest?.lines[beat.id];

    if (voiceManifest?.overrideOfficialVoice && manifestUrls.length > 0) {
        return {
            source: "manifest",
            urls: manifestUrls,
            label: manifestLine?.speaker || beat.id,
        };
    }

    if (hasOfficial && beat.voice) {
        const officialUrls = storyVoiceCandidateUrls(beat.voice, region, line);
        return officialUrls.length > 0
            ? {
                source: "official",
                urls: officialUrls,
                label: beat.voice.voiceId,
                start: beat.voice.start,
                end: beat.voice.end,
            }
            : null;
    }

    if (manifestUrls.length > 0) {
        return {
            source: "manifest",
            urls: manifestUrls,
            label: manifestLine?.speaker || beat.id,
        };
    }

    return null;
}

/**
 * Computes how an active talk beat should react when `voiceManifest` is mounted, updated,
 * cleared, or has `overrideOfficialVoice` toggled mid-scene.
 */
export function resolveMidSceneManifestVoiceAction(params: {
    beat: { id: string; voice?: StoryVoiceRef };
    previousManifest: StoryVoiceManifest | null;
    nextManifest: StoryVoiceManifest | null;
    urlOptions?: ResolveVoiceManifestUrlOptions;
}): MidSceneManifestVoiceAction {
    const { beat, previousManifest, nextManifest, urlOptions } = params;
    if (!nextManifest) {
        return previousManifest ? { action: "stop" } : { action: "noop" };
    }

    const hasOfficial = Boolean(beat.voice && beat.voice.scenarioId && beat.voice.voiceId);
    const prevUrls = previousManifest
        ? resolveVoiceManifestLineUrl(previousManifest, beat.id, urlOptions)
        : [];
    const nextUrls = resolveVoiceManifestLineUrl(nextManifest, beat.id, urlOptions);

    const prevUsedManifest = Boolean(
        previousManifest
        && prevUrls.length > 0
        && (!hasOfficial || previousManifest.overrideOfficialVoice),
    );
    const nextUsesManifest = Boolean(
        nextUrls.length > 0
        && (!hasOfficial || nextManifest.overrideOfficialVoice),
    );

    if (nextUsesManifest) {
        const urlsChanged = prevUrls.join("\0") !== nextUrls.join("\0");
        if (!prevUsedManifest || urlsChanged) {
            const manifestLine = nextManifest.lines[beat.id];
            return {
                action: "play",
                urls: nextUrls,
                label: manifestLine?.speaker || beat.id,
            };
        }
        return { action: "noop" };
    }

    if (prevUsedManifest) {
        return { action: "stop" };
    }

    return { action: "noop" };
}
