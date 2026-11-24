import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    clearLive2DClientCaches,
    compileStoryGraph,
    configureStoryCore,
    createStarterStoryFromScript,
    parseStoryScript,
    resetStoryCoreConfig,
    serializeStoryScript,
} from "@moesekai/story-core";
import {
    exportCleanMskToFile,
    exportFullBundleToPath,
    exportLocalesToDirectory,
    runExportPreflight,
} from "../src/main/exporter.ts";
import { PathJailError } from "../src/shared/path-jail.ts";
import { createZipBuffer, extractZipEntry, listZipEntries } from "../src/shared/zip.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function makeValidScript(title = "Exportable Story"): string {
    const base = createStarterStoryFromScript("jp", "en");
    const doc = { ...base, meta: { ...base.meta, title } };
    return serializeStoryScript(doc, { includePositions: true });
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("pure-TS ZIP builder & verifier", () => {
    it("round-trips UTF-8 text and binary entries with CRC verification", () => {
        const zip = createZipBuffer([
            { path: "story.msk", data: "@title \"星夜の約束\"\n".repeat(40) },
            { path: "voices/clip.mp3", data: Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x01, 0x02]) },
        ]);

        const entries = listZipEntries(zip);
        expect(entries.map(e => e.path)).toEqual(["story.msk", "voices/clip.mp3"]);
        // Text compressed with DEFLATE (8), mp3 stored uncompressed (0)
        expect(entries[0].compressionMethod).toBe(8);
        expect(entries[1].compressionMethod).toBe(0);

        const extractedText = extractZipEntry(zip, "story.msk")?.toString("utf8");
        expect(extractedText).toBe("@title \"星夜の約束\"\n".repeat(40));
        expect(extractZipEntry(zip, "voices/clip.mp3")).toEqual(
            Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x01, 0x02]),
        );
    });

    it("rejects unsafe traversal paths inside ZIP archives", () => {
        expect(() => createZipBuffer([{ path: "../evil.txt", data: "nope" }])).toThrow();
        expect(() => createZipBuffer([{ path: "voices\\clip.mp3", data: "nope" }])).toThrow();
    });
});

describe(".msk export pipeline", () => {
    it("preflight succeeds on valid script and blocks invalid scripts", async () => {
        const script = makeValidScript("Preflight Check");
        const okRes = await runExportPreflight({
            script,
            includePositions: false,
        });
        expect(okRes.ok).toBe(true);
        expect(okRes.canExportCleanMsk).toBe(true);
        expect(okRes.errors.length).toBe(0);
        expect(okRes.stats.endingCount).toBeGreaterThanOrEqual(1);
        expect(okRes.previewScript).not.toContain("@pos(");

        const badRes = await runExportPreflight({
            script: "this is not valid msk syntax {{{",
            includePositions: false,
        });
        expect(badRes.ok).toBe(false);
        expect(badRes.canExportCleanMsk).toBe(false);
        expect(badRes.errors.length).toBeGreaterThan(0);
    });

    it("Mode 1: exports clean .msk with and without @pos coordinates, playable on pjsk.moe", async () => {
        const outDir = makeTempDir("moesekai-exp-msk-");
        const script = makeValidScript("Playable Export");

        const cleanPath = path.join(outDir, "clean.msk");
        const cleanRes = await exportCleanMskToFile({
            script,
            includePositions: false,
            outputPath: cleanPath,
        });
        expect(cleanRes.canceled).toBe(false);
        const cleanText = fs.readFileSync(cleanPath, "utf8");
        expect(cleanText).not.toContain("@pos(");

        // Must re-parse and compile with 0 errors
        const reparsed = parseStoryScript(cleanText);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
            const compiled = compileStoryGraph(reparsed.doc);
            expect(compiled.errors.length).toBe(0);
        }

        const withPosPath = path.join(outDir, "with-pos.msk");
        await exportCleanMskToFile({
            script,
            includePositions: true,
            outputPath: withPosPath,
        });
        const withPosText = fs.readFileSync(withPosPath, "utf8");
        expect(withPosText).toContain("@pos(");
    });

    it("Mode 2: exports Full Story Bundle (.zip and folder) with locales, portable manifest, and jailed local voices", async () => {
        const wsDir = makeTempDir("moesekai-exp-ws-");
        const outDir = makeTempDir("moesekai-exp-out-");
        fs.mkdirSync(path.join(wsDir, "voices"), { recursive: true });
        fs.writeFileSync(path.join(wsDir, "voices", "beat_1.mp3"), Buffer.from("VOICE_PAYLOAD_1234"));

        const script = makeValidScript("Bundled Story");
        const locales = {
            "en-US": {
                schema: "moesekai-story-i18n/1",
                storyId: "story_1",
                locale: "en-US",
                translationMeta: { origin: "human" },
                beats: {},
            },
        };
        const voiceManifest = {
            schema: "moesekai-story-voice/1",
            storyId: "story_1",
            lines: {
                beat_1: {
                    url: "moesekai-app://workspace/voices/beat_1.mp3",
                    speaker: "Ichika",
                },
            },
        };

        // ZIP bundle
        const zipPath = path.join(outDir, "story-bundle.zip");
        const zipRes = await exportFullBundleToPath({
            script,
            includePositions: false,
            format: "zip",
            locales,
            voiceManifest,
            workspaceRoot: wsDir,
            outputPath: zipPath,
        });
        expect(zipRes.canceled).toBe(false);
        expect(fs.existsSync(zipPath)).toBe(true);

        const zipBytes = fs.readFileSync(zipPath);
        const names = listZipEntries(zipBytes).map(e => e.path);
        expect(names).toContain("story.msk");
        expect(names).toContain("locales/en-US.i18n.json");
        expect(names).toContain("voices/manifest.json");
        expect(names).toContain("voices/beat_1.mp3");
        expect(names).toContain("bundle-manifest.json");

        // Verify portable manifest rewrote moesekai-app://workspace/ -> relative voices/beat_1.mp3
        const bundledManifest = JSON.parse(
            extractZipEntry(zipBytes, "voices/manifest.json")!.toString("utf8"),
        );
        expect(bundledManifest.lines.beat_1.url).toBe("voices/beat_1.mp3");
        expect(extractZipEntry(zipBytes, "voices/beat_1.mp3")?.toString("utf8")).toBe("VOICE_PAYLOAD_1234");

        // Folder bundle
        const folderPath = path.join(outDir, "story-folder");
        const folderRes = await exportFullBundleToPath({
            script,
            includePositions: true,
            format: "folder",
            locales,
            voiceManifest,
            workspaceRoot: wsDir,
            outputPath: folderPath,
        });
        expect(folderRes.canceled).toBe(false);
        expect(fs.existsSync(path.join(folderPath, "story.msk"))).toBe(true);
        expect(fs.existsSync(path.join(folderPath, "locales", "en-US.i18n.json"))).toBe(true);
        expect(fs.existsSync(path.join(folderPath, "voices", "beat_1.mp3"))).toBe(true);
    });

    it("bundles /voices/..., voices/..., moesekai-app://workspace/..., and moesekai-app://app/workspace/... voice entries cleanly", async () => {
        const wsDir = makeTempDir("moesekai-exp-voice-forms-");
        const outDir = makeTempDir("moesekai-exp-voice-out-");
        fs.mkdirSync(path.join(wsDir, "voices"), { recursive: true });
        fs.writeFileSync(path.join(wsDir, "voices", "b1.ogg"), Buffer.from("VOICE_1"));
        fs.writeFileSync(path.join(wsDir, "voices", "b2.mp3"), Buffer.from("VOICE_2"));
        fs.writeFileSync(path.join(wsDir, "voices", "b3.wav"), Buffer.from("VOICE_3"));
        fs.writeFileSync(path.join(wsDir, "voices", "b4.m4a"), Buffer.from("VOICE_4"));

        const voiceManifest = {
            schema: "moesekai-story-voice/1",
            storyId: "story_mixed",
            locale: "ja-JP",
            overrideOfficialVoice: true,
            baseUrl: "moesekai-app://app/workspace/",
            lines: {
                b1: { url: "voices/b1.ogg", objectKey: "voices/b1.ogg" },
                b2: { url: "/voices/b2.mp3" },
                b3: { url: "moesekai-app://workspace/voices/b3.wav" },
                b4: { url: "moesekai-app://app/workspace/voices/b4.m4a?t=999" },
                b5: { url: "https://cdn.example.com/remote/b5.ogg" },
            },
        };

        const zipPath = path.join(outDir, "mixed-voices.zip");
        const zipRes = await exportFullBundleToPath({
            script: makeValidScript("Mixed Voices Story"),
            includePositions: false,
            format: "zip",
            voiceManifest,
            workspaceRoot: wsDir,
            outputPath: zipPath,
        });
        expect(zipRes.canceled).toBe(false);

        const zipBytes = fs.readFileSync(zipPath);
        const names = listZipEntries(zipBytes).map(e => e.path);
        expect(names).toContain("voices/b1.ogg");
        expect(names).toContain("voices/b2.mp3");
        expect(names).toContain("voices/b3.wav");
        expect(names).toContain("voices/b4.m4a");
        expect(names).toContain("voices/manifest.json");

        const bundledManifest = JSON.parse(
            extractZipEntry(zipBytes, "voices/manifest.json")!.toString("utf8"),
        );
        expect(bundledManifest.overrideOfficialVoice).toBe(true);
        expect(bundledManifest.baseUrl).toBeUndefined();
        expect(bundledManifest.lines.b1).toEqual({ url: "voices/b1.ogg", objectKey: "voices/b1.ogg" });
        expect(bundledManifest.lines.b2).toEqual({ url: "voices/b2.mp3", objectKey: "voices/b2.mp3" });
        expect(bundledManifest.lines.b3).toEqual({ url: "voices/b3.wav", objectKey: "voices/b3.wav" });
        expect(bundledManifest.lines.b4).toEqual({ url: "voices/b4.m4a", objectKey: "voices/b4.m4a" });
        expect(bundledManifest.lines.b5).toEqual({ url: "https://cdn.example.com/remote/b5.ogg" });
    });

    it("blocks /voices/.. traversal attempts during bundle export", async () => {
        const base = makeTempDir("moesekai-exp-slash-escape-");
        const wsDir = path.join(base, "ws");
        const outDir = path.join(base, "out");
        fs.mkdirSync(path.join(wsDir, "voices"), { recursive: true });
        fs.writeFileSync(path.join(base, "secret.ogg"), "SECRET");

        const badManifest = {
            schema: "moesekai-story-voice/1",
            storyId: "story_1",
            lines: {
                beat_1: { url: "/voices/../../secret.ogg" },
            },
        };

        await expect(
            exportFullBundleToPath({
                script: makeValidScript("Slash Escape"),
                includePositions: false,
                format: "zip",
                voiceManifest: badManifest,
                workspaceRoot: wsDir,
                outputPath: path.join(outDir, "bad.zip"),
            }),
        ).rejects.toThrow(PathJailError);
    });

    it("restricts bundled local voices to valid non-empty audio under voices/ and matches moesekai-app scheme case-insensitively", async () => {
        const wsDir = makeTempDir("moesekai-exp-restrict-");
        const outDir = makeTempDir("moesekai-exp-restrict-out-");
        fs.mkdirSync(path.join(wsDir, "voices"), { recursive: true });
        fs.writeFileSync(path.join(wsDir, "story.msk"), makeValidScript("Root Script"));
        fs.writeFileSync(path.join(wsDir, "secret.ogg"), Buffer.from("OUTSIDE_VOICES_DIR"));
        fs.writeFileSync(path.join(wsDir, "voices", "manifest.json"), JSON.stringify({ schema: "moesekai-story-voice/1" }));
        fs.writeFileSync(path.join(wsDir, "voices", "readme.txt"), "NOT_AUDIO");
        fs.writeFileSync(path.join(wsDir, "voices", "empty.ogg"), Buffer.alloc(0));
        fs.writeFileSync(path.join(wsDir, "voices", "valid.ogg"), Buffer.from("VALID_OGG_BYTES"));

        const voiceManifest = {
            schema: "moesekai-story-voice/1",
            storyId: "story_restrict",
            baseUrl: "MOESEKAI-APP://APP/WORKSPACE/",
            lines: {
                ok_upper: { url: "MOESEKAI-APP://APP/WORKSPACE/voices/valid.ogg" },
                bad_root_msk: { url: "story.msk" },
                bad_root_audio: { url: "secret.ogg" },
                bad_manifest_dup: { url: "voices/manifest.json" },
                bad_ext: { url: "voices/readme.txt" },
                bad_empty: { url: "voices/empty.ogg" },
            },
        };

        const zipPath = path.join(outDir, "restricted.zip");
        const res = await exportFullBundleToPath({
            script: makeValidScript("Restricted Voices"),
            includePositions: false,
            format: "zip",
            voiceManifest,
            workspaceRoot: wsDir,
            outputPath: zipPath,
        });
        expect(res.canceled).toBe(false);

        const zipBytes = fs.readFileSync(zipPath);
        const names = listZipEntries(zipBytes).map(e => e.path);
        expect(names).toContain("voices/valid.ogg");
        expect(names).not.toContain("secret.ogg");
        expect(names).not.toContain("voices/readme.txt");
        expect(names).not.toContain("voices/empty.ogg");
        // Ensure story.msk and voices/manifest.json appear exactly once (never duplicated via voice collector)
        expect(names.filter(n => n === "story.msk").length).toBe(1);
        expect(names.filter(n => n === "voices/manifest.json").length).toBe(1);

        const bundledManifest = JSON.parse(
            extractZipEntry(zipBytes, "voices/manifest.json")!.toString("utf8"),
        );
        expect(bundledManifest.baseUrl).toBeUndefined();
        expect(bundledManifest.lines.ok_upper).toEqual({
            url: "voices/valid.ogg",
            objectKey: "voices/valid.ogg",
        });
    });

    it("blocks voice manifest path-escape references during bundle export", async () => {
        const base = makeTempDir("moesekai-exp-escape-");
        const wsDir = path.join(base, "ws");
        const outDir = path.join(base, "out");
        fs.mkdirSync(wsDir, { recursive: true });
        fs.writeFileSync(path.join(base, "secret.mp3"), "SECRET");

        const badManifest = {
            schema: "moesekai-story-voice/1",
            storyId: "story_1",
            lines: {
                beat_1: { url: "../secret.mp3" },
            },
        };

        await expect(
            exportFullBundleToPath({
                script: makeValidScript("Escape Attempt"),
                includePositions: false,
                format: "zip",
                voiceManifest: badManifest,
                workspaceRoot: wsDir,
                outputPath: path.join(outDir, "bad.zip"),
            }),
        ).rejects.toThrow(PathJailError);
    });

    it("Mode 3: exports locale packs & voice manifest directly to disk", async () => {
        const outDir = makeTempDir("moesekai-exp-locales-");
        const res = await exportLocalesToDirectory({
            locales: {
                "ja-JP": {
                    schema: "moesekai-story-i18n/1",
                    storyId: "story_1",
                    locale: "ja-JP",
                    translationMeta: { origin: "human" },
                    beats: {},
                },
            },
            voiceManifest: {
                schema: "moesekai-story-voice/1",
                storyId: "story_1",
                lines: {},
            },
            outputDir: outDir,
        });
        expect(res.canceled).toBe(false);
        expect(fs.existsSync(path.join(outDir, "ja-JP.i18n.json"))).toBe(true);
        expect(fs.existsSync(path.join(outDir, "voice-manifest.json"))).toBe(true);
    });

    it("checks Live2D cast models against canonical asset-site catalog (storage.pjsk.moe / backup storage.exmeaning.com)", async () => {
        const script = makeValidScript("Live Catalog Check");
        const parsed = parseStoryScript(script);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const castModelIds = parsed.doc.cast.map(c => c.modelId);
        expect(castModelIds.length).toBeGreaterThan(0);

        const requestedUrls: string[] = [];
        const makeListingResponse = (directories: string[]) =>
            new Response(
                JSON.stringify({
                    format: "directory-listing",
                    version: 1,
                    view: "canonical",
                    published_version: "7.1.0.70-test",
                    directories,
                    files: [],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );

        try {
            // 1. Main line: all cast models present -> 0 liveAssetIssues
            clearLive2DClientCaches();
            configureStoryCore({
                fetchImpl: (async (input: string | URL | Request) => {
                    const url = String(input);
                    requestedUrls.push(url);
                    if (url.endsWith("/jp/live2d/model/")) {
                        return makeListingResponse(castModelIds);
                    }
                    if (url.endsWith("/jp/live2d/motion/")) {
                        return makeListingResponse(["17kanade_motion_base"]);
                    }
                    return new Response("Not Found", { status: 404 });
                }) as unknown as typeof fetch,
            });

            const okMain = await runExportPreflight({
                script,
                includePositions: false,
                checkLiveAssets: true,
                assetLine: "main",
            });
            expect(okMain.liveAssetIssues).toEqual([]);
            expect(requestedUrls.some(u => u.startsWith("https://storage.pjsk.moe/jp/live2d/model/"))).toBe(true);
            expect(requestedUrls.some(u => u.includes("assets.pjsk.moe") || u.includes("models.json"))).toBe(false);

            // 2. Backup line with one missing model -> queries storage.exmeaning.com and reports catalog diagnostic
            requestedUrls.length = 0;
            clearLive2DClientCaches();
            const partialCatalog = castModelIds.slice(1);
            const missingModelId = castModelIds[0];
            configureStoryCore({
                fetchImpl: (async (input: string | URL | Request) => {
                    const url = String(input);
                    requestedUrls.push(url);
                    if (url.startsWith("https://storage.exmeaning.com/jp/live2d/model/")) {
                        return makeListingResponse(partialCatalog);
                    }
                    if (url.startsWith("https://storage.exmeaning.com/jp/live2d/motion/")) {
                        return makeListingResponse([]);
                    }
                    return new Response("Not Found", { status: 404 });
                }) as unknown as typeof fetch,
            });

            const missingBackup = await runExportPreflight({
                script,
                includePositions: false,
                checkLiveAssets: true,
                assetLine: "backup",
            });
            expect(requestedUrls.some(u => u.startsWith("https://storage.exmeaning.com/jp/live2d/model/"))).toBe(true);
            expect(missingBackup.liveAssetIssues?.length).toBe(1);
            expect(missingBackup.liveAssetIssues?.[0]).toContain(missingModelId);
            expect(missingBackup.liveAssetIssues?.[0]).toContain("Live2D asset site catalog");
            expect(missingBackup.liveAssetIssues?.[0]).not.toContain("models.json");
        } finally {
            clearLive2DClientCaches();
            resetStoryCoreConfig();
        }
    });
});
