<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavDebugSection" });

const {
  activeRouteDebugTab,
  activeRouteView,
  localizedDebugTabLabel,
  msg,
  openDebugTab,
  visibleDebugTabs,
} = useConsoleSideNavContext();
</script>

<template>
  <section v-if="visibleDebugTabs.length > 0" class="side-nav-section" :aria-label="msg.nav.debugPanel">
    <p class="side-nav-section-title">{{ msg.nav.debugPanel }}</p>
    <ConsoleSideNavLink
      v-for="tab in visibleDebugTabs"
      :key="tab.id"
      :active="activeRouteView === 'debug' && activeRouteDebugTab === tab.id"
      :label="localizedDebugTabLabel(tab)"
      subtle
      @activate="openDebugTab(tab.id)"
    />
  </section>
</template>
