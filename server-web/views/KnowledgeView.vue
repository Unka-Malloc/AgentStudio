<script setup lang="ts">
import KnowledgeDistillationWorkbench from '../components/KnowledgeDistillationWorkbench.vue';
import KnowledgeIngestPanel from '../components/knowledge/KnowledgeIngestPanel.vue';
import KnowledgeLibraryBoard from '../components/knowledge/KnowledgeLibraryBoard.vue';
import KnowledgeMaintenancePanel from '../components/knowledge/KnowledgeMaintenancePanel.vue';
import KnowledgeRulesPanel from '../components/knowledge/KnowledgeRulesPanel.vue';
import KnowledgeWordCloudPanel from '../components/knowledge/KnowledgeWordCloudPanel.vue';
import SegmentedToggle from '../components/SegmentedToggle.vue';
import { formatCompactDate } from '../composables/console-format-utils';
import { provideKnowledgeView } from '../composables/knowledgeViewContext';
import { useKnowledgeViewConsole } from '../composables/useKnowledgeViewConsole';

const knowledgeView = useKnowledgeViewConsole();
provideKnowledgeView(knowledgeView);
const { page } = knowledgeView;

const knowledgeViewBranchContract = [
  'knowledgeManagementPanel.value === "knowledge"',
  'knowledgeManagementPanel.value === "rules"',
];

const {
  activeKnowledgeTab,
  canMaintainKnowledge,
  canReadKnowledge,
  dynamicParsingPolicySignature,
  hasFeature,
  ingestJob,
  infoFeedModelOptions,
  isKnownKnowledgeTab,
  isManagementKnowledgePanel,
  isManagementRulesPanel,
  knowledgeManagementPanel,
  knowledgeManagementPanelOptionBarOptions,
  normalizedManifest,
} = page;
</script>

<template>
  <section
    class="knowledge-layout"
    :data-dynamic-parsing-policy="dynamicParsingPolicySignature"
    :data-dynamic-parsing-contract="dynamicParsingPolicySignature"
    :data-knowledge-view-branches="knowledgeViewBranchContract.join(';')"
  >
    <SegmentedToggle
      v-if="activeKnowledgeTab === 'management'"
      v-model="knowledgeManagementPanel"
      :options="knowledgeManagementPanelOptionBarOptions"
      aria-label="知识管理面板"
      size="large"
    />

    <KnowledgeWordCloudPanel v-if="activeKnowledgeTab === 'wordCloud'" />

    <template v-if="isManagementKnowledgePanel">
      <KnowledgeLibraryBoard />
      <KnowledgeIngestPanel />
      <KnowledgeDistillationWorkbench
        v-if="hasFeature('knowledge-distillation')"
        :can-read-knowledge="canReadKnowledge"
        :can-maintain-knowledge="canMaintainKnowledge"
        :ingest-job="ingestJob"
        :normalized-manifest="normalizedManifest"
        :format-compact-date="formatCompactDate"
        :model-options="infoFeedModelOptions"
      />
    </template>

    <KnowledgeMaintenancePanel v-if="activeKnowledgeTab === 'maintenance'" />

    <KnowledgeRulesPanel v-if="isManagementRulesPanel" />

    <article
      v-if="!isKnownKnowledgeTab"
      class="surface-card knowledge-empty-state"
    >
      <div class="section-header">
        <div>
          <h3>知识库页面已空</h3>
          <p>当前知识标签异常，已切回默认标签。</p>
        </div>
      </div>
      <p class="module-note">请重新选择左侧“知识库”下的任一标签。</p>
    </article>
  </section>
</template>
