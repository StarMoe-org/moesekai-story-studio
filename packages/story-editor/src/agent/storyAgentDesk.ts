import { serializeStoryScript } from "@moesekai/story-core";
import {
    createBrowserStoryAgent,
    createMemoryWorkspaceFiles,
    estimateTranscriptTokens,
    type BrotliDecoder,
    type BrowserAgentProviderId,
    type BrowserStoryAgent,
    type ModelThinkingLevel,
    type OfficialStoryCache,
    type StoryAgentEvent,
    type StoryAgentStatus,
    type StoryAuthoringMode,
} from "@moesekai/story-agent/browser";
import type { StoryNodeChange } from "../studio/editorTypes";
import { applyAgentEvent, mergeNodeChanges, restoreTurn, startTurn, type AgentTurn } from "./agentTurns";
import { createDefaultConversationArchive, type ConversationArchive, type StoredConversation } from "./conversationArchive";
import type { StoryAgentTarget } from "./target";

const STORY_FILE = "story.msk";
const TITLE_CHARS = 40;

export interface StoryAgentConfig {
    provider: BrowserAgentProviderId;
    model: string;
    apiKey: string;
    /** Fitted to the model; the model's default when unset. */
    thinkingLevel?: ModelThinkingLevel;
    decodeBrotli?: BrotliDecoder;
    officialStoryCache?: OfficialStoryCache;
}

/** Everything the agent panel shows for one story. */
export interface StoryAgentDeskState {
    /** False until the saved conversations have been read. */
    loaded: boolean;
    /** Saved conversations, most recent first. */
    conversations: StoredConversation[];
    /** The open conversation; not saved until its first request. */
    conversation: StoredConversation;
    status: StoryAgentStatus;
    /** A request or a compaction is in flight. */
    busy: boolean;
    mode: StoryAuthoringMode;
    nodeChanges: ReadonlyMap<string, StoryNodeChange>;
    /** Estimated size of what the next request sends. */
    contextTokens: number;
}

function emptyConversation(storyKey: string): StoredConversation {
    return { id: crypto.randomUUID(), storyKey, title: "", updatedAt: Date.now(), turns: [], transcript: [] };
}

function restoreConversation(conversation: StoredConversation): StoredConversation {
    return { ...conversation, turns: conversation.turns.map(restoreTurn) };
}

const titleOf = (prompt: string) => prompt.split("\n")[0].slice(0, TITLE_CHARS);

/**
 * The agent's side of one story, outside React: conversations, the running agent and the change
 * marks. Panels come and go (a remount, the editor giving way to the phone screen), the desk stays.
 */
export class StoryAgentDesk {
    private state: StoryAgentDeskState;
    private readonly listeners = new Set<() => void>();
    private readonly files = createMemoryWorkspaceFiles("browser draft");
    private target: StoryAgentTarget | null = null;
    /** An edit made while no target was attached, handed to the next one. */
    private unsyncedScript: string | null = null;
    private config: StoryAgentConfig | null = null;
    private live: { key: string; conversationId: string; agent: BrowserStoryAgent } | null = null;
    /** The turn agent events belong to. */
    private eventTurnId: number | null = null;
    private firstChangedNode: string | null = null;

    constructor(readonly storyKey: string, private readonly archive: ConversationArchive) {
        this.state = {
            loaded: false,
            conversations: [],
            conversation: emptyConversation(storyKey),
            status: "idle",
            busy: false,
            mode: "edit",
            nodeChanges: new Map(),
            contextTokens: 0,
        };
        void archive.list(storyKey)
            .then((saved) => {
                const conversations = saved.map(restoreConversation);
                const conversation = conversations[0] ?? this.state.conversation;
                this.update({ loaded: true, conversations, conversation, contextTokens: estimateTranscriptTokens(conversation.transcript) });
            })
            .catch(() => this.update({ loaded: true }));
    }

    readonly subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    readonly getState = () => this.state;

    private update(patch: Partial<StoryAgentDeskState>): void {
        this.state = { ...this.state, ...patch };
        for (const listener of this.listeners) listener();
    }

    private updateTurns(change: (turns: AgentTurn[]) => AgentTurn[]): void {
        const { conversation } = this.state;
        this.update({ conversation: { ...conversation, turns: change(conversation.turns) } });
    }

    private setMarks(nodeChanges: ReadonlyMap<string, StoryNodeChange>): void {
        this.update({ nodeChanges });
        this.target?.showNodeChanges?.(nodeChanges.size > 0 ? nodeChanges : null);
    }

    /** Makes `target` the story the agent edits; returns the detach function. */
    attach(target: StoryAgentTarget): () => void {
        this.target = target;
        if (this.unsyncedScript !== null) {
            target.applyScript(this.unsyncedScript);
            this.unsyncedScript = null;
        }
        this.setMarks(this.state.nodeChanges);
        return () => {
            if (this.target === target) this.target = null;
        };
    }

    configure(config: StoryAgentConfig): void {
        this.config = config;
        if (config.thinkingLevel) this.live?.agent.setThinkingLevel(config.thinkingLevel);
    }

    setMode(mode: StoryAuthoringMode): void {
        this.update({ mode });
        this.live?.agent.setAuthoringMode(mode);
    }

    private handleEvent(event: StoryAgentEvent): void {
        const turnId = this.eventTurnId;
        if (turnId !== null) this.updateTurns(turns => turns.map(t => (t.id === turnId ? applyAgentEvent(t, event) : t)));
        switch (event.type) {
            case "status":
                this.update({ status: event.status });
                break;
            case "msk_diff":
                void this.files.readText(STORY_FILE).then((script) => {
                    if (script !== null) this.applyScript(script);
                });
                this.firstChangedNode ??= event.diff.addedNodeIds[0] ?? event.diff.modifiedNodeIds[0] ?? null;
                this.setMarks(mergeNodeChanges(this.state.nodeChanges, event.diff));
                break;
            case "editor_action":
                this.target?.runEditorAction?.(event.action);
                break;
        }
    }

    private applyScript(script: string): void {
        if (this.target) this.target.applyScript(script);
        else this.unsyncedScript = script;
    }

    /** The agent for the open conversation and the current settings, continuing its transcript. */
    private agentFor(config: StoryAgentConfig): BrowserStoryAgent {
        const key = `${config.provider}|${config.model}|${config.apiKey}`;
        const { conversation, mode } = this.state;
        if (this.live?.key !== key || this.live.conversationId !== conversation.id) {
            this.live?.agent.abort();
            const agent = createBrowserStoryAgent({
                provider: config.provider,
                model: config.model,
                apiKey: config.apiKey,
                files: this.files,
                storyFile: STORY_FILE,
                authoringMode: mode,
                thinkingLevel: config.thinkingLevel,
                getSelectedNodeId: () => this.target?.promptContext().selectedNodeId,
                decodeBrotli: config.decodeBrotli,
                officialStoryCache: config.officialStoryCache,
                ...(conversation.transcript.length > 0 ? { transcript: conversation.transcript } : {}),
                onEvent: event => this.handleEvent(event),
            });
            this.live = { key, conversationId: conversation.id, agent };
        }
        return this.live.agent;
    }

    /** Copies the target's story into the agent's workspace; false when there is none yet. */
    private async syncFromTarget(): Promise<boolean> {
        const doc = this.target?.currentDoc();
        if (!doc) return false;
        await this.files.writeText(STORY_FILE, serializeStoryScript(doc));
        return true;
    }

    /** Runs `work` on the agent as the open conversation's busy step, then saves the conversation. */
    private async withAgent(turnId: number | null, work: (agent: BrowserStoryAgent) => Promise<void>): Promise<void> {
        if (this.state.busy || !this.config) return;
        const agent = this.agentFor(this.config);
        this.eventTurnId = turnId;
        this.update({ busy: true });
        try {
            await work(agent);
        } finally {
            this.eventTurnId = null;
            const conversation = { ...this.state.conversation, transcript: agent.transcript(), updatedAt: Date.now() };
            const conversations = [conversation, ...this.state.conversations.filter(c => c.id !== conversation.id)];
            this.update({ busy: false, conversation, conversations, contextTokens: agent.contextTokens() });
            void this.archive.save(conversation).catch(() => undefined);
        }
    }

    async send(prompt: string, locale: string): Promise<void> {
        if (this.state.busy || !this.config || !(await this.syncFromTarget())) return;
        const turn = startTurn(Date.now(), prompt);
        const { conversation } = this.state;
        this.update({ conversation: { ...conversation, title: conversation.title || titleOf(prompt), turns: [...conversation.turns, turn] } });
        this.firstChangedNode = null;
        const endTurn = (end: (t: AgentTurn) => AgentTurn) =>
            this.updateTurns(turns => turns.map(t => (t.id === turn.id && t.state === "running" ? end(t) : t)));
        await this.withAgent(turn.id, async (agent) => {
            try {
                await agent.prompt(prompt, { ...this.target?.promptContext(), locale, authoringMode: this.state.mode });
                endTurn(t => ({ ...t, state: "done" }));
            } catch (error) {
                endTurn(t => ({ ...t, state: "error", error: error instanceof Error ? error.message : String(error) }));
            }
        });
        if (this.firstChangedNode) this.target?.focusNode?.(this.firstChangedNode);
    }

    /** Summarizes the older turns now instead of waiting for the conversation to grow. */
    async compact(): Promise<void> {
        const lastTurn = this.state.conversation.turns.at(-1);
        await this.withAgent(lastTurn?.id ?? null, async (agent) => {
            await agent.compact();
        });
    }

    stop(): void {
        this.live?.agent.abort();
    }

    /** Restores the story as it was before `turn`'s first edit. */
    async undoTurn(turn: AgentTurn): Promise<void> {
        const snapshotId = turn.undoSnapshotId;
        if (!snapshotId || this.state.busy) return;
        await this.syncFromTarget();
        await this.withAgent(null, async (agent) => {
            await agent.rollbackToSnapshot(snapshotId);
        });
        this.updateTurns(turns => turns.map(t => (t.id === turn.id ? { ...t, undoSnapshotId: null } : t)));
        this.setMarks(new Map());
    }

    newConversation(): void {
        if (this.state.busy) return;
        this.update({ conversation: emptyConversation(this.storyKey), contextTokens: 0 });
        this.setMarks(new Map());
    }

    open(id: string): void {
        const conversation = this.state.conversations.find(c => c.id === id);
        if (!conversation || this.state.busy) return;
        this.update({ conversation, contextTokens: estimateTranscriptTokens(conversation.transcript) });
        this.setMarks(new Map());
    }

    async remove(id: string): Promise<void> {
        if (this.state.busy && this.state.conversation.id === id) return;
        this.update({ conversations: this.state.conversations.filter(c => c.id !== id) });
        if (this.state.conversation.id === id) this.newConversation();
        await this.archive.remove(id).catch(() => undefined);
    }

    clearMarks(): void {
        this.setMarks(new Map());
    }
}

const desks = new Map<string, StoryAgentDesk>();
let sharedArchive: ConversationArchive | null = null;

/** The desk for a story, shared by every panel showing it. */
export function storyAgentDesk(storyKey: string): StoryAgentDesk {
    let desk = desks.get(storyKey);
    if (!desk) {
        sharedArchive ??= createDefaultConversationArchive();
        desk = new StoryAgentDesk(storyKey, sharedArchive);
        desks.set(storyKey, desk);
    }
    return desk;
}
