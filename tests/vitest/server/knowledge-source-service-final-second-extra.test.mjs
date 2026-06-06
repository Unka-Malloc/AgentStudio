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

let createKnowledgeSourceService;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    listRegisteredFiles: vi.fn((sourceId, options = {}) => {
      const registryFiles = registryFilesBySource.get(sourceId);
      const files = registryFiles
        ? [...registryFiles.values()]
        : [...(fingerprintsBySource.get(sourceId) || new Map()).values()].map((file) => ({
            sourceId,
            relativePath: file.relativePath,
            absolutePath: path.join(registrySourcesById.get(sourceId)?.directoryPath || "", file.relativePath),
            extension: path.extname(file.relativePath).toLowerCase(),
            byteSize: Number(file.byteSize || 0),
            mtimeMs: Number(file.mtimeMs || 0),
            fingerprint: file.fingerprint,
            lastScanId: ""
          }));
      const offset = Math.max(0, Number(options.offset || 0));
      const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : files.length;
      return files.slice(offset, offset + limit);
    }),
    close: vi.fn()
  };
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-final-second-extra-"));
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

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForMockCalls(mockFn, count) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${count} mock call(s).`);
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
  vi.useRealTimers();
});

beforeEach(async () => {
  if (!createKnowledgeSourceService) {
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
  }
});

describe("knowledge-source service final second extra coverage", () => {
  it("reports watcher setup errors and still publishes the startup snapshot", async () => {
    await withTempDir(async (root) => {
      const brokenPath = path.join(root, "broken-source.txt");
      await fs.writeFile(brokenPath, "not a directory", "utf8");

      const protocolEventBus = {
        publish: vi.fn(async () => {})
      };
      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        protocolEventBus,
        watchingEnabled: true
      });

      const created = await service.createSource({
        directoryPath: brokenPath,
        label: "Broken",
        hydrationEnabled: false,
        runNow: false
      });

      expect(created.source).toMatchObject({
        sourceId: expect.any(String),
        watcherStatus: "error",
        error: "路径不是目录。"
      });

      await service.start();

      expect(protocolEventBus.publish).toHaveBeenCalledWith(
        "knowledge.sources",
        expect.objectContaining({
          state: expect.objectContaining({
            summary: expect.objectContaining({
              totalCount: 1,
              errorCount: 1
            })
          })
        }),
        expect.objectContaining({ type: "knowledge.sources.snapshot" })
      );
      expect(protocolEventBus.publish).toHaveBeenCalledWith(
        "knowledge.sources",
        expect.objectContaining({
          source: expect.objectContaining({
            sourceId: created.source.sourceId,
            watcherStatus: "error"
          })
        }),
        expect.objectContaining({ type: "knowledge.sources.watch_error" })
      );

      const snapshot = await service.listSources();
      expect(snapshot.summary).toMatchObject({
        totalCount: 1,
        enabledCount: 1,
        watchingCount: 0,
        syncingCount: 0,
        indexingCount: 0,
        errorCount: 1
      });
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        watcherStatus: "error",
        error: "路径不是目录。"
      });

      await service.close();
    });
  });

  it("recovers from a failed sync on a later manual refresh", async () => {
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
        createJob: vi.fn()
          .mockRejectedValueOnce(new Error("sync boom"))
          .mockResolvedValueOnce({
            id: "job-2",
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-02T00:00:01.000Z"
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
        autoSync: false,
        hydrationEnabled: false,
        runNow: false
      });

      await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");

      const afterFailure = await service.listSources();
      expect(afterFailure.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "error",
        syncRetryAttempt: 1,
        nextRetryAt: expect.any(String)
      });
      expect(afterFailure.sources[0].error).toBe("");

      const recovered = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(recovered.source).toMatchObject({
        sourceId: created.source.sourceId,
        error: "",
        syncRetryAttempt: 0,
        nextRetryAt: ""
      });
      expect(recovered.index).toMatchObject({
        indexedCount: 1,
        failedCount: 0,
        snapshotHash: "indexed-snapshot"
      });

      const afterRecovery = await service.listSources();
      expect(afterRecovery.summary).toMatchObject({
        totalCount: 1,
        enabledCount: 1,
        syncingCount: 0,
        indexingCount: 0,
        errorCount: 0
      });
      expect(afterRecovery.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "idle",
        error: "",
        syncRetryAttempt: 0,
        nextRetryAt: "",
        lastIndexError: ""
      });

      await service.close();
    });
  });

  it("skips a concurrent index run while the first index is still active", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const firstIndex = createDeferred();
      indexKnowledgeSourceFilesMock.mockImplementationOnce(() => firstIndex.promise);

      const jobManager = {
        getJob: vi.fn(async (jobId) => ({
          id: jobId,
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-03T00:00:00.000Z"
        })),
        createJob: vi.fn(async () => ({
          id: `job-${Math.random().toString(16).slice(2)}`,
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-03T00:00:00.000Z"
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
        autoSync: false,
        hydrationEnabled: false,
        runNow: false
      });

      const firstRefresh = service.refreshSource(created.source.sourceId, { reason: "manual" });
      await waitForMockCalls(indexKnowledgeSourceFilesMock, 1);

      const secondRefresh = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(secondRefresh.index).toMatchObject({
        skipped: true,
        reason: "index_active"
      });

      firstIndex.resolve({
        indexedAt: "2026-01-03T00:00:01.000Z",
        snapshotHash: "first-index",
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-source-index"
      });
      const firstResult = await firstRefresh;
      expect(firstResult.index).toMatchObject({
        indexedCount: 1,
        snapshotHash: "first-index"
      });

      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      await service.close();
    });
  });

  it("reconciles removed sources from disk when refreshing in-memory state", async () => {
    await withTempDir(async (root) => {
      const alphaDir = path.join(root, "alpha");
      const betaDir = path.join(root, "beta");
      await fs.mkdir(alphaDir);
      await fs.mkdir(betaDir);

      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: 1,
        updatedAt: "2026-01-04T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-alpha",
            directoryPath: alphaDir,
            label: "Alpha",
            enabled: true,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          {
            sourceId: "source-beta",
            directoryPath: betaDir,
            label: "Beta",
            enabled: true,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z"
          }
        ]
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      const initial = await service.listSources();
      expect(initial.sources.map((item) => item.sourceId)).toEqual(["source-beta", "source-alpha"]);

      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: 1,
        updatedAt: "2026-01-04T00:00:01.000Z",
        sources: [
          {
            sourceId: "source-alpha",
            directoryPath: alphaDir,
            label: "Alpha",
            enabled: true,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-04T00:00:01.000Z"
          }
        ]
      });

      const reconciled = await service.reconcileWatchers();
      expect(reconciled.sources.map((item) => item.sourceId)).toEqual(["source-alpha"]);
      expect(await service.listRegisteredFiles("source-beta")).toBeNull();

      await service.close();
    });
  });
});
