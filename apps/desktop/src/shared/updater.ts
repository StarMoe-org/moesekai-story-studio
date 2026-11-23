/**
 * Pure, cross-platform desktop release update checker (CNB primary + automatic GitHub fallback).
 * Zero Electron runtime imports so unit tests can exercise every code path directly under Bun.
 */

export type UpdateChannel = "auto" | "cnb" | "github";
export type UpdateSource = "cnb" | "github";

export const DEFAULT_UPDATE_REPO_SLUG = "StarMoe-org/moesekai-story-studio";
export const CNB_ORIGIN = "https://cnb.cool";
/**
 * Public anonymous JSON release endpoint on CNB (`https://cnb.cool/.../-/releases/latest`
 * with `Accept: application/json` returns HTTP 200 without auth; `api.cnb.cool` requires a Bearer token).
 */
export const CNB_API_ORIGIN = CNB_ORIGIN;
export const GITHUB_ORIGIN = "https://github.com";
export const GITHUB_API_ORIGIN = "https://api.github.com";

export interface DesktopReleaseAsset {
    name: string;
    downloadUrl: string;
    size?: number;
    contentType?: string;
}

export interface NormalizedRelease {
    version: string;
    tagName: string;
    name: string;
    body: string;
    publishedAt: string | null;
    htmlUrl: string;
    assets: DesktopReleaseAsset[];
    source: UpdateSource;
}

export interface DesktopUpdateCheckResult {
    status: "update-available" | "up-to-date" | "error";
    currentVersion: string;
    latestVersion: string | null;
    source: UpdateSource;
    fallbackUsed: boolean;
    releaseName: string;
    releaseNotes: string;
    publishedAt: string | null;
    releasePageUrl: string;
    alternateReleasePageUrl: string;
    downloadUrl: string | null;
    assetName: string | null;
    assetSize: number | null;
    checkedAt: number;
    errorMessage?: string;
}

export interface CheckDesktopUpdatesOptions {
    currentVersion: string;
    channel?: UpdateChannel;
    platform?: NodeJS.Platform;
    arch?: string;
    repoSlug?: string;
    cnbApiUrl?: string;
    githubApiUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

export function getCnbLatestApiUrl(repoSlug = DEFAULT_UPDATE_REPO_SLUG): string {
    return `${CNB_ORIGIN}/${repoSlug}/-/releases/latest`;
}

export const CNB_RELEASE_API_URL = getCnbLatestApiUrl();

export function getCnbReleasePageUrl(repoSlug = DEFAULT_UPDATE_REPO_SLUG, tag?: string): string {
    if (tag && tag.trim()) {
        return `${CNB_ORIGIN}/${repoSlug}/-/releases/tag/${encodeURIComponent(tag.trim())}`;
    }
    return `${CNB_ORIGIN}/${repoSlug}/-/releases/latest`;
}

export function getGithubLatestApiUrl(repoSlug = DEFAULT_UPDATE_REPO_SLUG): string {
    return `${GITHUB_API_ORIGIN}/repos/${repoSlug}/releases/latest`;
}

export function getGithubReleasePageUrl(repoSlug = DEFAULT_UPDATE_REPO_SLUG, tag?: string): string {
    if (tag && tag.trim()) {
        return `${GITHUB_ORIGIN}/${repoSlug}/releases/tag/${encodeURIComponent(tag.trim())}`;
    }
    return `${GITHUB_ORIGIN}/${repoSlug}/releases/latest`;
}

export function isSafeHttpsUrl(raw: unknown): raw is string {
    if (typeof raw !== "string") return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "https:" && Boolean(parsed.hostname);
    } catch {
        return false;
    }
}

export function normalizeVersion(raw: string): string {
    return raw.trim().replace(/^v/i, "");
}

interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
    prerelease: Array<number | string>;
}

function parseSemver(raw: string): ParsedSemver | null {
    const cleaned = normalizeVersion(raw).split("+")[0]?.trim() ?? "";
    if (!cleaned) return null;
    const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    const major = Number.parseInt(match[1], 10);
    const minor = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
    const patch = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
    const prerelease = match[4]
        ? match[4].split(".").map(part => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
        : [];
    return { major, minor, patch, prerelease };
}

/**
 * Compares two SemVer strings (handles optional leading `v` and pre-release tags per SemVer 2.0.0).
 * Returns `1` if `a > b`, `-1` if `a < b`, or `0` if equal.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;

    if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
    if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
    if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

    const aHasPre = pa.prerelease.length > 0;
    const bHasPre = pb.prerelease.length > 0;
    if (!aHasPre && !bHasPre) return 0;
    if (!aHasPre && bHasPre) return 1; // Release > pre-release
    if (aHasPre && !bHasPre) return -1;

    const len = Math.max(pa.prerelease.length, pb.prerelease.length);
    for (let i = 0; i < len; i++) {
        const ia = pa.prerelease[i];
        const ib = pb.prerelease[i];
        if (ia === undefined) return -1;
        if (ib === undefined) return 1;
        if (ia === ib) continue;

        const aIsNum = typeof ia === "number";
        const bIsNum = typeof ib === "number";
        if (aIsNum && bIsNum) return ia > ib ? 1 : -1;
        if (aIsNum && !bIsNum) return -1; // Numeric identifiers have lower precedence than non-numeric
        if (!aIsNum && bIsNum) return 1;
        return String(ia) > String(ib) ? 1 : -1;
    }

    return 0;
}

export function resolveReleaseUrl(
    rawUrl: unknown,
    source: UpdateSource,
    repoSlug = DEFAULT_UPDATE_REPO_SLUG,
): string | null {
    if (typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("//")) {
        // Reject protocol-relative URLs to prevent unexpected scheme/host confusion
        return null;
    }

    if (trimmed.startsWith("/")) {
        const origin = source === "cnb" ? CNB_ORIGIN : GITHUB_ORIGIN;
        const normalizedPath =
            source === "cnb" && trimmed.startsWith("/-/")
                ? `/${repoSlug}${trimmed}`
                : trimmed;
        const resolved = `${origin}${normalizedPath}`;
        return isSafeHttpsUrl(resolved) ? new URL(resolved).toString() : null;
    }

    return isSafeHttpsUrl(trimmed) ? new URL(trimmed).toString() : null;
}

/**
 * Normalizes both CNB OpenAPI Release JSON and GitHub Release JSON into a unified shape,
 * resolving relative CNB download/page paths against `https://cnb.cool` and rejecting unsafe URLs.
 */
export function normalizeReleasePayload(
    raw: unknown,
    source: UpdateSource,
    repoSlug = DEFAULT_UPDATE_REPO_SLUG,
): NormalizedRelease {
    if (!raw || typeof raw !== "object") {
        throw new Error(`Invalid ${source.toUpperCase()} release payload.`);
    }
    const obj = raw as Record<string, unknown>;
    const rawTag =
        (typeof obj.tag_name === "string" && obj.tag_name) ||
        (typeof obj.tagName === "string" && obj.tagName) ||
        (typeof obj.tag === "string" && obj.tag) ||
        (typeof obj.version === "string" && obj.version) ||
        "";

    const tagName = rawTag.trim();
    const version = normalizeVersion(tagName);
    if (!version || !parseSemver(version)) {
        throw new Error(`Release payload from ${source.toUpperCase()} is missing a valid semver tag.`);
    }

    const name =
        (typeof obj.name === "string" && obj.name.trim()) ||
        (typeof obj.title === "string" && obj.title.trim()) ||
        tagName;

    const body =
        (typeof obj.body === "string" && obj.body) ||
        (typeof obj.description === "string" && obj.description) ||
        (typeof obj.release_notes === "string" && obj.release_notes) ||
        "";

    const publishedAt =
        (typeof obj.published_at === "string" && obj.published_at) ||
        (typeof obj.publishedAt === "string" && obj.publishedAt) ||
        (typeof obj.created_at === "string" && obj.created_at) ||
        (typeof obj.createdAt === "string" && obj.createdAt) ||
        null;

    // Prefer HTML web page URL (never GitHub API JSON `url`)
    const candidatePageUrl =
        obj.html_url ??
        obj.htmlUrl ??
        obj.web_url ??
        (source === "cnb" ? obj.url : undefined);
    const fallbackPageUrl =
        source === "cnb"
            ? getCnbReleasePageUrl(repoSlug, tagName)
            : getGithubReleasePageUrl(repoSlug, tagName);
    const htmlUrl = resolveReleaseUrl(candidatePageUrl, source, repoSlug) ?? fallbackPageUrl;

    const rawAssets = Array.isArray(obj.assets) ? obj.assets : [];
    const assets: DesktopReleaseAsset[] = [];

    for (const item of rawAssets) {
        if (!item || typeof item !== "object") continue;
        const a = item as Record<string, unknown>;
        const assetName =
            (typeof a.name === "string" && a.name.trim()) ||
            (typeof a.filename === "string" && a.filename.trim()) ||
            (typeof a.file_name === "string" && a.file_name.trim()) ||
            "";
        if (!assetName) continue;

        const rawDownload =
            a.browser_download_url ??
            a.download_url ??
            a.downloadUrl ??
            a.path ??
            a.url;
        const downloadUrl = resolveReleaseUrl(rawDownload, source, repoSlug);
        if (!downloadUrl) continue;

        const size =
            typeof a.size === "number" && Number.isFinite(a.size)
                ? a.size
                : typeof a.size_in_byte === "number" && Number.isFinite(a.size_in_byte)
                    ? a.size_in_byte
                    : undefined;
        const contentType =
            (typeof a.content_type === "string" && a.content_type) ||
            (typeof a.contentType === "string" && a.contentType) ||
            undefined;

        assets.push({
            name: assetName,
            downloadUrl,
            size,
            contentType,
        });
    }

    return {
        version,
        tagName,
        name,
        body,
        publishedAt,
        htmlUrl,
        assets,
        source,
    };
}

const IGNORED_ASSET_SUFFIXES = [
    ".sha256",
    ".sha512",
    ".sha1",
    ".md5",
    ".sig",
    ".asc",
    ".blockmap",
    ".yml",
    ".yaml",
    ".json",
    ".txt",
];

function isArchMatch(lowerName: string, arch: string): "exact" | "opposite" | "neutral" {
    const isArm = arch === "arm64" || arch === "aarch64";
    const mentionsArm = /(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/.test(lowerName);
    const mentionsX64 = /(?:^|[-_.])(x64|x86_64|amd64|intel)(?:[-_.]|$)/.test(lowerName);
    const mentionsUniversal = /(?:^|[-_.])universal(?:[-_.]|$)/.test(lowerName);

    if (mentionsUniversal) return "neutral";
    if (isArm) {
        if (mentionsArm) return "exact";
        if (mentionsX64) return "opposite";
        return "neutral";
    }
    if (mentionsX64) return "exact";
    if (mentionsArm) return "opposite";
    return "neutral";
}

/**
 * Picks the best desktop installer asset for the user's OS & CPU architecture:
 * - Windows: `.exe` NSIS/Setup before portable `.exe`, then `.msi` / win `.zip`
 * - macOS: arch-matched `.dmg` (arm64 vs x64), then universal `.dmg`, then mac `.zip`
 * - Linux: `.AppImage`, then `.deb` / `.rpm` / linux `.tar.gz`
 */
export function pickReleaseAssetForPlatform(
    assets: DesktopReleaseAsset[],
    platform: NodeJS.Platform,
    arch: string,
): DesktopReleaseAsset | null {
    const candidates = assets.filter(asset => {
        const lower = asset.name.toLowerCase();
        return !IGNORED_ASSET_SUFFIXES.some(suffix => lower.endsWith(suffix));
    });
    if (candidates.length === 0) return null;

    let best: { asset: DesktopReleaseAsset; score: number } | null = null;

    for (const asset of candidates) {
        const lower = asset.name.toLowerCase();
        const archFit = isArchMatch(lower, arch);
        if (archFit === "opposite") continue;

        let score = 0;
        if (platform === "win32") {
            if (lower.endsWith(".exe")) {
                const isSetup = /(?:setup|nsis|installer)/.test(lower);
                const isPortable = /portable/.test(lower);
                score = isSetup ? 100 : isPortable ? 70 : 85;
            } else if (lower.endsWith(".msi")) {
                score = 80;
            } else if (lower.endsWith(".zip") && /win/.test(lower)) {
                score = 50;
            }
        } else if (platform === "darwin") {
            if (lower.endsWith(".dmg")) {
                score = 100;
            } else if (lower.endsWith(".pkg")) {
                score = 85;
            } else if (lower.endsWith(".zip") && /(?:mac|darwin|osx|arm64|x64)/.test(lower)) {
                score = 60;
            }
        } else if (platform === "linux") {
            if (lower.endsWith(".appimage")) {
                score = 100;
            } else if (lower.endsWith(".deb")) {
                score = 75;
            } else if (lower.endsWith(".rpm")) {
                score = 70;
            } else if (lower.endsWith(".tar.gz") && /linux/.test(lower)) {
                score = 55;
            }
        }

        if (score <= 0) continue;
        if (archFit === "exact") score += 15;

        if (!best || score > best.score) {
            best = { asset, score };
        }
    }

    return best?.asset ?? null;
}

export function shouldNotifyUpdate(
    result: DesktopUpdateCheckResult,
    ignoredUpdateVersion: string | null | undefined,
): boolean {
    if (result.status !== "update-available" || !result.latestVersion) {
        return false;
    }
    if (ignoredUpdateVersion && normalizeVersion(ignoredUpdateVersion) === normalizeVersion(result.latestVersion)) {
        return false;
    }
    return true;
}

async function fetchReleaseFromSource(params: {
    source: UpdateSource;
    url: string;
    repoSlug: string;
    currentVersion: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
}): Promise<NormalizedRelease> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const headers: Record<string, string> = {
            Accept: params.source === "github" ? "application/vnd.github+json" : "application/json",
            "User-Agent": `MoeSekai-Story-Studio/${normalizeVersion(params.currentVersion) || "0.1.0"}`,
        };
        const response = await params.fetchImpl(params.url, {
            method: "GET",
            headers,
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`${params.source.toUpperCase()} HTTP ${response.status}`);
        }
        const json = await response.json();
        return normalizeReleasePayload(json, params.source, params.repoSlug);
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            throw new Error(`${params.source.toUpperCase()} request timed out after ${params.timeoutMs}ms`);
        }
        throw err instanceof Error ? err : new Error(String(err));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Checks for MoeSekai Story Studio desktop updates:
 * - `channel: "auto"` (default): tries CNB primary first, silently falling back to GitHub on error/timeout.
 * - `channel: "cnb"`: queries CNB only.
 * - `channel: "github"`: queries GitHub only.
 */
export async function checkForDesktopUpdates(
    options: CheckDesktopUpdatesOptions,
): Promise<DesktopUpdateCheckResult> {
    const channel: UpdateChannel = options.channel ?? "auto";
    const platform: NodeJS.Platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const repoSlug = options.repoSlug?.trim() || DEFAULT_UPDATE_REPO_SLUG;
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 8_000;
    const currentVersion = normalizeVersion(options.currentVersion) || "0.1.0";

    const sources: UpdateSource[] =
        channel === "cnb"
            ? ["cnb"]
            : channel === "github"
                ? ["github"]
                : ["cnb", "github"];

    const errors: string[] = [];

    for (let idx = 0; idx < sources.length; idx++) {
        const source = sources[idx];
        const apiUrl =
            source === "cnb"
                ? (options.cnbApiUrl?.trim() || getCnbLatestApiUrl(repoSlug))
                : (options.githubApiUrl?.trim() || getGithubLatestApiUrl(repoSlug));

        try {
            const release = await fetchReleaseFromSource({
                source,
                url: apiUrl,
                repoSlug,
                currentVersion,
                fetchImpl,
                timeoutMs,
            });
            const matched = pickReleaseAssetForPlatform(release.assets, platform, arch);
            const hasNewer = compareSemver(release.version, currentVersion) > 0;
            const alternateReleasePageUrl =
                source === "cnb"
                    ? getGithubReleasePageUrl(repoSlug, release.tagName)
                    : getCnbReleasePageUrl(repoSlug, release.tagName);

            return {
                status: hasNewer ? "update-available" : "up-to-date",
                currentVersion,
                latestVersion: release.version,
                source,
                fallbackUsed: idx > 0,
                releaseName: release.name,
                releaseNotes: release.body,
                publishedAt: release.publishedAt,
                releasePageUrl: release.htmlUrl,
                alternateReleasePageUrl,
                downloadUrl: matched?.downloadUrl ?? null,
                assetName: matched?.name ?? null,
                assetSize: matched?.size ?? null,
                checkedAt: Date.now(),
            };
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }
    }

    const lastSource = sources[sources.length - 1] ?? "cnb";
    return {
        status: "error",
        currentVersion,
        latestVersion: null,
        source: lastSource,
        fallbackUsed: sources.length > 1,
        releaseName: "",
        releaseNotes: "",
        publishedAt: null,
        releasePageUrl:
            lastSource === "cnb"
                ? getCnbReleasePageUrl(repoSlug)
                : getGithubReleasePageUrl(repoSlug),
        alternateReleasePageUrl:
            lastSource === "cnb"
                ? getGithubReleasePageUrl(repoSlug)
                : getCnbReleasePageUrl(repoSlug),
        downloadUrl: null,
        assetName: null,
        assetSize: null,
        checkedAt: Date.now(),
        errorMessage: errors.join(" | "),
    };
}
