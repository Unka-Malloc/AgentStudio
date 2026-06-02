import { computed, ref, watch, type Ref } from "vue";
import {
  chatKnowledgeRuleAuthoring,
  publishGoldenRules,
} from "../lib/knowledge-rules-client";
import type {
  AgentSettings,
  AgentSelectorOption,
  KnowledgeRuleAuthoringResponse,
} from "../lib/types";
import type {
  OptionBarOption,
  RuleAuthoringMode,
} from "../types/app";
import { asRecord } from "./console-model-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type ConsoleRuleAuthoringAgentOption = AgentSelectorOption & {
  enabled: boolean;
  disabledReason: string;
};

type ConsoleRuleAuthoringControllerOptions = {
  agentSelectorOptions: ReadonlyRef<ConsoleRuleAuthoringAgentOption[]>;
  canMaintainKnowledge: ReadonlyRef<boolean>;
  clearAllBusy: () => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
  settingsDraft: Ref<AgentSettings>;
};

type RuleOption = {
  value: string;
  label: string;
  description: string;
};

const ruleScopeOptions: RuleOption[] = [
  { value: "knowledge", label: "知识库", description: "对入库文档、证据和知识对象生效。" },
  { value: "mail", label: "邮件", description: "对 EML/MSG、线程和事务接续生效。" },
  { value: "source", label: "数据源", description: "对原始文件、目录和采集来源生效。" },
  { value: "all", label: "全局", description: "跨来源执行，需要更谨慎审核。" },
];

const ruleMatchStrategyOptions: RuleOption[] = [
  { value: "semantic_duplicate", label: "语义重复", description: "标题、正文和实体近似相同时命中。" },
  { value: "exact_source", label: "来源一致", description: "文件 hash、路径、邮件 ID 等强证据一致时命中。" },
  { value: "same_entity_time", label: "同实体时间窗", description: "同客户、合同、账号、订单等在相近时间内命中。" },
  { value: "manual_condition", label: "人工条件", description: "使用补充说明中的明确条件。" },
];

const ruleActionOptions: RuleOption[] = [
  { value: "skip_duplicate", label: "跳过重复", description: "命中后不重复写入知识库。" },
  { value: "merge", label: "融合", description: "保留证据并生成融合建议。" },
  { value: "replace", label: "覆盖", description: "以新记录替换旧记录，需要审慎使用。" },
  { value: "manual_review", label: "人工审核", description: "只产生审核任务，不自动处理。" },
];

function inactiveRuleAuthoringAgentOption(value?: string): ConsoleRuleAuthoringAgentOption {
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

function selectedRuleAuthoringAgentFromOptions(
  options: ConsoleRuleAuthoringAgentOption[],
  value?: string,
): ConsoleRuleAuthoringAgentOption {
  const selectedValue = String(value || "").trim();
  if (!selectedValue) {
    return inactiveRuleAuthoringAgentOption("");
  }
  return options.find((item) => item.value === selectedValue) || inactiveRuleAuthoringAgentOption(selectedValue);
}

function optionLabel(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((item) => item.value === value)?.label || value;
}

export function createConsoleRuleAuthoringController(
  options: ConsoleRuleAuthoringControllerOptions,
) {
  const defaultRuleAuthoringModelAlias = computed(() =>
    String(options.settingsDraft.value.agentExploreDefaults?.ruleAuthoringModelAlias || "").trim(),
  );
  const ruleAuthoringForm = ref({
    message: "",
    modelAlias: defaultRuleAuthoringModelAlias.value,
    ruleName: "",
    scope: "knowledge",
    matchStrategy: "semantic_duplicate",
    action: "skip_duplicate",
    confidence: 0.85,
    notes: "",
  });
  const ruleCreationMode = ref<RuleAuthoringMode>("chat");
  const ruleAuthoringResult = ref<KnowledgeRuleAuthoringResponse | null>(null);
  const ruleAuthoringHistory = ref<KnowledgeRuleAuthoringResponse[]>([]);
  const ruleAuthoringModelOptions = computed(() => options.agentSelectorOptions.value);
  const selectedRuleAuthoringModel = computed(() =>
    selectedRuleAuthoringAgentFromOptions(ruleAuthoringModelOptions.value, ruleAuthoringForm.value.modelAlias),
  );
  watch(
    defaultRuleAuthoringModelAlias,
    (modelAlias) => {
      if (modelAlias && !String(ruleAuthoringForm.value.modelAlias || "").trim()) {
        ruleAuthoringForm.value.modelAlias = modelAlias;
      }
    },
    { immediate: true },
  );
  const ruleScopeOptionBarOptions = computed<OptionBarOption[]>(() =>
    ruleScopeOptions.map((option) => ({ value: option.value, label: option.label })),
  );
  const ruleMatchStrategyOptionBarOptions = computed<OptionBarOption[]>(() =>
    ruleMatchStrategyOptions.map((option) => ({ value: option.value, label: option.label })),
  );
  const ruleActionOptionBarOptions = computed<OptionBarOption[]>(() =>
    ruleActionOptions.map((option) => ({ value: option.value, label: option.label })),
  );
  let syncingRuleAuthoringDraft = false;

  function inferRuleDraftFromMessage(message: string) {
    const text = String(message || "").toLowerCase();
    const patch: Partial<typeof ruleAuthoringForm.value> = {};
    if (/邮件|eml|msg|thread|事务|账单|订单/.test(text)) {
      patch.scope = "mail";
    } else if (/目录|数据源|文件夹|路径|source/.test(text)) {
      patch.scope = "source";
    } else if (/全局|所有|全部/.test(text)) {
      patch.scope = "all";
    } else if (/知识|文档|证据|入库|docx/.test(text)) {
      patch.scope = "knowledge";
    }
    if (/完全一样|重复|相同|duplicate|相似|近似/.test(text)) {
      patch.matchStrategy = "semantic_duplicate";
      if (!/融合|合并|覆盖|替换|人工|审核/.test(text)) {
        patch.action = "skip_duplicate";
      }
    }
    if (/hash|哈希|路径|文件名|message-id|message id|来源一致/.test(text)) {
      patch.matchStrategy = "exact_source";
    }
    if (/客户|供应商|合同|订单|账号|账户|金额|时间窗|连续|月度/.test(text)) {
      patch.matchStrategy = "same_entity_time";
    }
    if (/人工条件|自定义条件|条件是/.test(text)) {
      patch.matchStrategy = "manual_condition";
    }
    if (/融合|合并|merge/.test(text)) {
      patch.action = "merge";
    } else if (/覆盖|替换|replace/.test(text)) {
      patch.action = "replace";
    } else if (/人工|审核|确认|review/.test(text)) {
      patch.action = "manual_review";
    } else if (/跳过|忽略|不写入|不重复/.test(text)) {
      patch.action = "skip_duplicate";
    }
    const percentMatch = text.match(/(\d{1,3})\s*%/);
    const decimalMatch = text.match(/\b(0\.\d+|1(?:\.0+)?)\b/);
    if (percentMatch) {
      patch.confidence = Math.max(0, Math.min(Number(percentMatch[1]) / 100, 1));
    } else if (decimalMatch) {
      patch.confidence = Math.max(0, Math.min(Number(decimalMatch[1]), 1));
    }
    if (!String(ruleAuthoringForm.value.ruleName || "").trim()) {
      if (/重复|相同|duplicate/.test(text)) {
        patch.ruleName = "重复知识处理规则";
      } else if (/账单/.test(text)) {
        patch.ruleName = "账单事务接续规则";
      } else if (/邮件|eml|msg/.test(text)) {
        patch.ruleName = "邮件知识治理规则";
      } else if (message.trim()) {
        patch.ruleName = message.trim().replace(/\s+/g, " ").slice(0, 28);
      }
    }
    return patch;
  }

  function buildRuleAuthoringManualMessage() {
    const draft = ruleAuthoringForm.value;
    return [
      `创建规则：${String(draft.ruleName || "").trim() || "未命名规则"}`,
      `适用范围：${optionLabel(ruleScopeOptions, draft.scope)}`,
      `匹配方式：${optionLabel(ruleMatchStrategyOptions, draft.matchStrategy)}`,
      `执行动作：${optionLabel(ruleActionOptions, draft.action)}`,
      `最低置信度：${Number(draft.confidence || 0).toFixed(2)}`,
      String(draft.notes || "").trim() ? `补充说明：${String(draft.notes || "").trim()}` : "",
    ].filter(Boolean).join("\n");
  }

  const ruleAuthoringEffectiveMessage = computed(() =>
    ruleCreationMode.value === "manual"
      ? buildRuleAuthoringManualMessage()
      : String(ruleAuthoringForm.value.message || "").trim(),
  );
  const ruleAuthoringCanSubmit = computed(() =>
    Boolean(
      ruleAuthoringEffectiveMessage.value.trim() &&
        options.canMaintainKnowledge.value &&
        (ruleCreationMode.value !== "chat" || selectedRuleAuthoringModel.value.enabled),
    ),
  );
  const ruleAuthoringDraftPayload = computed(() => ({
    mode: ruleCreationMode.value,
    ruleName: String(ruleAuthoringForm.value.ruleName || "").trim(),
    scope: ruleAuthoringForm.value.scope,
    matchStrategy: ruleAuthoringForm.value.matchStrategy,
    action: ruleAuthoringForm.value.action,
    confidence: Number(ruleAuthoringForm.value.confidence || 0),
    notes: String(ruleAuthoringForm.value.notes || "").trim(),
  }));
  const ruleAuthoringManualSummary = computed(() =>
    [
      optionLabel(ruleScopeOptions, ruleAuthoringForm.value.scope),
      optionLabel(ruleMatchStrategyOptions, ruleAuthoringForm.value.matchStrategy),
      optionLabel(ruleActionOptions, ruleAuthoringForm.value.action),
      `置信度 ${Number(ruleAuthoringForm.value.confidence || 0).toFixed(2)}`,
    ].join(" / "),
  );

  watch(
    () => ruleAuthoringForm.value.message,
    (message) => {
      if (syncingRuleAuthoringDraft || ruleCreationMode.value !== "chat") {
        return;
      }
      syncingRuleAuthoringDraft = true;
      Object.assign(ruleAuthoringForm.value, inferRuleDraftFromMessage(message));
      syncingRuleAuthoringDraft = false;
    },
  );

  watch(
    () => [
      ruleAuthoringForm.value.ruleName,
      ruleAuthoringForm.value.scope,
      ruleAuthoringForm.value.matchStrategy,
      ruleAuthoringForm.value.action,
      ruleAuthoringForm.value.confidence,
      ruleAuthoringForm.value.notes,
    ],
    () => {
      if (syncingRuleAuthoringDraft || ruleCreationMode.value !== "manual") {
        return;
      }
      const nextMessage = buildRuleAuthoringManualMessage();
      if (ruleAuthoringForm.value.message === nextMessage) {
        return;
      }
      syncingRuleAuthoringDraft = true;
      ruleAuthoringForm.value.message = nextMessage;
      syncingRuleAuthoringDraft = false;
    },
  );

  watch(ruleCreationMode, (mode) => {
    if (mode === "manual") {
      const nextMessage = buildRuleAuthoringManualMessage();
      if (!String(ruleAuthoringForm.value.message || "").trim() || ruleAuthoringForm.value.message.startsWith("创建规则：")) {
        syncingRuleAuthoringDraft = true;
        ruleAuthoringForm.value.message = nextMessage;
        syncingRuleAuthoringDraft = false;
      }
      return;
    }
    Object.assign(ruleAuthoringForm.value, inferRuleDraftFromMessage(ruleAuthoringForm.value.message));
  });

  async function runRuleAuthoringChat() {
    const message = ruleAuthoringEffectiveMessage.value.trim();
    if (!message) {
      options.error.value = "请输入规则生成需求。";
      return;
    }
    if (!options.canMaintainKnowledge.value) {
      options.error.value = "当前账号没有知识库维护权限。";
      return;
    }
    if (ruleCreationMode.value === "chat" && !selectedRuleAuthoringModel.value.enabled) {
      options.error.value = "请选择可用的创建规则智能体。";
      return;
    }
    options.setBusy("knowledge:rule-authoring");
    options.error.value = "";
    try {
      const result = await chatKnowledgeRuleAuthoring({
        message,
        draft: ruleAuthoringDraftPayload.value,
        modelAlias: ruleCreationMode.value === "chat" ? selectedRuleAuthoringModel.value.value : "",
        modelEnabled: ruleCreationMode.value === "chat",
      });
      ruleAuthoringResult.value = result;
      ruleAuthoringHistory.value = [
        result,
        ...ruleAuthoringHistory.value.filter((item) => item.runId !== result.runId),
      ].slice(0, 8);
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "规则生成失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function publishRuleAuthoringPackage() {
    const confirmation = ruleAuthoringResult.value?.confirmation;
    if (!confirmation?.packageId) {
      options.error.value = "没有可确认发布的规则包。";
      return;
    }
    if (!options.canMaintainKnowledge.value) {
      options.error.value = "当前账号没有知识库维护权限。";
      return;
    }
    options.setBusy("knowledge:rule-authoring:publish");
    options.error.value = "";
    try {
      const result = await publishGoldenRules(confirmation.packageId, {
        version: confirmation.version,
      });
      ruleAuthoringResult.value = {
        ...(ruleAuthoringResult.value || {
          protocolVersion: "pact.knowledge-rule-authoring.v1",
          ok: true,
          status: "published",
        }),
        status: "published",
        package: asRecord(result.package) || ruleAuthoringResult.value?.package,
        manifest: asRecord(result.manifest) || ruleAuthoringResult.value?.manifest,
      };
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "规则发布失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    publishRuleAuthoringPackage,
    ruleActionOptionBarOptions,
    ruleActionOptions,
    ruleAuthoringCanSubmit,
    ruleAuthoringDraftPayload,
    ruleAuthoringEffectiveMessage,
    ruleAuthoringForm,
    ruleAuthoringHistory,
    ruleAuthoringManualSummary,
    ruleAuthoringModelOptions,
    ruleAuthoringResult,
    ruleCreationMode,
    ruleMatchStrategyOptionBarOptions,
    ruleMatchStrategyOptions,
    ruleScopeOptionBarOptions,
    ruleScopeOptions,
    runRuleAuthoringChat,
    selectedRuleAuthoringModel,
  };
}
