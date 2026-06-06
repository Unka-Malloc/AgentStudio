import { describe, expect, it } from "vitest";
import {
  chunkMarkdownText,
  chunkStructuredMarkdown,
  detectMarkdownHeading,
  estimateMarkdownTokenCount,
  MARKDOWN_CHUNKING_STRATEGY,
  parseStructuredMarkdown,
} from "../../../server/platform/specialized/knowledge/preprocessing/chunking/structured-markdown.mjs";

describe("structured markdown chunking extra coverage", () => {
  it("estimates tokens and detects cleaned markdown headings", () => {
    expect(estimateMarkdownTokenCount("abcd")).toBe(1);
    expect(estimateMarkdownTokenCount("abcdefghijkl")).toBe(3);
    expect(estimateMarkdownTokenCount("中文测试")).toBe(3);

    expect(detectMarkdownHeading("## **[API](https://example.test)** ###")).toEqual({
      level: 2,
      text: "https://example.test",
    });
    expect(detectMarkdownHeading("plain paragraph")).toBeNull();
  });

  it("parses headings, lists, tables, fenced code, and unclosed fences into blocks and sections", () => {
    const parsed = parseStructuredMarkdown({
      id: "doc",
      name: "Guide",
      text: [
        "# Root",
        "Intro paragraph.",
        "",
        "## Usage",
        "- first item",
        "- second item",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```js",
        "console.log('ok')",
        "```",
        "",
        "## Broken",
        "~~~",
        "unterminated fence",
      ].join("\n"),
    }, { sectionLevel: 2 });

    expect(parsed.strategy).toBe(MARKDOWN_CHUNKING_STRATEGY);
    expect(parsed.sourceId).toBe("doc");
    expect(parsed.sections.map((section) => section.title)).toEqual(["Root", "Usage", "Broken"]);
    expect(parsed.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "table",
      "code",
      "heading",
      "code",
    ]);
    expect(parsed.blocks.at(-1)).toMatchObject({
      kind: "code",
      metadata: {
        fenced: true,
        unclosed: true,
      },
    });
    expect(parsed.sections[1]).toMatchObject({
      titlePath: ["Root", "Usage"],
      level: 2,
    });
  });

  it("chunks sections with overlap and splits oversized paragraph blocks", () => {
    const source = {
      id: "manual",
      name: "Manual",
      text: [
        "## First",
        "Short intro.",
        "Another short sentence.",
        "",
        "## Second",
        "A".repeat(700),
        "",
        "Final sentence.",
      ].join("\n"),
      sourceCreatedAt: "2026-06-04T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-04T01:00:00.000Z",
      sourceCollectedAt: "2026-06-04T02:00:00.000Z",
    };

    const chunks = chunkStructuredMarkdown(source, {
      sectionLevel: 2,
      maxTokens: 80,
      maxChars: 320,
      overlapTokens: 10,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]).toMatchObject({
      sourceId: "manual",
      sourceName: "Manual",
      title: "First",
      chunkType: "section",
      sourceCreatedAt: "2026-06-04T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-04T01:00:00.000Z",
      sourceCollectedAt: "2026-06-04T02:00:00.000Z",
      metadata: {
        strategy: MARKDOWN_CHUNKING_STRATEGY,
        preservesSectionBoundary: true,
      },
    });
    expect(chunks.some((chunk) => chunk.metadata.splitReason === "oversized-block-part")).toBe(true);
    expect(chunks.some((chunk) => chunk.blockIds.some((id) => id.includes("::part-")))).toBe(true);
  });

  it("keeps line-oriented oversized code/list/table blocks and wraps chunkMarkdownText output", () => {
    const output = chunkMarkdownText({
      text: [
        "## Code",
        "```",
        "line 1",
        "line 2",
        "line 3",
        "```",
        "",
        "## Table",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "| 3 | 4 |",
      ].join("\n"),
      source: {
        id: "markdown-doc",
        name: "README.md",
      },
      options: {
        sectionLevel: 2,
        maxTokens: 80,
        maxChars: 320,
      },
    });

    expect(output).toMatchObject({
      strategy: MARKDOWN_CHUNKING_STRATEGY,
      source: {
        id: "markdown-doc",
        name: "README.md",
        path: "README.md",
        mediaType: "text/markdown",
      },
    });
    expect(output.blocks.some((block) => block.kind === "code")).toBe(true);
    expect(output.blocks.some((block) => block.kind === "table")).toBe(true);
    expect(output.chunks.map((chunk) => chunk.chunkType)).toEqual(["code", "table"]);
    expect(output.chunks.every((chunk) => chunk.metadata.sectionRange.startLine > 0)).toBe(true);
  });
});
