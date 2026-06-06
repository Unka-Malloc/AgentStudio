import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolCatalog } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";

const dispatchOperationMock = vi.hoisted(() => vi.fn(async ({ response }) => {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    schemaVersion: 1,
    result: { ok: true }
  }));
  return { ok: true };
}));
const sendJsonMock = vi.hoisted(() => vi.fn((response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}));
const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => ({
  name: error?.name || "Error",
  message: error?.message || String(error || "")
})));
const summarizeForLogMock = vi.hoisted(() => vi.fn((value) => value));
const getRuntimeLoggerMock = vi.hoisted(() => vi.fn(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
})));
const traceContextFromRequestMock = vi.hoisted(() => vi.fn(() => ({
  traceId: "trace-tool-management-more-extra"
})));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  dispatchOperation: dispatchOperationMock,
  getRuntimeLogger: getRuntimeLoggerMock,
  sendJson: sendJsonMock,
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock,
  traceContextFromRequest: traceContextFromRequestMock
}));

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = "") {
      this.body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      this.ended = true;
    }
  };
}

function createRequest({ headers = {}, id = "req-1" } = {}) {
  return {
    __pactRequestId: id,
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
}

function createUrl(pathname) {
  return new URL(pathname, "http://127.0.0.1");
}

function createPlatform(overrides = {}) {
  const platform = {
    catalog: vi.fn(() => ({ schemaVersion: 1, catalog: true })),
    registry: {
      getTool: vi.fn((toolId) => ({ id: toolId })),
      getToolByOperationId: vi.fn(() => null),
      listToolsets: vi.fn(() => [{ id: "toolset-1" }]),
      resolveToolset: vi.fn((payload) => ({ resolved: true, payload })),
      listProfiles: vi.fn(() => [{ id: "profile-1" }])
    },
    runtime: {
      executeTool: vi.fn(),
      resumePendingOperation: vi.fn()
    },
    store: {
      listGrants: vi.fn(() => [{ id: "grant-1" }]),
      createGrant: vi.fn(),
      rotateGrantToken: vi.fn(),
      revokeGrant: vi.fn(),
      updateGrant: vi.fn(),
      listAudit: vi.fn(() => []),
      getAudit: vi.fn(() => null),
      metricsSummary: vi.fn(() => ({ schemaVersion: 1 })),
      metricsExport: vi.fn(() => ({ schemaVersion: 1 })),
      metricsHealth: vi.fn(() => ({ schemaVersion: 1 })),
      metricsPrometheus: vi.fn(() => "metric 1"),
      metricsStorageSummary: vi.fn(() => ({ schemaVersion: 1 })),
      pruneMetrics: vi.fn(() => ({ schemaVersion: 1 })),
      listPendingOperations: vi.fn(() => [])
    },
    policyEngine: {
      preview: vi.fn(() => ({ effect: "allow" }))
    }
  };

  return Object.assign(platform, overrides, {
    runtime: { ...platform.runtime, ...(overrides.runtime || {}) },
    registry: { ...platform.registry, ...(overrides.registry || {}) },
    store: { ...platform.store, ...(overrides.store || {}) }
  });
}

async function callRouter(router, {
  method = "GET",
  path: pathname,
  body = null,
  headers = {},
  requestId = "req-1"
}) {
  const response = createResponse();
  const request = createRequest({ headers, id: requestId });
  const requestBody = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf8");
  const handled = await router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url: createUrl(pathname),
    method
  });
  return { handled, request, response, requestBody };
}

function createRuntimeFixture(overrides = {}) {
  const operation = {
    id: "jobs.list",
    http: {
      method: "POST",
      path: "/jobs/:id"
    },
    inputSchema: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" }
      }
    },
    safety: { approvalScope: "tool:approve" },
    ...overrides.operation
  };
  const tool = {
    id: "pact.jobs.read",
    operationId: operation.id,
    version: "1.0.0",
    toolsets: ["pact.jobs.read"],
    requiredScopes: ["jobs:read"],
    risk: "read_only",
    timeoutMs: 2_000,
    maxResultBytes: 1_024,
    concurrencySafe: true,
    requiresApproval: false,
    approvalScope: "",
    ...overrides.tool
  };
  const store = {
    authorizeRequest: vi.fn(async () => ({
      ok: true,
      grant: { id: "grant-1" },
      sourceIp: "127.0.0.1"
    })),
    appendExecution: vi.fn(),
    appendMetric: vi.fn(),
    appendPolicyDecision: vi.fn(),
    createPendingOperation: vi.fn(),
    getPendingOperation: vi.fn(),
    resolvePendingOperation: vi.fn(),
    getRawGrant: vi.fn(() => null),
    ...overrides.store
  };
  const registry = {
    getTool: vi.fn(() => tool),
    listProfiles: vi.fn(() => []),
    ...overrides.registry
  };
  const policyEngine = {
    evaluate: vi.fn(() => ({
      effect: "allow",
      decisionId: "policy-more-extra",
      reasonCode: "",
      redactedReason: "",
      missingScopes: [],
      missingCapabilities: [],
      missingToolsets: [],
      grantPolicyRevision: 1,
      grantPolicyState: "active",
      governancePolicyRevision: {
        protocolVersion: "pact.policy.v1",
        revision: 1,
        updatedAt: "2026-06-05T00:00:00.000Z"
      }
    })),
    ...overrides.policyEngine
  };

  const runtime = createToolExecutionRuntime({
    registry,
    store,
    policyEngine,
    operations: [operation],
    logger: getRuntimeLoggerMock(),
    ...overrides.runtimeOptions
  });

  return { runtime, store, registry, tool, operation, policyEngine };
}

beforeEach(() => {
  dispatchOperationMock.mockClear();
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
  traceContextFromRequestMock.mockClear();
});

describe("tool-management core HTTP/catalog/runtime more extra coverage", () => {
  it("parses catalog operations, filters feature-gated internal tools, and rejects invalid metadata", () => {
    const catalog = createToolCatalog({
      activeFeatureIds: ["core-platform"],
      operations: [
        {
          id: "jobs.list",
          label: "Jobs list",
          http: { method: "get", path: "/jobs" }
        },
        {
          id: "runtime.info",
          label: "Runtime info",
          http: { method: "post", path: "/runtime/info" }
        }
      ]
    });

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.tools.find((tool) => tool.id === "pact.jobs.list")).toMatchObject({
      id: "pact.jobs.list",
      operationId: "jobs.list",
      transport: {
        http: {
          method: "GET",
          path: "/jobs"
        }
      },
      requiredScopes: ["jobs:read"],
      toolsets: ["pact.jobs.read"],
      status: "active"
    });
    expect(catalog.tools.find((tool) => tool.id === "pact.runtime.info")).toMatchObject({
      id: "pact.runtime.info",
      operationId: "runtime.info",
      toolsets: ["pact.storage.read", "pact.runtime.read"],
      requiredScopes: ["storage:read"]
    });
    expect(catalog.tools.some((tool) => tool.status === "internal")).toBe(false);
    expect(catalog.tools.find((tool) => tool.id === "agent-exploration.keyword_search")).toBeUndefined();

    expect(() => createToolCatalog({
      operations: [
        {
          id: "jobs.list",
          label: "Broken jobs list",
          externalMcp: {
            serviceId: "mcp-service",
            upstreamToolName: "jobs"
          },
          requiredScopes: ["bogus:scope"],
          http: { method: "post", path: "/jobs" }
        }
      ]
    })).toThrow("references unknown scope: bogus:scope");
  });

  it("returns console_unauthenticated when catalog access is denied", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({
      platform,
      securityPermissions: {
        authorizeOperation: vi.fn(async () => ({
          ok: false,
          status: 401,
          error: "login required"
        }))
      },
      logger: getRuntimeLoggerMock()
    });

    const result = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/catalog"
    });

    expect(result.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 401, {
      schemaVersion: 1,
      error: {
        code: "console_unauthenticated",
        message: "login required",
        details: {
          bootstrap: undefined
        }
      }
    });
  });

  it("treats empty resolve payloads as {} and returns 503 when pending operation runtime is absent", async () => {
    const platform = createPlatform({
      runtime: {
        resumePendingOperation: undefined
      }
    });
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const resolve = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/toolsets/resolve"
    });

    expect(resolve.handled).toBe(true);
    expect(platform.registry.resolveToolset).toHaveBeenCalledWith({});
    expect(sendJsonMock).toHaveBeenLastCalledWith(resolve.response, 200, {
      schemaVersion: 1,
      result: {
        resolved: true,
        payload: {}
      }
    });

    sendJsonMock.mockClear();
    const pending = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending-1/resolve",
      headers: {
        "x-pact-safety-confirm": "true"
      },
      body: {
        resolution: "approved"
      }
    });

    expect(pending.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(pending.response, 503, {
      schemaVersion: 1,
      error: {
        code: "pending_operation_runtime_unavailable",
        message: "Pending operation runtime is unavailable."
      }
    });
  });

  it("maps a successful direct dispatch response and a thrown handler error", async () => {
    const successFixture = createRuntimeFixture();
    const success = await successFixture.runtime.executeTool({
      toolId: successFixture.tool.id,
      input: {},
      request: createRequest(),
      directOperation: successFixture.operation,
      directUrl: createUrl("/jobs/job-1"),
      directRequestBody: Buffer.from(JSON.stringify({
        id: "job-1",
        name: "alpha"
      }), "utf8"),
      directParams: {
        id: "job-1"
      }
    });

    expect(success).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        status: "ok",
        result: {
          ok: true
        }
      }
    });
    expect(dispatchOperationMock).toHaveBeenCalledTimes(1);
    expect(successFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "ok",
      errorCode: ""
    }));

    dispatchOperationMock.mockImplementationOnce(async () => {
      const error = new Error("dispatch failed");
      error.code = "dispatch_failed";
      error.statusCode = 502;
      throw error;
    });

    const failureFixture = createRuntimeFixture();
    const failure = await failureFixture.runtime.executeTool({
      toolId: failureFixture.tool.id,
      input: {},
      request: createRequest(),
      directOperation: failureFixture.operation,
      directUrl: createUrl("/jobs/job-2"),
      directRequestBody: Buffer.from(JSON.stringify({
        id: "job-2",
        name: "beta"
      }), "utf8"),
      directParams: {
        id: "job-2"
      }
    });

    expect(failure).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "tool_execution_failed",
          message: "dispatch failed"
        }
      }
    });
    expect(summarizeErrorMock).toHaveBeenCalled();
    expect(failureFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "tool_execution_failed",
      resultSummary: expect.objectContaining({
        type: "runtime_error"
      })
    }));
  });
});
