import fs from "node:fs";
import path from "node:path";
import {
    configureStoryCore,
    fetchLive2DModels,
    getStoryCoreConfig,
    isLive2DRegion,
    parseStoryScript,
    prepareMskExport,
    stripMskPositions,
    type AssetLine,
    type StoryDocument,
    type StoryVoiceManifest,
} from "@moesekai/story-core";
import {
    isValidLocaleCode,
    PathJailError,
    resolveJailedPath,
} from "../shared/path-jail.ts";
import { createZipBuffer, type ZipInputEntry } from "../shared/zip.ts";
import type {
    DesktopStoryRegion,
    ExportBundleRequest,
    ExportDiagnosticItem,
    ExportLocalesRequest,
    ExportMskRequest,
    ExportOperationResult,
    ExportPreflightRequest,
    ExportPreflightResult,
    ExportPreflightStats,
} from "../shared/ipc.ts";

/**
 * Removes `@pos(x, y)` layout directives from a serialized `.msk` script so exported
 * scripts are compact and clean while remaining 100% lossless for `pjsk.moe/story-maker/play`
 * (which automatically runs `autoLayoutGraph` when `@pos` is omitted).
 */
export function stripPosDirectivesFromMsk(script: string): string {
    return stripMskPositions(script);
}

function collectLocalVoiceReferences(
    voiceManifest: unknown | null | undefined,
    workspaceRoot: string | null | undefined,
): Array<{ relativePath: string; absolutePath: string }> {
    if (!workspaceRoot || !voiceManifest || typeof voiceManifest !== "object") return [];
    const manifest = voiceManifest as Partial<StoryVoiceManifest>;
    if (!manifest.lines || typeof manifest.lines !== "object") return [];

    const seen = new Set<string>();
    const results: Array<{ relativePath: string; absolutePath: string }> = [];

    for (const line of Object.values(manifest.lines)) {
        if (!line || typeof line !== "object") continue;
        const candidates = [line.objectKey, line.url].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        for (const rawRef of candidates) {
            let rel: string | null = null;
            if (rawRef.startsWith("moesekai-app://workspace/")) {
                rel = rawRef.slice("moesekai-app://workspace/".length);
            } else if (rawRef.startsWith("moesekai-app://app/workspace/")) {
                rel = rawRef.slice("moesekai-app://app/workspace/".length);
            } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawRef) && !rawRef.startsWith("/")) {
                rel = rawRef;
            }
            if (!rel) continue;

            try {
                const abs = resolveJailedPath(workspaceRoot, rel, { mustExist: true });
                if (!fs.statSync(abs).isFile()) continue;
                const normalizedRel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
                if (seen.has(normalizedRel)) continue;
                seen.add(normalizedRel);
                results.push({ relativePath: normalizedRel, absolutePath: abs });
            } catch (err) {
                if (err instanceof PathJailError && (err.code === "PATH_ESCAPE" || err.code === "SYMLINK_ESCAPE")) {
                    throw err;
                }
                // Missing optional file or external URL: skip silently during collection
            }
        }
    }

    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function rewriteManifestForPortableBundle(
    voiceManifest: unknown | null | undefined,
    bundledRelPaths: Set<string>,
): unknown | null {
    if (!voiceManifest || typeof voiceManifest !== "object") return null;
    const cloned = JSON.parse(JSON.stringify(voiceManifest)) as Record<string, unknown>;
    if (!cloned.lines || typeof cloned.lines !== "object") return cloned;
    const lines = cloned.lines as Record<string, Record<string, unknown>>;
    for (const line of Object.values(lines)) {
        if (!line || typeof line !== "object") continue;
        const rawUrl = typeof line.url === "string" ? line.url : "";
        let rel: string | null = null;
        if (rawUrl.startsWith("moesekai-app://workspace/")) {
            rel = rawUrl.slice("moesekai-app://workspace/".length);
        } else if (rawUrl.startsWith("moesekai-app://app/workspace/")) {
            rel = rawUrl.slice("moesekai-app://app/workspace/".length);
        }
        if (rel) {
            const cleanRel = rel.replace(/^\/+/, "").replace(/\\/g, "/");
            if (bundledRelPaths.has(cleanRel)) {
                line.url = cleanRel;
                line.objectKey = cleanRel;
            }
        }
    }
    return cloned;
}

function countStoryStats(
    doc: StoryDocument,
    locales?: Record<string, unknown>,
    voiceManifest?: unknown | null,
    localVoiceCount = 0,
): ExportPreflightStats {
    const nodes = Object.values(doc.nodes);
    let sceneCount = 0;
    let beatCount = 0;
    let endingCount = 0;

    for (const node of nodes) {
        if (node.type === "scene") {
            sceneCount++;
            beatCount += node.beats.length;
        } else if (node.type === "end") {
            endingCount++;
        }
    }

    const localeCount = locales
        ? Object.keys(locales).filter(k => isValidLocaleCode(k) && locales[k] != null).length
        : (doc.locales ? Object.keys(doc.locales).length : 0);

    const voiceLineCount =
        voiceManifest && typeof voiceManifest === "object" && "lines" in voiceManifest && voiceManifest.lines && typeof voiceManifest.lines === "object"
            ? Object.keys(voiceManifest.lines as Record<string, unknown>).length
            : 0;

    return {
        nodeCount: nodes.length,
        sceneCount,
        beatCount,
        endingCount,
        castCount: doc.cast.length,
        variableCount: doc.variables.length,
        localeCount,
        voiceLineCount,
        localVoiceFileCount: localVoiceCount,
    };
}

async function checkLiveCdnAssets(doc: StoryDocument, assetLine?: AssetLine): Promise<string[]> {
    const issues: string[] = [];
    if (!isLive2DRegion(doc.region)) {
        issues.push(`Unsupported Live2D region "${String(doc.region)}" for live asset site catalog check.`);
        return issues;
    }

    const prevLine = getStoryCoreConfig().defaultAssetLine;
    const shouldSwitchLine = Boolean(assetLine && assetLine !== prevLine);
    let modelsPromise: ReturnType<typeof fetchLive2DModels>;
    if (shouldSwitchLine && assetLine) {
        configureStoryCore({ defaultAssetLine: assetLine });
    }
    try {
        modelsPromise = fetchLive2DModels(doc.region, AbortSignal.timeout(8000));
    } finally {
        if (shouldSwitchLine) {
            configureStoryCore({ defaultAssetLine: prevLine });
        }
    }

    try {
        const models = await modelsPromise;
        if (models.length === 0) {
            issues.push(`Unable to load Live2D asset site catalog for region "${doc.region}" (empty listing).`);
            return issues;
        }
        const validIds = new Set(models.map(m => m.id).filter(Boolean));
        for (const member of doc.cast) {
            if (!validIds.has(member.modelId)) {
                issues.push(
                    `Cast "${member.key}" modelId "${member.modelId}" not found in ${doc.region} Live2D asset site catalog.`,
                );
            }
        }
    } catch (err) {
        issues.push(`Live CDN check skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    return issues;
}

/**
 * Runs `@moesekai/story-core` parse + graph compile + diagnostics summary + optional live CDN check.
 */
export async function runExportPreflight(req: ExportPreflightRequest): Promise<ExportPreflightResult> {
    const parsed = parseStoryScript(req.script);

    if (!parsed.ok) {
        const errors: ExportDiagnosticItem[] = parsed.diagnostics.map(d => ({
            severity: "error",
            code: "syntaxError",
            path: `line ${d.line}:${d.col}`,
            message: d.message,
        }));
        return {
            ok: false,
            canExportCleanMsk: false,
            title: "Invalid Script",
            region: "jp",
            errors,
            warnings: [],
            stats: {
                nodeCount: 0,
                sceneCount: 0,
                beatCount: 0,
                endingCount: 0,
                castCount: 0,
                variableCount: 0,
                localeCount: 0,
                voiceLineCount: 0,
                localVoiceFileCount: 0,
            },
            previewScript: req.script,
            previewByteLength: Buffer.byteLength(req.script, "utf8"),
        };
    }

    const doc = parsed.doc;
    const prepared = prepareMskExport(doc, { stripPositions: !req.includePositions });

    const errors: ExportDiagnosticItem[] = [];
    const warnings: ExportDiagnosticItem[] = [];

    for (const issue of prepared.issues) {
        errors.push({
            severity: "error",
            code: issue.code,
            path: issue.path,
            params: issue.params,
        });
    }

    for (const diag of prepared.program.diagnostics) {
        const item: ExportDiagnosticItem = {
            severity: diag.severity,
            code: diag.code,
            path: diag.path,
            nodeId: diag.nodeId,
            beatId: diag.beatId,
            params: diag.params,
        };
        if (diag.severity === "error") errors.push(item);
        else warnings.push(item);
    }

    const previewScript = prepared.script;

    let localVoiceCount = 0;
    try {
        localVoiceCount = collectLocalVoiceReferences(req.voiceManifest, req.workspaceRoot).length;
    } catch (err) {
        errors.push({
            severity: "error",
            code: "pathEscape",
            path: "voices/manifest.json",
            message: err instanceof Error ? err.message : String(err),
        });
    }

    const liveAssetIssues = req.checkLiveAssets ? await checkLiveCdnAssets(doc, req.assetLine) : undefined;

    return {
        ok: errors.length === 0,
        canExportCleanMsk: errors.length === 0,
        title: doc.meta.title || "Untitled Story",
        region: doc.region as DesktopStoryRegion,
        errors,
        warnings,
        stats: countStoryStats(doc, req.locales, req.voiceManifest, localVoiceCount),
        previewScript,
        previewByteLength: Buffer.byteLength(previewScript, "utf8"),
        liveAssetIssues,
    };
}

/**
 * Mode 1: Export clean, preflight-verified `.msk` file playable directly on `pjsk.moe/story-maker/play`.
 */
export async function exportCleanMskToFile(
    req: ExportMskRequest & { outputPath: string },
): Promise<ExportOperationResult> {
    const preflight = await runExportPreflight({
        script: req.script,
        includePositions: req.includePositions,
    });

    if (!preflight.canExportCleanMsk) {
        throw new Error(
            `Export blocked by ${preflight.errors.length} error(s): ${preflight.errors[0]?.message ?? preflight.errors[0]?.code ?? "unknown error"}`,
        );
    }

    const outAbs = path.resolve(req.outputPath);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    const buf = Buffer.from(preflight.previewScript, "utf8");
    fs.writeFileSync(outAbs, buf);

    return {
        canceled: false,
        outputPath: outAbs,
        bytesWritten: buf.byteLength,
        filesWritten: [outAbs],
        errorCount: preflight.errors.length,
        warningCount: preflight.warnings.length,
    };
}

/**
 * Mode 2: Export full portable story bundle (`.zip` archive or directory) containing:
 * - `story.msk` (clean or with `@pos`)
 * - `locales/<locale>.i18n.json`
 * - `voices/manifest.json` + referenced local voice audio files (strictly path-jailed!)
 * - `bundle-manifest.json`
 */
export async function exportFullBundleToPath(
    req: ExportBundleRequest & { outputPath: string },
): Promise<ExportOperationResult> {
    // Validate local voice references first so path-jail escapes always throw PathJailError explicitly.
    const localVoices = collectLocalVoiceReferences(req.voiceManifest, req.workspaceRoot);

    const preflight = await runExportPreflight({
        script: req.script,
        includePositions: req.includePositions,
        locales: req.locales,
        voiceManifest: req.voiceManifest,
        workspaceRoot: req.workspaceRoot,
    });

    if (!preflight.canExportCleanMsk) {
        throw new Error(
            `Bundle export blocked by ${preflight.errors.length} error(s): ${preflight.errors[0]?.message ?? preflight.errors[0]?.code ?? "unknown error"}`,
        );
    }

    const entries: ZipInputEntry[] = [];
    entries.push({
        path: "story.msk",
        data: preflight.previewScript,
    });

    const localeFiles: string[] = [];
    if (req.locales) {
        for (const [locale, pack] of Object.entries(req.locales)) {
            if (!isValidLocaleCode(locale) || pack == null) continue;
            const rel = `locales/${locale}.i18n.json`;
            localeFiles.push(rel);
            entries.push({
                path: rel,
                data: JSON.stringify(pack, null, 2) + "\n",
            });
        }
    }

    const bundledRelPaths = new Set(localVoices.map(v => v.relativePath));

    for (const voice of localVoices) {
        entries.push({
            path: voice.relativePath,
            data: fs.readFileSync(voice.absolutePath),
            store: true,
        });
    }

    const portableManifest = rewriteManifestForPortableBundle(req.voiceManifest, bundledRelPaths);
    if (portableManifest) {
        entries.push({
            path: "voices/manifest.json",
            data: JSON.stringify(portableManifest, null, 2) + "\n",
        });
    }

    const bundleManifest = {
        schema: "moesekai-story-bundle/1",
        exportedAt: new Date().toISOString(),
        title: preflight.title,
        region: preflight.region,
        includePositions: req.includePositions,
        entryFile: "story.msk",
        locales: localeFiles,
        hasVoiceManifest: Boolean(portableManifest),
        localVoiceFiles: localVoices.map(v => v.relativePath),
        stats: preflight.stats,
    };
    entries.push({
        path: "bundle-manifest.json",
        data: JSON.stringify(bundleManifest, null, 2) + "\n",
    });

    const outAbs = path.resolve(req.outputPath);

    if (req.format === "zip") {
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        const zipBuf = createZipBuffer(entries);
        fs.writeFileSync(outAbs, zipBuf);
        return {
            canceled: false,
            outputPath: outAbs,
            bytesWritten: zipBuf.byteLength,
            filesWritten: entries.map(e => e.path),
            errorCount: preflight.errors.length,
            warningCount: preflight.warnings.length,
        };
    }

    // Folder mode
    fs.mkdirSync(outAbs, { recursive: true });
    let totalBytes = 0;
    const writtenFiles: string[] = [];
    for (const entry of entries) {
        const dest = resolveJailedPath(outAbs, entry.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const buf = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
        fs.writeFileSync(dest, buf);
        totalBytes += buf.byteLength;
        writtenFiles.push(dest);
    }

    return {
        canceled: false,
        outputPath: outAbs,
        bytesWritten: totalBytes,
        filesWritten: writtenFiles,
        errorCount: preflight.errors.length,
        warningCount: preflight.warnings.length,
    };
}

/**
 * Mode 3: Export locale `.i18n.json` packs and optional `voices/manifest.json` directly to disk.
 */
export async function exportLocalesToDirectory(
    req: ExportLocalesRequest & { outputDir: string },
): Promise<ExportOperationResult> {
    const outDirAbs = path.resolve(req.outputDir);
    fs.mkdirSync(outDirAbs, { recursive: true });

    const filesWritten: string[] = [];
    let totalBytes = 0;

    for (const [locale, pack] of Object.entries(req.locales)) {
        if (!isValidLocaleCode(locale) || pack == null) continue;
        const target = resolveJailedPath(outDirAbs, `${locale}.i18n.json`);
        const buf = Buffer.from(JSON.stringify(pack, null, 2) + "\n", "utf8");
        fs.writeFileSync(target, buf);
        totalBytes += buf.byteLength;
        filesWritten.push(target);
    }

    if (req.voiceManifest != null) {
        const target = resolveJailedPath(outDirAbs, "voice-manifest.json");
        const buf = Buffer.from(JSON.stringify(req.voiceManifest, null, 2) + "\n", "utf8");
        fs.writeFileSync(target, buf);
        totalBytes += buf.byteLength;
        filesWritten.push(target);
    }

    return {
        canceled: false,
        outputPath: outDirAbs,
        bytesWritten: totalBytes,
        filesWritten,
        errorCount: 0,
        warningCount: 0,
    };
}
