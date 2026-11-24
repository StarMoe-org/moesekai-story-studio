"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    configureStoryCore,
    createBrowserStoryExportAdapter,
    createIndexedDbStoryDraftStorageAdapter,
    getAssetLine,
    hasExplicitLive2DSite,
    live2dSources as defaultLive2dSources,
    MOE_LOGO_URL,
    normalizeLive2DSiteUrl,
    WEB_STORY_WORKSPACE_CAPABILITIES,
    type AssetLine,
    type AssetSourceType,
    type Live2DRegion,
    type Live2DSources,
    type StoryCoreConfig,
    type StoryDraftStorageAdapter,
    type StoryExportAdapter,
    type StoryRegion,
    type StoryWorkspaceCapabilities,
    type UiLocale,
} from "@moesekai/story-core";
import { StoryNoticesDialog } from "../components/StoryNoticesDialog";
import { DEFAULT_STAGE_RENDER_QUALITY, type StoryStageRenderQuality } from "../live2d/stageController";
import { Md3Provider, DefaultStudioLink, type StudioLinkComponent } from "../md3/context";
import {
    createStudioTranslator,
    normalizeStudioLocale,
    type MessageInterpolationValues,
    type StudioTranslateFn,
} from "../messages";

export interface StoryStudioContextValue {
    locale: UiLocale;
    t: StudioTranslateFn;
    assetLine: AssetLine;
    assetSource: AssetSourceType;
    defaultRegion: StoryRegion;
    LinkComponent: StudioLinkComponent;
    navigate: (href: string) => void;
    pathname?: string;
    live2dScriptBase: string | null;
    live2dScriptVersion: string | null;
    live2dCoreUrl: string | null;
    resolveLive2dSources: (region: Live2DRegion) => Live2DSources;
    sseWebScriptBase: string | null;
    brandLogoUrl: string;
    unitIconBaseUrl: string;
    themeSeed?: string;
    themeMode?: "light" | "dark";
    storage: StoryDraftStorageAdapter;
    exporter: StoryExportAdapter;
    capabilities: StoryWorkspaceCapabilities;
    /** Whether non-intrusive MoeSekai resource attribution is shown during playback/playtest. */
    showAttribution: boolean;
    /** Opens host-supplied legal/attribution notices dialog, or the built-in MD3 fallback dialog. */
    openNotices: () => void;
    /** True when the host provided a custom `onOpenNotices` handler. */
    hasCustomNoticesHandler: boolean;
    /** Live2D stage supersampling antialiasing preset (`"standard"` | `"high"` | `"ultra"`). */
    stageRenderQuality: StoryStageRenderQuality;
    /** Default auto-preload preference when the user has not explicitly saved a toggle (`true` on Desktop, `false` on Web). */
    defaultAutoPreload: boolean;
    /** Optional base URL for resolving local workspace voice audio files (e.g. Desktop `moesekai-app://app/workspace/`). */
    voiceWorkspaceBaseUrl: string | null;
}

export interface StoryStudioProviderProps {
    /** Active UI locale (`zh-CN` | `zh-TW` | `en-US` | `ja-JP` | `ko-KR`). Default: `"zh-CN"`. */
    locale?: UiLocale | string;
    /** Optional host translation function (e.g. Snowy_Viewer's `useI18n().t`). Falls back to built-in 5-locale studio dictionary. */
    t?: StudioTranslateFn;
    /** Active asset CDN line (`"main"` | `"backup"`). Derived from `assetSource` if omitted. */
    assetLine?: AssetLine;
    /** Active asset source (`"main"` | `"backup"` | `"main-jp"` | ...). Defaults to `assetLine ?? "main"`. */
    assetSource?: AssetSourceType;
    /** Default game server region when creating new stories. Default: `"jp"`. */
    defaultRegion?: StoryRegion;
    /** Custom link component (e.g. Snowy_Viewer's `LocalizedLink`). Defaults to standard `<a>`. */
    LinkComponent?: StudioLinkComponent;
    /** Custom programmatic navigation handler (e.g. Next.js `router.push` or Electron route handler). */
    navigate?: (href: string) => void;
    /** Optional current pathname to close portaled MD3 Menus on route transitions. */
    pathname?: string;
    /** Host-served base URL for Live2D viewer scripts (`stage.js`, `viewer.js`, workers, wasm). Defaults to `LIVE2D_VIEWER_PATH` (`"/live2d-viewer/"`). */
    live2dScriptBase?: string | null;
    /** Optional cache-busting query token (`?v=...`) appended when loading host-served `viewer.js` / `stage.js`. Omitted when null/unset. */
    live2dScriptVersion?: string | null;
    /** Optional override for Cubism Core for Web script URL. */
    live2dCoreUrl?: string | null;
    /** Optional custom resolver for canonical Live2D asset-site sources (`{ site, region, version?, proxy? }`) per region. */
    live2dSources?: (region: Live2DRegion) => Live2DSources;
    /** Optional base URL serving `sse-web` UI kit worker scripts. */
    sseWebScriptBase?: string | null;
    /** Optional extra runtime overrides passed to `@moesekai/story-core`'s `configureStoryCore`. */
    coreConfig?: Partial<StoryCoreConfig>;
    /** Brand logo URL rendered in immersive headers (defaults to `MOE_LOGO_URL`). */
    brandLogoUrl?: string;
    /** Base URL for unit icon `.webp` files in `Live2DModelPicker` (defaults to `"/data/icon/"`). */
    unitIconBaseUrl?: string;
    /** Optional MD3 theme seed (character seed ID). */
    themeSeed?: string;
    /** Optional MD3 color mode (`"light"` | `"dark"`). */
    themeMode?: "light" | "dark";
    /** Storage adapter for drafts (defaults to IndexedDB `moesekai-story-maker-v2`). */
    storage?: StoryDraftStorageAdapter;
    /** Export adapter for `.msk`, `.i18n.json`, and full bundles (defaults to browser download). */
    exporter?: StoryExportAdapter;
    /** Host capabilities metadata. */
    capabilities?: StoryWorkspaceCapabilities;
    /** Optional host callback when user clicks resource attribution / legal notices (falls back to built-in MD3 dialog). */
    onOpenNotices?: () => void;
    /** Whether to display non-intrusive MoeSekai resource attribution on stage & ending cards. Default: `true`. */
    showAttribution?: boolean;
    /** Live2D stage SSAA render quality preset (`"standard"` | `"high"` | `"ultra"`). Default: `"high"`. */
    stageRenderQuality?: StoryStageRenderQuality;
    /** Default auto-preload preference when user has not explicitly toggled it. Defaults to `true` for desktop hosts, `false` for web. */
    defaultAutoPreload?: boolean;
    /** Optional base URL for resolving local workspace voice clips (e.g. Desktop `moesekai-app://app/workspace/`). */
    voiceWorkspaceBaseUrl?: string | null;
    children: React.ReactNode;
}

const defaultStorage = createIndexedDbStoryDraftStorageAdapter();
const defaultExporter = createBrowserStoryExportAdapter();
const defaultT = createStudioTranslator("zh-CN");

function defaultNavigate(href: string): void {
    if (typeof window !== "undefined") {
        window.location.assign(href);
    }
}

function noopOpenNotices(): void {
    // No-op default outside <StoryStudioProvider>
}

const StoryStudioContext = createContext<StoryStudioContextValue>({
    locale: "zh-CN",
    t: defaultT,
    assetLine: "main",
    assetSource: "main",
    defaultRegion: "jp",
    LinkComponent: DefaultStudioLink,
    navigate: defaultNavigate,
    pathname: undefined,
    live2dScriptBase: null,
    live2dScriptVersion: null,
    live2dCoreUrl: null,
    resolveLive2dSources: defaultLive2dSources,
    sseWebScriptBase: null,
    brandLogoUrl: MOE_LOGO_URL,
    unitIconBaseUrl: "/data/icon/",
    storage: defaultStorage,
    exporter: defaultExporter,
    capabilities: WEB_STORY_WORKSPACE_CAPABILITIES,
    showAttribution: true,
    openNotices: noopOpenNotices,
    hasCustomNoticesHandler: false,
    stageRenderQuality: DEFAULT_STAGE_RENDER_QUALITY,
    defaultAutoPreload: false,
    voiceWorkspaceBaseUrl: null,
});

export function StoryStudioProvider({
    locale = "zh-CN",
    t: hostT,
    assetLine,
    assetSource,
    defaultRegion = "jp",
    LinkComponent = DefaultStudioLink,
    navigate = defaultNavigate,
    pathname,
    live2dScriptBase = null,
    live2dScriptVersion = null,
    live2dCoreUrl = null,
    live2dSources: customLive2dSources,
    sseWebScriptBase = null,
    coreConfig,
    brandLogoUrl = MOE_LOGO_URL,
    unitIconBaseUrl = "/data/icon/",
    themeSeed,
    themeMode,
    storage = defaultStorage,
    exporter = defaultExporter,
    capabilities = WEB_STORY_WORKSPACE_CAPABILITIES,
    onOpenNotices,
    showAttribution = true,
    stageRenderQuality = DEFAULT_STAGE_RENDER_QUALITY,
    defaultAutoPreload,
    voiceWorkspaceBaseUrl = null,
    children,
}: StoryStudioProviderProps) {
    const normalizedLocale = normalizeStudioLocale(locale) as UiLocale;
    const resolvedAssetSource: AssetSourceType = assetSource ?? assetLine ?? "main";
    const resolvedAssetLine: AssetLine = assetLine ?? getAssetLine(resolvedAssetSource);
    const resolvedDefaultAutoPreload = defaultAutoPreload ?? (capabilities.host === "desktop");
    const [builtinNoticesOpen, setBuiltinNoticesOpen] = useState(false);
    const onOpenNoticesRef = useRef(onOpenNotices);
    onOpenNoticesRef.current = onOpenNotices;
    const hasCustomNoticesHandler = typeof onOpenNotices === "function";

    const openNotices = useCallback(() => {
        if (onOpenNoticesRef.current) {
            onOpenNoticesRef.current();
        } else {
            setBuiltinNoticesOpen(true);
        }
    }, []);

    const builtinT = useMemo(() => createStudioTranslator(normalizedLocale), [normalizedLocale]);
    const t = useMemo<StudioTranslateFn>(() => {
        if (!hostT) return builtinT;
        return (key: string, values?: MessageInterpolationValues) => {
            const out = hostT(key, values);
            return out === key ? builtinT(key, values) : out;
        };
    }, [builtinT, hostT]);

    // Sync runtime overrides into @moesekai/story-core so pure helpers (assets, uiKit, live2d) pick them up.
    useEffect(() => {
        const patch: Partial<StoryCoreConfig> = {
            ...(coreConfig ?? {}),
            defaultAssetLine: resolvedAssetLine,
            defaultRegion,
        };
        if (live2dCoreUrl !== undefined && live2dCoreUrl !== null) {
            patch.live2dCoreUrl = live2dCoreUrl;
        }
        if (sseWebScriptBase !== undefined && sseWebScriptBase !== null) {
            patch.sseWebScriptBase = sseWebScriptBase;
        }
        configureStoryCore(patch);
    }, [coreConfig, defaultRegion, live2dCoreUrl, resolvedAssetLine, sseWebScriptBase]);

    const resolveLive2dSources = useCallback(
        (region: Live2DRegion): Live2DSources => {
            if (customLive2dSources) return customLive2dSources(region);
            const base = defaultLive2dSources(region, resolvedAssetLine);
            const explicitSite = coreConfig?.live2dSite?.trim();
            const domainOverride = !explicitSite && !hasExplicitLive2DSite()
                ? (resolvedAssetLine === "backup" ? coreConfig?.assetDomainBackup : coreConfig?.assetDomainMain)?.trim()
                : undefined;
            const rawSiteOverride = explicitSite || domainOverride;
            const rawProxyOverride = coreConfig?.live2dAssetProxy?.trim() || coreConfig?.sseWebAssetProxy?.trim();
            return {
                ...base,
                ...(rawSiteOverride ? { site: normalizeLive2DSiteUrl(rawSiteOverride) } : {}),
                ...(rawProxyOverride
                    ? { proxy: rawProxyOverride.endsWith("/") ? rawProxyOverride : `${rawProxyOverride}/` }
                    : {}),
            };
        },
        [coreConfig, customLive2dSources, resolvedAssetLine],
    );

    const value = useMemo<StoryStudioContextValue>(
        () => ({
            locale: normalizedLocale,
            t,
            assetLine: resolvedAssetLine,
            assetSource: resolvedAssetSource,
            defaultRegion,
            LinkComponent,
            navigate,
            pathname,
            live2dScriptBase,
            live2dScriptVersion,
            live2dCoreUrl,
            resolveLive2dSources,
            sseWebScriptBase,
            brandLogoUrl,
            unitIconBaseUrl: unitIconBaseUrl.endsWith("/") ? unitIconBaseUrl : `${unitIconBaseUrl}/`,
            themeSeed,
            themeMode,
            storage,
            exporter,
            capabilities,
            showAttribution,
            openNotices,
            hasCustomNoticesHandler,
            stageRenderQuality,
            defaultAutoPreload: resolvedDefaultAutoPreload,
            voiceWorkspaceBaseUrl,
        }),
        [
            brandLogoUrl,
            capabilities,
            defaultRegion,
            exporter,
            hasCustomNoticesHandler,
            LinkComponent,
            live2dCoreUrl,
            live2dScriptBase,
            live2dScriptVersion,
            navigate,
            normalizedLocale,
            openNotices,
            pathname,
            resolvedAssetLine,
            resolvedAssetSource,
            resolvedDefaultAutoPreload,
            resolveLive2dSources,
            showAttribution,
            sseWebScriptBase,
            stageRenderQuality,
            storage,
            t,
            themeMode,
            themeSeed,
            unitIconBaseUrl,
            voiceWorkspaceBaseUrl,
        ],
    );

    return (
        <StoryStudioContext.Provider value={value}>
            <Md3Provider t={t} LinkComponent={LinkComponent} pathname={pathname}>
                {children}
                {!hasCustomNoticesHandler && (
                    <StoryNoticesDialog
                        isOpen={builtinNoticesOpen}
                        onClose={() => setBuiltinNoticesOpen(false)}
                    />
                )}
            </Md3Provider>
        </StoryStudioContext.Provider>
    );
}

export function useStoryStudio(): StoryStudioContextValue {
    return useContext(StoryStudioContext);
}

export function useStoryI18n(): { t: StudioTranslateFn; locale: UiLocale } {
    const { t, locale } = useContext(StoryStudioContext);
    return { t, locale };
}
