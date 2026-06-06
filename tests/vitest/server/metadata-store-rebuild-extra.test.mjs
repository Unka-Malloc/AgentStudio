import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(value), "utf8");
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

let createMetadataStore;

beforeAll(async () => {
  ({ createMetadataStore } = await import("../../../server/platform/common/storage/metadata-store.mjs"));
});

describe("metadata store", () => {
  it("creates storage roots, writes batches, and reads persisted rows back", async () => {
    const userDataPath = await tempDir("pact-metadata-store-");
    const store = createMetadataStore({ userDataPath });
    const batchId = "batch-live";
    const generatedAt = "2024-01-01T00:00:00.000Z";

    expect(store.databasePath).toBe(path.join(userDataPath, "metadata", "pact.sqlite"));
    expect(store.objectRootPath).toBe(path.join(userDataPath, "objects"));

    store.beginBatch({
      batchId,
      jobId: "job-live",
      generatedAt,
      settings: { scope: "unit-test" }
    });

    const rawObject = {
      objectId: "raw-alpha",
      ingestOrigin: "filesystem",
      clientUid: "client-a",
      sourceType: "mail",
      providerId: "provider-a",
      externalId: "external-a",
      syncBatchId: "sync-a",
      contentHash: "hash-alpha",
      capturedAt: generatedAt,
      sourceMetadata: { sourceId: "alpha", nested: { stage: "test" } },
      archiveFileName: "",
      originalFileName: "alpha.eml",
      originalRelativePath: "inbox/alpha.eml",
      originalSourcePath: "/source/inbox/alpha.eml",
      sourceContainerPath: "",
      storageRelativePath: "objects/mail/batch-live/raw-alpha/inbox/alpha.eml",
      mediaType: "text/plain",
      sha256: "sha-alpha",
      byteSize: 12,
      sourceCreatedAt: generatedAt,
      sourceUpdatedAt: generatedAt,
      sourceCollectedAt: generatedAt,
      createdAt: generatedAt
    };

    const sources = [
      {
        id: "alpha",
        name: "Alpha",
        path: "inbox/alpha.eml",
        kind: "email",
        text: "alpha alpha beta",
        sourceCreatedAt: generatedAt,
        sourceUpdatedAt: generatedAt,
        sourceCollectedAt: generatedAt,
        mediaType: "text/plain",
        sourceMetadata: { sourceId: "alpha" },
        rawObject
      },
      {
        id: "beta",
        name: "Beta",
        path: "inbox/beta.eml",
        kind: "email",
        text: "beta gamma",
        sourceCreatedAt: generatedAt,
        sourceUpdatedAt: generatedAt,
        sourceCollectedAt: generatedAt,
        mediaType: "text/plain"
      }
    ];

    store.persistSources({
      batchId,
      sources,
      warnings: [{ code: "source.warning", detail: "ok" }]
    });

    store.persistPreprocessResult({
      batchId,
      preprocessResult: {
        blocks: [
          {
            id: "block-1",
            sourceId: "alpha",
            kind: "paragraph",
            level: 1,
            text: "Block body",
            metadata: { kind: "body" }
          }
        ],
        chunks: [
          {
            id: "chunk-1",
            sourceId: "alpha",
            title: "Chunk title",
            titlePath: ["alpha"],
            blockIds: ["block-1"],
            chunkType: "paragraph",
            content: "Chunk body",
            tokenCount: 4,
            metadata: { chunk: true }
          }
        ]
      }
    });

    expect(store.getBatch(batchId)).toMatchObject({
      batch_id: batchId,
      status: "analyzing",
      source_count: 2,
      raw_object_count: 1
    });
    expect(store.hasBatch(batchId)).toBe(true);
    expect(store.getRawMailObject("raw-alpha")).toMatchObject({
      object_id: "raw-alpha",
      source_ref: "alpha",
      storage_rel_path: "objects/mail/batch-live/raw-alpha/inbox/alpha.eml"
    });
    expect(store.listRawObjectStoragePathsByBatch(batchId)).toEqual([
      "objects/mail/batch-live/raw-alpha/inbox/alpha.eml"
    ]);
    expect(store.getBatchArtifactPaths(batchId)).toEqual({
      batchId,
      objectRootPath: path.join(userDataPath, "objects")
    });

    expect(store.searchSourceDocuments({ query: "alpha", limit: 5 })).toEqual([
      expect.objectContaining({
        batchId,
        sourceRef: "alpha",
        sourcePath: "inbox/alpha.eml"
      })
    ]);
    expect(store.listSourceCorpusRawTerms({ limit: 10, minFrequency: 1 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "alpha" }),
        expect.objectContaining({ term: "beta" }),
        expect.objectContaining({ term: "gamma" })
      ])
    );
    expect(store.getSignificantSourceTerms({
      batchId,
      limit: 10,
      minForegroundDocumentFrequency: 1,
      minForegroundFiles: 1
    })).toMatchObject({
      ok: true
    });
    expect(store.listSourceVocabularyTermStats({ terms: ["alpha", "beta"] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "alpha" }),
        expect.objectContaining({ term: "beta" })
      ])
    );
    expect(store.getStorageSummary()).toMatchObject({
      sourceCount: 2,
      rawObjectCount: 1,
      preprocessBlockCount: 1,
      preprocessChunkCount: 1
    });

    expect(store.search({
      query: "  alpha  ",
      limit: 0,
      batchId: 123,
      entityTypes: "bad",
      formalOnly: 1
    })).toMatchObject({
      query: "alpha",
      batchId: "123",
      limit: 20,
      formalOnly: true,
      entityTypes: [],
      unavailable: true
    });
    expect(store.refreshTransactionLineageStates("2024-01-02T00:00:00.000Z")).toMatchObject({
      refreshedCount: 0,
      unavailable: true
    });
    expect(store.resolveTransactionLifecycle({ batchId })).toMatchObject({
      lifecycleState: "unknown",
      unavailable: true
    });

    expect(store.listPendingDeletionOperations()).toEqual([]);
    const createdDeletionOperation = store.upsertDeletionOperation({
      batchId,
      jobId: "job-live",
      status: "running",
      state: { stage: "queued" },
      error: ""
    });
    expect(createdDeletionOperation).toMatchObject({
      batchId,
      status: "running"
    });
    expect(store.getDeletionOperationByBatchId(batchId)).toMatchObject({
      batchId,
      status: "running"
    });
    expect(store.updateDeletionOperation(createdDeletionOperation.operationId, {
      status: "retrying",
      state: { stage: "retry" },
      error: "again"
    })).toMatchObject({
      status: "retrying"
    });
    store.deleteDeletionOperation(createdDeletionOperation.operationId);

    expect(store.recordClientCheckIn({ clientId: "client-a", clientLabel: "Client A" })).toMatchObject({
      clientId: "client-a",
      migrationState: "unknown"
    });
    expect(store.listClientRegistrations({})).toMatchObject({
      summary: expect.objectContaining({ totalCount: 1 }),
      items: [expect.objectContaining({ clientId: "client-a" })]
    });

    const blockCount = store.db.prepare("SELECT COUNT(*) AS count FROM preprocess_blocks").get().count;
    const chunkCount = store.db.prepare("SELECT COUNT(*) AS count FROM preprocess_chunks").get().count;
    const rawObjectCount = store.db.prepare("SELECT COUNT(*) AS count FROM raw_mail_objects").get().count;
    expect([blockCount, chunkCount, rawObjectCount]).toEqual([1, 1, 1]);

    store.deleteBatchRecords(batchId);
    store.deleteBatchRow(batchId);
    expect(store.hasBatch(batchId)).toBe(false);

    store.close();
  });
});

describe("metadata store delegation", () => {
  it("passes domain services through and delegates wrapper methods", async () => {
    const userDataPath = await tempDir("pact-metadata-store-mock-");
    vi.resetModules();

    const batchRepository = {
      beginBatch: vi.fn(),
      updateBatchStatus: vi.fn(),
      persistSources: vi.fn(),
      persistPreprocessResult: vi.fn(),
      persistAnalysis: vi.fn(({ afterCorePersist }) => {
        if (typeof afterCorePersist === "function") {
          afterCorePersist({ batchId: "batch-mock", result: { marker: true }, now: "2024-01-01T00:00:00.000Z" });
        }
      }),
      markBatchFailed: vi.fn(() => "marked"),
      getRawMailObject: vi.fn(() => ({ object_id: "raw-mock" })),
      listRawObjectStoragePathsByBatch: vi.fn(() => ["objects/mock.bin"]),
      hasBatch: vi.fn(() => true),
      getBatch: vi.fn(() => ({ batch_id: "batch-mock" })),
      searchSourceDocuments: vi.fn(() => [{ sourceRef: "mock" }]),
      getSignificantSourceTerms: vi.fn(() => ({ ok: true, terms: [{ term: "mock" }] })),
      listSourceCorpusRawTerms: vi.fn(() => [{ term: "mock", frequency: 1 }]),
      listSourceVocabularyTermStatsByTerms: vi.fn(() => [{ term: "mock" }]),
      getKnowledgeWordCloudState: vi.fn(async () => ({ ok: true, state: "cloud" })),
      getKnowledgeWordBagTerms: vi.fn(async () => ["alpha"]),
      saveKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, saved: true })),
      exportKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, exported: true })),
      importKnowledgeWordCloudSet: vi.fn(async () => ({ ok: true, imported: true })),
      addKnowledgeWordBag: vi.fn(async () => ({ ok: true, added: true })),
      updateKnowledgeWordBag: vi.fn(async () => ({ ok: true, updated: true })),
      deleteKnowledgeWordBag: vi.fn(async () => ({ ok: true, deleted: true })),
      getStorageSummary: vi.fn(() => ({ sourceCount: 1, rawObjectCount: 1 })),
      deleteBatchRecords: vi.fn(() => "deleted"),
      rebuildSourceVocabulary: vi.fn(() => ({ ok: true, rebuiltBatchCount: 1 })),
      deleteBatchRow: vi.fn(() => "row-deleted"),
      upsertDeletionOperation: vi.fn(() => ({ operationId: "op-1" })),
      updateDeletionOperation: vi.fn(() => ({ operationId: "op-1", status: "retrying" })),
      getDeletionOperationByBatchId: vi.fn(() => ({ batchId: "batch-mock" })),
      listPendingDeletionOperations: vi.fn(() => [{ operationId: "op-1" }]),
      deleteDeletionOperation: vi.fn(),
      getBatchArtifactPaths: vi.fn(() => ({ batchId: "batch-mock", objectRootPath: "/tmp/mock" }))
    };
    const clientRegistryService = {
      recordClientCheckIn: vi.fn(() => ({ ok: true, clientUid: "client-a" })),
      listClientRegistrations: vi.fn(() => [{ clientUid: "client-a" }])
    };
    const knowledgeRepository = {
      buildCanonicalKnowledge: vi.fn(() => ({ canonical: true })),
      persistCanonicalKnowledge: vi.fn(),
      deleteBatch: vi.fn(),
      sync: vi.fn(() => ({ ok: true, synced: true })),
      submitChanges: vi.fn(() => ({ ok: true, submitted: true })),
      listReviewItems: vi.fn(() => [{ id: "review-1" }]),
      resolveReviewItem: vi.fn(() => ({ ok: true, resolved: true })),
      search: vi.fn(() => [{ id: "knowledge-1" }]),
      getItem: vi.fn(() => ({ id: "knowledge-item" })),
      getGraph: vi.fn(() => ({ nodes: [], edges: [] })),
      getStorageSummary: vi.fn(() => ({ itemCount: 1 }))
    };
    const textIndexingService = {
      compileRuleSet: vi.fn(() => ({ stopwords: new Set() })),
      tokenizeText: vi.fn(() => new Map([["alpha", 1]])),
      buildSearchTerms: vi.fn(() => ["alpha"])
    };
    const lifecycleService = {
      persistTransactionLineages: vi.fn(),
      refreshTransactionLineageStates: vi.fn(() => ({ refreshedCount: 1, unavailable: false })),
      resolveTransactionLifecycle: vi.fn(() => ({ lifecycleState: "resolved", unavailable: false }))
    };
    const searchService = {
      search: vi.fn((input = {}) => ({ query: String(input.query || "").trim(), unavailable: false, items: [] }))
    };
    const createTextIndexingService = vi.fn(() => textIndexingService);
    const createTransactionLifecycleService = vi.fn(() => lifecycleService);
    const createSearchService = vi.fn(() => searchService);

    vi.doMock("../../../server/platform/common/storage/batch-repository.mjs", () => ({
      createBatchRepository: vi.fn(() => batchRepository)
    }));
    vi.doMock("../../../server/platform/common/storage/client-registry-repository.mjs", () => ({
      createClientRegistryService: vi.fn(() => clientRegistryService)
    }));
    vi.doMock("../../../server/platform/common/storage/knowledge-repository.mjs", () => ({
      createKnowledgeRepository: vi.fn(() => knowledgeRepository)
    }));

    const { createMetadataStore: mockedCreateMetadataStore } = await import("../../../server/platform/common/storage/metadata-store.mjs");
    const store = mockedCreateMetadataStore({
      userDataPath,
      domainServices: {
        createTextIndexingService,
        createTransactionLifecycleService,
        createSearchService
      }
    });

    expect(createTextIndexingService).toHaveBeenCalledWith({ db: expect.any(Object) });
    expect(createTransactionLifecycleService).toHaveBeenCalledWith({ db: expect.any(Object) });
    expect(createSearchService).toHaveBeenCalledWith({ db: expect.any(Object) });

    store.beginBatch({ batchId: "batch-mock", jobId: "job-mock", generatedAt: "2024-01-01T00:00:00.000Z", settings: {} });
    store.updateBatchStatus("batch-mock", "failed", "boom");
    store.persistSources({ batchId: "batch-mock", sources: [], warnings: [], rules: {} });
    store.persistPreprocessResult({ batchId: "batch-mock", preprocessResult: { blocks: [], chunks: [] } });
    store.persistAnalysis({
      batchId: "batch-mock",
      result: { overview: {}, people: [], emails: [], threads: [], transactions: [], timeline: [], retrieval: { items: [] } },
      warnings: [],
      rules: {}
    });
    store.markBatchFailed("batch-mock", "boom");
    store.getRawMailObject("raw-mock");
    store.listRawObjectStoragePathsByBatch("batch-mock");
    store.hasBatch("batch-mock");
    store.getBatch("batch-mock");
    store.searchSourceDocuments({ query: "mock" });
    store.getSignificantSourceTerms({ batchId: "batch-mock" });
    store.listSourceCorpusRawTerms({ batchId: "batch-mock" });
    store.listSourceVocabularyTermStats({ terms: ["mock"] });
    await store.getKnowledgeWordCloudState({ wordBagSetId: "set-1" });
    await store.getKnowledgeWordBagTerms({ wordBagSetId: "set-1" });
    await store.saveKnowledgeWordCloudSet({ wordBagSet: { wordBagSetId: "set-1" } });
    await store.exportKnowledgeWordCloudSet({ wordBagSetId: "set-1" });
    await store.importKnowledgeWordCloudSet({ wordBagSet: { wordBagSetId: "set-1" } });
    await store.addKnowledgeWordBag({ wordBagSetId: "set-1" });
    await store.updateKnowledgeWordBag({ wordBagSetId: "set-1" });
    await store.deleteKnowledgeWordBag({ wordBagSetId: "set-1" });
    store.getStorageSummary();
    store.deleteBatchRecords("batch-mock");
    store.rebuildSourceVocabulary({ rules: {} });
    store.deleteBatchRow("batch-mock");
    store.upsertDeletionOperation({ batchId: "batch-mock" });
    store.updateDeletionOperation("op-1", { status: "retrying" });
    store.getDeletionOperationByBatchId("batch-mock");
    store.listPendingDeletionOperations();
    store.deleteDeletionOperation("op-1");
    store.getBatchArtifactPaths("batch-mock");
    store.recordClientCheckIn({ clientUid: "client-a" });
    store.listClientRegistrations({ workspaceId: "ws-a" });
    store.refreshTransactionLineageStates("2024-01-01T00:00:00.000Z");
    store.resolveTransactionLifecycle({ batchId: "batch-mock" });
    store.search({ query: "mock" });
    store.syncKnowledge({ batchId: "batch-mock" });
    store.submitKnowledgeChanges({ batchId: "batch-mock" });
    store.listKnowledgeReviewItems({ batchId: "batch-mock" });
    store.resolveKnowledgeReviewItem({ batchId: "batch-mock" });
    store.searchKnowledge({ batchId: "batch-mock" });
    store.getKnowledgeItem({ itemId: "item-1" });
    store.getKnowledgeGraph({ batchId: "batch-mock" });
    store.close();

    expect(batchRepository.persistAnalysis).toHaveBeenCalledTimes(1);
    expect(lifecycleService.persistTransactionLineages).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-mock",
        result: expect.objectContaining({
          knowledge: { canonical: true }
        })
      })
    );
    expect(knowledgeRepository.persistCanonicalKnowledge).toHaveBeenCalledWith({
      batchId: "batch-mock",
      knowledge: { canonical: true }
    });
    expect(batchRepository.updateBatchStatus).toHaveBeenCalledWith("batch-mock", "failed", "boom");
    expect(searchService.search).toHaveBeenCalledWith({ query: "mock" });
    expect(lifecycleService.refreshTransactionLineageStates).toHaveBeenCalledWith("2024-01-01T00:00:00.000Z", {});
    expect(lifecycleService.resolveTransactionLifecycle).toHaveBeenCalledWith({ batchId: "batch-mock" });
    expect(clientRegistryService.recordClientCheckIn).toHaveBeenCalledWith({ clientUid: "client-a" });
    expect(knowledgeRepository.sync).toHaveBeenCalledWith({ batchId: "batch-mock" });
    expect(knowledgeRepository.getGraph).toHaveBeenCalledWith({ batchId: "batch-mock" });
    expect(batchRepository.deleteBatchRecords).toHaveBeenCalledWith("batch-mock");
  });
});

describe("rebuild metadata store", () => {
  it("replays jobs in createdAt order, tolerates malformed JSON, and skips bad metadata", async () => {
    const userDataPath = await tempDir("pact-rebuild-metadata-");
    const metadataDir = path.join(userDataPath, "metadata");
    await fs.mkdir(metadataDir, { recursive: true });
    await writeText(path.join(metadataDir, "legacy.txt"), "legacy");

    const jobsRoot = path.join(userDataPath, "jobs");
    await fs.mkdir(jobsRoot, { recursive: true });
    await writeText(path.join(jobsRoot, "not-a-directory.txt"), "skip");

    const loadRules = vi.fn(async (root) => ({
      loadedFrom: root,
      keywordStopwords: ["alpha"]
    }));
    const beginBatchCalls = [];
    const persistSourcesCalls = [];
    const persistPreprocessResultCalls = [];
    const persistAnalysisCalls = [];
    const markBatchFailedCalls = [];
    const updateBatchStatusCalls = [];
    let closeCount = 0;

    const fakeStore = {
      beginBatch: vi.fn((input) => {
        beginBatchCalls.push(input);
      }),
      persistSources: vi.fn((input) => {
        persistSourcesCalls.push(input);
      }),
      persistPreprocessResult: vi.fn((input) => {
        persistPreprocessResultCalls.push(input);
      }),
      persistAnalysis: vi.fn((input) => {
        persistAnalysisCalls.push(input);
      }),
      markBatchFailed: vi.fn((batchId, error) => {
        markBatchFailedCalls.push({ batchId, error });
      }),
      updateBatchStatus: vi.fn((batchId, status, error) => {
        updateBatchStatusCalls.push({ batchId, status, error });
      }),
      close: vi.fn(() => {
        closeCount += 1;
      })
    };
    const createMetadataStoreMock = vi.fn(() => fakeStore);

    await writeJson(path.join(jobsRoot, "job-queued", "meta.json"), {
      id: "queued-job",
      createdAt: "2024-01-01T00:00:00.000Z",
      status: "queued"
    });
    await writeJson(path.join(jobsRoot, "job-queued", "result.json"), { ignored: true });
    await writeJson(path.join(jobsRoot, "job-queued", "payload.json"), {
      settings: { queued: true }
    });

    await writeJson(path.join(jobsRoot, "job-failed", "meta.json"), {
      createdAt: "2024-01-02T00:00:00.000Z",
      status: "failed",
      error: "boom"
    });
    await writeText(path.join(jobsRoot, "job-failed", "result.json"), "{broken");
    await writeJson(path.join(jobsRoot, "job-failed", "payload.json"), {
      settings: { failed: true }
    });

    await writeJson(path.join(jobsRoot, "job-completed", "meta.json"), {
      id: "completed-job",
      archiveBatchId: "archive-batch-1",
      createdAt: "2024-01-03T00:00:00.000Z",
      generatedAt: "2024-01-03T01:00:00.000Z",
      status: "completed"
    });
    await writeJson(path.join(jobsRoot, "job-completed", "result.json"), {
      batchId: "batch-completed",
      generatedAt: "2024-01-03T01:00:00.000Z",
      sourceFiles: [
        {
          id: "source-alpha",
          name: "Alpha",
          path: "inbox/alpha.eml",
          kind: "email",
          text: "alpha alpha beta",
          mediaType: "text/plain",
          sourceCreatedAt: "2024-01-03T00:00:00.000Z",
          sourceUpdatedAt: "2024-01-03T00:00:00.000Z",
          sourceCollectedAt: "2024-01-03T00:00:00.000Z",
          rawObjectId: "raw-alpha",
          rawObjectSha256: "sha-alpha",
          rawObjectByteSize: 12,
          originalFileName: "Alpha.eml",
          originalRelativePath: "inbox/alpha.eml",
          rawObject: {
            sourceMetadata: { sourceId: "source-alpha" },
            archiveFileName: "",
            clientUid: "client-a",
            sourceType: "mail"
          }
        },
        {
          id: "source-beta",
          name: "Beta",
          path: "inbox/beta.eml",
          kind: "email",
          text: "beta gamma",
          mediaType: "text/plain",
          sourceCreatedAt: "2024-01-03T00:00:00.000Z",
          sourceUpdatedAt: "2024-01-03T00:00:00.000Z",
          sourceCollectedAt: "2024-01-03T00:00:00.000Z",
          rawObjectId: "raw-beta",
          rawObjectSha256: "sha-beta",
          rawObjectByteSize: 10,
          archiveFileName: "../Invoice:2024?.eml",
          clientUid: " client/one ",
          sourceType: "finance/report",
          originalRelativePath: "ignored/relative-path.eml",
          sourceMetadata: { sourceId: "source-beta" }
        },
        {
          id: "source-gamma",
          name: "Gamma",
          path: "inbox/gamma.eml",
          kind: "email",
          text: "gamma",
          mediaType: "text/plain"
        }
      ],
      warnings: [{ code: "warn-1" }],
      preprocess: {
        blocks: [
          {
            id: "block-1",
            sourceId: "source-alpha",
            kind: "paragraph",
            level: 1,
            text: "block"
          }
        ],
        chunks: [
          {
            id: "chunk-1",
            sourceId: "source-alpha",
            title: "chunk",
            titlePath: ["alpha"],
            blockIds: ["block-1"],
            chunkType: "paragraph",
            content: "chunk body",
            tokenCount: 3
          }
        ]
      },
      people: [],
      emails: [],
      threads: [],
      transactions: [],
      timeline: [],
      retrieval: { items: [] },
      overview: { sourceCount: 3 }
    });
    await writeText(path.join(jobsRoot, "job-completed", "payload.json"), "{broken");

    await writeText(path.join(jobsRoot, "job-broken-meta", "meta.json"), "{broken");

    vi.resetModules();
    vi.doMock("../../../server/platform/common/storage/metadata-store.mjs", () => ({
      createMetadataStore: createMetadataStoreMock
    }));

    const { rebuildMetadataStore } = await import("../../../server/platform/common/storage/rebuild-metadata.mjs");
    const summary = await rebuildMetadataStore({
      userDataPath,
      loadRules
    });

    expect(loadRules).toHaveBeenCalledWith(userDataPath);
    expect(createMetadataStoreMock).toHaveBeenCalledWith({
      userDataPath,
      domainServices: {}
    });
    expect(summary).toEqual({
      rebuiltBatchCount: 3,
      rebuiltCompletedCount: 1,
      rebuiltFailedCount: 1,
      skippedCount: 0
    });
    expect(beginBatchCalls.map((call) => call.jobId)).toEqual([
      "queued-job",
      "job-failed",
      "completed-job"
    ]);
    expect(beginBatchCalls[0]).toMatchObject({
      batchId: "queued-job",
      settings: { queued: true }
    });
    expect(beginBatchCalls[1]).toMatchObject({
      batchId: "job-failed",
      settings: { failed: true }
    });
    expect(beginBatchCalls[2]).toMatchObject({
      batchId: "batch-completed",
      settings: {}
    });

    expect(updateBatchStatusCalls).toEqual([
      {
        batchId: "queued-job",
        status: "queued",
        error: ""
      }
    ]);
    expect(markBatchFailedCalls).toEqual([
      {
        batchId: "job-failed",
        error: "boom"
      }
    ]);
    expect(persistSourcesCalls).toHaveLength(1);
    expect(persistPreprocessResultCalls).toHaveLength(1);
    expect(persistAnalysisCalls).toHaveLength(1);
    expect(persistSourcesCalls[0].sources).toHaveLength(3);
    expect(persistSourcesCalls[0].sources[0].rawObject.storageRelativePath).toBe(
      "objects/mail/batch-completed/raw-alpha/inbox/alpha.eml"
    );
    expect(persistSourcesCalls[0].sources[1].rawObject.storageRelativePath).toBe(
      "objects/client_one/finance_report/Invoice_2024_.eml"
    );
    expect(persistSourcesCalls[0].sources[2].rawObject).toBeNull();
    expect(persistSourcesCalls[0].rules).toEqual({
      loadedFrom: userDataPath,
      keywordStopwords: ["alpha"]
    });
    expect(persistPreprocessResultCalls[0]).toMatchObject({
      batchId: "batch-completed",
      preprocessResult: {
        blocks: [expect.objectContaining({ id: "block-1" })],
        chunks: [expect.objectContaining({ id: "chunk-1" })]
      }
    });
    expect(persistAnalysisCalls[0]).toMatchObject({
      batchId: "batch-completed",
      warnings: [{ code: "warn-1" }],
      rules: {
        loadedFrom: userDataPath,
        keywordStopwords: ["alpha"]
      }
    });
    expect(closeCount).toBe(1);
    expect(await fs.access(metadataDir).then(() => true).catch(() => false)).toBe(false);
  });
});
