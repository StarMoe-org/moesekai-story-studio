"use client";
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { StudioLink } from "./context";
import { md3SpatialDefault, reducedMotionFade } from "./motion";
import { cn, withOverrides } from "./cn";
import { Icon } from "./Icon";

/* ==========================================================================
   Misc M3 primitives: List / ListItem, Divider, Badge, Tooltip, Snackbar.
   ========================================================================== */

/* ── List ─────────────────────────────────────────────────────────────── */

export function List({ className, ...rest }: React.HTMLAttributes<HTMLUListElement>) {
    return <ul role="list" className={withOverrides("py-2", className)} {...rest} />;
}

export interface ListItemProps {
    headline: React.ReactNode;
    supportingText?: React.ReactNode;
    overline?: React.ReactNode;
    /** Leading icon path. */
    icon?: string;
    /** Leading custom node (avatar, image, checkbox). */
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
    trailingText?: React.ReactNode;
    href?: string;
    onClick?: () => void;
    selected?: boolean;
    disabled?: boolean;
    className?: string;
}

export function ListItem({
    headline,
    supportingText,
    overline,
    icon,
    leading,
    trailing,
    trailingText,
    href,
    onClick,
    selected,
    disabled,
    className,
}: ListItemProps) {
    const interactive = Boolean(href || onClick);
    const lines = (overline ? 1 : 0) + (supportingText ? 1 : 0);
    const cls = withOverrides(
        "flex w-full items-center gap-4 px-4 text-left",
        lines === 0 ? "min-h-14 py-2" : lines === 1 ? "min-h-[72px] py-2" : "min-h-[88px] py-3",
        interactive && "state-layer focus-ring cursor-pointer",
        selected ? "bg-secondary-container text-on-secondary-container" : "text-on-surface",
        disabled && "pointer-events-none opacity-38",
        className,
    );
    const content = (
        <>
            {icon && <Icon path={icon} size={24} className={selected ? "" : "text-on-surface-variant"} />}
            {leading}
            <span className="min-w-0 flex-1">
                {overline && <span className="block type-label-s text-on-surface-variant">{overline}</span>}
                <span className="block truncate type-body-l">{headline}</span>
                {supportingText && <span className="block type-body-m text-on-surface-variant">{supportingText}</span>}
            </span>
            {trailingText && <span className="shrink-0 type-label-s text-on-surface-variant">{trailingText}</span>}
            {trailing}
        </>
    );
    return (
        <li>
            {href ? (
                <StudioLink
                    href={href}
                    className={cls}
                    aria-current={selected ? "page" : undefined}
                    aria-disabled={disabled || undefined}
                    tabIndex={disabled ? -1 : undefined}
                    onClick={(e) => {
                        if (disabled) e.preventDefault();
                        else onClick?.();
                    }}
                >
                    {content}
                </StudioLink>
            ) : onClick ? (
                <button type="button" onClick={onClick} disabled={disabled} className={cls} aria-pressed={selected}>
                    {content}
                </button>
            ) : (
                <div className={cls}>{content}</div>
            )}
        </li>
    );
}

/* ── Divider ──────────────────────────────────────────────────────────── */

export function Divider({ inset, vertical, className }: { inset?: boolean; vertical?: boolean; className?: string }) {
    return (
        <div
            role="separator"
            aria-orientation={vertical ? "vertical" : "horizontal"}
            className={withOverrides(vertical ? "w-px self-stretch bg-outline-variant" : "h-px w-full bg-outline-variant", inset && !vertical && "ml-4", className)}
        />
    );
}

/* ── Badge ────────────────────────────────────────────────────────────── */

export function Badge({ value, max = 999, className }: { value?: number | string; max?: number; className?: string }) {
    if (value === undefined || value === "") {
        return <span aria-hidden className={withOverrides("inline-block h-1.5 w-1.5 rounded-full bg-error", className)} />;
    }
    const text = typeof value === "number" && value > max ? `${max}+` : String(value);
    return (
        <span className={withOverrides("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 type-label-s text-on-error", className)}>
            {text}
        </span>
    );
}

/* ── Tooltip (plain, portaled with viewport flip & horizontal clamp) ─── */

export interface TooltipRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
}

export interface TooltipPosition {
    left: number;
    top: number;
    resolvedSide: "top" | "bottom";
}

export interface ComputeTooltipPositionOptions {
    anchor: TooltipRect;
    tooltipWidth: number;
    tooltipHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    preferredSide?: "top" | "bottom";
    gap?: number;
    edgePadding?: number;
    topClearance?: number;
    bottomClearance?: number;
}

export const TOOLTIP_VIEWPORT_GAP_PX = 6;
export const TOOLTIP_EDGE_PADDING_PX = 8;
export const TOOLTIP_MIN_TOP_CLEARANCE_PX = 56;
export const TOOLTIP_MIN_BOTTOM_CLEARANCE_PX = 56;

/**
 * Computes fixed viewport coordinates for `<Tooltip>`:
 * - Flips `"top"` -> `"bottom"` when clearance from the viewport top is `< 56px` (e.g. top bar
 *   or panel header directly below a 44px title bar) or insufficient for the tooltip height.
 * - Flips `"bottom"` -> `"top"` when near the viewport bottom.
 * - Clamps horizontal `left` to `[edgePadding, viewportWidth - tooltipWidth - edgePadding]` so
 *   right-edge or left-edge buttons never clip off-screen.
 */
export function computeTooltipPosition({
    anchor,
    tooltipWidth,
    tooltipHeight,
    viewportWidth,
    viewportHeight,
    preferredSide = "top",
    gap = TOOLTIP_VIEWPORT_GAP_PX,
    edgePadding = TOOLTIP_EDGE_PADDING_PX,
    topClearance = TOOLTIP_MIN_TOP_CLEARANCE_PX,
    bottomClearance = TOOLTIP_MIN_BOTTOM_CLEARANCE_PX,
}: ComputeTooltipPositionOptions): TooltipPosition {
    const spaceAbove = anchor.top;
    const spaceBelow = viewportHeight - anchor.bottom;
    const neededAbove = Math.max(topClearance, tooltipHeight + gap + edgePadding);
    const neededBelow = Math.max(bottomClearance, tooltipHeight + gap + edgePadding);

    let resolvedSide: "top" | "bottom" = preferredSide;
    if (preferredSide === "top") {
        if (spaceAbove < neededAbove && (spaceBelow >= tooltipHeight + gap + edgePadding || spaceBelow > spaceAbove)) {
            resolvedSide = "bottom";
        }
    } else if (spaceBelow < neededBelow && (spaceAbove >= tooltipHeight + gap + edgePadding || spaceAbove > spaceBelow)) {
        resolvedSide = "top";
    }

    const rawTop = resolvedSide === "top"
        ? anchor.top - tooltipHeight - gap
        : anchor.bottom + gap;
    const maxTop = Math.max(edgePadding, viewportHeight - tooltipHeight - edgePadding);
    const top = Math.min(Math.max(edgePadding, rawTop), maxTop);

    const idealLeft = anchor.left + anchor.width / 2 - tooltipWidth / 2;
    const maxLeft = Math.max(edgePadding, viewportWidth - tooltipWidth - edgePadding);
    const left = Math.min(Math.max(edgePadding, idealLeft), maxLeft);

    return {
        left: Math.round(left),
        top: Math.round(top),
        resolvedSide,
    };
}

export interface TooltipProps {
    label: React.ReactNode;
    children: React.ReactElement;
    side?: "top" | "bottom";
    className?: string;
}

const TOOLTIP_HOVER_DELAY_MS = 200;

export function Tooltip({
    label,
    children,
    side = "top",
    className,
}: TooltipProps) {
    const tooltipId = useId();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLSpanElement>(null);
    const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<TooltipPosition | null>(null);

    const hasLabel = label !== null && label !== undefined && label !== "";

    const clearPendingTimer = useCallback(() => {
        if (delayTimerRef.current !== null) {
            clearTimeout(delayTimerRef.current);
            delayTimerRef.current = null;
        }
    }, []);

    const hide = useCallback(() => {
        clearPendingTimer();
        setOpen(false);
        setPos(null);
    }, [clearPendingTimer]);

    const scheduleShow = useCallback((immediate: boolean) => {
        if (!hasLabel) return;
        clearPendingTimer();
        if (immediate) {
            setOpen(true);
            return;
        }
        delayTimerRef.current = setTimeout(() => {
            delayTimerRef.current = null;
            setOpen(true);
        }, TOOLTIP_HOVER_DELAY_MS);
    }, [clearPendingTimer, hasLabel]);

    useEffect(() => () => clearPendingTimer(), [clearPendingTimer]);

    const place = useCallback(() => {
        const anchorEl = anchorRef.current;
        const tipEl = tooltipRef.current;
        if (!anchorEl || !tipEl || typeof window === "undefined") return;
        const rect = anchorEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            setOpen(false);
            setPos(null);
            return;
        }
        const tipRect = tipEl.getBoundingClientRect();
        setPos(computeTooltipPosition({
            anchor: {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height,
            },
            tooltipWidth: tipRect.width,
            tooltipHeight: tipRect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            preferredSide: side,
        }));
    }, [side]);

    useLayoutEffect(() => {
        if (!open || !hasLabel) return;
        place();
        const onUpdate = () => place();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                hide();
            }
        };
        window.addEventListener("resize", onUpdate);
        window.addEventListener("scroll", onUpdate, true);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("resize", onUpdate);
            window.removeEventListener("scroll", onUpdate, true);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [open, hasLabel, label, place, hide]);

    const portalTarget = typeof document !== "undefined" ? document.body : null;

    return (
        <>
            <span
                ref={anchorRef}
                aria-describedby={open && hasLabel ? tooltipId : undefined}
                className={withOverrides("inline-flex", className)}
                onPointerEnter={(event) => {
                    if (event.pointerType === "touch") return;
                    scheduleShow(false);
                }}
                onPointerLeave={hide}
                onPointerDown={hide}
                onFocus={() => scheduleShow(true)}
                onBlur={hide}
            >
                {children}
            </span>
            {open && hasLabel && portalTarget && createPortal(
                <span
                    ref={tooltipRef}
                    id={tooltipId}
                    role="tooltip"
                    data-side={pos?.resolvedSide ?? side}
                    style={pos
                        ? { left: pos.left, top: pos.top, opacity: 1 }
                        : { left: -9999, top: -9999, opacity: 0 }}
                    className={cn(
                        "pointer-events-none fixed z-[220] max-w-[min(280px,calc(100vw-16px))] whitespace-nowrap rounded-md3-xs bg-inverse-surface px-2 py-1 type-body-s text-inverse-on-surface shadow-elev-1 transition-opacity duration-150",
                    )}
                >
                    {label}
                </span>,
                portalTarget,
            )}
        </>
    );
}

/* ── Snackbar ─────────────────────────────────────────────────────────── */

export interface SnackbarProps {
    open: boolean;
    message: React.ReactNode;
    onClose: () => void;
    actionLabel?: string;
    onAction?: () => void;
    /** ms; 0 = persistent. Default 4000. */
    duration?: number;
    className?: string;
}

export function Snackbar({ open, message, onClose, actionLabel, onAction, duration = 4000, className }: SnackbarProps) {
    const reduced = useReducedMotion();
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        const raf = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(raf);
    }, []);
    useEffect(() => {
        if (!open || duration <= 0) return;
        const timer = window.setTimeout(onClose, duration);
        return () => window.clearTimeout(timer);
    }, [open, duration, onClose]);
    if (!mounted) return null;
    return (
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[260] flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <AnimatePresence>
                {open && (
                    <motion.div
                        role="status"
                        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
                        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                        transition={reduced ? reducedMotionFade : md3SpatialDefault}
                        className={withOverrides(
                            "pointer-events-auto flex min-h-12 w-full max-w-[560px] items-center gap-2 rounded-md3-xs bg-inverse-surface py-1 pl-4 pr-2 text-inverse-on-surface shadow-elev-3",
                            className,
                        )}
                    >
                        <span className="flex-1 py-2 type-body-m">{message}</span>
                        {actionLabel && onAction && (
                            <button
                                type="button"
                                onClick={() => {
                                    onAction();
                                    onClose();
                                }}
                                className="state-layer focus-ring h-10 shrink-0 cursor-pointer rounded-full px-3 type-label-l text-inverse-primary"
                            >
                                {actionLabel}
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
