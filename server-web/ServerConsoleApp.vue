<script setup lang="ts">
import { computed, ref, unref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AgentEvidencePreviewDialog from "./components/shell/AgentEvidencePreviewDialog.vue";
import ConsoleDrawer from "./components/shell/ConsoleDrawer.vue";
import ConsoleSideNav from "./components/shell/ConsoleSideNav.vue";
import ConsoleSideNavDirectory from "./components/shell/side-nav/ConsoleSideNavDirectory.vue";
import ConsoleTopbar from "./components/shell/ConsoleTopbar.vue";
import ServerPathPickerDialog from "./components/shell/ServerPathPickerDialog.vue";
import { createConsoleSideNavContext, provideConsoleSideNavContext } from "./composables/consoleSideNavContext";
import { provideServerConsoleShell } from "./composables/serverConsoleShellContext";
import { useServerConsoleShell } from "./composables/useServerConsoleShell";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "./i18n/console";

const shell = useServerConsoleShell();
provideServerConsoleShell(shell);
const sideNav = createConsoleSideNavContext(shell);
provideConsoleSideNavContext(sideNav);
const route = useRoute();
const router = useRouter();
const routerReady = ref(false);
void router.isReady().then(() => {
  routerReady.value = true;
});

const {
  authBootstrapping,
  error,
  errorNeedsKnowledgeImportAction,
  isAuthenticated,
  jumpToKnowledgeFileImport,
  msg,
  sideNavCollapsed,
} = shell;
const { activeSideNavDirectory, showSideNavDirectory, sideNavWidth, sideNavDirectoryWidth } = sideNav;
const dashboardShellStyle = computed(() => ({
  "--sidebar-width": `${sideNavWidth.value}px`,
}));
const locale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
const shellMessages = computed(() => unref(msg));
const localizedErrorTitle = computed(() => localizeConsoleText(String(shellMessages.value?.error || ""), locale.value));
const localizedError = computed(() => localizeConsoleText(String(unref(error) || ""), locale.value));
const localizedKnowledgeImportAction = computed(() =>
  localizeConsoleText(String(shellMessages.value?.actions?.goImport || ""), locale.value),
);
const isLoginRoute = computed(() => route.path === "/login");
const showPageDirectory = computed(() => isAuthenticated.value && !!activeSideNavDirectory.value && !isLoginRoute.value);

function normalizeLoginRedirect(value: unknown) {
  const redirect = Array.isArray(value) ? value[0] : value;
  const path = typeof redirect === "string" ? redirect : "";
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) {
    return "/";
  }
  return path;
}

watch(
  [routerReady, authBootstrapping, isAuthenticated, () => route.fullPath],
  () => {
    if (!routerReady.value) {
      return;
    }
    if (authBootstrapping.value) {
      return;
    }
    if (!isAuthenticated.value && !isLoginRoute.value) {
      void router.replace({
        path: "/login",
        query: { redirect: route.fullPath },
      });
      return;
    }
    if (isAuthenticated.value && isLoginRoute.value) {
      void router.replace(normalizeLoginRedirect(route.query.redirect));
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="dashboard-shell"
    :class="{
      'is-locked': !isAuthenticated,
      'is-collapsed': isAuthenticated && sideNavCollapsed,
    }"
    :style="dashboardShellStyle"
  >
    <ConsoleSideNav />

    <main class="dashboard-canvas">
      <ConsoleTopbar />

      <div
        class="dashboard-main-region"
        :class="{
          'has-page-directory': showPageDirectory,
          'is-directory-collapsed': showPageDirectory && !showSideNavDirectory,
        }"
        :style="showPageDirectory ? { '--side-nav-directory-width': `${sideNavDirectoryWidth}px` } : undefined"
      >
        <ConsoleSideNavDirectory v-if="showPageDirectory" />

        <div class="view-content">
          <div v-if="error" class="status-strip danger">
            <strong>{{ localizedErrorTitle }}</strong>
            <span>{{ localizedError }}</span>
            <button
              v-if="errorNeedsKnowledgeImportAction"
              class="status-strip-action"
              type="button"
              @click="jumpToKnowledgeFileImport"
            >
              {{ localizedKnowledgeImportAction }}
            </button>
          </div>

          <RouterView v-if="isAuthenticated || isLoginRoute" />
        </div>
      </div>
    </main>

    <ConsoleDrawer />
    <AgentEvidencePreviewDialog />
    <ServerPathPickerDialog />
  </div>
</template>
