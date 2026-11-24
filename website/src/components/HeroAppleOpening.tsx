import React from "react";
import { ArrowUpRight } from "lucide-react";
import { COMMUNITY_STORIES_URL, type AppleCopy } from "../data/cinema-i18n";
import { CINEMA_CLIPS } from "../data/cinema-media";
import { StudioLogo } from "./BrandMarks";

interface HeroAppleOpeningProps {
  t: AppleCopy["hero"];
  versionTag: string;
}

/**
 * Pure `#FFFFFF` Apple Hero aligned to the unified `980px` desktop visual spine:
 * generous side margins on 1280px/1440px/1920px so title, 16:9 WebM stage, and
 * frosted bottom capsule breathe cleanly above the fold.
 */
export const HeroAppleOpening: React.FC<HeroAppleOpeningProps> = ({ t, versionTag }) => (
  <section
    id="hero"
    className="relative flex min-h-[78svh] flex-col items-center justify-center gap-6 bg-white px-5 pt-14 pb-10 sm:min-h-[96svh] sm:justify-center sm:gap-7 sm:px-8 sm:pt-10 sm:pb-10"
  >
    {/* Minimal Centered Lockup + Refined Display Headline */}
    <div className="mx-auto flex max-w-[980px] flex-col items-center text-center">
      <div className="inline-flex items-center gap-2">
        <StudioLogo size={20} />
        <span className="text-[16px] font-semibold tracking-[-0.015em] text-[#1D1D1F] sm:text-[19px]">
          {t.eyebrow}
        </span>
      </div>
      <h1 className="mt-2 text-[clamp(2.45rem,4.6vw,4.15rem)] leading-[1.06] font-semibold tracking-[-0.036em] text-[#1D1D1F]">
        {t.title}
      </h1>
      <p className="sr-only">
        MoeSekai Story Studio（story.pjsk.moe）是一款开源免费的 Project SEKAI（世界计划 / PJSK）Live2D 互动剧情创作工具。
        内置 MoeSekai Story Agent，支持自然语言许愿生成并校验 .msk 剧本、快照一键回滚、五角色 Live2D 实时舞台、可视化节点画布与 .msk 源码双向同步、多语言校对与自定义配音打包。
      </p>
    </div>

    {/* Borderless 28px-Rounded Real VP9 WebM Stage */}
    <div className="w-full max-w-[860px]">
      <div className="relative aspect-video w-full overflow-hidden rounded-[26px] bg-[#F5F5F7]">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={CINEMA_CLIPS.stageLive.poster}
          aria-label="MoeSekai Story Studio 五角色 Live2D 实时舞台演出演示：花里实乃理与 MORE MORE JUMP! 同台动作与表情联动"
          className="h-full w-full object-cover"
        >
          <source src={CINEMA_CLIPS.stageLive.webm} type="video/webm" />
          MoeSekai Story Studio 实机演示视频：五位 Project SEKAI Live2D 角色在舞台的世界同台实时演出动作、面部表情与台词字幕。
        </video>
      </div>
    </div>

    {/* Apple Bottom Centered Frosted Floating Capsule */}
    <div
      data-testid="hero-floating-capsule"
      className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[26px] bg-[#F5F5F7]/92 px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.055)] backdrop-blur-2xl sm:flex-nowrap sm:gap-4 sm:rounded-full sm:py-1.5 sm:pr-2 sm:pl-5"
    >
      <span className="whitespace-nowrap text-[12.5px] font-medium text-[#1D1D1F] sm:text-[14px]">
        <span className="font-mono">{versionTag}</span>
        <span className="mx-1.5 text-[#6E6E73] sm:mx-2">·</span>
        <span>{t.capsuleMeta}</span>
      </span>

      <div className="inline-flex shrink-0 items-center gap-1.5 sm:gap-2">
        <a
          href={COMMUNITY_STORIES_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="hero-community-cta"
          className="group ease-apple inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full bg-white/95 px-3.5 py-1.5 text-[13px] font-medium text-[#1D1D1F] ring-1 ring-inset ring-black/[0.08] transition-all duration-200 hover:bg-white hover:ring-black/[0.16] active:scale-[0.98] sm:px-4 sm:text-[13.5px]"
        >
          <span>{t.communityCta}</span>
          <ArrowUpRight
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            className="opacity-65 transition-transform duration-200 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] group-hover:opacity-100"
          />
        </a>

        <a
          href="#download"
          data-testid="hero-capsule-cta"
          className="ease-apple inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition-all duration-200 hover:brightness-105 active:scale-[0.98] sm:px-4.5 sm:text-[13.5px]"
          style={{ backgroundColor: "var(--apple-btn, #0071E3)" }}
        >
          {t.capsuleCta}
        </a>
      </div>
    </div>
  </section>
);
