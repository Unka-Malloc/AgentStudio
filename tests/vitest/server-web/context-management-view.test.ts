// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContextManagementView from "../../../server-web/views/admin/ContextManagementView.vue";

type ContextProfileRow = {
  profileId: string;
  label: string;
  contextWindowTokens: number;
  knowledgeBudget: number;
  historyBudget: number;
  expertGuidanceRatio: number;
  compressionMode: string;
  strategy: string;
  protectedEvidenceFields?: Array<string | number>;
  modelCompressionAlias?: string;
  modelCompressionEnabled: boolean;
};

type ContextBuildRecordRow = {
  recordId: string;
  createdAt: string;
  profileId: string;
  totalTokens: number;
  sourceTokens: number;
  triggerReason: string;
  compressionMode: string;
  preservedEvidenceIds: Array<string | number>;
  droppedKnowledgeCount: number;
  humanExpertGuidanceCount: number;
};

type MockContextState = {
  busyKey: Ref<string>;
  contextBuildRecordRows: Ref<ContextBuildRecordRow[]>;
  contextEvaluationResult: Ref<Record<string, unknown> | null>;
  contextPreviewRequiredEvidence: Ref<string>;
  contextPreviewResult: Ref<Record<string, unknown> | null>;
  contextPreviewTask: Ref<string>;
  contextProfileRows: Ref<ContextProfileRow[]>;
  exportContextBuildRecords: ReturnType<typeof vi.fn>;
  highlightedConfigTarget: Ref<string>;
  previewContextCompiler: ReturnType<typeof vi.fn>;
  runContextReplayEvaluation: ReturnType<typeof vi.fn>;
};

const saveContextProfilesMock = vi.hoisted(() => vi.fn());

let activeContext: MockContextState | null = null;

const ConfigFoldCardMock = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: { type: String },
    open: { type: Boolean, default: false },
    dataConfigTarget: { type: String, default: "" },
    dataConfigHighlighted: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () =>
      h("section", {
        class: "mock-config-fold-card",
        "data-title": String(props.title || ""),
        "data-open": String(Boolean(props.open)),
        "data-config-target": String(props.dataConfigTarget || ""),
        "data-config-highlighted": String(Boolean(props.dataConfigHighlighted)),
      }, slots.default?.());
  },
});

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => activeContext),
}));

vi.mock("../../../server-web/lib/context-compiler-client", () => ({
  saveContextProfiles: (...args: unknown[]) => saveContextProfilesMock(...args),
}));

const mounted: VueWrapper[] = [];

function makeContext(overrides: Partial<MockContextState> = {}): MockContextState {
  const context: MockContextState = {
    busyKey: ref(""),
    contextBuildRecordRows: ref<ContextBuildRecordRow[]>([]),
    contextEvaluationResult: ref(null),
    contextPreviewRequiredEvidence: ref(""),
    contextPreviewResult: ref(null),
    contextPreviewTask: ref(""),
    contextProfileRows: ref<ContextProfileRow[]>([]),
    exportContextBuildRecords: vi.fn(),
    highlightedConfigTarget: ref(""),
    previewContextCompiler: vi.fn(),
    runContextReplayEvaluation: vi.fn(),
    ...overrides,
  };
  return context;
}

function mountView(extendedContext: Partial<MockContextState> = {}) {
  const context = makeContext(extendedContext);
  activeContext = context;
  const wrapper = mount(ContextManagementView, {
    attachTo: document.body,
    global: {
      stubs: {
        ConfigFoldCard: ConfigFoldCardMock,
      },
    },
  });
  mounted.push(wrapper);
  return { context, wrapper };
}

function findButtonByText(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((button) => button.text().trim() === text);
}

function findActionButtons(wrapper: VueWrapper) {
  return wrapper.findAll(".context-action-bar > .tool-button");
}

function modalInputs(wrapper: VueWrapper) {
  return wrapper.findAll(".pact-modal input");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await nextTick();
}

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  activeContext = null;
  saveContextProfilesMock.mockReset();
});

describe("ContextManagementView", () => {
  beforeEach(() => {
    saveContextProfilesMock.mockResolvedValue(undefined);
  });

  it("renders empty states, and button loading/disabled states for preview, replay, and export", async () => {
    const { wrapper, context } = mountView({
      contextProfileRows: ref([]),
      contextBuildRecordRows: ref([]),
    });

    expect(wrapper.find(".empty-profile-state").exists()).toBe(true);
    expect(wrapper.find(".empty-note").exists()).toBe(true);
    expect(context.exportContextBuildRecords).not.toHaveBeenCalled();

    const buttons = findActionButtons(wrapper);
    expect(buttons).toHaveLength(3);
    expect(buttons[0].text()).toBe("预览 ContextPack");
    expect(buttons[1].text()).toBe("运行 Replay 评估");
    expect(buttons[2].attributes("disabled")).toBeDefined();

    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    expect(context.previewContextCompiler).toHaveBeenCalledTimes(1);
    expect(context.runContextReplayEvaluation).toHaveBeenCalledTimes(1);
    expect(context.exportContextBuildRecords).not.toHaveBeenCalled();

    context.busyKey.value = "context:preview";
    await nextTick();
    expect(findButtonByText(wrapper, "预览中")?.exists()).toBe(true);
    expect(buttons[0].attributes("disabled")).toBeDefined();

    context.busyKey.value = "context:evaluation";
    await nextTick();
    expect(findButtonByText(wrapper, "评估中")?.exists()).toBe(true);
    expect(buttons[1].attributes("disabled")).toBeDefined();
  });

  it("renders context profile list and build record list with conditional meta badges and fold cards", async () => {
    const { wrapper, context } = mountView({
      contextProfileRows: ref([
        {
          profileId: "p-bias",
          label: "偏好优先",
          contextWindowTokens: 64000,
          knowledgeBudget: 18000,
          historyBudget: 16000,
          expertGuidanceRatio: 0.2,
          compressionMode: "compact",
          strategy: "ratio-first",
          protectedEvidenceFields: ["ev-1", "ev-2", "ev-3", "ev-4", "ev-5"],
          modelCompressionEnabled: true,
          modelCompressionAlias: "compact-v1",
        },
        {
          profileId: "p-plain",
          label: "",
          contextWindowTokens: 32000,
          knowledgeBudget: 9000,
          historyBudget: 6000,
          expertGuidanceRatio: 0.5,
          compressionMode: "basic",
          strategy: "first-fit",
          protectedEvidenceFields: [],
          modelCompressionEnabled: false,
        },
      ]),
      contextBuildRecordRows: ref([
        {
          recordId: "record-001",
          createdAt: "2026-06-04T03:00:00.000Z",
          profileId: "p-bias",
          totalTokens: 12345,
          sourceTokens: 11111,
          triggerReason: "preview",
          compressionMode: "compact",
          preservedEvidenceIds: ["ev-1", "ev-2", 3],
          droppedKnowledgeCount: 8,
          humanExpertGuidanceCount: 2,
        },
      ]),
      contextPreviewResult: ref({ preview: "ok" }),
      contextEvaluationResult: ref({ status: "passed" }),
      highlightedConfigTarget: ref("knowledge-review-fusion-agent"),
    });
    await flush();

    const profileItems = wrapper.findAll(".context-profile-item");
    expect(profileItems).toHaveLength(2);
    expect(wrapper.find(".empty-profile-state").exists()).toBe(false);
    expect(wrapper.find(".empty-note").exists()).toBe(false);
    expect(wrapper.text()).toContain("保护: ev-1, ev-2, ev-3, ev-4");
    expect(wrapper.text()).toContain("保护: 默认规则");
    expect(wrapper.text()).toContain("模型压缩: compact-v1");
    expect(wrapper.text()).toContain("模型压缩: 关闭");
    expect(wrapper.text()).toContain("偏好优先");
    expect(wrapper.text()).toContain("p-plain");

    expect(wrapper.findAll(".context-build-record").map((record) => record.text())).toHaveLength(1);
    expect(wrapper.text()).toContain("record-001");
    expect(wrapper.text()).toContain("token 12,345");

    const foldCards = wrapper.findAll(".mock-config-fold-card");
    expect(foldCards).toHaveLength(3);
    expect(foldCards[0].attributes("data-title")).toBe("本轮上下文包");
    expect(foldCards[0].text()).toContain("\"preview\": \"ok\"");
    expect(foldCards[1].attributes("data-title")).toBe("Replay 评估结果");
    expect(foldCards[1].text()).toContain("\"status\": \"passed\"");
    expect(foldCards[2].attributes("data-config-target")).toBe("knowledge-review-fusion-agent");
    expect(foldCards[2].text()).toContain("record-001");
    expect(foldCards[2].find(".context-build-record-list article").exists()).toBe(true);
    expect(foldCards[2].find(".context-build-record-list .empty-note").exists()).toBe(false);
    const actionButtons = findActionButtons(wrapper);
    expect(actionButtons[2].attributes("disabled")).toBeUndefined();
    await actionButtons[2].trigger("click");
    expect(context.exportContextBuildRecords).toHaveBeenCalledTimes(1);
  });

  it("opens preset modal, saves preset through context client, and resets state after save", async () => {
    const { wrapper, context } = mountView({
      contextProfileRows: ref([
        {
          profileId: "existing",
          label: "已有",
          contextWindowTokens: 64000,
          knowledgeBudget: 18000,
          historyBudget: 16000,
          expertGuidanceRatio: 0.2,
          compressionMode: "stable",
          strategy: "ratio-first",
          modelCompressionEnabled: true,
          modelCompressionAlias: "default",
        },
      ]),
    });

    const openButton = findButtonByText(wrapper, "新增预设");
    expect(openButton).not.toBeUndefined();
    await openButton?.trigger("click");
    expect(wrapper.find(".pact-modal").exists()).toBe(true);

    const inputs = modalInputs(wrapper);
    await inputs[0].setValue("custom-preset");
    await inputs[1].setValue("自定义配置");
    await inputs[2].setValue("90000");
    await inputs[3].setValue("30000");
    await inputs[4].setValue("9000");
    await inputs[5].setValue("0.75");

    const overlay = wrapper.find(".pact-modal-overlay");
    expect(overlay.exists()).toBe(true);
    await overlay.trigger("click");
    expect(wrapper.find(".pact-modal").exists()).toBe(false);

    await openButton?.trigger("click");
    const saveButton = findButtonByText(wrapper, "保存配置");
    expect(saveButton).not.toBeUndefined();
    const reopenInputs = modalInputs(wrapper);
    await reopenInputs[0].setValue("custom-preset");
    await reopenInputs[1].setValue("自定义配置");
    await reopenInputs[2].setValue("90000");
    await reopenInputs[3].setValue("30000");
    await reopenInputs[4].setValue("9000");
    await reopenInputs[5].setValue("0.75");
    await saveButton?.trigger("click");

    await flush();

    expect(saveContextProfilesMock).toHaveBeenCalledTimes(1);
    expect(saveContextProfilesMock).toHaveBeenCalledWith({
      profiles: [
        {
          profileId: "existing",
          label: "已有",
          contextWindowTokens: 64000,
          knowledgeBudget: 18000,
          historyBudget: 16000,
          expertGuidanceRatio: 0.2,
          compressionMode: "stable",
          strategy: "ratio-first",
          modelCompressionEnabled: true,
          modelCompressionAlias: "default",
        },
        expect.objectContaining({
          profileId: "custom-preset",
          label: "自定义配置",
          contextWindowTokens: 90000,
          knowledgeBudget: 30000,
          historyBudget: 9000,
          expertGuidanceRatio: 0.75,
          compression: {
            enabled: true,
            threshold: 0.6,
            targetRatio: 0.3,
            protectLastNTurns: 8,
            summaryMaxTokens: 8000,
            strategy: "deterministic-extractive",
          },
        }),
      ],
    });
    expect(context.contextProfileRows.value).toHaveLength(2);
    expect(context.contextProfileRows.value[1]).toMatchObject({
      profileId: "custom-preset",
      label: "自定义配置",
      contextWindowTokens: 90000,
      knowledgeBudget: 30000,
      historyBudget: 9000,
      expertGuidanceRatio: 0.75,
    });
    expect(context.contextProfileRows.value[1]).toHaveProperty("compression.threshold", 0.6);
    expect(wrapper.find(".pact-modal").exists()).toBe(false);

    await openButton?.trigger("click");
    const reopenedInputs = modalInputs(wrapper);
    expect((reopenedInputs[0].element as HTMLInputElement).value).toBe("");
    expect((reopenedInputs[1].element as HTMLInputElement).value).toBe("");
    expect((reopenedInputs[2].element as HTMLInputElement).value).toBe("64000");
    expect((reopenedInputs[3].element as HTMLInputElement).value).toBe("18000");
    expect((reopenedInputs[4].element as HTMLInputElement).value).toBe("16000");
    expect((reopenedInputs[5].element as HTMLInputElement).value).toBe("0.2");
  });

  it("keeps preview input fields synced with shell context and supports canceling add-preset modal", async () => {
    const { wrapper, context } = mountView({
      contextProfileRows: ref([
        {
          profileId: "existing",
          label: "已有",
          contextWindowTokens: 64000,
          knowledgeBudget: 18000,
          historyBudget: 16000,
          expertGuidanceRatio: 0.2,
          compressionMode: "stable",
          strategy: "ratio-first",
          modelCompressionEnabled: true,
        },
      ]),
    });

    const previewTask = wrapper.get(".preview-task-form textarea");
    const requiredEvidence = wrapper.get(".preview-task-form input");
    await previewTask.setValue("演示上下文输入");
    await requiredEvidence.setValue("ev-a, ev-b");
    expect(context.contextPreviewTask.value).toBe("演示上下文输入");
    expect(context.contextPreviewRequiredEvidence.value).toBe("ev-a, ev-b");

    const addButton = findButtonByText(wrapper, "新增预设");
    await addButton?.trigger("click");
    const cancelButton = findButtonByText(wrapper, "取消");
    const addInputs = modalInputs(wrapper);
    await addInputs[0].setValue("cancel-attempt");
    await cancelButton?.trigger("click");
    expect(context.contextProfileRows.value).toHaveLength(1);
    expect(wrapper.find(".pact-modal").exists()).toBe(false);
  });

  it("logs and swallows save errors while keeping optimistic updates", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saveError = new Error("save failed");
    saveContextProfilesMock.mockRejectedValueOnce(saveError);
    const { wrapper, context } = mountView({
      contextProfileRows: ref([
        {
          profileId: "existing",
          label: "已有",
          contextWindowTokens: 1000,
          knowledgeBudget: 500,
          historyBudget: 400,
          expertGuidanceRatio: 0.2,
          compressionMode: "stable",
          strategy: "ratio-first",
          modelCompressionEnabled: true,
        },
      ]),
    });

    const openButton = findButtonByText(wrapper, "新增预设");
    await openButton?.trigger("click");
    const saveButton = findButtonByText(wrapper, "保存配置");

    const inputs = modalInputs(wrapper);
    await inputs[0].setValue("error-preset");
    await inputs[1].setValue("失败测试");

    await saveButton?.trigger("click");
    await flush();

    expect(saveContextProfilesMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(context.contextProfileRows.value).toHaveLength(2);
    expect(context.contextProfileRows.value[1].profileId).toBe("error-preset");
    expect(wrapper.find(".pact-modal").exists()).toBe(false);
    expect((context.contextProfileRows.value[1].expertGuidanceRatio)).toBe(0.2);
  });
});
