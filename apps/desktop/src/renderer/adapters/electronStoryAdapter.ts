import {
    parseStoryScript,
    serializeStoryScript,
    type StoryDocument,
    type StoryDraft,
    type StoryDraftExternalChangeEvent,
    type StoryDraftStorageAdapter,
    type StoryExportAdapter,
    type StoryLocalePack,
    type StoryVoiceManifest,
    type UiLocale,
} from "@moesekai/story-core";
import type { MoesekaiDesktopApi, WorkspaceProjectData } from "../../shared/ipc";

function parseProjectToDraft(project: WorkspaceProjectData): StoryDraft {
    const parsed = parseStoryScript(project.script);
    if (!parsed.ok) {
        const first = parsed.diagnostics[0];
        throw new Error(
            `Failed to parse ${project.storyFileName}: ${first ? `${first.line}:${first.col} ${first.message}` : "syntax error"}`,
        );
    }

    const doc: StoryDocument = {
        ...parsed.doc,
        id: project.id,
        locales: {
            ...(parsed.doc.locales ?? {}),
            ...(project.locales as Partial<Record<UiLocale, StoryLocalePack>>),
        },
    };

    return {
        id: project.id,
        doc,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

export interface ElectronStoryAdapterCallbacks {
    onSaved?: (savedAt: number, doc: StoryDocument) => void;
    onOpenExportDialog?: (defaultMode?: "msk" | "bundle-zip" | "locales") => void;
    getVoiceManifest?: () => StoryVoiceManifest | null;
}

/**
 * Implements `@moesekai/story-core`'s `StoryDraftStorageAdapter` directly against
 * Electron's native local `.msk` workspace IPC (`window.moesekaiDesktop.workspace`).
 */
export function createElectronStoryStorageAdapter(
    desktop: MoesekaiDesktopApi,
    callbacks: ElectronStoryAdapterCallbacks = {},
): StoryDraftStorageAdapter {
    return {
        async listDrafts(): Promise<StoryDraft[]> {
            const active = await desktop.workspace.getActive();
            if (!active) return [];
            return [parseProjectToDraft(active)];
        },

        async getDraft(id: string): Promise<StoryDraft | null> {
            const active = await desktop.workspace.getActive();
            if (!active) return null;
            if (id && active.id !== id) {
                return null;
            }
            return parseProjectToDraft(active);
        },

        async createDraft(doc: StoryDocument): Promise<StoryDraft> {
            const script = serializeStoryScript(doc);
            const created = await desktop.workspace.pickAndCreate({
                title: doc.meta.title || "Untitled Story",
                region: doc.region,
                initialScript: script,
                sourceLocale: doc.sourceLocale,
            });
            if (!created) {
                throw new Error("Project creation canceled.");
            }
            return parseProjectToDraft(created);
        },

        async saveDraft(id: string, doc: StoryDocument): Promise<StoryDraft> {
            const activeBefore = await desktop.workspace.getActive();
            if (!activeBefore || (id && activeBefore.id !== id)) {
                throw new Error("Active workspace changed; skipping stale save.");
            }
            const script = serializeStoryScript(doc);
            const locales: Record<string, unknown> = {};
            if (doc.locales) {
                for (const [k, pack] of Object.entries(doc.locales)) {
                    if (pack) locales[k] = pack;
                }
            }
            const voiceManifest = callbacks.getVoiceManifest ? callbacks.getVoiceManifest() : undefined;
            const res = await desktop.workspace.save({
                script,
                locales,
                ...(voiceManifest !== undefined ? { voiceManifest } : {}),
            });
            callbacks.onSaved?.(res.savedAt, doc);
            return {
                id: activeBefore.id,
                doc,
                createdAt: activeBefore.createdAt,
                updatedAt: res.savedAt,
            };
        },

        async renameDraft(id: string, title: string): Promise<StoryDraft | null> {
            const current = await this.getDraft(id);
            if (!current) return null;
            const updatedDoc: StoryDocument = {
                ...current.doc,
                meta: { ...current.doc.meta, title },
            };
            return this.saveDraft(id, updatedDoc);
        },

        async duplicateDraft(id: string, titleSuffix: string): Promise<StoryDraft | null> {
            const current = await this.getDraft(id);
            if (!current) return null;
            const copyDoc: StoryDocument = {
                ...current.doc,
                meta: {
                    ...current.doc.meta,
                    title: `${current.doc.meta.title}${titleSuffix}`,
                },
            };
            return this.createDraft(copyDoc);
        },

        async deleteDraft(): Promise<void> {
            await desktop.workspace.close();
        },

        watchExternalChanges(
            draftId: string,
            listener: (event: StoryDraftExternalChangeEvent) => void,
        ): () => void {
            return desktop.workspace.onExternalChange(change => {
                const parsed = parseStoryScript(change.script);
                const doc = parsed.ok
                    ? ({
                        ...parsed.doc,
                        id: draftId,
                        locales: {
                            ...(parsed.doc.locales ?? {}),
                            ...(change.locales as Partial<Record<UiLocale, StoryLocalePack>>),
                        },
                    } satisfies StoryDocument)
                    : undefined;

                listener({
                    draftId,
                    kind:
                        change.kind === "locales"
                            ? "locales-updated"
                            : change.kind === "voice-manifest"
                                ? "voices-updated"
                                : "updated",
                    script: change.script,
                    doc,
                    timestamp: change.changedAt,
                });
            });
        },
    };
}

/**
 * Implements `@moesekai/story-core`'s `StoryExportAdapter` using Electron's native Save dialogs
 * & preflight-checked export pipeline.
 */
export function createElectronStoryExportAdapter(
    desktop: MoesekaiDesktopApi,
    callbacks: ElectronStoryAdapterCallbacks = {},
): StoryExportAdapter {
    return {
        async exportMsk(doc, options) {
            const script = serializeStoryScript(doc);
            const res = await desktop.exporter.exportMsk({
                script,
                includePositions: !options?.stripPositions,
                suggestedFileName: doc.meta.title || doc.id,
            });
            if (res.canceled) {
                return { ok: false, canceled: true };
            }
            return {
                ok: true,
                outputPath: res.outputPath,
                byteLength: res.bytesWritten,
            };
        },

        async exportLocalePack(_doc, pack) {
            const res = await desktop.exporter.exportLocales({
                locales: { [pack.locale]: pack },
            });
            if (res.canceled) {
                return { ok: false, canceled: true };
            }
            return {
                ok: true,
                outputPath: res.outputPath,
                byteLength: res.bytesWritten,
            };
        },

        async exportFullBundle(doc, options) {
            const script = serializeStoryScript(doc);
            const locales: Record<string, unknown> = {};
            if (options?.includeLocales !== false && doc.locales) {
                for (const [k, pack] of Object.entries(doc.locales)) {
                    if (pack) locales[k] = pack;
                }
            }
            const res = await desktop.exporter.exportBundle({
                script,
                includePositions: !options?.stripPositions,
                format: options?.format === "directory" ? "folder" : "zip",
                locales,
                voiceManifest: options?.voiceManifest ?? callbacks.getVoiceManifest?.() ?? null,
                suggestedName: doc.meta.title || doc.id,
            });
            if (res.canceled) {
                return { ok: false, canceled: true };
            }
            return {
                ok: true,
                outputPath: res.outputPath,
                byteLength: res.bytesWritten,
            };
        },

        async exportVoiceManifest(_doc, manifest) {
            const res = await desktop.exporter.exportLocales({
                locales: {},
                voiceManifest: manifest,
            });
            if (res.canceled) {
                return { ok: false, canceled: true };
            }
            return {
                ok: true,
                outputPath: res.outputPath,
                byteLength: res.bytesWritten,
            };
        },
    };
}
