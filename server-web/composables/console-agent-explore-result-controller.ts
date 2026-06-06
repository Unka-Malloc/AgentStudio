import { computed, type Ref } from "vue";
import {
  extractEvidenceRefsFromText,
  linkifyEvidenceRefsInMarkdown,
  markdownToSafeHtml,
  uniqueEvidenceRefs,
} from "../lib/rendering";
import type { AgentExploreRunResponse } from "../lib/types";
import {
  formatCompactDate,
} from "./console-format-utils";
import { asRecord } from "./console-model-utils";
import {
  agentExplorePhaseLabel,
} from "./console-agent-explore-presentation";
import {
  agentExploreRunStatus,
  type AgentExploreFormState,
} from "./console-agent-explore-utils";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleAgentExploreResultControllerOptions = {
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  busyKey: ReadonlyRef<string>;
};

export function createConsoleAgentExploreResultController(
  options: ConsoleAgentExploreResultControllerOptions,
) {
  const agentExploreSteps = computed(() => options.agentExploreResult.value?.steps || []);
  const agentExploreWorkspaceId = computed(
    () =>
      String(
        options.agentExploreResult.value?.workspace?.workspaceId ||
          options.agentExploreForm.value.workspaceId ||
          "",
      ),
  );
  const agentExploreRunInput = computed(() => asRecord(options.agentExploreResult.value?.run?.input) || {});
  const agentExploreRunCoverage = computed(() => asRecord(options.agentExploreResult.value?.run?.coverage) || {});
  const agentExploreMaxIterations = computed(() =>
    Math.max(
      1,
      Math.min(
        Number(agentExploreRunInput.value.maxIterations || options.agentExploreForm.value.maxIterations || 1),
        8,
      ),
    ),
  );
  const agentExploreActiveIteration = computed(() => {
    const explicit = Number(agentExploreRunCoverage.value.activeIteration || 0);
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.min(explicit, agentExploreMaxIterations.value);
    }
    const lastStep = agentExploreSteps.value[agentExploreSteps.value.length - 1];
    const iteration = Number(lastStep?.iteration || 0);
    return Number.isFinite(iteration) && iteration > 0
      ? Math.min(iteration, agentExploreMaxIterations.value)
      : 0;
  });
  const agentExploreProgress = computed(() => {
    const status = agentExploreRunStatus(options.agentExploreResult.value);
    const maxIterations = agentExploreMaxIterations.value;
    if (!options.agentExploreResult.value) {
      return {
        percent: options.busyKey.value === "knowledge:agent-explore" ? 4 : 0,
        label: options.busyKey.value === "knowledge:agent-explore" ? "准备检索" : "未开始",
      };
    }
    if (status === "completed") {
      return {
        percent: 100,
        label: `已完成 ${maxIterations} 轮上限`,
      };
    }
    const phase = String(
      agentExploreRunCoverage.value.activePhase ||
        agentExploreSteps.value[agentExploreSteps.value.length - 1]?.phase ||
        status ||
        "running",
    );
    const phaseWeight =
      phase === "model_calling"
        ? 0.15
        : phase === "tool_selected" || phase === "answer_ready"
          ? 0.38
          : phase === "tool_calling"
            ? 0.68
            : phase === "tool_result" || phase === "completed"
              ? 0.92
              : 0.08;
    const activeIteration = Math.max(1, agentExploreActiveIteration.value || 1);
    const percent = Math.max(
      4,
      Math.min(99, Math.round(((activeIteration - 1 + phaseWeight) / maxIterations) * 100)),
    );
    return {
      percent: status === "failed" ? Math.min(percent, 100) : percent,
      label: `第 ${activeIteration} / ${maxIterations} 轮 · ${agentExplorePhaseLabel(phase)}`,
    };
  });
  const agentExploreProgressVisible = computed(() => {
    if (agentExploreProgress.value.percent >= 100) {
      return false;
    }
    if (options.busyKey.value === "knowledge:agent-explore") {
      return true;
    }
    return ["queued", "running"].includes(agentExploreRunStatus(options.agentExploreResult.value));
  });
  const agentExploreEvidenceRefs = computed(() => options.agentExploreResult.value?.evidenceRefs || []);
  const agentExploreLinkedEvidenceRefs = computed(() =>
    uniqueEvidenceRefs([
      ...agentExploreEvidenceRefs.value,
      ...extractEvidenceRefsFromText(options.agentExploreResult.value?.answer || ""),
    ]),
  );
  const agentExploreAnswerHtml = computed(() =>
    markdownToSafeHtml(
      linkifyEvidenceRefsInMarkdown(
        options.agentExploreResult.value?.answer || "",
        agentExploreLinkedEvidenceRefs.value,
      ),
    ),
  );

  function agentExploreContextBuildRecordId() {
    return String(asRecord(options.agentExploreResult.value?.contextPack)?.contextBuildRecordId || "");
  }

  function agentExploreStepOpen(step: unknown) {
    const value = asRecord(step) || {};
    const status = agentExploreRunStatus(options.agentExploreResult.value);
    return (
      status === "running" &&
      Number(value.iteration || 0) === agentExploreActiveIteration.value
    );
  }

  function agentExploreEventTime(event: unknown) {
    const value = asRecord(event) || {};
    return formatCompactDate(String(value.createdAt || ""));
  }

  function currentAgentExploreQuery() {
    return String(agentExploreRunInput.value.query || options.agentExploreForm.value.query || "").trim();
  }

  return {
    agentExploreActiveIteration,
    agentExploreAnswerHtml,
    agentExploreContextBuildRecordId,
    agentExploreEventTime,
    agentExploreEvidenceRefs,
    agentExploreLinkedEvidenceRefs,
    agentExploreMaxIterations,
    agentExploreProgress,
    agentExploreProgressVisible,
    agentExploreRunCoverage,
    agentExploreRunInput,
    agentExploreStepOpen,
    agentExploreSteps,
    agentExploreWorkspaceId,
    currentAgentExploreQuery,
  };
}
