import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServerMock = vi.hoisted(() => vi.fn());
const readRequestBodyMock = vi.hoisted(() => vi.fn());
const handlePactMcpHttpRequestMock = vi.hoisted(() => vi.fn());
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
const loadOrCreateMcpIdentityMock = vi.hoisted(() => vi.fn());
const createSystemControllerMock = vi.hoisted(() => vi.fn());

vi.mock("node:http", async () => {
  const actual = await vi.importActual("node:http");
  return {
    ...actual,
    createServer: createServerMock,
    default: {
      ...actual.default,
      createServer: createServerMock
    }
  };
});

vi.mock("../../../server/platform/common/console/http/http-utils.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/console/http/http-utils.mjs");
  return {
    ...actual,
    readRequestBody: readRequestBodyMock
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
    getDataDir: () => "/tmp/pact-http-server-jobs-controller-more-extra"
  }
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
  logDir: "/tmp/pact-http-server-jobs-controller-more-extra/logs",
  retentionDays: 7
};

function createResponseCapture() {
  const headers = {};
  let body = [];
  let statusCode = null;
  let closed = false;

  return {
    headers,
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = value;
    },
    get headersSent() {
      return statusCode !== null || body.length > 0;
    },
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
    once: vi.fn(),
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      Object.assign(headers, nextHeaders);
      closed = false;
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      closed = true;
    },
    bodyBuffer() {
      return Buffer.concat(body);
    },
    json() {
      return JSON.parse(this.bodyBuffer().toString("utf8") || "{}");
    },
    wasClosed() {
      return closed;
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
  const jobs = new Map([
    ["completed", { id: "completed", status: "completed" }],
    ["running", { id: "running", status: "running" }]
  ]);

  return {
    createJob: vi.fn(async (payload) => ({ id: "created-job", status: "queued", payload })),
    getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async (jobId) => ({ jobId, ok: true })),
    listJobs: vi.fn(async ({ limit }) => [{ id: "listed-job", limit }]),
    reparseJob: vi.fn(async (jobId, options) => ({ id: `${jobId}-reparsed`, status: "queued", options })),
    ...overrides
  };
}

function createMockCoreProvider() {
  return {
    dispatchRpcOperation: vi.fn(async ({ response }) => {
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true }));
    }),
    shouldProxyRegisteredApiRequest: vi.fn().mockReturnValue(false),
    dispatchRegisteredHttpOperation: vi.fn(async () => false),
    dispatchInternalOperation: vi.fn(async ({ operationId }) => ({
      statusCode: 200,
      payload: { ok: true, operationId }
    }))
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
    operationConcurrencyScope: "/tmp/pact-http-server-jobs-controller-more-extra-scope",
    protocolEventBus,
    consoleDomainServices: {
      loadNormalizedDocumentStore: vi.fn(),
      uploadSessionStore: createRequiredUploadSessionStore()
    },
    storageProvider: {},
    devopsProvider: {},
    metadataStore: {
      listPendingDeletionOperations: vi.fn().mockReturnValue([])
    }
  };
}

function setupHttpServerMocks() {
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
  createJobWorkflowProviderMock.mockReturnValue(createRequiredJobWorkflow());
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
    advertisedBaseUrl: "http://127.0.0.1:7228",
    mode: "local"
  });
  saveDiscoveryConfigMock.mockResolvedValue(undefined);
  requirePlatformInterfaceMock.mockImplementation((registry, id) => registry.requireInterface(id));
  createBatchDeletionCoordinatorMock.mockReturnValue({
    deleteBatch: vi.fn(),
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

  let capturedHandler = null;
  createServerMock.mockImplementation((handler) => {
    capturedHandler = handler;
    return {
      listen(_port, _host, callback) {
        callback?.();
      },
      once: vi.fn(),
      removeListener: vi.fn(),
      on: vi.fn(),
      close: vi.fn((callback) => callback?.()),
      address: vi.fn(() => ({ address: "127.0.0.1", port: 7228 })),
      maxConnections: 0
    };
  });

  return {
    coreProvider,
    runtimeProviders,
    runtimeRoot,
    getCapturedHandler: () => capturedHandler
  };
}

function createRequest({ method = "GET", url = "/missing-route", headers = {}, socket = {} } = {}) {
  return {
    method,
    url,
    headers,
    socket: {
      encrypted: false,
      remoteAddress: "127.0.0.1",
      ...socket
    }
  };
}

let serverHandle = null;
let httpServerHarness = null;

beforeEach(() => {
  vi.clearAllMocks();
  httpServerHarness = setupHttpServerMocks();
});

afterEach(async () => {
  if (serverHandle) {
    await serverHandle.close().catch(() => {});
    serverHandle = null;
  }
});

import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";
import { startHttpServer } from "../../../server/services/server-runtime/http-server.mjs";

describe("http-server and jobs controller focused boundary coverage", () => {
  it("skips request body reading on GET and forwards POST bodies to registered dispatch", async () => {
    readRequestBodyMock.mockResolvedValue(Buffer.from("posted-body"));

    serverHandle = await startHttpServer({
      userDataPath: "/tmp/pact-http-server-jobs-controller-more-extra",
      host: "127.0.0.1",
      port: 0
    });

    const handler = httpServerHarness.getCapturedHandler();
    expect(handler).toBeTypeOf("function");

    const getResponse = createResponseCapture();
    await handler(createRequest({ method: "GET", url: "/missing-route" }), getResponse);
    expect(readRequestBodyMock).not.toHaveBeenCalled();
    expect(httpServerHarness.coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        requestBody: Buffer.alloc(0)
      })
    );
    expect(getResponse.statusCode).toBe(404);
    expect(getResponse.json()).toEqual({ error: "接口不存在：/missing-route" });

    readRequestBodyMock.mockClear();
    const postResponse = createResponseCapture();
    await handler(createRequest({
      method: "POST",
      url: "/missing-route",
      headers: { "content-type": "text/plain" }
    }), postResponse);
    expect(readRequestBodyMock).toHaveBeenCalledTimes(1);
    expect(httpServerHarness.coreProvider.dispatchRegisteredHttpOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        requestBody: Buffer.from("posted-body")
      })
    );
    expect(postResponse.statusCode).toBe(404);
    expect(postResponse.json()).toEqual({ error: "接口不存在：/missing-route" });
  });

  it("maps request body reader failures to json errors before route dispatch", async () => {
    const bodyError = new Error("请求体过大");
    bodyError.statusCode = 413;
    readRequestBodyMock.mockRejectedValue(bodyError);

    serverHandle = await startHttpServer({
      userDataPath: "/tmp/pact-http-server-jobs-controller-more-extra",
      host: "127.0.0.1",
      port: 0
    });

    const handler = httpServerHarness.getCapturedHandler();
    const response = createResponseCapture();
    await handler(createRequest({
      method: "POST",
      url: "/api/rpc",
      headers: { "content-type": "application/json" }
    }), response);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "请求体过大" });
    expect(httpServerHarness.coreProvider.dispatchRpcOperation).not.toHaveBeenCalled();
  });

  it("treats empty create-job bodies as defaults and rejects malformed JSON payloads", async () => {
    const jobWorkflowProvider = createRequiredJobWorkflow();
    const controller = createJobsController({
      userDataPath: "/tmp/pact-jobs-controller-more-extra",
      jobWorkflowProvider,
      storageProvider: {
        readRawObjectById: vi.fn(async () => null)
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
      uploadSessionStore: createRequiredUploadSessionStore()
    });

    const emptyResponse = createResponseCapture();
    await controller.handleCreateJob({
      request: {},
      requestBody: Buffer.alloc(0),
      response: emptyResponse
    });
    expect(emptyResponse.statusCode).toBe(202);
    expect(jobWorkflowProvider.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        filePaths: [],
        uploadedFiles: [],
        settings: {}
      })
    );

    await expect(controller.handleCreateJob({
      request: {},
      requestBody: Buffer.from("{\"uploadedFiles\":"),
      response: createResponseCapture()
    })).rejects.toBeInstanceOf(SyntaxError);
  });

  it("covers missing-job and failed-upload boundary responses on the jobs controller", async () => {
    const appendUploadSessionChunk = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: "file_not_found",
        expectedOffset: 0,
        session: null
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "chunk_too_large",
        expectedOffset: 3,
        session: { sessionId: "session-1", status: "receiving" }
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "sha256_mismatch",
        expectedOffset: 1,
        session: { sessionId: "session-1", status: "receiving" }
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "bad_request",
        expectedOffset: 0,
        session: { sessionId: "session-1", status: "receiving" }
      });
    const jobWorkflowProvider = createRequiredJobWorkflow({
      getJob: vi.fn(async (jobId) => {
        if (jobId === "missing") {
          return null;
        }
        if (jobId === "running") {
          return { id: "running", status: "running" };
        }
        return { id: jobId, status: "completed" };
      }),
      getJobResult: vi.fn(async (jobId) => ({ jobId, ok: true }))
    });

    const controller = createJobsController({
      userDataPath: "/tmp/pact-jobs-controller-more-extra",
      jobWorkflowProvider,
      storageProvider: {
        readRawObjectById: vi.fn(async () => null)
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
      uploadSessionStore: createRequiredUploadSessionStore({
        appendUploadSessionChunk
      })
    });

    const missingJobResponse = createResponseCapture();
    await controller.handleGetJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      response: missingJobResponse
    });
    expect(missingJobResponse.statusCode).toBe(404);
    expect(missingJobResponse.json()).toEqual({ error: "任务不存在。" });

    const pendingResultResponse = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "running",
      response: pendingResultResponse
    });
    expect(pendingResultResponse.statusCode).toBe(409);
    expect(pendingResultResponse.json()).toEqual({ error: "任务尚未完成。" });

    const missingResultResponse = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      response: missingResultResponse
    });
    expect(missingResultResponse.statusCode).toBe(404);
    expect(missingResultResponse.json()).toEqual({ error: "任务不存在。" });

    const fileNotFoundResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("chunk"),
      response: fileNotFoundResponse
    });
    expect(fileNotFoundResponse.statusCode).toBe(400);
    expect(fileNotFoundResponse.json()).toMatchObject({
      code: "file_not_found",
      error: "上传文件索引不存在。"
    });

    const chunkTooLargeResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("chunk"),
      response: chunkTooLargeResponse
    });
    expect(chunkTooLargeResponse.statusCode).toBe(409);
    expect(chunkTooLargeResponse.json()).toMatchObject({
      code: "chunk_too_large",
      error: "上传分块超过剩余文件大小。"
    });

    const shaMismatchResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("chunk"),
      response: shaMismatchResponse
    });
    expect(shaMismatchResponse.statusCode).toBe(409);
    expect(shaMismatchResponse.json()).toMatchObject({
      code: "sha256_mismatch",
      error: "上传文件哈希校验失败，已重置该文件上传进度。"
    });

    const genericFailureResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("chunk"),
      response: genericFailureResponse
    });
    expect(genericFailureResponse.statusCode).toBe(400);
    expect(genericFailureResponse.json()).toMatchObject({
      code: "bad_request",
      error: "上传会话不存在。"
    });
  });
});
