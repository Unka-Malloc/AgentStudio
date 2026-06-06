import { computed, reactive, ref, type Ref } from "vue";
import type { CloudDriveExposureForm } from "../types/workspaces";
import { errorMessage } from "../lib/errors";
import * as workspacesClient from "../lib/workspaces-client";

type WorkspaceCloudDriveControllerOptions = {
  selectedId: Ref<string>;
  localError: Ref<string>;
  setBusy: (key: string) => void;
  clearBusy: () => void;
};

function splitCsv(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function useWorkspaceCloudDriveController(options: WorkspaceCloudDriveControllerOptions) {
  const cloudDriveData = ref<any>(null);
  const cloudDriveResult = ref<any>(null);
  const cloudDriveForm = reactive({
    provider: "icloud",
    rootPath: "",
    driveRef: "",
    clientId: "owner",
    managedFolderRoot: ".pact-data",
    publicFolder: "public",
    allowedClients: "owner, codex",
    advancedMode: false,
    exposedDirectories: [] as CloudDriveExposureForm[],
    path: "default",
    uploadPath: "default/pact-console-upload.txt",
    uploadContent: "Pact cloud drive console upload\n",
    targetPath: "cloud-drive",
  });

  const cloudDriveConnectionOptions = computed(() => {
    const connections = Array.isArray(cloudDriveData.value?.connections) ? cloudDriveData.value.connections : [];
    return connections.map((drive: any) => ({
      value: String(drive.driveRef || ""),
      label: `${drive.label || drive.provider} · ${String(drive.driveRef || "").slice(0, 18)}`,
    })).filter((item: { value: string }) => item.value);
  });

  function cloudDriveAllowedClients() {
    const clients = splitCsv(cloudDriveForm.allowedClients);
    return clients.length ? clients : ["owner"];
  }

  function addCloudDriveExposure() {
    const index = cloudDriveForm.exposedDirectories.length + 1;
    cloudDriveForm.exposedDirectories.push({
      id: `exposure-${Date.now()}-${index}`,
      name: `共享目录 ${index}`,
      path: "",
      permissionMode: "all",
      subjects: "",
      showPermissions: false,
    });
  }

  function removeCloudDriveExposure(index: number) {
    cloudDriveForm.exposedDirectories.splice(index, 1);
  }

  function cloudDriveExposurePayload() {
    if (!cloudDriveForm.advancedMode) return [];
    return cloudDriveForm.exposedDirectories
      .filter((item) => item.path.trim())
      .map((item) => ({
        name: item.name.trim() || item.path.trim(),
        drivePath: item.path.trim(),
        spaceKind: "advancedExposure",
        writable: false,
        accessPolicy: {
          mode: item.permissionMode,
          subjects: item.permissionMode === "all" ? [] : splitCsv(item.subjects),
        },
      }));
  }

  function cloudDriveQuery(extra: Record<string, unknown> = {}) {
    return {
      workspaceId: options.selectedId.value || "default",
      ...(cloudDriveForm.driveRef ? { driveRef: cloudDriveForm.driveRef } : { provider: cloudDriveForm.provider }),
      ...(cloudDriveForm.clientId.trim() ? { clientId: cloudDriveForm.clientId.trim() } : {}),
      ...extra,
    };
  }

  async function refreshCloudDriveStatus() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-status");
    options.localError.value = "";
    try {
      cloudDriveData.value = await workspacesClient.getWorkspaceCloudDriveStatus(options.selectedId.value);
      cloudDriveResult.value = cloudDriveData.value;
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function connectCloudDrive() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-connect");
    options.localError.value = "";
    try {
      const provider = cloudDriveForm.provider;
      const payload: Record<string, unknown> = {
        workspaceId: options.selectedId.value,
        provider,
        mode: provider === "icloud" ? "local" : "contract",
        managedFolder: true,
        managedFolderRoot: cloudDriveForm.managedFolderRoot.trim() || ".pact-data",
        publicFolder: cloudDriveForm.publicFolder.trim() || "public",
        allowedClients: cloudDriveAllowedClients(),
        defaultClient: cloudDriveForm.clientId.trim() || cloudDriveAllowedClients()[0] || "owner",
        directoryMappings: cloudDriveExposurePayload(),
      };
      if (provider === "icloud" && cloudDriveForm.rootPath.trim()) payload.rootPath = cloudDriveForm.rootPath.trim();
      if (provider !== "icloud") payload.secretRef = `secret://pact/drive/${provider}-oauth`;
      const connected = await workspacesClient.connectWorkspaceCloudDrive(payload);
      cloudDriveForm.driveRef = connected.drive?.driveRef || cloudDriveForm.driveRef;
      await refreshCloudDriveStatus();
      cloudDriveResult.value = connected;
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function listCloudDriveItems() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-list");
    options.localError.value = "";
    try {
      cloudDriveResult.value = await workspacesClient.listWorkspaceCloudDriveItems(cloudDriveQuery({
        path: cloudDriveForm.path,
        recursive: true,
        includeHash: true,
        limit: 200,
      }));
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function downloadCloudDriveFile() {
    if (!options.selectedId.value || !cloudDriveForm.path.trim()) return;
    options.setBusy("ws:drive-download");
    options.localError.value = "";
    try {
      cloudDriveResult.value = await workspacesClient.downloadWorkspaceCloudDriveFile(cloudDriveQuery({
        path: cloudDriveForm.path,
        includeText: true,
      }));
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function uploadCloudDriveFile() {
    if (!options.selectedId.value || !cloudDriveForm.uploadPath.trim()) return;
    options.setBusy("ws:drive-upload");
    options.localError.value = "";
    try {
      const uploaded = await workspacesClient.uploadWorkspaceCloudDriveFile({
        workspaceId: options.selectedId.value,
        provider: cloudDriveForm.driveRef ? undefined : cloudDriveForm.provider,
        driveRef: cloudDriveForm.driveRef || undefined,
        clientId: cloudDriveForm.clientId.trim() || undefined,
        path: cloudDriveForm.uploadPath,
        content: cloudDriveForm.uploadContent,
        overwrite: true,
      });
      cloudDriveForm.path = cloudDriveForm.uploadPath;
      await refreshCloudDriveStatus();
      cloudDriveResult.value = uploaded;
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function planCloudDriveSync() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-sync-plan");
    options.localError.value = "";
    try {
      cloudDriveResult.value = await workspacesClient.planWorkspaceCloudDriveSync({
        workspaceId: options.selectedId.value,
        provider: cloudDriveForm.driveRef ? undefined : cloudDriveForm.provider,
        driveRef: cloudDriveForm.driveRef || undefined,
        clientId: cloudDriveForm.clientId.trim() || undefined,
        path: cloudDriveForm.path || "",
        targetPath: cloudDriveForm.targetPath || "cloud-drive",
        direction: "import_to_sharedspace",
      });
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function applyCloudDriveSync() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-sync-apply");
    options.localError.value = "";
    try {
      cloudDriveResult.value = await workspacesClient.applyWorkspaceCloudDriveSync({
        workspaceId: options.selectedId.value,
        provider: cloudDriveForm.driveRef ? undefined : cloudDriveForm.provider,
        driveRef: cloudDriveForm.driveRef || undefined,
        clientId: cloudDriveForm.clientId.trim() || undefined,
        path: cloudDriveForm.path || "",
        targetPath: cloudDriveForm.targetPath || "cloud-drive",
        direction: "import_to_sharedspace",
        confirm: true,
      });
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function listCloudDrivePermissions() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:drive-permissions");
    options.localError.value = "";
    try {
      cloudDriveResult.value = await workspacesClient.listWorkspaceCloudDrivePermissions(cloudDriveQuery({
        path: cloudDriveForm.path || "",
      }));
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  function openCloudDrive() {
    cloudDriveResult.value = null;
    if (!cloudDriveForm.driveRef && cloudDriveConnectionOptions.value.length > 0) {
      cloudDriveForm.driveRef = cloudDriveConnectionOptions.value[0].value;
    }
    return "cloudDrive" as const;
  }

  return {
    cloudDriveData,
    cloudDriveResult,
    cloudDriveForm,
    cloudDriveConnectionOptions,
    cloudDriveAllowedClients,
    addCloudDriveExposure,
    removeCloudDriveExposure,
    refreshCloudDriveStatus,
    connectCloudDrive,
    listCloudDriveItems,
    downloadCloudDriveFile,
    uploadCloudDriveFile,
    planCloudDriveSync,
    applyCloudDriveSync,
    listCloudDrivePermissions,
    openCloudDrive,
  };
}
