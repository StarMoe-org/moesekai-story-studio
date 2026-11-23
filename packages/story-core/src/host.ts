/**
 * Shared cross-host workspace, draft storage, capability, and `.msk` export preflight
 * contracts for Web (`pjsk.moe`), Electron (`apps/desktop`), and CLI/Agent hosts.
 */
import type { UiLocale } from "./locales";
import { compileStoryGraph, type CompiledStoryProgram } from "./story/compiler";
import { storyLocalePackFileName, storyScriptFileName } from "./story/document";
import {
    createDraft,
    deleteDraft,
    duplicateDraft,
    getDraft,
    listDrafts,
    renameDraft,
    saveDraft,
} from "./story/drafts";
import { serializeStoryLocalePack } from "./story/i18nPack";
import { parseStoryScript, serializeStoryScript } from "./story/script";
import { validateStoryDocument } from "./story/validate";
import type {
    StoryCompileDiagnostic,
    StoryDocument,
    StoryDraft,
    StoryIssue,
    StoryLocalePack,
    StoryRegion,
    StoryVoiceManifest,
} from "./types/storyMaker";

// ==================== Workspace Capabilities ====================

export interface StoryWorkspaceCapabilities {
    /** Runtime host environment kind. */
    host: "web" | "desktop" | "cli";
    /** Direct editing of local `.msk` project folders on disk. */
    localFilesystem: boolean;
    /** External filesystem change watcher (e.g. Pi Agent / external text editor hot-reload). */
    externalWatch: boolean;
    /** Native OS save dialogs & multi-file bundle export. */
    nativeExport: boolean;
    /** Integrated Pi Agent automation panel. */
    agentAutomation: boolean;
    /** Direct publishing to Moesekai Community Stories (Web host). */
    communityPublish: boolean;
    /** Direct custom voice archive upload to Moesekai Media Worker (Web host). */
    communityAudioUpload: boolean;
    /** Direct selection/scanning of local audio folders for user-supplied custom voice tracks. */
    localVoiceDirectory: boolean;
}

export const WEB_STORY_WORKSPACE_CAPABILITIES: Readonly<StoryWorkspaceCapabilities> = Object.freeze({
    host: "web",
    localFilesystem: false,
    externalWatch: false,
    nativeExport: false,
    agentAutomation: false,
    communityPublish: true,
    communityAudioUpload: true,
    localVoiceDirectory: false,
});

export const DESKTOP_STORY_WORKSPACE_CAPABILITIES: Readonly<StoryWorkspaceCapabilities> = Object.freeze({
    host: "desktop",
    localFilesystem: true,
    externalWatch: true,
    nativeExport: true,
    agentAutomation: true,
    communityPublish: false,
    communityAudioUpload: false,
    localVoiceDirectory: true,
});

// ==================== Draft Storage Adapter ====================

export interface StoryDraftExternalChangeEvent {
    draftId: string;
    kind: "updated" | "deleted" | "locales-updated" | "voices-updated";
    /** Optional raw `.msk` text when the underlying script file changed on disk. */
    script?: string;
    /** Optional parsed `StoryDocument` when already parsed by the host watcher. */
    doc?: StoryDocument;
    timestamp: number;
}

/**
 * Storage contract implemented by Web (IndexedDB `moesekai-story-maker-v2`) and Electron
 * desktop (local `.msk` project folder workspace).
 */
export interface StoryDraftStorageAdapter {
    listDrafts(): Promise<StoryDraft[]>;
    getDraft(id: string): Promise<StoryDraft | null>;
    createDraft(doc: StoryDocument): Promise<StoryDraft>;
    saveDraft(id: string, doc: StoryDocument): Promise<StoryDraft>;
    renameDraft(id: string, title: string): Promise<StoryDraft | null>;
    duplicateDraft(id: string, titleSuffix: string): Promise<StoryDraft | null>;
    deleteDraft(id: string): Promise<void>;
    /**
     * Optional subscription for out-of-band edits (e.g. Electron `fs.watch` or Pi Agent).
     * Returns an unsubscribe function.
     */
    watchExternalChanges?(
        draftId: string,
        listener: (event: StoryDraftExternalChangeEvent) => void,
    ): () => void;
}

/** Creates the standard browser IndexedDB (`moesekai-story-maker-v2`) `StoryDraftStorageAdapter`. */
export function createIndexedDbStoryDraftStorageAdapter(): StoryDraftStorageAdapter {
    return {
        listDrafts,
        getDraft,
        createDraft,
        saveDraft,
        renameDraft,
        duplicateDraft,
        deleteDraft,
    };
}

/** Convenience alias for `createIndexedDbStoryDraftStorageAdapter`. */
export const createIndexedDbDraftStorage = createIndexedDbStoryDraftStorageAdapter;

// ==================== `.msk` Export Preflight ====================

export interface PrepareMskExportOptions {
    /** Strip `@pos(x, y)` visual canvas coordinates for clean portable `.msk` output. Default: `false`. */
    stripPositions?: boolean;
    /** Treat compiler warnings as blocking (`ok = errors.length === 0 && warnings.length === 0`). Default: `false`. */
    strict?: boolean;
}

export interface MskExportMetadataSummary {
    id: string;
    title: string;
    summary: string;
    author: string;
    region: StoryRegion;
    sourceLocale?: UiLocale;
    castCount: number;
    variableCount: number;
    nodeCount: number;
    sceneCount: number;
    beatCount: number;
    talkBeatCount: number;
    edgeCount: number;
    endingCount: number;
    localeCodes: UiLocale[];
    byteLength: number;
    lineCount: number;
    strippedPositions: boolean;
}

export interface PreparedMskExport {
    /** True when schema validation passed and compiler produced 0 errors (and 0 warnings when `strict: true`). */
    ok: boolean;
    /** True only when schema validation passed with 0 errors AND 0 warnings. */
    strictOk: boolean;
    /** Suggested deterministic `.msk` filename (e.g. `my-story.msk`). */
    filename: string;
    /** Serialized `.msk` script (with `@pos(x, y)` omitted when `stripPositions: true`). */
    script: string;
    /** Normalized document (or input document when validation failed). */
    doc: StoryDocument;
    /** Compiled IR program & full compiler diagnostics. */
    program: CompiledStoryProgram;
    /** Schema validation issues (empty when `validateStoryDocument` passed). */
    issues: StoryIssue[];
    /** Compiler error diagnostics (`program.errors`). */
    errors: StoryCompileDiagnostic[];
    /** Compiler warning diagnostics (`program.warnings`). */
    warnings: StoryCompileDiagnostic[];
    /** Export metadata & size summary for preflight dialogs. */
    summary: MskExportMetadataSummary;
}

const textEncoder = new TextEncoder();

/**
 * Removes `@pos(x, y)` visual node layout annotations from a MoeSekai Script (`.msk`) string.
 * Uses the lossless parser + serializer whenever the script parses cleanly, falling back to
 * node-header line stripping only if the script contains syntax errors.
 */
export function stripMskPositions(script: string): string {
    const parsed = parseStoryScript(script);
    if (parsed.ok) {
        return serializeStoryScript(parsed.doc, { includePositions: false });
    }
    return script.replace(
        /^(\s*(?:start|scene|choice|condition|end)\b[^\r\n]*?)\s+@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/gm,
        "$1",
    );
}

/**
 * Runs complete `.msk` export preflight on a `StoryDocument` (or raw `.msk` script):
 * 1. Parses `.msk` input (if string) and runs strict whitelist validation (`validateStoryDocument`).
 * 2. Compiles the story graph (`compileStoryGraph`) to gather all errors, warnings, and endings.
 * 3. Serializes portable `.msk` output with optional `@pos(x, y)` coordinate stripping.
 * 4. Computes a structured metadata summary (counts, attached locales, UTF-8 byte length, lines).
 */
export function prepareMskExport(
    docOrScript: StoryDocument | string,
    options: PrepareMskExportOptions = {},
): PreparedMskExport {
    const stripPositions = Boolean(options.stripPositions);
    const strict = Boolean(options.strict);

    let inputDoc: StoryDocument;
    if (typeof docOrScript === "string") {
        const parsed = parseStoryScript(docOrScript);
        if (!parsed.ok) {
            const detail = parsed.diagnostics.map(d => `${d.line}:${d.col} ${d.message}`).join("; ");
            throw new Error(`Invalid .msk script: ${detail || "parse failed"}`);
        }
        inputDoc = parsed.doc;
    } else {
        inputDoc = docOrScript;
    }

    const validation = validateStoryDocument(inputDoc);
    const doc = validation.ok ? validation.doc : inputDoc;
    const program = validation.ok ? validation.program : compileStoryGraph(doc);
    const issues: StoryIssue[] = validation.ok ? [] : validation.issues;
    const errors = program.errors;
    const warnings = program.warnings;

    const script = serializeStoryScript(doc, { includePositions: !stripPositions });
    const filename = storyScriptFileName(doc);

    let sceneCount = 0;
    let beatCount = 0;
    let talkBeatCount = 0;
    for (const node of Object.values(doc.nodes)) {
        if (node.type === "scene") {
            sceneCount += 1;
            beatCount += node.beats.length;
            for (const beat of node.beats) {
                if (beat.kind === "talk") talkBeatCount += 1;
            }
        }
    }

    const localeCodes = doc.locales
        ? (Object.keys(doc.locales).filter(k => Boolean(doc.locales?.[k as UiLocale])) as UiLocale[])
        : [];
    const byteLength = textEncoder.encode(script).byteLength;
    const lineCount = script.length === 0 ? 0 : script.replace(/\r?\n$/, "").split(/\r?\n/).length;

    const hasErrors = !validation.ok || errors.length > 0;
    const strictOk = !hasErrors && warnings.length === 0;
    const ok = strict ? strictOk : !hasErrors;

    return {
        ok,
        strictOk,
        filename,
        script,
        doc,
        program,
        issues,
        errors,
        warnings,
        summary: {
            id: doc.id,
            title: doc.meta.title,
            summary: doc.meta.summary,
            author: doc.meta.author,
            region: doc.region,
            ...(doc.sourceLocale ? { sourceLocale: doc.sourceLocale } : {}),
            castCount: doc.cast.length,
            variableCount: doc.variables.length,
            nodeCount: Object.keys(doc.nodes).length,
            sceneCount,
            beatCount,
            talkBeatCount,
            edgeCount: doc.edges.length,
            endingCount: program.endingNodeIds.length,
            localeCodes,
            byteLength,
            lineCount,
            strippedPositions: stripPositions,
        },
    };
}

// ==================== Export Adapter ====================

export interface StoryExportResult {
    ok: boolean;
    canceled?: boolean;
    filename?: string;
    outputPath?: string;
    byteLength?: number;
    error?: string;
}

export interface StoryBundleExportOptions extends PrepareMskExportOptions {
    /** Target container format (`"zip"` or local folder `"directory"` on desktop). */
    format?: "zip" | "directory";
    /** Include attached `doc.locales` as `locales/<locale>.i18n.json` (default: `true`). */
    includeLocales?: boolean;
    /** Optional custom voice track manifest to include as `voices/manifest.json`. */
    voiceManifest?: StoryVoiceManifest | null;
    /** Include referenced local audio files when exporting from a desktop workspace (default: `true`). */
    includeVoiceFiles?: boolean;
}

/**
 * Export contract implemented by Web (browser downloads) and Electron desktop
 * (native Save dialogs, clean `.msk` export, full `.zip`/folder story bundle export).
 */
export interface StoryExportAdapter {
    /** Export `.msk` script with optional preflight options. */
    exportMsk(
        doc: StoryDocument,
        options?: PrepareMskExportOptions,
    ): Promise<StoryExportResult>;
    /** Export a decoupled `StoryLocalePack` (`.<locale>.i18n.json`). */
    exportLocalePack(
        doc: StoryDocument,
        pack: StoryLocalePack,
    ): Promise<StoryExportResult>;
    /** Export a full multi-file bundle (`story.msk` + `locales/*.i18n.json` + optional `voices/`). */
    exportFullBundle?(
        doc: StoryDocument,
        options?: StoryBundleExportOptions,
    ): Promise<StoryExportResult>;
    /** Export a custom voice track manifest (`voices/manifest.json`). */
    exportVoiceManifest?(
        doc: StoryDocument,
        manifest: StoryVoiceManifest,
    ): Promise<StoryExportResult>;
}

function browserTriggerDownload(content: string, mime: string, filename: string): number {
    if (typeof document === "undefined" || typeof URL === "undefined") {
        throw new Error("browser_download_unavailable");
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (typeof window !== "undefined") {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return blob.size;
}

/** Creates a browser Blob-download `StoryExportAdapter` for Web hosts. */
export function createBrowserStoryExportAdapter(): StoryExportAdapter {
    return {
        async exportMsk(doc, options) {
            const prepared = prepareMskExport(doc, options);
            const byteLength = browserTriggerDownload(
                prepared.script,
                "text/plain;charset=utf-8",
                prepared.filename,
            );
            return {
                ok: true,
                filename: prepared.filename,
                byteLength,
            };
        },
        async exportLocalePack(doc, pack) {
            const filename = storyLocalePackFileName(doc, pack.locale);
            const content = serializeStoryLocalePack(pack);
            const byteLength = browserTriggerDownload(
                content,
                "application/json;charset=utf-8",
                filename,
            );
            return {
                ok: true,
                filename,
                byteLength,
            };
        },
        async exportVoiceManifest(doc, manifest) {
            const base = storyScriptFileName(doc).replace(/\.msk$/i, "");
            const filename = `${base}.voice.json`;
            const content = `${JSON.stringify(manifest, null, 2)}\n`;
            const byteLength = browserTriggerDownload(
                content,
                "application/json;charset=utf-8",
                filename,
            );
            return {
                ok: true,
                filename,
                byteLength,
            };
        },
    };
}
