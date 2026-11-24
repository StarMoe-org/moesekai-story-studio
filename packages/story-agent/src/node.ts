/**
 * Node.js implementations of the agent's platform interfaces: a workspace folder on disk, a disk
 * cache for official story data, and zlib's brotli decoder. Browser bundles never import this
 * module.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { normalizeWorkspacePath, type StoryWorkspaceFiles } from "./files";
import type { BrotliDecoder, OfficialStoryCache } from "./official-story";

/** The absolute path of `relPath` inside `workspaceDir`, or an error when it would leave it. */
export function resolveSafeWorkspacePath(workspaceDir: string, relPath: string): string {
    if (!workspaceDir.trim()) {
        throw new Error("workspaceDir must be a non-empty path");
    }
    const root = resolve(workspaceDir);
    const target = resolve(root, normalizeWorkspacePath(relPath));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: "${relPath}"`);
    }
    return target;
}

function isMissing(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export function createNodeWorkspaceFiles(workspaceDir: string): StoryWorkspaceFiles {
    const root = resolve(workspaceDir);
    const at = (path: string) => resolveSafeWorkspacePath(root, path);
    return {
        label: root,
        async readText(path) {
            try {
                return await readFile(at(path), "utf8");
            } catch (err) {
                if (isMissing(err)) return null;
                throw err;
            }
        },
        async writeText(path, text) {
            const file = at(path);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, text, "utf8");
        },
        async list(dir) {
            const folder = at(dir);
            let names: string[];
            try {
                names = await readdir(folder);
            } catch (err) {
                if (isMissing(err)) return [];
                throw err;
            }
            const entries = await Promise.all(names.map(async (name) => {
                const info = await stat(join(folder, name));
                return info.isFile() ? { name, modifiedAt: info.mtime } : null;
            }));
            return entries.filter((entry) => entry !== null);
        },
    };
}

export const DEFAULT_OFFICIAL_STORY_CACHE_DIR = join(tmpdir(), "moesekai-story-agent-cache");

/** An `OfficialStoryCache` of one file per key under `cacheDir`. */
export function createDiskOfficialStoryCache(cacheDir = DEFAULT_OFFICIAL_STORY_CACHE_DIR): OfficialStoryCache {
    const fileFor = (key: string) => {
        const namespace = key.slice(0, key.indexOf(":")).replace(/[^A-Za-z0-9_-]+/g, "_");
        const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
        return join(cacheDir, `${namespace}_${digest}.cache`);
    };
    return {
        async read(key, maxAgeMs) {
            try {
                const file = fileFor(key);
                if (maxAgeMs > 0 && Date.now() - (await stat(file)).mtimeMs > maxAgeMs) return null;
                return await readFile(file, "utf8");
            } catch {
                return null;
            }
        },
        async write(key, text) {
            try {
                await mkdir(cacheDir, { recursive: true });
                await writeFile(fileFor(key), text, "utf8");
            } catch {
                // A cache that cannot be written only costs a refetch.
            }
        },
    };
}

export const decodeBrotliWithZlib: BrotliDecoder = (compressed) => new Uint8Array(brotliDecompressSync(compressed));
