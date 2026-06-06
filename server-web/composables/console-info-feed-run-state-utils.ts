import type { KnowledgeSearchResult } from "../lib/types";
import {
  extractEvidenceRefsFromText,
  uniqueEvidenceRefs,
} from "../lib/rendering";
import type {
  InfoFeedAttachment,
  InfoFeedRunState,
  InfoFeedTurnSnapshot,
} from "../types/app";
import {
  makeInfoFeedId,
  truncateInfoFeedText,
  type InfoFeedSummaryDefaults,
} from "./console-info-feed-shared-utils";
import { snapshotInfoFeedAttachments } from "./console-info-feed-attachment-utils";

export function createInfoFeedFollowUpContext(
  previousRun: InfoFeedRunState | null,
  question: string,
): InfoFeedRunState["followUp"] | undefined {
  if (!previousRun?.summary.answer?.trim()) {
    return undefined;
  }
  return {
    parentRunId: previousRun.runId,
    parentQuery: previousRun.query,
    question,
    parentSummary: truncateInfoFeedText(previousRun.summary.answer, 2600),
    parentEvidenceRefs: uniqueEvidenceRefs([
      ...(((previousRun.keyword.response?.items || previousRun.keyword.response?.results || []) as KnowledgeSearchResult[])
        .map((item) => String(item.evidenceId || ""))
        .filter(Boolean)),
      ...extractEvidenceRefsFromText(previousRun.agent.response?.answer || ""),
      ...extractEvidenceRefsFromText(previousRun.summary.answer || ""),
    ]).slice(0, 16),
  };
}

export function createInitialInfoFeedKeywordState(): InfoFeedRunState["keyword"] {
  return {
    status: "idle",
    progress: 0,
    stage: "",
    fromCache: false,
    response: null,
    error: "",
  };
}

export function createInitialInfoFeedAgentState(): InfoFeedRunState["agent"] {
  return {
    status: "idle",
    progress: 0,
    runId: "",
    workspaceId: "",
    response: null,
    error: "",
  };
}

export function createInitialInfoFeedSummaryState(
  defaults: InfoFeedSummaryDefaults,
): InfoFeedRunState["summary"] {
  return {
    status: "idle",
    progress: 0,
    modelAlias: defaults.modelAlias,
    contextProfileId: defaults.contextProfileId,
    parametersOpen: false,
    temperature: defaults.temperature,
    maxTokens: defaults.maxTokens,
    answer: "",
    error: "",
    fallback: false,
  };
}

export function createInfoFeedRunState(
  query: string,
  options: {
    attachments: InfoFeedAttachment[];
    summaryDefaults: InfoFeedSummaryDefaults;
    followUp?: InfoFeedRunState["followUp"];
  },
): InfoFeedRunState {
  return {
    runId: makeInfoFeedId("run"),
    query,
    startedAt: new Date().toISOString(),
    completedAt: "",
    attachments: snapshotInfoFeedAttachments(options.attachments),
    ...(options.followUp ? { followUp: options.followUp } : {}),
    expertFeedback: [],
    turns: [],
    keyword: createInitialInfoFeedKeywordState(),
    agent: createInitialInfoFeedAgentState(),
    summary: createInitialInfoFeedSummaryState(options.summaryDefaults),
    pausedForModelSelection: "",
    pausedForRetry: "",
    retry: undefined,
  };
}

export function snapshotInfoFeedTurnCore(
  run: InfoFeedRunState,
  options: {
    summaryModelAlias: string;
    evidenceRefs: (run: InfoFeedRunState) => string[];
  },
): InfoFeedTurnSnapshot | null {
  const summaryAnswer = String(run.summary.answer || "").trim();
  const expertFeedback = run.expertFeedback || [];
  if (!summaryAnswer && expertFeedback.length === 0) {
    return null;
  }
  return {
    turnId: makeInfoFeedId("turn"),
    query: run.query,
    followUpQuestion: run.followUp?.question || "",
    attachments: snapshotInfoFeedAttachments(run.attachments),
    completedAt: run.completedAt || new Date().toISOString(),
    summaryAnswer,
    summaryError: run.summary.error || "",
    summaryFallback: Boolean(run.summary.fallback),
    summaryModelAlias: run.summary.modelAlias || options.summaryModelAlias,
    evidenceRefs: options.evidenceRefs(run),
    expertFeedback: [...expertFeedback],
  };
}

export function appendInfoFeedTurnSnapshotCore(
  run: InfoFeedRunState,
  options: {
    summaryModelAlias: string;
    evidenceRefs: (run: InfoFeedRunState) => string[];
  },
) {
  const snapshot = snapshotInfoFeedTurnCore(run, options);
  if (!snapshot) {
    return null;
  }
  run.turns = [...(run.turns || []), snapshot].slice(-8);
  return snapshot;
}

export function resetInfoFeedRunForContinuationCore(
  run: InfoFeedRunState,
  question: string,
  options: {
    attachments: InfoFeedAttachment[];
    summaryDefaults: InfoFeedSummaryDefaults;
    evidenceRefs: (run: InfoFeedRunState) => string[];
  },
) {
  const followUp = createInfoFeedFollowUpContext(run, question);
  appendInfoFeedTurnSnapshotCore(run, {
    summaryModelAlias: options.summaryDefaults.modelAlias,
    evidenceRefs: options.evidenceRefs,
  });
  run.followUp = followUp;
  run.completedAt = "";
  run.attachments = snapshotInfoFeedAttachments(options.attachments);
  run.clarification = undefined;
  run.expertFeedback = [];
  run.keyword = createInitialInfoFeedKeywordState();
  run.agent = createInitialInfoFeedAgentState();
  run.summary = createInitialInfoFeedSummaryState(options.summaryDefaults);
  run.pausedForModelSelection = "";
  run.pausedForRetry = "";
  run.retry = undefined;
}
