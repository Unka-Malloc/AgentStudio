// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, ref } from "vue";
import ConsoleServiceDiscoveryPanel from "../../../server-web/components/shell/ConsoleServiceDiscoveryPanel.vue";
import ConsoleSideNavExternalServiceSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavExternalServiceSection.vue";
import ConsoleSideNavSkillHubSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavSkillHubSection.vue";
import ConsoleSideNavTeamSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavTeamSection.vue";
import SourcesActionBar from "../../../server-web/components/sources/SourcesActionBar.vue";
import SourcesGrid from "../../../server-web/components/sources/SourcesGrid.vue";
import WorkspaceDeleteAction from "../../../server-web/components/workspaces/WorkspaceDeleteAction.vue";
import WorkspaceCodespacePanel from "../../../server-web/components/workspaces/detail/WorkspaceCodespacePanel.vue";
import WorkspaceProfilePanel from "../../../server-web/components/workspaces/detail/WorkspaceProfilePanel.vue";

const shellContextMock = vi.hoisted(() => vi.fn());
const sideNavContextMock = vi.hoisted(() => vi.fn());
const sourcesContextMock = vi.hoisted(() => vi.fn());
const workspacesContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock
}));

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: sideNavContextMock
}));

vi.mock("../../../server-web/composables/sourcesViewContext", () => ({
  useSourcesViewContext: sourcesContextMock
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: workspacesContextMock
}));

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: ["modelValue", "options", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "option-bar-stub",
      type: "button",
      "data-label": String(props.label || ""),
      onClick: () => {
        const next = (props.options as Array<{ value: string }> | undefined)?.[1]?.value || "next";
        emit("update:model-value", next);
        emit("update:modelValue", next);
      }
    }, String(props.modelValue ?? ""));
  }
});

const ConsoleSideNavLinkStub = defineComponent({
  name: "ConsoleSideNavLink",
  props: ["active", "label"],
  emits: ["activate"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "side-nav-link-stub",
      type: "button",
      "data-active": String(props.active),
      onClick: () => emit("activate")
    }, String(props.label || ""));
  }
});

const SourceCardStub = defineComponent({
  name: "SourceCard",
  props: ["source"],
  setup(props) {
    return () => h("article", { class: "source-card-stub" }, String((props.source as any)?.label || ""));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("misc small component local extra coverage", () => {
  it("emits source actions and renders source grid empty/non-empty states", async () => {
    const action = mount(SourcesActionBar);
    await action.find("button").trigger("click");
    expect(action.emitted("add")).toHaveLength(1);

    sourcesContextMock.mockReturnValueOnce({
      activeKnowledgeSources: [{ sourceId: "source-1", label: "Source One" }]
    });
    const grid = mount(SourcesGrid, {
      global: { stubs: { SourceCard: SourceCardStub } }
    });
    expect(grid.text()).toContain("Source One");
    expect(grid.find(".is-empty").exists()).toBe(false);

    sourcesContextMock.mockReturnValueOnce({ activeKnowledgeSources: [] });
    const empty = mount(SourcesGrid, {
      global: { stubs: { SourceCard: SourceCardStub } }
    });
    expect(empty.text()).toContain("暂无本地数据源");
    expect(empty.find(".is-empty").exists()).toBe(true);
  });

  it("submits service discovery form and renders busy state", async () => {
    const saveDiscovery = vi.fn();
    const discoveryDraft = reactive({
      serverId: "server-1",
      serverLabel: "Pact",
      bootstrapBaseUrl: "https://bootstrap.example",
      advertisedBaseUrl: "https://pact.example",
      activeServiceUrl: "http://localhost:7228",
      forwardBaseUrl: "",
      mode: "standalone",
      configVersion: 1,
      refreshIntervalSeconds: 30,
      checkInIntervalSeconds: 60,
      offlineAfterSeconds: 180
    });
    const msg = {
      drawer: {
        serviceDiscovery: "Discovery",
        serviceId: "Service ID",
        serviceLabel: "Label",
        bootstrapUrl: "Bootstrap",
        advertisedUrl: "Advertised",
        activeUrl: "Active",
        forwardUrl: "Forward",
        mode: "Mode",
        configVersion: "Version",
        refreshSeconds: "Refresh",
        checkInSeconds: "Check in",
        offlineSeconds: "Offline",
        saving: "Saving",
        saveDiscovery: "Save discovery"
      }
    };
    shellContextMock.mockReturnValue({
      busyKey: "discovery",
      discoveryDraft,
      discoveryModeOptionBarOptions: [{ value: "standalone" }, { value: "mesh" }],
      msg,
      saveDiscovery
    });
    const wrapper = mount(ConsoleServiceDiscoveryPanel, {
      global: { stubs: { OptionBar: OptionBarStub } }
    });
    expect(wrapper.text()).toContain("Discovery");
    expect(wrapper.find("button.tool-button").attributes("disabled")).toBeDefined();
    await wrapper.find("form").trigger("submit");
    expect(saveDiscovery).toHaveBeenCalledTimes(1);
  });

  it("routes side-nav section activations and feature visibility", async () => {
    const openAdmin = vi.fn();
    const openExternalServiceTab = vi.fn();
    const switchView = vi.fn();
    const msg = {
      nav: {
        externalServices: "External services",
        devices: "Devices",
        skillHub: "Skill hub",
        toolList: "Tools",
        toolStats: "Stats",
        teamPanel: "Team",
        workspaces: "Workspaces"
      }
    };
    sideNavContextMock.mockReturnValue({
      activeRouteAdminView: "clients",
      activeRouteExternalServiceTab: "list",
      activeRouteView: "externalServices",
      hasFeature: vi.fn(() => true),
      localizedExternalServiceTabLabel: vi.fn((tab) => `tab:${tab.id}`),
      msg,
      openAdmin,
      openExternalServiceTab,
      switchView
    });
    const external = mount(ConsoleSideNavExternalServiceSection, {
      global: { stubs: { ConsoleSideNavLink: ConsoleSideNavLinkStub } }
    });
    await external.findAll(".side-nav-link-stub")[0].trigger("click");
    await external.findAll(".side-nav-link-stub").at(-1)!.trigger("click");
    expect(openExternalServiceTab).toHaveBeenCalled();
    expect(openAdmin).toHaveBeenCalledWith("clients");

    const skillHub = mount(ConsoleSideNavSkillHubSection, {
      global: { stubs: { ConsoleSideNavLink: ConsoleSideNavLinkStub } }
    });
    await skillHub.findAll(".side-nav-link-stub")[0].trigger("click");
    await skillHub.findAll(".side-nav-link-stub")[1].trigger("click");
    expect(openAdmin).toHaveBeenCalledWith("toolList");
    expect(openAdmin).toHaveBeenCalledWith("toolStats");

    const team = mount(ConsoleSideNavTeamSection, {
      global: { stubs: { ConsoleSideNavLink: ConsoleSideNavLinkStub } }
    });
    await team.find(".side-nav-link-stub").trigger("click");
    expect(switchView).toHaveBeenCalledWith("workspaces");

    sideNavContextMock.mockReturnValueOnce({
      activeRouteAdminView: "",
      activeRouteView: "admin",
      hasFeature: vi.fn(() => false),
      msg,
      openAdmin
    });
    const hidden = mount(ConsoleSideNavSkillHubSection, {
      global: { stubs: { ConsoleSideNavLink: ConsoleSideNavLinkStub } }
    });
    expect(hidden.find(".side-nav-section").exists()).toBe(false);
  });

  it("drives workspace profile, codespace, and delete actions", async () => {
    const hotSwapProfile = vi.fn();
    const inspectCodespaceStatus = vi.fn();
    const prepareCodespaceChange = vi.fn();
    const uploadCodespaceChange = vi.fn();
    const panel = ref("profile");
    const showDeleteModal = ref(false);
    const profileForm = reactive({
      contextProfileId: "balanced",
      toolGrantId: "grant-a",
      modelAlias: "agent-a",
      ownedSourceIds: "source-a",
      includeSourceIds: "source-b",
      excludeSourceIds: "source-c"
    });
    const codespaceForm = reactive({
      provider: "github",
      repoId: "/repo",
      repositoryRef: "owner/repo",
      branch: "main",
      baseRef: "base",
      headRef: "head",
      diff: "diff --git"
    });
    const workspaceContext = {
      busyKey: "",
      codespaceForm,
      codespaceResult: { ok: true },
      hotSwapProfile,
      inspectCodespaceStatus,
      panel,
      prepareCodespaceChange,
      profileForm,
      selected: { title: "Workspace A" },
      showDeleteModal,
      uploadCodespaceChange
    };
    workspacesContextMock.mockReturnValue(workspaceContext);

    const profile = mount(WorkspaceProfilePanel);
    expect(profile.text()).toContain("Workspace A");
    await profile.findAll("button")[0].trigger("click");
    await profile.findAll("button")[1].trigger("click");
    expect(hotSwapProfile).toHaveBeenCalledTimes(1);
    expect(panel.value).toBe("list");

    const codespace = mount(WorkspaceCodespacePanel, {
      global: { stubs: { OptionBar: OptionBarStub } }
    });
    expect(codespace.findAll("input").some((input) => input.element.value === "owner/repo")).toBe(true);
    const buttons = codespace.findAll("button.tool-button");
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await buttons[2].trigger("click");
    await buttons[3].trigger("click");
    expect(inspectCodespaceStatus).toHaveBeenCalledTimes(1);
    expect(prepareCodespaceChange).toHaveBeenCalledTimes(1);
    expect(uploadCodespaceChange).toHaveBeenCalledTimes(1);
    expect(panel.value).toBe("list");

    const deleteAction = mount(WorkspaceDeleteAction);
    await deleteAction.find("button").trigger("click");
    expect(showDeleteModal.value).toBe(true);
  });
});
