import type { SiteLocale } from "./cinema-i18n";

export interface CharacterSeed {
  id: string;
  hex: string;
  nameZh: string;
  nameHk: string;
  nameEn: string;
  nameJa: string;
  unit: string;
}

export const CHARACTER_SEEDS: readonly CharacterSeed[] = [
  { id: "21", hex: "#33ccbb", nameZh: "初音未来", nameHk: "初音未來", nameEn: "Hatsune Miku", nameJa: "初音ミク", unit: "VIRTUAL SINGER" },
  { id: "22", hex: "#ffcc11", nameZh: "镜音铃", nameHk: "鏡音鈴", nameEn: "Kagamine Rin", nameJa: "鏡音リン", unit: "VIRTUAL SINGER" },
  { id: "23", hex: "#FFEE11", nameZh: "镜音连", nameHk: "鏡音連", nameEn: "Kagamine Len", nameJa: "鏡音レン", unit: "VIRTUAL SINGER" },
  { id: "24", hex: "#FFBBCC", nameZh: "巡音流歌", nameHk: "巡音流歌", nameEn: "Megurine Luka", nameJa: "巡音ルカ", unit: "VIRTUAL SINGER" },
  { id: "25", hex: "#DD4444", nameZh: "MEIKO", nameHk: "MEIKO", nameEn: "MEIKO", nameJa: "MEIKO", unit: "VIRTUAL SINGER" },
  { id: "26", hex: "#3366CC", nameZh: "KAITO", nameHk: "KAITO", nameEn: "KAITO", nameJa: "KAITO", unit: "VIRTUAL SINGER" },
  { id: "1", hex: "#33aaee", nameZh: "星乃一歌", nameHk: "星乃一歌", nameEn: "Hoshino Ichika", nameJa: "星乃一歌", unit: "Leo/need" },
  { id: "2", hex: "#ffdd44", nameZh: "天马咲希", nameHk: "天馬咲希", nameEn: "Tenma Saki", nameJa: "天馬咲希", unit: "Leo/need" },
  { id: "3", hex: "#ee6666", nameZh: "望月穗波", nameHk: "望月穗波", nameEn: "Mochizuki Honami", nameJa: "望月穂波", unit: "Leo/need" },
  { id: "4", hex: "#BBDD22", nameZh: "日野森志步", nameHk: "日野森志步", nameEn: "Hinomori Shiho", nameJa: "日野森志歩", unit: "Leo/need" },
  { id: "5", hex: "#FFCCAA", nameZh: "花里实乃理", nameHk: "花里實乃理", nameEn: "Hanasato Minori", nameJa: "花里みのり", unit: "MORE MORE JUMP!" },
  { id: "6", hex: "#99CCFF", nameZh: "桐谷遥", nameHk: "桐谷遙", nameEn: "Kiritani Haruka", nameJa: "桐谷遥", unit: "MORE MORE JUMP!" },
  { id: "7", hex: "#ffaacc", nameZh: "桃井爱莉", nameHk: "桃井愛莉", nameEn: "Momoi Airi", nameJa: "桃井愛莉", unit: "MORE MORE JUMP!" },
  { id: "8", hex: "#99EEDD", nameZh: "日野森雫", nameHk: "日野森雫", nameEn: "Hinomori Shizuku", nameJa: "日野森雫", unit: "MORE MORE JUMP!" },
  { id: "9", hex: "#ff6699", nameZh: "小豆泽心羽", nameHk: "小豆澤心羽", nameEn: "Azusawa Kohane", nameJa: "小豆沢こはね", unit: "Vivid BAD SQUAD" },
  { id: "10", hex: "#00BBDD", nameZh: "白石杏", nameHk: "白石杏", nameEn: "Shiraishi An", nameJa: "白石杏", unit: "Vivid BAD SQUAD" },
  { id: "11", hex: "#ff7722", nameZh: "东云彰人", nameHk: "東雲彰人", nameEn: "Shinonome Akito", nameJa: "東雲彰人", unit: "Vivid BAD SQUAD" },
  { id: "12", hex: "#0077DD", nameZh: "青柳冬弥", nameHk: "青柳冬彌", nameEn: "Aoyagi Toya", nameJa: "青柳冬弥", unit: "Vivid BAD SQUAD" },
  { id: "13", hex: "#FFBB00", nameZh: "天马司", nameHk: "天馬司", nameEn: "Tenma Tsukasa", nameJa: "天馬司", unit: "Wonderlands×Showtime" },
  { id: "14", hex: "#FF66BB", nameZh: "凤笑梦", nameHk: "鳳笑夢", nameEn: "Otori Emu", nameJa: "鳳えむ", unit: "Wonderlands×Showtime" },
  { id: "15", hex: "#33DD99", nameZh: "草薙宁宁", nameHk: "草薙寧寧", nameEn: "Kusanagi Nene", nameJa: "草薙寧々", unit: "Wonderlands×Showtime" },
  { id: "16", hex: "#BB88EE", nameZh: "神代类", nameHk: "神代類", nameEn: "Kamishiro Rui", nameJa: "神代類", unit: "Wonderlands×Showtime" },
  { id: "17", hex: "#bb6688", nameZh: "宵崎奏", nameHk: "宵崎奏", nameEn: "Yoisaki Kanade", nameJa: "宵崎奏", unit: "25-ji, Nightcord de." },
  { id: "18", hex: "#8888CC", nameZh: "朝比奈真冬", nameHk: "朝比奈真冬", nameEn: "Asahina Mafuyu", nameJa: "朝比奈まふゆ", unit: "25-ji, Nightcord de." },
  { id: "19", hex: "#CCAA88", nameZh: "东云绘名", nameHk: "東雲繪名", nameEn: "Shinonome Ena", nameJa: "東雲絵名", unit: "25-ji, Nightcord de." },
  { id: "20", hex: "#DDAACC", nameZh: "晓山瑞希", nameHk: "曉山瑞希", nameEn: "Akiyama Mizuki", nameJa: "暁山瑞希", unit: "25-ji, Nightcord de." },
] as const;

export function getSeedDisplayName(seed: CharacterSeed, locale: SiteLocale): string {
  if (locale === "zh-CN") return seed.nameZh;
  if (locale === "zh-HK") return seed.nameHk;
  if (locale === "ja") return seed.nameJa;
  return seed.nameEn;
}

function hexToHsl(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Defaults to authentic Apple Blue `#0071E3` / `#0066CC`.
 * When the visitor selects one of the 26 PJSK character dots, derives a restrained,
 * WCAG-AA high-contrast tint while keeping `#FFFFFF` and `#F5F5F7` untouched.
 */
export function deriveAppleAccent(seed: CharacterSeed | null): {
  button: string;
  link: string;
  raw: string;
} {
  if (!seed) {
    return {
      button: "#0071E3",
      link: "#0066CC",
      raw: "#0071E3",
    };
  }
  const [h, s] = hexToHsl(seed.hex);
  const isBrightHue = h >= 35 && h <= 95;
  const l = isBrightHue ? 32 : 40;
  const sat = Math.max(48, Math.min(78, s));
  return {
    button: `hsl(${h} ${sat}% ${l}%)`,
    link: `hsl(${h} ${sat}% ${Math.max(26, l - 4)}%)`,
    raw: seed.hex,
  };
}
