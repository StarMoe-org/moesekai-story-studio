/**
 * All 26 Project SEKAI character theme seeds matching `Snowy_Viewer/web/src/lib/theme-seeds.json`.
 */
export interface CharacterThemeSeed {
    id: string;
    hex: string;
    name: string;
    unit: "Leo/need" | "MORE MORE JUMP!" | "Vivid BAD SQUAD" | "Wonderlands×Showtime" | "25-ji, Nightcord de." | "VIRTUAL SINGER";
}

export const DEFAULT_THEME_SEED = "21";

export const CHARACTER_THEME_SEEDS: readonly CharacterThemeSeed[] = [
    { id: "21", hex: "#33ccbb", name: "Hatsune Miku", unit: "VIRTUAL SINGER" },
    { id: "22", hex: "#ffcc11", name: "Kagamine Rin", unit: "VIRTUAL SINGER" },
    { id: "23", hex: "#FFEE11", name: "Kagamine Len", unit: "VIRTUAL SINGER" },
    { id: "24", hex: "#FFBBCC", name: "Megurine Luka", unit: "VIRTUAL SINGER" },
    { id: "25", hex: "#DD4444", name: "MEIKO", unit: "VIRTUAL SINGER" },
    { id: "26", hex: "#3366CC", name: "KAITO", unit: "VIRTUAL SINGER" },
    { id: "1", hex: "#33aaee", name: "Hoshino Ichika", unit: "Leo/need" },
    { id: "2", hex: "#ffdd44", name: "Tenma Saki", unit: "Leo/need" },
    { id: "3", hex: "#ee6666", name: "Mochizuki Honami", unit: "Leo/need" },
    { id: "4", hex: "#BBDD22", name: "Hinomori Shiho", unit: "Leo/need" },
    { id: "5", hex: "#FFCCAA", name: "Hanasato Minori", unit: "MORE MORE JUMP!" },
    { id: "6", hex: "#99CCFF", name: "Kiritani Haruka", unit: "MORE MORE JUMP!" },
    { id: "7", hex: "#ffaacc", name: "Momoi Airi", unit: "MORE MORE JUMP!" },
    { id: "8", hex: "#99EEDD", name: "Hinomori Shizuku", unit: "MORE MORE JUMP!" },
    { id: "9", hex: "#ff6699", name: "Azusawa Kohane", unit: "Vivid BAD SQUAD" },
    { id: "10", hex: "#00BBDD", name: "Shiraishi An", unit: "Vivid BAD SQUAD" },
    { id: "11", hex: "#ff7722", name: "Shinonome Akito", unit: "Vivid BAD SQUAD" },
    { id: "12", hex: "#0077DD", name: "Aoyagi Toya", unit: "Vivid BAD SQUAD" },
    { id: "13", hex: "#FFBB00", name: "Tenma Tsukasa", unit: "Wonderlands×Showtime" },
    { id: "14", hex: "#FF66BB", name: "Otori Emu", unit: "Wonderlands×Showtime" },
    { id: "15", hex: "#33DD99", name: "Kusanagi Nene", unit: "Wonderlands×Showtime" },
    { id: "16", hex: "#BB88EE", name: "Kamishiro Rui", unit: "Wonderlands×Showtime" },
    { id: "17", hex: "#bb6688", name: "Yoisaki Kanade", unit: "25-ji, Nightcord de." },
    { id: "18", hex: "#8888CC", name: "Asahina Mafuyu", unit: "25-ji, Nightcord de." },
    { id: "19", hex: "#CCAA88", name: "Shinonome Ena", unit: "25-ji, Nightcord de." },
    { id: "20", hex: "#DDAACC", name: "Akiyama Mizuki", unit: "25-ji, Nightcord de." },
] as const;

export const DESKTOP_LOCALE_OPTIONS: ReadonlyArray<{ code: "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR"; label: string }> = [
    { code: "zh-CN", label: "简体中文" },
    { code: "zh-TW", label: "繁中 (TW)" },
    { code: "en-US", label: "English" },
    { code: "ja-JP", label: "日本語" },
    { code: "ko-KR", label: "한국어" },
];
