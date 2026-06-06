// @vitest-environment jsdom
import { computed, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ToolGrantListCard from "../../../server-web/components/admin/agent-permissions/ToolGrantListCard.vue";
import type {
  ToolManagementGrant,
  ToolManagementScope,
  ToolManagementToolset,
} from "../../../server-web/lib/types";

const busyKey = ref("");
const toolGrants = ref<ToolManagementGrant[]>([]);
const toolManagementToolsets = ref<ToolManagementToolset[]>([]);
const toolScopes = ref<ToolManagementScope[]>([]);

const mockContext = {
  busyKey,
  deleteGrant: vi.fn(),
  enabledToolGrantCount: computed(() => toolGrants.value.filter((grant) => grant.enabled).length),
  formatCompactDate: vi.fn((value: string) => `formatted:${value.slice(0, 10)}`),
  grantHasToolset: vi.fn((grant: ToolManagementGrant, toolsetId: string) =>
    (grant.toolsets || []).includes(toolsetId),
  ),
  rotateGrant: vi.fn(),
  toggleGrantToolset: vi.fn(),
  toolGrants,
  toolManagementToolsets,
  toolScopes,
  updateGrant: vi.fn(),
} as const;

vi.mock("../../../server-web/composables/agentPermissionsViewContext", () => ({
  useAgentPermissionsViewContext: () => mockContext,
}));

const mountedWrappers: VueWrapper[] = [];

function makeScope(overrides: Partial<ToolManagementScope> = {}): ToolManagementScope {
  return {
    id: "knowledge:read",
    label: "知识读取",
    description: "查看知识库",
    ...overrides,
  };
}

function makeToolset(overrides: Partial<ToolManagementToolset> = {}): ToolManagementToolset {
  return {
    id: "toolset.read",
    label: "安全只读工具",
    requiredScopes: ["knowledge:read"],
    maxRisk: "read_only",
    grantable: true,
    ...overrides,
  };
}

function makeGrant(overrides: Partial<ToolManagementGrant> = {}): ToolManagementGrant {
  return {
    id: "grant-active",
    label: "主授权",
    enabled: true,
    toolsets: ["toolset.read", "toolset.safe", "toolset.audit", "toolset.hidden"],
    toolAllow: ["tool.a"],
    toolDeny: ["tool.b", "tool.c"],
    scopes: ["knowledge:read", "workspace:read"],
    tokenPrefix: "tk-active",
    hasToken: true,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-12T08:30:00.000Z",
    lastUsedAt: "2026-05-18T10:15:00.000Z",
    ...overrides,
  };
}

function mountCard() {
  const wrapper = mount(ToolGrantListCard);
  mountedWrappers.push(wrapper);
  return wrapper;
}

function getCard(wrapper: VueWrapper, index: number) {
  return wrapper.findAll(".permission-card")[index];
}

function getGrantPanel(card: ReturnType<typeof getCard>, index: number) {
  return card.findAll("details.permission-token-config-panel")[index];
}

function setDefaultContext() {
  busyKey.value = "";
  toolGrants.value = [
    makeGrant(),
    makeGrant({
      id: "grant-disabled",
      label: "备用授权",
      enabled: false,
      toolsets: [],
      toolAllow: [],
      toolDeny: [],
      scopes: ["agent:operate"],
      tokenPrefix: "",
      hasToken: false,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: "",
    }),
  ];
  toolManagementToolsets.value = [
    makeToolset(),
    makeToolset({
      id: "toolset.safe",
      label: "安全写入工具",
      requiredScopes: ["workspace:read"],
      maxRisk: "safe_write",
    }),
    makeToolset({
      id: "toolset.audit",
      label: "审计工具",
      requiredScopes: ["agent:operate"],
      maxRisk: "repair_write",
    }),
    makeToolset({
      id: "toolset.hidden",
      label: "隐藏工具集",
      requiredScopes: ["system:read"],
      maxRisk: "high",
      grantable: false,
    }),
  ];
  toolScopes.value = [
    makeScope(),
    makeScope({
      id: "agent:operate",
      label: "智能体操作",
      description: "调用工具权限",
    }),
    makeScope({
      id: "workspace:read",
      label: "工作空间读取",
      description: "读取工作空间",
    }),
  ];
}

function resetMocks() {
  vi.clearAllMocks();
  setDefaultContext();
}

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
});

describe("ToolGrantListCard extra", () => {
  it("renders the grant list with enabled counts, summary fields, and selector contents", async () => {
    const wrapper = mountCard();
    await Promise.resolve();

    expect(wrapper.text()).toContain("工具令牌");
    expect(wrapper.text()).toContain("启用 1");
    expect(wrapper.text()).toContain("总计 2");

    const cards = wrapper.findAll(".permission-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].attributes("data-enabled")).toBe("true");
    expect(cards[1].attributes("data-enabled")).toBe("false");

    expect(cards[0].find("input").element.value).toBe("主授权");
    expect(cards[0].text()).toContain("tk-active");
    expect(cards[0].text()).toContain("formatted:2026-05-18");
    expect(cards[0].text()).toContain("权限范围");
    expect(cards[0].text()).toContain("2");
    expect(cards[0].text()).toContain("工具集");
    expect(cards[0].text()).toContain("安全只读工具 / 安全写入工具 / 审计工具 +1");
    expect(cards[0].text()).toContain("例外");
    expect(cards[0].text()).toContain("3");

    expect(cards[1].find("input").element.value).toBe("备用授权");
    expect(cards[1].text()).toContain("未生成");
    expect(cards[1].text()).toContain("未使用");
    expect(cards[1].text()).toContain("未声明");
    expect(cards[1].text()).toContain("0");

    expect(mockContext.formatCompactDate).toHaveBeenCalledWith("2026-05-18T10:15:00.000Z");

    const scopePanel = getGrantPanel(cards[0], 0);
    const toolsetPanel = getGrantPanel(cards[0], 1);
    const scopeChips = scopePanel.findAll(".scope-chip");
    const toolsetChips = toolsetPanel.findAll(".scope-chip");

    expect(scopePanel.text()).toContain("编辑授权范围");
    expect(scopePanel.text()).toContain("智能体 (Agent)");
    expect(scopePanel.text()).toContain("知识库 (Knowledge)");
    expect(scopePanel.text()).toContain("工作空间 (Workspace)");
    expect(scopeChips).toHaveLength(3);
    expect(scopeChips.map((chip) => chip.text().trim())).toEqual([
      "智能体操作agent:operate",
      "知识读取knowledge:read",
      "工作空间读取workspace:read",
    ]);

    expect(toolsetPanel.text()).toContain("编辑工具集");
    expect(toolsetChips).toHaveLength(3);
    expect(toolsetChips.map((chip) => chip.text().trim())).toEqual([
      "安全只读工具",
      "安全写入工具",
      "审计工具",
    ]);
    expect(toolsetPanel.text()).not.toContain("隐藏工具集");
  });

  it("emits update and action callbacks from the active grant controls", async () => {
    const wrapper = mountCard();
    await Promise.resolve();

    const firstCard = getCard(wrapper, 0);

    const labelInput = firstCard.find("input");
    await labelInput.setValue("主授权-已更新");
    expect(mockContext.updateGrant).toHaveBeenCalledWith(
      mockContext.toolGrants.value[0],
      { label: "主授权-已更新" },
    );

    const toggle = firstCard.find("button[role='switch']");
    await toggle.trigger("click");
    expect(mockContext.updateGrant).toHaveBeenCalledWith(
      mockContext.toolGrants.value[0],
      { enabled: false },
    );

    const rotateButton = firstCard.findAll("button").find((button) => button.text().trim() === "轮换");
    const deleteButton = firstCard.findAll("button").find((button) => button.text().trim() === "撤销");
    await rotateButton?.trigger("click");
    await deleteButton?.trigger("click");
    expect(mockContext.rotateGrant).toHaveBeenCalledWith(mockContext.toolGrants.value[0]);
    expect(mockContext.deleteGrant).toHaveBeenCalledWith(mockContext.toolGrants.value[0]);

    const scopeChips = getGrantPanel(firstCard, 0).findAll(".scope-chip");
    await scopeChips[0].trigger("click");
    expect(mockContext.updateGrant).toHaveBeenCalledWith(
      mockContext.toolGrants.value[0],
      { scopes: ["knowledge:read", "workspace:read", "agent:operate"] },
    );

    const toolsetChips = getGrantPanel(firstCard, 1).findAll(".scope-chip");
    await toolsetChips[2].trigger("click");
    expect(mockContext.toggleGrantToolset).toHaveBeenCalledWith(
      mockContext.toolGrants.value[0],
      "toolset.audit",
    );
  });

  it("shows the empty state when there are no grants", async () => {
    toolGrants.value = [];

    const wrapper = mountCard();
    await Promise.resolve();

    expect(wrapper.find(".permission-list").exists()).toBe(false);
    expect(wrapper.find(".empty-state").text()).toContain("暂无工具授权");
    expect(wrapper.find(".empty-state").text()).toContain("当前后端返回 0 条工具令牌");
    expect(wrapper.text()).toContain("启用 0");
    expect(wrapper.text()).toContain("总计 0");
  });

  it("disables the grant actions when the busy key matches the grant", async () => {
    busyKey.value = "grant:grant-active";

    const wrapper = mountCard();
    await Promise.resolve();

    const firstCard = getCard(wrapper, 0);
    const toggle = firstCard.find("button[role='switch']");
    const buttons = firstCard.findAll("button");
    const rotateButton = buttons.find((button) => button.text().trim() === "轮换");
    const deleteButton = buttons.find((button) => button.text().trim() === "撤销");
    const scopeChips = getGrantPanel(firstCard, 0).findAll(".scope-chip");
    const toolsetChips = getGrantPanel(firstCard, 1).findAll(".scope-chip");

    expect(toggle.attributes("disabled")).toBeDefined();
    expect(rotateButton?.attributes("disabled")).toBeDefined();
    expect(deleteButton?.attributes("disabled")).toBeDefined();
    expect(scopeChips[0].attributes("disabled")).toBeDefined();
    expect(toolsetChips[0].attributes("disabled")).toBeDefined();
  });
});
