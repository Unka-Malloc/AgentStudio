// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleToolManagementController } from "../../../server-web/composables/console-tool-management-controller";

const toolManagementClientMock = vi.hoisted(() => ({
  createToolGrant: vi.fn(),
  deleteToolGrant: vi.fn(),
  getToolManagementAudit: vi.fn(),
  getToolManagementCatalog: vi.fn(),
  getToolManagementGrants: vi.fn(),
  getToolManagementMetrics: vi.fn(),
  previewToolPolicy: vi.fn(),
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
  getToolManagementAudit: toolManagementClientMock.getToolManagementAudit,
  getToolManagementCatalog: toolManagementClientMock.getToolManagementCatalog,
  getToolManagementGrants: toolManagementClientMock.getToolManagementGrants,
  getToolManagementMetrics: toolManagementClientMock.getToolManagementMetrics,
  previewToolPolicy: toolManagementClientMock.previewToolPolicy,
  rotateToolGrantToken: toolManagementClientMock.rotateToolGrantToken,
  updateToolGrant: toolManagementClientMock.updateToolGrant,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
  copyConsoleText: browserEffectsMock.copyConsoleText,
}));

function makeFixture() {
  const error = ref("seed error");
  const settingsDraft = ref<any>({
    agentPermissionGroups: [],
  });
  const visibleModelEntries = ref<any[]>([
    { uid: "agent-a", permissionGroupId: "" },
  ]);
  const controller = createConsoleToolManagementController({
    clearAllBusy: vi.fn(),
    error,
    setBusy: vi.fn(),
    settingsDraft,
    visibleModelEntries: computed(() => visibleModelEntries.value),
  });

  return {
    controller,
    error,
    settingsDraft,
    visibleModelEntries,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  browserEffectsMock.confirmConsoleAction.mockReturnValue(true);
});

describe("console tool management controller", () => {
  it("refreshes tool management data, seeds empty selections, and derives summary rows", async () => {
    const { controller, error } = makeFixture();
    const catalog = {
      scopes: [{ id: "knowledge:read" }],
      tools: [
        {
          id: "tool-a",
          label: "Tool A",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["toolset-a"],
        },
        {
          id: "tool-b",
          label: "Tool B",
          status: "internal",
          requiredScopes: [],
          toolsets: [],
        },
      ],
      toolsets: [{ id: "toolset-a" }],
      profiles: [{ id: "profile-a", label: "Profile A" }],
    };

    toolManagementClientMock.getToolManagementGrants.mockResolvedValueOnce({ grants: [{ id: "grant-a" }] });
    toolManagementClientMock.getToolManagementCatalog.mockResolvedValueOnce(catalog);
    toolManagementClientMock.getToolManagementAudit.mockResolvedValueOnce({ items: [{ id: "audit-a" }] });
    toolManagementClientMock.getToolManagementMetrics.mockResolvedValueOnce({
      metrics: {
        byStatus: { active: 1, internal: 1 },
        byRisk: { low: 2, high: 1 },
      },
    });

    controller.selectedToolManagementToolId.value = "";
    controller.policyPreviewToolId.value = "";

    await controller.refreshToolManagement();

    expect(controller.toolManagementGrantsState.value).toEqual([{ id: "grant-a" }]);
    expect(controller.toolManagementCatalogState.value).toEqual(catalog);
    expect(controller.toolManagementAuditItems.value).toEqual([{ id: "audit-a" }]);
    expect(controller.toolManagementMetricsState.value).toEqual({
      byStatus: { active: 1, internal: 1 },
      byRisk: { low: 2, high: 1 },
    });
    expect(controller.selectedToolManagementToolId.value).toBe("tool-a");
    expect(controller.policyPreviewToolId.value).toBe("tool-a");
    expect(controller.toolScopes.value).toEqual([{ id: "knowledge:read" }]);
    expect(controller.toolCatalog.value).toHaveLength(2);
    expect(controller.toolManagementToolsets.value).toEqual([{ id: "toolset-a" }]);
    expect(controller.toolManagementProfiles.value).toEqual([{ id: "profile-a", label: "Profile A" }]);
    expect(controller.activeToolManagementToolCount.value).toBe(1);
    expect(controller.internalToolManagementToolCount.value).toBe(1);
    expect(controller.toolManagementStatusRows.value).toEqual([
      { label: "active", value: 1 },
      { label: "internal", value: 1 },
    ]);
    expect(controller.toolManagementRiskRows.value).toEqual([
      { label: "low", value: 2 },
      { label: "high", value: 1 },
    ]);
    expect(controller.selectedToolManagementTool.value).toEqual(expect.objectContaining({ id: "tool-a" }));
    expect(error.value).toBe("");
    expect(toolManagementClientMock.getToolManagementAudit).toHaveBeenCalledWith(50);
  });

  it("falls back to the preview tool or first tool when selection is empty", async () => {
    const { controller } = makeFixture();

    controller.toolManagementCatalogState.value = {
      scopes: [],
      tools: [
        {
          id: "tool-a",
          label: "Tool A",
          status: "active",
          requiredScopes: [],
          toolsets: [],
        },
        {
          id: "tool-b",
          label: "Tool B",
          status: "active",
          requiredScopes: [],
          toolsets: [],
        },
      ],
      toolsets: [],
      profiles: [],
    };

    controller.selectedToolManagementToolId.value = "";
    controller.policyPreviewToolId.value = "tool-b";
    expect(controller.selectedToolManagementTool.value?.id).toBe("tool-b");

    controller.policyPreviewToolId.value = "";
    expect(controller.selectedToolManagementTool.value?.id).toBe("tool-a");

    controller.selectToolForManagement("tool-b");
    expect(controller.selectedToolManagementToolId.value).toBe("tool-b");
    expect(controller.policyPreviewToolId.value).toBe("tool-b");
    expect(controller.selectedToolManagementTool.value?.id).toBe("tool-b");
  });

  it("surfaces refresh failures without busy state when silent and keeps the default fallback message", async () => {
    const { controller, error } = makeFixture();

    toolManagementClientMock.getToolManagementGrants.mockRejectedValueOnce("bad refresh");

    await controller.refreshToolManagement({ silent: true });

    expect(error.value).toBe("刷新智能体工具失败。");
    expect(toolManagementClientMock.getToolManagementCatalog).toHaveBeenCalledTimes(1);
    expect(toolManagementClientMock.getToolManagementAudit).toHaveBeenCalledTimes(1);
    expect(toolManagementClientMock.getToolManagementMetrics).toHaveBeenCalledTimes(1);
  });

  it("previews tool policy with trimmed inputs and the selected tool grant", async () => {
    const { controller, error } = makeFixture();
    controller.toolManagementCatalogState.value = {
      scopes: [],
      tools: [
        {
          id: "tool-a",
          label: "Tool A",
          status: "active",
          requiredScopes: ["scope.read"],
          toolsets: ["toolset-a"],
        },
      ],
      toolsets: [],
      profiles: [{ id: "profile-a", label: "Profile A" }],
    };
    controller.policyPreviewToolId.value = "tool-a";
    controller.policyPreviewProfileId.value = " profile-a ";
    controller.policyPreviewGrantId.value = "";

    toolManagementClientMock.previewToolPolicy.mockResolvedValueOnce({
      approved: true,
    });

    await controller.previewToolPolicy();

    expect(toolManagementClientMock.previewToolPolicy).toHaveBeenCalledWith({
      toolId: "tool-a",
      input: {},
      dryRun: false,
      grant: {
        id: "console-preview-grant",
        label: "Console preview grant",
        enabled: true,
        scopes: ["scope.read"],
        toolsets: ["toolset-a"],
        toolAllow: [],
        toolDeny: [],
        metadata: {},
      },
      profileId: "profile-a",
    });
    expect(controller.policyPreviewResult.value).toEqual({ approved: true });
    expect(error.value).toBe("");
  });

  it("prefers grantId when present and rejects preview without a selected tool", async () => {
    const { controller, error } = makeFixture();
    controller.policyPreviewToolId.value = "";

    await controller.previewToolPolicy();
    expect(error.value).toBe("请选择需要预览的工具。");
    expect(toolManagementClientMock.previewToolPolicy).not.toHaveBeenCalled();

    error.value = "";
    controller.toolManagementCatalogState.value = {
      scopes: [],
      tools: [
        {
          id: "tool-a",
          label: "Tool A",
          status: "active",
          requiredScopes: [],
          toolsets: [],
        },
      ],
      toolsets: [],
      profiles: [],
    };
    controller.policyPreviewToolId.value = "tool-a";
    controller.policyPreviewGrantId.value = " grant-123 ";
    controller.policyPreviewProfileId.value = " ";

    toolManagementClientMock.previewToolPolicy.mockResolvedValueOnce({ risk: "low" });

    await controller.previewToolPolicy();

    expect(toolManagementClientMock.previewToolPolicy).toHaveBeenLastCalledWith({
      toolId: "tool-a",
      input: {},
      dryRun: false,
      grantId: "grant-123",
    });
    expect(controller.policyPreviewResult.value).toEqual({ risk: "low" });
    expect(error.value).toBe("");
  });
});
