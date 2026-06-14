<script setup lang="ts">
import { useConsoleSideNavContext } from "../../../composables/consoleSideNavContext";
import ConsoleSideNavLink from "./ConsoleSideNavLink.vue";

defineOptions({ name: "ConsoleSideNavPrimaryLinks" });

const {
  activeRouteAdminView,
  activeRouteView,
  msg,
  openAdmin,
  openSideNavDirectory,
  showSideNavDirectory,
  switchView,
} = useConsoleSideNavContext();
</script>

<template>
  <ConsoleSideNavLink
    :active="activeRouteView === 'dashboard'"
    :label="msg.nav.dashboard"
    @activate="switchView('dashboard')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
    </template>
  </ConsoleSideNavLink>
  <ConsoleSideNavLink
    :active="activeRouteView === 'feed'"
    :label="msg.nav.feed"
    @activate="openSideNavDirectory('feed'); switchView('feed')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m3 15 2 2 4-4"/></svg>
    </template>
    <template v-if="activeRouteView === 'feed' && !showSideNavDirectory" #trail>
      <span class="side-link-directory-reveal" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </span>
    </template>
  </ConsoleSideNavLink>
  <ConsoleSideNavLink
    :active="activeRouteView === 'approval'"
    :label="msg.nav.approvalFlow"
    @activate="openSideNavDirectory('approval'); switchView('approval')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    </template>
    <template v-if="activeRouteView === 'approval' && !showSideNavDirectory" #trail>
      <span class="side-link-directory-reveal" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </span>
    </template>
  </ConsoleSideNavLink>
  <ConsoleSideNavLink
    :active="activeRouteView === 'admin' && activeRouteAdminView === 'agentPermissions'"
    :label="msg.nav.permissionGroups"
    @activate="openAdmin('agentPermissions')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
    </template>
  </ConsoleSideNavLink>
  <ConsoleSideNavLink
    :active="activeRouteView === 'workspaces'"
    :label="msg.nav.workspaces"
    @activate="openSideNavDirectory('workspaces'); switchView('workspaces')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><rect x="9" y="2" width="6" height="6" rx="1.5"/><rect x="3" y="16" width="6" height="6" rx="1.5"/><rect x="15" y="16" width="6" height="6" rx="1.5"/><path d="M12 8v4"/><path d="M6 16v-4h12v4"/></svg>
    </template>
    <template v-if="activeRouteView === 'workspaces' && !showSideNavDirectory" #trail>
      <span class="side-link-directory-reveal" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </span>
    </template>
  </ConsoleSideNavLink>
  <ConsoleSideNavLink
    :active="activeRouteView === 'sources'"
    :label="msg.nav.sources"
    @activate="openSideNavDirectory('sources'); switchView('sources')"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="side-link-icon"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
    </template>
    <template v-if="activeRouteView === 'sources' && !showSideNavDirectory" #trail>
      <span class="side-link-directory-reveal" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </span>
    </template>
  </ConsoleSideNavLink>
</template>
