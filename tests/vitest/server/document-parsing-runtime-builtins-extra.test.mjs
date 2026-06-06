import { beforeEach, describe, expect, it, vi } from "vitest";

const readInputSourcesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  readInputSources: (...args) => readInputSourcesMock(...args)
}));

const {
  createDocumentParsingRuntime,
  toPublicDocumentParsingResult
} = await import("../../../server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs");

beforeEach(() => {
  readInputSourcesMock.mockReset().mockResolvedValue({
    sources: [],
    warnings: [],
    failureReasons: []
  });
});

function longSentence(prefix, count = 40) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1} 需要保留上下文。`).join(" ");
}

describe("document parsing runtime built-in pipelines", () => {
  it("normalizes read sources and fallback public fields from raw object aliases", async () => {
    readInputSourcesMock.mockResolvedValueOnce({
      sources: [
        {
          id: "",
          name: "",
          path: "/tmp/read-source.txt",
          kind: "",
          content: "  - 第一条\n\n第二段正文  ",
          rawObject: {
            providerId: "drive",
            externalId: "ext-1",
            syncBatchId: "sync-1",
            contentHash: "hash-1",
            capturedAt: "2026-06-05T00:00:00.000Z",
            sha256: "sha-1",
            originalRelativePath: "raw/read-source.txt",
            path: "/objects/read-source.txt",
            mimeType: "text/plain",
            size: 512
          },
          parserTrace: [{ stage: "read" }, null, "skip"],
          documentMetadata: "not-an-object",
          sourceMetadata: "not-an-object",
          visualElements: [{ dataUrl: "data:image/png;base64,xx", label: "preview" }],
          warnings: ["  read-warning  "]
        }
      ],
      warnings: ["processor-warning"],
      failureReasons: []
    });

    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      generatedAt: "2026-06-05T01:00:00.000Z",
      expectedOutputs: ["sources"],
      inputText: "ignored once processor returns sources",
      userDataPath: "/tmp/pact-doc-runtime",
      batchId: "batch-1",
      clientUid: "client-1",
      sourceType: "document",
      reportProgress: vi.fn()
    });

    expect(readInputSourcesMock).toHaveBeenCalledWith(expect.objectContaining({
      inputText: "ignored once processor returns sources",
      userDataPath: "/tmp/pact-doc-runtime",
      batchId: "batch-1",
      archiveBatchId: "batch-1",
      clientUid: "client-1",
      sourceType: "document",
      generatedAt: "2026-06-05T01:00:00.000Z"
    }));
    expect(result.sources[0]).toMatchObject({
      id: "",
      name: "",
      path: "/tmp/read-source.txt",
      kind: "",
      parserTrace: [{ stage: "read" }, null, "skip"],
      warnings: ["  read-warning  "]
    });
    expect(result.preprocessResult.sources).toHaveLength(0);
    expect(result.summary).toMatchObject({
      sources: 1,
      blocks: 0,
      chunks: 0,
      warnings: 1
    });

    const publicResult = toPublicDocumentParsingResult({
      ...result,
      generatedAt: "",
      pipelineId: "",
      rawIgnored: true
    });
    expect(publicResult.pipelineId).toBe("knowledge-rule-v1");
    expect(publicResult.sources[0]).toMatchObject({
      rawObject: {
        uri: "/objects/read-source.txt",
        mediaType: "text/plain",
        byteSize: 512,
        contentHash: "hash-1",
        originalRelativePath: "raw/read-source.txt"
      },
      visualElements: [{ label: "preview" }]
    });
    expect(publicResult.sources[0].visualElements[0]).not.toHaveProperty("dataUrl");

    const inlineResult = await runtime.parseDocuments({
      generatedAt: "2026-06-05T01:30:00.000Z",
      expectedOutputs: ["sources"],
      sources: [
        {
          id: "",
          path: "/tmp/inline.md",
          content: "  # Inline\r\n\r\n正文  ",
          rawObject: {
            providerId: "inline-drive",
            externalId: "inline-ext",
            syncBatchId: "inline-sync",
            contentHash: "inline-hash",
            capturedAt: "2026-06-05T01:29:00.000Z",
            sha256: "inline-sha",
            originalRelativePath: "raw/inline.md"
          },
          parserTrace: [{ stage: "inline" }, false],
          warnings: [" inline-warning "]
        }
      ]
    });
    expect(inlineResult.sources[0]).toMatchObject({
      id: "source-1",
      name: "/tmp/inline.md",
      path: "/tmp/inline.md",
      kind: "text",
      text: "# Inline\n\n正文",
      providerId: "inline-drive",
      externalId: "inline-ext",
      syncBatchId: "inline-sync",
      contentHash: "inline-hash",
      capturedAt: "2026-06-05T01:29:00.000Z",
      originalSha256: "inline-sha",
      originalRelativePath: "raw/inline.md",
      parserTrace: [{ stage: "inline" }],
      warnings: ["inline-warning"]
    });
    expect(inlineResult.preprocessResult.sources[0]).toMatchObject({
      id: "source-1",
      providerId: "inline-drive",
      externalId: "inline-ext",
      syncBatchId: "inline-sync",
      contentHash: "inline-hash",
      capturedAt: "2026-06-05T01:29:00.000Z",
      originalRelativePath: "raw/inline.md"
    });
  });

  it("runs the fixed-window built-in pipeline with clamped chunking and overlap carry", async () => {
    const runtime = createDocumentParsingRuntime();
    const sourceText = [
      "# Fixed Window",
      "",
      longSentence("第一段", 30),
      "",
      longSentence("第二段", 30),
      "",
      longSentence("第三段", 30)
    ].join("\n");
    const progress = vi.fn();

    const result = await runtime.parseDocuments({
      generatedAt: "2026-06-05T02:00:00.000Z",
      pipelineId: "fixed-window-v1",
      expectedOutputs: ["chunks"],
      sources: [
        {
          id: "fixed-source",
          name: "fixed.txt",
          text: sourceText,
          mediaType: "text/plain"
        }
      ],
      chunking: {
        maxTokens: 20,
        maxChars: 120,
        overlapTokens: 5,
        sectionLevel: 0
      },
      reportProgress: progress
    });

    expect(progress).toHaveBeenCalledWith({
      progressPercent: 54,
      stage: "提取正文结构"
    });
    expect(result.chunking).toEqual({
      maxTokens: 80,
      maxChars: 320,
      overlapTokens: 5,
      sectionLevel: 1
    });
    expect(result.expectedOutputs).toEqual(expect.arrayContaining(["sources", "chunks"]));
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => chunk.chunkType === "fixed-window")).toBe(true);
    expect(result.chunks[0]).toMatchObject({
      id: "fixed-source::chunk-1",
      sourceId: "fixed-source",
      sourceName: "fixed.txt",
      titlePath: ["固定窗口"]
    });
    expect(result.chunks.slice(1).some((chunk) => chunk.overlapTokenCount > 0)).toBe(true);
    expect(result.preprocessResult.chunks).toHaveLength(result.chunks.length);
  });

  it("runs the semantic paragraph pipeline over table blocks and split boundaries", async () => {
    const runtime = createDocumentParsingRuntime();
    const tableText = [
      "Name\tAmount\tStatus",
      "Alpha\t100\tPaid",
      "Beta\t200\tPending",
      "",
      longSentence("说明", 50),
      "",
      "| 字段 | 值 |",
      "| --- | --- |",
      "| 负责人 | 财务 |"
    ].join("\n");

    const result = await runtime.parseDocuments({
      generatedAt: "2026-06-05T03:00:00.000Z",
      pipelineId: "semantic-paragraph-v1",
      expectedOutput: "preprocessResult",
      sources: [
        {
          id: "semantic-source",
          name: "semantic.tsv",
          text: tableText,
          mediaType: "text/tab-separated-values"
        }
      ],
      documentParsing: {
        chunking: {
          targetTokens: 90,
          maxChars: 360,
          overlap: 3,
          headingLevel: 3
        }
      }
    });

    expect(result.expectedOutputs).toEqual(expect.arrayContaining([
      "sources",
      "blocks",
      "chunks",
      "preprocessResult"
    ]));
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.every((block) => block.kind === "table")).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks[0]).toMatchObject({
      sourceId: "semantic-source",
      sourceName: "semantic.tsv",
      chunkType: "table"
    });
    expect(result.chunks.some((chunk) => chunk.chunkType === "semantic")).toBe(true);
    expect(result.chunks.some((chunk) => chunk.content.includes("| 负责人 | 财务 |"))).toBe(true);
    expect(result.summary).toMatchObject({
      sources: 1,
      blocks: result.blocks.length,
      chunks: result.chunks.length,
      structureArtifacts: 0,
      granularityFragments: 0
    });
  });
});
