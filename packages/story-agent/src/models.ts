/**
 * Curated late-2026 frontier model catalog, runtime registry merging, and live
 * provider `/models` discovery for MoeSekai Story Studio Agent.
 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import type {
    FetchProviderModelsResult,
    KnownProviderInfo,
    StoryAgentCustomApi,
    StoryAgentProviderConfig,
    StoryModelOption,
} from "./types";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const ANTHROPIC_API_VERSION = "2023-06-01";

interface CuratedModelSeed {
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    isDefault?: boolean;
}

export interface CuratedProviderDefaults {
    id: string;
    name: string;
    defaultModel: string;
    defaultBaseUrl: string;
    api: StoryAgentCustomApi;
    models: CuratedModelSeed[];
}

export const CURATED_FRONTIER_PROVIDERS: Record<string, CuratedProviderDefaults> = {
    anthropic: {
        id: "anthropic",
        name: "Anthropic (Claude)",
        defaultModel: "claude-opus-5-5",
        defaultBaseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        models: [
            { id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000, isDefault: true },
            { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000 },
            { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", reasoning: true, contextWindow: 200_000, maxTokens: 32_000 },
            { id: "claude-opus-5", name: "Claude Opus 5", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000 },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000 },
            { id: "claude-opus-4-8", name: "Claude Opus 4.8", reasoning: true, contextWindow: 200_000, maxTokens: 32_000 },
        ],
    },
    openai: {
        id: "openai",
        name: "OpenAI",
        defaultModel: "gpt-6.2-astra",
        defaultBaseUrl: "https://api.openai.com/v1",
        api: "openai-responses",
        models: [
            { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", reasoning: true, contextWindow: 400_000, maxTokens: 64_000, isDefault: true },
            { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", reasoning: true, contextWindow: 400_000, maxTokens: 64_000 },
            { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", reasoning: true, contextWindow: 400_000, maxTokens: 64_000 },
            { id: "gpt-6-luna", name: "GPT-6 Luna", reasoning: true, contextWindow: 400_000, maxTokens: 32_000 },
            { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true, contextWindow: 400_000, maxTokens: 32_000 },
            { id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 400_000, maxTokens: 32_000 },
            { id: "gpt-5", name: "GPT-5", reasoning: true, contextWindow: 400_000, maxTokens: 32_000 },
        ],
    },
    google: {
        id: "google",
        name: "Google Gemini",
        defaultModel: "gemini-4-carbon",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        api: "google-generative-ai",
        models: [
            { id: "gemini-4-carbon", name: "Gemini 4 Carbon", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536, isDefault: true },
            { id: "gemini-4-neon", name: "Gemini 4 Neon", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 },
            { id: "gemini-4-argon", name: "Gemini 4 Argon", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 },
            { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 },
            { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 },
        ],
    },
    openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        defaultModel: "anthropic/claude-opus-5.5",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        api: "openai-completions",
        models: [
            { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5 (OpenRouter)", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000, isDefault: true },
            { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5 (OpenRouter)", reasoning: true, contextWindow: 1_000_000, maxTokens: 64_000 },
            { id: "openai/gpt-6.2-astra", name: "GPT-6.2 Astra (OpenRouter)", reasoning: true, contextWindow: 400_000, maxTokens: 64_000 },
            { id: "google/gemini-4-carbon", name: "Gemini 4 Carbon (OpenRouter)", reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 },
            { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (OpenRouter)", reasoning: true, contextWindow: 128_000, maxTokens: 32_000 },
        ],
    },
    deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        defaultModel: "deepseek-v4-pro",
        defaultBaseUrl: "https://api.deepseek.com/v1",
        api: "openai-completions",
        models: [
            { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, contextWindow: 128_000, maxTokens: 32_000, isDefault: true },
            { id: "deepseek-flash", name: "DeepSeek Flash", reasoning: true, contextWindow: 128_000, maxTokens: 16_384 },
        ],
    },
    custom: {
        id: "custom",
        name: "Custom OpenAI-Compatible",
        defaultModel: "gpt-6.2-astra",
        defaultBaseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        models: [],
    },
};

export const PREFERRED_PROVIDER_ORDER = [
    "anthropic",
    "openai",
    "google",
    "openrouter",
    "deepseek",
    "xai",
    "groq",
    "mistral",
    "moonshotai",
    "zai",
    "custom",
];

const REASONING_MODEL_HINT_RE =
    /(?:claude-(?:opus|sonnet|haiku|fable)-(?:4\.[5-9]|4-[5-9]|5)|gpt-(?:5|6)|^o[134](?:$|[-.])|gemini-(?:2\.5|3|4)|deepseek-(?:v4|r1|flash|reasoner)|qwq|thinking|reasoner)/i;

export function inferModelSupportsThinking(modelId: string, registryModel?: Model<Api>): boolean {
    if (registryModel) return Boolean(registryModel.reasoning);
    return REASONING_MODEL_HINT_RE.test(modelId.trim());
}

export function getCuratedDefaultModelId(providerId: string): string | undefined {
    const key = providerId.trim().toLowerCase();
    return CURATED_FRONTIER_PROVIDERS[key]?.defaultModel;
}

export function getCuratedCatalogModels(
    providerId: string,
    registryModels: readonly Model<Api>[] = [],
): StoryModelOption[] {
    const key = providerId.trim().toLowerCase();
    const curated = CURATED_FRONTIER_PROVIDERS[key];
    const registryById = new Map<string, Model<Api>>(registryModels.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const result: StoryModelOption[] = [];

    // 1. Curated frontier late-2026 models pinned at top (enriched with exact runtime registry limits)
    for (const seed of curated?.models ?? []) {
        const reg = registryById.get(seed.id);
        seen.add(seed.id);
        const reasoning = reg ? Boolean(reg.reasoning) : seed.reasoning;
        result.push({
            id: seed.id,
            name: reg?.name || seed.name,
            provider: key,
            reasoning,
            supportsThinking: reasoning,
            contextWindow: reg?.contextWindow ?? seed.contextWindow,
            maxTokens: reg?.maxTokens ?? seed.maxTokens,
            ...(seed.isDefault ? { isDefault: true } : {}),
            source: "curated",
        });
    }

    // 2. Deduplicated remaining models from runtime registry, newest/reasoning first
    const extras = registryModels
        .filter((m) => !seen.has(m.id))
        .sort((a, b) => {
            if (Number(b.reasoning) !== Number(a.reasoning)) {
                return Number(b.reasoning) - Number(a.reasoning);
            }
            return b.id.localeCompare(a.id, undefined, { numeric: true });
        });

    for (const m of extras) {
        seen.add(m.id);
        result.push({
            id: m.id,
            name: m.name || m.id,
            provider: key,
            reasoning: Boolean(m.reasoning),
            supportsThinking: Boolean(m.reasoning),
            contextWindow: m.contextWindow || 128_000,
            maxTokens: m.maxTokens,
            source: "registry",
        });
    }

    if (result.length > 0 && !result.some((m) => m.isDefault)) {
        result[0] = { ...result[0], isDefault: true };
    }

    return result;
}

export async function listKnownProviders(): Promise<KnownProviderInfo[]> {
    const mr = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false,
    });
    const byId = new Map<string, KnownProviderInfo>();

    for (const p of mr.getProviders()) {
        const curated = CURATED_FRONTIER_PROVIDERS[p.id];
        const mergedModels = getCuratedCatalogModels(p.id, mr.getModels(p.id));
        byId.set(p.id, {
            id: p.id,
            name: curated?.name ?? p.name ?? p.id,
            defaultModel: curated?.defaultModel ?? mergedModels[0]?.id,
            defaultBaseUrl: curated?.defaultBaseUrl ?? mr.getModels(p.id)[0]?.baseUrl,
            api: curated?.api,
            sampleModels: mergedModels.slice(0, 20),
        });
    }

    // Ensure curated providers (including "custom") always appear even if not in static registry
    for (const curated of Object.values(CURATED_FRONTIER_PROVIDERS)) {
        if (!byId.has(curated.id)) {
            const models = getCuratedCatalogModels(curated.id, []);
            byId.set(curated.id, {
                id: curated.id,
                name: curated.name,
                defaultModel: curated.defaultModel,
                defaultBaseUrl: curated.defaultBaseUrl,
                api: curated.api,
                sampleModels: models,
            });
        }
    }

    return [...byId.values()].sort((a, b) => {
        const ia = PREFERRED_PROVIDER_ORDER.indexOf(a.id);
        const ib = PREFERRED_PROVIDER_ORDER.indexOf(b.id);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.id.localeCompare(b.id);
    });
}

/** Backwards-compatible alias for `listKnownProviders`. */
export const listKnownPiProviders = listKnownProviders;

// ==================== Live Provider /models Discovery ====================

function trimTrailingSlashes(url: string): string {
    return url.trim().replace(/\/+$/, "");
}

function buildAnthropicModelsUrl(baseUrl?: string): string {
    const base = trimTrailingSlashes(baseUrl || CURATED_FRONTIER_PROVIDERS.anthropic.defaultBaseUrl);
    return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

function buildGoogleModelsUrl(baseUrl: string | undefined, apiKey: string): string {
    const base = trimTrailingSlashes(baseUrl || "https://generativelanguage.googleapis.com");
    const path = base.endsWith("/v1beta") ? `${base}/models` : `${base}/v1beta/models`;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}key=${encodeURIComponent(apiKey)}`;
}

function buildOpenAiCompatibleModelsUrl(providerId: string, baseUrl?: string): string {
    const fallbackBase =
        CURATED_FRONTIER_PROVIDERS[providerId]?.defaultBaseUrl
        ?? "https://api.openai.com/v1";
    const base = trimTrailingSlashes(baseUrl || fallbackBase);
    if (base.endsWith("/models")) return base;
    return `${base}/models`;
}

function isAnthropicEndpoint(providerId: string, api?: StoryAgentCustomApi): boolean {
    return api === "anthropic-messages" || (!api && providerId === "anthropic");
}

function isGoogleEndpoint(providerId: string, api?: StoryAgentCustomApi): boolean {
    return api === "google-generative-ai" || (!api && providerId === "google");
}

function isNonChatModelId(modelId: string): boolean {
    return /(?:^|[-_/])(?:embedding|embed|tts|whisper|dall-e|imagen|veo|moderation|realtime|audio|transcribe|babbage|davinci|aqa)/i.test(
        modelId,
    );
}

function mergeLiveWithCurated(
    providerId: string,
    liveItems: StoryModelOption[],
    curatedCatalog: StoryModelOption[],
): StoryModelOption[] {
    const curatedPriority = new Map<string, number>();
    const curatedById = new Map<string, StoryModelOption>();
    curatedCatalog.forEach((m, idx) => {
        if (m.source === "curated") curatedPriority.set(m.id, idx);
        curatedById.set(m.id, m);
    });

    const dedup = new Map<string, StoryModelOption>();
    for (const item of liveItems) {
        if (!item.id || dedup.has(item.id)) continue;
        const ref = curatedById.get(item.id);
        dedup.set(item.id, {
            ...item,
            name: item.name && item.name !== item.id ? item.name : (ref?.name ?? item.id),
            reasoning: ref ? ref.reasoning : item.reasoning,
            supportsThinking: ref ? ref.supportsThinking : item.supportsThinking,
            contextWindow: item.contextWindow || ref?.contextWindow || 128_000,
            maxTokens: item.maxTokens ?? ref?.maxTokens,
            isDefault: ref?.isDefault,
            source: "live",
        });
    }

    const sorted = [...dedup.values()].sort((a, b) => {
        const pa = curatedPriority.get(a.id);
        const pb = curatedPriority.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        if (Number(b.supportsThinking) !== Number(a.supportsThinking)) {
            return Number(b.supportsThinking) - Number(a.supportsThinking);
        }
        return b.id.localeCompare(a.id, undefined, { numeric: true });
    });

    if (sorted.length > 0 && !sorted.some((m) => m.isDefault)) {
        sorted[0] = { ...sorted[0], isDefault: true };
    }

    return sorted;
}

export async function fetchLiveProviderModels(
    config: Partial<StoryAgentProviderConfig>,
    options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<FetchProviderModelsResult> {
    const providerId = (config.provider?.trim() || "anthropic").toLowerCase();
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const apiKey = config.apiKey?.trim() || "";
    const baseUrl = config.baseUrl?.trim();

    // Load curated + registry catalog for enrichment & graceful fallback
    let registryModels: readonly Model<Api>[] = [];
    try {
        const mr = await ModelRuntime.create({
            credentials: new InMemoryCredentialStore(),
            modelsPath: null,
            refreshOnCreate: false,
        });
        registryModels = mr.getModels(providerId);
    } catch {
        registryModels = [];
    }
    const registryById = new Map<string, Model<Api>>(registryModels.map((m) => [m.id, m]));
    const fallbackCatalog = getCuratedCatalogModels(providerId, registryModels);

    const requiresKey = providerId !== "custom" && !baseUrl?.includes("127.0.0.1") && !baseUrl?.includes("localhost");
    if (requiresKey && !apiKey) {
        return {
            ok: false,
            provider: providerId,
            source: "catalog",
            models: fallbackCatalog,
            error: `API key is required to fetch live models from "${providerId}". Showing curated catalog.`,
        };
    }

    try {
        const customHeaders: Record<string, string> = {
            Accept: "application/json",
            ...(config.headers ?? {}),
        };

        let url: string;
        if (isAnthropicEndpoint(providerId, config.api)) {
            url = buildAnthropicModelsUrl(baseUrl);
            if (apiKey) customHeaders["x-api-key"] = apiKey;
            customHeaders["anthropic-version"] = customHeaders["anthropic-version"] || ANTHROPIC_API_VERSION;
        } else if (isGoogleEndpoint(providerId, config.api)) {
            url = buildGoogleModelsUrl(baseUrl, apiKey);
        } else {
            url = buildOpenAiCompatibleModelsUrl(providerId, baseUrl);
            if (apiKey) customHeaders["Authorization"] = `Bearer ${apiKey}`;
        }

        const res = await fetchImpl(url, {
            method: "GET",
            headers: customHeaders,
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
            return {
                ok: false,
                provider: providerId,
                source: "catalog",
                models: fallbackCatalog,
                error: `HTTP ${res.status} while querying ${providerId} models endpoint. Showing curated catalog.`,
            };
        }

        const payload = (await res.json()) as Record<string, unknown>;
        const liveItems: StoryModelOption[] = [];

        if (isGoogleEndpoint(providerId, config.api)) {
            const rawModels = Array.isArray(payload.models) ? payload.models : [];
            for (const entry of rawModels) {
                if (!entry || typeof entry !== "object") continue;
                const rec = entry as Record<string, unknown>;
                const rawName = String(rec.name ?? "").trim();
                const id = rawName.replace(/^models\//, "");
                if (!id || isNonChatModelId(id)) continue;
                const methods = Array.isArray(rec.supportedGenerationMethods)
                    ? rec.supportedGenerationMethods.map(String)
                    : null;
                if (methods && !methods.includes("generateContent")) continue;
                const reg = registryById.get(id);
                const reasoning = inferModelSupportsThinking(id, reg);
                liveItems.push({
                    id,
                    name: typeof rec.displayName === "string" && rec.displayName.trim() ? rec.displayName.trim() : id,
                    provider: providerId,
                    reasoning,
                    supportsThinking: reasoning,
                    contextWindow:
                        typeof rec.inputTokenLimit === "number" && rec.inputTokenLimit > 0
                            ? rec.inputTokenLimit
                            : (reg?.contextWindow ?? 1_048_576),
                    maxTokens:
                        typeof rec.outputTokenLimit === "number" && rec.outputTokenLimit > 0
                            ? rec.outputTokenLimit
                            : reg?.maxTokens,
                    source: "live",
                });
            }
        } else {
            const rawList = Array.isArray(payload.data)
                ? payload.data
                : Array.isArray(payload.models)
                    ? payload.models
                    : [];
            for (const entry of rawList) {
                if (!entry || typeof entry !== "object") continue;
                const rec = entry as Record<string, unknown>;
                const id = String(rec.id ?? rec.name ?? "").trim();
                if (!id || isNonChatModelId(id)) continue;
                const displayName =
                    (typeof rec.display_name === "string" && rec.display_name.trim())
                    || (typeof rec.name === "string" && rec.name.trim())
                    || id;
                const reg = registryById.get(id);
                const reasoning = inferModelSupportsThinking(id, reg);
                const ctxLen =
                    typeof rec.context_length === "number" && rec.context_length > 0
                        ? rec.context_length
                        : typeof rec.context_window === "number" && rec.context_window > 0
                            ? rec.context_window
                            : (reg?.contextWindow ?? 128_000);
                liveItems.push({
                    id,
                    name: displayName,
                    provider: providerId,
                    reasoning,
                    supportsThinking: reasoning,
                    contextWindow: ctxLen,
                    maxTokens: reg?.maxTokens,
                    source: "live",
                });
            }
        }

        if (liveItems.length === 0) {
            return {
                ok: true,
                provider: providerId,
                source: "catalog",
                models: fallbackCatalog,
            };
        }

        return {
            ok: true,
            provider: providerId,
            source: "live",
            models: mergeLiveWithCurated(providerId, liveItems, fallbackCatalog),
        };
    } catch (err) {
        return {
            ok: false,
            provider: providerId,
            source: "catalog",
            models: fallbackCatalog,
            error: `Failed to fetch live models (${err instanceof Error ? err.message : String(err)}). Showing curated catalog.`,
        };
    }
}
