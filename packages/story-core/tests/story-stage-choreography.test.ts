import { describe, expect, test } from "bun:test";
import {
    SLOT_X,
    STORY_LIMITS,
    advanceRuntime,
    applyStageActionWave,
    castUsage,
    clampActorX,
    clampDelay,
    collectStoryAssets,
    compileStoryGraph,
    createInitialRuntime,
    deferStageCastAfterTelop,
    detectStageActorOverlaps,
    evaluateStageAt,
    findLeadingTelopEndIndex,
    getStageActionItems,
    layoutStageActors,
    parseStoryScript,
    serializeStoryScript,
    setSceneStageCast,
    updateActorInSceneCast,
    updateSceneStageCastSettings,
    validateStoryDocument,
    type StageActionBeat,
    type StoryStageState,
} from "../src/index";

describe("Stable incremental anti-overlap layout & pinning", () => {
    test("clampActorX and clampDelay enforce STORY_LIMITS bounds cleanly", () => {
        expect(STORY_LIMITS.xMin).toBe(-1.2);
        expect(STORY_LIMITS.xMax).toBe(1.2);
        expect(STORY_LIMITS.delayMin).toBe(0);
        expect(STORY_LIMITS.delayMax).toBe(10);

        expect(clampActorX(-2)).toBe(-1.2);
        expect(clampActorX(2)).toBe(1.2);
        expect(clampActorX(0.3456)).toBe(0.346);
        expect(clampActorX(Number.NaN)).toBe(0);

        expect(clampDelay(-1)).toBe(0);
        expect(clampDelay(15)).toBe(10);
        expect(clampDelay(0.25)).toBe(0.25);
        expect(clampDelay(Number.POSITIVE_INFINITY)).toBe(0);
    });

    test("exact user repro: center + right stay at Δx === 0 across left enter, left exit, and second left enter", () => {
        const msk = `@story "Stable Right Pair" region=jp id="stable_right"
@cast charA "Char A" model="v2_01ichika_casual" char=1
@cast charB "Char B" model="v2_02saki_casual" char=2
@cast left1 "Left 1" model="v2_03honami_casual" char=3
@cast left2 "Left 2" model="v2_04shiho_casual" char=4

start -> s1
scene s1 "Classroom" {
  bg set "bg_a000401"
  cast set [
    charA at center
    charB at right
  ]
  talk charA "Initial two characters."
  stage enter left1 at left
  talk left1 "First left character enters."
  stage exit left1
  talk charB "First left character leaves."
  stage enter left2 at left
  talk left2 "Second left character enters."
} -> e1
end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const program = compileStoryGraph(parsed.doc);
        expect(program.ok).toBe(true);
        expect(program.warnings).toHaveLength(0);

        // Frame 1: initial center + right (Math.round(-0.0575 * 1000) / 1000 === -0.057)
        const f1 = createInitialRuntime(program);
        const a1 = f1.stage.actors.find(a => a.cast === "charA")!;
        const b1 = f1.stage.actors.find(a => a.cast === "charB")!;
        expect(a1.x).toBe(-0.057);
        expect(b1.x).toBe(0.423);

        // Frame 2: left1 enters at left -> charA & charB MUST NOT shift (Δx === 0)!
        const f2 = advanceRuntime(program, f1);
        const l1 = f2.stage.actors.find(a => a.cast === "left1")!;
        const a2 = f2.stage.actors.find(a => a.cast === "charA")!;
        const b2 = f2.stage.actors.find(a => a.cast === "charB")!;
        expect(a2.x - a1.x).toBe(0);
        expect(b2.x - b1.x).toBe(0);
        expect(l1.x).toBe(-0.537); // -0.057 - 0.48
        expect(detectStageActorOverlaps(f2.stage.actors)).toEqual({ duplicateSlots: [], overlaps: [] });

        // Frame 3: left1 exits -> charA & charB MUST NOT shift (Δx === 0)!
        const f3 = advanceRuntime(program, f2);
        const a3 = f3.stage.actors.find(a => a.cast === "charA")!;
        const b3 = f3.stage.actors.find(a => a.cast === "charB")!;
        expect(f3.stage.actors.map(a => a.cast)).toEqual(["charA", "charB"]);
        expect(a3.x - a1.x).toBe(0);
        expect(b3.x - b1.x).toBe(0);

        // Frame 4: left2 enters at left -> charA & charB STILL MUST NOT shift (Δx === 0)!
        const f4 = advanceRuntime(program, f3);
        const l2 = f4.stage.actors.find(a => a.cast === "left2")!;
        const a4 = f4.stage.actors.find(a => a.cast === "charA")!;
        const b4 = f4.stage.actors.find(a => a.cast === "charB")!;
        expect(a4.x - a1.x).toBe(0);
        expect(b4.x - b1.x).toBe(0);
        expect(l2.x).toBe(-0.537);
        expect(detectStageActorOverlaps(f4.stage.actors)).toEqual({ duplicateSlots: [], overlaps: [] });
    });

    test("trio left+center+right -> left exits -> left2 enters keeps center (0) & right (+0.573) completely fixed", () => {
        const msk = `@story "Trio Stability" region=jp id="trio_stable"
@cast l1 "L1" model="v2_03honami_casual"
@cast l2 "L2" model="v2_04shiho_casual"
@cast a "A" model="v2_01ichika_casual"
@cast b "B" model="v2_02saki_casual"

start -> s1
scene s1 "Stage" {
  cast set [
    l1 at left
    a at center
    b at right
  ]
  talk a "Trio!"
  stage exit l1
  talk a "L1 left."
  stage enter l2 at left
  talk l2 "L2 arrived."
} -> e1
end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const program = compileStoryGraph(parsed.doc);
        expect(program.ok).toBe(true);

        const f1 = createInitialRuntime(program);
        expect(f1.stage.actors.map(x => [x.cast, x.x])).toEqual([
            ["l1", -0.573],
            ["a", 0],
            ["b", 0.573],
        ]);

        const f2 = advanceRuntime(program, f1);
        expect(f2.stage.actors.map(x => [x.cast, x.x])).toEqual([
            ["a", 0],
            ["b", 0.573],
        ]);

        const f3 = advanceRuntime(program, f2);
        expect(f3.stage.actors.find(x => x.cast === "a")?.x).toBe(0);
        expect(f3.stage.actors.find(x => x.cast === "b")?.x).toBe(0.573);
        expect(f3.stage.actors.find(x => x.cast === "l2")?.x).toBe(-0.48);
    });

    test("Phase 2 weighted fallback spreads stationary actors minimally only when free space is genuinely exhausted", () => {
        const initial = layoutStageActors([
            { cast: "a", slot: "left", x: 0, scale: 1 },
            { cast: "b", slot: "right", x: 0, scale: 1 },
        ]);
        expect(initial.map(x => x.x)).toEqual([-0.365, 0.365]);

        // Enter C directly between A (-0.365) and B (+0.365): gap 0.73 < 2*0.48 -> Phase 2 activates
        const next = layoutStageActors(
            [...initial, { cast: "c", slot: "center", x: SLOT_X.center, scale: 1 }],
            { mode: "incremental", stationaryKeys: new Set(["a", "b"]) },
        );
        expect(next.find(x => x.cast === "a")?.x).toBe(-0.48);
        expect(next.find(x => x.cast === "c")?.x).toBe(0);
        expect(next.find(x => x.cast === "b")?.x).toBe(0.48);
        expect(detectStageActorOverlaps(next)).toEqual({ duplicateSlots: [], overlaps: [] });
    });

    test("explicit x, lockX, and layoutMode: 'fixed' guarantee 0 displacement and accurate overlap auditing", () => {
        // 1. Pinned explicitX in initial & incremental modes never moves even during Phase 2 fallback
        const pinnedInitial = layoutStageActors(
            [
                { cast: "a", slot: "left", x: -0.365, explicitX: -0.365, scale: 1 },
                { cast: "b", slot: "right", x: 0.365, scale: 1 },
                { cast: "c", slot: "center", x: 0, scale: 1 },
            ],
            { mode: "incremental", stationaryKeys: new Set(["a", "b"]) },
        );
        expect(pinnedInitial.find(x => x.cast === "a")?.x).toBe(-0.365); // hard-fixed!
        expect(pinnedInitial.find(x => x.cast === "c")?.x).toBe(0.115);  // -0.365 + 0.48
        expect(pinnedInitial.find(x => x.cast === "b")?.x).toBe(0.595);  // +0.115 + 0.48

        // 2. lockX: true pins current x even without explicitX
        const locked = layoutStageActors(
            [
                { cast: "a", slot: "left", x: -0.2, lockX: true, scale: 1 },
                { cast: "b", slot: "center", x: 0, scale: 1 },
            ],
            { mode: "initial" },
        );
        expect(locked.find(x => x.cast === "a")?.x).toBe(-0.2);
        expect(locked.find(x => x.cast === "b")?.x).toBe(0.28); // -0.2 + 0.48

        // 3. layoutMode: "fixed" preserves exact authored x / SLOT_X with zero shifting
        const fixed = layoutStageActors(
            [
                { cast: "a", slot: "center", x: 0, scale: 1 },
                { cast: "b", slot: "right", x: 0.365, scale: 1 },
                { cast: "c", slot: "farLeft", x: -1.1, explicitX: -1.1, scale: 1 },
            ],
            { layoutMode: "fixed" },
        );
        expect(fixed.map(x => x.x)).toEqual([0, 0.365, -1.1]);

        // 4. detectStageActorOverlaps audits actual finite x directly (no overwrite!)
        // Two actors on same slot "center" with explicitX well separated -> 0 duplicateSlots, 0 overlaps
        const explicitApart = detectStageActorOverlaps([
            { cast: "a", slot: "center", x: -0.5, explicitX: -0.5, scale: 1 },
            { cast: "b", slot: "center", x: 0.5, explicitX: 0.5, scale: 1 },
        ]);
        expect(explicitApart).toEqual({ duplicateSlots: [], overlaps: [] });

        // Two actors with explicitX too close (gap 0.1 < 0.39) without allowOverlap -> overlap detected directly!
        const explicitClose = detectStageActorOverlaps([
            { cast: "a", slot: "left", x: 0, explicitX: 0, scale: 1 },
            { cast: "b", slot: "right", x: 0.1, explicitX: 0.1, scale: 1 },
        ]);
        expect(explicitClose.overlaps).toHaveLength(1);
        expect(explicitClose.overlaps[0]).toMatchObject({ leftActor: "a", rightActor: "b", gap: 0.1 });
    });
});

describe("Simultaneous multi-actor waves (group & parallel)", () => {
    test("getStageActionItems inherits beat-level duration/delay/transition defaults for group items", () => {
        const beat: StageActionBeat = {
            id: "b1",
            kind: "stageAction",
            action: "enter",
            castKey: "a",
            slot: "left",
            duration: 0.6,
            delay: 0.2,
            transition: "instant",
            group: [
                { action: "enter", castKey: "b", slot: "right" },
                { action: "enter", castKey: "c", slot: "center", duration: 0.3, delay: 0, transition: "fade" },
            ],
        };
        const items = getStageActionItems(beat);
        expect(items).toHaveLength(3);
        expect(items[0]).toMatchObject({ castKey: "a", duration: 0.6, delay: 0.2, transition: "instant" });
        expect(items[1]).toMatchObject({ castKey: "b", duration: 0.6, delay: 0.2, transition: "instant" });
        expect(items[2]).toMatchObject({ castKey: "c", duration: 0.3, delay: 0, transition: "fade" });
    });

    test("stageAction.group & parallel chaining execute atomically and update castUsage & collectStoryAssets", () => {
        const msk = `@story "Simultaneous Waves" region=jp id="sync_waves"
@cast a "A" model="v2_01ichika_casual" char=1
@cast b "B" model="v2_02saki_casual" char=2
@cast c "C" model="v2_03honami_casual" char=3
@cast d "D" model="v2_04shiho_casual" char=4

start -> s1
scene s1 "Stage" {
  bg set "bg_a000401"
  cast clear
  stage sync [ enter a at left motion="w-normal01-nod" facial="face_smile_01"; enter b at right motion="w-normal01-glad" facial="face_happy_01" ] dur=0.5 delay=0.1
  talk a "We entered together!"
  stage enter c at farLeft dur=0.4 parallel
  stage enter d at farRight dur=0.4
  talk c "We also entered together via parallel!"
  stage sync [ exit a; exit b ] dur=0.3 instant
  talk c "A and B exited together without shifting C or D!"
} -> e1
end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        // Verify castUsage counts grouped actors too!
        expect(castUsage(parsed.doc, "b")).toBe(2); // group enter + group exit
        expect(castUsage(parsed.doc, "a")).toBe(3); // primary enter + talk + primary exit

        // Verify collectStoryAssets walks group items!
        const assets = collectStoryAssets(parsed.doc);
        const sakiAsset = assets.live2d.find(m => m.modelId === "v2_02saki_casual");
        expect(sakiAsset?.motions).toContain("w-normal01-glad");
        expect(sakiAsset?.facials).toContain("face_happy_01");

        const program = compileStoryGraph(parsed.doc);
        expect(program.ok).toBe(true);
        expect(program.warnings).toHaveLength(0);

        // Frame 1: a & b entered in one sync wave
        const f1 = createInitialRuntime(program);
        expect(f1.stage.actors.map(x => [x.cast, x.x])).toEqual([
            ["a", -0.365],
            ["b", 0.365],
        ]);

        // Frame 2: c & d entered concurrently via parallel chaining -> a & b stay at [-0.365, +0.365] or minimal adjustment
        const f2 = advanceRuntime(program, f1);
        const c2 = f2.stage.actors.find(x => x.cast === "c")!;
        const d2 = f2.stage.actors.find(x => x.cast === "d")!;
        expect(f2.stage.actors).toHaveLength(4);
        // Both parallel stageAction instructions were recorded in executedInstructions
        expect(f2.executedInstructions.filter(inst => inst.op === "stageAction")).toHaveLength(2);
        expect(detectStageActorOverlaps(f2.stage.actors)).toEqual({ duplicateSlots: [], overlaps: [] });

        // Frame 3: a & b exit simultaneously -> c & d keep EXACT x (Δx === 0)!
        const f3 = advanceRuntime(program, f2);
        expect(f3.stage.actors.map(x => x.cast)).toEqual(["c", "d"]);
        expect(f3.stage.actors.find(x => x.cast === "c")?.x).toBe(c2.x);
        expect(f3.stage.actors.find(x => x.cast === "d")?.x).toBe(d2.x);
    });

    test("applyStageActionWave skips layoutStageActors on pose-only and exit-only waves", () => {
        const baseStage: StoryStageState = {
            background: null,
            place: null,
            actors: [
                { cast: "a", slot: "center", x: -0.058, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "b", slot: "right", x: 0.423, y: 0, scale: 1, mirror: false, motion: null, facial: null },
                { cast: "c", slot: "left", x: -0.538, y: 0, scale: 1, mirror: false, motion: null, facial: null },
            ],
            bgm: { name: null, volume: 1 },
            dialogue: null,
            narration: null,
            telop: null,
            screen: { color: "black", covered: false },
            speaking: null,
        };

        const afterPose = applyStageActionWave(baseStage, [
            { action: "pose", castKey: "a", facial: "face_smile_01", mirror: true, z: 5 },
        ]);
        expect(afterPose.actors.map(a => a.x)).toEqual([-0.058, 0.423, -0.538]);
        expect(afterPose.actors[0].mirror).toBe(true);
        expect(afterPose.actors[0].z).toBe(5);

        const afterExit = applyStageActionWave(afterPose, [{ action: "exit", castKey: "c" }]);
        expect(afterExit.actors.map(a => [a.cast, a.x])).toEqual([
            ["a", -0.058],
            ["b", 0.423],
        ]);
    });

    test("compiler rejects duplicate castKey inside a stageAction wave", () => {
        const msk = `@story "Dup Wave" region=jp id="dup_wave"
@cast a "A" model="v2_01ichika_casual"
start -> s1
scene s1 "S" {
  cast clear
  stage sync [ enter a at left; enter a at right ]
  talk a "hi"
} -> e1
end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const compiled = compileStoryGraph(parsed.doc);
        expect(compiled.ok).toBe(false);
        expect(compiled.errors.some(e => e.code === "actorDuplicate")).toBe(true);
    });
});

describe("Deferred enterTiming: 'afterTelop' & telop presentation", () => {
    test("afterTelop emits applyStageCast after leading telops (including interleaved cues), runtime & evaluateStageAt match", () => {
        const msk = `@story "After Telop" region=jp id="after_telop_demo"
@cast kanade "Kanade" model="v2_17kanade_casual" char=17
@cast mafuyu "Mafuyu" model="v2_18mafuyu_casual" char=18

start -> s1
scene s1 "Opening" {
  bg set "bg_e000102"
  cast set afterTelop delay=0.2 dur=0.5 [
    kanade at left mirror facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]
  cue se "se_pack00001/se00124" vol=0.75
  telop "25:00 — Kanade's Room" actors=hide pos=top
  cue wait 0.3
  telop "A few minutes later..." actors=dim pos=bottom
  talk kanade "Finally on stage after both telops!"
} -> s2

scene s2 "Follow-up" {
  bg inherit
  bgm inherit
  place inherit
  cast inherit
  talk mafuyu "Inherited cast!"
} -> e1

end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const validated = validateStoryDocument(parsed.doc);
        expect(validated.ok).toBe(true);
        if (!validated.ok) return;
        expect(validated.program.warnings).toHaveLength(0);

        // Verify IR sequence: enterScene(deferStageCast:true) -> cue -> telop1 -> cue -> telop2 -> applyStageCast -> talk
        const s1StartPc = validated.program.nodeEntryPc.s1;
        const s1Ops = validated.program.instructions.slice(s1StartPc, s1StartPc + 7);
        expect(s1Ops.map(i => i.op)).toEqual([
            "enterScene",
            "cue",
            "telop",
            "cue",
            "telop",
            "applyStageCast",
            "talk",
        ]);
        expect(s1Ops[0].op === "enterScene" && s1Ops[0].deferStageCast).toBe(true);
        expect(s1Ops[5].op === "applyStageCast" && s1Ops[5].sceneId).toBe("s1");

        // Runtime stepping:
        // Frame 1: stopped on telop 1 -> actors MUST be empty!
        const f1 = createInitialRuntime(validated.program);
        expect(f1.stage.telop).toMatchObject({
            body: "25:00 — Kanade's Room",
            actorVisibility: "hide",
            position: "top",
        });
        expect(f1.stage.actors).toHaveLength(0);

        // Frame 2: stopped on telop 2 -> actors STILL empty!
        const f2 = advanceRuntime(validated.program, f1);
        expect(f2.stage.telop).toMatchObject({
            body: "A few minutes later...",
            actorVisibility: "dim",
            position: "bottom",
        });
        expect(f2.stage.actors).toHaveLength(0);

        // Frame 3: talk kanade -> applyStageCast ran, actors now mounted with mirror honored!
        const f3 = advanceRuntime(validated.program, f2);
        expect(f3.executedInstructions.some(i => i.op === "applyStageCast")).toBe(true);
        expect(f3.stage.actors).toHaveLength(2);
        expect(f3.stage.actors.find(a => a.cast === "kanade")?.mirror).toBe(true);
        expect(f3.stage.speaking).toBe("kanade");

        // evaluateStageAt behavior:
        // 1. Scene-level (no beatId / null): mounts actors so editor stage remains editable!
        const atSceneNull = evaluateStageAt(parsed.doc, "s1", null);
        expect(atSceneNull.stage.actors).toHaveLength(2);
        const atSceneUndef = evaluateStageAt(parsed.doc, "s1");
        expect(atSceneUndef.stage.actors).toHaveLength(2);

        // 2. Leading telop beat (by beatId and by numeric beat index): actors unmounted!
        const s1Node = parsed.doc.nodes.s1;
        expect(s1Node.type).toBe("scene");
        if (s1Node.type === "scene") {
            expect(findLeadingTelopEndIndex(s1Node.beats)).toBe(3);
            expect(evaluateStageAt(parsed.doc, "s1", s1Node.beats[1].id).stage.actors).toHaveLength(0);
            expect(evaluateStageAt(parsed.doc, "s1", 1).stage.actors).toHaveLength(0);
            expect(evaluateStageAt(parsed.doc, "s1", 3).stage.actors).toHaveLength(0);
            // 3. Post-telop talk beat: actors ARE mounted!
            expect(evaluateStageAt(parsed.doc, "s1", s1Node.beats[4].id).stage.actors).toHaveLength(2);
            expect(evaluateStageAt(parsed.doc, "s1", 4).stage.actors).toHaveLength(2);
        }

        // 4. Downstream scene with `cast inherit` still receives deferred cast via replayAncestors!
        const atS2 = evaluateStageAt(parsed.doc, "s2");
        expect(atS2.stage.actors).toHaveLength(2);
    });

    test("document stageCast helpers preserve timing/layout settings across actor edits", () => {
        const msk = `@story "Doc Helpers" region=jp id="doc_helpers"
@cast a "A" model="v2_01ichika_casual"
@cast b "B" model="v2_02saki_casual"
start -> s1
scene s1 "S" {
  cast set fixed afterTelop delay=0.4 dur=0.6 instant [
    a at left x=-0.5 lock mirror
  ]
  telop "Title"
  talk a "Hi"
} -> e1
end e1 "End"
`;
        const parsed = parseStoryScript(msk);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        let doc = updateActorInSceneCast(parsed.doc, "s1", "a", { x: -0.45 });
        const s1a = doc.nodes.s1;
        expect(s1a.type === "scene" && s1a.stageCast.mode === "set" && s1a.stageCast.enterTiming).toBe("afterTelop");
        expect(s1a.type === "scene" && s1a.stageCast.mode === "set" && s1a.stageCast.layoutMode).toBe("fixed");
        expect(s1a.type === "scene" && s1a.stageCast.mode === "set" && s1a.stageCast.enterDelay).toBe(0.4);

        doc = deferStageCastAfterTelop(doc, "s1", false);
        const s1b = doc.nodes.s1;
        expect(s1b.type === "scene" && s1b.stageCast.mode === "set" && s1b.stageCast.enterTiming).toBe("immediate");

        doc = updateSceneStageCastSettings(doc, "s1", { enterTiming: "afterTelop", enterDuration: 0.8 });
        const s1c = doc.nodes.s1;
        expect(s1c.type === "scene" && s1c.stageCast.mode === "set" && s1c.stageCast.enterDuration).toBe(0.8);

        if (s1c.type === "scene" && s1c.stageCast.mode === "set") {
            doc = setSceneStageCast(doc, "s1", {
                ...s1c.stageCast,
                actors: [...s1c.stageCast.actors, { castKey: "b", slot: "right" }],
            });
            const s1d = doc.nodes.s1;
            expect(s1d.type === "scene" && s1d.stageCast.mode === "set" && s1d.stageCast.enterTiming).toBe("afterTelop");
            expect(s1d.type === "scene" && s1d.stageCast.mode === "set" && s1d.stageCast.actors).toHaveLength(2);
        }
    });
});

describe("Lossless .msk round-trip & strict validation for all choreography syntax", () => {
    test("round-trips every new cast/telop/stage/sync modifier byte-for-byte without perturbing legacy scripts", () => {
        const modernMsk = `@story "Choreography DSL" region=jp id="choreo_dsl"

@cast a "Ichika" model="v2_01ichika_casual" char=1
@cast b "Saki" model="v2_02saki_casual" char=2
@cast c "Honami" model="v2_03honami_casual" char=3
@cast d "Shiho" model="v2_04shiho_casual" char=4

start -> s1

scene s1 "Showcase" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  transition none 0.4
  cast set fixed afterTelop delay=0.25 dur=0.5 instant [
    a at left x=-0.42 scale=1.05 y=-0.05 z=2 lock mirror facial="face_smile_01"
    b at right x=0.45 lock facial="face_normal_01"
  ]
  telop "Opening Banner" actors=hide pos=top
  talk a "Hello!"
  stage enter c at farLeft x=-0.85 dur=0.4 delay=0.15 instant scale=0.95 y=0.05 z=-1 lock mirror motion="w-normal01-nod" facial="face_normal_01" parallel
  stage move b to center x=0.1 dur=0.4 delay=0.1 lock=false mirror=false
  stage sync [ enter a at left x=-0.5 lock; exit b; pose c z=3 mirror facial="face_smile_01" ] dur=0.35 delay=0.2 instant parallel
  stage enter d at farRight x=0.85 dur=0.3 delay=0.05 instant
  stage exit c dur=0.3 delay=0.05 instant
  telop "Mid-scene subtitle" actors=dim pos=bottom
  talk a "Done!"
} -> e1

end e1 "Fin"
`;
        const p1 = parseStoryScript(modernMsk);
        expect(p1.ok).toBe(true);
        if (!p1.ok) return;

        const v1 = validateStoryDocument(p1.doc);
        expect(v1.ok).toBe(true);
        if (!v1.ok) return;

        const c1 = compileStoryGraph(v1.doc);
        expect(c1.ok).toBe(true);
        expect(c1.errors).toEqual([]);

        const s1 = serializeStoryScript(v1.doc, { includePositions: false });
        const p2 = parseStoryScript(s1);
        expect(p2.ok).toBe(true);
        if (!p2.ok) return;

        const s2 = serializeStoryScript(p2.doc, { includePositions: false });
        expect(s2).toBe(s1);

        // Verify key serialized tokens
        expect(s1).toContain("cast set fixed afterTelop delay=0.25 dur=0.5 instant [");
        expect(s1).toContain('a at left x=-0.42 scale=1.05 y=-0.05 z=2 lock mirror facial="face_smile_01"');
        expect(s1).toContain('telop "Opening Banner" actors=hide pos=top');
        expect(s1).toContain('stage enter c at farLeft x=-0.85 dur=0.4 delay=0.15 instant scale=0.95 y=0.05 z=-1 lock mirror motion="w-normal01-nod" facial="face_normal_01" parallel');
        expect(s1).toContain("stage move b to center x=0.1 dur=0.4 delay=0.1 lock=false mirror=false");
        expect(s1).toContain('stage sync [ enter a at left x=-0.5 lock; exit b; pose c z=3 mirror facial="face_smile_01" ] dur=0.35 delay=0.2 instant parallel');
        expect(s1).toContain("stage enter d at farRight x=0.85 dur=0.3 delay=0.05 instant");
        expect(s1).toContain("stage exit c dur=0.3 delay=0.05 instant");
        expect(s1).toContain('telop "Mid-scene subtitle" actors=dim pos=bottom');

        // Legacy script without any new modifiers serializes with ZERO new tokens
        const legacyMsk = `@story "Legacy" region=jp id="legacy_check"

@cast a "Ichika" model="v2_01ichika_casual" char=1

start -> s1

scene s1 "S" {
  bg set "bg_a000401"
  bgm inherit
  place inherit
  transition none 0.4
  cast set [
    a at center
  ]
  telop "Chapter 1"
  stage move a to left dur=0.5
  talk a "Hi"
} -> e1

end e1 "End"
`;
        const lp = parseStoryScript(legacyMsk);
        expect(lp.ok).toBe(true);
        if (!lp.ok) return;
        expect(serializeStoryScript(lp.doc, { includePositions: false })).toBe(legacyMsk);
    });

    test("validateStoryDocument and compiler reject out-of-range x, delay, and invalid enums", () => {
        const base = parseStoryScript(`@story "Bounds" region=jp id="bounds_check"
@cast a "A" model="v2_01ichika_casual"
start -> s1
scene s1 "S" {
  cast set [
    a at center x=1.5
  ]
  telop "T"
  stage enter a at left x=-1.5 delay=11 dur=-0.2
  talk a "Hi"
} -> e1
end e1 "End"
`);
        expect(base.ok).toBe(true);
        if (!base.ok) return;

        const compiled = compileStoryGraph(base.doc);
        expect(compiled.ok).toBe(false);
        expect(compiled.errors.some(e => e.code === "numberRange" && e.path.endsWith(".x"))).toBe(true);
        expect(compiled.errors.some(e => e.code === "numberRange" && e.path.endsWith(".delay"))).toBe(true);
        expect(compiled.errors.some(e => e.code === "numberRange" && e.path.endsWith(".duration"))).toBe(true);

        const validated = validateStoryDocument(base.doc);
        expect(validated.ok).toBe(false);
    });

    test("explicit 'fade' transition round-trips losslessly on cast set, single stageAction, and stage sync group overrides", () => {
        const fadeMsk = `@story "Explicit Fade Roundtrip" region=jp id="fade_roundtrip"

@cast a "Ichika" model="v2_01ichika_casual" char=1
@cast b "Saki" model="v2_02saki_casual" char=2
@cast c "Honami" model="v2_03honami_casual" char=3

start -> s1

scene s1 "Fade Overrides" {
  bg set "bg_a000401"
  bgm stop
  place set "Classroom"
  transition none 0.4
  cast set fade [
    a at center
  ]
  stage enter b at right fade
  stage sync [ exit a; enter c at left fade ] instant
  stage sync [ enter a at farLeft; exit b instant ] fade
  talk a "All fade overrides survived!"
} -> e1

end e1 "End"
`;
        const p1 = parseStoryScript(fadeMsk);
        expect(p1.ok).toBe(true);
        if (!p1.ok) return;

        const scene1 = p1.doc.nodes.s1;
        expect(scene1?.type).toBe("scene");
        if (!scene1 || scene1.type !== "scene") return;
        expect(scene1.stageCast.mode === "set" && scene1.stageCast.enterTransition).toBe("fade");
        const beat0 = scene1.beats[0];
        const beat1 = scene1.beats[1];
        const beat2 = scene1.beats[2];
        expect(beat0?.kind === "stageAction" && beat0.transition).toBe("fade");
        expect(beat1?.kind === "stageAction" && beat1.transition).toBe("instant");
        expect(beat1?.kind === "stageAction" && beat1.group?.[0]?.transition).toBe("fade");
        expect(beat2?.kind === "stageAction" && beat2.transition).toBe("fade");
        expect(beat2?.kind === "stageAction" && beat2.group?.[0]?.transition).toBe("instant");

        const v1 = validateStoryDocument(p1.doc);
        expect(v1.ok).toBe(true);
        if (!v1.ok) return;

        const c1 = compileStoryGraph(v1.doc);
        expect(c1.ok).toBe(true);
        expect(c1.errors).toEqual([]);

        const serialized = serializeStoryScript(v1.doc, { includePositions: false });
        expect(serialized).toBe(fadeMsk);
    });

    test("compiler rejects duplicate castKey across parallel:true chained stageAction beats while allowing sequential waves", () => {
        const dupParallelSingle = parseStoryScript(`@story "Parallel Dup Single" region=jp id="par_dup_1"
@cast a "A" model="v2_01ichika_casual"
start -> s1
scene s1 "S" {
  cast set [
    a at center
  ]
  stage exit a parallel
  stage enter a at left
  talk a "Hi"
} -> e1
end e1 "End"
`);
        expect(dupParallelSingle.ok).toBe(true);
        if (!dupParallelSingle.ok) return;
        const c1 = compileStoryGraph(dupParallelSingle.doc);
        expect(c1.ok).toBe(false);
        expect(c1.errors.some(e => e.code === "actorDuplicate" && e.params?.key === "a")).toBe(true);

        const dupParallelGroup = parseStoryScript(`@story "Parallel Dup Group" region=jp id="par_dup_2"
@cast a "A" model="v2_01ichika_casual"
@cast b "B" model="v2_02saki_casual"
@cast c "C" model="v2_03honami_casual"
start -> s1
scene s1 "S" {
  cast set [
    a at left
    c at right
  ]
  stage sync [ enter b at center; pose c facial="face_smile_01" ] parallel
  stage exit c
  talk a "Hi"
} -> e1
end e1 "End"
`);
        expect(dupParallelGroup.ok).toBe(true);
        if (!dupParallelGroup.ok) return;
        const c2 = compileStoryGraph(dupParallelGroup.doc);
        expect(c2.ok).toBe(false);
        expect(c2.errors.some(e => e.code === "actorDuplicate" && e.params?.key === "c")).toBe(true);

        // Non-parallel sequential beats targeting the same actor remain valid
        const sequentialOk = parseStoryScript(`@story "Sequential Reuse" region=jp id="seq_ok"
@cast a "A" model="v2_01ichika_casual"
start -> s1
scene s1 "S" {
  cast set [
    a at center
  ]
  stage exit a
  stage enter a at left
  talk a "Back again!"
} -> e1
end e1 "End"
`);
        expect(sequentialOk.ok).toBe(true);
        if (!sequentialOk.ok) return;
        const c3 = compileStoryGraph(sequentialOk.doc);
        expect(c3.ok).toBe(true);
        expect(c3.errors).toEqual([]);
    });
});
