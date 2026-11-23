/**
 * `@moesekai/story-editor` no longer bundles a vendored `SekaiLive2DViewer` release;
 * hosts serve their own viewer release and pass `live2dScriptBase` (and optional
 * `live2dScriptVersion`) via `<StoryStudioProvider>`.
 *
 * Kept as `null` for backwards-compatible imports.
 */
export const LIVE2D_VIEWER_RELEASE: string | null = null;
