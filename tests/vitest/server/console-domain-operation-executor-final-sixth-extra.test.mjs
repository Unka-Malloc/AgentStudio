import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;

beforeAll(async () => {
  vi.resetModules();
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

function createAuthProvider() {
  const user = { userId: "u-1", username: "alice", roleId: "admin" };
  return {
    getConsoleSummary: vi.fn(() => ({ source: "console-summary" })),
    getSummary: vi.fn(() => ({ source: "summary" })),
    login: vi.fn(),
    logout: vi.fn(),
    audit: vi.fn(),
    roleList: vi.fn(() => [{ roleId: "admin" }]),
    listUsers: vi.fn(() => [user]),
    updateUser: vi.fn(),
    getOidcConfig: vi.fn(() => ({ enabled: false })),
    setOidcConfig: vi.fn((input) => input),
    listAudit: vi.fn(() => [{ auditId: "audit-1" }]),
    listSessions: vi.fn(() => [{ sessionId: "session-1" }]),
    rotateSession: vi.fn(() => ({
      ok: true,
      cookies: ["sid=rotated; HttpOnly"],
      csrfToken: "csrf-1",
      rotatedAt: "2026-06-05T00:00:00.000Z",
      session: { sessionId: "session-1", user }
    })),
    revokeSession: vi.fn(() => ({ ok: true, sessionId: "session-1" }))
  };
}

describe("console-domain executor coverage for the latest uncovered branches", () => {
  it("covers missing auth provider and audit export fallback branches", async () => {
    const authProvider = createAuthProvider();

    await expect(runOperation("auth.session", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "控制台认证模块不可用。" } });

    await expect(runOperation("auth.session", { context: { securityPermissions: authProvider } }))
      .resolves.toMatchObject({ status: 200, payload: { source: "console-summary" } });

    await expect(runOperation("auth.audit", { context: { securityPermissions: authProvider } }))
      .resolves.toMatchObject({ status: 200, payload: { items: [{ auditId: "audit-1" }] } });
    expect(authProvider.listAudit).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));

    await expect(runOperation("auth.audit.export", { context: { securityPermissions: authProvider } }))
      .resolves.toMatchObject({ status: 503, payload: { error: "系统审计导出接口不可用。" } });
  });

  it("covers strategy, knowledge, runtime, graph, and discovery fallback branches", async () => {
    const strategyManagementProvider = {
      describe: vi.fn(() => ({ ok: true })),
      evaluateWorkflowPolicy: vi.fn((input) => ({ kind: "workflow", input })),
      evaluateAgentPolicy: vi.fn((input) => ({ kind: "agent", input })),
      evaluateRoutePolicy: vi.fn((input) => ({ kind: "route", input })),
      evaluateToolPolicy: vi.fn((input) => ({ kind: "tool", input }))
    };

    await expect(runOperation("strategy.route_policy.evaluate", {
      input: { route: "mcp" },
      context: { strategyManagementProvider }
    })).resolves.toMatchObject({
      status: 200,
      payload: { kind: "route", input: { route: "mcp" } }
    });

    for (const operationId of [
      "knowledge.capabilities",
      "knowledge.export_docx",
      "knowledge.health",
      "knowledge.maintenance.get",
      "knowledge.maintenance.set",
      "knowledge.feedback",
      "knowledge.suggestions",
      "knowledge.suggestion_resolve",
      "knowledge.learning.jobs",
      "knowledge.learning.health"
    ]) {
      await expect(runOperation(operationId, { context: { runtime: { mounts: {} } } }))
        .resolves.toMatchObject({ status: 503 });
    }

    await expect(runOperation("knowledge.graph", { context: {} }))
      .resolves.toMatchObject({ status: 503 });

    await expect(runOperation("runtime.mounts", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("runtime.set_mounts", {
      context: { moduleManagement: { setMounts: vi.fn(async () => ({ ok: false, statusCode: 409, reason: "conflict" })) } }
    })).resolves.toMatchObject({ status: 409, payload: { ok: false, reason: "conflict" } });
    await expect(runOperation("runtime.reload_mounts", {
      context: { moduleManagement: { reloadMounts: vi.fn(async () => ({ ok: false, statusCode: 418, reason: "teapot" })) } }
    })).resolves.toMatchObject({ status: 418, payload: { ok: false, reason: "teapot" } });

    await expect(runOperation("discovery.check_in", {
      context: { storageProvider: {}, discoveryState: { serverId: "server-1" } }
    })).resolves.toMatchObject({ status: 503 });
    await expect(runOperation("discovery.clients", {
      context: { storageProvider: {}, discoveryState: { serverId: "server-1" } }
    })).resolves.toMatchObject({ status: 503 });
    await expect(runOperation("discovery.clients.migration", {
      input: { clientId: "client-1" },
      context: { storageProvider: {}, discoveryState: { serverId: "server-1" } }
    })).resolves.toMatchObject({ status: 503 });
  });

  it("routes workspace, context, and knowledge operations through session and workspace context fallback", async () => {
    const agentWorkspace = {
      getSessionContext: vi.fn((sessionId, access) => (
        sessionId === "session-1"
          ? {
              workspaceId: "ws-session",
              contextProfileId: "ctx-session",
              modelAlias: "model-session",
              toolGrantId: "grant-session",
              knowledgeSourceIds: ["source-session"],
              access
            }
          : null
      )),
      getWorkspaceContext: vi.fn((workspaceId, access) => (
        workspaceId === "ws-workspace"
          ? {
              workspaceId,
              contextProfileId: "ctx-workspace",
              modelAlias: "model-workspace",
              toolGrantId: "grant-workspace",
              knowledgeSourceIds: ["source-workspace"],
              access
            }
          : null
      ))
    };
    const knowledgeCore = {
      search: vi.fn(async (payload) => ({ ok: true, items: [{ id: "hit-1" }], echoed: payload }))
    };
    const contextRuntime = {
      preview: vi.fn(async (payload) => ({ ok: true, echoed: payload }))
    };
    const authSession = { user: { userId: "u-1", username: "alice", roleId: "tool-grant" } };

    await expect(runOperation("agent_sessions.context.get", {
      input: { sessionId: "session-1" },
      context: { agentWorkspace, authSession }
    })).resolves.toMatchObject({
      status: 200,
      payload: { workspaceId: "ws-session", contextProfileId: "ctx-session" }
    });

    const sessionSearch = await runOperation("knowledge.search", {
      input: {
        q: "session-query",
        agentSessionId: "session-1",
        limit: "3"
      },
      context: {
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        agentWorkspace,
        authSession
      }
    });

    expect(sessionSearch).toMatchObject({
      status: 200,
      payload: {
        ok: true,
        items: [{ id: "hit-1" }],
        workspaceContext: expect.objectContaining({
          workspaceId: "ws-session",
          contextProfileId: "ctx-session",
          modelAlias: "model-session"
        })
      }
    });
    expect(knowledgeCore.search).toHaveBeenCalledWith(expect.objectContaining({
      query: "session-query",
      limit: 3,
      requestSurface: "agent",
      responseProfile: "agent",
      machineReadable: true,
      agentMessage: true,
      scopeSourceIds: ["source-session"]
    }));
    expect(agentWorkspace.getSessionContext).toHaveBeenCalledWith("session-1", expect.objectContaining({
      actorUserId: "u-1",
      canAccessAll: false,
      sharingMode: "owner-bound"
    }));

    const workspacePreview = await runOperation("context.preview", {
      input: {
        workspaceId: "ws-workspace",
        contextProfileId: "preset-context",
        modelAlias: "preset-model",
        toolGrantId: "preset-grant",
        sourceIds: ["explicit-source"]
      },
      context: {
        contextRuntime,
        agentWorkspace,
        authSession
      }
    });

    expect(workspacePreview).toMatchObject({
      status: 200,
      payload: {
        ok: true,
        echoed: expect.objectContaining({
          workspaceId: "ws-workspace",
          contextProfileId: "preset-context",
          modelAlias: "preset-model",
          toolGrantId: "preset-grant",
          sourceIds: ["explicit-source"]
        })
      }
    });
    expect(contextRuntime.preview).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-workspace",
      contextProfileId: "preset-context",
      modelAlias: "preset-model",
      toolGrantId: "preset-grant",
      sourceIds: ["explicit-source"]
    }));
    expect(agentWorkspace.getWorkspaceContext).toHaveBeenCalledWith("ws-workspace", expect.objectContaining({
      actorUserId: "u-1",
      canAccessAll: false,
      sharingMode: "owner-bound"
    }));
  });

  it("covers tool-management requestBody fallback", async () => {
    const handleToolManagementHttpRequest = vi.fn(async () => false);

    await expect(runOperation("tool_management.http.passthrough", {
      context: {
        request: { id: "req-1" },
        response: {},
        requestBody: Buffer.from("body")
      }
    })).resolves.toMatchObject({
      status: 503,
      payload: { error: "Tool/Skill management provider is unavailable." }
    });

    const passthroughResult = await runOperation("tool_management.http.passthrough", {
      context: {
        toolSkillManagementProvider: { handleToolManagementHttpRequest },
        request: { id: "req-2" },
        response: {},
        requestBody: Buffer.from("body"),
        url: new URL("https://example.local/tool-management/relay"),
        method: "POST"
      }
    });

    expect(handleToolManagementHttpRequest).toHaveBeenCalledWith({
      request: { id: "req-2" },
      response: {},
      requestBody: Buffer.from("body"),
      url: expect.any(URL),
      method: "POST",
      dispatched: true
    });
    expect(passthroughResult).toMatchObject({
      status: 404,
      payload: { error: "Tool Management API route not found." }
    });
  });
});
