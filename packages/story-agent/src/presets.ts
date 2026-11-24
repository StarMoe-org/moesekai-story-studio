import type { StoryAgentPresetId, StoryAgentPresetOptions } from "./types";

export interface StoryAgentPresetMeta {
    id: StoryAgentPresetId;
    title: string;
    description: string;
    defaultTools: string[];
}

export const STORY_AGENT_PRESETS: Record<StoryAgentPresetId, StoryAgentPresetMeta> = {
    author_story: {
        id: "author_story",
        title: "Author New Interactive Story",
        description:
            "Plan the story outline, mine verified official PJSK episodes & assets, author a branching .msk story from scratch, and strictly validate & simulate all endings.",
        defaultTools: [
            "story_report_stage",
            "story_submit_plan",
            "story_mine_official",
            "story_write_msk",
            "story_validate_and_simulate",
            "story_editor_action",
        ],
    },
    fix_validation_issues: {
        id: "fix_validation_issues",
        title: "Validate & Auto-Fix Story",
        description:
            "Inspect the active script, run strict compiler checks, exhaustive branch simulation, and optional live CDN asset verification, then patch issues until 0 errors and 0 warnings.",
        defaultTools: [
            "story_report_stage",
            "story_read_workspace",
            "story_validate_and_simulate",
            "story_mine_official",
            "story_patch_msk",
            "story_editor_action",
        ],
    },
    translate_story: {
        id: "translate_story",
        title: "Multilingual Story Localization",
        description:
            "Chunk the active story, translate dialogue with PJSK character speech habits while preserving {{var}} placeholders, and save validated locales/<locale>.i18n.json.",
        defaultTools: ["story_read_workspace", "story_i18n_prepare", "story_i18n_apply"],
    },
    prepare_tts_manifest: {
        id: "prepare_tts_manifest",
        title: "Voice Cue Sheet & Manifest Builder",
        description:
            "Extract ordered dialogue voice cue sheets, match user-supplied local audio files in voices/, and generate/validate voices/manifest.json.",
        defaultTools: ["story_read_workspace", "story_i18n_prepare", "story_i18n_apply"],
    },
};

export function buildPresetPrompt(
    preset: StoryAgentPresetId,
    options: StoryAgentPresetOptions = {},
): string {
    const region = options.region ?? "jp";
    const verifyAssets = options.verifyAssets ?? true;

    switch (preset) {
        case "author_story": {
            const brief = options.brief?.trim()
                || "Author an authentic, heartfelt interactive Project SEKAI branching mini-story (6-10 scenes, 1-2 meaningful choices, 1-2 tracked @var states, a condition payoff node, and 2-3 reachable endings).";
            return [
                "Execute the staged MoeSekai Story Studio creation workflow (`create` mode; ignore any unrelated starter/existing scenes — a rollback snapshot is created automatically when writing):",
                "1. **Outline (`outline`)**: Call `story_report_stage(stage=\"outline\", status=\"active\", mode=\"create\")`, design the cast, scenes, branches, endings, and official research targets, then call `story_submit_plan`. If plan approval is active, stop here and wait for user approval.",
                `2. **Official Reference & Asset Mining (\`research\`)**: Call \`story_report_stage(stage="research", status="active", mode="create")\` and use \`story_mine_official\` (\`study\`, \`search-text\`, \`inspect\`, and/or \`catalog\`, region="${region}") to study authentic character voices & blocking AND collect verified \`v2_\` models, \`(motion, facial)\` pairs, BGs, BGMs, and pack-qualified SEs. Zero hallucinated IDs.`,
                "3. **Author `.msk` (`author`)**: Call `story_report_stage(stage=\"author\", status=\"active\", mode=\"create\")` and write the complete `.msk` script with `story_write_msk` (explicit stage slots on every merge node with inDegree >= 2, safe non-overlapping stage framing unless intentional `overlap`, `cast set afterTelop` or `telop \"...\" actors=hide|dim [pos=top|bottom]` so center subtitles never cover characters, `stage sync [ ...; ... ]` / `parallel` for simultaneous multi-character enter/exit/move, optional `x=<num>` / `lock` / `mirror` / `fixed` for exact framing, explicit Live2D `z=<int>` depth layers on `cast set` / `stage enter`/`move`/`pose`, and short natural dialogue beats with co-star `react(...)`).",
                `4. **Strict Verification & Self-Heal (\`verify\`)**: Call \`story_report_stage(stage="verify", status="active", mode="create")\` and run \`story_validate_and_simulate\` (\`strict: true\`, \`simulate: true\`, \`verifyAssets: ${verifyAssets}\`). Patch any errors, warnings, unreached endings, overlaps, or missing assets via \`story_patch_msk\` until 100% green, then mark \`verify\` completed.`,
                "5. Call `story_editor_action` (`focus_node`) on the opening scene and present a concise summary of the story, endings, and verified assets.",
                "",
                `Story Brief:\n${brief}`,
            ].join("\n");
        }
        case "fix_validation_issues": {
            return [
                "Validate and self-heal the active MoeSekai story script (`edit` mode):",
                "1. Call `story_report_stage(stage=\"inspect\", status=\"active\", mode=\"edit\")` and `story_read_workspace` to inspect the active `.msk` script and outline.",
                `2. Run \`story_validate_and_simulate\` with \`strict: true\`, \`simulate: true\`, \`verifyAssets: ${verifyAssets}\`.`,
                "3. If any syntax errors, compiler errors, compiler warnings (`mergeNodeInheritAmbiguous`, `stageSlotDuplicate`, `stageActorOverlap`, `portUnwired`, `nodeUnreachable`), unreached endings, deadlocks, or missing assets/clips are reported:",
                "   - Call `story_report_stage(stage=\"patch\", status=\"active\", mode=\"edit\")`.",
                "   - Use `did you mean` clip suggestions or `story_mine_official` (`catalog`) to replace invalid assets.",
                "   - Apply minimal surgical edits with `story_patch_msk` preserving untouched scenes.",
                "   - Call `story_report_stage(stage=\"verify\", status=\"active\", mode=\"edit\")` and re-run `story_validate_and_simulate` until `strictOk === true` (0 errors, 0 warnings, all endings reachable, 0 missing assets).",
                "4. Mark `verify` completed, focus the primary fixed node with `story_editor_action`, and summarize every fix made.",
            ].join("\n");
        }
        case "translate_story": {
            const targetLocale = options.targetLocale ?? "ja-JP";
            return [
                `Create or update the \`${targetLocale}\` localization pack (\`locales/${targetLocale}.i18n.json\`) for the active story:`,
                "1. Call `story_read_workspace` to inspect the active story and existing locale packs.",
                `2. Call \`story_i18n_prepare\` with \`mode: "translate"\`, \`targetLocale: "${targetLocale}"\`, \`chunkIndex: 0\`.`,
                "3. For each chunk (0 .. totalChunks - 1):",
                "   - Carefully translate all user-visible fields (`meta`, `cast`, `places`, `beats`, `choices`, `ends`) following the injected Project SEKAI character first-person & speech-habit guidelines.",
                "   - Preserve EVERY beat ID, `srcHash`, and exact `{{variable}}` placeholder verbatim.",
                `   - Call \`story_i18n_apply\` with \`mode: "locale_pack"\`, \`targetLocale: "${targetLocale}"\`, \`chunkIndex\`, \`originOverride: "ai_raw"\` and verify 0 validation errors.`,
                "4. Report final translated beat coverage and highlight any lines that deserve human proofreading.",
            ].join("\n");
        }
        case "prepare_tts_manifest": {
            const targetLocale = options.targetLocale;
            return [
                "Prepare the custom voice cue sheet and user-supplied voice track manifest (`voices/manifest.json`) for the active story:",
                "1. Call `story_read_workspace` to inspect the story, cast, locales, and current `voices/manifest.json`.",
                `2. Call \`story_i18n_prepare\` with \`mode: "tts"\`${targetLocale ? `, \`targetLocale: "${targetLocale}"\`` : ""}, \`audioDir: "voices"\` to extract the ordered dialogue cue sheet and scan user-provided local audio files in \`voices/\`.`,
                "3. If matching local user audio files are found in `voices/`, call `story_i18n_apply` with `mode: \"voice_manifest\"`, `autoMatchAudioDir: \"voices\"`"
                + `${targetLocale ? `, \`targetLocale: "${targetLocale}"\`` : ""} to generate and validate \`voices/manifest.json\`.`,
                "4. Present a clear per-character voice cue sheet table (beatId, speaker, recommended `<beatId>.ogg` filename, line text) plus which lines are already matched vs still awaiting user-supplied audio files.",
            ].join("\n");
        }
    }
}
