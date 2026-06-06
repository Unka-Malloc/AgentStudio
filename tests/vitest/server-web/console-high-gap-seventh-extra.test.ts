// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref, type Ref } from "vue";
import { mount, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
import { useConsole } from "../../../server-web/composables/useConsole";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";

const routerState = vi.hoisted(() => ({
  route: null as any,
  push: vi.fn(),
}));

const runtimeLifecycleMock = vi.hoisted(() => ({
  mountConsoleRuntime: vi.fn(),
  unmountConsoleRuntime: vi.fn(),
}));

const browserStateMock = vi.hoisted(() => ({
  clearBrowserLocalStateFromUrlCore: vi.fn(),
}));

const browserEffectsMock = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
  copyConsoleTextWithFeedback: vi.fn(),
  notifyConsoleAction: vi.fn(),
}));

const navigationStateMock = vi.hoisted(() => {
  const { ref } = require("vue");
  const currentView = ref("dashboard");
  const adminView = ref("jobs");
  const debugTab = ref("knowledgeRecall");
  const knowledgeTab = ref("management");
  const drawerOpen = ref(false);
  const drawerTab = ref("tools");
  const sideNavOpen = ref(false);
  const externalServiceTab = ref("list");
  const knowledgeManagementPanel = ref("sources");
  const viewTitle = ref("控制台");
  const visibleDebugTabs = ref([{ id: "knowledgeRecall", label: "知识召回" }]);
  const visibleKnowledgeTabs = ref([{ id: "management", label: "知识归档" }]);

  function syncNavigationStateFromRoute(route: { meta?: { viewId?: string }; params?: Record<string, string> } = {}) {
    const viewId = route.meta?.viewId || "dashboard";
    currentView.value = viewId === "knowledge" || viewId === "admin" || viewId === "debug" ? viewId : "dashboard";
    if (viewId === "knowledge") {
      knowledgeTab.value = route.params?.tab || "management";
      viewTitle.value = "知识库";
    } else if (viewId === "admin") {
      adminView.value = route.params?.tab || "jobs";
      viewTitle.value = "管理员";
    } else if (viewId === "debug") {
      debugTab.value = route.params?.tab || "knowledgeRecall";
      viewTitle.value = "调试";
    } else {
      knowledgeTab.value = "management";
      debugTab.value = "knowledgeRecall";
      adminView.value = "jobs";
      viewTitle.value = "控制台";
    }
  }

  return {
    adminView,
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
    syncNavigationStateFromRoute: vi.fn(syncNavigationStateFromRoute),
    switchView: vi.fn(),
    viewTitle,
    visibleDebugTabs,
    visibleKnowledgeTabs,
    bindNavigationRouter: vi.fn(),
  };
});

const featureAccessMock = vi.hoisted(() => ({
  ...require("vue"),
  activeConsoleFeatureIds: require("vue").ref(["knowledge-core"]),
  hasAnyFeature: vi.fn(() => true),
  hasFeature: vi.fn(() => true),
  isAdminViewEnabled: vi.fn(() => true),
  visibleDebugTabs: require("vue").ref([{ id: "knowledgeRecall", label: "知识召回" }]),
  visibleKnowledgeTabs: require("vue").ref([{ id: "management", label: "知识归档" }]),
}));

const agentExploreStateMock = vi.hoisted(() => ({
  ...require("vue"),
  agentExploreContextWindowOptions: require("vue").ref([]),
  agentExploreDefaults: require("vue").ref({
    answerTemplate: "",
    contextProfileId: "32k",
    continuationPrompt: "",
    limit: 5,
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
  }),
  agentExploreForm: require("vue").ref({ modelAlias: "", query: "" }),
  agentExploreResult: require("vue").ref({}),
  agentExploreThinkingModeOptions: require("vue").ref([]),
  selectedAgentExploreContextProfile: require("vue").ref({ value: "32k" }),
  selectedAgentExploreThinkingMode: require("vue").ref({ value: "balanced" }),
}));

const agentExploreSessionMock = vi.hoisted(() => ({
  persistAgentExploreState: vi.fn(),
}));

const agentSelectorMock = vi.hoisted(() => ({
  agentSelectorOptions: require("vue").ref([{ label: "模型 A", value: "model-a", selectable: true }]),
  cacheAgentModelOptionLabels: vi.fn(),
}));

const expertRulesMock = vi.hoisted(() => ({
  refreshExpertRules: vi.fn(),
}));

const knowledgeMaintenanceMock = vi.hoisted(() => ({
  refreshKnowledgeConsole: vi.fn(),
}));

const refreshStateMock = vi.hoisted(() => ({
  refreshState: vi.fn(async () => undefined),
}));

const infoFeedControllerMock = vi.hoisted(() => ({
  ...require("vue"),
  infoFeedCurrentRun: require("vue").ref(null as null | { summary: { status: string }; runId?: string; query?: string }),
  infoFeedForm: require("vue").ref({ modelAlias: "", query: "" }),
  infoFeedModelOptions: require("vue").ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
  infoFeedSubmitLabel: require("vue").ref("开始信息流"),
  infoFeedAttachments: require("vue").ref([] as Array<{ id: string; name: string; status: string }>),
  infoFeedInputPlaceholder: require("vue").ref("输入问题"),
  selectedInfoFeedModel: require("vue").ref({ enabled: true, label: "GPT-5.4" }),
  handleInfoFeedAttachmentFiles: vi.fn(),
  clearInfoFeedKeywordCache: vi.fn(),
  removeInfoFeedAttachment: vi.fn(),
  runInfoFeed: vi.fn(),
  saveSettings: vi.fn(),
  settingsDraft: require("vue").ref({
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
  agentSelectorOptions: require("vue").ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
  contextWindowOptionBarOptions: require("vue").ref([{ label: "32k", value: "32k" }]),
  thinkingModeOptionBarOptions: require("vue").ref([{ label: "Balanced", value: "balanced" }]),
}));

const workspaceContextMock = vi.hoisted(() => ({
  ...require("vue"),
  busyKey: require("vue").ref(""),
  cloudDriveConnectionOptions: require("vue").ref([{ label: "Drive A", value: "drive-a" }]),
  cloudDriveData: require("vue").ref({
    connections: [
      {
        driveRef: "drive-a",
        provider: "icloud",
        mode: "local",
        directoryMappingCount: 1,
        contractVerified: true,
      },
    ],
  } as {
    connections: Array<{
      driveRef: string;
      provider: string;
      mode: string;
      directoryMappingCount: number;
      contractVerified: boolean;
    }>;
  }),
  cloudDriveForm: {
    provider: "icloud",
    rootPath: "/Users/name/Library/Mobile Documents",
    driveRef: "",
    clientId: "client-a",
    managedFolderRoot: "/tmp/pact",
    publicFolder: "/public",
    allowedClients: "client-a",
    advancedMode: false,
    exposedDirectories: [
      {
        id: "exposure-1",
        name: "目录 1",
        path: "/tmp/pact/shared",
        permissionMode: "allowlist",
        subjects: "client-a",
        showPermissions: false,
      },
    ],
    path: "public/readme.txt",
    uploadPath: "public/upload.txt",
    uploadContent: "payload",
    targetPath: "cloud-drive",
  },
  cloudDriveResult: require("vue").ref(null as Record<string, unknown> | null),
  addCloudDriveExposure: vi.fn(),
  applyCloudDriveSync: vi.fn(),
  connectCloudDrive: vi.fn(),
  downloadCloudDriveFile: vi.fn(),
  listCloudDriveItems: vi.fn(),
  listCloudDrivePermissions: vi.fn(),
  panel: require("vue").ref("cloudDrive"),
  planCloudDriveSync: vi.fn(),
  removeCloudDriveExposure: vi.fn(),
  selected: require("vue").ref({ title: "主工作区" }),
  uploadCloudDriveFile: vi.fn(),
}));

const externalServicesControllerMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
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
  clearBrowserCacheStorage: vi.fn(),
  clearBrowserLocalStateFromUrl: browserStateMock.clearBrowserLocalStateFromUrlCore,
  clearIndexedDbDatabases: vi.fn(),
  unregisterServiceWorkers: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
  copyTextToClipboard: vi.fn(),
  createConsoleTargetHighlightController: vi.fn(() => ({
    configTargetElement: vi.fn(() => null),
    scrollToConfigTarget: vi.fn(async () => undefined),
    clearConfigTargetHighlight: vi.fn(),
  })),
  downloadTextFile: vi.fn(),
  notifyConsoleAction: browserEffectsMock.notifyConsoleAction,
  copyConsoleTextWithFeedback: browserEffectsMock.copyConsoleTextWithFeedback,
}));

vi.mock("../../../server-web/lib/runtime-info-client", () => ({
  browseServerPath: vi.fn(),
  browseServerLogs: vi.fn(),
  getRuntimeInfo: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-agent-explore-utils", () => ({
  isAgentExploreDraftSession: vi.fn(() => false),
}));

vi.mock("../../../server-web/composables/console-agent-selection-reference-controller", () => ({
  AGENT_SELECTION_REFERENCE_LOG_LIMIT: 20,
  createConsoleAgentSelectionReferenceController: vi.fn(() => ({
    agentSelectionReferenceLogs: ref([]),
    agentSelectionReferenceStates: ref({}),
    emitAgentSelectionReferenceLog: vi.fn(),
    normalizeAgentSelectionAlias: (value?: string) => String(value || "").trim(),
    trackAgentSelectionReference: vi.fn(),
    watchAgentSelectionReference: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-selector-controller", () => ({
  createConsoleAgentSelectorController: vi.fn(() => agentSelectorMock),
}));

vi.mock("../../../server-web/composables/console-auth-controller", () => ({
  createConsoleAuthController: vi.fn(() => ({
    authAudit: ref([]),
    authBootstrapping: ref(false),
    authSessions: ref([]),
    authState: ref({}),
    authUsers: ref([]),
    canAdminAuth: ref(true),
    canAdminKnowledge: ref(true),
    canAdminMaintenanceAgent: ref(true),
    canAdminRuntime: ref(true),
    canApproveMaintenanceAgent: ref(true),
    canBrowseServerPaths: ref(true),
    canMaintainKnowledge: ref(true),
    canReadKnowledge: ref(true),
    canReadMaintenanceAgent: ref(false),
    canRunMaintenanceAgent: ref(false),
    canWriteJobs: ref(false),
    canWriteKnowledge: ref(true),
    currentUser: ref({ username: "demo", role: "admin" }),
    currentUserScopes: ref([]),
    hasScope: vi.fn(() => true),
    isAuthenticated: ref(true),
    loginForm: ref({ username: "", password: "" }),
    logoutConsole: vi.fn(),
    oidcAllowedDomainsText: "",
    oidcDraft: ref({}),
    oidcRoleMappingText: "",
    refreshAuthAdmin: vi.fn(),
    refreshAuthState: vi.fn(),
    revokeConsoleSession: vi.fn(),
    saveOidcConfig: vi.fn(),
    submitLoginAuth: vi.fn(),
    updateConsoleUser: vi.fn(),
    updateConsoleUserRole: vi.fn(),
    updateConsoleUserRoleFromEvent: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-busy-controller", () => ({
  createConsoleBusyController: vi.fn(() => ({
    busyKey: ref(""),
    clearAllBusy: vi.fn(),
    clearBusy: vi.fn(),
    isBusy: ref(false),
    isBusyPrefix: ref(""),
    setBusy: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-codex-oauth-controller", () => ({
  createConsoleCodexOAuthController: vi.fn(() => ({
    beginCodexOAuthLogin: vi.fn(),
    codexOAuthLogin: vi.fn(),
    codexOAuthPollTimer: ref(0),
    codexOAuthStatus: ref("idle"),
    ensureCodexOAuthReady: vi.fn(),
    refreshCodexOAuthStatus: vi.fn(),
    startCodexOAuthPolling: vi.fn(),
    stopCodexOAuthPolling: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-client-controller", () => ({
  createConsoleClientController: vi.fn(() => ({
    attentionClientCount: ref(0),
    clientSearchQuery: ref(""),
    clientStateFilter: ref("all"),
    clientStateFilterOptionBarOptions: ref([]),
    displayedClients: ref([]),
    filteredClientList: ref([]),
    filteredClients: ref([]),
    latestClient: ref(null),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-explore-layout-controller", () => ({
  createConsoleAgentExploreLayoutController: vi.fn(() => ({
    agentExploreSplitDragging: ref(false),
    agentExploreSplitLeftPercent: ref(50),
    agentExploreSplitRef: ref(null),
    agentExploreSplitStyle: ref({}),
    agentExploreTraceOpen: ref(false),
    clampAgentExploreSplitPercent: vi.fn(),
    handleAgentExploreSplitKeydown: vi.fn(),
    handleAgentExploreSplitPointerMove: vi.fn(),
    handleAgentExploreTraceToggle: vi.fn(),
    startAgentExploreSplitResize: vi.fn(),
    stopAgentExploreSplitResize: vi.fn(),
    updateAgentExploreSplitFromClientX: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-explore-output-controller", () => ({
  createConsoleAgentExploreOutputController: vi.fn(() => ({
    agentExploreActiveIteration: ref(0),
    agentExploreAnswerHtml: ref(""),
    agentExploreContextBuildRecordId: ref(""),
    agentExploreDocumentMarkdown: ref(""),
    agentExploreEvidenceRefs: ref([]),
    agentExploreEventTime: ref(""),
    agentExploreLinkedEvidenceRefs: ref([]),
    agentExploreMaxIterations: ref(0),
    agentExploreProgress: ref(null),
    agentExploreProgressVisible: ref(false),
    agentExploreRunCoverage: ref(null),
    agentExploreRunInput: ref(""),
    agentExploreStepOpen: ref(false),
    agentExploreSteps: ref([]),
    agentExploreWorkspaceId: ref(""),
    copyAgentExploreDocument: vi.fn(),
    currentAgentExploreQuery: ref(""),
    exportAgentExploreDocument: vi.fn(),
    handleAgentAnswerClick: vi.fn(),
    recordConsoleKnowledgeFeedback: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-explore-session-controller", () => ({
  createConsoleAgentExploreSessionController: vi.fn(() => ({
    agentExploreHistoryPanelItems: ref([]),
    agentExplorePollTimer: ref(null),
    agentExploreSessionFromResult: ref(null),
    agentExploreSessionLabel: ref(""),
    agentExploreTabBusy: ref(false),
    agentExploreTabs: ref([]),
    applyAgentExploreDraftTab: vi.fn(),
    clearInvalidAgentExploreModelReferences: vi.fn(),
    closeAgentExploreTab: vi.fn(),
    createAgentExploreDraftTab: vi.fn(),
    deleteAgentExploreHistoryItem: vi.fn(),
    deleteAgentExploreHistorySession: vi.fn(),
    loadAgentExploreHistoryFromServer: vi.fn(),
    loadAgentExploreSession: vi.fn(),
    normalizeAgentExploreHistoryList: vi.fn(),
    persistAgentExploreState: agentExploreSessionMock.persistAgentExploreState,
    resetKnowledgeAgentExplore: vi.fn(),
    restoreAgentExploreState: vi.fn(),
    runKnowledgeAgentExplore: vi.fn(),
    sanitizeAgentExploreSessionModelReference: vi.fn(),
    selectAgentExploreHistoryItem: vi.fn(),
    startAgentExplorePolling: vi.fn(),
    stopAgentExplorePolling: vi.fn(),
    switchAgentExploreTab: vi.fn(),
    syncActiveAgentExploreDraftFromForm: vi.fn(),
    upsertAgentExploreHistory: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-agent-explore-state-controller", () => ({
  createConsoleAgentExploreStateController: vi.fn(() => agentExploreStateMock),
}));

vi.mock("../../../server-web/composables/console-context-compiler-controller", () => ({
  createConsoleContextCompilerController: vi.fn(() => ({
    contextBuildRecordRows: ref([]),
    contextBuildRecordsResponse: ref(null),
    contextEvaluationResult: ref(null),
    contextPreviewPayload: ref(null),
    contextPreviewRequiredEvidence: ref([]),
    contextPreviewResult: ref(null),
    contextPreviewTask: ref(null),
    contextProfileRows: ref([]),
    contextProfilesResponse: ref(null),
    exportContextBuildRecords: vi.fn(),
    previewContextCompiler: vi.fn(),
    refreshContextCompiler: vi.fn(),
    runContextReplayEvaluation: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-discovery-controller", () => ({
  createConsoleDiscoveryController: vi.fn(() => ({
    discoveryDraft: ref({}),
    discoveryDraftDirty: ref(false),
    replaceDiscoveryDraftFromServer: vi.fn(),
    saveDiscovery: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-expert-rules-controller", () => ({
  createConsoleExpertRulesController: vi.fn(() => ({
    addVocabularyEntry: vi.fn(),
    cloneExpertVocabulary: vi.fn(),
    deleteVocabularyEntry: vi.fn(),
    displayedVocabularyEntries: ref([]),
    emailDepartmentRules: ref([]),
    emailReportSeriesRules: ref([]),
    emailRulesDraft: ref(""),
    emailSynonymRules: ref([]),
    expertRuleEnabled: ref(true),
    expertVocabularyDraft: ref({}),
    expertVocabularyDraftDirty: ref(false),
    goldenRuleItems: ref([]),
    goldenRulePackageTitle: ref(""),
    goldenRulePackages: ref([]),
    goldenRulesState: ref({}),
    hiddenVocabularyEntryCount: ref(0),
    parseEmailRulesDraft: vi.fn(),
    refreshExpertRules: expertRulesMock.refreshExpertRules,
    replaceExpertVocabularyDraftFromServer: vi.fn(),
    replaceRulesDraftFromServer: vi.fn(),
    rulesDraftDirty: ref(false),
    rulesText: ref(""),
    saveExpertVocabulary: vi.fn(),
    saveRules: vi.fn(),
    setEmailRuleEntryEnabled: vi.fn(),
    setVocabularyEntryEnabled: vi.fn(),
    showAllVocabularyEntries: vi.fn(),
    splitVocabularyList: vi.fn(),
    toggleGoldenRuleEnabled: vi.fn(),
    updateVocabularyDomains: vi.fn(),
    updateVocabularyEntry: vi.fn(),
    updateVocabularyKeywords: vi.fn(),
    updateVocabularyPath: vi.fn(),
    vocabularyEntryPath: vi.fn(),
    vocabularySearch: ref(""),
  })),
}));

vi.mock("../../../server-web/composables/console-feature-access-controller", () => ({
  createConsoleFeatureAccessController: vi.fn(() => featureAccessMock),
}));

vi.mock("../../../server-web/composables/console-knowledge-source-controller", () => ({
  createConsoleKnowledgeSourceController: vi.fn(() => ({
    activeKnowledgeSources: ref([]),
    addKnowledgeSource: vi.fn(),
    applyJobToKnowledgeSources: vi.fn(),
    applyKnowledgeSourceState: vi.fn(),
    applyLocalSourceDirectoryPath: vi.fn(),
    deleteKnowledgeSource: vi.fn(),
    directoryNameFromPath: vi.fn((value: string) => value.split("/").pop() || ""),
    localSourceForm: ref({ directoryPath: "" }),
    refreshKnowledgeSource: vi.fn(),
    refreshKnowledgeSources: vi.fn(),
    syncLocalSourceLabelFromPath: vi.fn(),
    updateKnowledgeSource: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-knowledge-search-state-controller", () => ({
  createConsoleKnowledgeSearchPanelStateController: vi.fn(() => ({
    knowledgeSearchEmpty: ref(true),
    knowledgeSearchExpanded: ref(false),
  })),
  createConsoleKnowledgeSearchStateController: vi.fn(() => ({
    knowledgeSearchForm: ref({ query: "" }),
    knowledgeSearchResponse: ref(null),
    knowledgeSearchResults: ref([]),
    lastKnowledgeSearchQuery: ref(""),
  })),
}));

vi.mock("../../../server-web/composables/console-runtime-mount-controller", () => ({
  createConsoleRuntimeMountController: vi.fn(() => ({
    analysisModuleDescription: ref(""),
    currentAnalysisModule: ref(null),
    enabledMountCount: ref(0),
    isMountPathEditing: ref(false),
    moduleGroups: ref([]),
    moduleRows: ref([]),
    mountDraft: ref({}),
    mountDraftDirty: ref(false),
    openMountPathPicker: vi.fn(),
    replaceMountDraftFromServer: vi.fn(),
    toggleMountPathEdit: vi.fn(),
    totalMountCount: ref(0),
  })),
}));

vi.mock("../../../server-web/composables/console-dashboard-alert-controller", () => ({
  createConsoleDashboardAlertController: vi.fn(() => ({
    acknowledgeMonitorAlert: vi.fn(),
    activeMonitorAlerts: ref([]),
    agentConfigurationAlertSummary: ref(""),
    agentConfigurationAlerts: ref([]),
    dashboardAlertCounts: ref({}),
    dashboardAlertInbox: ref([]),
    dashboardAlertInboxId: ref(""),
    dashboardAlertSummary: ref(""),
    dashboardAlerts: ref([]),
    dashboardConfigurationQueue: ref([]),
    dismissDashboardAlert: vi.fn(),
    dismissedDashboardAlertIds: ref([]),
    dashboardMonitorQueue: ref([]),
    dashboardPrimaryAlert: ref(null),
    dashboardSecondaryAlerts: ref([]),
    liveDashboardAlerts: ref([]),
    openDashboardAlert: vi.fn(),
    refreshDashboardAlertsSnapshot: vi.fn(),
    syncDashboardAlertInbox: vi.fn(),
    agentExploreAgentOptions: ref([]),
    agentExploreForm: agentExploreStateMock.agentExploreForm,
    agentModelAssignmentOptions: ref([]),
    agentSelectorOptions: agentSelectorMock.agentSelectorOptions,
    backgroundProcesses: ref([]),
    error: ref(""),
    infoFeedForm: infoFeedControllerMock.infoFeedForm,
    infoFeedModelOptions: infoFeedControllerMock.infoFeedModelOptions,
    moduleModelRef: ref(""),
    moduleNeedsIntelligence: ref(false),
    openAdmin: vi.fn(),
    openAgentConfigurationAlert: vi.fn(),
    refreshMonitorAlerts: vi.fn(),
    recoverBackgroundSupervisor: vi.fn(),
    ruleAuthoringForm: ref({ modelAlias: "" }),
    ruleAuthoringModelOptions: ref([]),
    settingsDraft: infoFeedControllerMock.settingsDraft,
    visibleModelEntries: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/console-info-feed-controller", () => ({
  createConsoleInfoFeedController: vi.fn(() => ({
    ...infoFeedControllerMock,
    infoFeedAllKeywordItems: ref([]),
    infoFeedAgentAnswer: ref(""),
    infoFeedAgentExpertGuidance: ref(""),
    infoFeedAgentProgressFromResult: vi.fn(),
    infoFeedAgentRecentTurns: ref([]),
    infoFeedAgentSteps: ref([]),
    infoFeedCanFollowUp: ref(false),
    infoFeedClarification: ref(null),
    infoFeedContextGateNotice: ref(""),
    infoFeedCurrentUserQuestion: ref(""),
    infoFeedExpertFeedbackFor: vi.fn(),
    infoFeedExpertFeedbackForRun: vi.fn(),
    infoFeedHistory: ref([]),
    infoFeedHistoryPanelItems: ref([]),
    infoFeedKeywordCache: ref({}),
    infoFeedKeywordItems: ref([]),
    infoFeedKeywordProgressLabel: ref(""),
    infoFeedLowRelevanceKeywordItems: ref([]),
    infoFeedModelDisplayLabel: ref(""),
    infoFeedModelSelectionMessage: ref(""),
    infoFeedNeedsModelSelection: ref(false),
    infoFeedNeedsRetryContinue: ref(false),
    infoFeedParentRunForCurrent: ref(null),
    infoFeedParentRunSnapshot: ref(null),
    infoFeedParentSummaryEvidenceRefs: ref([]),
    infoFeedParentSummaryHtml: ref(""),
    infoFeedReadyForSummary: ref(false),
    infoFeedRestorableModelAlias: ref(""),
    infoFeedRetryMessage: ref(""),
    infoFeedRetryStageLabel: ref(""),
    infoFeedRunEvidenceRefs: ref([]),
    infoFeedRunSequence: ref(0),
    infoFeedSearchCacheKey: ref(""),
    infoFeedSourceContextBudgetChars: ref(0),
    infoFeedSourceResultLine: ref(""),
    infoFeedSourceSummary: ref(""),
    infoFeedStreamingSummaryHtml: ref(""),
    infoFeedSummaryEvidenceRefs: ref([]),
    infoFeedSummaryIsStreaming: ref(false),
    infoFeedSummaryMarkdown: ref(""),
    infoFeedSummaryRuntime: ref(""),
    infoFeedSummaryStreamText: ref(""),
    infoFeedSummaryStreamTimer: ref(null),
    infoFeedTurnAttachments: ref([]),
    infoFeedTurnQuestion: ref(""),
    infoFeedTurnSummaryHtml: ref(""),
    infoFeedTurnTitle: ref(""),
    infoFeedUserCardTitle: ref(""),
    infoFeedVisibleSummaryText: ref(""),
    initialInfoFeedAgentState: ref({}),
    initialInfoFeedKeywordState: ref({}),
    initialInfoFeedSummaryState: ref({}),
    isInfoFeedRetryExhaustedError: vi.fn(() => false),
    isLowRelevanceSourceResult: vi.fn(() => false),
    isModelConfigurationError: vi.fn(() => false),
    isReadableInfoFeedAttachment: vi.fn(() => true),
    isTransientFetchError: vi.fn(() => false),
    makeInfoFeedId: vi.fn(() => "feed-id"),
    normalizeInfoFeedClarificationOption: vi.fn(),
    normalizeInfoFeedHistory: vi.fn(),
    openInfoFeedHistoryRun: vi.fn(),
    persistInfoFeedHistory: vi.fn(),
    readInfoFeedAttachment: vi.fn(),
    removeInfoFeedAttachment: infoFeedControllerMock.removeInfoFeedAttachment,
    resetInfoFeedRunForContinuation: vi.fn(),
    restoreInfoFeedHistory: vi.fn(),
    runInfoFeed: infoFeedControllerMock.runInfoFeed,
    runInfoFeedAgentTrack: vi.fn(),
    runInfoFeedKeywordTrack: vi.fn(),
    runInfoFeedSummaryAgent: vi.fn(),
    sanitizeInfoFeedRunModelReferences: vi.fn(),
    selectedInfoFeedContextProfile: ref(null),
    selectedInfoFeedModel: infoFeedControllerMock.selectedInfoFeedModel,
    selectInfoFeedHistoryItem: vi.fn(),
    setInfoFeedRetryState: vi.fn(),
    snapshotInfoFeedAttachments: vi.fn(),
    snapshotInfoFeedTurn: vi.fn(),
    streamInfoFeedSummary: vi.fn(),
    syncInfoFeedExpertFeedback: vi.fn(),
    upsertInfoFeedHistory: vi.fn(),
    withInfoFeedFetchRetry: vi.fn(),
    agentExploreConfiguredLimit: ref(0),
    agentExploreConfiguredMaxIterations: ref(0),
    agentExploreContextWindowOptions: agentExploreStateMock.agentExploreContextWindowOptions,
    agentExploreForm: agentExploreStateMock.agentExploreForm,
    agentExploreThinkingModeOptions: agentExploreStateMock.agentExploreThinkingModeOptions,
    agentSelectorOptions: infoFeedControllerMock.agentSelectorOptions,
    canReadKnowledge: ref(true),
    contextProfileRows: ref([]),
    error: ref(""),
    recordFeedback: vi.fn(),
    settingsDraft: infoFeedControllerMock.settingsDraft,
  })),
}));

vi.mock("../../../server-web/composables/console-knowledge-maintenance-controller", () => ({
  createConsoleKnowledgeMaintenanceController: vi.fn(() => ({
    clearAllBusy: vi.fn(),
    consoleState: ref(null),
    debugTab: navigationStateMock.debugTab,
    error: ref(""),
    hasScope: vi.fn(() => true),
    knowledgeConfigGroupDescription: ref(""),
    knowledgeConsole: ref(null),
    knowledgeMaintenanceDraft: ref({}),
    knowledgeManagementPanel: navigationStateMock.knowledgeManagementPanel,
    knowledgeManagementPanelOptionBarOptions: ref([]),
    knowledgeModules: ref([]),
    knowledgeRecentJobs: ref([]),
    knowledgeSchema: ref(null),
    knowledgeSourceState: ref(null),
    knowledgeStatus: ref(""),
    knowledgeTabDisplayLabel: ref(""),
    maintenanceFieldValue: ref(""),
    maintenanceJson: ref("{}"),
    readNestedValue: vi.fn(),
    refreshKnowledgeConsole: knowledgeMaintenanceMock.refreshKnowledgeConsole,
    refreshKnowledgeConflicts: vi.fn(),
    refreshKnowledgeRecallBackendSpaces: vi.fn(),
    saveKnowledgeMaintenance: vi.fn(),
    setBusy: vi.fn(),
    setMaintenanceFieldFromEvent: vi.fn(),
    setMaintenanceFieldValue: vi.fn(),
    writeNestedValue: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-knowledge-recall-controller", () => ({
  createConsoleKnowledgeRecallController: vi.fn(() => ({
    buildKnowledgeRecallSearchPayload: vi.fn(),
    currentKnowledgeLearningEnabled: ref(false),
    currentKnowledgeRetrievalSettings: ref({}),
    currentKnowledgeSearchLimit: ref(0),
    knowledgeRecallDebugForm: ref({}),
    knowledgeRecallDebugGridStyle: ref({}),
    knowledgeRecallDebugModeOptionBarOptions: ref([]),
    knowledgeRecallDebugRuns: ref([]),
    knowledgeRecallDebugTargetOptions: ref([]),
    refreshKnowledgeRecallBackendSpaces: vi.fn(),
    runKnowledgeRecallDebugBatch: vi.fn(),
    searchKnowledge: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-knowledge-review-controller", () => ({
  createConsoleKnowledgeReviewController: vi.fn(() => ({
    fuseKnowledgeReview: vi.fn(),
    knowledgeReviewBusyGeneration: ref(0),
    knowledgeReviewItems: ref([]),
    knowledgeReviewRequestGeneration: ref(0),
    knowledgeReviewStatus: ref(""),
    pendingKnowledgeReviewCount: ref(0),
    refreshKnowledgeConflicts: vi.fn(),
    resolveKnowledgeReview: vi.fn(),
    selectedKnowledgeReviewFusionModel: ref({ value: "review-model" }),
    selectedKnowledgeReviewId: ref(""),
  })),
}));

vi.mock("../../../server-web/composables/console-maintenance-agent-controller", () => ({
  createConsoleMaintenanceAgentController: vi.fn(() => ({
    allMaintenanceAgentRuns: ref([]),
    applyMaintenanceAgentConfigFromEvent: vi.fn(),
    applyMaintenanceAgentStateFromConsoleState: vi.fn(),
    approveMaintenanceAgentRun: vi.fn(),
    cancelMaintenanceAgentRun: vi.fn(),
    chatMaintenanceAgent: vi.fn(),
    displayedMaintenanceAgentRuns: ref([]),
    latestMaintenanceAgentRun: ref(null),
    maintenanceAgentConfig: ref({}),
    maintenanceAgentMessage: ref(""),
    maintenanceAgentModelAlias: ref(""),
    maintenanceAgentResultJson: ref("{}"),
    maintenanceAgentRunbook: ref(""),
    maintenanceAgentRunbookOptionBarOptions: ref([]),
    maintenanceAgentRunbooks: ref([]),
    maintenanceAgentSchedules: ref([]),
    maintenanceAgentSummary: ref(""),
    nextMaintenanceAgentRunAt: ref(null),
    patchMaintenanceAgentState: vi.fn(),
    pendingMaintenanceApprovalCount: ref(0),
    refreshMaintenanceAgent: vi.fn(),
    runMaintenanceAgentKnowledgeMaintenance: vi.fn(),
    runMaintenanceAgentRunbook: vi.fn(),
    saveMaintenanceAgentConfig: vi.fn(),
    selectedMaintenanceAgentRun: ref(null),
    canReadMaintenanceAgent: ref(false),
    clearAllBusy: vi.fn(),
    consoleState: ref(null),
    error: ref(""),
    modelEntryStatusKey: vi.fn(),
    setBusy: vi.fn(),
    visibleModelEntries: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/console-model-library-controller", () => ({
  createConsoleModelLibraryController: vi.fn(() => ({
    addModelEntryBinding: vi.fn(),
    addModelProvider: vi.fn(),
    addModuleAgentProfileFromDraft: vi.fn(),
    addableModelProviders: ref([]),
    agentExploreModelOptionLabel: ref(""),
    agentModelAssignmentOptions: ref([]),
    collectModelEntryBindings: vi.fn(),
    customHttpAdapterAlias: ref(""),
    customHttpAdapterLabel: ref(""),
    duplicateModelEntry: vi.fn(),
    ensureModuleAgentGroup: vi.fn(),
    ensureModuleAgentProfile: vi.fn(),
    exportAgentModelEntryConfig: vi.fn(),
    hasOpenAiModelUsage: vi.fn(() => false),
    isModelLibraryCardExpanded: vi.fn(() => false),
    modelEntryBindingSummary: ref(""),
    modelEntryBindings: ref([]),
    modelEntryBindingsByKey: ref({}),
    modelEntryAllowsModule: vi.fn(() => true),
    modelEntryConfigured: vi.fn(() => true),
    modelEntryIsBound: vi.fn(() => false),
    modelEntryMatchesAssignment: vi.fn(() => false),
    modelEntryMatchesUid: vi.fn(() => false),
    modelEntryModuleAccess: ref(""),
    modelEntryProbeResult: ref(null),
    modelEntryProbeStatusLabel: ref(""),
    modelEntryProbeStatusTone: ref(""),
    modelEntryStatusKey: vi.fn(() => ""),
    modelEntryStatusLabel: ref(""),
    modelEntryStatusTone: ref(""),
    modelEntryUidSet: ref(new Set()),
    modelProbeFailureResult: ref(null),
    modelProbeSettingsForEntry: vi.fn(),
    modelProviderDefinition: ref(null),
    modelProviderFromRef: vi.fn(),
    modelRef: vi.fn(),
    moduleAgentProfileRows: ref([]),
    moduleModelAssignmentOptions: ref([]),
    moduleModelAssignmentStats: ref([]),
    moduleModelRef: ref(""),
    moduleNeedsIntelligence: ref(false),
    parseModelRef: vi.fn(),
    probeModel: vi.fn(),
    probeModelEntry: vi.fn(),
    probeModelLibraryBeforeSave: vi.fn(),
    providerConfigured: ref(false),
    providerLabel: vi.fn(() => ""),
    providerStatusLabel: ref(""),
    providerStatusTone: ref(""),
    removeModelProvider: vi.fn(),
    removeModuleAgentProfile: vi.fn(),
    runModelEntryProbe: vi.fn(),
    setModelEntryModuleAccessMode: vi.fn(),
    setModuleAgentProfileEnabled: vi.fn(),
    setModuleModelRef: vi.fn(),
    setModuleNeedsIntelligence: vi.fn(),
    toggleModelEntryModuleAccess: vi.fn(),
    toggleModelLibraryCard: vi.fn(),
    visibleModelEntries: ref([]),
    visibleModelProviders: ref([]),
    agentExploreAgentOptions: ref([]),
    clearAllBusy: vi.fn(),
    codexOAuthStatus: ref("idle"),
    currentAgentModelOptionLabel: vi.fn(() => ""),
    ensureCodexOAuthReady: vi.fn(),
    error: ref(""),
    infoFeedModelAlias: vi.fn(() => ""),
    infoFeedRunningSummary: vi.fn(() => ({ status: "idle" })),
    modelLibraryExpandedCards: ref({}),
    modelProbeResults: ref({}),
    moduleAgentCandidateDrafts: ref({}),
    normalizeModelEntry: vi.fn(),
    replaceSettingsDraftFromServer: vi.fn(),
    ruleAuthoringModelAlias: vi.fn(() => ""),
    selectedModelProvider: ref("deepseek"),
    setBusy: vi.fn(),
    settingsDraft: ref({}),
    settingsPayloadForSave: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-navigation-controller", () => ({
  createConsoleNavigationController: vi.fn(() => navigationStateMock),
}));

vi.mock("../../../server-web/composables/console-option-bar-controller", () => ({
  createConsoleOptionBarController: vi.fn(() => ({
    addableModelProviderOptionBarOptions: ref([]),
    analysisModuleOptionBarOptions: ref([]),
    authRoleOptionBarOptions: ref([]),
    autoApproveRiskOptionBarOptions: ref([]),
    contextWindowOptionBarOptions: ref([]),
    discoveryModeOptionBarOptions: ref([]),
    enabledBooleanOptionBarOptions: ref([]),
    enabledStringOptionBarOptions: ref([]),
    moduleAccessModeOptionBarOptions: ref([]),
    moduleModelAssignmentSelectOptions: ref([]),
    plannerModeOptionBarOptions: ref([]),
    thinkingModeOptionBarOptions: ref([]),
    vocabularyStatusOptionBarOptions: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/console-ops-monitor-controller", () => ({
  createConsoleOpsMonitorController: vi.fn(() => ({
    acknowledgeMonitorAlert: vi.fn(),
    activeMonitorAlerts: ref([]),
    backgroundProcesses: ref([]),
    backgroundProcessStatus: ref(""),
    backgroundRunningCount: ref(0),
    backgroundSupervisorLabel: ref(""),
    clientRuntimeHeatRows: ref([]),
    clientRuntimeStatus: ref([]),
    clientRuntimeSummary: ref(""),
    monitorAlertConfigText: ref(""),
    monitorAlertState: ref(""),
    monitorAlertSummary: ref(""),
    queueMonitorItems: ref([]),
    queueMonitorState: ref(""),
    recentMonitorAlertHistory: ref([]),
    refreshBackgroundProcesses: vi.fn(),
    refreshClientRuntimeStatus: vi.fn(),
    refreshMonitorAlerts: vi.fn(),
    recoverBackgroundSupervisor: vi.fn(),
    saveMonitorAlertConfig: vi.fn(),
    workQueueRows: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/console-rule-authoring-controller", () => ({
  createConsoleRuleAuthoringController: vi.fn(() => ({
    publishRuleAuthoringPackage: vi.fn(),
    ruleActionOptionBarOptions: ref([]),
    ruleActionOptions: ref([]),
    ruleAuthoringCanSubmit: ref(true),
    ruleAuthoringEffectiveMessage: ref(""),
    ruleAuthoringForm: ref({ modelAlias: "" }),
    ruleAuthoringHistory: ref([]),
    ruleAuthoringManualSummary: ref(""),
    ruleAuthoringModelOptions: ref([]),
    ruleAuthoringResult: ref(null),
    ruleCreationMode: ref(""),
    ruleMatchStrategyOptionBarOptions: ref([]),
    ruleMatchStrategyOptions: ref([]),
    ruleScopeOptionBarOptions: ref([]),
    ruleScopeOptions: ref([]),
    runRuleAuthoringChat: vi.fn(),
    selectedRuleAuthoringModel: ref({ enabled: true, selectable: true, label: "规则模型" }),
  })),
}));

vi.mock("../../../server-web/composables/console-refresh-state-controller", () => ({
  createConsoleRefreshStateController: vi.fn(() => ({
    REFRESH_STATE_DELAY_MS: 1000,
    clearPendingRefreshState: vi.fn(),
    clearPendingRefreshStateTimer: vi.fn(),
    lastRefreshStateStartedAt: ref(0),
    mergeRefreshStateOptions: vi.fn((options) => options),
    normalizeRefreshStateOptions: vi.fn((options) => options),
    pendingRefreshStateOptions: ref({}),
    pendingRefreshStatePromise: ref(Promise.resolve(undefined)),
    pendingRefreshStateResolve: vi.fn(),
    pendingRefreshStateTimer: ref(null),
    performRefreshState: vi.fn(),
    refreshState: refreshStateMock.refreshState,
    scheduleDelayedRefreshState: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-runtime-lifecycle-controller", () => ({
  createConsoleRuntimeLifecycleController: vi.fn((deps) => ({
    mountConsoleRuntime: () => {
      runtimeLifecycleMock.mountConsoleRuntime();
      void deps.clearBrowserLocalStateFromUrl();
      deps.startServerEventSubscription();
    },
    unmountConsoleRuntime: () => {
      runtimeLifecycleMock.unmountConsoleRuntime();
      deps.stopServerEventSubscription();
    },
  })),
}));

vi.mock("../../../server-web/composables/console-server-event-controller", () => ({
  createConsoleServerEventController: vi.fn(() => ({
    applyConsoleState: vi.fn(),
    baseServerEventTopics: ["console.topic"],
    currentServerEventTopics: vi.fn(() => "console.topic"),
    uploadTraceEvents: ref([]),
    clearServerEventTimer: vi.fn(),
    isAbortError: vi.fn(() => false),
    nextCursorFromProtocolEvents: vi.fn(() => 0),
    resetServerEventCursor: vi.fn(),
    runServerEventSubscription: vi.fn(),
    serverEventAbortController: ref(null),
    serverEventCursor: ref(0),
    serverEventSubscriptionGeneration: ref(1),
    serverEventSubscriptionStopped: ref(false),
    serverEventTimer: ref(null),
    serverEventTimerResolve: vi.fn(),
    startServerEventSubscription: vi.fn(),
    stopServerEventSubscription: vi.fn(),
    waitForServerEventRetry: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-settings-bridge-controller", () => ({
  createConsoleSettingsBridgeController: vi.fn(() => ({
    applyRemoteConsoleDraftUpdate: vi.fn(),
    applyingRemoteConsoleDrafts: ref(false),
    bindSettingsDraftActions: vi.fn(),
    bindSettingsPersistenceActions: vi.fn(),
    disableMountModule: vi.fn(),
    enableMountModule: vi.fn(),
    isApplyingRemoteConsoleDrafts: ref(false),
    moduleAgentProfilesPayload: ref([]),
    normalizeHttpAdapterSettings: vi.fn(),
    normalizeModelLibraryAgents: vi.fn(),
    normalizedSettingsFromServer: ref({}),
    reloadModules: vi.fn(),
    remoteDraftEquals: vi.fn(),
    replaceSettingsDraftFromServer: vi.fn(),
    saveAgentPermissionSettings: vi.fn(),
    saveModelLibrarySettings: vi.fn(),
    saveModuleSettings: vi.fn(),
    saveMountModules: vi.fn(),
    saveSettings: vi.fn(),
    settingsDraftEquals: vi.fn(),
    settingsPayloadForSave: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-settings-draft-controller", () => ({
  createConsoleSettingsDraftController: vi.fn(() => ({
    settingsDraft: ref({
      agentExploreDefaults: {
        reviewFusionModelAlias: "",
      },
    }),
  })),
}));

vi.mock("../../../server-web/composables/console-settings-persistence-controller", () => ({
  createConsoleSettingsPersistenceController: vi.fn(() => ({
    agentPermissionGroups: ref([]),
    clearAllBusy: vi.fn(),
    ensureCodexOAuthReady: vi.fn(),
    error: ref(""),
    hasOpenAiModelUsage: vi.fn(() => false),
    modelEntryStatusKey: vi.fn(() => ""),
    mountDraft: ref({}),
    mountDraftDirty: ref(false),
    probeModelLibraryBeforeSave: vi.fn(),
    refreshState: vi.fn(),
    replaceSettingsDraftFromServer: vi.fn(),
    setBusy: vi.fn(),
    settingsDraft: ref({}),
    settingsDraftDirty: ref(false),
    settingsPayloadForSave: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-state-event-reducer-controller", () => ({
  createConsoleStateEventReducerController: vi.fn(() => ({
    applyConsoleState: vi.fn(),
    applyServerEvent: vi.fn(),
    baseServerEventTopics: [],
    currentServerEventTopics: vi.fn(() => ""),
    uploadTraceEvents: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/console-system-log-row-controller", () => ({
  createConsoleSystemLogRowController: vi.fn(() => ({
    baseServerLogRows: ref([]),
    collectSystemStatusLogRows: vi.fn(),
    compactLogDetail: vi.fn(),
    genericStatusTone: vi.fn(() => "neutral"),
    serverLogRows: ref([]),
    stateProgressPercent: ref(0),
  })),
}));

vi.mock("../../../server-web/composables/console-tool-management-controller", () => ({
  createConsoleToolManagementController: vi.fn(() => ({
    activeToolManagementToolCount: ref(0),
    addAgentPermissionGroup: vi.fn(),
    agentPermissionGroupOptionBarOptions: ref([]),
    agentPermissionGroups: ref([]),
    copyIssuedToolToken: vi.fn(),
    createGrant: vi.fn(),
    defaultAgentPermissionGroups: ref([]),
    deleteGrant: vi.fn(),
    enabledToolGrantCount: ref(0),
    ensureAgentPermissionGroupsDraft: vi.fn(),
    grantHasScope: vi.fn(() => false),
    grantHasToolset: vi.fn(() => false),
    grantToolRuleState: ref({}),
    internalToolManagementToolCount: ref(0),
    issuedToolToken: ref(""),
    newGrantLabel: ref(""),
    newGrantScopes: ref([]),
    newGrantToolsets: ref([]),
    permissionGroupHasScope: vi.fn(() => false),
    permissionGroupHasToolset: vi.fn(() => false),
    permissionGroupLabel: vi.fn(() => ""),
    policyPreviewGrant: ref(null),
    policyPreviewGrantId: ref(""),
    policyPreviewProfileId: ref(""),
    policyPreviewProfileOptionBarOptions: ref([]),
    policyPreviewResult: ref(null),
    policyPreviewToolId: ref(""),
    policyPreviewToolOptionBarOptions: ref([]),
    previewToolDefinition: ref(null),
    previewToolPolicy: ref(null),
    refreshToolManagement: vi.fn(),
    removeAgentPermissionGroup: vi.fn(),
    rotateGrant: vi.fn(),
    selectToolForManagement: vi.fn(),
    selectedToolManagementTool: ref(null),
    selectedToolManagementToolId: ref(""),
    setGrantToolRule: vi.fn(),
    setModelEntryPermissionGroup: vi.fn(),
    toggleGrantScope: vi.fn(),
    toggleGrantToolset: vi.fn(),
    toggleNewGrantScope: vi.fn(),
    toggleNewGrantToolset: vi.fn(),
    togglePermissionGroupScope: vi.fn(),
    togglePermissionGroupToolset: vi.fn(),
    toolCatalog: ref([]),
    toolGrants: ref([]),
    toolManagementAuditItems: ref([]),
    toolManagementCatalogState: ref({}),
    toolManagementGrantsState: ref({}),
    toolManagementMetricsState: ref({}),
    toolManagementProfiles: ref([]),
    toolManagementRiskRows: ref([]),
    toolManagementStatusRows: ref([]),
    toolManagementTools: ref([]),
    toolManagementToolsets: ref([]),
    toolScopes: ref([]),
    updateGrant: vi.fn(),
  })),
}));

vi.mock("../../../server-web/composables/console-word-cloud-controller", () => ({
  createConsoleWordCloudController: vi.fn(() => ({
    addChildWordCloud: vi.fn(),
    addManualWordCloud: vi.fn(),
    addTermActionToCloud: vi.fn(),
    addTermInputToCloud: vi.fn(),
    addTermToCloud: vi.fn(),
    addWordCloudCorpusPaths: vi.fn(),
    applySavedWordCloudSet: vi.fn(),
    applyWordCloudEvent: vi.fn(),
    autoFillCloudWithAgent: vi.fn(),
    clearAllBusy: vi.fn(),
    clearRemovedTermsFromCloud: vi.fn(),
    clearWordCloudCorpusPaths: vi.fn(),
    cloneWordCloudSet: vi.fn(),
    collapsedWordBagIds: ref([]),
    createDefaultWordCloudSet: vi.fn(),
    fillingWordBagIds: ref([]),
    findWordCloudInTree: vi.fn(),
    flattenWordCloudCards: vi.fn(),
    mutateWordCloudDraft: vi.fn(),
    normalizeWordCloudCloudForUi: vi.fn(),
    normalizeWordCloudCorpusPathForUi: vi.fn(),
    normalizeWordCloudCorpusPathsForUi: vi.fn(),
    normalizeWordCloudSetForUi: vi.fn(),
    normalizeWordCloudTermForUi: vi.fn(),
    persistWordCloudCorpusPaths: vi.fn(),
    pinWordCloud: vi.fn(),
    pinnedWordBagIds: ref([]),
    preferredWordCloudCorpusPaths: ref([]),
    proposeWordCloud: vi.fn(),
    refreshWordCloud: vi.fn(),
    refreshWordCloudCorpusTerms: vi.fn(),
    removeSelectedWordCloud: vi.fn(),
    removeTermFromCloud: vi.fn(),
    removeWordCloudCorpusPath: vi.fn(),
    resolveWordCloudCorpusPathsForQuery: vi.fn(),
    saveWordCloud: vi.fn(),
    selectWordCloud: vi.fn(),
    selectedWordBagId: ref(""),
    selectedWordCloud: ref(null),
    selectedWordCloudModel: ref({ enabled: true, selectable: true, label: "词云模型" }),
    setWordCloudDraftCorpusPaths: vi.fn(),
    setWordCloudDraftFromState: vi.fn(),
    setWordCloudTermInput: vi.fn(),
    toggleWordCloudActionMenu: vi.fn(),
    toggleWordCloudCollapsed: vi.fn(),
    updateSelectedWordCloudField: vi.fn(),
    updateWordCloudField: vi.fn(),
    wordBagActionMenuId: ref(""),
    wordCloudCanvasClouds: ref([]),
    wordCloudCardRows: ref([]),
    wordCloudCardStyle: ref({}),
    wordCloudCorpusPathLabel: vi.fn(),
    wordCloudCorpusPathSummary: vi.fn(),
    wordCloudCorpusPaths: ref([]),
    wordCloudDraft: ref({}),
    wordCloudMessages: ref([]),
    wordCloudModelAlias: ref(""),
    wordCloudModelOptions: ref([]),
    wordCloudPalette: ref([]),
    wordCloudPrompt: ref(""),
    wordCloudState: ref({}),
    wordCloudTermFrequencyMap: ref({}),
    wordCloudTermIdentity: vi.fn(),
    wordCloudTermInputs: ref([]),
    wordCloudTermWithFrequency: vi.fn(),
    wordCloudTerms: ref([]),
    wordCloudVisibleTerms: ref([]),
  })),
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesControllerMock.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: vi.fn(() => feedContextMock.current),
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: vi.fn(() => workspaceContextMock),
}));

function makeLooseController<T extends Record<string, unknown>>(base: T) {
  return new Proxy(base, {
    get(target, key) {
      if (key in target) {
        return target[key as keyof T];
      }
      const fallback = vi.fn(() => undefined);
      (fallback as any).value = undefined;
      target[key as keyof T] = fallback as any;
      return fallback;
    },
  }) as T;
}

function makeRouterRoute(path: string, viewId: string, tab = "") {
  routerState.route.fullPath = path;
  routerState.route.path = path;
  routerState.route.meta = { viewId };
  routerState.route.params = tab ? { tab } : {};
}

function createUseConsoleHarness() {
  const Shell = defineComponent({
    setup: () => useConsole(),
    template: "<div />",
  });
  return mount(Shell);
}

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
            h("p", String(props.subtitle || "")),
            h("button", { type: "button", class: "config-floating-panel-close", onClick: () => emit("close") }, "关闭"),
            h(
              "button",
              { type: "button", class: "config-floating-panel-verify", onClick: () => emit("verify"), disabled: !!props.verifying },
              props.verifying ? "校验中" : "校验配置",
            ),
            h("div", { class: "config-floating-panel-status", "data-tone": String(props.statusTone || ""), "data-label": String(props.statusLabel || "") }),
            slots.default?.(),
          ])
        : null;
  },
});

const HelpTooltipStub = defineComponent({
  name: "HelpTooltip",
  props: {
    ariaLabel: { type: String, default: "" },
    items: { type: Array, default: () => [] },
    text: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "help-tooltip-stub", "aria-label": props.ariaLabel }, String(props.text || ""));
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: { type: String, default: "" },
    label: { type: String, default: "" },
    showDot: { type: Boolean, default: true },
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label || ""));
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          class: "binary-checkbox-stub",
          disabled: props.disabled,
          onClick: () => {
            if (props.disabled) return;
            const next = !props.modelValue;
            emit("update:model-value", next);
            emit("update:modelValue", next);
            emit("change", next);
          },
        },
        String(props.label || ""),
      );
  },
});

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: {
    buttonClass: { type: String, default: "" },
    buttonText: { type: String, default: "" },
    kind: { type: String, default: "" },
    multiple: { type: Boolean, default: false },
  },
  emits: ["select"],
  setup(props, { emit, slots }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          class: ["browse-select-button-stub", props.buttonClass || ""],
          "data-kind": props.kind || "",
          "data-multiple": String(Boolean(props.multiple)),
          onClick: () => emit("select", [new File(["demo"], "attachment.txt", { type: "text/plain" })]),
        },
        slots.default?.(),
      );
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    label: { type: String, default: "" },
    modelValue: { type: String, default: "" },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
    includeEmpty: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "agent-model-option-bar-stub", "data-label": props.label }, [
        h("span", props.label || ""),
        h(
          "select",
          {
            value: props.modelValue || "",
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          [
            ...(props.includeEmpty ? [h("option", { value: "" }, "未分配智能体")] : []),
            ...(props.options as Array<{ label?: string; value?: string }>).map((option) =>
              h("option", { value: String(option.value ?? option.label ?? "") }, String(option.label ?? "")),
            ),
          ],
        ),
      ]);
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
      h("label", { class: "option-bar-stub", "data-label": props.label }, [
        h("span", props.label || ""),
        h(
          "select",
          {
            value: props.modelValue == null ? "" : String(props.modelValue),
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          (props.options as Array<{ label?: string; value?: string | number | boolean }>).map((option) =>
            h("option", { value: String(option.value) }, String(option.label || "")),
          ),
        ),
      ]);
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: { type: String, default: "" },
    open: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => h("section", { class: "config-fold-card-stub", "data-open": String(Boolean(props.open)) }, [h("h4", props.title || ""), slots.default?.()]);
  },
});

beforeEach(() => {
  routerState.route = reactive({
    fullPath: "/dashboard",
    path: "/dashboard",
    meta: { viewId: "dashboard" as string },
    params: {} as Record<string, string>,
  });
  routerState.push.mockReset();
  runtimeLifecycleMock.mountConsoleRuntime.mockReset();
  runtimeLifecycleMock.unmountConsoleRuntime.mockReset();
  browserStateMock.clearBrowserLocalStateFromUrlCore.mockReset();
  browserEffectsMock.confirmConsoleAction.mockReset();
  browserEffectsMock.copyConsoleTextWithFeedback.mockReset();
  browserEffectsMock.notifyConsoleAction.mockReset();
  featureAccessMock.hasAnyFeature.mockClear();
  featureAccessMock.hasFeature.mockClear();
  agentSelectorMock.cacheAgentModelOptionLabels.mockReset();
  agentExploreSessionMock.persistAgentExploreState.mockReset();
  expertRulesMock.refreshExpertRules.mockReset();
  knowledgeMaintenanceMock.refreshKnowledgeConsole.mockReset();
  refreshStateMock.refreshState.mockClear();
  infoFeedControllerMock.handleInfoFeedAttachmentFiles.mockReset();
  infoFeedControllerMock.removeInfoFeedAttachment.mockReset();
  infoFeedControllerMock.runInfoFeed.mockReset();
  infoFeedControllerMock.saveSettings.mockReset();
  workspaceContextMock.addCloudDriveExposure.mockReset();
  workspaceContextMock.applyCloudDriveSync.mockReset();
  workspaceContextMock.connectCloudDrive.mockReset();
  workspaceContextMock.downloadCloudDriveFile.mockReset();
  workspaceContextMock.listCloudDriveItems.mockReset();
  workspaceContextMock.listCloudDrivePermissions.mockReset();
  workspaceContextMock.planCloudDriveSync.mockReset();
  workspaceContextMock.removeCloudDriveExposure.mockReset();
  workspaceContextMock.uploadCloudDriveFile.mockReset();
  workspaceContextMock.selected.value = { title: "主工作区" };
  workspaceContextMock.panel.value = "cloudDrive";
  workspaceContextMock.busyKey.value = "";
  workspaceContextMock.cloudDriveForm = reactive({
    provider: "icloud",
    rootPath: "/Users/name/Library/Mobile Documents",
    driveRef: "",
    clientId: "client-a",
    managedFolderRoot: "/tmp/pact",
    publicFolder: "/public",
    allowedClients: "client-a",
    advancedMode: false,
    exposedDirectories: [
      {
        id: "exposure-1",
        name: "目录 1",
        path: "/tmp/pact/shared",
        permissionMode: "allowlist",
        subjects: "client-a",
        showPermissions: false,
      },
    ],
    path: "public/readme.txt",
    uploadPath: "public/upload.txt",
    uploadContent: "payload",
    targetPath: "cloud-drive",
  });
  workspaceContextMock.cloudDriveData.value = {
    connections: [
      {
        driveRef: "drive-a",
        provider: "icloud",
        mode: "local",
        directoryMappingCount: 1,
        contractVerified: true,
      },
    ],
  };
  workspaceContextMock.cloudDriveResult.value = null;
  feedContextMock.current = {
    agentSelectorOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
    busyKey: ref(""),
    contextWindowOptionBarOptions: ref([{ label: "32k", value: "32k" }]),
    handleInfoFeedAttachmentFiles: infoFeedControllerMock.handleInfoFeedAttachmentFiles,
    clearInfoFeedKeywordCache: infoFeedControllerMock.clearInfoFeedKeywordCache,
    infoFeedAttachments: ref([
      { id: "att-a", name: "draft.txt", status: "running" },
      { id: "att-b", name: "summary.md", status: "completed" },
    ]),
    infoFeedCurrentRun: ref(null),
    infoFeedForm: infoFeedControllerMock.infoFeedForm,
    infoFeedInputPlaceholder: ref("输入问题"),
    infoFeedModelOptions: ref([{ label: "GPT-5.4", value: "gpt-5.4" }]),
    infoFeedSubmitLabel: ref("开始信息流"),
    removeInfoFeedAttachment: infoFeedControllerMock.removeInfoFeedAttachment,
    runInfoFeed: infoFeedControllerMock.runInfoFeed,
    saveSettings: infoFeedControllerMock.saveSettings,
    selectedInfoFeedModel: infoFeedControllerMock.selectedInfoFeedModel,
    settingsDraft: infoFeedControllerMock.settingsDraft,
    thinkingModeOptionBarOptions: ref([{ label: "Balanced", value: "balanced" }]),
  };
  externalServicesControllerMock.current = makeLooseController({
    actionError: "",
    actionMessage: "",
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    closeConfigEditor: vi.fn(),
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    configDraft: reactive({
      binding: { mode: "passthrough", outlet: "pact.skillHub", risk: "read_only" },
      description: "",
      healthCheck: { type: "none", host: "127.0.0.1", port: null, timeoutMs: 60000, url: "", required: true },
      mode: "connected",
      metadata: {},
      scripts: {},
      serviceId: "mcp-docs",
      serviceName: "Docs MCP",
      startupPolicy: "external-only",
      upstream: {
        type: "cloud-drive",
        transport: "pact-upstream-gateway",
        provider: "icloud",
        rootPath: "/Users/name/Library/Mobile Documents/com~apple~CloudDocs",
        endpointRef: "config://drive-endpoint",
        endpointUrl: "https://drive.example",
        url: "https://drive.example",
        timeoutMs: 5000,
      },
    }),
    configEditorOpen: true,
    configEditorMode: "edit",
    configEditorSubtitle: "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configEditorTitle: "修改配置：服务",
    configStatusLabel: "Valid",
    configStatusTone: "success",
    configText: "{\n  \"serviceId\": \"mcp-docs\"\n}",
    customUpstreamTypeValue: "internal-proprietary-service",
    discoveredServiceCount: 1,
    dirty: false,
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    isCloudDriveServiceDraft: true,
    isLlmServiceDraft: true,
    loadError: "加载失败",
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: 4,
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: "openai-compatible",
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 2,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [{ value: "read_only", label: "read_only" }],
    saveConfig: vi.fn(),
    saving: false,
    serviceHeartbeatLastAtLabel: vi.fn(() => "Latest: -"),
    serviceSourceDetail: vi.fn(() => "本地 / mcp-docs"),
    serviceDiscoveryLabel: vi.fn(() => "MCP 服务"),
    serviceDiscoveryRegistrationLabel: vi.fn(() => "工具已发现"),
    serviceDiscoveryRegistrationTone: vi.fn(() => "success"),
    serviceDiscoveryTone: vi.fn(() => "success"),
    services: [
      {
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
        externalMcp: { tools: ["search", { name: "file.list" }, "search"] },
        upstreamTargetLabelText: "127.0.0.1:8787",
        upstreamTargetDetailText: "endpoint",
        sourceLabelText: "本地 / mcp-docs",
        discoveryLabelText: "MCP 服务",
        discoveryTone: "success",
        discoveryRegistrationLabelText: "工具已发现",
        discoveryRegistrationTone: "success",
        heartbeatText: "Latest: -",
        heartbeatRefreshing: false,
      },
    ],
    showCustomUpstreamType: true,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTargetDetailLabel: vi.fn(() => "endpoint"),
    upstreamTargetLabel: vi.fn(() => "127.0.0.1:8787"),
    upstreamTypeOptions: [{ value: "cloud-drive", label: "Cloud Drive Service" }],
    upstreamTypeSelectValue: "cloud-drive",
    validationErrors: ["缺少端口"],
    validationWarnings: ["建议添加 health check"],
    verifying: false,
    verifyConfig: vi.fn(),
    updateBindingField: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    updateModelProvider: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateRootField: vi.fn(),
    updateRequiredScopes: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    validationErrorsList: vi.fn(),
    validationWarningsList: vi.fn(),
  });
});

describe("server-web router instance", () => {
  it("registers canonical routes and redirects invalid tabs", async () => {
    expect(router.getRoutes().some((route) => route.path === "/external-services/:tab")).toBe(true);
    expect(router.getRoutes().some((route) => route.path === "/debug/:tab")).toBe(true);
    expect(router.getRoutes().find((route) => route.path === "/external-services/:tab")?.meta).toMatchObject({ viewId: "externalServices" });
    expect(router.getRoutes().find((route) => route.path === "/knowledge/:tab")?.meta).toMatchObject({ viewId: "knowledge" });

    await router.push("/external-services/bad");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/external-services/list");

    await router.push("/knowledge/bad");
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/bad");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");
  });
});

describe("useConsole", () => {
  it("mounts runtime, syncs route state, and tears down cleanly", async () => {
    makeRouterRoute("/knowledge/wordCloud", "knowledge", "wordCloud");
    const wrapper = createUseConsoleHarness();

    expect(runtimeLifecycleMock.mountConsoleRuntime).toHaveBeenCalledTimes(1);
    expect(browserStateMock.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledTimes(1);
    expect(browserStateMock.clearBrowserLocalStateFromUrlCore).toHaveBeenCalledWith({
      clearMemoryCaches: expect.any(Function),
    });
    expect(navigationStateMock.syncNavigationStateFromRoute).toHaveBeenCalledTimes(1);
    expect(navigationStateMock.currentView.value).toBe("knowledge");
    expect(navigationStateMock.knowledgeTab.value).toBe("wordCloud");
    expect(navigationStateMock.viewTitle.value).toBe("知识库");

    makeRouterRoute("/debug/knowledgeRecall", "debug", "knowledgeRecall");
    await nextTick();
    expect(navigationStateMock.currentView.value).toBe("debug");
    expect(navigationStateMock.debugTab.value).toBe("knowledgeRecall");

    wrapper.unmount();
    expect(runtimeLifecycleMock.unmountConsoleRuntime).toHaveBeenCalledTimes(1);
  });

  it("persists agent explore changes, reacts to knowledge panel switches, and exposes helpers", async () => {
    makeRouterRoute("/knowledge/management", "knowledge", "management");
    const wrapper = createUseConsoleHarness();
    const vm: any = wrapper.vm;

    agentExploreStateMock.agentExploreForm.value.modelAlias = "model-a";
    await nextTick();
    expect(agentExploreSessionMock.persistAgentExploreState).toHaveBeenCalled();

    agentExploreStateMock.agentExploreResult.value = { answer: "ok" };
    await nextTick();
    expect(agentExploreSessionMock.persistAgentExploreState).toHaveBeenCalledTimes(2);

    vm.knowledgeManagementPanel = "rules";
    await nextTick();
    expect(expertRulesMock.refreshExpertRules).toHaveBeenCalledTimes(1);

    vm.knowledgeManagementPanel = "sources";
    await nextTick();
    expect(knowledgeMaintenanceMock.refreshKnowledgeConsole).toHaveBeenCalledTimes(1);

    vm.error = "语料词频表为空，请先完成文档入库。";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(true);
    vm.error = "网络连接超时";
    await nextTick();
    expect(vm.errorNeedsKnowledgeImportAction).toBe(false);

    await vm.refreshState({ silent: true });
    expect(refreshStateMock.refreshState).toHaveBeenCalledWith({ silent: true });

    vm.importClients();
    vm.exportClients();
    expect(browserEffectsMock.notifyConsoleAction).toHaveBeenCalledWith("导入客户端功能正在开发中…");
    expect(browserEffectsMock.notifyConsoleAction).toHaveBeenCalledWith("导出客户端列表成功。");

    wrapper.unmount();
  });
});

describe("ExternalServicesView", () => {
  it("renders editor and list branches, and handles table interactions", async () => {
    const resizeObserverObserve = vi.fn();
    const resizeObserverDisconnect = vi.fn();
    class FakeResizeObserver {
      observe = resizeObserverObserve;
      disconnect = resizeObserverDisconnect;
      constructor(_cb: ResizeObserverCallback) {}
    }
    const previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver as any;

    const addListenerSpy = vi.spyOn(document, "addEventListener");
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");

    const wrapper = shallowMount(ExternalServicesView, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          ConfigFloatingPanel: ConfigFloatingPanelStub,
          HelpTooltip: HelpTooltipStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    await nextTick();
    await nextTick();

    expect(addListenerSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(resizeObserverObserve).toHaveBeenCalled();
    expect(wrapper.text()).toContain("修改配置：服务");
    expect(wrapper.text()).toContain("服务列表");
    expect(wrapper.text()).toContain("Docs MCP");
    expect(wrapper.text()).toContain("本地 / mcp-docs");
    expect(wrapper.text()).toContain("缺少端口");
    expect(wrapper.text()).toContain("建议添加 health check");
    expect(wrapper.find('input[placeholder="internal-proprietary-service"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("iCloud Root Path");
    expect(wrapper.find(".external-service-config-editor").exists()).toBe(true);

    const serviceTable = wrapper.get(".external-service-table-scroll").element as HTMLElement & {
      scrollWidth: number;
      clientWidth: number;
      scrollLeft: number;
      setPointerCapture: ReturnType<typeof vi.fn>;
      hasPointerCapture: ReturnType<typeof vi.fn>;
      releasePointerCapture: ReturnType<typeof vi.fn>;
    };
    Object.defineProperty(serviceTable, "scrollWidth", { configurable: true, value: 1200, writable: true });
    Object.defineProperty(serviceTable, "clientWidth", { configurable: true, value: 400, writable: true });
    Object.defineProperty(serviceTable, "scrollLeft", { configurable: true, value: 0, writable: true });
    serviceTable.setPointerCapture = vi.fn();
    serviceTable.hasPointerCapture = vi.fn(() => true);
    serviceTable.releasePointerCapture = vi.fn();
    Object.defineProperty(serviceTable, "querySelector", {
      configurable: true,
      value: vi.fn(() => wrapper.find(".external-service-table").element),
    });

    serviceTable.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    serviceTable.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(serviceTable.scrollLeft).toBe(0);

    const upstreamButton = wrapper.get(".external-service-upstream-copy");
    await upstreamButton.trigger("mouseenter");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);
    expect(wrapper.find(".external-service-upstream-bubble").text()).toBe("127.0.0.1:8787");
    await upstreamButton.trigger("click");
    expect(browserEffectsMock.copyConsoleTextWithFeedback).toHaveBeenCalledWith(expect.any(MouseEvent), "127.0.0.1:8787", { message: "已复制" });

    const toolButton = wrapper.get(".external-service-tool-list-button");
    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);
    expect(wrapper.find(".external-service-tool-popover").text()).toContain("工具列表");
    expect(wrapper.find(".external-service-tool-popover").text()).toContain("Docs MCP");

    await wrapper.get(".external-service-tool-popover-close").trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await wrapper.get(".config-floating-panel-close").trigger("click");
    expect(externalServicesControllerMock.current?.closeConfigEditor).toHaveBeenCalledTimes(1);
    await wrapper.get(".config-floating-panel-verify").trigger("click");
    expect(externalServicesControllerMock.current?.verifyConfig).toHaveBeenCalledTimes(1);
    await wrapper.get("form.external-service-config-form").trigger("submit");
    expect(externalServicesControllerMock.current?.saveConfig).toHaveBeenCalledTimes(1);

    await wrapper.get(".external-service-table-scroll").trigger("scroll");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);

    wrapper.unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);
    globalThis.ResizeObserver = previousResizeObserver;
    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });
});

describe("InfoFeedComposerPanel", () => {
  it("binds attachments, opens advanced options, and saves settings", async () => {
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

    expect(wrapper.findAll(".info-feed-attachment-chip")).toHaveLength(2);
    expect(wrapper.text()).toContain("draft.txt");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("summary.md");
    expect(wrapper.text()).toContain("完成");

    await wrapper.get("textarea").setValue("更新后的问题");
    expect(infoFeedControllerMock.infoFeedForm.value.query).toBe("更新后的问题");

    await wrapper.get(".browse-select-button-stub").trigger("click");
    expect(infoFeedControllerMock.handleInfoFeedAttachmentFiles).toHaveBeenCalledTimes(1);

    await wrapper.get(".agent-model-option-bar-stub select").setValue("gpt-5.4");
    expect(infoFeedControllerMock.infoFeedForm.value.modelAlias).toBe("gpt-5.4");

    expect(wrapper.get(".primary-action").attributes("disabled")).toBeUndefined();
    await wrapper.get(".info-feed-advanced-button").trigger("click");
    expect(wrapper.text()).toContain("高级选项");
    expect(wrapper.get(".config-fold-card-stub").attributes("data-open")).toBe("true");
    expect(wrapper.findAll(".option-bar-stub")).toHaveLength(2);

    await wrapper.get(".dialog-close-button").trigger("click");
    await nextTick();
    expect(wrapper.find(".info-feed-advanced-dialog").exists()).toBe(false);

    await wrapper.get(".info-feed-advanced-button").trigger("click");
    await wrapper.get("form.info-feed-advanced-form").trigger("submit");
    expect(infoFeedControllerMock.saveSettings).toHaveBeenCalledTimes(1);

    infoFeedControllerMock.selectedInfoFeedModel.value.enabled = false;
    await nextTick();
    expect(wrapper.get(".primary-action").element.disabled).toBe(true);

    await wrapper.get(".info-feed-attachment-chip button").trigger("click");
    expect(infoFeedControllerMock.removeInfoFeedAttachment).toHaveBeenCalledWith("att-a");
  });
});

describe("WorkspaceCloudDrivePanel", () => {
  it("toggles advanced mode, renders connections, and dispatches actions", async () => {
    const wrapper = mount(WorkspaceCloudDrivePanel, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          OptionBar: OptionBarStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("云盘 — 主工作区");
    expect(wrapper.text()).toContain("iCloud 受控目录");
    expect(wrapper.text()).toContain("已连接云盘");
    expect(wrapper.text()).toContain("contractVerified");

    await wrapper.get(".binary-checkbox-stub").trigger("click");
    expect(workspaceContextMock.cloudDriveForm.advancedMode).toBe(true);
    await nextTick();
    expect(wrapper.text()).toContain("权限配置");
    expect(wrapper.text()).toContain("移除");

    await wrapper.get("button.table-action").trigger("click");
    expect(workspaceContextMock.addCloudDriveExposure).toHaveBeenCalledTimes(1);

    await wrapper.findAll('button.table-action')[2].trigger("click");
    expect(workspaceContextMock.removeCloudDriveExposure).toHaveBeenCalledWith(0);

    const actionButtons = wrapper
      .findAll("button")
      .filter((button) =>
        ["连接", "列出", "下载", "上传", "同步计划", "应用同步", "权限"].includes(button.text()),
      );
    for (const button of actionButtons) {
      await button.trigger("click");
    }
    expect(workspaceContextMock.connectCloudDrive).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.listCloudDriveItems).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.downloadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.uploadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.planCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.applyCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(workspaceContextMock.listCloudDrivePermissions).toHaveBeenCalledTimes(1);

    await wrapper.get("button.tool-button.tool-button-ghost").trigger("click");
    expect(workspaceContextMock.panel.value).toBe("list");
  });
});
