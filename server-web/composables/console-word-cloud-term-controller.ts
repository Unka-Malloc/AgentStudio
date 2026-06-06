import type { Ref } from "vue";
import type {
  KnowledgeWordCloudSet,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import {
  findWordCloudInTree,
  normalizeWordCloudTermForUi,
  wordCloudTermIdentity,
} from "./console-word-cloud-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleWordCloudTermControllerOptions = {
  mutateWordCloudDraft: (mutator: (draft: KnowledgeWordCloudSet) => void) => void;
  selectedWordBagId: Ref<string>;
  wordBagActionMenuId: Ref<string>;
  wordCloudTermInputs: Ref<Record<string, string>>;
  wordCloudTerms: ReadonlyRef<KnowledgeWordCloudTerm[]>;
  wordCloudTermWithFrequency: (term: KnowledgeWordCloudTerm) => KnowledgeWordCloudTerm;
};

export function createConsoleWordCloudTermController(
  options: ConsoleWordCloudTermControllerOptions,
) {
  function addTermToCloud(wordBagId: string, term: KnowledgeWordCloudTerm | string) {
    const normalized = options.wordCloudTermWithFrequency(normalizeWordCloudTermForUi(term));
    if (!normalized.term) {
      return;
    }
    const corpusTerm = options.wordCloudTerms.value.find(
      (item) => wordCloudTermIdentity(item) === wordCloudTermIdentity(normalized),
    );
    if (corpusTerm) {
      normalized.term = corpusTerm.term;
      normalized.frequency = Math.max(normalized.frequency, Number(corpusTerm.frequency || 0));
    }
    const identity = wordCloudTermIdentity(normalized);
    options.mutateWordCloudDraft((draft) => {
      const match = findWordCloudInTree(draft.wordBags || [], wordBagId);
      if (!match) {
        return;
      }
      for (const ancestor of match.path.slice(0, -1)) {
        ancestor.terms = (ancestor.terms || []).filter((item) => wordCloudTermIdentity(item) !== identity);
        ancestor.removedTerms = (ancestor.removedTerms || []).filter(
          (item) => wordCloudTermIdentity(item) !== identity,
        );
      }
      match.cloud.removedTerms = (match.cloud.removedTerms || []).filter(
        (item) => wordCloudTermIdentity(item) !== identity,
      );
      if (!(match.cloud.terms || []).some((item) => wordCloudTermIdentity(item) === identity)) {
        match.cloud.terms = [...(match.cloud.terms || []), normalized];
      }
      draft.unassignedTerms = (draft.unassignedTerms || []).filter(
        (item) => wordCloudTermIdentity(item) !== identity,
      );
    });
  }

  function addTermInputToCloud(wordBagId: string) {
    const value = String(options.wordCloudTermInputs.value[wordBagId] || "").trim();
    if (!value) {
      return;
    }
    addTermToCloud(wordBagId, value);
    options.wordCloudTermInputs.value = {
      ...options.wordCloudTermInputs.value,
      [wordBagId]: "",
    };
  }

  function setWordCloudTermInput(wordBagId: string, value: string) {
    options.wordCloudTermInputs.value = {
      ...options.wordCloudTermInputs.value,
      [wordBagId]: value,
    };
  }

  function removeTermFromCloud(wordBagId: string, term: KnowledgeWordCloudTerm) {
    const identity = wordCloudTermIdentity(term);
    options.mutateWordCloudDraft((draft) => {
      const match = findWordCloudInTree(draft.wordBags || [], wordBagId);
      if (!match) {
        return;
      }
      const removed = options.wordCloudTermWithFrequency(term);
      match.cloud.terms = (match.cloud.terms || []).filter(
        (candidate) => wordCloudTermIdentity(candidate) !== identity,
      );
      if (!(match.cloud.removedTerms || []).some((candidate) => wordCloudTermIdentity(candidate) === identity)) {
        match.cloud.removedTerms = [...(match.cloud.removedTerms || []), { ...removed, removed: true }];
      }
    });
  }

  function clearRemovedTermsFromCloud(wordBagId: string) {
    options.mutateWordCloudDraft((draft) => {
      const match = findWordCloudInTree(draft.wordBags || [], wordBagId);
      if (match) {
        match.cloud.removedTerms = [];
      }
    });
  }

  function addTermActionToCloud(wordBagId: string) {
    options.selectedWordBagId.value = wordBagId;
    options.wordCloudTermInputs.value = {
      ...options.wordCloudTermInputs.value,
      [wordBagId]: options.wordCloudTermInputs.value[wordBagId] || "",
    };
    options.wordBagActionMenuId.value = "";
  }

  return {
    addTermActionToCloud,
    addTermInputToCloud,
    addTermToCloud,
    clearRemovedTermsFromCloud,
    removeTermFromCloud,
    setWordCloudTermInput,
  };
}
