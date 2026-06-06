// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shellContextState = vi.hoisted(() => ({
  busyKey: { value: "" },
}));

const consolePreferencesState = vi.hoisted(() => ({
  languageMode: { value: "zh-CN" },
  languageOptionBarOptions: { value: [{ label: "中文", value: "zh-CN" }] },
  msg: { value: {
    actions: { refreshPage: "刷新页面", refreshing: "刷新中" },
    connecting: "连接中",
    nav: {
      agentRetrieval: "智能检索",
      approvalFlow: "审批流",
      corpusAnalysis: "语料分析",
      dashboard: "控制台",
      debugPanel: "调试",
      devices: "设备",
      externalServiceConfig: "外部服务配置",
      externalServiceList: "外部服务列表",
      feed: "信息流",
      jobs: "作业",
      knowledge: "知识库",
      knowledgeDistillation: "知识蒸馏",
      knowledgeRecall: "知识召回",
      maintenanceAgent: "维护智能体",
      parameterConfig: "参数配置",
      permissionGroups: "权限组",
      runtimeDownloads: "运行时下载",
      sources: "数据源",
      toolList: "工具列表",
      toolStats: "工具统计",
      workspaces: "工作区",
    },
    title: { admin: "管理员", modules: "模块", storage: "存储" },
    topbar: { serverAvailable: "在线", serverUnavailable: "离线" },
  } },
  themeMode: { value: "dark" },
}));

const shellRouteState = vi.hoisted(() => ({
  route: {
    fullPath: "/admin/tool-list",
    meta: { viewId: "admin", adminView: "toolList" },
    params: { tab: "list" },
  },
}));

const consoleContextState = vi.hoisted(() => ({
  adminView: { value: "toolList" },
  consoleState: { value: { server: { url: "http://localhost:8787" } } },
  currentView: { value: "admin" },
  debugTab: { value: "knowledgeRecall" },
  externalServiceTab: { value: "list" },
  hasFeature: vi.fn(() => true),
  knowledgeTab: { value: "management" },
  refreshAuthAdmin: vi.fn(),
  refreshAuthState: vi.fn(),
  refreshBackgroundProcesses: vi.fn(),
  refreshClientRuntimeStatus: vi.fn(),
  refreshCodexOAuthStatus: vi.fn(),
  refreshContextCompiler: vi.fn(),
  refreshDashboardAlertsSnapshot: vi.fn(),
  refreshExpertRules: vi.fn(),
  refreshKnowledgeConflicts: vi.fn(),
  refreshKnowledgeConsole: vi.fn(),
  refreshKnowledgeSources: vi.fn(),
  refreshMaintenanceAgent: vi.fn(),
  refreshMcpAuthorizationRequests: vi.fn(),
  refreshMonitorAlerts: vi.fn(),
  refreshState: vi.fn(),
  refreshToolManagement: vi.fn(),
  refreshWordCloud: vi.fn(),
  reloadModules: vi.fn(),
  serverAvailable: { value: true },
}));

const publicConsoleContext = vi.hoisted(() => ({
  adminView: consoleContextState.adminView,
  consoleState: consoleContextState.consoleState,
  currentView: consoleContextState.currentView,
  debugTab: consoleContextState.debugTab,
  externalServiceTab: consoleContextState.externalServiceTab,
  hasFeature: consoleContextState.hasFeature,
  knowledgeTab: consoleContextState.knowledgeTab,
  refreshAuthAdmin: consoleContextState.refreshAuthAdmin,
  refreshAuthState: consoleContextState.refreshAuthState,
  refreshBackgroundProcesses: consoleContextState.refreshBackgroundProcesses,
  refreshClientRuntimeStatus: consoleContextState.refreshClientRuntimeStatus,
  refreshCodexOAuthStatus: consoleContextState.refreshCodexOAuthStatus,
  refreshContextCompiler: consoleContextState.refreshContextCompiler,
  refreshDashboardAlertsSnapshot: consoleContextState.refreshDashboardAlertsSnapshot,
  refreshExpertRules: consoleContextState.refreshExpertRules,
  refreshKnowledgeConflicts: consoleContextState.refreshKnowledgeConflicts,
  refreshKnowledgeConsole: consoleContextState.refreshKnowledgeConsole,
  refreshKnowledgeSources: consoleContextState.refreshKnowledgeSources,
  refreshMaintenanceAgent: consoleContextState.refreshMaintenanceAgent,
  refreshMcpAuthorizationRequests: consoleContextState.refreshMcpAuthorizationRequests,
  refreshMonitorAlerts: consoleContextState.refreshMonitorAlerts,
  refreshState: consoleContextState.refreshState,
  refreshToolManagement: consoleContextState.refreshToolManagement,
  refreshWordCloud: consoleContextState.refreshWordCloud,
  reloadModules: consoleContextState.reloadModules,
  serverAvailable: consoleContextState.serverAvailable,
}));

const pageRefreshControllerState = vi.hoisted(() => ({
  pageRefreshAriaLabel: { value: "刷新页面" },
  pageRefreshBusy: { value: false },
  pageRefreshTitle: { value: "刷新页面" },
  refreshCurrentPage: vi.fn().mockResolvedValue(undefined),
}));

const routeControllerState = vi.hoisted(() => ({
  activeRouteAdminView: { value: "toolList" },
  activeRouteDebugTab: { value: "knowledgeRecall" },
  activeRouteExternalServiceTab: { value: "list" },
  activeRouteFullPath: { value: "/admin/tool-list" },
  activeRouteKnowledgeTab: { value: "management" },
  activeRouteView: { value: "admin" },
  localizedDebugTabLabel: vi.fn((tab: { id: string; label: string }) => tab.label),
  localizedExternalServiceTabLabel: vi.fn((tab: { id: string; label: string }) => tab.label),
  localizedKnowledgeTabLabel: vi.fn((tab: { id: string; label: string }) => tab.label),
  localizedViewTitle: { value: "工具列表" },
}));

const useServerConsoleShellContextMock = vi.hoisted(() => vi.fn(() => shellContextState));
const usePageRefreshHandlerMock = vi.hoisted(() => vi.fn());
const confirmConsoleActionMock = vi.hoisted(() => vi.fn(() => true));
const copyConsoleTextWithFeedbackMock = vi.hoisted(() => vi.fn());

const infoFeedTrackControllerMock = vi.hoisted(() => ({
  runInfoFeedAgentTrack: vi.fn().mockResolvedValue(undefined),
  runInfoFeedKeywordTrack: vi.fn().mockResolvedValue(undefined),
}));
const infoFeedSummaryRunnerMock = vi.hoisted(() => ({
  runInfoFeedSummaryAgent: vi.fn().mockResolvedValue(undefined),
}));
const infoFeedExpertFeedbackMock = vi.hoisted(() => ({
  syncInfoFeedExpertFeedback: vi.fn().mockResolvedValue(undefined),
}));

const workspacesClientMock = vi.hoisted(() => ({
  listWorkspaceSummaries: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  getWorkspaceChainBundle: vi.fn(),
}));

const workspaceCloudDriveMock = vi.hoisted(() => ({
  cloudDriveData: { value: null },
  cloudDriveResult: { value: null },
  cloudDriveForm: { value: {} },
  cloudDriveConnectionOptions: { value: [] },
  cloudDriveAllowedClients: { value: [] },
  addCloudDriveExposure: vi.fn(),
  removeCloudDriveExposure: vi.fn(),
  refreshCloudDriveStatus: vi.fn(),
  connectCloudDrive: vi.fn(),
  listCloudDriveItems: vi.fn(),
  downloadCloudDriveFile: vi.fn(),
  uploadCloudDriveFile: vi.fn(),
  planCloudDriveSync: vi.fn(),
  applyCloudDriveSync: vi.fn(),
  listCloudDrivePermissions: vi.fn(),
  openCloudDrive: vi.fn(() => "cloudDrive"),
  setBusy: vi.fn(),
  clearBusy: vi.fn(),
}));

const workspaceCheckpointMock = vi.hoisted(() => ({
  workspaceCheckpointTrees: { value: [] },
  workspaceCheckpointDetail: { value: null },
  workspaceCheckpointPreview: { value: null },
  workspaceCheckpointError: { value: "" },
  selectedCheckpointTreeId: { value: "" },
  selectedCheckpointNodeId: { value: "" },
  workspaceCheckpointNodes: { value: [] },
  workspaceCheckpointPreviewRestore: vi.fn(),
  resetWorkspaceCheckpoints: vi.fn(),
  loadWorkspaceCheckpoints: vi.fn().mockResolvedValue(undefined),
  loadWorkspaceCheckpointTree: vi.fn(),
  previewWorkspaceCheckpointRestore: vi.fn(),
  restoreWorkspaceCheckpoint: vi.fn(),
  checkpointNodeFileCount: vi.fn(() => 0),
  checkpointNodeBasePath: vi.fn(() => ""),
}));

const workspaceLocalDirectoryMock = vi.hoisted(() => ({
  localDirMountData: { value: null },
  localDirForm: { value: {} },
  setLocalDirectoryMountData: vi.fn(),
  resetLocalDirectoryState: vi.fn(),
  openLocalDir: vi.fn(() => "localDir"),
  connectLocalDirectory: vi.fn(),
  syncLocalDirectory: vi.fn(),
}));

const workspaceCodespaceMock = vi.hoisted(() => ({
  codespaceData: { value: null },
  codespaceResult: { value: null },
  codespaceForm: { value: {} },
  setCodespaceData: vi.fn(),
  resetCodespaceState: vi.fn(),
  openCodespace: vi.fn(() => "codespace"),
  inspectCodespaceStatus: vi.fn(),
  prepareCodespaceChange: vi.fn(),
  uploadCodespaceChange: vi.fn(),
}));

const workspaceManagementMock = vi.hoisted(() => ({
  createForm: { value: { title: "", objective: "", parentWorkspaceId: "" } },
  createWorkspace: vi.fn(),
  deleteFolderChecked: { value: false },
  deleteWorkspace: vi.fn(),
  hotSwapProfile: vi.fn(),
  openParent: vi.fn(),
  openProfile: vi.fn(),
  parentForm: { value: { parentWorkspaceId: "" } },
  profileForm: { value: {} },
  setParent: vi.fn(),
  shareForm: { value: {} },
  shareOrUnshare: vi.fn(),
  showDeleteModal: { value: false },
}));

const workspaceSessionMock = vi.hoisted(() => ({
  selectedSessionId: { value: "" },
  selectedSession: { value: null },
  sessionContextData: { value: null },
  sessionItems: { value: [] },
  selectSession: vi.fn(),
  forkSession: vi.fn(),
}));

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const agentPermissionsContextState = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const feedContextState = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: vi.fn(() => shellRouteState.route),
    useRouter: vi.fn(() => ({
      currentRoute: {
        value: shellRouteState.route,
      },
      push: vi.fn(),
    })),
  };
});

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: useServerConsoleShellContextMock,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: usePageRefreshHandlerMock,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: confirmConsoleActionMock,
  copyConsoleTextWithFeedback: copyConsoleTextWithFeedbackMock,
}));

vi.mock("../../../server-web/composables/console-info-feed-track-controller", () => ({
  createConsoleInfoFeedTrackController: vi.fn(() => infoFeedTrackControllerMock),
}));

vi.mock("../../../server-web/composables/console-info-feed-summary-runner-controller", () => ({
  createConsoleInfoFeedSummaryRunnerController: vi.fn(() => infoFeedSummaryRunnerMock),
}));

vi.mock("../../../server-web/composables/console-info-feed-expert-feedback-controller", () => ({
  createConsoleInfoFeedExpertFeedbackController: vi.fn(() => infoFeedExpertFeedbackMock),
}));

vi.mock("../../../server-web/lib/workspaces-client", () => workspacesClientMock);

vi.mock("../../../server-web/composables/console-workspace-cloud-drive-controller", () => ({
  useWorkspaceCloudDriveController: vi.fn(() => workspaceCloudDriveMock),
}));

vi.mock("../../../server-web/composables/console-workspace-checkpoint-controller", () => ({
  useWorkspaceCheckpointController: vi.fn(() => workspaceCheckpointMock),
}));

vi.mock("../../../server-web/composables/console-workspace-local-directory-controller", () => ({
  useWorkspaceLocalDirectoryController: vi.fn(() => workspaceLocalDirectoryMock),
}));

vi.mock("../../../server-web/composables/console-workspace-codespace-controller", () => ({
  useWorkspaceCodespaceController: vi.fn(() => workspaceCodespaceMock),
}));

vi.mock("../../../server-web/composables/console-workspace-management-controller", () => ({
  useWorkspaceManagementController: vi.fn(() => workspaceManagementMock),
}));

vi.mock("../../../server-web/composables/console-workspace-session-controller", () => ({
  useWorkspaceSessionController: vi.fn(() => workspaceSessionMock),
}));

vi.mock("../../../server-web/composables/console-shell-preferences", () => ({
  useConsoleShellPreferences: vi.fn(() => ({
    ...consolePreferencesState,
    applyTheme: vi.fn(),
    applyLanguage: vi.fn(),
    cycleTheme: vi.fn(),
    setLanguage: vi.fn(),
    toggleLanguage: vi.fn(),
    tt: vi.fn((value: string) => value),
  })),
}));

vi.mock("../../../server-web/composables/console-shell-public-context", () => ({
  pickServerConsoleShellPublicContext: vi.fn(() => publicConsoleContext),
}));

vi.mock("../../../server-web/composables/console-shell-route-controller", () => ({
  createConsoleShellRouteController: vi.fn(() => routeControllerState),
}));

vi.mock("../../../server-web/composables/console-shell-page-refresh-controller", () => ({
  createConsoleShellPageRefreshController: vi.fn(() => pageRefreshControllerState),
}));

vi.mock("../../../server-web/composables/console-shell-agent-retrieval-context", () => ({
  pickAgentRetrievalShellContext: vi.fn(() => ({ kind: "agentRetrieval" })),
}));

vi.mock("../../../server-web/composables/console-shell-approval-flow-context", () => ({
  pickApprovalFlowShellContext: vi.fn(() => ({ kind: "approval" })),
}));

vi.mock("../../../server-web/composables/console-shell-debug-context", () => ({
  pickDebugShellContext: vi.fn(() => ({ kind: "debug" })),
}));

vi.mock("../../../server-web/composables/console-shell-feed-context", () => ({
  pickFeedShellContext: vi.fn(() => ({ kind: "feed" })),
}));

vi.mock("../../../server-web/composables/console-shell-knowledge-context", () => ({
  pickKnowledgeShellContext: vi.fn(() => ({ kind: "knowledge" })),
}));

vi.mock("../../../server-web/composables/console-shell-tool-management-context", () => ({
  pickToolManagementShellContext: vi.fn(() => ({ kind: "toolManagement" })),
}));

vi.mock("../../../server-web/composables/useConsole", () => ({
  useConsole: vi.fn(() => consoleContextState),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: useServerConsoleShellContextMock,
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));

vi.mock("../../../server-web/composables/agentPermissionsViewContext", () => ({
  provideAgentPermissionsView: vi.fn(),
  useAgentPermissionsViewContext: vi.fn(() => agentPermissionsContextState.current),
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: vi.fn(() => feedContextState.current),
}));

vi.mock("../../../server-web/composables/console-agent-permissions-view-controller", () => ({
  useAgentPermissionsViewConsole: vi.fn(() => ({
    agentPermissionGroups: [],
    busyKey: "permissions",
    refreshAgentPermissionGroups: vi.fn(),
    saveAgentPermissionSettings: vi.fn(),
  })),
}));

import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import AgentPermissionsView from "../../../server-web/views/admin/AgentPermissionsView.vue";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import { router } from "../../../server-web/router";
import { createConsoleInfoFeedExecutionController } from "../../../server-web/composables/console-info-feed-execution-controller";
import {
  agentExploreEventLabel,
  agentExploreEventStatus,
  agentExploreHistoryPanelItemsCore,
  agentExplorePhaseLabel,
  agentExploreResultKey,
  agentExploreStepSummary,
  agentExploreTabMeta,
  agentExploreTabTitle,
  shortId,
} from "../../../server-web/composables/console-agent-explore-presentation";
import { createConsoleNavigationController } from "../../../server-web/composables/console-navigation-controller";
import { useServerConsoleShell } from "../../../server-web/composables/useServerConsoleShell";
import { useWorkspacesConsole } from "../../../server-web/composables/useWorkspacesConsole";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type { InfoFeedClarification, InfoFeedRunState } from "../../../server-web/types/app";

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

function makeRoute(path: string, viewId: string, options: { adminView?: string; params?: Record<string, unknown> } = {}) {
  return {
    fullPath: path,
    meta: {
      viewId,
      ...(options.adminView ? { adminView: options.adminView } : {}),
    },
    params: options.params || {},
    path,
  } as any;
}

function makeInfoFeedRun(query = "原始问题") {
  return JSON.parse(JSON.stringify(createInfoFeedRunState(query, {
    attachments: [],
    summaryDefaults: {
      contextProfileId: "ctx-default",
      maxTokens: 1800,
      modelAlias: "model-default",
      temperature: 0.2,
    },
  })));
}

function makeInfoFeedFixture(overrides: Record<string, unknown> = {}) {
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "",
    maxTokens: 1800,
    temperature: 0.2,
  });
  const infoFeedRunSequence = ref(0);
  const error = ref("");

  const options = {
    agentExploreConfiguredLimit: ref(20),
    agentExploreConfiguredMaxIterations: ref(3),
    agentExploreThinkingParameters: vi.fn(() => ({ mode: "deep" })),
    applyInfoFeedSummaryAnswer: vi.fn((run: InfoFeedRunState, answer: string, fallback: boolean, errorText = "") => {
      run.summary.answer = answer;
      run.summary.fallback = fallback;
      run.summary.error = errorText;
    }),
    archiveInfoFeedExpertFeedback: vi.fn((run: InfoFeedRunState, clarification: InfoFeedClarification, option: { optionId: string; label: string; description: string; followUpQuestion: string }) => ({
      feedbackId: "feedback-1",
      anchor: clarification.anchor,
      createdAt: "2026-06-05T00:00:00.000Z",
      followUpQuestion: option.followUpQuestion,
      prompt: clarification.prompt,
      questionId: clarification.questionId,
      reason: clarification.reason,
      selectedDescription: option.description,
      selectedLabel: option.label,
      selectedOptionId: option.optionId,
      sourceQuery: run.query,
      syncError: "",
      syncStatus: "pending",
      syncedAt: "",
    })),
    buildInfoFeedAgentQuery: vi.fn((run: InfoFeedRunState) => `agent:${run.query}`),
    buildInfoFeedSourceSearchQuery: vi.fn((run: InfoFeedRunState) => `source:${run.query}`),
    buildInfoFeedSummaryQuestion: vi.fn((run: InfoFeedRunState) => `summary:${run.query}`),
    canReadKnowledge: ref(true),
    createInfoFeedRun: vi.fn((query: string) => makeInfoFeedRun(query)),
    fallbackInfoFeedSummary: vi.fn((run: InfoFeedRunState) => `fallback:${run.query}`),
    infoFeedAgentExpertGuidance: vi.fn(() => ({})),
    infoFeedAgentProgressFromResult: vi.fn(() => 100),
    infoFeedAgentRecentTurns: vi.fn(() => []),
    infoFeedCanFollowUp: ref(false),
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedKeywordCache: new Map<string, { response: never; cachedAt: number }>(),
    infoFeedParentRunSnapshot: ref<InfoFeedRunState | null>(null),
    infoFeedReadyForSummary: ref(true),
    infoFeedRunEvidenceRefs: vi.fn(() => ["evidence-1"]),
    infoFeedRunSequence,
    resetInfoFeedRunForContinuation: vi.fn((run: InfoFeedRunState, question: string) => {
      run.query = `${run.query} -> ${question}`;
    }),
    selectedInfoFeedContextProfile: ref({ value: "ctx-default" }),
    selectedInfoFeedModel: ref({ value: "model-default", enabled: true }),
    selectedThinkingMode: ref("deep"),
    upsertInfoFeedHistory: vi.fn(),
    error,
    ...overrides,
  };

  return {
    controller: createConsoleInfoFeedExecutionController(options as any),
    error,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedRunSequence,
    options,
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    entryId: "service-1",
    serviceId: "service-1",
    serviceName: "service-1",
    displayName: "service-1",
    description: "",
    mode: "connected",
    startupPolicy: "external-only",
    source: "configured",
    sourceLabel: "配置",
    filePath: "/tmp/external-services.json",
    requiredOperations: ["knowledge.search"],
    scriptCount: 1,
    validationStatus: "valid",
    validation: { ok: true, errors: [], warnings: [] },
    externalMcp: { tools: ["search"] },
    upstreamTargetLabelText: "127.0.0.1:8787",
    upstreamTargetDetailText: "endpoint",
    sourceLabelText: "配置 / service-1",
    discoveryLabelText: "MCP 服务",
    discoveryTone: "success",
    discoveryRegistrationLabelText: "工具已发现",
    discoveryRegistrationTone: "success",
    heartbeatText: "Latest: -",
    heartbeatRefreshing: false,
    ...overrides,
  };
}

function createExternalServicesController(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as any[] | undefined) ?? [
    createService(),
    createService({
      serviceId: "http-1",
      displayName: "http-1",
      discoveryLabelText: "HTTP / HTTPS 服务",
      discoveryTone: "info",
      discoveryRegistrationLabelText: "端点已注册",
      discoveryRegistrationTone: "info",
      externalMcp: { tools: [] },
    }),
  ];

  return {
    configuredCount: services.filter((service) => service.source === "configured").length,
    presetCount: services.filter((service) => service.source === "preset").length,
    validServiceCount: services.filter((service) => service.validationStatus === "valid").length,
    discoveredServiceCount: services.length,
    mcpToolCount: services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
    configEditorOpen: false,
    configEditorMode: "add",
    configEditorTitle: "添加服务",
    configEditorSubtitle: "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configStatusTone: "success",
    configStatusLabel: "Valid",
    loadError: "",
    actionError: "",
    actionMessage: "",
    discoveryCacheUpdatedAtLabel: "2026-06-04 11:30",
    configText: "{\n  \"serviceId\": \"\"\n}",
    configDraft: {},
    requiredScopesText: "knowledge:read",
    validationErrors: [],
    validationWarnings: [],
    loading: false,
    saving: false,
    verifying: false,
    dirty: false,
    services,
    modeOptions: [{ value: "connected", label: "connected" }],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [{ value: "mcp", label: "MCP 服务" }],
    mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: "openai-compatible",
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    riskOptions: [{ value: "read_only", label: "read_only" }],
    isCloudDriveServiceDraft: false,
    isLlmServiceDraft: false,
    showCustomUpstreamType: false,
    upstreamTypeSelectValue: "mcp",
    customUpstreamTypeValue: "",
    activeConfigSummary: {},
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    closeConfigEditor: vi.fn(),
    refreshExternalServices: vi.fn().mockResolvedValue(undefined),
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    refreshRuntime: vi.fn().mockResolvedValue(undefined),
    updateRootField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateBindingField: vi.fn(),
    updateRequiredScopes: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    onConfigInput: vi.fn(),
    serviceSourceDetail: (service: { sourceLabelText?: string }) => service.sourceLabelText || "",
    upstreamTargetLabel: (service: { upstreamTargetLabelText?: string }) => service.upstreamTargetLabelText || "",
    upstreamTargetDetailLabel: (service: { upstreamTargetDetailText?: string }) => service.upstreamTargetDetailText || "",
    serviceDiscoveryLabel: (service: { discoveryLabelText?: string }) => service.discoveryLabelText || "",
    serviceDiscoveryTone: (service: { discoveryTone?: string }) => service.discoveryTone || "success",
    serviceDiscoveryRegistrationLabel: (service: { discoveryRegistrationLabelText?: string }) => service.discoveryRegistrationLabelText || "",
    serviceDiscoveryRegistrationTone: (service: { discoveryRegistrationTone?: string }) => service.discoveryRegistrationTone || "success",
    serviceHeartbeatLastAtLabel: (service: { heartbeatText?: string }) => service.heartbeatText || "",
    isServiceHeartbeatRefreshing: (service: { heartbeatRefreshing?: boolean }) => !!service.heartbeatRefreshing,
    ...overrides,
  };
}

function createFeedContext(overrides: Record<string, unknown> = {}) {
  return {
    agentSelectorOptions: ref([{ label: "模型 A", value: "model-a" }]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([{ label: "32k", value: "32k" }]),
    handleInfoFeedAttachmentFiles: vi.fn(),
    infoFeedAttachments: ref([]),
    infoFeedCurrentRun: ref(null),
    infoFeedForm: ref({
      contextProfileId: "32k",
      maxTokens: 4096,
      modelAlias: "",
      query: "",
      temperature: 0.2,
    }),
    infoFeedInputPlaceholder: ref("输入问题"),
    infoFeedModelOptions: ref([{ label: "模型 A", value: "model-a" }]),
    infoFeedSubmitLabel: ref("开始"),
    removeInfoFeedAttachment: vi.fn(),
    runInfoFeed: vi.fn(),
    saveSettings: vi.fn(),
    selectedInfoFeedModel: ref({ enabled: true, label: "模型 A" }),
    settingsDraft: ref({
      agentExploreDefaults: {
        answerTemplate: "",
        contextProfileId: "32k",
        continuationPrompt: "",
        limit: 3,
        maxIterations: 3,
        maxTokens: 4096,
        reviewFusionMaxTokens: 1024,
        reviewFusionModelAlias: "",
        reviewFusionSystemPrompt: "",
        reviewFusionTemperature: 0.1,
        systemPrompt: "",
        temperature: 0.2,
        thinkingMode: "balanced",
        toolChoice: "auto",
        toolPolicyPrompt: "",
      },
    }),
    thinkingModeOptionBarOptions: ref([{ label: "Balanced", value: "balanced" }]),
    ...overrides,
  };
}

function stubChild(name: string) {
  return defineComponent({
    name,
    setup(_, { slots }) {
      return () => h("div", { class: `${name}-stub` }, slots.default?.());
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
  externalServicesControllerMock.current = createExternalServicesController();
  agentPermissionsContextState.current = {
    activeSection: "groups",
    busyKey: "permissions",
  };
  feedContextState.current = createFeedContext();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("console agent explore presentation", () => {
  it("formats ids, labels, and history items across empty and populated inputs", () => {
    expect(shortId("")).toBe("--");
    expect(shortId("abc")).toBe("abc");
    expect(shortId("abcdefghijklmnopqr")).toBe("abcdefgh…opqr");

    expect(agentExplorePhaseLabel("tool_calling")).toBe("调用工具");
    expect(agentExplorePhaseLabel("custom")).toBe("custom");
    expect(agentExplorePhaseLabel("")).toBe("运行中");

    expect(agentExploreStepSummary({ phase: "tool_result", toolCalls: [1], toolResults: [1, 2] })).toBe("工具返回 · 工具 1 · 返回 2");
    expect(agentExploreStepSummary({ status: "failed" })).toBe("失败");

    expect(agentExploreResultKey({ iteration: 2 }, { tool: "lookup", startedAt: "1", completedAt: "2" }, 3)).toBe("2:lookup:1:2:3");

    expect(agentExploreTabTitle({ runId: "draft:1", query: "   ", status: "idle" } as any)).toBe("新会话");
    expect(agentExploreTabTitle({ runId: "run-1", query: "", status: "idle" } as any)).toBe("未命名探索");
    expect(agentExploreTabMeta({ runId: "draft:1", query: "", status: "idle" } as any)).toBe("草稿");
    expect(agentExploreTabMeta({ runId: "run-1", query: "", status: "running" } as any)).toContain("running · run-1");
    expect(agentExploreEventLabel({ label: "事件标签" })).toBe("事件标签");
    expect(agentExploreEventLabel({ type: "更新" })).toBe("更新");
    expect(agentExploreEventStatus({ status: "failed" })).toBe("failed");
    expect(agentExploreEventStatus({})).toBe("running");

    const items = agentExploreHistoryPanelItemsCore(
      [
        { runId: "run-1", status: "running", answerPreview: "摘要 A" } as any,
        { runId: "run-2", status: "", answerPreview: "" } as any,
      ],
      {
        activeTabId: "run-2",
        isBusy: (session) => session.runId === "run-1",
        sessionLabel: (session) => `会话 ${session.runId}`,
      },
    );

    expect(items).toEqual([
      {
        id: "run-1",
        title: "会话 run-1",
        meta: "running · run-1",
        preview: "摘要 A",
        active: false,
        disabled: true,
        deleteLabel: "删除历史会话 会话 run-1",
      },
      {
        id: "run-2",
        title: "会话 run-2",
        meta: "unknown · run-2",
        preview: "",
        active: true,
        disabled: false,
        deleteLabel: "删除历史会话 会话 run-2",
      },
    ]);
  });
});

describe("router index", () => {
  it("registers the expected external service and agent permissions routes", () => {
    const externalServices = router.getRoutes().find((route) => route.path === "/external-services/:tab");
    const agentPermissions = router.getRoutes().find((route) => route.path === "/admin/agent-permissions");

    expect(externalServices?.meta).toMatchObject({ viewId: "externalServices" });
    expect(agentPermissions?.meta).toMatchObject({ viewId: "admin", adminView: "agentPermissions" });
    expect(router.getRoutes().find((route) => route.path === "/admin")?.redirect).toBe("/admin/storage");
  });

  it("redirects invalid route tabs through beforeEnter and global guards", async () => {
    const externalServices = router.getRoutes().find((route) => route.path === "/external-services/:tab");
    const beforeEnter = externalServices?.beforeEnter as any;
    expect(beforeEnter?.({ params: { tab: "list" } } as any, {} as any, vi.fn())).toBe(true);
    expect(beforeEnter?.({ params: { tab: "bad" } } as any, {} as any, vi.fn())).toBe("/external-services/list");

    await router.push("/external-services/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/external-services/list");
  });
});

describe("console-info-feed-execution-controller", () => {
  it("rejects blank queries and permission/model gates", async () => {
    const blankFixture = makeInfoFeedFixture({
      infoFeedForm: ref({ query: "   ", modelAlias: "", contextProfileId: "", maxTokens: 1800, temperature: 0.2 }),
      selectedInfoFeedModel: ref({ value: "model-default", enabled: false }),
    });
    await blankFixture.controller.runInfoFeed();
    expect(blankFixture.error.value).toBe("请输入信息流问题。");

    const modelFixture = makeInfoFeedFixture({
      infoFeedForm: ref({ query: "需要知识库", modelAlias: "", contextProfileId: "", maxTokens: 1800, temperature: 0.2 }),
      selectedInfoFeedModel: ref({ value: "model-default", enabled: false }),
    });
    await modelFixture.controller.runInfoFeed();
    expect(modelFixture.error.value).toBe("请选择模型库中已配置且支持智能体调用的模型。");

    const permissionFixture = makeInfoFeedFixture({
      infoFeedForm: ref({ query: "需要知识库", modelAlias: "", contextProfileId: "", maxTokens: 1800, temperature: 0.2 }),
      canReadKnowledge: ref(false),
    });
    await permissionFixture.controller.runInfoFeed();
    expect(permissionFixture.error.value).toBe("当前账号没有知识库读取权限。");
  });

  it("continues, retries, and resumes paused runs", async () => {
    const run = makeInfoFeedRun("起始问题");
    const fixture = makeInfoFeedFixture({
      infoFeedCurrentRun: ref(run),
      infoFeedCanFollowUp: ref(true),
      selectedInfoFeedModel: ref({ value: "model-active", enabled: true }),
    });

    await fixture.controller.continueInfoFeedCurrentRun("补充问题");
    expect(fixture.options.resetInfoFeedRunForContinuation).toHaveBeenCalledWith(run, "补充问题");
    expect(fixture.options.upsertInfoFeedHistory).toHaveBeenCalledWith(run);
    expect(infoFeedTrackControllerMock.runInfoFeedKeywordTrack).toHaveBeenCalled();
    expect(infoFeedTrackControllerMock.runInfoFeedAgentTrack).toHaveBeenCalled();
    expect(infoFeedSummaryRunnerMock.runInfoFeedSummaryAgent).toHaveBeenCalled();

    const pausedAgentRun = makeInfoFeedRun("暂停的运行");
    pausedAgentRun.pausedForModelSelection = "agent" as any;
    fixture.infoFeedCurrentRun.value = pausedAgentRun;
    await fixture.controller.continueInfoFeedAfterModelSelection();

    const retryRun = makeInfoFeedRun("重试的运行");
    retryRun.pausedForRetry = "summary" as any;
    fixture.infoFeedCurrentRun.value = retryRun;
    await fixture.controller.continueInfoFeedAfterRetry();
    expect(retryRun.summary.answer).toBe("");
    expect(retryRun.summary.error).toBe("");
    expect(retryRun.summary.fallback).toBe(false);
  });

  it("archives clarification choices and ignores unfinished runs", async () => {
    const run = makeInfoFeedRun("澄清问题");
    run.summary.status = "completed";
    run.clarification = {
      anchor: "anchor-1",
      options: [],
      prompt: "请进一步说明",
      questionId: "q-1",
      reason: "需要更多信息",
      status: "open",
    } as any;
    const fixture = makeInfoFeedFixture({
      infoFeedCurrentRun: ref(run),
    });

    await fixture.controller.chooseInfoFeedClarification({
      optionId: "opt-1",
      label: "补充上下文",
      description: "补充更多上下文",
      followUpQuestion: "补充上下文？",
    } as any);
    expect(fixture.options.archiveInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);
    expect(infoFeedExpertFeedbackMock.syncInfoFeedExpertFeedback).toHaveBeenCalledTimes(1);
    expect(fixture.options.resetInfoFeedRunForContinuation).toHaveBeenCalledWith(run, "补充上下文？");

    run.summary.status = "running";
    fixture.options.archiveInfoFeedExpertFeedback.mockClear();
    await fixture.controller.chooseInfoFeedClarification({
      optionId: "opt-2",
      label: "忽略",
      description: "",
      followUpQuestion: "",
    } as any);
    expect(fixture.options.archiveInfoFeedExpertFeedback).toHaveBeenCalledTimes(0);
  });
});

describe("useServerConsoleShell", () => {
  it("exposes shell contexts, route labels, and page refresh wiring", () => {
    const shell = mountComposable(() => useServerConsoleShell());

    expect(shell.themeMode.value).toBe("dark");
    expect(shell.languageMode.value).toBe("zh-CN");
    expect(shell.activeRouteView.value).toBe("admin");
    expect(shell.activeRouteAdminView.value).toBe("toolList");
    expect(shell.localizedViewTitle.value).toBe("工具列表");
    expect(shell.localizedExternalServiceTabLabel({ id: "list", label: "fallback" })).toBe("fallback");
    expect(shell.serviceUrl.value).toBe("http://localhost:8787");
    expect(shell.serviceStatusLabel.value).toBe("在线");
    expect(shell.pageRefreshAriaLabel.value).toBe("刷新页面");
    expect(shell.refreshCurrentPage).toBe(pageRefreshControllerState.refreshCurrentPage);
    expect(shell.agentRetrievalConsole).toEqual({ kind: "agentRetrieval" });
    expect(shell.feedConsole).toEqual({ kind: "feed" });
  });
});

describe("useWorkspacesConsole", () => {
  it("loads workspace data, reacts to selection, and routes panel toggles", async () => {
    workspacesClientMock.listWorkspaceSummaries.mockResolvedValueOnce({
      workspaces: [
        { workspaceId: "ws-1", title: "Alpha", status: "active" },
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

    const workspacesConsole = mountComposable(() => useWorkspacesConsole());
    await nextTick();

    workspacesClientMock.listWorkspaceSummaries.mockClear();
    workspacesClientMock.listWorkspaceSessions.mockClear();
    workspacesClientMock.getWorkspaceChainBundle.mockClear();

    await workspacesConsole.load();
    expect(workspacesClientMock.listWorkspaceSummaries).toHaveBeenCalledTimes(1);
    expect(workspacesClientMock.listWorkspaceSessions).toHaveBeenCalledTimes(1);
    expect(workspacesConsole.workspaces.value).toHaveLength(2);
    expect(workspacesConsole.workspaceOptions.value).toEqual([
      { value: "ws-1", label: "Alpha" },
      { value: "ws-2", label: "Beta" },
    ]);
    expect(workspacesConsole.statusTone("active")).toBe("success");
    expect(workspacesConsole.statusTone("archived")).toBe("neutral");
    expect(workspacesConsole.statusTone("draft")).toBe("info");

    workspacesConsole.selectedId.value = "ws-1";
    await nextTick();
    await nextTick();
    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("ws-1");
    expect(workspaceLocalDirectoryMock.setLocalDirectoryMountData).toHaveBeenCalledWith({ id: "local-dirs-1" });
    expect(workspaceCodespaceMock.setCodespaceData).toHaveBeenCalledWith({ id: "codespace-1" });
    expect(workspaceCheckpointMock.loadWorkspaceCheckpoints).toHaveBeenCalledWith("ws-1");

    expect(workspacesConsole.isWorkspaceExpanded({ workspaceId: "ws-1" } as any)).toBe(true);
    expect(workspacesConsole.workspaceExpansionSlotId({ workspaceId: "ws-2" } as any)).toBe("workspace-expansion-ws-2");

    workspacesConsole.openLocalDir();
    workspacesConsole.openCloudDrive();
    workspacesConsole.openCodespace();
    expect(workspacesConsole.panel.value).toBe("codespace");

    workspacesConsole.panel.value = "detail" as any;
    await nextTick();
    expect(workspacesConsole.isWorkspaceExpanded({ workspaceId: "ws-1" } as any)).toBe(false);

    await workspacesConsole.loadChain("ws-2");
    expect(workspacesClientMock.getWorkspaceChainBundle).toHaveBeenCalledWith("ws-2");
  });
});

describe("ExternalServicesView", () => {
  const ConfigFloatingPanelStub = defineComponent({
    name: "ConfigFloatingPanel",
    props: {
      open: Boolean,
      title: String,
      subtitle: String,
      statusTone: String,
      statusLabel: String,
      verifying: Boolean,
    },
    emits: ["close", "verify"],
    setup(props, { emit, slots }) {
      return () =>
        props.open
          ? h("section", { class: "config-panel-stub" }, [
              h("h3", props.title || ""),
              h("button", { class: "verify-btn", type: "button", onClick: () => emit("verify") }, "校验"),
              h("button", { class: "close-btn", type: "button", onClick: () => emit("close") }, "关闭"),
              slots.default?.(),
            ])
          : null;
    },
  });
  const HelpTooltipStub = stubChild("HelpTooltip");
  const StatusPillStub = stubChild("StatusPill");
  const BinaryCheckboxStub = defineComponent({
    name: "BinaryCheckbox",
    props: { modelValue: Boolean, disabled: Boolean, label: String },
    emits: ["update:modelValue", "update:model-value", "change"],
    setup(props, { emit }) {
      return () =>
        h("button", {
          class: "binary-checkbox-stub",
          type: "button",
          disabled: !!props.disabled,
          onClick: () => {
            const next = !props.modelValue;
            emit("update:modelValue", next);
            emit("update:model-value", next);
            emit("change", next);
          },
        }, props.label || "");
    },
  });

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

  it("renders the empty state and a normal service table", async () => {
    externalServicesControllerMock.current = createExternalServicesController({ services: [] });
    const emptyWrapper = mountExternalServicesView();
    expect(emptyWrapper.find(".empty-state").exists()).toBe(true);
    expect(emptyWrapper.text()).toContain("暂无外部服务");

    externalServicesControllerMock.current = createExternalServicesController();
    const wrapper = mountExternalServicesView();
    expect(wrapper.findAll(".external-service-table-row")).toHaveLength(2);
    expect(wrapper.findAll(".external-service-table-row")[0].text()).toContain("service-1");
    expect(wrapper.findAll(".external-service-table-row")[1].text()).toContain("http-1");
  });

  it("opens edit flow, copies upstream value, and manages the tool popover", async () => {
    const controller = createExternalServicesController({
      services: [createService({ externalMcp: { tools: ["search", { toolId: "list" }] } })],
    });
    externalServicesControllerMock.current = controller;
    const wrapper = mountExternalServicesView();

    await wrapper.get("button").trigger("click");
    expect(controller.openAddServiceConfig).toHaveBeenCalled();

    const row = wrapper.find(".external-service-table-row");
    const buttons = row.findAll("button");
    const editButton = buttons.find((button) => button.text() === "修改配置");
    await editButton?.trigger("click");
    expect(controller.openEditServiceConfig).toHaveBeenCalledTimes(1);

    const toolButton = row.find(".external-service-tool-list-button");
    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);
    expect(wrapper.find(".external-service-tool-popover").text()).toContain("list");
  });
});

describe("AgentPermissionsView", () => {
  const AgentPermissionGroupsPanelStub = stubChild("AgentPermissionGroupsPanel");
  const AuthorizationGovernanceCardStub = stubChild("AuthorizationGovernanceCard");
  const GrantToolRulePanelStub = stubChild("GrantToolRulePanel");
  const ToolGrantCreateCardStub = stubChild("ToolGrantCreateCard");
  const ToolGrantListCardStub = stubChild("ToolGrantListCard");
  const ToolPolicyPreviewPanelStub = stubChild("ToolPolicyPreviewPanel");

  function mountAgentPermissionsView() {
    return mount(AgentPermissionsView, {
      global: {
        stubs: {
          AgentPermissionGroupsPanel: AgentPermissionGroupsPanelStub,
          AuthorizationGovernanceCard: AuthorizationGovernanceCardStub,
          GrantToolRulePanel: GrantToolRulePanelStub,
          ToolGrantCreateCard: ToolGrantCreateCardStub,
          ToolGrantListCard: ToolGrantListCardStub,
          ToolPolicyPreviewPanel: ToolPolicyPreviewPanelStub,
        },
      },
    });
  }

  it("switches between groups, tokens, governance, and verify panes", async () => {
    const wrapper = mountAgentPermissionsView();
    expect(wrapper.find(".AgentPermissionGroupsPanel-stub").exists()).toBe(true);

    const tabs = wrapper.findAll('[role="tab"]');
    await tabs[1].trigger("click");
    expect(wrapper.find(".ToolGrantCreateCard-stub").exists()).toBe(true);
    expect(wrapper.find(".ToolGrantListCard-stub").exists()).toBe(true);
    expect(wrapper.find(".GrantToolRulePanel-stub").exists()).toBe(true);

    await tabs[2].trigger("click");
    expect(wrapper.find(".AuthorizationGovernanceCard-stub").exists()).toBe(true);

    await tabs[3].trigger("click");
    expect(wrapper.find(".ToolPolicyPreviewPanel-stub").exists()).toBe(true);
  });
});

describe("InfoFeedComposerPanel", () => {
  const BrowseSelectButtonStub = defineComponent({
    name: "BrowseSelectButton",
    props: { buttonClass: String, buttonText: String, kind: String, multiple: Boolean },
    emits: ["select"],
    setup(props, { emit, slots }) {
      return () =>
        h(
          "button",
          {
            class: ["browse-select-stub", props.buttonClass || ""],
            type: "button",
            onClick: () => emit("select", [new File(["x"], "attachment.txt", { type: "text/plain" })]),
          },
          slots.default?.(),
        );
    },
  });

  const AgentModelOptionBarStub = defineComponent({
    name: "AgentModelOptionBar",
    props: { modelValue: String, label: String, placeholder: String, includeEmpty: Boolean, options: Array },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () =>
        h("label", { class: "agent-model-option-bar-stub" }, [
          h("select", {
            value: props.modelValue || "",
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          }),
        ]);
    },
  });

  const OptionBarStub = defineComponent({
    name: "OptionBar",
    props: { modelValue: [String, Number], label: String, options: Array },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () =>
        h("label", { class: "option-bar-stub" }, [
          h("select", {
            value: props.modelValue == null ? "" : String(props.modelValue),
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          }),
        ]);
    },
  });

  const ConfigFoldCardStub = defineComponent({
    name: "ConfigFoldCard",
    props: { title: String, open: Boolean },
    setup(_, { slots }) {
      return () => h("section", { class: "config-fold-card-stub" }, slots.default?.());
    },
  });

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

  it("binds attachments, opens advanced settings, and saves the form", async () => {
    feedContextState.current = createFeedContext({
      infoFeedAttachments: ref([
        { id: "a", name: "first.txt", status: "running" },
      ]),
      infoFeedForm: ref({
        contextProfileId: "32k",
        maxTokens: 4096,
        modelAlias: "",
        query: "问题",
        temperature: 0.2,
      }),
    });

    const wrapper = mountFeedPanel();
    expect(wrapper.text()).toContain("first.txt");
    await wrapper.get("textarea").setValue("新问题");
    expect((feedContextState.current.infoFeedForm as any).value.query).toBe("新问题");

    await wrapper.get(".info-feed-attachment-button").trigger("click");
    expect(feedContextState.current.handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await wrapper.get(".dialog-close-button").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    await wrapper.get(".info-feed-advanced-form").trigger("submit");
    expect(feedContextState.current.saveSettings).toHaveBeenCalledTimes(1);
  });
});
