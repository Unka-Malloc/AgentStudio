// @vitest-environment jsdom
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type {
  AgentModelOption,
  DistillationModelProbeStatus,
} from "../../../server-web/lib/knowledge-distillation-workbench";
import { createKnowledgeDistillationModelProbeController } from "../../../server-web/composables/knowledge-distillation-model-probe-controller";

const workbenchClientMock = vi.hoisted(() => ({
  probeDistillationModelStatus: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", async () => {
  const actual = await vi.importActual<typeof import("../../../server-web/lib/knowledge-distillation-workbench")>(
    "../../../server-web/lib/knowledge-distillation-workbench",
  );
  return {
    ...actual,
    probeDistillationModelStatus: workbenchClientMock.probeDistillationModelStatus,
  };
});

const timeoutControllerState = vi.hoisted(() => ({
  schedule: vi.fn(),
  stop: vi.fn(),
  lastSchedule: null as null | { callback: () => void; delayMs: number },
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleTimeoutController: vi.fn(() => ({
    current: vi.fn(() => null),
    schedule: timeoutControllerState.schedule,
    stop: timeoutControllerState.stop,
    timer: { value: null },
  })),
}));

timeoutControllerState.schedule.mockImplementation((callback: () => void, delayMs: number) => {
  timeoutControllerState.lastSchedule = { callback, delayMs };
  return 1;
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function mountController(options: {
  createOptions?: ReturnType<typeof ref<{ modelAlias: string }>>;
  formatCompactDate?: (value: string) => string;
  modelOptions?: () => AgentModelOption[] | undefined;
} = {}) {
  const createOptions = options.createOptions || ref({ modelAlias: "" });
  const formatCompactDate = options.formatCompactDate || ((value: string) => `compact:${value}`);
  const modelOptions = options.modelOptions || (() => []);
  let controller!: ReturnType<typeof createKnowledgeDistillationModelProbeController>;

  const wrapper = mount(defineComponent({
    setup() {
      controller = createKnowledgeDistillationModelProbeController({
        createOptions,
        formatCompactDate,
        modelOptions,
      });
      return () => null;
    },
  }));

  return {
    controller,
    createOptions,
    wrapper,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  vi.clearAllMocks();
  workbenchClientMock.probeDistillationModelStatus.mockReset();
  timeoutControllerState.schedule.mockReset();
  timeoutControllerState.stop.mockReset();
  timeoutControllerState.lastSchedule = null;
  timeoutControllerState.schedule.mockImplementation((callback: () => void, delayMs: number) => {
    timeoutControllerState.lastSchedule = { callback, delayMs };
    return 1;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("knowledge distillation model probe controller extra coverage", () => {
  it("preserves a valid alias, exposes ready state, and starts from neutral tooltip text", async () => {
    const { controller, createOptions, wrapper } = mountController({
      createOptions: ref({ modelAlias: "  beta  " }),
      modelOptions: () => [
        {
          agentUid: "alpha",
          value: "alpha",
          label: "Alpha",
          enabled: true,
          selectable: true,
        },
        {
          agentUid: "beta",
          value: "beta",
          label: "Beta",
          enabled: true,
          selectable: true,
        },
      ],
    });

    await nextTick();

    expect(createOptions.value.modelAlias).toBe("  beta  ");
    expect(controller.distillationModelOptions.value).toHaveLength(2);
    expect(controller.selectedModelReady.value).toBe(true);
    expect(controller.modelProbeLabel.value).toBe("未检测");
    expect(controller.modelProbeTone.value).toBe("neutral");
    expect(controller.modelProbeTooltip.value).toBe("模型状态尚未检测");

    wrapper.unmount();
  });

  it("normalizes invalid aliases, falls back to the first option, and clears orphaned aliases when options disappear", async () => {
    const optionsList = ref<AgentModelOption[]>([
      {
        agentUid: "fallback-1",
        value: "fallback-1",
        label: "Fallback One",
        enabled: false,
        selectable: false,
      },
      {
        agentUid: "fallback-2",
        value: "fallback-2",
        label: "Fallback Two",
        enabled: false,
        selectable: false,
      },
    ]);
    const { controller, createOptions, wrapper } = mountController({
      createOptions: ref({ modelAlias: "missing-model" }),
      modelOptions: () => optionsList.value,
    });

    await nextTick();

    expect(createOptions.value.modelAlias).toBe("fallback-1");
    expect(controller.selectedModelReady.value).toBe(false);

    createOptions.value.modelAlias = "orphaned-model";
    optionsList.value = [];
    await nextTick();

    expect(createOptions.value.modelAlias).toBe("");
    expect(controller.distillationModelOptions.value).toEqual([]);
    expect(controller.selectedModelReady.value).toBe(false);

    wrapper.unmount();
  });

  it("refreshes probe status, ignores stale responses, surfaces failures, and stops pending timeouts on unmount", async () => {
    const createOptions = ref({ modelAlias: "alpha" });
    const firstResult = createDeferred<DistillationModelProbeStatus>();
    const secondResult = createDeferred<DistillationModelProbeStatus>();
    workbenchClientMock.probeDistillationModelStatus
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise)
      .mockResolvedValueOnce({
        state: "unconfigured",
        checkedAt: "2026-06-04T12:30:00.000Z",
        message: "当前模型库为空。",
      })
      .mockRejectedValueOnce(new Error("探测失败"))
      .mockRejectedValueOnce("unexpected failure");

    const { controller, wrapper } = mountController({
      createOptions,
      formatCompactDate: (value) => `compact:${value}`,
      modelOptions: () => [
        {
          agentUid: "alpha",
          value: "alpha",
          label: "Alpha",
          enabled: true,
          selectable: true,
        },
        {
          agentUid: "beta",
          value: "beta",
          label: "Beta",
          enabled: true,
          selectable: true,
        },
      ],
    });

    await nextTick();
    timeoutControllerState.schedule.mockClear();

    createOptions.value.modelAlias = "  beta  ";
    await nextTick();

    expect(timeoutControllerState.schedule).toHaveBeenCalledWith(expect.any(Function), 700);
    expect(timeoutControllerState.lastSchedule?.delayMs).toBe(700);
    expect(workbenchClientMock.probeDistillationModelStatus).not.toHaveBeenCalled();

    timeoutControllerState.lastSchedule?.callback();
    expect(controller.modelProbeLabel.value).toBe("检测中");
    expect(controller.modelProbeTone.value).toBe("info");
    expect(controller.modelProbeTooltip.value).toBe("模型状态尚未检测");

    const secondRefresh = controller.refreshModelProbeStatus();
    secondResult.resolve({
      state: "online",
      checkedAt: "2026-06-04T12:10:00.000Z",
      message: "模型已在线",
    });
    await secondResult.promise;
    await secondRefresh;
    await nextTick();

    expect(workbenchClientMock.probeDistillationModelStatus).toHaveBeenCalledWith("beta");
    expect(controller.modelProbeLabel.value).toBe("模型在线");
    expect(controller.modelProbeTone.value).toBe("success");
    expect(controller.modelProbeTooltip.value).toBe("模型已在线 · 检测时间：compact:2026-06-04T12:10:00.000Z");

    firstResult.resolve({
      state: "online",
      checkedAt: "2026-06-04T12:15:00.000Z",
      message: "已过时的结果",
    });
    await firstResult.promise;
    await nextTick();

    expect(controller.modelProbeLabel.value).toBe("模型在线");
    expect(controller.modelProbeTone.value).toBe("success");
    expect(controller.modelProbeTooltip.value).toBe("模型已在线 · 检测时间：compact:2026-06-04T12:10:00.000Z");

    await controller.refreshModelProbeStatus();
    await nextTick();

    expect(controller.modelProbeLabel.value).toBe("模型未配置");
    expect(controller.modelProbeTone.value).toBe("danger");
    expect(controller.modelProbeTooltip.value).toBe("当前模型库为空。 · 检测时间：compact:2026-06-04T12:30:00.000Z");

    await controller.refreshModelProbeStatus();
    await nextTick();

    expect(controller.modelProbeLabel.value).toBe("模型离线");
    expect(controller.modelProbeTone.value).toBe("danger");
    expect(controller.modelProbeTooltip.value).toBe("探测失败 · 检测时间：compact:2026-06-04T12:00:00.000Z");

    await controller.refreshModelProbeStatus();
    await nextTick();

    expect(controller.modelProbeLabel.value).toBe("模型离线");
    expect(controller.modelProbeTone.value).toBe("danger");
    expect(controller.modelProbeTooltip.value).toBe("模型状态检测失败。 · 检测时间：compact:2026-06-04T12:00:00.000Z");

    wrapper.unmount();
    expect(timeoutControllerState.stop).toHaveBeenCalledTimes(1);
  });
});
