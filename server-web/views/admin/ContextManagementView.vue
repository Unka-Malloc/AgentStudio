<script setup lang="ts">
import { computed, ref } from 'vue';
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatCompactDate, jsonPreview } from '../../composables/console-format-utils';
import { confirmConsoleAction, notifyConsoleAction } from '../../composables/console-browser-effects';
import ConfigFoldCard from '../../components/ConfigFoldCard.vue';
import { saveContextProfiles } from '../../lib/context-compiler-client';

const {
  busyKey,
  contextBuildRecordRows,
  contextEvaluationResult,
  contextPreviewRequiredEvidence,
  contextPreviewResult,
  contextPreviewTask,
  contextProfileRows,
  contextProfilesResponse,
  exportContextBuildRecords,
  highlightedConfigTarget,
  previewContextCompiler,
  refreshContextCompiler,
  runContextReplayEvaluation,
} = useServerConsoleShellContext();

type ContextProfileRow = (typeof contextProfileRows.value)[number];
type ContextPresetForm = {
  profileId: string;
  label: string;
  contextWindowTokens: number;
  knowledgeBudget: number;
  historyBudget: number;
  recentTurnBudget: number;
  expertGuidanceRatio: number;
};

const showPresetModal = ref(false);
const savingPreset = ref(false);
const editingProfileId = ref("");
const presetFormError = ref("");
const presetForm = ref(createPresetForm());
const presetModalTitle = computed(() => editingProfileId.value ? "编辑上下文配置" : "新增上下文配置");

function createPresetForm(profile: Partial<ContextPresetForm> = {}): ContextPresetForm {
  return {
    profileId: profile.profileId || '',
    label: profile.label || '',
    contextWindowTokens: Number(profile.contextWindowTokens || 64000),
    knowledgeBudget: Number(profile.knowledgeBudget || 18000),
    historyBudget: Number(profile.historyBudget || 16000),
    recentTurnBudget: Number(profile.recentTurnBudget || 12000),
    expertGuidanceRatio: Number(profile.expertGuidanceRatio ?? 0.08),
  };
}

function profileRecords() {
  const profiles = contextProfilesResponse.value?.profiles;
  return Array.isArray(profiles)
    ? profiles
      .filter((profile): profile is Record<string, unknown> => !!profile && typeof profile === "object")
      .filter((profile) => !isDeprecatedProfile(profile))
    : [];
}

function isDeprecatedProfile(profile: Record<string, unknown>) {
  const profileId = String(profile.profileId || profile.id || "").trim();
  const label = String(profile.label || "").trim();
  return (
    ["balanced", "small-context", "deepseek-v3-671b"].includes(profileId) ||
    ["Balanced Context", "Small Context", "DeepSeek V3 671B"].includes(label)
  );
}

function sortProfiles(profiles: Record<string, unknown>[]) {
  return [...profiles].sort((left, right) => {
    const tokenCompare = Number(left.contextWindowTokens || 0) - Number(right.contextWindowTokens || 0);
    if (tokenCompare !== 0) return tokenCompare;
    return String(left.profileId || "").localeCompare(String(right.profileId || ""));
  });
}

function rawProfileFor(profileId: string) {
  return profileRecords().find((profile) => String(profile.profileId || profile.id || "") === profileId) || {};
}

function openAddPresetModal() {
  editingProfileId.value = "";
  presetFormError.value = "";
  presetForm.value = createPresetForm({
    profileId: "",
    label: "",
    contextWindowTokens: 128000,
    knowledgeBudget: 36000,
    historyBudget: 42000,
    recentTurnBudget: 24000,
  });
  showPresetModal.value = true;
}

function openEditPresetModal(profile: ContextProfileRow) {
  editingProfileId.value = profile.profileId;
  presetFormError.value = "";
  presetForm.value = createPresetForm(profile);
  showPresetModal.value = true;
}

function closePresetModal() {
  if (savingPreset.value) return;
  showPresetModal.value = false;
  presetFormError.value = "";
}

function boundedNumber(value: unknown, fallback: number, min = 0) {
  const next = Number(value);
  return Math.max(min, Number.isFinite(next) ? next : fallback);
}

function boundedRatio(value: unknown, fallback = 0.08) {
  const next = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(next) ? next : fallback));
}

function buildProfileFromForm(original: Record<string, unknown> = {}) {
  const form = presetForm.value;
  const profileId = form.profileId.trim();
  const contextWindowTokens = boundedNumber(form.contextWindowTokens, 128000, 4096);
  const compression = original.compression && typeof original.compression === "object"
    ? original.compression as Record<string, unknown>
    : {};
  const budgetPolicy = original.budgetPolicy && typeof original.budgetPolicy === "object"
    ? original.budgetPolicy as Record<string, unknown>
    : {};

  return {
    ...original,
    profileId,
    label: form.label.trim() || profileId,
    modelAlias: String(original.modelAlias || "default").trim() || "default",
    contextWindowTokens,
    outputReserveTokens: boundedNumber(original.outputReserveTokens, Math.round(contextWindowTokens * 0.06), 256),
    toolReserveTokens: boundedNumber(original.toolReserveTokens, Math.round(contextWindowTokens * 0.08), 0),
    fixedMemoryBudget: boundedNumber(original.fixedMemoryBudget, Math.round(contextWindowTokens * 0.02), 0),
    knowledgeBudget: boundedNumber(form.knowledgeBudget, 0),
    historyBudget: boundedNumber(form.historyBudget, 0),
    recentTurnBudget: boundedNumber(form.recentTurnBudget, 0),
    budgetPolicy: {
      ...budgetPolicy,
      expertGuidanceRatio: boundedRatio(form.expertGuidanceRatio),
    },
    compression: {
      enabled: true,
      threshold: 0.6,
      targetRatio: 0.3,
      protectLastNTurns: 8,
      summaryMaxTokens: 8000,
      strategy: "deterministic-extractive",
      ...compression,
    },
  };
}

async function persistProfiles(nextProfiles: Record<string, unknown>[]) {
  savingPreset.value = true;
  presetFormError.value = "";
  try {
    const response = await saveContextProfiles({ profiles: sortProfiles(nextProfiles) });
    contextProfilesResponse.value = response;
    await refreshContextCompiler({ silent: true });
    showPresetModal.value = false;
    return true;
  } catch (err) {
    presetFormError.value = err instanceof Error ? err.message : "保存上下文配置失败。";
    return false;
  } finally {
    savingPreset.value = false;
  }
}

async function savePresetForm() {
  const profileId = presetForm.value.profileId.trim();
  if (!profileId) {
    presetFormError.value = "请填写 Profile ID。";
    return;
  }
  const conflict = profileRecords().some((profile) =>
    String(profile.profileId || profile.id || "") === profileId &&
      String(profile.profileId || profile.id || "") !== editingProfileId.value,
  );
  if (conflict) {
    presetFormError.value = "Profile ID 已存在。";
    return;
  }

  const original = editingProfileId.value ? rawProfileFor(editingProfileId.value) : {};
  const nextProfile = buildProfileFromForm(original);
  const nextProfiles = profileRecords().filter((profile) =>
    String(profile.profileId || profile.id || "") !== editingProfileId.value,
  );
  nextProfiles.push(nextProfile);
  await persistProfiles(nextProfiles);
}

async function deletePreset(profile: ContextProfileRow) {
  const label = profile.label || profile.profileId;
  if (!confirmConsoleAction(`删除上下文预设“${label}”？`)) {
    return;
  }
  const saved = await persistProfiles(
    profileRecords().filter((item) => String(item.profileId || item.id || "") !== profile.profileId),
  );
  if (!saved) {
    notifyConsoleAction(presetFormError.value || "删除上下文预设失败。");
  }
}

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
                      class="tool-button"
                      type="button"
                      @click="openAddPresetModal"
                    >
                      新增预设
                    </button>
                  </div>
                </div>

                <div class="context-profile-list">
                  <article
                    v-for="profile in contextProfileRows"
                    :key="profile.profileId"
                    class="context-profile-item"
                  >
                    <header class="context-profile-item-header">
                      <div class="profile-heading">
                        <h4 class="profile-title">{{ profile.label || profile.profileId }}</h4>
                        <span class="profile-mode">{{ profile.profileId }} · {{ profile.compressionMode }} / {{ profile.strategy }}</span>
                      </div>
                      <div class="profile-actions">
                        <button
                          class="table-action"
                          type="button"
                          @click="openEditPresetModal(profile)"
                        >
                          编辑
                        </button>
                        <button
                          class="table-action danger-action"
                          type="button"
                          :disabled="savingPreset"
                          @click="deletePreset(profile)"
                        >
                          删除
                        </button>
                      </div>
                    </header>
                    <div class="profile-budgets">
                      <div class="budget-item">
                        <span class="budget-label">窗口总量</span>
                        <span class="budget-value">{{ profile.contextWindowTokens.toLocaleString() }}</span>
                      </div>
                      <div class="budget-item">
                        <span class="budget-label">知识分配</span>
                        <span class="budget-value">{{ profile.knowledgeBudget.toLocaleString() }}</span>
                      </div>
                      <div class="budget-item">
                        <span class="budget-label">历史分配</span>
                        <span class="budget-value">{{ profile.historyBudget.toLocaleString() }}</span>
                      </div>
                      <div class="budget-item">
                        <span class="budget-label">专家介入</span>
                        <span class="budget-value">{{ Math.round(profile.expertGuidanceRatio * 100) }}%</span>
                      </div>
                    </div>
                    <footer class="profile-meta">
                      <span class="meta-badge" v-if="profile.protectedEvidenceFields && profile.protectedEvidenceFields.length">
                        保护: {{ profile.protectedEvidenceFields.slice(0, 4).join(", ") }}
                      </span>
                      <span class="meta-badge" v-else>
                        保护: 默认规则
                      </span>
                      <span class="meta-badge">
                        模型压缩: {{ profile.modelCompressionEnabled ? (profile.modelCompressionAlias || "开启") : "关闭" }}
                      </span>
                    </footer>
                  </article>
                  <div v-if="!contextProfileRows.length" class="empty-profile-state">
                    暂无上下文配置。您可以点击右上角“新增预设”进行添加。
                  </div>
                </div>

                <div class="preview-task-form">
                  <label>
                    <span>预览任务</span>
                    <textarea v-model="contextPreviewTask" rows="3" spellcheck="false" placeholder="输入你想在此上下文中进行的操作或预览提示..."></textarea>
                  </label>
                  <label>
                    <span>必须保留的 evidenceId</span>
                    <input v-model="contextPreviewRequiredEvidence" placeholder="ev_1, evidence::abc" autocomplete="off" />
                  </label>
                </div>
                <div class="context-action-bar">
                  <button
                    class="tool-button primary-action"
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
                  <div class="action-divider"></div>
                  <button
                    class="tool-button tool-button-ghost"
                    type="button"
                    :disabled="!contextBuildRecordRows.length"
                    @click="exportContextBuildRecords"
                  >
                    导出记录
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

              <div v-if="showPresetModal" class="pact-modal-overlay" @click.self="closePresetModal">
                <form class="pact-modal" @submit.prevent="savePresetForm">
                  <header class="pact-modal-header">
                    <h3>{{ presetModalTitle }}</h3>
                  </header>
                  <div class="pact-modal-body form-grid">
                    <label class="full-row">
                      <span>配置标识 (Profile ID)</span>
                      <input v-model="presetForm.profileId" placeholder="例如: context-256k" />
                    </label>
                    <label class="full-row">
                      <span>配置名称 (Label)</span>
                      <input v-model="presetForm.label" placeholder="例如: 256K Context" />
                    </label>
                    <label>
                      <span>窗口总量</span>
                      <input type="number" min="4096" step="1024" v-model.number="presetForm.contextWindowTokens" />
                    </label>
                    <label>
                      <span>知识分配</span>
                      <input type="number" min="0" step="1024" v-model.number="presetForm.knowledgeBudget" />
                    </label>
                    <label>
                      <span>历史分配</span>
                      <input type="number" min="0" step="1024" v-model.number="presetForm.historyBudget" />
                    </label>
                    <label>
                      <span>最近轮次</span>
                      <input type="number" min="0" step="1024" v-model.number="presetForm.recentTurnBudget" />
                    </label>
                    <label>
                      <span>专家介入权重 (0-1)</span>
                      <input type="number" min="0" max="1" step="0.01" v-model.number="presetForm.expertGuidanceRatio" />
                    </label>
                    <p v-if="presetFormError" class="preset-form-error full-row">{{ presetFormError }}</p>
                  </div>
                  <footer class="pact-modal-footer">
                    <button class="tool-button tool-button-ghost" type="button" :disabled="savingPreset" @click="closePresetModal">取消</button>
                    <button class="tool-button" type="submit" :disabled="savingPreset || !presetForm.profileId.trim()">
                      {{ savingPreset ? "保存中" : "保存配置" }}
                    </button>
                  </footer>
                </form>
              </div>
            </article>
          </section>
</template>

<style scoped>
.context-profile-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin: 1.5rem 0;
}

.context-profile-item {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  transition: border-color 0.2s ease;
}

.context-profile-item:hover {
  border-color: var(--el-border-color);
}

.context-profile-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 0.75rem;
}

.profile-heading {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.profile-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
  letter-spacing: 0;
}

.profile-mode {
  font-size: 0.875rem;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.profile-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.profile-budgets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
}

.budget-item {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.budget-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--el-text-color-secondary);
}

.budget-value {
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--el-text-color-primary);
  font-variant-numeric: tabular-nums;
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.5rem;
}

.meta-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.375rem 0.625rem;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.empty-profile-state {
  padding: 3rem 1.5rem;
  text-align: center;
  background: var(--el-bg-color-page);
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  font-size: 0.875rem;
}

/* Modal Styles */
.pact-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
  animation: fade-in 0.2s ease-out;
}

.pact-modal {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.pact-modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.pact-modal-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
  letter-spacing: 0;
}

.pact-modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  max-height: 70vh;
}

.pact-modal-body label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pact-modal-body label span {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.pact-modal-body input {
  width: 100%;
  height: 40px;
  padding: 0 0.75rem;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  font-size: 0.875rem;
  transition: border-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1);
}

.pact-modal-body input:focus {
  outline: none;
  border-color: var(--el-color-primary);
}

.pact-modal-body input::placeholder {
  color: var(--el-text-color-placeholder);
}

.preset-form-error {
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--danger-border);
  border-radius: 6px;
  background: var(--danger-surface);
  color: var(--danger);
  font-size: 0.875rem;
}

.pact-modal-footer {
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  background: var(--el-bg-color-page);
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.preview-task-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1.5rem;
  background: var(--el-bg-color-overlay);
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
}

.preview-task-form label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-task-form label span {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.preview-task-form input,
.preview-task-form textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  font-size: 0.875rem;
  font-family: inherit;
  transition: border-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1);
}

.preview-task-form input:focus,
.preview-task-form textarea:focus {
  outline: none;
  border-color: var(--el-color-primary);
}

.preview-task-form textarea {
  resize: vertical;
  min-height: 80px;
}

/* Unified Action Bar */
.context-action-bar {
  display: flex;
  gap: 1rem;
  align-items: center;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  padding: 1rem;
  border-radius: 8px;
  margin-top: 1.5rem;
  margin-bottom: 1.5rem;
}

.context-action-bar .tool-button {
  flex: 1;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.context-action-bar .primary-action {
  background: var(--el-color-primary);
  color: var(--el-color-white);
  border: none;
}

.context-action-bar .primary-action:not(:disabled):hover {
  background: var(--el-color-primary-light-3);
}

.action-divider {
  width: 1px;
  height: 24px;
  background: var(--el-border-color-lighter);
  margin: 0 0.5rem;
}

@media (max-width: 720px) {
  .context-profile-item-header,
  .context-action-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .profile-actions,
  .pact-modal-footer {
    justify-content: flex-start;
  }

  .action-divider {
    display: none;
  }
}
</style>
