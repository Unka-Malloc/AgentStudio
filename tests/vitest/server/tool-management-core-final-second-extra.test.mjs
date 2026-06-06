import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  traceId: "trace-runtime"
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

function createTempPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pact-tool-management-final-second-extra-"));
}

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

function createRequest({ headers = {}, id = "req-1", method = "GET" } = {}) {
  return {
    __pactRequestId: id,
    method,
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
}

function createUrl(pathname) {
  return new URL(pathname, "http://127.0.0.1");
}

function createPlatform(overrides = {}) {
  return {
    catalog: vi.fn(() => ({ schemaVersion: 1, catalog: true })),
    registry: {
      getTool: vi.fn(),
      getToolByOperationId: vi.fn(() => null),
      listToolsets: vi.fn(() => [{ id: "toolset-1" }]),
      resolveToolset: vi.fn((payload) => ({ resolved: true, payload })),
      listProfiles: vi.fn(() => [{ id: "profile-1" }]),
      ...overrides.registry
    },
    runtime: {
      executeTool: vi.fn(async () => ({
        status: 201,
        payload: { schemaVersion: 1, result: { ok: true } }
      })),
      resumePendingOperation: vi.fn(async () => ({
        status: 200,
        payload: { schemaVersion: 1, status: "completed" }
      })),
      ...overrides.runtime
    },
    store: {
      listGrants: vi.fn(() => [{ id: "grant-1" }]),
      createGrant: vi.fn(async () => ({ grant: { id: "grant-new" }, token: "token-new" })),
      rotateGrantToken: vi.fn(async () => ({ grant: { id: "grant-1" }, token: "token-rotated" })),
      revokeGrant: vi.fn(async () => ({ id: "grant-1" })),
      updateGrant: vi.fn((grantId, payload) => ({ id: grantId, updated: payload })),
      listAudit: vi.fn(() => [{ id: "audit-1" }]),
      getAudit: vi.fn(() => null),
      metricsSummary: vi.fn(() => ({ status: "ok" })),
      metricsExport: vi.fn(() => ({ status: "ok" })),
      metricsHealth: vi.fn(() => ({ status: "ok" })),
      metricsPrometheus: vi.fn(() => "metric-sample"),
      metricsStorageSummary: vi.fn(() => ({ status: "ok" })),
      pruneMetrics: vi.fn(() => ({ status: "ok" })),
      listPendingOperations: vi.fn(() => []),
      ...overrides.store
    },
    policyEngine: {
      preview: vi.fn((payload) => ({ effect: "allow", payload }))
    },
    ...overrides
  };
}

function buildLegacySchema(userDataPath, userVersion = 2) {
  const dbPath = getToolManagementDatabasePath(userDataPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_metric_events (
      metric_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      tool_id TEXT NOT NULL,
      grant_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  db.pragma(`user_version = ${userVersion}`);
  db.close();
}

function withTempUserDataPath(testCase) {
  const userDataPath = createTempPath();
  try {
    return testCase(userDataPath);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

async function callRouter(router, {
  method = "GET",
  path: pathname,
  body = null,
  headers = {},
  requestId = "req-1",
  platform
}) {
  const response = createResponse();
  const request = createRequest({ headers, id: requestId, method });
  const requestBody = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf8");
  const handled = await router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url: createUrl(pathname),
    method
  });
  return { handled, response, request, requestBody, platform };
}

function createRuntimeFixture(overrides = {}) {
  const operation = {
    id: "operation.one",
    http: {
      method: "POST",
      path: "/tools/:id"
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    },
    safety: { approvalScope: "tool:approve" }
  };
  const runtimeOperation = {
    ...operation,
    ...(overrides.operation || {})
  };
  const tool = {
    id: "tool.one",
    operationId: runtimeOperation.id,
    version: "1.0.0",
    toolsets: ["pact.jobs.read"],
    requiredScopes: ["jobs:read"],
    risk: "read_only",
    timeoutMs: 2_000,
    maxResultBytes: 1024,
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
      decisionId: "policy-final-second",
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
    operations: [runtimeOperation],
    logger: getRuntimeLoggerMock(),
    ...overrides.runtimeOptions
  });

  return { runtime, store, registry, tool, operation: runtimeOperation, policyEngine };
}

beforeEach(() => {
  dispatchOperationMock.mockClear();
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
  traceContextFromRequestMock.mockClear();
});

describe("tool-management store load/save edges (final second)", () => {
  it("migrates legacy user_versioned schemas and adds missing runtime tables/columns", () => {
    withTempUserDataPath((userDataPath) => {
      buildLegacySchema(userDataPath, 2);
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        const db = store.db;
        expect(db.pragma("user_version", { simple: true })).toBe(4);

        const metricColumns = db.prepare("PRAGMA table_info(tool_metric_events)").all().map((row) => row.name);
        expect(metricColumns).toEqual(expect.arrayContaining([
          "input_bytes",
          "transfer_bytes",
          "bytes_per_second"
        ]));

        const requestColumns = db.prepare("PRAGMA table_info(http_request_metric_events)").all().map((row) => row.name);
        expect(requestColumns.length).toBeGreaterThan(0);

        const pendingColumns = db.prepare("PRAGMA table_info(tool_pending_operations)").all().map((row) => row.name);
        expect(pendingColumns).toEqual(expect.arrayContaining(["pending_operation_id", "status", "created_at", "expires_at"]));

        expect(store.saveCatalogSnapshot({
          fingerprint: "catalog:v1",
          tools: [{ id: "pact.jobs.read" }]
        })).toEqual({ fingerprint: "catalog:v1" });
      } finally {
        store.close();
      }
    });
  });

  it("creates missing directories, round-trips persisted state, and tolerates corrupted JSON on reload", async () => {
    await withTempUserDataPath(async (basePath) => {
      const userDataPath = path.join(basePath, "missing", "nested");
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        const dbPath = getToolManagementDatabasePath(userDataPath);
        expect(store.rootPath).toBe(path.join(userDataPath, "tool-management"));
        expect(dbPath).toBe(path.join(userDataPath, "tool-management", "tool-management.sqlite"));
        expect(store.db.prepare("SELECT 1 AS ok").get().ok).toBe(1);

        const snapshot = store.saveCatalogSnapshot({
          fingerprint: "catalog:final-second",
          tools: [{ id: "pact.jobs.read" }],
          metadata: { source: "final-second" }
        });
        expect(snapshot).toEqual({ fingerprint: "catalog:final-second" });
        expect(store.db.prepare(`
          SELECT count(*) AS count
          FROM tool_catalog_snapshots
          WHERE fingerprint = ?
        `).get("catalog:final-second").count).toBe(1);

        const { grant } = await store.createGrant({
          label: "Roundtrip Grant",
          scopes: "knowledge:read"
        });
        expect(store.listGrants()).toHaveLength(1);

        store.db.prepare(`
          UPDATE tool_grants
          SET toolsets_json = ?,
              tool_allow_json = ?,
              tool_deny_json = ?,
              scopes_json = ?,
              rate_limit_json = ?,
              allowed_origins_json = ?,
              allowed_cidrs_json = ?,
              metadata_json = ?
          WHERE id = ?
        `).run(
          "[invalid",
          "not-json",
          "not-json",
          "scope:only",
          "{",
          "{",
          "{",
          "{invalid",
          grant.id
        );

        const corrupted = store.getGrant(grant.id);
        expect(corrupted).toMatchObject({
          id: grant.id,
          toolsets: [],
          toolAllow: [],
          toolDeny: [],
          scopes: [],
          rateLimit: {},
          allowedOrigins: [],
          allowedCidrs: [],
          metadata: {},
          capabilities: []
        });
      } finally {
        store.close();
        const reopened = createToolManagementStore({
          userDataPath,
          capabilityKeyProvider: {},
          capabilityBindingGuard: false
        });
        expect(reopened.rootPath).toBe(path.join(userDataPath, "tool-management"));
        expect(reopened.db.pragma("user_version", { simple: true })).toBe(4);
        reopened.close();
      }
    });
  });

  it("normalizes mixed toolset/scope input and recovers from invalid scope-only payload", async () => {
    const userDataPath = createTempPath();
    const store = createToolManagementStore({
      userDataPath,
      capabilityKeyProvider: {},
      capabilityBindingGuard: false
    });
    try {
      const grant = await store.createGrant({
        label: "Invalid scope fallback",
        toolsets: ["pact.jobs.read", "", "pact.jobs.read"],
        scopes: "invalid:scope"
      });
      expect(grant.grant.scopes).toEqual(["jobs:read"]);
      expect(grant.grant.toolsets).toEqual(["pact.jobs.read"]);

      const updated = store.updateGrant(grant.grant.id, {
        toolsets: ["pact.knowledge.read", "pact.knowledge.read", "", "   "],
        scopes: "invalid:scope"
      });
      expect(updated.toolsets).toEqual(["pact.knowledge.read"]);
      expect(updated.scopes).toEqual(["knowledge:read"]);
    } finally {
      store.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});

describe("tool-management runtime external invoke fallback (final second)", () => {
  it("falls back to external MCP unavailable when passthrough runtime is not configured", async () => {
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      tool: { maxResultBytes: 64 },
      runtimeOptions: { externalMcpPassthroughRuntime: null }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { id: "abc" },
      request: createRequest(),
      directOperation: null
    });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      payload: {
        error: {
          code: "external_mcp_passthrough_unavailable",
          details: expect.objectContaining({ toolExecutionId: expect.any(String) })
        }
      }
    });
  });

  it("returns oversize and runtime-failure errors for external MCP invocation", async () => {
    const oversizedExternal = createRuntimeFixture({
      operation: {
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "search" }
      },
      tool: {
        maxResultBytes: 32
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => ({
            protocolVersion: "pact.external-mcp-passthrough.v1",
            result: { payload: "x".repeat(100) },
            durationMs: 10
          }))
        }
      }
    });

    const oversized = await oversizedExternal.runtime.executeTool({
      toolId: oversizedExternal.tool.id,
      input: { id: "abc" },
      request: createRequest()
    });
    expect(oversized.ok).toBe(false);
    expect(oversized.status).toBe(413);
    expect(oversized.payload?.error?.code).toBe("result_too_large");

    const failureRuntime = createRuntimeFixture({
      operation: {
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "search" }
      },
      tool: {
        maxResultBytes: 64
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => {
            const error = new Error("upstream reject");
            error.code = "upstream_reject";
            error.statusCode = 400;
            throw error;
          })
        }
      }
    });

    const failed = await failureRuntime.runtime.executeTool({
      toolId: failureRuntime.tool.id,
      input: { id: "abc" },
      request: createRequest()
    });
    expect(failed).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "upstream_reject",
          message: "upstream reject"
        }
      }
    });
  });

  it("maps direct dispatch non-2xx responses to failed status and tool_handler_failed metric path", async () => {
    dispatchOperationMock.mockImplementationOnce(async ({ response }) => {
      response.writeHead(422, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ schemaVersion: 1, error: { code: "unprocessable" } }));
    });

    const fixture = createRuntimeFixture();
    const directOperation = {
      id: "direct.operation",
      http: { method: "POST", path: "/direct/:id" },
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      }
    };
    const directUrl = new URL("http://127.0.0.1/direct/job-1");
    const directRequestBody = Buffer.from(JSON.stringify({ id: "job-1", extra: "from-body" }), "utf8");
    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { id: "unused", extra: "request-level" },
      request: createRequest(),
      directOperation,
      directUrl,
      directRequestBody,
      directParams: { id: "job-1" }
    });

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      payload: {
        status: "failed",
        result: { error: { code: "unprocessable" } }
      }
    });
    expect(fixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "tool_handler_failed"
    }));
  });
});

describe("tool-management runtime policy boundaries (final second)", () => {
  it("handles require-confirmation and dry-run-only policy effects, and rejects resume when the grant is gone", async () => {
    const confirmationFixture = createRuntimeFixture({
      policyEngine: {
        evaluate: vi.fn(() => ({
          effect: "require_confirmation",
          decisionId: "policy-confirmation",
          reasonCode: "policy_confirmation_required",
          redactedReason: "Approval required.",
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
        }))
      }
    });

    const confirmationResult = await confirmationFixture.runtime.executeTool({
      toolId: confirmationFixture.tool.id,
      input: { id: "tool-1" },
      request: createRequest()
    });

    expect(confirmationResult).toMatchObject({
      ok: false,
      status: 409,
      payload: {
        error: {
          code: "policy_confirmation_required",
          message: "Approval required."
        }
      }
    });
    expect(confirmationFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "policy_confirmation_required"
    }));

    const dryRunFixture = createRuntimeFixture({
      policyEngine: {
        evaluate: vi.fn(() => ({
          effect: "dry_run_only",
          decisionId: "policy-dry-run",
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
        }))
      }
    });

    const dryRunResult = await dryRunFixture.runtime.executeTool({
      toolId: dryRunFixture.tool.id,
      input: { id: "tool-2" },
      request: createRequest()
    });

    expect(dryRunResult).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        status: "ok",
        result: {
          wouldExecute: true
        }
      }
    });

    const resumeFixture = createRuntimeFixture({
      store: {
        getPendingOperation: vi.fn(() => ({
          pendingOperationId: "pending-1",
          traceId: "trace-request",
          toolId: "tool.one",
          grantId: "grant-1",
          profileId: "",
          risk: "low",
          status: "pending",
          originalInput: { id: "tool-3" },
          context: { transport: "mcp" },
          sourceIp: "127.0.0.1"
        })),
        getRawGrant: vi.fn(() => null)
      }
    });

    const resumed = await resumeFixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-1",
      resolution: "approved",
      request: createRequest()
    });

    expect(resumed).toMatchObject({
      ok: false,
      status: 409,
      payload: {
        status: "failed",
        error: {
          code: "pending_operation_grant_unavailable"
        }
      }
    });
  });
});

describe("tool-management HTTP handler error paths (final second)", () => {
  it("requires confirm for revoke/update and keeps side effects disabled", async () => {
    const platform = createPlatform({
      store: {
        revokeGrant: vi.fn(async () => ({ id: "grant-1" })),
        updateGrant: vi.fn((id, payload) => ({ id, updated: payload }))
      }
    });
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const revoke = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/grants/grant%2F1/revoke",
      body: { reason: "manual" }
    });
    expect(revoke.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(revoke.response, 403, {
      schemaVersion: 1,
      error: {
        code: "confirmation_required",
        message: "Tool management grant changes require x-pact-safety-confirm: true."
      }
    });
    expect(platform.store.revokeGrant).not.toHaveBeenCalled();

    const update = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/grants/grant%2F1",
      body: { label: "Should not update" }
    });
    expect(update.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(update.response, 403, {
      schemaVersion: 1,
      error: {
        code: "confirmation_required",
        message: "Tool management grant changes require x-pact-safety-confirm: true."
      }
    });
    expect(platform.store.updateGrant).not.toHaveBeenCalled();
  });

  it("returns audit_not_found for missing audit records", async () => {
    const platform = createPlatform({
      store: {
        getAudit: vi.fn(() => null)
      }
    });
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const result = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/audit/audit%2Dmissing"
    });

    expect(result.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 404, {
      schemaVersion: 1,
      error: {
        code: "audit_not_found",
        message: "Audit record not found."
      }
    });
  });
});

describe("tool-management HTTP query and error coverage (final second)", () => {
  it("forwards query parameters, accepts empty execute input, and returns route-not-found for unknown paths", async () => {
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({ platform, logger: getRuntimeLoggerMock() });

    const summary = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/metrics/summary?limit=7&since=2026-01-01T00%3A00%3A00.000Z&until=2026-01-02T00%3A00%3A00.000Z&toolId=pact.jobs.read&grantId=grant-1&profileId=profile-1&route=%2Fjobs%2Frun&transport=http&status=ok&statusCode=200&completionStatus=completed&bucketSeconds=30"
    });
    expect(summary.handled).toBe(true);
    expect(platform.store.metricsSummary).toHaveBeenCalledWith(expect.objectContaining({
      limit: 7,
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-02T00:00:00.000Z",
      toolId: "pact.jobs.read",
      grantId: "grant-1",
      profileId: "profile-1",
      route: "/jobs/run",
      transport: "http",
      status: "ok",
      statusCode: "200",
      completionStatus: "completed",
      bucketSeconds: 30
    }));

    const execute = await callRouter(router, {
      platform,
      method: "POST",
      path: "/api/tool-management/v1/execute",
      body: {
        toolId: "tool.execute",
        context: { source: "empty-input" }
      }
    });
    expect(execute.handled).toBe(true);
    expect(platform.runtime.executeTool).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "tool.execute",
      input: {},
      context: { source: "empty-input" },
      dryRun: false
    }));

    const unknown = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/does-not-exist"
    });
    expect(unknown.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(unknown.response, 404, {
      schemaVersion: 1,
      error: {
        code: "tool_management_route_not_found",
        message: "Tool management route not found.",
        details: { path: "/does-not-exist" }
      }
    });
  });
});
