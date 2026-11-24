import { describe, expect, test } from "bun:test";
import {
    applyAgentEventToTurns,
    clampAgentPanelWidth,
    DEFAULT_AGENT_PANEL_WIDTH,
    formatElapsedSeconds,
    getActiveRetryEntry,
    getAgentToolLabelKey,
    getMaxAgentPanelWidth,
    getRecoveredRetries,
    getTurnThinkingDurationMs,
    groupToolCalls,
    isTurnThinkingLive,
    MAX_AGENT_PANEL_WIDTH,
    MIN_AGENT_PANEL_WIDTH,
    summarizeToolArgs,
    toggleTurnRetryCollapsed,
    toggleTurnThinkingCollapsed,
    type AgentChatTurn,
} from "../src/shared/agent-panel-state.ts";

describe("agent-panel-state width clamping", () => {
    test("enforces min 280px, max 720px, and 55% viewport ratio cap", () => {
        expect(clampAgentPanelWidth(120, 1440)).toBe(MIN_AGENT_PANEL_WIDTH);
        expect(clampAgentPanelWidth(900, 1600)).toBe(MAX_AGENT_PANEL_WIDTH);
        // 1280 * 0.55 = 704 (< 720)
        expect(getMaxAgentPanelWidth(1280)).toBe(704);
        expect(clampAgentPanelWidth(720, 1280)).toBe(704);
        // 1024 * 0.55 = 563
        expect(getMaxAgentPanelWidth(1024)).toBe(563);
        expect(clampAgentPanelWidth(650, 1024)).toBe(563);
        // Very narrow viewport still respects MIN_AGENT_PANEL_WIDTH
        expect(getMaxAgentPanelWidth(400)).toBe(MIN_AGENT_PANEL_WIDTH);
        expect(clampAgentPanelWidth(Number.NaN, 1366)).toBe(DEFAULT_AGENT_PANEL_WIDTH);
    });
});

describe("agent-panel-state duration formatting and tool metadata", () => {
    test("formats sub-second, second, and minute durations cleanly", () => {
        expect(formatElapsedSeconds(0)).toBe("0.0s");
        expect(formatElapsedSeconds(420)).toBe("0.4s");
        expect(formatElapsedSeconds(4200)).toBe("4.2s");
        expect(formatElapsedSeconds(11840)).toBe("11.8s");
        expect(formatElapsedSeconds(72000)).toBe("1m 12s");
    });

    test("maps known tools to i18n keys and summarizes args concisely", () => {
        expect(getAgentToolLabelKey("story_read_workspace")).toBe("agentToolLabelReadWorkspace");
        expect(getAgentToolLabelKey("story_mine_official")).toBe("agentToolLabelMineOfficial");
        expect(getAgentToolLabelKey("story_validate_and_simulate")).toBe("agentToolLabelValidate");
        expect(getAgentToolLabelKey("unknown_tool")).toBeNull();

        expect(summarizeToolArgs("story_mine_official", { action: "study", unit: "25ji", query: "奏" })).toBe(
            "study · 25ji · 奏",
        );
        expect(summarizeToolArgs("story_patch_msk", { nodeId: "scene_06_climax", operations: [{}, {}] })).toBe(
            "scene_06_climax · 2 ops",
        );
    });
});

describe("agent-panel-state thinking auto-collapse and tool grouping reducer", () => {
    test("tracks live thinking elapsed time and auto-collapses when thinking finishes", () => {
        let turns: AgentChatTurn[] = [];
        let activeId: string | null = null;

        // Thinking starts
        let res = applyAgentEventToTurns(
            turns,
            activeId,
            { type: "thinking_delta", delta: "Analyzing scenes...", timestamp: 1_000 },
            () => "turn_1",
        );
        turns = res.turns;
        activeId = res.activeTurnId;

        expect(turns).toHaveLength(1);
        expect(turns[0].thinkingCollapsed).toBe(false);
        expect(turns[0].thinkingStartedAt).toBe(1_000);
        expect(turns[0].thinkingEndedAt).toBeUndefined();
        expect(isTurnThinkingLive(turns[0], true)).toBe(true);
        expect(getTurnThinkingDurationMs(turns[0], 3_400)).toBe(2_400);

        // First text_delta ends thinking and auto-collapses it
        res = applyAgentEventToTurns(turns, activeId, {
            type: "text_delta",
            delta: "Done!",
            timestamp: 5_200,
        });
        turns = res.turns;
        activeId = res.activeTurnId;

        expect(turns[0].thinkingEndedAt).toBe(5_200);
        expect(turns[0].thinkingCollapsed).toBe(true);
        expect(isTurnThinkingLive(turns[0], true)).toBe(false);
        expect(getTurnThinkingDurationMs(turns[0], 9_999)).toBe(4_200);

        // Clicking toggle expands it cleanly
        turns = toggleTurnThinkingCollapsed(turns, "turn_1");
        expect(turns[0].thinkingCollapsed).toBe(false);
    });

    test("auto-collapses all finished tools (including occasional errors), groups them together, and keeps running tools standalone", () => {
        let turns: AgentChatTurn[] = [];
        let activeId: string | null = null;

        const dispatch = (ev: Parameters<typeof applyAgentEventToTurns>[2]) => {
            const r = applyAgentEventToTurns(turns, activeId, ev, () => "turn_tools");
            turns = r.turns;
            activeId = r.activeTurnId;
        };

        dispatch({ type: "tool_start", toolCallId: "t1", toolName: "story_read_workspace", args: {}, timestamp: 1000 });
        expect(turns[0].tools?.[0].collapsed).toBe(false);
        expect(turns[0].tools?.[0].status).toBe("running");

        dispatch({ type: "tool_end", toolCallId: "t1", toolName: "story_read_workspace", isError: false, summary: "ok", durationMs: 400, timestamp: 1400 });
        dispatch({ type: "tool_start", toolCallId: "t2", toolName: "story_mine_official", args: {}, timestamp: 1500 });
        dispatch({ type: "tool_end", toolCallId: "t2", toolName: "story_mine_official", isError: false, summary: "ok", durationMs: 1100, timestamp: 2600 });
        dispatch({ type: "tool_start", toolCallId: "t3", toolName: "story_mine_official", args: { action: "inspect" }, timestamp: 2700 });
        dispatch({ type: "tool_end", toolCallId: "t3", toolName: "story_mine_official", isError: true, summary: "Unit chapter 'nightcode_01' not found on region 'jp'.", durationMs: 250, timestamp: 2950 });
        dispatch({ type: "tool_start", toolCallId: "t4", toolName: "story_validate_and_simulate", args: {}, timestamp: 3000 });
        dispatch({ type: "tool_end", toolCallId: "t4", toolName: "story_validate_and_simulate", isError: false, summary: "ok", durationMs: 350, timestamp: 3350 });
        dispatch({ type: "tool_start", toolCallId: "t5", toolName: "story_patch_msk", args: {}, timestamp: 3400 });

        const tools = turns[0].tools ?? [];
        expect(tools[0].collapsed).toBe(true);
        expect(tools[1].collapsed).toBe(true);
        expect(tools[2].collapsed).toBe(true); // error tool auto-collapses cleanly too
        expect(tools[2].status).toBe("error");
        expect(tools[3].collapsed).toBe(true);
        expect(tools[4].status).toBe("running");
        expect(tools[4].collapsed).toBe(false);

        const grouped = groupToolCalls(tools);
        expect(grouped).toHaveLength(2);
        expect(grouped[0].kind).toBe("group");
        if (grouped[0].kind === "group") {
            expect(grouped[0].tools).toHaveLength(4);
            expect(grouped[0].totalDurationMs).toBe(2100);
            expect(grouped[0].errorCount).toBe(1);
            expect(grouped[0].id).toBe("group_t1");
        }
        expect(grouped[1].kind).toBe("single");
        if (grouped[1].kind === "single") {
            expect(grouped[1].tool.status).toBe("running");
        }

        // Consecutive pure-error calls also fold cleanly into a single group with errorCount === tools.length
        const onlyErrors = groupToolCalls([
            {
                toolCallId: "e1",
                toolName: "story_mine_official",
                args: { action: "inspect" },
                status: "error",
                startedAt: 100,
                endedAt: 250,
                durationMs: 150,
                summary: "not found 1",
                collapsed: true,
            },
            {
                toolCallId: "e2",
                toolName: "story_mine_official",
                args: { action: "inspect" },
                status: "error",
                startedAt: 300,
                endedAt: 500,
                durationMs: 200,
                summary: "not found 2",
                collapsed: true,
            },
        ]);
        expect(onlyErrors).toHaveLength(1);
        expect(onlyErrors[0].kind).toBe("group");
        if (onlyErrors[0].kind === "group") {
            expect(onlyErrors[0].tools).toHaveLength(2);
            expect(onlyErrors[0].errorCount).toBe(2);
            expect(onlyErrors[0].totalDurationMs).toBe(350);
        }
    });

    test("settles unfinished running tools when a turn finishes or fails fatally", () => {
        let turns: AgentChatTurn[] = [];
        let activeId: string | null = null;

        let res = applyAgentEventToTurns(
            turns,
            activeId,
            { type: "tool_start", toolCallId: "stuck_1", toolName: "story_validate_and_simulate", args: {}, timestamp: 1000 },
            () => "turn_settle",
        );
        turns = res.turns;
        activeId = res.activeTurnId;

        // Turn terminates with done while tool was still marked running
        res = applyAgentEventToTurns(turns, activeId, {
            type: "done",
            aborted: false,
            finalText: "Finished",
            timestamp: 2500,
        });
        turns = res.turns;
        expect(turns[0].tools?.[0].status).toBe("done");
        expect(turns[0].tools?.[0].durationMs).toBe(1500);
        expect(turns[0].tools?.[0].collapsed).toBe(true);

        // Terminal error settles running tools as error instead of stuck running
        let errTurns: AgentChatTurn[] = [];
        let errActive: string | null = null;
        let errRes = applyAgentEventToTurns(
            errTurns,
            errActive,
            { type: "tool_start", toolCallId: "stuck_2", toolName: "story_validate_and_simulate", args: {}, timestamp: 1000 },
            () => "turn_err",
        );
        errTurns = errRes.turns;
        errActive = errRes.activeTurnId;
        errRes = applyAgentEventToTurns(errTurns, errActive, {
            type: "error",
            message: "Fatal auth error",
            recoverable: false,
            timestamp: 2000,
        });
        expect(errRes.turns[0].tools?.[0].status).toBe("error");
        expect(errRes.turns[0].tools?.[0].collapsed).toBe(true);
        expect(errRes.turns[0].error).toBe("Fatal auth error");
        expect(errRes.activeTurnId).toBeNull();
    });
});

describe("agent-panel-state retry tracking and auto-collapse on recovery", () => {
    test("shows live retry state during retry_start and auto-collapses into recovered pill on retry_end(success=true)", () => {
        let turns: AgentChatTurn[] = [];
        let activeId: string | null = null;

        let res = applyAgentEventToTurns(
            turns,
            activeId,
            {
                type: "retry_start",
                attempt: 1,
                maxAttempts: 3,
                delayMs: 1500,
                errorMessage: "UND_ERR_CONNECT_TIMEOUT",
                code: "UND_ERR_CONNECT_TIMEOUT",
                timestamp: 1000,
            },
            () => "turn_retry",
        );
        turns = res.turns;
        activeId = res.activeTurnId;

        expect(activeId).toBe("turn_retry");
        expect(getActiveRetryEntry(turns[0])?.attempt).toBe(1);
        expect(turns[0].retryNoticeCollapsed).toBe(false);
        expect(turns[0].error).toBeUndefined();

        res = applyAgentEventToTurns(turns, activeId, {
            type: "retry_end",
            attempt: 1,
            maxAttempts: 3,
            success: true,
            timestamp: 2600,
        });
        turns = res.turns;
        activeId = res.activeTurnId;

        expect(getActiveRetryEntry(turns[0])).toBeNull();
        expect(getRecoveredRetries(turns[0])).toHaveLength(1);
        expect(turns[0].retryNoticeCollapsed).toBe(true);
        expect(turns[0].error).toBeUndefined();

        // Expandable on user click
        turns = toggleTurnRetryCollapsed(turns, "turn_retry");
        expect(turns[0].retryNoticeCollapsed).toBe(false);
    });

    test("defensively recovers recoverable error if stream resumes with text_delta", () => {
        let turns: AgentChatTurn[] = [];
        let activeId: string | null = null;

        let res = applyAgentEventToTurns(
            turns,
            activeId,
            {
                type: "error",
                message: "Request timed out: UND_ERR_CONNECT_TIMEOUT",
                code: "UND_ERR_CONNECT_TIMEOUT",
                recoverable: true,
                timestamp: 1000,
            },
            () => "turn_defensive",
        );
        turns = res.turns;
        activeId = res.activeTurnId;

        expect(activeId).toBe("turn_defensive");
        expect(getActiveRetryEntry(turns[0])).not.toBeNull();
        expect(turns[0].error).toBeUndefined();

        // Subsequent text_delta marks it recovered and collapses notice
        res = applyAgentEventToTurns(turns, activeId, {
            type: "text_delta",
            delta: "Recovered cleanly!",
            timestamp: 3000,
        });
        turns = res.turns;
        expect(getActiveRetryEntry(turns[0])).toBeNull();
        expect(getRecoveredRetries(turns[0])).toHaveLength(1);
        expect(turns[0].retryNoticeCollapsed).toBe(true);
        expect(turns[0].text).toBe("Recovered cleanly!");
    });
});
