<script setup lang="ts">
import { computed } from "vue";
import StatusPill from "../../StatusPill.vue";
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";
import RuntimeDependencyConfigButton from "./RuntimeDependencyConfigButton.vue";
import {
  canTrigger,
  isRuntimeDependencyRunActive,
  runtimeVersionHint,
  sourceParts,
  statusLabel,
  statusTone,
  type RuntimeDependency,
} from "../../../lib/runtime-dependencies";

const {
  dependencyActionBusy,
  dependencyStatusForRow,
  dependencies,
  loading,
  prepareDependency,
} = useRuntimeDownloadsViewContext();

const runtimeDependencyGroupDefinitions = [
  {
    id: "programming-languages",
    title: "编程语言",
    scope: "Java / Node.js / Python",
    targetIds: ["jre", "java", "node", "nodejs", "python"],
  },
  {
    id: "deployment-platforms",
    title: "部署平台",
    scope: "Docker",
    targetIds: ["docker", "docker-desktop"],
  },
  {
    id: "gateway-services",
    title: "网关服务",
    scope: "Caddy / Nginx",
    targetIds: ["caddy", "nginx", "gateway-ingress"],
  },
  {
    id: "code-services",
    title: "代码服务",
    scope: "Gerrit / GitHub",
    targetIds: ["gerrit", "github", "github-cli", "gh"],
  },
  {
    id: "cloud-drive-services",
    title: "云盘服务",
    scope: "OneDrive / iCloud / Google Drive",
    targetIds: ["cloud-drives", "icloud", "onedrive", "one-drive", "google-drive", "google-cloud", "dropbox"],
  },
  {
    id: "agent-services",
    title: "智能体服务",
    scope: "Dify / RAG Flow",
    targetIds: ["dify", "rag-flow", "ragflow"],
  },
];

const groupedDependencies = computed(() => {
  const assignedIds = new Set<string>();
  const groups = runtimeDependencyGroupDefinitions
    .map((definition) => {
      const targetOrder = new Map(definition.targetIds.map((targetId, index) => [targetId, index]));
      const items = dependencies.value
        .filter((item) => targetOrder.has(item.id))
        .sort((left, right) => {
          const leftIndex = targetOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
          const rightIndex = targetOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return left.label.localeCompare(right.label, "zh-CN");
        });
      for (const item of items) {
        assignedIds.add(item.id);
      }
      return {
        ...definition,
        failedCount: items.filter((item) => item.status === "failed").length,
        items,
        readyCount: items.filter((item) => item.present).length,
      };
    })
    .filter((group) => group.items.length > 0);

  const otherItems = dependencies.value.filter((item) => !assignedIds.has(item.id));
  if (otherItems.length) {
    groups.push({
      failedCount: otherItems.filter((item) => item.status === "failed").length,
      id: "other-runtime-dependencies",
      items: otherItems,
      readyCount: otherItems.filter((item) => item.present).length,
      scope: "未归类",
      targetIds: otherItems.map((item) => item.id),
      title: "其他依赖",
    });
  }
  return groups;
});

function dependencyActionLabel(item: RuntimeDependency) {
  const status = dependencyStatusForRow(item);
  if (isRuntimeDependencyRunActive(status)) return statusLabel(status);
  if (item.present) return "已存在";
  if (!canTrigger(item)) return "不可用";
  return "安装";
}
</script>

<template>
  <section class="runtime-dependency-groups">
    <article
      v-for="group in groupedDependencies"
      :key="group.id"
      class="surface-card runtime-dependency-card"
    >
      <div class="section-header runtime-dependency-group-header">
        <div>
          <h3>{{ group.title }}</h3>
          <p>{{ group.scope }}</p>
        </div>
        <div class="section-tags">
          <span>{{ group.items.length }} 项</span>
          <span>已存在 {{ group.readyCount }}</span>
          <span>不可用 {{ group.failedCount }}</span>
        </div>
      </div>

      <div class="runtime-dependency-list">
        <div class="runtime-dependency-header">
          <span>依赖</span>
          <span>状态</span>
          <span>来源</span>
          <span>路径</span>
          <span>操作</span>
        </div>
        <div
          v-for="item in group.items"
          :key="`${group.id}:${item.id}`"
          class="runtime-dependency-row"
        >
          <div class="runtime-dependency-name">
            <strong>{{ item.label }}</strong>
            <small>{{ runtimeVersionHint(item) }}</small>
          </div>
          <div>
            <StatusPill :tone="statusTone(dependencyStatusForRow(item))" :label="statusLabel(dependencyStatusForRow(item))" />
          </div>
          <div class="runtime-dependency-source">
            <strong>{{ sourceParts(item).source }}</strong>
          </div>
          <div class="runtime-dependency-path">
            <span>{{ sourceParts(item).path }}</span>
          </div>
          <div class="runtime-dependency-action">
            <RuntimeDependencyConfigButton :item="item" />
            <button
              class="tool-button"
              type="button"
              :disabled="dependencyActionBusy(item.id) || isRuntimeDependencyRunActive(dependencyStatusForRow(item)) || !canTrigger(item)"
              @click="prepareDependency(item)"
            >
              {{ dependencyActionLabel(item) }}
            </button>
          </div>
        </div>
      </div>
    </article>

    <article v-if="!loading && dependencies.length === 0" class="surface-card empty-state">
      <strong>暂无依赖状态</strong>
      <span>刷新后会显示当前平台可检测的运行时依赖。</span>
    </article>
  </section>
</template>
