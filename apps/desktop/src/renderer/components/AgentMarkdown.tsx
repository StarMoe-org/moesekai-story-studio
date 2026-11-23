import React, { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@moesekai/story-editor/md3";
import { mdCheck, mdContentCopy, mdMyLocation } from "@moesekai/story-editor/md3/icons";

export interface AgentMarkdownProps {
    text: string;
    knownNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    jumpToNodeLabel: string;
    copyLabel: string;
    copiedLabel: string;
}

const NODE_ID_PATTERN =
    /(#([A-Za-z][A-Za-z0-9_-]{1,31})|\b((?:scene|choice|cond|condition|end|start)_[A-Za-z0-9_-]{1,26})\b|\b([A-Za-z][A-Za-z0-9_-]{1,31})\b)/g;

const PREFIXED_NODE_ID_ONLY = /^(?:scene|choice|cond|condition|end|start)_[A-Za-z0-9_-]{1,26}$/;

function isRecognizedNodeId(candidate: string, knownNodeIds: Set<string>, hasPrefixMatch: boolean): boolean {
    if (!candidate) return false;
    if (knownNodeIds.size > 0) {
        return knownNodeIds.has(candidate) || hasPrefixMatch;
    }
    return hasPrefixMatch;
}

function renderNodeChipButton(
    nodeId: string,
    key: string,
    onFocusNode: (nodeId: string) => void,
    jumpToNodeLabel: string,
): React.ReactElement {
    return (
        <button
            key={key}
            type="button"
            data-testid={`agent-node-chip-${nodeId}`}
            onClick={() => onFocusNode(nodeId)}
            title={`${jumpToNodeLabel}: ${nodeId}`}
            className="state-layer focus-ring mx-0.5 inline-flex items-center gap-0.5 rounded-md3-xs bg-primary-container px-1.5 py-0.5 font-mono type-label-s text-on-primary-container align-baseline"
        >
            <Icon path={mdMyLocation} size={12} className="shrink-0" />
            <span>{nodeId}</span>
        </button>
    );
}

function replaceStringWithNodeChips(
    segment: string,
    keyPrefix: string,
    knownNodeIds: Set<string>,
    onFocusNode: (nodeId: string) => void,
    jumpToNodeLabel: string,
): React.ReactNode {
    if (!segment) return segment;
    const out: React.ReactNode[] = [];
    let lastIdx = 0;
    let matchedAny = false;

    for (const match of segment.matchAll(NODE_ID_PATTERN)) {
        const idx = match.index ?? 0;
        const raw = match[0];
        const hashId = match[2];
        const prefixedId = match[3];
        const bareWord = match[4];
        const candidate = hashId ?? prefixedId ?? bareWord ?? "";

        if (!isRecognizedNodeId(candidate, knownNodeIds, Boolean(prefixedId))) {
            continue;
        }

        matchedAny = true;
        if (idx > lastIdx) {
            out.push(
                <React.Fragment key={`${keyPrefix}_t_${lastIdx}`}>
                    {segment.slice(lastIdx, idx)}
                </React.Fragment>,
            );
        }
        out.push(renderNodeChipButton(candidate, `${keyPrefix}_n_${idx}`, onFocusNode, jumpToNodeLabel));
        lastIdx = idx + raw.length;
    }

    if (!matchedAny) return segment;

    if (lastIdx < segment.length) {
        out.push(
            <React.Fragment key={`${keyPrefix}_t_${lastIdx}`}>
                {segment.slice(lastIdx)}
            </React.Fragment>,
        );
    }

    return out;
}

function injectNodeChipsInChildren(
    children: React.ReactNode,
    keyPrefix: string,
    knownNodeIds: Set<string>,
    onFocusNode: (nodeId: string) => void,
    jumpToNodeLabel: string,
): React.ReactNode {
    return React.Children.map(children, (child, idx) => {
        if (typeof child === "string") {
            return replaceStringWithNodeChips(
                child,
                `${keyPrefix}_${idx}`,
                knownNodeIds,
                onFocusNode,
                jumpToNodeLabel,
            );
        }
        return child;
    });
}

const CodeBlockCard: React.FC<{
    lang: string;
    content: string;
    copyLabel: string;
    copiedLabel: string;
}> = ({ lang, content, copyLabel, copiedLabel }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(content).catch(() => {});
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    return (
        <div className="my-1 overflow-hidden rounded-md3-md border border-outline-variant/70 bg-surface-container-lowest">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant/50 bg-surface-container px-2.5 py-1">
                <span className="font-mono type-label-s uppercase tracking-wide text-on-surface-variant">
                    {lang || "code"}
                </span>
                <button
                    type="button"
                    data-testid="agent-code-copy-btn"
                    onClick={handleCopy}
                    className="state-layer focus-ring inline-flex items-center gap-1 rounded-md3-xs px-1.5 py-0.5 type-label-s text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                    <Icon path={copied ? mdCheck : mdContentCopy} size={13} className={copied ? "text-success" : ""} />
                    <span>{copied ? copiedLabel : copyLabel}</span>
                </button>
            </div>
            <pre className="max-h-60 overflow-x-auto p-2.5 font-mono text-[12px] leading-relaxed text-on-surface">
                <code>{content}</code>
            </pre>
        </div>
    );
};

function extractPlainCodeText(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractPlainCodeText).join("");
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
        return extractPlainCodeText(node.props.children);
    }
    return "";
}

export const AgentMarkdown: React.FC<AgentMarkdownProps> = ({
    text,
    knownNodeIds,
    onFocusNode,
    jumpToNodeLabel,
    copyLabel,
    copiedLabel,
}) => {
    const components = useMemo<Components>(
        () => ({
            h1: ({ children }) => (
                <h1 className="type-title-m mt-1 font-semibold text-on-surface">
                    {injectNodeChipsInChildren(children, "h1", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </h1>
            ),
            h2: ({ children }) => (
                <h2 className="type-title-s mt-1 font-semibold text-on-surface">
                    {injectNodeChipsInChildren(children, "h2", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </h2>
            ),
            h3: ({ children }) => (
                <h3 className="type-label-l mt-0.5 font-semibold text-on-surface">
                    {injectNodeChipsInChildren(children, "h3", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </h3>
            ),
            h4: ({ children }) => (
                <h4 className="type-label-m font-semibold text-on-surface">
                    {injectNodeChipsInChildren(children, "h4", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </h4>
            ),
            p: ({ children }) => (
                <p className="whitespace-pre-wrap break-words leading-relaxed text-on-surface">
                    {injectNodeChipsInChildren(children, "p", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </p>
            ),
            strong: ({ children }) => (
                <strong className="font-semibold text-on-surface">
                    {injectNodeChipsInChildren(children, "strong", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </strong>
            ),
            em: ({ children }) => (
                <em className="italic text-on-surface">
                    {injectNodeChipsInChildren(children, "em", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </em>
            ),
            ul: ({ children }) => (
                <ul className="flex flex-col gap-1 pl-4 list-disc">
                    {children}
                </ul>
            ),
            ol: ({ children }) => (
                <ol className="flex flex-col gap-1 pl-4 list-decimal">
                    {children}
                </ol>
            ),
            li: ({ children }) => (
                <li className="leading-relaxed text-on-surface">
                    {injectNodeChipsInChildren(children, "li", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </li>
            ),
            blockquote: ({ children }) => (
                <blockquote className="rounded-r-md3-sm border-l-2 border-primary/70 bg-surface-container/60 px-2.5 py-1.5 text-on-surface-variant">
                    {children}
                </blockquote>
            ),
            hr: () => <hr className="my-1 border-outline-variant/60" />,
            pre: ({ children }) => {
                // Fenced code blocks come through as <pre><code className="language-xxx">...</code></pre>
                const childArr = React.Children.toArray(children);
                const first = childArr[0];
                let lang = "";
                let rawContent = "";
                if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(first)) {
                    const cls = first.props.className || "";
                    const langMatch = cls.match(/language-([A-Za-z0-9_-]+)/);
                    lang = langMatch?.[1] ?? "";
                    rawContent = extractPlainCodeText(first.props.children).replace(/\n$/, "");
                } else {
                    rawContent = extractPlainCodeText(children).replace(/\n$/, "");
                }
                return (
                    <CodeBlockCard
                        lang={lang}
                        content={rawContent}
                        copyLabel={copyLabel}
                        copiedLabel={copiedLabel}
                    />
                );
            },
            code: ({ className, children }) => {
                // Block code inside <pre> is handled by `pre` above; inline code arrives here cleanly
                const raw = extractPlainCodeText(children).trim();
                const isNodeChip = isRecognizedNodeId(raw, knownNodeIds, PREFIXED_NODE_ID_ONLY.test(raw));
                if (isNodeChip && !className) {
                    return renderNodeChipButton(raw, `ic_${raw}`, onFocusNode, jumpToNodeLabel);
                }
                return (
                    <code className="rounded-md3-xs bg-surface-container-highest px-1.5 py-0.5 font-mono text-[12px] text-on-surface">
                        {children}
                    </code>
                );
            },
            table: ({ children }) => (
                <div
                    data-testid="agent-markdown-table"
                    className="my-1 w-full overflow-x-auto rounded-md3-md border border-outline-variant/75 bg-surface-card"
                >
                    <table className="w-full border-collapse text-left type-body-s">
                        {children}
                    </table>
                </div>
            ),
            thead: ({ children }) => (
                <thead className="bg-surface-container-low text-on-surface">
                    {children}
                </thead>
            ),
            tbody: ({ children }) => (
                <tbody className="divide-y divide-outline-variant/50">
                    {children}
                </tbody>
            ),
            tr: ({ children }) => (
                <tr className="transition-colors hover:bg-surface-container-low/60">
                    {children}
                </tr>
            ),
            th: ({ children }) => (
                <th className="border-b border-outline-variant/70 px-2.5 py-1.5 text-left type-label-m font-semibold text-on-surface whitespace-nowrap">
                    {injectNodeChipsInChildren(children, "th", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </th>
            ),
            td: ({ children }) => (
                <td className="px-2.5 py-1.5 align-top leading-relaxed text-on-surface">
                    {injectNodeChipsInChildren(children, "td", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </td>
            ),
            a: ({ href, children }) => (
                <span
                    title={href}
                    className="font-medium text-primary underline decoration-primary/50 underline-offset-2"
                >
                    {injectNodeChipsInChildren(children, "a", knownNodeIds, onFocusNode, jumpToNodeLabel)}
                </span>
            ),
            // Disallow rendering external arbitrary <img> inside Agent chat for security consistency
            img: ({ alt }) => (alt ? <span className="type-label-s text-on-surface-variant">[{alt}]</span> : null),
        }),
        [copiedLabel, copyLabel, jumpToNodeLabel, knownNodeIds, onFocusNode],
    );

    if (!text.trim()) return null;

    return (
        <div className="flex flex-col gap-2 type-body-m text-on-surface break-words leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
};
