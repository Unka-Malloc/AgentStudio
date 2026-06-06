// @vitest-environment jsdom
import { computed, defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleOpsMonitorController } from "../../../server-web/composables/console-ops-monitor-controller";
import { createConsoleRuleAuthoringController } from "../../../server-web/composables/console-rule-authoring-controller";
import { useKnowledgeDistillationWorkbench } from "../../../server-web/composables/knowledge-distillation-workbench-controller";

const pageRefreshHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

const confirmActionMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: confirmActionMock,
}));

const modelProbeState = vi.hoisted(() => ({
  selectedModelReady: true,
  refreshModelProbeStatus: vi.fn(),
}));

vi.mock("../../../server-web/composables/knowledge-distillation-model-probe-controller", () => ({
  createKnowledgeDistillationModelProbeController: vi.fn(() => ({
    distillationModelOptions: computed(() => []),
    modelProbeLabel: computed(() => "模型在线"),
    modelProbeTone: computed(() => "success"),
    modelProbeTooltip: computed(() => "模型已检测"),
    refreshModelProbeStatus: modelProbeState.refreshModelProbeStatus,
    selectedModelReady: computed(() => modelProbeState.selectedModelReady),
  })),
}));

const intervalControllerState = vi.hoisted(() => ({
  instances: 0,
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  createConsoleIntervalController: vi.fn(() => {
    const state = {
      timer: { value: null as number | null },
      current: vi.fn(() => state.timer.value),
      start: vi.fn((callback: () => void, intervalMs: number) => {
        intervalControllerState.start(callback, intervalMs);
        return 1;
      }),
      stop: vi.fn(() => {
        intervalControllerState.stop();
        state.timer.value = null;
      }),
    };
    intervalControllerState.instances += 1;
    return state;
  }),
}));

const knowledgeWorkbenchClient = vi.hoisted(() => ({
  archiveKnowledgeDistillationWorkbenchRun: vi.fn(),
  cancelKnowledgeDistillationWorkbenchRun: vi.fn(),
  compareKnowledgeDistillationWorkbenchRuns: vi.fn(),
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  deleteKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  listKnowledgeDistillationWorkbenchRuns: vi.fn(),
  knowledgeDistillationWorkbenchPackageUrl: vi.fn((runId: string) => `/package/${runId}`),
  resumeKnowledgeDistillationWorkbenchRun: vi.fn(),
  rerunKnowledgeDistillationWorkbenchStage: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", () => ({
  archiveKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.archiveKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns:
    knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun,
  knowledgeDistillationWorkbenchPackageUrl:
    knowledgeWorkbenchClient.knowledgeDistillationWorkbenchPackageUrl,
  listKnowledgeDistillationWorkbenchRuns:
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns,
  probeDistillationModelStatus: vi.fn(),
  rerunKnowledgeDistillationWorkbenchStage:
    knowledgeWorkbenchClient.rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun:
    knowledgeWorkbenchClient.resumeKnowledgeDistillationWorkbenchRun,
}));

const ruleAuthoringClient = vi.hoisted(() => ({
  chatKnowledgeRuleAuthoring: vi.fn(),
  publishGoldenRules: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-rules-client", () => ({
  chatKnowledgeRuleAuthoring: ruleAuthoringClient.chatKnowledgeRuleAuthoring,
  publishGoldenRules: ruleAuthoringClient.publishGoldenRules,
}));

const opsMonitorClient = vi.hoisted(() => ({
  acknowledgeMonitorAlert: vi.fn(),
  getBackgroundProcesses: vi.fn(),
  getClientRuntimeStatus: vi.fn(),
  getMonitorAlerts: vi.fn(),
  recoverBackgroundSupervisor: vi.fn(),
  saveMonitorAlertConfig: vi.fn(),
}));

vi.mock("../../../server-web/lib/ops-monitor-client", () => ({
  acknowledgeMonitorAlert: opsMonitorClient.acknowledgeMonitorAlert,
  getBackgroundProcesses: opsMonitorClient.getBackgroundProcesses,
  getClientRuntimeStatus: opsMonitorClient.getClientRuntimeStatus,
  getMonitorAlerts: opsMonitorClient.getMonitorAlerts,
  recoverBackgroundSupervisor: opsMonitorClient.recoverBackgroundSupervisor,
  saveMonitorAlertConfig: opsMonitorClient.saveMonitorAlertConfig,
}));

const distillationRuns = (overrides: Record<string, unknown> = {}) => ({
  runId: "run-1",
  title: "run-1",
  status: "completed",
  stages: [],
  ...overrides,
  jobId: "job-1",
  batchId: "batch-1",
  progressPercent: 0,
});

const queueMonitorRun = (overrides: Record<string, unknown> = {}) => ({
  runId: "maintenance-1",
  status: "running",
  trigger: "timer",
  source: "maintenance-agent",
  intent: "check",
  summary: "run",
  risk: "read_only",
  requiresApproval: false,
  approvalReason: "",
  planHash: "hash",
  plan: {
    summary: "review",
    risk: "read_only",
    requiresApproval: false,
    source: "default",
    intent: "check",
    schemaVersion: 1,
    status: "running",
    reason: "",
    steps: [],
  },
  steps: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:00:00Z",
  approvedAt: "2026-01-01T00:00:00Z",
  error: "",
  actor: null,
  unifiedRegistration: {
    schemaVersion: 1,
    registrationId: "run:maintenance-1",
    originalType: "task",
    originalId: "maintenance-1",
    label: "maintenance-1",
    status: "running",
    tone: "running",
    source: "maintenance-agent",
    registeredAt: "2026-01-01T00:00:00Z",
    route: { originalType: "task", section: "maintenance", behavior: "run" },
    relations: {},
    attributes: { status: "running", lifecycleStatus: "running", stage: "running", queueId: "queue-1" },
    originalRef: {},
  },
  ...overrides,
});

function mountKnowledgeController(overrides: Record<string, any> = {}) {
  const setupProps = {
    canReadKnowledge: true,
    canMaintainKnowledge: true,
    ingestJob: {
      id: "job-1",
      status: "completed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      progressPercent: 0,
      stage: "",
    },
    normalizedManifest: {
      batchId: "batch-1",
    },
    formatCompactDate: (value: string) => `compact:${value}`,
    modelOptions: () => [{ value: "model", agentUid: "model", enabled: true, selectable: true, status: "ok" }],
    ...overrides,
  };

  return mount(
    defineComponent({
      setup() {
        return useKnowledgeDistillationWorkbench(setupProps as any);
      },
      template: "<div />",
    }),
  );
}

function makeRuleAuthoringController(overrides: Record<string, any> = {}) {
  const error = ref("");
  const options = {
    agentSelectorOptions: ref([
      {
        value: "model",
        label: "默认模型",
        agentUid: "model",
        provider: "local",
        model: "model",
        moduleIds: [],
        capabilities: [],
        status: "ok",
        enabled: true,
        selectable: true,
        disabledReason: "",
        reason: "",
      },
    ]),
    canMaintainKnowledge: ref(true),
    clearAllBusy: vi.fn(),
    error,
    setBusy: vi.fn(),
    settingsDraft: ref({
      agentExploreDefaults: {
        ruleAuthoringModelAlias: "model",
      },
    }),
    ...overrides,
  };
  return {
    ...createConsoleRuleAuthoringController(options as any),
    error,
  };
}

function makeOpsMonitorController(overrides: Record<string, any> = {}) {
  const state = {
    allMaintenanceAgentRuns: ref<unknown[]>([]),
    canAdminMaintenanceAgent: ref(true),
    canReadMaintenanceAgent: ref(true),
    clearAllBusy: vi.fn(),
    consoleState: ref({
      jobs: { items: [] },
    } as any),
    error: ref(""),
    setBusy: vi.fn(),
    ...overrides,
  };
  return {
    ...createConsoleOpsMonitorController(state as any),
    ...state,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  modelProbeState.selectedModelReady = true;
  modelProbeState.refreshModelProbeStatus.mockResolvedValue(undefined);
  confirmActionMock.mockReturnValue(true);
});

describe("knowledge distillation workbench controller", () => {
  it("暴露公共接口并正确计算运行进度与可启动状态", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([
      distillationRuns({
        runId: "run-a",
        stages: [
          {
            stageId: "one",
            title: "one",
            actionLabel: "prepare",
            description: "prepare",
            status: "completed",
          },
          {
            stageId: "two",
            title: "two",
            actionLabel: "run",
            description: "run",
            status: "running",
            progressPercent: 50,
          },
        ],
      }),
      distillationRuns({ runId: "run-b", status: "running", stages: [] }),
    ]);

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;

    await nextTick();

    expect(vm.activeJobCompleted).toBe(true);
    expect(vm.canStart).toBe(true);
    expect(vm.runs).toHaveLength(2);
    expect(vm.selectedRunId).toBe("run-a");
    expect(vm.selectedRun?.runId).toBe("run-a");
    expect(vm.activeRunProgress).toBe(75);
    expect(vm.packageUrl()).toBe("/package/run-a");
    expect(typeof vm.refreshRuns).toBe("function");
    expect(typeof vm.startWorkbenchRun).toBe("function");

    vm.createOptions.modelAlias = "model";
    vm.selectedRun = {
      runId: "empty",
      stages: [],
    };
    await nextTick();
    expect(vm.activeRunProgress).toBe(0);
  });

  it("异步刷新行为成功/失败可被检测", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns()]);
    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "running" }),
    );

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;

    await nextTick();
    expect(vm.selectedRun?.status).toBe("completed");

    await vm.refreshSelectedRun();
    expect(vm.selectedRun?.status).toBe("running");

    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun.mockRejectedValueOnce(new Error("读取任务失败"));
    await vm.refreshSelectedRun();
    expect(vm.error).toBe("读取任务失败");

    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValueOnce([]);
    vm.canReadKnowledge = false;
    await vm.refreshRuns();
    expect(vm.runs).toHaveLength(0);
  });

  it("启动、取消、归档和删除动作会调用预期客户端", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns({ runId: "run-1" })]);
    knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-created", status: "queued" }),
    );
    knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "cancelled" }),
    );
    knowledgeWorkbenchClient.deleteKnowledgeDistillationWorkbenchRun.mockResolvedValue({});
    knowledgeWorkbenchClient.archiveKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "archived" }),
    );
    knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns.mockResolvedValue({ changes: 0 });

    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns
      .mockResolvedValueOnce([distillationRuns({ runId: "run-1" })])
      .mockResolvedValueOnce([distillationRuns({ runId: "run-created" })])
      .mockResolvedValueOnce([distillationRuns({ runId: "run-1", status: "cancelled" })])
      .mockResolvedValueOnce([distillationRuns({ runId: "run-1", status: "archived" })])
      .mockResolvedValueOnce([]);

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;

    await nextTick();
    await vm.startWorkbenchRun();

    expect(knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun).toHaveBeenCalledTimes(1);
    expect(vm.selectedRun?.runId).toBe("run-created");
    expect(vm.selectedRunId).toBe("run-created");

    vm.selectedRunId = "run-created";
    vm.selectedRun = distillationRuns({ runId: "run-created" });
    await vm.cancelRun();
    expect(knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith(
      "run-created",
      "用户在工作台取消任务",
    );
    expect(vm.error).toBe("");

    vm.selectedRunId = "run-created";
    vm.selectedRun = distillationRuns({ runId: "run-created" });
    await vm.archiveRun();
    expect(knowledgeWorkbenchClient.archiveKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith("run-created");
    expect(vm.error).toBe("");

    vm.selectedRunId = "run-created";
    vm.selectedRun = distillationRuns({ runId: "run-created" });
    await vm.deleteRun();
    expect(knowledgeWorkbenchClient.deleteKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith("run-created");
    expect(vm.selectedRun).toBeNull();

    vm.selectedRunId = "run-created";
    vm.selectedRun = distillationRuns({ runId: "run-created" });
    vm.compareRightRunId = "run-b";
    await vm.compareRuns();
    expect(knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns).toHaveBeenCalledWith("run-created", "run-b");

    knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun.mockRejectedValueOnce(new Error("创建失败"));
    vm.ingestJob = { id: "job-2", status: "completed" };
    await vm.startWorkbenchRun();
    expect(vm.error).toBe("创建失败");
  });

  it("startWorkbenchRun 在输入不完整时直接报错", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns()]);
    const wrapper = mountKnowledgeController({
      ingestJob: {
        id: "",
        status: "completed",
      },
    });
    const vm = wrapper.vm as any;

    await nextTick();
    await vm.startWorkbenchRun();
    expect(vm.error).toBe("请先在页面顶部导入项目目录并完成解析。");
  });

  it("startWorkbenchRun 构造请求载荷并兼容 batchId 回退", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns
      .mockResolvedValueOnce([distillationRuns({ runId: "run-existing" })])
      .mockResolvedValueOnce([distillationRuns({ runId: "run-created" })]);
    knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun.mockResolvedValueOnce(
      distillationRuns({ runId: "run-created", status: "queued" }),
    );

    const wrapper = mountKnowledgeController({
      ingestJob: {
        id: "job-7",
        status: "completed",
      },
      normalizedManifest: null,
    });
    const vm = wrapper.vm as any;

    await nextTick();

    vm.createOptions.modelAlias = "model-v2";
    vm.createOptions.prompt = "只保留安全相关知识点";
    vm.createOptions.tokenBudget = 1234;
    vm.createOptions.payloadBudget = 5678;
    vm.createOptions.rawCorpusBatchMaxCharacters = 80000;
    vm.createOptions.rawCorpusBatchModelMaxCharacters = 12000;
    vm.createOptions.rawCorpusBatchRetryModelMaxCharacters = 6000;
    vm.createOptions.mergeStrategy = "topic_flow";
    vm.createOptions.maxRounds = 5;
    vm.createOptions.strategyVersion = "topic_flow_v1";
    vm.createOptions.timeDecayHalfLifeDays = 30;
    vm.createOptions.timeDecayFloor = 0.12;
    vm.createOptions.priority = "high";

    await vm.startWorkbenchRun();

    expect(knowledgeWorkbenchClient.createKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "job-7 项目知识蒸馏",
        jobId: "job-7",
        batchId: "job-7",
        query: "项目全部文档通用知识蒸馏",
        workflowScope: "project",
        modelAlias: "model-v2",
        prompt: "只保留安全相关知识点",
        tokenBudget: 1234,
        payloadBudget: 5678,
        rawCorpusBatchMaxCharacters: 80000,
        rawCorpusBatchModelMaxCharacters: 12000,
        rawCorpusBatchRetryModelMaxCharacters: 6000,
        mergeStrategy: "topic_flow",
        maxRounds: 5,
        strategyVersion: "topic_flow_v1",
        timeDecayHalfLifeDays: 30,
        timeDecayFloor: 0.12,
        priority: "high",
        modelEnabled: true,
      }),
    );
  });

  it("startWorkbenchRun 对输入不完整和未完成解析状态会直接报错", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns()]);

    const wrapperWithoutId = mountKnowledgeController({
      ingestJob: {
        id: "",
        status: "completed",
      },
    });
    const vmWithoutId = wrapperWithoutId.vm as any;

    await nextTick();
    await vmWithoutId.startWorkbenchRun();
    expect(vmWithoutId.error).toBe("请先在页面顶部导入项目目录并完成解析。");

    const wrapperRunningJob = mountKnowledgeController({
      ingestJob: {
        id: "job-8",
        status: "running",
      },
    });
    const vmRunningJob = wrapperRunningJob.vm as any;

    await nextTick();
    await vmRunningJob.startWorkbenchRun();
    expect(vmRunningJob.error).toBe("解析任务尚未完成，不能开始知识蒸馏。");
  });

  it("操作方法在确认分支和失败分支下行为可控", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns()]);
    knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "cancelled" }),
    );
    knowledgeWorkbenchClient.archiveKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "archived" }),
    );
    knowledgeWorkbenchClient.rerunKnowledgeDistillationWorkbenchStage.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "running" }),
    );
    knowledgeWorkbenchClient.resumeKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-1", status: "running" }),
    );

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;
    await nextTick();

    vm.selectedRunId = "run-1";
    vm.selectedRun = distillationRuns({ runId: "run-1" });

    confirmActionMock.mockReturnValue(false);
    await vm.cancelRun();
    expect(knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun).toHaveBeenCalledTimes(0);

    confirmActionMock.mockReturnValue(true);
    knowledgeWorkbenchClient.cancelKnowledgeDistillationWorkbenchRun.mockRejectedValueOnce(new Error("cancel failed"));
    await vm.cancelRun();
    expect(vm.error).toBe("cancel failed");

    confirmActionMock.mockReturnValue(false);
    await vm.archiveRun();
    expect(knowledgeWorkbenchClient.archiveKnowledgeDistillationWorkbenchRun).toHaveBeenCalledTimes(0);

    confirmActionMock.mockReturnValue(false);
    await vm.deleteRun();
    expect(knowledgeWorkbenchClient.deleteKnowledgeDistillationWorkbenchRun).toHaveBeenCalledTimes(0);

    await vm.rerunStage({ stageId: "", title: "跳过阶段", actionLabel: "", description: "", status: "queued" });
    expect(knowledgeWorkbenchClient.rerunKnowledgeDistillationWorkbenchStage).toHaveBeenCalledTimes(0);

    confirmActionMock.mockReturnValue(false);
    await vm.rerunStage({
      stageId: "stage-1",
      title: "第一阶段",
      actionLabel: "extract",
      description: "提取语义",
      status: "queued",
    });
    expect(knowledgeWorkbenchClient.rerunKnowledgeDistillationWorkbenchStage).toHaveBeenCalledTimes(0);

    confirmActionMock.mockReturnValue(true);
    knowledgeWorkbenchClient.rerunKnowledgeDistillationWorkbenchStage.mockRejectedValueOnce(new Error("rerun failed"));
    await vm.rerunStage({
      stageId: "stage-1",
      title: "第一阶段",
      actionLabel: "extract",
      description: "提取语义",
      status: "queued",
    });
    expect(vm.error).toBe("rerun failed");

    knowledgeWorkbenchClient.resumeKnowledgeDistillationWorkbenchRun.mockRejectedValueOnce(new Error("resume failed"));
    await vm.resumeRun();
    expect(vm.error).toBe("resume failed");
  });

  it("compareRuns 空对照和 selectRun 分支能正确短路与触发刷新", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns({ runId: "run-a" })]);
    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun.mockResolvedValue(
      distillationRuns({ runId: "run-missing", status: "running" }),
    );
    knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns.mockResolvedValue({ changes: 1 });

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;

    await nextTick();

    vm.selectedRunId = "run-a";
    vm.selectedRun = distillationRuns({ runId: "run-a" });
    vm.compareRightRunId = "";

    await vm.compareRuns();
    expect(knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns).not.toHaveBeenCalled();

    vm.compareRightRunId = "run-b";
    await vm.compareRuns();
    expect(knowledgeWorkbenchClient.compareKnowledgeDistillationWorkbenchRuns).toHaveBeenCalledWith("run-a", "run-b");

    vm.compareResult = { changes: 2 };
    vm.selectRun("run-missing");
    expect(vm.compareResult).toBeNull();
    expect(knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith("run-missing");
  });

  it("needsPolling、页面刷新和卸载生命周期会驱动轮询控制器", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns({ runId: "run-a", status: "running" })]);
    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun.mockResolvedValue(distillationRuns({ runId: "run-a", status: "running" }));

    const wrapper = mountKnowledgeController();
    const vm = wrapper.vm as any;

    await nextTick();
    vm.selectedRun = distillationRuns({ runId: "run-a", status: "running" });
    await nextTick();

    expect(intervalControllerState.start).toHaveBeenCalledWith(expect.any(Function), 1800);

    vm.selectedRun = distillationRuns({ runId: "run-a", status: "completed" });
    await nextTick();
    expect(intervalControllerState.stop).toHaveBeenCalled();

    const pageRefreshCalls = pageRefreshHandlerMock.mock.calls[0];
    expect(pageRefreshCalls).toBeDefined();

    const shouldRefresh = pageRefreshCalls?.[0] as (value: unknown) => boolean;
    const refreshHandler = pageRefreshCalls?.[1] as (value: any) => Promise<unknown>;

    const refreshCtx = {
      viewId: "knowledge",
      adminView: "",
      knowledgeTab: "",
      debugTab: "",
      routePath: "",
      addTask: vi.fn(),
    };
    expect(shouldRefresh(refreshCtx)).toBe(true);
    expect(shouldRefresh({ ...refreshCtx, viewId: "debug", debugTab: "runtime" })).toBe(false);

    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValueOnce([distillationRuns({ runId: "run-a", status: "running" })]);
    knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun.mockResolvedValueOnce(distillationRuns({ runId: "run-a", status: "running" }));
    await refreshHandler({
      ...refreshCtx,
      viewId: "knowledge",
    });

    expect(knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns).toHaveBeenCalled();
    expect(knowledgeWorkbenchClient.getKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith("run-a");

    wrapper.unmount();
    expect(intervalControllerState.stop).toHaveBeenCalled();
  });

  it("canReadKnowledge 为 false 时不会发起运行列表刷新", async () => {
    knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue([distillationRuns()]);
    const wrapper = mountKnowledgeController({
      canReadKnowledge: false,
    });

    await nextTick();
    expect(knowledgeWorkbenchClient.listKnowledgeDistillationWorkbenchRuns).not.toHaveBeenCalled();
    expect((wrapper.vm as any).runs).toHaveLength(0);
  });
});

describe("console rule authoring controller", () => {
  it("表单消息会自动推断 chat 草稿并可同步回手工摘要", async () => {
    const { error, ...controller } = makeRuleAuthoringController();

    controller.ruleAuthoringForm.value.message =
      "请对邮件中重复且相同内容的事务进行跳过处理，置信度 90%，并补充说明文档";
    await nextTick();

    expect(controller.ruleAuthoringForm.value.scope).toBe("mail");
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("semantic_duplicate");
    expect(controller.ruleAuthoringForm.value.action).toBe("skip_duplicate");
    expect(controller.ruleAuthoringForm.value.confidence).toBe(0.9);
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("重复知识处理规则");

    controller.ruleCreationMode.value = "manual";
    await nextTick();
    controller.ruleAuthoringForm.value.scope = "all";
    controller.ruleAuthoringForm.value.matchStrategy = "manual_condition";
    controller.ruleAuthoringForm.value.action = "manual_review";
    controller.ruleAuthoringForm.value.ruleName = "手工规则";
    controller.ruleAuthoringForm.value.confidence = 0.73;
    await nextTick();

    expect(controller.ruleAuthoringForm.value.message).toContain("创建规则：手工规则");
    expect(controller.ruleAuthoringForm.value.message).toContain("适用范围：全局");
    expect(controller.ruleAuthoringForm.value.message).toContain("匹配方式：人工条件");
    expect(controller.ruleAuthoringForm.value.message).toContain("执行动作：人工审核");
  });

  it("runRuleAuthoringChat 和 publishRuleAuthoringPackage 会走完整调用链", async () => {
    const { error, ...controller } = makeRuleAuthoringController();
    ruleAuthoringClient.chatKnowledgeRuleAuthoring.mockResolvedValue({
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      runId: "rule-run",
      message: "ok",
    });

    controller.ruleAuthoringForm.value.message = "创建知识治理规则";
    await nextTick();
    await controller.runRuleAuthoringChat();

    expect(ruleAuthoringClient.chatKnowledgeRuleAuthoring).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "创建知识治理规则",
        modelAlias: "model",
        modelEnabled: true,
      }),
    );
    expect(controller.ruleAuthoringResult.value?.runId).toBe("rule-run");
    expect(controller.ruleAuthoringHistory.value).toHaveLength(1);
    expect(controller.ruleAuthoringCanSubmit.value).toBe(true);

    ruleAuthoringClient.publishGoldenRules.mockResolvedValue({
      package: { id: "pkg-id" },
      manifest: { status: "ok" },
    });
    controller.ruleAuthoringResult.value = {
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      confirmation: {
        packageId: "pkg-id",
        version: 1,
      },
    };

    await controller.publishRuleAuthoringPackage();
    expect(ruleAuthoringClient.publishGoldenRules).toHaveBeenCalledWith("pkg-id", { version: 1 });
    expect(controller.ruleAuthoringResult.value?.status).toBe("published");
    expect(controller.ruleAuthoringResult.value?.package).toEqual({ id: "pkg-id" });

    ruleAuthoringClient.chatKnowledgeRuleAuthoring.mockRejectedValueOnce(new Error("生成失败"));
    controller.ruleAuthoringForm.value.message = "下一个规则";
    await controller.runRuleAuthoringChat();
    expect(error.value).toBe("生成失败");

    controller.ruleAuthoringResult.value = null;
    await controller.publishRuleAuthoringPackage();
    expect(error.value).toBe("没有可确认发布的规则包。");
  });
});

describe("console ops monitor controller", () => {
  it("状态计算覆盖队列、告警与客户端运行时", async () => {
    opsMonitorClient.getBackgroundProcesses.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      status: "healthy",
      updatedAt: "2026-01-01T00:00:00Z",
      statePath: "/tmp",
      supervisor: { pid: 1, alive: true, status: "running" },
      processes: [
        { role: "daemon", label: "svc", description: "", desired: true, pid: 1, alive: true, stale: false, status: "running", restartCount: 0 },
        { role: "agent", label: "worker", description: "", desired: true, pid: 2, alive: true, stale: true, status: "stale", restartCount: 0 },
      ],
    });
    opsMonitorClient.getClientRuntimeStatus.mockResolvedValue({
      protocolVersion: "1",
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00Z",
      configPath: "/tmp",
      usagePath: "/tmp",
      coolingPolicy: {},
      summary: {
        totalClients: 3,
        hotClients: 1,
        warmClients: 1,
        cooledClients: 1,
        totalCalls: 10,
        workspaceCount: 1,
        contextCount: 2,
      },
      heatmap: { clients: [], workspaces: [], contexts: [] },
      cooledClients: [],
    });
    opsMonitorClient.getMonitorAlerts.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      status: "ok",
      updatedAt: "2026-01-01T00:00:00Z",
      configPath: "/tmp",
      statePath: "/tmp/state",
      config: {
        schemaVersion: 1,
        enabled: true,
        intervalMs: 1000,
        heartbeatStaleMs: 5000,
        historyLimit: 20,
        rules: {},
      },
      summary: {
        activeCount: 2,
        visibleCount: 1,
        recoveredCount: 1,
        criticalCount: 1,
        warningCount: 1,
        historyCount: 3,
      },
      queueMonitor: {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        statePath: "/tmp/state",
        eventLogPath: "/tmp/log",
        summary: {
          totalCount: 1,
          openCount: 1,
          interruptedCount: 0,
          recoveredCount: 0,
          closedCount: 0,
        },
        items: [
          {
            queueId: "q1",
            kind: "import",
            ownerId: "owner-1",
            label: "q1",
            source: "queue-monitor",
            sources: ["queue-monitor"],
            lifecycleStatus: "open",
            phase: "running",
            status: "open",
            startedAt: "2026-01-01T00:00:00Z",
            lastHeartbeatAt: "2026-01-01T00:00:10Z",
            recoveryStatus: "recovered",
          },
        ],
        systemStatus: {
          schemaVersion: 1,
          updatedAt: "2026-01-01T00:00:00Z",
          source: "source",
          summary: {
            totalCount: 0,
            processCount: 0,
            queueCount: 0,
            taskCount: 0,
            monitorCount: 0,
            alertCount: 0,
          },
          registrations: [],
          processes: [],
          queues: [],
          tasks: [],
          monitors: [],
          alerts: [],
          routes: {},
        },
      },
      activeAlerts: [{ alertId: "a1", ruleId: "r1", severity: "warning", title: "告警", message: "", source: "", role: "", status: "open", active: true, firstSeenAt: "", lastSeenAt: "" }],
      history: [],
    } as any);
    opsMonitorClient.acknowledgeMonitorAlert.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      status: "ok",
      updatedAt: "2026-01-01T00:00:00Z",
      configPath: "/tmp",
      statePath: "/tmp/state",
      config: {
        schemaVersion: 1,
        enabled: true,
        intervalMs: 1000,
        heartbeatStaleMs: 5000,
        historyLimit: 20,
        rules: {},
      },
      summary: { activeCount: 1, visibleCount: 1, recoveredCount: 0, criticalCount: 0, warningCount: 1, historyCount: 3 },
      queueMonitor: null,
      activeAlerts: [],
      history: [],
    } as any);
    opsMonitorClient.saveMonitorAlertConfig.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      status: "ok",
      updatedAt: "2026-01-01T00:00:00Z",
      configPath: "/tmp",
      statePath: "/tmp/state",
      config: {
        schemaVersion: 1,
        enabled: true,
        intervalMs: 1000,
        heartbeatStaleMs: 5000,
        historyLimit: 20,
        rules: {},
      },
      summary: { activeCount: 1, visibleCount: 1, recoveredCount: 0, criticalCount: 0, warningCount: 1, historyCount: 3 },
      queueMonitor: null,
      activeAlerts: [],
      history: [],
    } as any);
    opsMonitorClient.recoverBackgroundSupervisor.mockResolvedValue({
      recovery: { ok: true, attempted: true },
      backgroundProcessStatus: {
        schemaVersion: 1,
        ok: true,
        status: "running",
        updatedAt: "2026-01-01T00:00:00Z",
        statePath: "/tmp",
        supervisor: { pid: 1, alive: true, status: "running" },
        processes: [],
      },
      monitorAlertState: null,
    });

    const controller = makeOpsMonitorController({
      allMaintenanceAgentRuns: ref([queueMonitorRun() as any]),
      consoleState: ref({
        jobs: {
          items: [
            {
              id: "job-1",
              status: "running",
              queueId: "q2",
              updatedAt: "2026-01-01T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
              startedAt: "2026-01-01T00:00:00Z",
              stage: "parse",
              progressPercent: 20,
            } as any,
          ],
        },
      } as any),
    });

    await controller.refreshBackgroundProcesses();
    await controller.refreshClientRuntimeStatus();
    await controller.refreshMonitorAlerts();

    expect(opsMonitorClient.getBackgroundProcesses).toHaveBeenCalledTimes(1);
    expect(opsMonitorClient.getClientRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(opsMonitorClient.getMonitorAlerts).toHaveBeenCalledTimes(1);

    expect(controller.backgroundSupervisorLabel.value).toBe("正常");
    expect(controller.backgroundRunningCount.value).toBe(1);
    expect(controller.clientRuntimeSummary.value.totalClients).toBe(3);
    expect(controller.monitorAlertSummary.value.warningCount).toBe(1);
    expect(controller.workQueueRows.value.length).toBe(3);

    await controller.acknowledgeMonitorAlert("a1");
    expect(opsMonitorClient.acknowledgeMonitorAlert).toHaveBeenCalledWith("a1");

    controller.monitorAlertConfigText.value = "abc";
    await controller.saveMonitorAlertConfig();
    expect(controller.error.value).toMatch(/Unexpected token|Expected property name/);

    await controller.recoverBackgroundSupervisor();
    expect(opsMonitorClient.recoverBackgroundSupervisor).toHaveBeenCalledTimes(1);
  });

  it("失败路径会设置可读写权限提示与错误文案", async () => {
    opsMonitorClient.getMonitorAlerts.mockRejectedValue(new Error("alert-failed"));
    const controller = makeOpsMonitorController({
      canReadMaintenanceAgent: ref(false),
      canAdminMaintenanceAgent: ref(false),
    });

    await controller.refreshMonitorAlerts();
    expect(opsMonitorClient.getMonitorAlerts).not.toHaveBeenCalled();
    expect(controller.monitorAlertState.value).toBeNull();

    opsMonitorClient.acknowledgeMonitorAlert.mockRejectedValueOnce(new Error("ack-failed"));
    await controller.acknowledgeMonitorAlert("a1");
    expect(controller.error.value).toBe("当前账号没有维护配置权限。");

    opsMonitorClient.saveMonitorAlertConfig.mockRejectedValueOnce(new Error("save-failed"));
    controller.canAdminMaintenanceAgent.value = true;
    controller.monitorAlertConfigText.value = "{";
    await controller.saveMonitorAlertConfig();
    expect(controller.error.value).toMatch(/Unexpected token|Expected property name/);

    opsMonitorClient.getClientRuntimeStatus.mockRejectedValueOnce(new Error("runtime-failed"));
    await controller.refreshClientRuntimeStatus();
    expect(controller.error.value).toBe("runtime-failed");
  });
});
