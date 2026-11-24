export type SiteLocale = "zh-CN" | "zh-HK" | "ja" | "en";

export const COMMUNITY_STORIES_URL = "https://pjsk.moe/community/stories";

export const LOCALE_OPTIONS: ReadonlyArray<{
  code: SiteLocale;
  nativeLabel: string;
}> = [
  { code: "zh-CN", nativeLabel: "简体中文" },
  { code: "zh-HK", nativeLabel: "繁體中文" },
  { code: "ja", nativeLabel: "日本語" },
  { code: "en", nativeLabel: "English" },
];

export interface HighlightSlide {
  id: string;
  line1: string;
  line2: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
}

export interface StageTabItem {
  id: string;
  label: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
}

/**
 * Apple `iphone-duo` strict minimal copy schema:
 * - Zero image/video captions
 * - Zero status pills
 * - Zero obvious download subtitles or bloated footer credits
 * - Single Apple two-tone inline-emphasis sentence ONLY in the Feature Stage intro
 */
export interface AppleCopy {
  metaTitle: string;
  languageAria: string;
  hero: {
    eyebrow: string;
    title: string;
    capsuleMeta: string;
    communityCta: string;
    capsuleCta: string;
  };
  highlights: {
    heading: string;
    galleryLink: string;
    pauseAria: string;
    playAria: string;
    slides: [HighlightSlide, HighlightSlide, HighlightSlide, HighlightSlide, HighlightSlide];
  };
  stage: {
    heading: string;
    /** Apple two-tone emphasis segments: muted / bold alternate cleanly */
    emphasis: Array<{ text: string; strong?: boolean }>;
    tabs: [StageTabItem, StageTabItem, StageTabItem, StageTabItem, StageTabItem];
  };
  appearance: {
    heading: string;
    lightLabel: string;
    darkLabel: string;
    defaultLabel: string;
  };
  download: {
    heading: string;
    cnb: string;
    github: string;
    downloadVerb: string;
    releaseLink: string;
    communityLink: string;
    webLink: string;
    shaLabel: string;
    pkgLabel: string;
    skillLabel: string;
    copy: string;
    copied: string;
    platforms: {
      "win-setup": string;
      "win-portable": string;
      "mac-arm64": string;
      "mac-x64": string;
      "linux-appimage": string;
    };
  };
}

export const APPLE_COPY: Record<SiteLocale, AppleCopy> = {
  "zh-CN": {
    metaTitle: "MoeSekai Story Studio — 许愿，即成剧 | PJSK Live2D 互动剧情创作工作室 (story.pjsk.moe)",
    languageAria: "切换语言",
    hero: {
      eyebrow: "MoeSekai Story Studio",
      title: "许愿，即成剧。",
      capsuleMeta: "开源免费",
      communityCta: "社区剧情",
      capsuleCta: "下载",
    },
    highlights: {
      heading: "先看亮点。",
      galleryLink: "查看全部实机",
      pauseAria: "暂停轮播",
      playAria: "播放轮播",
      slides: [
        {
          id: "hl-agent",
          line1: "许个愿。",
          line2: "AI 直接写完一整幕。",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "hl-live2d",
          line1: "五位 Live2D 同台。",
          line2: "实时演绎每个表情。",
          kind: "video",
          src: "/showcase/clips/clip-01-live2d-stage-playback.webm",
          poster: "/showcase/02-player-theater-minori-stage.webp",
        },
        {
          id: "hl-flow",
          line1: "节点画布与 .msk。",
          line2: "改一处，两边同步。",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "hl-voice",
          line1: "五语校对与自定义配音。",
          line2: "一键打包。",
          kind: "image",
          src: "/showcase/12-voice-manifest-bundler.webp",
        },
        {
          id: "hl-export",
          line1: "导出前自动体检。",
          line2: "零报错分享。",
          kind: "image",
          src: "/showcase/13-export-preflight-dialog.webp",
        },
      ],
    },
    stage: {
      heading: "从一句愿望，到完整舞台。",
      emphasis: [
        { text: "输入一句想法，" },
        { text: "MoeSekai Story Agent 检索官方角色语气并写出 .msk 剧本", strong: true },
        { text: "，自动完成" },
        { text: "全分支静态校验", strong: true },
        { text: "与" },
        { text: "快照存档", strong: true },
        { text: "，随时一键回滚。" },
      ],
      tabs: [
        {
          id: "tab-agent",
          label: "许愿写剧本",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "tab-rollback",
          label: "快照回滚",
          kind: "image",
          src: "/showcase/07-ai-agent-snapshots-rollback.webp",
        },
        {
          id: "tab-live2d",
          label: "Live2D 舞台",
          kind: "video",
          src: "/showcase/clips/clip-02-branching-choice-transition.webm",
          poster: "/showcase/03-player-branching-choices-minori.webp",
        },
        {
          id: "tab-flow",
          label: "节点流画布",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "tab-msk",
          label: ".msk 源码",
          kind: "video",
          src: "/showcase/clips/clip-04-msk-code-live-sync.webm",
          poster: "/showcase/05-code-mode-msk-bidirectional.webp",
        },
      ],
    },
    appearance: {
      heading: "昼夜工作区，随你切换。",
      lightLabel: "浅色",
      darkLabel: "深色",
      defaultLabel: "默认蓝",
    },
    download: {
      heading: "下载 MoeSekai Story Studio",
      cnb: "CNB",
      github: "GitHub",
      downloadVerb: "下载",
      releaseLink: "发布页",
      communityLink: "社区剧情",
      webLink: "pjsk.moe",
      shaLabel: "SHA-256",
      pkgLabel: "@moesekai/*",
      skillLabel: "AI Skill",
      copy: "复制",
      copied: "已复制",
      platforms: {
        "win-setup": "Windows 安装程序",
        "win-portable": "Windows 便携版",
        "mac-arm64": "macOS (Apple Silicon)",
        "mac-x64": "macOS (Intel)",
        "linux-appimage": "Linux (AppImage)",
      },
    },
  },

  "zh-HK": {
    metaTitle: "MoeSekai Story Studio — 許願，即成劇 | story.pjsk.moe",
    languageAria: "切換語言",
    hero: {
      eyebrow: "MoeSekai Story Studio",
      title: "許願，即成劇。",
      capsuleMeta: "開源免費",
      communityCta: "社群劇情",
      capsuleCta: "下載",
    },
    highlights: {
      heading: "先看亮點。",
      galleryLink: "查看全部實機",
      pauseAria: "暫停輪播",
      playAria: "播放輪播",
      slides: [
        {
          id: "hl-agent",
          line1: "許個願。",
          line2: "AI 直接寫完一整幕。",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "hl-live2d",
          line1: "五位 Live2D 同台。",
          line2: "即時演繹每個表情。",
          kind: "video",
          src: "/showcase/clips/clip-01-live2d-stage-playback.webm",
          poster: "/showcase/02-player-theater-minori-stage.webp",
        },
        {
          id: "hl-flow",
          line1: "節點畫布與 .msk。",
          line2: "改一處，兩邊同步。",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "hl-voice",
          line1: "五語校對與自訂配音。",
          line2: "一鍵打包。",
          kind: "image",
          src: "/showcase/12-voice-manifest-bundler.webp",
        },
        {
          id: "hl-export",
          line1: "匯出前自動體檢。",
          line2: "零報錯分享。",
          kind: "image",
          src: "/showcase/13-export-preflight-dialog.webp",
        },
      ],
    },
    stage: {
      heading: "由一句願望，到完整舞台。",
      emphasis: [
        { text: "輸入一句想法，" },
        { text: "MoeSekai Story Agent 檢索官方角色語氣並寫出 .msk 劇本", strong: true },
        { text: "，自動完成" },
        { text: "全分支靜態校驗", strong: true },
        { text: "與" },
        { text: "快照存檔", strong: true },
        { text: "，隨時一鍵回滾。" },
      ],
      tabs: [
        {
          id: "tab-agent",
          label: "許願寫劇本",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "tab-rollback",
          label: "快照回滾",
          kind: "image",
          src: "/showcase/07-ai-agent-snapshots-rollback.webp",
        },
        {
          id: "tab-live2d",
          label: "Live2D 舞台",
          kind: "video",
          src: "/showcase/clips/clip-02-branching-choice-transition.webm",
          poster: "/showcase/03-player-branching-choices-minori.webp",
        },
        {
          id: "tab-flow",
          label: "節點流畫布",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "tab-msk",
          label: ".msk 源碼",
          kind: "video",
          src: "/showcase/clips/clip-04-msk-code-live-sync.webm",
          poster: "/showcase/05-code-mode-msk-bidirectional.webp",
        },
      ],
    },
    appearance: {
      heading: "晝夜工作區，隨你切換。",
      lightLabel: "淺色",
      darkLabel: "深色",
      defaultLabel: "預設藍",
    },
    download: {
      heading: "下載 MoeSekai Story Studio",
      cnb: "CNB",
      github: "GitHub",
      downloadVerb: "下載",
      releaseLink: "發佈頁",
      communityLink: "社群劇情",
      webLink: "pjsk.moe",
      shaLabel: "SHA-256",
      pkgLabel: "@moesekai/*",
      skillLabel: "AI Skill",
      copy: "複製",
      copied: "已複製",
      platforms: {
        "win-setup": "Windows 安裝程式",
        "win-portable": "Windows 便攜版",
        "mac-arm64": "macOS (Apple Silicon)",
        "mac-x64": "macOS (Intel)",
        "linux-appimage": "Linux (AppImage)",
      },
    },
  },

  ja: {
    metaTitle: "MoeSekai Story Studio — 願えば、舞台になる | story.pjsk.moe",
    languageAria: "言語を切り替え",
    hero: {
      eyebrow: "MoeSekai Story Studio",
      title: "願えば、舞台になる。",
      capsuleMeta: "オープンソース・無料",
      communityCta: "コミュニティ作品",
      capsuleCta: "ダウンロード",
    },
    highlights: {
      heading: "ハイライト。",
      galleryLink: "すべての実機画面",
      pauseAria: "一時停止",
      playAria: "再生",
      slides: [
        {
          id: "hl-agent",
          line1: "願いをひとつ。",
          line2: "AI が一幕をそのまま執筆。",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "hl-live2d",
          line1: "5 人の Live2D が同台。",
          line2: "表情までリアルタイム演出。",
          kind: "video",
          src: "/showcase/clips/clip-01-live2d-stage-playback.webm",
          poster: "/showcase/02-player-theater-minori-stage.webp",
        },
        {
          id: "hl-flow",
          line1: "ノード画布と .msk。",
          line2: "変えれば、双方に同期。",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "hl-voice",
          line1: "5 言語校正とカスタム音声。",
          line2: "ワンクリックで梱包。",
          kind: "image",
          src: "/showcase/12-voice-manifest-bundler.webp",
        },
        {
          id: "hl-export",
          line1: "書き出し前に自動検証。",
          line2: "エラーゼロで共有。",
          kind: "image",
          src: "/showcase/13-export-preflight-dialog.webp",
        },
      ],
    },
    stage: {
      heading: "ひとつの願いから、舞台まで。",
      emphasis: [
        { text: "アイデアを入力すると、" },
        { text: "MoeSekai Story Agent が公式口調を参照して .msk 台本を生成", strong: true },
        { text: "。" },
        { text: "全分岐の静的検証", strong: true },
        { text: "と" },
        { text: "自動スナップショット", strong: true },
        { text: "で、いつでも復元できます。" },
      ],
      tabs: [
        {
          id: "tab-agent",
          label: "AI 台本生成",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "tab-rollback",
          label: "スナップショット",
          kind: "image",
          src: "/showcase/07-ai-agent-snapshots-rollback.webp",
        },
        {
          id: "tab-live2d",
          label: "Live2D 舞台",
          kind: "video",
          src: "/showcase/clips/clip-02-branching-choice-transition.webm",
          poster: "/showcase/03-player-branching-choices-minori.webp",
        },
        {
          id: "tab-flow",
          label: "ノード画布",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "tab-msk",
          label: ".msk ソース",
          kind: "video",
          src: "/showcase/clips/clip-04-msk-code-live-sync.webm",
          poster: "/showcase/05-code-mode-msk-bidirectional.webp",
        },
      ],
    },
    appearance: {
      heading: "昼も夜も、好みの配色で。",
      lightLabel: "ライト",
      darkLabel: "ダーク",
      defaultLabel: "デフォルト",
    },
    download: {
      heading: "MoeSekai Story Studio をダウンロード",
      cnb: "CNB",
      github: "GitHub",
      downloadVerb: "取得",
      releaseLink: "リリース",
      communityLink: "コミュニティ作品",
      webLink: "pjsk.moe",
      shaLabel: "SHA-256",
      pkgLabel: "@moesekai/*",
      skillLabel: "AI Skill",
      copy: "コピー",
      copied: "済",
      platforms: {
        "win-setup": "Windows インストーラー",
        "win-portable": "Windows ポータブル",
        "mac-arm64": "macOS (Apple Silicon)",
        "mac-x64": "macOS (Intel)",
        "linux-appimage": "Linux (AppImage)",
      },
    },
  },

  en: {
    metaTitle: "MoeSekai Story Studio — Wish it. Stage it. | story.pjsk.moe",
    languageAria: "Switch language",
    hero: {
      eyebrow: "MoeSekai Story Studio",
      title: "Wish it. Stage it.",
      capsuleMeta: "Open Source & Free",
      communityCta: "Community Stories",
      capsuleCta: "Download",
    },
    highlights: {
      heading: "Get the highlights.",
      galleryLink: "See all screens",
      pauseAria: "Pause slideshow",
      playAria: "Play slideshow",
      slides: [
        {
          id: "hl-agent",
          line1: "Make a wish.",
          line2: "AI writes the whole scene.",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "hl-live2d",
          line1: "Five Live2D actors.",
          line2: "Every expression, live.",
          kind: "video",
          src: "/showcase/clips/clip-01-live2d-stage-playback.webm",
          poster: "/showcase/02-player-theater-minori-stage.webp",
        },
        {
          id: "hl-flow",
          line1: "Node flow and .msk.",
          line2: "Edit one, sync both.",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "hl-voice",
          line1: "5-locale i18n & voice.",
          line2: "Bundled in one click.",
          kind: "image",
          src: "/showcase/12-voice-manifest-bundler.webp",
        },
        {
          id: "hl-export",
          line1: "Preflight before export.",
          line2: "Zero errors to share.",
          kind: "image",
          src: "/showcase/13-export-preflight-dialog.webp",
        },
      ],
    },
    stage: {
      heading: "From a wish to a full stage.",
      emphasis: [
        { text: "Describe an idea and " },
        { text: "MoeSekai Story Agent drafts verified .msk scripts", strong: true },
        { text: " with official character voices, " },
        { text: "full branch checks", strong: true },
        { text: ", and " },
        { text: "one-click snapshot rollback", strong: true },
        { text: "." },
      ],
      tabs: [
        {
          id: "tab-agent",
          label: "Wish to Script",
          kind: "image",
          src: "/showcase/06-ai-agent-authoring.webp",
        },
        {
          id: "tab-rollback",
          label: "Snapshots",
          kind: "image",
          src: "/showcase/07-ai-agent-snapshots-rollback.webp",
        },
        {
          id: "tab-live2d",
          label: "Live2D Stage",
          kind: "video",
          src: "/showcase/clips/clip-02-branching-choice-transition.webm",
          poster: "/showcase/03-player-branching-choices-minori.webp",
        },
        {
          id: "tab-flow",
          label: "Node Flow",
          kind: "video",
          src: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
          poster: "/showcase/04-flow-graph-branching.webp",
        },
        {
          id: "tab-msk",
          label: ".msk Source",
          kind: "video",
          src: "/showcase/clips/clip-04-msk-code-live-sync.webm",
          poster: "/showcase/05-code-mode-msk-bidirectional.webp",
        },
      ],
    },
    appearance: {
      heading: "Light or dark. Your color.",
      lightLabel: "Light",
      darkLabel: "Dark",
      defaultLabel: "Default",
    },
    download: {
      heading: "Download MoeSekai Story Studio",
      cnb: "CNB",
      github: "GitHub",
      downloadVerb: "Download",
      releaseLink: "Releases",
      communityLink: "Community Stories",
      webLink: "pjsk.moe",
      shaLabel: "SHA-256",
      pkgLabel: "@moesekai/*",
      skillLabel: "AI Skill",
      copy: "Copy",
      copied: "Copied",
      platforms: {
        "win-setup": "Windows Installer",
        "win-portable": "Windows Portable",
        "mac-arm64": "macOS (Apple Silicon)",
        "mac-x64": "macOS (Intel)",
        "linux-appimage": "Linux (AppImage)",
      },
    },
  },
};
