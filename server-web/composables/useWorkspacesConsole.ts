import { computed, ref, watch, type Ref } from 'vue';
import { usePageRefreshHandler } from './usePageRefresh';
import type {
  WsSession,
  WsWorkspace,
} from '../types/workspaces';
import { errorMessage } from '../lib/errors';
import * as workspacesClient from '../lib/workspaces-client';
import {
  confirmConsoleAction,
  copyConsoleTextWithFeedback,
} from './console-browser-effects';
import { useWorkspaceCloudDriveController } from './console-workspace-cloud-drive-controller';
import { useWorkspaceAssetController } from './console-workspace-asset-controller';
import { useWorkspaceCheckpointController } from './console-workspace-checkpoint-controller';
import { useWorkspaceCodespaceController } from './console-workspace-codespace-controller';
import { formatCompactDate } from './console-format-utils';
import { useWorkspaceLocalDirectoryController } from './console-workspace-local-directory-controller';
import {
  useWorkspaceManagementController,
  type WorkspacePanel,
} from './console-workspace-management-controller';
import { useWorkspaceSessionController } from './console-workspace-session-controller';

type WorkspacesConsoleOptions = {
  autoload?: boolean;
  globalBusyKey?: Ref<string>;
};

export function useWorkspacesConsole(options: WorkspacesConsoleOptions = {}) {
  const globalBusyKey = options.globalBusyKey ?? ref('');
  const localBusyKey = ref('');
  const busyKey = computed(() => localBusyKey.value || globalBusyKey.value);

  // ─── State ────────────────────────────────────────────────────────────────────

  const workspaces        = ref<WsWorkspace[]>([]);
  const sessions          = ref<WsSession[]>([]);
  const selectedId        = ref('');
  const expandedWorkspaceId = ref('');
  const chainData         = ref<any>(null);
  const contextData       = ref<any>(null);
  const workspaceFilesData = ref<any>(null);
  const localError        = ref('');
  const panel             = ref<WorkspacePanel>('list');

  const {
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
    openCloudDrive: prepareCloudDrivePanel,
  } = useWorkspaceCloudDriveController({
    selectedId,
    localError,
    setBusy,
    clearBusy,
  });

  const {
    workspaceAssetData,
    workspaceAssetDetail,
    workspaceAssetResult,
    workspaceAssetForm,
    workspaceAssetItems,
    selectedWorkspaceAsset,
    resetWorkspaceAssetState,
    openWorkspaceAssets: prepareWorkspaceAssetsPanel,
    refreshWorkspaceAssets,
    selectWorkspaceAsset,
    submitWorkspaceAsset,
    loadWorkspaceAssetReceipts,
    backfillWorkspaceAssets,
  } = useWorkspaceAssetController({
    selectedId,
    localError,
    setBusy,
    clearBusy,
  });

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const selected = computed(() => workspaces.value.find(w => w.workspaceId === selectedId.value) ?? null);

  const {
    workspaceCheckpointTrees,
    workspaceCheckpointDetail,
    workspaceCheckpointPreview,
    workspaceCheckpointError,
    selectedCheckpointTreeId,
    selectedCheckpointNodeId,
    workspaceCheckpointNodes,
    workspaceCheckpointPreviewRestore,
    resetWorkspaceCheckpoints,
    loadWorkspaceCheckpoints,
    loadWorkspaceCheckpointTree,
    previewWorkspaceCheckpointRestore,
    restoreWorkspaceCheckpoint,
    checkpointNodeFileCount,
    checkpointNodeBasePath,
  } = useWorkspaceCheckpointController({
    selectedId,
    localError,
    setBusy,
    clearBusy,
    confirmAction: confirmConsoleAction,
    reloadWorkspaceChain,
  });

  const {
    localDirMountData,
    localDirForm,
    setLocalDirectoryMountData,
    resetLocalDirectoryState,
    openLocalDir: prepareLocalDirPanel,
    connectLocalDirectory,
    syncLocalDirectory,
  } = useWorkspaceLocalDirectoryController({
    selectedId,
    localError,
    setBusy,
    clearBusy,
    reloadWorkspaceChain,
    showListPanel,
  });

  const {
    codespaceData,
    codespaceResult,
    codespaceForm,
    setCodespaceData,
    resetCodespaceState,
    openCodespace: prepareCodespacePanel,
    inspectCodespaceStatus,
    prepareCodespaceChange,
    uploadCodespaceChange,
  } = useWorkspaceCodespaceController({
    selectedId,
    selectedWorkspaceTitle: () => selected.value?.title || "",
    localError,
    setBusy,
    clearBusy,
  });

  const {
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
  } = useWorkspaceManagementController({
    selectedId,
    panel,
    localError,
    setBusy,
    clearBusy,
    load,
    loadChain,
  });

  const {
    selectedSessionId,
    selectedSession,
    sessionContextData,
    sessionItems,
    selectSession,
    forkSession,
  } = useWorkspaceSessionController({
    sessions,
    selectedId,
    busyKey,
    localError,
    formatCompactDate,
    setBusy,
    clearBusy,
    reloadWorkspaceList: load,
  });

  function workspaceExpansionSlotId(ws: WsWorkspace) {
    return `workspace-expansion-${ws.workspaceId}`;
  }

  function isWorkspaceExpanded(ws: WsWorkspace) {
    return panel.value === 'list' && expandedWorkspaceId.value === ws.workspaceId;
  }

  function toggleWorkspaceCard(ws: WsWorkspace) {
    const shouldCollapse = isWorkspaceExpanded(ws);
    selectedId.value = ws.workspaceId;
    panel.value = 'list';
    expandedWorkspaceId.value = shouldCollapse ? '' : ws.workspaceId;
  }

  const workspaceOptions = computed(() =>
    workspaces.value.map(w => ({ value: w.workspaceId, label: w.title || w.workspaceId.slice(0, 12) }))
  );

  function statusTone(status: string) {
    return status === 'active' ? 'success' : status === 'archived' ? 'neutral' : 'info';
  }

  // ─── Workspace workflows ─────────────────────────────────────────────────────

  async function load() {
    setBusy('ws:load');
    localError.value = '';
    try {
      const [workspaceData, sessionData] = await Promise.all([
        workspacesClient.listWorkspaceSummaries(),
        workspacesClient.listWorkspaceSessions(),
      ]);
      workspaces.value = workspaceData.workspaces ?? [];
      sessions.value = sessionData.sessions ?? [];
    } catch (e: unknown) { localError.value = errorMessage(e); }
    finally { clearBusy(); }
  }

  async function loadChain(id: string) {
    chainData.value = null; contextData.value = null; workspaceFilesData.value = null; cloudDriveData.value = null; cloudDriveResult.value = null;
    resetWorkspaceAssetState();
    resetLocalDirectoryState();
    resetCodespaceState();
    resetWorkspaceCheckpoints();
    try {
      const bundle = await workspacesClient.getWorkspaceChainBundle(id);
      chainData.value = bundle.chain;
      contextData.value = bundle.context;
      workspaceFilesData.value = bundle.files;
      setLocalDirectoryMountData(bundle.localDirs);
      cloudDriveData.value = bundle.cloudDrives;
      setCodespaceData(bundle.codespace);
      await loadWorkspaceCheckpoints(id);
    } catch (e: unknown) { localError.value = errorMessage(e); }
  }

  async function reloadWorkspaceChain() {
    if (selectedId.value) {
      await loadChain(selectedId.value);
    }
  }

  function showListPanel() {
    panel.value = 'list';
  }

  watch(selectedId, (id) => {
    if (id) {
      if (panel.value === 'list') expandedWorkspaceId.value = id;
      loadChain(id);
    } else {
      expandedWorkspaceId.value = '';
    }
  });

  watch(panel, (next) => {
    if (next === 'list') {
      if (selectedId.value) expandedWorkspaceId.value = selectedId.value;
    } else {
      expandedWorkspaceId.value = '';
    }
  });

  function openLocalDir() {
    panel.value = prepareLocalDirPanel();
  }

  function openCloudDrive() {
    panel.value = prepareCloudDrivePanel();
  }

  function openCodespace() {
    panel.value = prepareCodespacePanel();
  }

  async function openWorkspaceAssets() {
    panel.value = await prepareWorkspaceAssetsPanel();
  }

  // busyKey helpers (work on the existing string-compat ref)
  function setBusy(k: string)  { localBusyKey.value = k; }
  function clearBusy()         { localBusyKey.value = ''; }

  async function copyToClipboard(event: MouseEvent, text: string) {
    if (!text) return;
    try {
      await copyConsoleTextWithFeedback(event, text);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  usePageRefreshHandler(
    (detail) => detail.viewId === 'workspaces',
    async () => {
      await load();
      if (selectedId.value) {
        await loadChain(selectedId.value);
      }
    },
  );

  if (options.autoload ?? true) {
    load();
  }

  return {
    busyKey,
    formatCompactDate,
    workspaces,
    sessions,
    selectedId,
    expandedWorkspaceId,
    selectedSessionId,
    selectedSession,
    chainData,
    contextData,
    workspaceFilesData,
    localDirMountData,
    cloudDriveData,
    cloudDriveResult,
    workspaceAssetData,
    workspaceAssetDetail,
    workspaceAssetResult,
    workspaceAssetForm,
    workspaceAssetItems,
    selectedWorkspaceAsset,
    codespaceData,
    codespaceResult,
    workspaceCheckpointTrees,
    workspaceCheckpointDetail,
    workspaceCheckpointPreview,
    workspaceCheckpointError,
    selectedCheckpointTreeId,
    selectedCheckpointNodeId,
    sessionContextData,
    localError,
    panel,
    createForm,
    profileForm,
    parentForm,
    shareForm,
    localDirForm,
    cloudDriveForm,
    codespaceForm,
    showDeleteModal,
    deleteFolderChecked,
    selected,
    workspaceExpansionSlotId,
    isWorkspaceExpanded,
    toggleWorkspaceCard,
    workspaceCheckpointNodes,
    workspaceCheckpointPreviewRestore,
    workspaceOptions,
    cloudDriveConnectionOptions,
    sessionItems,
    statusTone,
    checkpointNodeFileCount,
    checkpointNodeBasePath,
    load,
    loadChain,
    loadWorkspaceCheckpoints,
    loadWorkspaceCheckpointTree,
    previewWorkspaceCheckpointRestore,
    restoreWorkspaceCheckpoint,
    selectSession,
    forkSession,
    createWorkspace,
    deleteWorkspace,
    setParent,
    hotSwapProfile,
    shareOrUnshare,
    connectLocalDirectory,
    syncLocalDirectory,
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
    openProfile,
    openParent,
    openLocalDir,
    openCloudDrive,
    openWorkspaceAssets,
    refreshWorkspaceAssets,
    selectWorkspaceAsset,
    submitWorkspaceAsset,
    loadWorkspaceAssetReceipts,
    backfillWorkspaceAssets,
    openCodespace,
    inspectCodespaceStatus,
    prepareCodespaceChange,
    uploadCodespaceChange,
    copyToClipboard,
  };
}
