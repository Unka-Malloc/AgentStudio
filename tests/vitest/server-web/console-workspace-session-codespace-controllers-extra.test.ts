import { computed, ref } from "vue";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useWorkspaceCodespaceController } from "../../../server-web/composables/console-workspace-codespace-controller";
import { useWorkspaceSessionController } from "../../../server-web/composables/console-workspace-session-controller";

const workspacesClientMock = vi.hoisted(() => ({
  forkWorkspaceSession: vi.fn(),
  getWorkspaceSessionBundle: vi.fn(),
  inspectCodespaceRepositoryStatus: vi.fn(),
  prepareCodespaceChangeRequest: vi.fn(),
  uploadCodespaceChangeRequest: vi.fn(),
}));

vi.mock("../../../server-web/lib/workspaces-client", () => ({
  forkWorkspaceSession: workspacesClientMock.forkWorkspaceSession,
  getWorkspaceSessionBundle: workspacesClientMock.getWorkspaceSessionBundle,
  inspectCodespaceRepositoryStatus: workspacesClientMock.inspectCodespaceRepositoryStatus,
  prepareCodespaceChangeRequest: workspacesClientMock.prepareCodespaceChangeRequest,
  uploadCodespaceChangeRequest: workspacesClientMock.uploadCodespaceChangeRequest,
}));

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-a",
    workspaceId: "workspace-a",
    workspace: { title: "Workspace A" },
    title: "Session A",
    objective: "Explore",
    eventCount: 2,
    createdAt: "2026-06-04T08:00:00.000Z",
    updatedAt: "2026-06-04T09:00:00.000Z",
    lastEvent: {
      createdAt: "2026-06-04T10:00:00.000Z",
      summary: "Last event",
    },
    ...overrides,
  } as any;
}

describe("workspace session controller extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSessionHarness() {
    const sessions = ref([
      session({
        sessionId: "old",
        title: "",
        workspaceId: "workspace-old",
        workspace: null,
        eventCount: 0,
        objective: "",
        updatedAt: "2026-06-04T08:00:00.000Z",
        lastEvent: null,
      }),
      session({
        sessionId: "new",
        parentSessionId: "old",
        branchIndex: 3,
        lastEvent: { createdAt: "2026-06-04T12:00:00.000Z", summary: "Newest" },
      }),
    ]);
    const selectedId = ref("workspace-current");
    const busy = ref("");
    const localError = ref("");
    const setBusy = vi.fn((key: string) => {
      busy.value = key;
    });
    const clearBusy = vi.fn(() => {
      busy.value = "";
    });
    const reloadWorkspaceList = vi.fn(async () => undefined);
    const controller = useWorkspaceSessionController({
      busyKey: computed(() => busy.value),
      clearBusy,
      formatCompactDate: (value) => `fmt:${value || "empty"}`,
      localError,
      reloadWorkspaceList,
      selectedId,
      sessions,
      setBusy,
    });

    return {
      busy,
      clearBusy,
      controller,
      localError,
      reloadWorkspaceList,
      selectedId,
      sessions,
      setBusy,
    };
  }

  it("orders sessions and projects panel items with active/disabled state", () => {
    const harness = createSessionHarness();
    harness.controller.selectedSessionId.value = "new";
    harness.busy.value = "ws:session";

    expect(harness.controller.sessionItems.value.map((item) => item.id)).toEqual(["new", "old"]);
    expect(harness.controller.sessionItems.value[0]).toMatchObject({
      id: "new",
      title: "Session A",
      meta: "Workspace A · 2 事件 · 分支 3 · fmt:2026-06-04T12:00:00.000Z",
      preview: "Newest",
      active: true,
      disabled: true,
      actionLabel: "分叉",
      actionAriaLabel: "从 Session A 分叉",
    });
    expect(harness.controller.sessionItems.value[1]).toMatchObject({
      id: "old",
      title: "old",
      meta: "workspace-ol · 0 事件 · 主线 · fmt:2026-06-04T08:00:00.000Z",
      preview: "暂无会话事件",
    });
  });

  it("selects and forks sessions, updating selected workspace from context", async () => {
    const harness = createSessionHarness();
    workspacesClientMock.getWorkspaceSessionBundle.mockResolvedValue({
      sessionData: { sessionId: "session-target", title: "Target" },
      context: { workspaceId: "workspace-target", entries: [] },
    });
    workspacesClientMock.forkWorkspaceSession.mockResolvedValue({
      session: { sessionId: "forked-session" },
    });

    await harness.controller.selectSession("session-target");

    expect(harness.setBusy).toHaveBeenCalledWith("ws:session");
    expect(workspacesClientMock.getWorkspaceSessionBundle).toHaveBeenCalledWith("session-target");
    expect(harness.controller.selectedSessionId.value).toBe("session-target");
    expect(harness.controller.selectedSession.value).toMatchObject({ sessionId: "session-target" });
    expect(harness.controller.sessionContextData.value).toMatchObject({ workspaceId: "workspace-target" });
    expect(harness.selectedId.value).toBe("workspace-target");
    expect(harness.clearBusy).toHaveBeenCalled();

    await harness.controller.forkSession("session-target");

    expect(harness.setBusy).toHaveBeenCalledWith("ws:fork");
    expect(workspacesClientMock.forkWorkspaceSession).toHaveBeenCalledWith("session-target");
    expect(harness.reloadWorkspaceList).toHaveBeenCalledTimes(1);
    expect(workspacesClientMock.getWorkspaceSessionBundle).toHaveBeenCalledWith("forked-session");
  });

  it("handles empty ids and client errors without changing selection", async () => {
    const harness = createSessionHarness();

    await harness.controller.selectSession("");
    await harness.controller.forkSession("");
    expect(harness.setBusy).not.toHaveBeenCalled();

    workspacesClientMock.getWorkspaceSessionBundle.mockRejectedValue(new Error("session failed"));
    await harness.controller.selectSession("bad-session");

    expect(harness.localError.value).toBe("session failed");
    expect(harness.controller.selectedSessionId.value).toBe("");
  });
});

describe("workspace codespace controller extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createCodespaceHarness(selectedWorkspaceId = "workspace-1") {
    const selectedId = ref(selectedWorkspaceId);
    const localError = ref("");
    const busy = ref("");
    const setBusy = vi.fn((key: string) => {
      busy.value = key;
    });
    const clearBusy = vi.fn(() => {
      busy.value = "";
    });
    const controller = useWorkspaceCodespaceController({
      clearBusy,
      localError,
      selectedId,
      selectedWorkspaceTitle: () => "Repo From Workspace",
      setBusy,
    });
    return {
      busy,
      clearBusy,
      controller,
      localError,
      selectedId,
      setBusy,
    };
  }

  it("opens, resets, and inspects codespace status", async () => {
    const harness = createCodespaceHarness();
    harness.controller.setCodespaceData({ status: "cached" } as any);
    expect(harness.controller.codespaceData.value).toEqual({ status: "cached" });

    expect(harness.controller.openCodespace()).toBe("codespace");
    expect(harness.controller.codespaceForm.repositoryRef).toBe("Repo From Workspace");
    expect(harness.controller.codespaceResult.value).toBeNull();

    workspacesClientMock.inspectCodespaceRepositoryStatus.mockResolvedValue({ ok: true });
    await harness.controller.inspectCodespaceStatus();

    expect(harness.setBusy).toHaveBeenCalledWith("ws:codespace-status");
    expect(workspacesClientMock.inspectCodespaceRepositoryStatus).toHaveBeenCalledWith({
      provider: "github",
      repoId: undefined,
      repositoryRef: "Repo From Workspace",
      branch: "main",
    });
    expect(harness.controller.codespaceResult.value).toEqual({ ok: true });

    harness.controller.resetCodespaceState();
    expect(harness.controller.codespaceData.value).toBeNull();
    expect(harness.controller.codespaceResult.value).toBeNull();
  });

  it("prepares and uploads codespace changes with normalized payloads", async () => {
    const harness = createCodespaceHarness();
    harness.controller.codespaceForm.repositoryRef = "";
    harness.controller.codespaceForm.repoId = "repo-1";
    harness.controller.codespaceForm.diff = "diff --git a/a b/a\n";
    workspacesClientMock.prepareCodespaceChangeRequest.mockResolvedValue({
      codeChange: { codeChangeId: "change-from-object" },
    });

    await harness.controller.prepareCodespaceChange();

    expect(harness.setBusy).toHaveBeenCalledWith("ws:codespace-prepare");
    expect(workspacesClientMock.prepareCodespaceChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        repositoryRef: "repo-1",
        dataClass: "codeChange",
        policy: { decision: "allow", source: "console" },
        checkpoint: { workspaceId: "workspace-1" },
      }),
    );
    expect(harness.controller.codespaceForm.codeChangeId).toBe("change-from-object");

    harness.controller.codespaceForm.repositoryRef = "owner/repo";
    harness.controller.codespaceForm.headRef = "";
    workspacesClientMock.uploadCodespaceChangeRequest.mockResolvedValue({ uploaded: true });

    await harness.controller.uploadCodespaceChange();

    expect(harness.setBusy).toHaveBeenCalledWith("ws:codespace-upload");
    expect(workspacesClientMock.uploadCodespaceChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        codeChangeId: "change-from-object",
        provider: "github",
        repositoryRef: "owner/repo",
        branch: "main",
        sourceRef: "HEAD",
        targetRef: "main",
        dryRun: true,
        confirm: true,
      }),
    );
    expect(harness.controller.codespaceResult.value).toEqual({ uploaded: true });
  });

  it("short-circuits prepare/upload without workspace and reports client errors", async () => {
    const noWorkspace = createCodespaceHarness("");
    await noWorkspace.controller.prepareCodespaceChange();
    await noWorkspace.controller.uploadCodespaceChange();
    expect(workspacesClientMock.prepareCodespaceChangeRequest).not.toHaveBeenCalled();
    expect(workspacesClientMock.uploadCodespaceChangeRequest).not.toHaveBeenCalled();

    const failing = createCodespaceHarness();
    workspacesClientMock.inspectCodespaceRepositoryStatus.mockRejectedValue(new Error("inspect failed"));
    await failing.controller.inspectCodespaceStatus();
    expect(failing.localError.value).toBe("inspect failed");

    workspacesClientMock.prepareCodespaceChangeRequest.mockRejectedValue(new Error("prepare failed"));
    await failing.controller.prepareCodespaceChange();
    expect(failing.localError.value).toBe("prepare failed");

    workspacesClientMock.uploadCodespaceChangeRequest.mockRejectedValue(new Error("upload failed"));
    await failing.controller.uploadCodespaceChange();
    expect(failing.localError.value).toBe("upload failed");
  });
});
