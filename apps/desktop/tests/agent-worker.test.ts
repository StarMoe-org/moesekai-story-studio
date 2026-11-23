import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStarterStoryFromScript, serializeStoryScript } from "@moesekai/story-core";
import {
    attachAgentWorkerPort,
    type ParentPortLike,
    type WorkerMessage,
    type WorkerRequest,
} from "../src/main/agent-worker.ts";

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
    readonly sent: WorkerMessage[] = [];
    private waiters = new Map<string, (msg: WorkerMessage) => void>();

    postMessage(message: unknown): void {
        const msg = message as WorkerMessage;
        this.sent.push(msg);
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

describe("MoeSekai Agent UtilityProcess worker protocol", () => {
    it("lists curated late-2026 frontier providers, supports live thinking/mode/plan switches, and fetches fallback models cleanly", async () => {
        const wsDir = makeTempDir("moesekai-agent-worker-");
        const starter = createStarterStoryFromScript("jp", "en");
        fs.writeFileSync(path.join(wsDir, "story.msk"), serializeStoryScript(starter), "utf8");

        const port = new MockParentPort();
        const detach = attachAgentWorkerPort(port);

        try {
            const providersRes = await port.request({ id: "req-1", type: "list_providers" });
            expect(providersRes.kind).toBe("response");
            expect(providersRes.kind === "response" && providersRes.ok).toBe(true);
            const providers = providersRes.kind === "response" && providersRes.ok
                ? (providersRes.data as Array<{ id: string; defaultModel?: string }>)
                : [];
            expect(providers.length).toBeGreaterThan(0);
            expect(providers.find(p => p.id === "anthropic")?.defaultModel).toBe("claude-opus-5-5");
            expect(providers.find(p => p.id === "openai")?.defaultModel).toBe("gpt-6.2-astra");
            expect(providers.find(p => p.id === "google")?.defaultModel).toBe("gemini-4-carbon");

            // Fetch models gracefully falls back to curated catalog when API key is not configured
            const modelsRes = await port.request({
                id: "req-1b",
                type: "fetch_models",
                config: { provider: "anthropic" },
            });
            expect(modelsRes.kind === "response" && modelsRes.ok).toBe(true);
            const modelsPayload = modelsRes.kind === "response" && modelsRes.ok
                ? (modelsRes.data as { source: string; models: Array<{ id: string }> })
                : null;
            expect(modelsPayload?.source).toBe("catalog");
            expect(modelsPayload?.models[0]?.id).toBe("claude-opus-5-5");

            const initRes = await port.request({
                id: "req-2",
                type: "init",
                workspaceDir: wsDir,
                storyFile: "story.msk",
                config: {
                    mode: "sdk",
                    provider: "anthropic",
                    model: "claude-opus-5-5",
                    thinkingLevel: "medium",
                    authoringMode: "create",
                    planFirst: true,
                },
            });
            expect(initRes.kind === "response" && initRes.ok).toBe(true);

            // Live thinkingLevel, authoringMode, and planFirst mutations
            const thinkRes = await port.request({
                id: "req-2b",
                type: "set_thinking_level",
                thinkingLevel: "high",
            });
            expect(thinkRes.kind === "response" && thinkRes.ok).toBe(true);

            const modeRes = await port.request({
                id: "req-2c",
                type: "set_authoring_mode",
                authoringMode: "edit",
            });
            expect(modeRes.kind === "response" && modeRes.ok).toBe(true);

            const planRes = await port.request({
                id: "req-2d",
                type: "set_plan_first",
                planFirst: false,
            });
            expect(planRes.kind === "response" && planRes.ok).toBe(true);

            const stateRes = await port.request({ id: "req-3", type: "get_state" });
            expect(stateRes.kind === "response" && stateRes.ok).toBe(true);
            const state = stateRes.kind === "response" && stateRes.ok
                ? (stateRes.data as {
                    storyFile: string;
                    thinkingLevel: string;
                    authoringMode: string;
                    planFirst: boolean;
                })
                : null;
            expect(state?.storyFile).toBe("story.msk");
            expect(state?.thinkingLevel).toBe("high");
            expect(state?.authoringMode).toBe("edit");
            expect(state?.planFirst).toBe(false);

            const snapsRes = await port.request({ id: "req-4", type: "list_snapshots" });
            expect(snapsRes.kind === "response" && snapsRes.ok).toBe(true);
            expect(Array.isArray(snapsRes.kind === "response" && snapsRes.ok ? snapsRes.data : null)).toBe(true);

            const disposeRes = await port.request({ id: "req-5", type: "dispose" });
            expect(disposeRes.kind === "response" && disposeRes.ok).toBe(true);
        } finally {
            detach();
        }
    });

    it("persists per-project sessions, resumes prior LLM context on follow-up prompts, and isolates projects (#108)", async () => {
        const recordedRequests: Array<{ messages?: Array<{ role: string; content: unknown }> }> = [];
        let replySeq = 0;

        const mockServer = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(req) {
                const body = (await req.json().catch(() => ({}))) as {
                    messages?: Array<{ role: string; content: unknown }>;
                };
                recordedRequests.push(body);
                replySeq += 1;
                const replyText =
                    replySeq === 1
                        ? "Understood, remembered STARLIGHT_25."
                        : replySeq === 2
                            ? "Second thread reply."
                            : "Following up on STARLIGHT_25 cleanly!";

                const sse = [
                    `data: ${JSON.stringify({
                        id: `chatcmpl-${replySeq}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: "mock-story-model",
                        choices: [{ index: 0, delta: { role: "assistant", content: replyText }, finish_reason: null }],
                    })}`,
                    `data: ${JSON.stringify({
                        id: `chatcmpl-${replySeq}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: "mock-story-model",
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
                    })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n");

                return new Response(sse, {
                    status: 200,
                    headers: { "content-type": "text/event-stream; charset=utf-8" },
                });
            },
        });

        const wsProjectA = makeTempDir("moesekai-sess-a-");
        const wsProjectB = makeTempDir("moesekai-sess-b-");
        const starter = createStarterStoryFromScript("jp", "en");
        const script = serializeStoryScript(starter);
        fs.writeFileSync(path.join(wsProjectA, "story.msk"), script, "utf8");
        fs.writeFileSync(path.join(wsProjectB, "story.msk"), script, "utf8");

        const port = new MockParentPort();
        const detach = attachAgentWorkerPort(port);

        const baseConfig = {
            mode: "sdk" as const,
            provider: "custom",
            model: "mock-story-model",
            baseUrl: `http://127.0.0.1:${mockServer.port}/v1`,
            api: "openai-completions" as const,
            apiKey: "sk-local-test",
            thinkingLevel: "off" as const,
            authoringMode: "edit" as const,
            planFirst: false,
        };

        try {
            // 1. Initialize Project A and send first prompt -> persisted session created
            const initA = await port.request({
                id: "s-1",
                type: "init",
                workspaceDir: wsProjectA,
                storyFile: "story.msk",
                config: baseConfig,
            });
            expect(initA.kind === "response" && initA.ok).toBe(true);

            const p1 = await port.request({
                id: "s-2",
                type: "prompt",
                text: "Remember the secret codeword STARLIGHT_25 for this story.",
            });
            expect(p1.kind === "response" && p1.ok).toBe(true);

            const listA1 = await port.request({ id: "s-3", type: "list_sessions" });
            expect(listA1.kind === "response" && listA1.ok).toBe(true);
            const sessionsAfter1 = (listA1.kind === "response" && listA1.ok ? listA1.data : []) as Array<{
                id: string;
                title: string;
                messageCount: number;
            }>;
            expect(sessionsAfter1).toHaveLength(1);
            const firstSessionId = sessionsAfter1[0].id;
            expect(sessionsAfter1[0].title).toContain("STARLIGHT_25");
            expect(sessionsAfter1[0].messageCount).toBeGreaterThanOrEqual(2);

            // 2. Start a new conversation (preserving first session in history!) and send a second prompt
            const newSess = await port.request({ id: "s-4", type: "new_session" });
            expect(newSess.kind === "response" && newSess.ok).toBe(true);

            const p2 = await port.request({
                id: "s-5",
                type: "prompt",
                text: "Start a separate brainstorming thread.",
            });
            expect(p2.kind === "response" && p2.ok).toBe(true);

            const listA2 = await port.request({ id: "s-6", type: "list_sessions" });
            const sessionsAfter2 = (listA2.kind === "response" && listA2.ok ? listA2.data : []) as Array<{
                id: string;
                title: string;
            }>;
            expect(sessionsAfter2).toHaveLength(2);
            expect(sessionsAfter2.some(s => s.id === firstSessionId)).toBe(true);

            // 3. Resume the FIRST conversation -> verify transcript restored & follow-up prompt preserves LLM history!
            const resumed = await port.request({
                id: "s-7",
                type: "resume_session",
                sessionId: firstSessionId,
            });
            expect(resumed.kind === "response" && resumed.ok).toBe(true);
            const resumedData = (resumed.kind === "response" && resumed.ok ? resumed.data : null) as {
                summary: { id: string };
                transcript: Array<{ role: string; text: string }>;
            };
            expect(resumedData?.summary.id).toBe(firstSessionId);
            expect(resumedData?.transcript.some(t => t.text.includes("STARLIGHT_25"))).toBe(true);

            const p3 = await port.request({
                id: "s-8",
                type: "prompt",
                text: "Repeat the codeword from our earlier message.",
            });
            expect(p3.kind === "response" && p3.ok).toBe(true);

            // Confirm the 3rd live LLM request actually carried prior messages from the resumed session!
            expect(recordedRequests.length).toBeGreaterThanOrEqual(3);
            const lastReqJson = JSON.stringify(recordedRequests[recordedRequests.length - 1]?.messages ?? []);
            expect(lastReqJson).toContain("STARLIGHT_25");
            expect(lastReqJson).toContain("Understood, remembered STARLIGHT_25.");

            // 4. Switch to Project B -> strict per-project isolation (0 sessions from Project A!)
            const initB = await port.request({
                id: "s-9",
                type: "init",
                workspaceDir: wsProjectB,
                storyFile: "story.msk",
                config: baseConfig,
            });
            expect(initB.kind === "response" && initB.ok).toBe(true);

            const listB = await port.request({ id: "s-10", type: "list_sessions" });
            const sessionsB = (listB.kind === "response" && listB.ok ? listB.data : []) as unknown[];
            expect(sessionsB).toHaveLength(0);

            // 5. Switch back to Project A -> sessions still intact & delete_session works cleanly
            await port.request({
                id: "s-11",
                type: "init",
                workspaceDir: wsProjectA,
                storyFile: "story.msk",
                config: baseConfig,
            });
            const delRes = await port.request({
                id: "s-12",
                type: "delete_session",
                sessionId: firstSessionId,
            });
            expect(delRes.kind === "response" && delRes.ok && delRes.data === true).toBe(true);

            const listA3 = await port.request({ id: "s-13", type: "list_sessions" });
            const sessionsAfterDelete = (listA3.kind === "response" && listA3.ok ? listA3.data : []) as Array<{ id: string }>;
            expect(sessionsAfterDelete).toHaveLength(1);
            expect(sessionsAfterDelete.some(s => s.id === firstSessionId)).toBe(false);

            await port.request({ id: "s-14", type: "dispose" });
        } finally {
            detach();
            mockServer.stop(true);
        }
    });
});
