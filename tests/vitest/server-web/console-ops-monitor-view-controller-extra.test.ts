import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useOpsMonitorViewConsole } from "../../../server-web/composables/console-ops-monitor-view-controller";
import type { MonitorAlertItem } from "../../../server-web/lib/types";
import { monitorAlertSeverityLabel, monitorAlertSeverityTone } from "../../../server-web/composables/console-status-utils";

const shellContextMock = vi.hoisted(() => ({
  useServerConsoleShellContext: vi.fn(),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock.useServerConsoleShellContext,
}));

function makeMonitorAlert(overrides: Record<string, any> = {}): MonitorAlertItem {
  return {
    alertId: "alert-1",
    ruleId: "rule-1",
    severity: "critical",
    title: "客户端线程告警",
    message: "请检查 PID 1 当前状态异常。拉起进程时状态中断。",
    source: "daemon",
    role: "运维进程",
    status: "open",
    active: true,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:03:00.000Z",
    ...overrides,
  };
}

function createFixture(overrides: Record<string, any> = {}) {
  const busyKey = ref("");
  const backgroundProcesses = ref([
    {
      role: "daemon",
      label: "daemon",
      description: "任务守护进程",
      desired: true,
      pid: 11,
      alive: true,
      stale: false,
      status: "running",
      restartCount: 1,
    },
  ]);
  const backgroundProcessStatus = ref({
    schemaVersion: 1,
    ok: true,
    status: "running",
    updatedAt: "2026-01-01T00:00:00.000Z",
    statePath: "/tmp/supervisor.json",
    supervisor: { pid: 11, alive: true, status: "running" },
    processes: backgroundProcesses.value,
  });
  const clientRuntimeSummary = ref({
    totalClients: 12,
    hotClients: 2,
    warmClients: 6,
    cooledClients: 4,
    totalCalls: 180,
    workspaceCount: 2,
    contextCount: 5,
  });
  const clientRuntimeHeatRows = ref([]);
  const monitorAlertConfigText = ref(JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    intervalMs: 1000,
    heartbeatStaleMs: 5000,
    rules: {},
    historyLimit: 20,
  }));
  const activeMonitorAlerts = ref([makeMonitorAlert({ alertId: "a-1", queueId: "q-1", source: "queue-monitor", role: "daemon" })]);
  const historyAlert = makeMonitorAlert({
    alertId: "a-1",
    queueId: "q-1",
    source: "queue-monitor",
    role: "daemon",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:04:00.000Z",
  });
  const recentMonitorAlertHistory = ref([
    historyAlert,
    makeMonitorAlert({
      alertId: "a-2",
      status: "recovered",
      active: false,
      ackRequired: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:02:00.000Z",
      queueId: "q-2",
    }),
  ]);
  const shell = {
    acknowledgeMonitorAlert: vi.fn(async () => undefined),
    backgroundProcessLabel: vi.fn(),
    backgroundProcessStatus,
    backgroundProcessTone: vi.fn(),
    backgroundProcesses,
    backgroundRunningCount: computed(() =>
      backgroundProcesses.value.filter((item: any) => item.alive && !item.stale).length,
    ),
    backgroundSupervisorLabel: computed(() => (backgroundProcessStatus.value?.supervisor.alive ? "正常" : "守护进程离线")),
    busyKey,
    canAdminMaintenanceAgent: ref(false),
    clientRuntimeCoolingLabel: vi.fn(),
    clientRuntimeCoolingTone: vi.fn(),
    clientRuntimeHeatRows,
    clientRuntimeHeatStyle: vi.fn(),
    clientRuntimeReasonLabel: vi.fn(),
    clientRuntimeStatus: ref(null),
    clientRuntimeSummary,
    clientRuntimeSurfaceText: vi.fn(),
    clientRuntimeTaskText: vi.fn(),
    formatCompactDate: (value: string) => `compact:${value}`,
    activeMonitorAlerts,
    monitorAlertConfigText,
    monitorAlertSummary: computed(() => ({
      activeCount: 1,
      visibleCount: 1,
      recoveredCount: 0,
      criticalCount: 1,
      warningCount: 0,
      historyCount: 2,
    })),
    monitorAlertState: ref({
      summary: {
        activeCount: 1,
        visibleCount: 1,
        recoveredCount: 0,
        criticalCount: 1,
        warningCount: 0,
        historyCount: 2,
      },
      activeAlerts: activeMonitorAlerts.value,
      history: recentMonitorAlertHistory.value,
    }),
    processRelationText: vi.fn(),
    processTypeLabel: vi.fn(),
    recentMonitorAlertHistory,
    saveMonitorAlertConfig: vi.fn(async () => undefined),
    shouldIncludeMonitorAlertLifecycle: vi.fn((alert: MonitorAlertItem) => alert.ackRequired || alert.active === false || alert.status === "recovered"),
  };

  shellContextMock.useServerConsoleShellContext.mockReturnValue(shell as any);
  const controller = useOpsMonitorViewConsole();

  return {
    shell,
    controller,
  };
}

describe("console ops monitor view controller", () => {
  it("映射 shell 字段并保留卡片状态数据与汇总标签", () => {
    const { shell, controller } = createFixture();

    expect(controller.backgroundProcessStatus).toBe(shell.backgroundProcessStatus);
    expect(controller.backgroundSupervisorLabel.value).toBe("正常");
    expect(controller.backgroundRunningCount.value).toBe(1);
    expect(controller.clientRuntimeSummary.value.totalClients).toBe(12);
    expect(controller.monitorAlertSummary.value.criticalCount).toBe(1);
    expect(typeof controller.backgroundProcessTone).toBe("function");
    expect(controller.saveMonitorAlertConfig).toBe(shell.saveMonitorAlertConfig);
  });

  it("去重告警并按 merge key 合并 active + history", () => {
    const { controller } = createFixture();
    const merged = controller.mergedMonitorAlerts.value;

    const ids = merged.map((alert) => alert.alertId);
    expect(ids).toEqual(["a-1", "a-2"]);
    expect(merged[0]).toMatchObject({
      alertId: "a-1",
      queueId: "q-1",
      source: "queue-monitor",
    });
  });

  it("可生成包含状态、队列与来源的告警明细，并在非生命周期模式下省略状态行", () => {
    const { controller } = createFixture();
    const sourceAlert = makeMonitorAlert({
      alertId: "a-detail",
      message: "请先检查 PID 9。当前状态 中断。影响 下游任务 依赖丢失。",
      source: "queue-monitor",
      role: "daemon",
      queueId: "queue-9",
      status: "open",
      active: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:05:00.000Z",
      acknowledgedAt: "",
    });
    const withLifecycle = controller.monitorAlertDetailBullets(sourceAlert, true);

    expect(withLifecycle).toEqual([
      { label: "状态", text: "open" },
      { label: "队列 ID", text: "queue-9" },
      { label: "处理", text: "请先检查 PID 9" },
      { label: "状态", text: "当前状态 中断" },
      { label: "影响", text: "影响 下游任务 依赖丢失" },
      { label: "来源", text: "queue-monitor / daemon" },
    ]);

    const withoutLifecycle = controller.monitorAlertDetailBullets(sourceAlert, false);
    expect(withoutLifecycle[0]).toEqual({ label: "队列 ID", text: "queue-9" });
    expect(withoutLifecycle.map((item) => item.label)).toEqual([
      "队列 ID",
      "处理",
      "状态",
      "影响",
      "来源",
    ]);
  });

  it("空消息会回退到占位详情文本并复用告警工具函数映射", () => {
    const { controller } = createFixture();
    const emptyBullets = controller.monitorAlertDetailBullets(
      makeMonitorAlert({
        alertId: "a-empty",
        message: "",
        source: "",
        role: "",
        queueId: "",
      }),
      false,
    );
    expect(emptyBullets).toEqual([{ label: "详情", text: "-" }]);
    expect(controller.monitorAlertSeverityLabel("warning")).toBe("警告");
    expect(controller.monitorAlertSeverityTone("warning")).toBe("warning");
    expect(controller.monitorAlertMergeKey({
      alertId: "a-x",
      ruleId: "r",
      severity: "warning",
      title: "x",
      message: "x",
      source: "s",
      role: "r",
      status: "open",
      active: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    } as any)).toBe("a-x:::active");
    expect(controller.monitorAlertMergeKey({
      alertId: "a-x",
      ruleId: "r",
      severity: "warning",
      title: "x",
      message: "x",
      source: "s",
      role: "r",
      status: "open",
      active: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: "2026-01-01T00:01:00.000Z",
      acknowledgedAt: "2026-01-01T00:01:30.000Z",
    } as any)).toBe("a-x:2026-01-01T00:01:00.000Z:2026-01-01T00:01:30.000Z:active");
    expect(controller.backgroundProcessLabel("running")).toBe("运行中");
    expect(controller.clientRuntimeCoolingLabel("hot")).toBe("热连接");
    expect(monitorAlertSeverityTone("critical")).toBe("failed");
    expect(monitorAlertSeverityLabel("critical")).toBe("严重");
    expect(controller.processTypeLabel("daemon")).toBe("守护进程");
    expect(controller.processRelationText({
      services: ["svc-a", "svc-b"],
      monitors: ["m1"],
      alerts: [],
    } as any)).toBe("服务：svc-a / svc-b；监控：m1");
  });
});
