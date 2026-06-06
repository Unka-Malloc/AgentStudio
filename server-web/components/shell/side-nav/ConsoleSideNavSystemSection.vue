<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavSystemSection" });

const {
  activeRouteAdminView,
  activeRouteView,
  hasFeature,
  msg,
  openAdmin,
} = useConsoleSideNavContext();
</script>

<template>
  <section class="side-nav-section" :aria-label="msg.nav.system">
    <p class="side-nav-section-title">{{ msg.nav.system }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'storage'"
      :label="msg.nav.overview"
      subtle
      @activate="openAdmin('storage')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'modules'"
      :label="msg.nav.modules"
      subtle
      @activate="openAdmin('modules')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'runtimeDownloads'"
      :label="msg.nav.runtimeDownloads"
      subtle
      @activate="openAdmin('runtimeDownloads')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'productionHealth'"
      :label="msg.nav.productionHealth"
      subtle
      @activate="openAdmin('productionHealth')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'logs'"
      :label="msg.nav.logs"
      subtle
      @activate="openAdmin('logs')"
    />
  </section>
  <section class="side-nav-section" :aria-label="msg.nav.operations">
    <p class="side-nav-section-title">{{ msg.nav.operations }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'jobs'"
      :label="msg.nav.jobs"
      subtle
      @activate="openAdmin('jobs')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'opsMonitor'"
      :label="msg.nav.opsMonitor"
      subtle
      @activate="openAdmin('opsMonitor')"
    />
    <ConsoleSideNavLink
      v-if="hasFeature('maintenance-agent-runbooks')"
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'maintenanceAgent'"
      :label="msg.nav.maintenanceAgent"
      subtle
      @activate="openAdmin('maintenanceAgent')"
    />
  </section>
</template>
