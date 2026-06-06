import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock-final-seventh",
    source: "mock-taxonomy-final-seventh",
    categories: []
  }))
};

const embeddingRuntimeMock = {
  protocolVersion: "pact.embedding.v1",
  embedText: vi.fn((value = "") => ({
    vector: Array.from(String(value)).map(() => 0.01),
    text: String(value),
    model: "mock-text-model",
    dimension: 8
  })),
  embedImageEvidence: vi.fn(() => ({
    vector: Array(8).fill(0.1),
    contentType: "image/mock",
    model: "mock-image-model",
    dimension: 8
  })),
  embedJointEvidence: vi.fn(() => ({
    vector: Array(8).fill(0.2),
    modality: "joint",
    model: "mock-joint-model",
    dimension: 8
  })),
  health: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    providers: ["mock"]
  }))
};

const vectorStoreMock = {
  providerId: "sqlite-vec",
  upsert: vi.fn(),
  deleteByTargetIds: vi.fn(),
  search: vi.fn(() => []),
  health: vi.fn(() => ({
    protocolVersion: "pact.vector.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.vector.v1",
    providers: ["sqlite-vec"]
  })),
  close: vi.fn()
};

const learningRuntimeMock = {
  protocolVersion: "pact.learning.v1",
  health: vi.fn(async () => ({
    protocolVersion: "pact.learning.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    enabled: true,
    safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
  })),
  fuseCandidatesSync: vi.fn((input = {}) => ({
    runtime: "mock-final-seventh-learning",
    degraded: false,
    candidates: [...(input.candidates || [])],
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "pact.learning.v1",
    autoApplicable: true,
    candidate: {
      profileId: `${activeProfile?.profileId || "balanced"}-candidate`,
      version: Number(activeProfile?.version || 1) + 1,
      topK: 11,
      weights: {
        bm25: 0.6,
        vector: 0.25,
        image: 0.15
      }
    },
    counts: { feedback: 1 },
    metricsBefore: { score: 0.2 },
    metricsAfter: { score: 0.3 }
  })),
  generateSuggestions: vi.fn(() => [
    {
      suggestionId: "suggestion::mock::ranking",
      type: "rankingRule",
      confidence: 0.41,
      proposedPatch: {
        ruleId: "mock-ranking-rule"
      },
      evidenceRefs: [],
      status: "pending"
    }
  ])
};

const outlineRuntimeMock = {
  protocolVersion: "pact.document-outline.v1",
  build: vi.fn(({ document = {}, sections = [], blocks = [], assets = [] } = {}) => ({
    protocolVersion: "pact.document-outline.v1",
    documentId: document.documentId || "",
    nodeCount: 1,
    syntheticNodeCount: 0,
    sourceStats: {
      sectionCount: sections.length,
      blockCount: blocks.length,
      assetCount: assets.length
    },
    qualityFindings: [
      {
        code: "outline_runtime_disabled",
        severity: "low",
        message: "Document outline runtime is disabled by the active feature profile."
      }
    ],
    nodes: [],
    metadata: {}
  })),
  rangeContainsPosition: vi.fn(() => false)
};

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy-final-seventh.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary-final-seventh.json",
    emailRulesPath: "/tmp/mock-email-rules-final-seventh.json",
    loadSync: taxonomyRuntimeMock.loadSync
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "pact.embedding.v1",
  createEmbeddingRuntime: vi.fn(() => embeddingRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs", () => ({
  SQLITE_VEC_PROVIDER_ID: "sqlite-vec",
  createLocalVectorStore: vi.fn(() => vectorStoreMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  createLearningRuntime: vi.fn(() => learningRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs", () => ({
  createNoopDocumentOutlineRuntime: vi.fn(() => outlineRuntimeMock),
  resolveDocumentOutlineRuntime: vi.fn(async () => outlineRuntimeMock)
}));

import { createKnowledgeCoreMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import { buildKnowledgeDocxExport } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs";

function buildDocument({
  documentId,
  batchId = "batch-final-seventh",
  sourceId = `${documentId}-source`,
  sourcePath = `${documentId}.txt`,
  sourceHash = `sha-${documentId}`,
  title = `Document ${documentId}`,
  summary = `Summary ${documentId}`,
  bodyText = "alpha beta gamma",
  asset = null
} = {}) {
  const sectionId = `${documentId}-section`;
  const blockId = `${documentId}-block`;
  return {
    documentId,
    collectionId: "manual",
    batchId,
    sourceId,
    sourcePath,
    sourceHash,
    documentType: "email",
    title,
    summary,
    metadata: {
      source: "sourceFiles",
      sourceId
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "正文",
        level: 1,
        position: 1,
        metadata: {
          source: "sourceFiles"
        }
      }
    ],
    blocks: [
      {
        blockId,
        documentId,
        sectionId,
        blockType: "text",
        title: "正文",
        text: bodyText,
        snippet: bodyText.slice(0, 40),
        position: 1,
        sourceLocator: {
          batchId,
          sourceId
        },
        metadata: {
          source: "sourceFiles"
        }
      }
    ],
    assets: asset ? [asset] : []
  };
}

async function withTempKnowledgeCore(testCase, { outlineEnabled = true } = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-seventh-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled });
    return await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("text");
  return xml.replace(/\s+/g, " ");
}

describe("knowledge-core index final seventh extra coverage", () => {
  beforeEach(() => {
    taxonomyRuntimeMock.loadSync.mockClear();
    embeddingRuntimeMock.embedText.mockClear();
    embeddingRuntimeMock.embedImageEvidence.mockClear();
    embeddingRuntimeMock.embedJointEvidence.mockClear();
    vectorStoreMock.upsert.mockClear();
    vectorStoreMock.deleteByTargetIds.mockClear();
    vectorStoreMock.search.mockReset();
    vectorStoreMock.search.mockReturnValue([]);
    learningRuntimeMock.fuseCandidatesSync.mockClear();
    learningRuntimeMock.proposeProfile.mockClear();
    learningRuntimeMock.generateSuggestions.mockClear();
    learningRuntimeMock.proposeProfile.mockImplementation(({ activeProfile } = {}) => ({
      protocolVersion: "pact.learning.v1",
      autoApplicable: true,
      candidate: {
        profileId: `${activeProfile?.profileId || "balanced"}-candidate`,
        version: Number(activeProfile?.version || 1) + 1,
        topK: 11,
        weights: {
          bm25: 0.6,
          vector: 0.25,
          image: 0.15
        }
      },
      counts: { feedback: 1 },
      metricsBefore: { score: 0.2 },
      metricsAfter: { score: 0.3 }
    }));
    learningRuntimeMock.generateSuggestions.mockReturnValue([
      {
        suggestionId: "suggestion::mock::ranking",
        type: "rankingRule",
        confidence: 0.41,
        proposedPatch: {
          ruleId: "mock-ranking-rule"
        },
        evidenceRefs: [],
        status: "pending"
      }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers search response-profile aliases, agent-message attachment, and explicit suppression", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-search",
            batchId: "batch-search",
            sourceId: "source-search",
            sourcePath: "search.txt",
            sourceHash: "sha-search",
            title: "Search Document",
            summary: "Search summary",
            bodyText: "alpha beta gamma delta"
          })
        ]
      });

      const apiSearch = mount.search({
        query: "alpha",
        responseProfile: "api",
        limit: 1
      });
      expect(apiSearch.responseProfile).toBe("api");
      expect(apiSearch.agentMessage).toBeUndefined();

      const consoleSearch = mount.search({
        query: "alpha",
        surface: "management-console",
        machineReadable: true,
        timeRange: {
          from: "2026-06-04T00:00:00.000Z",
          to: "2026-06-05T00:00:00.000Z",
          mode: "recent"
        },
        scopeSourceIds: ["source-search"],
        sourceIds: ["source-search", "source-extra"],
        retrievalMode: "keyword",
        keywordOnly: true,
        explain: true,
        limit: 1
      });

      expect(consoleSearch.responseProfile).toBe("agent");
      expect(consoleSearch.agentMessage).toMatchObject({
        protocolVersion: "pact.knowledge-search.agent-message.v1",
        responseProfile: "agent",
        query: "alpha",
        machineReadable: true,
        constraints: {
          retrievalMode: "keyword",
          keywordOnly: true,
          temporalFilter: {
            requested: true,
            applied: false,
            reason: "time_range_filter_not_yet_supported_by_knowledge_search"
          }
        }
      });
      expect(consoleSearch.agentMessage.constraints.sourceIds).toEqual(["source-search", "source-extra"]);
      expect(consoleSearch.agentMessage.constraints.timeRange).toEqual({
        from: "2026-06-04T00:00:00.000Z",
        to: "2026-06-05T00:00:00.000Z",
        mode: "recent"
      });
      expect(consoleSearch.agentMessage.routing).toMatchObject({
        profileRoute: consoleSearch.profileRoute,
        hierarchy: consoleSearch.hierarchy
      });
      expect(consoleSearch.agentMessage.diagnostics.generatedCandidateCount).toBeGreaterThanOrEqual(1);
      expect(consoleSearch.explain.generatedCandidateCount).toBeGreaterThanOrEqual(1);

      const disabledAgentSearch = mount.search({
        query: "alpha",
        responseProfile: "agent",
        machineReadable: true,
        agentMessage: false,
        limit: 1
      });
      expect(disabledAgentSearch.responseProfile).toBe("agent");
      expect(disabledAgentSearch.agentMessage).toBeUndefined();
    });
  });

  it("covers empty DOCX exports, file-name fallbacks, and document/asset hydration aliases", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const emptyExport = await mount.exportDocx({
        limit: 1
      });
      expect(emptyExport.manifest.documentCount).toBe(0);
      expect(emptyExport.fileName.startsWith("pact-knowledge-all-")).toBe(true);
      expect(emptyExport.fileName.endsWith(".docx")).toBe(true);

      const assetText = "hydrated asset payload";
      const assetRelativePath = "assets/hydrate/hydrated.txt";
      const document = buildDocument({
        documentId: "doc-hydrate",
        batchId: "batch-hydrate",
        sourceId: "source-hydrate",
        sourcePath: "hydrate.txt",
        sourceHash: "sha-hydrate",
        title: "Hydrate Document",
        summary: "Hydrate summary",
        bodyText: "hydrate alpha beta",
        asset: {
          assetId: "asset-hydrate",
          documentId: "doc-hydrate",
          sectionId: "doc-hydrate-section",
          blockId: "doc-hydrate-block",
          assetType: "image",
          mediaType: "text/plain",
          title: "Hydrate Asset",
          text: "asset payload",
          ocrText: "",
          caption: "Hydrated asset",
          relativePath: assetRelativePath,
          sha256: "sha-asset-hydrate",
          byteSize: Buffer.byteLength(assetText),
          sourceLocator: {
            batchId: "batch-hydrate",
            sourceId: "source-hydrate"
          },
          metadata: {
            source: "sourceFiles"
          }
        }
      });

      await mount.upsertDocuments({ documents: [document] });

      const itemByDocumentId = mount.getItem({ documentId: "doc-hydrate" });
      const itemByItemId = mount.getItem({ itemId: "doc-hydrate" });
      expect(itemByDocumentId).toMatchObject({
        documentId: "doc-hydrate",
        collectionId: "manual",
        batchId: "batch-hydrate"
      });
      expect(itemByItemId?.documentId).toBe("doc-hydrate");
      expect(itemByItemId?.sections).toHaveLength(1);
      expect(itemByItemId?.blocks).toHaveLength(1);
      expect(itemByItemId?.assets).toHaveLength(1);
      expect(itemByItemId?.assets[0]).toMatchObject({
        assetId: "asset-hydrate",
        byteSize: Buffer.byteLength(assetText),
        sourceLocator: {
          batchId: "batch-hydrate",
          sourceId: "source-hydrate"
        }
      });

      const filteredExport = await mount.exportDocx({
        batchId: "batch-hydrate",
        includeMachineReadable: true,
        limit: 10
      });
      expect(filteredExport.fileName.startsWith("pact-knowledge-batch-hydrate-")).toBe(true);
      expect(filteredExport.manifest).toMatchObject({
        packageType: "pact.knowledge.docx-export",
        machineReadableAppendixFormat: "yaml",
        documentCount: 1
      });
    });
  });

  it("renders DOCX exports with appendix ordering, paragraph chunking, and fallback labels", async () => {
    const longSummary = "long-summary-".repeat(520);
    const exported = await buildKnowledgeDocxExport({
      documents: [
        {
          documentId: "doc-docx",
          title: "",
          documentType: "memo",
          sourceId: "source-docx",
          sourcePath: "/docs/docx.md",
          batchId: "batch-docx",
          summary: longSummary,
          sections: [
            { sectionId: "b-section", title: "Beta Section", level: 3, position: 1 },
            { sectionId: "a-section", title: "Alpha Section", level: 2, position: 1 }
          ],
          blocks: [
            {
              blockId: "blk-a",
              sectionId: "a-section",
              title: "",
              snippet: "Alpha snippet",
              position: 1,
              sourceLocator: { page: 4 }
            },
            {
              blockId: "blk-b",
              sectionId: "b-section",
              title: "Beta Block",
              text: "Beta body",
              position: 2,
              source_locator: {
                pageNumber: 9
              }
            },
            {
              blockId: "blk-loose",
              blockType: "note",
              title: "",
              text: "Loose block body",
              position: 3
            }
          ],
          assets: [
            {
              assetId: "asset-b",
              title: "",
              caption: "Beta caption",
              position: 2,
              sourceLocator: {
                page: 12
              }
            },
            {
              assetId: "asset-a",
              title: "Alpha asset",
              ocrText: "OCR alpha",
              position: 2,
              metadata: {
                sourceRange: {
                  blockStart: 5,
                  blockEnd: 7
                }
              }
            }
          ]
        }
      ],
      generatedAt: "2026-06-05T01:02:03.000Z",
      filters: {},
      includeMachineReadable: true
    });

    expect(exported.fileName.startsWith("pact-knowledge-all-")).toBe(true);
    expect(exported.manifest).toMatchObject({
      packageType: "pact.knowledge.docx-export",
      packageRole: "external-knowledge-corpus",
      machineReadableAppendixFormat: "yaml",
      documentCount: 1,
      sectionCount: 2,
      blockCount: 3,
      assetCount: 2
    });

    const xml = await extractDocxText(exported.buffer);
    expect(xml).toContain("知识文档 1");
    expect(xml).toContain("Alpha Section");
    expect(xml).toContain("Beta Section");
    expect(xml).toContain("未归属章节知识块");
    expect(xml).toContain("note 3");
    expect(xml).toContain("资产与多模态证据");
    expect(xml).toContain("机器可读 YAML 附录");
    expect(xml.indexOf("Alpha Section")).toBeLessThan(xml.indexOf("Beta Section"));
    expect(xml.indexOf("Alpha asset")).toBeLessThan(xml.indexOf("Beta caption"));
    expect(xml).toContain(longSummary.slice(0, 64));
  });

  it("covers feedback aliases and learning failure plus auto-apply branches", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-learning",
            batchId: "batch-learning",
            sourceId: "source-learning",
            sourcePath: "learning.txt",
            sourceHash: "sha-learning",
            title: "Learning Document",
            summary: "Learning summary",
            bodyText: "learning alpha beta gamma"
          })
        ]
      });

      expect(() =>
        mount.recordFeedback({
          clientId: "client-learning",
          query: "alpha"
        })
      ).toThrow("knowledge.feedback.record 缺少 action。");

      const recorded = mount.recordFeedback({
        clientId: "client-learning",
        query: "alpha",
        event: "thumb-down",
        itemId: "item-learning",
        evidenceId: "evidence-learning",
        resultRank: 3,
        context: {
          surface: "console"
        }
      });
      expect(recorded.feedback.action).toBe("thumb_down");
      expect(mount.feedbackSince({ windowHours: 24, limit: 10 })).toHaveLength(1);

      learningRuntimeMock.proposeProfile.mockImplementationOnce(() => {
        throw new Error("learning boom");
      });
      const failed = mount.runLearningJob({
        feedbackWindowHours: 24,
        feedbackLimit: 10
      });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("learning boom");

      mount.setMaintenance({
        learning: {
          enabled: true,
          autoApplyRetrievalProfiles: true,
          minFeedbackForAutoTune: 1,
          requireEvaluationBeforeProfileActivation: false
        }
      });
      const completed = mount.runLearningJob({
        autoApply: true,
        feedbackWindowHours: 24,
        feedbackLimit: 10
      });

      expect(completed.status).toBe("completed");
      expect(completed.generatedSuggestionCount).toBeGreaterThan(0);
      expect(completed.autoAppliedProfileVersion).toBeGreaterThan(0);
      expect(completed.activeProfile).toMatchObject({
        profileId: expect.stringContaining("-candidate")
      });
      expect(completed.candidateProfile).toMatchObject({
        profileId: expect.stringContaining("-candidate")
      });
      await expect(mount.learningHealth()).resolves.toMatchObject({
        feedbackCount: 1,
        learningRuntime: {
          protocolVersion: "pact.learning.v1"
        }
      });
    });
  });
});
