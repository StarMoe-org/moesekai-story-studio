import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
    DESKTOP_STORY_WORKSPACE_CAPABILITIES,
    WEB_STORY_WORKSPACE_CAPABILITIES,
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
    live2dCoreUrl,
    live2dListingUrl,
    live2dSources,
    parseStoryScript,
    prepareMskExport,
    resetStoryCoreConfig,
    resolveStoryUiKitSources,
    serializeStoryScript,
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
