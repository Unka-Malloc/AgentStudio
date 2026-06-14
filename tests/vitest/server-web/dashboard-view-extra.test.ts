// @vitest-environment jsdom
import { h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";
import DashboardView from "../../../server-web/views/DashboardView.vue";

const statusPillMock = {
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props: Record<string, unknown>) {
    return () =>
      h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
  },
};

let dashboardShellContext: Record<string, unknown>;
let approvalFlowController: Record<string, unknown>;

afterEach(() => {
  setConsoleLocaleState("zh-CN");
});

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
  const requests = Array.from({ length: count }, (_, index) => ({
    requestId: `auth-${index}`,
    status: "pending",
    clientName: `Client ${index + 1}`,
    reason: "test approval",
    requestedTools: ["tool.read"],
    requestedScopes: ["knowledge:read"],
  }));
  return {
    acceptKnowledgeReview: vi.fn(),
    approvalFlowCards: ref(requests.map((request, index) => ({
      key: `authorization:${request.requestId}`,
      kind: "authorization",
      tone: "warning",
      label: "MCP 客户端授权",
      title: request.clientName,
      summary: `用途说明：${request.reason}`,
      meta: ["待审批", "工具 1 个", "权限域 1 个"],
      request,
    }))),
    approvalFlowStatus: ref("pending"),
    approveAuthorization: vi.fn(),
    authorizationBusy: vi.fn(() => false),
    fuseKnowledgeReviewItem: vi.fn(),
    keepBothKnowledgeReview: vi.fn(),
    mcpAuthorizationStatusOptionBarOptions: [
      { value: "pending", label: "待处理" },
      { value: "approved", label: "已处理" },
    ],
    rejectAuthorization: vi.fn(),
    rejectKnowledgeReview: vi.fn(),
    replaceKnowledgeReview: vi.fn(),
    reviewBusy: vi.fn(() => false),
    reviewFusionDisabled: vi.fn(() => false),
    reviewKeepBothDisabled: vi.fn(() => false),
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

    expect(wrapper.find(".dashboard-todo-card .configuration-alert-empty").text()).toContain("没有待办事项");
    expect(wrapper.find(".dashboard-todo-card .mock-status-pill").text()).toBe("已清空");
    expect(wrapper.find(".dashboard-approval-card").exists()).toBe(false);
  });

  it("英文模式下待办摘要直接渲染为英文", () => {
    setConsoleLocaleState("en");
    const alert = createDashboardAlert({
      alertId: "english-alert",
      tone: "danger",
      source: "monitor",
    });

    const wrapper = mountDashboard({
      consoleState: {
        storage: {
          emailCount: 0,
          rawObjectCount: 0,
          transactionCount: 0,
          threadCount: 0,
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
            completedCount: 0,
          },
        },
      },
      dashboardAlertSummary: "No alerts",
      dashboardAlertCounts: {
        total: 0,
        danger: 2,
        warning: 0,
        success: 0,
        recovered: 0,
        configuration: 0,
        monitor: 0,
      },
      dashboardAlerts: [alert],
      dashboardPrimaryAlert: alert,
      dashboardConfigurationQueue: [],
      dashboardMonitorQueue: [],
      dashboardSecondaryAlerts: [],
      approvalFlowCardCount: 1,
    });

    expect(wrapper.find(".dashboard-todo-card .section-header p").text()).toBe("1 alerts · 1 approvals");
    expect(wrapper.find(".dashboard-todo-card .mock-status-pill").text()).toBe("2 items");
  });

  it("待办分支合并告警与审批并保留交互动作", async () => {
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

    expect(wrapper.findAll(".dashboard-todo-item")).toHaveLength(5);
    expect(wrapper.find(".dashboard-todo-item .configuration-alert-action").text()).toBe("拉起中");
    expect(wrapper.text()).toContain("Client 1");

    const configQueueButton = wrapper.findAll(".dashboard-todo-item .configuration-alert-action")[2];
    await configQueueButton.trigger("click");
    expect((dashboardShellContext.openDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(configQueueItem);

    const secondaryOpen = wrapper.findAll(".dashboard-todo-item .configuration-alert-action")[6];
    await secondaryOpen.trigger("click");
    expect((dashboardShellContext.openDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(secondaryItem);

    const primaryDismiss = wrapper.find(".dashboard-todo-item .danger-action");
    await primaryDismiss.trigger("click");
    expect((dashboardShellContext.dismissDashboardAlert as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(primary);
  });

  it("没有告警但存在审批时仍显示待办事项", async () => {
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
      approvalFlowCardCount: 2,
    });

    expect(primary).toBeTruthy();
    expect(wrapper.findAll(".dashboard-todo-item")).toHaveLength(2);
    expect(wrapper.find(".dashboard-todo-card .mock-status-pill").text()).toBe("2 项");
    await wrapper.find(".dashboard-todo-item .configuration-alert-action").trigger("click");
    expect(approvalFlowController.approveAuthorization as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });
});
