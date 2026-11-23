/**
 * Real dual-mirror release metadata engine for MoeSekai Story Studio.
 * Synchronized with `apps/desktop/src/shared/updater.ts`, `scripts/sync-cnb-release.ts`,
 * and `.github/workflows/publish.yml`.
 */

export type MirrorId = "cnb" | "github";
export type PlatformKey = "win" | "mac" | "linux";
export type InstallerId =
  | "win-setup"
  | "win-portable"
  | "mac-arm64"
  | "mac-x64"
  | "linux-appimage";

export interface InstallerAsset {
  id: InstallerId;
  platform: PlatformKey;
  arch: "x64" | "arm64";
  recommended?: boolean;
  /** Exact filename as built by electron-builder & stored on CNB */
  cnbFilename: string;
  /** Exact filename as normalized by GitHub Releases (spaces -> dots) */
  githubFilename: string;
  cnbUrl: string;
  githubUrl: string;
  sizeBytes: number;
  sha256?: string;
}

export interface ReleaseSnapshot {
  version: string;
  tag: string;
  publishedAt: string;
  source: "live-github" | "static-fallback";
  notesMarkdown: string;
  cnbReleasePage: string;
  githubReleasePage: string;
  sha256SumsUrls: {
    cnb: string;
    github: string;
  };
  installers: InstallerAsset[];
}

export const REPO_SLUG = "StarMoe-org/moesekai-story-studio";
export const CNB_REPO_URL = `https://cnb.cool/${REPO_SLUG}`;
export const GITHUB_REPO_URL = `https://github.com/${REPO_SLUG}`;
export const CNB_RELEASES_LATEST_PAGE = `${CNB_REPO_URL}/-/releases/latest`;
export const GITHUB_RELEASES_LATEST_PAGE = `${GITHUB_REPO_URL}/releases/latest`;
export const GITHUB_LATEST_API_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

export const FALLBACK_VERSION = "0.2.0";
export const FALLBACK_TAG = `v${FALLBACK_VERSION}`;

const KNOWN_SHA256_BY_VERSION: Record<string, Record<InstallerId, string>> = {
  "0.1.4": {
    "win-setup": "80f1f4a03718eedb61aee79faca108e76d468648ae7a1b090b0c1bff6af0a852",
    "win-portable": "2ec5265366cb7f510b60ade716571efc5e03101f52241c6794e59400e777acc3",
    "mac-arm64": "f9f50e6c3e0ce12970f561861f19ab576be08448a30a9d48fa3c02cf32ea4669",
    "mac-x64": "b90c68c9fdb07584f43654e6a66cb0dc48acb0033c3330a7de3196f0f96cb9ab",
    "linux-appimage": "738db0acdd12654fa01e04f789b61dd8b501dd24a07e087c64f7c4a91731a759",
  },
};

const FALLBACK_SIZES: Record<InstallerId, number> = {
  "win-setup": 114_319_578,
  "win-portable": 101_669_347,
  "mac-arm64": 140_243_042,
  "mac-x64": 144_643_608,
  "linux-appimage": 146_680_334,
};

export function buildCnbDownloadUrl(tag: string, filename: string): string {
  return `${CNB_REPO_URL}/-/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

export function buildGithubDownloadUrl(tag: string, filename: string): string {
  return `${GITHUB_REPO_URL}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

export function buildDefaultInstallersForVersion(version: string): InstallerAsset[] {
  const tag = `v${version}`;
  const knownHashes = KNOWN_SHA256_BY_VERSION[version];
  const specs: Array<{
    id: InstallerId;
    platform: PlatformKey;
    arch: "x64" | "arm64";
    recommended?: boolean;
    cnbFilename: string;
    githubFilename: string;
  }> = [
    {
      id: "win-setup",
      platform: "win",
      arch: "x64",
      recommended: true,
      cnbFilename: `MoeSekai Story Studio Setup ${version}.exe`,
      githubFilename: `MoeSekai.Story.Studio.Setup.${version}.exe`,
    },
    {
      id: "win-portable",
      platform: "win",
      arch: "x64",
      cnbFilename: `MoeSekai Story Studio ${version}.exe`,
      githubFilename: `MoeSekai.Story.Studio.${version}.exe`,
    },
    {
      id: "mac-arm64",
      platform: "mac",
      arch: "arm64",
      recommended: true,
      cnbFilename: `MoeSekai Story Studio-${version}-arm64.dmg`,
      githubFilename: `MoeSekai.Story.Studio-${version}-arm64.dmg`,
    },
    {
      id: "mac-x64",
      platform: "mac",
      arch: "x64",
      cnbFilename: `MoeSekai Story Studio-${version}.dmg`,
      githubFilename: `MoeSekai.Story.Studio-${version}.dmg`,
    },
    {
      id: "linux-appimage",
      platform: "linux",
      arch: "x64",
      recommended: true,
      cnbFilename: `MoeSekai Story Studio-${version}.AppImage`,
      githubFilename: `MoeSekai.Story.Studio-${version}.AppImage`,
    },
  ];

  return specs.map((spec) => ({
    ...spec,
    cnbUrl: buildCnbDownloadUrl(tag, spec.cnbFilename),
    githubUrl: buildGithubDownloadUrl(tag, spec.githubFilename),
    sizeBytes: FALLBACK_SIZES[spec.id],
    sha256: knownHashes?.[spec.id],
  }));
}

export const STATIC_FALLBACK_RELEASE: ReleaseSnapshot = {
  version: FALLBACK_VERSION,
  tag: FALLBACK_TAG,
  publishedAt: "2026-11-24",
  source: "static-fallback",
  notesMarkdown: [
    "• Migrated Live2D assets to canonical storage.pjsk.moe (with storage.exmeaning.com backup) across Core, Editor, Agent, Desktop & Skill",
    "• Vendored host-served SekaiLive2DViewer 0.3.0 in Desktop via moesekai-app:// protocol",
    "• Unified canonical Live2D module in @moesekai/story-core and automatic stale cache pruning on Desktop",
  ].join("\n"),
  cnbReleasePage: `${CNB_REPO_URL}/-/releases/tag/${FALLBACK_TAG}`,
  githubReleasePage: `${GITHUB_REPO_URL}/releases/tag/${FALLBACK_TAG}`,
  sha256SumsUrls: {
    cnb: buildCnbDownloadUrl(FALLBACK_TAG, "SHA256SUMS.txt"),
    github: buildGithubDownloadUrl(FALLBACK_TAG, "SHA256SUMS.txt"),
  },
  installers: buildDefaultInstallersForVersion(FALLBACK_VERSION),
};

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export interface DetectedVisitorSystem {
  platform: PlatformKey;
  recommendedInstallerId: InstallerId;
  isAppleSilicon: boolean;
}

export function detectVisitorSystem(): DetectedVisitorSystem {
  if (typeof navigator === "undefined") {
    return { platform: "win", recommendedInstallerId: "win-setup", isAppleSilicon: false };
  }

  const ua = navigator.userAgent || "";
  const navPlatform = (navigator.platform || "").toLowerCase();
  const uaDataPlatform = (
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || ""
  ).toLowerCase();

  const joined = `${uaDataPlatform} ${navPlatform} ${ua.toLowerCase()}`;

  if (joined.includes("mac") || joined.includes("darwin")) {
    let isAppleSilicon = true;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
      if (gl) {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          const renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "");
          if (/intel/i.test(renderer) && !/apple/i.test(renderer)) {
            isAppleSilicon = false;
          }
        }
      }
    } catch {
      // Default to Apple Silicon on modern macOS
    }
    return {
      platform: "mac",
      recommendedInstallerId: isAppleSilicon ? "mac-arm64" : "mac-x64",
      isAppleSilicon,
    };
  }

  if (joined.includes("linux") && !joined.includes("android")) {
    return { platform: "linux", recommendedInstallerId: "linux-appimage", isAppleSilicon: false };
  }

  return { platform: "win", recommendedInstallerId: "win-setup", isAppleSilicon: false };
}

interface GithubAssetRaw {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

interface GithubReleaseRaw {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  body?: string;
  assets?: GithubAssetRaw[];
}

function classifyGithubAsset(name: string): InstallerId | "sha256" | null {
  const lower = name.toLowerCase();
  if (lower === "sha256sums.txt") return "sha256";
  if (lower.endsWith(".blockmap")) return null;
  if (lower.endsWith(".exe")) {
    return /setup|nsis|installer/.test(lower) ? "win-setup" : "win-portable";
  }
  if (lower.endsWith(".dmg")) {
    return /arm64|aarch64/.test(lower) ? "mac-arm64" : "mac-x64";
  }
  if (lower.endsWith(".appimage")) {
    return "linux-appimage";
  }
  return null;
}

function isSafeHttps(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fetches live release metadata from GitHub Releases API (CORS `*`) with fast timeout.
 * Automatically preserves synchronized CNB mirror direct download links (since CNB's
 * JSON endpoint lacks browser CORS headers while its release asset downloads are lockstep-mirrored
 * by `.github/workflows/publish.yml`).
 */
export async function fetchLatestRelease(timeoutMs = 4500): Promise<ReleaseSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GITHUB_LATEST_API_URL, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return STATIC_FALLBACK_RELEASE;
    }

    const raw = (await res.json()) as GithubReleaseRaw;
    const rawTag = (raw.tag_name || "").trim();
    const version = rawTag.replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return STATIC_FALLBACK_RELEASE;
    }

    const tag = `v${version}`;
    const baseInstallers = buildDefaultInstallersForVersion(version);
    const installerMap = new Map<InstallerId, InstallerAsset>(
      baseInstallers.map((item) => [item.id, { ...item }]),
    );

    let githubSumsUrl = buildGithubDownloadUrl(tag, "SHA256SUMS.txt");

    if (Array.isArray(raw.assets)) {
      for (const asset of raw.assets) {
        if (!asset.name || !isSafeHttps(asset.browser_download_url)) continue;
        const kind = classifyGithubAsset(asset.name);
        if (!kind) continue;

        if (kind === "sha256") {
          githubSumsUrl = asset.browser_download_url;
          continue;
        }

        const existing = installerMap.get(kind);
        if (existing) {
          existing.githubFilename = asset.name;
          existing.githubUrl = asset.browser_download_url;
          if (typeof asset.size === "number" && asset.size > 0) {
            existing.sizeBytes = asset.size;
          }
        }
      }
    }

    const publishedAt =
      typeof raw.published_at === "string" && raw.published_at.length >= 10
        ? raw.published_at.slice(0, 10)
        : STATIC_FALLBACK_RELEASE.publishedAt;

    return {
      version,
      tag,
      publishedAt,
      source: "live-github",
      notesMarkdown: raw.body?.trim() || STATIC_FALLBACK_RELEASE.notesMarkdown,
      cnbReleasePage: `${CNB_REPO_URL}/-/releases/tag/${encodeURIComponent(tag)}`,
      githubReleasePage: isSafeHttps(raw.html_url)
        ? raw.html_url
        : `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(tag)}`,
      sha256SumsUrls: {
        cnb: buildCnbDownloadUrl(tag, "SHA256SUMS.txt"),
        github: githubSumsUrl,
      },
      installers: Array.from(installerMap.values()),
    };
  } catch {
    return STATIC_FALLBACK_RELEASE;
  } finally {
    clearTimeout(timer);
  }
}
