// @vitest-environment jsdom
import { h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
import ClientsView from "../../../server-web/views/admin/ClientsView.vue";
import ServerConsoleApp from "../../../server-web/ServerConsoleApp.vue";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";

const importClientsMock = vi.fn();
const exportClientsMock = vi.fn();
const formatCompactDateMock = vi.fn((value: string) => `formatted:${value}`);

const jumpToKnowledgeFileImportMock = vi.fn();

let serverShellContext: Record<string, unknown>;
let clientsShellContext: Record<string, unknown>;

vi.mock("../../../server-web/composables/useServerConsoleShell", () => ({
  useServerConsoleShell: () => serverShellContext,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  provideServerConsoleShell: vi.fn(),
  useServerConsoleShellContext: () => clientsShellContext,
}));

vi.mock("../../../server-web/composables/console-format-utils", () => ({
  formatCompactDate: (...args: Parameters<typeof formatCompactDateMock>) =>
    formatCompactDateMock(...args),
}));

const SideNavMock = {
  name: "ConsoleSideNav",
  setup() {
    return () => h("aside", { class: "mock-console-side-nav" }, "console-side-nav");
  },
};

const TopbarMock = {
  name: "ConsoleTopbar",
  setup() {
    return () => h("header", { class: "mock-console-topbar" }, "console-topbar");
  },
};

const DrawerMock = {
  name: "ConsoleDrawer",
  setup() {
    return () => h("section", { class: "mock-console-drawer" }, "console-drawer");
  },
};

const SideNavDirectoryMock = {
  name: "ConsoleSideNavDirectory",
  setup() {
    return () => h("section", { class: "mock-side-nav-directory" }, "side-nav-directory");
  },
};

const AuthGateMock = {
  name: "ConsoleAuthGate",
  setup() {
    return () => h("section", { class: "mock-console-auth-gate" }, "auth-gate");
  },
};

const AgentEvidencePreviewDialogMock = {
  name: "AgentEvidencePreviewDialog",
  setup() {
    return () => h("section", { class: "mock-evidence-preview-dialog" }, "evidence-preview");
  },
};

const ServerPathPickerDialogMock = {
  name: "ServerPathPickerDialog",
  setup() {
    return () => h("section", { class: "mock-path-picker-dialog" }, "path-picker");
  },
};

const RouterViewMock = {
  name: "RouterView",
  setup() {
    return () => h("section", { class: "mock-router-view" }, "router-view");
  },
};

const OptionBarMock = {
  name: "OptionBar",
  props: ["modelValue", "options", "class"],
  setup() {
    return () => h("div", { class: "mock-option-bar" }, "过滤");
  },
};

const StatusPillMock = {
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props: Record<string, unknown>) {
    return () =>
      h(
        "span",
        { class: "mock-status-pill", "data-tone": String(props.tone || "") },
        String(props.label || ""),
      );
  },
};

function routeByPath(path: string) {
  return router.getRoutes().find((route) => route.path === path);
}

function resetRouterRoot() {
  return router.push("/");
}

function setServerShellState(overrides: {
  authBootstrapping?: boolean;
  error?: string | null;
  errorNeedsKnowledgeImportAction?: boolean;
  isAuthenticated?: boolean;
  msg?: {
    error?: string;
    actions?: { goImport?: string };
  };
}) {
  jumpToKnowledgeFileImportMock.mockClear();
  serverShellContext = {
    activeRouteView: ref("dashboard"),
    authBootstrapping: ref(overrides.authBootstrapping ?? false),
    error: overrides.error || null,
    errorNeedsKnowledgeImportAction: ref(overrides.errorNeedsKnowledgeImportAction ?? false),
    isAuthenticated: ref(overrides.isAuthenticated ?? true),
    jumpToKnowledgeFileImport: jumpToKnowledgeFileImportMock,
    msg: {
      error: overrides.msg?.error || "出现错误",
      actions: { goImport: overrides.msg?.actions?.goImport || "去导入" },
    },
  };
}

function mountServerConsoleApp() {
  return mount(ServerConsoleApp, {
    global: {
      stubs: {
        ConsoleSideNav: SideNavMock,
        ConsoleSideNavDirectory: SideNavDirectoryMock,
        ConsoleTopbar: TopbarMock,
        ConsoleDrawer: DrawerMock,
        ConsoleAuthGate: AuthGateMock,
        AgentEvidencePreviewDialog: AgentEvidencePreviewDialogMock,
        ServerPathPickerDialog: ServerPathPickerDialogMock,
        RouterView: RouterViewMock,
      },
      plugins: [router],
    },
  });
}

function setClientsShellState(overrides: {
  summary?: { totalCount: number; offlineCount: number };
  clients: Array<Record<string, unknown>>;
  clientSearchQuery?: string;
  clientStateFilter?: string;
  clientStateFilterOptions?: Array<Record<string, unknown>>;
}) {
  clientsShellContext = {
    clientSearchQuery: ref(overrides.clientSearchQuery || ""),
    clientStateFilter: ref(overrides.clientStateFilter || "all"),
    clientStateFilterOptionBarOptions: overrides.clientStateFilterOptions || [
      { value: "all", label: "全部" },
      { value: "offline", label: "离线" },
    ],
    consoleState: ref({
      clients: {
        summary: {
          totalCount: overrides.summary?.totalCount || 0,
          offlineCount: overrides.summary?.offlineCount || 0,
        },
      },
    }),
    exportClients: exportClientsMock,
    filteredClientList: ref(overrides.clients),
    importClients: importClientsMock,
  };
}

function mountClientsView() {
  return mount(ClientsView, {
    global: {
      stubs: {
        OptionBar: OptionBarMock,
        StatusPill: StatusPillMock,
      },
    },
  });
}

describe("server-web router/app/clients final extra", () => {
  beforeEach(async () => {
    setConsoleLocaleState("zh-CN");
    formatCompactDateMock.mockClear();
    importClientsMock.mockClear();
    exportClientsMock.mockClear();
    jumpToKnowledgeFileImportMock.mockClear();
    await resetRouterRoot();
    await router.isReady();
  });

  it("registers route table boundaries including admin special-case routes", () => {
    expect(routeByPath("/admin/clients")?.meta).toMatchObject({
      viewId: "admin",
      adminView: "clients",
    });
    expect(routeByPath("/admin/maintenance-agent")?.meta).toMatchObject({
      viewId: "admin",
      adminView: "maintenanceAgent",
    });
    expect(routeByPath("/admin/context-management")?.meta).toMatchObject({
      viewId: "admin",
      adminView: "contextManagement",
    });
    expect(routeByPath("/admin/tool-stats")?.meta).toMatchObject({
      viewId: "admin",
      adminView: "toolStats",
    });
    expect(routeByPath("/admin/tool-list")?.meta).toMatchObject({ viewId: "admin", adminView: "toolList" });
    expect(routeByPath("/admin/tools")?.redirect).toBe("/admin/tool-list");
    expect(routeByPath("/admin/agent-management")?.redirect).toBe("/admin/agent-config");
  });

  it("falls back from invalid tabs and unknown paths to canonical routes", async () => {
    await router.push("/knowledge/does-not-exist");
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/unsupported");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/external-services/unsupported");
    expect(router.currentRoute.value.path).toBe("/external-services/list");

    await router.push("/admin/tools");
    expect(router.currentRoute.value.path).toBe("/admin/tool-list");

    await router.push("/admin/agent-management");
    expect(router.currentRoute.value.path).toBe("/admin/agent-config");

    await router.push("/random/path");
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("renders root app states and exposes import action from status strip", async () => {
    setServerShellState({ authBootstrapping: true, isAuthenticated: false, error: null });

    const bootstrapping = mountServerConsoleApp();
    expect(bootstrapping.find(".mock-console-auth-gate").exists()).toBe(false);
    expect(bootstrapping.find(".mock-router-view").exists()).toBe(false);
    expect(bootstrapping.find(".status-strip").exists()).toBe(false);

    setServerShellState({
      isAuthenticated: true,
      error: null,
      authBootstrapping: false,
    });
    const authDone = mountServerConsoleApp();
    expect(authDone.find(".status-strip").exists()).toBe(false);
    expect(authDone.find(".mock-router-view").exists()).toBe(true);

    setServerShellState({
      isAuthenticated: true,
      error: "临时失败",
      errorNeedsKnowledgeImportAction: true,
    });
    const errorState = mountServerConsoleApp();
    expect(errorState.find(".status-strip").text()).toContain("临时失败");
    await errorState.find(".status-strip-action").trigger("click");
    expect(jumpToKnowledgeFileImportMock).toHaveBeenCalledTimes(1);
    expect(errorState.find(".mock-console-auth-gate").exists()).toBe(false);
  });

  it("localizes the global status-strip error message in English", async () => {
    setConsoleLocaleState("en");
    setServerShellState({
      isAuthenticated: true,
      error: "接口不存在.",
      authBootstrapping: false,
      msg: { error: "Error" },
    });

    const wrapper = mountServerConsoleApp();

    expect(wrapper.find(".status-strip").text()).toContain("Error");
    expect(wrapper.find(".status-strip").text()).toContain("Endpoint does not exist.");
    expect(wrapper.find(".status-strip").text()).not.toContain("接口不存在");
  });

  it("renders ClientsView empty state and dispatches import/export actions", async () => {
    setClientsShellState({
      summary: { totalCount: 0, offlineCount: 0 },
      clients: [],
    });
    const emptyState = mountClientsView();

    expect(emptyState.find(".empty-state").text()).toContain("暂无匹配客户端");
    expect(emptyState.findAll("tbody tr").length).toBe(0);

    await emptyState.get("button.tool-button-ghost").trigger("click");
    expect(importClientsMock).toHaveBeenCalledTimes(1);

    await emptyState.get("button.tool-button-ghost:last-of-type").trigger("click");
    expect(exportClientsMock).toHaveBeenCalledTimes(1);
  });

  it("renders ClientsView table rows and hides optional connection detail slot when absent", async () => {
    setClientsShellState({
      summary: { totalCount: 3, offlineCount: 1 },
      clients: [
        {
          clientId: "c-1",
          clientLabel: "Alpha Client",
          appVersion: "1.3.5",
          migrationState: "aligned",
          connectionMethod: "grpc://127.0.0.1",
          connectionDetail: "本地连接",
          configVersion: "a1",
          lastSeenAt: "2026-06-01T08:20:00.000Z",
        },
        {
          clientId: "c-2",
          appVersion: "",
          migrationState: "draining",
          connectionKind: "mcp-plugin",
          connectionState: "disabled",
          connectionMethod: "plugin",
          configVersion: "",
          lastSeenAt: "2026-06-02T08:20:00.000Z",
        },
      ],
    });
    const wrapper = mountClientsView();

    expect(wrapper.find(".section-tags").text().replace(/\s+/g, " ")).toContain("总计 3");
    expect(wrapper.find(".section-tags").text().replace(/\s+/g, " ")).toContain("在线 2");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.findAll(".mock-status-pill").length).toBe(4);
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("Alpha Client");
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("c-1");
    expect(wrapper.findAll("tbody tr")[1].text()).toContain("c-2");
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("本地连接");
    expect(wrapper.findAll("tbody tr")[1].text()).not.toContain("Discovery Check-in");
    expect(formatCompactDateMock).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("Discovery Check-in");
    expect(exportClientsMock).not.toHaveBeenCalled();
    expect(importClientsMock).not.toHaveBeenCalled();
  });
});
