import { EventEmitter } from "node:events";
import fsSync from "node:fs";
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

function createRegistryStore({ includeListRegisteredFiles = true } = {}) {
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
    ...(includeListRegisteredFiles
      ? {
          listRegisteredFiles: vi.fn((sourceId, options = {}) => {
            const registryFiles = registryFilesBySource.get(sourceId);
            const files = registryFiles
              ? [...registryFiles.values()]
              : [...(fingerprintsBySource.get(sourceId) || new Map()).values()].map((file) => ({
                  sourceId,
                  relativePath: file.relativePath,
                  absolutePath: file.relativePath,
                  extension: path.extname(file.relativePath).toLowerCase(),
                  byteSize: Number(file.byteSize || 0),
                  mtimeMs: Number(file.mtimeMs || 0),
                  fingerprint: file.fingerprint,
                  lastScanId: ""
                }));
            const offset = Math.max(0, Number(options.offset || 0));
            const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : files.length;
            return files.slice(offset, offset + limit);
          })
        }
      : {}),
    close: vi.fn()
  };
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-final-extra-"));
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

async function waitForPublishType(publishMock, type) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const call = publishMock.mock.calls.find((item) => item?.[2]?.type === type);
    if (call) {
      return call;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for publish type ${type}`);
}

async function waitForMockCallCount(mockFn, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${count} mock call(s)`);
}

async function waitForFakeTimerMockCallCount(mockFn, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error(`Timed out waiting for ${count} mock call(s)`);
}

async function waitForFakeTimerPublishType(publishMock, type) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const call = publishMock.mock.calls.find((item) => item?.[2]?.type === type);
    if (call) {
      return call;
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error(`Timed out waiting for publish type ${type}`);
}

async function waitForRealTimerMockCallCount(mockFn, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${count} mock call(s)`);
}

async function waitForRealTimerPublishType(publishMock, type) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const call = publishMock.mock.calls.find((item) => item?.[2]?.type === type);
    if (call) {
      return call;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for publish type ${type}`);
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

describe("knowledge-source service final extra coverage", () => {
  it("falls back to persisted source defaults when optional fields are missing", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-defaults",
            directoryPath: docsDir,
            enabled: "yes",
            autoSync: "no",
            recursive: "1",
            hydrationEnabled: "false",
            hydrationTimeoutMs: "abc",
            lastJobProgressPercent: 23,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
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
        sourceId: "source-defaults",
        directoryPath: docsDir,
        label: "docs",
        enabled: true,
        autoSync: false,
        recursive: true,
        hydrationEnabled: false,
        hydrationPolicy: "auto",
        hydrationTimeoutMs: 60000,
        lastJobProgressPercent: 23
      });

      await service.close();
    });
  });

  it("treats a non-array sources payload as empty", async () => {
    await withTempDir(async (root) => {
      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        sources: {
          sourceId: "not-an-array"
        }
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      const snapshot = await service.listSources();
      expect(snapshot.summary).toMatchObject({
        totalCount: 0,
        enabledCount: 0,
        watchingCount: 0,
        syncingCount: 0,
        indexingCount: 0,
        errorCount: 0
      });
      expect(snapshot.sources).toEqual([]);

      await service.close();
    });
  });

  it("rejects invalid hydration configuration during refresh without scheduling a retry", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.mkdir(path.join(root, "knowledge-sources"), { recursive: true });
        await fs.writeFile(path.join(root, "knowledge-sources", "source-hydration.json"), "{not-json", "utf8");

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        autoSync: false,
        hydrationEnabled: true,
        runNow: false
      });

      await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toBeInstanceOf(SyntaxError);

      const snapshot = await service.listSources();
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "error",
        error: expect.any(String)
      });

      await service.close();
    });
  });

  it("creates and syncs a new source immediately when runNow is true", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn(async (input) => ({
            id: "job-1",
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...input
          }))
        },
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        autoSync: true,
        hydrationEnabled: false,
        runNow: true
      });

      expect(created).toMatchObject({
        skipped: false,
        job: expect.objectContaining({
          id: "job-1"
        }),
        source: expect.objectContaining({
          sourceId: expect.any(String),
          lastJobId: "job-1",
          lastJobStatus: "running",
          status: "syncing"
        }),
        registry: {
          fileCount: 1,
          addedCount: 1,
          changedCount: 0,
          removedCount: 0
        }
      });
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      await service.close();
    });
  });

  it("clears a pending retry timer when deleting a failed source and ignores checkpoint cleanup errors", async () => {
    await withTempDir(async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

      try {
        const docsDir = path.join(root, "docs");
        await fs.mkdir(docsDir);
        await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

        const jobManager = {
          getJob: vi.fn(async () => null),
          createJob: vi.fn(async () => {
            throw new Error("sync boom");
          })
        };

        deleteCheckpointTreeMock.mockRejectedValueOnce(new Error("delete tree boom"));

        const service = createKnowledgeSourceService({
          userDataPath: root,
          jobManager,
          watchingEnabled: false
        });

        const created = await service.createSource({
          directoryPath: docsDir,
          label: "Docs",
          autoSync: true,
          hydrationEnabled: false,
          runNow: false
        });

        await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");
        expect(vi.getTimerCount()).toBe(1);

        const deleted = await service.deleteSource(created.source.sourceId);
        expect(deleted.deletedSource).toMatchObject({
          sourceId: created.source.sourceId,
          directoryPath: docsDir
        });
        expect(deleteCheckpointTreeMock).toHaveBeenCalledWith({
          userDataPath: root,
          treeId: `knowledge-source-sync:${created.source.sourceId}`
        });
        expect(vi.getTimerCount()).toBe(0);

        await service.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("closes active watchers during shutdown", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: true
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        autoSync: true,
        hydrationEnabled: false,
        runNow: false
      });

      await service.reconcileWatchers();
      expect(created.source).toMatchObject({
        watcherStatus: "watching",
        watcherCount: 1
      });

      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:01.000Z",
        sources: [
          {
            ...created.source,
            debounceMs: 900
          }
        ]
      });
      await service.reconcileWatchers();

      const snapshot = await service.listSources();
      expect(snapshot.sources[0]).toMatchObject({
        watcherStatus: "watching",
        watcherCount: 1
      });

      await service.close();
    });
  });

  it("handles watcher change scheduling and watcher error callbacks through mocked fs.watch", async () => {
    await withTempDir(async (root) => {
      const watchCalls = [];
      const watchSpy = vi.spyOn(fsSync, "watch").mockImplementation((directory, options, listener) => {
        const watcher = new EventEmitter();
        watcher.close = vi.fn();
        watchCalls.push({ directory, options, listener, watcher });
        return watcher;
      });

      try {
        const docsDir = path.join(root, "docs");
        await fs.mkdir(docsDir);
        await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

        const protocolEventBus = {
          publish: vi.fn(async () => {})
        };
        const jobManager = {
          getJob: vi.fn(async () => null),
          createJob: vi.fn(async () => {
            throw new Error("scheduled sync boom");
          })
        };
        const service = createKnowledgeSourceService({
          userDataPath: root,
          jobManager,
          protocolEventBus,
          watchingEnabled: true
        });

        const created = await service.createSource({
          directoryPath: docsDir,
          label: "Docs",
          autoSync: true,
          debounceMs: 1,
          hydrationEnabled: false,
          runNow: false
        });

        expect(watchCalls).toHaveLength(1);
        watchCalls[0].listener("rename", "alpha.txt");
        const changeCall = await waitForPublishType(protocolEventBus.publish, "knowledge.sources.change_detected");
        expect(changeCall).toEqual([
          "knowledge.sources",
          expect.objectContaining({
            source: expect.objectContaining({
              sourceId: created.source.sourceId,
              status: "pending",
              pendingReason: "rename:alpha.txt"
            })
          }),
          expect.objectContaining({ type: "knowledge.sources.change_detected" })
        ]);

        await waitForRealTimerMockCallCount(jobManager.createJob, 1);
        expect(jobManager.createJob).toHaveBeenCalledTimes(1);
        const syncFailedCall = await waitForRealTimerPublishType(protocolEventBus.publish, "knowledge.sources.sync_failed");
        expect(syncFailedCall).toEqual([
          "knowledge.sources",
          expect.objectContaining({
            source: expect.objectContaining({
              sourceId: created.source.sourceId,
              error: "scheduled sync boom"
            })
          }),
          expect.objectContaining({ type: "knowledge.sources.sync_failed" })
        ]);

        watchCalls[0].watcher.emit("error", new Error("watch callback boom"));
        const watchErrorCall = await waitForPublishType(protocolEventBus.publish, "knowledge.sources.watch_error");
        expect(watchErrorCall).toEqual([
          "knowledge.sources",
          expect.objectContaining({
            source: expect.objectContaining({
              sourceId: created.source.sourceId,
              watcherStatus: "error",
              error: "watch callback boom"
            })
          }),
          expect.objectContaining({ type: "knowledge.sources.watch_error" })
        ]);

        await service.close();
        expect(watchCalls[0].watcher.close).toHaveBeenCalled();
      } finally {
        watchSpy.mockRestore();
      }
    });
  });

  it("clears pending timers when a source disappears from disk", async () => {
    await withTempDir(async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-11T00:00:00.000Z"));

      try {
        const docsDir = path.join(root, "docs");
        await fs.mkdir(docsDir);
        await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

        const service = createKnowledgeSourceService({
          userDataPath: root,
          jobManager: {
            getJob: vi.fn(async () => null),
            createJob: vi.fn(async () => {
              throw new Error("sync boom");
            })
          },
          watchingEnabled: false
        });

        const created = await service.createSource({
          directoryPath: docsDir,
          label: "Docs",
          autoSync: true,
          hydrationEnabled: false,
          runNow: false
        });

        await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");
        expect(vi.getTimerCount()).toBe(1);

        await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
          schemaVersion: 1,
          updatedAt: "2026-01-11T00:00:01.000Z",
          sources: []
        });

        const snapshot = await service.listSources();
        expect(snapshot.sources).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);

        await service.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("rejects malformed persisted source registry JSON", async () => {
    await withTempDir(async (root) => {
      await fs.mkdir(path.join(root, "knowledge-sources"), { recursive: true });
      await fs.writeFile(path.join(root, "knowledge-sources", "sources.json"), "{not-json", "utf8");

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      await expect(service.listSources()).rejects.toBeInstanceOf(SyntaxError);
      await service.close();
    });
  });

  it("transitions index status from failed to indexed across refresh attempts", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: "job-1",
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-02T00:00:00.000Z",
            ...input
          };
          jobs.set(job.id, job);
          return job;
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

      indexKnowledgeSourceFilesMock.mockRejectedValueOnce(new Error("index boom"));
      const failed = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(failed.index).toMatchObject({
        error: "index boom",
        indexedCount: 0,
        failedCount: 1
      });

      const afterFailed = await service.listSources();
      expect(afterFailed.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        indexStatus: "failed",
        lastIndexError: "index boom"
      });

      indexKnowledgeSourceFilesMock.mockResolvedValueOnce({
        indexedAt: "2026-01-02T00:00:00.000Z",
        snapshotHash: "index-snapshot",
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-source-index"
      });
      const succeeded = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(succeeded.index).toMatchObject({
        indexedCount: 1,
        snapshotHash: "index-snapshot"
      });

      const settled = await service.listSources();
      expect(settled.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        indexStatus: "indexed",
        lastIndexError: "",
        lastIndexedFileCount: 1,
        lastIndexSnapshotHash: "index-snapshot"
      });

      await service.close();
    });
  });

  it("schedules exponential retry backoff after a sync failure", async () => {
    await withTempDir(async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async () => {
          throw new Error("sync boom");
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
        autoSync: true,
        hydrationEnabled: false,
        runNow: false
      });

      await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");

      const persisted = JSON.parse(await fs.readFile(path.join(root, "knowledge-sources", "sources.json"), "utf8"));
      expect(persisted.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "error",
        syncRetryAttempt: 1,
        error: "sync boom",
        nextRetryAt: expect.any(String)
      });
      expect(new Date(persisted.sources[0].nextRetryAt).getTime() - Date.now()).toBe(2000);
      expect(vi.getTimerCount()).toBe(1);

      await service.close();
      vi.useRealTimers();
    });
  });

  it("bubbles a missing registry hook when listing registered files", async () => {
    await withTempDir(async (root) => {
      createSourceFileRegistryStoreMock.mockImplementationOnce(() => createRegistryStore({ includeListRegisteredFiles: false }));

      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        hydrationEnabled: false,
        runNow: false
      });

      await expect(service.listRegisteredFiles(created.source.sourceId)).rejects.toThrow(TypeError);
      await service.close();
    });
  });
});
