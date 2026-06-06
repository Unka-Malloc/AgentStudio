import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLocalDirectoryController } from "../../../server-web/composables/console-workspace-local-directory-controller";

const workspacesClientMock = vi.hoisted(() => ({
  connectWorkspaceLocalDirectory: vi.fn(),
  syncWorkspaceLocalDirectory: vi.fn(),
}));

vi.mock("../../../server-web/lib/workspaces-client", () => ({
  connectWorkspaceLocalDirectory: workspacesClientMock.connectWorkspaceLocalDirectory,
  syncWorkspaceLocalDirectory: workspacesClientMock.syncWorkspaceLocalDirectory,
}));

function createHarness(selectedWorkspaceId = "workspace-a") {
  const selectedId = ref(selectedWorkspaceId);
  const localError = ref("previous error");
  const setBusy = vi.fn();
  const clearBusy = vi.fn();
  const reloadWorkspaceChain = vi.fn().mockResolvedValue(undefined);
  const showListPanel = vi.fn();
  const controller = useWorkspaceLocalDirectoryController({
    clearBusy,
    localError,
    reloadWorkspaceChain,
    selectedId,
    setBusy,
    showListPanel,
  });

  return {
    clearBusy,
    controller,
    localError,
    reloadWorkspaceChain,
    selectedId,
    setBusy,
    showListPanel,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  workspacesClientMock.connectWorkspaceLocalDirectory.mockReset();
  workspacesClientMock.syncWorkspaceLocalDirectory.mockReset();
});

describe("workspace local directory controller extra coverage", () => {
  it("opens and resets the local directory mount panel state", () => {
    const { controller } = createHarness();
    const payload = {
      localDirs: {
        mounts: [{ mountRef: "mount-a", sourcePath: "/source", targetPath: "mirror" }],
      },
    } as any;

    controller.localDirForm.sourcePath = "/tmp/old";
    controller.localDirForm.targetPath = "old-target";
    controller.localDirForm.deleteExtraneous = false;
    controller.localDirForm.maxFiles = 99;
    controller.setLocalDirectoryMountData(payload);

    expect(controller.localDirMountData.value).toEqual(payload);
    expect(controller.openLocalDir()).toBe("localDir");
    expect(controller.localDirForm).toMatchObject({
      deleteExtraneous: true,
      maxFiles: 2000,
      sourcePath: "",
      targetPath: "mirror",
    });

    controller.resetLocalDirectoryState();
    expect(controller.localDirMountData.value).toBeNull();
  });

  it("does not connect without a selected workspace or source path", async () => {
    const missingWorkspace = createHarness("");
    missingWorkspace.controller.localDirForm.sourcePath = "/source";

    await missingWorkspace.controller.connectLocalDirectory();

    const missingSource = createHarness("workspace-a");
    missingSource.controller.localDirForm.sourcePath = "   ";

    await missingSource.controller.connectLocalDirectory();

    expect(workspacesClientMock.connectWorkspaceLocalDirectory).not.toHaveBeenCalled();
    expect(missingWorkspace.setBusy).not.toHaveBeenCalled();
    expect(missingSource.setBusy).not.toHaveBeenCalled();
  });

  it("connects a local directory, reloads workspace data, and returns to the list panel", async () => {
    workspacesClientMock.connectWorkspaceLocalDirectory.mockResolvedValue({ ok: true });
    const { clearBusy, controller, localError, reloadWorkspaceChain, setBusy, showListPanel } = createHarness();
    controller.localDirForm.sourcePath = "/Users/dev/data";
    controller.localDirForm.targetPath = "";
    controller.localDirForm.deleteExtraneous = false;
    controller.localDirForm.maxFiles = 321;

    await controller.connectLocalDirectory();

    expect(setBusy).toHaveBeenCalledWith("ws:local-dir-connect");
    expect(localError.value).toBe("");
    expect(workspacesClientMock.connectWorkspaceLocalDirectory).toHaveBeenCalledWith("workspace-a", {
      deleteExtraneous: false,
      maxFiles: 321,
      sourcePath: "/Users/dev/data",
      targetPath: "",
    });
    expect(controller.localDirForm.sourcePath).toBe("");
    expect(reloadWorkspaceChain).toHaveBeenCalledTimes(1);
    expect(showListPanel).toHaveBeenCalledTimes(1);
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });

  it("stores connect failures and still clears busy state", async () => {
    workspacesClientMock.connectWorkspaceLocalDirectory.mockRejectedValue(new Error("connect failed"));
    const { clearBusy, controller, localError, reloadWorkspaceChain, showListPanel } = createHarness();
    controller.localDirForm.sourcePath = "/bad/source";

    await controller.connectLocalDirectory();

    expect(localError.value).toBe("connect failed");
    expect(reloadWorkspaceChain).not.toHaveBeenCalled();
    expect(showListPanel).not.toHaveBeenCalled();
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });

  it("syncs an existing mount and skips incomplete requests", async () => {
    workspacesClientMock.syncWorkspaceLocalDirectory.mockResolvedValue({ ok: true });
    const { clearBusy, controller, reloadWorkspaceChain, selectedId, setBusy } = createHarness();

    await controller.syncLocalDirectory({ mountRef: "", targetPath: "mirror" } as any);
    selectedId.value = "";
    await controller.syncLocalDirectory({ mountRef: "mount-a", targetPath: "mirror" } as any);
    selectedId.value = "workspace-a";
    await controller.syncLocalDirectory({ mountRef: "mount-a", targetPath: "" } as any);

    expect(setBusy).toHaveBeenCalledTimes(1);
    expect(setBusy).toHaveBeenCalledWith("ws:local-dir-sync:mount-a");
    expect(workspacesClientMock.syncWorkspaceLocalDirectory).toHaveBeenCalledWith("workspace-a", {
      deleteExtraneous: true,
      mountRef: "mount-a",
      targetPath: "",
    });
    expect(reloadWorkspaceChain).toHaveBeenCalledTimes(1);
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });

  it("stores sync failures and clears busy state", async () => {
    workspacesClientMock.syncWorkspaceLocalDirectory.mockRejectedValue("sync offline");
    const { clearBusy, controller, localError } = createHarness();

    await controller.syncLocalDirectory({ mountRef: "mount-b", targetPath: "mirror" } as any);

    expect(localError.value).toBe("sync offline");
    expect(clearBusy).toHaveBeenCalledTimes(1);
  });
});
