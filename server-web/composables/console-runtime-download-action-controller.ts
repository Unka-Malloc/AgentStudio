import { computed, ref, type Ref } from "vue";
import {
  canTrigger,
  isRuntimeDependencyRunActive,
  runtimeDependencyLogEntries,
  runtimeDependencyRunProgressState,
  type RuntimeDependency,
  type RuntimeDependencyActionResult,
  type RuntimeDependencyDownloadRun,
} from "../lib/runtime-dependencies";
import { createConsoleIntervalController } from "./console-timer-controller";

type RuntimeDependencyRunCard = {
  logEntries: ReturnType<typeof runtimeDependencyLogEntries>;
  progressState: ReturnType<typeof runtimeDependencyRunProgressState>;
  run: RuntimeDependencyDownloadRun;
};

type RuntimeDownloadActionOptions = {
  downloadRuntimeDependency: (item: RuntimeDependency) => Promise<RuntimeDependencyActionResult>;
  refreshRuntimeDependencies: (options?: { silent?: boolean }) => Promise<void>;
};

const runtimeDownloadStepPlans: Record<string, Array<[string, string]>> = {
  caddy: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  nginx: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  docker: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  python: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  jre: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["install", "下载并安装"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  node: [
    ["detect", "检测"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
  gerrit: [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载 WAR"],
    ["verify", "验证"],
    ["complete", "完成"],
  ],
};

function plannedSteps(targetId = "") {
  const steps = runtimeDownloadStepPlans[targetId] || [
    ["detect", "检测"],
    ["source", "下载源"],
    ["download", "下载"],
    ["verify", "验证"],
    ["complete", "完成"],
  ];
  return steps.map(([key, label], index) => ({
    key,
    label,
    index,
    status: index === 0 ? "running" : "pending",
    startedAt: index === 0 ? new Date().toISOString() : "",
    updatedAt: "",
    completedAt: "",
  }));
}

function createQueuedRun(targetId = ""): RuntimeDependencyDownloadRun {
  const now = new Date().toISOString();
  return {
    runId: `runtime_local_${targetId}_${Date.now()}`,
    targetId,
    status: "queued",
    ok: true,
    startedAt: now,
    updatedAt: now,
    completedAt: "",
    latestMessage: "已提交安装请求，等待后台任务开始。",
    steps: plannedSteps(targetId),
    completedSteps: 0,
    totalSteps: plannedSteps(targetId).length,
    currentStepKey: plannedSteps(targetId)[0]?.key || "",
    currentStepIndex: 0,
    progressPercent: 0,
    log: [
      {
        at: now,
        level: "info",
        message: `已提交安装请求：${targetId}`,
      },
    ],
    result: null,
  };
}

function runCardFromRun(run: RuntimeDependencyDownloadRun): RuntimeDependencyRunCard {
  return {
    logEntries: runtimeDependencyLogEntries(run.log || []),
    progressState: runtimeDependencyRunProgressState(run),
    run,
  };
}

export function createRuntimeDownloadActionController(options: RuntimeDownloadActionOptions) {
  const downloads = ref<RuntimeDependencyDownloadRun[]>([]);
  const actionBusyIds = ref<string[]>([]);
  const actionError = ref("");
  const actionResult = ref<RuntimeDependencyActionResult | null>(null);
  const actionPolling = createConsoleIntervalController();

  function latestRunForTarget(targetId = "") {
    return downloads.value.find((run) => run.targetId === targetId) || null;
  }

  function hasActiveRuns() {
    return downloads.value.some((run) => isRuntimeDependencyRunActive(run.status));
  }

  function isTargetBusy(targetId = "") {
    return actionBusyIds.value.includes(targetId) || isRuntimeDependencyRunActive(latestRunForTarget(targetId)?.status || "");
  }

  const actionRunCards = computed<RuntimeDependencyRunCard[]>(() =>
    downloads.value.slice(0, 8).map(runCardFromRun),
  );

  function setDownloadRuns(nextDownloads: RuntimeDependencyDownloadRun[] = []) {
    downloads.value = nextDownloads;
    updateActionFromDownloads();
  }

  function dependencyStatusForRow(item: RuntimeDependency) {
    const run = latestRunForTarget(item.id);
    return run && isRuntimeDependencyRunActive(run.status) ? run.status : item.status;
  }

  function dependencyActionBusy(targetId = "") {
    return isTargetBusy(targetId);
  }

  function dependencyRunCardForTarget(targetId = "") {
    const run = latestRunForTarget(targetId);
    return run ? runCardFromRun(run) : null;
  }

  function stopActionPolling() { actionPolling.stop(); }

  function startActionPolling() {
    stopActionPolling();
    actionPolling.start(() => {
      void options.refreshRuntimeDependencies({ silent: true });
    }, 800);
  }

  function updateActionFromDownloads() {
    if (hasActiveRuns() || actionBusyIds.value.length) return;
    stopActionPolling();
  }

  async function prepareDependency(item: RuntimeDependency) {
    if (!canTrigger(item) || isTargetBusy(item.id)) return;
    actionBusyIds.value = [...new Set([...actionBusyIds.value, item.id])];
    actionError.value = "";
    actionResult.value = null;
    const queuedRun = createQueuedRun(item.id);
    setDownloadRuns([
      queuedRun,
      ...downloads.value.filter((run) => run.targetId !== item.id),
    ]);
    startActionPolling();
    try {
      const result = await options.downloadRuntimeDependency(item);
      actionResult.value = result;
      if (result.run) {
        setDownloadRuns([
          result.run,
          ...downloads.value.filter((run) => run.runId !== queuedRun.runId && run.runId !== result.runId),
        ]);
      }
      await options.refreshRuntimeDependencies({ silent: true });
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
      setDownloadRuns([
        {
          ...queuedRun,
          ok: false,
          status: "failed",
          updatedAt: new Date().toISOString(),
          latestMessage: actionError.value,
          steps: (queuedRun.steps || []).map((step, index) => ({
            ...step,
            status: index === 0 ? "failed" : step.status,
          })),
          log: [
            ...(queuedRun.log || []),
            {
              at: new Date().toISOString(),
              level: "error",
              message: actionError.value,
            },
          ],
        },
        ...downloads.value.filter((run) => run.runId !== queuedRun.runId),
      ]);
    } finally {
      actionBusyIds.value = actionBusyIds.value.filter((targetId) => targetId !== item.id);
      updateActionFromDownloads();
    }
  }

  return {
    actionError,
    actionResult,
    actionRunCards,
    dependencyActionBusy,
    dependencyRunCardForTarget,
    dependencyStatusForRow,
    downloads: downloads as Ref<RuntimeDependencyDownloadRun[]>,
    prepareDependency,
    setDownloadRuns,
    stopActionPolling,
  };
}
