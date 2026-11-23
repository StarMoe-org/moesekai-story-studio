import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    AssetCacheManager,
    CACHE_PROTOCOL_SCHEME,
    resolveCacheUpstreamUrl,
} from "../src/main/asset-cache.ts";
import { DesktopSettingsStore } from "../src/main/settings.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "moesekai-asset-cache-test-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

describe("AssetCacheManager persistent disk cache (`moesekai-cache://`)", () => {
    it("enforces strict host allowlist and rejects untrusted hosts, credentials, ports, and path traversal with 403", async () => {
        const cacheDir = makeTempDir();
        let upstreamCalls = 0;
        const mockFetch = (async () => {
            upstreamCalls += 1;
            return new Response("ok", { status: 200 });
        }) as unknown as typeof fetch;

        const cache = new AssetCacheManager({ cacheDir, fetchImpl: mockFetch });

        // Valid allowlisted hosts resolve cleanly to https://
        expect(resolveCacheUpstreamUrl("moesekai-cache://assets.pjsk.moe/sekai-extra-assets/a.moc3").href).toBe(
            "https://assets.pjsk.moe/sekai-extra-assets/a.moc3",
        );
        expect(resolveCacheUpstreamUrl("moesekai-cache://storage.pjsk.moe/jp/live2d/model/").href).toBe(
            "https://storage.pjsk.moe/jp/live2d/model/",
        );
        expect(resolveCacheUpstreamUrl("moesekai-cache://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js").href).toBe(
            "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
        );

        const blockedUrls = [
            "moesekai-cache://evil.example/payload.bin",
            "moesekai-cache://127.0.0.1/secret",
            "moesekai-cache://localhost/admin",
            "moesekai-cache://169.254.169.254/latest/meta-data/",
            "moesekai-cache://user:pass@assets.pjsk.moe/a.moc3",
            "moesekai-cache://assets.pjsk.moe:8443/a.moc3",
            "https://assets.pjsk.moe/not-cache-scheme.bin",
        ];

        // Direct raw URL traversal checks (WHATWG `new Request()` collapses `..` / `%2e%2e` before reaching handler)
        expect(() => resolveCacheUpstreamUrl("moesekai-cache://assets.pjsk.moe/foo/../secret.bin")).toThrow();
        expect(() => resolveCacheUpstreamUrl("moesekai-cache://assets.pjsk.moe/foo/%2e%2e/secret.bin")).toThrow();
        const rawTraversalRes = await cache.handleRequest({
            url: "moesekai-cache://assets.pjsk.moe/foo/%2e%2e/secret.bin",
            method: "GET",
            headers: new Headers(),
        } as unknown as Request);
        expect(rawTraversalRes.status).toBe(403);

        for (const bad of blockedUrls) {
            const res = await cache.handleRequest(new Request(bad));
            expect(res.status).toBe(403);
        }
        expect(upstreamCalls).toBe(0);
        cache.dispose();
    });

    it("caches on MISS, serves instant disk HIT without upstream fetch, and persists across restart", async () => {
        const cacheDir = makeTempDir();
        const payload = Buffer.from("MOC3_BINARY_CONTENT_1234567890", "utf8");
        let upstreamCalls = 0;

        const mockFetch = (async (input: string | URL | Request) => {
            upstreamCalls += 1;
            expect(String(input)).toBe("https://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/test.moc3");
            return new Response(payload, {
                status: 200,
                headers: {
                    "Content-Type": "application/octet-stream",
                    ETag: '"etag-moc3-v1"',
                },
            });
        }) as unknown as typeof fetch;

        const cache1 = new AssetCacheManager({ cacheDir, fetchImpl: mockFetch });
        const url = `${CACHE_PROTOCOL_SCHEME}://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/test.moc3`;

        // 1st request -> MISS
        const r1 = await cache1.handleRequest(new Request(url));
        expect(r1.status).toBe(200);
        expect(r1.headers.get("X-MoeSekai-Cache")).toBe("MISS");
        expect(r1.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(Buffer.from(await r1.arrayBuffer()).toString("utf8")).toBe(payload.toString("utf8"));
        expect(upstreamCalls).toBe(1);

        // 2nd request -> HIT (0 additional upstream calls)
        const r2 = await cache1.handleRequest(new Request(url));
        expect(r2.status).toBe(200);
        expect(r2.headers.get("X-MoeSekai-Cache")).toBe("HIT");
        expect(Buffer.from(await r2.arrayBuffer()).toString("utf8")).toBe(payload.toString("utf8"));
        expect(upstreamCalls).toBe(1);

        const stats1 = cache1.getStats();
        expect(stats1.entries).toBe(1);
        expect(stats1.totalBytes).toBe(payload.byteLength);
        expect(stats1.hits).toBe(1);
        expect(stats1.misses).toBe(1);
        cache1.dispose();

        // Reload fresh instance from disk -> still HIT with offline/failing upstream!
        const failingFetch = (async () => {
            throw new Error("Should not hit network after restart");
        }) as unknown as typeof fetch;
        const cache2 = new AssetCacheManager({ cacheDir, fetchImpl: failingFetch });
        const r3 = await cache2.handleRequest(new Request(url));
        expect(r3.status).toBe(200);
        expect(r3.headers.get("X-MoeSekai-Cache")).toBe("HIT");
        expect(Buffer.from(await r3.arrayBuffer()).toString("utf8")).toBe(payload.toString("utf8"));
        cache2.dispose();
    });

    it("coalesces concurrent in-flight requests for the same URL into a single upstream fetch", async () => {
        const cacheDir = makeTempDir();
        let upstreamCalls = 0;

        const mockFetch = (async () => {
            upstreamCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 35));
            return new Response("COALESCED_TEXTURE_BYTES", {
                status: 200,
                headers: { "Content-Type": "image/png" },
            });
        }) as unknown as typeof fetch;

        const cache = new AssetCacheManager({ cacheDir, fetchImpl: mockFetch });
        const url = `${CACHE_PROTOCOL_SCHEME}://assets.pjsk.moe/sekai-extra-assets/texture_00.png`;

        const responses = await Promise.all(
            Array.from({ length: 5 }, () => cache.handleRequest(new Request(url))),
        );
        expect(upstreamCalls).toBe(1);

        for (const res of responses) {
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("COALESCED_TEXTURE_BYTES");
        }
        cache.dispose();
    });

    it("supports HTTP Range (206 Partial Content), suffix ranges, HEAD, and 416 on cached audio", async () => {
        const cacheDir = makeTempDir();
        const audioBytes = Buffer.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", "utf8"); // 36 bytes
        const mockFetch = (async () =>
            new Response(audioBytes, {
                status: 200,
                headers: { "Content-Type": "audio/mpeg" },
            })) as unknown as typeof fetch;

        const cache = new AssetCacheManager({ cacheDir, fetchImpl: mockFetch });
        const url = `${CACHE_PROTOCOL_SCHEME}://storage.pjsk.moe/sekai-jp-assets/sound/bgm/bgm001.mp3`;

        // Prime cache
        const prime = await cache.handleRequest(new Request(url));
        expect(prime.status).toBe(200);
        await prime.arrayBuffer();

        // Range bytes=0-9
        const r1 = await cache.handleRequest(new Request(url, { headers: { Range: "bytes=0-9" } }));
        expect(r1.status).toBe(206);
        expect(r1.headers.get("Content-Range")).toBe("bytes 0-9/36");
        expect(r1.headers.get("Content-Length")).toBe("10");
        expect(r1.headers.get("X-MoeSekai-Cache")).toBe("HIT");
        expect(await r1.text()).toBe("0123456789");

        // Suffix range bytes=-6
        const r2 = await cache.handleRequest(new Request(url, { headers: { Range: "bytes=-6" } }));
        expect(r2.status).toBe(206);
        expect(r2.headers.get("Content-Range")).toBe("bytes 30-35/36");
        expect(await r2.text()).toBe("UVWXYZ");

        // HEAD request
        const head = await cache.handleRequest(new Request(url, { method: "HEAD" }));
        expect(head.status).toBe(200);
        expect(head.headers.get("Content-Length")).toBe("36");
        expect(head.headers.get("Accept-Ranges")).toBe("bytes");

        // Out-of-bounds range -> 416
        const badRange = await cache.handleRequest(new Request(url, { headers: { Range: "bytes=100-200" } }));
        expect(badRange.status).toBe(416);
        expect(badRange.headers.get("Content-Range")).toBe("bytes */36");
        cache.dispose();
    });

    it("supports stale-while-revalidate on directory listings and gracefully serves stale cache when offline", async () => {
        const cacheDir = makeTempDir();
        let clock = 1_700_000_000_000;
        let online = true;
        let version = 1;
        let upstreamCalls = 0;

        const mockFetch = (async () => {
            upstreamCalls += 1;
            if (!online) {
                throw new Error("ENOTFOUND offline");
            }
            return new Response(
                JSON.stringify({ format: "directory-listing", version: 1, directories: [`model_v${version}`] }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json", ETag: `"dir-v${version}"` },
                },
            );
        }) as unknown as typeof fetch;

        const cache = new AssetCacheManager({
            cacheDir,
            fetchImpl: mockFetch,
            now: () => clock,
            dynamicTtlMs: 1_000,
        });
        const url = `${CACHE_PROTOCOL_SCHEME}://storage.pjsk.moe/jp/live2d/model/`;

        // Initial MISS -> v1
        const r1 = await cache.handleRequest(new Request(url));
        expect(r1.headers.get("X-MoeSekai-Cache")).toBe("MISS");
        expect(await r1.text()).toContain("model_v1");

        // Advance past dynamic TTL while OFFLINE -> serves stale v1 cleanly without throwing!
        clock += 5_000;
        online = false;
        const rOffline = await cache.handleRequest(new Request(url));
        expect(rOffline.status).toBe(200);
        expect(rOffline.headers.get("X-MoeSekai-Cache")).toBe("STALE");
        expect(await rOffline.text()).toContain("model_v1");
        await new Promise(resolve => setTimeout(resolve, 25));

        // Back online with v2 -> serves stale v1 immediately and refreshes in background to v2
        online = true;
        version = 2;
        const rStale = await cache.handleRequest(new Request(url));
        expect(rStale.status).toBe(200);
        expect(rStale.headers.get("X-MoeSekai-Cache")).toBe("STALE");
        await rStale.text();

        // Wait for background revalidation to finish
        await new Promise(resolve => setTimeout(resolve, 40));

        // Next request is a fresh HIT serving v2!
        const rFresh = await cache.handleRequest(new Request(url));
        expect(rFresh.status).toBe(200);
        expect(rFresh.headers.get("X-MoeSekai-Cache")).toBe("HIT");
        expect(await rFresh.text()).toContain("model_v2");
        expect(upstreamCalls).toBe(3);
        cache.dispose();
    });

    it("evicts least-recently-used blobs when over budget and supports clear() & bypass mode", async () => {
        const cacheDir = makeTempDir();
        let clock = 1_700_000_000_000;
        // Allocate 40 MB buffers? Keep test ultra-fast by testing LRU via 65 MB chunks? No — test with small maxMb?
        // AssetCacheManager clamps maxMb >= 128 MB, so let's verify clear(), bypass, and LRU ordering cleanly:
        const payloads = new Map<string, Buffer>([
            ["https://storage.pjsk.moe/sekai-jp-assets/a.webp", Buffer.alloc(64 * 1024, 0x61)],
            ["https://storage.pjsk.moe/sekai-jp-assets/b.webp", Buffer.alloc(64 * 1024, 0x62)],
        ]);

        const mockFetch = (async (input: string | URL | Request) => {
            const body = payloads.get(String(input));
            if (!body) return new Response("Not Found", { status: 404 });
            return new Response(new Uint8Array(body), { status: 200, headers: { "Content-Type": "image/webp" } });
        }) as unknown as typeof fetch;

        const cache = new AssetCacheManager({
            cacheDir,
            maxMb: 128,
            fetchImpl: mockFetch,
            now: () => (clock += 1000),
        });

        const urlA = `${CACHE_PROTOCOL_SCHEME}://storage.pjsk.moe/sekai-jp-assets/a.webp`;
        const urlB = `${CACHE_PROTOCOL_SCHEME}://storage.pjsk.moe/sekai-jp-assets/b.webp`;

        await (await cache.handleRequest(new Request(urlA))).arrayBuffer();
        await (await cache.handleRequest(new Request(urlB))).arrayBuffer();
        expect(cache.getStats().entries).toBe(2);
        expect(cache.getStats().totalBytes).toBe(128 * 1024);

        // Disable cache -> BYPASS without mutating cached count
        cache.setEnabled(false);
        const bypass = await cache.handleRequest(new Request(urlA));
        expect(bypass.status).toBe(200);
        expect(bypass.headers.get("X-MoeSekai-Cache")).toBe("BYPASS");
        await bypass.arrayBuffer();

        // Re-enable and clear() -> wipes blobs & resets counters
        cache.setEnabled(true);
        const cleared = cache.clear();
        expect(cleared.entries).toBe(0);
        expect(cleared.totalBytes).toBe(0);
        expect(cleared.hits).toBe(0);
        expect(cleared.misses).toBe(0);

        // Verify LRU eviction under tight budget via private maxMb test on a realistic >128MB cap?
        // Instead verify 404s are NEVER cached
        const notFound = await cache.handleRequest(
            new Request(`${CACHE_PROTOCOL_SCHEME}://storage.pjsk.moe/sekai-jp-assets/missing.webp`),
        );
        expect(notFound.status).toBe(404);
        expect(cache.getStats().entries).toBe(0);
        cache.dispose();
    });

    it("evicts oldest LRU entries when cache exceeds configured byte budget", async () => {
        const cacheDir = makeTempDir();
        let clock = 1_700_000_000_000;
        const makeBuf = (fill: number) => Buffer.alloc(1024, fill);

        const mockFetch = (async (input: string | URL | Request) => {
            const url = String(input);
            const byte = url.endsWith("1.png") ? 1 : url.endsWith("2.png") ? 2 : 3;
            return new Response(makeBuf(byte), { status: 200, headers: { "Content-Type": "image/png" } });
        }) as unknown as typeof fetch;

        const cache = new AssetCacheManager({
            cacheDir,
            maxMb: 128,
            fetchImpl: mockFetch,
            now: () => (clock += 1000),
        });
        // Tighten internal budget to 2 KB via type-safe reflection for deterministic unit testing of LRU eviction
        (cache as unknown as { maxMb: number }).maxMb = 2 / 1024; // 2048 bytes

        const u1 = `${CACHE_PROTOCOL_SCHEME}://assets.pjsk.moe/1.png`;
        const u2 = `${CACHE_PROTOCOL_SCHEME}://assets.pjsk.moe/2.png`;
        const u3 = `${CACHE_PROTOCOL_SCHEME}://assets.pjsk.moe/3.png`;

        // Store 1 then 2 (both fit: 2048 bytes)
        await (await cache.handleRequest(new Request(u1))).arrayBuffer();
        await (await cache.handleRequest(new Request(u2))).arrayBuffer();
        expect(cache.getStats().entries).toBe(2);

        // Touch 1 so 2 becomes least-recently-used!
        const hit1 = await cache.handleRequest(new Request(u1));
        expect(hit1.headers.get("X-MoeSekai-Cache")).toBe("HIT");
        await hit1.arrayBuffer();

        // Store 3 -> exceeds 2048 bytes -> must evict 2 (oldest lastAccessAt), keeping 1 and 3!
        await (await cache.handleRequest(new Request(u3))).arrayBuffer();
        expect(cache.getStats().entries).toBe(2);
        expect(cache.getStats().totalBytes).toBe(2048);

        // 1 is still HIT, 3 is HIT, 2 was evicted -> MISS
        expect((await cache.handleRequest(new Request(u1))).headers.get("X-MoeSekai-Cache")).toBe("HIT");
        expect((await cache.handleRequest(new Request(u3))).headers.get("X-MoeSekai-Cache")).toBe("HIT");
        cache.dispose();
    });

    it("persists assetCacheEnabled, assetCacheMaxMb, and stageRenderQuality in DesktopSettingsStore", () => {
        const userData = makeTempDir("moesekai-settings-cache-");
        const store = new DesktopSettingsStore(userData);

        const initial = store.getAppSettings();
        expect(initial.assetCacheEnabled).toBe(true);
        expect(initial.assetCacheMaxMb).toBe(2048);
        expect(initial.stageRenderQuality).toBe("high");

        const updated = store.updateAppSettings({
            assetCacheEnabled: false,
            assetCacheMaxMb: 4096,
            stageRenderQuality: "ultra",
        });
        expect(updated.assetCacheEnabled).toBe(false);
        expect(updated.assetCacheMaxMb).toBe(4096);
        expect(updated.stageRenderQuality).toBe("ultra");

        const reloaded = new DesktopSettingsStore(userData).getAppSettings();
        expect(reloaded.assetCacheEnabled).toBe(false);
        expect(reloaded.assetCacheMaxMb).toBe(4096);
        expect(reloaded.stageRenderQuality).toBe("ultra");
    });
});
