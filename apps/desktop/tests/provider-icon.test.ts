import { describe, expect, it } from "bun:test";
import { resolveProviderBrand } from "../src/renderer/components/ProviderIcon";

describe("ProviderIcon smart brand resolution (#211)", () => {
    it("resolves all mainstream providers directly by provider id", () => {
        expect(resolveProviderBrand("openai")).toBe("openai");
        expect(resolveProviderBrand("anthropic")).toBe("anthropic");
        expect(resolveProviderBrand("google")).toBe("google");
        expect(resolveProviderBrand("deepseek")).toBe("deepseek");
        expect(resolveProviderBrand("qwen")).toBe("qwen");
        expect(resolveProviderBrand("dashscope")).toBe("qwen");
        expect(resolveProviderBrand("xai")).toBe("xai");
        expect(resolveProviderBrand("openrouter")).toBe("openrouter");
        expect(resolveProviderBrand("ollama")).toBe("ollama");
        expect(resolveProviderBrand("moonshot")).toBe("moonshot");
        expect(resolveProviderBrand("zhipu")).toBe("zhipu");
        expect(resolveProviderBrand("mistral")).toBe("mistral");
        expect(resolveProviderBrand("custom")).toBe("custom");
        expect(resolveProviderBrand("unknown-gateway")).toBe("custom");
    });

    it("resolves model-family brand on OpenRouter and OpenAI-compatible custom endpoints", () => {
        expect(resolveProviderBrand("openrouter", "anthropic/claude-opus-5-5")).toBe("anthropic");
        expect(resolveProviderBrand("openrouter", "google/gemini-4-carbon")).toBe("google");
        expect(resolveProviderBrand("openai", "DeepSeek-V4.1-Flash-1017")).toBe("deepseek");
        expect(resolveProviderBrand("custom", "qwen3-235b-a22b")).toBe("qwen");
        expect(resolveProviderBrand("custom", "grok-4-heavy")).toBe("xai");
        expect(resolveProviderBrand("custom", "kimi-k2-thinking")).toBe("moonshot");
        expect(resolveProviderBrand("custom", "glm-5-plus")).toBe("zhipu");
        expect(resolveProviderBrand("custom", "mistral-large-3")).toBe("mistral");
        expect(resolveProviderBrand("custom", "gpt-6-luna")).toBe("openai");
        expect(resolveProviderBrand("custom", "o3-pro")).toBe("openai");
        expect(resolveProviderBrand("openrouter", "meta-llama/llama-4")).toBe("ollama");
        expect(resolveProviderBrand("openrouter", "mystery-model")).toBe("openrouter");
    });
});
