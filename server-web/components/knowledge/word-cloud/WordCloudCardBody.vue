<script setup lang="ts">
import {
  formatWordCloudThreshold,
  type WordCloudCardRow,
} from "../../../composables/console-word-cloud-utils";
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";

defineProps<{
  row: WordCloudCardRow;
}>();

const {
  addTermInputToCloud,
  clearRemovedTermsFromCloud,
  expandedAdvancedIds,
  expandedSummaryIds,
  removeTermFromCloud,
  setWordCloudTermInput,
  toggleAdvancedExpanded,
  toggleSummaryExpanded,
  updateWordCloudField,
  wordCloudTermInputs,
  wordCloudVisibleTerms,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <div class="word-cloud-card-body" @click.stop>
    <div class="word-cloud-summary-toggle" @click.stop="toggleAdvancedExpanded(row.cloud.wordBagId)">
      <span>高级参数</span>
      <svg
        class="word-cloud-summary-chevron"
        :class="{ expanded: expandedAdvancedIds.has(row.cloud.wordBagId) }"
        xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="word-cloud-summary-body" v-show="expandedAdvancedIds.has(row.cloud.wordBagId)">
      <label class="word-cloud-field word-cloud-threshold-field">
        <span>吸附阈值</span>
        <input
          :value="formatWordCloudThreshold(row.cloud.absorbThreshold)"
          type="number"
          min="0"
          max="1"
          step="0.01"
          inputmode="decimal"
          @input="updateWordCloudField(row.cloud.wordBagId, 'absorbThreshold', ($event.target as HTMLInputElement).value)"
        />
        <small>越高越保守，越低越容易自动吸词。</small>
      </label>
    </div>
    <div class="word-cloud-summary-toggle" @click.stop="toggleSummaryExpanded(row.cloud.wordBagId)">
      <span>分组说明</span>
      <svg
        class="word-cloud-summary-chevron"
        :class="{ expanded: expandedSummaryIds.has(row.cloud.wordBagId) }"
        xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="word-cloud-summary-body" v-show="expandedSummaryIds.has(row.cloud.wordBagId)">
      <textarea
        class="word-cloud-card-summary"
        :value="row.cloud.summary || ''"
        rows="3"
        placeholder="用一句话描述这个分组的用途，让智能体更准确地使用它。"
        @click.stop
        @input="updateWordCloudField(row.cloud.wordBagId, 'summary', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
    <div class="word-cloud-term-list">
      <div
        v-for="term in wordCloudVisibleTerms(row.cloud)"
        :key="`${row.cloud.wordBagId}:${term.removed ? 'removed' : 'active'}:${term.term}`"
        class="word-cloud-term-row"
        :class="{ removed: term.removed }"
      >
        <div class="word-cloud-term-label">
          <span>{{ term.term }}</span>
          <small>{{ term.frequency || 0 }}</small>
        </div>
        <button
          v-if="!term.removed"
          class="word-cloud-term-remove"
          type="button"
          title="移除"
          @click.stop="removeTermFromCloud(row.cloud.wordBagId, term)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
    <div class="word-cloud-inline-add">
      <div class="word-cloud-inline-field">再加一个词</div>
      <input
        placeholder="直接输入词"
        :value="wordCloudTermInputs[row.cloud.wordBagId] || ''"
        type="text"
        autocomplete="off"
        @input="setWordCloudTermInput(row.cloud.wordBagId, ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="addTermInputToCloud(row.cloud.wordBagId)"
      />
      <button class="tool-button compact-action" type="button" @click.stop="addTermInputToCloud(row.cloud.wordBagId)">
        加入词袋
      </button>
      <button
        v-if="row.cloud.removedTerms?.length"
        class="tool-button tool-button-ghost compact-action"
        type="button"
        @click.stop="clearRemovedTermsFromCloud(row.cloud.wordBagId)"
      >
        清理已移除
      </button>
    </div>
  </div>
</template>
