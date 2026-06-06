<script setup lang="ts">
import { computed } from "vue";
import SafeHtmlBlock from "../SafeHtmlBlock.vue";
import StatusPill from "../StatusPill.vue";
import InfoFeedExpertFeedbackList from "./InfoFeedExpertFeedbackList.vue";
import { infoFeedStatusLabel, infoFeedStatusTone } from "../../composables/console-info-feed-shared-utils";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  chooseInfoFeedClarification,
  copyInfoFeedSummary,
  exportInfoFeedSummary,
  handleAgentAnswerClick,
  infoFeedClarification,
  infoFeedCurrentRun,
  infoFeedExpertFeedbackFor,
  infoFeedReadyForSummary,
  infoFeedStreamingSummaryHtml,
  infoFeedSummaryIsStreaming,
  infoFeedSummaryMarkdown,
  infoFeedSummaryRuntime,
  runInfoFeedSummaryAgent,
} = useFeedViewContext();

const currentRun = computed(() => infoFeedCurrentRun.value);
</script>

<template>
  <section v-if="currentRun && infoFeedReadyForSummary" class="info-feed-summary-filter">
    <div class="info-feed-summary-header">
      <div>
        <h3>知识归纳</h3>
        <span>融合原文检索、智能规划和附件处理结果</span>
      </div>
      <StatusPill
        :tone="infoFeedStatusTone(currentRun.summary.status)"
        :label="`总结${infoFeedStatusLabel(currentRun.summary.status)}`"
      />
    </div>
    <div class="info-feed-summary-main">
      <div class="info-feed-summary-meta" aria-label="总结运行参数">
        <span><strong>总结智能体</strong>{{ infoFeedSummaryRuntime.model }}</span>
        <span><strong>temperature</strong>{{ infoFeedSummaryRuntime.temperature }}</span>
        <span><strong>max_tokens</strong>{{ infoFeedSummaryRuntime.maxTokens }}</span>
      </div>
      <button
        class="tool-button compact-action"
        type="button"
        :disabled="currentRun.summary.status === 'running'"
        @click="runInfoFeedSummaryAgent()"
      >
        重新总结
      </button>
    </div>
    <InfoFeedExpertFeedbackList :feedback-items="infoFeedExpertFeedbackFor('summary')" />
  </section>

  <article
    v-if="currentRun && (currentRun.summary.answer || currentRun.summary.status === 'running')"
    class="info-feed-final-card"
  >
    <div class="compact-section-header">
      <h3>输出报告</h3>
      <div class="agent-result-actions">
        <span v-if="currentRun.summary.fallback">兜底摘要</span>
        <button
          class="tool-button tool-button-ghost compact-action"
          type="button"
          :disabled="!infoFeedSummaryMarkdown"
          @click="copyInfoFeedSummary"
        >
          <svg class="button-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          复制
        </button>
        <button
          class="tool-button compact-action"
          type="button"
          :disabled="!infoFeedSummaryMarkdown"
          @click="exportInfoFeedSummary"
        >
          导出 Markdown
        </button>
      </div>
    </div>
    <div v-if="currentRun.summary.status === 'running'" class="info-feed-summary-running">
      <span>总结智能体正在融合两路结果。</span>
      <div class="info-feed-progress-track">
        <span :style="{ width: `${currentRun.summary.progress}%` }"></span>
      </div>
    </div>
    <SafeHtmlBlock
      v-else
      class="evidence-rendered-content info-feed-summary-content"
      :data-streaming="infoFeedSummaryIsStreaming"
      :html="infoFeedStreamingSummaryHtml"
      source="markdownToSafeHtml"
      @click="handleAgentAnswerClick"
    />
    <p v-if="currentRun.summary.error" class="module-note danger-note">
      {{ currentRun.summary.error }}
    </p>
    <InfoFeedExpertFeedbackList :feedback-items="infoFeedExpertFeedbackFor('report')" />
  </article>

  <section
    v-if="infoFeedClarification?.options.length"
    class="info-feed-clarification-card info-feed-clarification-inline"
  >
    <div class="info-feed-summary-header">
      <div>
        <h3>需要确认</h3>
        <span>{{ infoFeedClarification.reason || "选择一个方向继续。" }}</span>
      </div>
      <StatusPill
        :tone="infoFeedClarification.status === 'answered' ? 'success' : 'warning'"
        :label="infoFeedClarification.status === 'answered' ? '已选择' : '待选择'"
      />
    </div>
    <p>{{ infoFeedClarification.prompt }}</p>
    <div class="info-feed-clarification-options">
      <button
        v-for="option in infoFeedClarification.options"
        :key="option.optionId"
        class="info-feed-clarification-option"
        type="button"
        :data-selected="infoFeedClarification.selectedOptionId === option.optionId"
        :disabled="currentRun?.summary.status === 'running'"
        @click="chooseInfoFeedClarification(option)"
      >
        <strong>{{ option.label }}</strong>
        <span>{{ option.description || option.followUpQuestion }}</span>
      </button>
    </div>
  </section>
</template>
