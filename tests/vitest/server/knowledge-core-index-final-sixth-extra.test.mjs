import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock-final-sixth",
    source: "mock-taxonomy-final-sixth",
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
    runtime: "mock-final-sixth-learning",
    degraded: false,
    candidates: [...(input.candidates || [])],
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "pact.learning.v1",
    autoApplicable: false,
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
  generateSuggestions: vi.fn(() => [])
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
    path: "/tmp/mock-knowledge-taxonomy-final-sixth.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary-final-sixth.json",
    emailRulesPath: "/tmp/mock-email-rules-final-sixth.json",
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

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs"
  );
  return {
    ...actual,
    buildKnowledgeDocxExport: vi.fn((input = {}) => {
      if (!Array.isArray(input.documents) || input.documents.length === 0) {
        throw new Error("docx export failed: empty scope");
      }
      return actual.buildKnowledgeDocxExport(input);
    })
  };
});

import { createKnowledgeCoreMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function buildDocument({
  documentId,
  batchId = "batch-final-sixth",
  sourceId = `${documentId}-source`,
  sourcePath = `${documentId}.txt`,
  sourceHash = `sha-${documentId}`,
  title = `Document ${documentId}`,
  summary = `Summary ${documentId}`,
  bodyText = "alpha beta gamma"
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
    assets: []
  };
}

async function withTempKnowledgeCore(testCase, { outlineEnabled = true } = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-sixth-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled });
    return await testCase({ mount });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

describe("knowledge-core index final sixth extra coverage", () => {
  it("attaches agent messages from request-surface and string flags on empty responseProfile input", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.upsertDocuments({
        documents: [buildDocument({ documentId: "doc-agent", bodyText: "alpha agent beta" })]
      });

      const result = mount.search({
        query: "alpha",
        requestSurface: "console",
        agentMessage: "yes",
        limit: 1
      });

      expect(result.responseProfile).toBe("agent");
      expect(result.agentMessage).toMatchObject({
        protocolVersion: "pact.knowledge-search.agent-message.v1",
        responseProfile: "agent",
        query: "alpha",
        machineReadable: true
      });
    });
  });

  it("records feedback through the event alias and skips learning when disabled", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(() =>
        mount.recordFeedback({
          query: "alpha"
        })
      ).toThrow("knowledge.feedback.record 缺少 action。");

      const recorded = mount.recordFeedback({
        clientId: "client-final-sixth",
        query: "alpha",
        event: "thumb-up",
        itemId: "doc-feedback",
        evidenceId: "evidence-feedback"
      });

      expect(recorded.feedback.action).toBe("thumb_up");
      expect(mount.feedbackSince({ windowHours: 24, limit: 10 })).toHaveLength(1);

      const healthBeforeDisable = await mount.learningHealth();
      expect(healthBeforeDisable.feedbackCount).toBe(1);

      mount.setMaintenance({
        learning: {
          enabled: false
        }
      });

      const skipped = mount.runLearningJob({
        autoApply: false
      });

      expect(skipped.status).toBe("skipped");
      expect(skipped.reason).toBe("learning-disabled");
    });
  });

  it("falls back to the noop outline runtime when outline is disabled", async () => {
    await withTempKnowledgeCore(
      async ({ mount }) => {
        await mount.upsertDocuments({
          documents: [buildDocument({ documentId: "doc-outline", bodyText: "alpha outline beta" })]
        });

        const structure = mount.getDocumentStructure({ documentId: "doc-outline" });
        expect(structure).toMatchObject({
          document: {
            documentId: "doc-outline"
          }
        });
        expect(structure.qualityFindings[0]).toMatchObject({
          code: "outline_runtime_disabled",
          severity: "low"
        });
      },
      { outlineEnabled: false }
    );
  });

  it("propagates DOCX export failures for empty scopes", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await expect(mount.exportDocx({ documentId: "missing-document" })).rejects.toThrow(
        "docx export failed: empty scope"
      );
    });
  });
});
