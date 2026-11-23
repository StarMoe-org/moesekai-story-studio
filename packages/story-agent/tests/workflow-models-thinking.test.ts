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
    CURATED_FRONTIER_PROVIDERS,
    buildModeSystemInstructions,
    buildPresetPrompt,
    buildStoryAgentSystemPrompt,
    createStoryAgentSession,
    createStoryAgentWorkerHandler,
    createStoryMakerTools,
    fetchLiveProviderModels,
    listKnownProviders,
    resolveSdkModelRuntime,
    type StoryAgentEvent,
    type StoryAgentWorkerResponse,
    type StoryWorkflowPlan,
} from "../src/index";
import { writeStoryScript } from "../src/workspace";

const STARTER_MSK = `@story "Existing Starter" region=jp id="starter_existing"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
start -> scene_old
scene scene_old "Old Scene" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  cast set [
    ichika at center facial="face_smile_01"
  ]
  talk ichika "Unrelated starter line."
} -> end_old
end end_old "Old End"
`;

const NEW_CREATED_STORY_MSK = `@story "Rooftop Starlight" region=jp id="rooftop_starlight"
@cast kanade "Yoisaki Kanade" model="v2_17kanade_casual" char=17
@cast mafuyu "Asahina Mafuyu" model="v2_18mafuyu_casual" char=18

start -> scene_roof

scene scene_roof "Evening Rooftop" {
  bg set "bg_a000401"
  bgm play "bgm00020" vol=0.75
  place set "School Rooftop"
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]
  talk kanade "The wind feels quiet tonight." motion="w-normal01-nod" facial="face_smile_01"
  talk mafuyu "...Yeah. Let's stay a little longer." motion="w-cool01-nod" facial="face_normal_01"
} -> end_starlight

end end_starlight "Under the Stars" subtitle="A calm rooftop moment."
`;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "moesekai-agent-upgrade-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("2026 frontier models & live /models discovery", () => {
    test("prioritizes late-2026 frontier models at top of Anthropic, OpenAI, and Google catalogs", async () => {
        const providers = await listKnownProviders();
        const anthropic = providers.find((p) => p.id === "anthropic");
        const openai = providers.find((p) => p.id === "openai");
        const google = providers.find((p) => p.id === "google");

        expect(anthropic?.defaultModel).toBe("claude-opus-5-5");
        expect(anthropic?.sampleModels.slice(0, 6).map((m) => m.id)).toEqual([
            "claude-opus-5-5",
            "claude-sonnet-5-5",
            "claude-haiku-5-5",
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-opus-4-8",
        ]);

        expect(openai?.defaultModel).toBe("gpt-6.2-astra");
        expect(openai?.sampleModels.slice(0, 7).map((m) => m.id)).toEqual([
            "gpt-6.2-astra",
            "gpt-6.2-sol",
            "gpt-6.1-terra",
            "gpt-6-luna",
            "gpt-5.6-sol",
            "gpt-5.5",
            "gpt-5",
        ]);

        expect(google?.defaultModel).toBe("gemini-4-carbon");
        expect(google?.sampleModels.slice(0, 5).map((m) => m.id)).toEqual([
            "gemini-4-carbon",
            "gemini-4-neon",
            "gemini-4-argon",
            "gemini-4-hydrogen",
            "gemini-3.8-flash",
        ]);

        // Default model selection in resolveSdkModelRuntime picks frontier defaults (never legacy gpt-4 / gemini-2.5)
        const resolvedAnthropic = await resolveSdkModelRuntime({ mode: "sdk", provider: "anthropic", apiKey: "sk-ant" });
        const resolvedOpenAI = await resolveSdkModelRuntime({ mode: "sdk", provider: "openai", apiKey: "sk-oai" });
        const resolvedGoogle = await resolveSdkModelRuntime({ mode: "sdk", provider: "google", apiKey: "sk-goog" });
        expect(resolvedAnthropic.model.id).toBe("claude-opus-5-5");
        expect(resolvedOpenAI.model.id).toBe("gpt-6.2-astra");
        expect(resolvedGoogle.model.id).toBe("gemini-4-carbon");
        expect(CURATED_FRONTIER_PROVIDERS.openrouter.defaultModel).toBe("anthropic/claude-opus-5.5");
    });

    test("fetches live /models for OpenAI, Anthropic, and Google Gemini with graceful catalog fallback", async () => {
        const seenRequests: Array<{ url: string; headers: Record<string, string> }> = [];
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const headers = (init?.headers ?? {}) as Record<string, string>;
            seenRequests.push({ url, headers });

            if (url === "https://api.openai.com/v1/models") {
                return new Response(
                    JSON.stringify({
                        data: [
                            { id: "text-embedding-3-large" },
                            { id: "gpt-6.2-sol" },
                            { id: "gpt-6.2-astra" },
                            { id: "gpt-custom-preview" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://api.anthropic.com/v1/models") {
                return new Response(
                    JSON.stringify({
                        data: [
                            { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
                            { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url.startsWith("https://generativelanguage.googleapis.com/v1beta/models?key=gem-key-1")) {
                return new Response(
                    JSON.stringify({
                        models: [
                            {
                                name: "models/gemini-4-neon",
                                displayName: "Gemini 4 Neon",
                                supportedGenerationMethods: ["generateContent"],
                                inputTokenLimit: 1_048_576,
                            },
                            {
                                name: "models/gemini-4-carbon",
                                displayName: "Gemini 4 Carbon",
                                supportedGenerationMethods: ["generateContent"],
                                inputTokenLimit: 1_048_576,
                            },
                            {
                                name: "models/text-embedding-005",
                                displayName: "Embedding",
                                supportedGenerationMethods: ["embedContent"],
                            },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return new Response("Unauthorized", { status: 401 });
        }) as typeof fetch;

        // OpenAI
        const oai = await fetchLiveProviderModels(
            { provider: "openai", apiKey: "sk-oai-live" },
            { fetchImpl: mockFetch },
        );
        expect(oai.ok).toBe(true);
        expect(oai.source).toBe("live");
        expect(oai.models.map((m) => m.id)).toEqual(["gpt-6.2-astra", "gpt-6.2-sol", "gpt-custom-preview"]);
        expect(oai.models[0].supportsThinking).toBe(true);
        expect(seenRequests[0].headers.Authorization).toBe("Bearer sk-oai-live");

        // Anthropic
        const ant = await fetchLiveProviderModels(
            { provider: "anthropic", apiKey: "sk-ant-live" },
            { fetchImpl: mockFetch },
        );
        expect(ant.ok).toBe(true);
        expect(ant.source).toBe("live");
        expect(ant.models.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
        expect(seenRequests[1].headers["x-api-key"]).toBe("sk-ant-live");
        expect(seenRequests[1].headers["anthropic-version"]).toBe("2023-06-01");

        // Google Gemini
        const gem = await fetchLiveProviderModels(
            { provider: "google", apiKey: "gem-key-1" },
            { fetchImpl: mockFetch },
        );
        expect(gem.ok).toBe(true);
        expect(gem.source).toBe("live");
        expect(gem.models.map((m) => m.id)).toEqual(["gemini-4-carbon", "gemini-4-neon"]);

        // Graceful fallback to curated catalog on HTTP 401
        const failRes = await fetchLiveProviderModels(
            { provider: "openai", baseUrl: "https://fail.example.invalid/v1", apiKey: "bad-key" },
            { fetchImpl: mockFetch },
        );
        expect(failRes.ok).toBe(false);
        expect(failRes.source).toBe("catalog");
        expect(failRes.models[0].id).toBe("gpt-6.2-astra");
        expect(failRes.error).toContain("HTTP 401");
    });
});

describe("thinkingLevel propagation, create vs edit prompts & zero user-facing 'Pi' wording", () => {
    test("propagates default 'medium' and live setThinkingLevel('high') to Pi SDK requests", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(dir, "story.msk", STARTER_MSK);

        const observedReasonings: Array<string | undefined> = [];
        const faux = fauxProvider({
            provider: "faux-thinking",
            models: [{ id: "faux-think-1", name: "Faux Think", reasoning: true, contextWindow: 128_000, maxTokens: 8192 }],
        });
        faux.setResponses([
            (_ctx, options) => {
                observedReasonings.push(options?.reasoning);
                return fauxAssistantMessage([fauxThinking("Medium thought"), fauxText("First turn done.")]);
            },
            (_ctx, options) => {
                observedReasonings.push(options?.reasoning);
                return fauxAssistantMessage([fauxThinking("High thought"), fauxText("Second turn done.")]);
            },
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: {
                mode: "sdk",
                provider: "faux-thinking",
                model: "faux-think-1",
                authoringMode: "edit",
                planFirst: false,
            },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        expect(controller.getState().thinkingLevel).toBe("medium");
        await controller.prompt("First check");
        expect(observedReasonings[0]).toBe("medium");

        await controller.setThinkingLevel("high");
        expect(controller.getState().thinkingLevel).toBe("high");
        await controller.prompt("Second deep check");
        expect(observedReasonings[1]).toBe("high");

        await controller.dispose();
    });

    test("builds distinct create vs edit prompts with zero user-facing 'Pi' references", () => {
        const createPrompt = buildStoryAgentSystemPrompt("create", true);
        const editPrompt = buildStoryAgentSystemPrompt("edit", false);

        expect(createPrompt).toContain("CREATE FROM SCRATCH");
        expect(createPrompt).toContain("IGNORE any unrelated starter/existing scenes");
        expect(createPrompt).toContain("story_submit_plan");
        expect(createPrompt).toContain("story_mine_official");
        expect(createPrompt).toContain("story_report_stage");

        expect(editPrompt).toContain("SURGICAL EDIT");
        expect(editPrompt).toContain("story_read_workspace");
        expect(editPrompt).toContain("story_patch_msk");
        expect(buildModeSystemInstructions("edit", true)).toContain("story_submit_plan");

        // Zero user-facing "Pi" mentions in prompts, presets, or tool labels/descriptions
        const uiStrings: string[] = [
            createPrompt,
            editPrompt,
            buildPresetPrompt("author_story"),
            buildPresetPrompt("fix_validation_issues"),
            buildPresetPrompt("translate_story"),
            buildPresetPrompt("prepare_tts_manifest"),
        ];
        const tools = createStoryMakerTools({
            getWorkspaceDir: () => tmpdir(),
            getStoryFile: () => "story.msk",
        });
        for (const t of tools) {
            uiStrings.push(t.label, t.description, t.promptSnippet ?? "");
        }
        for (const text of uiStrings) {
            expect(text).not.toMatch(/\bPi\b/);
        }
    });
});

describe("staged workflow: story_report_stage, story_submit_plan & approvePlan gate", () => {
    test("halts before .msk mutation on plan_proposed, blocks unapproved writes, then executes full workflow on approvePlan", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(dir, "story.msk", STARTER_MSK);

        const mockFetch = (async (input: string | URL | Request) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/jp/live2d/model/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_17kanade_casual", "v2_18mafuyu_casual"],
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
                        directories: ["v2_17kanade_motion_base", "v2_18mafuyu_motion_base"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const faux = fauxProvider({
            provider: "faux-plan-gate",
            models: [{ id: "faux-plan", name: "Faux Plan", reasoning: true, contextWindow: 128_000, maxTokens: 8192 }],
        });

        faux.setResponses([
            // Phase 1 (before approval): report outline -> submit plan (terminate:true halts loop immediately!)
            fauxAssistantMessage([
                fauxToolCall("story_report_stage", {
                    mode: "create",
                    stage: "outline",
                    status: "active",
                    label: "大纲",
                }),
                fauxToolCall("story_submit_plan", {
                    mode: "create",
                    title: "Rooftop Starlight",
                    region: "jp",
                    premise: "Kanade and Mafuyu share a quiet evening on the school rooftop.",
                    castPlan: [
                        { key: "kanade", name: "Yoisaki Kanade", charId: 17 },
                        { key: "mafuyu", name: "Asahina Mafuyu", charId: 18 },
                    ],
                    scenes: [
                        { id: "scene_roof", title: "Evening Rooftop", summary: "Quiet rooftop conversation under stars." },
                    ],
                    branches: ["Linear emotional scene"],
                    endings: [{ id: "end_starlight", title: "Under the Stars" }],
                    researchTargets: ["25ji v2_ casual models & rooftop BGs"],
                }),
            ]),
            // Phase 2 (after approvePlan): research -> author -> verify -> done!
            fauxAssistantMessage([
                fauxToolCall("story_report_stage", { mode: "create", stage: "outline", status: "completed" }),
                fauxToolCall("story_report_stage", { mode: "create", stage: "research", status: "active" }),
                fauxToolCall("story_mine_official", {
                    action: "catalog",
                    subkind: "models",
                    char: "kanade,mafuyu",
                    v2Only: true,
                    region: "jp",
                }),
            ]),
            fauxAssistantMessage([
                fauxToolCall("story_report_stage", { mode: "create", stage: "research", status: "completed" }),
                fauxToolCall("story_report_stage", { mode: "create", stage: "author", status: "active" }),
                fauxToolCall("story_write_msk", {
                    script: NEW_CREATED_STORY_MSK,
                    reason: "author approved Rooftop Starlight story",
                }),
            ]),
            fauxAssistantMessage([
                fauxToolCall("story_report_stage", { mode: "create", stage: "author", status: "completed" }),
                fauxToolCall("story_report_stage", { mode: "create", stage: "verify", status: "active" }),
                fauxToolCall("story_validate_and_simulate", { strict: true, simulate: true, verifyAssets: false }),
            ]),
            fauxAssistantMessage([
                fauxToolCall("story_report_stage", { mode: "create", stage: "verify", status: "completed" }),
                fauxText("Rooftop Starlight created and verified with 0 errors and 0 warnings."),
            ]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: {
                mode: "sdk",
                provider: "faux-plan-gate",
                model: "faux-plan",
                authoringMode: "create",
                planFirst: true,
            },
            fetchImpl: mockFetch,
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));

        // 1. User requests a brand new story with planFirst=true
        await controller.prompt("Write a quiet Kanade & Mafuyu rooftop story from scratch.");

        const proposedEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "plan_proposed" }> => e.type === "plan_proposed",
        );
        expect(proposedEv).toBeDefined();
        expect(proposedEv?.awaitingApproval).toBe(true);
        expect(proposedEv?.plan.title).toBe("Rooftop Starlight");
        expect(proposedEv?.plan.status).toBe("pending_approval");
        expect(controller.getState().pendingPlan?.id).toBe(proposedEv?.plan.id);

        // Verify story.msk was NOT modified before approval!
        const beforeApproveDisk = await readFile(join(dir, "story.msk"), "utf8");
        expect(beforeApproveDisk).toContain("Existing Starter");
        expect(events.some((e) => e.type === "msk_diff")).toBe(false);

        // 2. User approves the plan -> executes research, author, verify!
        await controller.approvePlan(proposedEv!.plan.id, "Looks great, proceed!");

        const resolvedEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "plan_resolved" }> => e.type === "plan_resolved",
        );
        expect(resolvedEv?.decision).toBe("approved");
        expect(resolvedEv?.planId).toBe(proposedEv!.plan.id);
        expect(controller.getState().pendingPlan).toBeNull();

        const stageEvents = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "workflow_stage" }> => e.type === "workflow_stage",
        );
        expect(stageEvents.map((s) => `${s.stage}:${s.status}`)).toEqual([
            "outline:active",
            "outline:completed",
            "research:active",
            "research:completed",
            "author:active",
            "author:completed",
            "verify:active",
            "verify:completed",
        ]);

        // Verify story.msk now holds the newly authored story and snapshot preserved the old starter!
        const afterApproveDisk = await readFile(join(dir, "story.msk"), "utf8");
        expect(afterApproveDisk).toContain("Rooftop Starlight");
        expect(events.some((e) => e.type === "snapshot_created")).toBe(true);
        expect(events.some((e) => e.type === "msk_diff")).toBe(true);

        await controller.dispose();
    });

    test("hard mutation guard blocks story_write_msk when planFirst=true before approval", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(dir, "story.msk", STARTER_MSK);

        const faux = fauxProvider({
            provider: "faux-guard",
            models: [{ id: "faux-g", name: "Faux Guard", reasoning: false, contextWindow: 64_000, maxTokens: 4096 }],
        });
        faux.setResponses([
            // Misbehaving model attempts to write without submitting/approving plan first
            fauxAssistantMessage([
                fauxToolCall("story_write_msk", { script: NEW_CREATED_STORY_MSK, reason: "skip plan" }),
            ]),
            fauxAssistantMessage([fauxText("Understood, I will submit a plan first.")]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: {
                mode: "sdk",
                provider: "faux-guard",
                model: "faux-g",
                authoringMode: "create",
                planFirst: true,
            },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));
        await controller.prompt("Create a new story.");

        const writeEnd = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "tool_end" }> =>
                e.type === "tool_end" && e.toolName === "story_write_msk",
        );
        expect(writeEnd?.isError).toBe(true);
        expect(writeEnd?.summary).toContain("Blocked");

        const diskAfter = await readFile(join(dir, "story.msk"), "utf8");
        expect(diskAfter).toContain("Existing Starter");
        await controller.dispose();
    });

    test("worker IPC handles set_thinking_level, set_authoring_mode, set_plan_first, fetch_models, and approve_plan", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(dir, "story.msk", STARTER_MSK);

        const mockFetch = (async () =>
            new Response(JSON.stringify({ data: [{ id: "gpt-6.2-astra" }] }), { status: 200 })) as unknown as typeof fetch;

        const faux = fauxProvider({
            provider: "faux-ipc",
            models: [{ id: "faux-ipc-1", name: "Faux IPC", reasoning: true, contextWindow: 128_000, maxTokens: 4096 }],
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("story_submit_plan", {
                    mode: "create",
                    title: "IPC Plan",
                    premise: "Test plan via worker IPC",
                    castPlan: [{ key: "kanade", name: "Kanade", charId: 17 }],
                    scenes: [{ id: "scene_1", title: "Open", summary: "Start" }],
                    branches: [],
                    endings: [{ id: "end_1", title: "End" }],
                    researchTargets: ["25ji"],
                }),
            ]),
            fauxAssistantMessage([fauxText("Approved plan executed.")]),
        ]);

        const responses: StoryAgentWorkerResponse[] = [];
        const handler = createStoryAgentWorkerHandler((msg) => responses.push(msg), {
            fetchImpl: mockFetch,
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        await handler.handleRequest({
            id: "1",
            type: "init",
            options: {
                workspaceDir: dir,
                storyFile: "story.msk",
                config: { mode: "sdk", provider: "openai", model: "gpt-6.2-astra", apiKey: "sk-test" },
            },
        });
        await handler.handleRequest({ id: "2", type: "set_thinking_level", thinkingLevel: "xhigh" });
        await handler.handleRequest({ id: "3", type: "set_authoring_mode", authoringMode: "create" });
        await handler.handleRequest({ id: "4", type: "set_plan_first", planFirst: true });
        await handler.handleRequest({ id: "5", type: "fetch_models", config: { provider: "openai", apiKey: "sk-test" } });
        await handler.handleRequest({ id: "6", type: "prompt", text: "Plan a story" });

        const proposedEvent = responses.find(
            (r): r is Extract<StoryAgentWorkerResponse, { type: "event" }> =>
                r.type === "event" && r.event.type === "plan_proposed",
        );
        expect(proposedEvent).toBeDefined();
        const plan = (proposedEvent?.event as Extract<StoryAgentEvent, { type: "plan_proposed" }>).plan as StoryWorkflowPlan;

        await handler.handleRequest({ id: "7", type: "approve_plan", planId: plan.id });
        await handler.handleRequest({ id: "8", type: "dispose" });

        const replies = responses.filter(
            (r): r is Extract<StoryAgentWorkerResponse, { type: "reply" }> => r.type === "reply",
        );
        expect(replies.map((r) => [r.id, r.ok])).toEqual([
            ["1", true],
            ["2", true],
            ["3", true],
            ["4", true],
            ["5", true],
            ["6", true],
            ["7", true],
            ["8", true],
        ]);
        const fetchReply = replies.find((r) => r.id === "5");
        expect(fetchReply?.ok).toBe(true);
        if (fetchReply && fetchReply.ok) {
            expect((fetchReply.data as { source: string; models: Array<{ id: string }> }).source).toBe("live");
            expect((fetchReply.data as { models: Array<{ id: string }> }).models[0].id).toBe("gpt-6.2-astra");
        }
    });
});
