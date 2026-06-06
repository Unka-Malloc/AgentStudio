<script setup lang="ts">
import BinaryCheckbox from "../BinaryCheckbox.vue";
import ConfigFoldCard from "../ConfigFoldCard.vue";
import InfoFeedResultRow from "../InfoFeedResultRow.vue";
import OptionBar from "../OptionBar.vue";
import { jsonPreview } from "../../composables/console-format-utils";
import { knowledgeFusionSummary } from "../../composables/console-knowledge-search-utils";
import { useDebugViewContext } from "../../composables/debugViewContext";

const {
  busyKey,
  knowledgeConsole,
  knowledgeRecallDebugForm,
  knowledgeRecallDebugGridStyle,
  knowledgeRecallDebugModeOptionBarOptions,
  knowledgeRecallDebugRuns,
  knowledgeRecallDebugTargetOptions,
  knowledgeSourceState,
  knowledgeStatus,
  openAgentEvidencePreview,
  runKnowledgeRecallDebugBatch,
} = useDebugViewContext();
</script>

<template>
  <article class="surface-card debug-panel-card knowledge-recall-debug-card">
    <div class="section-header">
      <div>
        <h3>知识召回</h3>
        <p>只调试底层知识召回，不调用大模型。适合检查融合策略、学习开关和证据可读性。</p>
      </div>
      <div class="section-tags">
        <span>{{ knowledgeConsole?.available ? "KnowledgeCore 可用" : "KnowledgeCore 未启用" }}</span>
        <span>{{ knowledgeStatus }}</span>
        <span>目录 {{ knowledgeSourceState?.summary.totalCount || 0 }}</span>
      </div>
    </div>

    <form class="debug-parameter-panel" @submit.prevent="runKnowledgeRecallDebugBatch">
      <label class="full-row">
        <span>召回问题</span>
        <input
          v-model="knowledgeRecallDebugForm.query"
          type="search"
          placeholder="例如：HSBC 账单"
        />
      </label>
      <OptionBar
        v-model="knowledgeRecallDebugForm.targetId"
        label="知识库"
        :options="knowledgeRecallDebugTargetOptions"
      />
      <OptionBar
        v-model="knowledgeRecallDebugForm.retrievalMode"
        label="召回模式"
        :options="knowledgeRecallDebugModeOptionBarOptions"
      />
      <BinaryCheckbox
        v-model="knowledgeRecallDebugForm.keywordOnly"
        label="仅关键词"
      />
      <BinaryCheckbox
        v-model="knowledgeRecallDebugForm.learningEnabled"
        label="启用学习"
      />
      <BinaryCheckbox
        v-model="knowledgeRecallDebugForm.explain"
        label="返回解释"
      />
      <button
        class="primary-action"
        type="submit"
        :disabled="busyKey === 'debug:knowledge-recall' || !knowledgeRecallDebugForm.query.trim()"
      >
        {{ busyKey === "debug:knowledge-recall" ? "召回中" : "执行召回" }}
      </button>
    </form>

    <div
      v-if="knowledgeRecallDebugRuns.length"
      class="debug-compare-grid"
      :style="knowledgeRecallDebugGridStyle"
    >
      <section
        v-for="run in knowledgeRecallDebugRuns"
        :key="run.runId"
        class="debug-compare-column"
        :data-status="run.status"
      >
        <header class="debug-compare-header">
          <div>
            <h4>{{ run.label }}</h4>
            <span>{{ run.status }} · {{ run.elapsedMs }} ms · {{ run.items.length }} 条</span>
            <small v-if="knowledgeFusionSummary(run.response)">{{ knowledgeFusionSummary(run.response) }}</small>
          </div>
        </header>
        <div class="info-feed-results-list debug-result-list">
          <InfoFeedResultRow
            v-for="item in run.items"
            :key="String(item.evidenceId || item.itemId || item.documentId || item.title)"
            :item="item"
            tier="debug"
            @open="openAgentEvidencePreview"
          />
          <div v-if="run.status === 'running'" class="empty-note">正在召回。</div>
          <div v-else-if="run.status === 'failed'" class="empty-note">{{ run.error }}</div>
          <div v-else-if="run.status === 'completed' && run.items.length === 0" class="empty-note">没有召回结果。</div>
        </div>
        <ConfigFoldCard v-if="run.response" title="原始响应">
          <pre>{{ jsonPreview(run.response || {}) }}</pre>
        </ConfigFoldCard>
      </section>
    </div>
  </article>
</template>
