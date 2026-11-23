import { describe, expect, test } from "bun:test";
import { readAutoPreloadPreference } from "../src/components/AssetPreloadPanel";
import { MOESEKAI_WORDMARK_PATH, MOESEKAI_WORDMARK_VIEWBOX } from "../src/components/MoeSekaiWordmarkSvg";
import { shouldShowStageAttribution } from "../src/components/StoryStageView";
import { STORY_MAKER_MESSAGES_BY_LOCALE, type StoryStudioLocale } from "../src/messages";

const ALL_LOCALES: StoryStudioLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
const REQUIRED_ATTRIBUTION_KEYS = [
    "stageBadge",
    "badgeTooltip",
    "endingFooter",
    "dialogTitle",
    "dialogSubtitle",
    "serviceTitle",
    "serviceBody",
    "ipTitle",
    "ipBody",
    "licenseTitle",
    "licenseBody",
    "contentTitle",
    "contentBody",
] as const;

describe("Non-intrusive MoeSekai Attribution & Notices (#175)", () => {
    test("shouldShowStageAttribution respects stage mode, provider toggle, Hide UI, and Solo Preview", () => {
        // Playback / Playtest with default provider setting -> visible
        expect(shouldShowStageAttribution({
            stageEnabled: true,
            providerEnabled: true,
            uiHidden: false,
            soloPreviewActive: false,
        })).toBe(true);

        // Provider default (undefined) treated as enabled
        expect(shouldShowStageAttribution({
            stageEnabled: true,
        })).toBe(true);

        // Edit mode (stageEnabled=false) -> hidden
        expect(shouldShowStageAttribution({
            stageEnabled: false,
            providerEnabled: true,
        })).toBe(false);

        // Host explicitly disables attribution via <StoryStudioProvider showAttribution={false}>
        expect(shouldShowStageAttribution({
            stageEnabled: true,
            providerEnabled: false,
        })).toBe(false);

        // Hide UI mode -> hidden so screenshots stay unobstructed
        expect(shouldShowStageAttribution({
            stageEnabled: true,
            providerEnabled: true,
            uiHidden: true,
        })).toBe(false);

        // Solo model audition preview -> hidden
        expect(shouldShowStageAttribution({
            stageEnabled: true,
            providerEnabled: true,
            soloPreviewActive: true,
        })).toBe(false);
    });

    test("all 5 locale dictionaries define complete attribution & legal notice copy with policy compliance", () => {
        for (const locale of ALL_LOCALES) {
            const messages = STORY_MAKER_MESSAGES_BY_LOCALE[locale] as Record<string, unknown>;
            const attribution = messages.attribution as Record<string, string> | undefined;
            expect(attribution).toBeDefined();

            for (const key of REQUIRED_ATTRIBUTION_KEYS) {
                const value = attribution?.[key];
                expect(typeof value).toBe("string");
                expect((value ?? "").trim().length).toBeGreaterThan(0);
                // Policy checks: zero user-facing "Pi" mentions, zero free-TTS promises
                expect(value ?? "").not.toMatch(/\bPi\b/);
                expect(value ?? "").not.toMatch(/free tts|免费\s*tts/i);
            }

            expect(attribution!.stageBadge).toContain("MoeSekai");
            expect(attribution!.stageBadge).toContain("pjsk.moe");
            expect(attribution!.endingFooter).toContain("MoeSekai");
            expect(attribution!.endingFooter).toContain("pjsk.moe");
            expect(attribution!.licenseBody).toContain("MPL-2.0");
            expect(attribution!.licenseBody).toContain("Live2D Cubism Core");
            expect(attribution!.ipBody).toMatch(/SEGA|セガ/);
            expect(attribution!.serviceBody).toContain("storage.pjsk.moe");
            expect(attribution!.serviceBody).not.toContain("assets.pjsk.moe");

            // Multi-actor aggregate loading progress key (#209)
            const engine = messages.engine as Record<string, string> | undefined;
            expect(typeof engine?.loadingModelsProgress).toBe("string");
            expect(engine?.loadingModelsProgress).toContain("{completed}");
            expect(engine?.loadingModelsProgress).toContain("{total}");
        }
    });

    test("exports official MoeSekai SVG wordmark path & viewBox verbatim from logo.svg (#207)", () => {
        expect(MOESEKAI_WORDMARK_VIEWBOX).toBe("0 0 926 221");
        expect(MOESEKAI_WORDMARK_PATH.startsWith("M453.000 10.138")).toBe(true);
        expect(MOESEKAI_WORDMARK_PATH.length).toBeGreaterThan(8000);
    });

    test("readAutoPreloadPreference honors host default when localStorage is unavailable or unset (#210)", () => {
        expect(readAutoPreloadPreference(false)).toBe(false);
        expect(readAutoPreloadPreference(true)).toBe(true);
    });
});
