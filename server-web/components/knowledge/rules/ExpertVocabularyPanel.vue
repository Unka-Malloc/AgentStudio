<script setup lang="ts">
import FeatureToggle from "../../FeatureToggle.vue";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";

const {
  addVocabularyEntry,
  busyKey,
  deleteVocabularyEntry,
  displayedVocabularyEntries,
  expertVocabularyDraft,
  hiddenVocabularyEntryCount,
  saveExpertVocabulary,
  setVocabularyEntryEnabled,
  showAllVocabularyEntries,
  updateVocabularyDomains,
  updateVocabularyKeywords,
  updateVocabularyPath,
  vocabularyEntryPath,
  vocabularySearch,
} = useKnowledgeRulesContext();
</script>

<template>
  <article class="surface-card knowledge-vocabulary expert-rules-page">
    <div class="section-header">
      <div>
        <h3>专家词汇规则</h3>
        <p>用于知识分类、事务归纳和检索提示。Toggle 控制词条是否作为 active 专家规则参与运行。</p>
      </div>
      <span>v{{ expertVocabularyDraft.version || 0 }} / {{ expertVocabularyDraft.entries.length }} 条</span>
    </div>
    <div class="vocabulary-controls">
      <label class="vocabulary-filter">
        <span>筛选词条</span>
        <input v-model="vocabularySearch" type="search" autocomplete="off" placeholder="路径、关键词、域名或备注" />
      </label>
      <div class="drawer-actions">
        <button class="tool-button tool-button-ghost" type="button" @click="addVocabularyEntry">
          新增词条
        </button>
        <button class="tool-button" type="button" :disabled="busyKey === 'expert-vocabulary'" @click="saveExpertVocabulary">
          {{ busyKey === "expert-vocabulary" ? "发布中" : "保存并发布" }}
        </button>
      </div>
    </div>
    <div class="vocabulary-table-shell">
      <table class="vocabulary-table">
        <thead>
          <tr>
            <th>层级路径</th>
            <th>关键词</th>
            <th>发件域名</th>
            <th>状态</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in displayedVocabularyEntries" :key="item.entry.id || item.index">
            <td>
              <input :value="vocabularyEntryPath(item.entry)" autocomplete="off" @input="updateVocabularyPath(item.index, ($event.target as HTMLInputElement).value)" />
            </td>
            <td>
              <textarea :value="item.entry.keywords.join(', ')" @input="updateVocabularyKeywords(item.index, ($event.target as HTMLTextAreaElement).value)" />
            </td>
            <td>
              <textarea :value="item.entry.domains.join(', ')" @input="updateVocabularyDomains(item.index, ($event.target as HTMLTextAreaElement).value)" />
            </td>
            <td>
              <FeatureToggle
                :model-value="item.entry.status === 'active'"
                :aria-label="item.entry.status === 'active' ? '停用词条' : '启用词条'"
                @update:model-value="setVocabularyEntryEnabled(item.index, $event)"
              />
              <small class="field-hint">{{ item.entry.status }}</small>
            </td>
            <td>
              <input v-model="item.entry.notes" autocomplete="off" />
            </td>
            <td>
              <button class="table-action" type="button" @click="deleteVocabularyEntry(item.index)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="expertVocabularyDraft.entries.length === 0" class="empty-state">
        <strong>暂无词条</strong>
        <span>请先新增一个层级路径。</span>
      </div>
    </div>
    <div v-if="hiddenVocabularyEntryCount > 0" class="vocabulary-footer">
      <span>已隐藏 {{ hiddenVocabularyEntryCount }} 条低频维护项。</span>
      <button class="table-action" type="button" @click="showAllVocabularyEntries = true">
        展开全部
      </button>
    </div>
    <div v-else-if="showAllVocabularyEntries && !vocabularySearch" class="vocabulary-footer">
      <span>已显示全部词条。</span>
      <button class="table-action" type="button" @click="showAllVocabularyEntries = false">
        收起
      </button>
    </div>
  </article>
</template>
