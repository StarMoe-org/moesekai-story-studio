import React, { useEffect, useMemo, useState } from "react";
import { AppearanceCurtain } from "./components/AppearanceCurtain";
import { CinemaChrome } from "./components/CinemaChrome";
import { DownloadAppleHub } from "./components/DownloadAppleHub";
import { FeatureStageTabs } from "./components/FeatureStageTabs";
import { HeroAppleOpening } from "./components/HeroAppleOpening";
import { HighlightsCarousel } from "./components/HighlightsCarousel";
import { ScreenLightbox } from "./components/ScreenLightbox";
import { StarMoeFooter } from "./components/StarMoeFooter";
import { deriveAppleAccent, type CharacterSeed } from "./data/character-seeds";
import { APPLE_COPY, type SiteLocale } from "./data/cinema-i18n";
import { CONTACT_STRIP_FRAMES } from "./data/cinema-media";
import {
  STATIC_FALLBACK_RELEASE,
  detectVisitorSystem,
  fetchLatestRelease,
  type MirrorId,
  type ReleaseSnapshot,
} from "./lib/releases";

export const App: React.FC = () => {
  const [locale, setLocale] = useState<SiteLocale>("zh-CN");
  const [mirror, setMirror] = useState<MirrorId>("cnb");
  const [release, setRelease] = useState<ReleaseSnapshot>(STATIC_FALLBACK_RELEASE);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState<CharacterSeed | null>(null);

  const detected = useMemo(() => detectVisitorSystem(), []);
  const copy = APPLE_COPY[locale];
  const accent = useMemo(() => deriveAppleAccent(activeSeed), [activeSeed]);

  useEffect(() => {
    let mounted = true;
    void fetchLatestRelease(4500).then((latest) => {
      if (mounted) setRelease(latest);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.metaTitle;
  }, [locale, copy.metaTitle]);

  const handleLocaleChange = (next: SiteLocale) => {
    setLocale(next);
    setMirror(next === "zh-CN" || next === "zh-HK" ? "cnb" : "github");
  };

  return (
    <div
      className="min-h-screen bg-white text-[#1D1D1F]"
      style={
        {
          "--apple-btn": accent.button,
          "--apple-link": accent.link,
          "--accent": accent.button,
          "--accent-raw": accent.raw,
        } as React.CSSProperties
      }
    >
      {/* Zero Top Navbar — strictly 1 circular vector-flag language trigger */}
      <CinemaChrome
        locale={locale}
        onChangeLocale={handleLocaleChange}
        languageAria={copy.languageAria}
      />

      <main>
        {/* 1. Pure `#FFFFFF` Hero + Frosted Bottom Capsule (Apple `step_4_shot_1.png`) */}
        <HeroAppleOpening t={copy.hero} versionTag={release.tag} />

        {/* 2. `#F5F5F7` Highlights Peeking Wide Carousel + Progress Dots + 56px Pause (Apple `step_25_shot_1.png`) */}
        <HighlightsCarousel
          t={copy.highlights}
          onOpenGallery={() => setLightboxId(CONTACT_STRIP_FRAMES[0].id)}
        />

        {/* 3. `#FFFFFF` Giant Borderless Media + Black Sliding Capsule Tab Bar (Apple `step_17_shot_2.png`) */}
        <FeatureStageTabs t={copy.stage} />

        {/* 4. `#F5F5F7` Day/Night Curtain + 26 Character Color Dots */}
        <AppearanceCurtain
          locale={locale}
          t={copy.appearance}
          activeSeed={activeSeed}
          onSelectSeed={setActiveSeed}
        />

        {/* 5. `#FFFFFF` Calm Apple Download Hub + `#F5F5F7` Inner Container */}
        <DownloadAppleHub
          t={copy.download}
          release={release}
          mirror={mirror}
          onToggleMirror={setMirror}
          detected={detected}
        />
      </main>

      {/* 6. Seamless `#FFFFFF` -> Dusk -> StarMoe Dawn Gold & Starry Sky Footer */}
      <StarMoeFooter versionTag={release.tag} />

      <ScreenLightbox
        locale={locale}
        frames={CONTACT_STRIP_FRAMES}
        activeId={lightboxId}
        onSelectId={setLightboxId}
      />
    </div>
  );
};

export default App;
