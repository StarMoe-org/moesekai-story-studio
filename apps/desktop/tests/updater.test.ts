import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DesktopSettingsStore } from "../src/main/settings.ts";
import {
    checkForDesktopUpdates,
    compareSemver,
    isSafeHttpsUrl,
    normalizeReleasePayload,
    pickReleaseAssetForPlatform,
    resolveReleaseUrl,
    shouldNotifyUpdate,
    type DesktopReleaseAsset,
} from "../src/shared/updater.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "moesekai-updater-test-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("SemVer comparison & HTTPS URL safety guard", () => {
    it("compares SemVer versions accurately with leading v, pre-release tags, and build metadata", () => {
        expect(compareSemver("v0.2.0", "0.1.0")).toBe(1);
        expect(compareSemver("0.1.0", "v0.1.0")).toBe(0);
        expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
        expect(compareSemver("1.0.0", "1.0.0-beta.1")).toBe(1);
        expect(compareSemver("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
        expect(compareSemver("1.0.0-alpha.1", "1.0.0-beta.1")).toBe(-1);
        expect(compareSemver("v0.2.0+build.42", "0.2.0")).toBe(0);
    });

    it("enforces strictly https:// URLs and rejects http, file, javascript, data, and protocol-relative URLs", () => {
        expect(isSafeHttpsUrl("https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/latest")).toBe(true);
        expect(isSafeHttpsUrl("https://github.com/StarMoe-org/moesekai-story-studio/releases/latest")).toBe(true);
        expect(isSafeHttpsUrl("http://cnb.cool/insecure.exe")).toBe(false);
        expect(isSafeHttpsUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
        expect(isSafeHttpsUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeHttpsUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
        expect(isSafeHttpsUrl("//evil.example/payload.exe")).toBe(false);
        expect(isSafeHttpsUrl("not a url")).toBe(false);
        expect(resolveReleaseUrl("//evil.example/payload.exe", "cnb")).toBeNull();
    });
});

describe("CNB & GitHub release payload normalization and platform asset matching", () => {
    it("resolves relative CNB asset download URLs cleanly against https://cnb.cool and strips non-HTTPS URLs", () => {
        const normalized = normalizeReleasePayload(
            {
                tag_name: "v0.2.0",
                name: "Release v0.2.0",
                body: "## Changes\n- Faster Live2D",
                published_at: "2026-11-23T10:00:00Z",
                url: "/StarMoe-org/moesekai-story-studio/-/releases/tag/v0.2.0",
                assets: [
                    {
                        name: "MoeSekai-Story-Studio-0.2.0-Setup.exe",
                        path: "/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-Setup.exe",
                        size_in_byte: 88_000_000,
                    },
                    {
                        name: "MoeSekai-Story-Studio-0.2.0-arm64.dmg",
                        path: "/StarMoe-org/moesekai-story-studio/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-arm64.dmg",
                        size_in_byte: 95_000_000,
                    },
                    {
                        name: "malicious.exe",
                        browser_download_url: "http://insecure.example/malicious.exe",
                    },
                    {
                        name: "local-escape.exe",
                        browser_download_url: "file:///tmp/local.exe",
                    },
                ],
            },
            "cnb",
            "StarMoe-org/moesekai-story-studio",
        );

        expect(normalized.version).toBe("0.2.0");
        expect(normalized.htmlUrl).toBe("https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/tag/v0.2.0");
        expect(normalized.assets).toHaveLength(2);
        expect(normalized.assets[0].downloadUrl).toBe(
            "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-Setup.exe",
        );
        expect(normalized.assets[0].size).toBe(88_000_000);
        expect(normalized.assets[1].downloadUrl).toBe(
            "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-arm64.dmg",
        );
    });

    it("matches Windows Setup before portable, macOS arm64 vs x64 DMG, and Linux AppImage accurately", () => {
        const assets: DesktopReleaseAsset[] = [
            { name: "latest.yml", downloadUrl: "https://cnb.cool/latest.yml" },
            { name: "MoeSekai-Story-Studio-0.2.0-Setup.exe.blockmap", downloadUrl: "https://cnb.cool/a.blockmap" },
            { name: "MoeSekai-Story-Studio-0.2.0-portable.exe", downloadUrl: "https://cnb.cool/portable.exe" },
            { name: "MoeSekai-Story-Studio-0.2.0-Setup.exe", downloadUrl: "https://cnb.cool/setup.exe" },
            { name: "MoeSekai-Story-Studio-0.2.0-arm64.dmg", downloadUrl: "https://cnb.cool/mac-arm64.dmg" },
            { name: "MoeSekai-Story-Studio-0.2.0-x64.dmg", downloadUrl: "https://cnb.cool/mac-x64.dmg" },
            { name: "MoeSekai-Story-Studio-0.2.0-x86_64.AppImage", downloadUrl: "https://cnb.cool/linux.AppImage" },
            { name: "MoeSekai-Story-Studio-0.2.0-amd64.deb", downloadUrl: "https://cnb.cool/linux.deb" },
        ];

        expect(pickReleaseAssetForPlatform(assets, "win32", "x64")?.name).toBe(
            "MoeSekai-Story-Studio-0.2.0-Setup.exe",
        );
        expect(pickReleaseAssetForPlatform(assets, "darwin", "arm64")?.name).toBe(
            "MoeSekai-Story-Studio-0.2.0-arm64.dmg",
        );
        expect(pickReleaseAssetForPlatform(assets, "darwin", "x64")?.name).toBe(
            "MoeSekai-Story-Studio-0.2.0-x64.dmg",
        );
        expect(pickReleaseAssetForPlatform(assets, "linux", "x64")?.name).toBe(
            "MoeSekai-Story-Studio-0.2.0-x86_64.AppImage",
        );
    });
});

describe("checkForDesktopUpdates CNB primary + GitHub auto-fallback", () => {
    it("uses CNB primary in auto mode without hitting GitHub when CNB succeeds", async () => {
        const calls: string[] = [];
        const mockFetch = (async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);
            return new Response(
                JSON.stringify({
                    tag_name: "v0.2.0",
                    name: "v0.2.0",
                    body: "Release notes from CNB",
                    published_at: "2026-11-23T12:00:00Z",
                    assets: [
                        {
                            name: "MoeSekai-Story-Studio-0.2.0-Setup.exe",
                            path: "/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-Setup.exe",
                            size: 85_000_000,
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const res = await checkForDesktopUpdates({
            currentVersion: "0.1.0",
            channel: "auto",
            platform: "win32",
            arch: "x64",
            fetchImpl: mockFetch,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain("api.cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/latest");
        expect(res.status).toBe("update-available");
        expect(res.source).toBe("cnb");
        expect(res.fallbackUsed).toBe(false);
        expect(res.latestVersion).toBe("0.2.0");
        expect(res.downloadUrl).toBe(
            "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/download/v0.2.0/MoeSekai-Story-Studio-0.2.0-Setup.exe",
        );
    });

    it("automatically falls back to GitHub when CNB returns HTTP 500 or times out", async () => {
        // Case A: CNB HTTP 500 -> GitHub 200
        const calls500: string[] = [];
        const fetch500 = (async (input: string | URL | Request) => {
            const url = String(input);
            calls500.push(url);
            if (url.includes("api.cnb.cool")) {
                return new Response("Internal Server Error", { status: 500 });
            }
            return new Response(
                JSON.stringify({
                    tag_name: "v0.3.0",
                    name: "v0.3.0",
                    html_url: "https://github.com/StarMoe-org/moesekai-story-studio/releases/tag/v0.3.0",
                    body: "Release notes from GitHub",
                    assets: [
                        {
                            name: "MoeSekai-Story-Studio-0.3.0-arm64.dmg",
                            browser_download_url: "https://github.com/StarMoe-org/moesekai-story-studio/releases/download/v0.3.0/MoeSekai-Story-Studio-0.3.0-arm64.dmg",
                            size: 92_000_000,
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const res500 = await checkForDesktopUpdates({
            currentVersion: "0.1.0",
            channel: "auto",
            platform: "darwin",
            arch: "arm64",
            fetchImpl: fetch500,
        });

        expect(calls500).toHaveLength(2);
        expect(calls500[0]).toContain("api.cnb.cool");
        expect(calls500[1]).toContain("api.github.com");
        expect(res500.status).toBe("update-available");
        expect(res500.source).toBe("github");
        expect(res500.fallbackUsed).toBe(true);
        expect(res500.assetName).toBe("MoeSekai-Story-Studio-0.3.0-arm64.dmg");

        // Case B: CNB timeout -> GitHub 200 (up-to-date)
        const fetchTimeout = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("api.cnb.cool")) {
                return await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        const err = new Error("Aborted");
                        err.name = "AbortError";
                        reject(err);
                    });
                });
            }
            return new Response(
                JSON.stringify({
                    tag_name: "v0.1.0",
                    name: "v0.1.0",
                    html_url: "https://github.com/StarMoe-org/moesekai-story-studio/releases/tag/v0.1.0",
                    body: "Current release",
                    assets: [],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const resTimeout = await checkForDesktopUpdates({
            currentVersion: "0.1.0",
            channel: "auto",
            timeoutMs: 30,
            fetchImpl: fetchTimeout,
        });

        expect(resTimeout.status).toBe("up-to-date");
        expect(resTimeout.source).toBe("github");
        expect(resTimeout.fallbackUsed).toBe(true);
    });

    it("respects explicit cnb-only and github-only channels without cross-calling", async () => {
        const cnbOnlyCalls: string[] = [];
        const cnbFailFetch = (async (input: string | URL | Request) => {
            cnbOnlyCalls.push(String(input));
            return new Response("Unavailable", { status: 503 });
        }) as unknown as typeof fetch;

        const cnbRes = await checkForDesktopUpdates({
            currentVersion: "0.1.0",
            channel: "cnb",
            fetchImpl: cnbFailFetch,
        });
        expect(cnbOnlyCalls).toHaveLength(1);
        expect(cnbOnlyCalls[0]).toContain("api.cnb.cool");
        expect(cnbRes.status).toBe("error");
        expect(cnbRes.fallbackUsed).toBe(false);

        const ghOnlyCalls: string[] = [];
        const ghFetch = (async (input: string | URL | Request) => {
            ghOnlyCalls.push(String(input));
            return new Response(
                JSON.stringify({
                    tag_name: "v0.2.5",
                    name: "v0.2.5",
                    html_url: "https://github.com/StarMoe-org/moesekai-story-studio/releases/tag/v0.2.5",
                    body: "GitHub direct",
                    assets: [],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const ghRes = await checkForDesktopUpdates({
            currentVersion: "0.1.0",
            channel: "github",
            fetchImpl: ghFetch,
        });
        expect(ghOnlyCalls).toHaveLength(1);
        expect(ghOnlyCalls[0]).toContain("api.github.com");
        expect(ghRes.status).toBe("update-available");
        expect(ghRes.source).toBe("github");
        expect(ghRes.fallbackUsed).toBe(false);
    });

    it("suppresses notifications for ignored versions and persists update preferences cleanly", () => {
        const sampleUpdate = {
            status: "update-available" as const,
            currentVersion: "0.1.0",
            latestVersion: "0.2.0",
            source: "cnb" as const,
            fallbackUsed: false,
            releaseName: "v0.2.0",
            releaseNotes: "",
            publishedAt: null,
            releasePageUrl: "https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/tag/v0.2.0",
            alternateReleasePageUrl: "https://github.com/StarMoe-org/moesekai-story-studio/releases/tag/v0.2.0",
            downloadUrl: null,
            assetName: null,
            assetSize: null,
            checkedAt: Date.now(),
        };

        expect(shouldNotifyUpdate(sampleUpdate, null)).toBe(true);
        expect(shouldNotifyUpdate(sampleUpdate, "0.2.0")).toBe(false);
        expect(shouldNotifyUpdate(sampleUpdate, "v0.2.0")).toBe(false);
        expect(shouldNotifyUpdate(sampleUpdate, "0.1.5")).toBe(true);

        const userData = makeTempDir("moesekai-settings-update-");
        const store = new DesktopSettingsStore(userData);
        const initial = store.getAppSettings();
        expect(initial.updateChannel).toBe("auto");
        expect(initial.autoCheckUpdates).toBe(true);
        expect(initial.ignoredUpdateVersion).toBeNull();

        const updated = store.updateAppSettings({
            updateChannel: "github",
            autoCheckUpdates: false,
            ignoredUpdateVersion: "0.2.0",
        });
        expect(updated.updateChannel).toBe("github");
        expect(updated.autoCheckUpdates).toBe(false);
        expect(updated.ignoredUpdateVersion).toBe("0.2.0");

        const reloaded = new DesktopSettingsStore(userData).getAppSettings();
        expect(reloaded.updateChannel).toBe("github");
        expect(reloaded.autoCheckUpdates).toBe(false);
        expect(reloaded.ignoredUpdateVersion).toBe("0.2.0");
    });
});
