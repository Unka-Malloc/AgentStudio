<script setup lang="ts">
import { computed, unref } from "vue";
import FeatureToggle from "../../FeatureToggle.vue";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";
import { useOptionalServerConsoleShellContext } from "../../../composables/serverConsoleShellContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../../i18n/console";

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

const shellContext = useOptionalServerConsoleShellContext();
const locale = computed(() => {
  const shellLanguageMode = shellContext ? unref(shellContext.languageMode) : null;
  return resolveEffectiveConsoleLocale(shellLanguageMode || currentConsoleLocale.value);
});
function t(value: string) {
  return localizeConsoleText(value, locale.value);
}

function entryCountLabel(count: number) {
  return t(`${count} 条`);
}

const hiddenEntryText = computed(() =>
  t(`已隐藏 ${hiddenVocabularyEntryCount.value} 条低频维护项。`),
);
const showAllEntriesText = computed(() => t("展开全部"));
const collapseEntriesText = computed(() => t("收起"));
</script>

<template>
  <article class="surface-card knowledge-vocabulary expert-rules-page">
    <div class="section-header">
      <div>
        <h3>{{ t("专家词汇规则") }}</h3>
        <p>{{ t("用于知识分类、事务归纳和检索提示。Toggle 控制词条是否作为 active 专家规则参与运行。") }}</p>
      </div>
      <span>v{{ expertVocabularyDraft.version || 0 }} / {{ entryCountLabel(expertVocabularyDraft.entries.length) }}</span>
    </div>
    <div class="vocabulary-controls">
      <label class="vocabulary-filter">
        <span>{{ t("筛选词条") }}</span>
        <input v-model="vocabularySearch" type="search" autocomplete="off" :placeholder="t('路径、关键词、域名或备注')" />
      </label>
      <div class="drawer-actions">
        <button class="tool-button tool-button-ghost" type="button" @click="addVocabularyEntry">
          {{ t("新增词条") }}
        </button>
        <button class="tool-button" type="button" :disabled="busyKey === 'expert-vocabulary'" @click="saveExpertVocabulary">
          {{ t(busyKey === "expert-vocabulary" ? "发布中" : "保存并发布") }}
        </button>
      </div>
    </div>
    <div class="vocabulary-table-shell">
      <table class="vocabulary-table">
        <thead>
          <tr>
            <th>{{ t("层级路径") }}</th>
            <th>{{ t("关键词") }}</th>
            <th>{{ t("发件域名") }}</th>
            <th>{{ t("状态") }}</th>
            <th>{{ t("备注") }}</th>
            <th>{{ t("操作") }}</th>
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
                :aria-label="t(item.entry.status === 'active' ? '停用词条' : '启用词条')"
                @update:model-value="setVocabularyEntryEnabled(item.index, $event)"
              />
              <small class="field-hint">{{ item.entry.status }}</small>
            </td>
            <td>
              <input v-model="item.entry.notes" autocomplete="off" />
            </td>
            <td>
              <button class="table-action" type="button" @click="deleteVocabularyEntry(item.index)">
                {{ t("删除") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="expertVocabularyDraft.entries.length === 0" class="empty-state">
        <strong>{{ t("暂无词条") }}</strong>
        <span>{{ t("请先新增一个层级路径。") }}</span>
      </div>
    </div>
    <div v-if="hiddenVocabularyEntryCount > 0" class="vocabulary-footer">
      <span>{{ hiddenEntryText }}</span>
      <button class="table-action" type="button" @click="showAllVocabularyEntries = true">
        {{ showAllEntriesText }}
      </button>
    </div>
    <div v-else-if="showAllVocabularyEntries && !vocabularySearch" class="vocabulary-footer">
      <span>{{ t("已显示全部词条。") }}</span>
      <button class="table-action" type="button" @click="showAllVocabularyEntries = false">
        {{ collapseEntriesText }}
      </button>
    </div>
  </article>
</template>
