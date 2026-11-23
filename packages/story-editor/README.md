# `@moesekai/story-editor`

Framework-agnostic React 19 + Tailwind CSS 4 + Material 3 Expressive editor, player, Live2D multi-actor WebGPU stage, and 5-locale UI dictionaries for MoeSekai Story Studio.

Consumed identically by both the MoeSekai web app (`pjsk.moe`) and the MoeSekai Story Studio Electron desktop app.

## Subpath Exports

- `@moesekai/story-editor` — `<StoryStudioProvider>`, `<StoryStudioHub>`, `<StoryStudioEditor>` (with imperative `StoryStudioEditorHandle` + host `slots`), `<StoryStudioPlayer>`, and all Story Maker UI components & hooks
- `@moesekai/story-editor/md3` — Decoupled Material 3 Expressive React primitives
- `@moesekai/story-editor/md3/icons` — Filtered Material Symbols Rounded SVG path constants
- `@moesekai/story-editor/live2d` — Live2D stage/viewer runtime loaders, model/background/clip pickers
- `@moesekai/story-editor/messages/{zh-CN,zh-TW,en-US,ja-JP,ko-KR}` — Pure ESM 5-locale message dictionaries (`storyMakerMessages` + `studioMessages`)
- `@moesekai/story-editor/styles/md3.css` & `@moesekai/story-editor/styles/story-game-ui.css` — MD3 tokens/schemes and in-game scenario overlay CSS
- `@moesekai/story-editor/unit-icons/*` — Static PJSK unit icons

## Host-Served Live2D Runtime & Canonical Asset Sources

`@moesekai/story-editor` does **not** bundle `SekaiLive2DViewer` WASM/worker artifacts. Hosts serve their own vendored `SekaiLive2DViewer` release (carrying `viewer.js`, `stage.js`, workers, and `pkg/`) and configure it on `<StoryStudioProvider>`:

- **`live2dScriptBase`** (optional, defaults to `LIVE2D_VIEWER_PATH` `"/live2d-viewer/"`): Directory URL where `viewer.js` and `stage.js` are served (e.g. `"/live2d-viewer/0.3.0-<hash>/"` on Web or `"moesekai-app://app/live2d-viewer/"` on Electron Desktop).
- **`live2dScriptVersion`** (optional): When provided, appends `?v=<version>` when importing `viewer.js` / `stage.js` for cache-busting; when omitted, scripts are loaded cleanly without a query parameter.
- **`live2dSources`** (optional): Custom `(region) => Live2DSources` resolver returning `{ site, region, version?, proxy? }` (matching `SekaiLive2DViewer` 0.2.x / 0.3.x). Defaults to `@moesekai/story-core`'s `live2dSources(region, assetLine)` pointing at the canonical asset site (`https://storage.pjsk.moe` / backup `https://storage.exmeaning.com`, or `moesekai-cache://` on Desktop).
- If a host serves a viewer release without `stage.js` (e.g. single-model `SekaiLive2DViewer 0.2.0`), `loadLive2DStage` detects the 404/load failure cleanly and transitions the stage to `{ kind: "unavailable", message, url }` with portrait preview fallback rather than hanging or crashing.

## License

MPL-2.0
