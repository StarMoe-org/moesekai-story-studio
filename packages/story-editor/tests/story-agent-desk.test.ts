import { describe, expect, test } from "bun:test";
import { applyAgentEvent, restoreTurn, startTurn } from "../src/agent/agentTurns";
import { createMemoryConversationArchive, type StoredConversation } from "../src/agent/conversationArchive";
import { StoryAgentDesk } from "../src/agent/storyAgentDesk";
import type { StoryAgentTarget } from "../src/agent/target";

function saved(id: string, updatedAt: number): StoredConversation {
    return { id, storyKey: "draft-1", title: id, updatedAt, turns: [{ ...startTurn(1, "hi"), undoSnapshotId: "s1" }], transcript: [] };
}

const loaded = (desk: StoryAgentDesk) =>
    new Promise<void>((resolve) => {
        if (desk.getState().loaded) return resolve();
        const stop = desk.subscribe(() => {
            if (desk.getState().loaded) {
                stop();
                resolve();
            }
        });
    });

describe("story agent conversations", () => {
    test("a turn cut off by a reload comes back aborted, without an undo point", () => {
        const turn = restoreTurn({ ...startTurn(1, "edit"), undoSnapshotId: "s1" });
        expect(turn.state).toBe("aborted");
        expect(turn.undoSnapshotId).toBeNull();
    });

    test("a compaction shows as one item that settles in place", () => {
        let turn = applyAgentEvent(startTurn(1, "edit"), { type: "compaction", phase: "start", tokensBefore: 120_000, timestamp: 0 });
        turn = applyAgentEvent(turn, { type: "compaction", phase: "end", tokensBefore: 120_000, tokensAfter: 9_000, timestamp: 0 });
        expect(turn.items).toEqual([{ kind: "compaction", state: "done", tokensBefore: 120_000, tokensAfter: 9_000, error: undefined }]);
    });

    test("the desk opens the most recent saved conversation of its story", async () => {
        const archive = createMemoryConversationArchive();
        await archive.save(saved("older", 1));
        await archive.save(saved("newer", 2));
        await archive.save({ ...saved("other story", 3), storyKey: "draft-2" });
        const desk = new StoryAgentDesk("draft-1", archive);
        await loaded(desk);
        const state = desk.getState();
        expect(state.conversations.map(c => c.id)).toEqual(["newer", "older"]);
        expect(state.conversation.id).toBe("newer");
        expect(state.conversation.turns[0].state).toBe("aborted");
    });

    test("removing the open conversation starts a new one", async () => {
        const archive = createMemoryConversationArchive();
        await archive.save(saved("only", 1));
        const desk = new StoryAgentDesk("draft-1", archive);
        await loaded(desk);
        await desk.remove("only");
        expect(desk.getState().conversations).toEqual([]);
        expect(desk.getState().conversation.turns).toEqual([]);
        expect(await archive.list("draft-1")).toEqual([]);
    });

    test("an attached target receives the current marks and loses them on a new conversation", async () => {
        const desk = new StoryAgentDesk("draft-1", createMemoryConversationArchive());
        await loaded(desk);
        const shown: Array<ReadonlyMap<string, string> | null> = [];
        const target: StoryAgentTarget = {
            storyKey: "draft-1",
            currentDoc: () => null,
            applyScript: () => undefined,
            promptContext: () => ({}),
            showNodeChanges: changes => shown.push(changes),
        };
        const detach = desk.attach(target);
        desk.newConversation();
        detach();
        expect(shown).toEqual([null, null]);
    });
});
