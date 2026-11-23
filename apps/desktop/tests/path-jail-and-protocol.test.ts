import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProtocolHandler } from "../src/main/protocol.ts";
import {
    getMimeType,
    PathJailError,
    resolveJailedPath,
    sanitizeExportFilename,
} from "../src/shared/path-jail.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("path-jail security", () => {
    it("allows valid nested paths inside root", () => {
        const root = makeTempDir("moesekai-jail-");
        fs.mkdirSync(path.join(root, "voices", "ch1"), { recursive: true });
        const voiceFile = path.join(root, "voices", "ch1", "hello world.mp3");
        fs.writeFileSync(voiceFile, "FAKE_MP3");

        const resolved = resolveJailedPath(root, "/voices/ch1/hello%20world.mp3", { mustExist: true });
        expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(voiceFile));
    });

    it("blocks lexical traversal, encoded traversal, Windows drives, UNC, and null bytes", () => {
        const root = makeTempDir("moesekai-jail-");
        const attacks = [
            "../secret.txt",
            "voices/../../secret.txt",
            "%2e%2e/secret.txt",
            "%252e%252e/secret.txt",
            "..\\..\\Windows\\System32\\drivers\\etc\\hosts",
            "C:/Windows/System32/cmd.exe",
            "C:\\Windows\\win.ini",
            "//evil-server/share/file.mp3",
            "file:///etc/passwd",
            "voices/line\0.mp3",
            "%E0%A4%A",
        ];

        for (const attack of attacks) {
            expect(() => resolveJailedPath(root, attack)).toThrow(PathJailError);
        }
    });

    it("blocks sibling directory prefix bypass (e.g. /tmp/proj vs /tmp/proj-evil)", () => {
        const base = makeTempDir("moesekai-prefix-");
        const proj = path.join(base, "proj");
        const evil = path.join(base, "proj-evil");
        fs.mkdirSync(proj, { recursive: true });
        fs.mkdirSync(evil, { recursive: true });
        fs.writeFileSync(path.join(evil, "secret.txt"), "top-secret");

        expect(() => resolveJailedPath(proj, "../proj-evil/secret.txt")).toThrow(PathJailError);
    });

    it("blocks symlink/junction escape outside root", () => {
        const base = makeTempDir("moesekai-symlink-");
        const root = path.join(base, "workspace");
        const outside = path.join(base, "outside");
        fs.mkdirSync(path.join(root, "voices"), { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        const secretFile = path.join(outside, "secret.mp3");
        fs.writeFileSync(secretFile, "SECRET_AUDIO");

        const linkDir = path.join(root, "voices", "escape-dir");
        try {
            fs.symlinkSync(outside, linkDir, process.platform === "win32" ? "junction" : "dir");
        } catch {
            // Skip only if OS denies symlink/junction creation in restricted environment
            return;
        }

        let caught: unknown;
        try {
            resolveJailedPath(root, "voices/escape-dir/secret.mp3", { mustExist: true });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(PathJailError);
        expect((caught as PathJailError).code).toBe("SYMLINK_ESCAPE");
    });

    it("maps Live2D WASM, JS, and audio MIME types accurately", () => {
        expect(getMimeType("pkg/sekai_live2d_viewer_bg.wasm")).toBe("application/wasm");
        expect(getMimeType("stage-worker.js")).toBe("application/javascript; charset=utf-8");
        expect(getMimeType("voices/clip.mp3")).toBe("audio/mpeg");
        expect(getMimeType("voices/clip.ogg")).toBe("audio/ogg");
        expect(sanitizeExportFilename('  My:Bad/Story?*Name  ')).toBe("My_Bad_Story_Name");
    });
});

describe("moesekai-app:// custom protocol handler", () => {
    it("serves Live2D WASM/worker and workspace audio with Range support while blocking escapes", async () => {
        const base = makeTempDir("moesekai-proto-");
        const rendererDir = path.join(base, "renderer");
        const live2dDir = path.join(base, "live2d");
        const workspaceDir = path.join(base, "workspace");

        fs.mkdirSync(rendererDir, { recursive: true });
        fs.mkdirSync(path.join(live2dDir, "pkg"), { recursive: true });
        fs.mkdirSync(path.join(workspaceDir, "voices"), { recursive: true });

        fs.writeFileSync(path.join(rendererDir, "index.html"), "<!doctype html><html></html>");
        fs.writeFileSync(path.join(live2dDir, "stage-worker.js"), "console.log('worker');");
        fs.writeFileSync(path.join(live2dDir, "pkg", "sekai_live2d_viewer_bg.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
        fs.writeFileSync(path.join(workspaceDir, "voices", "line1.mp3"), Buffer.from("0123456789ABCDEF"));
        fs.writeFileSync(path.join(base, "outside.txt"), "SHOULD_NOT_LEAK");

        let activeWorkspace: string | null = workspaceDir;
        const handler = createProtocolHandler({
            rendererDir,
            live2dDir,
            getWorkspaceRoot: () => activeWorkspace,
        });

        // 1. Same-origin Live2D WASM under moesekai-app://app/live2d-viewer/
        const wasmRes = handler(new Request("moesekai-app://app/live2d-viewer/pkg/sekai_live2d_viewer_bg.wasm"));
        expect(wasmRes.status).toBe(200);
        expect(wasmRes.headers.get("content-type")).toBe("application/wasm");
        expect(Buffer.from(await wasmRes.arrayBuffer())).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));

        // 2. Direct Live2D worker under moesekai-app://live2d-viewer/
        const workerRes = handler(new Request("moesekai-app://live2d-viewer/stage-worker.js"));
        expect(workerRes.status).toBe(200);
        expect(workerRes.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

        // 3. Workspace audio with Range request (206 Partial Content)
        const rangeRes = handler(
            new Request("moesekai-app://workspace/voices/line1.mp3", {
                headers: { Range: "bytes=2-5" },
            }),
        );
        expect(rangeRes.status).toBe(206);
        expect(rangeRes.headers.get("content-type")).toBe("audio/mpeg");
        expect(rangeRes.headers.get("content-range")).toBe("bytes 2-5/16");
        expect(await rangeRes.text()).toBe("2345");

        // 4. Path escape blocked (403 on double-encoded/backslash traversal, 404 when URL parser collapses to non-existent root file)
        const doubleEncodedEscape = handler(new Request("moesekai-app://workspace/%252e%252e/outside.txt"));
        expect(doubleEncodedEscape.status).toBe(403);
        const backslashEscape = handler(new Request("moesekai-app://workspace/..%5coutside.txt"));
        expect(backslashEscape.status).toBe(403);
        const collapsedEscape = handler(new Request("moesekai-app://workspace/%2e%2e/outside.txt"));
        expect([403, 404]).toContain(collapsedEscape.status);
        expect(await collapsedEscape.text()).not.toContain("SHOULD_NOT_LEAK");

        // 5. Workspace closed -> 404
        activeWorkspace = null;
        const closedRes = handler(new Request("moesekai-app://workspace/voices/line1.mp3"));
        expect(closedRes.status).toBe(404);
    });
});
