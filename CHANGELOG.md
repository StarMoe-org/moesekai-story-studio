# Changelog

All notable changes to **MoeSekai Story Studio** (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`, and the Desktop application) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this monorepo adheres to lockstep [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
