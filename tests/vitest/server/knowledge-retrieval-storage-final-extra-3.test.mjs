import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn((command, args, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    queueMicrotask(() => cb(null, { stdout: "", stderr: "" }));
  })
);

const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: 1
  }))
);

const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());
const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());

const createSourceFileRegistryStoreMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const isSupportedImportFilePathMock = vi.hoisted(() => vi.fn());
const indexKnowledgeSourceFilesMock = vi.hoisted(() => vi.fn());
const deleteKnowledgeSourceFileIndexMock = vi.hoisted(() => vi.fn());
const checkpointTreeIdMock = vi.hoisted(() => vi.fn());
const deleteCheckpointTreeMock = vi.hoisted(() => vi.fn());
const finishCheckpointTreeMock = vi.hoisted(() => vi.fn());
const startCheckpointTreeMock = vi.hoisted(() => vi.fn());
const upsertCheckpointNodeMock = vi.hoisted(() => vi.fn());
const serverTokenMock = vi.hoisted(() => vi.fn());
const atomicWriteJsonMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawnSync: spawnSyncMock
}));

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  isSupportedImportFilePath: isSupportedImportFilePathMock
}));

vi.mock("../../../server/platform/common/data-structure/checkpoint-tree-store.mjs", () => ({
  checkpointTreeId: checkpointTreeIdMock,
  deleteCheckpointTree: deleteCheckpointTreeMock,
  finishCheckpointTree: finishCheckpointTreeMock,
  startCheckpointTree: startCheckpointTreeMock,
  upsertCheckpointNode: upsertCheckpointNodeMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
  );
  return {
    ...actual,
    indexedCandidateFilesForRoot: indexedCandidateFilesForRootMock,
    getIndexedSourceFileByEvidenceId: getIndexedSourceFileByEvidenceIdMock
  };
});

vi.mock("../../../server/platform/common/security/client-strings.mjs", () => ({
  serverToken: serverTokenMock
}));

vi.mock("../../../server/platform/common/platform-core/state-coordinator.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/common/platform-core/state-coordinator.mjs"
  );
  return {
    ...actual,
    atomicWriteJson: atomicWriteJsonMock
  };
});

let getSourceFileEvidence;
let searchSourceFiles;
let sourceEvidenceIdForPath;
let createLocalVectorStore;
let createKnowledgeSourceService;

const tempRoots = [];

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return callback(root);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function eml({ subject, body, from = "sender@example.test" }) {
  return [
    `From: ${from}`,
    "To: recipient@example.test",
    `Subject: ${subject}`,
    "Date: Fri, 05 Jun 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");
}

beforeAll(async () => {
  ({
    getSourceFileEvidence,
    searchSourceFiles
  } = await import("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs"));
  ({ sourceEvidenceIdForPath } = await import(
    "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
  ));
  ({ createLocalVectorStore } = await import(
    "../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs"
  ));
  ({ createKnowledgeSourceService } = await import(
    "../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"
  ));
});

beforeEach(() => {
  execFileMock.mockClear();
  spawnSyncMock.mockClear();
  indexedCandidateFilesForRootMock.mockReset();
  getIndexedSourceFileByEvidenceIdMock.mockReset();
  createSourceFileRegistryStoreMock.mockReset();
  loadSettingsMock.mockReset();
  isSupportedImportFilePathMock.mockReset();
  indexKnowledgeSourceFilesMock.mockReset();
  deleteKnowledgeSourceFileIndexMock.mockReset();
  checkpointTreeIdMock.mockReset();
  deleteCheckpointTreeMock.mockReset();
  finishCheckpointTreeMock.mockReset();
  startCheckpointTreeMock.mockReset();
  upsertCheckpointNodeMock.mockReset();
  serverTokenMock.mockReset();
  atomicWriteJsonMock.mockReset();

  indexedCandidateFilesForRootMock.mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
  getIndexedSourceFileByEvidenceIdMock.mockResolvedValue(null);
  createSourceFileRegistryStoreMock.mockImplementation(() => ({
    listBySource: vi.fn(() => new Map()),
    applyDelta: vi.fn(),
    syncRegistryFiles: vi.fn(),
    upsertRegistrySource: vi.fn(),
    recordPathAlias: vi.fn(),
    purgePersistedSourcePaths: vi.fn(),
    clearSourceFiles: vi.fn(),
    removeRegistrySource: vi.fn(),
    countRegisteredFiles: vi.fn(() => 0),
    listRegisteredFiles: vi.fn(() => []),
    close: vi.fn()
  }));
  loadSettingsMock.mockResolvedValue({ search: { enabled: true } });
  isSupportedImportFilePathMock.mockImplementation((filePath) => filePath.endsWith(".txt"));
  indexKnowledgeSourceFilesMock.mockResolvedValue({
    indexedAt: "2026-06-05T00:00:00.000Z",
    snapshotHash: "snapshot",
    indexedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    checkpointTreeId: "checkpoint-source-index"
  });
  deleteKnowledgeSourceFileIndexMock.mockResolvedValue(undefined);
  checkpointTreeIdMock.mockImplementation((kind, sourceId) => `${kind}:${sourceId}`);
  deleteCheckpointTreeMock.mockResolvedValue(undefined);
  finishCheckpointTreeMock.mockResolvedValue(undefined);
  startCheckpointTreeMock.mockResolvedValue(undefined);
  upsertCheckpointNodeMock.mockResolvedValue(undefined);
  serverTokenMock.mockImplementation((...parts) => parts.filter(Boolean).join(":"));
  atomicWriteJsonMock.mockImplementation(async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  });
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
  vi.restoreAllMocks();
});

describe("knowledge retrieval and storage final extra coverage 3", () => {
  it("normalizes search input and reports an empty result set when knowledge-source indexes are unavailable", async () => {
    await withTempRoot("pact-knowledge-retrieval-final-extra-3-", async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "external-source");
      await fs.mkdir(sourceRoot, { recursive: true });
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: true,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: ["node_modules"],
        scanRoots: [],
        queryExpansions: [
          {
            id: "invoice-alias",
            triggers: ["invoice"],
            terms: ["invoice", "发票"]
          }
        ],
        snippetWindow: 80
      });
      await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            sourceId: "source-a",
            label: "External Source",
            directoryPath: sourceRoot,
            enabled: true,
            lastIndexSnapshotHash: "stale",
            lastIndexAt: "2026-06-04T00:00:00.000Z",
            lastIndexStatus: "failed"
          }
        ]
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "  invoice   发票  ",
        limit: "5"
      });

      expect(result.query).toBe("invoice 发票");
      expect(result.items).toHaveLength(0);
      expect(result.results).toHaveLength(0);
      expect(result.explain).toMatchObject({
        candidateSearch: "js-directory-walk",
        invertedIndex: {
          enabled: true,
          used: false,
          scanFallbackWhenIndexMissing: false
        }
      });
      expect(result.explain.invertedIndex.unavailableSources).toEqual([
        {
          sourceId: "source-a",
          reason: "index_unavailable"
        }
      ]);
      expect(result.explain.queryGroups[0]).toMatchObject({
        queryTerm: "invoice",
        expansionIds: ["invoice-alias"],
        termCount: 2
      });
    });
  });

  it("adds, searches, deletes, and rejects bad vector-store payloads without loading sqlite-vec", async () => {
    await withTempRoot("pact-vector-store-final-extra-3-", async (root) => {
      const dbPath = path.join(root, "knowledge.sqlite");
      const db = new Database(dbPath);
      const embeddingRuntime = {
        providerId: "mock-embedding",
        defaultDimension: 8,
        embedText: vi.fn(() => ({
          providerId: "mock-embedding",
          modality: "text",
          dimension: 8,
          vector: [1, 0, 0, 0, 0, 0, 0, 0]
        })),
        embedImageEvidence: vi.fn(() => ({
          providerId: "mock-embedding",
          modality: "image",
          dimension: 8,
          vector: [0, 1, 0, 0, 0, 0, 0, 0]
        })),
        embedJointEvidence: vi.fn(() => ({
          providerId: "mock-embedding",
          modality: "joint",
          dimension: 8,
          vector: [0, 0, 1, 0, 0, 0, 0, 0]
        }))
      };

      try {
        const store = createLocalVectorStore({
          db,
          embeddingRuntime,
          providerId: "builtin:test-vector-store",
          dimension: 8,
          preferSqliteVec: false
        });

        expect(() => store.upsert({
          items: [
            {
              targetType: "block",
              targetId: "bad-vector",
              provider: "builtin:test-vector-store",
              vector: []
            }
          ]
        })).toThrow("Vector upsert requires a non-empty vector array.");
        expect(() => store.upsert({
          items: [
            {
              targetType: "block",
              targetId: "bad-provider",
              vector: [1, 0, 0, 0, 0, 0, 0, 0]
            }
          ]
        })).toThrow("Vector upsert requires provider or providerId.");
        expect(() => store.upsert({
          items: [
            {
              targetType: "block",
              provider: "builtin:test-vector-store",
              vector: [1, 0, 0, 0, 0, 0, 0, 0]
            }
          ]
        })).toThrow("Vector upsert requires targetType and targetId.");

        const inserted = store.upsert([
          {
            targetType: "block",
            targetId: "chunk-a",
            provider: "builtin:test-vector-store",
            modality: "text",
            vector: [1, 0, 0, 0, 0, 0, 0, 0],
            metadata: {
              kind: "alpha"
            }
          },
          {
            targetType: "block",
            targetId: "chunk-b",
            provider: "builtin:test-vector-store",
            modality: "text",
            vector: [0.2, 0.8, 0, 0, 0, 0, 0, 0]
          }
        ]);

        expect(inserted).toMatchObject({
          protocolVersion: "v0.0.1:knowledge:vector-1",
          providerId: "builtin:test-vector-store",
          upserted: 2
        });

        const badSearch = store.search({
          vector: ["not-a-number"],
          limit: "2"
        });
        expect(badSearch.results).toEqual([]);

        const search = store.search({
          query: "  preferred result  ",
          limit: "1"
        });
        expect(search).toMatchObject({
          protocolVersion: "v0.0.1:knowledge:vector-1",
          providerId: "builtin:test-vector-store",
          backend: "sqlite-json-fallback",
          queryProvider: "mock-embedding"
        });
        expect(search.results).toHaveLength(1);
        expect(search.results[0]).toMatchObject({
          targetType: "block",
          targetId: "chunk-a",
          provider: "builtin:test-vector-store",
          metadata: {
            kind: "alpha"
          }
        });

        expect(store.deleteByTargetIds({})).toMatchObject({
          deleted: 0
        });
        expect(store.deleteByTargetIds({ targetId: "chunk-a" })).toMatchObject({
          deleted: 1
        });
        expect(store.search({
          query: "preferred result",
          limit: 2
        }).results).toHaveLength(1);
      } finally {
        db.close();
      }
    });
  });

  it("returns metadata for evidence previews, then null for missing and unreadable files", async () => {
    await withTempRoot("pact-source-evidence-final-extra-3-", async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "mail");
      await fs.mkdir(sourceRoot, { recursive: true });
      const evidenceFile = path.join(sourceRoot, "evidence.eml");
      await writeText(
        evidenceFile,
        eml({
          subject: "Evidence preview",
          body: "This body contains the snippet we want to surface."
        })
      );
      const evidenceId = sourceEvidenceIdForPath(userDataPath, evidenceFile);
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: false,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: ["node_modules"],
        scanRoots: [
          {
            id: "mail-root",
            label: "Mail Root",
            relativePath: "mail",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 80
      });
      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: evidenceFile,
        root: { id: "mail-root", relativePath: "mail" }
      });

      const evidence = await getSourceFileEvidence({
        userDataPath,
        evidenceId
      });

      expect(evidence).toMatchObject({
        evidenceId,
        title: "Evidence preview",
        locator: {
          relativePath: "mail/evidence.eml"
        }
      });
      expect(evidence.payload.document.metadata).toMatchObject({
        from: "sender@example.test",
        date: "Fri, 05 Jun 2026 10:00:00 +0000",
        truncated: false
      });

      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: path.join(sourceRoot, "missing.eml")
      });
      await expect(getSourceFileEvidence({
        userDataPath,
        evidenceId: "source-evidence::mail/missing.eml"
      })).resolves.toBeNull();

      const unreadablePath = path.join(sourceRoot, "not-a-file");
      await fs.mkdir(unreadablePath, { recursive: true });
      getIndexedSourceFileByEvidenceIdMock.mockResolvedValueOnce({
        file: unreadablePath
      });
      await expect(getSourceFileEvidence({
        userDataPath,
        evidenceId: "source-evidence::mail/not-a-file"
      })).resolves.toBeNull();
    });
  });

  it("loads an empty knowledge-source store from a missing file and rejects invalid source input", async () => {
    await withTempRoot("pact-knowledge-source-service-final-extra-3-", async (root) => {
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
      await expect(service.createSource({
        label: "missing-path",
        runNow: false
      })).rejects.toThrow("请填写服务端可访问的本地目录路径。");

      await service.close();
    });
  });
});
