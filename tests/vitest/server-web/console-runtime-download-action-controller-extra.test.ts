// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRuntimeDownloadActionController } from "../../../server-web/composables/console-runtime-download-action-controller";
import type {
  RuntimeDependency,
  RuntimeDependencyActionResult,
  RuntimeDependencyDownloadRun,
} from "../../../server-web/lib/runtime-dependencies";

const intervalControllerState = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleIntervalController: vi.fn(() => ({
    current: vi.fn(() => null),
    start: vi.fn((callback: () => void, intervalMs: number) => {
      intervalControllerState.start(callback, intervalMs);
      return 1;
    }),
    stop: vi.fn(() => {
      intervalControllerState.stop();
    }),
    timer: { value: null },
  })),
}));

function makeDependency(overrides: Partial<RuntimeDependency> = {}): RuntimeDependency {
  return {
    id: "jre",
    label: "JRE",
    status: "queued",
    downloadable: true,
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<RuntimeDependencyDownloadRun> & Pick<RuntimeDependencyDownloadRun, "runId" | "targetId" | "status">,
): RuntimeDependencyDownloadRun {
  return {
    ok: true,
    startedAt: "2026-06-04T10:00:00.000Z",
    updatedAt: "2026-06-04T10:00:00.000Z",
    latestMessage: "已完成",
    steps: [
      {
        key: "detect",
        label: "检测",
        status: "completed",
      },
      {
        key: "download",
        label: "下载",
        status: "running",
      },
    ],
    completedSteps: 1,
    totalSteps: 2,
    currentStepKey: "download",
    currentStepIndex: 1,
    progressPercent: 50,
    log: [
      {
        at: "2026-06-04T10:00:00.000Z",
        level: "info",
        message: "下载开始",
      },
    ],
    result: null,
    ...overrides,
  };
}

function makeController() {
  const downloadRuntimeDependency = vi.fn();
  const refreshRuntimeDependencies = vi.fn();
  const controller = createRuntimeDownloadActionController({
    downloadRuntimeDependency: downloadRuntimeDependency as (item: RuntimeDependency) => Promise<RuntimeDependencyActionResult>,
    refreshRuntimeDependencies: refreshRuntimeDependencies as (options?: { silent?: boolean }) => Promise<void>,
  });

  return {
    controller,
    downloadRuntimeDependency,
    refreshRuntimeDependencies,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T10:00:00.000Z"));
  vi.clearAllMocks();
  intervalControllerState.start.mockReset();
  intervalControllerState.stop.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("console runtime download action controller extra coverage", () => {
  it("tracks active downloads, derives cards, and stops polling once only inactive runs remain", () => {
    const { controller } = makeController();
    const activeRun = makeRun({
      runId: "run-active",
      targetId: "jre",
      status: "running",
      latestMessage: "进行中",
    });
    const completedRuns = Array.from({ length: 9 }, (_, index) =>
      makeRun({
        runId: `run-${index + 1}`,
        targetId: `target-${index + 1}`,
        status: "completed",
        completedSteps: 2,
        totalSteps: 2,
        currentStepKey: "complete",
        currentStepIndex: 1,
        progressPercent: 100,
        latestMessage: `完成 ${index + 1}`,
      }),
    );

    controller.setDownloadRuns([activeRun, ...completedRuns]);

    expect(controller.dependencyStatusForRow(makeDependency())).toBe("running");
    expect(controller.dependencyActionBusy("jre")).toBe(true);
    expect(controller.dependencyRunCardForTarget("jre")).toMatchObject({
      run: activeRun,
      logEntries: [
        expect.objectContaining({
          level: "info",
          message: "下载开始",
        }),
      ],
      progressState: {
        completedSteps: 1,
        detail: "进行中",
        label: "1/2",
        progressPercent: 50,
        totalSteps: 2,
        segments: [
          { key: "detect", label: "检测", state: "complete" },
          { key: "download", label: "下载", state: "active" },
        ],
      },
    });
    expect(controller.actionRunCards.value).toHaveLength(8);
    expect(controller.actionRunCards.value[0]).toMatchObject({ run: activeRun });
    expect(intervalControllerState.stop).not.toHaveBeenCalled();

    controller.setDownloadRuns(completedRuns);

    expect(controller.dependencyActionBusy("jre")).toBe(false);
    expect(controller.dependencyStatusForRow(makeDependency())).toBe("queued");
    expect(intervalControllerState.stop).toHaveBeenCalledTimes(1);
  });

  it("prepares a dependency successfully, refreshes silently, and clears polling after completion", async () => {
    const { controller, downloadRuntimeDependency, refreshRuntimeDependencies } = makeController();
    const item = makeDependency({ id: "jre", label: "JRE", status: "queued" });
    const queuedRun = makeRun({
      runId: "runtime_local_jre_1",
      targetId: "jre",
      status: "queued",
      latestMessage: "等待后台任务开始。",
      progressPercent: 0,
      completedSteps: 0,
      totalSteps: 5,
    });
    const completedRun = makeRun({
      runId: "runtime_remote_jre_1",
      targetId: "jre",
      status: "completed",
      latestMessage: "安装完成",
      progressPercent: 100,
      completedSteps: 5,
      totalSteps: 5,
      currentStepKey: "complete",
      currentStepIndex: 4,
    });
    const result: RuntimeDependencyActionResult = {
      ok: true,
      targetId: "jre",
      status: "completed",
      runId: "runtime_remote_jre_1",
      run: completedRun,
      log: [
        {
          at: "2026-06-04T10:00:00.000Z",
          level: "info",
          message: "安装完成",
        },
      ],
    };

    downloadRuntimeDependency.mockResolvedValueOnce(result);

    await controller.prepareDependency(item);

    expect(downloadRuntimeDependency).toHaveBeenCalledWith(item);
    expect(refreshRuntimeDependencies).toHaveBeenCalledWith({ silent: true });
    expect(controller.actionError.value).toBe("");
    expect(controller.actionResult.value).toEqual(result);
    expect(controller.downloads.value[0]).toEqual(completedRun);
    expect(controller.dependencyActionBusy("jre")).toBe(false);
    expect(controller.dependencyStatusForRow(item)).toBe("queued");
    expect(intervalControllerState.start).toHaveBeenCalledWith(expect.any(Function), 800);
    expect(intervalControllerState.stop).toHaveBeenCalledTimes(2);

    controller.setDownloadRuns([queuedRun]);
    expect(controller.dependencyStatusForRow(item)).toBe("queued");
  });

  it("marks failed downloads, preserves the error message, and clears the busy state", async () => {
    const { controller, downloadRuntimeDependency, refreshRuntimeDependencies } = makeController();
    const item = makeDependency({ id: "node", label: "Node.js", status: "queued" });
    downloadRuntimeDependency.mockRejectedValueOnce(new Error("download failed"));

    await controller.prepareDependency(item);

    expect(downloadRuntimeDependency).toHaveBeenCalledWith(item);
    expect(refreshRuntimeDependencies).not.toHaveBeenCalled();
    expect(controller.actionError.value).toBe("download failed");
    expect(controller.actionResult.value).toBeNull();
    expect(controller.dependencyActionBusy("node")).toBe(false);
    expect(controller.downloads.value).toHaveLength(1);
    expect(controller.downloads.value[0]).toMatchObject({
      targetId: "node",
      status: "failed",
      ok: false,
      latestMessage: "download failed",
      steps: [
        expect.objectContaining({ key: "detect", status: "failed" }),
        expect.objectContaining({ key: "verify", status: "pending" }),
        expect.objectContaining({ key: "complete", status: "pending" }),
      ],
      log: [
        expect.objectContaining({
          level: "info",
          message: "已提交安装请求：node",
        }),
        expect.objectContaining({
          level: "error",
          message: "download failed",
        }),
      ],
    });
    expect(intervalControllerState.start).toHaveBeenCalledWith(expect.any(Function), 800);
    expect(intervalControllerState.stop).toHaveBeenCalledTimes(2);
  });

  it("does not trigger a second download while the target is already active", async () => {
    const { controller, downloadRuntimeDependency, refreshRuntimeDependencies } = makeController();
    const item = makeDependency({ id: "python", label: "Python", status: "queued" });
    controller.setDownloadRuns([
      makeRun({
        runId: "runtime_local_python_1",
        targetId: "python",
        status: "running",
      }),
    ]);

    await controller.prepareDependency(item);

    expect(downloadRuntimeDependency).not.toHaveBeenCalled();
    expect(refreshRuntimeDependencies).not.toHaveBeenCalled();
    expect(controller.actionError.value).toBe("");
    expect(controller.actionResult.value).toBeNull();
    expect(controller.downloads.value).toHaveLength(1);
    expect(intervalControllerState.start).not.toHaveBeenCalled();
    expect(intervalControllerState.stop).not.toHaveBeenCalled();
  });
});
