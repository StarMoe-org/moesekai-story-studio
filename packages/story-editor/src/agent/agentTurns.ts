import type { StoryAgentEvent, StoryMskDiff } from "@moesekai/story-agent/browser";
import type { StoryNodeChange } from "../studio/editorTypes";

/** One piece of an agent reply, in the order it arrived. */
export type AgentTurnItem =
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool"; toolCallId: string; toolName: string; state: "running" | "ok" | "error"; summary: string }
    | { kind: "diff"; diff: StoryMskDiff }
    | { kind: "compaction"; state: "running" | "done" | "failed"; tokensBefore: number; tokensAfter?: number; error?: string };

export type AgentTurnState = "running" | "done" | "aborted" | "error";

/** One user request and everything the agent did for it. */
export interface AgentTurn {
    id: number;
    prompt: string;
    items: AgentTurnItem[];
    state: AgentTurnState;
    /** The snapshot taken before the turn's first edit: rolling back to it undoes the whole turn. */
    undoSnapshotId: string | null;
    error: string | null;
    totalTokens: number;
}

export function startTurn(id: number, prompt: string): AgentTurn {
    return { id, prompt, items: [], state: "running", undoSnapshotId: null, error: null, totalTokens: 0 };
}

/** Appends a streamed delta, extending the last item when it is of the same kind. */
function appendDelta(items: AgentTurnItem[], kind: "text" | "thinking", delta: string): AgentTurnItem[] {
    const last = items[items.length - 1];
    if (last?.kind === kind) {
        return [...items.slice(0, -1), { kind, text: last.text + delta }];
    }
    return [...items, { kind, text: delta }];
}

type CompactionEvent = Extract<StoryAgentEvent, { type: "compaction" }>;

/** A compaction shows as one item: added running at `start`, settled at `end`. */
function applyCompaction(items: AgentTurnItem[], event: CompactionEvent): AgentTurnItem[] {
    if (event.phase === "start") {
        return [...items, { kind: "compaction", state: "running", tokensBefore: event.tokensBefore }];
    }
    return items.map((item) =>
        item.kind === "compaction" && item.state === "running"
            ? { ...item, state: event.error ? "failed" : "done", tokensAfter: event.tokensAfter, error: event.error }
            : item,
    );
}

/** A turn read back from storage: a run cut off by a reload ended there, and its snapshots are gone. */
export function restoreTurn(turn: AgentTurn): AgentTurn {
    const items = turn.items.map((item) =>
        item.kind === "tool" && item.state === "running" ? { ...item, state: "error" as const } : item,
    );
    return { ...turn, items, state: turn.state === "running" ? "aborted" : turn.state, undoSnapshotId: null };
}

/** Folds one agent event into the turn it belongs to. */
export function applyAgentEvent(turn: AgentTurn, event: StoryAgentEvent): AgentTurn {
    switch (event.type) {
        case "text_delta":
            return { ...turn, items: appendDelta(turn.items, "text", event.delta) };
        case "thinking_delta":
            return { ...turn, items: appendDelta(turn.items, "thinking", event.delta) };
        case "tool_start":
            return {
                ...turn,
                items: [
                    ...turn.items,
                    { kind: "tool", toolCallId: event.toolCallId, toolName: event.toolName, state: "running", summary: "" },
                ],
            };
        case "tool_end":
            return {
                ...turn,
                items: turn.items.map((item) =>
                    item.kind === "tool" && item.toolCallId === event.toolCallId
                        ? { ...item, state: event.isError ? "error" : "ok", summary: event.summary }
                        : item,
                ),
            };
        case "msk_diff":
            return { ...turn, items: [...turn.items, { kind: "diff", diff: event.diff }] };
        case "snapshot_created":
            return turn.undoSnapshotId ? turn : { ...turn, undoSnapshotId: event.snapshot.id };
        case "compaction":
            return { ...turn, items: applyCompaction(turn.items, event) };
        case "error":
            return { ...turn, error: event.message };
        case "done":
            return {
                ...turn,
                state: event.aborted ? "aborted" : turn.error ? "error" : "done",
                totalTokens: event.stats?.totalTokens ?? turn.totalTokens,
            };
        default:
            return turn;
    }
}

/** Marks a diff's nodes on top of earlier marks; a node added earlier stays "added". */
export function mergeNodeChanges(
    marks: ReadonlyMap<string, StoryNodeChange>,
    diff: StoryMskDiff,
): Map<string, StoryNodeChange> {
    const next = new Map(marks);
    for (const id of diff.removedNodeIds) next.delete(id);
    for (const id of diff.modifiedNodeIds) if (!next.has(id)) next.set(id, "modified");
    for (const id of diff.addedNodeIds) next.set(id, "added");
    return next;
}
