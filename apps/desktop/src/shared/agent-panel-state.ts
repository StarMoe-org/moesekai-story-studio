import type {
    AgentMskDiffSummary,
    AgentWorkflowPlan,
    DesktopAgentEvent,
} from "./ipc.ts";

export const DEFAULT_AGENT_PANEL_WIDTH = 340;
export const MIN_AGENT_PANEL_WIDTH = 280;
export const MAX_AGENT_PANEL_WIDTH = 720;
export const MAX_AGENT_PANEL_VIEWPORT_RATIO = 0.55;

export function getMaxAgentPanelWidth(viewportWidth?: number): number {
    if (typeof viewportWidth !== "number" || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
        return MAX_AGENT_PANEL_WIDTH;
    }
    const ratioCap = Math.floor(viewportWidth * MAX_AGENT_PANEL_VIEWPORT_RATIO);
    return Math.max(MIN_AGENT_PANEL_WIDTH, Math.min(MAX_AGENT_PANEL_WIDTH, ratioCap));
}

export function clampAgentPanelWidth(width: number, viewportWidth?: number): number {
    if (typeof width !== "number" || !Number.isFinite(width)) {
        return Math.min(DEFAULT_AGENT_PANEL_WIDTH, getMaxAgentPanelWidth(viewportWidth));
    }
    const maxWidth = getMaxAgentPanelWidth(viewportWidth);
    return Math.round(Math.max(MIN_AGENT_PANEL_WIDTH, Math.min(maxWidth, width)));
}

export function formatElapsedSeconds(ms: number): string {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const totalSeconds = safeMs / 1000;
    if (totalSeconds >= 60) {
        const mins = Math.floor(totalSeconds / 60);
        const remSecs = Math.round(totalSeconds - mins * 60);
        if (remSecs === 60) {
            return `${mins + 1}m 0s`;
        }
        return `${mins}m ${remSecs}s`;
    }
    return `${totalSeconds.toFixed(1)}s`;
}

export type AgentToolLabelKey =
    | "agentToolLabelReadWorkspace"
    | "agentToolLabelMineOfficial"
    | "agentToolLabelWriteMsk"
    | "agentToolLabelPatchMsk"
    | "agentToolLabelValidate"
    | "agentToolLabelI18nPrepare"
    | "agentToolLabelI18nApply"
    | "agentToolLabelSubmitPlan"
    | "agentToolLabelReportStage"
    | "agentToolLabelEditorAction";

export const AGENT_TOOL_LABEL_KEYS: Record<string, AgentToolLabelKey> = {
    story_read_workspace: "agentToolLabelReadWorkspace",
    story_mine_official: "agentToolLabelMineOfficial",
    story_write_msk: "agentToolLabelWriteMsk",
    story_patch_msk: "agentToolLabelPatchMsk",
    story_validate_and_simulate: "agentToolLabelValidate",
    story_i18n_prepare: "agentToolLabelI18nPrepare",
    story_i18n_apply: "agentToolLabelI18nApply",
    story_submit_plan: "agentToolLabelSubmitPlan",
    story_report_stage: "agentToolLabelReportStage",
    story_editor_action: "agentToolLabelEditorAction",
};

export function getAgentToolLabelKey(toolName: string): AgentToolLabelKey | null {
    return AGENT_TOOL_LABEL_KEYS[toolName] ?? null;
}

function truncateHint(text: string, maxLen = 44): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 1)}…`;
}

export function summarizeToolArgs(toolName: string, args: Record<string, unknown> | undefined | null): string {
    if (!args || typeof args !== "object") return "";
    const pickStr = (key: string): string | null => {
        const v = args[key];
        return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const pickNum = (key: string): number | null => {
        const v = args[key];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const pickBool = (key: string): boolean | null => {
        const v = args[key];
        return typeof v === "boolean" ? v : null;
    };

    const parts: string[] = [];

    switch (toolName) {
        case "story_read_workspace": {
            const file = pickStr("file") ?? pickStr("storyFile") ?? pickStr("path");
            if (file) parts.push(file);
            if (pickBool("includeLocales")) parts.push("locales");
            if (pickBool("includeVoices")) parts.push("voices");
            break;
        }
        case "story_mine_official": {
            const action = pickStr("action");
            const unit = pickStr("unit") ?? pickStr("unitKey");
            const query = pickStr("query") ?? pickStr("keyword") ?? pickStr("character");
            const eventId = pickNum("eventId");
            if (action) parts.push(action);
            if (unit) parts.push(unit);
            if (eventId !== null) parts.push(`event #${eventId}`);
            if (query) parts.push(query);
            break;
        }
        case "story_write_msk":
        case "story_patch_msk": {
            const nodeId = pickStr("nodeId") ?? pickStr("targetNodeId");
            const reason = pickStr("reason") ?? pickStr("summary") ?? pickStr("description");
            const ops = Array.isArray(args.operations) ? args.operations.length : Array.isArray(args.patches) ? args.patches.length : null;
            if (nodeId) parts.push(nodeId);
            if (ops !== null && ops > 0) parts.push(`${ops} ops`);
            if (reason) parts.push(reason);
            break;
        }
        case "story_validate_and_simulate": {
            const region = pickStr("region");
            const checkAssets = pickBool("verifyAssets") ?? pickBool("checkAssets");
            const strict = pickBool("strict");
            if (region) parts.push(region.toUpperCase());
            if (strict) parts.push("strict");
            if (checkAssets) parts.push("assets");
            break;
        }
        case "story_i18n_prepare":
        case "story_i18n_apply": {
            const targetLocale = pickStr("targetLocale") ?? pickStr("locale");
            const locales = Array.isArray(args.locales)
                ? args.locales.filter((x): x is string => typeof x === "string").join(", ")
                : null;
            if (targetLocale) parts.push(targetLocale);
            else if (locales) parts.push(locales);
            break;
        }
        case "story_submit_plan": {
            const title = pickStr("title");
            if (title) parts.push(title);
            break;
        }
        case "story_report_stage": {
            const stage = pickStr("stage");
            const status = pickStr("status");
            if (stage) parts.push(status ? `${stage}:${status}` : stage);
            break;
        }
        case "story_editor_action": {
            const kind = pickStr("kind") ?? pickStr("action");
            const nodeId = pickStr("nodeId");
            if (kind) parts.push(kind);
            if (nodeId) parts.push(nodeId);
            break;
        }
        default: {
            for (const [k, v] of Object.entries(args)) {
                if (typeof v === "string" && v.trim()) {
                    parts.push(`${k}=${v.trim()}`);
                    break;
                }
                if (typeof v === "number" && Number.isFinite(v)) {
                    parts.push(`${k}=${v}`);
                    break;
                }
            }
            break;
        }
    }

    if (parts.length === 0) return "";
    return truncateHint(parts.join(" · "));
}

export interface AgentToolCallEntry {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: "running" | "done" | "error";
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    summary?: string;
    details?: unknown;
    /** Auto-collapsed once finished (both succeeded and errored calls collapse by default). */
    collapsed: boolean;
}

export interface AgentRetryEntry {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
    code?: string;
    startedAt: number;
    endedAt?: number;
    status: "retrying" | "recovered" | "failed";
}

export interface AgentChatTurn {
    id: string;
    role: "user" | "assistant";
    text: string;
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingEndedAt?: number;
    /** Starts false while actively thinking; auto-collapses to true as soon as thinking completes. */
    thinkingCollapsed: boolean;
    /** Set when user manually toggles thinking block so auto-collapse respects their explicit choice after end. */
    thinkingUserExpanded?: boolean;
    tools?: AgentToolCallEntry[];
    diffs?: AgentMskDiffSummary[];
    plan?: AgentWorkflowPlan;
    planAwaitingApproval?: boolean;
    retries?: AgentRetryEntry[];
    /** Auto-collapses to true when retries recover; expands cleanly on click to inspect timeout details. */
    retryNoticeCollapsed: boolean;
    error?: string;
    aborted?: boolean;
    stats?: { inputTokens: number; outputTokens: number; totalTokens: number; toolCalls: number };
    timestamp: number;
    startedAt: number;
    endedAt?: number;
}

export type GroupedToolDisplayItem =
    | {
        kind: "single";
        id: string;
        tool: AgentToolCallEntry;
    }
    | {
        kind: "group";
        id: string;
        tools: AgentToolCallEntry[];
        totalDurationMs: number;
        errorCount: number;
    };

/**
 * Groups consecutive finished tool calls (`status === "done" || status === "error"`) into a single
 * auto-collapsed summary pill when there are 2 or more consecutive finished calls,
 * while keeping actively `running` tool calls standalone and clearly visible.
 */
export function groupToolCalls(tools: AgentToolCallEntry[]): GroupedToolDisplayItem[] {
    if (!tools || tools.length === 0) return [];

    const result: GroupedToolDisplayItem[] = [];
    let settledRun: AgentToolCallEntry[] = [];

    const flushSettled = () => {
        if (settledRun.length === 0) return;
        if (settledRun.length === 1) {
            const single = settledRun[0];
            result.push({
                kind: "single",
                id: single.toolCallId,
                tool: single,
            });
        } else {
            const totalDurationMs = settledRun.reduce(
                (acc, item) => acc + (item.durationMs ?? (item.endedAt ? Math.max(0, item.endedAt - item.startedAt) : 0)),
                0,
            );
            const errorCount = settledRun.reduce(
                (acc, item) => acc + (item.status === "error" ? 1 : 0),
                0,
            );
            result.push({
                kind: "group",
                id: `group_${settledRun[0].toolCallId}`,
                tools: settledRun,
                totalDurationMs,
                errorCount,
            });
        }
        settledRun = [];
    };

    for (const tool of tools) {
        if (tool.status !== "running") {
            settledRun.push(tool);
        } else {
            flushSettled();
            result.push({
                kind: "single",
                id: tool.toolCallId,
                tool,
            });
        }
    }
    flushSettled();

    return result;
}

export function createAssistantTurn(id: string, timestamp: number): AgentChatTurn {
    return {
        id,
        role: "assistant",
        text: "",
        thinking: "",
        thinkingCollapsed: false,
        tools: [],
        diffs: [],
        retries: [],
        retryNoticeCollapsed: true,
        timestamp,
        startedAt: timestamp,
    };
}

export function isLikelyTransientNetworkError(message: string, code?: string): boolean {
    const combined = `${code ?? ""} ${message}`.toLowerCase();
    return (
        combined.includes("und_err_connect_timeout") ||
        combined.includes("connect timeout") ||
        combined.includes("etimedout") ||
        combined.includes("econnreset") ||
        combined.includes("epipe") ||
        combined.includes("econnrefused") ||
        combined.includes("fetch failed") ||
        combined.includes("request timed out") ||
        combined.includes("socket hang up") ||
        combined.includes("network") ||
        /\b(429|502|503|504)\b/.test(combined)
    );
}

export function finalizeThinkingIfActive(turn: AgentChatTurn, timestamp: number): AgentChatTurn {
    if (!turn.thinking || turn.thinkingEndedAt !== undefined) {
        return turn;
    }
    return {
        ...turn,
        thinkingEndedAt: Math.max(timestamp, turn.thinkingStartedAt ?? timestamp),
        thinkingCollapsed: turn.thinkingUserExpanded ? false : true,
    };
}

/**
 * Defensive recovery helper: if the turn had an active retry OR a transient recoverable error
 * and subsequent stream activity (`text_delta`, `tool_start`, `tool_end`, `msk_diff`, `plan_proposed`,
 * or successful `done`) arrives, automatically mark it recovered and auto-collapse into a 1-line pill!
 */
export function markTransientRetriesRecovered(turn: AgentChatTurn, timestamp: number): AgentChatTurn {
    const hasRetrying = Boolean(turn.retries?.some(r => r.status === "retrying"));
    const hasRecoverableError = Boolean(turn.error && isLikelyTransientNetworkError(turn.error));

    if (!hasRetrying && !hasRecoverableError) {
        return turn;
    }

    const updatedRetries: AgentRetryEntry[] = (turn.retries ?? []).map(entry =>
        entry.status === "retrying"
            ? { ...entry, status: "recovered", endedAt: Math.max(timestamp, entry.startedAt) }
            : entry,
    );

    if (!hasRetrying && hasRecoverableError && turn.error) {
        updatedRetries.push({
            attempt: updatedRetries.length + 1,
            maxAttempts: Math.max(3, updatedRetries.length + 1),
            delayMs: 0,
            errorMessage: turn.error,
            startedAt: turn.startedAt,
            endedAt: Math.max(timestamp, turn.startedAt),
            status: "recovered",
        });
    }

    return {
        ...turn,
        retries: updatedRetries,
        retryNoticeCollapsed: true,
        error: undefined,
    };
}

/**
 * Ensures no tool call row is ever left stuck at `"running"` once a turn finishes or fails fatally.
 */
export function settleUnfinishedTools(
    tools: AgentToolCallEntry[] | undefined,
    timestamp: number,
    asError: boolean,
): AgentToolCallEntry[] {
    if (!tools || tools.length === 0) return [];
    return tools.map(tool => {
        if (tool.status !== "running") return tool;
        const durationMs = Math.max(0, timestamp - tool.startedAt);
        return {
            ...tool,
            status: asError ? "error" : "done",
            endedAt: timestamp,
            durationMs,
            collapsed: true,
        };
    });
}

export interface AgentTurnsReducerResult {
    turns: AgentChatTurn[];
    activeTurnId: string | null;
}

export function applyAgentEventToTurns(
    prevTurns: AgentChatTurn[],
    activeTurnId: string | null,
    ev: DesktopAgentEvent,
    createTurnId: (timestamp: number) => string = ts => `assistant_${ts}_${Math.random().toString(36).slice(2, 6)}`,
): AgentTurnsReducerResult {
    if (ev.type === "plan_resolved") {
        return {
            activeTurnId,
            turns: prevTurns.map(turn =>
                turn.plan && turn.plan.id === ev.planId
                    ? {
                        ...turn,
                        plan: {
                            ...turn.plan,
                            status: ev.decision === "approved" ? "approved" : "revised",
                        },
                        planAwaitingApproval: false,
                    }
                    : turn,
            ),
        };
    }

    if (
        ev.type !== "text_delta" &&
        ev.type !== "thinking_delta" &&
        ev.type !== "tool_start" &&
        ev.type !== "tool_end" &&
        ev.type !== "msk_diff" &&
        ev.type !== "plan_proposed" &&
        ev.type !== "retry_start" &&
        ev.type !== "retry_end" &&
        ev.type !== "error" &&
        ev.type !== "done"
    ) {
        return { turns: prevTurns, activeTurnId };
    }

    let next = [...prevTurns];
    let turnId = activeTurnId;

    if (!turnId || !next.some(item => item.id === turnId)) {
        turnId = createTurnId(ev.timestamp);
        next.push(createAssistantTurn(turnId, ev.timestamp));
    }

    next = next.map(rawItem => {
        if (rawItem.id !== turnId) return rawItem;

        if (ev.type === "retry_start") {
            const retries = [...(rawItem.retries ?? [])];
            retries.push({
                attempt: ev.attempt,
                maxAttempts: ev.maxAttempts,
                delayMs: ev.delayMs,
                errorMessage: ev.errorMessage,
                code: ev.code,
                startedAt: ev.timestamp,
                status: "retrying",
            });
            return {
                ...rawItem,
                retries,
                retryNoticeCollapsed: false,
                error: undefined,
            };
        }

        if (ev.type === "retry_end") {
            const existing = rawItem.retries ?? [];
            const retries: AgentRetryEntry[] =
                existing.length > 0
                    ? existing.map((entry, idx) =>
                        entry.status === "retrying" || idx === existing.length - 1
                            ? {
                                ...entry,
                                status: ev.success ? "recovered" : "failed",
                                endedAt: Math.max(ev.timestamp, entry.startedAt),
                            }
                            : entry,
                    )
                    : [
                        {
                            attempt: ev.attempt,
                            maxAttempts: ev.maxAttempts,
                            delayMs: 0,
                            errorMessage: ev.finalError || "",
                            startedAt: rawItem.startedAt,
                            endedAt: Math.max(ev.timestamp, rawItem.startedAt),
                            status: ev.success ? "recovered" : "failed",
                        },
                    ];

            if (ev.success) {
                return {
                    ...rawItem,
                    retries,
                    retryNoticeCollapsed: true,
                    error: undefined,
                };
            }

            const lastMsg = ev.finalError || retries[retries.length - 1]?.errorMessage || rawItem.error;
            return {
                ...rawItem,
                retries,
                retryNoticeCollapsed: true,
                error: lastMsg,
            };
        }

        if (ev.type === "thinking_delta") {
            const recovered = markTransientRetriesRecovered(rawItem, ev.timestamp);
            const startedAt = recovered.thinkingStartedAt ?? ev.timestamp;
            return {
                ...recovered,
                thinking: (recovered.thinking ?? "") + ev.delta,
                thinkingStartedAt: startedAt,
                thinkingEndedAt: undefined,
                thinkingCollapsed: recovered.thinkingUserExpanded === false ? true : false,
            };
        }

        if (ev.type === "text_delta") {
            const item = finalizeThinkingIfActive(markTransientRetriesRecovered(rawItem, ev.timestamp), ev.timestamp);
            return { ...item, text: item.text + ev.delta };
        }

        if (ev.type === "tool_start") {
            const item = finalizeThinkingIfActive(markTransientRetriesRecovered(rawItem, ev.timestamp), ev.timestamp);
            const tools = [...(item.tools ?? [])];
            tools.push({
                toolCallId: ev.toolCallId,
                toolName: ev.toolName,
                args: ev.args,
                status: "running",
                startedAt: ev.timestamp,
                collapsed: false,
            });
            return { ...item, tools };
        }

        if (ev.type === "tool_end") {
            const item = finalizeThinkingIfActive(markTransientRetriesRecovered(rawItem, ev.timestamp), ev.timestamp);
            const tools = (item.tools ?? []).map(tool => {
                if (tool.toolCallId !== ev.toolCallId) return tool;
                const computedDuration =
                    typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs)
                        ? Math.max(0, ev.durationMs)
                        : Math.max(0, ev.timestamp - tool.startedAt);
                return {
                    ...tool,
                    status: (ev.isError ? "error" : "done") as "done" | "error",
                    endedAt: ev.timestamp,
                    durationMs: computedDuration,
                    summary: ev.summary,
                    details: ev.details,
                    // Auto-collapse finished tools (including occasional recoverable tool errors)
                    collapsed: true,
                };
            });
            return { ...item, tools };
        }

        if (ev.type === "msk_diff") {
            const item = finalizeThinkingIfActive(markTransientRetriesRecovered(rawItem, ev.timestamp), ev.timestamp);
            const diffs = [...(item.diffs ?? []), ev.diff];
            return { ...item, diffs };
        }

        if (ev.type === "plan_proposed") {
            const item = finalizeThinkingIfActive(markTransientRetriesRecovered(rawItem, ev.timestamp), ev.timestamp);
            return {
                ...item,
                plan: ev.plan,
                planAwaitingApproval: ev.awaitingApproval,
            };
        }

        if (ev.type === "error") {
            const item = finalizeThinkingIfActive(rawItem, ev.timestamp);
            if (ev.recoverable) {
                // Recoverable transient error: keep turn active & show calm retry state instead of terminal failure
                const retries = [...(item.retries ?? [])];
                const nextAttempt = retries.length + 1;
                retries.push({
                    attempt: nextAttempt,
                    maxAttempts: Math.max(3, nextAttempt),
                    delayMs: 1500,
                    errorMessage: ev.message,
                    code: ev.code,
                    startedAt: ev.timestamp,
                    status: "retrying",
                });
                return {
                    ...item,
                    retries,
                    retryNoticeCollapsed: false,
                    error: undefined,
                };
            }

            // Terminal error: settle any running tools cleanly so nothing stays stuck at "running"
            const settledTools = settleUnfinishedTools(item.tools, ev.timestamp, true);
            const updatedRetries = (item.retries ?? []).map(entry =>
                entry.status === "retrying"
                    ? { ...entry, status: "failed" as const, endedAt: Math.max(ev.timestamp, entry.startedAt) }
                    : entry,
            );
            return {
                ...item,
                tools: settledTools,
                retries: updatedRetries,
                retryNoticeCollapsed: true,
                error: ev.message,
                endedAt: Math.max(ev.timestamp, item.startedAt),
            };
        }

        if (ev.type === "done") {
            const base = ev.aborted ? rawItem : markTransientRetriesRecovered(rawItem, ev.timestamp);
            const item = finalizeThinkingIfActive(base, ev.timestamp);
            const settledTools = settleUnfinishedTools(item.tools, ev.timestamp, ev.aborted);
            const updatedRetries = (item.retries ?? []).map(entry =>
                entry.status === "retrying"
                    ? {
                        ...entry,
                        status: (ev.aborted ? "failed" : "recovered") as "failed" | "recovered",
                        endedAt: Math.max(ev.timestamp, entry.startedAt),
                    }
                    : entry,
            );
            return {
                ...item,
                text: item.text || ev.finalText || "",
                tools: settledTools,
                retries: updatedRetries,
                retryNoticeCollapsed: true,
                aborted: ev.aborted,
                stats: ev.stats,
                endedAt: Math.max(ev.timestamp, item.startedAt),
            };
        }

        return rawItem;
    });

    const isTerminal = ev.type === "done" || (ev.type === "error" && !ev.recoverable);
    const nextActiveTurnId = isTerminal ? null : turnId;
    return { turns: next, activeTurnId: nextActiveTurnId };
}

export function getTurnThinkingDurationMs(turn: AgentChatTurn, nowMs: number): number {
    if (turn.thinkingStartedAt === undefined) return 0;
    const end = turn.thinkingEndedAt ?? nowMs;
    return Math.max(0, end - turn.thinkingStartedAt);
}

export function isTurnThinkingLive(turn: AgentChatTurn, isActiveTurn: boolean): boolean {
    return isActiveTurn && Boolean(turn.thinking) && turn.thinkingEndedAt === undefined && turn.endedAt === undefined;
}

export function getActiveRetryEntry(turn: AgentChatTurn): AgentRetryEntry | null {
    const list = turn.retries;
    if (!list || list.length === 0) return null;
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].status === "retrying") return list[i];
    }
    return null;
}

export function getRecoveredRetries(turn: AgentChatTurn): AgentRetryEntry[] {
    return (turn.retries ?? []).filter(entry => entry.status === "recovered");
}

export function toggleTurnThinkingCollapsed(turns: AgentChatTurn[], turnId: string): AgentChatTurn[] {
    return turns.map(turn => {
        if (turn.id !== turnId) return turn;
        const nextCollapsed = !turn.thinkingCollapsed;
        return {
            ...turn,
            thinkingCollapsed: nextCollapsed,
            thinkingUserExpanded: !nextCollapsed,
        };
    });
}

export function toggleTurnRetryCollapsed(turns: AgentChatTurn[], turnId: string): AgentChatTurn[] {
    return turns.map(turn => {
        if (turn.id !== turnId) return turn;
        return {
            ...turn,
            retryNoticeCollapsed: !turn.retryNoticeCollapsed,
        };
    });
}
