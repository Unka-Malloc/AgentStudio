<script setup lang="ts">
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";
import WordCloudCardList from "./WordCloudCardList.vue";
import WordCloudStageHeader from "./WordCloudStageHeader.vue";

const {
  wordCloudCardRows,
  wordCloudState,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <article class="surface-card word-cloud-stage">
    <WordCloudStageHeader />
    <div
      class="word-cloud-architecture"
      :class="{ 'is-empty': wordCloudState !== null && wordCloudCardRows.length === 0 }"
    >
      <WordCloudCardList />
    </div>
  </article>
</template>
