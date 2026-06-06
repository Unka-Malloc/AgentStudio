// @vitest-environment jsdom
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConsoleServiceDiscoveryPanel from "../../../server-web/components/shell/ConsoleServiceDiscoveryPanel.vue";
import ConsoleSideNavPrimaryLinks from "../../../server-web/components/shell/side-nav/ConsoleSideNavPrimaryLinks.vue";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";
import { useWorkspacesConsole } from "../../../server-web/composables/useWorkspacesConsole";

const serverShellContextMock = vi.hoisted(() => ({
  current: null as any,
}));

const sideNavContextMock = vi.hoisted(() => ({
  current: null as any,
}));

const feedContextMock = vi.hoisted(() => ({
  current: null as any,
}));

const workspacesViewContextMock = vi.hoisted(() => ({
  current: null as any,
}));

const pageRefreshMock = vi.hoisted(() => ({
  handler: null as null | ((detail: { viewId?: string }) => Promise<void> | void),
  filter: null as null | ((detail: { viewId?: string }) => boolean),
}));

const workspacesClientMock = vi.hoisted(() => ({
  applyWorkspaceCloudDriveSync: vi.fn(),
  connectWorkspaceCloudDrive: vi.fn(),
  connectWorkspaceLocalDirectory: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  downloadWorkspaceCloudDriveFile: vi.fn(),
  forkWorkspaceSession: vi.fn(),
  getWorkspaceChainBundle: vi.fn(),
  getWorkspaceCheckpointTree: vi.fn(),
  getWorkspaceCloudDriveStatus: vi.fn(),
  getWorkspaceSessionBundle: vi.fn(),
  listWorkspaceCheckpointTrees: vi.fn(),
  listWorkspaceCloudDriveItems: vi.fn(),
  listWorkspaceCloudDrivePermissions: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  listWorkspaceSummaries: vi.fn(),
  planWorkspaceCloudDriveSync: vi.fn(),
  previewWorkspaceCheckpointRestoreRequest: vi.fn(),
  restoreWorkspaceCheckpointRequest: vi.fn(),
  setWorkspaceParent: vi.fn(),
  setWorkspaceSources: vi.fn(),
  syncWorkspaceLocalDirectory: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  updateWorkspaceShare: vi.fn(),
  uploadWorkspaceCloudDriveFile: vi.fn(),
  prepareCodespaceChangeRequest: vi.fn(),
  uploadCodespaceChangeRequest: vi.fn(),
  inspectCodespaceRepositoryStatus: vi.fn(),
  getCodespaceProvidersManifest: vi.fn(),
}));

const cloudDriveControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const checkpointControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const localDirectoryControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const codespaceControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const managementControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const sessionControllerMock = vi.hoisted(() => ({
  options: null as any,
  state: null as any,
}));

const pageRefreshHandlerMock = vi.hoisted(() =>
  vi.fn((filter: (detail: { viewId?: string }) => boolean, handler: (detail: { viewId?: string }) => Promise<void> | void) => {
    pageRefreshMock.filter = filter;
    pageRefreshMock.handler = handler;
  }),
);

const confirmConsoleActionMock = vi.hoisted(() => vi.fn(() => true));
const copyConsoleTextWithFeedbackMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => serverShellContextMock.current,
}));

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: () => sideNavContextMock.current,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => workspacesViewContextMock.current,
}));

vi.mock("../../../server-web/lib/workspaces-client", () => ({
  applyWorkspaceCloudDriveSync: workspacesClientMock.applyWorkspaceCloudDriveSync,
  connectWorkspaceCloudDrive: workspacesClientMock.connectWorkspaceCloudDrive,
  connectWorkspaceLocalDirectory: workspacesClientMock.connectWorkspaceLocalDirectory,
  createWorkspace: workspacesClientMock.createWorkspace,
  deleteWorkspace: workspacesClientMock.deleteWorkspace,
  downloadWorkspaceCloudDriveFile: workspacesClientMock.downloadWorkspaceCloudDriveFile,
  forkWorkspaceSession: workspacesClientMock.forkWorkspaceSession,
  getCodespaceProvidersManifest: workspacesClientMock.getCodespaceProvidersManifest,
  getWorkspaceChainBundle: workspacesClientMock.getWorkspaceChainBundle,
  getWorkspaceCheckpointTree: workspacesClientMock.getWorkspaceCheckpointTree,
  getWorkspaceCloudDriveStatus: workspacesClientMock.getWorkspaceCloudDriveStatus,
  getWorkspaceSessionBundle: workspacesClientMock.getWorkspaceSessionBundle,
  inspectCodespaceRepositoryStatus: workspacesClientMock.inspectCodespaceRepositoryStatus,
  listWorkspaceCheckpointTrees: workspacesClientMock.listWorkspaceCheckpointTrees,
  listWorkspaceCloudDriveItems: workspacesClientMock.listWorkspaceCloudDriveItems,
  listWorkspaceCloudDrivePermissions: workspacesClientMock.listWorkspaceCloudDrivePermissions,
  listWorkspaceSessions: workspacesClientMock.listWorkspaceSessions,
  listWorkspaceSummaries: workspacesClientMock.listWorkspaceSummaries,
  planWorkspaceCloudDriveSync: workspacesClientMock.planWorkspaceCloudDriveSync,
  prepareCodespaceChangeRequest: workspacesClientMock.prepareCodespaceChangeRequest,
  previewWorkspaceCheckpointRestoreRequest: workspacesClientMock.previewWorkspaceCheckpointRestoreRequest,
  restoreWorkspaceCheckpointRequest: workspacesClientMock.restoreWorkspaceCheckpointRequest,
  setWorkspaceParent: workspacesClientMock.setWorkspaceParent,
  setWorkspaceSources: workspacesClientMock.setWorkspaceSources,
  syncWorkspaceLocalDirectory: workspacesClientMock.syncWorkspaceLocalDirectory,
  updateWorkspaceProfile: workspacesClientMock.updateWorkspaceProfile,
  updateWorkspaceShare: workspacesClientMock.updateWorkspaceShare,
  uploadCodespaceChangeRequest: workspacesClientMock.uploadCodespaceChangeRequest,
  uploadWorkspaceCloudDriveFile: workspacesClientMock.uploadWorkspaceCloudDriveFile,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: confirmConsoleActionMock,
  copyConsoleTextWithFeedback: copyConsoleTextWithFeedbackMock,
}));

vi.mock("../../../server-web/composables/console-workspace-cloud-drive-controller", () => ({
  useWorkspaceCloudDriveController: (options: any) => {
    cloudDriveControllerMock.options = options;
    const cloudDriveData = ref<any>(null);
    const cloudDriveResult = ref<any>(null);
    const cloudDriveForm = reactive({
      provider: "onedrive",
      rootPath: "",
      driveRef: "",
      clientId: "owner",
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: "owner, codex",
      advancedMode: false,
      exposedDirectories: [] as Array<Record<string, unknown>>,
      path: "",
      uploadPath: "",
      uploadContent: "Pact cloud drive console upload\n",
      targetPath: "cloud-drive",
    });
    const state = {
      addCloudDriveExposure: vi.fn(() => {
        cloudDriveForm.exposedDirectories.push({
          id: `item-${cloudDriveForm.exposedDirectories.length + 1}`,
          name: "",
          path: "",
          permissionMode: "all",
          subjects: "",
          showPermissions: false,
        });
      }),
      applyCloudDriveSync: vi.fn(),
      cloudDriveConnectionOptions: computed(() => {
        const connections = Array.isArray(cloudDriveData.value?.connections) ? cloudDriveData.value.connections : [];
        return connections.map((drive: any) => ({ value: drive.driveRef, label: drive.label || drive.driveRef }));
      }),
      cloudDriveData,
      cloudDriveForm,
      cloudDriveResult,
      cloudDriveAllowedClients: ref(""),
      connectCloudDrive: vi.fn(() => {
        options.setBusy("ws:drive-connect");
      }),
      downloadCloudDriveFile: vi.fn(),
      listCloudDriveItems: vi.fn(),
      listCloudDrivePermissions: vi.fn(),
      openCloudDrive: vi.fn(() => "cloudDrive"),
      planCloudDriveSync: vi.fn(),
      refreshCloudDriveStatus: vi.fn(() => {
        options.clearBusy();
      }),
      removeCloudDriveExposure: vi.fn((index: number) => {
        cloudDriveForm.exposedDirectories.splice(index, 1);
      }),
      uploadCloudDriveFile: vi.fn(),
    };
    cloudDriveControllerMock.state = state;
    return state;
  },
}));

vi.mock("../../../server-web/composables/console-workspace-checkpoint-controller", () => ({
  useWorkspaceCheckpointController: (options: any) => {
    checkpointControllerMock.options = options;
    const state = {
      checkpointNodeBasePath: ref(""),
      checkpointNodeFileCount: ref(0),
      loadWorkspaceCheckpointTree: vi.fn(),
      loadWorkspaceCheckpoints: vi.fn(),
      previewWorkspaceCheckpointRestore: vi.fn(),
      resetWorkspaceCheckpoints: vi.fn(),
      restoreWorkspaceCheckpoint: vi.fn(),
      selectedCheckpointNodeId: ref(""),
      selectedCheckpointTreeId: ref(""),
      workspaceCheckpointDetail: ref(null),
      workspaceCheckpointError: ref(""),
      workspaceCheckpointNodes: ref([]),
      workspaceCheckpointPreview: ref(null),
      workspaceCheckpointPreviewRestore: ref(null),
      workspaceCheckpointTrees: ref([]),
    };
    checkpointControllerMock.state = state;
    return state;
  },
}));

vi.mock("../../../server-web/composables/console-workspace-local-directory-controller", () => ({
  useWorkspaceLocalDirectoryController: (options: any) => {
    localDirectoryControllerMock.options = options;
    const state = {
      connectLocalDirectory: vi.fn(),
      localDirForm: reactive({ path: "" }),
      localDirMountData: ref(null),
      openLocalDir: vi.fn(() => "localDir"),
      resetLocalDirectoryState: vi.fn(),
      setLocalDirectoryMountData: vi.fn(),
      showListPanel: options.showListPanel,
      syncLocalDirectory: vi.fn(),
    };
    localDirectoryControllerMock.state = state;
    return state;
  },
}));

vi.mock("../../../server-web/composables/console-workspace-codespace-controller", () => ({
  useWorkspaceCodespaceController: (options: any) => {
    codespaceControllerMock.options = options;
    const state = {
      codespaceData: ref(null),
      codespaceForm: reactive({}),
      codespaceResult: ref(null),
      inspectCodespaceStatus: vi.fn(),
      openCodespace: vi.fn(() => "codespace"),
      prepareCodespaceChange: vi.fn(),
      resetCodespaceState: vi.fn(),
      setCodespaceData: vi.fn(),
      uploadCodespaceChange: vi.fn(),
    };
    codespaceControllerMock.state = state;
    return state;
  },
}));

vi.mock("../../../server-web/composables/console-workspace-management-controller", () => ({
  useWorkspaceManagementController: (options: any) => {
    managementControllerMock.options = options;
    const state = {
      createForm: reactive({ title: "", objective: "", parentWorkspaceId: "" }),
      createWorkspace: vi.fn(),
      deleteFolderChecked: ref(false),
      deleteWorkspace: vi.fn(),
      hotSwapProfile: vi.fn(),
      openParent: vi.fn(() => {
        options.panel.value = "parent";
        return "parent";
      }),
      openProfile: vi.fn(() => {
        options.panel.value = "profile";
        return "profile";
      }),
      parentForm: reactive({ parentWorkspaceId: "" }),
      profileForm: reactive({ contextProfileId: "", toolGrantId: "", modelAlias: "" }),
      setParent: vi.fn(),
      shareForm: reactive({}),
      shareOrUnshare: vi.fn(),
      showDeleteModal: ref(false),
    };
    managementControllerMock.state = state;
    return state;
  },
}));

vi.mock("../../../server-web/composables/console-workspace-session-controller", () => ({
  useWorkspaceSessionController: (options: any) => {
    sessionControllerMock.options = options;
    const state = {
      forkSession: vi.fn(),
      r: options.reloadWorkspaceList,
      selectSession: vi.fn(),
      selectedSession: ref(null),
      selectedSessionId: ref(""),
      sessionContextData: ref(null),
      sessionItems: ref([]),
    };
    sessionControllerMock.state = state;
    return state;
  },
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
            class: "side-nav-link-stub",
            "data-active": String(Boolean(props.active)),
            "data-subtle": String(Boolean(props.subtle)),
            type: "button",
            onClick: () => emit("activate"),
          },
          [slots.icon?.(), h("span", { class: "side-nav-link-label" }, props.label || "")],
        );
    },
  }),
}));

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: {
    buttonClass: String,
    buttonText: String,
    kind: String,
    multiple: Boolean,
  },
  emits: ["select"],
  setup(props, { emit, slots }) {
    return () =>
      h(
        "button",
        {
          class: ["browse-select-button-stub", props.buttonClass || ""],
          type: "button",
          onClick: () => emit("select", [new File(["attachment"], "attachment.txt", { type: "text/plain" })]),
        },
        [slots.default?.()],
      );
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    includeEmpty: Boolean,
    label: String,
    modelValue: String,
    options: {
      type: Array,
      default: () => [],
    },
    placeholder: String,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "agent-model-option-bar-stub" }, [
        h(
          "select",
          {
            value: props.modelValue || "",
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          (props.options as Array<{ label?: string; value?: string }>).map((option) =>
            h("option", { value: String(option.value ?? option.label ?? "") }, String(option.label ?? "")),
          ),
        ),
      ]);
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    label: String,
    modelValue: [String, Number, Boolean],
    options: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "option-bar-stub" }, [
        props.label ? h("span", { class: "option-bar-label" }, props.label) : null,
        h(
          "select",
          {
            value: props.modelValue == null ? "" : String(props.modelValue),
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          (props.options as Array<{ label?: string; value?: string | number | boolean }>).map((option) =>
            h("option", { value: String(option.value) }, String(option.label ?? "")),
          ),
        ),
      ]);
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: String,
    open: Boolean,
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub", "data-open": String(Boolean(props.open)) }, [
        h("h4", { class: "config-fold-card-title" }, props.title || ""),
        slots.default?.(),
      ]);
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: Boolean,
    label: String,
    disabled: Boolean,
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "binary-checkbox-stub",
          type: "button",
          disabled: !!props.disabled,
          "data-checked": String(Boolean(props.modelValue)),
          onClick: () => {
            if (props.disabled) {
              return;
            }
            const nextValue = !props.modelValue;
            emit("update:modelValue", nextValue);
            emit("update:model-value", nextValue);
            emit("change", nextValue);
          },
        },
        props.label || "",
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: String,
    label: String,
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

function mountComposable<T>(factory: () => T) {
  let exposed!: T;
  mount(
    defineComponent({
      setup() {
        exposed = factory();
        return () => null;
      },
    }),
  );
  return exposed;
}

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function resetSharedMocks() {
  serverShellContextMock.current = null;
  sideNavContextMock.current = null;
  feedContextMock.current = null;
  workspacesViewContextMock.current = null;
  pageRefreshMock.filter = null;
  pageRefreshMock.handler = null;
  cloudDriveControllerMock.options = null;
  cloudDriveControllerMock.state = null;
  checkpointControllerMock.options = null;
  checkpointControllerMock.state = null;
  localDirectoryControllerMock.options = null;
  localDirectoryControllerMock.state = null;
  codespaceControllerMock.options = null;
  codespaceControllerMock.state = null;
  managementControllerMock.options = null;
  managementControllerMock.state = null;
  sessionControllerMock.options = null;
  sessionControllerMock.state = null;
  confirmConsoleActionMock.mockReset();
  confirmConsoleActionMock.mockReturnValue(true);
  copyConsoleTextWithFeedbackMock.mockReset();
  pageRefreshHandlerMock.mockClear();
  workspacesClientMock.listWorkspaceSummaries.mockReset();
  workspacesClientMock.listWorkspaceSessions.mockReset();
  workspacesClientMock.getWorkspaceChainBundle.mockReset();
  workspacesClientMock.listWorkspaceCheckpointTrees.mockReset();
  workspacesClientMock.getWorkspaceCheckpointTree.mockReset();
  workspacesClientMock.listWorkspaceCloudDriveItems.mockReset();
  workspacesClientMock.listWorkspaceCloudDrivePermissions.mockReset();
  workspacesClientMock.connectWorkspaceCloudDrive.mockReset();
  workspacesClientMock.downloadWorkspaceCloudDriveFile.mockReset();
  workspacesClientMock.uploadWorkspaceCloudDriveFile.mockReset();
  workspacesClientMock.planWorkspaceCloudDriveSync.mockReset();
  workspacesClientMock.applyWorkspaceCloudDriveSync.mockReset();
  workspacesClientMock.createWorkspace.mockReset();
  workspacesClientMock.deleteWorkspace.mockReset();
  workspacesClientMock.setWorkspaceParent.mockReset();
  workspacesClientMock.setWorkspaceSources.mockReset();
  workspacesClientMock.updateWorkspaceProfile.mockReset();
  workspacesClientMock.updateWorkspaceShare.mockReset();
  workspacesClientMock.forkWorkspaceSession.mockReset();
  vi.restoreAllMocks();
}

beforeEach(() => {
  resetSharedMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ConsoleServiceDiscoveryPanel", () => {
  it("binds draft fields, updates mode, and flips the save state when busy", async () => {
    const discoveryDraft = reactive({
      activeServiceUrl: "",
      advertisedBaseUrl: "",
      bootstrapBaseUrl: "",
      checkInIntervalSeconds: 10,
      configVersion: "v1",
      forwardBaseUrl: "",
      mode: "passive",
      offlineAfterSeconds: 60,
      refreshIntervalSeconds: 10,
      serverId: "",
      serverLabel: "",
    });
    const busyKey = ref("");
    const saveDiscovery = vi.fn();

    serverShellContextMock.current = {
      busyKey,
      discoveryDraft,
      discoveryModeOptionBarOptions: ref([
        { label: "Passive", value: "passive" },
        { label: "Active", value: "active" },
      ]),
      msg: {
        drawer: {
          activeUrl: "Active",
          advertisedUrl: "Advertised",
          bootstrapUrl: "Bootstrap",
          checkInSeconds: "Check in",
          configVersion: "Config version",
          forwardUrl: "Forward",
          mode: "Mode",
          offlineSeconds: "Offline",
          refreshSeconds: "Refresh",
          saveDiscovery: "Save discovery",
          saving: "Saving",
          serviceDiscovery: "Service discovery",
          serviceId: "Service id",
          serviceLabel: "Service label",
        },
      },
      saveDiscovery,
    };

    const wrapper = mount(ConsoleServiceDiscoveryPanel, {
      global: {
        stubs: {
          OptionBar: OptionBarStub,
        },
      },
    });

    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("srv-1");
    await inputs[1].setValue("Demo service");
    await inputs[2].setValue("https://bootstrap.example");
    await inputs[7].setValue("45");

    await wrapper.get(".option-bar-stub select").setValue("active");
    expect(discoveryDraft.serverId).toBe("srv-1");
    expect(discoveryDraft.serverLabel).toBe("Demo service");
    expect(discoveryDraft.bootstrapBaseUrl).toBe("https://bootstrap.example");
    expect(discoveryDraft.refreshIntervalSeconds).toBe(45);
    expect(discoveryDraft.mode).toBe("active");

    await wrapper.get("form").trigger("submit");
    expect(saveDiscovery).toHaveBeenCalledTimes(1);
    expect(wrapper.get("button.tool-button").text()).toBe("Save discovery");
    expect(wrapper.get("button.tool-button").attributes("disabled")).toBeUndefined();

    busyKey.value = "discovery";
    await nextTick();
    expect(wrapper.get("button.tool-button").text()).toBe("Saving");
    expect(wrapper.get("button.tool-button").attributes("disabled")).toBeDefined();
  });
});

describe("ConsoleSideNavPrimaryLinks", () => {
  it("routes each primary link to the expected callback and marks the active admin item", async () => {
    const switchView = vi.fn();
    const openAdmin = vi.fn();

    sideNavContextMock.current = {
      activeRouteAdminView: ref("agentPermissions"),
      activeRouteView: ref("admin"),
      msg: {
        nav: {
          approvalFlow: "Approval",
          dashboard: "Dashboard",
          feed: "Feed",
          permissionGroups: "Permissions",
          sources: "Sources",
        },
      },
      openAdmin,
      switchView,
    };

    const wrapper = mount(ConsoleSideNavPrimaryLinks);
    const links = wrapper.findAll(".side-nav-link-stub");

    expect(links).toHaveLength(5);
    expect(links[0].attributes("data-active")).toBe("false");
    expect(links[3].attributes("data-active")).toBe("true");

    await links[0].trigger("click");
    await links[1].trigger("click");
    await links[2].trigger("click");
    await links[3].trigger("click");
    await links[4].trigger("click");

    expect(switchView).toHaveBeenNthCalledWith(1, "dashboard");
    expect(switchView).toHaveBeenNthCalledWith(2, "feed");
    expect(switchView).toHaveBeenNthCalledWith(3, "approval");
    expect(switchView).toHaveBeenNthCalledWith(4, "sources");
    expect(openAdmin).toHaveBeenCalledWith("agentPermissions");
  });
});

describe("InfoFeedComposerPanel", () => {
  function makeFeedContext(overrides: Record<string, unknown> = {}) {
    return {
      agentSelectorOptions: ref([
        { label: "GPT-5.4", value: "gpt-5.4" },
        { label: "GPT-5.4-mini", value: "gpt-5.4-mini" },
      ]),
      busyKey: ref(""),
      contextWindowOptionBarOptions: ref([
        { label: "32k", value: "32k" },
        { label: "64k", value: "64k" },
      ]),
      handleInfoFeedAttachmentFiles: vi.fn(),
      infoFeedAttachments: ref([]),
      infoFeedCurrentRun: ref({
        summary: { status: "running" },
      }),
      infoFeedForm: ref({
        contextProfileId: "32k",
        maxTokens: 4096,
        modelAlias: "",
        query: "问题",
        temperature: 0.2,
      }),
      infoFeedInputPlaceholder: ref("输入问题"),
      infoFeedModelOptions: ref([
        { label: "GPT-5.4", value: "gpt-5.4" },
        { label: "GPT-5.4-mini", value: "gpt-5.4-mini" },
      ]),
      infoFeedSubmitLabel: ref("开始信息流"),
      removeInfoFeedAttachment: vi.fn(),
      runInfoFeed: vi.fn(),
      saveSettings: vi.fn(),
      selectedInfoFeedModel: ref({ enabled: true, label: "GPT-5.4" }),
      settingsDraft: ref({
        agentExploreDefaults: {
          answerTemplate: "默认答案模板",
          contextProfileId: "32k",
          continuationPrompt: "继续",
          limit: 5,
          maxIterations: 3,
          maxTokens: 4096,
          reviewFusionMaxTokens: 1024,
          reviewFusionModelAlias: "",
          reviewFusionSystemPrompt: "融合提示词",
          reviewFusionTemperature: 0.1,
          systemPrompt: "系统提示词",
          temperature: 0.2,
          thinkingMode: "balanced",
          toolChoice: "auto",
          toolPolicyPrompt: "工具策略提示词",
        },
      }),
      thinkingModeOptionBarOptions: ref([
        { label: "Balanced", value: "balanced" },
        { label: "Deep", value: "deep" },
      ]),
      ...overrides,
    };
  }

  it("keeps the empty attachment state, updates model selection, and saves advanced settings", async () => {
    feedContextMock.current = makeFeedContext();

    const wrapper = mount(InfoFeedComposerPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          BrowseSelectButton: BrowseSelectButtonStub,
          ConfigFoldCard: ConfigFoldCardStub,
          OptionBar: OptionBarStub,
        },
      },
    });

    expect(wrapper.find(".info-feed-attachment-chip").exists()).toBe(false);
    expect(wrapper.get(".primary-action").element.disabled).toBe(true);

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect(feedContextMock.current.handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);

    await wrapper.get(".agent-model-option-bar-stub select").setValue("gpt-5.4-mini");
    expect(feedContextMock.current.infoFeedForm.value.modelAlias).toBe("gpt-5.4-mini");

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.get("form.info-feed-advanced-form").trigger("submit");
    expect(feedContextMock.current.saveSettings).toHaveBeenCalledTimes(1);

    feedContextMock.current.busyKey.value = "settings";
    await nextTick();
    expect(wrapper.get("form.info-feed-advanced-form button[type='submit']").text()).toBe("保存中");
    expect(wrapper.get("form.info-feed-advanced-form button[type='submit']").attributes("disabled")).toBeDefined();
  });
});

describe("WorkspaceCloudDrivePanel", () => {
  function makeWorkspaceContext(overrides: Record<string, unknown> = {}) {
    return {
      addCloudDriveExposure: vi.fn(),
      applyCloudDriveSync: vi.fn(),
      busyKey: ref(""),
      cloudDriveConnectionOptions: computed(() => []),
      cloudDriveData: ref(null),
      cloudDriveForm: reactive({
        allowedClients: "owner, codex",
        advancedMode: false,
        clientId: "owner",
        driveRef: "",
        exposedDirectories: [] as Array<Record<string, unknown>>,
        managedFolderRoot: ".pact-data",
        ప: "",
        path: "",
        provider: "onedrive",
        publicFolder: "public",
        rootPath: "",
        targetPath: "cloud-drive",
        uploadContent: "Pact cloud drive console upload\n",
        uploadPath: "",
      }),
      cloudDriveResult: ref(null),
      connectCloudDrive: vi.fn(),
      downloadCloudDriveFile: vi.fn(),
      listCloudDriveItems: vi.fn(),
      listCloudDrivePermissions: vi.fn(),
      panel: ref("cloudDrive"),
      planCloudDriveSync: vi.fn(),
      removeCloudDriveExposure: vi.fn(),
      selected: ref({ title: "主工作区" }),
      uploadCloudDriveFile: vi.fn(),
      ...overrides,
    };
  }

  it("shows the empty advanced state, surfaces results, and wires the main actions", async () => {
    const context = makeWorkspaceContext({
      cloudDriveForm: reactive({
        allowedClients: "owner, codex",
        advancedMode: false,
        clientId: "owner",
        driveRef: "",
        exposedDirectories: [],
        managedFolderRoot: ".pact-data",
        path: "",
        provider: "google-drive",
        publicFolder: "public",
        rootPath: "",
        targetPath: "cloud-drive",
        uploadContent: "Pact cloud drive console upload\n",
        uploadPath: "",
      }),
      cloudDriveResult: ref({ action: "seed" }),
    });
    workspacesViewContextMock.current = context;

    const wrapper = mount(WorkspaceCloudDrivePanel, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          OptionBar: OptionBarStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).not.toContain("iCloud 受控目录");
    expect(wrapper.find(".muted-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("\"action\": \"seed\"");

    await wrapper.get(".binary-checkbox-stub").trigger("click");
    await nextTick();
    expect(context.cloudDriveForm.advancedMode).toBe(true);
    expect(wrapper.text()).toContain("暂无目录。");

    const buttons = wrapper.findAll("button");
    expect(buttons.find((button) => button.text() === "下载")?.attributes("disabled")).toBeDefined();
    expect(buttons.find((button) => button.text() === "上传")?.attributes("disabled")).toBeDefined();

    await buttons.find((button) => button.text() === "连接")?.trigger("click");
    await buttons.find((button) => button.text() === "取消")?.trigger("click");
    expect(context.connectCloudDrive).toHaveBeenCalledTimes(1);
    expect(context.panel.value).toBe("list");
  });

  it("renders iCloud and permission branches for advanced exposure rows", async () => {
    const context = makeWorkspaceContext({
      cloudDriveForm: reactive({
        allowedClients: "owner, codex",
        advancedMode: true,
        clientId: "owner",
        driveRef: "",
        exposedDirectories: [
          {
            id: "dir-1",
            name: "",
            path: "/public",
            permissionMode: "all",
            showPermissions: false,
            subjects: "",
          },
          {
            id: "dir-2",
            name: "Docs",
            path: "/docs",
            permissionMode: "allowlist",
            showPermissions: true,
            subjects: "client-a",
          },
        ],
        managedFolderRoot: ".pact-data",
        path: "public/example.txt",
        provider: "icloud",
        publicFolder: "public",
        rootPath: "/Users/example/Library/Mobile Documents/com~apple~CloudDocs",
        targetPath: "cloud-drive",
        uploadContent: "Pact cloud drive console upload\n",
        uploadPath: "public/upload.txt",
      }),
      cloudDriveData: ref({
        connections: [
          {
            contractVerified: false,
            directoryMappingCount: 1,
            driveRef: "drive-1",
            mode: "sync",
            provider: "iCloud",
          },
        ],
      }),
    });
    workspacesViewContextMock.current = context;

    const wrapper = mount(WorkspaceCloudDrivePanel, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          OptionBar: OptionBarStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("iCloud 受控目录");
    expect(wrapper.text()).toContain("目录 1");
    expect(wrapper.text()).toContain("Docs");
    expect(wrapper.findAll("input").some((input) => input.element.value === "client-a")).toBe(true);
    expect(wrapper.text()).toContain("localAdapterVerified");

    await wrapper.findAll("button").find((button) => button.text() === "移除")?.trigger("click");
    expect(context.removeCloudDriveExposure).toHaveBeenCalledWith(0);
  });
});

describe("useWorkspacesConsole", () => {
  function mountWorkspacesConsole() {
    let exposed!: ReturnType<typeof useWorkspacesConsole>;
    mount(
      defineComponent({
        setup() {
          exposed = useWorkspacesConsole();
          return () => null;
        },
      }),
    );
    return exposed;
  }

  it("tracks expansion, page refresh, panel routing, and clipboard branches", async () => {
    workspacesClientMock.listWorkspaceSummaries.mockResolvedValueOnce({
      workspaces: [
        { workspaceId: "workspace-0001", title: "", status: "active" },
        { workspaceId: "ws-2", title: "Beta", status: "archived" },
      ],
    });
    workspacesClientMock.listWorkspaceSessions.mockResolvedValueOnce({ sessions: [] });
    workspacesClientMock.getWorkspaceChainBundle.mockResolvedValue({
      chain: { id: "chain-1" },
      context: { id: "context-1" },
      files: { id: "files-1" },
      localDirs: { id: "local-dirs-1" },
      cloudDrives: { id: "cloud-drives-1" },
      codespace: { id: "codespace-1" },
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serverShellContextMock.current = {
      busyKey: ref("global-busy"),
    };

    const workspacesConsole = mountWorkspacesConsole();
    await flushPromises();

    expect(pageRefreshMock.filter?.({ viewId: "workspaces" })).toBe(true);
    expect(pageRefreshMock.filter?.({ viewId: "dashboard" })).toBe(false);
    expect(workspacesConsole.busyKey.value).toBe("global-busy");
    expect(workspacesConsole.workspaceOptions.value).toEqual([
      { value: "workspace-0001", label: "workspace-00" },
      { value: "ws-2", label: "Beta" },
    ]);

    workspacesConsole.toggleWorkspaceCard({ workspaceId: "workspace-0001" } as any);
    expect(workspacesConsole.selectedId.value).toBe("workspace-0001");
    expect(workspacesConsole.expandedWorkspaceId.value).toBe("workspace-0001");

    workspacesConsole.panel.value = "cloudDrive";
    await nextTick();
    expect(workspacesConsole.expandedWorkspaceId.value).toBe("");

    workspacesConsole.selectedId.value = "ws-2";
    await flushPromises();
    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("ws-2");
    expect(workspacesConsole.selected.value?.title).toBe("Beta");

    workspacesConsole.panel.value = "list";
    await nextTick();
    expect(workspacesConsole.expandedWorkspaceId.value).toBe("ws-2");

    workspacesConsole.selectedId.value = "missing";
    await flushPromises();
    expect(workspacesConsole.selected.value).toBeNull();

    workspacesConsole.openCloudDrive();
    expect(workspacesConsole.panel.value).toBe("cloudDrive");
    workspacesConsole.openCodespace();
    expect(workspacesConsole.panel.value).toBe("codespace");
    workspacesConsole.openLocalDir();
    expect(workspacesConsole.panel.value).toBe("localDir");
    expect(workspacesConsole.openProfile()).toBe("profile");
    expect(workspacesConsole.openParent()).toBe("parent");
    expect(workspacesConsole.panel.value).toBe("parent");

    await workspacesConsole.copyToClipboard(new MouseEvent("click"), "");
    expect(copyConsoleTextWithFeedbackMock).not.toHaveBeenCalled();

    copyConsoleTextWithFeedbackMock.mockRejectedValueOnce(new Error("copy failed"));
    await workspacesConsole.copyToClipboard(new MouseEvent("click"), "text");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toBe("Failed to copy: ");

    workspacesConsole.connectCloudDrive();
    expect(workspacesConsole.busyKey.value).toBe("ws:drive-connect");
    workspacesConsole.refreshCloudDriveStatus();
    expect(workspacesConsole.busyKey.value).toBe("global-busy");

    await pageRefreshMock.handler?.({ viewId: "workspaces" });
    expect(workspacesClientMock.listWorkspaceSummaries).toHaveBeenCalledTimes(2);
    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("missing");

    consoleErrorSpy.mockRestore();
  });

  it("reports load and chain failures without breaking the exposed state", async () => {
    workspacesClientMock.listWorkspaceSummaries.mockRejectedValueOnce(new Error("load failed"));
    workspacesClientMock.listWorkspaceSessions.mockResolvedValueOnce({ sessions: [] });
    workspacesClientMock.getWorkspaceChainBundle.mockRejectedValueOnce(new Error("chain failed"));
    serverShellContextMock.current = {
      busyKey: ref(""),
    };

    const workspacesConsole = mountWorkspacesConsole();
    await flushPromises();

    expect(workspacesConsole.localError.value).toBe("load failed");

    workspacesConsole.selectedId.value = "ws-error";
    await flushPromises();
    expect(workspacesConsole.localError.value).toBe("chain failed");
    expect(checkpointControllerMock.state.resetWorkspaceCheckpoints).toHaveBeenCalled();
    expect(localDirectoryControllerMock.state.resetLocalDirectoryState).toHaveBeenCalled();
    expect(codespaceControllerMock.state.resetCodespaceState).toHaveBeenCalled();
  });
});
