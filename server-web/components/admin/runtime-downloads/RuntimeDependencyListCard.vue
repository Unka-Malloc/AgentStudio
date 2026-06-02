<script setup lang="ts">
import StatusPill from "../../StatusPill.vue";
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";
import {
  canTrigger,
  isRuntimeDependencyRunActive,
  runtimeVersionHint,
  sourceHint,
  statusLabel,
  statusTone,
} from "../../../lib/runtime-dependencies";

const {
  dependencyActionBusy,
  dependencyStatusForRow,
  dependencies,
  loading,
  prepareDependency,
} = useRuntimeDownloadsViewContext();
</script>

<template>
  <article class="surface-card">
    <div class="runtime-dependency-list">
      <div class="runtime-dependency-header">
        <span>依赖</span>
        <span>状态</span>
        <span>检测来源</span>
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
          <span>{{ sourceHint(item) }}</span>
        </div>
        <div>
          <button
            class="tool-button"
            type="button"
            :disabled="dependencyActionBusy(item.id) || isRuntimeDependencyRunActive(dependencyStatusForRow(item)) || !canTrigger(item)"
            @click="prepareDependency(item)"
          >
            {{ isRuntimeDependencyRunActive(dependencyStatusForRow(item)) ? statusLabel(dependencyStatusForRow(item)) : item.present ? "已存在" : "安装" }}
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

<style scoped>
.runtime-dependency-list {
  display: grid;
  gap: 8px;
}

.runtime-dependency-header,
.runtime-dependency-row {
  display: grid;
  grid-template-columns: minmax(190px, 1.2fr) minmax(96px, 0.5fr) minmax(260px, 1.4fr) minmax(92px, 0.4fr);
  gap: 12px;
  align-items: center;
}

.runtime-dependency-header {
  color: var(--muted-text);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.runtime-dependency-row {
  min-height: 72px;
  padding: 12px 0;
  border-top: 1px solid var(--border-subtle);
}

.runtime-dependency-name,
.runtime-dependency-source {
  display: grid;
  gap: 4px;
}

.runtime-dependency-name small,
.runtime-dependency-source span {
  color: var(--muted-text);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 980px) {
  .runtime-dependency-header {
    display: none;
  }

  .runtime-dependency-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}
</style>
