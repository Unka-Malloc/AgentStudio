<script setup lang="ts">
import RuntimeDependencyListCard from "./RuntimeDependencyListCard.vue";
import RuntimeDependencyResultCard from "./RuntimeDependencyResultCard.vue";
import RuntimeDownloadsSummaryCard from "./RuntimeDownloadsSummaryCard.vue";
</script>

<template>
  <section class="runtime-download-layout">
    <RuntimeDownloadsSummaryCard />
    <RuntimeDependencyListCard />
    <RuntimeDependencyResultCard />
  </section>
</template>

<style scoped>
.runtime-download-layout {
  display: grid;
  gap: 16px;
}
</style>
