<script setup lang="ts">
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import StatusPill from "../../StatusPill.vue";
import { jsonPreview } from "../../../composables/console-format-utils";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";

const {
  busyKey,
  canAdminKnowledge,
  expertRuleEnabled,
  goldenRuleItems,
  goldenRulePackageTitle,
  goldenRulePackages,
  toggleGoldenRuleEnabled,
} = useKnowledgeRulesContext();
</script>

<template>
  <article class="surface-card expert-rules-page">
    <div class="section-header">
      <div>
        <h3>黄金规则</h3>
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
            <strong>{{ goldenRulePackageTitle(pkg) }}</strong>
            <span>{{ String(pkg.status || "unknown") }} · {{ goldenRuleItems(pkg).length }} 条</span>
          </div>
          <StatusPill
            :tone="String(pkg.status || '') === 'active' ? 'success' : 'warning'"
            :label="String(pkg.status || 'draft')"
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
              <strong>{{ String(item.rule.label || item.rule.ruleId || `规则 ${item.index + 1}`) }}</strong>
              <span>{{ String(item.rule.action || "needs_human_review") }} · priority {{ Number(item.rule.priority || 0) }}</span>
              <p>{{ String(item.rule.reason || item.rule.description || "无说明") }}</p>
              <small>{{ (Array.isArray(item.rule.targetTypes) ? item.rule.targetTypes : ["*"]).join(" / ") }}</small>
            </div>
            <FeatureToggle
              :model-value="expertRuleEnabled(item.rule)"
              :aria-label="expertRuleEnabled(item.rule) ? '停用规则' : '启用规则'"
              :disabled="!canAdminKnowledge || busyKey === `golden-rule:${String(pkg.packageId || '')}:${item.index}`"
              @update:model-value="toggleGoldenRuleEnabled(pkg, item.index, $event)"
            />
          </article>
        </div>
        <ConfigFoldCard title="规则包 JSON">
          <pre>{{ jsonPreview(pkg) }}</pre>
        </ConfigFoldCard>
      </section>
      <div v-if="goldenRulePackages.length === 0" class="empty-state">
        <strong>暂无黄金规则包</strong>
        <span>使用右上角刷新，或通过工作台创建规则草稿。</span>
      </div>
    </div>
  </article>
</template>
