import { computed, type Ref } from "vue";
import type { AgentExploreRunResponse } from "../lib/types";
import {
  copyTextToClipboard,
  downloadTextFile,
} from "./console-browser-effects";
import {
  formatMachineDate,
  safeDownloadName,
} from "./console-format-utils";
import { asRecord } from "./console-model-utils";
import {
  agentExploreRunStatus,
  type AgentExploreFormState,
} from "./console-agent-explore-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleAgentExploreDocumentControllerOptions = {
  agentExploreEvidenceRefs: ReadonlyRef<string[]>;
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreResult: ReadonlyRef<AgentExploreRunResponse | null>;
  agentExploreRunInput: ReadonlyRef<Record<string, unknown>>;
  error: Ref<string>;
  agentExploreContextBuildRecordId: () => string;
  currentAgentExploreQuery: () => string;
  recordFeedback: (action: string, context?: Record<string, unknown>) => void;
};

export function createConsoleAgentExploreDocumentController(
  options: ConsoleAgentExploreDocumentControllerOptions,
) {
  const agentExploreDocumentMarkdown = computed(() => {
    const result = options.agentExploreResult.value;
    const answer = String(result?.answer || "").trim();
    if (!answer) {
      return "";
    }
    const run = asRecord(result?.run) || {};
    const input = asRecord(run.input) || {};
    const runId = String(run.runId || "");
    const workspaceId = String(asRecord(result?.workspace)?.workspaceId || "");
    const query = String(input.query || options.agentExploreForm.value.query || "");
    const modelAlias = String(input.modelAlias || options.agentExploreForm.value.modelAlias || "");
    const contextProfileId = String(input.contextProfileId || options.agentExploreForm.value.contextProfileId || "");
    const updatedAt = String(run.completedAt || run.updatedAt || new Date().toISOString());
    const refs = options.agentExploreEvidenceRefs.value;
    const metaLines = [
      `- 问题：${query || "未记录"}`,
      `- 模型：${modelAlias || "未记录"}`,
      `- 上下文：${contextProfileId || "未记录"}`,
      `- 状态：${agentExploreRunStatus(result) || "unknown"}`,
      runId ? `- Run：${runId}` : "",
      workspaceId ? `- Workspace：${workspaceId}` : "",
      `- 生成时间：${formatMachineDate(updatedAt, "full")}`,
    ].filter(Boolean);
    const citationLines = refs.length
      ? refs.map((refId, index) => `${index + 1}. \`${refId}\``)
      : ["无"];
    return [
      "# 智能检索结果",
      "",
      ...metaLines,
      "",
      "## 结论",
      "",
      answer,
      "",
      "## 引用证据",
      "",
      ...citationLines,
      "",
    ].join("\n");
  });

  async function copyAgentExploreDocument() {
    const content = agentExploreDocumentMarkdown.value.trim();
    if (!content) {
      options.error.value = "暂无可复制的智能检索结果。";
      return;
    }
    try {
      await copyTextToClipboard(content);
      options.recordFeedback("copy", {
        surface: "agent_explore",
        query: options.currentAgentExploreQuery(),
        evidenceRefs: options.agentExploreEvidenceRefs.value,
        contextBuildRecordId: options.agentExploreContextBuildRecordId(),
      });
      options.error.value = "";
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "复制智能检索结果失败。";
    }
  }

  function exportAgentExploreDocument() {
    const content = agentExploreDocumentMarkdown.value.trim();
    if (!content) {
      options.error.value = "暂无可导出的智能检索结果。";
      return;
    }
    const query = String(options.agentExploreRunInput.value.query || options.agentExploreForm.value.query || "智能检索");
    const timestamp = formatMachineDate(new Date().toISOString(), "full").replace(/[: ]/g, "-");
    downloadTextFile(
      `${safeDownloadName(query, "agent-search")}-${timestamp}.md`,
      `${content}\n`,
      "text/markdown;charset=utf-8",
    );
    options.recordFeedback("export", {
      surface: "agent_explore",
      query,
      evidenceRefs: options.agentExploreEvidenceRefs.value,
      contextBuildRecordId: options.agentExploreContextBuildRecordId(),
    });
    options.error.value = "";
  }

  return {
    agentExploreDocumentMarkdown,
    copyAgentExploreDocument,
    exportAgentExploreDocument,
  };
}
