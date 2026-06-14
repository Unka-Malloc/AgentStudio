import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolCatalog, createToolCatalogRegistry } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";
import { createToolManagementStore } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";

const dispatchOperationMock = vi.hoisted(() => vi.fn());
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
  traceId: "trace-tool-management-core-final-extra-3"
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
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-final-extra-3-"));
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
      decisionId: "policy-final-extra-3",
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

describe("tool-management core final extra 3", () => {
  it("reads malformed store JSON as defaults and preserves catalog snapshots", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        expect(store.saveCatalogSnapshot({})).toBeNull();
        expect(store.saveCatalogSnapshot({
          fingerprint: "catalog-fp",
          tools: [{ id: "first" }],
          metadata: { source: "first-write" }
        })).toEqual({ fingerprint: "catalog-fp" });
        expect(store.saveCatalogSnapshot({
          fingerprint: "catalog-fp",
          tools: [{ id: "second" }],
          metadata: { source: "second-write" }
        })).toEqual({ fingerprint: "catalog-fp" });

        const snapshotRow = store.db.prepare(`
          SELECT fingerprint, catalog_json
          FROM tool_catalog_snapshots
          WHERE fingerprint = ?
        `).get("catalog-fp");
        expect(JSON.parse(snapshotRow.catalog_json)).toMatchObject({
          fingerprint: "catalog-fp",
          metadata: { source: "first-write" }
        });

        store.db.prepare(`
          INSERT INTO tool_grants (
            id, label, type, enabled, toolsets_json, tool_allow_json, tool_deny_json, scopes_json,
            expires_at, max_uses, rate_limit_json, allowed_origins_json, allowed_cidrs_json,
            metadata_json, reason, token_hash, token_prefix, token_family_id, use_count,
            created_at, updated_at, revoked_at, last_used_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "grant-bad",
          "Bad Grant",
          "machine",
          1,
          "[",
          "{",
          "not-json",
          "{bad",
          "",
          0,
          "{bad",
          "[",
          "[",
          "{",
          "",
          "",
          "",
          "",
          0,
          "2026-06-05T00:00:00.000Z",
          "2026-06-05T00:00:00.000Z",
          "",
          ""
        );

        store.db.prepare(`
          INSERT INTO tool_pending_operations (
            pending_operation_id, trace_id, tool_execution_id, tool_id, tool_version, toolset_ids_json,
            operation_id, risk, approval_scope, grant_id, agent_id, profile_id, idempotency_key,
            reason_code, risk_reason, original_input_json, redacted_input_json, context_json, status,
            result_summary_json, error_code, resolved_by, resolution_reason, resumed_tool_execution_id,
            source_ip, user_agent, expires_at, created_at, resolved_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "pending-bad",
          "trace-1",
          "exec-1",
          "tool-1",
          "1",
          "[",
          "op-1",
          "pending",
          "",
          "grant-bad",
          "",
          "",
          "",
          "reason",
          "risk",
          "{",
          "{",
          "{",
          "pending",
          "{",
          "",
          "",
          "",
          "",
          "",
          "",
          "9999-12-31T23:59:59.999Z",
          "2026-06-05T00:00:00.000Z",
          "",
          ""
        );

        store.db.prepare(`
          INSERT INTO tool_executions (
            tool_execution_id, trace_id, tool_id, tool_version, toolset_ids_json, subject_type, subject_id,
            grant_id, agent_id, profile_id, operation_id, risk, decision, input_hash, redacted_input_json,
            result_summary_json, status, error_code, duration_ms, policy_decision_id, approval_id, source_ip,
            user_agent, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "exec-bad",
          "trace-2",
          "tool-2",
          "1.0.0",
          "[",
          "grant",
          "subject-1",
          "grant-1",
          "agent-1",
          "profile-1",
          "op-2",
          "read_only",
          "ok",
          "hash",
          "{",
          "{",
          "ok",
          "",
          12,
          "policy-1",
          "",
          "127.0.0.1",
          "agent",
          "2026-06-05T00:00:00.000Z",
          "2026-06-05T00:00:01.000Z"
        );

        expect(store.getGrant("grant-bad")).toMatchObject({
          id: "grant-bad",
          toolsets: [],
          toolAllow: [],
          toolDeny: [],
          scopes: [],
          rateLimit: {},
          allowedOrigins: [],
          allowedCidrs: [],
          metadata: {},
          capabilities: [],
          hasToken: false
        });

        expect(store.listGrants().map((grant) => grant.id)).toEqual(["grant-bad"]);

        expect(store.getPendingOperation("pending-bad", { includeOriginalInput: true })).toMatchObject({
          pendingOperationId: "pending-bad",
          toolsetIds: [],
          redactedInput: {},
          context: {},
          resultSummary: {},
          originalInput: {}
        });

        expect(store.listPendingOperations({ status: "unexpected", limit: 0 })).toMatchObject([
          {
            pendingOperationId: "pending-bad",
            status: "pending"
          }
        ]);

        expect(store.getAudit("exec-bad")).toMatchObject({
          toolExecutionId: "exec-bad",
          toolsetIds: [],
          redactedInput: {},
          resultSummary: {}
        });

        expect(store.listAudit({ limit: 0 })).toMatchObject([
          {
            toolExecutionId: "exec-bad",
            redactedInput: {},
            resultSummary: {}
          }
        ]);
      } finally {
        store.close();
      }
    });
  });

  it("normalizes catalog tools, hides internal operations, and filters toolsets", () => {
    const operations = [
      {
        id: "jobs.list",
        label: "Jobs list",
        description: "List jobs",
        http: { method: "get", path: "/jobs" },
        readOnly: true
      },
      {
        id: "agent_workspaces.create",
        label: "Workspace create",
        featureId: "workspace",
        feature: "Workspace",
        aspects: ["external-service"],
        externalMcp: true,
        requiredScopes: ["workspace:read", "workspace:write"],
        http: { method: "post", path: "/workspaces", query: [{ name: "team" }] },
        readOnly: false
      },
      {
        id: "acp_agent_relay.permission.resolve",
        toolId: "pact.acpAgentRelay.permission.resolve",
        label: "Hidden operation",
        http: { method: "post", path: "/hidden" },
        readOnly: false
      }
    ];

    const catalog = createToolCatalog({ operations });
    expect(catalog.tools.map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(catalog.tools.map((tool) => tool.id)).toContain("pact.workspace.create");
    expect(catalog.tools.map((tool) => tool.id)).not.toContain("pact.acpAgentRelay.permission.resolve");

    const registry = createToolCatalogRegistry({ operations });
    expect(registry.getToolByOperationId("jobs.list")).toMatchObject({
      id: "pact.jobs.list",
      requiredScopes: ["jobs:read"],
      risk: "read_only"
    });
    expect(registry.getTool("pact.workspace.create")).toMatchObject({
      id: "pact.workspace.create",
      feature: "Workspace",
      aspects: ["external-service"],
      transport: {
        http: {
          method: "POST",
          path: "/workspaces",
          query: [{ name: "team" }]
        }
      }
    });

    expect(registry.listTools({ owner: "pact", risk: "read_only", scope: "jobs:read" }).map((tool) => tool.id)).toContain("pact.jobs.list");
    expect(registry.listTools({ toolset: "pact.agent.workspace" }).map((tool) => tool.id)).toContain("pact.workspace.create");

    const defaultResolution = registry.resolveToolset();
    expect(defaultResolution.toolsets).toContain("pact.jobs.read");
    expect(defaultResolution.tools.map((tool) => tool.id)).toContain("pact.jobs.list");

    const workspaceResolution = registry.resolveToolset({
      scopes: ["workspace:write"],
      toolAllow: ["pact.workspace.create"],
      toolDeny: ["pact.jobs.list"]
    });
    expect(workspaceResolution.toolsets).toContain("pact.agent.workspace");
    expect(workspaceResolution.requiredScopes).toContain("workspace:write");
    expect(workspaceResolution.tools.map((tool) => tool.id)).toEqual(["pact.workspace.create"]);
  });

  it("dispatches merged inputs on success, rejects bad direct JSON, and surfaces dispatch failures", async () => {
    const { runtime, store, tool, operation } = createRuntimeFixture();
    const request = createRequest({ headers: { "user-agent": "unit-test" } });
    const authorizedGrant = { id: "grant-1", label: "Grant 1", scopes: ["jobs:read"] };

    dispatchOperationMock.mockImplementationOnce(async ({ response, input, params, url }) => {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        schemaVersion: "v0.0.1:schema:definition-1",
        result: {
          ok: true,
          path: url.pathname,
          input,
          params
        }
      }));
      return { ok: true };
    });

    const success = await runtime.executeTool({
      toolId: tool.id,
      request,
      context: { traceId: "trace-success" },
      directOperation: operation,
      directUrl: new URL("http://127.0.0.1/tool/tool-1"),
      directRequestBody: Buffer.from("{\"name\":\"Ada\"}", "utf8"),
      directParams: { id: "tool-1" },
      authorizedGrant
    });
    expect(success).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        schemaVersion: "v0.0.1:schema:definition-1",
        toolId: tool.id,
        status: "ok",
        result: {
          ok: true,
          path: "/tool/tool-1",
          input: {
            name: "Ada",
            id: "tool-1"
          },
          params: {
            id: "tool-1"
          }
        }
      }
    });
    expect(dispatchOperationMock).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        name: "Ada",
        id: "tool-1"
      },
      params: {
        id: "tool-1"
      }
    }));
    expect(store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolId: tool.id,
      status: "ok",
      errorCode: ""
    }));

    dispatchOperationMock.mockClear();
    const invalidJson = await runtime.executeTool({
      toolId: tool.id,
      request: createRequest(),
      context: { traceId: "trace-invalid" },
      directOperation: operation,
      directUrl: new URL("http://127.0.0.1/tool/tool-1"),
      directRequestBody: Buffer.from("{not-json", "utf8"),
      directParams: { id: "tool-1" },
      authorizedGrant
    });
    expect(invalidJson).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_input"
        }
      }
    });
    expect(dispatchOperationMock).not.toHaveBeenCalled();
    expect(store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      toolId: tool.id,
      status: "denied",
      errorCode: "invalid_input"
    }));

    const failingRuntime = createRuntimeFixture();
    dispatchOperationMock.mockRejectedValueOnce(new Error("dispatch blew up"));
    const failed = await failingRuntime.runtime.executeTool({
      toolId: failingRuntime.tool.id,
      request: createRequest(),
      context: { traceId: "trace-failed" },
      directOperation: failingRuntime.operation,
      directUrl: new URL("http://127.0.0.1/tool/tool-1"),
      directRequestBody: Buffer.from("{\"name\":\"Ada\"}", "utf8"),
      directParams: { id: "tool-1" },
      authorizedGrant
    });
    expect(failed).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "tool_execution_failed",
          message: "dispatch blew up"
        }
      }
    });
    expect(summarizeErrorMock).toHaveBeenCalled();
  });

  it("returns unknown tool and missing operation errors before dispatching", async () => {
    const unknownToolRuntime = createRuntimeFixture({
      registry: {
        getTool: vi.fn(() => null),
        listProfiles: vi.fn(() => [])
      }
    });
    const unknown = await unknownToolRuntime.runtime.executeTool({
      toolId: "missing.tool",
      request: createRequest(),
      context: { traceId: "trace-unknown" },
      authorizedGrant: { id: "grant-1", label: "Grant 1", scopes: [] }
    });
    expect(unknown).toMatchObject({
      ok: false,
      status: 404,
      payload: {
        error: {
          code: "unknown_tool"
        }
      }
    });
    expect(dispatchOperationMock).not.toHaveBeenCalled();

    const missingOperationRuntime = createRuntimeFixture({
      operations: [],
      registry: {
        getTool: vi.fn(() => ({
          id: "pact.jobs.read",
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
        })),
        listProfiles: vi.fn(() => [])
      }
    });
    const missing = await missingOperationRuntime.runtime.executeTool({
      toolId: "pact.jobs.read",
      request: createRequest(),
      context: { traceId: "trace-missing-operation" },
      authorizedGrant: { id: "grant-1", label: "Grant 1", scopes: ["jobs:read"] }
    });
    expect(missing).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "operation_missing"
        }
      }
    });
  });

  it("handles confirmation boundaries, unknown catalog entries, and invalid JSON requests", async () => {
    const platform = createPlatform({
      registry: {
        getTool: vi.fn((toolId) => (toolId === "pact.jobs.read" ? { id: toolId } : null)),
        getToolByOperationId: vi.fn(() => null)
      }
    });
    const securityPermissions = createSecurityPermissions();
    const router = createToolManagementHttpRouter({
      platform,
      securityPermissions
    });

    const passthrough = await callRouter(router, {
      method: "GET",
      path: "/api/not-tool-management/v1/health"
    });
    expect(passthrough.handled).toBe(false);

    const confirmation = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/grants",
      body: { label: "Grant" },
      headers: { authorization: "Bearer token" }
    });
    expect(confirmation.response.statusCode).toBe(403);
    expect(JSON.parse(confirmation.response.body)).toMatchObject({
      error: {
        code: "confirmation_required"
      }
    });
    expect(securityPermissions.authorizeOperation).toHaveBeenCalled();

    const unknownCatalog = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/catalog/unknown%2Ftool",
      headers: { authorization: "Bearer token" }
    });
    expect(unknownCatalog.response.statusCode).toBe(404);
    expect(JSON.parse(unknownCatalog.response.body)).toMatchObject({
      error: {
        code: "unknown_tool"
      }
    });

    await expect(callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/execute",
      rawRequestBody: Buffer.from("{not-json", "utf8")
    })).rejects.toThrow();
  });
});
