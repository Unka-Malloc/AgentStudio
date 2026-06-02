import { computed, ref, watch, type Ref } from "vue";
import type {
  AgentSelectorOption,
  AgentSettings,
} from "../lib/types";
import type { InfoFeedSummaryDefaults } from "./console-info-feed-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type InfoFeedAgentOption = AgentSelectorOption & {
  enabled: boolean;
  disabledReason: string;
};

export type InfoFeedContextWindowOption = {
  value: string;
  label: string;
  description?: string;
};

export type InfoFeedContextProfileBudgetRow = {
  profileId: string;
  contextWindowTokens: number;
  knowledgeBudget: number;
};

export type InfoFeedAgentExploreFormLike = {
  thinkingMode: string;
};

type ConsoleInfoFeedModelControllerOptions = {
  agentExploreContextWindowOptions: InfoFeedContextWindowOption[];
  agentExploreForm: Ref<InfoFeedAgentExploreFormLike>;
  agentExploreThinkingModeOptions: Array<{ value: string }>;
  agentSelectorOptions: ReadonlyRef<InfoFeedAgentOption[]>;
  settingsDraft: Ref<AgentSettings>;
};

function inactiveInfoFeedAgentOption(value?: string): InfoFeedAgentOption {
  const selectedValue = String(value || "").trim();
  return {
    value: selectedValue,
    agentUid: selectedValue,
    label: selectedValue ? "已移除的智能体" : "未选择智能体",
    provider: "",
    model: "",
    moduleIds: [],
    capabilities: [],
    status: "unconfigured",
    enabled: false,
    selectable: false,
    disabledReason: selectedValue ? "已从智能体列表删除" : "未分配",
    reason: selectedValue ? "已从智能体列表删除" : "未分配",
  };
}

function selectedInfoFeedAgentFromOptions(options: InfoFeedAgentOption[], value?: string): InfoFeedAgentOption {
  const selectedValue = String(value || "").trim();
  if (!selectedValue) {
    return inactiveInfoFeedAgentOption("");
  }
  return options.find((item) => item.value === selectedValue) || inactiveInfoFeedAgentOption(selectedValue);
}

export function createConsoleInfoFeedModelController(
  options: ConsoleInfoFeedModelControllerOptions,
) {
  const defaultInfoFeedModelAlias = computed(() =>
    String(options.settingsDraft.value.agentExploreDefaults?.infoFeedSummaryModelAlias || "").trim(),
  );
  const infoFeedForm = ref({
    query: "",
    modelAlias: defaultInfoFeedModelAlias.value,
    contextProfileId: "context-32k",
    temperature: 0.2,
    maxTokens: 1800,
  });

  watch(
    defaultInfoFeedModelAlias,
    (modelAlias) => {
      if (modelAlias && !String(infoFeedForm.value.modelAlias || "").trim()) {
        infoFeedForm.value.modelAlias = modelAlias;
      }
    },
    { immediate: true },
  );

  const infoFeedModelOptions = computed(() => options.agentSelectorOptions.value);
  const selectedInfoFeedModel = computed(() =>
    selectedInfoFeedAgentFromOptions(infoFeedModelOptions.value, infoFeedForm.value.modelAlias),
  );
  const selectedInfoFeedContextProfile = computed(() => {
    const configured = String(
      infoFeedForm.value.contextProfileId ||
        options.settingsDraft.value.agentExploreDefaults?.contextProfileId ||
        "context-32k",
    ).trim();
    const selected = options.agentExploreContextWindowOptions.find(
      (item) => item.value === configured,
    );
    return selected || options.agentExploreContextWindowOptions[0];
  });

  function normalizedThinkingMode(value?: string) {
    const mode = String(value || "default").trim();
    return options.agentExploreThinkingModeOptions.some((item) => item.value === mode) ? mode : "default";
  }

  const selectedThinkingMode = computed(() =>
    normalizedThinkingMode(
      options.agentExploreForm.value.thinkingMode ||
        options.settingsDraft.value.agentExploreDefaults?.thinkingMode,
    ),
  );

  function agentExploreThinkingParameters() {
    const mode = selectedThinkingMode.value;
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

  function hasAgentModelOption(value?: string) {
    const normalized = String(value || "").trim();
    return Boolean(normalized && infoFeedModelOptions.value.some((item) => item.value === normalized));
  }

  function validAgentModelAlias(value?: string) {
    const normalized = String(value || "").trim();
    return hasAgentModelOption(normalized) ? normalized : "";
  }

  function infoFeedSummaryDefaults(): InfoFeedSummaryDefaults {
    return {
      modelAlias: selectedInfoFeedModel.value.value,
      contextProfileId: selectedInfoFeedContextProfile.value.value,
      temperature: Number(infoFeedForm.value.temperature || 0.2),
      maxTokens: Number(infoFeedForm.value.maxTokens || 1800),
    };
  }

  function infoFeedModelDisplayLabel(value?: string) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return "未记录";
    }
    return infoFeedModelOptions.value.find((item) => item.value === normalized)?.label || "已移除的智能体";
  }

  function infoFeedFallbackContextProfileId() {
    return String(
      selectedInfoFeedContextProfile.value.value ||
        infoFeedForm.value.contextProfileId ||
        "context-128k",
    );
  }

  return {
    agentExploreThinkingParameters,
    hasAgentModelOption,
    infoFeedFallbackContextProfileId,
    infoFeedForm,
    infoFeedModelDisplayLabel,
    infoFeedModelOptions,
    infoFeedSummaryDefaults,
    selectedInfoFeedContextProfile,
    selectedInfoFeedModel,
    selectedThinkingMode,
    validAgentModelAlias,
  };
}
