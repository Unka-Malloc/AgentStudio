<script setup lang="ts">
import { computed, unref } from "vue";
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import StatusPill from "../../StatusPill.vue";
import { jsonPreview } from "../../../composables/console-format-utils";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";
import { useOptionalServerConsoleShellContext } from "../../../composables/serverConsoleShellContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../../i18n/console";

const {
  busyKey,
  canAdminKnowledge,
  expertRuleEnabled,
  goldenRuleItems,
  goldenRulePackageTitle,
  goldenRulePackages,
  toggleGoldenRuleEnabled,
} = useKnowledgeRulesContext();

const shellContext = useOptionalServerConsoleShellContext();
const locale = computed(() => {
  const shellLanguageMode = shellContext ? unref(shellContext.languageMode) : null;
  return resolveEffectiveConsoleLocale(shellLanguageMode || currentConsoleLocale.value);
});
function t(value: string) {
  return localizeConsoleText(value, locale.value);
}

function ruleCountLabel(count: number) {
  return t(`${count} 条`);
}

function fallbackRuleLabel(index: number) {
  return locale.value === "en" ? `Rule ${index + 1}` : `规则 ${index + 1}`;
}
</script>

<template>
  <article class="surface-card expert-rules-page">
    <div class="section-header">
      <div>
        <h3>{{ t("黄金规则") }}</h3>
      </div>
    </div>
    <div class="expert-rule-group-list">
      <section
        v-for="pkg in goldenRulePackages"
        :key="String(pkg.packageId || pkg.version)"
        class="module-panel expert-rule-package"
      >
        <div class="module-panel-heading">
          <div>
            <strong>{{ t(goldenRulePackageTitle(pkg)) }}</strong>
            <span>{{ t(String(pkg.status || "unknown")) }} · {{ ruleCountLabel(goldenRuleItems(pkg).length) }}</span>
          </div>
          <StatusPill
            :tone="String(pkg.status || '') === 'active' ? 'success' : 'warning'"
            :label="t(String(pkg.status || 'draft'))"
          />
        </div>
        <div class="expert-rule-card-list">
          <article
            v-for="item in goldenRuleItems(pkg)"
            :key="String(item.rule.ruleId || item.index)"
            class="expert-rule-card"
            :data-enabled="expertRuleEnabled(item.rule)"
          >
            <div>
              <strong>{{ t(String(item.rule.label || item.rule.ruleId || fallbackRuleLabel(item.index))) }}</strong>
              <span>{{ String(item.rule.action || "needs_human_review") }} · priority {{ Number(item.rule.priority || 0) }}</span>
              <p>{{ t(String(item.rule.reason || item.rule.description || "无说明")) }}</p>
              <small>{{ (Array.isArray(item.rule.targetTypes) ? item.rule.targetTypes : ["*"]).join(" / ") }}</small>
            </div>
            <FeatureToggle
              :model-value="expertRuleEnabled(item.rule)"
              :aria-label="t(expertRuleEnabled(item.rule) ? '停用规则' : '启用规则')"
              :disabled="!canAdminKnowledge || busyKey === `golden-rule:${String(pkg.packageId || '')}:${item.index}`"
              @update:model-value="toggleGoldenRuleEnabled(pkg, item.index, $event)"
            />
          </article>
        </div>
        <ConfigFoldCard :title="t('规则包 JSON')">
          <pre>{{ jsonPreview(pkg) }}</pre>
        </ConfigFoldCard>
      </section>
      <div v-if="goldenRulePackages.length === 0" class="empty-state">
        <strong>{{ t("暂无黄金规则包") }}</strong>
        <span>{{ t("使用右上角刷新，或通过工作台创建规则草稿。") }}</span>
      </div>
    </div>
  </article>
</template>
