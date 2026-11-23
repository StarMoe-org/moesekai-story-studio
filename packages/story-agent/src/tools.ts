import { readFile } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StoryImportableTranslationOrigin, StoryRegion, UiLocale } from "@moesekai/story-core";
import {
    applyStoryTranslation,
    applyVoiceManifest,
    prepareStoryTranslation,
    prepareVoiceCueSheet,
} from "./i18n-tools";
import {
    formatMineResultForAgent,
    mineOfficialStory,
    type OfficialStoryMineRequest,
} from "./official-story";
import type {
    StoryAuthoringMode,
    StoryEditorAction,
    StoryMskDiff,
    StorySnapshotMeta,
    StoryWorkflowPlan,
    StoryWorkflowStage,
    StoryWorkflowStageStatus,
} from "./types";
import { formatValidationSummary, validateAndSimulateStory } from "./validator";
import {
    DEFAULT_STORY_FILE,
    normalizeLineEndings,
    patchStoryScript,
    readStoryWorkspace,
    resolveSafeWorkspacePath,
    writeStoryScript,
} from "./workspace";

export interface StoryMakerToolsRuntime {
    getWorkspaceDir: () => string;
    getStoryFile: () => string;
    getAssetLine?: () => "main" | "backup";
    getSelectedNodeId?: () => string | null | undefined;
    getAuthoringMode?: () => StoryAuthoringMode;
    isPlanApprovalRequired?: () => boolean;
    isMutationBlockedByPlan?: () => boolean;
    fetchImpl?: typeof fetch;
    cacheDir?: string;
    noCache?: boolean;
    onSnapshotCreated?: (snapshot: StorySnapshotMeta) => void;
    onMskDiff?: (diff: StoryMskDiff, storyFile: string) => void;
    onEditorAction?: (action: StoryEditorAction) => void;
    onWorkflowStage?: (event: {
        mode: StoryAuthoringMode;
        stage: StoryWorkflowStage;
        status: StoryWorkflowStageStatus;
        label?: string;
        detail?: string;
    }) => void;
    onPlanProposed?: (plan: StoryWorkflowPlan, awaitingApproval: boolean) => void;
}

const REGIONS_UNION = Type.Union([
    Type.Literal("jp"),
    Type.Literal("cn"),
    Type.Literal("tw"),
    Type.Literal("kr"),
    Type.Literal("en"),
]);

const LOCALES_UNION = Type.Union([
    Type.Literal("zh-CN"),
    Type.Literal("zh-TW"),
    Type.Literal("en-US"),
    Type.Literal("ja-JP"),
    Type.Literal("ko-KR"),
]);

const AUTHORING_MODE_UNION = Type.Union([
    Type.Literal("create"),
    Type.Literal("edit"),
]);

const WORKFLOW_STAGE_UNION = Type.Union([
    Type.Literal("outline"),
    Type.Literal("research"),
    Type.Literal("author"),
    Type.Literal("verify"),
    Type.Literal("inspect"),
    Type.Literal("patch"),
]);

let planSeq = 0;

function generatePlanId(): string {
    planSeq += 1;
    return `plan_${Date.now().toString(36)}_${String(planSeq).padStart(3, "0")}`;
}

function wrapFetchWithAbortSignal(
    baseFetch: typeof fetch | undefined,
    toolSignal?: AbortSignal,
): typeof fetch | undefined {
    if (!toolSignal) return baseFetch;
    const underlying = baseFetch ?? globalThis.fetch;
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (toolSignal.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            return Promise.reject(err);
        }
        const combinedSignal = init?.signal
            ? AbortSignal.any([init.signal, toolSignal])
            : toolSignal;
        return underlying(input, { ...(init ?? {}), signal: combinedSignal });
    }) as typeof fetch;
}

export function createStoryMakerTools(runtime: StoryMakerToolsRuntime): ToolDefinition<any, any, any>[] {
    const getStory = () => runtime.getStoryFile() || DEFAULT_STORY_FILE;
    const getLine = () => runtime.getAssetLine?.() ?? "main";
    const getMode = (): StoryAuthoringMode => runtime.getAuthoringMode?.() ?? "edit";

    const reportStageTool = defineTool({
        name: "story_report_stage",
        label: "Report Workflow Stage",
        description:
            "Reports entering, completing, or skipping a workflow stage so the Story Studio UI stepper updates live. Use outline -> research -> author -> verify in 'create' mode, and inspect -> patch -> verify in 'edit' mode.",
        promptSnippet:
            "story_report_stage: Update the live workflow stepper (create: outline->research->author->verify; edit: inspect->patch->verify).",
        promptGuidelines: [
            "Call story_report_stage when starting and finishing each major workflow phase so the user can track progress.",
        ],
        parameters: Type.Object({
            stage: WORKFLOW_STAGE_UNION,
            status: Type.Union([
                Type.Literal("active"),
                Type.Literal("completed"),
                Type.Literal("skipped"),
            ]),
            mode: Type.Optional(AUTHORING_MODE_UNION),
            label: Type.Optional(Type.String({ description: "Optional short display label for this stage." })),
            detail: Type.Optional(Type.String({ description: "Optional concise progress note." })),
        }),
        async execute(_toolCallId, params) {
            const mode: StoryAuthoringMode = params.mode ?? getMode();
            const payload = {
                mode,
                stage: params.stage as StoryWorkflowStage,
                status: params.status as StoryWorkflowStageStatus,
                ...(params.label ? { label: params.label } : {}),
                ...(params.detail ? { detail: params.detail } : {}),
            };
            runtime.onWorkflowStage?.(payload);
            return {
                content: [
                    {
                        type: "text",
                        text: `Stage updated: [${mode}] ${payload.stage} -> ${payload.status}${payload.detail ? ` (${payload.detail})` : ""}`,
                    },
                ],
                details: payload,
            };
        },
    });

    const submitPlanTool = defineTool({
        name: "story_submit_plan",
        label: "Submit Story Plan",
        description:
            "Submits a structured story outline or edit plan (title, region, premise, castPlan, scenes, branches, endings, researchTargets). When plan approval is enabled and no approved plan exists for the current task, stops immediately before any .msk mutation so the user can review and approve or request revisions.",
        promptSnippet:
            "story_submit_plan: Submit structured story outline / edit plan for user review before writing .msk.",
        promptGuidelines: [
            "When planFirst is active, call story_submit_plan BEFORE calling story_write_msk or story_patch_msk, and stop for user approval.",
        ],
        parameters: Type.Object({
            title: Type.String({ description: "Planned story title or edit summary title." }),
            region: Type.Optional(REGIONS_UNION),
            premise: Type.String({ description: "Concise story premise or edit goal." }),
            castPlan: Type.Array(
                Type.Object({
                    key: Type.String(),
                    name: Type.String(),
                    charId: Type.Optional(Type.Number()),
                    notes: Type.Optional(Type.String()),
                }),
                { description: "Planned characters/cast roles." },
            ),
            scenes: Type.Array(
                Type.Object({
                    id: Type.String(),
                    title: Type.String(),
                    summary: Type.String(),
                }),
                { description: "Ordered list of planned scenes or scenes to modify." },
            ),
            branches: Type.Array(Type.String(), {
                description: "Key choice points, tracked @var states, and branching logic.",
            }),
            endings: Type.Array(
                Type.Object({
                    id: Type.String(),
                    title: Type.String(),
                    condition: Type.Optional(Type.String()),
                }),
                { description: "Planned endings and how they are reached." },
            ),
            researchTargets: Type.Array(Type.String(), {
                description: "Official PJSK units, characters, themes, or asset types to mine via story_mine_official.",
            }),
            mode: Type.Optional(AUTHORING_MODE_UNION),
        }),
        async execute(_toolCallId, params) {
            const mode: StoryAuthoringMode = params.mode ?? getMode();
            const awaitingApproval = runtime.isPlanApprovalRequired?.() ?? false;
            const plan: StoryWorkflowPlan = {
                id: generatePlanId(),
                mode,
                title: params.title,
                region: (params.region as StoryRegion | undefined) ?? "jp",
                premise: params.premise,
                castPlan: params.castPlan.map((c) => ({
                    key: c.key,
                    name: c.name,
                    ...(c.charId !== undefined ? { charId: c.charId } : {}),
                    ...(c.notes ? { notes: c.notes } : {}),
                })),
                scenes: params.scenes.map((s) => ({
                    id: s.id,
                    title: s.title,
                    summary: s.summary,
                })),
                branches: [...params.branches],
                endings: params.endings.map((e) => ({
                    id: e.id,
                    title: e.title,
                    ...(e.condition ? { condition: e.condition } : {}),
                })),
                researchTargets: [...params.researchTargets],
                status: awaitingApproval ? "pending_approval" : "approved",
            };

            runtime.onPlanProposed?.(plan, awaitingApproval);

            if (awaitingApproval) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                `Plan submitted (id=${plan.id}, title="${plan.title}", ${plan.scenes.length} scene(s), ${plan.endings.length} ending(s)) and is awaiting user approval. `
                                + "STOP immediately without calling story_write_msk or story_patch_msk. Wait for the user to approve or request revisions.",
                        },
                    ],
                    details: { plan, awaitingApproval: true },
                    terminate: true,
                };
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Plan recorded (id=${plan.id}, title="${plan.title}") with auto-approval active. Proceed directly to official story research and authoring.`,
                    },
                ],
                details: { plan, awaitingApproval: false },
            };
        },
    });

    const readWorkspaceTool = defineTool({
        name: "story_read_workspace",
        label: "Read Story Workspace",
        description:
            "Reads the active .msk script, parsed graph outline (cast, variables, nodes, endings, selected node context), available locale packs (locales/*.i18n.json), and custom voice manifest summary (voices/manifest.json).",
        promptSnippet:
            "story_read_workspace: Read active .msk script, graph outline, locales, and voice manifest summary.",
        promptGuidelines: [
            "In edit mode, call story_read_workspace first before patching or validating an existing story.",
        ],
        parameters: Type.Object({
            includeScript: Type.Optional(
                Type.Boolean({ description: "Include raw .msk source text (default true)." }),
            ),
            startLine: Type.Optional(Type.Number({ description: "Optional 1-based start line slice." })),
            endLine: Type.Optional(Type.Number({ description: "Optional 1-based end line slice." })),
            selectedNodeId: Type.Optional(
                Type.String({ description: "Optional node ID to expand with full .msk snippet and beat preview." }),
            ),
        }),
        async execute(_toolCallId, params) {
            const selectedNodeId = params.selectedNodeId ?? runtime.getSelectedNodeId?.() ?? undefined;
            const snapshot = await readStoryWorkspace(runtime.getWorkspaceDir(), getStory(), {
                includeScript: params.includeScript ?? true,
                startLine: params.startLine,
                endLine: params.endLine,
                selectedNodeId,
            });
            const lines: string[] = [
                `Workspace: ${snapshot.storyFile} (${snapshot.exists ? `${snapshot.lineCount} lines, ${snapshot.byteLength} bytes` : "not created yet"})`,
                snapshot.parseOk && snapshot.docSummary
                    ? `Story "${snapshot.docSummary.title}" (id=${snapshot.docSummary.id}, region=${snapshot.docSummary.region}) | cast=${snapshot.cast.length}, vars=${snapshot.variables.length}, nodes=${snapshot.nodes.length}, beats=${snapshot.docSummary.beatCount}, endings=${snapshot.endings.length}`
                    : `Parse status: ${snapshot.exists ? `FAILED (${snapshot.parseDiagnostics.length} error(s))` : "empty"}`,
            ];
            if (snapshot.parseDiagnostics.length > 0) {
                lines.push(
                    "Parse errors:\n"
                    + snapshot.parseDiagnostics.map((d) => `  Line ${d.line}:${d.col}: ${d.message}`).join("\n"),
                );
            }
            if (snapshot.cast.length > 0) {
                lines.push("Cast: " + snapshot.cast.map((c) => `${c.key}="${c.name}"(${c.modelId})`).join(", "));
            }
            if (snapshot.variables.length > 0) {
                lines.push("Vars: " + snapshot.variables.map((v) => `${v.id}:${v.type}=${String(v.initial)}`).join(", "));
            }
            if (snapshot.nodes.length > 0) {
                lines.push(
                    "Nodes:\n"
                    + snapshot.nodes
                        .map((n) => `  - ${n.type} ${n.id} "${n.title}"${n.beatCount !== undefined ? ` (${n.beatCount} beats)` : ""}${n.outgoingTargets.length ? ` -> ${n.outgoingTargets.join(", ")}` : ""}`)
                        .join("\n"),
                );
            }
            if (snapshot.locales.length > 0) {
                lines.push(
                    "Locales: "
                    + snapshot.locales
                        .map((l) => `${l.locale}(${l.translatedBeats}/${l.totalBeats}, outdated=${l.outdatedBeats}, origin=${l.origin})`)
                        .join(", "),
                );
            }
            if (snapshot.voiceManifest) {
                const vm = snapshot.voiceManifest;
                lines.push(
                    `Voice manifest: ${vm.filePath} (${vm.matchedCount}/${vm.totalTalkBeats} talk beats matched${vm.locale ? `, locale=${vm.locale}` : ""})`,
                );
            }
            if (snapshot.selectedNodeContext) {
                const beatPreviewText = snapshot.selectedNodeContext.beatsPreview?.length
                    ? `\nBeats preview:\n${snapshot.selectedNodeContext.beatsPreview.map((b) => `  - [${b.id}] (${b.kind}) ${b.summary}`).join("\n")}`
                    : "";
                lines.push(
                    `\nSelected node [${snapshot.selectedNodeContext.nodeId}]:${beatPreviewText}\n\`\`\`msk\n${snapshot.selectedNodeContext.mskSnippet}\n\`\`\``,
                );
            }
            if (snapshot.script !== undefined) {
                lines.push(`\nScript (${snapshot.storyFile}):\n\`\`\`msk\n${snapshot.script}\n\`\`\``);
            }
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: snapshot,
            };
        },
    });

    const mineOfficialTool = defineTool({
        name: "story_mine_official",
        label: "Mine Official PJSK Stories & Assets",
        description:
            "Queries official Project SEKAI scenarios and live asset catalogs via Moesekai CDN to study authentic character voices/blocking and obtain verified v2_ Live2D models, (motion, facial) clip pairs, backgrounds, BGM tracks, pack-qualified SE paths, and voices. Always use this before authoring so zero IDs are hallucinated.",
        promptSnippet:
            "story_mine_official: Mine official PJSK episodes (study/search-text/inspect/catalog/list) for verified models, clips, BGs, BGMs, and SEs.",
        promptGuidelines: [
            "Never guess Live2D model IDs, motion/facial clips, backgrounds, BGMs, or SEs — query story_mine_official first.",
        ],
        parameters: Type.Object({
            action: Type.Union([
                Type.Literal("study"),
                Type.Literal("search-text"),
                Type.Literal("inspect"),
                Type.Literal("catalog"),
                Type.Literal("list"),
            ]),
            region: Type.Optional(REGIONS_UNION),
            unit: Type.Optional(Type.String({ description: "Unit alias for study/list (ln, mmj, vbs, ws, 25ji, vs)." })),
            char: Type.Optional(Type.String({ description: "Character ID(s) or name(s), comma-separated (e.g. 'kanade,mafuyu' or '17,18')." })),
            query: Type.Optional(Type.String({ description: "Search text for search-text, or title/keyword filter for list/study." })),
            selector: Type.Optional(Type.String({ description: "Official episode selector for inspect (e.g. 'event:203/1', 'unit:light_sound/1', 'card:900/former')." })),
            selectors: Type.Optional(Type.Array(Type.String(), { description: "Explicit episode selectors for study." })),
            sample: Type.Optional(Type.Number({ description: "Number of episodes to sample in study (1..8, default 3)." })),
            kind: Type.Optional(Type.String({ description: "Story kind (event|unit|card|area|special) or model kind (character|sub|collab|mob) or voice kind (story|card|area|part)." })),
            subkind: Type.Optional(
                Type.Union([
                    Type.Literal("models"),
                    Type.Literal("clips"),
                    Type.Literal("bgm"),
                    Type.Literal("bg"),
                    Type.Literal("se"),
                    Type.Literal("voices"),
                ]),
            ),
            arg: Type.Optional(Type.String({ description: "Catalog argument (e.g. modelId for 'clips', scenarioId for 'voices')." })),
            search: Type.Optional(Type.String({ description: "Search string for catalog models." })),
            filter: Type.Optional(Type.String({ description: "Substring filter for catalog clips/bgm/bg/se/voices." })),
            category: Type.Optional(Type.String({ description: "Category filter for catalog bgm." })),
            type: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("motion"), Type.Literal("facial")])),
            v2Only: Type.Optional(Type.Boolean({ description: "Filter catalog models to v2_ models only." })),
            includeCg: Type.Optional(Type.Boolean()),
            includeMixed: Type.Optional(Type.Boolean()),
            includeTimeline: Type.Optional(Type.Boolean()),
            translate: Type.Optional(Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")])),
            lines: Type.Optional(Type.String({ description: "Talk line slice for inspect (e.g. '1..25')." })),
            limit: Type.Optional(Type.Number()),
        }),
        async execute(_toolCallId, params, signal) {
            let req: OfficialStoryMineRequest;
            switch (params.action) {
                case "study":
                    req = {
                        action: "study",
                        region: params.region as StoryRegion | undefined,
                        unit: params.unit,
                        char: params.char,
                        kind: params.kind as any,
                        query: params.query,
                        selectors: params.selectors,
                        sample: params.sample,
                        includeMixed: params.includeMixed,
                    };
                    break;
                case "search-text":
                    if (!params.query) throw new Error("action='search-text' requires `query`.");
                    req = {
                        action: "search-text",
                        query: params.query,
                        region: params.region as StoryRegion | undefined,
                        kind: params.kind as any,
                        char: params.char,
                        limit: params.limit,
                    };
                    break;
                case "inspect":
                    if (!params.selector) throw new Error("action='inspect' requires `selector`.");
                    req = {
                        action: "inspect",
                        selector: params.selector,
                        region: params.region as StoryRegion | undefined,
                        translate: params.translate,
                        includeTimeline: params.includeTimeline,
                        lines: params.lines,
                    };
                    break;
                case "catalog":
                    if (!params.subkind) throw new Error("action='catalog' requires `subkind` (models|clips|bgm|bg|se|voices).");
                    req = {
                        action: "catalog",
                        subkind: params.subkind,
                        arg: params.arg,
                        region: params.region as StoryRegion | undefined,
                        kind: params.kind,
                        char: params.char,
                        search: params.search,
                        filter: params.filter,
                        category: params.category,
                        type: params.type,
                        v2Only: params.v2Only,
                        includeCg: params.includeCg,
                        limit: params.limit,
                    };
                    break;
                case "list":
                    req = {
                        action: "list",
                        region: params.region as StoryRegion | undefined,
                        kind: params.kind as any,
                        unit: params.unit,
                        char: params.char,
                        query: params.query,
                        includeMixed: params.includeMixed,
                        limit: params.limit,
                    };
                    break;
            }

            const result = await mineOfficialStory(req, {
                line: getLine(),
                fetchImpl: wrapFetchWithAbortSignal(runtime.fetchImpl, signal),
                cacheDir: runtime.cacheDir,
                noCache: runtime.noCache,
            });
            return {
                content: [{ type: "text", text: formatMineResultForAgent(result) }],
                details: result,
            };
        },
    });

    const writeMskTool = defineTool({
        name: "story_write_msk",
        label: "Write Story Script (.msk)",
        description:
            "Writes a complete MoeSekai Script (.msk) file to the active workspace, automatically saving a pre-mutation rollback snapshot to .moesekai-studio/snapshots/, compiling the result, and returning a structured diff. Actively use optional `z=<int>` (-99..99; higher=front, negative=back, default 0=auto move/speaker front) on `cast set` entries and `stage enter`/`move`/`pose` beats for close-ups, huddles (`overlap`), foreground focus, or depth layering.",
        promptSnippet:
            "story_write_msk: Write complete .msk script (with optional Live2D `z=<int>` depth layering) + automatic rollback snapshot and post-write diff.",
        promptGuidelines: [
            "Use optional `z=<int>` on `cast set` and `stage enter`/`move`/`pose` whenever choreographing close-ups, `overlap` huddles, foreground focus (e.g. `z=10`), or background observers (e.g. `z=-1`).",
            "After story_write_msk or story_patch_msk, always call story_validate_and_simulate to verify 0 errors, 0 warnings, and reachable endings.",
        ],
        parameters: Type.Object({
            script: Type.String({ description: "Complete .msk script content." }),
            reason: Type.Optional(Type.String({ description: "Short description saved with the rollback snapshot." })),
        }),
        async execute(_toolCallId, params) {
            if (runtime.isMutationBlockedByPlan?.()) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                "Blocked: Plan-first mode is active and the plan has not been approved by the user yet. "
                                + "Submit a plan with story_submit_plan (if not submitted) and wait for user approval before writing .msk.",
                        },
                    ],
                    details: { blockedByPlanApproval: true } as unknown,
                    isError: true,
                };
            }

            const result = await writeStoryScript(runtime.getWorkspaceDir(), getStory(), params.script, {
                reason: params.reason ?? "story_write_msk",
                toolName: "story_write_msk",
            });
            if (result.snapshot) runtime.onSnapshotCreated?.(result.snapshot);
            runtime.onMskDiff?.(result.diff, result.storyFile);

            const summaryLines = [
                `Wrote ${result.storyFile}${result.snapshot ? ` (snapshot: ${result.snapshot.id})` : " (initial file)"}.`,
                `Parse: ${result.parseOk ? "OK" : `FAILED (${result.parseDiagnostics.length} error(s))`} | Compile: ${result.compileOk ? "OK" : "FAILED"} (errors=${result.errors.length}, warnings=${result.warnings.length})`,
                `Diff: nodes ${result.diff.nodeCountBefore} -> ${result.diff.nodeCountAfter} (+${result.diff.addedNodeIds.length}/-${result.diff.removedNodeIds.length}/~${result.diff.modifiedNodeIds.length}), beats ${result.diff.beatCountBefore} -> ${result.diff.beatCountAfter} (${result.diff.beatCountDelta >= 0 ? "+" : ""}${result.diff.beatCountDelta})`,
            ];
            if (result.parseDiagnostics.length > 0) {
                summaryLines.push(
                    "Parse errors:\n"
                    + result.parseDiagnostics.map((d) => `  Line ${d.line}:${d.col}: ${d.message}`).join("\n"),
                );
            }
            if (result.errors.length > 0) {
                summaryLines.push(
                    "Compile errors:\n" + result.errors.map((e) => `  - ${e.code} @ ${e.nodeId ?? e.path}`).join("\n"),
                );
            }
            if (result.warnings.length > 0) {
                summaryLines.push(
                    "Compile warnings:\n" + result.warnings.map((w) => `  - ${w.code} @ ${w.nodeId ?? w.path}`).join("\n"),
                );
            }
            return {
                content: [{ type: "text", text: summaryLines.join("\n") }],
                details: result as unknown,
            };
        },
    });

    const patchMskTool = defineTool({
        name: "story_patch_msk",
        label: "Patch Story Script (.msk)",
        description:
            "Applies targeted edits to the active .msk script via exact string replacements (`edits`) or whole-node replacement (`replaceNode`), saving an automatic pre-mutation rollback snapshot and returning compile diagnostics and structured diff. Supports adjusting Live2D `z=<int>` layers (-99..99) on `cast set` and `stage enter`/`move`/`pose` to resolve occlusion or set foreground/background depth.",
        promptSnippet:
            "story_patch_msk: Surgically patch .msk via exact edits or replaceNode (including Live2D `z=<int>` layering), with automatic snapshot and diff.",
        promptGuidelines: [
            "When fixing Live2D occlusion or adjusting close-up/huddle foreground priority, set explicit `z=<int>` (higher = front, negative = back, omitted/0 = auto move/speaker front) on `cast set` or `stage enter`/`move`/`pose`.",
        ],
        parameters: Type.Object({
            edits: Type.Optional(
                Type.Array(
                    Type.Object({
                        find: Type.String({ description: "Exact existing text to locate in story.msk." }),
                        replace: Type.String({ description: "Replacement text." }),
                        replaceAll: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default false)." })),
                    }),
                ),
            ),
            replaceNode: Type.Optional(
                Type.Object({
                    nodeId: Type.String({ description: "ID of existing start/scene/choice/condition/end node to replace." }),
                    msk: Type.String({ description: "Complete replacement .msk block for that node." }),
                }),
            ),
            reason: Type.Optional(Type.String({ description: "Short reason saved on the rollback snapshot." })),
        }),
        async execute(_toolCallId, params) {
            if (runtime.isMutationBlockedByPlan?.()) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                "Blocked: Plan-first mode is active and the plan has not been approved by the user yet. "
                                + "Submit a plan with story_submit_plan (if not submitted) and wait for user approval before patching .msk.",
                        },
                    ],
                    details: { blockedByPlanApproval: true } as unknown,
                    isError: true,
                };
            }

            const result = await patchStoryScript(
                runtime.getWorkspaceDir(),
                getStory(),
                {
                    edits: params.edits,
                    replaceNode: params.replaceNode,
                    reason: params.reason,
                },
                { toolName: "story_patch_msk" },
            );
            if (result.snapshot) runtime.onSnapshotCreated?.(result.snapshot);
            runtime.onMskDiff?.(result.diff, result.storyFile);

            const summaryLines = [
                `Patched ${result.storyFile}${result.snapshot ? ` (snapshot: ${result.snapshot.id})` : ""}.`,
                `Parse: ${result.parseOk ? "OK" : `FAILED (${result.parseDiagnostics.length} error(s))`} | Compile: ${result.compileOk ? "OK" : "FAILED"} (errors=${result.errors.length}, warnings=${result.warnings.length})`,
                `Nodes changed: +[${result.diff.addedNodeIds.join(",")}] ~[${result.diff.modifiedNodeIds.join(",")}] -[${result.diff.removedNodeIds.join(",")}] | beats delta: ${result.diff.beatCountDelta >= 0 ? "+" : ""}${result.diff.beatCountDelta}`,
            ];
            if (result.errors.length > 0) {
                summaryLines.push(
                    "Compile errors:\n" + result.errors.map((e) => `  - ${e.code} @ ${e.nodeId ?? e.path}`).join("\n"),
                );
            }
            if (result.warnings.length > 0) {
                summaryLines.push(
                    "Compile warnings:\n" + result.warnings.map((w) => `  - ${w.code} @ ${w.nodeId ?? w.path}`).join("\n"),
                );
            }
            return {
                content: [{ type: "text", text: summaryLines.join("\n") }],
                details: result as unknown,
            };
        },
    });

    const validateAndSimulateTool = defineTool({
        name: "story_validate_and_simulate",
        label: "Validate & Simulate Story",
        description:
            "Runs strict .msk syntax parsing, graph compilation (0 errors, 0 warnings check), exhaustive branch/ending simulation (checking every ending is reachable, 0 deadlocks, 0 unintended stage overlaps), and optional live CDN asset & Live2D clip verification with 'did you mean' suggestions.",
        promptSnippet:
            "story_validate_and_simulate: Strictly validate .msk, exhaustively simulate all branches/endings, and optionally verify CDN assets.",
        parameters: Type.Object({
            strict: Type.Optional(Type.Boolean({ description: "Check 0 errors, 0 warnings, and 0 simulation anomalies (default true)." })),
            simulate: Type.Optional(Type.Boolean({ description: "Run exhaustive branch & ending simulator (default true)." })),
            verifyAssets: Type.Optional(Type.Boolean({ description: "Verify Live2D models, motions, facials, BGs, BGMs, SEs, and voices against Moesekai CDN (default false)." })),
            maxPaths: Type.Optional(Type.Number({ description: "Max branch paths to simulate (1..1000, default 64)." })),
            regionOverride: Type.Optional(REGIONS_UNION),
        }),
        async execute(_toolCallId, params, signal) {
            const absStory = resolveSafeWorkspacePath(runtime.getWorkspaceDir(), getStory());
            const source = normalizeLineEndings(await readFile(absStory, "utf8"));
            const report = await validateAndSimulateStory(source, {
                strict: params.strict ?? true,
                simulate: params.simulate ?? true,
                verifyAssets: params.verifyAssets ?? false,
                maxPaths: params.maxPaths,
                line: getLine(),
                regionOverride: params.regionOverride as StoryRegion | undefined,
                fetchImpl: wrapFetchWithAbortSignal(runtime.fetchImpl, signal),
            });
            return {
                content: [{ type: "text", text: formatValidationSummary(report) }],
                details: report,
            };
        },
    });

    const i18nPrepareTool = defineTool({
        name: "story_i18n_prepare",
        label: "Prepare Translation or Voice Cue Sheet",
        description:
            "Prepares either (mode='translate') scene-aware multilingual translation chunks with PJSK character speech-habit prompts and outdated-beat status, OR (mode='tts') ordered dialogue voice cue sheets and local user audio file matching status from voices/.",
        promptSnippet:
            "story_i18n_prepare: Build chunked PJSK-aware translation payloads/prompts or extract user voice cue sheets & match local audio files.",
        parameters: Type.Object({
            mode: Type.Union([Type.Literal("translate"), Type.Literal("tts")]),
            targetLocale: Type.Optional(LOCALES_UNION),
            chunkIndex: Type.Optional(Type.Number({ description: "0-based chunk index for mode='translate'." })),
            maxBeatsPerChunk: Type.Optional(Type.Number({ description: "Max beats per translation chunk (default 60)." })),
            onlyOutdated: Type.Optional(Type.Boolean({ description: "Only include missing or outdated beats when an existing pack is present." })),
            onlyMissingOfficialVoice: Type.Optional(Type.Boolean({ description: "For mode='tts', skip lines that already have an official voice() ref." })),
            audioDir: Type.Optional(Type.String({ description: "Relative folder inside workspace to scan for user-supplied audio files (default 'voices')." })),
        }),
        async execute(_toolCallId, params) {
            if (params.mode === "translate") {
                if (!params.targetLocale) {
                    throw new Error("story_i18n_prepare with mode='translate' requires targetLocale.");
                }
                const res = await prepareStoryTranslation(runtime.getWorkspaceDir(), getStory(), {
                    targetLocale: params.targetLocale as UiLocale,
                    chunkIndex: params.chunkIndex,
                    maxBeatsPerChunk: params.maxBeatsPerChunk,
                    onlyOutdated: params.onlyOutdated,
                });
                const text = [
                    `Prepared translation chunk ${res.chunkIndex + 1}/${res.totalChunks} (${res.sourceLocale} -> ${res.targetLocale}, ${res.chunkBeatCount} beats).`,
                    `Existing coverage: ${res.existingCoverage.translatedCount}/${res.existingCoverage.totalCount} translated, ${res.existingCoverage.outdatedCount} outdated, ${res.existingCoverage.missingCount} missing.`,
                    "",
                    res.prompt,
                ].join("\n");
                return { content: [{ type: "text", text }], details: res as unknown };
            }

            const res = await prepareVoiceCueSheet(runtime.getWorkspaceDir(), getStory(), {
                targetLocale: params.targetLocale as UiLocale | undefined,
                onlyMissingOfficialVoice: params.onlyMissingOfficialVoice,
                audioDir: params.audioDir,
            });
            const lines = [
                `Voice cue sheet for story "${res.storyId}" (locale=${res.locale}): ${res.candidateLines.length} candidate line(s) out of ${res.totalTalkBeats} talk beat(s).`,
                `Local audio scan (${res.localAudioScan.audioDir}/): ${res.localAudioScan.matched.length} matched, ${res.localAudioScan.unmatched.length} unmatched.`,
                res.existingManifest
                    ? `Existing voices/manifest.json: ${res.existingManifest.matchedCount}/${res.existingManifest.totalTalkBeats} talk beats matched.`
                    : "Existing voices/manifest.json: none.",
                "",
                "Lines (first 40):",
                ...res.candidateLines.slice(0, 40).map(
                    (c) => `  - ${c.beatId} [${c.nodeId}] ${c.speakerName || "?"}: "${c.text}" -> ${c.recommendedFilename}${c.hasCustomVoice ? " [manifest]" : ""}${c.hasOfficialVoice ? " [official]" : ""}`,
                ),
            ];
            return { content: [{ type: "text", text: lines.join("\n") }], details: res as unknown };
        },
    });

    const i18nApplyTool = defineTool({
        name: "story_i18n_apply",
        label: "Apply Locale Pack or Voice Manifest",
        description:
            "Validates and saves either (mode='locale_pack') a translated StoryLocalePack chunk to locales/<locale>.i18n.json with strict {{var}} placeholder & provenance verification, OR (mode='voice_manifest') a validated voices/manifest.json from JSON or matched local user audio files.",
        promptSnippet:
            "story_i18n_apply: Validate and save locales/<locale>.i18n.json or voices/manifest.json.",
        parameters: Type.Object({
            mode: Type.Union([Type.Literal("locale_pack"), Type.Literal("voice_manifest")]),
            targetLocale: Type.Optional(LOCALES_UNION),
            rawJson: Type.Optional(Type.String({ description: "JSON payload string for locale pack or voice manifest." })),
            chunkIndex: Type.Optional(Type.Number()),
            maxBeatsPerChunk: Type.Optional(Type.Number()),
            originOverride: Type.Optional(
                Type.Union([Type.Literal("human"), Type.Literal("ai_assisted"), Type.Literal("ai_raw")]),
            ),
            modelHint: Type.Optional(Type.String()),
            note: Type.Optional(Type.String()),
            autoMatchAudioDir: Type.Optional(
                Type.String({ description: "For mode='voice_manifest': auto-generate manifest by matching user audio files in this relative directory (e.g. 'voices')." }),
            ),
            baseUrl: Type.Optional(Type.String({ description: "Optional safe https:// or /... baseUrl for voice manifest." })),
            title: Type.Optional(Type.String({ description: "Optional human-readable title/credit for voice manifest." })),
        }),
        async execute(_toolCallId, params) {
            if (params.mode === "locale_pack") {
                if (!params.targetLocale || !params.rawJson) {
                    throw new Error("story_i18n_apply with mode='locale_pack' requires targetLocale and rawJson.");
                }
                const res = await applyStoryTranslation(runtime.getWorkspaceDir(), getStory(), {
                    targetLocale: params.targetLocale as UiLocale,
                    rawJson: params.rawJson,
                    chunkIndex: params.chunkIndex,
                    maxBeatsPerChunk: params.maxBeatsPerChunk,
                    originOverride: params.originOverride as StoryImportableTranslationOrigin | undefined,
                    modelHint: params.modelHint,
                    note: params.note,
                });
                const lines = [
                    res.ok
                        ? `Saved validated locale pack to ${res.filePath} (${res.validation.stats.importedBeats}/${res.validation.stats.totalExpectedBeats} expected beats imported, missing=${res.validation.stats.missingBeats}, outdated=${res.validation.stats.outdatedBeats}).`
                        : `Locale pack validation FAILED (${res.validation.errors.length} error(s)).`,
                ];
                for (const err of res.validation.errors) {
                    lines.push(`  - [ERROR] ${err.code} @ ${err.path}${err.params ? ` ${JSON.stringify(err.params)}` : ""}`);
                }
                for (const warn of res.validation.warnings.slice(0, 15)) {
                    lines.push(`  - [WARNING] ${warn.code} @ ${warn.path}`);
                }
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    details: res as unknown,
                    isError: !res.ok,
                };
            }

            const res = await applyVoiceManifest(runtime.getWorkspaceDir(), getStory(), {
                rawManifestJson: params.rawJson,
                autoMatchAudioDir: params.autoMatchAudioDir,
                baseUrl: params.baseUrl,
                locale: params.targetLocale as UiLocale | undefined,
                title: params.title,
            });
            const text = res.ok && res.matchSummary
                ? `Saved validated voice manifest to ${res.filePath} (${res.matchSummary.matchedCount}/${res.matchSummary.totalTalkBeats} talk beats matched, ${res.matchSummary.totalManifestLines} line(s) in manifest).`
                : `Voice manifest validation FAILED: ${res.error ?? "unknown error"}`;
            return {
                content: [{ type: "text", text }],
                details: res as unknown,
                isError: !res.ok,
            };
        },
    });

    const editorActionTool = defineTool({
        name: "story_editor_action",
        label: "Control Story Studio Editor UI",
        description:
            "Sends a live UI action to the MoeSekai Story Studio editor renderer (focus a graph node, select a beat, switch between flow/code/playtest mode, start playtest from a node, or open the export dialog).",
        promptSnippet:
            "story_editor_action: Focus a node, select a beat, switch editor mode, playtest from a node, or open the export dialog.",
        parameters: Type.Object({
            kind: Type.Union([
                Type.Literal("focus_node"),
                Type.Literal("select_beat"),
                Type.Literal("switch_mode"),
                Type.Literal("playtest_from_node"),
                Type.Literal("open_export_dialog"),
            ]),
            nodeId: Type.Optional(Type.String({ description: "Target node ID (required for focus_node, select_beat, playtest_from_node)." })),
            beatId: Type.Optional(Type.String({ description: "Target beat ID (required for select_beat)." })),
            mode: Type.Optional(
                Type.Union([
                    Type.Literal("edit"),
                    Type.Literal("flow"),
                    Type.Literal("code"),
                    Type.Literal("playtest"),
                ]),
            ),
            format: Type.Optional(
                Type.Union([Type.Literal("msk"), Type.Literal("bundle"), Type.Literal("i18n")]),
            ),
        }),
        async execute(_toolCallId, params) {
            let action: StoryEditorAction;
            switch (params.kind) {
                case "focus_node":
                    if (!params.nodeId) throw new Error("focus_node requires nodeId.");
                    action = { kind: "focus_node", nodeId: params.nodeId };
                    break;
                case "select_beat":
                    if (!params.nodeId || !params.beatId) throw new Error("select_beat requires nodeId and beatId.");
                    action = { kind: "select_beat", nodeId: params.nodeId, beatId: params.beatId };
                    break;
                case "switch_mode":
                    if (!params.mode) throw new Error("switch_mode requires mode.");
                    action = { kind: "switch_mode", mode: params.mode };
                    break;
                case "playtest_from_node":
                    if (!params.nodeId) throw new Error("playtest_from_node requires nodeId.");
                    action = { kind: "playtest_from_node", nodeId: params.nodeId };
                    break;
                case "open_export_dialog":
                    action = { kind: "open_export_dialog", ...(params.format ? { format: params.format } : {}) };
                    break;
            }
            runtime.onEditorAction?.(action);
            return {
                content: [{ type: "text", text: `Dispatched editor action: ${JSON.stringify(action)}` }],
                details: { action },
            };
        },
    });

    return [
        reportStageTool,
        submitPlanTool,
        readWorkspaceTool,
        mineOfficialTool,
        writeMskTool,
        patchMskTool,
        validateAndSimulateTool,
        i18nPrepareTool,
        i18nApplyTool,
        editorActionTool,
    ];
}
