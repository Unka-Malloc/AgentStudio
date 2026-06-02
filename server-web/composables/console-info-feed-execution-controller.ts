import type {
  AgentExploreRunResponse,
  KnowledgeSearchResponse,
} from "../lib/types";
import type {
  InfoFeedClarification,
  InfoFeedClarificationOption,
  InfoFeedExpertFeedback,
  InfoFeedRunState,
} from "../types/app";
import {
  clearInfoFeedRetryState,
} from "./console-info-feed-run-utils";
import { createConsoleInfoFeedExpertFeedbackController } from "./console-info-feed-expert-feedback-controller";
import { createConsoleInfoFeedSummaryRunnerController } from "./console-info-feed-summary-runner-controller";
import { createConsoleInfoFeedTrackController } from "./console-info-feed-track-controller";
import type { Ref } from "vue";

type ReadonlyRef<T> = {
  readonly value: T;
};

type InfoFeedFormState = {
  query: string;
  modelAlias: string;
  contextProfileId: string;
  temperature: number;
  maxTokens: number;
};

type InfoFeedExecutionModelOption = {
  value: string;
  enabled: boolean;
};

type InfoFeedExecutionContextProfile = {
  value: string;
};

type InfoFeedKeywordCache = Map<string, { response: KnowledgeSearchResponse; cachedAt: number }>;

export type ConsoleInfoFeedExecutionControllerOptions = {
  agentExploreConfiguredLimit: ReadonlyRef<number>;
  agentExploreConfiguredMaxIterations: ReadonlyRef<number>;
  agentExploreThinkingParameters: () => Record<string, unknown>;
  applyInfoFeedSummaryAnswer: (
    run: InfoFeedRunState,
    answer: string,
    fallback: boolean,
    error?: string,
  ) => void;
  archiveInfoFeedExpertFeedback: (
    run: InfoFeedRunState,
    clarification: InfoFeedClarification,
    option: InfoFeedClarificationOption,
  ) => InfoFeedExpertFeedback;
  buildInfoFeedAgentQuery: (run: InfoFeedRunState) => string;
  buildInfoFeedSourceSearchQuery: (run: InfoFeedRunState) => string;
  buildInfoFeedSummaryQuestion: (run: InfoFeedRunState) => string;
  canReadKnowledge: ReadonlyRef<boolean>;
  createInfoFeedRun: (query: string) => InfoFeedRunState;
  error: Ref<string>;
  fallbackInfoFeedSummary: (run: InfoFeedRunState) => string;
  infoFeedAgentExpertGuidance: (run: InfoFeedRunState) => unknown;
  infoFeedAgentProgressFromResult: (result: AgentExploreRunResponse | null, maxIterations: number) => number;
  infoFeedAgentRecentTurns: (run: InfoFeedRunState) => unknown;
  infoFeedCanFollowUp: ReadonlyRef<boolean>;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedForm: Ref<InfoFeedFormState>;
  infoFeedKeywordCache: InfoFeedKeywordCache;
  infoFeedParentRunSnapshot: Ref<InfoFeedRunState | null>;
  infoFeedReadyForSummary: ReadonlyRef<boolean>;
  infoFeedRunEvidenceRefs: (run: InfoFeedRunState) => string[];
  infoFeedRunSequence: Ref<number>;
  resetInfoFeedRunForContinuation: (run: InfoFeedRunState, question: string) => void;
  selectedInfoFeedContextProfile: ReadonlyRef<InfoFeedExecutionContextProfile>;
  selectedInfoFeedModel: ReadonlyRef<InfoFeedExecutionModelOption>;
  selectedThinkingMode: ReadonlyRef<string>;
  upsertInfoFeedHistory: (run: InfoFeedRunState | null) => void;
};

export function createConsoleInfoFeedExecutionController(
  options: ConsoleInfoFeedExecutionControllerOptions,
) {
  const {
    runInfoFeedAgentTrack,
    runInfoFeedKeywordTrack,
  } = createConsoleInfoFeedTrackController(options);
  const { syncInfoFeedExpertFeedback } = createConsoleInfoFeedExpertFeedbackController(options);
  const { runInfoFeedSummaryAgent } = createConsoleInfoFeedSummaryRunnerController(options);

  async function executeInfoFeedRunIteration(sequence: number, run: InfoFeedRunState) {
    const sourceSearchQuery = options.buildInfoFeedSourceSearchQuery(run);
    const agentQuery = options.buildInfoFeedAgentQuery(run);
    await Promise.allSettled([
      runInfoFeedKeywordTrack(sequence, run.runId, sourceSearchQuery),
      runInfoFeedAgentTrack(sequence, run.runId, agentQuery),
    ]);
    if (
      sequence !== options.infoFeedRunSequence.value ||
      options.infoFeedCurrentRun.value?.runId !== run.runId
    ) {
      return;
    }
    if (run.pausedForModelSelection || run.pausedForRetry) {
      options.upsertInfoFeedHistory(run);
      return;
    }
    await runInfoFeedSummaryAgent(sequence);
  }

  async function continueInfoFeedCurrentRun(question: string) {
    const run = options.infoFeedCurrentRun.value;
    if (!run) {
      return;
    }
    if (!options.canReadKnowledge.value) {
      options.error.value = "当前账号没有知识库读取权限。";
      return;
    }
    if (!options.selectedInfoFeedModel.value.enabled) {
      options.error.value = "请选择模型库中已配置且支持智能体调用的模型。";
      return;
    }
    options.error.value = "";
    options.infoFeedParentRunSnapshot.value = null;
    options.resetInfoFeedRunForContinuation(run, question);
    options.upsertInfoFeedHistory(run);
    const sequence = options.infoFeedRunSequence.value + 1;
    options.infoFeedRunSequence.value = sequence;
    await executeInfoFeedRunIteration(sequence, run);
  }

  async function runInfoFeed() {
    const query = options.infoFeedForm.value.query.trim();
    if (!query) {
      options.error.value = "请输入信息流问题。";
      return;
    }
    if (!options.canReadKnowledge.value) {
      options.error.value = "当前账号没有知识库读取权限。";
      return;
    }
    if (!options.selectedInfoFeedModel.value.enabled) {
      options.error.value = "请选择模型库中已配置且支持智能体调用的模型。";
      return;
    }
    if (options.infoFeedCanFollowUp.value && options.infoFeedCurrentRun.value) {
      options.infoFeedForm.value.query = "";
      await continueInfoFeedCurrentRun(query);
      return;
    }
    options.error.value = "";
    options.infoFeedParentRunSnapshot.value = null;
    const sequence = options.infoFeedRunSequence.value + 1;
    options.infoFeedRunSequence.value = sequence;
    const run = options.createInfoFeedRun(query);
    options.infoFeedCurrentRun.value = run;
    options.infoFeedForm.value.query = "";
    await executeInfoFeedRunIteration(sequence, run);
  }

  async function chooseInfoFeedClarification(option: InfoFeedClarificationOption) {
    const run = options.infoFeedCurrentRun.value;
    if (!run?.clarification || run.summary.status === "running") {
      return;
    }
    const clarification = run.clarification;
    const archived = options.archiveInfoFeedExpertFeedback(run, clarification, option);
    run.clarification = {
      ...clarification,
      status: "answered",
      selectedOptionId: option.optionId,
    };
    options.upsertInfoFeedHistory(run);
    await syncInfoFeedExpertFeedback(run, archived);
    await continueInfoFeedCurrentRun(option.followUpQuestion);
  }

  async function continueInfoFeedAfterModelSelection() {
    const run = options.infoFeedCurrentRun.value;
    if (!run?.pausedForModelSelection) {
      return;
    }
    if (!options.selectedInfoFeedModel.value.enabled) {
      options.error.value = "请选择一个已配置且可用的模型。";
      return;
    }
    options.error.value = "";
    const pausedStage = run.pausedForModelSelection;
    const sequence = options.infoFeedRunSequence.value + 1;
    options.infoFeedRunSequence.value = sequence;
    run.pausedForModelSelection = "";
    run.summary.modelAlias = options.selectedInfoFeedModel.value.value;
    run.summary.contextProfileId = options.selectedInfoFeedContextProfile.value.value;
    if (pausedStage === "agent") {
      run.agent = {
        status: "idle",
        progress: 0,
        runId: "",
        workspaceId: "",
        response: null,
        error: "",
      };
      await runInfoFeedAgentTrack(sequence, run.runId, options.buildInfoFeedAgentQuery(run));
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== run.runId ||
        run.pausedForModelSelection
      ) {
        options.upsertInfoFeedHistory(run);
        return;
      }
    }
    if (options.infoFeedReadyForSummary.value) {
      await runInfoFeedSummaryAgent(sequence);
    }
  }

  async function continueInfoFeedAfterRetry() {
    const run = options.infoFeedCurrentRun.value;
    if (!run?.pausedForRetry) {
      return;
    }
    const pausedStage = run.pausedForRetry;
    const sequence = options.infoFeedRunSequence.value + 1;
    options.infoFeedRunSequence.value = sequence;
    clearInfoFeedRetryState(run, pausedStage);
    options.error.value = "";

    if (pausedStage === "keyword") {
      run.keyword = {
        status: "idle",
        progress: 0,
        stage: "",
        fromCache: false,
        response: null,
        error: "",
      };
      await runInfoFeedKeywordTrack(sequence, run.runId, options.buildInfoFeedSourceSearchQuery(run));
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== run.runId ||
        run.pausedForRetry
      ) {
        options.upsertInfoFeedHistory(run);
        return;
      }
    }

    if (pausedStage === "agent") {
      run.agent = {
        status: "idle",
        progress: 0,
        runId: "",
        workspaceId: "",
        response: null,
        error: "",
      };
      await runInfoFeedAgentTrack(sequence, run.runId, options.buildInfoFeedAgentQuery(run));
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== run.runId ||
        run.pausedForRetry
      ) {
        options.upsertInfoFeedHistory(run);
        return;
      }
    }

    if (pausedStage === "summary") {
      run.summary.answer = "";
      run.summary.error = "";
      run.summary.fallback = false;
    }

    if (
      options.infoFeedReadyForSummary.value &&
      !run.pausedForModelSelection &&
      !run.pausedForRetry
    ) {
      await runInfoFeedSummaryAgent(sequence);
    }
  }

  return {
    chooseInfoFeedClarification,
    continueInfoFeedAfterModelSelection,
    continueInfoFeedAfterRetry,
    continueInfoFeedCurrentRun,
    executeInfoFeedRunIteration,
    runInfoFeed,
    runInfoFeedAgentTrack,
    runInfoFeedKeywordTrack,
    runInfoFeedSummaryAgent,
    syncInfoFeedExpertFeedback,
  };
}
