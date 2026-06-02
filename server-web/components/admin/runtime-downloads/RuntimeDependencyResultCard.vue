<script setup lang="ts">
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";
import { statusLabel, statusTone } from "../../../lib/runtime-dependencies";
import RuntimeDependencyRunCard from "./RuntimeDependencyRunCard.vue";

const {
  actionError,
  actionResult,
  actionRunCards,
} = useRuntimeDownloadsViewContext();

function latestStatus() {
  const result = actionResult.value;
  return result?.status || result?.detection?.status || result?.run?.status || "";
}
</script>

<template>
  <article v-if="actionError || actionResult || actionRunCards.length" class="surface-card">
    <div class="section-header">
      <div>
        <h3>下载进展</h3>
      </div>
      <div v-if="actionRunCards.length" class="section-tags">
        <span>{{ actionRunCards.length }} 个任务</span>
      </div>
    </div>
    <div v-if="actionError" class="status-strip danger">
      <strong>执行失败</strong>
      <span>{{ actionError }}</span>
    </div>
    <div v-if="actionResult" :class="['status-strip', statusTone(latestStatus())]">
      <strong>{{ actionResult.ok ? "执行完成" : "执行失败" }}</strong>
      <span>{{ statusLabel(latestStatus()) }}</span>
    </div>
    <div class="runtime-dependency-run-stack">
      <RuntimeDependencyRunCard
        v-for="card in actionRunCards"
        :key="card.run.runId"
        :card="card"
      />
    </div>
  </article>
</template>
