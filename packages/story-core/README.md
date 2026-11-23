# `@moesekai/story-core`

Pure, zero-React, host-agnostic engine for **MoeSekai Story Maker (`moesekai-story/2`)** and **MoeSekai Script (`.msk`)**.

## Features

- Strict `moesekai-story/2` schema types & whitelist validator (`validateStoryDocument`, `parseStoryJson`, `parseStoryDocumentDraft`)
- Immutable flow-graph mutations, stage slots, beat tracks, drag-drop payloads, and deterministic DAG auto-layout
- 2-pass static analyzer & deterministic IR compiler (`compileStoryGraph`)
- Zero-DOM runtime VM & instant editor stage snapshot evaluator (`createInitialRuntime`, `advanceRuntime`, `evaluateStageAt`)
- Lossless bidirectional `.msk` parser & serializer (`parseStoryScript`, `serializeStoryScript`)
- Multi-language localization packs (`StoryLocalePack`), chunked translation helpers, and custom voice track manifests (`StoryVoiceManifest`)
- Zero-copy POSIX USTAR `.tar` audio bundler (`buildAudioTarBundle`, `validateAudioSelection`, `extractTalkBeatsForVoice`, `matchAudioFilesToTalkBeats`)
- Decoupled PJSK CDN asset URL builders, Live2D catalog/clip helpers, preloader, and voice search alignment
- Cross-host workspace contracts (`StoryDraftStorageAdapter`, `StoryExportAdapter`, `StoryWorkspaceCapabilities`, `prepareMskExport`, `stripMskPositions`)

## Asset Attribution

Default public game assets and masterdata endpoints point to **Moesekai (`pjsk.moe`)** (`storage.pjsk.moe`, `metadata.pjsk.moe`). Please include attribution to **Moesekai (pjsk.moe)** when embedding.

## License

Mozilla Public License 2.0 (MPL-2.0).
