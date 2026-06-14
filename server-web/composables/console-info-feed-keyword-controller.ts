import { computed, type Ref } from "vue";
import type { KnowledgeSearchResult } from "../lib/types";
import type {
  InfoFeedClarification,
  InfoFeedRunState,
} from "../types/app";
import { currentConsoleLocale, localizeConsoleText } from "../i18n/console";
import { asRecord } from "./console-model-utils";

type SourceContextReport = {
  report: Record<string, unknown>;
};

type ConsoleInfoFeedKeywordControllerOptions = {
  buildInfoFeedSourceContext: (run: InfoFeedRunState | null | undefined) => SourceContextReport;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedParentRunSnapshot: Ref<InfoFeedRunState | null>;
  isLowRelevanceSourceResult: (item: KnowledgeSearchResult) => boolean;
};

function keywordResponseItems(run: InfoFeedRunState | null): KnowledgeSearchResult[] {
  const response = run?.keyword.response;
  return ((response?.items || response?.results || []) as KnowledgeSearchResult[]);
}

export function createConsoleInfoFeedKeywordController(
  options: ConsoleInfoFeedKeywordControllerOptions,
) {
  const infoFeedKeywordItems = computed(() =>
    keywordResponseItems(options.infoFeedCurrentRun.value).filter(
      (item) => !options.isLowRelevanceSourceResult(item),
    ),
  );
  const infoFeedLowRelevanceKeywordItems = computed(() =>
    keywordResponseItems(options.infoFeedCurrentRun.value).filter(options.isLowRelevanceSourceResult),
  );
  const infoFeedAllKeywordItems = computed(() => keywordResponseItems(options.infoFeedCurrentRun.value));
  const infoFeedContextGateNotice = computed(() =>
    options.buildInfoFeedSourceContext(options.infoFeedCurrentRun.value).report,
  );
  const infoFeedKeywordScanExplain = computed(() => {
    const explain = asRecord(options.infoFeedCurrentRun.value?.keyword.response?.explain) || {};
    return {
      scannedFiles: Number(explain.scannedFiles || 0),
      candidateFileCount: Number(explain.candidateFileCount || 0),
      matchedUniqueFiles: Number(explain.matchedUniqueFiles || 0),
      returned: Number(explain.returned || 0),
      highRelevanceCount: Number(explain.highRelevanceCount || 0),
      lowRelevanceCount: Number(explain.lowRelevanceCount || 0),
      elapsedMs: Number(explain.elapsedMs || 0),
      candidateElapsedMs: Number(explain.candidateElapsedMs || 0),
      inspectElapsedMs: Number(explain.inspectElapsedMs || 0),
      candidateSearch: String(explain.candidateSearch || ""),
    };
  });
  const infoFeedKeywordProgressLabel = computed(() => {
    const run = options.infoFeedCurrentRun.value;
    if (!run) {
      return "";
    }
    if (run.keyword.status === "running") {
      return run.keyword.stage || "服务端检索中，等待扫描结果返回";
    }
    if (run.keyword.status === "completed") {
      const scan = infoFeedKeywordScanExplain.value;
      if (scan.scannedFiles || scan.candidateFileCount || scan.elapsedMs) {
        return [
          scan.candidateFileCount ? `候选 ${scan.candidateFileCount}` : "",
          scan.scannedFiles ? `扫描 ${scan.scannedFiles}` : "",
          scan.matchedUniqueFiles ? `命中 ${scan.matchedUniqueFiles}` : "",
          scan.elapsedMs ? `${scan.elapsedMs}ms` : "",
        ].filter(Boolean).join(" · ");
      }
      return run.keyword.fromCache ? "已使用缓存结果" : "检索完成";
    }
    return run.keyword.error || "";
  });
  const infoFeedAgentSteps = computed(() => options.infoFeedCurrentRun.value?.agent.response?.steps || []);
  const infoFeedAgentAnswer = computed(() => String(options.infoFeedCurrentRun.value?.agent.response?.answer || "").trim());
  const infoFeedCanFollowUp = computed(() => {
    const run = options.infoFeedCurrentRun.value;
    return Boolean(run?.summary.answer?.trim() && run.summary.status !== "running");
  });
  const infoFeedInputPlaceholder = computed(() => {
    const label = infoFeedCanFollowUp.value
      ? "继续追问当前信息流结果。"
      : "输入问题，信息流会并行对比原文检索和智能规划。";
    return localizeConsoleText(label, currentConsoleLocale.value);
  });
  const infoFeedSubmitLabel = computed(() => (infoFeedCanFollowUp.value ? "追问" : "开始信息流"));
  const infoFeedClarification = computed<InfoFeedClarification | null>(() => {
    const clarification = options.infoFeedCurrentRun.value?.clarification;
    return clarification?.status === "open" ? clarification : null;
  });
  const infoFeedParentRunForCurrent = computed(() => {
    const current = options.infoFeedCurrentRun.value;
    const parent = options.infoFeedParentRunSnapshot.value;
    return current?.followUp?.parentRunId && parent?.runId === current.followUp.parentRunId ? parent : null;
  });

  return {
    infoFeedAgentAnswer,
    infoFeedAgentSteps,
    infoFeedAllKeywordItems,
    infoFeedCanFollowUp,
    infoFeedClarification,
    infoFeedContextGateNotice,
    infoFeedInputPlaceholder,
    infoFeedKeywordItems,
    infoFeedKeywordProgressLabel,
    infoFeedKeywordScanExplain,
    infoFeedLowRelevanceKeywordItems,
    infoFeedParentRunForCurrent,
    infoFeedSubmitLabel,
  };
}
