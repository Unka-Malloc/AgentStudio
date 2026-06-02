import { reactive, ref, type Ref } from "vue";
import type { WsWorkspace } from "../types/workspaces";
import { errorMessage } from "../lib/errors";
import * as workspacesClient from "../lib/workspaces-client";

export type WorkspacePanel =
  | "list"
  | "create"
  | "profile"
  | "parent"
  | "share"
  | "localDir"
  | "cloudDrive"
  | "codespace";

export type WorkspaceManagementControllerOptions = {
  clearBusy: () => void;
  load: () => Promise<void>;
  loadChain: (id: string) => Promise<void>;
  localError: Ref<string>;
  panel: Ref<WorkspacePanel>;
  selectedId: Ref<string>;
  setBusy: (key: string) => void;
};

export function useWorkspaceManagementController(
  options: WorkspaceManagementControllerOptions,
) {
  const createForm = reactive({ title: "", objective: "", parentWorkspaceId: "" });
  const profileForm = reactive({
    contextProfileId: "",
    toolGrantId: "",
    modelAlias: "",
    includeSourceIds: "",
    excludeSourceIds: "",
    ownedSourceIds: "",
  });
  const parentForm = reactive({ parentWorkspaceId: "" });
  const shareForm = reactive({ targetWorkspaceId: "", action: "share" as "share" | "unshare" });
  const showDeleteModal = ref(false);
  const deleteFolderChecked = ref(false);

  async function createWorkspace() {
    options.setBusy("ws:create");
    options.localError.value = "";
    try {
      await workspacesClient.createWorkspace({ ...createForm });
      Object.assign(createForm, { title: "", objective: "", parentWorkspaceId: "" });
      options.panel.value = "list";
      await options.load();
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function deleteWorkspace() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:delete");
    options.localError.value = "";
    try {
      await workspacesClient.deleteWorkspace(options.selectedId.value, deleteFolderChecked.value);
      showDeleteModal.value = false;
      deleteFolderChecked.value = false;
      options.selectedId.value = "";
      options.panel.value = "list";
      await options.load();
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function setParent() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:parent");
    options.localError.value = "";
    try {
      await workspacesClient.setWorkspaceParent(options.selectedId.value, parentForm.parentWorkspaceId || null);
      options.panel.value = "list";
      await options.load();
      await options.loadChain(options.selectedId.value);
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function hotSwapProfile() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:profile");
    options.localError.value = "";
    try {
      const includeIds = profileForm.includeSourceIds.split(",").map((s) => s.trim()).filter(Boolean);
      const excludeIds = profileForm.excludeSourceIds.split(",").map((s) => s.trim()).filter(Boolean);
      const ownedIds = profileForm.ownedSourceIds.split(",").map((s) => s.trim()).filter(Boolean);
      const patch: Record<string, unknown> = {
        knowledgeScope: { includeSourceIds: includeIds, excludeSourceIds: excludeIds },
      };
      if (profileForm.contextProfileId) patch.contextProfileId = profileForm.contextProfileId;
      if (profileForm.toolGrantId) patch.toolGrantId = profileForm.toolGrantId;
      if (profileForm.modelAlias) patch.modelAlias = profileForm.modelAlias;
      await workspacesClient.updateWorkspaceProfile(options.selectedId.value, patch);
      if (ownedIds.length > 0 || profileForm.ownedSourceIds.trim() === "") {
        await workspacesClient.setWorkspaceSources(options.selectedId.value, ownedIds);
      }
      options.panel.value = "list";
      await options.load();
      await options.loadChain(options.selectedId.value);
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function shareOrUnshare() {
    if (!options.selectedId.value || !shareForm.targetWorkspaceId) return;
    options.setBusy("ws:share");
    options.localError.value = "";
    try {
      await workspacesClient.updateWorkspaceShare(
        options.selectedId.value,
        shareForm.action,
        shareForm.targetWorkspaceId,
      );
      options.panel.value = "list";
      await options.load();
      await options.loadChain(options.selectedId.value);
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  function openProfile(ws: WsWorkspace) {
    const scope = (ws.profile?.knowledgeScope ?? {}) as {
      includeSourceIds?: string[];
      excludeSourceIds?: string[];
    };
    Object.assign(profileForm, {
      contextProfileId: ws.profile?.contextProfileId ?? "",
      toolGrantId: ws.profile?.toolGrantId ?? "",
      modelAlias: ws.profile?.modelAlias ?? "",
      includeSourceIds: (scope.includeSourceIds ?? []).join(", "),
      excludeSourceIds: (scope.excludeSourceIds ?? []).join(", "),
      ownedSourceIds: ws.ownedSourceIds.join(", "),
    });
    options.panel.value = "profile";
  }

  function openParent(ws: WsWorkspace) {
    parentForm.parentWorkspaceId = ws.parentWorkspaceId ?? "";
    options.panel.value = "parent";
  }

  return {
    createForm,
    createWorkspace,
    deleteFolderChecked,
    deleteWorkspace,
    hotSwapProfile,
    openParent,
    openProfile,
    parentForm,
    profileForm,
    setParent,
    shareForm,
    shareOrUnshare,
    showDeleteModal,
  };
}
