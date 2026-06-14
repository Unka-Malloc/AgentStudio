// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentPermissionGroupCard from "../../../server-web/components/admin/agent-permissions/AgentPermissionGroupCard.vue";
import GrantToolRulePanel from "../../../server-web/components/admin/agent-permissions/GrantToolRulePanel.vue";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";

type MountedWrapper = VueWrapper;
const mounted: MountedWrapper[] = [];

type TestScope = { id: string; label: string; description: string };
type TestToolset = { id: string; label: string; maxRisk: string; grantable?: boolean };
type TestTool = { id: string; label: string; description: string };
type TestPermissionGroup = {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
  scopeIds: string[];
  toolsetIds: string[];
  toolAllow: string[];
  toolDeny: string[];
};
type TestGrant = {
  id: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  toolsets: string[];
  toolAllow: string[];
  toolDeny: string[];
};

const mockContext = {
  permissionGroupHasToolset: vi.fn(),
  removeAgentPermissionGroup: vi.fn(),
  setPermissionGroupToolRule: vi.fn(),
  togglePermissionGroupToolset: vi.fn(),
  setGrantToolRule: vi.fn(),
  toolManagementTools: ref<TestTool[]>([]),
  toolManagementToolsets: ref<TestToolset[]>([]),
  toolScopes: ref<TestScope[]>([]),
  toolGrants: ref<TestGrant[]>([]),
  busyKey: ref(""),
} as const;

vi.mock("../../../server-web/composables/agentPermissionsViewContext", () => ({
  useAgentPermissionsViewContext: () => mockContext,
}));

function makeScopes() {
  return [
    { id: "knowledge:read", label: "知识读取", description: "查看知识库" },
    { id: "agent:operate", label: "智能体操作", description: "调用工具权限" },
    { id: "workspace:read", label: "工作空间读取", description: "读取工作空间" },
  ];
}

function makeToolsets() {
  return [
    { id: "toolset.read", label: "安全只读工具", maxRisk: "read_only", grantable: true },
    { id: "toolset.safe", label: "安全写入工具", maxRisk: "safe_write", grantable: true },
    { id: "toolset.hidden", label: "隐藏工具集", maxRisk: "high", grantable: false },
  ];
}

function makeTools() {
  return [
    { id: "tool.a", label: "Alpha Tool", description: "Alpha tool" },
    { id: "tool.b", label: "Beta Tool", description: "Beta tool" },
    { id: "tool.c", label: "Gamma Tool", description: "Gamma tool" },
  ];
}

function makePermissionGroup(overrides: Partial<TestPermissionGroup> = {}): TestPermissionGroup {
  return {
    id: "group-main",
    label: "主权限组",
    enabled: true,
    description: "用于规则覆盖测试",
    scopeIds: ["knowledge:read", "workspace:read"],
    toolsetIds: ["toolset.read"],
    toolAllow: [],
    toolDeny: [],
    ...overrides,
  };
}

function makeGrant(overrides: Partial<TestGrant> = {}): TestGrant {
  return {
    id: "grant-main",
    label: "令牌主组",
    enabled: true,
    scopes: ["agent:operate"],
    toolsets: ["toolset.read"],
    toolAllow: [],
    toolDeny: [],
    ...overrides,
  };
}

function mountGroupCard(group: TestPermissionGroup) {
  const wrapper = mount(AgentPermissionGroupCard, {
    props: { group },
  });
  mounted.push(wrapper);
  return wrapper;
}

function mountGrantPanel() {
  const wrapper = mount(GrantToolRulePanel);
  mounted.push(wrapper);
  return wrapper;
}

function findButtonByText(wrapper: MountedWrapper, text: string) {
  return wrapper.findAll("button").find((button) => button.text().trim() === text);
}

function wait() {
  return nextTick();
}

beforeEach(() => {
  mockContext.permissionGroupHasToolset.mockReset();
  mockContext.removeAgentPermissionGroup.mockReset();
  mockContext.setPermissionGroupToolRule.mockReset();
  mockContext.togglePermissionGroupToolset.mockReset();
  mockContext.setGrantToolRule.mockReset();
  mockContext.permissionGroupHasToolset.mockImplementation((group, toolsetId) =>
    group.toolsetIds.includes(toolsetId),
  );
  mockContext.toolManagementTools.value = makeTools();
  mockContext.toolManagementToolsets.value = makeToolsets();
  mockContext.toolScopes.value = makeScopes();
  mockContext.toolGrants.value = [];
  mockContext.busyKey.value = "";
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.unmount();
  }
  vi.resetAllMocks();
  document.body.innerHTML = "";
  document.documentElement.lang = "";
  setConsoleLocaleState("zh-CN");
});

describe("AgentPermissionGroupCard", () => {
  it("renders props into form fields and overview summary", async () => {
    const group = makePermissionGroup({
      toolAllow: ["tool.a"],
      toolDeny: ["tool.b"],
      toolsetIds: ["toolset.read", "toolset.safe"],
      enabled: false,
    });

    const wrapper = mountGroupCard(group);
    await wait();

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(3);
    expect(inputs[0].element.value).toBe("主权限组");
    expect(inputs[1].element.value).toBe("group-main");
    expect(inputs[2].element.value).toBe("用于规则覆盖测试");
    expect(wrapper.find(".feature-toggle").exists()).toBe(true);
    expect(wrapper.attributes("data-enabled")).toBe("false");

    const summary = wrapper.find(".agent-permission-summary-grid").text();
    expect(summary).toContain("2");
    expect(summary).toContain("2");
    expect(summary).toContain("1");
    expect(summary).toContain("1");
    expect(wrapper.text()).toContain("知识读取 / 工作空间读取");
    expect(wrapper.text()).toContain("安全只读工具 / 安全写入工具");
    expect(wrapper.text()).toContain("2 项例外");

    await findButtonByText(wrapper, "删除")?.trigger("click");
    expect(mockContext.removeAgentPermissionGroup).toHaveBeenCalledWith(group);
  });

  it("localizes preset group name and description fields in English without mutating the draft", async () => {
    document.documentElement.lang = "en";
    setConsoleLocaleState("en");
    const group = makePermissionGroup({
      id: "agent-permission-knowledge-reader",
      label: "知识读取组",
      description: "只允许读取知识、执行只读召回和健康检查。",
    });

    const wrapper = mountGroupCard(group);
    await wait();

    const inputs = wrapper.findAll("input");
    expect(inputs[0].element.value).toBe("Knowledge Reader Group");
    expect(inputs[2].element.value).toBe("Allows knowledge reads, read-only retrieval, and health checks only.");
    expect(group.label).toBe("知识读取组");
    expect(group.description).toBe("只允许读取知识、执行只读召回和健康检查。");

    await inputs[0].setValue("Custom Reader");
    expect(group.label).toBe("Custom Reader");
  });

  it("switches sections, toggles grantable toolsets, and edits exception entries", async () => {
    const group = makePermissionGroup({
      toolAllow: ["tool.a"],
      toolDeny: ["tool.b"],
      toolsetIds: ["toolset.read"],
    });

    const wrapper = mountGroupCard(group);
    await wait();

    const tabs = wrapper.findAll(".pact-tab");
    await tabs[1].trigger("click");
    await wait();
    expect(wrapper.find(".scope-selector").exists()).toBe(true);

    await tabs[2].trigger("click");
    await wait();
    const scopeChips = wrapper.findAll(".scope-chip");
    expect(scopeChips).toHaveLength(2);
    expect(scopeChips[0].text()).toContain("安全只读工具");
    expect(scopeChips[1].text()).toContain("安全写入工具");
    await scopeChips[0].trigger("click");
    expect(mockContext.togglePermissionGroupToolset).toHaveBeenCalledWith(group, "toolset.read");

    await tabs[3].trigger("click");
    await wait();
    expect(wrapper.text()).toContain("允许");
    expect(wrapper.text()).toContain("未启用");

    const exceptionRows = wrapper.findAll(".job-row");
    expect(exceptionRows).toHaveLength(2);
    const toolSelect = wrapper.findAll("select")[0];
    const ruleSelect = wrapper.findAll("select")[1];

    await toolSelect.setValue("tool.c");
    await ruleSelect.setValue("allow");
    await findButtonByText(wrapper, "添加例外")?.trigger("click");
    expect(mockContext.setPermissionGroupToolRule).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }), "tool.c", "allow");

    const allowRow = exceptionRows.find((row) => row.text().includes("tool.a") || row.text().includes("Alpha Tool"));
    const denyRow = exceptionRows.find((row) => row.text().includes("tool.b") || row.text().includes("Beta Tool"));
    await allowRow?.findAll("button")[0].trigger("click");
    await allowRow?.findAll("button")[1].trigger("click");
    await allowRow?.findAll("button")[2].trigger("click");
    await denyRow?.findAll("button")[0].trigger("click");
    expect(mockContext.setPermissionGroupToolRule).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }), "tool.a", "inherit");
    expect(mockContext.setPermissionGroupToolRule).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }), "tool.a", "allow");
    expect(mockContext.setPermissionGroupToolRule).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }), "tool.a", "deny");
    expect(mockContext.setPermissionGroupToolRule).toHaveBeenCalledWith(expect.objectContaining({ id: group.id }), "tool.b", "inherit");
  });

  it("renders catalog empty-state when tools are missing in exception section", async () => {
    mockContext.toolManagementTools.value = [];

    const group = makePermissionGroup({
      toolAllow: [],
      toolDeny: [],
    });
    const wrapper = mountGroupCard(group);
    await wait();

    const tabs = wrapper.findAll(".pact-tab");
    await tabs[3].trigger("click");
    await wait();

    expect(wrapper.text()).toContain("尚未加载工具目录");
  });
});

describe("GrantToolRulePanel", () => {
  it("renders empty state for missing grants", async () => {
    mockContext.toolGrants.value = [];
    const wrapper = mountGrantPanel();
    await wait();

    expect(wrapper.find(".empty-state strong").text()).toBe("暂无授权");
  });

  it("renders exception rows, emits add flow, and handles row actions", async () => {
    mockContext.toolGrants.value = [
      makeGrant({
        id: "grant-1",
        label: "令牌一",
        toolAllow: ["tool.a"],
      }),
      makeGrant({
        id: "grant-2",
        label: "令牌二",
        toolDeny: ["tool.b"],
        toolAllow: [],
      }),
    ];
    const wrapper = mountGrantPanel();
    await wait();

    expect(wrapper.text()).toContain("令牌工具例外");
    expect(wrapper.find(".permission-exception-toolbar").exists()).toBe(true);

    const selects = wrapper.findAll("select");
    expect(selects).toHaveLength(3);
    await selects[1].setValue("tool.b");
    await selects[2].setValue("allow");
    await findButtonByText(wrapper, "添加例外")?.trigger("click");

    const grant = mockContext.toolGrants.value[0];
    expect(mockContext.setGrantToolRule).toHaveBeenCalledWith(grant, "tool.b", "allow");

    const rows = wrapper.findAll(".job-row");
    expect(rows).toHaveLength(2);
    const rowForGrant2 = rows.find((row) => row.text().includes("令牌二"));
    expect(rowForGrant2?.text()).toContain("Beta Tool");

    await rowForGrant2?.findAll("button")[1].trigger("click");
    expect(mockContext.setGrantToolRule).toHaveBeenCalledWith(mockContext.toolGrants.value[1], "tool.b", "allow");
  });

  it("disables row actions when busy key matches the grant", async () => {
    const grant = makeGrant({
      id: "grant-1",
      label: "令牌一",
      toolAllow: ["tool.a", "tool.b", "tool.c"],
      toolDeny: [],
    });
    mockContext.toolGrants.value = [grant];
    const wrapper = mountGrantPanel();
    await wait();

    mockContext.busyKey.value = "grant:grant-1";
    await wait();

    const row = wrapper.find(".job-row");
    const buttons = row.findAll("button");
    for (const button of buttons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
  });

  it("renders no-exception empty state when no overrides are configured", async () => {
    mockContext.toolGrants.value = [
      makeGrant({
        id: "grant-1",
        label: "令牌一",
        toolAllow: [],
        toolDeny: [],
      }),
    ];
    const wrapper = mountGrantPanel();
    await wait();

    const emptyState = wrapper.find(".empty-state");
    expect(emptyState.text()).toContain("暂无工具例外");
  });

  it("disables add controls when no tools are available for selected grant", async () => {
    mockContext.toolGrants.value = [
      makeGrant({
        id: "grant-1",
        label: "令牌一",
        toolAllow: [...makeTools().map((tool) => tool.id)],
        toolDeny: [],
      }),
    ];
    const wrapper = mountGrantPanel();
    await wait();

    const selects = wrapper.findAll("select");
    expect(selects).toHaveLength(3);
    expect(selects[1].attributes("disabled")).toBeDefined();
    expect(findButtonByText(wrapper, "添加例外")?.attributes("disabled")).toBeDefined();
  });
});
