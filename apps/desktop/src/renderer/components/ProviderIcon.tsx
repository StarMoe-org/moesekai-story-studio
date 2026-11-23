import React from "react";

export type ProviderIconBrand =
    | "openai"
    | "anthropic"
    | "google"
    | "deepseek"
    | "qwen"
    | "xai"
    | "openrouter"
    | "ollama"
    | "moonshot"
    | "zhipu"
    | "mistral"
    | "custom";

/**
 * Resolves a mainstream LLM brand icon from `(providerId, modelId?)`.
 * For aggregator or OpenAI-compatible gateways (`openrouter`, `custom`, `openai`, etc.),
 * inspects `modelId` first so e.g. `anthropic/claude-opus-5-5` or `DeepSeek-V4.1-Flash`
 * displays the model family's crisp vector mark.
 */
export function resolveProviderBrand(providerId?: string | null, modelId?: string | null): ProviderIconBrand {
    const p = (providerId ?? "").trim().toLowerCase();
    const m = (modelId ?? "").trim().toLowerCase();

    const matchText = (value: string): ProviderIconBrand | null => {
        if (!value) return null;
        if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
        if (value.includes("deepseek")) return "deepseek";
        if (value.includes("gemini") || value.includes("google") || value.includes("palm") || value.includes("gemma")) {
            return "google";
        }
        if (value.includes("qwen") || value.includes("dashscope") || value.includes("alibaba") || value.includes("tongyi") || value.includes("qwq")) {
            return "qwen";
        }
        if (value.includes("grok") || value === "xai" || value.startsWith("xai/") || value.startsWith("x-ai/")) {
            return "xai";
        }
        if (value.includes("kimi") || value.includes("moonshot")) return "moonshot";
        if (value.includes("glm") || value.includes("zhipu") || value.includes("bigmodel") || value.includes("chatglm")) {
            return "zhipu";
        }
        if (value.includes("mistral") || value.includes("mixtral") || value.includes("codestral") || value.includes("pixtral") || value.includes("ministral")) {
            return "mistral";
        }
        if (value.includes("ollama") || value.includes("llama") || value.includes("local")) return "ollama";
        if (
            value.includes("openai") ||
            /(^|[/:_-])(gpt|chatgpt|o1|o3|o4)([.-]|$)/.test(value)
        ) {
            return "openai";
        }
        if (value.includes("openrouter")) return "openrouter";
        return null;
    };

    // When a modelId is provided, prefer the specific model family brand (especially useful on
    // OpenRouter, OpenAI-compatible proxies, and multi-model gateways).
    const modelBrand = matchText(m);
    if (modelBrand && (p === "" || p === "openrouter" || p === "custom" || p === "openai" || p === "openai-compatible" || p === "vercel-ai-gateway")) {
        return modelBrand;
    }

    const providerBrand = matchText(p);
    if (providerBrand) return providerBrand;
    if (modelBrand) return modelBrand;
    return "custom";
}

export interface ProviderIconProps {
    provider?: string | null;
    model?: string | null;
    size?: number;
    className?: string;
}

const OPENAI_PETAL_ANGLES = [0, 60, 120, 180, 240, 300] as const;
const OPENAI_STRAND_PATH = "M10.5 14.6L16.93 14.6A4.4 4.4 0 0 0 17.19 5.81";

/**
 * Crisp zero-network flat inline SVG brand marks for mainstream LLM providers.
 * Every glyph is mathematically centered on `(12, 12)` in `viewBox="0 0 24 24"` and
 * inherits `currentColor` so light/dark MD3 color tokens stay high-contrast everywhere.
 */
export const ProviderIcon: React.FC<ProviderIconProps> = ({
    provider,
    model,
    size = 15,
    className,
}) => {
    const brand = resolveProviderBrand(provider, model);

    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            aria-hidden="true"
            data-provider-brand={brand}
            className={className ? `inline-block shrink-0 align-middle ${className}` : "inline-block shrink-0 align-middle"}
        >
            {brand === "openai" ? (
                /* Mathematically exact 6-fold rotationally symmetric OpenAI blossom centered at (12, 12) */
                <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    {OPENAI_PETAL_ANGLES.map(angle => (
                        <path
                            key={angle}
                            d={OPENAI_STRAND_PATH}
                            transform={angle === 0 ? undefined : `rotate(${angle} 12 12)`}
                        />
                    ))}
                </g>
            ) : brand === "anthropic" ? (
                /* Anthropic / Claude geometric tilted A-mark centered at (12, 12) */
                <g fill="currentColor">
                    <path d="M13.9 4.5h2.65l4.35 15h-2.7l-1-3.75h-4.1l-1 3.75H9.4l4.5-15Zm1.22 3.85-1.42 5.25h2.84l-1.42-5.25Z" />
                    <path d="M7.65 4.5h2.55L5.95 19.5H3.4L7.65 4.5Z" opacity="0.82" />
                </g>
            ) : brand === "google" ? (
                /* Google Gemini 4-point star centered at (12, 12) */
                <path
                    fill="currentColor"
                    d="M12 2.5c.78 4.75 4.75 8.72 9.5 9.5-4.75.78-8.72 4.75-9.5 9.5-.78-4.75-4.75-8.72-9.5-9.5 4.75-.78 8.72-4.75 9.5-9.5Z"
                />
            ) : brand === "deepseek" ? (
                /* DeepSeek clean whale silhouette centered at (12, 12) */
                <g fill="currentColor">
                    <path d="M19.3 11.4c.12-3.35-2.65-6-6.35-6-3.25 0-5.75 1.92-6.72 4.55-1.08-.72-2.28-1.08-3.35-.72.36 1.44 1.2 2.52 2.4 3.24-.24.6-.36 1.2-.36 1.8 0 3 2.88 5.04 7.08 5.04 4.44 0 7.44-2.64 7.44-6.48 0-.48 0-.96-.14-1.43Zm-4.44.84a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" />
                    <path d="M19.45 6.05c.72.24 1.44.84 1.68 1.68-.84.12-1.56-.12-2.16-.6.12-.36.24-.72.48-1.08Z" opacity="0.85" />
                </g>
            ) : brand === "qwen" ? (
                /* Qwen / Alibaba geometric Q-star centered at (12, 12) */
                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11.4" cy="11.4" r="6.6" />
                    <path d="M16.1 16.1L20.4 20.4" />
                    <path d="M11.4 8.0v6.8M8.0 11.4h6.8" strokeWidth="1.65" opacity="0.75" />
                </g>
            ) : brand === "xai" ? (
                /* xAI / Grok diagonal slash-X mark centered at (12, 12) */
                <g fill="currentColor">
                    <path d="M3.8 19.8L16.4 4.2h3.5L7.3 19.8H3.8Z" />
                    <path d="M4.3 4.2h3.25l3.85 5.05-1.75 2.15L4.3 4.2Z" />
                    <path d="M14.15 12.85l1.75-2.15 4.25 9.1h-3.35l-2.65-6.95Z" />
                </g>
            ) : brand === "openrouter" ? (
                /* OpenRouter branching route nodes centered at (12, 12) */
                <g stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5.2" cy="12" r="2.2" fill="currentColor" stroke="none" />
                    <circle cx="18.8" cy="6.4" r="2.2" fill="currentColor" stroke="none" />
                    <circle cx="18.8" cy="17.6" r="2.2" fill="currentColor" stroke="none" />
                    <path d="M7.4 12h2.8c1.6 0 2.6-.75 3.45-2.3l.95-1.85c.5-.85 1.2-1.45 2.15-1.45h.35" />
                    <path d="M10.2 12c1.6 0 2.6.75 3.45 2.3l.95 1.85c.5.85 1.2 1.45 2.15 1.45h.35" />
                </g>
            ) : brand === "ollama" ? (
                /* Ollama minimalist llama-head silhouette centered at (12, 12) */
                <g stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7.8 9.1V4.9c0-.85.6-1.35 1.32-.95.6.35 1.08 1.3 1.2 2.65h3.36c.12-1.35.6-2.3 1.2-2.65.72-.4 1.32.1 1.32.95v4.2c1.45.95 2.4 2.65 2.4 4.55 0 3.35-2.9 6-6.6 6s-6.6-2.65-6.6-6c0-1.9.95-3.6 2.4-4.55Z" />
                    <circle cx="9.85" cy="13" r="1.0" fill="currentColor" stroke="none" />
                    <circle cx="14.15" cy="13" r="1.0" fill="currentColor" stroke="none" />
                    <path d="M10.9 15.7c.72.48 1.48.48 2.2 0" />
                </g>
            ) : brand === "moonshot" ? (
                /* Moonshot / Kimi crescent + star centered at (12, 12) */
                <g fill="currentColor">
                    <path d="M15.4 17.2A6.9 6.9 0 0 1 9.2 4.8a7.7 7.7 0 1 0 10 10 6.8 6.8 0 0 1-3.8 2.4Z" />
                    <circle cx="17.1" cy="7" r="1.65" />
                </g>
            ) : brand === "zhipu" ? (
                /* Zhipu / GLM geometric Z mark centered at (12, 12) */
                <path
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.2 6.2h13.6L5.2 17.8h13.6"
                />
            ) : brand === "mistral" ? (
                /* Mistral stepped M-bars centered at (12, 12) */
                <g fill="currentColor">
                    <rect x="3.6" y="4.8" width="3.1" height="3.1" rx="0.5" />
                    <rect x="17.3" y="4.8" width="3.1" height="3.1" rx="0.5" />
                    <rect x="3.6" y="8.5" width="6.5" height="3.1" rx="0.5" />
                    <rect x="13.9" y="8.5" width="6.5" height="3.1" rx="0.5" />
                    <rect x="3.6" y="12.2" width="16.8" height="3.1" rx="0.5" />
                    <rect x="3.6" y="15.9" width="3.1" height="3.3" rx="0.5" />
                    <rect x="10.45" y="15.9" width="3.1" height="3.3" rx="0.5" />
                    <rect x="17.3" y="15.9" width="3.1" height="3.3" rx="0.5" />
                </g>
            ) : (
                /* Custom / OpenAI-Compatible server mark centered at (12, 12) */
                <g stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4.2" y="5" width="15.6" height="5.3" rx="1.6" />
                    <rect x="4.2" y="13.7" width="15.6" height="5.3" rx="1.6" />
                    <circle cx="7.7" cy="7.65" r="0.85" fill="currentColor" stroke="none" />
                    <circle cx="7.7" cy="16.35" r="0.85" fill="currentColor" stroke="none" />
                    <path d="M12 10.3v3.4" />
                </g>
            )}
        </svg>
    );
};
