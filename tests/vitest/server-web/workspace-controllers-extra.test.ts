// @vitest-environment jsdom
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceCloudDriveController } from "../../../server-web/composables/console-workspace-cloud-drive-controller";
import { useWorkspaceCheckpointController } from "../../../server-web/composables/console-workspace-checkpoint-controller";
import { useWorkspaceManagementController, type WorkspacePanel } from "../../../server-web/composables/console-workspace-management-controller";
import { useWorkspacesConsole } from "../../../server-web/composables/useWorkspacesConsole";

const workspacesClientMock = vi.hoisted(() => ({
  applyWorkspaceCloudDriveSync: vi.fn(),
  connectWorkspaceCloudDrive: vi.fn(),
  connectWorkspaceLocalDirectory: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  downloadWorkspaceCloudDriveFile: vi.fn(),
  forkWorkspaceSession: vi.fn(),
  getCodespaceProvidersManifest: vi.fn(),
  getWorkspaceChainBundle: vi.fn(),
  getWorkspaceCheckpointTree: vi.fn(),
  getWorkspaceCloudDriveStatus: vi.fn(),
  getWorkspaceSessionBundle: vi.fn(),
  inspectCodespaceRepositoryStatus: vi.fn(),
  listWorkspaceCheckpointTrees: vi.fn(),
  listWorkspaceCloudDriveItems: vi.fn(),
  listWorkspaceCloudDrivePermissions: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  listWorkspaceSummaries: vi.fn(),
  planWorkspaceCloudDriveSync: vi.fn(),
  prepareCodespaceChangeRequest: vi.fn(),
  previewWorkspaceCheckpointRestoreRequest: vi.fn(),
  restoreWorkspaceCheckpointRequest: vi.fn(),
  setWorkspaceParent: vi.fn(),
  setWorkspaceSources: vi.fn(),
  syncWorkspaceLocalDirectory: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  updateWorkspaceShare: vi.fn(),
  uploadCodespaceChangeRequest: vi.fn(),
  uploadWorkspaceCloudDriveFile: vi.fn(),
}));

const pageRefreshHandlerMock = vi.hoisted(() => vi.fn());
const confirmActionMock = vi.hoisted(() => vi.fn(() => true));
const copyTextMock = vi.hoisted(() => vi.fn());
const shellContextState = vi.hoisted(() => ({
  busyKey: { value: "global-busy" },
}));

vi.mock("../../../server-web/lib/workspaces-client", () => ({
  applyWorkspaceCloudDriveSync: workspacesClientMock.applyWorkspaceCloudDriveSync,
  connectWorkspaceCloudDrive: workspacesClientMock.connectWorkspaceCloudDrive,
  connectWorkspaceLocalDirectory: workspacesClientMock.connectWorkspaceLocalDirectory,
  createWorkspace: workspacesClientMock.createWorkspace,
  deleteWorkspace: workspacesClientMock.deleteWorkspace,
  downloadWorkspaceCloudDriveFile: workspacesClientMock.downloadWorkspaceCloudDriveFile,
  forkWorkspaceSession: workspacesClientMock.forkWorkspaceSession,
  getCodespaceProvidersManifest: workspacesClientMock.getCodespaceProvidersManifest,
  getWorkspaceChainBundle: workspacesClientMock.getWorkspaceChainBundle,
  getWorkspaceCheckpointTree: workspacesClientMock.getWorkspaceCheckpointTree,
  getWorkspaceCloudDriveStatus: workspacesClientMock.getWorkspaceCloudDriveStatus,
  getWorkspaceSessionBundle: workspacesClientMock.getWorkspaceSessionBundle,
  inspectCodespaceRepositoryStatus: workspacesClientMock.inspectCodespaceRepositoryStatus,
  listWorkspaceCheckpointTrees: workspacesClientMock.listWorkspaceCheckpointTrees,
  listWorkspaceCloudDriveItems: workspacesClientMock.listWorkspaceCloudDriveItems,
  listWorkspaceCloudDrivePermissions: workspacesClientMock.listWorkspaceCloudDrivePermissions,
  listWorkspaceSessions: workspacesClientMock.listWorkspaceSessions,
  listWorkspaceSummaries: workspacesClientMock.listWorkspaceSummaries,
  planWorkspaceCloudDriveSync: workspacesClientMock.planWorkspaceCloudDriveSync,
  prepareCodespaceChangeRequest: workspacesClientMock.prepareCodespaceChangeRequest,
  previewWorkspaceCheckpointRestoreRequest: workspacesClientMock.previewWorkspaceCheckpointRestoreRequest,
  restoreWorkspaceCheckpointRequest: workspacesClientMock.restoreWorkspaceCheckpointRequest,
  setWorkspaceParent: workspacesClientMock.setWorkspaceParent,
  setWorkspaceSources: workspacesClientMock.setWorkspaceSources,
  syncWorkspaceLocalDirectory: workspacesClientMock.syncWorkspaceLocalDirectory,
  updateWorkspaceProfile: workspacesClientMock.updateWorkspaceProfile,
  updateWorkspaceShare: workspacesClientMock.updateWorkspaceShare,
  uploadCodespaceChangeRequest: workspacesClientMock.uploadCodespaceChangeRequest,
  uploadWorkspaceCloudDriveFile: workspacesClientMock.uploadWorkspaceCloudDriveFile,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => shellContextState),
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: confirmActionMock,
  copyConsoleTextWithFeedback: copyTextMock,
}));

function mountComposable<T>(factory: () => T) {
  let exposed!: T;
  mount(
    defineComponent({
      setup() {
        exposed = factory();
        return () => null;
      },
    }),
  );
  return exposed;
}

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    title: "Alpha",
    objective: "Ship the console",
    status: "active",
    parentWorkspaceId: null,
    profile: {},
    ownedSourceIds: [],
    accessibleWorkspaceIds: [],
    currentGeneration: 1,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
    fsPath: "/tmp/ws-1",
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "ws-1",
    title: "Session alpha",
    objective: "Collect evidence",
    status: "running",
    parentSessionId: "",
    forkedFromEventId: "",
    branchIndex: 1,
    eventCount: 2,
    lastEventId: "evt-2",
    appendOnly: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
    workspace: { workspaceId: "ws-1", title: "Alpha", currentGeneration: 1 },
    lastEvent: { eventId: "evt-2", sequence: 2, type: "note", title: "Updated", summary: "latest", createdAt: "2026-06-02T00:00:00Z" },
    ...overrides,
  };
}

function makeCheckpointTree(overrides: Record<string, unknown> = {}) {
  return {
    treeId: "tree-1",
    kind: "workspace_files",
    ownerId: "ws-1",
    status: "completed",
    nodeCount: 2,
    byStatus: { completed: 2 },
    updatedAt: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

function makeCheckpointDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...makeCheckpointTree(),
    rootNodeId: "node-root",
    nodes: {
      "node-new": {
        nodeId: "node-new",
        parentId: "node-root",
        label: "new",
        status: "completed",
        updatedAt: "2026-06-03T00:00:00Z",
        metadata: {
          workspaceFileSnapshot: {
            basePath: "/alpha/new",
            files: [{ path: "a.txt" }, { path: "b.txt" }],
          },
        },
      },
      "node-old": {
        nodeId: "node-old",
        parentId: "node-root",
        label: "old",
        status: "completed",
        createdAt: "2026-06-01T00:00:00Z",
        metadata: {
          workspaceFileSnapshot: {
            basePath: "/alpha/old",
            files: [{ path: "c.txt" }],
          },
        },
      },
      "node-skip": {
        nodeId: "node-skip",
        parentId: "node-root",
        label: "skip",
        status: "running",
        updatedAt: "2026-06-04T00:00:00Z",
      },
    },
    ...overrides,
  };
}

describe("useWorkspaceManagementController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates, resets, and reloads workspace actions", async () => {
    const localError = ref("");
    const panel = ref<WorkspacePanel>("create");
    const selectedId = ref("ws-1");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);
    const loadChain = vi.fn().mockResolvedValue(undefined);

    workspacesClientMock.createWorkspace.mockResolvedValueOnce({ workspaceId: "ws-created" });
    workspacesClientMock.deleteWorkspace.mockResolvedValueOnce({ ok: true });
    workspacesClientMock.setWorkspaceParent.mockResolvedValueOnce({ ok: true });
    workspacesClientMock.updateWorkspaceProfile.mockResolvedValueOnce({ ok: true });
    workspacesClientMock.setWorkspaceSources.mockResolvedValueOnce({ ok: true });
    workspacesClientMock.updateWorkspaceShare.mockResolvedValueOnce({ ok: true });

    const controller = mountComposable(() =>
      useWorkspaceManagementController({
        clearBusy,
        load,
        loadChain,
        localError,
        panel,
        selectedId,
        setBusy,
      }),
    );

    expect(controller.createForm).toMatchObject({ title: "", objective: "", parentWorkspaceId: "" });
    expect(controller.profileForm).toMatchObject({
      contextProfileId: "",
      toolGrantId: "",
      modelAlias: "",
      includeSourceIds: "",
      excludeSourceIds: "",
      ownedSourceIds: "",
    });
    expect(controller.showDeleteModal.value).toBe(false);
    expect(controller.deleteFolderChecked.value).toBe(false);

    controller.createForm.title = "New workspace";
    controller.createForm.objective = "Do the thing";
    controller.createForm.parentWorkspaceId = "parent-1";
    await controller.createWorkspace();

    expect(setBusy).toHaveBeenCalledWith("ws:create");
    expect(workspacesClientMock.createWorkspace).toHaveBeenCalledWith({
      title: "New workspace",
      objective: "Do the thing",
      parentWorkspaceId: "parent-1",
    });
    expect(controller.createForm).toMatchObject({ title: "", objective: "", parentWorkspaceId: "" });
    expect(panel.value).toBe("list");
    expect(load).toHaveBeenCalledTimes(1);
    expect(clearBusy).toHaveBeenCalled();

    controller.deleteFolderChecked.value = true;
    controller.showDeleteModal.value = true;
    await controller.deleteWorkspace();

    expect(workspacesClientMock.deleteWorkspace).toHaveBeenCalledWith("ws-1", true);
    expect(selectedId.value).toBe("");
    expect(panel.value).toBe("list");
    expect(controller.showDeleteModal.value).toBe(false);
    expect(controller.deleteFolderChecked.value).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);

    selectedId.value = "ws-2";
    controller.parentForm.parentWorkspaceId = "parent-2";
    await controller.setParent();
    expect(workspacesClientMock.setWorkspaceParent).toHaveBeenCalledWith("ws-2", "parent-2");
    expect(load).toHaveBeenCalledTimes(3);
    expect(loadChain).toHaveBeenCalledWith("ws-2");

    controller.profileForm.contextProfileId = "profile-1";
    controller.profileForm.toolGrantId = "grant-1";
    controller.profileForm.modelAlias = "model-1";
    controller.profileForm.includeSourceIds = "src-a, src-b";
    controller.profileForm.excludeSourceIds = "skip-a, skip-b";
    controller.profileForm.ownedSourceIds = "";
    await controller.hotSwapProfile();

    expect(workspacesClientMock.updateWorkspaceProfile).toHaveBeenCalledWith("ws-2", {
      contextProfileId: "profile-1",
      toolGrantId: "grant-1",
      modelAlias: "model-1",
      knowledgeScope: {
        includeSourceIds: ["src-a", "src-b"],
        excludeSourceIds: ["skip-a", "skip-b"],
      },
    });
    expect(workspacesClientMock.setWorkspaceSources).toHaveBeenCalledWith("ws-2", []);
    expect(load).toHaveBeenCalledTimes(4);
    expect(loadChain).toHaveBeenCalledTimes(2);
    expect(panel.value).toBe("list");

    controller.shareForm.targetWorkspaceId = "ws-3";
    controller.shareForm.action = "unshare";
    await controller.shareOrUnshare();
    expect(workspacesClientMock.updateWorkspaceShare).toHaveBeenCalledWith("ws-2", "unshare", "ws-3");
    expect(load).toHaveBeenCalledTimes(5);
    expect(loadChain).toHaveBeenCalledTimes(3);
    expect(localError.value).toBe("");
    expect(clearBusy).toHaveBeenCalled();
  });

  it("surfaces create failures and respects input guards", async () => {
    const localError = ref("");
    const panel = ref<WorkspacePanel>("create");
    const selectedId = ref("");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);
    const loadChain = vi.fn().mockResolvedValue(undefined);

    workspacesClientMock.createWorkspace.mockRejectedValueOnce(new Error("create failed"));
    workspacesClientMock.deleteWorkspace.mockResolvedValueOnce({ ok: true });

    const controller = mountComposable(() =>
      useWorkspaceManagementController({
        clearBusy,
        load,
        loadChain,
        localError,
        panel,
        selectedId,
        setBusy,
      }),
    );

    controller.createForm.title = "Broken";
    await controller.createWorkspace();
    expect(localError.value).toBe("create failed");
    expect(panel.value).toBe("create");
    expect(load).not.toHaveBeenCalled();

    await controller.deleteWorkspace();
    expect(workspacesClientMock.deleteWorkspace).not.toHaveBeenCalled();
    expect(setBusy).toHaveBeenCalledTimes(1);
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });

  it("hydrates profile and parent forms from workspace data", () => {
    const controller = mountComposable(() =>
      useWorkspaceManagementController({
        clearBusy: vi.fn(),
        load: vi.fn(),
        loadChain: vi.fn(),
        localError: ref(""),
        panel: ref<WorkspacePanel>("list"),
        selectedId: ref("ws-1"),
        setBusy: vi.fn(),
      }),
    );

    controller.openProfile(
      makeWorkspace({
        profile: {
          contextProfileId: "profile-9",
          toolGrantId: "grant-9",
          modelAlias: "model-9",
          knowledgeScope: {
            includeSourceIds: ["a", "b"],
            excludeSourceIds: ["x"],
          },
        },
        ownedSourceIds: ["owned-a", "owned-b"],
      }),
    );
    expect(controller.profileForm).toMatchObject({
      contextProfileId: "profile-9",
      toolGrantId: "grant-9",
      modelAlias: "model-9",
      includeSourceIds: "a, b",
      excludeSourceIds: "x",
      ownedSourceIds: "owned-a, owned-b",
    });

    controller.openParent(makeWorkspace({ parentWorkspaceId: "ws-parent" }));
    expect(controller.parentForm.parentWorkspaceId).toBe("ws-parent");
  });
});

describe("useWorkspaceCloudDriveController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes connection options and cloud drive form helpers", async () => {
    const localError = ref("");
    const selectedId = ref("ws-1");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();

    workspacesClientMock.getWorkspaceCloudDriveStatus.mockResolvedValueOnce({
      connections: [{ driveRef: "drive-1", label: "iCloud", provider: "icloud" }],
      count: 1,
    });

    const controller = mountComposable(() =>
      useWorkspaceCloudDriveController({
        clearBusy,
        localError,
        selectedId,
        setBusy,
      }),
    );

    expect(controller.cloudDriveForm.provider).toBe("icloud");
    expect(controller.cloudDriveAllowedClients()).toEqual(["owner", "codex"]);

    controller.cloudDriveForm.allowedClients = " owner, codex , , ";
    expect(controller.cloudDriveAllowedClients()).toEqual(["owner", "codex"]);

    controller.cloudDriveData.value = {
      connections: [
        { driveRef: "drive-1", label: "iCloud", provider: "icloud" },
        { driveRef: "drive-2", provider: "dropbox" },
      ],
    };
    expect(controller.cloudDriveConnectionOptions.value).toEqual([
      { value: "drive-1", label: "iCloud · drive-1" },
      { value: "drive-2", label: "dropbox · drive-2" },
    ]);

    controller.addCloudDriveExposure();
    expect(controller.cloudDriveForm.exposedDirectories).toHaveLength(1);
    expect(controller.cloudDriveForm.exposedDirectories[0]).toMatchObject({
      name: "共享目录 1",
      permissionMode: "all",
      path: "",
    });
    controller.removeCloudDriveExposure(0);
    expect(controller.cloudDriveForm.exposedDirectories).toHaveLength(0);

    const panel = controller.openCloudDrive();
    expect(panel).toBe("cloudDrive");
    expect(controller.cloudDriveForm.driveRef).toBe("drive-1");
    expect(controller.cloudDriveResult.value).toBeNull();

    await controller.refreshCloudDriveStatus();
    expect(setBusy).toHaveBeenCalledWith("ws:drive-status");
    expect(workspacesClientMock.getWorkspaceCloudDriveStatus).toHaveBeenCalledWith("ws-1");
    expect(controller.cloudDriveData.value).toEqual({
      connections: [{ driveRef: "drive-1", label: "iCloud", provider: "icloud" }],
      count: 1,
    });
    expect(clearBusy).toHaveBeenCalled();
  });

  it("connects, queries, and reports cloud drive failures", async () => {
    const localError = ref("");
    const selectedId = ref("ws-1");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();

    workspacesClientMock.connectWorkspaceCloudDrive.mockResolvedValueOnce({
      drive: { driveRef: "drive-connected" },
      ok: true,
    });
    workspacesClientMock.getWorkspaceCloudDriveStatus.mockResolvedValue({
      connections: [{ driveRef: "drive-connected", provider: "icloud" }],
      count: 1,
    });
    workspacesClientMock.listWorkspaceCloudDriveItems.mockRejectedValueOnce(new Error("list failed"));
    workspacesClientMock.downloadWorkspaceCloudDriveFile.mockResolvedValueOnce({ content: "downloaded" });
    workspacesClientMock.uploadWorkspaceCloudDriveFile.mockResolvedValueOnce({ uploaded: true });
    workspacesClientMock.planWorkspaceCloudDriveSync.mockResolvedValueOnce({ planId: "plan-1" });
    workspacesClientMock.applyWorkspaceCloudDriveSync.mockResolvedValueOnce({ applied: true });
    workspacesClientMock.listWorkspaceCloudDrivePermissions.mockResolvedValueOnce({ permissions: ["read"] });

    const controller = mountComposable(() =>
      useWorkspaceCloudDriveController({
        clearBusy,
        localError,
        selectedId,
        setBusy,
      }),
    );

    controller.cloudDriveForm.provider = "icloud";
    controller.cloudDriveForm.rootPath = "/Volumes/Drive";
    controller.cloudDriveForm.managedFolderRoot = "  ";
    controller.cloudDriveForm.publicFolder = "  ";
    controller.cloudDriveForm.clientId = " owner ";
    controller.cloudDriveForm.allowedClients = " owner, codex ";
    controller.cloudDriveForm.advancedMode = true;
    controller.cloudDriveForm.exposedDirectories.push({
      id: "exposure-1",
      name: " 共享目录 ",
      path: "docs",
      permissionMode: "allowlist",
      subjects: "alice, bob",
      showPermissions: false,
    });
    controller.cloudDriveForm.exposedDirectories.push({
      id: "exposure-2",
      name: "ignored",
      path: "   ",
      permissionMode: "all",
      subjects: "",
      showPermissions: false,
    });

    await controller.connectCloudDrive();
    expect(workspacesClientMock.connectWorkspaceCloudDrive).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      provider: "icloud",
      mode: "local",
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        {
          name: "共享目录",
          drivePath: "docs",
          spaceKind: "advancedExposure",
          writable: false,
          accessPolicy: { mode: "allowlist", subjects: ["alice", "bob"] },
        },
      ],
      rootPath: "/Volumes/Drive",
    });
    expect(workspacesClientMock.getWorkspaceCloudDriveStatus).toHaveBeenCalledWith("ws-1");
    expect(controller.cloudDriveForm.driveRef).toBe("drive-connected");
    expect(controller.cloudDriveResult.value).toEqual({
      drive: { driveRef: "drive-connected" },
      ok: true,
    });

    controller.cloudDriveForm.path = "docs/report.txt";
    await controller.listCloudDriveItems();
    expect(setBusy).toHaveBeenCalledWith("ws:drive-list");
    expect(workspacesClientMock.listWorkspaceCloudDriveItems).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/report.txt",
      recursive: true,
      includeHash: true,
      limit: 200,
    });
    expect(localError.value).toBe("list failed");
    expect(clearBusy).toHaveBeenCalled();

    controller.cloudDriveForm.path = "docs/report.txt";
    await controller.downloadCloudDriveFile();
    expect(workspacesClientMock.downloadWorkspaceCloudDriveFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/report.txt",
      includeText: true,
    });

    controller.cloudDriveForm.uploadPath = "docs/upload.txt";
    controller.cloudDriveForm.uploadContent = "payload";
    await controller.uploadCloudDriveFile();
    expect(workspacesClientMock.uploadWorkspaceCloudDriveFile).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/upload.txt",
      content: "payload",
      overwrite: true,
    });
    expect(controller.cloudDriveForm.path).toBe("docs/upload.txt");

    await controller.planCloudDriveSync();
    expect(workspacesClientMock.planWorkspaceCloudDriveSync).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/upload.txt",
      targetPath: "cloud-drive",
      direction: "import_to_sharedspace",
    });

    await controller.applyCloudDriveSync();
    expect(workspacesClientMock.applyWorkspaceCloudDriveSync).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/upload.txt",
      targetPath: "cloud-drive",
      direction: "import_to_sharedspace",
      confirm: true,
    });

    await controller.listCloudDrivePermissions();
    expect(workspacesClientMock.listWorkspaceCloudDrivePermissions).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      driveRef: "drive-connected",
      clientId: "owner",
      path: "docs/upload.txt",
    });
  });

  it("guards cloud drive actions when required input is missing", async () => {
    const controller = mountComposable(() =>
      useWorkspaceCloudDriveController({
        clearBusy: vi.fn(),
        localError: ref(""),
        selectedId: ref(""),
        setBusy: vi.fn(),
      }),
    );

    await controller.refreshCloudDriveStatus();
    await controller.downloadCloudDriveFile();
    await controller.uploadCloudDriveFile();
    await controller.planCloudDriveSync();
    await controller.applyCloudDriveSync();
    await controller.listCloudDrivePermissions();

    expect(workspacesClientMock.getWorkspaceCloudDriveStatus).not.toHaveBeenCalled();
    expect(workspacesClientMock.downloadWorkspaceCloudDriveFile).not.toHaveBeenCalled();
    expect(workspacesClientMock.uploadWorkspaceCloudDriveFile).not.toHaveBeenCalled();
    expect(workspacesClientMock.planWorkspaceCloudDriveSync).not.toHaveBeenCalled();
    expect(workspacesClientMock.applyWorkspaceCloudDriveSync).not.toHaveBeenCalled();
    expect(workspacesClientMock.listWorkspaceCloudDrivePermissions).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceCheckpointController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, previews, and restores checkpoint trees", async () => {
    const localError = ref("");
    const selectedId = ref("ws-1");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();
    const reloadWorkspaceChain = vi.fn().mockResolvedValue(undefined);
    const confirmAction = vi.fn(() => true);

    workspacesClientMock.listWorkspaceCheckpointTrees.mockResolvedValueOnce({
      items: [makeCheckpointTree({ treeId: "tree-1" })],
    });
    workspacesClientMock.getWorkspaceCheckpointTree.mockResolvedValueOnce(
      makeCheckpointDetail({ treeId: "tree-1" }),
    );
    workspacesClientMock.previewWorkspaceCheckpointRestoreRequest.mockResolvedValueOnce({
      workspaceFileRestore: { treeId: "tree-1", nodeId: "node-new" },
      preview: true,
    });
    workspacesClientMock.restoreWorkspaceCheckpointRequest.mockResolvedValueOnce({
      workspaceFileRestore: { treeId: "tree-1", nodeId: "node-new" },
      restored: true,
    });

    const controller = mountComposable(() =>
      useWorkspaceCheckpointController({
        clearBusy,
        confirmAction,
        localError,
        reloadWorkspaceChain,
        selectedId,
        setBusy,
      }),
    );

    await controller.loadWorkspaceCheckpoints("ws-1");
    expect(workspacesClientMock.listWorkspaceCheckpointTrees).toHaveBeenCalledWith("ws-1");
    expect(controller.workspaceCheckpointTrees.value).toEqual([makeCheckpointTree({ treeId: "tree-1" })]);
    expect(controller.selectedCheckpointTreeId.value).toBe("tree-1");
    expect(controller.selectedCheckpointNodeId.value).toBe("node-new");
    expect(controller.workspaceCheckpointNodes.value.map((node) => node.nodeId)).toEqual(["node-new", "node-old"]);
    expect(controller.checkpointNodeFileCount(controller.workspaceCheckpointNodes.value[0])).toBe(2);
    expect(controller.checkpointNodeBasePath(controller.workspaceCheckpointNodes.value[1])).toBe("/alpha/old");
    expect(controller.workspaceCheckpointPreviewRestore.value).toBeNull();

    await controller.previewWorkspaceCheckpointRestore();
    expect(workspacesClientMock.previewWorkspaceCheckpointRestoreRequest).toHaveBeenCalledWith({
      treeId: "tree-1",
      nodeId: "node-new",
      workspaceId: "ws-1",
      reason: "console workspace file rollback preview",
    });
    expect(controller.workspaceCheckpointPreview.value).toEqual({
      workspaceFileRestore: { treeId: "tree-1", nodeId: "node-new" },
      preview: true,
    });
    expect(controller.workspaceCheckpointPreviewRestore.value).toEqual({
      treeId: "tree-1",
      nodeId: "node-new",
    });

    await controller.restoreWorkspaceCheckpoint();
    expect(confirmAction).toHaveBeenCalled();
    expect(workspacesClientMock.restoreWorkspaceCheckpointRequest).toHaveBeenCalledWith({
      treeId: "tree-1",
      nodeId: "node-new",
      workspaceId: "ws-1",
      reason: "console workspace file rollback",
    });
    expect(reloadWorkspaceChain).toHaveBeenCalledTimes(1);
    expect(controller.workspaceCheckpointPreview.value).toEqual({
      workspaceFileRestore: { treeId: "tree-1", nodeId: "node-new" },
      restored: true,
    });
    expect(controller.selectedCheckpointNodeId.value).toBe("node-new");
    expect(setBusy).toHaveBeenCalledWith("ws:checkpoint-preview");
    expect(setBusy).toHaveBeenCalledWith("ws:checkpoint-restore");
    expect(clearBusy).toHaveBeenCalled();
  });

  it("reports checkpoint failures and respects guards", async () => {
    const localError = ref("");
    const selectedId = ref("ws-1");
    const setBusy = vi.fn();
    const clearBusy = vi.fn();
    const reloadWorkspaceChain = vi.fn().mockResolvedValue(undefined);

    workspacesClientMock.listWorkspaceCheckpointTrees.mockRejectedValueOnce(new Error("tree load failed"));
    workspacesClientMock.getWorkspaceCheckpointTree.mockRejectedValueOnce(new Error("tree detail failed"));
    workspacesClientMock.previewWorkspaceCheckpointRestoreRequest.mockRejectedValueOnce(new Error("preview failed"));
    workspacesClientMock.restoreWorkspaceCheckpointRequest.mockRejectedValueOnce(new Error("restore failed"));

    const controller = mountComposable(() =>
      useWorkspaceCheckpointController({
        clearBusy,
        confirmAction: vi.fn(() => true),
        localError,
        reloadWorkspaceChain,
        selectedId,
        setBusy,
      }),
    );

    await controller.loadWorkspaceCheckpoints("ws-1");
    expect(controller.workspaceCheckpointTrees.value).toEqual([]);
    expect(controller.workspaceCheckpointError.value).toBe("tree load failed");

    controller.selectedCheckpointTreeId.value = "tree-1";
    controller.selectedCheckpointNodeId.value = "node-new";
    await controller.previewWorkspaceCheckpointRestore();
    expect(controller.workspaceCheckpointError.value).toBe("preview failed");

    await controller.restoreWorkspaceCheckpoint();
    expect(workspacesClientMock.restoreWorkspaceCheckpointRequest).toHaveBeenCalledWith({
      treeId: "tree-1",
      nodeId: "node-new",
      workspaceId: "ws-1",
      reason: "console workspace file rollback",
    });
    expect(controller.workspaceCheckpointError.value).toBe("restore failed");
    expect(reloadWorkspaceChain).not.toHaveBeenCalled();

    controller.resetWorkspaceCheckpoints();
    expect(controller.workspaceCheckpointTrees.value).toEqual([]);
    expect(controller.workspaceCheckpointDetail.value).toBeNull();
    expect(controller.workspaceCheckpointPreview.value).toBeNull();
    expect(controller.selectedCheckpointTreeId.value).toBe("");
    expect(controller.selectedCheckpointNodeId.value).toBe("");
  });
});

describe("useWorkspacesConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellContextState.busyKey.value = "global-busy";
  });

  it("loads workspaces, derives selection state, and reacts to workspace selection", async () => {
    workspacesClientMock.listWorkspaceSummaries.mockResolvedValueOnce({
      workspaces: [
        makeWorkspace({ workspaceId: "ws-1", title: "Alpha" }),
        makeWorkspace({ workspaceId: "ws-2", title: "Beta" }),
      ],
    });
    workspacesClientMock.listWorkspaceSessions.mockResolvedValueOnce({
      sessions: [makeSession({ sessionId: "session-2", workspaceId: "ws-2" })],
    });
    workspacesClientMock.getWorkspaceChainBundle.mockResolvedValueOnce({
      chain: { chainId: "chain-1" },
      context: { contextId: "context-1" },
      files: { fileCount: 2 },
      localDirs: { mounts: [] },
      cloudDrives: {
        connections: [{ driveRef: "drive-1", label: "Drive", provider: "icloud" }],
      },
      codespace: { providers: {} },
    });
    workspacesClientMock.listWorkspaceCheckpointTrees.mockResolvedValueOnce({
      items: [makeCheckpointTree({ treeId: "tree-1" })],
    });
    workspacesClientMock.getWorkspaceCheckpointTree.mockResolvedValueOnce(
      makeCheckpointDetail({ treeId: "tree-1" }),
    );

    const controller = mountComposable(() => useWorkspacesConsole());

    await flushPromises();
    await nextTick();

    expect(pageRefreshHandlerMock).toHaveBeenCalled();
    expect(workspacesClientMock.listWorkspaceSummaries).toHaveBeenCalledTimes(1);
    expect(workspacesClientMock.listWorkspaceSessions).toHaveBeenCalledTimes(1);
    expect(controller.busyKey.value).toBe("global-busy");
    expect(controller.workspaceOptions.value).toEqual([
      { value: "ws-1", label: "Alpha" },
      { value: "ws-2", label: "Beta" },
    ]);
    expect(controller.selected.value).toBeNull();
    expect(controller.statusTone("active")).toBe("success");
    expect(controller.statusTone("archived")).toBe("neutral");
    expect(controller.workspaceExpansionSlotId(makeWorkspace({ workspaceId: "ws-2" }))).toBe("workspace-expansion-ws-2");

    controller.selectedId.value = "ws-1";
    await flushPromises();
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("ws-1");
    expect(controller.chainData.value).toEqual({ chainId: "chain-1" });
    expect(controller.contextData.value).toEqual({ contextId: "context-1" });
    expect(controller.workspaceFilesData.value).toEqual({ fileCount: 2 });
    expect(controller.cloudDriveData.value).toEqual({
      connections: [{ driveRef: "drive-1", label: "Drive", provider: "icloud" }],
    });
    expect(controller.workspaceCheckpointTrees.value).toEqual([makeCheckpointTree({ treeId: "tree-1" })]);
    expect(controller.selectedCheckpointTreeId.value).toBe("tree-1");
    expect(controller.selected.value?.workspaceId).toBe("ws-1");
    expect(controller.expandedWorkspaceId.value).toBe("ws-1");
    expect(controller.isWorkspaceExpanded(makeWorkspace({ workspaceId: "ws-1" }))).toBe(true);

    controller.toggleWorkspaceCard(makeWorkspace({ workspaceId: "ws-1" }));
    expect(controller.selectedId.value).toBe("ws-1");
    expect(controller.panel.value).toBe("list");
    expect(controller.expandedWorkspaceId.value).toBe("");
  });
});
