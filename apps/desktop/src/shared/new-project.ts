import {
    createStarterStoryFromScript,
    createStoryDocument,
    newStoryId,
    serializeStoryScript,
    type StarterLocale,
    type StoryDocument,
} from "@moesekai/story-core";
import type { DesktopStoryRegion, DesktopUiLocale } from "./ipc.ts";

export type NewProjectTemplate = "blank" | "starter";

export interface BuildNewProjectInput {
    title: string;
    region: DesktopStoryRegion;
    locale: DesktopUiLocale;
    template?: NewProjectTemplate;
}

export interface BuiltNewProject {
    doc: StoryDocument;
    script: string;
}

function toStarterLocale(locale: DesktopUiLocale): StarterLocale {
    if (locale === "en-US" || locale === "ko-KR") return "en";
    if (locale === "ja-JP") return "ja";
    return "zh";
}

/**
 * Builds an isolated initial `StoryDocument` + serialized `.msk` script for a new project.
 *
 * Defaults strictly to `"blank"` (`createStoryDocument`) with a fresh unique `id`,
 * 0 cast, 0 variables, and only the mandatory `start` node so starter sample content
 * never leaks into user-created projects.
 */
export function buildNewProjectDocument(input: BuildNewProjectInput): BuiltNewProject {
    const cleanTitle = input.title.trim() || "Untitled Story";
    const template: NewProjectTemplate = input.template ?? "blank";
    const freshId = newStoryId([], 10);

    if (template === "starter") {
        const baseStarter = createStarterStoryFromScript(input.region, toStarterLocale(input.locale));
        const doc: StoryDocument = {
            ...baseStarter,
            id: freshId,
            sourceLocale: input.locale,
            meta: {
                ...baseStarter.meta,
                title: cleanTitle,
            },
        };
        return {
            doc,
            script: serializeStoryScript(doc),
        };
    }

    const baseBlank = createStoryDocument(input.region, cleanTitle);
    const doc: StoryDocument = {
        ...baseBlank,
        id: freshId,
        sourceLocale: input.locale,
        meta: {
            title: cleanTitle,
            summary: "",
            author: "",
        },
    };
    return {
        doc,
        script: serializeStoryScript(doc),
    };
}
