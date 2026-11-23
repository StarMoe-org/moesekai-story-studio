import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SiteLocale } from "../data/cinema-i18n";
import type { ContactFrame } from "../data/cinema-media";

interface ScreenLightboxProps {
  locale: SiteLocale;
  frames: readonly ContactFrame[];
  activeId: string | null;
  onSelectId: (id: string | null) => void;
}

/**
 * Clean full-screen Lightbox for browsing all 12 unretouched Studio screens (`← / → / ESC`).
 * Zero long caption walls — only crisp frame index + concise title.
 */
export const ScreenLightbox: React.FC<ScreenLightboxProps> = ({
  locale,
  frames,
  activeId,
  onSelectId,
}) => {
  const index = activeId ? frames.findIndex((f) => f.id === activeId) : -1;
  const active = index >= 0 ? frames[index] : null;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectId(null);
      if (e.key === "ArrowLeft") {
        onSelectId(frames[(index - 1 + frames.length) % frames.length].id);
      }
      if (e.key === "ArrowRight") {
        onSelectId(frames[(index + 1) % frames.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, frames, index, onSelectId]);

  if (!active) return null;

  const prev = () => onSelectId(frames[(index - 1 + frames.length) % frames.length].id);
  const next = () => onSelectId(frames[(index + 1) % frames.length].id);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title[locale]}
      onClick={() => onSelectId(null)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1D1D1F]/80 p-4 backdrop-blur-xl sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl overflow-hidden rounded-[28px] bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-[#6E6E73]">
              {active.frameNo} / {String(frames.length).padStart(2, "0")}
            </span>
            <span className="text-[15px] font-semibold text-[#1D1D1F]">
              {active.title[locale]}
            </span>
          </div>
          <button
            type="button"
            data-testid="lightbox-close"
            onClick={() => onSelectId(null)}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F5F7] text-[#1D1D1F] transition-colors hover:bg-[#E8E8ED]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative bg-[#F5F5F7]">
          <img
            src={active.src}
            alt={active.title[locale]}
            className="max-h-[78vh] w-full object-contain"
          />
          <button
            type="button"
            onClick={prev}
            aria-label="Previous"
            className="absolute top-1/2 left-4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-[#1D1D1F] shadow-md transition-transform hover:scale-105"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next"
            className="absolute top-1/2 right-4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-[#1D1D1F] shadow-md transition-transform hover:scale-105"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
