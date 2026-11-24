import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStoryDocument, serializeStoryScript } from "@moesekai/story-core";
import { DesktopSettingsStore, type SecretProtector } from "../src/main/settings.ts";
import {
    MAX_LOCAL_VOICE_FILE_BYTES,
    scanAudioFilesRecursive,
    WorkspaceManager,
} from "../src/main/workspace.ts";
import { PathJailError } from "../src/shared/path-jail.ts";
import type { WorkspaceExternalChangeEvent } from "../src/shared/ipc.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function makeSampleScript(title: string): string {
    const doc = createStoryDocument("jp", title);
    return serializeStoryScript(doc);
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("WorkspaceManager", () => {
    it("creates project folder layout, persists recent projects, saves locales & voice manifest, and supports snapshots/rollback", () => {
        const userData = makeTempDir("moesekai-udata-");
        const projectDir = path.join(makeTempDir("moesekai-ws-"), "starlight-story");
        const mgr = new WorkspaceManager({ userDataDir: userData });

        const v1Script = makeSampleScript("Starlight Episode 1");
        const created = mgr.createProject({
            dirPath: projectDir,
            title: "Starlight Episode 1",
            region: "jp",
            initialScript: v1Script,
        });

        expect(fs.existsSync(path.join(projectDir, "story.msk"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, "locales"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, "voices"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, ".moesekai-studio", "snapshots"))).toBe(true);
        expect(created.script).toBe(v1Script);

        // Recent projects recorded
        const recent = mgr.listRecentProjects();
        expect(recent.length).toBe(1);
        expect(recent[0].title).toBe("Starlight Episode 1");
        expect(recent[0].isSingleFile).toBe(false);

        // Create snapshot before edit, then save v2 + locale + voice manifest
        const snap = mgr.createSnapshot("before-v2");
        const v2Script = makeSampleScript("Starlight Episode 2");
        const sampleLocale = {
            schema: "moesekai-story-i18n/1",
            storyId: created.id,
            locale: "en-US",
            translationMeta: { origin: "human" },
            beats: {},
        };
        const sampleManifest = {
            schema: "moesekai-story-voice/1",
            storyId: created.id,
            lines: {
                beat_1: { url: "moesekai-app://workspace/voices/line1.mp3" },
            },
        };

        mgr.saveProject({
            script: v2Script,
            locales: { "en-US": sampleLocale },
            voiceManifest: sampleManifest,
        });

        expect(fs.existsSync(path.join(projectDir, "locales", "en-US.i18n.json"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, "voices", "manifest.json"))).toBe(true);
        expect(mgr.getActiveProject()?.script).toBe(v2Script);

        // Rollback restores v1 and saves a pre-rollback safety snapshot
        const rolledBack = mgr.rollbackSnapshot(snap.id);
        expect(rolledBack.script).toBe(v1Script);
        expect(rolledBack.snapshots.length).toBeGreaterThanOrEqual(2);

        mgr.dispose();
    });

    it("opens a standalone single .msk file directly without requiring project folder scaffolding", () => {
        const userData = makeTempDir("moesekai-udata-");
        const folder = makeTempDir("moesekai-single-");
        const mskPath = path.join(folder, "custom-episode.msk");
        const script = makeSampleScript("Standalone Story");
        fs.writeFileSync(mskPath, script, "utf8");

        const mgr = new WorkspaceManager({ userDataDir: userData });
        const opened = mgr.openProject(mskPath);
        expect(opened.isSingleFile).toBe(true);
        expect(opened.storyFileName).toBe("custom-episode.msk");
        expect(opened.script).toBe(script);
        expect(mgr.listRecentProjects()[0].isSingleFile).toBe(true);
        mgr.dispose();
    });

    it("suppresses self-write echoes while hot-reloading genuine external .msk edits", async () => {
        const userData = makeTempDir("moesekai-udata-");
        const projectDir = path.join(makeTempDir("moesekai-watch-"), "live-story");
        const mgr = new WorkspaceManager({ userDataDir: userData, debounceMs: 60 });

        const events: WorkspaceExternalChangeEvent[] = [];
        mgr.onExternalChange(ev => events.push(ev));

        mgr.createProject({
            dirPath: projectDir,
            title: "Watch Test v1",
            region: "jp",
            initialScript: makeSampleScript("Watch Test v1"),
        });

        // Self-write MUST NOT trigger external change callback
        mgr.saveProject({ script: makeSampleScript("Watch Test v2 Self") });
        await Bun.sleep(250);
        expect(events.length).toBe(0);

        // External write (e.g. Pi Agent or external editor) MUST trigger hot-reload event
        const externalScript = makeSampleScript("Watch Test v3 External");
        fs.writeFileSync(path.join(projectDir, "story.msk"), externalScript, "utf8");

        const deadline = Date.now() + 2000;
        while (events.length === 0 && Date.now() < deadline) {
            await Bun.sleep(50);
        }

        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[events.length - 1].script).toBe(externalScript);

        mgr.dispose();
    });

    it("imports local audio files safely into voices/ and rejects unsupported extensions", () => {
        const userData = makeTempDir("moesekai-udata-");
        const projectDir = path.join(makeTempDir("moesekai-voice-"), "voice-story");
        const srcDir = makeTempDir("moesekai-src-audio-");
        const audioSrc = path.join(srcDir, "take_01.ogg");
        const badSrc = path.join(srcDir, "malware.exe");
        fs.writeFileSync(audioSrc, "OGG_BYTES");
        fs.writeFileSync(badSrc, "MZ");

        const mgr = new WorkspaceManager({ userDataDir: userData });
        mgr.createProject({
            dirPath: projectDir,
            title: "Voice Story",
            region: "jp",
            initialScript: makeSampleScript("Voice Story"),
        });

        const imported = mgr.importLocalVoiceFile(audioSrc, "beat_001");
        expect(imported.relativePath).toBe("voices/beat_001.ogg");
        expect(imported.originalName).toBe("take_01.ogg");
        expect(fs.existsSync(path.join(projectDir, "voices", "beat_001.ogg"))).toBe(true);
        expect(() => mgr.importLocalVoiceFile(badSrc)).toThrow(/Unsupported audio/);

        // Re-importing a file already inside voices/ at the same destination must not truncate it
        const sameFileReimport = mgr.importLocalVoiceFile(imported.absolutePath, "beat_001");
        expect(sameFileReimport.sizeBytes).toBe(9);
        expect(fs.readFileSync(imported.absolutePath, "utf8")).toBe("OGG_BYTES");

        // Path traversal in preferredStem must be blocked by PathJailError
        expect(() => mgr.importLocalVoiceFile(audioSrc, "../escape")).toThrow(PathJailError);

        mgr.dispose();
    });

    it("saves and removes voices/manifest.json via saveVoiceManifest with self-write echo suppression", async () => {
        const userData = makeTempDir("moesekai-udata-");
        const projectDir = path.join(makeTempDir("moesekai-vm-"), "voice-manifest-story");
        const mgr = new WorkspaceManager({ userDataDir: userData, debounceMs: 60 });

        const events: WorkspaceExternalChangeEvent[] = [];
        mgr.onExternalChange(ev => events.push(ev));

        const created = mgr.createProject({
            dirPath: projectDir,
            title: "Voice Manifest Story",
            region: "jp",
            initialScript: makeSampleScript("Voice Manifest Story"),
        });

        const manifest = {
            schema: "moesekai-story-voice/1",
            storyId: created.id,
            locale: "ja-JP",
            overrideOfficialVoice: true,
            lines: {
                beat_001: {
                    url: "voices/beat_001.ogg",
                    objectKey: "voices/beat_001.ogg",
                    speaker: "Kanade",
                    sizeBytes: 1234,
                },
            },
        };

        const saved = mgr.saveVoiceManifest(manifest);
        expect(saved.removed).toBe(false);
        expect(fs.existsSync(path.join(projectDir, "voices", "manifest.json"))).toBe(true);
        expect(mgr.getActiveProject()?.voiceManifest).toEqual(manifest);

        // Self-write MUST NOT trigger external change event
        await Bun.sleep(250);
        expect(events.length).toBe(0);

        // Clearing manifest removes voices/manifest.json without triggering external change event
        const removed = mgr.saveVoiceManifest(null);
        expect(removed.removed).toBe(true);
        expect(fs.existsSync(path.join(projectDir, "voices", "manifest.json"))).toBe(false);
        expect(mgr.getActiveProject()?.voiceManifest).toBeNull();

        await Bun.sleep(250);
        expect(events.length).toBe(0);

        // Even after a delayed non-manifest file write inside voices/, absent manifest stays suppressed
        fs.writeFileSync(path.join(projectDir, "voices", "clip_temp.ogg"), "OGG");
        await Bun.sleep(250);
        expect(events.length).toBe(0);

        // External write to voices/manifest.json MUST trigger external reload event
        const externalManifest = {
            schema: "moesekai-story-voice/1",
            storyId: created.id,
            lines: { beat_ext: { url: "voices/beat_ext.mp3" } },
        };
        fs.writeFileSync(
            path.join(projectDir, "voices", "manifest.json"),
            JSON.stringify(externalManifest, null, 2),
            "utf8",
        );

        const deadline = Date.now() + 2000;
        while (events.length === 0 && Date.now() < deadline) {
            await Bun.sleep(50);
        }
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[events.length - 1].kind).toBe("voice-manifest");
        expect(events[events.length - 1].voiceManifest).toEqual(externalManifest);

        mgr.dispose();
    });

    it("imports raw voice buffers safely with path-jail, extension, and size validation, and scans audio folders", () => {
        const userData = makeTempDir("moesekai-udata-");
        const projectDir = path.join(makeTempDir("moesekai-vbuf-"), "voice-buf-story");
        const mgr = new WorkspaceManager({ userDataDir: userData });

        mgr.createProject({
            dirPath: projectDir,
            title: "Voice Buffer Story",
            region: "jp",
            initialScript: makeSampleScript("Voice Buffer Story"),
        });

        // Import raw buffer with beatId override
        const oggBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
        const res1 = mgr.importLocalVoiceBuffer("take_01.ogg", oggBytes, "b_01");
        expect(res1.relativePath).toBe("voices/b_01.ogg");
        expect(res1.fileName).toBe("b_01.ogg");
        expect(res1.originalName).toBe("take_01.ogg");
        expect(res1.sizeBytes).toBe(oggBytes.byteLength);
        expect(Buffer.from(fs.readFileSync(res1.absolutePath))).toEqual(Buffer.from(oggBytes));

        // Import raw buffer without beatId preserves sanitized filename
        const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03]);
        const res2 = mgr.importLocalVoiceBuffer("line 02.mp3", mp3Bytes);
        expect(res2.relativePath).toBe("voices/line_02.mp3");

        // List local voice files
        const listed = mgr.listLocalVoiceFiles();
        expect(listed.map(f => f.relativePath)).toEqual(["voices/b_01.ogg", "voices/line_02.mp3"]);

        // Reject unsupported extension, empty buffer, oversized buffer, and path-escape tokens
        expect(() => mgr.importLocalVoiceBuffer("evil.exe", mp3Bytes)).toThrow(/Unsupported audio/);
        expect(() => mgr.importLocalVoiceBuffer("empty.ogg", new Uint8Array(0))).toThrow(/empty/i);
        const fakeOversized = new Uint8Array(1);
        Object.defineProperty(fakeOversized, "byteLength", { value: MAX_LOCAL_VOICE_FILE_BYTES + 1 });
        expect(() => mgr.importLocalVoiceBuffer("huge.wav", fakeOversized)).toThrow(/exceeds maximum/);
        expect(() => mgr.importLocalVoiceBuffer("../escape.mp3", mp3Bytes)).toThrow(PathJailError);
        expect(() => mgr.importLocalVoiceBuffer("sub/escape.mp3", mp3Bytes)).toThrow(PathJailError);
        expect(() => mgr.importLocalVoiceBuffer("ok.mp3", mp3Bytes, "../escape")).toThrow(PathJailError);

        // Recursive external audio folder scan skips hidden directories & non-audio files
        const scanDir = makeTempDir("moesekai-scan-");
        fs.mkdirSync(path.join(scanDir, "scene1"), { recursive: true });
        fs.mkdirSync(path.join(scanDir, ".hidden"), { recursive: true });
        fs.writeFileSync(path.join(scanDir, "b_01.ogg"), "OGG");
        fs.writeFileSync(path.join(scanDir, "scene1", "b_02.mp3"), "MP3");
        fs.writeFileSync(path.join(scanDir, "scene1", "notes.txt"), "TXT");
        fs.writeFileSync(path.join(scanDir, ".hidden", "ignored.ogg"), "OGG");

        const scanned = scanAudioFilesRecursive(scanDir).map(p => path.basename(p));
        expect(scanned).toEqual(["b_01.ogg", "b_02.mp3"]);

        mgr.dispose();
    });
});

describe("DesktopSettingsStore encrypted API key storage", () => {
    it("encrypts API keys with SecretProtector and never leaks plaintext in public config", () => {
        const userData = makeTempDir("moesekai-settings-");
        const fakeProtector: SecretProtector = {
            isEncryptionAvailable: () => true,
            encryptString: plain => Buffer.from(`ENC:${plain}`, "utf8"),
            decryptString: buf => {
                const text = buf.toString("utf8");
                if (!text.startsWith("ENC:")) throw new Error("bad ciphertext");
                return text.slice(4);
            },
        };

        const store = new DesktopSettingsStore(userData, fakeProtector);
        const pub = store.saveAgentConfig({
            mode: "sdk",
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            apiKey: "sk-ant-super-secret-1234",
        });

        expect(pub.hasApiKey).toBe(true);
        expect(pub.safeStorageAvailable).toBe(true);
        expect(pub.apiKeyHint).toBe("sk-a••••1234");
        expect(JSON.stringify(pub)).not.toContain("super-secret");

        // On-disk JSON must NOT contain plaintext API key
        const rawDisk = fs.readFileSync(path.join(userData, "agent-config.json"), "utf8");
        expect(rawDisk).not.toContain("sk-ant-super-secret-1234");

        // Worker config decrypts accurately
        const workerCfg = store.getResolvedAgentConfigForWorker();
        expect(workerCfg.apiKey).toBe("sk-ant-super-secret-1234");

        // Updating model without apiKey preserves stored encrypted key
        store.saveAgentConfig({
            mode: "sdk",
            provider: "anthropic",
            model: "claude-opus-4-1",
        });
        expect(store.getResolvedAgentConfigForWorker().apiKey).toBe("sk-ant-super-secret-1234");

        // Clearing removes key cleanly
        const cleared = store.saveAgentConfig({
            mode: "sdk",
            provider: "anthropic",
            model: "claude-opus-4-1",
            clearApiKey: true,
        });
        expect(cleared.hasApiKey).toBe(false);
        expect(store.getResolvedAgentConfigForWorker().apiKey).toBeUndefined();
    });
});
