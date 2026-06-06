import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { createConsoleJobController } from "../../../server-web/composables/console-job-controller";
import {
  applyWorkspaceCloudDriveSync,
  connectWorkspaceCloudDrive,
  connectWorkspaceLocalDirectory,
  createWorkspace,
  deleteWorkspace,
  downloadWorkspaceCloudDriveFile,
  forkWorkspaceSession,
  getCodespaceProvidersManifest,
  getWorkspaceChainBundle,
  getWorkspaceCheckpointTree,
  getWorkspaceCloudDriveStatus,
  getWorkspaceSessionBundle,
  inspectCodespaceRepositoryStatus,
  listWorkspaceCheckpointTrees,
  listWorkspaceCloudDriveItems,
  listWorkspaceCloudDrivePermissions,
  listWorkspaceSessions,
  listWorkspaceSummaries,
  planWorkspaceCloudDriveSync,
  prepareCodespaceChangeRequest,
  previewWorkspaceCheckpointRestoreRequest,
  restoreWorkspaceCheckpointRequest,
  setWorkspaceParent,
  setWorkspaceSources,
  syncWorkspaceLocalDirectory,
  updateWorkspaceProfile,
  updateWorkspaceShare,
  uploadCodespaceChangeRequest,
  uploadWorkspaceCloudDriveFile,
  workspaceKnowledgeContextSignature,
} from "../../../server-web/lib/workspaces-client";

const jobsClientMock = vi.hoisted(() => ({
  deleteJob: vi.fn(),
}));

const bridgeHttpMock = vi.hoisted(() => ({
  deleteJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/jobs-client", () => ({
  deleteJob: jobsClientMock.deleteJob,
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  deleteJson: bridgeHttpMock.deleteJson,
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

function makeConsoleState(items: any[]) {
  return {
    jobs: {
      items,
      summary: {
        totalCount: items.length,
        queuedCount: items.filter((job) => job.status === "queued").length,
        runningCount: items.filter((job) => job.status === "running").length,
        completedCount: items.filter((job) => job.status === "completed").length,
        failedCount: items.filter((job) => job.status === "failed").length,
      },
    },
  } as any;
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "queued",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

function createJobControllerHarness(items = [makeJob()]) {
  const options = {
    consoleState: ref(makeConsoleState(items)),
    error: ref("old error"),
    applyIngestJobFromEvent: vi.fn(),
    applyJobToKnowledgeSources: vi.fn(),
    clearAllBusy: vi.fn(),
    confirmAction: vi.fn(() => true),
    refreshState: vi.fn(async () => undefined),
    setBusy: vi.fn(),
  };
  return {
    controller: createConsoleJobController(options as any),
    options,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  jobsClientMock.deleteJob.mockResolvedValue({ ok: true });
  bridgeHttpMock.deleteJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.getJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.postJson.mockResolvedValue({ ok: true });
});

describe("createConsoleJobController", () => {
  it("recalculates summaries and keeps event-updated jobs sorted by created time", () => {
    const oldJob = makeJob({
      id: "old",
      status: "running",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T11:00:00.000Z",
    });
    const completedJob = makeJob({
      id: "done",
      status: "completed",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T12:00:00.000Z",
    });
    const { controller, options } = createJobControllerHarness([oldJob, completedJob]);

    expect(controller.recalculateJobSummary([
      oldJob,
      completedJob,
      makeJob({ id: "bad", status: "failed" }),
    ])).toEqual({
      totalCount: 3,
      queuedCount: 0,
      runningCount: 1,
      completedCount: 1,
      failedCount: 1,
    });

    const nextJob = makeJob({
      id: "old",
      status: "failed",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T01:00:00.000Z",
    });
    expect(controller.upsertJobFromEvent(nextJob)).toBe(true);
    expect(options.consoleState.value.jobs.items.map((job: any) => job.id)).toEqual(["old", "done"]);
    expect(options.consoleState.value.jobs.summary).toMatchObject({
      totalCount: 2,
      failedCount: 1,
      completedCount: 1,
    });
    expect(options.applyIngestJobFromEvent).toHaveBeenCalledWith(nextJob);
    expect(options.applyJobToKnowledgeSources).toHaveBeenCalledWith(nextJob);

    expect(controller.recentJobs.value.map((job: any) => job.id)).toEqual(["old", "done"]);
    expect(controller.latestJob.value?.id).toBe("old");
    expect(controller.activeJobCount.value).toBe(0);
  });

  it("handles no-op event updates, removals, and delete confirmation/error paths", async () => {
    const { controller, options } = createJobControllerHarness([
      makeJob({ id: "queued", status: "queued" }),
      makeJob({ id: "running", status: "running" }),
    ]);

    options.consoleState.value = null;
    expect(controller.upsertJobFromEvent(makeJob({ id: "ignored" }))).toBe(false);
    expect(controller.removeJobFromEvent("queued")).toBe(false);

    options.consoleState.value = makeConsoleState([
      makeJob({ id: "queued", status: "queued" }),
      makeJob({ id: "running", status: "running" }),
    ]);
    expect(controller.upsertJobFromEvent({ status: "queued" } as any)).toBe(false);
    expect(controller.removeJobFromEvent("")).toBe(false);
    expect(controller.removeJobFromEvent("queued")).toBe(true);
    expect(options.consoleState.value.jobs.items.map((job: any) => job.id)).toEqual(["running"]);
    expect(options.consoleState.value.jobs.summary).toMatchObject({
      totalCount: 1,
      runningCount: 1,
      queuedCount: 0,
    });

    options.confirmAction.mockReturnValueOnce(false);
    await controller.deleteJob("running");
    expect(jobsClientMock.deleteJob).not.toHaveBeenCalled();

    options.confirmAction.mockReturnValueOnce(true);
    await controller.deleteJob("running");
    expect(options.setBusy).toHaveBeenCalledWith("job:running");
    expect(jobsClientMock.deleteJob).toHaveBeenCalledWith("running");
    expect(options.refreshState).toHaveBeenCalled();
    expect(options.error.value).toBe("");

    jobsClientMock.deleteJob.mockRejectedValueOnce(new Error("delete failed"));
    await controller.deleteJob("running");
    expect(options.error.value).toBe("delete failed");
    expect(options.clearAllBusy).toHaveBeenCalled();

    jobsClientMock.deleteJob.mockRejectedValueOnce("plain failure");
    await controller.deleteJob("running");
    expect(options.error.value).toBe("删除任务失败。");
  });
});

describe("workspaces-client", () => {
  it("declares the workspace knowledge contract signature as stable JSON", () => {
    expect(JSON.parse(workspaceKnowledgeContextSignature)).toMatchObject({
      workspaceEndpoint: "/api/agent-workspaces",
      contextEndpoint: "/context",
      sessionsEndpoint: "/api/agent-sessions",
      profileScopeField: "knowledgeScope",
      forkActionLabel: "分叉",
    });
  });

  it("calls workspace and session endpoints with encoded identifiers", async () => {
    await listWorkspaceSummaries();
    await listWorkspaceSessions();
    await listWorkspaceCheckpointTrees("workspace A/1");
    await getWorkspaceCheckpointTree("tree A/1");
    await previewWorkspaceCheckpointRestoreRequest({ treeId: "tree-1" });
    await restoreWorkspaceCheckpointRequest({ treeId: "tree-1" });
    await getWorkspaceSessionBundle("session A/1");
    await forkWorkspaceSession("session A/1");
    await createWorkspace({ title: "Workspace" });
    await deleteWorkspace("workspace A/1", true);
    await deleteWorkspace("workspace A/1", false);
    await setWorkspaceParent("workspace A/1", "parent A/1");
    await updateWorkspaceProfile("workspace A/1", { modelAlias: "fast" });
    await setWorkspaceSources("workspace A/1", ["source-1"]);
    await updateWorkspaceShare("workspace A/1", "share", "target-1");
    await connectWorkspaceLocalDirectory("workspace A/1", { path: "/tmp/ws" });
    await syncWorkspaceLocalDirectory("workspace A/1", { mode: "pull" });

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/agent-workspaces?includeSummary=true");
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/agent-sessions?limit=100&includeLastEvent=true");
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/workspace/checkpoints/trees?ownerId=workspace%20A%2F1&kind=workspace_files&limit=20",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/workspace/checkpoints/nodes/tree%20A%2F1");
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/agent-sessions/session%20A%2F1?includeEvents=true&eventLimit=200",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/agent-sessions/session%20A%2F1/context");
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith("/api/agent-sessions/session%20A%2F1/fork", {});
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith("/api/agent-workspaces", { title: "Workspace" });
    expect(bridgeHttpMock.deleteJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1?deleteFolder=true",
    );
    expect(bridgeHttpMock.deleteJson).toHaveBeenCalledWith("/api/agent-workspaces/workspace%20A%2F1");
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/parent",
      { parentWorkspaceId: "parent A/1" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/profile",
      { modelAlias: "fast" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/sources",
      { sourceIds: ["source-1"] },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/share",
      { targetWorkspaceId: "target-1" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/local-dir/connect",
      { path: "/tmp/ws" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/local-dir/sync/apply",
      { mode: "pull" },
    );
  });

  it("builds workspace chain bundles and falls back for optional sections", async () => {
    bridgeHttpMock.getJson.mockImplementation(async (url: string) => {
      if (url.endsWith("/chain")) {
        return { chain: true };
      }
      if (url.endsWith("/context")) {
        return { context: true };
      }
      if (url.includes("/files?recursive=true")) {
        throw new Error("files unavailable");
      }
      if (url.includes("/local-dir/mounts")) {
        throw new Error("mounts unavailable");
      }
      if (url.includes("/api/external/cloud-drive/status")) {
        throw new Error("cloud drive unavailable");
      }
      if (url.includes("/api/codespace/providers/manifest")) {
        throw new Error("codespace unavailable");
      }
      return { url };
    });

    await expect(getWorkspaceChainBundle("workspace A/1")).resolves.toEqual({
      chain: { chain: true },
      context: { context: true },
      files: { files: [] },
      localDirs: { mounts: [], count: 0 },
      cloudDrives: { connections: [], count: 0, providers: [] },
      codespace: { providers: {}, providerCount: 0 },
    });
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/chain",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace%20A%2F1/context",
    );
  });

  it("builds cloud-drive and codespace API calls with filtered query params", async () => {
    await getWorkspaceCloudDriveStatus("workspace A/1");
    await connectWorkspaceCloudDrive({ provider: "drive" });
    await listWorkspaceCloudDriveItems({
      workspaceId: "workspace A/1",
      driveRef: "",
      provider: "gdrive",
      clientId: undefined,
      cursor: "page 2",
    });
    await downloadWorkspaceCloudDriveFile({
      workspaceId: "workspace A/1",
      driveRef: "drive/ref",
      provider: null,
      fileId: "file 1",
    } as any);
    await uploadWorkspaceCloudDriveFile({ fileId: "file 1" });
    await planWorkspaceCloudDriveSync({ workspaceId: "workspace A/1" });
    await applyWorkspaceCloudDriveSync({ workspaceId: "workspace A/1" });
    await listWorkspaceCloudDrivePermissions({
      workspaceId: "workspace A/1",
      driveRef: "drive/ref",
      provider: "gdrive",
    });
    await getCodespaceProvidersManifest();
    await inspectCodespaceRepositoryStatus({ repo: "repo" });
    await prepareCodespaceChangeRequest({ repo: "repo" });
    await uploadCodespaceChangeRequest({ repo: "repo" });

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/status?workspaceId=workspace%20A%2F1",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/connect",
      { provider: "drive" },
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/items?workspaceId=workspace+A%2F1&provider=gdrive&cursor=page+2",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/files/download?workspaceId=workspace+A%2F1&driveRef=drive%2Fref&fileId=file+1",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/files/upload",
      { fileId: "file 1" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/sync/plan",
      { workspaceId: "workspace A/1" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/sync/apply",
      { workspaceId: "workspace A/1" },
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/external/cloud-drive/permissions?workspaceId=workspace+A%2F1&driveRef=drive%2Fref&provider=gdrive",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/codespace/providers/manifest");
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/codespace/repository/status",
      { repo: "repo" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/codespace/change/prepare",
      { repo: "repo" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/codespace/change/upload",
      { repo: "repo" },
    );
  });
});
