import EventEmitter from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const durableWorkflowRecords = vi.hoisted(() => new Map());
const forkBehaviorQueue = vi.hoisted(() => []);
const commandPaths = vi.hoisted(() => new Map());
const commandVersions = vi.hoisted(() => new Map());
const realAccessSync = fsSync.accessSync.bind(fsSync);

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const createDurableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async (input = {}) => ({
    workflowId: String(input.workflowId || "")
  })),
  recoverWorkflow: vi.fn(async () => null),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  getWorkflow: vi.fn(async (workflowId) => durableWorkflowRecords.get(String(workflowId || "")) || null),
  listWorkflows: vi.fn(async () => ({ items: [] }))
}));

const registerQueueStartedMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueHeartbeatMock = vi.hoisted(() => vi.fn(async () => undefined));
const registerQueueClosedMock = vi.hoisted(() => vi.fn(async () => undefined));
const queueMonitorIdMock = vi.hoisted(() => vi.fn((kind, ownerId) => `queue_${kind}_${ownerId}`));

const createBatchDeletionCoordinatorMock = vi.hoisted(() => vi.fn());
const createClientRuntimeAllocatorMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPlanMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPullMock = vi.hoisted(() => vi.fn());
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

const loadSettingsMock = vi.hoisted(() => vi.fn());
const resolveGatewayRuntimePlanMock = vi.hoisted(() => vi.fn());
const cloudDriveConfigPathMock = vi.hoisted(() => vi.fn());
const knowledgeBackendConfigPathMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("spawn should not be called in runtime-dependencies unit tests");
}));
const spawnSyncMock = vi.hoisted(() => vi.fn());

function createFakeWorkerFromPlan(plan = {}) {
  const behavior = typeof plan === "function" ? { onSend: plan } : plan;
  const worker = new EventEmitter();

  worker.pid = plan?.pid || 8_400;
  worker.killed = false;
  worker.exitCode = null;
  worker.signalCode = null;
  worker.killedBy = null;

  worker.send = vi.fn((message) => {
    if (typeof behavior.onSend === "function") {
      behavior.onSend(worker, message);
    }
  });

  worker.kill = vi.fn((signal = "SIGTERM") => {
    if (worker.killed) {
      return false;
    }
    worker.killed = true;
    worker.killedBy = signal;
    setTimeout(() => {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.exitCode = 0;
        worker.signalCode = signal;
        worker.emit("exit", 0, signal);
      }
    }, 0);
    return true;
  });

  worker.unref = vi.fn();
  return worker;
}

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => createFakeWorkerFromPlan(forkBehaviorQueue.shift() || null)),
  spawn: spawnMock,
  spawnSync: spawnSyncMock
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createDurableWorkflowRuntime: vi.fn(() => createDurableWorkflowRuntimeMock),
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: summarizeErrorMock,
    summarizeForLog: summarizeForLogMock,
    traceDetails: traceDetailsMock
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

vi.mock("../../../server/services/client/work-queue-core/jobs/job-manager.mjs", () => ({
  createJobManager: createJobManagerMock
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
    getDataDir: () => "/tmp/pact-runtime-job-http-more-extra"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/jobs-controller.mjs", () => ({
  createJobsController: createJobsControllerMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent/cloud-drive-port/index.mjs", () => ({
  cloudDriveConfigPath: cloudDriveConfigPathMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs", () => ({
  resolveGatewayRuntimePlan: resolveGatewayRuntimePlanMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => ({
  knowledgeBackendConfigPath: knowledgeBackendConfigPathMock
}));

import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { startLocalHttpServer } from "../../../server/services/server-runtime/http-server.mjs";
import {
  downloadRuntimeDependency,
  listRuntimeDependencyDownloadRuns,
  runtimeDependencySourceConfigPath
} from "../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const { createJobManager: realCreateJobManager } = await vi.importActual(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs"
);

const runtimeLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-runtime-job-http-more-extra/logs",
  retentionDays: 7
};

function createEventBusSpy() {
  return {
    publish: vi.fn(async () => undefined)
  };
}

async function withTempUserData(prefix, callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
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

async function waitForDownloadRunStatus(status, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const runs = listRuntimeDependencyDownloadRuns().downloads;
    const run = runs[0];
    if (run && run.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function makeExecutable(workspaceDir, name, versionText) {
  const binDir = path.join(workspaceDir, "bin");
  const filePath = path.join(binDir, name);
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(filePath, "#!/bin/sh\n", "utf8");
  await fs.chmod(filePath, 0o755);
  commandPaths.set(name, filePath);
  commandVersions.set(name, versionText);
  return filePath;
}

function resetCommonMocks() {
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  createDurableWorkflowRuntimeMock.recoverWorkflow.mockClear();
  createDurableWorkflowRuntimeMock.startWorkflow.mockClear();
  createDurableWorkflowRuntimeMock.scheduleActivity.mockClear();
  createDurableWorkflowRuntimeMock.startActivity.mockClear();
  createDurableWorkflowRuntimeMock.completeActivity.mockClear();
  createDurableWorkflowRuntimeMock.failActivity.mockClear();
  createDurableWorkflowRuntimeMock.failWorkflow.mockClear();
  createDurableWorkflowRuntimeMock.completeWorkflow.mockClear();
  createDurableWorkflowRuntimeMock.recordSignal.mockClear();
  createDurableWorkflowRuntimeMock.getWorkflow.mockClear();
  createDurableWorkflowRuntimeMock.listWorkflows.mockClear();
  registerQueueStartedMock.mockClear();
  registerQueueHeartbeatMock.mockClear();
  registerQueueClosedMock.mockClear();
  queueMonitorIdMock.mockClear();
  forkBehaviorQueue.length = 0;
  durableWorkflowRecords.clear();
  runtimeLogger.info.mockClear();
  runtimeLogger.warn.mockClear();
  runtimeLogger.error.mockClear();
  runtimeLogger.debug.mockClear();
  createRuntimeLoggerMock.mockReturnValue(runtimeLogger);
  setRuntimeLoggerMock.mockImplementation(() => undefined);
  createTraceContextMock.mockReturnValue({ traceId: "trace-id" });
  runWithTraceContextMock.mockImplementation(async (_context, callback) => callback());
  setTraceContextOnRequestMock.mockImplementation(() => undefined);
  summarizeErrorMock.mockImplementation((error) => (error instanceof Error ? error.message : String(error || "internal")));
  summarizeForLogMock.mockImplementation((value) => value);
  traceDetailsMock.mockReturnValue({ traceId: "unit-trace" });
  createBatchDeletionCoordinatorMock.mockReturnValue({
    resumePendingDeletions: vi.fn().mockResolvedValue(undefined)
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});
  inspectQueueMonitorMock.mockResolvedValue(undefined);
  acknowledgeQueueMonitorAlertMock.mockResolvedValue(undefined);
  requirePlatformInterfaceMock.mockImplementation((registry, id) => registry.requireInterface(id));
  createJobWorkflowProviderMock.mockReturnValue({});
  createJobsControllerMock.mockReturnValue({ close: vi.fn() });
  createSystemControllerMock.mockReturnValue({ close: vi.fn() });
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn()
  });
  loadOrCreateMcpIdentityMock.mockResolvedValue({ identity: "mcp-identity" });
  loadDiscoveryConfigMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local"
  });
  resolveDiscoveryStateMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local"
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  loadSettingsMock.mockResolvedValue({});
  cloudDriveConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || os.tmpdir(), "cloud-drive.json"));
  knowledgeBackendConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || os.tmpdir(), "knowledge-backend.json"));
  resolveGatewayRuntimePlanMock.mockImplementation(({ adapterId, runtimeUrl, cacheRoot }) => ({
    adapterId,
    runtimeUrl: runtimeUrl || `https://example.invalid/${adapterId}.tgz`,
    executableName: adapterId,
    configuredBinary: "",
    cachedExecutablePath: path.join(cacheRoot || os.tmpdir(), `${adapterId}.bin`)
  }));
  handlePactMcpHttpRequestMock.mockResolvedValue(false);
}

function createHttpRuntimeRoot({ throwRegisteredError = false } = {}) {
  const protocolEventBus = {
    publish: vi.fn().mockResolvedValue(undefined)
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
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false }));
    }),
    shouldProxyRegisteredApiRequest: vi.fn().mockReturnValue(false),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => {
      if (operationId === "system.interfaces") {
        return { statusCode: 200, payload: { operations: ["system.interfaces"] } };
      }
      if (operationId === "discovery.get_config") {
        return { statusCode: 200, payload: { config: { serverId: "srv-1" } } };
      }
      if (operationId === "agent_sync.config.get") {
        return { statusCode: 200, payload: { config: { enabled: true } } };
      }
      return { statusCode: 200, payload: { ok: true } };
    })
  };
  if (throwRegisteredError) {
    coreProvider.dispatchRegisteredHttpOperation = vi.fn(async () => {
      throw { statusCode: 418 };
    });
  }

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
    operationConcurrencyScope: "/tmp/pact-runtime-job-http-more-extra-scope",
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

  createServerCompositionRootMock.mockResolvedValue(runtimeRoot);
  ensureConsoleOwnerMock.mockResolvedValue({ created: false });
  createServerRuntimeProvidersMock.mockResolvedValue(runtimeProviders);
  createJobManagerMock.mockReturnValue(jobManager);
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn()
    }
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn()
  });
  createJobWorkflowProviderMock.mockReturnValue({});

  return { runtimeRoot, runtimeProviders, coreProvider, jobManager };
}

async function makeTempWorkspace(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("job manager boundary coverage", () => {
  beforeEach(() => {
    resetCommonMocks();
  });

  it("会拒绝外部模式下正在运行任务的取消请求，并保留 running 状态", async () => {
    await withTempUserData("pact-job-manager-more-extra-", async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();

      await fs.mkdir(path.join(userDataPath, "jobs", "persisted-running"), { recursive: true });
      await fs.writeFile(
        path.join(userDataPath, "jobs", "persisted-running", "meta.json"),
        JSON.stringify({
          id: "persisted-running",
          status: "running",
          createdAt: "2026-06-05T00:00:00.000Z",
          updatedAt: "2026-06-05T00:00:00.000Z",
          progressPercent: 42,
          stage: "处理中",
          checkpointId: "persisted-running-checkpoint"
        }),
        "utf8"
      );

      const manager = realCreateJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: false
      });

      const running = await waitForJobStatus(manager, "persisted-running", "running");
      expect(running).not.toBeNull();
      expect(running?.status).toBe("running");

      await expect(manager.deleteJob("persisted-running")).rejects.toThrow(
        "任务由外部后台 worker 执行，当前不能从 API 进程直接删除运行中的任务。"
      );

      const list = await manager.listJobs({ limit: 10 });
      expect(list.summary).toMatchObject({
        totalCount: 1,
        runningCount: 1,
        queuedCount: 0,
        failedCount: 0,
        processingMode: "external"
      });
      await expect(manager.getJob("persisted-running")).resolves.toMatchObject({
        id: "persisted-running",
        status: "running"
      });
    });
  });

  it("worker 回报失败后会进入 failed，并阻止读取 result", async () => {
    await withTempUserData("pact-job-manager-failure-more-extra-", async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      forkBehaviorQueue.push((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "failed",
            error: "worker crashed"
          });
        }, 0);
      });

      const manager = realCreateJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "failure-checkpoint"
        },
        checkpointId: "failure-checkpoint",
        inputText: "fail me"
      });

      const failed = await waitForJobStatus(manager, created.id, "failed");
      expect(failed).not.toBeNull();
      expect(failed).toMatchObject({
        id: created.id,
        status: "failed",
        error: "worker crashed"
      });

      await expect(manager.getJobResult(created.id)).rejects.toThrow("任务尚未完成，暂时不能读取结果。");

      const list = await manager.listJobs({ limit: 10 });
      expect(list.summary).toMatchObject({
        failedCount: 1,
        queuedCount: 0,
        runningCount: 0,
        processingMode: "internal"
      });
    });
  });
});

describe("http server error handling boundaries", () => {
  let serverHandle = null;
  let activeRuntime = null;

  beforeEach(() => {
    resetCommonMocks();
    activeRuntime = createHttpRuntimeRoot({ throwRegisteredError: true });
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close().catch(() => {});
      serverHandle = null;
    }
    activeRuntime = null;
  });

  it("会把注册路由中的非 Error 异常映射为指定状态码的 JSON 错误", async () => {
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-runtime-job-http-more-extra-http"
    });

    const response = await fetch(`${serverHandle.url}/api/fault`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ fault: true })
    });

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: "Internal error" });
    expect(activeRuntime.coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledTimes(1);
    expect(runtimeLogger.error).toHaveBeenCalledWith(
      "http.request.failed",
      expect.objectContaining({
        statusCode: 418
      })
    );
  });
});

describe("runtime dependency configuration and download boundaries", () => {
  let workspaceDir = "";
  const tempDirs = [];
  let accessSpy = null;

  beforeEach(async () => {
    resetCommonMocks();
    workspaceDir = await makeTempWorkspace("pact-runtime-job-http-more-extra-");
    tempDirs.push(workspaceDir);
    accessSpy = vi.spyOn(fsSync, "accessSync").mockImplementation((targetPath, mode) => {
      const candidate = String(targetPath);
      if (candidate.startsWith(workspaceDir)) {
        return realAccessSync(targetPath, mode);
      }
      const error = new Error(`ENOENT: no such file or directory, access '${candidate}'`);
      error.code = "ENOENT";
      throw error;
    });
    commandPaths.clear();
    commandVersions.clear();
    loadSettingsMock.mockResolvedValue({});
    cloudDriveConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || workspaceDir, "cloud-drive.json"));
    knowledgeBackendConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || workspaceDir, "knowledge-backend.json"));
    resolveGatewayRuntimePlanMock.mockImplementation(({ adapterId, runtimeUrl, cacheRoot }) => ({
      adapterId,
      runtimeUrl: runtimeUrl || `https://example.invalid/${adapterId}.tgz`,
      executableName: adapterId,
      configuredBinary: "",
      cachedExecutablePath: path.join(cacheRoot || workspaceDir, `${adapterId}.bin`)
    }));
    spawnMock.mockImplementation(() => {
      throw new Error("spawn should not be called in runtime-dependencies unit tests");
    });
    spawnSyncMock.mockImplementation((command, args = []) => {
      const commandName = String(command);
      if (commandName === "sh" && args[0] === "-c") {
        const match = String(args[1] || "").match(/command -v '([^']+)'/);
        const lookupName = match?.[1] || "";
        const filePath = commandPaths.get(lookupName) || "";
        return filePath
          ? { status: 0, signal: null, stdout: `${filePath}\n`, stderr: "" }
          : { status: 1, signal: null, stdout: "", stderr: "" };
      }

      const binaryName = path.basename(commandName);
      if (commandPaths.get(binaryName) === commandName) {
        if (args.includes("--version") || args.includes("-version") || args.includes("version")) {
          return {
            status: 0,
            signal: null,
            stdout: `${commandVersions.get(binaryName) || ""}\n`,
            stderr: ""
          };
        }
      }

      return { status: 1, signal: null, stdout: "", stderr: "" };
    });
  });

  afterEach(async () => {
    accessSpy?.mockRestore();
    accessSpy = null;
    const dirs = tempDirs.splice(0);
    await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("会在 download 入口重建损坏的 source config，并继续生成 dry-run 计划", async () => {
    const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{", "utf8");

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "python",
      dryRun: true
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.planned).toBe(true);
    expect(result.url).toContain("python.org");

    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(written.protocolVersion).toBe("pact.runtime-dependencies.v1");
    expect(written.lastReadError).toMatch(/Unexpected|Expected property name|JSON input/);
  });

  it("后台下载运行在目标缺失时会转为 failed run", async () => {
    const queued = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "python",
      async: true
    });

    expect(queued.ok).toBe(true);
    expect(queued.status).toBe("queued");
    expect(queued.reason).toBe("background_install_started");

    const failedRun = await waitForDownloadRunStatus("failed");
    expect(failedRun).not.toBeNull();
    expect(failedRun).toMatchObject({
      targetId: "python",
      status: "failed",
      ok: false
    });
    expect(failedRun?.result).toMatchObject({
      targetId: "python",
      status: "failed",
      error: expect.stringContaining("spawn should not be called")
    });
  });
});
