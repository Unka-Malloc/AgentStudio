<script setup lang="ts">
import type { InfoFeedExpertFeedback } from "../../types/app";

defineProps<{
  feedbackItems: InfoFeedExpertFeedback[];
}>();
</script>

<template>
  <div v-if="feedbackItems.length" class="info-feed-expert-feedback-list">
    <article
      v-for="feedbackItem in feedbackItems"
      :key="feedbackItem.feedbackId"
      class="info-feed-expert-feedback"
      :data-sync="feedbackItem.syncStatus"
    >
      <div>
        <strong>人类专家意见</strong>
        <span>{{ feedbackItem.selectedLabel }}</span>
      </div>
      <p>{{ feedbackItem.prompt }}</p>
      <small>{{ feedbackItem.followUpQuestion }}</small>
    </article>
  </div>
</template>
