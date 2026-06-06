// @vitest-environment jsdom
import { computed, ref, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleDashboardAlertInboxController } from "../../../server-web/composables/console-dashboard-alert-inbox-controller";
import { createConsoleModelModuleAssignmentController } from "../../../server-web/composables/console-model-module-assignment-controller";
import { createConsoleModelProbeController } from "../../../server-web/composables/console-model-probe-controller";
import { intelligentModuleDefinitions } from "../../../server-web/composables/console-defaults";
import type { AgentModelConfig, AgentSettings, ModelProbeResponse } from "../../../server-web/lib/types";

const agentSettingsClientMock = vi.hoisted(() => ({
  probeModel: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  probeModel: agentSettingsClientMock.probeModel,
}));

beforeEach(() => {
  vi.clearAllMocks();
  agentSettingsClientMock.probeModel.mockReset();
});

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
  };
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

function makeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    tikaJarPath: "",
    javaBinPath: "",
    tikaTimeoutMs: 1800000,
    modelIntelligenceEnabled: true,
    googleApiKey: "",
    googleApiKeyConfigured: false,
    googleModel: "gemini-1.5",
    openAiModel: "gpt-4.1-mini",
    defaultModelProvider: "",
    defaultModel: "",
    modelLibraryEntries: [],
    modelLibraryAgents: [],
    agentPermissionGroups: [],
    agentExploreDefaults: {
      systemPrompt: "",
      toolPolicyPrompt: "",
      continuationPrompt: "",
      answerTemplate: "",
      contextProfileId: "",
      thinkingMode: "",
      temperature: 0,
      maxTokens: 0,
      maxIterations: 0,
      limit: 0,
      toolChoice: "auto",
    },
    agentToolExecution: {
      http: {
        enabled: true,
        allowedHosts: [],
        timeoutMs: 30000,
        maxResponseBytes: 65536,
      },
      local: {
        enabled: true,
        allowDirectCommands: false,
        timeoutMs: 30000,
        maxOutputBytes: 65536,
        commands: [],
      },
    },
    moduleModelAssignments: {},
    moduleAgentProfiles: {},
    moduleIntelligence: {},
    openRouterApiKey: "",
    openRouterApiKeyConfigured: false,
    openRouterBaseUrl: "",
    openRouterModel: "",
    deepSeekApiKey: "",
    deepSeekApiKeyConfigured: false,
    deepSeekBaseUrl: "https://api.deepseek.com",
    deepSeekModel: "deepseek-v3",
    deepSeekTimeoutMs: 120000,
    copilotEndpoint: "",
    copilotApiKey: "",
    copilotApiKeyConfigured: false,
    copilotModel: "",
    localModelEndpoint: "",
    localModelName: "",
    customModelAlias: "",
    customModelLabel: "",
    customModelApiKey: "",
    customModelApiKeyConfigured: false,
    customHttpAdapter: {
      alias: "",
      url: "",
      token: "",
      tokenConfigured: false,
      tokenHeader: "token",
      tokenPrefix: "",
      agentName: "",
      pluginList: [],
      engine: "",
      parameters: {},
      timeoutMs: 120000,
    },
    customHttpAdapters: [],
    analysisModuleId: "",
    ocrEnabled: false,
    ocrPythonPath: "",
    ocrLanguage: "",
    retrievalHalfLifeDays: 0,
    staleAfterDays: 0,
    transactionWindowDays: 0,
    ...overrides,
  };
}

function makeDashboardAlertController() {
  const activeMonitorAlerts = ref([
    {
      alertId: "monitor.supervisor.stopped",
      ruleId: "supervisorStopped",
      severity: "critical",
      title: "Supervisor stopped",
      message: "background supervisor stopped",
      source: "monitor",
      role: "background-supervisor",
      status: "open",
      active: true,
      ackRequired: false,
      firstSeenAt: "2026-06-04T00:00:00.000Z",
      lastSeenAt: "2026-06-04T00:00:00.000Z",
    },
    {
      alertId: "monitor.process.background-supervisor.stale",
      ruleId: "processStale",
      severity: "warning",
      title: "Supervisor stale",
      message: "heartbeat late",
      source: "monitor",
      role: "background-supervisor",
      status: "recovered",
      active: true,
      ackRequired: true,
      queueId: "queue-99",
      firstSeenAt: "2026-06-03T00:00:00.000Z",
      lastSeenAt: "2026-06-04T00:00:00.000Z",
    },
    {
      alertId: "monitor.process.import-worker.interrupted",
      ruleId: "importWorkerInterrupted",
      severity: "warning",
      title: "Import worker interrupted",
      message: "import paused",
      source: "monitor",
      role: "import-worker",
      status: "open",
      active: true,
      ackRequired: false,
      firstSeenAt: "2026-06-02T00:00:00.000Z",
      lastSeenAt: "2026-06-04T00:00:00.000Z",
    },
  ] as any);
  const agentConfigurationAlerts = ref([
    {
      alertId: "config-1",
      category: "空配置报警",
      title: "Agent config missing",
      detail: "needs setup",
      status: "未配置",
      tone: "danger",
      view: "admin",
      targetId: "agent-config",
    },
  ] as any);
  const backgroundProcesses = ref([
    {
      role: "background-supervisor",
      status: "running",
      alive: true,
      desired: true,
    },
    {
      role: "import-worker",
      status: "running",
      alive: true,
      desired: false,
    },
  ] as any);
  const error = ref("");
  const openAdmin = vi.fn();
  const openAgentConfigurationAlert = vi.fn().mockResolvedValue(undefined);
  const refreshMonitorAlerts = vi.fn().mockResolvedValue(undefined);
  const acknowledgeMonitorAlert = vi.fn().mockResolvedValue(undefined);
  const recoverBackgroundSupervisor = vi.fn().mockResolvedValue(undefined);

  const controller = createConsoleDashboardAlertInboxController({
    acknowledgeMonitorAlert,
    activeMonitorAlerts: computed(() => activeMonitorAlerts.value),
    agentConfigurationAlerts: computed(() => agentConfigurationAlerts.value),
    backgroundProcesses: computed(() => backgroundProcesses.value),
    error,
    openAdmin,
    openAgentConfigurationAlert,
    refreshMonitorAlerts,
    recoverBackgroundSupervisor,
  });

  return {
    ...controller,
    acknowledgeMonitorAlert,
    activeMonitorAlerts,
    agentConfigurationAlerts,
    backgroundProcesses,
    error,
    openAdmin,
    openAgentConfigurationAlert,
    refreshMonitorAlerts,
    recoverBackgroundSupervisor,
  };
}

function makeProbeController(overrides: Partial<{
  visibleModelEntries: Ref<AgentModelConfig[]>;
  modelProbeResults: Ref<Record<string, ModelProbeResponse>>;
  settingsPayloadForSave: () => AgentSettings;
}> = {}) {
  const error = ref("");
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();
  const modelProbeResults = overrides.modelProbeResults || ref<Record<string, ModelProbeResponse>>({});
  const visibleModelEntries =
    overrides.visibleModelEntries ||
    ref<AgentModelConfig[]>([
      makeModelConfig({
        provider: "google-gemini",
        instanceId: "gemini-agent",
        alias: "gemini-agent",
        label: "Gemini Agent",
        model: "gemini-2.0",
        apiKeyConfigured: true,
      }),
      makeModelConfig({
        provider: "custom-http",
        instanceId: "custom-agent",
        alias: "custom-agent",
        label: "Custom Adapter",
        model: "custom-engine",
        url: "https://example.test/api",
        token: "secret",
        tokenConfigured: true,
        tokenHeader: "x-token",
        tokenPrefix: "Bearer",
        pluginList: ["alpha"],
        parametersText: "{\"top_p\": 0.9}",
      }),
      makeModelConfig({
        provider: "openai-chatgpt",
        instanceId: "openai-agent",
        alias: "openai-agent",
        label: "OpenAI Agent",
        model: "gpt-4.1-mini",
      }),
    ]);
  const settingsPayloadForSave = overrides.settingsPayloadForSave || (() => makeSettings());

  return {
    ...createConsoleModelProbeController({
      clearAllBusy,
      error,
      modelEntryConfigured: (entry) => Boolean(entry.model && entry.provider !== "unconfigured"),
      modelEntryStatusKey: (entry) => entry.model,
      modelProbeResults,
      providerConfigured: (provider) => provider !== "unknown-provider",
      setBusy,
      settingsPayloadForSave,
      visibleModelEntries,
    }),
    clearAllBusy,
    error,
    modelProbeResults,
    setBusy,
    visibleModelEntries,
  };
}

function makeModuleAssignmentController(overrides: Partial<{
  visibleModelEntries: Ref<AgentModelConfig[]>;
  settingsDraft: Ref<AgentSettings>;
}> = {}) {
  const moduleAgentCandidateDrafts = ref<Record<string, string>>({
    knowledgeTaxonomy: "openai-chatgpt:draft-agent",
  });
  const settingsDraft =
    overrides.settingsDraft ||
    ref(makeSettings({
      moduleModelAssignments: {
        graphInsight: { provider: "openai-chatgpt", model: "gpt-4.1-mini" },
      },
      moduleAgentProfiles: {
        graphInsight: {
          primaryAgent: "gpt-4.1-mini",
          agents: {
            "gpt-4.1-mini": {
              enabled: true,
              role: "primary",
              contextProfileId: "ctx",
              systemPrompt: "",
              parameters: {},
              dependencyContext: {},
            },
            "assistant-one": {
              enabled: false,
              role: "assistant",
              contextProfileId: "ctx",
              systemPrompt: "",
              parameters: {},
              dependencyContext: {},
            },
          },
        },
      },
      moduleIntelligence: {
        graphInsight: true,
        knowledgeTaxonomy: true,
        localOcr: false,
      },
    }));
  const visibleModelEntries =
    overrides.visibleModelEntries ||
    ref<AgentModelConfig[]>([
      makeModelConfig({
        provider: "openai-chatgpt",
        instanceId: "openai-agent",
        alias: "openai-agent",
        label: "OpenAI Agent",
        model: "gpt-4.1-mini",
      }),
      makeModelConfig({
        provider: "google-gemini",
        instanceId: "gemini-agent",
        alias: "gemini-agent",
        label: "Gemini Agent",
        model: "gemini-2.0",
        moduleAccess: { mode: "selected", moduleIds: ["graphInsight"] },
      }),
    ]);
  const ensureCodexOAuthReady = vi.fn().mockResolvedValue(true);
  const parseModelRef = vi.fn((refValue: string) => {
    const [provider, model] = String(refValue).split(":", 2);
    return { provider: provider as any, model };
  });
  const modelRef = vi.fn((provider: string, model: string) => `${provider}:${model}`);
  const controller = createConsoleModelModuleAssignmentController({
    agentExploreModelOptionLabel: (entry) => `${entry.label} / ${entry.model}`,
    currentAgentModelOptionLabel: (value) => value ? `current:${value}` : "",
    ensureCodexOAuthReady,
    modelEntryConfigured: (entry) => Boolean(entry.model),
      modelEntryStatusKey: (entry) => entry.model,
    modelRef,
    moduleAgentCandidateDrafts,
    parseModelRef,
    settingsDraft,
    visibleModelEntries,
  });
  return {
    ...controller,
    ensureCodexOAuthReady,
    modelAgentCandidateDrafts: moduleAgentCandidateDrafts,
    modelRef,
    parseModelRef,
    settingsDraft,
    visibleModelEntries,
  };
}

describe("createConsoleDashboardAlertInboxController", () => {
  it("derives live alerts, summary, and queues from monitor and configuration state", () => {
    const controller = makeDashboardAlertController();

    expect(controller.liveDashboardAlerts.value).toHaveLength(4);
    expect(controller.liveDashboardAlerts.value[0]).toMatchObject({
      alertId: "monitor.supervisor.stopped",
      category: "后台报警",
      actionLabel: "拉起进程",
      actionKind: "recover-supervisor",
      tone: "danger",
    });
    expect(controller.liveDashboardAlerts.value[1]).toMatchObject({
      alertId: "monitor.process.background-supervisor.stale",
      category: "后台报警",
      status: "已恢复，待确认",
      tone: "success",
      detail: "heartbeat late 队列 ID：queue-99",
    });
    expect(controller.liveDashboardAlerts.value[2]).toMatchObject({
      alertId: "monitor.process.import-worker.interrupted",
      category: "后台报警",
      tone: "warning",
    });

    controller.syncDashboardAlertInbox(controller.liveDashboardAlerts.value);

    expect(controller.dashboardAlertCounts.value).toEqual({
      total: 4,
      danger: 2,
      warning: 1,
      recovered: 1,
      configuration: 1,
      monitor: 3,
    });
    expect(controller.dashboardAlertSummary.value).toBe("2 项严重，1 项警告，1 项已恢复待确认");
    expect(controller.dashboardPrimaryAlert.value?.alertId).toBe("monitor.supervisor.stopped");
    expect(controller.dashboardMonitorQueue.value.map((item) => item.alertId)).toEqual([
      "monitor.process.import-worker.interrupted",
      "monitor.process.background-supervisor.stale",
    ]);
    expect(controller.dashboardConfigurationQueue.value.map((item) => item.alertId)).toEqual(["config-1"]);
    expect(controller.dashboardSecondaryAlerts.value).toHaveLength(3);
  });

  it("opens, recovers, and dismisses alerts through the correct async branch", async () => {
    const controller = makeDashboardAlertController();
    controller.syncDashboardAlertInbox(controller.liveDashboardAlerts.value);

    const configAlert = controller.liveDashboardAlerts.value.find((item) => item.source === "configuration")!;
    await controller.openDashboardAlert(configAlert);
    expect(controller.openAgentConfigurationAlert).toHaveBeenCalledWith(configAlert.configAlert);
    expect(controller.openAdmin).not.toHaveBeenCalled();

    const supervisorAlert = controller.liveDashboardAlerts.value[0];
    await controller.openDashboardAlert(supervisorAlert);
    expect(controller.recoverBackgroundSupervisor).toHaveBeenCalledTimes(1);
    expect(controller.refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
    expect(controller.openAdmin).not.toHaveBeenCalled();

    const dismissTarget = controller.liveDashboardAlerts.value[1];
    await controller.dismissDashboardAlert(dismissTarget);
    expect(controller.acknowledgeMonitorAlert).toHaveBeenCalledWith(dismissTarget.alertId);
    expect(controller.dismissedDashboardAlertIds.value.has(`${dismissTarget.source}:${dismissTarget.alertId}`)).toBe(true);
    expect(controller.dashboardAlertInbox.value[`${dismissTarget.source}:${dismissTarget.alertId}`]).toBeUndefined();

    const ackFailureController = makeDashboardAlertController();
    ackFailureController.syncDashboardAlertInbox(ackFailureController.liveDashboardAlerts.value);
    ackFailureController.error.value = "cannot acknowledge";
    const ackTarget = ackFailureController.liveDashboardAlerts.value[1];
    await ackFailureController.dismissDashboardAlert(ackTarget);
    expect(ackFailureController.dismissedDashboardAlertIds.value.has(`${ackTarget.source}:${ackTarget.alertId}`)).toBe(false);
    expect(ackFailureController.dashboardAlertInbox.value[`${ackTarget.source}:${ackTarget.alertId}`]).toBeDefined();
  });

  it("drops resolved monitor alerts when the backing process is healthy", () => {
    const controller = makeDashboardAlertController();
    controller.syncDashboardAlertInbox(controller.liveDashboardAlerts.value);
    expect(controller.dashboardAlertInbox.value["monitor:monitor.process.import-worker.interrupted"]).toBeDefined();

    controller.activeMonitorAlerts.value = [];
    controller.backgroundProcesses.value = [
      { role: "background-supervisor", status: "running", alive: true, desired: true },
      { role: "import-worker", status: "running", alive: true, desired: false },
    ] as any;
    controller.syncDashboardAlertInbox(controller.liveDashboardAlerts.value);

    expect(controller.dashboardAlertInbox.value["monitor:monitor.process.import-worker.interrupted"]).toBeUndefined();
  });
});

describe("createConsoleModelProbeController", () => {
  it("builds provider-specific probe payloads and clears busy state on success", async () => {
    const controller = makeProbeController();
    agentSettingsClientMock.probeModel.mockResolvedValueOnce(makeProbeResponse({ provider: "custom-http", model: "custom-engine" }));

    const customEntry = controller.visibleModelEntries.value[1];
    expect(controller.modelProbeSettingsForEntry(customEntry)).toMatchObject({
      customModelAlias: "custom-engine",
      customModelLabel: "Custom Adapter",
      customHttpAdapter: {
        alias: "custom-engine",
        label: "Custom Adapter",
        url: "https://example.test/api",
        token: "secret",
        tokenConfigured: true,
        tokenHeader: "x-token",
        tokenPrefix: "Bearer",
        agentName: "Custom Adapter",
        engine: "custom-engine",
        pluginList: ["alpha"],
        parameters: { top_p: 0.9 },
        timeoutMs: 120000,
      },
      customHttpAdapters: [
        expect.objectContaining({
          alias: "custom-engine",
        }),
      ],
    });

    await controller.probeModelEntry(customEntry);

    expect(agentSettingsClientMock.probeModel).toHaveBeenCalledWith({
      provider: "custom-http",
      modelAlias: "custom-engine",
      settings: expect.objectContaining({
        customModelAlias: "custom-engine",
        customModelLabel: "Custom Adapter",
      }),
    });
    expect(controller.setBusy).toHaveBeenCalledWith("model-probe:custom-engine");
    expect(controller.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(controller.error.value).toBe("");
    expect(controller.modelProbeResults.value["custom-engine"]).toMatchObject({
      ok: true,
      provider: "custom-http",
      model: "custom-engine",
    });
    expect(controller.modelEntryProbeStatusLabel(customEntry)).toBe("探测通过");
    expect(controller.modelEntryProbeStatusTone(customEntry)).toBe("success");
  });

  it("stores a failure result for unconfigured entries without calling the client", async () => {
    const controller = makeProbeController({
      visibleModelEntries: ref([
        makeModelConfig({
          provider: "google-gemini",
          instanceId: "broken",
          alias: "broken",
          label: "Broken",
          model: "",
        }),
      ]),
    });

    const entry = controller.visibleModelEntries.value[0];
    await controller.probeModelEntry(entry);

    expect(agentSettingsClientMock.probeModel).not.toHaveBeenCalled();
    expect(controller.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(controller.modelProbeResults.value[""]).toMatchObject({
      ok: false,
      configured: false,
      provider: "google-gemini",
      message: "模型配置不完整，未执行远程探测。",
    });
    expect(controller.modelEntryProbeStatusLabel(entry)).toBe("探测失败");
    expect(controller.modelEntryProbeStatusTone(entry)).toBe("danger");
  });

  it("records probe failures from client errors for both entry and provider calls", async () => {
    const controller = makeProbeController();
    agentSettingsClientMock.probeModel
      .mockRejectedValueOnce(new Error("entry probe failed"))
      .mockRejectedValueOnce(new Error("provider probe failed"));

    const entry = controller.visibleModelEntries.value[0];
    await controller.probeModelEntry(entry);

    expect(controller.error.value).toBe("entry probe failed");
    expect(controller.modelProbeResults.value["gemini-2.0"]).toMatchObject({
      ok: false,
      provider: "google-gemini",
      message: "entry probe failed",
    });
    await controller.probeModel("google-gemini" as any);

    expect(controller.error.value).toBe("provider probe failed");
    expect(controller.modelProbeResults.value["google-gemini"]).toMatchObject({
      ok: false,
      provider: "google-gemini",
      message: "provider probe failed",
    });
    expect(controller.providerStatusLabel("google-gemini")).toBe("探测失败");
    expect(controller.providerStatusTone("google-gemini")).toBe("danger");
  });

  it("collects before-save failures and refreshes all probe results", async () => {
    const controller = makeProbeController();
    agentSettingsClientMock.probeModel
      .mockResolvedValueOnce(makeProbeResponse({ provider: "google-gemini", model: "gemini-2.0" }))
      .mockRejectedValueOnce(new Error("custom probe failed"))
      .mockResolvedValueOnce(makeProbeResponse({ provider: "openai-chatgpt", model: "gpt-4.1-mini" }));

    const failures = await controller.probeModelLibraryBeforeSave();

    expect(failures).toHaveLength(1);
    expect(failures[0].entry.provider).toBe("custom-http");
    expect(controller.modelProbeResults.value["gemini-2.0"]).toMatchObject({ ok: true });
    expect(controller.modelProbeResults.value["custom-engine"]).toMatchObject({
      ok: false,
      message: "custom probe failed",
    });
    expect(controller.modelProbeResults.value["gpt-4.1-mini"]).toMatchObject({ ok: true });
  });
});

describe("createConsoleModelModuleAssignmentController", () => {
  it("computes assignment options and module access filtering", async () => {
    const controller = makeModuleAssignmentController();

    expect(controller.agentModelAssignmentOptions.value).toEqual([
      expect.objectContaining({
        provider: "openai-chatgpt",
        value: "gpt-4.1-mini",
        ref: "openai-chatgpt:gpt-4.1-mini",
        enabled: true,
      }),
      expect.objectContaining({
        provider: "google-gemini",
        value: "gemini-2.0",
        ref: "google-gemini:gemini-2.0",
        enabled: true,
      }),
    ]);
    expect(controller.modelEntryAllowsModule(controller.visibleModelEntries.value[1], "graphInsight")).toBe(true);
    expect(controller.modelEntryAllowsModule(controller.visibleModelEntries.value[1], "timelineDistillation")).toBe(false);

    controller.setModelEntryModuleAccessMode(controller.visibleModelEntries.value[1], "selected");
    controller.toggleModelEntryModuleAccess(controller.visibleModelEntries.value[1], "timelineDistillation", true);
    expect(controller.modelEntryAllowsModule(controller.visibleModelEntries.value[1], "timelineDistillation")).toBe(true);
    controller.toggleModelEntryModuleAccess(controller.visibleModelEntries.value[1], "timelineDistillation", false);
    expect(controller.modelEntryAllowsModule(controller.visibleModelEntries.value[1], "timelineDistillation")).toBe(false);
  });

  it("binds a module to a model ref, normalizes profiles, and enables intelligence", async () => {
    const controller = makeModuleAssignmentController();

    controller.setModuleModelRef("graphInsight", "openai-chatgpt:gpt-4.1-mini");

    expect(controller.settingsDraft.value.moduleModelAssignments.graphInsight).toEqual({
      provider: "openai-chatgpt",
      model: "gpt-4.1-mini",
    });
    expect(controller.settingsDraft.value.moduleAgentProfiles.graphInsight.primaryAgent).toBe("gpt-4.1-mini");
    expect(controller.settingsDraft.value.moduleAgentProfiles.graphInsight.agents["gpt-4.1-mini"]).toMatchObject({
      enabled: true,
      role: "primary",
    });
    expect(controller.settingsDraft.value.moduleIntelligence.graphInsight).toBe(true);
    expect(controller.ensureCodexOAuthReady).toHaveBeenCalledWith(true);
    expect(controller.moduleModelRef("graphInsight")).toBe("openai-chatgpt:gpt-4.1-mini");
    expect(controller.moduleNeedsIntelligence("graphInsight")).toBe(true);
    expect(controller.hasOpenAiModelUsage()).toBe(true);

    controller.setModuleModelRef("knowledgeTaxonomy", "");
    expect(controller.settingsDraft.value.moduleModelAssignments.knowledgeTaxonomy).toBeUndefined();
    expect(controller.settingsDraft.value.moduleIntelligence.knowledgeTaxonomy).toBe(false);
  });

  it("supports profile row management, draft addition, and assignment stats", () => {
    const controller = makeModuleAssignmentController();

    expect(controller.ensureModuleAgentProfile("graphInsight", "   ")).toBeNull();
    expect(controller.moduleAgentProfileRows("graphInsight")).toEqual([
      expect.objectContaining({
        agentId: "gpt-4.1-mini",
        label: "OpenAI Agent / gpt-4.1-mini",
        isPrimary: true,
      }),
      expect.objectContaining({
        agentId: "assistant-one",
        label: "current:assistant-one",
        isPrimary: false,
      }),
    ]);

    controller.setModuleAgentProfileEnabled("graphInsight", "assistant-one", true);
    expect(controller.settingsDraft.value.moduleAgentProfiles.graphInsight.agents["assistant-one"].enabled).toBe(true);

    controller.addModuleAgentProfileFromDraft("knowledgeTaxonomy");
    expect(controller.modelAgentCandidateDrafts.value.knowledgeTaxonomy).toBe("");
    expect(controller.settingsDraft.value.moduleAgentProfiles.knowledgeTaxonomy.agents["draft-agent"]).toMatchObject({
      role: "assistant",
      enabled: true,
    });

    controller.removeModuleAgentProfile("graphInsight", "gpt-4.1-mini");
    expect(controller.settingsDraft.value.moduleModelAssignments.graphInsight).toBeUndefined();
    expect(controller.settingsDraft.value.moduleAgentProfiles.graphInsight.primaryAgent).toBe("");

    expect(controller.moduleModelAssignmentStats.value).toEqual({
      assigned: 0,
      enabled: 4,
      total: intelligentModuleDefinitions.length,
    });
  });
});
