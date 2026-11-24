import React, { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStoryI18n } from "../context/StoryStudioContext";
import { Icon } from "../md3";
import { mdCheck, mdContentCopy, mdMyLocation } from "../md3/icons";

export interface AgentMarkdownProps {
    text: string;
    /** The story's node ids; inline code naming one becomes a jump chip. */
    nodeIds?: ReadonlySet<string>;
    onOpenNode?: (nodeId: string) => void;
}

const COPIED_MS = 1600;

/** The plain text inside rendered markdown children. */
function plainText(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(plainText).join("");
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) return plainText(node.props.children);
    return "";
}

function CodeBlock({ language, code }: { language: string; code: string }) {
    const { t } = useStoryI18n();
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), COPIED_MS);
        });
    };
    return (
        <div className="overflow-hidden rounded-md3-md border border-outline-variant/70 bg-surface-container-lowest">
            <div className="flex items-center justify-between border-b border-outline-variant/50 bg-surface-container px-2.5 py-1">
                <span className="type-label-s font-mono uppercase text-on-surface-variant">{language || "code"}</span>
                <button
                    type="button"
                    onClick={copy}
                    className="state-layer type-label-s inline-flex items-center gap-1 rounded-md3-xs px-1.5 py-0.5 text-on-surface-variant"
                >
                    <Icon path={copied ? mdCheck : mdContentCopy} size={13} />
                    {t(copied ? "page.storyMaker.v2.script.copied" : "page.storyMaker.v2.script.copyCode")}
                </button>
            </div>
            <pre className="max-h-60 overflow-auto p-2.5 font-mono text-[12px] leading-relaxed text-on-surface">
                <code>{code}</code>
            </pre>
        </div>
    );
}

/** An agent reply: GitHub-flavoured markdown in the panel's type scale, node ids as jump chips. */
export function AgentMarkdown({ text, nodeIds, onOpenNode }: AgentMarkdownProps) {
    const components = useMemo<Components>(() => ({
        h1: ({ children }) => <h3 className="type-title-m font-semibold">{children}</h3>,
        h2: ({ children }) => <h4 className="type-title-s font-semibold">{children}</h4>,
        h3: ({ children }) => <h5 className="type-label-l font-semibold">{children}</h5>,
        h4: ({ children }) => <h6 className="type-label-m font-semibold">{children}</h6>,
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
        blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/70 pl-2.5 text-on-surface-variant">{children}</blockquote>
        ),
        hr: () => <hr className="border-outline-variant/60" />,
        pre: ({ children }) => {
            const code = React.Children.toArray(children)[0];
            const className = React.isValidElement<{ className?: string }>(code) ? code.props.className ?? "" : "";
            const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
            return <CodeBlock language={language} code={plainText(children).replace(/\n$/, "")} />;
        },
        code: ({ className, children }) => {
            const id = plainText(children);
            if (!className && onOpenNode && nodeIds?.has(id)) {
                return (
                    <button
                        type="button"
                        onClick={() => onOpenNode(id)}
                        className="state-layer type-label-s inline-flex items-center gap-0.5 rounded-md3-xs bg-primary-container px-1.5 py-0.5 align-baseline font-mono text-on-primary-container"
                    >
                        <Icon path={mdMyLocation} size={12} />
                        {id}
                    </button>
                );
            }
            return <code className="rounded-md3-xs bg-surface-container-highest px-1 py-0.5 font-mono text-[0.92em]">{children}</code>;
        },
        table: ({ children }) => (
            <div className="overflow-x-auto rounded-md3-md border border-outline-variant/70">
                <table className="type-body-s w-full border-collapse text-left">{children}</table>
            </div>
        ),
        th: ({ children }) => <th className="border-b border-outline-variant/70 bg-surface-container-low px-2 py-1 font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-t border-outline-variant/40 px-2 py-1 align-top">{children}</td>,
        // Links and images from a model reply are shown, never followed or loaded.
        a: ({ href, children }) => <span title={href} className="text-primary underline underline-offset-2">{children}</span>,
        img: ({ alt }) => (alt ? <span className="text-on-surface-variant">[{alt}]</span> : null),
    }), [nodeIds, onOpenNode]);

    return (
        <div className="type-body-m flex flex-col gap-2 break-words text-on-surface">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
}
