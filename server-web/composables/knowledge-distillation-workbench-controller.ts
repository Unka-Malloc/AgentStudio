import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePageRefreshHandler } from "./usePageRefresh";
import { confirmConsoleAction } from "./console-browser-effects";
import { createConsoleIntervalController } from "./console-timer-controller";
import { createKnowledgeDistillationModelProbeController } from "./knowledge-distillation-model-probe-controller";
import {
  archiveKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  knowledgeDistillationWorkbenchPackageUrl,
  listKnowledgeDistillationWorkbenchRuns,
  rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun,
  type AgentModelOption,
  type WorkbenchRun,
  type WorkbenchStage,
} from "../lib/knowledge-distillation-workbench";
import type { NormalizedDocumentsManifest, SplitJob } from "../lib/types";

export type KnowledgeDistillationCreateOptions = {
  modelAlias: string;
  prompt: string;
  tokenBudget: number;
  payloadBudget: number;
  rawCorpusBatchMaxCharacters: number;
  rawCorpusBatchModelMaxCharacters: number;
  rawCorpusBatchRetryModelMaxCharacters: number;
  mergeStrategy: string;
  maxRounds: number;
  strategyVersion: string;
  timeDecayHalfLifeDays: number;
  timeDecayFloor: number;
  priority: string;
};

export type KnowledgeDistillationWorkbenchProps = {
  canReadKnowledge: boolean;
  canMaintainKnowledge: boolean;
  ingestJob: SplitJob | null;
  normalizedManifest: NormalizedDocumentsManifest | null;
  formatCompactDate: (value: string) => string;
  modelOptions?: AgentModelOption[];
};

function defaultCreateOptions(): KnowledgeDistillationCreateOptions {
  return {
    modelAlias: "",
    prompt: "项目全部文档通用知识蒸馏，保留目录、时间线、因果顺序、图表和证据引用。",
    tokenBudget: 64000,
    payloadBudget: 500000,
    rawCorpusBatchMaxCharacters: 160000,
    rawCorpusBatchModelMaxCharacters: 32000,
    rawCorpusBatchRetryModelMaxCharacters: 16000,
    mergeStrategy: "timeline_then_topic",
    maxRounds: 3,
    strategyVersion: "timeline_then_topic_v2",
    timeDecayHalfLifeDays: 90,
    timeDecayFloor: 0.35,
    priority: "normal",
  };
}

export function useKnowledgeDistillationWorkbench(props: KnowledgeDistillationWorkbenchProps) {
  const runs = ref<WorkbenchRun[]>([]);
  const selectedRunId = ref("");
  const selectedRun = ref<WorkbenchRun | null>(null);
  const busy = ref("");
  const error = ref("");
  const createOptions = ref(defaultCreateOptions());
  const compareRightRunId = ref("");
  const compareResult = ref<Record<string, unknown> | null>(null);
  const runPolling = createConsoleIntervalController();

  const activeJobCompleted = computed(() => props.ingestJob?.status === "completed");
  const activeRunStages = computed(() => selectedRun.value?.stages || []);
  const activeRunProgress = computed(() => {
    const stages = activeRunStages.value;
    if (!stages.length) {
      return 0;
    }
    const completed = stages.filter((stage) => stage.status === "completed").length;
    const running = stages.find((stage) => stage.status === "running");
    return Math.round(((completed + (running ? Number(running.progressPercent || 0) / 100 : 0)) / stages.length) * 100);
  });
  const needsPolling = computed(() =>
    ["queued", "running", "waiting"].includes(String(selectedRun.value?.status || "")),
  );
  const {
    distillationModelOptions,
    modelProbeLabel,
    modelProbeTone,
    modelProbeTooltip,
    refreshModelProbeStatus,
    selectedModelReady,
  } = createKnowledgeDistillationModelProbeController({
    createOptions,
    formatCompactDate: props.formatCompactDate,
    modelOptions: () => props.modelOptions,
  });
  const canStart = computed(() => props.canMaintainKnowledge && activeJobCompleted.value && selectedModelReady.value && !busy.value);

  async function refreshRuns() {
    if (!props.canReadKnowledge) {
      return;
    }
    const items = await listKnowledgeDistillationWorkbenchRuns(50);
    runs.value = items;
    if (!selectedRunId.value && items.length > 0) {
      selectedRunId.value = items[0].runId;
    }
    if (selectedRunId.value) {
      const found = items.find((run) => run.runId === selectedRunId.value);
      if (found) {
        selectedRun.value = found;
      }
    }
  }

  async function refreshSelectedRun() {
    if (!selectedRunId.value || !props.canReadKnowledge) {
      return;
    }
    try {
      selectedRun.value = await getKnowledgeDistillationWorkbenchRun(selectedRunId.value);
      const index = runs.value.findIndex((run) => run.runId === selectedRun.value?.runId);
      if (index >= 0 && selectedRun.value) {
        runs.value[index] = selectedRun.value;
      }
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "读取知识蒸馏任务失败。";
    }
  }

  async function startWorkbenchRun() {
    if (!props.ingestJob?.id) {
      error.value = "请先在页面顶部导入项目目录并完成解析。";
      return;
    }
    if (props.ingestJob.status !== "completed") {
      error.value = "解析任务尚未完成，不能开始知识蒸馏。";
      return;
    }
    busy.value = "create";
    error.value = "";
    try {
      const run = await createKnowledgeDistillationWorkbenchRun({
        title: `${props.ingestJob.id} 项目知识蒸馏`,
        jobId: props.ingestJob.id,
        batchId: props.normalizedManifest?.batchId || props.ingestJob.id,
        query: "项目全部文档通用知识蒸馏",
        workflowScope: "project",
        ...createOptions.value,
        modelEnabled: true,
      });
      selectedRunId.value = run.runId;
      selectedRun.value = run;
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "创建知识蒸馏工作台任务失败。";
    } finally {
      busy.value = "";
    }
  }

  async function cancelRun() {
    if (!selectedRun.value?.runId) {
      return;
    }
    if (!confirmConsoleAction("确认取消当前知识蒸馏任务？")) {
      return;
    }
    busy.value = "cancel";
    error.value = "";
    try {
      selectedRun.value = await cancelKnowledgeDistillationWorkbenchRun(selectedRun.value.runId, "用户在工作台取消任务");
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "取消知识蒸馏工作台任务失败。";
    } finally {
      busy.value = "";
    }
  }

  async function archiveRun() {
    if (!selectedRun.value?.runId) {
      return;
    }
    if (!confirmConsoleAction("确认归档当前知识蒸馏任务？归档后默认不在任务列表展示。")) {
      return;
    }
    busy.value = "archive";
    error.value = "";
    try {
      selectedRun.value = await archiveKnowledgeDistillationWorkbenchRun(selectedRun.value.runId);
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "归档知识蒸馏工作台任务失败。";
    } finally {
      busy.value = "";
    }
  }

  async function deleteRun() {
    if (!selectedRun.value?.runId) {
      return;
    }
    if (!confirmConsoleAction("确认删除当前知识蒸馏任务及其工作台记录？")) {
      return;
    }
    busy.value = "delete";
    error.value = "";
    const deletedId = selectedRun.value.runId;
    try {
      await deleteKnowledgeDistillationWorkbenchRun(deletedId);
      if (selectedRunId.value === deletedId) {
        selectedRunId.value = "";
        selectedRun.value = null;
      }
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "删除知识蒸馏工作台任务失败。";
    } finally {
      busy.value = "";
    }
  }

  async function rerunStage(stage: WorkbenchStage) {
    if (!selectedRun.value?.runId || !stage.stageId) {
      return;
    }
    if (!confirmConsoleAction(`确认从“${stage.title}”开始重跑？当前及后续阶段会保留历史版本后重新生成。`)) {
      return;
    }
    busy.value = `rerun:${stage.stageId}`;
    error.value = "";
    try {
      selectedRun.value = await rerunKnowledgeDistillationWorkbenchStage(selectedRun.value.runId, stage.stageId);
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "重跑知识蒸馏阶段失败。";
    } finally {
      busy.value = "";
    }
  }

  async function compareRuns() {
    if (!selectedRun.value?.runId || !compareRightRunId.value) {
      return;
    }
    busy.value = "compare";
    error.value = "";
    compareResult.value = null;
    try {
      compareResult.value = await compareKnowledgeDistillationWorkbenchRuns(
        selectedRun.value.runId,
        compareRightRunId.value,
      );
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "比较知识蒸馏版本失败。";
    } finally {
      busy.value = "";
    }
  }

  function packageUrl() {
    if (!selectedRun.value?.runId) {
      return "#";
    }
    return knowledgeDistillationWorkbenchPackageUrl(selectedRun.value.runId);
  }

  async function resumeRun() {
    if (!selectedRun.value?.runId) {
      return;
    }
    busy.value = "resume";
    error.value = "";
    try {
      selectedRun.value = await resumeKnowledgeDistillationWorkbenchRun(selectedRun.value.runId);
      await refreshRuns();
    } catch (nextError) {
      error.value = nextError instanceof Error ? nextError.message : "恢复知识蒸馏工作台任务失败。";
    } finally {
      busy.value = "";
    }
  }

  function selectRun(runId: string) {
    selectedRunId.value = runId;
    const found = runs.value.find((run) => run.runId === runId);
    selectedRun.value = found || null;
    compareResult.value = null;
    refreshSelectedRun();
  }

  watch(needsPolling, (enabled) => {
    runPolling.stop();
    if (enabled) {
      runPolling.start(() => {
        refreshSelectedRun();
      }, 1800);
    }
  }, { immediate: true });

  onMounted(() => {
    refreshRuns().catch((nextError) => {
      error.value = nextError instanceof Error ? nextError.message : "加载知识蒸馏工作台失败。";
    });
    refreshModelProbeStatus().catch(() => undefined);
  });

  usePageRefreshHandler(
    (detail) =>
      (detail.viewId === "debug" && detail.debugTab === "knowledgeDistillation") ||
      detail.viewId === "knowledge",
    async () => {
      await Promise.all([
        refreshRuns(),
        refreshModelProbeStatus(),
        selectedRunId.value ? refreshSelectedRun() : Promise.resolve(),
      ]);
    },
  );

  onBeforeUnmount(() => {
    runPolling.stop();
  });

  return {
    activeJobCompleted,
    activeRunProgress,
    activeRunStages,
    archiveRun,
    busy,
    canStart,
    cancelRun,
    compareResult,
    compareRightRunId,
    compareRuns,
    createOptions,
    deleteRun,
    distillationModelOptions,
    error,
    modelProbeLabel,
    modelProbeTone,
    modelProbeTooltip,
    packageUrl,
    refreshModelProbeStatus,
    refreshRuns,
    refreshSelectedRun,
    rerunStage,
    resumeRun,
    runs,
    selectRun,
    selectedRun,
    selectedRunId,
    startWorkbenchRun,
  };
}
