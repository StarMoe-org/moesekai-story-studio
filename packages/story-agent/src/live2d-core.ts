import {
    clearLive2DClientCaches,
    clearLive2DSiteCache,
    configureStoryCore,
    getStoryCoreConfig,
    type AssetLine,
    type StoryCoreConfig,
} from "@moesekai/story-core";

const wrappedFetchBase = new WeakMap<typeof fetch, typeof fetch>();

/**
 * Records the underlying `fetch` implementation for a thin wrapper (such as an abort-signal
 * wrapper in `tools.ts`) so `runWithStoryCoreLive2D` can tell real production `globalThis.fetch`
 * apart from injected test mock fetch functions.
 */
export function tagWrappedFetch(wrapper: typeof fetch, underlying: typeof fetch): typeof fetch {
    const root = wrappedFetchBase.get(underlying) ?? underlying;
    wrappedFetchBase.set(wrapper, root);
    return wrapper;
}

function unwrapBaseFetch(fetchImpl: typeof fetch | undefined): typeof fetch | undefined {
    if (!fetchImpl) return undefined;
    return wrappedFetchBase.get(fetchImpl) ?? fetchImpl;
}

function withTimeoutFetch(baseFetch: typeof fetch, timeoutMs?: number): typeof fetch {
    if (!timeoutMs || timeoutMs <= 0) return baseFetch;
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = init?.signal
            ? AbortSignal.any([init.signal, timeoutSignal])
            : timeoutSignal;
        return baseFetch(input, { ...(init ?? {}), signal });
    }) as typeof fetch;
}

let coreLive2DQueue: Promise<void> = Promise.resolve();

export interface RunWithStoryCoreLive2DOptions {
    fetchImpl?: typeof fetch;
    line?: AssetLine;
    siteOverride?: string;
    proxyOverride?: string;
    bypassCache?: boolean;
    timeoutMs?: number;
}

/**
 * Serializes temporary `@moesekai/story-core` Live2D configuration overrides (`fetchImpl`,
 * `defaultAssetLine`, optional custom `live2dSite` / `live2dAssetProxy`, and per-request timeout)
 * around calls to `@moesekai/story-core` Live2D loaders.
 *
 * When a custom `fetchImpl` (other than `globalThis.fetch` / the already-configured core fetch)
 * or `bypassCache: true` is passed, clears `@moesekai/story-core`'s Live2D in-memory caches
 * before and after the scoped block so offline mocks and `noCache` calls stay isolated.
 */
export function runWithStoryCoreLive2D<T>(
    opts: RunWithStoryCoreLive2DOptions,
    fn: () => Promise<T>,
): Promise<T> {
    const exec = async (): Promise<T> => {
        const prev = getStoryCoreConfig();
        const underlying = unwrapBaseFetch(opts.fetchImpl);
        const isCustomFetch = Boolean(
            underlying
            && underlying !== globalThis.fetch
            && underlying !== prev.fetchImpl,
        );
        const shouldIsolateCache = Boolean(opts.bypassCache || isCustomFetch);

        const patch: Partial<StoryCoreConfig> = {};
        if (opts.fetchImpl || opts.timeoutMs) {
            const base = opts.fetchImpl ?? prev.fetchImpl ?? globalThis.fetch;
            patch.fetchImpl = withTimeoutFetch(base, opts.timeoutMs);
        }
        if (opts.line && opts.line !== prev.defaultAssetLine) {
            patch.defaultAssetLine = opts.line;
        }
        if (opts.siteOverride !== undefined) {
            const cleanOverride = opts.siteOverride.trim().replace(/\/+$/, "");
            const cleanMain = prev.assetDomainMain.trim().replace(/\/+$/, "");
            const cleanBackup = prev.assetDomainBackup.trim().replace(/\/+$/, "");
            if (cleanOverride && cleanOverride !== cleanMain && cleanOverride !== cleanBackup) {
                patch.live2dSite = cleanOverride;
            }
        }
        if (opts.proxyOverride !== undefined && opts.proxyOverride !== (prev.live2dAssetProxy ?? undefined)) {
            patch.live2dAssetProxy = opts.proxyOverride;
        }

        const hasPatch = Object.keys(patch).length > 0;
        if (shouldIsolateCache) {
            clearLive2DClientCaches();
            clearLive2DSiteCache();
        }
        if (hasPatch) {
            configureStoryCore(patch);
        }

        try {
            return await fn();
        } finally {
            if (hasPatch) {
                configureStoryCore({
                    fetchImpl: prev.fetchImpl,
                    defaultAssetLine: prev.defaultAssetLine,
                    live2dSite: prev.live2dSite,
                    live2dAssetProxy: prev.live2dAssetProxy,
                });
            }
            if (shouldIsolateCache) {
                clearLive2DClientCaches();
                clearLive2DSiteCache();
            }
        }
    };

    const run = coreLive2DQueue.then(exec, exec);
    coreLive2DQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}
