import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getMimeType } from "../shared/path-jail.ts";

export const CACHE_PROTOCOL_SCHEME = "moesekai-cache";

/**
 * Strict host allowlist for persistent remote asset caching.
 * ONLY these public read-only PJSK / MoeSekai / Live2D CDN hosts may be proxied and cached.
 */
export const ALLOWED_CACHE_HOSTS: ReadonlySet<string> = new Set([
    "assets.pjsk.moe",
    "storage.pjsk.moe",
    "metadata.pjsk.moe",
    "storage.exmeaning.com",
    "translation.exmeaning.com",
    "metadata.exmeaning.com",
    "moe.exmeaning.com",
    "cubism.live2d.com",
]);

export type AssetCacheCategory = "live2d" | "audio" | "image" | "metadata" | "ui" | "other";

export interface AssetCacheIndexEntry {
    url: string;
    sha256: string;
    contentType: string;
    etag: string | null;
    size: number;
    storedAt: number;
    lastAccessAt: number;
    category: AssetCacheCategory;
}

interface AssetCacheIndexFile {
    version: 1;
    entries: Record<string, AssetCacheIndexEntry>;
}

export interface AssetCacheStats {
    enabled: boolean;
    maxMb: number;
    entries: number;
    totalBytes: number;
    hits: number;
    misses: number;
    staleHits: number;
    cacheDir: string;
}

export interface AssetCacheManagerOptions {
    cacheDir: string;
    maxMb?: number;
    enabled?: boolean;
    fetchImpl?: typeof fetch;
    now?: () => number;
    immutableTtlMs?: number;
    dynamicTtlMs?: number;
    maxSingleAssetBytes?: number;
}

const DEFAULT_MAX_MB = 2048;
const MIN_MAX_MB = 128;
const MAX_MAX_MB = 16384;
const DEFAULT_IMMUTABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_DYNAMIC_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_SINGLE_ASSET_BYTES = 128 * 1024 * 1024; // 128 MB safety cap per asset

function clampMaxMb(mb: number): number {
    if (!Number.isFinite(mb)) return DEFAULT_MAX_MB;
    return Math.max(MIN_MAX_MB, Math.min(MAX_MAX_MB, Math.round(mb)));
}

function sha256Hex(data: Uint8Array): string {
    return crypto.createHash("sha256").update(data).digest("hex");
}

function classifyAsset(upstreamUrl: URL): { category: AssetCacheCategory; isDynamic: boolean } {
    const host = upstreamUrl.hostname.toLowerCase();
    const pathname = upstreamUrl.pathname.toLowerCase();

    if (
        host === "metadata.pjsk.moe" ||
        host === "metadata.exmeaning.com" ||
        host === "translation.exmeaning.com" ||
        pathname.endsWith("/") ||
        pathname.endsWith("/models.json") ||
        pathname.endsWith("/soundtrack.json") ||
        pathname.endsWith("/ripper.lock.json")
    ) {
        return { category: "metadata", isDynamic: true };
    }

    if (
        host === "cubism.live2d.com" ||
        pathname.includes("/live2d/") ||
        pathname.includes("/sekai-story/ripper/") ||
        pathname.includes("/sekai-live2d/") ||
        pathname.endsWith(".moc3") ||
        pathname.endsWith(".motion3.json") ||
        pathname.endsWith(".physics3.json") ||
        pathname.endsWith(".model3.json") ||
        pathname.endsWith(".cdi3.json") ||
        pathname.endsWith("_ripper.json")
    ) {
        return { category: "live2d", isDynamic: false };
    }

    if (/\.(mp3|ogg|wav|m4a|aac|flac)$/.test(pathname)) {
        return { category: "audio", isDynamic: false };
    }

    if (/\.(png|webp|jpg|jpeg|svg|gif)$/.test(pathname)) {
        return { category: "image", isDynamic: false };
    }

    if (/\.(ttf|otf|woff|woff2|wasm|js|mjs|css)$/.test(pathname) || pathname.includes("/client/")) {
        return { category: "ui", isDynamic: false };
    }

    if (pathname.endsWith(".json")) {
        return { category: "metadata", isDynamic: true };
    }

    return { category: "other", isDynamic: false };
}

/**
 * Parses and strictly validates a `moesekai-cache://<host>/<path>?<query>` URL,
 * returning the corresponding `https://` upstream URL or throwing a status-tagged error.
 */
export function resolveCacheUpstreamUrl(rawUrl: string): URL {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
        throw new CacheSecurityError(400, "Empty cache URL.");
    }
    // Reject traversal & backslashes BEFORE WHATWG `new URL()` collapses `..` segments
    if (/[\\]|(?:^|\/)\.\.?(?:\/|[?#]|$)|%2e%2e/i.test(rawUrl)) {
        throw new CacheSecurityError(403, "Path traversal segments are not allowed in cache URLs.");
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new CacheSecurityError(400, `Malformed cache URL: ${rawUrl}`);
    }

    if (parsed.protocol !== `${CACHE_PROTOCOL_SCHEME}:`) {
        throw new CacheSecurityError(403, `Unsupported cache protocol: ${parsed.protocol}`);
    }

    if (parsed.username || parsed.password || parsed.port) {
        throw new CacheSecurityError(403, "Credentials and custom ports are not allowed in cache URLs.");
    }

    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_CACHE_HOSTS.has(host)) {
        throw new CacheSecurityError(403, `Host is not in the MoeSekai cache allowlist: ${host}`);
    }

    const segments = parsed.pathname.split("/");
    if (segments.some(seg => seg === ".." || seg === ".")) {
        throw new CacheSecurityError(403, "Path traversal segments are not allowed in cache URLs.");
    }

    return new URL(`https://${host}${parsed.pathname}${parsed.search}`);
}

export class CacheSecurityError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "CacheSecurityError";
    }
}

interface ParsedRange {
    start: number;
    end: number;
}

function parseByteRange(rangeHeader: string | null, totalSize: number): ParsedRange | "invalid" | null {
    if (!rangeHeader) return null;
    const trimmed = rangeHeader.trim();
    const match = trimmed.match(/^bytes=(\d*)-(\d*)$/i);
    if (!match) return null;

    const [, startStr, endStr] = match;
    if (!startStr && !endStr) return "invalid";
    if (totalSize <= 0) return "invalid";

    if (!startStr && endStr) {
        // Suffix byte range: bytes=-500
        const suffixLen = Number.parseInt(endStr, 10);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0) return "invalid";
        const start = Math.max(0, totalSize - suffixLen);
        return { start, end: totalSize - 1 };
    }

    const start = Number.parseInt(startStr, 10);
    const end = endStr ? Math.min(Number.parseInt(endStr, 10), totalSize - 1) : totalSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
        return "invalid";
    }
    return { start, end };
}

interface UpstreamFetchOutcome {
    kind: "stored";
    entry: AssetCacheIndexEntry;
}

interface UpstreamNotModifiedOutcome {
    kind: "not-modified";
    entry: AssetCacheIndexEntry;
}

interface UpstreamPassthroughOutcome {
    kind: "passthrough";
    status: number;
    contentType: string;
    body: Buffer;
}

type FetchOutcome = UpstreamFetchOutcome | UpstreamNotModifiedOutcome | UpstreamPassthroughOutcome;

/**
 * Persistent content-addressed disk cache for Live2D models, Cubism Core,
 * PJSK backgrounds, BGM, SE, voices, UI Kit, and directory listings.
 */
export class AssetCacheManager {
    readonly cacheDir: string;
    private readonly blobsDir: string;
    private readonly indexPath: string;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly immutableTtlMs: number;
    private readonly dynamicTtlMs: number;
    private readonly maxSingleAssetBytes: number;

    private enabled: boolean;
    private maxMb: number;
    private entries = new Map<string, AssetCacheIndexEntry>();
    private totalBytes = 0;
    private hits = 0;
    private misses = 0;
    private staleHits = 0;

    private readonly inFlight = new Map<string, Promise<FetchOutcome>>();
    private readonly revalidating = new Set<string>();
    private readonly activeBlobReads = new Map<string, number>();
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private indexDirty = false;
    private disposed = false;

    constructor(options: AssetCacheManagerOptions) {
        this.cacheDir = path.resolve(options.cacheDir);
        this.blobsDir = path.join(this.cacheDir, "blobs");
        this.indexPath = path.join(this.cacheDir, "index.json");
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now = options.now ?? (() => Date.now());
        this.immutableTtlMs = options.immutableTtlMs ?? DEFAULT_IMMUTABLE_TTL_MS;
        this.dynamicTtlMs = options.dynamicTtlMs ?? DEFAULT_DYNAMIC_TTL_MS;
        this.maxSingleAssetBytes = options.maxSingleAssetBytes ?? DEFAULT_MAX_SINGLE_ASSET_BYTES;
        this.enabled = options.enabled !== false;
        this.maxMb = clampMaxMb(options.maxMb ?? DEFAULT_MAX_MB);

        fs.mkdirSync(this.blobsDir, { recursive: true });
        this.loadIndex();
    }

    private getBlobPath(sha256: string): string {
        return path.join(this.blobsDir, sha256.slice(0, 2), sha256);
    }

    private loadIndex(): void {
        this.entries.clear();
        this.totalBytes = 0;
        if (!fs.existsSync(this.indexPath)) return;

        try {
            const raw = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as Partial<AssetCacheIndexFile>;
            if (raw && raw.entries && typeof raw.entries === "object") {
                for (const [key, entry] of Object.entries(raw.entries)) {
                    if (
                        !entry ||
                        typeof entry.url !== "string" ||
                        typeof entry.sha256 !== "string" ||
                        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
                        typeof entry.size !== "number" ||
                        !Number.isFinite(entry.size) ||
                        entry.size < 0
                    ) {
                        continue;
                    }
                    const blobPath = this.getBlobPath(entry.sha256);
                    if (!fs.existsSync(blobPath)) {
                        this.indexDirty = true;
                        continue;
                    }
                    this.entries.set(key, {
                        url: entry.url,
                        sha256: entry.sha256,
                        contentType: typeof entry.contentType === "string" && entry.contentType
                            ? entry.contentType
                            : "application/octet-stream",
                        etag: typeof entry.etag === "string" ? entry.etag : null,
                        size: entry.size,
                        storedAt: typeof entry.storedAt === "number" ? entry.storedAt : this.now(),
                        lastAccessAt: typeof entry.lastAccessAt === "number" ? entry.lastAccessAt : this.now(),
                        category: entry.category ?? "other",
                    });
                }
            }
        } catch {
            // Corrupt index -> recover cleanly from empty state
            this.entries.clear();
            this.indexDirty = true;
        }

        this.recomputeTotalBytes();
        if (this.indexDirty) {
            this.flushIndexNow();
        }
    }

    private recomputeTotalBytes(): void {
        const countedBlobs = new Map<string, number>();
        for (const entry of this.entries.values()) {
            if (!countedBlobs.has(entry.sha256)) {
                countedBlobs.set(entry.sha256, entry.size);
            }
        }
        let sum = 0;
        for (const sz of countedBlobs.values()) sum += sz;
        this.totalBytes = sum;
    }

    private scheduleIndexSave(): void {
        this.indexDirty = true;
        if (this.disposed || this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.flushIndexNow();
        }, 250);
    }

    flushIndexNow(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.indexDirty && fs.existsSync(this.indexPath)) return;

        fs.mkdirSync(this.cacheDir, { recursive: true });
        const payload: AssetCacheIndexFile = {
            version: 1,
            entries: Object.fromEntries(this.entries.entries()),
        };
        const tmpPath = `${this.indexPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
        fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
        fs.renameSync(tmpPath, this.indexPath);
        this.indexDirty = false;
    }

    private isBlobReferenced(sha256: string): boolean {
        for (const entry of this.entries.values()) {
            if (entry.sha256 === sha256) return true;
        }
        return false;
    }

    private deleteUnreferencedBlob(sha256: string): void {
        if (this.isBlobReferenced(sha256)) return;
        if ((this.activeBlobReads.get(sha256) ?? 0) > 0) return;
        const blobPath = this.getBlobPath(sha256);
        try {
            if (fs.existsSync(blobPath)) {
                fs.unlinkSync(blobPath);
            }
        } catch {
            // Best-effort cleanup
        }
    }

    private retainBlobRead(sha256: string): () => void {
        this.activeBlobReads.set(sha256, (this.activeBlobReads.get(sha256) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = (this.activeBlobReads.get(sha256) ?? 1) - 1;
            if (next <= 0) {
                this.activeBlobReads.delete(sha256);
                // Perform any deferred unlink once last reader finishes
                this.deleteUnreferencedBlob(sha256);
            } else {
                this.activeBlobReads.set(sha256, next);
            }
        };
    }

    private evictIfOverBudget(): void {
        const budgetBytes = this.maxMb * 1024 * 1024;
        if (this.totalBytes <= budgetBytes) return;

        const sorted = Array.from(this.entries.entries()).sort(
            (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
        );

        for (const [key, entry] of sorted) {
            if (this.totalBytes <= budgetBytes) break;
            this.entries.delete(key);
            this.deleteUnreferencedBlob(entry.sha256);
            this.recomputeTotalBytes();
        }
        this.scheduleIndexSave();
    }

    getStats(): AssetCacheStats {
        return {
            enabled: this.enabled,
            maxMb: this.maxMb,
            entries: this.entries.size,
            totalBytes: this.totalBytes,
            hits: this.hits,
            misses: this.misses,
            staleHits: this.staleHits,
            cacheDir: this.cacheDir,
        };
    }

    setMaxMb(mb: number): AssetCacheStats {
        this.maxMb = clampMaxMb(mb);
        this.evictIfOverBudget();
        this.flushIndexNow();
        return this.getStats();
    }

    setEnabled(enabled: boolean): AssetCacheStats {
        this.enabled = Boolean(enabled);
        return this.getStats();
    }

    clear(): AssetCacheStats {
        this.entries.clear();
        this.totalBytes = 0;
        this.hits = 0;
        this.misses = 0;
        this.staleHits = 0;
        this.revalidating.clear();
        try {
            fs.rmSync(this.blobsDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
        fs.mkdirSync(this.blobsDir, { recursive: true });
        this.indexDirty = true;
        this.flushIndexNow();
        return this.getStats();
    }

    dispose(): void {
        this.disposed = true;
        this.flushIndexNow();
    }

    private storeBlob(
        upstreamUrl: URL,
        body: Buffer,
        contentType: string,
        etag: string | null,
        category: AssetCacheCategory,
    ): AssetCacheIndexEntry {
        const key = upstreamUrl.href;
        const sha256 = sha256Hex(body);
        const blobPath = this.getBlobPath(sha256);
        const subdir = path.dirname(blobPath);
        fs.mkdirSync(subdir, { recursive: true });

        if (!fs.existsSync(blobPath)) {
            const tmpPath = `${blobPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
            fs.writeFileSync(tmpPath, body);
            try {
                fs.renameSync(tmpPath, blobPath);
            } catch {
                // Another writer may have raced on identical content-addressed blob
                try {
                    fs.unlinkSync(tmpPath);
                } catch {
                    // ignore
                }
            }
        }

        const prev = this.entries.get(key);
        const ts = this.now();
        const entry: AssetCacheIndexEntry = {
            url: key,
            sha256,
            contentType,
            etag,
            size: body.byteLength,
            storedAt: ts,
            lastAccessAt: ts,
            category,
        };
        this.entries.set(key, entry);

        if (prev && prev.sha256 !== sha256) {
            this.deleteUnreferencedBlob(prev.sha256);
        }

        this.recomputeTotalBytes();
        this.evictIfOverBudget();
        this.scheduleIndexSave();
        return entry;
    }

    private fetchUpstreamCoalesced(
        upstreamUrl: URL,
        existingEntry?: AssetCacheIndexEntry,
    ): Promise<FetchOutcome> {
        const key = upstreamUrl.href;
        const inflightExisting = this.inFlight.get(key);
        if (inflightExisting) {
            return inflightExisting;
        }

        const promise = (async (): Promise<FetchOutcome> => {
            const headers: Record<string, string> = {
                "User-Agent": "MoeSekai-Story-Studio-Cache/1.0",
            };
            if (existingEntry?.etag) {
                headers["If-None-Match"] = existingEntry.etag;
            }

            const res = await this.fetchImpl(key, {
                method: "GET",
                headers,
                redirect: "follow",
            });

            if (res.url && !res.url.startsWith("https://")) {
                throw new CacheSecurityError(502, `Refused non-HTTPS upstream redirect: ${res.url}`);
            }

            if (res.status === 304 && existingEntry) {
                const ts = this.now();
                existingEntry.storedAt = ts;
                existingEntry.lastAccessAt = ts;
                this.entries.set(key, existingEntry);
                this.scheduleIndexSave();
                return { kind: "not-modified", entry: existingEntry };
            }

            const arrayBuf = await res.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            const fallbackMime = getMimeType(upstreamUrl.pathname);
            const contentType = res.headers.get("content-type")?.trim() || fallbackMime;

            if (res.status !== 200 || buf.byteLength > this.maxSingleAssetBytes) {
                return {
                    kind: "passthrough",
                    status: res.status,
                    contentType,
                    body: buf,
                };
            }

            const { category } = classifyAsset(upstreamUrl);
            const etag = res.headers.get("etag");
            const stored = this.storeBlob(upstreamUrl, buf, contentType, etag, category);
            return { kind: "stored", entry: stored };
        })().finally(() => {
            this.inFlight.delete(key);
        });

        this.inFlight.set(key, promise);
        return promise;
    }

    private triggerBackgroundRevalidate(upstreamUrl: URL, existing: AssetCacheIndexEntry): void {
        const key = upstreamUrl.href;
        if (this.revalidating.has(key) || this.disposed) return;
        this.revalidating.add(key);
        void this.fetchUpstreamCoalesced(upstreamUrl, existing)
            .catch(() => {
                // Offline or transient upstream failure: keep serving stale cache cleanly
            })
            .finally(() => {
                this.revalidating.delete(key);
            });
    }

    private buildResponseFromEntry(
        request: Request,
        entry: AssetCacheIndexEntry,
        cacheStatus: "HIT" | "MISS" | "STALE",
    ): Response {
        const blobPath = this.getBlobPath(entry.sha256);
        const stat = fs.statSync(blobPath);
        const totalSize = stat.size;

        const headers = new Headers({
            "Content-Type": entry.contentType,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, X-MoeSekai-Cache, ETag",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "X-MoeSekai-Cache": cacheStatus,
        });
        if (entry.etag) {
            headers.set("ETag", entry.etag);
        }

        if (request.method === "HEAD") {
            headers.set("Content-Length", String(totalSize));
            return new Response(null, { status: 200, headers });
        }

        const parsedRange = parseByteRange(request.headers.get("range"), totalSize);
        if (parsedRange === "invalid") {
            headers.set("Content-Range", `bytes */${totalSize}`);
            return new Response("Range Not Satisfiable", { status: 416, headers });
        }

        if (parsedRange) {
            const { start, end } = parsedRange;
            const chunkLength = end - start + 1;
            headers.set("Content-Range", `bytes ${start}-${end}/${totalSize}`);
            headers.set("Content-Length", String(chunkLength));
            if (chunkLength <= 4 * 1024 * 1024) {
                const fd = fs.openSync(blobPath, "r");
                try {
                    const slice = Buffer.alloc(chunkLength);
                    fs.readSync(fd, slice, 0, chunkLength, start);
                    return new Response(new Uint8Array(slice), { status: 206, headers });
                } finally {
                    fs.closeSync(fd);
                }
            }
            const release = this.retainBlobRead(entry.sha256);
            const nodeStream = fs.createReadStream(blobPath, { start, end });
            nodeStream.once("close", release);
            nodeStream.once("error", release);
            const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
            return new Response(webStream, { status: 206, headers });
        }

        headers.set("Content-Length", String(totalSize));
        if (totalSize <= 4 * 1024 * 1024) {
            const data = fs.readFileSync(blobPath);
            return new Response(new Uint8Array(data), { status: 200, headers });
        }
        const release = this.retainBlobRead(entry.sha256);
        const nodeStream = fs.createReadStream(blobPath);
        nodeStream.once("close", release);
        nodeStream.once("error", release);
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
        return new Response(webStream, { status: 200, headers });
    }

    /**
     * Handles an Electron `protocol.handle("moesekai-cache", ...)` request.
     */
    async handleRequest(request: Request): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                    "Access-Control-Allow-Headers": "Range, Accept, Content-Type",
                },
            });
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method Not Allowed", { status: 405 });
        }

        let upstreamUrl: URL;
        try {
            upstreamUrl = resolveCacheUpstreamUrl(request.url);
        } catch (err) {
            if (err instanceof CacheSecurityError) {
                return new Response(err.message, {
                    status: err.status,
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }
            return new Response("Bad Request", { status: 400 });
        }

        // Bypass mode when user explicitly disables persistent asset cache
        if (!this.enabled) {
            try {
                const res = await this.fetchImpl(upstreamUrl.href, {
                    method: request.method,
                    headers: request.headers.get("range")
                        ? { Range: request.headers.get("range")! }
                        : undefined,
                    redirect: "follow",
                });
                const headers = new Headers(res.headers);
                headers.set("Access-Control-Allow-Origin", "*");
                headers.set("Cross-Origin-Resource-Policy", "cross-origin");
                headers.set("X-MoeSekai-Cache", "BYPASS");
                return new Response(request.method === "HEAD" ? null : res.body, {
                    status: res.status,
                    headers,
                });
            } catch (err) {
                return new Response(err instanceof Error ? err.message : "Upstream fetch failed", {
                    status: 502,
                    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
                });
            }
        }

        const key = upstreamUrl.href;
        const { isDynamic } = classifyAsset(upstreamUrl);
        const ttlMs = isDynamic ? this.dynamicTtlMs : this.immutableTtlMs;
        const existing = this.entries.get(key);

        if (existing) {
            const blobPath = this.getBlobPath(existing.sha256);
            if (fs.existsSync(blobPath)) {
                const ageMs = this.now() - existing.storedAt;
                existing.lastAccessAt = this.now();
                this.scheduleIndexSave();

                if (ageMs <= ttlMs) {
                    this.hits += 1;
                    return this.buildResponseFromEntry(request, existing, "HIT");
                }

                // Stale-while-revalidate: build response from existing blob FIRST, then refresh in background!
                this.staleHits += 1;
                const staleResponse = this.buildResponseFromEntry(request, existing, "STALE");
                this.triggerBackgroundRevalidate(upstreamUrl, existing);
                return staleResponse;
            }

            // Missing blob on disk: purge stale metadata and treat as miss
            this.entries.delete(key);
            this.recomputeTotalBytes();
            this.scheduleIndexSave();
        }

        // Cache MISS -> coalesced upstream fetch
        this.misses += 1;
        try {
            const outcome = await this.fetchUpstreamCoalesced(upstreamUrl);
            if (outcome.kind === "stored" || outcome.kind === "not-modified") {
                return this.buildResponseFromEntry(request, outcome.entry, "MISS");
            }
            const headers = new Headers({
                "Content-Type": outcome.contentType,
                "Content-Length": String(outcome.body.byteLength),
                "Access-Control-Allow-Origin": "*",
                "Cross-Origin-Resource-Policy": "cross-origin",
                "X-MoeSekai-Cache": "MISS",
            });
            return new Response(request.method === "HEAD" ? null : new Uint8Array(outcome.body), {
                status: outcome.status,
                headers,
            });
        } catch (err) {
            const status = err instanceof CacheSecurityError ? err.status : 502;
            return new Response(err instanceof Error ? err.message : "Upstream fetch failed", {
                status,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }
    }
}
