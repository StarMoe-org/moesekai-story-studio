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
- `@moesekai/story-editor/live2d-viewer/*` — Vendored `SekaiLive2DStage` / `SekaiLive2DViewer` worker & WASM artifacts

## License

MPL-2.0
