// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: {
    buttonClass: String,
    buttonText: String,
    kind: String,
    multiple: Boolean,
  },
  emits: ["select"],
  setup(props, { emit, slots }) {
    return () =>
      h(
        "button",
        {
          class: ["browse-select-button-stub", props.buttonClass || ""],
          "data-kind": props.kind || "",
          "data-multiple": String(Boolean(props.multiple)),
          type: "button",
          onClick: () => emit("select", [new File(["attachment"], "attachment.txt", { type: "text/plain" })]),
        },
        [slots.default?.()],
      );
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    includeEmpty: Boolean,
    label: String,
    modelValue: String,
    options: {
      type: Array,
      default: () => [],
    },
    placeholder: String,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "agent-model-option-bar-stub", "data-label": props.label || "" }, [
        h("span", { class: "agent-model-option-bar-label" }, props.label || ""),
        h(
          "select",
          {
            class: "agent-model-option-bar-select",
            "data-placeholder": props.placeholder || "",
            "data-include-empty": String(Boolean(props.includeEmpty)),
            value: props.modelValue || "",
            onChange: (event: Event) =>
              emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          [
            ...(props.includeEmpty
              ? [h("option", { value: "" }, "未分配智能体")]
              : [h("option", { value: "", disabled: true }, props.placeholder || "未选择智能体")]),
            ...(props.options as Array<{ label?: string; value?: string }>).map((option) =>
              h("option", { value: String(option.value ?? option.label ?? "") }, String(option.label ?? "")),
            ),
          ],
        ),
      ]);
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    label: String,
    modelValue: [String, Number, Boolean],
    options: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "option-bar-stub", "data-label": props.label || "" }, [
        h("span", { class: "option-bar-stub-label" }, props.label || ""),
        h(
          "select",
          {
            class: "option-bar-stub-select",
            value: props.modelValue == null ? "" : String(props.modelValue),
            onChange: (event: Event) =>
              emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          (props.options as Array<{ label?: string; value?: string | number | boolean }>).map((option) =>
            h("option", { value: String(option.value) }, String(option.label ?? "")),
          ),
        ),
      ]);
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: String,
    open: Boolean,
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub", "data-open": String(Boolean(props.open)) }, [
        h("h4", { class: "config-fold-card-title" }, props.title || ""),
        slots.default?.(),
      ]);
  },
});

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    agentSelectorOptions: ref([
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4-mini", value: "gpt-5.4-mini" },
    ]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([
      { label: "32k", value: "32k" },
      { label: "64k", value: "64k" },
    ]),
    handleInfoFeedAttachmentFiles: vi.fn(),
    infoFeedAttachments: ref([
      {
        id: "att-running",
        name: "draft.txt",
        status: "running",
      },
      {
        id: "att-complete",
        name: "summary.md",
        status: "completed",
      },
    ]),
    infoFeedCurrentRun: ref(null),
    infoFeedForm: ref({
      contextProfileId: "32k",
      maxTokens: 4096,
      modelAlias: "",
      query: "",
      temperature: 0.2,
    }),
    infoFeedInputPlaceholder: ref("输入问题，信息流会并行对比原文检索和智能规划。"),
    infoFeedModelOptions: ref([
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4-mini", value: "gpt-5.4-mini" },
    ]),
    infoFeedSubmitLabel: ref("开始信息流"),
    removeInfoFeedAttachment: vi.fn(),
    runInfoFeed: vi.fn(),
    saveSettings: vi.fn(),
    selectedInfoFeedModel: ref({ enabled: true, label: "GPT-5.4" }),
    settingsDraft: ref({
      agentExploreDefaults: {
        answerTemplate: "默认答案模板",
        contextProfileId: "32k",
        continuationPrompt: "继续",
        limit: 5,
        maxIterations: 3,
        maxTokens: 4096,
        reviewFusionMaxTokens: 1024,
        reviewFusionModelAlias: "",
        reviewFusionSystemPrompt: "融合提示词",
        reviewFusionTemperature: 0.1,
        systemPrompt: "系统提示词",
        temperature: 0.2,
        thinkingMode: "balanced",
        toolChoice: "auto",
        toolPolicyPrompt: "工具策略提示词",
      },
    }),
    thinkingModeOptionBarOptions: ref([
      { label: "Balanced", value: "balanced" },
      { label: "Deep", value: "deep" },
    ]),
    ...overrides,
  };
}

function mountPanel() {
  return mount(InfoFeedComposerPanel, {
    global: {
      stubs: {
        AgentModelOptionBar: AgentModelOptionBarStub,
        BrowseSelectButton: BrowseSelectButtonStub,
        ConfigFoldCard: ConfigFoldCardStub,
        OptionBar: OptionBarStub,
      },
    },
  });
}

function getLabeledControl(root: any, labelText: string, selector: string) {
  const label = root.findAll("label").find((entry: any) => entry.text().includes(labelText));
  expect(label, `expected control label containing ${labelText}`).toBeDefined();
  return label!.get(selector);
}

beforeEach(() => {
  feedContextMock.current = makeContext();
  vi.clearAllMocks();
});

describe("InfoFeedComposerPanel extra coverage", () => {
  it("binds query input, attachment chips, model picker, and attachment actions", async () => {
    const context = makeContext({
      infoFeedAttachments: ref([
        { id: "att-a", name: "draft.txt", status: "running" },
        { id: "att-b", name: "summary.md", status: "completed" },
      ]),
      infoFeedForm: ref({
        contextProfileId: "32k",
        maxTokens: 4096,
        modelAlias: "",
        query: "初始问题",
        temperature: 0.2,
      }),
    });
    feedContextMock.current = context;

    const wrapper = mountPanel();

    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("placeholder")).toBe("输入问题，信息流会并行对比原文检索和智能规划。");
    expect(textarea.element.value).toBe("初始问题");
    expect(wrapper.findAll(".info-feed-attachment-chip")).toHaveLength(2);
    expect(wrapper.text()).toContain("draft.txt");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("summary.md");
    expect(wrapper.text()).toContain("完成");

    await textarea.setValue("更新后的问题");
    expect((context.infoFeedForm as { value: { query: string } }).value.query).toBe("更新后的问题");

    const select = wrapper.get(".agent-model-option-bar-stub select");
    expect(select.attributes("data-placeholder")).toBe("未分配智能体");

    await select.setValue("gpt-5.4-mini");
    expect((context.infoFeedForm as { value: { modelAlias: string } }).value.modelAlias).toBe("gpt-5.4-mini");

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect(context.handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);
    expect(context.handleInfoFeedAttachmentFiles).toHaveBeenCalledWith(expect.any(Array));

    await wrapper.get(".info-feed-attachment-chip button").trigger("click");
    expect(context.removeInfoFeedAttachment).toHaveBeenCalledTimes(1);
    expect(context.removeInfoFeedAttachment).toHaveBeenCalledWith("att-a");
  });

  it("shows follow-up copy for continued runs and disables submit when the model or run blocks it", async () => {
    const context = makeContext({
      infoFeedCurrentRun: ref({
        summary: {
          answer: "已有结果",
          status: "completed",
        },
      }),
      infoFeedForm: ref({
        contextProfileId: "32k",
        maxTokens: 4096,
        modelAlias: "",
        query: "继续追问",
        temperature: 0.2,
      }),
      infoFeedInputPlaceholder: ref("继续追问当前信息流结果。"),
      infoFeedSubmitLabel: ref("追问"),
    });
    feedContextMock.current = context;

    const wrapper = mountPanel();
    const submit = wrapper.get("button.primary-action");

    expect(wrapper.get("textarea").attributes("placeholder")).toBe("继续追问当前信息流结果。");
    expect(submit.text()).toBe("追问");
    expect(submit.attributes("disabled")).toBeUndefined();

    (context.selectedInfoFeedModel as { value: { enabled: boolean } }).value.enabled = false;
    await nextTick();
    expect(submit.attributes("disabled")).toBeDefined();

    (context.selectedInfoFeedModel as { value: { enabled: boolean } }).value.enabled = true;
    (context.infoFeedCurrentRun as { value: { summary: { status: string } } }).value.summary.status = "running";
    await nextTick();
    expect(submit.attributes("disabled")).toBeDefined();
  });

  it("opens advanced options, wires nested settings controls, and reflects busy save state", async () => {
    const context = makeContext({
      busyKey: ref(""),
    });
    feedContextMock.current = context;

    const wrapper = mountPanel();

    await wrapper.get("button.info-feed-advanced-button").trigger("click");
    expect(wrapper.text()).toContain("高级选项");
    expect(wrapper.text()).toContain("系统提示词");
    expect(wrapper.text()).toContain("知识融合智能体");
    expect(wrapper.find(".config-fold-card-stub").attributes("data-open")).toBe("true");

    const advancedAgentSelect = wrapper.findAll(".agent-model-option-bar-stub select").at(1);
    expect(advancedAgentSelect?.attributes("data-include-empty")).toBe("true");
    expect(advancedAgentSelect?.attributes("data-placeholder")).toBe("未分配智能体");

    await wrapper.get('textarea[spellcheck="false"]').setValue("新的系统提示词");
    await wrapper.get('input[type="number"]').setValue("0.7");
    expect(
      (context.settingsDraft as { value: { agentExploreDefaults: { systemPrompt: string; temperature: number } } })
        .value.agentExploreDefaults.systemPrompt,
    ).toBe("新的系统提示词");
    expect(
      (context.settingsDraft as { value: { agentExploreDefaults: { systemPrompt: string; temperature: number } } })
        .value.agentExploreDefaults.temperature,
    ).toBe(0.7);

    await wrapper.get(".info-feed-advanced-form").trigger("submit");
    expect(context.saveSettings).toHaveBeenCalledTimes(1);

    (context.busyKey as { value: string }).value = "settings";
    await nextTick();
    const saveButton = wrapper.get(".source-actions button");
    expect(saveButton.text()).toBe("保存中");
    expect(saveButton.attributes("disabled")).toBeDefined();
  });

  it("covers the remaining advanced option fields and save button states", async () => {
    const context = makeContext({
      busyKey: ref(""),
    });
    feedContextMock.current = context;

    const wrapper = mountPanel();

    await wrapper.get("button.info-feed-advanced-button").trigger("click");
    const advancedForm = wrapper.get(".info-feed-advanced-form");

    await getLabeledControl(advancedForm, "工具策略提示词", "textarea").setValue("新的工具策略");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { toolPolicyPrompt: string } } }).value.agentExploreDefaults.toolPolicyPrompt).toBe("新的工具策略");

    await getLabeledControl(advancedForm, "继续轮次提示词", "textarea").setValue("继续追问");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { continuationPrompt: string } } }).value.agentExploreDefaults.continuationPrompt).toBe("继续追问");

    await getLabeledControl(advancedForm, "答案模板", "textarea").setValue("答案模板 v2");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { answerTemplate: string } } }).value.agentExploreDefaults.answerTemplate).toBe("答案模板 v2");

    await getLabeledControl(advancedForm, "上下文窗口", "select").setValue("64k");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { contextProfileId: string } } }).value.agentExploreDefaults.contextProfileId).toBe("64k");

    await getLabeledControl(advancedForm, "Thinking", "select").setValue("deep");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { thinkingMode: string } } }).value.agentExploreDefaults.thinkingMode).toBe("deep");

    await getLabeledControl(advancedForm, "temperature", "input").setValue("0.6");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { temperature: number } } }).value.agentExploreDefaults.temperature).toBe(0.6);

    await getLabeledControl(advancedForm, "max_tokens", "input").setValue("8192");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { maxTokens: number } } }).value.agentExploreDefaults.maxTokens).toBe(8192);

    await getLabeledControl(advancedForm, "默认循环轮数", "input").setValue("6");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { maxIterations: number } } }).value.agentExploreDefaults.maxIterations).toBe(6);

    await getLabeledControl(advancedForm, "默认每次召回", "input").setValue("12");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { limit: number } } }).value.agentExploreDefaults.limit).toBe(12);

    await getLabeledControl(advancedForm, "tool_choice", "input").setValue("required");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { toolChoice: string } } }).value.agentExploreDefaults.toolChoice).toBe("required");

    const reviewFusionSelect = advancedForm.get(".agent-model-option-bar-select");
    await reviewFusionSelect.setValue("gpt-5.4-mini");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { reviewFusionModelAlias: string } } }).value.agentExploreDefaults.reviewFusionModelAlias).toBe("gpt-5.4-mini");

    const reviewFusionCard = advancedForm.get(".config-fold-card-stub");

    await getLabeledControl(reviewFusionCard, "temperature", "input").setValue("0.3");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { reviewFusionTemperature: number } } }).value.agentExploreDefaults.reviewFusionTemperature).toBe(0.3);

    await getLabeledControl(reviewFusionCard, "max_tokens", "input").setValue("2048");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { reviewFusionMaxTokens: number } } }).value.agentExploreDefaults.reviewFusionMaxTokens).toBe(2048);

    await getLabeledControl(advancedForm, "融合提示词", "textarea").setValue("新的融合提示词");
    expect((context.settingsDraft as { value: { agentExploreDefaults: { reviewFusionSystemPrompt: string } } }).value.agentExploreDefaults.reviewFusionSystemPrompt).toBe("新的融合提示词");

    await advancedForm.trigger("submit");
    expect(context.saveSettings).toHaveBeenCalledTimes(1);

    (context.busyKey as { value: string }).value = "settings";
    await nextTick();
    const saveButton = wrapper.get(".source-actions button");
    expect(saveButton.text()).toBe("保存中");
    expect(saveButton.attributes("disabled")).toBeDefined();
  });
});
