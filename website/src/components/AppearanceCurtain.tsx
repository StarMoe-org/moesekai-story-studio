import React, { useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";
import {
  CHARACTER_SEEDS,
  getSeedDisplayName,
  type CharacterSeed,
} from "../data/character-seeds";
import type { AppleCopy, SiteLocale } from "../data/cinema-i18n";
import { DAY_NIGHT_SHOTS } from "../data/cinema-media";

interface AppearanceCurtainProps {
  locale: SiteLocale;
  t: AppleCopy["appearance"];
  activeSeed: CharacterSeed | null;
  onSelectSeed: (seed: CharacterSeed | null) => void;
}

/**
 * Pure `#F5F5F7` section + borderless `#FFFFFF` `28px` rounded card holding the interactive
 * Light (`01`) <-> Dark (`16`) drag curtain + pure white capsule tray of 26 PJSK character dots.
 * Zero subtitle sentences, zero hint captions.
 */
export const AppearanceCurtain: React.FC<AppearanceCurtainProps> = ({
  locale,
  t,
  activeSeed,
  onSelectSeed,
}) => {
  const [splitPct, setSplitPct] = useState(50);
  const draggingRef = useRef(false);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const updateFromClientX = (clientX: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const pct = ((clientX - box.left) / box.width) * 100;
    setSplitPct(Math.max(8, Math.min(92, pct)));
  };

  return (
    <section id="appearance" className="relative bg-[#F5F5F7] px-5 py-16 sm:px-8 sm:py-22">
      <p className="sr-only">
        MoeSekai Story Studio 内置浅色模式与护眼深色模式两套工作区主题，并提供全部 26 位 Project SEKAI 角色官方主题色（初音未来、镜音铃、镜音连、巡音流歌、MEIKO、KAITO、星乃一歌、花里实乃理、宵崎奏等）以及 5 语种操作界面。
      </p>
      <div className="mx-auto max-w-[980px]">
        <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#1D1D1F] sm:text-[42px]">
          {t.heading}
        </h2>

        {/* Borderless Pure `#FFFFFF` 26px Card Hosting Drag Curtain */}
        <div className="mt-8 rounded-[26px] bg-white p-2.5 sm:mt-10 sm:p-4">
          <div
            ref={frameRef}
            data-testid="day-night-curtain"
            onPointerDown={(e) => {
              draggingRef.current = true;
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              updateFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (!draggingRef.current) return;
              updateFromClientX(e.clientX);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
            className="relative aspect-video w-full cursor-ew-resize select-none overflow-hidden rounded-[22px] bg-[#1D1D1F] touch-none"
          >
            <img
              src={DAY_NIGHT_SHOTS.dark}
              alt="MoeSekai Story Studio 深色护眼工作区界面（25 时 19 节点长篇工程与宵崎奏主题色）"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
            >
              <img
                src={DAY_NIGHT_SHOTS.light}
                alt="MoeSekai Story Studio 浅色明亮工作区界面（MORE MORE JUMP! 五角色 Live2D 实时舞台与节点画布）"
                draggable={false}
                className="h-full w-full object-cover"
              />
            </div>

            <span className="pointer-events-none absolute top-4 left-4 rounded-full bg-white/90 px-3.5 py-1 text-[12px] font-semibold text-[#1D1D1F] backdrop-blur-md">
              {t.lightLabel}
            </span>
            <span className="pointer-events-none absolute top-4 right-4 rounded-full bg-[#1D1D1F]/80 px-3.5 py-1 text-[12px] font-semibold text-white backdrop-blur-md">
              {t.darkLabel}
            </span>

            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 bg-white"
              style={{ left: `${splitPct}%` }}
            >
              <div
                className="absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#1D1D1F] shadow-[0_6px_24px_rgba(0,0,0,0.22)]"
              >
                <MoveHorizontal size={18} />
              </div>
            </div>

            <input
              type="range"
              min={8}
              max={92}
              value={Math.round(splitPct)}
              onChange={(e) => setSplitPct(Number(e.target.value))}
              aria-label={t.heading}
              className="sr-only"
            />
          </div>
        </div>

        {/* Centered Pure White Capsule Tray for 26 PJSK Character Color Dots */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <div
            data-testid="character-seed-tray"
            className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-[24px] bg-white px-4 py-2.5 sm:rounded-full sm:px-4.5 lg:flex-nowrap"
          >
            {/* Default Apple Blue reset dot */}
            <button
              type="button"
              data-testid="seed-default"
              aria-label={t.defaultLabel}
              title={t.defaultLabel}
              aria-pressed={activeSeed === null}
              onClick={() => onSelectSeed(null)}
              className="ease-apple h-5.5 w-5.5 shrink-0 rounded-full bg-[#0071E3] transition-transform duration-200 hover:scale-115 sm:h-6 sm:w-6"
              style={{
                boxShadow:
                  activeSeed === null
                    ? "0 0 0 2px #FFFFFF, 0 0 0 3.5px #1D1D1F"
                    : "none",
              }}
            />

            <span className="mx-0.5 h-3.5 w-px bg-[#E8E8ED]" aria-hidden="true" />

            {CHARACTER_SEEDS.map((seed) => {
              const selected = activeSeed?.id === seed.id;
              const name = getSeedDisplayName(seed, locale);
              return (
                <button
                  key={seed.id}
                  type="button"
                  data-testid={`seed-${seed.id}`}
                  aria-label={name}
                  title={`${name} · ${seed.hex}`}
                  aria-pressed={selected}
                  onClick={() => onSelectSeed(seed)}
                  className="ease-apple h-5.5 w-5.5 shrink-0 rounded-full transition-transform duration-200 hover:scale-115 sm:h-6 sm:w-6"
                  style={{
                    backgroundColor: seed.hex,
                    boxShadow: selected
                      ? "0 0 0 2px #FFFFFF, 0 0 0 3.5px #1D1D1F"
                      : "inset 0 0 0 1px rgba(0,0,0,0.08)",
                    transform: selected ? "scale(1.12)" : undefined,
                  }}
                />
              );
            })}
          </div>

          {activeSeed && (
            <div
              data-testid="active-seed-label"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-[#6E6E73]"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: activeSeed.hex }}
              />
              <span className="text-[#1D1D1F]">{getSeedDisplayName(activeSeed, locale)}</span>
              <span className="font-mono text-[12px] uppercase">{activeSeed.hex}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
