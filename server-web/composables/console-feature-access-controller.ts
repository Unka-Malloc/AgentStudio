import { computed, type Ref } from "vue";
import type { ServerConsoleState } from "../lib/types";
import type { AdminView, DebugTab, KnowledgeTab } from "../types/app";

type LabeledTab<T extends string> = {
  id: T;
  label: string;
};

type ConsoleFeatureAccessControllerOptions = {
  consoleState: Ref<ServerConsoleState | null>;
  debugTabs: LabeledTab<DebugTab>[];
  isAuthenticated: () => boolean;
  knowledgeTabs: LabeledTab<KnowledgeTab>[];
};

export function createConsoleFeatureAccessController(options: ConsoleFeatureAccessControllerOptions) {
  const activeConsoleFeatureIds = computed(() =>
    options.consoleState.value?.features?.activeFeatureIds || []
  );

  function hasFeature(featureId: string) {
    if (!options.isAuthenticated() || !options.consoleState.value?.features) {
      return false;
    }
    return activeConsoleFeatureIds.value.includes(featureId);
  }

  function hasAnyFeature(featureIds: string[]) {
    return featureIds.some((featureId) => hasFeature(featureId));
  }

  const visibleKnowledgeTabs = computed(() =>
    hasFeature("knowledge-core") ? options.knowledgeTabs : []
  );

  const visibleDebugTabs = computed(() =>
    options.debugTabs.filter((tab) => {
      if (tab.id === "knowledgeRecall") {
        return hasFeature("knowledge-core");
      }
      if (tab.id === "agentRetrieval") {
        return hasFeature("agent-exploration");
      }
      if (tab.id === "knowledgeDistillation") {
        return hasFeature("knowledge-distillation");
      }
      return true;
    })
  );

  function isAdminViewEnabled(tab: AdminView) {
    switch (tab) {
      case "tools":
      case "toolList":
      case "toolGovernance":
      case "toolStats":
        return hasFeature("agent-gateway") || hasFeature("agent-management");
      case "agentPermissions":
        return hasFeature("agent-management") || hasFeature("agent-gateway");
      case "agentConfig":
      case "agentAssignment":
        return hasFeature("agent-gateway");
      case "contextManagement":
        return hasFeature("agent-gateway");
      case "maintenanceAgent":
        return hasFeature("maintenance-agent-runbooks");
      case "modules":
        return hasFeature("analysis-runtime");
      default:
        return true;
    }
  }

  return {
    activeConsoleFeatureIds,
    hasAnyFeature,
    hasFeature,
    isAdminViewEnabled,
    visibleDebugTabs,
    visibleKnowledgeTabs,
  };
}
