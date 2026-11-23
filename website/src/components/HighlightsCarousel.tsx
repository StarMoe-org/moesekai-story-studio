import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AppleCopy } from "../data/cinema-i18n";

interface HighlightsCarouselProps {
  t: AppleCopy["highlights"];
  onOpenGallery: () => void;
}

/**
 * Apple `iphone-duo` Highlights Peeking Wide Carousel (`#F5F5F7`) tuned for balanced
 * desktop breathing room (`980px` header rail, `880px` centered mega-card with clean
 * left & right neighbor peeking so title + card + controls fit comfortably in one viewport).
 */
export const HighlightsCarousel: React.FC<HighlightsCarouselProps> = ({
  t,
  onOpenGallery,
}) => {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const count = t.slides.length;

  useEffect(() => {
    if (paused) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const timer = window.setInterval(() => {
      setActive((cur) => (cur + 1) % count);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, count, active]);

  useEffect(() => {
    const track = trackRef.current;
    const card = slideRefs.current[active];
    if (!track || !card) return;
    const targetLeft = card.offsetLeft - (track.clientWidth - card.clientWidth) / 2;
    track.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
  }, [active]);

  const slideDescriptions: Record<string, string> = {
    "hl-agent":
      "MoeSekai Story Agent 实机界面：在右侧输入一句话剧情愿望或修改指令，自动检索官方角色语气、编写规范 .msk 剧本、静态校验全部分支并自动留存回滚快照。",
    "hl-live2d":
      "Project SEKAI 五角色 Live2D 实时舞台实机视频：支持配置站位前后层级、身体动作、面部表情与听者 react() 反应，并随时试播多结局分支。",
    "hl-flow":
      "可视化节点流画布与 .msk 纯文本剧本双向实时同步实机视频：画布拖拽连接场景幕、选项分支与结局节点，切回代码模式批量精修零损耗。",
    "hl-voice":
      "五语种 .i18n.json 双栏字幕校对与自定义配音清单（manifest.json）实机界面：按 beatId 自动匹配 20/20 句自制配音或 TTS 音轨并一键打包。",
    "hl-export":
      "导出前自动静态编译与分支图体检对话框：验证 0 错误 0 警告后导出纯净 .msk 脚本或完整 .zip 剧情包，直接导入 pjsk.moe 播放器观看。",
  };

  return (
    <section id="highlights" className="relative bg-[#F5F5F7] py-16 sm:py-22">
      <p className="sr-only">
        MoeSekai Story Studio 五大核心亮点：AI 许愿写整幕剧本与快照回滚、五位 Live2D 角色同台实时演绎、可视化节点画布与 .msk 文本双向同步、5 语种校对与自定义配音打包、导出前自动体检零报错分享。
      </p>
      {/* Header Row aligned to unified 980px spine — generous gap from top-right flag */}
      <div className="mx-auto flex max-w-[980px] flex-wrap items-baseline justify-between gap-4 px-5 sm:px-8">
        <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#1D1D1F] sm:text-[42px]">
          {t.heading}
        </h2>
        <button
          type="button"
          data-testid="open-all-screens"
          onClick={onOpenGallery}
          className="inline-flex items-center gap-0.5 text-[15px] font-normal transition-opacity hover:underline sm:text-[16.5px]"
          style={{ color: "var(--apple-link, #0066CC)" }}
        >
          <span>{t.galleryLink}</span>
          <ChevronRight size={17} strokeWidth={2} />
        </button>
      </div>

      {/* Peeking Wide Carousel Track (`880px` dead-centered card + symmetric peeking neighbors at every desktop width) */}
      <div
        ref={trackRef}
        data-testid="highlights-track"
        className="no-scrollbar mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto px-[6vw] sm:mt-9 sm:gap-6 sm:px-[max(2rem,calc((100vw-880px)/2))]"
      >
        {t.slides.map((slide, idx) => (
          <div
            key={slide.id}
            ref={(el) => {
              slideRefs.current[idx] = el;
            }}
            data-testid={`highlight-slide-${idx}`}
            onClick={() => setActive(idx)}
            className="w-[86vw] max-w-[880px] shrink-0 snap-center cursor-pointer overflow-hidden rounded-[26px] bg-white px-5 pt-6 pb-5 sm:w-[70vw] sm:px-8 sm:pt-8 sm:pb-6"
          >
            {/* Strictly 2 Short Centered Lines Only */}
            <div className="mx-auto max-w-xl text-center">
              <p className="text-[20px] leading-[1.22] font-semibold tracking-[-0.022em] text-[#1D1D1F] sm:text-[26px]">
                {slide.line1}
                <br />
                {slide.line2}
              </p>
            </div>

            {/* Clean Borderless 16:9 Media — Zero Caption Below */}
            <div className="mt-5 overflow-hidden rounded-[18px] bg-[#F5F5F7] sm:mt-6">
              <div className="aspect-video w-full overflow-hidden">
                {slide.kind === "video" ? (
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                    poster={slide.poster}
                    aria-label={slideDescriptions[slide.id] || `${slide.line1} ${slide.line2}`}
                    className="h-full w-full object-cover"
                  >
                    <source src={slide.src} type="video/webm" />
                    {slideDescriptions[slide.id] || `${slide.line1} ${slide.line2}`}
                  </video>
                ) : (
                  <img
                    src={slide.src}
                    alt={slideDescriptions[slide.id] || `${slide.line1} ${slide.line2}`}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Refined Apple Progress-Dot Pill + Standalone 48x48 Circular Pause/Play Button */}
      <div className="mt-7 flex items-center justify-center gap-3.5">
        <div
          role="tablist"
          aria-label={t.heading}
          className="inline-flex h-12 items-center gap-2.5 rounded-full bg-[#E8E8ED] px-5"
        >
          {t.slides.map((slide, idx) => {
            const isCurrent = idx === active;
            return (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                aria-label={slide.line1}
                data-testid={`highlight-dot-${idx}`}
                onClick={() => setActive(idx)}
                className="ease-apple relative h-2 overflow-hidden rounded-full transition-all duration-300"
                style={{
                  width: isCurrent ? "40px" : "8px",
                  backgroundColor: isCurrent
                    ? "rgba(29, 29, 31, 0.18)"
                    : "rgba(29, 29, 31, 0.36)",
                }}
              >
                {isCurrent && (
                  <span
                    key={`${active}-${paused ? "p" : "r"}`}
                    className={`block h-full w-full rounded-full bg-[#1D1D1F] ${
                      paused ? "" : "animate-apple-progress"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-testid="highlight-pause-btn"
          aria-label={paused ? t.playAria : t.pauseAria}
          onClick={() => setPaused((p) => !p)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E8E8ED] text-[#1D1D1F] transition-colors hover:bg-[#DFDFE6]"
        >
          {paused ? (
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
              <rect x="6.5" y="5.5" width="3.8" height="13" rx="1.2" />
              <rect x="13.7" y="5.5" width="3.8" height="13" rx="1.2" />
            </svg>
          )}
        </button>
      </div>
    </section>
  );
};
