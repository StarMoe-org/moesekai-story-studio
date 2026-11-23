import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
    DESKTOP_STORY_WORKSPACE_CAPABILITIES,
    WEB_STORY_WORKSPACE_CAPABILITIES,
    addCastMember,
    clearPreloaderSessionCache,
    configureStoryCore,
    createBrowserStoryExportAdapter,
    createIndexedDbDraftStorage,
    createIndexedDbStoryDraftStorageAdapter,
    createNode,
    createStarterStoryFromScript,
    createStoryDocument,
    getAssetBaseUrl,
    getStoryCoreConfig,
    hasExplicitLive2DIndexBase,
    inspectStoryCacheStatus,
    live2dCoreUrl,
    live2dListingUrl,
    live2dModelsFromListings,
    live2dSources,
    parseStoryScript,
    preloadStoryAssets,
    prepareMskExport,
    resetStoryCoreConfig,
    resolveStoryUiKitSources,
    serializeStoryScript,
    setSceneBackground,
    setSceneBgm,
    setSceneStageCast,
    sseWebFonts,
    sseWebSources,
    storyBackgroundUrl,
    storyBgmUrl,
    stripMskPositions,
} from "../src/index";

describe("host contracts & .msk export preflight", () => {
    test("WEB and DESKTOP capability descriptors expose expected host flags", () => {
        assert.equal(WEB_STORY_WORKSPACE_CAPABILITIES.host, "web");
        assert.equal(WEB_STORY_WORKSPACE_CAPABILITIES.localFilesystem, false);
        assert.equal(WEB_STORY_WORKSPACE_CAPABILITIES.communityPublish, true);
        assert.equal(WEB_STORY_WORKSPACE_CAPABILITIES.communityAudioUpload, true);
        assert.equal(WEB_STORY_WORKSPACE_CAPABILITIES.agentAutomation, false);

        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.host, "desktop");
        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.localFilesystem, true);
        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.externalWatch, true);
        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.nativeExport, true);
        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.agentAutomation, true);
        assert.equal(DESKTOP_STORY_WORKSPACE_CAPABILITIES.localVoiceDirectory, true);
    });

    test("serializeStoryScript({ includePositions: false }) and stripMskPositions omit @pos cleanly and round-trip", () => {
        const doc = createStarterStoryFromScript("jp", "zh");
        const withPos = serializeStoryScript(doc);
        assert.ok(withPos.includes("@pos("), "default serialization preserves @pos coordinates");

        const withoutPos = serializeStoryScript(doc, { includePositions: false });
        assert.equal(withoutPos.includes("@pos("), false, "includePositions: false omits all @pos coordinates");

        const stripped = stripMskPositions(withPos);
        assert.equal(stripped, withoutPos);

        const reparsed = parseStoryScript(stripped);
        assert.equal(reparsed.ok, true);
        if (reparsed.ok) {
            assert.equal(Object.keys(reparsed.doc.nodes).length, Object.keys(doc.nodes).length);
            assert.equal(reparsed.doc.edges.length, doc.edges.length);
            assert.equal(reparsed.doc.cast.length, doc.cast.length);
        }
    });

    test("prepareMskExport validates, compiles, strips positions on request, and returns rich metadata summary", () => {
        const doc = createStarterStoryFromScript("jp", "en");
        const clean = prepareMskExport(doc, { stripPositions: true, strict: true });

        assert.equal(clean.ok, true);
        assert.equal(clean.strictOk, true);
        assert.equal(clean.errors.length, 0);
        assert.equal(clean.warnings.length, 0);
        assert.equal(clean.issues.length, 0);
        assert.equal(clean.script.includes("@pos("), false);
        assert.ok(clean.filename.endsWith(".msk"));
        assert.equal(clean.summary.strippedPositions, true);
        assert.equal(clean.summary.region, "jp");
        assert.ok(clean.summary.nodeCount >= 4);
        assert.ok(clean.summary.beatCount >= 3);
        assert.ok(clean.summary.endingCount >= 1);
        assert.ok(clean.summary.byteLength > 100);
        assert.ok(clean.summary.lineCount > 10);

        // Accepts raw .msk string input directly as well
        const fromScript = prepareMskExport(clean.script, { stripPositions: false, strict: true });
        assert.equal(fromScript.ok, true);
        assert.equal(fromScript.strictOk, true);
        assert.equal(fromScript.script.includes("@pos("), true);
        assert.equal(fromScript.summary.strippedPositions, false);
    });

    test("prepareMskExport distinguishes warnings from errors under strict vs non-strict modes", () => {
        let doc = createStarterStoryFromScript("jp", "ja");
        // Add an isolated unreachable scene -> compiler warning (nodeUnreachable + sceneEmptyBeats), 0 errors
        doc = createNode(doc, "scene", { x: 900, y: 900 }, { id: "iso_draft", title: "Draft" }).doc;

        const relaxed = prepareMskExport(doc, { strict: false });
        assert.equal(relaxed.ok, true);
        assert.equal(relaxed.strictOk, false);
        assert.equal(relaxed.errors.length, 0);
        assert.ok(relaxed.warnings.length >= 1);

        const strict = prepareMskExport(doc, { strict: true });
        assert.equal(strict.ok, false);
        assert.equal(strict.strictOk, false);

        // Blank unwired document -> startDisconnected error fails both relaxed and strict
        const blank = createStoryDocument("cn", "Empty");
        const broken = prepareMskExport(blank, { strict: false });
        assert.equal(broken.ok, false);
        assert.ok(broken.errors.length >= 1);
    });

    test("configureStoryCore overrides CDN domains and default line cleanly", () => {
        try {
            assert.equal(getStoryCoreConfig().assetDomainMain, "https://storage.pjsk.moe");
            assert.equal(
                storyBackgroundUrl("bg_a000401", "jp"),
                "https://storage.pjsk.moe/sekai-jp-assets/scenario/background/bg_a000401/bg_a000401.webp",
            );

            configureStoryCore({
                assetDomainMain: "https://cdn.example.test",
                defaultAssetLine: "backup",
            });

            assert.equal(getAssetBaseUrl("main-jp"), "https://cdn.example.test/sekai-jp-assets");
            assert.equal(
                storyBgmUrl("bgm00020", "jp"),
                "https://storage.exmeaning.com/sekai-jp-assets/sound/scenario/bgm/bgm00020/bgm00020.mp3",
            );
        } finally {
            resetStoryCoreConfig();
        }
    });

    test("configureStoryCore supports moesekai-cache:// and moesekai-app:// protocols while rejecting untrusted schemes", () => {
        try {
            configureStoryCore({
                assetDomainMain: "moesekai-cache://storage.pjsk.moe",
                assetDomainBackup: "moesekai-cache://storage.exmeaning.com",
                masterDataDomainMain: "moesekai-cache://metadata.pjsk.moe",
                masterDataDomainBackup: "moesekai-cache://metadata.exmeaning.com",
                live2dLibraryBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/",
                live2dIndexBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-live2d/",
                live2dCoreUrl: "moesekai-app://app/live2d-viewer/live2dcubismcore.min.js",
                live2dAssetProxy: "moesekai-cache://proxy.local/relay/",
                sseWebSite: "moesekai-cache://storage.pjsk.moe/",
                sseWebFontBase: "moesekai-app://app/story-fonts/",
            });

            assert.equal(
                live2dSources("jp").library,
                "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/jp/",
            );
            assert.equal(
                live2dSources("jp").index,
                "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-live2d/jp/models.json",
            );
            // Rewriting the default index base through moesekai-cache:// should not trigger redundant models.json probes
            assert.equal(hasExplicitLive2DIndexBase(), false);
            assert.equal(
                live2dListingUrl("jp", "live2d/model/"),
                "moesekai-cache://storage.pjsk.moe/jp/live2d/model/",
            );
            assert.equal(
                live2dCoreUrl(),
                "moesekai-app://app/live2d-viewer/live2dcubismcore.min.js",
            );
            assert.equal(
                storyBackgroundUrl("bg_a000401", "jp"),
                "moesekai-cache://storage.pjsk.moe/sekai-jp-assets/scenario/background/bg_a000401/bg_a000401.webp",
            );

            const sseSources = sseWebSources("jp");
            assert.ok(sseSources);
            assert.equal(sseSources.site, "moesekai-cache://storage.pjsk.moe/");
            assert.equal(sseSources.proxy, undefined);

            const uiKitSources = resolveStoryUiKitSources("jp");
            assert.ok(uiKitSources);
            assert.equal(uiKitSources.site, "moesekai-cache://storage.pjsk.moe/");
            assert.equal(uiKitSources.proxy, "moesekai-cache://proxy.local/relay/");

            const fonts = sseWebFonts("jp");
            assert.ok(fonts);
            assert.ok(fonts.body[0].url.startsWith("moesekai-app://app/story-fonts/"));

            // Untrusted schemes and path traversals must still be rejected
            configureStoryCore({ live2dLibraryBase: "javascript://evil.test/foo/" });
            assert.throws(() => live2dSources("jp"), /live2d_viewer_config_invalid/);

            configureStoryCore({
                live2dLibraryBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/",
                sseWebSite: "http://evil.example.com/",
            });
            assert.throws(() => sseWebSources("jp"), /sse_web_config_invalid/);

            configureStoryCore({
                sseWebSite: "moesekai-cache://storage.pjsk.moe/",
                live2dAssetProxy: "file:///etc/",
            });
            assert.equal(resolveStoryUiKitSources("jp")?.proxy, undefined);

            configureStoryCore({
                live2dAssetProxy: null,
                live2dLibraryBase: "moesekai-cache://assets.pjsk.moe/sekai/../etc/",
            });
            assert.throws(() => live2dSources("jp"), /live2d_viewer_config_invalid/);
        } finally {
            resetStoryCoreConfig();
        }
    });

    test("preloadStoryAssets and inspectStoryCacheStatus support moesekai-cache:// disk cache and omit unsupported UI Kit cleanly", async () => {
        const prevCaches = globalThis.caches;
        let cacheOpenCalls = 0;
        const headProbes: Array<{ url: string; probeHeader: string | null }> = [];

        // Simulate Chromium Cache Storage rejecting non-http(s) URLs
        (globalThis as Record<string, unknown>).caches = {
            has: async () => false,
            open: async () => {
                cacheOpenCalls += 1;
                return {
                    match: async (k: string) => {
                        if (!/^https?:\/\//i.test(k)) throw new TypeError("Request scheme 'moesekai-cache' is unsupported");
                        return undefined;
                    },
                    put: async (k: string) => {
                        if (!/^https?:\/\//i.test(k)) throw new TypeError("Request scheme 'moesekai-cache' is unsupported");
                    },
                    keys: async () => [],
                };
            },
        };

        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (init?.method === "HEAD") {
                const hdrs = new Headers(init.headers);
                headProbes.push({ url, probeHeader: hdrs.get("X-MoeSekai-Cache-Probe") });
                const isKanade = url.includes("v2_17kanade_casual");
                return new Response(null, {
                    status: isKanade ? 200 : 204,
                    headers: { "X-MoeSekai-Cache": isKanade ? "HIT" : "MISS" },
                });
            }
            if (url.endsWith("/v2_17kanade_casual/_ripper.json")) {
                return new Response(
                    JSON.stringify({ crc: 111, files: [{ path: "model.moc3", kind: "model" }, { path: "tex.png", kind: "texture" }] }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "HIT" } },
                );
            }
            if (url.endsWith("/v2_18mafuyu_casual/_ripper.json")) {
                return new Response(
                    JSON.stringify({ crc: 222, files: [{ path: "model.moc3", kind: "model" }] }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "MISS" } },
                );
            }
            const hit = url.includes("v2_17kanade_casual") || url.includes("bgm00020");
            return new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "X-MoeSekai-Cache": hit ? "HIT" : "MISS" },
            });
        }) as typeof fetch;

        try {
            clearPreloaderSessionCache();
            configureStoryCore({
                assetDomainMain: "moesekai-cache://storage.pjsk.moe",
                live2dLibraryBase: "moesekai-cache://assets.pjsk.moe/sekai-extra-assets/sekai-story/ripper/",
                fetchImpl: mockFetch,
            });

            let doc = createStoryDocument("jp", "Desktop Cache Preload");
            doc = addCastMember(doc, { key: "kanade", modelId: "v2_17kanade_casual", name: "Kanade" });
            doc = addCastMember(doc, { key: "mafuyu", modelId: "v2_18mafuyu_casual", name: "Mafuyu" });
            doc = createNode(doc, "scene", { x: 200, y: 100 }, { id: "s1" }).doc;
            doc = setSceneBackground(doc, "s1", { mode: "set", asset: "bg_a000401" });
            doc = setSceneBgm(doc, "s1", { mode: "play", name: "bgm00020", volume: 1 });
            doc = setSceneStageCast(doc, "s1", {
                mode: "set",
                actors: [
                    { castKey: "kanade", slot: "left" },
                    { castKey: "mafuyu", slot: "right" },
                ],
            });

            const models = live2dModelsFromListings(["v2_17kanade_casual", "v2_18mafuyu_casual"], []);

            // 1. Cold-start inspectStoryCacheStatus probes `moesekai-cache://` via zero-network HEAD
            const before = await inspectStoryCacheStatus(doc, { models, includeUiKit: true });
            assert.equal(headProbes.length, 2);
            assert.ok(headProbes.every(p => p.probeHeader === "1"));
            assert.equal(before.live2dCachedModels, 1);
            assert.equal(before.live2dTotalModels, 2);
            assert.equal(before.hasLocalCache, false);

            // 2. preloadStoryAssets skips Cache Storage API, classifies X-MoeSekai-Cache: HIT as cached,
            //    and omits unsupported UI Kit without counting it as failed (failed === 0!)
            const progress = await preloadStoryAssets(doc, { models, includeUiKit: true, decodeAudio: false });
            assert.equal(cacheOpenCalls, 0);
            assert.equal(progress.done, true);
            assert.equal(progress.failed, 0);
            assert.equal(progress.byCategory.uikit.total, 0);
            assert.equal(progress.byCategory.live2d.total, 3);
            assert.equal(progress.byCategory.live2d.cached, 2);
            assert.equal(progress.byCategory.audio.total, 1);
            assert.equal(progress.byCategory.audio.cached, 1);

            // 3. Post-preload inspectStoryCacheStatus sees all 2 models warmed & hasLocalCache = true
            const after = await inspectStoryCacheStatus(doc, { models, includeUiKit: true });
            assert.equal(after.live2dCachedModels, 2);
            assert.equal(after.hasLocalCache, true);

            // 4. Custom checkCachedUrlPrefixes hook overrides HEAD probe when configured by host
            clearPreloaderSessionCache();
            let prefixCalls = 0;
            configureStoryCore({
                checkCachedUrlPrefixes: (prefixes) => {
                    prefixCalls += 1;
                    return prefixes.map(() => true);
                },
            });
            const viaHook = await inspectStoryCacheStatus(doc, { models, includeUiKit: true });
            assert.equal(prefixCalls, 1);
            assert.equal(viaHook.live2dCachedModels, 2);
            assert.equal(viaHook.hasLocalCache, true);
        } finally {
            clearPreloaderSessionCache();
            resetStoryCoreConfig();
            (globalThis as Record<string, unknown>).caches = prevCaches;
        }
    });

    test("adapter factories expose complete method surfaces", () => {
        const storage = createIndexedDbStoryDraftStorageAdapter();
        const storageAlias = createIndexedDbDraftStorage();
        assert.equal(typeof storage.listDrafts, "function");
        assert.equal(typeof storage.getDraft, "function");
        assert.equal(typeof storage.createDraft, "function");
        assert.equal(typeof storage.saveDraft, "function");
        assert.equal(typeof storage.renameDraft, "function");
        assert.equal(typeof storage.duplicateDraft, "function");
        assert.equal(typeof storage.deleteDraft, "function");
        assert.equal(typeof storageAlias.listDrafts, "function");

        const exporter = createBrowserStoryExportAdapter();
        assert.equal(typeof exporter.exportMsk, "function");
        assert.equal(typeof exporter.exportLocalePack, "function");
        assert.equal(typeof exporter.exportVoiceManifest, "function");
    });
});
