import { computed, ref, type Ref } from "vue";
import type { KnowledgeSearchResponse, KnowledgeSearchResult } from "../lib/types";
import type { DebugTab } from "../types/app";
import type { KnowledgeSearchFormState } from "./console-knowledge-recall-types";

export function createConsoleKnowledgeSearchStateController() {
  const knowledgeSearchForm = ref<KnowledgeSearchFormState>({
    query: "",
  });
  const knowledgeSearchResults = ref<KnowledgeSearchResult[]>([]);
  const knowledgeSearchResponse = ref<KnowledgeSearchResponse | null>(null);
  const lastKnowledgeSearchQuery = ref("");

  return {
    knowledgeSearchForm,
    knowledgeSearchResponse,
    knowledgeSearchResults,
    lastKnowledgeSearchQuery,
  };
}

type ConsoleKnowledgeSearchPanelStateControllerOptions = {
  busyKey: Ref<string>;
  debugTab: Ref<DebugTab>;
  knowledgeSearchResults: Ref<KnowledgeSearchResult[]>;
  lastKnowledgeSearchQuery: Ref<string>;
  selectedEvidence: Ref<unknown | null>;
};

export function createConsoleKnowledgeSearchPanelStateController(
  options: ConsoleKnowledgeSearchPanelStateControllerOptions,
) {
  const knowledgeSearchExpanded = computed(
    () =>
      options.debugTab.value === "knowledgeRecall" &&
      (options.busyKey.value === "knowledge:search" ||
        Boolean(options.lastKnowledgeSearchQuery.value) ||
        options.knowledgeSearchResults.value.length > 0 ||
        Boolean(options.selectedEvidence.value)),
  );
  const knowledgeSearchEmpty = computed(
    () =>
      Boolean(options.lastKnowledgeSearchQuery.value) &&
      options.busyKey.value !== "knowledge:search" &&
      options.knowledgeSearchResults.value.length === 0,
  );

  return {
    knowledgeSearchEmpty,
    knowledgeSearchExpanded,
  };
}
