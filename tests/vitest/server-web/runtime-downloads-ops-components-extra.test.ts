// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, type Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RuntimeDependencyListCard from "../../../server-web/components/admin/runtime-downloads/RuntimeDependencyListCard.vue";
import RuntimeDependencyResultCard from "../../../server-web/components/admin/runtime-downloads/RuntimeDependencyResultCard.vue";
import OpsMonitorAlertsPanel from "../../../server-web/components/admin/ops-monitor/OpsMonitorAlertsPanel.vue";
import MaintenanceAgentPolicyPanel from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentPolicyPanel.vue";
import type {
  RuntimeDependency,
  RuntimeDependencyActionResult,
  RuntimeDependencyDownloadRun,
} from "../../../server-web/lib/runtime-dependencies";

const runtimeDownloadsContextMock = vi.hoisted(() => ({
  actionError: { __v_isRef: true, value: "" } as Ref<string>,
  actionResult: { __v_isRef: true, value: null } as Ref<RuntimeDependencyActionResult | null>,
  actionRunCards: {
    __v_isRef: true,
    value: [] as Array<{ run: RuntimeDependencyDownloadRun; logEntries: unknown[]; progressState: unknown }>,
  } as Ref<Array<{ run: RuntimeDependencyDownloadRun; logEntries: unknown[]; progressState: unknown }>>,
  dependencyActionBusy: vi.fn(),
  dependencyStatusForRow: vi.fn(),
  dependencies: { __v_isRef: true, value: [] as RuntimeDependency[] } as Ref<RuntimeDependency[]>,
  loading: { __v_isRef: true, value: false } as Ref<boolean>,
  prepareDependency: vi.fn(),
}));

const opsMonitorContextMock = vi.hoisted(() => ({
  acknowledgeMonitorAlert: vi.fn(),
  busyKey: { __v_isRef: true, value: "" } as Ref<string>,
  canAdminMaintenanceAgent: { __v_isRef: true, value: true } as Ref<boolean>,
  formatCompactDate: vi.fn((value: string) => `compact:${value.slice(0, 10)}`),
  mergedMonitorAlerts: { __v_isRef: true, value: [] as Array<Record<string, unknown>> } as Ref<Array<Record<string, unknown>>>,
  monitorAlertConfigText: { __v_isRef: true, value: "" } as Ref<string>,
  monitorAlertDetailBullets: vi.fn(),
  monitorAlertMergeKey: vi.fn((alert: Record<string, unknown>) => String(alert.alertId)),
  monitorAlertSeverityLabel: vi.fn((severity: string) => `label:${severity}`),
  monitorAlertSeverityTone: vi.fn((severity: string) => `tone:${severity}`),
  monitorAlertState: { __v_isRef: true, value: null } as Ref<{ status?: string } | null>,
  monitorAlertSummary: {
    __v_isRef: true,
    value: {
      activeCount: 0,
      criticalCount: 0,
      visibleCount: 0,
    },
  } as Ref<{ activeCount: number; criticalCount: number; visibleCount: number }>,
  saveMonitorAlertConfig: vi.fn(),
  shouldIncludeMonitorAlertLifecycle: vi.fn(),
}));

const maintenanceAgentContextMock = vi.hoisted(() => ({
  autoApproveRiskOptionBarOptions: {
    __v_isRef: true,
    value: [
    { label: "低风险", value: "low" },
    { label: "高风险", value: "high" },
    ],
  } as Ref<Array<{ label: string; value: string }>>,
  busyKey: { __v_isRef: true, value: "" } as Ref<string>,
  canAdminMaintenanceAgent: { __v_isRef: true, value: true } as Ref<boolean>,
  enabledBooleanOptionBarOptions: {
    __v_isRef: true,
    value: [
    { label: "启用", value: true },
    { label: "停用", value: false },
    ],
  } as Ref<Array<{ label: string; value: boolean }>>,
  formatCompactDate: vi.fn((value: string) => `compact:${value.slice(0, 10)}`),
  maintenanceAgentConfig: { __v_isRef: true, value: null } as Ref<Record<string, any> | null>,
  plannerModeOptionBarOptions: {
    __v_isRef: true,
    value: [
    { label: "自动", value: "auto" },
    { label: "手动", value: "manual" },
    ],
  } as Ref<Array<{ label: string; value: string }>>,
  saveMaintenanceAgentConfig: vi.fn(),
}));

vi.mock("../../../server-web/composables/runtimeDownloadsViewContext", () => ({
  useRuntimeDownloadsViewContext: () => runtimeDownloadsContextMock,
}));

vi.mock("../../../server-web/composables/opsMonitorViewContext", () => ({
  useOpsMonitorViewContext: () => opsMonitorContextMock,
}));

vi.mock("../../../server-web/composables/maintenanceAgentViewContext", () => ({
  useMaintenanceAgentViewContext: () => maintenanceAgentContextMock,
}));

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () =>
      h(
        "span",
        {
          class: "status-pill-stub",
          "data-tone": props.tone || "",
        },
        props.label || "",
      );
  },
});

const RuntimeDependencyConfigButtonStub = defineComponent({
  name: "RuntimeDependencyConfigButton",
  props: {
    item: Object,
  },
  setup(props) {
    return () =>
      h(
        "button",
        {
          class: "runtime-dependency-config-button-stub",
          type: "button",
        },
        (props.item as { label?: string } | undefined)?.label || "配置",
      );
  },
});

const RuntimeDependencyRunCardStub = defineComponent({
  name: "RuntimeDependencyRunCard",
  props: {
    card: Object,
  },
  setup(props) {
    return () =>
      h(
        "section",
        {
          class: "runtime-dependency-run-card-stub",
          "data-run-id": String((props.card as { run?: { runId?: string } } | undefined)?.run?.runId || ""),
        },
        String((props.card as { run?: { targetId?: string } } | undefined)?.run?.targetId || ""),
      );
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    open: Boolean,
    title: String,
  },
  setup(props, { slots }) {
    return () =>
      h(
        "section",
        { class: "config-fold-card-stub", "data-open": String(Boolean(props.open)) },
        [
          h("header", props.title || ""),
          h("div", slots.default?.()),
        ],
      );
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    label: String,
    modelValue: [Boolean, String, Number],
    options: Array,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "option-bar-stub",
          type: "button",
          onClick: () => {
            const options = (props.options || []) as Array<{ value: string | boolean | number }>;
            const current = props.modelValue;
            const next = options.length
              ? options.find((option) => option.value !== current)?.value ?? options[0]?.value
              : !current;
            emit("update:modelValue", next);
          },
        },
        `${props.label || ""}:${String(props.modelValue)}`,
      );
  },
});

function flush() {
  return nextTick();
}

function makeRuntimeDependency(overrides: Partial<RuntimeDependency> = {}): RuntimeDependency {
  return {
    id: "jdk",
    label: "JDK",
    status: "present",
    present: true,
    detection: {
      javaVersion: "17.0.9",
      source: {
        label: "平台缓存",
        path: "/runtime-dependencies/jdk",
        detail: "已缓存",
      },
    },
    ...overrides,
  };
}

function makeRuntimeRun(overrides: Partial<RuntimeDependencyDownloadRun> = {}): RuntimeDependencyDownloadRun {
  return {
    runId: "run-jdk",
    targetId: "jdk",
    status: "running",
    ok: true,
    latestMessage: "下载中",
    startedAt: "2026-06-04T01:00:00.000Z",
    updatedAt: "2026-06-04T01:00:00.000Z",
    steps: [],
    log: [],
    ...overrides,
  };
}

function makeMonitorAlert(overrides: Record<string, unknown> = {}) {
  return {
    alertId: "alert-1",
    title: "任务队列异常",
    severity: "warning",
    ackRequired: true,
    message: "PID 失联；请检查 worker。",
    lastSeenAt: "2026-06-04T02:00:00.000Z",
    source: "queue-monitor",
    role: "background",
    ...overrides,
  };
}

function makeMaintenanceConfig() {
  return {
    enabled: true,
    plannerMode: "manual",
    autoApproveRisk: "low",
    scheduler: {
      tickSeconds: 30,
    },
    schedules: [
      {
        id: "daily",
        enabled: true,
        intervalMinutes: 60,
        label: "每日巡检",
        nextRunAt: "2026-06-06T08:00:00.000Z",
        runbook: "daily-runbook",
      },
      {
        id: "weekly",
        enabled: false,
        intervalMinutes: 10080,
        label: "每周清理",
        nextRunAt: "2026-06-10T08:00:00.000Z",
        runbook: "weekly-cleanup",
      },
    ],
  };
}

beforeEach(() => {
  runtimeDownloadsContextMock.actionError.value = "";
  runtimeDownloadsContextMock.actionResult.value = null;
  runtimeDownloadsContextMock.actionRunCards.value = [];
  runtimeDownloadsContextMock.dependencies.value = [];
  runtimeDownloadsContextMock.loading.value = false;
  runtimeDownloadsContextMock.dependencyActionBusy.mockReset();
  runtimeDownloadsContextMock.dependencyStatusForRow.mockReset();
  runtimeDownloadsContextMock.prepareDependency.mockReset();
  runtimeDownloadsContextMock.dependencyActionBusy.mockImplementation(() => false);
  runtimeDownloadsContextMock.dependencyStatusForRow.mockImplementation((item: RuntimeDependency) => item.status);

  opsMonitorContextMock.acknowledgeMonitorAlert.mockReset();
  opsMonitorContextMock.busyKey.value = "";
  opsMonitorContextMock.canAdminMaintenanceAgent.value = true;
  opsMonitorContextMock.formatCompactDate.mockClear();
  opsMonitorContextMock.mergedMonitorAlerts.value = [];
  opsMonitorContextMock.monitorAlertConfigText.value = "";
  opsMonitorContextMock.monitorAlertDetailBullets.mockReset();
  opsMonitorContextMock.monitorAlertMergeKey.mockClear();
  opsMonitorContextMock.monitorAlertSeverityLabel.mockClear();
  opsMonitorContextMock.monitorAlertSeverityTone.mockClear();
  opsMonitorContextMock.monitorAlertState.value = null;
  opsMonitorContextMock.monitorAlertSummary.value = {
    activeCount: 0,
    criticalCount: 0,
    visibleCount: 0,
  };
  opsMonitorContextMock.saveMonitorAlertConfig.mockReset();
  opsMonitorContextMock.shouldIncludeMonitorAlertLifecycle.mockReset();

  maintenanceAgentContextMock.autoApproveRiskOptionBarOptions.value = [
    { label: "低风险", value: "low" },
    { label: "高风险", value: "high" },
  ];
  maintenanceAgentContextMock.busyKey.value = "";
  maintenanceAgentContextMock.canAdminMaintenanceAgent.value = true;
  maintenanceAgentContextMock.enabledBooleanOptionBarOptions.value = [
    { label: "启用", value: true },
    { label: "停用", value: false },
  ];
  maintenanceAgentContextMock.formatCompactDate.mockClear();
  maintenanceAgentContextMock.maintenanceAgentConfig.value = null;
  maintenanceAgentContextMock.plannerModeOptionBarOptions.value = [
    { label: "自动", value: "auto" },
    { label: "手动", value: "manual" },
  ];
  maintenanceAgentContextMock.saveMaintenanceAgentConfig.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("RuntimeDependencyListCard", () => {
  it("renders rows, action states, and empty state", async () => {
    runtimeDownloadsContextMock.dependencies.value = [
      makeRuntimeDependency({
        id: "jdk",
        label: "JDK",
        present: true,
        status: "present",
      }),
      makeRuntimeDependency({
        id: "python",
        label: "Python",
        present: false,
        status: "failed",
        downloadable: true,
        detection: {
          source: {
            label: "系统应用",
            path: "/Applications/Python.app",
            detail: "Python 3.12",
          },
        },
      }),
      makeRuntimeDependency({
        id: "node",
        label: "Node.js",
        present: false,
        status: "failed",
        downloadable: false,
        detection: {},
      }),
    ];

    const wrapper = mount(RuntimeDependencyListCard, {
      global: {
        stubs: {
          RuntimeDependencyConfigButton: RuntimeDependencyConfigButtonStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("依赖");
    expect(wrapper.text()).toContain("JDK");
    expect(wrapper.text()).toContain("17.0.9");
    expect(wrapper.text()).toContain("Python");
    expect(wrapper.text()).toContain("系统应用");
    expect(wrapper.text()).toContain("Node.js");
    expect(wrapper.text()).toContain("未返回来源");
    expect(wrapper.findAll(".status-pill-stub").at(0)?.text()).toBe("已存在");
    expect(wrapper.findAll(".status-pill-stub").at(1)?.text()).toBe("不可用");
    expect(wrapper.findAll(".status-pill-stub").at(1)?.attributes("data-tone")).toBe("danger");
    expect(wrapper.findAll("button").some((button) => button.text().includes("安装"))).toBe(true);
    expect(wrapper.findAll("button").some((button) => button.text().includes("已存在"))).toBe(true);
    expect(wrapper.findAll("button").some((button) => button.text().includes("不可用"))).toBe(true);

    await wrapper.findAll("button").find((button) => button.text().includes("安装"))?.trigger("click");
    expect(runtimeDownloadsContextMock.prepareDependency).toHaveBeenCalledWith(
      expect.objectContaining({ id: "python" }),
    );

    wrapper.unmount();
  });

  it("shows the empty state when dependencies are not loaded", () => {
    runtimeDownloadsContextMock.dependencies.value = [];
    runtimeDownloadsContextMock.loading.value = false;

    const wrapper = mount(RuntimeDependencyListCard, {
      global: {
        stubs: {
          RuntimeDependencyConfigButton: RuntimeDependencyConfigButtonStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.find(".empty-state strong").text()).toBe("暂无依赖状态");
    expect(wrapper.findAll(".runtime-dependency-row")).toHaveLength(0);
  });
});

describe("RuntimeDependencyResultCard", () => {
  it("renders error, result, and run cards", async () => {
    runtimeDownloadsContextMock.actionError.value = "安装失败";
    runtimeDownloadsContextMock.actionResult.value = {
      ok: false,
      status: "failed",
      run: makeRuntimeRun({ status: "failed", latestMessage: "中止" }),
    };
    runtimeDownloadsContextMock.actionRunCards.value = [
      {
        run: makeRuntimeRun({ runId: "run-jdk", targetId: "jdk" }),
        logEntries: [{ key: "1", level: "info", message: "开始", time: "08:00", prefix: "08:00 info" }],
        progressState: { detail: "进行中", label: "安装", progressPercent: 25, segments: [] },
      },
      {
        run: makeRuntimeRun({ runId: "run-python", targetId: "python" }),
        logEntries: [],
        progressState: { detail: "完成", label: "完成", progressPercent: 100, segments: [] },
      },
    ];

    const wrapper = mount(RuntimeDependencyResultCard, {
      global: {
        stubs: {
          RuntimeDependencyRunCard: RuntimeDependencyRunCardStub,
        },
      },
    });

    expect(wrapper.text()).toContain("安装进展");
    expect(wrapper.text()).toContain("执行失败");
    expect(wrapper.text()).toContain("安装失败");
    expect(wrapper.text()).toContain("不可用");
    expect(wrapper.find(".section-tags").text()).toContain("2 个任务");
    expect(wrapper.findAll(".runtime-dependency-run-card-stub")).toHaveLength(2);
    expect(wrapper.findAll(".runtime-dependency-run-card-stub").at(0)?.attributes("data-run-id")).toBe("run-jdk");
  });

  it("renders nothing before any action state is available", () => {
    runtimeDownloadsContextMock.actionError.value = "";
    runtimeDownloadsContextMock.actionResult.value = null;
    runtimeDownloadsContextMock.actionRunCards.value = [];

    const wrapper = mount(RuntimeDependencyResultCard, {
      global: {
        stubs: {
          RuntimeDependencyRunCard: RuntimeDependencyRunCardStub,
        },
      },
    });

    expect(wrapper.find("article").exists()).toBe(false);
  });
});

describe("OpsMonitorAlertsPanel", () => {
  it("renders alerts, calls context actions, and binds config text", async () => {
    const alert = makeMonitorAlert();
    opsMonitorContextMock.monitorAlertState.value = { status: "ok" };
    opsMonitorContextMock.monitorAlertSummary.value = {
      activeCount: 1,
      criticalCount: 1,
      visibleCount: 1,
    };
    opsMonitorContextMock.mergedMonitorAlerts.value = [alert];
    opsMonitorContextMock.monitorAlertDetailBullets.mockImplementation((input: Record<string, unknown>, includeLifecycle: boolean) => [
      { label: "状态", text: includeLifecycle ? "已恢复" : "警告" },
      { label: "详情", text: String(input.message || "") },
      { label: "来源", text: String(input.source || "") },
    ]);
    opsMonitorContextMock.shouldIncludeMonitorAlertLifecycle.mockImplementation((input: Record<string, unknown>) => Boolean(input.ackRequired));
    opsMonitorContextMock.monitorAlertConfigText.value = JSON.stringify({ enabled: true });

    const wrapper = mount(OpsMonitorAlertsPanel, {
      global: {
        stubs: {
          ConfigFoldCard: ConfigFoldCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("监控报警");
    expect(wrapper.text()).toContain("ok");
    expect(wrapper.text()).toContain("可见 1");
    expect(wrapper.text()).toContain("严重 1");
    expect(wrapper.text()).toContain("任务队列异常");
    expect(wrapper.text()).toContain("已恢复");
    expect(wrapper.text()).toContain("PID 失联");
    expect(wrapper.text()).toContain("queue-monitor");
    expect(wrapper.find(".status-pill-stub").attributes("data-tone")).toBe("success");
    expect(opsMonitorContextMock.monitorAlertDetailBullets).toHaveBeenCalledWith(alert, true);

    await wrapper.find("button.tool-button-ghost").trigger("click");
    expect(opsMonitorContextMock.acknowledgeMonitorAlert).toHaveBeenCalledWith("alert-1");

    const textarea = wrapper.find("textarea");
    await textarea.setValue('{"enabled":false}');
    expect(opsMonitorContextMock.monitorAlertConfigText.value).toBe('{"enabled":false}');

    await wrapper.find("button.primary-action").trigger("click");
    expect(opsMonitorContextMock.saveMonitorAlertConfig).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no alerts", () => {
    opsMonitorContextMock.monitorAlertState.value = { status: "empty" };
    opsMonitorContextMock.mergedMonitorAlerts.value = [];

    const wrapper = mount(OpsMonitorAlertsPanel, {
      global: {
        stubs: {
          ConfigFoldCard: ConfigFoldCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.find(".empty-state strong").text()).toBe("暂无报警");
    expect(wrapper.findAll(".job-row")).toHaveLength(0);
  });
});

describe("MaintenanceAgentPolicyPanel", () => {
  it("renders config controls, toggles schedule state, and saves the policy", async () => {
    maintenanceAgentContextMock.maintenanceAgentConfig.value = makeMaintenanceConfig();

    const wrapper = mount(MaintenanceAgentPolicyPanel, {
      global: {
        stubs: {
          OptionBar: OptionBarStub,
        },
      },
    });

    expect(wrapper.text()).toContain("调度策略");
    expect(wrapper.text()).toContain("每日巡检");
    expect(wrapper.text()).toContain("compact:2026-06-06");
    expect(wrapper.findAll(".option-bar-stub")).toHaveLength(3);
    expect(wrapper.findAll("input").at(0)?.element).toBeTruthy();
    expect(wrapper.find("button.primary-action").text()).toBe("保存策略");

    await wrapper.findAll(".option-bar-stub").at(0)?.trigger("click");
    expect(maintenanceAgentContextMock.maintenanceAgentConfig.value.enabled).toBe(false);

    const tickInput = wrapper.findAll("input").at(0);
    await tickInput?.setValue("45");
    expect(maintenanceAgentContextMock.maintenanceAgentConfig.value.scheduler.tickSeconds).toBe(45);

    const scheduleInputs = wrapper.findAll('input[type="number"]');
    expect(scheduleInputs).toHaveLength(3);
    await scheduleInputs.at(1)?.setValue("120");
    expect(maintenanceAgentContextMock.maintenanceAgentConfig.value.schedules[0].intervalMinutes).toBe(120);

    await wrapper.findAll("button.table-action").at(0)?.trigger("click");
    expect(maintenanceAgentContextMock.maintenanceAgentConfig.value.schedules[0].enabled).toBe(false);

    await wrapper.find("button.primary-action").trigger("click");
    expect(maintenanceAgentContextMock.saveMaintenanceAgentConfig).toHaveBeenCalledTimes(1);
  });

  it("does not render the policy panel without config", () => {
    maintenanceAgentContextMock.maintenanceAgentConfig.value = null;

    const wrapper = mount(MaintenanceAgentPolicyPanel, {
      global: {
        stubs: {
          OptionBar: OptionBarStub,
        },
      },
    });

    expect(wrapper.find("article").exists()).toBe(false);
  });
});
