import type { AgentExploreRunResponse } from "../lib/types";
import type {
  InfoFeedRunState,
  InfoFeedRetryStage,
} from "../types/app";
import { agentExploreRunStatus } from "./console-agent-explore-utils";

export const INFO_FEED_FETCH_RETRY_LIMIT = 10;

export interface InfoFeedFetchRetryOptions {
  retryLimit?: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

export function infoFeedRetryStageLabel(stage?: InfoFeedRetryStage | "") {
  if (stage === "keyword") {
    return "原文检索";
  }
  if (stage === "agent") {
    return "智能规划";
  }
  if (stage === "summary") {
    return "知识归纳";
  }
  return "请求";
}

export function infoFeedRetryMessageForRun(
  run: InfoFeedRunState | null | undefined,
  retryLimit = INFO_FEED_FETCH_RETRY_LIMIT,
) {
  if (!run?.pausedForRetry) {
    return "";
  }
  const retry = run.retry;
  const attempts = retry?.attempts || retryLimit;
  const limit = retry?.limit || retryLimit;
  const detail = retry?.error || "网络请求失败。";
  return `${infoFeedRetryStageLabel(run.pausedForRetry)}请求失败，已自动重试 ${attempts}/${limit} 次。检查服务恢复后可以点击继续从当前阶段重试。${detail ? `（${detail}）` : ""}`;
}

export function isModelConfigurationError(value: unknown) {
  const message = String(value instanceof Error ? value.message : value || "");
  return /URL\s*未配置|url\s*未配置|模型.*未配置|智能体.*未配置|not configured|missing.*url/i.test(message);
}

export class InfoFeedRetryExhaustedError extends Error {
  stage: InfoFeedRetryStage;
  attempts: number;
  retryLimit: number;
  causeError: unknown;

  constructor(
    stage: InfoFeedRetryStage,
    attempts: number,
    causeError: unknown,
    retryLimit = INFO_FEED_FETCH_RETRY_LIMIT,
  ) {
    const message = causeError instanceof Error ? causeError.message : String(causeError || "请求失败。");
    super(`${infoFeedRetryStageLabel(stage)}请求失败，已自动重试 ${attempts}/${retryLimit} 次：${message}`);
    this.name = "InfoFeedRetryExhaustedError";
    this.stage = stage;
    this.attempts = attempts;
    this.retryLimit = retryLimit;
    this.causeError = causeError;
  }
}

export function isInfoFeedRetryExhaustedError(value: unknown): value is InfoFeedRetryExhaustedError {
  return value instanceof InfoFeedRetryExhaustedError;
}

export function isTransientFetchError(value: unknown) {
  const message = String(value instanceof Error ? value.message : value || "");
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|connection.*(lost|refused|reset)|err_network/i.test(message);
}

export function setInfoFeedRetryState(
  run: InfoFeedRunState,
  stage: InfoFeedRetryStage,
  attempts: number,
  value: unknown,
  retryLimit = INFO_FEED_FETCH_RETRY_LIMIT,
) {
  run.retry = {
    stage,
    attempts,
    limit: retryLimit,
    error: value instanceof Error ? value.message : String(value || "请求失败。"),
    updatedAt: new Date().toISOString(),
  };
}

export function clearInfoFeedRetryState(run: InfoFeedRunState, stage?: InfoFeedRetryStage) {
  if (run.pausedForRetry && (!stage || run.pausedForRetry === stage)) {
    run.pausedForRetry = "";
  }
  if (run.retry && (!stage || run.retry.stage === stage)) {
    run.retry = undefined;
  }
}

export function delayMs(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function normalizedInfoFeedRetryLimit(value: unknown) {
  const limit = Math.floor(Number(value || INFO_FEED_FETCH_RETRY_LIMIT));
  return Number.isFinite(limit) && limit > 0 ? limit : INFO_FEED_FETCH_RETRY_LIMIT;
}

export async function withInfoFeedFetchRetry<T>(
  run: InfoFeedRunState,
  stage: InfoFeedRetryStage,
  operation: () => Promise<T>,
  options: InfoFeedFetchRetryOptions = {},
): Promise<T> {
  const retryLimit = normalizedInfoFeedRetryLimit(options.retryLimit);
  const retryDelayMs = options.retryDelayMs || ((attempt: number) => Math.min(2200, 280 + attempt * 220));
  const sleep = options.sleep || delayMs;
  let lastError: unknown = null;
  clearInfoFeedRetryState(run, stage);
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    try {
      const result = await operation();
      clearInfoFeedRetryState(run, stage);
      return result;
    } catch (nextError) {
      lastError = nextError;
      if (!isTransientFetchError(nextError)) {
        throw nextError;
      }
      setInfoFeedRetryState(run, stage, attempt, nextError, retryLimit);
      if (attempt >= retryLimit) {
        run.pausedForRetry = stage;
        throw new InfoFeedRetryExhaustedError(stage, attempt, nextError, retryLimit);
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  run.pausedForRetry = stage;
  throw new InfoFeedRetryExhaustedError(stage, retryLimit, lastError, retryLimit);
}

export function infoFeedAgentProgressFromResultCore(
  result: AgentExploreRunResponse | null,
  maxIterations: number,
) {
  const status = agentExploreRunStatus(result);
  if (status === "completed") {
    return 100;
  }
  if (status === "failed") {
    return 100;
  }
  const steps = result?.steps || [];
  const active = Math.max(1, Math.min(Number(steps[steps.length - 1]?.iteration || 1), maxIterations));
  const phase = String(steps[steps.length - 1]?.phase || status || "running");
  const phaseWeight =
    phase === "model_calling"
      ? 0.18
      : phase === "tool_selected"
        ? 0.38
        : phase === "tool_calling"
          ? 0.64
          : phase === "tool_result" || phase === "answer_ready"
            ? 0.84
            : 0.12;
  return Math.max(6, Math.min(98, Math.round(((active - 1 + phaseWeight) / maxIterations) * 100)));
}

export function infoFeedSearchCacheKey(query: string) {
  return String(query || "").trim().toLowerCase();
}
