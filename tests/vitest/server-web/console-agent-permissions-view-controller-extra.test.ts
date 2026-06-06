// @vitest-environment jsdom
import { computed, defineComponent, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentPermissionsViewConsole } from "../../../server-web/composables/console-agent-permissions-view-controller";

const authorizationGovernanceClientMock = vi.hoisted(() => ({
  getAuthorizationGovernance: vi.fn(),
  upsertAuthorizationGovernance: vi.fn(),
}));

const shellContextMock = vi.hoisted(() => ({
  useServerConsoleShellContext: vi.fn(),
}));

vi.mock("../../../server-web/lib/authorization-governance-client", () => ({
  getAuthorizationGovernance: authorizationGovernanceClientMock.getAuthorizationGovernance,
  upsertAuthorizationGovernance: authorizationGovernanceClientMock.upsertAuthorizationGovernance,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock.useServerConsoleShellContext,
}));

type GovernanceSummary = {
  roles: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  userPolicies: Array<Record<string, unknown>>;
  agentBindings: Array<Record<string, unknown>>;
  agentGroups: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
};

type ToolManagementGrant = {
  id: string;
  enabled: boolean;
  scopes: string[];
  toolsets: string[];
  toolAllow: string[];
  toolDeny: string[];
};

type AgentPermissionGroup = {
  id: string;
  label: string;
  enabled: boolean;
  scopeIds: string[];
  toolsetIds: string[];
  toolAllow: string[];
  toolDeny: string[];
};

type ToolManagementTool = {
  id: string;
  label: string;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => nextTick());
}

function makeGovernance(overrides: Partial<GovernanceSummary> = {}): GovernanceSummary {
  return {
    roles: [{ id: "role-1" }],
    teams: [{ id: "team-1" }, { id: "team-2" }],
    userPolicies: [{ id: "user-policy-1" }],
    agentBindings: [{ id: "binding-1" }],
    agentGroups: [{ id: "group-1" }],
    approvals: [{ id: "approval-1" }, { id: "approval-2" }],
    ...overrides,
  };
}

function makePermissionGroup(overrides: Partial<AgentPermissionGroup> = {}): AgentPermissionGroup {
  return {
    id: "group-read",
    label: "读取组",
    enabled: true,
    scopeIds: ["scope.read"],
    toolsetIds: ["toolset.read"],
    toolAllow: ["tool.allow"],
    toolDeny: ["tool.deny"],
    ...overrides,
  };
}

function createToolManagementShell() {
  const settingsDraft = ref({
    agentPermissionGroups: [] as AgentPermissionGroup[],
  });
  const busyKey = ref("");
  const issuedToolToken = ref("issued-token");
  const newGrantLabel = ref("默认智能体");
  const newGrantScopes = ref(["scope.read"]);
  const newGrantToolsets = ref(["toolset.read"]);
  const policyPreviewGrantId = ref("");
  const policyPreviewProfileId = ref("");
  const policyPreviewResult = ref<Record<string, unknown> | null>(null);
  const policyPreviewToolId = ref("tool-a");
  const selectedToolId = ref("tool-a");
  const toolGrants = ref<ToolManagementGrant[]>([
    {
      id: "grant-1",
      enabled: true,
      scopes: ["scope.read"],
      toolsets: ["toolset.read"],
      toolAllow: ["tool.allow"],
      toolDeny: [],
    },
    {
      id: "grant-2",
      enabled: false,
      scopes: [],
      toolsets: [],
      toolAllow: [],
      toolDeny: ["tool.deny"],
    },
  ]);
  const toolManagementTools = ref<ToolManagementTool[]>([
    { id: "tool-a", label: "Tool A" },
    { id: "tool-b", label: "Tool B" },
  ]);
  const toolManagementToolsets = ref([
    { id: "toolset.read", maxRisk: "read_only", grantable: true },
    { id: "toolset.safe", maxRisk: "safe_write", grantable: true },
    { id: "toolset.admin", maxRisk: "high", grantable: true },
  ]);
  const toolScopes = ref([
    { id: "scope.read" },
    { id: "scope.write" },
    { id: "scope.admin" },
  ]);
  const policyPreviewToolOptionBarOptions = computed(() =>
    toolManagementTools.value.map((tool) => ({
      value: tool.id,
      label: `${tool.label} / ${tool.id}`,
    })),
  );
  const policyPreviewProfileOptionBarOptions = computed(() => [
    { value: "", label: "不绑定档案" },
    { value: "profile-1", label: "默认档案 / profile-1" },
  ]);
  const selectedToolManagementTool = computed(() =>
    toolManagementTools.value.find((tool) => tool.id === selectedToolId.value) ||
    toolManagementTools.value[0] ||
    null,
  );
  const enabledToolGrantCount = computed(() => toolGrants.value.filter((grant) => grant.enabled).length);
  const agentPermissionGroups = computed(() => settingsDraft.value.agentPermissionGroups);

  const ensureAgentPermissionGroupsDraft = vi.fn(() => {
    if (settingsDraft.value.agentPermissionGroups.length > 0) {
      return;
    }
    settingsDraft.value.agentPermissionGroups = [
      makePermissionGroup(),
      makePermissionGroup({
        id: "group-disabled",
        label: "禁用组",
        enabled: false,
        scopeIds: [],
        toolsetIds: [],
        toolAllow: [],
        toolDeny: [],
      }),
    ];
  });
  const addAgentPermissionGroup = vi.fn(() => {
    settingsDraft.value.agentPermissionGroups = [
      makePermissionGroup({
        id: `group-custom-${settingsDraft.value.agentPermissionGroups.length + 1}`,
        label: "自定义权限组",
        scopeIds: [],
        toolsetIds: [],
        toolAllow: [],
        toolDeny: [],
      }),
      ...settingsDraft.value.agentPermissionGroups,
    ];
  });
  const removeAgentPermissionGroup = vi.fn((group: AgentPermissionGroup) => {
    settingsDraft.value.agentPermissionGroups = settingsDraft.value.agentPermissionGroups.filter((item) => item.id !== group.id);
  });
  const permissionGroupHasToolset = vi.fn((group: AgentPermissionGroup, toolsetId: string) =>
    group.toolsetIds.includes(toolsetId),
  );
  const permissionGroupToolRuleState = vi.fn(
    (group: { toolAllow?: string[]; toolDeny?: string[] }, toolId: string) => {
      if ((group.toolDeny || []).includes(toolId)) {
        return "deny";
      }
      if ((group.toolAllow || []).includes(toolId)) {
        return "allow";
      }
      return "inherit";
    },
  );
  const setPermissionGroupToolRule = vi.fn(
    (group: { toolAllow?: string[]; toolDeny?: string[] }, toolId: string, rule: "inherit" | "allow" | "deny") => {
      const allow = new Set(group.toolAllow || []);
      const deny = new Set(group.toolDeny || []);
      allow.delete(toolId);
      deny.delete(toolId);
      if (rule === "allow") {
        allow.add(toolId);
      }
      if (rule === "deny") {
        deny.add(toolId);
      }
      group.toolAllow = [...allow];
      group.toolDeny = [...deny];
    },
  );
  const selectToolForManagement = vi.fn((toolId: string) => {
    selectedToolId.value = toolId;
    policyPreviewToolId.value = toolId;
  });
  const grantToolRuleState = vi.fn(
    (grant: { toolAllow?: string[]; toolDeny?: string[] }, toolId: string) => {
      if ((grant.toolDeny || []).includes(toolId)) {
        return "deny";
      }
      if ((grant.toolAllow || []).includes(toolId)) {
        return "allow";
      }
      return "inherit";
    },
  );
  const grantHasToolset = vi.fn((grant: { toolsets?: string[] }, toolsetId: string) =>
    (grant.toolsets || []).includes(toolsetId),
  );
  const copyIssuedToolToken = vi.fn();
  const createGrant = vi.fn();
  const deleteGrant = vi.fn();
  const rotateGrant = vi.fn();
  const saveAgentPermissionSettings = vi.fn();
  const setGrantToolRule = vi.fn();
  const toggleGrantToolset = vi.fn();
  const toggleNewGrantToolset = vi.fn();
  const togglePermissionGroupToolset = vi.fn((group: AgentPermissionGroup, toolsetId: string) => {
    const next = new Set(group.toolsetIds || []);
    if (next.has(toolsetId)) {
      next.delete(toolsetId);
    } else {
      next.add(toolsetId);
    }
    group.toolsetIds = [...next];
  });
  const updateGrant = vi.fn();
  const previewToolPolicy = vi.fn();

  return {
    addAgentPermissionGroup,
    agentPermissionGroups,
    busyKey,
    copyIssuedToolToken,
    createGrant,
    deleteGrant,
    enabledToolGrantCount,
    ensureAgentPermissionGroupsDraft,
    grantHasToolset,
    grantToolRuleState,
    issuedToolToken,
    newGrantLabel,
    newGrantScopes,
    newGrantToolsets,
    permissionGroupHasToolset,
    permissionGroupToolRuleState,
    policyPreviewGrantId,
    policyPreviewProfileId,
    policyPreviewProfileOptionBarOptions,
    policyPreviewResult,
    policyPreviewToolId,
    policyPreviewToolOptionBarOptions,
    previewToolPolicy,
    removeAgentPermissionGroup,
    rotateGrant,
    saveAgentPermissionSettings,
    selectToolForManagement,
    selectedToolManagementTool,
    setGrantToolRule,
    setPermissionGroupToolRule,
    settingsDraft,
    toggleGrantToolset,
    toggleNewGrantToolset,
    togglePermissionGroupToolset,
    toolGrants,
    toolManagementTools,
    toolManagementToolsets,
    toolScopes,
    updateGrant,
  };
}

function createHarness() {
  const toolManagementConsole = createToolManagementShell();
  const shell = { toolManagementConsole };
  shellContextMock.useServerConsoleShellContext.mockReturnValue(shell);

  let controller: ReturnType<typeof useAgentPermissionsViewConsole> | null = null;
  const host = defineComponent({
    setup() {
      controller = useAgentPermissionsViewConsole();
      return () => null;
    },
  });
  const wrapper = mount(host);

  return {
    controller: controller as ReturnType<typeof useAgentPermissionsViewConsole>,
    toolManagementConsole,
    wrapper,
  };
}

let mountedWrappers: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  authorizationGovernanceClientMock.getAuthorizationGovernance.mockReset();
  authorizationGovernanceClientMock.upsertAuthorizationGovernance.mockReset();
  shellContextMock.useServerConsoleShellContext.mockReset();
});

afterEach(() => {
  for (const wrapper of mountedWrappers) {
    wrapper.unmount();
  }
  mountedWrappers = [];
});

describe("console agent permissions view controller extra", () => {
  it("loads governance, resets the editor on mount, and keeps metrics in sync", async () => {
    const refreshGate = deferred<{ governance: GovernanceSummary }>();
    authorizationGovernanceClientMock.getAuthorizationGovernance.mockReturnValueOnce(refreshGate.promise);

    const harness = createHarness();
    mountedWrappers.push(harness.wrapper);

    await nextTick();

    expect(harness.controller.authorizationGovernanceLoading.value).toBe(true);
    expect(harness.controller.authorizationGovernanceEditorKind.value).toBe("team");
    expect(harness.controller.authorizationGovernanceEditorBody.value).toContain("\"team-code\"");
    expect(harness.controller.authorizationGovernanceEditorStatus.value).toBe("");
    expect(harness.controller.authorizationGovernanceEditorKinds.map((kind) => kind.value)).toEqual([
      "role",
      "team",
      "userPolicy",
      "agentGroup",
      "agentBinding",
      "approval",
    ]);
    expect(harness.toolManagementConsole.ensureAgentPermissionGroupsDraft).toHaveBeenCalledTimes(1);

    refreshGate.resolve({ governance: makeGovernance() });
    await flushPromises();

    expect(harness.controller.authorizationGovernanceLoading.value).toBe(false);
    expect(harness.controller.authorizationGovernanceError.value).toBe("");
    expect(harness.controller.authorizationGovernance.value.teams).toHaveLength(2);
    expect(harness.controller.authorizationGovernanceMetrics.value).toEqual([
      { label: "角色", value: 1 },
      { label: "团队", value: 2 },
      { label: "用户策略", value: 1 },
      { label: "智能体绑定", value: 1 },
      { label: "审批", value: 2 },
    ]);
  });

  it("saves governance, refreshes after save, and reports fallback errors", async () => {
    authorizationGovernanceClientMock.getAuthorizationGovernance
      .mockResolvedValueOnce({ governance: makeGovernance() });

    const harness = createHarness();
    mountedWrappers.push(harness.wrapper);
    await flushPromises();

    const saveGate = deferred<void>();
    authorizationGovernanceClientMock.upsertAuthorizationGovernance.mockReturnValueOnce(saveGate.promise);
    authorizationGovernanceClientMock.getAuthorizationGovernance.mockResolvedValueOnce({
      governance: makeGovernance({
        approvals: [{ id: "approval-1" }],
      }),
    });

    harness.controller.authorizationGovernanceEditorKind.value = "agentGroup";
    await nextTick();
    harness.controller.authorizationGovernanceEditorBody.value = JSON.stringify({
      groupId: "group-save",
      label: "Saved group",
    });

    const pendingSave = harness.controller.saveAuthorizationGovernanceEditor();
    expect(harness.controller.authorizationGovernanceSaving.value).toBe(true);
    expect(harness.controller.authorizationGovernanceEditorStatus.value).toBe("");
    expect(harness.controller.authorizationGovernanceError.value).toBe("");

    saveGate.resolve();
    await pendingSave;

    expect(authorizationGovernanceClientMock.upsertAuthorizationGovernance).toHaveBeenCalledWith("agentGroup", {
      groupId: "group-save",
      label: "Saved group",
    });
    expect(authorizationGovernanceClientMock.getAuthorizationGovernance).toHaveBeenCalledTimes(2);
    expect(harness.controller.authorizationGovernanceSaving.value).toBe(false);
    expect(harness.controller.authorizationGovernanceEditorStatus.value).toBe("已保存");
    expect(harness.controller.authorizationGovernance.value.approvals).toHaveLength(1);

    harness.controller.authorizationGovernanceEditorBody.value = "{}";
    authorizationGovernanceClientMock.upsertAuthorizationGovernance.mockRejectedValueOnce("bad save");
    await harness.controller.saveAuthorizationGovernanceEditor();

    expect(harness.controller.authorizationGovernanceEditorStatus.value).toBe("保存失败");
    expect(harness.controller.authorizationGovernanceSaving.value).toBe(false);

    authorizationGovernanceClientMock.getAuthorizationGovernance.mockRejectedValueOnce(new Error("load failed"));
    await harness.controller.refreshAuthorizationGovernance();
    expect(harness.controller.authorizationGovernanceLoading.value).toBe(false);
    expect(harness.controller.authorizationGovernanceError.value).toBe("load failed");
  });

  it("switches tool selection and mutates permission group helpers", async () => {
    authorizationGovernanceClientMock.getAuthorizationGovernance.mockResolvedValueOnce({
      governance: makeGovernance({ roles: [] }),
    });

    const harness = createHarness();
    mountedWrappers.push(harness.wrapper);
    await flushPromises();

    expect(harness.controller.agentPermissionGroups.value).toHaveLength(2);
    expect(harness.toolManagementConsole.ensureAgentPermissionGroupsDraft).toHaveBeenCalledTimes(1);
    expect(harness.controller.selectedToolManagementTool.value?.id).toBe("tool-a");

    harness.controller.handleSelectedToolChange({
      target: { value: "tool-b" },
    } as unknown as Event);
    expect(harness.toolManagementConsole.selectToolForManagement).toHaveBeenCalledWith("tool-b");
    expect(harness.controller.selectedToolManagementTool.value?.id).toBe("tool-b");

    harness.controller.handleSelectedToolChange({
      target: null,
    } as unknown as Event);
    expect(harness.toolManagementConsole.selectToolForManagement).toHaveBeenCalledWith("");
    expect(harness.controller.selectedToolManagementTool.value?.id).toBe("tool-a");

    const group = harness.controller.agentPermissionGroups.value[0];
    expect(harness.controller.permissionGroupHasToolset(group, "toolset.read")).toBe(true);
    expect(harness.controller.permissionGroupHasToolset(group, "toolset.safe")).toBe(false);
    expect(harness.controller.permissionGroupToolRuleState(group, "tool.allow")).toBe("allow");
    expect(harness.controller.permissionGroupToolRuleState(group, "tool.deny")).toBe("deny");
    expect(harness.controller.permissionGroupToolRuleState(group, "missing")).toBe("inherit");

    harness.controller.setPermissionGroupToolRule(group, "tool.allow", "deny");
    expect(group.toolAllow).not.toContain("tool.allow");
    expect(group.toolDeny).toContain("tool.allow");
    expect(harness.controller.permissionGroupToolRuleState(group, "tool.allow")).toBe("deny");

    harness.controller.setPermissionGroupToolRule(group, "tool.allow", "allow");
    expect(group.toolAllow).toContain("tool.allow");
    expect(group.toolDeny).not.toContain("tool.allow");
    expect(harness.controller.permissionGroupToolRuleState(group, "tool.allow")).toBe("allow");

    harness.controller.setPermissionGroupToolRule(group, "tool.allow", "inherit");
    expect(group.toolAllow).not.toContain("tool.allow");
    expect(group.toolDeny).not.toContain("tool.allow");
    expect(harness.controller.permissionGroupToolRuleState(group, "tool.allow")).toBe("inherit");

    expect(harness.controller.itemText({ label: "优先", alias: "备用" }, ["label", "alias"], "fallback")).toBe("优先");
    expect(harness.controller.itemText({}, ["label", "alias"], "fallback")).toBe("fallback");
    expect(harness.controller.shortList(["alpha", "beta", "gamma", "delta"])).toBe("alpha, beta, gamma +1");
    expect(harness.controller.shortList("alpha, beta, gamma")).toBe("alpha, beta, gamma");
    expect(harness.controller.shortList([], "未配置")).toBe("未配置");
    expect(harness.controller.policyCount({ resourcePolicies: [{}, {}] })).toBe(2);
    expect(harness.controller.policyCount({ resourcePolicies: "bad" as unknown as Array<Record<string, unknown>> })).toBe(0);
  });
});
