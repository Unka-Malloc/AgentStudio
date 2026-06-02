import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { callAgentGateway } from "../lib/agent-gateway-client";
import {
  listKnowledgeReviewItems,
  resolveKnowledgeReviewItem,
} from "../lib/knowledge-review-client";
import type {
  AgentSelectorOption,
  AgentSettings,
  KnowledgeConsoleState,
  KnowledgeReviewItem,
} from "../lib/types";
import type { AppView, OptionBarOption } from "../types/app";
import { knowledgeReviewFusionPrompt } from "./console-knowledge-review-utils";
import { asRecord } from "./console-model-utils";

type AgentSelectorUiOption = AgentSelectorOption & {
  enabled: boolean;
  disabledReason: string;
};

type RefreshKnowledgeConsoleOptions = {
  skipReviewItems?: boolean;
};

type RefreshKnowledgeReviewOptions = {
  silent?: boolean;
  suppressError?: boolean;
};

type ConsoleKnowledgeReviewControllerOptions = {
  agentExploreThinkingParameters: () => Record<string, unknown>;
  agentSelectorOptions: ComputedRef<AgentSelectorUiOption[]>;
  canAdminKnowledge: ComputedRef<boolean>;
  canMaintainKnowledge: ComputedRef<boolean>;
  canReadKnowledge: ComputedRef<boolean>;
  clearAllBusy: () => void;
  currentView: Ref<AppView>;
  error: Ref<string>;
  knowledgeConsole: Ref<KnowledgeConsoleState | null>;
  refreshKnowledgeConsole: (options?: RefreshKnowledgeConsoleOptions) => Promise<void>;
  setBusy: (key: string) => void;
  settingsDraft: Ref<AgentSettings>;
};

function inactiveAgentOption(value?: string): AgentSelectorUiOption {
  const normalized = String(value || "").trim();
  return {
    value: normalized,
    agentUid: normalized,
    label: normalized ? "已移除的智能体" : "未选择智能体",
    provider: "",
    model: "",
    moduleIds: [],
    capabilities: [],
    status: "unconfigured",
    enabled: false,
    selectable: false,
    disabledReason: normalized ? "已从智能体列表删除" : "未分配",
    reason: normalized ? "已从智能体列表删除" : "未分配",
  };
}

function selectedAgentFromOptions(
  options: AgentSelectorUiOption[],
  value?: string,
): AgentSelectorUiOption {
  const selectedValue = String(value || "").trim();
  if (!selectedValue) {
    return inactiveAgentOption("");
  }
  return options.find((item) => item.value === selectedValue) || inactiveAgentOption(selectedValue);
}

const knowledgeReviewStatusOptionBarOptions: OptionBarOption[] = [
  { value: "pending", label: "待决策" },
  { value: "resolved", label: "已解决" },
  { value: "rejected", label: "已忽略" },
  { value: "all", label: "全部" },
];

export function createConsoleKnowledgeReviewController(
  options: ConsoleKnowledgeReviewControllerOptions,
) {
  const knowledgeReviewStatus = ref("pending");
  const knowledgeReviewItems = ref<KnowledgeReviewItem[]>([]);
  const selectedKnowledgeReviewId = ref("");
  const knowledgeReviewRequestGeneration = ref(0);
  const knowledgeReviewBusyGeneration = ref(0);

  const selectedKnowledgeReviewItem = computed(() => {
    const selected = knowledgeReviewItems.value.find(
      (item) => item.reviewId === selectedKnowledgeReviewId.value,
    );
    return selected || knowledgeReviewItems.value[0] || null;
  });

  const pendingKnowledgeReviewCount = computed(() => {
    const loadedPending = knowledgeReviewItems.value.filter((item) => item.status === "pending").length;
    const healthCounts = asRecord(options.knowledgeConsole.value?.health?.counts) || {};
    return loadedPending || Number(healthCounts.pendingReviewItems || 0);
  });

  const selectedKnowledgeReviewFusionModel = computed(() =>
    selectedAgentFromOptions(
      options.agentSelectorOptions.value,
      options.settingsDraft.value.agentExploreDefaults?.reviewFusionModelAlias,
    ),
  );

  watch(knowledgeReviewStatus, () => {
    if (options.currentView.value === "dashboard") {
      void refreshKnowledgeConflicts();
    }
  });

  watch(
    knowledgeReviewItems,
    (items) => {
      if (!items.length) {
        selectedKnowledgeReviewId.value = "";
        return;
      }
      if (!items.some((item) => item.reviewId === selectedKnowledgeReviewId.value)) {
        selectedKnowledgeReviewId.value = String(items[0]?.reviewId || "");
      }
    },
    { deep: true },
  );

  function selectKnowledgeReviewItem(row: KnowledgeReviewItem) {
    selectedKnowledgeReviewId.value = String(row.reviewId || "");
  }

  function knowledgeReviewRowClassName({ row }: { row: KnowledgeReviewItem }) {
    return row.reviewId === selectedKnowledgeReviewId.value ? "is-selected-review-row" : "";
  }

  async function refreshKnowledgeConflicts(
    refreshOptions: RefreshKnowledgeReviewOptions = {},
  ) {
    if (!options.canReadKnowledge.value) {
      knowledgeReviewRequestGeneration.value += 1;
      return;
    }
    const requestedStatus = knowledgeReviewStatus.value;
    const requestGeneration = ++knowledgeReviewRequestGeneration.value;
    const busyGeneration = refreshOptions.silent ? 0 : ++knowledgeReviewBusyGeneration.value;
    if (!refreshOptions.silent) {
      options.setBusy("knowledge:review-items");
    }
    if (!refreshOptions.suppressError) {
      options.error.value = "";
    }
    try {
      const result = await listKnowledgeReviewItems({
        status: requestedStatus,
        limit: 100,
      });
      if (
        requestGeneration !== knowledgeReviewRequestGeneration.value ||
        requestedStatus !== knowledgeReviewStatus.value
      ) {
        return;
      }
      knowledgeReviewItems.value = Array.isArray(result.items) ? result.items : [];
    } catch (nextError) {
      if (
        requestGeneration !== knowledgeReviewRequestGeneration.value ||
        requestedStatus !== knowledgeReviewStatus.value
      ) {
        return;
      }
      if (!refreshOptions.suppressError) {
        options.error.value =
          nextError instanceof Error ? nextError.message : "加载知识冲突列表失败。";
      }
    } finally {
      if (!refreshOptions.silent && busyGeneration === knowledgeReviewBusyGeneration.value) {
        options.clearAllBusy();
      }
    }
  }

  async function resolveKnowledgeReview(
    item: KnowledgeReviewItem,
    resolution: string,
    patch: Record<string, unknown> = {},
  ) {
    if (!options.canMaintainKnowledge.value && !options.canAdminKnowledge.value) {
      options.error.value = "需要 knowledge:maintain 权限才能处理冲突。";
      return;
    }
    const reviewId = String(item.reviewId || "");
    if (!reviewId) {
      return;
    }
    options.setBusy(`knowledge:review:${reviewId}:${resolution}`);
    options.error.value = "";
    try {
      await resolveKnowledgeReviewItem(reviewId, { resolution, patch });
      await refreshKnowledgeConflicts({ silent: true });
      await options.refreshKnowledgeConsole({ skipReviewItems: true });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "处理知识冲突失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function fuseKnowledgeReview(item: KnowledgeReviewItem) {
    const model = selectedKnowledgeReviewFusionModel.value;
    if (!model?.enabled || !model.value) {
      options.error.value = "知识融合智能体未配置可用模型，请先在智能体分配中选择模型。";
      return;
    }
    const reviewId = String(item.reviewId || "");
    options.setBusy(`knowledge:review:${reviewId}:merge`);
    options.error.value = "";
    try {
      const response = await callAgentGateway({
        modelAlias: model.value,
        alias: model.value,
        moduleId: "agentTools",
        taskId: reviewId,
        sessionId: reviewId,
        question: knowledgeReviewFusionPrompt(item),
        systemPrompt: options.settingsDraft.value.agentExploreDefaults.reviewFusionSystemPrompt,
        parameters: {
          ...options.agentExploreThinkingParameters(),
          temperature: Number(options.settingsDraft.value.agentExploreDefaults.reviewFusionTemperature || 0.1),
          max_tokens: Number(options.settingsDraft.value.agentExploreDefaults.reviewFusionMaxTokens || 1200),
        },
      });
      const answer = String(response.answer || response.text || "").trim();
      await resolveKnowledgeReview(item, "merge", {
        fusionAgent: {
          modelAlias: model.value,
          generatedAt: new Date().toISOString(),
          answer,
        },
      });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "知识融合智能体调用失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    fuseKnowledgeReview,
    knowledgeReviewBusyGeneration,
    knowledgeReviewItems,
    knowledgeReviewRequestGeneration,
    knowledgeReviewRowClassName,
    knowledgeReviewStatus,
    knowledgeReviewStatusOptionBarOptions,
    pendingKnowledgeReviewCount,
    refreshKnowledgeConflicts,
    resolveKnowledgeReview,
    selectKnowledgeReviewItem,
    selectedKnowledgeReviewFusionModel,
    selectedKnowledgeReviewId,
    selectedKnowledgeReviewItem,
  };
}
