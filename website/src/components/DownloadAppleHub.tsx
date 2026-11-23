import React, { useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, Plus, X } from "lucide-react";
import type { AppleCopy } from "../data/cinema-i18n";
import {
  GITHUB_REPO_URL,
  formatFileSize,
  type DetectedVisitorSystem,
  type MirrorId,
  type PlatformKey,
  type ReleaseSnapshot,
} from "../lib/releases";
import { AppleMark, CnbMark, GithubMark, LinuxMark, WindowsMark } from "./BrandMarks";

interface DownloadAppleHubProps {
  t: AppleCopy["download"];
  release: ReleaseSnapshot;
  mirror: MirrorId;
  onToggleMirror: (mirror: MirrorId) => void;
  detected: DetectedVisitorSystem;
}

const PlatformSvg: React.FC<{ platform: PlatformKey; size?: number }> = ({
  platform,
  size = 17,
}) => {
  if (platform === "mac") return <AppleMark size={size} />;
  if (platform === "linux") return <LinuxMark size={size} />;
  return <WindowsMark size={size} />;
};

const NPM_PACKAGES = [
  { name: "@moesekai/story-core", href: "https://www.npmjs.com/package/@moesekai/story-core" },
  { name: "@moesekai/story-editor", href: "https://www.npmjs.com/package/@moesekai/story-editor" },
  { name: "@moesekai/story-agent", href: "https://www.npmjs.com/package/@moesekai/story-agent" },
] as const;

/**
 * Pure Apple `#FFFFFF` section + borderless `#F5F5F7` `28px` rounded container:
 * - Zero subtitle paragraph under the heading
 * - Top bar: Apple `#1D1D1F` black sliding capsule (`CNB` | `GitHub`) + solid Apple Blue CTA
 * - 5 borderless `#FFFFFF` `20px` platform rows
 * - Bottom 3 circular `+` expandable pills (`SHA-256`, `@moesekai/*`, `AI Skill`)
 */
export const DownloadAppleHub: React.FC<DownloadAppleHubProps> = ({
  t,
  release,
  mirror,
  onToggleMirror,
  detected,
}) => {
  const [openDrawer, setOpenDrawer] = useState<"sha" | "pkg" | "skill" | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const primaryInstaller = useMemo(
    () =>
      release.installers.find((i) => i.id === detected.recommendedInstallerId) ||
      release.installers[0],
    [release.installers, detected.recommendedInstallerId],
  );

  const primaryUrl = mirror === "cnb" ? primaryInstaller.cnbUrl : primaryInstaller.githubUrl;
  const releasePageUrl = mirror === "cnb" ? release.cnbReleasePage : release.githubReleasePage;
  const shaUrl = mirror === "cnb" ? release.sha256SumsUrls.cnb : release.sha256SumsUrls.github;

  const copyHash = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((p) => (p === id ? null : p)), 1600);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <section id="download" className="relative bg-white px-5 pt-16 pb-8 sm:px-8 sm:pt-22 sm:pb-12">
      <p className="sr-only">
        免费下载 MPL-2.0 开源跨平台桌面客户端 MoeSekai Story Studio {release.tag}：支持 Windows 安装程序与便携版（.exe）、macOS Apple Silicon 与 Intel（.dmg）以及 Linux（.AppImage），提供 CNB 中国大陆镜像与 GitHub Releases 全球源下载、SHA-256 文件校验值、@moesekai/story-core / story-editor / story-agent npm 开源包、独立 AI Skill 以及 pjsk.moe 网页版。
      </p>
      <div className="mx-auto max-w-[980px]">
        {/* Left-Aligned Heading + Quiet Version Tag — ZERO Subtitle Sentence */}
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#1D1D1F] sm:text-[42px]">
            {t.heading}
          </h2>
          <span className="font-mono text-[15px] font-medium text-[#6E6E73] sm:text-[16px]">
            {release.tag}
          </span>
        </div>

        {/* Borderless `#F5F5F7` 26px Rounded Container */}
        <div className="mt-8 rounded-[26px] bg-[#F5F5F7] p-4 sm:mt-10 sm:p-6">
          {/* Top Bar: Black Sliding Mirror Pill + Auto-Detected Primary Download Pill */}
          <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <div
              role="group"
              aria-label="Download mirror"
              className="relative inline-grid grid-cols-2 self-start rounded-full bg-[#E8E8ED] p-1"
            >
              <span
                aria-hidden="true"
                className="ease-apple pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-[#1D1D1F] transition-transform duration-300"
                style={{
                  transform: mirror === "github" ? "translateX(100%)" : "translateX(0%)",
                }}
              />
              <button
                type="button"
                data-testid="download-mirror-cnb"
                aria-pressed={mirror === "cnb"}
                onClick={() => onToggleMirror("cnb")}
                className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-[13.5px] font-medium transition-colors ${
                  mirror === "cnb" ? "text-white" : "text-[#1D1D1F]"
                }`}
              >
                <CnbMark size={15} />
                <span>{t.cnb}</span>
              </button>
              <button
                type="button"
                data-testid="download-mirror-github"
                aria-pressed={mirror === "github"}
                onClick={() => onToggleMirror("github")}
                className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-[13.5px] font-medium transition-colors ${
                  mirror === "github" ? "text-white" : "text-[#1D1D1F]"
                }`}
              >
                <GithubMark size={15} />
                <span>{t.github}</span>
              </button>
            </div>

            <a
              href={primaryUrl}
              data-testid="download-spotlight-cta"
              className="ease-apple inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3 text-[14.5px] font-medium text-white transition-all duration-200 hover:brightness-105 active:scale-[0.98]"
              style={{ backgroundColor: "var(--apple-btn, #0071E3)" }}
            >
              <PlatformSvg platform={primaryInstaller.platform} size={16} />
              <span className="whitespace-nowrap">
                {t.downloadVerb} {t.platforms[primaryInstaller.id]}
              </span>
              <span className="shrink-0 font-mono text-[12px] opacity-85">
                {formatFileSize(primaryInstaller.sizeBytes)}
              </span>
            </a>
          </div>

          {/* 5 Borderless `#FFFFFF` 20px Platform Rows */}
          <div className="mt-6 space-y-2.5">
            {release.installers.map((item) => {
              const href = mirror === "cnb" ? item.cnbUrl : item.githubUrl;
              const fileName = mirror === "cnb" ? item.cnbFilename : item.githubFilename;
              return (
                <div
                  key={item.id}
                  data-testid={`installer-row-${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-[20px] bg-white px-4 py-3.5 sm:px-5 sm:py-4"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F5F5F7] text-[#1D1D1F]">
                      <PlatformSvg platform={item.platform} size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-semibold text-[#1D1D1F] sm:text-[15px]">
                          {t.platforms[item.id]}
                        </span>
                        <span className="font-mono text-[11px] uppercase text-[#6E6E73]">
                          {item.arch}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[11.5px] text-[#6E6E73]">
                        {fileName}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                    <span className="hidden font-mono text-[12.5px] text-[#6E6E73] sm:inline">
                      {formatFileSize(item.sizeBytes)}
                    </span>
                    <a
                      href={href}
                      className="ease-apple inline-flex items-center justify-center rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition-all hover:brightness-105"
                      style={{ backgroundColor: "var(--apple-btn, #0071E3)" }}
                    >
                      {t.downloadVerb}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Bar: 3 Minimal Circular `+` Expandable Pills + Release / Web Links */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: "sha", label: t.shaLabel, testId: "toggle-sha256" },
                  { id: "pkg", label: t.pkgLabel, testId: "toggle-dev-packages" },
                  { id: "skill", label: t.skillLabel, testId: "toggle-ai-skill" },
                ] as const
              ).map((pill) => {
                const isOpen = openDrawer === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    data-testid={pill.testId}
                    aria-expanded={isOpen}
                    onClick={() => setOpenDrawer((cur) => (cur === pill.id ? null : pill.id))}
                    className={`inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2 text-[13px] font-medium transition-colors ${
                      isOpen
                        ? "bg-[#1D1D1F] text-white"
                        : "bg-white text-[#1D1D1F] hover:bg-[#EAEAEF]"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        isOpen ? "bg-white/20 text-white" : "bg-[#F5F5F7] text-[#1D1D1F]"
                      }`}
                    >
                      {isOpen ? <X size={13} /> : <Plus size={13} />}
                    </span>
                    <span className="font-mono text-[12.5px]">{pill.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-5 text-[14px]">
              <a
                href={releasePageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:underline"
                style={{ color: "var(--apple-link, #0066CC)" }}
              >
                <span>{t.releaseLink}</span>
                <ChevronRight size={15} />
              </a>
              <a
                href="https://pjsk.moe/story-maker"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:underline"
                style={{ color: "var(--apple-link, #0066CC)" }}
              >
                <span>{t.webLink}</span>
                <ChevronRight size={15} />
              </a>
            </div>
          </div>

          {/* Expandable Drawers (Strictly Clean `#FFFFFF` Cards When Opened) */}
          {openDrawer === "sha" && (
            <div data-testid="sha256-panel" className="mt-4 rounded-[20px] bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[12.5px] font-medium text-[#1D1D1F]">
                  SHA256SUMS · {release.tag}
                </span>
                <a
                  href={shaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[12px] hover:underline"
                  style={{ color: "var(--apple-link, #0066CC)" }}
                >
                  <span>SHA256SUMS.txt</span>
                  <ArrowUpRight size={13} />
                </a>
              </div>
              <div className="space-y-2">
                {release.installers.map((item) => {
                  const hash = item.sha256 || "SHA256SUMS.txt";
                  const copied = copiedId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-1.5 rounded-[14px] bg-[#F5F5F7] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-[#1D1D1F]">
                          {t.platforms[item.id]}
                        </div>
                        <div className="truncate font-mono text-[11px] text-[#6E6E73]">{hash}</div>
                      </div>
                      {item.sha256 && (
                        <button
                          type="button"
                          onClick={() => void copyHash(item.id, item.sha256!)}
                          className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1 text-[11.5px] font-medium text-[#1D1D1F]"
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copied ? t.copied : t.copy}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {openDrawer === "pkg" && (
            <div className="mt-4 grid gap-2 rounded-[20px] bg-white p-5 sm:grid-cols-3">
              {NPM_PACKAGES.map((pkg) => (
                <a
                  key={pkg.name}
                  href={pkg.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-[14px] bg-[#F5F5F7] px-4 py-3 font-mono text-[12.5px] font-medium text-[#1D1D1F] transition-colors hover:bg-[#EAEAEF]"
                >
                  <span className="truncate">{pkg.name}</span>
                  <ArrowUpRight size={14} className="shrink-0 text-[#6E6E73]" />
                </a>
              ))}
            </div>
          )}

          {openDrawer === "skill" && (
            <div className="mt-4 flex flex-col gap-3 rounded-[20px] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono text-[13px] font-medium text-[#1D1D1F]">
                skills/moesekai-story-script
              </span>
              <a
                href={`${GITHUB_REPO_URL}/tree/main/skills/moesekai-story-script`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 rounded-full px-4 py-1.5 text-[13px] font-medium text-white"
                style={{ backgroundColor: "var(--apple-btn, #0071E3)" }}
              >
                <span>GitHub</span>
                <ArrowUpRight size={14} />
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
