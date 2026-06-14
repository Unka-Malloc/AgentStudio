import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  getRuntimeLogger: getRuntimeLoggerMock,
  sendJson: sendJsonMock,
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock
}));

import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";

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

function createUrl(path) {
  return new URL(path, "http://127.0.0.1");
}

function createPlatform(overrides = {}) {
  const runtimeExecuteTool = vi.fn(async (args) => ({
    status: 201,
    payload: {
      schemaVersion: "v0.0.1:schema:definition-1",
      result: args
    }
  }));
  const runtimeResumePendingOperation = vi.fn(async (args) => ({
    status: 202,
    payload: {
      schemaVersion: "v0.0.1:schema:definition-1",
      result: args
    }
  }));
  const platform = {
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
    registry: {
      getTool: vi.fn((toolId) => ({ id: toolId, name: `tool:${toolId}` })),
      getToolByOperationId: vi.fn((operationId) => ({ id: `tool.${operationId}`, operationId })),
      listToolsets: vi.fn(() => [{ id: "toolset-1" }]),
      resolveToolset: vi.fn((payload) => ({ resolved: true, payload })),
      listProfiles: vi.fn(() => [{ id: "profile-1" }])
    },
    runtime: {
      executeTool: runtimeExecuteTool,
      resumePendingOperation: runtimeResumePendingOperation
    },
    store: {
      listGrants: vi.fn(() => [{ id: "grant-1" }]),
      createGrant: vi.fn(async (payload) => ({
        grant: { id: "grant-new", ...payload },
        token: "token-new"
      })),
      rotateGrantToken: vi.fn(async (grantId) => ({
        grant: { id: grantId, rotated: true },
        token: "token-rotated"
      })),
      revokeGrant: vi.fn(async (grantId, reason) => ({ id: grantId, revoked: true, reason })),
      updateGrant: vi.fn((grantId, payload) => ({ id: grantId, updated: payload })),
      listAudit: vi.fn((payload) => [{ id: "audit-1", ...payload }]),
      getAudit: vi.fn((toolExecutionId) => ({ id: toolExecutionId, checked: true })),
      metricsSummary: vi.fn((payload) => ({ checked: true, payload })),
      metricsExport: vi.fn((payload) => ({ checked: true, payload })),
      metricsHealth: vi.fn((payload) => ({ checked: true, payload })),
      metricsPrometheus: vi.fn(() => "metric 1"),
      metricsStorageSummary: vi.fn(() => ({ checked: true })),
      pruneMetrics: vi.fn((payload) => ({ checked: true, payload })),
      listPendingOperations: vi.fn((payload) => [{ id: "pending-1", ...payload }])
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
  platform,
  method = "GET",
  path,
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
    url: createUrl(path),
    method
  });
  return { handled, request, response, requestBody, platform };
}

beforeEach(() => {
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
});

describe("tool-management http router (extra coverage)", () => {
  it("handles catalog requests with console authorization and without a security provider", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/catalog?view=full"
    });

    expect(result.handled).toBe(true);
    expect(platform.catalog).toHaveBeenCalledTimes(1);
    expect(platform.registry.getTool).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 200, { schemaVersion: "v0.0.1:schema:definition-1", catalog: true });
    expect(result.response.statusCode).toBe(200);
  });

  it("denies console requests when authorization fails", async () => {
    const authorizeOperation = vi.fn(async () => ({
      ok: false,
      status: 401,
      error: "token missing",
      bootstrap: { required: true }
    }));
    const platform = createPlatform();
    const securityPermissions = { authorizeOperation };
    const router = createToolManagementHttpRouter({ platform, securityPermissions, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/catalog",
      headers: { authorization: "" }
    });

    expect(result.handled).toBe(true);
    expect(authorizeOperation).toHaveBeenCalledWith(expect.objectContaining({
      request: result.request,
      method: "GET",
      url: expect.objectContaining({ pathname: "/api/tool-management/v1/catalog" }),
      operation: expect.objectContaining({
        id: "tool_management.http",
        requiredScopes: ["console:read"],
        skipCsrf: false
      })
    }));
    expect(platform.catalog).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 401, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "console_unauthenticated",
        message: "token missing",
        details: { bootstrap: { required: true } }
      }
    });
  });

  it("parses JSON bodies for execute and batch routes and forwards request context", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const executeResult = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/execute",
      body: {
        toolId: "tool.execute",
        input: { alpha: 1 },
        context: { source: "unit-test" },
        dryRun: true
      }
    });

    expect(executeResult.handled).toBe(true);
    expect(platform.runtime.executeTool).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "tool.execute",
      input: { alpha: 1 },
      request: executeResult.request,
      context: expect.objectContaining({ source: "unit-test", transport: "tool-http" }),
      dryRun: true
    }));
    expect(sendJsonMock).toHaveBeenLastCalledWith(executeResult.response, 201, {
      schemaVersion: "v0.0.1:schema:definition-1",
      result: expect.objectContaining({
        toolId: "tool.execute",
        input: { alpha: 1 },
        request: executeResult.request,
        context: expect.objectContaining({ source: "unit-test", transport: "tool-http" }),
        dryRun: true
      })
    });

    const batchResult = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/batch",
      body: {
        context: { batch: true },
        dryRun: true,
        calls: [
          { toolId: "tool.first", input: { x: 1 }, context: { call: 1 } },
          { toolId: "tool.second", input: { y: 2 }, dryRun: false }
        ]
      }
    });

    expect(batchResult.handled).toBe(true);
    expect(platform.runtime.executeTool).toHaveBeenNthCalledWith(2, expect.objectContaining({
      toolId: "tool.first",
      input: { x: 1 },
      context: expect.objectContaining({ batch: true, call: 1, transport: "tool-http-batch" }),
      dryRun: true
    }));
    expect(platform.runtime.executeTool).toHaveBeenNthCalledWith(3, expect.objectContaining({
      toolId: "tool.second",
      input: { y: 2 },
      context: expect.objectContaining({ batch: true, transport: "tool-http-batch" }),
      dryRun: true
    }));
    expect(sendJsonMock).toHaveBeenLastCalledWith(batchResult.response, 200, {
      schemaVersion: "v0.0.1:schema:definition-1",
      results: [
        expect.objectContaining({ schemaVersion: "v0.0.1:schema:definition-1", result: expect.any(Object) }),
        expect.objectContaining({ schemaVersion: "v0.0.1:schema:definition-1", result: expect.any(Object) })
      ]
    });
  });

  it("requires safety confirmation for grant changes and returns the expected error response", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/grants",
      body: { label: "No confirm", scopes: ["knowledge:read"] }
    });

    expect(result.handled).toBe(true);
    expect(platform.store.createGrant).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 403, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "confirmation_required",
        message: "Tool management grant changes require x-pact-safety-confirm: true."
      }
    });
  });

  it("creates grants when confirmed and decodes route parameters", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const createGrantResult = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/grants",
      body: { label: "Grant", scopes: ["knowledge:read"] },
      headers: { "x-pact-safety-confirm": "true" }
    });

    expect(createGrantResult.handled).toBe(true);
    expect(platform.store.createGrant).toHaveBeenCalledWith({ label: "Grant", scopes: ["knowledge:read"] });
    expect(sendJsonMock).toHaveBeenCalledWith(createGrantResult.response, 201, {
      schemaVersion: "v0.0.1:schema:definition-1",
      grant: { id: "grant-new", label: "Grant", scopes: ["knowledge:read"] },
      token: "token-new"
    });

    const rotated = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/grants/grant%2Fid/rotate",
      headers: { "x-pact-confirm": "yes" }
    });

    expect(rotated.handled).toBe(true);
    expect(platform.store.rotateGrantToken).toHaveBeenCalledWith("grant/id");
    expect(sendJsonMock).toHaveBeenLastCalledWith(rotated.response, 200, {
      schemaVersion: "v0.0.1:schema:definition-1",
      grant: { id: "grant/id", rotated: true },
      token: "token-rotated"
    });
  });

  it("returns a missing-provider style 503 when pending-operation runtime is unavailable", async () => {
    const platform = createPlatform({
      runtime: {
        executeTool: vi.fn(),
        resumePendingOperation: undefined
      }
    });
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending%2F1/resolve",
      body: { resolution: "approved", reason: "unit-test" },
      headers: { "x-pact-confirm": "true" }
    });

    expect(result.handled).toBe(true);
    expect(platform.runtime.executeTool).not.toHaveBeenCalled();
    expect(platform.store.createGrant).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 503, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "pending_operation_runtime_unavailable",
        message: "Pending operation runtime is unavailable."
      }
    });
  });
});
