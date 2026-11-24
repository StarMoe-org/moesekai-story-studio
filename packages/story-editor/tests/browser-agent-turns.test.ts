import { describe, expect, test } from "bun:test";
import type { StoryMskDiff } from "@moesekai/story-agent/browser";
import { applyAgentEvent, mergeNodeChanges, startTurn } from "../src/agent/agentTurns";
import { STORY_MAKER_MESSAGES_BY_LOCALE } from "../src/messages";

function diff(partial: Partial<StoryMskDiff>): StoryMskDiff {
    return {
        snapshotId: null, storyFile: "story.msk",
        addedNodeIds: [], removedNodeIds: [], modifiedNodeIds: [],
        addedCastKeys: [], removedCastKeys: [], modifiedCastKeys: [],
        addedVarIds: [], removedVarIds: [], modifiedVarIds: [],
        nodeCountBefore: 0, nodeCountAfter: 0, beatCountBefore: 0, beatCountAfter: 0, beatCountDelta: 0,
        compileOk: true, errorCount: 0, warningCount: 0, unifiedDiffPreview: "",
        ...partial,
    };
}

describe("browser agent turns", () => {
    test("streamed deltas extend the item of the same kind", () => {
        let turn = startTurn(1, "add a scene");
        for (const delta of ["Let", " me"]) turn = applyAgentEvent(turn, { type: "thinking_delta", delta, timestamp: 0 });
        for (const delta of ["Done", "."]) turn = applyAgentEvent(turn, { type: "text_delta", delta, timestamp: 0 });
        expect(turn.items).toEqual([
            { kind: "thinking", text: "Let me" },
            { kind: "text", text: "Done." },
        ]);
    });

    test("a tool call settles in place and the first snapshot is the undo point", () => {
        let turn = startTurn(1, "edit");
        turn = applyAgentEvent(turn, { type: "tool_start", toolCallId: "c1", toolName: "patch", args: {}, timestamp: 0 });
        turn = applyAgentEvent(turn, {
            type: "snapshot_created",
            snapshot: { id: "s1", createdAt: "", reason: "", storyFile: "story.msk", nodeCount: 0, beatCount: 0, byteLength: 0, sha256: "" },
            timestamp: 0,
        });
        turn = applyAgentEvent(turn, {
            type: "snapshot_created",
            snapshot: { id: "s2", createdAt: "", reason: "", storyFile: "story.msk", nodeCount: 0, beatCount: 0, byteLength: 0, sha256: "" },
            timestamp: 0,
        });
        turn = applyAgentEvent(turn, { type: "tool_end", toolCallId: "c1", toolName: "patch", isError: false, summary: "ok", timestamp: 0 });
        turn = applyAgentEvent(turn, { type: "done", aborted: false, finalText: "", timestamp: 0 });
        expect(turn.items).toEqual([{ kind: "tool", toolCallId: "c1", toolName: "patch", state: "ok", summary: "ok" }]);
        expect(turn.undoSnapshotId).toBe("s1");
        expect(turn.state).toBe("done");
    });

    test("an error before done ends the turn as failed", () => {
        let turn = applyAgentEvent(startTurn(1, "edit"), { type: "error", message: "401", timestamp: 0 });
        turn = applyAgentEvent(turn, { type: "done", aborted: false, finalText: "", timestamp: 0 });
        expect(turn.state).toBe("error");
        expect(turn.error).toBe("401");
    });

    test("node marks keep added nodes added and drop removed ones", () => {
        let marks = mergeNodeChanges(new Map(), diff({ addedNodeIds: ["a"], modifiedNodeIds: ["b"] }));
        marks = mergeNodeChanges(marks, diff({ modifiedNodeIds: ["a", "c"], removedNodeIds: ["b"] }));
        expect([...marks]).toEqual([["a", "added"], ["c", "modified"]]);
    });

    test("every locale names each agent status and change kind", () => {
        for (const messages of Object.values(STORY_MAKER_MESSAGES_BY_LOCALE)) {
            expect(Object.keys(messages.agent.status).sort()).toEqual(
                ["aborted", "error", "idle", "retrying", "starting", "streaming", "thinking", "tool_running"],
            );
            expect(Object.keys(messages.agent.change).sort()).toEqual(["added", "modified"]);
        }
    });
});
