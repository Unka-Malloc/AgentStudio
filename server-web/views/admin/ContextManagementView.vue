<script setup lang="ts">
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatCompactDate, jsonPreview } from '../../composables/console-format-utils';
import ConfigFoldCard from '../../components/ConfigFoldCard.vue';

const {
  busyKey,
  contextBuildRecordRows,
  contextEvaluationResult,
  contextPreviewRequiredEvidence,
  contextPreviewResult,
  contextPreviewTask,
  contextProfileRows,
  exportContextBuildRecords,
  highlightedConfigTarget,
  previewContextCompiler,
  runContextReplayEvaluation,
} = useServerConsoleShellContext();
</script>

<template>
          <section class="agent-config-layout">
            <article class="surface-card">
              <div class="drawer-panel">
                <div class="section-header">
                  <div>
                    <h3>上下文编译器</h3>
                  </div>
                  <div class="section-actions">
                    <button
                      class="tool-button compact-action"
                      type="button"
                      :disabled="!contextBuildRecordRows.length"
                      @click="exportContextBuildRecords"
                    >
                      导出记录
                    </button>
                  </div>
                </div>

                <div class="context-profile-grid">
                  <article
                    v-for="profile in contextProfileRows"
                    :key="profile.profileId"
                    class="context-profile-card"
                  >
                    <div>
                      <strong>{{ profile.label || profile.profileId }}</strong>
                      <span>{{ profile.profileId }} · {{ profile.compressionMode }} · {{ profile.strategy }}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>窗口</dt>
                        <dd>{{ profile.contextWindowTokens.toLocaleString() }}</dd>
                      </div>
                      <div>
                        <dt>知识</dt>
                        <dd>{{ profile.knowledgeBudget.toLocaleString() }}</dd>
                      </div>
                      <div>
                        <dt>历史</dt>
                        <dd>{{ profile.historyBudget.toLocaleString() }}</dd>
                      </div>
                      <div>
                        <dt>专家权重</dt>
                        <dd>{{ Math.round(profile.expertGuidanceRatio * 100) }}%</dd>
                      </div>
                    </dl>
                    <small>
                      保护字段：{{ profile.protectedEvidenceFields.slice(0, 6).join(", ") || "默认" }}
                    </small>
                    <small>
                      模型压缩：{{ profile.modelCompressionEnabled ? (profile.modelCompressionAlias || "已启用") : "关闭" }}
                    </small>
                  </article>
                  <div v-if="!contextProfileRows.length" class="empty-note">
                    尚未加载上下文 profile。
                  </div>
                </div>

                <div class="form-grid compact-form-grid">
                  <label class="full-row">
                    <span>预览任务</span>
                    <textarea v-model="contextPreviewTask" rows="3" spellcheck="false"></textarea>
                  </label>
                  <label>
                    <span>必须保留的 evidenceId</span>
                    <input v-model="contextPreviewRequiredEvidence" placeholder="ev_1, evidence::abc" autocomplete="off" />
                  </label>
                </div>
                <div class="source-actions">
                  <button
                    class="tool-button"
                    type="button"
                    :disabled="busyKey === 'context:preview'"
                    @click="previewContextCompiler"
                  >
                    {{ busyKey === "context:preview" ? "预览中" : "预览 ContextPack" }}
                  </button>
                  <button
                    class="tool-button tool-button-ghost"
                    type="button"
                    :disabled="busyKey === 'context:evaluation'"
                    @click="runContextReplayEvaluation"
                  >
                    {{ busyKey === "context:evaluation" ? "评估中" : "运行 Replay 评估" }}
                  </button>
                </div>

                <ConfigFoldCard v-if="contextPreviewResult" title="本轮上下文包" open>
                  <pre>{{ jsonPreview(contextPreviewResult) }}</pre>
                </ConfigFoldCard>
                <ConfigFoldCard v-if="contextEvaluationResult" title="Replay 评估结果" open>
                  <pre>{{ jsonPreview(contextEvaluationResult) }}</pre>
                </ConfigFoldCard>

                <ConfigFoldCard
                  title="最近上下文编译记录"
                  data-config-target="knowledge-review-fusion-agent"
                  :data-config-highlighted="highlightedConfigTarget === 'knowledge-review-fusion-agent'"
                  open
                >
                  <div class="context-build-record-list">
                    <article
                      v-for="record in contextBuildRecordRows"
                      :key="record.recordId"
                      class="context-build-record"
                    >
                      <div>
                        <strong>{{ record.profileId }}</strong>
                        <span>{{ formatCompactDate(record.createdAt) }} · {{ record.compressionMode }} · {{ record.triggerReason }}</span>
                      </div>
                      <small>
                        token {{ record.totalTokens.toLocaleString() }} / source {{ record.sourceTokens.toLocaleString() }}
                        · 保留证据 {{ record.preservedEvidenceIds.length }}
                        · 丢弃 {{ record.droppedKnowledgeCount }}
                        · 专家意见 {{ record.humanExpertGuidanceCount }}
                      </small>
                      <code>{{ record.recordId }}</code>
                    </article>
                    <div v-if="!contextBuildRecordRows.length" class="empty-note">
                      暂无上下文编译记录。
                    </div>
                  </div>
                </ConfigFoldCard>
              </div>
            </article>
          </section>
</template>
