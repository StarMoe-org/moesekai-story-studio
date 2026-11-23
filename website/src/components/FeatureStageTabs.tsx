import React, { useLayoutEffect, useRef, useState } from "react";
import type { AppleCopy } from "../data/cinema-i18n";

interface FeatureStageTabsProps {
  t: AppleCopy["stage"];
}

/**
 * Pure `#FFFFFF` Giant Borderless Stage + Black Sliding Capsule Tab Bar, aligned to the
 * unified `980px` Apple desktop rail so heading + 16:9 stage + tab bar sit cleanly in view.
 */
export const FeatureStageTabs: React.FC<FeatureStageTabsProps> = ({ t }) => {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pillRect, setPillRect] = useState({ left: 6, width: 100 });

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current[active];
      if (!btn) return;
      setPillRect({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, t]);

  const current = t.tabs[active];

  const tabDescriptions: Record<string, string> = {
    "tab-agent":
      "MoeSekai Story Agent 许愿写剧本实机截图：支持从零创作与修改模式、Plan 大纲、官方剧情角色语气检索、工具调用追踪与自动编译校验。",
    "tab-rollback":
      "MoeSekai Story Agent 快照历史与一键回滚实机截图：每次修改自动保存独立版本快照，不满意随时无损恢复任意历史状态。",
    "tab-live2d":
      "Project SEKAI Live2D 互动选项分支试播视频：屋顶三路选项弹层实时演算变量并无缝跳转对应多结局分支剧情。",
    "tab-flow":
      "可视化节点流画布实机视频：支持场景幕、选项分支、条件判断与结局节点连线管理、一键自动布局及右侧动作表情检视器。",
    "tab-msk":
      ".msk 人类可读纯文本源码双向实时同步实机视频：编辑脚本代码后即时刷新画布与舞台演出，方便版本管理与外部 AI 协写。",
  };

  return (
    <section id="stage" className="relative bg-white px-5 py-16 sm:px-8 sm:py-22">
      <p className="sr-only">
        完整工作流覆盖 MoeSekai Story Agent 许愿生成剧本、快照历史一键回滚、多角色 Live2D 实时舞台与选项试播、可视化节点流画布以及 .msk 纯文本源码实时双向同步，支持 OpenAI、Claude、Gemini、DeepSeek、Qwen、Grok、Kimi、GLM、OpenRouter、Mistral 与 Ollama 本地模型。
      </p>
      <div className="mx-auto max-w-[980px]">
        {/* Left-Aligned Heading + Single Apple Two-Tone Inline-Emphasis Sentence */}
        <div>
          <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#1D1D1F] sm:text-[42px]">
            {t.heading}
          </h2>
          <p className="mt-4 max-w-[740px] text-[17px] leading-[1.48] font-semibold tracking-[-0.014em] text-[#6E6E73] sm:text-[20px]">
            {t.emphasis.map((seg, i) =>
              seg.strong ? (
                <span key={i} className="text-[#1D1D1F]">
                  {seg.text}
                </span>
              ) : (
                <React.Fragment key={i}>{seg.text}</React.Fragment>
              ),
            )}
          </p>
        </div>

        {/* Borderless 26px-Rounded 16:9 Real Studio Stage — ZERO Caption Below */}
        <div
          data-testid="feature-stage-media"
          className="mt-8 aspect-video w-full overflow-hidden rounded-[26px] bg-[#F5F5F7] sm:mt-10"
        >
          {current.kind === "video" ? (
            <video
              key={current.src}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              poster={current.poster}
              aria-label={tabDescriptions[current.id] || current.label}
              className="h-full w-full object-cover"
            >
              <source src={current.src} type="video/webm" />
              {tabDescriptions[current.id] || current.label}
            </video>
          ) : (
            <img
              src={current.src}
              alt={tabDescriptions[current.id] || current.label}
              className="h-full w-full object-cover"
            />
          )}
        </div>

        {/* Apple `#F5F5F7` Pill Bar + Smooth Sliding `#1D1D1F` Pure Black Capsule */}
        <div className="mt-7 flex justify-center">
          <div
            ref={trackRef}
            role="tablist"
            aria-label={t.heading}
            className="no-scrollbar relative inline-flex max-w-full items-center overflow-x-auto rounded-full bg-[#F5F5F7] p-1.5"
          >
            <span
              aria-hidden="true"
              className="ease-apple pointer-events-none absolute top-1.5 bottom-1.5 rounded-full bg-[#1D1D1F] transition-all duration-350"
              style={{
                left: `${pillRect.left}px`,
                width: `${pillRect.width}px`,
              }}
            />
            {t.tabs.map((tab, idx) => {
              const isSelected = idx === active;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    btnRefs.current[idx] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`stage-tab-${idx}`}
                  onClick={() => setActive(idx)}
                  className={`relative z-10 shrink-0 rounded-full px-4 py-2 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 sm:px-5 sm:text-[14px] ${
                    isSelected ? "text-white" : "text-[#1D1D1F] hover:text-black"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
