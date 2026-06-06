// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleMcpAuthorizationController } from "../../../server-web/composables/console-mcp-authorization-controller";

const authorizationClientMock = vi.hoisted(() => ({
  listMcpAuthorizationRequests: vi.fn(),
  resolveMcpAuthorizationRequest: vi.fn(),
}));

vi.mock("../../../server-web/lib/authorization-governance-client", () => ({
  listMcpAuthorizationRequests: authorizationClientMock.listMcpAuthorizationRequests,
  resolveMcpAuthorizationRequest: authorizationClientMock.resolveMcpAuthorizationRequest,
}));

function createHarness() {
  const error = ref("previous error");
  const clearBusy = vi.fn();
  const setBusy = vi.fn();
  const controller = createConsoleMcpAuthorizationController({
    clearBusy,
    error,
    setBusy,
  });

  return {
    clearBusy,
    controller,
    error,
    setBusy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizationClientMock.listMcpAuthorizationRequests.mockReset();
  authorizationClientMock.resolveMcpAuthorizationRequest.mockReset();
});

describe("console mcp authorization controller extra coverage", () => {
  it("refreshes authorization requests for the selected status", async () => {
    authorizationClientMock.listMcpAuthorizationRequests.mockResolvedValue({
      requests: [
        {
          clientName: "Desktop",
          reason: "Need repository tools",
          requestId: "request-1",
          requestedScopes: ["workspace:read"],
          requestedTools: ["repo.status"],
          status: "pending",
        },
      ],
    });
    const { clearBusy, controller, error, setBusy } = createHarness();
    controller.mcpAuthorizationStatus.value = "all";

    await controller.refreshMcpAuthorizationRequests();

    expect(setBusy).toHaveBeenCalledWith("mcp-authorization-requests:refresh");
    expect(authorizationClientMock.listMcpAuthorizationRequests).toHaveBeenCalledWith("all");
    expect(controller.mcpAuthorizationRequests.value).toEqual([
      expect.objectContaining({ requestId: "request-1" }),
    ]);
    expect(error.value).toBe("previous error");
    expect(clearBusy).toHaveBeenCalledWith("mcp-authorization-requests:refresh");
  });

  it("falls back to an empty request list for malformed refresh results", async () => {
    authorizationClientMock.listMcpAuthorizationRequests.mockResolvedValue({ requests: null });
    const { controller } = createHarness();

    await controller.refreshMcpAuthorizationRequests();

    expect(controller.mcpAuthorizationRequests.value).toEqual([]);
  });

  it("reports refresh failures and clears busy state", async () => {
    authorizationClientMock.listMcpAuthorizationRequests.mockRejectedValue("offline");
    const { clearBusy, controller, error } = createHarness();
    controller.mcpAuthorizationRequests.value = [
      { requestId: "stale", status: "pending" },
    ];

    await controller.refreshMcpAuthorizationRequests();

    expect(controller.mcpAuthorizationRequests.value).toEqual([]);
    expect(error.value).toBe("加载 MCP 授权请求失败。");
    expect(clearBusy).toHaveBeenCalledWith("mcp-authorization-requests:refresh");
  });

  it("resolves a known request with client, scopes, and tools before refreshing", async () => {
    authorizationClientMock.resolveMcpAuthorizationRequest.mockResolvedValue({ ok: true, grantId: "grant-1" });
    authorizationClientMock.listMcpAuthorizationRequests.mockResolvedValue({ requests: [] });
    const { clearBusy, controller, setBusy } = createHarness();
    controller.mcpAuthorizationRequests.value = [
      {
        clientName: "Codex",
        requestId: "request-2",
        requestedScopes: ["knowledge:read"],
        requestedTools: ["pact.knowledge.search"],
        status: "pending",
      },
    ];

    await controller.resolveMcpAuthorizationRequest("request-2", "approved");

    expect(setBusy).toHaveBeenCalledWith("mcp-authorization-requests:resolve:request-2");
    expect(authorizationClientMock.resolveMcpAuthorizationRequest).toHaveBeenCalledWith(
      "request-2",
      {
        clientName: "Codex",
        resolution: "approved",
        scopes: ["knowledge:read"],
        toolAllow: ["pact.knowledge.search"],
        toolsets: [],
      },
    );
    expect(authorizationClientMock.listMcpAuthorizationRequests).toHaveBeenCalledWith("pending");
    expect(clearBusy).toHaveBeenCalledWith("mcp-authorization-requests:refresh");
    expect(clearBusy).toHaveBeenCalledWith("mcp-authorization-requests:resolve:request-2");
  });

  it("resolves an unknown request with empty grant details", async () => {
    authorizationClientMock.resolveMcpAuthorizationRequest.mockResolvedValue({ ok: true });
    authorizationClientMock.listMcpAuthorizationRequests.mockResolvedValue({ requests: [] });
    const { controller } = createHarness();

    await controller.resolveMcpAuthorizationRequest("missing", "rejected");

    expect(authorizationClientMock.resolveMcpAuthorizationRequest).toHaveBeenCalledWith(
      "missing",
      {
        clientName: undefined,
        resolution: "rejected",
        scopes: [],
        toolAllow: [],
        toolsets: [],
      },
    );
  });

  it("reports resolve failures without refreshing", async () => {
    authorizationClientMock.resolveMcpAuthorizationRequest.mockRejectedValue(new Error("approval failed"));
    const { clearBusy, controller, error } = createHarness();

    await controller.resolveMcpAuthorizationRequest("request-3", "approved");

    expect(error.value).toBe("approval failed");
    expect(authorizationClientMock.listMcpAuthorizationRequests).not.toHaveBeenCalled();
    expect(clearBusy).toHaveBeenCalledWith("mcp-authorization-requests:resolve:request-3");
  });
});
