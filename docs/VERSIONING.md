# Versioning & Release Engineering (`moesekai-story-studio`)

`StarMoe-org/moesekai-story-studio` uses **strict lockstep semantic versioning (`X.Y.Z`)** across the entire monorepo so the published npm packages, Desktop app, GitHub Releases, and CNB Releases always stay in sync.

## Lockstep Manifests

All 5 manifests share one exact `X.Y.Z` version:

1. `package.json` (root workspace)
2. `packages/story-core/package.json` (`@moesekai/story-core`)
3. `packages/story-editor/package.json` (`@moesekai/story-editor`, with `peerDependencies["@moesekai/story-core"]` aligned to `^X.Y.Z`)
4. `packages/story-agent/package.json` (`@moesekai/story-agent`)
5. `apps/desktop/package.json` (`@moesekai/story-studio-desktop`)

## Local CLI Commands

```bash
# Show current lockstep version, git tag, commits since tag, short SHA, and build date
bun run version:show
bun run version:show --json
bun run version:show --shell

# Verify all 5 package.json files and @moesekai/story-core peer range match strict X.Y.Z
bun run version:check
bun run version:check --tag v0.1.0

# Atomically bump all 5 manifests + peer range
bun run version:bump patch --dry-run
bun run version:bump patch          # 0.1.0 -> 0.1.1
bun run version:bump minor          # 0.1.0 -> 0.2.0
bun run version:bump major          # 0.1.0 -> 1.0.0
bun run version:bump 0.2.0          # explicit strict X.Y.Z

# Verify & dry-run topological npm publishing (story-core -> story-editor -> story-agent)
bun run publish:packages --dry-run
```

## One-Click Release Workflow

1. Update [`CHANGELOG.md`](../CHANGELOG.md) on `main` under the upcoming version heading (`## [X.Y.Z] - YYYY-MM-DD`).
2. In GitHub → **Actions** → **Release** (`.github/workflows/release.yml`), click **Run workflow** on `main` and choose `patch`, `minor`, `major`, or `custom` (`X.Y.Z`).
3. `release.yml` automatically:
   - Runs `bun run version:bump <target>` and verifies `bun run version:check`.
   - Commits `chore(release): vX.Y.Z` to `main`.
   - Creates and pushes annotated tag `vX.Y.Z`.
   - Launches `.github/workflows/publish.yml` (directly on tag push with `RELEASE_PAT`, or via `gh workflow run` fallback with `GITHUB_TOKEN`).

## Automated Publishing & Dual Releases (`.github/workflows/publish.yml`)

Triggered on `v*` tag pushes (or manual `workflow_dispatch`):

1. **`publish-npm`**:
   - Verifies tag `vX.Y.Z` matches `bun run version:check`.
   - Builds, typechecks, and tests all packages + release tooling.
   - Runs `bun run publish:packages` in topological order (`@moesekai/story-core` → `@moesekai/story-editor` → `@moesekai/story-agent`) to public **npmjs.org** (`--access public`):
     - Audits every packed `.tgz` (`bun pm pack`) to guarantee **zero `workspace:*` specifiers**, `dist/`, and `LICENSE`.
     - Skips any `<pkg>@<version>` already present on npmjs.org for idempotent retries.
2. **`build-desktop`**:
   - 3-OS matrix (`windows-latest` NSIS + portable `.exe`, `macos-latest` arm64/x64 `.dmg`, `ubuntu-latest` `.AppImage`) via Bun + `electron-builder`.
3. **`publish-releases`**:
   - Generates `SHA256SUMS.txt` across all desktop installers and extracts release notes from `CHANGELOG.md`.
   - Creates/updates the **GitHub Release** (`gh release create` / `upload --clobber`).
   - Mirrors the release + all 3-OS installers + `SHA256SUMS.txt` to **CNB (`cnb.cool/StarMoe-org/moesekai-story-studio`)** via `scripts/sync-cnb-release.ts` (gracefully warns and skips if `CNB_TOKEN` is unset).

In parallel, `.github/workflows/sync-cnb.yml` mirrors all Git branches and tags to `https://cnb.cool/StarMoe-org/moesekai-story-studio.git`, and `.cnb.yml` runs CNB-native tag verification and `git:release` metadata sync.

## Required Repository Secrets

| Secret | Required For | Permissions / Scope |
| --- | --- | --- |
| `NPM_TOKEN` | Publishing `@moesekai/*` to `registry.npmjs.org` | npm Automation / Granular Access Token with publish access to `@moesekai` |
| `CNB_TOKEN` | Mirroring git refs (`sync-cnb.yml`) and CNB Releases + installers (`sync-cnb-release.ts`) | CNB Access Token with `repo-code:rw` and `repo-release:rw` on `StarMoe-org/moesekai-story-studio` |
| `RELEASE_PAT` *(optional)* | Letting `release.yml` tag pushes trigger `publish.yml` natively | Fine-grained PAT with `contents: write` (optional; `release.yml` automatically falls back to `gh workflow run publish.yml`) |
