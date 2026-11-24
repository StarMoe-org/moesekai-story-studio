# Changelog

All notable changes to **MoeSekai Story Studio** (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`, and the Desktop application) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this monorepo adheres to lockstep [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-25

### Changed
- **Auto-Collapse Agent Tool Call Errors (`apps/desktop`)**:
  - Updated `groupToolCalls`, `tool_end`, `settleUnfinishedTools`, and session hydration in `agent-panel-state.ts` and `PiAgentPanel.tsx` so occasional failed tool calls auto-collapse by default and fold cleanly into the same contiguous finished-tool summary group instead of splitting the activity timeline with expanded error cards.
  - Added a subtle failed-call count badge (`agentToolsErrorBadge` across all 5 locales: `zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`) on collapsed tool groups while preserving click-to-expand access to full error summaries and JSON arguments/details on individual rows.

## [0.3.0] - 2026-11-24

### Added
- **Live2D Stage Choreography, Enter/Exit Timing & Telop Layering (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`, Skill)**:
  - Added scene cast enter timing (`enterTiming: "immediate" | "afterTelop"` compiling to `enterScene(deferStageCast)` + `applyStageCast`), configurable `enterDelay` / `enterDuration` / `enterTransition` (`"fade" | "instant"`), scene `layoutMode: "auto" | "fixed"`, per-actor fine placement (`x`, `lockX`, `mirror`), and telop presentation controls (`actorVisibility: "keep" | "dim" | "hide"` and `position: "center" | "top" | "bottom"`).
  - Added simultaneous multi-actor choreography waves via `StageActionBeat.group` (`stage sync [ ...; ... ]`) and `parallel: true` beat chaining, backed by `choreographyRunner.ts` and a refactored `StoryStageController` with an arriving-actor load barrier, lockstep `Promise.all` leaving/moving/arriving animations, cancellable per-actor delays, and `actorAlphaScale` fading/restoration.
  - Added lossless `.msk` parser/serializer support (including explicit `fade`/`instant`, `lock=false`/`mirror=false`, and cross-wave `actorDuplicate` checking), updated agent prompts/presets/tools/validator (`getStageActionItems`), and rebuilt the standalone `skills/moesekai-story-script` validator bundle (`msk-core.mjs`).
- **Workbench Fine-Tuning Sliders & Direct Stage Dragging (`@moesekai/story-editor`)**:
  - Upgraded `NodeInspector` with visible fine-tune (`mdTune`) toggles, `X` / `Y` / `scale` / `z` sliders + numeric inputs + resets, `lockX` / `mirror` / `allowOverlap` switches, scene cast timing & telop layering controls (plus 1-click `deferStageCastAfterTelop` banner), and multi-actor `group[]` editing with full 5-locale parity (`zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`).
  - Added Edit-mode direct pointer dragging on the stage (`StoryStageView` 5-slot guides + draggable actor pills + `commitStageActorDrag` in `StoryStudioEditor`), multi-actor beat summaries in `StoryFlowCanvas` & `LivePhasePanel`, and an Exit Stage Action quick-drop tile in `StoryEditorBin`.
- **Voice Track Cue Sheets, Local Preview & Desktop Voice Manager (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`, `apps/desktop`)**:
  - Added CSV/TXT/JSON voice cue-sheet builders (`buildVoiceCueSheetCsv`, `buildVoiceCueSheetText`, `buildVoiceCueSheetJson`), `overrideOfficialVoice` playback precedence, and safe local workspace / `blob:` URL opt-ins in `StoryVoiceManifest` parsing and preloading.
  - Added `<VoiceCueSheetExportBar>`, upgraded `<StoryVoiceManifestDialog>` and `<AssetPreloadPanel>` with mid-scene voice playback/override reconciliation, and added Desktop `<DesktopVoiceManagerPanel>` with batch voice file/folder/buffer import IPC (`importVoiceFiles`, `listVoiceFiles`, `saveVoiceManifest`, `openVoicesDir`) and workspace/ZIP exporter bundling.

### Fixed
- **Stable Incremental Anti-Overlap Layout (`@moesekai/story-core`)**:
  - Replaced full-stage re-centering on every stage action with incremental layout (`applyStageActionWave` + weighted PAV Phase 2 fallback respecting hard-pinned `lockX` / explicit `x` actors) so stationary actors remain completely fixed (`Δx === 0`) when other actors enter, exit, or pose, and audited overlaps against actual resolved `actor.x`.
- **Story Hub Draft Creation & Dialog History Sync (`@moesekai/story-editor`)**:
  - Added `prependStoryDraft` deduplication in `StoryStudioHub` and disabled history popstate syncing (`syncHistory={false}`) on Hub create/import dialogs (`StoryMetaDialog`, `StoryImportDialog`) so closing modals after draft creation never unwinds router navigation.

## [0.2.2] - 2026-11-24

### Added
- **Video-Site Theater Shell & Controlled Player Layout (`@moesekai/story-editor`)**:
  - Extended `StoryStudioPlayerSlots` with `belowStage` and single-mount `companionPanel` slots (stacked inline below the stage on `< lg` viewports and docked as an independently scrollable collapsible right rail `lg:w-[380px] xl:w-[420px]` on `lg:+` Theater View, auto-hidden in Director Workspace without unmounting `<StoryPlayerView>` or resetting WebGPU).
  - Added optional controlled `layoutMode` support (plus `initialLayoutMode` re-sync on source changes) on `StoryStudioPlayerProps`, optional companion rail controls on `PlayerTopBarSlotContext`, `hasBelowStageContent` on `StoryPlayerViewProps`, 5-locale side-panel strings (`zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`), and pure layout/ending helpers (`resolveEffectivePlayerLayoutMode`, `resolvePlayerCompanionVisibility`, `resolvePlayerStageLayout`, `shouldPromoteReplayTransport`, `shouldShowPlayerStageAttribution`) with regression unit tests.

### Fixed
- **Mobile Player Top Bar, Theater Stage Letterboxing & Ending Replay UX (`@moesekai/story-editor`)**:
  - Fixed mobile immersive `<header>` logo overlap and right-edge button clipping (`overflow-hidden` left cluster, compact wordmark without `< sm` BETA badge collision, `iconOnly` mode switcher below `md:`, and secondary actions folded into the `...` overflow menu on `< sm:`).
  - Scoped `isImmersiveTheaterFill` letterboxing to `lg:+` standalone Theater View and capped video-site desktop stage height so mobile `< lg` Theater View renders a clean `aspect-video w-full` stage with zero vertical gray dead bands, and removed `max-w-full` on non-immersive `<PageContainer>` so `wide` / `max-w-7xl` constraints hold.
  - Fixed mobile "Ending Reached" scrolling friction by rendering a compact non-scrolling Replay stage scrim + unclipped inline ending summary card below the transport bar on `< sm:`, refactoring desktop/fullscreen ending and compile-error overlays to sticky non-scrolling action footers (`z-[32]`, Quick Menu `z-[35]`, watermark suppressed at ending), and promoting the primary transport CTA to active filled `Replay` when playback finishes.

## [0.2.1] - 2026-11-24

### Fixed
- **Zero-404 Live2D Asset Resolution & Canonical Form Listings (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`, Skill)**:
  - Consumes `sekai-serve` canonical form listings (`/listings/<region>/canonical[@<version>]/live2d-{model,motions}`) with automatic 404 fallback to directory listings, resolving models and motion sets directly to their exact `buildmodeldata` / `buildmotiondata` asset paths in one request instead of 6-level directory walks.
  - Added explicit trailing-`/` directory handling in `resolveLive2DAssetDocument` and standalone `official-story.mjs` (skipping guaranteed-404 `<container>.asset.json` probes), exported `live2dDirectoryPath`, `live2dAssetRequestPath`, `live2dFormListingUrl`, and `fetchLive2DFormListing` from `@moesekai/story-core` (keeping `Live2DModel.{asset,motion,motions}` bare for backwards compatibility), and rebuilt `skills/moesekai-story-script/scripts/lib/msk-core.mjs`.
  - Updated `StoryStageController` to pass version-matched exact asset paths (or trailing-`/` directory fallbacks on stale `not-found` / legacy servers) to `SekaiLive2DStage`, and synced `StoryPreloader` `sekai-live2d-v2` resolution pointers (`?sekai-asset-resolve=<form>`) with `SekaiLive2DViewer 0.3.1`.

### Changed
- **Desktop Host `SekaiLive2DViewer 0.3.1` & Listings Caching (`apps/desktop`)**: Upgraded vendored `apps/desktop/vendor/live2d-viewer/` verbatim to `SekaiLive2DViewer 0.3.1` (`61055e0c5f94`, `dirty: false`) and updated `AssetCacheManager` (`moesekai-cache://`) to classify version-pinned `/listings/<region>/<view>@<version>[/<form>]` as immutable metadata and unpinned `/listings/` routes as dynamic metadata.

## [0.2.0] - 2026-11-24

### Breaking Changes
- **Retired `assets.pjsk.moe` Live2D Library Contracts (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`)**: Removed legacy `live2dLibraryBase` / `live2dIndexBase` / `libraryBaseUrl` options, `models.json` / `_ripper.json` / `ripper.lock` parsers, `sekai-live2d-v1` cache keys, and `model.bytes` fields in favor of canonical `Live2DSources` (`{ site, region, version?, proxy? }`) and `model.asset` / `model.motion` references.
- **Host-Served Live2D Viewer Runtime (`@moesekai/story-editor`)**: Removed bundled `SekaiLive2DViewer` WASM/worker assets and the `./live2d-viewer/*` subpath export from `@moesekai/story-editor`. Host applications now serve their own vendored `SekaiLive2DViewer` release and configure `live2dScriptBase` (with optional `live2dScriptVersion` and `live2dSources`) via `<StoryStudioProvider>`.

### Added
- **Unified Canonical `storage.pjsk.moe` Live2D Module (`@moesekai/story-core`)**: Consolidated Live2D site configuration (`live2dSite`, `live2dSources`, `normalizeLive2DSiteUrl`), published-version resolution, directory listing, model/motion pairing, sub-character naming, clip catalog loading, and client utilities into `@moesekai/story-core` as the single source of truth across Web, Desktop, Agent, and CLI skills, with automatic `storage.pjsk.moe` (main) / `storage.exmeaning.com` (backup) switching and ESM `"default"` export conditions.
- **Desktop Host `SekaiLive2DViewer 0.3.0` (`apps/desktop`)**: Vendored `SekaiLive2DViewer 0.3.0` (`8f0235c97ec5`) under `apps/desktop/vendor/live2d-viewer/` and wired Desktop's `moesekai-app://` host protocol, Vite dev server, and `electron-builder` packaging to serve `viewer.js`, `stage.js`, workers, and WASM directly.

### Changed
- **Live2D Asset-Site Migration Across Preloader, Agent, Exporter & Skill**: Migrated `StoryPreloader` (`sekai-live2d-v2`), `@moesekai/story-agent` live validator & official story tooling, Desktop `.msk` exporter, and `skills/moesekai-story-script` (`official-story.mjs`, `validate-msk.mjs`, `msk-core.mjs`) to canonical `storage.pjsk.moe` `live2d/model` and `live2d/motion` endpoints, with graceful fallback when a host serves a viewer release without `stage.js`. *(Note: the `sekai-story-search` endpoint remains unchanged.)*
- **Desktop Disk Asset Cache Allowlist & Stale Pruning (`apps/desktop`)**: Removed retired `assets.pjsk.moe` from the `moesekai-cache://` persistent disk cache host allowlist and added automatic pruning of legacy `assets.pjsk.moe` cache entries and orphan blobs on index load.

## [0.1.4] - 2026-11-23

### Added
- **Translucent Official MoeSekai SVG Watermark (`@moesekai/story-editor`)**: Replaced the dark stage text pill with a delicate translucent inline `MoeSekaiWordmarkSvg` (`opacity: 0.32` -> `0.85` on hover/focus) with a portaled MD3 tooltip and direct Notices dialog trigger.
- **Desktop Preloading Parity (`@moesekai/story-core`, `@moesekai/story-editor`, Desktop)**: Added `moesekai-cache://` Cache API bypass, `X-MoeSekai-Cache: HIT|STALE` detection, zero-network `HEAD` cache probing (`X-MoeSekai-Cache-Probe: 1`), `isStoryUiKitSupported()` graceful skip for hosts without `kit-worker.js`, default automatic background preloading on Desktop, and a compact Player top-bar preload status indicator.
- **MoeSekai Agent UX & Provider Icons (`apps/desktop`)**: Replaced the empty-state quick-action cards with a clean 3-step minimalist usage guide and added 12 centered zero-network inline SVG provider icons (`ProviderIcon`: OpenAI, Anthropic/Claude, Google/Gemini, DeepSeek, Qwen, xAI/Grok, OpenRouter, Mistral, Ollama, Moonshot/Kimi, Zhipu/GLM, and Custom) across the model picker and Settings dialog.

### Fixed
- **Multi-Actor Live2D Loading & Progress Bar (`@moesekai/story-editor`)**: Fixed missing actors caused by mid-fade `alpha: 0` supersede (`AppliedActor.alpha` tracking + restoration) and worker state drift, parallelized arriving scene actors (`Promise.all` batch loading), and added aggregate multi-actor progress reporting (`StoryStageLoadProgress` + MD3 `<LinearProgress>`) so the loading indicator remains visible until every actor settles.
- **Windows Concurrent Asset Cache Hardening (`apps/desktop`)**: Serialized `index.json` flushes with Windows `EPERM`/`EBUSY` resilience, switched to UUID temp files, and returned independent in-memory buffers on cache misses so concurrent Live2D fetches never fail on disk locks.

## [0.1.3] - 2026-11-23

### Added
- **Persistent Disk Asset Cache (`moesekai-cache://`, Desktop + `@moesekai/story-core`)**: Added a content-addressed local disk cache (`AssetCacheManager`) for Live2D models, textures, motions, backgrounds, BGM, SE, voices, UI Kit, and directory listings with strict host allowlisting, traversal/redirect guards, in-flight request coalescing, HTTP `Range` (`206`) audio seeking, stale-while-revalidate offline fallback, configurable LRU budget (`512 MB` – `4 GB`), and custom protocol support in `@moesekai/story-core`.
- **Live2D Stage SSAA Antialiasing (`@moesekai/story-editor` + Desktop)**: Added `StoryStageRenderQuality` (`standard` / `high` / `ultra`, defaulting to `high` adaptive SSAA with a `1280×720` minimum internal floor and live serialized resize) across `<StoryStudioProvider>`, `StoryStageController`, and Desktop preferences.
- **Non-Intrusive MoeSekai Attribution & Legal Notices (`@moesekai/story-editor` + Desktop)**: Added a subtle top-right stage attribution pill and Ending Card credit in the Story Player (`showAttribution`, `onOpenNotices`, and built-in `<StoryNoticesDialog>` fallback for standalone/Web hosts), plus a dedicated Desktop `AboutNoticesDialog` with official MoeSekai community links and 5-locale legal notices.
- **Consolidated Desktop Navigation & Unified Settings**: Replaced scattered popovers with a unified 3-tab `SettingsDialog` (`Appearance & Language`, `Stage & Cache`, `MoeSekai Agent`), a top-bar `About` dropdown menu (`Check for Updates`, `Asset Cache`, `About & Notices`), and focused single-purpose dialogs.

### Fixed
- **UI Kit Manifest Probing (`@moesekai/story-core`)**: Added `hasKitWorkerScript()` manifest probing in `loadStoryUiKit` so newer `sse-web` releases without `kit-worker.js` skip spawning a missing worker cleanly without noisy 404 requests.

## [0.1.2] - 2026-11-23

### Added
- **Custom Brand App Icon (`apps/desktop`)**: Added the flat vector Branching Star logo (`build/icon.svg`) along with a reproducible native icon generator (`scripts/generate-icons.ts`) emitting multi-size Windows `icon.ico` (16–256px), Big Sur+ padded macOS `icon.icns`, and `512×512` transparent Linux/runtime `icon.png`.
- **Desktop Brand Integration**: Wired the native icon into `electron-builder.yml` (Windows NSIS installer/uninstaller & portable EXE, macOS DMG, Linux AppImage), runtime `BrowserWindow` icon resolution, renderer favicon, and the `<StudioLogo />` brand mark across the Welcome screen and Editor top bar.

## [0.1.1] - 2026-11-23

### Fixed
- **Desktop Updater (CNB Anonymous Endpoint)**: Switched CNB primary update checks to the public anonymous `https://cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/latest` JSON endpoint (HTTP 200 without auth) and normalized percent-encoded (`%20`) asset download URLs for external browser opening.
- **Release & CI Packaging**: Fixed Linux AppImage `executableName` for scoped workspace packaging (`moesekai-story-studio`), switched npm idempotency checks to query scoped packuments directly on `registry.npmjs.org`, fixed `release.yml` step-level secret environment handling, and added Bun Linux `Bun.stdin` support in `skills/moesekai-story-script/scripts/validate-msk.mjs`.

## [0.1.0] - 2026-11-23

### Added
- **Standalone Bun Monorepo (`StarMoe-org/moesekai-story-studio`, MPL-2.0)**:
  - `@moesekai/story-core`: Host-agnostic `moesekai-story/2` document model, bidirectional `.msk` DSL parser/serializer, static validator & IR compiler, deterministic runtime VM, i18n pack & custom voice manifest utilities, canonical `storage.pjsk.moe` Live2D catalog & clip loaders, and cross-host workspace/export contracts.
  - `@moesekai/story-editor`: Reusable Material 3 Expressive React editor, node flow canvas, stage inspector, Live2D WebGPU stage controller (with direct clip browsing & off-stage Solo Preview), 5-locale dictionaries (`zh-CN`, `zh-TW`, `en-US`, `ja-JP`, `ko-KR`), and portaled auto-flip tooltips.
  - `@moesekai/story-agent`: AI story authoring agent engine with custom Story Maker tools, official Project SEKAI scenario research/mining, snapshot/rollback diffs, Codex-style reasoning effort (`thinkingLevel`), late-2026 frontier model catalog + live `/models` discovery, staged `create`/`edit` Plan workflow, transient timeout auto-retry, and persistent per-project session history/resume.
  - **MoeSekai Story Studio Desktop (`apps/desktop`)**: Native Electron desktop application with local `.msk` folder workspaces, external file watching, `.msk` export preflight, resizable `MoeSekai Agent` sidebar with GFM tables & conversation history resume, cross-platform frameless chrome (Windows / macOS / Linux), and CNB-first auto-fallback GitHub update checker.
  - **Live2D Z-Layering & Anti-Occlusion**: First-class integer `z=<int>` (`-99..99`) across `.msk`, validator, compiler, runtime, stage controller, and Inspector UI, plus automatic move/enter/speaker elevation via `computeActorRenderOrders`.
  - **Standalone Skill (`skills/moesekai-story-script`)**: Zero-dependency Node.js CLI validator & official story miner bundled directly from `@moesekai/story-core`.
  - **Release Engineering**: Lockstep versioning CLI (`scripts/version.ts`), topological npm publisher (`scripts/publish-packages.ts`), dual GitHub + CNB Release mirroring (`scripts/sync-cnb-release.ts`, `.github/workflows/*`, `.cnb.yml`).
