import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchOperationMock = vi.hoisted(() => vi.fn(async ({ response }) => {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    schemaVersion: "v0.0.1:schema:definition-1",
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
const broadcastMcpToolListChangedMock = vi.hoisted(() => vi.fn(() => ({
  method: "notifications/tools/list_changed",
  deliveredConnectionCount: 1
})));
const listExternalVirtualOperationsMock = vi.hoisted(() => vi.fn(() => []));
const invalidateExternalRuntimeStateMock = vi.hoisted(() => vi.fn((catalogChange = {}) => ({
  ok: true,
  serviceId: catalogChange.serviceId || "",
  reasonCode: catalogChange.invalidation?.reasonCode || catalogChange.reasonCode || "",
  scopes: catalogChange.invalidation?.scopes || [],
  inFlightTrackedCount: 1,
  inFlightAbortedCount: 1,
  upstreamSessionInvalidatedCount: 1,
  runtimeCacheInvalidated: (catalogChange.invalidation?.scopes || []).includes("external-service-runtime-cache"),
  healthStateInvalidated: 0
})));
const createExternalMcpPassthroughRuntimeMock = vi.hoisted(() => vi.fn(() => ({
  listVirtualOperationsSync: listExternalVirtualOperationsMock,
  invalidateRuntimeState: invalidateExternalRuntimeStateMock
})));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  dispatchOperation: dispatchOperationMock,
  getRuntimeLogger: getRuntimeLoggerMock,
  sendJson: sendJsonMock,
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock,
  traceContextFromRequest: traceContextFromRequestMock
}));

vi.mock("../../../server/platform/common/mcp/http-mcp-adapter.mjs", () => ({
  broadcastMcpToolListChanged: broadcastMcpToolListChangedMock
}));

vi.mock("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs", () => ({
  createExternalMcpPassthroughRuntime: createExternalMcpPassthroughRuntimeMock
}));

import { createToolManagementHttpRouter } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/http.mjs";
import { createToolCatalog } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementPlatform } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/index.mjs";
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
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
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
        payload: { schemaVersion: "v0.0.1:schema:definition-1", result: { ok: true } }
      })),
      resumePendingOperation: vi.fn(async () => ({
        status: 200,
        payload: { schemaVersion: "v0.0.1:schema:definition-1", status: "completed" }
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
  broadcastMcpToolListChangedMock.mockClear();
  listExternalVirtualOperationsMock.mockReset();
  listExternalVirtualOperationsMock.mockReturnValue([]);
  invalidateExternalRuntimeStateMock.mockClear();
  createExternalMcpPassthroughRuntimeMock.mockClear();
});

describe("tool-management external ServiceHub invalidation bridge (final second)", () => {
  it("consumes registry catalogChange scopes before refreshing external MCP operations and broadcasts them", () => {
    withTempUserDataPath((userDataPath) => {
      const logger = getRuntimeLoggerMock();
      const baseOperation = {
        id: "jobs.list",
        toolId: "pact.jobs.list",
        feature: "jobs",
        label: "Jobs list",
        target: { controller: "unit", method: "read" },
        http: { method: "GET", path: "/api/jobs" },
        rpc: { method: "jobs.list" },
        requiredScopes: ["jobs:read"],
        readOnly: true,
        concurrencySafe: true,
        aspects: ["unit"],
        safety: { risk: "read_only", readOnly: true },
        inputSchema: { type: "object", additionalProperties: true }
      };
      const externalOperation = {
        id: "external.mcp.demo.search",
        toolId: "pact.externalMcp.demo.search",
        feature: "servicehub",
        label: "Demo search",
        target: { method: "execute" },
        http: { method: "POST", path: "/api/external/mcp/demo/tools/search" },
        rpc: { method: "external.mcp.demo.search" },
        requiredScopes: ["knowledge:read"],
        concurrencySafe: true,
        aspects: ["external-service", "external-mcp-passthrough", "service-hub"],
        safety: { risk: "read_only", readOnly: true },
        inputSchema: { type: "object", additionalProperties: true },
        externalMcp: {
          serviceId: "demo",
          upstreamToolName: "search",
          activeVersionId: "v0.0.1:strategy:servicehub-version-demo-active-2",
          serviceCatalogVersionId: "v0.0.1:strategy:servicehub-version-demo-active-2",
          manifestFingerprint: "manifest-fp-v2",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://mcp.example.test/mcp"
          },
          adoption: {
            state: "adopted",
            fingerprint: "tool-fp-v2"
          }
        }
      };
      let virtualOperations = [];
      listExternalVirtualOperationsMock.mockImplementation(() => virtualOperations);

      const platform = createToolManagementPlatform({
        userDataPath,
        operations: [baseOperation],
        controllers: { unit: { read: vi.fn() } },
        logger
      });
      try {
        virtualOperations = [externalOperation];
        const refresh = platform.refreshExternalServiceTools({
          source: "external-service-registry",
          type: "external_service_config_saved",
          reasonCode: "external_service_config_saved",
          serviceId: "demo",
          activeVersionId: "v0.0.1:strategy:servicehub-version-demo-active-2",
          manifestFingerprint: "manifest-fp-v2",
          invalidation: {
            reasonCode: "external_service_secret_auth_changed",
            scopes: ["mcp-tools-list"]
          }
        });

        expect(refresh).toMatchObject({
          ok: true,
          externalMcpOperationCount: 1,
          externalServiceOperationCount: 1,
          runtimeInvalidation: {
            ok: true,
            serviceId: "demo",
            reasonCode: "external_service_secret_auth_changed",
            inFlightAbortedCount: 1,
            upstreamSessionInvalidatedCount: 1,
            runtimeCacheInvalidated: true,
            scopes: expect.arrayContaining([
              "mcp-tools-list",
              "external-service-runtime-cache",
              "upstream-session"
            ])
          },
          catalogChange: {
            invalidation: {
              scopes: expect.arrayContaining([
                "external-service-runtime-cache",
                "upstream-session"
              ])
            }
          }
        });
        expect(platform.catalog().tools.map((tool) => tool.id)).toContain("pact.externalMcp.demo.search");
        expect(invalidateExternalRuntimeStateMock).toHaveBeenCalledWith(expect.objectContaining({
          serviceId: "demo",
          invalidation: expect.objectContaining({
            reasonCode: "external_service_secret_auth_changed",
            scopes: expect.arrayContaining([
              "external-service-runtime-cache",
              "upstream-session"
            ])
          })
        }));
        expect(invalidateExternalRuntimeStateMock.mock.invocationCallOrder[0]).toBeLessThan(
          listExternalVirtualOperationsMock.mock.invocationCallOrder.at(-1)
        );
        expect(broadcastMcpToolListChangedMock).toHaveBeenCalledWith(expect.objectContaining({
          reasonCode: "external_service_config_saved",
          details: expect.objectContaining({
            serviceId: "demo",
            manifestFingerprint: "manifest-fp-v2",
            invalidation: expect.objectContaining({
              reasonCode: "external_service_secret_auth_changed",
              scopes: expect.arrayContaining([
                "external-service-runtime-cache",
                "upstream-session"
              ])
            })
          })
        }));
      } finally {
        platform.close();
      }
    });
  });

  it("normalizes SecretStore lifecycle catalogChange into external runtime invalidation scopes", () => {
    withTempUserDataPath((userDataPath) => {
      const platform = createToolManagementPlatform({
        userDataPath,
        operations: [],
        logger: getRuntimeLoggerMock()
      });
      try {
        const refresh = platform.refreshExternalServiceTools({
          source: "secret-store",
          type: "external_service_secret_rotated",
          reasonCode: "external_service_secret_rotated",
          serviceId: "demo",
          secretRefFingerprint: "a".repeat(64)
        });

        expect(refresh).toMatchObject({
          ok: true,
          runtimeInvalidation: {
            reasonCode: "external_service_secret_rotated",
            serviceId: "demo",
            scopes: expect.arrayContaining([
              "external-service-runtime-cache",
              "upstream-session"
            ])
          },
          catalogChange: {
            source: "secret-store",
            reasonCode: "external_service_secret_rotated",
            serviceId: "demo",
            invalidation: {
              scopes: expect.arrayContaining([
                "tool-management-catalog",
                "mcp-tools-list",
                "external-service-runtime-cache",
                "upstream-session"
              ])
            }
          }
        });
        expect(invalidateExternalRuntimeStateMock).toHaveBeenCalledWith(expect.objectContaining({
          reasonCode: "external_service_secret_rotated",
          secretRefFingerprint: "a".repeat(64),
          invalidation: expect.objectContaining({
            scopes: expect.arrayContaining([
              "external-service-runtime-cache",
              "upstream-session"
            ])
          })
        }));
      } finally {
        platform.close();
      }
    });
  });
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
      capabilityBindingGuard: false,
      registry: {
        getCatalog: vi.fn(() => ({ fingerprint: "catalog:grant-projection" }))
      }
    });
    try {
      const grant = await store.createGrant({
        label: "Invalid scope fallback",
        toolsets: ["pact.jobs.read", "", "pact.jobs.read"],
        scopes: "invalid:scope"
      });
      expect(grant.grant.scopes).toEqual(["jobs:read"]);
      expect(grant.grant.toolsets).toEqual(["pact.jobs.read"]);
      expect(grant.grant.projection).toMatchObject({
        protocolVersion: "v0.0.1:tool:grant-projection-1",
        catalogFingerprint: "catalog:grant-projection",
        fingerprint: expect.any(String)
      });
      expect(grant.grant.projectionFingerprint).toBe(grant.grant.projection.fingerprint);

      const updated = store.updateGrant(grant.grant.id, {
        toolsets: ["pact.agentLibrary.read", "pact.agentLibrary.read", "", "   "],
        scopes: "invalid:scope"
      });
      expect(updated.toolsets).toEqual(["pact.agentLibrary.read"]);
      expect(updated.scopes).toEqual(["knowledge:read"]);
      expect(updated.projectionFingerprint).toEqual(expect.any(String));
      expect(updated.projectionFingerprint).not.toBe(grant.grant.projectionFingerprint);
      expect(store.getGrant(grant.grant.id).projectionFingerprint).toBe(updated.projectionFingerprint);
    } finally {
      store.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});

describe("tool-management runtime external invoke fallback (final second)", () => {
  it("rejects invalid external MCP input before forwarding upstream", async () => {
    const callTool = vi.fn(async () => ({ result: { ok: true } }));
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: { callTool }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: {},
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_input",
          message: "Tool operation operation.one missing required input: id."
        }
      }
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(fixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "invalid_input",
      resultSummary: expect.objectContaining({ type: "invalid_input" })
    }));
  });

  it("rejects undeclared external MCP input fields when the adopted schema is closed", async () => {
    const callTool = vi.fn(async () => ({ result: { ok: true } }));
    const fixture = createRuntimeFixture({
      operation: {
        inputSchema: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: { type: "string" }
          }
        },
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: { callTool }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: {
        id: "abc",
        upstreamUrl: "http://127.0.0.1:1/should-not-pass",
        Authorization: "Bearer should-not-pass"
      },
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_input",
          message: "Tool operation operation.one received undeclared input: Authorization, upstreamUrl."
        }
      }
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects nested external MCP input fields outside the safe JSON Schema subset", async () => {
    const callTool = vi.fn(async () => ({ result: { ok: true } }));
    const fixture = createRuntimeFixture({
      operation: {
        inputSchema: {
          type: "object",
          required: ["id", "options", "items"],
          additionalProperties: false,
          properties: {
            id: { type: "string", maxLength: 8 },
            mode: { type: "string", enum: ["read", "summary"] },
            count: { type: "integer", minimum: 1, maximum: 3 },
            options: {
              type: "object",
              required: ["locale"],
              additionalProperties: false,
              properties: {
                locale: { type: "string", enum: ["en-US", "zh-CN"] }
              }
            },
            items: {
              type: "array",
              maxItems: 2,
              items: {
                type: "object",
                required: ["name"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", maxLength: 6 }
                }
              }
            }
          }
        },
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: { callTool }
      }
    });

    const cases = [
      {
        input: {
          id: "abcdefghi",
          mode: "read",
          count: 1,
          options: { locale: "en-US" },
          items: [{ name: "alpha" }]
        },
        message: "Tool operation operation.one input.id must be at most 8 characters."
      },
      {
        input: {
          id: "abc",
          mode: "write",
          count: 1,
          options: { locale: "en-US" },
          items: [{ name: "alpha" }]
        },
        message: "Tool operation operation.one input.mode must be one of the declared enum values."
      },
      {
        input: {
          id: "abc",
          mode: "read",
          count: 1.5,
          options: { locale: "en-US" },
          items: [{ name: "alpha" }]
        },
        message: "Tool operation operation.one input.count must be integer."
      },
      {
        input: {
          id: "abc",
          mode: "read",
          count: 1,
          options: { locale: "en-US", upstreamUrl: "http://127.0.0.1:1" },
          items: [{ name: "alpha" }]
        },
        message: "Tool operation operation.one received undeclared input: input.options.upstreamUrl."
      },
      {
        input: {
          id: "abc",
          mode: "read",
          count: 1,
          options: { locale: "en-US" },
          items: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }]
        },
        message: "Tool operation operation.one input.items must contain at most 2 items."
      },
      {
        input: {
          id: "abc",
          mode: "read",
          count: 1,
          options: { locale: "en-US" },
          items: [{ name: "toolong" }]
        },
        message: "Tool operation operation.one input.items[0].name must be at most 6 characters."
      }
    ];

    for (const { input, message } of cases) {
      const result = await fixture.runtime.executeTool({
        toolId: fixture.tool.id,
        input,
        request: createRequest()
      });
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        payload: {
          error: {
            code: "invalid_input",
            message
          }
        }
      });
    }
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects composed, formatted, and patterned external MCP inputs before passthrough", async () => {
    const callTool = vi.fn(async () => ({ result: { ok: true } }));
    const fixture = createRuntimeFixture({
      operation: {
        inputSchema: {
          type: "object",
          required: ["email", "code", "mode", "payload"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            code: { type: "string", pattern: "^[A-Z]{2,8}$" },
            mode: {
              oneOf: [
                { const: "fast" },
                { const: "safe" }
              ]
            },
            payload: {
              anyOf: [
                { type: "string", minLength: 3 },
                { type: "integer", minimum: 10 }
              ]
            },
            blocked: {
              not: { const: "forbidden" }
            },
            label: {
              allOf: [
                { type: "string" },
                { pattern: "^[a-z]{2,6}$" }
              ]
            }
          }
        },
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: { callTool }
      }
    });
    const baseInput = {
      email: "owner@example.com",
      code: "ITEM",
      mode: "fast",
      payload: "abc",
      label: "ready"
    };
    const cases = [
      {
        input: { ...baseInput, email: "not-email" },
        message: "Tool operation operation.one input.email must match format email."
      },
      {
        input: { ...baseInput, code: "item" },
        message: "Tool operation operation.one input.code must match the declared pattern."
      },
      {
        input: { ...baseInput, mode: "turbo" },
        message: "Tool operation operation.one input.mode must satisfy exactly one oneOf schema."
      },
      {
        input: { ...baseInput, payload: 5 },
        message: "Tool operation operation.one input.payload must satisfy at least one anyOf schema."
      },
      {
        input: { ...baseInput, blocked: "forbidden" },
        message: "Tool operation operation.one input.blocked must not match the declared not schema."
      },
      {
        input: { ...baseInput, label: "READY" },
        message: "Tool operation operation.one input.label must satisfy allOf[1]: Tool operation operation.one input.label must match the declared pattern."
      }
    ];

    for (const { input, message } of cases) {
      const result = await fixture.runtime.executeTool({
        toolId: fixture.tool.id,
        input,
        request: createRequest()
      });
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        payload: {
          error: {
            code: "invalid_input",
            message
          }
        }
      });
    }
    expect(callTool).not.toHaveBeenCalled();
  });

  it("passes valid composed external MCP inputs to passthrough unchanged", async () => {
    const callTool = vi.fn(async () => ({
      protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
      result: { ok: true },
      durationMs: 3
    }));
    const fixture = createRuntimeFixture({
      operation: {
        inputSchema: {
          type: "object",
          required: ["email", "code", "mode", "payload", "label"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            code: { type: "string", pattern: "^[A-Z]{2,8}$" },
            mode: {
              oneOf: [
                { const: "fast" },
                { const: "safe" }
              ]
            },
            payload: {
              anyOf: [
                { type: "string", minLength: 3 },
                { type: "integer", minimum: 10 }
              ]
            },
            blocked: {
              not: { const: "forbidden" }
            },
            label: {
              allOf: [
                { type: "string" },
                { pattern: "^[a-z]{2,6}$" }
              ]
            }
          }
        },
        externalMcp: { serviceId: "mcp-service", upstreamToolName: "weather" }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: { callTool }
      }
    });
    const input = {
      email: "owner@example.com",
      code: "ITEM",
      mode: "safe",
      payload: 12,
      label: "ready"
    };

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input,
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        result: {
          serviceId: "mcp-service",
          upstreamToolName: "weather",
          result: { ok: true }
        }
      }
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "mcp-service",
      toolName: "weather",
      input
    }));
  });

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
    expect(fixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "external_mcp_passthrough_unavailable",
      resultSummary: expect.objectContaining({
        type: "external_mcp_error",
        externalCallReceipt: expect.objectContaining({
          protocolVersion: "v0.0.1:external-service:servicehub-external-call-receipt-1",
          status: "failed",
          serviceId: "mcp-service",
          upstreamToolName: "weather",
          toolAdoption: expect.objectContaining({
            fingerprint: ""
          })
        })
      })
    }));
  });

  it("adds a redacted external call receipt to external tool result summaries", async () => {
    const externalCallToolMock = vi.fn(async () => ({
      protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "https://api.example.test:443/mcp?token=raw-query-token"
      },
      egressDecision: {
        schemaVersion: "v0.0.1:external-service:servicehub-egress-decision-1",
        ok: true,
        label: "upstream.url",
        protocol: "https",
        host: "api.example.test",
        port: "443",
        hostKind: "hostname",
        addressCategory: "hostname",
        allowLocalForDevelopment: false,
        reason: "allowed",
        dns: {
          status: "resolved",
          host: "api.example.test",
          addressCount: 1,
          restrictedAddressCount: 0,
          addressCategories: ["public"],
          restrictedAddressCategories: []
        }
      },
      result: {
        data: [{ id: "result-1" }],
        stack: "raw-stack-trace"
      },
      durationMs: 12
    }));
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: {
          serviceId: "mcp-service",
          upstreamToolName: "search",
          manifestId: "servicehub.manifest.mcp-service",
          manifestFingerprint: "manifest-fp-123",
          serviceCatalogVersionId: "servicehub.version.mcp-service.active",
          activeVersionId: "servicehub.version.mcp-service.active",
          serviceFingerprint: "service-fp-123",
          toolFingerprint: "tool-fp-123",
          currentToolFingerprint: "tool-fp-123",
          catalogBindingFingerprint: "catalog-binding-fp-123",
          discoveredAt: "2026-06-14T00:00:00.000Z",
          adoption: {
            protocolVersion: "v0.0.1:external-service:servicehub-tool-adoption-1",
            state: "adopted",
            fingerprint: "tool-fp-123",
            previousFingerprint: "old-tool-fp",
            reasonCode: "operator_adopted_candidate",
            adoptedAt: "2026-06-14T00:01:00.000Z",
            adoptedBy: "operator-1"
          },
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://api.example.test:443/mcp?token=raw-query-token",
            auth: {
              secretRef: "secret-ref-123"
            }
          }
        }
      },
      registry: {
        getCatalog: vi.fn(() => ({ fingerprint: "catalog-fp-global-123" }))
      },
      store: {
        authorizeRequest: vi.fn(async () => ({
          ok: true,
          grant: {
            id: "grant-1",
            projectionFingerprint: "grant-projection-fp-123",
            projection: {
              fingerprint: "grant-projection-fp-123",
              catalogFingerprint: "catalog-fp-global-123"
            }
          },
          sourceIp: "127.0.0.1"
        }))
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: externalCallToolMock
        }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: {
        id: "abc",
        body: "raw-request-body",
        authorization: "Bearer raw-header-token"
      },
      request: createRequest(),
      context: {
        agentId: "agent-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        authBindingId: "binding-1"
      }
    });

    expect(result.ok).toBe(true);
    expect(externalCallToolMock).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "mcp-service",
      toolName: "search",
      input: expect.objectContaining({ id: "abc" }),
      timeoutMs: 2_000,
      context: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        authBindingId: "binding-1"
      }
    }));
    const summary = fixture.store.appendExecution.mock.calls.at(-1)?.[0]?.resultSummary;
    expect(summary).toMatchObject({
      type: "external_mcp",
      externalCallReceipt: {
        protocolVersion: "v0.0.1:external-service:servicehub-external-call-receipt-1",
        serviceId: "mcp-service",
        upstreamToolName: "search",
        catalogVersion: "catalog-fp-global-123",
        catalogFingerprint: "catalog-fp-global-123",
        catalogBindingFingerprint: "catalog-binding-fp-123",
        manifestId: "servicehub.manifest.mcp-service",
        manifestFingerprint: "manifest-fp-123",
        serviceCatalogVersionId: "servicehub.version.mcp-service.active",
        activeVersionId: "servicehub.version.mcp-service.active",
        serviceFingerprint: "service-fp-123",
        grantProjectionFingerprint: "grant-projection-fp-123",
        toolAdoption: {
          protocolVersion: "v0.0.1:external-service:servicehub-tool-adoption-1",
          state: "adopted",
          fingerprint: "tool-fp-123",
          currentToolFingerprint: "tool-fp-123",
          previousFingerprint: "old-tool-fp",
          reasonCode: "operator_adopted_candidate",
          adoptedAt: "2026-06-14T00:01:00.000Z",
          adoptedBy: "operator-1"
        },
	        upstream: {
	          type: "mcp",
	          transport: "streamable-http",
	          endpointRedacted: true
	        },
	        decisions: {
	          egress: {
	            decision: "allowed",
	            label: "upstream.url",
	            protocol: "https",
	            host: "api.example.test",
	            port: "443",
	            hostKind: "hostname",
	            addressCategory: "hostname",
	            reason: "allowed",
	            dns: {
	              status: "resolved",
	              host: "api.example.test",
	              addressCount: 1,
	              restrictedAddressCount: 0,
	              addressCategories: ["public"],
	              restrictedAddressCategories: []
	            }
	          }
	        },
	        secretRefFingerprint: expect.any(String),
        redaction: {
          rawUrlQuery: "omitted",
          headers: "omitted",
          requestBody: "omitted",
          responseBody: "omitted",
          secrets: "omitted",
          stackTrace: "omitted"
        }
      }
    });
    expect(summary.externalCallReceipt.secretRefFingerprint).not.toBe("secret-ref-123");
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain("raw-query-token");
    expect(serializedSummary).not.toContain("raw-header-token");
    expect(serializedSummary).not.toContain("raw-request-body");
    expect(serializedSummary).not.toContain("secret-ref-123");
    expect(serializedSummary).not.toContain("raw-stack-trace");
  });

  it("redacts token-like scalar external MCP result summaries without changing returned result", async () => {
    const upstreamScalar = "Authorization: Bearer raw-scalar-token-should-return";
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: {
          serviceId: "mcp-service",
          upstreamToolName: "scalar",
          upstream: {
            type: "mcp",
            transport: "streamable-http"
          }
        }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => ({
            protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
            upstream: {
              type: "mcp",
              transport: "streamable-http"
            },
            result: upstreamScalar,
            durationMs: 5
          }))
        }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { id: "abc" },
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        result: {
          result: upstreamScalar
        }
      }
    });
    const summary = fixture.store.appendExecution.mock.calls.at(-1)?.[0]?.resultSummary;
    expect(summary.result).toMatchObject({
      value: "[redacted]",
      redaction: {
        decision: "redacted",
        reason: "token_like_result_value",
        redactedValueCount: 1,
        evidence: [
          expect.objectContaining({
            path: "result",
            reason: "token_like_result_value",
            valueType: "string",
            fingerprint: expect.any(String)
          })
        ]
      }
    });
    expect(summary.externalCallReceipt.decisions.outputGovernance).toMatchObject({
      decision: "passed",
      redaction: {
        decision: "redacted",
        redactedValueCount: 1,
        evidenceCount: 1
      }
    });
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain("raw-scalar-token-should-return");
    expect(serializedSummary).not.toContain("Authorization");
    expect(serializedSummary).not.toContain("Bearer");
    const executionEntry = fixture.store.appendExecution.mock.calls.at(-1)?.[0];
    expect(executionEntry).not.toHaveProperty("result");
    const serializedExecutionEntry = JSON.stringify(executionEntry);
    expect(serializedExecutionEntry).not.toContain("raw-scalar-token-should-return");
    expect(serializedExecutionEntry).not.toContain("Authorization");
    expect(serializedExecutionEntry).not.toContain("Bearer");
  });

  it("redacts nested token-like object values from external MCP result summaries", async () => {
    const upstreamResult = {
      apiKey: "raw-object-api-key-should-return",
      profile: {
        credentials: {
          accessToken: "raw-nested-access-token-should-return"
        }
      },
      nested: [{
        authorization: "Bearer raw-array-token-should-return"
      }],
      normal: "safe label"
    };
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: {
          serviceId: "mcp-service",
          upstreamToolName: "nested",
          upstream: {
            type: "mcp",
            transport: "streamable-http"
          }
        }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => ({
            protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
            upstream: {
              type: "mcp",
              transport: "streamable-http"
            },
            result: upstreamResult,
            durationMs: 6
          }))
        }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { id: "abc" },
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        result: {
          result: upstreamResult
        }
      }
    });
    const summary = fixture.store.appendExecution.mock.calls.at(-1)?.[0]?.resultSummary;
    expect(summary.result).toMatchObject({
      type: "object",
      keys: expect.arrayContaining(["[redacted-key]", "profile", "nested", "normal"]),
      redaction: {
        decision: "redacted",
        redactedValueCount: 3,
        evidence: expect.arrayContaining([
          expect.objectContaining({
            path: "result.<redacted-key>",
            reason: "sensitive_result_key",
            valueType: "string",
            fingerprint: expect.any(String)
          }),
          expect.objectContaining({
            path: "result.profile.<redacted-key>.<redacted-key>",
            reason: "sensitive_result_key",
            valueType: "string",
            fingerprint: expect.any(String)
          }),
          expect.objectContaining({
            path: "result.nested.[0].<redacted-key>",
            reason: "sensitive_result_key",
            valueType: "string",
            fingerprint: expect.any(String)
          })
        ])
      }
    });
    expect(summary.externalCallReceipt.decisions.outputGovernance.redaction).toMatchObject({
      decision: "redacted",
      redactedValueCount: 3,
      evidenceCount: 3
    });
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain("raw-object-api-key-should-return");
    expect(serializedSummary).not.toContain("raw-nested-access-token-should-return");
    expect(serializedSummary).not.toContain("raw-array-token-should-return");
    expect(serializedSummary).not.toContain("apiKey");
    expect(serializedSummary).not.toContain("accessToken");
    expect(serializedSummary).not.toContain("authorization");
    expect(serializedSummary).not.toContain("Bearer");
    const executionEntry = fixture.store.appendExecution.mock.calls.at(-1)?.[0];
    expect(executionEntry).not.toHaveProperty("result");
    const serializedExecutionEntry = JSON.stringify(executionEntry);
    expect(serializedExecutionEntry).not.toContain("raw-object-api-key-should-return");
    expect(serializedExecutionEntry).not.toContain("raw-nested-access-token-should-return");
    expect(serializedExecutionEntry).not.toContain("raw-array-token-should-return");
    expect(serializedExecutionEntry).not.toContain("apiKey");
    expect(serializedExecutionEntry).not.toContain("accessToken");
    expect(serializedExecutionEntry).not.toContain("authorization");
    expect(serializedExecutionEntry).not.toContain("Bearer");
  });

  it("blocks raw MCP non-text content until output governance can convert it to governed refs", async () => {
    const fixture = createRuntimeFixture({
      operation: {
        externalMcp: {
          serviceId: "mcp-service",
          upstreamToolName: "screenshot",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://api.example.test:443/mcp"
          },
          adoption: {
            state: "adopted",
            fingerprint: "tool-fp-image"
          }
        }
      },
      runtimeOptions: {
        externalMcpPassthroughRuntime: {
          callTool: vi.fn(async () => ({
            protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
            upstream: {
              type: "mcp",
              transport: "streamable-http"
            },
            result: {
              content: [{
                type: "image",
                mimeType: "image/png",
                data: "Authorization: Bearer raw-image-token-should-not-leak"
              }]
            },
            durationMs: 8
          }))
        }
      }
    });

    const result = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { id: "abc" },
      request: createRequest()
    });

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      payload: {
        error: {
          code: "output_governance_blocked",
          details: {
            blockedContentTypes: ["image"]
          }
        }
      }
    });
    const summary = fixture.store.appendExecution.mock.calls.at(-1)?.[0]?.resultSummary;
    expect(summary).toMatchObject({
      type: "output_governance_blocked",
      errorCode: "output_governance_blocked",
      externalCallReceipt: {
        status: "failed",
        decisions: {
          outputGovernance: {
            decision: "blocked",
            reason: "unsupported_mcp_content_type",
            blockedContentTypes: ["image"]
          },
          errorTaxonomy: {
            decision: "normalized_error_code",
            errorCode: "output_governance_blocked"
          }
        }
      }
    });
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain("raw-image-token-should-not-leak");
    expect(serializedSummary).not.toContain("Authorization");
    expect(serializedSummary).not.toContain("Bearer");
  });

  it("redacts external MCP catalog metadata and fingerprints external binding changes", () => {
    const baseOperation = {
      id: "external.mcp.demo.search",
      toolId: "pact.externalMcp.demo.search",
      label: "Search external demo",
      target: { method: "execute" },
      http: { method: "POST", path: "/api/external/mcp/demo/tools/search" },
      rpc: { method: "external.mcp.demo.search", body: "params" },
      requiredScopes: ["knowledge:read"],
      inputSchema: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string" }
        }
      },
      safety: { risk: "read_only" },
      aspects: ["external-service", "service-hub"],
      externalMcp: {
        serviceId: "demo",
        upstreamToolName: "search",
        manifestId: "servicehub.manifest.demo",
        manifestFingerprint: "manifest-fp-v1",
        serviceCatalogVersionId: "servicehub.version.demo.active",
        activeVersionId: "servicehub.version.demo.active",
        serviceFingerprint: "service-fp",
        toolFingerprint: "tool-fp-v1",
        currentToolFingerprint: "tool-fp-v1",
        catalogBindingFingerprint: "binding-fp-v1",
        discoveredAt: "2026-06-14T00:00:00.000Z",
        upstream: {
          type: "mcp",
          transport: "streamable-http",
          url: "https://mcp.example.test:443/mcp?token=raw-query-token",
          auth: { secretRef: "secret://servicehub/demo/api-key" }
        },
        adoption: {
          protocolVersion: "v0.0.1:external-service:servicehub-tool-adoption-1",
          state: "adopted",
          fingerprint: "tool-fp-v1",
          adoptedAt: "2026-06-14T00:01:00.000Z",
          adoptedBy: "operator"
        }
      }
    };

    const catalog = createToolCatalog({ operations: [baseOperation] });
    const tool = catalog.tools.find((entry) => entry.id === "pact.externalMcp.demo.search");
    expect(tool.externalMcp).toMatchObject({
      serviceId: "demo",
      upstreamToolName: "search",
      manifestId: "servicehub.manifest.demo",
      manifestFingerprint: "manifest-fp-v1",
      serviceCatalogVersionId: "servicehub.version.demo.active",
      activeVersionId: "servicehub.version.demo.active",
      serviceFingerprint: "service-fp",
      toolFingerprint: "tool-fp-v1",
      catalogBindingFingerprint: "binding-fp-v1",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        endpointRedacted: true
      },
      adoption: {
        state: "adopted",
        fingerprint: "tool-fp-v1"
      }
    });
    const serializedTool = JSON.stringify(tool);
    expect(serializedTool).not.toContain("raw-query-token");
    expect(serializedTool).not.toContain("secret://servicehub/demo/api-key");

    const changedCatalog = createToolCatalog({
      operations: [{
        ...baseOperation,
        externalMcp: {
          ...baseOperation.externalMcp,
          toolFingerprint: "tool-fp-v2",
          currentToolFingerprint: "tool-fp-v2",
          catalogBindingFingerprint: "binding-fp-v2",
          adoption: {
            ...baseOperation.externalMcp.adoption,
            fingerprint: "tool-fp-v2"
          }
        }
      }]
    });
    expect(changedCatalog.fingerprint).not.toBe(catalog.fingerprint);
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
            protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
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
      response.end(JSON.stringify({ schemaVersion: "v0.0.1:schema:definition-1", error: { code: "unprocessable" } }));
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
            protocolVersion: "v0.0.1:risk-control:policy-1",
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
            protocolVersion: "v0.0.1:risk-control:policy-1",
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
      schemaVersion: "v0.0.1:schema:definition-1",
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
      schemaVersion: "v0.0.1:schema:definition-1",
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
      schemaVersion: "v0.0.1:schema:definition-1",
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
      context: expect.objectContaining({ source: "empty-input" }),
      dryRun: false
    }));

    const unknown = await callRouter(router, {
      platform,
      method: "GET",
      path: "/api/tool-management/v1/does-not-exist"
    });
    expect(unknown.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(unknown.response, 404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "tool_management_route_not_found",
        message: "Tool management route not found.",
        details: { path: "/does-not-exist" }
      }
    });
  });
});
