import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createBatchDeletionCoordinatorMock = vi.hoisted(() => vi.fn());
const createClientRuntimeAllocatorMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPlanMock = vi.hoisted(() => vi.fn());
const buildClientRuntimeBootstrapPullMock = vi.hoisted(() => vi.fn());
const registerQueueStartedMock = vi.hoisted(() => vi.fn());
const registerQueueHeartbeatMock = vi.hoisted(() => vi.fn());
const registerQueueClosedMock = vi.hoisted(() => vi.fn());
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
const createTraceContextMock = vi.hoisted(() => vi.fn());
const runWithTraceContextMock = vi.hoisted(() => vi.fn());
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn());
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createJobsControllerMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../server/services/client/work-queue-core/batch-deletion-coordinator.mjs",
  () => ({
    createBatchDeletionCoordinator: createBatchDeletionCoordinatorMock,
  }),
);

vi.mock(
  "../../../server/services/client/work-queue-core/archive-batch-id.mjs",
  () => ({
    resolveArchiveBatchIdentity: vi.fn().mockReturnValue("archive-batch-id"),
  }),
);

vi.mock(
  "../../../server/services/client/client-runtime-core/client-runtime-allocator.mjs",
  () => ({
    createClientRuntimeAllocator: createClientRuntimeAllocatorMock,
  }),
);

vi.mock(
  "../../../server/services/client/client-runtime-core/client-runtime-bootstrap.mjs",
  () => ({
    buildClientRuntimeBootstrapPlan: buildClientRuntimeBootstrapPlanMock,
    buildClientRuntimeBootstrapPull: buildClientRuntimeBootstrapPullMock,
  }),
);

vi.mock(
  "../../../server/services/client/work-queue-core/queue-monitor.mjs",
  () => ({
    acknowledgeQueueMonitorAlert: acknowledgeQueueMonitorAlertMock,
    inspectQueueMonitor: inspectQueueMonitorMock,
    registerQueueClosed: registerQueueClosedMock,
    registerQueueHeartbeat: registerQueueHeartbeatMock,
    registerQueueStarted: registerQueueStartedMock,
  }),
);

vi.mock("../../../server/platform/interactive/platform-registry.mjs", () => ({
  requirePlatformInterface: requirePlatformInterfaceMock,
}));

vi.mock("../../../server/platform/interactive/composition-root.mjs", () => ({
  createServerCompositionRoot: createServerCompositionRootMock,
  ensureConsoleOwner: ensureConsoleOwnerMock,
}));

vi.mock(
  "../../../server/platform/interactive/server-runtime-providers.mjs",
  () => ({
    createServerRuntimeProviders: createServerRuntimeProvidersMock,
    createServerToolManagementPlatform: createServerToolManagementPlatformMock,
    createServerToolSkillManagementProvider:
      createServerToolSkillManagementProviderMock,
  }),
);

vi.mock(
  "../../../server/platform/common/platform-core/discovery/config.mjs",
  () => ({
    loadDiscoveryConfig: loadDiscoveryConfigMock,
    resolveDiscoveryState: resolveDiscoveryStateMock,
    saveDiscoveryConfig: saveDiscoveryConfigMock,
  }),
);

vi.mock(
  "../../../server/services/client/work-queue-core/jobs/job-manager.mjs",
  () => ({
    createJobManager: createJobManagerMock,
  }),
);

vi.mock(
  "../../../server/platform/specialized/console/job-workflow-provider.mjs",
  () => ({
    createJobWorkflowProvider: createJobWorkflowProviderMock,
  }),
);

vi.mock(
  "../../../server/platform/common/observability/runtime-logger.mjs",
  () => ({
    createRuntimeLogger: createRuntimeLoggerMock,
    setRuntimeLogger: setRuntimeLoggerMock,
    summarizeError: summarizeErrorMock,
  }),
);

vi.mock(
  "../../../server/platform/common/observability/trace-context.mjs",
  () => ({
    createTraceContext: createTraceContextMock,
    runWithTraceContext: runWithTraceContextMock,
    setTraceContextOnRequest: setTraceContextOnRequestMock,
  }),
);

vi.mock("../../../server/platform/common/mcp/http-mcp-adapter.mjs", () => ({
  handlePactMcpHttpRequest: handlePactMcpHttpRequestMock,
}));

vi.mock("../../../server/platform/common/mcp/identity.mjs", () => ({
  loadOrCreateMcpIdentity: loadOrCreateMcpIdentityMock,
}));

vi.mock("../../../server/platform/common/config/ServerConfig.mjs", () => ({
  ServerConfig: {
    getDataDir: () => "/tmp/pact-http-server-test",
  },
}));

vi.mock(
  "../../../server/platform/common/console/http/controllers/jobs-controller.mjs",
  () => ({
    createJobsController: createJobsControllerMock,
  }),
);

vi.mock(
  "../../../server/platform/common/console/http/controllers/system-controller.mjs",
  () => ({
    createSystemController: createSystemControllerMock,
  }),
);

const runtimeLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-http-server-test/logs",
  retentionDays: 7,
};

function createBaseCompositionRoot(isFeatureActive, coreProvider) {
  const activeFeatureIds = isFeatureActive("agent-gateway")
    ? ["agent-gateway"]
    : [];
  const featureRuntime = {
    edition: "community",
    activeFeatureIds,
    disabledFeatureIds: [],
  };
  const consoleAuth = {
    close: vi.fn().mockResolvedValue(undefined),
    getSessionFromRequest: vi.fn(),
  };
  const securityPermissions = {
    authorizeOperation: vi.fn(),
  };
  const operationAuditStore = {
    close: vi.fn().mockResolvedValue(undefined),
  };
  const protocolEventBus = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return {
    featureRuntime,
    allApiOperationCount: 4,
    activeApiOperations: [
      { id: "system.interfaces" },
      { id: "discovery.get_config" },
      { id: "system.console_state" },
      { id: "storage.summary" },
      { id: "agent_sync.config.get" },
    ],
    publicFeatures: () => ({
      allFeatureIds: activeFeatureIds,
      systemFeatures: activeFeatureIds,
    }),
    isFeatureActive,
    isAnyFeatureActive: (...ids) => ids.some((id) => isFeatureActive(id)),
    platformRegistry: {
      requireInterface: (id) => {
        const metadataStore = {
          listPendingDeletionOperations: vi.fn().mockReturnValue([]),
        };
        const map = {
          "storage.metadataStore": { value: metadataStore },
          "core.provider": { value: coreProvider },
          "storage.provider": { value: {} },
          "devops.provider": { value: {} },
        };
        return map[id];
      },
    },
    coreProvider,
    runtime: {
      runtimeOptions: { profile: "standard" },
      close: vi.fn().mockResolvedValue(undefined),
      mounts: {},
    },
    moduleManagement: {},
    dataStructures: {},
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope: "/tmp/pact-http-server-runtime-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: vi.fn(),
    },
    storageProvider: {},
    devopsProvider: {},
    metadataStore: {
      listPendingDeletionOperations: vi.fn().mockReturnValue([]),
    },
  };
}

function createRuntimeProviders() {
  const maintenanceAgent = {
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const knowledgeSourceService = {
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    contextRuntime: {},
    maintenanceAgent,
    knowledgeSourceService,
    agentWorkspace: {
      close: vi.fn(),
    },
    strategyManagementProvider: {},
    modelDecisionRuntime: {},
    evidenceSufficiencyGate: {},
    knowledgeAgentSkill: {},
    goldenRuleRuntime: {},
    knowledgeRuleAuthoringRuntime: {},
    knowledgeSkillRuntime: {
      close: vi.fn(),
    },
    agentEvaluationRuntime: {},
    knowledgeEvolutionRuntime: {},
    summarizationRuntime: {},
    agentExplorationRuntime: {},
  };
}

function createMockCoreProvider() {
  return {
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.statusCode = 404;
      response.end('{\\"ok\\":false}');
    }),
    shouldProxyRegisteredApiRequest: vi.fn().mockReturnValue(false),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => {
      if (operationId === "system.interfaces") {
        return {
          statusCode: 200,
          payload: {
            operations: ["system.interfaces"],
          },
        };
      }
      if (operationId === "discovery.get_config") {
        return {
          statusCode: 200,
          payload: {
            config: {
              serverId: "srv-1",
            },
          },
        };
      }
      if (operationId === "agent_sync.config.get") {
        return {
          statusCode: 200,
          payload: {
            config: {
              enabled: true,
            },
          },
        };
      }
      return {
        statusCode: 200,
        payload: {
          ok: true,
        },
      };
    }),
  };
}

function setupMocks({
  activeFeatures = () => false,
  rpcHandler,
  registeredHandler,
  mcpHandler,
  throwRegisteredError = false,
} = {}) {
  summarizeErrorMock.mockImplementation((error) => {
    return error instanceof Error ? error.message : "internal";
  });

  createRuntimeLoggerMock.mockReturnValue(runtimeLogger);
  setRuntimeLoggerMock.mockImplementation(() => {});
  createTraceContextMock.mockImplementation(() => ({
    traceId: "trace-id",
  }));
  runWithTraceContextMock.mockImplementation(async (_context, callback) =>
    callback(),
  );
  setTraceContextOnRequestMock.mockImplementation(() => {});

  const coreProvider = createMockCoreProvider();
  if (rpcHandler) {
    coreProvider.dispatchRpcOperation = rpcHandler;
  }
  if (registeredHandler) {
    coreProvider.dispatchRegisteredHttpOperation = registeredHandler;
  }
  if (throwRegisteredError) {
    coreProvider.dispatchRegisteredHttpOperation = vi.fn(async () => {
      throw new Error("handler-broken");
    });
  }

  const runtimeRoot = createBaseCompositionRoot(activeFeatures, coreProvider);
  const runtimeProviders = createRuntimeProviders();
  const jobManager = {
    close: vi.fn().mockResolvedValue(undefined),
  };

  createServerCompositionRootMock.mockResolvedValue(runtimeRoot);
  ensureConsoleOwnerMock.mockResolvedValue({
    created: false,
  });
  createServerRuntimeProvidersMock.mockResolvedValue(runtimeProviders);
  createJobManagerMock.mockReturnValue(jobManager);
  createJobWorkflowProviderMock.mockReturnValue({});
  createJobsControllerMock.mockReturnValue({ close: vi.fn() });
  createSystemControllerMock.mockReturnValue({ close: vi.fn() });
  createServerToolManagementPlatformMock.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    store: {
      appendHttpRequestMetric: vi.fn(),
    },
  });
  createServerToolSkillManagementProviderMock.mockReturnValue({
    close: vi.fn(),
  });

  loadOrCreateMcpIdentityMock.mockResolvedValue({
    identity: "mcp-identity",
  });
  loadDiscoveryConfigMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local",
  });
  resolveDiscoveryStateMock.mockResolvedValue({
    serverId: "srv-1",
    activeServiceUrl: "http://127.0.0.1:7228",
    mode: "local",
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);

  requirePlatformInterfaceMock.mockImplementation((registry, id) =>
    registry.requireInterface(id),
  );

  createBatchDeletionCoordinatorMock.mockReturnValue({
    resumePendingDeletions: vi.fn().mockResolvedValue(undefined),
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});

  registerQueueStartedMock.mockResolvedValue(undefined);
  registerQueueHeartbeatMock.mockResolvedValue(undefined);
  registerQueueClosedMock.mockResolvedValue(undefined);
  inspectQueueMonitorMock.mockResolvedValue(undefined);
  acknowledgeQueueMonitorAlertMock.mockResolvedValue(undefined);

  if (mcpHandler) {
    handlePactMcpHttpRequestMock.mockImplementation(async (input) => {
      const url = input?.url;
      if (url?.pathname === "/mcp" || url?.pathname?.startsWith("/api/mcp")) {
        await mcpHandler(input);
        return true;
      }
      return false;
    });
  } else {
    handlePactMcpHttpRequestMock.mockResolvedValue(false);
  }

  return {
    runtimeRoot,
    runtimeProviders,
    coreProvider,
    jobManager,
  };
}

import {
  startHttpServer,
  startLocalHttpServer,
} from "../../../server/services/server-runtime/http-server.mjs";

function parseJsonResponse(response) {
  return response.text().then((text) => {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  });
}

function requestUrl(server, pathName) {
  const normalized = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${server.url.replace(/\/$/, "")}${normalized}`;
}

describe("http-server HTTP API lifecycle and branching", () => {
  let serverHandle = null;
  let activeRuntime = null;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close().catch(() => {});
      serverHandle = null;
    }
    activeRuntime = null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    activeRuntime = setupMocks();
  });

  it("exports start handlers", () => {
    expect(typeof startHttpServer).toBe("function");
    expect(typeof startLocalHttpServer).toBe("function");
  });

  it("starts local service with default host, ephemeral port and metadata handle", async () => {
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-local",
    });

    expect(serverHandle.host).toBe("127.0.0.1");
    expect(serverHandle.port).toBeGreaterThan(0);
    expect(serverHandle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(serverHandle.initialOwner).toEqual({ created: false });
  });

  it("serves health payload and handles /api/rpc branch", async () => {
    const rpcHandler = vi.fn(async ({ response }) => {
      response.statusCode = 200;
      response.end(JSON.stringify({ branch: "rpc" }));
    });

    activeRuntime = setupMocks({
      activeFeatures: () => false,
      rpcHandler,
    });

    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-rpc",
    });

    const healthResp = await fetch(requestUrl(serverHandle, "/"));
    const healthBody = await parseJsonResponse(healthResp);
    expect(healthResp.status).toBe(200);
    expect(healthBody).toMatchObject({
      ok: true,
      service: "Pact Server",
      serverId: expect.any(String),
    });

    const rpcResp = await fetch(requestUrl(serverHandle, "/api/rpc"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "ping" }),
    });
    const rpcBody = await parseJsonResponse(rpcResp);

    expect(rpcResp.status).toBe(200);
    expect(rpcBody).toEqual({ branch: "rpc" });
    expect(rpcHandler).toHaveBeenCalledTimes(1);
    expect(
      activeRuntime.runtimeProviders.maintenanceAgent.start,
    ).toHaveBeenCalledTimes(1);
    expect(
      activeRuntime.runtimeProviders.knowledgeSourceService.start,
    ).toHaveBeenCalledTimes(1);
  });

  it("routes MCP, registered API, and static fallback branches", async () => {
    const mcpHandler = vi.fn(async ({ response }) => {
      response.statusCode = 200;
      response.end(JSON.stringify({ branch: "mcp" }));
      return true;
    });
    const apiHandler = vi.fn(async ({ response, url }) => {
      if (!url.pathname.startsWith("/api/")) {
        return false;
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ branch: "api", path: url.pathname }));
      return true;
    });

    activeRuntime = setupMocks({
      mcpHandler,
      registeredHandler: apiHandler,
    });

    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-api",
    });

    const mcpResp = await fetch(requestUrl(serverHandle, "/mcp"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ cmd: "probe" }),
    });
    const mcpBody = await parseJsonResponse(mcpResp);
    expect(mcpResp.status).toBe(200);
    expect(mcpBody).toEqual({ branch: "mcp" });
    expect(mcpHandler).toHaveBeenCalledTimes(1);

    const apiResp = await fetch(requestUrl(serverHandle, "/api/tool/one"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ tool: "x" }),
    });
    const apiBody = await parseJsonResponse(apiResp);
    expect(apiResp.status).toBe(200);
    expect(apiBody).toEqual({ branch: "api", path: "/api/tool/one" });

    const staticResp = await fetch(requestUrl(serverHandle, "/assets/app.js"));
    const staticBody = await parseJsonResponse(staticResp);
    expect(staticResp.status).toBe(404);
    expect(staticBody).toEqual({ error: "资源不存在：/assets/app.js" });
    expect(
      activeRuntime.coreProvider.dispatchRegisteredHttpOperation,
    ).toHaveBeenCalledTimes(2);
    expect(handlePactMcpHttpRequestMock).toHaveBeenCalledTimes(3);
  });

  it("maps handler errors to 500 json", async () => {
    activeRuntime = setupMocks({
      throwRegisteredError: true,
    });

    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-error",
    });

    const errorResp = await fetch(requestUrl(serverHandle, "/api/fault"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ fault: true }),
    });

    expect(errorResp.status).toBe(500);
    expect(await parseJsonResponse(errorResp)).toEqual({
      error: "handler-broken",
    });
  });

  it("stops and closes runtime dependencies via returned close", async () => {
    activeRuntime = setupMocks({ activeFeatures: () => false });
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-close",
    });

    await serverHandle.close();

    expect(
      activeRuntime.runtimeProviders.maintenanceAgent.close,
    ).toHaveBeenCalled();
    expect(
      activeRuntime.runtimeProviders.knowledgeSourceService.close,
    ).toHaveBeenCalled();
    expect(
      activeRuntime.runtimeProviders.agentWorkspace.close,
    ).toHaveBeenCalled();
    expect(
      activeRuntime.runtimeProviders.knowledgeSkillRuntime.close,
    ).toHaveBeenCalled();
    expect(activeRuntime.runtimeRoot.runtime.close).toHaveBeenCalled();
    expect(activeRuntime.jobManager.close).toHaveBeenCalled();
    expect(runtimeLogger.close).toHaveBeenCalled();
    serverHandle = null;
  });

  it("enforces public-host safety and allows explicit public mode", async () => {
    await expect(
      startHttpServer({
        userDataPath: "/tmp/pact-http-server-public",
        host: "0.0.0.0",
      }),
    ).rejects.toThrow(/服务端默认只允许监听本机回环地址/);

    activeRuntime = setupMocks();
    serverHandle = await startHttpServer({
      userDataPath: "/tmp/pact-http-server-public",
      host: "0.0.0.0",
      runtimeOptions: {
        allowPublicConsole: true,
      },
    });

    expect(serverHandle.host).toBe("0.0.0.0");
    expect(serverHandle.port).toBeGreaterThan(0);
    await serverHandle.close();
    serverHandle = null;
  });

  it("rejects disabled console auth configuration", async () => {
    await expect(
      startLocalHttpServer({
        userDataPath: "/tmp/pact-http-server-auth",
        runtimeOptions: {
          consoleAuth: "disabled",
        },
      }),
    ).rejects.toThrow(/PACT_CONSOLE_AUTH=disabled/);
  });

  it("publishes startup snapshots and optional agent-gateway snapshot branch", async () => {
    activeRuntime = setupMocks({
      activeFeatures: (name) => name === "agent-gateway",
    });

    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-snapshots",
    });

    const eventTypes =
      activeRuntime.runtimeRoot.protocolEventBus.publish.mock.calls.map(
        ([, , metadata]) => metadata?.type,
      );
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "server.started",
        "system.interfaces.snapshot",
        "discovery.config.snapshot",
        "agent_sync.config.snapshot",
        "system.console_state.snapshot",
        "storage.summary.snapshot",
      ]),
    );

    expect(
      activeRuntime.runtimeRoot.coreProvider.dispatchInternalOperation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "agent_sync.config.get" }),
    );
  });
});
