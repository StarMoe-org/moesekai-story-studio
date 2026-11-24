import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
    SUMMARY_OPEN,
    compactTranscript,
    estimateTextTokens,
    findCompactionCut,
    summaryRequest,
} from "../src/compaction";

const system = (text: string): AgentMessage => ({ role: "system", content: text, timestamp: 0 });
const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });
const toolResult = (text: string): AgentMessage => ({
    role: "toolResult", toolCallId: "c", toolName: "story_read", content: [{ type: "text", text }], isError: false, timestamp: 0,
});

describe("compaction", () => {
    test("CJK characters count as one token each, other text as one per four characters", () => {
        expect(estimateTextTokens("abcdefgh")).toBe(2);
        expect(estimateTextTokens("瑞希和绘名")).toBe(5);
    });

    test("the cut lands on a user turn and keeps at least the recent budget", () => {
        const messages = [system("prompt"), user("a".repeat(400)), toolResult("b".repeat(400)), user("c".repeat(400)), toolResult("d".repeat(400))];
        expect(findCompactionCut(messages, 150)).toBe(3);
        expect(findCompactionCut(messages, 10_000)).toBeNull();
    });

    test("with no recent budget the cut keeps only the latest request", () => {
        const messages = [user("first"), toolResult("r1"), user("second"), toolResult("r2"), user("third"), toolResult("r3")];
        expect(findCompactionCut(messages, 0)).toBe(4);
    });

    test("a single turn is never compacted", () => {
        expect(findCompactionCut([system("prompt"), user("a".repeat(4000))], 1)).toBeNull();
    });

    test("the compacted transcript keeps system messages, then the summary, then the recent turns", () => {
        const messages = [system("prompt"), user("old"), system("tools changed"), toolResult("old result"), user("new")];
        const compacted = compactTranscript(messages, 4, "they asked for a rooftop scene");
        expect(compacted.map((m) => (m as { role: string }).role)).toEqual(["system", "system", "user", "user"]);
        expect((compacted[2] as { content: string }).content).toContain(SUMMARY_OPEN);
        expect(compacted[3]).toBe(messages[4]);
    });

    test("the summary request quotes the dropped turns without system messages", () => {
        const [request] = summaryRequest([system("secret prompt"), user("make it rain"), toolResult("ok")]);
        expect(request.content).toContain("[User]\nmake it rain");
        expect(request.content).toContain("[Tool story_read]\nok");
        expect(request.content).not.toContain("secret prompt");
    });
});
