import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMarkdown } from "../src/agent/AgentMarkdown";

const render = (text: string, nodeIds?: ReadonlySet<string>) =>
    renderToStaticMarkup(createElement(AgentMarkdown, { text, nodeIds, onOpenNode: () => undefined }));

describe("agent markdown", () => {
    test("renders headings, emphasis, lists and tables", () => {
        const html = render("## Changes\n\n**two** lines\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |");
        expect(html).toContain("<h4");
        expect(html).toContain("<strong>two</strong>");
        expect(html).toContain("<ol");
        expect(html).toContain("<table");
    });

    test("a fenced block keeps its language and text", () => {
        const html = render("```msk\ntalk kanade \"hi\"\n```");
        expect(html).toContain(">msk<");
        expect(html).toContain("talk kanade &quot;hi&quot;");
    });

    test("inline code naming a story node becomes a jump chip, other code stays code", () => {
        const html = render("changed `scene_01` and `face_sad_04`", new Set(["scene_01"]));
        expect(html).toMatch(/<button[^>]*>.*scene_01<\/button>/);
        expect(html).toContain("<code");
        expect(html).toContain("face_sad_04</code>");
    });

    test("links are not followed", () => {
        expect(render("[site](https://example.com)")).not.toContain("<a ");
    });
});
