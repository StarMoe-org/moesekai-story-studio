import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    LIVE2D_COSTUME_TOKENS,
    SUB_CHARACTER_FALLBACK_NAMES,
    SUB_CHARACTER_ID_OVERRIDES,
    compareLive2DModels,
    deriveSubOwnerKey,
    groupLive2DFacials,
    groupLive2DMotions,
    inferLive2DMotionBundleCandidates,
    live2dCharacterHref,
    live2dCheckConfig,
    live2dCoreUrl,
    live2dFetchUrl,
    live2dListingUrl,
    live2dModelsFromListings,
    live2dMotionSet,
    live2dMotionStyle,
    live2dSources,
    live2dViewerHref,
    parseLive2DCharacterParam,
    parseLive2DModel,
    parseLive2DModelId,
    parseLive2DModelParam,
    parseLive2DSubVariant,
    resolveFallbackSubCharacter,
} from "../src/live2d";
import { resetStoryCoreConfig } from "../src/config";

describe("story-core/live2d unified listing, pairing & naming", () => {
    it("exports all 42 costume tokens and parses compound main-character IDs", () => {
        expect(LIVE2D_COSTUME_TOKENS.length).toBe(42);
        expect(parseLive2DModelId("21miku_wonderblack").costume).toEqual([{ unit: "ws" }, { token: "black" }]);
        expect(parseLive2DModelId("21miku_bandblack").costume).toEqual([{ unit: "ln" }, { token: "black" }]);
        expect(parseLive2DModelId("06haruka_cloth002black").costume).toEqual([{ cloth: 2 }, { token: "black" }]);
        expect(parseLive2DModelId("18mafuyu_darkcloth001").costume).toEqual([{ token: "dark" }, { cloth: 1 }]);
        expect(parseLive2DModelId("18mafuyu_darkunit").costume).toEqual([{ token: "dark" }, { token: "unit" }]);
        expect(parseLive2DModelId("01ichika_longnormal").costume).toEqual([{ token: "long" }, { token: "normal" }]);
        expect(parseLive2DModelId("19ena_jccloth").costume).toEqual([{ token: "jc" }, { token: "casual" }]);
        expect(parseLive2DModelId("16rui_maskcloth003").costume).toEqual([{ token: "mask" }, { cloth: 3 }]);
        expect(parseLive2DModelId("v2_20mizuki_culture_02").costume).toEqual([{ token: "culture" }, { variant: 2 }]);
        expect(parseLive2DModelId("v2_03honami_april2025_school").costume).toEqual([
            { token: "april", variant: 2025 },
            { token: "school" },
        ]);
        expect(parseLive2DModelId("13tsukasa_liondance").costume).toEqual([{ token: "liondance" }]);
    });

    it("pairs models with longest matching <stem>_motion_base and supports v2 fallback + black/young trimming", () => {
        const motionSets = new Set([
            "v2_01ichika_motion_base",
            "01ichika_motion_base",
            "24luka_motion_base",
            "sub_anfather_motion_base",
            "v2_sub_sanrio_kitty_motion_base",
        ]);

        expect(live2dMotionSet("v2_01ichika_casual", motionSets)).toBe("v2_01ichika_motion_base");
        expect(live2dMotionSet("01ichika_normal", motionSets)).toBe("01ichika_motion_base");
        expect(live2dMotionSet("v2_clb01_24luka01", motionSets)).toBe("24luka_motion_base");
        expect(live2dMotionSet("sub_anfatheryoung_black", motionSets)).toBe("sub_anfather_motion_base");
        expect(live2dMotionSet("v2_sub_sanrio_kitty", motionSets)).toBe("v2_sub_sanrio_kitty_motion_base");
        expect(live2dMotionSet("sub_unknown_npc", motionSets)).toBeNull();

        expect(inferLive2DMotionBundleCandidates("v2_01ichika_casual")).toEqual([
            "live2d/motion/v2_01ichika_motion_base",
            "live2d/motion/01ichika_motion_base",
        ]);
    });

    it("builds sorted catalog from canonical directory listings with ownerKey 02-merge and tiered ordering", () => {
        const models = live2dModelsFromListings(
            [
                "mob_a",
                "v2_sub_sanrio_kitty",
                "v2_sub_enst_01izumi_stage",
                "sub_anfather_black",
                "v2_sub_anfather_black",
                "sub_anfather_zoom",
                "sub_anfatheryoung",
                "sub_anfather_rw",
                "sub_anfather",
                "v2_sub_anfather",
                "sub_arisa",
                "sub_arisa02_live01",
                "sub_wl3_extra02",
                "v2_01ichika_casual",
                "invalid-dir!",
                "v2_01ichika_casual",
            ],
            ["v2_01ichika_motion_base", "sub_anfather_motion_base"],
        );

        const byId = new Map(models.map(m => [m.id, m]));
        expect(byId.has("invalid-dir!")).toBe(false);

        // Main character gets canonical asset + motion
        expect(byId.get("v2_01ichika_casual")?.asset).toBe("live2d/model/v2_01ichika_casual");
        expect(byId.get("v2_01ichika_casual")?.motion).toBe("live2d/motion/v2_01ichika_motion_base");
        expect(byId.get("v2_01ichika_casual")?.motions).toEqual(["live2d/motion/v2_01ichika_motion_base"]);

        // Second-pass 02 merge: arisa02 merges into arisa; wl3_extra02 stays intact
        expect(deriveSubOwnerKey("sub_anfatheryoung_black")).toBe("anfather");
        expect(byId.get("sub_arisa02_live01")?.ownerKey).toBe("arisa");
        expect(byId.get("sub_arisa02_live01")?.subVariant).toEqual([
            { variant: 2 },
            { token: "live", variant: 1 },
        ]);
        expect(byId.get("sub_wl3_extra02")?.ownerKey).toBe("wl3_extra02");

        // Collab classification
        expect(byId.get("v2_sub_sanrio_kitty")?.kind).toBe("collab");
        expect(byId.get("v2_sub_enst_01izumi_stage")?.kind).toBe("collab");
        expect(byId.get("v2_sub_enst_01izumi_stage")?.subVariant).toEqual([{ token: "stage" }]);

        // Ordering: character -> sub (grouped by owner, default -> outfit -> young -> zoom -> black, v2 before v1) -> collab -> mob
        const anfatherIds = models.filter(m => m.ownerKey === "anfather").map(m => m.id);
        expect(anfatherIds).toEqual([
            "v2_sub_anfather",
            "sub_anfather",
            "sub_anfather_rw",
            "sub_anfatheryoung",
            "sub_anfather_zoom",
            "v2_sub_anfather_black",
            "sub_anfather_black",
        ]);
        expect(compareLive2DModels(byId.get("v2_01ichika_casual")!, byId.get("v2_sub_anfather")!)).toBeLessThan(0);
        expect(compareLive2DModels(byId.get("v2_sub_anfather")!, byId.get("v2_sub_sanrio_kitty")!)).toBeLessThan(0);
        expect(compareLive2DModels(byId.get("v2_sub_sanrio_kitty")!, byId.get("mob_a")!)).toBeLessThan(0);

        // Childhood / sub_* main-character models when characterId is supplied
        const airiChild = parseLive2DModel({
            id: "sub_airichildblack",
            asset: "live2d/model/sub_airichildblack",
            motion: null,
            kind: "character",
            characterId: 7,
        });
        expect(airiChild.kind).toBe("character");
        expect(airiChild.costume).toEqual([{ token: "child" }, { token: "black" }]);
        expect(parseLive2DSubVariant("sub_miu_cloth", "miu")).toEqual([{ token: "casual" }]);
    });

    it("keeps subCharacterNames.ts pure ASCII with complete 5-region names and ID overrides", () => {
        const rawSource = readFileSync(resolve(import.meta.dir, "../src/live2d/subCharacterNames.ts"), "utf8");
        expect(/^[\x00-\x7F]*$/.test(rawSource)).toBe(true);

        const ownerKeys = Object.keys(SUB_CHARACTER_FALLBACK_NAMES);
        expect(ownerKeys.length).toBe(83);
        expect(Object.keys(SUB_CHARACTER_ID_OVERRIDES).length).toBeGreaterThanOrEqual(5);

        for (const key of ownerKeys) {
            const entry = SUB_CHARACTER_FALLBACK_NAMES[key];
            for (const region of ["jp", "cn", "tw", "en", "kr"] as const) {
                expect(typeof entry.names[region]).toBe("string");
                expect(entry.names[region]!.trim().length).toBeGreaterThan(0);
            }
        }

        const youngKen = resolveFallbackSubCharacter({
            id: "sub_anfatheryoung",
            ownerKey: "anfather",
            subName: "anfatheryoung",
        });
        expect(youngKen?.names.en).toBe("Ken");
        expect(youngKen?.aliases).toContain("Ken");
        expect(resolveFallbackSubCharacter({ id: "sub_unknown_xyz", ownerKey: "unknown_xyz", subName: "unknown_xyz" })).toBeNull();
    });

    it("groups body motions and facials cleanly and formats viewer routes/params", () => {
        const motionGroups = groupLive2DMotions(["w-cute01-tilthead02", "w-normal01-nod", "custom_clip"]);
        expect(motionGroups.map(g => g.style)).toEqual(["normal", "cute", "other"]);
        expect(live2dMotionStyle(motionGroups, "w-cute01-tilthead02")).toBe("cute");

        const facialRows = groupLive2DFacials(["face_smile_01", "face_smile_03", "face_darkangry_02"]);
        expect(facialRows[0]?.words).toEqual(["smile"]);
        expect(facialRows[0]?.clips.map(c => c.code)).toEqual(["01", "03"]);

        expect(parseLive2DModelParam("  v2_01ichika_casual ")).toBe("v2_01ichika_casual");
        expect(parseLive2DModelParam("../bad")).toBeNull();
        expect(parseLive2DCharacterParam("21")).toBe(21);
        expect(parseLive2DCharacterParam("99")).toBeNull();
        expect(live2dViewerHref("jp", "01ichika_normal")).toBe("/live2d?server=jp&model=01ichika_normal");
        expect(live2dCharacterHref(21)).toBe("/live2d?character=21");
    });

    it("validates NEXT_PUBLIC_* Live2D env vars strictly for Moesekai next.config.ts compatibility", () => {
        const ENV_NAMES = [
            "NEXT_PUBLIC_LIVE2D_CORE_URL",
            "NEXT_PUBLIC_SSE_WEB_CORE_URL",
            "NEXT_PUBLIC_LIVE2D_SITE",
            "NEXT_PUBLIC_SSE_WEB_SITE",
            "NEXT_PUBLIC_LIVE2D_ASSET_PROXY",
            "NEXT_PUBLIC_SSE_WEB_ASSET_PROXY",
        ] as const;
        const saved = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]));
        const setEnv = (values: Partial<Record<(typeof ENV_NAMES)[number], string>>) => {
            for (const name of ENV_NAMES) delete process.env[name];
            Object.assign(process.env, values);
        };

        try {
            resetStoryCoreConfig();

            setEnv({ NEXT_PUBLIC_SSE_WEB_SITE: "https://a.example.com/s/" });
            expect(live2dSources("cn")).toEqual({ site: "https://a.example.com/s", region: "cn" });
            setEnv({ NEXT_PUBLIC_SSE_WEB_SITE: "https://a.example.com/s/", NEXT_PUBLIC_LIVE2D_SITE: "https://b.example.com/" });
            expect(live2dSources("cn")).toEqual({ site: "https://b.example.com", region: "cn" });
            setEnv({ NEXT_PUBLIC_SSE_WEB_ASSET_PROXY: "http://127.0.0.1:8787/remote/" });
            expect(live2dSources("jp")).toEqual({
                site: "https://storage.pjsk.moe",
                region: "jp",
                proxy: "http://127.0.0.1:8787/remote/",
            });
            expect(live2dListingUrl("jp", "live2d/motion/")).toBe("http://127.0.0.1:8787/remote/storage.pjsk.moe/jp/live2d/motion/");
            expect(live2dFetchUrl("https://storage.exmeaning.com/a.webp")).toBe("http://127.0.0.1:8787/remote/storage.exmeaning.com/a.webp");
            setEnv({ NEXT_PUBLIC_SSE_WEB_CORE_URL: "https://cdn.example.com/a.js", NEXT_PUBLIC_LIVE2D_CORE_URL: "https://cdn.example.com/b.js" });
            expect(live2dCoreUrl()).toBe("https://cdn.example.com/b.js");

            for (const [name, value] of [
                ["NEXT_PUBLIC_LIVE2D_SITE", "https://site.example.com/x"],
                ["NEXT_PUBLIC_LIVE2D_SITE", "http://site.example.com/y/"],
                ["NEXT_PUBLIC_LIVE2D_SITE", "https://site.example.com/y/?q=1"],
                ["NEXT_PUBLIC_SSE_WEB_SITE", "https://site.example.com/a/../b/"],
                ["NEXT_PUBLIC_LIVE2D_CORE_URL", "https://cdn.example.com/core/"],
                ["NEXT_PUBLIC_LIVE2D_ASSET_PROXY", "https://user:pw@relay.example.com/"],
            ] as const) {
                setEnv({ [name]: value });
                expect(() => live2dCheckConfig()).toThrow(new RegExp(`live2d_viewer_config_invalid:${name}`));
            }
        } finally {
            resetStoryCoreConfig();
            for (const name of ENV_NAMES) {
                if (saved[name] === undefined) delete process.env[name];
                else process.env[name] = saved[name];
            }
        }
    });
});
