import { describe, expect, it } from "bun:test";
import {
    MACOS_TRAFFIC_LIGHTS_INSET_PX,
    resolvePlatformChromeLayout,
    STANDARD_EDGE_INSET_PX,
    WINDOWS_OVERLAY_INSET_PX,
} from "../src/shared/window-chrome.ts";

describe("cross-platform window chrome layout helper", () => {
    it("configures Windows (win32) with right-side titleBarOverlay clearance when windowed and symmetric padding in fullscreen", () => {
        const windowed = resolvePlatformChromeLayout("win32", false);
        expect(windowed.customTitleBar).toBe(true);
        expect(windowed.draggableHeader).toBe(true);
        expect(windowed.useTitleBarOverlay).toBe(true);
        expect(windowed.useHiddenInset).toBe(false);
        expect(windowed.useNativeFrame).toBe(false);
        expect(windowed.leftInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(windowed.rightInsetPx).toBe(WINDOWS_OVERLAY_INSET_PX);
        expect(windowed.headerPaddingClass).toBe("pl-3 pr-[144px]");

        const full = resolvePlatformChromeLayout("win32", true);
        expect(full.leftInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(full.rightInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(full.headerPaddingClass).toBe("pl-3 pr-3");
    });

    it("configures macOS (darwin) with left-side traffic-light clearance when windowed, collapsing cleanly in native fullscreen", () => {
        const windowed = resolvePlatformChromeLayout("darwin", false);
        expect(windowed.customTitleBar).toBe(true);
        expect(windowed.draggableHeader).toBe(true);
        expect(windowed.useHiddenInset).toBe(true);
        expect(windowed.useTitleBarOverlay).toBe(false);
        expect(windowed.useNativeFrame).toBe(false);
        expect(windowed.leftInsetPx).toBe(MACOS_TRAFFIC_LIGHTS_INSET_PX);
        expect(windowed.rightInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(windowed.headerPaddingClass).toBe("pl-[78px] pr-3");

        const full = resolvePlatformChromeLayout("darwin", true);
        expect(full.leftInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(full.rightInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(full.headerPaddingClass).toBe("pl-3 pr-3");
    });

    it("configures Linux with native WM frame and balanced renderer padding", () => {
        const linux = resolvePlatformChromeLayout("linux", false);
        expect(linux.customTitleBar).toBe(false);
        expect(linux.draggableHeader).toBe(false);
        expect(linux.useNativeFrame).toBe(true);
        expect(linux.useTitleBarOverlay).toBe(false);
        expect(linux.useHiddenInset).toBe(false);
        expect(linux.leftInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(linux.rightInsetPx).toBe(STANDARD_EDGE_INSET_PX);
        expect(linux.headerPaddingClass).toBe("pl-3 pr-3");
    });
});
