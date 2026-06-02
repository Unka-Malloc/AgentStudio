<script setup lang="ts">
import { computed } from "vue";
import InfoFeedResultRow from "../InfoFeedResultRow.vue";
import StatusPill from "../StatusPill.vue";
import { useFeedViewContext } from "../../composables/feedViewContext";
import { agentExploreStepSummary } from "../../composables/console-agent-explore-presentation";
import {
  formatFileSize,
  infoFeedStatusLabel,
  infoFeedStatusTone,
  truncateInfoFeedText,
} from "../../composables/console-info-feed-shared-utils";

const {
  infoFeedAgentAnswer,
  infoFeedAgentSteps,
  infoFeedAllKeywordItems,
  infoFeedContextGateNotice,
  infoFeedCurrentRun,
  infoFeedKeywordItems,
  infoFeedKeywordProgressLabel,
  infoFeedLowRelevanceKeywordItems,
  openAgentEvidencePreview,
  selectedInfoFeedModel,
} = useFeedViewContext();

const currentRun = computed(() => infoFeedCurrentRun.value);
</script>

<template>
  <div
    v-if="currentRun"
    class="info-feed-track-grid"
    :data-has-attachments="currentRun.attachments.length > 0"
  >
    <article
      v-if="currentRun.attachments.length > 0"
      class="info-feed-track-card"
    >
      <div class="info-feed-track-header">
        <div>
          <h3>附件处理</h3>
          <span>{{ currentRun.attachments.length }} 个附件</span>
        </div>
        <StatusPill tone="info" label="页面读取" />
      </div>
      <div class="info-feed-track-body">
        <div
          v-for="attachment in currentRun.attachments"
          :key="attachment.id"
          class="info-feed-attachment-row"
          :data-tone="infoFeedStatusTone(attachment.status)"
        >
          <strong>{{ attachment.name }}</strong>
          <span>{{ formatFileSize(attachment.size) }} · {{ infoFeedStatusLabel(attachment.status) }}</span>
          <small v-if="attachment.error">{{ attachment.error }}</small>
          <small v-else-if="attachment.text">{{ truncateInfoFeedText(attachment.text, 120) }}</small>
          <div class="info-feed-progress-track">
            <span :style="{ width: `${attachment.progress}%` }"></span>
          </div>
        </div>
      </div>
    </article>

    <article class="info-feed-track-card" data-track="source-search">
      <div class="info-feed-track-header">
        <div>
          <h3>原文检索</h3>
          <span v-if="currentRun.keyword.status === 'completed'">
            高关联 {{ infoFeedKeywordItems.length }} · 低关联 {{ infoFeedLowRelevanceKeywordItems.length }}{{ currentRun.keyword.fromCache ? " · 缓存" : "" }}
          </span>
          <span v-else>直接扫描服务端原始文件{{ currentRun.keyword.fromCache ? " · 缓存" : "" }}</span>
        </div>
        <StatusPill
          :tone="infoFeedStatusTone(currentRun.keyword.status)"
          :label="infoFeedStatusLabel(currentRun.keyword.status)"
        />
      </div>
      <div
        class="info-feed-progress-track"
        :data-indeterminate="currentRun.keyword.status === 'running'"
      >
        <span :style="{ width: `${currentRun.keyword.progress}%` }"></span>
      </div>
      <div class="info-feed-track-body">
        <div v-if="currentRun.keyword.status === 'running'" class="empty-note">
          {{ infoFeedKeywordProgressLabel }}
        </div>
        <div v-else-if="currentRun.keyword.error" class="empty-note">
          {{ currentRun.keyword.error }}
        </div>
        <div
          v-else-if="currentRun.keyword.status === 'completed' && infoFeedKeywordProgressLabel"
          class="empty-note"
        >
          {{ infoFeedKeywordProgressLabel }}
        </div>
        <div
          v-if="currentRun.keyword.status === 'completed' && infoFeedContextGateNotice.message"
          class="info-feed-context-gate-card"
        >
          <strong>上下文门禁</strong>
          <span>{{ infoFeedContextGateNotice.message }}</span>
          <small>
            高关联 {{ infoFeedContextGateNotice.includedHigh }}/{{ infoFeedContextGateNotice.highCount }}
            · 低关联 {{ infoFeedContextGateNotice.includedLow }}/{{ infoFeedContextGateNotice.lowCount }}
            · 剩余约 {{ Number(infoFeedContextGateNotice.remainingTokens || 0).toLocaleString() }} tokens
          </small>
        </div>
        <InfoFeedResultRow
          v-for="item in infoFeedKeywordItems"
          :key="item.evidenceId || item.itemId || item.documentId || item.title"
          :item="item"
          @open="openAgentEvidencePreview"
        />
        <div
          v-if="currentRun.keyword.status === 'completed' && infoFeedKeywordItems.length === 0 && infoFeedLowRelevanceKeywordItems.length"
          class="empty-note"
        >
          未找到可读正文同时命中的高关联邮件；已展开低关联原始命中。
        </div>
        <details
          v-if="currentRun.keyword.status === 'completed' && infoFeedLowRelevanceKeywordItems.length"
          class="info-feed-low-relevance-panel"
          :open="infoFeedKeywordItems.length === 0"
        >
          <summary>
            低关联邮件 {{ infoFeedLowRelevanceKeywordItems.length }} 封
            <small>原始 EML 命中，但主要命中在 URL、HTML 参数、编码块或不可读区域</small>
          </summary>
          <InfoFeedResultRow
            v-for="item in infoFeedLowRelevanceKeywordItems"
            :key="item.evidenceId || item.itemId || item.documentId || item.title"
            :item="item"
            tier="low"
            @open="openAgentEvidencePreview"
          />
        </details>
        <div
          v-if="currentRun.keyword.status === 'completed' && infoFeedAllKeywordItems.length === 0"
          class="empty-note"
        >
          没有找到原文检索结果。
        </div>
      </div>
    </article>

    <article class="info-feed-track-card" data-track="agent-plan">
      <div class="info-feed-track-header">
        <div>
          <h3>智能规划</h3>
          <span>{{ selectedInfoFeedModel.label }}</span>
        </div>
        <StatusPill
          :tone="infoFeedStatusTone(currentRun.agent.status)"
          :label="infoFeedStatusLabel(currentRun.agent.status)"
        />
      </div>
      <div class="info-feed-progress-track">
        <span :style="{ width: `${currentRun.agent.progress}%` }"></span>
      </div>
      <div class="info-feed-track-body">
        <div v-if="currentRun.agent.status === 'running'" class="empty-note">
          正在规划工具调用和检索证据。
        </div>
        <div v-if="infoFeedAgentSteps.length" class="info-feed-step-list">
          <div
            v-for="step in infoFeedAgentSteps"
            :key="`info-feed-step-${step.iteration}`"
            class="info-feed-step-row"
          >
            <strong>第 {{ step.iteration }} 轮</strong>
            <span>{{ agentExploreStepSummary(step) }}</span>
          </div>
        </div>
        <div v-if="currentRun.agent.error" class="empty-note">
          {{ currentRun.agent.error }}
        </div>
        <div v-if="infoFeedAgentAnswer" class="info-feed-agent-answer">
          {{ truncateInfoFeedText(infoFeedAgentAnswer, 520) }}
        </div>
      </div>
    </article>
  </div>
</template>
