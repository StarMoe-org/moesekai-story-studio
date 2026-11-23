#!/usr/bin/env bun
/**
 * Creates or updates a CNB Release (`https://api.cnb.cool/<repo>/-/releases`) and uploads all
 * release installer assets + `SHA256SUMS.txt` using CNB's 3-step OpenAPI asset upload flow:
 *   1. `POST /{repo}/-/releases/{release_id}/asset-upload-url` (returns `{ upload_url, verify_url }`)
 *   2. `PUT <upload_url>` (raw bytes, no Bearer token leaked to presigned storage URL)
 *   3. `POST <verify_url>` (confirms attachment on the CNB Release)
 *
 * Gracefully warns and exits 0 when `CNB_TOKEN` is unset (unless `--require-token` is passed).
 *
 * Usage:
 *   bun scripts/sync-cnb-release.ts \
 *     --repo StarMoe-org/moesekai-story-studio \
 *     --tag v0.1.0 \
 *     --name "MoeSekai Story Studio v0.1.0" \
 *     --notes-file release-notes.md \
 *     --assets-dir release-assets
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";

export const DEFAULT_CNB_API_BASE = "https://api.cnb.cool";
export const DEFAULT_CNB_REPO = "StarMoe-org/moesekai-story-studio";
export const CNB_ACCEPT_HEADER = "application/vnd.cnb.api+json";

export interface CnbReleasePayloadInput {
    tag: string;
    name?: string;
    body?: string;
    prerelease?: boolean;
    targetCommitish?: string;
}

export interface CnbPostReleasePayload {
    tag_name: string;
    name: string;
    body: string;
    draft: false;
    prerelease: boolean;
    make_latest: "true" | "false";
    target_commitish?: string;
}

export interface CnbPatchReleasePayload {
    name: string;
    body: string;
    draft: false;
    prerelease: boolean;
    make_latest: "true" | "false";
}

export interface CnbAssetUploadUrlResponse {
    upload_url: string;
    verify_url: string;
    expires_in_sec?: number;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SyncCnbReleaseOptions {
    repo: string;
    tag: string;
    name?: string;
    body?: string;
    prerelease?: boolean;
    targetCommitish?: string;
    files?: string[];
    token?: string | null;
    requireToken?: boolean;
    apiBase?: string;
    dryRun?: boolean;
    fetchImpl?: FetchLike;
    logger?: Pick<Console, "log" | "warn">;
}

export interface SyncCnbReleaseResult {
    skipped: boolean;
    reason?: string;
    action?: "created" | "updated" | "dry-run";
    releaseId?: string;
    tag: string;
    uploadedAssets: string[];
}

export function isPrereleaseTag(tag: string): boolean {
    return /^v?\d+\.\d+\.\d+-/.test(tag.trim());
}

export function buildCnbPostReleasePayload(input: CnbReleasePayloadInput): CnbPostReleasePayload {
    const tag = input.tag.trim();
    const prerelease = input.prerelease ?? isPrereleaseTag(tag);
    return {
        tag_name: tag,
        name: input.name?.trim() || `MoeSekai Story Studio ${tag}`,
        body: input.body ?? "",
        draft: false,
        prerelease,
        make_latest: prerelease ? "false" : "true",
        ...(input.targetCommitish ? { target_commitish: input.targetCommitish } : {}),
    };
}

export function buildCnbPatchReleasePayload(input: CnbReleasePayloadInput): CnbPatchReleasePayload {
    const post = buildCnbPostReleasePayload(input);
    return {
        name: post.name,
        body: post.body,
        draft: post.draft,
        prerelease: post.prerelease,
        make_latest: post.make_latest,
    };
}

export function resolveCnbVerifyUrl(verifyUrl: string, apiBase: string = DEFAULT_CNB_API_BASE): string {
    const trimmed = verifyUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
    return new URL(trimmed, base).toString();
}

export function collectAssetFiles(assetsDir?: string, explicitFiles: readonly string[] = []): string[] {
    const files: string[] = [];
    const seenNames = new Set<string>();

    const addFile = (filePath: string) => {
        const abs = resolve(filePath);
        if (!existsSync(abs) || !statSync(abs).isFile()) {
            throw new Error(`Release asset file does not exist: ${filePath}`);
        }
        const name = basename(abs);
        if (seenNames.has(name)) {
            throw new Error(`Duplicate release asset filename: ${name}`);
        }
        seenNames.add(name);
        files.push(abs);
    };

    if (assetsDir) {
        const absDir = resolve(assetsDir);
        if (existsSync(absDir) && statSync(absDir).isDirectory()) {
            const entries = readdirSync(absDir).sort();
            for (const entry of entries) {
                const candidate = join(absDir, entry);
                if (statSync(candidate).isFile()) {
                    addFile(candidate);
                }
            }
        }
    }

    for (const filePath of explicitFiles) {
        addFile(filePath);
    }

    return files;
}

async function readErrorBody(res: Response): Promise<string> {
    try {
        const text = await res.text();
        return text.slice(0, 400);
    } catch {
        return "";
    }
}

export async function syncCnbRelease(options: SyncCnbReleaseOptions): Promise<SyncCnbReleaseResult> {
    const logger = options.logger ?? console;
    const fetchImpl = options.fetchImpl ?? fetch;
    const apiBase = (options.apiBase ?? DEFAULT_CNB_API_BASE).replace(/\/+$/, "");
    const repo = options.repo.trim().replace(/^\/+|\/+$/g, "");
    const tag = options.tag.trim();
    const files = options.files ?? [];
    const token = options.token?.trim() ?? "";

    if (!tag) {
        throw new Error("syncCnbRelease: tag is required");
    }

    if (options.dryRun) {
        const payload = buildCnbPostReleasePayload(options);
        logger.log(`[dry-run] Would sync CNB Release ${repo}@${tag} (${payload.name}) with ${files.length} asset(s)`);
        return {
            skipped: false,
            action: "dry-run",
            tag,
            uploadedAssets: files.map(f => basename(f)),
        };
    }

    if (!token) {
        const msg = "CNB_TOKEN is not configured; skipping CNB Release mirror (GitHub Release unaffected).";
        if (options.requireToken) {
            throw new Error(msg);
        }
        logger.warn(`WARN: ${msg}`);
        return { skipped: true, reason: "missing_token", tag, uploadedAssets: [] };
    }

    const authHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: CNB_ACCEPT_HEADER,
    };

    // 1. Check whether a CNB release already exists for this tag.
    const tagUrl = `${apiBase}/${repo}/-/releases/tags/${encodeURIComponent(tag)}`;
    const existingRes = await fetchImpl(tagUrl, {
        method: "GET",
        headers: authHeaders,
    });

    let releaseId: string;
    let action: "created" | "updated";

    if (existingRes.status === 200) {
        const existing = await existingRes.json() as { id?: string | number };
        if (!existing.id) {
            throw new Error(`CNB existing release for ${tag} did not return an id`);
        }
        releaseId = String(existing.id);
        const patchPayload = buildCnbPatchReleasePayload(options);
        const patchRes = await fetchImpl(`${apiBase}/${repo}/-/releases/${encodeURIComponent(releaseId)}`, {
            method: "PATCH",
            headers: {
                ...authHeaders,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(patchPayload),
        });
        if (!patchRes.ok) {
            throw new Error(`CNB PATCH release ${releaseId} failed (HTTP ${patchRes.status}): ${await readErrorBody(patchRes)}`);
        }
        action = "updated";
        logger.log(`Updated existing CNB Release ${tag} (id: ${releaseId})`);
    } else if (existingRes.status === 404) {
        const postPayload = buildCnbPostReleasePayload(options);
        const createRes = await fetchImpl(`${apiBase}/${repo}/-/releases`, {
            method: "POST",
            headers: {
                ...authHeaders,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(postPayload),
        });
        if (!createRes.ok) {
            throw new Error(`CNB POST release ${tag} failed (HTTP ${createRes.status}): ${await readErrorBody(createRes)}`);
        }
        const created = await createRes.json() as { id?: string | number };
        if (!created.id) {
            throw new Error(`CNB create release for ${tag} did not return an id`);
        }
        releaseId = String(created.id);
        action = "created";
        logger.log(`Created CNB Release ${tag} (id: ${releaseId})`);
    } else {
        throw new Error(`CNB GET release ${tag} failed (HTTP ${existingRes.status}): ${await readErrorBody(existingRes)}`);
    }

    // 2. Upload every release asset via CNB's 3-step upload-url -> PUT -> confirm flow.
    const uploadedAssets: string[] = [];
    for (const filePath of files) {
        const assetName = basename(filePath);
        const bytes = readFileSync(filePath);

        const uploadUrlRes = await fetchImpl(
            `${apiBase}/${repo}/-/releases/${encodeURIComponent(releaseId)}/asset-upload-url`,
            {
                method: "POST",
                headers: {
                    ...authHeaders,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    asset_name: assetName,
                    size: bytes.byteLength,
                    overwrite: true,
                    ttl: 0,
                }),
            },
        );
        if (!uploadUrlRes.ok) {
            throw new Error(
                `CNB asset-upload-url failed for ${assetName} (HTTP ${uploadUrlRes.status}): ${await readErrorBody(uploadUrlRes)}`,
            );
        }
        const uploadMeta = await uploadUrlRes.json() as Partial<CnbAssetUploadUrlResponse>;
        if (!uploadMeta.upload_url || !uploadMeta.verify_url) {
            throw new Error(`CNB asset-upload-url response missing upload_url or verify_url for ${assetName}`);
        }

        // Presigned COS/S3 URL: never attach CNB Authorization header here.
        const putRes = await fetchImpl(uploadMeta.upload_url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/octet-stream",
            },
            body: bytes,
        });
        if (!putRes.ok) {
            throw new Error(`CNB presigned PUT failed for ${assetName} (HTTP ${putRes.status}): ${await readErrorBody(putRes)}`);
        }

        const verifyUrl = resolveCnbVerifyUrl(uploadMeta.verify_url, apiBase);
        const confirmRes = await fetchImpl(verifyUrl, {
            method: "POST",
            headers: authHeaders,
        });
        if (!confirmRes.ok) {
            throw new Error(`CNB asset verify failed for ${assetName} (HTTP ${confirmRes.status}): ${await readErrorBody(confirmRes)}`);
        }

        uploadedAssets.push(assetName);
        logger.log(`  Uploaded CNB release asset: ${assetName} (${bytes.byteLength} bytes)`);
    }

    return {
        skipped: false,
        action,
        releaseId,
        tag,
        uploadedAssets,
    };
}

function parseCliArgs(argv: string[]) {
    let repo = DEFAULT_CNB_REPO;
    let tag = "";
    let name: string | undefined;
    let body = "";
    let notesFile: string | undefined;
    let prerelease: boolean | undefined;
    let targetCommitish: string | undefined;
    let assetsDir: string | undefined;
    const explicitFiles: string[] = [];
    let apiBase = DEFAULT_CNB_API_BASE;
    let requireToken = false;
    let dryRun = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--repo" && argv[i + 1]) repo = argv[++i];
        else if (arg === "--tag" && argv[i + 1]) tag = argv[++i];
        else if (arg === "--name" && argv[i + 1]) name = argv[++i];
        else if (arg === "--body" && argv[i + 1]) body = argv[++i];
        else if (arg === "--notes-file" && argv[i + 1]) notesFile = argv[++i];
        else if (arg === "--target" && argv[i + 1]) targetCommitish = argv[++i];
        else if (arg === "--assets-dir" && argv[i + 1]) assetsDir = argv[++i];
        else if (arg === "--file" && argv[i + 1]) explicitFiles.push(argv[++i]);
        else if (arg === "--api-base" && argv[i + 1]) apiBase = argv[++i];
        else if (arg === "--prerelease") prerelease = true;
        else if (arg === "--require-token") requireToken = true;
        else if (arg === "--dry-run") dryRun = true;
        else if (arg === "-h" || arg === "--help") {
            console.log(
                "Usage: bun scripts/sync-cnb-release.ts --tag vX.Y.Z [--repo StarMoe-org/moesekai-story-studio] [--name \"...\"] [--notes-file path] [--assets-dir dir] [--file path] [--dry-run]",
            );
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (notesFile) {
        body = readFileSync(resolve(notesFile), "utf8");
    }
    const files = collectAssetFiles(assetsDir, explicitFiles);

    return {
        repo,
        tag,
        name,
        body,
        prerelease,
        targetCommitish,
        files,
        apiBase,
        requireToken,
        dryRun,
    };
}

if (import.meta.main) {
    try {
        const opts = parseCliArgs(process.argv.slice(2));
        await syncCnbRelease({
            ...opts,
            token: process.env.CNB_TOKEN ?? "",
        });
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
