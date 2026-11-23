import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    compileStoryGraph,
    createStarterStoryFromScript,
    parseStoryScript,
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
});
