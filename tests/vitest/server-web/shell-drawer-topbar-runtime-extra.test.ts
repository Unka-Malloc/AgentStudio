// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const shellState = vi.hoisted(() => {
  const { reactive: vueReactive, ref: vueRef } = require("vue");
  const makeModule = (overrides: Record<string, unknown> = {}) => ({
    name: "analysis",
    label: "分析模块",
    description: "分析模块说明",
    externalEnabled: true,
    runtimeMount: { id: "analysis-runtime" },
    ...overrides,
  });

  const shared = {
    authState: {
      appearanceCycleScheme: vueRef("dark"),
      appearanceCycleSchemeLabel: vueRef("深色主题组"),
      appearanceCycleSchemeOptions: vueRef([
        { label: "深色", value: "dark", icon: "moon" },
        { label: "浅色", value: "light", icon: "sun" },
      ]),
      appearancePresetId: vueRef("default-system"),
      appearancePresetLabel: vueRef("落日余烬"),
      appearancePresetSelectionId: vueRef("sunset-ember"),
      appearancePresetOptionsForCycleScheme: vueRef([{ label: "落日余烬", value: "sunset-ember" }]),
      appearancePresetCatalogMessage: vueRef(""),
      appearancePresetImporting: vueRef(false),
      importAppearancePresetFileToServer: vi.fn(),
      refreshAppearancePresetConfigs: vi.fn(),
      currentUser: vueRef(null),
      cycleAppearancePreset: vi.fn(),
      closeDrawer: vi.fn(() => {
        shared.authState.drawerOpen.value = false;
      }),
      drawerOpen: vueRef(false),
      drawerTab: vueRef("preferences"),
      openDrawer: vi.fn((tab: string) => {
        shared.authState.drawerTab.value = tab;
        shared.authState.drawerOpen.value = true;
      }),
      hasFeature: vi.fn((featureId: string) => featureId !== "knowledge-core"),
      isAuthenticated: vueRef(true),
      languageMode: vueRef("en"),
      localizedViewTitle: vueRef("控制台概览"),
      msg: vueReactive({
        close: "关闭",
        drawer: {
          appearancePreset: "配色",
          directories: "同步目录",
          importAppearancePresetToServer: "导入到服务端",
          language: "语言",
          preferences: "偏好设置",
          preferencesDescription: "本地显示设置",
          preferencesTitle: "界面偏好",
          reloadAppearancePresets: "重新加载配色文件",
          serviceDiscovery: "服务发现",
          theme: "主题",
          themeDark: "深色",
          themeLight: "浅色",
          title: "系统配置",
          users: "控制台用户",
        },
        nav: {
          agents: "智能体",
          agentAssignment: "智能体分配",
          agentConfig: "智能体配置",
          contextManagement: "上下文管理",
        },
        topbar: {
          appearanceCycleSchemeDarkLabel: "深色主题组",
          appearanceCycleSchemeDarkTitle: "当前：深色主题组（点击切换浅色主题组）",
          appearanceCycleSchemeLightLabel: "浅色主题组",
          appearanceCycleSchemeLightTitle: "当前：浅色主题组（点击切换深色主题组）",
          appearancePresetLabel: "配色",
          appearancePresetTitle: "配色（点击切换下一个）",
          languageEnLabel: "切换到英文",
          languageEnTitle: "English",
          languageZhLabel: "切换到中文",
          languageZhTitle: "中文",
          toggleNav: "切换导航",
        },
      }),
      pageRefreshAriaLabel: "刷新页面",
      pageRefreshBusy: vueRef(false),
      pageRefreshTitle: "刷新当前页面",
      refreshCurrentPage: vi.fn(),
      serverAvailable: true,
      serviceStatusLabel: "服务正常",
      serviceUrl: "http://localhost:8080",
      setAppearanceCycleScheme: vi.fn(),
      setAppearancePreset: vi.fn(),
      setLanguage: vi.fn(),
      sideNavCollapsed: vueRef(false),
      sideNavOpen: vueRef(false),
      toggleAppearanceCycleScheme: vi.fn(),
      toggleLanguage: vi.fn(),
      tt: vi.fn((value: string) => value),
    },
    moduleState: {
      busyKey: vueRef(""),
      canBrowseServerPaths: true,
      consoleState: vueRef({
        runtime: {
          mountGeneration: 7,
        },
      }),
      enabledMountCount: 2,
      isMountPathEditing: vi.fn((name: string) => name === "analysis"),
      moduleGroups: vueRef([
        {
          id: "core",
          label: "核心模块",
          description: "系统内置模块",
          rows: [makeModule({ name: "analysis", label: "分析模块" })],
        },
        {
          id: "custom",
          label: "自定义模块",
          description: "运行时发现的自定义外置能力模块。",
          rows: [makeModule({
            name: "custom-module",
            label: "自定义模块",
            description: "外部模块说明",
            externalEnabled: false,
            runtimeMount: null,
          })],
        },
      ]),
      mountDraft: vueReactive<Record<string, string>>({
        analysis: "/modules/analysis.mjs",
        "custom-module": "",
      }),
      openMountPathPicker: vi.fn(),
      reloadModules: vi.fn(),
      saveMountModules: vi.fn(),
      toggleMountPathEdit: vi.fn(),
      totalMountCount: 3,
    },
    sideNavState: {
      activeRouteAdminView: vueRef("agentAssignment"),
      activeRouteView: vueRef("admin"),
      hasAnyFeature: vi.fn((featureIds: string[]) =>
        featureIds.some((featureId) => featureId === "agent-gateway" || featureId === "agent-exploration"),
      ),
      hasFeature: vi.fn((featureId: string) => featureId === "agent-gateway"),
      msg: vueReactive({
        nav: {
          agents: "智能体",
          agentAssignment: "智能体分配",
          agentConfig: "智能体配置",
          contextManagement: "上下文管理",
        },
      }),
      openAdmin: vi.fn(),
    },
  };

  return shared;
});

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => ({
    ...shellState.authState,
    ...shellState.moduleState,
  }),
}));

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: () => shellState.sideNavState,
}));

vi.mock("../../../server-web/components/shell/ConsoleAuthUsersPanel.vue", () => ({
  default: defineComponent({
    name: "ConsoleAuthUsersPanelStub",
    template: '<div class="console-auth-users-panel-stub">users</div>',
  }),
}));

vi.mock("../../../server-web/components/shell/ConsolePreferencesPanel.vue", () => ({
  default: defineComponent({
    name: "ConsolePreferencesPanelStub",
    template: '<div class="console-preferences-panel-stub">preferences</div>',
  }),
}));

vi.mock("../../../server-web/components/shell/ConsoleServiceDiscoveryPanel.vue", () => ({
  default: defineComponent({
    name: "ConsoleServiceDiscoveryPanelStub",
    template: '<div class="console-service-discovery-panel-stub">discovery</div>',
  }),
}));

vi.mock("../../../server-web/components/shell/ConsoleSyncDirectoriesPanel.vue", () => ({
  default: defineComponent({
    name: "ConsoleSyncDirectoriesPanelStub",
    template: '<div class="console-sync-directories-panel-stub">sync</div>',
  }),
}));

vi.mock("../../../server-web/components/BrowseSelectButton.vue", () => ({
  default: defineComponent({
    name: "BrowseSelectButtonStub",
    props: {
      buttonClass: String,
      buttonText: String,
      disabled: Boolean,
    },
    emits: ["browse"],
    setup(props, { emit }) {
      return () =>
        h(
          "button",
          {
            class: ["browse-select-button-stub", props.buttonClass],
            type: "button",
            disabled: !!props.disabled,
            onClick: () => {
              if (!props.disabled) {
                emit("browse");
              }
            },
          },
          props.buttonText || "浏览",
        );
    },
  }),
}));

vi.mock("../../../server-web/components/StatusPill.vue", () => ({
  default: defineComponent({
    name: "StatusPillStub",
    props: {
      enabled: Boolean,
      label: String,
    },
    setup(props) {
      return () =>
        h(
          "span",
          {
            class: "status-pill-stub",
            "data-enabled": String(!!props.enabled),
          },
          props.label || "",
        );
    },
  }),
}));

vi.mock("../../../server-web/components/shell/side-nav/ConsoleSideNavLink.vue", () => ({
  default: defineComponent({
    name: "ConsoleSideNavLinkStub",
    props: {
      active: Boolean,
      label: String,
      subtle: Boolean,
    },
    emits: ["activate"],
    setup(props, { emit, slots }) {
      return () =>
        h(
          "button",
          {
            class: ["side-nav-link-stub", { active: !!props.active, subtle: !!props.subtle }],
            type: "button",
            onClick: () => emit("activate"),
          },
          [slots.icon?.(), h("span", { class: "side-nav-link-label-stub" }, props.label || "")],
        );
    },
  }),
}));

const { default: ConsoleDrawer } = await import("../../../server-web/components/shell/ConsoleDrawer.vue");
const { default: ConsoleTopbar } = await import("../../../server-web/components/shell/ConsoleTopbar.vue");
const { default: ConsoleRuntimeModulesPanel } = await import("../../../server-web/components/shell/ConsoleRuntimeModulesPanel.vue");
const { default: ConsoleSideNavAgentSection } = await import("../../../server-web/components/shell/side-nav/ConsoleSideNavAgentSection.vue");

const mounted = [];

function flush() {
  return nextTick();
}

function resetAuthState() {
  shellState.authState.appearanceCycleScheme.value = "dark";
  shellState.authState.appearanceCycleSchemeLabel.value = "深色主题组";
  shellState.authState.appearanceCycleSchemeOptions.value = [
    { label: "深色", value: "dark", icon: "moon" },
    { label: "浅色", value: "light", icon: "sun" },
  ];
  shellState.authState.appearancePresetId.value = "default-system";
  shellState.authState.appearancePresetLabel.value = "落日余烬";
  shellState.authState.appearancePresetSelectionId.value = "sunset-ember";
  shellState.authState.appearancePresetOptionsForCycleScheme.value = [{ label: "落日余烬", value: "sunset-ember" }];
  shellState.authState.appearancePresetCatalogMessage.value = "";
  shellState.authState.appearancePresetImporting.value = false;
  shellState.authState.importAppearancePresetFileToServer.mockReset();
  shellState.authState.refreshAppearancePresetConfigs.mockReset();
  shellState.authState.currentUser.value = null;
  shellState.authState.cycleAppearancePreset.mockReset();
  shellState.authState.closeDrawer.mockReset();
  shellState.authState.closeDrawer.mockImplementation(() => {
    shellState.authState.drawerOpen.value = false;
  });
  shellState.authState.drawerOpen.value = false;
  shellState.authState.drawerTab.value = "preferences";
  shellState.authState.openDrawer.mockReset();
  shellState.authState.openDrawer.mockImplementation((tab: string) => {
    shellState.authState.drawerTab.value = tab;
    shellState.authState.drawerOpen.value = true;
  });
  shellState.authState.hasFeature.mockImplementation((featureId: string) => featureId !== "knowledge-core");
  shellState.authState.isAuthenticated.value = true;
  shellState.authState.languageMode.value = "en";
  shellState.authState.localizedViewTitle.value = "控制台概览";
  shellState.authState.pageRefreshBusy.value = false;
  shellState.authState.pageRefreshTitle = "刷新当前页面";
  shellState.authState.refreshCurrentPage.mockReset();
  shellState.authState.serverAvailable = true;
  shellState.authState.serviceStatusLabel = "服务正常";
  shellState.authState.serviceUrl = "http://localhost:8080";
  shellState.authState.setAppearanceCycleScheme.mockReset();
  shellState.authState.setAppearancePreset.mockReset();
  shellState.authState.setLanguage.mockReset();
  shellState.authState.sideNavCollapsed.value = false;
  shellState.authState.sideNavOpen.value = false;
  shellState.authState.toggleAppearanceCycleScheme.mockReset();
  shellState.authState.toggleLanguage.mockReset();
  shellState.authState.tt.mockImplementation((value: string) => value);
}

function resetModuleState() {
  shellState.moduleState.busyKey.value = "";
  shellState.moduleState.canBrowseServerPaths = true;
  shellState.moduleState.consoleState.value = { runtime: { mountGeneration: 7 } } as any;
  shellState.moduleState.enabledMountCount = 2;
  shellState.moduleState.isMountPathEditing.mockImplementation((name: string) => name === "analysis");
  shellState.moduleState.moduleGroups.value = [
    {
      id: "core",
      label: "核心模块",
      description: "系统内置模块",
      rows: [
        {
          name: "analysis",
          label: "分析模块",
          description: "分析模块说明",
          externalEnabled: true,
          runtimeMount: { id: "analysis-runtime" },
          pathHint: "/modules/analysis.mjs",
        },
      ],
    },
    {
      id: "custom",
      label: "自定义模块",
      description: "运行时发现的自定义外置能力模块。",
      rows: [
        {
          name: "custom-module",
          label: "自定义模块",
          description: "外部模块说明",
          externalEnabled: false,
          runtimeMount: null,
          pathHint: "填写外置模块 .mjs 路径",
        },
      ],
    },
  ] as any;
  shellState.moduleState.mountDraft.analysis = "/modules/analysis.mjs";
  shellState.moduleState.mountDraft["custom-module"] = "";
  shellState.moduleState.openMountPathPicker.mockReset();
  shellState.moduleState.reloadModules.mockReset();
  shellState.moduleState.saveMountModules.mockReset();
  shellState.moduleState.toggleMountPathEdit.mockReset();
  shellState.moduleState.totalMountCount = 3;
}

function resetSideNavState() {
  shellState.sideNavState.activeRouteAdminView.value = "agentAssignment";
  shellState.sideNavState.activeRouteView.value = "admin";
  shellState.sideNavState.hasAnyFeature.mockImplementation((featureIds: string[]) =>
    featureIds.some((featureId) => featureId === "agent-gateway" || featureId === "agent-exploration"),
  );
  shellState.sideNavState.hasFeature.mockImplementation((featureId: string) => featureId === "agent-gateway");
  shellState.sideNavState.openAdmin.mockReset();
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  resetAuthState();
  resetModuleState();
  resetSideNavState();
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountDrawer() {
  const wrapper = mount(ConsoleDrawer);
  mounted.push(wrapper);
  return wrapper;
}

function mountTopbar() {
  const wrapper = mount(ConsoleTopbar);
  mounted.push(wrapper);
  return wrapper;
}

function mountRuntimePanel() {
  const wrapper = mount(ConsoleRuntimeModulesPanel);
  mounted.push(wrapper);
  return wrapper;
}

function mountSideNavAgentSection() {
  const wrapper = mount(ConsoleSideNavAgentSection);
  mounted.push(wrapper);
  return wrapper;
}

describe("ConsoleDrawer", () => {
  it("renders the active tab, reacts to tab buttons, and closes from the backdrop", async () => {
    shellState.authState.drawerOpen.value = true;
    shellState.authState.drawerTab.value = "users";

    const wrapper = mountDrawer();

    expect(wrapper.get(".config-drawer").classes()).toContain("open");
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(true);
    expect(wrapper.find(".console-auth-users-panel-stub").exists()).toBe(true);
    expect(wrapper.get(".drawer-tab.active").text()).toBe("控制台用户");

    await wrapper.get(".drawer-backdrop").trigger("click");
    expect(shellState.authState.closeDrawer).toHaveBeenCalledTimes(1);

    const discoveryTab = wrapper
      .findAll(".drawer-tab")
      .find((button) => button.text() === "服务发现");
    expect(discoveryTab).toBeTruthy();
    await discoveryTab!.trigger("click");
    expect(shellState.authState.openDrawer).toHaveBeenCalledWith("discovery");
  });

  it("hides feature-gated tabs and panel content when the feature is unavailable", async () => {
    shellState.authState.hasFeature.mockImplementation((featureId: string) => featureId === "analysis-runtime");
    shellState.authState.drawerTab.value = "syncDirectories";

    const wrapper = mountDrawer();

    const tabTexts = wrapper.findAll(".drawer-tab").map((button) => button.text());
    expect(tabTexts).toEqual(["偏好设置", "服务发现", "控制台用户"]);
    expect(wrapper.find(".console-sync-directories-panel-stub").exists()).toBe(false);
  });

  it("stays hidden for unauthenticated users", () => {
    shellState.authState.isAuthenticated.value = false;

    const wrapper = mountDrawer();

    expect(wrapper.find("aside").exists()).toBe(false);
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(false);
  });
});

describe("ConsoleTopbar", () => {
  it("renders identity, toggles side nav, refreshes, and shows service state", async () => {
    shellState.authState.currentUser.value = { displayName: "Ada" };
    shellState.authState.serverAvailable = false;
    shellState.authState.serviceStatusLabel = "服务离线";
    shellState.authState.serviceUrl = "http://127.0.0.1:3000";

    const wrapper = mountTopbar();

    expect(wrapper.get(".topbar-page-title").text()).toBe("控制台概览");
    expect(wrapper.get(".identity-chip").text()).toBe("Ada");
    expect(wrapper.get(".service-url-badge").attributes("aria-label")).toBe("服务离线: http://127.0.0.1:3000");
    expect(wrapper.get(".service-url-badge").classes()).toContain("is-unavailable");
    expect(wrapper.get(".tool-button[aria-label='刷新页面']").attributes("title")).toBe("刷新当前页面");

    await wrapper.get(".topbar-sidebar-toggle").trigger("click");
    expect(shellState.authState.sideNavCollapsed.value).toBe(true);

    await wrapper.get(".tool-button[aria-label='刷新页面']").trigger("click");
    expect(shellState.authState.refreshCurrentPage).toHaveBeenCalledTimes(1);
  });

  it("does not render when unauthenticated", () => {
    shellState.authState.isAuthenticated.value = false;

    const wrapper = mountTopbar();

    expect(wrapper.get("header").classes()).toContain("is-disabled");
    expect(wrapper.get("header").attributes("aria-disabled")).toBe("true");
    expect(wrapper.get(".topbar-page-title").text()).toBe("登录");
  });
});

describe("ConsoleRuntimeModulesPanel", () => {
  it("renders module groups, active state, and forwards browse/edit actions", async () => {
    const wrapper = mountRuntimePanel();

    expect(wrapper.get(".panel-header h4").text()).toBe("模块管理");
    expect(wrapper.get(".panel-header p").text()).toContain("运行代次 7");
    expect(wrapper.get(".panel-header p").text()).toContain("可用 2/3");
    expect(wrapper.findAll(".module-panel")).toHaveLength(2);
    expect(wrapper.find(".drawer-mount-item[data-enabled='true']")).toBeTruthy();
    expect(wrapper.find(".drawer-mount-item[data-enabled='false']")).toBeTruthy();

    const firstInput = wrapper.find("input");
    expect(firstInput.element).toBeInstanceOf(HTMLInputElement);
    expect((firstInput.element as HTMLInputElement).disabled).toBe(false);
    expect((firstInput.element as HTMLInputElement).placeholder).toContain("analysis.mjs");
    expect(wrapper.find(".browse-select-button-stub").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".compact-action").text()).toBe("确认");

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect(shellState.moduleState.openMountPathPicker).toHaveBeenCalledWith("analysis");

    await wrapper.get(".compact-action").trigger("click");
    expect(shellState.moduleState.toggleMountPathEdit).toHaveBeenCalledWith(expect.objectContaining({ name: "analysis" }));
  });

  it("shows busy button labels and blocks interactions when loading", () => {
    shellState.moduleState.busyKey.value = "module-reload";
    shellState.moduleState.canBrowseServerPaths = false;

    const wrapper = mountRuntimePanel();

    expect(wrapper.get(".drawer-actions button").text()).toBe("重载中");
    expect(wrapper.get(".drawer-actions button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".drawer-actions button:nth-child(2)").text()).toBe("保存配置");
    expect(wrapper.findAll(".module-panel")).toHaveLength(2);
    expect(wrapper.get(".browse-select-button-stub").attributes("disabled")).toBeDefined();
  });
});

describe("ConsoleSideNavAgentSection", () => {
  it("renders the agent section, marks the active link, and emits admin navigation", async () => {
    const wrapper = mountSideNavAgentSection();

    expect(wrapper.get(".side-nav-section-title").text()).toBe("智能体");
    expect(wrapper.findAll(".side-nav-link-stub")).toHaveLength(3);
    expect(wrapper.get(".side-nav-link-stub.active").text()).toContain("智能体分配");

    await wrapper.get(".side-nav-link-stub").trigger("click");
    expect(shellState.sideNavState.openAdmin).toHaveBeenCalledWith("agentConfig");
  });

  it("stays hidden when no agent-related feature is enabled", () => {
    shellState.sideNavState.hasAnyFeature.mockReturnValue(false);

    const wrapper = mountSideNavAgentSection();

    expect(wrapper.find(".side-nav-section").exists()).toBe(false);
  });

  it("renders an empty section when the wrapper feature is on but gateway links are hidden", () => {
    shellState.sideNavState.hasAnyFeature.mockReturnValue(true);
    shellState.sideNavState.hasFeature.mockReturnValue(false);

    const wrapper = mountSideNavAgentSection();

    expect(wrapper.get(".side-nav-section-title").text()).toBe("智能体");
    expect(wrapper.findAll(".side-nav-link-stub")).toHaveLength(0);
  });
});
