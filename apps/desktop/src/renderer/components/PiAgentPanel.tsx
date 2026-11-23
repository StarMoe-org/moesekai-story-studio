import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import {
    Banner,
    Button,
    Chip,
    Icon,
    IconButton,
    LinearProgress,
    Tooltip,
    cn,
} from "@moesekai/story-editor/md3";
import {
    mdAdd,
    mdAutoStories,
    mdBuild,
    mdCheck,
    mdCheckCircle,
    mdChevronRight,
    mdCode,
    mdContentCopy,
    mdDelete,
    mdEdit,
    mdErrorFill,
    mdHistory,
    mdKeyboardArrowDown,
    mdKeyboardArrowUp,
    mdMyLocation,
    mdRecordVoiceOver,
    mdRefresh,
    mdRightPanelClose,
    mdSend,
    mdSettings,
    mdStop,
    mdTranslate,
    mdUndo,
    mdWandShine,
    mdWandStars,
} from "@moesekai/story-editor/md3/icons";
import {
    applyAgentEventToTurns,
    createAssistantTurn,
    formatElapsedSeconds,
    getActiveRetryEntry,
    getAgentToolLabelKey,
    getRecoveredRetries,
    getTurnThinkingDurationMs,
    groupToolCalls,
    isTurnThinkingLive,
    summarizeToolArgs,
    toggleTurnRetryCollapsed,
    toggleTurnThinkingCollapsed,
    type AgentChatTurn,
    type AgentToolCallEntry,
} from "../../shared/agent-panel-state";
import type {
    AgentAuthoringMode,
    AgentKnownProviderInfo,
    AgentModelOption,
    AgentPersistedTurn,
    AgentPresetId,
    AgentProviderConfigPublic,
    AgentSessionSummary,
    AgentStatus,
    AgentThinkingLevel,
    AgentWorkflowStage,
    AgentWorkflowStageStatus,
    DesktopAgentEvent,
    DesktopStoryRegion,
    DesktopUiLocale,
    WorkspaceSnapshotInfo,
} from "../../shared/ipc";
import { formatDesktopMessage, type DesktopMessageTable } from "../i18n/desktopMessages";
import { AgentMarkdown } from "./AgentMarkdown";

export interface PiAgentPanelHandle {
    /** Capture-only deterministic thread preview fixture for automated UI screenshots. */
    loadPreviewFixture(targetNodeId?: string | null): void;
    /** Capture-only helper to toggle the 2-tab History Drawer for visual verification. */
    setHistoryDrawerOpen(open: boolean, tab?: "conversations" | "snapshots"): void;
}

export interface PiAgentPanelProps {
    locale: DesktopUiLocale;
    region: DesktopStoryRegion;
    hasActiveProject: boolean;
    knownNodeIds: string[];
    selectedNodeId: string | null;
    activeMode: "flow" | "code" | "playtest";
    providerConfig: AgentProviderConfigPublic | null;
    agentStatus: AgentStatus;
    snapshots: WorkspaceSnapshotInfo[];
    onConfigChange: (config: AgentProviderConfigPublic) => void;
    onOpenSettings: () => void;
    onCollapse: () => void;
    onFocusNode: (nodeId: string) => void;
    onRollbackSnapshot: (snapshotId: string) => Promise<void>;
    onRefreshSnapshots: () => Promise<void>;
    externalPresetTrigger?: { preset: AgentPresetId; nonce: number } | null;
}

const CREATE_STAGES: AgentWorkflowStage[] = ["outline", "research", "author", "verify"];
const EDIT_STAGES: AgentWorkflowStage[] = ["inspect", "patch", "verify"];

const THINKING_LEVEL_META: Array<{ value: AgentThinkingLevel; labelKey: keyof DesktopMessageTable }> = [
    { value: "off", labelKey: "agentThinkingOff" },
    { value: "minimal", labelKey: "agentThinkingMinimal" },
    { value: "low", labelKey: "agentThinkingLow" },
    { value: "medium", labelKey: "agentThinkingMedium" },
    { value: "high", labelKey: "agentThinkingHigh" },
    { value: "xhigh", labelKey: "agentThinkingXhigh" },
];

const STAGE_LABEL_KEYS: Record<AgentWorkflowStage, keyof DesktopMessageTable> = {
    outline: "agentStageOutline",
    research: "agentStageResearch",
    author: "agentStageAuthor",
    verify: "agentStageVerify",
    inspect: "agentStageInspect",
    patch: "agentStagePatch",
};

const COMPOSER_MIN_HEIGHT_PX = 44;
const COMPOSER_MAX_HEIGHT_PX = 140;
const NEAR_BOTTOM_THRESHOLD_PX = 64;

function compactModelLabel(modelId: string): string {
    const trimmed = modelId.trim();
    if (!trimmed) return "claude-opus-5-5";
    const slash = trimmed.lastIndexOf("/");
    return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function hydratePersistedTurns(persisted: AgentPersistedTurn[]): AgentChatTurn[] {
    return (persisted ?? []).map(turn => ({
        ...turn,
        thinkingCollapsed: true,
        retryNoticeCollapsed: true,
        tools: (turn.tools ?? []).map(tool => ({
            ...tool,
            status: tool.status === "running" ? "done" : tool.status,
            collapsed: tool.status !== "error",
        })),
        retries: (turn.retries ?? []).map(entry => ({
            ...entry,
            status: entry.status === "retrying" ? "recovered" : entry.status,
        })),
    }));
}

function buildCapturePreviewSessions(): AgentSessionSummary[] {
    const now = Date.now();
    return [
        {
            id: "preview_sess_1",
            title: "润色 scene_06_climax 中奏与真冬的对话节奏",
            createdAt: new Date(now - 900_000).toISOString(),
            updatedAt: new Date(now - 15_000).toISOString(),
            authoringMode: "edit",
            model: "claude-opus-5-5",
            provider: "anthropic",
            messageCount: 2,
            sessionFile: "preview_sess_1.jsonl",
        },
        {
            id: "preview_sess_2",
            title: "为 25时的未名余音 补充日语多语言字幕与校验",
            createdAt: new Date(now - 3_600_000).toISOString(),
            updatedAt: new Date(now - 1_800_000).toISOString(),
            authoringMode: "create",
            model: "claude-opus-5-5",
            provider: "anthropic",
            messageCount: 6,
            sessionFile: "preview_sess_2.jsonl",
        },
    ];
}

function buildCapturePreviewTurns(targetNodeId: string, secondaryNodeId: string): AgentChatTurn[] {
    const baseTs = Date.now() - 15_000;
    const nodeRef = targetNodeId || "scene_06_climax";
    const secondRef = secondaryNodeId || "choice_01";
    return [
        {
            id: "preview_user_1",
            role: "user",
            text: `请润色 \`${nodeRef}\` 中奏与真冬的对话节奏，并整理全剧节点结构表。`,
            thinkingCollapsed: true,
            retryNoticeCollapsed: true,
            timestamp: baseTs,
            startedAt: baseTs,
            endedAt: baseTs,
        },
        {
            id: "preview_assistant_1",
            role: "assistant",
            thinking: [
                `1. 检查 ${nodeRef} 现有节拍顺序与角色站位，确认奏与真冬之间的停顿长度。`,
                "2. 对照 25时官方剧情语气：奏的回应偏轻柔但坚定，真冬在短暂迟疑后才会吐露真心。",
                "3. 保持所有 @cast 与 motion/facial 名称来自当前服务器索引，随后执行完整编译校验。",
            ].join("\n"),
            thinkingStartedAt: baseTs + 200,
            thinkingEndedAt: baseTs + 4_400,
            thinkingCollapsed: true,
            retries: [
                {
                    attempt: 1,
                    maxAttempts: 3,
                    delayMs: 1500,
                    errorMessage: "Request timed out: Connect Timeout Error (timeout: 10000ms) (UND_ERR_CONNECT_TIMEOUT)",
                    code: "UND_ERR_CONNECT_TIMEOUT",
                    startedAt: baseTs + 4_420,
                    endedAt: baseTs + 5_950,
                    status: "recovered",
                },
            ],
            retryNoticeCollapsed: true,
            tools: [
                {
                    toolCallId: "preview_tc_1",
                    toolName: "story_read_workspace",
                    args: { file: "story.msk", includeLocales: true },
                    status: "done",
                    startedAt: baseTs + 6_000,
                    endedAt: baseTs + 6_400,
                    durationMs: 400,
                    summary: "已读取 story.msk（8 个节点，4 名登场角色）",
                    details: { nodes: 8, castCount: 4 },
                    collapsed: true,
                },
                {
                    toolCallId: "preview_tc_2",
                    toolName: "story_mine_official",
                    args: { action: "study", unit: "25ji", query: "奏 真冬 深夜对话" },
                    status: "done",
                    startedAt: baseTs + 6_450,
                    endedAt: baseTs + 7_550,
                    durationMs: 1_100,
                    summary: "参考了 2 篇 25时官方活动剧情对白风格",
                    details: { matchedEpisodes: 2 },
                    collapsed: true,
                },
                {
                    toolCallId: "preview_tc_3",
                    toolName: "story_patch_msk",
                    args: { nodeId: nodeRef, operations: [{ op: "update_beat" }, { op: "insert_beat" }] },
                    status: "done",
                    startedAt: baseTs + 7_600,
                    endedAt: baseTs + 8_200,
                    durationMs: 600,
                    summary: `已更新 ${nodeRef} 的停顿与表情切换并通过预检`,
                    details: { compileOk: true, warnings: 0 },
                    collapsed: true,
                },
            ],
            text: [
                "## 故事结构与润色完成",
                "",
                `已优化 **${nodeRef}** 的对话停顿与 Live2D 表情衔接，核心节点如下：`,
                "",
                "| 节点 | 变更说明 |",
                "| --- | --- |",
                `| \`${nodeRef}\` | 奏与真冬深夜对白加入半拍呼吸停顿与微笑切换 |`,
                `| \`${secondRef}\` | 分支衔接保持条件一致，编译零警告 |`,
                "",
                "```msk",
                `@talk kanade facial="face_smile_02" motion="w-cute-nod01"`,
                "  「不用急着找到答案……我们一起写完吧。」",
                "```",
            ].join("\n"),
            stats: {
                inputTokens: 960,
                outputTokens: 460,
                totalTokens: 1420,
                toolCalls: 3,
            },
            timestamp: baseTs + 100,
            startedAt: baseTs + 100,
            endedAt: baseTs + 11_900,
        },
    ];
}

export const PiAgentPanel = forwardRef<PiAgentPanelHandle, PiAgentPanelProps>(function PiAgentPanel(
    {
        locale,
        region,
        hasActiveProject,
        knownNodeIds,
        selectedNodeId,
        activeMode,
        providerConfig,
        agentStatus,
        snapshots,
        onConfigChange,
        onOpenSettings,
        onCollapse,
        onFocusNode,
        onRollbackSnapshot,
        onRefreshSnapshots,
        externalPresetTrigger,
    },
    ref,
) {
    const t = useCallback(
        (key: keyof DesktopMessageTable, vars?: Record<string, string | number>) =>
            formatDesktopMessage(locale, key, vars),
        [locale],
    );

    const [turns, setTurns] = useState<AgentChatTurn[]>([]);
    const [composer, setComposer] = useState("");
    const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
    const [historyTab, setHistoryTab] = useState<"conversations" | "snapshots">("conversations");
    const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [expandedToolGroups, setExpandedToolGroups] = useState<Record<string, boolean>>({});
    const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
    const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
    const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
    const [rollingBackId, setRollingBackId] = useState<string | null>(null);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    // Authoring workflow & Plan approval state
    const [stageMode, setStageMode] = useState<AgentAuthoringMode>(providerConfig?.authoringMode ?? "create");
    const [stageProgress, setStageProgress] = useState<Partial<Record<AgentWorkflowStage, AgentWorkflowStageStatus>>>({});
    const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
    const [revisingPlanId, setRevisingPlanId] = useState<string | null>(null);
    const [approvingPlanId, setApprovingPlanId] = useState<string | null>(null);

    // Codex-style footer popovers (Model selector + Thinking Effort)
    const [providers, setProviders] = useState<AgentKnownProviderInfo[]>([]);
    const [liveModels, setLiveModels] = useState<AgentModelOption[] | null>(null);
    const [modelSource, setModelSource] = useState<"live" | "catalog">("catalog");
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelFetchError, setModelFetchError] = useState<string | null>(null);
    const [customModelDraft, setCustomModelDraft] = useState("");
    const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
    const [thinkingPopoverOpen, setThinkingPopoverOpen] = useState(false);
    const [modelPopoverPos, setModelPopoverPos] = useState<{ bottom: number; left: number; width: number }>({
        bottom: 64,
        left: 16,
        width: 280,
    });
    const [thinkingPopoverPos, setThinkingPopoverPos] = useState<{ bottom: number; right: number }>({
        bottom: 64,
        right: 16,
    });

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const isNearBottomRef = useRef<boolean>(true);
    const didMutateTurnsRef = useRef<boolean>(false);
    const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
    const activeTurnIdRef = useRef<string | null>(null);
    const lastExternalTriggerNonceRef = useRef<number>(0);

    const modelBtnRef = useRef<HTMLButtonElement | null>(null);
    const modelPopoverRef = useRef<HTMLDivElement | null>(null);
    const thinkingBtnRef = useRef<HTMLButtonElement | null>(null);
    const thinkingPopoverRef = useRef<HTMLDivElement | null>(null);

    const knownNodeSet = useMemo(() => new Set(knownNodeIds), [knownNodeIds]);

    const authoringMode: AgentAuthoringMode = providerConfig?.authoringMode ?? "create";
    const planFirst: boolean = providerConfig?.planFirst ?? authoringMode === "create";
    const thinkingLevel: AgentThinkingLevel = providerConfig?.thinkingLevel ?? "medium";
    const activeModel = providerConfig?.model ?? "claude-opus-5-5";
    const activeProvider = providerConfig?.provider ?? "anthropic";

    const isStreaming =
        agentStatus === "starting" ||
        agentStatus === "thinking" ||
        agentStatus === "streaming" ||
        agentStatus === "tool_running" ||
        agentStatus === "retrying";

    const needsSetup =
        providerConfig !== null &&
        providerConfig.mode === "sdk" &&
        !providerConfig.hasApiKey;

    const refreshSessions = useCallback(async () => {
        if (!hasActiveProject) {
            setSessions([]);
            return [];
        }
        try {
            const list = await window.moesekaiDesktop.agent.listSessions();
            setSessions(list);
            return list;
        } catch {
            return [];
        }
    }, [hasActiveProject]);

    // Auto-load per-project conversation history on mount (and resume most recent non-empty thread if untouched)
    useEffect(() => {
        if (!hasActiveProject) return;
        let cancelled = false;
        void (async () => {
            try {
                const list = await window.moesekaiDesktop.agent.listSessions();
                if (cancelled || didMutateTurnsRef.current) return;
                setSessions(list);
                const latest = list[0];
                if (latest && latest.messageCount > 0 && !didMutateTurnsRef.current) {
                    const resumed = await window.moesekaiDesktop.agent.resumeSession(latest.id);
                    if (cancelled || didMutateTurnsRef.current) return;
                    setActiveSessionId(resumed.summary.id);
                    setTurns(hydratePersistedTurns(resumed.transcript));
                    if (resumed.activePlan && resumed.activePlan.status === "pending_approval") {
                        setPendingPlanId(resumed.activePlan.id);
                    }
                    isNearBottomRef.current = true;
                }
            } catch {
                // Ignore if worker hasn't booted yet
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [hasActiveProject]);

    // Expose capture-only fixture hook for automated visual verification (never triggered by users)
    useImperativeHandle(
        ref,
        () => ({
            loadPreviewFixture(targetNodeId?: string | null) {
                didMutateTurnsRef.current = true;
                const resolvedNode =
                    (targetNodeId && targetNodeId.trim()) ||
                    knownNodeIds.find(id => id.includes("climax")) ||
                    knownNodeIds[0] ||
                    "scene_06_climax";
                const secondaryNode =
                    knownNodeIds.find(id => id !== resolvedNode && id.startsWith("choice")) ||
                    knownNodeIds.find(id => id !== resolvedNode) ||
                    "choice_01";
                activeTurnIdRef.current = null;
                setExpandedToolGroups({});
                setExpandedTools({});
                setTurns(buildCapturePreviewTurns(resolvedNode, secondaryNode));
                setSessions(buildCapturePreviewSessions());
                setActiveSessionId("preview_sess_1");
                isNearBottomRef.current = true;
                setShowScrollToBottom(false);
            },
            setHistoryDrawerOpen(open: boolean, tab?: "conversations" | "snapshots") {
                if (tab) setHistoryTab(tab);
                setShowHistoryDrawer(open);
            },
        }),
        [knownNodeIds],
    );

    // Tick every 100ms ONLY while an active thinking block, running tool, or live retry requires a timer
    const hasLiveTimer = useMemo(() => {
        const activeId = activeTurnIdRef.current;
        return turns.some(turn => {
            if (isTurnThinkingLive(turn, turn.id === activeId)) return true;
            if (getActiveRetryEntry(turn)) return true;
            return Boolean(turn.tools?.some(tool => tool.status === "running"));
        });
    }, [turns, isStreaming]);

    useEffect(() => {
        if (!hasLiveTimer) return;
        setNowMs(Date.now());
        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 100);
        return () => window.clearInterval(timer);
    }, [hasLiveTimer]);

    // Auto-grow composer textarea smoothly up to 140px
    useLayoutEffect(() => {
        const el = composerInputRef.current;
        if (!el) return;
        el.style.height = "auto";
        const nextHeight = Math.max(COMPOSER_MIN_HEIGHT_PX, Math.min(COMPOSER_MAX_HEIGHT_PX, el.scrollHeight));
        el.style.height = `${nextHeight}px`;
    }, [composer]);

    // Load provider catalog once on mount for the Codex-style Model selector popover
    useEffect(() => {
        let cancelled = false;
        void window.moesekaiDesktop.agent
            .listProviders()
            .then(list => {
                if (!cancelled) setProviders(list);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Reset live model list when provider switches
    useEffect(() => {
        setLiveModels(null);
        setModelSource("catalog");
        setModelFetchError(null);
    }, [activeProvider]);

    const catalogModels = useMemo<AgentModelOption[]>(() => {
        if (liveModels && liveModels.length > 0) return liveModels;
        const providerMeta = providers.find(p => p.id === activeProvider);
        return providerMeta?.sampleModels ?? [];
    }, [activeProvider, liveModels, providers]);

    // Position upward-opening popovers via portal
    const updateModelPopoverPos = useCallback(() => {
        const el = modelBtnRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const width = Math.min(288, Math.max(240, window.innerWidth - 24));
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        const bottom = Math.max(12, window.innerHeight - rect.top + 8);
        setModelPopoverPos({ bottom, left, width });
    }, []);

    const updateThinkingPopoverPos = useCallback(() => {
        const el = thinkingBtnRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const right = Math.max(12, window.innerWidth - rect.right);
        const bottom = Math.max(12, window.innerHeight - rect.top + 8);
        setThinkingPopoverPos({ bottom, right });
    }, []);

    useLayoutEffect(() => {
        if (!modelPopoverOpen) return;
        updateModelPopoverPos();
        window.addEventListener("resize", updateModelPopoverPos);
        return () => window.removeEventListener("resize", updateModelPopoverPos);
    }, [modelPopoverOpen, updateModelPopoverPos]);

    useLayoutEffect(() => {
        if (!thinkingPopoverOpen) return;
        updateThinkingPopoverPos();
        window.addEventListener("resize", updateThinkingPopoverPos);
        return () => window.removeEventListener("resize", updateThinkingPopoverPos);
    }, [thinkingPopoverOpen, updateThinkingPopoverPos]);

    // Close popovers on outside click / Escape
    useEffect(() => {
        if (!modelPopoverOpen && !thinkingPopoverOpen) return;
        const onPointerDown = (ev: MouseEvent) => {
            const target = ev.target as Node;
            if (
                modelPopoverOpen &&
                !modelPopoverRef.current?.contains(target) &&
                !modelBtnRef.current?.contains(target)
            ) {
                setModelPopoverOpen(false);
            }
            if (
                thinkingPopoverOpen &&
                !thinkingPopoverRef.current?.contains(target) &&
                !thinkingBtnRef.current?.contains(target)
            ) {
                setThinkingPopoverOpen(false);
            }
        };
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                setModelPopoverOpen(false);
                setThinkingPopoverOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [modelPopoverOpen, thinkingPopoverOpen]);

    // Subscribe to live streaming, workflow_stage, plan_proposed, plan_resolved events
    useEffect(() => {
        const unsub = window.moesekaiDesktop.agent.onEvent((ev: DesktopAgentEvent) => {
            if (ev.type === "workflow_stage") {
                setStageMode(ev.mode);
                setStageProgress(prev => ({ ...prev, [ev.stage]: ev.status }));
                return;
            }

            if (ev.type === "plan_resolved") {
                setPendingPlanId(prev => (prev === ev.planId ? null : prev));
            } else if (ev.type === "plan_proposed") {
                setStageMode(ev.plan.mode);
                if (ev.awaitingApproval) {
                    setPendingPlanId(ev.plan.id);
                }
            }

            if (
                ev.type === "plan_resolved" ||
                ev.type === "text_delta" ||
                ev.type === "thinking_delta" ||
                ev.type === "tool_start" ||
                ev.type === "tool_end" ||
                ev.type === "msk_diff" ||
                ev.type === "plan_proposed" ||
                ev.type === "retry_start" ||
                ev.type === "retry_end" ||
                ev.type === "error" ||
                ev.type === "done"
            ) {
                setTurns(prev => {
                    const reduced = applyAgentEventToTurns(prev, activeTurnIdRef.current, ev);
                    activeTurnIdRef.current = reduced.activeTurnId;
                    return reduced.turns;
                });
                if (ev.type === "done") {
                    void refreshSessions().then(list => {
                        if (list.length > 0) {
                            setActiveSessionId(curr => curr ?? list[0].id);
                        }
                    });
                }
            }
        });
        return unsub;
    }, [refreshSessions]);

    // Smart auto-scroll: follow bottom ONLY when user is near the bottom
    const handleTimelineScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const near = distanceToBottom <= NEAR_BOTTOM_THRESHOLD_PX;
        isNearBottomRef.current = near;
        const scrollable = el.scrollHeight > el.clientHeight + 80;
        setShowScrollToBottom(!near && scrollable);
    }, []);

    const scrollToBottom = useCallback((smooth = true) => {
        const el = scrollRef.current;
        if (!el) return;
        isNearBottomRef.current = true;
        setShowScrollToBottom(false);
        el.scrollTo({
            top: el.scrollHeight,
            behavior: smooth ? "smooth" : "instant",
        });
    }, []);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (isNearBottomRef.current) {
            el.scrollTop = el.scrollHeight;
            setShowScrollToBottom(false);
        } else {
            const scrollable = el.scrollHeight > el.clientHeight + 80;
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowScrollToBottom(scrollable && distanceToBottom > NEAR_BOTTOM_THRESHOLD_PX);
        }
    }, [turns]);

    const pushUserTurn = (label: string) => {
        didMutateTurnsRef.current = true;
        const now = Date.now();
        const assistantId = `assistant_${now}_${Math.random().toString(36).slice(2, 6)}`;
        activeTurnIdRef.current = assistantId;
        isNearBottomRef.current = true;
        setShowScrollToBottom(false);
        setTurns(prev => [
            ...prev,
            {
                id: `user_${now}`,
                role: "user",
                text: label,
                thinkingCollapsed: true,
                retryNoticeCollapsed: true,
                timestamp: now,
                startedAt: now,
                endedAt: now,
            },
            createAssistantTurn(assistantId, now),
        ]);
    };

    const handleChangeAuthoringMode = async (nextMode: AgentAuthoringMode) => {
        if (isStreaming || nextMode === authoringMode) return;
        const defaultPlan = nextMode === "create";
        setStageMode(nextMode);
        setStageProgress({});
        try {
            const updated = await window.moesekaiDesktop.agent.setAuthoringMode(nextMode, defaultPlan);
            onConfigChange(updated);
        } catch {
            // Keep UI responsive even if IPC throws
        }
    };

    const handleTogglePlanFirst = async () => {
        if (isStreaming) return;
        try {
            const updated = await window.moesekaiDesktop.agent.setPlanFirst(!planFirst);
            onConfigChange(updated);
        } catch {
            // ignore
        }
    };

    const handleSelectModel = async (nextModelId: string) => {
        const trimmed = nextModelId.trim();
        if (!trimmed || !providerConfig) return;
        setModelPopoverOpen(false);
        setCustomModelDraft("");
        try {
            const saved = await window.moesekaiDesktop.agent.saveConfig({
                mode: providerConfig.mode,
                provider: providerConfig.provider,
                model: trimmed,
                baseUrl: providerConfig.baseUrl,
                api: providerConfig.api,
                thinkingLevel: providerConfig.thinkingLevel,
                authoringMode: providerConfig.authoringMode,
                planFirst: providerConfig.planFirst,
                rpcCliPath: providerConfig.rpcCliPath,
                rpcArgs: providerConfig.rpcArgs,
            });
            onConfigChange(saved);
        } catch {
            // ignore
        }
    };

    const handleRefreshModels = async () => {
        setFetchingModels(true);
        setModelFetchError(null);
        try {
            const res = await window.moesekaiDesktop.agent.fetchModels();
            setLiveModels(res.models);
            setModelSource(res.source);
            if (res.error) setModelFetchError(res.error);
        } catch (err) {
            setModelFetchError(err instanceof Error ? err.message : String(err));
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSelectThinkingLevel = async (level: AgentThinkingLevel) => {
        setThinkingPopoverOpen(false);
        try {
            const updated = await window.moesekaiDesktop.agent.setThinkingLevel(level);
            onConfigChange(updated);
        } catch {
            // ignore
        }
    };

    const handleApprovePlan = async (planId: string) => {
        if (isStreaming) return;
        setApprovingPlanId(planId);
        setRevisingPlanId(null);
        const now = Date.now();
        const assistantId = `assistant_${now}_${Math.random().toString(36).slice(2, 6)}`;
        activeTurnIdRef.current = assistantId;
        isNearBottomRef.current = true;
        setTurns(prev => [...prev, createAssistantTurn(assistantId, now)]);
        try {
            await window.moesekaiDesktop.agent.approvePlan(planId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns(prev =>
                prev.map(item =>
                    item.id === assistantId ? { ...item, error: msg, endedAt: Date.now() } : item,
                ),
            );
            activeTurnIdRef.current = null;
        } finally {
            setApprovingPlanId(null);
        }
    };

    const handleStartRevisePlan = (planId: string) => {
        setRevisingPlanId(planId);
        composerInputRef.current?.focus();
    };

    const submitPromptText = async (rawPrompt: string) => {
        const trimmed = rawPrompt.trim();
        if (!trimmed || !hasActiveProject || isStreaming) return;

        setStageMode(authoringMode);
        setStageProgress({});
        pushUserTurn(trimmed);
        try {
            await window.moesekaiDesktop.agent.prompt({
                prompt: trimmed,
                context: {
                    selectedNodeId,
                    activeMode,
                    locale,
                    authoringMode,
                    planFirst,
                    thinkingLevel,
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns(prev =>
                prev.map(item =>
                    item.id === activeTurnIdRef.current
                        ? { ...item, error: msg, endedAt: Date.now() }
                        : item,
                ),
            );
            activeTurnIdRef.current = null;
        }
    };

    const handleSendPrompt = async () => {
        const trimmed = composer.trim();
        if (!trimmed || !hasActiveProject || isStreaming) return;
        setComposer("");

        const targetReviseId = revisingPlanId;
        if (targetReviseId) {
            setRevisingPlanId(null);
            pushUserTurn(trimmed);
            try {
                await window.moesekaiDesktop.agent.revisePlan(targetReviseId, trimmed);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setTurns(prev =>
                    prev.map(item =>
                        item.id === activeTurnIdRef.current
                            ? { ...item, error: msg, endedAt: Date.now() }
                            : item,
                    ),
                );
                activeTurnIdRef.current = null;
            }
            return;
        }

        await submitPromptText(trimmed);
    };

    const handleRetryFromTurn = async (turnIndex: number) => {
        if (!hasActiveProject || isStreaming) return;
        for (let i = turnIndex - 1; i >= 0; i--) {
            if (turns[i]?.role === "user" && turns[i].text.trim()) {
                await submitPromptText(turns[i].text);
                return;
            }
        }
    };

    const handleRunPreset = async (preset: AgentPresetId, label: string, brief?: string) => {
        if (!hasActiveProject || isStreaming) return;
        const presetMode: AgentAuthoringMode = preset === "author_story" ? "create" : authoringMode;
        setStageMode(presetMode);
        setStageProgress({});
        pushUserTurn(brief ? `${label}: ${brief}` : label);
        try {
            await window.moesekaiDesktop.agent.runPreset({
                preset,
                brief,
                targetLocale: locale,
                region,
                verifyAssets: preset === "fix_validation_issues",
                context: {
                    selectedNodeId,
                    activeMode,
                    locale,
                    authoringMode: presetMode,
                    planFirst,
                    thinkingLevel,
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns(prev =>
                prev.map(item =>
                    item.id === activeTurnIdRef.current
                        ? { ...item, error: msg, endedAt: Date.now() }
                        : item,
                ),
            );
            activeTurnIdRef.current = null;
        }
    };

    useEffect(() => {
        if (!externalPresetTrigger) return;
        if (externalPresetTrigger.nonce === lastExternalTriggerNonceRef.current) return;
        lastExternalTriggerNonceRef.current = externalPresetTrigger.nonce;
        const labelMap: Record<AgentPresetId, string> = {
            author_story: t("agentPresetAuthorTitle"),
            fix_validation_issues: t("agentPresetFixTitle"),
            translate_story: t("agentPresetTranslateTitle"),
            prepare_tts_manifest: t("agentPresetVoiceTitle"),
        };
        void handleRunPreset(externalPresetTrigger.preset, labelMap[externalPresetTrigger.preset]);
    }, [externalPresetTrigger]);

    const handleNewConversation = async () => {
        if (!hasActiveProject || isStreaming) return;
        didMutateTurnsRef.current = true;
        try {
            const created = await window.moesekaiDesktop.agent.newSession();
            setActiveSessionId(created?.sessionId ?? null);
        } catch {
            // Fallback to clear UI state if worker hasn't initialized yet
            setActiveSessionId(null);
        }
        activeTurnIdRef.current = null;
        setTurns([]);
        setExpandedToolGroups({});
        setExpandedTools({});
        setStageProgress({});
        setPendingPlanId(null);
        setRevisingPlanId(null);
        setShowScrollToBottom(false);
        setShowHistoryDrawer(false);
        void refreshSessions();
        composerInputRef.current?.focus();
    };

    const handleResumeConversation = async (sessionId: string) => {
        if (!hasActiveProject || isStreaming || resumingSessionId === sessionId) return;
        setResumingSessionId(sessionId);
        didMutateTurnsRef.current = true;
        try {
            const resumed = await window.moesekaiDesktop.agent.resumeSession(sessionId);
            activeTurnIdRef.current = null;
            setActiveSessionId(resumed.summary.id);
            setTurns(hydratePersistedTurns(resumed.transcript));
            setExpandedToolGroups({});
            setExpandedTools({});
            setStageProgress({});
            setRevisingPlanId(null);
            setPendingPlanId(
                resumed.activePlan && resumed.activePlan.status === "pending_approval"
                    ? resumed.activePlan.id
                    : null,
            );
            setShowHistoryDrawer(false);
            isNearBottomRef.current = true;
            setShowScrollToBottom(false);
            void refreshSessions();
            composerInputRef.current?.focus();
        } finally {
            setResumingSessionId(null);
        }
    };

    const handleDeleteConversation = async (sessionId: string, event: React.MouseEvent) => {
        event.stopPropagation();
        if (isStreaming || deletingSessionId === sessionId) return;
        setDeletingSessionId(sessionId);
        try {
            const deleted = await window.moesekaiDesktop.agent.deleteSession(sessionId);
            if (deleted) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                    activeTurnIdRef.current = null;
                    setActiveSessionId(null);
                    setTurns([]);
                    setPendingPlanId(null);
                    setRevisingPlanId(null);
                }
            }
        } finally {
            setDeletingSessionId(null);
        }
    };

    const handleRollback = async (snapshotId: string) => {
        setRollingBackId(snapshotId);
        try {
            await onRollbackSnapshot(snapshotId);
        } finally {
            setRollingBackId(null);
        }
    };

    const handleCopyTurnText = (turnId: string, text: string) => {
        if (!text) return;
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text).catch(() => {});
        }
        setCopiedTurnId(turnId);
        window.setTimeout(() => {
            setCopiedTurnId(curr => (curr === turnId ? null : curr));
        }, 1600);
    };

    const resolveToolDisplayName = (toolName: string): string => {
        const key = getAgentToolLabelKey(toolName);
        return key ? t(key) : toolName;
    };

    const renderToolRow = (tool: AgentToolCallEntry, compactInGroup = false) => {
        const isError = tool.status === "error";
        const isRunning = tool.status === "running";
        const isOpen = expandedTools[tool.toolCallId] ?? false;
        const displayLabel = resolveToolDisplayName(tool.toolName);
        const argHint = summarizeToolArgs(tool.toolName, tool.args);
        const durationMs = isRunning
            ? Math.max(0, nowMs - tool.startedAt)
            : (tool.durationMs ?? (tool.endedAt ? Math.max(0, tool.endedAt - tool.startedAt) : 0));

        return (
            <div
                key={tool.toolCallId}
                data-testid={`agent-tool-row-${tool.toolName}`}
                className={cn(
                    "overflow-hidden rounded-md3-md border transition-colors",
                    isError
                        ? "border-error/60 bg-error-container/30"
                        : isRunning
                            ? "border-primary/45 bg-surface-container"
                            : compactInGroup
                                ? "border-outline-variant/50 bg-surface-card"
                                : "border-outline-variant/60 bg-surface-container-low",
                )}
            >
                <button
                    type="button"
                    onClick={() =>
                        setExpandedTools(prev => ({
                            ...prev,
                            [tool.toolCallId]: !prev[tool.toolCallId],
                        }))
                    }
                    className="state-layer focus-ring flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                >
                    <div className="flex min-w-0 items-center gap-1.5">
                        <Icon
                            path={
                                isError
                                    ? mdErrorFill
                                    : isRunning
                                        ? mdCode
                                        : mdCheckCircle
                            }
                            size={14}
                            className={cn(
                                "shrink-0",
                                isError
                                    ? "text-error"
                                    : isRunning
                                        ? "text-primary animate-pulse"
                                        : "text-success",
                            )}
                        />
                        <span className="type-label-m shrink-0 font-medium text-on-surface">
                            {displayLabel}
                        </span>
                        {argHint ? (
                            <span className="type-label-s truncate text-on-surface-variant">
                                {argHint}
                            </span>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <span
                            className={cn(
                                "type-label-s font-mono tabular-nums",
                                isError ? "text-error font-medium" : "text-on-surface-variant",
                            )}
                        >
                            {isError
                                ? t("agentToolError")
                                : formatElapsedSeconds(durationMs)}
                        </span>
                        <Icon
                            path={isOpen ? mdKeyboardArrowUp : mdKeyboardArrowDown}
                            size={15}
                            className="text-on-surface-variant"
                        />
                    </div>
                </button>

                {/* Error tools show their error summary right away even before expanding full payload */}
                {isError && tool.summary && !isOpen ? (
                    <div className="type-body-s border-t border-error/30 px-2.5 py-1.5 text-on-error-container">
                        {tool.summary}
                    </div>
                ) : null}

                {isOpen ? (
                    <div className="flex flex-col gap-1.5 border-t border-outline-variant/60 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono type-label-s text-on-surface-variant">
                                {tool.toolName}
                            </span>
                            <span className="type-label-s text-on-surface-variant">
                                {isRunning
                                    ? t("agentToolRunning")
                                    : isError
                                        ? t("agentToolError")
                                        : t("agentToolDone")}
                            </span>
                        </div>
                        {tool.summary ? (
                            <p className="type-body-s text-on-surface">{tool.summary}</p>
                        ) : null}
                        <pre className="type-label-s max-h-40 overflow-auto rounded-md3-xs bg-surface-container-lowest p-2 font-mono text-on-surface-variant">
                            {JSON.stringify({ args: tool.args, details: tool.details }, null, 2)}
                        </pre>
                    </div>
                ) : null}
            </div>
        );
    };

    const presets: Array<{ id: AgentPresetId; title: string; icon: string }> = [
        {
            id: "author_story",
            title: t("agentPresetAuthorTitle"),
            icon: mdAutoStories,
        },
        {
            id: "fix_validation_issues",
            title: t("agentPresetFixTitle"),
            icon: mdBuild,
        },
        {
            id: "translate_story",
            title: t("agentPresetTranslateTitle"),
            icon: mdTranslate,
        },
        {
            id: "prepare_tts_manifest",
            title: t("agentPresetVoiceTitle"),
            icon: mdRecordVoiceOver,
        },
    ];

    const activeWorkflowStages = stageMode === "create" ? CREATE_STAGES : EDIT_STAGES;
    const hasStageActivity = Object.keys(stageProgress).length > 0;
    const showWorkflowStepper = isStreaming || pendingPlanId !== null || hasStageActivity;

    const currentThinkingLabel = t(
        THINKING_LEVEL_META.find(item => item.value === thinkingLevel)?.labelKey ?? "agentThinkingMedium",
    );

    return (
        <aside className="flex h-full w-full flex-col overflow-hidden rounded-md3-xl border border-outline-variant/50 bg-surface-container-low">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md3-md bg-primary-container text-on-primary-container">
                        <Icon path={mdWandStars} size={15} />
                    </span>
                    <span className="type-title-s truncate font-semibold text-on-surface">
                        {t("agentTitle")}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip side="bottom" label={t("agentNewChatTooltip")}>
                        <IconButton
                            variant="standard"
                            size="xs"
                            icon={mdAdd}
                            label={t("agentNewChatTooltip")}
                            data-testid="agent-new-chat-btn"
                            onClick={() => void handleNewConversation()}
                            disabled={!hasActiveProject || isStreaming}
                        />
                    </Tooltip>
                    <Tooltip side="bottom" label={t("agentHistoryTooltip")}>
                        <IconButton
                            variant={showHistoryDrawer ? "tonal" : "standard"}
                            size="xs"
                            icon={mdHistory}
                            label={t("agentHistoryTooltip")}
                            data-testid="agent-history-btn"
                            onClick={() => {
                                const next = !showHistoryDrawer;
                                setShowHistoryDrawer(next);
                                if (next) {
                                    void refreshSessions();
                                    void onRefreshSnapshots();
                                }
                            }}
                        />
                    </Tooltip>
                    <Tooltip side="bottom" label={t("agentSettingsTooltip")}>
                        <IconButton
                            variant="standard"
                            size="xs"
                            icon={mdSettings}
                            label={t("agentSettingsTooltip")}
                            onClick={onOpenSettings}
                        />
                    </Tooltip>
                    <Tooltip side="bottom" label={t("agentToggleTooltip")}>
                        <IconButton
                            variant="standard"
                            size="xs"
                            icon={mdRightPanelClose}
                            label={t("agentToggleTooltip")}
                            onClick={onCollapse}
                        />
                    </Tooltip>
                </div>
            </div>

            {/* Compact Mode Switch (`从零创作` | `修改模式`) + `Plan` Toggle Chip */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant/60 bg-surface-container-low px-3 py-1.5">
                <div
                    role="tablist"
                    aria-label={t("agentAuthoringCreate")}
                    className="inline-flex min-w-0 flex-1 rounded-md3-full border border-outline-variant/70 bg-surface-container p-0.5"
                >
                    <button
                        type="button"
                        role="tab"
                        aria-selected={authoringMode === "create"}
                        disabled={isStreaming}
                        onClick={() => void handleChangeAuthoringMode("create")}
                        className={cn(
                            "state-layer focus-ring flex flex-1 items-center justify-center gap-1 rounded-md3-full px-2 py-1 type-label-s font-medium transition-colors disabled:opacity-50",
                            authoringMode === "create"
                                ? "bg-primary-container text-on-primary-container"
                                : "text-on-surface-variant hover:text-on-surface",
                        )}
                    >
                        <Icon path={mdAutoStories} size={13} className="shrink-0" />
                        <span className="truncate">{t("agentAuthoringCreate")}</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={authoringMode === "edit"}
                        disabled={isStreaming}
                        onClick={() => void handleChangeAuthoringMode("edit")}
                        className={cn(
                            "state-layer focus-ring flex flex-1 items-center justify-center gap-1 rounded-md3-full px-2 py-1 type-label-s font-medium transition-colors disabled:opacity-50",
                            authoringMode === "edit"
                                ? "bg-primary-container text-on-primary-container"
                                : "text-on-surface-variant hover:text-on-surface",
                        )}
                    >
                        <Icon path={mdEdit} size={13} className="shrink-0" />
                        <span className="truncate">{t("agentAuthoringEdit")}</span>
                    </button>
                </div>

                <Tooltip side="bottom" label={t("agentPlanTooltip")}>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={planFirst}
                        disabled={isStreaming}
                        onClick={() => void handleTogglePlanFirst()}
                        className={cn(
                            "state-layer focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md3-full border px-2.5 type-label-s font-medium transition-colors disabled:opacity-50",
                            planFirst
                                ? "border-primary/70 bg-secondary-container text-on-secondary-container"
                                : "border-outline-variant/70 bg-surface-container text-on-surface-variant hover:text-on-surface",
                        )}
                    >
                        <span
                            className={cn(
                                "inline-block h-1.5 w-1.5 rounded-md3-full",
                                planFirst ? "bg-primary" : "bg-outline",
                            )}
                        />
                        <span>{t("agentPlanLabel")}</span>
                    </button>
                </Tooltip>
            </div>

            {/* Compact Live Workflow Stepper (ONLY rendered while running or Plan pending) */}
            {showWorkflowStepper ? (
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-outline-variant/60 bg-surface-container px-3 py-1.5">
                    {activeWorkflowStages.map((stage, idx) => {
                        const status = stageProgress[stage];
                        const isActive = status === "active";
                        const isCompleted = status === "completed";
                        return (
                            <React.Fragment key={stage}>
                                {idx > 0 ? (
                                    <span className="text-outline-variant" aria-hidden>→</span>
                                ) : null}
                                <span
                                    className={cn(
                                        "inline-flex shrink-0 items-center gap-1 rounded-md3-full px-2 py-0.5 type-label-s transition-colors",
                                        isActive
                                            ? "bg-primary text-on-primary font-medium"
                                            : isCompleted
                                                ? "bg-success-container text-on-success-container"
                                                : "bg-surface-container-high text-on-surface-variant",
                                    )}
                                >
                                    {isCompleted ? (
                                        <Icon path={mdCheck} size={12} className="shrink-0" />
                                    ) : isActive ? (
                                        <span className="inline-block h-1.5 w-1.5 rounded-md3-full bg-on-primary animate-pulse" />
                                    ) : null}
                                    <span>{t(STAGE_LABEL_KEYS[stage])}</span>
                                </span>
                            </React.Fragment>
                        );
                    })}
                </div>
            ) : null}

            {isStreaming ? <LinearProgress /> : null}

            {/* 2-Tab History Drawer: Conversations (default, resumable with full LLM context) + Snapshots */}
            {showHistoryDrawer ? (
                <div
                    data-testid="agent-history-drawer"
                    className="flex max-h-72 shrink-0 flex-col gap-2 overflow-hidden border-b border-outline-variant bg-surface-container px-3 py-2.5"
                >
                    <div
                        role="tablist"
                        aria-label={t("agentHistoryTooltip")}
                        className="inline-flex shrink-0 rounded-md3-full border border-outline-variant/70 bg-surface-container-low p-0.5"
                    >
                        <button
                            type="button"
                            role="tab"
                            data-testid="agent-history-tab-conversations"
                            aria-selected={historyTab === "conversations"}
                            onClick={() => setHistoryTab("conversations")}
                            className={cn(
                                "state-layer focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md3-full px-2.5 py-1 type-label-s font-medium transition-colors",
                                historyTab === "conversations"
                                    ? "bg-primary-container text-on-primary-container"
                                    : "text-on-surface-variant hover:text-on-surface",
                            )}
                        >
                            <span className="truncate">{t("agentHistoryTabConversations")}</span>
                            <span className="font-mono opacity-80">{sessions.length}</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            data-testid="agent-history-tab-snapshots"
                            aria-selected={historyTab === "snapshots"}
                            onClick={() => {
                                setHistoryTab("snapshots");
                                void onRefreshSnapshots();
                            }}
                            className={cn(
                                "state-layer focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md3-full px-2.5 py-1 type-label-s font-medium transition-colors",
                                historyTab === "snapshots"
                                    ? "bg-primary-container text-on-primary-container"
                                    : "text-on-surface-variant hover:text-on-surface",
                            )}
                        >
                            <span className="truncate">{t("agentHistoryTabSnapshots")}</span>
                            <span className="font-mono opacity-80">{snapshots.length}</span>
                        </button>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
                        {historyTab === "conversations" ? (
                            sessions.length === 0 ? (
                                <p className="py-2 text-center type-body-s text-on-surface-variant">
                                    {t("agentNoConversations")}
                                </p>
                            ) : (
                                sessions.map(sess => {
                                    const isActive = sess.id === activeSessionId;
                                    const isResuming = resumingSessionId === sess.id;
                                    return (
                                        <div
                                            key={sess.id}
                                            data-testid="agent-conversation-item"
                                            className={cn(
                                                "group flex items-center gap-1.5 rounded-md3-md border transition-colors",
                                                isActive
                                                    ? "border-primary/60 bg-secondary-container/45"
                                                    : "border-outline-variant/60 bg-surface-card hover:bg-surface-container-low",
                                            )}
                                        >
                                            <button
                                                type="button"
                                                disabled={isStreaming || isResuming}
                                                onClick={() => void handleResumeConversation(sess.id)}
                                                className="state-layer focus-ring flex min-w-0 flex-1 flex-col gap-0.5 rounded-md3-md px-2.5 py-2 text-left disabled:opacity-60"
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <span className="type-label-m min-w-0 flex-1 truncate font-medium text-on-surface">
                                                        {sess.title}
                                                    </span>
                                                    {isActive ? (
                                                        <span className="shrink-0 rounded-md3-full bg-primary-container px-1.5 py-0.5 type-label-s font-medium text-on-primary-container">
                                                            {t("agentActiveConversationBadge")}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <span className="type-label-s truncate text-on-surface-variant tabular-nums">
                                                    {t("agentConversationMessages", { count: sess.messageCount })} · {new Date(sess.updatedAt).toLocaleString(locale)}
                                                </span>
                                            </button>
                                            <Tooltip side="bottom" label={t("agentDeleteConversation")}>
                                                <IconButton
                                                    variant="standard"
                                                    size="xs"
                                                    icon={mdDelete}
                                                    label={t("agentDeleteConversation")}
                                                    data-testid="agent-conversation-delete"
                                                    disabled={isStreaming || deletingSessionId === sess.id}
                                                    onClick={e => void handleDeleteConversation(sess.id, e)}
                                                    className="mr-1 shrink-0 opacity-70 transition-opacity hover:opacity-100"
                                                />
                                            </Tooltip>
                                        </div>
                                    );
                                })
                            )
                        ) : snapshots.length === 0 ? (
                            <p className="py-2 text-center type-body-s text-on-surface-variant">
                                {t("agentNoSnapshots")}
                            </p>
                        ) : (
                            snapshots.slice(0, 12).map(snap => (
                                <div
                                    key={snap.id}
                                    className="flex items-center justify-between gap-2 rounded-md3-md border border-outline-variant/60 bg-surface-card px-2.5 py-2"
                                >
                                    <div className="flex min-w-0 flex-col">
                                        <span className="type-label-m truncate text-on-surface">
                                            {snap.reason || snap.id}
                                        </span>
                                        <span className="type-label-s text-on-surface-variant">
                                            {new Date(snap.createdAt).toLocaleString(locale)} · {snap.byteLength} B
                                        </span>
                                    </div>
                                    <Button
                                        variant="tonal"
                                        size="xs"
                                        icon={mdUndo}
                                        disabled={rollingBackId === snap.id}
                                        onClick={() => void handleRollback(snap.id)}
                                    >
                                        {t("agentRollbackButton")}
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : null}

            {/* Main Scrollable Timeline + Smart Scroll-to-Bottom Pill */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                    ref={scrollRef}
                    onScroll={handleTimelineScroll}
                    className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
                >
                    {!hasActiveProject ? (
                        <Banner tone="info">{t("agentNoProjectHint")}</Banner>
                    ) : null}

                    {/* Concise Single-Line Credential Callout */}
                    {needsSetup ? (
                        <div className="flex items-center justify-between gap-2 rounded-md3-lg border border-outline-variant/70 bg-warning-container px-3 py-2 text-on-warning-container">
                            <span className="type-label-m truncate">{t("agentSetupRequired")}</span>
                            <Button
                                variant="tonal"
                                size="xs"
                                icon={mdSettings}
                                onClick={onOpenSettings}
                                className="shrink-0"
                            >
                                {t("agentOpenSettings")}
                            </Button>
                        </div>
                    ) : null}

                    {/* Clean Action Presets */}
                    {turns.length === 0 ? (
                        <div className="flex flex-col gap-1.5">
                            {presets.map(preset => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    disabled={!hasActiveProject || isStreaming}
                                    onClick={() => void handleRunPreset(preset.id, preset.title, composer.trim() || undefined)}
                                    className="state-layer focus-ring flex items-center gap-2.5 rounded-md3-lg border border-outline-variant/70 bg-surface-card px-3 py-2.5 text-left transition-colors hover:bg-surface-container disabled:opacity-50"
                                >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md3-md bg-secondary-container text-on-secondary-container">
                                        <Icon path={preset.icon} size={16} />
                                    </span>
                                    <span className="type-label-l min-w-0 flex-1 truncate text-on-surface">
                                        {preset.title}
                                    </span>
                                    <Icon path={mdChevronRight} size={17} className="shrink-0 text-on-surface-variant" />
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {presets.map(preset => (
                                <Chip
                                    key={preset.id}
                                    variant="assist"
                                    icon={preset.icon}
                                    disabled={!hasActiveProject || isStreaming}
                                    onClick={() => void handleRunPreset(preset.id, preset.title)}
                                >
                                    {preset.title}
                                </Chip>
                            ))}
                        </div>
                    )}

                    {/* Conversation Thread */}
                    {turns.map((turn, turnIndex) => {
                        const isActiveTurn = turn.id === activeTurnIdRef.current;
                        const thinkingLive = isTurnThinkingLive(turn, isActiveTurn);
                        const thinkingMs = getTurnThinkingDurationMs(turn, nowMs);
                        const thinkingDurationLabel = formatElapsedSeconds(thinkingMs);
                        const activeRetry = getActiveRetryEntry(turn);
                        const recoveredRetries = getRecoveredRetries(turn);
                        const hasRetryableUserPrompt = turns
                            .slice(0, turnIndex)
                            .some(item => item.role === "user" && item.text.trim().length > 0);
                        const groupedTools = turn.tools && turn.tools.length > 0 ? groupToolCalls(turn.tools) : [];
                        const turnTotalMs =
                            turn.endedAt !== undefined ? Math.max(0, turn.endedAt - turn.startedAt) : null;
                        const showCompletionFooter =
                            turn.role === "assistant" &&
                            !isActiveTurn &&
                            (turnTotalMs !== null || Boolean(turn.stats) || Boolean(turn.text));

                        return (
                            <div
                                key={turn.id}
                                className={cn(
                                    "flex flex-col gap-2",
                                    turn.role === "user" ? "items-end" : "items-stretch",
                                )}
                            >
                                {turn.role === "user" ? (
                                    <div className="type-body-m max-w-[90%] rounded-md3-lg bg-primary-container px-3.5 py-2 text-on-primary-container whitespace-pre-wrap break-words">
                                        {turn.text}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2.5 rounded-md3-xl border border-outline-variant/75 bg-surface-card p-3">
                                        {/* Thinking Block: live ticking timer while streaming -> auto-collapses to sleek 1-line pill when finished */}
                                        {turn.thinking ? (
                                            <div
                                                data-testid="agent-thinking-block"
                                                data-collapsed={turn.thinkingCollapsed ? "true" : "false"}
                                                className="overflow-hidden rounded-md3-md border border-outline-variant/60 bg-surface-container/80"
                                            >
                                                <button
                                                    type="button"
                                                    data-testid="agent-thinking-toggle"
                                                    onClick={() => setTurns(prev => toggleTurnThinkingCollapsed(prev, turn.id))}
                                                    className="state-layer focus-ring flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                                                >
                                                    <span className="type-label-m inline-flex min-w-0 items-center gap-1.5 text-on-surface-variant">
                                                        <Icon
                                                            path={mdWandShine}
                                                            size={14}
                                                            className={cn(
                                                                "shrink-0 text-tertiary",
                                                                thinkingLive && "animate-pulse",
                                                            )}
                                                        />
                                                        <span className="truncate font-medium tabular-nums">
                                                            {thinkingLive
                                                                ? t("agentThinkingLive", { duration: thinkingDurationLabel })
                                                                : t("agentThoughtFor", { duration: thinkingDurationLabel })}
                                                        </span>
                                                    </span>
                                                    <Icon
                                                        path={turn.thinkingCollapsed ? mdKeyboardArrowDown : mdKeyboardArrowUp}
                                                        size={15}
                                                        className="shrink-0 text-on-surface-variant"
                                                    />
                                                </button>
                                                {!turn.thinkingCollapsed ? (
                                                    <div className="type-body-s max-h-44 overflow-y-auto border-t border-outline-variant/60 px-2.5 py-2 font-mono text-on-surface-variant whitespace-pre-wrap break-words leading-relaxed">
                                                        {turn.thinking}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {/* Interactive Structured Plan Approval Card */}
                                        {turn.plan ? (
                                            <div className="flex flex-col gap-2.5 rounded-md3-lg border border-outline-variant bg-surface-container p-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-1.5">
                                                        <span className="type-title-s truncate font-semibold text-on-surface">
                                                            {turn.plan.title}
                                                        </span>
                                                        <span className="shrink-0 rounded-md3-xs bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-on-surface-variant">
                                                            {turn.plan.region}
                                                        </span>
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            "shrink-0 rounded-md3-full px-2 py-0.5 type-label-s font-medium",
                                                            turn.plan.status === "approved"
                                                                ? "bg-success-container text-on-success-container"
                                                                : turn.plan.status === "revised"
                                                                    ? "bg-surface-container-highest text-on-surface-variant"
                                                                    : "bg-tertiary-container text-on-tertiary-container",
                                                        )}
                                                    >
                                                        {turn.plan.status === "approved"
                                                            ? t("agentPlanCardApproved")
                                                            : turn.plan.status === "revised"
                                                                ? t("agentPlanCardRevised")
                                                                : t("agentPlanCardTitle")}
                                                    </span>
                                                </div>

                                                {turn.plan.premise ? (
                                                    <p className="type-body-s text-on-surface-variant leading-relaxed">
                                                        {turn.plan.premise}
                                                    </p>
                                                ) : null}

                                                {turn.plan.castPlan.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="type-label-s text-on-surface-variant">
                                                            {t("agentPlanCastLabel")}
                                                        </span>
                                                        <div className="flex flex-wrap gap-1">
                                                            {turn.plan.castPlan.map(c => (
                                                                <span
                                                                    key={c.key}
                                                                    className="type-label-s rounded-md3-full bg-secondary-container px-2 py-0.5 text-on-secondary-container"
                                                                >
                                                                    {c.name} ({c.key})
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {turn.plan.scenes.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="type-label-s text-on-surface-variant">
                                                            {t("agentPlanScenesLabel")}
                                                        </span>
                                                        <ol className="flex flex-col gap-1">
                                                            {turn.plan.scenes.map((sc, sIdx) => (
                                                                <li
                                                                    key={sc.id || sIdx}
                                                                    className="rounded-md3-sm bg-surface-card px-2 py-1.5"
                                                                >
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="type-label-s font-mono text-primary">
                                                                            {sIdx + 1}. {sc.id}
                                                                        </span>
                                                                        <span className="type-label-m truncate text-on-surface">
                                                                            {sc.title}
                                                                        </span>
                                                                    </div>
                                                                    {sc.summary ? (
                                                                        <p className="type-body-s mt-0.5 text-on-surface-variant">
                                                                            {sc.summary}
                                                                        </p>
                                                                    ) : null}
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    </div>
                                                ) : null}

                                                {turn.plan.branches.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="type-label-s text-on-surface-variant">
                                                            {t("agentPlanBranchesLabel")}
                                                        </span>
                                                        <ul className="flex flex-col gap-0.5 pl-3 list-disc">
                                                            {turn.plan.branches.map((br, bIdx) => (
                                                                <li key={bIdx} className="type-body-s text-on-surface">
                                                                    {br}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ) : null}

                                                {turn.plan.endings.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="type-label-s text-on-surface-variant">
                                                            {t("agentPlanEndingsLabel")}
                                                        </span>
                                                        <div className="flex flex-wrap gap-1">
                                                            {turn.plan.endings.map(end => (
                                                                <span
                                                                    key={end.id}
                                                                    className="type-label-s rounded-md3-sm bg-surface-card px-2 py-0.5 text-on-surface"
                                                                >
                                                                    {end.title}
                                                                    {end.condition ? ` (${end.condition})` : ""}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {turn.plan.researchTargets.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="type-label-s text-on-surface-variant">
                                                            {t("agentPlanResearchLabel")}
                                                        </span>
                                                        <div className="flex flex-wrap gap-1">
                                                            {turn.plan.researchTargets.map((target, rIdx) => (
                                                                <span
                                                                    key={rIdx}
                                                                    className="type-label-s rounded-md3-full bg-surface-container-highest px-2 py-0.5 text-on-surface-variant"
                                                                >
                                                                    {target}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {turn.planAwaitingApproval && turn.plan.status === "pending_approval" ? (
                                                    <div className="flex items-center justify-end gap-2 pt-1">
                                                        <Button
                                                            variant="outlined"
                                                            size="xs"
                                                            disabled={isStreaming}
                                                            onClick={() => handleStartRevisePlan(turn.plan!.id)}
                                                        >
                                                            {t("agentPlanReviseButton")}
                                                        </Button>
                                                        <Button
                                                            variant="filled"
                                                            size="xs"
                                                            icon={mdCheckCircle}
                                                            disabled={isStreaming || approvingPlanId === turn.plan.id}
                                                            onClick={() => void handleApprovePlan(turn.plan!.id)}
                                                        >
                                                            {t("agentPlanApproveButton")}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {/* Live Auto-Retry Banner (calm tonal amber) OR Auto-Collapsed Recovered Retry 1-Line Pill */}
                                        {activeRetry ? (
                                            <div
                                                data-testid="agent-retry-live-banner"
                                                className="overflow-hidden rounded-md3-md border border-outline-variant/75 bg-warning-container/80 text-on-warning-container"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setTurns(prev => toggleTurnRetryCollapsed(prev, turn.id))}
                                                    className="state-layer focus-ring flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                                                >
                                                    <span className="type-label-m inline-flex min-w-0 items-center gap-1.5 font-medium">
                                                        <Icon path={mdRefresh} size={14} className="shrink-0 animate-spin" />
                                                        <span className="truncate">
                                                            {t("agentRetryLive", {
                                                                attempt: activeRetry.attempt,
                                                                max: activeRetry.maxAttempts,
                                                            })}
                                                        </span>
                                                    </span>
                                                    <span className="flex shrink-0 items-center gap-1 font-mono type-label-s tabular-nums opacity-85">
                                                        {activeRetry.delayMs > 0
                                                            ? t("agentRetryCountdown", {
                                                                seconds: Math.max(
                                                                    0.1,
                                                                    (activeRetry.startedAt + activeRetry.delayMs - nowMs) / 1000,
                                                                ).toFixed(1),
                                                            })
                                                            : formatElapsedSeconds(Math.max(0, nowMs - activeRetry.startedAt))}
                                                        <Icon
                                                            path={turn.retryNoticeCollapsed ? mdKeyboardArrowDown : mdKeyboardArrowUp}
                                                            size={15}
                                                        />
                                                    </span>
                                                </button>
                                                {!turn.retryNoticeCollapsed && activeRetry.errorMessage ? (
                                                    <div className="type-label-s border-t border-outline-variant/45 px-2.5 py-1.5 font-mono break-words opacity-85">
                                                        {activeRetry.errorMessage}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : recoveredRetries.length > 0 ? (
                                            <div
                                                data-testid="agent-retry-recovered-pill"
                                                data-collapsed={turn.retryNoticeCollapsed ? "true" : "false"}
                                                className="overflow-hidden rounded-md3-md border border-outline-variant/55 bg-surface-container/65"
                                            >
                                                <button
                                                    type="button"
                                                    data-testid="agent-retry-recovered-toggle"
                                                    onClick={() => setTurns(prev => toggleTurnRetryCollapsed(prev, turn.id))}
                                                    className="state-layer focus-ring flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left"
                                                >
                                                    <span className="type-label-s inline-flex min-w-0 items-center gap-1.5 text-on-surface-variant">
                                                        <Icon path={mdRefresh} size={13} className="shrink-0 text-success" />
                                                        <span className="truncate">
                                                            {t("agentRetryRecovered", { count: recoveredRetries.length })}
                                                        </span>
                                                    </span>
                                                    <Icon
                                                        path={turn.retryNoticeCollapsed ? mdKeyboardArrowDown : mdKeyboardArrowUp}
                                                        size={14}
                                                        className="shrink-0 text-on-surface-variant"
                                                    />
                                                </button>
                                                {!turn.retryNoticeCollapsed ? (
                                                    <div className="flex flex-col gap-1 border-t border-outline-variant/50 px-2.5 py-1.5">
                                                        {recoveredRetries.map((entry, rIdx) => (
                                                            <div
                                                                key={`${entry.attempt}_${rIdx}`}
                                                                className="type-label-s font-mono text-on-surface-variant break-words"
                                                            >
                                                                #{entry.attempt}: {entry.errorMessage}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {/* Tool-Call Activity Timeline: auto-collapsed & grouped completed calls + live running + visible error tools */}
                                        {groupedTools.length > 0 ? (
                                            <div className="flex flex-col gap-1.5">
                                                {groupedTools.map(item => {
                                                    if (item.kind === "single") {
                                                        return renderToolRow(item.tool, false);
                                                    }
                                                    const groupKey = `${turn.id}_${item.id}`;
                                                    const isGroupOpen = Boolean(expandedToolGroups[groupKey]);
                                                    return (
                                                        <div
                                                            key={groupKey}
                                                            data-testid="agent-tool-group"
                                                            data-collapsed={isGroupOpen ? "false" : "true"}
                                                            className="overflow-hidden rounded-md3-md border border-outline-variant/60 bg-surface-container/70"
                                                        >
                                                            <button
                                                                type="button"
                                                                data-testid="agent-tool-group-toggle"
                                                                onClick={() =>
                                                                    setExpandedToolGroups(prev => ({
                                                                        ...prev,
                                                                        [groupKey]: !prev[groupKey],
                                                                    }))
                                                                }
                                                                className="state-layer focus-ring flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                                                            >
                                                                <span className="type-label-m inline-flex min-w-0 items-center gap-1.5 text-on-surface-variant">
                                                                    <Icon
                                                                        path={mdCheckCircle}
                                                                        size={14}
                                                                        className="shrink-0 text-success"
                                                                    />
                                                                    <span className="truncate font-medium tabular-nums">
                                                                        {t("agentToolsSummary", {
                                                                            count: item.tools.length,
                                                                            duration: formatElapsedSeconds(item.totalDurationMs),
                                                                        })}
                                                                    </span>
                                                                </span>
                                                                <Icon
                                                                    path={isGroupOpen ? mdKeyboardArrowUp : mdKeyboardArrowDown}
                                                                    size={15}
                                                                    className="shrink-0 text-on-surface-variant"
                                                                />
                                                            </button>
                                                            {isGroupOpen ? (
                                                                <div className="flex flex-col gap-1.5 border-t border-outline-variant/50 p-2">
                                                                    {item.tools.map(subTool => renderToolRow(subTool, true))}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}

                                        {/* .msk Diff Summary Banners */}
                                        {turn.diffs && turn.diffs.length > 0 ? (
                                            <div className="flex flex-col gap-2">
                                                {turn.diffs.map((diff, idx) => {
                                                    const diffKey = `${turn.id}_diff_${idx}`;
                                                    const showPatch = Boolean(expandedDiffs[diffKey]);
                                                    const touchedNodes = [...diff.addedNodeIds, ...diff.modifiedNodeIds];
                                                    const deltaStr =
                                                        diff.beatCountDelta >= 0
                                                            ? `+${diff.beatCountDelta}`
                                                            : String(diff.beatCountDelta);
                                                    return (
                                                        <div
                                                            key={diffKey}
                                                            className="flex flex-col gap-2 rounded-md3-md border border-outline-variant bg-tertiary-container p-2.5 text-on-tertiary-container"
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="type-label-l font-semibold">
                                                                    {t("agentDiffTitle")} · {diff.storyFile}
                                                                </span>
                                                                {diff.snapshotId ? (
                                                                    <Button
                                                                        variant="tonal"
                                                                        size="xs"
                                                                        icon={mdUndo}
                                                                        disabled={rollingBackId === diff.snapshotId}
                                                                        onClick={() => void handleRollback(diff.snapshotId!)}
                                                                    >
                                                                        {t("agentRollbackButton")}
                                                                    </Button>
                                                                ) : null}
                                                            </div>

                                                            <div className="flex flex-wrap gap-1.5">
                                                                {diff.addedNodeIds.length > 0 ? (
                                                                    <span className="type-label-s rounded-md3-full bg-success-container px-2 py-0.5 text-on-success-container">
                                                                        {t("agentDiffAdded", { count: diff.addedNodeIds.length })}
                                                                    </span>
                                                                ) : null}
                                                                {diff.modifiedNodeIds.length > 0 ? (
                                                                    <span className="type-label-s rounded-md3-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">
                                                                        {t("agentDiffModified", { count: diff.modifiedNodeIds.length })}
                                                                    </span>
                                                                ) : null}
                                                                {diff.removedNodeIds.length > 0 ? (
                                                                    <span className="type-label-s rounded-md3-full bg-error-container px-2 py-0.5 text-on-error-container">
                                                                        {t("agentDiffRemoved", { count: diff.removedNodeIds.length })}
                                                                    </span>
                                                                ) : null}
                                                                <span className="type-label-s rounded-md3-full bg-surface-container-highest px-2 py-0.5 text-on-surface">
                                                                    {t("agentDiffBeats", { delta: deltaStr })}
                                                                </span>
                                                            </div>

                                                            {touchedNodes.length > 0 ? (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {touchedNodes.slice(0, 10).map(nodeId => (
                                                                        <button
                                                                            key={nodeId}
                                                                            type="button"
                                                                            onClick={() => onFocusNode(nodeId)}
                                                                            title={`${t("agentJumpToNode")}: ${nodeId}`}
                                                                            className="state-layer focus-ring inline-flex items-center gap-1 rounded-md3-sm bg-surface-card px-2 py-0.5 font-mono type-label-s text-primary"
                                                                        >
                                                                            <Icon path={mdMyLocation} size={13} />
                                                                            {nodeId}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            ) : null}

                                                            {diff.unifiedDiffPreview ? (
                                                                <div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setExpandedDiffs(prev => ({
                                                                                ...prev,
                                                                                [diffKey]: !prev[diffKey],
                                                                            }))
                                                                        }
                                                                        className="type-label-s underline"
                                                                    >
                                                                        {showPatch ? t("agentDiffHide") : t("agentDiffView")}
                                                                    </button>
                                                                    {showPatch ? (
                                                                        <pre className="mt-1.5 max-h-40 overflow-auto rounded-md3-xs bg-surface-container-lowest p-2 font-mono type-label-s text-on-surface">
                                                                            {diff.unifiedDiffPreview}
                                                                        </pre>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}

                                        {/* Safe React Markdown Reply with Clickable Node Chips & Copyable Code Blocks */}
                                        {turn.text ? (
                                            <AgentMarkdown
                                                text={turn.text}
                                                knownNodeIds={knownNodeSet}
                                                onFocusNode={onFocusNode}
                                                jumpToNodeLabel={t("agentJumpToNode")}
                                                copyLabel={t("agentCopyText")}
                                                copiedLabel={t("agentCopied")}
                                            />
                                        ) : null}

                                        {turn.error ? (
                                            <div className="flex flex-col gap-2">
                                                <Banner tone="error">{turn.error}</Banner>
                                                {hasRetryableUserPrompt ? (
                                                    <div className="flex justify-end">
                                                        <Button
                                                            variant="tonal"
                                                            size="xs"
                                                            icon={mdRefresh}
                                                            disabled={!hasActiveProject || isStreaming}
                                                            onClick={() => void handleRetryFromTurn(turnIndex)}
                                                            data-testid="agent-retry-last-btn"
                                                        >
                                                            {t("agentRetryButton")}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {/* Subtle Per-Turn Completion Footer */}
                                        {showCompletionFooter ? (
                                            <div className="flex items-center justify-between gap-2 border-t border-outline-variant/45 pt-2 text-on-surface-variant">
                                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 type-label-s tabular-nums">
                                                    {turnTotalMs !== null ? (
                                                        <span>
                                                            {t("agentTurnDuration", {
                                                                duration: formatElapsedSeconds(turnTotalMs),
                                                            })}
                                                        </span>
                                                    ) : null}
                                                    {turn.stats && turn.stats.totalTokens > 0 ? (
                                                        <>
                                                            <span aria-hidden>·</span>
                                                            <span>
                                                                {t("agentTurnTokens", {
                                                                    count: turn.stats.totalTokens.toLocaleString(locale),
                                                                })}
                                                            </span>
                                                        </>
                                                    ) : null}
                                                </div>
                                                {turn.text ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyTurnText(turn.id, turn.text)}
                                                        className="state-layer focus-ring inline-flex shrink-0 items-center gap-1 rounded-md3-xs px-1.5 py-0.5 type-label-s text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                                                    >
                                                        <Icon
                                                            path={copiedTurnId === turn.id ? mdCheck : mdContentCopy}
                                                            size={13}
                                                            className={copiedTurnId === turn.id ? "text-success" : ""}
                                                        />
                                                        <span>
                                                            {copiedTurnId === turn.id
                                                                ? t("agentCopied")
                                                                : t("agentCopyText")}
                                                        </span>
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Floating "Back to Bottom" Pill when user scrolls up */}
                {showScrollToBottom ? (
                    <button
                        type="button"
                        data-testid="agent-scroll-bottom-pill"
                        onClick={() => scrollToBottom(true)}
                        className="state-layer focus-ring absolute bottom-2.5 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-md3-full border border-outline-variant bg-surface-container-high px-3 py-1 type-label-s font-medium text-on-surface shadow-elev-2 transition-colors hover:bg-surface-container-highest"
                    >
                        <Icon path={mdKeyboardArrowDown} size={15} className="text-primary" />
                        <span>{t("agentScrollToBottom")}</span>
                    </button>
                ) : null}
            </div>

            {/* Codex-Style Composer with Integrated Model & Thinking Effort Footer */}
            <div className="flex shrink-0 flex-col gap-2 border-t border-outline-variant/70 bg-surface-container p-2.5">
                {selectedNodeId || revisingPlanId ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {selectedNodeId ? (
                            <span className="type-label-s inline-flex items-center gap-1 rounded-md3-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">
                                <Icon path={mdMyLocation} size={12} />
                                {t("agentSelectedNodeContext", { nodeId: selectedNodeId })}
                            </span>
                        ) : null}
                        {revisingPlanId ? (
                            <button
                                type="button"
                                onClick={() => setRevisingPlanId(null)}
                                className="type-label-s inline-flex items-center gap-1 rounded-md3-full bg-tertiary-container px-2 py-0.5 text-on-tertiary-container"
                            >
                                <span>{t("agentPlanReviseButton")} ×</span>
                            </button>
                        ) : null}
                    </div>
                ) : null}

                <textarea
                    ref={composerInputRef}
                    rows={1}
                    value={composer}
                    disabled={!hasActiveProject}
                    onChange={e => setComposer(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void handleSendPrompt();
                        }
                    }}
                    placeholder={revisingPlanId ? t("agentPlanRevisePlaceholder") : t("agentComposerPlaceholder")}
                    style={{ minHeight: `${COMPOSER_MIN_HEIGHT_PX}px`, maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px` }}
                    className="type-body-m focus-ring w-full resize-none overflow-y-auto rounded-md3-md border border-outline-variant bg-surface-card px-2.5 py-2 text-on-surface placeholder:text-on-surface-variant disabled:opacity-50"
                />

                {/* Codex-style Bottom Bar: Model Selector Pill + Thinking Effort Pill + Send/Stop */}
                <div className="flex items-center justify-between gap-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        {/* Model Selector Pill */}
                        <button
                            ref={modelBtnRef}
                            type="button"
                            data-testid="agent-model-pill"
                            onClick={() => {
                                setThinkingPopoverOpen(false);
                                setModelPopoverOpen(v => !v);
                            }}
                            title={`${activeProvider}/${activeModel}`}
                            className={cn(
                                "state-layer focus-ring inline-flex h-7 min-w-0 max-w-[260px] items-center gap-1 rounded-md3-full border px-2 type-label-s transition-colors",
                                modelPopoverOpen
                                    ? "border-primary bg-secondary-container text-on-secondary-container"
                                    : "border-outline-variant/80 bg-surface-card text-on-surface hover:bg-surface-container-high",
                            )}
                        >
                            <span className="truncate font-mono">{compactModelLabel(activeModel)}</span>
                            <Icon path={mdKeyboardArrowDown} size={14} className="shrink-0 text-on-surface-variant" />
                        </button>

                        {/* Thinking Effort Pill */}
                        <Tooltip label={t("agentReasoningTooltip")}>
                            <button
                                ref={thinkingBtnRef}
                                type="button"
                                data-testid="agent-thinking-pill"
                                onClick={() => {
                                    setModelPopoverOpen(false);
                                    setThinkingPopoverOpen(v => !v);
                                }}
                                className={cn(
                                    "state-layer focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md3-full border px-2 type-label-s transition-colors",
                                    thinkingPopoverOpen
                                        ? "border-primary bg-secondary-container text-on-secondary-container"
                                        : "border-outline-variant/80 bg-surface-card text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                                )}
                            >
                                <Icon path={mdWandShine} size={13} className="shrink-0 text-tertiary" />
                                <span>{currentThinkingLabel}</span>
                                <Icon path={mdKeyboardArrowDown} size={13} className="shrink-0 text-on-surface-variant" />
                            </button>
                        </Tooltip>
                    </div>

                    {isStreaming ? (
                        <Button
                            variant="tonal"
                            color="error"
                            size="xs"
                            icon={mdStop}
                            onClick={() => void window.moesekaiDesktop.agent.abort()}
                            className="shrink-0"
                        >
                            {t("agentAbort")}
                        </Button>
                    ) : (
                        <Button
                            variant="filled"
                            size="xs"
                            icon={mdSend}
                            disabled={!hasActiveProject || !composer.trim()}
                            onClick={() => void handleSendPrompt()}
                            className="shrink-0"
                        >
                            {t("agentSend")}
                        </Button>
                    )}
                </div>
            </div>

            {/* Portaled Model Selector Popover */}
            {modelPopoverOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={modelPopoverRef}
                        role="dialog"
                        aria-label={t("agentModelLabel")}
                        style={{
                            bottom: `${modelPopoverPos.bottom}px`,
                            left: `${modelPopoverPos.left}px`,
                            width: `${modelPopoverPos.width}px`,
                        }}
                        className="fixed z-[250] flex flex-col gap-2 rounded-md3-xl border border-outline-variant bg-surface-container-high p-3 shadow-elev-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="type-label-s text-on-surface-variant">
                                {modelSource === "live"
                                    ? t("agentModelSourceLive", { count: catalogModels.length })
                                    : t("agentModelSourceCatalog")}
                            </span>
                            <button
                                type="button"
                                disabled={fetchingModels}
                                onClick={() => void handleRefreshModels()}
                                className="state-layer focus-ring inline-flex items-center gap-1 rounded-md3-full bg-surface-container px-2 py-0.5 type-label-s text-primary disabled:opacity-50"
                            >
                                <Icon path={mdRefresh} size={13} className={fetchingModels ? "animate-spin" : ""} />
                                <span>{fetchingModels ? t("agentModelFetching") : t("agentModelRefresh")}</span>
                            </button>
                        </div>

                        {modelFetchError ? (
                            <p className="type-label-s text-on-surface-variant">{modelFetchError}</p>
                        ) : null}

                        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                            {catalogModels.map(opt => {
                                const selected = opt.id === activeModel;
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => void handleSelectModel(opt.id)}
                                        className={cn(
                                            "state-layer focus-ring flex items-center justify-between gap-2 rounded-md3-md px-2.5 py-1.5 text-left transition-colors",
                                            selected
                                                ? "bg-primary-container text-on-primary-container"
                                                : "text-on-surface hover:bg-surface-container",
                                        )}
                                    >
                                        <div className="flex min-w-0 flex-col">
                                            <span className="type-label-m truncate font-medium">
                                                {opt.name || opt.id}
                                            </span>
                                            <span className="type-label-s truncate font-mono opacity-75">
                                                {opt.id}
                                            </span>
                                        </div>
                                        {selected ? (
                                            <Icon path={mdCheck} size={15} className="shrink-0" />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Custom Model ID inline apply */}
                        <div className="flex items-center gap-1.5 border-t border-outline-variant/60 pt-2">
                            <input
                                type="text"
                                value={customModelDraft}
                                onChange={e => setCustomModelDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter" && customModelDraft.trim()) {
                                        e.preventDefault();
                                        void handleSelectModel(customModelDraft);
                                    }
                                }}
                                placeholder={t("agentModelCustomPlaceholder")}
                                className="type-label-m focus-ring min-w-0 flex-1 rounded-md3-sm border border-outline-variant bg-surface-card px-2 py-1 font-mono text-on-surface placeholder:text-on-surface-variant"
                            />
                            <Button
                                variant="tonal"
                                size="xs"
                                disabled={!customModelDraft.trim()}
                                onClick={() => void handleSelectModel(customModelDraft)}
                            >
                                {t("agentModelApplyCustom")}
                            </Button>
                        </div>
                    </div>,
                    document.body,
                )
                : null}

            {/* Portaled Thinking Effort Popover */}
            {thinkingPopoverOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={thinkingPopoverRef}
                        role="dialog"
                        aria-label={t("agentReasoningTooltip")}
                        style={{
                            bottom: `${thinkingPopoverPos.bottom}px`,
                            right: `${thinkingPopoverPos.right}px`,
                        }}
                        className="fixed z-[250] flex w-40 flex-col gap-0.5 rounded-md3-xl border border-outline-variant bg-surface-container-high p-2 shadow-elev-3"
                    >
                        <span className="px-2 py-1 type-label-s text-on-surface-variant">
                            {t("agentReasoningTooltip")}
                        </span>
                        {THINKING_LEVEL_META.map(opt => {
                            const selected = opt.value === thinkingLevel;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => void handleSelectThinkingLevel(opt.value)}
                                    className={cn(
                                        "state-layer focus-ring flex items-center justify-between gap-2 rounded-md3-md px-2.5 py-1.5 text-left type-label-m transition-colors",
                                        selected
                                            ? "bg-primary-container text-on-primary-container font-medium"
                                            : "text-on-surface hover:bg-surface-container",
                                    )}
                                >
                                    <span>{t(opt.labelKey)}</span>
                                    {selected ? <Icon path={mdCheck} size={14} className="shrink-0" /> : null}
                                </button>
                            );
                        })}
                    </div>,
                    document.body,
                )
                : null}
        </aside>
    );
});
