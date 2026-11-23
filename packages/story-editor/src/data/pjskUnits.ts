import type { StudioTranslateFn } from "../messages";

export interface UnitData {
    id: string;
    name: string;
    color: string;
    charIds: number[];
}

export const UNIT_NAME_MAP: Record<string, string> = {
    light_sound: "Leo/need",
    idol: "MORE MORE JUMP！",
    street: "Vivid BAD SQUAD",
    theme_park: "Wonderlands×Showtime",
    school_refusal: "25点，Nightcord见。",
    piapro: "虚拟歌手",
};

export const UNIT_ID_LABEL_KEYS: Record<string, string> = {
    ln: "common.units.ln",
    mmj: "common.units.mmj",
    vbs: "common.units.vbs",
    ws: "common.units.ws",
    "25ji": "common.units.25ji",
    vs: "common.units.vs",
};

export const UNIT_ICON_FILES: Record<string, string> = {
    ln: "ln.webp",
    mmj: "mmj.webp",
    vbs: "vbs.webp",
    ws: "wxs.webp",
    "25ji": "n25.webp",
    vs: "vs.webp",
};

export const UNIT_DATA: UnitData[] = [
    { id: "ln", name: UNIT_NAME_MAP.light_sound, color: "#4455DD", charIds: [1, 2, 3, 4] },
    { id: "mmj", name: UNIT_NAME_MAP.idol, color: "#88DD44", charIds: [5, 6, 7, 8] },
    { id: "vbs", name: UNIT_NAME_MAP.street, color: "#EE1166", charIds: [9, 10, 11, 12] },
    { id: "ws", name: UNIT_NAME_MAP.theme_park, color: "#FF9900", charIds: [13, 14, 15, 16] },
    { id: "25ji", name: UNIT_NAME_MAP.school_refusal, color: "#884499", charIds: [17, 18, 19, 20] },
    { id: "vs", name: UNIT_NAME_MAP.piapro, color: "#33CCBB", charIds: [21, 22, 23, 24, 25, 26] },
];

export const CHARACTER_NAMES: Record<number, string> = {
    1: "星乃一歌",
    2: "天马咲希",
    3: "望月穗波",
    4: "日野森志步",
    5: "花里实乃理",
    6: "桐谷遥",
    7: "桃井爱莉",
    8: "日野森雫",
    9: "小豆泽心羽",
    10: "白石杏",
    11: "东云彰人",
    12: "青柳冬弥",
    13: "天马司",
    14: "凤笑梦",
    15: "草薙宁宁",
    16: "神代类",
    17: "宵崎奏",
    18: "朝比奈真冬",
    19: "东云绘名",
    20: "晓山瑞希",
    21: "初音未来",
    22: "镜音铃",
    23: "镜音连",
    24: "巡音流歌",
    25: "MEIKO",
    26: "KAITO",
};

export const CHAR_NAMES: Record<number, string> = {
    1: "一歌", 2: "咲希", 3: "穗波", 4: "志步",
    5: "实乃理", 6: "遥", 7: "爱莉", 8: "雫",
    9: "心羽", 10: "杏", 11: "彰人", 12: "冬弥",
    13: "司", 14: "笑梦", 15: "宁宁", 16: "类",
    17: "奏", 18: "真冬", 19: "绘名", 20: "瑞希",
    21: "Miku", 22: "Rin", 23: "Len", 24: "Luka", 25: "MEIKO", 26: "KAITO",
};

export type CharacterNameVariant = "full" | "short";
export type CharacterNameTranslationFn = StudioTranslateFn;

const CHARACTER_NAME_FALLBACKS: Record<CharacterNameVariant, Record<number, string>> = {
    full: CHARACTER_NAMES,
    short: CHAR_NAMES,
};

export function getCharacterName(
    t: CharacterNameTranslationFn,
    characterId: number,
    variant: CharacterNameVariant = "full",
): string {
    const key = `common.characters.${variant}.${characterId}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return CHARACTER_NAME_FALLBACKS[variant][characterId]
        ?? CHARACTER_NAMES[characterId]
        ?? `Character ${characterId}`;
}

/** Display aliases must never be written back to server IDs or resource paths. */
export function getServerDisplayCode(server: string): string {
    return server === "tw" ? "HMT" : server.toUpperCase();
}
