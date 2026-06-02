import { computed, ref, type Ref } from "vue";
import {
  createKnowledgeSource as createKnowledgeSourceApi,
  deleteKnowledgeSource as deleteKnowledgeSourceApi,
  getKnowledgeSources,
  refreshKnowledgeSource as refreshKnowledgeSourceApi,
  updateKnowledgeSource as updateKnowledgeSourceApi,
} from "../lib/knowledge-sources-client";
import type {
  KnowledgeConsoleState,
  KnowledgeSource,
  KnowledgeSourceState,
  SplitJob,
} from "../lib/types";

export type ConsoleKnowledgeSourceControllerOptions = {
  error: Ref<string>;
  ingestJob: Ref<SplitJob | null>;
  knowledgeConsole: Ref<KnowledgeConsoleState | null>;
  knowledgeSourceState: Ref<KnowledgeSourceState | null>;
  clearAllBusy: () => void;
  setBusy: (key: string) => void;
};

export function directoryNameFromPath(directoryPath: string) {
  const normalized = String(directoryPath || "")
    .trim()
    .replace(/[\\/]+$/g, "");
  if (!normalized) {
    return "";
  }
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

export function createConsoleKnowledgeSourceController(options: ConsoleKnowledgeSourceControllerOptions) {
  const localSourceForm = ref({
    label: "",
    directoryPath: "",
    autoSync: true,
    recursive: true,
    hydrationEnabled: true,
  });

  const activeKnowledgeSources = computed(() => options.knowledgeSourceState.value?.sources || []);

  function applyKnowledgeSourceState(state: KnowledgeSourceState | null | undefined) {
    if (!state) {
      return;
    }
    options.knowledgeSourceState.value = state;
    if (options.knowledgeConsole.value) {
      options.knowledgeConsole.value = {
        ...options.knowledgeConsole.value,
        sources: state,
      };
    }
  }

  function applyJobToKnowledgeSources(job: SplitJob) {
    if (!options.knowledgeSourceState.value || !job?.id) {
      return;
    }
    options.knowledgeSourceState.value = {
      ...options.knowledgeSourceState.value,
      sources: options.knowledgeSourceState.value.sources.map((source) =>
        source.lastJobId === job.id
          ? {
              ...source,
              lastJobStatus: job.status,
              lastJobStage: job.stage,
              lastJobProgressPercent: Number(job.progressPercent || 0),
              lastJobUpdatedAt: job.updatedAt,
            }
          : source,
      ),
    };
  }

  function applyLocalSourceDirectoryPath(nextPath: string) {
    const currentPath = localSourceForm.value.directoryPath;
    const currentDefaultName = directoryNameFromPath(currentPath);
    const currentLabel = localSourceForm.value.label.trim();
    const shouldUseDirectoryName = !currentLabel || currentLabel === currentDefaultName;
    localSourceForm.value.directoryPath = nextPath;
    if (shouldUseDirectoryName) {
      localSourceForm.value.label = directoryNameFromPath(nextPath);
    }
  }

  function syncLocalSourceLabelFromPath() {
    if (!localSourceForm.value.label.trim()) {
      localSourceForm.value.label = directoryNameFromPath(localSourceForm.value.directoryPath);
    }
  }

  async function refreshKnowledgeSources() {
    options.setBusy("knowledge:sources");
    options.error.value = "";
    try {
      applyKnowledgeSourceState(await getKnowledgeSources());
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "刷新目录失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function addKnowledgeSource() {
    const directoryPath = localSourceForm.value.directoryPath.trim();
    if (!directoryPath) {
      options.error.value = "请填写服务端本地路径。";
      return false;
    }
    options.setBusy("knowledge:sources:add");
    options.error.value = "";
    try {
      const result = await createKnowledgeSourceApi({
        label: localSourceForm.value.label.trim() || directoryNameFromPath(directoryPath),
        directoryPath,
        autoSync: localSourceForm.value.autoSync,
        recursive: localSourceForm.value.recursive,
        hydrationEnabled: localSourceForm.value.hydrationEnabled,
        enabled: true,
        runNow: true,
      });
      applyKnowledgeSourceState(result.state);
      if (result.job) {
        options.ingestJob.value = result.job;
      }
      localSourceForm.value = {
        label: "",
        directoryPath: "",
        autoSync: true,
        recursive: true,
        hydrationEnabled: true,
      };
      return true;
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "添加目录失败。";
      return false;
    } finally {
      options.clearAllBusy();
    }
  }

  async function updateKnowledgeSource(source: KnowledgeSource, patch: Record<string, unknown>) {
    options.setBusy(`knowledge:source:${source.sourceId}`);
    options.error.value = "";
    try {
      const result = await updateKnowledgeSourceApi(source.sourceId, patch);
      applyKnowledgeSourceState(result.state);
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "更新目录失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function refreshKnowledgeSource(source: KnowledgeSource, force = false) {
    options.setBusy(`knowledge:source:refresh:${source.sourceId}`);
    options.error.value = "";
    try {
      const result = await refreshKnowledgeSourceApi(source.sourceId, { force });
      applyKnowledgeSourceState(result.state);
      if (result.job) {
        options.ingestJob.value = result.job;
      }
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "刷新目录失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function deleteKnowledgeSource(source: KnowledgeSource) {
    options.setBusy(`knowledge:source:delete:${source.sourceId}`);
    options.error.value = "";
    try {
      const result = await deleteKnowledgeSourceApi(source.sourceId);
      applyKnowledgeSourceState(result.state);
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "删除目录失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    activeKnowledgeSources,
    addKnowledgeSource,
    applyJobToKnowledgeSources,
    applyKnowledgeSourceState,
    applyLocalSourceDirectoryPath,
    deleteKnowledgeSource,
    directoryNameFromPath,
    localSourceForm,
    refreshKnowledgeSource,
    refreshKnowledgeSources,
    syncLocalSourceLabelFromPath,
    updateKnowledgeSource,
  };
}
