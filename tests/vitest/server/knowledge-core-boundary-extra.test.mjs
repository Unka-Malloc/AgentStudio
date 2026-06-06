import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: vi.fn(() => ({
      schemaVersion: 1,
      version: "mock",
      source: "mock-taxonomy",
      categories: []
    }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "pact.embedding.v1",
  createEmbeddingRuntime: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    embedText: vi.fn((value = "") => ({
      vector: Array.from(value).map(() => 0.01),
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
      providers: []
    }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs", () => ({
  SQLITE_VEC_PROVIDER_ID: "sqlite-vec",
  createLocalVectorStore: vi.fn(() => ({
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
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  createLearningRuntime: vi.fn(() => ({
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
    fuseCandidatesSync: vi.fn(() => ({ runtime: "mock", degraded: true, candidates: [], explanations: [] })),
    proposeProfile: vi.fn(() => ({
      protocolVersion: "pact.learning.v1",
      profileId: "balanced"
    })),
    generateSuggestions: vi.fn(() => [])
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs", () => ({
  createNoopDocumentOutlineRuntime: vi.fn(() => ({
    protocolVersion: "pact.document-outline.v1",
    build: vi.fn(() => ({
      protocolVersion: "pact.document-outline.v1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  })),
  resolveDocumentOutlineRuntime: vi.fn(async () => ({
    protocolVersion: "pact.document-outline.v1",
    build: vi.fn(() => ({
      protocolVersion: "pact.document-outline.v1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  }))
}));

import createKnowledgeCoreMount, { createMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-boundary-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

describe("knowledge-core mount boundary", () => {
  it("builds mount via default export and createMount alias", async () => {
    expect(createMount).toBe(createKnowledgeCoreMount);
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(mount.id).toBe("builtin/knowledge-core");
      expect(mount.kind).toBe("knowledgeBase");
      expect(mount.protocolVersion).toBe("pact.knowledge.v1");
      expect(mount.enabled).toBe(true);
      expect(typeof mount.capabilities).toBe("function");
      expect(mount.capabilities().protocolVersion).toBe("pact.knowledge.v1");
    });
  });

  it("guards listRetrievalProfiles limit bounds", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      mount.getRetrievalProfile();
      const defaultList = mount.listRetrievalProfiles();
      expect(Array.isArray(defaultList)).toBe(true);
      expect(defaultList.length).toBeGreaterThanOrEqual(1);

      const zeroLimit = mount.listRetrievalProfiles({ limit: 0 });
      expect(zeroLimit.length).toBe(defaultList.length);

      const hugeLimit = mount.listRetrievalProfiles({ limit: 2000 });
      expect(hugeLimit.length).toBe(defaultList.length);
    });
  });

  it("handles onBatchCompleted skip switch and passthrough error path", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const skipped = await mount.onBatchCompleted({
        batchId: "batch-skip",
        result: { sourceFiles: [{ id: "x", path: "x.txt", text: "abc" }] },
        settings: { knowledgeCoreEnabled: false }
      });
      expect(skipped).toMatchObject({
        skipped: true,
        reason: "knowledgeCoreEnabled=false"
      });

      await expect(
        mount.onBatchCompleted({
          result: {}
        })
      ).rejects.toThrow("knowledge.ingest.batch 缺少 batchId。");
    });
  });

  it("reload only applies knowledgeCore settings when present", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const before = mount.getMaintenance();
      await mount.reload({
        settings: {
          knowledgeCore: {
            retrieval: { topK: 33 }
          }
        }
      });
      expect(mount.getMaintenance().retrieval.topK).toBe(33);

      await mount.reload({
        settings: {
          other: { unrelated: true }
        }
      });
      expect(mount.getMaintenance().retrieval.topK).toBe(33);

      expect(mount.getMaintenance().maintenance.staleIndexHours).toBe(before.maintenance.staleIndexHours);
    });
  });

  it("exposes health summary for current mount state", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const health = mount.health();
      expect(health).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        ok: true,
        rootPath: expect.any(String),
        taxonomy: {
          path: "/tmp/mock-knowledge-taxonomy.json",
          expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
          emailRulesPath: "/tmp/mock-email-rules.json",
          version: "mock",
          source: "mock-taxonomy"
        }
      });
      expect(health.capabilities.protocolVersion).toBe("pact.knowledge.v1");
    });
  });

  it("supports deleteBatch with empty and explicit batch id", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(mount.deleteBatch()).toEqual({ ok: true, batchId: undefined });
      expect(mount.deleteBatch("batch-delete-me")).toEqual({ ok: true, batchId: "batch-delete-me" });
    });
  });

  it("returns empty-query branches for missing item/document identifiers", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      expect(mount.getItem()).toBeNull();
      expect(mount.getDocumentStructure({ documentId: "" })).toBeNull();
      expect(mount.resolveSuggestion({ suggestionId: "does-not-exist" })).toBeNull();
      expect(mount.getRetrievalProfile()).toMatchObject({
        profileId: "balanced",
        active: true
      });
      expect(mount.listMaintenanceRuns({ limit: 0 })).toEqual([]);
    });
  });

  it("throws on missing userDataPath during initialization", async () => {
    await expect(
      // @ts-expect-error test boundary condition
      createKnowledgeCoreMount()
    ).rejects.toThrow();
  });
});
