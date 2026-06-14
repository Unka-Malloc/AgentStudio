// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleToolGrantsController } from "../../../server-web/composables/console-tool-grants-controller";

const toolManagementClientMock = vi.hoisted(() => ({
  createToolGrant: vi.fn(),
  deleteToolGrant: vi.fn(),
  rotateToolGrantToken: vi.fn(),
  updateToolGrant: vi.fn(),
}));

const browserEffectsMock = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
  copyConsoleText: vi.fn(),
}));

vi.mock("../../../server-web/lib/tool-management-client", () => ({
  createToolGrant: toolManagementClientMock.createToolGrant,
  deleteToolGrant: toolManagementClientMock.deleteToolGrant,
  rotateToolGrantToken: toolManagementClientMock.rotateToolGrantToken,
  updateToolGrant: toolManagementClientMock.updateToolGrant,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
  copyConsoleText: browserEffectsMock.copyConsoleText,
}));

type Grant = {
  id: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  toolsets?: string[];
  toolAllow?: string[];
  toolDeny?: string[];
  metadata?: Record<string, unknown>;
};

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-1",
    label: "默认智能体",
    enabled: true,
    scopes: ["knowledge:read"],
    toolsets: ["pact.agentLibrary.read"],
    toolAllow: [],
    toolDeny: [],
    metadata: {},
    ...overrides,
  };
}

function createFixture(overrides: Record<string, unknown> = {}) {
  const error = ref("");
  const toolManagementGrantsState = ref<Grant[]>([
    makeGrant({ id: "grant-1", label: "Alpha", enabled: true, toolAllow: ["pact.agentLibrary.read"] }),
    makeGrant({
      id: "grant-2",
      label: "Beta",
      enabled: false,
      toolsets: [],
      toolAllow: [],
      toolDeny: ["pact.agentLibrary.write"],
    }),
  ]);
  const refreshToolManagement = vi.fn().mockResolvedValue(undefined);
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();

  const controller = createConsoleToolGrantsController({
    clearAllBusy,
    error,
    refreshToolManagement,
    setBusy,
    toolManagementGrantsState,
    ...overrides,
  });

  return {
    clearAllBusy,
    controller,
    error,
    refreshToolManagement,
    setBusy,
    toolManagementGrantsState,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  browserEffectsMock.confirmConsoleAction.mockReset();
  browserEffectsMock.copyConsoleText.mockReset();
  toolManagementClientMock.createToolGrant.mockReset();
  toolManagementClientMock.deleteToolGrant.mockReset();
  toolManagementClientMock.rotateToolGrantToken.mockReset();
  toolManagementClientMock.updateToolGrant.mockReset();
  browserEffectsMock.confirmConsoleAction.mockReturnValue(true);
  browserEffectsMock.copyConsoleText.mockResolvedValue(undefined);
});

describe("console tool grants controller", () => {
  it("loads grant list state and derives counts and rule labels", () => {
    const { controller, toolManagementGrantsState } = createFixture();

    expect(controller.toolGrants.value).toHaveLength(2);
    expect(controller.enabledToolGrantCount.value).toBe(1);
    expect(controller.grantToolRuleState(toolManagementGrantsState.value[0], "pact.agentLibrary.read")).toBe("allow");
    expect(controller.grantToolRuleState(toolManagementGrantsState.value[1], "pact.agentLibrary.write")).toBe("deny");
    expect(controller.grantToolRuleState(toolManagementGrantsState.value[1], "missing")).toBe("inherit");
    expect(controller.grantHasScope(toolManagementGrantsState.value[0], "knowledge:read")).toBe(true);
    expect(controller.grantHasToolset(toolManagementGrantsState.value[0], "pact.agentLibrary.read")).toBe(true);

    toolManagementGrantsState.value.push(makeGrant({ id: "grant-3", enabled: true }));
    expect(controller.toolGrants.value).toHaveLength(3);
    expect(controller.enabledToolGrantCount.value).toBe(2);
  });

  it("toggles draft scopes and toolsets before creation", () => {
    const { controller } = createFixture();

    expect(controller.newGrantScopes.value).toEqual(["knowledge:read"]);
    expect(controller.newGrantToolsets.value).toEqual(["pact.agentLibrary.read"]);

    controller.toggleNewGrantScope("knowledge:read");
    controller.toggleNewGrantScope("knowledge:write");
    controller.toggleNewGrantToolset("pact.agentLibrary.read");
    controller.toggleNewGrantToolset("pact.agentLibrary.write");

    expect(controller.newGrantScopes.value).toEqual(["knowledge:write"]);
    expect(controller.newGrantToolsets.value).toEqual(["pact.agentLibrary.write"]);
  });

  it("rejects creation when both scopes and toolsets are empty", async () => {
    const { controller, clearAllBusy, error, refreshToolManagement, setBusy } = createFixture();
    controller.newGrantScopes.value = [];
    controller.newGrantToolsets.value = [];

    await controller.createGrant();

    expect(toolManagementClientMock.createToolGrant).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    expect(refreshToolManagement).not.toHaveBeenCalled();
    expect(clearAllBusy).not.toHaveBeenCalled();
    expect(error.value).toBe("请至少选择一个工具权限范围或工具集。");
    expect(controller.issuedToolToken.value).toBe("");
  });

  it("creates a grant, refreshes silently, and copies the issued token", async () => {
    const { controller, clearAllBusy, error, refreshToolManagement, setBusy } = createFixture();
    toolManagementClientMock.createToolGrant.mockResolvedValue({ token: "issued-token" });

    await controller.createGrant();

    expect(setBusy).toHaveBeenCalledWith("grant:create");
    expect(toolManagementClientMock.createToolGrant).toHaveBeenCalledWith({
      label: "默认智能体",
      scopes: ["knowledge:read"],
      toolsets: ["pact.agentLibrary.read"],
    });
    expect(controller.issuedToolToken.value).toBe("issued-token");
    expect(refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(error.value).toBe("");

    await controller.copyIssuedToolToken();
    expect(browserEffectsMock.copyConsoleText).toHaveBeenCalledWith("issued-token");
  });

  it("surfaces create errors and refresh errors after creation", async () => {
    const { controller, error, refreshToolManagement } = createFixture();

    toolManagementClientMock.createToolGrant.mockRejectedValueOnce(new Error("create failed"));
    await controller.createGrant();
    expect(error.value).toBe("create failed");
    expect(controller.issuedToolToken.value).toBe("");
    expect(refreshToolManagement).not.toHaveBeenCalled();

    error.value = "";
    refreshToolManagement.mockRejectedValueOnce(new Error("refresh failed"));
    toolManagementClientMock.createToolGrant.mockResolvedValueOnce({ token: "rotate-me" });

    await controller.createGrant();

    expect(controller.issuedToolToken.value).toBe("rotate-me");
    expect(error.value).toBe("refresh failed");
  });

  it("updates grant rules and merges allow/deny sets", async () => {
    const { controller, clearAllBusy, error, refreshToolManagement, setBusy, toolManagementGrantsState } = createFixture();
    const grant = toolManagementGrantsState.value[0];

    await controller.setGrantToolRule(grant, "pact.agentLibrary.write", "allow");
    await controller.toggleGrantScope(grant, "knowledge:write");
    await controller.toggleGrantToolset(grant, "pact.agentLibrary.write");

    expect(setBusy).toHaveBeenNthCalledWith(1, "grant:grant-1");
    expect(toolManagementClientMock.updateToolGrant).toHaveBeenCalledWith("grant-1", {
      label: undefined,
      enabled: undefined,
      scopes: undefined,
      toolsets: undefined,
      toolAllow: ["pact.agentLibrary.read", "pact.agentLibrary.write"],
      toolDeny: [],
    });
    expect(toolManagementClientMock.updateToolGrant).toHaveBeenCalledWith("grant-1", {
      label: undefined,
      enabled: undefined,
      scopes: ["knowledge:read", "knowledge:write"],
      toolsets: undefined,
      toolAllow: undefined,
      toolDeny: undefined,
    });
    expect(toolManagementClientMock.updateToolGrant).toHaveBeenCalledWith("grant-1", {
      label: undefined,
      enabled: undefined,
      scopes: undefined,
      toolsets: ["pact.agentLibrary.read", "pact.agentLibrary.write"],
      toolAllow: undefined,
      toolDeny: undefined,
    });
    expect(refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(clearAllBusy).toHaveBeenCalledTimes(3);
    expect(error.value).toBe("");
  });

  it("surfaces update errors with the default message for non-errors", async () => {
    const { controller, error, toolManagementGrantsState } = createFixture();
    toolManagementClientMock.updateToolGrant.mockRejectedValueOnce("bad update");

    await controller.updateGrant(toolManagementGrantsState.value[0], { enabled: false });

    expect(error.value).toBe("更新工具授权失败。");
  });

  it("rotates a grant and handles refresh or api failures", async () => {
    const { controller, clearAllBusy, error, refreshToolManagement, setBusy, toolManagementGrantsState } = createFixture();
    const grant = toolManagementGrantsState.value[0];
    toolManagementClientMock.rotateToolGrantToken.mockResolvedValueOnce({ token: "rotated-token" });

    await controller.rotateGrant(grant);

    expect(setBusy).toHaveBeenCalledWith("grant:grant-1");
    expect(toolManagementClientMock.rotateToolGrantToken).toHaveBeenCalledWith("grant-1");
    expect(controller.issuedToolToken.value).toBe("rotated-token");
    expect(refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(clearAllBusy).toHaveBeenCalledTimes(1);

    refreshToolManagement.mockRejectedValueOnce(new Error("refresh failed"));
    toolManagementClientMock.rotateToolGrantToken.mockResolvedValueOnce({ token: "rotated-again" });

    await controller.rotateGrant(grant);
    expect(error.value).toBe("refresh failed");

    toolManagementClientMock.rotateToolGrantToken.mockRejectedValueOnce(new Error("rotate failed"));
    await controller.rotateGrant(grant);
    expect(error.value).toBe("rotate failed");
  });

  it("deletes grants after confirmation and skips when the action is rejected", async () => {
    const { controller, clearAllBusy, error, refreshToolManagement, setBusy, toolManagementGrantsState } = createFixture();
    const grant = toolManagementGrantsState.value[0];

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(false);
    await controller.deleteGrant(grant);
    expect(toolManagementClientMock.deleteToolGrant).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    expect(clearAllBusy).not.toHaveBeenCalled();

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(true);
    toolManagementClientMock.deleteToolGrant.mockResolvedValueOnce({ grant });
    await controller.deleteGrant(grant);

    expect(toolManagementClientMock.deleteToolGrant).toHaveBeenCalledWith("grant-1");
    expect(setBusy).toHaveBeenCalledWith("grant:grant-1");
    expect(refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(error.value).toBe("");
  });

  it("surfaces delete errors and copy is a no-op when no token exists", async () => {
    const { controller, error, toolManagementGrantsState } = createFixture();
    toolManagementClientMock.deleteToolGrant.mockRejectedValueOnce(new Error("delete failed"));

    await controller.deleteGrant(toolManagementGrantsState.value[0]);
    expect(error.value).toBe("delete failed");

    await controller.copyIssuedToolToken();
    expect(browserEffectsMock.copyConsoleText).not.toHaveBeenCalled();
  });
});
