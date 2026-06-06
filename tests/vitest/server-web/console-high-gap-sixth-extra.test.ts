// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleExpertRulesController } from "../../../server-web/composables/console-expert-rules-controller";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";
import { useWorkspacesConsole } from "../../../server-web/composables/useWorkspacesConsole";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";

const externalServicesClientMock = vi.hoisted(() => ({
  getExternalServiceConfig: vi.fn(),
  refreshExternalServiceRuntime: vi.fn(),
  saveExternalServiceConfig: vi.fn(),
  verifyExternalServiceConfig: vi.fn(),
}));

const externalServicesViewControllerMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const browserEffectsMock = vi.hoisted(() => ({
  copyConsoleTextWithFeedback: vi.fn(),
}));

const pageRefreshHandlerMock = vi.hoisted(() => vi.fn());

const shellContextMock = vi.hoisted(() => ({
  busyKey: { value: "" },
}));

const feedViewContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const workspacesViewContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const workspacesClientMock = vi.hoisted(() => ({
  getWorkspaceChainBundle: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  listWorkspaceSummaries: vi.fn(),
}));

const knowledgeRulesClientMock = vi.hoisted(() => ({
  getEmailRules: vi.fn(),
  getGoldenRules: vi.fn(),
  getExpertVocabulary: vi.fn(),
  publishGoldenRules: vi.fn(),
  saveEmailRules: vi.fn(),
  saveGoldenRules: vi.fn(),
  saveExpertVocabulary: vi.fn(),
}));

const workspaceCloudDriveControllerMock = vi.hoisted(() => ({
  cloudDriveAllowedClients: [],
  cloudDriveConnectionOptions: [{ label: "Drive A", value: "drive-a" }],
  cloudDriveData: {
    connections: [
      {
        driveRef: "drive-a",
        provider: "icloud",
        mode: "local",
        directoryMappingCount: 1,
        contractVerified: true,
      },
    ],
  },
  cloudDriveForm: {
    advancedMode: false,
    allowedClients: "",
    clientId: "client-a",
    driveRef: "",
    exposedDirectories: [],
    managedFolderRoot: "/tmp/pact",
    path: "",
    provider: "icloud",
    publicFolder: "/public",
    rootPath: "",
    targetPath: "",
    uploadContent: "",
    uploadPath: "",
  },
  cloudDriveResult: null,
  addCloudDriveExposure: vi.fn(),
  applyCloudDriveSync: vi.fn(),
  connectCloudDrive: vi.fn(),
  downloadCloudDriveFile: vi.fn(),
  listCloudDriveItems: vi.fn(),
  listCloudDrivePermissions: vi.fn(),
  openCloudDrive: vi.fn(() => "cloudDrive"),
  planCloudDriveSync: vi.fn(),
  removeCloudDriveExposure: vi.fn(),
  refreshCloudDriveStatus: vi.fn(),
  uploadCloudDriveFile: vi.fn(),
}));

const workspaceCheckpointControllerMock = vi.hoisted(() => ({
  checkpointNodeBasePath: vi.fn(),
  checkpointNodeFileCount: vi.fn(),
  loadWorkspaceCheckpointTree: vi.fn(),
  loadWorkspaceCheckpoints: vi.fn(),
  previewWorkspaceCheckpointRestore: vi.fn(),
  resetWorkspaceCheckpoints: vi.fn(),
  restoreWorkspaceCheckpoint: vi.fn(),
  selectedCheckpointNodeId: "",
  selectedCheckpointTreeId: "",
  workspaceCheckpointDetail: null,
  workspaceCheckpointError: "",
  workspaceCheckpointNodes: [],
  workspaceCheckpointPreview: null,
  workspaceCheckpointPreviewRestore: null,
  workspaceCheckpointTrees: [],
}));

const workspaceCodespaceControllerMock = vi.hoisted(() => ({
  codespaceData: null,
  codespaceForm: {},
  codespaceResult: null,
  inspectCodespaceStatus: vi.fn(),
  openCodespace: vi.fn(() => "codespace"),
  prepareCodespaceChange: vi.fn(),
  resetCodespaceState: vi.fn(),
  setCodespaceData: vi.fn(),
  uploadCodespaceChange: vi.fn(),
}));

const workspaceLocalDirectoryControllerMock = vi.hoisted(() => ({
  connectLocalDirectory: vi.fn(),
  localDirForm: {},
  localDirMountData: null,
  openLocalDir: vi.fn(() => "localDir"),
  resetLocalDirectoryState: vi.fn(),
  setLocalDirectoryMountData: vi.fn(),
  syncLocalDirectory: vi.fn(),
}));

const workspaceManagementControllerMock = vi.hoisted(() => ({
  createForm: { title: "" },
  deleteFolderChecked: false,
  deleteWorkspace: vi.fn(),
  hotSwapProfile: vi.fn(),
  openParent: vi.fn(),
  openProfile: vi.fn(),
  parentForm: { parentWorkspaceId: "" },
  profileForm: {},
  selectedId: "",
  setParent: vi.fn(),
  shareForm: {},
  shareOrUnshare: vi.fn(),
  showDeleteModal: false,
  createWorkspace: vi.fn(),
}));

const workspaceSessionControllerMock = vi.hoisted(() => ({
  forkSession: vi.fn(),
  selectedSession: null,
  selectedSessionId: "",
  selectSession: vi.fn(),
  sessionContextData: null,
  sessionItems: [],
}));

const workspaceViewContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/lib/external-services-client", () => ({
  getExternalServiceConfig: externalServicesClientMock.getExternalServiceConfig,
  refreshExternalServiceRuntime: externalServicesClientMock.refreshExternalServiceRuntime,
  saveExternalServiceConfig: externalServicesClientMock.saveExternalServiceConfig,
  verifyExternalServiceConfig: externalServicesClientMock.verifyExternalServiceConfig,
  externalServiceBindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
  externalServiceBindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
  externalServiceCloudDriveModeOptions: [{ value: "local", label: "local" }],
  externalServiceCloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
  externalServiceHealthCheckTypeOptions: [{ value: "none", label: "none" }],
  externalServiceMcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
  externalServiceModeOptions: [{ value: "connected", label: "connected" }],
  externalServiceModelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
  externalServiceRiskOptions: [{ value: "read_only", label: "read_only" }],
  externalServiceStartupPolicyOptions: [{ value: "external-only", label: "external-only" }],
  externalServiceUpstreamTypeOptions: [
    { value: "mcp", label: "MCP 服务" },
    { value: "llm", label: "LLM Service" },
    { value: "cloud-drive", label: "Cloud Drive Service" },
    { value: "http", label: "HTTP 服务" },
    { value: "https", label: "HTTPS 服务" },
    { value: "rpc", label: "RPC 服务" },
    { value: "other", label: "其它服务" },
  ],
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesViewControllerMock.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => shellContextMock),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: vi.fn(),
  copyConsoleTextWithFeedback: browserEffectsMock.copyConsoleTextWithFeedback,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedViewContextMock.current,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => workspacesViewContextMock.current,
}));

vi.mock("../../../server-web/lib/workspaces-client", () => ({
  getWorkspaceChainBundle: workspacesClientMock.getWorkspaceChainBundle,
  listWorkspaceSessions: workspacesClientMock.listWorkspaceSessions,
  listWorkspaceSummaries: workspacesClientMock.listWorkspaceSummaries,
}));

vi.mock("../../../server-web/lib/knowledge-rules-client", () => ({
  getEmailRules: knowledgeRulesClientMock.getEmailRules,
  getGoldenRules: knowledgeRulesClientMock.getGoldenRules,
  getExpertVocabulary: knowledgeRulesClientMock.getExpertVocabulary,
  publishGoldenRules: knowledgeRulesClientMock.publishGoldenRules,
  saveEmailRules: knowledgeRulesClientMock.saveEmailRules,
  saveGoldenRules: knowledgeRulesClientMock.saveGoldenRules,
  saveExpertVocabulary: knowledgeRulesClientMock.saveExpertVocabulary,
}));

vi.mock("../../../server-web/composables/console-workspace-cloud-drive-controller", () => ({
  useWorkspaceCloudDriveController: vi.fn(() => workspaceCloudDriveControllerMock),
}));

vi.mock("../../../server-web/composables/console-workspace-checkpoint-controller", () => ({
  useWorkspaceCheckpointController: vi.fn(() => workspaceCheckpointControllerMock),
}));

vi.mock("../../../server-web/composables/console-workspace-codespace-controller", () => ({
  useWorkspaceCodespaceController: vi.fn(() => workspaceCodespaceControllerMock),
}));

vi.mock("../../../server-web/composables/console-workspace-local-directory-controller", () => ({
  useWorkspaceLocalDirectoryController: vi.fn(() => workspaceLocalDirectoryControllerMock),
}));

vi.mock("../../../server-web/composables/console-workspace-management-controller", () => ({
  useWorkspaceManagementController: vi.fn(() => workspaceManagementControllerMock),
}));

vi.mock("../../../server-web/composables/console-workspace-session-controller", () => ({
  useWorkspaceSessionController: vi.fn(() => workspaceSessionControllerMock),
}));

const ConfigFloatingPanelStub = defineComponent({
  name: "ConfigFloatingPanel",
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    statusTone: { type: String, default: "" },
    statusLabel: { type: String, default: "" },
    verifying: { type: Boolean, default: false },
  },
  emits: ["close", "verify"],
  setup(props, { emit, slots }) {
    return () =>
      props.open
        ? h("section", { class: "config-floating-panel-stub" }, [
            h("h3", String(props.title || "")),
            h("button", { type: "button", class: "config-floating-panel-verify", onClick: () => emit("verify") }, props.verifying ? "校验中" : "校验配置"),
            h("button", { type: "button", class: "config-floating-panel-close", onClick: () => emit("close") }, "关闭"),
            slots.default?.(),
          ])
        : null;
  },
});

const HelpTooltipStub = defineComponent({
  name: "HelpTooltip",
  props: { ariaLabel: { type: String, default: "" }, text: { type: String, default: "" } },
  setup(props) {
    return () => h("span", { class: "help-tooltip-stub", "aria-label": props.ariaLabel }, String(props.text || ""));
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: { tone: { type: String, default: "" }, label: { type: String, default: "" } },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label || ""));
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: { modelValue: { type: Boolean, default: false }, label: { type: String, default: "" }, disabled: { type: Boolean, default: false } },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h("button", {
        class: "binary-checkbox-stub",
        type: "button",
        disabled: props.disabled,
        onClick: () => {
          const next = !props.modelValue;
          emit("update:modelValue", next);
          emit("update:model-value", next);
          emit("change", next);
        },
      }, String(props.label || ""));
  },
});

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: { buttonClass: { type: String, default: "" }, buttonText: { type: String, default: "" }, kind: { type: String, default: "" }, multiple: { type: Boolean, default: false } },
  emits: ["select"],
  setup(props, { emit, slots }) {
    return () =>
      h("button", {
        type: "button",
        class: ["browse-select-button-stub", props.buttonClass || ""],
        "data-kind": props.kind || "",
        onClick: () => emit("select", [new File(["attachment"], "attachment.txt", { type: "text/plain" })]),
      }, slots.default?.() || props.buttonText);
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    includeEmpty: { type: Boolean, default: false },
    label: { type: String, default: "" },
    modelValue: { type: String, default: "" },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "agent-model-option-bar-stub", "data-label": props.label || "" }, [
        h("select", {
          class: "agent-model-option-bar-select",
          value: props.modelValue || "",
          onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
        }),
      ]);
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: { title: { type: String, default: "" }, open: { type: Boolean, default: false } },
  setup(_, { slots }) {
    return () => h("section", { class: "config-fold-card-stub" }, slots.default?.());
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    label: { type: String, default: "" },
    modelValue: { type: [String, Number, Boolean], default: "" },
    options: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "option-bar-stub", "data-label": props.label || "" }, [
        h("select", {
          class: "option-bar-stub-select",
          value: props.modelValue == null ? "" : String(props.modelValue),
          onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
        }),
      ]);
  },
});

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    entryId: "mcp-docs",
    serviceId: "mcp-docs",
    serviceName: "Docs MCP",
    displayName: "Docs MCP",
    description: "Documentation MCP service",
    mode: "connected",
    startupPolicy: "external-only",
    source: "configured",
    sourceLabel: "本地",
    filePath: "/tmp/pact/external-services.json",
    requiredOperations: ["knowledge.search"],
    scriptCount: 1,
    validationStatus: "valid",
    validation: { ok: true, errors: [], warnings: [] },
    externalMcp: { tools: ["search", { name: "search" }, { id: "file.list" }, "status"] },
    upstreamTargetLabelText: "127.0.0.1:8787",
    upstreamTargetDetailText: "endpoint",
    sourceLabelText: "本地 / mcp-docs",
    discoveryLabelText: "MCP 服务",
    discoveryTone: "success",
    discoveryRegistrationLabelText: "工具已发现",
    discoveryRegistrationTone: "success",
    heartbeatText: "Latest: -",
    heartbeatRefreshing: false,
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    ...overrides,
  };
}

function makeExternalState() {
  return {
    ok: true,
    schemaVersion: 1,
    generatedAt: "2026-06-04T04:00:00.000Z",
    registryKind: "pact.external-service.registry",
    registryPath: "/tmp/pact/external-services.json",
    activeServiceId: "mcp-docs",
    activeConfig: {},
    activeConfigText: "{}",
    activeValidation: { ok: true, errors: [], warnings: ["registry warning"] },
    templateConfig: {},
    templateConfigText: "{}",
    externalMcpCache: {
      updatedAt: "2026-06-04T04:05:00.000Z",
      serviceCount: 3,
    },
    services: [
      makeService({
        serviceId: "mcp-docs",
        externalMcp: { serviceId: "mcp-docs", toolCount: 3, tools: [], discoveredAt: "2026-06-04T03:20:00.000Z" },
      }),
      makeService({
        serviceId: "script-service",
        serviceName: "Script Service",
        displayName: "Script Service",
        sourceLabel: "脚本",
        config: {
          serviceId: "script-service",
          serviceName: "Script Service",
          upstream: {
            type: "",
            metadata: {},
          },
          scripts: {
            main: { path: "/opt/pact/scripts/start.ts" },
          },
          healthCheck: { host: "", port: null },
          includePaths: [],
          scriptRoots: [],
          binding: { requiredScopes: [] },
        },
        externalMcp: null,
        validationStatus: "invalid",
        validation: { ok: false, errors: ["missing target"], warnings: [] },
      }),
      makeService({
        serviceId: "docker-service",
        serviceName: "Docker Service",
        displayName: "Docker Service",
        sourceLabel: "Docker",
        config: {
          serviceId: "docker-service",
          serviceName: "Docker Service",
          upstream: {
            type: "",
            metadata: {},
          },
          docker: { containerName: "pact-container" },
          binding: { requiredScopes: [] },
        },
        externalMcp: { serviceId: "docker-service", tools: [], discoveredAt: "2026-06-04T03:40:00.000Z" },
      }),
    ],
    configuredCount: 3,
    presetCount: 0,
  };
}

function mountExternalServicesView() {
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        ConfigFloatingPanel: ConfigFloatingPanelStub,
        HelpTooltip: HelpTooltipStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

function createWorkspacesContext(overrides: Record<string, unknown> = {}) {
  return {
    addCloudDriveExposure: vi.fn(),
    applyCloudDriveSync: vi.fn(),
    busyKey: ref(""),
    cloudDriveConnectionOptions: ref([{ label: "Drive A", value: "drive-a" }]),
    cloudDriveData: ref({
      connections: [
        {
          driveRef: "drive-a",
          provider: "icloud",
          mode: "local",
          directoryMappingCount: 1,
          contractVerified: true,
        },
      ],
    }),
    cloudDriveForm: ref({
      advancedMode: false,
      allowedClients: "",
      clientId: "client-a",
      driveRef: "",
      exposedDirectories: [
        {
          id: "dir-1",
          name: "Docs",
          path: "/Users/demo/Documents",
          permissionMode: "allowlist",
          subjects: "client-a",
          showPermissions: false,
        },
      ],
      managedFolderRoot: "/tmp/pact",
      path: "",
      provider: "icloud",
      publicFolder: "/public",
      rootPath: "",
      targetPath: "",
      uploadContent: "",
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
    selected: ref({ title: "Workspace Alpha" }),
    uploadCloudDriveFile: vi.fn(),
    ...overrides,
  };
}

function createFeedContext(overrides: Record<string, unknown> = {}) {
  return {
    agentSelectorOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([{ label: "32k", value: "32k" }]),
    handleInfoFeedAttachmentFiles: vi.fn(),
    infoFeedAttachments: ref([
      { id: "att-running", name: "draft.txt", status: "running" },
      { id: "att-complete", name: "summary.md", status: "completed" },
    ]),
    infoFeedCurrentRun: ref(null),
    infoFeedForm: ref({
      contextProfileId: "32k",
      maxTokens: 4096,
      modelAlias: "",
      query: "",
      temperature: 0.2,
    }),
    infoFeedInputPlaceholder: ref("输入问题，信息流会并行对比原文检索和智能规划。"),
    infoFeedModelOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
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
    thinkingModeOptionBarOptions: ref([{ label: "Balanced", value: "balanced" }]),
    ...overrides,
  };
}

function mountFeedPanel() {
  return mount(InfoFeedComposerPanel, {
    global: {
      stubs: {
        AgentModelOptionBar: AgentModelOptionBarStub,
        BrowseSelectButton: BrowseSelectButtonStub,
        ConfigFoldCard: ConfigFoldCardStub,
        OptionBar: OptionBarStub,
      },
    },
  });
}

function mountWorkspaceCloudDrivePanel() {
  return shallowMount(WorkspaceCloudDrivePanel, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        OptionBar: OptionBarStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceCloudDriveControllerMock.cloudDriveData = ref({
    connections: [
      {
        driveRef: "drive-a",
        provider: "icloud",
        mode: "local",
        directoryMappingCount: 1,
        contractVerified: true,
      },
    ],
  });
  workspaceCloudDriveControllerMock.cloudDriveConnectionOptions = reactive([{ label: "Drive A", value: "drive-a" }]);
  workspaceCloudDriveControllerMock.cloudDriveForm = reactive({
    advancedMode: false,
    allowedClients: "",
    clientId: "client-a",
    driveRef: "",
    exposedDirectories: [
      {
        id: "dir-1",
        name: "Docs",
        path: "/Users/demo/Documents",
        permissionMode: "allowlist",
        subjects: "client-a",
        showPermissions: false,
      },
    ],
    managedFolderRoot: "/tmp/pact",
    path: "",
    provider: "icloud",
    publicFolder: "/public",
    rootPath: "",
    targetPath: "",
    uploadContent: "",
    uploadPath: "",
  });
  workspaceCloudDriveControllerMock.cloudDriveResult = ref(null);
  externalServicesClientMock.getExternalServiceConfig.mockResolvedValue(makeExternalState());
  externalServicesClientMock.refreshExternalServiceRuntime.mockResolvedValue({
    ok: true,
    refreshedAt: "2026-06-04T05:00:00.000Z",
    refreshedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    results: [],
    state: makeExternalState(),
  });
  externalServicesClientMock.saveExternalServiceConfig.mockResolvedValue({
    ok: true,
    config: {},
    validation: { ok: true, errors: [], warnings: [] },
    registryPath: "/tmp/pact/external-services.json",
  });
  externalServicesClientMock.verifyExternalServiceConfig.mockResolvedValue({
    ok: true,
    config: {},
    validation: { ok: true, errors: [], warnings: [] },
  });
  knowledgeRulesClientMock.getEmailRules.mockResolvedValue({ rules: { schemaVersion: 1, updatedAt: "", reportSeries: [], synonymDictionary: [], departmentDictionary: [], keywordStopwords: [], transactionMergeRules: { highSimilarity: 0.32, mediumSimilarity: 0.18, mediumParticipantOverlap: 0.34, highParticipantOverlap: 0.6 } } });
  knowledgeRulesClientMock.getGoldenRules.mockResolvedValue({ packages: [] });
  knowledgeRulesClientMock.getExpertVocabulary.mockResolvedValue({ vocabulary: { schemaVersion: 1, version: 1, updatedAt: "", publishedAt: "", source: "seed", checksum: "seed", entries: [] } });
  knowledgeRulesClientMock.publishGoldenRules.mockResolvedValue({ ok: true });
  knowledgeRulesClientMock.saveEmailRules.mockResolvedValue({ rules: { schemaVersion: 1, updatedAt: "", reportSeries: [], synonymDictionary: [], departmentDictionary: [], keywordStopwords: [], transactionMergeRules: { highSimilarity: 0.32, mediumSimilarity: 0.18, mediumParticipantOverlap: 0.34, highParticipantOverlap: 0.6 } } });
  knowledgeRulesClientMock.saveGoldenRules.mockResolvedValue({ package: { version: 1 } });
  knowledgeRulesClientMock.saveExpertVocabulary.mockResolvedValue({ vocabulary: { schemaVersion: 1, version: 1, updatedAt: "", publishedAt: "", source: "seed", checksum: "seed", entries: [] } });
  externalServicesViewControllerMock.current = null;
  feedViewContextMock.current = null;
  workspacesViewContextMock.current = null;
});

afterEach(() => {
  shellContextMock.busyKey.value = "";
});

describe("console-navigation-controller extra coverage", () => {
  it("refreshes the admin logs branch and normalizes external-service route sync", async () => {
    const error = ref("");
    const refreshAuthAdmin = vi.fn();
    const refreshBackgroundProcesses = vi.fn();
    const refreshClientRuntimeStatus = vi.fn();
    const refreshContextCompiler = vi.fn();
    const refreshDashboardAlertsSnapshot = vi.fn();
    const refreshExpertRules = vi.fn();
    const refreshKnowledgeConsole = vi.fn();
    const refreshKnowledgeRecallBackendSpaces = vi.fn();
    const refreshMaintenanceAgent = vi.fn();
    const refreshMonitorAlerts = vi.fn();
    const refreshState = vi.fn();
    const refreshToolManagement = vi.fn();
    const refreshWordCloud = vi.fn();
    const scrollToConfigTarget = vi.fn(async () => undefined);
    const router = {
      currentRoute: ref({
        path: "/external-services/list",
        meta: { viewId: "externalServices" },
        params: { tab: "list" },
      }),
      push: vi.fn(),
    };

    const controller = createConsoleNavigationController({
      error,
      ensureAgentPermissionGroupsDraft: vi.fn(),
      hasFeature: () => true,
      isAdminViewEnabled: () => true,
      refreshAuthAdmin,
      refreshBackgroundProcesses,
      refreshClientRuntimeStatus,
      refreshContextCompiler,
      refreshDashboardAlertsSnapshot,
      refreshExpertRules,
      refreshKnowledgeConsole,
      refreshKnowledgeRecallBackendSpaces,
      refreshMaintenanceAgent,
      refreshMonitorAlerts,
      refreshState,
      refreshToolManagement,
      refreshWordCloud,
      scrollToConfigTarget,
      visibleDebugTabs: ref([{ id: "knowledgeRecall", label: "知识召回" }]),
      visibleKnowledgeTabs: ref([{ id: "management", label: "知识归档" }]),
    });

    controller.bindNavigationRouter(router as any);
    expect(controller.currentView.value).toBe("externalServices");
    expect(controller.externalServiceTab.value).toBe("list");

    controller.syncNavigationStateFromRoute({
      path: "/external-services/unknown",
      meta: { viewId: "externalServices" },
      params: { tab: "unknown" },
    } as any);
    expect(controller.externalServiceTab.value).toBe("list");

    controller.currentView.value = "admin";
    controller.adminView.value = "logs" as any;
    controller.switchView("admin");
    await nextTick();

    expect(refreshState).toHaveBeenCalledWith({ silent: true });
    expect(refreshKnowledgeConsole).toHaveBeenCalledTimes(1);
    expect(refreshMaintenanceAgent).toHaveBeenCalledWith({ silent: true });
    expect(refreshToolManagement).toHaveBeenCalledWith({ silent: true });
    expect(refreshBackgroundProcesses).toHaveBeenCalledWith({ silent: true });
    expect(refreshMonitorAlerts).toHaveBeenCalledWith({ silent: true });
    expect(refreshAuthAdmin).toHaveBeenCalled();
  });
});

describe("console expert rules controller extra coverage", () => {
  it("refreshes all subcontrollers and preserves silent error handling", async () => {
    const error = ref("");
    const clearAllBusy = vi.fn();
    const setBusy = vi.fn();
    const refreshState = vi.fn().mockResolvedValue(undefined);
    const controller = createConsoleExpertRulesController({
      applyRemoteConsoleDraftUpdate: vi.fn(),
      clearAllBusy,
      error,
      isApplyingRemoteConsoleDrafts: () => false,
      refreshState,
      setBusy,
    });

    knowledgeRulesClientMock.getEmailRules.mockResolvedValueOnce({
      rules: { schemaVersion: 1, updatedAt: "", reportSeries: [], synonymDictionary: [], departmentDictionary: [], keywordStopwords: [], transactionMergeRules: { highSimilarity: 0.32, mediumSimilarity: 0.18, mediumParticipantOverlap: 0.34, highParticipantOverlap: 0.6 } },
    });
    knowledgeRulesClientMock.getExpertVocabulary.mockResolvedValueOnce({
      vocabulary: { schemaVersion: 1, version: 1, updatedAt: "", publishedAt: "", source: "seed", checksum: "seed", entries: [] },
    });

    await controller.refreshExpertRules({ silent: true, forceDrafts: true } as any);
    expect(setBusy).not.toHaveBeenCalled();
    expect(clearAllBusy).not.toHaveBeenCalled();

    knowledgeRulesClientMock.getEmailRules.mockRejectedValueOnce(new Error("email load failed"));
    await controller.refreshExpertRules();
    expect(error.value).toBe("email load failed");
    expect(setBusy).toHaveBeenCalledWith("expert-rules:refresh");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
  });
});

describe("useExternalServicesViewController", () => {
  it("prefers script, docker, and missing-target labels when deriving service cards", async () => {
    const { useExternalServicesViewController: actualUseExternalServicesViewController } =
      await vi.importActual<typeof import("../../../server-web/composables/external-services-view-controller")>(
        "../../../server-web/composables/external-services-view-controller",
      );

    const shell = { openExternalServiceTab: vi.fn() };
    let controller: ReturnType<typeof actualUseExternalServicesViewController> | null = null;
    const mounted = mount(defineComponent({
      name: "ExternalServicesControllerHarness",
      setup() {
        controller = actualUseExternalServicesViewController(shell as any);
        return () => null;
      },
    }));
    await flushPromises();

    const [mcpService, scriptService, dockerService] = (controller!.services as any[]) || [];
    expect(controller.discoveredServiceCount).toBe(3);
    expect(controller.serviceDiscoveryLabel(scriptService)).toBe("其它服务");
    expect(controller.upstreamTargetDetailLabel(scriptService)).toBe("script path");
    expect(controller.upstreamTargetLabel(scriptService)).toBe("/opt/pact/scripts/start.ts");
    expect(controller.upstreamTargetDetailLabel(dockerService)).toBe("docker container");
    expect(controller.upstreamTargetLabel(dockerService)).toBe("pact-container");
    expect(controller.serviceDiscoveryRegistrationLabel(mcpService)).toBe("工具已发现");

    mounted.unmount();
  });
});

describe("ExternalServicesView", () => {
  it("forwards edit and refresh actions and closes the popover on outside pointerdown", async () => {
    const controller = {
      actionError: "",
      actionMessage: "",
      configEditorOpen: false,
      configText: "{}",
      closeConfigEditor: vi.fn(),
      configEditorMode: "add",
      configEditorSubtitle: "subtitle",
      configEditorTitle: "title",
      configStatusLabel: "Valid",
      configStatusTone: "success",
      configDraft: {},
      dirty: false,
      loadError: "",
      loading: false,
      saveConfig: vi.fn(),
      services: [
        makeService({
          serviceId: "mcp-main",
          displayName: "MCP Main",
          externalMcp: { tools: ["search", { name: "status" }] },
          heartbeatText: "Latest: -",
        }),
      ],
      openAddServiceConfig: vi.fn(),
      openEditServiceConfig: vi.fn(),
      refreshExternalServices: vi.fn(),
      refreshRuntime: vi.fn(),
      serviceDiscoveryLabel: (service: any) => service.discoveryLabelText,
      serviceDiscoveryRegistrationLabel: (service: any) => service.discoveryRegistrationLabelText,
      serviceDiscoveryRegistrationTone: (service: any) => service.discoveryRegistrationTone,
      serviceDiscoveryTone: (service: any) => service.discoveryTone,
      serviceHeartbeatLastAtLabel: (service: any) => service.heartbeatText,
      isServiceHeartbeatRefreshing: vi.fn(() => false),
      serviceSourceDetail: (service: any) => service.sourceLabelText,
      showCustomUpstreamType: false,
      startupPolicyOptions: [],
      statusTone: () => "success",
      upstreamTargetDetailLabel: (service: any) => service.upstreamTargetDetailText,
      upstreamTargetLabel: (service: any) => service.upstreamTargetLabelText,
      validServiceCount: 1,
      configuredCount: 1,
      discoveredServiceCount: 1,
      mcpToolCount: 2,
      presetCount: 0,
      verifyConfig: vi.fn(),
      verificationErrors: [],
      verificationWarnings: [],
      verifying: false,
      onConfigInput: vi.fn(),
      updateBindingField: vi.fn(),
      updateCloudDriveMode: vi.fn(),
      updateCloudDriveProvider: vi.fn(),
      updateCustomUpstreamType: vi.fn(),
      updateHealthCheckField: vi.fn(),
      updateHealthCheckRequired: vi.fn(),
      updateModelProtocol: vi.fn(),
      updateModelProvider: vi.fn(),
      updateRequiredScopes: vi.fn(),
      updateRootField: vi.fn(),
      updateUpstreamField: vi.fn(),
      updateUpstreamTypeSelection: vi.fn(),
    } as any;
    externalServicesViewControllerMock.current = controller;

    const wrapper = mountExternalServicesView();
    expect(wrapper.text()).toContain("MCP 服务");
    expect(wrapper.findAll(".external-service-table-row")).toHaveLength(1);

    const row = wrapper.find(".external-service-table-row");
    await row.findAll("button").find((button) => button.text() === "修改配置")?.trigger("click");
    expect(controller.openEditServiceConfig).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "mcp-main" }));

    const toolButton = row.find(".external-service-tool-list-button");
    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await wrapper.find(".external-service-upstream-copy").trigger("focus");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);
    await wrapper.find(".external-service-upstream-copy").trigger("blur");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);
  });
});

describe("useWorkspacesConsole", () => {
  it("loads workspaces, switches panels, and exposes cloud-drive actions to the panel", async () => {
    workspacesClientMock.listWorkspaceSummaries.mockResolvedValueOnce({
      workspaces: [
        { workspaceId: "ws-1", title: "Alpha", status: "active" },
        { workspaceId: "ws-2", title: "Beta", status: "archived" },
      ],
    });
    workspacesClientMock.listWorkspaceSessions.mockResolvedValueOnce({ sessions: [] });
    workspacesClientMock.getWorkspaceChainBundle.mockResolvedValueOnce({
      chain: { id: "chain-1" },
      context: { id: "context-1" },
      files: { id: "files-1" },
      localDirs: { id: "local-dirs-1" },
      cloudDrives: { id: "cloud-drives-1" },
      codespace: { id: "codespace-1" },
    });

    const controller = mount(defineComponent({
      setup() {
        workspacesViewContextMock.current = useWorkspacesConsole() as any;
        return () => null;
      },
    }));
    await flushPromises();

    const workspacesConsole = workspacesViewContextMock.current as any;
    expect(workspacesClientMock.listWorkspaceSummaries).toHaveBeenCalledTimes(1);
    expect(workspacesClientMock.listWorkspaceSessions).toHaveBeenCalledTimes(1);
    expect(workspacesConsole.workspaceOptions.value).toEqual([
      { value: "ws-1", label: "Alpha" },
      { value: "ws-2", label: "Beta" },
    ]);
    expect(workspacesConsole.statusTone("active")).toBe("success");
    expect(workspacesConsole.statusTone("archived")).toBe("neutral");

    workspacesConsole.selectedId.value = "ws-1";
    await flushPromises();
    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("ws-1");
    expect(workspaceLocalDirectoryControllerMock.setLocalDirectoryMountData).toHaveBeenCalledWith({ id: "local-dirs-1" });
    expect(workspaceCodespaceControllerMock.setCodespaceData).toHaveBeenCalledWith({ id: "codespace-1" });
    expect(workspaceCheckpointControllerMock.loadWorkspaceCheckpoints).toHaveBeenCalledWith("ws-1");

    workspacesConsole.openCloudDrive();
    expect(workspacesConsole.panel.value).toBe("cloudDrive");
    workspacesConsole.openCodespace();
    expect(workspacesConsole.panel.value).toBe("codespace");
    workspacesConsole.openLocalDir();
    expect(workspacesConsole.panel.value).toBe("localDir");

    workspacesViewContextMock.current = workspacesConsole;
    const panel = mountWorkspaceCloudDrivePanel();
    expect(panel.text()).toContain("云盘");
    expect(panel.text()).toContain("Alpha");
    expect(panel.text()).toContain("contractVerified");

    await panel.get(".binary-checkbox-stub").trigger("click");
    expect((workspacesConsole.cloudDriveForm as any).advancedMode).toBe(true);
    expect(panel.text()).toContain("权限配置");

    await panel.get(".table-action").trigger("click");
    expect(workspacesConsole.addCloudDriveExposure).toHaveBeenCalledTimes(1);

    await panel.findAll("button").find((button) => button.text() === "连接")?.trigger("click");
    expect(workspacesConsole.connectCloudDrive).toHaveBeenCalledTimes(1);

    controller.unmount();
  });
});

describe("InfoFeedComposerPanel", () => {
  it("binds attachment chips, opens advanced options, and saves updated defaults", async () => {
    feedViewContextMock.current = createFeedContext({
      infoFeedAttachments: ref([
        { id: "att-a", name: "draft.txt", status: "running" },
        { id: "att-b", name: "summary.md", status: "completed" },
      ]),
      infoFeedForm: ref({
        contextProfileId: "32k",
        maxTokens: 4096,
        modelAlias: "",
        query: "初始问题",
        temperature: 0.2,
      }),
    });

    const wrapper = mountFeedPanel();
    expect(wrapper.text()).toContain("draft.txt");
    expect(wrapper.text()).toContain("summary.md");
    await wrapper.get("textarea").setValue("更新后的问题");
    expect((feedViewContextMock.current.infoFeedForm as any).value.query).toBe("更新后的问题");

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect(feedViewContextMock.current.handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.get(".info-feed-advanced-form").trigger("submit.prevent");
    expect(feedViewContextMock.current.saveSettings).toHaveBeenCalledTimes(1);
  });
});
