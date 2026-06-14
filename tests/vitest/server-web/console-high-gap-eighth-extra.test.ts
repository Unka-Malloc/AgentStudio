// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentModelEntryCard from "../../../server-web/components/admin/agent-config/AgentModelEntryCard.vue";
import AuthorizationGovernancePanel from "../../../server-web/components/admin/authorization-governance/AuthorizationGovernancePanel.vue";
import {
  createAuthorizationGovernancePanels,
  type AuthorizationGovernanceSummary,
} from "../../../server-web/components/admin/authorization-governance/authorization-governance-panel-rows";
import MaintenanceAgentRunList from "../../../server-web/components/admin/maintenance-agent/MaintenanceAgentRunList.vue";
import ApprovalFlowCardList from "../../../server-web/components/approval/ApprovalFlowCardList.vue";
import RuleAuthoringPanel from "../../../server-web/components/knowledge/rules/RuleAuthoringPanel.vue";
import WorkspaceLocalDirectoryPanel from "../../../server-web/components/workspaces/detail/WorkspaceLocalDirectoryPanel.vue";
import WorkspaceProfilePanel from "../../../server-web/components/workspaces/detail/WorkspaceProfilePanel.vue";
import WorkspaceResourceMounts from "../../../server-web/components/workspaces/WorkspaceResourceMounts.vue";
import { pickAgentRetrievalShellContext } from "../../../server-web/composables/console-shell-agent-retrieval-context";
import { pickKnowledgeShellContext } from "../../../server-web/composables/console-shell-knowledge-context";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";
import { getToolManagementAudit, getToolManagementCatalog, getToolManagementGrants, getToolManagementMetrics, previewToolPolicy, createToolGrant, updateToolGrant, deleteToolGrant, rotateToolGrantToken } from "../../../server-web/lib/tool-management-client";

const mountedWrappers: VueWrapper[] = [];

const bridgeHttpMock = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

const serverConsoleShellMock = vi.hoisted(() => ({
  current: null as any,
}));

const maintenanceAgentViewMock = vi.hoisted(() => ({
  current: null as any,
}));

const workspacesViewMock = vi.hoisted(() => ({
  current: null as any,
}));

const approvalFlowViewMock = vi.hoisted(() => ({
  current: null as any,
}));

const knowledgeRulesContextMock = vi.hoisted(() => ({
  current: null as any,
}));

const knowledgeReviewUtilsMock = vi.hoisted(() => ({
  knowledgeReviewCanResolveWithDocument: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useOptionalServerConsoleShellContext: () => serverConsoleShellMock.current,
  useServerConsoleShellContext: () => serverConsoleShellMock.current,
}));

vi.mock("../../../server-web/composables/maintenanceAgentViewContext", () => ({
  useMaintenanceAgentViewContext: () => maintenanceAgentViewMock.current,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => workspacesViewMock.current,
}));

vi.mock("../../../server-web/composables/approvalFlowViewContext", () => ({
  useApprovalFlowViewContext: () => approvalFlowViewMock.current,
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeRulesContext: () => knowledgeRulesContextMock.current,
}));

vi.mock("../../../server-web/composables/console-knowledge-review-utils", () => ({
  knowledgeReviewCanResolveWithDocument: knowledgeReviewUtilsMock.knowledgeReviewCanResolveWithDocument,
}));

function flush() {
  return nextTick().then(() => Promise.resolve()).then(() => nextTick());
}

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: String,
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub", "data-title": props.title || "" }, slots.default?.());
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: String,
    label: String,
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone || "" }, props.label || "");
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: Boolean,
    label: String,
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "binary-checkbox-stub",
          type: "button",
          onClick: () => {
            const nextValue = !Boolean(props.modelValue);
            emit("update:modelValue", nextValue);
            emit("update:model-value", nextValue);
            emit("change", nextValue);
          },
        },
        props.label || "",
      );
  },
});

const SegmentedToggleStub = defineComponent({
  name: "SegmentedToggle",
  props: {
    modelValue: String,
    options: Array,
    ariaLabel: String,
  },
  emits: ["update:modelValue", "update:model-value"],
  setup(props, { emit }) {
    return () =>
      h("button", {
        class: "segmented-toggle-stub",
        type: "button",
        onClick: () => {
          const options = (props.options || []) as Array<{ value: string }>;
          const nextValue = options.find((item) => item.value !== props.modelValue)?.value || props.modelValue || "";
          emit("update:modelValue", nextValue);
          emit("update:model-value", nextValue);
        },
      }, String(props.modelValue || ""));
  },
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: {
    modelValue: String,
    label: String,
    options: Array,
  },
  emits: ["update:modelValue", "update:model-value"],
  setup(props, { emit }) {
    return () =>
      h(
        "input",
        {
          class: "agent-model-option-bar-stub",
          value: props.modelValue || "",
          onInput: (event: Event) => {
            const target = event.target as HTMLInputElement;
            emit("update:modelValue", target.value);
            emit("update:model-value", target.value);
          },
        },
      );
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    modelValue: String,
    label: String,
    options: Array,
  },
  emits: ["update:modelValue", "update:model-value"],
  setup(props, { emit }) {
    return () =>
      h(
        "select",
        {
          class: "option-bar-stub",
          "data-label": props.label || "",
          onChange: (event: Event) => {
            const target = event.target as HTMLSelectElement;
            emit("update:modelValue", target.value);
            emit("update:model-value", target.value);
          },
        },
        (props.options || []).map((option: any) =>
          h("option", { value: option.value, selected: option.value === props.modelValue }, option.label),
        ),
      );
  },
});

const SimplePanelStub = defineComponent({
  name: "RuleAuthoringResultPanel",
  setup() {
    return () => h("div", { class: "rule-authoring-result-panel-stub" }, "结果面板");
  },
});

const AgentModelEntryHeaderStub = defineComponent({
  name: "AgentModelEntryHeader",
  props: {
    entry: Object,
  },
  setup(props) {
    return () =>
      h(
        "button",
        {
          class: "agent-model-entry-header-stub",
          type: "button",
          onClick: () => serverConsoleShellMock.current.toggleModelLibraryCard(props.entry),
        },
        String((props.entry as any)?.label || ""),
      );
  },
});

const AgentModelEntrySummaryActionsStub = defineComponent({
  name: "AgentModelEntrySummaryActions",
  props: {
    entry: Object,
  },
  setup(props) {
    return () =>
      h("div", { class: "agent-model-entry-summary-actions-stub" }, [
        h("button", { type: "button", class: "probe-stub", onClick: () => serverConsoleShellMock.current.probeModelEntry(props.entry) }, "探测"),
        h("button", { type: "button", class: "export-stub", onClick: () => serverConsoleShellMock.current.exportAgentModelEntryConfig(props.entry) }, "导出"),
        h("button", { type: "button", class: "duplicate-stub", onClick: () => serverConsoleShellMock.current.duplicateModelEntry(props.entry) }, "复制"),
        h("button", { type: "button", class: "remove-stub", onClick: () => serverConsoleShellMock.current.removeModelProvider(props.entry) }, "移除"),
      ]);
  },
});

const AgentModelProviderFieldsStub = defineComponent({
  name: "AgentModelProviderFields",
  setup() {
    return () => h("div", { class: "agent-model-provider-fields-stub" }, "provider-fields");
  },
});

const AgentModelAccessPanelStub = defineComponent({
  name: "AgentModelAccessPanel",
  setup() {
    return () => h("div", { class: "agent-model-access-panel-stub" }, "access");
  },
});

const AgentModelBindingsPanelStub = defineComponent({
  name: "AgentModelBindingsPanel",
  setup() {
    return () => h("div", { class: "agent-model-bindings-panel-stub" }, "bindings");
  },
});

const AgentModelPromptPanelStub = defineComponent({
  name: "AgentModelPromptPanel",
  setup() {
    return () => h("div", { class: "agent-model-prompt-panel-stub" }, "prompt");
  },
});

function makeToolManagementResponse(value: unknown) {
  return Promise.resolve(value);
}

function makeAgentModelEntryShell() {
  const expanded = ref(false);
  const probeResult = ref<Record<string, unknown>>({});
  const modelProbeResults = ref<Record<string, unknown>>({});
  return {
    agentPermissionGroupOptionBarOptions: [],
    beginCodexOAuthLogin: vi.fn(),
    busyKey: ref(""),
    codexOAuthStatus: ref(null),
    duplicateModelEntry: vi.fn(),
    exportAgentModelEntryConfig: vi.fn(),
    intelligentModuleDefinitions: [],
    isModelLibraryCardExpanded: vi.fn(() => expanded.value),
    modelEntryBindingSummary: vi.fn(() => "binding summary"),
    modelEntryBindings: vi.fn(() => []),
    modelEntryIsBound: vi.fn(() => false),
    modelEntryModuleAccess: vi.fn(() => ({ mode: "all", moduleIds: [] })),
    modelEntryProbeResult: vi.fn(() => probeResult.value),
    modelEntryProbeStatusLabel: vi.fn(() => "ok"),
    modelEntryProbeStatusTone: vi.fn(() => "success"),
    modelEntryStatusKey: vi.fn((entry: { uid: string }) => entry.uid),
    modelProbeResults,
    modelProviderDefinition: vi.fn(() => ({ label: "Provider" })),
    moduleAccessModeOptionBarOptions: [],
    probeModelEntry: vi.fn(),
    providerLabel: vi.fn(() => "Provider"),
    removeModelProvider: vi.fn(),
    setModelEntryModuleAccessMode: vi.fn(),
    setModelEntryPermissionGroup: vi.fn(),
    settingsDraft: reactive({ googleApiKey: "" }),
    toggleModelEntryModuleAccess: vi.fn(),
    toggleModelLibraryCard: vi.fn((entry: { uid: string }) => {
      expanded.value = !expanded.value;
      modelProbeResults.value[entry.uid] = probeResult.value;
    }),
  };
}

function makeWorkspacesContext(overrides: Record<string, unknown> = {}) {
  return {
    busyKey: ref(""),
    connectLocalDirectory: vi.fn(),
    hotSwapProfile: vi.fn(),
    localDirForm: reactive({
      deleteExtraneous: false,
      maxFiles: 10,
      sourcePath: "",
      targetPath: "",
    }),
    localDirMountData: ref(null),
    panel: ref("list"),
    profileForm: reactive({
      contextProfileId: "",
      excludeSourceIds: "",
      includeSourceIds: "",
      modelAlias: "",
      ownedSourceIds: "",
      toolGrantId: "",
    }),
    selected: ref({ title: "主工作区" }),
    syncLocalDirectory: vi.fn(),
    ...overrides,
  };
}

function makeRuleAuthoringContext(overrides: Record<string, unknown> = {}) {
  return {
    busyKey: ref(""),
    highlightedConfigTarget: ref(""),
    ruleActionOptionBarOptions: ref([
      { label: "保留", value: "keep" },
      { label: "删除", value: "drop" },
    ]),
    ruleAuthoringCanSubmit: ref(true),
    ruleAuthoringForm: reactive({
      action: "keep",
      confidence: 0.8,
      matchStrategy: "exact",
      message: "",
      modelAlias: "",
      notes: "",
      ruleName: "",
      scope: "knowledge",
    }),
    ruleAuthoringModelOptions: ref([
      { label: "模型 A", value: "model-a" },
    ]),
    ruleAuthoringResult: ref(null),
    ruleCreationMode: ref("chat"),
    ruleMatchStrategyOptionBarOptions: ref([
      { label: "精确", value: "exact" },
      { label: "模糊", value: "fuzzy" },
    ]),
    ruleScopeOptionBarOptions: ref([
      { label: "知识", value: "knowledge" },
      { label: "规则", value: "rules" },
    ]),
    runRuleAuthoringChat: vi.fn(),
    ...overrides,
  };
}

function makeApprovalFlowContext(overrides: Record<string, unknown> = {}) {
  return {
    acceptKnowledgeReview: vi.fn(),
    approvalFlowCards: ref([]),
    approveAuthorization: vi.fn(),
    authorizationBusy: vi.fn(() => false),
    fuseKnowledgeReviewItem: vi.fn(),
    keepBothKnowledgeReview: vi.fn(),
    rejectAuthorization: vi.fn(),
    rejectKnowledgeReview: vi.fn(),
    replaceKnowledgeReview: vi.fn(),
    reviewBusy: vi.fn(() => false),
    reviewFusionDisabled: vi.fn(() => false),
    reviewKeepBothDisabled: vi.fn(() => false),
    ...overrides,
  };
}

function makeMaintenanceAgentContext(overrides: Record<string, unknown> = {}) {
  return {
    approveMaintenanceAgentRun: vi.fn(),
    busyKey: ref(""),
    canApproveMaintenanceAgent: ref(true),
    canRunMaintenanceAgent: ref(true),
    cancelMaintenanceAgentRun: vi.fn(),
    displayedMaintenanceAgentRuns: ref([]),
    formatCompactDate: vi.fn((value: string) => `compact(${value})`),
    maintenanceAgentRiskLabel: vi.fn((risk: string) => `risk:${risk}`),
    maintenanceAgentStatusLabel: vi.fn((status: string) => `status:${status}`),
    maintenanceAgentStatusTone: vi.fn((status: string) => (status === "awaiting_approval" ? "warning" : "info")),
    selectedMaintenanceAgentRun: ref(null),
    ...overrides,
  };
}

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  document.documentElement.lang = "";
  setConsoleLocaleState("zh-CN");
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorization governance rows", () => {
  it("projects governance panels and slices rows to the first six entries", () => {
    const governance: AuthorizationGovernanceSummary = {
      roles: Array.from({ length: 7 }, (_, index) => ({
        roleId: `role-${index}`,
        label: `角色 ${index}`,
        scopes: [`scope-${index}`],
        policyCount: index + 1,
      })),
      teams: [
        {
          teamId: "team-1",
          label: "团队 1",
          members: ["u-1", "u-2"],
          policyCount: 2,
        },
      ],
      userPolicies: [
        {
          userId: "user-1",
          teamIds: ["team-1"],
          policyCount: 3,
        },
      ],
      agentBindings: [
        {
          agentId: "agent-1",
          boundUserId: "user-9",
          groups: ["group-a"],
        },
      ],
      agentGroups: [
        {
          groupId: "group-1",
          label: "分组 1",
          enabled: false,
          policyCount: 4,
        },
      ],
      approvals: [
        {
          approvalId: "approval-1",
          grantKind: "once",
          agentId: "agent-1",
          userId: "user-1",
          resourceId: "resource-1",
        },
      ],
    };

    const panels = createAuthorizationGovernancePanels(governance, {
      itemText(item, keys, fallback) {
        for (const key of keys) {
          const value = item[key];
          if (value !== undefined && value !== null && value !== "") {
            return String(value);
          }
        }
        return fallback || "";
      },
      policyCount(item) {
        return Number((item as any).policyCount || 0);
      },
      shortList(value, fallback) {
        if (Array.isArray(value) && value.length > 0) {
          return value.join(", ");
        }
        return fallback || "无";
      },
    });

    expect(panels).toHaveLength(6);
    expect(panels[0].count).toBe(7);
    expect(panels[0].rows).toHaveLength(6);
    expect(panels[0].rows[0]).toEqual({
      key: "role-0",
      title: "角色 0",
      detail: "scope-0",
      meta: "1 个资源模板",
    });
    expect(panels[1].rows[0].detail).toBe("u-1, u-2");
    expect(panels[3].rows[0].detail).toBe("user-9");
    expect(panels[4].rows[0].meta).toBe("停用");
    expect(panels[5].rows[0]).toEqual({
      key: "approval-1",
      title: "once",
      detail: "agent-1 / user-1",
      meta: "resource-1",
    });
  });

  it("renders governance panel empty state and row content", () => {
    const wrapper = mount(AuthorizationGovernancePanel, {
      props: {
        panel: {
          title: "角色",
          count: 0,
          emptyLabel: "暂无角色",
          rows: [],
        },
      },
    });

    expect(wrapper.get(".panel-title strong").text()).toBe("角色");
    expect(wrapper.get(".panel-title span").text()).toBe("0");
    expect(wrapper.get(".governance-empty").text()).toBe("暂无角色");
  });
});

describe("tool management client", () => {
  it("forwards tool-management endpoints and payloads to the bridge layer", async () => {
    bridgeHttpMock.getJson
      .mockResolvedValueOnce(makeToolManagementResponse({ catalog: true }))
      .mockResolvedValueOnce(makeToolManagementResponse({ metrics: true }))
      .mockResolvedValueOnce(makeToolManagementResponse({ grants: [] }));
    bridgeHttpMock.postJson
      .mockResolvedValueOnce(makeToolManagementResponse({ audit: [] }))
      .mockResolvedValueOnce(makeToolManagementResponse({ preview: true }))
      .mockResolvedValueOnce(makeToolManagementResponse({ issue: true }))
      .mockResolvedValueOnce(makeToolManagementResponse({ grant: { id: "grant-a" } }))
      .mockResolvedValueOnce(makeToolManagementResponse({ grant: { id: "grant-b" } }))
      .mockResolvedValueOnce(makeToolManagementResponse({ grant: { id: "grant-c" } }));

    await expect(getToolManagementCatalog()).resolves.toEqual({ catalog: true });
    await expect(getToolManagementAudit(0)).resolves.toEqual({ audit: [] });
    await expect(getToolManagementMetrics()).resolves.toEqual({ metrics: true });
    await expect(getToolManagementGrants()).resolves.toEqual({ grants: [] });
    await expect(previewToolPolicy({ toolId: "tool-a" })).resolves.toEqual({ preview: true });
    await expect(createToolGrant({ label: "Grant A", scopes: ["knowledge:read"] })).resolves.toEqual({ issue: true });
    await expect(updateToolGrant("grant / 1", { label: "Grant B" })).resolves.toEqual({ grant: { id: "grant-a" } });
    await expect(deleteToolGrant("grant / 2")).resolves.toEqual({ grant: { id: "grant-b" } });
    await expect(rotateToolGrantToken("grant / 3")).resolves.toEqual({ grant: { id: "grant-c" } });

    expect(bridgeHttpMock.getJson.mock.calls).toEqual([
      ["/api/tool-management/v1/catalog"],
      ["/api/tool-management/v1/metrics/summary"],
      ["/api/tool-management/v1/grants"],
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[0]).toEqual([
      "/api/tool-management/v1/audit?limit=0",
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[1]).toEqual([
      "/api/tool-management/v1/policy/preview",
      { toolId: "tool-a" },
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[2]).toEqual([
      "/api/tool-management/v1/grants",
      { label: "Grant A", scopes: ["knowledge:read"] },
      { safetyConfirm: true },
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[3]).toEqual([
      "/api/tool-management/v1/grants/grant%20%2F%201",
      { label: "Grant B" },
      { safetyConfirm: true },
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[4]).toEqual([
      "/api/tool-management/v1/grants/grant%20%2F%202/revoke",
      { reason: "revoked_from_console" },
      { safetyConfirm: true },
    ]);
    expect(bridgeHttpMock.postJson.mock.calls[5]).toEqual([
      "/api/tool-management/v1/grants/grant%20%2F%203/rotate",
      {},
      { safetyConfirm: true },
    ]);
  });
});

describe("console shell projections", () => {
  it("projects agent retrieval shell groups and drops unrelated keys", () => {
    const context = {
      resetKnowledgeAgentExplore: "reset",
      agentExploreAgentOptions: ["agent-a"],
      agentExploreForm: { query: "q" },
      contextWindowOptionBarOptions: ["window"],
      highlightedConfigTarget: "target",
      runKnowledgeAgentExplore: vi.fn(),
      selectedAgentExploreModel: "model-a",
      thinkingModeOptionBarOptions: ["think"],
      agentExploreActiveTabId: "tab-a",
      agentExploreTabBusy: false,
      agentExploreTabs: ["tab-a"],
      closeAgentExploreTab: vi.fn(),
      isAgentExploreDraftSession: true,
      switchAgentExploreTab: vi.fn(),
      agentExploreHistoryPanelItems: [{ id: "history-1" }],
      agentExploreProgress: 0.5,
      agentExploreProgressVisible: true,
      deleteAgentExploreHistoryItem: vi.fn(),
      selectAgentExploreHistoryItem: vi.fn(),
      agentExploreResult: { answer: "ok" },
      agentExploreSplitDragging: false,
      agentExploreSplitLeftPercent: 40,
      agentExploreSplitRef: null,
      agentExploreSplitStyle: { width: "40%" },
      handleAgentExploreSplitKeydown: vi.fn(),
      startAgentExploreSplitResize: vi.fn(),
      agentExploreEventTime: "2026-06-05T00:00:00.000Z",
      agentExploreStepOpen: false,
      agentExploreSteps: [{ id: "step-1" }],
      agentExploreTraceOpen: true,
      agentExploreWorkspaceId: "ws-1",
      handleAgentExploreTraceToggle: vi.fn(),
      agentExploreAnswerHtml: "<p>ok</p>",
      agentExploreDocumentMarkdown: "# ok",
      agentExploreLinkedEvidenceRefs: ["e-1"],
      copyAgentExploreDocument: vi.fn(),
      exportAgentExploreDocument: vi.fn(),
      handleAgentAnswerClick: vi.fn(),
      unrelated: "ignored",
    } as any;

    const projected = pickAgentRetrievalShellContext(context);

    expect(projected.page).toEqual({ resetKnowledgeAgentExplore: "reset" });
    expect(projected.form.agentExploreForm).toEqual({ query: "q" });
    expect(projected.tabs.agentExploreActiveTabId).toBe("tab-a");
    expect(projected.progress.agentExploreHistoryPanelItems).toEqual([{ id: "history-1" }]);
    expect(projected.workspace.agentExploreSplitLeftPercent).toBe(40);
    expect(projected.trace.agentExploreWorkspaceId).toBe("ws-1");
    expect(projected.answer.agentExploreDocumentMarkdown).toBe("# ok");
    expect((projected as any).unrelated).toBeUndefined();
  });

  it("projects knowledge shell groups and preserves focused slices", () => {
    const context = {
      canMaintainKnowledge: true,
      canReadKnowledge: true,
      hasFeature: vi.fn(),
      infoFeedModelOptions: [{ label: "GPT", value: "gpt" }],
      ingestJob: { jobId: "ingest-1" },
      knowledgeManagementPanel: "sources",
      knowledgeManagementPanelOptionBarOptions: ["sources"],
      normalizedManifest: { manifests: [] },
      collapsedWordBagIds: ["bag-a"],
      knowledgeTab: "management",
      toggleWordCloudCollapsed: vi.fn(),
      knowledgeIngestExternalProvider: "provider-a",
      knowledgeIngestExternalRefs: ["ref-a"],
      knowledgeIngestExternalTargetLabels: ["label-a"],
      knowledgeIngestTargets: ["target-a"],
      knowledgeIngestTeamRefs: ["team-a"],
      knowledgeIngestUserRefs: ["user-a"],
      refreshExpertRules: vi.fn(),
      refreshIngestJob: vi.fn(),
      busyKey: "busy",
      canSubmitKnowledgeIngest: true,
      canWriteJobs: true,
      ingestFiles: [],
      ingestProgress: 0.25,
      knowledgeIngestTargetValidationMessage: "",
      onIngestFilesSelected: vi.fn(),
      uploadFilesToKnowledge: vi.fn(),
      canAdminKnowledge: true,
      enabledStringOptionBarOptions: ["enabled"],
      knowledgeConfigGroupDescription: "desc",
      knowledgeConsole: {},
      knowledgeSchema: {},
      maintenanceFieldValue: "value",
      maintenanceJson: "{}",
      saveKnowledgeMaintenance: vi.fn(),
      setMaintenanceFieldFromEvent: vi.fn(),
      setMaintenanceFieldValue: vi.fn(),
      addVocabularyEntry: vi.fn(),
      deleteVocabularyEntry: vi.fn(),
      displayedVocabularyEntries: [{ id: "v-1" }],
      emailReportSeriesRules: [],
      emailSynonymRules: [],
      expertRuleEnabled: true,
      expertVocabularyDraft: {},
      goldenRuleItems: [],
      goldenRulePackageTitle: "pkg",
      goldenRulePackages: [],
      hiddenVocabularyEntryCount: 0,
      highlightedConfigTarget: "target-a",
      publishRuleAuthoringPackage: vi.fn(),
      ruleActionOptionBarOptions: [],
      ruleAuthoringCanSubmit: true,
      ruleAuthoringForm: { message: "hello" },
      ruleAuthoringModelOptions: [{ label: "Model", value: "model-a" }],
      ruleAuthoringResult: null,
      ruleCreationMode: "chat",
      ruleMatchStrategyOptionBarOptions: [],
      ruleScopeOptionBarOptions: [],
      rulesText: "text",
      runRuleAuthoringChat: vi.fn(),
      saveExpertVocabulary: vi.fn(),
      saveRules: vi.fn(),
      setEmailRuleEntryEnabled: vi.fn(),
      setVocabularyEntryEnabled: vi.fn(),
      showAllVocabularyEntries: true,
      toggleGoldenRuleEnabled: vi.fn(),
      updateVocabularyDomains: vi.fn(),
      updateVocabularyKeywords: vi.fn(),
      updateVocabularyPath: vi.fn(),
      vocabularyEntryPath: "path",
      vocabularySearch: "search",
      addChildWordCloud: vi.fn(),
      addManualWordCloud: vi.fn(),
      addTermActionToCloud: vi.fn(),
      addTermInputToCloud: vi.fn(),
      clearRemovedTermsFromCloud: vi.fn(),
      clearWordCloudCorpusPaths: vi.fn(),
      openWordCloudCorpusDirectoryPicker: vi.fn(),
      openWordCloudCorpusFilePicker: vi.fn(),
      pinWordCloud: vi.fn(),
      pinnedWordBagIds: ["bag-c"],
      removeTermFromCloud: vi.fn(),
      removeWordCloudCorpusPath: vi.fn(),
      saveWordCloud: vi.fn(),
      selectWordCloud: vi.fn(),
      selectedWordCloud: {},
      setWordCloudTermInput: vi.fn(),
      toggleWordCloudActionMenu: vi.fn(),
      wordBagActionMenuId: "menu-1",
      wordCloudCardRows: [],
      wordCloudCardStyle: {},
      wordCloudCorpusPathLabel: vi.fn(),
      wordCloudCorpusPathSummary: vi.fn(),
      wordCloudCorpusPaths: [],
      wordCloudDraft: {},
      wordCloudMessages: [],
      wordCloudModelAlias: "alias",
      wordCloudState: {},
      wordCloudTermInputs: [],
      wordCloudTerms: [],
      wordCloudVisibleTerms: [],
      unrelated: "ignored",
    } as any;

    const projected = pickKnowledgeShellContext(context);

    expect(projected.page).toMatchObject({
      canMaintainKnowledge: true,
      canReadKnowledge: true,
      ingestJob: { jobId: "ingest-1" },
      knowledgeManagementPanel: "sources",
      normalizedManifest: { manifests: [] },
    });
    expect(projected.viewState).toMatchObject({
      collapsedWordBagIds: ["bag-a"],
      knowledgeTab: "management",
    });
    expect(projected.libraryRuntime).toMatchObject({
      knowledgeIngestExternalProvider: "provider-a",
      refreshExpertRules: expect.any(Function),
    });
    expect(projected.rules).toMatchObject({
      highlightedConfigTarget: "target-a",
      ruleCreationMode: "chat",
      ruleAuthoringForm: { message: "hello" },
    });
    expect(projected.wordCloud).toMatchObject({
      pinnedWordBagIds: ["bag-c"],
      wordCloudModelAlias: "alias",
    });
    expect((projected as any).unrelated).toBeUndefined();
  });
});

describe("AgentModelEntryCard", () => {
  it("toggles expansion, updates core fields, and forwards summary actions", async () => {
    const shell = makeAgentModelEntryShell();
    serverConsoleShellMock.current = shell;

    const entry = reactive({
      uid: "model-1",
      instanceId: "model-1",
      provider: "custom-http",
      alias: "model-1",
      label: "Model One",
      model: "test-model",
      baseUrl: "",
      url: "",
      apiKey: "",
      apiKeyConfigured: false,
      token: "",
      tokenConfigured: false,
      tokenHeader: "token",
      tokenPrefix: "",
      pluginList: [],
      engine: "",
      systemPrompt: "",
      parameters: {},
      moduleAccess: { mode: "all", moduleIds: [] },
      permissionGroupId: "",
      timeoutMs: 120000,
      parametersText: "{}",
    });

    const wrapper = mount(AgentModelEntryCard, {
      props: { entry },
      global: {
        stubs: {
          AgentModelAccessPanel: AgentModelAccessPanelStub,
          AgentModelBindingsPanel: AgentModelBindingsPanelStub,
          AgentModelEntryHeader: AgentModelEntryHeaderStub,
          AgentModelEntrySummaryActions: AgentModelEntrySummaryActionsStub,
          AgentModelPromptPanel: AgentModelPromptPanelStub,
          AgentModelProviderFields: AgentModelProviderFieldsStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".model-library-card").attributes("data-expanded")).toBe("false");
    expect(wrapper.find(".model-library-card-body").exists()).toBe(false);

    await wrapper.get(".agent-model-entry-header-stub").trigger("click");
    await flush();

    expect(shell.toggleModelLibraryCard).toHaveBeenCalledWith(entry);
    expect(wrapper.get(".model-library-card").attributes("data-expanded")).toBe("true");
    expect(wrapper.find(".model-library-card-body").exists()).toBe(true);
    expect(wrapper.get(".agent-model-provider-fields-stub").text()).toBe("provider-fields");
    expect(wrapper.get(".agent-model-access-panel-stub").text()).toBe("access");
    expect(wrapper.get(".agent-model-bindings-panel-stub").text()).toBe("bindings");
    expect(wrapper.get(".agent-model-prompt-panel-stub").text()).toBe("prompt");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(2);
    await inputs[0].setValue("Model Two");
    await inputs[1].setValue("model-two");
    expect(entry.label).toBe("Model Two");
    expect(entry.model).toBe("model-two");

    await wrapper.get(".probe-stub").trigger("click");
    await wrapper.get(".export-stub").trigger("click");
    await wrapper.get(".duplicate-stub").trigger("click");
    await wrapper.get(".remove-stub").trigger("click");

    expect(shell.probeModelEntry).toHaveBeenCalledWith(entry);
    expect(shell.exportAgentModelEntryConfig).toHaveBeenCalledWith(entry);
    expect(shell.duplicateModelEntry).toHaveBeenCalledWith(entry);
    expect(shell.removeModelProvider).toHaveBeenCalledWith(entry);
  });
});

describe("MaintenanceAgentRunList", () => {
  it("renders run rows, selection, and row actions", async () => {
    const context = makeMaintenanceAgentContext({
      displayedMaintenanceAgentRuns: ref([
        {
          runId: "run-1",
          intent: "整理缓存",
          updatedAt: "2026-06-05T00:00:00.000Z",
          status: "awaiting_approval",
          risk: "medium",
        },
        {
          runId: "run-2",
          intent: "清理索引",
          updatedAt: "2026-06-04T12:00:00.000Z",
          status: "running",
          risk: "high",
        },
      ]),
    });
    maintenanceAgentViewMock.current = context;

    const wrapper = mount(MaintenanceAgentRunList, {
      global: {
        stubs: {
          StatusPill: StatusPillStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    expect(wrapper.text()).toContain("运行记录");
    expect(wrapper.findAll(".job-row")).toHaveLength(2);
    expect(wrapper.get(".job-row .table-action").text()).toContain("整理缓存 / compact(2026-06-05T00:00:00.000Z)");
    expect(wrapper.findAll(".status-pill-stub")[0].text()).toBe("status:awaiting_approval / risk:medium");
    expect(wrapper.findAll(".status-pill-stub")[1].text()).toBe("status:running / risk:high");

    await wrapper.get(".job-row .table-action").trigger("click");
    expect(context.selectedMaintenanceAgentRun.value).toEqual({
      runId: "run-1",
      intent: "整理缓存",
      updatedAt: "2026-06-05T00:00:00.000Z",
      status: "awaiting_approval",
      risk: "medium",
    });

    const buttons = wrapper.findAll(".table-actions-inline button");
    expect(buttons).toHaveLength(3);
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await buttons[2].trigger("click");

    expect(context.approveMaintenanceAgentRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(context.cancelMaintenanceAgentRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(context.cancelMaintenanceAgentRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-2" }));
  });

  it("renders the empty state when there are no runs", () => {
    const context = makeMaintenanceAgentContext({
      displayedMaintenanceAgentRuns: ref([]),
    });
    maintenanceAgentViewMock.current = context;

    const wrapper = mount(MaintenanceAgentRunList);

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".empty-state strong").text()).toBe("暂无维护运行");
  });
});

describe("ApprovalFlowCardList", () => {
  it("renders authorization and review actions for pending cards", async () => {
    knowledgeReviewUtilsMock.knowledgeReviewCanResolveWithDocument.mockImplementation((review: any) => Boolean(review.canResolve));
    const context = makeApprovalFlowContext({
      approvalFlowCards: ref([
        {
          key: "authorization-1",
          kind: "authorization",
          label: "授权",
          title: "工具授权",
          meta: ["meta-a"],
          summary: "待处理授权",
          tone: "warning",
          request: { status: "pending", requestId: "auth-1" },
        },
        {
          key: "review-1",
          kind: "review",
          label: "知识",
          title: "知识冲突",
          meta: ["meta-b"],
          summary: "待处理知识",
          tone: "danger",
          review: { status: "pending", reason: "source_path_content_conflict", canResolve: true },
        },
        {
          key: "review-2",
          kind: "review",
          label: "知识",
          title: "普通审查",
          meta: ["meta-c"],
          summary: "待处理知识",
          tone: "neutral",
          review: { status: "pending", canResolve: false },
        },
      ]),
    });
    approvalFlowViewMock.current = context;

    const wrapper = mount(ApprovalFlowCardList);

    mountedWrappers.push(wrapper);

    expect(wrapper.findAll(".approval-request-card")).toHaveLength(3);
    expect(wrapper.text()).toContain("批准");
    expect(wrapper.text()).toContain("覆盖旧知识");
    expect(wrapper.text()).toContain("保留两者");
    expect(wrapper.text()).toContain("知识融合");
    expect(wrapper.text()).toContain("接受");

    await wrapper.get(".approval-request-card-actions .configuration-alert-action").trigger("click");
    expect(context.approveAuthorization).toHaveBeenCalledWith({ status: "pending", requestId: "auth-1" });
    await wrapper.get(".approval-request-card-actions .danger-action").trigger("click");
    expect(context.rejectAuthorization).toHaveBeenCalledWith({ status: "pending", requestId: "auth-1" });

    const [authorizationActions, reviewConflictActions, reviewFallbackActions] = wrapper
      .findAll(".approval-request-card-actions");

    const reviewButtons = [
      ...reviewConflictActions.findAll("button"),
      ...reviewFallbackActions.findAll("button"),
    ];
    expect(reviewButtons.map((button) => button.text())).toEqual([
      "覆盖旧知识",
      "保留两者",
      "知识融合",
      "放弃",
      "接受",
      "放弃",
    ]);
    await authorizationActions.findAll("button")[0].trigger("click");
    await authorizationActions.findAll("button")[1].trigger("click");
    await reviewButtons[0].trigger("click");
    await reviewButtons[1].trigger("click");
    await reviewButtons[2].trigger("click");
    await reviewButtons[3].trigger("click");
    await reviewButtons[4].trigger("click");
    await reviewButtons[5].trigger("click");

    expect(context.replaceKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true }));
    expect(context.keepBothKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true }));
    expect(context.fuseKnowledgeReviewItem).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true }));
    expect(context.rejectKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true }));
    expect(context.acceptKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({ canResolve: false }));
    expect(context.rejectKnowledgeReview).toHaveBeenCalledWith(expect.objectContaining({ canResolve: false }));
  });

  it("renders the empty state when there are no approval cards", () => {
    approvalFlowViewMock.current = makeApprovalFlowContext({
      approvalFlowCards: ref([]),
    });

    const wrapper = mount(ApprovalFlowCardList);

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".approval-request-empty-card strong").text()).toBe("没有待处理的授权请求");
  });

  it("renders the empty state in English when the console locale is English", () => {
    setConsoleLocaleState("en");
    approvalFlowViewMock.current = makeApprovalFlowContext({
      approvalFlowCards: ref([]),
    });

    const wrapper = mount(ApprovalFlowCardList);

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".approval-request-empty-card strong").text()).toBe("No Pending Authorization Requests");
    expect(wrapper.get(".approval-request-empty-card span").text()).toBe("No approval items require manual review.");
  });
});

describe("RuleAuthoringPanel", () => {
  it("binds chat and manual form controls and shows the result panel", async () => {
    const context = makeRuleAuthoringContext({
      ruleAuthoringResult: ref({
        status: "done",
        runId: "run-1",
        steps: [{ stage: "draft", status: "ok" }],
        confirmation: { packageId: "pkg-1", version: "2" },
        gate: { passed: true },
        package: { rules: [] },
      }),
    });
    knowledgeRulesContextMock.current = context;

    const wrapper = mount(RuleAuthoringPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          OptionBar: OptionBarStub,
          RuleAuthoringResultPanel: SimplePanelStub,
          SegmentedToggle: SegmentedToggleStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    expect(wrapper.text()).toContain("创建规则");
    expect(wrapper.get(".rule-authoring-form").attributes("data-mode")).toBe("chat");
    expect(wrapper.get("textarea").attributes("placeholder")).toContain("生成一个黄金规则");
    expect(wrapper.get(".agent-model-option-bar-stub").exists()).toBe(true);

    await wrapper.get("textarea").setValue("生成一个规则");
    await wrapper.get(".agent-model-option-bar-stub").setValue("model-b");
    expect(context.ruleAuthoringForm.message).toBe("生成一个规则");
    expect(context.ruleAuthoringForm.modelAlias).toBe("model-b");

    context.ruleCreationMode.value = "manual";
    await flush();

    expect(wrapper.get(".rule-authoring-form").attributes("data-mode")).toBe("manual");
    expect(wrapper.text()).toContain("按配置创建规则");
    expect(wrapper.findAll(".option-bar-stub")).toHaveLength(3);

    const [scopeSelect, strategySelect, actionSelect] = wrapper.findAll(".option-bar-stub");
    await scopeSelect.setValue("rules");
    await strategySelect.setValue("fuzzy");
    await actionSelect.setValue("drop");
    await wrapper.get('input[type="text"]').setValue("重复知识处理规则");
    await wrapper.get('input[type="number"]').setValue("0.45");
    await wrapper.get("textarea").setValue("补充说明");

    expect(context.ruleAuthoringForm.scope).toBe("rules");
    expect(context.ruleAuthoringForm.matchStrategy).toBe("fuzzy");
    expect(context.ruleAuthoringForm.action).toBe("drop");
    expect(context.ruleAuthoringForm.ruleName).toBe("重复知识处理规则");
    expect(context.ruleAuthoringForm.confidence).toBe(0.45);
    expect(context.ruleAuthoringForm.notes).toBe("补充说明");

    await wrapper.get("form").trigger("submit");
    expect(context.runRuleAuthoringChat).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".rule-authoring-result-panel-stub").text()).toBe("结果面板");
  });

  it("renders the create rule controls in English when the shell language is English", async () => {
    serverConsoleShellMock.current = {
      languageMode: "en",
    };
    const context = makeRuleAuthoringContext();
    knowledgeRulesContextMock.current = context;

    const wrapper = mount(RuleAuthoringPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          OptionBar: OptionBarStub,
          RuleAuthoringResultPanel: SimplePanelStub,
          SegmentedToggle: SegmentedToggleStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    const toggleOptions = wrapper.findComponent(SegmentedToggleStub).props("options") as Array<{ value: string; label: string }>;
    expect(toggleOptions).toEqual([
      { value: "chat", label: "AI Chat" },
      { value: "manual", label: "Manual Config" },
    ]);
    expect(wrapper.findComponent(SegmentedToggleStub).props("ariaLabel")).toBe("Create Rule Mode");
    expect(wrapper.text()).toContain("Create Rule");
    expect(wrapper.text()).toContain("Requirement");
    expect(wrapper.get("textarea").attributes("placeholder")).toBe(
      "Example: create a golden rule that skips identical knowledge.",
    );
    expect(wrapper.findComponent(AgentModelOptionBarStub).props("label")).toBe("Agents");
    expect(wrapper.get(".primary-action").text()).toBe("Generate Rule Draft");

    context.ruleCreationMode.value = "manual";
    await flush();

    expect(wrapper.get(".primary-action").text()).toBe("Create Rule from Config");
    expect(wrapper.findAll(".option-bar-stub").map((item) => item.attributes("data-label"))).toEqual([
      "Scope",
      "Match Method",
      "Action",
    ]);
    expect(wrapper.text()).not.toContain("智能对话");
    expect(wrapper.text()).not.toContain("人工配置");
    expect(wrapper.text()).not.toContain("生成规则草稿");
  });

  it("uses the English document language when the injected shell language is stale", () => {
    document.documentElement.lang = "en";
    serverConsoleShellMock.current = {
      languageMode: "zh-CN",
    };
    const context = makeRuleAuthoringContext();
    knowledgeRulesContextMock.current = context;

    const wrapper = mount(RuleAuthoringPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          OptionBar: OptionBarStub,
          RuleAuthoringResultPanel: SimplePanelStub,
          SegmentedToggle: SegmentedToggleStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    const toggleOptions = wrapper.findComponent(SegmentedToggleStub).props("options") as Array<{ value: string; label: string }>;
    expect(toggleOptions.map((option) => option.label)).toEqual(["AI Chat", "Manual Config"]);
    expect(wrapper.text()).toContain("Requirement");
    expect(wrapper.get("textarea").attributes("placeholder")).toBe(
      "Example: create a golden rule that skips identical knowledge.",
    );
    expect(wrapper.get(".primary-action").text()).toBe("Generate Rule Draft");
    expect(wrapper.text()).not.toContain("需求");
    expect(wrapper.text()).not.toContain("生成规则草稿");
  });
});

describe("workspace detail panels", () => {
  it("binds profile hot swap form controls and cancel action", async () => {
    const context = makeWorkspacesContext({
      panel: ref("profile"),
    });
    workspacesViewMock.current = context;

    const wrapper = mount(WorkspaceProfilePanel);
    mountedWrappers.push(wrapper);

    expect(wrapper.get("h4").text()).toContain("热切换 Profile");
    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(6);
    await inputs[0].setValue("context-32k");
    await inputs[1].setValue("grant-1");
    await inputs[2].setValue("model-a");
    await inputs[3].setValue("source-a, source-b");
    await inputs[4].setValue("source-c");
    await inputs[5].setValue("source-d");
    expect(context.profileForm.contextProfileId).toBe("context-32k");
    expect(context.profileForm.toolGrantId).toBe("grant-1");
    expect(context.profileForm.modelAlias).toBe("model-a");
    expect(context.profileForm.ownedSourceIds).toBe("source-a, source-b");
    expect(context.profileForm.includeSourceIds).toBe("source-c");
    expect(context.profileForm.excludeSourceIds).toBe("source-d");

    await wrapper.get("button").trigger("click");
    expect(context.hotSwapProfile).toHaveBeenCalledTimes(1);
    context.busyKey.value = "ws:profile";
    await flush();
    expect(wrapper.get("button").text()).toBe("切换中…");

    await wrapper.findAll("button")[1].trigger("click");
    expect(context.panel.value).toBe("list");
  });

  it("connects a local directory and syncs mounted paths", async () => {
    const context = makeWorkspacesContext({
      panel: ref("localDir"),
      localDirMountData: ref({
        count: 1,
        mounts: [
          {
            mountRef: "mount-12345678901234567890",
            sourceRootName: "workspace",
            targetPath: "mirror",
            status: "active",
          },
        ],
      }),
    });
    workspacesViewMock.current = context;

    const wrapper = mount(WorkspaceLocalDirectoryPanel, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(3);
    await inputs[0].setValue("/Users/me/workspace");
    await inputs[1].setValue("mirror");
    await inputs[2].setValue("200");
    await wrapper.get(".binary-checkbox-stub").trigger("click");
    expect(context.localDirForm.sourcePath).toBe("/Users/me/workspace");
    expect(context.localDirForm.targetPath).toBe("mirror");
    expect(context.localDirForm.maxFiles).toBe(200);
    expect(context.localDirForm.deleteExtraneous).toBe(true);

    await wrapper.get(".module-actions button").trigger("click");
    expect(context.connectLocalDirectory).toHaveBeenCalledTimes(1);

    expect(wrapper.get(".workspace-mount-row code").text()).toContain("mount-123456789012345");
    expect(wrapper.get(".workspace-mount-row span").text()).toContain("workspace -> mirror");
    expect(wrapper.get(".workspace-mount-row button").text()).toBe("同步");

    await wrapper.get(".workspace-mount-row button").trigger("click");
    expect(context.syncLocalDirectory).toHaveBeenCalledWith(expect.objectContaining({ mountRef: "mount-12345678901234567890" }));

    context.busyKey.value = "ws:local-dir-sync:mount-12345678901234567890";
    await flush();
    expect(wrapper.get(".workspace-mount-row button").text()).toBe("同步中…");
  });

  it("renders the workspace resource mounts empty state and populated actions", async () => {
    const context = {
      busyKey: ref(""),
      cloudDriveData: ref(null),
      codespaceData: ref(null),
      localDirMountData: ref(null),
      openCloudDrive: vi.fn(),
      openCodespace: vi.fn(),
      openLocalDir: vi.fn(),
      syncLocalDirectory: vi.fn(),
    };
    workspacesViewMock.current = context;

    const emptyWrapper = mount(WorkspaceResourceMounts, {
      global: {
        stubs: {
          ConfigFoldCard: ConfigFoldCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    mountedWrappers.push(emptyWrapper);

    expect(emptyWrapper.text()).toContain("当前工作空间还没有连接本机目录。");
    expect(emptyWrapper.text()).toContain("当前工作空间还没有连接云盘。");
    expect(emptyWrapper.text()).toContain("Codespace provider manifest 尚未加载。");

    emptyWrapper.unmount();
    mountedWrappers.pop();

    workspacesViewMock.current = {
      ...context,
      localDirMountData: ref({
        count: 1,
        mounts: [
          {
            mountRef: "mount-1",
            sourceRootName: "workspace",
            targetPath: "",
            status: "active",
          },
        ],
      }),
      cloudDriveData: ref({
        connectedProviderCount: 1,
        providerCount: 2,
        connections: [
          {
            driveRef: "drive-1",
            provider: "icloud",
            mode: "local",
            rootName: "Library",
            secretRef: "secret-1",
            contractVerified: true,
          },
        ],
      }),
      codespaceData: ref({
        enabledProviderCount: 1,
        providerCount: 1,
        providers: [
          {
            provider: "github",
            mode: "oauth",
            secretRef: "secret-2",
            enabled: true,
          },
        ],
      }),
    };

    const wrapper = mount(WorkspaceResourceMounts, {
      global: {
        stubs: {
          ConfigFoldCard: ConfigFoldCardStub,
          StatusPill: StatusPillStub,
        },
      },
    });

    mountedWrappers.push(wrapper);

    expect(wrapper.text()).toContain("1 个受控目录");
    expect(wrapper.text()).toContain("1 / 2 个 provider 已连接");
    expect(wrapper.text()).toContain("1 / 1 个 provider 可用");
    expect(wrapper.findAll(".workspace-resource-row")).toHaveLength(3);

    const toolbarButtons = wrapper.findAll(".checkpoint-toolbar button");
    await toolbarButtons[0].trigger("click");
    await toolbarButtons[1].trigger("click");
    await toolbarButtons[2].trigger("click");
    await wrapper.findAll(".workspace-resource-row button")[0].trigger("click");

    expect(context.openLocalDir).toHaveBeenCalledTimes(1);
    expect(context.openCloudDrive).toHaveBeenCalledTimes(1);
    expect(context.openCodespace).toHaveBeenCalledTimes(1);
    expect(context.syncLocalDirectory).toHaveBeenCalledWith(expect.objectContaining({ mountRef: "mount-1" }));
  });
});
