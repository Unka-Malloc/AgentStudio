import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
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
  traceId: "trace-tool-management-core-final-extra-2"
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
      metricsSummary: vi.fn(() => ({ schemaVersion: 1 })),
      metricsExport: vi.fn(() => ({ schemaVersion: 1 })),
      metricsHealth: vi.fn(() => ({ schemaVersion: 1 })),
      metricsPrometheus: vi.fn(() => "metric"),
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
  rawRequestBody = null,
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
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-final-extra-2-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function createCapabilityProvider() {
  return {
    issue: vi.fn(async ({ credentialId, capabilities, expiresAt }) => ({
      capabilityKey: `ock_${credentialId}`,
      credentialId,
      protocolVersion: "pact.opaque-capability-key.v1",
      capabilitySetHash: `hash_${capabilities.length}`,
      capabilityCount: capabilities.length,
      runtimeLookupGeneration: 1,
      expiresAt
    })),
    verify: vi.fn(async () => ({
      ok: false,
      reasonCode: "missing_capabilities",
      missingCapabilities: [toolExecuteCapabilityId("pact.jobs.read")]
    })),
    invalidateCredential: vi.fn(async () => undefined)
  };
}

function createBindingGuard() {
  return {
    bindCapabilityKey: vi.fn(async () => ({
      bindingId: "binding-1",
      protocolVersion: "pact.capability-binding-guard.v1",
      bindingStrength: "standard",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    })),
    verifyCapabilityKeyBinding: vi.fn(async () => ({ ok: true })),
    invalidateCapabilityKeyBinding: vi.fn(async () => undefined)
  };
}

function createRuntimeFixture(overrides = {}) {
  const operation = {
    id: "operation.alpha",
    http: {
      method: "POST",
      path: "/tool/:id"
    },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    },
    safety: { approvalScope: "tool:approve" },
    ...overrides.operation
  };
  const operations = overrides.operations || [operation];
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
      decisionId: "policy-final-extra-2",
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
    operations,
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

describe("tool-management core final extra 2 coverage", () => {
  it("normalizes grant metadata, strips unsafe metadata fields, and rejects unknown capabilities", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: false,
        capabilityBindingGuard: false
      });
      try {
        await expect(store.createGrant({
          label: "Bad Grant",
          metadata: {
            capabilities: ["unknown.capability"]
          }
        })).rejects.toThrow("Unknown tool grant capability permission");

        const grant = await store.createGrant({
          label: "Normalized Grant",
          scopes: "knowledge:read, invalid:scope",
          toolsets: "pact.jobs.read, pact.jobs.read",
          rateLimit: { per_minute: "12" },
          metadata: {
            capabilities: [toolExecuteCapabilityId("system.health")],
            capabilityIds: [toolExecuteCapabilityId("system.health")],
            permissions: ["admin"],
            agent_id: "agent-1",
            profile_id: "profile-1",
            bound_user_id: "user-1",
            team_ids: ["team-a", "team-a", "team-b"]
          }
        });

        expect(grant.token).toMatch(/^ock_/);
        const rawGrant = store.getRawGrant(grant.grant.id);
        expect(rawGrant.rateLimit).toEqual({ perMinute: 12 });
        expect(rawGrant.toolsets).toEqual(["pact.jobs.read"]);
        expect(rawGrant.scopes).toEqual(["knowledge:read"]);
        expect(rawGrant.metadata).toMatchObject({
          agent_id: "agent-1",
          profile_id: "profile-1",
          bound_user_id: "user-1",
          team_ids: ["team-a", "team-a", "team-b"]
        });
        expect(rawGrant.metadata).not.toHaveProperty("capabilities");
        expect(rawGrant.metadata).not.toHaveProperty("capabilityIds");
        expect(rawGrant.metadata).not.toHaveProperty("permissions");
      } finally {
        store.close();
      }
    });
  });

  it("maps opaque grant authorization failures for missing capabilities and unavailable capability kernels", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const capabilityProvider = createCapabilityProvider();
      const issuingStore = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: capabilityProvider,
        capabilityBindingGuard: createBindingGuard()
      });
      let token = "";
      try {
        const created = await issuingStore.createGrant({
          label: "Opaque Grant",
          metadata: {
            capabilityIds: [toolExecuteCapabilityId("system.health")]
          }
        });
        token = created.token;
      } finally {
        issuingStore.close();
      }

      const missingCapabilityStore = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: capabilityProvider,
        capabilityBindingGuard: false
      });
      try {
        const missingCapabilities = await missingCapabilityStore.authorizeRequest({
          request: {
            headers: {
              authorization: `Bearer ${token}`
            }
          },
          tool: { id: "pact.jobs.read" }
        });
        expect(missingCapabilities).toMatchObject({
          ok: false,
          status: 403,
          reasonCode: "missing_capabilities",
          missingCapabilities: [toolExecuteCapabilityId("pact.jobs.read")]
        });
      } finally {
        missingCapabilityStore.close();
      }

      const unavailableKernelStore = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {
          issue: capabilityProvider.issue,
          invalidateCredential: capabilityProvider.invalidateCredential
        },
        capabilityBindingGuard: false
      });
      try {
        const unavailableKernel = await unavailableKernelStore.authorizeRequest({
          request: {
            headers: {
              authorization: `Bearer ${token}`
            }
          },
          tool: { id: "pact.jobs.read" }
        });
        expect(unavailableKernel).toMatchObject({
          ok: false,
          status: 503,
          reasonCode: "capability_kernel_unavailable",
          missingCapabilities: [toolExecuteCapabilityId("pact.jobs.read")]
        });
      } finally {
        unavailableKernelStore.close();
      }
    });
  });

  it("maps HTTP authorization failures and unknown catalog tools", async () => {
    const forbiddenRouter = createToolManagementHttpRouter({
      platform: createPlatform(),
      securityPermissions: {
        authorizeOperation: vi.fn(async () => ({
          ok: false,
          status: 401,
          error: "login required",
          bootstrap: { source: "test" }
        }))
      },
      logger: getRuntimeLoggerMock()
    });

    const forbidden = await callRouter(forbiddenRouter, {
      method: "GET",
      path: "/api/tool-management/v1/catalog"
    });
    expect(forbidden.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(forbidden.response, 401, {
      schemaVersion: 1,
      error: {
        code: "console_unauthenticated",
        message: "login required",
        details: {
          bootstrap: { source: "test" }
        }
      }
    });

    const unknownToolRouter = createToolManagementHttpRouter({
      platform: createPlatform({
        registry: {
          getTool: vi.fn(() => null)
        }
      }),
      securityPermissions: {
        authorizeOperation: vi.fn(async () => ({
          ok: true,
          session: { user: { userId: "user-1", roleId: "role-1" } }
        }))
      },
      logger: getRuntimeLoggerMock()
    });

    const unknownTool = await callRouter(unknownToolRouter, {
      method: "GET",
      path: "/api/tool-management/v1/catalog/tool-does-not-exist"
    });
    expect(unknownTool.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(unknownTool.response, 404, {
      schemaVersion: 1,
        error: {
        code: "unknown_tool",
        message: "Tool is not registered.",
        details: {
          toolId: "tool-does-not-exist"
        }
      }
    });
  });

  it("returns a clear HTTP error when pending-operation resolution runtime is unavailable", async () => {
    const router = createToolManagementHttpRouter({
      platform: createPlatform({
        runtime: {
          resumePendingOperation: undefined
        }
      }),
      securityPermissions: {
        authorizeOperation: vi.fn(async () => ({
          ok: true,
          session: { user: { userId: "user-1", roleId: "role-1" } }
        }))
      },
      logger: getRuntimeLoggerMock()
    });

    const result = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/pending-operations/pending-123/resolve",
      body: { resolution: "approved" },
      headers: {
        "x-pact-safety-confirm": "true"
      }
    });

    expect(result.handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(result.response, 503, {
      schemaVersion: 1,
      error: {
        code: "pending_operation_runtime_unavailable",
        message: "Pending operation runtime is unavailable."
      }
    });
  });

  it("distinguishes unknown tools from missing operations in the runtime", async () => {
    const { runtime } = createRuntimeFixture({
      operations: [],
      registry: {
        getTool: vi.fn((toolId) => (toolId === "pact.jobs.read"
          ? {
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
            }
          : null))
      }
    });

    const unknown = await runtime.executeTool({
      toolId: "pact.missing.tool",
      request: createRequest()
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

    const missingOperation = await runtime.executeTool({
      toolId: "pact.jobs.read",
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
  });

  it("filters catalog features and resolves toolsets from scope aliases, allow, deny, and defaults", () => {
    const catalog = createToolCatalog({
      activeFeatureIds: ["agent-exploration"],
      operations: [
        {
          id: "jobs.list",
          label: "Jobs list",
          http: { method: "get", path: "/jobs" }
        }
      ]
    });

    expect(catalog.tools.some((tool) => tool.id === "agent-exploration.knowledge_skill_search")).toBe(true);
    expect(catalog.tools.some((tool) => tool.id === "maintenance-agent.system.health")).toBe(false);

    const registry = createToolCatalogRegistry({
      activeFeatureIds: ["agent-exploration"],
      operations: [
        {
          id: "jobs.list",
          label: "Jobs list",
          http: { method: "get", path: "/jobs" }
        }
      ]
    });

    const defaultResolution = registry.resolveToolset({});
    expect(defaultResolution.toolsets).toEqual(expect.arrayContaining([
      "pact.jobs.read",
      "pact.storage.read"
    ]));
    expect(defaultResolution.tools.map((tool) => tool.id)).toEqual(expect.arrayContaining([
      "pact.jobs.list"
    ]));

    const scopedResolution = registry.resolveToolset({
      scopeIds: ["jobs:read"],
      toolAllow: ["pact.jobs.list"],
      toolDeny: ["pact.jobs.list"]
    });
    expect(scopedResolution.toolsets).toEqual(expect.arrayContaining(["pact.jobs.read"]));
    expect(scopedResolution.tools).toHaveLength(0);
    expect(scopedResolution.requiredScopes).toEqual(expect.arrayContaining(["jobs:read"]));
  });
});
