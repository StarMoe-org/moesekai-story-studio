import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    Icon,
    SegmentedButton,
    cn,
} from "@moesekai/story-editor/md3";
import {
    mdDarkMode,
    mdKeyboardArrowDown,
    mdLightMode,
    mdSync,
} from "@moesekai/story-editor/md3/icons";
import type { DesktopThemeMode, DesktopUiLocale } from "../../shared/ipc";
import { CHARACTER_THEME_SEEDS, DESKTOP_LOCALE_OPTIONS } from "../../shared/theme-seeds";
import { formatDesktopMessage } from "../i18n/desktopMessages";

export interface AppearancePopoverProps {
    themeSeed: string;
    themeMode: DesktopThemeMode;
    locale: DesktopUiLocale;
    appVersion?: string;
    availableUpdateVersion?: string | null;
    onCheckForUpdates?: () => void;
    onChangeThemeSeed: (seed: string) => void;
    onChangeThemeMode: (mode: DesktopThemeMode) => void;
    onChangeLocale: (locale: DesktopUiLocale) => void;
    className?: string;
}

/**
 * Single compact MD3 appearance & language popover consolidating:
 * - Light / Dark theme switch
 * - 5-locale selector (no flags, neutral TW label)
 * - 26 character theme seed color swatches
 *
 * Portaled to `document.body` so an `overflow-hidden` top bar never clips it.
 */
export const AppearancePopover: React.FC<AppearancePopoverProps> = ({
    themeSeed,
    themeMode,
    locale,
    appVersion,
    availableUpdateVersion,
    onCheckForUpdates,
    onChangeThemeSeed,
    onChangeThemeMode,
    onChangeLocale,
    className,
}) => {
    const t = (key: Parameters<typeof formatDesktopMessage>[1], vars?: Record<string, string | number>) =>
        formatDesktopMessage(locale, key, vars);

    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 48, right: 12 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const activeSeed = useMemo(
        () => CHARACTER_THEME_SEEDS.find(s => s.id === themeSeed) ?? CHARACTER_THEME_SEEDS[0],
        [themeSeed],
    );

    const updatePosition = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const right = Math.max(8, window.innerWidth - rect.right);
        const top = Math.min(window.innerHeight - 24, rect.bottom + 8);
        setCoords({ top, right });
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [open, updatePosition]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (ev: MouseEvent) => {
            const target = ev.target as Node;
            if (
                panelRef.current?.contains(target) ||
                triggerRef.current?.contains(target)
            ) {
                return;
            }
            setOpen(false);
        };
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div className={cn("desktop-no-drag relative shrink-0", className)}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t("appearanceLabel")}
                title={`${t("appearanceLabel")} · ${activeSeed.name}`}
                className={cn(
                    "desktop-no-drag state-layer focus-ring inline-flex h-7 items-center gap-1 rounded-md3-full border px-2 transition-colors",
                    open
                        ? "border-primary bg-secondary-container text-on-secondary-container"
                        : "border-outline-variant/80 bg-surface-container text-on-surface hover:bg-surface-container-high",
                )}
            >
                <span className="relative inline-flex shrink-0">
                    <span
                        className="inline-block h-3 w-3 shrink-0 rounded-md3-full border border-outline-variant"
                        style={{ backgroundColor: activeSeed.hex }}
                        aria-hidden
                    />
                    {availableUpdateVersion ? (
                        <span
                            aria-hidden
                            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-md3-full bg-primary ring-1 ring-surface-container"
                        />
                    ) : null}
                </span>
                <Icon path={mdKeyboardArrowDown} size={15} className="text-on-surface-variant" />
            </button>

            {open && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-label={t("appearanceLabel")}
                        style={{ top: `${coords.top}px`, right: `${coords.right}px` }}
                        className="desktop-no-drag fixed z-[250] flex w-72 flex-col gap-3.5 rounded-md3-xl border border-outline-variant bg-surface-container-high p-3.5 shadow-elev-3"
                    >
                        {/* Light / Dark */}
                        <div className="flex flex-col gap-1.5">
                            <span className="type-label-s text-on-surface-variant">{t("appearanceLabel")}</span>
                            <SegmentedButton
                                density={-1}
                                value={themeMode}
                                onValueChange={val => onChangeThemeMode(val)}
                                options={[
                                    { value: "light" as const, label: t("themeModeLight"), icon: mdLightMode },
                                    { value: "dark" as const, label: t("themeModeDark"), icon: mdDarkMode },
                                ]}
                            />
                        </div>

                        {/* 5 Locales */}
                        <div className="flex flex-col gap-1.5">
                            <span className="type-label-s text-on-surface-variant">{t("languageLabel")}</span>
                            <div className="flex flex-wrap gap-1">
                                {DESKTOP_LOCALE_OPTIONS.map(opt => {
                                    const active = opt.code === locale;
                                    return (
                                        <button
                                            key={opt.code}
                                            type="button"
                                            onClick={() => onChangeLocale(opt.code)}
                                            className={cn(
                                                "state-layer focus-ring rounded-md3-full px-2.5 py-1 type-label-s transition-colors",
                                                active
                                                    ? "bg-primary text-on-primary font-medium"
                                                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
                                            )}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 26 Character Theme Seeds */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="type-label-s text-on-surface-variant">{t("themeSeedLabel")}</span>
                                <span className="type-label-s truncate font-medium text-on-surface">
                                    {activeSeed.name}
                                </span>
                            </div>
                            <div className="grid grid-cols-7 gap-1.5 rounded-md3-lg bg-surface-container p-2">
                                {CHARACTER_THEME_SEEDS.map(seed => {
                                    const selected = seed.id === themeSeed;
                                    return (
                                        <button
                                            key={seed.id}
                                            type="button"
                                            title={`${seed.name} · ${seed.unit}`}
                                            aria-label={seed.name}
                                            onClick={() => onChangeThemeSeed(seed.id)}
                                            className={cn(
                                                "focus-ring flex h-7 w-7 items-center justify-center rounded-md3-full transition-transform hover:scale-110",
                                                selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface-container",
                                            )}
                                        >
                                            <span
                                                className="h-5 w-5 rounded-md3-full border border-outline-variant/60"
                                                style={{ backgroundColor: seed.hex }}
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Version & Check for Updates entry */}
                        {onCheckForUpdates ? (
                            <div className="flex items-center justify-between gap-2 border-t border-outline-variant/60 pt-2.5">
                                <span className="font-mono type-label-s text-on-surface-variant">
                                    v{(appVersion || "0.1.0").replace(/^v/i, "")}
                                </span>
                                <button
                                    type="button"
                                    data-testid="popover-check-updates-btn"
                                    onClick={() => {
                                        setOpen(false);
                                        onCheckForUpdates();
                                    }}
                                    className={cn(
                                        "state-layer focus-ring inline-flex items-center gap-1.5 rounded-md3-full px-2.5 py-1 type-label-s font-medium transition-colors",
                                        availableUpdateVersion
                                            ? "bg-primary-container text-on-primary-container"
                                            : "bg-surface-container text-on-surface hover:bg-surface-container-highest",
                                    )}
                                >
                                    <Icon path={mdSync} size={13} className="shrink-0" />
                                    <span>
                                        {availableUpdateVersion
                                            ? t("updateAvailableBadge", { version: availableUpdateVersion })
                                            : t("checkForUpdates")}
                                    </span>
                                </button>
                            </div>
                        ) : null}
                    </div>,
                    document.body,
                )
                : null}
        </div>
    );
};
