import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStoryScript } from "@moesekai/story-core";
import {
    attachAgentWorkerPort,
    type ParentPortLike,
    type WorkerMessage,
    type WorkerRequest,
} from "../src/main/agent-worker.ts";
import { resolveUniqueProjectDir, WorkspaceManager } from "../src/main/workspace.ts";
import { buildNewProjectDocument } from "../src/shared/new-project.ts";

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

class MockParentPort extends EventEmitter implements ParentPortLike {
    private waiters = new Map<string, (msg: WorkerMessage) => void>();

    postMessage(message: unknown): void {
        const msg = message as WorkerMessage;
        if (msg.kind === "response") {
            const waiter = this.waiters.get(msg.id);
            if (waiter) {
                this.waiters.delete(msg.id);
                waiter(msg);
            }
        }
    }

    request(req: WorkerRequest): Promise<WorkerMessage> {
        return new Promise(resolve => {
            this.waiters.set(req.id, resolve);
            this.emit("message", { data: req });
        });
    }
}

describe("blank new-project default & strict cross-project isolation (#92)", () => {
    it("defaults new project '那年今日' to a clean blank .msk with 0 Nightcord cast/scenes/vars and a fresh unique id", () => {
        const built = buildNewProjectDocument({
            title: "那年今日",
            region: "jp",
            locale: "zh-CN",
        });

        expect(built.doc.meta.title).toBe("那年今日");
        expect(built.doc.region).toBe("jp");
        expect(built.doc.sourceLocale).toBe("zh-CN");
        expect(built.doc.id).not.toBe("nightcord_unspoken_echo");
        expect(built.doc.id.length).toBeGreaterThanOrEqual(8);
        expect(built.doc.cast).toHaveLength(0);
        expect(built.doc.variables).toHaveLength(0);
        expect(Object.keys(built.doc.nodes)).toEqual(["start"]);
        expect(built.doc.edges).toHaveLength(0);
        expect(built.doc.meta.summary).toBe("");

        // Serialized .msk round-trips cleanly and contains zero Nightcord starter bleed
        expect(built.script).toContain("那年今日");
        expect(built.script).not.toContain("25时的未名余音");
        expect(built.script).not.toContain("宵崎奏");
        expect(built.script).not.toContain("v2_17kanade");

        const reparsed = parseStoryScript(built.script);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
            expect(reparsed.doc.meta.title).toBe("那年今日");
            expect(reparsed.doc.cast).toHaveLength(0);
            expect(Object.keys(reparsed.doc.nodes)).toEqual(["start"]);
        }

        // Calling twice produces distinct IDs
        const second = buildNewProjectDocument({ title: "那年今日", region: "jp", locale: "zh-CN" });
        expect(second.doc.id).not.toBe(built.doc.id);
    });

    it("explicitly opting into template='starter' still assigns a fresh unique id and requested title", () => {
        const built = buildNewProjectDocument({
            title: "自定义示例副本",
            region: "jp",
            locale: "zh-CN",
            template: "starter",
        });

        expect(built.doc.id).not.toBe("nightcord_unspoken_echo");
        expect(built.doc.meta.title).toBe("自定义示例副本");
        expect(built.doc.cast.length).toBeGreaterThan(0);
    });

    it("guards against silently overwriting an existing project folder and generates unique -2/-3 suffixes", () => {
        const userData = makeTempDir("moesekai-iso-ud-");
        const parentDir = makeTempDir("moesekai-iso-parent-");
        const ws = new WorkspaceManager({ userDataDir: userData });

        try {
            const firstDir = resolveUniqueProjectDir(parentDir, "那年今日");
            expect(path.basename(firstDir)).toBe("那年今日");

            const blank1 = buildNewProjectDocument({ title: "那年今日", region: "jp", locale: "zh-CN" });
            ws.createProject({
                dirPath: firstDir,
                title: "那年今日",
                region: "jp",
                initialScript: blank1.script,
            });

            // Direct createProject into an existing project folder without allowOverwrite MUST throw!
            expect(() =>
                ws.createProject({
                    dirPath: firstDir,
                    title: "那年今日",
                    region: "jp",
                    initialScript: blank1.script,
                }),
            ).toThrow(/already contains an existing MoeSekai project/i);

            // resolveUniqueProjectDir automatically picks -2 and -3 without touching the original folder
            const secondDir = resolveUniqueProjectDir(parentDir, "那年今日");
            expect(path.basename(secondDir)).toBe("那年今日-2");
            ws.createProject({
                dirPath: secondDir,
                title: "那年今日",
                region: "jp",
                initialScript: blank1.script,
            });

            const thirdDir = resolveUniqueProjectDir(parentDir, "那年今日");
            expect(path.basename(thirdDir)).toBe("那年今日-3");
        } finally {
            ws.dispose();
        }
    });

    it("enforces complete workspace & watcher isolation when switching from starter-demo (25时的未名余音) to blank '那年今日'", async () => {
        const userData = makeTempDir("moesekai-iso-ud2-");
        const root = makeTempDir("moesekai-iso-projects-");
        const ws = new WorkspaceManager({ userDataDir: userData, debounceMs: 40 });
        const observedExternalPaths: string[] = [];
        ws.onExternalChange(ev => observedExternalPaths.push(ev.mskFilePath));

        try {
            // 1. Open Project A (Nightcord starter demo) with snapshots & locales
            const starterBuilt = buildNewProjectDocument({
                title: "25时的未名余音",
                region: "jp",
                locale: "zh-CN",
                template: "starter",
            });
            const projA = ws.createProject({
                dirPath: path.join(root, "starter-demo"),
                title: "25时的未名余音",
                region: "jp",
                initialScript: starterBuilt.script,
                allowOverwrite: true,
            });
            ws.saveProject({
                script: starterBuilt.script,
                locales: { "en-US": { schema: "moesekai-story-i18n/1", locale: "en-US", beats: {} } },
                createSnapshotReason: "starter-edit",
            });
            expect(ws.listSnapshots().length).toBeGreaterThanOrEqual(1);

            // 2. Create & switch to blank Project B ('那年今日')
            const blankBuilt = buildNewProjectDocument({
                title: "那年今日",
                region: "jp",
                locale: "zh-CN",
                template: "blank",
            });
            const projB = ws.createProject({
                dirPath: path.join(root, "那年今日"),
                title: "那年今日",
                region: "jp",
                initialScript: blankBuilt.script,
            });

            expect(projB.id).not.toBe(projA.id);
            expect(projB.rootDir).not.toBe(projA.rootDir);
            expect(projB.script).toContain("那年今日");
            expect(projB.script).not.toContain("25时的未名余音");
            expect(projB.script).not.toContain("宵崎奏");
            expect(projB.snapshots).toHaveLength(0);
            expect(Object.keys(projB.locales)).toHaveLength(0);
            expect(projB.voiceManifest).toBeNull();

            const active = ws.getActiveProject();
            expect(active?.id).toBe(projB.id);
            expect(active?.script).toBe(blankBuilt.script);

            // 3. External edit on old Project A MUST NOT bleed into active Project B's watcher
            fs.appendFileSync(projA.mskFilePath, "\n# external-edit-on-old-project\n", "utf8");
            await new Promise(resolve => setTimeout(resolve, 140));
            expect(observedExternalPaths).toHaveLength(0);
            expect(ws.getActiveProject()?.id).toBe(projB.id);
        } finally {
            ws.dispose();
        }
    });

    it("resets the Agent worker session cleanly when switching from Project A to Project B", async () => {
        const dirA = makeTempDir("moesekai-agent-iso-a-");
        const dirB = makeTempDir("moesekai-agent-iso-b-");

        const starterA = buildNewProjectDocument({ title: "25时的未名余音", region: "jp", locale: "zh-CN", template: "starter" });
        const blankB = buildNewProjectDocument({ title: "那年今日", region: "jp", locale: "zh-CN", template: "blank" });
        fs.writeFileSync(path.join(dirA, "story.msk"), starterA.script, "utf8");
        fs.writeFileSync(path.join(dirB, "story.msk"), blankB.script, "utf8");

        const port = new MockParentPort();
        const detach = attachAgentWorkerPort(port);

        try {
            const initA = await port.request({
                id: "iso-1",
                type: "init",
                workspaceDir: dirA,
                storyFile: "story.msk",
                config: { mode: "sdk", provider: "anthropic", model: "claude-opus-5-5" },
            });
            expect(initA.kind === "response" && initA.ok).toBe(true);

            // Switch to Project B -> old session is disposed and brand-new session is bound strictly to dirB
            const initB = await port.request({
                id: "iso-2",
                type: "init",
                workspaceDir: dirB,
                storyFile: "story.msk",
                config: { mode: "sdk", provider: "anthropic", model: "claude-opus-5-5" },
            });
            expect(initB.kind === "response" && initB.ok).toBe(true);

            const stateB = await port.request({ id: "iso-3", type: "get_state" });
            expect(stateB.kind === "response" && stateB.ok).toBe(true);
            const dataB = stateB.kind === "response" && stateB.ok
                ? (stateB.data as { workspaceDir: string; pendingPlan: unknown; activeStage: unknown })
                : null;
            expect(path.resolve(dataB?.workspaceDir ?? "")).toBe(path.resolve(dirB));
            expect(dataB?.pendingPlan).toBeNull();
            expect(dataB?.activeStage).toBeNull();

            const snapsB = await port.request({ id: "iso-4", type: "list_snapshots" });
            expect(snapsB.kind === "response" && snapsB.ok).toBe(true);
            expect(snapsB.kind === "response" && snapsB.ok ? snapsB.data : null).toEqual([]);

            await port.request({ id: "iso-5", type: "dispose" });
            const stateAfterClose = await port.request({ id: "iso-6", type: "get_state" });
            expect(stateAfterClose.kind === "response" && stateAfterClose.ok && stateAfterClose.data).toBeNull();
        } finally {
            detach();
        }
    });
});
