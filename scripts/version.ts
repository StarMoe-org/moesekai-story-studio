#!/usr/bin/env bun
/**
 * Lockstep versioning CLI for MoeSekai Story Studio (`StarMoe-org/moesekai-story-studio`).
 *
 * Keeps a single strict semver (`X.Y.Z`) synchronized across all 5 manifests:
 * - `package.json`
 * - `packages/story-core/package.json`
 * - `packages/story-editor/package.json` (plus `peerDependencies["@moesekai/story-core"] = "^X.Y.Z"`)
 * - `packages/story-agent/package.json`
 * - `apps/desktop/package.json`
 *
 * Commands:
 *   bun scripts/version.ts show [--json | --shell]
 *   bun scripts/version.ts check [--tag vX.Y.Z]
 *   bun scripts/version.ts bump <patch|minor|major|X.Y.Z> [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const LOCKSTEP_MANIFEST_PATHS = [
    "package.json",
    "packages/story-core/package.json",
    "packages/story-editor/package.json",
    "packages/story-agent/package.json",
    "apps/desktop/package.json",
] as const;

export const STORY_EDITOR_MANIFEST_PATH = "packages/story-editor/package.json" as const;

export const STRICT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
}

export interface LockstepCheckResult {
    ok: boolean;
    version: string | null;
    versions: Record<string, string | null>;
    storyEditorPeerRange: string | null;
    expectedPeerRange: string | null;
    errors: string[];
}

export interface VersionShowInfo {
    version: string;
    tag: string;
    latestGitTag: string | null;
    commitsSinceTag: number;
    shortSha: string;
    buildDate: string;
}

export interface BumpResult {
    previousVersion: string;
    nextVersion: string;
    tag: string;
    dryRun: boolean;
    updatedFiles: string[];
}

export function getDefaultRepoRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function parseStrictSemver(raw: string | null | undefined): ParsedSemver | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    const match = STRICT_SEMVER_RE.exec(trimmed);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

export function compareStrictSemver(a: string, b: string): number {
    const pa = parseStrictSemver(a);
    const pb = parseStrictSemver(b);
    if (!pa || !pb) {
        throw new Error(`Invalid strict semver comparison: '${a}' vs '${b}'`);
    }
    return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch);
}

export function computeNextVersion(current: string, bumpSpec: string): string {
    const parsed = parseStrictSemver(current);
    if (!parsed) {
        throw new Error(`Current version '${current}' is not strict semver (X.Y.Z)`);
    }
    const spec = bumpSpec.trim();
    if (spec === "patch") {
        return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    }
    if (spec === "minor") {
        return `${parsed.major}.${parsed.minor + 1}.0`;
    }
    if (spec === "major") {
        return `${parsed.major + 1}.0.0`;
    }
    const normalized = spec.startsWith("v") ? spec.slice(1) : spec;
    if (!parseStrictSemver(normalized)) {
        throw new Error(`Invalid bump target '${bumpSpec}'. Expected patch, minor, major, or strict X.Y.Z`);
    }
    return normalized;
}

function readJsonObject(filePath: string): Record<string, unknown> {
    const text = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${filePath} is not a JSON object`);
    }
    return parsed as Record<string, unknown>;
}

export function checkLockstepVersions(
    repoRoot: string = getDefaultRepoRoot(),
    options: { expectedTag?: string | null } = {},
): LockstepCheckResult {
    const versions: Record<string, string | null> = {};
    const errors: string[] = [];
    let canonicalVersion: string | null = null;
    let storyEditorPeerRange: string | null = null;

    for (const relPath of LOCKSTEP_MANIFEST_PATHS) {
        const fullPath = resolve(repoRoot, relPath);
        let pkg: Record<string, unknown>;
        try {
            pkg = readJsonObject(fullPath);
        } catch (err) {
            versions[relPath] = null;
            errors.push(`${relPath}: failed to read/parse (${err instanceof Error ? err.message : String(err)})`);
            continue;
        }

        const rawVersion = typeof pkg.version === "string" ? pkg.version.trim() : null;
        versions[relPath] = rawVersion;
        if (!rawVersion) {
            errors.push(`${relPath}: missing "version" field`);
            continue;
        }
        if (!parseStrictSemver(rawVersion)) {
            errors.push(`${relPath}: version "${rawVersion}" is not strict semver X.Y.Z`);
            continue;
        }
        if (canonicalVersion === null) {
            canonicalVersion = rawVersion;
        } else if (rawVersion !== canonicalVersion) {
            errors.push(`${relPath}: version "${rawVersion}" diverges from root "${canonicalVersion}"`);
        }

        if (relPath === STORY_EDITOR_MANIFEST_PATH) {
            const peers = pkg.peerDependencies as Record<string, unknown> | undefined;
            storyEditorPeerRange = typeof peers?.["@moesekai/story-core"] === "string"
                ? peers["@moesekai/story-core"].trim()
                : null;
        }
    }

    const expectedPeerRange = canonicalVersion ? `^${canonicalVersion}` : null;
    if (expectedPeerRange && storyEditorPeerRange !== expectedPeerRange) {
        errors.push(
            `${STORY_EDITOR_MANIFEST_PATH}: peerDependencies["@moesekai/story-core"] is "${storyEditorPeerRange ?? "(missing)"}", expected "${expectedPeerRange}"`,
        );
    }

    if (options.expectedTag) {
        const cleanTag = options.expectedTag.trim();
        const tagVersion = cleanTag.startsWith("v") ? cleanTag.slice(1) : cleanTag;
        if (!cleanTag.startsWith("v") || !parseStrictSemver(tagVersion)) {
            errors.push(`Tag "${cleanTag}" is not strict vX.Y.Z`);
        } else if (canonicalVersion && tagVersion !== canonicalVersion) {
            errors.push(`Tag "${cleanTag}" does not match lockstep package version "${canonicalVersion}"`);
        }
    }

    return {
        ok: errors.length === 0 && canonicalVersion !== null,
        version: canonicalVersion,
        versions,
        storyEditorPeerRange,
        expectedPeerRange,
        errors,
    };
}

function runGit(repoRoot: string, args: string[]): string | null {
    const proc = Bun.spawnSync(["git", ...args], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) return null;
    const text = proc.stdout.toString().trim();
    return text.length > 0 ? text : null;
}

export function getVersionInfo(repoRoot: string = getDefaultRepoRoot()): VersionShowInfo {
    const check = checkLockstepVersions(repoRoot);
    const version = check.version ?? "0.0.0";
    const shortSha = runGit(repoRoot, ["rev-parse", "--short=7", "HEAD"]) ?? "uncommitted";
    const tagsRaw = runGit(repoRoot, ["tag", "--merged", "HEAD", "--list", "v*"]);
    const strictTags = (tagsRaw ? tagsRaw.split(/\r?\n/) : [])
        .map(line => line.trim())
        .filter(tag => tag.startsWith("v") && parseStrictSemver(tag.slice(1)) !== null)
        .sort((a, b) => compareStrictSemver(a.slice(1), b.slice(1)));
    const latestGitTag = strictTags.length > 0 ? strictTags[strictTags.length - 1] : null;

    let commitsSinceTag = 0;
    if (latestGitTag) {
        const countRaw = runGit(repoRoot, ["rev-list", "--count", `${latestGitTag}..HEAD`]);
        commitsSinceTag = countRaw ? Number.parseInt(countRaw, 10) || 0 : 0;
    } else {
        const totalRaw = runGit(repoRoot, ["rev-list", "--count", "HEAD"]);
        commitsSinceTag = totalRaw ? Number.parseInt(totalRaw, 10) || 0 : 0;
    }

    const buildDate = new Date().toISOString().slice(0, 10);
    return {
        version,
        tag: `v${version}`,
        latestGitTag,
        commitsSinceTag,
        shortSha,
        buildDate,
    };
}

export function bumpLockstepVersions(
    repoRoot: string,
    bumpSpec: string,
    options: { dryRun?: boolean } = {},
): BumpResult {
    const check = checkLockstepVersions(repoRoot);
    if (!check.ok || !check.version) {
        throw new Error(`Cannot bump: lockstep check failed:\n- ${check.errors.join("\n- ")}`);
    }

    const previousVersion = check.version;
    const nextVersion = computeNextVersion(previousVersion, bumpSpec);
    const nextPeerRange = `^${nextVersion}`;
    const dryRun = Boolean(options.dryRun);
    const updatedFiles: string[] = [];

    for (const relPath of LOCKSTEP_MANIFEST_PATHS) {
        const fullPath = resolve(repoRoot, relPath);
        const pkg = readJsonObject(fullPath);
        pkg.version = nextVersion;

        if (relPath === STORY_EDITOR_MANIFEST_PATH) {
            const peers = (pkg.peerDependencies && typeof pkg.peerDependencies === "object" && !Array.isArray(pkg.peerDependencies))
                ? { ...(pkg.peerDependencies as Record<string, unknown>) }
                : {};
            peers["@moesekai/story-core"] = nextPeerRange;
            pkg.peerDependencies = peers;
        }

        if (!dryRun) {
            writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
        }
        updatedFiles.push(relPath);
    }

    return {
        previousVersion,
        nextVersion,
        tag: `v${nextVersion}`,
        dryRun,
        updatedFiles,
    };
}

function printUsage(): void {
    console.log(
        [
            "Usage:",
            "  bun scripts/version.ts show [--json | --shell]",
            "  bun scripts/version.ts check [--tag vX.Y.Z]",
            "  bun scripts/version.ts bump <patch|minor|major|X.Y.Z> [--dry-run]",
        ].join("\n"),
    );
}

function main(argv: string[]): void {
    const repoRoot = getDefaultRepoRoot();
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === "-h" || cmd === "--help") {
        printUsage();
        return;
    }

    if (cmd === "show") {
        const info = getVersionInfo(repoRoot);
        if (rest.includes("--json")) {
            console.log(JSON.stringify(info, null, 2));
            return;
        }
        if (rest.includes("--shell")) {
            console.log(`version=${info.version}`);
            console.log(`tag=${info.tag}`);
            console.log(`latest_git_tag=${info.latestGitTag ?? ""}`);
            console.log(`commits=${info.commitsSinceTag}`);
            console.log(`sha=${info.shortSha}`);
            console.log(`date=${info.buildDate}`);
            return;
        }
        console.log(
            `MoeSekai Story Studio v${info.version} (git tag: ${info.latestGitTag ?? "none"}, +${info.commitsSinceTag} commits, sha: ${info.shortSha}, date: ${info.buildDate})`,
        );
        return;
    }

    if (cmd === "check") {
        const tagIdx = rest.indexOf("--tag");
        const expectedTag = tagIdx !== -1 ? rest[tagIdx + 1] : null;
        const result = checkLockstepVersions(repoRoot, { expectedTag });
        if (!result.ok) {
            console.error("Lockstep version check FAILED:");
            for (const err of result.errors) {
                console.error(`  - ${err}`);
            }
            process.exit(1);
        }
        console.log(
            `Lockstep version OK: ${result.version} (${LOCKSTEP_MANIFEST_PATHS.length} manifests, @moesekai/story-core peer ${result.storyEditorPeerRange})`,
        );
        return;
    }

    if (cmd === "bump") {
        const dryRun = rest.includes("--dry-run");
        const target = rest.find(arg => !arg.startsWith("-"));
        if (!target) {
            console.error("Missing bump target (patch | minor | major | X.Y.Z)");
            printUsage();
            process.exit(1);
        }
        const res = bumpLockstepVersions(repoRoot, target, { dryRun });
        const prefix = res.dryRun ? "[dry-run] Would bump" : "Bumped";
        console.log(`${prefix} ${res.previousVersion} -> ${res.nextVersion} (${res.tag}):`);
        for (const file of res.updatedFiles) {
            console.log(`  - ${file}`);
        }
        return;
    }

    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(1);
}

if (import.meta.main) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
