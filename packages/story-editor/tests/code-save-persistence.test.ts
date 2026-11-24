import { describe, expect, test } from "bun:test";
import {
    createStoryDocument,
    parseStoryScript,
    serializeStoryScript,
    type StoryDocument,
} from "@moesekai/story-core";
import {
    STORY_MAKER_MESSAGES_BY_LOCALE,
    createStudioTranslator,
    type StoryStudioLocale,
} from "../src/messages";
import {
    mergeIncomingStoryDoc,
    resolveEffectiveSaveStatus,
} from "../src/studio/StoryStudioEditor";

const ALL_LOCALES: StoryStudioLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    const out: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === "object" && !Array.isArray(val)) {
            out.push(...flattenKeys(val as Record<string, unknown>, path));
        } else {
            out.push(path);
        }
    }
    return out.sort();
}

describe("Code Mode & Save Persistence Contracts", () => {
    test("mergeIncomingStoryDoc preserves currentDoc.id when edited .msk omits id= or carries a foreign id=", () => {
        const currentDoc: StoryDocument = {
            ...createStoryDocument("jp", "Original Title"),
            id: "proj_a1b2c3d4e5f6",
            sourceLocale: "zh-CN",
            locales: {
                "en-US": {
                    schema: "moesekai-story-i18n/1",
                    storyId: "proj_a1b2c3d4e5f6",
                    locale: "en-US",
                    translationMeta: { origin: "human" },
                    beats: {},
                },
            },
        };

        // Case 1: User pastes or edits .msk code without id="..."
        const noIdParsed = parseStoryScript(`@story "Edited Without Id" region=jp

start -> s1

scene s1 "Opening" {
  bg clear
  bgm stop
  place hide
  transition fadeBlack 0.5
  cast clear
  talk "Minori" "我们都在期待着大家的精彩原创故事哦！"
}
`);
        expect(noIdParsed.ok).toBe(true);
        if (!noIdParsed.ok) return;
        expect(noIdParsed.doc.id).not.toBe(currentDoc.id);

        const mergedNoId = mergeIncomingStoryDoc(currentDoc, noIdParsed.doc, { preserveLocales: true });
        expect(mergedNoId.id).toBe("proj_a1b2c3d4e5f6");
        expect(mergedNoId.meta.title).toBe("Edited Without Id");
        expect(mergedNoId.sourceLocale).toBe("zh-CN");
        expect(mergedNoId.locales?.["en-US"]).toBeDefined();

        // Case 2: External script / AI code carries a different id="starter_v2"
        const foreignIdParsed = parseStoryScript(`@story "Foreign Id" region=jp id="starter_v2"

start -> s1

scene s1 "Opening" {
  bg clear
  bgm stop
  place hide
  transition fadeBlack 0.5
  cast clear
  narration "Edited via code"
}
`);
        expect(foreignIdParsed.ok).toBe(true);
        if (!foreignIdParsed.ok) return;
        expect(foreignIdParsed.doc.id).toBe("starter_v2");

        const mergedForeign = mergeIncomingStoryDoc(currentDoc, foreignIdParsed.doc, { preserveLocales: true });
        expect(mergedForeign.id).toBe("proj_a1b2c3d4e5f6");
        expect(mergedForeign.meta.title).toBe("Foreign Id");

        // Serialized script round-trips with the preserved workspace project id
        const serialized = serializeStoryScript(mergedForeign);
        expect(serialized).toContain('id="proj_a1b2c3d4e5f6"');

        // Case 3: Importing into current draft (preserveLocales: false) STILL preserves currentDoc.id
        const mergedImport = mergeIncomingStoryDoc(currentDoc, foreignIdParsed.doc, { preserveLocales: false });
        expect(mergedImport.id).toBe("proj_a1b2c3d4e5f6");
        expect(mergedImport.locales).toBeUndefined();
        expect(mergedImport.sourceLocale).toBeUndefined();

        // Case 4: No currentDoc returns nextDoc as-is
        expect(mergeIncomingStoryDoc(null, foreignIdParsed.doc)).toBe(foreignIdParsed.doc);
    });

    test("resolveEffectiveSaveStatus reflects live uncommitted Code mode edits and prioritizes error/saving", () => {
        expect(resolveEffectiveSaveStatus("saved", false)).toBe("saved");
        expect(resolveEffectiveSaveStatus("saved", true)).toBe("dirty");
        expect(resolveEffectiveSaveStatus("dirty", false)).toBe("dirty");
        expect(resolveEffectiveSaveStatus("dirty", true)).toBe("dirty");
        expect(resolveEffectiveSaveStatus("saving", false)).toBe("saving");
        expect(resolveEffectiveSaveStatus("saving", true)).toBe("saving");
        expect(resolveEffectiveSaveStatus("error", false)).toBe("error");
        expect(resolveEffectiveSaveStatus("error", true)).toBe("error");
    });

    test("all 5 locales define codeBlockedSave and maintain identical message key trees", () => {
        const baseKeys = flattenKeys(STORY_MAKER_MESSAGES_BY_LOCALE["zh-CN"] as unknown as Record<string, unknown>);
        for (const locale of ALL_LOCALES) {
            const keys = flattenKeys(STORY_MAKER_MESSAGES_BY_LOCALE[locale] as unknown as Record<string, unknown>);
            expect(keys).toEqual(baseKeys);
            const t = createStudioTranslator(locale);
            const blocked = t("page.storyMaker.v2.mode.codeBlockedSave");
            expect(blocked.length).toBeGreaterThan(0);
            expect(blocked).not.toBe("page.storyMaker.v2.mode.codeBlockedSave");
        }
    });
});
