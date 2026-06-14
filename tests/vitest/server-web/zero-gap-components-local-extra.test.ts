// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, ref } from "vue";

import AgentConfigInvocationToggle from "../../../server-web/components/admin/agent-config/AgentConfigInvocationToggle.vue";
import AgentModelBindingsPanel from "../../../server-web/components/admin/agent-config/AgentModelBindingsPanel.vue";
import AgentModelPromptPanel from "../../../server-web/components/admin/agent-config/AgentModelPromptPanel.vue";
import AuthorizationGovernanceEditor from "../../../server-web/components/admin/authorization-governance/AuthorizationGovernanceEditor.vue";
import AuthorizationGovernanceGrid from "../../../server-web/components/admin/authorization-governance/AuthorizationGovernanceGrid.vue";
import AuthorizationGovernanceMetrics from "../../../server-web/components/admin/authorization-governance/AuthorizationGovernanceMetrics.vue";
import OpsMonitorSummaryCard from "../../../server-web/components/admin/ops-monitor/OpsMonitorSummaryCard.vue";
import RuntimeDependencyRunCard from "../../../server-web/components/admin/runtime-downloads/RuntimeDependencyRunCard.vue";
import RuntimeDependencyRunDetails from "../../../server-web/components/admin/runtime-downloads/RuntimeDependencyRunDetails.vue";
import RuntimeDownloadsPanel from "../../../server-web/components/admin/runtime-downloads/RuntimeDownloadsPanel.vue";
import RuntimeDownloadsSummaryCard from "../../../server-web/components/admin/runtime-downloads/RuntimeDownloadsSummaryCard.vue";
import InfoFeedConversationPanel from "../../../server-web/components/feed/InfoFeedConversationPanel.vue";
import InfoFeedParentContextCards from "../../../server-web/components/feed/InfoFeedParentContextCards.vue";
import InfoFeedPausePanels from "../../../server-web/components/feed/InfoFeedPausePanels.vue";
import WordCloudCardList from "../../../server-web/components/knowledge/word-cloud/WordCloudCardList.vue";
import WordCloudStage from "../../../server-web/components/knowledge/word-cloud/WordCloudStage.vue";
import ConsoleAuthGate from "../../../server-web/components/shell/ConsoleAuthGate.vue";
import ConsoleDrawer from "../../../server-web/components/shell/ConsoleDrawer.vue";
import ConsolePreferencesPanel from "../../../server-web/components/shell/ConsolePreferencesPanel.vue";
import ConsoleSideNavBrand from "../../../server-web/components/shell/side-nav/ConsoleSideNavBrand.vue";
import ConsoleSideNavFooter from "../../../server-web/components/shell/side-nav/ConsoleSideNavFooter.vue";
import WorkspaceDetailPanel from "../../../server-web/components/workspaces/WorkspaceDetailPanel.vue";
import WorkspaceResolvedProfilePanel from "../../../server-web/components/workspaces/WorkspaceResolvedProfilePanel.vue";

const agentEntryCardContextMock = vi.hoisted(() => vi.fn());
const authorizationGovernanceContextMock = vi.hoisted(() => vi.fn());
const feedContextMock = vi.hoisted(() => vi.fn());
const knowledgeWordCloudContextMock = vi.hoisted(() => vi.fn());
const opsMonitorContextMock = vi.hoisted(() => vi.fn());
const runtimeDownloadsContextMock = vi.hoisted(() => vi.fn());
const shellContextMock = vi.hoisted(() => vi.fn());
const sideNavContextMock = vi.hoisted(() => vi.fn());
const workspacesContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/agentModelEntryCardContext", () => ({
  useAgentModelEntryCardContext: agentEntryCardContextMock,
}));

vi.mock("../../../server-web/composables/authorizationGovernanceCardContext", () => ({
  useAuthorizationGovernanceCardContext: authorizationGovernanceContextMock,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: feedContextMock,
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeWordCloudContext: knowledgeWordCloudContextMock,
}));

vi.mock("../../../server-web/composables/opsMonitorViewContext", () => ({
  useOpsMonitorViewContext: opsMonitorContextMock,
}));

vi.mock("../../../server-web/composables/runtimeDownloadsViewContext", () => ({
  useRuntimeDownloadsViewContext: runtimeDownloadsContextMock,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock,
}));

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: sideNavContextMock,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: workspacesContextMock,
}));

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: ["title"],
  setup(props, { slots }) {
    return () => h("section", { class: "config-fold-card-stub" }, [
      h("h3", String(props.title || "")),
      slots.default?.(),
    ]);
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "binary-checkbox-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        const next = !props.modelValue;
        emit("update:model-value", next);
        emit("update:modelValue", next);
        emit("change", next);
      },
    }, String(props.label || ""));
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: ["modelValue", "disabled", "placeholder"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "agent-model-option-bar-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        emit("update:model-value", "agent-next");
        emit("update:modelValue", "agent-next");
      },
    }, String(props.modelValue || props.placeholder || "agent"));
  },
});

const SimpleStub = defineComponent({
  name: "SimpleStub",
  props: ["title", "panel", "items", "logEntries", "progressState"],
  emits: ["select", "delete"],
  setup(props, { emit, slots }) {
    return () => h("div", {
      class: "simple-stub",
      onClick: () => {
        emit("select", "selected");
        emit("delete", "deleted");
      },
    }, [
      String(props.title || props.panel?.title || ""),
      Array.isArray(props.items) ? ` items:${props.items.length}` : "",
      Array.isArray(props.logEntries) ? ` log:${props.logEntries.length}` : "",
      props.progressState?.label || "",
      slots.default?.(),
    ]);
  },
});

const SafeHtmlBlockStub = defineComponent({
  name: "SafeHtmlBlock",
  props: ["html"],
  emits: ["click"],
  setup(props, { emit }) {
    return () => h("div", {
      class: "safe-html-stub",
      onClick: (event: MouseEvent) => emit("click", event),
    }, String(props.html || ""));
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: ["label", "tone"],
  setup(props) {
    return () => h("span", { class: `status-pill-stub ${props.tone || ""}` }, String(props.label || ""));
  },
});

const OptionBarProbeStub = defineComponent({
  name: "OptionBar",
  props: ["modelValue", "label", "options"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props, { emit }) {
    return () => h("label", {
      class: "option-bar-probe",
      "data-label": String(props.label || ""),
      "data-model": String(props.modelValue || ""),
      onClick: () => {
        const firstOption = Array.isArray(props.options) ? props.options[0] : null;
        if (firstOption) {
          emit("update:model-value", firstOption.value);
          emit("update:modelValue", firstOption.value);
          emit("change", firstOption.value);
        }
      },
    }, [
      h("span", { class: "option-bar-probe-label" }, String(props.label || "")),
      ...(Array.isArray(props.options)
        ? props.options.map((option: { label?: string; value?: unknown }) =>
            h("span", { class: "option-bar-probe-option" }, `${option.label || ""}:${String(option.value)}`),
          )
        : []),
    ]);
  },
});

const commonStubs = {
  AgentModelOptionBar: AgentModelOptionBarStub,
  ApprovalFlowCardList: SimpleStub,
  BinaryCheckbox: BinaryCheckboxStub,
  ConfigFoldCard: ConfigFoldCardStub,
  ConsoleAuthUsersPanel: SimpleStub,
  ConsolePreferencesPanel: SimpleStub,
  ConsoleServiceDiscoveryPanel: SimpleStub,
  ConsoleSyncDirectoriesPanel: SimpleStub,
  HistorySessionPanel: SimpleStub,
  InfoFeedComposerPanel: SimpleStub,
  InfoFeedExpertFeedbackList: SimpleStub,
  InfoFeedFlowPanel: SimpleStub,
  RuntimeDependencyListCard: SimpleStub,
  RuntimeDependencyResultCard: SimpleStub,
  RuntimeDependencyRunDetails: SimpleStub,
  RuntimeDownloadsSummaryCard: SimpleStub,
  SafeHtmlBlock: SafeHtmlBlockStub,
  SegmentedProgressBar: SimpleStub,
  StatusPill: StatusPillStub,
  WordCloudClassCard: SimpleStub,
  WordCloudStageHeader: SimpleStub,
  WorkspaceCloudDrivePanel: SimpleStub,
  WorkspaceCodespacePanel: SimpleStub,
  WorkspaceCreatePanel: SimpleStub,
  WorkspaceExpandedDetail: SimpleStub,
  WorkspaceLocalDirectoryPanel: SimpleStub,
  WorkspaceParentPanel: SimpleStub,
  WorkspaceProfilePanel: SimpleStub,
  WorkspaceSharePanel: SimpleStub,
};

function mountWithStubs(component: any, options: Record<string, any> = {}) {
  return mount(component, {
    ...options,
    global: {
      ...(options.global || {}),
      stubs: {
        ...commonStubs,
        ...(options.global?.stubs || {}),
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  agentEntryCardContextMock.mockReturnValue({
    modelEntryBindings: vi.fn(() => [
      { bindingId: "binding-1", category: "知识", detail: "默认知识库", label: "Knowledge" },
    ]),
    modelEntryIsBound: vi.fn(() => true),
  });

  authorizationGovernanceContextMock.mockReturnValue({
    authorizationGovernance: ref({
      agentBindings: [{ agentId: "agent-a", boundUserId: "owner", groupIds: ["default"] }],
      agentGroups: [{ enabled: true, groupId: "default", policy: { resources: ["*"] } }],
      approvals: [{ agentId: "agent-a", approvalId: "approval-1", grantKind: "once", resourceId: "*" }],
      roles: [{ roleId: "owner", permissions: ["*"] }],
      teams: [{ teamId: "core" }],
      userPolicies: [{ teamIds: ["core"], userId: "owner" }],
    }),
    authorizationGovernanceEditorBody: ref("{\"ok\":true}"),
    authorizationGovernanceEditorKind: ref("role"),
    authorizationGovernanceEditorKinds: ref([
      { label: "Role", value: "role" },
      { label: "Team", value: "team" },
    ]),
    authorizationGovernanceEditorStatus: ref("saved"),
    authorizationGovernanceMetrics: ref([
      { label: "角色", value: "1" },
      { label: "团队", value: "1" },
    ]),
    authorizationGovernanceSaving: ref(false),
    itemText: vi.fn((item: Record<string, unknown>, keys: string[], fallback = "") => {
      for (const key of keys) {
        const value = item?.[key];
        if (value !== undefined && value !== null && value !== "") {
          return String(value);
        }
      }
      return fallback;
    }),
    policyCount: vi.fn((item: Record<string, unknown>) => {
      const resources = (item.policy as { resources?: unknown[] } | undefined)?.resources;
      return Array.isArray(resources) ? resources.length : 1;
    }),
    resetAuthorizationGovernanceEditor: vi.fn(),
    saveAuthorizationGovernanceEditor: vi.fn(),
    shortList: vi.fn((items: unknown[]) => items),
  });

  feedContextMock.mockReturnValue({
    continueInfoFeedAfterModelSelection: vi.fn(),
    continueInfoFeedAfterRetry: vi.fn(),
    deleteInfoFeedHistoryItem: vi.fn(),
    handleAgentAnswerClick: vi.fn(),
    highlightedConfigTarget: ref("info-feed-summary-agent"),
    infoFeedCurrentRun: ref(null),
    infoFeedExpertFeedbackForRun: vi.fn(() => [
      { feedbackId: "fb-1", followUpQuestion: "follow", prompt: "prompt", selectedLabel: "label", syncStatus: "synced" },
    ]),
    infoFeedForm: reactive({ modelAlias: "agent-a" }),
    infoFeedHistory: ref([{ id: "history-1" }]),
    infoFeedHistoryPanelItems: ref([{ id: "history-1", title: "History" }]),
    infoFeedModelOptions: ref([{ label: "Agent A", value: "agent-a" }]),
    infoFeedModelSelectionMessage: ref("请选择智能体"),
    infoFeedNeedsModelSelection: ref(true),
    infoFeedNeedsRetryContinue: ref(true),
    infoFeedParentRunForCurrent: ref({
      runId: "parent-1",
      summary: { answer: "Parent answer" },
    }),
    infoFeedParentSummaryHtml: ref("<p>Parent answer</p>"),
    infoFeedRetryMessage: ref("网络错误"),
    infoFeedRetryStageLabel: vi.fn(() => "总结"),
    selectInfoFeedHistoryItem: vi.fn(),
    selectedInfoFeedModel: ref({ enabled: true }),
  });

  knowledgeWordCloudContextMock.mockReturnValue({
    busyKey: ref(""),
    canWriteKnowledge: ref(true),
    wordCloudCardRows: ref([
      { cloud: { wordBagId: "bag-1", label: "Risk" } },
    ]),
    wordCloudMessages: ref([
      { at: "2026-01-01T00:00:00.000Z", id: "m1", role: "agent", text: "Grouped" },
    ]),
    wordCloudModelAlias: ref("agent-a"),
    wordCloudState: ref({ ok: true }),
  });

  opsMonitorContextMock.mockReturnValue({
    backgroundProcesses: ref([{ pid: 1 }, { pid: 2 }]),
    backgroundRunningCount: ref(1),
    backgroundSupervisorLabel: ref("running"),
    monitorAlertSummary: ref({ activeCount: 3 }),
  });

  runtimeDownloadsContextMock.mockReturnValue({
    cacheRoot: ref("/tmp/pact-cache"),
    failedCount: ref(1),
    generatedAtLabel: ref("刚刚"),
    installedCount: ref(2),
    loadError: ref(""),
    readyCount: ref(3),
    sourceConfigPath: ref("/tmp/runtime-sources.json"),
  });

  shellContextMock.mockReturnValue({
    authBootstrapping: ref(false),
    busyKey: ref(""),
    closeDrawer: vi.fn(),
    drawerOpen: ref(true),
    drawerTab: ref("preferences"),
    hasFeature: vi.fn(() => true),
    appearanceCycleScheme: ref("dark"),
    appearanceCycleSchemeOptions: ref([
      { label: "深色", value: "dark", icon: "moon" },
      { label: "浅色", value: "light", icon: "sun" },
    ]),
    appearancePresetCatalogMessage: ref(""),
    appearancePresetImporting: ref(false),
    appearancePresetOptionsForCycleScheme: ref([
      { label: "落日余烬", value: "sunset-ember" },
      { label: "盛夜古堡", value: "dracula" },
    ]),
    appearancePresetSelectionId: ref("dracula"),
    importAppearancePresetFileToServer: vi.fn(),
    isAuthenticated: ref(true),
    languageMode: ref("zh"),
    languageOptionBarOptions: ref([{ label: "简体中文", value: "zh-CN" }]),
    loginForm: reactive({ username: "owner", password: "secret" }),
    msg: {
      close: "关闭",
      drawer: {
        appearancePreset: "配色",
        directories: "目录",
        importAppearancePresetToServer: "导入到服务端",
        language: "语言",
        preferences: "偏好",
        preferencesDescription: "控制台本地显示设置",
        preferencesTitle: "界面偏好",
        reloadAppearancePresets: "重新加载配色文件",
        serviceDiscovery: "发现",
        theme: "主题",
        themeDark: "深色",
        themeLight: "浅色",
        title: "设置",
        users: "用户",
      },
      topbar: {
        languageEnLabel: "English",
        languageEnTitle: "English",
        languageZhLabel: "中文",
        languageZhTitle: "中文",
      },
    },
    openDrawer: vi.fn(),
    refreshAppearancePresetConfigs: vi.fn(),
    setAppearanceCycleScheme: vi.fn(),
    setAppearancePreset: vi.fn(),
    setLanguage: vi.fn(),
    submitLoginAuth: vi.fn(),
    toggleLanguage: vi.fn(),
    tt: vi.fn((value: string) => value),
  });

  sideNavContextMock.mockReturnValue({
    appearanceCycleScheme: ref("dark"),
    appearanceCycleSchemeLabel: ref("深色主题组"),
    appearancePresetLabel: ref("绿野仙踪"),
    consoleState: ref(null),
    cycleAppearancePreset: vi.fn(),
    languageMode: ref("zh-CN"),
    msg: ref({
      loading: "加载中",
      nav: { systemConfig: "系统设置" },
      topbar: {
        appearanceCycleSchemeDarkLabel: "深色主题组",
        appearanceCycleSchemeDarkTitle: "当前：深色主题组（点击切换浅色主题组）",
        appearanceCycleSchemeLightLabel: "浅色主题组",
        appearanceCycleSchemeLightTitle: "当前：浅色主题组（点击切换深色主题组）",
        appearancePresetLabel: "配色",
        appearancePresetTitle: "配色（点击切换下一个）",
      },
    }),
    openDrawer: vi.fn(),
    sideNavOpen: ref(true),
    toggleAppearanceCycleScheme: vi.fn(),
    toggleLanguage: vi.fn(),
    tt: vi.fn((value: string) => value),
  });

  workspacesContextMock.mockReturnValue({
    chainData: ref({ resolvedProfile: { modelAlias: "agent-a" } }),
    expandedWorkspaceId: ref("workspace-1"),
    panel: ref("list"),
    selected: ref({ title: "Workspace", workspaceId: "workspace-1" }),
  });
});

describe("server-web zero-gap components", () => {
  it("covers agent config and authorization governance cards", async () => {
    const toggle = mountWithStubs(AgentConfigInvocationToggle, {
      props: { label: "允许调用", modelValue: false },
    });
    await toggle.find(".binary-checkbox-stub").trigger("click");
    expect(toggle.emitted("update:modelValue")?.[0]).toEqual([true]);
    expect(toggle.emitted("change")?.[0]).toEqual([true]);

    const entry = reactive({ parametersText: "{}", systemPrompt: "initial" });
    const prompt = mountWithStubs(AgentModelPromptPanel, { props: { entry } });
    const textareas = prompt.findAll("textarea");
    await textareas[0].setValue("system updated");
    await textareas[1].setValue("{\"temperature\":0}");
    expect(entry.systemPrompt).toBe("system updated");
    expect(entry.parametersText).toContain("temperature");

    const bindings = mountWithStubs(AgentModelBindingsPanel, { props: { entry } });
    expect(bindings.text()).toContain("被引用的功能");
    expect(bindings.text()).toContain("Knowledge");

    const editor = mountWithStubs(AuthorizationGovernanceEditor);
    expect(editor.text()).toContain("保存配置");
    await editor.findAll("button")[0].trigger("click");
    await editor.findAll("button")[1].trigger("click");
    const governanceContext = authorizationGovernanceContextMock.mock.results.at(-1)?.value;
    expect(governanceContext.resetAuthorizationGovernanceEditor).toHaveBeenCalled();
    expect(governanceContext.saveAuthorizationGovernanceEditor).toHaveBeenCalled();

    expect(mountWithStubs(AuthorizationGovernanceMetrics).text()).toContain("角色");
    expect(mountWithStubs(AuthorizationGovernanceGrid).text()).toContain("智能体分组");
  });

  it("covers ops monitor and runtime download cards", () => {
    expect(mountWithStubs(OpsMonitorSummaryCard).text()).toContain("进程 1 / 2");

    const summary = mountWithStubs(RuntimeDownloadsSummaryCard);
    expect(summary.text()).toContain("环境配置");
    expect(summary.text()).toContain("/tmp/pact-cache");

    const panel = mountWithStubs(RuntimeDownloadsPanel);
    expect(panel.find(".runtime-download-layout").exists()).toBe(true);

    const details = mountWithStubs(RuntimeDependencyRunDetails, {
      props: {
        logEntries: [{ key: "log-1", level: "info", message: "done", time: "now" }],
        progressState: {
          detail: "detect",
          label: "完成",
          progressPercent: 100,
          segments: [{ key: "detect", label: "检测", state: "completed" }],
        },
      },
    });
    expect(details.text()).toContain("done");

    const run = mountWithStubs(RuntimeDependencyRunCard, {
      props: {
        card: {
          logEntries: [{ key: "log-1", level: "info", message: "done", time: "now" }],
          progressState: {
            detail: "detect",
            label: "完成",
            progressPercent: 100,
            segments: [{ key: "detect", label: "检测", state: "completed" }],
          },
          run: {
            latestMessage: "安装完成",
            runId: "run-1",
            status: "installed",
            targetId: "python",
          },
        },
      },
    });
    expect(run.text()).toContain("python");
    expect(run.text()).toContain("安装完成");
  });

  it("covers feed pause, parent context and conversation branches", async () => {
    const conversation = mountWithStubs(InfoFeedConversationPanel);
    expect(conversation.text()).toContain("输入问题后");
    expect(conversation.text()).toContain("信息流");

    const pause = mountWithStubs(InfoFeedPausePanels);
    expect(pause.text()).toContain("需要选择可用智能体");
    expect(pause.text()).toContain("总结请求中断");
    await pause.findAll("button").at(-1)?.trigger("click");
    const feedContext = feedContextMock.mock.results.at(-1)?.value;
    expect(feedContext.continueInfoFeedAfterRetry).toHaveBeenCalled();

    const parent = mountWithStubs(InfoFeedParentContextCards);
    expect(parent.text()).toContain("知识归纳");
    expect(parent.text()).toContain("Parent answer");
    await parent.find(".safe-html-stub").trigger("click");
    expect(feedContext.handleAgentAnswerClick).toHaveBeenCalled();

    feedContextMock.mockReturnValueOnce({
      ...feedContext,
      infoFeedCurrentRun: ref({ runId: "run-1" }),
    });
    expect(mountWithStubs(InfoFeedConversationPanel).findComponent(SimpleStub).exists()).toBe(true);
  });

  it("covers word-cloud list and stage branches", async () => {
    const list = mountWithStubs(WordCloudCardList);
    expect(list.find(".word-cloud-card-list").exists()).toBe(true);

    const stage = mountWithStubs(WordCloudStage);
    expect(stage.find(".word-cloud-stage").exists()).toBe(true);

    const context = knowledgeWordCloudContextMock.mock.results.at(-1)?.value;

    knowledgeWordCloudContextMock.mockReturnValueOnce({
      ...context,
      wordCloudCardRows: ref([]),
      wordCloudState: ref(null),
    });
    expect(mountWithStubs(WordCloudCardList).text()).toContain("正在加载词袋");

    knowledgeWordCloudContextMock.mockReturnValueOnce({
      ...context,
      wordCloudCardRows: ref([]),
      wordCloudState: ref({ ok: true }),
    });
    expect(mountWithStubs(WordCloudCardList).text()).toContain("暂无词袋");
  });

  it("covers shell auth gate, drawer, side-nav brand and footer", async () => {
    const auth = mountWithStubs(ConsoleAuthGate);
    expect(auth.text()).toContain("控制台登录");
    await auth.find(".auth-language-button").trigger("click");
    await auth.find("form").trigger("submit");
    const shellContext = shellContextMock.mock.results.at(-1)?.value;
    expect(shellContext.toggleLanguage).toHaveBeenCalled();
    expect(shellContext.submitLoginAuth).toHaveBeenCalled();

    const drawer = mountWithStubs(ConsoleDrawer);
    expect(drawer.text()).toContain("设置");
    await drawer.find(".drawer-backdrop").trigger("click");
    await drawer.findAll(".drawer-tab")[1].trigger("click");
    expect(shellContext.closeDrawer).toHaveBeenCalled();
    expect(shellContext.openDrawer).toHaveBeenCalledWith("discovery");

    const brand = mountWithStubs(ConsoleSideNavBrand);
    expect(brand.text()).toContain("加载中");

    const footer = mountWithStubs(ConsoleSideNavFooter);
    const sideNavContext = sideNavContextMock.mock.results.at(-1)?.value;
    const globalActions = footer.findAll(".side-global-action");
    await globalActions[0].trigger("click");
    await globalActions[1].trigger("click");
    expect(sideNavContext.toggleAppearanceCycleScheme).toHaveBeenCalled();
    expect(sideNavContext.cycleAppearancePreset).toHaveBeenCalled();

    await footer.find(".side-cta").trigger("click");
    expect(sideNavContext.sideNavOpen.value).toBe(false);
    expect(sideNavContext.openDrawer).toHaveBeenCalledWith("preferences");
  });

  it("renders appearance preferences as scheme and filtered preset selectors", async () => {
    const preferences = mountWithStubs(ConsolePreferencesPanel, {
      global: {
        stubs: {
          OptionBar: OptionBarProbeStub,
        },
      },
    });

    const optionBars = preferences.findAll(".option-bar-probe");
    expect(optionBars).toHaveLength(3);
    expect(optionBars[0].attributes("data-label")).toBe("");
    expect(optionBars[0].attributes("data-model")).toBe("zh");
    expect(optionBars[0].text()).toContain("简体中文:zh-CN");
    expect(optionBars[1].attributes("data-label")).toBe("主题");
    expect(optionBars[1].text()).toContain("深色:dark");
    expect(optionBars[1].text()).toContain("浅色:light");
    expect(optionBars[2].attributes("data-label")).toBe("配色");
    expect(optionBars[2].attributes("data-model")).toBe("dracula");
    expect(optionBars[2].text()).toContain("落日余烬:sunset-ember");
    expect(optionBars[2].text()).toContain("盛夜古堡:dracula");

    await optionBars[1].trigger("click");
    const shellContext = shellContextMock.mock.results.at(-1)?.value;
    expect(shellContext.setAppearanceCycleScheme).toHaveBeenCalledWith("dark");
  });

  it("covers workspace detail and resolved profile panels", () => {
    const detail = mountWithStubs(WorkspaceDetailPanel);
    expect(detail.find(".ws-detail").exists()).toBe(true);

    const resolved = mountWithStubs(WorkspaceResolvedProfilePanel);
    expect(resolved.text()).toContain("agent-a");

    const baseContext = workspacesContextMock.mock.results.at(-1)?.value;
    workspacesContextMock.mockReturnValueOnce({
      ...baseContext,
      expandedWorkspaceId: ref("other"),
      panel: ref("list"),
      selected: ref({ title: "Workspace", workspaceId: "workspace-1" }),
    });
    expect(mountWithStubs(WorkspaceDetailPanel).find(".ws-detail").exists()).toBe(false);
  });
});
