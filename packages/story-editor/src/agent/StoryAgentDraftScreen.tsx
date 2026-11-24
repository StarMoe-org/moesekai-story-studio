import React, { useEffect, useState } from "react";
import { useStoryI18n, useStoryStudio } from "../context/StoryStudioContext";
import { Button, IconButton, LoadingState } from "../md3";
import { mdArrowBack, mdPlayArrowFill } from "../md3/icons";
import { StoryStudioPlayer } from "../studio/StoryStudioPlayer";
import { StoryAgentPanel, type StoryAgentPanelProps } from "./StoryAgentPanel";
import { draftAgentTarget, type StoryAgentTarget } from "./target";

export interface StoryAgentDraftScreenProps extends Pick<StoryAgentPanelProps, "decodeBrotli" | "officialStoryCache"> {
    draftId: string;
    backToDraftsHref: string;
}

/** A play-through opened over the chat; `key` remounts the player so it reloads the saved draft. */
interface Preview {
    key: number;
    startNodeId: string | null;
}

/**
 * The agent on a phone, where the editor does not run: a full-screen chat over a stored draft.
 * Each edit is saved to the draft; the story, or any node the agent touched, plays over the chat
 * without leaving it.
 */
export function StoryAgentDraftScreen({ draftId, backToDraftsHref, decodeBrotli, officialStoryCache }: StoryAgentDraftScreenProps) {
    const { t } = useStoryI18n();
    const { storage } = useStoryStudio();
    const [target, setTarget] = useState<StoryAgentTarget | null>(null);
    const [title, setTitle] = useState("");
    const [missing, setMissing] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null);

    useEffect(() => {
        let cancelled = false;
        void storage.getDraft(draftId).then((found) => {
            if (cancelled) return;
            if (!found) {
                setMissing(true);
                return;
            }
            setTitle(found.doc.meta.title);
            setTarget(draftAgentTarget(storage, draftId, found.doc, doc => setTitle(doc.meta.title)));
        });
        return () => {
            cancelled = true;
        };
    }, [storage, draftId]);

    const play = (startNodeId: string | null) => setPreview({ key: Date.now(), startNodeId });

    if (missing) {
        return (
            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
                <p className="type-body-m text-on-surface-variant">{t("page.storyMaker.agent.draftMissing")}</p>
                <Button variant="filled" icon={mdArrowBack} href={backToDraftsHref}>
                    {t("page.storyMaker.action.backToDrafts")}
                </Button>
            </div>
        );
    }
    if (!target) return <LoadingState />;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-surface-container-low pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
            <header className="flex items-center gap-1 border-b border-outline-variant/40 px-2 py-1.5">
                <IconButton icon={mdArrowBack} label={t("page.storyMaker.action.backToDrafts")} size="s" href={backToDraftsHref} />
                <span className="type-title-s flex-1 truncate">{title || t("page.storyMaker.untitled")}</span>
                <Button variant="tonal" size="xs" icon={mdPlayArrowFill} onClick={() => play(null)}>
                    {t("page.storyMaker.action.play")}
                </Button>
            </header>
            <div className="min-h-0 flex-1">
                <StoryAgentPanel
                    target={target}
                    layout="page"
                    onOpenNode={play}
                    decodeBrotli={decodeBrotli}
                    officialStoryCache={officialStoryCache}
                />
            </div>
            {preview && (
                <div className="fixed inset-0 z-[200] overflow-y-auto bg-surface">
                    <StoryStudioPlayer
                        key={preview.key}
                        draftId={draftId}
                        startNodeId={preview.startNodeId}
                        onBackToDrafts={() => setPreview(null)}
                        onEditDraft={() => setPreview(null)}
                        homeHref={null}
                    />
                </div>
            )}
        </div>
    );
}
