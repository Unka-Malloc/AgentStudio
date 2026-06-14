import type { Ref } from "vue";
import {
  getKnowledgeWordClouds,
  saveKnowledgeWordClouds,
} from "../lib/knowledge-word-cloud-client";
import type {
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import type { ConsoleWordCloudMessage } from "./console-word-cloud-types";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleWordCloudWorkflowControllerOptions = {
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
  resolveWordCloudCorpusPathsForQuery: (options?: {
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string> | null;
  }) => KnowledgeWordCloudCorpusPath[];
  setBusy: (key: string) => void;
  setWordCloudDraftFromState: (state: KnowledgeWordCloudState | null) => void;
  wordCloudCorpusPaths: Ref<KnowledgeWordCloudCorpusPath[]>;
  wordCloudDraft: Ref<KnowledgeWordCloudSet | null>;
  wordCloudMessages: Ref<ConsoleWordCloudMessage[]>;
  wordCloudModelAlias: Ref<string>;
  wordCloudState: Ref<KnowledgeWordCloudState | null>;
  wordCloudTerms: ReadonlyRef<KnowledgeWordCloudTerm[]>;
};

function createWordCloudMessage(
  idPrefix: string,
  role: ConsoleWordCloudMessage["role"],
  text: string,
): ConsoleWordCloudMessage {
  return {
    id: `${idPrefix}-${Date.now()}`,
    role,
    text,
    at: new Date().toISOString(),
  };
}

function prependWordCloudMessage(
  messages: Ref<ConsoleWordCloudMessage[]>,
  message: ConsoleWordCloudMessage,
) {
  messages.value = [message, ...messages.value].slice(0, 20);
}

export function createConsoleWordCloudWorkflowController(
  options: ConsoleWordCloudWorkflowControllerOptions,
) {
  async function refreshWordCloud(optionsForRefresh: { silent?: boolean } = {}) {
    if (!options.canReadKnowledge.value) {
      return;
    }
    if (!optionsForRefresh.silent) {
      options.setBusy("knowledge:word-clouds");
    }
    options.error.value = "";
    const targetCorpusPaths = options.resolveWordCloudCorpusPathsForQuery();
    try {
      const state = await getKnowledgeWordClouds({
        limit: 100000,
        minFrequency: 1,
        corpusPaths: targetCorpusPaths,
      });
      options.wordCloudState.value = state;
      options.setWordCloudDraftFromState(state);
      if (options.wordCloudMessages.value.length === 0) {
        options.wordCloudMessages.value = [
          createWordCloudMessage(
            "word-cloud-system",
            "system",
            `已读取 ${state.terms?.length || 0} 个语料词。`,
          ),
        ];
      }
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "加载词云失败。";
    } finally {
      if (!optionsForRefresh.silent && options.busyKey.value === "knowledge:word-clouds") {
        options.clearAllBusy();
      }
    }
  }

  async function saveWordCloud() {
    if (!options.canWriteKnowledge.value) {
      options.error.value = "需要 knowledge:write 权限才能保存词云。";
      return;
    }
    const draft = options.wordCloudDraft.value || options.createDefaultWordCloudSet(options.wordCloudTerms.value);
    options.autoAbsorbWordCloudTerms(draft);
    options.setBusy("knowledge:word-clouds:save");
    options.error.value = "";
    try {
      const result = await saveKnowledgeWordClouds({
        wordBagSet: {
          ...draft,
          wordBagCount: draft.wordBags.length,
          termsSnapshot: options.wordCloudTerms.value,
          corpusPaths: options.wordCloudCorpusPaths.value,
          modelAlias: options.wordCloudModelAlias.value,
        },
        limit: 100000,
        minFrequency: 1,
      });
      options.applySavedWordCloudSet(result.wordBagSet);
      prependWordCloudMessage(
        options.wordCloudMessages,
        createWordCloudMessage("word-cloud-save", "system", "词云已保存到本地。"),
      );
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "保存词云失败。";
    } finally {
      if (options.busyKey.value === "knowledge:word-clouds:save") {
        options.clearAllBusy();
      }
    }
  }

  function applyWordCloudEvent(wordBagSet: KnowledgeWordCloudSet) {
    options.applySavedWordCloudSet(wordBagSet);
    return true;
  }

  return {
    applyWordCloudEvent,
    refreshWordCloud,
    saveWordCloud,
  };
}
