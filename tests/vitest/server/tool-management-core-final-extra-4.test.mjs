import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolCatalog, createToolCatalogRegistry } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";
import { createToolManagementStore } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";

const dispatchOperationMock = vi.hoisted(() => vi.fn(async ({ response }) => {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ schemaVersion: "v0.0.1:schema:definition-1", result: { ok: true } }));
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
  traceId: "trace-tool-management-core-final-extra-4"
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

function createSecurityPermissions(overrides = {}) {
  return {
    authorizeOperation: vi.fn(async () => ({
      ok: true,
      session: {
        user: {
          userId: "console-user",
          roleId: "console-role"
        }
      }
    })),
    ...overrides
  };
}

function createPlatform(overrides = {}) {
  const platform = {
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
    registry: {
      getTool: vi.fn(() => null),
      getToolByOperationId: vi.fn(() => null),
      listToolsets: vi.fn(() => []),
      resolveToolset: vi.fn((payload) => payload),
      listProfiles: vi.fn(() => [])
    },
    runtime: {
      executeTool: vi.fn(async () => ({
        status: 200,
        payload: {
          schemaVersion: "v0.0.1:schema:definition-1",
          result: { ok: true }
        }
      }))
    },
    store: {
      listGrants: vi.fn(() => []),
      createGrant: vi.fn(async () => ({ grant: { id: "grant-1" }, token: "ock_test" })),
      rotateGrantToken: vi.fn(async () => ({ grant: { id: "grant-1" }, token: "ock_rotated" })),
      revokeGrant: vi.fn(async () => ({ id: "grant-1" })),
      updateGrant: vi.fn(() => ({ id: "grant-1" })),
      listAudit: vi.fn(() => []),
      getAudit: vi.fn(() => null),
      metricsSummary: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsExport: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsHealth: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsPrometheus: vi.fn(() => "metric"),
      metricsStorageSummary: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      pruneMetrics: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      listPendingOperations: vi.fn(() => []),
      resolvePendingOperation: vi.fn(async () => ({ status: 200, payload: { schemaVersion: "v0.0.1:schema:definition-1" } }))
    },
    policyEngine: {
      preview: vi.fn(() => ({ effect: "allow" }))
    }
  };

  return Object.assign(platform, overrides, {
    registry: { ...platform.registry, ...(overrides.registry || {}) },
    runtime: { ...platform.runtime, ...(overrides.runtime || {}) },
    store: { ...platform.store, ...(overrides.store || {}) }
  });
}

async function callRouter(router, {
  method = "GET",
  path: pathname,
  body = null,
  rawRequestBody = null,
  headers = {},
  requestId = "req-1"
}) {
  const response = createResponse();
  const request = createRequest({ headers, id: requestId });
  const requestBody = rawRequestBody || (body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf8"));
  const handled = await router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url: createUrl(pathname),
    method
  });
  return { handled, request, response, requestBody };
}

async function withTempUserDataPath(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-final-extra-4-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function createRuntimeFixture(overrides = {}) {
  const operation = {
    id: "operation.alpha",
    http: {
      method: "POST",
      path: "/tool/:id",
      params: [{ name: "id" }]
    },
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" }
      }
    },
    safety: {
      approvalScope: "approval:alpha"
    },
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
    getTool: vi.fn((toolId) => (toolId === tool.id ? tool : null)),
    listProfiles: vi.fn(() => []),
    ...overrides.registry
  };

  const policyEngine = {
    evaluate: vi.fn(() => ({
      effect: "allow",
      decisionId: "policy-final-extra-4",
      reasonCode: "",
      redactedReason: "",
      missingScopes: [],
      missingCapabilities: [],
      missingToolsets: [],
      grantPolicyRevision: 1,
      grantPolicyState: "active",
      governancePolicyRevision: {
        protocolVersion: "v0.0.1:risk-control:policy-1",
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

describe("tool-management core final extra 4", () => {
  it("covers console authorization denial, confirmation gating, bad JSON, and pending runtime unavailability", async () => {
    const deniedRouter = createToolManagementHttpRouter({
      platform: createPlatform(),
      securityPermissions: createSecurityPermissions({
        authorizeOperation: vi.fn(async () => ({
          ok: false,
          status: 403,
          error: "denied by policy"
        }))
      }),
      logger: getRuntimeLoggerMock()
    });
    const denied = await callRouter(deniedRouter, {
      method: "GET",
      path: "/api/tool-management/v1/catalog"
    });
    expect(denied.response.statusCode).toBe(403);
    expect(sendJsonMock).toHaveBeenCalledWith(denied.response, 403, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "console_forbidden",
        message: "denied by policy",
        details: {
          bootstrap: undefined
        }
      }
    });

    sendJsonMock.mockClear();
    const confirmRouter = createToolManagementHttpRouter({
      platform: createPlatform(),
      securityPermissions: createSecurityPermissions(),
      logger: getRuntimeLoggerMock()
    });
    const confirmationRequired = await callRouter(confirmRouter, {
      method: "POST",
      path: "/api/tool-management/v1/grants",
      body: { label: "grant-1" }
    });
    expect(confirmationRequired.response.statusCode).toBe(403);
    expect(JSON.parse(confirmationRequired.response.body)).toMatchObject({
      error: {
        code: "confirmation_required"
      }
    });

    await expect(callRouter(confirmRouter, {
      method: "POST",
      path: "/api/tool-management/v1/grants",
      rawRequestBody: Buffer.from("{", "utf8"),
      headers: {
        "x-pact-safety-confirm": "true"
      }
    })).rejects.toThrow();

    const pendingRuntimeMissing = createToolManagementHttpRouter({
      platform: createPlatform({
        runtime: {
          resumePendingOperation: undefined
        }
      }),
      logger: getRuntimeLoggerMock()
    });
    const pending = await callRouter(pendingRuntimeMissing, {
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending-1/resolve",
      headers: {
        "x-pact-safety-confirm": "true"
      },
      body: {
        resolution: "approved"
      }
    });
    expect(pending.response.statusCode).toBe(503);
    expect(JSON.parse(pending.response.body)).toMatchObject({
      error: {
        code: "pending_operation_runtime_unavailable"
      }
    });
  });

  it("covers runtime unknown operation, handler failure, and external MCP provider failure", async () => {
    const unknownFixture = createRuntimeFixture({
      registry: {
        getTool: vi.fn(() => null)
      }
    });
    const unknownTool = await unknownFixture.runtime.executeTool({
      toolId: "pact.missing.tool",
      input: {},
      request: createRequest()
    });
    expect(unknownTool).toMatchObject({
      ok: false,
      status: 404,
      payload: {
        error: {
          code: "unknown_tool"
        }
      }
    });

    const missingOperationFixture = createRuntimeFixture({
      operation: {
        id: "operation.missing"
      },
      registry: {
        getTool: vi.fn(() => ({
          id: "pact.missing.operation",
          operationId: "operation.missing",
          version: "1.0.0",
          toolsets: ["pact.jobs.read"],
          requiredScopes: ["jobs:read"],
          risk: "read_only",
          timeoutMs: 2_000,
          maxResultBytes: 1_024,
          concurrencySafe: true,
          requiresApproval: false,
          approvalScope: ""
        }))
      },
      runtimeOptions: {
        operations: []
      }
    });
    const missingOperation = await missingOperationFixture.runtime.executeTool({
      toolId: "pact.missing.operation",
      input: {},
      request: createRequest()
    });
    expect(missingOperation).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "operation_missing"
        }
      }
    });

    dispatchOperationMock.mockImplementationOnce(async () => {
      const error = new Error("dispatch failed");
      error.code = "dispatch_failed";
      error.statusCode = 502;
      throw error;
    });
    const handlerFailureFixture = createRuntimeFixture();
    const handlerFailure = await handlerFailureFixture.runtime.executeTool({
      toolId: handlerFailureFixture.tool.id,
      input: {},
      request: createRequest(),
      directOperation: handlerFailureFixture.operation,
      directUrl: createUrl("/tool/alpha"),
      directRequestBody: Buffer.from(JSON.stringify({ name: "alpha" }), "utf8"),
      directParams: {
        id: "alpha"
      }
    });
    expect(handlerFailure).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "tool_execution_failed",
          message: "dispatch failed"
        }
      }
    });

    const externalUnavailableFixture = createRuntimeFixture({
      operation: {
        id: "operation.external",
        externalMcp: {
          serviceId: "relay-service",
          upstreamToolName: "tool-1"
        }
      },
      tool: {
        id: "pact.external.tool",
        operationId: "operation.external"
      },
      runtimeOptions: {
        operations: [{
          id: "operation.external",
          externalMcp: {
            serviceId: "relay-service",
            upstreamToolName: "tool-1"
          }
        }]
      }
    });
    const unavailable = await externalUnavailableFixture.runtime.executeTool({
      toolId: externalUnavailableFixture.tool.id,
      input: {},
      request: createRequest()
    });
    expect(unavailable).toMatchObject({
      ok: false,
      status: 503,
      payload: {
        error: {
          code: "external_mcp_passthrough_unavailable"
        }
      }
    });

    const externalFailureFixture = createRuntimeFixture({
      operation: {
        id: "operation.external.fail",
        externalMcp: {
          serviceId: "relay-service",
          upstreamToolName: "tool-2"
        }
      },
      tool: {
        id: "pact.external.tool.fail",
        operationId: "operation.external.fail"
      },
      runtimeOptions: {
        operations: [{
          id: "operation.external.fail",
          externalMcp: {
            serviceId: "relay-service",
            upstreamToolName: "tool-2"
          }
        }],
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => {
            const error = new Error("upstream failed");
            error.code = "upstream_down";
            error.statusCode = 504;
            throw error;
          })
        }
      }
    });
    const externalFailure = await externalFailureFixture.runtime.executeTool({
      toolId: externalFailureFixture.tool.id,
      input: {},
      request: createRequest()
    });
    expect(externalFailure).toMatchObject({
      ok: false,
      status: 504,
      payload: {
        error: {
          code: "upstream_down",
          message: "upstream failed"
        }
      }
    });
  });

  it("covers catalog outlet filters plus store metrics, audit, and pending edge cases", async () => {
    const registry = createToolCatalogRegistry({
      operations: [
        {
          id: "jobs.list",
          label: "Jobs list",
          http: { method: "get", path: "/jobs" }
        }
      ]
    });
    const activeTool = registry.getCatalog().tools.find((tool) => tool.id === "pact.jobs.list");
    expect(activeTool).toMatchObject({
      status: "active",
      owner: "pact",
      risk: "read_only"
    });
    expect(registry.listTools({ status: "active" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ status: "internal" }).length).toBeGreaterThan(0);
    expect(registry.listTools({ toolset: "pact.jobs.read" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ scope: "jobs:read" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ risk: "read_only" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ owner: "pact" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ owner: "other" })).toEqual([]);
    expect(registry.resolveToolset({
      scopes: ["jobs:read"],
      toolAllow: ["pact.jobs.list"],
      toolDeny: ["pact.jobs.list"]
    })).toMatchObject({
      toolsets: ["pact.jobs.read"],
      tools: []
    });

    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        const activePending = store.createPendingOperation({
          pendingOperationId: "pending-active",
          traceId: "trace-active",
          toolExecutionId: "exec-active",
          toolId: "tool-active",
          toolVersion: "1",
          toolsetIds: ["pact.jobs.read"],
          operationId: "jobs.list",
          risk: "read_only",
          approvalScope: "approval:alpha",
          grantId: "grant-a",
          agentId: "agent-a",
          profileId: "profile-a",
          reasonCode: "approval_required",
          originalInput: { name: "active" },
          context: { from: "test" },
          sourceIp: "127.0.0.1",
          userAgent: "agent",
          expiresAt: "2099-01-01T00:00:00.000Z"
        });
        const expiredPending = store.createPendingOperation({
          pendingOperationId: "pending-expired",
          traceId: "trace-expired",
          toolExecutionId: "exec-expired",
          toolId: "tool-expired",
          toolVersion: "1",
          toolsetIds: ["pact.jobs.read"],
          operationId: "jobs.list",
          risk: "read_only",
          approvalScope: "approval:alpha",
          grantId: "grant-b",
          agentId: "agent-b",
          profileId: "profile-b",
          reasonCode: "approval_required",
          originalInput: { name: "expired" },
          context: { from: "test" },
          sourceIp: "127.0.0.1",
          userAgent: "agent",
          expiresAt: "2000-01-01T00:00:00.000Z"
        });
        expect(activePending.status).toBe("pending");
        expect(expiredPending.status).toBe("expired");

        store.appendExecution({
          toolExecutionId: "exec-1",
          traceId: "trace-1",
          toolId: "tool-a",
          toolVersion: "1",
          toolsetIds: ["pact.jobs.read"],
          subjectType: "grant",
          subjectId: "grant-a",
          grantId: "grant-a",
          agentId: "agent-a",
          profileId: "profile-a",
          operationId: "jobs.list",
          risk: "read_only",
          decision: "allow",
          input: { name: "alpha" },
          result: { ok: true },
          status: "ok",
          errorCode: "",
          durationMs: 12,
          policyDecisionId: "policy-1",
          sourceIp: "127.0.0.1",
          userAgent: "agent",
          startedAt: "2026-06-05T00:00:00.000Z",
          finishedAt: "2026-06-05T00:00:01.000Z"
        });
        store.appendMetric({
          traceId: "trace-1",
          toolId: "tool-a",
          grantId: "grant-a",
          profileId: "profile-a",
          status: "ok",
          risk: "read_only",
          durationMs: 12,
          inputBytes: 7,
          resultBytes: 9
        });
        store.appendMetric({
          traceId: "trace-2",
          toolId: "tool-b",
          grantId: "grant-b",
          profileId: "profile-b",
          status: "denied",
          risk: "read_only",
          durationMs: 25,
          inputBytes: 3,
          resultBytes: 0,
          reasonCode: "missing_scope"
        });
        store.appendHttpRequestMetric({
          traceId: "trace-http",
          requestId: "req-http",
          transport: "http",
          method: "GET",
          route: "/api/tool-management/v1/catalog",
          statusCode: 500,
          completionStatus: "failed",
          requestBytes: 4,
          responseBytes: 5,
          durationMs: 15
        });

        const auditItems = store.listAudit({
          limit: 0,
          toolId: "tool-a",
          grantId: "grant-a",
          status: "ok"
        });
        expect(auditItems).toHaveLength(1);
        expect(store.getAudit("exec-1")).toMatchObject({
          toolExecutionId: "exec-1",
          toolId: "tool-a",
          grantId: "grant-a",
          resultSummary: {
            ok: true
          }
        });
        expect(store.getAudit("missing")).toBeNull();

        const metricsSummary = store.metricsSummary({
          limit: 2,
          bucketSeconds: 60
        });
        expect(metricsSummary).toMatchObject({
          filters: {
            limit: 2,
            bucketSeconds: 60
          },
          callsTotal: 2,
          requests: {
            total: 1,
            serverErrorTotal: 1
          },
          pendingOperations: {
            total: 2,
            pendingTotal: 1,
            expiredTotal: 1
          }
        });
        expect(metricsSummary.series.bucketSeconds).toBe(60);
        expect(metricsSummary.pendingOperations.byStatus).toMatchObject({
          pending: 1,
          expired: 1
        });

        expect(store.metricsExport({
          kind: "tool",
          toolId: "tool-a",
          grantId: "grant-a",
          profileId: "profile-a",
          status: "ok"
        })).toMatchObject({
          counts: {
            toolMetricEvents: 1,
            httpRequestMetricEvents: 0,
            total: 1
          },
          filters: {
            kind: "tool",
            toolId: "tool-a",
            grantId: "grant-a",
            profileId: "profile-a",
            status: "ok"
          }
        });
        expect(store.metricsExport({
          kind: "request",
          route: "/api/tool-management/v1/catalog",
          transport: "http",
          statusCode: 500,
          completionStatus: "failed"
        })).toMatchObject({
          counts: {
            toolMetricEvents: 0,
            httpRequestMetricEvents: 1,
            total: 1
          },
          filters: {
            kind: "request",
            route: "/api/tool-management/v1/catalog",
            transport: "http",
            statusCode: "500",
            completionStatus: "failed"
          }
        });

        const health = store.metricsHealth({
          windowSeconds: 0,
          maxRequestErrorRate: "20",
          maxToolFailureRate: "10",
          maxDeniedRate: "30",
          maxRequestP95Ms: "100",
          maxToolP95Ms: "100",
          minRequests: 1
        });
        expect(health.window.windowSeconds).toBe(300);
        expect(health.status).toBe("critical");
        expect(health.breaches.map((breach) => breach.code)).toContain("request_server_error_rate");
        expect(store.metricsStorageSummary()).toMatchObject({
          schemaVersion: "v0.0.1:tool:management-metrics-storage-1",
          tables: {
            toolMetricEvents: {
              tableName: "tool_metric_events"
            },
            httpRequestMetricEvents: {
              tableName: "http_request_metric_events"
            }
          }
        });

        expect(store.listPendingOperations({ status: "unexpected", limit: 0 })).toMatchObject([
          {
            pendingOperationId: "pending-active",
            status: "pending"
          }
        ]);
        expect(() => store.resolvePendingOperation({
          pendingOperationId: "pending-active",
          resolution: "not-a-valid-state"
        })).toThrow("Invalid pending operation resolution status.");
        expect(store.resolvePendingOperation({
          pendingOperationId: "pending-expired",
          resolution: "approved"
        })).toBeNull();
      } finally {
        store.close();
      }
    });
  });
});
