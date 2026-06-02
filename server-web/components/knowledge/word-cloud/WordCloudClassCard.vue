<script setup lang="ts">
import type { WordCloudCardRow } from "../../../composables/console-word-cloud-utils";
import { useKnowledgeWordCloudContext } from "../../../composables/knowledgeViewContext";
import WordCloudCardBody from "./WordCloudCardBody.vue";

defineProps<{
  index: number;
  row: WordCloudCardRow;
}>();

const {
  addChildWordCloud,
  addTermActionToCloud,
  autoFillCloudWithAgent,
  collapsedWordBagIds,
  fillingWordBagIds,
  jumpToCloud,
  pinWordCloud,
  pinnedWordBagIds,
  selectWordCloud,
  selectedWordCloud,
  selectedWordCloudModel,
  titleFocusedWordBagId,
  toggleWordCloudActionMenu,
  toggleWordCloudCollapsed,
  updateWordCloudField,
  wordBagActionMenuId,
  wordCloudCardStyle,
} = useKnowledgeWordCloudContext();
</script>

<template>
  <article
    class="word-cloud-class-card"
    :class="{ active: selectedWordCloud?.wordBagId === row.cloud.wordBagId }"
    :style="wordCloudCardStyle(row, index)"
    :data-word-bag-id="row.cloud.wordBagId"
    role="listitem"
    @click="selectWordCloud(row.cloud); toggleWordCloudCollapsed(row.cloud.wordBagId)"
  >
    <header class="word-cloud-card-header">
      <div class="word-cloud-title-wrap">
        <input
          class="word-cloud-card-title-input"
          :class="{ 'has-confirm': titleFocusedWordBagId === row.cloud.wordBagId && selectedWordCloudModel.enabled && !fillingWordBagIds.has(row.cloud.wordBagId) }"
          :value="row.cloud.label"
          type="text"
          autocomplete="off"
          placeholder="未命名词袋"
          @click.stop
          @focus="titleFocusedWordBagId = row.cloud.wordBagId"
          @blur="titleFocusedWordBagId = null"
          @input="updateWordCloudField(row.cloud.wordBagId, 'label', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="fillingWordBagIds.has(row.cloud.wordBagId)" class="word-cloud-title-filling" title="智能体正在填充词云…">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="word-cloud-title-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </span>
        <button
          v-else-if="titleFocusedWordBagId === row.cloud.wordBagId && selectedWordCloudModel.enabled"
          class="word-cloud-title-confirm-btn"
          type="button"
          title="调用智能体填充相关词汇"
          aria-label="填充词汇"
          @mousedown.prevent
          @click.stop="autoFillCloudWithAgent(row.cloud.wordBagId)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2a10 10 0 0 1 7.38 16.8"/>
            <polyline points="16 12 12 8 8 12"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
          </svg>
        </button>
      </div>
      <div class="word-cloud-card-corner-actions" @click.stop>
        <button
          class="word-cloud-corner-btn"
          type="button"
          :class="{ active: pinnedWordBagIds.has(row.cloud.wordBagId) }"
          :title="pinnedWordBagIds.has(row.cloud.wordBagId) ? '取消置顶' : '置顶此词云'"
          :aria-label="pinnedWordBagIds.has(row.cloud.wordBagId) ? '取消置顶' : '置顶'"
          @click="pinWordCloud(row.cloud.wordBagId)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="17" x2="12" y2="22"/>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
          </svg>
        </button>
        <div class="word-cloud-header-add-wrap">
          <button
            class="word-cloud-corner-btn word-cloud-corner-add-btn"
            type="button"
            title="新增"
            aria-label="新增"
            @click.stop="toggleWordCloudActionMenu(row.cloud.wordBagId)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <div
            v-if="wordBagActionMenuId === row.cloud.wordBagId"
            class="word-cloud-action-popover"
            @click.stop
          >
            <button type="button" @click="addChildWordCloud(row.cloud.wordBagId)">新增分组</button>
            <button type="button" @click="addTermActionToCloud(row.cloud.wordBagId)">新增词语</button>
          </div>
        </div>
        <button
          class="word-cloud-corner-btn"
          type="button"
          :aria-label="collapsedWordBagIds.has(row.cloud.wordBagId) ? '展开词云' : '收起词云'"
          :title="collapsedWordBagIds.has(row.cloud.wordBagId) ? '展开' : '收起'"
          @click="toggleWordCloudCollapsed(row.cloud.wordBagId)"
        >
          <svg v-if="collapsedWordBagIds.has(row.cloud.wordBagId)" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
      </div>
    </header>
    <div class="word-cloud-card-tag-bar" @click.stop>
      <span class="word-cloud-meta-badge">{{ row.cloud.terms.length }} 词汇</span>
      <template v-if="row.cloud.children?.length">
        <span class="word-cloud-meta-sep">·</span>
        <span class="word-cloud-meta-badge">{{ row.cloud.children.length }} 分组</span>
        <button
          v-for="child in row.cloud.children"
          :key="child.wordBagId"
          class="word-cloud-child-tag"
          type="button"
          @click.stop="jumpToCloud(child.wordBagId)"
        >{{ child.label || "未命名" }}</button>
      </template>
    </div>
    <WordCloudCardBody
      v-show="!collapsedWordBagIds.has(row.cloud.wordBagId)"
      :row="row"
    />
  </article>
</template>
