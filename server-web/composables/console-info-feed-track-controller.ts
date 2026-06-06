import {
  getKnowledgeAgentExploreRun,
  runKnowledgeAgentExplore,
} from "../lib/agent-explore-client";
import { searchKnowledge } from "../lib/knowledge-search-client";
import type {
  AgentExploreRunResponse,
  KnowledgeSearchResponse,
} from "../lib/types";
import type { InfoFeedRunState } from "../types/app";
import {
  agentExploreRunStatus,
  normalizeAgentExploreRun,
} from "./console-agent-explore-utils";
import {
  delayMs,
  infoFeedSearchCacheKey,
  isInfoFeedRetryExhaustedError,
  isModelConfigurationError,
  withInfoFeedFetchRetry,
} from "./console-info-feed-run-utils";
import { asRecord } from "./console-model-utils";
import type { Ref } from "vue";

type ReadonlyRef<T> = {
  readonly value: T;
};

type InfoFeedExecutionModelOption = {
  value: string;
  enabled: boolean;
};

type InfoFeedExecutionContextProfile = {
  value: string;
};

type InfoFeedKeywordCache = Map<string, { response: KnowledgeSearchResponse; cachedAt: number }>;

export type ConsoleInfoFeedTrackControllerOptions = {
  agentExploreConfiguredLimit: ReadonlyRef<number>;
  agentExploreConfiguredMaxIterations: ReadonlyRef<number>;
  infoFeedAgentExpertGuidance: (run: InfoFeedRunState) => unknown;
  infoFeedAgentProgressFromResult: (result: AgentExploreRunResponse | null, maxIterations: number) => number;
  infoFeedAgentRecentTurns: (run: InfoFeedRunState) => unknown;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedKeywordCache: InfoFeedKeywordCache;
  infoFeedRunSequence: Ref<number>;
  selectedInfoFeedContextProfile: ReadonlyRef<InfoFeedExecutionContextProfile>;
  selectedInfoFeedModel: ReadonlyRef<InfoFeedExecutionModelOption>;
  selectedThinkingMode: ReadonlyRef<string>;
};

export function createConsoleInfoFeedTrackController(
  options: ConsoleInfoFeedTrackControllerOptions,
) {
  async function runInfoFeedKeywordTrack(sequence: number, runId: string, query: string) {
    const run = options.infoFeedCurrentRun.value;
    if (!run || run.runId !== runId) {
      return;
    }
    run.keyword.status = "running";
    run.keyword.progress = 0;
    run.keyword.stage = "提交原文检索请求";
    const cacheKey = infoFeedSearchCacheKey(query);
    const cached = options.infoFeedKeywordCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
      run.keyword.response = cached.response;
      run.keyword.fromCache = true;
      run.keyword.status = "completed";
      run.keyword.progress = 100;
      run.keyword.stage = "已使用缓存结果";
      return;
    }
    try {
      run.keyword.progress = 0;
      run.keyword.stage = "服务端正在扫描原始文件，完成后返回真实扫描数";
      const response = await withInfoFeedFetchRetry(run, "keyword", () =>
        searchKnowledge({
          query,
          limit: 12,
          retrievalMode: "raw-source-keyword",
          keywordOnly: true,
          rawSourceSearch: true,
          sourceSearch: true,
          returnAll: true,
          learningEnabled: false,
          explain: true,
        }),
      );
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== runId
      ) {
        return;
      }
      run.keyword.response = response;
      run.keyword.fromCache = false;
      run.keyword.status = "completed";
      run.keyword.progress = 100;
      const explain = asRecord(response.explain) || {};
      run.keyword.stage = [
        explain.candidateFileCount ? `候选 ${Number(explain.candidateFileCount)}` : "",
        explain.scannedFiles ? `扫描 ${Number(explain.scannedFiles)}` : "",
        explain.matchedUniqueFiles ? `命中 ${Number(explain.matchedUniqueFiles)}` : "",
        explain.elapsedMs ? `${Number(explain.elapsedMs)}ms` : "",
      ].filter(Boolean).join(" · ") || "检索完成";
      options.infoFeedKeywordCache.set(cacheKey, {
        response,
        cachedAt: Date.now(),
      });
    } catch (nextError) {
      run.keyword.status = "failed";
      run.keyword.progress = 100;
      if (isInfoFeedRetryExhaustedError(nextError)) {
        run.pausedForRetry = "keyword";
      }
      run.keyword.error = nextError instanceof Error ? nextError.message : "原文检索失败。";
      run.keyword.stage = run.keyword.error;
    }
  }

  async function runInfoFeedAgentTrack(sequence: number, runId: string, query: string) {
    const run = options.infoFeedCurrentRun.value;
    if (!run || run.runId !== runId) {
      return;
    }
    run.pausedForModelSelection = "";
    run.agent.status = "running";
    run.agent.progress = 8;
    run.agent.error = "";
    const maxIterations = options.agentExploreConfiguredMaxIterations.value;
    try {
      let result = normalizeAgentExploreRun(await withInfoFeedFetchRetry(run, "agent", () =>
        runKnowledgeAgentExplore({
          query,
          modelAlias: options.selectedInfoFeedModel.value.value,
          contextProfileId: options.selectedInfoFeedContextProfile.value.value,
          thinkingMode: options.selectedThinkingMode.value,
          maxIterations,
          limit: options.agentExploreConfiguredLimit.value,
          recentTurns: options.infoFeedAgentRecentTurns(run),
          expertGuidance: options.infoFeedAgentExpertGuidance(run),
          async: true,
          realtime: true,
        }),
      ));
      if (
        sequence !== options.infoFeedRunSequence.value ||
        options.infoFeedCurrentRun.value?.runId !== runId
      ) {
        return;
      }
      run.agent.response = result;
      run.agent.runId = String(asRecord(result.run)?.runId || "");
      run.agent.workspaceId = String(result.workspace?.workspaceId || "");
      run.agent.progress = options.infoFeedAgentProgressFromResult(result, maxIterations);
      for (let pollIndex = 0; pollIndex < 240; pollIndex += 1) {
        const status = agentExploreRunStatus(result);
        if (!["queued", "running"].includes(status)) {
          break;
        }
        if (!run.agent.runId || !run.agent.workspaceId) {
          break;
        }
        await delayMs(800);
        result = normalizeAgentExploreRun(await withInfoFeedFetchRetry(run, "agent", () =>
          getKnowledgeAgentExploreRun(run.agent.runId, {
            workspaceId: run.agent.workspaceId,
          }),
        ));
        if (
          sequence !== options.infoFeedRunSequence.value ||
          options.infoFeedCurrentRun.value?.runId !== runId
        ) {
          return;
        }
        run.agent.response = result;
        run.agent.progress = options.infoFeedAgentProgressFromResult(result, maxIterations);
      }
      const finalStatus = agentExploreRunStatus(run.agent.response);
      run.agent.status = finalStatus === "failed" || run.agent.response?.ok === false ? "failed" : "completed";
      run.agent.progress = 100;
      if (run.agent.status === "failed") {
        run.agent.error = run.agent.response?.error || "智能检索失败。";
        if (isModelConfigurationError(run.agent.error)) {
          run.pausedForModelSelection = "agent";
        }
      }
    } catch (nextError) {
      run.agent.status = "failed";
      run.agent.progress = 100;
      if (isInfoFeedRetryExhaustedError(nextError)) {
        run.pausedForRetry = "agent";
      }
      run.agent.error = nextError instanceof Error ? nextError.message : "智能检索失败。";
      if (isModelConfigurationError(nextError)) {
        run.pausedForModelSelection = "agent";
      }
    }
  }

  return {
    runInfoFeedAgentTrack,
    runInfoFeedKeywordTrack,
  };
}
