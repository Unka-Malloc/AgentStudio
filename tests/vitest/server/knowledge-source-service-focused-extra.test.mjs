import { createHash } from "node:crypto";
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-focused-extra-"));
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

async function manifestHashForFiles(root, relativePaths) {
  const files = [];
  for (const relativePath of relativePaths) {
    const stats = await fs.stat(path.join(root, relativePath));
    files.push({
      relativePath,
      byteSize: Number(stats.size || 0),
      mtimeMs: Math.floor(stats.mtimeMs)
    });
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
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
  isSupportedImportFilePathMock.mockImplementation((filePath) => filePath.endsWith(".txt") || filePath.endsWith(".md"));
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

describe("knowledge-source service focused extra coverage", () => {
  it("hydrates placeholder files with replace-mode rules, reuses staged files, and respects non-recursive scans", async () => {
    await withTempDir(async (root) => {
      await writeJson(path.join(root, "knowledge-sources", "source-hydration.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        placeholderExtensionsMode: "replace",
        placeholderTextSignaturesMode: "replace",
        placeholderExtensions: [".cloud"],
        placeholderTextSignatures: [
          {
            id: "invalid",
            pattern: "["
          },
          {
            id: "custom-md",
            pattern: "^HYDRATE-ME$",
            flags: "m",
            extensions: [".md"]
          }
        ]
      });

      const hydratedDir = path.join(root, "hydrated-source");
      const recursiveDir = path.join(root, "recursive-source");
      await fs.mkdir(path.join(hydratedDir, "nested", "node_modules"), { recursive: true });
      await fs.mkdir(path.join(recursiveDir, "nested"), { recursive: true });

      await fs.writeFile(path.join(hydratedDir, "readable.txt"), "plain text", "utf8");
      await fs.writeFile(path.join(hydratedDir, "cloud-note.cloud"), "cloud placeholder", "utf8");
      await fs.writeFile(path.join(hydratedDir, "notes.md"), "HYDRATE-ME", "utf8");
      await fs.writeFile(path.join(hydratedDir, "skip.gdoc"), "should not be scanned", "utf8");
      await fs.writeFile(path.join(hydratedDir, "nested", "keep.txt"), "nested text", "utf8");
      await fs.writeFile(path.join(hydratedDir, "nested", "node_modules", "ignored.txt"), "ignored", "utf8");

      await fs.writeFile(path.join(recursiveDir, "top.txt"), "top level", "utf8");
      await fs.writeFile(path.join(recursiveDir, "nested", "hidden.txt"), "hidden", "utf8");

      const jobs = [];
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.find((job) => job.id === jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: `job-${jobs.length + 1}`,
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: `2026-01-01T00:00:0${jobs.length + 1}.000Z`,
            ...input
          };
          jobs.push(job);
          return job;
        })
      };
      indexKnowledgeSourceFilesMock.mockResolvedValue({
        indexedAt: "2026-01-01T00:00:00.000Z",
        snapshotHash: "hydrated-index",
        indexedCount: 4,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-source-index"
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const createdHydrated = await service.createSource({
        directoryPath: hydratedDir,
        label: "Hydrated",
        autoSync: false,
        hydrationEnabled: true,
        hydrationCommand: process.execPath,
        hydrationArgs: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'hydrated:' + process.argv[2])",
          "{{targetPath}}",
          "{{relativePath}}"
        ],
        runNow: false
      });

      const firstRefresh = await service.refreshSource(createdHydrated.source.sourceId, { reason: "manual" });
      expect(firstRefresh.registry).toMatchObject({
        fileCount: 4,
        addedCount: 4,
        changedCount: 0,
        removedCount: 0
      });
      expect(firstRefresh.source).toMatchObject({
        lastHydrationStatus: "hydrated",
        lastHydratedFileCount: 4,
        lastHydrationFailedCount: 0,
        lastHydrationSkippedCount: 0
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      const firstJobInput = jobManager.createJob.mock.calls[0][0];
      expect(firstJobInput.fileManifestPath).toEqual(expect.any(String));
      expect(firstJobInput.checkpointReceipt.hydration).toMatchObject({
        enabled: true,
        policy: "auto",
        commandHydratedCount: 2,
        reusedHydratedCount: 0,
        failedCount: 0,
        skippedCount: 0
      });
      expect(firstJobInput.checkpointReceipt.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: "cloud-note.cloud", hydrationStatus: "hydrated" }),
          expect.objectContaining({ relativePath: "notes.md", hydrationStatus: "hydrated" }),
          expect.objectContaining({ relativePath: "readable.txt", hydrationStatus: "readable" }),
          expect.objectContaining({ relativePath: "nested/keep.txt", hydrationStatus: "readable" })
        ])
      );

      const stageRoot = path.join(
        root,
        "knowledge-sources",
        "hydrated",
        createdHydrated.source.sourceId,
        await manifestHashForFiles(hydratedDir, [
          "cloud-note.cloud",
          "nested/keep.txt",
          "notes.md",
          "readable.txt"
        ])
      );
      const manifest = await readJson(path.join(stageRoot, "file-manifest.json"));
      expect(manifest.hydration).toMatchObject({
        enabled: true,
        policy: "auto",
        commandHydratedCount: 2,
        reusedHydratedCount: 0,
        failedCount: 0,
        skippedCount: 0
      });
      expect(manifest.files.map((file) => file.relativePath)).toEqual([
        "cloud-note.cloud",
        "nested/keep.txt",
        "notes.md",
        "readable.txt"
      ]);

      const secondRefresh = await service.refreshSource(createdHydrated.source.sourceId, {
        reason: "manual",
        force: true
      });
      expect(secondRefresh.registry.fileCount).toBe(4);
      expect(jobManager.createJob).toHaveBeenCalledTimes(2);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(2);

      const secondJobInput = jobManager.createJob.mock.calls[1][0];
      expect(secondJobInput.checkpointReceipt.hydration).toMatchObject({
        commandHydratedCount: 0,
        reusedHydratedCount: 2,
        failedCount: 0,
        skippedCount: 0
      });

      const createdRecursive = await service.createSource({
        directoryPath: recursiveDir,
        label: "Recursive",
        autoSync: false,
        recursive: false,
        hydrationEnabled: false,
        runNow: false
      });
      const recursiveRefresh = await service.refreshSource(createdRecursive.source.sourceId, { reason: "manual" });
      expect(recursiveRefresh.registry).toMatchObject({
        fileCount: 1,
        addedCount: 1,
        changedCount: 0,
        removedCount: 0
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(3);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(3);
      expect(jobManager.createJob.mock.calls[2][0].checkpointReceipt.files).toEqual(
        [
          expect.objectContaining({
            relativePath: "top.txt",
            hydrationStatus: "readable"
          })
        ]
      );

      const recursiveFiles = await service.listRegisteredFiles(createdRecursive.source.sourceId);
      expect(recursiveFiles.files.map((file) => file.relativePath)).toEqual(["top.txt"]);
      expect(await service.listRegisteredFiles("missing-source")).toBeNull();

      await service.close();
    });
  });

  it("records hydration failures, removes temporary output, and skips parse job creation", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(path.join(docsDir, "broken.cloud"), "broken cloud placeholder", "utf8");

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
        label: "Broken",
        autoSync: false,
        hydrationEnabled: true,
        hydrationCommand: process.execPath,
        hydrationArgs: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], '')",
          "{{targetPath}}"
        ],
        runNow: false
      });

      const result = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(result).toMatchObject({
        skipped: true,
        reason: "hydration_empty",
        source: expect.objectContaining({
          sourceId: created.source.sourceId,
          error: "可解析文件都需要先完成云端文件自动下载。"
        })
      });
      expect(jobManager.createJob).not.toHaveBeenCalled();
      expect(indexKnowledgeSourceFilesMock).not.toHaveBeenCalled();

      const sourceIdHash = createHash("sha256").update(path.resolve(docsDir)).digest("hex");
      const stageRoot = path.join(root, "knowledge-sources", "hydrated", `ks_${sourceIdHash}`, await manifestHashForFiles(docsDir, ["broken.cloud"]));
      const filesDir = path.join(stageRoot, "files");
      await expect(fs.readdir(filesDir)).resolves.toEqual([]);

      const manifest = await readJson(path.join(stageRoot, "file-manifest.json"));
      expect(manifest.hydration).toMatchObject({
        enabled: true,
        failedCount: 1,
        skippedCount: 1
      });
      expect(manifest.hydration.failures[0]).toMatchObject({
        relativePath: "broken.cloud",
        reason: "自动下载命令未生成可读文件。"
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
        lastHydrationStatus: "partial",
        lastHydrationFailedCount: 1,
        lastHydrationSkippedCount: 1,
        lastHydrationFailureSamples: [
          expect.objectContaining({
            relativePath: "broken.cloud",
            reason: "自动下载命令未生成可读文件。"
          })
        ]
      });

      await service.close();
    });
  });

  it("records non-zero hydration command stderr without creating a parse job", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(path.join(docsDir, "remote.cloud"), "placeholder", "utf8");

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
        label: "Command failure",
        autoSync: false,
        hydrationEnabled: true,
        hydrationCommand: process.execPath,
        hydrationArgs: [
          "-e",
          "process.stderr.write('x'.repeat(5000)); process.exit(7)"
        ],
        runNow: false
      });

      const result = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(result).toMatchObject({
        skipped: true,
        reason: "hydration_empty",
        source: expect.objectContaining({
          sourceId: created.source.sourceId,
          lastHydrationStatus: "partial",
          lastHydrationFailedCount: 1,
          lastHydrationSkippedCount: 1
        })
      });
      expect(jobManager.createJob).not.toHaveBeenCalled();

      const sourceIdHash = createHash("sha256").update(path.resolve(docsDir)).digest("hex");
      const stageRoot = path.join(
        root,
        "knowledge-sources",
        "hydrated",
        `ks_${sourceIdHash}`,
        await manifestHashForFiles(docsDir, ["remote.cloud"])
      );
      const manifest = await readJson(path.join(stageRoot, "file-manifest.json"));
      expect(manifest.hydration.failures[0]).toMatchObject({
        relativePath: "remote.cloud"
      });
      expect(manifest.hydration.failures[0].reason).toContain("hydrationCommand 退出码 7");
      expect(manifest.hydration.failures[0].reason.length).toBeLessThan(4200);

      await service.close();
    });
  });

  it("reconciles watcher state and clears retry timers during shutdown", async () => {
    await withTempDir(async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));

      try {
        const docsDir = path.join(root, "watched");
        await fs.mkdir(docsDir, { recursive: true });
        await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");

        const jobManager = {
          getJob: vi.fn(async () => null),
          createJob: vi.fn(async () => {
            throw new Error("sync boom");
          })
        };
        const service = createKnowledgeSourceService({
          userDataPath: root,
          jobManager,
          watchingEnabled: true
        });

        const created = await service.createSource({
          directoryPath: docsDir,
          label: "Watched",
          autoSync: true,
          hydrationEnabled: false,
          runNow: false
        });

        const reconciled = await service.reconcileWatchers();
        expect(reconciled.sources[0]).toMatchObject({
          sourceId: created.source.sourceId,
          watcherStatus: "watching",
          watcherCount: 1
        });

        await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow("sync boom");
        expect(vi.getTimerCount()).toBe(1);

        await service.close();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
