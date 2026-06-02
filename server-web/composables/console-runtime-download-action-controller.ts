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

export function createRuntimeDownloadActionController(options: RuntimeDownloadActionOptions) {
  const downloads = ref<RuntimeDependencyDownloadRun[]>([]);
  const actionBusyIds = ref<string[]>([]);
  const actionError = ref("");
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
    downloads.value.slice(0, 8).map((run) => ({
      logEntries: runtimeDependencyLogEntries(run.log || []),
      progressState: runtimeDependencyRunProgressState(run),
      run,
    })),
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
    try {
      const result = await options.downloadRuntimeDependency(item);
      if (result.run) {
        setDownloadRuns([
          result.run,
          ...downloads.value.filter((run) => run.runId !== result.runId),
        ]);
      }
      startActionPolling();
      await options.refreshRuntimeDependencies({ silent: true });
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      actionBusyIds.value = actionBusyIds.value.filter((targetId) => targetId !== item.id);
      updateActionFromDownloads();
    }
  }

  return {
    actionError,
    actionRunCards,
    dependencyActionBusy,
    dependencyStatusForRow,
    downloads: downloads as Ref<RuntimeDependencyDownloadRun[]>,
    prepareDependency,
    setDownloadRuns,
    stopActionPolling,
  };
}
