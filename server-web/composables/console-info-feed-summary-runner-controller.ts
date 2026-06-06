import { callAgentGateway } from "../lib/agent-gateway-client";
import type { InfoFeedRunState } from "../types/app";
import {
  isInfoFeedRetryExhaustedError,
  isModelConfigurationError,
  withInfoFeedFetchRetry,
} from "./console-info-feed-run-utils";
import type { Ref } from "vue";

type ReadonlyRef<T> = {
  readonly value: T;
};

type InfoFeedFormState = {
  temperature: number;
  maxTokens: number;
};

type InfoFeedExecutionModelOption = {
  value: string;
};

type InfoFeedExecutionContextProfile = {
  value: string;
};

type ConsoleInfoFeedSummaryRunnerControllerOptions = {
  agentExploreThinkingParameters: () => Record<string, unknown>;
  applyInfoFeedSummaryAnswer: (
    run: InfoFeedRunState,
    answer: string,
    fallback: boolean,
    error?: string,
  ) => void;
  buildInfoFeedSummaryQuestion: (run: InfoFeedRunState) => string;
  fallbackInfoFeedSummary: (run: InfoFeedRunState) => string;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedForm: Ref<InfoFeedFormState>;
  infoFeedReadyForSummary: ReadonlyRef<boolean>;
  infoFeedRunSequence: Ref<number>;
  selectedInfoFeedContextProfile: ReadonlyRef<InfoFeedExecutionContextProfile>;
  selectedInfoFeedModel: ReadonlyRef<InfoFeedExecutionModelOption>;
  upsertInfoFeedHistory: (run: InfoFeedRunState | null) => void;
};

export function createConsoleInfoFeedSummaryRunnerController(
  options: ConsoleInfoFeedSummaryRunnerControllerOptions,
) {
  async function runInfoFeedSummaryAgent(sequence = options.infoFeedRunSequence.value) {
    const run = options.infoFeedCurrentRun.value;
    if (!run || !options.infoFeedReadyForSummary.value) {
      return;
    }
    run.pausedForModelSelection = "";
    run.summary.status = "running";
    run.summary.progress = 15;
    run.summary.modelAlias = options.selectedInfoFeedModel.value.value;
    run.summary.contextProfileId = options.selectedInfoFeedContextProfile.value.value;
    const summaryTemperature = Number(options.infoFeedForm.value.temperature || 0.2);
    const summaryMaxTokens = Number(options.infoFeedForm.value.maxTokens || 1800);
    run.summary.temperature = summaryTemperature;
    run.summary.maxTokens = summaryMaxTokens;
    run.summary.answer = "";
    run.summary.error = "";
    run.summary.fallback = false;
    try {
      const response = await withInfoFeedFetchRetry(run, "summary", () =>
        callAgentGateway({
          modelAlias: options.selectedInfoFeedModel.value.value,
          alias: options.selectedInfoFeedModel.value.value,
          moduleId: "agentTools",
          taskId: run.runId,
          sessionId: run.agent?.workspaceId || run.runId,
          question: options.buildInfoFeedSummaryQuestion(run),
          systemPrompt:
            "你是 Pact 信息流智能体。你的任务是融合原文检索、智能规划和附件读取结果，输出可复核、带证据编号的最终回答。证据不足时必须说明不足。只有当缺少用户选择就无法继续执行时，才向用户提问；普通不确定性只写在报告里。",
          parameters: {
            ...options.agentExploreThinkingParameters(),
            temperature: summaryTemperature,
            max_tokens: summaryMaxTokens,
          },
        }),
      );
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== run.runId
      ) {
        return;
      }
      const answer = String(response.answer || response.text || "").trim();
      options.applyInfoFeedSummaryAnswer(
        run,
        answer || options.fallbackInfoFeedSummary(run),
        !answer,
        answer ? "" : "总结智能体没有返回可用回答，已展示本地兜底摘要。",
      );
      run.summary.status = answer ? "completed" : "failed";
      run.summary.progress = 100;
    } catch (nextError) {
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== run.runId
      ) {
        return;
      }
      if (isModelConfigurationError(nextError)) {
        run.summary.answer = "";
        run.summary.fallback = false;
        run.summary.status = "failed";
        run.summary.progress = 0;
        run.summary.error = nextError instanceof Error ? nextError.message : "总结智能体未配置。";
        run.pausedForModelSelection = "summary";
        return;
      }
      if (isInfoFeedRetryExhaustedError(nextError)) {
        run.summary.answer = "";
        run.summary.fallback = false;
        run.summary.status = "failed";
        run.summary.progress = 100;
        run.summary.error = nextError.message;
        run.pausedForRetry = "summary";
        return;
      }
      options.applyInfoFeedSummaryAnswer(
        run,
        options.fallbackInfoFeedSummary(run),
        true,
        nextError instanceof Error ? nextError.message : "总结智能体调用失败。",
      );
      run.summary.status = "failed";
      run.summary.progress = 100;
    } finally {
      if (options.infoFeedCurrentRun.value?.runId === run.runId) {
        run.completedAt = new Date().toISOString();
        if (run.summary.answer || run.summary.status === "failed") {
          options.upsertInfoFeedHistory(run);
        }
      }
    }
  }

  return {
    runInfoFeedSummaryAgent,
  };
}
