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
  logDir: "/tmp/pact-runtime-jobs-http-final-extra-2/logs",
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
const resolvedDiscoveryState = vi.hoisted(() => ({ value: null }));

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
    getDataDir: () => "/tmp/pact-runtime-jobs-http-final-extra-2"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";
import { startHttpServer } from "../../../server/services/server-runtime/http-server.mjs";

const { createJobManager: actualCreateJobManager } = await vi.importActual(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs"
);

let serverHandle = null;
let upstreamServer = null;
const tempDirs = [];

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
    getUploadSession: vi.fn(async (_root, sessionId) => (
      sessionId === "missing"
        ? null
        : {
            sessionId,
            checkpointId: "checkpoint-1",
            manifestDigest: "manifest-1",
            status: "receiving",
            files: []
          }
    )),
    ...overrides
  };
}

function createRequiredJobWorkflow(overrides = {}) {
  const jobs = new Map([
    ["completed", { id: "completed", status: "completed" }],
    ["pending", { id: "pending", status: "running" }]
  ]);

  return {
    createJob: vi.fn(async (payload) => ({ id: "created-job", status: "queued", payload })),
    getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async (jobId) => ({ jobId, ok: true, markdown: "# Result" })),
    listJobs: vi.fn(async ({ limit }) => [{ id: "job-listed", limit }]),
    reparseJob: vi.fn(async (jobId, options) => ({ id: `${jobId}-reparse`, status: "queued", options })),
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const discoveryState = overrides.discoveryState || {
    mode: "local",
    advertisedBaseUrl: "http://local",
    activeServiceUrl: "http://local"
  };
  const uploadSessionStore = overrides.uploadSessionStore || createRequiredUploadSessionStore();
  const jobWorkflowProvider = overrides.jobWorkflowProvider || createRequiredJobWorkflow();
  const storageProvider = overrides.storageProvider || {
    readRawObjectById: vi.fn(async (objectId) => (
      objectId === "raw-1"
        ? { contentType: "text/plain", fileName: "raw.txt", buffer: Buffer.from("raw-body") }
        : null
    ))
  };
  const deletionCoordinator = overrides.deletionCoordinator || {
    deleteBatch: vi.fn(async (jobId) => (jobId === "delete-ok" ? { ok: true, id: jobId } : { ok: false }))
  };
  const protocolEventBus = overrides.protocolEventBus || { publish: vi.fn(async () => ({ ok: true })) };
  const proxyApiRequest = overrides.proxyApiRequest || vi.fn(async ({ response, targetBaseUrl }) => {
    response.writeHead(209, { "Content-Type": "application/json", "X-Proxy-Target": targetBaseUrl });
    response.end(JSON.stringify({ proxied: true, targetBaseUrl }));
  });
  const controller = createJobsController({
    userDataPath: overrides.userDataPath || "/tmp/pact-jobs-controller-test",
    jobWorkflowProvider,
    storageProvider,
    deletionCoordinator,
    getDiscoveryState: () => discoveryState,
    proxyApiRequest,
    protocolEventBus,
    loadNormalizedDocumentStore: overrides.loadNormalizedDocumentStore,
    uploadSessionStore,
    resolveArchiveBatchIdentity: overrides.resolveArchiveBatchIdentity
  });

  return {
    controller,
    deletionCoordinator,
    discoveryState,
    jobWorkflowProvider,
    protocolEventBus,
    proxyApiRequest,
    storageProvider,
    uploadSessionStore
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

function createMockCoreProvider() {
  return {
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false }));
    }),
    shouldProxyRegisteredApiRequest: vi.fn().mockReturnValue(false),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async () => ({
      statusCode: 200,
      payload: { ok: true }
    }))
  };
}

function createServerCompositionRoot(coreProvider) {
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
  const protocolEventBus = {
    publish: vi.fn().mockResolvedValue(undefined)
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
          "storage.provider": { value: { readRawObjectById: vi.fn(async () => null) } },
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
    operationConcurrencyScope: "/tmp/pact-runtime-jobs-http-final-extra-2-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: createRequiredUploadSessionStore()
    },
    storageProvider: { readRawObjectById: vi.fn(async () => null) },
    devopsProvider: {},
    metadataStore
  };
}

function createServerRuntimeProviders() {
  return createRuntimeProviders();
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
  createServerToolManagementPlatformMock.mockReturnValue({ close: vi.fn() });
  createServerToolSkillManagementProviderMock.mockReturnValue({ close: vi.fn() });
  createBatchDeletionCoordinatorMock.mockReturnValue({
    deleteBatch: vi.fn(async () => ({ ok: false })),
    resumePendingDeletions: vi.fn(async () => undefined),
    close: vi.fn()
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});
  createSystemControllerMock.mockReturnValue({ close: vi.fn() });
  createServerRuntimeProvidersMock.mockImplementation(() => createServerRuntimeProviders());
  createJobWorkflowProviderMock.mockReturnValue({
    createJob: vi.fn(async () => null),
    getJob: vi.fn(async () => null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async () => null),
    listJobs: vi.fn(async () => ({ summary: {}, items: [] })),
    reparseJob: vi.fn(async () => null)
  });
  createServerCompositionRootMock.mockImplementation(async (_input) => {
    const coreProvider = createMockCoreProvider();
    const runtimeRoot = createServerCompositionRoot(coreProvider);
    return runtimeRoot;
  });
  loadDiscoveryConfigMock.mockResolvedValue({});
  resolveDiscoveryStateMock.mockImplementation(async (_userDataPath, { listenUrl } = {}) => {
    if (resolvedDiscoveryState.value) {
      return {
        ...resolvedDiscoveryState.value,
        activeServiceUrl: resolvedDiscoveryState.value.activeServiceUrl || listenUrl || ""
      };
    }
    return {
      serverId: "srv-1",
      mode: "local",
      advertisedBaseUrl: listenUrl || "http://local",
      activeServiceUrl: listenUrl || "http://local"
    };
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
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
  resolvedDiscoveryState.value = null;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("runtime jobs/http final extra 2", () => {
  it("让 job manager 的 listJobWorkflows 直接委托给 durable workflow runtime", async () => {
    await withTempDir("pact-runtime-job-manager-final-extra-2-", async (userDataPath) => {
      durableWorkflowRuntimeMock.listWorkflows.mockResolvedValueOnce({
        items: [{ workflowId: "wf-1" }],
        cursor: "next"
      });

      const manager = actualCreateJobManager({
        userDataPath,
        processingEnabled: false
      });

      const result = await manager.listJobWorkflows({ limit: 7, cursor: "abc" });
      expect(durableWorkflowRuntimeMock.listWorkflows).toHaveBeenCalledWith({
        ownerKind: "import_parse_job",
        limit: 7,
        cursor: "abc"
      });
      expect(result).toEqual({
        items: [{ workflowId: "wf-1" }],
        cursor: "next"
      });

      await manager.close();
    });
  });

  it("在 forward 模式下会把 reparse 请求代理出去，而不是调用本地重解析", async () => {
    const { controller, jobWorkflowProvider, proxyApiRequest } = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream",
        activeServiceUrl: "http://active"
      }
    });

    const response = createResponseCapture();
    await controller.handleReparseJob({
      request: { method: "POST", url: "/api/jobs/job-1/reparse" },
      requestBody: Buffer.from(JSON.stringify({ settings: { retryMode: "manual" } })),
      jobId: "job-1",
      response
    });

    expect(response.statusCode).toBe(209);
    expect(proxyApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      targetBaseUrl: "http://upstream"
    }));
    expect(jobWorkflowProvider.reparseJob).not.toHaveBeenCalled();
  });

  it("在 forward 模式下会把删除缺失任务的请求代理出去", async () => {
    const { controller, deletionCoordinator, proxyApiRequest } = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream",
        activeServiceUrl: "http://active"
      }
    });

    const response = createResponseCapture();
    await controller.handleDeleteJob({
      request: { method: "DELETE", url: "/api/jobs/job-missing" },
      requestBody: Buffer.alloc(0),
      jobId: "job-missing",
      response
    });

    expect(response.statusCode).toBe(209);
    expect(deletionCoordinator.deleteBatch).toHaveBeenCalledWith("job-missing");
    expect(proxyApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      targetBaseUrl: "http://upstream"
    }));
  });

  it("在 forward 模式下会把缺失任务结果请求代理出去", async () => {
    const { controller, jobWorkflowProvider, proxyApiRequest } = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream",
        activeServiceUrl: "http://active"
      },
      jobWorkflowProvider: createRequiredJobWorkflow({
        getJob: vi.fn(async () => null)
      })
    });

    const response = createResponseCapture();
    await controller.handleGetJobResult({
      request: { method: "GET", url: "/api/jobs/job-missing/result" },
      requestBody: Buffer.alloc(0),
      jobId: "job-missing",
      response
    });

    expect(response.statusCode).toBe(209);
    expect(proxyApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      targetBaseUrl: "http://upstream"
    }));
    expect(jobWorkflowProvider.getJobResult).not.toHaveBeenCalled();
  });

  it("会在 jobs 相关路径上优先走 registered API 代理边界，而不是进入 registered dispatch", async () => {
    const upstreamBody = { proxied: true };
    upstreamServer = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on("end", () => {
        response.writeHead(208, {
          "Content-Type": "application/json",
          "X-Upstream": "yes"
        });
        response.end(JSON.stringify({
          ...upstreamBody,
          method: request.method || "",
          path: request.url || "",
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}`;
    resolvedDiscoveryState.value = {
      serverId: "srv-1",
      mode: "forward",
      advertisedBaseUrl: "http://local",
      activeServiceUrl: upstreamUrl,
      forwardBaseUrl: upstreamUrl
    };

    const coreProvider = createMockCoreProvider();
    coreProvider.shouldProxyRegisteredApiRequest.mockImplementation(({ pathname }) => pathname.startsWith("/api/jobs"));
    coreProvider.dispatchRegisteredHttpOperation.mockRejectedValue(new Error("dispatch should not run"));
    createServerCompositionRootMock.mockResolvedValueOnce(createServerCompositionRoot(coreProvider));

    serverHandle = await startHttpServer({
      userDataPath: "/tmp/pact-runtime-jobs-http-final-extra-2-server",
      jobManager: {
        close: vi.fn().mockResolvedValue(undefined)
      },
      host: "127.0.0.1",
      port: await getFreePort()
    });

    const response = await fetch(`${serverHandle.url}/api/jobs/job-1`, {
      method: "POST",
      headers: {
        "content-type": "text/plain"
      },
      body: "proxy-body"
    });
    const body = await response.json();

    expect(response.status).toBe(208);
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(body).toEqual({
      proxied: true,
      method: "POST",
      path: "/api/jobs/job-1",
      body: "proxy-body"
    });
    expect(coreProvider.shouldProxyRegisteredApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: "/api/jobs/job-1"
    }));
    expect(coreProvider.dispatchRegisteredHttpOperation).not.toHaveBeenCalled();
  });
});
