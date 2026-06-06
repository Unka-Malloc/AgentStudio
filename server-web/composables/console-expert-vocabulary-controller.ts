import { computed, ref, watch, type Ref } from "vue";
import {
  getExpertVocabulary,
  saveExpertVocabulary as saveExpertVocabularyRequest,
} from "../lib/knowledge-rules-client";
import type { ExpertVocabulary, ExpertVocabularyEntry } from "../lib/types";
import { emptyExpertVocabulary } from "./console-defaults";

type ConsoleExpertVocabularyControllerOptions = {
  applyRemoteConsoleDraftUpdate: (update: () => void) => void;
  clearAllBusy: () => void;
  error: Ref<string>;
  isApplyingRemoteConsoleDrafts: () => boolean;
  refreshState: (options?: { forceDrafts?: boolean }) => Promise<void>;
  setBusy: (key: string) => void;
};

function remoteDraftEquals(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneExpertVocabulary(vocabulary: ExpertVocabulary): ExpertVocabulary {
  return {
    ...emptyExpertVocabulary,
    ...JSON.parse(JSON.stringify(vocabulary || emptyExpertVocabulary)),
  };
}

function splitVocabularyList(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function vocabularyEntryPath(entry: ExpertVocabularyEntry) {
  return (entry.pathSegments || []).join("/");
}

export function createConsoleExpertVocabularyController(
  options: ConsoleExpertVocabularyControllerOptions,
) {
  const vocabularySearch = ref("");
  const showAllVocabularyEntries = ref(false);
  const expertVocabularyDraft = ref<ExpertVocabulary>({
    ...emptyExpertVocabulary,
    entries: [],
  });
  const expertVocabularyDraftDirty = ref(false);

  watch(
    expertVocabularyDraft,
    () => {
      if (!options.isApplyingRemoteConsoleDrafts()) {
        expertVocabularyDraftDirty.value = true;
      }
    },
    { deep: true, flush: "sync" },
  );

  function replaceExpertVocabularyDraftFromServer(
    vocabulary: ExpertVocabulary | null | undefined,
    optionsForReplace: { markClean?: boolean } = {},
  ) {
    const nextDraft = cloneExpertVocabulary(
      vocabulary || emptyExpertVocabulary,
    );
    if (remoteDraftEquals(expertVocabularyDraft.value, nextDraft)) {
      if (optionsForReplace.markClean !== false) {
        expertVocabularyDraftDirty.value = false;
      }
      return;
    }
    options.applyRemoteConsoleDraftUpdate(() => {
      expertVocabularyDraft.value = nextDraft;
      if (optionsForReplace.markClean !== false) {
        expertVocabularyDraftDirty.value = false;
      }
    });
  }

  const displayedVocabularyEntries = computed(() => {
    const query = vocabularySearch.value.trim().toLowerCase();
    const entries = (expertVocabularyDraft.value.entries || []).map((entry, index) => ({
      entry,
      index,
    }));
    const filtered = query
      ? entries.filter(({ entry }) => {
          const haystack = [
            vocabularyEntryPath(entry),
            entry.label,
            ...(entry.keywords || []),
            ...(entry.domains || []),
            entry.status,
            entry.notes,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : entries;

    return showAllVocabularyEntries.value || query
      ? filtered
      : filtered.slice(0, 8);
  });

  const hiddenVocabularyEntryCount = computed(() =>
    vocabularySearch.value.trim()
      ? 0
      : Math.max(0, (expertVocabularyDraft.value.entries || []).length - displayedVocabularyEntries.value.length),
  );

  function updateVocabularyEntry(index: number, patch: Partial<ExpertVocabularyEntry>) {
    expertVocabularyDraft.value.entries = expertVocabularyDraft.value.entries.map(
      (entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              ...patch,
            }
          : entry,
    );
  }

  function updateVocabularyPath(index: number, value: string) {
    updateVocabularyEntry(index, {
      pathSegments: value
        .split("/")
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }

  function updateVocabularyKeywords(index: number, value: string) {
    updateVocabularyEntry(index, {
      keywords: splitVocabularyList(value),
    });
  }

  function updateVocabularyDomains(index: number, value: string) {
    updateVocabularyEntry(index, {
      domains: splitVocabularyList(value),
    });
  }

  function addVocabularyEntry() {
    const now = Date.now();
    showAllVocabularyEntries.value = true;
    expertVocabularyDraft.value.entries = [
      ...expertVocabularyDraft.value.entries,
      {
        id: `draft-${now}`,
        pathSegments: ["未分类"],
        label: "新词条",
        keywords: [],
        domains: [],
        status: "draft",
        notes: "",
      },
    ];
  }

  function deleteVocabularyEntry(index: number) {
    expertVocabularyDraft.value.entries =
      expertVocabularyDraft.value.entries.filter((_, entryIndex) => entryIndex !== index);
  }

  function setVocabularyEntryEnabled(index: number, enabled: boolean) {
    updateVocabularyEntry(index, {
      status: enabled ? "active" : "retired",
    });
  }

  async function loadExpertVocabulary(forceDrafts: boolean) {
    const vocabularyResult = await getExpertVocabulary();
    if (forceDrafts || !expertVocabularyDraftDirty.value) {
      replaceExpertVocabularyDraftFromServer(vocabularyResult.vocabulary);
    }
  }

  async function saveExpertVocabulary() {
    options.setBusy("expert-vocabulary");
    options.error.value = "";

    try {
      await saveExpertVocabularyRequest(expertVocabularyDraft.value);
      expertVocabularyDraftDirty.value = false;
      await options.refreshState({ forceDrafts: false });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "保存专家词汇库失败。";
      options.clearAllBusy();
    }
  }

  return {
    addVocabularyEntry,
    cloneExpertVocabulary,
    deleteVocabularyEntry,
    displayedVocabularyEntries,
    expertVocabularyDraft,
    expertVocabularyDraftDirty,
    hiddenVocabularyEntryCount,
    loadExpertVocabulary,
    replaceExpertVocabularyDraftFromServer,
    saveExpertVocabulary,
    setVocabularyEntryEnabled,
    showAllVocabularyEntries,
    splitVocabularyList,
    updateVocabularyDomains,
    updateVocabularyEntry,
    updateVocabularyKeywords,
    updateVocabularyPath,
    vocabularyEntryPath,
    vocabularySearch,
  };
}
