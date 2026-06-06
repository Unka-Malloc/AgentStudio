import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleToolPermissionGroupsController } from "../../../server-web/composables/console-tool-permission-groups-controller";

const browserEffectsMock = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
}));

function makeFixture() {
  const settingsDraft = ref<any>({
    agentPermissionGroups: [],
  });
  const visibleModelEntries = ref<any[]>([
    { uid: "agent-a", permissionGroupId: "group-operator" },
    { uid: "agent-b", permissionGroupId: "group-other" },
  ]);
  const toolScopes = ref<any[]>([
    { id: "knowledge:read" },
    { id: "storage:read" },
    { id: "tool:execute" },
    { id: "maintenance:admin" },
    { id: "misc:observe" },
  ]);
  const toolManagementToolsets = ref<any[]>([
    { id: "readonly.tools", maxRisk: "read_only", grantable: true },
    { id: "safe.tools", maxRisk: "safe_write", grantable: true },
    { id: "danger.tools", maxRisk: "dangerous", grantable: true },
    { id: "hidden.tools", maxRisk: "read_only", grantable: false },
  ]);
  const controller = createConsoleToolPermissionGroupsController({
    settingsDraft,
    toolManagementToolsets: computed(() => toolManagementToolsets.value),
    toolScopes: computed(() => toolScopes.value),
    visibleModelEntries: computed(() => visibleModelEntries.value),
  });
  return {
    controller,
    settingsDraft,
    toolManagementToolsets,
    toolScopes,
    visibleModelEntries,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime?.(new Date("2026-06-04T00:00:00.000Z"));
  browserEffectsMock.confirmConsoleAction.mockReturnValue(true);
});

describe("console tool permission groups controller", () => {
  it("builds default permission groups from scopes and grantable toolsets", () => {
    const { controller } = makeFixture();

    expect(controller.defaultAgentPermissionGroups.value).toEqual([
      expect.objectContaining({
        id: "agent-permission-knowledge-reader",
        scopeIds: ["knowledge:read", "storage:read"],
        toolsetIds: ["readonly.tools"],
      }),
      expect.objectContaining({
        id: "agent-permission-operator",
        scopeIds: ["knowledge:read", "storage:read", "tool:execute", "maintenance:admin"],
        toolsetIds: ["readonly.tools", "safe.tools"],
      }),
      expect.objectContaining({
        id: "agent-permission-admin-review",
        scopeIds: ["knowledge:read", "storage:read", "tool:execute", "maintenance:admin", "misc:observe"],
        toolsetIds: ["readonly.tools", "safe.tools", "danger.tools"],
      }),
    ]);
  });

  it("ensures and normalizes draft groups and option bar labels", () => {
    const { controller, settingsDraft } = makeFixture();

    controller.ensureAgentPermissionGroupsDraft();

    expect(settingsDraft.value.agentPermissionGroups).toHaveLength(3);
    expect(controller.agentPermissionGroupOptionBarOptions.value).toEqual([
      { value: "", label: "未分配" },
      { value: "agent-permission-knowledge-reader", label: "知识读取组" },
      { value: "agent-permission-operator", label: "运维操作组" },
      { value: "agent-permission-admin-review", label: "管理员审批组" },
    ]);

    settingsDraft.value.agentPermissionGroups = [
      {
        id: "group-a",
        label: "Group A",
        enabled: true,
        scopeIds: [" knowledge:read ", "knowledge:read", ""],
        toolsetIds: ["readonly.tools", "readonly.tools"],
        toolAllow: ["tool.a", "tool.a"],
        toolDeny: ["tool.b"],
      },
      {
        id: "group-b",
        label: "Group B",
        enabled: false,
        scopeIds: [],
        toolsetIds: [],
      },
      {
        id: "group-a",
        label: "Duplicate",
        enabled: true,
      },
    ];
    controller.ensureAgentPermissionGroupsDraft();

    expect(settingsDraft.value.agentPermissionGroups).toEqual([
      expect.objectContaining({
        id: "group-a",
        label: "Group A",
        scopeIds: ["knowledge:read"],
        toolsetIds: ["readonly.tools"],
        toolAllow: ["tool.a"],
        toolDeny: ["tool.b"],
      }),
      expect.objectContaining({
        id: "group-b",
        enabled: false,
      }),
    ]);
    expect(controller.agentPermissionGroupOptionBarOptions.value).toEqual([
      { value: "", label: "未分配" },
      { value: "group-a", label: "Group A" },
    ]);
  });

  it("adds, labels and toggles scopes and toolsets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:01.000Z"));
    try {
      const { controller, settingsDraft, visibleModelEntries } = makeFixture();

      controller.addAgentPermissionGroup();

      expect(settingsDraft.value.agentPermissionGroups[0]).toMatchObject({
        id: "agent-permission-custom-1780531201000",
        label: "自定义权限组",
        enabled: true,
        scopeIds: [],
        toolsetIds: [],
      });
      expect(controller.permissionGroupLabel()).toBe("未分配");
      expect(controller.permissionGroupLabel("agent-permission-custom-1780531201000")).toBe("自定义权限组");
      expect(controller.permissionGroupLabel("missing")).toBe("missing");

      const group = settingsDraft.value.agentPermissionGroups[0];
      expect(controller.permissionGroupHasScope(group, "knowledge:read")).toBe(false);
      controller.togglePermissionGroupScope(group, "knowledge:read");
      expect(controller.permissionGroupHasScope(group, "knowledge:read")).toBe(true);
      controller.togglePermissionGroupScope(group, "knowledge:read");
      expect(controller.permissionGroupHasScope(group, "knowledge:read")).toBe(false);

      controller.togglePermissionGroupToolset(group, "readonly.tools");
      expect(controller.permissionGroupHasToolset(group, "readonly.tools")).toBe(true);
      controller.togglePermissionGroupToolset(group, "readonly.tools");
      expect(controller.permissionGroupHasToolset(group, "readonly.tools")).toBe(false);

      controller.setModelEntryPermissionGroup(visibleModelEntries.value[0], " group-a ");
      expect(visibleModelEntries.value[0].permissionGroupId).toBe("group-a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes groups after confirmation and clears assigned model entries", () => {
    const { controller, settingsDraft, visibleModelEntries } = makeFixture();
    settingsDraft.value.agentPermissionGroups = [
      {
        id: "group-operator",
        label: "Operator",
        enabled: true,
        scopeIds: [],
        toolsetIds: [],
      },
      {
        id: "group-other",
        label: "Other",
        enabled: true,
        scopeIds: [],
        toolsetIds: [],
      },
    ];

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(false);
    controller.removeAgentPermissionGroup(settingsDraft.value.agentPermissionGroups[0]);
    expect(settingsDraft.value.agentPermissionGroups).toHaveLength(2);
    expect(visibleModelEntries.value[0].permissionGroupId).toBe("group-operator");

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(true);
    controller.removeAgentPermissionGroup(settingsDraft.value.agentPermissionGroups[0]);

    expect(browserEffectsMock.confirmConsoleAction).toHaveBeenLastCalledWith("删除权限组“Operator”？");
    expect(settingsDraft.value.agentPermissionGroups.map((group: any) => group.id)).toEqual(["group-other"]);
    expect(visibleModelEntries.value[0].permissionGroupId).toBe("");
    expect(visibleModelEntries.value[1].permissionGroupId).toBe("group-other");
  });
});
