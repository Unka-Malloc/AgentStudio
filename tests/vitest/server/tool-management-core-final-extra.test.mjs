import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolManagementStore } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";
import { toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";

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
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
    registry: {
      getTool: vi.fn((toolId) => ({ id: toolId })),
      getToolByOperationId: vi.fn(() => null),
      listToolsets: vi.fn(() => []),
      resolveToolset: vi.fn((payload) => payload),
      listProfiles: vi.fn(() => [])
    },
    runtime: {
      executeTool: vi.fn(),
      resumePendingOperation: vi.fn()
    },
    store: {
      listGrants: vi.fn(() => []),
      createGrant: vi.fn(),
      rotateGrantToken: vi.fn(),
      revokeGrant: vi.fn(),
      updateGrant: vi.fn(),
      listAudit: vi.fn(() => []),
      getAudit: vi.fn(() => null),
      metricsSummary: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsExport: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsHealth: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      metricsPrometheus: vi.fn(() => "metric"),
      metricsStorageSummary: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
      pruneMetrics: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1" })),
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
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-final-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

beforeEach(() => {
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
});

describe("tool-management core final extra coverage", () => {
  it("prunes old metrics in a live temp store and rejects invalid MCP resolution statuses", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      let storeClosed = false;
      try {
        store.appendMetric({
          toolId: "pact.jobs.read",
          status: "ok",
          durationMs: 50,
          transferBytes: 200,
          createdAt: "2025-12-31T23:59:59.000Z"
        });
        store.appendMetric({
          toolId: "pact.jobs.read",
          status: "ok",
          durationMs: 50,
          transferBytes: 200,
          createdAt: "2026-01-01T00:00:01.000Z"
        });
        store.appendHttpRequestMetric({
          method: "GET",
          route: "/health",
          statusCode: 200,
          durationMs: 25,
          requestBytes: 20,
          responseBytes: 40,
          createdAt: "2025-12-31T23:59:59.000Z"
        });
        store.appendHttpRequestMetric({
          method: "GET",
          route: "/health",
          statusCode: 200,
          durationMs: 25,
          requestBytes: 20,
          responseBytes: 40,
          createdAt: "2026-01-01T00:00:01.000Z"
        });

        const prune = store.pruneMetrics({
          olderThan: "2026-01-01T00:00:00.000Z",
          dryRun: false
        });
        expect(prune).toMatchObject({
          dryRun: false,
          before: { toolMetrics: 2, httpRequestMetrics: 2 },
          planned: { toolMetrics: 1, httpRequestMetrics: 1 },
          deleted: { toolMetrics: 1, httpRequestMetrics: 1 },
          after: { toolMetrics: 1, httpRequestMetrics: 1 }
        });

        const remainingToolRows = store.db.prepare("SELECT count(*) AS count FROM tool_metric_events").get().count;
        const remainingHttpRows = store.db.prepare("SELECT count(*) AS count FROM http_request_metric_events").get().count;
        expect(remainingToolRows).toBe(1);
        expect(remainingHttpRows).toBe(1);

        const { requestId } = store.createMcpAuthorizationRequest({
          clientName: "agent-client",
          requestedScopes: ["knowledge:read"],
          requestedTools: [{ id: "pact.agentLibrary.read" }],
          reason: "edge-path"
        });
        expect(requestId).toMatch(/^mcp_auth_req_/);

        expect(() => store.resolveMcpAuthorizationRequest({
          requestId,
          resolution: "pending"
        })).toThrow("Invalid resolution status");

        const currentIso = new Date().toISOString();
        store.appendMetric({
          toolId: "pact.jobs.read",
          status: "denied",
          reasonCode: "tool_timeout",
          durationMs: 10,
          transferBytes: 50,
          grantId: "grant-1",
          profileId: "profile-1",
          risk: "high",
          createdAt: currentIso
        });
        store.appendMetric({
          toolId: "pact.jobs.read",
          status: "denied",
          reasonCode: "rate_limited",
          durationMs: 10,
          transferBytes: 50,
          grantId: "grant-1",
          profileId: "profile-1",
          risk: "high",
          createdAt: currentIso
        });
        store.appendMetric({
          toolId: "pact.jobs.read",
          status: "ok",
          reasonCode: "",
          durationMs: 10,
          transferBytes: 50,
          grantId: "grant-1",
          profileId: "profile-1",
          risk: "high",
          createdAt: currentIso
        });
        store.appendHttpRequestMetric({
          method: "GET",
          route: "/health",
          statusCode: 200,
          durationMs: 10,
          requestBytes: 10,
          responseBytes: 10,
          createdAt: currentIso
        });
        store.appendExecution({
          toolExecutionId: "exec-filtered",
          toolId: "pact.jobs.read",
          grantId: "grant-1",
          profileId: "profile-1",
          status: "failed",
          risk: "high",
          durationMs: 5
        });

        const summary = store.metricsSummary({ limit: 10 });
        expect(summary.toolCalls.deniedByReason).toMatchObject({
          tool_timeout: 1,
          rate_limited: 1
        });
        expect(summary.toolCalls.timeoutTotal).toBe(1);
        expect(summary.toolCalls.rateLimitedTotal).toBe(1);

        const health = store.metricsHealth({
          windowSeconds: 300,
          minRequests: 2,
          maxRequestErrorRate: 1,
          maxToolFailureRate: 1,
          maxDeniedRate: 1
        });
        expect(health.breaches).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "request_volume_low" })
          ])
        );

        const filteredAudits = store.listAudit({
          limit: 10,
          toolId: "pact.jobs.read",
          grantId: "grant-1",
          status: "failed"
        });
        expect(filteredAudits).toHaveLength(1);
        expect(filteredAudits[0]).toMatchObject({
          toolExecutionId: "exec-filtered",
          grantId: "grant-1",
          status: "failed"
        });

        const policyDecision = store.appendPolicyDecision({
          toolExecutionId: "exec-policy",
          toolId: "pact.jobs.read",
          grantId: "grant-1",
          effect: "allow",
          reasonCode: "unit-test"
        });
        expect(policyDecision.decisionId).toMatch(/^policy_/);

        store.close();
        storeClosed = true;

        const mismatchProvider = {
          issue: vi.fn(async ({ credentialId, capabilities, expiresAt }) => ({
            capabilityKey: `ock_${credentialId}`,
            protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
            capabilitySetHash: `hash_${(capabilities || []).length}`,
            capabilityCount: (capabilities || []).length,
            runtimeLookupGeneration: 1,
            expiresAt: expiresAt || currentIso
          })),
          verify: vi.fn(async () => ({ ok: true, credentialId: "grant-mismatch" })),
          invalidateCredential: vi.fn(),
          close: vi.fn()
        };
        const authStore = createToolManagementStore({
          userDataPath,
          capabilityKeyProvider: mismatchProvider,
          capabilityBindingGuard: false
        });
        try {
          const { grant, token } = await authStore.createGrant({
            label: "Capability Grant",
            capabilities: [toolExecuteCapabilityId("pact.agentLibrary.search")]
          });
          expect(token).toMatch(/^ock_/);

          const denied = await authStore.authorizeRequest({
            request: { headers: { authorization: `Bearer ${token}` } },
            tool: { id: "pact.agentLibrary.search" }
          });
          expect(denied).toMatchObject({
            ok: false,
            reasonCode: "credential_binding_mismatch",
            status: 401
          });
          expect(denied.grant).toMatchObject({ id: grant.id });
        } finally {
          authStore.close();
        }
      } finally {
        if (!storeClosed) {
          store.close();
        }
      }
    });
  });

  it("lists pending operations and resolves them through the HTTP router", async () => {
    const platform = createPlatform({
      store: {
        listPendingOperations: vi.fn(() => [
          { pendingOperationId: "pending-1", status: "pending" },
          { pendingOperationId: "pending-2", status: "pending" }
        ])
      },
      runtime: {
        resumePendingOperation: vi.fn(async (args) => ({
          status: 202,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            result: args
          }
        }))
      }
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const router = createToolManagementHttpRouter({ platform, logger });

    const listResult = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/pending-operations?status=all&limit=2"
    });

    expect(listResult.handled).toBe(true);
    expect(platform.store.listPendingOperations).toHaveBeenCalledWith({ status: "all", limit: 2 });
    expect(sendJsonMock).toHaveBeenCalledWith(listResult.response, 200, {
      schemaVersion: "v0.0.1:schema:definition-1",
      pendingOperations: [
        { pendingOperationId: "pending-1", status: "pending" },
        { pendingOperationId: "pending-2", status: "pending" }
      ]
    });

    const resolveResult = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending%2F1/resolve",
      body: {
        resolution: "approved",
        context: { source: "unit-test" },
        resolvedBy: "reviewer",
        reason: "accepted"
      },
      headers: { "x-pact-confirm": "true" }
    });

    expect(resolveResult.handled).toBe(true);
    expect(platform.runtime.resumePendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      pendingOperationId: "pending/1",
      resolution: "approved",
      context: expect.objectContaining({ source: "unit-test" }),
      resolvedBy: "reviewer",
      reason: "accepted",
      request: resolveResult.request
    }));
    expect(sendJsonMock).toHaveBeenLastCalledWith(resolveResult.response, 202, {
      schemaVersion: "v0.0.1:schema:definition-1",
      result: expect.objectContaining({
        pendingOperationId: "pending/1",
        resolution: "approved"
      })
    });

    const eventsResult = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/events?limit=1"
    });
    expect(eventsResult.handled).toBe(true);
    expect(platform.store.listAudit).toHaveBeenCalledWith({ limit: 1 });
    expect(sendJsonMock).toHaveBeenLastCalledWith(eventsResult.response, 200, {
      schemaVersion: "v0.0.1:schema:definition-1",
      events: []
    });

    const notFoundResult = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/not-supported"
    });
    expect(notFoundResult.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(notFoundResult.response, 404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "tool_management_route_not_found",
        message: "Tool management route not found.",
        details: { path: "/not-supported" }
      }
    });

    const pruneMetricsResult = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/metrics/prune",
      body: {
        olderThan: "2026-01-01T00:00:00.000Z",
        dryRun: true,
        maxToolMetricRows: 1,
        maxHttpRequestMetricRows: 1
      },
      headers: { "x-pact-safety-confirm": "true" }
    });
    expect(pruneMetricsResult.handled).toBe(true);
    expect(platform.store.pruneMetrics).toHaveBeenCalledWith(expect.objectContaining({
      olderThan: "2026-01-01T00:00:00.000Z",
      dryRun: true,
      maxToolMetricRows: 1,
      maxHttpRequestMetricRows: 1
    }));
  });

  it("logs and rethrows malformed pending-operation resolution payloads", async () => {
    const platform = createPlatform();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const router = createToolManagementHttpRouter({ platform, logger });

    await expect(callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending%2F1/resolve",
      rawRequestBody: Buffer.from("{", "utf8"),
      headers: { "x-pact-confirm": "true" },
      requestId: "req-bad-json"
    })).rejects.toThrow(SyntaxError);

    expect(summarizeErrorMock).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "tool_management.http.failed",
      expect.objectContaining({
        requestId: "req-bad-json",
        method: "POST",
        route: "/api/tool-management/v1/pending-operations/pending%2F1/resolve",
        suffix: "/pending-operations/pending%2F1/resolve"
      })
    );
  });
});
