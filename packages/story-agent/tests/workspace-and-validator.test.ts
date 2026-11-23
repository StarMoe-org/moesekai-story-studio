import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    listStorySnapshots,
    patchStoryScript,
    readStoryWorkspace,
    resolveSafeWorkspacePath,
    rollbackStorySnapshot,
    writeStoryScript,
} from "../src/workspace";
import { validateAndSimulateStory } from "../src/validator";

const VALID_STORY_MSK = `@story "After-School Mini Practice" region=jp id="demo_story" author="Moesekai" summary="A short branching demo."

@var harmony: number = 0 "Harmony"
@var invited: boolean = false "Invited"

@cast ichika "Hoshino Ichika" model="v2_01ichika_casual" char=1
@cast saki "Tenma Saki" model="v2_02saki_casual" char=2

start -> scene_open

scene scene_open "After-School Classroom" {
  bg set "bg_a000401"
  bgm play "bgm00020" vol=0.75
  place set "Miyamasuzaka Girls Academy - Classroom"
  transition fadeBlack 0.5
  cast set [
    ichika at left facial="face_smile_01"
    saki at right facial="face_normal_01"
  ]
  telop "After-School Mini Practice"
  talk ichika "Good work today, Saki!" motion="w-normal01-nod" facial="face_smile_01" react(saki motion="w-normal01-glad" facial="face_sparkling_01") se="se_pack00001_b/se00001_b" seVol=0.7
  talk saki "Hehe, let's make the most of today!" motion="w-normal01-pose" facial="face_wink_01"
} -> choice_plan

choice choice_plan "What next?" {
  opt_practice: "Rehearse the chorus" [harmony += 1, invited = true] -> scene_practice
  opt_cafe: "Visit the sweets shop" -> scene_cafe
}

scene scene_practice "Rehearsal" {
  bg inherit
  bgm inherit
  place inherit
  transition none 0.4
  cast inherit
  stage move ichika to center dur=0.4 overlap facial="face_shy_01"
  stage move saki to center dur=0.45 overlap facial="face_sparkling_01"
  talk saki "Let's read the score together right here!" motion="w-normal01-glad" facial="face_sparkling_01" react(ichika motion="w-normal01-nod" facial="face_smile_01")
} -> cond_end

scene scene_cafe "Sweets Shop" {
  bg set "bg_a001401"
  bgm play "bgm00045" vol=0.72
  place set "Corner Cafe"
  transition fadeBlack 0.5
  cast set [
    ichika at left facial="face_smile_01"
    saki at right facial="face_sparkling_01"
  ]
  talk saki "Strawberry parfait time!" motion="w-normal01-pose" facial="face_sparkling_01"
} -> cond_end

condition cond_end "Ending Check" {
  rule_sync: if harmony >= 1 "In Sync" -> end_sync
  else -> end_cafe
}

end end_sync "In-Sync Ending" subtitle="Harmony reached {{harmony}}!"
end end_cafe "Sweet Ending" subtitle="Recharged for tomorrow! (Harmony: {{harmony}})"
`;

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "moesekai-agent-test-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!;
        await rm(dir, { recursive: true, force: true });
    }
});

describe("workspace snapshots, diff, patch & rollback", () => {
    test("rejects paths escaping workspaceDir", () => {
        const root = join(tmpdir(), "story-jail-root");
        expect(() => resolveSafeWorkspacePath(root, "../outside.msk")).toThrow();
        expect(() => resolveSafeWorkspacePath(root, "/etc/passwd")).toThrow();
        expect(() => resolveSafeWorkspacePath(root, "C:/Windows/win.ini")).toThrow();
        expect(resolveSafeWorkspacePath(root, "story.msk")).toBe(join(root, "story.msk"));
    });

    test("write -> patch -> snapshot -> rollback roundtrip with structured diff", async () => {
        const dir = await makeTempWorkspace();

        // 1. Initial write creates story.msk (no prior snapshot)
        const writeRes = await writeStoryScript(dir, "story.msk", VALID_STORY_MSK, {
            reason: "initial draft",
        });
        expect(writeRes.parseOk).toBe(true);
        expect(writeRes.compileOk).toBe(true);
        expect(writeRes.snapshot).toBeNull();
        expect(writeRes.diff.addedNodeIds).toContain("scene_open");
        expect(writeRes.diff.addedCastKeys).toEqual(["ichika", "saki"]);
        expect(writeRes.diff.addedVarIds).toEqual(["harmony", "invited"]);

        // 2. Read workspace outline + selected node context
        const ws = await readStoryWorkspace(dir, "story.msk", { selectedNodeId: "scene_cafe" });
        expect(ws.exists).toBe(true);
        expect(ws.parseOk).toBe(true);
        expect(ws.endings.length).toBe(2);
        expect(ws.selectedNodeContext?.nodeId).toBe("scene_cafe");
        expect(ws.selectedNodeContext?.mskSnippet).toContain("Strawberry parfait time!");

        // 3. Patch via exact edit (creates pre-mutation snapshot #1)
        const patch1 = await patchStoryScript(dir, "story.msk", {
            edits: [
                {
                    find: 'talk saki "Strawberry parfait time!"',
                    replace: 'talk saki "Matcha parfait time!"\n  talk ichika "Looks delicious!"',
                },
            ],
            reason: "update cafe dialogue",
        });
        expect(patch1.parseOk).toBe(true);
        expect(patch1.compileOk).toBe(true);
        expect(patch1.snapshot).not.toBeNull();
        expect(patch1.diff.modifiedNodeIds).toContain("scene_cafe");
        expect(patch1.diff.beatCountDelta).toBe(1);
        expect(patch1.diff.unifiedDiffPreview).toContain("-  talk saki \"Strawberry parfait time!\"");
        expect(patch1.diff.unifiedDiffPreview).toContain("+  talk saki \"Matcha parfait time!\"");

        // 4. Patch via replaceNode (creates snapshot #2)
        const patch2 = await patchStoryScript(dir, "story.msk", {
            replaceNode: {
                nodeId: "end_cafe",
                msk: 'end end_cafe "Parfait Ending" subtitle="Sweet treat! (Harmony: {{harmony}})"',
            },
            reason: "rename cafe ending",
        });
        expect(patch2.parseOk).toBe(true);
        expect(patch2.diff.modifiedNodeIds).toEqual(["end_cafe"]);

        const snapshots = await listStorySnapshots(dir);
        expect(snapshots.length).toBe(2);

        // 5. Rollback to snapshot #1 (original VALID_STORY_MSK)
        const rolled = await rollbackStorySnapshot(dir, "story.msk", patch1.snapshot!.id);
        expect(rolled.ok).toBe(true);
        expect(rolled.safetySnapshotId).not.toBeNull();
        expect(rolled.diff.beatCountDelta).toBe(-1);

        const restoredRaw = await readFile(join(dir, "story.msk"), "utf8");
        expect(restoredRaw).toContain("Strawberry parfait time!");
        expect(restoredRaw).toContain('end end_cafe "Sweet Ending"');
    });
});

describe("validator, exhaustive simulator & asset verifier", () => {
    test("passes strict validation and reaches 100% endings on clean story", async () => {
        const report = await validateAndSimulateStory(VALID_STORY_MSK, {
            strict: true,
            simulate: true,
        });
        expect(report.ok).toBe(true);
        expect(report.strictOk).toBe(true);
        expect(report.errors).toHaveLength(0);
        expect(report.warnings).toHaveLength(0);
        expect(report.simulation?.reachedEndings.sort()).toEqual(["end_cafe", "end_sync"]);
        expect(report.simulation?.unreachedEndings).toHaveLength(0);
        expect(report.simulation?.deadlockPaths).toBe(0);
        expect(report.simulation?.stageOverlaps).toHaveLength(0);
    });

    test("detects mergeNodeInheritAmbiguous, undeclared overlap, unreached ending & self-heals", async () => {
        const broken = `@story "Broken Demo" region=jp id="broken_demo"
@var flag: boolean = false "Flag"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
@cast saki "Saki" model="v2_02saki_casual" char=2

start -> choice_a

choice choice_a "Pick" {
  opt1: "Left" -> scene_merge
  opt2: "Right" -> scene_merge
}

scene scene_merge "Merge With Inherit" {
  bg inherit
  bgm inherit
  place inherit
  cast set [
    ichika at center
    saki at center
  ]
  talk ichika "Oops we overlap and inherited on a merge node!"
} -> cond_check

condition cond_check "Check" {
  r1: if flag == true -> end_unreachable
  else -> end_ok
}

end end_ok "OK End"
end end_unreachable "Never Reached"
`;
        const report = await validateAndSimulateStory(broken, { strict: true, simulate: true });
        expect(report.ok).toBe(true); // warnings & sim anomalies fail strictOk
        expect(report.strictOk).toBe(false);
        const warnCodes = report.warnings.map((w) => w.code);
        expect(warnCodes).toContain("mergeNodeInheritAmbiguous");
        expect(warnCodes).toContain("stageSlotDuplicate");
        expect(report.simulation?.unreachedEndings).toContain("end_unreachable");
        expect(report.simulation?.stageOverlaps.length).toBeGreaterThan(0);

        // Self-heal by setting explicit slots, distinct actor slots, and making flag reachable
        const dir = await makeTempWorkspace();
        await writeStoryScript(dir, "story.msk", broken);
        await patchStoryScript(dir, "story.msk", {
            edits: [
                {
                    find: 'opt1: "Left" -> scene_merge',
                    replace: 'opt1: "Left" [flag = true] -> scene_merge',
                },
                {
                    find: `scene scene_merge "Merge With Inherit" {\n  bg inherit\n  bgm inherit\n  place inherit\n  cast set [\n    ichika at center\n    saki at center\n  ]`,
                    replace: `scene scene_merge "Merge Explicit" {\n  bg set "bg_a000401"\n  bgm stop\n  place set "Classroom"\n  cast set [\n    ichika at left\n    saki at right\n  ]`,
                },
            ],
        });
        const healedRaw = await readFile(join(dir, "story.msk"), "utf8");
        const healedReport = await validateAndSimulateStory(healedRaw, { strict: true, simulate: true });
        expect(healedReport.strictOk).toBe(true);
        expect(healedReport.warnings).toHaveLength(0);
        expect(healedReport.simulation?.unreachedEndings).toHaveLength(0);
    });

    test("live asset verification reports missing facial with 'did you mean' suggestions", async () => {
        const storyWithTypoFacial = VALID_STORY_MSK.replace(
            'facial="face_wink_01"',
            'facial="face_worry_01"',
        );
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/jp/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        view: "canonical",
                        published_version: "7.1.0-test",
                        directories: ["live2d"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp/live2d/model/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_01ichika_casual", "v2_02saki_casual"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp/live2d/motion/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2_01ichika_motion_base", "v2_02saki_motion_base"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_01ichika_motion_base.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/motion/v2_01ichika_motion_base",
                        form: "live2d-motions",
                        form_version: 2,
                        members: [
                            { role: "motion/w-normal01-nod", extension: "json" },
                            { role: "facial/face_smile_01", extension: "json" },
                            { role: "facial/face_shy_01", extension: "json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_02saki_motion_base/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: ["v2"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_02saki_motion_base/v2/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: [],
                        files: [{ name: "buildmotiondata.asset.json" }],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-test/live2d/motion/v2_02saki_motion_base/v2/buildmotiondata.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/motion/v2_02saki_motion_base/v2/buildmotiondata",
                        form: "live2d-motions",
                        form_version: 2,
                        members: [
                            { role: "motion/w-normal01-glad", extension: "json" },
                            { role: "motion/w-normal01-pose", extension: "json" },
                            { role: "facial/face_normal_01", extension: "json" },
                            { role: "facial/face_sparkling_01", extension: "json" },
                            { role: "facial/face_trouble_01", extension: "json" },
                            { role: "facial/face_sad_01", extension: "json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (init?.method === "HEAD") {
                return new Response(null, { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const report = await validateAndSimulateStory(storyWithTypoFacial, {
            strict: true,
            simulate: true,
            verifyAssets: true,
            fetchImpl: mockFetch,
        });

        expect(report.ok).toBe(false);
        expect(report.assets?.live2dSiteUrl).toBe("https://storage.pjsk.moe");
        expect(report.assets?.live2dModelListingUrl).toBe("https://storage.pjsk.moe/jp/live2d/model/");
        expect(report.assets?.live2dMotionListingUrl).toBe("https://storage.pjsk.moe/jp/live2d/motion/");
        expect(report.assets?.live2d[0]?.modelAssetPath).toBe("live2d/model/v2_01ichika_casual");
        expect(report.assetVerification?.ok).toBe(false);
        expect(report.assetVerification?.live2dSource).toBe("asset-site-listings");
        expect(report.assetVerification?.live2dPublishedVersion).toBe("7.1.0-test");
        const missingFacial = report.assetVerification?.missing.find(
            (m) => m.category === "live2d-facial" && m.name === "v2_02saki_casual:face_worry_01",
        );
        expect(missingFacial).toBeDefined();
        expect(missingFacial?.suggestions).toContain("face_trouble_01");
    });

    test("live asset verification supports asset-document-fallback when model listing is unavailable", async () => {
        const simpleStory = `@story "Fallback Check" region=jp id="fallback_check"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1
start -> scene_1
scene scene_1 "Open" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  cast set [
    ichika at center facial="face_smile_01"
  ]
  talk ichika "Hello!" motion="w-normal01-nod" facial="face_smile_01"
} -> end_1
end end_1 "Done"
`;
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url === "https://storage.pjsk.moe/jp/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        published_version: "7.1.0-fallback",
                        directories: ["live2d"],
                        files: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-fallback/live2d/model/v2_01ichika_casual/") {
                return new Response(
                    JSON.stringify({
                        format: "directory-listing",
                        version: 1,
                        directories: [],
                        files: [
                            { name: "model3.asset.json" },
                            { name: "buildmodeldata.asset.json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-fallback/live2d/model/v2_01ichika_casual/model3.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/model/v2_01ichika_casual/model3",
                        form: "text",
                        members: [],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-fallback/live2d/model/v2_01ichika_casual/buildmodeldata.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/model/v2_01ichika_casual/buildmodeldata",
                        form: "live2d-model",
                        form_version: 2,
                        members: [{ role: "moc", extension: "moc3" }],
                    }),
                    { status: 200 },
                );
            }
            if (url === "https://storage.pjsk.moe/jp@7.1.0-fallback/live2d/motion/v2_01ichika_motion_base.asset.json") {
                return new Response(
                    JSON.stringify({
                        format: "asset",
                        version: 1,
                        name: "live2d/motion/v2_01ichika_motion_base",
                        form: "live2d-motions",
                        form_version: 2,
                        members: [
                            { role: "motion/w-normal01-nod", extension: "json" },
                            { role: "facial/face_smile_01", extension: "json" },
                        ],
                    }),
                    { status: 200 },
                );
            }
            if (init?.method === "HEAD") {
                return new Response(null, { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const report = await validateAndSimulateStory(simpleStory, {
            strict: true,
            simulate: true,
            verifyAssets: true,
            fetchImpl: mockFetch,
        });

        expect(report.ok).toBe(true);
        expect(report.assetVerification?.ok).toBe(true);
        expect(report.assetVerification?.live2dSource).toBe("asset-document-fallback");
        expect(report.assetVerification?.live2dPublishedVersion).toBe("7.1.0-fallback");
        expect(report.assetVerification?.checked.live2dModels).toBe(1);
        expect(report.assetVerification?.checked.live2dClips).toBe(2);
    });

    test("detects choice deadlock when all options have false guards", async () => {
        const deadlocked = `@story "Deadlock Demo" region=jp id="deadlock_demo"
@var unlocked: boolean = false "Unlocked"
@cast ichika "Ichika" model="v2_01ichika_casual" char=1

start -> scene_1

scene scene_1 "Start" {
  bg set "bg_a000401"
  bgm stop
  place set "Room"
  cast set [
    ichika at center
  ]
  talk ichika "Choose carefully."
} -> choice_locked

choice choice_locked "Locked Choice" {
  opt1: "Door A" if unlocked == true -> end_a
  opt2: "Door B" if unlocked == true -> end_b
}

end end_a "End A"
end end_b "End B"
`;
        const report = await validateAndSimulateStory(deadlocked, { strict: true, simulate: true });
        expect(report.strictOk).toBe(false);
        expect(report.simulation?.deadlockPaths).toBe(1);
        expect(report.simulation?.unreachedEndings.sort()).toEqual(["end_a", "end_b"]);
    });
});
