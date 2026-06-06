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
  logDir: "/tmp/pact-runtime-jobs-http-final-extra-3/logs",
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
const createClientRuntimeAllocatorMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPlanMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPullMock = vi.hoisted(() => vi.fn());
const registerQueueStartedMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueHeartbeatMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueClosedMock = vi.hoisted(() => vi.fn(async () => undefined));
const inspectQueueMonitorMock = vi.hoisted(() => vi.fn());
const acknowledgeQueueMonitorAlertMock = vi.hoisted(() => vi.fn());
const requirePlatformInterfaceMock = vi.hoisted(() => vi.fn());
const createServerCompositionRootMock = vi.hoisted(() => vi.fn());
const ensureConsoleOwnerMock = vi.hoisted(() => vi.fn());
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
const readRequestBodyMock = vi.hoisted(() => vi.fn());
const currentCoreProvider = vi.hoisted(() => ({ value: null }));
const currentForwardTarget = vi.hoisted(() => ({ value: "" }));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: summarizeErrorMock,
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" })),
    atomicWriteJsonThroughState: vi.fn(async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    }),
    removeImportCheckpoint: vi.fn(async () => undefined),
    deleteUploadSession: vi.fn(async () => undefined),
    checkpointTreeId: vi.fn((kind, id) => `checkpoint-tree:${kind}:${id}`),
    workflowId: vi.fn((kind, id) => `workflow:${kind}:${id}`),
    unifiedRegistrationForTask: vi.fn((_job, registration) => ({ ...registration })),
    isServerToken: vi.fn((value, prefix) => String(value || "").startsWith(`${prefix}:`)),
    serverToken: vi.fn((prefix, ...parts) => `${prefix}:${parts.map((part) => String(part || "")).join(":")}`),
    deleteCheckpointTree: vi.fn(async () => undefined),
    finishCheckpointTree: vi.fn(async () => undefined),
    startCheckpointTree: vi.fn(async () => undefined),
    upsertCheckpointNode: vi.fn(async () => undefined),
    resolveStoredObjectPath: vi.fn((userDataPath, relativePath) => path.join(userDataPath, relativePath))
  };
});

vi.mock("../../../server/services/client/work-queue-core/batch-deletion-coordinator.mjs", () => ({
  createBatchDeletionCoordinator: createBatchDeletionCoordinatorMock
}));

vi.mock("../../../server/services/client/client-runtime-core/client-runtime-allocator.mjs", () => ({
  createClientRuntimeAllocator: createClientRuntimeAllocatorMock
}));

vi.mock("../../../server/services/client/client-runtime-core/client-runtime-bootstrap.mjs", () => ({
  buildClientRuntimeBootstrapPlan: buildClientRuntimeBootstrapPlanMock,
  buildClientRuntimeBootstrapPull: buildClientRuntimeBootstrapPullMock
}));

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/client/work-queue-core/queue-monitor.mjs");
  return {
    ...actual,
    acknowledgeQueueMonitorAlert: acknowledgeQueueMonitorAlertMock,
    inspectQueueMonitor: inspectQueueMonitorMock,
    registerQueueClosed: registerQueueClosedMock,
    registerQueueHeartbeat: registerQueueHeartbeatMock,
    registerQueueStarted: registerQueueStartedMock
  };
});

vi.mock("../../../server/platform/interactive/platform-registry.mjs", () => ({
  requirePlatformInterface: requirePlatformInterfaceMock
}));

vi.mock("../../../server/platform/interactive/composition-root.mjs", () => ({
  createServerCompositionRoot: createServerCompositionRootMock,
  ensureConsoleOwner: ensureConsoleOwnerMock
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
    getDataDir: () => "/tmp/pact-runtime-jobs-http-final-extra-3"
  }
}));

vi.mock("../../../server/platform/common/console/http/http-utils.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/console/http/http-utils.mjs");
  return {
    ...actual,
    readRequestBody: readRequestBodyMock
  };
});

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";
import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { startHttpServer } from "../../../server/services/server-runtime/http-server.mjs";

const { createJobManager: actualCreateJobManager } = await vi.importActual(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs"
);

let serverHandle = null;
let upstreamServer = null;
let tempDirs = [];

function createResponseCapture() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    bodyBuffer() {
      return Buffer.concat(this.chunks);
    },
    json() {
      return JSON.parse(this.bodyBuffer().toString("utf8") || "{}");
    }
  };
}

function createRequiredUploadSessionStore(overrides = {}) {
  return {
    appendUploadSessionChunk: vi.fn(async () => ({
      ok: true,
      session: {
        sessionId: "session-1",
        checkpointId: "checkpoint-1",
        manifestDigest: "manifest-1",
        status: "receiving",
        files: []
      }
    })),
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
    getUploadSession: vi.fn(async () => ({
      sessionId: "session-1",
      checkpointId: "checkpoint-1",
      manifestDigest: "manifest-1",
      status: "receiving",
      files: []
    })),
    ...overrides
  };
}

function createRequiredJobWorkflow(overrides = {}) {
  return {
    createJob: vi.fn(async () => null),
    getJob: vi.fn(async () => null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async () => null),
    listJobs: vi.fn(async () => ({ summary: {}, items: [] })),
    reparseJob: vi.fn(async () => null),
    ...overrides
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

function buildCompositionRoot(coreProvider) {
  const consoleAuth = {
    close: vi.fn().mockResolvedValue(undefined),
    getSessionFromRequest: vi.fn().mockReturnValue(null)
  };
  const securityPermissions = {
    authorizeOperation: vi.fn()
  };
  const operationAuditStore = {
    close: vi.fn().mockResolvedValue(undefined)
  };
  const metadataStore = {
    listPendingDeletionOperations: vi.fn().mockReturnValue([])
  };

  return {
    featureRuntime: {
      edition: "community",
      activeFeatureIds: [],
      disabledFeatureIds: []
    },
    allApiOperationCount: 1,
    activeApiOperations: [{ id: "system.interfaces" }],
    publicFeatures: () => ({
      allFeatureIds: [],
      systemFeatures: []
    }),
    isFeatureActive: () => false,
    isAnyFeatureActive: () => false,
    platformRegistry: {
      requireInterface: (id) => {
        const map = {
          "storage.metadataStore": { value: metadataStore },
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
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope: "/tmp/pact-runtime-jobs-http-final-extra-3-scope",
    protocolEventBus: {
      publish: vi.fn().mockResolvedValue(undefined)
    },
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: createRequiredUploadSessionStore()
    },
    storageProvider: {
      readRawObjectById: vi.fn(async () => null)
    },
    devopsProvider: {},
    metadataStore
  };
}

function createMockCoreProvider() {
  return {
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false }));
    }),
    shouldProxyRegisteredApiRequest: vi.fn().mockReturnValue(false),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => {
      if (operationId === "system.interfaces") {
        return { statusCode: 200, payload: { ok: true } };
      }
      if (operationId === "discovery.get_config") {
        return {
          statusCode: 200,
          payload: {
            config: {
              serverId: "srv-1",
              activeServiceUrl: "http://127.0.0.1:7728"
            }
          }
        };
      }
      return { statusCode: 200, payload: { ok: true } };
    })
  };
}

async function withTempDir(prefix, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function seedPersistedJob(userDataPath, jobId, meta, payload = null, result = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta), "utf8");
  if (payload !== null) {
    await fs.writeFile(path.join(jobDir, "payload.json"), JSON.stringify(payload), "utf8");
  }
  if (result !== null) {
    await fs.writeFile(path.join(jobDir, "result.json"), JSON.stringify(result), "utf8");
  }
}

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

beforeEach(() => {
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  durableWorkflowRuntimeMock.startWorkflow.mockClear();
  durableWorkflowRuntimeMock.recoverWorkflow.mockClear();
  durableWorkflowRuntimeMock.scheduleActivity.mockClear();
  durableWorkflowRuntimeMock.startActivity.mockClear();
  durableWorkflowRuntimeMock.completeActivity.mockClear();
  durableWorkflowRuntimeMock.failActivity.mockClear();
  durableWorkflowRuntimeMock.failWorkflow.mockClear();
  durableWorkflowRuntimeMock.completeWorkflow.mockClear();
  durableWorkflowRuntimeMock.recordSignal.mockClear();
  durableWorkflowRuntimeMock.heartbeatActivity.mockClear();
  durableWorkflowRuntimeMock.getWorkflow.mockClear();
  durableWorkflowRuntimeMock.listWorkflows.mockClear();
  createBatchDeletionCoordinatorMock.mockClear();
  createClientRuntimeAllocatorMock.mockClear();
  buildClientRuntimeBootstrapPlanMock.mockClear();
  buildClientRuntimeBootstrapPullMock.mockClear();
  registerQueueStartedMock.mockClear();
  registerQueueHeartbeatMock.mockClear();
  registerQueueClosedMock.mockClear();
  inspectQueueMonitorMock.mockClear();
  acknowledgeQueueMonitorAlertMock.mockClear();
  requirePlatformInterfaceMock.mockClear();
  createServerCompositionRootMock.mockClear();
  ensureConsoleOwnerMock.mockClear();
  createServerRuntimeProvidersMock.mockClear();
  createServerToolManagementPlatformMock.mockClear();
  createServerToolSkillManagementProviderMock.mockClear();
  loadDiscoveryConfigMock.mockClear();
  resolveDiscoveryStateMock.mockClear();
  saveDiscoveryConfigMock.mockClear();
  createJobWorkflowProviderMock.mockClear();
  createRuntimeLoggerMock.mockClear();
  setRuntimeLoggerMock.mockClear();
  summarizeErrorMock.mockClear();
  createTraceContextMock.mockClear();
  runWithTraceContextMock.mockClear();
  setTraceContextOnRequestMock.mockClear();
  handlePactMcpHttpRequestMock.mockClear();
  loadOrCreateMcpIdentityMock.mockClear();
  createSystemControllerMock.mockClear();
  readRequestBodyMock.mockClear();

  currentCoreProvider.value = createMockCoreProvider();
  currentForwardTarget.value = "";

  createRuntimeLoggerMock.mockReturnValue(loggerMock);
  setRuntimeLoggerMock.mockImplementation(() => {});
  summarizeErrorMock.mockImplementation((error) => error instanceof Error ? error.message : "internal");
  createTraceContextMock.mockReturnValue({ traceId: "trace-id" });
  runWithTraceContextMock.mockImplementation(async (_context, callback) => callback());
  setTraceContextOnRequestMock.mockImplementation(() => {});
  handlePactMcpHttpRequestMock.mockResolvedValue(false);
  loadOrCreateMcpIdentityMock.mockResolvedValue({ identity: "identity-1" });
  requirePlatformInterfaceMock.mockImplementation((platformRegistry, id) => platformRegistry.requireInterface(id));
  ensureConsoleOwnerMock.mockResolvedValue({ created: false });
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined)
  });
  createBatchDeletionCoordinatorMock.mockReturnValue({
    deleteBatch: vi.fn(async () => ({ ok: false })),
    resumePendingDeletions: vi.fn(async () => undefined),
    close: vi.fn()
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});
  createSystemControllerMock.mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) });
  createServerRuntimeProvidersMock.mockImplementation(() => createRuntimeProviders());
  createJobWorkflowProviderMock.mockReturnValue(createRequiredJobWorkflow());
  createServerCompositionRootMock.mockImplementation(async () => buildCompositionRoot(currentCoreProvider.value));
  loadDiscoveryConfigMock.mockResolvedValue({});
  resolveDiscoveryStateMock.mockImplementation(async (_userDataPath, { listenUrl } = {}) => ({
    serverId: "srv-1",
    mode: "forward",
    advertisedBaseUrl: listenUrl || "http://local",
    activeServiceUrl: listenUrl || "http://local",
    forwardBaseUrl: currentForwardTarget.value || listenUrl || "http://local"
  }));
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  readRequestBodyMock.mockImplementation(async (request) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  });
});

afterEach(async () => {
  await Promise.all([
    serverHandle?.close?.().catch(() => {}),
    upstreamServer
      ? new Promise((resolve) => upstreamServer.close(resolve)).catch(() => {})
      : Promise.resolve()
  ]);
  serverHandle = null;
  upstreamServer = null;
  currentForwardTarget.value = "";
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("runtime jobs/http final extra 3", () => {
  it("会直接读取已完成任务的 result.json", async () => {
    await withTempDir("pact-runtime-job-manager-final-extra-3-result-", async (userDataPath) => {
      const jobId = "completed-job";
      const result = {
        ok: true,
        markdown: "# Result"
      };

      await seedPersistedJob(userDataPath, jobId, {
        id: jobId,
        status: "completed",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:10.000Z",
        finishedAt: "2026-06-05T08:00:10.000Z",
        checkpointId: "checkpoint:completed-job"
      }, {
        inputText: "done"
      }, result);

      const manager = actualCreateJobManager({
        userDataPath,
        processingEnabled: false
      });

      await expect(manager.getJobResult(jobId)).resolves.toEqual(result);
      await manager.close();
    });
  });

  it("删除 queued 任务后会从列表和磁盘中一起移除", async () => {
    await withTempDir("pact-runtime-job-manager-final-extra-3-delete-", async (userDataPath) => {
      const manager = actualCreateJobManager({
        userDataPath,
        processingEnabled: false
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "delete-checkpoint"
        },
        checkpointId: "delete-checkpoint",
        inputText: "remove me"
      });

      const deleted = await manager.deleteJob(created.id);
      const listed = await manager.listJobs({ limit: 10 });
      const jobDir = path.join(userDataPath, "jobs", created.id);

      expect(deleted).toMatchObject({
        id: created.id,
        status: "queued"
      });
      expect(listed.summary).toMatchObject({
        totalCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        processingMode: "external"
      });
      await expect(manager.getJob(created.id)).resolves.toBeNull();
      await expect(fs.stat(jobDir)).rejects.toThrow();
      await manager.close();
    });
  });

  it("重解析没有可恢复原始输入时会给出明确失败", async () => {
    await withTempDir("pact-runtime-job-manager-final-extra-3-reparse-", async (userDataPath) => {
      const jobId = "historical-job";
      await seedPersistedJob(userDataPath, jobId, {
        id: jobId,
        status: "completed",
        createdAt: "2026-06-05T09:00:00.000Z",
        updatedAt: "2026-06-05T09:01:00.000Z",
        finishedAt: "2026-06-05T09:01:00.000Z",
        checkpointId: "checkpoint:historical-job"
      }, {}, null);

      const manager = actualCreateJobManager({
        userDataPath,
        processingEnabled: false
      });

      await expect(manager.reparseJob(jobId)).rejects.toThrow(
        "历史任务没有保留可重新解析的原始文件或正文。请重新上传原文件后再解析。"
      );
      await manager.close();
    });
  });

  it("会保留归一化文档标题并在 raw object 缺省 content-type 时使用默认值", async () => {
    await withTempDir("pact-runtime-jobs-controller-final-extra-3-", async (userDataPath) => {
      const documentPath = path.join(userDataPath, "normalized-body.txt");
      await fs.writeFile(documentPath, "normalized body", "utf8");

      const controller = createJobsController({
        userDataPath,
        jobWorkflowProvider: createRequiredJobWorkflow({
          getJob: vi.fn(async (jobId) => ({ id: jobId, status: "completed" }))
        }),
        storageProvider: {
          readRawObjectById: vi.fn(async () => ({
            fileName: "raw.txt",
            buffer: Buffer.from("raw-body")
          }))
        },
        deletionCoordinator: {
          deleteBatch: vi.fn(async () => ({ ok: false }))
        },
        getDiscoveryState: () => ({
          mode: "local",
          advertisedBaseUrl: "http://local",
          activeServiceUrl: "http://local"
        }),
        proxyApiRequest: vi.fn(),
        protocolEventBus: {
          publish: vi.fn().mockResolvedValue(undefined)
        },
        loadNormalizedDocumentStore: async () => ({
          loadNormalizedDocumentsManifest: vi.fn(async () => ({
            documents: [{
              documentId: "doc-1",
              id: "doc-1",
              title: "Normalized Title"
            }]
          })),
          normalizedContentType: vi.fn(() => "text/plain; charset=utf-8"),
          resolveNormalizedDocumentEntry: vi.fn((manifest, documentId) => (
            manifest.documents.find((entry) => entry.documentId === documentId || entry.id === documentId) || null
          )),
          resolveNormalizedDocumentPath: vi.fn(() => documentPath)
        }),
        uploadSessionStore: createRequiredUploadSessionStore()
      });

      const documentResponse = createResponseCapture();
      await controller.handleGetNormalizedDocument({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "completed-job",
        documentId: "doc-1",
        response: documentResponse
      });

      expect(documentResponse.statusCode).toBe(200);
      expect(documentResponse.headers["Content-Disposition"]).toContain("Normalized Title");
      expect(documentResponse.bodyBuffer().toString("utf8")).toBe("normalized body");

      const rawResponse = createResponseCapture();
      await controller.handleGetRawObject({
        objectId: "raw-1",
        response: rawResponse
      });

      expect(rawResponse.statusCode).toBe(200);
      expect(rawResponse.headers["Content-Type"]).toBe("application/octet-stream");
      expect(rawResponse.bodyBuffer().toString("utf8")).toBe("raw-body");
    });
  });

  it("会把 /api/jobs 的 GET 和 HEAD 请求当成无正文代理，而 POST 会传递正文", async () => {
    upstreamServer = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on("end", () => {
        response.writeHead(208, {
          "Content-Type": "application/json",
          "X-Upstream": "yes"
        });
        response.end(JSON.stringify({
          method: request.method || "",
          path: request.url || "",
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}`;
    currentForwardTarget.value = upstreamUrl;
    currentCoreProvider.value.shouldProxyRegisteredApiRequest.mockImplementation(({ pathname }) => pathname.startsWith("/api/jobs"));
    currentCoreProvider.value.dispatchRegisteredHttpOperation.mockRejectedValue(new Error("dispatch should not run"));

    serverHandle = await startHttpServer({
      userDataPath: "/tmp/pact-runtime-jobs-http-final-extra-3-server",
      jobManager: {
        close: vi.fn().mockResolvedValue(undefined)
      },
      host: "127.0.0.1",
      port: await getFreePort()
    });

    const getResponse = await fetch(`${serverHandle.url}/api/jobs/job-1?mode=full`, {
      method: "GET"
    });
    const headResponse = await fetch(`${serverHandle.url}/api/jobs/job-1/result`, {
      method: "HEAD"
    });
    const postResponse = await fetch(`${serverHandle.url}/api/jobs/job-1/reparse`, {
      method: "POST",
      headers: {
        "content-type": "text/plain"
      },
      body: "post-body"
    });
    const getBody = await getResponse.json();
    const postBody = await postResponse.json();

    expect(getResponse.status).toBe(208);
    expect(headResponse.status).toBe(208);
    expect(postResponse.status).toBe(208);
    expect(getResponse.headers.get("x-upstream")).toBe("yes");
    expect(postResponse.headers.get("x-upstream")).toBe("yes");
    expect(getBody).toEqual({
      method: "GET",
      path: "/api/jobs/job-1?mode=full",
      body: ""
    });
    expect(postBody).toEqual({
      method: "POST",
      path: "/api/jobs/job-1/reparse",
      body: "post-body"
    });
    expect(readRequestBodyMock).toHaveBeenCalledTimes(1);
    expect(currentCoreProvider.value.dispatchRegisteredHttpOperation).not.toHaveBeenCalled();
  });
});
