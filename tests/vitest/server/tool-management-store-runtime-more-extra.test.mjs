import fs from "node:fs/promises";
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
import {
  createToolCatalog,
  createToolCatalogRegistry
} from "../../../server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";
import {
  createToolManagementStore
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

function createPlatform(overrides = {}) {
  const platform = {
    catalog: vi.fn(() => ({ schemaVersion: "v0.0.1:schema:definition-1", catalog: true })),
    registry: {
      getTool: vi.fn(() => ({ id: "tool.alpha" })),
      getToolByOperationId: vi.fn(() => ({ id: "tool.alpha" })),
      listToolsets: vi.fn(() => [{ id: "toolset-1" }]),
      resolveToolset: vi.fn((payload) => ({ resolved: true, payload })),
      listProfiles: vi.fn(() => [{ id: "profile-1" }])
    },
    runtime: {
      executeTool: vi.fn(async () => ({
        status: 200,
        payload: { schemaVersion: "v0.0.1:schema:definition-1", result: { ok: true } }
      })),
      resumePendingOperation: vi.fn(async () => ({
        status: 200,
        payload: { schemaVersion: "v0.0.1:schema:definition-1", status: "completed" }
      }))
    },
    store: {
      listGrants: vi.fn(() => [{ id: "grant-1" }]),
      createGrant: vi.fn(async (payload) => ({
        grant: { id: "grant-new", ...payload },
        token: "token-new"
      })),
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

function createRuntimeFixture(overrides = {}) {
  const operation = {
    id: "knowledge.search",
    label: "Knowledge search",
    http: {
      method: "POST",
      path: "/api/knowledge/search"
    },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" }
      }
    },
    safety: {
      approvalScope: "tool:approve"
    }
  };

  const grant = {
    id: "grant-1",
    label: "Grant 1",
    scopes: ["knowledge:read"],
    capabilities: []
  };

  const tool = {
    id: "pact.agentLibrary.search",
    operationId: operation.id,
    version: "1.0.0",
    toolsets: ["pact.agentLibrary.read"],
    requiredScopes: ["knowledge:read"],
    risk: "read_only",
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
      context: entry.context,
      sourceIp: entry.sourceIp
    })),
    getPendingOperation: vi.fn((pendingOperationId) => (pendingOperationId === "pending-1"
      ? {
          pendingOperationId,
          traceId: "trace-request",
          toolId: tool.id,
          grantId: grant.id,
          profileId: "",
          risk: tool.risk,
          status: "pending",
          originalInput: { query: "alpha" },
          context: { transport: "mcp" },
          sourceIp: "127.0.0.1"
        }
      : null)),
    resolvePendingOperation: vi.fn((entry) => ({
      pendingOperationId: entry.pendingOperationId,
      status: entry.resolution,
      resolvedBy: entry.resolvedBy,
      resolvedAt: "2026-06-05T00:00:00.000Z",
      errorCode: entry.errorCode || "",
      resumedToolExecutionId: entry.resumedToolExecutionId || ""
    })),
    getRawGrant: vi.fn(() => grant)
  };
  Object.assign(store, overrides.store || {});

  const registry = {
    getTool: vi.fn((toolId) => (toolId === tool.id ? tool : null)),
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

function createStore(userDataPath) {
  return createToolManagementStore({
    userDataPath,
    capabilityKeyProvider: {},
    capabilityBindingGuard: false
  });
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
  dispatchOperationMock.mockClear();
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
  traceContextFromRequestMock.mockClear();
});

describe("tool-management store malformed persistence", () => {
  it("loads corrupted persisted grant rows without throwing and preserves credential metadata", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      let storeClosed = false;
      try {
        const { grant } = await store.createGrant({
          label: "Persisted Grant",
          scopes: "knowledge:read",
          metadata: {
            note: "keep-me",
            credentialProtocol: "v0.0.1:risk-control:opaque-capability-key-1",
            credentialId: "grant-legacy",
            capabilitySetHash: "hash-1",
            capabilityCount: 2,
            runtimeLookupGeneration: 7,
            credentialBindingProtocol: "v0.0.1:risk-control:capability-binding-guard-1",
            credentialBindingStrength: "strict",
            credentialBindingRequiredUser: true,
            credentialBindingRequiredAgent: false,
            credentialIssuedAt: "2026-01-01T00:00:00.000Z",
            credentialExpiresAt: "2026-12-31T23:59:59.999Z"
          }
        });

        store.db.prepare(`
          UPDATE tool_grants
          SET toolsets_json = ?, tool_allow_json = ?, tool_deny_json = ?,
              scopes_json = ?, rate_limit_json = ?, allowed_origins_json = ?,
              allowed_cidrs_json = ?, metadata_json = ?, token_hash = ?, enabled = ?
          WHERE id = ?
        `).run(
          "[broken",
          "broken",
          "broken",
          "broken",
          "{broken",
          "broken",
          "broken",
          JSON.stringify({
            note: "keep-me",
            credentialProtocol: "v0.0.1:risk-control:opaque-capability-key-1",
            credentialId: "grant-legacy",
            capabilitySetHash: "hash-1",
            capabilityCount: 2,
            runtimeLookupGeneration: 7,
            credentialBindingProtocol: "v0.0.1:risk-control:capability-binding-guard-1",
            credentialBindingStrength: "strict",
            credentialBindingRequiredUser: true,
            credentialBindingRequiredAgent: false,
            credentialIssuedAt: "2026-01-01T00:00:00.000Z",
            credentialExpiresAt: "2026-12-31T23:59:59.999Z",
            capabilities: ["cap:should-be-redacted"],
            capabilityIds: ["cap:also-redacted"],
            permissions: ["grant:read"]
          }),
          "",
          0,
          grant.id
        );

        store.close();
        storeClosed = true;

        const reopened = createStore(userDataPath);
        try {
          const loaded = reopened.getGrant(grant.id);
          expect(loaded).toMatchObject({
            id: grant.id,
            label: "Persisted Grant",
            enabled: false,
            toolsets: [],
            toolAllow: [],
            toolDeny: [],
            scopes: [],
            rateLimit: {},
            allowedOrigins: [],
            allowedCidrs: [],
            capabilities: [],
            hasToken: false
          });
          expect(loaded.metadata).toMatchObject({
            note: "keep-me",
            credentialProtocol: "v0.0.1:risk-control:opaque-capability-key-1",
            credentialId: "grant-legacy",
            capabilitySetHash: "hash-1",
            capabilityCount: 2,
            runtimeLookupGeneration: 7,
            credentialBindingProtocol: "v0.0.1:risk-control:capability-binding-guard-1",
            credentialBindingStrength: "strict",
            credentialBindingRequiredUser: true,
            credentialBindingRequiredAgent: false,
            credentialIssuedAt: "2026-01-01T00:00:00.000Z",
            credentialExpiresAt: "2026-12-31T23:59:59.999Z"
          });
          expect(loaded.metadata).not.toHaveProperty("capabilities");
          expect(loaded.metadata).not.toHaveProperty("capabilityIds");
          expect(loaded.metadata).not.toHaveProperty("permissions");
          expect(loaded.credential).toMatchObject({
            protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
            credentialId: "grant-legacy",
            capabilitySetHash: "hash-1",
            capabilityCount: 2,
            runtimeLookupGeneration: 7,
            bindingProtocol: "v0.0.1:risk-control:capability-binding-guard-1",
            bindingStrength: "strict",
            bindingRequiredUser: true,
            bindingRequiredAgent: false,
            issuedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-12-31T23:59:59.999Z"
          });
          expect(reopened.listGrants({ includeRevoked: true })).toHaveLength(1);
          expect(reopened.getGrant("missing-grant")).toBeNull();
        } finally {
          reopened.close();
        }
      } finally {
        if (!storeClosed) {
          store.close();
        }
      }
    });
  });

  it("keeps CRUD edge cases safe for missing ids", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        expect(store.updateGrant("missing-grant", { label: "Nope" })).toBeNull();
        expect(await store.rotateGrantToken("missing-grant")).toBeNull();
        expect(await store.revokeGrant("missing-grant", "not-found")).toBeNull();
        expect(store.deleteGrant("missing-grant")).toBe(false);
      } finally {
        store.close();
      }
    });
  });
});

describe("tool-management catalog filtering", () => {
  it("filters known toolsets/scopes and ignores unknown ids", () => {
    const operations = [
      {
        id: "system.health",
        label: "System health",
        http: { method: "GET", path: "/api/system/health" },
        rpc: { method: "system.health" }
      },
      {
        id: "jobs.list",
        label: "Jobs list",
        http: { method: "GET", path: "/api/jobs" },
        rpc: { method: "jobs.list" }
      },
      {
        id: "knowledge.search",
        label: "Knowledge search",
        http: { method: "POST", path: "/api/knowledge/search" },
        rpc: { method: "knowledge.search" }
      }
    ];
    const catalog = createToolCatalog({
      operations,
      activeFeatureIds: ["agent-exploration"]
    });
    const registry = createToolCatalogRegistry({
      operations,
      activeFeatureIds: ["agent-exploration"]
    });

    expect(catalog.tools.some((tool) => tool.id === "agent-exploration.keyword_search")).toBe(true);
    expect(catalog.tools.some((tool) => tool.id === "pact.runtime.info")).toBe(false);

    const jobsTool = registry.getToolByOperationId("jobs.list");
    const knowledgeTool = registry.getToolByOperationId("knowledge.search");

    expect(jobsTool).toMatchObject({
      id: expect.any(String),
      toolsets: ["pact.jobs.read"],
      requiredScopes: ["jobs:read"],
      status: "active"
    });
    expect(knowledgeTool).toMatchObject({
      id: expect.any(String),
      toolsets: ["pact.agentLibrary.read"],
      requiredScopes: ["knowledge:read"],
      status: "active"
    });
    expect(registry.getTool("missing-tool-id")).toBeNull();
    expect(registry.getToolByOperationId("missing-operation-id")).toBeNull();
    expect(registry.listTools({ toolset: "missing.toolset" })).toEqual([]);
    expect(registry.listTools({ scope: "missing:scope" })).toEqual([]);
    expect(registry.listTools({ owner: "missing-owner" })).toEqual([]);

    const filtered = registry.listTools({
      toolset: "pact.jobs.read",
      scope: "jobs:read",
      risk: "read_only",
      owner: "pact"
    });
    expect(filtered.map((tool) => tool.id)).toContain(jobsTool.id);
    expect(filtered.map((tool) => tool.id)).not.toContain(knowledgeTool.id);

    const resolved = registry.resolveToolset({
      toolsets: ["pact.jobs.read", "missing.toolset"],
      scopes: ["jobs:read", "knowledge:read", "missing:scope"],
      toolAllow: [jobsTool.id, knowledgeTool.id],
      toolDeny: [knowledgeTool.id]
    });
    expect(resolved.toolsets).toEqual(expect.arrayContaining(["pact.jobs.read", "missing.toolset"]));
    expect(resolved.toolIds).toEqual([jobsTool.id]);
    expect(resolved.requiredScopes).toEqual(expect.arrayContaining(["jobs:read", "knowledge:read"]));
    expect(resolved.maxRisk).toBe("read_only");
  });
});

describe("tool-management runtime and HTTP mappings", () => {
  it("covers authorization denial, validation, pending approval, and resume paths", async () => {
    const deniedFixture = createRuntimeFixture({
      store: {
        authorizeRequest: vi.fn(async () => ({
          ok: false,
          status: 403,
          error: "grant disabled",
          reasonCode: "grant_disabled",
          missingScopes: ["knowledge:read"],
          missingCapabilities: []
        }))
      }
    });

    const denied = await deniedFixture.runtime.executeTool({
      toolId: deniedFixture.tool.id,
      input: { query: "alpha" },
      request: createRequest()
    });
    expect(denied).toMatchObject({
      ok: false,
      status: 403,
      payload: {
        error: {
          code: "grant_disabled"
        }
      }
    });

    const missingToolFixture = createRuntimeFixture({
      registry: {
        getTool: vi.fn(() => null)
      }
    });
    const missingTool = await missingToolFixture.runtime.executeTool({
      toolId: "missing.tool",
      input: { query: "alpha" },
      request: createRequest()
    });
    expect(missingTool).toMatchObject({
      ok: false,
      status: 404,
      payload: {
        error: {
          code: "unknown_tool"
        }
      }
    });

    const missingOperationFixture = createRuntimeFixture({
      registry: {
        getTool: vi.fn(() => ({
          ...deniedFixture.tool,
          id: "tool.with-missing-operation",
          operationId: "missing.operation"
        }))
      }
    });
    const missingOperation = await missingOperationFixture.runtime.executeTool({
      toolId: "tool.with-missing-operation",
      input: { query: "alpha" },
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

    const validInputFixture = createRuntimeFixture();
    const invalidInput = await validInputFixture.runtime.executeTool({
      toolId: validInputFixture.tool.id,
      input: { query: 123 },
      request: createRequest()
    });
    expect(invalidInput).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_input"
        }
      }
    });

    const pendingFixture = createRuntimeFixture({
      tool: {
        ...deniedFixture.tool,
        requiresApproval: true,
        approvalScope: "tool:approve"
      }
    });
    const pending = await pendingFixture.runtime.executeTool({
      toolId: pendingFixture.tool.id,
      input: { query: "alpha" },
      request: createRequest({ headers: { "user-agent": "unit-test" } }),
      context: { transport: "mcp" }
    });
    expect(pending).toMatchObject({
      ok: true,
      status: 202,
      payload: {
        status: "pending_approval",
        pendingOperation: {
          pendingOperationId: "pending-1",
          status: "pending"
        }
      }
    });
    expect(pendingFixture.store.createPendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "tool_approval_required",
      originalInput: { query: "alpha" }
    }));

    const invalidResolution = await pendingFixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-1",
      resolution: "invalid",
      request: createRequest()
    });
    expect(invalidResolution).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_pending_operation_resolution"
        }
      }
    });

    pendingFixture.store.getPendingOperation.mockReturnValueOnce({
      pendingOperationId: "pending-2",
      traceId: "trace-request",
      toolId: pendingFixture.tool.id,
      grantId: pendingFixture.grant.id,
      profileId: "",
      risk: pendingFixture.tool.risk,
      status: "rejected",
      originalInput: { query: "alpha" },
      context: { transport: "mcp" },
      sourceIp: "127.0.0.1"
    });
    const alreadyResolved = await pendingFixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-2",
      resolution: "approved",
      request: createRequest()
    });
    expect(alreadyResolved).toMatchObject({
      ok: false,
      status: 409,
      payload: {
        error: {
          code: "pending_operation_not_pending"
        }
      }
    });

    pendingFixture.store.getPendingOperation.mockReturnValueOnce({
      pendingOperationId: "pending-3",
      traceId: "trace-request",
      toolId: pendingFixture.tool.id,
      grantId: pendingFixture.grant.id,
      profileId: "",
      risk: pendingFixture.tool.risk,
      status: "pending",
      originalInput: { query: "alpha" },
      context: { transport: "mcp" },
      sourceIp: "127.0.0.1"
    });
    pendingFixture.store.getRawGrant.mockReturnValueOnce({
      ...pendingFixture.grant,
      enabled: false,
      revokedAt: "2026-06-05T00:00:00.000Z"
    });
    const grantUnavailable = await pendingFixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-3",
      resolution: "approved",
      request: createRequest()
    });
    expect(grantUnavailable).toMatchObject({
      ok: false,
      status: 409,
      payload: {
        error: {
          code: "pending_operation_grant_unavailable"
        }
      }
    });

    pendingFixture.store.getPendingOperation.mockReturnValueOnce({
      pendingOperationId: "pending-4",
      traceId: "trace-request",
      toolId: pendingFixture.tool.id,
      grantId: pendingFixture.grant.id,
      profileId: "",
      risk: pendingFixture.tool.risk,
      status: "pending",
      originalInput: { query: "alpha" },
      context: { transport: "mcp" },
      sourceIp: "127.0.0.1"
    });
    pendingFixture.store.getRawGrant.mockReturnValueOnce(pendingFixture.grant);
    const approved = await pendingFixture.runtime.resumePendingOperation({
      pendingOperationId: "pending-4",
      resolution: "approved",
      request: createRequest({ headers: { "user-agent": "unit-test" } }),
      resolvedBy: "console",
      reason: "approved"
    });
    expect(approved).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        schemaVersion: "v0.0.1:schema:definition-1",
        status: "ok",
        pendingOperation: {
          pendingOperationId: "pending-4",
          status: "completed"
        }
      }
    });
    expect(dispatchOperationMock).toHaveBeenCalled();
    expect(pendingFixture.store.resolvePendingOperation).toHaveBeenCalledWith(expect.objectContaining({
      pendingOperationId: "pending-4",
      resolution: "completed"
    }));
  });

  it("maps router errors for missing grants and invalid pending-operation resolution", async () => {
    const platform = createPlatform({
      store: {
        rotateGrantToken: vi.fn(async () => null)
      },
      runtime: {
        resumePendingOperation: vi.fn(async () => ({
          status: 400,
          payload: {
            schemaVersion: "v0.0.1:schema:definition-1",
            error: {
              code: "invalid_pending_operation_resolution",
              message: "Pending operation resolution must be approved or rejected."
            }
          }
        }))
      }
    });
    const router = createToolManagementHttpRouter({
      platform,
      logger: getRuntimeLoggerMock()
    });

    const missingGrant = await router.handleToolManagementHttpRequest({
      request: createRequest({ headers: { "x-pact-safety-confirm": "true" } }),
      response: createResponse(),
      requestBody: Buffer.from("{}", "utf8"),
      url: createUrl("/api/tool-management/v1/grants/missing-grant/rotate"),
      method: "POST"
    });
    expect(missingGrant).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404
    }), 404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "grant_not_found",
        message: "Grant not found."
      }
    });

    sendJsonMock.mockClear();

    const invalidResolutionResponse = createResponse();
    const invalidResolution = await router.handleToolManagementHttpRequest({
      request: createRequest({ headers: { "x-pact-safety-confirm": "true" } }),
      response: invalidResolutionResponse,
      requestBody: Buffer.from(JSON.stringify({ resolution: "maybe" }), "utf8"),
      url: createUrl("/api/tool-management/v1/pending-operations/pending-1/resolve"),
      method: "POST"
    });
    expect(invalidResolution).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(invalidResolutionResponse, 400, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "invalid_pending_operation_resolution",
        message: "Pending operation resolution must be approved or rejected."
      }
    });
  });
});
