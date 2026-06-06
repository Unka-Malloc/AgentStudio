<script setup lang="ts">
import SafeHtmlBlock from "../SafeHtmlBlock.vue";
import InfoFeedExpertFeedbackList from "./InfoFeedExpertFeedbackList.vue";
import { formatCompactDate } from "../../composables/console-format-utils";
import {
  formatFileSize,
  infoFeedStatusLabel,
  infoFeedStatusTone,
} from "../../composables/console-info-feed-shared-utils";
import { useFeedViewContext } from "../../composables/feedViewContext";
import type { InfoFeedTurnSnapshot } from "../../types/app";

defineProps<{
  turn: InfoFeedTurnSnapshot;
  turnIndex: number;
}>();

const {
  handleAgentAnswerClick,
  infoFeedTurnAttachments,
  infoFeedTurnQuestion,
  infoFeedTurnSummaryHtml,
  infoFeedTurnTitle,
  infoFeedUserCardTitle,
} = useFeedViewContext();
</script>

<template>
  <article class="info-feed-final-card info-feed-user-turn-card">
    <div class="compact-section-header">
      <div>
        <h3>{{ infoFeedUserCardTitle(turn) }}</h3>
        <span>{{ infoFeedTurnTitle(turn, turnIndex) }}</span>
      </div>
      <div class="agent-result-actions">
        <span>{{ formatCompactDate(turn.completedAt) }}</span>
      </div>
    </div>
    <div class="info-feed-user-message">
      <p>{{ infoFeedTurnQuestion(turn) }}</p>
      <div
        v-if="infoFeedTurnAttachments(turn).length"
        class="info-feed-user-attachment-list"
      >
        <span
          v-for="attachment in infoFeedTurnAttachments(turn)"
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

  <article class="info-feed-final-card info-feed-turn-card">
    <div class="compact-section-header">
      <div>
        <h3>输出报告</h3>
        <span>{{ infoFeedTurnTitle(turn, turnIndex) }} · {{ infoFeedTurnQuestion(turn) }}</span>
      </div>
      <div class="agent-result-actions">
        <span v-if="turn.summaryFallback">兜底摘要</span>
        <span>{{ formatCompactDate(turn.completedAt) }}</span>
      </div>
    </div>
    <SafeHtmlBlock
      v-if="turn.summaryAnswer"
      class="evidence-rendered-content info-feed-summary-content"
      :html="infoFeedTurnSummaryHtml(turn)"
      source="markdownToSafeHtml"
      @click="handleAgentAnswerClick"
    />
    <p v-if="turn.summaryError" class="module-note danger-note">
      {{ turn.summaryError }}
    </p>
    <InfoFeedExpertFeedbackList :feedback-items="turn.expertFeedback" />
  </article>
</template>
