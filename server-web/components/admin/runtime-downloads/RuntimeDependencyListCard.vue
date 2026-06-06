<script setup lang="ts">
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

function dependencyActionLabel(item: RuntimeDependency) {
  const status = dependencyStatusForRow(item);
  if (isRuntimeDependencyRunActive(status)) return statusLabel(status);
  if (item.present) return "已存在";
  if (!canTrigger(item)) return "不可用";
  return "安装";
}
</script>

<template>
  <article class="surface-card">
    <div class="runtime-dependency-list">
      <div class="runtime-dependency-header">
        <span>依赖</span>
        <span>状态</span>
        <span>来源</span>
        <span>路径</span>
        <span>操作</span>
      </div>
      <div
        v-for="item in dependencies"
        :key="item.id"
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
    <div v-if="!loading && dependencies.length === 0" class="empty-state">
      <strong>暂无依赖状态</strong>
      <span>刷新后会显示当前平台可检测的运行时依赖。</span>
    </div>
  </article>
</template>
