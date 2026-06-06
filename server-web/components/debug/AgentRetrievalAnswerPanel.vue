<script setup lang="ts">
import ConfigFoldCard from "../ConfigFoldCard.vue";
import SafeHtmlBlock from "../SafeHtmlBlock.vue";
import { jsonPreview } from "../../composables/console-format-utils";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";

const {
  agentRetrievalAnswer: {
    agentExploreAnswerHtml,
    agentExploreDocumentMarkdown,
    agentExploreLinkedEvidenceRefs,
    agentExploreResult,
    busyKey,
    copyAgentExploreDocument,
    exportAgentExploreDocument,
    handleAgentAnswerClick,
    openAgentEvidencePreview,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <section class="agent-explore-answer">
    <div class="compact-section-header">
      <h3>检索结果</h3>
      <div class="agent-result-actions">
        <span v-if="agentExploreResult?.degraded">降级</span>
        <button
          class="tool-button tool-button-ghost compact-action"
          type="button"
          :disabled="!agentExploreDocumentMarkdown"
          @click="copyAgentExploreDocument"
        >
          复制文档
        </button>
        <button
          class="tool-button compact-action"
          type="button"
          :disabled="!agentExploreDocumentMarkdown"
          @click="exportAgentExploreDocument"
        >
          导出 Markdown
        </button>
      </div>
    </div>
    <SafeHtmlBlock
      v-if="agentExploreResult?.answer"
      class="evidence-rendered-content"
      :html="agentExploreAnswerHtml"
      source="markdownToSafeHtml"
      @click="handleAgentAnswerClick"
    />
    <div v-else class="knowledge-preview-empty">
      <strong>等待结果</strong>
      <span>模型会调用本地工具检索，再决定是否打开证据。</span>
    </div>
    <ConfigFoldCard v-if="agentExploreLinkedEvidenceRefs.length" title="引用证据">
      <div class="agent-evidence-ref-list">
        <button
          v-for="refId in agentExploreLinkedEvidenceRefs"
          :key="refId"
          class="evidence-ref-button"
          type="button"
          :disabled="busyKey === `knowledge:evidence:${refId}`"
          @click="openAgentEvidencePreview(refId)"
        >
          {{ refId }}
        </button>
      </div>
    </ConfigFoldCard>
    <ConfigFoldCard v-if="agentExploreResult?.contextPack" title="上下文包">
      <pre>{{ jsonPreview(agentExploreResult.contextPack || {}) }}</pre>
    </ConfigFoldCard>
    <ConfigFoldCard v-if="agentExploreResult" title="运行结构">
      <pre>{{ jsonPreview(agentExploreResult || {}) }}</pre>
    </ConfigFoldCard>
  </section>
</template>
