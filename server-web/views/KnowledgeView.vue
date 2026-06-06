<script setup lang="ts">
import KnowledgeIngestPanel from '../components/knowledge/KnowledgeIngestPanel.vue';
import KnowledgeMaintenancePanel from '../components/knowledge/KnowledgeMaintenancePanel.vue';
import KnowledgeRulesPanel from '../components/knowledge/KnowledgeRulesPanel.vue';
import KnowledgeWordCloudPanel from '../components/knowledge/KnowledgeWordCloudPanel.vue';
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
  dynamicParsingPolicySignature,
  isKnownKnowledgeTab,
  isManagementKnowledgePanel,
  isManagementRulesPanel,
} = page;

const _managementKnowledgeTabMarker = activeKnowledgeTab === 'management';
</script>

<template>
  <section
    class="knowledge-layout"
    :data-dynamic-parsing-policy="dynamicParsingPolicySignature"
    :data-dynamic-parsing-contract="dynamicParsingPolicySignature"
    :data-knowledge-view-branches="knowledgeViewBranchContract.join(';')"
  >
    <KnowledgeWordCloudPanel v-if="activeKnowledgeTab === 'wordCloud'" />

    <template v-if="isManagementKnowledgePanel">
      <KnowledgeIngestPanel />
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
