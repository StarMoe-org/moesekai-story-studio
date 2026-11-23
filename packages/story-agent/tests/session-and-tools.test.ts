import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxThinking,
    fauxToolCall,
} from "@earendil-works/pi-ai";
import {
    buildPresetPrompt,
    createStoryAgentSession,
    createStoryAgentWorkerHandler,
    listKnownPiProviders,
    resolveDefaultSkillPath,
    resolveSdkModelRuntime,
    type StoryAgentEvent,
    type StoryAgentWorkerResponse,
} from "../src/index";

const INITIAL_STORY = `@story "Starter" region=jp id="starter"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
start -> scene_1
scene scene_1 "Open" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  cast set [
    ichika at center facial="face_smile_01"
  ]
  talk ichika "Hello!"
} -> end_1
end end_1 "Done"
`;

const DRAFT_WITH_WARNING = `@story "Two Paths" region=jp id="two_paths"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
@cast saki "Saki" model="v2_02saki_casual" char=2

start -> choice_start

choice choice_start "Choose" {
  opt_a: "Path A" -> scene_merge
  opt_b: "Path B" -> scene_merge
}

scene scene_merge "Converge" {
  bg inherit
  bgm stop
  place set "Classroom"
  cast set [
    ichika at left
    saki at right
  ]
  talk ichika "We met up!"
} -> end_done

end end_done "Complete"
`;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "moesekai-agent-session-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("Pi SDK session controller, streaming events & worker IPC", () => {
    test("lists real built-in Pi providers and resolves monorepo SKILL.md", async () => {
        const providers = await listKnownPiProviders();
        const ids = providers.map((p) => p.id);
        expect(ids).toContain("anthropic");
        expect(ids).toContain("openai");
        expect(ids).toContain("google");
        expect(ids).toContain("openrouter");

        const skillPath = resolveDefaultSkillPath();
        expect(skillPath).toBeDefined();
        expect(skillPath).toContain("moesekai-story-script");
    });

    test("resolves built-in and custom baseUrl providers in Pi ModelRuntime", async () => {
        const customOpenAi = await resolveSdkModelRuntime({
            mode: "sdk",
            provider: "custom",
            model: "qwen3-coder-plus",
            baseUrl: "https://compat.example.invalid/v1",
            apiKey: "sk-test-123",
        });
        expect(customOpenAi.model.id).toBe("qwen3-coder-plus");
        expect(customOpenAi.model.api).toBe("openai-completions");
        expect(customOpenAi.model.baseUrl).toBe("https://compat.example.invalid/v1");

        const customAnthropic = await resolveSdkModelRuntime({
            mode: "sdk",
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            baseUrl: "https://claude-proxy.example.invalid",
            apiKey: "sk-ant-test",
        });
        expect(customAnthropic.model.api).toBe("anthropic-messages");
        expect(customAnthropic.model.baseUrl).toBe("https://claude-proxy.example.invalid");

        const builtinOpenRouter = await resolveSdkModelRuntime({
            mode: "sdk",
            provider: "openrouter",
            apiKey: "sk-or-test",
        });
        expect(builtinOpenRouter.model.provider).toBe("openrouter");
        expect(builtinOpenRouter.modelRuntime.hasConfiguredAuth("openrouter")).toBe(true);
    });

    test("exercises story_mine_official, story_i18n_prepare/apply, and all story_editor_action kinds via Pi SDK", async () => {
        const dir = await makeTempDir();
        const { writeStoryScript } = await import("../src/workspace");
        await writeStoryScript(dir, "story.msk", INITIAL_STORY);

        const mockFetch = (async (input: string | URL | Request) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/jp/live2d/model/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_01ichika_casual"],
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
                        directories: ["v2_01ichika_motion_base"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const faux = fauxProvider({
            provider: "faux-all-tools",
            models: [{ id: "faux-all", name: "Faux All Tools", reasoning: false, contextWindow: 128000, maxTokens: 4096 }],
        });

        let capturedBeatId = "";
        let capturedSrcHash = "";

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("story_mine_official", {
                    action: "catalog",
                    subkind: "models",
                    char: "ichika",
                    v2Only: true,
                    region: "jp",
                }),
                fauxToolCall("story_i18n_prepare", { mode: "translate", targetLocale: "ja-JP" }),
                fauxToolCall("story_i18n_prepare", { mode: "tts", targetLocale: "ja-JP" }),
            ]),
            (context) => {
                // Inspect the tool result from story_i18n_prepare to grab exact beatId & srcHash
                for (const msg of context.messages) {
                    if (msg.role === "toolResult" && msg.toolName === "story_i18n_prepare") {
                        const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
                        const m = /"([A-Za-z0-9_-]+)"\s*:\s*\{\s*"srcHash"\s*:\s*"([0-9a-f]+)"/.exec(text);
                        if (m) {
                            capturedBeatId = m[1];
                            capturedSrcHash = m[2];
                            break;
                        }
                    }
                }
                return fauxAssistantMessage([
                    fauxToolCall("story_i18n_apply", {
                        mode: "locale_pack",
                        targetLocale: "ja-JP",
                        rawJson: JSON.stringify({
                            schema: "moesekai-story-i18n/1",
                            storyId: "starter",
                            locale: "ja-JP",
                            translationMeta: { origin: "ai_raw" },
                            beats: {
                                [capturedBeatId]: { srcHash: capturedSrcHash, body: "こんにちは！" },
                            },
                        }),
                    }),
                    fauxToolCall("story_editor_action", { kind: "switch_mode", mode: "playtest" }),
                    fauxToolCall("story_editor_action", { kind: "playtest_from_node", nodeId: "scene_1" }),
                    fauxToolCall("story_editor_action", { kind: "open_export_dialog", format: "msk" }),
                ]);
            },
            fauxAssistantMessage([fauxText("Mined models, translated to ja-JP, and opened playtest/export.")]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-all-tools", model: "faux-all" },
            fetchImpl: mockFetch,
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));
        await controller.prompt("Mine Ichika models, translate to ja-JP, and trigger editor actions.");

        expect(capturedBeatId).not.toBe("");
        const toolEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "tool_end" }> => e.type === "tool_end",
        );
        expect(toolEnds.every((t) => !t.isError)).toBe(true);
        expect(toolEnds.map((t) => t.toolName)).toContain("story_mine_official");
        expect(toolEnds.map((t) => t.toolName)).toContain("story_i18n_prepare");
        expect(toolEnds.map((t) => t.toolName)).toContain("story_i18n_apply");

        const actions = events
            .filter((e): e is Extract<StoryAgentEvent, { type: "editor_action" }> => e.type === "editor_action")
            .map((e) => e.action.kind);
        expect(actions).toEqual(["switch_mode", "playtest_from_node", "open_export_dialog"]);

        const savedJa = await readFile(join(dir, "locales", "ja-JP.i18n.json"), "utf8");
        expect(savedJa).toContain("こんにちは！");

        await controller.dispose();
    });

    test("streams full multi-turn Pi SDK self-heal loop + editor action + snapshot rollback offline", async () => {
        const dir = await makeTempDir();

        // Seed initial workspace story
        const { writeStoryScript } = await import("../src/workspace");
        await writeStoryScript(dir, "story.msk", INITIAL_STORY);

        const faux = fauxProvider({
            provider: "faux-story-test",
            models: [{ id: "faux-model", name: "Faux Story Model", reasoning: true, contextWindow: 128000, maxTokens: 8192 }],
        });

        faux.setResponses([
            // Turn 1: think + read workspace
            fauxAssistantMessage([
                fauxThinking("Let me read the workspace first."),
                fauxToolCall("story_read_workspace", { includeScript: true }),
            ]),
            // Turn 2: write a draft with mergeNodeInheritAmbiguous warning
            fauxAssistantMessage([
                fauxToolCall("story_write_msk", {
                    script: DRAFT_WITH_WARNING,
                    reason: "write branching draft",
                }),
            ]),
            // Turn 3: validate strictly -> catches mergeNodeInheritAmbiguous
            fauxAssistantMessage([
                fauxToolCall("story_validate_and_simulate", { strict: true, simulate: true, verifyAssets: false }),
            ]),
            // Turn 4: self-heal via story_patch_msk
            fauxAssistantMessage([
                fauxToolCall("story_patch_msk", {
                    edits: [{ find: "  bg inherit", replace: '  bg set "bg_a000401"' }],
                    reason: "fix mergeNodeInheritAmbiguous",
                }),
            ]),
            // Turn 5: re-validate + focus node in editor UI
            fauxAssistantMessage([
                fauxToolCall("story_validate_and_simulate", { strict: true, simulate: true, verifyAssets: false }),
                fauxToolCall("story_editor_action", { kind: "focus_node", nodeId: "scene_merge" }),
            ]),
            // Turn 6: final answer
            fauxAssistantMessage([
                fauxText("Story updated, validated with 0 errors and 0 warnings, and focused on scene_merge."),
            ]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-story-test", model: "faux-model" },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        const unsub = controller.subscribe((ev) => events.push(ev));

        await controller.prompt("Upgrade the starter story into a two-path branching scene.", {
            selectedNodeId: "scene_1",
            activeMode: "flow",
        });

        const types = events.map((e) => e.type);
        expect(types).toContain("status");
        expect(types).toContain("thinking_delta");
        expect(types).toContain("tool_start");
        expect(types).toContain("tool_end");
        expect(types).toContain("snapshot_created");
        expect(types).toContain("msk_diff");
        expect(types).toContain("editor_action");
        expect(types).toContain("text_delta");
        expect(types).toContain("done");

        const thinkingText = events
            .filter((e): e is Extract<StoryAgentEvent, { type: "thinking_delta" }> => e.type === "thinking_delta")
            .map((e) => e.delta)
            .join("");
        expect(thinkingText).toContain("read the workspace");

        const finalDone = events.find((e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done");
        expect(finalDone?.aborted).toBe(false);
        expect(finalDone?.finalText).toContain("0 errors and 0 warnings");
        expect(finalDone?.stats?.toolCalls).toBe(6);

        const editorEvents = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "editor_action" }> => e.type === "editor_action",
        );
        expect(editorEvents).toHaveLength(1);
        expect(editorEvents[0].action).toEqual({ kind: "focus_node", nodeId: "scene_merge" });

        // Verify the final validate tool returned strictOk === true
        const validateEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "tool_end" }> =>
                e.type === "tool_end" && e.toolName === "story_validate_and_simulate",
        );
        expect(validateEnds).toHaveLength(2);
        expect((validateEnds[0].details as { strictOk: boolean }).strictOk).toBe(false);
        expect((validateEnds[1].details as { strictOk: boolean }).strictOk).toBe(true);

        // Verify rollback restores initial story and emits msk_diff
        const snapshots = await controller.listSnapshots();
        expect(snapshots.length).toBe(2);
        const oldestSnapshot = snapshots[snapshots.length - 1];
        const rollbackRes = await controller.rollbackToSnapshot(oldestSnapshot.id);
        expect(rollbackRes.ok).toBe(true);
        const restored = await readFile(join(dir, "story.msk"), "utf8");
        expect(restored).toContain('@story "Starter"');

        unsub();
        await controller.dispose();
    });

    test("utilityProcess worker handler processes init, run_preset, list_snapshots & dispose", async () => {
        const dir = await makeTempDir();
        const { writeStoryScript } = await import("../src/workspace");
        await writeStoryScript(dir, "story.msk", INITIAL_STORY);

        const faux = fauxProvider({
            provider: "faux-worker-test",
            models: [{ id: "faux-w", name: "Faux Worker", reasoning: false, contextWindow: 64000, maxTokens: 4096 }],
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("story_validate_and_simulate", { strict: true, simulate: true, verifyAssets: false }),
            ]),
            fauxAssistantMessage([fauxText("Preset validation complete: all green.")]),
        ]);

        const responses: StoryAgentWorkerResponse[] = [];
        const handler = createStoryAgentWorkerHandler((msg) => responses.push(msg), {
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        await handler.handleRequest({
            id: "1",
            type: "init",
            options: {
                workspaceDir: dir,
                storyFile: "story.msk",
                config: { mode: "sdk", provider: "faux-worker-test", model: "faux-w" },
            },
        });
        await handler.handleRequest({
            id: "2",
            type: "run_preset",
            preset: "fix_validation_issues",
            options: { verifyAssets: false },
        });
        await handler.handleRequest({ id: "3", type: "get_state" });
        await handler.handleRequest({ id: "4", type: "dispose" });

        const replies = responses.filter(
            (r): r is Extract<StoryAgentWorkerResponse, { type: "reply" }> => r.type === "reply",
        );
        expect(replies.map((r) => [r.id, r.ok])).toEqual([
            ["1", true],
            ["2", true],
            ["3", true],
            ["4", true],
        ]);
        const streamedEvents = responses.filter((r) => r.type === "event");
        expect(streamedEvents.some((e) => e.type === "event" && e.event.type === "done")).toBe(true);

        // Sanity-check presets avoid mentioning discontinued free TTS
        for (const presetId of ["author_story", "fix_validation_issues", "translate_story", "prepare_tts_manifest"] as const) {
            const p = buildPresetPrompt(presetId);
            expect(p.toLowerCase()).not.toContain("free tts");
        }
    });
});
