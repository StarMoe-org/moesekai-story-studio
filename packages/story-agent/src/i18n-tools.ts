import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import {
    PJSK_CHARACTER_SPEECH_HINTS,
    STORY_VOICE_MANIFEST_SCHEMA_VERSION,
    applyStoryLocaleOverlay,
    buildAiTranslationPrompt,
    buildTranslationChunks,
    detectOutdatedBeats,
    extractTalkBeatsForVoice,
    extractTemplatePlaceholders,
    inferStorySourceLocale,
    isSupportedAudioFilename,
    isUiLocale,
    matchAudioFilesToTalkBeats,
    matchVoiceManifestToDoc,
    parseAndValidateLocalePack,
    parseStoryScript,
    parseStoryVoiceManifest,
    type LocalePackValidationResult,
    type StoryDocument,
    type StoryImportableTranslationOrigin,
    type StoryLocalePack,
    type StoryVoiceManifest,
    type StoryVoiceManifestLine,
    type UiLocale,
    type VoiceManifestMatchSummary,
} from "@moesekai/story-core";
import type { StoryTtsCandidateLine } from "./types";
import {
    DEFAULT_STORY_FILE,
    normalizeLineEndings,
    readLocalePackFromDisk,
    readVoiceManifestFromDisk,
    resolveSafeWorkspacePath,
    writeLocalePackToDisk,
    writeVoiceManifestToDisk,
} from "./workspace";

// ==================== Cue-Sheet / Voice Candidate Extraction ====================

const MAIN_MODEL_CHAR_RE = /^(?:v2_)?(?:clb\d+_)?(0[1-9]|1\d|2[0-6])[a-z]+/;

function inferCharacterId(characterId?: number, modelId?: string): number | undefined {
    if (characterId && characterId >= 1 && characterId <= 26) return characterId;
    if (!modelId) return undefined;
    const match = MAIN_MODEL_CHAR_RE.exec(modelId.trim());
    return match ? Number(match[1]) : undefined;
}

function cleanLineForVoiceCue(text: string): string {
    return text
        .replace(/\{\{\s*[^}]+\s*\}\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export interface ExtractVoiceCandidatesOptions {
    locale?: UiLocale;
    localePack?: StoryLocalePack | null;
    onlyMissingOfficialVoice?: boolean;
    existingManifest?: StoryVoiceManifest | null;
}

/**
 * Extracts ordered dialogue lines suitable for user voice recording / custom audio cue sheets.
 * When `locale` differs from the master script locale and a `StoryLocalePack` is attached or passed,
 * overlays the localized text without mutating the source document.
 */
export function extractTtsCandidateLines(
    doc: StoryDocument,
    options: ExtractVoiceCandidatesOptions = {},
): StoryTtsCandidateLine[] {
    const sourceLocale = inferStorySourceLocale(doc);
    const targetLocale = options.locale ?? sourceLocale;
    let workingDoc = doc;

    if (targetLocale !== sourceLocale) {
        if (options.localePack && options.localePack.locale === targetLocale) {
            workingDoc = applyStoryLocaleOverlay(
                {
                    ...doc,
                    locales: { ...(doc.locales ?? {}), [targetLocale]: options.localePack },
                },
                targetLocale,
            );
        } else if (doc.locales?.[targetLocale]) {
            workingDoc = applyStoryLocaleOverlay(doc, targetLocale);
        }
    }

    const castByKey = new Map(workingDoc.cast.map((c) => [c.key, c]));
    const beatSpeakerKey = new Map<string, string | undefined>();
    for (const node of Object.values(workingDoc.nodes)) {
        if (node.type !== "scene") continue;
        for (const beat of node.beats) {
            if (beat.kind === "talk") {
                beatSpeakerKey.set(beat.id, beat.speakerKey);
            }
        }
    }

    const talkBeats = extractTalkBeatsForVoice(workingDoc);
    const results: StoryTtsCandidateLine[] = [];

    for (const slot of talkBeats) {
        if (options.onlyMissingOfficialVoice && slot.hasOfficialVoice) continue;
        const speakerKey = beatSpeakerKey.get(slot.beatId);
        const castMember = speakerKey ? castByKey.get(speakerKey) : undefined;
        const characterId = inferCharacterId(castMember?.characterId, castMember?.modelId);
        const hint = characterId ? PJSK_CHARACTER_SPEECH_HINTS[characterId] : undefined;
        const hasCustomVoice = Boolean(
            options.existingManifest && Object.prototype.hasOwnProperty.call(options.existingManifest.lines, slot.beatId),
        );

        results.push({
            beatId: slot.beatId,
            nodeId: slot.nodeId,
            sceneTitle: slot.sceneTitle,
            ...(speakerKey ? { speakerKey } : {}),
            speakerName: slot.speakerName,
            ...(characterId !== undefined ? { characterId } : {}),
            locale: targetLocale,
            text: slot.textPreview,
            cleanTtsText: cleanLineForVoiceCue(slot.textPreview),
            placeholders: extractTemplatePlaceholders(slot.textPreview),
            hasOfficialVoice: slot.hasOfficialVoice,
            hasCustomVoice,
            recommendedFilename: `${slot.beatId}.ogg`,
            ...(hint
                ? {
                    speechHint: {
                        jpName: hint.jpName,
                        firstPerson: hint.firstPerson,
                        toneJa: hint.toneJa,
                        toneEn: hint.toneEn,
                    },
                }
                : {}),
        });
    }

    return results;
}

// ==================== Workspace Translation Helpers ====================

async function loadParsedStoryDoc(workspaceDir: string, storyFile: string): Promise<StoryDocument> {
    const abs = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let raw: string;
    try {
        raw = normalizeLineEndings(await readFile(abs, "utf8"));
    } catch {
        throw new Error(`Story file "${storyFile}" not found in workspace.`);
    }
    const parsed = parseStoryScript(raw);
    if (!parsed.ok) {
        const first = parsed.diagnostics[0];
        throw new Error(
            `Cannot process i18n/voice: "${storyFile}" has syntax errors (e.g. line ${first?.line ?? "?"}: ${first?.message ?? "parse failed"}). Fix syntax first.`,
        );
    }
    return parsed.doc;
}

export interface PrepareTranslationResult {
    storyId: string;
    sourceLocale: UiLocale;
    targetLocale: UiLocale;
    totalChunks: number;
    chunkIndex: number;
    chunkBeatCount: number;
    sceneIds: string[];
    beatIds: string[];
    existingCoverage: {
        hasExistingPack: boolean;
        translatedCount: number;
        outdatedCount: number;
        missingCount: number;
        totalCount: number;
        outdatedBeatIds: string[];
        missingBeatIds: string[];
    };
    prompt: string;
    payload: unknown;
}

export async function prepareStoryTranslation(
    workspaceDir: string,
    storyFile = DEFAULT_STORY_FILE,
    options: {
        targetLocale: UiLocale;
        chunkIndex?: number;
        maxBeatsPerChunk?: number;
        onlyOutdated?: boolean;
    },
): Promise<PrepareTranslationResult> {
    if (!isUiLocale(options.targetLocale)) {
        throw new Error(`Unsupported targetLocale "${String(options.targetLocale)}".`);
    }
    const doc = await loadParsedStoryDoc(workspaceDir, storyFile);
    const sourceLocale = inferStorySourceLocale(doc);
    if (options.targetLocale === sourceLocale) {
        throw new Error(
            `targetLocale "${options.targetLocale}" matches the story's sourceLocale "${sourceLocale}". Choose a different target locale.`,
        );
    }

    const existingPack = await readLocalePackFromDisk(workspaceDir, options.targetLocale);
    const outdated = detectOutdatedBeats(doc, existingPack);

    let onlyBeatIds: string[] | undefined;
    if (options.onlyOutdated && existingPack) {
        const combined = [...outdated.outdatedBeatIds, ...outdated.missingBeatIds];
        if (combined.length > 0) onlyBeatIds = combined;
    }

    const chunks = buildTranslationChunks(doc, options.targetLocale, {
        maxBeatsPerChunk: options.maxBeatsPerChunk,
        onlyBeatIds,
    });
    const safeIndex = Math.max(0, Math.min(chunks.length - 1, Math.floor(options.chunkIndex ?? 0)));
    const built = buildAiTranslationPrompt(doc, options.targetLocale, safeIndex, {
        maxBeatsPerChunk: options.maxBeatsPerChunk,
        onlyBeatIds,
    });

    return {
        storyId: doc.id,
        sourceLocale,
        targetLocale: options.targetLocale,
        totalChunks: built.totalChunks,
        chunkIndex: built.chunk.index,
        chunkBeatCount: built.chunk.beatCount,
        sceneIds: built.chunk.sceneIds,
        beatIds: built.chunk.beatIds,
        existingCoverage: {
            hasExistingPack: Boolean(existingPack),
            translatedCount: outdated.translatedCount,
            outdatedCount: outdated.outdatedBeatIds.length,
            missingCount: outdated.missingBeatIds.length,
            totalCount: outdated.totalCount,
            outdatedBeatIds: outdated.outdatedBeatIds,
            missingBeatIds: outdated.missingBeatIds,
        },
        prompt: built.prompt,
        payload: built.chunk.payload,
    };
}

export interface ApplyTranslationResult {
    ok: boolean;
    filePath: string | null;
    validation: LocalePackValidationResult;
}

export async function applyStoryTranslation(
    workspaceDir: string,
    storyFile = DEFAULT_STORY_FILE,
    options: {
        targetLocale: UiLocale;
        rawJson: string;
        chunkIndex?: number;
        maxBeatsPerChunk?: number;
        originOverride?: StoryImportableTranslationOrigin;
        modelHint?: string;
        note?: string;
    },
): Promise<ApplyTranslationResult> {
    if (!isUiLocale(options.targetLocale)) {
        throw new Error(`Unsupported targetLocale "${String(options.targetLocale)}".`);
    }
    const doc = await loadParsedStoryDoc(workspaceDir, storyFile);
    const existingPack = await readLocalePackFromDisk(workspaceDir, options.targetLocale);

    const validation = parseAndValidateLocalePack(options.rawJson, doc, options.targetLocale, {
        importSource: "ai_paste",
        originOverride: options.originOverride ?? "ai_raw",
        modelHint: options.modelHint,
        note: options.note,
        chunkIndex: options.chunkIndex,
        maxBeatsPerChunk: options.maxBeatsPerChunk,
        existingPack,
    });

    if (!validation.ok || !validation.pack) {
        return { ok: false, filePath: null, validation };
    }

    const filePath = await writeLocalePackToDisk(workspaceDir, options.targetLocale, validation.pack);
    return { ok: true, filePath, validation };
}

// ==================== User Voice Audio Matching & Manifest Helpers ====================

export interface LocalAudioScanResult {
    audioDir: string;
    matched: Array<{ beatId: string; filename: string; relativePath: string }>;
    unmatched: string[];
    unsupported: string[];
}

export async function scanLocalVoiceAudioFiles(
    workspaceDir: string,
    doc: StoryDocument,
    audioDir = "voices",
): Promise<LocalAudioScanResult> {
    const absDir = resolveSafeWorkspacePath(workspaceDir, audioDir);
    let names: string[] = [];
    try {
        names = await readdir(absDir);
    } catch {
        return { audioDir, matched: [], unmatched: [], unsupported: [] };
    }

    // Ignore manifest.json itself when scanning voices/
    const candidateFiles = names
        .filter((name) => name !== "manifest.json" && !name.startsWith("."))
        .map((name) => ({ name }));

    const talkBeats = extractTalkBeatsForVoice(doc);
    const res = matchAudioFilesToTalkBeats(candidateFiles, talkBeats);

    const normalizedDir = audioDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const matched = [...res.matched.entries()].map(([beatId, f]) => ({
        beatId,
        filename: f.name,
        relativePath: normalizedDir ? `${normalizedDir}/${f.name}` : f.name,
    }));

    return {
        audioDir: normalizedDir || "voices",
        matched,
        unmatched: res.unmatched.map((f) => f.name),
        unsupported: res.unsupported.filter((f) => !f.name.endsWith(".json")).map((f) => f.name),
    };
}

export interface PrepareVoiceCueSheetResult {
    storyId: string;
    locale: UiLocale;
    totalTalkBeats: number;
    candidateLines: StoryTtsCandidateLine[];
    existingManifest: VoiceManifestMatchSummary | null;
    localAudioScan: LocalAudioScanResult;
}

export async function prepareVoiceCueSheet(
    workspaceDir: string,
    storyFile = DEFAULT_STORY_FILE,
    options: {
        targetLocale?: UiLocale;
        onlyMissingOfficialVoice?: boolean;
        audioDir?: string;
    } = {},
): Promise<PrepareVoiceCueSheetResult> {
    const doc = await loadParsedStoryDoc(workspaceDir, storyFile);
    const sourceLocale = inferStorySourceLocale(doc);
    const targetLocale = options.targetLocale && isUiLocale(options.targetLocale)
        ? options.targetLocale
        : sourceLocale;

    const localePack = targetLocale !== sourceLocale
        ? await readLocalePackFromDisk(workspaceDir, targetLocale)
        : null;
    const loadedManifest = await readVoiceManifestFromDisk(workspaceDir);
    const existingManifest = loadedManifest?.manifest ?? null;

    const candidateLines = extractTtsCandidateLines(doc, {
        locale: targetLocale,
        localePack,
        onlyMissingOfficialVoice: options.onlyMissingOfficialVoice,
        existingManifest,
    });

    const localAudioScan = await scanLocalVoiceAudioFiles(workspaceDir, doc, options.audioDir ?? "voices");
    const existingSummary = existingManifest ? matchVoiceManifestToDoc(doc, existingManifest) : null;

    return {
        storyId: doc.id,
        locale: targetLocale,
        totalTalkBeats: extractTalkBeatsForVoice(doc).length,
        candidateLines,
        existingManifest: existingSummary,
        localAudioScan,
    };
}

export interface ApplyVoiceManifestResult {
    ok: boolean;
    filePath: string | null;
    error?: string;
    manifest: StoryVoiceManifest | null;
    matchSummary: VoiceManifestMatchSummary | null;
}

export async function applyVoiceManifest(
    workspaceDir: string,
    storyFile = DEFAULT_STORY_FILE,
    options: {
        rawManifestJson?: string;
        autoMatchAudioDir?: string;
        baseUrl?: string;
        locale?: UiLocale;
        title?: string;
        overrideOfficialVoice?: boolean;
    },
): Promise<ApplyVoiceManifestResult> {
    const doc = await loadParsedStoryDoc(workspaceDir, storyFile);
    let candidateRaw: unknown;

    if (options.rawManifestJson !== undefined && options.rawManifestJson.trim()) {
        try {
            candidateRaw = JSON.parse(options.rawManifestJson);
        } catch (err) {
            return {
                ok: false,
                filePath: null,
                error: `Invalid JSON for voice manifest: ${err instanceof Error ? err.message : String(err)}`,
                manifest: null,
                matchSummary: null,
            };
        }
    } else if (options.autoMatchAudioDir !== undefined) {
        const scan = await scanLocalVoiceAudioFiles(workspaceDir, doc, options.autoMatchAudioDir || "voices");
        const talkBeats = extractTalkBeatsForVoice(doc);
        const speakerByBeat = new Map(talkBeats.map((b) => [b.beatId, b.speakerName]));
        const trimmedBaseUrl = options.baseUrl?.trim() || undefined;
        const lines: Record<string, StoryVoiceManifestLine> = {};
        for (const item of scan.matched) {
            if (!isSupportedAudioFilename(item.filename)) continue;
            const speaker = speakerByBeat.get(item.beatId);
            lines[item.beatId] = {
                url: trimmedBaseUrl ? item.filename : item.relativePath,
                ...(trimmedBaseUrl ? {} : { objectKey: item.relativePath }),
                ...(speaker ? { speaker } : {}),
                ...(options.locale ? { locale: options.locale } : {}),
            };
        }
        candidateRaw = {
            schema: STORY_VOICE_MANIFEST_SCHEMA_VERSION,
            storyId: doc.id,
            ...(options.locale ? { locale: options.locale } : {}),
            ...(options.title ? { title: options.title } : {}),
            ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
            ...(typeof options.overrideOfficialVoice === "boolean"
                ? { overrideOfficialVoice: options.overrideOfficialVoice }
                : {}),
            generatedAt: new Date().toISOString(),
            lines,
        };
    } else {
        return {
            ok: false,
            filePath: null,
            error: "Provide either rawManifestJson or autoMatchAudioDir to create/update voices/manifest.json.",
            manifest: null,
            matchSummary: null,
        };
    }

    const validated = parseStoryVoiceManifest(candidateRaw, { allowLocalWorkspaceUrls: true });
    if (!validated) {
        return {
            ok: false,
            filePath: null,
            error: "Voice manifest failed validation (requires schema='moesekai-story-voice/1', non-empty storyId, and safe https://, /..., or workspace-relative voices/... audio URLs).",
            manifest: null,
            matchSummary: null,
        };
    }

    const filePath = await writeVoiceManifestToDisk(workspaceDir, validated);
    const matchSummary = matchVoiceManifestToDoc(doc, validated);
    return {
        ok: true,
        filePath,
        manifest: validated,
        matchSummary,
    };
}
