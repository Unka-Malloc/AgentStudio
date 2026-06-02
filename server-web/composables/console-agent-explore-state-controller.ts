import { computed, ref, type Ref } from "vue";
import type { AgentExploreRunResponse, AgentSettings } from "../lib/types";
import type { AgentExploreSession } from "../types/app";
import { emptySettings } from "./console-defaults";
import type { AgentExploreFormState } from "./console-agent-explore-utils";

type ConsoleAgentExploreStateControllerOptions = {
  settingsDraft: Ref<AgentSettings>;
};

const defaultAgentExploreForm: AgentExploreFormState = {
  query: "",
  modelAlias: "",
  contextProfileId: "context-128k",
  thinkingMode: "default",
  temperature: 0.2,
  maxTokens: 1800,
  maxIterations: 4,
  limit: 8,
  toolChoice: "auto",
  workspaceId: "",
};

export const agentExploreContextWindowOptions = [
  {
    value: "context-32k",
    label: "32K",
    description: "轻量模型和快速探索",
  },
  {
    value: "context-128k",
    label: "128K",
    description: "复杂检索和多轮证据",
  },
  {
    value: "context-1m",
    label: "1M",
    description: "超长文档和大批量证据",
  },
];

export const agentExploreThinkingModeOptions = [
  {
    value: "default",
    label: "模型默认",
    description: "不额外传 thinking 参数，使用模型或供应商默认行为。",
  },
  {
    value: "enabled",
    label: "开启 Thinking",
    description: "向 DeepSeek / OpenAI-compatible 请求传入 thinking enabled；Qwen-compatible 同步 enable_thinking=true。",
  },
  {
    value: "disabled",
    label: "关闭 Thinking",
    description: "向 DeepSeek / OpenAI-compatible 请求传入 thinking disabled；Qwen-compatible 同步 enable_thinking=false。",
  },
];

export function createConsoleAgentExploreStateController(
  options: ConsoleAgentExploreStateControllerOptions,
) {
  const agentExploreForm = ref<AgentExploreFormState>({ ...defaultAgentExploreForm });
  const agentExploreResult = ref<AgentExploreRunResponse | null>(null);
  const agentExploreHistory = ref<AgentExploreSession[]>([]);
  const agentExploreDraftTabs = ref<AgentExploreSession[]>([]);
  const agentExploreActiveTabId = ref("");
  const agentExploreHydrated = ref(false);
  const agentExploreHiddenRunIds = ref<Set<string>>(new Set());
  const agentExploreClosedTabIds = ref<Set<string>>(new Set());

  function boundedAgentExploreNumber(value: unknown, fallback: number, min: number, max: number) {
    const next = Number(value);
    return Math.max(min, Math.min(Number.isFinite(next) ? next : fallback, max));
  }

  const agentExploreConfiguredMaxIterations = computed(() =>
    boundedAgentExploreNumber(
      options.settingsDraft.value.agentExploreDefaults?.maxIterations,
      emptySettings.agentExploreDefaults.maxIterations,
      1,
      8,
    ),
  );
  const agentExploreConfiguredLimit = computed(() =>
    boundedAgentExploreNumber(
      options.settingsDraft.value.agentExploreDefaults?.limit,
      emptySettings.agentExploreDefaults.limit,
      1,
      20,
    ),
  );
  const agentExploreConfiguredTemperature = computed(() =>
    boundedAgentExploreNumber(
      options.settingsDraft.value.agentExploreDefaults?.temperature,
      emptySettings.agentExploreDefaults.temperature,
      0,
      2,
    ),
  );
  const agentExploreConfiguredMaxTokens = computed(() =>
    boundedAgentExploreNumber(
      options.settingsDraft.value.agentExploreDefaults?.maxTokens,
      emptySettings.agentExploreDefaults.maxTokens,
      128,
      32000,
    ),
  );
  const agentExploreConfiguredToolChoice = computed(() =>
    String(
      options.settingsDraft.value.agentExploreDefaults?.toolChoice ||
        emptySettings.agentExploreDefaults.toolChoice ||
        "auto",
    ).trim() || "auto",
  );

  function normalizeAgentExploreThinkingMode(value?: string) {
    const mode = String(value || "default").trim();
    return agentExploreThinkingModeOptions.some((item) => item.value === mode) ? mode : "default";
  }

  const selectedAgentExploreThinkingMode = computed(() =>
    normalizeAgentExploreThinkingMode(
      agentExploreForm.value.thinkingMode ||
        options.settingsDraft.value.agentExploreDefaults?.thinkingMode,
    ),
  );

  const selectedAgentExploreContextProfile = computed(() => {
    const configured = String(
      agentExploreForm.value.contextProfileId ||
        options.settingsDraft.value.agentExploreDefaults?.contextProfileId ||
        "context-128k",
    ).trim();
    const selected = agentExploreContextWindowOptions.find(
      (item) => item.value === configured,
    );
    return selected || agentExploreContextWindowOptions[1];
  });

  function agentExploreThinkingParameters(): Record<string, unknown> {
    const mode = selectedAgentExploreThinkingMode.value;
    if (mode === "enabled") {
      return {
        pact_thinking_mode: "enabled",
      };
    }
    if (mode === "disabled") {
      return {
        pact_thinking_mode: "disabled",
      };
    }
    return {};
  }

  function agentExploreDefaults() {
    return {
      temperature: agentExploreConfiguredTemperature.value,
      maxTokens: agentExploreConfiguredMaxTokens.value,
      maxIterations: agentExploreConfiguredMaxIterations.value,
      limit: agentExploreConfiguredLimit.value,
      toolChoice: agentExploreConfiguredToolChoice.value,
    };
  }

  function applyAgentExploreDefaultsFromSettings() {
    if (agentExploreHydrated.value || agentExploreForm.value.query || agentExploreForm.value.workspaceId) {
      return;
    }
    agentExploreForm.value = {
      ...agentExploreForm.value,
      modelAlias: String(
        agentExploreForm.value.modelAlias ||
          options.settingsDraft.value.agentExploreDefaults?.agentRetrievalModelAlias ||
          "",
      ).trim(),
      contextProfileId: String(
        options.settingsDraft.value.agentExploreDefaults?.contextProfileId ||
          agentExploreForm.value.contextProfileId ||
          "context-128k",
      ),
      thinkingMode: normalizeAgentExploreThinkingMode(options.settingsDraft.value.agentExploreDefaults?.thinkingMode),
      temperature: agentExploreConfiguredTemperature.value,
      maxTokens: agentExploreConfiguredMaxTokens.value,
      maxIterations: agentExploreConfiguredMaxIterations.value,
      limit: agentExploreConfiguredLimit.value,
      toolChoice: agentExploreConfiguredToolChoice.value,
    };
  }

  return {
    agentExploreActiveTabId,
    agentExploreClosedTabIds,
    agentExploreConfiguredLimit,
    agentExploreConfiguredMaxIterations,
    agentExploreConfiguredMaxTokens,
    agentExploreConfiguredTemperature,
    agentExploreConfiguredToolChoice,
    agentExploreContextWindowOptions,
    agentExploreDefaults,
    agentExploreDraftTabs,
    agentExploreForm,
    agentExploreHiddenRunIds,
    agentExploreHistory,
    agentExploreHydrated,
    agentExploreResult,
    agentExploreThinkingModeOptions,
    agentExploreThinkingParameters,
    applyAgentExploreDefaultsFromSettings,
    boundedAgentExploreNumber,
    normalizeAgentExploreThinkingMode,
    selectedAgentExploreContextProfile,
    selectedAgentExploreThinkingMode,
  };
}
