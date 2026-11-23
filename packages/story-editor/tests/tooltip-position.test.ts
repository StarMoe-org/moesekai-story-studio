import { describe, expect, test } from "bun:test";
import { computeTooltipPosition } from "../src/md3/Misc";

describe("computeTooltipPosition", () => {
    test("automatically flips preferred top to bottom when clearance from viewport top is < 56px", () => {
        // Top title bar button (y = 8..36)
        const topBarPos = computeTooltipPosition({
            anchor: { top: 8, bottom: 36, left: 200, right: 228, width: 28, height: 28 },
            tooltipWidth: 96,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(topBarPos.resolvedSide).toBe("bottom");
        expect(topBarPos.top).toBe(42); // 36 + 6px gap

        // Panel header directly below a 44px title bar (y = 52..80)
        const panelHeaderPos = computeTooltipPosition({
            anchor: { top: 52, bottom: 80, left: 1080, right: 1108, width: 28, height: 28 },
            tooltipWidth: 110,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(panelHeaderPos.resolvedSide).toBe("bottom");
        expect(panelHeaderPos.top).toBe(86);
    });

    test("keeps preferred top when there is sufficient clearance above the anchor", () => {
        const pos = computeTooltipPosition({
            anchor: { top: 180, bottom: 208, left: 400, right: 428, width: 28, height: 28 },
            tooltipWidth: 100,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(pos.resolvedSide).toBe("top");
        expect(pos.top).toBe(146); // 180 - 28 - 6
        expect(pos.left).toBe(364); // 400 + 14 - 50
    });

    test("flips preferred bottom to top near the viewport bottom", () => {
        const pos = computeTooltipPosition({
            anchor: { top: 740, bottom: 768, left: 500, right: 528, width: 28, height: 28 },
            tooltipWidth: 100,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "bottom",
        });
        expect(pos.resolvedSide).toBe("top");
        expect(pos.top).toBe(706); // 740 - 28 - 6
    });

    test("clamps horizontal left within [8px, viewportWidth - tooltipWidth - 8px]", () => {
        // Right-edge collapse button
        const rightEdge = computeTooltipPosition({
            anchor: { top: 52, bottom: 80, left: 1244, right: 1272, width: 28, height: 28 },
            tooltipWidth: 140,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(rightEdge.resolvedSide).toBe("bottom");
        expect(rightEdge.left).toBe(1280 - 140 - 8);

        // Left-edge button
        const leftEdge = computeTooltipPosition({
            anchor: { top: 10, bottom: 38, left: 6, right: 34, width: 28, height: 28 },
            tooltipWidth: 120,
            tooltipHeight: 28,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(leftEdge.resolvedSide).toBe("bottom");
        expect(leftEdge.left).toBe(8);
    });

    test("flips tall tooltip when tooltip height exceeds clearance even if anchor.top >= 56", () => {
        const pos = computeTooltipPosition({
            anchor: { top: 64, bottom: 92, left: 400, right: 428, width: 28, height: 28 },
            tooltipWidth: 160,
            tooltipHeight: 60,
            viewportWidth: 1280,
            viewportHeight: 800,
            preferredSide: "top",
        });
        expect(pos.resolvedSide).toBe("bottom");
        expect(pos.top).toBe(98);
    });
});
