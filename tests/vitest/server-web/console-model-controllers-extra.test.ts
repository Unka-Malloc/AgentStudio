import { computed, ref, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleModelLibraryController } from "../../../server-web/composables/console-model-library-controller";
import { createConsoleModelRepositoryController } from "../../../server-web/composables/console-model-repository-controller";
import { modelLibraryProviderDefinitions } from "../../../server-web/composables/console-defaults";
import type { AgentModelConfig, AgentSettings, ModelProbeResponse } from "../../../server-web/lib/types";
import type { CloudProvider } from "../../../server-web/types/app";

const agentSettingsClientMock = vi.hoisted(() => ({
  probeModel: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  probeModel: agentSettingsClientMock.probeModel,
  saveSettings: agentSettingsClientMock.saveSettings,
}));

function makeModel(overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return {
    uid: "agent-1",
    instanceId: "agent-1",
    provider: "google-gemini",
    alias: "agent-1",
    label: "Gemini 1",
    baseUrl: "",
    url: "",
    model: "gemini-1.5",
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
    latencyMs: 88,
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

function createLibraryFixture(overrides: {
  settingsDraft?: Ref<AgentSettings>;
  selectedModelProvider?: Ref<CloudProvider>;
  visibleEntries?: AgentModelConfig[];
  codexOAuthValid?: boolean;
} = {}) {
  const error = ref("seed");
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();
  const modelLibraryExpandedCards = ref<Record<string, boolean>>({});
  const modelProbeResults = ref<Record<string, ModelProbeResponse>>({});
  const moduleAgentCandidateDrafts = ref<Record<string, string>>({});
  const settingsDraft =
    overrides.settingsDraft ||
    ref(
      makeSettings({
        modelLibraryEntries: [" google-gemini ", "invalid-provider", "deepseek", "google-gemini", "local-model"],
        modelLibraryAgents: overrides.visibleEntries || [
          makeModel({
            provider: "google-gemini",
            uid: "gem-1",
            instanceId: "gem-1",
            alias: "gem-1",
            label: "Gemini Primary",
            model: "gemini-2.0",
            apiKeyConfigured: true,
          }),
          makeModel({
            provider: "custom-http",
            uid: "custom-1",
            instanceId: "custom-1",
            alias: "custom-1",
            label: "Custom Adapter",
            model: "custom-engine",
            url: "https://example.test/api",
            token: "secret",
            tokenConfigured: true,
            tokenHeader: "x-token",
            tokenPrefix: "Bearer",
            pluginList: ["alpha"],
            parametersText: "{\"top_p\":0.9}",
          }),
        ],
        deepSeekApiKeyConfigured: true,
        deepSeekApiKey: "deepseek-key",
        deepSeekTimeoutMs: 777,
        googleApiKeyConfigured: true,
        googleApiKey: "google-key",
        customModelAlias: "alpha-model",
        customModelLabel: "Alpha Label",
        customHttpAdapter: {
          alias: "fallback-alias",
          label: "Fallback Label",
          url: "https://example.test/api",
          token: "secret",
          tokenConfigured: true,
          tokenHeader: "token",
          tokenPrefix: "",
          agentName: "",
          pluginList: [],
          engine: "",
          parameters: {},
          timeoutMs: 120000,
        },
      }),
    );
  const selectedModelProvider =
    overrides.selectedModelProvider || ref<CloudProvider>("deepseek");
  const codexOAuthStatus = ref(overrides.codexOAuthValid === false ? null : { valid: true } as any);
  const replaceSettingsDraftFromServer = vi.fn();
  const ensureCodexOAuthReady = vi.fn().mockResolvedValue(true);

  const controller = createConsoleModelLibraryController({
    agentExploreModelAlias: () => "explore-model",
    codexOAuthStatus,
    clearAllBusy,
    currentAgentModelOptionLabel: (value?: string) => (value ? `current:${value}` : ""),
    ensureCodexOAuthReady,
    error,
    infoFeedModelAlias: () => "info-model",
    infoFeedRunningSummary: () => ({ modelAlias: "run-model", runId: "run-1", status: "running" }),
    modelLibraryExpandedCards,
    modelProbeResults,
    moduleAgentCandidateDrafts,
    normalizeModelEntry: (entry: Partial<AgentModelConfig>, index = 0) =>
      makeModel({
        uid: String(entry.uid || entry.instanceId || entry.alias || `${entry.provider || "model"}-${index}`),
        instanceId: String(entry.instanceId || entry.uid || entry.alias || `${entry.provider || "model"}-${index}`),
        alias: String(entry.alias || entry.uid || entry.instanceId || `${entry.provider || "model"}-${index}`),
        provider: String(entry.provider || ""),
        label: String(entry.label || entry.agentName || ""),
        baseUrl: String(entry.baseUrl || ""),
        url: String(entry.url || ""),
        model: String(entry.model || ""),
        apiKey: String(entry.apiKey || ""),
        apiKeyConfigured: entry.apiKeyConfigured === true,
        token: String(entry.token || ""),
        tokenConfigured: entry.tokenConfigured === true,
        tokenHeader: String(entry.tokenHeader || "token"),
        tokenPrefix: String(entry.tokenPrefix || ""),
        agentName: String(entry.agentName || entry.label || ""),
        pluginList: Array.isArray(entry.pluginList) ? [...entry.pluginList] : [],
        engine: String(entry.engine || ""),
        systemPrompt: String(entry.systemPrompt || ""),
        parameters: { ...(entry.parameters || {}) },
        moduleAccess: entry.moduleAccess ? { ...entry.moduleAccess } : { mode: "all", moduleIds: [] },
        permissionGroupId: String(entry.permissionGroupId || ""),
        timeoutMs: Number(entry.timeoutMs || 120000),
        parametersText: String(entry.parametersText || "{}"),
      }),
    replaceSettingsDraftFromServer,
    ruleAuthoringModelAlias: () => "rule-model",
    selectedModelProvider,
    setBusy,
    settingsDraft,
    settingsPayloadForSave: () => settingsDraft.value,
  });

  return {
    clearAllBusy,
    codexOAuthStatus,
    controller,
    ensureCodexOAuthReady,
    error,
    modelLibraryExpandedCards,
    modelProbeResults,
    moduleAgentCandidateDrafts,
    replaceSettingsDraftFromServer,
    selectedModelProvider,
    setBusy,
    settingsDraft,
  };
}

function createRepositoryFixture(overrides: {
  visibleEntries?: AgentModelConfig[];
  visibleProviders?: CloudProvider[];
  selectedModelProvider?: Ref<CloudProvider>;
  modelEntryIsBound?: (entry: AgentModelConfig) => boolean;
} = {}) {
  const error = ref("seed");
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();
  const modelLibraryExpandedCards = ref<Record<string, boolean>>({});
  const selectedModelProvider =
    overrides.selectedModelProvider || ref<CloudProvider>("deepseek");
  const settingsDraft = ref(
    makeSettings({
      modelLibraryEntries: ["deepseek", "google-gemini"],
      deepSeekTimeoutMs: 777,
      modelLibraryAgents:
        overrides.visibleEntries || [
          makeModel({
            provider: "deepseek",
            uid: "deep-1",
            instanceId: "deep-1",
            alias: "deep-1",
            label: "DeepSeek Agent",
            model: "deepseek-v3",
            baseUrl: "https://api.deepseek.com",
            timeoutMs: 777,
          }),
          makeModel({
            provider: "google-gemini",
            uid: "gem-1",
            instanceId: "gem-1",
            alias: "gem-1",
            label: "Gemini Agent",
            model: "gemini-2.0",
          }),
        ],
    }),
  );
  const visibleModelEntries = computed(() => settingsDraft.value.modelLibraryAgents || []);
  const visibleModelProviders = computed(
    () => (overrides.visibleProviders || settingsDraft.value.modelLibraryEntries) as CloudProvider[],
  );
  const replaceSettingsDraftFromServer = vi.fn();
  const modelEntryStatusKey = (entry: AgentModelConfig) => entry.uid || entry.instanceId || entry.alias;
  const modelEntryBindingSummary = vi.fn((entry: AgentModelConfig) => `${entry.label || entry.alias}`);
  const modelEntryIsBound =
    overrides.modelEntryIsBound || vi.fn((entry: AgentModelConfig) => entry.provider === "google-gemini");

  const controller = createConsoleModelRepositoryController({
    clearAllBusy,
    error,
    modelEntryBindingSummary,
    modelEntryIsBound,
    modelEntryStatusKey,
    modelLibraryExpandedCards,
    normalizeModelEntry: (entry: Partial<AgentModelConfig>, index = 0) =>
      makeModel({
        uid: String(entry.uid || entry.instanceId || entry.alias || `${entry.provider || "model"}-${index}`),
        instanceId: String(entry.instanceId || entry.uid || entry.alias || `${entry.provider || "model"}-${index}`),
        alias: String(entry.alias || entry.uid || entry.instanceId || `${entry.provider || "model"}-${index}`),
        provider: String(entry.provider || ""),
        label: String(entry.label || entry.agentName || ""),
        baseUrl: String(entry.baseUrl || ""),
        url: String(entry.url || ""),
        model: String(entry.model || ""),
        apiKey: String(entry.apiKey || ""),
        apiKeyConfigured: entry.apiKeyConfigured === true,
        token: String(entry.token || ""),
        tokenConfigured: entry.tokenConfigured === true,
        tokenHeader: String(entry.tokenHeader || "token"),
        tokenPrefix: String(entry.tokenPrefix || ""),
        agentName: String(entry.agentName || entry.label || ""),
        pluginList: Array.isArray(entry.pluginList) ? [...entry.pluginList] : [],
        engine: String(entry.engine || ""),
        systemPrompt: String(entry.systemPrompt || ""),
        parameters: { ...(entry.parameters || {}) },
        moduleAccess: entry.moduleAccess ? { ...entry.moduleAccess } : { mode: "all", moduleIds: [] },
        permissionGroupId: String(entry.permissionGroupId || ""),
        timeoutMs: Number(entry.timeoutMs || 120000),
        parametersText: String(entry.parametersText || "{}"),
      }),
    providerLabel: (provider) => String(provider).toUpperCase(),
    replaceSettingsDraftFromServer,
    selectedModelProvider,
    setBusy,
    settingsDraft,
    settingsPayloadForSave: () => settingsDraft.value,
    visibleModelEntries,
    visibleModelProviders,
  });

  return {
    clearAllBusy,
    controller,
    error,
    modelEntryBindingSummary,
    modelEntryIsBound,
    modelLibraryExpandedCards,
    replaceSettingsDraftFromServer,
    selectedModelProvider,
    setBusy,
    settingsDraft,
    visibleModelEntries,
    visibleModelProviders,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSettingsClientMock.probeModel.mockReset();
  agentSettingsClientMock.saveSettings.mockReset();
});

describe("console model library controller extra coverage", () => {
  it("normalizes provider lists, parses refs, and resolves configuration state", () => {
    const { controller, codexOAuthStatus, settingsDraft } = createLibraryFixture({
      codexOAuthValid: true,
    });

    expect(controller.visibleModelProviders.value).toEqual([
      "google-gemini",
      "deepseek",
      "local-model",
    ]);
    expect(controller.visibleModelEntries.value).toHaveLength(2);
    expect(controller.addableModelProviders.value).toEqual(modelLibraryProviderDefinitions);
    expect(controller.providerLabel("custom-http")).toBe("HTTP Adapter");
    expect(controller.modelProviderDefinition("openai-chatgpt")).toMatchObject({
      id: "openai-chatgpt",
      label: "ChatGPT OAuth",
    });
    expect(controller.modelRef("openai-chatgpt", "")).toBe("openai-chatgpt:");
    expect(controller.parseModelRef("custom-http:alpha:beta")).toEqual({
      provider: "custom-http",
      model: "alpha:beta",
    });
    expect(controller.parseModelRef("")).toEqual({ provider: "", model: "" });
    expect(controller.customHttpAdapterAlias()).toBe("alpha-model");
    expect(controller.customHttpAdapterLabel()).toBe("Alpha Label");

    settingsDraft.value.customModelAlias = "";
    settingsDraft.value.customModelLabel = "";
    settingsDraft.value.customHttpAdapter.alias = "  fallback-alias  ";
    settingsDraft.value.customHttpAdapter.label = "  fallback-label  ";
    expect(controller.customHttpAdapterAlias()).toBe("fallback-alias");
    expect(controller.customHttpAdapterLabel()).toBe("fallback-label");

    expect(controller.providerConfigured("google-gemini")).toBe(true);
    expect(controller.providerConfigured("openai-chatgpt")).toBe(true);
    expect(controller.providerConfigured("deepseek")).toBe(true);
    expect(controller.providerConfigured("custom-http")).toBe(true);
    expect(controller.providerConfigured("local-model")).toBe(false);
    expect(controller.providerConfigured("unknown" as CloudProvider)).toBe(false);

    const deepseekEntry = makeModel({
      provider: "deepseek",
      model: "deepseek-v3",
      label: "DeepSeek Agent",
      baseUrl: "https://api.deepseek.com",
      tokenConfigured: true,
    });
    const customEntry = makeModel({
      provider: "custom-http",
      model: "custom-engine",
      url: "https://example.test/api",
      tokenConfigured: true,
    });
    const openaiEntry = makeModel({
      provider: "openai-chatgpt",
      model: "gpt-4.1-mini",
    });

    expect(controller.modelEntryConfigured(deepseekEntry)).toBe(true);
    expect(controller.modelEntryConfigured(customEntry)).toBe(true);
    expect(controller.modelEntryConfigured(openaiEntry)).toBe(true);
    expect(controller.modelEntryUidSet(customEntry)).toEqual(new Set(["agent-1"]));
    expect(controller.modelEntryMatchesUid(customEntry, " agent-1 ")).toBe(true);
    expect(controller.modelEntryMatchesUid(customEntry, "")).toBe(false);
    expect(controller.modelEntryMatchesAssignment(customEntry, "custom-http", "agent-1")).toBe(true);
    expect(controller.modelEntryMatchesAssignment(customEntry, "custom-http", "")).toBe(false);
    expect(controller.agentExploreModelOptionLabel(customEntry)).toBe("Gemini 1 · custom-engine");
  });

  it("probes configured entries, keeps unconfigured entries local, and records provider failures", async () => {
    const { controller, clearAllBusy, error, modelProbeResults, setBusy } = createLibraryFixture({
      visibleEntries: [
        makeModel({
          provider: "google-gemini",
          uid: "gem-1",
          instanceId: "gem-1",
          alias: "gem-1",
          label: "Gemini Entry",
          model: "gemini-2.0",
          apiKeyConfigured: true,
        }),
        makeModel({
          provider: "openai-chatgpt",
          uid: "openai-empty",
          instanceId: "openai-empty",
          alias: "openai-empty",
          label: "OpenAI Empty",
          model: "",
        }),
      ],
      codexOAuthValid: true,
    });

    agentSettingsClientMock.probeModel.mockResolvedValueOnce(
      makeProbeResponse({ provider: "google-gemini", model: "gemini-2.0" }),
    );
    await controller.probeModelEntry(controller.visibleModelEntries.value[0]);

    expect(setBusy).toHaveBeenCalledWith("model-probe:gem-1");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(error.value).toBe("");
    expect(controller.modelEntryProbeResult(controller.visibleModelEntries.value[0])).toMatchObject({
      ok: true,
      provider: "google-gemini",
      model: "gemini-2.0",
    });
    expect(controller.modelEntryProbeStatusLabel(controller.visibleModelEntries.value[0])).toBe("探测通过");
    expect(controller.modelEntryProbeStatusTone(controller.visibleModelEntries.value[0])).toBe("success");
    expect(controller.modelEntryStatusLabel(controller.visibleModelEntries.value[0])).toBe("探测通过");
    expect(controller.modelEntryStatusTone(controller.visibleModelEntries.value[0])).toBe("success");

    agentSettingsClientMock.probeModel.mockClear();
    expect(controller.modelEntryStatusLabel(controller.visibleModelEntries.value[1])).toBe("未配置");
    expect(controller.modelEntryStatusTone(controller.visibleModelEntries.value[1])).toBe("muted");
    await controller.probeModelEntry(controller.visibleModelEntries.value[1]);
    expect(agentSettingsClientMock.probeModel).not.toHaveBeenCalled();
    expect(clearAllBusy).toHaveBeenCalledTimes(2);
    expect(controller.modelEntryProbeResult(controller.visibleModelEntries.value[1])).toMatchObject({
      ok: false,
      configured: false,
      provider: "openai-chatgpt",
      message: "模型配置不完整，未执行远程探测。",
    });
    expect(controller.modelEntryProbeStatusLabel(controller.visibleModelEntries.value[1])).toBe("探测失败");
    expect(controller.modelEntryProbeStatusTone(controller.visibleModelEntries.value[1])).toBe("danger");
    expect(controller.modelEntryStatusLabel(controller.visibleModelEntries.value[1])).toBe("探测失败");
    expect(controller.modelEntryStatusTone(controller.visibleModelEntries.value[1])).toBe("danger");

    agentSettingsClientMock.probeModel.mockRejectedValueOnce(new Error("provider probe failed"));
    await controller.probeModel("deepseek" as CloudProvider);
    expect(setBusy).toHaveBeenCalledWith("model-probe:deepseek");
    expect(clearAllBusy).toHaveBeenCalledTimes(3);
    expect(error.value).toBe("provider probe failed");
    expect(controller.providerStatusLabel("deepseek")).toBe("探测失败");
    expect(controller.providerStatusTone("deepseek")).toBe("danger");
    expect(modelProbeResults.value.deepseek).toMatchObject({
      ok: false,
      provider: "deepseek",
      message: "provider probe failed",
    });

    const emptyController = createLibraryFixture({ visibleEntries: [], codexOAuthValid: true }).controller;
    agentSettingsClientMock.probeModel.mockClear();
    const failures = await emptyController.probeModelLibraryBeforeSave();
    expect(failures).toEqual([]);
    expect(agentSettingsClientMock.probeModel).not.toHaveBeenCalled();
  });
});

describe("console model repository controller extra coverage", () => {
  it("toggles cards, adds providers, duplicates entries, and skips empty provider selection", () => {
    const { controller, modelLibraryExpandedCards, selectedModelProvider, settingsDraft } = createRepositoryFixture();

    const existing = settingsDraft.value.modelLibraryAgents[0];
    expect(controller.isModelLibraryCardExpanded(existing)).toBe(false);

    controller.toggleModelLibraryCard(existing);
    expect(controller.isModelLibraryCardExpanded(existing)).toBe(true);
    controller.toggleModelLibraryCard(existing);
    expect(controller.isModelLibraryCardExpanded(existing)).toBe(false);

    controller.addModelProvider();
    const added = settingsDraft.value.modelLibraryAgents[0];
    const addedKey = added.uid || added.instanceId || added.alias;
    expect(added.provider).toBe("deepseek");
    expect(added.baseUrl).toBe("https://api.deepseek.com");
    expect(added.timeoutMs).toBe(777);
    expect(modelLibraryExpandedCards.value[addedKey]).toBe(true);
    expect(settingsDraft.value.modelLibraryAgents[0]).toMatchObject({
      provider: "deepseek",
      label: "DEEPSEEK 智能体",
      model: "",
    });

    selectedModelProvider.value = "" as any;
    const before = settingsDraft.value.modelLibraryAgents.length;
    controller.addModelProvider();
    expect(settingsDraft.value.modelLibraryAgents.length).toBe(before);

    controller.duplicateModelEntry(existing);
    const copy = settingsDraft.value.modelLibraryAgents[0];
    expect(copy.label).toBe("DeepSeek Agent 副本");
    expect(copy.uid).not.toBe(existing.uid);
    expect(copy.instanceId).not.toBe(existing.instanceId);
    expect(copy.alias).not.toBe(existing.alias);
    expect(copy.apiKey).toBe("");
    expect(copy.token).toBe("");
    expect(modelLibraryExpandedCards.value[copy.uid || copy.instanceId || copy.alias]).toBe(true);
  });

  it("blocks bound removals, persists successful removals, and rolls back failed removals", async () => {
    const boundEntry = makeModel({
      provider: "google-gemini",
      uid: "gem-1",
      instanceId: "gem-1",
      alias: "gem-1",
      label: "Gemini Agent",
      model: "gemini-2.0",
    });

    const boundFixture = createRepositoryFixture({
      visibleEntries: [boundEntry, makeModel({
        provider: "deepseek",
        uid: "deep-1",
        instanceId: "deep-1",
        alias: "deep-1",
        label: "DeepSeek Agent",
        model: "deepseek-v3",
      })],
      modelEntryIsBound: () => true,
    });

    await boundFixture.controller.removeModelProvider(boundEntry);
    expect(boundFixture.error.value).toBe("智能体已绑定到 Gemini Agent，请先解除引用后再删除。");
    expect(agentSettingsClientMock.saveSettings).not.toHaveBeenCalled();
    expect(boundFixture.setBusy).not.toHaveBeenCalled();

    const successFixture = createRepositoryFixture({
      visibleEntries: [
        makeModel({
          provider: "deepseek",
          uid: "deep-1",
          instanceId: "deep-1",
          alias: "deep-1",
          label: "DeepSeek Agent",
          model: "deepseek-v3",
        }),
        makeModel({
          provider: "google-gemini",
          uid: "gem-1",
          instanceId: "gem-1",
          alias: "gem-1",
          label: "Gemini Agent",
          model: "gemini-2.0",
        }),
      ],
      visibleProviders: ["deepseek", "google-gemini"],
      modelEntryIsBound: () => false,
    });
    agentSettingsClientMock.saveSettings.mockResolvedValueOnce(
      makeSettings({
        modelLibraryEntries: ["deepseek"],
        modelLibraryAgents: [
          makeModel({
            provider: "deepseek",
            uid: "deep-1",
            instanceId: "deep-1",
            alias: "deep-1",
            label: "DeepSeek Agent",
            model: "deepseek-v3",
          }),
        ],
      }),
    );

    await successFixture.controller.removeModelProvider("google-gemini");
    expect(successFixture.setBusy).toHaveBeenCalledWith("model-remove:google-gemini");
    expect(agentSettingsClientMock.saveSettings).toHaveBeenCalledTimes(1);
    expect(successFixture.replaceSettingsDraftFromServer).toHaveBeenCalledWith(
      expect.objectContaining({ modelLibraryEntries: ["deepseek"] }),
    );
    expect(successFixture.settingsDraft.value.modelLibraryAgents.every((item) => item.provider === "deepseek")).toBe(true);
    expect(successFixture.settingsDraft.value.modelLibraryEntries).toEqual(["deepseek"]);
    expect(successFixture.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(successFixture.error.value).toBe("");

    const failureFixture = createRepositoryFixture({
      visibleEntries: [
        makeModel({
          provider: "deepseek",
          uid: "deep-1",
          instanceId: "deep-1",
          alias: "deep-1",
          label: "DeepSeek Agent",
          model: "deepseek-v3",
        }),
        makeModel({
          provider: "google-gemini",
          uid: "gem-1",
          instanceId: "gem-1",
          alias: "gem-1",
          label: "Gemini Agent",
          model: "gemini-2.0",
        }),
      ],
      visibleProviders: ["deepseek", "google-gemini"],
      modelEntryIsBound: () => false,
    });
    const previousEntries = [...failureFixture.settingsDraft.value.modelLibraryAgents];
    const previousProviders = [...failureFixture.settingsDraft.value.modelLibraryEntries];
    agentSettingsClientMock.saveSettings.mockRejectedValueOnce(new Error("remove failed"));

    await failureFixture.controller.removeModelProvider("google-gemini");
    expect(failureFixture.error.value).toBe("remove failed");
    expect(failureFixture.settingsDraft.value.modelLibraryAgents).toEqual(previousEntries);
    expect(failureFixture.settingsDraft.value.modelLibraryEntries).toEqual(previousProviders);
    expect(failureFixture.clearAllBusy).toHaveBeenCalledTimes(1);
  });
});
