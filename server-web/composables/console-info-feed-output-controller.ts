import { computed, watch, type Ref } from "vue";
import {
  extractEvidenceRefsFromText,
  linkifyEvidenceRefsInMarkdown,
  markdownToSafeHtml,
  uniqueEvidenceRefs,
} from "../lib/rendering";
import type { KnowledgeSearchResult } from "../lib/types";
import type {
  InfoFeedExpertFeedbackAnchor,
  InfoFeedRunState,
  InfoFeedTurnSnapshot,
} from "../types/app";
import {
  copyTextToClipboard,
  downloadTextFile,
} from "./console-browser-effects";
import {
  formatMachineDate,
  safeDownloadName,
} from "./console-format-utils";
import {
  formatFileSize,
  infoFeedStatusLabel,
  infoFeedTurnQuestionCore,
} from "./console-info-feed-utils";
import { createConsoleTimeoutController } from "./console-timer-controller";

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

type InfoFeedOutputModelOption = {
  value: string;
};

export type ConsoleInfoFeedOutputControllerOptions = {
  error: Ref<string>;
  infoFeedAgentAnswer: ReadonlyRef<string>;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedForm: Ref<InfoFeedFormState>;
  infoFeedKeywordItems: ReadonlyRef<KnowledgeSearchResult[]>;
  infoFeedParentRunForCurrent: ReadonlyRef<InfoFeedRunState | null>;
  infoFeedRunEvidenceRefs: (run: InfoFeedRunState) => string[];
  infoFeedSummaryStreamText: Ref<string>;
  infoFeedSummaryStreamTimer: Ref<number | null>;
  modelDisplayLabel: (value?: string) => string;
  recordFeedback: (action: string, context?: Record<string, unknown>) => void;
  selectedInfoFeedModel: ReadonlyRef<InfoFeedOutputModelOption>;
};

export function createConsoleInfoFeedOutputController(options: ConsoleInfoFeedOutputControllerOptions) {
  const infoFeedSummaryStreamDelay = createConsoleTimeoutController({
    timer: options.infoFeedSummaryStreamTimer,
  });

  const infoFeedSummaryRuntime = computed(() => {
    const summary = options.infoFeedCurrentRun.value?.summary;
    return {
      model: options.modelDisplayLabel(summary?.modelAlias || options.selectedInfoFeedModel.value.value),
      temperature: Number(summary?.temperature ?? options.infoFeedForm.value.temperature ?? 0.2),
      maxTokens: Number(summary?.maxTokens ?? options.infoFeedForm.value.maxTokens ?? 1800),
    };
  });

  const infoFeedSummaryEvidenceRefs = computed(() =>
    uniqueEvidenceRefs([
      ...options.infoFeedKeywordItems.value.map((item) => String(item.evidenceId || "")).filter(Boolean),
      ...extractEvidenceRefsFromText(options.infoFeedAgentAnswer.value),
      ...extractEvidenceRefsFromText(options.infoFeedCurrentRun.value?.summary.answer || ""),
    ]),
  );

  const infoFeedVisibleSummaryText = computed(() => {
    const answer = String(options.infoFeedCurrentRun.value?.summary.answer || "");
    if (!answer) {
      return "";
    }
    return options.infoFeedSummaryStreamText.value || answer;
  });

  const infoFeedStreamingSummaryHtml = computed(() =>
    markdownToSafeHtml(
      linkifyEvidenceRefsInMarkdown(
        infoFeedVisibleSummaryText.value,
        infoFeedSummaryEvidenceRefs.value,
      ),
    ),
  );

  const infoFeedSummaryIsStreaming = computed(() => {
    const answer = String(options.infoFeedCurrentRun.value?.summary.answer || "");
    return Boolean(answer && options.infoFeedSummaryStreamText.value.length < answer.length);
  });

  const infoFeedSummaryMarkdown = computed(() => {
    const run = options.infoFeedCurrentRun.value;
    const answer = String(run?.summary.answer || "").trim();
    if (!run || !answer) {
      return "";
    }
    const citationLines = infoFeedSummaryEvidenceRefs.value.length
      ? infoFeedSummaryEvidenceRefs.value.map((refId, index) => `${index + 1}. \`${refId}\``)
      : ["无"];
    const turnLines = (run.turns || []).flatMap((turn, index) => [
      `## ${infoFeedTurnTitle(turn, index)}`,
      "",
      `- 问题：${infoFeedTurnQuestion(turn)}`,
      ...(infoFeedTurnAttachments(turn).length
        ? [
            `- 附件：${infoFeedTurnAttachments(turn)
              .map((attachment) => `${attachment.name}（${formatFileSize(attachment.size)}，${infoFeedStatusLabel(attachment.status)}）`)
              .join("；")}`,
          ]
        : []),
      `- 生成时间：${formatMachineDate(turn.completedAt || run.startedAt, "full")}`,
      turn.summaryFallback ? "- 状态：模型总结失败，使用本地兜底摘要" : "- 状态：模型总结完成",
      "",
      turn.summaryAnswer || "无输出。",
      "",
      ...(turn.expertFeedback || []).length
        ? [
            "### 人类专家意见",
            "",
            ...(turn.expertFeedback || []).map((item) =>
              `- ${item.selectedLabel}：${item.followUpQuestion}`,
            ),
            "",
          ]
        : [],
    ]);
    return [
      "# 信息流总结",
      "",
      `- 问题：${run.query}`,
      `- 模型：${run.summary.modelAlias || "未记录"}`,
      `- 上下文：${run.summary.contextProfileId || "未记录"}`,
      `- 生成时间：${formatMachineDate(run.completedAt || new Date().toISOString(), "full")}`,
      run.summary.fallback ? "- 状态：模型总结失败，使用本地兜底摘要" : "- 状态：模型总结完成",
      "",
      ...turnLines,
      "## 结论",
      "",
      ...(run.followUp ? [`当前追问：${run.followUp.question}`, ""] : []),
      ...(run.attachments.length
        ? [
            `当前附件：${run.attachments
              .map((attachment) => `${attachment.name}（${formatFileSize(attachment.size)}，${infoFeedStatusLabel(attachment.status)}）`)
              .join("；")}`,
            "",
          ]
        : []),
      answer,
      "",
      "## 引用证据",
      "",
      ...citationLines,
      "",
    ].join("\n");
  });

  const infoFeedParentSummaryEvidenceRefs = computed(() => {
    const parent = options.infoFeedParentRunForCurrent.value;
    return parent ? options.infoFeedRunEvidenceRefs(parent) : [];
  });

  const infoFeedParentSummaryHtml = computed(() => {
    const parent = options.infoFeedParentRunForCurrent.value;
    return markdownToSafeHtml(
      linkifyEvidenceRefsInMarkdown(
        parent?.summary.answer || "",
        infoFeedParentSummaryEvidenceRefs.value,
      ),
    );
  });

  watch(
    () => [
      options.infoFeedCurrentRun.value?.runId || "",
      options.infoFeedCurrentRun.value?.summary.status || "",
      options.infoFeedCurrentRun.value?.summary.answer || "",
    ],
    ([runId, status, answer]) => {
      const nextAnswer = String(answer || "");
      clearInfoFeedSummaryStreamTimer();
      if (!runId || !nextAnswer || status === "running") {
        options.infoFeedSummaryStreamText.value = "";
        return;
      }
      streamInfoFeedSummary(nextAnswer, String(runId));
    },
    { immediate: true },
  );

  function clearInfoFeedSummaryStreamTimer() {
    infoFeedSummaryStreamDelay.stop();
  }

  function streamInfoFeedSummary(answer: string, runId: string) {
    clearInfoFeedSummaryStreamTimer();
    const characters = Array.from(answer);
    let index = 0;
    options.infoFeedSummaryStreamText.value = "";
    const tick = () => {
      const current = options.infoFeedCurrentRun.value;
      if (!current || current.runId !== runId || current.summary.answer !== answer) {
        clearInfoFeedSummaryStreamTimer();
        return;
      }
      options.infoFeedSummaryStreamText.value += characters[index] || "";
      index += 1;
      if (index < characters.length) {
        const scheduledTimer = infoFeedSummaryStreamDelay.schedule(tick, 6);
        if (scheduledTimer === null) {
          options.infoFeedSummaryStreamText.value = answer;
        }
      } else {
        options.infoFeedSummaryStreamTimer.value = null;
      }
    };
    tick();
  }

  async function copyInfoFeedSummary() {
    const content = infoFeedSummaryMarkdown.value.trim();
    if (!content) {
      options.error.value = "暂无可复制的信息流总结。";
      return;
    }
    try {
      await copyTextToClipboard(content);
      options.recordFeedback("copy", {
        surface: "info_feed",
        query: options.infoFeedCurrentRun.value?.query || "",
        itemId: options.infoFeedCurrentRun.value?.runId || "",
        evidenceRefs: infoFeedSummaryEvidenceRefs.value,
      });
      options.error.value = "";
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "复制信息流总结失败。";
    }
  }

  function exportInfoFeedSummary() {
    const content = infoFeedSummaryMarkdown.value.trim();
    if (!content) {
      options.error.value = "暂无可导出的信息流总结。";
      return;
    }
    const query = String(options.infoFeedCurrentRun.value?.query || options.infoFeedForm.value.query || "信息流");
    const timestamp = formatMachineDate(new Date().toISOString(), "full").replace(/[: ]/g, "-");
    downloadTextFile(
      `${safeDownloadName(query, "info-feed")}-${timestamp}.md`,
      `${content}\n`,
      "text/markdown;charset=utf-8",
    );
    options.recordFeedback("export", {
      surface: "info_feed",
      query,
      itemId: options.infoFeedCurrentRun.value?.runId || "",
      evidenceRefs: infoFeedSummaryEvidenceRefs.value,
    });
    options.error.value = "";
  }

  function infoFeedExpertFeedbackFor(anchor: InfoFeedExpertFeedbackAnchor) {
    return infoFeedExpertFeedbackForRun(options.infoFeedCurrentRun.value, anchor);
  }

  function infoFeedExpertFeedbackForRun(
    run: InfoFeedRunState | null | undefined,
    anchor: InfoFeedExpertFeedbackAnchor,
  ) {
    return (run?.expertFeedback || []).filter((item) => item.anchor === anchor);
  }

  function infoFeedTurnSummaryHtml(turn: InfoFeedTurnSnapshot) {
    return markdownToSafeHtml(
      linkifyEvidenceRefsInMarkdown(
        turn.summaryAnswer || "",
        turn.evidenceRefs || [],
      ),
    );
  }

  function infoFeedTurnTitle(turn: InfoFeedTurnSnapshot, index: number) {
    return turn.followUpQuestion ? `第 ${index + 1} 轮追问` : `第 ${index + 1} 轮`;
  }

  function infoFeedTurnQuestion(turn: InfoFeedTurnSnapshot) {
    return infoFeedTurnQuestionCore(turn);
  }

  function infoFeedTurnAttachments(turn: InfoFeedTurnSnapshot) {
    return (turn.attachments || []).filter(Boolean);
  }

  function infoFeedCurrentUserQuestion(run: InfoFeedRunState) {
    return run.followUp?.question || run.query || "未记录问题";
  }

  function infoFeedUserCardTitle(runOrTurn: InfoFeedRunState | InfoFeedTurnSnapshot) {
    return "followUp" in runOrTurn
      ? (runOrTurn.followUp ? "用户回复" : "用户问题")
      : ((runOrTurn as InfoFeedTurnSnapshot).followUpQuestion ? "用户回复" : "用户问题");
  }

  return {
    clearInfoFeedSummaryStreamTimer,
    copyInfoFeedSummary,
    exportInfoFeedSummary,
    infoFeedCurrentUserQuestion,
    infoFeedExpertFeedbackFor,
    infoFeedExpertFeedbackForRun,
    infoFeedParentSummaryEvidenceRefs,
    infoFeedParentSummaryHtml,
    infoFeedStreamingSummaryHtml,
    infoFeedSummaryEvidenceRefs,
    infoFeedSummaryIsStreaming,
    infoFeedSummaryMarkdown,
    infoFeedSummaryRuntime,
    infoFeedTurnAttachments,
    infoFeedTurnQuestion,
    infoFeedTurnSummaryHtml,
    infoFeedTurnTitle,
    infoFeedUserCardTitle,
    infoFeedVisibleSummaryText,
    streamInfoFeedSummary,
  };
}
