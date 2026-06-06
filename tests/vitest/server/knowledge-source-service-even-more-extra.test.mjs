import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const isSupportedImportFilePathMock = vi.hoisted(() => vi.fn());
const indexKnowledgeSourceFilesMock = vi.hoisted(() => vi.fn());
const deleteKnowledgeSourceFileIndexMock = vi.hoisted(() => vi.fn());

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

let createKnowledgeSourceService;

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-source-service-even-more-extra-"));
  try {
    await fs.mkdir(path.join(root, "metadata"), { recursive: true });
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
  loadSettingsMock.mockReset();
  isSupportedImportFilePathMock.mockReset();
  indexKnowledgeSourceFilesMock.mockReset();
  deleteKnowledgeSourceFileIndexMock.mockReset();

  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => filePath.endsWith(".txt"));
  deleteKnowledgeSourceFileIndexMock.mockResolvedValue(undefined);
});

beforeEach(async () => {
  if (!createKnowledgeSourceService) {
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
  }
});

describe("knowledge-source service even more extra coverage", () => {
  it("persists create, update, reload, and delete changes with real JSON and sqlite-backed helpers", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      const archiveDir = path.join(root, "archive");
      await fs.mkdir(docsDir);
      await fs.mkdir(archiveDir);
      await fs.writeFile(path.join(docsDir, "alpha.txt"), "alpha", "utf8");
      await fs.writeFile(path.join(archiveDir, "beta.txt"), "beta", "utf8");

      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: `job-${jobs.size + 1}`,
            status: "running",
            stage: "parse",
            progressPercent: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
            ...input
          };
          jobs.set(job.id, job);
          return job;
        })
      };

      indexKnowledgeSourceFilesMock.mockResolvedValue({
        indexedAt: "2026-01-01T00:00:00.000Z",
        snapshotHash: "docs-snapshot",
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-source-index"
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      const created = await service.createSource({
        directoryPath: `${docsDir}  `,
        label: "  Docs  ",
        enabled: "1",
        autoSync: "yes",
        recursive: "false",
        debounceMs: "299",
        hydrationEnabled: "false",
        runNow: false
      });

      expect(created.skipped).toBe(true);
      expect(created.reason).toBe("created");
      expect(created.source).toMatchObject({
        directoryPath: docsDir,
        label: "Docs",
        enabled: true,
        autoSync: true,
        recursive: false,
        hydrationEnabled: false
      });

      await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      const registered = await service.listRegisteredFiles(created.source.sourceId);
      expect(registered).toMatchObject({
        totalCount: 1,
        files: [
          {
            relativePath: "alpha.txt",
            absolutePath: path.join(docsDir, "alpha.txt"),
            extension: ".txt"
          }
        ]
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const updated = await service.updateSource(created.source.sourceId, {
        directoryPath: archiveDir,
        label: "  Archive  ",
        enabled: false,
        autoSync: false
      });

      expect(updated.source).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: archiveDir,
        label: "Archive",
        enabled: false,
        autoSync: false
      });
      expect(updated.source.updatedAt).not.toBe(created.source.updatedAt);

      const cleared = await service.listRegisteredFiles(created.source.sourceId);
      expect(cleared).toMatchObject({
        totalCount: 0,
        files: []
      });

      const persisted = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(persisted.sources).toHaveLength(1);
      expect(persisted.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: archiveDir,
        label: "Archive",
        enabled: false,
        autoSync: false
      });

      await service.close();

      const reopened = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
          createJob: vi.fn()
        },
        watchingEnabled: false
      });

      expect(await reopened.listSources()).toMatchObject({
        summary: {
          totalCount: 1,
          enabledCount: 0,
          watchingCount: 0,
          syncingCount: 1,
          indexingCount: 0,
          errorCount: 0
        },
        sources: [
          expect.objectContaining({
            sourceId: created.source.sourceId,
            directoryPath: archiveDir,
            label: "Archive",
            enabled: false
          })
        ]
      });

      const deleted = await reopened.deleteSource(created.source.sourceId);
      expect(deleted.deletedSource).toMatchObject({
        sourceId: created.source.sourceId,
        directoryPath: archiveDir
      });
      expect(deleteKnowledgeSourceFileIndexMock).toHaveBeenCalledWith({
        userDataPath: root,
        sourceId: created.source.sourceId
      });

      const afterDelete = await readJson(path.join(root, "knowledge-sources", "sources.json"));
      expect(afterDelete.sources).toEqual([]);

      await reopened.close();
    });
  });

  it("reuses unchanged sync snapshots, paginates registry files, and surfaces index failures", async () => {
    await withTempDir(async (root) => {
      const docsDir = path.join(root, "docs");
      await fs.mkdir(docsDir);
      await fs.writeFile(path.join(docsDir, "a.txt"), "alpha", "utf8");
      await fs.writeFile(path.join(docsDir, "b.txt"), "beta", "utf8");

      const manifestHash = await manifestHashForFiles(docsDir, ["a.txt", "b.txt"]);
      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: `job-${jobs.size + 1}`,
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

      indexKnowledgeSourceFilesMock.mockResolvedValue({
        indexedAt: "2026-01-02T00:00:00.000Z",
        snapshotHash: manifestHash,
        indexedCount: 2,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-source-index"
      });

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

      const firstSync = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(firstSync.registry).toMatchObject({
        fileCount: 2,
        addedCount: 2,
        changedCount: 0,
        removedCount: 0
      });
      expect(firstSync.index).toMatchObject({
        indexedCount: 2,
        snapshotHash: manifestHash
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      const secondPage = await service.listRegisteredFiles(created.source.sourceId, { limit: 1, offset: 1 });
      expect(secondPage).toMatchObject({
        totalCount: 2,
        files: [
          {
            relativePath: "b.txt",
            absolutePath: path.join(docsDir, "b.txt"),
            extension: ".txt"
          }
        ]
      });

      const unchanged = await service.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(unchanged.reason).toBe("unchanged");
      expect(unchanged.index).toBeNull();
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      await service.close();

      const reopened = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
          createJob: jobManager.createJob
        },
        watchingEnabled: false
      });

      const reopenedFiles = await reopened.listRegisteredFiles(created.source.sourceId);
      expect(reopenedFiles).toMatchObject({
        totalCount: 2,
        files: [
          {
            relativePath: "a.txt",
            absolutePath: path.join(docsDir, "a.txt"),
            extension: ".txt"
          },
          {
            relativePath: "b.txt",
            absolutePath: path.join(docsDir, "b.txt"),
            extension: ".txt"
          }
        ]
      });

      await fs.writeFile(path.join(docsDir, "b.txt"), "beta updated", "utf8");
      indexKnowledgeSourceFilesMock.mockRejectedValueOnce(new Error("index boom"));

      const failed = await reopened.refreshSource(created.source.sourceId, { reason: "manual" });
      expect(failed.index).toMatchObject({
        error: "index boom",
        sourceId: created.source.sourceId,
        indexedCount: 0,
        failedCount: 1
      });
      expect(failed.source).toMatchObject({
        indexStatus: "failed",
        lastIndexError: "index boom"
      });

      const snapshot = await reopened.listSources();
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        indexStatus: "failed",
        lastIndexError: "index boom"
      });
      expect(jobManager.createJob).toHaveBeenCalledTimes(2);

      await reopened.close();
    });
  });

  it("marks a source error when the configured path is not a directory", async () => {
    await withTempDir(async (root) => {
      const filePath = path.join(root, "not-a-directory.txt");
      await fs.writeFile(filePath, "hello", "utf8");

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
        directoryPath: filePath,
        label: "File-backed",
        autoSync: false,
        hydrationEnabled: false,
        runNow: false
      });

      await expect(service.refreshSource(created.source.sourceId, { reason: "manual" })).rejects.toThrow();

      const snapshot = await service.listSources();
      expect(snapshot.sources[0]).toMatchObject({
        sourceId: created.source.sourceId,
        status: "error",
        syncRetryAttempt: 1,
        nextRetryAt: expect.any(String),
        error: expect.any(String)
      });

      await service.close();
    });
  });

  it("covers missing source API boundaries, refreshAll disabled skips, and external watcher state", async () => {
    await withTempDir(async (root) => {
      const enabledDir = path.join(root, "enabled");
      const disabledDir = path.join(root, "disabled");
      await fs.mkdir(enabledDir);
      await fs.mkdir(disabledDir);
      await fs.writeFile(path.join(enabledDir, "alpha.txt"), "alpha", "utf8");
      await fs.writeFile(path.join(disabledDir, "beta.txt"), "beta", "utf8");

      const jobs = new Map();
      const jobManager = {
        getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
        createJob: vi.fn(async (input) => {
          const job = {
            id: `job-${jobs.size + 1}`,
            status: "queued",
            stage: "queued",
            progressPercent: 0,
            updatedAt: "2026-01-03T00:00:00.000Z",
            ...input
          };
          jobs.set(job.id, job);
          return job;
        })
      };

      indexKnowledgeSourceFilesMock.mockResolvedValue({
        indexedAt: "2026-01-03T00:00:00.000Z",
        snapshotHash: "refresh-all-index",
        indexedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        checkpointTreeId: "checkpoint-refresh-all"
      });

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager,
        watchingEnabled: false
      });

      expect(await service.updateSource("missing-source", { label: "Missing" })).toBeNull();
      expect(await service.deleteSource("missing-source")).toBeNull();
      expect(await service.listRegisteredFiles("missing-source")).toBeNull();
      await expect(service.refreshSource("missing-source")).rejects.toThrow(/不存在/);

      const enabled = await service.createSource({
        directoryPath: enabledDir,
        label: "Enabled",
        hydrationEnabled: false,
        runNow: false
      });
      const disabled = await service.createSource({
        directoryPath: disabledDir,
        label: "Disabled",
        enabled: false,
        autoSync: true,
        hydrationEnabled: false,
        runNow: false
      });

      expect(enabled.source).toMatchObject({
        watcherStatus: "external",
        watcherCount: 0
      });
      expect(disabled.source).toMatchObject({
        watcherStatus: "external",
        watcherCount: 0
      });

      const refreshed = await service.refreshAll({ reason: "manual-all" });
      expect(refreshed.results).toHaveLength(1);
      expect(refreshed.results[0].source.sourceId).toBe(enabled.source.sourceId);
      expect(jobManager.createJob).toHaveBeenCalledTimes(1);
      expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);

      await service.close();
    });
  });

  it("surfaces malformed persisted source configuration during startup", async () => {
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

      await expect(service.listSources()).rejects.toThrow();
      await service.close();
    });
  });
});
