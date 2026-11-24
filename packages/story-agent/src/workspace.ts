import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
    compileStoryGraph,
    detectOutdatedBeats,
    getStageActionItems,
    isUiLocale,
    matchVoiceManifestToDoc,
    parseStoryScript,
    parseStoryVoiceManifest,
    SUPPORTED_UI_LOCALES,
    type StageActionItem,
    type StoryCompileDiagnostic,
    type StoryDocument,
    type StoryLocalePack,
    type StoryNode,
    type UiLocale,
} from "@moesekai/story-core";
import type {
    StoryDocSummary,
    StoryMskDiff,
    StoryParseDiagnosticItem,
    StoryRollbackResult,
    StorySnapshotMeta,
    StoryWorkspaceLocaleSummary,
    StoryWorkspaceNodeOutline,
    StoryWorkspaceSnapshot,
    StoryWorkspaceVoiceSummary,
} from "./types";

export const DEFAULT_STORY_FILE = "story.msk";
export const LOCALES_DIR = "locales";
export const VOICES_MANIFEST_REL = "voices/manifest.json";
export const SNAPSHOTS_DIR_REL = ".moesekai-studio/snapshots";
export const SNAPSHOTS_INDEX_REL = ".moesekai-studio/snapshots/index.json";

const SAFE_SNAPSHOT_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_SNAPSHOTS_RETAINED = 100;
const MAX_DIFF_PREVIEW_LINES = 160;

// ==================== Path-Jail & Text Utilities ====================

export function resolveSafeWorkspacePath(workspaceDir: string, relPath: string): string {
    if (!workspaceDir || !workspaceDir.trim()) {
        throw new Error("workspaceDir must be a non-empty path");
    }
    if (!relPath || relPath.includes("\0")) {
        throw new Error(`Invalid relative workspace path: "${relPath}"`);
    }
    const normalizedRel = relPath.replace(/\\/g, "/").trim();
    if (isAbsolute(normalizedRel) || /^[A-Za-z]:/.test(normalizedRel)) {
        throw new Error(`Path must be relative to workspaceDir: "${relPath}"`);
    }
    const root = resolve(workspaceDir);
    const target = resolve(root, normalizedRel);
    const rel = relative(root, target);
    if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
        if (rel === "" || rel === ".") {
            return root;
        }
        throw new Error(`Path escapes workspace root: "${relPath}"`);
    }
    return target;
}

export function normalizeLineEndings(text: string): string {
    const stripped = text.startsWith("\uFEFF") ? text.slice(1) : text;
    return stripped.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function sha256Short(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

export function countDocumentBeats(doc: StoryDocument | null | undefined): number {
    if (!doc) return 0;
    let total = 0;
    for (const node of Object.values(doc.nodes)) {
        if (node.type === "scene") {
            total += node.beats.length;
        }
    }
    return total;
}

export function summarizeStoryDoc(
    doc: StoryDocument,
    compiled?: ReturnType<typeof compileStoryGraph>,
): StoryDocSummary {
    const program = compiled ?? compileStoryGraph(doc);
    const nodes = Object.values(doc.nodes);
    const nodesByType = { start: 0, scene: 0, choice: 0, condition: 0, end: 0 };
    let beatCount = 0;
    for (const node of nodes) {
        nodesByType[node.type] += 1;
        if (node.type === "scene") {
            beatCount += node.beats.length;
        }
    }
    return {
        id: doc.id,
        title: doc.meta.title,
        region: doc.region,
        schema: doc.schema,
        castCount: doc.cast.length,
        variableCount: doc.variables.length,
        nodeCount: nodes.length,
        nodesByType,
        edgeCount: doc.edges.length,
        beatCount,
        reachableNodeCount: program.reachableNodeIds.length,
        endingCount: program.endingNodeIds.length,
    };
}

// ==================== Unified Line Diff ====================

interface DiffOp {
    kind: "equal" | "del" | "add";
    line: string;
}

function computeLineDiffOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
    const n = beforeLines.length;
    const m = afterLines.length;

    // Trim common prefix & suffix for speed on large scripts
    let prefix = 0;
    while (prefix < n && prefix < m && beforeLines[prefix] === afterLines[prefix]) {
        prefix += 1;
    }
    let suffix = 0;
    while (
        suffix < n - prefix
        && suffix < m - prefix
        && beforeLines[n - 1 - suffix] === afterLines[m - 1 - suffix]
    ) {
        suffix += 1;
    }

    const midA = beforeLines.slice(prefix, n - suffix);
    const midB = afterLines.slice(prefix, m - suffix);
    const ops: DiffOp[] = [];

    for (let i = 0; i < prefix; i++) {
        ops.push({ kind: "equal", line: beforeLines[i] });
    }

    // DP LCS when middle slice is reasonably bounded; fallback to block replace for huge files
    if (midA.length * midB.length <= 250_000) {
        const rows = midA.length + 1;
        const cols = midB.length + 1;
        const dp = new Int32Array(rows * cols);
        for (let i = midA.length - 1; i >= 0; i--) {
            for (let j = midB.length - 1; j >= 0; j--) {
                if (midA[i] === midB[j]) {
                    dp[i * cols + j] = dp[(i + 1) * cols + (j + 1)] + 1;
                } else {
                    const down = dp[(i + 1) * cols + j];
                    const right = dp[i * cols + (j + 1)];
                    dp[i * cols + j] = down >= right ? down : right;
                }
            }
        }
        let i = 0;
        let j = 0;
        while (i < midA.length && j < midB.length) {
            if (midA[i] === midB[j]) {
                ops.push({ kind: "equal", line: midA[i] });
                i += 1;
                j += 1;
            } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
                ops.push({ kind: "del", line: midA[i] });
                i += 1;
            } else {
                ops.push({ kind: "add", line: midB[j] });
                j += 1;
            }
        }
        while (i < midA.length) ops.push({ kind: "del", line: midA[i++] });
        while (j < midB.length) ops.push({ kind: "add", line: midB[j++] });
    } else {
        for (const line of midA) ops.push({ kind: "del", line });
        for (const line of midB) ops.push({ kind: "add", line });
    }

    for (let i = n - suffix; i < n; i++) {
        ops.push({ kind: "equal", line: beforeLines[i] });
    }

    return ops;
}

export function buildUnifiedDiffPreview(
    beforeText: string,
    afterText: string,
    fileLabel: string,
    maxLines = MAX_DIFF_PREVIEW_LINES,
): string {
    const beforeNorm = normalizeLineEndings(beforeText);
    const afterNorm = normalizeLineEndings(afterText);
    if (beforeNorm === afterNorm) return "(no changes)";

    const beforeLines = beforeNorm ? beforeNorm.split("\n") : [];
    const afterLines = afterNorm ? afterNorm.split("\n") : [];
    const ops = computeLineDiffOps(beforeLines, afterLines);

    const contextRadius = 2;
    const changedIndices: number[] = [];
    for (let i = 0; i < ops.length; i++) {
        if (ops[i].kind !== "equal") changedIndices.push(i);
    }
    if (changedIndices.length === 0) return "(no changes)";

    const out: string[] = [`--- a/${fileLabel}`, `+++ b/${fileLabel}`];
    let idx = 0;
    while (idx < changedIndices.length) {
        const hunkStart = Math.max(0, changedIndices[idx] - contextRadius);
        let hunkEnd = Math.min(ops.length - 1, changedIndices[idx] + contextRadius);
        while (
            idx + 1 < changedIndices.length
            && changedIndices[idx + 1] - contextRadius <= hunkEnd + 1
        ) {
            idx += 1;
            hunkEnd = Math.min(ops.length - 1, changedIndices[idx] + contextRadius);
        }

        let oldLine = 1;
        let newLine = 1;
        for (let k = 0; k < hunkStart; k++) {
            if (ops[k].kind !== "add") oldLine += 1;
            if (ops[k].kind !== "del") newLine += 1;
        }
        let oldCount = 0;
        let newCount = 0;
        for (let k = hunkStart; k <= hunkEnd; k++) {
            if (ops[k].kind !== "add") oldCount += 1;
            if (ops[k].kind !== "del") newCount += 1;
        }

        out.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
        for (let k = hunkStart; k <= hunkEnd; k++) {
            const op = ops[k];
            const prefix = op.kind === "add" ? "+" : op.kind === "del" ? "-" : " ";
            out.push(`${prefix}${op.line}`);
            if (out.length >= maxLines) {
                out.push("... (diff truncated)");
                return out.join("\n");
            }
        }
        idx += 1;
    }

    return out.join("\n");
}

// ==================== Structured .msk Diff ====================

function normalizeNodeForDiff(node: StoryNode): unknown {
    // Ignore visual-only canvas coordinates when determining semantic modifications unless needed
    const { pos: _pos, ...rest } = node;
    return rest;
}

export function computeMskDiff(
    beforeText: string,
    afterText: string,
    storyFile: string,
    snapshotId: string | null,
): StoryMskDiff {
    const beforeParsed = beforeText.trim() ? parseStoryScript(beforeText) : null;
    const afterParsed = afterText.trim() ? parseStoryScript(afterText) : null;

    const beforeDoc = beforeParsed?.ok ? beforeParsed.doc : null;
    const afterDoc = afterParsed?.ok ? afterParsed.doc : null;

    const compiledAfter = afterDoc ? compileStoryGraph(afterDoc) : null;

    const addedNodeIds: string[] = [];
    const removedNodeIds: string[] = [];
    const modifiedNodeIds: string[] = [];

    const beforeNodes = beforeDoc?.nodes ?? {};
    const afterNodes = afterDoc?.nodes ?? {};

    for (const id of Object.keys(afterNodes)) {
        if (!(id in beforeNodes)) {
            addedNodeIds.push(id);
        } else if (
            JSON.stringify(normalizeNodeForDiff(beforeNodes[id]))
            !== JSON.stringify(normalizeNodeForDiff(afterNodes[id]))
        ) {
            modifiedNodeIds.push(id);
        }
    }
    for (const id of Object.keys(beforeNodes)) {
        if (!(id in afterNodes)) {
            removedNodeIds.push(id);
        }
    }

    const beforeCast = new Map((beforeDoc?.cast ?? []).map((c) => [c.key, c]));
    const afterCast = new Map((afterDoc?.cast ?? []).map((c) => [c.key, c]));
    const addedCastKeys: string[] = [];
    const removedCastKeys: string[] = [];
    const modifiedCastKeys: string[] = [];
    for (const [key, item] of afterCast) {
        const prev = beforeCast.get(key);
        if (!prev) addedCastKeys.push(key);
        else if (JSON.stringify(prev) !== JSON.stringify(item)) modifiedCastKeys.push(key);
    }
    for (const key of beforeCast.keys()) {
        if (!afterCast.has(key)) removedCastKeys.push(key);
    }

    const beforeVars = new Map((beforeDoc?.variables ?? []).map((v) => [v.id, v]));
    const afterVars = new Map((afterDoc?.variables ?? []).map((v) => [v.id, v]));
    const addedVarIds: string[] = [];
    const removedVarIds: string[] = [];
    const modifiedVarIds: string[] = [];
    for (const [id, item] of afterVars) {
        const prev = beforeVars.get(id);
        if (!prev) addedVarIds.push(id);
        else if (JSON.stringify(prev) !== JSON.stringify(item)) modifiedVarIds.push(id);
    }
    for (const id of beforeVars.keys()) {
        if (!afterVars.has(id)) removedVarIds.push(id);
    }

    const nodeCountBefore = Object.keys(beforeNodes).length;
    const nodeCountAfter = Object.keys(afterNodes).length;
    const beatCountBefore = countDocumentBeats(beforeDoc);
    const beatCountAfter = countDocumentBeats(afterDoc);

    const parseErrCount = afterParsed && !afterParsed.ok ? afterParsed.diagnostics.length : 0;

    return {
        snapshotId,
        storyFile,
        addedNodeIds: addedNodeIds.sort(),
        removedNodeIds: removedNodeIds.sort(),
        modifiedNodeIds: modifiedNodeIds.sort(),
        addedCastKeys: addedCastKeys.sort(),
        removedCastKeys: removedCastKeys.sort(),
        modifiedCastKeys: modifiedCastKeys.sort(),
        addedVarIds: addedVarIds.sort(),
        removedVarIds: removedVarIds.sort(),
        modifiedVarIds: modifiedVarIds.sort(),
        nodeCountBefore,
        nodeCountAfter,
        beatCountBefore,
        beatCountAfter,
        beatCountDelta: beatCountAfter - beatCountBefore,
        compileOk: Boolean(afterDoc && compiledAfter?.ok),
        errorCount: parseErrCount + (compiledAfter?.errors.length ?? 0),
        warningCount: compiledAfter?.warnings.length ?? 0,
        unifiedDiffPreview: buildUnifiedDiffPreview(beforeText, afterText, storyFile),
    };
}

// ==================== Snapshots & Rollback ====================

let snapshotCounter = 0;

function generateSnapshotId(): string {
    snapshotCounter += 1;
    const now = new Date();
    const stamp = [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        String(now.getUTCDate()).padStart(2, "0"),
        "T",
        String(now.getUTCHours()).padStart(2, "0"),
        String(now.getUTCMinutes()).padStart(2, "0"),
        String(now.getUTCSeconds()).padStart(2, "0"),
        String(now.getUTCMilliseconds()).padStart(3, "0"),
        "Z",
    ].join("");
    const seq = String(snapshotCounter).padStart(3, "0");
    return `${stamp}-${seq}`;
}

async function readSnapshotIndex(workspaceDir: string): Promise<StorySnapshotMeta[]> {
    const indexPath = resolveSafeWorkspacePath(workspaceDir, SNAPSHOTS_INDEX_REL);
    try {
        const raw = await readFile(indexPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter(
                (item): item is StorySnapshotMeta =>
                    Boolean(item && typeof item === "object" && typeof item.id === "string"),
            );
        }
    } catch {
        // Missing or unreadable index; caller can reconcile from disk.
    }
    return [];
}

async function writeSnapshotIndex(workspaceDir: string, entries: StorySnapshotMeta[]): Promise<void> {
    const indexPath = resolveSafeWorkspacePath(workspaceDir, SNAPSHOTS_INDEX_REL);
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(entries.slice(0, MAX_SNAPSHOTS_RETAINED), null, 2)}\n`, "utf8");
}

export async function createStorySnapshot(
    workspaceDir: string,
    storyFile: string,
    options: { reason: string; toolName?: string; content?: string },
): Promise<StorySnapshotMeta | null> {
    const storyAbs = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let content = options.content;
    if (content === undefined) {
        try {
            content = await readFile(storyAbs, "utf8");
        } catch {
            return null;
        }
    }

    const normalized = normalizeLineEndings(content);
    const id = generateSnapshotId();
    const snapDir = resolveSafeWorkspacePath(workspaceDir, SNAPSHOTS_DIR_REL);
    await mkdir(snapDir, { recursive: true });
    const snapPath = resolveSafeWorkspacePath(workspaceDir, `${SNAPSHOTS_DIR_REL}/${id}.msk`);
    await writeFile(snapPath, normalized, "utf8");

    const parsed = normalized.trim() ? parseStoryScript(normalized) : null;
    const doc = parsed?.ok ? parsed.doc : null;
    const meta: StorySnapshotMeta = {
        id,
        createdAt: new Date().toISOString(),
        reason: options.reason,
        ...(options.toolName ? { toolName: options.toolName } : {}),
        storyFile,
        nodeCount: doc ? Object.keys(doc.nodes).length : 0,
        beatCount: countDocumentBeats(doc),
        byteLength: Buffer.byteLength(normalized, "utf8"),
        sha256: sha256Short(normalized),
    };

    const existing = await readSnapshotIndex(workspaceDir);
    const updated = [meta, ...existing.filter((item) => item.id !== id)].slice(0, MAX_SNAPSHOTS_RETAINED);
    await writeSnapshotIndex(workspaceDir, updated);
    return meta;
}

export async function listStorySnapshots(workspaceDir: string): Promise<StorySnapshotMeta[]> {
    const snapDir = resolveSafeWorkspacePath(workspaceDir, SNAPSHOTS_DIR_REL);
    const indexed = await readSnapshotIndex(workspaceDir);
    const byId = new Map(indexed.map((m) => [m.id, m]));

    let files: string[] = [];
    try {
        files = await readdir(snapDir);
    } catch {
        return indexed;
    }

    const presentIds = new Set<string>();
    for (const file of files) {
        if (!file.endsWith(".msk")) continue;
        const id = file.slice(0, -4);
        if (!SAFE_SNAPSHOT_ID_RE.test(id)) continue;
        presentIds.add(id);
        if (!byId.has(id)) {
            try {
                const abs = join(snapDir, file);
                const [raw, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
                const parsed = raw.trim() ? parseStoryScript(raw) : null;
                const doc = parsed?.ok ? parsed.doc : null;
                byId.set(id, {
                    id,
                    createdAt: st.mtime.toISOString(),
                    reason: "snapshot",
                    storyFile: DEFAULT_STORY_FILE,
                    nodeCount: doc ? Object.keys(doc.nodes).length : 0,
                    beatCount: countDocumentBeats(doc),
                    byteLength: Buffer.byteLength(raw, "utf8"),
                    sha256: sha256Short(raw),
                });
            } catch {
                // Skip unreadable file
            }
        }
    }

    const result = [...byId.values()]
        .filter((m) => presentIds.has(m.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    return result;
}

export async function rollbackStorySnapshot(
    workspaceDir: string,
    storyFile: string,
    snapshotId: string,
): Promise<StoryRollbackResult> {
    const cleanId = snapshotId.trim();
    if (!SAFE_SNAPSHOT_ID_RE.test(cleanId)) {
        throw new Error(`Invalid snapshotId: "${snapshotId}"`);
    }
    const snapPath = resolveSafeWorkspacePath(workspaceDir, `${SNAPSHOTS_DIR_REL}/${cleanId}.msk`);
    let restoredContent: string;
    try {
        restoredContent = normalizeLineEndings(await readFile(snapPath, "utf8"));
    } catch {
        throw new Error(`Snapshot "${cleanId}" not found in ${SNAPSHOTS_DIR_REL}`);
    }

    const storyAbs = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let currentContent = "";
    try {
        currentContent = normalizeLineEndings(await readFile(storyAbs, "utf8"));
    } catch {
        currentContent = "";
    }

    const safetySnap = currentContent
        ? await createStorySnapshot(workspaceDir, storyFile, {
            reason: `pre-rollback to ${cleanId}`,
            toolName: "rollback",
            content: currentContent,
        })
        : null;

    await mkdir(dirname(storyAbs), { recursive: true });
    await writeFile(storyAbs, restoredContent, "utf8");

    const diff = computeMskDiff(currentContent, restoredContent, storyFile, safetySnap?.id ?? null);
    const snapshots = await listStorySnapshots(workspaceDir);
    const snapshotMeta = snapshots.find((s) => s.id === cleanId) ?? {
        id: cleanId,
        createdAt: new Date().toISOString(),
        reason: "snapshot",
        storyFile,
        nodeCount: diff.nodeCountAfter,
        beatCount: diff.beatCountAfter,
        byteLength: Buffer.byteLength(restoredContent, "utf8"),
        sha256: sha256Short(restoredContent),
    };

    return {
        ok: true,
        snapshot: snapshotMeta,
        diff,
        safetySnapshotId: safetySnap?.id ?? null,
    };
}

// ==================== Node Block Extractor (for Patch & Context) ====================

export interface MskNodeSpan {
    nodeId: string;
    kind: "start" | "scene" | "choice" | "condition" | "end";
    startIndex: number;
    endIndex: number;
    text: string;
}

/**
 * Finds the character span of a top-level `.msk` node declaration (`start`, `scene`, `choice`,
 * `condition`, `end`) by `nodeId`, respecting double-quoted strings, escapes, comments, and `{ ... }` nesting.
 */
export function findMskNodeSpan(source: string, targetNodeId: string): MskNodeSpan | null {
    const text = normalizeLineEndings(source);
    const len = text.length;
    let i = 0;

    const skipWs = () => {
        while (i < len && (text[i] === " " || text[i] === "\t" || text[i] === "\n")) i += 1;
    };
    const skipLineRest = () => {
        while (i < len && text[i] !== "\n") i += 1;
    };
    const skipString = () => {
        // assumes text[i] === '"'
        i += 1;
        while (i < len) {
            if (text[i] === "\\") {
                i += 2;
                continue;
            }
            if (text[i] === '"') {
                i += 1;
                return;
            }
            i += 1;
        }
    };
    const skipTrailingArrowLine = () => {
        let j = i;
        while (j < len && (text[j] === " " || text[j] === "\t")) j += 1;
        if (text.slice(j, j + 2) === "->") {
            while (j < len && text[j] !== "\n") j += 1;
            i = j;
        }
    };

    while (i < len) {
        skipWs();
        if (i >= len) break;
        const lineStart = i;
        if (text[i] === "#" || (text[i] === "/" && text[i + 1] === "/")) {
            skipLineRest();
            continue;
        }

        // Read leading keyword
        const kwMatch = /^(start|scene|choice|condition|end)\b/.exec(text.slice(i));
        if (!kwMatch) {
            skipLineRest();
            continue;
        }
        const kind = kwMatch[1] as MskNodeSpan["kind"];
        let cursor = i + kind.length;
        const restOfLineEnd = text.indexOf("\n", cursor);
        const headerLine = text.slice(cursor, restOfLineEnd === -1 ? len : restOfLineEnd);

        let nodeId: string | null = null;
        if (kind === "start") {
            const explicit = /^\s+id=([A-Za-z0-9_-]{1,32})\b/.exec(headerLine);
            nodeId = explicit ? explicit[1] : "start";
        } else {
            const idMatch = /^\s+([A-Za-z0-9_-]{1,32})\b/.exec(headerLine);
            nodeId = idMatch ? idMatch[1] : null;
        }

        if (kind === "start" || kind === "end") {
            i = restOfLineEnd === -1 ? len : restOfLineEnd;
            if (nodeId === targetNodeId) {
                return {
                    nodeId,
                    kind,
                    startIndex: lineStart,
                    endIndex: i,
                    text: text.slice(lineStart, i),
                };
            }
            continue;
        }

        // Block node: scan until matching top-level '}' then optional `-> target`
        let foundOpen = false;
        let depth = 0;
        i = cursor;
        while (i < len) {
            const ch = text[i];
            if (ch === '"') {
                skipString();
                continue;
            }
            if (ch === "#" || (ch === "/" && text[i + 1] === "/")) {
                skipLineRest();
                continue;
            }
            if (ch === "{") {
                foundOpen = true;
                depth += 1;
                i += 1;
                continue;
            }
            if (ch === "}") {
                depth -= 1;
                i += 1;
                if (foundOpen && depth === 0) {
                    skipTrailingArrowLine();
                    break;
                }
                continue;
            }
            i += 1;
        }

        if (nodeId === targetNodeId) {
            return {
                nodeId,
                kind,
                startIndex: lineStart,
                endIndex: i,
                text: text.slice(lineStart, i),
            };
        }
    }

    return null;
}

// ==================== Workspace Read / Write / Patch ====================

export async function readLocalePackFromDisk(
    workspaceDir: string,
    locale: UiLocale,
): Promise<StoryLocalePack | null> {
    const filePath = resolveSafeWorkspacePath(workspaceDir, `${LOCALES_DIR}/${locale}.i18n.json`);
    try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as StoryLocalePack;
        if (parsed && typeof parsed === "object" && parsed.locale === locale && parsed.beats) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

export async function writeLocalePackToDisk(
    workspaceDir: string,
    locale: UiLocale,
    pack: StoryLocalePack,
): Promise<string> {
    const relPath = `${LOCALES_DIR}/${locale}.i18n.json`;
    const absPath = resolveSafeWorkspacePath(workspaceDir, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    return relPath;
}

export async function readVoiceManifestFromDisk(
    workspaceDir: string,
): Promise<{ raw: unknown; manifest: ReturnType<typeof parseStoryVoiceManifest> } | null> {
    const absPath = resolveSafeWorkspacePath(workspaceDir, VOICES_MANIFEST_REL);
    try {
        const text = await readFile(absPath, "utf8");
        const raw = JSON.parse(text);
        return { raw, manifest: parseStoryVoiceManifest(raw, { allowLocalWorkspaceUrls: true }) };
    } catch {
        return null;
    }
}

export async function writeVoiceManifestToDisk(
    workspaceDir: string,
    manifest: NonNullable<ReturnType<typeof parseStoryVoiceManifest>>,
): Promise<string> {
    const absPath = resolveSafeWorkspacePath(workspaceDir, VOICES_MANIFEST_REL);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return VOICES_MANIFEST_REL;
}

export async function readStoryWorkspace(
    workspaceDir: string,
    storyFile = DEFAULT_STORY_FILE,
    options?: {
        includeScript?: boolean;
        startLine?: number;
        endLine?: number;
        selectedNodeId?: string | null;
    },
): Promise<StoryWorkspaceSnapshot> {
    const absStory = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let rawScript = "";
    let exists = false;
    try {
        rawScript = normalizeLineEndings(await readFile(absStory, "utf8"));
        exists = true;
    } catch {
        exists = false;
    }

    const lines = rawScript ? rawScript.split("\n") : [];
    const parsed = rawScript.trim() ? parseStoryScript(rawScript) : null;
    const doc = parsed?.ok ? parsed.doc : null;
    const parseDiagnostics: StoryParseDiagnosticItem[] = parsed && !parsed.ok
        ? parsed.diagnostics.map((d) => ({ line: d.line, col: d.col, message: d.message }))
        : [];

    const compiled = doc ? compileStoryGraph(doc) : undefined;
    const docSummary = doc ? summarizeStoryDoc(doc, compiled) : null;

    const outgoingByNode = new Map<string, string[]>();
    if (doc) {
        for (const edge of doc.edges) {
            const list = outgoingByNode.get(edge.fromNodeId) ?? [];
            if (!list.includes(edge.toNodeId)) list.push(edge.toNodeId);
            outgoingByNode.set(edge.fromNodeId, list);
        }
    }

    const nodes: StoryWorkspaceNodeOutline[] = doc
        ? Object.values(doc.nodes).map((n) => ({
            id: n.id,
            type: n.type,
            title: n.type === "start" ? "Start" : n.title,
            ...(n.type === "scene" ? { beatCount: n.beats.length } : {}),
            ...(n.type === "choice" ? { optionCount: n.options.length } : {}),
            ...(n.type === "condition" ? { ruleCount: n.rules.length } : {}),
            ...(n.type === "end" && n.subtitle ? { subtitle: n.subtitle } : {}),
            outgoingTargets: outgoingByNode.get(n.id) ?? [],
        }))
        : [];

    const endings = doc
        ? Object.values(doc.nodes)
            .filter((n): n is Extract<StoryNode, { type: "end" }> => n.type === "end")
            .map((n) => ({ id: n.id, title: n.title, ...(n.subtitle ? { subtitle: n.subtitle } : {}) }))
        : [];

    let selectedNodeContext: StoryWorkspaceSnapshot["selectedNodeContext"];
    if (options?.selectedNodeId && doc?.nodes[options.selectedNodeId]) {
        const node = doc.nodes[options.selectedNodeId];
        const span = findMskNodeSpan(rawScript, node.id);
        const beatsPreview = node.type === "scene"
            ? node.beats.slice(0, 30).map((b) => {
                let summary = "";
                if (b.kind === "talk") {
                    summary = `${b.speakerKey ?? b.speakerName ?? "?"}: ${b.body.slice(0, 80)}`;
                } else if (b.kind === "narration") {
                    summary = b.body.slice(0, 80);
                } else if (b.kind === "telop") {
                    const mods: string[] = [];
                    if (b.actorVisibility && b.actorVisibility !== "keep") mods.push(`actors=${b.actorVisibility}`);
                    if (b.position && b.position !== "center") mods.push(`pos=${b.position}`);
                    summary = `${b.text.slice(0, 80)}${mods.length > 0 ? ` [${mods.join(" ")}]` : ""}`;
                } else if (b.kind === "stageAction") {
                    const fmtItem = (it: StageActionItem) =>
                        `${it.action} ${it.castKey}${it.slot ? ` @ ${it.slot}` : ""}${it.x !== undefined ? ` x=${it.x}` : ""}${it.z !== undefined ? ` z=${it.z}` : ""}${it.lockX ? " lock" : ""}${it.mirror ? " mirror" : ""}`;
                    const items = getStageActionItems(b);
                    if (items.length > 1) {
                        const tail: string[] = [];
                        if (b.delay !== undefined) tail.push(`delay=${b.delay}`);
                        if (b.duration !== undefined) tail.push(`dur=${b.duration}`);
                        if (b.transition === "instant" || b.transition === "fade") tail.push(b.transition);
                        if (b.parallel) tail.push("parallel");
                        summary = `sync [${items.map(fmtItem).join("; ")}]${tail.length > 0 ? ` ${tail.join(" ")}` : ""}`;
                    } else {
                        const tail: string[] = [];
                        if (b.delay !== undefined) tail.push(`delay=${b.delay}`);
                        if (b.transition === "instant" || b.transition === "fade") tail.push(b.transition);
                        if (b.parallel) tail.push("parallel");
                        summary = `${fmtItem(items[0])}${tail.length > 0 ? ` ${tail.join(" ")}` : ""}`;
                    }
                } else if (b.kind === "cue") {
                    summary = `${b.cueType}${b.se ? ` ${b.se}` : ""}`;
                } else {
                    summary = b.ops.map((o) => `${o.varId} ${o.op}`).join(", ");
                }
                return { id: b.id, kind: b.kind, summary };
            })
            : undefined;
        selectedNodeContext = {
            nodeId: node.id,
            nodeType: node.type,
            title: node.type === "start" ? "Start" : node.title,
            mskSnippet: span?.text ?? "",
            ...(beatsPreview ? { beatsPreview } : {}),
        };
    }

    // Scan locales/*.i18n.json
    const locales: StoryWorkspaceLocaleSummary[] = [];
    for (const loc of SUPPORTED_UI_LOCALES) {
        const pack = await readLocalePackFromDisk(workspaceDir, loc);
        if (!pack) continue;
        const report = doc ? detectOutdatedBeats(doc, pack) : null;
        locales.push({
            locale: loc,
            filePath: `${LOCALES_DIR}/${loc}.i18n.json`,
            origin: pack.translationMeta?.origin ?? "unknown",
            translatedBeats: report?.translatedCount ?? Object.keys(pack.beats).length,
            outdatedBeats: report?.outdatedBeatIds.length ?? 0,
            missingBeats: report?.missingBeatIds.length ?? 0,
            totalBeats: report?.totalCount ?? Object.keys(pack.beats).length,
            ...(pack.translationMeta?.modelHint ? { modelHint: pack.translationMeta.modelHint } : {}),
        });
    }

    // Also inspect any unexpected *.i18n.json filenames inside locales/ if valid UI locale
    try {
        const locDir = resolveSafeWorkspacePath(workspaceDir, LOCALES_DIR);
        const dirEntries = await readdir(locDir);
        const seen = new Set(locales.map((l) => l.locale));
        for (const f of dirEntries) {
            if (!f.endsWith(".i18n.json")) continue;
            const candidate = f.slice(0, -".i18n.json".length);
            if (!isUiLocale(candidate) || seen.has(candidate)) continue;
            const pack = await readLocalePackFromDisk(workspaceDir, candidate);
            if (!pack) continue;
            const report = doc ? detectOutdatedBeats(doc, pack) : null;
            locales.push({
                locale: candidate,
                filePath: `${LOCALES_DIR}/${f}`,
                origin: pack.translationMeta?.origin ?? "unknown",
                translatedBeats: report?.translatedCount ?? Object.keys(pack.beats).length,
                outdatedBeats: report?.outdatedBeatIds.length ?? 0,
                missingBeats: report?.missingBeatIds.length ?? 0,
                totalBeats: report?.totalCount ?? Object.keys(pack.beats).length,
            });
        }
    } catch {
        // locales/ dir optional
    }

    // Scan voices/manifest.json
    let voiceManifest: StoryWorkspaceVoiceSummary | null = null;
    const loadedVoice = await readVoiceManifestFromDisk(workspaceDir);
    if (loadedVoice?.manifest) {
        const m = loadedVoice.manifest;
        const match = doc ? matchVoiceManifestToDoc(doc, m) : null;
        voiceManifest = {
            filePath: VOICES_MANIFEST_REL,
            schema: m.schema,
            ...(m.locale ? { locale: m.locale } : {}),
            ...(m.title ? { title: m.title } : {}),
            totalManifestLines: match?.totalManifestLines ?? Object.keys(m.lines).length,
            totalTalkBeats: match?.totalTalkBeats ?? 0,
            matchedCount: match?.matchedCount ?? 0,
            storyIdMismatch: match?.storyIdMismatch ?? false,
        };
    }

    const snapshots = await listStorySnapshots(workspaceDir);

    let script: string | undefined;
    if (options?.includeScript !== false) {
        if (options?.startLine !== undefined || options?.endLine !== undefined) {
            const start = Math.max(1, options.startLine ?? 1);
            const end = Math.min(lines.length, options.endLine ?? lines.length);
            script = lines.slice(start - 1, end).join("\n");
        } else {
            script = rawScript;
        }
    }

    return {
        workspaceDir: resolve(workspaceDir),
        storyFile,
        exists,
        byteLength: Buffer.byteLength(rawScript, "utf8"),
        lineCount: lines.length,
        parseOk: Boolean(doc),
        parseDiagnostics,
        docSummary,
        cast: doc ? doc.cast.map((c) => ({ ...c })) : [],
        variables: doc ? doc.variables.map((v) => ({ ...v })) : [],
        nodes,
        endings,
        ...(selectedNodeContext ? { selectedNodeContext } : {}),
        locales,
        voiceManifest,
        snapshotCount: snapshots.length,
        ...(script !== undefined ? { script } : {}),
    };
}

export interface StoryMutationResult {
    storyFile: string;
    snapshot: StorySnapshotMeta | null;
    diff: StoryMskDiff;
    parseOk: boolean;
    parseDiagnostics: StoryParseDiagnosticItem[];
    compileOk: boolean;
    errors: StoryCompileDiagnostic[];
    warnings: StoryCompileDiagnostic[];
    docSummary: StoryDocSummary | null;
}

export async function writeStoryScript(
    workspaceDir: string,
    storyFile: string,
    nextScript: string,
    options?: { reason?: string; toolName?: string },
): Promise<StoryMutationResult> {
    const absStory = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let beforeContent = "";
    let existed = false;
    try {
        beforeContent = normalizeLineEndings(await readFile(absStory, "utf8"));
        existed = true;
    } catch {
        beforeContent = "";
    }

    const normalizedNext = normalizeLineEndings(nextScript);
    const snapshot = existed
        ? await createStorySnapshot(workspaceDir, storyFile, {
            reason: options?.reason ?? "before write",
            toolName: options?.toolName ?? "story_write_msk",
            content: beforeContent,
        })
        : null;

    await mkdir(dirname(absStory), { recursive: true });
    await writeFile(absStory, normalizedNext, "utf8");

    const parsed = parseStoryScript(normalizedNext);
    const compiled = parsed.ok ? compileStoryGraph(parsed.doc) : null;
    const diff = computeMskDiff(beforeContent, normalizedNext, storyFile, snapshot?.id ?? null);

    return {
        storyFile,
        snapshot,
        diff,
        parseOk: parsed.ok,
        parseDiagnostics: parsed.ok
            ? []
            : parsed.diagnostics.map((d) => ({ line: d.line, col: d.col, message: d.message })),
        compileOk: Boolean(compiled?.ok),
        errors: compiled?.errors ?? [],
        warnings: compiled?.warnings ?? [],
        docSummary: parsed.ok && compiled ? summarizeStoryDoc(parsed.doc, compiled) : null,
    };
}

export interface StoryPatchEdit {
    find: string;
    replace: string;
    replaceAll?: boolean;
}

export interface StoryPatchRequest {
    edits?: StoryPatchEdit[];
    replaceNode?: {
        nodeId: string;
        msk: string;
    };
    reason?: string;
}

export async function patchStoryScript(
    workspaceDir: string,
    storyFile: string,
    patch: StoryPatchRequest,
    options?: { toolName?: string },
): Promise<StoryMutationResult> {
    const absStory = resolveSafeWorkspacePath(workspaceDir, storyFile);
    let current: string;
    try {
        current = normalizeLineEndings(await readFile(absStory, "utf8"));
    } catch {
        throw new Error(`Cannot patch "${storyFile}": file does not exist yet. Use story_write_msk to create it.`);
    }

    const hasEdits = Array.isArray(patch.edits) && patch.edits.length > 0;
    const hasReplaceNode = Boolean(patch.replaceNode);
    if (!hasEdits && !hasReplaceNode) {
        throw new Error("story_patch_msk requires either non-empty `edits` or `replaceNode`.");
    }

    let next = current;

    if (patch.replaceNode) {
        const span = findMskNodeSpan(next, patch.replaceNode.nodeId);
        if (!span) {
            throw new Error(`Node "${patch.replaceNode.nodeId}" not found in "${storyFile}".`);
        }
        const replacement = normalizeLineEndings(patch.replaceNode.msk).trim();
        next = `${next.slice(0, span.startIndex)}${replacement}${next.slice(span.endIndex)}`;
    }

    if (hasEdits && patch.edits) {
        for (let i = 0; i < patch.edits.length; i++) {
            const edit = patch.edits[i];
            const findNorm = normalizeLineEndings(edit.find);
            const replaceNorm = normalizeLineEndings(edit.replace);
            if (!findNorm) {
                throw new Error(`Edit #${i + 1} has an empty "find" string.`);
            }
            const firstIdx = next.indexOf(findNorm);
            if (firstIdx === -1) {
                throw new Error(
                    `Edit #${i + 1} failed: target snippet not found in "${storyFile}".`,
                );
            }
            if (edit.replaceAll) {
                next = next.split(findNorm).join(replaceNorm);
            } else {
                const secondIdx = next.indexOf(findNorm, firstIdx + findNorm.length);
                if (secondIdx !== -1) {
                    throw new Error(
                        `Edit #${i + 1} is ambiguous: target snippet appears multiple times. Provide more surrounding context or set replaceAll=true.`,
                    );
                }
                next = `${next.slice(0, firstIdx)}${replaceNorm}${next.slice(firstIdx + findNorm.length)}`;
            }
        }
    }

    return writeStoryScript(workspaceDir, storyFile, next, {
        reason: patch.reason ?? (patch.replaceNode ? `patch node ${patch.replaceNode.nodeId}` : "patch .msk"),
        toolName: options?.toolName ?? "story_patch_msk",
    });
}
