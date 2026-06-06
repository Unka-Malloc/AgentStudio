<script setup lang="ts">
import { externalServiceTabs } from "../../../composables/console-defaults";
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavExternalServiceSection" });

const {
  activeRouteAdminView,
  activeRouteExternalServiceTab,
  activeRouteView,
  localizedExternalServiceTabLabel,
  msg,
  openAdmin,
  openExternalServiceTab,
} = useConsoleSideNavContext();
</script>

<template>
  <section class="side-nav-section" :aria-label="msg.nav.externalServices">
    <p class="side-nav-section-title">{{ msg.nav.externalServices }}</p>
    <ConsoleSideNavLink
      v-for="tab in externalServiceTabs"
      :key="tab.id"
      :active="activeRouteView === 'externalServices' && activeRouteExternalServiceTab === tab.id"
      :label="localizedExternalServiceTabLabel(tab)"
      subtle
      @activate="openExternalServiceTab(tab.id)"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'clients'"
      :label="msg.nav.devices"
      subtle
      @activate="openAdmin('clients')"
    />
  </section>
</template>
