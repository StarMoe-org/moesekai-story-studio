import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
    StoryAgentPersistedTurn,
    StoryAgentResumedSession,
    StoryAgentSessionSummary,
    StoryAuthoringMode,
    StoryWorkflowPlan,
} from "./types";
import { resolveSafeWorkspacePath } from "./workspace";

export const SESSIONS_DIR_REL = ".moesekai-studio/sessions";
const SIDECAR_SUFFIX = ".ui.json";
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,118}[A-Za-z0-9])?$/;
const MAX_TITLE_LENGTH = 60;

export interface StoryAgentSessionSidecar {
    schema: "moesekai-agent-session/1";
    summary: StoryAgentSessionSummary;
    transcript: StoryAgentPersistedTurn[];
    activePlan: StoryWorkflowPlan | null;
}

export function assertSafeSessionId(sessionId: string): string {
    const trimmed = sessionId?.trim() ?? "";
    if (!trimmed || !SAFE_SESSION_ID_RE.test(trimmed) || trimmed.includes("..")) {
        throw new Error(`Invalid sessionId: "${sessionId}"`);
    }
    return trimmed;
}

export function resolveSessionsDir(workspaceDir: string): string {
    return resolveSafeWorkspacePath(workspaceDir, SESSIONS_DIR_REL);
}

export function deriveSessionTitle(rawText: string, fallback = "Untitled conversation"): string {
    const stripped = stripStudioContextPrefix(rawText).replace(/\s+/g, " ").trim();
    if (!stripped) return fallback;
    if (stripped.length <= MAX_TITLE_LENGTH) return stripped;
    return `${stripped.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function stripStudioContextPrefix(text: string): string {
    const trimmed = text.trim();
    // Strip our internal `[Studio Context: ...]\n[Mode=...]\n\n` framing if present
    const stripped = trimmed.replace(/^\[Studio Context:[^\n]*\]\n\[[^\n]*\]\n\n/, "");
    return stripped.trim();
}

function getSidecarPath(workspaceDir: string, sessionId: string): string {
    const safeId = assertSafeSessionId(sessionId);
    return resolveSafeWorkspacePath(workspaceDir, `${SESSIONS_DIR_REL}/${safeId}${SIDECAR_SUFFIX}`);
}

async function readSidecarFile(absPath: string): Promise<StoryAgentSessionSidecar | null> {
    try {
        const raw = await readFile(absPath, "utf8");
        const parsed = JSON.parse(raw) as StoryAgentSessionSidecar;
        if (
            parsed
            && typeof parsed === "object"
            && parsed.summary
            && typeof parsed.summary.id === "string"
            && Array.isArray(parsed.transcript)
        ) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

function resolveSessionFileInsideDir(workspaceDir: string, sessionFileHint?: string): string | null {
    if (!sessionFileHint) return null;
    const fileName = basename(sessionFileHint);
    if (!fileName.endsWith(".jsonl") || fileName.includes("..")) return null;
    try {
        const candidate = resolveSafeWorkspacePath(workspaceDir, `${SESSIONS_DIR_REL}/${fileName}`);
        return existsSync(candidate) ? candidate : null;
    } catch {
        return null;
    }
}

async function findSessionJsonlFile(workspaceDir: string, sessionId: string): Promise<string | null> {
    const safeId = assertSafeSessionId(sessionId);
    const sessionsDir = resolveSessionsDir(workspaceDir);
    if (!existsSync(sessionsDir)) return null;

    // 1. Check sidecar's recorded sessionFile first
    const sidecar = await readSidecarFile(getSidecarPath(workspaceDir, safeId));
    const fromSidecar = resolveSessionFileInsideDir(workspaceDir, sidecar?.summary.sessionFile);
    if (fromSidecar) return fromSidecar;

    // 2. Ask Pi SessionManager.findById scoped to our workspace sessionsDir
    const foundByPi = SessionManager.findById(workspaceDir, safeId, sessionsDir);
    if (foundByPi) {
        const verified = resolveSessionFileInsideDir(workspaceDir, foundByPi);
        if (verified) return verified;
    }

    // 3. Fallback filename suffix scan (`<timestamp>_<sessionId>.jsonl`) inside sessionsDir
    try {
        const entries = await readdir(sessionsDir);
        const suffix = `_${safeId}.jsonl`;
        for (const name of entries) {
            if (name.endsWith(suffix) || name === `${safeId}.jsonl`) {
                const candidate = resolveSafeWorkspacePath(workspaceDir, `${SESSIONS_DIR_REL}/${name}`);
                if (existsSync(candidate)) return candidate;
            }
        }
    } catch {
        return null;
    }
    return null;
}

function extractMessagePlainText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
        }
    }
    return parts.join("");
}

function extractMessageThinking(content: unknown): string {
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; thinking?: string };
        if (b.type === "thinking" && typeof b.thinking === "string") {
            parts.push(b.thinking);
        }
    }
    return parts.join("");
}

function reconstructTranscriptFromSessionManager(
    manager: SessionManager,
): StoryAgentPersistedTurn[] {
    const context = manager.buildSessionContext();
    const turns: StoryAgentPersistedTurn[] = [];
    let seq = 0;

    for (const msg of context.messages) {
        const role = (msg as { role?: string }).role;
        const timestamp = (msg as { timestamp?: number }).timestamp ?? Date.now();
        if (role === "user") {
            const rawText = extractMessagePlainText((msg as { content?: unknown }).content);
            seq += 1;
            turns.push({
                id: `restored_u_${seq}`,
                role: "user",
                text: stripStudioContextPrefix(rawText),
                thinkingCollapsed: true,
                retryNoticeCollapsed: true,
                timestamp,
                startedAt: timestamp,
                endedAt: timestamp,
            });
        } else if (role === "assistant") {
            const content = (msg as { content?: unknown }).content;
            const text = extractMessagePlainText(content);
            const thinking = extractMessageThinking(content);
            const errorMessage = (msg as { errorMessage?: string }).errorMessage;
            const stopReason = (msg as { stopReason?: string }).stopReason;
            seq += 1;
            turns.push({
                id: `restored_a_${seq}`,
                role: "assistant",
                text,
                ...(thinking ? { thinking } : {}),
                thinkingCollapsed: true,
                retryNoticeCollapsed: true,
                ...(stopReason === "error" && errorMessage ? { error: errorMessage } : {}),
                ...(stopReason === "aborted" ? { aborted: true } : {}),
                timestamp,
                startedAt: timestamp,
                endedAt: timestamp,
            });
        }
    }

    return turns;
}

export async function saveWorkspaceSessionSidecar(
    workspaceDir: string,
    sidecar: StoryAgentSessionSidecar,
): Promise<void> {
    const safeId = assertSafeSessionId(sidecar.summary.id);
    const sessionsDir = resolveSessionsDir(workspaceDir);
    await mkdir(sessionsDir, { recursive: true });
    const absPath = getSidecarPath(workspaceDir, safeId);
    const normalized: StoryAgentSessionSidecar = {
        schema: "moesekai-agent-session/1",
        summary: {
            ...sidecar.summary,
            id: safeId,
            sessionFile: basename(sidecar.summary.sessionFile),
        },
        transcript: sidecar.transcript,
        activePlan: sidecar.activePlan ?? null,
    };
    await writeFile(absPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function listWorkspaceSessions(
    workspaceDir: string,
): Promise<StoryAgentSessionSummary[]> {
    const sessionsDir = resolveSessionsDir(workspaceDir);
    if (!existsSync(sessionsDir)) return [];

    const byId = new Map<string, StoryAgentSessionSummary>();
    let entries: string[];
    try {
        entries = await readdir(sessionsDir);
    } catch {
        return [];
    }

    // 1. Load rich UI sidecars
    for (const name of entries) {
        if (!name.endsWith(SIDECAR_SUFFIX)) continue;
        const absPath = resolveSafeWorkspacePath(workspaceDir, `${SESSIONS_DIR_REL}/${name}`);
        const sidecar = await readSidecarFile(absPath);
        if (!sidecar) continue;
        const hasJsonl = Boolean(resolveSessionFileInsideDir(workspaceDir, sidecar.summary.sessionFile));
        if (!hasJsonl && sidecar.transcript.length === 0) continue;
        byId.set(sidecar.summary.id, {
            ...sidecar.summary,
            sessionFile: basename(sidecar.summary.sessionFile),
        });
    }

    // 2. Discover any persisted Pi JSONL sessions that don't have a sidecar yet
    try {
        const piInfos = await SessionManager.list(workspaceDir, sessionsDir);
        for (const info of piInfos) {
            const existing = byId.get(info.id);
            if (existing) {
                if (!existing.sessionFile && info.path) {
                    existing.sessionFile = basename(info.path);
                }
                continue;
            }
            if (info.messageCount === 0) continue;
            byId.set(info.id, {
                id: info.id,
                title: deriveSessionTitle(info.name || info.firstMessage || "Conversation"),
                createdAt: info.created.toISOString(),
                updatedAt: info.modified.toISOString(),
                authoringMode: "edit",
                messageCount: info.messageCount,
                sessionFile: basename(info.path),
            });
        }
    } catch {
        // Non-fatal: sidecar list remains authoritative
    }

    return [...byId.values()].sort((a, b) => {
        const cmp = b.updatedAt.localeCompare(a.updatedAt);
        return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    });
}

export async function loadWorkspaceSession(
    workspaceDir: string,
    sessionId: string,
): Promise<StoryAgentResumedSession & { absSessionFile: string }> {
    const safeId = assertSafeSessionId(sessionId);
    const sessionsDir = resolveSessionsDir(workspaceDir);
    const sidecarPath = getSidecarPath(workspaceDir, safeId);
    const sidecar = existsSync(sidecarPath) ? await readSidecarFile(sidecarPath) : null;
    const absJsonl = await findSessionJsonlFile(workspaceDir, safeId);

    if (!absJsonl && !sidecar) {
        throw new Error(`Session "${safeId}" not found in workspace.`);
    }

    const sessionFileToOpen = absJsonl ?? join(sessionsDir, sidecar!.summary.sessionFile);
    let reconstructed: StoryAgentPersistedTurn[] = [];
    let inferredAuthoringMode: StoryAuthoringMode = sidecar?.summary.authoringMode ?? "edit";
    let inferredModel = sidecar?.summary.model;
    let inferredProvider = sidecar?.summary.provider;

    if (absJsonl && existsSync(absJsonl)) {
        const manager = SessionManager.open(absJsonl, sessionsDir, workspaceDir);
        const ctx = manager.buildSessionContext();
        if (!inferredModel && ctx.model?.modelId) inferredModel = ctx.model.modelId;
        if (!inferredProvider && ctx.model?.provider) inferredProvider = ctx.model.provider;
        if (!sidecar || sidecar.transcript.length === 0) {
            reconstructed = reconstructTranscriptFromSessionManager(manager);
        }
    }

    const transcript = sidecar && sidecar.transcript.length > 0 ? sidecar.transcript : reconstructed;
    const firstUserText = transcript.find((t) => t.role === "user")?.text ?? "";
    const nowIso = new Date().toISOString();
    const summary: StoryAgentSessionSummary = sidecar?.summary
        ? {
            ...sidecar.summary,
            sessionFile: basename(sessionFileToOpen),
            messageCount: Math.max(sidecar.summary.messageCount, transcript.length),
        }
        : {
            id: safeId,
            title: deriveSessionTitle(firstUserText, "Conversation"),
            createdAt: nowIso,
            updatedAt: nowIso,
            authoringMode: inferredAuthoringMode,
            ...(inferredModel ? { model: inferredModel } : {}),
            ...(inferredProvider ? { provider: inferredProvider } : {}),
            messageCount: transcript.length,
            sessionFile: basename(sessionFileToOpen),
        };

    return {
        summary,
        transcript,
        activePlan: sidecar?.activePlan ?? null,
        absSessionFile: sessionFileToOpen,
    };
}

export async function deleteWorkspaceSession(
    workspaceDir: string,
    sessionId: string,
): Promise<boolean> {
    const safeId = assertSafeSessionId(sessionId);
    const sessionsDir = resolveSessionsDir(workspaceDir);
    if (!existsSync(sessionsDir)) return false;

    const filesToDelete = new Set<string>();
    const sidecarPath = getSidecarPath(workspaceDir, safeId);
    if (existsSync(sidecarPath)) {
        filesToDelete.add(sidecarPath);
    }

    const absJsonl = await findSessionJsonlFile(workspaceDir, safeId);
    if (absJsonl && existsSync(absJsonl)) {
        filesToDelete.add(absJsonl);
    }

    let deletedAny = false;
    for (const filePath of filesToDelete) {
        try {
            await unlink(filePath);
            deletedAny = true;
        } catch {
            // Ignore already-deleted files
        }
    }
    return deletedAny;
}
