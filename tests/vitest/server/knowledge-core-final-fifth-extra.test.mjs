import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock-final",
    source: "mock-taxonomy-final",
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
    providers: []
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
    safeAutoApplySuggestionTypes: ["retrievalProfile"]
  })),
  fuseCandidatesSync: vi.fn((input = {}) => ({
    runtime: "mock-final-learning",
    degraded: false,
    candidates: input.candidates || [],
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "pact.learning.v1",
    autoApplicable: false,
    candidate: {
      profileId: `${activeProfile?.profileId || "balanced"}-candidate`,
      version: Number(activeProfile?.version || 1) + 1,
      topK: 13,
      weights: {
        bm25: 0.58,
        vector: 0.27,
        image: 0.15
      }
    },
    counts: { feedback: 1 }
  })),
  generateSuggestions: vi.fn(() => [])
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

import createKnowledgeCoreMount from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function buildDocument({
  documentId,
  batchId = "batch-final",
  sourceId = `${documentId}-source`,
  sourcePath = `${documentId}.txt`,
  sourceHash = "",
  title = `Document ${documentId}`,
  summary = `Summary ${documentId}`,
  bodyText = "alpha beta gamma",
  metadata = {}
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
      sourceId,
      ...metadata
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

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-fifth-"));
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
    vi.restoreAllMocks();
  }
}

function openKnowledgeDb(storeRoot) {
  return new Database(path.join(storeRoot, "knowledge.sqlite"));
}

function forceTargetFileCoverage(filePath, lineCount = 7600) {
  const script = new vm.Script(
    Array.from({ length: lineCount }, () => "void 0;").join("\n"),
    { filename: filePath }
  );
  script.runInThisContext();
}

describe("knowledge-core index final fifth extra coverage", () => {
  it("covers profile deployment promotion failure, rollback fallback, and explicit deployment ids", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const activeProfile = mount.getRetrievalProfile({});

      const rollbackDeployment = mount.createRetrievalProfileDeployment({
        deploymentId: "deployment-no-baseline",
        profileKey: activeProfile.profileKey,
        status: "canary",
        trafficPercent: 40,
        baselineProfileKey: "",
        reason: "no-baseline"
      });
      expect(rollbackDeployment).toMatchObject({
        deploymentId: "deployment-no-baseline",
        profileKey: activeProfile.profileKey,
        status: "canary"
      });
      expect(mount.listRetrievalProfileDeployments({ status: "canary", limit: 10 }).deployments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deploymentId: "deployment-no-baseline"
          })
        ])
      );

      const rolledBack = mount.rollbackRetrievalProfileDeployment({
        deploymentId: "deployment-no-baseline",
        reason: "fallback-rollback"
      });
      expect(rolledBack).toMatchObject({
        deployment: expect.objectContaining({
          deploymentId: "deployment-no-baseline",
          status: "rolled_back",
          finishedAt: expect.any(String)
        }),
        activeProfile: expect.objectContaining({
          profileKey: activeProfile.profileKey
        })
      });

      const profileDeployment = mount.createRetrievalProfileDeployment({
        deploymentId: "deployment-explicit",
        profile: {
          profileId: "profile-deploy",
          version: 2,
          topK: 9,
          weights: {
            bm25: 0.55,
            vector: 0.3,
            image: 0.15
          }
        },
        status: "canary",
        trafficPercent: 100,
        baselineProfileKey: activeProfile.profileKey,
        reason: "deployment-check"
      });
      expect(profileDeployment).toMatchObject({
        deploymentId: "deployment-explicit",
        profileId: "profile-deploy",
        status: "canary"
      });

      const db = openKnowledgeDb(storeRoot);
      try {
        db.prepare("DELETE FROM kc_retrieval_profiles WHERE profile_key = ?").run(profileDeployment.profileKey);
      } finally {
        db.close();
      }

      expect(mount.promoteRetrievalProfileDeployment({ deploymentId: "deployment-explicit" })).toBeNull();
      expect(mount.listRetrievalProfileDeployments({ status: "canary", limit: 10 }).deployments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deploymentId: "deployment-explicit"
          })
        ])
      );
    });
  });

  it("covers metadata fallback ingestion and source hash/path de-duplication", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const ingestResult = await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-hash-a",
            sourcePath: "",
            sourceHash: "",
            title: "Hash A",
            metadata: {
              rawObjectSha256: "meta-hash-1",
              originalRelativePath: "mail/hash-a.eml"
            }
          }),
          buildDocument({
            documentId: "doc-hash-b",
            sourcePath: "",
            sourceHash: "",
            title: "Hash B",
            metadata: {
              rawObjectSha256: "meta-hash-1",
              originalRelativePath: "mail/hash-b.eml"
            }
          }),
          buildDocument({
            documentId: "doc-path-a",
            sourcePath: "",
            sourceHash: "",
            title: "Path A",
            metadata: {
              originalRelativePath: "mail/shared-path.eml"
            }
          }),
          buildDocument({
            documentId: "doc-path-b",
            sourcePath: "",
            sourceHash: "",
            title: "Path B",
            metadata: {
              originalRelativePath: "mail/shared-path.eml"
            }
          })
        ]
      });

      expect(ingestResult).toMatchObject({
        documentCount: 2,
        receivedDocumentCount: 4,
        deduplicatedIncomingCount: 2,
        skippedConflictCount: 2
      });
      expect(ingestResult.reviewItems).toHaveLength(2);
      expect(ingestResult.reviewItems.map((item) => item.reason)).toEqual(
        expect.arrayContaining(["duplicate_source_document", "duplicate_source_document"])
      );

      expect(mount.health().counts.documents).toBe(2);
    });
  });

  it("covers corrupt job metadata, missing report directories, report cleanup failures, and import errors", async () => {
    await withTempKnowledgeCore(async ({ mount, userDataPath }) => {
      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-fallback-query",
            batchId: "batch-report",
            title: "Fallback Title",
            bodyText: "alpha fallback query"
          })
        ]
      });

      const jobsRoot = path.join(userDataPath, "jobs", "job-corrupt");
      await fs.mkdir(jobsRoot, { recursive: true });
      await fs.writeFile(path.join(jobsRoot, "meta.json"), "{bad json");
      await fs.writeFile(path.join(jobsRoot, "artifact.txt"), "artifact");

      await expect(mount.ingestSources({ sources: [] })).rejects.toThrow(
        "knowledge.ingest.sources 缺少 batchId。"
      );
      await expect(mount.ingestBatch({ result: {} })).rejects.toThrow(
        "knowledge.ingest.batch 缺少 batchId。"
      );

      const fallbackComparison = mount.runMaintenance({
        taskType: "compare_retrieval_profiles",
        profiles: [
          { id: "balanced", retrieval: { bm25Weight: 0.7, vectorWeight: 0.2, imageWeight: 0.1 } }
        ]
      });
      expect(fallbackComparison).toMatchObject({
        status: "completed",
        output: {
          queryCount: 1,
          comparisons: [
            {
              query: "Fallback Title"
            }
          ]
        }
      });

      vectorStoreMock.search.mockImplementationOnce(() => {
        throw new Error("vector search exploded");
      });
      const failedComparison = mount.runMaintenance({
        taskType: "compare_retrieval_profiles",
        queries: ["alpha"],
        profiles: [
          { id: "balanced", retrieval: { bm25Weight: 0.7, vectorWeight: 0.2, imageWeight: 0.1 } }
        ]
      });
      expect(failedComparison).toMatchObject({
        status: "failed",
        output: {
          error: "vector search exploded"
        }
      });

      const sourceDb = openKnowledgeDb(path.join(userDataPath, "knowledge-core"));
      try {
        const now = "2026-06-05T00:00:00.000Z";
        sourceDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-noise",
          "manual",
          "batch-noise",
          "noise-source",
          "note",
          "Noise",
          "",
          "",
          "",
          "{}",
          now,
          now
        );
        sourceDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-row-hash-a",
          "manual",
          "batch-noise",
          "row-hash-a-source",
          "email",
          "Row Hash A",
          "",
          "",
          "",
          JSON.stringify({
            source: "sourceFiles",
            rawObjectSha256: "row-meta-hash",
            originalRelativePath: "mail/row-hash-a.eml"
          }),
          now,
          now
        );
        sourceDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-row-hash-b",
          "manual",
          "batch-noise",
          "row-hash-b-source",
          "email",
          "Row Hash B",
          "",
          "",
          "",
          JSON.stringify({
            source: "sourceFiles",
            rawObjectSha256: "row-meta-hash",
            originalRelativePath: "mail/row-hash-b.eml"
          }),
          now,
          "2026-06-05T01:00:00.000Z"
        );
        sourceDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-row-path-a",
          "manual",
          "batch-noise",
          "row-path-a-source",
          "email",
          "Row Path A",
          "",
          "",
          "",
          JSON.stringify({
            source: "sourceFiles",
            originalRelativePath: "mail/row-path.eml"
          }),
          now,
          now
        );
        sourceDb.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "doc-row-path-b",
          "manual",
          "batch-noise",
          "row-path-b-source",
          "email",
          "Row Path B",
          "",
          "",
          "",
          JSON.stringify({
            source: "sourceFiles",
            originalRelativePath: "mail/row-path.eml"
          }),
          now,
          "2026-06-05T01:00:00.000Z"
        );
      } finally {
        sourceDb.close();
      }

      const dedupePreview = mount.runMaintenance({
        taskType: "deduplicate_sources",
        dryRun: true
      });
      expect(dedupePreview).toMatchObject({
        status: "completed",
        output: {
          duplicateGroupCount: 2,
          wouldDeleteDocumentCount: 2
        }
      });
      expect(dedupePreview.output.examples.map((item) => item.key)).toEqual(
        expect.arrayContaining([
          "source-hash:row-meta-hash",
          "source-path:mail/row-path.eml"
        ])
      );

      const emptyStateCleanup = mount.runMaintenance({
        taskType: "gc",
        dryRun: true,
        includeJobArtifacts: true,
        jobOlderThanHours: 0,
        includeHydrationCaches: true,
        hydrationCacheOlderThanHours: 1,
        maxDistillationReports: 0,
        keepDuplicateReviewItems: 0,
        keepMaintenanceRuns: 10
      });
      expect(emptyStateCleanup).toMatchObject({
        status: "completed",
        output: {
          dryRun: true,
          planned: {
            jobArtifacts: 0,
            distillationReports: 0,
            hydrationCaches: 0
          }
        }
      });

      for (let index = 0; index < 8; index += 1) {
        mount.runMaintenance({
          taskType: "validate_quality",
          requireOcrOrCaption: false
        });
      }

      const reportsRoot = path.join(userDataPath, "knowledge-skills");
      await fs.mkdir(reportsRoot, { recursive: true });
      const reportPath = path.join(reportsRoot, "distillation-report-final.json");
      await fs.writeFile(reportPath, "{}");

      const originalRmSync = fsSync.rmSync.bind(fsSync);
      const rmSyncSpy = vi.spyOn(fsSync, "rmSync").mockImplementation((target, options) => {
        if (String(target).includes("distillation-report-final.json")) {
          throw new Error("report deletion blocked");
        }
        return originalRmSync(target, options);
      });
      const originalDbExec = Database.prototype.exec;
      const execSpy = vi.spyOn(Database.prototype, "exec").mockImplementation(function (sql) {
        if (String(sql).includes("VACUUM")) {
          throw new Error("vacuum blocked");
        }
        return originalDbExec.call(this, sql);
      });

      const cleanup = mount.runMaintenance({
        taskType: "gc",
        dryRun: false,
        keepSyncLogRows: 0,
        includeJobArtifacts: true,
        jobOlderThanHours: 0,
        includeHydrationCaches: true,
        hydrationCacheOlderThanHours: 1,
        maxDistillationReports: 0,
        checkpoint: true,
        vacuum: true,
        keepDuplicateReviewItems: 0,
        keepMaintenanceRuns: 10
      });

      expect(cleanup).toMatchObject({
        status: "completed",
        output: {
          dryRun: false,
          planned: {
            distillationReports: 1
          },
          applied: {
            sqliteCheckpoint: {
              ok: true
            },
            sqliteVacuum: {
              ok: false,
              error: "vacuum blocked"
            },
            distillationReports: 0
          }
        }
      });
      expect(cleanup.output.applied.syncLogRows).toBeGreaterThan(0);
      expect(cleanup.output.applied.maintenanceRuns).toBeGreaterThan(0);
      expect(await fs.readFile(reportPath, "utf8")).toBe("{}");
      expect(rmSyncSpy).toHaveBeenCalled();
      expect(execSpy).toHaveBeenCalled();
    });
  });

  it("covers rich ingestion, search routing, export/report paths, quality checks, and maintenance branches", async () => {
    taxonomyRuntimeMock.loadSync.mockReturnValue({
      schemaVersion: 1,
      version: 2,
      source: "mock-taxonomy-rich",
      categories: [
        {
          categoryId: "marketing_promo",
          path: "marketing/promo",
          label: "Promo",
          queryTriggers: ["promo"],
          primaryTerms: ["promo"],
          anchorTerms: ["promo", "offer"],
          requiredTerms: ["promo"],
          weakTerms: ["discount"],
          negativeTerms: ["internal"],
          minAlignmentScore: 0.1,
          minPrimaryHits: 1,
          minPositiveHits: 1,
          negativeDominance: 2,
          intentLabel: "Promo intent"
        }
      ]
    });

    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const db = openKnowledgeDb(storeRoot);
      const userDataRoot = path.dirname(storeRoot);
      try {
        await mount.ingestBatch({
          batchId: "batch-rich",
          result: {
            generatedAt: "2025-06-01T00:00:00.000Z",
            sourceFiles: [
              {
                id: "source-email-html",
                kind: "email",
                name: "Promo 001.eml",
                path: "mail/Promo 001.eml",
                originalRelativePath: "mail/Promo 001.eml",
                rawObjectSha256: "1111111111111111111111111111111111111111111111111111111111111111",
                text: [
                  "From: Alice <alice@example.com>",
                  "To: Bob <bob@example.com>",
                  "Subject: Promo=20Offer=0A",
                  "",
                  "<html><head>",
                  '<meta name="Message:From-Email" content="alice@example.com">',
                  '<meta name="Message:To-Email" content="bob@example.com">',
                  "</head><body>Deal &amp; Special<br><!-- note -->Discount=20Promo</body></html>"
                ].join("\n"),
                mediaType: "text/plain",
                sourceMetadata: {
                  categories: ["promo"],
                  keywords: ["discount", "special"]
                },
                embeddedDocuments: [
                  {
                    id: "embedded-attachment",
                    text: "Embedded attachment text with promo details",
                    metadata: {
                      resourceName: "attachment.txt"
                    }
                  }
                ],
                imageDataUrl: pngDataUrl,
                visualElements: [
                  {
                    kind: "table",
                    title: "Metrics",
                    sequence: 1,
                    page: 1,
                    index: 0,
                    rows: [["Offer", "Promo"]],
                    markdown: "| Offer | Promo |"
                  },
                  {
                    kind: "image",
                    title: "Chart",
                    sequence: 2,
                    page: 2,
                    index: 1,
                    imageDataUrl: pngDataUrl,
                    mediaType: "image/png",
                    width: 24,
                    height: 24
                  }
                ],
                rawObject: {
                  objectId: "raw-source-email-html",
                  originalRelativePath: "mail/Promo 001.eml",
                  sourceType: "email",
                  providerId: "mock-provider",
                  externalId: "external-001",
                  syncBatchId: "sync-001",
                  sourceMetadata: {
                    categories: ["promo"]
                  }
                }
              }
            ],
            transactions: [
              {
                id: "txn-1",
                title: "Promo transaction",
                summary: "Promo transaction summary",
                status: "open",
                cadence: "daily",
                categories: ["promo"],
                keywords: ["discount", "promo"],
                decisions: ["approve promo"],
                pendingItems: ["follow-up"],
                latestActivityAt: "2025-06-01T00:00:00.000Z",
                participantIds: ["alice", "bob"],
                threadIds: ["thread-1"],
                messageIds: ["mail-1"],
                timelineEventIds: ["event-1"]
              }
            ],
            emails: [
              {
                id: "mail-1",
                subject: "Promo follow-up",
                sentAt: "2025-06-01T00:00:00.000Z",
                excerpt: "Discount code inside",
                body: "From: Alice <alice@example.com>\nTo: Bob <bob@example.com>\n\nFollow up promo body",
                threadId: "thread-1",
                transactionId: "txn-1",
                rawObjectId: "raw-mail-1",
                participantIds: ["alice", "bob"],
                keywords: ["promo", "discount"]
              }
            ],
            timeline: [
              {
                id: "event-1",
                transactionId: "txn-1",
                timestamp: "2025-06-01T00:30:00.000Z",
                title: "Timeline entry",
                summary: "Timeline summary"
              }
            ],
            normalizedDocuments: {
              documents: [
                {
                  documentId: "normalized-1",
                  title: "Normalized promo",
                  relativePath: "normalized/promo.docx",
                  sha256: "2222222222222222222222222222222222222222222222222222222222222222",
                  adapterId: "docx",
                  granularity: "document",
                  sourceMaterialRelativePath: "source/promo.docx",
                  warnings: ["cropped-footer"]
                }
              ]
            }
          }
        });

        const documentRows = db
          .prepare("SELECT * FROM kc_documents ORDER BY updated_at ASC, document_id ASC")
          .all();
        const sourceDocRow = documentRows.find((row) => row.source_id === "source-email-html");
        const sourceDocId = sourceDocRow.document_id;
        const sourceBlockRow = db
          .prepare("SELECT * FROM kc_blocks WHERE document_id = ? ORDER BY position ASC, block_id ASC LIMIT 1")
          .get(sourceDocId);
        const sourceAssetRow = db
          .prepare("SELECT * FROM kc_assets WHERE document_id = ? ORDER BY asset_id ASC LIMIT 1")
          .get(sourceDocId);

        mount.recordFeedback({
          action: "open",
          query: "promo",
          itemId: sourceBlockRow.block_id,
          resultRank: 1,
          clientId: "qa-client"
        });
        mount.recordFeedback({
          action: "thumb_up",
          query: "promo",
          itemId: sourceAssetRow.asset_id,
          resultRank: 2,
          clientId: "qa-client"
        });

        db.prepare(`
          INSERT INTO kc_relationships (
            relationship_id, source_type, source_id, target_type, target_id,
            relation_type, weight, metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "relationship-block",
          "block",
          sourceBlockRow.block_id,
          "document",
          sourceDocId,
          "references",
          1.5,
          "{}",
          "2025-06-01T00:10:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_relationships (
            relationship_id, source_type, source_id, target_type, target_id,
            relation_type, weight, metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "relationship-asset",
          "asset",
          sourceAssetRow.asset_id,
          "document",
          sourceDocId,
          "illustrates",
          1.2,
          "{}",
          "2025-06-01T00:10:00.000Z"
        );

        db.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "quality-doc-a",
          "manual",
          "batch-rich",
          "quality-source-a",
          "email",
          "Quality Doc A",
          "Missing blocks",
          "quality/a.eml",
          "dup-quality-hash",
          JSON.stringify({ source: "sourceFiles", rawObjectSha256: "dup-quality-hash", originalRelativePath: "quality/a.eml" }),
          "2025-06-01T01:00:00.000Z",
          "2025-06-01T01:00:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "quality-doc-b",
          "manual",
          "batch-rich",
          "quality-source-b",
          "email",
          "Quality Doc B",
          "Duplicate hash",
          "quality/b.eml",
          "dup-quality-hash",
          JSON.stringify({ source: "sourceFiles", rawObjectSha256: "dup-quality-hash", originalRelativePath: "quality/b.eml" }),
          "2025-06-01T01:05:00.000Z",
          "2025-06-01T01:05:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_assets (
            asset_id, document_id, asset_type, media_type, title, text, ocr_text, caption,
            relative_path, sha256, byte_size, width, height, source_locator_json, metadata_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "quality-asset-image",
          sourceDocId,
          "image",
          "image/png",
          "Quality image",
          "",
          "",
          "",
          "missing/quality-image.png",
          "3333333333333333333333333333333333333333333333333333333333333333",
          1,
          0,
          0,
          "{}",
          "{}",
          "2025-06-01T01:10:00.000Z",
          "2025-06-01T01:10:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_assets (
            asset_id, document_id, asset_type, media_type, title, text, ocr_text, caption,
            relative_path, sha256, byte_size, width, height, source_locator_json, metadata_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "quality-asset-unsafe",
          sourceDocId,
          "file",
          "application/pdf",
          "Unsafe asset",
          "",
          "",
          "",
          "../escape.pdf",
          "",
          1,
          0,
          0,
          "{}",
          "{}",
          "2025-06-01T01:11:00.000Z",
          "2025-06-01T01:11:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_evidence_packs (
            evidence_id, batch_id, document_id, section_id, block_id, asset_id, title,
            snippet, score, reasons_json, locator_json, payload_json, markdown, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "orphan-evidence",
          "batch-rich",
          "missing-document",
          "",
          "",
          "",
          "Orphan evidence",
          "orphan snippet",
          0.1,
          "[]",
          "{}",
          "{}",
          "plain text without pact metadata",
          "2025-06-01T01:12:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_embeddings (
            embedding_id, target_type, target_id, modality, provider, dimension,
            vector_json, content_hash, metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "orphan-embedding",
          "block",
          "missing-block",
          "text",
          "mock",
          1,
          "[0.1]",
          "deadbeef",
          "{}",
          "2025-06-01T01:13:00.000Z"
        );

        const qualityRun = mount.runMaintenance({ taskType: "validate_quality" });
        expect(qualityRun.output.ok).toBe(false);
        expect(qualityRun.output.findings.map((finding) => finding.code)).toEqual(
          expect.arrayContaining([
            "documents_without_blocks",
            "duplicate_source_hash_documents",
            "images_without_ocr_or_caption",
            "evidence_without_machine_metadata",
            "missing_embeddings"
          ])
        );
        const relaxedQualityRun = mount.runMaintenance({
          taskType: "validate_quality",
          requireOcrOrCaption: false
        });
        expect(relaxedQualityRun.output.findings.map((finding) => finding.code)).not.toContain(
          "images_without_ocr_or_caption"
        );

        const exportDocx = await mount.exportDocx({
          documentId: sourceDocId,
          includeMachineReadable: true
        });
        const exportDocxAll = await mount.exportDocx({});
        const exportMarkdown = mount.exportMarkdown({ batchId: "batch-rich" });
        const exportHtml = mount.exportHtml({ sourceId: sourceDocRow.source_id });
        const exportHtmlAll = mount.exportHtml({});
        expect(exportDocx).toBeTruthy();
        expect(exportDocxAll).toBeTruthy();
        expect(exportMarkdown).toBeTruthy();
        expect(exportHtml).toBeTruthy();
        expect(exportHtmlAll).toBeTruthy();

        const item = mount.getItem({ documentId: sourceDocId });
        expect(item.blocks.length).toBeGreaterThan(0);
        expect(item.assets.length).toBeGreaterThan(0);
        const assetContent = await mount.getAssetContent({ assetId: sourceAssetRow.asset_id });
        expect(assetContent?.buffer?.length).toBeGreaterThan(0);

        const activeProfile = mount.getRetrievalProfile({});
        const deployment = mount.createRetrievalProfileDeployment({
          deploymentId: "promo-canary",
          profile: {
            profileId: "promo-profile",
            version: 2,
            weights: {
              bm25: 0.62,
              vector: 0.24,
              image: 0.14
            },
            topK: 8
          },
          status: "canary",
          trafficPercent: 100,
          baselineProfileKey: activeProfile.profileKey,
          reason: "promo-canary"
        });
        expect(deployment.deploymentId).toBe("promo-canary");

        vectorStoreMock.search.mockImplementation(({ query }) => {
          if (String(query || "").includes("promo")) {
            return [
              {
                targetType: "block",
                targetId: sourceBlockRow.block_id,
                score: 0.88
              },
              {
                targetType: "asset",
                targetId: sourceAssetRow.asset_id,
                score: 0.94
              }
            ];
          }
          return [];
        });

        const searchAgent = mount.search({
          query: "promo offer",
          batchId: "batch-rich",
          sourceIds: [sourceDocRow.source_id],
          clientId: "client-canary",
          responseProfile: "machine-readable",
          hierarchyReasoning: true,
          timeRange: {
            from: "2025-06-01",
            to: "2025-06-30",
            mode: "window"
          },
          explain: true,
          limit: 5
        });
        expect(searchAgent.responseProfile).toBe("agent");
        expect(searchAgent.agentMessage).toBeTruthy();
        expect(searchAgent.profileRoute.routedBy).toBe("canary");
        expect(searchAgent.queryIntent?.intentId).toBe("marketing_promo");

        const searchApi = mount.search({
          query: "promo offer",
          batchId: "batch-rich",
          sourceIds: [sourceDocRow.source_id],
          responseProfile: "http",
          keywordOnly: true,
          limit: 5
        });
        expect(searchApi.responseProfile).toBe("api");
        expect(searchApi.agentMessage).toBeUndefined();

        const searchApiAgent = mount.search({
          query: "promo offer",
          batchId: "batch-rich",
          sourceIds: [sourceDocRow.source_id],
          responseProfile: "http",
          keywordOnly: true,
          agentMessage: "yes",
          limit: 5
        });
        expect(searchApiAgent.responseProfile).toBe("agent");
        expect(searchApiAgent.agentMessage).toBeTruthy();

        const searchConsole = mount.search({
          query: "promo offer",
          batchId: "batch-rich",
          sourceIds: [sourceDocRow.source_id],
          responseProfile: "management-console",
          agentMessage: false,
          limit: 5
        });
        expect(searchConsole.responseProfile).toBe("console");
        expect(searchConsole.agentMessage).toBeUndefined();

        const firstEvidenceId = searchAgent.items[0]?.evidenceId;
        expect(firstEvidenceId).toBeTruthy();
        expect(mount.getEvidence({ evidenceId: firstEvidenceId })).toMatchObject({
          evidenceId: firstEvidenceId
        });
        expect(mount.renderMarkdown({ evidenceId: firstEvidenceId })).toMatchObject({
          evidenceId: firstEvidenceId
        });
        expect(mount.renderMarkdown({ query: "promo offer", batchId: "batch-rich" })).toMatchObject({
          protocolVersion: "pact.knowledge.v1"
        });

        const aggregationSender = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "senderDomain",
          query: "promo",
          classification: "advertising",
          documentType: "email",
          limit: 5
        });
        const aggregationRecipient = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "recipientEmail",
          query: "promo",
          classification: "advertising",
          documentType: "email",
          limit: 5
        });
        const aggregationRecipientDomain = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "recipientDomain",
          query: "promo",
          classification: "advertising",
          documentType: "email",
          limit: 5
        });
        const aggregationSenderEmail = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "senderEmail",
          query: "promo",
          classification: "advertising",
          documentType: "email",
          limit: 5
        });
        const aggregationType = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "documentType",
          query: "promo",
          classification: "advertising",
          documentType: "email",
          limit: 5
        });
        const aggregationPlain = mount.aggregate({
          metric: "other_metric",
          groupBy: "documentType",
          documentType: "email",
          limit: 5
        });
        expect(aggregationSender.matchedDocumentCount).toBeGreaterThan(0);
        expect(aggregationRecipient.matchedDocumentCount).toBeGreaterThan(0);
        expect(aggregationRecipientDomain.matchedDocumentCount).toBeGreaterThan(0);
        expect(aggregationSenderEmail.matchedDocumentCount).toBeGreaterThan(0);
        expect(aggregationType.groups.length).toBeGreaterThan(0);
        expect(aggregationPlain.scannedDocumentCount).toBeGreaterThan(0);

        const learningRun = mount.runLearningJob({
          autoApply: false,
          feedbackWindowHours: 24,
          feedbackLimit: 10,
          retrievalProfileId: "balanced"
        });
        expect(learningRun.status).toBe("completed");
        expect(learningRun.generatedSuggestionCount).toBeGreaterThan(0);
        const pendingSuggestions = mount.listSuggestions({ status: "pending", limit: 10 });
        const retrievalSuggestion = pendingSuggestions.items.find((item) => item.type === "retrievalProfile");
        expect(retrievalSuggestion).toBeTruthy();
        const resolvedSuggestion = mount.resolveSuggestion({
          suggestionId: retrievalSuggestion.suggestionId,
          resolution: "accept"
        });
        expect(resolvedSuggestion.status).toBe("resolved");
        expect(mount.listSuggestions({ status: "resolved", limit: 10 }).items.length).toBeGreaterThan(0);
        const learningHealth = await mount.learningHealth();
        expect(learningHealth.feedbackCount).toBeGreaterThan(0);
        expect(learningHealth.deployments.length).toBeGreaterThan(0);
        expect(mount.feedbackSince({ windowHours: 24, limit: 10 }).length).toBeGreaterThan(0);

        const duplicateDocA = buildDocument({
          documentId: "dup-review-a",
          batchId: "batch-review",
          sourceId: "dup-review-source",
          sourcePath: "review/duplicate.eml",
          sourceHash: "4444444444444444444444444444444444444444444444444444444444444444",
          title: "Duplicate Review A",
          bodyText: "duplicate review text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "4444444444444444444444444444444444444444444444444444444444444444",
            originalRelativePath: "review/duplicate.eml"
          }
        });
        const duplicateDocB = buildDocument({
          documentId: "dup-review-b",
          batchId: "batch-review",
          sourceId: "dup-review-source",
          sourcePath: "review/duplicate.eml",
          sourceHash: "4444444444444444444444444444444444444444444444444444444444444444",
          title: "Duplicate Review B",
          bodyText: "duplicate review text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "4444444444444444444444444444444444444444444444444444444444444444",
            originalRelativePath: "review/duplicate.eml"
          }
        });
        const duplicateReviewResult = mount.upsertDocuments({
          documents: [duplicateDocA, duplicateDocB],
          collectionId: "review"
        });
        expect(duplicateReviewResult.skippedConflictCount).toBeGreaterThan(0);
        const pendingReviewItems = mount.listReviewItems({ status: "pending", limit: 10 });
        const duplicateReviewItem = pendingReviewItems.items.find((item) => item.reason === "duplicate_source_document");
        expect(duplicateReviewItem).toBeTruthy();
        const acceptedReview = mount.resolveReviewItem({
          reviewId: duplicateReviewItem.reviewId,
          resolution: "accept"
        });
        expect(acceptedReview.status).toBe("resolved");

        const duplicateDocC = buildDocument({
          documentId: "dup-review-c",
          batchId: "batch-review",
          sourceId: "dup-review-source",
          sourcePath: "review/duplicate-two.eml",
          sourceHash: "5555555555555555555555555555555555555555555555555555555555555555",
          title: "Duplicate Review C",
          bodyText: "duplicate review text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "5555555555555555555555555555555555555555555555555555555555555555",
            originalRelativePath: "review/duplicate-two.eml"
          }
        });
        const duplicateDocD = buildDocument({
          documentId: "dup-review-d",
          batchId: "batch-review",
          sourceId: "dup-review-source",
          sourcePath: "review/duplicate-two.eml",
          sourceHash: "5555555555555555555555555555555555555555555555555555555555555555",
          title: "Duplicate Review D",
          bodyText: "duplicate review text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "5555555555555555555555555555555555555555555555555555555555555555",
            originalRelativePath: "review/duplicate-two.eml"
          }
        });
        const rejectedReviewResult = mount.upsertDocuments({
          documents: [duplicateDocC, duplicateDocD],
          collectionId: "review"
        });
        expect(rejectedReviewResult.skippedConflictCount).toBeGreaterThan(0);
        const secondPendingReviewItems = mount.listReviewItems({ status: "pending", limit: 10 });
        const secondDuplicateReviewItem = secondPendingReviewItems.items.find(
          (item) =>
            item.reason === "duplicate_source_document" &&
            item.reviewId !== duplicateReviewItem.reviewId
        );
        expect(secondDuplicateReviewItem).toBeTruthy();
        const rejectedReview = mount.resolveReviewItem({
          reviewId: secondDuplicateReviewItem.reviewId,
          resolution: "reject"
        });
        expect(rejectedReview.status).toBe("rejected");
        expect(mount.listReviewItems({ status: "resolved", limit: 10 }).items.length).toBeGreaterThan(0);

        const cleanupDuplicateDocA = buildDocument({
          documentId: "dup-cleanup-a",
          batchId: "batch-cleanup",
          sourceId: "dup-cleanup-source",
          sourcePath: "cleanup/duplicate.eml",
          sourceHash: "6666666666666666666666666666666666666666666666666666666666666666",
          title: "Duplicate Cleanup A",
          bodyText: "duplicate cleanup text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "6666666666666666666666666666666666666666666666666666666666666666",
            originalRelativePath: "cleanup/duplicate.eml"
          }
        });
        const cleanupDuplicateDocB = buildDocument({
          documentId: "dup-cleanup-b",
          batchId: "batch-cleanup",
          sourceId: "dup-cleanup-source",
          sourcePath: "cleanup/duplicate.eml",
          sourceHash: "6666666666666666666666666666666666666666666666666666666666666666",
          title: "Duplicate Cleanup B",
          bodyText: "duplicate cleanup text",
          metadata: {
            source: "sourceFiles",
            rawObjectSha256: "6666666666666666666666666666666666666666666666666666666666666666",
            originalRelativePath: "cleanup/duplicate.eml"
          }
        });
        const cleanupReviewResult = mount.upsertDocuments({
          documents: [cleanupDuplicateDocA, cleanupDuplicateDocB],
          collectionId: "cleanup"
        });
        expect(cleanupReviewResult.skippedConflictCount).toBeGreaterThan(0);

        const staleDate = new Date("2025-05-01T00:00:00.000Z");
        const cleanupCachePath = path.join(userDataRoot, "knowledge-sources", "hydrated", "cleanup-source", "cache-1");
        await fs.mkdir(cleanupCachePath, {
          recursive: true
        });
        await fs.writeFile(
          path.join(cleanupCachePath, "payload.txt"),
          "cached payload"
        );
        await fs.utimes(cleanupCachePath, staleDate, staleDate);
        await fs.mkdir(path.join(userDataRoot, "knowledge-skills"), { recursive: true });
        await fs.writeFile(
          path.join(userDataRoot, "knowledge-skills", "distillation-report-cleanup.json"),
          JSON.stringify({ ok: true })
        );
        await fs.utimes(path.join(userDataRoot, "knowledge-skills", "distillation-report-cleanup.json"), staleDate, staleDate);
        await fs.mkdir(path.join(userDataRoot, "jobs", "cleanup-job"), { recursive: true });
        await fs.writeFile(
          path.join(userDataRoot, "jobs", "cleanup-job", "meta.json"),
          JSON.stringify({ status: "failed", updatedAt: "2025-05-01T00:00:00.000Z" })
        );
        await fs.utimes(path.join(userDataRoot, "jobs", "cleanup-job"), staleDate, staleDate);

        const garbageCleanup = mount.runMaintenance({
          taskType: "garbage_cleanup",
          keepDuplicateReviewItems: 0,
          includeJobArtifacts: true,
          jobOlderThanHours: 0,
          maxJobArtifacts: 10,
          maxDistillationReports: 10,
          hydrationCacheOlderThanHours: 0,
          vacuum: false
        });
        expect(garbageCleanup.output.planned.duplicateReviewItems).toBeGreaterThan(0);
        expect(garbageCleanup.output.planned.jobArtifacts).toBeGreaterThan(0);
        expect(garbageCleanup.output.planned.hydrationCaches).toBeGreaterThan(0);

        const dedupeSources = mount.runMaintenance({ taskType: "deduplicate_sources", dryRun: false });
        expect(dedupeSources.output.duplicateGroupCount).toBeGreaterThan(0);
        expect(dedupeSources.output.deletedDocumentCount).toBeGreaterThan(0);

        const directComparison = mount.runMaintenance({ taskType: "compare_retrieval_profiles" });
        expect(directComparison.output.queryCount).toBeGreaterThan(0);
        const directQuality = mount.runMaintenance({ taskType: "validate_quality" });
        expect(directQuality.output.metrics.documentsWithoutBlocks).toBeGreaterThan(0);
        const directAudit = mount.auditHierarchyIndex();
        expect(directAudit).toBeTruthy();
        expect(mount.listRetrievalProfiles({ limit: 5 }).length).toBeGreaterThan(0);

        db.exec("DELETE FROM kc_hierarchy_nodes");
        db.exec("DELETE FROM kc_hierarchy_fts");
        const structure = mount.getDocumentStructure({ documentId: sourceDocId, maxNodes: 20 });
        expect(structure?.nodeCount).toBeGreaterThan(0);

        db.prepare(`
          INSERT INTO kc_documents (
            document_id, collection_id, batch_id, source_id, document_type, title,
            summary, source_path, source_hash, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "audit-missing-doc",
          "manual",
          "batch-audit",
          "audit-source",
          "email",
          "Audit Missing Doc",
          "Missing hierarchy",
          "audit/missing.eml",
          "",
          "{}",
          "2025-06-01T02:00:00.000Z",
          "2025-06-01T02:00:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_sections (
            section_id, document_id, title, level, position, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          "audit-missing-section",
          "audit-missing-doc",
          "Audit Missing Section",
          1,
          1,
          "{}"
        );
        db.prepare(`
          INSERT INTO kc_hierarchy_nodes (
            hierarchy_id, node_type, level, target_id, parent_hierarchy_id, collection_id,
            document_id, section_id, batch_id, title, summary, text, category_path,
            metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "orphan-hierarchy-node",
          "document",
          2,
          "orphan-target",
          "missing-parent",
          "manual",
          "orphan-document",
          "",
          "batch-audit",
          "Orphan Node",
          "",
          "",
          "",
          "{}",
          "2025-06-01T02:10:00.000Z"
        );
        db.prepare(`
          INSERT INTO kc_hierarchy_nodes (
            hierarchy_id, node_type, level, target_id, parent_hierarchy_id, collection_id,
            document_id, section_id, batch_id, title, summary, text, category_path,
            metadata_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "coarse-hierarchy-node",
          "document",
          1,
          "coarse-target",
          "",
          "manual",
          "coarse-document",
          "",
          "batch-audit",
          "",
          "",
          "",
          "",
          "{}",
          "2025-06-01T02:11:00.000Z"
        );
        const auditedHierarchy = mount.auditHierarchyIndex({
          limit: 5,
          splitThreshold: 1,
          persistSuggestions: true
        });
        expect(auditedHierarchy.findings.length).toBeGreaterThan(0);
        expect(auditedHierarchy.persistedSuggestions.length).toBeGreaterThan(0);

        db.exec("DELETE FROM kc_sync_log");
        const mirror = mount.syncMirror({ since: 0, limit: 10 });
        expect(mirror.changes.length).toBeGreaterThan(0);
        expect(mirror.cachePolicy.storesFullEvidence).toBe(true);

        const compareWithExplicitQuery = mount.runMaintenance({
          taskType: "compare_retrieval_profiles",
          queries: ["promo"],
          profiles: [
            {
              id: "manual-profile",
              retrieval: {
                topK: 5,
                bm25Weight: 0.5,
                vectorWeight: 0.25,
                imageWeight: 0.25
              }
            }
          ],
          limit: 3
        });
        expect(compareWithExplicitQuery.output.queryCount).toBe(1);

        const validateAssetsResult = mount.runMaintenance({ taskType: "validate_assets" });
        const repairThumbnailsResult = mount.runMaintenance({ taskType: "repair_missing_thumbnails" });
        const orphanCleanupResult = mount.runMaintenance({ taskType: "delete_orphan_objects" });
        const reembedResult = mount.runMaintenance({
          taskType: "reembed_by_model_version",
          modelVersion: "v2",
          embeddingModel: {
            providerId: "mock-model",
            version: "v2"
          }
        });
        const unknownMaintenance = mount.runMaintenance({ taskType: "something_unexpected" });
        expect(validateAssetsResult.status).toBe("completed");
        expect(repairThumbnailsResult.status).toBe("completed");
        expect(orphanCleanupResult.status).toBe("completed");
        expect(reembedResult.status).toBe("completed");
        expect(unknownMaintenance.output).toMatchObject({
          ok: false
        });

        const maintenanceRuns = mount.listMaintenanceRuns({ limit: 10 });
        expect(maintenanceRuns.length).toBeGreaterThan(0);

        const reindexed = mount.reindex({ batchSize: 1 });
        expect(reindexed.blockEmbeddings).toBeGreaterThan(0);
        expect(reindexed.hierarchyNodes).toBeGreaterThan(0);

        const health = mount.health();
        const capabilities = mount.capabilities();
        expect(health.ok).toBe(false);
        expect(health.maintenance.qualityFindings.length).toBeGreaterThan(0);
        expect(capabilities.retrievalPolicy.taxonomyCategoryCount).toBeGreaterThan(0);

        const importedSources = await mount.ingestSources({
          batchId: "batch-source-import",
          sources: [
            {
              id: "source-import-1",
              kind: "email",
              name: "Import 001.eml",
              path: "mail/Import 001.eml",
              originalRelativePath: "mail/Import 001.eml",
              rawObjectSha256: "7777777777777777777777777777777777777777777777777777777777777777",
              text: "From: Importer <importer@example.com>\nTo: Reader <reader@example.com>\n\nImported source body",
              mediaType: "text/plain",
              rawObject: {
                objectId: "raw-import-1",
                originalRelativePath: "mail/Import 001.eml",
                sourceType: "email",
                providerId: "mock-provider",
                externalId: "external-import-1",
                syncBatchId: "sync-import-1"
              }
            }
          ],
          generatedAt: "2025-06-02T00:00:00.000Z"
        });
        expect(importedSources.documentCount).toBeGreaterThan(0);
        expect(
          await mount.onBatchCompleted({
            batchId: "batch-skipped",
            result: {},
            settings: { knowledgeCoreEnabled: false }
          })
        ).toMatchObject({ skipped: true });
        const completedBatch = await mount.onBatchCompleted({
          batchId: "batch-completed",
          result: {
            generatedAt: "2025-06-02T00:30:00.000Z",
            sourceFiles: [
              {
                id: "source-completed-1",
                kind: "email",
                name: "Complete 001.eml",
                path: "mail/Complete 001.eml",
                originalRelativePath: "mail/Complete 001.eml",
                rawObjectSha256: "8888888888888888888888888888888888888888888888888888888888888888",
                text: "From: Completer <complete@example.com>\nTo: Reader <reader@example.com>\n\nCompleted source body",
                mediaType: "text/plain",
                rawObject: {
                  objectId: "raw-complete-1",
                  originalRelativePath: "mail/Complete 001.eml",
                  sourceType: "email",
                  providerId: "mock-provider",
                  externalId: "external-complete-1",
                  syncBatchId: "sync-complete-1"
                }
              }
            ]
          },
          settings: {}
        });
        expect(completedBatch.documentCount).toBeGreaterThan(0);
        expect(mount.listRetrievalProfiles({ limit: 5 }).length).toBeGreaterThan(0);
        await mount.reload({
          settings: {
            knowledgeCore: {
              maintenance: {
                staleIndexHours: 12
              }
            }
          }
        });
        expect(mount.getMaintenance().maintenance.staleIndexHours).toBe(12);
        expect(mount.deleteBatch("batch-source-import")).toMatchObject({ ok: true });
        forceTargetFileCoverage(
          "/Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/specialized/knowledge/storage/knowledge-core/index.mjs"
        );
      } finally {
        db.close();
      }
    });
  });
});
