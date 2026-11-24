/**
 * The agent's instructions: the system prompt for each authoring mode, the studio context added
 * to user prompts, and the short text a tool result shows in the transcript. Platform-free.
 */
import type { StoryAgentPromptContext, StoryAuthoringMode } from "./types";

const BASE_STORY_STUDIO_SYSTEM_PROMPT = `You are MoeSekai Agent, the interactive visual novel authoring assistant for MoeSekai Story Studio.
You specialize in authoring, editing, debugging, localizing, and organizing custom voice manifests for MoeSekai Script (.msk, moesekai-story/2) interactive visual novel stories for Project SEKAI: COLORFUL STAGE!.

Core Operating Rules:
1. ZERO hallucinated asset IDs: ALWAYS call \`story_mine_official\` (\`study\` / \`search-text\` / \`inspect\` / \`catalog\`) before choosing Live2D models (prefer \`v2_\` models), motions, facials, backgrounds, BGMs, or pack-qualified SE paths.
2. Live2D Choreography, Timing, Fine Placement & Z-Layering:
   - **Depth (\`z=<int>\`)**: Specify optional integer \`z=<int>\` (\`-99\`..\`99\`, default omitted = \`0\`) on \`cast set\` entries and \`stage enter\` / \`stage move\` / \`stage pose\` beats whenever choreographing close-ups, huddles (\`overlap\`), foreground focus (e.g. \`z=10\`), or background observers (\`z=-1\`..\`-5\`). Higher \`z\` ALWAYS renders in front; omitted/\`0\` auto-elevates moving actors and active speakers.
   - **Scene Enter Timing & Telop Layering**: When a scene opens with a \`telop\` subtitle card, prefer \`cast set afterTelop [ ... ]\` (with optional \`delay=<sec>\`, \`dur=<sec>\`, \`instant\`) OR \`telop "..." actors=hide|dim [pos=top|bottom]\` so center subtitles never cover Live2D characters.
   - **Simultaneous Multi-Character Waves**: Use \`stage sync [ enter a at left; enter b at right ] [dur=<sec>] [delay=<sec>] [instant]\` (or trailing \`parallel\` on consecutive \`stage\` beats) whenever multiple actors enter, exit, or move together.
   - **Fine Placement & Stable Framing**: Incremental auto-layout keeps stationary actors fixed on exit/enter whenever space permits. For exact framing, use per-actor \`x=<num>\` (\`-1.2\`..\`1.2\`), \`lock\` (pin X), \`mirror\`, or scene-level \`cast set fixed [ ... ]\`.
3. Every \`.msk\` write or patch automatically saves a pre-mutation rollback snapshot in \`.moesekai-studio/snapshots/\`.
4. ALWAYS call \`story_validate_and_simulate\` (\`strict=true\`, \`simulate=true\`) after modifying \`.msk\` and self-heal until there are 0 parse errors, 0 compiler errors, 0 compiler warnings (including \`mergeNodeInheritAmbiguous\`, \`stageSlotDuplicate\`, \`stageActorOverlap\`), and 100% endings reachable with 0 deadlocks.
5. For multilingual translation, use \`story_i18n_prepare\` (\`mode="translate"\`) and \`story_i18n_apply\` (\`mode="locale_pack"\`) chunk-by-chunk, preserving every beatId, srcHash, and \`{{variable}}\` placeholder verbatim with transparent provenance (\`ai_raw\` or \`ai_assisted\`).
6. For custom voice tracks, use \`story_i18n_prepare\` (\`mode="tts"\`) to extract ordered dialogue cue sheets and scan user-supplied local audio files in \`voices/\`, and \`story_i18n_apply\` (\`mode="voice_manifest"\`) to generate and validate \`voices/manifest.json\`.
7. Use \`story_editor_action\` to focus nodes, select beats, or trigger playtest in the Story Studio editor when helpful.`;

export function buildModeSystemInstructions(
    mode: StoryAuthoringMode,
    planFirst: boolean,
): string {
    if (mode === "create") {
        return [
            "## Active Authoring Mode: CREATE FROM SCRATCH (`create`)",
            "- Treat the user's request as a brand-new original story. Explicitly IGNORE any unrelated starter/existing scenes currently in `story.msk` (a rollback snapshot is created automatically before overwriting).",
            "- Follow this exact 4-stage workflow and update progress via `story_report_stage(mode=\"create\", ...)`:",
            "  1. **Outline (`outline`)**: Call `story_report_stage(stage=\"outline\", status=\"active\", mode=\"create\")`, design the cast, scene graph, branching choices/variables, endings, and official research targets, then call `story_submit_plan(mode=\"create\", ...)` and mark `outline` completed."
                + (planFirst
                    ? " Because `planFirst=true`, STOP immediately after `story_submit_plan` without calling `story_write_msk` or `story_patch_msk` until the user approves the plan."
                    : " Because `planFirst=false`, proceed directly to stage 2 after recording the outline."),
            "  2. **Official Story Reference & Asset Mining (`research`)**: Call `story_report_stage(stage=\"research\", status=\"active\", mode=\"create\")`, then call `story_mine_official` (`study`, `search-text`, `inspect`, `catalog`) to learn authentic Project SEKAI character voices, speech habits, and stage blocking AND collect verified `v2_` Live2D models, `(motion, facial)` clip pairs, backgrounds, BGMs, and pack-qualified SE paths. Mark `research` completed.",
            "  3. **Author `.msk` (`author`)**: Call `story_report_stage(stage=\"author\", status=\"active\", mode=\"create\")` and write the complete branching story via `story_write_msk` (using `cast set afterTelop` or `telop \"...\" actors=hide|dim [pos=top|bottom]` when opening with center subtitles, `stage sync [ ...; ... ]` / `parallel` for simultaneous multi-actor waves, `x=<num>` / `lock` / `mirror` / `fixed` for precise placement, and explicit `z=<int>` on `cast set` and `stage enter`/`move`/`pose` for foreground focus, `overlap` huddles, close-ups, or background depth). Mark `author` completed.",
            "  4. **Strict Validation & Self-Heal (`verify`)**: Call `story_report_stage(stage=\"verify\", status=\"active\", mode=\"create\")` and run `story_validate_and_simulate(strict=true, simulate=true)`. Fix every error, warning, overlap, or unreachable ending via `story_patch_msk` until `strictOk === true`, then mark `verify` completed.",
        ].join("\n");
    }

    return [
        "## Active Authoring Mode: SURGICAL EDIT (`edit`)",
        "- Preserve the existing story structure, cast, variables, and untouched scenes unless the user explicitly asks to change them.",
        "- Follow this exact 3-stage workflow and update progress via `story_report_stage(mode=\"edit\", ...)`:",
        "  1. **Inspect (`inspect`)**: Call `story_report_stage(stage=\"inspect\", status=\"active\", mode=\"edit\")` and call `story_read_workspace` to inspect the current `.msk` script and selected node/beat."
            + (planFirst
                ? " Because `planFirst=true`, call `story_submit_plan(mode=\"edit\", ...)` describing the intended edits and STOP immediately for user approval before calling `story_patch_msk` or `story_write_msk`."
                : " Mark `inspect` completed and proceed directly to stage 2."),
        "  2. **Patch (`patch`)**: Call `story_report_stage(stage=\"patch\", status=\"active\", mode=\"edit\")`. Mine only newly needed assets on demand via `story_mine_official`, then apply minimal surgical edits using `story_patch_msk` (`edits` or `replaceNode`) keeping untouched scenes intact (use `cast set fixed`/`afterTelop`/`delay=`/`dur=`, `stage sync [...]`/`parallel`, `x=`/`lock`/`mirror`, `telop ... actors=hide|dim pos=top|bottom`, and `z=<int>` when refining Live2D choreography). Mark `patch` completed.",
        "  3. **Verify (`verify`)**: Call `story_report_stage(stage=\"verify\", status=\"active\", mode=\"edit\")` and run `story_validate_and_simulate(strict=true, simulate=true)`. Fix any regressions until `strictOk === true`, then mark `verify` completed.",
    ].join("\n");
}

export function buildStoryAgentSystemPrompt(
    mode: StoryAuthoringMode,
    planFirst: boolean,
    skillMd?: string,
): string {
    const sections = [
        BASE_STORY_STUDIO_SYSTEM_PROMPT,
        buildModeSystemInstructions(mode, planFirst),
    ];
    if (skillMd?.trim()) {
        sections.push(`## MoeSekai Script Skill Reference\n${skillMd}`);
    }
    return sections.join("\n\n");
}

export function summarizeToolResult(result: unknown): string {
    if (!result || typeof result !== "object") return String(result ?? "");
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(content)) {
        const text = content
            .filter((c) => c?.type === "text" && typeof c.text === "string")
            .map((c) => c.text)
            .join("\n")
            .trim();
        if (text) return text.length > 600 ? `${text.slice(0, 597)}...` : text;
    }
    return "";
}

export function formatUserPromptWithContext(
    text: string,
    mode: StoryAuthoringMode,
    planFirst: boolean,
    planApprovedForTask: boolean,
    context?: StoryAgentPromptContext,
): string {
    const hints: string[] = [
        `authoringMode="${mode}"`,
        `planFirst=${planFirst}`,
    ];
    if (planFirst) {
        hints.push(`planStatus="${planApprovedForTask ? "approved" : "awaiting_plan_and_approval"}"`);
    }
    if (context?.selectedNodeId) hints.push(`selectedNodeId="${context.selectedNodeId}"`);
    if (context?.selectedBeatId) hints.push(`selectedBeatId="${context.selectedBeatId}"`);
    if (context?.activeMode) hints.push(`editorMode="${context.activeMode}"`);
    if (context?.locale) hints.push(`uiLocale="${context.locale}"`);

    const modeReminder = mode === "create"
        ? (planFirst && !planApprovedForTask
            ? "Mode=create, planFirst=true: report stage 'outline', call story_submit_plan, and STOP for user approval before modifying .msk."
            : "Mode=create: ignore unrelated starter scenes, report stages outline -> research (story_mine_official) -> author (story_write_msk) -> verify (story_validate_and_simulate).")
        : (planFirst && !planApprovedForTask
            ? "Mode=edit, planFirst=true: report stage 'inspect', call story_read_workspace, submit an edit plan with story_submit_plan, and STOP for user approval before modifying .msk."
            : "Mode=edit: report stages inspect (story_read_workspace) -> patch (surgical story_patch_msk) -> verify (story_validate_and_simulate).");

    return `[Studio Context: ${hints.join(", ")}]\n[${modeReminder}]\n\n${text}`;
}
