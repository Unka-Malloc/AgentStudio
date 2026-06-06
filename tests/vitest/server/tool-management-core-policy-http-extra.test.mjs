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
import { createToolPolicyEngine } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/policy.mjs";

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
      getTool: vi.fn(() => ({ id: "tool.alpha" })),
      getToolByOperationId: vi.fn(() => ({ id: "tool.alpha" })),
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
      metricsSummary: vi.fn((payload) => ({ checked: true, payload })),
      metricsExport: vi.fn(() => ({ checked: true })),
      metricsHealth: vi.fn(() => ({ checked: true })),
      metricsPrometheus: vi.fn(() => "metric 1"),
      metricsStorageSummary: vi.fn(() => ({ checked: true })),
      pruneMetrics: vi.fn(() => ({ checked: true })),
      listPendingOperations: vi.fn(() => [])
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
  return { handled, request, response, requestBody };
}

beforeEach(() => {
  sendJsonMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
});

describe("tool-management core policy and HTTP extra coverage", () => {
  it("maps forbidden console responses, forwards policy preview payloads, and normalizes query aliases", async () => {
    const authorizeOperation = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: "missing console permission",
        bootstrap: { role: "admin" }
      })
      .mockResolvedValue({
        ok: true,
        session: { user: { userId: "user-1", roleId: "role-1" } }
      });
    const platform = createPlatform();
    const router = createToolManagementHttpRouter({
      platform,
      securityPermissions: { authorizeOperation },
      logger: getRuntimeLoggerMock()
    });

    const deniedPreview = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/policy/preview",
      body: {
        toolId: "tool.alpha",
        grantId: "grant-1",
        profileId: "profile-1",
        input: { message: "hello" },
        context: { source: "http" },
        dryRun: true
      }
    });

    expect(deniedPreview.handled).toBe(true);
    expect(authorizeOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "POST",
      operation: expect.objectContaining({
        id: "tool_management.http",
        requiredScopes: ["console:read"],
        skipCsrf: false
      })
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(deniedPreview.response, 403, {
      schemaVersion: 1,
      error: {
        code: "console_forbidden",
        message: "missing console permission",
        details: {
          bootstrap: { role: "admin" }
        }
      }
    });

    const preview = await callRouter(router, {
      method: "POST",
      path: "/api/tool-management/v1/policy/preview",
      body: {
        toolId: "tool.alpha",
        grantId: "grant-1",
        profileId: "profile-1",
        input: { message: "hello" },
        context: { source: "http" },
        dryRun: true
      }
    });

    expect(preview.handled).toBe(true);
    expect(platform.policyEngine.preview).toHaveBeenCalledWith({
      toolId: "tool.alpha",
      grantId: "grant-1",
      profileId: "profile-1",
      input: { message: "hello" },
      context: { source: "http" },
      dryRun: true
    });
    expect(sendJsonMock).toHaveBeenLastCalledWith(preview.response, 200, {
      schemaVersion: 1,
      decision: {
        effect: "allow",
        payload: {
          toolId: "tool.alpha",
          grantId: "grant-1",
          profileId: "profile-1",
          input: { message: "hello" },
          context: { source: "http" },
          dryRun: true
        }
      }
    });

    const summary = await callRouter(router, {
      method: "GET",
      path: "/api/tool-management/v1/metrics/summary?limit=7&since=2026-01-01T00%3A00%3A00.000Z&until=2026-01-02T00%3A00%3A00.000Z&tool-id=pact.jobs.read&grant-id=grant-1&profile-id=profile-1&route=%2Fjobs%2Frun&transport=http&status=ok&status-code=200&completion-status=completed&bucket-seconds=30"
    });

    expect(summary.handled).toBe(true);
    expect(authorizeOperation).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: "GET",
      operation: expect.objectContaining({
        requiredScopes: ["console:read"]
      })
    }));
    expect(platform.store.metricsSummary).toHaveBeenCalledWith({
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
    });
    expect(sendJsonMock).toHaveBeenLastCalledWith(summary.response, 200, {
      schemaVersion: 1,
      metrics: {
        checked: true,
        payload: {
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
        }
      }
    });
  });

  it("allows policy decisions, dedupes missing entries, and records fresh grant state", () => {
    const appendPolicyDecision = vi.fn();
    const securityPermissions = {
      evaluatePolicy: vi.fn(() => ({
        effect: "allow",
        allowed: true,
        reasonCode: "ok",
        redactedReason: "",
        missingScopes: [" scope:a ", "scope:b", "scope:a", "", null],
        missingToolsets: ["toolset:a", "toolset:a", " toolset:b "],
        evaluatedLayers: ["custom-layer", "platform_default"],
        createdAt: "2026-06-05T00:00:00.000Z"
      })),
      getGovernancePolicyRevision: vi.fn(() => ({
        protocolVersion: "pact.policy.v1",
        revision: 5,
        updatedAt: "2026-06-05T00:00:00.000Z"
      }))
    };
    const engine = createToolPolicyEngine({
      registry: {
        getTool: vi.fn(),
        listProfiles: vi.fn(() => [])
      },
      store: { appendPolicyDecision },
      securityPermissions
    });

    const decision = engine.evaluate({
      tool: { id: "tool.alpha" },
      grant: {
        id: "grant-1",
        policyRevision: 7
      },
      input: { alpha: true },
      context: { source: "unit-test" },
      traceId: "trace-1",
      toolExecutionId: "exec-1"
    });

    expect(decision).toMatchObject({
      effect: "allow",
      toolId: "tool.alpha",
      grantId: "grant-1",
      grantPolicyRevision: 7,
      grantPolicyState: "fresh",
      governancePolicyRevision: {
        protocolVersion: "pact.policy.v1",
        revision: 5
      },
      missingScopes: ["scope:a", "scope:b"],
      missingToolsets: [],
      traceId: "trace-1",
      toolExecutionId: "exec-1"
    });
    expect(decision.evaluatedLayers).toEqual(expect.arrayContaining([
      "custom-layer",
      "platform_default",
      "server_policy",
      "grant_policy",
      "session_task_policy",
      "runtime_safety_policy"
    ]));
    expect(appendPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({
      effect: "allow",
      missingScopes: ["scope:a", "scope:b"],
      missingToolsets: []
    }));
  });

  it("covers provider fallback denial and grant policy state boundaries", () => {
    const noProviderAppend = vi.fn();
    const noProviderEngine = createToolPolicyEngine({
      registry: {
        getTool: vi.fn(),
        listProfiles: vi.fn(() => [])
      },
      store: { appendPolicyDecision: noProviderAppend }
    });

    const noProviderDecision = noProviderEngine.evaluate({
      tool: { id: "tool.alpha" }
    });

    expect(noProviderDecision).toMatchObject({
      effect: "deny",
      reasonCode: "authorization_provider_unavailable",
      grantId: "",
      grantPolicyRevision: 0,
      grantPolicyState: "unversioned",
      governancePolicyRevision: null,
      missingScopes: [],
      missingToolsets: []
    });
    expect(noProviderAppend).toHaveBeenCalledTimes(1);

    const appendPolicyDecision = vi.fn();
    const securityPermissions = {
      evaluatePolicy: vi.fn(() => ({
        effect: "deny",
        reasonCode: "policy_denied",
        redactedReason: "Denied by policy.",
        missingScopes: ["scope:a", " scope:a "],
        missingToolsets: ["toolset:a", " toolset:a "],
        evaluatedLayers: ["server_policy"],
        createdAt: "2026-06-05T00:00:00.000Z"
      })),
      getGovernancePolicyRevision: vi.fn(() => ({
        protocolVersion: "pact.policy.v1",
        revision: 10,
        updatedAt: "2026-06-05T00:00:00.000Z"
      }))
    };
    const engine = createToolPolicyEngine({
      registry: {
        getTool: vi.fn(),
        listProfiles: vi.fn(() => [])
      },
      store: { appendPolicyDecision },
      securityPermissions
    });

    const noGrantDecision = engine.evaluate({
      tool: { id: "tool.alpha" }
    });
    const unversionedGrantDecision = engine.evaluate({
      tool: { id: "tool.alpha" },
      grant: {
        id: "grant-zero",
        metadata: {
          policy_revision: 0
        }
      }
    });
    const staleGrantDecision = engine.evaluate({
      tool: { id: "tool.alpha" },
      grant: {
        id: "grant-stale",
        policyRevision: 9
      }
    });

    expect(noGrantDecision).toMatchObject({
      effect: "deny",
      grantId: "",
      grantPolicyState: "no-grant",
      grantPolicyRevision: 0,
      governancePolicyRevision: {
        revision: 10
      },
      missingScopes: ["scope:a"],
      missingToolsets: ["toolset:a"]
    });
    expect(unversionedGrantDecision).toMatchObject({
      effect: "deny",
      grantId: "grant-zero",
      grantPolicyState: "grant-unversioned",
      grantPolicyRevision: 0
    });
    expect(staleGrantDecision).toMatchObject({
      effect: "deny",
      grantId: "grant-stale",
      grantPolicyState: "stale",
      grantPolicyRevision: 9
    });
    expect(appendPolicyDecision).toHaveBeenCalledTimes(3);
  });

  it("delegates through the strategy provider and resolves preview lookups", () => {
    const appendPolicyDecision = vi.fn();
    const registry = {
      getTool: vi.fn((toolId) => (toolId === "tool.lookup"
        ? { id: "tool.lookup" }
        : { id: toolId })),
      listProfiles: vi.fn(() => [{ id: "profile-1", label: "Profile 1" }])
    };
    const store = {
      appendPolicyDecision,
      getRawGrant: vi.fn((grantId) => (grantId === "grant-lookup"
        ? { id: "grant-lookup", policyRevision: 12 }
        : null))
    };
    const securityPermissions = {
      evaluatePolicy: vi.fn(() => ({
        effect: "allow",
        reasonCode: "ok",
        redactedReason: "",
        missingScopes: [" scope:1 ", "scope:1"],
        missingToolsets: [],
        evaluatedLayers: [],
        createdAt: "2026-06-05T00:00:00.000Z"
      })),
      getGovernancePolicyRevision: vi.fn(() => ({
        protocolVersion: "pact.policy.v1",
        revision: 11,
        updatedAt: "2026-06-05T00:00:00.000Z"
      }))
    };
    const strategyManagementProvider = {
      evaluateToolPolicy: vi.fn(({ baseEvaluate, registry: passedRegistry, store: passedStore, securityPermissions: passedSecurityPermissions, ...input }) => {
        expect(passedRegistry).toBe(registry);
        expect(passedStore).toBe(store);
        expect(passedSecurityPermissions).toBe(securityPermissions);
        return {
          ...baseEvaluate(input),
          viaStrategy: true
        };
      })
    };
    const engine = createToolPolicyEngine({
      registry,
      store,
      securityPermissions,
      strategyManagementProvider
    });

    const strategyDecision = engine.evaluate({
      tool: { id: "tool.strategy" },
      grant: { id: "grant-strategy", policyRevision: 11 },
      profile: { id: "profile-strategy" },
      input: { alpha: 1 },
      context: { source: "strategy" },
      dryRun: true,
      traceId: "trace-strategy",
      toolExecutionId: "exec-strategy"
    });

    expect(strategyManagementProvider.evaluateToolPolicy).toHaveBeenCalledTimes(1);
    expect(strategyDecision).toMatchObject({
      viaStrategy: true,
      toolId: "tool.strategy",
      grantId: "grant-strategy",
      grantPolicyRevision: 11,
      grantPolicyState: "fresh",
      missingScopes: ["scope:1"]
    });
    expect(appendPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "tool.strategy",
      grantId: "grant-strategy"
    }));

    const previewDecision = engine.preview({
      toolId: "tool.lookup",
      grantId: "grant-lookup",
      profileId: "profile-1",
      input: { mode: "dry" },
      context: { source: "preview" },
      dryRun: true
    });

    expect(registry.getTool).toHaveBeenCalledWith("tool.lookup");
    expect(store.getRawGrant).toHaveBeenCalledWith("grant-lookup");
    expect(registry.listProfiles).toHaveBeenCalledTimes(1);
    expect(previewDecision).toMatchObject({
      toolId: "tool.lookup",
      grantId: "grant-lookup",
      grantPolicyRevision: 12,
      grantPolicyState: "fresh",
      missingScopes: ["scope:1"]
    });
  });
});
