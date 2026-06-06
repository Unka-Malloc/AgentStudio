import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;

beforeAll(async () => {
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

describe("console-domain operation route and passthrough boundary coverage", () => {
  it("covers tool-management passthrough route-not-found for tool_management prefixed operations", async () => {
    const handle = vi.fn(async () => false);

    const result = await runOperation("tool_management.health.status", {
      context: {
        toolSkillManagementProvider: { handleToolManagementHttpRequest: handle },
        request: { id: "req-1" },
        response: {},
        requestBody: Buffer.from("noop")
      }
    });

    expect(handle).toHaveBeenCalledWith({
      request: { id: "req-1" },
      response: {},
      requestBody: Buffer.from("noop"),
      url: undefined,
      method: "GET",
      dispatched: true
    });
    expect(result).toMatchObject({
      status: 404,
      payload: { error: "Tool Management API route not found." }
    });
  });
});

describe("console-domain retrieval and auth-audit boundaries", () => {
  it("returns workspace context errors before knowledge search when workspaceId is set but workspace service is unavailable", async () => {
    const knowledgeCore = {
      search: vi.fn(async () => {
        return { items: [{ evidenceId: "should-not-habit" }] };
      }),
      getKnowledgeStore: vi.fn()
    };

    const resultNoWorkspaceService = await runOperation("knowledge.search", {
      input: {
        query: "unbound-workspace",
        workspaceId: "ws-1"
      },
      context: {
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        authSession: { user: { userId: "u-1", username: "alice" } }
      }
    });

    expect(resultNoWorkspaceService).toMatchObject({
      status: 503,
      payload: { error: "工作空间上下文不可用。" }
    });
    expect(knowledgeCore.search).not.toHaveBeenCalled();

    const resultMissingWorkspace = await runOperation("knowledge.search", {
      input: {
        query: "missing-workspace",
        workspaceId: "ws-missing"
      },
      context: {
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        authSession: { user: { userId: "u-1", username: "alice" } },
        agentWorkspace: {
          getWorkspaceContext: vi.fn(() => null)
        }
      }
    });

    expect(resultMissingWorkspace).toMatchObject({
      status: 404,
      payload: { error: "工作空间不存在或不可访问。" }
    });
    expect(knowledgeCore.search).not.toHaveBeenCalled();
  });

  it("keeps observability trace query working when security permissions provider is absent", async () => {
    const getTrace = vi.fn(() => ({ traceId: "trace-1", items: [{ eventId: "evt-1" }] }));
    const result = await runOperation("observability.trace.get", {
      input: {
        "trace-id": "trace-1",
        limit: "9"
      },
      context: {
        securityPermissions: {},
        operationAuditStore: { getTrace }
      }
    });

    expect(result).toMatchObject({
      status: 200,
      payload: {
        traceId: "trace-1",
        items: [{ eventId: "evt-1" }],
        authorizationDecisions: [],
        authorizationDecisionCount: 0
      }
    });
    expect(getTrace).toHaveBeenCalledWith("trace-1", { limit: 9, tenantId: "" });
  });
});
