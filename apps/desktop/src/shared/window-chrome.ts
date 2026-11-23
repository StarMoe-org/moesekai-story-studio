/**
 * Pure cross-platform window chrome & safe-area layout helper shared by
 * Electron Main (`BrowserWindow` creation) and Renderer (44px unified top bar).
 *
 * - Windows (`win32`): frameless `titleBarStyle: "hidden"` + `titleBarOverlay` (top-right `- □ ×`, 144px clearance).
 * - macOS (`darwin`): frameless `titleBarStyle: "hiddenInset"` + `trafficLightPosition` (top-left traffic lights, 78px clearance when windowed, 12px when fullscreen).
 * - Linux (`linux` / others): native WM frame (`frame: true`, `autoHideMenuBar: true`) so DE button placement (left or right) stays native, with balanced 12px renderer padding.
 */

export interface PlatformChromeLayout {
    platform: NodeJS.Platform;
    isFullscreen: boolean;
    /** Whether the app renders an integrated draggable titlebar strip. */
    customTitleBar: boolean;
    /** Whether the top bar blank regions should carry `-webkit-app-region: drag`. */
    draggableHeader: boolean;
    /** Left horizontal safe-area clearance in pixels. */
    leftInsetPx: number;
    /** Right horizontal safe-area clearance in pixels. */
    rightInsetPx: number;
    /** Tailwind padding classes applying left & right safe-area clearance. */
    headerPaddingClass: string;
    /** Main-process: pass `titleBarStyle: "hidden"` + `titleBarOverlay` (Windows only). */
    useTitleBarOverlay: boolean;
    /** Main-process: pass `titleBarStyle: "hiddenInset"` + `trafficLightPosition` (macOS only). */
    useHiddenInset: boolean;
    /** Main-process: keep standard OS window frame (`frame: true`) (Linux). */
    useNativeFrame: boolean;
}

export const TITLE_BAR_HEIGHT_PX = 44;
export const WINDOWS_OVERLAY_INSET_PX = 144;
export const MACOS_TRAFFIC_LIGHTS_INSET_PX = 78;
export const STANDARD_EDGE_INSET_PX = 12;

export function resolvePlatformChromeLayout(
    platform: NodeJS.Platform,
    isFullscreen = false,
): PlatformChromeLayout {
    if (platform === "win32") {
        const rightInsetPx = isFullscreen ? STANDARD_EDGE_INSET_PX : WINDOWS_OVERLAY_INSET_PX;
        return {
            platform,
            isFullscreen,
            customTitleBar: true,
            draggableHeader: true,
            leftInsetPx: STANDARD_EDGE_INSET_PX,
            rightInsetPx,
            headerPaddingClass: isFullscreen ? "pl-3 pr-3" : "pl-3 pr-[144px]",
            useTitleBarOverlay: true,
            useHiddenInset: false,
            useNativeFrame: false,
        };
    }

    if (platform === "darwin") {
        const leftInsetPx = isFullscreen ? STANDARD_EDGE_INSET_PX : MACOS_TRAFFIC_LIGHTS_INSET_PX;
        return {
            platform,
            isFullscreen,
            customTitleBar: true,
            draggableHeader: true,
            leftInsetPx,
            rightInsetPx: STANDARD_EDGE_INSET_PX,
            headerPaddingClass: isFullscreen ? "pl-3 pr-3" : "pl-[78px] pr-3",
            useTitleBarOverlay: false,
            useHiddenInset: true,
            useNativeFrame: false,
        };
    }

    // Linux & other platforms: keep native WM window chrome so GNOME/KDE/Hyprland controls stay intact.
    return {
        platform,
        isFullscreen,
        customTitleBar: false,
        draggableHeader: false,
        leftInsetPx: STANDARD_EDGE_INSET_PX,
        rightInsetPx: STANDARD_EDGE_INSET_PX,
        headerPaddingClass: "pl-3 pr-3",
        useTitleBarOverlay: false,
        useHiddenInset: false,
        useNativeFrame: true,
    };
}
