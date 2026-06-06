<script setup lang="ts">
import SourcesActionBar from "../components/sources/SourcesActionBar.vue";
import SourcesAddDataSourceDialog from "../components/sources/SourcesAddDataSourceDialog.vue";
import SourcesGrid from "../components/sources/SourcesGrid.vue";
import { useServerConsoleShellContext } from "../composables/serverConsoleShellContext";
import { useSourcesViewController } from "../composables/sources-view-controller";
import { createSourcesViewContext, provideSourcesView } from "../composables/sourcesViewContext";

const sourcesView = createSourcesViewContext(useServerConsoleShellContext());
provideSourcesView(sourcesView);

const {
  addDataSourceDialogOpen,
  closeAddDataSourceDialog,
  openAddDataSourceDialog,
  selectedDataSourceType,
  submitSelectedDataSource,
} = useSourcesViewController(sourcesView);
</script>

<template>
  <div class="sources-view-shell">
    <SourcesActionBar @add="openAddDataSourceDialog" />
    <SourcesGrid />
    <SourcesAddDataSourceDialog
      :open="addDataSourceDialogOpen"
      v-model:selected-type="selectedDataSourceType"
      @close="closeAddDataSourceDialog"
      @submit="submitSelectedDataSource"
    />
  </div>
</template>
