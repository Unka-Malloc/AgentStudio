import { computed, type ComputedRef, type Ref } from "vue";
import { intelligentModuleDefinitions } from "./console-defaults";
import type { AgentModelConfig, AgentSettings } from "../lib/types";
import type { AgentConfigurationAlert } from "../types/app";

export type DashboardAgentOption = {
  value: string;
  label?: string;
  enabled: boolean;
  disabledReason?: string;
  ref?: string;
};

type DashboardConfigurationAlertControllerOptions = {
  agentExploreAgentOptions: ComputedRef<DashboardAgentOption[]>;
  agentExploreForm: Ref<{ modelAlias?: string }>;
  agentModelAssignmentOptions: ComputedRef<DashboardAgentOption[]>;
  agentSelectorOptions: ComputedRef<DashboardAgentOption[]>;
  infoFeedForm: Ref<{ modelAlias?: string }>;
  infoFeedModelOptions: ComputedRef<DashboardAgentOption[]>;
  moduleModelRef: (moduleId: string) => string;
  moduleNeedsIntelligence: (moduleId: string) => boolean;
  ruleAuthoringForm: Ref<{ modelAlias?: string }>;
  ruleAuthoringModelOptions: ComputedRef<DashboardAgentOption[]>;
  settingsDraft: Ref<AgentSettings>;
  visibleModelEntries: ComputedRef<AgentModelConfig[]>;
};

function agentSelectionAlert(
  params: Omit<AgentConfigurationAlert, "status" | "tone"> & {
    value: string;
    options: DashboardAgentOption[];
  },
): AgentConfigurationAlert | null {
  const value = String(params.value || "").trim();
  if (!value) {
    return {
      alertId: params.alertId,
      category: params.category,
      title: params.title,
      detail: params.detail,
      status: "未配置智能体",
      tone: "warning",
      view: params.view,
      adminView: params.adminView,
      targetId: params.targetId,
    };
  }
  const option = params.options.find((item) => item.value === value);
  if (!option?.enabled) {
    return {
      alertId: params.alertId,
      category: params.category,
      title: params.title,
      detail: option?.disabledReason
        ? `${params.detail} 当前选择不可用：${option.disabledReason}。`
        : `${params.detail} 当前选择已不在模型库或尚未完成授权。`,
      status: "智能体不可用",
      tone: "danger",
      view: params.view,
      adminView: params.adminView,
      targetId: params.targetId,
    };
  }
  return null;
}

export function createConsoleDashboardConfigurationAlertController(
  options: DashboardConfigurationAlertControllerOptions,
) {
  const agentConfigurationAlerts = computed<AgentConfigurationAlert[]>(() => {
    const alerts: AgentConfigurationAlert[] = [];
    if (options.visibleModelEntries.value.length === 0) {
      alerts.push({
        alertId: "model-library-empty",
        category: "模型库",
        title: "模型库为空",
        detail: "需要先新增至少一个智能体模型，后续功能和模块才能显式绑定。",
        status: "无可用智能体",
        tone: "danger",
        view: "admin",
        adminView: "agentConfig",
        targetId: "agent-model-library",
      });
    }
    for (const item of [
      agentSelectionAlert({
        alertId: "info-feed-summary-agent",
        category: "信息流",
        title: "信息流智能体",
        detail: "信息流最终报告需要一个可用智能体来融合原文检索、智能规划和附件结果。",
        value: options.settingsDraft.value.agentExploreDefaults?.infoFeedSummaryModelAlias || options.infoFeedForm.value.modelAlias || "",
        options: options.infoFeedModelOptions.value,
        view: "admin",
        adminView: "agentAssignment",
        targetId: "info-feed-summary-agent",
      }),
      agentSelectionAlert({
        alertId: "agent-explore-agent",
        category: "信息流",
        title: "知识检索智能体",
        detail: "智能检索需要一个可用智能体来规划工具调用和打开证据。",
        value: options.settingsDraft.value.agentExploreDefaults?.agentRetrievalModelAlias || options.agentExploreForm.value.modelAlias || "",
        options: options.agentExploreAgentOptions.value,
        view: "admin",
        adminView: "agentAssignment",
        targetId: "agent-explore-agent",
      }),
      agentSelectionAlert({
        alertId: "rule-authoring-agent",
        category: "工作台",
        title: "创建规则智能体",
        detail: "创建规则的智能对话模式需要一个可用智能体辅助生成规则草稿。",
        value: options.settingsDraft.value.agentExploreDefaults?.ruleAuthoringModelAlias || options.ruleAuthoringForm.value.modelAlias || "",
        options: options.ruleAuthoringModelOptions.value,
        view: "admin",
        adminView: "agentAssignment",
        targetId: "rule-authoring-agent",
      }),
      agentSelectionAlert({
        alertId: "knowledge-review-fusion-agent",
        category: "知识库",
        title: "知识融合智能体",
        detail: "知识融合分析需要显式绑定一个可用智能体，用于合并多路知识证据与结构化结果。",
        value: options.settingsDraft.value.agentExploreDefaults?.reviewFusionModelAlias || "",
        options: options.agentSelectorOptions.value,
        view: "admin",
        adminView: "agentAssignment",
        targetId: "knowledge-review-fusion-agent",
      }),
    ]) {
      if (item) {
        alerts.push(item);
      }
    }
    for (const moduleDefinition of intelligentModuleDefinitions) {
      if (!options.moduleNeedsIntelligence(moduleDefinition.id)) {
        continue;
      }
      const refValue = options.moduleModelRef(moduleDefinition.id);
      const option = options.agentModelAssignmentOptions.value.find((item) => item.ref === refValue);
      if (!refValue) {
        if (moduleDefinition.alertRequired === false) {
          continue;
        }
        alerts.push({
          alertId: `module:${moduleDefinition.id}`,
          category: "模块模型分配",
          title: moduleDefinition.label,
          detail: moduleDefinition.description,
          status: "未配置智能体",
          tone: "warning",
          view: "admin",
          adminView: "agentAssignment",
          targetId: `module-agent-${moduleDefinition.id}`,
        });
        continue;
      }
      if (!option?.enabled) {
        alerts.push({
          alertId: `module:${moduleDefinition.id}`,
          category: "模块模型分配",
          title: moduleDefinition.label,
          detail: `${moduleDefinition.description} 当前绑定的智能体不可用或未完成授权。`,
          status: "智能体不可用",
          tone: "danger",
          view: "admin",
          adminView: "agentAssignment",
          targetId: `module-agent-${moduleDefinition.id}`,
        });
      }
    }
    return alerts;
  });

  const agentConfigurationAlertSummary = computed(() => {
    const dangerCount = agentConfigurationAlerts.value.filter((item) => item.tone === "danger").length;
    const warningCount = agentConfigurationAlerts.value.length - dangerCount;
    if (agentConfigurationAlerts.value.length === 0) {
      return "所有需要智能体的功能都已显式绑定可用智能体。";
    }
    return [
      dangerCount ? `${dangerCount} 项不可用` : "",
      warningCount ? `${warningCount} 项未配置` : "",
    ].filter(Boolean).join("，");
  });

  return {
    agentConfigurationAlertSummary,
    agentConfigurationAlerts,
  };
}
