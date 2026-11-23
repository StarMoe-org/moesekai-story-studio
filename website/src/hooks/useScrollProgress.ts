import { useEffect, useState, type RefObject } from "react";

/**
 * Sets CSS custom property `--p` in [0, 1] directly on `targetRef` via rAF as the
 * element scrolls into the focal band of the viewport — 60fps Apple Keynote scale
 * without per-scroll React re-renders.
 */
export function useScrollProgressVar(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    let rafId = 0;
    const update = () => {
      rafId = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 900;
      // 0 when top enters bottom of viewport; 1 when top reaches 22% from top
      const raw = (vh - rect.top) / (vh * 0.78);
      const clamped = Math.max(0, Math.min(1, raw));
      el.style.setProperty("--p", clamped.toFixed(4));
    };

    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [targetRef]);
}

/**
 * Tracks the currently active cinema act index (0..N-1) and whether the viewport's
 * top edge sits over a light ("gallery") act so the peripheral corner controls adapt contrast.
 */
export function useActiveCinemaAct(actIds: readonly string[], lightActIds: ReadonlySet<string>) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [overLight, setOverLight] = useState(false);

  useEffect(() => {
    let rafId = 0;
    const measure = () => {
      rafId = 0;
      const vh = window.innerHeight || 900;
      const probeY = vh * 0.35;
      let currentIdx = 0;
      let topIsLight = false;

      for (let i = 0; i < actIds.length; i++) {
        const node = document.getElementById(actIds[i]);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (rect.top <= probeY) {
          currentIdx = i;
        }
        if (rect.top <= 40 && rect.bottom > 40) {
          topIsLight = lightActIds.has(actIds[i]);
        }
      }

      setActiveIndex(currentIdx);
      setOverLight(topIsLight);
    };

    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [actIds, lightActIds]);

  return { activeIndex, overLight };
}
