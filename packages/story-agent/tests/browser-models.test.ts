import { describe, expect, test } from "bun:test";
import { listBrowserAgentModels } from "../src/browser";

describe("browser agent models", () => {
    test("DeepSeek offers only its Flash model", () => {
        expect(listBrowserAgentModels("deepseek").map((m) => m.id)).toEqual(["deepseek-flash"]);
    });

    test("each model lists only the thinking levels it accepts, and defaults to one of them", () => {
        const models = listBrowserAgentModels("deepseek");
        expect(models.length).toBeGreaterThan(0);
        for (const model of models) {
            expect(model.thinkingLevels[0]).toBe("off");
            expect(model.thinkingLevels).toContain(model.defaultThinkingLevel);
            expect(model.defaultThinkingLevel).not.toBe("off");
        }
    });
});
