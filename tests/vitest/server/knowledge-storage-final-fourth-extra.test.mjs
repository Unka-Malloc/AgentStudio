import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
const fsWatchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...actual.default,
      watch: (...args) => fsWatchMock(...args)
    },
    watch: (...args) => fsWatchMock(...args)
  };
});

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

const taxonomyRuntimeMock = {
  loadSync: vi.fn(() => ({
    schemaVersion: 1,
    version: "mock-fourth",
    source: "mock-taxonomy-fourth",
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
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  health: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    ok: true,
    degraded: false
  })),
  capabilities: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    enabled: true,
    safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
  })),
  fuseCandidatesSync: vi.fn(() => ({
    candidates: [],
    runtime: "mock",
    degraded: false,
    explanations: []
  })),
  proposeProfile: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    candidate: {
      profileId: "balanced-candidate",
      topK: 10,
      version: 2,
      weights: {
        bm25: 0.4,
        vector: 0.4,
        image: 0.2
      }
    }
  })),
  generateSuggestions: vi.fn(() => [])
};

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy-fourth.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary-fourth.json",
    emailRulesPath: "/tmp/mock-email-rules-fourth.json",
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

let createKnowledgeSourceService;
let createKnowledgeCoreMount;

function createRegistryStore() {
  const fingerprintsBySource = new Map();
  const registryFilesBySource = new Map();
  const registrySourcesById = new Map();

  return {
    listBySource: vi.fn((sourceId) => new Map(fingerprintsBySource.get(sourceId) || [])),
    applyDelta: vi.fn(({ sourceId, files = [], removedPaths = [] }) => {
      const next = new Map(fingerprintsBySource.get(sourceId) || []);
      for (const file of files) {
        next.set(file.relativePath, {
          relativePath: file.relativePath,
          byteSize: Number(file.byteSize || 0),
          mtimeMs: Number(file.mtimeMs || 0),
          fingerprint: `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`
        });
      }
      for (const relativePath of removedPaths) {
        next.delete(relativePath);
      }
      fingerprintsBySource.set(sourceId, next);
    }),
    syncRegistryFiles: vi.fn((source, scanId, files = [], removedPaths = []) => {
      const next = new Map(registryFilesBySource.get(source.sourceId) || []);
      for (const file of files) {
        next.set(file.relativePath, {
          sourceId: source.sourceId,
          relativePath: file.relativePath,
          absolutePath: path.join(source.directoryPath, file.relativePath),
          extension: path.extname(file.relativePath).toLowerCase(),
          byteSize: Number(file.byteSize || 0),
          mtimeMs: Number(file.mtimeMs || 0),
          fingerprint: `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`,
          lastScanId: scanId || "",
          updatedAt: "2026-01-01T00:00:00.000Z"
        });
      }
      for (const relativePath of removedPaths) {
        next.delete(relativePath);
      }
      registryFilesBySource.set(source.sourceId, next);
    }),
    upsertRegistrySource: vi.fn((source) => {
      registrySourcesById.set(source.sourceId, { ...source });
    }),
    recordPathAlias: vi.fn(),
    purgePersistedSourcePaths: vi.fn(),
    clearSourceFiles: vi.fn((sourceId) => {
      fingerprintsBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    removeRegistrySource: vi.fn((sourceId) => {
      registrySourcesById.delete(sourceId);
      fingerprintsBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    countRegisteredFiles: vi.fn((sourceId) => {
      const registryFiles = registryFilesBySource.get(sourceId);
      if (registryFiles) {
        return registryFiles.size;
      }
      return (fingerprintsBySource.get(sourceId) || new Map()).size;
    }),
    listRegisteredFiles: vi.fn((sourceId) => {
      const registryFiles = registryFilesBySource.get(sourceId) || new Map();
      return [...registryFiles.values()];
    }),
    close: vi.fn()
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-storage-final-fourth-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 10
    });
  }
}

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-storage-final-fourth-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: false
    });
    await testCase({ mount, userDataPath });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 10
    });
  }
}

function buildDocument({
  documentId,
  batchId,
  sourceId,
  sourcePath = "",
  sourceHash = "",
  title,
  summary,
  metadata
} = {}) {
  const sectionId = `${documentId}-section`;
  return {
    documentId: String(documentId || `doc-${Math.random().toString(16).slice(2)}`),
    collectionId: "manual",
    batchId: batchId || "batch-fourth-core",
    sourceId: sourceId || `${documentId}-source`,
    sourcePath,
    sourceHash,
    documentType: "message",
    title: title || `Document ${documentId}`,
    summary: summary || `Summary ${documentId}`,
    metadata: metadata || {},
    sections: [
      {
        sectionId,
        documentId: String(documentId),
        title: "正文",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId: `${documentId}-block`,
        documentId: String(documentId),
        sectionId,
        blockType: "text",
        title: "正文",
        text: `body ${documentId}`,
        snippet: `body ${documentId}`,
        position: 1,
        sourceLocator: {
          batchId: batchId || "batch-fourth-core",
          sourceId: sourceId || `${documentId}-source`
        },
        metadata: {}
      }
    ],
    assets: []
  };
}

beforeEach(async () => {
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
  fsWatchMock.mockReset();

  taxonomyRuntimeMock.loadSync.mockClear();
  embeddingRuntimeMock.embedText.mockClear();
  vectorStoreMock.upsert.mockClear();
  learningRuntimeMock.health.mockClear();

  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => String(filePath || "").endsWith(".txt"));
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
  vi.useRealTimers();

  if (!createKnowledgeSourceService) {
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
  }
  if (!createKnowledgeCoreMount) {
    ({ createKnowledgeCoreMount } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs"));
  }
});

describe("knowledge storage final fourth source service coverage", () => {
  it("returns preempted sync result when a newer refresh supersedes one in flight", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const jobManager = {
        getJob: vi.fn(async (jobId) => ({
          id: jobId,
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-02T00:00:00.000Z"
        })),
        createJob: vi.fn(async (input) => ({
          id: "job-refresh",
          status: "running",
          stage: input?.source?.reason === "sync_job" ? "parse" : "parse",
          progressPercent: 0,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }))
      };

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        hydrationEnabled: false,
        runNow: false
      });

      const firstScanEntered = createDeferred();
      const releaseFirstScan = createDeferred();
      let shouldBlockFirstRefreshScan = true;
      isSupportedImportFilePathMock.mockImplementation(async (filePath) => {
        if (shouldBlockFirstRefreshScan && String(filePath || "").endsWith("alpha.txt")) {
          shouldBlockFirstRefreshScan = false;
          firstScanEntered.resolve(true);
          await releaseFirstScan.promise;
        }
        return true;
      });

      const first = service.refreshSource(created.source.sourceId, { reason: "manual" });
      await firstScanEntered.promise;
      const second = service.refreshSource(created.source.sourceId, { reason: "manual", force: true });

      releaseFirstScan.resolve(true);

      const firstResult = await first;
      const secondResult = await second;

      expect(firstResult).toMatchObject({
        skipped: true,
        reason: "preempted",
        source: expect.objectContaining({
          sourceId: created.source.sourceId
        })
      });
      expect(secondResult).toMatchObject({
        source: expect.objectContaining({
          sourceId: created.source.sourceId
        }),
        job: expect.objectContaining({
          id: "job-refresh"
        })
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);

      await service.close();
    });
  });

  it("falls back to an empty-sync state and clears prior fingerprints when source directory turns empty", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      const sourceFile = path.join(docsDir, "old.txt");
      await fs.writeFile(sourceFile, "old", "utf8");

      const jobManager = {
        getJob: vi.fn(async (jobId) => ({
          id: jobId,
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-02T00:00:00.000Z"
        })),
        createJob: vi.fn(async (input) => ({
          id: "job-empty",
          status: "running",
          stage: input?.source?.reason === "sync_job" ? "parse" : "parse",
          progressPercent: 0,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }))
      };

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        hydrationEnabled: false,
        runNow: false
      });
      const registryStore = createSourceFileRegistryStoreMock.mock.results[0].value;

      const first = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(first.source.lastFileCount).toBe(1);
      expect(await service.listRegisteredFiles(created.source.sourceId)).toMatchObject({
        totalCount: 1
      });

      await fs.rm(sourceFile, { force: true });
      const second = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      const refreshCalls = registryStore.applyDelta.mock.calls;
      const lastApply = refreshCalls.at(-1)?.[0];

      expect(second).toMatchObject({
        skipped: true,
        reason: "empty",
        source: expect.objectContaining({
          sourceId: created.source.sourceId,
          status: "idle",
          lastFileCount: 0,
          error: ""
        })
      });
      expect(lastApply).toMatchObject({
        sourceId: created.source.sourceId,
        files: [],
        removedPaths: ["old.txt"]
      });
      expect(registryStore.purgePersistedSourcePaths).toHaveBeenCalledWith([
        path.join(docsDir, "old.txt")
      ]);
      const listed = await service.listRegisteredFiles(created.source.sourceId);
      expect(listed).toMatchObject({
        totalCount: 0
      });

      await service.close();
    });
  });

  it("schedules automatic retry after sync failure and recovers on retry attempt", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const jobManager = {
        getJob: vi.fn(async (jobId) => ({
          id: jobId,
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-03T00:00:00.000Z"
        })),
        createJob: vi.fn()
          .mockRejectedValueOnce(new Error("sync boom"))
          .mockResolvedValue({
            id: "job-retry",
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-03T00:00:01.000Z"
          })
      };

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        hydrationEnabled: false,
        runNow: false
      });

      await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");

      const afterFailure = await service.listSources();
      expect(afterFailure.sources[0]).toMatchObject({
        status: "error",
        syncRetryAttempt: 1,
        error: "",
        nextRetryAt: expect.any(String)
      });
      const sourceId = afterFailure.sources[0].sourceId;
      await service.close();

      const recoveredService = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });
      const recovered = await recoveredService.refreshSource(sourceId, { reason: "manual" });
      expect(recovered).toMatchObject({
        skipped: false
      });

      const afterRecovery = await recoveredService.listSources();
      expect(afterRecovery.sources[0]).toMatchObject({
        syncRetryAttempt: 0,
        nextRetryAt: "",
        error: ""
      });
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);
      expect(jobManager.createJob).toHaveBeenCalledTimes(2);

      await recoveredService.close();
    });
  });
});

describe("knowledge storage final fourth core coverage", () => {
  it("rolls back an active canary deployment to a still-existing baseline profile", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const baseline = mount.createRetrievalProfileDeployment({
        profile: {
          profileId: "baseline-profile",
          version: 1,
          topK: 12,
          weights: {
            bm25: 0.6,
            vector: 0.25,
            image: 0.15,
            graph: 0,
            feedbackBoost: 0.05
          }
        },
        status: "active",
        trafficPercent: 100
      });

      const canary = mount.createRetrievalProfileDeployment({
        profile: {
          profileId: "canary-profile",
          version: 2,
          topK: 20,
          weights: {
            bm25: 0.7,
            vector: 0.2,
            image: 0.1,
            graph: 0,
            feedbackBoost: 0
          }
        },
        status: "canary",
        trafficPercent: 20,
        baselineProfileKey: baseline.profileKey
      });

      const rolledBack = mount.rollbackRetrievalProfileDeployment({
        deploymentId: canary.deploymentId,
        reason: "integration-test"
      });

      expect(rolledBack.deployment).toMatchObject({
        status: "rolled_back",
        profileKey: canary.profileKey,
        baselineProfileKey: baseline.profileKey,
        trafficPercent: 0
      });
      expect(rolledBack.activeProfile).toMatchObject({
        profileId: "baseline-profile",
        profileKey: baseline.profileKey,
        active: true
      });
      expect(mount.getRetrievalProfile({ profileKey: baseline.profileKey }).active).toBe(true);
    });
  });

  it("uses metadata fallback keys when sourceHash/path are missing during dedupe and conflict checks", async () => {
    await withTempKnowledgeCore(async ({ mount }) => {
      const existing = buildDocument({
        documentId: "meta-doc-1",
        sourcePath: "",
        sourceHash: "",
        metadata: {
          rawObjectSha256: "raw-hash-101",
          originalRelativePath: "inbox/report.eml"
        }
      });

      const first = await mount.upsertDocuments({ documents: [existing] });
      expect(first.documentCount).toBe(1);

      const duplicate = buildDocument({
        documentId: "meta-doc-2",
        sourcePath: "",
        sourceHash: "",
        metadata: {
          rawObjectSha256: "raw-hash-101",
          originalRelativePath: "inbox/report.eml"
        }
      });
      const duplicateResult = await mount.upsertDocuments({ documents: [duplicate] });
      expect(duplicateResult.documentCount).toBe(0);
      expect(duplicateResult.skippedConflictCount).toBe(1);
      expect(duplicateResult.reviewItems[0].reason).toBe("duplicate_source_document");

      const changed = buildDocument({
        documentId: "meta-doc-3",
        sourcePath: "",
        sourceHash: "",
        metadata: {
          rawObjectSha256: "raw-hash-202",
          originalRelativePath: "inbox/report.eml"
        }
      });
      const conflictResult = await mount.upsertDocuments({ documents: [changed] });
      expect(conflictResult.documentCount).toBe(0);
      expect(conflictResult.skippedConflictCount).toBe(1);
      expect(conflictResult.reviewItems[0].reason).toBe("source_path_content_conflict");
    });
  });
});
