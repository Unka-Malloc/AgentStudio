<script setup lang="ts">
import ConfigFoldCard from "../ConfigFoldCard.vue";
import SafeHtmlBlock from "../SafeHtmlBlock.vue";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  agentEvidencePreviewOpen,
  busyKey,
  closeAgentEvidencePreview,
  evidenceLoadError,
  evidenceReadableHtml,
  evidenceReadableKind,
  evidenceSourceDetails,
  openAgentEvidencePreview,
  selectedEvidence,
  selectedEvidenceDisplayTitle,
  selectedEvidenceId,
} = useServerConsoleShellContext();
</script>

<template>
  <div
    v-if="agentEvidencePreviewOpen"
    class="agent-evidence-preview-backdrop"
    @click.self="closeAgentEvidencePreview"
  >
    <section class="agent-evidence-preview-dialog" role="dialog" aria-modal="true" aria-label="证据预览">
      <div class="agent-evidence-preview-header">
        <div>
          <h3>{{ selectedEvidenceDisplayTitle }}</h3>
          <span v-if="selectedEvidenceId">{{ selectedEvidenceId }}</span>
        </div>
        <button
          class="dialog-close-button"
          type="button"
          aria-label="关闭"
          title="关闭"
          @click="closeAgentEvidencePreview"
        >
          ×
        </button>
      </div>

      <template v-if="selectedEvidence">
        <section class="evidence-text agent-evidence-preview-body">
          <div class="evidence-text-heading">
            <h4>原始文件</h4>
            <span>{{ evidenceReadableKind }}</span>
          </div>
          <SafeHtmlBlock
            class="evidence-rendered-content"
            :html="evidenceReadableHtml"
            source="renderEvidenceReadableHtml"
          />
        </section>
        <ConfigFoldCard class="evidence-source-details" title="来源定位">
          <dl class="meta-list evidence-summary-list">
            <div
              v-for="item in evidenceSourceDetails()"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </ConfigFoldCard>
      </template>
      <div v-else-if="evidenceLoadError" class="knowledge-preview-empty evidence-preview-error">
        <strong>证据无法打开</strong>
        <span>{{ evidenceLoadError }}</span>
        <button
          class="tool-button tool-button-ghost compact-action"
          type="button"
          :disabled="!selectedEvidenceId || busyKey.startsWith('knowledge:evidence:')"
          @click="selectedEvidenceId ? openAgentEvidencePreview(selectedEvidenceId) : undefined"
        >
          重试
        </button>
      </div>
      <div v-else class="knowledge-preview-empty">
        <strong>{{ busyKey.startsWith("knowledge:evidence:") ? "正在加载证据" : "没有证据内容" }}</strong>
        <span>{{ busyKey.startsWith("knowledge:evidence:") ? "正在打开来源。" : "暂未选择来源。" }}</span>
      </div>
    </section>
  </div>
</template>
