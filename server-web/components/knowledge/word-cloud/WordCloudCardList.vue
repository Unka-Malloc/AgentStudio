<script setup lang="ts">
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";
import WordCloudClassCard from "./WordCloudClassCard.vue";

const {
  wordCloudCardRows,
  wordCloudState,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <div class="word-cloud-card-list" role="list" aria-label="词云分类卡片">
    <WordCloudClassCard
      v-for="(row, index) in wordCloudCardRows"
      :key="row.cloud.wordBagId"
      :row="row"
      :index="index"
    />
    <div v-if="wordCloudState === null && wordCloudCardRows.length === 0" class="word-cloud-loading">
      <svg class="word-cloud-loading-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span>正在加载词袋…</span>
    </div>
    <div v-else-if="wordCloudCardRows.length === 0" class="empty-state word-cloud-empty">
      <strong>暂无词袋</strong>
    </div>
  </div>
</template>
