import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createBatchRepository } from "../../../server/platform/common/storage/batch-repository.mjs";
import { getMetadataDatabasePath, initializeMetadataSchema } from "../../../server/platform/common/storage/schema-manager.mjs";

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
    fuseCandidatesSync: vi.fn(({ candidates = [] } = {}) => ({
      runtime: "mock",
      degraded: true,
      candidates,
      explanations: []
    })),
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

const FIRST_GENERATED_AT = "2026-03-01T00:00:00.000Z";

async function withTempBatchRepository(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-batch-final-extra-"));
  await fs.mkdir(path.join(root, "metadata"), { recursive: true });

  const db = new Database(getMetadataDatabasePath(root));
  initializeMetadataSchema(db);
  const repository = createBatchRepository({ db, userDataPath: root });

  try {
    return await testCase({ root, db, repository });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-extra-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function buildBatchSource({
  batchId,
  sourceId,
  objectId,
  text,
  originalRelativePath,
  contentHash,
  sourceType = "mail"
}) {
  return {
    id: sourceId,
    name: `${sourceId}.eml`,
    path: originalRelativePath,
    kind: "mail",
    rawObject: {
      objectId,
      ingestOrigin: "mail-archive",
      originalFileName: `${sourceId}.eml`,
      originalRelativePath,
      clientUid: "client-a",
      sourceType,
      providerId: "provider-a",
      externalId: `${sourceId}-external`,
      syncBatchId: `${batchId}-sync`,
      contentHash,
      capturedAt: FIRST_GENERATED_AT,
      sourceMetadata: {
        topic: sourceId
      },
      archiveFileName: `${sourceId}.zip`,
      originalSourcePath: `/archive/${sourceId}.eml`,
      sourceContainerPath: `container-${batchId}`,
      storageRelativePath: `storage/${objectId}.eml`,
      sha256: contentHash,
      byteSize: 128,
      mediaType: "message/rfc822",
      sourceCreatedAt: FIRST_GENERATED_AT,
      sourceUpdatedAt: FIRST_GENERATED_AT,
      sourceCollectedAt: FIRST_GENERATED_AT,
      createdAt: FIRST_GENERATED_AT
    },
    sourceCreatedAt: FIRST_GENERATED_AT,
    sourceUpdatedAt: FIRST_GENERATED_AT,
    sourceCollectedAt: FIRST_GENERATED_AT,
    providerId: "provider-a",
    externalId: `${sourceId}-external`,
    syncBatchId: `${batchId}-sync`,
    contentHash,
    capturedAt: FIRST_GENERATED_AT,
    text,
    mediaType: "text/plain"
  };
}

async function seedBatchCorpus(repository) {
  const batchA = "batch-alpha";
  const batchB = "batch-beta";

  repository.beginBatch({
    batchId: batchA,
    jobId: "job-alpha",
    generatedAt: FIRST_GENERATED_AT,
    settings: { profile: "alpha" }
  });
  repository.persistSources({
    batchId: batchA,
    warnings: ["alpha-warning"],
    rules: { keywordStopwords: ["skip"] },
    sources: [
      buildBatchSource({
        batchId: batchA,
        sourceId: "source-alpha",
        objectId: "raw-alpha",
        text: "Alpha beta gamma alpha",
        originalRelativePath: "mail/alpha.eml",
        contentHash: "hash-alpha"
      })
    ]
  });

  repository.beginBatch({
    batchId: batchB,
    jobId: "job-beta",
    generatedAt: FIRST_GENERATED_AT,
    settings: { profile: "beta" }
  });
  repository.persistSources({
    batchId: batchB,
    warnings: [],
    rules: {},
    sources: [
      buildBatchSource({
        batchId: batchB,
        sourceId: "source-beta",
        objectId: "raw-beta",
        text: "Delta epsilon only",
        originalRelativePath: "mail/beta.eml",
        contentHash: "hash-beta"
      })
    ]
  });

  return { batchA, batchB };
}

describe("batch repository final extra coverage", () => {
  it("covers status, persistence, retrieval, vocabulary, and deletion APIs", async () => {
    await withTempBatchRepository(async ({ repository }) => {
      const { batchA } = await seedBatchCorpus(repository);

      expect(repository.hasBatch(batchA)).toBe(true);
      expect(repository.getBatch(batchA)).toMatchObject({
        batch_id: batchA,
        status: "analyzing"
      });
      expect(repository.getRawMailObject("raw-alpha")).toMatchObject({
        object_id: "raw-alpha",
        batch_id: batchA
      });
      expect(repository.listRawObjectStoragePathsByBatch(batchA)).toEqual(
        expect.arrayContaining(["storage/raw-alpha.eml"])
      );
      expect(repository.searchSourceDocuments({ query: "alpha", limit: 5 })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            batchId: batchA,
            sourceRef: "source-alpha"
          })
        ])
      );
      expect(repository.listRawCorpusDocuments({ batchId: batchA, query: "alpha", limit: 5 })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            batchId: batchA,
            text: expect.stringContaining("Alpha")
          })
        ])
      );
      expect(
        repository.listSourceCorpusRawTerms({
          corpusPaths: [{ path: "mail", type: "directory" }],
          query: "alpha",
          limit: 10
        })
      ).toEqual(expect.arrayContaining([expect.objectContaining({ term: "alpha" })]));
      expect(repository.listSourceVocabularyTermStatsByTerms({ terms: ["Alpha", "beta", "", "alpha"] })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: "alpha" }),
          expect.objectContaining({ term: "beta" })
        ])
      );
      expect(repository.getSignificantSourceTerms({})).toMatchObject({
        ok: false,
        error: "scope_required"
      });

      const significant = repository.getSignificantSourceTerms({ batchId: batchA, limit: 10 });
      expect(significant).toMatchObject({
        ok: true,
        scope: { batchId: batchA }
      });
      expect(significant.terms.map((item) => item.term)).toContain("alpha");

      repository.updateBatchStatus(batchA, "completed", "done");
      expect(repository.getBatch(batchA)).toMatchObject({
        status: "completed",
        error: "done"
      });
      repository.markBatchFailed(batchA, "boom");
      expect(repository.getBatch(batchA)).toMatchObject({
        status: "failed",
        error: "boom"
      });

      const createdOperation = repository.upsertDeletionOperation({
        batchId: batchA,
        jobId: "job-delete",
        status: "pending",
        state: { step: 1 },
        error: "",
        operationId: "op-a"
      });
      expect(createdOperation).toMatchObject({
        operationId: "op-a",
        batchId: batchA,
        status: "pending",
        state: { step: 1 }
      });
      const updatedOperation = repository.updateDeletionOperation("op-a", {
        status: "running",
        state: { step: 2 },
        error: "working"
      });
      expect(updatedOperation).toMatchObject({
        status: "running",
        state: { step: 2 },
        error: "working"
      });
      expect(repository.listPendingDeletionOperations()).toEqual(
        expect.arrayContaining([expect.objectContaining({ operationId: "op-a" })])
      );
      repository.deleteDeletionOperation("op-a");
      expect(repository.listPendingDeletionOperations().some((item) => item.operationId === "op-a")).toBe(false);

      repository.deleteBatchRecords(batchA);
      expect(repository.searchSourceDocuments({ query: "alpha" })).toEqual([]);
      repository.deleteBatchRow(batchA);
      expect(repository.hasBatch(batchA)).toBe(false);
      expect(repository.getBatchArtifactPaths(batchA)).toMatchObject({
        batchId: batchA,
        objectRootPath: expect.any(String)
      });
    });
  });

  it("covers word cloud export/import and bag mutation branches", async () => {
    await withTempBatchRepository(async ({ repository }) => {
      await seedBatchCorpus(repository);

      const saved = await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "cloud-a",
          title: "Cloud Alpha",
          status: "draft",
          termsSnapshot: [
            { term: "alpha", frequency: 3 },
            { term: "beta", frequency: 1 },
            { term: "gamma", frequency: 1 }
          ],
          wordBags: [
            {
              wordBagId: "topic-a",
              label: "Topic A",
              terms: [{ term: "alpha", frequency: 3 }],
              children: [
                {
                  wordBagId: "topic-child",
                  label: "Child",
                  terms: [{ term: "beta", frequency: 1 }]
                }
              ]
            },
            {
              wordBagId: "other-bag",
              label: "Other",
              terms: [{ term: "gamma", frequency: 1 }]
            }
          ],
          corpusPaths: [{ path: "mail", type: "directory" }],
          modelAlias: "mock-model"
        }
      });

      expect(saved.wordBagSet).toMatchObject({
        wordBagSetId: "cloud-a",
        title: "Cloud Alpha"
      });
      const exported = await repository.exportKnowledgeWordCloudSet({
        wordBagSetId: "cloud-a"
      });
      expect(exported).toMatchObject({
        ok: true,
        exportType: "pact.knowledge.word_bags.export",
        schemaVersion: 1
      });

      const copied = await repository.importKnowledgeWordCloudSet({
        importPayload: exported,
        mode: "copy"
      });
      expect(copied).toMatchObject({
        ok: true,
        action: "imported",
        mode: "copy",
        importedFromWordBagSetId: "cloud-a"
      });
      expect(copied.wordBagSet.wordBagSetId).not.toBe("cloud-a");

      const overwritten = await repository.importKnowledgeWordCloudSet({
        importPayload: exported,
        mode: "overwrite"
      });
      expect(overwritten).toMatchObject({
        ok: true,
        action: "imported",
        mode: "overwrite",
        importedFromWordBagSetId: "cloud-a",
        wordBagSet: expect.objectContaining({ wordBagSetId: "cloud-a" })
      });

      const cloudState = await repository.getKnowledgeWordCloudState({
        wordBagSetId: "cloud-a",
        wordBagId: "topic-a",
        corpusPaths: [{ path: "mail", type: "directory" }],
        query: "alpha"
      });
      expect(cloudState).toMatchObject({
        ok: true,
        schemaVersion: 1,
        wordBagSet: expect.objectContaining({ wordBagSetId: "cloud-a" })
      });
      expect(repository.listSourceCorpusRawTerms({
        corpusPaths: [{ path: "mail", type: "directory" }],
        limit: 10
      })).toEqual(expect.arrayContaining([expect.objectContaining({ term: "alpha" })]));

      const groupedTerms = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "cloud-a",
        wordBagIds: ["topic-a", "topic-a", "missing"],
        includeChildren: true
      });
      expect(groupedTerms).toMatchObject({
        ok: true,
        wordBagSetId: "cloud-a",
        missingWordBagIds: ["missing"]
      });
      expect(groupedTerms.groups[0]).toMatchObject({
        wordBagId: "topic-a",
        includeChildren: true
      });
      await expect(repository.getKnowledgeWordBagTerms({ wordBagSetId: "cloud-a" })).rejects.toMatchObject({
        code: "word_bag_id_required"
      });

      const added = await repository.addKnowledgeWordBag({
        wordBagSetId: "cloud-a",
        wordBag: {
          label: "Extra",
          terms: [{ term: "delta", frequency: 1 }]
        }
      });
      expect(added).toMatchObject({
        ok: true,
        action: "added"
      });
      expect(added.wordBag.wordBagId).toBeTruthy();

      const renamed = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-a",
        wordBagId: added.wordBag.wordBagId,
        wordBag: {
          label: "Extra Renamed"
        }
      });
      expect(renamed).toMatchObject({
        ok: true,
        action: "updated",
        wordBag: expect.objectContaining({
          label: "Extra Renamed"
        })
      });

      const moved = await repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-a",
        wordBagId: added.wordBag.wordBagId,
        patch: {
          parentWordBagId: "topic-a"
        }
      });
      expect(moved).toMatchObject({
        ok: true,
        action: "updated",
        wordBag: expect.objectContaining({
          parentWordBagId: "topic-a"
        })
      });

      const deleted = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "cloud-a",
        wordBagId: added.wordBag.wordBagId
      });
      expect(deleted).toMatchObject({
        ok: true,
        action: "deleted",
        deletedWordBagId: added.wordBag.wordBagId
      });

      const presetBag = saved.wordBagSet.wordBags.find((bag) => bag.wordBagId === "default");
      await expect(
        repository.deleteKnowledgeWordBag({
          wordBagSetId: "cloud-a",
          wordBagId: presetBag.wordBagId
        })
      ).rejects.toMatchObject({
        code: "preset_word_bag_delete_forbidden"
      });
    });
  });
});

async function withTempKnowledgeMount(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-final-extra-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function buildKnowledgeDocument({ batchId, documentId, sourceId, sourcePath, assetRelativePath }) {
  return {
    documentId,
    collectionId: "manual-knowledge",
    collectionTitle: "Manual Knowledge",
    collectionType: "manual",
    batchId,
    sourceId,
    documentType: "note",
    title: "Alpha Reference",
    summary: "First summary",
    sourcePath,
    sourceHash: "source-hash-a",
    metadata: {
      keywords: ["alpha", "reference"]
    },
    sections: [
      {
        sectionId: "section-1",
        title: "Intro",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId: "block-1",
        documentId,
        sectionId: "section-1",
        blockType: "text",
        title: "Block One",
        text: "Alpha block body",
        snippet: "Alpha block body",
        position: 1,
        sourceLocator: {
          page: 1
        },
        metadata: {
          topic: "alpha"
        }
      }
    ],
    assets: [
      {
        assetId: "asset-good",
        documentId,
        sectionId: "section-1",
        assetType: "image",
        mediaType: "image/png",
        title: "Good asset",
        text: "",
        ocrText: "Alpha image",
        caption: "Alpha caption",
        relativePath: assetRelativePath,
        sha256: "good-asset-sha",
        byteSize: 3,
        width: 1,
        height: 1,
        sourceLocator: {
          page: 1
        },
        metadata: {
          alt: "good"
        }
      },
      {
        assetId: "asset-bad",
        documentId,
        sectionId: "section-1",
        assetType: "image",
        mediaType: "image/png",
        title: "Bad asset",
        text: "",
        ocrText: "Bad asset",
        caption: "Bad asset",
        relativePath: "../escape.png",
        sha256: "bad-asset-sha",
        byteSize: 3,
        width: 1,
        height: 1,
        sourceLocator: {},
        metadata: {
          alt: "bad"
        }
      }
    ]
  };
}

describe("knowledge core final extra coverage", () => {
  it("ingests documents, searches, exports, validates assets, and deletes batches", async () => {
    await withTempKnowledgeMount(async ({ mount, userDataPath }) => {
      await fs.mkdir(path.join(userDataPath, "knowledge-core", "assets"), { recursive: true });
      await fs.writeFile(path.join(userDataPath, "knowledge-core", "assets", "good.png"), Buffer.from([1, 2, 3]));

      const sourceResult = await mount.ingestSources({
        batchId: "batch-source",
        sources: [
          {
            id: "source-mail",
            name: "Source Mail",
            kind: "mail",
            text: "Alpha source body with embedded text",
            embeddedDocuments: [
              {
                id: "embedded-1",
                text: "Embedded alpha appendix",
                metadata: {
                  resourceName: "Attachment"
                }
              }
            ],
            rawObjectId: "raw-source-mail",
            rawObjectSha256: "raw-source-mail-sha",
            rawObjectByteSize: 64,
            originalFileName: "source-mail.eml",
            originalRelativePath: "mail/source-mail.eml"
          }
        ]
      });
      expect(sourceResult).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        batchId: "batch-source",
        mode: "incremental-source"
      });

      const manualDoc = buildKnowledgeDocument({
        batchId: "batch-manual",
        documentId: "manual-doc",
        sourceId: "manual-source",
        sourcePath: "docs/manual.md",
        assetRelativePath: "assets/good.png"
      });
      const upsertResult = mount.upsertDocuments({ documents: [manualDoc] });
      expect(upsertResult).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        documentCount: 1,
        receivedDocumentCount: 1
      });

      mount.setMaintenance({
        retrieval: {
          topK: 7
        },
        learning: {
          enabled: false
        }
      });
      expect(mount.getMaintenance().retrieval.topK).toBe(7);

      const searchResult = mount.search({
        query: "Alpha",
        batchId: "batch-manual",
        limit: 5
      });
      expect(searchResult.protocolVersion).toBe("pact.knowledge.v1");
      expect(searchResult.items.length).toBeGreaterThan(0);

      const evidence = mount.getEvidence({ evidenceId: searchResult.items[0].evidenceId });
      expect(evidence).toMatchObject({
        evidenceId: searchResult.items[0].evidenceId,
        documentId: "manual-doc"
      });

      const markdown = mount.renderMarkdown({
        evidenceId: evidence.evidenceId
      });
      expect(markdown).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        evidenceId: evidence.evidenceId,
        contentType: "text/markdown; charset=utf-8"
      });

      const docx = await mount.exportDocx({
        documentId: "manual-doc",
        includeMachineReadable: true
      });
      const markdownExport = mount.exportMarkdown({
        batchId: "batch-manual"
      });
      const htmlExport = mount.exportHtml({
        sourceId: "manual-source"
      });
      expect(docx).toBeTruthy();
      expect(markdownExport).toBeTruthy();
      expect(htmlExport).toBeTruthy();

      const item = mount.getItem({ documentId: "manual-doc" });
      expect(item.blocks.length).toBeGreaterThan(0);
      expect(item.assets.length).toBeGreaterThan(0);

      const structure = mount.getDocumentStructure({ documentId: "manual-doc" });
      expect(structure).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        document: expect.objectContaining({
          documentId: "manual-doc"
        })
      });
      expect(structure.tree.length).toBeGreaterThan(0);

      const assetContent = await mount.getAssetContent({ assetId: "asset-good" });
      expect(assetContent).toMatchObject({
        contentType: "image/png",
        fileName: "good.png"
      });
      expect(assetContent.buffer.length).toBe(3);
      await expect(mount.getAssetContent({ assetId: "asset-bad" })).rejects.toThrow("知识库资产路径越界。");

      const validateRun = mount.runMaintenance({
        taskType: "validate_assets"
      });
      expect(validateRun).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        taskType: "validate_assets",
        status: "completed"
      });
      expect(validateRun.output).toMatchObject({
        checkedAssets: 2,
        ok: false
      });
      expect(validateRun.output.unsafePaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: "asset-bad"
          })
        ])
      );

      const unknownRun = mount.runMaintenance({
        taskType: "not-a-real-task"
      });
      expect(unknownRun).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        taskType: "not_a_real_task",
        status: "completed"
      });
      expect(unknownRun.output.ok).toBe(false);

      expect(mount.listMaintenanceRuns({ limit: 10 }).length).toBeGreaterThanOrEqual(2);
      expect(mount.health()).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        ok: false,
        taxonomy: {
          source: "mock-taxonomy"
        }
      });
      expect(mount.capabilities()).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        outputFormats: ["json", "markdown", "docx"]
      });

      expect(mount.deleteBatch("batch-manual")).toEqual({
        ok: true,
        batchId: "batch-manual"
      });
      expect(mount.getItem({ documentId: "manual-doc" })).toBeNull();
    });
  });

  it("covers retrieval profile lifecycle and settings merge branches", async () => {
    await withTempKnowledgeMount(async ({ mount }) => {
      expect(createMount).toBe(createKnowledgeCoreMount);

      const updatedSettings = mount.setMaintenance({
        retrieval: {
          topK: 9
        },
        learning: {
          canaryEnabled: false
        }
      });
      expect(updatedSettings.retrieval.topK).toBe(9);
      expect(mount.getMaintenance().retrieval.topK).toBe(9);

      const activeProfile = mount.getRetrievalProfile({});
      expect(activeProfile).toMatchObject({
        profileId: "balanced",
        active: true
      });

      const deployment = mount.createRetrievalProfileDeployment({
        deploymentId: "promo-canary",
        profile: {
          profileId: "promo-profile",
          version: 2,
          weights: {
            bm25: 0.62,
            vector: 0.24,
            image: 0.1,
            graph: 0.03,
            feedbackBoost: 0.01
          },
          topK: 12
        },
        status: "canary",
        trafficPercent: 5,
        reason: "extra-test"
      });
      expect(deployment).toMatchObject({
        deploymentId: "promo-canary",
        profileId: "promo-profile",
        status: "canary"
      });
      expect(mount.listRetrievalProfileDeployments({ status: "canary", limit: 10 }).deployments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deploymentId: "promo-canary",
            profileKey: expect.stringContaining("promo-profile")
          })
        ])
      );

      const promoted = mount.promoteRetrievalProfileDeployment({
        deploymentId: "promo-canary",
        reason: "promoted-in-test"
      });
      expect(promoted).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        deployment: expect.objectContaining({
          deploymentId: "promo-canary",
          status: "active"
        }),
        activeProfile: expect.objectContaining({
          profileId: "promo-profile",
          active: true
        })
      });

      const rolledBack = mount.rollbackRetrievalProfileDeployment({
        deploymentId: "promo-canary",
        reason: "rolled-back-in-test"
      });
      expect(rolledBack).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        deployment: expect.objectContaining({
          deploymentId: "promo-canary",
          status: "rolled_back"
        })
      });

      expect(mount.listRetrievalProfiles({ limit: 10 }).length).toBeGreaterThan(0);
      expect(mount.getRetrievalProfile({ profileId: "promo-profile" })).toMatchObject({
        profileId: "promo-profile"
      });

      const learningHealth = await mount.learningHealth();
      expect(learningHealth).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        ok: true,
        activeProfile: expect.objectContaining({
          profileId: "promo-profile"
        })
      });
      expect(learningHealth.deployments.length).toBeGreaterThanOrEqual(1);
    });
  });
});
