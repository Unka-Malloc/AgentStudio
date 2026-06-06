import EventEmitter from "node:events";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const durableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async () => null),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  heartbeatActivity: vi.fn(async () => null),
  recoverWorkflow: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  getWorkflow: vi.fn(async () => null),
  listWorkflows: vi.fn(async () => ({ items: [] }))
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const registerQueueStartedMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueHeartbeatMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueClosedMock = vi.hoisted(() => vi.fn(async () => undefined));
const queueMonitorIdMock = vi.hoisted(() => vi.fn((kind, ownerId) => `queue_${kind}_${ownerId}`));

const createServerCompositionRootMock = vi.hoisted(() => vi.fn());
const createServerRuntimeProvidersMock = vi.hoisted(() => vi.fn());
const createServerToolManagementPlatformMock = vi.hoisted(() => vi.fn());
const createServerToolSkillManagementProviderMock = vi.hoisted(() => vi.fn());
const ensureConsoleOwnerMock = vi.hoisted(() => vi.fn());
const loadDiscoveryConfigMock = vi.hoisted(() => vi.fn());
const resolveDiscoveryStateMock = vi.hoisted(() => vi.fn());
const saveDiscoveryConfigMock = vi.hoisted(() => vi.fn());
const createJobManagerMock = vi.hoisted(() => vi.fn());
const createJobWorkflowProviderMock = vi.hoisted(() => vi.fn());
const createRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const setRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const summarizeErrorMock = vi.hoisted(() => vi.fn());
const summarizeForLogMock = vi.hoisted(() => vi.fn());
const traceDetailsMock = vi.hoisted(() => vi.fn());
const runWithTraceContextMock = vi.hoisted(() => vi.fn());
const createTraceContextMock = vi.hoisted(() => vi.fn());
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn());
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createJobsControllerMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());

const workerBehaviorQueue = vi.hoisted(() => []);
const workerPidCounter = vi.hoisted(() => ({ value: 7200 }));

function nextWorkerBehavior() {
  return workerBehaviorQueue.shift() || null;
}

function createFakeWorkerFromPlan(plan = {}) {
  const behavior = typeof plan === "function" ? { onSend: plan } : plan;
  const worker = new EventEmitter();
  worker.pid = workerPidCounter.value++;
  worker.killed = false;
  worker.exitCode = null;
  worker.signalCode = null;
  worker.send = vi.fn((message) => {
    if (typeof behavior?.onSend === "function") {
      behavior.onSend(worker, message);
    }
  });
  worker.kill = vi.fn((signal = "SIGTERM") => {
    if (worker.killed) {
      return false;
    }
    worker.killed = true;
    worker.signalCode = signal;
    setTimeout(() => {
      if (worker.exitCode === null && worker.signalCode === signal) {
        worker.exitCode = 0;
        worker.emit("exit", 0, signal);
      }
    }, 0);
    return true;
  });
  worker.unref = vi.fn();
  return worker;
}

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => createFakeWorkerFromPlan(nextWorkerBehavior()))
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: summarizeErrorMock,
    summarizeForLog: summarizeForLogMock,
    traceDetails: traceDetailsMock,
    removeImportCheckpoint: vi.fn(async () => undefined),
    deleteUploadSession: vi.fn(async () => undefined)
  };
});

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/client/work-queue-core/queue-monitor.mjs");
  return {
    ...actual,
    queueMonitorId: queueMonitorIdMock,
    registerQueueStarted: registerQueueStartedMock,
    registerQueueHeartbeat: registerQueueHeartbeatMock,
    registerQueueClosed: registerQueueClosedMock
  };
});

vi.mock("../../../server/services/client/work-queue-core/jobs/job-manager.mjs", () => ({
  createJobManager: createJobManagerMock
}));

vi.mock("../../../server/platform/interactive/platform-registry.mjs", () => ({
  requirePlatformInterface: vi.fn((registry, id) => registry.requireInterface(id))
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
  getRuntimeLogger: vi.fn(() => loggerMock),
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock
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
    getDataDir: () => "/tmp/pact-runtime-http-job-deep-extra"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/jobs-controller.mjs", () => ({
  createJobsController: createJobsControllerMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

import { startLocalHttpServer } from "../../../server/services/server-runtime/http-server.mjs";
const { createJobManager: realCreateJobManager } = await vi.importActual(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs"
);

const runtimeLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-runtime-http-job-deep-extra/logs",
  retentionDays: 7
};

function createEventBusSpy() {
  return {
    publish: vi.fn(async () => undefined)
  };
}

async function withTempDir(prefix, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function waitForJobStatus(manager, jobId, status, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const job = await manager.getJob(jobId);
    if (job && job.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function resetCommonMocks() {
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  registerQueueStartedMock.mockClear();
  registerQueueHeartbeatMock.mockClear();
  registerQueueClosedMock.mockClear();
  queueMonitorIdMock.mockClear();
  createServerCompositionRootMock.mockClear();
  createServerRuntimeProvidersMock.mockClear();
  createServerToolManagementPlatformMock.mockClear();
  createServerToolSkillManagementProviderMock.mockClear();
  ensureConsoleOwnerMock.mockClear();
  loadDiscoveryConfigMock.mockClear();
  resolveDiscoveryStateMock.mockClear();
  saveDiscoveryConfigMock.mockClear();
  createJobManagerMock.mockClear();
  createJobWorkflowProviderMock.mockClear();
  createRuntimeLoggerMock.mockClear();
  setRuntimeLoggerMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  traceDetailsMock.mockClear();
  runWithTraceContextMock.mockClear();
  createTraceContextMock.mockClear();
  setTraceContextOnRequestMock.mockClear();
  handlePactMcpHttpRequestMock.mockClear();
  loadOrCreateMcpIdentityMock.mockClear();
  createJobsControllerMock.mockClear();
  createSystemControllerMock.mockClear();
  workerBehaviorQueue.length = 0;
  workerPidCounter.value = 7200;
  runtimeLogger.info.mockClear();
  runtimeLogger.debug.mockClear();
  runtimeLogger.warn.mockClear();
  runtimeLogger.error.mockClear();
  traceDetailsMock.mockReturnValue({ traceId: "unit-trace" });
  createTraceContextMock.mockReturnValue({ traceId: "unit-trace" });
  runWithTraceContextMock.mockImplementation(async (_context, callback) => callback());
  setTraceContextOnRequestMock.mockImplementation(() => undefined);
  summarizeErrorMock.mockImplementation((error) => (error instanceof Error ? error.message : String(error || "")));
  summarizeForLogMock.mockImplementation((value) => value);
  createRuntimeLoggerMock.mockReturnValue(runtimeLogger);
  setRuntimeLoggerMock.mockImplementation(() => undefined);
  loadOrCreateMcpIdentityMock.mockResolvedValue({ identity: "mcp-identity" });
  loadDiscoveryConfigMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7728",
    mode: "local"
  });
  resolveDiscoveryStateMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7728",
    mode: "local"
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined)
  });
  createJobWorkflowProviderMock.mockReturnValue({});
  createJobsControllerMock.mockReturnValue({ close: vi.fn() });
  createSystemControllerMock.mockReturnValue({ close: vi.fn() });
  createServerRuntimeProvidersMock.mockResolvedValue({
    maintenanceAgent: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    knowledgeSourceService: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    agentWorkspace: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    strategyManagementProvider: {},
    modelDecisionRuntime: {},
    evidenceSufficiencyGate: {},
    knowledgeAgentSkill: {},
    goldenRuleRuntime: {},
    knowledgeRuleAuthoringRuntime: {},
    knowledgeSkillRuntime: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    agentEvaluationRuntime: {},
    knowledgeEvolutionRuntime: {},
    summarizationRuntime: {},
    agentExplorationRuntime: {}
  });
  handlePactMcpHttpRequestMock.mockResolvedValue(false);
  durableWorkflowRuntimeMock.startWorkflow.mockClear();
  durableWorkflowRuntimeMock.scheduleActivity.mockClear();
  durableWorkflowRuntimeMock.startActivity.mockClear();
  durableWorkflowRuntimeMock.completeActivity.mockClear();
  durableWorkflowRuntimeMock.heartbeatActivity.mockClear();
  durableWorkflowRuntimeMock.recoverWorkflow.mockClear();
  durableWorkflowRuntimeMock.failActivity.mockClear();
  durableWorkflowRuntimeMock.failWorkflow.mockClear();
  durableWorkflowRuntimeMock.completeWorkflow.mockClear();
  durableWorkflowRuntimeMock.recordSignal.mockClear();
  durableWorkflowRuntimeMock.getWorkflow.mockClear();
  durableWorkflowRuntimeMock.listWorkflows.mockClear();
}

function createHttpRuntimeRoot({
  proxiedPath = "/api/proxy",
  registeredRouteError = null,
  activeServiceUrl = "http://127.0.0.1:7728"
} = {}) {
  const protocolEventBus = {
    publish: vi.fn(async () => undefined)
  };
  const consoleAuth = {
    close: vi.fn().mockResolvedValue(undefined),
    getSessionFromRequest: vi.fn()
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
  const coreProvider = {
    dispatchRpcOperation: vi.fn(async ({ request, requestBody, response }) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          ok: true,
          method: request.method,
          bodyText: requestBody.toString("utf8")
        })
      );
    }),
    shouldProxyRegisteredApiRequest: vi.fn(({ pathname }) => pathname === proxiedPath),
    dispatchRegisteredHttpOperation: vi.fn(async ({ url, response, requestBody, method }) => {
      if (registeredRouteError && url.pathname === registeredRouteError.pathname) {
        throw registeredRouteError.error;
      }
      if (url.pathname === "/api/custom") {
        response.statusCode = 204;
        response.end();
        return true;
      }
      if (url.pathname === "/api/custom-body") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            ok: true,
            method,
            bodyText: requestBody.toString("utf8")
          })
        );
        return true;
      }
      return false;
    }),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => {
      if (operationId === "system.interfaces") {
        return { statusCode: 200, payload: { operations: ["system.interfaces"] } };
      }
      if (operationId === "discovery.get_config") {
        return {
          statusCode: 200,
          payload: { config: { serverId: "srv-1", activeServiceUrl } }
        };
      }
      if (operationId === "agent_sync.config.get") {
        return { statusCode: 200, payload: { config: { enabled: true } } };
      }
      return { statusCode: 200, payload: { ok: true } };
    })
  };

  const runtimeRoot = {
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
          "storage.metadataStore": { value: metadataStore },
          "core.provider": { value: coreProvider },
          "storage.provider": { value: {} },
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
    operationConcurrencyScope: "/tmp/pact-runtime-http-job-deep-extra-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: vi.fn()
    },
    storageProvider: {},
    devopsProvider: {},
    metadataStore
  };

  const runtimeProviders = {
    maintenanceAgent: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    knowledgeSourceService: {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    },
    agentWorkspace: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    strategyManagementProvider: {},
    modelDecisionRuntime: {},
    evidenceSufficiencyGate: {},
    knowledgeAgentSkill: {},
    goldenRuleRuntime: {},
    knowledgeRuleAuthoringRuntime: {},
    knowledgeSkillRuntime: {
      close: vi.fn().mockResolvedValue(undefined)
    },
    agentEvaluationRuntime: {},
    knowledgeEvolutionRuntime: {},
    summarizationRuntime: {},
    agentExplorationRuntime: {}
  };

  const jobManager = {
    close: vi.fn().mockResolvedValue(undefined)
  };

  loadDiscoveryConfigMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl,
    mode: "local"
  });
  resolveDiscoveryStateMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl,
    mode: "local"
  });
  createServerCompositionRootMock.mockResolvedValue(runtimeRoot);
  ensureConsoleOwnerMock.mockResolvedValue({ created: false });
  createServerRuntimeProvidersMock.mockResolvedValue(runtimeProviders);
  createJobManagerMock.mockReturnValue(jobManager);
  createJobWorkflowProviderMock.mockReturnValue({});
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined)
  });

  return { runtimeRoot, runtimeProviders, coreProvider, protocolEventBus };
}

describe("http server deep extra coverage", () => {
  let serverHandle = null;
  let runtimeRoot = null;
  let upstreamServer = null;
  let upstreamBaseUrl = "";

  beforeEach(() => {
    resetCommonMocks();
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close().catch(() => {});
      serverHandle = null;
    }
    if (upstreamServer) {
      await new Promise((resolve) => upstreamServer.close(resolve));
      upstreamServer = null;
    }
    runtimeRoot = null;
    upstreamBaseUrl = "";
  });

  it("会把 POST /api/rpc 的请求体原样传给 dispatchRpcOperation", async () => {
    runtimeRoot = createHttpRuntimeRoot();
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-runtime-http-job-deep-extra"
    });

    const body = JSON.stringify({ hello: "world", count: 2 });
    const response = await fetch(`${serverHandle.url}/api/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client": "ignored"
      },
      body
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      method: "POST",
      bodyText: body
    });
    expect(runtimeRoot.coreProvider.dispatchRpcOperation).toHaveBeenCalledTimes(1);
    expect(runtimeRoot.coreProvider.dispatchRpcOperation.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        requestBody: Buffer.from(body),
        request: expect.objectContaining({
          method: "POST"
        })
      })
    );
  });

  it("会在代理分支转发非 GET 请求体、保留允许头，并去掉上游的 hop-by-hop 头", async () => {
    const upstreamObservations = {
      method: "",
      headers: {},
      bodyText: ""
    };
    upstreamServer = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on("end", () => {
        const requestBody = Buffer.concat(chunks).toString("utf8");
        upstreamObservations.method = request.method || "";
        upstreamObservations.headers = { ...request.headers };
        upstreamObservations.bodyText = requestBody;
        response.statusCode = 201;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.setHeader("x-upstream", "yes");
        response.end(`echo:${requestBody}`);
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    upstreamBaseUrl = `http://127.0.0.1:${upstreamServer.address().port}`;

    const httpRuntime = createHttpRuntimeRoot({
      proxiedPath: "/api/proxy",
      activeServiceUrl: upstreamBaseUrl
    });
    httpRuntime.coreProvider.shouldProxyRegisteredApiRequest.mockImplementation(
      ({ pathname }) => pathname === "/api/proxy"
    );
    httpRuntime.coreProvider.dispatchRegisteredHttpOperation.mockResolvedValue(false);
    runtimeRoot = httpRuntime;

    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-runtime-http-job-deep-extra"
    });

    const body = JSON.stringify({ query: "proxy me" });
    const response = await fetch(`${serverHandle.url}/api/proxy?echo=1`, {
      method: "POST",
      headers: {
        authorization: "Bearer proxy-token",
        cookie: "session=abc; theme=dark",
        "content-type": "application/json",
        "x-pact-confirm": "yes",
        "x-pact-safety-confirm": "yes",
        "x-ignore": "skip-me"
      },
      body
    });
    const responseText = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(response.headers.get("content-length")).toBeNull();
    expect(responseText).toBe(`echo:${body}`);
    expect(upstreamObservations.method).toBe("POST");
    expect(upstreamObservations.headers["content-type"]).toBe("application/json");
    expect(upstreamObservations.headers.authorization).toBe("Bearer proxy-token");
    expect(upstreamObservations.headers.cookie).toContain("session=abc");
    expect(upstreamObservations.headers["x-pact-confirm"]).toBe("yes");
    expect(upstreamObservations.headers["x-pact-forwarded-by"]).toBe("srv-1");
    expect(upstreamObservations.headers["x-pact-active-service"]).toBe(upstreamBaseUrl);
    expect(upstreamObservations.headers["x-ignore"]).toBeUndefined();
    expect(upstreamObservations.headers["content-length"]).toBe(String(Buffer.byteLength(body)));
  });

  it("会把带 statusCode 的 Error 映射成对应状态码并保留消息", async () => {
    runtimeRoot = createHttpRuntimeRoot({
      registeredRouteError: {
        pathname: "/api/custom-error",
        error: Object.assign(new Error("route exploded"), { statusCode: 503 })
      }
    });
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-runtime-http-job-deep-extra"
    });

    const response = await fetch(`${serverHandle.url}/api/custom-error`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ fault: true })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "route exploded" });
    expect(runtimeRoot.coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledTimes(1);
  });

  it("会在静态兜底分支返回资源不存在与接口不存在", async () => {
    runtimeRoot = createHttpRuntimeRoot();
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-runtime-http-job-deep-extra"
    });

    const assetResponse = await fetch(`${serverHandle.url}/missing.js`);
    expect(assetResponse.status).toBe(404);
    expect(await assetResponse.json()).toEqual({
      error: "资源不存在：/missing.js"
    });

    const consoleResponse = await fetch(`${serverHandle.url}/console`);
    expect(consoleResponse.status).toBe(404);
    expect(await consoleResponse.json()).toEqual({
      error: "接口不存在：/console"
    });
  });
});

describe("job manager deep extra coverage", () => {
  beforeEach(() => {
    resetCommonMocks();
  });

  it("会完成任务、写入结果，并在再次创建同一 checkpoint 时复用已完成任务", async () => {
    await withTempDir("pact-job-manager-deep-extra-", async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      workerBehaviorQueue.push((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: {
              emails: [{ email: "a@example.com" }],
              transactions: [{ id: "t-1" }],
              people: [{ name: "Alice" }],
              warnings: []
            }
          });
        }, 0);
      });

      const manager = realCreateJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "deep-checkpoint"
        },
        checkpointId: "deep-checkpoint",
        inputText: "first run"
      });

      const completed = await waitForJobStatus(manager, first.id, "completed");
      expect(completed).not.toBeNull();

      const result = await manager.getJobResult(first.id);
      expect(result).toEqual({
        emails: [{ email: "a@example.com" }],
        transactions: [{ id: "t-1" }],
        people: [{ name: "Alice" }],
        warnings: []
      });

      const reused = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "deep-checkpoint"
        },
        checkpointId: "deep-checkpoint",
        inputText: "second run"
      });
      expect(reused.id).toBe(first.id);
      expect(reused.status).toBe("completed");

      workerBehaviorQueue.push((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: {
              emails: [],
              transactions: [],
              people: [],
              warnings: [{ code: "w-1" }]
            }
          });
        }, 0);
      });

      const second = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "deep-checkpoint"
        },
        checkpointId: "deep-checkpoint",
        inputText: "force new version",
        forceNewVersion: true
      });

      const secondCompleted = await waitForJobStatus(manager, second.id, "completed");
      expect(secondCompleted).not.toBeNull();

      const list = await manager.listJobs({ limit: 999 });
      expect(list.summary).toMatchObject({
        totalCount: 2,
        completedCount: 2,
        queuedCount: 0,
        failedCount: 0,
        processingMode: "internal",
        workerConcurrency: 4
      });
      expect(list.items.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(await manager.getJobByCheckpointId("deep-checkpoint")).toMatchObject({
        id: second.id,
        status: "completed"
      });
      await manager.close();
    });
  });

  it("会拒绝未完成结果、处理缺失历史任务，并保留空 checkpoint 查询为 null", async () => {
    await withTempDir("pact-job-manager-deep-extra-invalid-", async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manager = realCreateJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "queued-checkpoint"
        },
        checkpointId: "queued-checkpoint",
        inputText: "still queued"
      });

      await expect(manager.getJobResult(created.id)).rejects.toThrow("任务尚未完成，暂时不能读取结果。");
      await expect(manager.reparseJob("missing-job")).rejects.toThrow("历史任务不存在，不能重新解析。");
      await expect(manager.deleteJob("missing-job")).resolves.toBeNull();
      expect(await manager.getJobByCheckpointId("")).toBeNull();
      expect(await manager.getJobByCheckpointId("not-a-real-checkpoint")).toBeNull();
      const list = await manager.listJobs({ limit: 1 });
      expect(list.summary).toMatchObject({
        totalCount: 1,
        queuedCount: 1,
        completedCount: 0,
        failedCount: 0,
        processingMode: "internal"
      });
      await manager.close();
    });
  });
});
