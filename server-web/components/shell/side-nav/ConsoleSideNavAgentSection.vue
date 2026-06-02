<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavAgentSection" });

const {
  activeRouteAdminView,
  activeRouteView,
  hasAnyFeature,
  hasFeature,
  msg,
  openAdmin,
} = useConsoleSideNavContext();
</script>

<template>
  <section
    v-if="hasAnyFeature(['agent-gateway', 'agent-exploration'])"
    class="side-nav-section"
    :aria-label="msg.nav.agents"
  >
    <p class="side-nav-section-title">{{ msg.nav.agents }}</p>
    <ConsoleSideNavLink
      v-if="hasFeature('agent-gateway')"
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'agentConfig'"
      :label="msg.nav.agentConfig"
      subtle
      @activate="openAdmin('agentConfig')"
    />
    <ConsoleSideNavLink
      v-if="hasFeature('agent-gateway')"
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'agentAssignment'"
      :label="msg.nav.agentAssignment"
      subtle
      @activate="openAdmin('agentAssignment')"
    />
    <ConsoleSideNavLink
      v-if="hasFeature('agent-gateway')"
      :active="activeRouteView === 'admin' && activeRouteAdminView === 'contextManagement'"
      :label="msg.nav.contextManagement"
      subtle
      @activate="openAdmin('contextManagement')"
    />
  </section>
</template>
