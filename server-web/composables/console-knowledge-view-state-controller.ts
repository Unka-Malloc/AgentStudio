import { computed, nextTick, ref } from "vue";
import { useRoute } from "vue-router";
import type { KnowledgeTab } from "./useConsole";
import { knowledgeRouteTabToViewTab } from "../router/routes";
import { scrollDataAttributeElementIntoView } from "./console-browser-effects";

type ReadonlyRef<T> = {
  readonly value: T;
};

export type ConsoleKnowledgeViewStateControllerOptions = {
  collapsedWordBagIds: ReadonlyRef<Set<string>>;
  knowledgeManagementPanel: ReadonlyRef<string>;
  knowledgeTab: ReadonlyRef<KnowledgeTab>;
  toggleWordCloudCollapsed: (wordBagId: string) => void;
};

export function createConsoleKnowledgeViewStateController(
  options: ConsoleKnowledgeViewStateControllerOptions,
) {
  const route = useRoute();
  const activeKnowledgeTab = computed<KnowledgeTab>(() => {
    return knowledgeRouteTabToViewTab(String(route.params.tab ?? "")) ?? options.knowledgeTab.value;
  });

  const expandedSummaryIds = ref<Set<string>>(new Set());
  function toggleSummaryExpanded(wordBagId: string) {
    const next = new Set(expandedSummaryIds.value);
    if (next.has(wordBagId)) {
      next.delete(wordBagId);
    } else {
      next.add(wordBagId);
    }
    expandedSummaryIds.value = next;
  }

  const expandedAdvancedIds = ref<Set<string>>(new Set());
  function toggleAdvancedExpanded(wordBagId: string) {
    const next = new Set(expandedAdvancedIds.value);
    if (next.has(wordBagId)) {
      next.delete(wordBagId);
    } else {
      next.add(wordBagId);
    }
    expandedAdvancedIds.value = next;
  }

  const titleFocusedWordBagId = ref<string | null>(null);

  function jumpToCloud(wordBagId: string) {
    if (options.collapsedWordBagIds.value.has(wordBagId)) {
      options.toggleWordCloudCollapsed(wordBagId);
    }
    nextTick(() => {
      scrollDataAttributeElementIntoView("data-word-bag-id", wordBagId);
    });
  }

  const isManagementKnowledgePanel = computed(
    () => activeKnowledgeTab.value === "management" && options.knowledgeManagementPanel.value === "knowledge",
  );
  const isManagementRulesPanel = computed(
    () => activeKnowledgeTab.value === "management" && options.knowledgeManagementPanel.value === "rules",
  );
  const isKnownKnowledgeTab = computed(
    () =>
      isManagementKnowledgePanel.value ||
      isManagementRulesPanel.value ||
      activeKnowledgeTab.value === "wordCloud" ||
      activeKnowledgeTab.value === "maintenance",
  );

  const dynamicParsingPreviewConfig = {
    pipelineId: "dynamic-parameter-v1",
    ingestPipelineId: "unified-knowledge-ingest-v1",
    contextBudget: { knowledgeTokens: 12000 },
    payloadBudget: { maxResponseBytes: 1048576 },
    granularity: {
      secondaryParse: { enabled: false },
    },
    dynamicParsing: {
      preserveStructureArtifacts: true,
    },
    structureArtifacts: true,
    granularityFragments: true,
    parentArtifactId: "",
  };
  const dynamicParsingPolicySignature = JSON.stringify(dynamicParsingPreviewConfig);
  const documentPreviewResult = ref<Record<string, unknown> | null>(null);

  return {
    activeKnowledgeTab,
    documentPreviewResult,
    dynamicParsingPolicySignature,
    dynamicParsingPreviewConfig,
    expandedAdvancedIds,
    expandedSummaryIds,
    isKnownKnowledgeTab,
    isManagementKnowledgePanel,
    isManagementRulesPanel,
    jumpToCloud,
    titleFocusedWordBagId,
    toggleAdvancedExpanded,
    toggleSummaryExpanded,
  };
}
