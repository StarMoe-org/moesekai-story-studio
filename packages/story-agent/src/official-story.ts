/**
 * Programmatic Official Project SEKAI Story & Asset Miner for `@moesekai/story-agent`.
 *
 * Refactored from `skills/moesekai-story-script/scripts/official-story.mjs` into strongly-typed,
 * testable TypeScript with injectable `fetchImpl` and disk caching.
 *
 * Public Asset Attribution: Moesekai (pjsk.moe)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import {
    fetchLive2DModels,
    fetchMotionBundleClips,
    inferLive2DMotionBundleCandidates,
    live2dSources,
    type StoryRegion,
} from "@moesekai/story-core";
import { runWithStoryCoreLive2D } from "./live2d-core";

// ==================== Constants & Endpoints ====================

export const OFFICIAL_REGIONS = ["jp", "cn", "tw", "kr", "en"] as const;

const MASTER_DOMAINS: Record<"main" | "backup", string[]> = {
    main: ["https://metadata.pjsk.moe", "https://metadata.exmeaning.com"],
    backup: ["https://metadata.exmeaning.com", "https://metadata.pjsk.moe"],
};

const STORAGE_DOMAINS: Record<"main" | "backup", string[]> = {
    main: ["https://storage.pjsk.moe", "https://storage.exmeaning.com"],
    backup: ["https://storage.exmeaning.com", "https://storage.pjsk.moe"],
};

const STORY_SEARCH_BASE = "https://assets.pjsk.moe/sekai-extra-assets/sekai-story-search";
const TRANSLATION_BASE = "https://translation.exmeaning.com";

const DEFAULT_CACHE_DIR = join(tmpdir(), "moesekai-story-agent-cache");
const HTTP_TIMEOUT_MS = 20_000;
const CORPUS_TIMEOUT_MS = 60_000;

const TTL_MASTER_MS = 6 * 60 * 60 * 1000;
const TTL_MANIFEST_MS = 60 * 60 * 1000;
const TTL_SCENARIO_MS = 24 * 60 * 60 * 1000;

const SE_PACKS = ["se_pack00001_b", "se_pack00001"] as const;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|acb|flac)$/i;

export const UNIT_ALIASES: Record<string, string> = {
    ln: "light_sound",
    leoneed: "light_sound",
    "leo/need": "light_sound",
    light_sound: "light_sound",
    mmj: "idol",
    moremorejump: "idol",
    idol: "idol",
    vbs: "street",
    vividbadsquad: "street",
    street: "street",
    ws: "theme_park",
    wxs: "theme_park",
    wonderlands: "theme_park",
    theme_park: "theme_park",
    "25ji": "school_refusal",
    n25: "school_refusal",
    niigo: "school_refusal",
    nightcord: "school_refusal",
    school_refusal: "school_refusal",
    vs: "piapro",
    virtualsinger: "piapro",
    virtual_singer: "piapro",
    piapro: "piapro",
};

const UNIT_SHORT: Record<string, string> = {
    light_sound: "ln",
    idol: "mmj",
    street: "vbs",
    theme_park: "ws",
    school_refusal: "25ji",
    piapro: "vs",
};

export interface OfficialCharacterMeta {
    id: number;
    key: string;
    prefix: string;
    unit: string;
    gender: "f" | "m";
    en: string;
    jp: string;
    zh: string;
    aliases: string[];
}

export const CHARACTERS: OfficialCharacterMeta[] = [
    { id: 1, key: "ichika", prefix: "01ichika", unit: "light_sound", gender: "f", en: "Hoshino Ichika", jp: "星乃一歌", zh: "星乃一歌", aliases: ["一歌", "ichika", "hoshino"] },
    { id: 2, key: "saki", prefix: "02saki", unit: "light_sound", gender: "f", en: "Tenma Saki", jp: "天馬咲希", zh: "天马咲希", aliases: ["咲希", "saki"] },
    { id: 3, key: "honami", prefix: "03honami", unit: "light_sound", gender: "f", en: "Mochizuki Honami", jp: "望月穂波", zh: "望月穗波", aliases: ["穂波", "穗波", "honami", "mochizuki"] },
    { id: 4, key: "shiho", prefix: "04shiho", unit: "light_sound", gender: "f", en: "Hinomori Shiho", jp: "日野森志歩", zh: "日野森志步", aliases: ["志歩", "志步", "shiho"] },
    { id: 5, key: "minori", prefix: "05minori", unit: "idol", gender: "f", en: "Hanasato Minori", jp: "花里みのり", zh: "花里实乃理", aliases: ["みのり", "实乃理", "實乃理", "minori", "hanasato"] },
    { id: 6, key: "haruka", prefix: "06haruka", unit: "idol", gender: "f", en: "Kiritani Haruka", jp: "桐谷遥", zh: "桐谷遥", aliases: ["遥", "遙", "haruka", "kiritani"] },
    { id: 7, key: "airi", prefix: "07airi", unit: "idol", gender: "f", en: "Momoi Airi", jp: "桃井愛莉", zh: "桃井爱莉", aliases: ["愛莉", "爱莉", "airi", "momoi"] },
    { id: 8, key: "shizuku", prefix: "08shizuku", unit: "idol", gender: "f", en: "Hinomori Shizuku", jp: "日野森雫", zh: "日野森雫", aliases: ["雫", "shizuku"] },
    { id: 9, key: "kohane", prefix: "09kohane", unit: "street", gender: "f", en: "Azusawa Kohane", jp: "小豆沢こはね", zh: "小豆泽心羽", aliases: ["こはね", "心羽", "kohane", "azusawa"] },
    { id: 10, key: "an", prefix: "10an", unit: "street", gender: "f", en: "Shiraishi An", jp: "白石杏", zh: "白石杏", aliases: ["杏", "an", "shiraishi"] },
    { id: 11, key: "akito", prefix: "11akito", unit: "street", gender: "m", en: "Shinonome Akito", jp: "東雲彰人", zh: "东云彰人", aliases: ["彰人", "akito"] },
    { id: 12, key: "toya", prefix: "12touya", unit: "street", gender: "m", en: "Aoyagi Toya", jp: "青柳冬弥", zh: "青柳冬弥", aliases: ["冬弥", "冬彌", "toya", "touya", "aoyagi"] },
    { id: 13, key: "tsukasa", prefix: "13tsukasa", unit: "theme_park", gender: "m", en: "Tenma Tsukasa", jp: "天馬司", zh: "天马司", aliases: ["司", "tsukasa"] },
    { id: 14, key: "emu", prefix: "14emu", unit: "theme_park", gender: "f", en: "Otori Emu", jp: "鳳えむ", zh: "凤笑梦", aliases: ["えむ", "笑梦", "笑夢", "emu", "otori"] },
    { id: 15, key: "nene", prefix: "15nene", unit: "theme_park", gender: "f", en: "Kusanagi Nene", jp: "草薙寧々", zh: "草薙宁宁", aliases: ["寧々", "宁宁", "寧寧", "nene", "kusanagi"] },
    { id: 16, key: "rui", prefix: "16rui", unit: "theme_park", gender: "m", en: "Kamishiro Rui", jp: "神代類", zh: "神代类", aliases: ["類", "类", "rui", "kamishiro"] },
    { id: 17, key: "kanade", prefix: "17kanade", unit: "school_refusal", gender: "f", en: "Yoisaki Kanade", jp: "宵崎奏", zh: "宵崎奏", aliases: ["奏", "kanade", "yoisaki"] },
    { id: 18, key: "mafuyu", prefix: "18mafuyu", unit: "school_refusal", gender: "f", en: "Asahina Mafuyu", jp: "朝比奈まふゆ", zh: "朝比奈真冬", aliases: ["まふゆ", "真冬", "mafuyu", "asahina"] },
    { id: 19, key: "ena", prefix: "19ena", unit: "school_refusal", gender: "f", en: "Shinonome Ena", jp: "東雲絵名", zh: "东云绘名", aliases: ["絵名", "绘名", "繪名", "ena"] },
    { id: 20, key: "mizuki", prefix: "20mizuki", unit: "school_refusal", gender: "f", en: "Akiyama Mizuki", jp: "暁山瑞希", zh: "晓山瑞希", aliases: ["瑞希", "mizuki", "akiyama"] },
    { id: 21, key: "miku", prefix: "21miku", unit: "piapro", gender: "f", en: "Hatsune Miku", jp: "初音ミク", zh: "初音未来", aliases: ["ミク", "未来", "未來", "miku", "hatsune"] },
    { id: 22, key: "rin", prefix: "22rin", unit: "piapro", gender: "f", en: "Kagamine Rin", jp: "鏡音リン", zh: "镜音铃", aliases: ["リン", "铃", "鈴", "rin"] },
    { id: 23, key: "len", prefix: "23len", unit: "piapro", gender: "m", en: "Kagamine Len", jp: "鏡音レン", zh: "镜音连", aliases: ["レン", "连", "連", "len"] },
    { id: 24, key: "luka", prefix: "24luka", unit: "piapro", gender: "f", en: "Megurine Luka", jp: "巡音ルカ", zh: "巡音流歌", aliases: ["ルカ", "流歌", "luka", "megurine"] },
    { id: 25, key: "meiko", prefix: "25meiko", unit: "piapro", gender: "f", en: "MEIKO", jp: "MEIKO", zh: "MEIKO", aliases: ["meiko"] },
    { id: 26, key: "kaito", prefix: "26kaito", unit: "piapro", gender: "m", en: "KAITO", jp: "KAITO", zh: "KAITO", aliases: ["kaito"] },
];

const CHAR_BY_ID = new Map<number, OfficialCharacterMeta>(CHARACTERS.map((c) => [c.id, c]));
const CHAR_BY_KEY = new Map<string, OfficialCharacterMeta>([
    ...CHARACTERS.map((c): [string, OfficialCharacterMeta] => [c.key, c]),
    ["touya", CHAR_BY_ID.get(12)!],
]);

export const MODEL_KINDS = ["character", "sub", "collab", "mob"] as const;
export type OfficialModelKind = (typeof MODEL_KINDS)[number];
const KIND_ORDER: Record<string, number> = { character: 0, sub: 1, collab: 2, mob: 3 };
const MAIN_CHAR_MODEL_RE = /^(?:v2_)?(?:clb\d+_)?(0[1-9]|1[0-9]|2[0-6])[a-z]+/;
const MAIN_CHAR_CHILD_RE = /^(?:v2_)?sub_(?:child\d*_([a-z]+)|([a-z]+)child|([a-z]+)_princess)/;
const COLLAB_MODEL_RE = /^(?:v2_)?sub_(?:sanrio|enst|egg)_/;
const SUB_VARIANT_SEGMENTS = new Set([
    "black", "zoom", "side", "stage", "casual", "lesson",
    "rw", "patient", "sunset", "cloth", "jc", "school", "transform",
]);

export const SUB_CHARACTER_NAMES: Record<
    string,
    { kind: "sub" | "collab"; names: Partial<Record<StoryRegion, string>>; aliases?: string[] }
> = {
    anfather: { kind: "sub", names: { jp: "謙", cn: "谦", tw: "謙", en: "Ken", kr: "켄" }, aliases: ["白石谦", "白石謙", "杏的父亲", "杏の父", "Shiraishi Ken"] },
    arata: { kind: "sub", names: { cn: "新", en: "Arata", jp: "新", kr: "아라타", tw: "新" }, aliases: ["远野新", "Tono Arata"] },
    arisa: { kind: "sub", names: { cn: "亚里纱", en: "Arisa", jp: "アリサ", kr: "아리사", tw: "亞梨沙" } },
    kanadefather: { kind: "sub", names: { cn: "奏的父亲", en: "Kanade's Father", jp: "奏の父", kr: "카나데의 아빠", tw: "奏的父親" } },
    mafuyumother: { kind: "sub", names: { cn: "真冬的母亲", en: "Mafuyu's Mother", jp: "まふゆの母", kr: "마후유의 엄마", tw: "真冬的母親" } },
    mikudayo: { kind: "sub", names: { cn: "初音未来的玩偶装", en: "Mikudayo Mascot", jp: "ミクの着ぐるみ", kr: "미쿠 인형 탈", tw: "初音未來玩偶" } },
    nenedayo: { kind: "sub", names: { cn: "宁宁机器人", en: "Robo-Nene", jp: "ネネロボ", kr: "네네 로봇", tw: "寧寧機器人" }, aliases: ["Nenerobo"] },
    partner: { kind: "sub", names: { cn: "大河", en: "Taiga", jp: "大河", kr: "타이가", tw: "大河" } },
    nagi: { kind: "sub", names: { cn: "凪", en: "Nagi", jp: "凪", kr: "나기", tw: "凪" } },
    shinonomefather: { kind: "sub", names: { cn: "父亲", en: "Father", jp: "父親", kr: "아빠", tw: "父親" }, aliases: ["东云的父亲", "绘名的父亲", "彰人的父亲"] },
    touyafather: { kind: "sub", names: { cn: "冬弥的父亲", en: "Toya's Father", jp: "冬弥の父", kr: "토우야의 아버지", tw: "冬彌的爸爸" } },
    sanrio_cinnamoroll: { kind: "collab", names: { cn: "大耳狗", en: "Cinnamoroll", jp: "シナモン", kr: "시나몬", tw: "大耳狗喜拿" } },
    sanrio_kitty: { kind: "collab", names: { cn: "凯蒂猫", en: "Hello Kitty", jp: "キティ", kr: "키티", tw: "Hello Kitty" } },
    sanrio_kuromi: { kind: "collab", names: { cn: "酷洛米", en: "KUROMI", jp: "クロミ", kr: "쿠로미", tw: "酷洛米" } },
    sanrio_mymelody: { kind: "collab", names: { cn: "美乐蒂", en: "My Melody", jp: "メロディ", kr: "멜로디", tw: "美樂蒂" } },
};

const SPECIAL_EFFECT_NAMES: Record<number, string> = {
    0: "None", 1: "BlackIn", 2: "BlackOut", 3: "WhiteIn", 4: "WhiteOut",
    5: "ShakeScreen", 6: "ShakeWindow", 7: "ChangeBackground", 8: "Telop",
    9: "FlashbackIn", 10: "FlashbackOut", 11: "ChangeCardStill",
    17: "ChangeBackgroundStill", 18: "PlaceInfo", 24: "FullScreenText",
};

const SIDE_TO_MSK_SLOT: Record<number, string | null> = {
    0: null, 1: "farLeft", 2: "farLeft", 3: "left", 4: "center",
    5: "center", 6: "right", 7: "right", 8: "farRight",
};

// ==================== Public Types ====================

export interface OfficialStoryRuntimeOptions {
    region?: StoryRegion;
    line?: "main" | "backup";
    noCache?: boolean;
    cacheDir?: string;
    fetchImpl?: typeof fetch;
}

export interface OfficialEpisodeDiscoveryItem {
    selector: string;
    kind: string;
    title: string;
    scenarioId: string;
    unit?: string;
    bannerChar?: string;
    char?: string;
    chars?: string[];
    episodeCount?: number;
    outline?: string;
    eventId?: number;
    cardId?: number;
    actionSetId?: number;
}

export interface OfficialSearchTextResult {
    region: StoryRegion;
    query: string;
    totalMatchingChunks: number;
    returnedEpisodes: number;
    hits: Array<{
        selector: string;
        type: string;
        story: string;
        ep: string | number;
        scenarioId: string;
        lineRange: string;
        chars: string[];
        matchedLines: string[];
    }>;
}

export interface OfficialScenarioCastEntry {
    actorKey: string;
    shortKey: string;
    char2dId: number;
    charId: number | null;
    name: string;
    storyDisplayName: string | null;
    storyDisplayNames: string[];
    ownerKey: string | null;
    kind: OfficialModelKind;
    unit: string;
    modelId: string;
    motionBundle: string | null;
    isSubOrMob: boolean;
}

export interface OfficialScenarioStudyReport {
    meta: {
        selector: string;
        region: StoryRegion;
        storyKind: string;
        scenarioId: string;
        storyTitle: string;
        episodeTitle: string;
        scenarioUrl: string;
        talkCount: number;
        snippetCount: number;
    };
    cast: OfficialScenarioCastEntry[];
    backgrounds: Array<{
        id: string;
        count: number;
        firstTalkLine: number;
        places: string[];
        isCg: boolean;
        webp: string;
        png: string;
    }>;
    bgm: Array<{
        name: string;
        raw: string;
        title: string;
        category: string;
        count: number;
        firstTalkLine: number;
        sampleContext: string;
        url: string;
    }>;
    se: Array<{
        raw: string;
        path: string;
        pack: string;
        count: number;
        examples: Array<{ talkLine: number; before: string; after: string }>;
        url: string;
    }>;
    characterClips: Array<{
        actorKey: string;
        shortKey: string;
        charId: number | null;
        name: string;
        modelId: string;
        motionBundle: string | null;
        pairs: Array<{
            motion: string;
            facial: string;
            count: number;
            sources: string[];
            examples: string[];
        }>;
    }>;
    voices: Array<{ ref: string; speaker: string; text: string }>;
    effects: {
        transitions: Record<string, number>;
        shakes: number;
        flashes: number;
        telops: string[];
        places: string[];
        enterCount: number;
        moveCount: number;
        exitCount: number;
        coStarReactionCount: number;
    };
    timeline: Array<Record<string, unknown>>;
}

export interface OfficialStudyKit {
    region: StoryRegion;
    sources: Array<{ selector: string; storyTitle: string; episodeTitle: string; talkCount: number }>;
    recommendedCast: Array<OfficialScenarioCastEntry & { count: number; isV2: boolean }>;
    backgrounds: Array<{
        id: string;
        count: number;
        places: string[];
        episodes: string[];
        isCg: boolean;
        webp: string;
    }>;
    bgm: Array<{
        name: string;
        title: string;
        category: string;
        count: number;
        episodes: string[];
        url: string;
    }>;
    se: Array<{
        path: string;
        pack: string;
        count: number;
        episodes: string[];
        examples: Array<{ talkLine: number; before: string; after: string; selector: string }>;
    }>;
    characterClips: Array<{
        shortKey: string;
        charId: number | null;
        name: string;
        models: string[];
        pairs: Array<{ motion: string; facial: string; count: number; examples: string[] }>;
    }>;
    errors: Array<{ selector: string; error: string }>;
}

export interface CatalogModelItem {
    id: string;
    motion: string | null;
    kind: OfficialModelKind;
    characterId: number | null;
    subCharacterId: number | null;
    ownerKey: string | null;
    unit: string | null;
    name: string;
    names: Partial<Record<StoryRegion, string>>;
    aliases: string[];
    episodeCount: number;
    episodes: string[];
}

export type OfficialCatalogResult =
    | { kind: "models"; region: StoryRegion; source: string; total: number; items: CatalogModelItem[] }
    | {
        kind: "clips";
        region: StoryRegion;
        modelId: string;
        motionBundle: string;
        totalMotions: number;
        totalFacials: number;
        motions: string[];
        facials: string[];
    }
    | {
        kind: "bgm";
        region: StoryRegion;
        total: number;
        items: Array<{ name: string; title: string; category: string; mysekai: boolean }>;
    }
    | {
        kind: "bg";
        region: StoryRegion;
        total: number;
        items: Array<{ id: string; isCg: boolean; webp: string }>;
    }
    | {
        kind: "se";
        region: StoryRegion;
        total: number;
        items: Array<{ pack: string; label: string; path: string }>;
    }
    | {
        kind: "voices-scenarios" | "voices";
        region: StoryRegion;
        voiceKind: string;
        scenarioId?: string;
        total: number;
        items: string[];
    };

export type OfficialStoryMineRequest =
    | {
        action: "study";
        region?: StoryRegion;
        unit?: string;
        char?: string;
        kind?: "event" | "unit" | "card" | "area" | "special";
        query?: string;
        selectors?: string[];
        sample?: number;
        includeMixed?: boolean;
    }
    | {
        action: "search-text";
        query: string;
        region?: StoryRegion;
        kind?: "all" | "event" | "unit" | "card" | "talk" | "area" | "self" | "special";
        char?: string;
        regex?: boolean;
        limit?: number;
    }
    | {
        action: "inspect";
        selector: string;
        region?: StoryRegion;
        translate?: "zh-CN" | "en-US";
        includeTimeline?: boolean;
        lines?: string;
    }
    | {
        action: "catalog";
        subkind: "models" | "clips" | "bgm" | "bg" | "se" | "voices";
        arg?: string;
        region?: StoryRegion;
        kind?: string;
        char?: string;
        search?: string;
        filter?: string;
        category?: string;
        type?: "all" | "motion" | "facial";
        v2Only?: boolean;
        includeCg?: boolean;
        limit?: number;
    }
    | {
        action: "list";
        region?: StoryRegion;
        kind?: "event" | "unit" | "card" | "area" | "special";
        unit?: string;
        char?: string;
        query?: string;
        includeMixed?: boolean;
        oldest?: boolean;
        limit?: number;
    };

export type OfficialStoryMineResult =
    | { action: "study"; data: OfficialStudyKit }
    | { action: "search-text"; data: OfficialSearchTextResult }
    | { action: "inspect"; data: OfficialScenarioStudyReport }
    | { action: "catalog"; data: OfficialCatalogResult }
    | { action: "list"; data: OfficialEpisodeDiscoveryItem[] };

// ==================== Pure Helpers ====================

export function resolveUnitKey(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const norm = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "");
    return UNIT_ALIASES[norm] ?? UNIT_ALIASES[String(raw).trim().toLowerCase()] ?? null;
}

export function resolveCharacterIds(raw: string | undefined | null): number[] {
    if (!raw) return [];
    const tokens = String(raw).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const ids = new Set<number>();
    for (const tok of tokens) {
        if (/^\d+$/.test(tok)) {
            const n = Number.parseInt(tok, 10);
            if (CHAR_BY_ID.has(n)) {
                ids.add(n);
                continue;
            }
        }
        const lower = tok.toLowerCase();
        const exact = CHARACTERS.find(
            (c) =>
                c.key === lower
                || c.prefix === lower
                || c.en.toLowerCase() === lower
                || c.jp === tok
                || c.zh === tok
                || c.aliases.some((a) => a.toLowerCase() === lower),
        );
        if (exact) {
            ids.add(exact.id);
            continue;
        }
        const partial = CHARACTERS.find(
            (c) =>
                c.en.toLowerCase().includes(lower)
                || c.jp.includes(tok)
                || c.zh.includes(tok),
        );
        if (partial) {
            ids.add(partial.id);
        } else {
            throw new Error(
                `Unknown character '${tok}'. Use ID 1..26 or name (e.g. ichika, 17, mafuyu, 奏).`,
            );
        }
    }
    return [...ids].sort((a, b) => a - b);
}

function cleanSpeakerName(raw: unknown): string {
    return String(raw ?? "")
        .replace(/[\r\n\u3000]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripSubMasterdataAnnotation(raw: unknown): string {
    return cleanSpeakerName(
        String(raw ?? "").replace(
            /\s*[（(][^）)]*(?:エイプリルフール|コラボ|april|愚人节|愚人節|仮)[^）)]*[）)]\s*$/iu,
            "",
        ),
    );
}

function isPlaceholderSpeakerName(raw: unknown): boolean {
    const s = cleanSpeakerName(raw);
    if (!s) return true;
    if (/^[\s?？.。・…—\-_~!！]+$/u.test(s)) return true;
    return s === "声" || s === "Voice" || s === "声音" || s === "聲音" || s === "목소리";
}

export function parseMainCharacterIdFromModel(idOrAsset: string | null | undefined): number | null {
    const raw = String(idOrAsset ?? "").trim();
    if (!raw) return null;
    const direct = MAIN_CHAR_MODEL_RE.exec(raw);
    if (direct) {
        const cid = Number.parseInt(direct[1], 10);
        return CHAR_BY_ID.has(cid) ? cid : null;
    }
    const child = MAIN_CHAR_CHILD_RE.exec(raw);
    if (child) {
        const key = (child[1] || child[2] || child[3] || "").toLowerCase();
        return CHAR_BY_KEY.get(key)?.id ?? null;
    }
    return null;
}

function deriveOwnerKey(idOrAsset: string | null | undefined): string | null {
    let s = String(idOrAsset ?? "").trim();
    if (!s) return null;
    if (s.startsWith("v2_")) s = s.slice(3);
    if (s.startsWith("sub_")) s = s.slice(4);
    if (!s) return null;
    const parts = s.split("_").filter(Boolean);
    while (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (SUB_VARIANT_SEGMENTS.has(last) || /^live\d*$/.test(last)) {
            parts.pop();
        } else {
            break;
        }
    }
    if (parts.length > 0) {
        const last = parts[parts.length - 1];
        const m = /^(.+?)(?:black\d*|young)$/.exec(last);
        if (m && m[1].length >= 3) parts[parts.length - 1] = m[1];
    }
    return parts.join("_") || null;
}

function normalizeOwnerKeyWithKnown(rawKey: string | null, keySet: ReadonlySet<string>): string | null {
    if (!rawKey) return null;
    if (rawKey.endsWith("02")) {
        const stem = rawKey.slice(0, -2);
        if (stem && (keySet.has(stem) || Object.prototype.hasOwnProperty.call(SUB_CHARACTER_NAMES, stem))) {
            return stem;
        }
    }
    return rawKey;
}

export function inferMotionBundleCandidates(modelId: string): string[] {
    return inferLive2DMotionBundleCandidates(modelId);
}

export function isStoryCgBackground(bgId: string | null | undefined): boolean {
    if (!bgId) return false;
    if (bgId.startsWith("bg_a")) {
        const num = Number.parseInt(bgId.slice(4), 10);
        return Number.isFinite(num) && num >= 1 && num <= 99;
    }
    return bgId.startsWith("bg_s");
}

function truncate(text: unknown, maxLen = 72): string {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

function pickLocalizedName(
    names: Partial<Record<StoryRegion, string>> | undefined,
    region: StoryRegion,
): string | null {
    if (!names) return null;
    if (names[region]) return names[region]!;
    if (region === "tw" && names.cn) return names.cn;
    if (region === "cn" && names.tw) return names.tw;
    return names.jp || names.cn || names.en || names.tw || names.kr || null;
}

export type ParsedSelector =
    | { kind: "url"; url: string; canonical: string }
    | { kind: "path"; path: string; canonical: string }
    | { kind: "event"; eventId: number; episodeNo: number; canonical: string }
    | { kind: "unit"; chapterOrUnit: string; episodeNo: number; canonical: string }
    | { kind: "card"; cardId: number; part: "former" | "latter"; canonical: string }
    | { kind: "special"; specialId: number; episodeNo: number; canonical: string }
    | { kind: "area"; areaId: number | null; actionSetId: number; canonical: string }
    | { kind: "self"; scenarioId: string; canonical: string };

export function parseSelector(raw: string): ParsedSelector | null {
    const value = String(raw ?? "").trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return { kind: "url", url: value, canonical: value };
    if (value.endsWith(".json") && value.includes("/")) {
        return { kind: "path", path: value.replace(/^\/+/, ""), canonical: value };
    }
    const talkShort = /^talk:(\d+)$/.exec(value);
    if (talkShort) {
        const actionSetId = Number.parseInt(talkShort[1], 10);
        return { kind: "area", areaId: null, actionSetId, canonical: `talk:${actionSetId}` };
    }
    const selfMatch = /^self:([A-Za-z0-9_.-]+)$/.exec(value);
    if (selfMatch) {
        return { kind: "self", scenarioId: selfMatch[1], canonical: `self:${selfMatch[1]}` };
    }
    const full = /^(event|unit|card|special|area):([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
    if (!full) return null;
    const [, kind, group, ep] = full;
    if (kind === "event" && /^\d+$/.test(group) && /^\d+$/.test(ep)) {
        const eventId = Number.parseInt(group, 10);
        const episodeNo = Number.parseInt(ep, 10);
        return { kind: "event", eventId, episodeNo, canonical: `event:${eventId}/${episodeNo}` };
    }
    if (kind === "unit" && /^\d+$/.test(ep)) {
        const episodeNo = Number.parseInt(ep, 10);
        return { kind: "unit", chapterOrUnit: group, episodeNo, canonical: `unit:${group}/${episodeNo}` };
    }
    if (kind === "card" && /^\d+$/.test(group)) {
        const partMap: Record<string, "former" | "latter"> = {
            former: "former", first: "former", "1": "former",
            latter: "latter", second: "latter", "2": "latter",
        };
        const part = partMap[ep.toLowerCase()];
        if (!part) return null;
        const cardId = Number.parseInt(group, 10);
        return { kind: "card", cardId, part, canonical: `card:${cardId}/${part}` };
    }
    if (kind === "special" && /^\d+$/.test(group) && /^\d+$/.test(ep)) {
        const specialId = Number.parseInt(group, 10);
        const episodeNo = Number.parseInt(ep, 10);
        return { kind: "special", specialId, episodeNo, canonical: `special:${specialId}/${episodeNo}` };
    }
    if (kind === "area" && /^\d+$/.test(group) && /^\d+$/.test(ep)) {
        const areaId = Number.parseInt(group, 10);
        const actionSetId = Number.parseInt(ep, 10);
        return { kind: "area", areaId, actionSetId, canonical: `area:${areaId}/${actionSetId}` };
    }
    return null;
}

// ==================== Catalog Normalizer ====================

export function normalizeCatalogModels(
    rawInput: any,
    ctx: { region?: StoryRegion; chara2ds?: any[]; subGameChars?: any[] } = {},
): CatalogModelItem[] {
    const region: StoryRegion = ctx.region ?? "jp";
    const chara2ds: any[] = rawInput?.chara2ds ?? ctx.chara2ds ?? [];
    const subGameChars: any[] = rawInput?.subGameChars ?? ctx.subGameChars ?? [];
    const byAsset = new Map<string, any>();
    const byOwner = new Map<string, any>();
    const byId = new Map<number, any>();
    for (const c of chara2ds) {
        if (typeof c?.id === "number") byId.set(c.id, c);
        const asset = String(c?.assetName ?? "").trim();
        if (asset) {
            if (!byAsset.has(asset)) byAsset.set(asset, c);
            const ok = deriveOwnerKey(asset);
            if (ok && !byOwner.has(ok)) byOwner.set(ok, c);
        }
    }
    const subCharById = new Map<number, string>();
    for (const s of subGameChars) {
        if (typeof s?.id === "number" && typeof s?.name === "string") {
            const clean = stripSubMasterdataAnnotation(s.name);
            if (clean) subCharById.set(s.id, clean);
        }
    }

    const rawModels: any[] = Array.isArray(rawInput?.models)
        ? rawInput.models
        : Array.isArray(rawInput?.directories)
            ? rawInput.directories.map((id: string) => ({ id }))
            : Array.isArray(rawInput)
                ? rawInput
                : [];

    const ownerKeySet = new Set<string>();
    const staged: Array<{
        id: string;
        entry: any;
        matchedC2d: any;
        characterId: number | null;
        subCharacterId: number | null;
        kind: OfficialModelKind;
        rawOwnerKey: string | null;
    }> = [];

    for (const raw of rawModels) {
        const id = String(typeof raw === "string" ? raw : (raw?.id ?? "")).trim();
        if (!id) continue;
        const entry = typeof raw === "string" ? { id } : raw;
        let matchedC2d: any = null;
        if (Array.isArray(entry.character2dIds)) {
            for (const cid of entry.character2dIds) {
                if (byId.has(cid)) {
                    matchedC2d = byId.get(cid);
                    break;
                }
            }
        }
        if (!matchedC2d) {
            matchedC2d = (entry.assetName && byAsset.get(entry.assetName))
                || byAsset.get(id)
                || (deriveOwnerKey(entry.assetName || id) ? byOwner.get(deriveOwnerKey(entry.assetName || id)!) : null);
        }

        const assetName = String(entry.assetName || matchedC2d?.assetName || "").trim() || null;
        const iconBundle = String(entry.iconBundle || matchedC2d?.characterIconAssetbundleName || "").trim() || null;
        let characterId: number | null = Number.isInteger(entry.characterId) ? entry.characterId : null;
        if (characterId === null && matchedC2d?.characterType === "game_character" && Number.isInteger(matchedC2d.characterId)) {
            characterId = matchedC2d.characterId;
        }
        if (characterId === null) {
            characterId = parseMainCharacterIdFromModel(id) ?? parseMainCharacterIdFromModel(assetName);
        }
        const subCharacterId: number | null = Number.isInteger(entry.subCharacterId)
            ? entry.subCharacterId
            : (matchedC2d?.characterType === "sub_game_character" && Number.isInteger(matchedC2d.characterId)
                ? matchedC2d.characterId
                : null);

        let kind: OfficialModelKind;
        if (characterId !== null) {
            kind = "character";
        } else if (
            entry.kind === "collab"
            || (iconBundle && iconBundle.endsWith("_collabo"))
            || COLLAB_MODEL_RE.test(id)
            || (assetName && COLLAB_MODEL_RE.test(assetName))
        ) {
            kind = "collab";
        } else if (
            entry.kind === "sub"
            || matchedC2d?.characterType === "sub_game_character"
            || /^(?:v2_)?sub_/.test(id)
            || (entry.name && !isPlaceholderSpeakerName(entry.name))
        ) {
            kind = "sub";
        } else {
            kind = "mob";
        }

        const rawOwnerKey = kind === "character"
            ? null
            : (String(entry.ownerKey ?? "").trim() || deriveOwnerKey(id) || deriveOwnerKey(assetName));
        if (rawOwnerKey) ownerKeySet.add(rawOwnerKey);

        staged.push({ id, entry, matchedC2d, characterId, subCharacterId, kind, rawOwnerKey });
    }

    return staged.map(({ id, entry, matchedC2d, characterId, subCharacterId, kind, rawOwnerKey }) => {
        const ownerKey = kind === "character" ? null : normalizeOwnerKeyWithKnown(rawOwnerKey, ownerKeySet);
        const motion = entry.motion ?? inferMotionBundleCandidates(id)[0] ?? null;
        const unit = entry.unit || matchedC2d?.unit || (characterId ? CHAR_BY_ID.get(characterId)?.unit : null) || null;
        const episodeCount = Number.isFinite(entry.episodeCount) ? entry.episodeCount : 0;
        const episodes = Array.isArray(entry.episodes) ? entry.episodes.filter((x: unknown) => typeof x === "string") : [];

        if (kind === "character") {
            const baseChar = characterId ? CHAR_BY_ID.get(characterId) : null;
            const names: Partial<Record<StoryRegion, string>> = baseChar
                ? { jp: baseChar.jp, cn: baseChar.zh, en: baseChar.en }
                : {};
            if (entry.names && typeof entry.names === "object") Object.assign(names, entry.names);
            const name = cleanSpeakerName(entry.name)
                || pickLocalizedName(names, region)
                || (baseChar ? baseChar.en : id);
            return {
                id,
                motion,
                kind,
                characterId,
                subCharacterId,
                ownerKey: null,
                unit,
                name,
                names,
                aliases: Array.isArray(entry.aliases) ? entry.aliases.map(cleanSpeakerName).filter(Boolean) : [],
                episodeCount,
                episodes,
            };
        }

        const builtin = ownerKey ? SUB_CHARACTER_NAMES[ownerKey] : undefined;
        const names: Partial<Record<StoryRegion, string>> = { ...(builtin?.names ?? {}) };
        if (entry.names && typeof entry.names === "object") Object.assign(names, entry.names);
        const subMasterName = subCharacterId !== null ? subCharById.get(subCharacterId) : undefined;
        const name = cleanSpeakerName(entry.name)
            || pickLocalizedName(names, region)
            || subMasterName
            || ownerKey
            || id;
        const aliases = [
            ...(Array.isArray(entry.aliases) ? entry.aliases : []),
            ...(builtin?.aliases ?? []),
            ...(subMasterName ? [subMasterName] : []),
        ]
            .map(cleanSpeakerName)
            .filter((v, idx, arr) => Boolean(v) && v !== name && arr.indexOf(v) === idx);

        return {
            id,
            motion,
            kind,
            characterId: null,
            subCharacterId,
            ownerKey,
            unit,
            name,
            names,
            aliases,
            episodeCount,
            episodes,
        };
    });
}

export function filterAndRankCatalogModels(
    models: CatalogModelItem[],
    opts: { kind?: string; char?: string; search?: string; v2Only?: boolean } = {},
): CatalogModelItem[] {
    const rawKind = opts.kind ? String(opts.kind).trim().toLowerCase() : null;
    if (rawKind && rawKind !== "all" && !(MODEL_KINDS as readonly string[]).includes(rawKind)) {
        throw new Error(`Invalid model kind '${opts.kind}' (expected ${MODEL_KINDS.join("|")}|all).`);
    }
    const charIds = opts.char ? new Set(resolveCharacterIds(opts.char)) : null;
    const query = (opts.search ?? "").trim().toLowerCase();

    const scored: Array<{ model: CatalogModelItem; score: number }> = [];
    for (const m of models) {
        if (opts.v2Only && !m.id.startsWith("v2_")) continue;
        if (rawKind && rawKind !== "all" && m.kind !== rawKind) continue;
        if (charIds && (!m.characterId || !charIds.has(m.characterId))) continue;
        let score = 1;
        if (query) {
            const baseChar = m.characterId ? CHAR_BY_ID.get(m.characterId) : null;
            const fields = [
                m.id,
                m.name,
                m.ownerKey ?? "",
                ...Object.values(m.names),
                ...m.aliases,
                ...(baseChar ? [baseChar.key, baseChar.prefix, baseChar.en, baseChar.jp, baseChar.zh, ...baseChar.aliases] : []),
            ].map((s) => String(s).toLowerCase());
            if (fields.some((f) => f === query)) score = 3;
            else if (fields.some((f) => f.includes(query))) score = 2;
            else continue;
        }
        scored.push({ model: m, score });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ka = KIND_ORDER[a.model.kind] ?? 9;
        const kb = KIND_ORDER[b.model.kind] ?? 9;
        if (ka !== kb) return ka - kb;
        const av2 = Number(a.model.id.startsWith("v2_"));
        const bv2 = Number(b.model.id.startsWith("v2_"));
        if (bv2 !== av2) return bv2 - av2;
        if (b.model.episodeCount !== a.model.episodeCount) return b.model.episodeCount - a.model.episodeCount;
        return a.model.id.localeCompare(b.model.id);
    });

    return scored.map((s) => s.model);
}

// ==================== HTTP & Disk Cache ====================

interface ResolvedNetOpts {
    region: StoryRegion;
    line: "main" | "backup";
    noCache: boolean;
    cacheDir: string;
    fetchImpl: typeof fetch;
}

function resolveNetOpts(opts?: OfficialStoryRuntimeOptions): ResolvedNetOpts {
    return {
        region: opts?.region ?? "jp",
        line: opts?.line ?? "main",
        noCache: Boolean(opts?.noCache),
        cacheDir: opts?.cacheDir ?? DEFAULT_CACHE_DIR,
        fetchImpl: opts?.fetchImpl ?? globalThis.fetch,
    };
}

function cacheFilePath(cacheDir: string, namespace: string, key: string, ext = "json"): string {
    const safeKey = createHash("sha256").update(`${namespace}:${key}`).digest("hex").slice(0, 24);
    const prefix = namespace.replace(/[^A-Za-z0-9_-]+/g, "_");
    return join(cacheDir, `${prefix}_${safeKey}.${ext}`);
}

async function readCacheFile(filePath: string, ttlMs: number, noCache: boolean): Promise<Buffer | null> {
    if (noCache) return null;
    try {
        const info = await stat(filePath);
        if (ttlMs > 0 && Date.now() - info.mtimeMs > ttlMs) return null;
        return await readFile(filePath);
    } catch {
        return null;
    }
}

async function writeCacheFile(cacheDir: string, filePath: string, data: string | Buffer): Promise<void> {
    try {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(filePath, data);
    } catch {
        // Non-fatal
    }
}

async function fetchJsonWithFallback(
    urls: string[],
    cacheNs: string,
    cacheKey: string,
    ttlMs: number,
    net: ResolvedNetOpts,
): Promise<any> {
    const filePath = cacheFilePath(net.cacheDir, cacheNs, cacheKey, "json");
    const cached = await readCacheFile(filePath, ttlMs, net.noCache);
    if (cached) return JSON.parse(cached.toString("utf8"));

    let lastErr: Error | null = null;
    for (const url of urls) {
        try {
            const res = await net.fetchImpl(url, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            });
            if (res.ok) {
                const text = await res.text();
                const parsed = JSON.parse(text);
                if (!net.noCache) await writeCacheFile(net.cacheDir, filePath, text);
                return parsed;
            }
            lastErr = new Error(`${url}: HTTP ${res.status}`);
            if (res.status === 404 && urls.length === 1) throw lastErr;
        } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastErr ?? new Error(`Failed to fetch ${cacheKey}`);
}

function fetchMaster(filename: string, net: ResolvedNetOpts): Promise<any> {
    const domains = MASTER_DOMAINS[net.line];
    const urls = domains.map((d) => `${d}/${net.region}/master/${filename}`);
    return fetchJsonWithFallback(urls, "master", `${net.region}:${filename}`, TTL_MASTER_MS, net);
}

function storageUrl(region: StoryRegion, relPath: string, line: "main" | "backup" = "main"): string {
    return `${STORAGE_DOMAINS[line][0]}/sekai-${region}-assets/${relPath.replace(/^\/+/, "")}`;
}

function fetchStorageJson(relPath: string, net: ResolvedNetOpts, ttlMs = TTL_SCENARIO_MS): Promise<any> {
    const clean = relPath.replace(/^\/+/, "");
    const urls = STORAGE_DOMAINS[net.line].map((d) => `${d}/sekai-${net.region}-assets/${clean}`);
    return fetchJsonWithFallback(urls, "storage", `${net.region}:${clean}`, ttlMs, net);
}

async function fetchDirectoryListing(
    dirPath: string,
    net: ResolvedNetOpts,
): Promise<{ directories: string[]; files: string[] }> {
    const clean = dirPath.replace(/^\/+/, "").replace(/\/?$/, "/");
    const data = await fetchStorageJson(clean, net, TTL_MASTER_MS);
    const directories = Array.isArray(data.directories)
        ? data.directories.filter((x: unknown): x is string => typeof x === "string")
        : [];
    const files = Array.isArray(data.files)
        ? data.files
            .map((x: any) => (typeof x === "string" ? x : x?.name))
            .filter((x: unknown): x is string => typeof x === "string")
        : [];
    return { directories, files };
}

async function loadSePackIndex(net: ResolvedNetOpts) {
    const results = await Promise.all(
        SE_PACKS.map(async (pack) => {
            try {
                const { files } = await fetchDirectoryListing(`sound/scenario/se/${pack}/`, net);
                return { pack, files };
            } catch {
                return { pack, files: [] as string[] };
            }
        }),
    );
    const byBare = new Map<string, string>();
    const allItems: Array<{ pack: string; label: string; path: string }> = [];
    for (const { pack, files } of results) {
        for (const file of files) {
            const label = file.replace(AUDIO_EXT_RE, "");
            if (!label) continue;
            if (!byBare.has(label)) byBare.set(label, pack);
            allItems.push({ pack, label, path: `${pack}/${label}` });
        }
    }
    return { byBare, allItems };
}

async function loadBgmMetadata(net: ResolvedNetOpts) {
    const [tracks, cats] = await Promise.all([
        fetchMaster("musicSoundTracks.json", net).catch(() => []),
        fetchMaster("musicSoundTrackCategories.json", net).catch(() => []),
    ]);
    const catById = new Map<number, string>();
    for (const c of cats ?? []) {
        if (typeof c?.id === "number" && typeof c?.name === "string") catById.set(c.id, c.name);
    }
    const byName = new Map<string, { name: string; bareDir: string; title: string; category: string; mysekai: boolean }>();
    const list: Array<{ name: string; bareDir: string; title: string; category: string; mysekai: boolean }> = [];
    for (const t of tracks ?? []) {
        const dir = String(t?.assetbundleName ?? "").trim().replace(/^\/+|\/+$/g, "");
        const rawFile = String(t?.assetbundleFileName || dir.split("/").pop() || "").trim().replace(AUDIO_EXT_RE, "");
        if (!dir || !rawFile) continue;
        let canonical: string;
        if (dir.startsWith("sound/scenario/bgm/")) {
            const sub = dir.slice("sound/scenario/bgm/".length);
            canonical = sub === rawFile ? rawFile : `${sub}/${rawFile}`;
        } else {
            canonical = `${dir}/${rawFile}`;
        }
        const entry = {
            name: canonical,
            bareDir: dir.startsWith("sound/scenario/bgm/") ? dir.slice("sound/scenario/bgm/".length) : canonical,
            title: t.title || canonical,
            category: catById.get(t.musicSoundTrackCategoryId) ?? "",
            mysekai: dir.startsWith("mysekai/"),
        };
        byName.set(canonical, entry);
        if (!byName.has(entry.bareDir)) byName.set(entry.bareDir, entry);
        list.push(entry);
    }
    return { byName, list };
}

async function loadCharacter2dMap(net: ResolvedNetOpts): Promise<Map<number, any>> {
    const list = await fetchMaster("character2ds.json", net).catch(() => []);
    const map = new Map<number, any>();
    for (const item of list ?? []) {
        if (typeof item?.id === "number") map.set(item.id, item);
    }
    return map;
}

async function loadSubGameCharacterMap(net: ResolvedNetOpts): Promise<Map<number, string>> {
    const list = await fetchMaster("subGameCharacters.json", net).catch(() => []);
    const map = new Map<number, string>();
    for (const item of list ?? []) {
        if (typeof item?.id === "number" && typeof item?.name === "string") {
            const clean = stripSubMasterdataAnnotation(item.name);
            if (clean) map.set(item.id, clean);
        }
    }
    return map;
}

async function fetchTranslationEpisode(
    kind: "event" | "card" | "area",
    fileId: number,
    episodeKey: number | string,
    locale: "zh-CN" | "en-US",
    net: ResolvedNetOpts,
): Promise<any | null> {
    const prefixMap = { event: "eventStory/event_", card: "cardStory/card_", area: "areaTalk/group_" };
    const base = locale === "en-US"
        ? `${TRANSLATION_BASE}/v2/en-US/translation`
        : `${TRANSLATION_BASE}/translation`;
    const url = `${base}/${prefixMap[kind]}${fileId}.json`;
    try {
        const data = await fetchJsonWithFallback([url], "translation", `${locale}:${kind}:${fileId}`, TTL_SCENARIO_MS, net);
        const episodes = data?.episodes ?? data;
        return episodes?.[String(episodeKey)] ?? null;
    } catch {
        return null;
    }
}

// ==================== Scenario Extractor & Aggregator ====================

function buildMskVoiceString(
    voiceIdRaw: unknown,
    voiceChara2dId: number,
    fallbackChara2dId: number,
    storyKind: string,
    scenarioId: string,
    chara2dById: Map<number, any>,
    region: StoryRegion,
): string | null {
    const voiceId = String(voiceIdRaw ?? "").trim();
    if (!voiceId) return null;
    if (voiceId.startsWith("partvoice")) {
        const c2dId = voiceChara2dId || fallbackChara2dId || 0;
        const c2d = c2dId ? chara2dById.get(c2dId) : null;
        if (c2d?.assetName && c2d?.unit) {
            const chara = `${c2d.assetName}_${c2d.unit}`;
            if (chara.startsWith("v2_") || chara.startsWith("clb")) {
                return `voice(story:part_voice_${chara}:${voiceId}@${region})`;
            }
            return `voice(part:${chara}:${voiceId}@${region})`;
        }
    }
    const kind = storyKind === "card" ? "card" : storyKind === "area" ? "area" : "story";
    return `voice(${kind}:${scenarioId}:${voiceId}@${region})`;
}

export function extractScenarioStudy(
    scenario: any,
    ctx: {
        region?: StoryRegion;
        line?: "main" | "backup";
        selector?: string;
        storyKind?: string;
        scenarioId?: string;
        storyTitle?: string;
        episodeTitle?: string;
        scenarioUrl?: string;
        chara2dById?: Map<number, any>;
        subGameCharById?: Map<number, string>;
        sePackByName?: Map<string, string>;
        bgmTitleByName?: Map<string, { name: string; title: string; category: string }>;
        translationEpisode?: any;
        maxExamples?: number;
    } = {},
): OfficialScenarioStudyReport {
    const region: StoryRegion = ctx.region ?? "jp";
    const line = ctx.line ?? "main";
    const storyKind = ctx.storyKind ?? "event";
    const scenarioId = scenario?.ScenarioId || ctx.scenarioId || "";
    const chara2dById = ctx.chara2dById ?? new Map<number, any>();
    const subGameCharById = ctx.subGameCharById ?? new Map<number, string>();
    const sePackByName = ctx.sePackByName ?? new Map<string, string>();
    const bgmTitleByName = ctx.bgmTitleByName ?? new Map();
    const translationTalk = ctx.translationEpisode?.talkData ?? null;
    const maxExamples = ctx.maxExamples ?? 2;

    const translateText = (raw: string | undefined): string | null => {
        if (!translationTalk || !raw) return null;
        return translationTalk[raw] ?? translationTalk[raw.trim()] ?? null;
    };

    const speakerNameCounts = new Map<number, { real: Map<string, number>; placeholder: Map<string, number> }>();
    for (const td of scenario?.TalkData ?? []) {
        if (!td || !Array.isArray(td.TalkCharacters) || td.TalkCharacters.length !== 1) continue;
        const c2dId = td.TalkCharacters[0]?.Character2dId;
        if (!c2dId) continue;
        const rawDisp = cleanSpeakerName(td.WindowDisplayName);
        if (!rawDisp) continue;
        const disp = cleanSpeakerName(translateText(td.WindowDisplayName)) || rawDisp;
        let bucket = speakerNameCounts.get(c2dId);
        if (!bucket) {
            bucket = { real: new Map(), placeholder: new Map() };
            speakerNameCounts.set(c2dId, bucket);
        }
        const targetMap = isPlaceholderSpeakerName(disp) ? bucket.placeholder : bucket.real;
        targetMap.set(disp, (targetMap.get(disp) ?? 0) + 1);
    }

    const pickStoryDisplayNames = (c2dId: number): string[] => {
        const bucket = speakerNameCounts.get(c2dId);
        if (!bucket) return [];
        const map = bucket.real.size > 0 ? bucket.real : bucket.placeholder;
        return [...map.entries()]
            .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
            .map(([label]) => label);
    };

    const resolveActorInfo = (char2dId: number, explicitModelId?: string): OfficialScenarioCastEntry => {
        const c2d = chara2dById.get(char2dId);
        const charId: number | null = c2d?.characterType === "game_character" ? c2d.characterId : null;
        const baseChar = charId ? CHAR_BY_ID.get(charId) : null;
        const modelId = explicitModelId || "";
        const rawKey = baseChar?.key ?? (c2d?.assetName || modelId || (char2dId ? `char2d_${char2dId}` : "unknown"));
        const inferredKey = String(rawKey).replace(/[^A-Za-z0-9_-]+/g, "_") || "unknown";
        const storyDisplayNames = pickStoryDisplayNames(char2dId);
        const storyDisplayName = storyDisplayNames[0] ?? null;
        const motionBundle = modelId ? (inferMotionBundleCandidates(modelId)[0] ?? null) : null;

        if (baseChar) {
            return {
                actorKey: modelId ? `${inferredKey}:${modelId}` : `${inferredKey}:id${char2dId}`,
                shortKey: inferredKey,
                char2dId,
                charId,
                name: `${baseChar.en} / ${baseChar.jp}`,
                storyDisplayName,
                storyDisplayNames: storyDisplayNames.slice(0, 4),
                ownerKey: null,
                kind: "character",
                unit: c2d?.unit ?? baseChar.unit ?? "",
                modelId,
                motionBundle,
                isSubOrMob: false,
            };
        }

        const ownerKey = normalizeOwnerKeyWithKnown(deriveOwnerKey(modelId || c2d?.assetName || ""), new Set());
        const builtin = ownerKey ? SUB_CHARACTER_NAMES[ownerKey] : undefined;
        const subMasterName = c2d?.characterType === "sub_game_character" ? (subGameCharById.get(c2d.characterId) ?? null) : null;
        const kind: OfficialModelKind = COLLAB_MODEL_RE.test(modelId)
            ? "collab"
            : (c2d?.characterType === "sub_game_character" || /^(?:v2_)?sub_/.test(modelId) || builtin || storyDisplayName)
                ? "sub"
                : "mob";
        const name = storyDisplayName || subMasterName || pickLocalizedName(builtin?.names, region) || c2d?.assetName || `Char2d#${char2dId}`;

        return {
            actorKey: modelId ? `${inferredKey}:${modelId}` : `${inferredKey}:id${char2dId}`,
            shortKey: inferredKey,
            char2dId,
            charId: null,
            name,
            storyDisplayName,
            storyDisplayNames: storyDisplayNames.slice(0, 4),
            ownerKey,
            kind,
            unit: c2d?.unit ?? "",
            modelId,
            motionBundle,
            isSubOrMob: true,
        };
    };

    const castEntries: OfficialScenarioCastEntry[] = [];
    const castSeen = new Set<string>();
    const activeCostumeByChara2d = new Map<number, string>();
    for (const appear of scenario?.AppearCharacters ?? []) {
        const c2dId = appear.Character2dId;
        const modelId = String(appear.CostumeType ?? "").trim();
        if (modelId && !activeCostumeByChara2d.has(c2dId)) activeCostumeByChara2d.set(c2dId, modelId);
        const dedupeKey = `${c2dId}|${modelId}`;
        if (castSeen.has(dedupeKey)) continue;
        castSeen.add(dedupeKey);
        castEntries.push(resolveActorInfo(c2dId, modelId));
    }

    const snippets: any[] = Array.isArray(scenario?.Snippets) ? scenario.Snippets : [];
    const talkBySnippetIdx = new Map<number, any>();
    const talkOrderBySnippetIdx = new Map<number, number>();
    let totalTalks = 0;
    for (let i = 0; i < snippets.length; i++) {
        const sn = snippets[i];
        if (sn?.Action === 1) {
            const td = scenario?.TalkData?.[sn.ReferenceIndex];
            if (td) {
                totalTalks += 1;
                talkBySnippetIdx.set(i, td);
                talkOrderBySnippetIdx.set(i, totalTalks);
            }
        }
    }

    const formatTalkShort = (td: any): string => {
        if (!td) return "";
        const speaker = translateText(td.WindowDisplayName) || td.WindowDisplayName || "Narration";
        const body = translateText(td.Body) || td.Body || "";
        return `${speaker}: "${truncate(body, 64)}"`;
    };

    const findAdjacentTalk = (snippetIdx: number, direction: -1 | 1) => {
        for (let i = snippetIdx + direction; i >= 0 && i < snippets.length && Math.abs(i - snippetIdx) <= 25; i += direction) {
            const td = talkBySnippetIdx.get(i);
            if (td?.Body) return { talkLine: talkOrderBySnippetIdx.get(i) ?? 0, text: formatTalkShort(td) };
        }
        return null;
    };

    const bgMap = new Map<string, OfficialScenarioStudyReport["backgrounds"][number]>();
    const bgmMap = new Map<string, OfficialScenarioStudyReport["bgm"][number]>();
    const seMap = new Map<string, OfficialScenarioStudyReport["se"][number]>();
    const charClipsMap = new Map<
        string,
        {
            actorKey: string;
            shortKey: string;
            charId: number | null;
            name: string;
            modelId: string;
            motionBundle: string | null;
            pairMap: Map<string, { motion: string; facial: string; count: number; sources: Set<string>; examples: string[] }>;
        }
    >();
    const voiceSamples: OfficialScenarioStudyReport["voices"] = [];
    const effects: OfficialScenarioStudyReport["effects"] = {
        transitions: {},
        shakes: 0,
        flashes: 0,
        telops: [],
        places: [],
        enterCount: 0,
        moveCount: 0,
        exitCount: 0,
        coStarReactionCount: 0,
    };
    const timeline: Array<Record<string, unknown>> = [];

    let currentBg: string | null = null;
    let currentPlace = "";
    let currentTalkLine = 0;

    const recordBg = (bgId: unknown, talkLine: number, placeHint: string) => {
        const id = String(bgId ?? "").trim();
        if (!id || id === "bg_a000000") return;
        currentBg = id;
        let entry = bgMap.get(id);
        if (!entry) {
            entry = {
                id,
                count: 0,
                firstTalkLine: talkLine,
                places: [],
                isCg: isStoryCgBackground(id),
                webp: storageUrl(region, `scenario/background/${id}/${id}.webp`, line),
                png: storageUrl(region, `scenario/background/${id}/${id}.png`, line),
            };
            bgMap.set(id, entry);
        }
        entry.count += 1;
        if (placeHint && !entry.places.includes(placeHint)) entry.places.push(placeHint);
    };

    const recordBgm = (bgmRaw: unknown, talkLine: number, snippetIdx: number) => {
        const raw = String(bgmRaw ?? "").trim();
        if (!raw || raw === "bgm00000") return;
        const meta = bgmTitleByName.get(raw);
        const canonical = meta?.name ?? raw;
        let entry = bgmMap.get(canonical);
        if (!entry) {
            const after = snippetIdx >= 0 ? findAdjacentTalk(snippetIdx, 1) : findAdjacentTalk(-1, 1);
            const url = canonical.startsWith("mysekai/") || canonical.startsWith("sound/")
                ? storageUrl(region, `${canonical}.mp3`, line)
                : canonical.includes("/")
                    ? storageUrl(region, `sound/scenario/bgm/${canonical}.mp3`, line)
                    : storageUrl(region, `sound/scenario/bgm/${canonical}/${canonical}.mp3`, line);
            entry = {
                name: canonical,
                raw,
                title: meta?.title ?? "",
                category: meta?.category ?? "",
                count: 0,
                firstTalkLine: talkLine,
                sampleContext: after?.text ?? "",
                url,
            };
            bgmMap.set(canonical, entry);
        }
        entry.count += 1;
    };

    const recordSe = (seRaw: unknown, talkLine: number, snippetIdx: number) => {
        const raw = String(seRaw ?? "").trim();
        if (!raw) return;
        const pack = raw.includes("/")
            ? raw.split("/")[0]
            : (sePackByName.get(raw) ?? (raw.endsWith("_b") ? "se_pack00001_b" : null));
        const path = raw.includes("/") ? raw : (pack ? `${pack}/${raw}` : raw);
        let entry = seMap.get(path);
        if (!entry) {
            entry = {
                raw,
                path,
                pack: pack ?? "unknown",
                count: 0,
                examples: [],
                url: pack
                    ? storageUrl(region, `sound/scenario/se/${path}.mp3`, line)
                    : storageUrl(region, `sound/scenario/se/se_pack00001_b/${raw}.mp3`, line),
            };
            seMap.set(path, entry);
        }
        entry.count += 1;
        if (entry.examples.length < maxExamples) {
            const before = findAdjacentTalk(snippetIdx, -1);
            const after = findAdjacentTalk(snippetIdx, 1);
            entry.examples.push({
                talkLine,
                before: before?.text ?? "",
                after: after?.text ?? "",
            });
        }
    };

    const recordClip = (
        char2dId: number,
        motionRaw: unknown,
        facialRaw: unknown,
        source: string,
        contextText: string,
        explicitModelId?: string,
    ) => {
        const motion = String(motionRaw ?? "").trim();
        const facial = String(facialRaw ?? "").trim();
        if (!motion && !facial) return;
        const modelId = String(explicitModelId ?? "").trim() || activeCostumeByChara2d.get(char2dId) || "";
        const info = resolveActorInfo(char2dId, modelId);
        let bucket = charClipsMap.get(info.actorKey);
        if (!bucket) {
            bucket = {
                actorKey: info.actorKey,
                shortKey: info.shortKey,
                charId: info.charId,
                name: info.name,
                modelId: info.modelId,
                motionBundle: info.motionBundle,
                pairMap: new Map(),
            };
            charClipsMap.set(info.actorKey, bucket);
        }
        const pairKey = `${motion}\0${facial}`;
        let pair = bucket.pairMap.get(pairKey);
        if (!pair) {
            pair = { motion, facial, count: 0, sources: new Set(), examples: [] };
            bucket.pairMap.set(pairKey, pair);
        }
        pair.count += 1;
        pair.sources.add(source);
        if (contextText && pair.examples.length < maxExamples && !pair.examples.includes(contextText)) {
            pair.examples.push(contextText);
        }
    };

    if (scenario?.FirstBackground && scenario.FirstBackground !== "bg_a000000") {
        recordBg(scenario.FirstBackground, 0, "");
        timeline.push({ kind: "bg", talkLine: 0, bg: scenario.FirstBackground });
    }
    if (scenario?.FirstBgm && scenario.FirstBgm !== "bgm00000") {
        recordBgm(scenario.FirstBgm, 0, -1);
        timeline.push({ kind: "bgm", talkLine: 0, bgm: bgmTitleByName.get(scenario.FirstBgm)?.name ?? scenario.FirstBgm });
    }
    for (const fl of scenario?.FirstLayout ?? []) {
        if (fl.CostumeType) activeCostumeByChara2d.set(fl.Character2dId, fl.CostumeType);
        const info = resolveActorInfo(fl.Character2dId, fl.CostumeType || activeCostumeByChara2d.get(fl.Character2dId));
        recordClip(fl.Character2dId, fl.MotionName, fl.FacialName, "firstLayout", "(opening pose)", fl.CostumeType);
        timeline.push({
            kind: "enter",
            talkLine: 0,
            actor: info.shortKey,
            modelId: info.modelId,
            slot: SIDE_TO_MSK_SLOT[fl.PositionSide] ?? `side:${fl.PositionSide}`,
            motion: fl.MotionName || "",
            facial: fl.FacialName || "",
        });
    }

    for (let i = 0; i < snippets.length; i++) {
        const sn = snippets[i];
        if (!sn) continue;

        if (sn.Action === 1) {
            const td = scenario?.TalkData?.[sn.ReferenceIndex];
            if (!td) continue;
            currentTalkLine += 1;
            const speakerChara2d = td.TalkCharacters?.[0]?.Character2dId ?? 0;
            const speakerName = translateText(td.WindowDisplayName) || td.WindowDisplayName || "";
            const bodyOrig = td.Body ?? "";
            const bodyTr = translateText(bodyOrig);
            const displayBody = bodyTr ? `${truncate(bodyTr, 80)} [JP: ${truncate(bodyOrig, 48)}]` : truncate(bodyOrig, 100);
            const ctxLine = `${speakerName || "Narration"}: "${truncate(bodyTr || bodyOrig, 64)}"`;

            const speakerMotions: Array<{ motion: string; facial: string }> = [];
            const reactions: Array<{ actor: string; motion: string; facial: string }> = [];
            for (const m of td.Motions ?? []) {
                if (!m) continue;
                const targetId = m.Character2dId || speakerChara2d;
                const isReaction = speakerChara2d > 0 && targetId !== speakerChara2d;
                if (isReaction) effects.coStarReactionCount += 1;
                recordClip(targetId, m.MotionName, m.FacialName, isReaction ? "react" : "talk", ctxLine);
                const actorInfo = resolveActorInfo(targetId, activeCostumeByChara2d.get(targetId));
                if (isReaction) {
                    reactions.push({ actor: actorInfo.shortKey, motion: m.MotionName || "", facial: m.FacialName || "" });
                } else {
                    speakerMotions.push({ motion: m.MotionName || "", facial: m.FacialName || "" });
                }
            }

            let voiceRef: string | null = null;
            if (Array.isArray(td.Voices) && td.Voices.length > 0) {
                const v = td.Voices[0];
                voiceRef = buildMskVoiceString(v.VoiceId, v.Character2dId, speakerChara2d, storyKind, scenarioId, chara2dById, region);
                if (voiceRef && voiceSamples.length < 12) {
                    voiceSamples.push({ ref: voiceRef, speaker: speakerName, text: truncate(bodyTr || bodyOrig, 56) });
                }
            }

            const speakerActor = speakerChara2d
                ? resolveActorInfo(speakerChara2d, activeCostumeByChara2d.get(speakerChara2d)).shortKey
                : "";
            timeline.push({
                kind: "talk",
                talkLine: currentTalkLine,
                actor: speakerActor,
                speaker: speakerName,
                body: displayBody,
                motion: speakerMotions[0]?.motion ?? "",
                facial: speakerMotions[0]?.facial ?? "",
                reactions,
                voice: voiceRef,
            });
        } else if (sn.Action === 2 || sn.Action === 4) {
            const l = scenario?.LayoutData?.[sn.ReferenceIndex];
            if (!l) continue;
            if (l.CostumeType) activeCostumeByChara2d.set(l.Character2dId, l.CostumeType);
            const info = resolveActorInfo(l.Character2dId, l.CostumeType || activeCostumeByChara2d.get(l.Character2dId));
            const ctxText = findAdjacentTalk(i, 1)?.text ?? findAdjacentTalk(i, -1)?.text ?? "";

            if (sn.Action === 4 || l.Type === 0) {
                recordClip(l.Character2dId, l.MotionName, l.FacialName, "pose", ctxText, l.CostumeType);
                timeline.push({ kind: "pose", talkLine: currentTalkLine, actor: info.shortKey, motion: l.MotionName || "", facial: l.FacialName || "" });
            } else if (l.Type === 2) {
                effects.enterCount += 1;
                recordClip(l.Character2dId, l.MotionName, l.FacialName, "enter", ctxText, l.CostumeType);
                timeline.push({ kind: "enter", talkLine: currentTalkLine, actor: info.shortKey, modelId: info.modelId, slot: SIDE_TO_MSK_SLOT[l.SideTo] ?? `side:${l.SideTo}`, motion: l.MotionName || "", facial: l.FacialName || "" });
            } else if (l.Type === 1) {
                effects.moveCount += 1;
                recordClip(l.Character2dId, l.MotionName, l.FacialName, "move", ctxText, l.CostumeType);
                timeline.push({ kind: "move", talkLine: currentTalkLine, actor: info.shortKey, slot: SIDE_TO_MSK_SLOT[l.SideTo] ?? `side:${l.SideTo}`, motion: l.MotionName || "", facial: l.FacialName || "" });
            } else if (l.Type === 3) {
                effects.exitCount += 1;
                timeline.push({ kind: "exit", talkLine: currentTalkLine, actor: info.shortKey });
            }
        } else if (sn.Action === 6) {
            const fx = scenario?.SpecialEffectData?.[sn.ReferenceIndex];
            if (!fx) continue;
            const fxName = SPECIAL_EFFECT_NAMES[fx.EffectType] ?? `Effect#${fx.EffectType}`;
            if (fx.EffectType === 7 || fx.EffectType === 17) {
                const bgId = fx.StringValSub || fx.StringVal;
                if (bgId === "bg_a000000") {
                    currentBg = null;
                    timeline.push({ kind: "bg", talkLine: currentTalkLine, bg: "bg_a000000 (black)" });
                } else {
                    recordBg(bgId, currentTalkLine, currentPlace);
                    timeline.push({ kind: "bg", talkLine: currentTalkLine, bg: bgId });
                }
            } else if (fx.EffectType === 18) {
                const placeText = translateText(fx.StringVal) || fx.StringVal || "";
                currentPlace = placeText;
                if (placeText && !effects.places.includes(placeText)) effects.places.push(placeText);
                if (currentBg && bgMap.has(currentBg) && placeText) {
                    const b = bgMap.get(currentBg)!;
                    if (!b.places.includes(placeText)) b.places.push(placeText);
                }
                timeline.push({ kind: "place", talkLine: currentTalkLine, text: placeText });
            } else if (fx.EffectType === 8) {
                const telopText = translateText(fx.StringVal) || fx.StringVal || "";
                if (telopText) effects.telops.push(telopText);
                timeline.push({ kind: "telop", talkLine: currentTalkLine, text: telopText });
            } else if (fx.EffectType === 5 || fx.EffectType === 6) {
                effects.shakes += 1;
                timeline.push({ kind: "fx", talkLine: currentTalkLine, fx: fxName, duration: fx.Duration });
            } else if (fx.EffectType >= 1 && fx.EffectType <= 4) {
                effects.transitions[fxName] = (effects.transitions[fxName] ?? 0) + 1;
                if (fx.EffectType === 3 || fx.EffectType === 4) effects.flashes += 1;
                timeline.push({ kind: "fx", talkLine: currentTalkLine, fx: fxName, duration: fx.Duration });
            }
        } else if (sn.Action === 7) {
            const snd = scenario?.SoundData?.[sn.ReferenceIndex];
            if (!snd) continue;
            if (snd.Bgm) {
                if (snd.Bgm === "bgm00000") {
                    timeline.push({ kind: "bgm", talkLine: currentTalkLine, bgm: "STOP" });
                } else {
                    recordBgm(snd.Bgm, currentTalkLine, i);
                    timeline.push({ kind: "bgm", talkLine: currentTalkLine, bgm: bgmTitleByName.get(snd.Bgm)?.name ?? snd.Bgm });
                }
            }
            if (snd.Se) {
                recordSe(snd.Se, currentTalkLine, i);
                const pack = sePackByName.get(snd.Se);
                const resolvedSe = snd.Se.includes("/") ? snd.Se : (pack ? `${pack}/${snd.Se}` : snd.Se);
                timeline.push({ kind: "se", talkLine: currentTalkLine, se: resolvedSe });
            }
        }
    }

    const characterClips = [...charClipsMap.values()]
        .sort((a, b) => (a.charId ?? 999) - (b.charId ?? 999) || a.actorKey.localeCompare(b.actorKey))
        .map((bucket) => ({
            actorKey: bucket.actorKey,
            shortKey: bucket.shortKey,
            charId: bucket.charId,
            name: bucket.name,
            modelId: bucket.modelId,
            motionBundle: bucket.motionBundle,
            pairs: [...bucket.pairMap.values()]
                .sort((a, b) => b.count - a.count || a.motion.localeCompare(b.motion) || a.facial.localeCompare(b.facial))
                .map((p) => ({
                    motion: p.motion,
                    facial: p.facial,
                    count: p.count,
                    sources: [...p.sources],
                    examples: p.examples,
                })),
        }));

    return {
        meta: {
            selector: ctx.selector ?? scenarioId,
            region,
            storyKind,
            scenarioId,
            storyTitle: ctx.storyTitle ?? "",
            episodeTitle: ctx.episodeTitle ?? "",
            scenarioUrl: ctx.scenarioUrl ?? "",
            talkCount: totalTalks,
            snippetCount: snippets.length,
        },
        cast: castEntries,
        backgrounds: [...bgMap.values()],
        bgm: [...bgmMap.values()],
        se: [...seMap.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
        characterClips,
        voices: voiceSamples,
        effects,
        timeline,
    };
}

export function aggregateStudyReports(
    reports: OfficialScenarioStudyReport[],
    targetCharIds: number[] = [],
): Omit<OfficialStudyKit, "region" | "errors"> {
    const targetSet = new Set(targetCharIds);
    const castByChar = new Map<string, OfficialScenarioCastEntry & { count: number; isV2: boolean }>();
    const bgMap = new Map<string, OfficialStudyKit["backgrounds"][number]>();
    const bgmMap = new Map<string, OfficialStudyKit["bgm"][number]>();
    const seMap = new Map<string, OfficialStudyKit["se"][number]>();
    const clipsByChar = new Map<
        string,
        {
            shortKey: string;
            charId: number | null;
            name: string;
            models: Set<string>;
            pairMap: Map<string, { motion: string; facial: string; count: number; examples: string[] }>;
        }
    >();

    for (const rep of reports) {
        for (const c of rep.cast) {
            if (!c.modelId) continue;
            if (targetSet.size > 0 && c.charId !== null && !targetSet.has(c.charId)) continue;
            const key = `${c.charId ?? c.shortKey}|${c.modelId}`;
            const existing = castByChar.get(key);
            if (!existing) {
                castByChar.set(key, {
                    ...c,
                    storyDisplayNames: [...c.storyDisplayNames],
                    count: 1,
                    isV2: c.modelId.startsWith("v2_"),
                });
            } else {
                existing.count += 1;
            }
        }
        for (const bg of rep.backgrounds) {
            const cur = bgMap.get(bg.id) ?? {
                id: bg.id,
                count: 0,
                places: [],
                episodes: [],
                isCg: bg.isCg,
                webp: bg.webp,
            };
            cur.count += bg.count;
            for (const p of bg.places) if (!cur.places.includes(p)) cur.places.push(p);
            if (!cur.episodes.includes(rep.meta.selector)) cur.episodes.push(rep.meta.selector);
            bgMap.set(bg.id, cur);
        }
        for (const b of rep.bgm) {
            const cur = bgmMap.get(b.name) ?? {
                name: b.name,
                title: b.title,
                category: b.category,
                count: 0,
                episodes: [],
                url: b.url,
            };
            cur.count += b.count;
            if (!cur.episodes.includes(rep.meta.selector)) cur.episodes.push(rep.meta.selector);
            bgmMap.set(b.name, cur);
        }
        for (const s of rep.se) {
            const cur = seMap.get(s.path) ?? {
                path: s.path,
                pack: s.pack,
                count: 0,
                episodes: [],
                examples: [],
            };
            cur.count += s.count;
            if (!cur.episodes.includes(rep.meta.selector)) cur.episodes.push(rep.meta.selector);
            for (const ex of s.examples) {
                if (cur.examples.length < 3) cur.examples.push({ ...ex, selector: rep.meta.selector });
            }
            seMap.set(s.path, cur);
        }
        for (const cc of rep.characterClips) {
            if (targetSet.size > 0 && cc.charId !== null && !targetSet.has(cc.charId)) continue;
            const groupKey = cc.charId !== null
                ? `char:${cc.charId}:${cc.modelId.startsWith("v2_") ? "v2" : "v1"}`
                : cc.actorKey;
            let bucket = clipsByChar.get(groupKey);
            if (!bucket) {
                bucket = {
                    shortKey: cc.shortKey,
                    charId: cc.charId,
                    name: cc.name,
                    models: new Set(),
                    pairMap: new Map(),
                };
                clipsByChar.set(groupKey, bucket);
            }
            if (cc.modelId) bucket.models.add(cc.modelId);
            for (const p of cc.pairs) {
                const pk = `${p.motion}\0${p.facial}`;
                let cur = bucket.pairMap.get(pk);
                if (!cur) {
                    cur = { motion: p.motion, facial: p.facial, count: 0, examples: [] };
                    bucket.pairMap.set(pk, cur);
                }
                cur.count += p.count;
                for (const ex of p.examples) {
                    if (cur.examples.length < 2 && !cur.examples.includes(ex)) cur.examples.push(ex);
                }
            }
        }
    }

    return {
        sources: reports.map((r) => ({
            selector: r.meta.selector,
            storyTitle: r.meta.storyTitle,
            episodeTitle: r.meta.episodeTitle,
            talkCount: r.meta.talkCount,
        })),
        recommendedCast: [...castByChar.values()].sort(
            (a, b) => Number(b.isV2) - Number(a.isV2) || (a.charId ?? 999) - (b.charId ?? 999) || b.count - a.count,
        ),
        backgrounds: [...bgMap.values()].sort((a, b) => Number(a.isCg) - Number(b.isCg) || b.count - a.count),
        bgm: [...bgmMap.values()].sort((a, b) => b.count - a.count),
        se: [...seMap.values()].sort((a, b) => b.count - a.count),
        characterClips: [...clipsByChar.values()]
            .sort((a, b) => (a.charId ?? 999) - (b.charId ?? 999))
            .map((b) => ({
                shortKey: b.shortKey,
                charId: b.charId,
                name: b.name,
                models: [...b.models],
                pairs: [...b.pairMap.values()].sort((x, y) => y.count - x.count).slice(0, 14),
            })),
    };
}

// ==================== High-Level Actions ====================

export async function listOfficialEpisodes(
    opts: OfficialStoryRuntimeOptions & {
        kind?: "event" | "unit" | "card" | "area" | "special";
        unit?: string;
        char?: string;
        query?: string;
        includeMixed?: boolean;
        oldest?: boolean;
        limit?: number;
    } = {},
): Promise<OfficialEpisodeDiscoveryItem[]> {
    const net = resolveNetOpts(opts);
    const kind = opts.kind ?? "event";
    const unitKey = resolveUnitKey(opts.unit);
    const charIds = opts.char ? resolveCharacterIds(opts.char) : [];
    const charSet = new Set(charIds);
    const queryLower = (opts.query ?? "").trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, opts.limit ?? 15));
    const sortLatest = !opts.oldest;
    const unitCharIds = unitKey ? new Set(CHARACTERS.filter((c) => c.unit === unitKey).map((c) => c.id)) : null;

    if (kind === "event") {
        const [events, stories, gcu, eventCards, cards] = await Promise.all([
            fetchMaster("events.json", net),
            fetchMaster("eventStories.json", net),
            fetchMaster("gameCharacterUnits.json", net).catch(() => []),
            charSet.size > 0 || unitKey ? fetchMaster("eventCards.json", net).catch(() => []) : Promise.resolve([]),
            charSet.size > 0 || unitKey ? fetchMaster("cards.json", net).catch(() => []) : Promise.resolve([]),
        ]);
        const eventById = new Map<number, any>(events.map((e: any) => [e.id, e]));
        const gcuById = new Map<number, any>(gcu.map((u: any) => [u.id, u]));
        const cardCharById = new Map<number, number>(cards.map((c: any) => [c.id, c.characterId]));
        const eventChars = new Map<number, Set<number>>();
        for (const ec of eventCards) {
            const cid = cardCharById.get(ec.cardId);
            if (!cid) continue;
            let set = eventChars.get(ec.eventId);
            if (!set) {
                set = new Set();
                eventChars.set(ec.eventId, set);
            }
            set.add(cid);
        }

        const matched: OfficialEpisodeDiscoveryItem[] = [];
        for (const s of stories) {
            const ev = eventById.get(s.eventId);
            const bannerUnit = gcuById.get(s.bannerGameCharacterUnitId);
            const bannerCharId: number | null = bannerUnit?.gameCharacterId ?? null;
            const bannerUnitName: string | null = bannerUnit?.unit ?? null;
            const charsInEv = new Set<number>(eventChars.get(s.eventId) ?? []);
            if (bannerCharId) charsInEv.add(bannerCharId);

            if (unitKey) {
                const unitCardCount = [...charsInEv].filter((cid) => unitCharIds?.has(cid)).length;
                const isUnitMajority = charsInEv.size > 0 && unitCardCount >= Math.max(2, Math.ceil(charsInEv.size * 0.6));
                const isUnitFocus = bannerUnitName === unitKey || (!bannerUnitName && isUnitMajority);
                if (opts.includeMixed ? unitCardCount < 1 : !isUnitFocus) continue;
            }
            if (charSet.size > 0 && ![...charSet].every((cid) => charsInEv.has(cid))) continue;

            const title = ev?.name ?? `Event ${s.eventId}`;
            const outline = s.outline ?? "";
            const eps = [...(s.eventStoryEpisodes ?? [])].sort((a: any, b: any) => a.episodeNo - b.episodeNo);
            if (queryLower) {
                const hay = `${title} ${outline} ${s.assetbundleName} ${eps.map((e: any) => e.title).join(" ")}`.toLowerCase();
                if (!hay.includes(queryLower)) continue;
            }
            const firstEp = eps[0];
            if (!firstEp) continue;
            matched.push({
                selector: `event:${s.eventId}/${firstEp.episodeNo}`,
                kind: "event",
                eventId: s.eventId,
                title,
                episodeCount: eps.length,
                scenarioId: firstEp.scenarioId,
                bannerChar: bannerCharId ? (CHAR_BY_ID.get(bannerCharId)?.key ?? String(bannerCharId)) : "",
                unit: bannerUnitName ? (UNIT_SHORT[bannerUnitName] ?? bannerUnitName) : "",
                outline: truncate(outline, 90),
            });
        }
        matched.sort((a, b) => (sortLatest ? (b.eventId ?? 0) - (a.eventId ?? 0) : (a.eventId ?? 0) - (b.eventId ?? 0)));
        return matched.slice(0, limit);
    }

    if (kind === "unit") {
        const [unitStories, profiles] = await Promise.all([
            fetchMaster("unitStories.json", net),
            fetchMaster("unitProfiles.json", net).catch(() => []),
        ]);
        const profileByUnit = new Map<string, string>(profiles.map((p: any) => [p.unit, p.unitName]));
        const out: OfficialEpisodeDiscoveryItem[] = [];
        for (const us of unitStories) {
            if (unitKey && us.unit !== unitKey) continue;
            for (const ch of us.chapters ?? []) {
                for (const ep of ch.episodes ?? []) {
                    const title = `${ch.title || profileByUnit.get(us.unit) || us.unit} — ${ep.title}`;
                    if (queryLower && !title.toLowerCase().includes(queryLower)) continue;
                    out.push({
                        selector: `unit:${ch.assetbundleName}/${ep.episodeNo}`,
                        kind: "unit",
                        unit: UNIT_SHORT[us.unit] ?? us.unit,
                        title,
                        scenarioId: ep.scenarioId,
                    });
                }
            }
        }
        return out.slice(0, limit);
    }

    if (kind === "card") {
        const [cards, episodes] = await Promise.all([
            fetchMaster("cards.json", net),
            fetchMaster("cardEpisodes.json", net),
        ]);
        const epsByCard = new Map<number, any[]>();
        for (const ep of episodes) {
            const arr = epsByCard.get(ep.cardId) ?? [];
            arr.push(ep);
            epsByCard.set(ep.cardId, arr);
        }
        const matched: OfficialEpisodeDiscoveryItem[] = [];
        for (const c of cards) {
            if (charSet.size > 0 && !charSet.has(c.characterId)) continue;
            if (unitCharIds && !unitCharIds.has(c.characterId)) continue;
            const parts = [...(epsByCard.get(c.id) ?? [])].sort((a, b) => (a.seq ?? a.id ?? 0) - (b.seq ?? b.id ?? 0));
            if (parts.length === 0) continue;
            const chInfo = CHAR_BY_ID.get(c.characterId);
            const title = `${chInfo?.en ?? c.characterId} — ${c.prefix}`;
            if (queryLower && !title.toLowerCase().includes(queryLower)) continue;
            matched.push({
                selector: `card:${c.id}/former`,
                kind: "card",
                cardId: c.id,
                char: chInfo?.key ?? String(c.characterId),
                title,
                scenarioId: parts[0].scenarioId,
            });
        }
        matched.sort((a, b) => (sortLatest ? (b.cardId ?? 0) - (a.cardId ?? 0) : (a.cardId ?? 0) - (b.cardId ?? 0)));
        return matched.slice(0, limit);
    }

    if (kind === "area") {
        const [actions, areas, c2dMap] = await Promise.all([
            fetchMaster("actionSets.json", net),
            fetchMaster("areas.json", net).catch(() => []),
            loadCharacter2dMap(net),
        ]);
        const areaById = new Map<number, any>(areas.map((a: any) => [a.id, a]));
        const matched: OfficialEpisodeDiscoveryItem[] = [];
        for (const a of actions) {
            if (!a.scenarioId) continue;
            const chars = [...new Set((a.characterIds ?? []).map((id: number) => c2dMap.get(id)?.characterId).filter(Boolean))] as number[];
            if (charSet.size > 0 && ![...charSet].every((cid) => chars.includes(cid))) continue;
            if (unitCharIds && !chars.some((cid) => unitCharIds.has(cid))) continue;
            const area = areaById.get(a.areaId);
            const title = area ? (area.subName ? `${area.name} - ${area.subName}` : area.name) : `Area ${a.areaId}`;
            if (queryLower && !title.toLowerCase().includes(queryLower)) continue;
            matched.push({
                selector: `area:${a.areaId}/${a.id}`,
                kind: "area",
                actionSetId: a.id,
                title,
                chars: chars.map((cid) => CHAR_BY_ID.get(cid)?.key ?? String(cid)),
                scenarioId: a.scenarioId,
            });
        }
        matched.sort((a, b) => (sortLatest ? (b.actionSetId ?? 0) - (a.actionSetId ?? 0) : (a.actionSetId ?? 0) - (b.actionSetId ?? 0)));
        return matched.slice(0, limit);
    }

    const specials = await fetchMaster("specialStories.json", net);
    const matched: OfficialEpisodeDiscoveryItem[] = [];
    for (const s of specials) {
        for (const ep of s.episodes ?? []) {
            const title = `${s.title || `Special ${s.id}`} — ${ep.title || `Ep ${ep.episodeNo}`}`;
            if (queryLower && !title.toLowerCase().includes(queryLower)) continue;
            matched.push({
                selector: `special:${s.id}/${ep.episodeNo}`,
                kind: "special",
                title,
                scenarioId: ep.scenarioId,
            });
        }
    }
    return matched.slice(0, limit);
}

export async function searchOfficialStoryText(
    query: string,
    opts: OfficialStoryRuntimeOptions & {
        kind?: string;
        char?: string;
        regex?: boolean;
        limit?: number;
    } = {},
): Promise<OfficialSearchTextResult> {
    const net = resolveNetOpts(opts);
    const manifest = await fetchJsonWithFallback(
        [`${STORY_SEARCH_BASE}/manifest.json`],
        "story-search-manifest",
        "manifest",
        TTL_MANIFEST_MS,
        net,
    );
    const serverEntry = manifest?.servers?.[net.region] ?? manifest?.[net.region];
    if (!serverEntry) throw new Error(`Story search corpus not available for region '${net.region}'.`);
    const chunkPath: string | undefined = serverEntry.chunks?.path ?? serverEntry.corpus?.path;
    const sha: string = serverEntry.chunks?.sha256 ?? serverEntry.version ?? chunkPath ?? net.region;
    if (!chunkPath) throw new Error(`No chunks path found in manifest for '${net.region}'.`);

    const corpusCacheFile = cacheFilePath(net.cacheDir, "corpus-jsonl", `${net.region}:${sha}`, "jsonl");
    let rawText: string;
    const cachedBuf = await readCacheFile(corpusCacheFile, 0, net.noCache);
    if (cachedBuf) {
        rawText = cachedBuf.toString("utf8");
    } else {
        const url = chunkPath.startsWith("http")
            ? chunkPath
            : `${STORY_SEARCH_BASE}/${chunkPath.replace(/^\/+/, "")}`;
        const res = await net.fetchImpl(url, { signal: AbortSignal.timeout(CORPUS_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        const compressed = Buffer.from(await res.arrayBuffer());
        const decompressed = url.endsWith(".br") ? brotliDecompressSync(compressed) : compressed;
        rawText = decompressed.toString("utf8");
        if (!net.noCache) await writeCacheFile(net.cacheDir, corpusCacheFile, decompressed);
    }

    const charIds = opts.char ? resolveCharacterIds(opts.char) : [];
    const kindFilter = opts.kind && opts.kind !== "all" ? (opts.kind === "area" ? "talk" : opts.kind) : null;
    const limit = Math.min(30, Math.max(1, opts.limit ?? 10));
    const re = opts.regex ? new RegExp(query, "i") : null;
    const needle = query.toLowerCase();

    const hits: OfficialSearchTextResult["hits"] = [];
    const seenEpisodes = new Set<string>();
    let totalMatchingChunks = 0;

    for (const rawLine of rawText.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!re && needle && !line.toLowerCase().includes(needle)) continue;
        let chunk: any;
        try {
            chunk = JSON.parse(line);
        } catch {
            continue;
        }
        if (kindFilter && chunk.type !== kindFilter) continue;
        if (charIds.length > 0) {
            const cids: number[] = Array.isArray(chunk.char_ids) ? chunk.char_ids : [];
            if (!charIds.every((cid) => cids.includes(cid))) continue;
        }
        const text = String(chunk.text ?? "");
        if (re ? !re.test(text) : (needle && !text.toLowerCase().includes(needle))) continue;
        totalMatchingChunks += 1;
        const epKey = `${chunk.type}|${chunk.story_id}|${chunk.ep}|${chunk.scenario_id}`;
        if (seenEpisodes.has(epKey)) continue;
        seenEpisodes.add(epKey);

        let selector = `${chunk.type}:${chunk.scenario_id}`;
        if (chunk.type === "event") {
            const m = /^event_(\d+)$/.exec(chunk.story_id || "");
            if (m && /^\d+$/.test(String(chunk.ep || ""))) selector = `event:${m[1]}/${chunk.ep}`;
        } else if (chunk.type === "card") {
            const m = /^card_(\d+)$/.exec(chunk.story_id || "");
            if (m) {
                const epStr = String(chunk.ep || "").toLowerCase();
                const part = epStr === "2" || epStr.includes("后") || epStr.includes("後") || epStr.includes("latter") ? "latter" : "former";
                selector = `card:${m[1]}/${part}`;
            }
        } else if (chunk.type === "talk") {
            const m = /^talk_(\d+)$/.exec(chunk.story_id || "");
            if (m) selector = `talk:${m[1]}`;
        }

        const dialogueLines = text.split("\n").filter((l) => l.trim() && !l.startsWith("["));
        const matchedLines = dialogueLines
            .filter((l) => (re ? re.test(l) : l.toLowerCase().includes(needle)))
            .slice(0, 3);
        hits.push({
            selector,
            type: chunk.type,
            story: chunk.story ?? "",
            ep: chunk.ep ?? "",
            scenarioId: chunk.scenario_id ?? "",
            lineRange: `${(chunk.line_start ?? 0) + 1}..${(chunk.line_end ?? 0) + 1}`,
            chars: Array.isArray(chunk.chars) ? chunk.chars : [],
            matchedLines: matchedLines.length > 0 ? matchedLines : dialogueLines.slice(0, 2),
        });
        if (hits.length >= limit) break;
    }

    return {
        region: net.region,
        query,
        totalMatchingChunks,
        returnedEpisodes: hits.length,
        hits,
    };
}

export async function inspectOfficialEpisode(
    selectorRaw: string,
    opts: OfficialStoryRuntimeOptions & {
        translate?: "zh-CN" | "en-US";
        includeTimeline?: boolean;
        lines?: string;
        maxExamples?: number;
    } = {},
): Promise<OfficialScenarioStudyReport> {
    const net = resolveNetOpts(opts);
    const parsed = parseSelector(selectorRaw);
    if (!parsed) {
        throw new Error(
            `Invalid selector '${selectorRaw}'. Examples: event:203/1, unit:light_sound/1, card:900/former, area:1/100, special:1/1`,
        );
    }

    let target: {
        selector: string;
        storyKind: string;
        scenarioId: string;
        scenarioPath: string | null;
        scenarioUrl: string;
        storyTitle: string;
        episodeTitle: string;
        translationRef: { kind: "event" | "card" | "area"; fileId: number; episodeKey: number | string } | null;
    };

    if (parsed.kind === "url") {
        target = {
            selector: parsed.canonical,
            storyKind: "event",
            scenarioId: "",
            scenarioPath: null,
            scenarioUrl: parsed.url,
            storyTitle: "",
            episodeTitle: "",
            translationRef: null,
        };
    } else if (parsed.kind === "path") {
        target = {
            selector: parsed.canonical,
            storyKind: "event",
            scenarioId: "",
            scenarioPath: parsed.path,
            scenarioUrl: storageUrl(net.region, parsed.path, net.line),
            storyTitle: "",
            episodeTitle: "",
            translationRef: null,
        };
    } else if (parsed.kind === "event") {
        const [events, stories] = await Promise.all([
            fetchMaster("events.json", net),
            fetchMaster("eventStories.json", net),
        ]);
        const story = stories.find((s: any) => s.eventId === parsed.eventId);
        if (!story) throw new Error(`Event story ${parsed.eventId} not found on region '${net.region}'.`);
        const ep = (story.eventStoryEpisodes ?? []).find((e: any) => e.episodeNo === parsed.episodeNo);
        if (!ep) throw new Error(`Episode ${parsed.episodeNo} not found in event ${parsed.eventId}.`);
        const ev = events.find((e: any) => e.id === parsed.eventId);
        const relPath = `event_story/${story.assetbundleName}/scenario/${ep.scenarioId}.json`;
        target = {
            selector: parsed.canonical,
            storyKind: "event",
            scenarioId: ep.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: ev?.name ?? `Event ${parsed.eventId}`,
            episodeTitle: ep.title ?? `Ep ${parsed.episodeNo}`,
            translationRef: { kind: "event", fileId: parsed.eventId, episodeKey: parsed.episodeNo },
        };
    } else if (parsed.kind === "unit") {
        const [unitStories, unitProfiles] = await Promise.all([
            fetchMaster("unitStories.json", net),
            fetchMaster("unitProfiles.json", net).catch(() => []),
        ]);
        const normalizedUnit = resolveUnitKey(parsed.chapterOrUnit);
        let matchedStory: any = null;
        let matchedChapter: any = null;
        for (const us of unitStories) {
            for (const ch of us.chapters ?? []) {
                if (ch.assetbundleName === parsed.chapterOrUnit) {
                    matchedStory = us;
                    matchedChapter = ch;
                    break;
                }
            }
            if (matchedChapter) break;
        }
        if (!matchedChapter && normalizedUnit) {
            matchedStory = unitStories.find((us: any) => us.unit === normalizedUnit) ?? null;
            matchedChapter = matchedStory?.chapters?.[0] ?? null;
        }
        if (!matchedChapter) throw new Error(`Unit chapter '${parsed.chapterOrUnit}' not found on region '${net.region}'.`);
        const ep = (matchedChapter.episodes ?? []).find((e: any) => e.episodeNo === parsed.episodeNo);
        if (!ep) throw new Error(`Episode ${parsed.episodeNo} not found in unit chapter '${matchedChapter.assetbundleName}'.`);
        const profile = unitProfiles.find((p: any) => p.unit === matchedStory.unit);
        const relPath = `scenario/unitstory/${matchedChapter.assetbundleName}/${ep.scenarioId}.json`;
        target = {
            selector: `unit:${matchedChapter.assetbundleName}/${ep.episodeNo}`,
            storyKind: "unit",
            scenarioId: ep.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: matchedChapter.title || profile?.unitName || matchedStory.unit,
            episodeTitle: ep.title ?? `Ep ${ep.episodeNo}`,
            translationRef: null,
        };
    } else if (parsed.kind === "card") {
        const [cards, episodes] = await Promise.all([
            fetchMaster("cards.json", net),
            fetchMaster("cardEpisodes.json", net),
        ]);
        const card = cards.find((c: any) => c.id === parsed.cardId);
        if (!card) throw new Error(`Card ${parsed.cardId} not found on region '${net.region}'.`);
        const parts = episodes
            .filter((e: any) => e.cardId === parsed.cardId)
            .sort((a: any, b: any) => (a.seq ?? a.id ?? 0) - (b.seq ?? b.id ?? 0));
        const idx = parsed.part === "latter" ? 1 : 0;
        const ep = parts[idx];
        if (!ep) throw new Error(`Card ${parsed.cardId} has no '${parsed.part}' side story.`);
        const baseDir = net.region === "en" ? "character/member_scenario" : "character/member";
        const relPath = `${baseDir}/${card.assetbundleName}/${ep.scenarioId}.json`;
        target = {
            selector: `card:${parsed.cardId}/${parsed.part}`,
            storyKind: "card",
            scenarioId: ep.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: card.prefix || `Card ${parsed.cardId}`,
            episodeTitle: ep.title || parsed.part,
            translationRef: { kind: "card", fileId: parsed.cardId, episodeKey: idx + 1 },
        };
    } else if (parsed.kind === "area") {
        const [actions, areas] = await Promise.all([
            fetchMaster("actionSets.json", net),
            fetchMaster("areas.json", net).catch(() => []),
        ]);
        const action = actions.find((a: any) => a.id === parsed.actionSetId);
        if (!action?.scenarioId) throw new Error(`Area actionSet ${parsed.actionSetId} not found on region '${net.region}'.`);
        const area = areas.find((a: any) => a.id === action.areaId);
        const group = Math.floor(action.id / 100);
        const relPath = `scenario/actionset/group${group}/${action.scenarioId}.json`;
        target = {
            selector: `area:${action.areaId}/${action.id}`,
            storyKind: "area",
            scenarioId: action.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: area ? (area.subName ? `${area.name} - ${area.subName}` : area.name) : `Area ${action.areaId}`,
            episodeTitle: `ActionSet ${action.id}`,
            translationRef: { kind: "area", fileId: group, episodeKey: action.scenarioId },
        };
    } else if (parsed.kind === "special") {
        const specials = await fetchMaster("specialStories.json", net);
        const story = specials.find((s: any) => s.id === parsed.specialId);
        if (!story) throw new Error(`Special story ${parsed.specialId} not found on region '${net.region}'.`);
        const ep = (story.episodes ?? []).find((e: any) => e.episodeNo === parsed.episodeNo);
        if (!ep) throw new Error(`Episode ${parsed.episodeNo} not found in special story ${parsed.specialId}.`);
        const relPath = `scenario/special/${ep.assetbundleName}/${ep.scenarioId}.json`;
        target = {
            selector: `special:${parsed.specialId}/${parsed.episodeNo}`,
            storyKind: "special",
            scenarioId: ep.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: story.title || `Special ${parsed.specialId}`,
            episodeTitle: ep.title || `Ep ${parsed.episodeNo}`,
            translationRef: null,
        };
    } else {
        const relPath = `scenario/profile/${parsed.scenarioId}.json`;
        target = {
            selector: `self:${parsed.scenarioId}`,
            storyKind: "self",
            scenarioId: parsed.scenarioId,
            scenarioPath: relPath,
            scenarioUrl: storageUrl(net.region, relPath, net.line),
            storyTitle: "Self Introduction",
            episodeTitle: parsed.scenarioId,
            translationRef: null,
        };
    }

    const [scenario, chara2dById, subGameCharById, seIndex, bgmMeta, translationEpisode] = await Promise.all([
        target.scenarioPath
            ? fetchStorageJson(target.scenarioPath, net, TTL_SCENARIO_MS)
            : fetchJsonWithFallback([target.scenarioUrl], "scenario-url", target.scenarioUrl, TTL_SCENARIO_MS, net),
        loadCharacter2dMap(net),
        loadSubGameCharacterMap(net),
        loadSePackIndex(net),
        loadBgmMetadata(net),
        opts.translate && target.translationRef
            ? fetchTranslationEpisode(
                target.translationRef.kind,
                target.translationRef.fileId,
                target.translationRef.episodeKey,
                opts.translate,
                net,
            )
            : Promise.resolve(null),
    ]);

    const report = extractScenarioStudy(scenario, {
        region: net.region,
        line: net.line,
        selector: target.selector,
        storyKind: target.storyKind,
        scenarioId: target.scenarioId,
        storyTitle: target.storyTitle,
        episodeTitle: target.episodeTitle,
        scenarioUrl: target.scenarioUrl,
        chara2dById,
        subGameCharById,
        sePackByName: seIndex.byBare,
        bgmTitleByName: bgmMeta.byName,
        translationEpisode,
        maxExamples: opts.maxExamples ?? 2,
    });

    if (opts.lines) {
        const m = /^(\d+)?\.\.(\d+)?$/.exec(opts.lines.trim());
        if (m) {
            const start = m[1] ? Number.parseInt(m[1], 10) : 1;
            const end = m[2] ? Number.parseInt(m[2], 10) : Number.MAX_SAFE_INTEGER;
            report.timeline = report.timeline.filter((ev) => {
                const ln = Number(ev.talkLine ?? 0);
                return ln >= start && ln <= end;
            });
        }
    } else if (!opts.includeTimeline) {
        report.timeline = report.timeline.slice(0, 40);
    }

    return report;
}

export async function studyOfficialStories(
    opts: OfficialStoryRuntimeOptions & {
        selectors?: string[];
        kind?: "event" | "unit" | "card" | "area" | "special";
        unit?: string;
        char?: string;
        query?: string;
        sample?: number;
        includeMixed?: boolean;
    } = {},
): Promise<OfficialStudyKit> {
    const net = resolveNetOpts(opts);
    let selectors = opts.selectors?.filter(Boolean) ?? [];
    if (selectors.length === 0) {
        const sampleCount = Math.min(8, Math.max(1, opts.sample ?? 3));
        const discovered = await listOfficialEpisodes({ ...opts, limit: sampleCount });
        selectors = discovered.map((d) => d.selector);
    }
    if (selectors.length === 0) {
        throw new Error(
            "No matching official episodes found to study. Try broadening unit/char/query or specify selectors.",
        );
    }

    const capped = selectors.slice(0, 8);
    const reports: OfficialScenarioStudyReport[] = [];
    const errors: Array<{ selector: string; error: string }> = [];

    for (const sel of capped) {
        try {
            const rep = await inspectOfficialEpisode(sel, { ...opts, maxExamples: 2, includeTimeline: false });
            reports.push(rep);
        } catch (err) {
            errors.push({ selector: sel, error: err instanceof Error ? err.message : String(err) });
        }
    }
    if (reports.length === 0) {
        throw new Error(`All episodes failed to load: ${errors.map((e) => `${e.selector}: ${e.error}`).join("; ")}`);
    }

    let targetCharIds = opts.char ? resolveCharacterIds(opts.char) : [];
    if (targetCharIds.length === 0 && opts.unit) {
        const uk = resolveUnitKey(opts.unit);
        if (uk) {
            targetCharIds = CHARACTERS.filter((c) => c.unit === uk || c.unit === "piapro").map((c) => c.id);
        }
    }

    const kit = aggregateStudyReports(reports, targetCharIds);
    return { region: net.region, ...kit, errors };
}

export async function browseOfficialCatalog(
    subkind: "models" | "clips" | "bgm" | "bg" | "se" | "voices",
    arg: string | undefined,
    opts: OfficialStoryRuntimeOptions & {
        kind?: string;
        char?: string;
        search?: string;
        filter?: string;
        category?: string;
        type?: "all" | "motion" | "facial";
        v2Only?: boolean;
        includeCg?: boolean;
        limit?: number;
    } = {},
): Promise<OfficialCatalogResult> {
    const net = resolveNetOpts(opts);
    const limit = Math.min(120, Math.max(1, opts.limit ?? 40));
    const filterLower = (opts.filter || opts.search || "").trim().toLowerCase();

    if (subkind === "models") {
        const searchQuery = String(opts.search || opts.filter || arg || "").trim();
        const [coreModels, chara2ds, subGameChars] = await Promise.all([
            runWithStoryCoreLive2D(
                {
                    fetchImpl: opts.fetchImpl,
                    line: net.line,
                    bypassCache: net.noCache,
                    timeoutMs: HTTP_TIMEOUT_MS,
                },
                () => fetchLive2DModels(net.region),
            ),
            fetchMaster("character2ds.json", net).catch(() => []),
            fetchMaster("subGameCharacters.json", net).catch(() => []),
        ]);
        const models = normalizeCatalogModels(
            { models: coreModels, chara2ds, subGameChars },
            { region: net.region },
        );
        const filtered = filterAndRankCatalogModels(models, {
            kind: opts.kind,
            char: opts.char,
            search: searchQuery,
            v2Only: opts.v2Only,
        });
        return {
            kind: "models",
            region: net.region,
            source: "asset-site-listings",
            total: filtered.length,
            items: filtered.slice(0, limit),
        };
    }

    if (subkind === "clips") {
        const modelId = (arg ?? "").trim();
        if (!modelId) throw new Error("catalog clips requires arg=<modelId>");
        const candidates: string[] = [];
        const addCandidate = (asset: string) => {
            const clean = asset.trim().replace(/^\/+|\/+$/g, "");
            if (clean && !candidates.includes(clean)) candidates.push(clean);
        };
        if (modelId.startsWith("live2d/motion/")) {
            addCandidate(modelId);
        } else if (modelId.endsWith("_motion_base")) {
            addCandidate(`live2d/motion/${modelId}`);
        }
        for (const candidate of inferMotionBundleCandidates(modelId)) {
            addCandidate(candidate);
        }

        const resolved = await runWithStoryCoreLive2D(
            {
                fetchImpl: opts.fetchImpl,
                line: net.line,
                bypassCache: net.noCache,
                timeoutMs: HTTP_TIMEOUT_MS,
            },
            async () => {
                const sources = live2dSources(net.region, net.line);
                for (const bundle of candidates) {
                    try {
                        const clips = await fetchMotionBundleClips(sources, bundle);
                        return { bundle, clips };
                    } catch {
                        // try next candidate
                    }
                }
                return null;
            },
        );
        if (!resolved) {
            throw new Error(
                `Live2D motion .asset.json not found for '${modelId}' (tried: ${candidates.join(", ")}).`,
            );
        }
        const motions = filterLower
            ? resolved.clips.motions.filter((m) => m.toLowerCase().includes(filterLower))
            : resolved.clips.motions;
        const facials = filterLower
            ? resolved.clips.facials.filter((f) => f.toLowerCase().includes(filterLower))
            : resolved.clips.facials;
        const type = opts.type ?? "all";
        return {
            kind: "clips",
            region: net.region,
            modelId,
            motionBundle: resolved.bundle,
            totalMotions: motions.length,
            totalFacials: facials.length,
            motions: type === "facial" ? [] : motions.slice(0, limit),
            facials: type === "motion" ? [] : facials.slice(0, limit),
        };
    }

    if (subkind === "bgm") {
        const { list } = await loadBgmMetadata(net);
        const catLower = (opts.category ?? "").trim().toLowerCase();
        const filtered = list.filter((item) => {
            if (catLower && !item.category.toLowerCase().includes(catLower)) return false;
            if (filterLower) {
                const hay = `${item.name} ${item.title} ${item.category}`.toLowerCase();
                if (!hay.includes(filterLower)) return false;
            }
            return true;
        });
        return {
            kind: "bgm",
            region: net.region,
            total: filtered.length,
            items: filtered.slice(0, limit).map(({ name, title, category, mysekai }) => ({
                name,
                title,
                category,
                mysekai,
            })),
        };
    }

    if (subkind === "bg") {
        const { directories } = await fetchDirectoryListing("scenario/background/", net);
        const filtered = directories
            .filter((id) => id.startsWith("bg") && id !== "bg_a000000")
            .filter((id) => opts.includeCg || !isStoryCgBackground(id))
            .filter((id) => !filterLower || id.toLowerCase().includes(filterLower))
            .sort();
        return {
            kind: "bg",
            region: net.region,
            total: filtered.length,
            items: filtered.slice(0, limit).map((id) => ({
                id,
                isCg: isStoryCgBackground(id),
                webp: storageUrl(net.region, `scenario/background/${id}/${id}.webp`, net.line),
            })),
        };
    }

    if (subkind === "se") {
        const { allItems } = await loadSePackIndex(net);
        const filtered = allItems
            .filter((item) => !filterLower || item.path.toLowerCase().includes(filterLower))
            .sort((a, b) => a.label.localeCompare(b.label));
        return { kind: "se", region: net.region, total: filtered.length, items: filtered.slice(0, limit) };
    }

    const scenarioId = (arg ?? "").trim();
    const vkind = opts.kind ?? "story";
    const dirMap: Record<string, string> = {
        story: "sound/scenario/voice/",
        card: "sound/card_scenario/voice/",
        area: "sound/actionset/voice/",
        part: "sound/scenario/part_voice/",
    };
    const root = dirMap[vkind];
    if (!root) throw new Error(`Invalid voice kind '${vkind}' (expected story|card|area|part).`);
    if (!scenarioId) {
        const { directories } = await fetchDirectoryListing(root, net);
        const filtered = directories.filter((d) => !filterLower || d.toLowerCase().includes(filterLower)).sort();
        return { kind: "voices-scenarios", region: net.region, voiceKind: vkind, total: filtered.length, items: filtered.slice(0, limit) };
    }
    const { files } = await fetchDirectoryListing(`${root}${encodeURIComponent(scenarioId)}/`, net);
    const clips = files
        .map((f) => f.replace(AUDIO_EXT_RE, ""))
        .filter((c) => !filterLower || c.toLowerCase().includes(filterLower))
        .sort();
    return {
        kind: "voices",
        region: net.region,
        voiceKind: vkind,
        scenarioId,
        total: clips.length,
        items: clips.slice(0, limit).map((v) => `voice(${vkind}:${scenarioId}:${v}@${net.region})`),
    };
}

export async function mineOfficialStory(
    req: OfficialStoryMineRequest,
    runtimeOpts: OfficialStoryRuntimeOptions = {},
): Promise<OfficialStoryMineResult> {
    const base: OfficialStoryRuntimeOptions = {
        ...runtimeOpts,
        region: req.region ?? runtimeOpts.region ?? "jp",
    };

    switch (req.action) {
        case "study": {
            const data = await studyOfficialStories({
                ...base,
                unit: req.unit,
                char: req.char,
                kind: req.kind,
                query: req.query,
                selectors: req.selectors,
                sample: req.sample,
                includeMixed: req.includeMixed,
            });
            return { action: "study", data };
        }
        case "search-text": {
            const data = await searchOfficialStoryText(req.query, {
                ...base,
                kind: req.kind,
                char: req.char,
                regex: req.regex,
                limit: req.limit,
            });
            return { action: "search-text", data };
        }
        case "inspect": {
            const data = await inspectOfficialEpisode(req.selector, {
                ...base,
                translate: req.translate,
                includeTimeline: req.includeTimeline,
                lines: req.lines,
            });
            return { action: "inspect", data };
        }
        case "catalog": {
            const data = await browseOfficialCatalog(req.subkind, req.arg, {
                ...base,
                kind: req.kind,
                char: req.char,
                search: req.search,
                filter: req.filter,
                category: req.category,
                type: req.type,
                v2Only: req.v2Only,
                includeCg: req.includeCg,
                limit: req.limit,
            });
            return { action: "catalog", data };
        }
        case "list": {
            const data = await listOfficialEpisodes({
                ...base,
                kind: req.kind,
                unit: req.unit,
                char: req.char,
                query: req.query,
                includeMixed: req.includeMixed,
                oldest: req.oldest,
                limit: req.limit,
            });
            return { action: "list", data };
        }
    }
}

export function formatMineResultForAgent(result: OfficialStoryMineResult): string {
    if (result.action === "study") {
        const kit = result.data;
        const lines: string[] = [
            `=== Official Story Authoring Kit (region=${kit.region}, sampled=${kit.sources.length}) ===`,
            "Sources: " + kit.sources.map((s) => `${s.selector} (${s.storyTitle})`).join("; "),
            "\n[Verified @cast Models]",
        ];
        for (const c of kit.recommendedCast.slice(0, 14)) {
            lines.push(`  @cast ${c.shortKey} "${c.name}" model="${c.modelId}"${c.charId ? ` char=${c.charId}` : ""}`);
        }
        lines.push("\n[Verified Backgrounds]");
        for (const bg of kit.backgrounds.slice(0, 10)) {
            lines.push(`  - ${bg.id}${bg.isCg ? " [CG]" : ""}${bg.places.length ? ` (${bg.places.join(" / ")})` : ""}`);
        }
        lines.push("\n[Verified BGMs]");
        for (const b of kit.bgm.slice(0, 10)) {
            lines.push(`  - ${b.name}${b.title ? ` "${b.title}"` : ""}`);
        }
        lines.push("\n[Verified SE Clips]");
        for (const s of kit.se.slice(0, 12)) {
            const ex = s.examples[0];
            lines.push(`  - ${s.path}${ex ? ` | ${[ex.before, ex.after].filter(Boolean).join(" -> ")}` : ""}`);
        }
        lines.push("\n[Per-Character Authentic (motion, facial) Pairs]");
        for (const cc of kit.characterClips.slice(0, 8)) {
            lines.push(`  * ${cc.shortKey} (${cc.models.slice(0, 2).join(", ")}):`);
            for (const p of cc.pairs.slice(0, 6)) {
                const m = p.motion ? `motion="${p.motion}"` : "";
                const f = p.facial ? `facial="${p.facial}"` : "";
                lines.push(`      ${[m, f].filter(Boolean).join(" ")} (x${p.count})`);
            }
        }
        return lines.join("\n");
    }

    if (result.action === "search-text") {
        const r = result.data;
        const lines = [
            `=== Story Search (region=${r.region}, query="${r.query}", matchedChunks=${r.totalMatchingChunks}) ===`,
        ];
        for (const h of r.hits) {
            lines.push(`  - ${h.selector} | ${h.story} (ep ${h.ep}, lines ${h.lineRange})`);
            for (const ml of h.matchedLines) lines.push(`      ${truncate(ml, 100)}`);
        }
        return lines.join("\n");
    }

    if (result.action === "inspect") {
        const rep = result.data;
        const lines = [
            `=== Inspect ${rep.meta.selector} (${rep.meta.storyTitle} — ${rep.meta.episodeTitle}, ${rep.meta.talkCount} lines) ===`,
            "Cast: " + rep.cast.map((c) => `${c.shortKey}=${c.modelId}`).join(", "),
            "BGs: " + rep.backgrounds.map((b) => `${b.id}${b.places.length ? `(${b.places[0]})` : ""}`).join(", "),
            "BGMs: " + rep.bgm.map((b) => `${b.name}${b.title ? `(${b.title})` : ""}`).join(", "),
            "SEs: " + rep.se.slice(0, 10).map((s) => s.path).join(", "),
        ];
        for (const cc of rep.characterClips.slice(0, 8)) {
            const top = cc.pairs
                .slice(0, 5)
                .map((p) => [p.motion ? `m=${p.motion}` : "", p.facial ? `f=${p.facial}` : ""].filter(Boolean).join("/"))
                .join(", ");
            lines.push(`Clips[${cc.shortKey}]: ${top}`);
        }
        if (rep.timeline.length > 0) {
            lines.push("\n[Timeline Excerpt]");
            for (const ev of rep.timeline.slice(0, 30)) {
                lines.push(`  L${String(ev.talkLine ?? 0).padStart(3, " ")} [${String(ev.kind).toUpperCase()}] ${JSON.stringify(ev)}`);
            }
        }
        return lines.join("\n");
    }

    if (result.action === "list") {
        return result.data
            .map((it) => `${it.selector} | ${it.title}${it.unit ? ` (${it.unit})` : ""}`)
            .join("\n") || "(no matching official episodes)";
    }

    const cat = result.data;
    if (cat.kind === "models") {
        return [
            `=== Models (region=${cat.region}, total=${cat.total}, shown=${cat.items.length}) ===`,
            ...cat.items.map((m) => `  - ${m.id} [${m.kind}${m.characterId ? ` char=${m.characterId}` : ""}] ${m.name}`),
        ].join("\n");
    }
    if (cat.kind === "clips") {
        return [
            `=== Clips for ${cat.modelId} (bundle=${cat.motionBundle}) ===`,
            `Motions (${cat.motions.length}/${cat.totalMotions}): ${cat.motions.join(", ")}`,
            `Facials (${cat.facials.length}/${cat.totalFacials}): ${cat.facials.join(", ")}`,
        ].join("\n");
    }
    if (cat.kind === "bgm") {
        return [
            `=== BGM (total=${cat.total}) ===`,
            ...cat.items.map((b) => `  - ${b.name} | ${b.title}${b.category ? ` [${b.category}]` : ""}`),
        ].join("\n");
    }
    if (cat.kind === "bg") {
        return [
            `=== Backgrounds (total=${cat.total}) ===`,
            ...cat.items.map((b) => `  - ${b.id}${b.isCg ? " [CG]" : ""}`),
        ].join("\n");
    }
    if (cat.kind === "se") {
        return [
            `=== SE Clips (total=${cat.total}) ===`,
            ...cat.items.map((s) => `  - ${s.path}`),
        ].join("\n");
    }
    return [
        `=== Voices (${cat.kind}, total=${cat.total}) ===`,
        ...cat.items.map((v) => `  - ${v}`),
    ].join("\n");
}
