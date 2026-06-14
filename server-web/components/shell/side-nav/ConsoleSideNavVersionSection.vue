<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavVersionSection" });

const {
  activeRouteAdminView,
  activeRouteView,
  msg,
  openAdmin,
} = useConsoleSideNavContext();
</script>

<template>
  <section class="side-nav-section" :aria-label="msg.nav.version">
    <p class="side-nav-section-title">{{ msg.nav.version }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'versionRelease'"
      :label="msg.nav.versionRelease"
      subtle
      @activate="openAdmin('versionRelease')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'productionHealth'"
      :label="msg.nav.productionHealth"
      subtle
      @activate="openAdmin('productionHealth')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'versionAssembly'"
      :label="msg.nav.versionAssembly"
      subtle
      @activate="openAdmin('versionAssembly')"
    />
  </section>
</template>
