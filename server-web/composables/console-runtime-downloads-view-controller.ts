import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { usePageRefreshHandler } from "./usePageRefresh";
import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  normalizeRuntimeDependencies,
  type RuntimeDependency,
} from "../lib/runtime-dependencies";
import { createRuntimeDownloadActionController } from "./console-runtime-download-action-controller";

function formatRuntimeGeneratedAt(value = "") {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function useRuntimeDownloadsViewController() {
  const dependencies = ref<RuntimeDependency[]>([]);
  const cacheRoot = ref("");
  const sourceConfigPath = ref("");
  const generatedAt = ref("");
  const loading = ref(false);
  const loadError = ref("");
  const runtimeAction = createRuntimeDownloadActionController({
    downloadRuntimeDependency,
    refreshRuntimeDependencies,
  });

  const readyCount = computed(() => dependencies.value.filter((item) => item.present).length);
  const installedCount = computed(() => dependencies.value.filter((item) => item.status === "installed").length);
  const failedCount = computed(() => dependencies.value.filter((item) => item.status === "failed").length);
  const generatedAtLabel = computed(() => formatRuntimeGeneratedAt(generatedAt.value));

  async function refreshRuntimeDependencies(options: { silent?: boolean } = {}) {
    if (!options.silent) loading.value = true;
    loadError.value = "";
    try {
      const payload = await listRuntimeDependencies();
      dependencies.value = normalizeRuntimeDependencies(payload.dependencies || []);
      runtimeAction.setDownloadRuns(payload.downloads || []);
      cacheRoot.value = payload.cacheRoot || "";
      sourceConfigPath.value = payload.sourceConfigPath || "";
      generatedAt.value = payload.generatedAt || "";
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (!options.silent) loading.value = false;
    }
  }

  onMounted(() => {
    void refreshRuntimeDependencies();
  });

  usePageRefreshHandler(
    (detail) => detail.viewId === "admin" && detail.adminView === "runtimeDownloads",
    () => refreshRuntimeDependencies(),
  );

  onBeforeUnmount(runtimeAction.stopActionPolling);

  return {
    ...runtimeAction,
    cacheRoot,
    dependencies,
    failedCount,
    generatedAtLabel,
    installedCount,
    loadError,
    loading,
    prepareDependency: runtimeAction.prepareDependency,
    readyCount,
    refreshRuntimeDependencies,
    sourceConfigPath,
  };
}
