import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryVoiceManifest, StoryVoiceRef } from "@moesekai/story-core";
import {
    buildVoiceManifestUrlOptions,
    detectAudioFilesForManifestDrop,
    resolveMidSceneManifestVoiceAction,
    resolveTalkBeatVoicePlayback,
    resolveVoiceManifestDialogTab,
} from "../src/components/voiceTrackUtils";
import { STORY_MAKER_MESSAGES_BY_LOCALE, type StoryStudioLocale } from "../src/messages";

const ALL_LOCALES: StoryStudioLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
const EDITOR_SRC = join(import.meta.dir, "..", "src");

const OFFICIAL_VOICE: StoryVoiceRef = {
    kind: "event",
    region: "jp",
    scenarioId: "event_01_01",
    voiceId: "voice_001",
    start: 1.25,
    end: 4.5,
};

function makeManifest(overrides?: Partial<StoryVoiceManifest>): StoryVoiceManifest {
    return {
        schema: "moesekai-story-voice/1",
        storyId: "story-demo",
        locale: "zh-CN",
        lines: {
            b1: { url: "https://cdn.example.com/voices/b1.ogg", speaker: "Ichika" },
            b2: { url: "https://cdn.example.com/voices/b2.ogg", speaker: "Saki" },
        },
        ...overrides,
    };
}

describe("voice track UX helpers", () => {
    test("resolveVoiceManifestDialogTab defaults to upload when uploadTab exists, else import", () => {
        expect(resolveVoiceManifestDialogTab(true)).toBe("upload");
        expect(resolveVoiceManifestDialogTab(true, undefined)).toBe("upload");
        expect(resolveVoiceManifestDialogTab(true, "upload")).toBe("upload");
        expect(resolveVoiceManifestDialogTab(true, "import")).toBe("import");

        expect(resolveVoiceManifestDialogTab(false)).toBe("import");
        expect(resolveVoiceManifestDialogTab(false, undefined)).toBe("import");
        expect(resolveVoiceManifestDialogTab(false, "upload")).toBe("import");
        expect(resolveVoiceManifestDialogTab(false, "import")).toBe("import");
    });

    test("detectAudioFilesForManifestDrop rescues dropped/picked audio files without flagging JSON", () => {
        expect(detectAudioFilesForManifestDrop(null)).toBeNull();
        expect(detectAudioFilesForManifestDrop([])).toBeNull();
        expect(detectAudioFilesForManifestDrop([{ name: "manifest.json", type: "application/json" }])).toBeNull();
        expect(detectAudioFilesForManifestDrop([{ name: "story.msk", type: "text/plain" }])).toBeNull();

        expect(detectAudioFilesForManifestDrop([{ name: "b1.mp3", type: "audio/mpeg" }])).toEqual({
            kind: "audioFile",
            fileName: "b1.mp3",
            count: 1,
        });

        expect(detectAudioFilesForManifestDrop([{ name: "B2.WAV", type: "" }])).toEqual({
            kind: "audioFile",
            fileName: "B2.WAV",
            count: 1,
        });

        expect(detectAudioFilesForManifestDrop([{ name: "clip.unknown", type: "audio/ogg" }])).toEqual({
            kind: "audioFile",
            fileName: "clip.unknown",
            count: 1,
        });

        expect(
            detectAudioFilesForManifestDrop([
                { name: "notes.txt", type: "text/plain" },
                { name: "b1.ogg", type: "audio/ogg" },
                { name: "b2.flac", type: "audio/flac" },
            ]),
        ).toEqual({
            kind: "audioFile",
            fileName: "b1.ogg",
            count: 2,
        });
    });

    test("buildVoiceManifestUrlOptions configures allowBlobUrls and optional localWorkspaceBaseUrl", () => {
        expect(buildVoiceManifestUrlOptions(null)).toEqual({
            localWorkspaceBaseUrl: undefined,
            allowBlobUrls: true,
        });
        expect(buildVoiceManifestUrlOptions("")).toEqual({
            localWorkspaceBaseUrl: undefined,
            allowBlobUrls: true,
        });
        expect(buildVoiceManifestUrlOptions("moesekai-app://app/workspace/")).toEqual({
            localWorkspaceBaseUrl: "moesekai-app://app/workspace/",
            allowBlobUrls: true,
        });
    });

    test("resolveTalkBeatVoicePlayback honors overrideOfficialVoice priority vs fallback-only default", () => {
        const urlOptions = buildVoiceManifestUrlOptions(null);

        // 1. Official voice with no manifest -> official voice with trim
        const officialOnly = resolveTalkBeatVoicePlayback({
            beat: { id: "b1", voice: OFFICIAL_VOICE },
            region: "jp",
            line: "main",
            voiceManifest: null,
            urlOptions,
        });
        expect(officialOnly?.source).toBe("official");
        expect(officialOnly?.label).toBe("voice_001");
        expect(officialOnly?.start).toBe(1.25);
        expect(officialOnly?.end).toBe(4.5);
        expect(officialOnly?.urls.length).toBeGreaterThan(0);

        // 2. Official voice + manifest WITHOUT overrideOfficialVoice -> official wins
        const fallbackManifest = makeManifest({ overrideOfficialVoice: false });
        const officialWins = resolveTalkBeatVoicePlayback({
            beat: { id: "b1", voice: OFFICIAL_VOICE },
            region: "jp",
            line: "main",
            voiceManifest: fallbackManifest,
            urlOptions,
        });
        expect(officialWins?.source).toBe("official");
        expect(officialWins?.start).toBe(1.25);

        // 3. Unvoiced beat + manifest -> custom manifest plays
        const unvoicedFallback = resolveTalkBeatVoicePlayback({
            beat: { id: "b1" },
            region: "jp",
            line: "main",
            voiceManifest: fallbackManifest,
            urlOptions,
        });
        expect(unvoicedFallback).toEqual({
            source: "manifest",
            urls: ["https://cdn.example.com/voices/b1.ogg"],
            label: "Ichika",
        });

        // 4. Official voice + manifest WITH overrideOfficialVoice: true -> custom voice overrides official without official trim
        const overrideManifest = makeManifest({ overrideOfficialVoice: true });
        const customOverrides = resolveTalkBeatVoicePlayback({
            beat: { id: "b1", voice: OFFICIAL_VOICE },
            region: "jp",
            line: "main",
            voiceManifest: overrideManifest,
            urlOptions,
        });
        expect(customOverrides).toEqual({
            source: "manifest",
            urls: ["https://cdn.example.com/voices/b1.ogg"],
            label: "Ichika",
        });
        expect(customOverrides?.start).toBeUndefined();
        expect(customOverrides?.end).toBeUndefined();

        // 5. Official voice + overrideOfficialVoice: true when beat has NO custom clip -> falls back to official voice
        const unmatchedOfficial = resolveTalkBeatVoicePlayback({
            beat: { id: "b999", voice: OFFICIAL_VOICE },
            region: "jp",
            line: "main",
            voiceManifest: overrideManifest,
            urlOptions,
        });
        expect(unmatchedOfficial?.source).toBe("official");
        expect(unmatchedOfficial?.label).toBe("voice_001");

        // 6. Unvoiced beat with no matching custom line -> null
        expect(
            resolveTalkBeatVoicePlayback({
                beat: { id: "b999" },
                region: "jp",
                line: "main",
                voiceManifest: overrideManifest,
                urlOptions,
            }),
        ).toBeNull();

        // 7. Blob URLs & Desktop local workspace paths resolve cleanly through buildVoiceManifestUrlOptions
        const localAndBlobManifest = makeManifest({
            overrideOfficialVoice: true,
            lines: {
                b1: { url: "blob:https://moesekai.example/clip-1", speaker: "Ichika" },
                b2: { url: "voices/b2.ogg", speaker: "Saki" },
            },
        });
        const desktopUrlOptions = buildVoiceManifestUrlOptions("moesekai-app://app/workspace/");
        expect(
            resolveTalkBeatVoicePlayback({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                region: "jp",
                line: "main",
                voiceManifest: localAndBlobManifest,
                urlOptions: desktopUrlOptions,
            }),
        ).toEqual({
            source: "manifest",
            urls: ["blob:https://moesekai.example/clip-1"],
            label: "Ichika",
        });
        expect(
            resolveTalkBeatVoicePlayback({
                beat: { id: "b2", voice: OFFICIAL_VOICE },
                region: "jp",
                line: "main",
                voiceManifest: localAndBlobManifest,
                urlOptions: desktopUrlOptions,
            }),
        ).toEqual({
            source: "manifest",
            urls: ["moesekai-app://app/workspace/voices/b2.ogg"],
            label: "Saki",
        });
    });

    test("resolveMidSceneManifestVoiceAction handles mount, override toggle, replacement, unrelated edits, and clear", () => {
        const urlOptions = buildVoiceManifestUrlOptions(null);
        const fallbackManifest = makeManifest({ overrideOfficialVoice: false });
        const overrideManifest = makeManifest({ overrideOfficialVoice: true });

        // Mounting on unvoiced beat -> plays
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1" },
                previousManifest: null,
                nextManifest: fallbackManifest,
                urlOptions,
            }),
        ).toEqual({
            action: "play",
            urls: ["https://cdn.example.com/voices/b1.ogg"],
            label: "Ichika",
        });

        // Mounting fallback-only manifest on official-voiced beat -> noop
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                previousManifest: null,
                nextManifest: fallbackManifest,
                urlOptions,
            }),
        ).toEqual({ action: "noop" });

        // Toggling overrideOfficialVoice false -> true on official-voiced beat -> plays custom voice
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                previousManifest: fallbackManifest,
                nextManifest: overrideManifest,
                urlOptions,
            }),
        ).toEqual({
            action: "play",
            urls: ["https://cdn.example.com/voices/b1.ogg"],
            label: "Ichika",
        });

        // Toggling overrideOfficialVoice true -> false on official-voiced beat -> stops custom voice
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                previousManifest: overrideManifest,
                nextManifest: fallbackManifest,
                urlOptions,
            }),
        ).toEqual({ action: "stop" });

        // Editing an unrelated beat (b2) while b1 clip stays identical -> noop (no replay)
        const updatedOtherBeat = makeManifest({
            overrideOfficialVoice: true,
            lines: {
                b1: { url: "https://cdn.example.com/voices/b1.ogg", speaker: "Ichika" },
                b2: { url: "https://cdn.example.com/voices/b2-v2.ogg", speaker: "Saki" },
            },
        });
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                previousManifest: overrideManifest,
                nextManifest: updatedOtherBeat,
                urlOptions,
            }),
        ).toEqual({ action: "noop" });

        // Replacing b1 clip URL -> replays new clip
        const replacedCurrentBeat = makeManifest({
            overrideOfficialVoice: true,
            lines: {
                b1: { url: "https://cdn.example.com/voices/b1-new.ogg", speaker: "Ichika" },
            },
        });
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1", voice: OFFICIAL_VOICE },
                previousManifest: overrideManifest,
                nextManifest: replacedCurrentBeat,
                urlOptions,
            }),
        ).toEqual({
            action: "play",
            urls: ["https://cdn.example.com/voices/b1-new.ogg"],
            label: "Ichika",
        });

        // Clearing manifest -> stop
        expect(
            resolveMidSceneManifestVoiceAction({
                beat: { id: "b1" },
                previousManifest: fallbackManifest,
                nextManifest: null,
                urlOptions,
            }),
        ).toEqual({ action: "stop" });
    });

    test("all 5 locale dictionaries have 100% key parity under voiceTrack", () => {
        const baseVoiceTrack = (STORY_MAKER_MESSAGES_BY_LOCALE["zh-CN"] as Record<string, unknown>).voiceTrack as Record<string, string>;
        const baseKeys = Object.keys(baseVoiceTrack).sort();
        expect(baseKeys.length).toBeGreaterThan(25);

        for (const locale of ALL_LOCALES) {
            const voiceTrack = (STORY_MAKER_MESSAGES_BY_LOCALE[locale] as Record<string, unknown>).voiceTrack as Record<string, string>;
            expect(Object.keys(voiceTrack).sort()).toEqual(baseKeys);
            for (const key of baseKeys) {
                expect(typeof voiceTrack[key]).toBe("string");
                expect(voiceTrack[key].trim().length).toBeGreaterThan(0);
            }
        }
    });

    test("dialog tab order, editor default tab wiring, and player clutter reduction invariants", () => {
        const dialogSrc = readFileSync(join(EDITOR_SRC, "components", "StoryVoiceManifestDialog.tsx"), "utf8");
        const editorSrc = readFileSync(join(EDITOR_SRC, "studio", "StoryStudioEditor.tsx"), "utf8");
        const studioPlayerSrc = readFileSync(join(EDITOR_SRC, "studio", "StoryStudioPlayer.tsx"), "utf8");
        const playerViewSrc = readFileSync(join(EDITOR_SRC, "components", "StoryPlayerView.tsx"), "utf8");

        // Upload tab rendered first, external import tab second
        const uploadTabIdx = dialogSrc.indexOf('{ value: "upload", label: uploadTab.label }');
        const importTabIdx = dialogSrc.indexOf('{ value: "import", label: t("page.storyMaker.voiceTrack.tabImport") }');
        expect(uploadTabIdx).toBeGreaterThan(-1);
        expect(importTabIdx).toBeGreaterThan(uploadTabIdx);
        expect(dialogSrc).toContain("<VoiceCueSheetExportBar");
        expect(dialogSrc).toContain("overrideOfficialVoice");

        // Dialog's top "Active Voice Track" card renders only in the external manifest branch (not duplicated on uploadTab)
        const uploadRenderIdx = dialogSrc.indexOf("uploadTab.render({");
        const activeTrackCardIdx = dialogSrc.indexOf('t("page.storyMaker.voiceTrack.currentTitle")');
        expect(uploadRenderIdx).toBeGreaterThan(-1);
        expect(activeTrackCardIdx).toBeGreaterThan(uploadRenderIdx);

        // Editor no longer hardcodes `"import"` when opening voice dialog from File menu / toolbar / playtest bar
        expect(editorSrc).not.toContain('setVoiceManifestInitialTab("import")');
        expect(editorSrc).toContain("onApplyManifest={handleApplyVoiceManifest}");
        expect(editorSrc).toContain("currentVoiceManifest: playVoiceManifest");

        // Player keeps unmounted external voice manifest tucked inside overflow menus (no bare standalone buttons)
        expect(studioPlayerSrc).toContain('label: t("page.storyMaker.voiceTrack.externalAction")');
        expect(studioPlayerSrc).toContain("{hasVoiceManifest && (");
        expect(studioPlayerSrc).not.toContain('variant={voiceManifest ? "tonal" : "standard"}');
        expect(studioPlayerSrc).not.toContain('variant={voiceManifest ? "tonal" : "outlined"}');

        expect(playerViewSrc).toContain('t("page.storyMaker.voiceTrack.externalAction")');
        expect(playerViewSrc).toContain("{hasVoiceTrackManifest && (");
    });
});
