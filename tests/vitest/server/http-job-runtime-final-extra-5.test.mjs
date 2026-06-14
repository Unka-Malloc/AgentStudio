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
  logDir: "/tmp/pact-http-job-runtime-final-extra-5/logs",
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
const uploadWorkerState = vi.hoisted(() => ({ mode: "autoComplete" }));
const spawnedWorkers = vi.hoisted(() => []);

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => {
    const child = new EventEmitter();
    child.pid = 4200;
    child.killed = false;
    child.kill = vi.fn((signal = "SIGTERM") => {
      child.killed = true;
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    });
    child.send = vi.fn(() => {
      if (uploadWorkerState.mode === "hold") {
        return true;
      }
      if (uploadWorkerState.mode === "fail") {
        queueMicrotask(() => {
          child.emit("message", {
            type: "failed",
            error: "mock worker failure"
          });
          child.emit("exit", 1, "SIGTERM");
        });
        return true;
      }
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
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: summarizeErrorMock,
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" })),
    atomicWriteJsonThroughState: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    },
    atomicWriteJson: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    },
    appendJsonLine: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    },
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
    stateFileKey: vi.fn((filePath) => filePath),
    removeImportCheckpoint: vi.fn(async () => undefined),
    resolveStoredObjectPath: vi.fn((userDataPath, relativePath) => path.join(userDataPath, relativePath)),
    checkpointTreeId: vi.fn((kind, id) => `checkpoint-tree:${kind}:${id}`),
    workflowId: vi.fn((kind, id) => `workflow:${kind}:${id}`),
    unifiedRegistrationForTask: vi.fn((_job, registration) => ({ ...registration })),
    unifiedRegistrationForQueue: vi.fn((item) => ({
      ...item,
      originalType: "queue"
    })),
    composeUnifiedSystemStatus: vi.fn((registrations, input = {}) => ({
      source: input.source || "queue-monitor",
      updatedAt: input.updatedAt || new Date().toISOString(),
      summary: {
        totalCount: registrations.length,
        queueCount: registrations.length,
        processCount: 0,
        taskCount: 0,
        monitorCount: 0,
        alertCount: 0
      }
    })),
    loadCheckpointTree: vi.fn(async () => null),
    startCheckpointTree: vi.fn(async () => undefined),
    finishCheckpointTree: vi.fn(async () => undefined),
    upsertCheckpointNode: vi.fn(async () => undefined),
    deleteCheckpointTree: vi.fn(async () => undefined)
  };
});

vi.mock("../../../server/protocols/checkpoint/upload-session-store.mjs", () => ({
  deleteUploadSession: vi.fn(async () => undefined)
}));

vi.mock("../../../server/platform/interactive/platform-registry.mjs", () => ({
  requirePlatformInterface: vi.fn((registry, id) => registry.requireInterface(id))
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
    getDataDir: () => "/tmp/pact-http-job-runtime-final-extra-5"
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
import {
  createJobManager
} from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import {
  getQueueMonitorState,
  inspectQueueMonitor,
  queueMonitorEventLogPath,
  queueMonitorId,
  queueMonitorStatePath
} from "../../../server/services/client/work-queue-core/queue-monitor.mjs";

let serverHandle = null;
const tempRoots = [];

async function withTempDir(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
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

async function seedJob(userDataPath, jobId, meta, payload = null, result = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await seedJson(path.join(jobDir, "meta.json"), { id: jobId, ...meta });
  if (payload !== null) {
    await seedJson(path.join(jobDir, "payload.json"), payload);
  }
  if (result !== null) {
    await seedJson(path.join(jobDir, "result.json"), result);
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
    }
  };
}

function createJobWorkflowProviderStub() {
  return {
    createJob: vi.fn(async () => ({ id: "job-created", status: "queued" })),
    getJob: vi.fn(async () => null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async () => ({})),
    listJobs: vi.fn(async () => ({ summary: { totalCount: 0 }, items: [] })),
    reparseJob: vi.fn(async () => ({ id: "reparsed-job", status: "queued" }))
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

  return {
    featureRuntime: {
      edition: "community",
      activeFeatureIds: [],
      disabledFeatureIds: []
    },
    allApiOperationCount: 4,
    activeApiOperations: [
      { id: "system.interfaces" },
      { id: "discovery.get_config" },
      { id: "system.console_state" },
      { id: "storage.summary" }
    ],
    publicFeatures: () => ({
      allFeatureIds: [],
      systemFeatures: []
    }),
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
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope: "/tmp/pact-http-job-runtime-final-extra-5-scope",
    protocolEventBus,
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
      if (url.pathname === "/api/boom") {
        throw Object.assign(new Error(`boom:${method}`), { statusCode: 418 });
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
    userDataPath: "/tmp/pact-http-job-runtime-final-extra-5-server",
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

async function readJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

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

async function waitForJobStatus(manager, jobId, status, timeoutMs = 4000) {
  return waitForCondition(async () => {
    const job = await manager.getJob(jobId);
    return job?.status === status;
  }, timeoutMs);
}

async function seedQueueState(userDataPath, items, updatedAt = "2026-06-05T08:00:00.000Z") {
  await seedJson(queueMonitorStatePath(userDataPath), {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt,
    statePath: queueMonitorStatePath(userDataPath),
    eventLogPath: queueMonitorEventLogPath(userDataPath),
    items
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadWorkerState.mode = "autoComplete";
  spawnedWorkers.length = 0;
});

afterEach(async () => {
  if (serverHandle) {
    await serverHandle.close().catch(() => {});
    serverHandle = null;
  }
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("http server uncommon routes and wrappers", () => {
  it("covers root/static fallback and wraps uncommon HTTP method failures", async () => {
    const coreProvider = createHttpCoreProvider();
    await startTestServer({ coreProvider });

    const rootResponse = await fetch(`${serverHandle.url}/`);
    const rootBody = await readJsonResponse(rootResponse);
    expect(rootResponse.status).toBe(200);
    expect(rootBody).toMatchObject({
      ok: true,
      service: "Pact Server",
      serverId: "srv-1",
      activeServiceUrl: "http://127.0.0.1:7228"
    });

    const missingAssetResponse = await fetch(`${serverHandle.url}/missing-route.js`);
    const missingAssetBody = await readJsonResponse(missingAssetResponse);
    expect(missingAssetResponse.status).toBe(404);
    expect(missingAssetBody).toEqual({ error: "资源不存在：/missing-route.js" });

    const failureResponse = await fetch(`${serverHandle.url}/api/boom`, {
      method: "PATCH",
      headers: {
        "content-type": "text/plain"
      },
      body: "patched-body"
    });
    const failureBody = await readJsonResponse(failureResponse);
    expect(failureResponse.status).toBe(418);
    expect(failureBody).toEqual({ error: "boom:PATCH" });
    expect(coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        requestBody: Buffer.from("patched-body")
      })
    );
  });

  it("maps RPC failures to JSON responses", async () => {
    const coreProvider = createHttpCoreProvider();
    await startTestServer({ coreProvider });

    const response = await fetch(`${serverHandle.url}/api/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ operationId: "rpc-test" })
    });
    const body = await readJsonResponse(response);
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: "rpc boom" });
    expect(coreProvider.dispatchRpcOperation).toHaveBeenCalledTimes(1);
  });
});

describe("jobs controller normalized document/result/reparse edges", () => {
  it("returns not found / missing manifest responses and forwards reparse on discovery proxy mode", async () => {
    let discoveryMode = "local";
    const getJob = vi.fn(async (jobId) => {
      if (jobId === "completed-job" || jobId === "manifest-missing") {
        return { id: "completed-job", status: "completed" };
      }
      if (jobId === "running-job") {
        return { id: "running-job", status: "running" };
      }
      return null;
    });
    const getJobResult = vi.fn(async () => ({
      resultId: "result-1"
    }));
    const reparseJob = vi.fn(async () => ({
      id: "reparsed-job",
      status: "queued"
    }));
    const proxyApiRequest = vi.fn(async () => undefined);
    const loadNormalizedDocumentStore = vi.fn(async () => ({
      loadNormalizedDocumentsManifest: vi.fn(async (_userDataPath, jobId) => {
        if (jobId === "manifest-missing") {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        }
        return {
          documents: [
            {
              documentId: "doc-1",
              relativePath: "normalized/doc-1.txt",
              title: "doc-1"
            }
          ]
        };
      }),
      resolveNormalizedDocumentEntry: vi.fn((_manifest, documentId) => (documentId === "doc-1" ? null : null)),
      resolveNormalizedDocumentPath: vi.fn(),
      normalizedContentType: vi.fn(() => "text/plain; charset=utf-8")
    }));

    const controller = createJobsController({
      userDataPath: "/tmp/pact-jobs-controller-final-extra-5",
      jobWorkflowProvider: {
        createJob: vi.fn(),
        getJob,
        getJobByCheckpointId: vi.fn(),
        getJobResult,
        listJobs: vi.fn(),
        reparseJob
      },
      storageProvider: {
        readRawObjectById: vi.fn(async () => null)
      },
      deletionCoordinator: {
        deleteBatch: vi.fn(async () => ({ ok: false }))
      },
      getDiscoveryState: () =>
        discoveryMode === "forward"
          ? {
              mode: "forward",
              advertisedBaseUrl: "http://127.0.0.1:9999",
              forwardBaseUrl: "http://127.0.0.1:9998",
              activeServiceUrl: "http://127.0.0.1:9998"
            }
          : {
              mode: "local",
              advertisedBaseUrl: "http://127.0.0.1:9999",
              activeServiceUrl: "http://127.0.0.1:9999"
            },
      proxyApiRequest,
      protocolEventBus: {
        publish: vi.fn().mockResolvedValue(undefined)
      },
      loadNormalizedDocumentStore,
      uploadSessionStore: createUploadSessionStoreStub()
    });

    const missingResultResponse = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "missing-job",
      response: missingResultResponse
    });
    expect(missingResultResponse.statusCode).toBe(404);
    expect(missingResultResponse.json()).toEqual({ error: "任务不存在。" });

    const pendingResultResponse = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "running-job",
      response: pendingResultResponse
    });
    expect(pendingResultResponse.statusCode).toBe(409);
    expect(pendingResultResponse.json()).toEqual({ error: "任务尚未完成。" });

    const manifestMissingResponse = createResponseCapture();
    await controller.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "manifest-missing",
      response: manifestMissingResponse
    });
    expect(manifestMissingResponse.statusCode).toBe(404);
    expect(manifestMissingResponse.json()).toEqual({ error: "归一化文档清单不存在。" });

    const documentMissingResponse = createResponseCapture();
    await controller.handleGetNormalizedDocument({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed-job",
      documentId: "doc-1",
      response: documentMissingResponse
    });
    expect(documentMissingResponse.statusCode).toBe(404);
    expect(documentMissingResponse.json()).toEqual({ error: "归一化文档不存在。" });

    discoveryMode = "forward";
    const reparseResponse = createResponseCapture();
    await controller.handleReparseJob({
      request: {},
      requestBody: Buffer.from(JSON.stringify({ settings: { mode: "deep" } })),
      jobId: "completed-job",
      response: reparseResponse
    });
    expect(reparseResponse.statusCode).toBeNull();
    expect(reparseJob).not.toHaveBeenCalled();
    expect(proxyApiRequest).toHaveBeenCalledTimes(1);
    expect(loadNormalizedDocumentStore).toHaveBeenCalledTimes(3);
  });
});

describe("job manager scan/delete/close branches", () => {
  it("scans persisted queued jobs and dispatches them when payload exists", async () => {
    await withTempDir("pact-job-manager-scan-", async (userDataPath) => {
      const jobId = "scan-job";
      await seedJob(
        userDataPath,
        jobId,
        {
          status: "completed",
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          checkpointId: "checkpoint:scan-job"
        },
        {
          inputText: "scan payload"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      try {
        await manager.getJob(jobId);

        await seedJson(path.join(userDataPath, "jobs", jobId, "meta.json"), {
          id: jobId,
          status: "queued",
          createdAt: "2026-06-05T08:00:00.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          checkpointId: "checkpoint:scan-job",
          stage: "等待执行"
        });

        const scanResult = await manager.scanPersistedQueue();
        expect(scanResult).toMatchObject({
          scanned: true,
          enqueued: 1
        });

        await expect(waitForJobStatus(manager, jobId, "completed")).resolves.toBe(true);
        const job = await manager.getJob(jobId);
        expect(job).toMatchObject({
          id: jobId,
          status: "completed"
        });
        expect(durableWorkflowRuntimeMock.scheduleActivity).toHaveBeenCalled();
      } finally {
        await manager.close();
      }
    });
  });

  it("deletes queued persisted jobs and removes their data directory", async () => {
    await withTempDir("pact-job-manager-delete-queued-", async (userDataPath) => {
      const jobId = "queued-delete-job";
      await seedJob(
        userDataPath,
        jobId,
        {
          status: "queued",
          createdAt: "2026-06-05T08:01:00.000Z",
          updatedAt: "2026-06-05T08:01:00.000Z",
          checkpointId: "checkpoint:queued-delete-job"
        },
        {
          inputText: "queued delete payload"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });
      const deleted = await manager.deleteJob(jobId);
      expect(deleted).toMatchObject({
        id: jobId,
        status: "queued"
      });
      await expect(manager.getJob(jobId)).resolves.toBeNull();
      await expect(fs.stat(path.join(userDataPath, "jobs", jobId))).rejects.toThrow();
      expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
    });
  });

  it("deletes running jobs through the active controller and preserves close state", async () => {
    await withTempDir("pact-job-manager-delete-running-", async (userDataPath) => {
      uploadWorkerState.mode = "hold";
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      const job = await manager.createJob({
        checkpoint: {
          checkpointId: "checkpoint:running-delete-job"
        },
        uploadedFiles: []
      });

      await expect(waitForJobStatus(manager, job.id, "running")).resolves.toBe(true);
      const deleted = await manager.deleteJob(job.id);
      expect(deleted).toMatchObject({
        id: job.id
      });
      expect(spawnedWorkers[0]?.kill).toHaveBeenCalled();
      await expect(manager.getJob(job.id)).resolves.toBeNull();
      await expect(fs.stat(path.join(userDataPath, "jobs", job.id))).rejects.toThrow();
    });
  });

  it("preserves a running job for recovery when closing the manager", async () => {
    await withTempDir("pact-job-manager-close-", async (userDataPath) => {
      uploadWorkerState.mode = "hold";
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      const job = await manager.createJob({
        checkpoint: {
          checkpointId: "checkpoint:close-job"
        },
        uploadedFiles: []
      });

      await expect(waitForJobStatus(manager, job.id, "running")).resolves.toBe(true);
      await manager.close();

      const closedJob = await manager.getJob(job.id);
      expect(closedJob).toMatchObject({
        id: job.id,
        status: "queued",
        stage: "服务已恢复，任务等待重试。"
      });
      expect(durableWorkflowRuntimeMock.recordSignal).toHaveBeenCalled();
    });
  });
});

describe("queue monitor stale and recovery branches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks stale queued jobs interrupted and recovers fresh interrupted jobs", async () => {
    await withTempDir("pact-queue-monitor-final-extra-5-", async (userDataPath) => {
      const staleJobId = "stale-job";
      const recoveredJobId = "recovered-job";
      const staleQueueId = queueMonitorId("import_parse_job", staleJobId);
      await seedQueueState(userDataPath, {
        [staleQueueId]: {
          queueId: staleQueueId,
          ownerId: staleJobId,
          kind: "import_parse_job",
          label: `导入解析队列 ${staleJobId}`,
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "open",
          phase: "queued",
          status: "queued",
          startedAt: "2026-06-05T07:50:00.000Z",
          lastHeartbeatAt: "2026-06-05T07:50:00.000Z",
          closedAt: "",
          checkpointId: "checkpoint:stale-job",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt: "",
          interruptedReason: "",
          acknowledgedAt: "",
          metadata: {}
        }
      });
      await seedJob(
        userDataPath,
        recoveredJobId,
        {
          status: "running",
          createdAt: "2026-06-05T07:59:30.000Z",
          updatedAt: "2026-06-05T08:00:00.000Z",
          checkpointId: "checkpoint:recovered-job"
        },
        {
          inputText: "recovery payload"
        }
      );
      await seedQueueState(userDataPath, {
        [queueMonitorId("import_parse_job", recoveredJobId)]: {
          queueId: queueMonitorId("import_parse_job", recoveredJobId),
          ownerId: recoveredJobId,
          kind: "import_parse_job",
          label: `导入解析队列 ${recoveredJobId}`,
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "interrupted",
          phase: "running",
          status: "interrupted",
          startedAt: "2026-06-05T07:59:30.000Z",
          lastHeartbeatAt: "2026-06-05T08:00:00.000Z",
          closedAt: "",
          checkpointId: "checkpoint:recovered-job",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt: "2026-06-05T07:59:00.000Z",
          interruptedReason: "queue_heartbeat_stale",
          acknowledgedAt: "",
          metadata: {}
        }
      });

      const result = await inspectQueueMonitor({
        userDataPath,
        heartbeatStaleMs: 1,
        recoverInterruptedQueues: true
      });

      const recoveredItem = result.items.find((item) => item.ownerId === recoveredJobId);
      expect(recoveredItem).toMatchObject({
        lifecycleStatus: "recovered",
        status: "recovered"
      });
      expect(result.items.some((item) => item.ownerId === recoveredJobId)).toBe(true);
      expect(await fs.stat(queueMonitorStatePath(userDataPath))).toBeTruthy();
      expect(await fs.stat(queueMonitorEventLogPath(userDataPath))).toBeTruthy();
      expect(await getQueueMonitorState(userDataPath)).toBeTruthy();
    });
  });
});
