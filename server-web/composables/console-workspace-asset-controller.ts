import { computed, reactive, ref, type Ref } from "vue";
import { errorMessage } from "../lib/errors";
import * as workspacesClient from "../lib/workspaces-client";
import type { WorkspaceConsolePayload } from "../lib/workspaces-client";

type WorkspaceAssetControllerOptions = {
  selectedId: Ref<string>;
  localError: Ref<string>;
  setBusy: (key: string) => void;
  clearBusy: () => void;
};

function itemsFrom(payload: WorkspaceConsolePayload | null) {
  const downstream = payload?.downstream as WorkspaceConsolePayload | undefined;
  const items = downstream?.items ?? payload?.items ?? [];
  return Array.isArray(items) ? items : [];
}

export function useWorkspaceAssetController(options: WorkspaceAssetControllerOptions) {
  const workspaceAssetData = ref<WorkspaceConsolePayload | null>(null);
  const workspaceAssetDetail = ref<WorkspaceConsolePayload | null>(null);
  const workspaceAssetResult = ref<WorkspaceConsolePayload | null>(null);
  const workspaceAssetForm = reactive({
    targetKind: "workspaceFolder",
    assetKind: "file",
    canonicalState: "",
    assetRef: "",
    path: "files/unified-asset.txt",
    provider: "icloud",
    driveRef: "",
    repositoryRef: "",
    branch: "main",
    content: "Unified asset console submission\n",
  });

  const workspaceAssetItems = computed(() => itemsFrom(workspaceAssetData.value));
  const selectedWorkspaceAsset = computed(() => {
    const detail = workspaceAssetDetail.value?.downstream as WorkspaceConsolePayload | undefined;
    return detail?.assetRef ? detail : null;
  });

  function resetWorkspaceAssetState() {
    workspaceAssetData.value = null;
    workspaceAssetDetail.value = null;
    workspaceAssetResult.value = null;
    workspaceAssetForm.assetRef = "";
  }

  async function refreshWorkspaceAssets() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:assets-list");
    options.localError.value = "";
    try {
      workspaceAssetData.value = await workspacesClient.listWorkspaceAssets({
        workspaceId: options.selectedId.value,
        targetKind: workspaceAssetForm.targetKind || undefined,
        assetKind: workspaceAssetForm.assetKind || undefined,
        canonicalState: workspaceAssetForm.canonicalState || undefined,
        limit: 100,
      });
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function openWorkspaceAssets() {
    workspaceAssetResult.value = null;
    await refreshWorkspaceAssets();
    return "assets" as const;
  }

  async function selectWorkspaceAsset(assetRef: string) {
    if (!options.selectedId.value || !assetRef) return;
    options.setBusy("ws:asset-read");
    options.localError.value = "";
    try {
      workspaceAssetForm.assetRef = assetRef;
      workspaceAssetDetail.value = await workspacesClient.readWorkspaceAsset({
        workspaceId: options.selectedId.value,
        assetRef,
      });
      workspaceAssetResult.value = workspaceAssetDetail.value;
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function submitWorkspaceAsset() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:asset-submit");
    options.localError.value = "";
    try {
      const target: Record<string, unknown> = {
        kind: workspaceAssetForm.targetKind,
        path: workspaceAssetForm.path,
      };
      if (workspaceAssetForm.targetKind === "cloudDrive") {
        target.provider = workspaceAssetForm.driveRef ? undefined : workspaceAssetForm.provider;
        target.driveRef = workspaceAssetForm.driveRef || undefined;
      }
      if (workspaceAssetForm.targetKind === "repository" || workspaceAssetForm.targetKind === "codeReview") {
        target.repositoryRef = workspaceAssetForm.repositoryRef;
        target.branch = workspaceAssetForm.branch;
      }
      const submitted = await workspacesClient.submitWorkspaceAsset({
        workspaceId: options.selectedId.value,
        submitKind: workspaceAssetForm.assetKind,
        target,
        content: {
          content: workspaceAssetForm.content,
        },
        policy: {
          dataClass: workspaceAssetForm.assetKind === "codeChange" ? "codeChange" : "internal",
        },
        overwrite: true,
      });
      workspaceAssetResult.value = submitted;
      const assetRef = String(submitted.workspaceAsset?.assetRef || submitted.assetRef || "");
      await refreshWorkspaceAssets();
      if (assetRef) {
        await selectWorkspaceAsset(assetRef);
      }
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function loadWorkspaceAssetReceipts() {
    if (!options.selectedId.value || !workspaceAssetForm.assetRef) return;
    options.setBusy("ws:asset-receipts");
    options.localError.value = "";
    try {
      workspaceAssetResult.value = await workspacesClient.getWorkspaceAssetReceipts({
        workspaceId: options.selectedId.value,
        assetRef: workspaceAssetForm.assetRef,
        limit: 100,
      });
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  async function backfillWorkspaceAssets() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:asset-backfill");
    options.localError.value = "";
    try {
      workspaceAssetResult.value = await workspacesClient.backfillWorkspaceAssets({
        workspaceId: options.selectedId.value,
        limit: 500,
      });
      await refreshWorkspaceAssets();
    } catch (e: unknown) {
      options.localError.value = errorMessage(e);
    } finally {
      options.clearBusy();
    }
  }

  return {
    workspaceAssetData,
    workspaceAssetDetail,
    workspaceAssetResult,
    workspaceAssetForm,
    workspaceAssetItems,
    selectedWorkspaceAsset,
    resetWorkspaceAssetState,
    openWorkspaceAssets,
    refreshWorkspaceAssets,
    selectWorkspaceAsset,
    submitWorkspaceAsset,
    loadWorkspaceAssetReceipts,
    backfillWorkspaceAssets,
  };
}
