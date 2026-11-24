/**
 * The files of a story workspace, behind one small interface so the agent's tools run the same
 * against a folder on disk (`createNodeWorkspaceFiles` in `./node`) and against a browser draft
 * held in memory (`createMemoryWorkspaceFiles`).
 *
 * Paths are `/`-separated and relative to the workspace root (`story.msk`, `locales/ja-JP.i18n.json`).
 */
export interface StoryWorkspaceFiles {
    /** Where the workspace lives, for messages: a folder path or a draft title. */
    readonly label: string;
    /** The file's text, or null when there is no such file. */
    readText(path: string): Promise<string | null>;
    /** Writes the file, creating the folders it sits in. */
    writeText(path: string, text: string): Promise<void>;
    /** The files directly inside a folder; empty when the folder does not exist. */
    list(dir: string): Promise<StoryWorkspaceEntry[]>;
}

export interface StoryWorkspaceEntry {
    name: string;
    modifiedAt: Date;
}

/**
 * The canonical form of a workspace-relative path, or an error when it is absolute or leaves
 * the workspace. `""` and `"."` name the root.
 */
export function normalizeWorkspacePath(path: string): string {
    if (path.includes("\0")) {
        throw new Error(`Invalid relative workspace path: "${path}"`);
    }
    const slashed = path.replace(/\\/g, "/").trim();
    if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
        throw new Error(`Path must be relative to the workspace: "${path}"`);
    }
    const parts: string[] = [];
    for (const part of slashed.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            if (parts.length === 0) throw new Error(`Path escapes workspace root: "${path}"`);
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join("/");
}

/** A workspace kept in memory, e.g. a browser draft the agent edits. */
export interface MemoryWorkspaceFiles extends StoryWorkspaceFiles {
    /** Every file as `path -> text`. */
    entries(): ReadonlyMap<string, string>;
}

export function createMemoryWorkspaceFiles(
    label: string,
    initial: Record<string, string> = {},
): MemoryWorkspaceFiles {
    const files = new Map<string, { text: string; modifiedAt: Date }>();
    for (const [path, text] of Object.entries(initial)) {
        files.set(normalizeWorkspacePath(path), { text, modifiedAt: new Date() });
    }
    return {
        label,
        async readText(path) {
            return files.get(normalizeWorkspacePath(path))?.text ?? null;
        },
        async writeText(path, text) {
            files.set(normalizeWorkspacePath(path), { text, modifiedAt: new Date() });
        },
        async list(dir) {
            const root = normalizeWorkspacePath(dir);
            const prefix = root ? `${root}/` : "";
            const found: StoryWorkspaceEntry[] = [];
            for (const [path, file] of files) {
                if (!path.startsWith(prefix)) continue;
                const name = path.slice(prefix.length);
                if (!name.includes("/")) found.push({ name, modifiedAt: file.modifiedAt });
            }
            return found;
        },
        entries() {
            return new Map([...files].map(([path, file]) => [path, file.text]));
        },
    };
}

/** UTF-8 byte length of `text`. */
export function utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

/** Hex SHA-256 of `text` (Web Crypto: available in browsers and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
