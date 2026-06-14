import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { usePageRefreshHandler } from "./usePageRefresh";
import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  normalizeRuntimeDependencies,
  type RuntimeDependency,
} from "../lib/runtime-dependencies";
import { createRuntimeDownloadActionController } from "./console-runtime-download-action-controller";

const RUNTIME_DEPENDENCY_TARGET_IDS = [
  "dify",
  "rag-flow",
  "cloud-drives",
  "docker",
  "jre",
  "python",
  "node",
  "caddy",
  "nginx",
  "gerrit",
];

const RUNTIME_DEPENDENCY_LABELS: Record<string, string> = {
  caddy: "Caddy",
  "cloud-drives": "Cloud Drives",
  dify: "Dify",
  docker: "Docker",
  gerrit: "Gerrit",
  jre: "Java 环境",
  nginx: "Nginx",
  node: "Node.js 环境",
  python: "Python 环境",
  "rag-flow": "RAG Flow",
};

const runtimeDependencyOrder = new Map(
  RUNTIME_DEPENDENCY_TARGET_IDS.map((targetId, index) => [targetId, index]),
);

type RuntimeDependencyRefreshOptions = {
  silent?: boolean;
};

type RuntimeDependencyTargetRefreshOptions = RuntimeDependencyRefreshOptions & {
  generation?: number;
};

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

function runtimeDependencyTargetLabel(targetId = "") {
  return RUNTIME_DEPENDENCY_LABELS[targetId] || targetId || "运行时依赖";
}

function createRuntimeDependencyPlaceholder(targetId = ""): RuntimeDependency {
  return {
    id: targetId,
    label: runtimeDependencyTargetLabel(targetId),
    category: "runtime",
    description: "正在检测本机环境。",
    status: "loading",
    present: false,
    cached: false,
    downloadable: false,
    detection: {
      availabilityLabel: "检测中",
      source: {
        label: "检测队列",
        path: "等待检测",
      },
    },
    actions: {
      detect: "pending",
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createRuntimeDependencyError(targetId = "", error: unknown): RuntimeDependency {
  const message = errorMessage(error);
  return {
    ...createRuntimeDependencyPlaceholder(targetId),
    description: message,
    status: "failed",
    detection: {
      availabilityLabel: "检测失败",
      source: {
        label: "检测失败",
        path: message,
      },
    },
    actions: {
      detect: "failed",
    },
  };
}

function runtimeDependencySortIndex(item: RuntimeDependency) {
  return runtimeDependencyOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER;
}

function runtimeDependencyErrorSummary(messages: string[]) {
  if (!messages.length) return "";
  const visibleMessages = messages.slice(0, 3).join("；");
  const suffix = messages.length > 3 ? `，另有 ${messages.length - 3} 项失败` : "";
  return `部分依赖检测失败：${visibleMessages}${suffix}`;
}

export function useRuntimeDownloadsViewController() {
  const dependencies = ref<RuntimeDependency[]>([]);
  const cacheRoot = ref("");
  const sourceConfigPath = ref("");
  const generatedAt = ref("");
  const loading = ref(false);
  const loadError = ref("");
  const refreshingTargetIds = ref<string[]>([]);
  let refreshGeneration = 0;
  const runtimeAction = createRuntimeDownloadActionController({
    downloadRuntimeDependency,
    refreshRuntimeDependency,
    refreshRuntimeDependencies,
  });

  const readyCount = computed(() => dependencies.value.filter((item) => item.present).length);
  const installedCount = computed(() => dependencies.value.filter((item) => item.status === "installed").length);
  const failedCount = computed(() => dependencies.value.filter((item) => item.status === "failed").length);
  const generatedAtLabel = computed(() => formatRuntimeGeneratedAt(generatedAt.value));

  function beginTargetRefresh(targetId = "") {
    if (!targetId) return;
    refreshingTargetIds.value = [...refreshingTargetIds.value, targetId];
  }

  function finishTargetRefresh(targetId = "") {
    const index = refreshingTargetIds.value.indexOf(targetId);
    if (index < 0) return;
    const nextTargetIds = [...refreshingTargetIds.value];
    nextTargetIds.splice(index, 1);
    refreshingTargetIds.value = nextTargetIds;
  }

  function isRuntimeDependencyRefreshing(targetId = "") {
    return refreshingTargetIds.value.includes(targetId);
  }

  function mergeRuntimeDependencies(nextItems: RuntimeDependency[] = []) {
    if (!nextItems.length) return;
    const byId = new Map(dependencies.value.map((item) => [item.id, item]));
    for (const item of nextItems) {
      byId.set(item.id, item);
    }
    dependencies.value = Array.from(byId.values()).sort((left, right) => {
      const indexDelta = runtimeDependencySortIndex(left) - runtimeDependencySortIndex(right);
      if (indexDelta !== 0) return indexDelta;
      return left.label.localeCompare(right.label, "zh-CN");
    });
  }

  function ensureRuntimeDependencyPlaceholders() {
    const existingIds = new Set(dependencies.value.map((item) => item.id));
    const missingItems = RUNTIME_DEPENDENCY_TARGET_IDS
      .filter((targetId) => !existingIds.has(targetId))
      .map(createRuntimeDependencyPlaceholder);
    mergeRuntimeDependencies(missingItems);
  }

  function applyRuntimeDependencyPayload(payload: Awaited<ReturnType<typeof listRuntimeDependencies>>) {
    runtimeAction.setDownloadRuns(payload.downloads || []);
    if (typeof payload.cacheRoot === "string") {
      cacheRoot.value = payload.cacheRoot;
    }
    if (typeof payload.sourceConfigPath === "string") {
      sourceConfigPath.value = payload.sourceConfigPath;
    }
    if (typeof payload.generatedAt === "string") {
      generatedAt.value = payload.generatedAt;
    }
  }

  async function refreshRuntimeDependencyTarget(
    targetId: string,
    options: RuntimeDependencyTargetRefreshOptions = {},
  ) {
    if (!targetId) return "";
    beginTargetRefresh(targetId);
    if (!options.silent) {
      mergeRuntimeDependencies([createRuntimeDependencyPlaceholder(targetId)]);
    }
    try {
      const payload = await listRuntimeDependencies({ targetId });
      if (options.generation !== undefined && options.generation !== refreshGeneration) {
        return "";
      }
      applyRuntimeDependencyPayload(payload);
      const nextDependencies = normalizeRuntimeDependencies(payload.dependencies || []);
      if (nextDependencies.length) {
        mergeRuntimeDependencies(nextDependencies);
      } else {
        mergeRuntimeDependencies([createRuntimeDependencyError(targetId, "接口未返回依赖状态")]);
        return `${runtimeDependencyTargetLabel(targetId)}：接口未返回依赖状态`;
      }
      return "";
    } catch (error) {
      if (options.generation === undefined || options.generation === refreshGeneration) {
        mergeRuntimeDependencies([createRuntimeDependencyError(targetId, error)]);
      }
      return `${runtimeDependencyTargetLabel(targetId)}：${errorMessage(error)}`;
    } finally {
      finishTargetRefresh(targetId);
    }
  }

  async function refreshRuntimeDependency(targetId: string, options: RuntimeDependencyRefreshOptions = {}) {
    if (!targetId) {
      await refreshRuntimeDependencies(options);
      return;
    }
    if (!options.silent) loading.value = true;
    loadError.value = "";
    const targetError = await refreshRuntimeDependencyTarget(targetId, options);
    if (targetError) {
      loadError.value = targetError;
    }
    if (!options.silent) loading.value = false;
  }

  async function refreshRuntimeDependencies(options: RuntimeDependencyRefreshOptions = {}) {
    const generation = ++refreshGeneration;
    if (!options.silent) loading.value = true;
    loadError.value = "";
    ensureRuntimeDependencyPlaceholders();
    try {
      const targetErrors = (await Promise.all(
        RUNTIME_DEPENDENCY_TARGET_IDS.map((targetId) =>
          refreshRuntimeDependencyTarget(targetId, { generation, silent: true }),
        ),
      )).filter(Boolean);
      if (generation === refreshGeneration) {
        loadError.value = runtimeDependencyErrorSummary(targetErrors);
      }
    } finally {
      if (!options.silent && generation === refreshGeneration) {
        loading.value = false;
      }
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
    isRuntimeDependencyRefreshing,
    loadError,
    loading,
    prepareDependency: runtimeAction.prepareDependency,
    readyCount,
    refreshingTargetIds,
    refreshRuntimeDependency,
    refreshRuntimeDependencies,
    sourceConfigPath,
  };
}
