import type { Ref } from "vue";
import {
  getKnowledgeWordClouds,
  proposeKnowledgeWordClouds,
  saveKnowledgeWordClouds,
} from "../lib/knowledge-word-cloud-client";
import type {
  KnowledgeWordCloud,
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import {
  findWordCloudInTree,
} from "./console-word-cloud-utils";
import type {
  ConsoleWordCloudAgentOption,
  ConsoleWordCloudMessage,
} from "./console-word-cloud-types";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleWordCloudWorkflowControllerOptions = {
  addTermToCloud: (wordBagId: string, term: KnowledgeWordCloudTerm | string) => void;
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
  fillingWordBagIds: Ref<Set<string>>;
  fillSourceWordBagSetId: Ref<string | null>;
  fillTargetWordBagId: Ref<string | null>;
  refreshWordCloudCorpusTerms: (options?: {
    silent?: boolean;
    forceRebuild?: boolean;
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string> | null;
  }) => Promise<KnowledgeWordCloudTerm[]>;
  resolveWordCloudCorpusPathsForQuery: (options?: {
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string> | null;
  }) => KnowledgeWordCloudCorpusPath[];
  selectedWordCloudModel: ReadonlyRef<ConsoleWordCloudAgentOption>;
  setBusy: (key: string) => void;
  setWordCloudDraftFromState: (state: KnowledgeWordCloudState | null) => void;
  wordCloudCorpusPaths: Ref<KnowledgeWordCloudCorpusPath[]>;
  wordCloudDraft: Ref<KnowledgeWordCloudSet | null>;
  wordCloudMessages: Ref<ConsoleWordCloudMessage[]>;
  wordCloudModelAlias: Ref<string>;
  wordCloudPrompt: Ref<string>;
  wordCloudState: Ref<KnowledgeWordCloudState | null>;
  wordCloudTerms: ReadonlyRef<KnowledgeWordCloudTerm[]>;
};

function collectWordCloudTerms(
  wordBags: KnowledgeWordCloud[] = [],
  target: KnowledgeWordCloudTerm[] = [],
) {
  for (const wordBag of wordBags) {
    target.push(...(wordBag.terms || []));
    collectWordCloudTerms(wordBag.children || [], target);
  }
  return target;
}

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

  async function proposeWordCloud() {
    if (!options.canWriteKnowledge.value) {
      options.error.value = "需要 knowledge:write 权限才能调用智能体生成词云。";
      return;
    }
    if (!options.selectedWordCloudModel.value.enabled) {
      options.error.value = options.selectedWordCloudModel.value.disabledReason || "请选择一个可用智能体。";
      return;
    }
    options.setBusy("knowledge:word-clouds:propose");
    options.error.value = "";
    const prompt = options.wordCloudPrompt.value.trim();
    if (!prompt) {
      options.error.value = "请输入词云分组意图。";
      options.clearAllBusy();
      return;
    }
    const corpusPaths = options.resolveWordCloudCorpusPathsForQuery();
    if (corpusPaths.length === 0) {
      options.error.value = "请先添加语料范围后再启动分类任务。";
      prependWordCloudMessage(
        options.wordCloudMessages,
        createWordCloudMessage("word-cloud-error", "system", options.error.value),
      );
      options.clearAllBusy();
      return;
    }
    prependWordCloudMessage(
      options.wordCloudMessages,
      createWordCloudMessage("word-cloud-user", "user", prompt),
    );
    try {
      const preparedTerms = await options.refreshWordCloudCorpusTerms({
        silent: true,
        forceRebuild: true,
        corpusPaths,
      });
      if ((preparedTerms || []).length === 0) {
        options.error.value = corpusPaths.length > 0
          ? "已扫描语料范围但未发现可用词频，建议确认目录下有已入库文档并重新启动该任务。"
          : "请先添加语料范围后再启动分类任务。";
        prependWordCloudMessage(
          options.wordCloudMessages,
          createWordCloudMessage("word-cloud-error", "system", options.error.value),
        );
        return;
      }
      const result = await proposeKnowledgeWordClouds({
        modelAlias: options.selectedWordCloudModel.value.value,
        prompt,
        minFrequency: 1,
        corpusPaths,
      });
      options.wordCloudPrompt.value = "";
      options.applySavedWordCloudSet(result.wordBagSet);
      prependWordCloudMessage(
        options.wordCloudMessages,
        createWordCloudMessage(
          "word-cloud-agent",
          "agent",
          result.run?.runId
            ? "词云分类后台任务已启动。"
            : `已生成 ${result.wordBagSet?.wordBags?.length || 0} 朵词云。`,
        ),
      );
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "智能体生成词云失败。";
      prependWordCloudMessage(
        options.wordCloudMessages,
        createWordCloudMessage("word-cloud-error", "system", options.error.value),
      );
    } finally {
      if (options.busyKey.value === "knowledge:word-clouds:propose") {
        options.clearAllBusy();
      }
    }
  }

  async function autoFillCloudWithAgent(wordBagId: string) {
    const match = findWordCloudInTree(options.wordCloudDraft.value?.wordBags || [], wordBagId);
    const cloud = match?.cloud;
    if (!cloud) {
      return;
    }
    const label = (cloud.label || "").trim();
    if (!label) {
      options.error.value = "请先填写词云名称后再调用智能体填充。";
      return;
    }
    if (!options.selectedWordCloudModel.value.enabled) {
      options.error.value = options.selectedWordCloudModel.value.disabledReason || "请选择一个可用智能体。";
      return;
    }
    const corpusPaths = options.resolveWordCloudCorpusPathsForQuery();
    if (corpusPaths.length === 0) {
      options.error.value = "请先添加语料范围后再启动填充任务。";
      return;
    }
    options.fillingWordBagIds.value = new Set([...options.fillingWordBagIds.value, wordBagId]);
    options.error.value = "";
    try {
      const result = await proposeKnowledgeWordClouds({
        modelAlias: options.selectedWordCloudModel.value.value,
        prompt: label,
        minFrequency: 1,
        corpusPaths,
      });
      options.fillTargetWordBagId.value = wordBagId;
      options.fillSourceWordBagSetId.value = result.wordBagSet.wordBagSetId;
    } catch (err) {
      options.fillingWordBagIds.value = new Set(
        [...options.fillingWordBagIds.value].filter((id) => id !== wordBagId),
      );
      options.error.value = err instanceof Error ? err.message : "智能体填充词云失败。";
    }
  }

  function applyWordCloudEvent(wordBagSet: KnowledgeWordCloudSet) {
    if (
      options.fillSourceWordBagSetId.value &&
      wordBagSet.wordBagSetId === options.fillSourceWordBagSetId.value
    ) {
      const targetId = options.fillTargetWordBagId.value;
      if (targetId) {
        for (const term of collectWordCloudTerms(wordBagSet.wordBags || [])) {
          options.addTermToCloud(targetId, term);
        }
        const isDone = wordBagSet.status === "ready" ||
          wordBagSet.status === "completed" ||
          wordBagSet.status === "error";
        if (isDone) {
          options.fillTargetWordBagId.value = null;
          options.fillSourceWordBagSetId.value = null;
          options.fillingWordBagIds.value = new Set(
            [...options.fillingWordBagIds.value].filter((id) => id !== targetId),
          );
        }
      }
      return true;
    }
    options.applySavedWordCloudSet(wordBagSet);
    return true;
  }

  return {
    applyWordCloudEvent,
    autoFillCloudWithAgent,
    proposeWordCloud,
    refreshWordCloud,
    saveWordCloud,
  };
}
