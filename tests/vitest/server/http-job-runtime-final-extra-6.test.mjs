import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-http-job-runtime-final-extra-6/logs",
  retentionDays: 7
}));

const durableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async () => null),
  recoverWorkflow: vi.fn(async () => null),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  heartbeatActivity: vi.fn(async () => null),
  getWorkflow: vi.fn(async () => null),
  listWorkflows: vi.fn(async () => ({ items: [] }))
}));

const createBatchDeletionCoordinatorMock = vi.hoisted(() => vi.fn());
const createServerCompositionRootMock = vi.hoisted(() => vi.fn());
const createServerRuntimeProvidersMock = vi.hoisted(() => vi.fn());
const createServerToolManagementPlatformMock = vi.hoisted(() => vi.fn());
const createServerToolSkillManagementProviderMock = vi.hoisted(() => vi.fn());
const loadDiscoveryConfigMock = vi.hoisted(() => vi.fn());
const resolveDiscoveryStateMock = vi.hoisted(() => vi.fn());
const saveDiscoveryConfigMock = vi.hoisted(() => vi.fn());
const createJobWorkflowProviderMock = vi.hoisted(() => vi.fn());
const createRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const setRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => error?.message || String(error || "")));
const createTraceContextMock = vi.hoisted(() => vi.fn());
const runWithTraceContextMock = vi.hoisted(() => vi.fn());
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn());
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());
const uploadWorkerState = vi.hoisted(() => ({ mode: "hold" }));
const spawnedWorkers = vi.hoisted(() => []);

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => {
    const child = new EventEmitter();
    child.pid = 5200;
    child.killed = false;
    child.kill = vi.fn((signal = "SIGTERM") => {
      child.killed = true;
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    });
    child.send = vi.fn(() => {
      if (uploadWorkerState.mode === "autoComplete") {
        queueMicrotask(() => {
          child.emit("message", {
            type: "completed",
            result: {
              emails: [],
              transactions: [],
              people: [],
              warnings: [],
              sourceFiles: []
            }
          });
          child.emit("exit", 0, "SIGTERM");
        });
      }
      return true;
    });
    spawnedWorkers.push(child);
    return child;
  })
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    atomicWriteJsonThroughState: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    },
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    deleteCheckpointTree: vi.fn(async () => undefined),
    finishCheckpointTree: vi.fn(async () => undefined),
    getRuntimeLogger: vi.fn(() => loggerMock),
    queueStateMutation: async (_key, mutator) => mutator(),
    readJsonFile: async (filePath, fallback = {}) => {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") {
          return fallback;
        }
        throw error;
      }
    },
    removeImportCheckpoint: vi.fn(async () => undefined),
    resolveStoredObjectPath: vi.fn((userDataPath, relativePath) => path.join(userDataPath, relativePath)),
    serverToken: vi.fn((kind, value = "") => `${kind}:${String(value || "")}`),
    isServerToken: vi.fn((value, kind) => String(value || "").startsWith(`${kind}:`)),
    startCheckpointTree: vi.fn(async () => undefined),
    summarizeError: summarizeErrorMock,
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" })),
    unifiedRegistrationForTask: vi.fn((job, registration) => ({ ...registration, taskId: job?.id || "" })),
    unifiedRegistrationForQueue: vi.fn((item) => ({ ...item, originalType: "queue" })),
    upsertCheckpointNode: vi.fn(async () => undefined),
    workflowId: vi.fn((kind, id) => `workflow:${kind}:${id}`),
    checkpointTreeId: vi.fn((kind, id) => `checkpoint-tree:${kind}:${id}`)
  };
});

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/client/work-queue-core/queue-monitor.mjs");
  return {
    ...actual,
    queueMonitorId: vi.fn((kind, ownerId) => `queue_${kind}_${ownerId}`),
    registerQueueStarted: vi.fn(async (_userDataPath, input = {}) => ({
      queueId: input.queueId || "",
      status: String(input.status || input.phase || "queued")
    })),
    registerQueueHeartbeat: vi.fn(async (_userDataPath, input = {}) => ({
      queueId: input.queueId || "",
      stage: input.stage || ""
    })),
    registerQueueClosed: vi.fn(async (_userDataPath, input = {}) => ({
      queueId: input.queueId || "",
      status: input.status || "closed"
    }))
  };
});

vi.mock("../../../server/protocols/checkpoint/upload-session-store.mjs", () => ({
  deleteUploadSession: vi.fn(async () => undefined)
}));

vi.mock("../../../server/platform/interactive/composition-root.mjs", () => ({
  createServerCompositionRoot: createServerCompositionRootMock,
  ensureConsoleOwner: vi.fn(async () => ({ created: false }))
}));

vi.mock("../../../server/platform/interactive/server-runtime-providers.mjs", () => ({
  createServerRuntimeProviders: createServerRuntimeProvidersMock,
  createServerToolManagementPlatform: createServerToolManagementPlatformMock,
  createServerToolSkillManagementProvider: createServerToolSkillManagementProviderMock
}));

vi.mock("../../../server/platform/common/platform-core/discovery/config.mjs", () => ({
  loadDiscoveryConfig: loadDiscoveryConfigMock,
  resolveDiscoveryState: resolveDiscoveryStateMock,
  saveDiscoveryConfig: saveDiscoveryConfigMock
}));

vi.mock("../../../server/platform/specialized/console/job-workflow-provider.mjs", () => ({
  createJobWorkflowProvider: createJobWorkflowProviderMock
}));

vi.mock("../../../server/platform/common/observability/runtime-logger.mjs", () => ({
  createRuntimeLogger: createRuntimeLoggerMock,
  setRuntimeLogger: setRuntimeLoggerMock,
  summarizeError: summarizeErrorMock
}));

vi.mock("../../../server/platform/common/observability/trace-context.mjs", () => ({
  createTraceContext: createTraceContextMock,
  runWithTraceContext: runWithTraceContextMock,
  setTraceContextOnRequest: setTraceContextOnRequestMock
}));

vi.mock("../../../server/platform/common/mcp/http-mcp-adapter.mjs", () => ({
  handlePactMcpHttpRequest: handlePactMcpHttpRequestMock
}));

vi.mock("../../../server/platform/common/mcp/identity.mjs", () => ({
  loadOrCreateMcpIdentity: loadOrCreateMcpIdentityMock
}));

vi.mock("../../../server/platform/common/config/ServerConfig.mjs", () => ({
  ServerConfig: {
    getDataDir: () => "/tmp/pact-http-job-runtime-final-extra-6"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

vi.mock("../../../server/services/client/work-queue-core/batch-deletion-coordinator.mjs", () => ({
  createBatchDeletionCoordinator: createBatchDeletionCoordinatorMock
}));

import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";
import { startLocalHttpServer } from "../../../server/services/server-runtime/http-server.mjs";
import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { queueMonitorEventLogPath, queueMonitorStatePath } from "../../../server/services/client/work-queue-core/queue-monitor.mjs";

let serverHandle = null;

async function withTempDir(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function seedJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedJob(userDataPath, jobId, meta, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await seedJson(path.join(jobDir, "meta.json"), { id: jobId, ...meta });
  if (payload !== null) {
    await seedJson(path.join(jobDir, "payload.json"), payload);
  }
}

function createResponseCapture() {
  return {
    statusCode: null,
    headers: {},
    body: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    json() {
      return JSON.parse(Buffer.concat(this.body).toString("utf8") || "{}");
    },
    text() {
      return Buffer.concat(this.body).toString("utf8");
    }
  };
}

function createJobWorkflowProviderStub(overrides = {}) {
  return {
    createJob: vi.fn(),
    getJob: vi.fn(async () => null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async () => ({})),
    listJobs: vi.fn(async () => ({ summary: { totalCount: 0 }, items: [] })),
    reparseJob: vi.fn(async () => ({ id: "reparsed-job", status: "queued" })),
    ...overrides
  };
}

function createUploadSessionStoreStub() {
  return {
    appendUploadSessionChunk: vi.fn(async () => ({ ok: true, session: null })),
    buildCheckpointReceiptFromUploadSession: vi.fn(async () => ({
      checkpointId: "checkpoint-from-session",
      archiveBatchId: "archive-from-session",
      clientUid: "client-session",
      sourceType: "upload-session",
      manifestSha256: "manifest-from-session",
      fileCount: 1,
      files: []
    })),
    createOrResumeUploadSession: vi.fn(async () => ({
      sessionId: "session-1",
      checkpointId: "checkpoint-1",
      manifestDigest: "manifest-1",
      status: "receiving",
      files: []
    })),
    getUploadSession: vi.fn(async () => null)
  };
}

function createServerCompositionRoot(coreProvider) {
  return {
    featureRuntime: {
      edition: "community",
      activeFeatureIds: [],
      disabledFeatureIds: []
    },
    allApiOperationCount: 2,
    activeApiOperations: [{ id: "system.console_state" }],
    publicFeatures: () => ({ allFeatureIds: [], systemFeatures: [] }),
    isFeatureActive: () => false,
    isAnyFeatureActive: () => false,
    platformRegistry: {
      requireInterface: (id) => {
        const map = {
          "storage.metadataStore": {
            value: {
              listPendingDeletionOperations: vi.fn().mockReturnValue([])
            }
          },
          "core.provider": { value: coreProvider },
          "storage.provider": {
            value: {
              readRawObjectById: vi.fn(async () => null)
            }
          },
          "devops.provider": { value: {} }
        };
        return map[id];
      }
    },
    coreProvider,
    runtime: {
      runtimeOptions: { profile: "standard" },
      close: vi.fn().mockResolvedValue(undefined),
      mounts: {}
    },
    moduleManagement: {},
    dataStructures: {},
    consoleAuth: {
      close: vi.fn().mockResolvedValue(undefined),
      getSessionFromRequest: vi.fn().mockReturnValue(null)
    },
    securityPermissions: {
      authorizeOperation: vi.fn()
    },
    operationAuditStore: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    operationConcurrencyScope: "/tmp/pact-http-job-runtime-final-extra-6-scope",
    protocolEventBus: {
      publish: vi.fn().mockResolvedValue(undefined)
    },
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: createUploadSessionStoreStub()
    },
    storageProvider: {
      readRawObjectById: vi.fn(async () => null)
    },
    devopsProvider: {},
    metadataStore: {
      listPendingDeletionOperations: vi.fn().mockReturnValue([])
    }
  };
}

function createRuntimeProviders() {
  return {
    contextRuntime: {},
    maintenanceAgent: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    knowledgeSourceService: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    agentWorkspace: {
      close: vi.fn()
    },
    strategyManagementProvider: {},
    modelDecisionRuntime: {},
    evidenceSufficiencyGate: {},
    knowledgeAgentSkill: {},
    goldenRuleRuntime: {},
    knowledgeRuleAuthoringRuntime: {},
    knowledgeSkillRuntime: {
      close: vi.fn()
    },
    agentEvaluationRuntime: {},
    knowledgeEvolutionRuntime: {},
    summarizationRuntime: {},
    agentExplorationRuntime: {}
  };
}

function createHttpCoreProvider() {
  return {
    shouldProxyRegisteredApiRequest: vi.fn(() => false),
    dispatchRpcOperation: vi.fn(async () => {
      throw Object.assign(new Error("rpc boom"), { statusCode: 422 });
    }),
    dispatchRegisteredHttpOperation: vi.fn(async ({ method, url }) => {
      if (url.pathname === "/api/head-boom") {
        throw new Error(`plain boom:${method}`);
      }
      return false;
    }),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => ({
      statusCode: 200,
      payload: { ok: true, operationId }
    }))
  };
}

async function startTestServer({ distPath = "", coreProvider } = {}) {
  createServerCompositionRootMock.mockResolvedValue(createServerCompositionRoot(coreProvider));
  createServerRuntimeProvidersMock.mockResolvedValue(createRuntimeProviders());
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn()
  });
  createBatchDeletionCoordinatorMock.mockReturnValue({
    deleteBatch: vi.fn(async () => ({ ok: false })),
    resumePendingDeletions: vi.fn().mockResolvedValue(undefined)
  });
  createJobWorkflowProviderMock.mockReturnValue(createJobWorkflowProviderStub());
  createSystemControllerMock.mockReturnValue({ close: vi.fn() });

  loadOrCreateMcpIdentityMock.mockResolvedValue({ identity: "mcp-identity" });
  loadDiscoveryConfigMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local"
  });
  resolveDiscoveryStateMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    advertisedBaseUrl: "http://127.0.0.1:7228",
    mode: "local"
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  createRuntimeLoggerMock.mockReturnValue(loggerMock);
  setRuntimeLoggerMock.mockImplementation(() => undefined);
  createTraceContextMock.mockImplementation(() => ({ traceId: "trace-id" }));
  runWithTraceContextMock.mockImplementation(async (_context, callback) => callback());
  setTraceContextOnRequestMock.mockImplementation(() => undefined);
  handlePactMcpHttpRequestMock.mockResolvedValue(false);

  serverHandle = await startLocalHttpServer({
    userDataPath: "/tmp/pact-http-job-runtime-final-extra-6-server",
    distPath,
    jobManager: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    runtimeOptions: {
      httpRateLimitPerIpPerMinute: 100,
      httpRateLimitPerSubjectPerMinute: 100,
      httpRateLimitLoginPerIpPerMinute: 100
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadWorkerState.mode = "hold";
  spawnedWorkers.length = 0;
});

afterEach(async () => {
  if (serverHandle) {
    await serverHandle.close().catch(() => {});
    serverHandle = null;
  }
});

describe("job manager recovery, payload, delete, and close branches", () => {
  it("recovers persisted jobs with payload and preserves them on close", async () => {
    await withTempDir("pact-job-manager-recovery-", async (userDataPath) => {
      const jobId = "recovery-job";
      await seedJob(
        userDataPath,
        jobId,
        {
          status: "queued",
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          checkpointId: "checkpoint:recovery-job"
        },
        {
          inputText: "recovery payload"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      try {
        await expect(
          waitForCondition(async () => {
            const job = await manager.getJob(jobId);
            return job?.status === "running";
          })
        ).resolves.toBe(true);

        expect(durableWorkflowRuntimeMock.recoverWorkflow).toHaveBeenCalled();
        expect(spawnedWorkers.length).toBeGreaterThan(0);

        await manager.close();

        const closedJob = await manager.getJob(jobId);
        expect(closedJob).toMatchObject({
          id: jobId,
          status: "queued",
          stage: "服务已恢复，任务等待重试。"
        });
        expect(durableWorkflowRuntimeMock.recordSignal).toHaveBeenCalled();
      } finally {
        await manager.close().catch(() => {});
      }
    });
  });

  it("scans persisted queued jobs and fails ones missing payload", async () => {
    await withTempDir("pact-job-manager-scan-", async (userDataPath) => {
      const jobId = "scan-missing-payload";
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      try {
        await seedJob(userDataPath, jobId, {
          status: "queued",
          createdAt: "2026-06-05T08:01:00.000Z",
          updatedAt: "2026-06-05T08:01:00.000Z",
          checkpointId: "checkpoint:scan-missing-payload"
        });

        const scanResult = await manager.scanPersistedQueue();
        expect(scanResult).toMatchObject({
          scanned: true,
          enqueued: 0
        });

        const failedJob = await manager.getJob(jobId);
        expect(failedJob).toMatchObject({
          id: jobId,
          status: "failed",
          stage: "任务恢复失败",
          error: "任务缺少 payload，不能由后台 worker 执行。"
        });
        expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
      } finally {
        await manager.close().catch(() => {});
      }
    });
  });

  it("deletes queued persisted jobs and removes their directory", async () => {
    await withTempDir("pact-job-manager-delete-", async (userDataPath) => {
      const jobId = "delete-job";
      await seedJob(
        userDataPath,
        jobId,
        {
          status: "queued",
          createdAt: "2026-06-05T08:02:00.000Z",
          updatedAt: "2026-06-05T08:02:00.000Z",
          checkpointId: "checkpoint:delete-job"
        },
        {
          inputText: "delete payload"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });
      try {
        const deleted = await manager.deleteJob(jobId);
        expect(deleted).toMatchObject({
          id: jobId,
          status: "queued"
        });
        await expect(fs.stat(path.join(userDataPath, "jobs", jobId))).rejects.toThrow();
        expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
      } finally {
        await manager.close().catch(() => {});
      }
    });
  });
});

describe("jobs controller result, normalized document, and reparse errors", () => {
  it("returns completed results and normalized document downloads, then surfaces reparse errors", async () => {
    await withTempDir("pact-jobs-controller-", async (userDataPath) => {
      const normalizedFilePath = path.join(userDataPath, "normalized", "doc-1.txt");
      await fs.mkdir(path.dirname(normalizedFilePath), { recursive: true });
      await fs.writeFile(normalizedFilePath, "normalized document body", "utf8");

      const getJob = vi.fn(async (jobId) => {
        if (jobId === "completed-job" || jobId === "document-job") {
          return { id: jobId, status: "completed" };
        }
        return null;
      });
      const getJobResult = vi.fn(async () => ({
        resultId: "result-1",
        ok: true
      }));
      const reparseJob = vi.fn(async () => {
        throw new Error("reparse boom");
      });
      const loadNormalizedDocumentStore = vi.fn(async () => ({
        loadNormalizedDocumentsManifest: vi.fn(async () => ({
          documents: [
            {
              documentId: "doc-1",
              relativePath: "normalized/doc-1.txt",
              title: "doc-1"
            }
          ]
        })),
        resolveNormalizedDocumentEntry: vi.fn((_manifest, documentId) =>
          documentId === "doc-1"
            ? {
                documentId: "doc-1",
                relativePath: "normalized/doc-1.txt",
                title: "doc-1"
              }
            : null
        ),
        resolveNormalizedDocumentPath: vi.fn(() => normalizedFilePath),
        normalizedContentType: vi.fn(() => "text/plain; charset=utf-8")
      }));

      const controller = createJobsController({
        userDataPath,
        jobWorkflowProvider: createJobWorkflowProviderStub({
          getJob,
          getJobResult,
          reparseJob
        }),
        storageProvider: {
          readRawObjectById: vi.fn(async () => null)
        },
        deletionCoordinator: {
          deleteBatch: vi.fn(async () => ({ ok: false }))
        },
        getDiscoveryState: () => ({
          mode: "local",
          advertisedBaseUrl: "http://127.0.0.1:9999",
          activeServiceUrl: "http://127.0.0.1:9999"
        }),
        proxyApiRequest: vi.fn(),
        protocolEventBus: {
          publish: vi.fn().mockResolvedValue(undefined)
        },
        loadNormalizedDocumentStore,
        uploadSessionStore: createUploadSessionStoreStub()
      });

      const resultResponse = createResponseCapture();
      await controller.handleGetJobResult({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "completed-job",
        response: resultResponse
      });
      expect(resultResponse.statusCode).toBe(200);
      expect(resultResponse.json()).toEqual({
        resultId: "result-1",
        ok: true
      });

      const documentResponse = createResponseCapture();
      await controller.handleGetNormalizedDocument({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "document-job",
        documentId: "doc-1",
        response: documentResponse
      });
      expect(documentResponse.statusCode).toBe(200);
      expect(documentResponse.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
      expect(String(documentResponse.headers["Content-Disposition"])).toContain("doc-1.txt");
      expect(documentResponse.text()).toBe("normalized document body");

      await expect(
        controller.handleReparseJob({
          request: {},
          requestBody: Buffer.from(JSON.stringify({ settings: { mode: "deep" } })),
          jobId: "completed-job",
          response: createResponseCapture()
        })
      ).rejects.toThrow("reparse boom");
    });
  });
});

describe("http server uncommon route and wrapper branches", () => {
  it("keeps request bodies empty for HEAD and wraps unhandled errors", async () => {
    const coreProvider = createHttpCoreProvider();
    await startTestServer({ coreProvider });

    const response = await fetch(`${serverHandle.url}/api/head-boom`, {
      method: "HEAD"
    });

    expect(response.status).toBe(500);
    expect(coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "HEAD",
        requestBody: Buffer.alloc(0)
      })
    );
    expect(await response.text()).toBe("");
  });

  it("returns root fallback JSON when no dist path is configured", async () => {
    const coreProvider = createHttpCoreProvider();
    await startTestServer({ coreProvider });

    const response = await fetch(`${serverHandle.url}/`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "Pact Server",
      serverId: "srv-1",
      activeServiceUrl: "http://127.0.0.1:7228"
    });
  });
});

async function waitForCondition(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}
