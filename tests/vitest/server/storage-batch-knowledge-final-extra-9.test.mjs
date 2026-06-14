import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../../server/platform/common/storage/source-file-registry-store.mjs", () => ({
  createSourceFileRegistryStore: createSourceFileRegistryStoreMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs", () => ({
  isSupportedImportFilePath: isSupportedImportFilePathMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs", async () => {
  const actual = await vi.importActual(
    "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
  );
  return {
    ...actual,
    indexKnowledgeSourceFiles: indexKnowledgeSourceFilesMock,
    deleteKnowledgeSourceFileIndex: deleteKnowledgeSourceFileIndexMock
  };
});

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
  atomicWriteJson: atomicWriteJsonMock,
  waitForStateIdle: vi.fn(async () => undefined)
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

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/default-taxonomy.mjs", () => ({
  evaluateQueryIntentText: vi.fn(() => null),
  resolveQueryIntentProfile: vi.fn(() => null),
  queryTermsForIntentSearch: vi.fn((baseTerms = [], intentProfile = null, limit = 80) => {
    void intentProfile;
    return Array.isArray(baseTerms) ? baseTerms.slice(0, limit) : [];
  })
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "v0.0.1:knowledge:embedding-1",
  createEmbeddingRuntime: vi.fn(() => ({
    protocolVersion: "v0.0.1:knowledge:embedding-1",
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

let createBatchRepository;
let createKnowledgeSourceService;
let createKnowledgeCoreMount;
let sourceFileIndexServiceActual;

function makeRegistryStore() {
  return {
    listBySource: vi.fn(() => new Map([["old.txt", { relativePath: "old.txt", fingerprint: "1:1" }]])),
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
  };
}

async function withTempDir(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
}

async function withTempRepository(callback) {
  return withTempDir("pact-storage-batch-knowledge-final-extra-9-repo-", async (root) => {
    await fs.mkdir(path.join(root, "metadata"), { recursive: true });
    const db = new Database((await import("../../../server/platform/common/storage/schema-manager.mjs")).getMetadataDatabasePath(root));
    (await import("../../../server/platform/common/storage/schema-manager.mjs")).initializeMetadataSchema(db);
    const repository = createBatchRepository({ db, userDataPath: root });
    try {
      return await callback({ root, db, repository });
    } finally {
      db.close();
    }
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(() => {
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

  createSourceFileRegistryStoreMock.mockImplementation(() => makeRegistryStore());
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
    await writeJson(filePath, value);
  });
});

beforeEach(async () => {
  if (!createBatchRepository) {
    ({ createBatchRepository } = await import("../../../server/platform/common/storage/batch-repository.mjs"));
    ({ createKnowledgeSourceService } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-source-service.mjs"));
    ({ createKnowledgeCoreMount } = await import("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs"));
    sourceFileIndexServiceActual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
    );
  }
});

describe("storage batch and knowledge final extra coverage 9", () => {
  it("covers word-cloud import, preset bag guards, child terms, and corpus path normalization", async () => {
    await withTempRepository(async ({ repository }) => {
      const saved = await repository.saveKnowledgeWordCloudSet({
        wordBagSet: {
          wordBagSetId: "cloud-branch",
          title: "Branch Coverage",
          termsSnapshot: [
            { term: "alpha", frequency: 4 },
            { term: "beta", frequency: 1, weight: 0.1 },
            { term: "gamma", frequency: 2 }
          ],
          wordBags: [
            {
              wordBagId: "topic-root",
              label: "Topic Root",
              terms: [{ term: "alpha", frequency: 4 }],
              children: [
                {
                  wordBagId: "topic-child",
                  label: "Topic Child",
                  terms: [{ term: "gamma", frequency: 2 }]
                }
              ]
            }
          ],
          corpusPaths: [
            "docs",
            { path: "docs", type: "directory" },
            "docs/readme.txt",
            { path: "docs/readme.txt", type: "file" }
          ],
          modelAlias: "demo"
        }
      });

      expect(saved.ok).toBe(true);
      expect(saved.wordBagSet.wordBags.map((wordBag) => wordBag.wordBagId)).toEqual(
        expect.arrayContaining(["topic-root", "default", "other"])
      );
      expect(saved.wordBagSet.wordBags.find((wordBag) => wordBag.wordBagId === "topic-root")?.children)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ wordBagId: "topic-child" })
        ]));
      expect(saved.wordBagSet.corpusPaths).toHaveLength(2);

      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: "{not-json}"
      })).rejects.toMatchObject({
        code: "word_bag_import_invalid_json"
      });

      await expect(repository.importKnowledgeWordCloudSet({
        importPayload: {
          exportType: "wrong",
          wordBagSet: {}
        }
      })).rejects.toMatchObject({
        code: "word_bag_import_type_mismatch"
      });

      await expect(repository.updateKnowledgeWordBag({
        wordBagSetId: "cloud-branch",
        wordBagId: "default",
        patch: { label: "Renamed" }
      })).rejects.toMatchObject({
        code: "preset_word_bag_title_update_forbidden"
      });

      const grouped = await repository.getKnowledgeWordBagTerms({
        wordBagSetId: "cloud-branch",
        wordBagIds: "topic-root",
        includeChildren: false
      });
      expect(grouped.ok).toBe(true);
      expect(grouped.groups).toHaveLength(1);
      expect(grouped.groups[0].sourceWordBagIds).toEqual(["topic-root"]);

      const deleted = await repository.deleteKnowledgeWordBag({
        wordBagSetId: "cloud-branch",
        wordBagId: "topic-child"
      });
      expect(deleted.defaultWordBagId).toBe("default");
      const defaultBag = deleted.wordBagSet.wordBags.find((wordBag) => wordBag.wordBagId === "default");
      expect(defaultBag?.terms.map((term) => term.term)).toContain("gamma");
    });
  });

  it("indexes real source files, exposes candidate queries, and clears index records", async () => {
    await withTempDir("pact-storage-batch-knowledge-final-extra-9-index-", async (root) => {
      const sourceRoot = path.join(root, "source");
      await fs.mkdir(path.join(sourceRoot, "nested", "node_modules"), { recursive: true });
      await writeJson(path.join(root, "rules", "source-search-rules.json"), {
        schemaVersion: "v0.0.1:schema:definition-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
        maxFileBytes: 128,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 1,
        indexConcurrency: 1,
        indexMaxTermsPerFile: 1000,
        cacheTtlMs: 60_000,
        includeKnowledgeSources: true,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml", ".html"],
        ignoredDirectories: ["node_modules"],
        scanRoots: [],
        queryExpansions: [],
        snippetWindow: 120
      });
      await fs.writeFile(
        path.join(sourceRoot, "inbox.eml"),
        [
          "From: sender@example.test",
          "To: recipient@example.test",
          "Subject: Alpha billing update",
          "Date: Fri, 05 Jun 2026 10:00:00 +0000",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Alpha invoice beta 苹果"
        ].join("\n"),
        "utf8"
      );
      await fs.writeFile(
        path.join(sourceRoot, "page.html"),
        "<html><body><p>Alpha beta 苹果</p></body></html>",
        "utf8"
      );
      await fs.writeFile(
        path.join(sourceRoot, "nested", "node_modules", "ignored.eml"),
        "Subject: Ignored\n\nShould not be indexed.",
        "utf8"
      );
      await fs.writeFile(
        path.join(sourceRoot, "large.eml"),
        [
          "From: sender@example.test",
          "Subject: Large file",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "x".repeat(4096)
        ].join("\n"),
        "utf8"
      );

      const sourceId = "source-index-a";
      const result = await sourceFileIndexServiceActual.indexKnowledgeSourceFiles({
        userDataPath: root,
        source: {
          sourceId,
          directoryPath: sourceRoot,
          recursive: true,
          enabled: true
        },
        reason: "manual",
        force: true
      });

      expect(result).toMatchObject({
        skipped: false,
        sourceId,
        indexedCount: 2,
        skippedCount: 1,
        failedCount: 0
      });

      const evidenceId = sourceFileIndexServiceActual.sourceEvidenceIdForPath(
        root,
        path.join(sourceRoot, "inbox.eml")
      );
      const located = await sourceFileIndexServiceActual.getIndexedSourceFileByEvidenceId({
        userDataPath: root,
        evidenceId
      });
      expect(located).toMatchObject({
        file: path.join(sourceRoot, "inbox.eml"),
        root: expect.objectContaining({
          id: sourceId,
          label: sourceId
        })
      });

      const matching = await sourceFileIndexServiceActual.indexedCandidateFilesForRoot({
        userDataPath: root,
        root: { id: sourceId, label: "Source Index" },
        groups: [{ terms: ["billing"] }]
      });
      expect(matching).toMatchObject({
        available: true,
        candidateFileCount: 1,
        reason: "indexed"
      });

      const noMatch = await sourceFileIndexServiceActual.indexedCandidateFilesForRoot({
        userDataPath: root,
        root: { id: sourceId, label: "Source Index" },
        groups: [{ terms: ["does-not-exist"] }]
      });
      expect(noMatch).toMatchObject({
        available: true,
        candidateFileCount: 0,
        reason: "no_index_match"
      });

      const run = await sourceFileIndexServiceActual.getSourceFileIndexRun({
        userDataPath: root,
        sourceId
      });
      expect(run).toMatchObject({
        source_id: sourceId,
        status: "indexed"
      });

      await sourceFileIndexServiceActual.deleteKnowledgeSourceFileIndex({
        userDataPath: root,
        sourceId
      });
      await expect(sourceFileIndexServiceActual.getSourceFileIndexRun({
        userDataPath: root,
        sourceId
      })).resolves.toBeNull();
      await expect(sourceFileIndexServiceActual.indexedCandidateFilesForRoot({
        userDataPath: root,
        root: { id: sourceId, label: "Source Index" },
        groups: [{ terms: ["Alpha"] }]
      })).resolves.toMatchObject({
        available: false,
        reason: "source_not_indexed"
      });
    });
  });

  it("syncs knowledge sources through the temp workspace and exercises duplicate, refresh, update, and delete paths", async () => {
    await withTempDir("pact-storage-batch-knowledge-final-extra-9-source-", async (root) => {
      const sourceRoot = path.join(root, "source-a");
      const nextSourceRoot = path.join(root, "source-b");
      await fs.mkdir(path.join(sourceRoot, "nested", "node_modules"), { recursive: true });
      await fs.mkdir(nextSourceRoot, { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "alpha.txt"), "alpha text", "utf8");
      await fs.writeFile(path.join(sourceRoot, "nested", "node_modules", "ignored.txt"), "ignored", "utf8");
      await fs.writeFile(path.join(nextSourceRoot, "beta.txt"), "beta text", "utf8");

      const registryStore = makeRegistryStore();
      createSourceFileRegistryStoreMock.mockReturnValue(registryStore);

      const service = createKnowledgeSourceService({
        userDataPath: root,
        jobManager: {
          getJob: vi.fn(async () => null),
          createJob: vi.fn(async () => ({
            id: "job-1",
            status: "queued",
            stage: "parse",
            progressPercent: 0,
            checkpointTreeId: "job-tree-1"
          }))
        },
        watchingEnabled: true
      });

      try {
        const created = await service.createSource({
          directoryPath: sourceRoot,
          label: "Source A",
          autoSync: true,
          hydrationEnabled: false,
          runNow: false
        });
        expect(created.skipped).toBe(true);
        expect(created.reason).toBe("created");
        expect(created.source.watcherStatus).toBe("watching");
        expect(created.source.watcherCount).toBeGreaterThan(0);

        const duplicate = await service.createSource({
          directoryPath: sourceRoot,
          label: "Source A Updated",
          autoSync: true,
          hydrationEnabled: false,
          runNow: false
        });
        expect(duplicate.skipped).toBe(true);
        expect(duplicate.reason).toBe("already_exists");
        expect(duplicate.duplicateOf).toBe(created.source.sourceId);

        const refreshed = await service.refreshSource(created.source.sourceId, {
          force: true,
          reason: "manual-refresh"
        });
        expect(refreshed.job).toMatchObject({
          id: "job-1",
          status: "queued"
        });
        expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledTimes(1);
        expect(indexKnowledgeSourceFilesMock).toHaveBeenCalledWith(
          expect.objectContaining({
            userDataPath: root,
            source: expect.objectContaining({
              sourceId: created.source.sourceId
            }),
            reason: "manual-refresh:sync_job",
            force: false
          })
        );

        const updated = await service.updateSource(created.source.sourceId, {
          directoryPath: nextSourceRoot,
          label: "Source B"
        });
        expect(updated.source.directoryPath).toBe(nextSourceRoot);
        expect(registryStore.recordPathAlias).toHaveBeenCalledTimes(1);
        expect(registryStore.clearSourceFiles).toHaveBeenCalledWith(created.source.sourceId);
        expect(registryStore.purgePersistedSourcePaths).toHaveBeenCalled();

        await expect(service.listRegisteredFiles("missing-source")).resolves.toBeNull();

        const deleted = await service.deleteSource(created.source.sourceId);
        expect(deleted.deletedSource.sourceId).toBe(created.source.sourceId);
        expect(deleteKnowledgeSourceFileIndexMock).toHaveBeenCalledWith(
          expect.objectContaining({
            userDataPath: root,
            sourceId: created.source.sourceId
          })
        );
      } finally {
        await service.close();
      }
    });
  });

  it("ingests knowledge-core documents, returns agent messages, and skips disabled batch callbacks", async () => {
    await withTempDir("pact-storage-batch-knowledge-final-extra-9-core-", async (root) => {
      const mount = await createKnowledgeCoreMount({
        userDataPath: root,
        outlineEnabled: false
      });

      try {
        await expect(mount.onBatchCompleted({
          batchId: "skip-batch",
          result: {},
          settings: { knowledgeCoreEnabled: false }
        })).resolves.toEqual({
          skipped: true,
          reason: "knowledgeCoreEnabled=false"
        });

        const ingest = await mount.ingestSources({
          batchId: "batch-core",
          generatedAt: "2026-06-05T00:00:00.000Z",
          sources: [
            {
              id: "source-alpha",
              name: "Alpha Document",
              path: "docs/alpha.txt",
              kind: "document",
              providerId: "provider-core",
              externalId: "alpha-ext",
              syncBatchId: "sync-core",
              contentHash: "content-alpha",
              capturedAt: "2026-06-05T00:00:00.000Z",
              sourceCreatedAt: "2026-06-05T00:00:00.000Z",
              sourceUpdatedAt: "2026-06-05T02:03:04.000Z",
              sourceCollectedAt: "2026-06-05T00:00:00.000Z",
              sourceMetadata: { fixture: "alpha" },
              text: "Alpha body with beta and 苹果 references",
              mediaType: "text/plain"
            },
            {
              id: "source-alpha-duplicate",
              name: "Alpha Duplicate",
              path: "docs/alpha.txt",
              kind: "document",
              providerId: "provider-core",
              externalId: "alpha-ext-dup",
              syncBatchId: "sync-core",
              contentHash: "content-alpha",
              capturedAt: "2026-06-05T00:00:00.000Z",
              sourceCreatedAt: "2026-06-05T00:00:00.000Z",
              sourceUpdatedAt: "2026-06-05T02:03:04.000Z",
              sourceCollectedAt: "2026-06-05T00:00:00.000Z",
              sourceMetadata: { fixture: "alpha-duplicate" },
              text: "Alpha body with beta and 苹果 references",
              mediaType: "text/plain"
            }
          ]
        });

        expect(ingest).toMatchObject({
          protocolVersion: "v0.0.1:knowledge:core-1",
          batchId: "batch-core",
          documentCount: 1,
          receivedDocumentCount: 2
        });
        expect(ingest.skippedConflictCount).toBeGreaterThan(0);

        const search = mount.search({
          query: "Alpha body",
          batchId: "batch-core",
          responseProfile: "agent",
          agentMessage: true,
          timeRange: {
            from: "2026-06-05T00:00:00.000Z",
            to: "2026-06-06T00:00:00.000Z"
          },
          explain: true,
          limit: 5
        });

        expect(search.responseProfile).toBe("agent");
        expect(search.agentMessage).toMatchObject({
          protocolVersion: "v0.0.1:knowledge:search-agent-message-1",
          machineReadable: true,
          responseProfile: "agent",
          query: "Alpha body"
        });
        expect(search.agentMessage.constraints.timeRange).toEqual({
          from: "2026-06-05T00:00:00.000Z",
          to: "2026-06-06T00:00:00.000Z"
        });
        expect(search.agentMessage.items.length).toBeGreaterThan(0);
        expect(search.agentMessage.items[0].temporal.timestamp).toBe("2026-06-05T02:03:04.000Z");
        expect(search.items[0].reasons.some((reason) => reason.kind === "time-decay")).toBe(true);
      } finally {
        await mount.close();
      }
    });
  });
});
