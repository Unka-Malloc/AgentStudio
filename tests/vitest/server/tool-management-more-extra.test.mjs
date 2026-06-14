import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendJsonMock = vi.hoisted(() => vi.fn((response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}));
const dispatchOperationMock = vi.hoisted(() => vi.fn(async ({ response }) => {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    schemaVersion: "v0.0.1:schema:definition-1",
    result: { ok: true }
  }));
  return { ok: true };
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
  traceId: "trace-request"
})));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  dispatchOperation: dispatchOperationMock,
  getRuntimeLogger: getRuntimeLoggerMock,
  sendJson: sendJsonMock,
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock,
  traceContextFromRequest: traceContextFromRequestMock
}));

import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";
import {
  createToolManagementStore,
  getToolManagementDatabasePath
} from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";

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
    }
  };

  const grant = {
    id: "grant-1",
    label: "Grant 1",
    scopes: ["tool:run"],
    capabilities: []
  };

  const tool = {
    id: "tool.alpha",
    operationId: operation.id,
    version: "1.0.0",
    toolsets: ["toolset-1"],
    requiredScopes: ["tool:run"],
    risk: "low",
    timeoutMs: 1000,
    maxResultBytes: 1024,
    concurrencySafe: true,
    requiresApproval: false,
    approvalScope: "",
    transport: {}
  };
  Object.assign(tool, overrides.tool || {});

  const store = {
    authorizeRequest: vi.fn(async () => ({
      ok: true,
      grant,
      sourceIp: "127.0.0.1"
    })),
    appendExecution: vi.fn(),
    appendMetric: vi.fn(),
    appendPolicyDecision: vi.fn(),
    createPendingOperation: vi.fn((entry) => ({
      pendingOperationId: "pending-1",
      status: "pending",
      traceId: entry.traceId,
      toolId: entry.toolId,
      grantId: entry.grantId,
      originalInput: entry.originalInput,
      context: entry.context
    })),
    getPendingOperation: vi.fn(),
    resolvePendingOperation: vi.fn(),
    getRawGrant: vi.fn(() => grant)
  };
  Object.assign(store, overrides.store || {});

  const registry = {
    getTool: vi.fn(() => tool),
    listProfiles: vi.fn(() => []),
    ...overrides.registry
  };

  const policyEngine = {
    evaluate: vi.fn(() => ({
      effect: "allow",
      decisionId: "policy-1",
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

  const securityPermissions = {
    appendDecision: vi.fn(),
    ...overrides.securityPermissions
  };

  const runtime = createToolExecutionRuntime({
    registry,
    store,
    policyEngine,
    operations: [operation],
    securityPermissions,
    protocolEventBus: { publish: vi.fn(async () => undefined) },
    logger: getRuntimeLoggerMock(),
    ...overrides.runtime
  });

  return {
    runtime,
    store,
    registry,
    policyEngine,
    securityPermissions,
    operation,
    tool,
    grant
  };
}

function createPlatform(overrides = {}) {
  const runtime = {
    executeTool: vi.fn(async () => ({
      status: 200,
      payload: { schemaVersion: "v0.0.1:schema:definition-1", result: { ok: true } }
    })),
    resumePendingOperation: vi.fn(async () => ({
      status: 200,
      payload: { schemaVersion: "v0.0.1:schema:definition-1", status: "completed" }
    })),
    ...overrides.runtime
  };

  const platform = {
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
    registry: {
      getTool: vi.fn(() => ({ id: "tool.alpha" })),
      getToolByOperationId: vi.fn(() => ({ id: "tool.alpha" })),
      listToolsets: vi.fn(() => [{ id: "toolset-1" }]),
      resolveToolset: vi.fn((payload) => ({ resolved: true, payload })),
      listProfiles: vi.fn(() => [{ id: "profile-1" }])
    },
    runtime,
    store: {
      listGrants: vi.fn(() => [{ id: "grant-1" }]),
      createGrant: vi.fn(async (payload) => ({ grant: { id: "grant-new", ...payload }, token: "token-new" })),
      rotateGrantToken: vi.fn(async (grantId) => ({ grant: { id: grantId }, token: "token-rotated" })),
      revokeGrant: vi.fn(async (grantId, reason) => ({ id: grantId, revoked: true, reason })),
      updateGrant: vi.fn((grantId, payload) => ({ id: grantId, updated: payload })),
      listAudit: vi.fn(() => [{ id: "audit-1" }]),
      getAudit: vi.fn((toolExecutionId) => ({ id: toolExecutionId })),
      metricsSummary: vi.fn(() => ({ checked: true })),
      metricsExport: vi.fn(() => ({ checked: true })),
      metricsHealth: vi.fn(() => ({ checked: true })),
      metricsPrometheus: vi.fn(() => "metric 1"),
      metricsStorageSummary: vi.fn(() => ({ checked: true })),
      pruneMetrics: vi.fn(() => ({ checked: true })),
      listPendingOperations: vi.fn(() => [{ id: "pending-1" }])
    },
    policyEngine: {
      preview: vi.fn((payload) => ({ effect: "allow", payload }))
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
  path: requestPath,
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
    url: createUrl(requestPath),
    method
  });
  return { handled, request, response, requestBody };
}

async function withTempUserDataPath(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-more-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

beforeEach(() => {
  sendJsonMock.mockClear();
  dispatchOperationMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
  traceContextFromRequestMock.mockClear();
});

describe("tool-management runtime (extra coverage)", () => {
  it("refreshes operations and moves from operation-missing to a successful dry run", async () => {
    const fixture = createRuntimeFixture({
      runtime: {
        operations: []
      }
    });

    const first = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest()
    });

    expect(first.ok).toBe(false);
    expect(first.status).toBe(500);
    expect(first.payload.error.code).toBe("operation_missing");
    expect(fixture.store.authorizeRequest).not.toHaveBeenCalled();

    const refreshed = fixture.runtime.refreshOperations([fixture.operation]);
    expect(refreshed).toEqual({ ok: true, operationCount: 1 });

    const second = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest(),
      dryRun: true
    });

    expect(second.ok).toBe(true);
    expect(second.status).toBe(200);
    expect(second.payload.status).toBe("ok");
    expect(second.payload.result.wouldExecute).toBe(true);
    expect(fixture.store.authorizeRequest).toHaveBeenCalledTimes(1);
  });

  it("returns authorization denial details and records the authorization decision", async () => {
    const fixture = createRuntimeFixture({
      store: {
        authorizeRequest: vi.fn(async () => ({
          ok: false,
          status: 401,
          reasonCode: "missing_token",
          error: "缺少工具访问令牌。",
          missingScopes: ["tool:run"],
          missingCapabilities: ["cap:tool-management:tool.alpha:execute"],
          grant: { id: "grant-1", label: "Grant 1", scopes: [] }
        }))
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest()
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.payload.error).toMatchObject({
      code: "missing_token",
      message: "缺少工具访问令牌。",
      details: {
        missingScopes: ["tool:run"],
        missingCapabilities: ["cap:tool-management:tool.alpha:execute"]
      }
    });
    expect(fixture.store.appendPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "missing_token",
      effect: "deny"
    }));
    expect(fixture.securityPermissions.appendDecision).toHaveBeenCalledWith(expect.objectContaining({
      protocolVersion: "v0.0.1:risk-control:authorization-1",
      effect: "deny",
      redactedReason: "缺少工具访问令牌。",
      resource: expect.objectContaining({
        toolId: fixture.tool.id,
        operationId: fixture.operation.id
      })
    }));
    expect(fixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "missing_token"
    }));
    expect(fixture.store.appendMetric).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      reasonCode: "missing_token"
    }));
  });

  it("returns a policy confirmation response when the policy requires confirmation", async () => {
    const fixture = createRuntimeFixture({
      policyEngine: {
        evaluate: vi.fn(() => ({
          effect: "require_confirmation",
          decisionId: "policy-confirm",
          reasonCode: "confirmation_required",
          redactedReason: "Tool requires confirmation.",
          missingScopes: ["tool:run"],
          missingCapabilities: [],
          missingToolsets: [],
          grantPolicyRevision: 2,
          grantPolicyState: "active",
          governancePolicyRevision: {
            protocolVersion: "v0.0.1:risk-control:policy-1",
            revision: 2,
            updatedAt: "2026-06-05T00:00:00.000Z"
          }
        }))
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest()
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.payload.error).toMatchObject({
      code: "confirmation_required",
      message: "Tool requires confirmation.",
      details: {
        decisionId: "policy-confirm",
        missingScopes: ["tool:run"],
        missingCapabilities: [],
        missingToolsets: []
      }
    });
    expect(fixture.store.appendPolicyDecision).not.toHaveBeenCalled();
    expect(fixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "confirmation_required"
    }));
  });

  it("creates and resumes pending operations through the runtime", async () => {
    const pendingRecord = {
      pendingOperationId: "pending-1",
      status: "pending",
      traceId: "trace-request",
      toolId: "tool.alpha",
      grantId: "grant-1",
      profileId: "profile-1",
      context: {
        transport: "mcp",
        traceId: "trace-request"
      },
      originalInput: { name: "alpha" },
      risk: "low",
      toolVersion: "1.0.0",
      toolsetIds: ["toolset-1"],
      operationId: "operation.alpha",
      sourceIp: "127.0.0.1",
      userAgent: "unit-test"
    };
    const fixture = createRuntimeFixture({
      tool: {
        requiresApproval: true
      }
    });
    fixture.store.createPendingOperation.mockImplementation((entry) => ({
      pendingOperationId: "pending-1",
      status: "pending",
      traceId: entry.traceId,
      toolId: entry.toolId,
      grantId: entry.grantId,
      profileId: entry.profileId,
      context: entry.context,
      originalInput: entry.originalInput,
      risk: entry.risk,
      toolVersion: entry.toolVersion,
      toolsetIds: entry.toolsetIds,
      operationId: entry.operationId,
      sourceIp: entry.sourceIp,
      userAgent: entry.userAgent
    }));
    fixture.store.getPendingOperation.mockReturnValue(pendingRecord);
    fixture.store.resolvePendingOperation.mockImplementation(({ resolution, resumedToolExecutionId }) => ({
      ...pendingRecord,
      status: resolution,
      resumedToolExecutionId: resumedToolExecutionId || "",
      resolvedAt: "2026-06-05T00:00:00.000Z"
    }));

    const pendingResult = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest({ headers: { "user-agent": "unit-test" } }),
      context: { transport: "mcp" }
    });

    expect(pendingResult.ok).toBe(true);
    expect(pendingResult.status).toBe(202);
    expect(pendingResult.payload.status).toBe("pending_approval");
    expect(fixture.store.createPendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "tool_approval_required",
      originalInput: { name: "alpha" }
    }));

    const resumed = await fixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-1",
      request: createRequest({ headers: { "user-agent": "unit-test" } }),
      resolvedBy: "console",
      reason: "approved"
    });

    expect(resumed.ok).toBe(true);
    expect(resumed.status).toBe(200);
    expect(resumed.payload.pendingOperation.status).toBe("completed");
    expect(dispatchOperationMock).toHaveBeenCalled();
    expect(fixture.store.resolvePendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      pendingOperationId: "pending-1",
      resolution: "approved"
    }));
    expect(fixture.store.resolvePendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      pendingOperationId: "pending-1",
      resolution: "completed"
    }));
  });
});

describe("tool-management http router (extra coverage)", () => {
  it("returns a 404 for unknown tool-management routes", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/not-a-route"
    });

    expect(result.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "tool_management_route_not_found",
        message: "Tool management route not found.",
        details: { path: "/not-a-route" }
      }
    });
  });

  it("returns a 404 when a catalog tool is missing", async () => {
    const platform = createPlatform({
      registry: {
        getTool: vi.fn(() => null)
      }
    });
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/catalog/tool%2Fmissing"
    });

    expect(result.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "unknown_tool",
        message: "Tool is not registered.",
        details: { toolId: "tool/missing" }
      }
    });
  });

  it("throws on invalid JSON request bodies so the router error path is exercised", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });
    const request = createRequest();
    const response = createResponse();

    await expect(router.handleToolManagementHttpRequest({
      request,
      response,
      requestBody: Buffer.from("{not-json", "utf8"),
      url: createUrl("/api/tool-management/v1/execute"),
      method: "POST"
    })).rejects.toThrow(SyntaxError);
  });
});

describe("tool-management store boundaries (extra coverage)", () => {
  it("rejects unknown capabilities and keeps the database path stable", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        expect(path.basename(getToolManagementDatabasePath(userDataPath))).toBe("tool-management.sqlite");
        await expect(store.createGrant({
          label: "Bad Grant",
          capabilities: ["cap:tool-management:unknown:test"]
        })).rejects.toThrow("Unknown tool grant capability permission");
      } finally {
        store.close();
      }
    });
  });

  it("returns null for missing records and rejects invalid resolution states", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        expect(store.getPendingOperation("missing")).toBeNull();
        expect(store.deleteGrant("missing")).toBe(false);
        expect(() => store.resolvePendingOperation({
          pendingOperationId: "missing",
          resolution: "not-a-valid-state"
        })).toThrow("Invalid pending operation resolution status.");
        expect(() => store.resolveMcpAuthorizationRequest({
          requestId: "missing",
          resolution: "not-a-valid-state"
        })).toThrow("Invalid resolution status");
      } finally {
        store.close();
      }
    });
  });
});
