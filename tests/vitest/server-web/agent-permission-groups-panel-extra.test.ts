// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentPermissionGroupsPanel from "../../../server-web/components/admin/agent-permissions/AgentPermissionGroupsPanel.vue";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";

type PermissionGroup = {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
  scopeIds: string[];
  toolsetIds: string[];
  toolAllow: string[];
  toolDeny: string[];
};

type MockContext = {
  addAgentPermissionGroup: ReturnType<typeof vi.fn>;
  busyKey: ReturnType<typeof ref<string>>;
  ensureAgentPermissionGroupsDraft: ReturnType<typeof vi.fn>;
  saveAgentPermissionSettings: ReturnType<typeof vi.fn>;
  settingsDraft: ReturnType<typeof ref<{ agentPermissionGroups: PermissionGroup[] }>>;
  toolManagementToolsets: ReturnType<typeof ref<string[]>>;
  toolScopes: ReturnType<typeof ref<string[]>>;
};

const mockContext: MockContext = {
  addAgentPermissionGroup: vi.fn(),
  busyKey: ref(""),
  ensureAgentPermissionGroupsDraft: vi.fn(),
  saveAgentPermissionSettings: vi.fn(),
  settingsDraft: ref({ agentPermissionGroups: [] }),
  toolManagementToolsets: ref([]),
  toolScopes: ref([]),
};

vi.mock("../../../server-web/composables/agentPermissionsViewContext", () => ({
  useAgentPermissionsViewContext: () => mockContext,
}));

vi.mock("../../../server-web/components/admin/agent-permissions/AgentPermissionGroupCard.vue", () => ({
  default: {
    name: "AgentPermissionGroupCardStub",
    props: {
      group: { type: Object, required: true },
    },
    emits: ["delete-group"],
    template: `
      <section class="agent-permission-group-card-stub">
        <div class="agent-permission-group-card-id">{{ group.id }}</div>
        <button class="agent-permission-group-card-delete" type="button" @click="$emit('delete-group', group)">
          删除
        </button>
      </section>
    `,
  },
}));

const mountedWrappers: VueWrapper[] = [];

function buildGroup(overrides: Partial<PermissionGroup> = {}): PermissionGroup {
  return {
    id: "group-operator",
    label: "运营组",
    enabled: true,
    description: "平台级能力配置",
    scopeIds: ["scope:read", "scope:write"],
    toolsetIds: ["toolset.read", "toolset.edit"],
    toolAllow: ["tool.a"],
    toolDeny: [],
    ...overrides,
  };
}

function mountPanel() {
  const wrapper = mount(AgentPermissionGroupsPanel, {
    attachTo: document.body,
    global: {
      stubs: {
        FeatureToggle: { template: "<span />" },
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function findButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAll("button").find((button) => button.text().trim() === label);
}

function setDefaultContext(overrides: Partial<MockContext> = {}) {
  const baseGroups = [
    buildGroup({
      id: "group-operator",
      label: "运营组",
      enabled: true,
      description: "用于默认权限定义",
      scopeIds: ["scope:read", "scope:write"],
      toolsetIds: ["toolset.read", "toolset.edit"],
      toolAllow: ["tool.a"],
      toolDeny: ["tool.b"],
    }),
    buildGroup({
      id: "group-reviewer",
      label: "审查组",
      enabled: false,
      description: "用于审查流程",
      scopeIds: ["scope:read"],
      toolsetIds: ["toolset.read"],
      toolAllow: ["tool.b"],
      toolDeny: [],
    }),
  ];
  mockContext.addAgentPermissionGroup.mockReset();
  mockContext.ensureAgentPermissionGroupsDraft.mockReset();
  mockContext.saveAgentPermissionSettings.mockReset();
  mockContext.busyKey.value = "";
  mockContext.settingsDraft.value = {
    ...(overrides.settingsDraft?.value || {
      agentPermissionGroups: baseGroups,
    }),
  };
  mockContext.toolScopes.value = overrides.toolScopes?.value ?? ["scope:read", "scope:write", "scope:manage"];
  mockContext.toolManagementToolsets.value = overrides.toolManagementToolsets?.value ?? ["toolset.read", "toolset.edit", "toolset.safe"];
  Object.assign(mockContext, overrides);
}

beforeEach(() => {
  setDefaultContext();
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  mockContext.addAgentPermissionGroup.mockReset();
  mockContext.ensureAgentPermissionGroupsDraft.mockReset();
  mockContext.saveAgentPermissionSettings.mockReset();
  mockContext.busyKey.value = "";
  document.body.innerHTML = "";
  document.documentElement.lang = "";
  setConsoleLocaleState("zh-CN");
  vi.restoreAllMocks();
});

describe("AgentPermissionGroupsPanel", () => {
  it("renders statistics and group list with first group selected", async () => {
    const wrapper = mountPanel();
    await nextTick();

    const metrics = wrapper.findAll(".agent-permission-toolbar-metrics > span");
    expect(metrics[0].text()).toContain("层级");
    expect(metrics[0].text()).toContain("3");
    expect(metrics[1].text()).toContain("工具集");
    expect(metrics[1].text()).toContain("3");
    expect(metrics[2].text()).toContain("组");
    expect(metrics[2].text()).toContain("2");
    expect(metrics[3].text()).toContain("启用");
    expect(metrics[3].text()).toContain("1");

    const items = wrapper.findAll(".agent-permission-group-list-item");
    expect(items).toHaveLength(2);
    expect(items[0].classes()).toContain("active");
    expect(items[0].text()).toContain("运营组");
    expect(items[0].text()).toContain("启用");
    expect(items[1].text()).toContain("审查组");
    expect(items[1].text()).toContain("停用");
    expect(items[0].text()).toContain("2 范围");
    expect(items[0].text()).toContain("2 工具集");
    expect(items[0].text()).toContain("2 例外");
    expect(wrapper.find(".agent-permission-group-card-stub").text()).toContain("group-operator");
  });

  it("renders toolbar and group statistics in English", async () => {
    document.documentElement.lang = "en";
    setConsoleLocaleState("en");
    const wrapper = mountPanel();
    await nextTick();

    const metrics = wrapper.findAll(".agent-permission-toolbar-metrics > span").map((node) => node.text());
    expect(metrics).toEqual(["Layers 3", "Toolsets 3", "Groups 2", "Enable 1"]);

    const firstItem = wrapper.find(".agent-permission-group-list-item");
    expect(firstItem.text()).toContain("Enable");
    expect(firstItem.text()).toContain("2 Scopes");
    expect(firstItem.text()).toContain("2 Toolsets");
    expect(firstItem.text()).toContain("2 Exceptions");
  });

  it("localizes known preset permission group names in English", async () => {
    document.documentElement.lang = "en";
    setConsoleLocaleState("en");
    mockContext.settingsDraft.value = {
      agentPermissionGroups: [
        buildGroup({
          id: "agent-permission-knowledge-reader",
          label: "知识读取组",
          description: "只允许读取知识、执行只读召回和健康检查。",
        }),
      ],
    };

    const wrapper = mountPanel();
    await nextTick();

    expect(wrapper.find(".agent-permission-group-list-title strong").text()).toBe("Knowledge Reader Group");
  });

  it("switches selected group when clicking list entries", async () => {
    const wrapper = mountPanel();
    await nextTick();

    const listItems = wrapper.findAll(".agent-permission-group-list-item");
    await listItems[1].trigger("click");
    await nextTick();

    expect(listItems[1].classes()).toContain("active");
    expect(wrapper.find(".agent-permission-group-card-id").text()).toBe("group-reviewer");
  });

  it("handles ensure draft action to recover default groups and select the computed active group", async () => {
    const wrapper = mountPanel();
    await nextTick();

    const listItems = wrapper.findAll(".agent-permission-group-list-item");
    await listItems[1].trigger("click");
    await nextTick();
    expect(wrapper.find(".agent-permission-group-card-id").text()).toBe("group-reviewer");

    mockContext.ensureAgentPermissionGroupsDraft.mockImplementation(() => {
      mockContext.settingsDraft.value = {
        agentPermissionGroups: [
          buildGroup({
            id: "group-default",
            label: "默认组",
            description: "自动生成的默认组",
            enabled: true,
            scopeIds: ["scope:read"],
            toolsetIds: ["toolset.read"],
            toolAllow: [],
            toolDeny: [],
          }),
        ],
      };
    });

    const refreshButton = findButton(wrapper, "生成默认组");
    expect(refreshButton).not.toBeUndefined();
    await refreshButton?.trigger("click");
    await nextTick();

    expect(mockContext.ensureAgentPermissionGroupsDraft).toHaveBeenCalledOnce();
    expect(wrapper.find(".agent-permission-group-card-id").text()).toBe("group-default");
    const items = wrapper.findAll(".agent-permission-group-list-item");
    expect(items).toHaveLength(1);
  });

  it("adds a new group and selects the first draft group", async () => {
    const wrapper = mountPanel();
    await nextTick();

    mockContext.addAgentPermissionGroup.mockImplementation(() => {
      mockContext.settingsDraft.value = {
        agentPermissionGroups: [
          buildGroup({
            id: "group-added",
            label: "新增组",
            enabled: true,
            description: "新建权限组",
            scopeIds: ["scope:read"],
            toolsetIds: ["toolset.read"],
            toolAllow: [],
            toolDeny: [],
          }),
          ...mockContext.settingsDraft.value.agentPermissionGroups,
        ],
      };
    });

    const addButton = findButton(wrapper, "新增");
    expect(addButton).not.toBeUndefined();
    await addButton?.trigger("click");
    await nextTick();

    expect(mockContext.addAgentPermissionGroup).toHaveBeenCalledOnce();
    expect(wrapper.find(".agent-permission-group-card-id").text()).toBe("group-added");
  });

  it("shows empty state when no permission groups exist", async () => {
    mockContext.settingsDraft.value = { agentPermissionGroups: [] };
    const wrapper = mountPanel();
    await nextTick();

    expect(wrapper.find(".agent-permission-workbench-body").exists()).toBe(false);
    const emptyState = wrapper.find(".empty-state");
    expect(emptyState.exists()).toBe(true);
    expect(emptyState.text()).toContain("暂无权限组");
    expect(wrapper.text()).toContain('点击"生成默认组"快速创建预设权限配置。');
  });

  it("falls back to id when label/description are empty", async () => {
    mockContext.settingsDraft.value = {
      agentPermissionGroups: [
        buildGroup({
          id: "group-fallback",
          label: "",
          description: "",
          enabled: true,
          scopeIds: [],
          toolsetIds: [],
          toolAllow: [],
          toolDeny: [],
        }),
      ],
    };

    const wrapper = mountPanel();
    await nextTick();

    const item = wrapper.find(".agent-permission-group-list-item");
    expect(item.text()).toContain("group-fallback");
    expect(wrapper.find(".agent-permission-group-card-id").text()).toContain("group-fallback");
  });

  it("handles ensure action resulting in empty draft by resetting selected group id", async () => {
    const wrapper = mountPanel();
    await nextTick();

    mockContext.ensureAgentPermissionGroupsDraft.mockImplementation(() => {
      mockContext.settingsDraft.value = { agentPermissionGroups: [] };
    });

    const refreshButton = findButton(wrapper, "生成默认组");
    await refreshButton?.trigger("click");
    await nextTick();

    expect(mockContext.ensureAgentPermissionGroupsDraft).toHaveBeenCalledOnce();
    expect(wrapper.find(".agent-permission-workbench-body").exists()).toBe(false);
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  it("disables save while busy and calls save when idle", async () => {
    const wrapper = mountPanel();
    const saveButton = findButton(wrapper, "保存");
    expect(saveButton).not.toBeUndefined();
    await saveButton?.trigger("click");
    expect(mockContext.saveAgentPermissionSettings).toHaveBeenCalledOnce();

    mockContext.saveAgentPermissionSettings.mockReset();
    mockContext.busyKey.value = "agent-permissions-save";
    await nextTick();

    const busySaveButton = findButton(wrapper, "保存中");
    expect(busySaveButton?.attributes("disabled")).toBeDefined();
    await busySaveButton?.trigger("click");
    expect(mockContext.saveAgentPermissionSettings).not.toHaveBeenCalled();
  });
});
