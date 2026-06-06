<script setup lang="ts">
import AgentModelOptionBar from "../../AgentModelOptionBar.vue";
import OptionBar from "../../OptionBar.vue";
import SegmentedToggle from "../../SegmentedToggle.vue";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";
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
</script>

<template>
  <article class="surface-card rule-authoring-card">
    <div class="section-header">
      <div>
        <h3>创建规则</h3>
      </div>
      <SegmentedToggle
        v-model="ruleCreationMode"
        :options="[{ value: 'chat', label: '智能对话' }, { value: 'manual', label: '人工配置' }]"
        aria-label="创建规则方式"
      />
    </div>
    <form class="rule-authoring-form" :data-mode="ruleCreationMode" @submit.prevent="runRuleAuthoringChat">
      <template v-if="ruleCreationMode === 'chat'">
        <label class="full-row">
          <span>需求</span>
          <textarea
            v-model="ruleAuthoringForm.message"
            rows="4"
            placeholder="例如：生成一个黄金规则，完全一样的知识直接跳过"
          ></textarea>
        </label>
        <AgentModelOptionBar
          data-config-target="rule-authoring-agent"
          :data-config-highlighted="highlightedConfigTarget === 'rule-authoring-agent'"
          v-model="ruleAuthoringForm.modelAlias"
          label="智能体"
          placeholder="未分配智能体"
          :options="ruleAuthoringModelOptions"
        />
      </template>
      <template v-else>
        <label>
          <span>规则名称</span>
          <input
            v-model="ruleAuthoringForm.ruleName"
            type="text"
            placeholder="例如：重复知识处理规则"
          />
        </label>
        <OptionBar
          v-model="ruleAuthoringForm.scope"
          label="适用范围"
          :options="ruleScopeOptionBarOptions"
        />
        <OptionBar
          v-model="ruleAuthoringForm.matchStrategy"
          label="匹配方式"
          :options="ruleMatchStrategyOptionBarOptions"
        />
        <OptionBar
          v-model="ruleAuthoringForm.action"
          label="执行动作"
          :options="ruleActionOptionBarOptions"
        />
        <label>
          <span>最低置信度</span>
          <input
            v-model.number="ruleAuthoringForm.confidence"
            type="number"
            min="0"
            max="1"
            step="0.01"
          />
        </label>
        <label class="full-row">
          <span>补充说明</span>
          <textarea
            v-model="ruleAuthoringForm.notes"
            rows="3"
            placeholder="写清楚边界条件、例外情况或需要人工审核的场景"
          ></textarea>
        </label>
      </template>
      <button
        class="primary-action"
        type="submit"
        :disabled="busyKey === 'knowledge:rule-authoring' || !ruleAuthoringCanSubmit"
      >
        {{ busyKey === "knowledge:rule-authoring" ? "生成中" : (ruleCreationMode === "manual" ? "按配置创建规则" : "生成规则草稿") }}
      </button>
    </form>
    <RuleAuthoringResultPanel v-if="ruleAuthoringResult" />
  </article>
</template>
