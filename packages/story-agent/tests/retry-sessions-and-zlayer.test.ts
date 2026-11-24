import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
    buildStoryAgentSystemPrompt,
    createStoryAgentSession,
    createStoryAgentWorkerHandler,
    createStoryMakerTools,
    extractTransientErrorCode,
    isTransientNetworkError,
    type StoryAgentEvent,
    type StoryAgentResumedSession,
    type StoryAgentSessionSummary,
    type StoryAgentWorkerResponse,
    validateAndSimulateStory,
} from "../src/index";
import { patchStoryScript, readStoryWorkspace, writeStoryScript } from "../src/workspace";
import { createNodeWorkspaceFiles } from "../src/node";

const STARTER_MSK = `@story "Starter" region=jp id="starter"
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

const tempDirs: string[] = [];

async function makeTempDir(prefix = "moesekai-agent-r2-"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("Auto-retry events & transient network timeout recovery (#100)", () => {
    test("classifies transient network/HTTP errors vs non-retryable auth/quota/abort errors", () => {
        const connectTimeout =
            "Request timed out.: Connect Timeout Error (attempted address: www.autodl.art:443, timeout: 10000ms) (UND_ERR_CONNECT_TIMEOUT)";
        expect(isTransientNetworkError(connectTimeout)).toBe(true);
        expect(extractTransientErrorCode(connectTimeout)).toBe("UND_ERR_CONNECT_TIMEOUT");

        expect(isTransientNetworkError("read ECONNRESET")).toBe(true);
        expect(extractTransientErrorCode("read ECONNRESET")).toBe("ECONNRESET");

        expect(isTransientNetworkError("write EPIPE")).toBe(true);
        expect(isTransientNetworkError("fetch failed")).toBe(true);
        expect(isTransientNetworkError("HTTP 503 Service Temporarily Unavailable")).toBe(true);
        expect(extractTransientErrorCode("HTTP 429 Too Many Requests")).toBe("HTTP_429");
        expect(isTransientNetworkError("Low-level socket closed (UND_ERR_SOCKET)")).toBe(true);

        // Non-retryable
        expect(isTransientNetworkError("HTTP 401 invalid_api_key")).toBe(false);
        expect(isTransientNetworkError("insufficient_quota: check billing")).toBe(false);
        expect(isTransientNetworkError("Retry cancelled")).toBe(false);
        expect(isTransientNetworkError("context_length_exceeded")).toBe(false);
    });

    test("forwards Pi SDK auto_retry_start / auto_retry_end on transient UND_ERR_CONNECT_TIMEOUT -> clean recovery without terminal error", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        const faux = fauxProvider({
            provider: "faux-retry-recover",
            models: [{ id: "faux-rr", name: "Faux Retry Recover", reasoning: true, contextWindow: 128_000, maxTokens: 4096 }],
        });

        const timeoutMsg =
            "Request timed out.: Connect Timeout Error (attempted address: www.autodl.art:443, timeout: 10000ms) (UND_ERR_CONNECT_TIMEOUT)";

        faux.setResponses([
            fauxAssistantMessage([], {
                stopReason: "error",
                errorMessage: timeoutMsg,
            }),
            fauxAssistantMessage([
                fauxThinking("Connection is back; proceeding cleanly."),
                fauxText("Recovered cleanly after transient connect timeout!"),
            ]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-retry-recover", model: "faux-rr" },
            retry: { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));

        await controller.prompt("Check the story workspace.");

        const retryStarts = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_start" }> => e.type === "retry_start",
        );
        const retryEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_end" }> => e.type === "retry_end",
        );
        const errors = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "error" }> => e.type === "error",
        );
        const statuses = events
            .filter((e): e is Extract<StoryAgentEvent, { type: "status" }> => e.type === "status")
            .map((e) => e.status);
        const doneEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done",
        );

        expect(retryStarts).toHaveLength(1);
        expect(retryStarts[0].attempt).toBe(1);
        expect(retryStarts[0].maxAttempts).toBe(3);
        expect(retryStarts[0].delayMs).toBe(10);
        expect(retryStarts[0].code).toBe("UND_ERR_CONNECT_TIMEOUT");
        expect(retryStarts[0].errorMessage).toContain("www.autodl.art:443");

        expect(statuses).toContain("retrying");

        expect(retryEnds).toHaveLength(1);
        expect(retryEnds[0]).toMatchObject({
            attempt: 1,
            maxAttempts: 3,
            success: true,
        });

        // Must NOT spam any terminal error when auto-retry recovered!
        expect(errors).toHaveLength(0);

        expect(doneEv?.aborted).toBe(false);
        expect(doneEv?.finalText).toContain("Recovered cleanly after transient connect timeout!");

        // Verify retry_end happened BEFORE final text_delta completes recovery
        const retryEndIdx = events.findIndex((e) => e.type === "retry_end");
        const doneIdx = events.findIndex((e) => e.type === "done");
        expect(retryEndIdx).toBeGreaterThan(-1);
        expect(retryEndIdx).toBeLessThan(doneIdx);

        await controller.dispose();
    });

    test("exhausted retries emit retry_end { success: false } + single terminal non-recoverable error", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        const faux = fauxProvider({
            provider: "faux-retry-exhaust",
            models: [{ id: "faux-re", name: "Faux Retry Exhaust", reasoning: false, contextWindow: 128_000, maxTokens: 4096 }],
        });

        const timeoutMsg = "Request timed out.: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)";
        faux.setResponses([
            fauxAssistantMessage([], { stopReason: "error", errorMessage: timeoutMsg }),
            fauxAssistantMessage([], { stopReason: "error", errorMessage: timeoutMsg }),
            fauxAssistantMessage([], { stopReason: "error", errorMessage: timeoutMsg }),
            fauxAssistantMessage([], { stopReason: "error", errorMessage: timeoutMsg }),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-retry-exhaust", model: "faux-re" },
            retry: { enabled: true, maxRetries: 3, baseDelayMs: 5, maxDelayMs: 100 },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));

        await controller.prompt("Try connecting.");

        const retryStarts = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_start" }> => e.type === "retry_start",
        );
        const retryEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_end" }> => e.type === "retry_end",
        );
        const errors = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "error" }> => e.type === "error",
        );
        const doneEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done",
        );

        expect(retryStarts.map((r) => [r.attempt, r.maxAttempts, r.delayMs])).toEqual([
            [1, 3, 5],
            [2, 3, 10],
            [3, 3, 20],
        ]);
        expect(retryEnds).toHaveLength(1);
        expect(retryEnds[0]).toMatchObject({
            attempt: 3,
            maxAttempts: 3,
            success: false,
        });
        expect(retryEnds[0].finalError).toContain("UND_ERR_CONNECT_TIMEOUT");

        expect(errors).toHaveLength(1);
        expect(errors[0].recoverable).toBe(false);
        expect(errors[0].code).toBe("UND_ERR_CONNECT_TIMEOUT");
        expect(doneEv?.aborted).toBe(false);

        await controller.dispose();
    });

    test("outer transient-network retry guard recovers from UND_ERR_SOCKET without duplicating user messages", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        const observedUserMsgCounts: number[] = [];
        const faux = fauxProvider({
            provider: "faux-outer-retry",
            models: [{ id: "faux-or", name: "Faux Outer Retry", reasoning: false, contextWindow: 128_000, maxTokens: 4096 }],
        });

        faux.setResponses([
            (ctx) => {
                observedUserMsgCounts.push(ctx.messages.filter((m) => m.role === "user").length);
                return fauxAssistantMessage([], {
                    stopReason: "error",
                    errorMessage: "Low-level transport fault (UND_ERR_SOCKET)",
                });
            },
            (ctx) => {
                observedUserMsgCounts.push(ctx.messages.filter((m) => m.role === "user").length);
                return fauxAssistantMessage([fauxText("Recovered via outer transient retry guard!")]);
            },
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-outer-retry", model: "faux-or" },
            retry: { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => events.push(ev));

        await controller.prompt("Test outer guard.");

        const retryStarts = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_start" }> => e.type === "retry_start",
        );
        const retryEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_end" }> => e.type === "retry_end",
        );
        const errors = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "error" }> => e.type === "error",
        );
        const doneEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done",
        );

        expect(retryStarts).toHaveLength(1);
        expect(retryStarts[0].code).toBe("UND_ERR_SOCKET");
        expect(retryEnds).toHaveLength(1);
        expect(retryEnds[0].success).toBe(true);
        expect(errors).toHaveLength(0);
        expect(doneEv?.finalText).toContain("Recovered via outer transient retry guard!");
        // User message was NOT duplicated when retrying
        expect(observedUserMsgCounts).toEqual([1, 1]);

        await controller.dispose();
    });

    test("abort during retry backoff cancels immediately without waiting for full delay", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        const faux = fauxProvider({
            provider: "faux-retry-abort",
            models: [{ id: "faux-ra", name: "Faux Retry Abort", reasoning: false, contextWindow: 128_000, maxTokens: 4096 }],
        });

        faux.setResponses([
            fauxAssistantMessage([], {
                stopReason: "error",
                errorMessage: "Request timed out.: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)",
            }),
            fauxAssistantMessage([fauxText("Should never be reached after abort.")]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-retry-abort", model: "faux-ra" },
            // Long 10s backoff so we verify abort cancels immediately
            retry: { enabled: true, maxRetries: 3, baseDelayMs: 10_000, maxDelayMs: 60_000 },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => {
            events.push(ev);
            if (ev.type === "retry_start") {
                queueMicrotask(() => {
                    void controller.abort();
                });
            }
        });

        const startedAt = Date.now();
        await controller.prompt("Abort me while retrying.");
        const elapsedMs = Date.now() - startedAt;

        expect(elapsedMs).toBeLessThan(2000);
        const retryEnds = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "retry_end" }> => e.type === "retry_end",
        );
        const errors = events.filter(
            (e): e is Extract<StoryAgentEvent, { type: "error" }> => e.type === "error",
        );
        const doneEv = events.find(
            (e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done",
        );

        expect(retryEnds).toHaveLength(1);
        expect(retryEnds[0].success).toBe(false);
        expect(retryEnds[0].finalError).toContain("cancelled");
        expect(errors).toHaveLength(0);
        expect(doneEv?.aborted).toBe(true);

        await controller.dispose();
    });

    test("settles any in-flight tool call on abort so UI never stays stuck at running", async () => {
        const dir = await makeTempDir();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        // Slow fetch inside story_validate_and_simulate(verifyAssets=true) so we can abort mid-tool execution
        const hangingFetch = ((_input: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                if (init?.signal?.aborted) {
                    const err = new Error("Aborted");
                    err.name = "AbortError";
                    reject(err);
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    const err = new Error("Aborted");
                    err.name = "AbortError";
                    reject(err);
                });
                // Also reject eventually if not aborted so test can't hang forever
                setTimeout(() => reject(new Error("timeout")), 5000);
            })) as unknown as typeof fetch;

        const faux = fauxProvider({
            provider: "faux-tool-abort",
            models: [{ id: "faux-ta", name: "Faux Tool Abort", reasoning: false, contextWindow: 128_000, maxTokens: 4096 }],
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("story_validate_and_simulate", {
                    strict: true,
                    simulate: true,
                    verifyAssets: true,
                }),
            ]),
            fauxAssistantMessage([fauxText("Done")]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dir,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-tool-abort", model: "faux-ta" },
            fetchImpl: hangingFetch,
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const events: StoryAgentEvent[] = [];
        controller.subscribe((ev) => {
            events.push(ev);
            if (ev.type === "tool_start") {
                setTimeout(() => {
                    void controller.abort();
                }, 15);
            }
        });

        await controller.prompt("Validate assets then abort.");

        const startedIds = events
            .filter((e): e is Extract<StoryAgentEvent, { type: "tool_start" }> => e.type === "tool_start")
            .map((e) => e.toolCallId);
        const endedIds = new Set(
            events
                .filter((e): e is Extract<StoryAgentEvent, { type: "tool_end" }> => e.type === "tool_end")
                .map((e) => e.toolCallId),
        );

        expect(startedIds.length).toBe(1);
        for (const id of startedIds) {
            expect(endedIds.has(id)).toBe(true);
        }
        expect(events.some((e) => e.type === "done" && e.aborted)).toBe(true);

        await controller.dispose();
    });
});

describe("Persistent per-project Pi sessions, resume & strict isolation (#107)", () => {
    test("persists JSONL + UI sidecar lazily, isolates projects, resumes with full LLM context, and supports newSession/deleteSession", async () => {
        const dirA = await makeTempDir("moesekai-proj-a-");
        const dirB = await makeTempDir("moesekai-proj-b-");
        await writeStoryScript(createNodeWorkspaceFiles(dirA), "story.msk", STARTER_MSK);
        await writeStoryScript(createNodeWorkspaceFiles(dirB), "story.msk", STARTER_MSK);

        let resumedPromptSeenMessages: string[] = [];

        const faux = fauxProvider({
            provider: "faux-persist",
            models: [{ id: "faux-p1", name: "Faux Persist", reasoning: true, contextWindow: 128_000, maxTokens: 4096 }],
        });
        faux.setResponses([
            // Session 1, Turn 1 in Project A
            fauxAssistantMessage([
                fauxThinking("Memorizing user codeword."),
                fauxText("Noted! I will remember codeword LUMINA-42 for this story."),
            ]),
            // Session 2, Turn 1 in Project A (after newSession)
            fauxAssistantMessage([fauxText("Started a separate rooftop brainstorming thread.")]),
            // Session 1, Turn 2 in Project A (AFTER resumeSession(session1Id)!)
            (ctx) => {
                resumedPromptSeenMessages = ctx.messages
                    .map((m) =>
                        typeof m.content === "string"
                            ? m.content
                            : Array.isArray(m.content)
                                ? m.content
                                    .filter((b): b is { type: "text"; text: string } => b.type === "text")
                                    .map((b) => b.text)
                                    .join("")
                                : "",
                    );
                return fauxAssistantMessage([fauxText("Your codeword from earlier was LUMINA-42!")]);
            },
            // Project B Session 1
            fauxAssistantMessage([fauxText("Project B isolated reply.")]),
        ]);

        const controller = createStoryAgentSession({
            workspaceDir: dirA,
            storyFile: "story.msk",
            config: { mode: "sdk", provider: "faux-persist", model: "faux-p1" },
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        // Empty workspace stays clean before first prompt
        expect(existsSync(join(dirA, ".moesekai-studio", "sessions"))).toBe(false);
        expect(await controller.listSessions()).toEqual([]);

        // 1. Prompt in Session 1
        await controller.prompt("Remember codeword LUMINA-42 for Kanade's scene.");
        const session1Id = controller.getState().activeSessionId;
        expect(session1Id).toBeTruthy();

        const sessionsDirA = join(dirA, ".moesekai-studio", "sessions");
        expect(existsSync(sessionsDirA)).toBe(true);
        const filesAfterFirst = await readdir(sessionsDirA);
        expect(filesAfterFirst.some((f) => f.endsWith(".jsonl"))).toBe(true);
        expect(filesAfterFirst.some((f) => f === `${session1Id}.ui.json`)).toBe(true);

        // 2. Start a brand-new thread via newSession() without deleting Session 1
        const created2 = await controller.newSession();
        expect(created2.sessionId).not.toBe(session1Id);
        await controller.prompt("Brainstorm a separate rooftop ending.");
        const session2Id = controller.getState().activeSessionId!;
        expect(session2Id).toBe(created2.sessionId);

        const listA = await controller.listSessions();
        expect(listA).toHaveLength(2);
        expect(listA.map((s) => s.id)).toContain(session1Id!);
        expect(listA.map((s) => s.id)).toContain(session2Id);
        const s1Summary = listA.find((s) => s.id === session1Id);
        expect(s1Summary?.title).toContain("Remember codeword LUMINA-42");

        // 3. Resume Session 1 -> restores rich UI transcript AND full Pi LLM message history!
        const resumed = await controller.resumeSession(session1Id!);
        expect(resumed.summary.id).toBe(session1Id!);
        expect(resumed.transcript.length).toBeGreaterThanOrEqual(2);
        expect(resumed.transcript[0].role).toBe("user");
        expect(resumed.transcript[0].text).toContain("LUMINA-42");
        expect(resumed.transcript[1].role).toBe("assistant");
        expect(resumed.transcript[1].text).toContain("LUMINA-42");
        expect(resumed.transcript[1].thinking).toContain("Memorizing user codeword");

        // Follow-up prompt in resumed Session 1 sees prior conversation in LLM context!
        const followUpEvents: StoryAgentEvent[] = [];
        const unsub = controller.subscribe((ev) => followUpEvents.push(ev));
        await controller.prompt("What codeword did I ask you to remember?");
        unsub();

        expect(resumedPromptSeenMessages.some((m) => m.includes("Remember codeword LUMINA-42"))).toBe(true);
        expect(resumedPromptSeenMessages.some((m) => m.includes("I will remember codeword LUMINA-42"))).toBe(true);
        const followUpDone = followUpEvents.find(
            (e): e is Extract<StoryAgentEvent, { type: "done" }> => e.type === "done",
        );
        expect(followUpDone?.finalText).toContain("LUMINA-42");

        // 4. Delete Session 2 safely (and verify path traversal is rejected)
        await expect(controller.deleteSession("../escape")).rejects.toThrow(/Invalid sessionId/);
        await expect(controller.resumeSession("../escape")).rejects.toThrow(/Invalid sessionId/);
        expect(await controller.deleteSession(session2Id)).toBe(true);
        const listAfterDelete = await controller.listSessions();
        expect(listAfterDelete.map((s) => s.id)).toEqual([session1Id!]);

        // 5. Switch to Project B -> ZERO sessions from Project A appear!
        await controller.updateWorkspace(dirB, "story.msk");
        expect(controller.getState().activeSessionId).toBeNull();
        expect(await controller.listSessions()).toEqual([]);

        await controller.prompt("Hello from Project B");
        const listB = await controller.listSessions();
        expect(listB).toHaveLength(1);
        expect(listB[0].title).toContain("Hello from Project B");
        expect(listB[0].id).not.toBe(session1Id!);

        await controller.dispose();
    });

    test("worker IPC supports list_sessions, new_session, resume_session, delete_session & get_state.activeSessionId", async () => {
        const dir = await makeTempDir("moesekai-ipc-sess-");
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", STARTER_MSK);

        const faux = fauxProvider({
            provider: "faux-ipc-sess",
            models: [{ id: "faux-is", name: "Faux IPC Session", reasoning: false, contextWindow: 64_000, maxTokens: 4096 }],
        });
        faux.setResponses([
            fauxAssistantMessage([fauxText("IPC thread one reply.")]),
            fauxAssistantMessage([fauxText("IPC resumed follow-up reply.")]),
        ]);

        const responses: StoryAgentWorkerResponse[] = [];
        const handler = createStoryAgentWorkerHandler((msg) => responses.push(msg), {
            testProvider: { provider: faux.provider, model: faux.getModel() },
        });

        const getReply = (id: string) =>
            responses.find(
                (r): r is Extract<StoryAgentWorkerResponse, { type: "reply" }> => r.type === "reply" && r.id === id,
            );

        await handler.handleRequest({
            id: "1",
            type: "init",
            options: {
                workspaceDir: dir,
                storyFile: "story.msk",
                config: { mode: "sdk", provider: "faux-ipc-sess", model: "faux-is" },
            },
        });
        await handler.handleRequest({ id: "2", type: "prompt", text: "IPC first message" });
        await handler.handleRequest({ id: "3", type: "get_state" });
        const stateReply = getReply("3");
        expect(stateReply?.ok).toBe(true);
        const sessionId = (stateReply && stateReply.ok ? (stateReply.data as { activeSessionId: string }).activeSessionId : "");
        expect(sessionId).toBeTruthy();

        await handler.handleRequest({ id: "4", type: "list_sessions" });
        const listReply = getReply("4");
        expect(listReply?.ok).toBe(true);
        const sessions = (listReply && listReply.ok ? (listReply.data as StoryAgentSessionSummary[]) : []);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe(sessionId);

        await handler.handleRequest({ id: "5", type: "new_session" });
        await handler.handleRequest({ id: "6", type: "resume_session", sessionId });
        const resumeReply = getReply("6");
        expect(resumeReply?.ok).toBe(true);
        const resumed = (resumeReply && resumeReply.ok ? (resumeReply.data as StoryAgentResumedSession) : null);
        expect(resumed?.summary.id).toBe(sessionId);
        expect(resumed?.transcript.length).toBeGreaterThanOrEqual(2);

        await handler.handleRequest({ id: "7", type: "prompt", text: "IPC follow-up after resume" });
        await handler.handleRequest({ id: "8", type: "delete_session", sessionId });
        const delReply = getReply("8");
        expect(delReply?.ok).toBe(true);
        expect(delReply && delReply.ok ? delReply.data : false).toBe(true);

        await handler.handleRequest({ id: "9", type: "list_sessions" });
        const finalListReply = getReply("9");
        expect(finalListReply && finalListReply.ok ? finalListReply.data : null).toEqual([]);

        await handler.handleRequest({ id: "10", type: "dispose" });
    });
});

describe("Live2D Z-layer prompt & tool guidance (#105)", () => {
    test("prompts, presets, and story_write_msk / story_patch_msk document z=<int> depth layering with zero user-facing 'Pi' text", () => {
        const createPrompt = buildStoryAgentSystemPrompt("create", true);
        const editPrompt = buildStoryAgentSystemPrompt("edit", false);
        const authorPreset = buildPresetPrompt("author_story");

        expect(createPrompt).toContain("z=<int>");
        expect(createPrompt).toContain("overlap");
        expect(editPrompt).toContain("z=<int>");
        expect(authorPreset).toContain("z=<int>");

        const tools = createStoryMakerTools({
            getWorkspace: () => createNodeWorkspaceFiles(tmpdir()),
            getStoryFile: () => "story.msk",
        });
        const writeTool = tools.find((t) => t.name === "story_write_msk");
        const patchTool = tools.find((t) => t.name === "story_patch_msk");

        expect(writeTool?.description).toContain("z=<int>");
        expect(patchTool?.description).toContain("z=<int>");

        const allUiStrings = [
            createPrompt,
            editPrompt,
            authorPreset,
            ...tools.flatMap((t) => [t.label, t.description, t.promptSnippet ?? "", ...(t.promptGuidelines ?? [])]),
        ];
        for (const text of allUiStrings) {
            expect(text).not.toMatch(/\bPi\b/);
        }
    });

    test("readStoryWorkspace, patchStoryScript diff, and validateAndSimulateStory support z=<int> Live2D layers end-to-end", async () => {
        const dir = await makeTempDir("moesekai-zlayer-");
        const zMsk = `@story "Z Layer Test" region=jp id="z_layer_test"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
@cast saki "Saki" model="v2_02saki_casual" char=2
start -> scene_z
scene scene_z "Huddle" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  cast set [
    ichika at center z=10 facial="face_smile_01"
    saki at left z=-1 facial="face_normal_01"
  ]
  talk ichika "I'm in front!"
  stage move saki to right dur=0.4 z=5
  stage pose ichika z=2 facial="face_smile_01"
  talk saki "Now I stepped forward!"
} -> end_z
end end_z "Done"
`;
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", zMsk);

        const ws = await readStoryWorkspace(createNodeWorkspaceFiles(dir), "story.msk", { selectedNodeId: "scene_z" });
        expect(ws.parseOk).toBe(true);
        const previews = ws.selectedNodeContext?.beatsPreview?.map((b) => b.summary) ?? [];
        expect(previews.some((p) => p.includes("move saki @ right z=5"))).toBe(true);
        expect(previews.some((p) => p.includes("pose ichika z=2"))).toBe(true);

        const patched = await patchStoryScript(createNodeWorkspaceFiles(dir), "story.msk", {
            edits: [{ find: "stage move saki to right dur=0.4 z=5", replace: "stage move saki to right dur=0.4 z=12" }],
            reason: "raise saki foreground layer",
        });
        expect(patched.parseOk).toBe(true);
        expect(patched.compileOk).toBe(true);
        expect(patched.diff.modifiedNodeIds).toContain("scene_z");
        expect(patched.diff.unifiedDiffPreview).toContain("z=12");

        const patchedSource = await readFile(join(dir, "story.msk"), "utf8");
        const validation = await validateAndSimulateStory(patchedSource, {
            strict: true,
            simulate: true,
            verifyAssets: false,
        });
        expect(validation.strictOk).toBe(true);
        expect(validation.errors).toHaveLength(0);
        expect(validation.warnings).toHaveLength(0);
    });
});
