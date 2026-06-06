<script setup lang="ts">
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";
import { createConsoleSideNavContext, provideConsoleSideNavContext } from "../../composables/consoleSideNavContext";
import ConsoleSideNavAgentSection from "./side-nav/ConsoleSideNavAgentSection.vue";
import ConsoleSideNavBackdrop from "./side-nav/ConsoleSideNavBackdrop.vue";
import ConsoleSideNavBrand from "./side-nav/ConsoleSideNavBrand.vue";
import ConsoleSideNavDebugSection from "./side-nav/ConsoleSideNavDebugSection.vue";
import ConsoleSideNavExternalServiceSection from "./side-nav/ConsoleSideNavExternalServiceSection.vue";
import ConsoleSideNavFooter from "./side-nav/ConsoleSideNavFooter.vue";
import ConsoleSideNavKnowledgeSection from "./side-nav/ConsoleSideNavKnowledgeSection.vue";
import ConsoleSideNavPrimaryLinks from "./side-nav/ConsoleSideNavPrimaryLinks.vue";
import ConsoleSideNavSkillHubSection from "./side-nav/ConsoleSideNavSkillHubSection.vue";
import ConsoleSideNavSystemSection from "./side-nav/ConsoleSideNavSystemSection.vue";
import ConsoleSideNavTeamSection from "./side-nav/ConsoleSideNavTeamSection.vue";

defineOptions({ name: "ConsoleSideNav" });
const sideNav = createConsoleSideNavContext(useServerConsoleShellContext());
provideConsoleSideNavContext(sideNav);
const { isAuthenticated, sideNavOpen } = sideNav;
</script>

<template>
  <aside v-if="isAuthenticated" class="side-nav" :class="{ 'is-open': sideNavOpen }">
    <ConsoleSideNavBrand />
    <nav class="side-nav-links">
      <ConsoleSideNavPrimaryLinks />
      <ConsoleSideNavTeamSection />
      <ConsoleSideNavKnowledgeSection />
      <ConsoleSideNavAgentSection />
      <ConsoleSideNavSkillHubSection />
      <ConsoleSideNavExternalServiceSection />
      <ConsoleSideNavSystemSection />
      <ConsoleSideNavDebugSection />
    </nav>

    <ConsoleSideNavFooter />
  </aside>

  <ConsoleSideNavBackdrop v-if="isAuthenticated && sideNavOpen" />
</template>
