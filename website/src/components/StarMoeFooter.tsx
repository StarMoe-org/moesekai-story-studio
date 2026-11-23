import React, { useEffect, useRef } from "react";
import { CNB_REPO_URL, GITHUB_REPO_URL } from "../lib/releases";
import {
  BilibiliMark,
  CnbMark,
  DiscordMark,
  GithubMark,
  MailMark,
  MoesekaiMark,
  QqMark,
  StarMoeLogo,
} from "./BrandMarks";

interface StarMoeFooterProps {
  versionTag: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FooterStarCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;

    type Star = {
      x: number;
      y: number;
      r: number;
      base: number;
      twk: number;
      phase: number;
      color: string;
      flare: boolean;
    };

    let stars: Star[] = [];

    const buildStars = () => {
      const rand = mulberry32(0x57a40e26);
      const count = Math.max(85, Math.min(185, Math.floor((w * h) / 3400)));
      const palette = ["#ffd9a8", "#f0a868", "#f5efe0", "#ffffff"];
      stars = Array.from({ length: count }, () => {
        const r = 0.45 + Math.pow(rand(), 1.75) * 1.65;
        const pick = rand();
        const color =
          pick < 0.46 ? palette[0] : pick < 0.66 ? palette[1] : pick < 0.85 ? palette[2] : palette[3];
        return {
          x: rand() * w,
          y: rand() * h,
          r,
          base: 0.3 + rand() * 0.64,
          twk: 0.55 + rand() * 1.6,
          phase: rand() * Math.PI * 2,
          color,
          flare: r > 1.5,
        };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
    };

    let time = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        const nightFade = Math.min(1, Math.max(0, (s.y - 165) / 140));
        if (nightFade <= 0.01) continue;

        const tw = reduceMotion ? 0.85 : Math.sin(time * s.twk + s.phase) * 0.35 + 0.65;
        const alpha = s.base * tw * nightFade;
        if (alpha <= 0.01) continue;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();

        if (s.flare) {
          ctx.globalAlpha = alpha * 0.45;
          ctx.strokeStyle = "#ffd9a8";
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(s.x - s.r * 4.4, s.y);
          ctx.lineTo(s.x + s.r * 4.4, s.y);
          ctx.moveTo(s.x, s.y - s.r * 4.4);
          ctx.lineTo(s.x, s.y + s.r * 4.4);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (!reduceMotion) {
        time += 0.02;
        raf = window.requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};

const SVG_COMMUNITY_LINKS = [
  { id: "pjsk", label: "pjsk.moe", href: "https://pjsk.moe", Icon: MoesekaiMark },
  { id: "bilibili", label: "Bilibili", href: "https://space.bilibili.com/5441521", Icon: BilibiliMark },
  {
    id: "qq",
    label: "QQ 1130135677",
    href: "https://qm.qq.com/cgi-bin/qm/qr?k=iUZhVFvgHRyknINbLwZXeM5jKZS_25na&jump_from=webapi&authKey=O80SsyvpH0k8Y8TU2sCFqZNgqZ4CsuBu6t9fBIuxwW1xi1Upd7NVI029a8tZgwZE",
    Icon: QqMark,
  },
  { id: "discord", label: "Discord", href: "https://discord.gg/6JQMVQ2Mku", Icon: DiscordMark },
  { id: "cnb", label: "CNB", href: CNB_REPO_URL, Icon: CnbMark },
  { id: "github", label: "GitHub", href: GITHUB_REPO_URL, Icon: GithubMark },
  { id: "mail", label: "mail@exmeaning.com", href: "mailto:mail@exmeaning.com", Icon: MailMark },
] as const;

/**
 * Seamless `#FFFFFF` -> Twilight -> StarMoe Dawn Gold & Starry Sky Footer.
 * Zero filler credit prose or disclaimer paragraphs — strictly Logo + domain/version + 7 SVG orbs + MPL-2.0 line.
 */
export const StarMoeFooter: React.FC<StarMoeFooterProps> = ({ versionTag }) => (
  <footer
    data-testid="starmoe-footer"
    className="relative overflow-hidden pt-52 pb-14 text-[#F5EFE0]"
    style={{
      background:
        "linear-gradient(180deg, #FFFFFF 0%, #EEF1F7 14%, #AAB4CE 29%, #343F68 46%, #0E1536 62%, #06091E 82%, #0B102E 100%)",
    }}
  >
    <FooterStarCanvas />

    <div className="relative z-10 mx-auto max-w-[980px] px-5 sm:px-8">
      <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
        <div className="flex flex-col items-center gap-3 md:items-start">
          <a
            href="https://star.moe"
            target="_blank"
            rel="noreferrer"
            aria-label="StarMoe"
            className="inline-flex items-center text-[#FFD9A8] transition-all duration-300 hover:drop-shadow-[0_0_20px_rgba(255,217,168,0.45)]"
          >
            <StarMoeLogo className="h-7 w-auto sm:h-8" />
          </a>
          <div className="flex items-center gap-2.5 text-xs text-[#A3A8C8]">
            <span className="font-mono tracking-[0.14em]">story.pjsk.moe</span>
            <span className="text-[#FFD9A8]/40">·</span>
            <span className="rounded-full bg-[#FFD9A8]/14 px-2.5 py-0.5 font-mono text-[10.5px] text-[#FFD9A8]">
              {versionTag}
            </span>
          </div>
        </div>

        <nav
          aria-label="Community links"
          className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5"
        >
          {SVG_COMMUNITY_LINKS.map(({ id, label, href, Icon }) => (
            <a
              key={id}
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noreferrer" : undefined}
              aria-label={label}
              title={label}
              data-testid={`footer-icon-${id}`}
              className="ease-apple flex h-10 w-10 items-center justify-center rounded-full border border-[#FFD9A8]/24 bg-[#0D1333]/70 text-[#F5EFE0]/90 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#FFD9A8] hover:bg-[#FFD9A8]/16 hover:text-[#FFD9A8] sm:h-11 sm:w-11"
            >
              <Icon size={18} />
            </a>
          ))}
        </nav>
      </div>

      <div className="mt-12 flex justify-center md:justify-end">
        <p className="font-mono text-[10.5px] tracking-[0.2em] text-[#989DC0]">
          MPL-2.0 · EST. 2025 · STARMOE
        </p>
      </div>
    </div>
  </footer>
);
