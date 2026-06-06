import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock-rich",
    source: "mock-taxonomy-rich",
    checksum: "taxonomy-checksum",
    categories: [
      {
        categoryId: "marketing_promo",
        path: "Email > Marketing",
        label: "Marketing",
        primaryTerms: ["promo", "offer"],
        keywords: ["discount", "coupon"],
        strongTerms: ["marketing"],
        anchorTerms: ["promo"],
        requiredTerms: [],
        queryTriggers: ["promo offer", "coupon discount"],
        queryAnchorTerms: ["promo", "offer"],
        expansionTerms: ["sale"],
        negativeTerms: [],
        minPrimaryHits: 1,
        minPositiveHits: 1
      }
    ],
    guidance: {
      language: "en"
    }
  }))
};

const vectorStoreMock = {
  providerId: "sqlite-vec",
  upsert: vi.fn(),
  deleteByTargetIds: vi.fn(),
  search: vi.fn(() => [])
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
    safeAutoApplySuggestionTypes: ["retrievalProfile"]
  })),
  fuseCandidatesSync: vi.fn((input = {}) => ({
    runtime: "mock-rich-learning",
    degraded: false,
    candidates: [...(input.candidates || [])].sort(
      (left, right) => Number(right.combinedScore || right.score || 0) - Number(left.combinedScore || left.score || 0)
    ),
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "pact.learning.v1",
    autoApplicable: false,
    candidate: {
      profileId: `${activeProfile?.profileId || "balanced"}-candidate`,
      version: Number(activeProfile?.version || 1) + 1,
      topK: 12,
      weights: {
        bm25: 0.55,
        vector: 0.3,
        image: 0.15
      }
    },
    counts: { feedback: 1 }
  })),
  generateSuggestions: vi.fn(() => [])
};

const outlineRuntimeMock = {
  protocolVersion: "pact.document-outline.v1",
  build: vi.fn(({ document, sections = [], blocks = [] } = {}) => ({
    protocolVersion: "pact.document-outline.v1",
    documentId: document?.documentId || "",
    nodeCount: 2,
    syntheticNodeCount: 0,
    qualityFindings: [
      {
        code: "mock_outline_quality",
        severity: "info"
      }
    ],
    nodes: [
      {
        nodeType: "section",
        targetId: sections[0]?.sectionId || `${document?.documentId || "doc"}-section`,
        sectionId: sections[0]?.sectionId || "",
        title: sections[0]?.title || "Generated section",
        summary: "Generated section route",
        text: blocks.map((block) => block.text || block.snippet || "").join("\n"),
        categoryPath: ["mock", "section"],
        metadata: {
          sourceRange: {
            blockStart: 1,
            blockEnd: 3
          },
          outlineOrigin: "mock-outline"
        }
      },
      {
        nodeType: "outline",
        targetId: `${document?.documentId || "doc"}::outline::1`,
        parentNodeType: "section",
        parentTargetId: sections[0]?.sectionId || "",
        sectionId: sections[0]?.sectionId || "",
        title: "Mock outline branch",
        summary: "Promo offer branch",
        text: "promo offer coupon branch",
        categoryPath: ["mock", "outline"],
        metadata: {
          sourceRange: {
            blockStart: 1,
            blockEnd: 2
          },
          outlineOrigin: "mock-outline",
          quality: {
            synthetic: false
          }
        }
      }
    ]
  })),
  rangeContainsPosition: vi.fn((range = {}, position = 0) =>
    Number(position || 0) >= Number(range.blockStart || 0) &&
    Number(position || 0) <= Number(range.blockEnd || 0)
  )
};

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: taxonomyRuntimeMock.loadSync
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "pact.embedding.v1",
  createEmbeddingRuntime: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    embedText: vi.fn((value = "") => ({
      vector: Array(8).fill(String(value).length / 1000),
      text: String(value),
      model: "mock-text-model",
      dimension: 8
    })),
    embedImageEvidence: vi.fn((asset = {}) => ({
      vector: Array(8).fill(String(asset.assetId || "").length / 100),
      contentType: asset.mediaType || "image/mock",
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
  }))
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

import createKnowledgeCoreMount from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2He4QAAAABJRU5ErkJggg==";

async function withKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-even-more-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: true
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function richBatchResult() {
  return {
    batchId: "batch-rich",
    generatedAt: "2026-06-04T10:00:00.000Z",
    sourceFiles: [
      {
        id: "src-rich",
        kind: "image",
        name: "Promo Offer Mail.eml",
        path: "mail/Promo Offer Mail.eml",
        originalRelativePath: "mail/Promo Offer Mail.eml",
        mediaType: "image/png",
        text: [
          "From: Marketing <promo@example.com>",
          "To: Buyer <buyer@example.com>",
          "Subject: Promo offer",
          "",
          "promo offer coupon discount marketing body"
        ].join("\n"),
        imageDataUrl: tinyPngDataUrl,
        embeddedDocuments: [
          {
            id: "attachment-1",
            text: "attachment promo table detail",
            metadata: {
              resourceName: "attachment.txt"
            }
          }
        ],
        visualElements: [
          {
            kind: "table",
            sequence: 2,
            index: 1,
            page: 3,
            title: "Offer table",
            rows: [
              ["sku", "discount"],
              ["A", "50%"]
            ],
            rowCount: 2,
            columnCount: 2,
            extractionMethod: "mock"
          },
          {
            kind: "image",
            sequence: 3,
            index: 1,
            page: 4,
            title: "Inline coupon",
            mediaType: "image/png",
            imageDataUrl: tinyPngDataUrl,
            width: 120,
            height: 80,
            extractionMethod: "mock"
          },
          {
            kind: "table",
            sequence: 4,
            index: 2,
            page: 5,
            title: "Empty table",
            rows: []
          },
          {
            kind: "image",
            sequence: 5,
            index: 2,
            page: 6,
            title: "Broken image",
            imageDataUrl: "not-a-data-url"
          }
        ]
      }
    ],
    transactions: [
      {
        id: "txn-1",
        title: "Promo renewal",
        summary: "Marketing promo renewal transaction",
        status: "open",
        cadence: "weekly",
        categories: ["promo"],
        keywords: ["coupon"],
        messageIds: ["msg-1"],
        timelineEventIds: ["evt-1"],
        decisions: ["approve coupon"],
        pendingItems: ["send final offer"]
      }
    ],
    emails: [
      {
        id: "msg-1",
        subject: "Marketing Promo Offer",
        sentAt: "2026-06-04T09:00:00.000Z",
        excerpt: "coupon discount",
        body: [
          "From: Seller <seller@example.com>",
          "To: Buyer <buyer@example.com>",
          "",
          "promo offer coupon discount marketing"
        ].join("\n"),
        rawObjectId: "raw-msg-1",
        participantIds: ["seller", "buyer"]
      }
    ],
    timeline: [
      {
        id: "evt-1",
        transactionId: "txn-1",
        timestamp: "2026-06-04T09:05:00.000Z",
        title: "Coupon proposed",
        summary: "seller proposed promo coupon"
      }
    ],
    normalizedDocuments: {
      documents: [
        {
          documentId: "norm-1",
          title: "Normalized Offer",
          sourceId: "src-rich",
          relativePath: "normalized/offer.docx",
          sha256: "sha-norm-1",
          granularity: "document",
          adapterId: "mock-adapter",
          warnings: ["low confidence"]
        }
      ]
    }
  };
}

describe("knowledge-core index even more coverage", () => {
  beforeEach(() => {
    taxonomyRuntimeMock.loadSync.mockClear();
    outlineRuntimeMock.build.mockClear();
    vectorStoreMock.upsert.mockClear();
    vectorStoreMock.deleteByTargetIds.mockClear();
    vectorStoreMock.search.mockReset();
    vectorStoreMock.search.mockReturnValue([]);
    learningRuntimeMock.fuseCandidatesSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests rich batches, creates evidence, exports documents, reads assets, and syncs mirror tombstones", async () => {
    await withKnowledgeCore(async ({ mount }) => {
      const ingest = await mount.ingestBatch({
        batchId: "batch-rich",
        result: richBatchResult()
      });

      expect(ingest).toMatchObject({
        batchId: "batch-rich",
        documentCount: 4,
        receivedDocumentCount: 4
      });
      expect(ingest.blockCount).toBeGreaterThan(5);
      expect(ingest.assetCount).toBe(2);
      expect(outlineRuntimeMock.build).toHaveBeenCalled();

      const firstMirror = mount.syncMirror({ since: 0, limit: 3 });
      expect(firstMirror.changes.length).toBe(3);
      expect(firstMirror.hasMore).toBe(true);

      const search = mount.search({
        query: "promo offer coupon",
        responseProfile: "agent",
        machineReadable: true,
        explain: true,
        limit: 5
      });
      expect(search.responseProfile).toBe("agent");
      expect(search.agentMessage).toMatchObject({
        protocolVersion: "pact.knowledge-search.agent-message.v1",
        machineReadable: true,
        query: "promo offer coupon"
      });
      expect(search.items.length).toBeGreaterThan(0);
      expect(search.explain.generatedCandidateCount).toBeGreaterThan(0);
      expect(search.hierarchy.enabled).toBe(true);

      const evidence = mount.getEvidence({ evidenceId: search.items[0].evidenceId });
      expect(evidence?.markdown).toContain("pact_knowledge");
      expect(mount.renderMarkdown({ evidenceId: evidence.evidenceId })?.markdown).toContain("## 来源定位");
      expect(mount.renderMarkdown({ query: "promo coupon", batchId: "batch-rich" })?.evidenceId).toBeTruthy();

      const aggregate = mount.aggregate({
        metric: "email_advertising_by_sender",
        groupBy: "senderDomain",
        documentType: "message",
        classification: "advertising",
        limit: 5
      });
      expect(aggregate.ok).toBe(true);
      expect(aggregate.topGroup?.key).toBe("example.com");
      expect(aggregate.topGroup.evidenceRefs.length).toBeGreaterThan(0);

      const structure = mount.getDocumentStructure({
        documentId: search.items[0].documentId,
        maxNodes: 8
      });
      expect(structure?.nodeCount).toBeGreaterThan(0);
      expect(structure.qualityFindings[0]).toMatchObject({
        code: "mock_outline_quality"
      });

      const item = mount.getItem({ itemId: search.items[0].documentId });
      expect(item?.blocks.length).toBeGreaterThan(0);
      expect(item.assets.length).toBeGreaterThanOrEqual(0);

      const markdownExport = mount.exportMarkdown({ batchId: "batch-rich", limit: 100 });
      expect(markdownExport.contentType).toBe("text/markdown; charset=utf-8");
      expect(markdownExport.buffer.toString("utf8")).toContain("Pact 知识库导出");

      const htmlExport = mount.exportHtml({ sourceId: "src-rich", limit: 100 });
      expect(htmlExport.contentType).toBe("text/html; charset=utf-8");
      expect(htmlExport.buffer.toString("utf8")).toContain("<html");

      const docxExport = await mount.exportDocx({
        batchId: "batch-rich",
        includeMachineReadable: true
      });
      expect(docxExport.manifest).toMatchObject({
        packageType: "pact.knowledge.docx-export",
        documentCount: 4,
        machineReadableAppendixFormat: "yaml"
      });
      expect(docxExport.buffer.length).toBeGreaterThan(100);

      const assetItem = search.items.find((entry) => entry.assets?.length);
      const assetId = assetItem?.assets?.[0]?.assetId || item.assets[0]?.assetId;
      expect(assetId).toBeTruthy();
      const assetContent = await mount.getAssetContent({ assetId });
      expect(assetContent).toMatchObject({
        contentType: "image/png"
      });
      expect(assetContent.buffer.length).toBeGreaterThan(0);
      expect(await mount.getAssetContent({ assetId: "missing" })).toBeNull();

      const health = mount.health();
      expect(health.counts.documents).toBe(4);
      expect(health.maintenance.missingEmbeddingCount).toBeGreaterThan(0);
      expect(health.maintenance.indexStale).toBe(true);

      const deleted = mount.deleteBatch("batch-rich");
      expect(deleted).toEqual({
        ok: true,
        batchId: "batch-rich"
      });
      const tombstones = mount.syncMirror({ since: firstMirror.latestCursor, limit: 100 });
      expect(tombstones.changes.some((change) => change.kind === "tombstone")).toBe(true);
    });
  });

  it("records ingest conflicts and resolves review items through replace and reject branches", async () => {
    await withKnowledgeCore(async ({ mount }) => {
      const baseDocument = {
        documentId: "doc-conflict",
        collectionId: "manual",
        batchId: "batch-conflict-1",
        sourceId: "src-conflict",
        sourcePath: "mail/conflict.eml",
        sourceHash: "sha-original",
        documentType: "email",
        title: "Original conflict document",
        summary: "original",
        metadata: {
          originalRelativePath: "mail/conflict.eml"
        },
        sections: [
          {
            sectionId: "sec-conflict",
            documentId: "doc-conflict",
            title: "Body",
            level: 1,
            position: 1,
            metadata: {}
          }
        ],
        blocks: [
          {
            blockId: "blk-conflict",
            documentId: "doc-conflict",
            sectionId: "sec-conflict",
            blockType: "text",
            title: "Original",
            text: "original promo content",
            snippet: "original promo content",
            position: 1,
            sourceLocator: {
              batchId: "batch-conflict-1",
              sourceId: "src-conflict"
            },
            metadata: {}
          }
        ],
        assets: []
      };
      expect(mount.upsertDocuments({ documents: [baseDocument] }).documentCount).toBe(1);

      const incoming = {
        ...baseDocument,
        documentId: "doc-conflict-new",
        batchId: "batch-conflict-2",
        sourceHash: "sha-new",
        title: "Replacement conflict document",
        summary: "replacement",
        blocks: [
          {
            ...baseDocument.blocks[0],
            blockId: "blk-conflict-new",
            documentId: "doc-conflict-new",
            text: "replacement promo content",
            snippet: "replacement promo content",
            sourceLocator: {
              batchId: "batch-conflict-2",
              sourceId: "src-conflict"
            }
          }
        ],
        sections: [
          {
            ...baseDocument.sections[0],
            sectionId: "sec-conflict-new",
            documentId: "doc-conflict-new"
          }
        ]
      };
      const conflict = mount.upsertDocuments({ documents: [incoming] });
      expect(conflict.documentCount).toBe(0);
      expect(conflict.skippedConflictCount).toBe(1);
      expect(conflict.reviewItems[0]).toMatchObject({
        status: "pending",
        reason: "source_path_content_conflict"
      });

      const listed = mount.listReviewItems({ status: "pending" });
      expect(listed.items.length).toBe(1);
      const replaced = mount.resolveReviewItem({
        reviewId: listed.items[0].reviewId,
        resolution: "replace",
        patch: {
          note: "accept replacement"
        }
      });
      expect(replaced).toMatchObject({
        status: "resolved",
        resolvedDocument: {
          documentId: "doc-conflict-new"
        }
      });
      expect(mount.getItem({ itemId: "doc-conflict" })).toBeNull();
      expect(mount.getItem({ itemId: "doc-conflict-new" })?.summary).toBe("replacement");

      const duplicate = {
        ...incoming,
        documentId: "doc-conflict-duplicate",
        sourcePath: "mail/conflict-copy.eml",
        blocks: [
          {
            ...incoming.blocks[0],
            blockId: "blk-conflict-duplicate",
            documentId: "doc-conflict-duplicate"
          }
        ],
        sections: [
          {
            ...incoming.sections[0],
            sectionId: "sec-conflict-duplicate",
            documentId: "doc-conflict-duplicate"
          }
        ]
      };
      const duplicateResult = mount.upsertDocuments({ documents: [duplicate] });
      expect(duplicateResult.skippedConflictCount).toBe(1);
      const rejected = mount.resolveReviewItem({
        reviewId: duplicateResult.reviewItems[0].reviewId,
        resolution: "reject"
      });
      expect(rejected).toMatchObject({
        status: "rejected",
        resolvedDocument: null
      });
    });
  });

  it("routes hierarchy reasoning through model decisions and falls back when the model fails", async () => {
    await withKnowledgeCore(async ({ mount }) => {
      await mount.ingestBatch({
        batchId: "batch-rich",
        result: richBatchResult()
      });
      const structure = mount.getDocumentStructure({
        documentId: mount.search({ query: "promo offer", limit: 1, keywordOnly: true }).items[0].documentId
      });
      const selectedNodeId = structure.nodes.find((node) => node.nodeType === "outline")?.nodeId ||
        structure.nodes[0].nodeId;

      const modelDecision = await mount.prepareHierarchyReasoning({
        query: "promo offer",
        modelEnabled: true,
        modelDecisionRuntime: {
          decide: vi.fn(async () => ({
            usedModel: true,
            decision: {
              selectedNodeIds: [selectedNodeId, "unknown-node"],
              reason: "mock selected outline",
              confidence: 0.91,
              nodeScores: {
                [selectedNodeId]: 0.91
              }
            }
          }))
        }
      });
      expect(modelDecision).toMatchObject({
        usedModel: true,
        degraded: false,
        reason: "mock selected outline"
      });
      expect(modelDecision.selectedNodeIds).toEqual([selectedNodeId]);

      const modelSearch = mount.search({
        query: "promo offer",
        hierarchyReasoning: true,
        hierarchyReasoningDecision: modelDecision,
        limit: 3,
        explain: true
      });
      expect(modelSearch.hierarchy.reasoning).toMatchObject({
        enabled: true,
        usedModel: true,
        selectedNodeIds: [selectedNodeId]
      });

      const fallbackDecision = await mount.prepareHierarchyReasoning({
        query: "promo offer",
        modelDecisionRuntime: {
          decide: vi.fn(async () => {
            throw new Error("router offline");
          })
        }
      });
      expect(fallbackDecision).toMatchObject({
        usedModel: false,
        degraded: true
      });
      expect(fallbackDecision.reason).toContain("model_decision_failed:router offline");
      expect(fallbackDecision.selectedNodeIds.length).toBeGreaterThan(0);
    });
  });
});
