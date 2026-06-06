import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
const cleanupImportArtifactsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  }))
);
const hydrateImportCheckpointSourcesMock = vi.hoisted(() => vi.fn(async ({ sources = [] } = {}) => sources));
const loadImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => null));
const rawObjectPathsFromSourcesMock = vi.hoisted(() => vi.fn(() => []));
const saveImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => undefined));
const validateImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  createImportEntryId: createImportEntryIdMock,
  collectProtectedRawObjectPaths: collectProtectedRawObjectPathsMock,
  cleanupImportArtifacts: cleanupImportArtifactsMock,
  hydrateImportCheckpointSources: hydrateImportCheckpointSourcesMock,
  loadImportCheckpointEntry: loadImportCheckpointEntryMock,
  rawObjectPathsFromSources: rawObjectPathsFromSourcesMock,
  saveImportCheckpointEntry: saveImportCheckpointEntryMock,
  validateImportCheckpointEntry: validateImportCheckpointEntryMock
}));

import { readInputSources } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  bindDynamicDocumentParsingInvocation,
  createStructureArtifacts,
  dispatchDynamicDocumentParsingAlgorithm
} from "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs";
import {
  chunkMarkdownText,
  chunkStructuredMarkdown,
  chunkStructuredMarkdownSections,
  parseStructuredMarkdown
} from "../../../server/platform/specialized/knowledge/preprocessing/chunking/structured-markdown.mjs";
import { createRuleBasedChunkerAdapter } from "../../../server/platform/specialized/knowledge/preprocessing/chunking/rule-chunker.mjs";

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

beforeEach(() => {
  let importEntryCounter = 0;
  createImportEntryIdMock.mockReset().mockImplementation(() => {
    importEntryCounter += 1;
    return `entry-${String(importEntryCounter).padStart(4, "0")}`;
  });
  collectProtectedRawObjectPathsMock.mockReset().mockResolvedValue(new Set());
  cleanupImportArtifactsMock.mockReset().mockResolvedValue({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  });
  hydrateImportCheckpointSourcesMock.mockReset().mockResolvedValue([]);
  loadImportCheckpointEntryMock.mockReset().mockResolvedValue(null);
  rawObjectPathsFromSourcesMock.mockReset().mockReturnValue([]);
  saveImportCheckpointEntryMock.mockReset().mockResolvedValue(undefined);
  validateImportCheckpointEntryMock.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("knowledge preprocessing final extra 4 coverage", () => {
  it("parses nested markdown lists and tables, and keeps blank input empty", () => {
    const parsed = parseStructuredMarkdown({
      id: "doc",
      name: "Guide",
      text: [
        "# Root",
        "Intro paragraph.",
        "",
        "## Usage",
        "- first item",
        "  - nested item",
        "1. ordered item",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "~~~",
        "unterminated fence",
      ].join("\n"),
    }, { sectionLevel: 2 });

    expect(parsed.sections.map((section) => section.title)).toEqual(["Root", "Usage"]);
    expect(parsed.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "table",
      "code",
    ]);
    expect(parsed.blocks.at(-1)).toMatchObject({
      kind: "code",
      metadata: {
        fenced: true,
        unclosed: true,
      },
    });

    const emptyParsed = parseStructuredMarkdown({ id: "empty", text: "   \n\t" });
    expect(emptyParsed.blocks).toEqual([]);
    expect(chunkStructuredMarkdown({ id: "empty", text: "   \n\t" })).toEqual([]);

    const preview = chunkMarkdownText({
      text: "   \n\t",
      source: { id: "empty-preview", name: "empty.md" },
    });
    expect(preview.chunks).toEqual([]);
    expect(preview.sections).toEqual([]);
  });

  it("keeps structured chunk boundaries for oversized code, list, table, and fallback sections", async () => {
    const source = {
      id: "source-1",
      name: "notes.md",
      sourceCreatedAt: "2026-06-05T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-05T01:00:00.000Z",
      sourceCollectedAt: "2026-06-05T02:00:00.000Z",
    };

    const sections = [
      {
        id: "table-section",
        sourceId: source.id,
        sourceName: source.name,
        title: "Table Section",
        titlePath: ["Root", "Table Section"],
        headingPath: ["Root", "Table Section"],
        level: 2,
        sourceStartLine: 1,
        sourceEndLine: 5,
        blocks: [
          {
            id: "table-1",
            kind: "table",
            text: [
              "| A | B |",
              "| --- | --- |",
              ...Array.from({ length: 40 }, (_, index) => `| ${index + 1} | ${index + 2} |`),
            ].join("\n"),
            sourceStartLine: 1,
            sourceEndLine: 42,
            metadata: {},
          },
        ],
      },
      {
        id: "list-section",
        sourceId: source.id,
        sourceName: source.name,
        title: "List Section",
        titlePath: ["Root", "List Section"],
        headingPath: ["Root", "List Section"],
        level: 2,
        sourceStartLine: 6,
        sourceEndLine: 9,
        blocks: [
          {
            id: "list-1",
            kind: "list",
            text: [
              ...Array.from({ length: 50 }, (_, index) => `- item ${index + 1} ${"x".repeat(8)}`),
            ].join("\n"),
            sourceStartLine: 6,
            sourceEndLine: 55,
            metadata: {},
          },
        ],
      },
      {
        id: "code-section",
        sourceId: source.id,
        sourceName: source.name,
        title: "Code Section",
        titlePath: ["Root", "Code Section"],
        headingPath: ["Root", "Code Section"],
        level: 2,
        sourceStartLine: 10,
        sourceEndLine: 13,
        blocks: [
          {
            id: "code-1",
            kind: "code",
            text: [
              ...Array.from({ length: 60 }, (_, index) => `line ${index + 1} ${"y".repeat(8)}`),
            ].join("\n"),
            sourceStartLine: 10,
            sourceEndLine: 69,
            metadata: {},
          },
        ],
      },
      {
        id: "paragraph-section",
        sourceId: source.id,
        sourceName: source.name,
        title: "Paragraph Section",
        titlePath: ["Root", "Paragraph Section"],
        headingPath: ["Root", "Paragraph Section"],
        level: 2,
        sourceStartLine: 14,
        sourceEndLine: 14,
        blocks: [
          {
            id: "paragraph-1",
            kind: "paragraph",
            text: "A".repeat(800),
            sourceStartLine: 14,
            sourceEndLine: 14,
            metadata: {},
          },
        ],
      },
    ];

    const chunks = chunkStructuredMarkdownSections(source, sections, {
      maxChars: 32,
      maxTokens: 16,
      overlapTokens: 4,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkType)).toEqual(expect.arrayContaining([
      "table",
      "list",
      "code",
      "section",
    ]));
    expect(chunks.some((chunk) => chunk.chunkType === "table")).toBe(true);
    expect(chunks.some((chunk) => chunk.chunkType === "list")).toBe(true);
    expect(chunks.some((chunk) => chunk.chunkType === "code")).toBe(true);
    expect(chunks.some((chunk) => chunk.blockIds.some((id) => id.includes("::part-")))).toBe(true);

    const chunker = createRuleBasedChunkerAdapter({
      maxChars: 24,
      maxTokens: 6,
    });

    const blankFallback = await chunker.chunk({
      id: "plain-source",
      name: "plain.txt",
    }, [
      {
        id: "blank",
        sourceId: "plain-source",
        sourceName: "plain.txt",
        kind: "paragraph",
        text: "   ",
      },
    ]);

    expect(blankFallback).toHaveLength(1);
    expect(blankFallback[0]).toMatchObject({
      title: "未命名知识块",
      content: "",
      chunkType: "section",
    });

    const flushed = await chunker.chunk({
      id: "plain-source",
      name: "plain.txt",
    }, [
      {
        id: "heading-1",
        sourceId: "plain-source",
        sourceName: "plain.txt",
        kind: "heading",
        level: 1,
        text: "Top",
      },
      {
        id: "body-1",
        sourceId: "plain-source",
        sourceName: "plain.txt",
        kind: "paragraph",
        text: "short",
      },
      {
        id: "body-2",
        sourceId: "plain-source",
        sourceName: "plain.txt",
        kind: "paragraph",
        text: "x".repeat(40),
      },
      {
        id: "body-3",
        sourceId: "plain-source",
        sourceName: "plain.txt",
        kind: "paragraph",
        text: "tail",
      },
    ]);

    expect(flushed[0]).toMatchObject({
      title: "Top",
      titlePath: ["Top"],
      chunkType: "section",
    });
    expect(flushed.some((chunk) => chunk.blockIds.some((id) => id.includes("::part-1")))).toBe(true);
  });

  it("normalizes structure artifacts, table metadata, and parser trace fallback values", () => {
    const artifacts = createStructureArtifacts({
      sources: [
        {
          id: "source-1",
          name: "Doc Source",
          path: "/tmp/doc-source.md",
          mediaType: "text/markdown",
          contentHash: "content-hash",
          sourceMetadata: {
            dataset: "fixture",
          },
          documentMetadata: {
            runtime: {
              version: "7.8.9",
              modelId: "model-a",
              modelVersion: "1.2.3",
            },
          },
        }
      ],
      blocks: [
        {
          id: "blank",
          sourceId: "source-1",
          text: "   ",
        },
        {
          id: "table",
          sourceId: "source-1",
          kind: "table",
          text: [
            "| Field | Value |",
            "| --- | --- |",
            "| source | doc |",
            "| status | ok |",
          ].join("\n"),
          sourceStartLine: "4",
          sourceEndLine: "7",
          headingPath: ["Root", "Tables"],
          metadata: {
            sourceRange: {
              startLine: 4,
              endLine: 7,
            },
          },
        },
      ],
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      artifactType: "table",
      sourceId: "source-1",
      sourceName: "Doc Source",
      headingPath: ["Root", "Tables"],
      titlePath: ["Root", "Tables"],
      sourceRange: {
        startLine: 4,
        endLine: 7,
      },
      tableHeaders: ["Field", "Value"],
      rowRange: {
        startRow: 1,
        endRow: 2,
      },
      columnRange: {
        startColumn: 1,
        endColumn: 2,
      },
      metadata: {
        sourceMediaType: "text/markdown",
        sourceMetadataHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        parserTraceRef: {
          parserId: "",
          parserVersion: "7.8.9",
          modelId: "model-a",
          modelVersion: "1.2.3",
        },
      },
    });

    const parsed = dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifacts[0],
      artifactType: "table",
      granularity: {
        tableGranularity: "cell-window",
        secondaryParse: {
          enabled: true,
          algorithm: "auto",
          targetTokens: 12,
          targetChars: 64,
        },
      },
    });

    expect(parsed.algorithmId).toBe("table-cell-window-v1");
    expect(parsed.fragments[0]).toMatchObject({
      granularity: "table-cell-window",
      fragmentationTrace: {
        algorithm: "table-cell-window-v1",
      },
    });

    const bound = bindDynamicDocumentParsingInvocation({
      sources: [],
      blocks: [],
      contextBudget: {
        knowledgeTokens: "not-a-number",
      },
      payloadBudget: {
        maxResponseBytes: 1,
        maxEvidenceBytes: 1,
      },
      granularity: {
        secondaryParse: {
          enabled: false,
        },
      },
    });

    expect(bound.policy.contextBudget.knowledgeTokens).toBe(4096);
    expect(bound.payload.totalFragmentCount).toBe(0);
    expect(bound.backendTrace.secondaryParse.enabled).toBe(false);
  });

  it("rejects empty input and surfaces missing-parser failures without external tooling", async () => {
    await withTempRoot("pact-knowledge-preprocessing-final-extra-4-", async (userDataPath) => {
      await expect(
        readInputSources({
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_input_missing",
      });

      const textPath = path.join(userDataPath, "inputs", "missing-parser.txt");
      await writeText(textPath, "plain text input");

      await expect(
        readInputSources({
          filePaths: [textPath],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: {
            mounts: {},
            resolveDocumentRoute: () => ({
              mountName: "missingParser",
              action: "extractDocument",
              matchedBy: "extension",
            }),
          },
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content",
        failureReasons: expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "filesystem_input_parse_failed",
            sourceName: "missing-parser.txt",
            sourceKind: "filesystem",
          }),
        ]),
      });
    });
  });

  it("writes normalized documents for markdown fallback text and unknown source kinds", async () => {
    await withTempRoot("pact-knowledge-normalized-documents-", async (userDataPath) => {
      const markdownPath = path.join(userDataPath, "inputs", "guide.md");
      const blobPath = path.join(userDataPath, "inputs", "notes.bin");
      await writeText(markdownPath, "# Guide\n");
      await writeText(blobPath, "binary-ish");

      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-1",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "md-1",
            name: "guide.md",
            path: markdownPath,
            kind: "markdown",
            text: "",
            sourceCreatedAt: "2026-06-05T00:00:00.000Z",
            sourceUpdatedAt: "2026-06-05T00:00:00.000Z",
            sourceCollectedAt: "2026-06-05T00:00:00.000Z",
          },
          {
            id: "blob-1",
            name: "notes.bin",
            path: blobPath,
            kind: "blob",
            text: "",
            sourceCreatedAt: "2026-06-05T00:00:00.000Z",
            sourceUpdatedAt: "2026-06-05T00:00:00.000Z",
            sourceCollectedAt: "2026-06-05T00:00:00.000Z",
          }
        ],
        chunks: [
          {
            id: "chunk-1",
            sourceId: "md-1",
            titlePath: ["Guide"],
            content: "Chunk body from normalized chunks",
            sourceRange: { startLine: 1, endLine: 1 },
          },
        ],
        analysis: {},
      });

      expect(manifest.summary).toMatchObject({
        documentCount: 2,
        sourceMaterialCount: 0,
        assetCount: 0,
        byGranularity: {
          document: 1,
          source: 1,
        },
      });

      const markdownDoc = manifest.documents.find((doc) => doc.adapterId === "builtin/markdown-adapter");
      expect(markdownDoc).toMatchObject({
        granularity: "document",
        title: "guide.md",
      });

      const fallbackDoc = manifest.documents.find((doc) => doc.adapterId === "builtin/fallback-adapter");
      expect(fallbackDoc).toMatchObject({
        granularity: "source",
        warnings: [
          expect.stringContaining("未找到"),
        ],
      });
    });
  });
});
