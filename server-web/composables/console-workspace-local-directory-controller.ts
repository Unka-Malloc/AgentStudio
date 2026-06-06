import { reactive, ref, type Ref } from "vue";
import { errorMessage } from "../lib/errors";
import * as workspacesClient from "../lib/workspaces-client";
import type {
  WorkspaceConsolePayload,
  WorkspaceLocalDirMount,
} from "../lib/workspaces-client";

type WorkspaceLocalDirectoryControllerOptions = {
  selectedId: Ref<string>;
  localError: Ref<string>;
  setBusy: (key: string) => void;
  clearBusy: () => void;
  reloadWorkspaceChain: () => Promise<void>;
  showListPanel: () => void;
};

export function useWorkspaceLocalDirectoryController(options: WorkspaceLocalDirectoryControllerOptions) {
  const localDirMountData = ref<WorkspaceConsolePayload | null>(null);
  const localDirForm = reactive({
    sourcePath: "",
    targetPath: "mirror",
    deleteExtraneous: true,
    maxFiles: 2000,
  });

  function setLocalDirectoryMountData(value: WorkspaceConsolePayload | null) {
    localDirMountData.value = value;
  }

  function resetLocalDirectoryState() {
    localDirMountData.value = null;
  }

  function openLocalDir() {
    localDirForm.sourcePath = "";
    localDirForm.targetPath = "mirror";
    localDirForm.deleteExtraneous = true;
    localDirForm.maxFiles = 2000;
    return "localDir" as const;
  }

  async function connectLocalDirectory() {
    if (!options.selectedId.value || !localDirForm.sourcePath.trim()) return;
    options.setBusy("ws:local-dir-connect");
    options.localError.value = "";
    try {
      await workspacesClient.connectWorkspaceLocalDirectory(options.selectedId.value, {
        sourcePath: localDirForm.sourcePath,
        targetPath: localDirForm.targetPath || "",
        deleteExtraneous: localDirForm.deleteExtraneous,
        maxFiles: localDirForm.maxFiles,
      });
      localDirForm.sourcePath = "";
      await options.reloadWorkspaceChain();
      options.showListPanel();
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function syncLocalDirectory(mount: WorkspaceLocalDirMount) {
    if (!options.selectedId.value || !mount?.mountRef) return;
    options.setBusy(`ws:local-dir-sync:${mount.mountRef}`);
    options.localError.value = "";
    try {
      await workspacesClient.syncWorkspaceLocalDirectory(options.selectedId.value, {
        mountRef: mount.mountRef,
        targetPath: mount.targetPath || "",
        deleteExtraneous: true,
      });
      await options.reloadWorkspaceChain();
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  return {
    localDirMountData,
    localDirForm,
    setLocalDirectoryMountData,
    resetLocalDirectoryState,
    openLocalDir,
    connectLocalDirectory,
    syncLocalDirectory,
  };
}
