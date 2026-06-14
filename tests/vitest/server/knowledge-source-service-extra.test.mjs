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

function fingerprintOf(file) {
  return `${Number(file.byteSize || 0)}:${Number(file.mtimeMs || 0)}`;
}

function createRegistryStore() {
  const fingerprintBySource = new Map();
  const registryFilesBySource = new Map();
  const registrySourcesById = new Map();

  return {
    listBySource: vi.fn((sourceId) => new Map(fingerprintBySource.get(sourceId) || [])),
    applyDelta: vi.fn(({ sourceId, files = [], removedPaths = [] }) => {
      const next = new Map(fingerprintBySource.get(sourceId) || []);
      for (const file of files) {
        next.set(file.relativePath, {
          relativePath: file.relativePath,
          byteSize: Number(file.byteSize || 0),
          mtimeMs: Number(file.mtimeMs || 0),
          fingerprint: fingerprintOf(file)
        });
      }
      for (const relativePath of removedPaths) {
        next.delete(relativePath);
      }
      fingerprintBySource.set(sourceId, next);
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
          fingerprint: fingerprintOf(file),
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
      fingerprintBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    removeRegistrySource: vi.fn((sourceId) => {
      registrySourcesById.delete(sourceId);
      fingerprintBySource.delete(sourceId);
      registryFilesBySource.delete(sourceId);
    }),
    countRegisteredFiles: vi.fn((sourceId) => {
      const registryFiles = registryFilesBySource.get(sourceId);
      if (registryFiles) {
        return registryFiles.size;
      }
      return (fingerprintBySource.get(sourceId) || new Map()).size;
    }),
    listRegisteredFiles: vi.fn((sourceId) => {
      const registryFiles = registryFilesBySource.get(sourceId);
      if (registryFiles) {
        return [...registryFiles.values()];
      }
      const source = registrySourcesById.get(sourceId);
      const directoryPath = source?.directoryPath || "";
      return [...(fingerprintBySource.get(sourceId) || new Map()).values()].map((file) => ({
        sourceId,
        relativePath: file.relativePath,
        absolutePath: directoryPath ? path.join(directoryPath, file.relativePath) : file.relativePath,
        extension: path.extname(file.relativePath).toLowerCase(),
        byteSize: Number(file.byteSize || 0),
        mtimeMs: Number(file.mtimeMs || 0),
        fingerprint: file.fingerprint,
        lastScanId: ""
      }));
    }),
    close: vi.fn()
  };
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
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

beforeEach(async () => {
  if (!createKnowledgeSourceService) {
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
  }
});

describe("knowledge-source service extra coverage", () => {
  it("loads persisted sources with normalization, sorting, summary counts, and public job metadata", async () => {
    await withTempDir(async (root) => {
      const sourcesPath = path.join(root, "knowledge-sources", "sources.json");
      await writeJson(sourcesPath, {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-b",
            directoryPath: path.join(root, "beta"),
            label: "Beta",
            enabled: "yes",
            autoSync: "no",
            recursive: "0",
            debounceMs: "49",
            hydrationEnabled: "false",
            hydrationTimeoutMs: "500",
            hydrationArgs: ["  --beta  "],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            lastJobId: "job-1"
          },
          {
            sourceId: "source-a",
            directoryPath: path.join(root, "alpha"),
            label: "Alpha",
            enabled: false,
            autoSync: true,
            recursive: true,
            debounceMs: 1800,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-03T00:00:00.000Z"
          }
        ]
      });

      const jobs = new Map([
        ["job-1", {
          id: "job-1",
          status: "running",
          stage: "parsing",
          progressPercent: 67,
          updatedAt: "2026-01-03T00:00:00.000Z"
        }]
      ]);
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn()
      };

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const snapshot = await service.listSources();

      expect(snapshot.sources.map((item) => item.sourceId)).toEqual(["source-a", "source-b"]);
      expect(snapshot.summary).toEqual({
        totalCount: 2,
        enabledCount: 1,
        watchingCount: 0,
        syncingCount: 1,
        indexingCount: 0,
        errorCount: 0
      });
      const sourceB = snapshot.sources.find((item) => item.sourceId === "source-b");
      expect(sourceB).toMatchObject({
        sourceId: "source-b",
        directoryPath: path.join(root, "beta"),
        enabled: true,
        autoSync: false,
        recursive: false,
        debounceMs: 300,
        hydrationEnabled: false,
        hydrationTimeoutMs: 1000,
        hydrationArgs: ["--beta"],
        lastJobStatus: "running",
        lastJobStage: "parsing",
        lastJobProgressPercent: 67,
        lastJobUpdatedAt: "2026-01-03T00:00:00.000Z"
      });
      expect(jobManager.getJob).toHaveBeenCalledWith("job-1");

      await service.close();
    });
  });

  it("normalizes createSource input, persists CRUD changes, and survives a reload", async () => {
    await withTempDir(async (root) => {
      const jobManager = {
        getJob: vi.fn(async () => null),
        createJob: vi.fn()
      };
      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const docsDir = path.join(root, "docs");
      const archiveDir = path.join(root, "archive");
      await fs.mkdir(docsDir);
      await fs.mkdir(archiveDir);

      const created = await service.createSource({
        directoryPath: `${docsDir}  `,
        label: "  Knowledge Docs  ",
        enabled: "1",
        autoSync: "yes",
        recursive: "false",
        debounceMs: "12",
        hydrationEnabled: "no",
        hydrationTimeoutMs: "250",
        hydrationArgs: ["  --source={{sourcePath}}  ", ""],
        runNow: false
      });

      expect(created.skipped).toBe(true);
      expect(created.reason).toBe("created");
      expect(created.source).toMatchObject({
        directoryPath: docsDir,
        label: "Knowledge Docs",
        enabled: true,
        autoSync: true,
        recursive: false,
        debounceMs: 300,
        hydrationEnabled: false,
        hydrationTimeoutMs: 1000,
        hydrationArgs: ["--source={{sourcePath}}"],
        watcherStatus: "external",
        watcherCount: 0
      });

      const config = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(config.sources).toHaveLength(1);
      expect(config.sources[0]).toMatchObject({
        directoryPath: docsDir,
        label: "Knowledge Docs",
        enabled: true,
        autoSync: true,
        recursive: false
      });

      const registryStore = createSourceFileRegistryStoreMock.mock.results[0].value;
      const updated = await service.updateSource(created.source.sourceId, {
        directoryPath: archiveDir,
        label: "  Knowledge Archive  ",
        enabled: false,
        autoSync: false,
        recursive: false,
        debounceMs: "450",
        hydrationEnabled: "false"
      });

      expect(updated.source).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: archiveDir,
        label: "Knowledge Archive",
        enabled: false,
        autoSync: false,
        recursive: false,
        debounceMs: 450,
        hydrationEnabled: false
      });
      expect(registryStore.recordPathAlias).toHaveBeenCalledWith({
        sourceId: created.source.sourceId,
        aliasDirectoryPath: docsDir,
        canonicalDirectoryPath: archiveDir
      });
      expect(registryStore.clearSourceFiles).toHaveBeenCalledWith(created.source.sourceId);

      const updatedConfig = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(updatedConfig.sources[0]).toMatchObject({
        directoryPath: archiveDir,
        label: "Knowledge Archive",
        enabled: false,
        autoSync: false,
        recursive: false
      });

      const duplicate = await service.createSource({
        directoryPath: archiveDir,
        label: "Should be deduped",
        runNow: false
      });

      expect(duplicate.duplicateOf).toBe(created.source.sourceId);
      expect(duplicate.reason).toBe("already_exists");
      expect(duplicate.state.sources).toHaveLength(1);

      const deleted = await service.deleteSource(created.source.sourceId);
      expect(deleted.deletedSource).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: archiveDir
      });
      expect(deleteKnowledgeSourceFileIndexMock).toHaveBeenCalledWith({
        userDataPath: root,
        sourceId: created.source.sourceId
      });
      expect(deleteCheckpointTreeMock).toHaveBeenCalledWith({
        userDataPath: root,
        treeId: `knowledge-source-sync:${created.source.sourceId}`
      });
      const afterDeleteConfig = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(afterDeleteConfig.sources).toEqual([]);

      const reopenedService = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });
      expect(await reopenedService.listSources()).toMatchObject({
        summary: {
          totalCount: 0,
          enabledCount: 0,
          watchingCount: 0,
          syncingCount: 0,
          indexingCount: 0,
          errorCount: 0
        },
        sources: []
      });
      await reopenedService.close();

      await expect(service.createSource({ label: "Missing directory" })).rejects.toThrow("请填写服务端可访问的本地目录路径。");

      await service.close();
    });
  });

  it("refreshes all enabled sources, skips disabled ones, and lists registered files", async () => {
    await withTempDir(async (root) => {
      const alphaDir = path.join(root, "alpha");
      const betaDir = path.join(root, "beta");
      const disabledDir = path.join(root, "disabled");
      await fs.mkdir(alphaDir);
      await fs.mkdir(betaDir);
      await fs.mkdir(disabledDir);
      await fs.writeFile(path.join(alphaDir, "book.txt"), "hello alpha", "utf8");
      await fs.writeFile(path.join(betaDir, "note.txt"), "hello beta", "utf8");

      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: `job-${jobs.size + 1}`,
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-04T00:00:00.000Z",
            ...input
          };
          jobs.set(job.id, job);
          return job;
        })
      };

      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
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
          },
          {
            sourceId: "source-disabled",
            directoryPath: disabledDir,
            label: "Disabled",
            enabled: false,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-03T00:00:00.000Z"
          }
        ]
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const refreshed = await service.refreshAll({ reason: "batch" });
      expect(refreshed.results).toHaveLength(2);
      expect(refreshed.results.map((item) => item.source.sourceId)).toEqual(["source-alpha", "source-beta"]);
      expect(jobManager.createJob).toHaveBeenCalledTimes(2);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(2);

      const alphaFiles = await service.listRegisteredFiles("source-alpha");
      expect(alphaFiles).toMatchObject({
        totalCount: 1,
        source: expect.objectContaining({
          sourceId: "source-alpha",
          directoryPath: alphaDir
        })
      });
      expect(alphaFiles.files).toHaveLength(1);
      expect(alphaFiles.files[0]).toMatchObject({
        relativePath: "book.txt",
        absolutePath: path.join(alphaDir, "book.txt"),
        extension: ".txt"
      });

      const snapshot = await service.listSources();
      const current = snapshot.sources.find((item) => item.sourceId === "source-alpha");
      expect(current).toMatchObject({
        status: "syncing",
        error: "",
        lastFileCount: 1,
        lastJobStatus: "running",
        indexStatus: "indexed",
        lastIndexError: ""
      });
      expect(snapshot.summary).toMatchObject({
        totalCount: 3,
        enabledCount: 2,
        watchingCount: 0,
        syncingCount: 2,
        indexingCount: 0,
        errorCount: 0
      });

      await service.close();
    });
  });

  it("returns null for missing sources and rejects refreshes for missing or invalid paths", async () => {
    await withTempDir(async (root) => {
      const missingDir = path.join(root, "missing");
      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-01-05T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-missing",
            directoryPath: missingDir,
            label: "Missing",
            enabled: true,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-05T00:00:00.000Z",
            updatedAt: "2026-01-05T00:00:00.000Z"
          }
        ]
      });

      const jobManager = {
        getJob: vi.fn(async () => null),
        createJob: vi.fn()
      };
      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      expect(await service.updateSource("missing-source", { label: "Nope" })).toBeNull();
      expect(await service.deleteSource("missing-source")).toBeNull();
      expect(await service.listRegisteredFiles("missing-source")).toBeNull();

      await expect(service.refreshSource("missing-source")).rejects.toThrow("知识库目录不存在。");
      await expect(service.refreshSource("source-missing", { reason: "manual" })).rejects.toThrow();

      const snapshot = await service.listSources();
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: "source-missing",
        status: "error",
        error: expect.any(String),
        syncRetryAttempt: 1,
        nextRetryAt: expect.any(String)
      });

      await service.close();
    });
  });
});
