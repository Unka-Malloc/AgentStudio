import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/chunking/structured-markdown.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/specialized/knowledge/preprocessing/chunking/structured-markdown.mjs"
  );

  return {
    ...actual,
    chunkStructuredMarkdownSections: vi.fn((source, sections, options) => ({
      source,
      sections,
      options
    }))
  };
});

const structuredMarkdown = await import(
  "../../../server/platform/specialized/knowledge/preprocessing/chunking/structured-markdown.mjs"
);
const { createRuleBasedChunkerAdapter } = await import(
  "../../../server/platform/specialized/knowledge/preprocessing/chunking/rule-chunker.mjs"
);
const { createRuleBasedParserAdapter } = await import(
  "../../../server/platform/specialized/knowledge/preprocessing/chunking/rule-parser.mjs"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rule-based knowledge chunking extra coverage", () => {
  it("returns no blocks for image sources and blank text", async () => {
    const parser = createRuleBasedParserAdapter();

    await expect(
      parser.parse({
        id: "image-source",
        kind: "image",
        text: "ignored",
      })
    ).resolves.toEqual([]);

    await expect(
      parser.parse({
        id: "blank-source",
        name: "blank.txt",
        text: "   ",
      })
    ).resolves.toEqual([]);
  });

  it("parses markdown, code, data, and structured text branches", async () => {
    const parser = createRuleBasedParserAdapter();

    const markdown = await parser.parse({
      id: "markdown-doc",
      name: "guide.md",
      text: "# Title\nBody",
    });
    expect(markdown.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
    expect(markdown[0]).toMatchObject({ kind: "heading", level: 1, text: "# Title" });

    const code = await parser.parse({
      id: "code-doc",
      name: "sample.ts",
      text: [
        "const value = 1",
        "class Widget {}",
        "",
        "export async function run() {}",
      ].join("\n"),
    });
    expect(code.map((block) => block.kind)).toEqual(["code", "code", "code"]);
    expect(code.map((block) => block.text)).toEqual([
      "const value = 1",
      "class Widget {}",
      "export async function run() {}",
    ]);

    const data = await parser.parse({
      id: "data-doc",
      name: "payload.json",
      text: "first paragraph\n\nsecond paragraph",
    });
    expect(data.map((block) => block.text)).toEqual(["first paragraph", "second paragraph"]);
    expect(data.every((block) => block.kind === "code")).toBe(true);

    const tableFromPipe = await parser.parse({
      id: "table-pipe",
      name: "notes.txt",
      text: "column1|column2|column3|column4|column5",
    });
    expect(tableFromPipe[0]).toMatchObject({
      kind: "table",
      text: "column1|column2|column3|column4|column5",
    });

    const tableFromTabs = await parser.parse({
      id: "table-tabs",
      name: "notes.txt",
      text: "column1\tcolumn2\tcolumn3\tcolumn4\tcolumn5",
    });
    expect(tableFromTabs[0]).toMatchObject({
      kind: "table",
      text: "column1\tcolumn2\tcolumn3\tcolumn4\tcolumn5",
    });

    const text = await parser.parse({
      id: "structured-text",
      name: "notes.txt",
      text: [
        "# Root",
        "Intro paragraph.",
        "",
        "第2章 概览",
        "Chapter body.",
        "",
        "1.2.3 Nested Topic",
        "Nested body.",
        "",
        "二、 中文标题",
        "Chinese body.",
        "",
        "Short heading",
        "Short body.",
      ].join("\n"),
    });

    expect(text.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(text[0]).toMatchObject({ kind: "heading", level: 1, text: "Root" });
    expect(text[2]).toMatchObject({ kind: "heading", level: 1, text: "第2章 概览" });
    expect(text[4]).toMatchObject({ kind: "heading", level: 3, text: "Nested Topic" });
    expect(text[6]).toMatchObject({ kind: "heading", level: 2, text: "中文标题" });
    expect(text[8]).toMatchObject({ kind: "heading", level: 3, text: "Short heading" });
  });

  it("collects markdown sections from section metadata and preserves fallback titles", async () => {
    const chunker = createRuleBasedChunkerAdapter({
      maxChars: 111,
      maxTokens: 9,
    });
    const source = {
      id: "markdown-source",
      name: "Doc.md",
      sourceCreatedAt: "2026-06-04T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-04T01:00:00.000Z",
      sourceCollectedAt: "2026-06-04T02:00:00.000Z",
    };
    const blocks = [
      {
        id: "block-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "heading",
        text: "Intro",
        sectionId: "section-1",
        headingPath: ["Root", "Intro"],
        sourceStartLine: 3,
        sourceEndLine: 4,
        metadata: {
          strategy: structuredMarkdown.MARKDOWN_CHUNKING_STRATEGY,
          sectionId: "section-1",
          sectionTitle: "Intro",
          sectionLevel: 2,
          sectionRange: {
            startLine: 3,
            endLine: 4,
          },
        },
      },
      {
        id: "block-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Body one",
        sectionId: "section-1",
        sourceStartLine: 10,
        sourceEndLine: 12,
        metadata: {
          sectionId: "section-1",
        },
      },
      {
        id: "block-3",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Body two",
        metadata: {
          sectionId: "section-2",
          headingPath: ["Alpha", "Beta"],
          sectionRange: {
            startLine: 20,
            endLine: 21,
          },
        },
      },
      {
        id: "block-4",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Body three",
        titlePath: ["Loose", "Leaf"],
        metadata: {
          sectionId: "section-3",
          sourceRange: {
            startLine: 30,
            endLine: 31,
          },
        },
      },
      {
        id: "block-5",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Body four",
        metadata: {
          sectionId: "section-4",
        },
      },
    ];

    const result = await chunker.chunk(source, blocks);

    expect(structuredMarkdown.chunkStructuredMarkdownSections).toHaveBeenCalledTimes(1);
    expect(result.options).toEqual({ maxChars: 111, maxTokens: 9 });
    expect(result.sections.map((section) => ({
      id: section.id,
      title: section.title,
      titlePath: section.titlePath,
      headingPath: section.headingPath,
      level: section.level,
      sourceStartLine: section.sourceStartLine,
      sourceEndLine: section.sourceEndLine,
      blockCount: section.blocks.length,
    }))).toEqual([
      {
        id: "section-1",
        title: "Intro",
        titlePath: ["Root", "Intro"],
        headingPath: ["Root", "Intro"],
        level: 2,
        sourceStartLine: 3,
        sourceEndLine: 12,
        blockCount: 2,
      },
      {
        id: "section-2",
        title: "Beta",
        titlePath: ["Alpha", "Beta"],
        headingPath: ["Alpha", "Beta"],
        level: 0,
        sourceStartLine: 20,
        sourceEndLine: 21,
        blockCount: 1,
      },
      {
        id: "section-3",
        title: "Leaf",
        titlePath: ["Loose", "Leaf"],
        headingPath: ["Loose", "Leaf"],
        level: 0,
        sourceStartLine: 30,
        sourceEndLine: 31,
        blockCount: 1,
      },
      {
        id: "section-4",
        title: "文档前言",
        titlePath: [],
        headingPath: [],
        level: 0,
        sourceStartLine: 1,
        sourceEndLine: 1,
        blockCount: 1,
      },
    ]);
  });

  it("derives plain chunk types, heading paths, and fallback titles", async () => {
    const chunker = createRuleBasedChunkerAdapter({
      maxChars: 50,
      maxTokens: 50,
    });
    const source = {
      id: "plain-source",
      name: "notes.txt",
    };

    const codeChunks = await chunker.chunk(source, [
      {
        id: "code-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "code",
        text: "line 1",
      },
      {
        id: "code-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "code",
        text: "line 2",
      },
    ]);
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0]).toMatchObject({
      chunkType: "code",
      blockIds: ["code-1", "code-2"],
    });

    const tableChunks = await chunker.chunk(source, [
      {
        id: "table-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "table",
        text: "a | b | c",
      },
      {
        id: "table-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "table",
        text: "1 | 2 | 3",
      },
    ]);
    expect(tableChunks[0].chunkType).toBe("table");

    const listChunks = await chunker.chunk(source, [
      {
        id: "list-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "list",
        text: "- first",
      },
      {
        id: "list-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "list",
        text: "- second",
      },
    ]);
    expect(listChunks[0].chunkType).toBe("list");

    const sectionChunks = await chunker.chunk(source, [
      {
        id: "heading-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "heading",
        level: 1,
        text: "Top",
      },
      {
        id: "paragraph-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Alpha",
      },
      {
        id: "heading-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "heading",
        level: 0,
        text: "Reset",
      },
      {
        id: "paragraph-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "Beta",
      },
      {
        id: "blank",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "   ",
      },
    ]);

    expect(sectionChunks.map((chunk) => ({
      title: chunk.title,
      titlePath: chunk.titlePath,
      chunkType: chunk.chunkType,
      content: chunk.content,
    }))).toEqual([
      {
        title: "Top",
        titlePath: ["Top"],
        chunkType: "section",
        content: "Alpha",
      },
      {
        title: "Reset",
        titlePath: ["Reset"],
        chunkType: "section",
        content: "Beta",
      },
    ]);

    const fallbackChunks = await chunker.chunk(source, [
      {
        id: "blank-only",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "   ",
      },
    ]);
    expect(fallbackChunks).toHaveLength(1);
    expect(fallbackChunks[0]).toMatchObject({
      title: "未命名知识块",
      content: "",
    });
  });

  it("splits oversized blocks and flushes current chunks on size and token limits", async () => {
    const charLimitedChunker = createRuleBasedChunkerAdapter({
      maxChars: 10,
      maxTokens: 50,
    });
    const sizeFlushChunker = createRuleBasedChunkerAdapter({
      maxChars: 5,
      maxTokens: 50,
    });
    const tokenLimitedChunker = createRuleBasedChunkerAdapter({
      maxChars: 100,
      maxTokens: 5,
    });
    const source = {
      id: "limits-source",
      name: "limits.txt",
    };

    const charSplitChunks = await charLimitedChunker.chunk(source, [
      {
        id: "chars",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "abcdefghijklmno",
      },
    ]);
    expect(charSplitChunks).toHaveLength(2);
    expect(charSplitChunks[0]).toMatchObject({
      blockIds: ["chars::part-1"],
      content: "abcdefghij",
    });
    expect(charSplitChunks[1]).toMatchObject({
      blockIds: ["chars::part-2"],
      content: "klmno",
    });

    const recursiveSplitChunks = await charLimitedChunker.chunk(source, [
      {
        id: "sentences",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: `${"A".repeat(15)}。B`,
      },
    ]);
    expect(recursiveSplitChunks.length).toBeGreaterThan(1);
    expect(recursiveSplitChunks[0].blockIds[0]).toContain("::part-1");
    expect(recursiveSplitChunks.some((chunk) => chunk.blockIds[0].includes("::part-2"))).toBe(true);

    const sentenceSplitChunks = await charLimitedChunker.chunk(source, [
      {
        id: "sentence-flow",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: `${"A".repeat(12)}. short. tail`,
      },
    ]);
    expect(sentenceSplitChunks.map((chunk) => chunk.content)).toEqual([
      "AAAAAAAAAA",
      "AA.",
      "short.",
      "tail",
    ]);
    expect(sentenceSplitChunks.map((chunk) => chunk.blockIds[0])).toEqual([
      "sentence-flow::part-1",
      "sentence-flow::part-2",
      "sentence-flow::part-3",
      "sentence-flow::part-4",
    ]);

    const sizeFlushChunks = await sizeFlushChunker.chunk(source, [
      {
        id: "small-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "ab",
      },
      {
        id: "small-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "cdef",
      },
    ]);
    expect(sizeFlushChunks.map((chunk) => chunk.blockIds)).toEqual([["small-1"], ["small-2"]]);

    const tokenFlushChunks = await tokenLimitedChunker.chunk(source, [
      {
        id: "token-1",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "aaaa",
      },
      {
        id: "token-2",
        sourceId: source.id,
        sourceName: source.name,
        kind: "paragraph",
        text: "中文中文中文",
      },
    ]);
    expect(tokenFlushChunks.map((chunk) => chunk.blockIds)).toEqual([["token-1"], ["token-2"]]);
  });
});
