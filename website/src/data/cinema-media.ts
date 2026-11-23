import type { SiteLocale } from "./cinema-i18n";

export interface ContactFrame {
  id: string;
  frameNo: string;
  src: string;
  tag: string;
  title: Record<SiteLocale, string>;
  caption: Record<SiteLocale, string>;
}

/**
 * All 4 embedded studio captures encoded as lightweight VP9 WebM (`video/webm`).
 */
export const CINEMA_CLIPS = {
  stageLive: {
    webm: "/showcase/clips/clip-01-live2d-stage-playback.webm",
    poster: "/showcase/02-player-theater-minori-stage.webp",
  },
  branchingChoice: {
    webm: "/showcase/clips/clip-02-branching-choice-transition.webm",
    poster: "/showcase/03-player-branching-choices-minori.webp",
  },
  nodeFlow: {
    webm: "/showcase/clips/clip-03-node-flow-and-inspector.webm",
    poster: "/showcase/04-flow-graph-branching.webp",
  },
  mskSync: {
    webm: "/showcase/clips/clip-04-msk-code-live-sync.webm",
    poster: "/showcase/05-code-mode-msk-bidirectional.webp",
  },
} as const;

export const AI_DIRECTOR_SHOTS = {
  authoring: "/showcase/06-ai-agent-authoring.webp",
  snapshots: "/showcase/07-ai-agent-snapshots-rollback.webp",
} as const;

export const DAY_NIGHT_SHOTS = {
  light: "/showcase/01-hero-studio-mmj-light.webp",
  dark: "/showcase/16-studio-dark-theme-nightcord.webp",
} as const;

export const REAL_MSK_EXCERPT = [
  '@story "闪耀吧！屋顶与舞台的安可曲" region=jp id="mmj_stage_encore"',
  '@var cheers: number = 10 "应援热度"',
  '@cast minori "花里实乃理" model="v2_05minori_unit" char=5',
  '@cast haruka "桐谷遥"   model="v2_06haruka_unit" char=6',
  "",
  'scene scene_01_rooftop "宫益坂屋顶的安可企划" {',
  '  bg set "bg_a000801"  |  bgm play "bgm00020" vol=0.72',
  '  place set "宫益坂女子学园 · 屋顶"  |  transition fadeWhite 0.5',
  '  cast set [ minori at center z=4, haruka at left z=2 ]',
  '  talk minori "大家准备好了吗——！？用今天最响亮的笑容把希望送出去！"',
  '       motion="w-cute01-glad" facial="face_sparkling_01" react(haruka facial="face_smile_01")',
  "} -> choice_01_encore",
  "",
  'choice choice_01_encore "决定安可曲的舞台演出方案！" {',
  '  opt_sekai: "前往「舞台的世界」与未来彩排安可" [cheers += 5] -> scene_02a',
  '  opt_dance: "留在屋顶加练四叶草星光队形"     [cheers += 2] -> scene_02b',
  "}",
] as const;

export const CONTACT_STRIP_FRAMES: ContactFrame[] = [
  {
    id: "frame-01-hero",
    frameNo: "01",
    src: "/showcase/01-hero-studio-mmj-light.webp",
    tag: "WORKSPACE",
    title: {
      "zh-CN": "主工作台 · 浅色模式",
      "zh-HK": "主工作台 · 淺色模式",
      en: "Main Workspace · Light",
      ja: "メインワークスペース",
    },
    caption: {
      "zh-CN": "Live2D 实时舞台、分支节点图与属性检查器三区同步工作。",
      "zh-HK": "Live2D 即時舞台、分支節點圖與屬性檢查器三區同步工作。",
      en: "Live2D stage, branching node canvas, and inspector working in sync.",
      ja: "Live2D 舞台・分岐ノード・インスペクターが一体で動作。",
    },
  },
  {
    id: "frame-02-theater",
    frameNo: "02",
    src: "/showcase/02-player-theater-minori-stage.webp",
    tag: "PLAYER",
    title: {
      "zh-CN": "全屏试播 · 五人同台",
      "zh-HK": "全螢幕試播 · 五人同台",
      en: "Full-Screen Stage Playback",
      ja: "全画面試遊 · 5人同台",
    },
    caption: {
      "zh-CN": "花里实乃理与 MORE MORE JUMP! 五位角色 Live2D 同屏演出。",
      "zh-HK": "花里實乃理與 MORE MORE JUMP! 五位角色 Live2D 同屏演出。",
      en: "5-actor Stage SEKAI playback rendered with Adaptive SSAA.",
      ja: "高精細 SSAA による 5 人同台のリアルタイム再生。",
    },
  },
  {
    id: "frame-03-choice",
    frameNo: "03",
    src: "/showcase/03-player-branching-choices-minori.webp",
    tag: "CHOICES",
    title: {
      "zh-CN": "互动分支选项试播",
      "zh-HK": "互動分支選項試播",
      en: "Interactive Choice Overlay",
      ja: "インタラクティブ分岐試遊",
    },
    caption: {
      "zh-CN": "点击不同选项实时修改变量数值并进入对应剧情分支。",
      "zh-HK": "點擊不同選項即時修改變數數值並進入對應劇情分支。",
      en: "Click choices during playback to update variables and branch routes.",
      ja: "選択と同時に変数が更新され、対応ルートへ分岐します。",
    },
  },
  {
    id: "frame-04-inspector",
    frameNo: "04",
    src: "/showcase/08-cast-and-live2d-inspector.webp",
    tag: "LIVE2D",
    title: {
      "zh-CN": "演员表与动作表情检查器",
      "zh-HK": "演員表與動作表情檢查器",
      en: "Cast & Motion Inspector",
      ja: "キャスト・モーション設定",
    },
    caption: {
      "zh-CN": "为每句对白选择身体动作、面部表情与同台听者的 react 反应。",
      "zh-HK": "為每句對白選擇身體動作、面部表情與同台聽者的 react 反應。",
      en: "Configure body motions, facials, and listener react() cues per line.",
      ja: "セリフごとにモーション・表情と聞き手リアクションを指定。",
    },
  },
  {
    id: "frame-05-assets",
    frameNo: "05",
    src: "/showcase/09-asset-picker-costume-bg.webp",
    tag: "ASSETS",
    title: {
      "zh-CN": "26 主角 + 158 配角服装库",
      "zh-HK": "26 主角 + 158 配角服裝庫",
      en: "26 Main + 158 Supporting Models",
      ja: "26主要＋158サブ衣装庫",
    },
    caption: {
      "zh-CN": "直连 pjsk.moe 公开资源索引，搜索即可选用全部 v2 服装与背景。",
      "zh-HK": "直連 pjsk.moe 公開資源索引，搜尋即可選用全部 v2 服裝與背景。",
      en: "Direct pjsk.moe index to search and apply v2 costumes & backgrounds.",
      ja: "pjsk.moe インデックスから v2 衣装や背景を直接検索。",
    },
  },
  {
    id: "frame-06-i18n",
    frameNo: "06",
    src: "/showcase/10-i18n-multilang-proofread.webp",
    tag: "I18N",
    title: {
      "zh-CN": "多语言字幕双栏校对",
      "zh-HK": "多語言字幕雙欄校對",
      en: "Side-by-Side i18n Proofread",
      ja: "多言語字幕 2 カラム校正",
    },
    caption: {
      "zh-CN": "字幕翻译与演出解耦，支持 5 语种独立 .i18n.json 逐句校对。",
      "zh-HK": "字幕翻譯與演出解耦，支援 5 語種獨立 .i18n.json 逐句校對。",
      en: "5-locale .i18n.json subtitle packs decoupled from stage logic.",
      ja: "演出を変えずに 5 言語の翻訳パックを並べて校正。",
    },
  },
  {
    id: "frame-07-ja-play",
    frameNo: "07",
    src: "/showcase/11-player-ja-locale-playback.webp",
    tag: "JA-JP",
    title: {
      "zh-CN": "播放中即时切换日语界面与字幕",
      "zh-HK": "播放中即時切換日語介面與字幕",
      en: "Live Japanese UI & Subtitles",
      ja: "再生中の日本語 UI・字幕切替",
    },
    caption: {
      "zh-CN": "演出过程中一键切换语种，角色名、地点牌与对白同步刷新。",
      "zh-HK": "演出過程中一鍵切換語種，角色名、地點牌與對白同步刷新。",
      en: "Switch UI and story locale mid-playback without reloading.",
      ja: "再生中でもリロードなしで日本語表示へ即座に切替。",
    },
  },
  {
    id: "frame-08-voice",
    frameNo: "08",
    src: "/showcase/12-voice-manifest-bundler.webp",
    tag: "VOICE",
    title: {
      "zh-CN": "自定义配音清单 20/20 全匹配",
      "zh-HK": "自訂配音清單 20/20 全匹配",
      en: "Custom Voice Manifest (20/20)",
      ja: "カスタム音声トラック照合",
    },
    caption: {
      "zh-CN": "通过本地文件、HTTPS 或 JSON 挂载自定义配音，按 beatId 自动校验。",
      "zh-HK": "透過本機檔案、HTTPS 或 JSON 掛載自訂配音，按 beatId 自動校驗。",
      en: "Mount local or HTTPS voice packs matched cleanly per beatId.",
      ja: "自作ボイスや合成音声を beatId ごとに自動照合して紐付け。",
    },
  },
  {
    id: "frame-09-export",
    frameNo: "09",
    src: "/showcase/13-export-preflight-dialog.webp",
    tag: "EXPORT",
    title: {
      "zh-CN": "导出前预检与 .msk / .zip 打包",
      "zh-HK": "匯出前預檢與 .msk / .zip 打包",
      en: "Preflight Check & Bundle Export",
      ja: "事前検証付き書き出し",
    },
    caption: {
      "zh-CN": "导出前自动检查 0 错误 0 警告，输出 .msk 脚本或完整 .zip 包。",
      "zh-HK": "匯出前自動檢查 0 錯誤 0 警告，輸出 .msk 劇本或完整 .zip 包。",
      en: "Runs zero-error static preflight before exporting .msk or .zip packs.",
      ja: "0エラー・0警告を確認してから .msk または .zip を出力。",
    },
  },
  {
    id: "frame-10-settings",
    frameNo: "10",
    src: "/showcase/14-settings-themes-and-updater.webp",
    tag: "SETTINGS",
    title: {
      "zh-CN": "语言、主题色与渲染设置",
      "zh-HK": "語言、主題色與渲染設定",
      en: "Locale, Theme & Render Settings",
      ja: "言語・配色・描画設定",
    },
    caption: {
      "zh-CN": "支持 5 语言界面、26 角色主题色、SSAA 渲染档位与缓存管理。",
      "zh-HK": "支援 5 語言介面、26 角色主題色、SSAA 渲染檔位與快取管理。",
      en: "5 UI locales, 26 character seeds, SSAA quality, and cache limits.",
      ja: "5言語UI、26キャラ配色、SSAA画質、キャッシュ上限を管理。",
    },
  },
  {
    id: "frame-11-updater",
    frameNo: "11",
    src: "/showcase/15-update-dialog-cnb-github.webp",
    tag: "UPDATER",
    title: {
      "zh-CN": "内置 CNB / GitHub 双源更新检查",
      "zh-HK": "內置 CNB / GitHub 雙源更新檢查",
      en: "Built-In CNB & GitHub Updater",
      ja: "CNB / GitHub 内蔵アップデータ",
    },
    caption: {
      "zh-CN": "桌面端内置版本检测对话框，支持 CNB 镜像与 GitHub 自动回退。",
      "zh-HK": "桌面端內置版本偵測對話框，支援 CNB 鏡像與 GitHub 自動回退。",
      en: "Desktop update checker supporting both CNB mirror and GitHub.",
      ja: "CNB ミラーと GitHub の両方に対応する更新チェック機能。",
    },
  },
  {
    id: "frame-12-nightcord",
    frameNo: "12",
    src: "/showcase/16-studio-dark-theme-nightcord.webp",
    tag: "DARK MODE",
    title: {
      "zh-CN": "深色模式 · 夜间长篇工程",
      "zh-HK": "深色模式 · 夜間長篇工程",
      en: "Dark Mode · Long-Form Project",
      ja: "ダークモード · 長編プロジェクト",
    },
    caption: {
      "zh-CN": "夜间创作可切换低眩光深色模式，搭配宵崎奏主题色依旧清晰。",
      "zh-HK": "夜間創作可切換低眩光深色模式，搭配宵崎奏主題色依然清晰。",
      en: "Low-glare dark workspace with Yoisaki Kanade's theme accent.",
      ja: "夜間の執筆に優しいダークモードと宵崎奏カラー。",
    },
  },
];
