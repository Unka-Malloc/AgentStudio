import { describe, expect, it } from "vitest";
import {
  DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
  createStructureArtifacts,
  dispatchDynamicDocumentParsingAlgorithm,
  bindDynamicDocumentParsingInvocation,
  materializeDynamicEvidenceBlocks,
} from "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs";

function buildSource(overrides = {}) {
  return {
    id: "source-1",
    name: "Doc Source",
    path: "/tmp/source-1.md",
    mediaType: "text/markdown",
    contentHash: "content-hash",
    sourceMetadata: {
      page: 2,
      slideIndex: 1,
      sheetName: "Sheet-A",
      bbox: [10, 20, 100, 200],
    },
    ...overrides,
  };
}

function normalizeLinePayload() {
  return {
    id: "block-1",
    sourceId: "source-1",
    kind: "paragraph",
    sourceName: "Doc Source",
    text: "第一句用于归一化。\r\n第二句用于归一化。\r第三句用于归一化。",
    sourceStartLine: "4",
    sourceEndLine: "6",
    headingPath: ["根章节", "", "子章节"],
    metadata: {
      page: 2,
    },
  };
}

describe("dynamic parameter document parsing extra coverage", () => {
  it("normalizes structure artifacts for valid blocks and ignores blank texts", () => {
    const artifacts = createStructureArtifacts({
      sources: [buildSource()],
      blocks: [
        normalizeLinePayload(),
        { id: "block-blank", sourceId: "source-1", text: "   \n\t" },
      ],
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      artifactType: "paragraph",
      sourceId: "source-1",
      sourceName: "Doc Source",
      blockId: "block-1",
      headingPath: ["根章节", "子章节"],
      titlePath: ["根章节", "子章节"],
      sourceRange: {
        startLine: 4,
        endLine: 6,
      },
      metadata: {
        sourceMediaType: "text/markdown",
        sourceMetadataHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
  });

  it("dispatches paragraph sentence algorithm and emits expected fragment metadata", () => {
    const [artifact] = createStructureArtifacts({
      sources: [buildSource()],
      blocks: [normalizeLinePayload()],
    });

    const parsed = dispatchDynamicDocumentParsingAlgorithm({
      artifact,
      artifactType: artifact.artifactType,
      granularity: {
        secondaryParse: {
          enabled: true,
          algorithm: "paragraph-sentence-v1",
          targetTokens: 80,
          targetChars: 48,
        },
      },
    });

    expect(parsed.algorithmId).toBe("paragraph-sentence-v1");
    expect(parsed.artifactType).toBe("paragraph");
    expect(parsed.granularity.targetTokens).toBe(80);
    expect(parsed.fragments).toHaveLength(1);
    expect(parsed.fragments[0]).toMatchObject({
      policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      fragmentRange: {
        sentenceStart: 1,
        sentenceEnd: 3,
      },
      fragmentationTrace: {
        algorithm: "paragraph-sentence-v1",
      },
      granularity: "paragraph-sentence",
    });
    expect(parsed.fragments[0].text).toContain("第一句用于归一化");
  });

  it("switches to table cell parser when configured and still keeps trace policy", () => {
    const artifacts = createStructureArtifacts({
      sources: [buildSource()],
      blocks: [{
        id: "block-table",
        sourceId: "source-1",
        sourceName: "Doc Source",
        kind: "table",
        text: "| 字段 | 说明 |\n| --- | --- |\n| source | 原文 |\n| artifactId | 父结构ID |",
        sourceStartLine: 1,
        sourceEndLine: 3,
        headingPath: ["表格"],
      }],
    });

    const [artifact] = artifacts;
    const parsed = dispatchDynamicDocumentParsingAlgorithm({
      artifact,
      artifactType: artifact.artifactType,
      granularity: {
        tableGranularity: "cell-window",
        secondaryParse: { enabled: true, algorithm: "auto", targetTokens: 24, targetChars: 200 },
      },
    });

    expect(parsed.algorithmId).toBe("table-cell-window-v1");
    expect(parsed.fragments.length).toBeGreaterThan(0);
    expect(parsed.fragments[0].fragmentationTrace).toMatchObject({
      policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      algorithm: "table-cell-window-v1",
    });
    expect(parsed.fragments[0].fragmentRange).toMatchObject({
      rowStart: 1,
      rowEnd: 2,
    });
  });

  it("falls back to token-window algorithm for unsupported requested algorithms", () => {
    expect(() =>
      dispatchDynamicDocumentParsingAlgorithm({
        artifact: {
          artifactId: "artifact::source::unsupported",
          sourceId: "source-1",
          sourceName: "Doc Source",
          blockId: "block-unsupported",
          artifactType: "paragraph",
          text: "A".repeat(600),
          sourceRange: { startLine: 1, endLine: 1 },
          tokenCount: 600,
          headingPath: [],
          titlePath: [],
        },
        artifactType: "paragraph",
        algorithmId: "unknown-algorithm",
        granularity: {
          secondaryParse: { enabled: true, targetTokens: 24, targetChars: 120 },
        },
      })
    ).toThrow(/未知动态文档解析算法/);
  });

  it("falls back to token-window parser when explicitly configured", () => {
    const parsed = dispatchDynamicDocumentParsingAlgorithm({
      artifact: {
        artifactId: "artifact::source::mystery",
        sourceId: "source-1",
        sourceName: "Doc Source",
        blockId: "block-mystery",
        artifactType: "paragraph",
        text: "短文本用于 fallback 测试。".repeat(10),
      },
      algorithmId: "token-window-fallback-v1",
      artifactType: "paragraph",
      granularity: {
        secondaryParse: { enabled: true, algorithm: "token-window-fallback-v1", targetTokens: 80, targetChars: 40 },
      },
    });

    expect(parsed.algorithmId).toBe("token-window-fallback-v1");
    expect(parsed.fragments[0]).toMatchObject({
      granularity: "token-window",
      fragmentationTrace: {
        algorithm: "token-window-fallback-v1",
      },
    });
  });

  it("normalizes budgets and boundaries for bind invocation with fallback defaults", () => {
    const binding = bindDynamicDocumentParsingInvocation({
      sources: [buildSource()],
      blocks: [{
        id: "block-boundary",
        sourceId: "source-1",
        kind: "paragraph",
        text: "a".repeat(10),
        sourceStartLine: "1",
        sourceEndLine: "1",
      }],
      contextBudget: { knowledgeTokens: -10, budgetScope: 0 },
      payloadBudget: { maxResponseBytes: 1, maxEvidenceBytes: -5 },
      granularity: {
        secondaryParse: {
          enabled: true,
          algorithm: "auto",
          targetTokens: "bad",
          targetChars: "bad",
        },
      },
      chunking: {
        maxTokens: 120,
        maxChars: 500,
      },
    });

    expect(binding.policy.contextBudget.knowledgeTokens).toBe(80);
    expect(binding.policy.contextBudget.budgetScope).toBe("knowledge-recall-only");
    expect(binding.policy.payloadBudget.maxResponseBytes).toBe(4096);
    expect(binding.policy.payloadBudget.maxEvidenceBytes).toBe(2048);
    expect(binding.policy.granularity.targetTokens).toBe(512);
    expect(binding.policy.granularity.targetChars).toBe(2048);
    expect(binding.policy.granularity.secondaryParse.algorithm).toBe("auto");
    expect(binding.granularityFragments).toHaveLength(1);
  });

  it("respects runtime dynamic parsing defaults as request-local boundaries and applies runtime algorithm registry", () => {
    const runtime = {
      granularity: {
        secondaryParse: { enabled: true, algorithm: "table-row-window-v1", targetTokens: 32, targetChars: 64 },
      },
      algorithmRegistry: {
        paragraph: "token-window-fallback-v1",
      },
    };

    const binding = bindDynamicDocumentParsingInvocation({
      sources: [buildSource()],
      blocks: [normalizeLinePayload()],
      granularity: {
        preferOriginalStructure: true,
        allowPartialEvidence: false,
        secondaryParse: { enabled: true, algorithm: "auto" },
      },
      documentParsing: {
        dynamicParsing: { enabled: true },
      },
      contextBudget: { knowledgeTokens: 64 },
      payloadBudget: { maxResponseBytes: 1024, maxEvidenceBytes: 2048 },
    }, runtime);

    expect(binding.backendTrace.secondaryParse.enabled).toBe(true);
    expect(binding.granularityFragments).toHaveLength(1);
    expect(binding.granularityFragments[0].granularity).toBe("token-window");
    expect(binding.granularityFragments[0].fragmentationTrace.algorithm).toBe("token-window-fallback-v1");
    expect(binding.chunks[0].metadata.materialization.mode).toBe("fragment");
  });

  it("supports empty input and still returns stable envelope fields", () => {
    const emptyBinding = bindDynamicDocumentParsingInvocation({
      sources: [buildSource()],
      blocks: [],
    });

    expect(emptyBinding.structureArtifacts).toEqual([]);
    expect(emptyBinding.granularityFragments).toEqual([]);
    expect(emptyBinding.chunks).toEqual([]);
    expect(emptyBinding.payload.totalFragmentCount).toBe(0);
    expect(emptyBinding.payload.returnedFragmentCount).toBe(0);
    expect(emptyBinding.payload.nextContinuationToken).toBe("");
  });

  it("materializes evidence blocks from original-structure mode and keeps truncation-safe snippets", () => {
    const payload = materializeDynamicEvidenceBlocks({
      source: buildSource(),
      blocks: [normalizeLinePayload()],
    });

    expect(payload.policy.policyId).toBe("dynamic-parameter-document-parsing-policy");
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0]).toMatchObject({
      blockId: "block-1",
      artifactId: payload.granularityFragments[0].parentArtifactId,
      blockType: "paragraph",
      metadata: {
        materialization: {
          mode: "structure",
        },
      },
    });
    expect(payload.blocks[0].snippet.length).toBeLessThanOrEqual(500);
    expect(payload.blocks[0].sourceLocator).toEqual({
      sourceId: "source-1",
      sourceRange: { startLine: 4, endLine: 6 },
    });
  });
});
