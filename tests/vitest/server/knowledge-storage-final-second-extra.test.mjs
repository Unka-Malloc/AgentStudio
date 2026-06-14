import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, vi } from "vitest";

const createSourceFileRegistryStoreMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const isSupportedImportFilePathMock = vi.hoisted(() => vi.fn());
const indexKnowledgeSourceFilesMock = vi.hoisted(() => vi.fn());
const deleteKnowledgeSourceFileIndexMock = vi.hoisted(() => vi.fn());
const checkpointTreeIdMock = vi.hoisted(() => vi.fn());
const startCheckpointTreeMock = vi.hoisted(() => vi.fn());
const upsertCheckpointNodeMock = vi.hoisted(() => vi.fn());
const finishCheckpointTreeMock = vi.hoisted(() => vi.fn());
const deleteCheckpointTreeMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());
const atomicWriteJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  isSupportedImportFilePath: isSupportedImportFilePathMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs", () => ({
  deleteKnowledgeSourceFileIndex: deleteKnowledgeSourceFileIndexMock,
  indexKnowledgeSourceFiles: indexKnowledgeSourceFilesMock
}));

vi.mock("../../../server/platform/common/data-structure/checkpoint-tree-store.mjs", () => ({
  checkpointTreeId: checkpointTreeIdMock,
  deleteCheckpointTree: deleteCheckpointTreeMock,
  finishCheckpointTree: finishCheckpointTreeMock,
  startCheckpointTree: startCheckpointTreeMock,
  upsertCheckpointNode: upsertCheckpointNodeMock
}));

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  serverToken: serverTokenMock
}));

vi.mock("../../../server/platform/common/platform-core/state-coordinator.mjs", () => ({
  atomicWriteJson: atomicWriteJsonMock
}));

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
    fuseCandidatesSync: vi.fn(({ candidates = [] } = {}) => ({
      runtime: "mock",
      degraded: true,
      candidates,
      explanations: []
    })),
    proposeProfile: vi.fn(() => ({
      protocolVersion: "v0.0.1:knowledge:learning-1",
      profileId: "balanced"
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

import { createBatchRepository } from "../../../server/platform/common/storage/batch-repository.mjs";
import { getMetadataDatabasePath, initializeMetadataSchema } from "../../../server/platform/common/storage/schema-manager.mjs";
import createKnowledgeCoreMount from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import { createKnowledgeSourceService } from "../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs";

function createRegistryStore() {
  const registryFilesBySource = new Map();
  const registrySourcesById = new Map();

  return {
    listBySource: vi.fn(() => new Map()),
    applyDelta: vi.fn(),
    syncRegistryFiles: vi.fn(),
    upsertRegistrySource: vi.fn((source) => {
      registrySourcesById.set(source.sourceId, { ...source });
    }),
    recordPathAlias: vi.fn(),
    purgePersistedSourcePaths: vi.fn(),
    clearSourceFiles: vi.fn(),
    removeRegistrySource: vi.fn((sourceId) => {
      registrySourcesById.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    countRegisteredFiles: vi.fn(() => 0),
    listRegisteredFiles: vi.fn(() => []),
    close: vi.fn()
  };
}

async function withTempDir(prefix, testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 10 });
  }
}

async function withTempRepository(testCase) {
  return withTempDir("pact-storage-final-second-extra-batch-", async (root) => {
    await fs.mkdir(path.join(root, "metadata"), { recursive: true });
    const db = new Database(getMetadataDatabasePath(root));
    initializeMetadataSchema(db);
    const repository = createBatchRepository({ db, userDataPath: root });
    try {
      return await testCase({ root, db, repository });
    } finally {
      db.close();
    }
  });
}

async function withTempKnowledgeCore(testCase) {
  return withTempDir("pact-storage-final-second-extra-core-", async (root) => {
    const mount = await createKnowledgeCoreMount({
      userDataPath: root,
      outlineEnabled: false
    });
    try {
      return await testCase({ root, mount });
    } finally {
      await mount.close();
    }
  });
}

async function withTempKnowledgeSourceService(testCase) {
  return withTempDir("pact-storage-final-second-extra-source-", async (root) => {
    const service = createKnowledgeSourceService({
      userDataPath: root,
      jobManager: {
        getJob: vi.fn(async () => null),
        createJob: vi.fn()
      },
      watchingEnabled: true
    });
    try {
      return await testCase({ root, service });
    } finally {
      await service.close();
    }
  });
}

function buildKnowledgeDocument({
  batchId,
  documentId,
  sourceId,
  sourcePath,
  assets
}) {
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
    sourceHash: `source-hash-${documentId}`,
    metadata: {
      keywords: ["alpha", "reference"]
    },
    sections: [
      {
        sectionId: `${documentId}-section-1`,
        title: "Intro",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId: `${documentId}-block-1`,
        documentId,
        sectionId: `${documentId}-section-1`,
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
    assets
  };
}

beforeEach(() => {
  createSourceFileRegistryStoreMock.mockReset();
  loadSettingsMock.mockReset();
  isSupportedImportFilePathMock.mockReset();
  indexKnowledgeSourceFilesMock.mockReset();
  deleteKnowledgeSourceFileIndexMock.mockReset();
  checkpointTreeIdMock.mockReset();
  startCheckpointTreeMock.mockReset();
  upsertCheckpointNodeMock.mockReset();
  finishCheckpointTreeMock.mockReset();
  deleteCheckpointTreeMock.mockReset();
  serverTokenMock.mockReset();
  atomicWriteJsonMock.mockReset();

  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => filePath.endsWith(".txt"));
  indexKnowledgeSourceFilesMock.mockResolvedValue({
    indexedAt: "2026-01-01T00:00:00.000Z",
    snapshotHash: "indexed-snapshot",
    indexedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    checkpointTreeId: "checkpoint-source-index"
  });
  deleteKnowledgeSourceFileIndexMock.mockResolvedValue(undefined);
  checkpointTreeIdMock.mockImplementation((kind, sourceId) => `${kind}:${sourceId}`);
  startCheckpointTreeMock.mockResolvedValue(undefined);
  upsertCheckpointNodeMock.mockResolvedValue(undefined);
  finishCheckpointTreeMock.mockResolvedValue(undefined);
  deleteCheckpointTreeMock.mockResolvedValue(undefined);
  serverTokenMock.mockImplementation((...parts) => parts.filter(Boolean).join(":"));
  atomicWriteJsonMock.mockImplementation(async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  });
  createSourceFileRegistryStoreMock.mockImplementation(() => createRegistryStore());
});

describe("batch repository remaining boundaries", () => {
  it("handles empty corpus lookups and bad significant-term input", async () => {
    await withTempRepository(async ({ repository }) => {
      expect(repository.listSourceCorpusRawTerms({ corpusPaths: [] })).toEqual([]);
      expect(repository.listSourceCorpusRawTerms({ corpusPaths: ["mail/"] })).toEqual([]);

      expect(
        repository.listSourceVocabularyTermStatsByTerms({
          terms: ["Alpha", " alpha ", "", null, "Beta", "BETA"]
        })
      ).toEqual([
        {
          term: "alpha",
          frequency: 0,
          documentFrequency: 0,
          bm25Weight: 0
        },
        {
          term: "beta",
          frequency: 0,
          documentFrequency: 0,
          bm25Weight: 0
        }
      ]);

    });
  });
});

describe("knowledge-core remaining boundaries", () => {
  it("covers empty export, deletion, and maintenance branches", async () => {
    await withTempKnowledgeCore(async ({ root, mount }) => {
      const emptyDocx = await mount.exportDocx({ limit: -1 });
      const emptyMarkdown = mount.exportMarkdown({ limit: -1 });
      const emptyHtml = mount.exportHtml({ limit: -1 });

      expect(emptyDocx.manifest).toMatchObject({
        documentCount: 0,
        sectionCount: 0,
        blockCount: 0,
        assetCount: 0,
        filters: {
          limit: 1
        }
      });
      expect(emptyMarkdown.fileName).toContain(".md");
      expect(emptyMarkdown.buffer.toString("utf8")).toContain("当前筛选条件下没有可导出的知识文档。");
      expect(emptyHtml.fileName).toContain(".html");
      expect(emptyHtml.buffer.toString("utf8")).toContain("当前筛选条件下没有可导出的知识文档。");

      expect(mount.runMaintenance({ taskType: "validate_assets" })).toMatchObject({
        protocolVersion: "v0.0.1:knowledge:core-1",
        taskType: "validate_assets",
        status: "completed",
        output: {
          checkedAssets: 0,
          ok: true
        }
      });
      expect(mount.runMaintenance({ taskType: "repair_missing_thumbnails" })).toMatchObject({
        protocolVersion: "v0.0.1:knowledge:core-1",
        taskType: "repair_missing_thumbnails",
        status: "completed",
        output: {
          repaired: 0,
          policy: "source-image-reused"
        }
      });

      expect(await mount.getAssetContent({ assetId: "missing-asset" })).toBeNull();

      expect(mount.deleteBatch("missing-batch")).toEqual({
        ok: true,
        batchId: "missing-batch"
      });
      expect(mount.getItem({ documentId: "missing-doc" })).toBeNull();

      const assetsDir = path.join(root, "knowledge-core", "assets");
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(path.join(assetsDir, "good.png"), Buffer.from([1, 2, 3]));

      const documentId = "doc-boundary";
      const batchId = "batch-boundary";
      const sourceId = "source-boundary";
      mount.upsertDocuments({
        documents: [
          buildKnowledgeDocument({
            batchId,
            documentId,
            sourceId,
            sourcePath: "docs/boundary.md",
            assets: [
              {
                assetId: "asset-good",
                documentId,
                sectionId: `${documentId}-section-1`,
                assetType: "image",
                mediaType: "image/png",
                title: "Good asset",
                text: "",
                ocrText: "Alpha image",
                caption: "Alpha caption",
                relativePath: "assets/good.png",
                sha256: "good-asset-sha",
                byteSize: 3,
                width: 1,
                height: 1,
                sourceLocator: {},
                metadata: {}
              },
              {
                assetId: "asset-missing",
                documentId,
                sectionId: `${documentId}-section-1`,
                assetType: "image",
                mediaType: "image/png",
                title: "Missing asset",
                text: "",
                ocrText: "Missing image",
                caption: "Missing caption",
                relativePath: "assets/missing.png",
                sha256: "missing-asset-sha",
                byteSize: 3,
                width: 1,
                height: 1,
                sourceLocator: {},
                metadata: {}
              },
              {
                assetId: "asset-empty",
                documentId,
                sectionId: `${documentId}-section-1`,
                assetType: "asset",
                mediaType: "application/pdf",
                title: "Empty asset",
                text: "",
                ocrText: "",
                caption: "",
                relativePath: "",
                sha256: "empty-asset-sha",
                byteSize: 0,
                width: 0,
                height: 0,
                sourceLocator: {},
                metadata: {}
              },
              {
                assetId: "asset-unsafe",
                documentId,
                sectionId: `${documentId}-section-1`,
                assetType: "image",
                mediaType: "image/png",
                title: "Unsafe asset",
                text: "",
                ocrText: "Unsafe image",
                caption: "Unsafe caption",
                relativePath: "../escape.png",
                sha256: "unsafe-asset-sha",
                byteSize: 3,
                width: 1,
                height: 1,
                sourceLocator: {},
                metadata: {
                  thumbnailRelativePath: "already-present.png"
                }
              }
            ]
          })
        ]
      });

      const validateRun = mount.runMaintenance({ taskType: "validate_assets" });
      expect(validateRun.output).toMatchObject({
        checkedAssets: 4,
        ok: false
      });
      expect(validateRun.output.missing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: "asset-empty",
            reason: "missing-relative-path"
          }),
          expect.objectContaining({
            assetId: "asset-missing",
            relativePath: "assets/missing.png",
            reason: "missing-file"
          })
        ])
      );
      expect(validateRun.output.unsafePaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetId: "asset-unsafe",
            relativePath: "../escape.png"
          })
        ])
      );

      const repairRun = mount.runMaintenance({ taskType: "repair_missing_thumbnails" });
      expect(repairRun.output).toMatchObject({
        repaired: 2,
        policy: "source-image-reused"
      });

      const item = mount.getItem({ documentId });
      expect(item.assets.find((asset) => asset.assetId === "asset-good")?.metadata).toMatchObject({
        thumbnailRelativePath: "assets/good.png"
      });
      expect(item.assets.find((asset) => asset.assetId === "asset-missing")?.metadata).toMatchObject({
        thumbnailRelativePath: "assets/missing.png"
      });
      expect(item.assets.find((asset) => asset.assetId === "asset-empty")?.metadata).toEqual({});
      expect(item.assets.find((asset) => asset.assetId === "asset-unsafe")?.metadata).toMatchObject({
        thumbnailRelativePath: "already-present.png"
      });

      const assetContent = await mount.getAssetContent({ assetId: "asset-good" });
      expect(assetContent).toMatchObject({
        fileName: "good.png",
        contentType: "image/png"
      });
      expect(assetContent.buffer.length).toBe(3);
      expect(await mount.getAssetContent({ assetId: "asset-empty" })).toBeNull();
      await expect(mount.getAssetContent({ assetId: "asset-unsafe" })).rejects.toThrow("知识库资产路径越界。");

      expect(mount.deleteBatch(batchId)).toEqual({
        ok: true,
        batchId
      });
      expect(mount.getItem({ documentId })).toBeNull();
    });
  });
});

describe("knowledge-source service remaining boundaries", () => {
  it("returns an empty snapshot and records a stopped source state", async () => {
    await withTempKnowledgeSourceService(async ({ root, service }) => {
      const emptySnapshot = await service.listSources();
      expect(emptySnapshot.summary).toEqual({
        totalCount: 0,
        enabledCount: 0,
        watchingCount: 0,
        syncingCount: 0,
        indexingCount: 0,
        errorCount: 0
      });
      expect(emptySnapshot.sources).toEqual([]);

      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir, { recursive: true });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        autoSync: false,
        hydrationEnabled: false,
        runNow: false
      });

      expect(created.source).toMatchObject({
        status: "idle",
        watcherStatus: "stopped",
        watcherCount: 0
      });

      const snapshot = await service.listSources();
      expect(snapshot.summary).toMatchObject({
        totalCount: 1,
        enabledCount: 1,
        watchingCount: 0,
        syncingCount: 0,
        indexingCount: 0,
        errorCount: 0
      });
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "idle",
        watcherStatus: "stopped"
      });

      const deleted = await service.deleteSource(created.source.sourceId);
      expect(deleted.deletedSource).toMatchObject({
        sourceId: created.source.sourceId
      });
      expect((await service.listSources()).summary.totalCount).toBe(0);
    });
  });
});
