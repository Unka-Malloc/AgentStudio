// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourcesViewController } from "../../../server-web/composables/sources-view-controller";

const timerControllerMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleIntervalController: vi.fn(() => ({
    current: vi.fn(() => null),
    start: timerControllerMocks.start,
    stop: timerControllerMocks.stop,
    timer: { value: null },
  })),
}));

type SourcesController = ReturnType<typeof useSourcesViewController>;

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    addKnowledgeSource: vi.fn(async () => true),
    openAdmin: vi.fn(),
    refreshKnowledgeSources: vi.fn(async () => undefined),
    ...overrides,
  };
}

function mountController(context = makeContext()) {
  let controller: SourcesController | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        controller = useSourcesViewController(context as Parameters<typeof useSourcesViewController>[0]);
        return () => h("div");
      },
    }),
  );
  return {
    context,
    controller: () => {
      if (!controller) throw new Error("sources controller was not mounted");
      return controller;
    },
    wrapper,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sources view controller extra coverage", () => {
  it("refreshes on mount, starts polling, and stops polling on unmount", async () => {
    const { context, wrapper } = mountController();
    await nextTick();

    expect(context.refreshKnowledgeSources).toHaveBeenCalledTimes(1);
    expect(timerControllerMocks.start).toHaveBeenCalledWith(expect.any(Function), 3000);

    const pollingCallback = timerControllerMocks.start.mock.calls[0][0] as () => void;
    pollingCallback();
    expect(context.refreshKnowledgeSources).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    expect(timerControllerMocks.stop).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the add data source dialog", () => {
    const { controller } = mountController();

    controller().selectedDataSourceType.value = "client";
    controller().openAddDataSourceDialog();
    expect(controller().addDataSourceDialogOpen.value).toBe(true);
    expect(controller().selectedDataSourceType.value).toBe("");

    controller().selectedDataSourceType.value = "localDirectory";
    controller().closeAddDataSourceDialog();
    expect(controller().addDataSourceDialogOpen.value).toBe(false);
    expect(controller().selectedDataSourceType.value).toBe("");
  });

  it("submits local directory sources and closes only after successful add", async () => {
    const addKnowledgeSource = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { controller } = mountController(makeContext({ addKnowledgeSource }));

    controller().openAddDataSourceDialog();
    controller().selectedDataSourceType.value = "localDirectory";
    await controller().submitSelectedDataSource();

    expect(addKnowledgeSource).toHaveBeenCalledTimes(1);
    expect(controller().addDataSourceDialogOpen.value).toBe(true);
    expect(controller().selectedDataSourceType.value).toBe("localDirectory");

    await controller().submitSelectedDataSource();

    expect(addKnowledgeSource).toHaveBeenCalledTimes(2);
    expect(controller().addDataSourceDialogOpen.value).toBe(false);
    expect(controller().selectedDataSourceType.value).toBe("");
  });

  it("routes client sources to the clients admin page and ignores empty selection", async () => {
    const { context, controller } = mountController();

    controller().openAddDataSourceDialog();
    await controller().submitSelectedDataSource();
    expect(context.addKnowledgeSource).not.toHaveBeenCalled();
    expect(context.openAdmin).not.toHaveBeenCalled();
    expect(controller().addDataSourceDialogOpen.value).toBe(true);

    controller().selectedDataSourceType.value = "client";
    await controller().submitSelectedDataSource();

    expect(context.addKnowledgeSource).not.toHaveBeenCalled();
    expect(context.openAdmin).toHaveBeenCalledWith("clients");
    expect(controller().addDataSourceDialogOpen.value).toBe(false);
    expect(controller().selectedDataSourceType.value).toBe("");
  });
});
