/**
 * Electron UtilityProcess worker hosting `@moesekai/story-agent`.
 * Runs out-of-process so LLM streaming, official story mining, live model discovery,
 * and `.msk` validation never block Main/Renderer UI threads and remain crash-isolated.
 */
import {
    createStoryAgentSession,
    fetchLiveProviderModels,
    listKnownProviders,
    type StoryAgentEvent,
    type StoryAgentPresetId,
    type StoryAgentPresetOptions,
    type StoryAgentPromptContext,
    type StoryAgentProviderConfig,
    type StoryAgentSessionController,
    type StoryAgentSessionOptions,
    type StoryAuthoringMode,
    type StoryThinkingLevel,
} from "@moesekai/story-agent";

export type WorkerRequest =
    | {
        id: string;
        type: "init";
        workspaceDir: string;
        storyFile?: string;
        skillPath?: string;
        assetLine?: "main" | "backup";
        config: StoryAgentProviderConfig;
    }
    | { id: string; type: "update_config"; config: Partial<StoryAgentProviderConfig> }
    | { id: string; type: "set_thinking_level"; thinkingLevel: StoryThinkingLevel }
    | { id: string; type: "set_authoring_mode"; authoringMode: StoryAuthoringMode }
    | { id: string; type: "set_plan_first"; planFirst: boolean }
    | { id: string; type: "approve_plan"; planId: string; feedback?: string }
    | { id: string; type: "revise_plan"; planId: string; feedback: string }
    | { id: string; type: "fetch_models"; config: Partial<StoryAgentProviderConfig> }
    | { id: string; type: "update_workspace"; workspaceDir: string; storyFile?: string }
    | { id: string; type: "prompt"; text: string; context?: StoryAgentPromptContext }
    | { id: string; type: "preset"; preset: StoryAgentPresetId; options?: StoryAgentPresetOptions }
    | { id: string; type: "abort" }
    | { id: string; type: "reset" }
    | { id: string; type: "list_sessions" }
    | { id: string; type: "resume_session"; sessionId: string }
    | { id: string; type: "new_session" }
    | { id: string; type: "delete_session"; sessionId: string }
    | { id: string; type: "list_snapshots" }
    | { id: string; type: "rollback"; snapshotId: string }
    | { id: string; type: "get_state" }
    | { id: string; type: "list_providers" }
    | { id: string; type: "dispose" };

export type WorkerMessage =
    | { kind: "response"; id: string; ok: true; data?: unknown }
    | { kind: "response"; id: string; ok: false; error: string }
    | { kind: "event"; event: StoryAgentEvent };

export interface ParentPortLike {
    postMessage(message: unknown): void;
    on(event: "message", listener: (e: { data: unknown }) => void): void;
    off?(event: "message", listener: (e: { data: unknown }) => void): void;
    removeListener?(event: "message", listener: (e: { data: unknown }) => void): void;
}

export interface AttachAgentWorkerOptions {
    /** Optional offline test provider override used strictly by unit tests. */
    testProvider?: StoryAgentSessionOptions["testProvider"];
}

/**
 * Attaches the Agent request/event dispatcher to a `parentPort`-compatible message port.
 * Exported separately so unit tests can exercise the real worker loop without spawning Electron.
 */
export function attachAgentWorkerPort(port: ParentPortLike, options?: AttachAgentWorkerOptions): () => void {
    let session: StoryAgentSessionController | null = null;
    let unsubscribe: (() => void) | null = null;

    const send = (msg: WorkerMessage): void => {
        port.postMessage(msg);
    };

    const handleRequest = async (req: WorkerRequest): Promise<unknown> => {
        switch (req.type) {
            case "list_providers": {
                return listKnownProviders();
            }
            case "fetch_models": {
                if (session) {
                    return session.fetchModels(req.config);
                }
                return fetchLiveProviderModels(req.config);
            }
            case "init": {
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                if (session) {
                    await session.dispose();
                    session = null;
                }
                session = await createStoryAgentSession({
                    workspaceDir: req.workspaceDir,
                    storyFile: req.storyFile,
                    skillPath: req.skillPath,
                    assetLine: req.assetLine,
                    config: req.config,
                    ...(options?.testProvider ? { testProvider: options.testProvider } : {}),
                });
                unsubscribe = session.subscribe(event => {
                    send({ kind: "event", event });
                });
                return session.getState();
            }
            case "update_config": {
                if (!session) return null;
                await session.updateConfig(req.config);
                return session.getState();
            }
            case "set_thinking_level": {
                if (!session) return null;
                await session.setThinkingLevel(req.thinkingLevel);
                return session.getState();
            }
            case "set_authoring_mode": {
                if (!session) return null;
                await session.setAuthoringMode(req.authoringMode);
                return session.getState();
            }
            case "set_plan_first": {
                if (!session) return null;
                await session.setPlanFirst(req.planFirst);
                return session.getState();
            }
            case "approve_plan": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                await session.approvePlan(req.planId, req.feedback);
                return { ok: true };
            }
            case "revise_plan": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                await session.revisePlan(req.planId, req.feedback);
                return { ok: true };
            }
            case "update_workspace": {
                if (!session) return null;
                await session.updateWorkspace(req.workspaceDir, req.storyFile);
                return session.getState();
            }
            case "prompt": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                await session.prompt(req.text, req.context);
                return { ok: true };
            }
            case "preset": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                await session.runPreset(req.preset, req.options);
                return { ok: true };
            }
            case "abort": {
                if (session) await session.abort();
                return { ok: true };
            }
            case "reset": {
                if (session) await session.reset();
                return { ok: true };
            }
            case "list_sessions": {
                if (!session) return [];
                return session.listSessions();
            }
            case "resume_session": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                return session.resumeSession(req.sessionId);
            }
            case "new_session": {
                if (!session) {
                    throw new Error("Agent session is not initialized. Open a workspace first.");
                }
                return session.newSession();
            }
            case "delete_session": {
                if (!session) return false;
                return session.deleteSession(req.sessionId);
            }
            case "list_snapshots": {
                if (!session) return [];
                return session.listSnapshots();
            }
            case "rollback": {
                if (!session) {
                    throw new Error("Agent session is not initialized.");
                }
                return session.rollbackToSnapshot(req.snapshotId);
            }
            case "get_state": {
                return session ? session.getState() : null;
            }
            case "dispose": {
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                if (session) {
                    await session.dispose();
                    session = null;
                }
                return { ok: true };
            }
        }
    };

    const onMessage = (event: { data: unknown }) => {
        const req = event.data as WorkerRequest;
        if (!req || typeof req !== "object" || typeof req.id !== "string") return;

        void handleRequest(req).then(
            data => {
                send({ kind: "response", id: req.id, ok: true, data });
            },
            err => {
                send({
                    kind: "response",
                    id: req.id,
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            },
        );
    };

    port.on("message", onMessage);
    return () => {
        if (port.off) port.off("message", onMessage);
        else if (port.removeListener) port.removeListener("message", onMessage);
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        if (session) {
            void session.dispose();
            session = null;
        }
    };
}

const nativeParentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (nativeParentPort) {
    attachAgentWorkerPort(nativeParentPort);
}
