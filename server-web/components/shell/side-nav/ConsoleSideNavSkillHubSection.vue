<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavSkillHubSection" });

const {
  activeRouteAdminView,
  activeRouteView,
  hasFeature,
  msg,
  openAdmin,
} = useConsoleSideNavContext();
</script>

<template>
  <section
    v-if="hasFeature('agent-gateway') || hasFeature('agent-management')"
    class="side-nav-section"
    :aria-label="msg.nav.skillHub"
  >
    <p class="side-nav-section-title">{{ msg.nav.skillHub }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && (activeRouteAdminView === 'tools' || activeRouteAdminView === 'toolList')"
      :label="msg.nav.toolList"
      subtle
      @activate="openAdmin('toolList')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'toolGovernance'"
      :label="msg.nav.toolGovernance"
      subtle
      @activate="openAdmin('toolGovernance')"
    />
    <ConsoleSideNavLink
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'toolStats'"
      :label="msg.nav.toolStats"
      subtle
      @activate="openAdmin('toolStats')"
    />
  </section>
</template>
