import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { parseStoryScript } from "@moesekai/story-core";
import {
    applyStoryTranslation,
    applyVoiceManifest,
    extractTtsCandidateLines,
    prepareStoryTranslation,
    prepareVoiceCueSheet,
} from "../src/i18n-tools";
import { mineOfficialStory } from "../src/official-story";
import { writeStoryScript } from "../src/workspace";

const SAMPLE_EN_STORY = `@story "Nightcord Late Call" region=jp id="niigo_call" author="Test" summary="Kanade and Mafuyu talk."

@var bond: number = 1 "Bond"

@cast kanade "Yoisaki Kanade" model="v2_17kanade_casual" char=17
@cast mafuyu "Asahina Mafuyu" model="v2_18mafuyu_casual" char=18

start -> scene_desk

scene scene_desk "Kanade's Room" {
  bg set "bg_a001101"
  bgm play "bgm00033" vol=0.7
  place set "Kanade's Room"
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]
  talk kanade "Mafuyu, our bond level is {{bond}}." motion="w-normal01-nod" facial="face_smile_01"
  talk mafuyu "...Okay. Let's listen to the new demo." motion="w-cool01-nod" facial="face_normal_01"
} -> end_night

end end_night "Quiet Night" subtitle="Final bond: {{bond}}"
`;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "moesekai-agent-i18n-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("official story miner (offline mock fetch)", () => {
    test("mines study kit, catalog models/clips, inspect, and Brotli search-text", async () => {
        const corpusJsonl = [
            JSON.stringify({
                type: "event",
                story_id: "event_203",
                story: "Event 203",
                ep: 1,
                scenario_id: "event_203_01",
                line_start: 0,
                line_end: 2,
                char_ids: [17, 18],
                chars: ["Kanade", "Mafuyu"],
                text: "Kanade: 天台の風が冷たいね\nMafuyu: …うん",
            }),
        ].join("\n");
        const compressedCorpus = brotliCompressSync(Buffer.from(corpusJsonl, "utf8"));

        const requestedUrls: string[] = [];
        const mockFetch = (async (input: string | URL | Request) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            requestedUrls.push(url);
            if (url.endsWith("/master/events.json")) {
                return new Response(JSON.stringify([{ id: 203, name: "Midnight Chord" }]), { status: 200 });
            }
            if (url.endsWith("/master/eventStories.json")) {
                return new Response(
                    JSON.stringify([
                        {
                            eventId: 203,
                            assetbundleName: "event_midnight_2025",
                            bannerGameCharacterUnitId: 17,
                            outline: "A late-night demo session.",
                            eventStoryEpisodes: [{ episodeNo: 1, title: "Ep 1", scenarioId: "event_203_01" }],
                        },
                    ]),
                    { status: 200 },
                );
            }
            if (url.endsWith("/master/gameCharacterUnits.json")) {
                return new Response(
                    JSON.stringify([{ id: 17, gameCharacterId: 17, unit: "school_refusal" }]),
                    { status: 200 },
                );
            }
            if (url.endsWith("/master/eventCards.json")) {
                return new Response(JSON.stringify([{ eventId: 203, cardId: 901 }]), { status: 200 });
            }
            if (url.endsWith("/master/cards.json")) {
                return new Response(JSON.stringify([{ id: 901, characterId: 17 }]), { status: 200 });
            }
            if (url.endsWith("/master/character2ds.json")) {
                return new Response(
                    JSON.stringify([
                        { id: 101, characterType: "game_character", characterId: 17, unit: "school_refusal", assetName: "17kanade" },
                        { id: 102, characterType: "game_character", characterId: 18, unit: "school_refusal", assetName: "18mafuyu" },
                    ]),
                    { status: 200 },
                );
            }
            if (url.endsWith("/master/subGameCharacters.json") || url.endsWith("/master/musicSoundTrackCategories.json")) {
                return new Response(JSON.stringify([]), { status: 200 });
            }
            if (url.endsWith("/master/musicSoundTracks.json")) {
                return new Response(
                    JSON.stringify([
                        {
                            assetbundleName: "sound/scenario/bgm/bgm00033",
                            assetbundleFileName: "bgm00033",
                            title: "Still Night",
                            musicSoundTrackCategoryId: 1,
                        },
                    ]),
                    { status: 200 },
                );
            }
            if (url.includes("sound/scenario/se/se_pack00001_b/")) {
                return new Response(JSON.stringify({ files: ["se00001_b.mp3"] }), { status: 200 });
            }
            if (url.includes("sound/scenario/se/se_pack00001/")) {
                return new Response(JSON.stringify({ files: [] }), { status: 200 });
            }
            if (url.includes("event_midnight_2025/scenario/event_203_01.json")) {
                return new Response(
                    JSON.stringify({
                        ScenarioId: "event_203_01",
                        FirstBackground: "bg_a001101",
                        FirstBgm: "bgm00033",
                        AppearCharacters: [
                            { Character2dId: 101, CostumeType: "v2_17kanade_casual" },
                            { Character2dId: 102, CostumeType: "v2_18mafuyu_casual" },
                        ],
                        FirstLayout: [],
                        Snippets: [
                            { Action: 6, ReferenceIndex: 0 },
                            { Action: 7, ReferenceIndex: 0 },
                            { Action: 1, ReferenceIndex: 0 },
                        ],
                        SpecialEffectData: [{ EffectType: 18, StringVal: "奏の部屋" }],
                        SoundData: [{ Se: "se00001_b" }],
                        TalkData: [
                            {
                                WindowDisplayName: "奏",
                                Body: "…まふゆ、聴いてくれる？",
                                TalkCharacters: [{ Character2dId: 101 }],
                                Motions: [{ Character2dId: 101, MotionName: "w-normal01-nod", FacialName: "face_smile_01" }],
                                Voices: [],
                            },
                        ],
                        LayoutData: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        view: "canonical",
                        published_version: "7.1.0-test",
                        directories: ["live2d"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp/live2d/model/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        view: "canonical",
                        published_version: "7.1.0-test",
                        directories: ["v2_17kanade_casual", "v2_sub_kanadefather"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp/live2d/motion/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        view: "canonical",
                        published_version: "7.1.0-test",
                        directories: ["v2_17kanade_motion_base"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_17kanade_motion_base/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_17kanade_motion_base/v2/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: [],
                        files: [
                            { name: "readme.asset.json" },
                            { name: "buildmotiondata.asset.json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_17kanade_motion_base/v2/buildmotiondata.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/motion/v2_17kanade_motion_base/v2/buildmotiondata",
                        form: "live2d-motions",
                        form_version: 2,
                        members: [
                            { role: "motion/w-normal01-nod", extension: "json" },
                            { role: "facial/face_smile_01", extension: "json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://assets.pjsk.moe/sekai-extra-assets/sekai-story-search/manifest.json") {
                return new Response(
                    JSON.stringify({ servers: { jp: { chunks: { path: "jp.jsonl.br", sha256: "abc" } } } }),
                    { status: 200 },
                );
            }
            if (url === "https://assets.pjsk.moe/sekai-extra-assets/sekai-story-search/jp.jsonl.br") {
                return new Response(compressedCorpus, { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const studyRes = await mineOfficialStory(
            { action: "study", unit: "25ji", sample: 1, region: "jp" },
            { fetchImpl: mockFetch, noCache: true },
        );
        expect(studyRes.action).toBe("study");
        if (studyRes.action === "study") {
            expect(studyRes.data.recommendedCast[0].modelId).toBe("v2_17kanade_casual");
            expect(studyRes.data.backgrounds[0].id).toBe("bg_a001101");
            expect(studyRes.data.bgm[0].name).toBe("bgm00033");
            expect(studyRes.data.se[0].path).toBe("se_pack00001_b/se00001_b");
            expect(studyRes.data.characterClips[0].pairs[0].motion).toBe("w-normal01-nod");
        }

        const modelsRes = await mineOfficialStory(
            { action: "catalog", subkind: "models", char: "kanade", v2Only: true, region: "jp" },
            { fetchImpl: mockFetch, noCache: true },
        );
        expect(modelsRes.action).toBe("catalog");
        if (modelsRes.action === "catalog" && modelsRes.data.kind === "models") {
            expect(modelsRes.data.source).toBe("asset-site-listings");
            expect(modelsRes.data.items.map((m) => m.id)).toEqual(["v2_17kanade_casual"]);
            expect(modelsRes.data.items[0].motion).toBe("live2d/motion/v2_17kanade_motion_base");
        }

        const clipsRes = await mineOfficialStory(
            { action: "catalog", subkind: "clips", arg: "v2_17kanade_casual", region: "jp" },
            { fetchImpl: mockFetch, noCache: true },
        );
        if (clipsRes.action === "catalog" && clipsRes.data.kind === "clips") {
            expect(clipsRes.data.motionBundle).toBe("live2d/motion/v2_17kanade_motion_base");
            expect(clipsRes.data.motions).toContain("w-normal01-nod");
            expect(clipsRes.data.facials).toContain("face_smile_01");
        }

        // Live2D catalog calls must never hit assets.pjsk.moe
        expect(requestedUrls.some((u) => u.includes("assets.pjsk.moe"))).toBe(false);

        const searchRes = await mineOfficialStory(
            { action: "search-text", query: "天台", char: "17,18", region: "jp" },
            { fetchImpl: mockFetch, noCache: true },
        );
        if (searchRes.action === "search-text") {
            expect(searchRes.data.hits).toHaveLength(1);
            expect(searchRes.data.hits[0].selector).toBe("event:203/1");
        }
        // sekai-story-search intentionally stays on assets.pjsk.moe
        expect(
            requestedUrls.some((u) => u.startsWith("https://assets.pjsk.moe/sekai-extra-assets/sekai-story-search/")),
        ).toBe(true);
    });

    test("catalog models falls back to backup asset site when primary listing fails", async () => {
        const mockFetch = (async (input: string | URL | Request) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/jp/live2d/model/") {
                return new Response("upstream error", { status: 503 });
            }
            if (url === "https://storage.exmeaning.com/jp/live2d/model/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_17kanade_casual"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.exmeaning.com/jp/live2d/motion/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_17kanade_motion_base"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const modelsRes = await mineOfficialStory(
            { action: "catalog", subkind: "models", char: "kanade", v2Only: true, region: "jp" },
            { fetchImpl: mockFetch, noCache: true },
        );
        expect(modelsRes.action).toBe("catalog");
        if (modelsRes.action === "catalog" && modelsRes.data.kind === "models") {
            expect(modelsRes.data.source).toBe("asset-site-listings");
            expect(modelsRes.data.items.map((m) => m.id)).toEqual(["v2_17kanade_casual"]);
        }
    });
});

describe("i18n chunking, locale validation & user voice cue-sheet / manifest", () => {
    test("prepares translation prompt, rejects broken placeholders, persists valid pack, and matches local voice files", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(dir, "story.msk", SAMPLE_EN_STORY);

        // 1. Prepare ja-JP translation chunk
        const prep = await prepareStoryTranslation(dir, "story.msk", { targetLocale: "ja-JP" });
        expect(prep.sourceLocale).toBe("en-US");
        expect(prep.totalChunks).toBe(1);
        expect(prep.beatIds.length).toBe(2);
        expect(prep.prompt).toContain("宵崎奏");
        expect(prep.prompt).toContain("朝比奈まふゆ");

        const [beat1, beat2] = prep.beatIds;
        const payloadBeats = (prep.payload as { beats: Record<string, { srcHash: string }> }).beats;

        // 2. Reject translation missing {{bond}} placeholder
        const badPack = JSON.stringify({
            schema: "moesekai-story-i18n/1",
            storyId: "niigo_call",
            locale: "ja-JP",
            translationMeta: { origin: "ai_raw" },
            beats: {
                [beat1]: { srcHash: payloadBeats[beat1].srcHash, body: "まふゆ、絆レベルだよ。" },
                [beat2]: { srcHash: payloadBeats[beat2].srcHash, body: "…うん。新しいデモを聴こう。" },
            },
        });
        const badRes = await applyStoryTranslation(dir, "story.msk", {
            targetLocale: "ja-JP",
            rawJson: badPack,
        });
        expect(badRes.ok).toBe(false);
        expect(badRes.validation.errors.some((e) => e.code === "placeholderMismatch")).toBe(true);

        // 3. Apply valid ja-JP translation pack
        const goodPack = JSON.stringify({
            schema: "moesekai-story-i18n/1",
            storyId: "niigo_call",
            locale: "ja-JP",
            translationMeta: { origin: "ai_raw", modelHint: "pi-test" },
            meta: { title: "ニーゴの深夜通話" },
            cast: { kanade: "宵崎奏", mafuyu: "朝比奈まふゆ" },
            places: { scene_desk: "奏の部屋" },
            beats: {
                [beat1]: { srcHash: payloadBeats[beat1].srcHash, body: "まふゆ、絆レベルは{{bond}}だよ。" },
                [beat2]: { srcHash: payloadBeats[beat2].srcHash, body: "…うん。新しいデモを聴こう。" },
            },
            ends: { end_night: { title: "静かな夜", subtitle: "最終絆：{{bond}}" } },
        });
        const goodRes = await applyStoryTranslation(dir, "story.msk", {
            targetLocale: "ja-JP",
            rawJson: goodPack,
        });
        expect(goodRes.ok).toBe(true);
        expect(goodRes.filePath).toBe("locales/ja-JP.i18n.json");

        // 4. Extract JP voice cue-sheet lines using overlaid ja-JP pack
        const parsed = parseStoryScript(SAMPLE_EN_STORY);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            const directCandidates = extractTtsCandidateLines(parsed.doc, {
                locale: "ja-JP",
                localePack: goodRes.validation.pack,
            });
            expect(directCandidates).toHaveLength(2);
            expect(directCandidates[0].text).toContain("まふゆ、絆レベルは{{bond}}だよ。");
            expect(directCandidates[0].cleanTtsText).not.toContain("{{bond}}");
            expect(directCandidates[0].speechHint?.jpName).toBe("宵崎奏");
        }

        // 5. Put user-supplied local audio files in voices/ and auto-build voices/manifest.json
        await mkdir(join(dir, "voices"), { recursive: true });
        await writeFile(join(dir, "voices", `${beat1}.ogg`), Buffer.from("OggS-mock"));
        await writeFile(join(dir, "voices", `${beat2}.mp3`), Buffer.from("ID3-mock"));
        await writeFile(join(dir, "voices", "unused_clip.wav"), Buffer.from("RIFF-mock"));

        const cue = await prepareVoiceCueSheet(dir, "story.msk", { targetLocale: "ja-JP" });
        expect(cue.candidateLines).toHaveLength(2);
        expect(cue.localAudioScan.matched).toHaveLength(2);
        expect(cue.localAudioScan.unmatched).toEqual(["unused_clip.wav"]);

        const appliedManifest = await applyVoiceManifest(dir, "story.msk", {
            autoMatchAudioDir: "voices",
            locale: "ja-JP",
            title: "User Local Voices",
        });
        expect(appliedManifest.ok).toBe(true);
        expect(appliedManifest.filePath).toBe("voices/manifest.json");
        expect(appliedManifest.matchSummary?.matchedCount).toBe(2);
        expect(appliedManifest.matchSummary?.totalTalkBeats).toBe(2);
    });
});
