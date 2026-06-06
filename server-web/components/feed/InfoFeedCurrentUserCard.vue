<script setup lang="ts">
import { computed } from "vue";
import { formatCompactDate } from "../../composables/console-format-utils";
import {
  formatFileSize,
  infoFeedStatusLabel,
  infoFeedStatusTone,
} from "../../composables/console-info-feed-shared-utils";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  infoFeedCurrentRun,
  infoFeedCurrentUserQuestion,
  infoFeedUserCardTitle,
} = useFeedViewContext();

const currentRun = computed(() => infoFeedCurrentRun.value);
</script>

<template>
  <article v-if="currentRun" class="info-feed-final-card info-feed-user-turn-card">
    <div class="compact-section-header">
      <div>
        <h3>{{ infoFeedUserCardTitle(currentRun) }}</h3>
        <span>{{ currentRun.followUp ? "本轮追问" : "本轮输入" }}</span>
      </div>
      <div class="agent-result-actions">
        <span>{{ formatCompactDate(currentRun.startedAt) }}</span>
      </div>
    </div>
    <div class="info-feed-user-message">
      <p>{{ infoFeedCurrentUserQuestion(currentRun) }}</p>
      <div
        v-if="currentRun.attachments.length"
        class="info-feed-user-attachment-list"
      >
        <span
          v-for="attachment in currentRun.attachments"
          :key="attachment.id"
          class="info-feed-user-attachment"
          :data-tone="infoFeedStatusTone(attachment.status)"
        >
          <strong>{{ attachment.name }}</strong>
          <small>{{ formatFileSize(attachment.size) }} · {{ infoFeedStatusLabel(attachment.status) }}</small>
        </span>
      </div>
    </div>
  </article>
</template>
