// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount, shallowMount } from "@vue/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  analysisExecutionModeLabel,
  backgroundProcessLabel,
  backgroundProcessTone,
  clientRuntimeCoolingLabel,
  clientRuntimeCoolingTone,
  clientRuntimeHeatStyle,
  clientRuntimeReasonLabel,
  clientRuntimeSurfaceText,
  clientRuntimeTaskText,
  maintenanceAgentRiskLabel,
  maintenanceAgentStatusLabel,
  maintenanceAgentStatusTone,
  monitorAlertSeverityLabel,
  monitorAlertSeverityTone,
  migrationProgress,
  migrationTone,
  processRelationText,
  processTypeLabel,
  queueLifecycleLabel,
  queueLifecycleTone,
  queueSourceLabel,
} from "../../../server-web/composables/console-status-utils";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createConsoleInfoFeedOutputController } from "../../../server-web/composables/console-info-feed-output-controller";
import { createConsoleStateEventReducerController } from "../../../server-web/composables/console-state-event-reducer-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type { ProtocolEvent, ServerConsoleState } from "../../../server-web/lib/types";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import KnowledgeDistillationWorkbench from "../../../server-web/components/KnowledgeDistillationWorkbench.vue";
import SourcesAddDataSourceDialog from "../../../server-web/components/sources/SourcesAddDataSourceDialog.vue";
import WordCloudClassCard from "../../../server-web/components/knowledge/word-cloud/WordCloudClassCard.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";
import AgentRetrievalForm from "../../../server-web/components/debug/AgentRetrievalForm.vue";
import KnowledgeRecallDebugPanel from "../../../server-web/components/debug/KnowledgeRecallDebugPanel.vue";

let externalServicesControllerMock: any;
let knowledgeDistillationWorkbenchMock: any;
let sourcesViewContextMock: any;
let wordCloudContextMock: any;
let workspacesViewContextMock: any;
let agentRetrievalViewContextMock: any;
let debugViewContextMock: any;

const copyConsoleTextWithFeedbackMock = vi.fn();

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: (...args: unknown[]) => copyConsoleTextWithFeedbackMock(...args),
}));

vi.mock("../../../server-web/composables/knowledge-distillation-workbench-controller", () => ({
  useKnowledgeDistillationWorkbench: vi.fn(() => knowledgeDistillationWorkbenchMock),
}));

vi.mock("../../../server-web/composables/sourcesViewContext", () => ({
  useSourcesViewContext: vi.fn(() => sourcesViewContextMock),
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeWordCloudContext: vi.fn(() => wordCloudContextMock),
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: vi.fn(() => workspacesViewContextMock),
}));

vi.mock("../../../server-web/composables/agentRetrievalViewContext", () => ({
  useAgentRetrievalViewContext: vi.fn(() => agentRetrievalViewContextMock),
}));

vi.mock("../../../server-web/composables/debugViewContext", () => ({
  useDebugViewContext: vi.fn(() => debugViewContextMock),
}));

function makeRef<T>(value: T) {
  return ref(value) as { value: T };
}

function resetComponentMocks() {
  copyConsoleTextWithFeedbackMock.mockReset();
    externalServicesControllerMock = {
      configuredCount: 3,
      discoveredServiceCount: 4,
      mcpToolCount: 8,
      validServiceCount: 2,
      presetCount: 1,
      discoveryCacheUpdatedAtLabel: "2026-06-04 11:30",
      configEditorOpen: false,
      configEditorMode: "add",
      configEditorTitle: "添加服务",
      configEditorSubtitle: "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
      configStatusTone: "success",
      configStatusLabel: "Valid",
      verifying: false,
    loadError: "",
    actionError: "",
    actionMessage: "",
    configDraft: reactive({
      serviceId: "svc-1",
      serviceName: "Service 1",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      upstream: {
        type: "mcp",
        provider: "",
        transport: "streamable-http",
      },
    }),
    modeOptions: [{ value: "connected", label: "connected" }],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [{ value: "MCP 服务", label: "MCP 服务" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
      modelProtocolOptions: [{ value: "OpenAI Compatible", label: "OpenAI Compatible" }],
      mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
      bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
      bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
      riskOptions: [{ value: "read_only", label: "read_only" }],
      healthCheckTypeOptions: [{ value: "none", label: "none" }],
      showCustomUpstreamType: false,
      isLlmServiceDraft: false,
      isCloudDriveServiceDraft: false,
      upstreamTypeSelectValue: "MCP 服务",
      modelProtocolSelectValue: "OpenAI Compatible",
      customUpstreamTypeValue: "",
      verifyingText: "校验配置",
      services: [],
      loading: false,
      saving: false,
      validationErrors: [],
      validationWarnings: [],
      requiredScopesText: "knowledge:read",
      discoveryCacheUpdatedAtLabelText: "2026-06-04 11:30",
      closeConfigEditor: vi.fn(),
      verifyConfig: vi.fn(),
      saveConfig: vi.fn(),
      updateRootField: vi.fn(),
      updateUpstreamTypeSelection: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCloudDriveMode: vi.fn(),
  };

  knowledgeDistillationWorkbenchMock = {
    activeJobCompleted: ref(false),
    activeRunProgress: ref(0),
    activeRunStages: ref([]),
    archiveRun: vi.fn(),
    busy: ref(""),
    canStart: ref(false),
    cancelRun: vi.fn(),
    compareResult: ref(null),
    compareRightRunId: ref(""),
    compareRuns: vi.fn(),
    createOptions: reactive({
      modelAlias: "",
      prompt: "",
      tokenBudget: 64000,
      payloadBudget: 500000,
      rawCorpusBatchMaxCharacters: 160000,
      rawCorpusBatchModelMaxCharacters: 32000,
      rawCorpusBatchRetryModelMaxCharacters: 16000,
      mergeStrategy: "timeline_then_topic",
      maxRounds: 3,
      strategyVersion: "timeline_then_topic_v2",
      timeDecayHalfLifeDays: 90,
      timeDecayFloor: 0.35,
      priority: "normal",
    }),
    deleteRun: vi.fn(),
    distillationModelOptions: ref([{ value: "model-a", label: "模型 A" }]),
    error: ref(""),
    formatCompactDate: (value: string) => value,
    modelProbeLabel: "正常",
    modelProbeTone: "success",
    modelProbeTooltip: "可用",
    packageUrl: vi.fn(() => "/package/run-1"),
    rerunStage: vi.fn(),
    resumeRun: vi.fn(),
    runs: ref([]),
    selectRun: vi.fn(),
    selectedRun: ref(null),
    selectedRunId: ref(""),
    startWorkbenchRun: vi.fn(),
  };

  sourcesViewContextMock = {
    busyKey: ref(""),
    canBrowseServerPaths: ref(true),
    canWriteJobs: ref(true),
    localSourceForm: reactive({
      label: "文档",
      directoryPath: "/Users/me/Documents",
      autoSync: true,
      recursive: true,
      hydrationEnabled: true,
    }),
    openLocalSourceDirectoryPicker: vi.fn(),
    syncLocalSourceLabelFromPath: vi.fn(),
  };

  wordCloudContextMock = {
    addChildWordCloud: vi.fn(),
    addTermActionToCloud: vi.fn(),
    autoFillCloudWithAgent: vi.fn(),
    collapsedWordBagIds: ref(new Set<string>()),
    fillingWordBagIds: ref(new Set<string>()),
    jumpToCloud: vi.fn(),
    pinWordCloud: vi.fn(),
    pinnedWordBagIds: ref(new Set<string>()),
    selectWordCloud: vi.fn(),
    selectedWordCloud: ref({ wordBagId: "bag-1" }),
    selectedWordCloudModel: ref({ enabled: true }),
    titleFocusedWordBagId: ref<string | null>(null),
    toggleWordCloudActionMenu: vi.fn(),
    toggleWordCloudCollapsed: vi.fn(),
    updateWordCloudField: vi.fn(),
    wordBagActionMenuId: ref<string | null>(null),
    wordCloudCardStyle: vi.fn(() => ({})),
  };

  workspacesViewContextMock = {
    addCloudDriveExposure: vi.fn(),
    applyCloudDriveSync: vi.fn(),
    busyKey: ref(""),
    cloudDriveConnectionOptions: ref([{ value: "drive-1", label: "Drive 1" }]),
    cloudDriveData: ref({
      connections: [
        {
          driveRef: "drive-1",
          provider: "icloud",
          mode: "contract",
          directoryMappingCount: 1,
          contractVerified: true,
        },
      ],
    }),
    cloudDriveForm: reactive({
      provider: "icloud",
      driveRef: "",
      rootPath: "/Users/me/Library/Mobile Documents",
      managedFolderRoot: "/Users/me/Pact",
      publicFolder: "/Users/me/Public",
      clientId: "client-a",
      allowedClients: "",
      path: "docs/report.txt",
      uploadPath: "uploads/report.txt",
      targetPath: "sync/report.txt",
      advancedMode: true,
      exposedDirectories: [],
      uploadContent: "hello",
    }),
    cloudDriveResult: ref(null),
    connectCloudDrive: vi.fn(),
    downloadCloudDriveFile: vi.fn(),
    listCloudDriveItems: vi.fn(),
    listCloudDrivePermissions: vi.fn(),
    panel: ref("drive"),
    planCloudDriveSync: vi.fn(),
    removeCloudDriveExposure: vi.fn(),
    selected: ref({ title: "项目云盘" }),
    uploadCloudDriveFile: vi.fn(),
  };

  agentRetrievalViewContextMock = {
    agentRetrievalForm: {
      agentExploreAgentOptions: ref([{ value: "agent-a", label: "Agent A" }]),
      agentExploreForm: reactive({
        query: "帮我检索",
        modelAlias: "agent-a",
        contextProfileId: "ctx-1",
        thinkingMode: "balanced",
        maxIterations: 3,
        limit: 5,
        temperature: 0.2,
        maxTokens: 1200,
        toolChoice: "auto",
      }),
      busyKey: ref(""),
      contextWindowOptionBarOptions: ref([{ value: "ctx-1", label: "上下文 1" }]),
      highlightedConfigTarget: ref(""),
      runKnowledgeAgentExplore: vi.fn(),
      selectedAgentExploreModel: ref({ enabled: true }),
      thinkingModeOptionBarOptions: ref([{ value: "balanced", label: "Balanced" }]),
    },
  };

  debugViewContextMock = {
    busyKey: ref(""),
    knowledgeConsole: ref({ available: true }),
    knowledgeRecallDebugForm: reactive({
      query: "",
      targetId: "kb-1",
      retrievalMode: "hybrid",
      keywordOnly: false,
      learningEnabled: true,
      explain: true,
    }),
    knowledgeRecallDebugGridStyle: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
    knowledgeRecallDebugModeOptionBarOptions: ref([{ value: "hybrid", label: "混合" }]),
    knowledgeRecallDebugRuns: ref([]),
    knowledgeRecallDebugTargetOptions: ref([{ value: "kb-1", label: "知识库 1" }]),
    knowledgeSourceState: ref({ summary: { totalCount: 2 } }),
    knowledgeStatus: ref("ready"),
    openAgentEvidencePreview: vi.fn(),
    runKnowledgeRecallDebugBatch: vi.fn(),
  };
}

beforeEach(() => {
  resetComponentMocks();
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function createBaseServerState(overrides: Partial<ServerConsoleState> = {}) {
  return {
    server: { runtimeId: "runtime-1" },
    runtime: { mountModules: { local: "v1" } },
    settings: {
      path: "/etc/settings",
      value: { schemaVersion: 1, modelLibraryAgents: [] },
    },
    discovery: { path: "/etc/discovery", value: { items: [] }, bootstrap: { default: true } },
    emailRules: { path: "/etc/email", rules: { inbound: true } },
    expertVocabulary: { path: "/etc/vocab", vocabulary: { terms: [] } },
    storage: { summary: { totalCount: 0 } },
    jobs: { summary: { totalCount: 0 }, items: [] },
    knowledgeConsole: { available: true, sources: { summary: { totalCount: 1 } } },
    ...overrides,
  } as ServerConsoleState;
}

function makeRun(query: string, overrides: Record<string, unknown> = {}) {
  return createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: () => ({
      modelAlias: "model-a",
      contextProfileId: "ctx-a",
      temperature: 0.2,
      maxTokens: 1200,
    }),
    ...overrides,
  });
}

describe("console-status-utils fragments", () => {
  it("covers the label and tone fallbacks", () => {
    expect(queueLifecycleTone("completed")).toBe("success");
    expect(queueLifecycleTone("awaiting_approval")).toBe("queued");
    expect(queueLifecycleTone("mystery")).toBe("neutral");
    expect(queueLifecycleLabel("completed_with_errors")).toBe("有错误");
    expect(queueLifecycleLabel("")).toBe("未知");

    expect(queueSourceLabel("function-self-check")).toBe("功能自检");
    expect(queueSourceLabel("")).toBe("队列监控");
    expect(processTypeLabel("daemon")).toBe("守护进程");
    expect(processTypeLabel("worker")).toBe("服务进程");

    expect(processRelationText({ description: "", services: ["api"], monitors: ["m1"], alerts: ["a1"] } as any)).toBe("服务：api；监控：m1；报警：a1");
    expect(processRelationText({ description: "fallback" } as any)).toBe("fallback");

    expect(queueLifecycleTone("missing")).toBe("danger");
    expect(maintenanceAgentStatusTone("completed_with_errors")).toBe("queued");
    expect(maintenanceAgentStatusLabel("rejected")).toBe("已拒绝");
    expect(backgroundProcessTone("stale")).toBe("warning");
    expect(backgroundProcessLabel("missing")).toBe("缺失");
    expect(clientRuntimeCoolingTone("hot")).toBe("running");
    expect(clientRuntimeCoolingLabel("cooled")).toBe("已冷却");
    expect(clientRuntimeReasonLabel("outside-warm-client-limit")).toBe("超出保温上限");
    expect(clientRuntimeTaskText({ taskTypes: [{ taskType: "index", count: 2 }] } as any)).toBe("index×2");
    expect(clientRuntimeSurfaceText({ surfaces: [{ surface: "api", count: 1 }] } as any)).toBe("api×1");
    expect(clientRuntimeHeatStyle({ heatPercent: 1 } as any)).toEqual({ "--heat": "4%" });
    expect(clientRuntimeHeatStyle({ heatPercent: 240 } as any)).toEqual({ "--heat": "100%" });
    expect(monitorAlertSeverityTone("critical")).toBe("failed");
    expect(monitorAlertSeverityLabel("info")).toBe("提示");
    expect(maintenanceAgentRiskLabel("read_only")).toBe("只读");
    expect(migrationTone("offline")).toBe("offline");
    expect(migrationProgress("bootstrap-only")).toBe(12);
    expect(analysisExecutionModeLabel("external")).toBe("外置模块");
  });
});

describe("console-state-event-reducer-controller fragments", () => {
  it("filters topics and handles event branches with fallback payloads", () => {
    const consoleState = ref(createBaseServerState());
    const knowledgeConsole = ref<{ sources?: unknown } | null>({ sources: { summary: { totalCount: 1 } } });
    const knowledgeSourceState = ref<unknown>(null);
    const discoveryDraftDirty = ref(false);
    const expertVocabularyDraftDirty = ref(false);
    const mountDraftDirty = ref(false);
    const rulesDraftDirty = ref(false);
    const settingsDraftDirty = ref(false);
    const uploadTraceEvents = ref<any[]>([]);
    const refreshKnowledgeConflicts = vi.fn();
    const refreshMaintenanceAgent = vi.fn();
    const refreshExpertRules = vi.fn();
    const applyMaintenanceAgentConfigFromEvent = vi.fn(() => true);
    const applyMaintenanceAgentStateFromConsoleState = vi.fn();
    const applyWordCloudEvent = vi.fn(() => true);
    const replaceSettingsDraftFromServer = vi.fn();
    const replaceDiscoveryDraftFromServer = vi.fn();
    const replaceMountDraftFromServer = vi.fn();
    const replaceRulesDraftFromServer = vi.fn();
    const replaceExpertVocabularyDraftFromServer = vi.fn();
    const upsertJobFromEvent = vi.fn(() => true);
    const removeJobFromEvent = vi.fn(() => true);

    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent,
      applyMaintenanceAgentStateFromConsoleState,
      applyWordCloudEvent,
      consoleState,
      discoveryDraftDirty,
      expertVocabularyDraftDirty,
      hasFeature: (featureId: string) => featureId !== "maintenance-agent-runbooks",
      knowledgeConsole,
      knowledgeSourceState,
      mountDraftDirty,
      normalizedSettingsFromServer: (value) => ({ ...value, normalized: true }),
      refreshExpertRules,
      refreshKnowledgeConflicts,
      refreshMaintenanceAgent,
      removeJobFromEvent,
      replaceDiscoveryDraftFromServer,
      replaceExpertVocabularyDraftFromServer,
      replaceMountDraftFromServer,
      replaceRulesDraftFromServer,
      replaceSettingsDraftFromServer,
      rulesDraftDirty,
      settingsDraftDirty,
      upsertJobFromEvent,
    });

    expect(controller.currentServerEventTopics()).toContain("knowledge.golden_rules");
    expect(controller.currentServerEventTopics()).not.toContain("maintenance.agent.config");

    expect(controller.applyServerEvent({ id: "evt-1", topic: "unknown.topic", payload: null } as ProtocolEvent)).toBe(false);
    expect(controller.applyServerEvent({ id: "evt-2", topic: "uploads.trace", payload: {} } as ProtocolEvent)).toBe(true);
    expect(controller.uploadTraceEvents.value).toHaveLength(1);
    expect(controller.applyServerEvent({ id: "evt-2", topic: "uploads.trace", payload: {} } as ProtocolEvent)).toBe(true);
    expect(controller.uploadTraceEvents.value).toHaveLength(1);

    expect(
      controller.applyServerEvent({
        id: "evt-3",
        topic: "system.console_state",
        payload: { state: createBaseServerState() },
      } as ProtocolEvent),
    ).toBe(true);
    expect(consoleState.value?.settings.value).toMatchObject({ normalized: true });
    expect(replaceSettingsDraftFromServer).toHaveBeenCalledTimes(1);
    expect(replaceDiscoveryDraftFromServer).toHaveBeenCalledTimes(1);
    expect(replaceMountDraftFromServer).toHaveBeenCalledWith({ local: "v1" });
    expect(replaceRulesDraftFromServer).toHaveBeenCalledTimes(1);
    expect(replaceExpertVocabularyDraftFromServer).toHaveBeenCalledTimes(1);

    expect(
      controller.applyServerEvent({
        id: "evt-4",
        topic: "jobs.job",
        payload: { job: { id: "job-1", status: "completed" } },
      } as ProtocolEvent),
    ).toBe(true);
    expect(upsertJobFromEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }));
    expect(refreshKnowledgeConflicts).toHaveBeenCalledWith({ silent: true });

    expect(
      controller.applyServerEvent({
        id: "evt-5",
        topic: "jobs.deleted",
        payload: { deletedJob: { id: "job-2" } },
      } as ProtocolEvent),
    ).toBe(true);
    expect(removeJobFromEvent).toHaveBeenCalledWith("job-2");

    expect(
      controller.applyServerEvent({
        id: "evt-6",
        topic: "knowledge.sources",
        payload: { state: { summary: { totalCount: 3 } } },
      } as ProtocolEvent),
    ).toBe(true);
    expect(knowledgeSourceState.value).toMatchObject({ summary: { totalCount: 3 } });
    expect(knowledgeConsole.value).toMatchObject({ sources: { summary: { totalCount: 3 } } });

    expect(
      controller.applyServerEvent({
        id: "evt-7",
        topic: "knowledge.word_clouds",
        payload: {},
      } as ProtocolEvent),
    ).toBe(false);
    expect(
      controller.applyServerEvent({
        id: "evt-8",
        topic: "knowledge.golden_rules",
        payload: {},
      } as ProtocolEvent),
    ).toBe(true);
    expect(refreshExpertRules).toHaveBeenCalledWith({ silent: true });

    expect(
      controller.applyServerEvent({
        id: "evt-9",
        topic: "maintenance.agent.config",
        payload: { config: {} },
      } as ProtocolEvent),
    ).toBe(true);
    applyMaintenanceAgentConfigFromEvent.mockReturnValueOnce(false);
    expect(
      controller.applyServerEvent({
        id: "evt-10",
        topic: "maintenance.agent.config",
        payload: { config: {} },
      } as ProtocolEvent),
    ).toBe(false);

    expect(
      controller.applyServerEvent({
        id: "evt-11",
        topic: "maintenance.agent.run.completed",
        payload: {},
      } as ProtocolEvent),
    ).toBe(true);
    expect(refreshMaintenanceAgent).toHaveBeenCalledWith({ silent: true });
  });
});

describe("console-info-feed-history-controller fragments", () => {
  it("sanitizes invalid model references when opening and clearing history", () => {
    const infoFeedAttachments = ref<any[]>([]);
    const infoFeedCurrentRun = ref<any | null>(null);
    const infoFeedForm = ref({
      query: "seed",
      modelAlias: "current-model",
      contextProfileId: "ctx-start",
      temperature: 0.2,
      maxTokens: 1200,
    });
    const infoFeedHistory = ref<any[]>([]);
    const infoFeedParentRunSnapshot = ref<any | null>({ runId: "parent" });

    const controller = createConsoleInfoFeedHistoryController({
      infoFeedAttachments,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedHistory,
      infoFeedParentRunSnapshot,
      storageKey: "test-info-feed-history",
      evidenceRefs: vi.fn(() => ["e-1"]),
      hasAgentModelOption: vi.fn((value?: string) => value !== "invalid-model"),
      summaryDefaults: () => ({
        modelAlias: "fallback-model",
        contextProfileId: "ctx-default",
        temperature: 0.2,
        maxTokens: 1200,
      }),
      validAgentModelAlias: (value?: string) => (value === "invalid-model" ? "fallback-model" : (value || "")),
    });

    const run = makeRun("查询", {});
    run.runId = "run-1";
    run.summary.modelAlias = "invalid-model";
    run.summary.contextProfileId = "ctx-selected";
    infoFeedHistory.value = [run];

    controller.openInfoFeedHistoryRun(run);
    expect(infoFeedParentRunSnapshot.value).toBeNull();
    expect(infoFeedCurrentRun.value?.runId).toBe("run-1");
    expect(infoFeedForm.value.modelAlias).toBe("fallback-model");
    expect(infoFeedForm.value.contextProfileId).toBe("ctx-selected");

    controller.clearInvalidInfoFeedModelReferences();
    expect(infoFeedHistory.value[0].summary.modelAlias).toBe("fallback-model");
  });
});

describe("console-info-feed-output-controller fragments", () => {
  it("reports empty copy/export states and formats the visible summary helpers", async () => {
    const run = makeRun("问题");
    run.runId = "run-1";
    run.summary.answer = "答案::e1";
    run.summary.status = "completed";
    run.followUp = { question: "补充问题" } as any;
    run.attachments = [{ name: "附件.txt", size: 128, status: "completed" } as any];

    const error = ref("");
    const infoFeedAgentAnswer = ref("agent::a1");
    const infoFeedCurrentRun = ref(run as any);
    const infoFeedForm = ref({ query: "表单问题", modelAlias: "", contextProfileId: "", temperature: 0.4, maxTokens: 1800 });
    const infoFeedKeywordItems = ref([{ evidenceId: "kw::1" }] as any[]);
    const infoFeedParentRunForCurrent = ref<any | null>({ summary: { answer: "parent::p1" } });
    const infoFeedSummaryStreamText = ref("");
    const infoFeedSummaryStreamTimer = ref<number | null>(null);

    const controller = createConsoleInfoFeedOutputController({
      error,
      infoFeedAgentAnswer,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedKeywordItems,
      infoFeedParentRunForCurrent,
      infoFeedRunEvidenceRefs: vi.fn(() => ["parent::p1"]),
      infoFeedSummaryStreamText,
      infoFeedSummaryStreamTimer,
      modelDisplayLabel: (value = "") => `模型-${value}`,
      recordFeedback: vi.fn(),
      selectedInfoFeedModel: ref({ value: "model-a" }),
    });

    expect(controller.infoFeedSummaryRuntime.value).toMatchObject({
      model: "模型-model-a",
      temperature: 0.4,
      maxTokens: 1800,
    });
    expect(controller.infoFeedCurrentUserQuestion(run as any)).toBe("补充问题");
    expect(controller.infoFeedUserCardTitle(run as any)).toBe("用户回复");
    expect(controller.infoFeedSummaryEvidenceRefs.value).toContain("kw::1");
    expect(controller.infoFeedParentSummaryEvidenceRefs.value).toEqual(["parent::p1"]);

    infoFeedCurrentRun.value = null;
    await controller.copyInfoFeedSummary();
    expect(error.value).toBe("暂无可复制的信息流总结。");
    controller.exportInfoFeedSummary();
    expect(error.value).toBe("暂无可导出的信息流总结。");
  });
});

describe("ExternalServicesView", () => {
  it("renders the summary counters and forwards panel actions", async () => {
    externalServicesControllerMock.configEditorOpen = true;
    externalServicesControllerMock.loadError = "加载失败";
    externalServicesControllerMock.actionError = "保存失败";
    externalServicesControllerMock.actionMessage = "已更新";
    externalServicesControllerMock.services = [];

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
      setup(props, { slots, emit }) {
        return () =>
          props.open
            ? h("section", { class: "config-panel-stub" }, [
                h("button", { class: "config-panel-verify", onClick: () => emit("verify") }, "verify"),
                h("button", { class: "config-panel-close", onClick: () => emit("close") }, "close"),
                slots.default?.(),
              ])
            : null;
      },
    });

    const wrapper = mount(ExternalServicesView, {
      global: {
        stubs: {
          ConfigFloatingPanel: ConfigFloatingPanelStub,
          HelpTooltip: true,
          StatusPill: true,
          BinaryCheckbox: true,
        },
      },
    });

    expect(wrapper.text()).toContain("已保存");
    expect(wrapper.text()).toContain("3");
    expect(wrapper.text()).toContain("服务发现");
    expect(wrapper.text()).toContain("MCP 工具");
    expect(wrapper.text()).toContain("加载失败");
    expect(wrapper.text()).toContain("保存失败");
    expect(wrapper.text()).toContain("已更新");

    await wrapper.find(".config-panel-verify").trigger("click");
    await wrapper.find(".config-panel-close").trigger("click");
    expect(externalServicesControllerMock.verifyConfig).toHaveBeenCalledTimes(1);
    expect(externalServicesControllerMock.closeConfigEditor).toHaveBeenCalledTimes(1);
  });
});

describe("KnowledgeDistillationWorkbench", () => {
  it("shows the empty card when no run is selected and forwards run actions", async () => {
    knowledgeDistillationWorkbenchMock.activeJobCompleted.value = true;
    knowledgeDistillationWorkbenchMock.canStart.value = true;
    knowledgeDistillationWorkbenchMock.selectedRun.value = null;
    knowledgeDistillationWorkbenchMock.runs.value = [];

    const wrapper = shallowMount(KnowledgeDistillationWorkbench, {
      props: {
        canReadKnowledge: true,
        canMaintainKnowledge: true,
        ingestJob: { id: "job-1", status: "completed" },
        normalizedManifest: { batchId: "batch-1" },
        formatCompactDate: (value: string) => value,
        modelOptions: [{ value: "model-a", label: "模型 A" }],
      },
    });

    expect(wrapper.text()).toContain("暂无知识蒸馏任务");
    expect(wrapper.text()).toContain("开始蒸馏");

    knowledgeDistillationWorkbenchMock.selectedRun.value = {
      runId: "run-1",
      title: "任务 1",
      status: "running",
      stages: [{ stageId: "stage-1", status: "running", progressPercent: 50 }],
    };
    knowledgeDistillationWorkbenchMock.runs.value = [knowledgeDistillationWorkbenchMock.selectedRun.value];
    await wrapper.setProps({ ingestJob: { id: "job-1", status: "completed" } });
    await nextTick();

    await wrapper.find("button.primary-action").trigger("click");
    expect(knowledgeDistillationWorkbenchMock.startWorkbenchRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("任务 1");
  });
});

describe("SourcesAddDataSourceDialog", () => {
  it("renders the local directory branch and emits close/submit", async () => {
    const wrapper = shallowMount(SourcesAddDataSourceDialog, {
      props: {
        open: true,
        selectedType: "localDirectory",
      },
      global: {
        stubs: {
          Teleport: true,
          BinaryCheckbox: true,
          BrowseSelectButton: true,
        },
      },
    });

    expect(wrapper.text()).toContain("添加数据源");
    expect(wrapper.text()).toContain("目录名称");
    expect(wrapper.text()).toContain("添加数据源");

    await wrapper.find("input[placeholder='/Users/you/Documents/Knowledge']").setValue("/tmp/project");
    expect(sourcesViewContextMock.syncLocalSourceLabelFromPath).toHaveBeenCalledTimes(1);

    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("submit")).toHaveLength(1);
    await wrapper.find("button[aria-label='关闭']").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("renders the client branch and switches footer text", () => {
    const wrapper = shallowMount(SourcesAddDataSourceDialog, {
      props: {
        open: true,
        selectedType: "client",
      },
      global: {
        stubs: {
          Teleport: true,
          BinaryCheckbox: true,
          BrowseSelectButton: true,
        },
      },
    });

    expect(wrapper.text()).toContain("客户端接入");
    expect(wrapper.text()).toContain("查看客户端");
  });
});

describe("WordCloudClassCard", () => {
  it("handles focus, menu actions, pinning, and child navigation", async () => {
    wordCloudContextMock.wordBagActionMenuId.value = "bag-1";
    const row = {
      cloud: {
        wordBagId: "bag-1",
        label: "词袋 1",
        terms: [{ term: "alpha", frequency: 1 }],
        children: [{ wordBagId: "child-1", label: "子词袋" }],
      },
    };

    const wrapper = shallowMount(WordCloudClassCard, {
      props: {
        index: 0,
        row,
      },
    });

    expect(wrapper.find(".word-cloud-class-card").classes()).toContain("active");
    await wrapper.find(".word-cloud-class-card").trigger("click");
    expect(wordCloudContextMock.selectWordCloud).toHaveBeenCalledWith(row.cloud);
    expect(wordCloudContextMock.toggleWordCloudCollapsed).toHaveBeenCalledWith("bag-1");

    const titleInput = wrapper.find(".word-cloud-card-title-input");
    await titleInput.trigger("focus");
    await titleInput.setValue("重命名");
    expect(wordCloudContextMock.updateWordCloudField).toHaveBeenCalledWith("bag-1", "label", "重命名");

    await wrapper.find(".word-cloud-title-confirm-btn").trigger("click");
    expect(wordCloudContextMock.autoFillCloudWithAgent).toHaveBeenCalledWith("bag-1");

    await wrapper.find(".word-cloud-corner-btn").trigger("click");
    expect(wordCloudContextMock.pinWordCloud).toHaveBeenCalledWith("bag-1");

    await wrapper.find(".word-cloud-corner-add-btn").trigger("click");
    expect(wordCloudContextMock.toggleWordCloudActionMenu).toHaveBeenCalledWith("bag-1");

    await wrapper.find(".word-cloud-child-tag").trigger("click");
    expect(wordCloudContextMock.jumpToCloud).toHaveBeenCalledWith("child-1");
  });
});

describe("WorkspaceCloudDrivePanel", () => {
  it("renders the cloud drive form and forwards operations", async () => {
    const wrapper = shallowMount(WorkspaceCloudDrivePanel);

    expect(wrapper.text()).toContain("云盘");
    expect(wrapper.text()).toContain("暂无目录。");
    expect(wrapper.text()).toContain("已连接云盘");

    await wrapper.find("button").trigger("click");
    expect(workspacesViewContextMock.addCloudDriveExposure).toHaveBeenCalledTimes(1);

    await wrapper.findAll("button")[1].trigger("click");
    expect(workspacesViewContextMock.connectCloudDrive).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("iCloud");
  });
});

describe("AgentRetrievalForm", () => {
  it("submits the form and respects the busy state", async () => {
    const wrapper = shallowMount(AgentRetrievalForm);

    expect(wrapper.text()).toContain("开始检索");
    await wrapper.find("form").trigger("submit.prevent");
    expect(agentRetrievalViewContextMock.agentRetrievalForm.runKnowledgeAgentExplore).toHaveBeenCalledTimes(1);

    agentRetrievalViewContextMock.agentRetrievalForm.busyKey.value = "knowledge:agent-explore";
    await nextTick();
    expect(wrapper.text()).toContain("检索中");
  });
});

describe("KnowledgeRecallDebugPanel", () => {
  it("renders the empty and populated run states", async () => {
    const wrapper = shallowMount(KnowledgeRecallDebugPanel);

    expect(wrapper.text()).toContain("知识召回");
    expect(wrapper.text()).toContain("执行召回");
    expect(wrapper.find("button[type='submit']").attributes("disabled")).toBeDefined();

    debugViewContextMock.knowledgeRecallDebugForm.query = "HSBC 账单";
    debugViewContextMock.knowledgeRecallDebugRuns.value = [
      {
        runId: "run-1",
        label: "运行中",
        status: "running",
        elapsedMs: 120,
        items: [],
        response: { fusion: { mode: "server-index-only", localHitCount: 0, localMergedCount: 0, localAppendedCount: 0 } },
      },
      {
        runId: "run-2",
        label: "失败",
        status: "failed",
        elapsedMs: 220,
        items: [],
        error: "召回失败",
      },
      {
        runId: "run-3",
        label: "完成",
        status: "completed",
        elapsedMs: 320,
        items: [],
      },
    ];
    await nextTick();

    expect(wrapper.find("button[type='submit']").attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("正在召回。");
    expect(wrapper.text()).toContain("召回失败");
    expect(wrapper.text()).toContain("没有召回结果。");

    await wrapper.find("form").trigger("submit.prevent");
    expect(debugViewContextMock.runKnowledgeRecallDebugBatch).toHaveBeenCalledTimes(1);
  });
});
