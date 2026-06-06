<script setup lang="ts">
import ConfigFoldCard from "../../ConfigFoldCard.vue";
import { shortId } from "../../../composables/console-agent-explore-presentation";
import { jsonPreview } from "../../../composables/console-format-utils";
import { ruleAuthoringStatusLabel } from "../../../composables/console-rule-authoring-display-utils";
import { useKnowledgeRulesContext } from "../../../composables/knowledgeViewContext";

const {
  busyKey,
  publishRuleAuthoringPackage,
  ruleAuthoringResult,
} = useKnowledgeRulesContext();
</script>

<template>
  <div v-if="ruleAuthoringResult" class="rule-authoring-result">
    <div class="rule-authoring-status">
      <strong>{{ ruleAuthoringStatusLabel(ruleAuthoringResult.status) }}</strong>
      <span v-if="ruleAuthoringResult.runId">{{ shortId(ruleAuthoringResult.runId) }}</span>
    </div>
    <div class="rule-authoring-pipeline">
      <span
        v-for="(step, stepIndex) in ruleAuthoringResult.steps || []"
        :key="`${String(step.stage || 'stage')}:${stepIndex}`"
        :data-status="String(step.status || '')"
      >
        {{ step.stage }} · {{ step.status }}
      </span>
    </div>
    <div v-if="ruleAuthoringResult.confirmation" class="rule-authoring-confirm">
      <span>
        规则包 {{ ruleAuthoringResult.confirmation.packageId }} v{{ ruleAuthoringResult.confirmation.version }}
        已保存为草稿。
      </span>
      <button
        class="tool-button"
        type="button"
        :disabled="busyKey === 'knowledge:rule-authoring:publish'"
        @click="publishRuleAuthoringPackage"
      >
        {{ busyKey === "knowledge:rule-authoring:publish" ? "发布中" : "确认发布" }}
      </button>
    </div>
    <ConfigFoldCard title="门禁结果">
      <pre>{{ jsonPreview(ruleAuthoringResult.gate || {}) }}</pre>
    </ConfigFoldCard>
    <ConfigFoldCard title="生成的 JSON 规则包">
      <pre>{{ jsonPreview(ruleAuthoringResult.package || {}) }}</pre>
    </ConfigFoldCard>
  </div>
</template>
