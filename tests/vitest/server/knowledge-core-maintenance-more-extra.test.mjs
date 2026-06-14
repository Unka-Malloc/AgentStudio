import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: vi.fn(() => ({
      schemaVersion: "v0.0.1:schema:definition-1",
      version: "mock",
      source: "mock-taxonomy",
      categories: []
    }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "v0.0.1:knowledge:embedding-1",
  createEmbeddingRuntime: vi.fn(() => ({
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
      protocolVersion: "v0.0.1:knowledge:vector-1",
      ok: true,
      degraded: false
    })),
    capabilities: vi.fn(() => ({
      protocolVersion: "v0.0.1:knowledge:vector-1",
      providers: ["sqlite-vec"]
    })),
    close: vi.fn()
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "v0.0.1:knowledge:learning-1",
  createLearningRuntime: vi.fn(() => ({
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
        topK: 9,
        weights: { bm25: 0.7, vector: 0.2, image: 0.1 }
      },
      counts: { feedback: 1 },
      metricsBefore: { score: 0.1 },
      metricsAfter: { score: 0.2 }
    })),
    generateSuggestions: vi.fn(() => [])
  }))
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

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-maintenance-more-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled: false });
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

function hashSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildDocument({ documentId, batchId = "batch-maint", sourceHash = "", sourcePath = `${documentId}.txt`, assets = [] } = {}) {
  const sectionId = `${documentId}-section`;
  const blockId = `${documentId}-block`;
  return {
    documentId,
    collectionId: "manual",
    batchId,
    sourceId: `${documentId}-source`,
    sourcePath,
    sourceHash,
    documentType: "email",
    title: `Document ${documentId}`,
    summary: "alpha summary",
    metadata: {
      source: "sourceFiles",
      originalRelativePath: sourcePath
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "Body",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId,
        documentId,
        sectionId,
        blockType: "text",
        title: "Body",
        text: "alpha beta maintenance content",
        snippet: "alpha beta",
        position: 1,
        sourceLocator: { batchId },
        metadata: {}
      }
    ],
    assets: assets.map((asset, index) => ({
      assetId: `${documentId}-asset-${index + 1}`,
      documentId,
      sectionId,
      blockId,
      assetType: "image",
      mediaType: "image/png",
      title: `Asset ${index + 1}`,
      text: asset.text || "",
      ocrText: asset.ocrText || "",
      caption: asset.caption || "",
      relativePath: asset.relativePath || "",
      sha256: asset.sha256 || "",
      byteSize: asset.byteSize || 0,
      width: asset.width || 10,
      height: asset.height || 10,
      sourceLocator: { batchId },
      metadata: asset.metadata || {}
    }))
  };
}

function openKnowledgeDb(storeRoot) {
  return new Database(path.join(storeRoot, "knowledge.sqlite"));
}

describe("knowledge-core maintenance more coverage", () => {
  it("covers asset validation and thumbnail repair maintenance branches", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const assetBytes = Buffer.from("actual asset bytes");
      await fs.mkdir(path.join(storeRoot, "assets"), { recursive: true });
      await fs.writeFile(path.join(storeRoot, "assets", "existing.bin"), assetBytes);

      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-assets",
            assets: [
              { relativePath: "", sha256: "" },
              { relativePath: "../outside.bin", sha256: "" },
              { relativePath: "assets/missing.bin", sha256: "" },
              { relativePath: "assets/existing.bin", sha256: hashSha256("different") },
              { relativePath: "assets/existing.bin", sha256: hashSha256(assetBytes) }
            ]
          })
        ]
      });

      const validationRun = mount.runMaintenance({ task: "validate-assets" });
      expect(validationRun).toMatchObject({
        taskType: "validate_assets",
        status: "completed",
        output: { checkedAssets: 5, ok: false }
      });
      const validation = validationRun.output;
      expect(validation).toMatchObject({
        checkedAssets: 5,
        ok: false
      });
      expect(validation.missing).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: "missing-relative-path" }),
        expect.objectContaining({ reason: "missing-file" })
      ]));
      expect(validation.unsafePaths).toHaveLength(1);
      expect(validation.shaMismatch).toHaveLength(1);

      const repairRun = mount.runMaintenance({ taskType: "repair_missing_thumbnails" });
      expect(repairRun).toMatchObject({
        status: "completed",
        output: {
          repaired: 5,
          policy: "source-image-reused"
        }
      });

      const db = openKnowledgeDb(storeRoot);
      try {
        const repaired = db.prepare("SELECT metadata_json FROM kc_assets").all()
          .map((row) => JSON.parse(row.metadata_json))
          .filter((metadata) => metadata.thumbnailPolicy === "source-image-reused");
        expect(repaired).toHaveLength(5);
      } finally {
        db.close();
      }

      expect(mount.listMaintenanceRuns({ limit: 5 }).map((run) => run.taskType))
        .toEqual(expect.arrayContaining(["repair_missing_thumbnails", "validate_assets"]));
    });
  });

  it("covers orphan cleanup, garbage cleanup, unknown task, and reembed maintenance branches", async () => {
    await withTempKnowledgeCore(async ({ mount, userDataPath, storeRoot }) => {
      await mount.upsertDocuments({
        documents: [buildDocument({ documentId: "doc-clean", batchId: "batch-clean" })]
      });
      const db = openKnowledgeDb(storeRoot);
      try {
        const now = new Date(Date.now() - 48 * 3600_000).toISOString();
        db.prepare(`
          INSERT INTO kc_embeddings (
            embedding_id, target_type, target_id, modality, provider, dimension,
            vector_json, content_hash, metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run("embedding-orphan", "block", "missing-block", "text", "mock", 8, "[]", "", "{}", now);
        db.prepare(`
          INSERT INTO kc_evidence_packs (
            evidence_id, batch_id, document_id, section_id, block_id, asset_id,
            title, snippet, score, reasons_json, locator_json, payload_json, markdown, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run("evidence-orphan", "batch-clean", "missing-doc", "", "", "", "orphan", "", 0, "[]", "{}", "{}", "", now);

        for (let index = 0; index < 4; index += 1) {
          db.prepare(`
            INSERT INTO kc_review_items (
              review_id, source, status, reason, severity, operation_id, batch_id,
              entity_id, entity_type, title, summary, current_record_json,
              incoming_record_json, evidence_refs_json, created_at, updated_at,
              resolved_at, resolution_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            `review-${index}`,
            "knowledge-core",
            "pending",
            "duplicate_source_document",
            "warning",
            "test",
            "batch-clean",
            `doc-${index}`,
            "document",
            "Duplicate",
            "",
            "{}",
            "{}",
            "[]",
            now,
            now,
            "",
            "{}"
          );
        }
      } finally {
        db.close();
      }

      const jobsRoot = path.join(userDataPath, "jobs", "job-old");
      await fs.mkdir(jobsRoot, { recursive: true });
      await fs.writeFile(path.join(jobsRoot, "meta.json"), JSON.stringify({
        status: "failed",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }));
      await fs.writeFile(path.join(jobsRoot, "artifact.txt"), "job artifact");
      const cacheRoot = path.join(userDataPath, "knowledge-sources", "hydrated", "source-1", "cache-old");
      await fs.mkdir(cacheRoot, { recursive: true });
      await fs.writeFile(path.join(cacheRoot, "cache.txt"), "cache");
      fsSync.utimesSync(cacheRoot, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
      const reportsRoot = path.join(userDataPath, "knowledge-skills");
      await fs.mkdir(reportsRoot, { recursive: true });
      for (let index = 0; index < 12; index += 1) {
        const reportPath = path.join(reportsRoot, `distillation-report-${String(index).padStart(2, "0")}.json`);
        await fs.writeFile(reportPath, "{}");
        const timestamp = new Date(Date.UTC(2026, 0, index + 1));
        fsSync.utimesSync(reportPath, timestamp, timestamp);
      }

      const orphanRun = mount.runMaintenance({ taskType: "cleanup_orphans" });
      expect(orphanRun).toMatchObject({
        status: "completed",
        output: {
          deletedEmbeddings: 1,
          deletedEvidencePacks: 1
        }
      });

      const dryRun = mount.runMaintenance({
        taskType: "gc",
        keepDuplicateReviewItems: 1,
        includeJobArtifacts: true,
        jobOlderThanHours: 0,
        includeHydrationCaches: true,
        hydrationCacheOlderThanHours: 1,
        maxDistillationReports: 10
      });
      expect(dryRun).toMatchObject({
        status: "completed",
        output: {
          dryRun: true,
          planned: {
            duplicateReviewItems: 3,
            jobArtifacts: 1,
            hydrationCaches: 1,
            distillationReports: 2
          },
          after: null
        }
      });
      expect((await fs.readdir(reportsRoot)).filter((name) => name.startsWith("distillation-report-"))).toHaveLength(12);

      const appliedRun = mount.runMaintenance({
        taskType: "compact_storage",
        dryRun: false,
        keepDuplicateReviewItems: 1,
        includeJobArtifacts: true,
        jobOlderThanHours: 0,
        includeHydrationCaches: true,
        hydrationCacheOlderThanHours: 1,
        maxDistillationReports: 10,
        checkpoint: false,
        vacuum: true
      });
      expect(appliedRun).toMatchObject({
        status: "completed",
        output: {
          dryRun: false,
          applied: {
            duplicateReviewItems: 3,
            distillationReports: 2,
            jobArtifacts: 1,
            hydrationCaches: 1,
            sqliteCheckpoint: null,
            sqliteVacuum: { ok: true }
          }
        }
      });
      expect((await fs.readdir(reportsRoot)).filter((name) => name.startsWith("distillation-report-"))).toHaveLength(10);
      await expect(fs.stat(jobsRoot)).rejects.toThrow();
      await expect(fs.stat(cacheRoot)).rejects.toThrow();

      const unknownRun = mount.runMaintenance({ taskType: "not-real" });
      expect(unknownRun).toMatchObject({
        status: "completed",
        output: {
          ok: false,
          error: "未知知识库维护任务：not_real"
        }
      });

      const reembedRun = mount.runMaintenance({
        taskType: "reembed_by_model_version",
        modelVersion: "v-test"
      });
      expect(reembedRun).toMatchObject({
        status: "completed",
        taskType: "reembed_by_model_version",
        output: {
          protocolVersion: "v0.0.1:knowledge:core-1",
          status: "completed",
          blockFtsRows: expect.any(Number),
          blockEmbeddings: expect.any(Number),
          hierarchyNodes: expect.any(Number)
        }
      });
      expect(mount.getMaintenance().embeddingModel.version).toBe("v-test");
    });
  });

  it("covers source deduplication, retrieval profile comparison, and quality assertion branches", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const duplicateHash = hashSha256("same source");
      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-keep",
            batchId: "batch-dedupe",
            sourceHash: duplicateHash,
            sourcePath: "mail/message.eml"
          })
        ]
      });

      const db = openKnowledgeDb(storeRoot);
      try {
        const keep = db.prepare("SELECT * FROM kc_documents WHERE document_id = ?").get("doc-keep");
        db.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-delete",
          keep.collection_id,
          keep.batch_id,
          "doc-delete-source",
          keep.document_type,
          "Document doc-delete",
          keep.summary,
          "mail/message 1.eml",
          duplicateHash,
          JSON.stringify({ source: "sourceFiles", originalRelativePath: "mail/message 1.eml" }),
          keep.created_at,
          "2026-06-04T00:00:01.000Z"
        );
      } finally {
        db.close();
      }

      const dedupePreview = mount.runMaintenance({
        taskType: "dedupe_sources",
        dryRun: true
      });
      expect(dedupePreview).toMatchObject({
        status: "completed",
        output: {
          dryRun: true,
          duplicateGroupCount: 1,
          wouldDeleteDocumentCount: 1,
          deletedDocumentCount: 0
        }
      });
      expect(dedupePreview.output.examples[0]).toMatchObject({
        kept: { documentId: "doc-keep" },
        deleted: [expect.objectContaining({ documentId: "doc-delete" })]
      });

      const dedupeApply = mount.runMaintenance({
        taskType: "deduplicate_sources",
        dryRun: false
      });
      expect(dedupeApply).toMatchObject({
        status: "completed",
        output: {
          deletedDocumentCount: 1,
          remainingSourceDocumentEstimate: 1
        }
      });
      expect(mount.getItem({ documentId: "doc-delete" })).toBeNull();

      const comparison = mount.runMaintenance({
        taskType: "compare_retrieval_profiles",
        queries: ["alpha"],
        profiles: [
          { id: "balanced", retrieval: { bm25Weight: 0.7, vectorWeight: 0.2, imageWeight: 0.1 } },
          { id: "vector", retrieval: { bm25Weight: 0.2, vectorWeight: 0.7, imageWeight: 0.1 } }
        ],
        limit: 2
      });
      expect(comparison).toMatchObject({
        status: "completed",
        output: {
          queryCount: 1,
          comparisons: [
            {
              query: "alpha",
              profiles: [
                expect.objectContaining({ profileId: "balanced" }),
                expect.objectContaining({ profileId: "vector" })
              ]
            }
          ]
        }
      });

      const qualityDb = openKnowledgeDb(storeRoot);
      try {
        qualityDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-without-block",
          "manual",
          "batch-quality",
          "source-quality",
          "email",
          "No blocks",
          "",
          "quality.eml",
          "quality-hash",
          JSON.stringify({ source: "sourceFiles" }),
          "2026-06-04T00:00:00.000Z",
          "2026-06-04T00:00:00.000Z"
        );
        qualityDb.prepare("UPDATE kc_evidence_packs SET markdown = 'plain markdown without metadata'").run();
      } finally {
        qualityDb.close();
      }

      const quality = mount.runMaintenance({
        taskType: "validate_quality",
        requireOcrOrCaption: true
      });
      expect(quality).toMatchObject({
        status: "completed",
        output: {
          ok: false,
          metrics: {
            documentsWithoutBlocks: expect.any(Number),
            evidenceWithoutMachineMetadata: expect.any(Number)
          }
        }
      });
      expect(quality.output.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
        "documents_without_blocks",
        "evidence_without_machine_metadata"
      ]));
    });
  });
});
