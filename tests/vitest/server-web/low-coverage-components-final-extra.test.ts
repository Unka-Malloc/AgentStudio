// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive, ref } from "vue";

import AgentRetrievalAnswerPanel from "../../../server-web/components/debug/AgentRetrievalAnswerPanel.vue";
import AgentRetrievalForm from "../../../server-web/components/debug/AgentRetrievalForm.vue";
import AgentRetrievalProgressAndHistory from "../../../server-web/components/debug/AgentRetrievalProgressAndHistory.vue";
import AgentRetrievalTabStrip from "../../../server-web/components/debug/AgentRetrievalTabStrip.vue";
import AgentRetrievalTraceCard from "../../../server-web/components/debug/AgentRetrievalTraceCard.vue";
import AgentRetrievalWorkspace from "../../../server-web/components/debug/AgentRetrievalWorkspace.vue";
import ConsoleSideNavBackdrop from "../../../server-web/components/shell/side-nav/ConsoleSideNavBackdrop.vue";
import ConsoleSideNavLink from "../../../server-web/components/shell/side-nav/ConsoleSideNavLink.vue";
import MaintenanceAgentActionGrid from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentActionGrid.vue";
import MaintenanceAgentPolicyPanel from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentPolicyPanel.vue";
import MaintenanceAgentRunDetail from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentRunDetail.vue";
import MaintenanceAgentRunList from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentRunList.vue";
import MaintenanceAgentSummaryCard from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentSummaryCard.vue";
import WorkspaceCodespacePanel from "../../../server-web/components/workspaces/detail/WorkspaceCodespacePanel.vue";
import WorkspaceCreatePanel from "../../../server-web/components/workspaces/detail/WorkspaceCreatePanel.vue";
import WorkspaceLocalDirectoryPanel from "../../../server-web/components/workspaces/detail/WorkspaceLocalDirectoryPanel.vue";
import WorkspaceParentPanel from "../../../server-web/components/workspaces/detail/WorkspaceParentPanel.vue";
import WorkspaceProfilePanel from "../../../server-web/components/workspaces/detail/WorkspaceProfilePanel.vue";
import WorkspaceSharePanel from "../../../server-web/components/workspaces/detail/WorkspaceSharePanel.vue";

const consoleSideNavContextMock = vi.hoisted(() => ({ current: null as any }));
const workspacesViewContextMock = vi.hoisted(() => ({ current: null as any }));
const maintenanceAgentViewContextMock = vi.hoisted(() => ({ current: null as any }));
const agentRetrievalViewContextMock = vi.hoisted(() => ({ current: null as any }));

function createSelectStub(name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      modelValue: {
        type: [String, Number, Boolean, Array, Object],
        default: "",
      },
      options: {
        type: Array,
        default: () => [],
      },
      label: {
        type: String,
        default: "",
      },
      placeholder: {
        type: String,
        default: "",
      },
      disabled: {
        type: Boolean,
        default: false,
      },
      includeEmpty: {
        type: Boolean,
        default: false,
      },
      emptyLabel: {
        type: String,
        default: "",
      },
    },
    emits: ["update:modelValue", "change"],
    setup(props, { emit, attrs }) {
      function optionValue(option: any) {
        return String(option?.value ?? option?.agentUid ?? "");
      }

      function onChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value;
        emit("update:modelValue", value);
        emit("change", value);
      }

      return () =>
        h(
          "label",
          {
            ...attrs,
            class: ["select-control-stub", attrs.class],
            "data-label": props.label || undefined,
            "data-placeholder": props.placeholder || undefined,
          },
          [
            props.label
              ? h("span", { class: "select-control-stub-label" }, props.label)
              : null,
            h(
              "select",
              {
                class: "select-control-stub-select",
                disabled: props.disabled,
                value: String(props.modelValue ?? ""),
                onChange,
              },
              [
                props.includeEmpty
                  ? h("option", { value: "" }, props.emptyLabel || "未分配智能体")
                  : null,
                ...(Array.isArray(props.options)
                  ? props.options.map((option: any) =>
                      h(
                        "option",
                        {
                          value: optionValue(option),
                          disabled: Boolean(option?.disabled),
                        },
                        String(option?.label ?? optionValue(option)),
                      ),
                    )
                  : []),
              ],
            ),
          ],
        );
    },
  });
}

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: () => consoleSideNavContextMock.current,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => workspacesViewContextMock.current,
}));

vi.mock("../../../server-web/composables/maintenanceAgentViewContext", () => ({
  useMaintenanceAgentViewContext: () => maintenanceAgentViewContextMock.current,
}));

vi.mock("../../../server-web/composables/agentRetrievalViewContext", () => ({
  useAgentRetrievalViewContext: () => agentRetrievalViewContextMock.current,
}));

vi.mock("../../../server-web/components/OptionBar.vue", () => ({
  default: createSelectStub("OptionBarStub"),
}));

vi.mock("../../../server-web/components/AgentModelOptionBar.vue", () => ({
  default: createSelectStub("AgentModelOptionBarStub"),
}));

function createWorkspacesContext() {
  return {
    busyKey: ref(""),
    panel: ref("detail"),
    selected: ref<any>(null),
    selectedId: "ws-selected",
    workspaces: ref([
      { workspaceId: "ws-selected", title: "当前工作空间" },
      { workspaceId: "ws-parent", title: "父工作空间" },
      { workspaceId: "ws-peer", title: "同级工作空间" },
    ]),
    createForm: reactive({
      title: "",
      objective: "整理最近的工作",
      parentWorkspaceId: "",
    }),
    createWorkspace: vi.fn(),
    shareForm: reactive({
      action: "share",
      targetWorkspaceId: "",
    }),
    shareOrUnshare: vi.fn(),
    parentForm: reactive({
      parentWorkspaceId: "",
    }),
    setParent: vi.fn(),
    localDirForm: reactive({
      sourcePath: "",
      targetPath: "mirror",
      maxFiles: 128,
      deleteExtraneous: false,
    }),
    localDirMountData: ref<any>(null),
    connectLocalDirectory: vi.fn(),
    syncLocalDirectory: vi.fn(),
    codespaceForm: reactive({
      provider: "github",
      repoId: "/workspace/repo",
      repositoryRef: "owner/repo",
      branch: "main",
      baseRef: "base",
      headRef: "head",
      diff: "",
    }),
    codespaceResult: ref<any>(null),
    inspectCodespaceStatus: vi.fn(),
    prepareCodespaceChange: vi.fn(),
    uploadCodespaceChange: vi.fn(),
    profileForm: reactive({
      contextProfileId: "balanced",
      toolGrantId: "grant-1",
      modelAlias: "agent-a",
      ownedSourceIds: "source-a",
      includeSourceIds: "source-b",
      excludeSourceIds: "source-c",
    }),
    hotSwapProfile: vi.fn(),
  };
}

function createMaintenanceAgentContext() {
  const maintenanceAgentConfig = ref(
    reactive({
      enabled: true,
      plannerMode: "fixed_runbook",
      autoApproveRisk: "medium",
      scheduler: {
        tickSeconds: 60,
      },
      schedules: [
        {
          id: "nightly",
          label: "Nightly",
          runbook: "nightly",
          nextRunAt: "2026-06-06T08:00:00Z",
          intervalMinutes: 60,
          enabled: true,
        },
        {
          id: "weekly",
          label: "Weekly",
          runbook: "weekly",
          nextRunAt: "2026-06-07T08:00:00Z",
          intervalMinutes: 10080,
          enabled: false,
        },
      ],
    }),
  );
  return {
    agentSelectorOptions: [
      { value: "agent-a", label: "Agent A" },
      { value: "agent-b", label: "Agent B" },
    ],
    autoApproveRiskOptionBarOptions: [
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
    ],
    busyKey: ref(""),
    canAdminMaintenanceAgent: true,
    canApproveMaintenanceAgent: true,
    canRunMaintenanceAgent: true,
    cancelMaintenanceAgentRun: vi.fn(),
    chatMaintenanceAgent: vi.fn(),
    currentAgentModelOptionLabel: (alias: string) => (alias ? `模型 ${alias}` : ""),
    displayedMaintenanceAgentRuns: ref([
      {
        runId: "run-1",
        intent: "巡检",
        updatedAt: "2026-06-05T10:00:00Z",
        status: "awaiting_approval",
        risk: "medium",
      },
      {
        runId: "run-2",
        intent: "回归",
        updatedAt: "2026-06-05T09:00:00Z",
        status: "running",
        risk: "high",
      },
      {
        runId: "run-3",
        intent: "已完成",
        updatedAt: "2026-06-05T08:00:00Z",
        status: "completed",
        risk: "low",
      },
    ]),
    enabledBooleanOptionBarOptions: [
      { value: true, label: "启用" },
      { value: false, label: "停用" },
    ],
    formatCompactDate: (value: string) => `date:${String(value).slice(0, 10)}`,
    latestMaintenanceAgentRun: ref<any>(null),
    maintenanceAgentConfig,
    maintenanceAgentMessage: ref("请检查最新变更。"),
    maintenanceAgentModelAlias: ref("agent-a"),
    maintenanceAgentResultJson: ref('{"ok":true}'),
    maintenanceAgentRiskLabel: (risk: string) => `风险 ${risk}`,
    maintenanceAgentRunbook: ref("nightly"),
    maintenanceAgentRunbookOptionBarOptions: [
      { value: "nightly", label: "Nightly" },
      { value: "weekly", label: "Weekly" },
    ],
    maintenanceAgentRunbooks: [
      { id: "nightly" },
      { id: "weekly" },
    ],
    maintenanceAgentStatusLabel: (status: string) => `状态 ${status}`,
    maintenanceAgentStatusTone: (status: string) => `tone-${status}`,
    maintenanceAgentSummary: ref({ tools: ["lint", "sync", "audit"] }),
    nextMaintenanceAgentRunAt: "2026-06-06T12:00:00Z",
    pendingMaintenanceApprovalCount: 2,
    plannerModeOptionBarOptions: [
      { value: "fixed_runbook", label: "固定" },
      { value: "adaptive", label: "自适应" },
    ],
    approveMaintenanceAgentRun: vi.fn(),
    runMaintenanceAgentKnowledgeMaintenance: vi.fn(),
    runMaintenanceAgentRunbook: vi.fn(),
    saveMaintenanceAgentConfig: vi.fn(),
    selectedMaintenanceAgentRun: ref<any>(null),
  };
}

function createAgentRetrievalContext() {
  const sharedBusyKey = ref("");
  const agentExploreResult = ref<any>(null);
  const agentExploreForm = reactive({
    query: "",
    modelAlias: "agent-a",
    contextProfileId: "context-32k",
    thinkingMode: "balanced",
    maxIterations: 3,
    limit: 5,
    temperature: 0.3,
    maxTokens: 512,
    toolChoice: "auto",
  });
  return {
    agentRetrievalAnswer: {
      agentExploreAnswerHtml: ref("<p>等待结果</p>"),
      agentExploreDocumentMarkdown: ref(""),
      agentExploreLinkedEvidenceRefs: ref<string[]>([]),
      agentExploreResult,
      busyKey: sharedBusyKey,
      copyAgentExploreDocument: vi.fn(),
      exportAgentExploreDocument: vi.fn(),
      handleAgentAnswerClick: vi.fn(),
      openAgentEvidencePreview: vi.fn(),
    },
    agentRetrievalForm: {
      agentExploreAgentOptions: [
        { value: "agent-a", label: "Agent A" },
        { value: "agent-b", label: "Agent B" },
      ],
      agentExploreForm,
      busyKey: sharedBusyKey,
      contextWindowOptionBarOptions: [
        { value: "context-32k", label: "32k" },
        { value: "context-128k", label: "128k" },
      ],
      highlightedConfigTarget: "agent-explore-agent",
      runKnowledgeAgentExplore: vi.fn(),
      selectedAgentExploreModel: reactive({ enabled: true }),
      thinkingModeOptionBarOptions: [
        { value: "balanced", label: "Balanced" },
        { value: "fast", label: "Fast" },
      ],
    },
    agentRetrievalProgress: {
      agentExploreHistoryPanelItems: ref([
        {
          id: "run-1",
          title: "会话 A",
          meta: "running · run-1",
          preview: "摘要 A",
          active: true,
          disabled: false,
        },
        {
          id: "run-2",
          title: "会话 B",
          meta: "failed · run-2",
          preview: "摘要 B",
          active: false,
          disabled: true,
        },
      ]),
      agentExploreProgress: reactive({
        label: "第 1 / 3 轮 · 调用工具",
        percent: 45,
      }),
      agentExploreProgressVisible: ref(true),
      deleteAgentExploreHistoryItem: vi.fn(),
      selectAgentExploreHistoryItem: vi.fn(),
    },
    agentRetrievalTabs: {
      agentExploreActiveTabId: ref("run-2"),
      agentExploreTabBusy: (session: any) => session.runId === "run-2",
      agentExploreTabs: ref([
        {
          runId: "draft:1",
          query: "",
          status: "draft",
        },
        {
          runId: "run-2",
          query: "最近的账单",
          status: "running",
        },
      ]),
      closeAgentExploreTab: vi.fn(),
      isAgentExploreDraftSession: (session: any) => String(session.runId || "").startsWith("draft:"),
      switchAgentExploreTab: vi.fn(),
    },
    agentRetrievalTrace: {
      agentExploreEventTime: (event: any) => `time:${String(event?.createdAt || "")}`,
      agentExploreStepOpen: (step: any) => step.iteration === 1,
      agentExploreSteps: [
        {
          iteration: 1,
          phase: "tool_calling",
          events: [
            { label: "进入工具", status: "completed", createdAt: "2026-06-05T01:02:03Z" },
          ],
          toolCalls: [
            { id: "call-1", name: "search", arguments: { query: "abc" }, status: "selected" },
          ],
          toolResults: [
            { tool: "search", status: "completed", result: { hit: 1 } },
          ],
          contextBudget: {
            totalTokens: 1200,
            contextWindowTokens: 4000,
          },
        },
        {
          iteration: 2,
          phase: "completed",
          toolCalls: [],
          toolResults: [
            { tool: "lookup", status: "running" },
          ],
        },
      ],
      agentExploreTraceOpen: ref(true),
      agentExploreWorkspaceId: "ws-1",
      busyKey: sharedBusyKey,
      handleAgentExploreTraceToggle: vi.fn(),
    },
    agentRetrievalWorkspace: {
      agentExploreResult,
      agentExploreSplitDragging: ref(false),
      agentExploreSplitLeftPercent: 42,
      agentExploreSplitRef: ref(null),
      agentExploreSplitStyle: {
        "--split-left": "42%",
      },
      busyKey: sharedBusyKey,
      handleAgentExploreSplitKeydown: vi.fn(),
      startAgentExploreSplitResize: vi.fn(),
    },
  };
}

beforeEach(() => {
  consoleSideNavContextMock.current = {
    sideNavOpen: ref(true),
  };
  workspacesViewContextMock.current = createWorkspacesContext();
  maintenanceAgentViewContextMock.current = createMaintenanceAgentContext();
  agentRetrievalViewContextMock.current = createAgentRetrievalContext();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ConsoleSideNavLink and ConsoleSideNavBackdrop", () => {
  it("renders active and subtle side-nav states and emits activate", async () => {
    const wrapper = mount(ConsoleSideNavLink, {
      props: {
        active: true,
        label: "仪表盘",
        subtle: true,
      },
      slots: {
        icon: '<span class="side-link-icon-slot">i</span>',
      },
    });

    expect(wrapper.classes()).toContain("active");
    expect(wrapper.classes()).toContain("side-link-subtle");
    expect(wrapper.text()).toContain("仪表盘");
    expect(wrapper.find(".side-link-icon-slot").exists()).toBe(true);

    await wrapper.trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);
  });

  it("closes the side nav when the backdrop is clicked", async () => {
    const wrapper = mount(ConsoleSideNavBackdrop);

    expect(consoleSideNavContextMock.current.sideNavOpen.value).toBe(true);
    await wrapper.trigger("click");
    expect(consoleSideNavContextMock.current.sideNavOpen.value).toBe(false);
  });
});

describe("Workspace detail panels", () => {
  it("creates workspaces and respects busy state", async () => {
    const wrapper = mount(WorkspaceCreatePanel);
    const context = workspacesViewContextMock.current;

    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeDefined();
    context.createForm.title = "工作空间一";
    await nextTick();
    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeUndefined();

    await wrapper.find("button.tool-button").trigger("click");
    expect(context.createWorkspace).toHaveBeenCalledTimes(1);

    context.busyKey.value = "ws:create";
    await nextTick();
    expect(wrapper.find("button.tool-button").text()).toBe("创建中…");

    await wrapper.findAll("button.tool-button")[1].trigger("click");
    expect(context.panel.value).toBe("list");
  });

  it("renders share state, switches the action, and calls the action handler", async () => {
    const context = workspacesViewContextMock.current;
    context.selected.value = {
      title: "共享目标",
      accessibleWorkspaceIds: [],
    };

    const wrapper = mount(WorkspaceSharePanel);
    const actionSelect = wrapper.find(".select-control-stub-select");

    expect(wrapper.find("em").text()).toBe("（无）");
    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeDefined();

    context.shareForm.targetWorkspaceId = "workspace_peer";
    await nextTick();
    expect(wrapper.find("button.tool-button").text()).toBe("授权");

    await actionSelect.setValue("unshare");
    expect(context.shareForm.action).toBe("unshare");
    expect(wrapper.find("button.tool-button").text()).toBe("撤销");

    await wrapper.find("button.tool-button").trigger("click");
    expect(context.shareOrUnshare).toHaveBeenCalledTimes(1);

    context.busyKey.value = "ws:share";
    await nextTick();
    expect(wrapper.find("button.tool-button").text()).toBe("处理中…");
  });

  it("filters the parent list, copies selection, and invokes the setter", async () => {
    const context = workspacesViewContextMock.current;
    context.selected.value = {
      title: "子工作空间",
    };

    const wrapper = mount(WorkspaceParentPanel);
    const ids = wrapper.findAll(".ws-id-list code").map((node) => node.text());

    expect(ids).toEqual(["ws-parent", "ws-peer"]);
    await wrapper.findAll(".ws-id-list code")[1].trigger("click");
    expect(context.parentForm.parentWorkspaceId).toBe("ws-peer");

    await wrapper.find("button.tool-button").trigger("click");
    expect(context.setParent).toHaveBeenCalledTimes(1);

    context.busyKey.value = "ws:parent";
    await nextTick();
    expect(wrapper.find("button.tool-button").text()).toBe("保存中…");
  });

  it("connects a local directory, toggles the checkbox, and syncs a mount", async () => {
    const context = workspacesViewContextMock.current;
    context.selected.value = {
      title: "本地目录工作空间",
    };
    context.localDirMountData.value = {
      mounts: [
        {
          mountRef: "mount-1",
          sourceRootName: "repo",
          targetPath: "mirror",
        },
      ],
    };

    const wrapper = mount(WorkspaceLocalDirectoryPanel);
    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".workspace-mount-row").exists()).toBe(true);

    context.localDirForm.sourcePath = "/tmp/workspace";
    await nextTick();
    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeUndefined();

    await wrapper.find("button[role=\"checkbox\"]").trigger("click");
    expect(context.localDirForm.deleteExtraneous).toBe(true);

    await wrapper.find(".workspace-mount-row button.table-action").trigger("click");
    expect(context.syncLocalDirectory).toHaveBeenCalledWith(context.localDirMountData.value.mounts[0]);

    await wrapper.find("button.tool-button").trigger("click");
    expect(context.connectLocalDirectory).toHaveBeenCalledTimes(1);
  });

  it("updates codespace controls, shows result data, and calls action handlers", async () => {
    const context = workspacesViewContextMock.current;
    context.selected.value = {
      title: "代码库工作空间",
    };
    context.codespaceResult.value = {
      repo: "owner/repo",
      status: "ready",
    };

    const wrapper = mount(WorkspaceCodespacePanel);
    const selects = wrapper.findAll(".select-control-stub-select");

    expect(wrapper.find(".workspace-codespace-result").text()).toContain('"repo": "owner/repo"');
    await selects[0].setValue("gerrit");
    expect(context.codespaceForm.provider).toBe("gerrit");

    await wrapper.findAll("button.tool-button")[0].trigger("click");
    await wrapper.findAll("button.tool-button")[1].trigger("click");
    await wrapper.findAll("button.tool-button")[2].trigger("click");
    expect(context.inspectCodespaceStatus).toHaveBeenCalledTimes(1);
    expect(context.prepareCodespaceChange).toHaveBeenCalledTimes(1);
    expect(context.uploadCodespaceChange).toHaveBeenCalledTimes(1);
  });

  it("shows the profile form and hot-swaps the profile", async () => {
    const context = workspacesViewContextMock.current;
    context.selected.value = {
      title: "Profile 工作空间",
    };

    const wrapper = mount(WorkspaceProfilePanel);
    expect(wrapper.text()).toContain("Profile 工作空间");
    expect(wrapper.find("button.tool-button").text()).toBe("热切换 Profile");

    context.busyKey.value = "ws:profile";
    await nextTick();
    expect(wrapper.find("button.tool-button").text()).toBe("切换中…");

    await wrapper.find("button.tool-button-ghost").trigger("click");
    expect(context.panel.value).toBe("list");
  });
});

describe("Maintenance agent panels", () => {
  it("renders the summary card and updates when the latest run appears", async () => {
    const context = maintenanceAgentViewContextMock.current;
    const wrapper = mount(MaintenanceAgentSummaryCard);

    expect(wrapper.text()).toContain("已启用");
    expect(wrapper.text()).toContain("待审批 2");
    expect(wrapper.text()).toContain("下次 date:2026-06-06");
    expect(wrapper.text()).toContain("无");

    context.latestMaintenanceAgentRun.value = {
      status: "completed",
      risk: "high",
    };
    context.maintenanceAgentConfig.value.enabled = false;
    await nextTick();

    expect(wrapper.text()).toContain("未启用");
    expect(wrapper.text()).toContain("状态 completed");
    expect(wrapper.text()).toContain("风险 high");
    expect(wrapper.text()).toContain("Runbook");
    expect(wrapper.text()).toContain("工具");
  });

  it("runs actions, updates model/runbook selections, and reflects busy labels", async () => {
    const context = maintenanceAgentViewContextMock.current;
    const wrapper = mount(MaintenanceAgentActionGrid);

    expect(wrapper.text()).toContain("fixed_runbook · 模型 agent-a");
    expect(wrapper.text()).toContain("Runbook");
    expect(wrapper.findAll(".select-control-stub-select")[0].element.value).toBe("agent-a");

    await wrapper.findAll(".select-control-stub-select")[0].setValue("agent-b");
    await wrapper.findAll(".select-control-stub-select")[1].setValue("weekly");
    expect(context.maintenanceAgentModelAlias.value).toBe("agent-b");
    expect(context.maintenanceAgentRunbook.value).toBe("weekly");

    await wrapper.find("button").trigger("click");
    expect(context.chatMaintenanceAgent).toHaveBeenCalledTimes(1);
    await wrapper.findAll("button")[1].trigger("click");
    expect(context.runMaintenanceAgentRunbook).toHaveBeenCalledTimes(1);
    await wrapper.find(".maintenance-agent-quick-actions button").trigger("click");
    expect(context.runMaintenanceAgentKnowledgeMaintenance).toHaveBeenCalledTimes(1);

    context.busyKey.value = "maintenance-agent:chat";
    await nextTick();
    expect(wrapper.findAll("button")[0].text()).toBe("执行中");
    expect(wrapper.findAll("button")[0].attributes("disabled")).toBeDefined();

    context.busyKey.value = "maintenance-agent:run";
    await nextTick();
    expect(wrapper.findAll("button")[1].text()).toBe("执行中");
  });

  it("saves the policy and toggles schedule rows", async () => {
    const context = maintenanceAgentViewContextMock.current;
    const wrapper = mount(MaintenanceAgentPolicyPanel);

    expect(wrapper.text()).toContain("调度策略");
    expect(wrapper.findAll(".select-control-stub-select").length).toBe(3);
    expect(wrapper.find("button.primary-action").text()).toBe("保存策略");

    await wrapper.findAll(".table-action")[0].trigger("click");
    expect(context.maintenanceAgentConfig.value.schedules[0].enabled).toBe(false);
    expect(wrapper.findAll(".table-action")[0].text()).toBe("启用");

    await wrapper.find("button.primary-action").trigger("click");
    expect(context.saveMaintenanceAgentConfig).toHaveBeenCalledTimes(1);

    context.busyKey.value = "maintenance-agent:config";
    await nextTick();
    expect(wrapper.find("button.primary-action").text()).toBe("保存中");
    expect(wrapper.find("button.primary-action").attributes("disabled")).toBeDefined();
  });

  it("lists maintenance runs, exposes actions, and shows the empty state", async () => {
    const context = maintenanceAgentViewContextMock.current;
    const wrapper = mount(MaintenanceAgentRunList);

    expect(wrapper.text()).toContain("date:2026-06-05");
    expect(wrapper.findAll(".table-action.text-action")).toHaveLength(3);
    expect(wrapper.findAll(".table-action.danger-action")).toHaveLength(2);

    await wrapper.findAll(".table-action.text-action")[0].trigger("click");
    expect(context.selectedMaintenanceAgentRun.value.runId).toBe("run-1");

    await wrapper.findAll(".table-action:not(.text-action)")[0].trigger("click");
    expect(context.approveMaintenanceAgentRun).toHaveBeenCalledTimes(1);
    await wrapper.findAll(".table-action.danger-action")[0].trigger("click");
    expect(context.cancelMaintenanceAgentRun).toHaveBeenCalledTimes(1);

    context.displayedMaintenanceAgentRuns.value = [];
    await nextTick();
    expect(wrapper.text()).toContain("暂无维护运行");
  });

  it("renders the selected maintenance run and its recent output", async () => {
    const context = maintenanceAgentViewContextMock.current;
    const wrapper = mount(MaintenanceAgentRunDetail);

    expect(wrapper.find("article").exists()).toBe(false);

    context.selectedMaintenanceAgentRun.value = {
      summary: "智能巡检",
      planHash: "abcdef1234567890",
      source: "console",
      steps: [
        {
          stepId: "step-1",
          toolId: "tool-a",
          status: "completed",
          risk: "medium",
          reason: "需要校验",
          output: { ok: true },
          error: "",
        },
        {
          stepId: "step-2",
          toolId: "tool-b",
          status: "failed",
          risk: "high",
          reason: "发生错误",
          error: "失败原因",
        },
      ],
    };
    context.maintenanceAgentResultJson.value = '{"result":true}';
    await nextTick();

    expect(wrapper.text()).toContain("智能巡检");
    expect(wrapper.text()).toContain("abcdef123456");
    expect(wrapper.text()).toContain("tool-a");
    expect(wrapper.text()).toContain("失败原因");
    expect(wrapper.text()).toContain("最近输出");
  });
});

describe("Agent retrieval debug panels", () => {
  it("switches tabs, blocks busy tabs, and closes the active tab", async () => {
    const context = agentRetrievalViewContextMock.current;
    const wrapper = mount(AgentRetrievalTabStrip);

    expect(wrapper.attributes("aria-label")).toBe("智能检索会话");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    expect(wrapper.findAll('[role="tab"]')[0].attributes("data-draft")).toBe("true");
    expect(wrapper.findAll('[role="tab"]')[1].attributes("data-disabled")).toBe("true");

    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    expect(context.agentRetrievalTabs.switchAgentExploreTab).toHaveBeenCalledTimes(1);

    await wrapper.findAll('[role="tab"]')[0].trigger("keydown", { key: "Enter" });
    expect(context.agentRetrievalTabs.switchAgentExploreTab).toHaveBeenCalledTimes(2);

    await wrapper.findAll(".agent-explore-tab-close")[0].trigger("click");
    expect(context.agentRetrievalTabs.closeAgentExploreTab).toHaveBeenCalledTimes(1);

    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    expect(context.agentRetrievalTabs.switchAgentExploreTab).toHaveBeenCalledTimes(2);
  });

  it("renders trace cards, event timelines, and tool result states", async () => {
    const context = agentRetrievalViewContextMock.current;
    context.agentRetrievalTrace.busyKey.value = "knowledge:agent-explore";
    const wrapper = mount(AgentRetrievalTraceCard);

    expect(wrapper.text()).toContain("2 轮");
    expect(wrapper.text()).toContain("Workspace ws-1");
    expect(wrapper.text()).toContain("模型正在选择本地工具。");
    expect(wrapper.findAll(".agent-explore-step")).toHaveLength(2);
    expect(wrapper.findAll(".agent-explore-step")[0].attributes("open")).toBeDefined();
    expect(wrapper.text()).toContain("调用工具 · 工具 1 · 返回 1");
    expect(wrapper.text()).toContain("time:2026-06-05T01:02:03Z");
    expect(wrapper.text()).toContain("\"query\": \"abc\"");
    expect(wrapper.text()).toContain("\"hit\": 1");
    expect(wrapper.text()).toContain("上下文 1200 / 4000");
    expect(wrapper.text()).toContain("工具调用中，等待返回。");

    await wrapper.trigger("toggle");
    expect(context.agentRetrievalTrace.handleAgentExploreTraceToggle).toHaveBeenCalledTimes(1);
  });

  it("shows answer states, evidence buttons, and html click handlers", async () => {
    const context = agentRetrievalViewContextMock.current;
    const wrapper = mount(AgentRetrievalAnswerPanel);

    expect(wrapper.find(".knowledge-preview-empty").exists()).toBe(true);
    expect(wrapper.findAll("button")[0].attributes("disabled")).toBeDefined();
    expect(wrapper.findAll("button")[1].attributes("disabled")).toBeDefined();

    context.agentRetrievalAnswer.agentExploreResult.value = {
      answer: "检索答案",
      degraded: true,
      contextPack: { contextBuildRecordId: "pack-1" },
    };
    context.agentRetrievalAnswer.agentExploreDocumentMarkdown.value = "# 文档";
    context.agentRetrievalAnswer.agentExploreLinkedEvidenceRefs.value = ["e-1", "e-2"];
    context.agentRetrievalAnswer.agentExploreAnswerHtml.value = "<p>检索答案</p>";
    await nextTick();

    expect(wrapper.text()).toContain("降级");
    expect(wrapper.find(".knowledge-preview-empty").exists()).toBe(false);
    expect(wrapper.text()).toContain("引用证据");
    expect(wrapper.text()).toContain("上下文包");
    expect(wrapper.findAll(".evidence-ref-button")).toHaveLength(2);

    context.agentRetrievalAnswer.busyKey.value = "knowledge:evidence:e-2";
    await nextTick();

    await wrapper.find(".evidence-rendered-content").trigger("click");
    expect(context.agentRetrievalAnswer.handleAgentAnswerClick).toHaveBeenCalledTimes(1);

    await wrapper.findAll(".evidence-ref-button")[0].trigger("click");
    expect(context.agentRetrievalAnswer.openAgentEvidencePreview).toHaveBeenCalledWith("e-1");
    expect(wrapper.findAll(".evidence-ref-button")[1].attributes("disabled")).toBeDefined();

    await wrapper.findAll("button")[0].trigger("click");
    await wrapper.findAll("button")[1].trigger("click");
    expect(context.agentRetrievalAnswer.copyAgentExploreDocument).toHaveBeenCalledTimes(1);
    expect(context.agentRetrievalAnswer.exportAgentExploreDocument).toHaveBeenCalledTimes(1);
  });

  it("submits the retrieval form and reflects busy/disabled states", async () => {
    const context = agentRetrievalViewContextMock.current;
    const wrapper = mount(AgentRetrievalForm);

    expect(wrapper.find('[data-config-target="agent-explore-agent"]').exists()).toBe(true);
    expect(wrapper.find("button.primary-action").attributes("disabled")).toBeDefined();

    await wrapper.find('input[type="search"]').setValue("查找最近账单");
    expect(wrapper.find("button.primary-action").attributes("disabled")).toBeUndefined();

    await wrapper.find('[data-label="智能体"] .select-control-stub-select').setValue("agent-b");
    expect(context.agentRetrievalForm.agentExploreForm.modelAlias).toBe("agent-b");

    await wrapper.trigger("submit");
    expect(context.agentRetrievalForm.runKnowledgeAgentExplore).toHaveBeenCalledTimes(1);

    context.agentRetrievalForm.selectedAgentExploreModel.enabled = false;
    await nextTick();
    expect(wrapper.find("button.primary-action").attributes("disabled")).toBeDefined();

    context.agentRetrievalForm.busyKey.value = "knowledge:agent-explore";
    await nextTick();
    expect(wrapper.find("button.primary-action").text()).toBe("检索中");
  });

  it("shows retrieval progress and history actions", async () => {
    const context = agentRetrievalViewContextMock.current;
    const wrapper = mount(AgentRetrievalProgressAndHistory);

    expect(wrapper.find(".agent-explore-progress").exists()).toBe(true);
    expect(wrapper.find(".agent-explore-progress-track span").attributes("style")).toContain("width: 45%");
    expect(wrapper.text()).toContain("2 条，滚动查看");

    await wrapper.findAll(".history-session-item")[0].trigger("click");
    expect(context.agentRetrievalProgress.selectAgentExploreHistoryItem).toHaveBeenCalledWith("run-1");

    context.agentRetrievalProgress.agentExploreProgressVisible.value = false;
    await nextTick();
    expect(wrapper.find(".agent-explore-progress").exists()).toBe(false);
  });

  it("renders the workspace split container and split handlers", async () => {
    const context = agentRetrievalViewContextMock.current;
    context.agentRetrievalWorkspace.busyKey.value = "knowledge:agent-explore";
    const wrapper = mount(AgentRetrievalWorkspace);

    expect(wrapper.find(".agent-explore-workspace").exists()).toBe(true);
    expect(wrapper.find(".agent-explore-workspace").classes()).not.toContain("is-resizing");

    context.agentRetrievalWorkspace.agentExploreSplitDragging.value = true;
    await nextTick();
    expect(wrapper.find(".agent-explore-workspace").classes()).toContain("is-resizing");

    await wrapper.find(".agent-explore-split-resizer").trigger("pointerdown");
    expect(context.agentRetrievalWorkspace.startAgentExploreSplitResize).toHaveBeenCalledTimes(1);

    await wrapper.find(".agent-explore-split-resizer").trigger("keydown");
    expect(context.agentRetrievalWorkspace.handleAgentExploreSplitKeydown).toHaveBeenCalledTimes(1);
  });
});
