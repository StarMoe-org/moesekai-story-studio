import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { LOCALE_OPTIONS, type SiteLocale } from "../data/cinema-i18n";
import { LocaleFlag } from "./BrandMarks";

interface CinemaChromeProps {
  locale: SiteLocale;
  onChangeLocale: (next: SiteLocale) => void;
  languageAria: string;
}

/**
 * Zero Top Navbar (<header> count === 0).
 * Top-right holds ONLY 1 circular frosted vector-flag language trigger expanding
 * a clean 4-locale popover (CN / Hong Kong SAR Bauhinia / JP / UK).
 */
export const CinemaChrome: React.FC<CinemaChromeProps> = ({
  locale,
  onChangeLocale,
  languageAria,
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="fixed top-4 right-4 z-50 sm:top-6 sm:right-6">
      <button
        type="button"
        data-testid="locale-trigger"
        aria-label={languageAria}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="ease-apple flex h-11 w-11 items-center justify-center rounded-full bg-white/88 shadow-[0_4px_20px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-transform duration-200 hover:scale-105 hover:bg-white"
      >
        <LocaleFlag locale={locale} className="h-[15px] w-[22px]" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="locale-menu"
          className="mt-2.5 w-44 origin-top-right rounded-[20px] bg-white/96 p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.14)] backdrop-blur-2xl"
        >
          {LOCALE_OPTIONS.map((opt) => {
            const active = opt.code === locale;
            return (
              <button
                key={opt.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                data-testid={`locale-${opt.code}`}
                onClick={() => {
                  onChangeLocale(opt.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-left text-[13.5px] transition-colors ${
                  active
                    ? "bg-[#F5F5F7] font-semibold text-[#1D1D1F]"
                    : "font-medium text-[#515154] hover:bg-[#F5F5F7]/70 hover:text-[#1D1D1F]"
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <LocaleFlag locale={opt.code} className="h-[14px] w-[21px]" />
                  <span>{opt.nativeLabel}</span>
                </span>
                {active && (
                  <Check size={14} style={{ color: "var(--apple-btn, #0071E3)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
