<script setup lang="ts">
import { computed, unref } from "vue";
import AgentModelOptionBar from "../../AgentModelOptionBar.vue";
import OptionBar from "../../OptionBar.vue";
import SegmentedToggle from "../../SegmentedToggle.vue";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";
import { useOptionalServerConsoleShellContext } from "../../../composables/serverConsoleShellContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../../i18n/console";
import type { OptionBarOption } from "../../../types/app";
import RuleAuthoringResultPanel from "./RuleAuthoringResultPanel.vue";

const {
  busyKey,
  highlightedConfigTarget,
  ruleActionOptionBarOptions,
  ruleAuthoringCanSubmit,
  ruleAuthoringForm,
  ruleAuthoringModelOptions,
  ruleAuthoringResult,
  ruleCreationMode,
  ruleMatchStrategyOptionBarOptions,
  ruleScopeOptionBarOptions,
  runRuleAuthoringChat,
} = useKnowledgeRulesContext();

const shellContext = useOptionalServerConsoleShellContext();
const locale = computed(() => {
  const shellLanguageMode = shellContext ? unref(shellContext.languageMode) : null;
  return resolveEffectiveConsoleLocale(shellLanguageMode || currentConsoleLocale.value);
});

function t(value: string) {
  return localizeConsoleText(value, locale.value);
}

function localizeOptionBarOptions(options: OptionBarOption[]) {
  return (options || []).map((option) => ({
    ...option,
    label: t(String(option.label || option.value || "")),
  }));
}

const ruleCreationModeOptions = computed(() => [
  { value: "chat", label: t("智能对话") },
  { value: "manual", label: t("人工配置") },
]);
const localizedRuleScopeOptionBarOptions = computed(() =>
  localizeOptionBarOptions(unref(ruleScopeOptionBarOptions)),
);
const localizedRuleMatchStrategyOptionBarOptions = computed(() =>
  localizeOptionBarOptions(unref(ruleMatchStrategyOptionBarOptions)),
);
const localizedRuleActionOptionBarOptions = computed(() =>
  localizeOptionBarOptions(unref(ruleActionOptionBarOptions)),
);
const submitLabel = computed(() =>
  t(
    unref(busyKey) === "knowledge:rule-authoring"
      ? "生成中"
      : unref(ruleCreationMode) === "manual"
        ? "按配置创建规则"
        : "生成规则草稿",
  ),
);
</script>

<template>
  <article class="surface-card rule-authoring-card">
    <div class="section-header">
      <div>
        <h3>{{ t("创建规则") }}</h3>
      </div>
      <SegmentedToggle
        v-model="ruleCreationMode"
        :options="ruleCreationModeOptions"
        :aria-label="t('创建规则方式')"
      />
    </div>
    <form class="rule-authoring-form" :data-mode="ruleCreationMode" @submit.prevent="runRuleAuthoringChat">
      <template v-if="ruleCreationMode === 'chat'">
        <label class="full-row">
          <span>{{ t("需求") }}</span>
          <textarea
            v-model="ruleAuthoringForm.message"
            rows="4"
            :placeholder="t('例如：生成一个黄金规则，完全一样的知识直接跳过')"
          ></textarea>
        </label>
        <AgentModelOptionBar
          data-config-target="rule-authoring-agent"
          :data-config-highlighted="highlightedConfigTarget === 'rule-authoring-agent'"
          v-model="ruleAuthoringForm.modelAlias"
          :label="t('智能体')"
          :placeholder="t('未分配智能体')"
          :options="ruleAuthoringModelOptions"
        />
      </template>
      <template v-else>
        <label>
          <span>{{ t("规则名称") }}</span>
          <input
            v-model="ruleAuthoringForm.ruleName"
            type="text"
            :placeholder="t('例如：重复知识处理规则')"
          />
        </label>
        <OptionBar
          v-model="ruleAuthoringForm.scope"
          :label="t('适用范围')"
          :options="localizedRuleScopeOptionBarOptions"
        />
        <OptionBar
          v-model="ruleAuthoringForm.matchStrategy"
          :label="t('匹配方式')"
          :options="localizedRuleMatchStrategyOptionBarOptions"
        />
        <OptionBar
          v-model="ruleAuthoringForm.action"
          :label="t('执行动作')"
          :options="localizedRuleActionOptionBarOptions"
        />
        <label>
          <span>{{ t("最低置信度") }}</span>
          <input
            v-model.number="ruleAuthoringForm.confidence"
            type="number"
            min="0"
            max="1"
            step="0.01"
          />
        </label>
        <label class="full-row">
          <span>{{ t("补充说明") }}</span>
          <textarea
            v-model="ruleAuthoringForm.notes"
            rows="3"
            :placeholder="t('写清楚边界条件、例外情况或需要人工审核的场景')"
          ></textarea>
        </label>
      </template>
      <button
        class="primary-action"
        type="submit"
        :disabled="busyKey === 'knowledge:rule-authoring' || !ruleAuthoringCanSubmit"
      >
        {{ submitLabel }}
      </button>
    </form>
    <RuleAuthoringResultPanel v-if="ruleAuthoringResult" />
  </article>
</template>
