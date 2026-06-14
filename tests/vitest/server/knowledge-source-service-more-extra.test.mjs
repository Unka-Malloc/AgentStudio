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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-more-extra-"));
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

describe("knowledge-source service more extra coverage", () => {
  it("lists registered files, skips empty refreshes, and rejects disabled refreshes", async () => {
    await withTempDir(async (root) => {
      const emptyDir = path.join(root, "empty");
      const disabledDir = path.join(root, "disabled");
      await fs.mkdir(emptyDir);
      await fs.mkdir(disabledDir);

      await writeJson(path.join(root, "knowledge-sources", "sources.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-empty",
            directoryPath: emptyDir,
            label: "Empty",
            enabled: true,
            autoSync: false,
            recursive: true,
            hydrationEnabled: false,
            debounceMs: 300,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
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
            updatedAt: "2026-01-01T00:00:00.000Z"
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

      const registryStore = createSourceFileRegistryStoreMock.mock.results[0].value;
      registryStore.syncRegistryFiles(
        { sourceId: "source-empty", directoryPath: emptyDir },
        "scan-1",
        [
          {
            relativePath: "note.txt",
            byteSize: 5,
            mtimeMs: 1700000000000
          }
        ],
        []
      );

      const listed = await service.listRegisteredFiles("source-empty");
      expect(listed).toMatchObject({
        totalCount: 1,
        source: expect.objectContaining({
          sourceId: "source-empty",
          directoryPath: emptyDir
        })
      });
      expect(listed.files).toHaveLength(1);
      expect(listed.files[0]).toMatchObject({
        relativePath: "note.txt",
        absolutePath: path.join(emptyDir, "note.txt"),
        extension: ".txt"
      });
      expect(await service.listRegisteredFiles("missing-source")).toBeNull();

      await expect(service.refreshSource("source-empty", { reason: "manual" })).resolves.toMatchObject({
        skipped: true,
        reason: "empty",
        source: expect.objectContaining({
          sourceId: "source-empty",
          status: "idle",
          error: ""
        })
      });
      await expect(service.refreshSource("source-disabled")).rejects.toThrow("知识库目录已停用。");

      const snapshot = await service.listSources();
      expect(snapshot.sources.find((item) => item.sourceId === "source-empty")).toMatchObject({
        status: "idle",
        error: "",
        lastFileCount: 0,
        lastSnapshotHash: expect.any(String)
      });
      expect(jobManager.createJob).not.toHaveBeenCalled();

      await service.close();
    });
  });

  it("creates duplicate sources with runNow sync, then lists the synced registry files", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "book.txt"), "hello world", "utf8");

      const jobManager = {
        getJob: vi.fn(async () => null),
        createJob: vi.fn(async (input) => ({
          id: "job-1",
          status: "running",
          stage: "parse",
          progressPercent: 0,
          updatedAt: "2026-01-02T00:00:00.000Z",
          checkpointTreeId: "job-tree",
          ...input
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
      expect(created.skipped).toBe(true);
      expect(created.reason).toBe("created");

      const duplicate = await service.createSource({
        directoryPath: docsDir,
        label: "Docs duplicate",
        runNow: true
      });

      expect(duplicate.duplicateOf).toBe(created.source.sourceId);
      expect(duplicate.job).toMatchObject({
        id: "job-1",
        status: "running",
        stage: "parse"
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);
      expect(deleteKnowledgeSourceFileIndexMock).not.toHaveBeenCalled();

      const listed = await service.listRegisteredFiles(created.source.sourceId);
      expect(listed).toMatchObject({
        totalCount: 1,
        source: expect.objectContaining({
          sourceId: created.source.sourceId,
          directoryPath: docsDir
        })
      });
      expect(listed.files[0]).toMatchObject({
        relativePath: "book.txt",
        absolutePath: path.join(docsDir, "book.txt"),
        extension: ".txt"
      });

      const config = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(config.sources).toHaveLength(1);
      expect(config.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: docsDir,
        label: "Docs duplicate"
      });

      const snapshot = await service.listSources();
      expect(snapshot.summary).toMatchObject({
        totalCount: 1,
        enabledCount: 1,
        syncingCount: 1,
        errorCount: 0
      });

      await service.close();
    });
  });

  it("updates a source without changing directoryPath and leaves alias bookkeeping untouched", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);

      const jobManager = {
        getJob: vi.fn(async () => null),
        createJob: vi.fn()
      };
      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: docsDir,
        label: "Docs",
        runNow: false
      });

      const registryStore = createSourceFileRegistryStoreMock.mock.results[0].value;
      const updated = await service.updateSource(created.source.sourceId, {
        label: "Docs renamed",
        debounceMs: "450",
        recursive: "false"
      });

      expect(updated.source).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: docsDir,
        label: "Docs renamed",
        debounceMs: 450,
        recursive: false
      });
      expect(registryStore.recordPathAlias).not.toHaveBeenCalled();
      expect(registryStore.clearSourceFiles).not.toHaveBeenCalled();

      const config = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(config.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: docsDir,
        label: "Docs renamed",
        debounceMs: 450,
        recursive: false
      });

      await service.close();
    });
  });
});
