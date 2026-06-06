// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeDownloadsViewController } from "../../../server-web/composables/console-runtime-downloads-view-controller";
import { collectPageRefreshTasks } from "../../../server-web/composables/usePageRefresh";
import type { RuntimeDependencyListResponse } from "../../../server-web/lib/runtime-dependencies";

const runtimeDependencyMocks = vi.hoisted(() => ({
  downloadRuntimeDependency: vi.fn(),
  listRuntimeDependencies: vi.fn(),
}));

vi.mock("../../../server-web/lib/runtime-dependencies", async () => {
  const actual = await vi.importActual<typeof import("../../../server-web/lib/runtime-dependencies")>(
    "../../../server-web/lib/runtime-dependencies",
  );
  return {
    ...actual,
    downloadRuntimeDependency: runtimeDependencyMocks.downloadRuntimeDependency,
    listRuntimeDependencies: runtimeDependencyMocks.listRuntimeDependencies,
  };
});

type RuntimeDownloadsController = ReturnType<typeof useRuntimeDownloadsViewController>;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function makeListResponse(overrides: Partial<RuntimeDependencyListResponse> = {}): RuntimeDependencyListResponse {
  return {
    cacheRoot: "/tmp/pact-runtime-cache",
    dependencies: [],
    downloads: [],
    generatedAt: "",
    sourceConfigPath: "/tmp/pact-runtime-config.json",
    ...overrides,
  };
}

function mountController() {
  let controller: RuntimeDownloadsController | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        controller = useRuntimeDownloadsViewController();
        return () => h("div");
      },
    }),
  );
  return {
    controller: () => {
      if (!controller) throw new Error("runtime downloads controller was not mounted");
      return controller;
    },
    wrapper,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console runtime downloads view controller extra coverage", () => {
  it("loads runtime dependencies on mount and derives summary state", async () => {
    const initialLoad = deferred<RuntimeDependencyListResponse>();
    runtimeDependencyMocks.listRuntimeDependencies.mockReturnValueOnce(initialLoad.promise);

    const { controller, wrapper } = mountController();
    expect(controller().loading.value).toBe(true);
    expect(controller().generatedAtLabel.value).toBe("未生成");

    initialLoad.resolve(makeListResponse({
      dependencies: [
        {
          id: "programming-runtimes",
          label: "Programming runtimes",
          status: "present",
          children: [
            { id: "java", label: "JDK", present: true, status: "installed" },
            { id: "python", label: "Python", present: false, status: "failed" },
          ],
        },
        { id: "docker", label: "Docker", present: true, status: "present" },
      ],
      downloads: [
        {
          completedSteps: 1,
          currentStepIndex: 0,
          currentStepKey: "detect",
          latestMessage: "检测中",
          log: [],
          ok: true,
          progressPercent: 25,
          result: null,
          runId: "run-docker",
          startedAt: "2026-06-04T01:00:00.000Z",
          status: "running",
          steps: [],
          targetId: "docker",
          totalSteps: 4,
          updatedAt: "2026-06-04T01:00:00.000Z",
        },
      ],
      generatedAt: "2026-06-04T02:30:00.000Z",
    }));
    await flushPromises();
    await nextTick();

    expect(runtimeDependencyMocks.listRuntimeDependencies).toHaveBeenCalledTimes(1);
    expect(controller().loading.value).toBe(false);
    expect(controller().loadError.value).toBe("");
    expect(controller().cacheRoot.value).toBe("/tmp/pact-runtime-cache");
    expect(controller().sourceConfigPath.value).toBe("/tmp/pact-runtime-config.json");
    expect(controller().dependencies.value.map((item) => item.id)).toEqual(["java", "python", "docker"]);
    expect(controller().dependencies.value[0]?.label).toBe("Java 环境");
    expect(controller().readyCount.value).toBe(2);
    expect(controller().installedCount.value).toBe(1);
    expect(controller().failedCount.value).toBe(1);
    expect(controller().generatedAtLabel.value).toContain("2026");
    expect(controller().dependencyActionBusy("docker")).toBe(true);

    wrapper.unmount();
  });

  it("refreshes from matching page refresh events and ignores unrelated events", async () => {
    runtimeDependencyMocks.listRuntimeDependencies
      .mockResolvedValueOnce(makeListResponse({ generatedAt: "invalid-date" }))
      .mockResolvedValueOnce(makeListResponse({
        dependencies: [{ id: "nginx", label: "Nginx", present: false, status: "queued" }],
        generatedAt: "2026-06-04T04:00:00.000Z",
      }));

    const { controller, wrapper } = mountController();
    await flushPromises();
    await nextTick();
    expect(controller().generatedAtLabel.value).toBe("invalid-date");

    const unrelatedTasks = collectPageRefreshTasks({
      adminView: "runtimeDownloads",
      debugTab: "",
      knowledgeTab: "",
      routePath: "/admin/runtime-downloads",
      viewId: "knowledge",
    });
    expect(unrelatedTasks).toHaveLength(0);

    const tasks = collectPageRefreshTasks({
      adminView: "runtimeDownloads",
      debugTab: "",
      knowledgeTab: "",
      routePath: "/admin/runtime-downloads",
      viewId: "admin",
    });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    await nextTick();

    expect(runtimeDependencyMocks.listRuntimeDependencies).toHaveBeenCalledTimes(2);
    expect(controller().dependencies.value).toMatchObject([
      { id: "nginx", label: "Nginx", status: "queued" },
    ]);
    expect(controller().generatedAtLabel.value).toContain("2026");

    wrapper.unmount();
  });

  it("keeps the spinner stable for silent refreshes and records load failures", async () => {
    runtimeDependencyMocks.listRuntimeDependencies.mockResolvedValueOnce(makeListResponse());
    const { controller, wrapper } = mountController();
    await flushPromises();
    await nextTick();

    const silentRefresh = deferred<RuntimeDependencyListResponse>();
    runtimeDependencyMocks.listRuntimeDependencies.mockReturnValueOnce(silentRefresh.promise);
    const silentRefreshPromise = controller().refreshRuntimeDependencies({ silent: true });
    expect(controller().loading.value).toBe(false);
    silentRefresh.resolve(makeListResponse({
      cacheRoot: "/runtime-cache-next",
      dependencies: [{ id: "caddy", label: "Caddy", present: true, status: "installed" }],
    }));
    await silentRefreshPromise;

    expect(controller().cacheRoot.value).toBe("/runtime-cache-next");
    expect(controller().installedCount.value).toBe(1);
    expect(controller().loadError.value).toBe("");

    runtimeDependencyMocks.listRuntimeDependencies.mockRejectedValueOnce("plain failure");
    const failedRefreshPromise = controller().refreshRuntimeDependencies();
    expect(controller().loading.value).toBe(true);
    await failedRefreshPromise;

    expect(controller().loading.value).toBe(false);
    expect(controller().loadError.value).toBe("plain failure");
    expect(controller().dependencies.value).toMatchObject([
      { id: "caddy", label: "Caddy", status: "installed" },
    ]);

    wrapper.unmount();
  });
});
