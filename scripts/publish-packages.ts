#!/usr/bin/env bun
/**
 * Topological npm publish orchestrator for `@moesekai/*` public packages:
 *   1. `@moesekai/story-core`
 *   2. `@moesekai/story-editor`
 *   3. `@moesekai/story-agent`
 *
 * Guarantees:
 * - Verifies lockstep versions (`scripts/version.ts check`) before publishing.
 * - Builds packages in topological order unless `--skip-build` is passed.
 * - Packs every tarball via `bun pm pack` and audits `package/package.json` for ZERO `workspace:*` leaks,
 *   expected `version`, `dist/`, and `LICENSE`.
 * - Checks npmjs.org registry before publishing each package for idempotent retries (skips already-published versions).
 *
 * Usage:
 *   bun scripts/publish-packages.ts [--dry-run] [--tag latest] [--registry https://registry.npmjs.org] [--skip-build]
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { checkLockstepVersions, getDefaultRepoRoot } from "./version";

export const PUBLISH_PACKAGES = [
    { dir: "packages/story-core", name: "@moesekai/story-core", buildScript: "build:core" },
    { dir: "packages/story-editor", name: "@moesekai/story-editor", buildScript: "build:editor" },
    { dir: "packages/story-agent", name: "@moesekai/story-agent", buildScript: "build:agent" },
] as const;

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

export interface TarballVerificationResult {
    packageName: string;
    packageDir: string;
    tarballName: string;
    version: string;
    fileCount: number;
    hasDist: boolean;
    hasLicense: boolean;
    workspaceLeaks: string[];
}

export function findWorkspaceSpecifiers(pkgJson: Record<string, unknown>, rawJsonText?: string): string[] {
    const leaks: string[] = [];
    const sections = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"] as const;
    for (const section of sections) {
        const block = pkgJson[section];
        if (!block || typeof block !== "object" || Array.isArray(block)) continue;
        for (const [dep, spec] of Object.entries(block as Record<string, unknown>)) {
            if (typeof spec === "string" && spec.trim().startsWith("workspace:")) {
                leaks.push(`${section}.${dep}=${spec}`);
            }
        }
    }
    if (leaks.length === 0 && rawJsonText && rawJsonText.includes("workspace:")) {
        leaks.push("raw-json-contains-workspace:");
    }
    return leaks;
}

export function verifyPackedTarball(
    repoRoot: string,
    packageDir: string,
    expectedVersion: string,
): TarballVerificationResult {
    const absPkgDir = resolve(repoRoot, packageDir);
    const tempDir = mkdtempSync(join(tmpdir(), "moesekai-pack-verify-"));
    try {
        const packProc = Bun.spawnSync(["bun", "pm", "pack", "--destination", tempDir], {
            cwd: absPkgDir,
            stdout: "pipe",
            stderr: "pipe",
        });
        if (packProc.exitCode !== 0) {
            throw new Error(
                `bun pm pack failed in ${packageDir}:\n${packProc.stderr.toString() || packProc.stdout.toString()}`,
            );
        }

        const tarballs = readdirSync(tempDir).filter(name => name.endsWith(".tgz"));
        if (tarballs.length !== 1) {
            throw new Error(`Expected 1 packed tarball in ${packageDir}, found ${tarballs.length}`);
        }
        const tarballName = tarballs[0];
        const tarballPath = join(tempDir, tarballName);

        const listProc = Bun.spawnSync(["tar", "-tf", tarballPath], {
            stdout: "pipe",
            stderr: "pipe",
        });
        if (listProc.exitCode !== 0) {
            throw new Error(`tar -tf failed for ${tarballName}: ${listProc.stderr.toString()}`);
        }
        const entries = listProc.stdout.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const hasDist = entries.some(entry => entry.startsWith("package/dist/"));
        const hasLicense = entries.some(entry => entry === "package/LICENSE");

        const manifestProc = Bun.spawnSync(["tar", "-xOf", tarballPath, "package/package.json"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        if (manifestProc.exitCode !== 0) {
            throw new Error(`Failed to extract package/package.json from ${tarballName}: ${manifestProc.stderr.toString()}`);
        }
        const rawManifest = manifestProc.stdout.toString();
        const parsed = JSON.parse(rawManifest) as Record<string, unknown>;
        const packageName = String(parsed.name ?? "");
        const version = String(parsed.version ?? "");
        const workspaceLeaks = findWorkspaceSpecifiers(parsed, rawManifest);

        if (version !== expectedVersion) {
            throw new Error(`${packageName}: packed version "${version}" !== expected "${expectedVersion}"`);
        }
        if (workspaceLeaks.length > 0) {
            throw new Error(`${packageName}: packed tarball leaked workspace specifiers: ${workspaceLeaks.join(", ")}`);
        }
        if (!hasDist) {
            throw new Error(`${packageName}: packed tarball is missing package/dist/ artifacts`);
        }
        if (!hasLicense) {
            throw new Error(`${packageName}: packed tarball is missing package/LICENSE`);
        }

        return {
            packageName,
            packageDir,
            tarballName,
            version,
            fileCount: entries.length,
            hasDist,
            hasLicense,
            workspaceLeaks,
        };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function isPackageVersionPublished(
    packageName: string,
    version: string,
    registryUrl: string = DEFAULT_NPM_REGISTRY,
    fetchImpl: FetchLike = fetch,
): Promise<boolean> {
    const cleanBase = registryUrl.replace(/\/+$/, "");
    // Direct version endpoint works on registry.npmjs.org and standard npm registries.
    const directUrl = `${cleanBase}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
    const directRes = await fetchImpl(directUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
    });
    if (directRes.status === 200) return true;
    if (directRes.status === 404) return false;

    // Fallback to packument check for registries that disallow scoped /<version> subpaths.
    const packumentUrl = `${cleanBase}/${encodeURIComponent(packageName)}`;
    const packRes = await fetchImpl(packumentUrl, {
        method: "GET",
        headers: { Accept: "application/vnd.npm.install-v1+json, application/json" },
    });
    if (packRes.status === 404) return false;
    if (!packRes.ok) {
        throw new Error(`Registry check failed for ${packageName}@${version}: HTTP ${packRes.status}`);
    }
    const packument = await packRes.json() as { versions?: Record<string, unknown> };
    return Boolean(packument.versions && Object.prototype.hasOwnProperty.call(packument.versions, version));
}

function hasNpmAuthConfigured(repoRoot: string, pkgDir: string): boolean {
    if (process.env.NPM_TOKEN?.trim() || process.env.NODE_AUTH_TOKEN?.trim() || process.env.NPM_CONFIG_TOKEN?.trim()) {
        return true;
    }
    for (const candidate of [join(pkgDir, ".npmrc"), join(repoRoot, ".npmrc")]) {
        if (!existsSync(candidate)) continue;
        const content = readFileSync(candidate, "utf8");
        if (/_authToken\s*=\s*\S+/.test(content)) return true;
    }
    return false;
}

function runOrThrow(cmd: string[], cwd: string): void {
    const proc = Bun.spawnSync(cmd, {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
    });
    if (proc.exitCode !== 0) {
        throw new Error(`Command failed (exit ${proc.exitCode}): ${cmd.join(" ")} (cwd: ${cwd})`);
    }
}

function parseCliArgs(argv: string[]) {
    let dryRun = false;
    let skipBuild = false;
    let tag = "latest";
    let registry = DEFAULT_NPM_REGISTRY;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--dry-run") {
            dryRun = true;
        } else if (arg === "--skip-build") {
            skipBuild = true;
        } else if (arg === "--tag" && argv[i + 1]) {
            tag = argv[++i];
        } else if (arg === "--registry" && argv[i + 1]) {
            registry = argv[++i];
        } else if (arg === "-h" || arg === "--help") {
            console.log(
                "Usage: bun scripts/publish-packages.ts [--dry-run] [--tag latest] [--registry https://registry.npmjs.org] [--skip-build]",
            );
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return { dryRun, skipBuild, tag, registry };
}

async function main(argv: string[]): Promise<void> {
    const repoRoot = getDefaultRepoRoot();
    const { dryRun, skipBuild, tag, registry } = parseCliArgs(argv);

    const versionCheck = checkLockstepVersions(repoRoot);
    if (!versionCheck.ok || !versionCheck.version) {
        throw new Error(`Lockstep version check failed:\n- ${versionCheck.errors.join("\n- ")}`);
    }
    const version = versionCheck.version;
    console.log(`Verified lockstep version: ${version} (registry: ${registry}, tag: ${tag}, dryRun: ${dryRun})`);

    if (!skipBuild) {
        for (const pkg of PUBLISH_PACKAGES) {
            console.log(`\n==> Building ${pkg.name} (${pkg.buildScript})...`);
            runOrThrow(["bun", "run", pkg.buildScript], repoRoot);
        }
    }

    for (const pkg of PUBLISH_PACKAGES) {
        const absDir = resolve(repoRoot, pkg.dir);
        const manifest = JSON.parse(readFileSync(join(absDir, "package.json"), "utf8")) as { name: string; version: string };
        console.log(`\n==> Verifying packed tarball for ${manifest.name}@${manifest.version}...`);
        const verified = verifyPackedTarball(repoRoot, pkg.dir, version);
        console.log(
            `    OK: ${verified.tarballName} (${verified.fileCount} files, dist: yes, LICENSE: yes, workspace:* leaks: 0)`,
        );

        let alreadyPublished = false;
        try {
            alreadyPublished = await isPackageVersionPublished(manifest.name, version, registry);
        } catch (err) {
            if (dryRun) {
                console.warn(`    WARN: registry lookup skipped in dry-run (${err instanceof Error ? err.message : String(err)})`);
            } else {
                throw err;
            }
        }

        if (alreadyPublished) {
            console.log(`    SKIP: ${manifest.name}@${version} is already published on ${registry}`);
            continue;
        }

        const publishCmd = [
            "bun",
            "publish",
            "--access",
            "public",
            "--tag",
            tag,
            "--registry",
            registry,
            ...(dryRun ? ["--dry-run"] : []),
        ];
        if (dryRun && !hasNpmAuthConfigured(repoRoot, absDir)) {
            console.log(
                `==> [dry-run] Ready to publish ${manifest.name}@${version} (no npm auth configured; would run: ${publishCmd.filter(a => a !== "--dry-run").join(" ")})`,
            );
            continue;
        }
        console.log(`==> ${dryRun ? "[dry-run] " : ""}Publishing ${manifest.name}@${version}...`);
        runOrThrow(publishCmd, absDir);
    }

    console.log(`\nAll ${PUBLISH_PACKAGES.length} @moesekai packages verified${dryRun ? " (dry-run complete)" : " and published"}!`);
}

if (import.meta.main) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
