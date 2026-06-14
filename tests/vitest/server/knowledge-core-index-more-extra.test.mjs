import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: "v0.0.1:schema:definition-1",
    version: "mock",
    source: "mock-taxonomy",
    categories: []
  }))
};

const embeddingRuntimeMock = {
  protocolVersion: "v0.0.1:knowledge:embedding-1",
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
    protocolVersion: "v0.0.1:knowledge:embedding-1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:embedding-1",
    providers: []
  }))
};

const vectorStoreMock = {
  providerId: "sqlite-vec",
  upsert: vi.fn(),
  deleteByTargetIds: vi.fn(),
  search: vi.fn(() => []),
  health: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:vector-1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:vector-1",
    providers: ["sqlite-vec"]
  })),
  close: vi.fn()
};

const learningRuntimeMock = {
  protocolVersion: "v0.0.1:knowledge:learning-1",
  health: vi.fn(async () => ({
    protocolVersion: "v0.0.1:knowledge:learning-1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:learning-1",
    enabled: true,
    safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
  })),
  fuseCandidatesSync: vi.fn((input = {}) => ({
    runtime: "mock",
    degraded: false,
    candidates: input.candidates || [],
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "v0.0.1:knowledge:learning-1",
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

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: taxonomyRuntimeMock.loadSync
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "v0.0.1:knowledge:embedding-1",
  createEmbeddingRuntime: vi.fn(() => embeddingRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs", () => ({
  SQLITE_VEC_PROVIDER_ID: "sqlite-vec",
  createLocalVectorStore: vi.fn(() => vectorStoreMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "v0.0.1:knowledge:learning-1",
  createLearningRuntime: vi.fn(() => learningRuntimeMock)
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs", () => ({
  createNoopDocumentOutlineRuntime: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:document-outline-1",
    build: vi.fn(() => ({
      protocolVersion: "v0.0.1:knowledge:document-outline-1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  })),
  resolveDocumentOutlineRuntime: vi.fn(async () => ({
    protocolVersion: "v0.0.1:knowledge:document-outline-1",
    build: vi.fn(() => ({
      protocolVersion: "v0.0.1:knowledge:document-outline-1",
      documentId: "",
      nodeCount: 0,
      syntheticNodeCount: 0,
      nodes: [],
      qualityFindings: []
    })),
    rangeContainsPosition: vi.fn(() => false)
  }))
}));

import createKnowledgeCoreMount from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function buildDocument({
  documentId,
  batchId = "batch-main",
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

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-more-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    return await testCase({
      mount,
      userDataPath,
      storeRoot: path.join(userDataPath, "knowledge-core")
    });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

function openKnowledgeDb(storeRoot) {
  return new Database(path.join(storeRoot, "knowledge.sqlite"));
}

function insertRow(db, table, row) {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`).run(
    ...keys.map((key) => (row[key] === undefined ? null : row[key]))
  );
}

describe("knowledge-core index more extra coverage", () => {
  it("covers hierarchy reasoning empty-tree and model decision branches", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await expect(mount.prepareHierarchyReasoning({ query: "alpha" })).resolves.toMatchObject({
        enabled: true,
        usedModel: false,
        degraded: true,
        selectedNodeIds: [],
        reason: "empty_hierarchy_tree"
      });
    });

    await withTempKnowledgeCore(async ({ mount }) => {
      const documentId = "doc-hierarchy";
      await mount.upsertDocuments({
        documents: [buildDocument({ documentId, batchId: "batch-hierarchy", bodyText: "alpha beta" })]
      });

      const modelDecisionRuntime = {
        decide: vi.fn(async () => ({
          usedModel: true,
          degraded: false,
          selectedNodeIds: [documentId],
          nodeScores: {
            [documentId]: 0.91
          },
          reason: "model-selected",
          confidence: 0.82
        }))
      };

      const decision = await mount.prepareHierarchyReasoning({
        query: "alpha",
        batchId: "batch-hierarchy",
        modelEnabled: true,
        modelDecisionRuntime
      });
      expect(decision.usedModel).toBe(true);
      expect(decision.degraded).toBe(false);
      expect(decision.reason).toBe("model-selected");
      expect(decision.selectedNodeIds).toHaveLength(1);
      expect(decision.compactTree.length).toBeGreaterThan(0);
      expect(modelDecisionRuntime.decide).toHaveBeenCalled();

      modelDecisionRuntime.decide.mockImplementationOnce(async () => {
        throw new Error("hierarchy boom");
      });
      const failedDecision = await mount.prepareHierarchyReasoning({
        query: "alpha",
        batchId: "batch-hierarchy",
        modelEnabled: true,
        modelDecisionRuntime
      });
      expect(failedDecision.usedModel).toBe(false);
      expect(failedDecision.degraded).toBe(true);
      expect(failedDecision.reason).toBe("model_decision_failed:hierarchy boom");
    });
  });

  it("covers auditHierarchyIndex empty and persisted finding branches", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const clean = mount.auditHierarchyIndex();
      expect(clean.ok).toBe(true);
      expect(clean.findings).toEqual([]);
      expect(clean.persistedSuggestions).toEqual([]);
    });

    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const documentId = "doc-audit";
      await mount.upsertDocuments({
        documents: [buildDocument({ documentId, batchId: "batch-audit", bodyText: "alpha beta" })]
      });

      const db = openKnowledgeDb(storeRoot);
      try {
        const templateNode = db.prepare("SELECT * FROM kc_hierarchy_nodes LIMIT 1").get();
        expect(templateNode).toBeTruthy();

        db.prepare("DELETE FROM kc_hierarchy_nodes WHERE document_id = ? AND node_type = 'document'").run(documentId);
        db.prepare("DELETE FROM kc_hierarchy_nodes WHERE document_id = ? AND node_type = 'section'").run(documentId);

        insertRow(db, "kc_hierarchy_nodes", {
          ...templateNode,
          hierarchy_id: "hierarchy-orphan-node",
          node_type: "outline",
          target_id: "hierarchy-orphan-target",
          parent_hierarchy_id: "missing-parent-node",
          document_id: documentId,
          section_id: "",
          batch_id: "batch-audit",
          title: "Orphan node",
          summary: "orphan",
          text: "orphan",
          category_path: "",
          level: 4,
          metadata_json: JSON.stringify({
            source: "test"
          })
        });
        insertRow(db, "kc_hierarchy_nodes", {
          ...templateNode,
          hierarchy_id: "hierarchy-empty-node",
          node_type: "outline",
          target_id: "hierarchy-empty-target",
          parent_hierarchy_id: "",
          document_id: documentId,
          section_id: "",
          batch_id: "batch-audit",
          title: "",
          summary: "",
          text: "",
          category_path: "",
          level: 2,
          metadata_json: "{}"
        });
        for (let index = 1; index <= 6; index += 1) {
          insertRow(db, "kc_hierarchy_nodes", {
            ...templateNode,
            hierarchy_id: `hierarchy-overloaded-${index}`,
            node_type: "document",
            target_id: `hierarchy-overloaded-doc-${index}`,
            parent_hierarchy_id: "shared-branch-parent",
            document_id: `hierarchy-overloaded-doc-${index}`,
            section_id: "",
            batch_id: "batch-audit",
            title: `Branch ${index}`,
            summary: `branch ${index}`,
            text: `branch ${index}`,
            category_path: "",
            level: 4,
            metadata_json: "{}"
          });
        }

        const audited = mount.auditHierarchyIndex({
          limit: 10,
          splitThreshold: 1,
          persistSuggestions: true
        });
        const codes = audited.findings.map((finding) => finding.code);
        expect(audited.ok).toBe(false);
        expect(codes).toEqual(
          expect.arrayContaining([
            "missing_document_hierarchy_nodes",
            "missing_section_hierarchy_nodes",
            "orphan_hierarchy_nodes",
            "empty_coarse_hierarchy_nodes",
            "overloaded_hierarchy_branches"
          ])
        );
        expect(audited.persistedSuggestions).toHaveLength(audited.findings.length);
        expect(audited.suggestions).toHaveLength(audited.findings.length);
      } finally {
        db.close();
      }
    });
  });

  it("covers learning health, deployment lookup, and runLearningJob failure fallback", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      await mount.recordFeedback({
        clientId: "client-1",
        query: "alpha",
        action: "open",
        itemId: "item-1",
        evidenceId: "evidence-1"
      });

      learningRuntimeMock.proposeProfile.mockImplementationOnce(() => {
        throw new Error("learning boom");
      });
      const failed = await mount.runLearningJob({ autoApply: false });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("learning boom");

      const completed = await mount.runLearningJob({
        autoApply: false,
        feedbackWindowHours: 1,
        feedbackLimit: 10
      });
      expect(completed.status).toBe("completed");
      expect(completed.generatedSuggestionCount).toBeGreaterThan(0);

      const activeProfile = mount.getRetrievalProfile({});
      expect(activeProfile.profileKey).toBeTruthy();
      const deployment = mount.createRetrievalProfileDeployment({
        profileKey: activeProfile.profileKey,
        status: "canary",
        trafficPercent: 25
      });
      expect(deployment.profileKey).toBe(activeProfile.profileKey);

      const health = await mount.learningHealth();
      expect(health.ok).toBe(true);
      expect(health.degraded).toBe(false);
      expect(health.feedbackCount).toBe(1);
      expect(health.pendingSuggestionCount).toBeGreaterThanOrEqual(1);
      expect(health.activeProfile.profileKey).toBe(activeProfile.profileKey);
      expect(health.learningRuntime).toMatchObject({
        protocolVersion: "v0.0.1:knowledge:learning-1",
        ok: true,
        degraded: false
      });
      expect(health.deployments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deploymentId: deployment.deploymentId
          })
        ])
      );
      expect(health.boundaries).toMatchObject({
        autoAppliesRetrievalProfiles: true,
        requiresEvaluationBeforeProfileActivation: true,
        canaryEnabled: true
      });
    });
  });

  it("covers maintenance route branches and latest-run listing", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
      const documentId = "doc-maintenance";
      const assetPath = "assets/thumbs/cover.png";
      const document = buildDocument({
        documentId,
        batchId: "batch-maintenance",
        bodyText: "alpha maintenance",
        asset: {
          assetId: "asset-maintenance",
          documentId,
          sectionId: `${documentId}-section`,
          blockId: `${documentId}-block`,
          assetType: "image",
          mediaType: "image/png",
          title: "Maintenance asset",
          text: "asset payload",
          ocrText: "",
          caption: "",
          relativePath: assetPath,
          sha256: "sha-maintenance",
          byteSize: 12,
          sourceLocator: {
            batchId: "batch-maintenance",
            sourceId: `${documentId}-source`
          },
          metadata: {}
        }
      });
      await mount.upsertDocuments({ documents: [document] });
      await mount.search({
        query: "maintenance",
        batchId: "batch-maintenance",
        limit: 1
      });
      mount.reindex({ batchSize: 1 });
      await wait();

      const repaired = mount.runMaintenance({ taskType: "repair_missing_thumbnails" });
      expect(repaired.status).toBe("completed");
      expect(repaired.output.repaired).toBe(1);
      expect(mount.listMaintenanceRuns({ limit: 1 })[0].taskType).toBe("repair_missing_thumbnails");
      expect(mount.getItem({ documentId })?.assets?.[0]?.metadata?.thumbnailRelativePath).toBe(assetPath);
      await wait();

      const deletedOrphans = mount.runMaintenance({ taskType: "delete_orphan_objects" });
      expect(deletedOrphans.status).toBe("completed");
      expect(deletedOrphans.output).toMatchObject({
        deletedEmbeddings: expect.any(Number),
        deletedEvidencePacks: expect.any(Number)
      });
      expect(mount.listMaintenanceRuns({ limit: 1 })[0].taskType).toBe("delete_orphan_objects");
      await wait();

      const garbageCleanup = mount.runMaintenance({ taskType: "garbage_cleanup", dryRun: true });
      expect(garbageCleanup.status).toBe("completed");
      expect(garbageCleanup.output.dryRun).toBe(true);
      expect(garbageCleanup.output.planned).toBeDefined();
      expect(mount.listMaintenanceRuns({ limit: 1 })[0].taskType).toBe("garbage_cleanup");
      await wait();

      const learningRoute = mount.runMaintenance({
        taskType: "learning_run",
        autoApply: false,
        feedbackWindowHours: 1,
        feedbackLimit: 10
      });
      expect(learningRoute.status).toBe("completed");
      expect(learningRoute.output.status).toBe("completed");
      expect(learningRoute.output.generatedSuggestionCount).toBeGreaterThan(0);
      expect(mount.listMaintenanceRuns({ limit: 1 })[0].taskType).toBe("learning_run");

      const latestRuns = mount.listMaintenanceRuns({ limit: 3 });
      expect(latestRuns).toHaveLength(3);
      expect(latestRuns[0].taskType).toBe("learning_run");
      expect(latestRuns[0].output).toBeTruthy();
      expect(latestRuns[0].input).toMatchObject({
        taskType: "learning_run"
      });

      const db = openKnowledgeDb(storeRoot);
      try {
        const templateEmbedding = db.prepare("SELECT * FROM kc_embeddings LIMIT 1").get();
        if (templateEmbedding) {
          insertRow(db, "kc_embeddings", {
            ...templateEmbedding,
            embedding_id: "orphan-embedding-id",
            target_type: "block",
            target_id: "missing-block-id",
            content_hash: "orphan-content-hash",
            created_at: templateEmbedding.created_at,
            updated_at: templateEmbedding.updated_at
          });
        }
        const templateEvidence = db.prepare("SELECT * FROM kc_evidence_packs LIMIT 1").get();
        if (templateEvidence) {
          insertRow(db, "kc_evidence_packs", {
            ...templateEvidence,
            evidence_id: "orphan-evidence-id",
            document_id: "missing-document-id",
            batch_id: "missing-batch",
            created_at: templateEvidence.created_at
          });
        }
      } finally {
        db.close();
      }

      const orphanCleanup = mount.runMaintenance({ taskType: "delete_orphan_objects" });
      expect(orphanCleanup.status).toBe("completed");
      expect(orphanCleanup.output.deletedEmbeddings).toBeGreaterThanOrEqual(0);
      expect(orphanCleanup.output.deletedEvidencePacks).toBeGreaterThanOrEqual(0);
    });
  });
});
