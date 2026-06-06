import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveSettingsMock = vi.hoisted(() =>
  vi.fn(async (_userDataPath, settings) => ({ ...settings, saved: true }))
);
const loadKnowledgeFileProcessorRuntimeMock = vi.hoisted(() => vi.fn(async () => ({ name: "file-processor" })));
const loadKnowledgeDocumentParsingRuntimeMock = vi.hoisted(() => vi.fn());
const loadKnowledgeEmailRulesRuntimeMock = vi.hoisted(() => vi.fn());
const loadKnowledgeAnalysisRuntimeMock = vi.hoisted(() => vi.fn());
const loadKnowledgePreprocessResultRuntimeMock = vi.hoisted(() => vi.fn());
const loadKnowledgeNormalizedDocumentsRuntimeMock = vi.hoisted(() => vi.fn());
const resolveUploadSessionFilesMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    saveSettings: saveSettingsMock,
    loadKnowledgeFileProcessorRuntime: loadKnowledgeFileProcessorRuntimeMock,
    loadKnowledgeDocumentParsingRuntime: loadKnowledgeDocumentParsingRuntimeMock,
    loadKnowledgeEmailRulesRuntime: loadKnowledgeEmailRulesRuntimeMock,
    loadKnowledgeAnalysisRuntime: loadKnowledgeAnalysisRuntimeMock,
    loadKnowledgePreprocessResultRuntime: loadKnowledgePreprocessResultRuntimeMock,
    loadKnowledgeNormalizedDocumentsRuntime: loadKnowledgeNormalizedDocumentsRuntimeMock
  };
});

vi.mock("../../../server/protocols/checkpoint/upload-session-store.mjs", async () => {
  const actual = await vi.importActual("../../../server/protocols/checkpoint/upload-session-store.mjs");
  return {
    ...actual,
    resolveUploadSessionFiles: resolveUploadSessionFilesMock
  };
});

import { createBatchDeletionCoordinator } from "../../../server/services/client/work-queue-core/batch-deletion-coordinator.mjs";
import { createJobPipeline } from "../../../server/services/client/work-queue-core/job-pipeline.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeFile(filePath, value = "") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function createDeletionMetadataStore(userDataPath, options = {}) {
  const operations = new Map();
  const batches = new Map();
  const artifactPaths = options.artifactPaths || new Map();
  const rawObjectPaths = options.rawObjectPaths || new Map();
  const pendingOperations = options.pendingOperations || [];
  let operationCounter = 1;

  return {
    getBatch: vi.fn((batchId) => batches.get(batchId) || null),
    hasBatch: vi.fn((batchId) => batches.has(batchId)),
    getBatchArtifactPaths: vi.fn((batchId) =>
      artifactPaths.get(batchId) || {
        batchId,
        objectRootPath: path.join(userDataPath, "objects")
      }
    ),
    listRawObjectStoragePathsByBatch: vi.fn((batchId) => rawObjectPaths.get(batchId) || []),
    getDeletionOperationByBatchId: vi.fn((batchId) =>
      [...operations.values()].find((operation) => operation.batchId === batchId) || null
    ),
    updateBatchStatus: vi.fn(),
    upsertDeletionOperation: vi.fn((input) => {
      const existing =
        input.operationId && operations.has(input.operationId)
          ? operations.get(input.operationId)
          : [...operations.values()].find((operation) => operation.batchId === input.batchId) || null;
      const operation = {
        operationId: existing?.operationId || `op-${operationCounter++}`,
        batchId: input.batchId,
        jobId: input.jobId || "",
        status: input.status,
        state: { ...(existing?.state || {}), ...(input.state || {}) },
        error: input.error || ""
      };
      operations.set(operation.operationId, operation);
      return operation;
    }),
    updateDeletionOperation: vi.fn((operationId, patch) => {
      const current = operations.get(operationId) || { operationId };
      const updated = {
        ...current,
        ...patch,
        state: { ...(current.state || {}), ...(patch.state || {}) }
      };
      operations.set(operationId, updated);
      return updated;
    }),
    deleteDeletionOperation: vi.fn((operationId) => {
      operations.delete(operationId);
    }),
    deleteBatchRecords: vi.fn(),
    deleteBatchRow: vi.fn(),
    batches,
    operations,
    pendingOperations,
    seedBatch(batchId, row = {}) {
      batches.set(batchId, { batch_id: batchId, ...row });
    },
    seedOperation(operation) {
      operations.set(operation.operationId, operation);
    },
    listPendingDeletionOperations: vi.fn(() => [
      ...pendingOperations,
      ...[...operations.values()].filter((operation) => operation.status !== "completed")
    ])
  };
}

function createAnalysisRuntimeMock() {
  const documentParseResult = {
    sources: [
      {
        id: "source-1",
        name: "Document 1",
        path: "inbox/document-1.eml",
        kind: "email",
        text: "source text",
        mediaType: "message/rfc822",
        rawObject: {
          objectId: "raw-1",
          clientUid: "client-from-raw",
          sourceType: "mail",
          providerId: "provider-1",
          externalId: "external-1",
          syncBatchId: "sync-1",
          contentHash: "hash-1",
          capturedAt: "2026-06-01T00:00:00.000Z",
          sourceMetadata: { origin: "raw" },
          archiveFileName: "archive-1.eml",
          originalFileName: "original-1.eml",
          originalRelativePath: "archive/original-1.eml",
          storageRelativePath: "objects/raw-1/original-1.eml",
          sha256: "sha-1",
          byteSize: 42
        }
      },
      {
        id: "source-2",
        name: "Document 2",
        path: "inbox/document-2.eml",
        kind: "email",
        text: "",
        sourceMetadata: { source: 2 }
      }
    ],
    warnings: ["parse-warning"],
    preprocessResult: {
      chunks: [{ id: "chunk-1", content: "chunk body" }],
      blocks: [{ id: "block-1", text: "block body" }]
    }
  };

  const documentParsingRuntime = {
    parseDocuments: vi.fn(async (input) => {
      documentParsingRuntime.lastInput = input;
      return documentParseResult;
    })
  };

  const emailRulesModule = {
    loadEmailRules: vi.fn(async () => ({ rules: ["rule-1"] }))
  };

  const analysisModule = {
    runConfiguredAnalysisModule: vi.fn(async (input) => {
      analysisModule.lastInput = input;
      return {
        runtimeInfo: { moduleId: "analysis-module-1", variant: "mock" },
        analysis: {
          overview: { timelineCount: 0, title: "overview" },
          emails: [{ id: "email-1" }],
          threads: [{ id: "thread-1" }],
          transactions: [{ id: "txn-initial" }],
          people: [{ id: "person-1" }],
          timeline: [{ id: "event-initial" }],
          network: { nodes: [] },
          associations: [{ id: "assoc-1" }],
          retrieval: { matched: 1 }
        }
      };
    }),
    listAvailableAnalysisModules: vi.fn(async () => ["analysis-module-1", "analysis-module-2"])
  };

  const preprocessResultModule = {
    summarizePreprocessResult: vi.fn((value) => ({
      chunkCount: value.chunks.length,
      blockCount: value.blocks.length
    }))
  };

  loadKnowledgeDocumentParsingRuntimeMock.mockResolvedValue({
    createDocumentParsingRuntime: () => documentParsingRuntime
  });
  loadKnowledgeEmailRulesRuntimeMock.mockResolvedValue(emailRulesModule);
  loadKnowledgeAnalysisRuntimeMock.mockResolvedValue(analysisModule);
  loadKnowledgePreprocessResultRuntimeMock.mockResolvedValue(preprocessResultModule);
  loadKnowledgeNormalizedDocumentsRuntimeMock.mockResolvedValue({
    generateNormalizedDocuments: vi.fn(async (input) => {
      return {
        documents: [{ id: "doc-1", batchId: input.jobId }],
        manifest: { manifestId: "manifest-1" },
        warnings: ["normalized-warning"]
      };
    })
  });
  resolveUploadSessionFilesMock.mockResolvedValue([
    { id: "upload-1", path: "uploads/document-1.eml" }
  ]);

  return {
    documentParsingRuntime,
    documentParseResult,
    emailRulesModule,
    analysisModule,
    preprocessResultModule
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("work queue pipeline extra coverage", () => {
  beforeEach(() => {
    saveSettingsMock.mockClear();
    loadKnowledgeFileProcessorRuntimeMock.mockClear();
    loadKnowledgeDocumentParsingRuntimeMock.mockClear();
    loadKnowledgeEmailRulesRuntimeMock.mockClear();
    loadKnowledgeAnalysisRuntimeMock.mockClear();
    loadKnowledgePreprocessResultRuntimeMock.mockClear();
    loadKnowledgeNormalizedDocumentsRuntimeMock.mockClear();
    resolveUploadSessionFilesMock.mockClear();
  });

  it("returns null for missing deletion targets and leaves the coordinator idle", async () => {
    const userDataPath = await tempDir("pact-work-queue-delete-null-");
    const jobManager = {
      getJob: vi.fn(async () => null),
      deleteJob: vi.fn(async () => null)
    };
    const metadataStore = createDeletionMetadataStore(userDataPath);
    const coordinator = createBatchDeletionCoordinator({
      userDataPath,
      jobManager,
      metadataStore
    });

    await expect(coordinator.deleteBatch("missing-batch")).resolves.toBeNull();
    expect(jobManager.deleteJob).not.toHaveBeenCalled();
    expect(metadataStore.upsertDeletionOperation).not.toHaveBeenCalled();
  });

  it("deletes runtime, metadata, and artifacts in order for a batch", async () => {
    const userDataPath = await tempDir("pact-work-queue-delete-ok-");
    const objectRootPath = path.join(userDataPath, "objects");
    const jobDirectory = path.join(userDataPath, "jobs", "job-1");
    const objectBatchPath = path.join(userDataPath, "batch-artifacts", "batch-1");
    const rawFileA = path.join(objectRootPath, "batch-1", "raw", "one.txt");
    const rawFileB = path.join(objectRootPath, "batch-1", "raw", "nested", "two.txt");

    await writeFile(rawFileA, "one");
    await writeFile(rawFileB, "two");
    await writeFile(path.join(jobDirectory, "meta.json"), "{}");
    await writeFile(path.join(objectBatchPath, "marker.txt"), "marker");

    const jobManager = {
      getJob: vi.fn(async () => ({ id: "job-1", archiveBatchId: "batch-1" })),
      deleteJob: vi.fn(async (jobId) => ({ id: jobId, deleted: true }))
    };
    const knowledgeBase = {
      deleteBatch: vi.fn(async () => undefined)
    };
    const metadataStore = createDeletionMetadataStore(userDataPath, {
      rawObjectPaths: new Map([["batch-1", ["objects/batch-1/raw/one.txt", "objects/batch-1/raw/nested/two.txt"]]]),
      artifactPaths: new Map([["batch-1", { batchId: "batch-1", objectRootPath }]])
    });
    metadataStore.seedBatch("batch-1", { job_id: "job-1" });
    metadataStore.upsertDeletionOperation({
      batchId: "batch-1",
      jobId: "job-1",
      status: "runtime_pending",
      state: {
        jobId: "job-1",
        jobDirectory,
        objectBatchPath,
        objectRootPath,
        rawObjectPaths: ["objects/batch-1/raw/one.txt", "objects/batch-1/raw/nested/two.txt"],
        runtimeDeleted: false,
        metadataDeleted: false,
        artifactsDeleted: false
      }
    });
    const coordinator = createBatchDeletionCoordinator({
      userDataPath,
      jobManager,
      metadataStore,
      runtime: { mounts: { knowledgeBase } }
    });

    await expect(coordinator.deleteBatch("batch-1")).resolves.toMatchObject({
      ok: true,
      batchId: "batch-1",
      deletedJob: { id: "job-1", deleted: true }
    });

    expect(jobManager.deleteJob).toHaveBeenCalledWith("job-1");
    expect(knowledgeBase.deleteBatch).toHaveBeenCalledWith("batch-1");
    expect(metadataStore.deleteBatchRecords).toHaveBeenCalledWith("batch-1");
    expect(metadataStore.deleteBatchRow).toHaveBeenCalledWith("batch-1");
    expect(metadataStore.deleteDeletionOperation).toHaveBeenCalled();
    expect(await fileExists(rawFileA)).toBe(false);
    expect(await fileExists(rawFileB)).toBe(false);
    expect(await fileExists(path.join(jobDirectory, "meta.json"))).toBe(false);
    expect(await fileExists(path.join(objectBatchPath, "marker.txt"))).toBe(false);
    expect(await fileExists(path.join(objectRootPath, "batch-1", "raw"))).toBe(false);
  });

  it("records a retryable status when runtime deletion fails", async () => {
    const userDataPath = await tempDir("pact-work-queue-delete-fail-");
    const jobManager = {
      getJob: vi.fn(async () => ({ id: "job-fail", archiveBatchId: "batch-fail" })),
      deleteJob: vi.fn(async () => {
        throw new Error("runtime delete failed");
      })
    };
    const metadataStore = createDeletionMetadataStore(userDataPath);
    metadataStore.seedBatch("batch-fail", { job_id: "job-fail" });
    metadataStore.upsertDeletionOperation({
      batchId: "batch-fail",
      jobId: "job-fail",
      status: "runtime_pending",
      state: {
        jobId: "job-fail",
        jobDirectory: path.join(userDataPath, "jobs", "job-fail"),
        objectRootPath: path.join(userDataPath, "objects"),
        rawObjectPaths: ["objects/batch-fail/raw/one.txt"],
        runtimeDeleted: false,
        metadataDeleted: false,
        artifactsDeleted: false
      }
    });
    const coordinator = createBatchDeletionCoordinator({
      userDataPath,
      jobManager,
      metadataStore
    });

    await expect(coordinator.deleteBatch("batch-fail")).rejects.toThrow("runtime delete failed");
    expect(metadataStore.updateDeletionOperation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "metadata_pending",
        error: "runtime delete failed"
      })
    );
    expect(metadataStore.deleteDeletionOperation).not.toHaveBeenCalled();
  });

  it("resumes partially completed deletions by skipping finished phases", async () => {
    const userDataPath = await tempDir("pact-work-queue-delete-resume-");
    const objectRootPath = path.join(userDataPath, "objects");
    const jobDirectory = path.join(userDataPath, "jobs", "job-resume");
    const objectBatchPath = path.join(userDataPath, "batch-artifacts", "batch-resume");
    const rawFile = path.join(objectRootPath, "batch-resume", "raw", "resume.txt");

    await writeFile(rawFile, "resume");
    await writeFile(path.join(jobDirectory, "meta.json"), "{}");
    await writeFile(path.join(objectBatchPath, "marker.txt"), "marker");

    const jobManager = {
      getJob: vi.fn(async () => null),
      deleteJob: vi.fn(async () => {
        throw new Error("should not be called");
      })
    };
    const metadataStore = createDeletionMetadataStore(userDataPath, {
      pendingOperations: [
        {
          operationId: "op-resume",
          batchId: "batch-resume",
          jobId: "job-resume",
          status: "artifact_cleanup_pending",
          state: {
            jobId: "job-resume",
            jobDirectory,
            objectBatchPath,
            objectRootPath,
            rawObjectPaths: ["objects/batch-resume/raw/resume.txt"],
            runtimeDeleted: true,
            metadataDeleted: true,
            artifactsDeleted: false
          }
        }
      ],
      rawObjectPaths: new Map([["batch-resume", ["objects/batch-resume/raw/resume.txt"]]]),
      artifactPaths: new Map([["batch-resume", { batchId: "batch-resume", objectRootPath }]])
    });
    const knowledgeBase = {
      deleteBatch: vi.fn(async () => {
        throw new Error("should not be called");
      })
    };
    const coordinator = createBatchDeletionCoordinator({
      userDataPath,
      jobManager,
      metadataStore,
      runtime: { mounts: { knowledgeBase } }
    });

    await expect(coordinator.resumePendingDeletions()).resolves.toBeUndefined();

    expect(jobManager.deleteJob).not.toHaveBeenCalled();
    expect(knowledgeBase.deleteBatch).not.toHaveBeenCalled();
    expect(metadataStore.deleteBatchRecords).not.toHaveBeenCalled();
    expect(metadataStore.deleteBatchRow).not.toHaveBeenCalled();
    expect(metadataStore.deleteDeletionOperation).toHaveBeenCalledWith("op-resume");
    expect(await fileExists(rawFile)).toBe(false);
    expect(await fileExists(path.join(jobDirectory, "meta.json"))).toBe(false);
    expect(await fileExists(path.join(objectBatchPath, "marker.txt"))).toBe(false);
  });

  it("runs the full job pipeline with upload session inputs and post-commit hooks", async () => {
    createAnalysisRuntimeMock();

    const userDataPath = await tempDir("pact-work-queue-pipeline-ok-");
    const metadataStore = {
      beginBatch: vi.fn(),
      persistSources: vi.fn(),
      persistPreprocessResult: vi.fn(),
      persistAnalysis: vi.fn(),
      resolveTransactionLifecycle: vi.fn(() => ({
        transactions: [{ id: "txn-final" }],
        timeline: [{ id: "event-final" }],
        summary: { lifecycleState: "complete" }
      }))
    };
    const executionView = {
      metadataStore,
      marker: "execution-view",
      postCommitHooks: []
    };
    const postCommitHook = {
      execute: vi.fn(async () => undefined)
    };
    const runtime = {
      runtimeOptions: {
        featureRuntime: {
          activeFeatureIds: ["document-parser"]
        }
      },
      createExecutionView: vi.fn(() => executionView),
      postCommitHooks: [postCommitHook],
      metadataStore
    };
    const reportProgress = vi.fn();
    const pipeline = createJobPipeline({
      userDataPath,
      payload: {
        archiveBatchId: "archive-batch-1",
        settings: { theme: "dark" },
        uploadSessionId: "upload-session-1",
        inputText: "hello world",
        filePaths: ["inbox/document-1.eml"],
        documentParsing: {
          expectedOutput: "chunks",
          pipelineId: "pipeline-1",
          chunking: { size: 2 }
        },
        checkpointReceipt: {
          clientUid: "client-from-payload",
          sourceType: "mail",
          providerId: "provider-from-payload",
          externalId: "external-from-payload",
          syncBatchId: "sync-from-payload",
          contentHash: "hash-from-payload",
          capturedAt: "2026-06-02T00:00:00.000Z"
        }
      },
      runtime,
      reportProgress,
      jobId: "job-pipeline-1",
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    executionView.postCommitHooks = [postCommitHook];

    const context = pipeline.createContext();
    const result = await pipeline.run(context);

    expect(context.runtime).toBe(executionView);
    expect(context.metadataStore).toBe(metadataStore);
    expect(saveSettingsMock).toHaveBeenCalledWith(userDataPath, { theme: "dark" });
    expect(loadKnowledgeFileProcessorRuntimeMock).toHaveBeenCalledTimes(1);
    expect(loadKnowledgeDocumentParsingRuntimeMock).toHaveBeenCalledTimes(1);
    expect(loadKnowledgeEmailRulesRuntimeMock).toHaveBeenCalledTimes(1);
    expect(loadKnowledgeAnalysisRuntimeMock).toHaveBeenCalledTimes(1);
    expect(loadKnowledgePreprocessResultRuntimeMock).toHaveBeenCalledTimes(1);
    expect(resolveUploadSessionFilesMock).toHaveBeenCalledWith(userDataPath, "upload-session-1");
    expect(metadataStore.beginBatch).toHaveBeenCalledWith({
      batchId: "archive-batch-1",
      jobId: "job-pipeline-1",
      generatedAt: "2026-06-05T00:00:00.000Z",
      settings: { theme: "dark", saved: true }
    });
    expect(metadataStore.persistSources).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "archive-batch-1",
        rules: { rules: ["rule-1"] },
        sources: expect.arrayContaining([expect.objectContaining({ id: "source-1" })]),
        warnings: expect.arrayContaining(["parse-warning", "normalized-warning"])
      })
    );
    expect(metadataStore.persistPreprocessResult).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "archive-batch-1",
        preprocessResult: expect.objectContaining({
          chunks: [{ id: "chunk-1", content: "chunk body" }]
        })
      })
    );
    expect(metadataStore.resolveTransactionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "archive-batch-1",
        transactions: [{ id: "txn-initial" }]
      })
    );
    expect(metadataStore.persistAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "archive-batch-1",
        result: expect.objectContaining({
          lifecycle: { lifecycleState: "complete" }
        })
      })
    );
    expect(postCommitHook.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "archive-batch-1",
        jobId: "job-pipeline-1",
        result
      })
    );
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 8, stage: "保存配置" });
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 26, stage: "解析输入文档" });
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 54, stage: "正文结构已提取" });
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 76, stage: "分析事务与人物网络" });
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 94, stage: "生成归一化 DOCX 知识文档" });
    expect(reportProgress).toHaveBeenCalledWith({ progressPercent: 100, stage: "结果已生成" });
    expect(result).toMatchObject({
      batchId: "archive-batch-1",
      jobId: "job-pipeline-1",
      lifecycle: { lifecycleState: "complete" },
      analysisRuntime: {
        moduleId: "analysis-module-1",
        variant: "mock",
        availableModules: ["analysis-module-1", "analysis-module-2"],
        selectedModuleId: "analysis-module-1"
      },
      normalizedDocuments: {
        documents: [{ id: "doc-1" }],
        manifest: { manifestId: "manifest-1" },
        warnings: ["normalized-warning"]
      }
    });
    expect(result.preprocessSummary).toEqual({ chunkCount: 1, blockCount: 1 });
    expect(result.sourceFiles[0]).toMatchObject({
      id: "source-1",
      rawObjectId: "raw-1",
      clientUid: "client-from-raw",
      sourceType: "mail",
      providerId: "provider-1",
      externalId: "external-1",
      syncBatchId: "sync-1",
      contentHash: "hash-1",
      capturedAt: "2026-06-01T00:00:00.000Z",
      sourceMetadata: { origin: "raw" },
      archiveFileName: "archive-1.eml",
      originalFileName: "original-1.eml",
      originalRelativePath: "archive/original-1.eml",
      storageRelativePath: "objects/raw-1/original-1.eml",
      rawObjectSha256: "sha-1",
      rawObjectByteSize: 42,
      documentParserId: "",
      documentMetadata: {},
      embeddedDocuments: [],
      visualElements: []
    });
    expect(result.overview.timelineCount).toBe(1);
    expect(result.transactions).toEqual([{ id: "txn-final" }]);
    expect(result.timeline).toEqual([{ id: "event-final" }]);
  });

  it("fails fast when the document parser feature is not active", async () => {
    const userDataPath = await tempDir("pact-work-queue-pipeline-gated-");
    const metadataStore = {
      beginBatch: vi.fn(),
      persistSources: vi.fn(),
      persistPreprocessResult: vi.fn(),
      persistAnalysis: vi.fn(),
      resolveTransactionLifecycle: vi.fn()
    };
    const runtime = {
      runtimeOptions: {
        featureRuntime: {
          activeFeatureIds: ["analysis-only"]
        }
      },
      metadataStore
    };
    const pipeline = createJobPipeline({
      userDataPath,
      payload: {
        settings: { theme: "light" }
      },
      runtime,
      reportProgress: vi.fn(),
      jobId: "job-gated",
      generatedAt: "2026-06-05T00:00:00.000Z"
    });

    const context = pipeline.createContext();
    expect(context.runtime).toBe(runtime);
    expect(context.metadataStore).toBe(metadataStore);
    await expect(pipeline.run(context)).rejects.toThrow(
      "Document parser feature is not active in this feature edition."
    );
    expect(saveSettingsMock).toHaveBeenCalledWith(userDataPath, { theme: "light" });
    expect(loadKnowledgeFileProcessorRuntimeMock).not.toHaveBeenCalled();
    expect(loadKnowledgeDocumentParsingRuntimeMock).not.toHaveBeenCalled();
  });
});
