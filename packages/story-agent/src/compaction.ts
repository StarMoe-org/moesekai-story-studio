/**
 * Keeps a long conversation affordable: once the transcript grows past a budget, the older turns
 * are replaced by a summary the model writes, and the recent turns stay verbatim.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

export interface CompactionSettings {
    /** Compact before a request once the transcript is estimated above this many tokens. */
    triggerTokens: number;
    /** Tokens of the most recent turns that stay verbatim. */
    keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
    triggerTokens: 96_000,
    keepRecentTokens: 16_000,
};

/** Tool results quoted into the summary request are cut to this many characters. */
const TOOL_RESULT_PREVIEW_CHARS = 1_500;

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;

/** A rough token count: one per CJK character, one per four other characters. */
export function estimateTextTokens(text: string): number {
    const cjk = text.match(CJK)?.length ?? 0;
    return cjk + Math.ceil((text.length - cjk) / 4);
}

function messageText(message: AgentMessage): string {
    const { content } = message as Message;
    if (typeof content === "string") return content;
    return content
        .map((part) => {
            switch (part.type) {
                case "text":
                    return part.text;
                case "thinking":
                    return part.thinking;
                case "toolCall":
                    return `${part.name}(${JSON.stringify(part.arguments)})`;
                default:
                    return "";
            }
        })
        .join("\n");
}

export function estimateTranscriptTokens(messages: readonly AgentMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateTextTokens(messageText(message)), 0);
}

const isRole = (message: AgentMessage, role: Message["role"]) => (message as Message).role === role;

/**
 * Index of the first message kept verbatim: the start of a user turn, so tool calls stay with
 * their results, leaving at least `keepRecentTokens` after it. Null when no older turn would go.
 */
export function findCompactionCut(messages: readonly AgentMessage[], keepRecentTokens: number): number | null {
    const firstUser = messages.findIndex((m) => isRole(m, "user"));
    if (firstUser < 0) return null;
    let kept = 0;
    for (let i = messages.length - 1; i > firstUser; i--) {
        kept += estimateTextTokens(messageText(messages[i]));
        if (kept >= keepRecentTokens && isRole(messages[i], "user")) return i;
    }
    return null;
}

/** The dropped turns as plain text for the summarizer. */
function transcriptForSummary(messages: readonly AgentMessage[]): string {
    return messages
        .filter((m) => !isRole(m, "system"))
        .map((m) => {
            const message = m as Message;
            const text = messageText(m);
            switch (message.role) {
                case "user":
                    return `[User]\n${text}`;
                case "assistant":
                    return `[Assistant]\n${text}`;
                case "toolResult": {
                    const preview = text.length > TOOL_RESULT_PREVIEW_CHARS ? `${text.slice(0, TOOL_RESULT_PREVIEW_CHARS)}…` : text;
                    return `[Tool ${message.toolName}${message.isError ? " failed" : ""}]\n${preview}`;
                }
                default:
                    return "";
            }
        })
        .join("\n\n");
}

export const COMPACTION_SYSTEM_PROMPT = `You condense the earlier part of a conversation between an author and an AI agent that edits a Project SEKAI fan story script (.msk). The agent will continue the conversation from your summary alone, so keep everything it needs and nothing else:

- What the author asked for, in their own terms, including style, tone and characters they care about.
- Decisions made and constraints agreed on.
- What the agent changed: node ids, scenes, characters, lines, and whether validation passed.
- Requests that are still open or were only partly done.

Do not restate the script itself; the agent can read the current file with its tools. Write in the author's language. Use short sections with bullet points.`;

export const SUMMARY_OPEN = "<earlier-conversation-summary>";
export const SUMMARY_CLOSE = "</earlier-conversation-summary>";

/** The prompt that asks the model to summarize the dropped turns. */
export function summaryRequest(dropped: readonly AgentMessage[]): Message[] {
    return [{
        role: "user",
        content: `Summarize this conversation so far:\n\n${transcriptForSummary(dropped)}`,
        timestamp: Date.now(),
    }];
}

/**
 * The transcript with everything before `cut` replaced by `summary`. System messages are kept,
 * since they carry the prompt and the tool declarations.
 */
export function compactTranscript(messages: readonly AgentMessage[], cut: number, summary: string): AgentMessage[] {
    const systems = messages.slice(0, cut).filter((m) => isRole(m, "system"));
    const summaryMessage: Message = {
        role: "user",
        content: `${SUMMARY_OPEN}\n${summary.trim()}\n${SUMMARY_CLOSE}`,
        timestamp: Date.now(),
    };
    return [...systems, summaryMessage, ...messages.slice(cut)];
}
