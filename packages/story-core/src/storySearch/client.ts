import type {
    CorpusLoadProgress,
    CorpusStatusInfo,
    StoryChunk,
    StoryChunkType,
    StorySearchHit,
    StorySearchServer,
} from "./types";

interface WorkerResponse {
    reqId: number;
    type?: "progress";
    phase?: CorpusLoadProgress["phase"];
    server?: StorySearchServer;
    loadedBytes?: number;
    totalBytes?: number;
    ok?: boolean;
    data?: unknown;
    error?: string;
}

interface PendingCall {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onProgress?: (progress: CorpusLoadProgress) => void;
}

export interface StorySearchWorkerClientOptions {
    /** Explicit URL to the story-search web worker script. */
    workerUrl?: string | URL;
    /** Custom Worker factory (takes precedence over `workerUrl`). */
    createWorker?: () => Worker;
}

export class StorySearchWorkerClient {
    private worker: Worker | null = null;
    private seq = 0;
    private pending = new Map<number, PendingCall>();
    private readonly options: StorySearchWorkerClientOptions;

    constructor(options: StorySearchWorkerClientOptions = {}) {
        this.options = options;
    }

    private ensureWorker(): Worker {
        if (!this.worker) {
            if (this.options.createWorker) {
                this.worker = this.options.createWorker();
            } else if (this.options.workerUrl) {
                this.worker = new Worker(this.options.workerUrl, { type: "module" });
            } else {
                throw new Error(
                    "StorySearchWorkerClient requires either `createWorker` or `workerUrl` option.",
                );
            }
            this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const msg = event.data;
                const entry = this.pending.get(msg.reqId);
                if (!entry) return;

                if (msg.type === "progress" && msg.phase && msg.server) {
                    entry.onProgress?.({
                        phase: msg.phase,
                        server: msg.server,
                        loadedBytes: msg.loadedBytes,
                        totalBytes: msg.totalBytes,
                    });
                    return;
                }

                this.pending.delete(msg.reqId);
                if (msg.ok) {
                    entry.resolve(msg.data);
                } else {
                    entry.reject(new Error(msg.error || "Worker error"));
                }
            };
            this.worker.onerror = (event) => {
                const err = new Error(event.message || "Story search worker crashed");
                for (const [, entry] of this.pending) {
                    entry.reject(err);
                }
                this.pending.clear();
                this.worker?.terminate();
                this.worker = null;
            };
        }
        return this.worker;
    }

    private call<T>(
        type: string,
        payload: unknown,
        onProgress?: (progress: CorpusLoadProgress) => void,
    ): Promise<T> {
        const worker = this.ensureWorker();
        const reqId = ++this.seq;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(reqId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                onProgress,
            });
            worker.postMessage({ reqId, type, payload });
        });
    }

    loadCorpus(
        server: StorySearchServer,
        options?: { forceRefresh?: boolean; onProgress?: (progress: CorpusLoadProgress) => void },
    ): Promise<CorpusStatusInfo> {
        return this.call<CorpusStatusInfo>(
            "loadCorpus",
            { server, forceRefresh: options?.forceRefresh ?? false },
            options?.onProgress,
        );
    }

    searchLocal(params: {
        server: StorySearchServer;
        query: string;
        isRegex: boolean;
        caseSensitive: boolean;
        type?: StoryChunkType | "all";
        charIds?: number[];
        limit?: number;
    }): Promise<{ hits: StorySearchHit[]; totalMatches: number; searchMs: number }> {
        return this.call("searchLocal", params);
    }

    lookupChunks(server: StorySearchServer, ids: number[]): Promise<Record<number, StoryChunk>> {
        return this.call("lookupChunks", { server, ids });
    }

    clearCache(server?: StorySearchServer): Promise<{ cleared: boolean }> {
        return this.call("clearCache", { server });
    }

    dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pending.clear();
    }
}
