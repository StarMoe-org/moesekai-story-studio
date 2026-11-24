import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStoryScript, serializeStoryScript } from "@moesekai/story-core";
import { mergeIncomingStoryDoc } from "@moesekai/story-editor";
import { WorkspaceManager } from "../src/main/workspace.ts";
import {
    DESKTOP_MESSAGES,
    formatDesktopMessage,
} from "../src/renderer/i18n/desktopMessages.ts";
import type { DesktopUiLocale } from "../src/shared/ipc.ts";

const ALL_LOCALES: DesktopUiLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
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

describe("Desktop Save Persistence & Code-Edit Reopen Integrity", () => {
    it("persists edited .msk scripts with omitted or foreign header id across workspace close & reopen", () => {
        const userData = makeTempDir("moesekai-save-ud-");
        const projectDir = path.join(makeTempDir("moesekai-save-proj-"), "wish-story");
        const ws = new WorkspaceManager({ userDataDir: userData, debounceMs: 40 });

        try {
            const initialScript = `@story "心愿，即成剧！五团领队与未来之星" region=jp id="starter_v2"

start -> s1

scene s1 "开场" {
  bg clear
  bgm stop
  place hide
  transition fadeBlack 0.5
  cast clear
  talk "花里实乃理" "初版台词"
}
`;
            const opened = ws.createProject({
                dirPath: projectDir,
                title: "心愿，即成剧！五团领队与未来之星",
                region: "jp",
                initialScript,
            });
            expect(opened.id.startsWith("proj_")).toBe(true);

            // Simulate desktop parseProjectDoc attaching workspace project id
            const initialParsed = parseStoryScript(opened.script);
            expect(initialParsed.ok).toBe(true);
            if (!initialParsed.ok) return;
            const activeDoc = { ...initialParsed.doc, id: opened.id };

            // Simulate user directly editing code in Code mode and removing/changing `id=...`
            const editedCode = `@story "心愿，即成剧！五团领队与未来之星" region=jp

start -> s1

scene s1 "华丽谢幕" {
  bg clear
  bgm stop
  place set "舞台的「世界」·华丽谢幕"
  transition fadeBlack 0.5
  cast clear
  talk "花里实乃理" "我们都在期待着大家的精彩原创故事哦！下次见啦！"
}
`;
            const editedParsed = parseStoryScript(editedCode);
            expect(editedParsed.ok).toBe(true);
            if (!editedParsed.ok) return;

            // Merged doc preserves workspace project id instead of adopting a random parsed id
            const merged = mergeIncomingStoryDoc(activeDoc, editedParsed.doc, { preserveLocales: true });
            expect(merged.id).toBe(opened.id);

            const serialized = serializeStoryScript(merged);
            const saved = ws.saveProject({ script: serialized });
            expect(saved.bytesWritten).toBeGreaterThan(0);

            // Close and reopen workspace (simulating restarting the desktop app)
            ws.closeProject();
            const reopened = ws.openProject(projectDir);
            expect(reopened.id).toBe(opened.id);
            expect(reopened.script).toContain("华丽谢幕");
            expect(reopened.script).toContain("我们都在期待着大家的精彩原创故事哦！下次见啦！");
            expect(reopened.script).toContain(`id="${opened.id}"`);
        } finally {
            ws.dispose();
        }
    });

    it("provides localized saveFailed labels across all 5 desktop locales with matching key sets", () => {
        const baseKeys = Object.keys(DESKTOP_MESSAGES["zh-CN"]).sort();
        for (const locale of ALL_LOCALES) {
            expect(Object.keys(DESKTOP_MESSAGES[locale]).sort()).toEqual(baseKeys);
            const label = formatDesktopMessage(locale, "saveFailed");
            expect(label.trim().length).toBeGreaterThan(0);
            expect(label).not.toBe(formatDesktopMessage(locale, "saved"));
        }
    });
});
