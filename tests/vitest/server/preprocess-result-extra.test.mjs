import { describe, expect, it } from "vitest";
import {
  createPreprocessResult,
  PREPROCESS_RESULT_SCHEMA_VERSION,
  PREPROCESS_RESULT_TYPE,
  summarizePreprocessResult,
} from "../../../server/platform/specialized/knowledge/preprocessing/preprocess-result.mjs";

describe("preprocess result normalization extra coverage", () => {
  it("normalizes sources, parser trace, blocks, chunks, artifacts, fragments, and counts", () => {
    const result = createPreprocessResult({
      generatedAt: "2026-06-04T00:00:00.000Z",
      sources: [
        {
          id: " source-1 ",
          name: " Source Name ",
          path: " /docs/input.md ",
          kind: " markdown ",
          text: "hello world",
          rawObject: {
            objectId: "raw-1",
            clientUid: "client-1",
            sourceType: "file",
            providerId: "provider-a",
            externalId: "external-1",
            syncBatchId: "sync-1",
            contentHash: "hash-raw",
            capturedAt: "2026-06-03T00:00:00.000Z",
            originalFileName: "input.md",
            originalRelativePath: "docs/input.md",
            storageRelativePath: "objects/input.md",
            mediaType: "text/markdown",
            sourceMetadata: { b: 2, a: 1 },
          },
          documentMetadata: {
            parserTrace: [
              {
                name: "custom-stage",
                status: "ok",
                details: { mode: "unit" },
                metrics: { ms: 12 },
              },
            ],
            parserVersion: "1.2.3",
            model: { id: "model-a", version: "2026-06" },
          },
        },
        { id: "  " },
      ],
      blocks: [
        {
          id: "block-1",
          sourceId: "source-1",
          kind: "paragraph",
          level: "2",
          text: " paragraph text ",
          sourceStartLine: "1",
          sourceEndLine: "3",
          titlePath: [" Root ", "", " Child "],
          metadata: { role: "body" },
        },
        { id: "" },
      ],
      chunks: [
        {
          id: "chunk-1",
          sourceId: "source-1",
          title: "Chunk",
          content: "chunk content",
          tokenCount: "7",
          sourceRange: { startLine: "1", endLine: "bad" },
          blockIds: ["block-1", ""],
        },
      ],
      structureArtifacts: [
        {
          id: "artifact-structure-1",
          sourceId: "source-1",
          kind: "heading",
          text: "heading text",
          tokenCount: "5",
          tableHeaders: [" A ", ""],
        },
      ],
      granularityFragments: [
        {
          id: "fragment-1",
          parentArtifactId: "artifact-structure-1",
          text: "fragment text",
          completeOriginalAvailable: false,
        },
      ],
      artifacts: [
        {
          documentId: "doc-1",
          type: "normalized-document",
          relativePath: "docs/doc-1.json",
          metadata: { ok: true },
        },
      ],
      warnings: [" warning one ", "", "warning two"],
    });

    expect(result).toMatchObject({
      schemaVersion: PREPROCESS_RESULT_SCHEMA_VERSION,
      resultType: PREPROCESS_RESULT_TYPE,
      generatedAt: "2026-06-04T00:00:00.000Z",
      counts: {
        sources: 1,
        blocks: 1,
        chunks: 1,
        structureArtifacts: 1,
        granularityFragments: 1,
        artifacts: 1,
        warnings: 2,
      },
      warnings: ["warning one", "warning two"],
    });
    expect(result.sources[0]).toMatchObject({
      id: "source-1",
      name: "Source Name",
      path: "/docs/input.md",
      kind: "markdown",
      textLength: 11,
      rawObjectId: "raw-1",
      clientUid: "client-1",
      providerId: "provider-a",
      sourceMetadata: { b: 2, a: 1 },
      sourceMetadataHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      parserTrace: [
        expect.objectContaining({
          stage: "custom-stage",
          status: "ok",
          parserVersion: "1.2.3",
          modelId: "model-a",
          modelVersion: "2026-06",
          contentHash: "hash-raw",
          mediaType: "text/markdown",
          details: { mode: "unit" },
          metrics: { ms: 12 },
        }),
      ],
    });
    expect(result.sourceTrace["source-1"]).toBe(result.sources[0]);
    expect(result.blocks[0]).toMatchObject({
      id: "block-1",
      level: 2,
      text: "paragraph text",
      sourceStartLine: 1,
      sourceEndLine: 3,
      titlePath: ["Root", "Child"],
      position: 1,
    });
    expect(result.chunks[0]).toMatchObject({
      id: "chunk-1",
      tokenCount: 7,
      charCount: "chunk content".length,
      sourceRange: { startLine: 1, endLine: 0 },
      blockIds: ["block-1"],
      position: 1,
    });
    expect(result.structureArtifacts[0]).toMatchObject({
      artifactId: "artifact-structure-1",
      artifactType: "heading",
      charCount: "heading text".length,
      tableHeaders: ["A"],
    });
    expect(result.granularityFragments[0]).toMatchObject({
      fragmentId: "fragment-1",
      completeOriginalAvailable: false,
      charCount: "fragment text".length,
    });
    expect(result.artifacts[0]).toMatchObject({
      id: "doc-1",
      kind: "normalized-document",
      relativePath: "docs/doc-1.json",
    });
  });

  it("creates fallback parser traces and summarizes partial results", () => {
    const result = createPreprocessResult({
      generatedAt: "",
      sources: [
        {
          id: "source-2",
          documentParserId: "parser-a",
          documentParserVersion: "0.1.0",
          contentHash: "content-hash",
          mediaType: "text/plain",
        },
      ],
      blocks: [],
      chunks: [],
    });

    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.sources[0].parserTrace).toEqual([
      expect.objectContaining({
        stage: "document-parser.extract",
        status: "completed",
        parserId: "parser-a",
        parserVersion: "0.1.0",
        contentHash: "content-hash",
        mediaType: "text/plain",
      }),
    ]);

    expect(summarizePreprocessResult(result)).toMatchObject({
      schemaVersion: PREPROCESS_RESULT_SCHEMA_VERSION,
      resultType: PREPROCESS_RESULT_TYPE,
      counts: {
        sources: 1,
        blocks: 0,
        chunks: 0,
        structureArtifacts: 0,
        granularityFragments: 0,
        artifacts: 0,
        warnings: 0,
      },
      warnings: [],
    });

    expect(summarizePreprocessResult({
      schemaVersion: 2,
      resultType: "custom",
      sources: [{ id: "s1" }],
      warnings: [" keep ", "", null],
    })).toEqual({
      schemaVersion: 2,
      resultType: "custom",
      generatedAt: "",
      counts: {
        sources: 1,
        blocks: 0,
        chunks: 0,
        structureArtifacts: 0,
        granularityFragments: 0,
        artifacts: 0,
        warnings: 3,
      },
      warnings: ["keep"],
    });
  });
});
