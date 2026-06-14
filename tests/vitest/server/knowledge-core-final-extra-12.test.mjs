import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: "v0.0.1:schema:definition-1",
    version: "mock-final-extra-12",
    source: "mock-taxonomy-final-extra-12",
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
    providers: ["mock"]
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
    runtime: "mock-final-extra-12-learning",
    degraded: false,
    candidates: [...(input.candidates || [])],
    explanations: []
  })),
  proposeProfile: vi.fn(({ activeProfile } = {}) => ({
    protocolVersion: "v0.0.1:knowledge:learning-1",
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
  protocolVersion: "v0.0.1:knowledge:document-outline-1",
  build: vi.fn(({ document = {}, sections = [], blocks = [], assets = [] } = {}) => ({
    protocolVersion: "v0.0.1:knowledge:document-outline-1",
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
    path: "/tmp/mock-knowledge-taxonomy-final-extra-12.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary-final-extra-12.json",
    emailRulesPath: "/tmp/mock-email-rules-final-extra-12.json",
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
  createNoopDocumentOutlineRuntime: vi.fn(() => outlineRuntimeMock),
  resolveDocumentOutlineRuntime: vi.fn(async () => outlineRuntimeMock)
}));

import { createKnowledgeCoreMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import { buildKnowledgeDocxExport } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs";
import {
  buildMaintenancePlan,
  compareRetrievalProfiles,
  computeHealthFindings,
  summarizeMaintenanceRuns,
  validateKnowledgeQualityAssertions
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/maintenance.mjs";

function hashSha256(value) {
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest("hex");
}

function buildDocument({
  documentId,
  batchId = "batch-final-extra-12",
  sourceId = `${documentId}-source`,
  sourcePath = `${documentId}.txt`,
  sourceHash = `sha-${documentId}`,
  title = `Document ${documentId}`,
  summary = `Summary ${documentId}`,
  bodyText = "alpha beta gamma",
  assets = []
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
    assets
  };
}

async function withTempKnowledgeCore(testCase, { outlineEnabled = true } = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-extra-12-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled });
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

describe("knowledge-core final extra 12 coverage", () => {
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
      protocolVersion: "v0.0.1:knowledge:learning-1",
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

  it("covers stale-index fallback and deterministic search routing branches", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const before = mount.getMaintenance();
      expect(before.maintenance.staleIndexAfterHours).toBeUndefined();

      const updated = mount.setMaintenance({
        maintenance: {
          staleIndexAfterHours: 12
        }
      });
      expect(updated.maintenance.staleIndexHours).toBe(24);
      expect(mount.getMaintenance().maintenance.staleIndexHours).toBe(24);
      expect(mount.getMaintenance().maintenance.staleIndexAfterHours).toBeUndefined();

      const activeProfile = mount.getRetrievalProfile({});
      expect(mount.getRetrievalProfile({ profileKey: activeProfile.profileKey }).profileKey).toBe(activeProfile.profileKey);
      expect(mount.getRetrievalProfile({ profileId: activeProfile.profileId }).profileId).toBe(activeProfile.profileId);

      const activeRoute = mount.search({
        query: "routing smoke test",
        clientId: "client-without-deployment",
        limit: 1
      });
      expect(activeRoute.profileRoute.routedBy).toBe("active");

      mount.createRetrievalProfileDeployment({
        deploymentId: "route-control",
        profile: {
          profileId: "route-control-profile",
          version: 2,
          weights: {
            bm25: 0.62,
            vector: 0.24,
            image: 0.1
          },
          topK: 5
        },
        status: "canary",
        trafficPercent: 1,
        reason: "control-route"
      });

      let activeControlRoute = null;
      for (const clientId of [
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
        "iota",
        "kappa",
        "lambda",
        "mu"
      ]) {
        const result = mount.search({
          query: "routing smoke test",
          clientId,
          limit: 1
        });
        if (result.profileRoute?.deploymentId === "route-control" && result.profileRoute.routedBy === "active_control") {
          activeControlRoute = result;
          break;
        }
      }

      expect(activeControlRoute).toBeTruthy();
      expect(activeControlRoute.profileRoute.routedBy).toBe("active_control");
      expect(activeControlRoute.profileRoute.bucket).toBeGreaterThan(0);

      mount.createRetrievalProfileDeployment({
        deploymentId: "route-canary",
        profile: {
          profileId: "route-canary-profile",
          version: 3,
          weights: {
            bm25: 0.58,
            vector: 0.27,
            image: 0.12
          },
          topK: 7
        },
        status: "canary",
        trafficPercent: 100,
        reason: "canary-route"
      });

      const canaryRoute = mount.search({
        query: "routing smoke test",
        clientId: "client-any",
        limit: 1
      });
      expect(canaryRoute.profileRoute.routedBy).toBe("canary");
      expect(canaryRoute.profileRoute.deploymentId).toBe("route-canary");
    });
  });

  it("covers asset validation and garbage cleanup listing branches from temp directories", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot, userDataPath }) => {
      const assetRoot = path.join(storeRoot, "assets");
      await fs.mkdir(assetRoot, { recursive: true });

      const existingBytes = Buffer.from("existing asset bytes");
      const existingPath = path.join(assetRoot, "existing.bin");
      await fs.writeFile(existingPath, existingBytes);

      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-assets",
            batchId: "batch-assets",
            sourceId: "source-assets",
            sourcePath: "assets/source.txt",
            sourceHash: "sha-doc-assets",
            title: "Asset Validation Doc",
            summary: "Asset validation summary",
            bodyText: "asset body",
            assets: [
              {
                assetId: "asset-missing-relative",
                documentId: "doc-assets",
                sectionId: "doc-assets-section",
                blockId: "doc-assets-block",
                assetType: "image",
                mediaType: "image/png",
                title: "Missing Relative",
                text: "missing relative",
                ocrText: "",
                caption: "",
                relativePath: "",
                sha256: ""
              },
              {
                assetId: "asset-unsafe",
                documentId: "doc-assets",
                sectionId: "doc-assets-section",
                blockId: "doc-assets-block",
                assetType: "image",
                mediaType: "image/png",
                title: "Unsafe",
                text: "unsafe",
                ocrText: "",
                caption: "",
                relativePath: "../outside.bin",
                sha256: ""
              },
              {
                assetId: "asset-missing-file",
                documentId: "doc-assets",
                sectionId: "doc-assets-section",
                blockId: "doc-assets-block",
                assetType: "image",
                mediaType: "image/png",
                title: "Missing File",
                text: "missing file",
                ocrText: "",
                caption: "",
                relativePath: "assets/missing.bin",
                sha256: ""
              },
              {
                assetId: "asset-sha-mismatch",
                documentId: "doc-assets",
                sectionId: "doc-assets-section",
                blockId: "doc-assets-block",
                assetType: "image",
                mediaType: "image/png",
                title: "Checksum Mismatch",
                text: "checksum mismatch",
                ocrText: "",
                caption: "",
                relativePath: "assets/existing.bin",
                sha256: hashSha256("different content")
              }
            ]
          })
        ]
      });

      const validationRun = mount.runMaintenance({ taskType: "validate_assets" });
      expect(validationRun).toMatchObject({
        status: "completed",
        taskType: "validate_assets"
      });
      expect(validationRun.output).toMatchObject({
        checkedAssets: 4,
        ok: false
      });
      expect(validationRun.output.missing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "missing-relative-path" }),
          expect.objectContaining({ reason: "missing-file" })
        ])
      );
      expect(validationRun.output.unsafePaths).toHaveLength(1);
      expect(validationRun.output.shaMismatch).toHaveLength(1);

      const knowledgeSkillsDir = path.join(userDataPath, "knowledge-skills");
      await fs.mkdir(knowledgeSkillsDir, { recursive: true });
      await fs.writeFile(
        path.join(knowledgeSkillsDir, "distillation-report-alpha.json"),
        JSON.stringify({ report: "alpha" })
      );
      await fs.writeFile(
        path.join(knowledgeSkillsDir, "distillation-report-beta.json"),
        JSON.stringify({ report: "beta" })
      );
      await fs.writeFile(path.join(knowledgeSkillsDir, "not-a-report.txt"), "ignore me");

      const jobsDir = path.join(userDataPath, "jobs");
      await fs.mkdir(path.join(jobsDir, "job-failed"), { recursive: true });
      await fs.writeFile(
        path.join(jobsDir, "job-failed", "meta.json"),
        JSON.stringify({
          status: "failed",
          updatedAt: "2026-05-01T00:00:00.000Z"
        })
      );
      await fs.mkdir(path.join(jobsDir, "job-invalid"), { recursive: true });
      await fs.writeFile(path.join(jobsDir, "job-invalid", "meta.json"), "{invalid-json");
      await fs.mkdir(path.join(jobsDir, "job-running"), { recursive: true });
      await fs.writeFile(
        path.join(jobsDir, "job-running", "meta.json"),
        JSON.stringify({
          status: "running",
          updatedAt: "2026-05-01T00:00:00.000Z"
        })
      );

      const hydrationRoot = path.join(userDataPath, "knowledge-sources", "hydrated", "source-a");
      await fs.mkdir(path.join(hydrationRoot, "cache-a", "nested"), { recursive: true });
      await fs.writeFile(path.join(hydrationRoot, "cache-a", "nested", "payload.txt"), "cache payload");
      await fs.mkdir(path.join(hydrationRoot, "cache-b"), { recursive: true });
      await fs.writeFile(path.join(hydrationRoot, "cache-b", "payload.txt"), "cache payload two");
      const staleCacheDate = new Date(Date.now() - 3 * 3600 * 1000);
      await fs.utimes(path.join(hydrationRoot, "cache-a"), staleCacheDate, staleCacheDate);
      await fs.utimes(path.join(hydrationRoot, "cache-b"), staleCacheDate, staleCacheDate);

      const garbageRun = mount.runMaintenance({
        taskType: "garbage_cleanup",
        dryRun: true,
        includeJobArtifacts: true,
        includeHydrationCaches: true,
        checkpoint: false,
        vacuum: false,
        maxDistillationReports: 0,
        jobOlderThanHours: 0,
        hydrationCacheOlderThanHours: 0,
        keepSyncLogRows: 0,
        keepDuplicateReviewItems: 0,
        keepMaintenanceRuns: 0
      });

      expect(garbageRun).toMatchObject({
        status: "completed",
        taskType: "garbage_cleanup"
      });
      expect(garbageRun.output.planned.distillationReports).toBeGreaterThan(0);
      expect(garbageRun.output.planned.jobArtifacts).toBeGreaterThan(0);
      expect(garbageRun.output.planned.hydrationCaches).toBeGreaterThan(0);
      expect(garbageRun.output.examples.jobArtifacts[0]).toMatchObject({
        jobId: "job-failed",
        status: "failed"
      });
      expect(mount.listMaintenanceRuns({ limit: 5 })[0]).toMatchObject({
        taskType: "garbage_cleanup",
        status: "completed"
      });
    });
  });

  it("covers maintenance helper fallbacks, markdown parsing, and DOCX appendix export", async () => {
    const healthFindings = computeHealthFindings(
      {
        protocolVersion: "v0.0.1:knowledge:core-0",
        ok: false,
        counts: {
          documents: 2,
          blocks: 0,
          assets: 1,
          embeddings: 0
        },
        maintenance: {
          missingAssets: 1,
          indexStale: true,
          indexAgeHours: 24,
          staleIndexHours: 12
        },
        settings: {
          retrieval: {
            topK: 0,
            bm25Weight: -1,
            vectorWeight: -1,
            imageWeight: -1,
            recencyWeight: 2,
            recencyHalfLifeDays: 0
          },
          maintenance: {
            reindexBatchSize: 0,
            staleIndexHours: 0
          },
          markdown: {
            includeMachineReadableAppendix: false
          }
        },
        capabilities: {
          modalities: {
            image: false
          },
          storage: {
            structured: false,
            assets: false,
            vector: false
          },
          licensePolicy: {
            acceptedLicenses: ["MIT"],
            components: [
              {
                id: "vendor-a",
                role: "runtime",
                license: "GPL-3.0"
              }
            ]
          }
        }
      },
      {
        expectedProtocolVersion: "v0.0.1:knowledge:core-1",
        maxWeightSum: 0.5
      }
    );

    expect(healthFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "health.not_ok" }),
        expect.objectContaining({ id: "protocol.version_mismatch" }),
        expect.objectContaining({ id: "content.documents_without_blocks" }),
        expect.objectContaining({ id: "assets.missing_files" }),
        expect.objectContaining({ id: "indexes.embedding_coverage_low" }),
        expect.objectContaining({ id: "settings.topk_invalid" }),
        expect.objectContaining({ id: "settings.retrieval_weight_negative" }),
        expect.objectContaining({ id: "settings.retrieval_weights_disabled" }),
        expect.objectContaining({ id: "settings.recency_weight_invalid" }),
        expect.objectContaining({ id: "settings.recency_half_life_invalid" }),
        expect.objectContaining({ id: "settings.reindex_batch_size_invalid" }),
        expect.objectContaining({ id: "settings.stale_index_hours_invalid" }),
        expect.objectContaining({ id: "markdown.machine_metadata_disabled" }),
        expect.objectContaining({ id: "capabilities.image_disabled_with_assets" }),
        expect.objectContaining({ id: "capabilities.storage_structured_missing" }),
        expect.objectContaining({ id: "capabilities.storage_assets_missing" }),
        expect.objectContaining({ id: "capabilities.storage_vector_missing" }),
        expect.objectContaining({ id: "license.unaccepted.vendor-a" })
      ])
    );

    const plan = buildMaintenancePlan(
      {
        findings: [
          {
            id: "markdown.machine_metadata_disabled",
            severity: "warning",
            message: "Markdown metadata is disabled."
          },
          {
            id: "license.unaccepted.vendor-a",
            severity: "critical",
            message: "Vendor A is not accepted."
          },
          {
            id: "quality.assertions_failed",
            severity: "warning",
            message: "Quality checks failed."
          },
          {
            id: "unknown.finding",
            severity: "warning",
            message: "Unknown finding."
          },
          {
            id: "indexes.embedding_coverage_low",
            severity: "critical",
            message: "Embedding coverage is low."
          }
        ],
        quality: {
          ok: false,
          failed: 2
        },
        retrievalComparison: {
          regressions: [{ id: "query.alpha.score_drop" }]
        }
      },
      { generatedAt: "2026-06-05T00:00:00.000Z" }
    );

    expect(plan.status).toBe("action-required");
    expect(plan.ok).toBe(false);
    expect(plan.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "enable-markdown-metadata",
        "review-license-policy",
        "repair-quality-regression",
        "reindex-knowledge",
        "inspect-knowledge-health"
      ])
    );

    const arrayProfiles = compareRetrievalProfiles(
      {
        name: "baseline-array",
        results: [
          {
            query: "alpha",
            items: [
              { id: "a1", score: 0.95 },
              { id: "a2", score: 0.85 }
            ]
          }
        ],
        settings: []
      },
      {
        name: "candidate-array",
        queries: [
          {
            query: "alpha",
            items: [
              { id: "a2", score: 0.35 }
            ]
          }
        ],
        settings: {
          retrieval: {
            topK: 8
          }
        }
      },
      {
        minOverlap: 0.8,
        maxTopScoreDrop: 0.05,
        requireSameTopItem: true
      }
    );
    expect(arrayProfiles.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "query.alpha.overlap_low" }),
        expect.objectContaining({ id: "query.alpha.score_drop" }),
        expect.objectContaining({ id: "query.alpha.top_item_changed" })
      ])
    );

    const objectProfiles = compareRetrievalProfiles(
      {
        name: "baseline-object",
        searchResults: {
          beta: {
            items: [
              { id: "b1", score: 0.5 }
            ]
          }
        }
      },
      {
        name: "candidate-object",
        results: {
          beta: {
            hits: [
              { id: "b2", score: 0.9 }
            ]
          }
        }
      }
    );
    expect(objectProfiles.summary.changedTopItems).toBe(1);

    const fallbackProfiles = compareRetrievalProfiles(
      {
        name: "baseline-fallback",
        query: "gamma",
        items: [
          { itemId: "g1", score: 0.8 }
        ]
      },
      {
        name: "candidate-fallback",
        query: "gamma",
        hits: [
          { itemId: "g2", score: 1 }
        ]
      }
    );
    expect(fallbackProfiles.improvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "query.gamma.score_improved" })
      ])
    );

    const runSummary = summarizeMaintenanceRuns(
      [
        {
          runId: "run-completed",
          taskType: "reindex",
          status: "completed",
          startedAt: "2026-06-05T00:00:00.000Z",
          finishedAt: "2026-06-05T00:00:10.000Z"
        },
        {
          runId: "run-failed",
          taskType: "validate_assets",
          status: "failed",
          startedAt: "2026-06-06T00:00:00.000Z",
          finishedAt: "2026-06-06T00:00:05.000Z"
        },
        {
          runId: "run-canceled",
          taskType: "gc",
          status: "cancelled",
          startedAt: "not-a-date",
          finishedAt: ""
        }
      ],
      { maxFailureRate: 0.2 }
    );
    expect(runSummary).toMatchObject({
      total: 3,
      failedRuns: 2
    });
    expect(runSummary.warnings).toEqual(
      expect.arrayContaining([
        "The latest maintenance run failed.",
        expect.stringContaining("Failure rate")
      ])
    );

    const qualityAssertions = validateKnowledgeQualityAssertions(
      [
        {
          id: "alpha",
          query: "alpha",
          minItems: 2,
          maxItems: 0,
          minScore: 0.9,
          requiredTerms: ["needle"],
          forbiddenTerms: ["blocked"],
          requiredModalities: ["image", "text", "audio"],
          requiredItemIds: ["item-a", "missing-item"],
          minAssets: 2,
          requiredAssetIds: ["asset-a", "asset-b"],
          requireReadableAssets: true,
          requireMarkdownMetadata: true,
          requiredMetadataKeys: ["pact_knowledge.version", "payload.kind"],
          expected: {
            metadata: {
              pact_knowledge: {
                version: 1
              },
              payload: {
                kind: "test"
              }
            }
          },
          markdown: `---
pact_knowledge:
  version: 1
payload:
  kind: test
---

blocked token

\`\`\`json
{"protocolVersion":"v0.0.1:knowledge:core-1","payload":{"kind":"test"}}
\`\`\`

\`\`\`json
not valid json
\`\`\`
`
        },
        {
          id: "evidence",
          evidenceId: "evidence-1"
        },
        {
          id: "special",
          target: "special"
        }
      ],
      {
        searchResults: [
          {
            query: "alpha",
            score: 0.4,
            items: [
              {
                itemId: "item-a",
                score: 0.4,
                modalities: ["image"]
              }
            ],
            assets: [
              {
                assetId: "asset-a"
              }
            ],
            payload: {
              blocks: [
                {
                  blockId: "block-a"
                }
              ],
              assets: [
                {
                  assetId: "asset-a"
                }
              ]
            },
            text: "blocked token"
          }
        ],
        evidenceById: {
          "evidence-1": {
            id: "evidence-1",
            items: [
              {
                itemId: "evidence-item",
                score: 0.2
              }
            ]
          }
        },
        special: {
          items: [
            {
              itemId: "special-item",
              score: 0.1
            }
          ]
        },
        assetReadability: {
          "asset-a": true,
          "asset-b": false
        }
      }
    );
    expect(qualityAssertions.ok).toBe(false);
    expect(qualityAssertions.failed).toBeGreaterThan(0);
    expect(qualityAssertions.results).toEqual(
      expect.arrayContaining([
          expect.objectContaining({
          id: "alpha",
          ok: false,
          failures: expect.arrayContaining([
            expect.stringContaining("Expected at least 2 item(s)"),
            expect.stringContaining("Expected at most 0 item(s)"),
            expect.stringContaining("Expected top score >= 0.9"),
            expect.stringContaining("Missing required term: needle"),
            expect.stringContaining("Found forbidden term: blocked"),
            expect.stringContaining("Missing required modality: audio"),
            expect.stringContaining("Missing required result id: missing-item"),
            expect.stringContaining("Expected at least 2 asset(s)"),
            expect.stringContaining("Missing required asset id: asset-b"),
            expect.stringContaining("Markdown metadata is missing key: pact_knowledge.version"),
            expect.stringContaining("Markdown metadata pact_knowledge did not match expected value.")
          ])
        }),
        expect.objectContaining({
          id: "evidence"
        }),
        expect.objectContaining({
          id: "special"
        })
      ])
    );
    expect(validateKnowledgeQualityAssertions([], {}, { skipEmpty: true })).toMatchObject({
      ok: true,
      total: 0,
      skipped: 1
    });

    const docx = await buildKnowledgeDocxExport({
      documents: [
        {
          documentId: "doc-docx",
          title: "DOCX Route Coverage",
          sourcePath: "docs/doc-docx.md",
          summary: "",
          sections: [
            {
              sectionId: "doc-docx-section",
              title: "Overview",
              level: 3,
              position: 1
            }
          ],
          blocks: [
            {
              blockId: "doc-docx-block",
              sectionId: "doc-docx-section",
              title: "Empty body block",
              blockType: "text",
              text: "",
              snippet: "",
              position: 1,
              metadata: {}
            }
          ],
          assets: [
            {
              assetId: "doc-docx-asset",
              sectionId: "doc-docx-section",
              blockId: "doc-docx-block",
              title: "Attachment",
              mediaType: "text/plain",
              relativePath: "assets/doc-docx.txt"
            }
          ]
        }
      ],
      filters: {
        documentId: "doc-docx"
      },
      includeMachineReadable: true,
      generatedAt: "2026-06-05T00:00:00.000Z"
    });

    expect(docx.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.fileName).toContain("doc-docx");
    expect(docx.manifest.machineReadableAppendixFormat).toBe("yaml");
    expect(docx.buffer.length).toBeGreaterThan(0);
  });
});
