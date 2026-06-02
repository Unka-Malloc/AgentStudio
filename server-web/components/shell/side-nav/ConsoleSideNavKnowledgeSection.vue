<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavKnowledgeSection" });

const {
  activeRouteKnowledgeTab,
  activeRouteView,
  hasFeature,
  localizedKnowledgeTabLabel,
  msg,
  openKnowledgeTab,
  visibleKnowledgeTabs,
} = useConsoleSideNavContext();
</script>

<template>
  <section v-if="hasFeature('knowledge-core')" class="side-nav-section" :aria-label="msg.nav.knowledge">
    <p class="side-nav-section-title">{{ msg.nav.knowledge }}</p>
    <ConsoleSideNavLink
      v-for="tab in visibleKnowledgeTabs"
      :key="tab.id"
      :active="activeRouteView === 'knowledge' && activeRouteKnowledgeTab === tab.id"
      :label="localizedKnowledgeTabLabel(tab)"
      subtle
      @activate="openKnowledgeTab(tab.id)"
    />
  </section>
</template>
