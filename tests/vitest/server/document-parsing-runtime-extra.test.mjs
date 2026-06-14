import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentParsingRuntime,
  toPublicDocumentParsingResult,
} from "../../../server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs";
import { DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID } from "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs";

const readInputSourcesMock = vi.hoisted(() => vi.fn());
const createKnowledgePipelineMock = vi.hoisted(() =>
  vi.fn(({ parser, chunker } = {}) => ({
    parser,
    chunker,
    run: pipelineRunMock,
  }))
);
const pipelineRunMock = vi.hoisted(() => vi.fn());
const bindDynamicDocumentParsingInvocationMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  readInputSources: (...args) => readInputSourcesMock(...args),
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/chunking/pipeline.mjs", () => ({
  createKnowledgePipeline: (...args) => createKnowledgePipelineMock(...args),
}));

vi.mock(
  "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs",
  async () => {
    const actual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs"
    );
    return {
      ...actual,
      bindDynamicDocumentParsingInvocation: (...args) =>
        bindDynamicDocumentParsingInvocationMock(...args),
    };
  }
);

function createSource(overrides = {}) {
  return {
    id: "source-1",
    name: "demo.md",
    path: "/tmp/demo.md",
    kind: "text",
    text: "# 标题\n\n正文内容用于解析。",
    mediaType: "text/markdown",
    warnings: [],
    sourceMetadata: {
      page: 1,
    },
    ...overrides,
  };
}

function createPipelineResult(sourceId = "source-1", warnings = []) {
  return {
    generatedAt: "2026-06-04T00:00:00.000Z",
    sources: [],
    blocks: [
      {
        id: "block-1",
        sourceId,
        sourceName: "demo.md",
        kind: "paragraph",
        text: "正文内容用于解析。",
        sourceStartLine: 1,
        sourceEndLine: 1,
      },
    ],
    chunks: [
      {
        id: "chunk-1",
        sourceId,
        sourceName: "demo.md",
        chunkType: "semantic",
        title: "正文",
        content: "正文内容用于解析。",
        sourceStartLine: 1,
        sourceEndLine: 1,
        sourceRange: {
          startLine: 1,
          endLine: 1,
        },
        tokenCount: 12,
        charCount: 8,
      },
    ],
    warnings,
  };
}

beforeEach(() => {
  readInputSourcesMock.mockReset().mockResolvedValue({
    sources: [],
    warnings: [],
    failureReasons: [],
  });
  pipelineRunMock.mockReset().mockResolvedValue(createPipelineResult());
  bindDynamicDocumentParsingInvocationMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("document parsing runtime", () => {
  it("normalizes public API payload and removes inline image-data fields", () => {
    const publicResult = toPublicDocumentParsingResult({
      generatedAt: "2026-06-04T00:00:00.000Z",
      pipelineId: "knowledge-rule-v1",
      expectedOutputs: ["sources", "preprocess-result"],
      sources: [
        {
          id: " source-1 ",
          name: " Demo Source ",
          path: " /tmp/demo.md ",
          kind: " markdown ",
          mediaType: "text/markdown",
          rawObject: {
            objectId: "raw-1",
            mediaType: "text/markdown",
            uri: "/tmp/demo.md",
            originalFileName: "demo.md",
            originalRelativePath: "raw/demo.md",
            storageRelativePath: "objects/demo.md",
            contentHash: "abc123",
            byteSize: 128,
          },
          visualElements: [
            {
              imageDataUrl: "data:image/png;base64,AA",
              dataUrl: "data:image/png;base64,BB",
              alt: "inline",
            },
          ],
          warnings: ["  文件读取成功  "],
        },
      ],
      blocks: [
        {
          id: "block-1",
          sourceId: "source-1",
          text: "第一段",
          kind: "paragraph",
          sourceStartLine: 1,
          sourceEndLine: 1,
        },
      ],
      chunks: [],
      warnings: ["  result-warning  "],
      failureReasons: ["unsupported-format"],
      pipelines: [{ id: "knowledge-rule-v1", label: "knowledge rule parser" }],
    });

    expect(publicResult).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      generatedAt: "2026-06-04T00:00:00.000Z",
      pipelineId: "knowledge-rule-v1",
      expectedOutputs: ["sources", "preprocess-result"],
      summary: {
        sources: 1,
        blocks: 1,
        chunks: 0,
        failureReasons: 1,
        warnings: 1,
      },
      warnings: ["  result-warning  "],
      failureReasons: ["unsupported-format"],
    });

    expect(publicResult.sources[0]).toMatchObject({
      id: " source-1 ",
      name: " Demo Source ",
      path: " /tmp/demo.md ",
      kind: " markdown ",
      rawObject: {
        objectId: "raw-1",
        uri: "/tmp/demo.md",
        originalFileName: "demo.md",
      },
      visualElements: [{ alt: "inline" }],
    });
    expect(publicResult.sources[0].visualElements[0]).not.toHaveProperty("imageDataUrl");
    expect(publicResult.sources[0].visualElements[0]).not.toHaveProperty("dataUrl");
  });

  it("normalizes options and parses by default pipeline when sources are provided", async () => {
    pipelineRunMock.mockResolvedValueOnce(
      createPipelineResult("source-1", ["pipeline-warning"])
    );
    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      sources: [
        createSource({
          warnings: [" source-warn  "],
        }),
      ],
      warnings: ["request-warn"],
      expectedOutput: ["blocks"],
      documentParsing: {
        chunking: {
          maxTokens: 260,
          maxChars: "invalid-number",
          headingLevel: 9,
          overlapTokens: 4,
        },
      },
    });

    expect(readInputSourcesMock).not.toHaveBeenCalled();
    expect(createKnowledgePipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineRunMock).toHaveBeenCalledOnce();
    expect(result.chunking).toMatchObject({
      maxTokens: 260,
      maxChars: 1040,
      overlapTokens: 4,
      sectionLevel: 6,
    });
    expect(result.warnings).toEqual(["request-warn", "source-warn"]);
    expect(result.expectedOutputs).toEqual(expect.arrayContaining(["sources", "blocks"]));
    expect(result.blocks[0]).toMatchObject({ id: "block-1", sourceId: "source-1" });
    expect(result.preprocessResult).toMatchObject({ warnings: ["pipeline-warning"] });
  });

  it("falls back to source-only outputs when expected outputs are unsupported", async () => {
    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      sources: [createSource()],
      expectedOutput: ["invalid-output"],
    });

    expect(result.expectedOutputs).toEqual(["sources"]);
    expect(pipelineRunMock).not.toHaveBeenCalled();
    expect(result.blocks).toEqual([]);
    expect(result.chunks).toEqual([]);
    expect(result.preprocessResult.warnings).toEqual([]);
    expect(result.preprocessResult.sources).toHaveLength(1);
    expect(result.preprocessResult.blocks).toHaveLength(0);
    expect(result.preprocessResult.chunks).toHaveLength(0);
  });

  it("reads from readInputSources when no inline sources and keeps empty-input diagnostics", async () => {
    readInputSourcesMock.mockResolvedValueOnce({
      sources: [],
      warnings: ["input-paths-empty"],
      failureReasons: ["unsupported_input_type"],
    });
    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      expectedOutputs: ["sources"],
      filePaths: [],
      warnings: ["request-warning"],
    });

    expect(readInputSourcesMock).toHaveBeenCalledTimes(1);
    expect(createKnowledgePipelineMock).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
    expect(result.failureReasons).toEqual(["unsupported_input_type"]);
    expect(result.warnings).toEqual(["request-warning", "input-paths-empty"]);
    expect(result.summary).toMatchObject({
      sources: 0,
      blocks: 0,
      chunks: 0,
      failureReasons: 1,
      warnings: 2,
    });
  });

  it("supports custom pipeline routing and preserves registered pipeline metadata", async () => {
    const customPipelineRun = vi.fn(async () => ({
      generatedAt: "2026-06-04T00:00:00.000Z",
      sources: [],
      blocks: [
        {
          id: "custom-block-1",
          sourceId: "custom-source",
          sourceName: "custom.md",
          kind: "paragraph",
          text: "custom",
          sourceStartLine: 1,
          sourceEndLine: 1,
        },
      ],
      chunks: [
        {
          id: "custom-chunk-1",
          sourceId: "custom-source",
          sourceName: "custom.md",
          chunkType: "section",
          title: "custom",
          content: "custom",
          sourceStartLine: 1,
          sourceEndLine: 1,
          sourceRange: {
            startLine: 1,
            endLine: 1,
          },
          tokenCount: 1,
          charCount: 6,
        },
      ],
    }));
    const customPipeline = vi.fn(() => ({ run: customPipelineRun }));
    const runtime = createDocumentParsingRuntime({
      pipelines: [
        {
          id: "custom-v1",
          label: "自定义管线",
          description: "测试用路由",
          createPipeline: customPipeline,
        },
      ],
    });

    expect(runtime.listPipelines()).toEqual([
      {
        id: "custom-v1",
        label: "自定义管线",
        description: "测试用路由",
      },
    ]);

    const result = await runtime.parseDocuments({
      pipelineId: "custom-v1",
      expectedOutputs: ["chunks"],
      sources: [createSource({ id: "custom-source", name: "custom.md" })],
      chunking: { targetChars: 256 },
    });

    expect(customPipeline).toHaveBeenCalledTimes(1);
    expect(pipelineRunMock).not.toHaveBeenCalled();
    expect(createKnowledgePipelineMock).not.toHaveBeenCalled();
    expect(customPipelineRun).toHaveBeenCalledOnce();
    expect(result.expectedOutputs).toEqual(expect.arrayContaining(["sources", "chunks"]));
    expect(result.preprocessResult.chunks).toHaveLength(1);
  });

  it("executes dynamic parsing branch when dynamic pipeline is selected", async () => {
    pipelineRunMock.mockResolvedValueOnce(createPipelineResult("source-1"));
    bindDynamicDocumentParsingInvocationMock.mockReturnValue({
      policy: {
        policyId: "dynamic-policy",
        pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
      },
      structureArtifacts: [
        {
          artifactId: "artifact-1",
          sourceId: "source-1",
          sourceName: "demo.md",
          blockId: "block-1",
          artifactType: "paragraph",
          text: "正文内容用于解析。",
          tokenCount: 12,
          charCount: 8,
          sourceRange: {
            startLine: 1,
            endLine: 1,
          },
        },
      ],
      granularityFragments: [
        {
          fragmentId: "fragment-1",
          parentArtifactId: "artifact-1",
          sourceId: "source-1",
          sourceName: "demo.md",
          blockId: "block-1",
          artifactType: "paragraph",
          granularity: "token-window",
          fragmentRange: {
            startLine: 1,
            endLine: 1,
          },
          text: "正文内容用于解析。",
          sourceRange: {
            startLine: 1,
            endLine: 1,
          },
          tokenCount: 12,
          charCount: 8,
        },
      ],
      chunks: [
        {
          id: "dynamic-chunk-1",
          sourceId: "source-1",
          sourceName: "demo.md",
          chunkType: "token-window",
          content: "正文内容用于解析。",
        },
      ],
      payload: {
        totalFragmentCount: 1,
        returnedFragmentCount: 1,
        returnedBytes: 6,
        maxResponseBytes: 4096,
        maxEvidenceBytes: 2048,
        nextContinuationToken: "",
      },
      backendTrace: {
        secondaryParse: {
          enabled: true,
        },
      },
    });

    const runtime = createDocumentParsingRuntime();
    const result = await runtime.parseDocuments({
      pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
      sources: [createSource()],
      expectedOutputs: ["chunks"],
      dynamicParsing: {
        enabled: true,
      },
      granularity: {
        secondaryParse: { enabled: true, algorithm: "auto" },
      },
    });

    expect(bindDynamicDocumentParsingInvocationMock).toHaveBeenCalledOnce();
    expect(result.dynamicParsing).toMatchObject({
      policyId: "dynamic-policy",
      pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
    });
    expect(result.structureArtifacts).toHaveLength(1);
    expect(result.granularityFragments).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({ id: "dynamic-chunk-1" });
  });

  it("throws on unsupported pipeline id for route errors", async () => {
    const runtime = createDocumentParsingRuntime();

    await expect(
      runtime.parseDocuments({
        pipelineId: "unknown-pipeline-v1",
        sources: [createSource()],
      })
    ).rejects.toThrow("未知文档解析链路：unknown-pipeline-v1");
  });
});
