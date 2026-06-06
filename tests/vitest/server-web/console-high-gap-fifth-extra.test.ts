// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import WorkspaceCodespacePanel from "../../../server-web/components/workspaces/detail/WorkspaceCodespacePanel.vue";
import ExpertVocabularyPanel from "../../../server-web/components/knowledge/rules/ExpertVocabularyPanel.vue";
import WordCloudCardBody from "../../../server-web/components/knowledge/word-cloud/WordCloudCardBody.vue";

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const copyConsoleTextWithFeedback = vi.hoisted(() => vi.fn());

const workspacesContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const knowledgeRulesContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const knowledgeWordCloudContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: (...args: unknown[]) => copyConsoleTextWithFeedback(...args),
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: vi.fn(() => workspacesContextMock.current),
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeRulesContext: vi.fn(() => knowledgeRulesContextMock.current),
  useKnowledgeWordCloudContext: vi.fn(() => knowledgeWordCloudContextMock.current),
}));

const ConfigFloatingPanelStub = defineComponent({
  name: "ConfigFloatingPanel",
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    statusTone: { type: String, default: "" },
    statusLabel: { type: String, default: "" },
    verifying: { type: Boolean, default: false },
  },
  emits: ["close", "verify"],
  setup(props, { emit, slots }) {
    return () =>
      props.open
        ? h("section", { class: "config-floating-panel-stub" }, [
            h("h3", String(props.title || "")),
            h("p", String(props.subtitle || "")),
            h("button", { type: "button", class: "config-floating-panel-verify", onClick: () => emit("verify") }, props.verifying ? "校验中" : "校验配置"),
            h("button", { type: "button", class: "config-floating-panel-close", onClick: () => emit("close") }, "关闭"),
            h("div", { class: "config-floating-panel-status", "data-tone": String(props.statusTone || ""), "data-label": String(props.statusLabel || "") }),
            slots.default?.(),
          ])
        : null;
  },
});

const HelpTooltipStub = defineComponent({
  name: "HelpTooltip",
  props: {
    ariaLabel: { type: String, default: "" },
    items: { type: Array, default: () => [] },
    text: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "help-tooltip-stub", "aria-label": props.ariaLabel }, String(props.text || ""));
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label || ""));
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h("button", {
        type: "button",
        class: "binary-checkbox-stub",
        disabled: props.disabled,
        onClick: () => {
          if (props.disabled) return;
          const next = !props.modelValue;
          emit("update:model-value", next);
          emit("update:modelValue", next);
          emit("change", next);
        },
      }, String(props.label || ""));
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    modelValue: { type: [String, Number, Boolean, Object], default: "" },
    options: { type: Array, default: () => [] },
    label: { type: String, default: "" },
  },
  emits: ["update:model-value", "update:modelValue"],
  setup(props) {
    return () => h("div", { class: "option-bar-stub" }, String(props.label || ""));
  },
});

const FeatureToggleStub = defineComponent({
  name: "FeatureToggle",
  props: {
    modelValue: { type: Boolean, default: false },
    ariaLabel: { type: String, default: "" },
  },
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("button", {
        type: "button",
        class: "feature-toggle-stub",
        "aria-label": props.ariaLabel,
        onClick: () => {
          const next = !props.modelValue;
          emit("update:model-value", next);
          emit("update:modelValue", next);
        },
      }, props.modelValue ? "on" : "off");
  },
});

function setRect(element: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        top: rect.top ?? 0,
        left: rect.left ?? 0,
        right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
        bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    entryId: "mcp-docs",
    serviceId: "mcp-docs",
    serviceName: "Docs MCP",
    displayName: "Docs MCP",
    description: "Documentation MCP service",
    mode: "connected",
    startupPolicy: "external-only",
    source: "configured",
    sourceLabel: "本地",
    filePath: "/tmp/pact/external-services.json",
    requiredOperations: ["knowledge.search"],
    scriptCount: 1,
    validationStatus: "valid",
    validation: { ok: true, errors: [], warnings: [] },
    externalMcp: { tools: ["search", { name: "search" }, { id: "file.list" }, "status"] },
    upstreamTargetLabelText: "127.0.0.1:8787",
    upstreamTargetDetailText: "endpoint",
    sourceLabelText: "本地 / mcp-docs",
    discoveryLabelText: "MCP 服务",
    discoveryTone: "success",
    discoveryRegistrationLabelText: "工具已发现",
    discoveryRegistrationTone: "success",
    heartbeatText: "Latest: -",
    heartbeatRefreshing: false,
    ...overrides,
  };
}

function createExternalServicesController(overrides: Record<string, unknown> = {}) {
  return {
    actionError: "",
    actionMessage: "",
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    closeConfigEditor: vi.fn(),
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    configDraft: {
      binding: { mode: "passthrough", outlet: "pact.skillHub", risk: "read_only" },
      healthCheck: { type: "none", host: "127.0.0.1", port: null, timeoutMs: 60000, url: "" },
      mode: "connected",
      metadata: {},
      scripts: {},
      serviceId: "mcp-docs",
      serviceName: "Docs MCP",
      startupPolicy: "external-only",
      description: "",
      upstream: {
        type: "cloud-drive",
        transport: "pact-upstream-gateway",
        provider: "icloud",
        rootPath: "/Users/name/Library/Mobile Documents/com~apple~CloudDocs",
        endpointRef: "config://drive-endpoint",
        endpointUrl: "https://drive.example",
        url: "https://drive.example",
        timeoutMs: 5000,
      },
    },
    configEditorOpen: false,
    configEditorMode: "add",
    configEditorSubtitle: "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configEditorTitle: "添加服务",
    configStatusLabel: "Valid",
    configStatusTone: "success",
    configText: "{\n  \"serviceId\": \"mcp-docs\"\n}",
    configDraftText: "",
    customUpstreamTypeValue: "",
    discoveredServiceCount: 1,
    dirty: false,
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    isCloudDriveServiceDraft: true,
    isLlmServiceDraft: true,
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: 4,
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: "openai-compatible",
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [{ value: "read_only", label: "read_only" }],
    saveConfig: vi.fn(),
    serviceDiscoveryLabel: vi.fn(() => "MCP 服务"),
    serviceDiscoveryRegistrationLabel: vi.fn(() => "工具已发现"),
    serviceDiscoveryRegistrationTone: vi.fn(() => "success"),
    serviceDiscoveryTone: vi.fn(() => "success"),
    serviceHeartbeatLastAtLabel: vi.fn(() => "Latest: -"),
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    serviceSourceDetail: vi.fn(() => "本地 / mcp-docs"),
    services: [createService()],
    showCustomUpstreamType: true,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTargetDetailLabel: vi.fn(() => "endpoint"),
    upstreamTargetLabel: vi.fn(() => "127.0.0.1:8787"),
    validServiceCount: 1,
    validationErrors: ["invalid upstream"],
    validationWarnings: ["check transport"],
    verifying: false,
    verifyConfig: vi.fn(),
    ...overrides,
  };
}

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  externalServicesControllerMock.current = createExternalServicesController(overrides);
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        ConfigFloatingPanel: ConfigFloatingPanelStub,
        HelpTooltip: HelpTooltipStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

function createWorkspacesContext(overrides: Record<string, unknown> = {}) {
  return {
    busyKey: ref(""),
    codespaceForm: ref({
      branch: "main",
      diff: "",
      provider: "github",
      repoId: "/Users/unka/DevSpace/Unka-Malloc/Pact",
      repositoryRef: "unka/Pact",
      baseRef: "main",
      headRef: "feature/high-gap",
    }),
    codespaceResult: ref(null as Record<string, unknown> | null),
    inspectCodespaceStatus: vi.fn(),
    panel: ref("codespace"),
    prepareCodespaceChange: vi.fn(),
    selected: ref({ title: "Pact" }),
    uploadCodespaceChange: vi.fn(),
    ...overrides,
  };
}

function mountWorkspaceCodespacePanel(overrides: Record<string, unknown> = {}) {
  workspacesContextMock.current = createWorkspacesContext(overrides);
  return mount(WorkspaceCodespacePanel, {
    global: {
      stubs: {
        OptionBar: OptionBarStub,
      },
    },
  });
}

function createKnowledgeRulesContext(overrides: Record<string, unknown> = {}) {
  const expertVocabularyDraft = ref({
    version: 2,
    entries: [
      {
        id: "entry-1",
        path: "knowledge/ingest",
        keywords: ["ingest", "pipeline"],
        domains: ["pact.example.com"],
        status: "active",
        notes: "keep",
      },
    ],
  });

  const displayedVocabularyEntries = ref([
    {
      index: 0,
      entry: expertVocabularyDraft.value.entries[0],
    },
  ]);

  return {
    addVocabularyEntry: vi.fn(),
    busyKey: ref(""),
    deleteVocabularyEntry: vi.fn(),
    displayedVocabularyEntries,
    expertVocabularyDraft,
    hiddenVocabularyEntryCount: ref(0),
    saveExpertVocabulary: vi.fn(),
    setVocabularyEntryEnabled: vi.fn(),
    showAllVocabularyEntries: ref(false),
    updateVocabularyDomains: vi.fn(),
    updateVocabularyKeywords: vi.fn(),
    updateVocabularyPath: vi.fn(),
    vocabularyEntryPath: vi.fn((entry: { path?: string }) => entry.path || ""),
    vocabularySearch: ref(""),
    ...overrides,
  };
}

function mountExpertVocabularyPanel(overrides: Record<string, unknown> = {}) {
  knowledgeRulesContextMock.current = createKnowledgeRulesContext(overrides);
  return mount(ExpertVocabularyPanel, {
    global: {
      stubs: {
        FeatureToggle: FeatureToggleStub,
      },
    },
  });
}

function createWordCloudContext(overrides: Record<string, unknown> = {}) {
  const advancedIds = ref(new Set<string>());
  const summaryIds = ref(new Set<string>());
  const wordCloudTermInputs = ref<Record<string, string>>({
    "bag-1": "",
  });

  function toggleSet(target: Ref<Set<string>>, bagId: string) {
    const next = new Set(target.value);
    if (next.has(bagId)) {
      next.delete(bagId);
    } else {
      next.add(bagId);
    }
    target.value = next;
  }

  return {
    addTermInputToCloud: vi.fn(),
    clearRemovedTermsFromCloud: vi.fn(),
    expandedAdvancedIds: advancedIds,
    expandedSummaryIds: summaryIds,
    removeTermFromCloud: vi.fn(),
    setWordCloudTermInput: vi.fn((bagId: string, value: string) => {
      wordCloudTermInputs.value = {
        ...wordCloudTermInputs.value,
        [bagId]: value,
      };
    }),
    toggleAdvancedExpanded: vi.fn((bagId: string) => toggleSet(advancedIds, bagId)),
    toggleSummaryExpanded: vi.fn((bagId: string) => toggleSet(summaryIds, bagId)),
    updateWordCloudField: vi.fn(),
    wordCloudTermInputs,
    wordCloudVisibleTerms: vi.fn((cloud: { removedTerms?: Array<{ term: string; frequency?: number }> }) => [
      { term: "keep", frequency: 3, removed: false },
      ...(cloud.removedTerms || []).map((item) => ({
        term: item.term,
        frequency: item.frequency || 0,
        removed: true,
      })),
    ]),
    ...overrides,
  };
}

function mountWordCloudCardBody(overrides: Record<string, unknown> = {}) {
  knowledgeWordCloudContextMock.current = createWordCloudContext(overrides);
  return mount(WordCloudCardBody, {
    props: {
      row: {
        cloud: {
          absorbThreshold: 0.25,
          removedTerms: [{ term: "obsolete", frequency: 1 }],
          summary: "",
          wordBagId: "bag-1",
        },
      },
    },
  });
}

beforeEach(() => {
  externalServicesControllerMock.current = null;
  workspacesContextMock.current = null;
  knowledgeRulesContextMock.current = null;
  knowledgeWordCloudContextMock.current = null;
  copyConsoleTextWithFeedback.mockReset();
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ExternalServicesView", () => {
  it("switches bubble and popover placement based on geometry and handles table drag/keyboard input", async () => {
    const wrapper = mountExternalServicesView({
      services: [
        createService({
          externalMcp: { tools: ["search", { name: "search" }, { id: "file.list" }, "status"] },
        }),
      ],
    });

    await nextTick();

    const copyButton = wrapper.get(".external-service-upstream-copy");
    setRect(copyButton.element, {
      top: 40,
      bottom: 60,
      left: 24,
      right: 168,
      width: 144,
      height: 20,
      x: 24,
      y: 40,
    });
    await copyButton.trigger("mouseenter");
    await nextTick();
    expect(wrapper.get(".external-service-upstream-bubble").classes()).toContain("is-below");

    setRect(copyButton.element, {
      top: 220,
      bottom: 240,
      left: 24,
      right: 168,
      width: 144,
      height: 20,
      x: 24,
      y: 220,
    });
    await copyButton.trigger("mouseenter");
    await nextTick();
    expect(wrapper.get(".external-service-upstream-bubble").classes()).toContain("is-above");

    const toolButton = wrapper.get(".external-service-tool-list-button");
    setRect(toolButton.element, {
      top: 300,
      bottom: 340,
      left: 28,
      right: 150,
      width: 122,
      height: 40,
      x: 28,
      y: 300,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    await toolButton.trigger("click");
    await nextTick();
    const popover = wrapper.get(".external-service-tool-popover");
    expect(popover.classes()).toContain("is-above");
    expect(popover.text()).toContain("search");
    expect(popover.text()).toContain("file.list");
    expect(popover.text()).toContain("status");

    const scroller = wrapper.get(".external-service-table-scroll").element as HTMLElement & {
      setPointerCapture?: (pointerId: number) => void;
      releasePointerCapture?: (pointerId: number) => void;
      hasPointerCapture?: (pointerId: number) => boolean;
    };
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(scroller, "scrollLeft", { configurable: true, writable: true, value: 100 });
    scroller.setPointerCapture = vi.fn();
    scroller.releasePointerCapture = vi.fn();
    scroller.hasPointerCapture = vi.fn(() => true);

    scroller.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(scroller.scrollLeft).toBe(196);
    scroller.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    expect(scroller.scrollLeft).toBe(0);
  });
});

describe("WorkspaceCodespacePanel", () => {
  it("hides itself without a selection and renders stateful controls when selected", async () => {
    const wrapper = mountWorkspaceCodespacePanel({
      selected: ref(null),
    });
    expect(wrapper.html()).toContain("v-if");
    wrapper.unmount();

    const context = createWorkspacesContext({
      busyKey: ref("ws:codespace-status"),
      codespaceResult: ref({ ok: true, path: "/tmp/codespace" }),
    });
    workspacesContextMock.current = context;
    const mounted = mount(WorkspaceCodespacePanel, {
      global: {
        stubs: {
          OptionBar: OptionBarStub,
        },
      },
    });

    expect(mounted.text()).toContain("代码库");
    expect(mounted.text()).toContain("读取中…");
    expect(mounted.find(".workspace-codespace-result").text()).toContain("/tmp/codespace");

    context.busyKey.value = "ws:codespace-prepare";
    await nextTick();
    expect(mounted.text()).toContain("准备中…");

    context.busyKey.value = "ws:codespace-upload";
    await nextTick();
    expect(mounted.text()).toContain("验证中…");

    await mounted.findAll("button").find((button) => button.text() === "取消")?.trigger("click");
    expect(context.panel.value).toBe("list");
    context.busyKey.value = "";
    await nextTick();
    await mounted.findAll("button").find((button) => button.text() === "读取状态")?.trigger("click");
    expect(context.inspectCodespaceStatus).toHaveBeenCalledTimes(1);
  });
});

describe("ExpertVocabularyPanel", () => {
  it("covers empty state, row editing, and footer toggle branches", async () => {
    const context = createKnowledgeRulesContext({
      hiddenVocabularyEntryCount: ref(2),
    });
    knowledgeRulesContextMock.current = context;
    const wrapper = mount(ExpertVocabularyPanel, {
      global: {
        stubs: {
          FeatureToggle: FeatureToggleStub,
        },
      },
    });

    expect(wrapper.text()).toContain("专家词汇规则");
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(wrapper.text()).toContain("已隐藏 2 条低频维护项。");
    await wrapper.findAll("tbody input").at(0)!.setValue("knowledge/ingest/entry");
    expect(context.updateVocabularyPath).toHaveBeenCalledWith(0, "knowledge/ingest/entry");

    const textareas = wrapper.findAll("textarea");
    await textareas[0].setValue("ingest, pipeline, sync");
    expect(context.updateVocabularyKeywords).toHaveBeenCalledWith(0, "ingest, pipeline, sync");
    await textareas[1].setValue("pact.example.com, api.example.com");
    expect(context.updateVocabularyDomains).toHaveBeenCalledWith(0, "pact.example.com, api.example.com");

    await wrapper.get(".feature-toggle-stub").trigger("click");
    expect(context.setVocabularyEntryEnabled).toHaveBeenCalledWith(0, false);

    await wrapper.get("tbody .table-action").trigger("click");
    expect(context.deleteVocabularyEntry).toHaveBeenCalledWith(0);

    await wrapper.get(".vocabulary-footer .table-action").trigger("click");
    expect(context.showAllVocabularyEntries.value).toBe(true);
  });

  it("shows the all-visible footer when the search is empty and no rows are hidden", async () => {
    const wrapper = mountExpertVocabularyPanel({
      hiddenVocabularyEntryCount: ref(0),
      showAllVocabularyEntries: ref(true),
      vocabularySearch: ref(""),
    });

    expect(wrapper.text()).toContain("已显示全部词条。");
    await wrapper.get(".vocabulary-footer .table-action").trigger("click");
    const context = knowledgeRulesContextMock.current as any;
    expect(context.showAllVocabularyEntries.value).toBe(false);
  });
});

describe("WordCloudCardBody", () => {
  it("toggles advanced and summary panes, handles term actions, and clears removed terms", async () => {
    const wrapper = mountWordCloudCardBody({
      wordCloudVisibleTerms: vi.fn((cloud: { removedTerms?: Array<{ term: string; frequency?: number }> }) => [
        { term: "keep", frequency: 3, removed: false },
        ...(cloud.removedTerms || []).map((item) => ({
          term: item.term,
          frequency: item.frequency || 0,
          removed: true,
        })),
      ]),
    });
    const context = knowledgeWordCloudContextMock.current as any;

    expect(wrapper.findAll(".word-cloud-term-remove")).toHaveLength(1);
    expect(wrapper.text()).toContain("keep");
    expect(wrapper.text()).toContain("obsolete");
    expect((wrapper.findAll(".word-cloud-summary-body")[0].element as HTMLElement).style.display).toBe("none");

    await wrapper.get(".word-cloud-summary-toggle").trigger("click");
    await nextTick();
    expect(context.toggleAdvancedExpanded).toHaveBeenCalledWith("bag-1");
    expect((wrapper.findAll(".word-cloud-summary-body")[0].element as HTMLElement).style.display).toBe("");

    await wrapper.findAll(".word-cloud-summary-toggle")[1].trigger("click");
    await nextTick();
    expect(context.toggleSummaryExpanded).toHaveBeenCalledWith("bag-1");
    expect((wrapper.findAll(".word-cloud-summary-body")[1].element as HTMLElement).style.display).toBe("");

    await wrapper.get(".word-cloud-threshold-field input").setValue("0.42");
    expect(context.updateWordCloudField).toHaveBeenCalledWith("bag-1", "absorbThreshold", "0.42");

    await wrapper.get(".word-cloud-term-remove").trigger("click");
    expect(context.removeTermFromCloud).toHaveBeenCalledWith(
      "bag-1",
      expect.objectContaining({ term: "keep" }),
    );

    await wrapper.get(".word-cloud-inline-add input").setValue("new term");
    expect(context.setWordCloudTermInput).toHaveBeenCalledWith("bag-1", "new term");
    await wrapper.get(".word-cloud-inline-add .compact-action").trigger("click");
    expect(context.addTermInputToCloud).toHaveBeenCalledWith("bag-1");

    await wrapper.get(".word-cloud-inline-add .tool-button-ghost").trigger("click");
    expect(context.clearRemovedTermsFromCloud).toHaveBeenCalledWith("bag-1");
  });
});

describe("console-navigation-controller", () => {
  it("routes external services directly and keeps the list tab stable", () => {
    const error = ref("");
    const router = {
      currentRoute: ref({
        path: "/dashboard",
        meta: { viewId: "dashboard" },
        params: {},
      }),
      push: vi.fn(),
    };
    const refresh = vi.fn();
    const controller = createConsoleNavigationController({
      error,
      ensureAgentPermissionGroupsDraft: vi.fn(),
      hasFeature: () => true,
      isAdminViewEnabled: () => true,
      refreshAuthAdmin: refresh,
      refreshBackgroundProcesses: refresh,
      refreshClientRuntimeStatus: refresh,
      refreshContextCompiler: refresh,
      refreshDashboardAlertsSnapshot: refresh,
      refreshExpertRules: refresh,
      refreshKnowledgeConsole: refresh,
      refreshKnowledgeRecallBackendSpaces: refresh,
      refreshMaintenanceAgent: refresh,
      refreshMonitorAlerts: refresh,
      refreshState: refresh,
      refreshToolManagement: refresh,
      refreshWordCloud: refresh,
      scrollToConfigTarget: vi.fn(),
      visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
      visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }]),
    });

    controller.bindNavigationRouter(router);
    controller.openExternalServiceTab("list");

    expect(controller.currentView.value).toBe("externalServices");
    expect(controller.externalServiceTab.value).toBe("list");
    expect(router.push).toHaveBeenCalledWith("/external-services/list");
    expect(error.value).toBe("");
  });
});
