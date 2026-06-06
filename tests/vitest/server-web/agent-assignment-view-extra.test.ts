// @vitest-environment jsdom
import { h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentAssignmentView from "../../../server-web/views/admin/AgentAssignmentView.vue";

const routeState: { query: Record<string, string | string[]> } = {
  query: {},
};
const BATCH_PLACEHOLDER_VALUE = "__pact_agent_assignment_batch_placeholder__";
let activeController: Record<string, unknown> | null = null;

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => activeController),
}));

vi.mock("vue-router", () => ({
  useRoute: vi.fn(() => routeState),
}));

const OptionBarMock = {
  name: "OptionBar",
  props: ["modelValue", "options", "disabled"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    const normalizedOptions = (props.options as Array<{ value: unknown; label?: string; disabled?: boolean }> | undefined) || [];
    return () =>
      h("select", {
        class: "mock-option-select",
        disabled: !!props.disabled,
        value: Array.isArray(props.modelValue) ? String(props.modelValue[0] || "") : String(props.modelValue || ""),
        onChange: (event: Event) => {
          const selectedValue = String((event.target as HTMLSelectElement).value || "");
          context.emit("update:model-value", selectedValue);
          context.emit("update:modelValue", selectedValue);
          context.emit("change", selectedValue);
        },
      }, normalizedOptions.map((option) => h("option", {
        value: String(option.value),
        disabled: !!option.disabled,
      }, String(option.label || option.value || ""))));
  },
};

const AgentModelOptionBarMock = {
  name: "AgentModelOptionBar",
  props: ["modelValue", "options", "includeEmpty", "emptyLabel"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    const normalizedOptions = (props.options as Array<{ value: unknown; label?: string; enabled?: boolean; disabled?: boolean }> | undefined) || [];
    const options = [
      ...(props.includeEmpty ? [h("option", { value: "" }, String(props.emptyLabel || "未分配"))] : []),
      ...normalizedOptions.map((option) =>
        h("option", {
          value: String(option.value),
          disabled: option.enabled === false || option.disabled === true,
        }, String(option.label || option.value || "")),
      ),
    ];
    return () =>
      h("select", {
        class: "mock-agent-model-option-select",
        value: String(props.modelValue || ""),
        onChange: (event: Event) => {
          const selectedValue = String((event.target as HTMLSelectElement).value || "");
          context.emit("update:model-value", selectedValue);
          context.emit("update:modelValue", selectedValue);
          context.emit("change", selectedValue);
        },
      }, options);
  },
};

const BinaryCheckboxMock = {
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    return () =>
      h("button", {
        type: "button",
        class: "mock-binary-checkbox",
        disabled: !!props.disabled,
        onClick: () => {
          if (props.disabled) {
            return;
          }
          const nextValue = !Boolean(props.modelValue);
          context.emit("update:model-value", nextValue);
          context.emit("update:modelValue", nextValue);
          context.emit("change", nextValue);
        },
      }, String(props.label || ""));
  },
};

const StatusPillMock = {
  name: "StatusPill",
  props: ["label", "tone"],
  setup(props: Record<string, unknown>) {
    return () => h("span", {
      class: "mock-status-pill",
      "data-tone": String(props.tone || ""),
    }, String(props.label || ""));
  },
};

type ModuleDefinition = {
  id: string;
  label: string;
  description: string;
  alertRequired?: boolean;
  designedModule?: string;
};

type AgentAssignmentContextOverrides = {
  busyKey?: "" | "settings" | string;
  intelligentModuleDefinitions?: ModuleDefinition[];
  moduleModelRefs?: Record<string, string>;
  moduleNeeds?: Record<string, boolean>;
  moduleModelAssignmentStats?: {
    assigned: number;
    enabled: number;
  };
  runModelEntryProbe?: ReturnType<typeof vi.fn>;
  saveSettings?: ReturnType<typeof vi.fn>;
  moduleAssignmentOptionsById?: Record<string, Array<{ value: string; label: string; enabled?: boolean }>>;
  businessDefaults?: {
    infoFeedSummaryModelAlias?: string;
    agentRetrievalModelAlias?: string;
    ruleAuthoringModelAlias?: string;
    reviewFusionModelAlias?: string;
  };
  routeTarget?: string;
  attachToBody?: boolean;
};

function createController(overrides: AgentAssignmentContextOverrides = {}) {
  const moduleDefinitions: ModuleDefinition[] = overrides.intelligentModuleDefinitions || [
    {
      id: "module-fusion",
      label: "知识融合模块",
      description: "为规则融合流程提供主模型。",
      designedModule: "knowledge-fusion",
    },
    {
      id: "module-report",
      label: "报告生成模块",
      description: "为生成摘要报告提供默认模型。",
      alertRequired: false,
      designedModule: "report-generation",
    },
  ];
  const defaultBusinessDefaults = {
    infoFeedSummaryModelAlias: "model-alpha",
    agentRetrievalModelAlias: "model-alpha",
    ruleAuthoringModelAlias: "model-beta",
    reviewFusionModelAlias: "review-disabled",
  };
  const businessDefaults = {
    ...defaultBusinessDefaults,
    ...overrides.businessDefaults,
  };
  const moduleModelRefs = ref<Record<string, string>>(
    moduleDefinitions.reduce<Record<string, string>>((acc, definition, index) => {
      const defaultValue = index === 0 ? "model-alpha" : "model-beta";
      acc[definition.id] = overrides.moduleModelRefs?.[definition.id] ?? defaultValue;
      return acc;
    }, {}),
  );
  const moduleNeedsRef = ref<Record<string, boolean>>(
    moduleDefinitions.reduce<Record<string, boolean>>((acc, definition) => {
      acc[definition.id] = overrides.moduleNeeds?.[definition.id] ?? true;
      return acc;
    }, {}),
  );
  const moduleAssignmentOptionsById: Record<string, Array<{ value: string; label: string; enabled?: boolean }>> = {
    "module-fusion": [
      { value: "model-alpha", label: "模型 Alpha", enabled: true },
      { value: "model-disabled", label: "模型 Disabled", enabled: false },
    ],
    "module-report": [
      { value: "model-beta", label: "模型 Beta", enabled: true },
      { value: "model-disabled", label: "模型 Disabled", enabled: false },
    ],
    ...overrides.moduleAssignmentOptionsById,
  };
  const configuredAssignments = {
    assigned: overrides.moduleModelAssignmentStats
      ? overrides.moduleModelAssignmentStats.assigned
      : Object.values(moduleModelRefs.value).filter(Boolean).length,
    enabled: overrides.moduleModelAssignmentStats
      ? overrides.moduleModelAssignmentStats.enabled
      : Object.values(moduleNeedsRef.value).filter(Boolean).length,
  };
  const parseModelRef = vi.fn((value: string) => {
    const normalized = String(value || "").trim();
    const index = normalized.indexOf(":");
    if (index < 0) {
      return { provider: "", model: "" };
    }
    const provider = normalized.slice(0, index).trim();
    const model = normalized.slice(index + 1).trim();
    return {
      provider,
      model,
    };
  });

  const modelEntryStatusKey = vi.fn((entry: { alias: string }) => String(entry.alias || ""));
  const visibleModelEntries = ref([
    {
      uid: "uid-alpha",
      instanceId: "inst-alpha",
      provider: "openai",
      alias: "model-alpha",
      label: "模型 Alpha",
      model: "alpha-model",
    },
    {
      uid: "uid-beta",
      instanceId: "inst-beta",
      provider: "openai",
      alias: "model-beta",
      label: "模型 Beta",
      model: "beta-model",
    },
    {
      uid: "uid-review",
      instanceId: "inst-review",
      provider: "openai",
      alias: "review-disabled",
      label: "审核模型",
      model: "review-model",
    },
    {
      uid: "uid-parse",
      instanceId: "inst-parse",
      provider: "parse-provider",
      alias: "parse-alias",
      label: "解析模型",
      model: "parse-model",
    },
  ]);

  const runModelEntryProbe =
    overrides.runModelEntryProbe ??
    vi.fn(async () => ({
      ok: true,
      configured: true,
      provider: "openai",
      model: "stable",
      statusCode: 200,
      latencyMs: 10,
      checkedAt: "2026-06-04T00:00:00.000Z",
      message: "",
    }));

  const context: Record<string, unknown> = {
    agentExploreAgentOptions: ref([
      { value: "model-alpha", label: "模型 Alpha", enabled: true },
      { value: "model-beta", label: "模型 Beta", enabled: true },
    ]),
    agentExploreForm: ref({ modelAlias: businessDefaults.agentRetrievalModelAlias }),
    agentSelectorOptions: ref([
      { value: "review-disabled", label: "审核模型（禁用）", enabled: false },
      { value: "model-beta", label: "模型 Beta", enabled: true },
    ]),
    busyKey: ref(overrides.busyKey || ""),
    error: ref(""),
    highlightedConfigTarget: ref(""),
    infoFeedForm: ref({ modelAlias: businessDefaults.infoFeedSummaryModelAlias }),
    infoFeedModelOptions: ref([
      { value: "model-alpha", label: "模型 Alpha", enabled: true },
      { value: "model-beta", label: "模型 Beta", enabled: true },
      { value: "", label: "清空", enabled: true },
    ]),
    intelligentModuleDefinitions: moduleDefinitions,
    modelEntryStatusKey,
    moduleModelAssignmentSelectOptions: vi.fn((moduleId: string) =>
      moduleAssignmentOptionsById[moduleId] || [
        { value: "model-alpha", label: "模型 Alpha", enabled: true },
      ],
    ),
    moduleModelAssignmentStats: configuredAssignments,
    moduleModelRef: vi.fn((moduleId: string) => moduleModelRefs.value[moduleId] || ""),
    moduleNeedsIntelligence: vi.fn((moduleId: string) => Boolean(moduleNeedsRef.value[moduleId])),
    parseModelRef,
    ruleAuthoringForm: ref({ modelAlias: businessDefaults.ruleAuthoringModelAlias }),
    ruleAuthoringModelOptions: ref([
      { value: "model-beta", label: "模型 Beta", enabled: true },
      { value: "model-alpha", label: "模型 Alpha", enabled: true },
    ]),
    runModelEntryProbe,
    saveSettings: overrides.saveSettings ?? vi.fn(async () => {}),
    setModuleModelRef: vi.fn((moduleId: string, value: string) => {
      moduleModelRefs.value[moduleId] = String(value || "");
    }),
    setModuleNeedsIntelligence: vi.fn((moduleId: string, enabled: boolean) => {
      moduleNeedsRef.value[moduleId] = Boolean(enabled);
    }),
    settingsDraft: ref({
      agentExploreDefaults: {
        infoFeedSummaryModelAlias: businessDefaults.infoFeedSummaryModelAlias,
        agentRetrievalModelAlias: businessDefaults.agentRetrievalModelAlias,
        ruleAuthoringModelAlias: businessDefaults.ruleAuthoringModelAlias,
        reviewFusionModelAlias: businessDefaults.reviewFusionModelAlias,
      },
    }),
    visibleModelEntries,
  };

  if (overrides.routeTarget) {
    routeState.query = {
      configTarget: overrides.routeTarget,
    };
  } else {
    routeState.query = {};
  }

  return context;
}

function mountAgentAssignmentView(overrides: AgentAssignmentContextOverrides = {}) {
  activeController = createController(overrides);
  const wrapper = mount(AgentAssignmentView, {
    ...(overrides.attachToBody ? { attachTo: document.body } : {}),
    global: {
      stubs: {
        AgentModelOptionBar: AgentModelOptionBarMock,
        BinaryCheckbox: BinaryCheckboxMock,
        OptionBar: OptionBarMock,
        StatusPill: StatusPillMock,
      },
    },
  });
  return {
    wrapper,
    context: activeController as Record<string, unknown>,
  };
}

function findRowByTitle(wrapper: ReturnType<typeof mount extends infer T ? T : never>, title: string) {
  return wrapper.findAll("section.agent-assignment-row").find((row) => row.find("h4").text() === title);
}

function findByRoleAndLabel(wrapper: ReturnType<typeof mount extends infer T ? T : never>, title: string) {
  const row = findRowByTitle(wrapper, title);
  return {
    row,
    statusPill: row?.find(".mock-status-pill"),
    optionSelect: row?.find("select"),
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  routeState.query = {};
});

afterEach(() => {
  activeController = null;
  vi.clearAllMocks();
});

describe("AgentAssignmentView", () => {
  it("renders business and module summaries, plus option status labels", () => {
    const { wrapper } = mountAgentAssignmentView();

    expect(wrapper.text()).toContain("4 / 4 业务功能");
    expect(wrapper.text()).toContain("2 / 2 模块");
    expect(wrapper.text()).toContain("知识融合模块");
    expect(wrapper.text()).toContain("报告生成模块");
    expect(wrapper.text()).toContain("建议分配");
    expect(wrapper.text()).toContain("可选");

    const reviewRow = findByRoleAndLabel(wrapper, "知识融合智能体");
    expect(reviewRow.statusPill?.text()).toBe("不可用");
  });

  it("shows loading state on save buttons while global busy key is saving", () => {
    const { wrapper } = mountAgentAssignmentView({ busyKey: "settings" });
    const saveButtons = wrapper.findAll("button.agent-assignment-save-button");
    expect(saveButtons).toHaveLength(2);
    expect(saveButtons[0].attributes("disabled")).toBeDefined();
    expect(saveButtons[1].attributes("disabled")).toBeDefined();
    expect(saveButtons[0].text()).toBe("保存中");
    expect(saveButtons[1].text()).toBe("保存中");
  });

  it("highlights the route target module row then auto-clears after timeout", async () => {
    vi.useFakeTimers();
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const scrollSpy = vi.fn(() => {});
    const originalScrollIntoView = (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });

    try {
    const { wrapper } = mountAgentAssignmentView({
      routeTarget: "module-agent-module-fusion",
      attachToBody: true,
    });

      const row = wrapper.find("[data-config-target='module-agent-module-fusion']");
      expect(row.exists()).toBe(true);
      await nextTick();
      await nextTick();
      expect(row.attributes("data-config-highlighted")).toBe("true");
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4000);
      await nextTick();
      expect(row.attributes("data-config-highlighted")).toBe("false");
    } finally {
      requestAnimationFrameSpy.mockRestore();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      }
      vi.useRealTimers();
    }
  });

  it("supports individual and batch business assignment selection", async () => {
    const { wrapper, context } = mountAgentAssignmentView();
    const businessRow = findByRoleAndLabel(wrapper, "知识检索智能体");
    await businessRow.optionSelect?.setValue("model-beta");
    await nextTick();
    expect((context.infoFeedForm as { value: { modelAlias: string } }).value.modelAlias).toBe("model-alpha");
    expect((context.agentExploreForm as { value: { modelAlias: string } }).value.modelAlias).toBe("model-beta");

    const businessBatchRow = wrapper.findAll("section.agent-assignment-batch-row")[0];
    const batchSelect = businessBatchRow.find("select.mock-option-select");
    await batchSelect.setValue(BATCH_PLACEHOLDER_VALUE);
    await batchSelect.setValue("model-beta");
    await nextTick();
    expect((context.infoFeedForm as { value: { modelAlias: string } }).value.modelAlias).toBe("model-beta");
    expect((context.agentExploreForm as { value: { modelAlias: string } }).value.modelAlias).toBe("model-beta");
    expect((context.ruleAuthoringForm as { value: { modelAlias: string } }).value.modelAlias).toBe("model-beta");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { reviewFusionModelAlias: string } } }).value.agentExploreDefaults.reviewFusionModelAlias).toBe("model-beta");
  });

  it("supports module enabling and keeps disabled assignment controls disabled", async () => {
    const { wrapper, context } = mountAgentAssignmentView({
      moduleNeeds: {
        "module-fusion": true,
        "module-report": false,
      },
    });

    const disabledModuleRow = findByRoleAndLabel(wrapper, "报告生成模块");
    expect(disabledModuleRow.statusPill?.text()).toBe("已关闭");
    expect(disabledModuleRow.optionSelect?.attributes("disabled")).toBeDefined();

    await disabledModuleRow.optionSelect?.setValue("model-beta");
    expect(context.setModuleModelRef).not.toHaveBeenCalled();

    const recommendModuleRow = findByRoleAndLabel(wrapper, "知识融合模块");
    const enabledSwitch = recommendModuleRow.row?.find(".mock-binary-checkbox");
    await enabledSwitch?.trigger("click");
    expect(context.setModuleNeedsIntelligence).toHaveBeenCalledWith("module-fusion", false);
    expect(context.setModuleModelRef).toHaveBeenCalledWith("module-fusion", "");
  });

  it("applies module batch assignment and updates enabled module model", async () => {
    const { wrapper, context } = mountAgentAssignmentView({
      moduleAssignmentOptionsById: {
        "module-fusion": [
          { value: "model-common", label: "统一模型", enabled: true },
          { value: "model-alpha", label: "模型 Alpha", enabled: true },
        ],
        "module-report": [
          { value: "model-common", label: "统一模型", enabled: true },
          { value: "model-beta", label: "模型 Beta", enabled: true },
        ],
      },
    });

    const moduleRows = wrapper.findAll("section.agent-assignment-batch-row");
    expect(moduleRows).toHaveLength(2);
    const moduleBatchRow = moduleRows[1];
    const moduleBatchSelect = moduleBatchRow.find("select.mock-option-select");
    await moduleBatchSelect.setValue(BATCH_PLACEHOLDER_VALUE);
    await moduleBatchSelect.setValue("model-common");
    await nextTick();
    expect(context.setModuleModelRef).toHaveBeenCalledWith("module-fusion", "model-common");
    expect(context.setModuleModelRef).toHaveBeenCalledWith("module-report", "model-common");

    (context.setModuleModelRef as vi.Mock).mockClear();
    const moduleRow = findByRoleAndLabel(wrapper, "知识融合模块");
    await moduleRow.optionSelect?.setValue("model-alpha");
    expect(context.setModuleModelRef).toHaveBeenCalledWith("module-fusion", "model-alpha");
    const moduleModelSelect = moduleRow.optionSelect?.element as HTMLSelectElement | undefined;
    expect(moduleModelSelect?.disabled).toBe(false);
  });

  it("skips disabled modules when building module probe targets", async () => {
    const runModelEntryProbe = vi.fn(async () => ({
      ok: true,
      configured: true,
      provider: "openai",
      model: "stable",
      statusCode: 200,
      latencyMs: 12,
      checkedAt: "2026-06-04T00:00:00.000Z",
      message: "",
    }));
    const { wrapper, context } = mountAgentAssignmentView({
      moduleNeeds: {
        "module-fusion": false,
        "module-report": true,
      },
      moduleModelRefs: {
        "module-fusion": "model-alpha",
        "module-report": "model-beta",
      },
      runModelEntryProbe,
    });

    const moduleSaveButton = wrapper.findAll("button.agent-assignment-save-button")[1];
    await moduleSaveButton.trigger("click");
    await flushPromises();
    await nextTick();

    expect(runModelEntryProbe).toHaveBeenCalledTimes(1);
    expect(runModelEntryProbe).toHaveBeenCalledWith(expect.objectContaining({ alias: "model-beta" }));
    expect(context.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("shows business probe alert and blocks save when model config is missing", async () => {
    const { wrapper, context } = mountAgentAssignmentView({
      businessDefaults: {
        infoFeedSummaryModelAlias: "openai:missing",
        agentRetrievalModelAlias: "",
        ruleAuthoringModelAlias: "openai:missing",
        reviewFusionModelAlias: "openai:missing",
      },
    });

    const saveButton = wrapper.findAll("button.agent-assignment-save-button")[0];
    await saveButton.trigger("click");
    await flushPromises();
    await nextTick();

    expect(context.runModelEntryProbe).not.toHaveBeenCalled();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.findAll("li")).toHaveLength(1);
    expect(alert.text()).toContain("连通性检测失败，未保存");
    expect(alert.text()).toContain("未找到对应的大模型配置。");
    expect(alert.text()).toContain("用于：");
  });

  it("runs probe before saving business assignments and saves only when probes succeed", async () => {
    const runModelEntryProbe = vi.fn(async (entry: any) => {
      return {
        ok: true,
        configured: true,
        provider: entry.provider,
        model: entry.model,
        statusCode: 200,
        latencyMs: 5,
        checkedAt: "2026-06-04T00:00:00.000Z",
        message: "",
      };
    });
    const { wrapper, context } = mountAgentAssignmentView({ runModelEntryProbe });
    const saveButton = wrapper.findAll("button.agent-assignment-save-button")[0];

    await saveButton.trigger("click");
    expect(saveButton.text()).toBe("检测中");
    await flushPromises();
    await nextTick();

    expect(context.runModelEntryProbe).toHaveBeenCalledTimes(3);
    expect((context.saveSettings as any)).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(saveButton.text()).toBe("保存");
    expect(saveButton.attributes("disabled")).toBeUndefined();
  });

  it("shows probe failure alert for module save and blocks save when probe fails", async () => {
    const runModelEntryProbe = vi.fn(async (entry: any) => {
      if (entry.alias === "model-beta") {
        return {
          ok: false,
          configured: true,
          provider: entry.provider,
          model: entry.model,
          statusCode: 500,
          latencyMs: 5,
          checkedAt: "2026-06-04T00:00:00.000Z",
          message: "模型不可达",
        };
      }
      return {
        ok: true,
        configured: true,
        provider: entry.provider,
        model: entry.model,
        statusCode: 200,
        latencyMs: 5,
        checkedAt: "2026-06-04T00:00:00.000Z",
        message: "",
      };
    });
    const { wrapper, context } = mountAgentAssignmentView({
      runModelEntryProbe,
      moduleModelRefs: {
        "module-fusion": "model-alpha",
        "module-report": "model-beta",
      },
    });
    const saveButton = wrapper.findAll("button.agent-assignment-save-button")[1];

    await saveButton.trigger("click");
    expect(saveButton.text()).toBe("检测中");
    await flushPromises();
    await nextTick();

    expect(context.runModelEntryProbe).toHaveBeenCalledTimes(2);
    expect((context.saveSettings as any)).not.toHaveBeenCalled();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("连通性检测失败，未保存");
    expect(alert.text()).toContain("模型不可达");
    expect(alert.text()).toContain("报告生成模块");
  });

  it("renders empty module block when no modules are configured", () => {
    const { wrapper } = mountAgentAssignmentView({
      intelligentModuleDefinitions: [],
      moduleModelAssignmentStats: {
        assigned: 0,
        enabled: 0,
      },
      moduleModelRefs: {},
      moduleNeeds: {},
    });

    expect(wrapper.findAll("section.module-assignment-row")).toHaveLength(0);
    expect(wrapper.text()).toContain("0 / 0 模块");
  });
});
