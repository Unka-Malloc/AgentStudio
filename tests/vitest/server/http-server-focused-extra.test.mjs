import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => error?.message || String(error || "")));
const createTraceContextMock = vi.hoisted(() => vi.fn());
const runWithTraceContextMock = vi.hoisted(() => vi.fn());
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn());
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createJobsControllerMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/services/client/work-queue-core/batch-deletion-coordinator.mjs", () => ({
  createBatchDeletionCoordinator: createBatchDeletionCoordinatorMock
}));

vi.mock("../../../server/services/client/work-queue-core/archive-batch-id.mjs", () => ({
  resolveArchiveBatchIdentity: vi.fn().mockReturnValue("archive-batch-id")
}));

vi.mock("../../../server/services/client/client-runtime-core/client-runtime-allocator.mjs", () => ({
  createClientRuntimeAllocator: createClientRuntimeAllocatorMock
}));

vi.mock("../../../server/services/client/client-runtime-core/client-runtime-bootstrap.mjs", () => ({
  buildClientRuntimeBootstrapPlan: buildClientRuntimeBootstrapPlanMock,
  buildClientRuntimeBootstrapPull: buildClientRuntimeBootstrapPullMock
}));

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", () => ({
  acknowledgeQueueMonitorAlert: acknowledgeQueueMonitorAlertMock,
  inspectQueueMonitor: inspectQueueMonitorMock,
  registerQueueClosed: registerQueueClosedMock,
  registerQueueHeartbeat: registerQueueHeartbeatMock,
  registerQueueStarted: registerQueueStartedMock
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
    getDataDir: () => "/tmp/pact-http-server-focused"
  }
}));

vi.mock("../../../server/platform/common/console/http/controllers/jobs-controller.mjs", () => ({
  createJobsController: createJobsControllerMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller.mjs", () => ({
  createSystemController: createSystemControllerMock
}));

const runtimeLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  logDir: "/tmp/pact-http-server-focused/logs",
  retentionDays: 7
};

function createBaseCompositionRoot(coreProvider) {
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
        const metadataStore = {
          listPendingDeletionOperations: vi.fn().mockReturnValue([])
        };
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
    operationConcurrencyScope: "/tmp/pact-http-server-focused-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: vi.fn()
    },
    storageProvider: {},
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

function setupMocks() {
  const coreProvider = createMockCoreProvider();
  const runtimeRoot = createBaseCompositionRoot(coreProvider);
  const runtimeProviders = createRuntimeProviders();

  createRuntimeLoggerMock.mockReturnValue(runtimeLogger);
  setRuntimeLoggerMock.mockImplementation(() => {});
  createTraceContextMock.mockImplementation(() => ({ traceId: "trace-id" }));
  runWithTraceContextMock.mockImplementation(async (_context, callback) => callback());
  setTraceContextOnRequestMock.mockImplementation(() => {});
  summarizeErrorMock.mockImplementation((error) => error instanceof Error ? error.message : "internal");

  createServerCompositionRootMock.mockResolvedValue(runtimeRoot);
  ensureConsoleOwnerMock.mockResolvedValue({ created: false });
  createServerRuntimeProvidersMock.mockResolvedValue(runtimeProviders);
  createJobManagerMock.mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) });
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
  requirePlatformInterfaceMock.mockImplementation((registry, id) => registry.requireInterface(id));
  createBatchDeletionCoordinatorMock.mockReturnValue({
    resumePendingDeletions: vi.fn().mockResolvedValue(undefined)
  });
  createClientRuntimeAllocatorMock.mockReturnValue({});
  buildClientRuntimeBootstrapPlanMock.mockReturnValue({});
  buildClientRuntimeBootstrapPullMock.mockReturnValue({});
  registerQueueStartedMock.mockResolvedValue(undefined);
  registerQueueHeartbeatMock.mockResolvedValue(undefined);
  registerQueueClosedMock.mockResolvedValue(undefined);
  inspectQueueMonitorMock.mockResolvedValue(undefined);
  acknowledgeQueueMonitorAlertMock.mockResolvedValue(undefined);
  handlePactMcpHttpRequestMock.mockResolvedValue(false);

  return { runtimeRoot, runtimeProviders };
}

import { startHttpServer, startLocalHttpServer } from "../../../server/services/server-runtime/http-server.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function requestUrl(server, route) {
  return `${server.url.replace(/\/$/, "")}/${String(route).replace(/^\/+/, "")}`;
}

let serverHandle = null;
const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

afterEach(async () => {
  if (serverHandle) {
    await serverHandle.close().catch(() => {});
    serverHandle = null;
  }
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("http-server focused extra coverage", () => {
  it("keeps security headers on fallback JSON responses and uses forwarded IPs for rate limiting", async () => {
    serverHandle = await startLocalHttpServer({
      userDataPath: "/tmp/pact-http-server-focused-rate-limit",
      runtimeOptions: {
        httpRateLimitPerIpPerMinute: 1,
        httpRateLimitPerSubjectPerMinute: 999,
        httpRateLimitLoginPerIpPerMinute: 999
      }
    });

    const first = await fetch(requestUrl(serverHandle, "/missing-route"), {
      headers: {
        "x-forwarded-for": "203.0.113.10"
      }
    });
    const firstBody = await readJson(first);
    expect(first.status).toBe(404);
    expect(firstBody).toEqual({ error: "接口不存在：/missing-route" });
    expect(first.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("x-frame-options")).toBe("DENY");
    expect(first.headers.get("content-security-policy")).toContain("script-src 'self'");

    const limited = await fetch(requestUrl(serverHandle, "/another-missing-route"), {
      headers: {
        "x-forwarded-for": "203.0.113.10"
      }
    });
    const limitedBody = await readJson(limited);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.headers.get("x-ratelimit-limit")).toBe("1");
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(limitedBody).toEqual({
      error: "访问频率过高（IP 限流）。",
      policy: "rate-limited"
    });

    const otherIp = await fetch(requestUrl(serverHandle, "/third-missing-route"), {
      headers: {
        "x-forwarded-for": "203.0.113.11"
      }
    });
    expect(otherIp.status).toBe(404);
  });

  it("rejects project-local data directories inside the source checkout", async () => {
    await expect(startLocalHttpServer({
      userDataPath: path.join(repoRoot, "tmp-local-server-data")
    })).rejects.toThrow(/Refusing project-local Pact server data dir/);
  });

  it("writes initial owner credentials to a private file without printing secrets", async () => {
    const userDataPath = await tempDir("pact-http-server-focused-owner-");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    ensureConsoleOwnerMock.mockResolvedValueOnce({
      created: true,
      username: "owner",
      password: "generated-password"
    });

    try {
      serverHandle = await startLocalHttpServer({
        userDataPath
      });
      const credentialsPath = path.join(userDataPath, "auth", "initial-credentials.txt");
      const credentials = await fs.readFile(credentialsPath, "utf8");
      const stat = await fs.stat(credentialsPath);

      expect(credentials).toContain("Username : owner");
      expect(credentials).toContain("Password : generated-password");
      expect(stat.mode & 0o777).toBe(0o600);
      expect(runtimeLogger.warn).toHaveBeenCalledWith(
        "server.initialOwner.credentials_file",
        expect.objectContaining({
          credentialsPath
        })
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("初始 owner 已创建"));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("routes JSON-RPC requests through registered core provider with authorization", async () => {
    const { runtimeRoot } = setupMocks();
    serverHandle = await startLocalHttpServer({
      userDataPath: await tempDir("pact-http-server-focused-rpc-")
    });

    const response = await fetch(requestUrl(serverHandle, "/api/rpc"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operationId: "system.interfaces",
        input: {}
      })
    });

    expect(response.status).toBe(404);
    expect(runtimeRoot.coreProvider.dispatchRpcOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [{ id: "system.interfaces" }],
        controllers: expect.any(Object),
        requestBody: expect.any(Buffer),
        authorizeOperation: expect.any(Function)
      })
    );
  });

  it("injects a CSP nonce into inline console fallback scripts", async () => {
    const userDataPath = await tempDir("pact-http-server-focused-static-");
    const distPath = path.join(userDataPath, "dist");
    await fs.mkdir(distPath, { recursive: true });
    await fs.writeFile(
      path.join(distPath, "index.html"),
      [
        "<!doctype html>",
        "<html><head>",
        "<script>window.__one = true;</script>",
        "<script nonce=\"existing\">window.__two = true;</script>",
        "<script src=\"/assets/app.js\"></script>",
        "</head><body>Pact</body></html>"
      ].join(""),
      "utf8"
    );
    await fs.mkdir(path.join(distPath, "assets"), { recursive: true });
    await fs.writeFile(path.join(distPath, "assets", "app.js"), "window.__asset = true;\n", "utf8");

    serverHandle = await startLocalHttpServer({
      userDataPath,
      distPath
    });

    const response = await fetch(requestUrl(serverHandle, "/console/deep/link"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toMatch(/<script nonce="[^"]+">window\.__one = true;<\/script>/);
    expect(html).toContain('<script nonce="existing">window.__two = true;</script>');
    expect(html).toContain('<script src="/assets/app.js"></script>');

    const assetResponse = await fetch(requestUrl(serverHandle, "/assets/app.js"));
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain("window.__asset = true");
  });

  it("logs and rethrows close failures after the HTTP listener drains", async () => {
    const { runtimeRoot } = setupMocks();
    runtimeRoot.runtime.close.mockRejectedValueOnce(new Error("runtime close failed"));
    serverHandle = await startLocalHttpServer({
      userDataPath: await tempDir("pact-http-server-focused-close-failure-")
    });

    const handle = serverHandle;
    serverHandle = null;
    await expect(handle.close()).rejects.toThrow("runtime close failed");
    expect(runtimeLogger.error).toHaveBeenCalledWith(
      "server.close.failed",
      expect.objectContaining({
        error: "runtime close failed"
      })
    );
  });
});
