import type { Ref } from "vue";
import { probeModel } from "../lib/agent-settings-client";
import type {
  AgentModelConfig,
  AgentSettings,
  ModelProbeResponse,
} from "../lib/types";
import type { CloudProvider } from "../types/app";
import { modelEntryParameters } from "./console-model-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleModelProbeControllerOptions = {
  clearAllBusy: () => void;
  error: Ref<string>;
  modelEntryConfigured: (entry: AgentModelConfig) => boolean;
  modelEntryStatusKey: (entry: AgentModelConfig) => string;
  modelProbeResults: Ref<Record<string, ModelProbeResponse>>;
  providerConfigured: (provider: CloudProvider) => boolean;
  setBusy: (key: string) => void;
  settingsPayloadForSave: () => AgentSettings;
  visibleModelEntries: ReadonlyRef<AgentModelConfig[]>;
};

export function createConsoleModelProbeController(
  options: ConsoleModelProbeControllerOptions,
) {
  function modelProbeFailureResult(entry: AgentModelConfig, message: string): ModelProbeResponse {
    return {
      ok: false,
      configured: options.modelEntryConfigured(entry),
      provider: entry.provider,
      model: String(entry.model || entry.engine || ""),
      statusCode: 0,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      message,
    };
  }

  function modelProbeSettingsForEntry(entry: AgentModelConfig) {
    const settings = options.settingsPayloadForSave();
    const cleanParameters = modelEntryParameters(entry);
    if (entry.provider === "google-gemini") {
      settings.googleModel = String(entry.model ?? "");
    }
    if (entry.provider === "openai-chatgpt") {
      settings.openAiModel = String(entry.model ?? "");
    }
    if (entry.provider === "deepseek") {
      settings.deepSeekBaseUrl = entry.baseUrl || settings.deepSeekBaseUrl;
      settings.deepSeekModel = String(entry.model ?? "");
      settings.deepSeekApiKey = entry.apiKey || "";
      settings.deepSeekApiKeyConfigured = Boolean(entry.apiKey || entry.apiKeyConfigured);
      settings.deepSeekTimeoutMs = Number(entry.timeoutMs || settings.deepSeekTimeoutMs);
    }
    if (entry.provider === "openrouter") {
      settings.openRouterModel = String(entry.model ?? "");
    }
    if (entry.provider === "copilot") {
      settings.copilotModel = String(entry.model ?? "");
    }
    if (entry.provider === "local-model") {
      settings.localModelName = String(entry.model ?? "");
    }
    if (entry.provider === "custom-http") {
      settings.customModelAlias = options.modelEntryStatusKey(entry);
      settings.customModelLabel = entry.label || options.modelEntryStatusKey(entry);
      const adapter = {
        ...settings.customHttpAdapter,
        alias: options.modelEntryStatusKey(entry),
        label: entry.label || options.modelEntryStatusKey(entry),
        url: entry.url || "",
        token: entry.token || "",
        tokenConfigured: entry.tokenConfigured,
        tokenHeader: entry.tokenHeader || "token",
        tokenPrefix: entry.tokenPrefix || "",
        agentName: entry.label || "",
        engine: entry.engine || entry.model || "",
        pluginList: entry.pluginList || [],
        parameters: cleanParameters,
        timeoutMs: Number(entry.timeoutMs || 120000),
      };
      settings.customHttpAdapter = adapter;
      settings.customHttpAdapters = [adapter];
    }
    return settings;
  }

  async function runModelEntryProbe(entry: AgentModelConfig): Promise<ModelProbeResponse> {
    if (!options.modelEntryConfigured(entry)) {
      return modelProbeFailureResult(entry, "模型配置不完整，未执行远程探测。");
    }
    return probeModel({
      provider: entry.provider,
      modelAlias: options.modelEntryStatusKey(entry),
      settings: modelProbeSettingsForEntry(entry),
    });
  }

  async function probeModelEntry(entry: AgentModelConfig) {
    const key = options.modelEntryStatusKey(entry);
    options.setBusy(`model-probe:${key}`);
    options.error.value = "";
    try {
      const result = await runModelEntryProbe(entry);
      options.modelProbeResults.value = {
        ...options.modelProbeResults.value,
        [key]: result,
      };
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "模型探测失败。";
      options.modelProbeResults.value = {
        ...options.modelProbeResults.value,
        [key]: modelProbeFailureResult(entry, message),
      };
      options.error.value = message;
    } finally {
      options.clearAllBusy();
    }
  }

  async function probeModelProvider(provider: CloudProvider) {
    options.setBusy(`model-probe:${provider}`);
    options.error.value = "";

    try {
      const result = await probeModel({
        provider,
        settings: options.settingsPayloadForSave(),
      });
      options.modelProbeResults.value = {
        ...options.modelProbeResults.value,
        [provider]: result,
      };
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "模型探测失败。";
      options.modelProbeResults.value = {
        ...options.modelProbeResults.value,
        [provider]: {
          ok: false,
          configured: options.providerConfigured(provider),
          provider,
          model: "",
          statusCode: 0,
          latencyMs: 0,
          checkedAt: new Date().toISOString(),
          message,
        },
      };
      options.error.value = message;
    } finally {
      options.clearAllBusy();
    }
  }

  async function probeModelLibraryBeforeSave() {
    const failures: Array<{ entry: AgentModelConfig; result: ModelProbeResponse }> = [];
    const nextResults: Record<string, ModelProbeResponse> = {};
    for (const entry of options.visibleModelEntries.value) {
      const key = options.modelEntryStatusKey(entry);
      try {
        const result = await runModelEntryProbe(entry);
        nextResults[key] = result;
        if (!result.ok) {
          failures.push({ entry, result });
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "模型探测失败。";
        const result = modelProbeFailureResult(entry, message);
        nextResults[key] = result;
        failures.push({ entry, result });
      }
    }
    options.modelProbeResults.value = {
      ...options.modelProbeResults.value,
      ...nextResults,
    };
    return failures;
  }

  function modelEntryProbeResult(entry: AgentModelConfig) {
    return options.modelProbeResults.value[options.modelEntryStatusKey(entry)] || null;
  }

  function modelEntryProbeStatusLabel(entry: AgentModelConfig) {
    const probe = modelEntryProbeResult(entry);
    if (!probe) {
      return "";
    }
    return probe.ok ? "探测通过" : "探测失败";
  }

  function modelEntryProbeStatusTone(entry: AgentModelConfig) {
    const probe = modelEntryProbeResult(entry);
    if (!probe) {
      return "neutral";
    }
    return probe.ok ? "success" : "danger";
  }

  function modelEntryStatusLabel(entry: AgentModelConfig) {
    const probe = options.modelProbeResults.value[options.modelEntryStatusKey(entry)];
    if (probe) {
      return probe.ok ? "探测通过" : "探测失败";
    }
    return options.modelEntryConfigured(entry) ? "已配置" : "未配置";
  }

  function modelEntryStatusTone(entry: AgentModelConfig) {
    const probe = options.modelProbeResults.value[options.modelEntryStatusKey(entry)];
    if (probe) {
      return probe.ok ? "success" : "danger";
    }
    return options.modelEntryConfigured(entry) ? "neutral" : "muted";
  }

  function providerStatusLabel(provider: CloudProvider) {
    const probe = options.modelProbeResults.value[provider];
    if (probe) {
      return probe.ok ? "探测通过" : "探测失败";
    }
    return options.providerConfigured(provider) ? "已配置" : "未配置";
  }

  function providerStatusTone(provider: CloudProvider) {
    const probe = options.modelProbeResults.value[provider];
    if (probe) {
      return probe.ok ? "success" : "danger";
    }
    return options.providerConfigured(provider) ? "neutral" : "muted";
  }

  return {
    modelEntryProbeResult,
    modelEntryProbeStatusLabel,
    modelEntryProbeStatusTone,
    modelEntryStatusLabel,
    modelEntryStatusTone,
    modelProbeFailureResult,
    modelProbeSettingsForEntry,
    probeModel: probeModelProvider,
    probeModelEntry,
    probeModelLibraryBeforeSave,
    providerStatusLabel,
    providerStatusTone,
    runModelEntryProbe,
  };
}
