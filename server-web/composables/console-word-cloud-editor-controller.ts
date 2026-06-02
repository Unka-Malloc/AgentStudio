import { computed, type Ref } from "vue";
import type {
  KnowledgeWordCloud,
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import { createConsoleWordCloudCardController } from "./console-word-cloud-card-controller";
import { createConsoleWordCloudTermController } from "./console-word-cloud-term-controller";
import {
  DEFAULT_WORD_CLOUD_ABSORB_THRESHOLD,
  autoAbsorbWordCloudTerms as autoAbsorbWordCloudTermsCore,
  cloneWordCloudSet,
  createDefaultWordCloudSet as createDefaultWordCloudSetCore,
  findWordCloudInTree,
  normalizeWordCloudCorpusPathsForUi,
  normalizeWordCloudSetForUi,
  normalizeWordCloudThreshold,
  preferredWordCloudCorpusPaths as preferredWordCloudCorpusPathsCore,
  wordCloudTermIdentity,
} from "./console-word-cloud-utils";

type ConsoleWordCloudEditorControllerOptions = {
  collapsedWordBagIds: Ref<Set<string>>;
  pinnedWordBagIds: Ref<Set<string>>;
  selectedWordBagId: Ref<string>;
  wordBagActionMenuId: Ref<string>;
  wordCloudCorpusPaths: Ref<KnowledgeWordCloudCorpusPath[]>;
  wordCloudDraft: Ref<KnowledgeWordCloudSet | null>;
  wordCloudModelAlias: Ref<string>;
  wordCloudState: Ref<KnowledgeWordCloudState | null>;
  wordCloudTermInputs: Ref<Record<string, string>>;
};

export function createConsoleWordCloudEditorController(
  options: ConsoleWordCloudEditorControllerOptions,
) {
  function createDefaultWordCloudSet(
    terms: KnowledgeWordCloudTerm[] = [],
  ): KnowledgeWordCloudSet {
    return createDefaultWordCloudSetCore(terms, {
      corpusPaths: options.wordCloudCorpusPaths.value,
      modelAlias: options.wordCloudModelAlias.value,
    });
  }

  const wordCloudTerms = computed(() =>
    options.wordCloudState.value?.terms?.length
      ? options.wordCloudState.value.terms
      : options.wordCloudDraft.value?.termsSnapshot || [],
  );

  const wordCloudTermFrequencyMap = computed(() => {
    const next = new Map<string, number>();
    for (const item of wordCloudTerms.value) {
      const term = wordCloudTermIdentity(item);
      if (term) {
        next.set(term, Math.max(next.get(term) || 0, Number(item.frequency || 0)));
      }
    }
    return next;
  });

  function wordCloudTermWithFrequency(term: KnowledgeWordCloudTerm): KnowledgeWordCloudTerm {
    const key = wordCloudTermIdentity(term);
    return {
      ...term,
      frequency: Math.max(Number(term.frequency || 0), wordCloudTermFrequencyMap.value.get(key) || 0),
    };
  }

  const {
    flattenWordCloudCards,
    pinWordCloud,
    selectWordCloud,
    selectedWordCloud,
    toggleWordCloudActionMenu,
    toggleWordCloudCollapsed,
    wordCloudCanvasClouds,
    wordCloudCardRows,
    wordCloudCardStyle,
    wordCloudPalette,
    wordCloudVisibleTerms,
  } = createConsoleWordCloudCardController({
    collapsedWordBagIds: options.collapsedWordBagIds,
    pinnedWordBagIds: options.pinnedWordBagIds,
    selectedWordBagId: options.selectedWordBagId,
    wordBagActionMenuId: options.wordBagActionMenuId,
    wordCloudDraft: options.wordCloudDraft,
  });

  function autoAbsorbWordCloudTerms(draft: KnowledgeWordCloudSet) {
    return autoAbsorbWordCloudTermsCore(draft, { termWithFrequency: wordCloudTermWithFrequency });
  }

  function autoCollapseNewWordBags(
    wordBags: KnowledgeWordCloud[],
    isFirstLoad: boolean,
    previousIds: Set<string>,
  ) {
    const idsToCollapse = (wordBags || [])
      .filter((wordBag) => isFirstLoad || !previousIds.has(wordBag.wordBagId))
      .map((wordBag) => wordBag.wordBagId);
    if (idsToCollapse.length > 0) {
      options.collapsedWordBagIds.value = new Set([
        ...options.collapsedWordBagIds.value,
        ...idsToCollapse,
      ]);
    }
  }

  function mutateWordCloudDraft(mutator: (draft: KnowledgeWordCloudSet) => void) {
    const draft = options.wordCloudDraft.value || createDefaultWordCloudSet(wordCloudTerms.value);
    mutator(draft);
    autoAbsorbWordCloudTerms(draft);
    draft.updatedAt = new Date().toISOString();
    options.wordCloudDraft.value = normalizeWordCloudSetForUi({ ...draft });
  }

  const {
    addTermActionToCloud,
    addTermInputToCloud,
    addTermToCloud,
    clearRemovedTermsFromCloud,
    removeTermFromCloud,
    setWordCloudTermInput,
  } = createConsoleWordCloudTermController({
    mutateWordCloudDraft,
    selectedWordBagId: options.selectedWordBagId,
    wordBagActionMenuId: options.wordBagActionMenuId,
    wordCloudTermInputs: options.wordCloudTermInputs,
    wordCloudTerms,
    wordCloudTermWithFrequency,
  });

  function setWordCloudDraftFromState(state: KnowledgeWordCloudState | null) {
    const next = state?.wordBagSet
      ? normalizeWordCloudSetForUi(cloneWordCloudSet(state.wordBagSet))
      : createDefaultWordCloudSet(state?.terms || []);
    const nextCorpusPaths = preferredWordCloudCorpusPathsCore(
      next.corpusPaths?.length ? next.corpusPaths : state?.corpusPaths || [],
      options.wordCloudCorpusPaths.value,
    );
    next.corpusPaths = nextCorpusPaths;
    autoAbsorbWordCloudTerms(next);
    const isFirstLoad = options.wordCloudDraft.value === null;
    const prevWordBagIds = new Set(
      (options.wordCloudDraft.value?.wordBags || []).map((wordBag) => wordBag.wordBagId),
    );
    options.wordCloudDraft.value = next;
    options.selectedWordBagId.value = findWordCloudInTree(next.wordBags, options.selectedWordBagId.value)
      ? options.selectedWordBagId.value
      : "";
    if (next.modelAlias) {
      options.wordCloudModelAlias.value = next.modelAlias;
    }
    options.wordCloudCorpusPaths.value = nextCorpusPaths;
    autoCollapseNewWordBags(next.wordBags || [], isFirstLoad, prevWordBagIds);
  }

  function addManualWordCloud() {
    mutateWordCloudDraft((draft) => {
      const index = draft.wordBags.length + 1;
      const cloud: KnowledgeWordCloud = {
        wordBagId: `word-bag-${Date.now().toString(36)}`,
        label: `词云 ${index}`,
        summary: "",
        relation: "overlap",
        absorbThreshold: DEFAULT_WORD_CLOUD_ABSORB_THRESHOLD,
        terms: [],
        removedTerms: [],
        children: [],
      };
      draft.wordBags = [cloud, ...draft.wordBags];
      draft.wordBagCount = draft.wordBags.length;
      options.selectedWordBagId.value = cloud.wordBagId;
      options.collapsedWordBagIds.value = new Set(
        [...options.collapsedWordBagIds.value].filter((id) => id !== cloud.wordBagId),
      );
    });
  }

  function removeSelectedWordCloud() {
    const cloud = selectedWordCloud.value;
    if (!cloud) {
      return;
    }
    mutateWordCloudDraft((draft) => {
      const removeFrom = (items: KnowledgeWordCloud[]): KnowledgeWordCloud[] =>
        items
          .filter((item) => item.wordBagId !== cloud.wordBagId)
          .map((item) => ({ ...item, children: removeFrom(item.children || []) }));
      draft.wordBags = removeFrom(draft.wordBags || []);
      draft.wordBagCount = draft.wordBags.length;
      options.selectedWordBagId.value = "";
    });
  }

  function updateSelectedWordCloudField(field: "label" | "summary" | "relation", value: string) {
    const cloud = selectedWordCloud.value;
    if (!cloud) {
      return;
    }
    updateWordCloudField(cloud.wordBagId, field, value);
  }

  function updateWordCloudField(
    wordBagId: string,
    field: "label" | "summary" | "relation" | "absorbThreshold",
    value: string,
  ) {
    mutateWordCloudDraft((draft) => {
      const match = findWordCloudInTree(draft.wordBags || [], wordBagId);
      if (!match) {
        return;
      }
      if (field === "absorbThreshold") {
        match.cloud.absorbThreshold = normalizeWordCloudThreshold(value);
        return;
      }
      match.cloud[field] = value;
    });
  }

  function addChildWordCloud(parentWordBagId: string) {
    mutateWordCloudDraft((draft) => {
      const match = findWordCloudInTree(draft.wordBags || [], parentWordBagId);
      if (!match) {
        return;
      }
      const child: KnowledgeWordCloud = {
        wordBagId: `word-bag-${Date.now().toString(36)}`,
        parentWordBagId,
        label: "新分组",
        summary: "",
        relation: "contains",
        absorbThreshold: normalizeWordCloudThreshold(match.cloud.absorbThreshold),
        terms: [],
        removedTerms: [],
        children: [],
      };
      match.cloud.children = [...(match.cloud.children || []), child];
      options.selectedWordBagId.value = child.wordBagId;
      const next = new Set(options.collapsedWordBagIds.value);
      next.delete(parentWordBagId);
      options.collapsedWordBagIds.value = next;
      options.wordBagActionMenuId.value = "";
    });
  }

  function applySavedWordCloudSet(
    wordBagSet: KnowledgeWordCloudSet,
    optionsForSave: { fallbackCorpusPaths?: KnowledgeWordCloudCorpusPath[] } = {},
  ) {
    const normalized = normalizeWordCloudSetForUi(cloneWordCloudSet(wordBagSet));
    normalized.corpusPaths = preferredWordCloudCorpusPathsCore(
      normalized.corpusPaths || [],
      optionsForSave.fallbackCorpusPaths || options.wordCloudCorpusPaths.value,
    );
    if (options.wordCloudState.value) {
      options.wordCloudState.value = {
        ...options.wordCloudState.value,
        wordBagSet: normalized,
        wordBagSets: [
          normalized,
          ...(options.wordCloudState.value.wordBagSets || []).filter(
            (item) => item.wordBagSetId !== normalized.wordBagSetId,
          ),
        ],
      };
    }
    const isFirstLoad = options.wordCloudDraft.value === null;
    const prevWordBagIds = new Set(
      (options.wordCloudDraft.value?.wordBags || []).map((wordBag) => wordBag.wordBagId),
    );
    options.wordCloudDraft.value = normalized;
    options.wordCloudCorpusPaths.value = normalizeWordCloudCorpusPathsForUi(normalized.corpusPaths || []);
    options.selectedWordBagId.value = findWordCloudInTree(normalized.wordBags, options.selectedWordBagId.value)
      ? options.selectedWordBagId.value
      : "";
    autoCollapseNewWordBags(normalized.wordBags || [], isFirstLoad, prevWordBagIds);
  }

  return {
    addChildWordCloud,
    addManualWordCloud,
    addTermActionToCloud,
    addTermInputToCloud,
    addTermToCloud,
    applySavedWordCloudSet,
    autoAbsorbWordCloudTerms,
    clearRemovedTermsFromCloud,
    createDefaultWordCloudSet,
    flattenWordCloudCards,
    mutateWordCloudDraft,
    pinWordCloud,
    removeSelectedWordCloud,
    removeTermFromCloud,
    selectWordCloud,
    selectedWordCloud,
    setWordCloudDraftFromState,
    setWordCloudTermInput,
    toggleWordCloudActionMenu,
    toggleWordCloudCollapsed,
    updateSelectedWordCloudField,
    updateWordCloudField,
    wordCloudCanvasClouds,
    wordCloudCardRows,
    wordCloudCardStyle,
    wordCloudPalette,
    wordCloudTermFrequencyMap,
    wordCloudTermWithFrequency,
    wordCloudTerms,
    wordCloudVisibleTerms,
  };
}
