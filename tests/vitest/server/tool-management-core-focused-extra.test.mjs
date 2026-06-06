import fs from "node:fs/promises";
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
  traceId: "trace-tool-management-focused"
})));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  dispatchOperation: dispatchOperationMock,
  getRuntimeLogger: getRuntimeLoggerMock,
  summarizeError: summarizeErrorMock,
  summarizeForLog: summarizeForLogMock,
  traceContextFromRequest: traceContextFromRequestMock
}));

import { createToolExecutionRuntime } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs";
import { createToolManagementStore } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";

function createRequest({ headers = {}, id = "req-1" } = {}) {
  return {
    __pactRequestId: id,
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
}

async function withTempUserDataPath(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-focused-extra-"));
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
    id: "tool.alpha",
    operationId: operation.id,
    version: "1.0.0",
    toolsets: ["toolset-1"],
    requiredScopes: ["tool:run"],
    risk: "low",
    timeoutMs: 1_000,
    maxResultBytes: 1_024,
    concurrencySafe: true,
    requiresApproval: false,
    approvalScope: "",
    ...overrides.tool
  };

  const store = {
    authorizeRequest: vi.fn(async () => ({
      ok: true,
      grant: { id: "grant-1", label: "Grant 1", scopes: ["tool:run"] },
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
      decisionId: "policy-focused",
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
    operations: [operation],
    logger: getRuntimeLoggerMock(),
    ...overrides.runtimeOptions
  });

  return { runtime, store, registry, tool, operation, policyEngine };
}

beforeEach(() => {
  dispatchOperationMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  getRuntimeLoggerMock.mockClear();
  traceContextFromRequestMock.mockClear();
});

describe("tool-management core focused store coverage", () => {
  it("persists grants, deletes rows, and normalizes catalog and pending-operation boundaries", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false
      });
      try {
        expect(store.saveCatalogSnapshot({})).toBeNull();
        expect(store.saveCatalogSnapshot({
          fingerprint: "catalog:focused",
          tools: [{ id: "pact.jobs.read" }],
          metadata: { source: "focused-test" }
        })).toEqual({ fingerprint: "catalog:focused" });
        expect(store.saveCatalogSnapshot({
          fingerprint: "catalog:focused",
          tools: [{ id: "pact.jobs.write" }],
          metadata: { source: "overwritten" }
        })).toEqual({ fingerprint: "catalog:focused" });

        const catalogRows = store.db.prepare(`
          SELECT fingerprint, catalog_json
          FROM tool_catalog_snapshots
          WHERE fingerprint = ?
        `).all("catalog:focused");
        expect(catalogRows).toHaveLength(1);
        expect(JSON.parse(catalogRows[0].catalog_json)).toMatchObject({
          fingerprint: "catalog:focused",
          metadata: { source: "focused-test" }
        });

        const firstGrant = await store.createGrant({
          label: "Persisted Grant",
          scopes: "knowledge:read"
        });
        const deletedGrant = await store.createGrant({
          label: "Deleted Grant",
          scopes: "workspace:read"
        });

        expect(store.deleteGrant(deletedGrant.grant.id)).toBe(true);
        expect(store.deleteGrant("missing-grant-id")).toBe(false);
        expect(store.getGrant(deletedGrant.grant.id)).toBeNull();
        expect(store.listGrants().map((grant) => grant.id)).toEqual([firstGrant.grant.id]);
        expect(store.listGrants({ includeRevoked: true }).map((grant) => grant.id)).toEqual([firstGrant.grant.id]);

        const expiredPending = store.createPendingOperation({
          pendingOperationId: "pending-expired",
          toolId: "tool.alpha",
          toolVersion: "1.0.0",
          operationId: "operation.alpha",
          grantId: firstGrant.grant.id,
          originalInput: { name: "expired" },
          createdAt: "2000-01-02T00:00:00.000Z",
          expiresAt: "2000-01-01T00:00:00.000Z"
        });
        const activePending = store.createPendingOperation({
          pendingOperationId: "pending-active",
          toolId: "tool.alpha",
          toolVersion: "1.0.0",
          operationId: "operation.alpha",
          grantId: firstGrant.grant.id,
          originalInput: { name: "active" },
          createdAt: "2026-06-05T00:00:01.000Z",
          expiresAt: "9999-12-31T23:59:59.999Z"
        });

        expect(store.getPendingOperation(expiredPending.pendingOperationId)).toMatchObject({
          pendingOperationId: "pending-expired",
          status: "expired"
        });
        expect(store.getPendingOperation(activePending.pendingOperationId)).not.toHaveProperty("originalInput");
        expect(store.getPendingOperation(activePending.pendingOperationId, { includeOriginalInput: true })).toMatchObject({
          pendingOperationId: "pending-active",
          originalInput: { name: "active" }
        });

        expect(store.listPendingOperations({ status: "unexpected", limit: -5 })).toHaveLength(1);
        expect(store.listPendingOperations({ status: "all", limit: 99_999 })).toHaveLength(2);
        expect(() => store.resolvePendingOperation({
          pendingOperationId: activePending.pendingOperationId,
          resolution: "pending"
        })).toThrow("Invalid pending operation resolution status.");

        const approved = store.resolvePendingOperation({
          pendingOperationId: activePending.pendingOperationId,
          resolution: "approved",
          resolvedBy: "reviewer",
          reason: "allowed"
        });
        expect(approved).toMatchObject({
          pendingOperationId: "pending-active",
          status: "approved",
          resolvedBy: "reviewer",
          resolutionReason: "allowed"
        });

        const completed = store.resolvePendingOperation({
          pendingOperationId: activePending.pendingOperationId,
          resolution: "completed",
          resolvedBy: "reviewer",
          reason: "done",
          resumedToolExecutionId: "tool-exec-1"
        });
        expect(completed).toMatchObject({
          pendingOperationId: "pending-active",
          status: "completed",
          resumedToolExecutionId: "tool-exec-1",
          resolutionReason: "done"
        });
      } finally {
        store.close();
      }
    });
  });
});

describe("tool-management core focused runtime coverage", () => {
  it("refreshes operations and moves from missing operation to a successful dry run", async () => {
    const fixture = createRuntimeFixture({
      runtimeOptions: {
        operations: []
      }
    });

    const missing = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest()
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
    expect(fixture.store.authorizeRequest).not.toHaveBeenCalled();

    expect(fixture.runtime.refreshOperations([fixture.operation])).toEqual({
      ok: true,
      operationCount: 1
    });

    const dryRun = await fixture.runtime.executeTool({
      toolId: fixture.tool.id,
      input: { name: "alpha" },
      request: createRequest(),
      dryRun: true
    });

    expect(dryRun).toMatchObject({
      ok: true,
      status: 200,
      payload: {
        status: "ok",
        result: {
          wouldExecute: true
        }
      }
    });
    expect(fixture.store.authorizeRequest).toHaveBeenCalledTimes(1);
  });

  it("returns unknown-tool, invalid-input, and timeout failures through executeTool", async () => {
    const unknownFixture = createRuntimeFixture({
      registry: {
        getTool: vi.fn(() => null)
      }
    });

    const unknown = await unknownFixture.runtime.executeTool({
      toolId: "tool.missing",
      input: { name: "alpha" },
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
    expect(unknownFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "unknown_tool"
    }));
    expect(unknownFixture.store.appendMetric).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      reasonCode: "unknown_tool"
    }));

    const invalidFixture = createRuntimeFixture();
    const invalid = await invalidFixture.runtime.executeTool({
      toolId: invalidFixture.tool.id,
      input: {},
      request: createRequest()
    });

    expect(invalid).toMatchObject({
      ok: false,
      status: 400,
      payload: {
        error: {
          code: "invalid_input"
        }
      }
    });
    expect(dispatchOperationMock).not.toHaveBeenCalled();
    expect(invalidFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      errorCode: "invalid_input"
    }));

    dispatchOperationMock.mockImplementationOnce(() => new Promise(() => {}));
    const timeoutFixture = createRuntimeFixture({
      tool: {
        timeoutMs: 5
      }
    });
    const timedOut = await timeoutFixture.runtime.executeTool({
      toolId: timeoutFixture.tool.id,
      input: { name: "alpha" },
      request: createRequest()
    });

    expect(timedOut).toMatchObject({
      ok: false,
      status: 500,
      payload: {
        error: {
          code: "tool_timeout"
        }
      }
    });
    expect(summarizeErrorMock).toHaveBeenCalled();
    expect(timeoutFixture.store.appendExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "tool_timeout"
    }));
  });
});
