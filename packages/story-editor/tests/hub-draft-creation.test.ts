import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStoryDocument, type StoryDraft } from "@moesekai/story-core";
import { prependStoryDraft } from "../src/studio/StoryStudioHub";

const EDITOR_SRC = join(import.meta.dir, "..", "src");

function makeDraft(id: string, title: string, timestamp: number): StoryDraft {
    return {
        id,
        doc: createStoryDocument("jp", title),
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

describe("StoryStudioHub draft creation & modal navigation invariants", () => {
    test("prependStoryDraft inserts a new draft at the front without mutating previous list", () => {
        const existing = [
            makeDraft("draft-1", "Existing One", 1000),
            makeDraft("draft-2", "Existing Two", 900),
        ];
        const created = makeDraft("draft-3", "Brand New Story", 2000);

        const next = prependStoryDraft(existing, created);

        expect(next.map(item => item.id)).toEqual(["draft-3", "draft-1", "draft-2"]);
        expect(existing.map(item => item.id)).toEqual(["draft-1", "draft-2"]);
    });

    test("prependStoryDraft deduplicates an existing draft id while moving it to the front", () => {
        const existing = [
            makeDraft("draft-1", "First", 1000),
            makeDraft("draft-2", "Old Copy", 900),
        ];
        const updated = makeDraft("draft-2", "Updated Copy", 2000);

        const next = prependStoryDraft(existing, updated);

        expect(next.map(item => item.id)).toEqual(["draft-2", "draft-1"]);
        expect(next[0]?.doc.meta.title).toBe("Updated Copy");
    });

    test("hub create/import dialogs disable history sync so closing does not unwind router navigation", () => {
        const hubSrc = readFileSync(join(EDITOR_SRC, "studio", "StoryStudioHub.tsx"), "utf8");
        const metaDialogSrc = readFileSync(join(EDITOR_SRC, "components", "StoryMetaDialog.tsx"), "utf8");
        const importDialogSrc = readFileSync(join(EDITOR_SRC, "components", "StoryImportDialog.tsx"), "utf8");

        // Dialog wrappers must forward syncHistory to MD3 Dialog.
        expect(metaDialogSrc).toContain("syncHistory?: boolean;");
        expect(metaDialogSrc).toContain("syncHistory={syncHistory}");
        expect(importDialogSrc).toContain("syncHistory?: boolean;");
        expect(importDialogSrc).toContain("syncHistory={syncHistory}");

        // StoryStudioHub must pass syncHistory={false} on both dialogs that navigate to the editor on submit.
        const metaBlock = hubSrc.match(/<StoryMetaDialog[\s\S]*?\/>/)?.[0] ?? "";
        const importBlock = hubSrc.match(/<StoryImportDialog[\s\S]*?\/>/)?.[0] ?? "";
        expect(metaBlock).toContain("syncHistory={false}");
        expect(importBlock).toContain("syncHistory={false}");

        // handleCreate, handleCreateStarter, and handleImport all update local drafts state immediately.
        const createBlock = hubSrc.match(/const handleCreate = async[\s\S]*?^\s{4}\};/m)?.[0] ?? "";
        const starterBlock = hubSrc.match(/const handleCreateStarter = async[\s\S]*?^\s{4}\};/m)?.[0] ?? "";
        const importHandlerBlock = hubSrc.match(/const handleImport = async[\s\S]*?^\s{4}\};/m)?.[0] ?? "";
        expect(createBlock).toContain("prependStoryDraft(previous, created)");
        expect(starterBlock).toContain("prependStoryDraft(previous, created)");
        expect(importHandlerBlock).toContain("prependStoryDraft(previous, created)");

        // BFCache return from editor refreshes drafts automatically.
        expect(hubSrc).toContain('window.addEventListener("pageshow", handlePageShow)');
        expect(hubSrc).toContain("event.persisted");
    });
});
