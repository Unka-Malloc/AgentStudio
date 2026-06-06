<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavTeamSection" });

const {
  activeRouteView,
  msg,
  switchView,
} = useConsoleSideNavContext();
</script>

<template>
  <section class="side-nav-section" :aria-label="msg.nav.teamPanel">
    <p class="side-nav-section-title">{{ msg.nav.teamPanel }}</p>
    <ConsoleSideNavLink
      :active="activeRouteView === 'workspaces'"
      :label="msg.nav.workspaces"
      subtle
      @activate="switchView('workspaces')"
    />
  </section>
</template>
