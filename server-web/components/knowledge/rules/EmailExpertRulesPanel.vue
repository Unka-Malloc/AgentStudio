<script setup lang="ts">
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import FeatureToggle from "../../FeatureToggle.vue";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";

const {
  busyKey,
  emailReportSeriesRules,
  emailSynonymRules,
  expertRuleEnabled,
  rulesText,
  saveRules,
  setEmailRuleEntryEnabled,
} = useKnowledgeRulesContext();
</script>

<template>
  <article class="surface-card knowledge-rules expert-rules-page">
    <div class="section-header">
      <div>
        <h3>邮件专家规则</h3>
      </div>
      <span>{{ emailReportSeriesRules.length + emailSynonymRules.length }} 条</span>
    </div>
    <div class="expert-rule-grid">
      <section class="module-panel">
        <div class="module-panel-heading">
          <strong>报告序列</strong>
          <span>{{ emailReportSeriesRules.length }}</span>
        </div>
        <div class="expert-rule-card-list">
          <article
            v-for="item in emailReportSeriesRules"
            :key="item.rule.id || item.index"
            class="expert-rule-card"
            :data-enabled="expertRuleEnabled(item.rule)"
          >
            <div>
              <strong>{{ item.rule.label }}</strong>
              <span>{{ item.rule.cadence }} · {{ item.rule.id }}</span>
              <p>{{ item.rule.keywords.join(" / ") }}</p>
            </div>
            <FeatureToggle
              :model-value="expertRuleEnabled(item.rule)"
              :aria-label="expertRuleEnabled(item.rule) ? '停用报告序列规则' : '启用报告序列规则'"
              @update:model-value="setEmailRuleEntryEnabled('reportSeries', item.index, $event)"
            />
          </article>
        </div>
      </section>
      <section class="module-panel">
        <div class="module-panel-heading">
          <strong>同义词</strong>
          <span>{{ emailSynonymRules.length }}</span>
        </div>
        <div class="expert-rule-card-list">
          <article
            v-for="item in emailSynonymRules"
            :key="item.rule.canonical || item.index"
            class="expert-rule-card"
            :data-enabled="expertRuleEnabled(item.rule)"
          >
            <div>
              <strong>{{ item.rule.canonical }}</strong>
              <span>{{ item.rule.terms.length }} 个词</span>
              <p>{{ item.rule.terms.join(" / ") }}</p>
            </div>
            <FeatureToggle
              :model-value="expertRuleEnabled(item.rule)"
              :aria-label="expertRuleEnabled(item.rule) ? '停用同义词规则' : '启用同义词规则'"
              @update:model-value="setEmailRuleEntryEnabled('synonymDictionary', item.index, $event)"
            />
          </article>
        </div>
      </section>
    </div>
    <ConfigFoldCard class="rules-json-panel" title="展开规则 JSON">
      <textarea v-model="rulesText" class="rules-editor" spellcheck="false" />
    </ConfigFoldCard>
    <button class="tool-button" type="button" :disabled="busyKey === 'rules'" @click="saveRules">
      {{ busyKey === "rules" ? "保存中" : "保存规则库" }}
    </button>
  </article>
</template>
