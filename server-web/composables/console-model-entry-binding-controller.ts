import { computed, type Ref } from "vue";
import type {
  AgentModelConfig,
  AgentSettings,
} from "../lib/types";
import type { ModelEntryBinding } from "../types/app";
import { intelligentModuleDefinitions } from "./console-defaults";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleModelEntryBindingControllerOptions = {
  agentExploreModelAlias: () => string;
  infoFeedModelAlias: () => string;
  infoFeedRunningSummary: () => { modelAlias?: string; runId?: string; status?: string };
  modelEntryMatchesAssignment: (entry: AgentModelConfig, provider?: string, modelUid?: string) => boolean;
  modelEntryMatchesUid: (entry: AgentModelConfig, value?: string) => boolean;
  modelEntryStatusKey: (entry: AgentModelConfig) => string;
  moduleNeedsIntelligence: (moduleId: string) => boolean;
  ruleAuthoringModelAlias: () => string;
  settingsDraft: Ref<AgentSettings>;
  visibleModelEntries: ReadonlyRef<AgentModelConfig[]>;
};

export function createConsoleModelEntryBindingController(
  options: ConsoleModelEntryBindingControllerOptions,
) {
  function addModelEntryBinding(
    bindings: ModelEntryBinding[],
    binding: ModelEntryBinding,
  ) {
    if (bindings.some((item) => item.bindingId === binding.bindingId)) {
      return;
    }
    bindings.push(binding);
  }

  function collectModelEntryBindings(entry: AgentModelConfig): ModelEntryBinding[] {
    const bindings: ModelEntryBinding[] = [];
    if (options.modelEntryMatchesUid(entry, options.infoFeedModelAlias())) {
      addModelEntryBinding(bindings, {
        bindingId: "info-feed:form",
        category: "信息流",
        label: "信息流智能体",
        detail: "当前信息流页面选用的智能体。",
        source: "draft",
      });
    }
    const infoFeedSummary = options.infoFeedRunningSummary();
    if (
      options.modelEntryMatchesUid(entry, infoFeedSummary.modelAlias) &&
      infoFeedSummary.status === "running"
    ) {
      addModelEntryBinding(bindings, {
        bindingId: `info-feed:running:${infoFeedSummary.runId}`,
        category: "信息流",
        label: "正在运行的信息流",
        detail: `运行 ${infoFeedSummary.runId} 正在使用该智能体。`,
        source: "runtime",
      });
    }
    if (options.modelEntryMatchesUid(entry, options.agentExploreModelAlias())) {
      addModelEntryBinding(bindings, {
        bindingId: "agent-explore:form",
        category: "信息流",
        label: "智能检索",
        detail: "信息流中的智能检索面板显式选用了该智能体。",
        source: "draft",
      });
    }
    if (options.modelEntryMatchesUid(entry, options.ruleAuthoringModelAlias())) {
      addModelEntryBinding(bindings, {
        bindingId: "rule-authoring:form",
        category: "知识库",
        label: "规则生成",
        detail: "知识库规则库的智能生成入口正在引用该智能体。",
        source: "draft",
      });
    }
    if (
      options.modelEntryMatchesUid(
        entry,
        options.settingsDraft.value.agentExploreDefaults?.reviewFusionModelAlias,
      )
    ) {
      addModelEntryBinding(bindings, {
        bindingId: "knowledge-review:fusion",
        category: "知识库",
        label: "知识融合智能体",
        detail: "工作台审批流中的知识融合流程显式绑定该智能体。",
        source: "settings",
      });
    }
    for (const moduleDefinition of intelligentModuleDefinitions) {
      if (!options.moduleNeedsIntelligence(moduleDefinition.id)) {
        continue;
      }
      const assignment = options.settingsDraft.value.moduleModelAssignments?.[moduleDefinition.id];
      if (options.modelEntryMatchesAssignment(entry, assignment?.provider, assignment?.model)) {
        addModelEntryBinding(bindings, {
          bindingId: `module:${moduleDefinition.id}`,
          category: "模块模型分配",
          label: moduleDefinition.label,
          detail: moduleDefinition.description,
          source: "settings",
        });
      }
      const profileGroup = options.settingsDraft.value.moduleAgentProfiles?.[moduleDefinition.id];
      if (profileGroup?.agents?.[options.modelEntryStatusKey(entry)]) {
        addModelEntryBinding(bindings, {
          bindingId: `module-profile:${moduleDefinition.id}:${options.modelEntryStatusKey(entry)}`,
          category: "模块专属参数",
          label: `${moduleDefinition.label} 专属配置`,
          detail: "该智能体保存了模块/功能专属调用参数或依赖上下文。",
          source: "settings",
        });
      }
    }
    return bindings;
  }

  const modelEntryBindingsByKey = computed<Record<string, ModelEntryBinding[]>>(() => {
    const next: Record<string, ModelEntryBinding[]> = {};
    for (const entry of options.visibleModelEntries.value) {
      next[options.modelEntryStatusKey(entry)] = collectModelEntryBindings(entry);
    }
    return next;
  });

  function modelEntryBindings(entry: AgentModelConfig): ModelEntryBinding[] {
    return modelEntryBindingsByKey.value[options.modelEntryStatusKey(entry)] || [];
  }

  function modelEntryIsBound(entry: AgentModelConfig) {
    return modelEntryBindings(entry).length > 0;
  }

  function modelEntryBindingSummary(entry: AgentModelConfig) {
    const bindings = modelEntryBindings(entry);
    if (bindings.length === 0) {
      return "";
    }
    return bindings.map((item) => item.label).join("、");
  }

  return {
    addModelEntryBinding,
    collectModelEntryBindings,
    modelEntryBindingSummary,
    modelEntryBindings,
    modelEntryBindingsByKey,
    modelEntryIsBound,
  };
}
