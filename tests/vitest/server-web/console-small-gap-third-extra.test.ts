// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";
import { createDebugDistillationRunner } from "../../../server-web/composables/console-debug-distillation-runner";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createConsoleModelProbeController } from "../../../server-web/composables/console-model-probe-controller";
import { renderEmailNode, renderEvidenceReadableHtml } from "../../../server-web/composables/console-evidence-rendering";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import { useKnowledgeDistillationWorkbench } from "../../../server-web/composables/knowledge-distillation-workbench-controller";
import type { AgentModelConfig, AgentSettings, ModelProbeResponse } from "../../../server-web/lib/types";

const feedViewContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const workspacesViewContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const apiMocks = vi.hoisted(() => ({
  archiveKnowledgeDistillationWorkbenchRun: vi.fn(),
  cancelKnowledgeDistillationWorkbenchRun: vi.fn(),
  compareKnowledgeDistillationWorkbenchRuns: vi.fn(),
  createJob: vi.fn(),
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  createKnowledgeUploadSession: vi.fn(),
  deleteKnowledgeDistillationWorkbenchRun: vi.fn(),
  getJob: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRunArtifacts: vi.fn(),
  getSettings: vi.fn(),
  listKnowledgeDistillationWorkbenchRuns: vi.fn(),
  probeDistillationModelStatus: vi.fn(),
  probeModel: vi.fn(),
  rerunKnowledgeDistillationWorkbenchStage: vi.fn(),
  resumeKnowledgeDistillationWorkbenchRun: vi.fn(),
}));

const timerMocks = vi.hoisted(() => ({
  createConsoleIntervalController: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createConsoleTimeoutController: vi.fn(() => ({
    schedule: vi.fn(),
    stop: vi.fn(),
  })),
  waitForConsoleDelay: vi.fn(async () => undefined),
}));

const browserEffectsMocks = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(() => true),
}));

const pageRefreshMocks = vi.hoisted(() => ({
  usePageRefreshHandler: vi.fn(),
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedViewContextMock.current,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => workspacesViewContextMock.current,
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  getSettings: apiMocks.getSettings,
  probeModel: apiMocks.probeModel,
}));

vi.mock("../../../server-web/lib/jobs-client", () => ({
  createJob: apiMocks.createJob,
  getJob: apiMocks.getJob,
}));

vi.mock("../../../server-web/lib/knowledge-upload-session", () => ({
  createKnowledgeUploadSession: apiMocks.createKnowledgeUploadSession,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => browserEffectsMocks);

vi.mock("../../../server-web/composables/usePageRefresh", () => pageRefreshMocks);

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleIntervalController: timerMocks.createConsoleIntervalController,
  createConsoleTimeoutController: timerMocks.createConsoleTimeoutController,
  waitForConsoleDelay: timerMocks.waitForConsoleDelay,
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/lib/knowledge-distillation-workbench")>();
  return {
    ...actual,
    archiveKnowledgeDistillationWorkbenchRun: apiMocks.archiveKnowledgeDistillationWorkbenchRun,
    cancelKnowledgeDistillationWorkbenchRun: apiMocks.cancelKnowledgeDistillationWorkbenchRun,
    compareKnowledgeDistillationWorkbenchRuns: apiMocks.compareKnowledgeDistillationWorkbenchRuns,
    createKnowledgeDistillationWorkbenchRun: apiMocks.createKnowledgeDistillationWorkbenchRun,
    deleteKnowledgeDistillationWorkbenchRun: apiMocks.deleteKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRun: apiMocks.getKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRunArtifacts: apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts,
    listKnowledgeDistillationWorkbenchRuns: apiMocks.listKnowledgeDistillationWorkbenchRuns,
    probeDistillationModelStatus: apiMocks.probeDistillationModelStatus,
    rerunKnowledgeDistillationWorkbenchStage: apiMocks.rerunKnowledgeDistillationWorkbenchStage,
    resumeKnowledgeDistillationWorkbenchRun: apiMocks.resumeKnowledgeDistillationWorkbenchRun,
  };
});

function flush() {
  return nextTick().then(() => nextTick());
}

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
      h("label", { class: "mock-option-bar" }, [
        props.label ? h("span", { class: "mock-option-bar-label" }, props.label) : null,
        h(
          "select",
          {
            class: "mock-option-bar-select",
            value: String(props.modelValue ?? ""),
            onChange: (event: Event) =>
              emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          (props.options as Array<{ label?: string; value?: string | number | boolean }>).map((option) =>
            h("option", { value: String(option.value ?? "") }, String(option.label ?? "")),
          ),
        ),
      ]);
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    includeEmpty: Boolean,
    label: String,
    modelValue: [String, Number, Boolean],
    options: {
      type: Array,
      default: () => [],
    },
    placeholder: String,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "mock-agent-model-option-bar" }, [
        props.label ? h("span", { class: "mock-agent-model-option-bar-label" }, props.label) : null,
        h(
          "select",
          {
            class: "mock-agent-model-option-bar-select",
            value: String(props.modelValue ?? ""),
            onChange: (event: Event) =>
              emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          [
            ...(props.includeEmpty
              ? [h("option", { value: "" }, props.placeholder || "")]
              : []),
            ...(props.options as Array<{ label?: string; value?: string | number | boolean }>).map((option) =>
              h("option", { value: String(option.value ?? "") }, String(option.label ?? "")),
            ),
          ],
        ),
      ]);
  },
});

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
          type: "button",
          onClick: () => emit("select", [new File(["attachment"], "attachment.txt", { type: "text/plain" })]),
        },
        [slots.default?.() || props.buttonText || ""],
      );
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    label: String,
    modelValue: Boolean,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "binary-checkbox-stub",
          type: "button",
          "data-checked": String(Boolean(props.modelValue)),
          onClick: () => emit("update:modelValue", !props.modelValue),
        },
        props.label || "",
      );
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    open: Boolean,
    title: String,
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub", "data-open": String(Boolean(props.open)) }, [
        h("h4", props.title || ""),
        slots.default?.(),
      ]);
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone || "" }, props.label || "");
  },
});

function makeFeedContext(overrides: Record<string, unknown> = {}) {
  return {
    agentSelectorOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([{ label: "32k", value: "32k" }]),
    handleInfoFeedAttachmentFiles: vi.fn(),
    infoFeedAttachments: ref([]),
    infoFeedCurrentRun: ref({ summary: { status: "running" } } as never),
    infoFeedForm: ref({
      contextProfileId: "32k",
      maxTokens: 4096,
      modelAlias: "",
      query: "初始问题",
      temperature: 0.2,
    }),
    infoFeedInputPlaceholder: ref("输入问题"),
    infoFeedModelOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
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
    thinkingModeOptionBarOptions: ref([{ label: "Balanced", value: "balanced" }]),
    ...overrides,
  };
}

function makeWorkspaceContext(overrides: Record<string, unknown> = {}) {
  const cloudDriveFormOverrides = (overrides.cloudDriveForm as Record<string, unknown>) || {};
  const cloudDriveForm = reactive({
    provider: "onedrive",
    rootPath: "",
    driveRef: "",
    clientId: "owner",
    managedFolderRoot: ".pact-data",
    publicFolder: "public",
    allowedClients: "owner, codex",
    advancedMode: false,
    exposedDirectories: [] as Array<Record<string, unknown>>,
    path: "",
    uploadPath: "",
    uploadContent: "Pact cloud drive console upload\n",
    targetPath: "cloud-drive",
    ...cloudDriveFormOverrides,
  });

  const { cloudDriveForm: _cloudDriveForm, ...restOverrides } = overrides;

  return {
    addCloudDriveExposure: vi.fn(),
    applyCloudDriveSync: vi.fn(),
    busyKey: ref(""),
    cloudDriveConnectionOptions: computed(() => []),
    cloudDriveData: ref(null),
    cloudDriveForm,
    cloudDriveResult: ref(null),
    connectCloudDrive: vi.fn(),
    downloadCloudDriveFile: vi.fn(),
    listCloudDriveItems: vi.fn(),
    listCloudDrivePermissions: vi.fn(),
    panel: ref("cloudDrive"),
    planCloudDriveSync: vi.fn(),
    removeCloudDriveExposure: vi.fn(),
    selected: ref({ title: "主工作区" }),
    uploadCloudDriveFile: vi.fn(),
    ...restOverrides,
  };
}

function makeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    googleModel: "gemini-1.5",
    openAiModel: "gpt-4.1-mini",
    deepSeekBaseUrl: "https://api.deepseek.com",
    deepSeekModel: "deepseek-chat",
    deepSeekApiKey: "",
    deepSeekApiKeyConfigured: false,
    deepSeekTimeoutMs: 120000,
    openRouterModel: "",
    copilotModel: "",
    localModelName: "",
    customModelAlias: "",
    customModelLabel: "",
    customHttpAdapter: {
      alias: "",
      label: "",
      url: "",
      token: "",
      tokenConfigured: false,
      tokenHeader: "token",
      tokenPrefix: "",
      agentName: "",
      engine: "",
      pluginList: [],
      parameters: {},
      timeoutMs: 120000,
    },
    customHttpAdapters: [],
    ...overrides,
  } as AgentSettings;
}

function makeModelConfig(overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return {
    instanceId: "agent-1",
    provider: "google-gemini",
    alias: "agent-1",
    label: "Gemini 1",
    model: "gemini-1.5",
    baseUrl: "",
    url: "",
    apiKey: "",
    apiKeyConfigured: false,
    token: "",
    tokenConfigured: false,
    tokenHeader: "token",
    tokenPrefix: "",
    agentName: "Gemini 1",
    pluginList: [],
    engine: "",
    systemPrompt: "",
    parameters: {},
    moduleAccess: { mode: "all", moduleIds: [] },
    permissionGroupId: "",
    timeoutMs: 120000,
    parametersText: "{}",
    ...overrides,
  } as AgentModelConfig;
}

function makeProbeResponse(overrides: Partial<ModelProbeResponse> = {}): ModelProbeResponse {
  return {
    ok: true,
    configured: true,
    provider: "google-gemini",
    model: "gemini-1.5",
    statusCode: 200,
    latencyMs: 123,
    checkedAt: "2026-06-04T00:00:00.000Z",
    message: "",
    ...overrides,
  };
}

function createProbeHarness(overrides: Partial<{
  visibleModelEntries: AgentModelConfig[];
  settingsPayloadForSave: () => AgentSettings;
}> = {}) {
  const error = ref("");
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();
  const modelProbeResults = ref<Record<string, ModelProbeResponse>>({});
  const visibleModelEntries = ref<AgentModelConfig[]>(
    overrides.visibleModelEntries || [
      makeModelConfig({
        provider: "google-gemini",
        model: "gemini-2.0",
        label: "Gemini",
      }),
    ],
  );

  const controller = createConsoleModelProbeController({
    clearAllBusy,
    error,
    modelEntryConfigured: (entry) => Boolean(entry.model || entry.engine),
    modelEntryStatusKey: (entry) => entry.model || entry.engine || entry.label || entry.instanceId,
    modelProbeResults,
    providerConfigured: (provider) => provider !== "unknown-provider",
    setBusy,
    settingsPayloadForSave: overrides.settingsPayloadForSave || (() => makeSettings()),
    visibleModelEntries,
  });

  return {
    clearAllBusy,
    controller,
    error,
    modelProbeResults,
    setBusy,
    visibleModelEntries,
  };
}

function createHistoryHarness() {
  const infoFeedAttachments = ref([] as Array<Record<string, unknown>>);
  const infoFeedCurrentRun = ref<any>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "ctx-start",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedHistory = ref<any[]>([]);
  const infoFeedParentRunSnapshot = ref<any>(null);

  const controller = createConsoleInfoFeedHistoryController({
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
    storageKey: "console-small-gap-third-extra",
    evidenceRefs: vi.fn(() => ["evidence-1"]),
    hasAgentModelOption: vi.fn((value?: string) => value !== "removed"),
    summaryDefaults: () => ({
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      temperature: 0.2,
      maxTokens: 1800,
    }),
    validAgentModelAlias: (value?: string) => (value === "removed" ? "fallback-model" : (value || "")),
  });

  return {
    controller,
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
  };
}

function mountInfoFeedComposerPanel() {
  feedViewContextMock.current = makeFeedContext();
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

function mountWorkspaceCloudDrivePanel() {
  workspacesViewContextMock.current = makeWorkspaceContext();
  return mount(WorkspaceCloudDrivePanel, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        OptionBar: OptionBarStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

function mountWorkbenchHarness(
  props: Partial<Parameters<typeof useKnowledgeDistillationWorkbench>[0]> = {},
) {
  let controller!: ReturnType<typeof useKnowledgeDistillationWorkbench>;
  const Host = defineComponent({
    name: "WorkbenchHost",
    setup() {
      controller = useKnowledgeDistillationWorkbench({
        canMaintainKnowledge: true,
        canReadKnowledge: true,
        formatCompactDate: (value) => value,
        ingestJob: null,
        normalizedManifest: null,
        modelOptions: [],
        ...props,
      });
      return () => null;
    },
  });

  const wrapper = mount(Host);
  return { controller, wrapper };
}

beforeEach(() => {
  feedViewContextMock.current = null;
  workspacesViewContextMock.current = null;
  vi.clearAllMocks();
  window.localStorage.clear();

  apiMocks.getSettings.mockResolvedValue({} as never);
  apiMocks.probeModel.mockResolvedValue(makeProbeResponse() as never);
  apiMocks.createJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" } as never);
  apiMocks.getJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" } as never);
  apiMocks.createKnowledgeUploadSession.mockResolvedValue({ session: { sessionId: "session-1" } } as never);
  apiMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValue({
    runId: "run-1",
    status: "running",
    stages: [],
  } as never);
  apiMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValue({
    runId: "run-1",
    status: "completed",
    stages: [
      {
        stageId: "knowledge-distillation",
        status: "completed",
        output: {
          markdown: "# Done\n",
          markdownLength: 7,
        },
      },
    ],
  } as never);
  apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({ items: [] } as never);
  apiMocks.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([] as never);
  apiMocks.probeDistillationModelStatus.mockResolvedValue({
    state: "online",
    checkedAt: "2026-06-04T00:00:00.000Z",
    message: "在线",
  } as never);
  browserEffectsMocks.confirmConsoleAction.mockReturnValue(true);
  pageRefreshMocks.usePageRefreshHandler.mockImplementation(() => undefined);
});

afterEach(() => {
  feedViewContextMock.current = null;
  workspacesViewContextMock.current = null;
});

describe("InfoFeedComposerPanel", () => {
  it("keeps the empty attachment branch and closes the advanced dialog from the backdrop", async () => {
    const wrapper = mountInfoFeedComposerPanel();

    expect(wrapper.find(".info-feed-attachment-chip").exists()).toBe(false);
    expect(wrapper.get(".primary-action").element.disabled).toBe(true);

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect((feedViewContextMock.current as any).handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.get(".info-feed-advanced-backdrop").trigger("click");
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
});

describe("WorkspaceCloudDrivePanel", () => {
  it("reveals iCloud fields only when selected and keeps the empty advanced state visible", async () => {
    const context = makeWorkspaceContext({
      cloudDriveForm: {
        advancedMode: false,
        provider: "onedrive",
        path: "",
        uploadPath: "",
      },
    });
    workspacesViewContextMock.current = context;

    const wrapper = mountWorkspaceCloudDrivePanel();

    expect(wrapper.text()).not.toContain("iCloud 受控目录");
    expect(wrapper.text()).not.toContain("已连接云盘");

    await wrapper.get(".binary-checkbox-stub").trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("暂无目录。");

    await wrapper.get(".mock-option-bar-select").setValue("icloud");
    await nextTick();

    expect(wrapper.text()).toContain("iCloud 受控目录");
    expect(wrapper.get('input[placeholder="留空使用系统 iCloud Drive 默认路径"]').exists()).toBe(true);

    await wrapper.get("button.tool-button.tool-button-ghost").trigger("click");
  });
});

describe("createDebugDistillationRunner", () => {
  it("handles empty selections, missing files, and an unavailable model", async () => {
    const distillationFile = ref<File | null>(null);
    const distillationStep = ref("idle");
    const distillationUploadPercent = ref(0);
    const distillationJob = ref<any>(null);
    const distillationRun = ref<any>(null);
    const distillationArtifactSizes = ref<Record<string, number>>({});
    const distillationError = ref("");
    const distillationStatusMessage = ref("");
    const distillationModelAlias = ref("model-a");
    const distillationModelReady = vi.fn(() => false);
    const selectedDistillationModel = vi.fn(() => ({ reason: "模型不可用" }));

    const runner = createDebugDistillationRunner({
      distillationArtifactSizes,
      distillationError,
      distillationFile,
      distillationJob,
      distillationModelAlias,
      distillationModelReady,
      distillationRun,
      distillationStatusMessage,
      distillationStep,
      distillationUploadPercent,
      selectedDistillationModel,
    });

    runner.handleDebugDistillationFileSelected([]);
    expect(distillationFile.value).toBeNull();
    expect(distillationStep.value).toBe("idle");
    expect(distillationStatusMessage.value).toBe("等待文件");

    const file = new File(["hello"], "sample.md", { type: "text/markdown" });
    runner.handleDebugDistillationFileSelected([file]);
    expect(distillationFile.value).toBe(file);
    expect(distillationStatusMessage.value).toBe("文件已选择");

    await runner.startDebugKnowledgeDistillation();
    expect(distillationError.value).toBe("模型不可用");
    expect(apiMocks.createKnowledgeUploadSession).not.toHaveBeenCalled();

    distillationModelReady.mockReturnValue(true);
    runner.handleDebugDistillationFileSelected([]);
    await runner.startDebugKnowledgeDistillation();
    expect(distillationError.value).toBe("请先选择文件。");
    expect(apiMocks.createKnowledgeUploadSession).not.toHaveBeenCalled();
  });
});

describe("createConsoleModelProbeController", () => {
  it("builds provider-specific payloads and records probe failures", async () => {
    const harness = createProbeHarness({
      settingsPayloadForSave: () => makeSettings({
        deepSeekApiKey: "deepseek-key",
        deepSeekApiKeyConfigured: true,
        deepSeekBaseUrl: "https://api.deepseek.example",
        deepSeekTimeoutMs: 90000,
        googleModel: "gemini-2.0",
        openAiModel: "gpt-4.1-mini",
      }),
    });
    const controller = harness.controller;

    const deepseekEntry = makeModelConfig({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.example",
      apiKey: "deepseek-key",
      apiKeyConfigured: true,
      timeoutMs: 90000,
    });
    const customEntry = makeModelConfig({
      provider: "custom-http",
      label: "Adapter",
      model: "engine-x",
      url: "https://adapter.test",
      token: "tok",
      tokenConfigured: true,
      tokenHeader: "x-token",
      tokenPrefix: "Bearer",
      pluginList: ["alpha"],
      parametersText: "{\"top_p\": 0.7}",
      timeoutMs: 60000,
    });
    const openRouterEntry = makeModelConfig({
      provider: "openrouter",
      model: "router-model",
    });
    const localEntry = makeModelConfig({
      provider: "local-model",
      model: "llama-3.1",
    });

    expect(controller.modelProbeSettingsForEntry(deepseekEntry)).toMatchObject({
      deepSeekBaseUrl: "https://api.deepseek.example",
      deepSeekModel: "deepseek-chat",
      deepSeekApiKey: "deepseek-key",
      deepSeekApiKeyConfigured: true,
      deepSeekTimeoutMs: 90000,
    });
    expect(controller.modelProbeSettingsForEntry(customEntry)).toMatchObject({
      customModelAlias: customEntry.model,
      customModelLabel: "Adapter",
      customHttpAdapter: expect.objectContaining({
        alias: customEntry.model,
        label: "Adapter",
        url: "https://adapter.test",
        token: "tok",
        tokenHeader: "x-token",
        tokenPrefix: "Bearer",
        engine: "engine-x",
        pluginList: ["alpha"],
        parameters: { top_p: 0.7 },
        timeoutMs: 60000,
      }),
      customHttpAdapters: [expect.objectContaining({ alias: customEntry.model })],
    });
    expect(controller.modelProbeSettingsForEntry(openRouterEntry)).toMatchObject({ openRouterModel: "router-model" });
    expect(controller.modelProbeSettingsForEntry(localEntry)).toMatchObject({ localModelName: "llama-3.1" });

    const missingEntry = makeModelConfig({
      provider: "google-gemini",
      model: "",
      label: "",
      instanceId: "",
      alias: "",
      engine: "",
    });
    await controller.probeModelEntry(missingEntry);
    expect(apiMocks.probeModel).not.toHaveBeenCalled();
    expect(harness.modelProbeResults.value[""]).toMatchObject({
      ok: false,
      configured: false,
      provider: "google-gemini",
      message: "模型配置不完整，未执行远程探测。",
    });

    apiMocks.probeModel.mockRejectedValueOnce(new Error("entry probe failed"));
    const configuredEntry = makeModelConfig({ provider: "google-gemini", model: "gemini-2.0" });
    await controller.probeModelEntry(configuredEntry);
    expect(harness.error.value).toBe("entry probe failed");
    expect(harness.modelProbeResults.value["gemini-2.0"]).toMatchObject({
      ok: false,
      provider: "google-gemini",
      message: "entry probe failed",
    });

    apiMocks.probeModel.mockRejectedValueOnce(new Error("provider probe failed"));
    await controller.probeModel("unknown-provider" as never);
    expect(harness.error.value).toBe("provider probe failed");
    expect(controller.providerStatusLabel("unknown-provider" as never)).toBe("探测失败");
    expect(controller.providerStatusTone("unknown-provider" as never)).toBe("danger");
  });
});

describe("createConsoleInfoFeedHistoryController", () => {
  it("reads attachments, skips invalid payloads, and persists deduplicated history", async () => {
    const harness = createHistoryHarness();
    const goodFile = new File(["hello"], "note.txt", { type: "text/plain" });
    const emptyFile = new File(["   "], "empty.txt", { type: "text/plain" });
    const binaryFile = new File(["hello"], "image.png", { type: "image/png" });
    const largeFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.txt", { type: "text/plain" });

    await expect(harness.controller.readInfoFeedAttachment(goodFile)).resolves.toMatchObject({
      status: "completed",
      text: "hello",
    });
    await expect(harness.controller.readInfoFeedAttachment(emptyFile)).resolves.toMatchObject({
      status: "failed",
      error: "文件内容为空或疑似二进制内容。",
    });
    await expect(harness.controller.readInfoFeedAttachment(binaryFile)).resolves.toMatchObject({
      status: "failed",
      error: "当前格式无法在页面侧直接读取。",
    });
    await expect(harness.controller.readInfoFeedAttachment(largeFile)).resolves.toMatchObject({
      status: "failed",
      error: "附件超过 2MB，信息流输入暂不直接读取。",
    });

    await harness.controller.handleInfoFeedAttachmentFiles([]);
    expect(harness.infoFeedAttachments.value).toHaveLength(0);

    const run = createInfoFeedRunState("原始问题", {
      attachments: [],
      summaryDefaults: {
        modelAlias: "model-default",
        contextProfileId: "ctx-default",
        temperature: 0.2,
        maxTokens: 1800,
      },
    });
    run.runId = "run-1";
    run.summary.modelAlias = "removed";
    run.summary.contextProfileId = "ctx-1";
    run.summary.answer = "答案";

    harness.infoFeedHistory.value = [createInfoFeedRunState("旧问题", {
      attachments: [],
      summaryDefaults: {
        modelAlias: "model-default",
        contextProfileId: "ctx-default",
        temperature: 0.2,
        maxTokens: 1800,
      },
    }) as never];
    (harness.infoFeedHistory.value[0] as any).runId = "run-1";
    (harness.infoFeedHistory.value[0] as any).summary.modelAlias = "model-default";

    harness.controller.upsertInfoFeedHistory(run);
    expect(harness.infoFeedHistory.value).toHaveLength(1);
    expect(harness.infoFeedHistory.value[0].runId).toBe("run-1");

    harness.infoFeedHistory.value[0].summary.modelAlias = "removed";
    harness.infoFeedCurrentRun.value = run;
    harness.infoFeedParentRunSnapshot.value = run;
    harness.controller.clearInvalidInfoFeedModelReferences();
    expect(harness.infoFeedCurrentRun.value?.summary.modelAlias).toBe("fallback-model");
    expect(harness.infoFeedHistory.value[0].summary.modelAlias).toBe("fallback-model");
  });
});

describe("console-evidence-rendering", () => {
  it("falls back to readable text for empty image evidence and ignores non-elements", () => {
    const context = {
      origin: () => "https://render.test",
      imageAssets: () => [],
      assetUrlForReference: () => "",
      assetUrlForAssetId: () => "",
    };

    expect(renderEvidenceReadableHtml({ text: "", kind: "图片" }, context)).toContain("当前证据没有可展示的正文。");
    expect(renderEmailNode(document.createComment("note"), context)).toBe("");
  });
});

describe("useKnowledgeDistillationWorkbench", () => {
  it("short-circuits the early error branches and package URL fallback", async () => {
    const { controller: emptyController } = mountWorkbenchHarness({
      canReadKnowledge: false,
      ingestJob: null,
      modelOptions: [],
    });
    await flush();

    expect(emptyController.packageUrl()).toBe("#");
    await emptyController.refreshRuns();
    expect(apiMocks.listKnowledgeDistillationWorkbenchRuns).not.toHaveBeenCalled();

    await emptyController.startWorkbenchRun();
    expect(emptyController.error.value).toBe("请先在页面顶部导入项目目录并完成解析。");

    const { controller: runningController } = mountWorkbenchHarness({
      ingestJob: {
        id: "job-2",
        status: "running",
      } as never,
      modelOptions: [],
    });
    await flush();

    await runningController.startWorkbenchRun();
    expect(runningController.error.value).toBe("解析任务尚未完成，不能开始知识蒸馏。");

    await runningController.compareRuns();
    expect(apiMocks.compareKnowledgeDistillationWorkbenchRuns).not.toHaveBeenCalled();
    await runningController.resumeRun();
    expect(apiMocks.resumeKnowledgeDistillationWorkbenchRun).not.toHaveBeenCalled();
  });
});
