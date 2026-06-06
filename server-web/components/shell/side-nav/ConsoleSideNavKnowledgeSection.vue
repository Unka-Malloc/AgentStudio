<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavKnowledgeSection" });

const {
  activeRouteDebugTab,
  activeRouteKnowledgeTab,
  activeRouteView,
  hasFeature,
  jumpToKnowledgeFileImport,
  knowledgeManagementPanel,
  msg,
  openDebugTab,
  openKnowledgeManagementPanel,
  openKnowledgeTab,
} = useConsoleSideNavContext();
</script>

<template>
  <section v-if="hasFeature('knowledge-core')" class="side-nav-section" :aria-label="msg.nav.knowledge">
    <p class="side-nav-section-title">{{ msg.nav.knowledge }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'knowledge' && activeRouteKnowledgeTab === 'management' && knowledgeManagementPanel === 'knowledge'"
      :label="msg.nav.knowledgeArchive"
      subtle
      @activate="jumpToKnowledgeFileImport"
    />
    <ConsoleSideNavLink
      v-if="hasFeature('knowledge-distillation')"
      :active="activeRouteView === 'debug' && activeRouteDebugTab === 'knowledgeDistillation'"
      :label="msg.nav.knowledgeDistillation"
      subtle
      @activate="openDebugTab('knowledgeDistillation')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'knowledge' && activeRouteKnowledgeTab === 'management' && knowledgeManagementPanel === 'rules'"
      :label="msg.nav.processingRules"
      subtle
      @activate="openKnowledgeManagementPanel('rules')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'knowledge' && activeRouteKnowledgeTab === 'wordCloud'"
      :label="msg.nav.corpusAnalysis"
      subtle
      @activate="openKnowledgeTab('wordCloud')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'knowledge' && activeRouteKnowledgeTab === 'maintenance'"
      :label="msg.nav.parameterConfig"
      subtle
      @activate="openKnowledgeTab('maintenance')"
    />
  </section>
</template>
