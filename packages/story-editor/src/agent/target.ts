import { useMemo } from "react";
import { parseStoryScript, type StoryDocument, type StoryDraftStorageAdapter } from "@moesekai/story-core";
import type { StoryAgentPromptContext, StoryEditorAction } from "@moesekai/story-agent/browser";
import type { StoryNodeChange, StoryStudioEditorHandle } from "../studio/editorTypes";

/**
 * The story an agent panel works on: the live editor on a desktop screen, or a stored draft
 * on a phone, where the editor does not run.
 */
export interface StoryAgentTarget {
    /** Which story this is (a draft id); conversations are kept per story. */
    readonly storyKey: string;
    /** The story as the user has it now; null while it loads. */
    currentDoc(): StoryDocument | null;
    /** Takes the agent's edited script as the new story. */
    applyScript(script: string): void;
    /** What the user is looking at, sent along with each request. */
    promptContext(): StoryAgentPromptContext;
    /** Marks the nodes the agent touched; null clears the marks. */
    showNodeChanges?(changes: ReadonlyMap<string, StoryNodeChange> | null): void;
    focusNode?(nodeId: string): void;
    runEditorAction?(action: StoryEditorAction): void;
}

function runEditorAction(editor: StoryStudioEditorHandle, action: StoryEditorAction): void {
    switch (action.kind) {
        case "focus_node":
            editor.focusNode(action.nodeId);
            break;
        case "select_beat":
            editor.selectBeat(action.nodeId, action.beatId);
            break;
        case "switch_mode":
            editor.setWorkspaceMode(action.mode === "flow" ? "edit" : action.mode);
            break;
        case "playtest_from_node":
            editor.playtestFromNode(action.nodeId);
            break;
        case "open_export_dialog":
            editor.openExportDialog();
            break;
    }
}

/**
 * The live editor, reached through `getEditor` (e.g. `() => editorRef.current`): edits land on
 * its undo stack and touched nodes are marked on the Flow Canvas.
 */
export function editorAgentTarget(storyKey: string, getEditor: () => StoryStudioEditorHandle | null): StoryAgentTarget {
    return {
        storyKey,
        currentDoc: () => getEditor()?.getEffectiveDoc() ?? null,
        applyScript: (script) => {
            getEditor()?.reloadFromScript(script, { preserveSelection: true, markSaved: false });
        },
        promptContext: () => {
            const editor = getEditor();
            if (!editor) return {};
            return {
                selectedNodeId: editor.getSelectedNodeId(),
                selectedBeatId: editor.getSelectedBeatId(),
                activeMode: editor.getWorkspaceMode(),
            };
        },
        showNodeChanges: (changes) => getEditor()?.showNodeChanges(changes),
        focusNode: (nodeId) => getEditor()?.focusNode(nodeId),
        runEditorAction: (action) => {
            const editor = getEditor();
            if (editor) runEditorAction(editor, action);
        },
    };
}

/** `editorAgentTarget` for an editor ref; the ref is read only when the agent acts, never during render. */
export function useEditorAgentTarget(
    editorRef: React.RefObject<StoryStudioEditorHandle | null>,
    storyKey: string,
): StoryAgentTarget {
    return useMemo(() => editorAgentTarget(storyKey, () => editorRef.current), [editorRef, storyKey]);
}

/** A stored draft, edited without the editor: each agent edit is saved straight back to storage. */
export function draftAgentTarget(
    storage: StoryDraftStorageAdapter,
    draftId: string,
    initialDoc: StoryDocument,
    onSaved: (doc: StoryDocument) => void,
): StoryAgentTarget {
    let doc = initialDoc;
    return {
        storyKey: draftId,
        currentDoc: () => doc,
        applyScript: (script) => {
            const parsed = parseStoryScript(script);
            if (!parsed.ok) return;
            doc = parsed.doc;
            void storage.saveDraft(draftId, parsed.doc).then(() => onSaved(parsed.doc));
        },
        promptContext: () => ({}),
    };
}
