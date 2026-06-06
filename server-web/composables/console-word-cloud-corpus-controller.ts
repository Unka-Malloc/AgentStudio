import { computed, type Ref } from "vue";
import {
  getKnowledgeWordClouds,
  rebuildSourceVocabulary,
  saveKnowledgeWordClouds,
} from "../lib/knowledge-word-cloud-client";
import type {
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import type { WordCloudCorpusAuditAction } from "../types/app";
import {
  normalizeWordCloudCorpusPathForUi,
  normalizeWordCloudCorpusPathsForUi,
  normalizeWordCloudSetForUi,
  preferredWordCloudCorpusPaths as preferredWordCloudCorpusPathsCore,
} from "./console-word-cloud-utils";
import type { ConsoleWordCloudMessage } from "./console-word-cloud-types";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleWordCloudCorpusControllerOptions = {
  applySavedWordCloudSet: (
    wordBagSet: KnowledgeWordCloudSet,
    optionsForSave?: { fallbackCorpusPaths?: KnowledgeWordCloudCorpusPath[] },
  ) => void;
  autoAbsorbWordCloudTerms: (draft: KnowledgeWordCloudSet) => number;
  busyKey: ReadonlyRef<string>;
  canReadKnowledge: ReadonlyRef<boolean>;
  canWriteKnowledge: ReadonlyRef<boolean>;
  clearAllBusy: () => void;
  createDefaultWordCloudSet: (terms?: KnowledgeWordCloudTerm[]) => KnowledgeWordCloudSet;
  error: Ref<string>;
  setBusy: (key: string) => void;
  wordCloudCorpusPaths: Ref<KnowledgeWordCloudCorpusPath[]>;
  wordCloudDraft: Ref<KnowledgeWordCloudSet | null>;
  wordCloudMessages: Ref<ConsoleWordCloudMessage[]>;
  wordCloudModelAlias: Ref<string>;
  wordCloudState: Ref<KnowledgeWordCloudState | null>;
  wordCloudTerms: ReadonlyRef<KnowledgeWordCloudTerm[]>;
};

function createWordCloudSystemMessage(idPrefix: string, text: string): ConsoleWordCloudMessage {
  return {
    id: `${idPrefix}-${Date.now()}`,
    role: "system",
    text,
    at: new Date().toISOString(),
  };
}

export function createConsoleWordCloudCorpusController(
  options: ConsoleWordCloudCorpusControllerOptions,
) {
  function preferredWordCloudCorpusPaths(
    remotePaths: Array<Partial<KnowledgeWordCloudCorpusPath> | string> = [],
    fallbackPaths: Array<Partial<KnowledgeWordCloudCorpusPath> | string> = options.wordCloudCorpusPaths.value,
  ) {
    return preferredWordCloudCorpusPathsCore(remotePaths, fallbackPaths);
  }

  function resolveWordCloudCorpusPathsForQuery(queryOptions: {
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string> | null;
  } = {}) {
    if (queryOptions.corpusPaths !== undefined) {
      return normalizeWordCloudCorpusPathsForUi(queryOptions.corpusPaths || []);
    }
    const draftPaths = normalizeWordCloudCorpusPathsForUi(options.wordCloudDraft.value?.corpusPaths || []);
    if (draftPaths.length > 0) {
      return draftPaths;
    }
    const statePaths = normalizeWordCloudCorpusPathsForUi(
      (options.wordCloudState.value?.wordBagSet?.corpusPaths || options.wordCloudState.value?.corpusPaths || []),
    );
    if (statePaths.length > 0) {
      return statePaths;
    }
    return normalizeWordCloudCorpusPathsForUi(options.wordCloudCorpusPaths.value);
  }

  function wordCloudCorpusPathLabel(item: KnowledgeWordCloudCorpusPath) {
    return item.type === "file" ? "文件" : "目录";
  }

  const wordCloudCorpusPathSummary = computed(() =>
    options.wordCloudCorpusPaths.value.length
      ? `已绑定 ${options.wordCloudCorpusPaths.value.length} 个目录/文件`
      : "",
  );

  function setWordCloudDraftCorpusPaths() {
    if (!options.wordCloudDraft.value) {
      options.wordCloudDraft.value = options.createDefaultWordCloudSet(options.wordCloudTerms.value);
    }
    options.wordCloudDraft.value = {
      ...options.wordCloudDraft.value,
      corpusPaths: normalizeWordCloudCorpusPathsForUi(options.wordCloudCorpusPaths.value),
      updatedAt: new Date().toISOString(),
    };
  }

  function prependCorpusMessage(idPrefix: string, text: string) {
    options.wordCloudMessages.value = [
      createWordCloudSystemMessage(idPrefix, text),
      ...options.wordCloudMessages.value,
    ].slice(0, 20);
  }

  async function persistWordCloudCorpusPaths(
    corpusPaths: KnowledgeWordCloudCorpusPath[] = options.wordCloudCorpusPaths.value,
    persistOptions: {
      auditAction?: WordCloudCorpusAuditAction;
      auditPaths?: KnowledgeWordCloudCorpusPath[];
    } = {},
  ) {
    if (!options.canWriteKnowledge.value) {
      return;
    }
    const draft = options.wordCloudDraft.value || options.createDefaultWordCloudSet(options.wordCloudTerms.value);
    const selectedCorpusPaths = normalizeWordCloudCorpusPathsForUi(corpusPaths);
    try {
      const result = await saveKnowledgeWordClouds({
        wordBagSet: {
          ...draft,
          wordBagCount: draft.wordBags.length,
          termsSnapshot: draft.termsSnapshot?.length ? draft.termsSnapshot : options.wordCloudTerms.value,
          corpusPaths: selectedCorpusPaths,
          modelAlias: options.wordCloudModelAlias.value,
        },
        auditAction: persistOptions.auditAction || "save",
        auditPaths: normalizeWordCloudCorpusPathsForUi(persistOptions.auditPaths || selectedCorpusPaths),
        limit: 100000,
        minFrequency: 1,
      });
      options.applySavedWordCloudSet(result.wordBagSet, {
        fallbackCorpusPaths: selectedCorpusPaths,
      });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "保存词云语料范围失败。";
    }
  }

  async function refreshWordCloudCorpusTerms(refreshOptions: {
    silent?: boolean;
    forceRebuild?: boolean;
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string> | null;
  } = {}) {
    if (!options.canReadKnowledge.value) {
      return [];
    }
    const targetCorpusPaths = resolveWordCloudCorpusPathsForQuery({ corpusPaths: refreshOptions.corpusPaths });
    if (!refreshOptions.silent) {
      options.setBusy("knowledge:word-clouds:scope");
    }
    options.error.value = "";
    let state = null as KnowledgeWordCloudState | null;
    try {
      state = await getKnowledgeWordClouds({
        limit: 100000,
        minFrequency: 1,
        corpusPaths: targetCorpusPaths,
      });
      const savedCorpusPaths = normalizeWordCloudCorpusPathsForUi(state.wordBagSet?.corpusPaths || []);
      if (targetCorpusPaths.length === 0 && savedCorpusPaths.length > 0) {
        state = await getKnowledgeWordClouds({
          limit: 100000,
          minFrequency: 1,
          corpusPaths: savedCorpusPaths,
        });
      }
      if (
        refreshOptions.forceRebuild &&
        targetCorpusPaths.length > 0 &&
        (state.terms || []).length === 0
      ) {
        prependCorpusMessage(
          "word-cloud-scope-rebuild",
          "已检测到语料范围内无本地词频，正在重建词频索引。",
        );
        await rebuildSourceVocabulary();
        state = await getKnowledgeWordClouds({
          limit: 100000,
          minFrequency: 1,
          corpusPaths: targetCorpusPaths,
        });
        prependCorpusMessage(
          "word-cloud-scope-rebuild",
          state.terms?.length
            ? `已重建并读取 ${state.terms.length} 个语料词。`
            : "语料范围重建后仍无可用词频。请确认目录下存在已入库文档。",
        );
      }
      options.wordCloudState.value = {
        ...(options.wordCloudState.value || state),
        terms: state.terms || [],
        corpusPaths: state.corpusPaths || targetCorpusPaths,
      };
      if (!options.wordCloudDraft.value) {
        options.wordCloudDraft.value = options.createDefaultWordCloudSet(state.terms || []);
      }
      options.wordCloudDraft.value = normalizeWordCloudSetForUi({
        ...options.wordCloudDraft.value,
        termsSnapshot: state.terms || [],
        unassignedTerms: state.terms || [],
        corpusPaths: targetCorpusPaths,
      });
      options.autoAbsorbWordCloudTerms(options.wordCloudDraft.value);
      if (targetCorpusPaths.length > 0) {
        options.wordCloudCorpusPaths.value = targetCorpusPaths;
      }
      prependCorpusMessage(
        "word-cloud-scope",
        `已按绑定路径读取 ${state.terms?.length || 0} 个语料词。`,
      );
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "刷新词云语料范围失败。";
      prependCorpusMessage("word-cloud-scope-error", options.error.value);
      if (state && state.terms) {
        return state.terms || [];
      }
    } finally {
      if (!refreshOptions.silent && options.busyKey.value === "knowledge:word-clouds:scope") {
        options.clearAllBusy();
      }
    }
    return state?.terms || [];
  }

  async function addWordCloudCorpusPaths(nextItems: Array<{ path: string; type: "directory" | "file" }>) {
    const normalizedItems = nextItems
      .map((item) => normalizeWordCloudCorpusPathForUi(item))
      .filter((item): item is KnowledgeWordCloudCorpusPath => Boolean(item));
    const existingKeys = new Set(
      options.wordCloudCorpusPaths.value.map((item) => `${item.type || ""}:${item.path}`.toLowerCase()),
    );
    const addedItems = normalizedItems.filter(
      (item) => !existingKeys.has(`${item.type || ""}:${item.path}`.toLowerCase()),
    );
    if (addedItems.length === 0) {
      return;
    }
    options.wordCloudCorpusPaths.value = normalizeWordCloudCorpusPathsForUi([
      ...options.wordCloudCorpusPaths.value,
      ...addedItems,
    ]);
    const selectedCorpusPaths = normalizeWordCloudCorpusPathsForUi(options.wordCloudCorpusPaths.value);
    setWordCloudDraftCorpusPaths();
    prependCorpusMessage(
      "word-cloud-corpus",
      `已绑定 ${addedItems.length} 个语料范围，正在刷新词频。`,
    );
    await persistWordCloudCorpusPaths(selectedCorpusPaths, {
      auditAction: "add",
      auditPaths: addedItems,
    });
    if (options.canReadKnowledge.value) {
      await refreshWordCloudCorpusTerms({ corpusPaths: selectedCorpusPaths });
    }
  }

  async function removeWordCloudCorpusPath(index: number) {
    const removedPath = options.wordCloudCorpusPaths.value[index];
    options.wordCloudCorpusPaths.value = options.wordCloudCorpusPaths.value.filter(
      (_, itemIndex) => itemIndex !== index,
    );
    setWordCloudDraftCorpusPaths();
    await persistWordCloudCorpusPaths(options.wordCloudCorpusPaths.value, {
      auditAction: "remove",
      auditPaths: removedPath ? [removedPath] : [],
    });
    if (options.canReadKnowledge.value) {
      await refreshWordCloudCorpusTerms({ corpusPaths: options.wordCloudCorpusPaths.value });
    }
  }

  async function clearWordCloudCorpusPaths() {
    const removedPaths = options.wordCloudCorpusPaths.value;
    options.wordCloudCorpusPaths.value = [];
    setWordCloudDraftCorpusPaths();
    await persistWordCloudCorpusPaths(options.wordCloudCorpusPaths.value, {
      auditAction: "clear",
      auditPaths: removedPaths,
    });
    if (options.canReadKnowledge.value) {
      await refreshWordCloudCorpusTerms({ corpusPaths: [] });
    }
  }

  return {
    addWordCloudCorpusPaths,
    clearWordCloudCorpusPaths,
    persistWordCloudCorpusPaths,
    preferredWordCloudCorpusPaths,
    refreshWordCloudCorpusTerms,
    removeWordCloudCorpusPath,
    resolveWordCloudCorpusPathsForQuery,
    setWordCloudDraftCorpusPaths,
    wordCloudCorpusPathLabel,
    wordCloudCorpusPathSummary,
  };
}
