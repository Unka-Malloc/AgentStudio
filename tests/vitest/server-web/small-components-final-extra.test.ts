// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import AgentModelAccessPanel from "../../../server-web/components/admin/agent-config/AgentModelAccessPanel.vue";
import AgentModelLibraryPanel from "../../../server-web/components/admin/agent-config/AgentModelLibraryPanel.vue";
import AgentRetrievalForm from "../../../server-web/components/debug/AgentRetrievalForm.vue";
import KnowledgeRecallDebugPanel from "../../../server-web/components/debug/KnowledgeRecallDebugPanel.vue";
import SourcesAddDataSourceDialog from "../../../server-web/components/sources/SourcesAddDataSourceDialog.vue";
import KnowledgeView from "../../../server-web/views/KnowledgeView.vue";

const accessContextMock = vi.hoisted(() => vi.fn());
const shellContextMock = vi.hoisted(() => vi.fn());
const debugContextMock = vi.hoisted(() => vi.fn());
const retrievalContextMock = vi.hoisted(() => vi.fn());
const sourcesContextMock = vi.hoisted(() => vi.fn());
const knowledgeConsoleMock = vi.hoisted(() => vi.fn());
const provideKnowledgeViewMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/agentModelEntryCardContext", () => ({
  useAgentModelEntryCardContext: accessContextMock
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock
}));

vi.mock("../../../server-web/composables/debugViewContext", () => ({
  useDebugViewContext: debugContextMock
}));

vi.mock("../../../server-web/composables/agentRetrievalViewContext", () => ({
  useAgentRetrievalViewContext: retrievalContextMock
}));

vi.mock("../../../server-web/composables/sourcesViewContext", () => ({
  useSourcesViewContext: sourcesContextMock
}));

vi.mock("../../../server-web/composables/useKnowledgeViewConsole", () => ({
  useKnowledgeViewConsole: knowledgeConsoleMock
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  provideKnowledgeView: provideKnowledgeViewMock
}));

vi.mock("../../../server-web/composables/console-format-utils", () => ({
  jsonPreview: vi.fn((value: unknown) => `json:${JSON.stringify(value)}`)
}));

vi.mock("../../../server-web/composables/console-knowledge-search-utils", () => ({
  knowledgeFusionSummary: vi.fn((response: any) => response?.fusion || "")
}));

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: { title: { type: String, default: "" } },
  setup(props, { slots }) {
    return () => h("section", { class: "config-fold-card-stub" }, [
      h("h4", props.title),
      slots.default?.()
    ]);
  }
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: ["modelValue", "options", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "option-bar-stub",
      type: "button",
      "data-label": String(props.label || ""),
      onClick: () => {
        const next = (props.options as Array<{ value: string }> | undefined)?.[1]?.value || "next";
        emit("update:model-value", next);
        emit("update:modelValue", next);
      }
    }, String(props.modelValue ?? ""));
  }
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "binary-checkbox-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        if (!props.disabled) {
          emit("update:model-value", !props.modelValue);
          emit("update:modelValue", !props.modelValue);
        }
      }
    }, String(props.label || ""));
  }
});

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: ["disabled", "buttonText"],
  emits: ["browse"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "browse-select-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        if (!props.disabled) {
          emit("browse");
        }
      }
    }, String(props.buttonText || "browse"));
  }
});

const InfoFeedResultRowStub = defineComponent({
  name: "InfoFeedResultRow",
  props: ["item"],
  emits: ["open"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "info-feed-result-row-stub",
      type: "button",
      onClick: () => emit("open", props.item)
    }, String((props.item as any)?.title || "result"));
  }
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: ["modelValue", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "agent-model-option-bar-stub",
      type: "button",
      onClick: () => {
        emit("update:model-value", "model-next");
        emit("update:modelValue", "model-next");
      }
    }, `${props.label}:${props.modelValue || ""}`);
  }
});

function commonStubs() {
  return {
    BinaryCheckbox: BinaryCheckboxStub,
    BrowseSelectButton: BrowseSelectButtonStub,
    ConfigFoldCard: ConfigFoldCardStub,
    InfoFeedResultRow: InfoFeedResultRowStub,
    OptionBar: OptionBarStub,
    AgentModelOptionBar: AgentModelOptionBarStub,
    AgentModelEntryCard: defineComponent({
      name: "AgentModelEntryCard",
      props: ["entry"],
      setup(props) {
        return () => h("article", { class: "agent-model-entry-card-stub" }, String((props.entry as any)?.instanceId || ""));
      }
    }),
    KnowledgeWordCloudPanel: { template: '<div class="knowledge-word-cloud-stub">word</div>' },
    KnowledgeIngestPanel: { template: '<div class="knowledge-ingest-stub">ingest</div>' },
    KnowledgeMaintenancePanel: { template: '<div class="knowledge-maintenance-stub">maintenance</div>' },
    KnowledgeRulesPanel: { template: '<div class="knowledge-rules-stub">rules</div>' }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("server-web small component final extra coverage", () => {
  it("renders knowledge view branches and provides the composed context", () => {
    const knowledgeView = {
      page: {
        activeKnowledgeTab: "management",
        dynamicParsingPolicySignature: "policy:1",
        isKnownKnowledgeTab: true,
        isManagementKnowledgePanel: true,
        isManagementRulesPanel: false
      }
    };
    knowledgeConsoleMock.mockReturnValueOnce(knowledgeView);
    const wrapper = mount(KnowledgeView, {
      global: { stubs: commonStubs() }
    });
    expect(provideKnowledgeViewMock).toHaveBeenCalledWith(knowledgeView);
    expect(wrapper.attributes("data-dynamic-parsing-policy")).toBe("policy:1");
    expect(wrapper.find(".knowledge-ingest-stub").exists()).toBe(true);

    knowledgeConsoleMock.mockReturnValueOnce({
      page: {
        activeKnowledgeTab: "missing",
        dynamicParsingPolicySignature: "policy:2",
        isKnownKnowledgeTab: false,
        isManagementKnowledgePanel: false,
        isManagementRulesPanel: false
      }
    });
    const empty = mount(KnowledgeView, {
      global: { stubs: commonStubs() }
    });
    expect(empty.text()).toContain("知识库页面已空");
  });

  it("wires model access option bars and module checkboxes through context handlers", async () => {
    const entry = {
      instanceId: "model-a",
      permissionGroupId: "group-a",
      moduleAccess: { mode: "selected", moduleIds: ["knowledge"] }
    };
    const modelEntryModuleAccess = vi.fn(() => entry.moduleAccess);
    const setModelEntryPermissionGroup = vi.fn();
    const setModelEntryModuleAccessMode = vi.fn();
    const toggleModelEntryModuleAccess = vi.fn();
    accessContextMock.mockReturnValue({
      agentPermissionGroupOptionBarOptions: [{ value: "group-a" }, { value: "group-b" }],
      intelligentModuleDefinitions: [
        { id: "knowledge", label: "知识库" },
        { id: "debug", label: "调试" }
      ],
      modelEntryModuleAccess,
      moduleAccessModeOptionBarOptions: [{ value: "all" }, { value: "selected" }],
      setModelEntryModuleAccessMode,
      setModelEntryPermissionGroup,
      toggleModelEntryModuleAccess
    });

    const wrapper = mount(AgentModelAccessPanel, {
      props: { entry: entry as any },
      global: { stubs: commonStubs() }
    });
    const optionBars = wrapper.findAll(".option-bar-stub");
    await optionBars[0].trigger("click");
    await optionBars[1].trigger("click");
    await wrapper.findAll(".binary-checkbox-stub")[1].trigger("click");

    expect(setModelEntryPermissionGroup).toHaveBeenCalledWith(entry, "group-b");
    expect(setModelEntryModuleAccessMode).toHaveBeenCalledWith(entry, "selected");
    expect(toggleModelEntryModuleAccess).toHaveBeenCalledWith(entry, "debug", true);
  });

  it("renders model library empty/list states and save busy label", async () => {
    const addModelProvider = vi.fn();
    const saveModelLibrarySettings = vi.fn();
    const selectedModelProvider = ref("openai");
    shellContextMock.mockReturnValueOnce({
      addModelProvider,
      addableModelProviderOptionBarOptions: [{ value: "openai" }, { value: "anthropic" }],
      busyKey: "model-library-save",
      highlightedConfigTarget: "agent-model-library",
      saveModelLibrarySettings,
      selectedModelProvider,
      visibleModelEntries: ref([])
    });
    const empty = mount(AgentModelLibraryPanel, {
      global: { stubs: commonStubs() }
    });
    expect(empty.attributes("data-config-highlighted")).toBe("true");
    expect(empty.text()).toContain("当前模型库为空");
    await empty.get(".tool-button").trigger("click");
    await empty.get("form").trigger("submit");
    expect(addModelProvider).toHaveBeenCalled();
    expect(saveModelLibrarySettings).toHaveBeenCalled();
    expect(empty.text()).toContain("探测并保存中");

    shellContextMock.mockReturnValueOnce({
      addModelProvider,
      addableModelProviderOptionBarOptions: [{ value: "openai" }],
      busyKey: "",
      highlightedConfigTarget: "",
      saveModelLibrarySettings,
      selectedModelProvider,
      visibleModelEntries: ref([{ instanceId: "model-1" }])
    });
    const populated = mount(AgentModelLibraryPanel, {
      global: { stubs: commonStubs() }
    });
    expect(populated.find(".agent-model-entry-card-stub").text()).toBe("model-1");
    expect(populated.text()).toContain("保存配置");
  });

  it("handles knowledge recall debug states and opens evidence rows", async () => {
    const runKnowledgeRecallDebugBatch = vi.fn();
    const openAgentEvidencePreview = vi.fn();
    const form = ref({
      query: "",
      targetId: "all",
      retrievalMode: "hybrid",
      keywordOnly: false,
      learningEnabled: true,
      explain: false
    });
    debugContextMock.mockReturnValue({
      busyKey: "debug:knowledge-recall",
      knowledgeConsole: { available: false },
      knowledgeRecallDebugForm: form,
      knowledgeRecallDebugGridStyle: { gridTemplateColumns: "repeat(2, 1fr)" },
      knowledgeRecallDebugModeOptionBarOptions: [{ value: "hybrid" }, { value: "keyword" }],
      knowledgeRecallDebugRuns: [
        {
          runId: "running",
          label: "运行中",
          status: "running",
          elapsedMs: 10,
          items: [],
          response: null
        },
        {
          runId: "failed",
          label: "失败",
          status: "failed",
          elapsedMs: 11,
          items: [],
          error: "bad query",
          response: { fusion: "融合失败" }
        },
        {
          runId: "done",
          label: "完成",
          status: "completed",
          elapsedMs: 12,
          items: [{ title: "Evidence A", evidenceId: "ev-a" }],
          response: { ok: true, fusion: "融合摘要" }
        },
        {
          runId: "empty",
          label: "空结果",
          status: "completed",
          elapsedMs: 13,
          items: [],
          response: null
        }
      ],
      knowledgeRecallDebugTargetOptions: [{ value: "all" }, { value: "source-a" }],
      knowledgeSourceState: { summary: { totalCount: 3 } },
      knowledgeStatus: "offline",
      openAgentEvidencePreview,
      runKnowledgeRecallDebugBatch
    });

    const wrapper = mount(KnowledgeRecallDebugPanel, {
      global: { stubs: commonStubs() }
    });
    expect(wrapper.text()).toContain("KnowledgeCore 未启用");
    expect(wrapper.get(".primary-action").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("正在召回");
    expect(wrapper.text()).toContain("bad query");
    expect(wrapper.text()).toContain("融合摘要");
    expect(wrapper.text()).toContain("没有召回结果");
    await wrapper.findAll(".option-bar-stub")[0].trigger("click");
    await wrapper.findAll(".option-bar-stub")[1].trigger("click");
    await wrapper.findAll(".binary-checkbox-stub")[0].trigger("click");
    await wrapper.findAll(".binary-checkbox-stub")[1].trigger("click");
    await wrapper.findAll(".binary-checkbox-stub")[2].trigger("click");
    expect(form.value.targetId).toBe("source-a");
    expect(form.value.retrievalMode).toBe("keyword");
    expect(form.value.keywordOnly).toBe(true);
    expect(form.value.learningEnabled).toBe(false);
    expect(form.value.explain).toBe(true);
    await wrapper.find(".info-feed-result-row-stub").trigger("click");
    expect(openAgentEvidencePreview).toHaveBeenCalledWith({ title: "Evidence A", evidenceId: "ev-a" });

    form.value.query = "部署记录";
    await nextTick();
    await wrapper.get("form").trigger("submit");
    expect(runKnowledgeRecallDebugBatch).toHaveBeenCalled();

    debugContextMock.mockReturnValueOnce({
      busyKey: "",
      knowledgeConsole: { available: true },
      knowledgeRecallDebugForm: ref({ ...form.value, query: "合同" }),
      knowledgeRecallDebugGridStyle: { gridTemplateColumns: "repeat(1, 1fr)" },
      knowledgeRecallDebugModeOptionBarOptions: [{ value: "hybrid" }],
      knowledgeRecallDebugRuns: [],
      knowledgeRecallDebugTargetOptions: [{ value: "all" }],
      knowledgeSourceState: null,
      knowledgeStatus: "online",
      openAgentEvidencePreview,
      runKnowledgeRecallDebugBatch
    });
    const enabled = mount(KnowledgeRecallDebugPanel, {
      global: { stubs: commonStubs() }
    });
    expect(enabled.text()).toContain("KnowledgeCore 可用");
    expect(enabled.text()).toContain("online");
    expect(enabled.text()).toContain("目录 0");
    expect(enabled.get(".primary-action").attributes("disabled")).toBeUndefined();
    expect(enabled.get(".primary-action").text()).toBe("执行召回");
  });

  it("submits agent retrieval form and disables it for invalid selections", async () => {
    const runKnowledgeAgentExplore = vi.fn();
    const agentExploreForm = ref({
      query: "find evidence",
      modelAlias: "agent-a",
      contextProfileId: "default",
      thinkingMode: "medium",
      maxIterations: 2,
      limit: 5,
      temperature: 0.2,
      maxTokens: 1024,
      toolChoice: "auto"
    });
    retrievalContextMock.mockReturnValue({
      agentRetrievalForm: {
        agentExploreAgentOptions: [{ value: "agent-a" }],
        agentExploreForm,
        busyKey: "",
        contextWindowOptionBarOptions: [{ value: "default" }, { value: "large" }],
        highlightedConfigTarget: "agent-explore-agent",
        runKnowledgeAgentExplore,
        selectedAgentExploreModel: { enabled: true },
        thinkingModeOptionBarOptions: [{ value: "medium" }, { value: "high" }]
      }
    });

    const wrapper = mount(AgentRetrievalForm, {
      global: { stubs: commonStubs() }
    });
    expect(wrapper.get(".agent-model-option-bar-stub").attributes("data-config-highlighted")).toBe("true");
    await wrapper.get(".agent-model-option-bar-stub").trigger("click");
    await wrapper.findAll(".option-bar-stub")[0].trigger("click");
    await wrapper.findAll(".option-bar-stub")[1].trigger("click");
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("new query");
    await inputs[1].setValue("3");
    await inputs[2].setValue("7");
    await inputs[3].setValue("0.4");
    await inputs[4].setValue("2048");
    await inputs[5].setValue("required");
    expect(agentExploreForm.value).toMatchObject({
      query: "new query",
      modelAlias: "model-next",
      contextProfileId: "large",
      thinkingMode: "high",
      maxIterations: 3,
      limit: 7,
      temperature: 0.4,
      maxTokens: 2048,
      toolChoice: "required"
    });
    await wrapper.get("form").trigger("submit");
    expect(runKnowledgeAgentExplore).toHaveBeenCalled();

    retrievalContextMock.mockReturnValueOnce({
      agentRetrievalForm: {
        agentExploreAgentOptions: [],
        agentExploreForm: ref({ ...agentExploreForm.value, query: "   " }),
        busyKey: "knowledge:agent-explore",
        contextWindowOptionBarOptions: [],
        highlightedConfigTarget: "",
        runKnowledgeAgentExplore,
        selectedAgentExploreModel: { enabled: false },
        thinkingModeOptionBarOptions: []
      }
    });
    const disabled = mount(AgentRetrievalForm, {
      global: { stubs: commonStubs() }
    });
    expect(disabled.get(".primary-action").attributes("disabled")).toBeDefined();
    expect(disabled.text()).toContain("检索中");
  });

  it("covers add data source dialog local and client branches", async () => {
    const openLocalSourceDirectoryPicker = vi.fn();
    const syncLocalSourceLabelFromPath = vi.fn();
    sourcesContextMock.mockReturnValue({
      busyKey: "knowledge:sources:add",
      canBrowseServerPaths: false,
      canWriteJobs: false,
      localSourceForm: ref({
        label: "Docs",
        directoryPath: "/tmp/docs",
        autoSync: false,
        recursive: true,
        hydrationEnabled: false
      }),
      openLocalSourceDirectoryPicker,
      syncLocalSourceLabelFromPath
    });

    const local = mount(SourcesAddDataSourceDialog, {
      props: { open: true, selectedType: "localDirectory" as any },
      attachTo: document.body,
      global: { stubs: { ...commonStubs(), Teleport: true } }
    });
    await nextTick();
    expect(document.body.textContent).toContain("本地目录");
    expect(local.find('[data-testid="local-directory-config"]').exists()).toBe(true);
    await local.find(".source-path-field input").trigger("change");
    expect(syncLocalSourceLabelFromPath).toHaveBeenCalled();
    expect(local.find(".browse-select-stub").attributes("disabled")).toBeDefined();
    expect(local.find(".primary-action").attributes("disabled")).toBeDefined();
    await local.find(".dialog-close-button").trigger("click");
    expect(local.emitted("close")).toBeTruthy();

    sourcesContextMock.mockReturnValueOnce({
      busyKey: "",
      canBrowseServerPaths: true,
      canWriteJobs: true,
      localSourceForm: ref({
        label: "",
        directoryPath: "",
        autoSync: false,
        recursive: false,
        hydrationEnabled: false
      }),
      openLocalSourceDirectoryPicker,
      syncLocalSourceLabelFromPath
    });
    const client = mount(SourcesAddDataSourceDialog, {
      props: { open: true, selectedType: "client" as any },
      attachTo: document.body,
      global: { stubs: { ...commonStubs(), Teleport: true } }
    });
    await nextTick();
    expect(client.find('[data-testid="client-source-config"]').exists()).toBe(true);
    await client.find('[data-testid="data-source-type-select"]').setValue("localDirectory");
    await client.find("form").trigger("submit");
    expect(client.emitted("update:selectedType")?.[0]).toEqual(["localDirectory"]);
    expect(client.emitted("submit")).toBeTruthy();

    const enabledForm = ref({
      label: "Enabled Docs",
      directoryPath: "/tmp/enabled",
      autoSync: false,
      recursive: false,
      hydrationEnabled: false
    });
    sourcesContextMock.mockReturnValueOnce({
      busyKey: "",
      canBrowseServerPaths: true,
      canWriteJobs: true,
      localSourceForm: enabledForm,
      openLocalSourceDirectoryPicker,
      syncLocalSourceLabelFromPath
    });
    const enabledLocal = mount(SourcesAddDataSourceDialog, {
      props: { open: true, selectedType: "localDirectory" as any },
      attachTo: document.body,
      global: { stubs: { ...commonStubs(), Teleport: true } }
    });
    await enabledLocal.find(".data-source-dialog-backdrop").trigger("click");
    await enabledLocal.find('[data-testid="add-data-source-dialog"]').trigger("keydown", { key: "Escape" });
    expect(enabledLocal.emitted("close")?.length).toBeGreaterThanOrEqual(2);
    await enabledLocal.find(".source-name-field input").setValue("Enabled Local");
    await enabledLocal.find(".source-path-field input").setValue("/tmp/changed");
    await enabledLocal.find(".source-path-field input").trigger("change");
    await enabledLocal.find(".browse-select-stub").trigger("click");
    await enabledLocal.findAll(".binary-checkbox-stub")[0].trigger("click");
    await enabledLocal.findAll(".binary-checkbox-stub")[1].trigger("click");
    await enabledLocal.findAll(".binary-checkbox-stub")[2].trigger("click");
    expect(openLocalSourceDirectoryPicker).toHaveBeenCalled();
    expect(syncLocalSourceLabelFromPath.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(enabledForm.value).toMatchObject({
      label: "Enabled Local",
      directoryPath: "/tmp/changed",
      autoSync: true,
      recursive: true,
      hydrationEnabled: true
    });
    await enabledLocal.find(".tool-button-ghost").trigger("click");
    await enabledLocal.find("form").trigger("submit");
    expect(enabledLocal.emitted("close")?.length).toBeGreaterThanOrEqual(3);
    expect(enabledLocal.emitted("submit")).toBeTruthy();
  });
});
