import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    collectAssetReport,
    validateAndSimulateStory,
} from "../src/validator";
import {
    readStoryWorkspace,
    writeStoryScript,
} from "../src/workspace";
import { buildStoryAgentSystemPrompt } from "../src/prompt";
import { buildPresetPrompt } from "../src/presets";
import { createStoryMakerTools } from "../src/tools";
import { createNodeWorkspaceFiles } from "../src/node";

const CHOREOGRAPHY_STORY_MSK = `@story "Stage Choreography Showcase" region=jp id="stage_choreo_showcase" author="Moesekai"

@var joined: boolean = false "Joined"

@cast ichika "Hoshino Ichika" model="v2_01ichika_casual" char=1
@cast saki "Tenma Saki" model="v2_02saki_casual" char=2
@cast honami "Mochizuki Honami" model="v2_03honami_casual" char=3
@cast shiho "Hinomori Shiho" model="v2_04shiho_casual" char=4

start -> scene_opening

scene scene_opening "Opening Title & Deferred Cast" {
  bg set "bg_a000401"
  bgm play "bgm00020" vol=0.72
  place set "Miyamasuzaka Classroom"
  transition fadeBlack 0.5
  cast set afterTelop delay=0.2 dur=0.5 [
    ichika at center lock facial="face_smile_01"
    saki at right x=0.52 facial="face_normal_01"
  ]
  telop "Chapter 1: After School"
  talk ichika "We waited for the title card before stepping in!" motion="w-normal01-nod" facial="face_smile_01"
  telop "Later that afternoon..." actors=hide pos=top
  stage enter honami at left dur=0.4 facial="face_smile_01"
  talk honami "Sorry I'm late!" motion="w-normal01-glad" facial="face_smile_01"
  stage exit honami dur=0.35
  stage enter shiho at left dur=0.4 facial="face_normal_01"
  talk shiho "Let's tune up right away." motion="w-normal01-nod" facial="face_normal_01"
} -> choice_next

choice choice_next "How to rehearse?" {
  opt_duet: "Bring everyone together" [joined = true] -> scene_sync
  opt_solo: "Wrap up early" -> scene_pinned
}

scene scene_sync "Simultaneous Sync Choreography" {
  bg inherit
  bgm inherit
  place inherit
  transition none 0.4
  cast set fixed [
    ichika at left x=-0.55 lock facial="face_smile_01"
  ]
  stage sync [ enter saki at center x=0 facial="face_sparkling_01"; enter honami at right x=0.55 mirror facial="face_smile_01" ] dur=0.45 delay=0.1
  talk saki "We both entered at the exact same beat!" motion="w-normal01-pose" facial="face_sparkling_01"
  stage pose ichika facial="face_wink_01" parallel
  stage sync [ exit saki; exit honami ] dur=0.35
  talk ichika "And both exited together cleanly." motion="w-normal01-nod" facial="face_smile_01"
} -> end_done

scene scene_pinned "Fine-Tuned Explicit X" {
  bg inherit
  bgm inherit
  place inherit
  transition none 0.4
  cast set fixed [
    ichika at center x=-0.42 lock facial="face_smile_01"
    saki at center x=0.42 lock facial="face_wink_01"
  ]
  talk saki "Same semantic slot, well-separated explicit x!" motion="w-normal01-glad" facial="face_wink_01"
} -> end_done

end end_done "Rehearsal Complete" subtitle="Choreography verified"
`;

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "moesekai-choreo-agent-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        await rm(dir, { recursive: true, force: true });
    }
});

describe("Live2D stage choreography validation, assets & workspace preview", () => {
    test("validateAndSimulateStory passes strict simulation with zero false overlaps on afterTelop, sync groups, telop actors=hide, and incremental/pinned layouts", async () => {
        const report = await validateAndSimulateStory(CHOREOGRAPHY_STORY_MSK, {
            strict: true,
            simulate: true,
            assets: true,
            verifyAssets: false,
        });

        expect(report.parseDiagnostics).toEqual([]);
        expect(report.errors).toEqual([]);
        expect(report.warnings).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.strictOk).toBe(true);
        expect(report.simulation?.skipped).toBeUndefined();
        expect(report.simulation?.totalPaths).toBe(2);
        expect(report.simulation?.unreachedEndings).toEqual([]);
        expect(report.simulation?.stageOverlaps).toEqual([]);
        expect(report.simulation?.offStageTalks).toEqual([]);

        // collectAssetReport must include clips declared inside grouped `stage sync [...]` items
        const sakiAsset = report.assets?.live2d.find((m) => m.castKeys.includes("saki"));
        const honamiAsset = report.assets?.live2d.find((m) => m.castKeys.includes("honami"));
        expect(sakiAsset?.facials).toContain("face_sparkling_01");
        expect(honamiAsset?.facials).toContain("face_smile_01");
    });

    test("collectAssetReport & verifyAssetsLive inspect grouped stage sync items and flag typos with clip suggestions", async () => {
        const typoStory = `@story "Grouped Sync Typo" region=jp id="sync_typo"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
@cast saki "Saki" model="v2_02saki_casual" char=2
start -> scene_1
scene scene_1 "Sync" {
  bg set "bg_a000401"
  bgm stop
  place set "Room"
  cast set []
  stage sync [ enter ichika at left motion="w-normal01-nod" facial="face_smile_01"; enter saki at right motion="w-normal01-nod" facial="face_sparkle_typo_99" ] dur=0.4
  talk saki "Hi!"
} -> end_1
end end_1 "Done"
`;

        const VERSION = "7.2.0-sync";
        const ichikaModel = "live2d/model/v2_01ichika_casual/buildmodeldata";
        const sakiModel = "live2d/model/v2_02saki_casual/buildmodeldata";
        const ichikaMotion = "live2d/motion/v2_01ichika_motion_base/buildmotiondata";
        const sakiMotion = "live2d/motion/v2_02saki_motion_base/buildmotiondata";

        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/listings/jp/canonical/live2d-model") {
                return new Response(JSON.stringify({
                    format: "form-listing",
                    version: 1,
                    view: "canonical",
                    published_version: VERSION,
                    form: "live2d-model",
                    assets: [{ name: ichikaModel }, { name: sakiModel }],
                }), { status: 200 });
            }
            if (url === "https://storage.pjsk.moe/listings/jp/canonical/live2d-motions") {
                return new Response(JSON.stringify({
                    format: "form-listing",
                    version: 1,
                    view: "canonical",
                    published_version: VERSION,
                    form: "live2d-motions",
                    assets: [{ name: ichikaMotion }, { name: sakiMotion }],
                }), { status: 200 });
            }
            if (url === `https://storage.pjsk.moe/jp@${VERSION}/${ichikaMotion}.asset.json`) {
                return new Response(JSON.stringify({
                    format: "asset",
                    version: 1,
                    name: ichikaMotion,
                    form: "live2d-motions",
                    form_version: 2,
                    members: [
                        { role: "motion/w-normal01-nod", extension: "json" },
                        { role: "facial/face_smile_01", extension: "json" },
                    ],
                }), { status: 200 });
            }
            if (url === `https://storage.pjsk.moe/jp@${VERSION}/${sakiMotion}.asset.json`) {
                return new Response(JSON.stringify({
                    format: "asset",
                    version: 1,
                    name: sakiMotion,
                    form: "live2d-motions",
                    form_version: 2,
                    members: [
                        { role: "motion/w-normal01-nod", extension: "json" },
                        { role: "facial/face_sparkling_01", extension: "json" },
                        { role: "facial/face_smile_01", extension: "json" },
                    ],
                }), { status: 200 });
            }
            if (init?.method === "HEAD") {
                return new Response(null, { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const report = await validateAndSimulateStory(typoStory, {
            strict: true,
            simulate: true,
            verifyAssets: true,
            fetchImpl: mockFetch,
        });

        expect(report.ok).toBe(false);
        expect(report.strictOk).toBe(false);
        expect(report.assetVerification?.ok).toBe(false);
        const missingFacial = report.assetVerification?.missing.find(
            (m) => m.category === "live2d-facial" && m.name.includes("face_sparkle_typo_99"),
        );
        expect(missingFacial).toBeDefined();
        expect(missingFacial?.suggestions).toContain("face_sparkling_01");

        // Also check direct collectAssetReport contains both grouped actors' clips
        const parsedRes = await validateAndSimulateStory(typoStory, { simulate: false, assets: true });
        expect(parsedRes.assets?.live2d.find((x) => x.castKeys.includes("ichika"))?.motions).toContain("w-normal01-nod");
        expect(parsedRes.assets?.live2d.find((x) => x.castKeys.includes("saki"))?.facials).toContain("face_sparkle_typo_99");
        expect(typeof collectAssetReport).toBe("function");
    });

    test("validateAndSimulateStory detects genuine explicit-x overlap when actors are placed too close without overlap flag", async () => {
        const tightXStory = `@story "Tight Explicit X" region=jp id="tight_x"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
@cast saki "Saki" model="v2_02saki_casual" char=2
start -> scene_tight
scene scene_tight "Too Close" {
  bg set "bg_a000401"
  bgm stop
  place set "Room"
  cast set fixed [
    ichika at center x=0.0 lock
    saki at right x=0.12 lock
  ]
  talk ichika "We are way too close!"
} -> end_1
end end_1 "Done"
`;
        const report = await validateAndSimulateStory(tightXStory, {
            strict: true,
            simulate: true,
            verifyAssets: false,
        });

        expect(report.ok).toBe(true);
        expect(report.strictOk).toBe(false);
        expect(report.simulation?.stageOverlaps.length).toBeGreaterThan(0);
        expect(report.simulation?.stageOverlaps.some((o) => o.kind === "overlap")).toBe(true);
    });

    test("readStoryWorkspace beatsPreview formats telop modifiers and grouped stage sync choreography cleanly", async () => {
        const dir = await makeTempWorkspace();
        await writeStoryScript(createNodeWorkspaceFiles(dir), "story.msk", CHOREOGRAPHY_STORY_MSK);

        const wsOpen = await readStoryWorkspace(createNodeWorkspaceFiles(dir), "story.msk", { selectedNodeId: "scene_opening" });
        expect(wsOpen.parseOk).toBe(true);
        const openPreviews = wsOpen.selectedNodeContext?.beatsPreview?.map((b) => b.summary) ?? [];
        expect(openPreviews.some((p) => p.includes("actors=hide") && p.includes("pos=top"))).toBe(true);

        const wsSync = await readStoryWorkspace(createNodeWorkspaceFiles(dir), "story.msk", { selectedNodeId: "scene_sync" });
        expect(wsSync.parseOk).toBe(true);
        const syncPreviews = wsSync.selectedNodeContext?.beatsPreview?.map((b) => b.summary) ?? [];
        expect(syncPreviews.some((p) => p.includes("sync [") && p.includes("enter saki") && p.includes("enter honami") && p.includes("mirror") && p.includes("delay=0.1"))).toBe(true);
        expect(syncPreviews.some((p) => p.includes("pose ichika") && p.includes("parallel"))).toBe(true);
        expect(syncPreviews.some((p) => p.includes("sync [") && p.includes("exit saki") && p.includes("exit honami"))).toBe(true);
    });

    test("agent prompts, presets, and story tools document afterTelop, stage sync, telop actors=hide, and x=/lock with zero 'Pi' leaks", () => {
        const createPrompt = buildStoryAgentSystemPrompt("create", true);
        const editPrompt = buildStoryAgentSystemPrompt("edit", false);
        const authorPreset = buildPresetPrompt("author_story");

        for (const text of [createPrompt, editPrompt, authorPreset]) {
            expect(text).toContain("afterTelop");
            expect(text).toContain("stage sync");
            expect(text).toContain("actors=hide");
            expect(text).toContain("x=");
            expect(text).not.toMatch(/\bPi\b/);
        }

        const tools = createStoryMakerTools({
            getWorkspace: () => createNodeWorkspaceFiles(tmpdir()),
            getStoryFile: () => "story.msk",
        });
        const writeTool = tools.find((t) => t.name === "story_write_msk");
        const patchTool = tools.find((t) => t.name === "story_patch_msk");

        expect(writeTool?.description).toContain("afterTelop");
        expect(writeTool?.description).toContain("stage sync");
        expect(patchTool?.description).toContain("afterTelop");
        expect(patchTool?.description).toContain("stage sync");

        for (const t of tools) {
            for (const s of [t.label, t.description, t.promptSnippet ?? "", ...(t.promptGuidelines ?? [])]) {
                expect(s).not.toMatch(/\bPi\b/);
            }
        }
    });
});
