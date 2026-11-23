import { storyMakerMessages as zhCNStoryMaker, studioMessages as zhCNStudio } from "./zh-CN";
import { storyMakerMessages as zhTWStoryMaker, studioMessages as zhTWStudio } from "./zh-TW";
import { storyMakerMessages as enUSStoryMaker, studioMessages as enUSStudio } from "./en-US";
import { storyMakerMessages as jaJPStoryMaker, studioMessages as jaJPStudio } from "./ja-JP";
import { storyMakerMessages as koKRStoryMaker, studioMessages as koKRStudio } from "./ko-KR";

export type StoryStudioLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR";
export type MessageInterpolationValue = string | number | boolean | null | undefined;
export type MessageInterpolationValues = Record<string, MessageInterpolationValue>;
export type StudioTranslateFn = (key: string, values?: MessageInterpolationValues) => string;

export interface MessageTree {
    [key: string]: string | MessageTree;
}

export const STORY_MAKER_MESSAGES_BY_LOCALE: Record<StoryStudioLocale, typeof zhCNStoryMaker> = {
    "zh-CN": zhCNStoryMaker,
    "zh-TW": zhTWStoryMaker,
    "en-US": enUSStoryMaker,
    "ja-JP": jaJPStoryMaker,
    "ko-KR": koKRStoryMaker,
};

export const STUDIO_MESSAGES_BY_LOCALE: Record<StoryStudioLocale, typeof zhCNStudio> = {
    "zh-CN": zhCNStudio,
    "zh-TW": zhTWStudio,
    "en-US": enUSStudio,
    "ja-JP": jaJPStudio,
    "ko-KR": koKRStudio,
};

export function normalizeStudioLocale(locale?: string | null): StoryStudioLocale {
    if (!locale) return "zh-CN";
    const lower = locale.trim().toLowerCase();
    if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-hant" || lower.startsWith("zh-hant-")) return "zh-TW";
    if (lower === "zh-cn" || lower.startsWith("zh")) return "zh-CN";
    if (lower === "en-us" || lower.startsWith("en")) return "en-US";
    if (lower === "ja-jp" || lower.startsWith("ja")) return "ja-JP";
    if (lower === "ko-kr" || lower.startsWith("ko")) return "ko-KR";
    return "zh-CN";
}

export function getStudioMessageByPath(messages: MessageTree, key: string): string | null {
    const value = key.split(".").reduce<unknown>((current, segment) => {
        if (current && typeof current === "object" && segment in current) {
            return (current as Record<string, unknown>)[segment];
        }
        return undefined;
    }, messages);
    return typeof value === "string" ? value : null;
}

export function interpolateStudioMessage(template: string, values?: MessageInterpolationValues): string {
    if (!values) return template;
    return template.replace(/\{([\w.-]+)\}/g, (match, token: string) => {
        const value = values[token];
        return value === null || value === undefined ? match : String(value);
    });
}

export function createStudioTranslator(locale: string = "zh-CN"): StudioTranslateFn {
    const normalized = normalizeStudioLocale(locale);
    const primary = STUDIO_MESSAGES_BY_LOCALE[normalized] as unknown as MessageTree;
    const fallback = STUDIO_MESSAGES_BY_LOCALE["zh-CN"] as unknown as MessageTree;

    return (key: string, values?: MessageInterpolationValues): string => {
        const template = getStudioMessageByPath(primary, key) ?? getStudioMessageByPath(fallback, key);
        if (template === null) return key;
        return interpolateStudioMessage(template, values);
    };
}

export {
    zhCNStoryMaker,
    zhTWStoryMaker,
    enUSStoryMaker,
    jaJPStoryMaker,
    koKRStoryMaker,
    zhCNStudio,
    zhTWStudio,
    enUSStudio,
    jaJPStudio,
    koKRStudio,
};
