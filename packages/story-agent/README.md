# `@moesekai/story-agent`

Agent automation engine for **MoeSekai Story Studio**, built with `@moesekai/story-core` and `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`.

## Features

- **Dual Runtime Modes**:
  - `mode: "sdk"` — In-process session controller supporting Anthropic (Claude 5.5), OpenAI (GPT-6.2), Google Gemini (Gemini 4), OpenRouter, DeepSeek, and custom OpenAI/Anthropic/Google-compatible `baseUrl` endpoints, live `/models` discovery, reasoning effort (`thinkingLevel`), and automatic `skills/moesekai-story-script/SKILL.md` loading.
  - `mode: "rpc"` — Optional subprocess RPC bridge with identical event streaming.
- **Two Authoring Modes + Staged Plan Workflow**:
  - `create` (from scratch): `outline` (`story_submit_plan`) -> `research` (`story_mine_official`) -> `author` (`story_write_msk`) -> `verify` (`story_validate_and_simulate`) with optional `planFirst` approval gate (`approvePlan` / `revisePlan`).
  - `edit` (surgical editing): `inspect` (`story_read_workspace`) -> `patch` (`story_patch_msk`) -> `verify` (`story_validate_and_simulate`).
- **10 Story Maker Custom Tools**:
  - `story_report_stage`, `story_submit_plan`
  - `story_read_workspace`, `story_mine_official`
  - `story_write_msk`, `story_patch_msk` (with pre-mutation rollback snapshots, structured `.msk` diffs, and Live2D `z=<int>` depth layering)
  - `story_validate_and_simulate` (strict syntax + graph compiler + exhaustive branch/ending simulator + live CDN asset verification with `did you mean` hints)
  - `story_i18n_prepare`, `story_i18n_apply` (chunked PJSK-aware multilingual translation packs and user voice cue-sheet extraction / local audio matching / `voices/manifest.json` generation & validation)
  - `story_editor_action` (live editor UI commands)
- **Structured Auto-Retry & Resilient Streaming**: Automatic retry on transient connect/network timeouts (`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, HTTP 429/502/503/504) with `retry_start`/`retry_end` events, abort-aware exponential backoff, and clean settlement of in-flight tools.
- **Persistent Per-Project Sessions**: Real workspace-scoped JSONL sessions + UI transcript sidecars under `<workspaceDir>/.moesekai-studio/sessions/` (`listSessions`, `resumeSession`, `newSession`, `deleteSession`) with strict cross-project isolation.
- **Electron `utilityProcess` IPC Bridge**: `createStoryAgentWorkerHandler` + typed `StoryAgentWorkerRequest` / `StoryAgentWorkerResponse` / `StoryAgentEvent`.

## License

MPL-2.0
