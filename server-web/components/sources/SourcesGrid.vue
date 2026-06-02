<script setup lang="ts">
import SourceCard from "./SourceCard.vue";
import { useSourcesViewContext } from "../../composables/sourcesViewContext";

const { activeKnowledgeSources } = useSourcesViewContext();
</script>

<template>
  <div class="sources-cards-container">
    <section :class="['sources-layout', { 'is-empty': activeKnowledgeSources.length === 0 }]">
      <SourceCard
        v-for="source in activeKnowledgeSources"
        :key="source.sourceId"
        :source="source"
      />

      <article v-if="activeKnowledgeSources.length === 0" class="surface-card source-card source-empty-card">
        <svg class="source-empty-card-icon" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <strong>暂无本地数据源</strong>
        <p>点击右上角「添加数据源」后，按类型填写对应配置。</p>
      </article>
    </section>
  </div>
</template>
