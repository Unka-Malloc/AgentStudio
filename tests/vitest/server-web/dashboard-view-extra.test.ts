// @vitest-environment jsdom
import { h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DashboardView from "../../../server-web/views/DashboardView.vue";

const statusPillMock = {
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props: Record<string, unknown>) {
    return () =>
      h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
  },
};

const segmentedToggleMock = {
  name: "SegmentedToggle",
  props: ["options", "modelValue", "size", "ariaLabel"],
  setup() {
    return () => h("section", { class: "mock-segmented-toggle" }, "审批流状态");
  },
};

const approvalFlowCardListMock = {
  name: "ApprovalFlowCardList",
  setup() {
    return () => h("section", { class: "mock-approval-flow-card-list" }, "审批流列表");
  },
};

let dashboardShellContext: Record<string, unknown>;
let approvalFlowController: Record<string, unknown>;

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => dashboardShellContext,
}));

vi.mock("../../../server-web/composables/console-approval-flow-view-controller", () => ({
  useApprovalFlowViewController: () => approvalFlowController,
}));

function createDashboardAlert(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    alertId: "monitor.supervisor.recovery",
    category: "后台报警",
    title: "后台告警",
    detail: "待处理告警",
    status: "待处理",
    tone: "warning",
    actionLabel: "查看巡检",
    source: "monitor",
    actionKind: "open",
    ...overrides,
  };
}

function makeDashboardShellContext(overrides: {
  consoleState: Record<string, unknown>;
  dashboardAlertCounts: Record<string, number>;
  dashboardAlertSummary: string;
  dashboardAlerts: Record<string, unknown>[];
  dashboardPrimaryAlert: Record<string, unknown> | null;
  dashboardConfigurationQueue: Record<string, unknown>[];
  dashboardMonitorQueue: Record<string, unknown>[];
  dashboardSecondaryAlerts: Record<string, unknown>[];
  busyKey?: string;
  knowledgeConsoleAvailable?: boolean;
}) {
  const openDashboardAlert = vi.fn(async () => undefined);
  const dismissDashboardAlert = vi.fn(async () => undefined);

  return {
    busyKey: ref(overrides.busyKey || ""),
    consoleState: ref(overrides.consoleState),
    dashboardAlertCounts: ref(overrides.dashboardAlertCounts),
    dashboardAlertInboxId: (alert: { alertId: string; source: string }) => `${alert.source}:${alert.alertId}`,
    dashboardAlertSummary: overrides.dashboardAlertSummary,
    dashboardAlerts: ref(overrides.dashboardAlerts),
    dashboardConfigurationQueue: ref(overrides.dashboardConfigurationQueue),
    dashboardMonitorQueue: ref(overrides.dashboardMonitorQueue),
    dashboardPrimaryAlert: ref(overrides.dashboardPrimaryAlert),
    dashboardSecondaryAlerts: ref(overrides.dashboardSecondaryAlerts),
    dismissDashboardAlert,
    knowledgeConsole: {
      available: overrides.knowledgeConsoleAvailable ?? true,
    },
    openDashboardAlert,
  };
}

function makeApprovalFlowController(count = 0) {
  return {
    approvalFlowCards: ref(Array.from({ length: count }, (_, index) => ({
      key: `mock-${index}`,
    }))),
    approvalFlowStatus: ref("pending"),
    mcpAuthorizationStatusOptionBarOptions: [
      { value: "pending", label: "待处理" },
      { value: "approved", label: "已处理" },
    ],
  };
}

function mountDashboard(overrides: {
  consoleState: Record<string, unknown>;
  dashboardAlertCounts: Record<string, number>;
  dashboardAlertSummary?: string;
  dashboardAlerts: Record<string, unknown>[];
  dashboardPrimaryAlert: Record<string, unknown> | null;
  dashboardConfigurationQueue: Record<string, unknown>[];
  dashboardMonitorQueue: Record<string, unknown>[];
  dashboardSecondaryAlerts: Record<string, unknown>[];
  busyKey?: string;
  knowledgeConsoleAvailable?: boolean;
  approvalFlowCardCount?: number;
}) {
  dashboardShellContext = makeDashboardShellContext({
    dashboardAlerts: overrides.dashboardAlerts,
    dashboardAlertCounts: overrides.dashboardAlertCounts,
    dashboardAlertSummary: overrides.dashboardAlertSummary || "",
    dashboardConfigurationQueue: overrides.dashboardConfigurationQueue,
    dashboardMonitorQueue: overrides.dashboardMonitorQueue,
    dashboardPrimaryAlert: overrides.dashboardPrimaryAlert,
    dashboardSecondaryAlerts: overrides.dashboardSecondaryAlerts,
    consoleState: overrides.consoleState,
    busyKey: overrides.busyKey,
    knowledgeConsoleAvailable: overrides.knowledgeConsoleAvailable,
  });

  approvalFlowController = makeApprovalFlowController(overrides.approvalFlowCardCount || 0);

  return mount(DashboardView, {
    global: {
      stubs: {
        StatusPill: statusPillMock,
        SegmentedToggle: segmentedToggleMock,
        ApprovalFlowCardList: approvalFlowCardListMock,
      },
    },
  });
}

describe("DashboardView", () => {
  it("基础渲染与无报警分支：展示关键指标与空状态", () => {
    const wrapper = mountDashboard({
      busyKey: "",
      consoleState: {
        storage: {
          emailCount: 12,
          rawObjectCount: 3,
          transactionCount: 8,
          threadCount: 1,
        },
        clients: {
          summary: {
            totalCount: 0,
            offlineCount: 0,
          },
        },
        jobs: {
          summary: {
            queuedCount: 0,
            runningCount: 0,
            completedCount: 11,
          },
        },
      },
      dashboardAlertSummary: "当前无报警",
      dashboardAlertCounts: {
        total: 0,
        danger: 0,
        warning: 0,
        success: 0,
        recovered: 0,
        configuration: 0,
        monitor: 0,
      },
      dashboardAlerts: [],
      dashboardPrimaryAlert: null,
      dashboardConfigurationQueue: [],
      dashboardMonitorQueue: [],
      dashboardSecondaryAlerts: [],
      knowledgeConsoleAvailable: false,
      approvalFlowCardCount: 0,
    });

    const metricValues = wrapper.findAll(".metric-card h3").map((node) => node.text());
    expect(metricValues).toEqual(["12", "8", "0", "0"]);

    const pills = wrapper.findAll(".metric-card .mock-status-pill");
    expect(pills[0].text()).toBe("未启用");
    expect(pills[1].text()).toBe("无客户端");
    expect(pills[2].text()).toBe("空闲");

    expect(wrapper.find(".configuration-alert-empty").text()).toContain("没有报警");
    expect(wrapper.find(".dashboard-approval-card .mock-status-pill").text()).toBe("已清空");
  });

  it("告警分支展示主告警、队列与交互动作", async () => {
    const primary = createDashboardAlert({
      alertId: "supervisor.recovered",
      tone: "danger",
      actionKind: "recover-supervisor",
      actionLabel: "恢复进程",
      status: "待恢复",
    });
    const configQueueItem = createDashboardAlert({
      alertId: "config-empty",
      category: "配置队列",
      title: "配置未设置",
      detail: "需优先处理",
      source: "configuration",
      tone: "warning",
      actionKind: "open",
      actionLabel: "处理配置",
    });
    const monitorQueueItem = createDashboardAlert({
      alertId: "monitor.latency",
      title: "巡检延迟",
      source: "monitor",
      tone: "warning",
      actionKind: "open",
      actionLabel: "查看巡检",
    });
    const secondaryItem = createDashboardAlert({
      alertId: "recover-success",
      category: "已恢复",
      title: "上一次任务已恢复",
      tone: "success",
      detail: "可忽略",
      status: "已恢复",
      source: "monitor",
      actionKind: "open",
      actionLabel: "确认恢复",
    });

    const wrapper = mountDashboard({
      consoleState: {
        storage: {
          emailCount: 3,
          rawObjectCount: 9,
          transactionCount: 20,
          threadCount: 7,
        },
        clients: {
          summary: {
            totalCount: 4,
            offlineCount: 1,
          },
        },
        jobs: {
          summary: {
            queuedCount: 2,
            runningCount: 1,
            completedCount: 3,
          },
        },
      },
      dashboardAlertSummary: "2项待处理",
      dashboardAlertCounts: {
        total: 4,
        danger: 1,
        warning: 2,
        success: 1,
        recovered: 1,
        configuration: 1,
        monitor: 2,
      },
      dashboardAlerts: [primary, configQueueItem, monitorQueueItem, secondaryItem],
      dashboardPrimaryAlert: primary,
      dashboardConfigurationQueue: [configQueueItem],
      dashboardMonitorQueue: [monitorQueueItem],
      dashboardSecondaryAlerts: [secondaryItem],
      busyKey: "background-supervisor:recover",
      approvalFlowCardCount: 1,
    });

    expect(wrapper.find(".dashboard-alert-primary .configuration-alert-action").text()).toBe("拉起中");
    expect(wrapper.findAll(".dashboard-alert-queue").length).toBe(2);

    const configQueueButton = wrapper.findAll(".dashboard-alert-queue .configuration-alert-action")[0];
    await configQueueButton.trigger("click");
    expect((dashboardShellContext.openDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(configQueueItem);

    const secondaryOpen = wrapper.find(".dashboard-alert-secondary-list .configuration-alert-actions .configuration-alert-action");
    await secondaryOpen.trigger("click");
    expect((dashboardShellContext.openDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(secondaryItem);

    const primaryDismiss = wrapper.find(".dashboard-alert-primary-actions .danger-action");
    await primaryDismiss.trigger("click");
    expect((dashboardShellContext.dismissDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(primary);
  });

  it("告警队列为空时走已置顶分支并保留主状态", () => {
    const primary = createDashboardAlert({
      alertId: "monitor.monitor-only",
      tone: "warning",
      title: "仅保留主告警",
    });

    const wrapper = mountDashboard({
      consoleState: {
        storage: {
          emailCount: 1,
          rawObjectCount: 1,
          transactionCount: 1,
          threadCount: 1,
        },
        clients: {
          summary: {
            totalCount: 1,
            offlineCount: 0,
          },
        },
        jobs: {
          summary: {
            queuedCount: 1,
            runningCount: 0,
            completedCount: 0,
          },
        },
      },
      dashboardAlertSummary: "1项警报",
      dashboardAlertCounts: {
        total: 1,
        danger: 0,
        warning: 1,
        success: 0,
        recovered: 0,
        configuration: 1,
        monitor: 1,
      },
      dashboardAlerts: [primary],
      dashboardPrimaryAlert: primary,
      dashboardConfigurationQueue: [],
      dashboardMonitorQueue: [],
      dashboardSecondaryAlerts: [],
      approvalFlowCardCount: 2,
    });

    expect(wrapper.text()).toContain("首要配置项已置顶。");
    expect(wrapper.text()).toContain("首要巡检项已置顶。");
    expect(wrapper.find(".dashboard-approval-card .mock-status-pill").text()).toBe("2 项");
  });
});
