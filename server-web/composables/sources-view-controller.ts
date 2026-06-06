import { onMounted, onUnmounted, ref } from "vue";
import { createConsoleIntervalController } from "./console-timer-controller";
import type { SourcesViewContext } from "./sourcesViewContext";

export type DataSourceType = "" | "localDirectory" | "client";

export function useSourcesViewController(context: SourcesViewContext) {
  const sourcePolling = createConsoleIntervalController();
  const addDataSourceDialogOpen = ref(false);
  const selectedDataSourceType = ref<DataSourceType>("");

  function openAddDataSourceDialog() {
    selectedDataSourceType.value = "";
    addDataSourceDialogOpen.value = true;
  }

  function closeAddDataSourceDialog() {
    addDataSourceDialogOpen.value = false;
    selectedDataSourceType.value = "";
  }

  async function submitSelectedDataSource() {
    if (selectedDataSourceType.value === "localDirectory") {
      const added = await context.addKnowledgeSource();
      if (added) {
        closeAddDataSourceDialog();
      }
      return;
    }
    if (selectedDataSourceType.value === "client") {
      closeAddDataSourceDialog();
      context.openAdmin("clients");
    }
  }

  onMounted(() => {
    void context.refreshKnowledgeSources();
    sourcePolling.start(() => {
      void context.refreshKnowledgeSources();
    }, 3000);
  });

  onUnmounted(() => {
    sourcePolling.stop();
  });

  return {
    addDataSourceDialogOpen,
    closeAddDataSourceDialog,
    openAddDataSourceDialog,
    selectedDataSourceType,
    submitSelectedDataSource,
  };
}
