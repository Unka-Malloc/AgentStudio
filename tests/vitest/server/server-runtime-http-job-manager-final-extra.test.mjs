import EventEmitter from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const runtimeLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-server-runtime-http-job-manager-final-extra/logs",
  retentionDays: 7
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
const createJobManagerMock = vi.hoisted(() => vi.fn());
const createJobWorkflowProviderMock = vi.hoisted(() => vi.fn());
const createRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const setRuntimeLoggerMock = vi.hoisted(() => vi.fn());
const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => error?.message || String(error || "")));
const summarizeForLogMock = vi.hoisted(() => vi.fn((value) => value));
const traceDetailsMock = vi.hoisted(() => vi.fn(() => ({ traceId: "unit-trace" })));
const runWithTraceContextMock = vi.hoisted(() => vi.fn(async (_trace, callback) => callback()));
const createTraceContextMock = vi.hoisted(() => vi.fn(() => ({ traceId: "trace-id" })));
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn(async () => false));
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createJobsControllerMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());
const workerBehaviorQueue = vi.hoisted(() => []);
const workerPidCounter = vi.hoisted(() => ({ value: 9_000 }));

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
    getRuntimeLogger: vi.fn(() => runtimeLogger),
    summarizeError: summarizeErrorMock,
    summarizeForLog: summarizeForLogMock,
    traceDetails: traceDetailsMock,
    removeImportCheckpoint: vi.fn(async () => undefined),
    deleteUploadSession: vi.fn(async () => undefined)
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
  getRuntimeLogger: vi.fn(() => runtimeLogger),
  setRuntimeLogger: setRuntimeLoggerMock,
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
    getDataDir: () => "/tmp/pact-server-runtime-http-job-manager-final-extra"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/jobs-controller.mjs", () => ({
  createJobsController: createJobsControllerMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

vi.mock("../../../server/services/client/work-queue-core/jobs/job-manager.mjs", () => ({
  createJobManager: createJobManagerMock
}));

import { startLocalHttpServer } from "../../../server/services/server-runtime/http-server.mjs";
const { createJobManager: getActualCreateJobManager } = await vi.importActual(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs"
);

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

let serverHandle = null;

async function withTempDir(prefix, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function createHttpRuntimeRoot({
  consoleUser = "",
  proxyPaths = [],
  activeFeatures = [],
  discoveryStateOverrides = {}
} = {}) {
  const consoleAuth = {
    close: vi.fn().mockResolvedValue(undefined),
    getSessionFromRequest: vi.fn(() =>
      consoleUser
        ? { user: { username: consoleUser } }
        : null
    )
  };
  const securityPermissions = {
    authorizeOperation: vi.fn()
  };
  const operationAuditStore = {
    close: vi.fn().mockResolvedValue(undefined)
  };
  const protocolEventBus = {
    publish: vi.fn(async () => undefined)
  };
  const metadataStore = {
    listPendingDeletionOperations: vi.fn().mockReturnValue([])
  };
  const coreProvider = {
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({ branch: "rpc" }));
    }),
    shouldProxyRegisteredApiRequest: vi.fn(({ pathname }) => proxyPaths.includes(pathname)),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => {
      if (operationId === "system.interfaces") {
        return {
          statusCode: 200,
          payload: {
            operations: ["system.interfaces"]
          }
        };
      }
      if (operationId === "discovery.get_config") {
        return {
          statusCode: 200,
          payload: {
            config: {
              serverId: "srv-1"
            }
          }
        };
      }
      return {
        statusCode: 200,
        payload: {
          ok: true
        }
      };
    })
  };
  const runtimeProviders = {
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
  const featureRuntime = {
    edition: "community",
    activeFeatureIds: activeFeatures,
    disabledFeatureIds: []
  };
  const runtimeRoot = {
    featureRuntime,
    allApiOperationCount: 4,
    activeApiOperations: [
      { id: "system.interfaces" },
      { id: "discovery.get_config" },
      { id: "system.console_state" },
      { id: "storage.summary" }
    ],
    publicFeatures: () => ({
      allFeatureIds: activeFeatures,
      systemFeatures: activeFeatures
    }),
    isFeatureActive: (name) => activeFeatures.includes(name),
    isAnyFeatureActive: (...ids) => ids.some((id) => activeFeatures.includes(id)),
    platformRegistry: {
      requireInterface: (id) => {
        const map = {
          "storage.metadataStore": { value: metadataStore },
          "core.provider": { value: coreProvider },
          "storage.provider": { value: {} },
          "devops.provider": { value: {} }
        };
        return map[id] || { value: {} };
      }
    },
    coreProvider,
    runtime: {
      runtimeOptions: { profile: "test" },
      close: vi.fn().mockResolvedValue(undefined),
      mounts: {}
    },
    moduleManagement: {},
    dataStructures: {
      checkpointTree: {}
    },
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope: "/tmp/pact-server-runtime-http-job-manager-final-extra-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: vi.fn()
    },
    storageProvider: {},
    devopsProvider: {},
    metadataStore
  };
  const discoveryState = {
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local",
    ...discoveryStateOverrides
  };

  return {
    runtimeRoot,
    runtimeProviders,
    coreProvider,
    consoleAuth,
    protocolEventBus,
    securityPermissions,
    operationAuditStore,
    metadataStore,
    discoveryState
  };
}

async function prepareHttpRuntime(options = {}) {
  const httpRuntime = createHttpRuntimeRoot(options);
  createRuntimeLoggerMock.mockReturnValue(runtimeLogger);
  setRuntimeLoggerMock.mockImplementation(() => undefined);
  createServerCompositionRootMock.mockResolvedValue(httpRuntime.runtimeRoot);
  ensureConsoleOwnerMock.mockResolvedValue({
    created: false
  });
  createServerRuntimeProvidersMock.mockResolvedValue(httpRuntime.runtimeProviders);
  createJobWorkflowProviderMock.mockReturnValue({});
  createJobsControllerMock.mockReturnValue({
    close: vi.fn()
  });
  createSystemControllerMock.mockReturnValue({
    close: vi.fn()
  });
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
    resumePendingDeletions: vi.fn().mockResolvedValue(undefined)
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});
  loadOrCreateMcpIdentityMock.mockResolvedValue({
    identity: "mcp-identity"
  });
  loadDiscoveryConfigMock.mockResolvedValue(httpRuntime.discoveryState);
  resolveDiscoveryStateMock.mockResolvedValue(httpRuntime.discoveryState);
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  createJobManagerMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined)
  });
  requirePlatformInterfaceMock.mockImplementation((registry, id) => registry.requireInterface(id));
  return httpRuntime;
}

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-server-runtime-http-job-manager-final-extra-"));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function createEventBusSpy() {
  return {
    publish: vi.fn(async () => undefined)
  };
}

async function waitForJobStatus(manager, jobId, status, timeoutMs = 5000) {
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

describe("server runtime HTTP coverage extras", () => {
  beforeEach(() => {
    runtimeLogger.info.mockClear();
    runtimeLogger.debug.mockClear();
    runtimeLogger.warn.mockClear();
    runtimeLogger.error.mockClear();
    runtimeLogger.close.mockClear();
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
    workerPidCounter.value = 9_000;
    serverHandle = null;
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close().catch(() => undefined);
      serverHandle = null;
    }
  });

  it("rejects project-local user data directories when running from the source checkout", async () => {
    const localPath = path.join(repoRoot, "tmp-project-local-data");
    await expect(
      startLocalHttpServer({
        userDataPath: localPath
      })
    ).rejects.toThrow("Refusing project-local Pact server data dir");
  });

  it("injects a nonce into console index fallback responses", async () => {
    await withTempDir("pact-http-console-fallback-", async (dir) => {
      const distPath = path.join(dir, "dist");
      await fs.mkdir(distPath, { recursive: true });
      await fs.writeFile(
        path.join(distPath, "index.html"),
        "<!doctype html><html><body><script>window.__fallback = true;</script></body></html>",
        "utf8"
      );

      await prepareHttpRuntime();
      serverHandle = await startLocalHttpServer({
        userDataPath: dir,
        distPath
      });

      const response = await fetch(`${serverHandle.url}/console`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toContain("nonce-");
      expect(body).toContain('nonce="');
      expect(body).toContain("window.__fallback = true;");
    });
  });

  it("returns a proxy error response when the upstream target cannot be reached", async () => {
    const closedPort = await getFreePort();
    const upstreamBaseUrl = `http://127.0.0.1:${closedPort}`;
    await prepareHttpRuntime({
      proxyPaths: ["/api/proxy-failure"],
      discoveryStateOverrides: {
        activeServiceUrl: upstreamBaseUrl,
        forwardBaseUrl: upstreamBaseUrl
      }
    });

    await withTempUserData(async (userDataPath) => {
      serverHandle = await startLocalHttpServer({
        userDataPath
      });

      const response = await fetch(`${serverHandle.url}/api/proxy-failure`);
      const body = await readJson(response);

      expect(response.status).toBe(500);
      expect(body?.error).toMatch(/connect|ECONNREFUSED/i);
      expect(runtimeLogger.error.mock.calls.some(([event]) => event === "http.proxy.failed")).toBe(true);
    });
  });

  it("applies IP rate limiting before route dispatch", async () => {
    await prepareHttpRuntime();
    await withTempUserData(async (userDataPath) => {
      serverHandle = await startLocalHttpServer({
        userDataPath,
        runtimeOptions: {
          httpRateLimitPerIpPerMinute: 1,
          httpRateLimitPerSubjectPerMinute: 999,
          httpRateLimitLoginPerIpPerMinute: 999
        }
      });

      const first = await fetch(`${serverHandle.url}/api/ip-limit`);
      expect(first.status).toBe(404);

      const second = await fetch(`${serverHandle.url}/api/ip-limit`);
      const body = await readJson(second);

      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
      expect(second.headers.get("x-ratelimit-limit")).toBe("1");
      expect(second.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(body).toEqual({
        error: "访问频率过高（IP 限流）。",
        policy: "rate-limited"
      });
    });
  });

  it("applies login rate limiting on repeated auth requests", async () => {
    await prepareHttpRuntime();
    await withTempUserData(async (userDataPath) => {
      serverHandle = await startLocalHttpServer({
        userDataPath,
        runtimeOptions: {
          httpRateLimitPerIpPerMinute: 999,
          httpRateLimitPerSubjectPerMinute: 999,
          httpRateLimitLoginPerIpPerMinute: 1
        }
      });

      const first = await fetch(`${serverHandle.url}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ username: "owner" })
      });
      expect(first.status).toBe(404);

      const second = await fetch(`${serverHandle.url}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ username: "owner" })
      });
      const body = await readJson(second);

      expect(second.status).toBe(429);
      expect(second.headers.get("x-ratelimit-limit")).toBe("1");
      expect(body).toEqual({
        error: "登录尝试过于频繁（登录限流）。",
        policy: "rate-limited"
      });
    });
  });

  it("applies subject rate limiting when the authenticated user repeats requests", async () => {
    await prepareHttpRuntime({
      consoleUser: "alice"
    });
    await withTempUserData(async (userDataPath) => {
      serverHandle = await startLocalHttpServer({
        userDataPath,
        runtimeOptions: {
          httpRateLimitPerIpPerMinute: 999,
          httpRateLimitPerSubjectPerMinute: 1,
          httpRateLimitLoginPerIpPerMinute: 999
        }
      });

      const first = await fetch(`${serverHandle.url}/api/subject-limit`);
      expect(first.status).toBe(404);

      const second = await fetch(`${serverHandle.url}/api/subject-limit`);
      const body = await readJson(second);

      expect(second.status).toBe(429);
      expect(second.headers.get("x-ratelimit-limit")).toBe("1");
      expect(body).toEqual({
        error: "访问频率过高（主体限流）。",
        policy: "rate-limited"
      });
    });
  });
});

describe("job manager coverage extras", () => {
  beforeEach(() => {
    runtimeLogger.info.mockClear();
    runtimeLogger.debug.mockClear();
    runtimeLogger.warn.mockClear();
    runtimeLogger.error.mockClear();
    runtimeLogger.close.mockClear();
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
    registerQueueStartedMock.mockClear();
    registerQueueHeartbeatMock.mockClear();
    registerQueueClosedMock.mockClear();
    workerBehaviorQueue.length = 0;
    workerPidCounter.value = 9_000;
  });

  it("reuses an active manifest-based job instead of creating a duplicate", async () => {
    await withTempUserData(async (userDataPath) => {
      const manager = getActualCreateJobManager({
        userDataPath,
        processingEnabled: false,
        protocolEventBus: createEventBusSpy()
      });

      const manifestSha256 = "a".repeat(64);
      const created = await manager.createJob({
        checkpointReceipt: {
          manifestSha256
        },
        inputText: "manifest reuse"
      });
      const reused = await manager.createJob({
        checkpointReceipt: {
          manifestSha256
        },
        inputText: "manifest reuse again"
      });
      const listed = await manager.listJobs({ limit: 10 });

      expect(reused.id).toBe(created.id);
      expect(reused.versionNumber).toBe(created.versionNumber);
      expect(listed.summary.totalCount).toBe(1);
      expect(listed.summary.queuedCount).toBe(1);
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({
        id: created.id,
        status: "queued",
        versionNumber: 1
      });
    });
  });

  it("marks queued jobs as waiting_for_available_worker when all worker slots are occupied", async () => {
    await withTempUserData(async (userDataPath) => {
      workerBehaviorQueue.push();
      const manager = getActualCreateJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        },
        protocolEventBus: createEventBusSpy()
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "queue-state-first"
        },
        checkpointId: "queue-state-first",
        inputText: "first"
      });
      const running = await waitForJobStatus(manager, first.id, "running");
      expect(running).not.toBeNull();

      const second = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "queue-state-second"
        },
        checkpointId: "queue-state-second",
        inputText: "second"
      });
      const runningJob = await manager.getJob(first.id);
      const queuedJob = await manager.getJob(second.id);

      expect(runningJob?.queueState).toMatchObject({
        active: true,
        activeJobId: first.id,
        waitingReason: "running"
      });
      expect(queuedJob?.queueState).toMatchObject({
        active: false,
        activeJobId: first.id,
        blockedByJobId: first.id,
        queuePosition: 1,
        queuedAhead: 0,
        waitingReason: "waiting_for_available_worker"
      });

      await manager.close();
    });
  });

  it("uses getRuntimeOptions when a worker payload is dispatched", async () => {
    await withTempUserData(async (userDataPath) => {
      workerBehaviorQueue.push({
        onSend(worker, message) {
          if (message.type !== "run") {
            return;
          }

          expect(message.runtimeOptions).toMatchObject({
            workerConcurrency: 3,
            profile: "dynamic"
          });

          setTimeout(() => {
            worker.emit("message", {
              type: "completed",
              result: {
                emails: [],
                transactions: [],
                people: [],
                warnings: []
              }
            });
          }, 0);
        }
      });
      const manager = getActualCreateJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1,
          profile: "static"
        },
        getRuntimeOptions: () => ({
          workerConcurrency: 3,
          profile: "dynamic"
        }),
        protocolEventBus: createEventBusSpy()
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "runtime-options-checkpoint"
        },
        checkpointId: "runtime-options-checkpoint",
        inputText: "runtime options"
      });
      const completed = await waitForJobStatus(manager, created.id, "completed");
      expect(completed).not.toBeNull();

      await manager.close();
    });
  });
});
