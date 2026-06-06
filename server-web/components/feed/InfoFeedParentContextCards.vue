<script setup lang="ts">
import { computed } from "vue";
import SafeHtmlBlock from "../SafeHtmlBlock.vue";
import StatusPill from "../StatusPill.vue";
import InfoFeedExpertFeedbackList from "./InfoFeedExpertFeedbackList.vue";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  handleAgentAnswerClick,
  infoFeedExpertFeedbackForRun,
  infoFeedParentRunForCurrent,
  infoFeedParentSummaryHtml,
} = useFeedViewContext();

const parentRun = computed(() => infoFeedParentRunForCurrent.value);
</script>

<template>
  <section
    v-if="parentRun && infoFeedExpertFeedbackForRun(parentRun, 'summary').length"
    class="info-feed-summary-filter info-feed-parent-context-card"
  >
    <div class="info-feed-summary-header">
      <div>
        <h3>知识归纳</h3>
        <span>上一轮专家确认</span>
      </div>
      <StatusPill tone="success" label="已选择" />
    </div>
    <InfoFeedExpertFeedbackList
      :feedback-items="infoFeedExpertFeedbackForRun(parentRun, 'summary')"
    />
  </section>

  <article
    v-if="parentRun?.summary.answer"
    class="info-feed-final-card info-feed-parent-context-card"
  >
    <div class="compact-section-header">
      <h3>输出报告</h3>
      <div class="agent-result-actions">
        <span>上一轮</span>
      </div>
    </div>
    <SafeHtmlBlock
      class="evidence-rendered-content info-feed-summary-content"
      :html="infoFeedParentSummaryHtml"
      source="markdownToSafeHtml"
      @click="handleAgentAnswerClick"
    />
    <InfoFeedExpertFeedbackList
      v-if="parentRun"
      :feedback-items="infoFeedExpertFeedbackForRun(parentRun, 'report')"
    />
  </article>
</template>
