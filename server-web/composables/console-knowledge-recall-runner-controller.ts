import { computed, ref, type ComputedRef, type Ref } from "vue";
import { searchKnowledge as searchKnowledgeApi } from "../lib/knowledge-search-client";
import type {
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  MaintenanceSettings,
} from "../lib/types";
import type {
  DebugTab,
  KnowledgeRecallDebugRun,
  OptionBarOption,
} from "../types/app";
import {
  knowledgeResultEvidenceId,
  normalizeSearchResults,
} from "./console-knowledge-search-utils";
import { asRecord } from "./console-model-utils";
import type {
  KnowledgeRecallDebugFormState,
  KnowledgeRecallDebugTarget,
  KnowledgeSearchFormState,
} from "./console-knowledge-recall-types";

type ConsoleKnowledgeRecallRunnerControllerOptions = {
  canReadKnowledge: ComputedRef<boolean>;
  clearAllBusy: () => void;
  clearSelectedEvidence: () => void;
  error: Ref<string>;
  knowledgeMaintenanceDraft: Ref<MaintenanceSettings>;
  knowledgeRecallDebugForm: Ref<KnowledgeRecallDebugFormState>;
  knowledgeRecallDebugModeOptionBarOptions: ComputedRef<OptionBarOption[]>;
  knowledgeSearchForm: Ref<KnowledgeSearchFormState>;
  knowledgeSearchResponse: Ref<KnowledgeSearchResponse | null>;
  knowledgeSearchResults: Ref<KnowledgeSearchResult[]>;
  lastKnowledgeSearchQuery: Ref<string>;
  loadEvidence: (evidenceId: string) => Promise<void>;
  openDebugTab: (tab: DebugTab) => void;
  selectedKnowledgeRecallDebugTarget: ComputedRef<KnowledgeRecallDebugTarget>;
  setBusy: (key: string) => void;
};

export function createConsoleKnowledgeRecallRunnerController(
  options: ConsoleKnowledgeRecallRunnerControllerOptions,
) {
  const knowledgeRecallDebugRuns = ref<KnowledgeRecallDebugRun[]>([]);
  let knowledgeRecallDebugSequence = 0;

  function currentKnowledgeRetrievalSettings(): Record<string, unknown> {
    const retrieval = asRecord(options.knowledgeMaintenanceDraft.value.retrieval) || {};
    return { ...retrieval };
  }

  function retrievalProfileId(retrievalProfile: Record<string, unknown>) {
    return String(retrievalProfile.retrievalProfileId || "");
  }

  function currentKnowledgeLearningEnabled() {
    const learning = asRecord(options.knowledgeMaintenanceDraft.value.learning) || {};
    const retrieval = currentKnowledgeRetrievalSettings();
    return learning.enabled !== false && retrieval.learningEnabled !== false;
  }

  function currentKnowledgeSearchLimit() {
    const retrieval = currentKnowledgeRetrievalSettings();
    const topK = Number(retrieval.topK || 20);
    return Math.max(1, Math.min(Number.isFinite(topK) ? topK : 20, 100));
  }

  async function searchKnowledge() {
    const query = options.knowledgeSearchForm.value.query.trim();
    if (!query) {
      options.error.value = "请输入知识召回调试问题。";
      return;
    }
    if (!options.canReadKnowledge.value) {
      options.error.value = "当前账号没有知识库读取权限。";
      return;
    }
    options.setBusy("knowledge:search");
    options.error.value = "";
    options.openDebugTab("knowledgeRecall");
    options.clearSelectedEvidence();
    try {
      const retrievalProfile = currentKnowledgeRetrievalSettings();
      const result = await searchKnowledgeApi({
        query,
        limit: currentKnowledgeSearchLimit(),
        retrievalMode: "hybrid",
        keywordOnly: false,
        retrievalProfile,
        profile: { retrieval: retrievalProfile },
        retrievalProfileId: retrievalProfileId(retrievalProfile),
        clientId: "server-console-knowledge-recall",
        requestSurface: "console",
        responseProfile: "console",
        explain: true,
        learningEnabled: currentKnowledgeLearningEnabled(),
      });
      options.knowledgeSearchResponse.value = result;
      options.knowledgeSearchResults.value = normalizeSearchResults(result);
      options.lastKnowledgeSearchQuery.value = query;
      const firstEvidenceId = options.knowledgeSearchResults.value
        .map((item) => knowledgeResultEvidenceId(item))
        .find(Boolean);
      if (firstEvidenceId) {
        await options.loadEvidence(firstEvidenceId);
      }
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "知识召回失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  function currentKnowledgeRecallTopK() {
    const settings = currentKnowledgeRetrievalSettings();
    const topK = Number(settings.topK || 20);
    return Math.max(1, Math.min(Number.isFinite(topK) ? Math.floor(topK) : 20, 100));
  }

  function buildKnowledgeRecallSearchPayload(query: string) {
    const topK = currentKnowledgeRecallTopK();
    const target = options.selectedKnowledgeRecallDebugTarget.value;
    const retrievalMode = String(
      options.knowledgeRecallDebugModeOptionBarOptions.value.some((option) => option.value === options.knowledgeRecallDebugForm.value.retrievalMode)
        ? options.knowledgeRecallDebugForm.value.retrievalMode
        : options.knowledgeRecallDebugModeOptionBarOptions.value[0]?.value || "hybrid",
    );
    const retrievalProfile = {
      ...currentKnowledgeRetrievalSettings(),
      topK,
    };
    const payload: Record<string, unknown> = {
      query,
      limit: topK,
      retrievalMode,
      keywordOnly: options.knowledgeRecallDebugForm.value.keywordOnly,
      retrievalProfile,
      profile: { retrieval: retrievalProfile },
      retrievalProfileId: retrievalProfileId(retrievalProfile),
      clientId: "server-console-debug-knowledge-recall",
      explain: options.knowledgeRecallDebugForm.value.explain,
      learningEnabled: options.knowledgeRecallDebugForm.value.learningEnabled,
    };
    if (target?.kind === "external") {
      payload.knowledgeBackend = true;
      payload.externalKnowledgeBase = true;
      payload.provider = target.provider || "";
      payload.spaceId = target.spaceId || "";
      payload.backendRef = target.spaceId || "";
    } else if (target?.kind === "source" && target.sourceId) {
      payload.sourceIds = [target.sourceId];
      payload.scopeSourceIds = [target.sourceId];
    }
    return payload;
  }

  const knowledgeRecallDebugGridStyle = computed<Record<string, string>>(() => ({
    "--debug-compare-columns": String(Math.max(1, knowledgeRecallDebugRuns.value.length || 1)),
  }));

  async function runKnowledgeRecallDebugBatch() {
    const query = options.knowledgeRecallDebugForm.value.query.trim();
    if (!query) {
      options.error.value = "请输入知识召回调试问题。";
      return;
    }
    if (!options.canReadKnowledge.value) {
      options.error.value = "当前账号没有知识库读取权限。";
      return;
    }
    const topK = currentKnowledgeRecallTopK();
    const sequence = ++knowledgeRecallDebugSequence;
    options.setBusy("debug:knowledge-recall");
    options.error.value = "";
    knowledgeRecallDebugRuns.value = [{
      runId: `knowledge-recall-${Date.now()}`,
      label: "召回结果",
      topK,
      status: "queued",
      elapsedMs: 0,
      startedAt: "",
      response: null,
      items: [],
      error: "",
    }];
    try {
      await Promise.all(
        knowledgeRecallDebugRuns.value.map(async (run) => {
          const started = performance.now();
          run.status = "running";
          run.startedAt = new Date().toISOString();
          try {
            const response = await searchKnowledgeApi(buildKnowledgeRecallSearchPayload(query));
            run.response = response;
            run.items = normalizeSearchResults(response);
            run.status = "completed";
          } catch (nextError) {
            run.error = nextError instanceof Error ? nextError.message : "知识召回失败。";
            run.status = "failed";
          } finally {
            run.elapsedMs = Math.max(0, Math.round(performance.now() - started));
          }
        }),
      );
      if (sequence === knowledgeRecallDebugSequence) {
        options.lastKnowledgeSearchQuery.value = query;
      }
    } finally {
      if (sequence === knowledgeRecallDebugSequence) {
        options.clearAllBusy();
      }
    }
  }

  return {
    buildKnowledgeRecallSearchPayload,
    currentKnowledgeLearningEnabled,
    currentKnowledgeRetrievalSettings,
    currentKnowledgeSearchLimit,
    knowledgeRecallDebugGridStyle,
    knowledgeRecallDebugRuns,
    runKnowledgeRecallDebugBatch,
    searchKnowledge,
  };
}
