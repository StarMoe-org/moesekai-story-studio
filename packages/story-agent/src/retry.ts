import type { StoryAgentRetryPolicy } from "./types";

export const DEFAULT_STORY_AGENT_RETRY_POLICY: StoryAgentRetryPolicy = {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1500,
    maxDelayMs: 60_000,
};

export function resolveRetryPolicy(
    overrides?: Partial<StoryAgentRetryPolicy>,
): StoryAgentRetryPolicy {
    const enabled = overrides?.enabled ?? DEFAULT_STORY_AGENT_RETRY_POLICY.enabled;
    const maxRetries = Math.max(
        0,
        Math.min(10, Math.floor(overrides?.maxRetries ?? DEFAULT_STORY_AGENT_RETRY_POLICY.maxRetries)),
    );
    const baseDelayMs = Math.max(
        1,
        Math.floor(overrides?.baseDelayMs ?? DEFAULT_STORY_AGENT_RETRY_POLICY.baseDelayMs),
    );
    const maxDelayMs = Math.max(
        baseDelayMs,
        Math.floor(overrides?.maxDelayMs ?? DEFAULT_STORY_AGENT_RETRY_POLICY.maxDelayMs),
    );
    return { enabled, maxRetries, baseDelayMs, maxDelayMs };
}

export function computeRetryDelayMs(
    policy: Pick<StoryAgentRetryPolicy, "baseDelayMs" | "maxDelayMs">,
    attempt: number,
): number {
    const exponent = Math.max(0, attempt - 1);
    const delay = policy.baseDelayMs * 2 ** exponent;
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return Math.min(safeDelay, policy.maxDelayMs);
}

const KNOWN_ERROR_CODE_RE =
    /\b(UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|ERR_HTTP2_STREAM_CANCEL|ERR_SOCKET_CLOSED|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/i;

const HTTP_RETRY_STATUS_RE = /(?<![a-z0-9])(429|500|502|503|504|520|524)(?![a-z0-9])/i;

const NON_RETRYABLE_ERROR_RE = new RegExp(
    [
        "Retry cancelled",
        "Request aborted",
        "AbortError",
        "GoUsageLimitError",
        "FreeUsageLimitError",
        "Monthly usage limit reached",
        "available balance",
        "insufficient_quota",
        "out of budget",
        "quota exceeded",
        "billing",
        "subscription_sharing_usage_limit_exceeded",
        "subscription_sharing_workplace_individual_usage_limit_exceeded",
        '"code"\\s*:\\s*"?1308(?![0-9])',
        "invalid_api_key",
        "invalid api key",
        "incorrect api key",
        "authentication",
        "unauthorized",
        "forbidden",
        "(?<![a-z0-9])(?:401|403)(?![a-z0-9])",
        "context_length_exceeded",
        "context overflow",
        "prompt is too long",
        "maximum context length",
    ].join("|"),
    "i",
);

const TRANSIENT_NETWORK_ERROR_RE = new RegExp(
    [
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "UND_ERR_SOCKET",
        "ERR_HTTP2_STREAM_CANCEL",
        "ERR_SOCKET_CLOSED",
        "(?<![a-z0-9_])(?:ETIMEDOUT|ECONNRESET|ECONNABORTED|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)(?![a-z0-9_])",
        "connect timeout",
        "request timed out",
        "timed? out",
        "timeout",
        "fetch failed",
        "socket hang up",
        "socket connection was closed",
        "connection reset",
        "connection closed",
        "connection lost",
        "connection refused",
        "connection error",
        "other side closed",
        "network error",
        "stream was interrupted",
        "stream disconnected",
        "stream ended before",
        "ended without",
        "upstream.?connect",
        "upstream.?request.?failed",
        "unable to forward upstream",
        "reset before headers",
        "cut short after the reply had begun",
        "overloaded",
        "server.?busy",
        "rate.?limit",
        "too many requests",
        "service.?(?:is.?)?(?:temporarily.?)?unavailable",
        "provider.?returned.?(?:an.?)?error",
        "(?<![a-z0-9])(?:429|500|502|503|504|520|524)(?![a-z0-9])",
    ].join("|"),
    "i",
);

export function formatErrorMessageWithCause(err: unknown): string {
    if (typeof err === "string") return err;
    if (!(err instanceof Error)) return String(err ?? "Unknown error");

    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = err;
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const rec = current as { message?: unknown; code?: unknown; cause?: unknown };
        const msg = typeof rec.message === "string" ? rec.message.trim() : "";
        const code = typeof rec.code === "string" ? rec.code.trim() : "";
        if (msg) {
            const withCode = code && !msg.includes(code) ? `${msg} (${code})` : msg;
            if (!parts.some((p) => p.includes(withCode))) {
                parts.push(withCode);
            }
        } else if (code && !parts.some((p) => p.includes(code))) {
            parts.push(code);
        }
        current = rec.cause;
    }

    return parts.join(": ") || err.name || "Unknown error";
}

export function extractTransientErrorCode(errorOrMessage: unknown): string | undefined {
    if (errorOrMessage && typeof errorOrMessage === "object") {
        const seen = new Set<unknown>();
        let current: unknown = errorOrMessage;
        while (current && typeof current === "object" && !seen.has(current)) {
            seen.add(current);
            const rec = current as { code?: unknown; cause?: unknown };
            if (typeof rec.code === "string" && rec.code.trim()) {
                return rec.code.trim().toUpperCase();
            }
            current = rec.cause;
        }
    }

    const message = formatErrorMessageWithCause(errorOrMessage);
    const codeMatch = KNOWN_ERROR_CODE_RE.exec(message);
    if (codeMatch) return codeMatch[1].toUpperCase();

    const httpMatch = HTTP_RETRY_STATUS_RE.exec(message);
    if (httpMatch) return `HTTP_${httpMatch[1]}`;

    if (/connect timeout|request timed out|timed? out|timeout/i.test(message)) {
        return "TIMEOUT";
    }
    if (/rate.?limit|too many requests/i.test(message)) {
        return "RATE_LIMIT";
    }
    if (/overloaded|server.?busy/i.test(message)) {
        return "OVERLOADED";
    }
    if (/fetch failed|socket|connection|network|stream/i.test(message)) {
        return "NETWORK_ERROR";
    }
    return undefined;
}

export function isAbortError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof Error) {
        if (err.name === "AbortError" || err.name === "RetrySleepAbortError") return true;
        if (/^(aborted|request aborted|retry cancelled)$/i.test(err.message.trim())) return true;
    }
    if (typeof err === "string") {
        return /^(aborted|request aborted|retry cancelled)$/i.test(err.trim());
    }
    return false;
}

export function isTransientNetworkError(errorOrMessage: unknown, explicitCode?: string): boolean {
    if (isAbortError(errorOrMessage)) return false;
    const message = formatErrorMessageWithCause(errorOrMessage);
    const combined = explicitCode ? `${explicitCode} ${message}` : message;
    if (!combined.trim()) return false;
    if (NON_RETRYABLE_ERROR_RE.test(combined)) return false;
    return TRANSIENT_NETWORK_ERROR_RE.test(combined);
}

export class RetryBackoffAbortError extends Error {
    constructor() {
        super("Retry cancelled");
        this.name = "AbortError";
    }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new RetryBackoffAbortError());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new RetryBackoffAbortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, Math.max(0, ms));
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
