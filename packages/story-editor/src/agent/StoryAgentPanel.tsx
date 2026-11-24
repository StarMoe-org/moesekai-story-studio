import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    listBrowserAgentModels,
    type BrotliDecoder,
    type BrowserAgentProviderId,
    type OfficialStoryCache,
    type StoryAuthoringMode,
    type StoryMskDiff,
} from "@moesekai/story-agent/browser";
import { useStoryI18n } from "../context/StoryStudioContext";
import { Button, Icon, IconButton, SegmentedButton, Select, TextField, cn } from "../md3";
import { isKeyboardEventComposing } from "../md3/shortcuts";
import {
    mdAdd, mdBuild, mdCheckCircle, mdClose, mdDelete, mdError, mdHistory, mdSend, mdSettings, mdStopFill,
    mdUnfoldLess, mdUndo, mdVisibilityOff, mdWandStars,
} from "../md3/icons";
import { AgentMarkdown } from "./AgentMarkdown";
import type { AgentTurn, AgentTurnItem } from "./agentTurns";
import type { StoredConversation } from "./conversationArchive";
import type { StoryAgentDesk } from "./storyAgentDesk";
import type { StoryAgentTarget } from "./target";
import { useStoryAgentDesk } from "./useStoryAgentDesk";

const PROVIDER: BrowserAgentProviderId = "deepseek";
const STORAGE_PREFIX = `moesekai.storyAgent.${PROVIDER}`;

function useStoredString(key: string, fallback: string): [string, (value: string) => void] {
    const [value, setValue] = useState(() => {
        try {
            return localStorage.getItem(key) ?? fallback;
        } catch {
            return fallback;
        }
    });
    const store = (next: string) => {
        setValue(next);
        try {
            if (next) localStorage.setItem(key, next);
            else localStorage.removeItem(key);
        } catch {
            // Private mode or quota: the value still holds for this page.
        }
    };
    return [value, store];
}

/** `12345` → `12.3k`. */
function formatTokens(tokens: number): string {
    return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;
}

export interface StoryAgentPanelProps {
    /** The story the agent reads from and writes into; keep it stable across renders. */
    target: StoryAgentTarget;
    /** `docked` beside the editor, or `page` filling a phone screen. */
    layout?: "docked" | "page";
    /** Opens a node the agent touched; defaults to focusing it in the target. */
    onOpenNode?: (nodeId: string) => void;
    /** Brotli decoder for official story assets, for browsers without `DecompressionStream("brotli")`. */
    decodeBrotli?: BrotliDecoder;
    officialStoryCache?: OfficialStoryCache;
    onClose?: () => void;
    className?: string;
}

type Drawer = "settings" | "history" | null;

/**
 * A chat panel that lets a story agent edit the open draft. The model is called from the page
 * with the user's own API key, kept in this browser's local storage. Conversations belong to the
 * story, not to the panel: they survive the panel closing, the page reloading, and the editor
 * giving way to the phone screen.
 */
export function StoryAgentPanel({
    target,
    layout = "docked",
    onOpenNode = target.focusNode,
    decodeBrotli,
    officialStoryCache,
    onClose,
    className,
}: StoryAgentPanelProps) {
    const { t, locale } = useStoryI18n();
    const models = useMemo(() => listBrowserAgentModels(PROVIDER), []);
    const [apiKey, setApiKey] = useStoredString(`${STORAGE_PREFIX}.apiKey`, "");
    const [chosenModel, setModel] = useStoredString(`${STORAGE_PREFIX}.model`, "");
    const [chosenThinking, setThinking] = useStoredString(`${STORAGE_PREFIX}.thinking`, "");
    // A stored model that is no longer offered gives the first one.
    const modelInfo = models.find(m => m.id === chosenModel) ?? models[0];
    const model = modelInfo?.id ?? "";
    // A choice the model does not accept (kept for when another model is picked) gives its default.
    const thinkingLevel = modelInfo?.thinkingLevels.find(level => level === chosenThinking) ?? modelInfo?.defaultThinkingLevel;
    const [drawer, setDrawer] = useState<Drawer>(apiKey ? null : "settings");
    const [draft, setDraft] = useState("");
    const config = useMemo(
        () => ({ provider: PROVIDER, model, apiKey, thinkingLevel, decodeBrotli, officialStoryCache }),
        [model, apiKey, thinkingLevel, decodeBrotli, officialStoryCache],
    );
    const [state, desk] = useStoryAgentDesk(target, config);
    const { conversation, busy } = state;
    const transcriptEnd = useRef<HTMLDivElement>(null);
    // Re-read with every turn change, since the agent's edits add nodes.
    const nodeIds = useMemo(() => new Set(Object.keys(target.currentDoc()?.nodes ?? {})), [target, conversation.turns]);

    useEffect(() => {
        transcriptEnd.current?.scrollIntoView({ block: "end" });
    }, [conversation.turns]);

    const canSend = Boolean(apiKey && model && draft.trim()) && !busy;
    const submit = () => {
        if (!canSend) return;
        void desk.send(draft.trim(), locale);
        setDraft("");
    };
    const toggleDrawer = (next: Exclude<Drawer, null>) => setDrawer(open => (open === next ? null : next));
    const lastTurn = conversation.turns.at(-1);

    return (
        <aside
            className={cn(
                "flex h-full flex-col overflow-hidden bg-surface-container-low",
                layout === "docked" && "w-[360px] shrink-0 rounded-md3-xl border border-outline-variant/50",
                layout === "page" && "w-full",
                className,
            )}
        >
            <header className="flex items-center gap-1 border-b border-outline-variant/40 px-3 py-2">
                <Icon path={mdWandStars} size={20} className="shrink-0 text-primary" />
                <span className="type-title-s flex-1 truncate">{conversation.title || t("page.storyMaker.agent.title")}</span>
                {state.nodeChanges.size > 0 && (
                    <IconButton icon={mdVisibilityOff} label={t("page.storyMaker.agent.clearMarks")} size="xs" onClick={() => desk.clearMarks()} />
                )}
                <IconButton
                    icon={mdHistory}
                    label={t("page.storyMaker.agent.history")}
                    size="xs"
                    selected={drawer === "history"}
                    onClick={() => toggleDrawer("history")}
                />
                <IconButton icon={mdAdd} label={t("page.storyMaker.agent.newChat")} size="xs" disabled={busy} onClick={() => desk.newConversation()} />
                <IconButton
                    icon={mdSettings}
                    label={t("page.storyMaker.agent.settings")}
                    size="xs"
                    selected={drawer === "settings"}
                    onClick={() => toggleDrawer("settings")}
                />
                {onClose && <IconButton icon={mdClose} label={t("common.action.close")} size="xs" onClick={onClose} />}
            </header>

            {drawer === "settings" && (
                <section className="flex flex-col gap-3 border-b border-outline-variant/40 px-3 py-3">
                    <TextField
                        label={t("page.storyMaker.agent.apiKey")}
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={event => setApiKey(event.target.value.trim())}
                        supportingText={t("page.storyMaker.agent.apiKeyHint")}
                    />
                    {models.length > 1 && (
                        <Select
                            label={t("page.storyMaker.agent.model")}
                            value={model}
                            onValueChange={setModel}
                            options={models.map(m => ({ value: m.id, label: m.name }))}
                        />
                    )}
                    {modelInfo && thinkingLevel && modelInfo.thinkingLevels.length > 1 && (
                        <Select
                            label={t("page.storyMaker.agent.thinkingLevel")}
                            value={thinkingLevel}
                            onValueChange={setThinking}
                            options={modelInfo.thinkingLevels.map(level => ({
                                value: level,
                                label: t(`page.storyMaker.agent.thinkingLevels.${level}`),
                            }))}
                        />
                    )}
                </section>
            )}

            {drawer === "history" && (
                <ConversationHistory
                    conversations={state.conversations}
                    openId={conversation.id}
                    busy={busy}
                    desk={desk}
                    onOpened={() => setDrawer(null)}
                />
            )}

            <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
                {conversation.turns.length === 0 && (
                    <p className="type-body-m text-on-surface-variant">{t(`page.storyMaker.agent.empty.${layout}`)}</p>
                )}
                {conversation.turns.map(turn => (
                    <TurnView
                        key={turn.id}
                        turn={turn}
                        canUndo={turn === lastTurn && !busy && turn.undoSnapshotId !== null}
                        onUndo={() => void desk.undoTurn(turn)}
                        nodeIds={nodeIds}
                        onOpenNode={onOpenNode}
                    />
                ))}
                <div ref={transcriptEnd} />
            </div>

            <footer className="flex flex-col gap-2 border-t border-outline-variant/40 px-3 py-2">
                <div className="flex items-center gap-2">
                    <SegmentedButton<StoryAuthoringMode>
                        value={state.mode}
                        onValueChange={mode => desk.setMode(mode)}
                        density={-2}
                        className="flex-1"
                        options={[
                            { value: "edit", label: t("page.storyMaker.agent.modeEdit") },
                            { value: "create", label: t("page.storyMaker.agent.modeCreate") },
                        ]}
                    />
                    <Button
                        variant="text"
                        size="xs"
                        icon={mdUnfoldLess}
                        disabled={busy || conversation.turns.length < 2 || !apiKey}
                        title={t("page.storyMaker.agent.compactHint")}
                        onClick={() => void desk.compact()}
                    >
                        {t("page.storyMaker.agent.context", { tokens: formatTokens(state.contextTokens) })}
                    </Button>
                </div>
                <div className="flex items-end gap-2">
                    <textarea
                        value={draft}
                        rows={3}
                        placeholder={apiKey ? t(`page.storyMaker.agent.placeholder.${layout}`) : t("page.storyMaker.agent.needKey")}
                        disabled={!apiKey}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={event => {
                            // On a phone the Enter key starts a new line; the send button sends.
                            if (layout === "docked" && event.key === "Enter" && !event.shiftKey && !isKeyboardEventComposing(event.nativeEvent)) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        className="type-body-m min-h-0 flex-1 resize-none rounded-md3-lg border border-outline-variant bg-surface px-3 py-2 text-on-surface outline-none focus:border-primary"
                    />
                    {busy ? (
                        <IconButton icon={mdStopFill} label={t("page.storyMaker.agent.stop")} variant="tonal" onClick={() => desk.stop()} />
                    ) : (
                        <IconButton icon={mdSend} label={t("page.storyMaker.agent.send")} variant="filled" disabled={!canSend} onClick={submit} />
                    )}
                </div>
                {busy && (
                    <span className="type-label-s text-on-surface-variant">{t(`page.storyMaker.agent.status.${state.status}`)}</span>
                )}
            </footer>
        </aside>
    );
}

interface ConversationHistoryProps {
    conversations: StoredConversation[];
    openId: string;
    busy: boolean;
    desk: StoryAgentDesk;
    onOpened: () => void;
}

/** The story's saved conversations; the open one is highlighted. */
function ConversationHistory({ conversations, openId, busy, desk, onOpened }: ConversationHistoryProps) {
    const { t, locale } = useStoryI18n();
    const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }), [locale]);
    if (conversations.length === 0) {
        return <p className="type-body-s border-b border-outline-variant/40 px-3 py-3 text-on-surface-variant">{t("page.storyMaker.agent.historyEmpty")}</p>;
    }
    return (
        <ul className="max-h-[40%] shrink-0 overflow-y-auto border-b border-outline-variant/40 py-1">
            {conversations.map(conversation => (
                <li key={conversation.id} className="flex items-center gap-1 pr-2">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            desk.open(conversation.id);
                            onOpened();
                        }}
                        className={cn(
                            "state-layer flex min-w-0 flex-1 flex-col items-start rounded-md3-md px-3 py-1.5 text-left",
                            conversation.id === openId && "bg-secondary-container text-on-secondary-container",
                        )}
                    >
                        <span className="type-body-m w-full truncate">{conversation.title || t("page.storyMaker.agent.untitledChat")}</span>
                        <span className="type-label-s text-on-surface-variant">
                            {t("page.storyMaker.agent.turnCount", { count: conversation.turns.length })} · {dateFormat.format(conversation.updatedAt)}
                        </span>
                    </button>
                    <IconButton
                        icon={mdDelete}
                        label={t("page.storyMaker.agent.deleteChat")}
                        size="xs"
                        disabled={busy && conversation.id === openId}
                        onClick={() => void desk.remove(conversation.id)}
                    />
                </li>
            ))}
        </ul>
    );
}

interface TurnViewProps {
    turn: AgentTurn;
    canUndo: boolean;
    onUndo: () => void;
    nodeIds: ReadonlySet<string>;
    onOpenNode?: (nodeId: string) => void;
}

function TurnView({ turn, canUndo, onUndo, nodeIds, onOpenNode }: TurnViewProps) {
    const { t } = useStoryI18n();
    return (
        <div className="space-y-2">
            <div className="type-body-m ml-8 whitespace-pre-wrap rounded-md3-lg bg-primary-container px-3 py-2 text-on-primary-container">
                {turn.prompt}
            </div>
            {turn.items.map((item, index) => (
                <TurnItemView key={index} item={item} nodeIds={nodeIds} onOpenNode={onOpenNode} />
            ))}
            {turn.error && (
                <div className="type-body-s rounded-md3-md bg-error-container px-3 py-2 text-on-error-container">{turn.error}</div>
            )}
            {turn.state === "aborted" && <p className="type-label-s text-on-surface-variant">{t("page.storyMaker.agent.aborted")}</p>}
            {canUndo && (
                <Button variant="text" size="xs" icon={mdUndo} onClick={onUndo}>
                    {t("page.storyMaker.agent.undoTurn")}
                </Button>
            )}
        </div>
    );
}

interface TurnItemViewProps {
    item: AgentTurnItem;
    nodeIds: ReadonlySet<string>;
    onOpenNode?: (nodeId: string) => void;
}

function TurnItemView({ item, nodeIds, onOpenNode }: TurnItemViewProps) {
    const { t } = useStoryI18n();
    switch (item.kind) {
        case "text":
            return <AgentMarkdown text={item.text} nodeIds={nodeIds} onOpenNode={onOpenNode} />;
        case "thinking":
            return (
                <details className="type-body-s text-on-surface-variant">
                    <summary className="cursor-pointer select-none">{t("page.storyMaker.agent.thinking")}</summary>
                    <div className="mt-1 whitespace-pre-wrap border-l-2 border-outline-variant pl-2">{item.text}</div>
                </details>
            );
        case "tool":
            return (
                <div className="type-label-m flex items-center gap-1.5 text-on-surface-variant" title={item.summary}>
                    <Icon
                        path={item.state === "running" ? mdBuild : item.state === "ok" ? mdCheckCircle : mdError}
                        size={16}
                        className={cn(item.state === "running" && "animate-pulse", item.state === "error" && "text-error")}
                    />
                    <span className="font-mono">{item.toolName}</span>
                </div>
            );
        case "diff":
            return <DiffCard diff={item.diff} onOpenNode={onOpenNode} />;
        case "compaction":
            return (
                <div
                    className={cn("type-label-m flex items-center gap-1.5", item.state === "failed" ? "text-error" : "text-on-surface-variant")}
                    title={item.error}
                >
                    <Icon path={mdUnfoldLess} size={16} className={cn(item.state === "running" && "animate-pulse")} />
                    <span>
                        {item.state === "running" && t("page.storyMaker.agent.compaction.running")}
                        {item.state === "done" && t("page.storyMaker.agent.compaction.done", {
                            before: formatTokens(item.tokensBefore),
                            after: formatTokens(item.tokensAfter ?? 0),
                        })}
                        {item.state === "failed" && t("page.storyMaker.agent.compaction.failed")}
                    </span>
                </div>
            );
    }
}

function DiffCard({ diff, onOpenNode }: { diff: StoryMskDiff; onOpenNode?: (nodeId: string) => void }) {
    const { t } = useStoryI18n();
    const touched = [
        ...diff.addedNodeIds.map(id => ({ id, change: "added" as const })),
        ...diff.modifiedNodeIds.map(id => ({ id, change: "modified" as const })),
    ];
    return (
        <div className="space-y-2 rounded-md3-lg border border-outline-variant/60 bg-surface px-3 py-2">
            <div className="type-label-m flex flex-wrap gap-x-3 text-on-surface-variant">
                <span>{t("page.storyMaker.agent.diffSummary", {
                    added: diff.addedNodeIds.length,
                    modified: diff.modifiedNodeIds.length,
                    removed: diff.removedNodeIds.length,
                })}</span>
                <span>{t("page.storyMaker.agent.diffBeats", { delta: diff.beatCountDelta >= 0 ? `+${diff.beatCountDelta}` : diff.beatCountDelta })}</span>
                <span className={diff.compileOk ? "text-tertiary" : "text-error"}>
                    {diff.compileOk
                        ? t("page.storyMaker.agent.compileOk")
                        : t("page.storyMaker.agent.compileErrors", { count: diff.errorCount })}
                </span>
            </div>
            {touched.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {touched.map(({ id, change }) => (
                        <button
                            key={id}
                            type="button"
                            disabled={!onOpenNode}
                            onClick={() => onOpenNode?.(id)}
                            className={cn(
                                "type-label-s rounded-full px-2 py-0.5 font-mono",
                                change === "added" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container",
                            )}
                        >
                            {id}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
