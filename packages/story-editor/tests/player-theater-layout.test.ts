import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    resolvePlayerStageLayout,
    shouldPromoteReplayTransport,
    shouldShowPlayerStageAttribution,
} from "../src/components/StoryPlayerView";
import { STORY_MAKER_MESSAGES_BY_LOCALE, type StoryStudioLocale } from "../src/messages";
import {
    resolveEffectivePlayerLayoutMode,
    resolvePlayerCompanionVisibility,
} from "../src/studio/StoryStudioPlayer";

const ALL_LOCALES: StoryStudioLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
const EDITOR_SRC = join(import.meta.dir, "..", "src");

describe("StoryStudioPlayer & StoryPlayerView responsive Theater layout", () => {
    test("resolveEffectivePlayerLayoutMode prefers controlled layoutMode over internal state", () => {
        expect(resolveEffectivePlayerLayoutMode({
            controlledLayoutMode: "theater",
            internalLayoutMode: "workspace",
        })).toBe("theater");

        expect(resolveEffectivePlayerLayoutMode({
            controlledLayoutMode: "workspace",
            internalLayoutMode: "theater",
        })).toBe("workspace");

        expect(resolveEffectivePlayerLayoutMode({
            controlledLayoutMode: undefined,
            internalLayoutMode: "theater",
        })).toBe("theater");
    });

    test("resolvePlayerCompanionVisibility shows belowStage & companionPanel only in theater mode and respects desktop rail toggle", () => {
        // Theater mode with both slots and rail open
        expect(resolvePlayerCompanionVisibility({
            layoutMode: "theater",
            hasBelowStage: true,
            hasCompanionPanel: true,
            companionPanelOpen: true,
        })).toEqual({
            showBelowStage: true,
            showCompanionPanel: true,
            showCompanionDesktopRail: true,
            hasVideoSiteContent: true,
        });

        // Theater mode with desktop rail collapsed (inline mobile slot stays active, desktop rail collapses)
        expect(resolvePlayerCompanionVisibility({
            layoutMode: "theater",
            hasBelowStage: true,
            hasCompanionPanel: true,
            companionPanelOpen: false,
        })).toEqual({
            showBelowStage: true,
            showCompanionPanel: true,
            showCompanionDesktopRail: false,
            hasVideoSiteContent: true,
        });

        // Workspace mode hides both slots so Director Workspace keeps full width & 3-pane NLE geometry
        expect(resolvePlayerCompanionVisibility({
            layoutMode: "workspace",
            hasBelowStage: true,
            hasCompanionPanel: true,
            companionPanelOpen: true,
        })).toEqual({
            showBelowStage: false,
            showCompanionPanel: false,
            showCompanionDesktopRail: false,
            hasVideoSiteContent: false,
        });

        // Standalone theater without belowStage/companion
        expect(resolvePlayerCompanionVisibility({
            layoutMode: "theater",
            hasBelowStage: false,
            hasCompanionPanel: false,
            companionPanelOpen: true,
        })).toEqual({
            showBelowStage: false,
            showCompanionPanel: false,
            showCompanionDesktopRail: false,
            hasVideoSiteContent: false,
        });
    });

    test("resolvePlayerStageLayout separates video-site theater, standalone desktop theater fill, and NLE workspace", () => {
        // Community video-site theater (with belowStage/companion): disables tall letterbox fill, enables video-site stage cap
        expect(resolvePlayerStageLayout({
            layoutMode: "theater",
            immersive: true,
            fullscreen: false,
            stageWebFullscreen: false,
            phaseOpen: false,
            hasBelowStageContent: true,
        })).toEqual({
            isNleWorkspace: false,
            isImmersiveTheaterFill: false,
            isVideoSiteTheaterStage: true,
            useInlineMobileEnding: true,
        });

        // Local draft standalone theater: keeps desktop lg+ fill (mobile stays natural aspect-video via lg: classes)
        expect(resolvePlayerStageLayout({
            layoutMode: "theater",
            immersive: true,
            fullscreen: false,
            stageWebFullscreen: false,
            phaseOpen: false,
            hasBelowStageContent: false,
        })).toEqual({
            isNleWorkspace: false,
            isImmersiveTheaterFill: true,
            isVideoSiteTheaterStage: false,
            useInlineMobileEnding: true,
        });

        // Director workspace stays 3-pane NLE
        expect(resolvePlayerStageLayout({
            layoutMode: "workspace",
            immersive: true,
            fullscreen: false,
            stageWebFullscreen: false,
            phaseOpen: false,
            hasBelowStageContent: false,
        })).toEqual({
            isNleWorkspace: true,
            isImmersiveTheaterFill: false,
            isVideoSiteTheaterStage: false,
            useInlineMobileEnding: true,
        });

        // Native fullscreen & web-fullscreen disable inline mobile ending card so sticky overlay handles Replay
        expect(resolvePlayerStageLayout({
            layoutMode: "theater",
            immersive: true,
            fullscreen: true,
            stageWebFullscreen: false,
            phaseOpen: false,
            hasBelowStageContent: true,
        }).useInlineMobileEnding).toBe(false);

        expect(resolvePlayerStageLayout({
            layoutMode: "theater",
            immersive: true,
            fullscreen: false,
            stageWebFullscreen: true,
            phaseOpen: false,
            hasBelowStageContent: true,
        }).useInlineMobileEnding).toBe(false);
    });

    test("ending predicates promote transport Replay and suppress stage watermark during ending/error overlays", () => {
        expect(shouldPromoteReplayTransport({ ended: true, emptyStory: false, hasCompileErrors: false })).toBe(true);
        expect(shouldPromoteReplayTransport({ ended: false, emptyStory: false, hasCompileErrors: false })).toBe(false);
        expect(shouldPromoteReplayTransport({ ended: true, emptyStory: true, hasCompileErrors: false })).toBe(false);
        expect(shouldPromoteReplayTransport({ ended: true, emptyStory: false, hasCompileErrors: true })).toBe(false);

        expect(shouldShowPlayerStageAttribution({ ended: false, emptyStory: false, hasCompileErrors: false })).toBe(true);
        expect(shouldShowPlayerStageAttribution({ ended: true, emptyStory: false, hasCompileErrors: false })).toBe(false);
        expect(shouldShowPlayerStageAttribution({ ended: false, emptyStory: true, hasCompileErrors: false })).toBe(false);
        expect(shouldShowPlayerStageAttribution({ ended: false, emptyStory: false, hasCompileErrors: true })).toBe(false);
    });

    test("all 5 locale dictionaries define companion panel labels", () => {
        for (const locale of ALL_LOCALES) {
            const messages = STORY_MAKER_MESSAGES_BY_LOCALE[locale] as Record<string, unknown>;
            const player = messages.player as Record<string, string> | undefined;
            expect(typeof player?.companionPanel).toBe("string");
            expect((player?.companionPanel ?? "").trim().length).toBeGreaterThan(0);
            expect(typeof player?.hideCompanionPanel).toBe("string");
            expect((player?.hideCompanionPanel ?? "").trim().length).toBeGreaterThan(0);
            expect(typeof player?.showCompanionPanel).toBe("string");
            expect((player?.showCompanionPanel ?? "").trim().length).toBeGreaterThan(0);
        }
    });

    test("layout markup invariants prevent mobile header overflow, gray stage bands, double-mounting, and ending clipping", () => {
        const studioPlayerSrc = readFileSync(join(EDITOR_SRC, "studio", "StoryStudioPlayer.tsx"), "utf8");
        const playerViewSrc = readFileSync(join(EDITOR_SRC, "components", "StoryPlayerView.tsx"), "utf8");

        // Single stable StoryPlayerView & single-mount companion panel (strip block/JSDoc comments)
        const studioPlayerCode = studioPlayerSrc.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(studioPlayerCode.match(/<StoryPlayerView\b/g)?.length).toBe(1);
        expect(studioPlayerCode.match(/data-testid="story-player-companion-panel"/g)?.length).toBe(1);
        // Mobile header overflow-hidden on left cluster & iconOnly SegmentedButton below md
        expect(studioPlayerSrc).toContain("flex min-w-0 flex-1 items-center gap-1 overflow-hidden sm:gap-1.5");
        expect(studioPlayerSrc).toContain("iconOnly");
        expect(studioPlayerSrc).toContain("lg:w-[380px] xl:w-[420px]");
        // Non-immersive PageContainer must not pass max-w-full (which strips PageContainer's max-w-[1600px] / max-w-7xl via withOverrides)
        expect(studioPlayerSrc).not.toContain('"min-w-0 max-w-full overflow-x-clip"');

        // Mobile stage viewport box uses lg: prefix for letterbox fill (no gray dead bands on mobile)
        expect(playerViewSrc).toContain("lg:flex lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:overflow-hidden lg:rounded-md3-md lg:bg-scrim/20 lg:[container-type:size]");
        // Mobile inline ending card + sticky desktop ending footer + z-index above watermark (z-30)
        expect(playerViewSrc).toContain('data-testid="ending-inline-mobile-card"');
        expect(playerViewSrc).toContain('data-testid="ending-stage-compact"');
        expect(playerViewSrc).toContain('data-testid="ending-stage-footer"');
        expect(playerViewSrc).toContain('data-testid="transport-replay-primary"');
        expect(playerViewSrc).toContain("z-[32]");
        expect(playerViewSrc).toContain("z-[35]");
    });
});
