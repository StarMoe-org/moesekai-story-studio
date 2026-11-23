# MoeSekai Story Studio

Standalone Electron desktop studio and publishable TypeScript/React package suite for **MoeSekai Story Maker (`moesekai-story/2`)** and **MoeSekai Script (`.msk`)**, built with **Bun**.

Edit once in this repository and both the Electron desktop app and the `pjsk.moe` Web frontend consume the same packages (`@moesekai/story-core` and `@moesekai/story-editor`).

## Workspace Structure

- `packages/story-core` (`@moesekai/story-core`) — Pure, zero-DOM-required story graph schema, `.msk` bidirectional parser/serializer, static compiler, runtime VM, i18n localization packs, custom voice manifest & POSIX USTAR audio bundler, PJSK CDN asset helpers, and cross-host storage/export contracts.
- `packages/story-editor` (`@moesekai/story-editor`) — Framework-agnostic React 19 + Tailwind CSS 4 + Material 3 Expressive visual flow canvas, Live2D multi-actor stage, player, 5-locale dictionaries, and host slot hooks.
- `packages/story-agent` (`@moesekai/story-agent`) — AI story authoring agent engine with custom Story Maker tools (official story mining, `.msk` edit + snapshot rollback, strict validation & exhaustive branch simulation, persistent per-project sessions, multilingual i18n and user-supplied voice manifest workflows).
- `apps/desktop` — Electron desktop studio with local `.msk` folder workspaces, preflight-checked `.msk`/bundle export pipeline, `moesekai-app://` Live2D/WASM protocol, resizable MoeSekai Agent panel, and CNB-first auto-fallback GitHub update checker.
- `skills/moesekai-story-script` — Standalone AI agent skill with zero-dependency `msk-core.mjs` built directly from `@moesekai/story-core`.

## Quick Start

```bash
bun install
bun run build:packages
bun run build:skill
bun run test
bun run dev:desktop
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run build:core` | Build `@moesekai/story-core` (ESM + `.d.ts`) |
| `bun run build:packages` | Build all publishable packages in dependency order |
| `bun run build:skill` | Rebuild standalone `skills/moesekai-story-script/scripts/lib/msk-core.mjs` |
| `bun run test` | Run unit tests across core, editor, agent, desktop, and release tooling |
| `bun run typecheck` | Run TypeScript typechecking across workspaces |
| `bun run version:show` | Show current lockstep version, git tag, commit count, and SHA |
| `bun run version:check` | Verify all 5 manifests + peer ranges match strict lockstep `X.Y.Z` |
| `bun run version:bump` | Atomically bump lockstep version (`patch`, `minor`, `major`, or `X.Y.Z`) |
| `bun run publish:packages` | Build, verify packed tarballs (0 `workspace:*`), and publish `@moesekai/*` to npmjs.org |
| `bun run dev:desktop` | Launch Electron desktop app in development mode |
| `bun run build:desktop` | Build Electron main, preload, worker, and renderer bundles |
| `bun run package:desktop` | Build packages, skill, and package distributable Electron binaries |

## Versioning & Publishing

All packages and the Desktop app follow lockstep semantic versioning (`X.Y.Z`). Trigger `.github/workflows/release.yml` on `main` (or push a `vX.Y.Z` tag) to publish `@moesekai/story-core`, `@moesekai/story-editor`, and `@moesekai/story-agent` to public **npmjs.org** and publish 3-OS Desktop installers to both **GitHub Releases** and **CNB (`cnb.cool/StarMoe-org/moesekai-story-studio`)**. See [docs/VERSIONING.md](./docs/VERSIONING.md), [CHANGELOG.md](./CHANGELOG.md), and `.npmrc.example` for details.

## Asset Attribution

Default public game assets, Live2D story libraries, and masterdata endpoints are served by **Moesekai (`pjsk.moe`)** (`storage.pjsk.moe`, `assets.pjsk.moe`, `metadata.pjsk.moe`) with CORS `*`. Please keep attribution to **Moesekai (pjsk.moe)** when embedding or redistributing.

## License

This repository and its publishable packages (`@moesekai/story-core`, `@moesekai/story-editor`, `@moesekai/story-agent`) are licensed under the **Mozilla Public License 2.0 (MPL-2.0)**. See [LICENSE](./LICENSE) for the full license text.
