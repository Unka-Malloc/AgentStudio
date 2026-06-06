<script setup lang="ts">
import AgentEvidencePreviewDialog from "./components/shell/AgentEvidencePreviewDialog.vue";
import ConsoleAuthGate from "./components/shell/ConsoleAuthGate.vue";
import ConsoleDrawer from "./components/shell/ConsoleDrawer.vue";
import ConsoleSideNav from "./components/shell/ConsoleSideNav.vue";
import ConsoleTopbar from "./components/shell/ConsoleTopbar.vue";
import ServerPathPickerDialog from "./components/shell/ServerPathPickerDialog.vue";
import { provideServerConsoleShell } from "./composables/serverConsoleShellContext";
import { useServerConsoleShell } from "./composables/useServerConsoleShell";

const shell = useServerConsoleShell();
provideServerConsoleShell(shell);

const {
  authBootstrapping,
  error,
  errorNeedsKnowledgeImportAction,
  isAuthenticated,
  jumpToKnowledgeFileImport,
  msg,
} = shell;
</script>

<template>
  <div class="dashboard-shell" :class="{ 'is-locked': !isAuthenticated }">
    <ConsoleSideNav />

    <main class="dashboard-canvas">
      <ConsoleTopbar />

      <div class="view-content">
        <div v-if="error" class="status-strip danger">
          <strong>{{ msg.error }}</strong>
          <span>{{ error }}</span>
          <button
            v-if="errorNeedsKnowledgeImportAction"
            class="status-strip-action"
            type="button"
            @click="jumpToKnowledgeFileImport"
          >
            {{ msg.actions.goImport }}
          </button>
        </div>

        <ConsoleAuthGate v-if="authBootstrapping || !isAuthenticated" />
        <RouterView v-else />
      </div>
    </main>

    <ConsoleDrawer />
    <AgentEvidencePreviewDialog />
    <ServerPathPickerDialog />
  </div>
</template>
