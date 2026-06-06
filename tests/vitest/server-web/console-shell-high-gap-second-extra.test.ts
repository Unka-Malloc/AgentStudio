// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import { router } from "../../../server-web/router";
import { useConsole } from "../../../server-web/composables/useConsole";

function makeRef<T>(value: T) {
  return { value, __v_isRef: true } as { value: T; __v_isRef: true };
}

function createLooseController(overrides: Record<string, unknown> = {}) {
  const bucket: Record<string | symbol, unknown> = { ...overrides };
  return new Proxy(bucket, {
    get(target, key) {
      if (key in target) return target[key];
      const fallback: any = vi.fn(() => undefined);
      fallback.value = undefined;
      target[key] = fallback;
      return fallback;
    },
  });
}

const routerState = vi.hoisted(() => ({
  route: null as any,
  push: vi.fn(),
}));

const mockBrowserEffects = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createConsoleTargetHighlightController: vi.fn(),
  downloadTextFile: vi.fn(),
  notifyConsoleAction: vi.fn(),
}));

const mockBrowserState = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(),
  clearBrowserCacheStorage: vi.fn(),
  clearIndexedDbDatabases: vi.fn(),
  unregisterServiceWorkers: vi.fn(),
}));

const mockKnowledgeLogController = vi.hoisted(() => ({
  filteredKnowledgeLogRows: makeRef([] as any[]),
  syncKnowledgeLogTableScrollLeft: vi.fn(),
}));

const mockAgentSelectorController = vi.hoisted(() => ({
  agentSelectorOptions: makeRef([{ label: "模型 A", value: "model-a", selectable: true }]),
  cacheAgentModelOptionLabels: vi.fn(),
}));

const mockAgentExploreStateController = vi.hoisted(() => ({
  agentExploreForm: makeRef({ modelAlias: "" }),
  agentExploreResult: makeRef({}),
}));

const mockFeatureAccessController = vi.hoisted(() => ({
  activeConsoleFeatureIds: makeRef(["knowledge-core", "agent-management", "maintenance-agent-runbooks", "agent-gateway"]),
  hasAnyFeature: vi.fn(() => true),
  hasFeature: vi.fn(() => true),
  isAdminViewEnabled: vi.fn(() => true),
  visibleDebugTabs: makeRef([{ id: "knowledgeRecall", label: "知识召回" }]),
  visibleKnowledgeTabs: makeRef([
    { id: "management", label: "知识归档" },
    { id: "wordCloud", label: "词云" },
  ]),
}));

const mockNavigationState = vi.hoisted(() => {
  const currentView = makeRef("dashboard");
  const adminView = makeRef("jobs");
  const knowledgeTab = makeRef("management");
  const knowledgeManagementPanel = makeRef("sources");
  const debugTab = makeRef("knowledgeRecall");
  const drawerOpen = makeRef(false);
  const drawerTab = makeRef("discovery");
  const sideNavOpen = makeRef(false);
  const externalServiceTab = makeRef("list");
  const visibleDebugTabs = makeRef([{ id: "knowledgeRecall", label: "知识召回" }]);
  const visibleKnowledgeTabs = makeRef([
    { id: "management", label: "知识归档" },
    { id: "wordCloud", label: "词云" },
  ]);

  return {
    adminView,
    bindNavigationRouter: vi.fn(),
    closeDrawer: vi.fn(),
    closeSideNavOverlay: vi.fn(),
    currentView,
    debugTab,
    drawerOpen,
    drawerTab,
    ensureKnowledgeTabState: vi.fn(),
    externalServiceTab,
    isKnownDebugRouteTab: vi.fn(() => true),
    jumpToKnowledgeFileImport: vi.fn(),
    knowledgeManagementPanel,
    knowledgeTab,
    openAdmin: vi.fn(),
    openAgentConfigurationAlert: vi.fn(),
    openDebugTab: vi.fn(),
    openDrawer: vi.fn(),
    openExternalServiceTab: vi.fn(),
    openKnowledgeManagementPanel: vi.fn(),
    openKnowledgeTab: vi.fn(),
    refreshSystemStatusLogs: vi.fn(),
    sideNavOpen,
    syncNavigationStateFromRoute: vi.fn((route: { meta?: { viewId?: string }; params?: Record<string, string> } = {}) => {
      const viewId = route.meta?.viewId || "dashboard";
      currentView.value = viewId as any;
      if (viewId === "admin") adminView.value = route.params?.tab || "jobs";
      if (viewId === "knowledge") knowledgeTab.value = route.params?.tab || "management";
      if (viewId === "debug") debugTab.value = route.params?.tab || "knowledgeRecall";
    }),
    switchView: vi.fn(),
    viewTitle: makeRef("控制台"),
    visibleDebugTabs,
    visibleKnowledgeTabs,
  };
});

const mockRefreshStateController = vi.hoisted(() => ({
  REFRESH_STATE_DELAY_MS: 1000,
  clearPendingRefreshState: vi.fn(),
  clearPendingRefreshStateTimer: vi.fn(),
  lastRefreshStateStartedAt: makeRef(0),
  mergeRefreshStateOptions: vi.fn((options) => options),
  normalizeRefreshStateOptions: vi.fn((options) => options),
  pendingRefreshStateOptions: makeRef({} as Record<string, unknown>),
  pendingRefreshStatePromise: makeRef(Promise.resolve(undefined)),
  pendingRefreshStateResolve: vi.fn(),
  pendingRefreshStateTimer: makeRef(null as ReturnType<typeof setTimeout> | null),
  performRefreshState: vi.fn(),
  refreshState: vi.fn(async () => undefined),
  scheduleDelayedRefreshState: vi.fn(),
}));

const mockRuntimeLifecycle = vi.hoisted(() => ({
  mountConsoleRuntime: vi.fn(),
  unmountConsoleRuntime: vi.fn(),
}));

const mockSettingsBridgeController = vi.hoisted(() => ({
  applyingRemoteConsoleDrafts: makeRef(false),
  bindSettingsDraftActions: vi.fn(),
  bindSettingsPersistenceActions: vi.fn(),
  disableMountModule: vi.fn(),
  enableMountModule: vi.fn(),
  isApplyingRemoteConsoleDrafts: makeRef(false),
  moduleAgentProfilesPayload: vi.fn(() => []),
  normalizeHttpAdapterSettings: vi.fn(),
  normalizeModelLibraryAgents: vi.fn(),
  normalizedSettingsFromServer: vi.fn(),
  reloadModules: vi.fn(),
  remoteDraftEquals: vi.fn(() => false),
  replaceSettingsDraftFromServer: vi.fn(),
  saveAgentPermissionSettings: vi.fn(),
  saveModelLibrarySettings: vi.fn(),
  saveModuleSettings: vi.fn(),
  saveMountModules: vi.fn(),
  saveSettings: vi.fn(),
  settingsDraftEquals: vi.fn(() => false),
  settingsPayloadForSave: vi.fn(() => ({})),
}));

const externalServiceClientMocks = vi.hoisted(() => ({
  getExternalServiceConfig: vi.fn(),
  refreshExternalServiceRuntime: vi.fn(),
  saveExternalServiceConfig: vi.fn(),
  verifyExternalServiceConfig: vi.fn(),
}));

const pageRefreshHandlerMock = vi.hoisted(() => vi.fn());

const useConsoleExternalServicesFixture = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof import("vue-router")>("vue-router");
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      currentRoute: {
        get value() {
          return routerState.route;
        },
      },
      push: routerState.push,
    })),
    useRoute: vi.fn(() => routerState.route),
  };
});

vi.mock("../../../server-web/composables/console-browser-state-utils", () => ({
  CLEAR_LOCAL_STATE_PARAM: "clearLocalState",
  clearBrowserCacheStorage: mockBrowserState.clearBrowserCacheStorage,
  clearBrowserLocalStateFromUrl: mockBrowserState.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: mockBrowserState.clearIndexedDbDatabases,
  unregisterServiceWorkers: mockBrowserState.unregisterServiceWorkers,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: mockBrowserEffects.confirmConsoleAction,
  copyTextToClipboard: mockBrowserEffects.copyTextToClipboard,
  createConsoleTargetHighlightController: vi.fn(() => ({
    configTargetElement: vi.fn(() => null),
    scrollToConfigTarget: vi.fn(() => Promise.resolve()),
    clearConfigTargetHighlight: vi.fn(),
  })),
  downloadTextFile: mockBrowserEffects.downloadTextFile,
  notifyConsoleAction: mockBrowserEffects.notifyConsoleAction,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({
    openExternalServiceTab: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-selection-reference-controller", () => ({
  AGENT_SELECTION_REFERENCE_LOG_LIMIT: 20,
  createConsoleAgentSelectionReferenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() => mockAgentSelectorController),
}));

vi.mock("../../../server-web/composables/console-auth-controller", () => ({
  createConsoleAuthController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-busy-controller", () => ({
  createConsoleBusyController: vi.fn(() =>
    createLooseController({
      busyKey: makeRef(""),
      clearAllBusy: vi.fn(),
      clearBusy: vi.fn(),
      isBusy: makeRef(false),
      isBusyPrefix: makeRef(false),
      setBusy: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-codex-oauth-controller", () => ({
  createConsoleCodexOAuthController: vi.fn(() =>
    createLooseController({
      beginCodexOAuthLogin: vi.fn(),
      codexOAuthLogin: vi.fn(),
      codexOAuthPollTimer: makeRef(0),
      codexOAuthStatus: makeRef("idle"),
      ensureCodexOAuthReady: vi.fn(),
      refreshCodexOAuthStatus: vi.fn(),
      startCodexOAuthPolling: vi.fn(),
      stopCodexOAuthPolling: vi.fn(),
    }),
  ),
}));

vi.mock("../../../server-web/composables/console-client-controller", () => ({
  createConsoleClientController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-layout-controller", () => ({
  createConsoleAgentExploreLayoutController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-output-controller", () => ({
  createConsoleAgentExploreOutputController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-session-controller", () => ({
  createConsoleAgentExploreSessionController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
  createConsoleAgentExploreStateController: vi.fn(() => mockAgentExploreStateController),
}));

vi.mock("../../../server-web/composables/console-context-compiler-controller", () => ({
  createConsoleContextCompilerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-discovery-controller", () => ({
  createConsoleDiscoveryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-expert-rules-controller", () => ({
  createConsoleExpertRulesController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn(() => mockFeatureAccessController),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-path-picker-action-controller", () => ({
  createConsolePathPickerActionController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-path-picker-controller", () => ({
  createConsolePathPickerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-runtime-mount-controller", () => ({
  createConsoleRuntimeMountController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-dashboard-alert-controller", () => ({
  createConsoleDashboardAlertController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-info-feed-controller", () => ({
  createConsoleInfoFeedController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-evidence-controller", () => ({
  createConsoleKnowledgeEvidenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-ingest-controller", () => ({
  createConsoleKnowledgeIngestController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-job-controller", () => ({
  createConsoleJobController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-log-controller", () => ({
  createConsoleKnowledgeLogController: vi.fn(() => mockKnowledgeLogController),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
  createConsoleKnowledgeSearchPanelStateController: vi.fn(() => createLooseController()),
  createConsoleKnowledgeSearchStateController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-knowledge-review-controller", () => ({
  createConsoleKnowledgeReviewController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-maintenance-agent-controller", () => ({
  createConsoleMaintenanceAgentController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-mcp-authorization-controller", () => ({
  createConsoleMcpAuthorizationController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-model-library-controller", () => ({
  createConsoleModelLibraryController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn(() => mockNavigationState),
}));

vi.mock("../../../server-web/composables/console-option-bar-controller", () => ({
  createConsoleOptionBarController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-ops-monitor-controller", () => ({
  createConsoleOpsMonitorController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-rule-authoring-controller", () => ({
  createConsoleRuleAuthoringController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  createConsoleRefreshStateController: vi.fn(() => mockRefreshStateController),
}));

vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn(() => mockRuntimeLifecycle),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-settings-bridge-controller", () => ({
  createConsoleSettingsBridgeController: vi.fn(() => mockSettingsBridgeController),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-state-event-reducer-controller", () => ({
  createConsoleStateEventReducerController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-system-log-row-controller", () => ({
  createConsoleSystemLogRowController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-tool-management-controller", () => ({
  createConsoleToolManagementController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/composables/console-word-cloud-controller", () => ({
  createConsoleWordCloudController: vi.fn(() => createLooseController()),
}));

vi.mock("../../../server-web/lib/external-services-client", () => ({
  externalServiceBindingModeOptions: [
    { value: "passthrough", label: "passthrough" },
    { value: "compile", label: "compile" },
  ],
  externalServiceBindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
  externalServiceCloudDriveModeOptions: [
    { value: "local", label: "local" },
    { value: "contract", label: "contract" },
    { value: "remote-live", label: "remote-live" },
  ],
  externalServiceCloudDriveProviderOptions: [
    { value: "icloud", label: "iCloud Drive" },
    { value: "onedrive", label: "OneDrive" },
    { value: "google-drive", label: "Google Drive" },
  ],
  externalServiceHealthCheckTypeOptions: [
    { value: "none", label: "none" },
    { value: "http", label: "http" },
  ],
  externalServiceMcpTransportOptions: [
    { value: "streamable-http", label: "streamable-http" },
    { value: "stdio", label: "stdio" },
    { value: "pact-upstream-gateway", label: "pact-upstream-gateway" },
  ],
  externalServiceModeOptions: [
    { value: "managed", label: "managed" },
    { value: "connected", label: "connected" },
    { value: "on-demand", label: "on-demand" },
  ],
  externalServiceModelProtocolOptions: [
    { value: "openai-compatible", label: "OpenAI Compatible" },
    { value: "anthropic-messages", label: "Anthropic Messages" },
    { value: "custom-json-http", label: "Custom JSON HTTP" },
  ],
  externalServiceRiskOptions: [
    { value: "read_only", label: "read_only" },
    { value: "safe_write", label: "safe_write" },
  ],
  externalServiceStartupPolicyOptions: [
    { value: "with-platform", label: "with-platform" },
    { value: "external-only", label: "external-only" },
  ],
  externalServiceUpstreamTypeOptions: [
    { value: "mcp", label: "MCP 服务" },
    { value: "acp", label: "ACP 服务" },
    { value: "llm", label: "LLM Service" },
    { value: "cloud-drive", label: "Cloud Drive Service" },
    { value: "http", label: "HTTP / HTTPS 服务" },
    { value: "https", label: "HTTP / HTTPS 服务" },
    { value: "rpc", label: "RPC 服务" },
    { value: "other", label: "其它服务" },
  ],
  getExternalServiceConfig: externalServiceClientMocks.getExternalServiceConfig,
  refreshExternalServiceRuntime: externalServiceClientMocks.refreshExternalServiceRuntime,
  saveExternalServiceConfig: externalServiceClientMocks.saveExternalServiceConfig,
  verifyExternalServiceConfig: externalServiceClientMocks.verifyExternalServiceConfig,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

const activeExternalServicesViewController = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => {
    if (activeExternalServicesViewController.value) {
      return activeExternalServicesViewController.value;
    }
    const controller = createExternalServicesViewControllerFixture();
    activeExternalServicesViewController.value = controller;
    return controller;
  }),
}));

const mountedWrappers: Array<{ unmount: () => void }> = [];

function createExternalServiceConfig(overrides: Record<string, any> = {}) {
  const base = {
    schemaVersion: 1,
    kind: "pact.external-service.config",
    serviceId: "mcp-docs",
    serviceName: "Docs MCP",
    mode: "connected",
    startupPolicy: "external-only",
    description: "",
    scripts: {},
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp",
      endpointUrl: "",
      endpointRef: "",
      rootPath: "",
      secretRef: "",
      timeoutMs: null,
      metadata: {},
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.skillHub",
      requiredScopes: ["knowledge:read"],
      risk: "read_only",
      metadata: {},
    },
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:8787/health",
      host: "127.0.0.1",
      port: 8787,
      path: "/health",
      timeoutMs: 60000,
      required: true,
    },
    metadata: {},
  };
  return {
    ...base,
    ...overrides,
    upstream: Object.prototype.hasOwnProperty.call(overrides, "upstream") ? overrides.upstream : { ...base.upstream },
    binding: Object.prototype.hasOwnProperty.call(overrides, "binding") ? overrides.binding : { ...base.binding },
    healthCheck: Object.prototype.hasOwnProperty.call(overrides, "healthCheck") ? overrides.healthCheck : { ...base.healthCheck },
    scripts: Object.prototype.hasOwnProperty.call(overrides, "scripts") ? overrides.scripts : { ...base.scripts },
    metadata: Object.prototype.hasOwnProperty.call(overrides, "metadata") ? overrides.metadata : { ...base.metadata },
  };
}

function createExternalServicesControllerFixture(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as any[]) || [];
  return {
    actionError: overrides.actionError || "",
    actionMessage: overrides.actionMessage || "",
    activeTab: "list",
    activeValidation: overrides.activeValidation || { ok: false, errors: [], warnings: [] },
    bindingModeOptions: [],
    bindingOutletOptions: [],
    closeConfigEditor: vi.fn(),
    cloudDriveModeOptions: [],
    cloudDriveProviderOptions: [],
    configDraft: makeRef(createExternalServiceConfig()),
    configEditorMode: "add",
    configEditorOpen: overrides.configEditorOpen || false,
    configEditorSubtitle: overrides.configEditorSubtitle || "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configEditorTitle: overrides.configEditorTitle || "添加服务",
    configStatusLabel: overrides.configStatusLabel || "Invalid",
    configStatusTone: overrides.configStatusTone || "danger",
    configText: overrides.configText || "{}",
    configuredCount: overrides.configuredCount || 0,
    customUpstreamTypeValue: overrides.customUpstreamTypeValue || "",
    dirty: overrides.dirty || false,
    discoveredServiceCount: overrides.discoveredServiceCount || services.length,
    discoveryCacheUpdatedAtLabel: overrides.discoveryCacheUpdatedAtLabel || "未生成",
    healthCheckTypeOptions: [],
    isCloudDriveServiceDraft: overrides.isCloudDriveServiceDraft || false,
    isLlmServiceDraft: overrides.isLlmServiceDraft || false,
    loadError: overrides.loadError || "",
    loading: overrides.loading || false,
    mcpToolCount: overrides.mcpToolCount || 0,
    mcpTransportOptions: [],
    modelProtocolOptions: [],
    modelProtocolSelectValue: overrides.modelProtocolSelectValue || "openai-compatible",
    modeOptions: [],
    onConfigInput: vi.fn(),
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: overrides.presetCount || 0,
    refreshExternalServices: vi.fn().mockResolvedValue(undefined),
    refreshRuntime: vi.fn().mockResolvedValue(undefined),
    refreshingRuntime: overrides.refreshingRuntime || false,
    registryPath: overrides.registryPath || "/tmp/pact/external-services.json",
    requiredScopesText: overrides.requiredScopesText || "knowledge:read",
    riskOptions: [],
    saveConfig: vi.fn().mockResolvedValue(undefined),
    saving: overrides.saving || false,
    serviceDiscoveryLabel: (service: any) => service.discoveryLabelText || "MCP 服务",
    serviceDiscoveryRegistrationLabel: (service: any) => service.discoveryRegistrationLabelText || "工具已发现",
    serviceDiscoveryRegistrationTone: (service: any) => service.discoveryRegistrationTone || "success",
    serviceDiscoveryTone: (service: any) => service.discoveryTone || "success",
    serviceHeartbeatLastAtLabel: (service: any) => service.heartbeatText || "Latest: -",
    serviceSourceDetail: (service: any) => service.sourceLabelText || `本地配置 / ${service.serviceId}`,
    isServiceHeartbeatRefreshing: (service: any) => service.heartbeatRefreshing || false,
    services,
    showCustomUpstreamType: overrides.showCustomUpstreamType || false,
    startupPolicyOptions: [],
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
    upstreamTargetDetailLabel: (service: any) => service.upstreamTargetDetailText || "endpoint",
    upstreamTargetLabel: (service: any) => service.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTypeOptions: [],
    upstreamTypeSelectValue: overrides.upstreamTypeSelectValue || "mcp",
    validServiceCount: overrides.validServiceCount || 0,
    validationErrors: overrides.validationErrors || [],
    validationWarnings: overrides.validationWarnings || [],
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    verifying: overrides.verifying || false,
  };
}

function createExternalServiceEntry(overrides: Record<string, any> = {}) {
  const config = Object.prototype.hasOwnProperty.call(overrides, "config")
    ? overrides.config
    : createExternalServiceConfig(overrides.configOverrides || {});
  return {
    entryId: overrides.entryId || config.serviceId || "mcp-docs",
    serviceId: overrides.serviceId || config.serviceId || "mcp-docs",
    serviceName: overrides.serviceName || config.serviceName || "Docs MCP",
    displayName: overrides.displayName || config.serviceName || "Docs MCP",
    description: overrides.description || config.description || "",
    mode: overrides.mode || config.mode || "connected",
    startupPolicy: overrides.startupPolicy || config.startupPolicy || "external-only",
    source: overrides.source || "configured",
    sourceLabel: overrides.sourceLabel || "本地配置",
    filePath: overrides.filePath || "",
    requiredOperations: overrides.requiredOperations || ["knowledge.search"],
    scriptCount: overrides.scriptCount ?? 0,
    validationStatus: overrides.validationStatus || "valid",
    validation: overrides.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: Object.prototype.hasOwnProperty.call(overrides, "externalMcp") ? overrides.externalMcp : null,
    healthCheck: Object.prototype.hasOwnProperty.call(overrides, "healthCheck") ? overrides.healthCheck : config.healthCheck,
    config,
  };
}

function mountExternalServicesView(overrides: Record<string, unknown> = {}) {
  activeExternalServicesViewController.value = createExternalServicesControllerFixture(overrides);
  const wrapper = mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: { template: "<span />" },
        ConfigFloatingPanel: { template: "<section><slot /></section>" },
        HelpTooltip: { template: "<span />" },
        StatusPill: { template: "<span />" },
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function routeByPath(path: string) {
  return router.getRoutes().find((route) => route.path === path);
}

function callBeforeEnter(path: string, tab: string) {
  const route = routeByPath(path);
  const guard = route?.beforeEnter;
  if (Array.isArray(guard)) {
    return guard[0]?.({ params: { tab } } as any, {} as any, () => undefined);
  }
  return guard?.({ params: { tab } } as any, {} as any, () => undefined);
}

async function loadActualExternalServicesController() {
  const actual = await vi.importActual<typeof import("../../../server-web/composables/external-services-view-controller")>(
    "../../../server-web/composables/external-services-view-controller",
  );
  return actual.useExternalServicesViewController;
}

async function flushControllerPromises() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountActualExternalServicesControllerHarness() {
  const useActual = await loadActualExternalServicesController();
  let controller: ReturnType<typeof useActual> | undefined;
  const shell = { openExternalServiceTab: vi.fn() };
  const wrapper = mount(defineComponent({
    name: "ExternalServicesControllerHarness",
    setup() {
      controller = useActual(shell as any);
      return () => null;
    },
  }));
  mountedWrappers.push(wrapper);
  return { controller: controller!, shell, wrapper };
}

function mountUseConsoleHarness() {
  const Harness = defineComponent({
    name: "UseConsoleHarness",
    setup: () => useConsole(),
    template: "<div />",
  });
  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  routerState.route = reactive({
    fullPath: "/dashboard",
    path: "/dashboard",
    meta: { viewId: "dashboard" },
    params: {},
  }) as any;
  routerState.push.mockReset();
  mockBrowserEffects.confirmConsoleAction.mockReset();
  mockBrowserEffects.copyTextToClipboard.mockReset();
  mockBrowserEffects.downloadTextFile.mockReset();
  mockBrowserEffects.notifyConsoleAction.mockReset();
  mockKnowledgeLogController.filteredKnowledgeLogRows.value = [];
  mockKnowledgeLogController.syncKnowledgeLogTableScrollLeft.mockReset();
  mockAgentSelectorController.agentSelectorOptions.value = [
    { label: "模型 A", value: "model-a", selectable: true },
  ];
  mockAgentSelectorController.cacheAgentModelOptionLabels.mockReset();
  mockAgentExploreStateController.agentExploreForm.value = { modelAlias: "" };
  mockAgentExploreStateController.agentExploreResult.value = {};
  mockFeatureAccessController.hasFeature.mockReturnValue(true);
  mockFeatureAccessController.isAdminViewEnabled.mockReturnValue(true);
  mockRefreshStateController.refreshState.mockReset();
  mockRuntimeLifecycle.mountConsoleRuntime.mockReset();
  mockRuntimeLifecycle.unmountConsoleRuntime.mockReset();
  mockSettingsBridgeController.bindSettingsPersistenceActions.mockReset();
  mockSettingsBridgeController.bindSettingsDraftActions.mockReset();
  mockSettingsBridgeController.saveModuleSettings.mockReset();
  mockSettingsBridgeController.saveSettings.mockReset();
  externalServiceClientMocks.getExternalServiceConfig.mockReset();
  externalServiceClientMocks.refreshExternalServiceRuntime.mockReset();
  externalServiceClientMocks.saveExternalServiceConfig.mockReset();
  externalServiceClientMocks.verifyExternalServiceConfig.mockReset();
  externalServiceClientMocks.getExternalServiceConfig.mockResolvedValue(createExternalServicesControllerFixture());
  pageRefreshHandlerMock.mockReset();
  activeExternalServicesViewController.value = null;
  mockNavigationState.currentView.value = "dashboard";
  mockNavigationState.adminView.value = "jobs";
  mockNavigationState.knowledgeTab.value = "management";
  mockNavigationState.knowledgeManagementPanel.value = "sources";
  mockNavigationState.debugTab.value = "knowledgeRecall";
  mockNavigationState.externalServiceTab.value = "list";
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  vi.clearAllTimers();
});

describe("router index high gap second extra", () => {
  it("covers redirect records and the global redirect guard", async () => {
    expect(routeByPath("/external-services")?.redirect).toBe("/external-services/list");
    expect(routeByPath("/knowledge")?.redirect).toBe("/knowledge/management");
    expect(routeByPath("/debug")?.redirect).toBe("/debug/knowledgeRecall");
    expect(routeByPath("/admin")?.redirect).toBe("/admin/storage");
    expect(router.options.scrollBehavior?.({} as any, {} as any, {} as any)).toEqual({ top: 0 });

    expect(callBeforeEnter("/external-services/:tab", "list")).toBe(true);
    expect(callBeforeEnter("/external-services/:tab", "unknown")).toBe("/external-services/list");
    expect(callBeforeEnter("/knowledge/:tab", "management")).toBe(true);
    expect(callBeforeEnter("/knowledge/:tab", "bad")).toBe("/knowledge/management");
    expect(callBeforeEnter("/debug/:tab", "knowledgeRecall")).toBe(true);
    expect(callBeforeEnter("/debug/:tab", "bad")).toBe("/debug/knowledgeRecall");

    await router.push("/knowledge/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/not-a-tab");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/external-services/not-a-tab");
    expect(router.currentRoute.value.path).toBe("/external-services/list");
  });
});

describe("external services controller high gap second extra", () => {
  it("covers stable fallback branches for upstream resolution and discovery labels", async () => {
    externalServiceClientMocks.getExternalServiceConfig.mockResolvedValueOnce(
      createExternalServicesControllerFixture({
        externalMcpCache: { updatedAt: "not-a-date", serviceCount: 0 },
        services: [],
      }),
    );

    const { controller } = await mountActualExternalServicesControllerHarness();
    await controller.refreshExternalServices();
    await flushControllerPromises();

    const dockerService = createExternalServiceEntry({
      serviceId: "docker-service",
      serviceName: "Docker Service",
      config: createExternalServiceConfig({
        serviceId: "docker-service",
        upstream: { type: "", metadata: {} },
        docker: { containerName: "pact-docker" },
      }),
    });
    const scriptService = createExternalServiceEntry({
      serviceId: "script-service",
      serviceName: "Script Service",
      config: createExternalServiceConfig({
        serviceId: "script-service",
        upstream: { type: "", metadata: {} },
        scripts: { start: { command: { executable: "/opt/pact/bin/service" } } },
      }),
    });
    const includePathService = createExternalServiceEntry({
      serviceId: "include-service",
      serviceName: "Include Service",
      config: createExternalServiceConfig({
        serviceId: "include-service",
        upstream: { type: "", metadata: {} },
        includePaths: ["/opt/pact/include"],
      }),
    });
    const healthTargetService = createExternalServiceEntry({
      serviceId: "health-service",
      serviceName: "Health Service",
      config: createExternalServiceConfig({
        serviceId: "health-service",
        upstream: { type: "", metadata: {} },
        healthCheck: {
          type: "http",
          url: "",
          host: "127.0.0.1",
          port: 8844,
          path: "/health",
          timeoutMs: 60000,
          required: false,
        },
      }),
    });
    const endpointRefService = createExternalServiceEntry({
      serviceId: "endpoint-ref-service",
      serviceName: "Endpoint Ref Service",
      config: createExternalServiceConfig({
        serviceId: "endpoint-ref-service",
        upstream: { type: "", endpointRef: "config://pact/external-service", metadata: {} },
        healthCheck: { type: "none", url: "", host: "", port: null, path: "/", timeoutMs: 60000, required: false },
      }),
    });
    const missingTargetService = createExternalServiceEntry({
      serviceId: "missing-target-service",
      serviceName: "Missing Target Service",
      config: createExternalServiceConfig({
        serviceId: "missing-target-service",
        upstream: { type: "", metadata: {} },
        healthCheck: { type: "none", url: "", host: "", port: null, path: "/", timeoutMs: 60000, required: false },
      }),
      filePath: "",
    });
    const openAiIdentityService = createExternalServiceEntry({
      serviceId: "openai-model",
      serviceName: "OpenAI Model",
      config: createExternalServiceConfig({
        serviceId: "openai-model",
        upstream: { type: "", url: "https://api.openai.com/v1", metadata: {} },
      }),
    });
    const acpIdentityService = createExternalServiceEntry({
      serviceId: "acp-service",
      serviceName: "ACP Service",
      config: createExternalServiceConfig({
        serviceId: "acp-service",
        upstream: { type: "", url: "https://acp.example.com", metadata: {} },
      }),
    });
    const httpsService = createExternalServiceEntry({
      serviceId: "https-service",
      serviceName: "HTTPS Service",
      config: createExternalServiceConfig({
        serviceId: "https-service",
        upstream: { type: "https", url: "https://gateway.example.com/api", metadata: {} },
      }),
    });
    const mcpPendingService = createExternalServiceEntry({
      serviceId: "mcp-pending",
      serviceName: "MCP Pending",
      config: createExternalServiceConfig({
        serviceId: "mcp-pending",
        upstream: { type: "mcp", url: "http://127.0.0.1:7777/mcp", metadata: {} },
      }),
      externalMcp: null,
    });
    const rawTypeService = createExternalServiceEntry({
      serviceId: "vector-runner",
      serviceName: "Vector Runner",
      config: createExternalServiceConfig({
        serviceId: "vector-runner",
        upstream: { type: "vector-rpc", metadata: {} },
      }),
      filePath: "/etc/pact/vector-runner.json",
    });
    const otherService = createExternalServiceEntry({
      serviceId: "other-service",
      serviceName: "Other Service",
      config: createExternalServiceConfig({
        serviceId: "other-service",
        upstream: { type: "other", metadata: {} },
        healthCheck: { type: "none", url: "", host: "", port: null, path: "/", timeoutMs: 60000, required: false },
      }),
      externalMcp: null,
    });

    expect(controller.upstreamTargetDetailLabel(dockerService as any)).toBe("docker container");
    expect(controller.upstreamTargetLabel(dockerService as any)).toBe("pact-docker");
    expect(controller.upstreamTargetDetailLabel(scriptService as any)).toBe("script path");
    expect(controller.upstreamTargetLabel(scriptService as any)).toBe("/opt/pact/bin/service");
    expect(controller.upstreamTargetDetailLabel(includePathService as any)).toBe("local path");
    expect(controller.upstreamTargetLabel(includePathService as any)).toBe("/opt/pact/include");
    expect(controller.upstreamTargetDetailLabel(healthTargetService as any)).toBe("health target");
    expect(controller.upstreamTargetLabel(healthTargetService as any)).toBe("127.0.0.1:8844");
    expect(controller.upstreamTargetDetailLabel(endpointRefService as any)).toBe("endpoint ref");
    expect(controller.upstreamTargetLabel(endpointRefService as any)).toBe("config://pact/external-service");
    expect(controller.upstreamTargetDetailLabel(missingTargetService as any)).toBe("missing target");
    expect(controller.upstreamTargetLabel(missingTargetService as any)).toBe("未声明上游目标");

    expect(controller.serviceDiscoveryLabel(openAiIdentityService as any)).toBe("LLM Service");
    expect(controller.serviceDiscoveryLabel(acpIdentityService as any)).toBe("ACP 服务");
    expect(controller.serviceDiscoveryTone(acpIdentityService as any)).toBe("info");
    expect(controller.serviceDiscoveryLabel(httpsService as any)).toBe("HTTP / HTTPS 服务");
    expect(controller.serviceDiscoveryRegistrationLabel(httpsService as any)).toBe("端点已注册");
    expect(controller.serviceDiscoveryRegistrationLabel(mcpPendingService as any)).toBe("工具待刷新");
    expect(controller.serviceDiscoveryRegistrationTone(mcpPendingService as any)).toBe("warning");
    expect(controller.serviceDiscoveryRegistrationLabel(rawTypeService as any)).toBe("类型已注册");
    expect(controller.serviceDiscoveryRegistrationLabel(otherService as any)).toBe("服务已注册");
  });

  it("keeps invalid refresh timestamps for scoped heartbeat updates", async () => {
    externalServiceClientMocks.refreshExternalServiceRuntime.mockResolvedValueOnce({
      ok: true,
      refreshedAt: "not-a-date",
      refreshedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      results: [
        {
          ok: true,
          status: "checked",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
        },
      ],
      state: createExternalServicesControllerFixture({
        services: [
          createExternalServiceEntry({
            serviceId: "mcp-docs",
            externalMcp: {
              serviceId: "mcp-docs",
              toolCount: 3,
              tools: [],
              discoveredAt: "2026-06-04T05:10:00.000Z",
            },
          }),
        ],
        configuredCount: 1,
        validServiceCount: 1,
      }) as any,
    });

    const { controller } = await mountActualExternalServicesControllerHarness();
    await controller.refreshExternalServices();
    await flushControllerPromises();
    await controller.refreshRuntime("mcp-docs");
    expect(controller.serviceHeartbeatLastAtLabel(controller.services[0])).toBe("Latest: not-a-date");
    expect(controller.isServiceHeartbeatRefreshing(controller.services[0])).toBe(false);
  });
});

describe("external services view component high gap second extra", () => {
  it("closes helper surfaces when the event target is unusable", async () => {
    const service = createExternalServiceEntry({
      serviceId: "mcp-main",
      externalMcp: { tools: ["search", { name: "status" }] },
    });
    const wrapper = mountExternalServicesView({ services: [service] });
    const vm: any = wrapper.vm;

    vm.showUpstreamValueBubble({ currentTarget: null } as any, "127.0.0.1:8787");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);

    vm.toggleToolListPopover({ currentTarget: null } as any, service);
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    vm.handleExternalServiceDocumentPointerDown({ target: null } as any);
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    wrapper.unmount();
  });

  it("registers and removes the document listener around mount and unmount", async () => {
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const wrapper = mountExternalServicesView();
    await nextTick();
    expect(addEventListenerSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));

    wrapper.unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });
});

describe("useConsole high gap second extra", () => {
  it("does not sync knowledge logs while the admin logs watcher is off the logs view", async () => {
    const useConsoleHarness = mountUseConsoleHarness();
    await nextTick();

    expect(mockKnowledgeLogController.syncKnowledgeLogTableScrollLeft).not.toHaveBeenCalled();
    mockNavigationState.currentView.value = "dashboard";
    mockNavigationState.adminView.value = "jobs";
    mockKnowledgeLogController.filteredKnowledgeLogRows.value = [{ id: "row-1" }];
    await nextTick();

    expect(mockKnowledgeLogController.syncKnowledgeLogTableScrollLeft).not.toHaveBeenCalled();
    expect(mockNavigationState.syncNavigationStateFromRoute).toHaveBeenCalled();

    useConsoleHarness.unmount();
  });
});
