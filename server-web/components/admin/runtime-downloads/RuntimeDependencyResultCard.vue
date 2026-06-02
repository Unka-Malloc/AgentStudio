<script setup lang="ts">
import { useRuntimeDownloadsViewContext } from "../../../composables/runtimeDownloadsViewContext";
import RuntimeDependencyRunCard from "./RuntimeDependencyRunCard.vue";

const {
  actionError,
  actionRunCards,
} = useRuntimeDownloadsViewContext();
</script>

<template>
  <article v-if="actionError || actionRunCards.length" class="surface-card">
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
    <div class="runtime-dependency-run-stack">
      <RuntimeDependencyRunCard
        v-for="card in actionRunCards"
        :key="card.run.runId"
        :card="card"
      />
    </div>
  </article>
</template>
