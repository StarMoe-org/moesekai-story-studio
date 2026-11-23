import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
    DESKTOP_STORY_WORKSPACE_CAPABILITIES,
    WEB_STORY_WORKSPACE_CAPABILITIES,
    addCastMember,
    clearLive2DSiteCache,
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
    hasExplicitLive2DSite,
    inspectStoryCacheStatus,
    live2dCoreUrl,
    live2dListingUrl,
    live2dModelsFromListings,
    live2dSiteListingUrl,
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

    test("configureStoryCore supports moesekai-cache://, moesekai-app://, and relative / sites while rejecting untrusted schemes", () => {
        try {
            configureStoryCore({
                assetDomainMain: "moesekai-cache://storage.pjsk.moe",
                assetDomainBackup: "moesekai-cache://storage.exmeaning.com",
                masterDataDomainMain: "moesekai-cache://metadata.pjsk.moe",
                masterDataDomainBackup: "moesekai-cache://metadata.exmeaning.com",
                live2dCoreUrl: "moesekai-app://app/live2d-viewer/live2dcubismcore.min.js",
                live2dAssetProxy: "moesekai-cache://proxy.local/relay/",
                sseWebSite: "moesekai-cache://storage.pjsk.moe/",
                sseWebFontBase: "moesekai-app://app/story-fonts/",
            });

            assert.deepEqual(live2dSources("jp"), {
                site: "moesekai-cache://storage.pjsk.moe",
                region: "jp",
                proxy: "moesekai-cache://proxy.local/relay/",
            });
            assert.equal(hasExplicitLive2DSite(), false);
            assert.equal(
                live2dListingUrl("jp", "live2d/model/"),
                "moesekai-cache://storage.pjsk.moe/jp/live2d/model/",
            );
            assert.equal(
                live2dSiteListingUrl(live2dSources("jp"), "live2d/model"),
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

            // Relative asset site paths (`/assets/` and `/`) are accepted cleanly
            configureStoryCore({ live2dSite: "/assets/", live2dAssetProxy: null });
            assert.equal(hasExplicitLive2DSite(), true);
            assert.deepEqual(live2dSources("jp"), { site: "/assets", region: "jp" });
            assert.equal(live2dSiteListingUrl(live2dSources("jp"), "live2d/model/"), "/assets/jp/live2d/model/");

            configureStoryCore({ live2dSite: "/" });
            assert.deepEqual(live2dSources("jp"), { site: "/", region: "jp" });
            assert.equal(live2dSiteListingUrl(live2dSources("jp"), "live2d/model/"), "/jp/live2d/model/");

            // Restore proxy for sseWeb/uiKit checks
            configureStoryCore({ live2dSite: "", live2dAssetProxy: "moesekai-cache://proxy.local/relay/" });

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

            // Untrusted schemes, protocol-relative URLs, and path traversals must still be rejected
            configureStoryCore({ live2dSite: "javascript://evil.test/foo/" });
            assert.throws(() => live2dSources("jp"), /live2d_viewer_config_invalid/);

            configureStoryCore({ live2dSite: "//evil.test/storage" });
            assert.throws(() => live2dSources("jp"), /live2d_viewer_config_invalid/);

            configureStoryCore({
                live2dSite: "",
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
                live2dSite: "moesekai-cache://storage.pjsk.moe/sekai/../etc/",
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
        const VERSION = "7.1.0-desktop-test";

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

        const requestedUrls: string[] = [];
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            requestedUrls.push(url);
            if (init?.method === "HEAD") {
                const hdrs = new Headers(init.headers);
                headProbes.push({ url, probeHeader: hdrs.get("X-MoeSekai-Cache-Probe") });
                const isKanade = url.includes("v2_17kanade_casual") && url.endsWith("/moc.moc3");
                return new Response(null, {
                    status: isKanade ? 200 : 204,
                    headers: { "X-MoeSekai-Cache": isKanade ? "HIT" : "MISS" },
                });
            }
            if (url === "moesekai-cache://storage.pjsk.moe/jp/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        published_version: VERSION,
                        directories: ["live2d"],
                        files: [],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "HIT" } },
                );
            }
            // Nested directory discovery for Kanade (with sibling form:"text" doc that must be ignored!)
            if (url === `moesekai-cache://storage.pjsk.moe/jp@${VERSION}/live2d/model/v2_17kanade_casual/`) {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: [],
                        files: [
                            { name: "kanade.moc3.asset.json", extension: "json" },
                            { name: "buildmodeldata.asset.json", extension: "json" },
                        ],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "HIT" } },
                );
            }
            if (url === `moesekai-cache://storage.pjsk.moe/jp@${VERSION}/live2d/model/v2_17kanade_casual/buildmodeldata.asset.json`) {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/model/v2_17kanade_casual/buildmodeldata",
                        form: "live2d-model",
                        members: [
                            { role: "moc", extension: "moc3" },
                            { role: "texture/0", extension: "png" },
                            { role: "motion/model_owned_ignored", extension: "json" },
                        ],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "HIT" } },
                );
            }
            // Exact nested `.asset.json` path for Mafuyu (e.g. from pre-resolved index)
            if (url === `moesekai-cache://storage.pjsk.moe/jp@${VERSION}/live2d/model/v2_18mafuyu_casual/buildmodeldata.asset.json`) {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/model/v2_18mafuyu_casual/buildmodeldata",
                        form: "live2d-model",
                        members: [{ role: "moc", extension: "moc3" }],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json", "X-MoeSekai-Cache": "MISS" } },
                );
            }
            if (url.endsWith(".asset.json")) {
                return new Response("Not Found", { status: 404 });
            }
            const hit = url.includes("v2_17kanade_casual") || url.includes("bgm00020");
            return new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "X-MoeSekai-Cache": hit ? "HIT" : "MISS" },
            });
        }) as typeof fetch;

        try {
            clearLive2DSiteCache();
            clearPreloaderSessionCache();
            configureStoryCore({
                assetDomainMain: "moesekai-cache://storage.pjsk.moe",
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

            const models = live2dModelsFromListings(["v2_17kanade_casual", "v2_18mafuyu_casual"], []).map(m =>
                m.id === "v2_18mafuyu_casual"
                    ? { ...m, asset: "live2d/model/v2_18mafuyu_casual/buildmodeldata" }
                    : m,
            );

            // 1. Cold-start inspectStoryCacheStatus probes resolved versioned moc URLs via HEAD with 0 404 `.asset.json` probes
            const before = await inspectStoryCacheStatus(doc, { models, includeUiKit: true });
            assert.equal(
                requestedUrls.some(u => u.endsWith("/v2_17kanade_casual.asset.json") || u.endsWith("/v2_18mafuyu_casual.asset.json")),
                false,
            );
            assert.equal(headProbes.length, 2);
            assert.ok(headProbes.every(p => p.probeHeader === "1"));
            assert.ok(headProbes.every(p => p.url.startsWith(`moesekai-cache://storage.pjsk.moe/jp@${VERSION}/`)));
            assert.ok(headProbes.every(p => p.url.endsWith("/moc.moc3")));
            assert.equal(before.live2dCachedModels, 1);
            assert.equal(before.live2dTotalModels, 2);
            assert.equal(before.hasLocalCache, false);

            // 2. preloadStoryAssets skips Cache Storage API, ignores model-owned motion/*,
            //    classifies X-MoeSekai-Cache: HIT as cached, and omits unsupported UI Kit cleanly
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
                    assert.ok(prefixes.every(p => p.startsWith(`moesekai-cache://storage.pjsk.moe/jp@${VERSION}/`)));
                    return prefixes.map(() => true);
                },
            });
            const viaHook = await inspectStoryCacheStatus(doc, { models, includeUiKit: true });
            assert.equal(prefixCalls, 1);
            assert.equal(viaHook.live2dCachedModels, 2);
            assert.equal(viaHook.hasLocalCache, true);
        } finally {
            clearLive2DSiteCache();
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
