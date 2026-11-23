import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    isValidLocaleCode,
    resolveJailedPath,
    sanitizeExportFilename,
} from "../shared/path-jail.ts";
import type {
    CreateWorkspaceInput,
    DesktopStoryRegion,
    RecentProjectEntry,
    SaveWorkspaceInput,
    SaveWorkspaceResult,
    WorkspaceExternalChangeEvent,
    WorkspaceProjectData,
    WorkspaceSnapshotInfo,
} from "../shared/ipc.ts";

const STUDIO_DIR = ".moesekai-studio";
const SNAPSHOTS_DIR = path.join(STUDIO_DIR, "snapshots");
const PROJECT_META_FILE = path.join(STUDIO_DIR, "project.json");
const LOCALES_DIR = "locales";
const VOICES_DIR = "voices";
const VOICE_MANIFEST_REL = path.join(VOICES_DIR, "manifest.json");
const RECENT_PROJECTS_FILE = "recent-projects.json";
const MAX_RECENT_PROJECTS = 15;
const MAX_SNAPSHOTS = 60;
const ECHO_SUPPRESS_WINDOW_MS = 1800;

const SUPPORTED_VOICE_EXTS = new Set([".ogg", ".mp3", ".wav", ".m4a", ".flac", ".webm"]);
const STORY_REGIONS = new Set<DesktopStoryRegion>(["jp", "cn", "tw", "kr", "en"]);

interface ProjectMetaRecord {
    id: string;
    createdAt: number;
    updatedAt: number;
}

interface SnapshotSidecarMeta {
    id: string;
    createdAt: string;
    reason: string;
    toolName?: string;
    storyFile?: string;
    nodeCount?: number;
    beatCount?: number;
    byteLength?: number;
    sha256?: string;
}

function sha256Text(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function extractHeaderMetaFromMsk(script: string): { title: string; region: DesktopStoryRegion } {
    let title = "Untitled Story";
    let region: DesktopStoryRegion = "jp";
    const lines = script.split(/\r?\n/, 40);
    for (const line of lines) {
        const trimmed = line.trim();
        const storyMatch = trimmed.match(/^@story\s+"((?:\\.|[^"\\])*)"(.*)$/);
        if (storyMatch) {
            const candidate = storyMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
            if (candidate) title = candidate;
            const regAttr = storyMatch[2].match(/\bregion=([a-z]{2})\b/i);
            if (regAttr) {
                const r = regAttr[1].toLowerCase() as DesktopStoryRegion;
                if (STORY_REGIONS.has(r)) region = r;
            }
            continue;
        }
        const titleMatch = trimmed.match(/^@title\s+"([^"]*)"|^@title\s+(.+)$/);
        if (titleMatch) {
            const candidate = (titleMatch[1] ?? titleMatch[2] ?? "").trim();
            if (candidate) title = candidate;
        }
        const regionMatch = trimmed.match(/^@region\s+([a-z]{2})\b/i);
        if (regionMatch) {
            const r = regionMatch[1].toLowerCase() as DesktopStoryRegion;
            if (STORY_REGIONS.has(r)) region = r;
        }
    }
    return { title, region };
}

function atomicWriteUtf8(targetPath: string, content: string): number {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(content, "utf8");
    const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, targetPath);
    return buf.byteLength;
}

function listFilesRecursive(baseDir: string, currentRel = ""): string[] {
    const absDir = currentRel ? path.join(baseDir, currentRel) : baseDir;
    if (!fs.existsSync(absDir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(baseDir, rel));
        } else if (entry.isFile()) {
            results.push(rel);
        }
    }
    return results;
}

function hasExistingProjectInDir(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) return false;
    try {
        if (!fs.statSync(dirPath).isDirectory()) return true;
        if (fs.existsSync(path.join(dirPath, "story.msk"))) return true;
        if (fs.existsSync(path.join(dirPath, PROJECT_META_FILE))) return true;
        const entries = fs.readdirSync(dirPath);
        return entries.some(name => name.toLowerCase().endsWith(".msk"));
    } catch {
        return true;
    }
}

/**
 * Resolves a collision-free child directory inside `parentDir` for a new project.
 * If `parentDir/<baseFolderName>` already holds a `.msk` project, appends `-2`, `-3`, etc.
 */
export function resolveUniqueProjectDir(parentDir: string, baseFolderName: string): string {
    const absParent = path.resolve(parentDir);
    const safeBase = sanitizeExportFilename(baseFolderName || "moesekai-story", "moesekai-story");
    const first = path.join(absParent, safeBase);
    if (!hasExistingProjectInDir(first)) {
        return first;
    }
    for (let suffix = 2; suffix < 1000; suffix++) {
        const candidate = path.join(absParent, `${safeBase}-${suffix}`);
        if (!hasExistingProjectInDir(candidate)) {
            return candidate;
        }
    }
    return path.join(absParent, `${safeBase}-${crypto.randomBytes(3).toString("hex")}`);
}

export interface WorkspaceManagerOptions {
    userDataDir: string;
    debounceMs?: number;
}

/**
 * Pure Node/Bun local `.msk` project & workspace manager with atomic writes,
 * snapshot/rollback history, recent project persistence, and self-write echo-suppressed watching.
 */
export class WorkspaceManager {
    private readonly userDataDir: string;
    private readonly debounceMs: number;

    private activeRootDir: string | null = null;
    private activeMskPath: string | null = null;
    private activeIsSingleFile = false;
    private activeProjectId: string | null = null;

    private watchers: fs.FSWatcher[] = [];
    private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingChangeKinds = new Set<"msk" | "locales" | "voice-manifest">();
    private externalListener: ((event: WorkspaceExternalChangeEvent) => void) | null = null;

    /** Self-write echo suppression state. */
    private lastWrittenHash = new Map<string, { hash: string; writtenAt: number }>();

    constructor(options: WorkspaceManagerOptions) {
        this.userDataDir = path.resolve(options.userDataDir);
        this.debounceMs = options.debounceMs ?? 160;
        fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    getActiveRootDir(): string | null {
        return this.activeRootDir;
    }

    getActiveMskPath(): string | null {
        return this.activeMskPath;
    }

    getActiveStoryFileName(): string {
        return this.activeMskPath ? path.basename(this.activeMskPath) : "story.msk";
    }

    onExternalChange(listener: ((event: WorkspaceExternalChangeEvent) => void) | null): void {
        this.externalListener = listener;
    }

    getActiveProject(): WorkspaceProjectData | null {
        if (!this.activeRootDir || !this.activeMskPath || !fs.existsSync(this.activeMskPath)) {
            return null;
        }
        return this.readProjectData(this.activeRootDir, this.activeMskPath, this.activeIsSingleFile);
    }

    /**
     * Creates a new project directory containing `story.msk`, `locales/`, `voices/`, and `.moesekai-studio/snapshots/`.
     * Guards against silently overwriting an existing `.msk` project unless `allowOverwrite === true`.
     */
    createProject(input: CreateWorkspaceInput): WorkspaceProjectData {
        const rootDir = path.resolve(input.dirPath);
        if (!input.allowOverwrite && hasExistingProjectInDir(rootDir)) {
            throw new Error(`Project folder already contains an existing MoeSekai project: ${rootDir}`);
        }

        // Tear down any previous project's watchers & debounce queue cleanly before writing the new project.
        this.closeProject();

        fs.mkdirSync(rootDir, { recursive: true });
        fs.mkdirSync(path.join(rootDir, LOCALES_DIR), { recursive: true });
        fs.mkdirSync(path.join(rootDir, VOICES_DIR), { recursive: true });
        fs.mkdirSync(path.join(rootDir, SNAPSHOTS_DIR), { recursive: true });

        const mskPath = path.join(rootDir, "story.msk");
        const now = Date.now();
        const meta: ProjectMetaRecord = {
            id: `proj_${crypto.randomBytes(6).toString("hex")}`,
            createdAt: now,
            updatedAt: now,
        };

        this.recordSelfWrite(mskPath, input.initialScript);
        atomicWriteUtf8(mskPath, input.initialScript);
        atomicWriteUtf8(path.join(rootDir, PROJECT_META_FILE), JSON.stringify(meta, null, 2));

        return this.openProject(rootDir);
    }

    /**
     * Opens an existing project folder OR a single `.msk` file directly.
     */
    openProject(targetPath: string): WorkspaceProjectData {
        const absTarget = path.resolve(targetPath);
        if (!fs.existsSync(absTarget)) {
            throw new Error(`Project path does not exist: ${absTarget}`);
        }

        const stat = fs.statSync(absTarget);
        let rootDir: string;
        let mskPath: string;
        let isSingleFile: boolean;

        if (stat.isFile()) {
            if (path.extname(absTarget).toLowerCase() !== ".msk") {
                throw new Error(`Expected a .msk file or project folder, got: ${absTarget}`);
            }
            rootDir = path.dirname(absTarget);
            mskPath = absTarget;
            isSingleFile = true;
        } else if (stat.isDirectory()) {
            rootDir = absTarget;
            isSingleFile = false;
            const defaultMsk = path.join(rootDir, "story.msk");
            if (fs.existsSync(defaultMsk)) {
                mskPath = defaultMsk;
            } else {
                const mskCandidates = fs
                    .readdirSync(rootDir)
                    .filter(name => name.toLowerCase().endsWith(".msk"))
                    .sort();
                if (mskCandidates.length > 0) {
                    mskPath = path.join(rootDir, mskCandidates[0]);
                } else {
                    throw new Error(`No story.msk (or .msk file) found inside folder: ${rootDir}`);
                }
            }
        } else {
            throw new Error(`Unsupported file system entry: ${absTarget}`);
        }

        this.stopWatching();
        this.activeRootDir = rootDir;
        this.activeMskPath = mskPath;
        this.activeIsSingleFile = isSingleFile;

        const data = this.readProjectData(rootDir, mskPath, isSingleFile);
        this.activeProjectId = data.id;

        // Seed self-write map with current disk contents so initial watch doesn't fire spuriously.
        this.lastWrittenHash.clear();
        this.recordSelfWrite(mskPath, data.script);

        const header = extractHeaderMetaFromMsk(data.script);
        this.recordRecentProject({
            path: isSingleFile ? mskPath : rootDir,
            rootDir,
            mskFilePath: mskPath,
            title: header.title,
            region: header.region,
            lastOpenedAt: Date.now(),
            isSingleFile,
        });

        this.startWatching();
        return data;
    }

    closeProject(): void {
        this.stopWatching();
        this.activeRootDir = null;
        this.activeMskPath = null;
        this.activeIsSingleFile = false;
        this.activeProjectId = null;
        this.lastWrittenHash.clear();
    }

    /**
     * Saves the active workspace `.msk` (plus optional locale packs & voice manifest)
     * with self-write echo suppression so `fs.watch` never bounces back to the renderer.
     */
    saveProject(input: SaveWorkspaceInput): SaveWorkspaceResult {
        if (!this.activeRootDir || !this.activeMskPath) {
            throw new Error("No active workspace project to save.");
        }

        let snapshot: WorkspaceSnapshotInfo | undefined;
        if (input.createSnapshotReason) {
            snapshot = this.createSnapshot(input.createSnapshotReason);
        }

        this.recordSelfWrite(this.activeMskPath, input.script);
        const bytesWritten = atomicWriteUtf8(this.activeMskPath, input.script);

        if (input.locales !== undefined) {
            const localesDir = path.join(this.activeRootDir, LOCALES_DIR);
            fs.mkdirSync(localesDir, { recursive: true });
            const desiredLocales = new Set<string>();
            for (const [locale, pack] of Object.entries(input.locales)) {
                if (!isValidLocaleCode(locale) || pack == null) continue;
                desiredLocales.add(locale);
                const packPath = resolveJailedPath(localesDir, `${locale}.i18n.json`);
                const jsonText = JSON.stringify(pack, null, 2) + "\n";
                this.recordSelfWrite(packPath, jsonText);
                atomicWriteUtf8(packPath, jsonText);
            }
            // Remove locale files that were explicitly deleted from the document.
            if (fs.existsSync(localesDir)) {
                for (const fileName of fs.readdirSync(localesDir)) {
                    if (!fileName.endsWith(".i18n.json")) continue;
                    const loc = fileName.slice(0, -".i18n.json".length);
                    if (isValidLocaleCode(loc) && !desiredLocales.has(loc)) {
                        const target = path.join(localesDir, fileName);
                        this.lastWrittenHash.set(this.keyForPath(target), {
                            hash: "__deleted__",
                            writtenAt: Date.now(),
                        });
                        fs.rmSync(target, { force: true });
                    }
                }
            }
        }

        if (input.voiceManifest !== undefined) {
            const manifestPath = path.join(this.activeRootDir, VOICE_MANIFEST_REL);
            if (input.voiceManifest === null) {
                if (fs.existsSync(manifestPath)) {
                    this.lastWrittenHash.set(this.keyForPath(manifestPath), {
                        hash: "__deleted__",
                        writtenAt: Date.now(),
                    });
                    fs.rmSync(manifestPath, { force: true });
                }
            } else {
                const jsonText = JSON.stringify(input.voiceManifest, null, 2) + "\n";
                this.recordSelfWrite(manifestPath, jsonText);
                atomicWriteUtf8(manifestPath, jsonText);
            }
        }

        const now = Date.now();
        this.updateProjectMetaTimestamp(this.activeRootDir, now);

        const header = extractHeaderMetaFromMsk(input.script);
        this.recordRecentProject({
            path: this.activeIsSingleFile ? this.activeMskPath : this.activeRootDir,
            rootDir: this.activeRootDir,
            mskFilePath: this.activeMskPath,
            title: header.title,
            region: header.region,
            lastOpenedAt: now,
            isSingleFile: this.activeIsSingleFile,
        });

        return {
            savedAt: now,
            mskFilePath: this.activeMskPath,
            bytesWritten,
            snapshot,
        };
    }

    /**
     * Creates a snapshot of the current `.msk` on disk under `.moesekai-studio/snapshots/`.
     */
    createSnapshot(reason = "manual"): WorkspaceSnapshotInfo {
        if (!this.activeRootDir || !this.activeMskPath || !fs.existsSync(this.activeMskPath)) {
            throw new Error("No active project to snapshot.");
        }

        const snapshotsDir = path.join(this.activeRootDir, SNAPSHOTS_DIR);
        fs.mkdirSync(snapshotsDir, { recursive: true });

        const currentContent = fs.readFileSync(this.activeMskPath, "utf8");
        const now = new Date();
        const stamp = now.toISOString().replace(/[:.]/g, "-");
        const rand = crypto.randomBytes(3).toString("hex");
        const id = `${stamp}-${rand}`;
        const mskSnapPath = path.join(snapshotsDir, `${id}.msk`);
        const metaSnapPath = path.join(snapshotsDir, `${id}.meta.json`);

        const byteLength = atomicWriteUtf8(mskSnapPath, currentContent);
        const sha256 = sha256Text(currentContent);
        const meta: SnapshotSidecarMeta = {
            id,
            createdAt: now.toISOString(),
            reason,
            storyFile: path.basename(this.activeMskPath),
            byteLength,
            sha256,
        };
        atomicWriteUtf8(metaSnapPath, JSON.stringify(meta, null, 2));

        this.pruneOldSnapshots(snapshotsDir);

        return {
            id,
            filePath: mskSnapPath,
            createdAt: meta.createdAt,
            reason: meta.reason,
            storyFile: meta.storyFile,
            byteLength,
            sha256,
        };
    }

    listSnapshots(rootDirOverride?: string): WorkspaceSnapshotInfo[] {
        const rootDir = rootDirOverride ?? this.activeRootDir;
        if (!rootDir) return [];
        const snapshotsDir = path.join(rootDir, SNAPSHOTS_DIR);
        if (!fs.existsSync(snapshotsDir)) return [];

        const results: WorkspaceSnapshotInfo[] = [];
        for (const entry of fs.readdirSync(snapshotsDir)) {
            if (!entry.endsWith(".msk")) continue;
            const id = entry.slice(0, -".msk".length);
            const mskPath = path.join(snapshotsDir, entry);
            const stat = fs.statSync(mskPath);
            if (!stat.isFile()) continue;

            // Support both `.meta.json` (desktop) and `.json` (story-agent) sidecar files.
            const metaCandidates = [
                path.join(snapshotsDir, `${id}.meta.json`),
                path.join(snapshotsDir, `${id}.json`),
            ];
            let meta: Partial<SnapshotSidecarMeta> = {};
            for (const cand of metaCandidates) {
                if (fs.existsSync(cand)) {
                    try {
                        meta = JSON.parse(fs.readFileSync(cand, "utf8")) as Partial<SnapshotSidecarMeta>;
                        break;
                    } catch {
                        // ignore malformed sidecar
                    }
                }
            }

            results.push({
                id,
                filePath: mskPath,
                createdAt: meta.createdAt ?? stat.mtime.toISOString(),
                reason: meta.reason ?? "snapshot",
                toolName: meta.toolName,
                storyFile: meta.storyFile ?? this.getActiveStoryFileName(),
                nodeCount: meta.nodeCount,
                beatCount: meta.beatCount,
                byteLength: meta.byteLength ?? stat.size,
                sha256: meta.sha256,
            });
        }

        return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Rolls back the active `.msk` file to a saved snapshot (creating a safety snapshot first).
     */
    rollbackSnapshot(snapshotId: string): WorkspaceProjectData {
        if (!this.activeRootDir || !this.activeMskPath) {
            throw new Error("No active project to roll back.");
        }
        if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) {
            throw new Error(`Invalid snapshot id: ${snapshotId}`);
        }

        const snapshotsDir = path.join(this.activeRootDir, SNAPSHOTS_DIR);
        const snapPath = resolveJailedPath(snapshotsDir, `${snapshotId}.msk`, { mustExist: true });
        const restoredScript = fs.readFileSync(snapPath, "utf8");

        // Save a safety snapshot of the pre-rollback state first.
        this.createSnapshot(`pre-rollback:${snapshotId}`);

        this.recordSelfWrite(this.activeMskPath, restoredScript);
        atomicWriteUtf8(this.activeMskPath, restoredScript);
        this.updateProjectMetaTimestamp(this.activeRootDir, Date.now());

        return this.readProjectData(this.activeRootDir, this.activeMskPath, this.activeIsSingleFile);
    }

    /**
     * Imports a local audio file into `<workspace>/voices/` safely and returns its relative path & URL.
     */
    importLocalVoiceFile(sourceFilePath: string, preferredStem?: string): {
        relativePath: string;
        absolutePath: string;
        fileName: string;
        sizeBytes: number;
    } {
        if (!this.activeRootDir) {
            throw new Error("No active workspace open.");
        }
        const srcAbs = path.resolve(sourceFilePath);
        if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
            throw new Error(`Audio source file does not exist: ${srcAbs}`);
        }
        const ext = path.extname(srcAbs).toLowerCase();
        if (!SUPPORTED_VOICE_EXTS.has(ext)) {
            throw new Error(`Unsupported audio file extension: ${ext}`);
        }

        const voicesRoot = path.join(this.activeRootDir, VOICES_DIR);
        fs.mkdirSync(voicesRoot, { recursive: true });

        const rawStem = preferredStem?.trim() || path.basename(srcAbs, ext);
        const safeStem = sanitizeExportFilename(rawStem, "voice");
        const fileName = `${safeStem}${ext}`;
        const destAbs = resolveJailedPath(voicesRoot, fileName);

        fs.copyFileSync(srcAbs, destAbs);
        const stat = fs.statSync(destAbs);

        return {
            relativePath: `voices/${fileName}`,
            absolutePath: destAbs,
            fileName,
            sizeBytes: stat.size,
        };
    }

    listRecentProjects(): RecentProjectEntry[] {
        const recentPath = path.join(this.userDataDir, RECENT_PROJECTS_FILE);
        if (!fs.existsSync(recentPath)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(recentPath, "utf8"));
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(
                (item): item is RecentProjectEntry =>
                    item && typeof item === "object" && typeof item.path === "string" && typeof item.mskFilePath === "string",
            );
        } catch {
            return [];
        }
    }

    removeRecentProject(targetPath: string): RecentProjectEntry[] {
        const normTarget = path.resolve(targetPath);
        const next = this.listRecentProjects().filter(
            entry => path.resolve(entry.path).toLowerCase() !== normTarget.toLowerCase(),
        );
        this.saveRecentProjects(next);
        return next;
    }

    dispose(): void {
        this.stopWatching();
    }

    // ==================== Private Helpers ====================

    private readProjectData(rootDir: string, mskPath: string, isSingleFile: boolean): WorkspaceProjectData {
        const script = fs.readFileSync(mskPath, "utf8");
        const stat = fs.statSync(mskPath);
        const meta = this.readOrInitProjectMeta(rootDir, stat.birthtimeMs || stat.mtimeMs, stat.mtimeMs);

        // Read locales/*.i18n.json
        const locales: Record<string, unknown> = {};
        const localesDir = path.join(rootDir, LOCALES_DIR);
        if (fs.existsSync(localesDir) && fs.statSync(localesDir).isDirectory()) {
            for (const fileName of fs.readdirSync(localesDir)) {
                if (!fileName.endsWith(".i18n.json")) continue;
                const locale = fileName.slice(0, -".i18n.json".length);
                if (!isValidLocaleCode(locale)) continue;
                try {
                    locales[locale] = JSON.parse(fs.readFileSync(path.join(localesDir, fileName), "utf8"));
                } catch {
                    // skip invalid JSON file rather than blocking project load
                }
            }
        }

        // Read voices/manifest.json
        let voiceManifest: unknown | null = null;
        const manifestPath = path.join(rootDir, VOICE_MANIFEST_REL);
        if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
            try {
                voiceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            } catch {
                voiceManifest = null;
            }
        }

        // Enumerate local voice files under voices/
        const voicesDir = path.join(rootDir, VOICES_DIR);
        const localVoiceFiles = listFilesRecursive(voicesDir)
            .filter(rel => SUPPORTED_VOICE_EXTS.has(path.extname(rel).toLowerCase()))
            .map(rel => `voices/${rel}`)
            .sort();

        return {
            id: meta.id,
            rootDir,
            mskFilePath: mskPath,
            storyFileName: path.basename(mskPath),
            isSingleFile,
            script,
            locales,
            voiceManifest,
            localVoiceFiles,
            snapshots: this.listSnapshots(rootDir),
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
        };
    }

    private readOrInitProjectMeta(rootDir: string, createdFallback: number, updatedFallback: number): ProjectMetaRecord {
        const metaPath = path.join(rootDir, PROJECT_META_FILE);
        if (fs.existsSync(metaPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Partial<ProjectMetaRecord>;
                if (typeof parsed.id === "string") {
                    return {
                        id: parsed.id,
                        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : createdFallback,
                        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : updatedFallback,
                    };
                }
            } catch {
                // fallback
            }
        }
        return {
            id: `proj_${crypto.createHash("sha256").update(rootDir).digest("hex").slice(0, 12)}`,
            createdAt: createdFallback,
            updatedAt: updatedFallback,
        };
    }

    private updateProjectMetaTimestamp(rootDir: string, updatedAt: number): void {
        if (this.activeIsSingleFile) return; // Don't clutter arbitrary directories when editing a single standalone .msk
        const metaPath = path.join(rootDir, PROJECT_META_FILE);
        const current = this.readOrInitProjectMeta(rootDir, updatedAt, updatedAt);
        current.updatedAt = updatedAt;
        try {
            atomicWriteUtf8(metaPath, JSON.stringify(current, null, 2));
        } catch {
            // non-fatal
        }
    }

    private recordRecentProject(entry: RecentProjectEntry): void {
        const normKey = path.resolve(entry.path).toLowerCase();
        const existing = this.listRecentProjects().filter(
            item => path.resolve(item.path).toLowerCase() !== normKey,
        );
        existing.unshift(entry);
        this.saveRecentProjects(existing.slice(0, MAX_RECENT_PROJECTS));
    }

    private saveRecentProjects(entries: RecentProjectEntry[]): void {
        const recentPath = path.join(this.userDataDir, RECENT_PROJECTS_FILE);
        atomicWriteUtf8(recentPath, JSON.stringify(entries, null, 2) + "\n");
    }

    private pruneOldSnapshots(snapshotsDir: string): void {
        const all = this.listSnapshots(path.dirname(path.dirname(snapshotsDir)));
        if (all.length <= MAX_SNAPSHOTS) return;
        const stale = all.slice(MAX_SNAPSHOTS);
        for (const snap of stale) {
            fs.rmSync(path.join(snapshotsDir, `${snap.id}.msk`), { force: true });
            fs.rmSync(path.join(snapshotsDir, `${snap.id}.meta.json`), { force: true });
            fs.rmSync(path.join(snapshotsDir, `${snap.id}.json`), { force: true });
        }
    }

    private keyForPath(filePath: string): string {
        const resolved = path.resolve(filePath);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    }

    private recordSelfWrite(filePath: string, content: string): void {
        this.lastWrittenHash.set(this.keyForPath(filePath), {
            hash: sha256Text(content),
            writtenAt: Date.now(),
        });
    }

    private isSelfWriteEcho(filePath: string): boolean {
        const rec = this.lastWrittenHash.get(this.keyForPath(filePath));
        if (!rec) return false;
        const withinWindow = Date.now() - rec.writtenAt <= ECHO_SUPPRESS_WINDOW_MS;
        if (!fs.existsSync(filePath)) {
            return withinWindow && rec.hash === "__deleted__";
        }
        try {
            const currentHash = sha256Text(fs.readFileSync(filePath, "utf8"));
            if (currentHash === rec.hash) {
                return true;
            }
            return false;
        } catch {
            return withinWindow;
        }
    }

    private startWatching(): void {
        if (!this.activeRootDir || !this.activeMskPath) return;

        const rootDir = this.activeRootDir;
        const mskName = path.basename(this.activeMskPath);

        const safeWatch = (targetDir: string, handler: (filename: string | null) => void) => {
            if (!fs.existsSync(targetDir)) return;
            try {
                const watcher = fs.watch(targetDir, { persistent: false }, (_eventType, filename) => {
                    handler(filename ? filename.toString() : null);
                });
                watcher.on("error", () => {
                    // ignore transient watcher errors on Windows directory renames
                });
                this.watchers.push(watcher);
            } catch {
                // ignore unsupported fs.watch environments
            }
        };

        // Watch root for active .msk file changes
        safeWatch(rootDir, filename => {
            if (!filename) {
                this.queueWatchCheck("msk");
                return;
            }
            const normName = process.platform === "win32" ? filename.toLowerCase() : filename;
            const targetName = process.platform === "win32" ? mskName.toLowerCase() : mskName;
            if (normName === targetName) {
                this.queueWatchCheck("msk");
            }
        });

        // Watch locales/
        safeWatch(path.join(rootDir, LOCALES_DIR), filename => {
            if (!filename || filename.endsWith(".i18n.json")) {
                this.queueWatchCheck("locales");
            }
        });

        // Watch voices/
        safeWatch(path.join(rootDir, VOICES_DIR), filename => {
            if (!filename || filename.toLowerCase() === "manifest.json") {
                this.queueWatchCheck("voice-manifest");
            }
        });
    }

    private queueWatchCheck(kind: "msk" | "locales" | "voice-manifest"): void {
        this.pendingChangeKinds.add(kind);
        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(() => {
            this.watchDebounceTimer = null;
            this.flushWatchChecks();
        }, this.debounceMs);
    }

    private flushWatchChecks(): void {
        if (!this.activeRootDir || !this.activeMskPath || !this.externalListener) {
            this.pendingChangeKinds.clear();
            return;
        }

        const kinds = Array.from(this.pendingChangeKinds);
        this.pendingChangeKinds.clear();

        let hasExternalChange = false;
        const confirmedKinds = new Set<"msk" | "locales" | "voice-manifest">();

        for (const kind of kinds) {
            if (kind === "msk") {
                if (!this.isSelfWriteEcho(this.activeMskPath)) {
                    hasExternalChange = true;
                    confirmedKinds.add("msk");
                }
            } else if (kind === "locales") {
                const localesDir = path.join(this.activeRootDir, LOCALES_DIR);
                if (fs.existsSync(localesDir)) {
                    for (const file of fs.readdirSync(localesDir)) {
                        if (!file.endsWith(".i18n.json")) continue;
                        if (!this.isSelfWriteEcho(path.join(localesDir, file))) {
                            hasExternalChange = true;
                            confirmedKinds.add("locales");
                            break;
                        }
                    }
                }
            } else if (kind === "voice-manifest") {
                const manifestPath = path.join(this.activeRootDir, VOICE_MANIFEST_REL);
                if (!this.isSelfWriteEcho(manifestPath)) {
                    hasExternalChange = true;
                    confirmedKinds.add("voice-manifest");
                }
            }
        }

        if (!hasExternalChange) return;

        try {
            const data = this.readProjectData(this.activeRootDir, this.activeMskPath, this.activeIsSingleFile);
            // Refresh recorded hashes to the newly observed disk content so consecutive polls don't double-fire.
            this.recordSelfWrite(this.activeMskPath, data.script);

            const emittedKind: WorkspaceExternalChangeEvent["kind"] =
                confirmedKinds.size > 1 ? "all" : Array.from(confirmedKinds)[0] ?? "msk";

            this.externalListener({
                rootDir: data.rootDir,
                mskFilePath: data.mskFilePath,
                kind: emittedKind,
                script: data.script,
                locales: data.locales,
                voiceManifest: data.voiceManifest,
                localVoiceFiles: data.localVoiceFiles,
                snapshots: data.snapshots,
                changedAt: Date.now(),
            });
        } catch {
            // File might be mid-write by external editor; next fs event will deliver complete content.
        }
    }

    private stopWatching(): void {
        if (this.watchDebounceTimer) {
            clearTimeout(this.watchDebounceTimer);
            this.watchDebounceTimer = null;
        }
        this.pendingChangeKinds.clear();
        for (const watcher of this.watchers) {
            try {
                watcher.close();
            } catch {
                // ignore
            }
        }
        this.watchers = [];
    }
}
