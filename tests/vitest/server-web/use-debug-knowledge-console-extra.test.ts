// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";

const shellState = vi.hoisted(() => ({
  context: {} as Record<string, any>,
}));

const routeState = vi.hoisted(() => ({
  route: { params: {} as Record<string, unknown> },
}));

const debugDistillationMock = vi.hoisted(() => vi.fn());
const viewStateControllerMock = vi.hoisted(() => vi.fn());
const libraryControllerMock = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRoute: () => routeState.route,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => shellState.context,
}));

vi.mock("../../../server-web/composables/console-debug-distillation-controller", () => ({
  useDebugDistillationController: debugDistillationMock,
}));

vi.mock("../../../server-web/composables/console-knowledge-view-state-controller", () => ({
  createConsoleKnowledgeViewStateController: viewStateControllerMock,
}));

vi.mock("../../../server-web/composables/console-knowledge-library-controller", () => ({
  createConsoleKnowledgeLibraryController: libraryControllerMock,
}));

import { useDebugViewConsole } from "../../../server-web/composables/useDebugViewConsole";
import { useKnowledgeViewConsole } from "../../../server-web/composables/useKnowledgeViewConsole";

function debugShellContext() {
  return {
    agentRetrievalConsole: {
      answer: { answerId: "answer" },
      form: { formId: "form" },
      page: { pageId: "page" },
      progress: { progressId: "progress" },
      tabs: { tabsId: "tabs" },
      trace: { traceId: "trace" },
      workspace: { workspaceId: "workspace" },
    },
    debugConsole: {
      busyKey: ref("busy-a"),
      currentView: ref("debug"),
      debugTab: ref("agentRetrieval"),
      error: ref(""),
      infoFeedModelOptions: ref([{ label: "Model", value: "model" }]),
      isAuthenticated: ref(true),
      knowledgeConsole: { knowledge: true },
      knowledgeRecallDebugForm: reactive({ query: "q" }),
      knowledgeRecallDebugGridStyle: computed(() => ({ gridTemplateColumns: "1fr" })),
      knowledgeRecallDebugModeOptionBarOptions: [{ value: "single" }],
      knowledgeRecallDebugRuns: ref([{ runId: "run-1" }]),
      knowledgeRecallDebugTargetOptions: [{ value: "target" }],
      knowledgeSourceState: { ready: true },
      knowledgeStatus: { ok: true },
      openAgentEvidencePreview: vi.fn(),
      runKnowledgeRecallDebugBatch: vi.fn(),
      visibleDebugTabs: computed(() => ["agentRetrieval", "knowledgeRecall"]),
    },
  };
}

function knowledgeShellContext() {
  return {
    knowledgeDomainConsole: {
      viewState: {
        collapsedWordBagIds: ref(["bag-a"]),
        knowledgeManagementPanel: ref("library"),
        knowledgeTab: ref("wordCloud"),
        toggleWordCloudCollapsed: vi.fn(),
      },
      page: { pageId: "page" },
      ingest: {
        ingestId: "ingest",
        uploadFilesToKnowledge: vi.fn(),
      },
      libraryRuntime: {
        canMaintainKnowledge: ref(true),
        ingestJob: ref(null),
        knowledgeIngestExternalProvider: ref("provider"),
        knowledgeIngestExternalRefs: ref([]),
        knowledgeIngestExternalTargetLabels: ref({}),
        knowledgeIngestTargets: ref([]),
        knowledgeIngestTeamRefs: ref([]),
        knowledgeIngestUserRefs: ref([]),
        refreshExpertRules: vi.fn(),
        refreshIngestJob: vi.fn(),
      },
      maintenance: { maintenanceId: "maintenance" },
      rules: { rulesId: "rules" },
      wordCloud: { wordCloudId: "word-cloud" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  routeState.route.params = {};
  shellState.context = {};
  debugDistillationMock.mockReturnValue({
    distillationBusy: ref(false),
    startDebugKnowledgeDistillation: vi.fn(),
  });
  viewStateControllerMock.mockReturnValue({
    activeKnowledgeTab: computed(() => "wordCloud"),
    documentPreviewResult: ref({ preview: true }),
    dynamicParsingPolicySignature: computed(() => "signature"),
    dynamicParsingPreviewConfig: {
      dynamicParsing: { enabled: true },
      pipelineId: "old-pipeline",
    },
    expandedAdvancedIds: ref(["advanced-a"]),
    expandedSummaryIds: ref(["summary-a"]),
    isKnownKnowledgeTab: computed(() => true),
    isManagementKnowledgePanel: computed(() => false),
    isManagementRulesPanel: computed(() => true),
    jumpToCloud: vi.fn(),
    titleFocusedWordBagId: ref("bag-a"),
    toggleAdvancedExpanded: vi.fn(),
    toggleSummaryExpanded: vi.fn(),
    unifiedKnowledgeIngestPipelineConfig: { parser: "dynamic" },
  });
  libraryControllerMock.mockReturnValue({
    connectKnowledgeBackendProvider: vi.fn(),
    isKnowledgeBackendCardExpanded: vi.fn(() => true),
    isKnowledgeLibraryCardExpanded: vi.fn(() => false),
    knowledgeBackendModeOptions: [{ value: "local" }],
    knowledgeBackendProviderCards: computed(() => [{ id: "provider-card" }]),
    knowledgeBackendProviderForms: reactive({ local: {} }),
    knowledgeIngestTargetDisplaySummary: computed(() => "2 targets"),
    knowledgeIngestTargetOptions: computed(() => [{ value: "target-a" }]),
    knowledgeIngestTargetValues: ref(["target-a"]),
    knowledgeLibraryBusy: ref(""),
    knowledgeLibraryCards: computed(() => [{ id: "library-card" }]),
    knowledgeLibraryError: ref(""),
    setKnowledgeIngestTargetValues: vi.fn(),
    toggleKnowledgeBackendCard: vi.fn(),
    toggleKnowledgeLibraryCard: vi.fn(),
  });
});

describe("useDebugViewConsole extra coverage", () => {
  it("combines shell retrieval surfaces, route tab fallback, and distillation controller output", () => {
    shellState.context = debugShellContext();
    routeState.route.params = { tab: "knowledgeRecall" };

    const debugView = useDebugViewConsole();

    expect(debugView.activeDebugTab.value).toBe("knowledgeRecall");
    expect(debugView.agentRetrievalAnswer).toMatchObject({ answerId: "answer" });
    expect(debugView.agentRetrievalAnswer.busyKey).toBe(debugView.busyKey);
    expect(debugView.agentRetrievalAnswer.openAgentEvidencePreview).toBe(debugView.openAgentEvidencePreview);
    expect(debugView.agentRetrievalForm).toMatchObject({ formId: "form", busyKey: debugView.busyKey });
    expect(debugView.agentRetrievalTrace).toMatchObject({ traceId: "trace", busyKey: debugView.busyKey });
    expect(debugView.agentRetrievalWorkspace).toMatchObject({ workspaceId: "workspace", busyKey: debugView.busyKey });
    expect(debugView.agentRetrievalPage).toEqual({ pageId: "page" });
    expect(debugView.agentRetrievalProgress).toEqual({ progressId: "progress" });
    expect(debugView.agentRetrievalTabs).toEqual({ tabsId: "tabs" });
    expect(debugView.distillationBusy.value).toBe(false);
    expect(debugDistillationMock).toHaveBeenCalledWith({
      infoFeedModelOptions: shellState.context.debugConsole.infoFeedModelOptions,
    });

    routeState.route.params = { tab: "unknown" };
    expect(useDebugViewConsole().activeDebugTab.value).toBe("agentRetrieval");
  });
});

describe("useKnowledgeViewConsole extra coverage", () => {
  it("combines shell knowledge domain surfaces with view-state and library controllers", () => {
    shellState.context = knowledgeShellContext();

    const knowledgeView = useKnowledgeViewConsole();

    expect(viewStateControllerMock).toHaveBeenCalledWith({
      collapsedWordBagIds: shellState.context.knowledgeDomainConsole.viewState.collapsedWordBagIds,
      knowledgeManagementPanel: shellState.context.knowledgeDomainConsole.viewState.knowledgeManagementPanel,
      knowledgeTab: shellState.context.knowledgeDomainConsole.viewState.knowledgeTab,
      toggleWordCloudCollapsed: shellState.context.knowledgeDomainConsole.viewState.toggleWordCloudCollapsed,
    });
    expect(libraryControllerMock).toHaveBeenCalledWith(expect.objectContaining({
      canMaintainKnowledge: shellState.context.knowledgeDomainConsole.libraryRuntime.canMaintainKnowledge,
      isManagementRulesPanel: expect.any(Object),
    }));

    knowledgeView.ingest.uploadFilesToKnowledge();
    expect(shellState.context.knowledgeDomainConsole.ingest.uploadFilesToKnowledge).toHaveBeenCalledWith({
      documentParsing: { parser: "dynamic" },
    });

    expect(knowledgeView.ingest).toMatchObject({
      ingestId: "ingest",
      dynamicParsingPreviewPipelineId: "dynamic-parameter-v1",
      unifiedKnowledgeIngestPipelineConfig: { parser: "dynamic" },
    });
    expect(knowledgeView.ingest.dynamicParsingPreviewConfig).toMatchObject({
      pipelineId: "dynamic-parameter-v1",
      dynamicParsing: { enabled: true },
    });
    expect(knowledgeView.ingest.dynamicParsingProfile).toMatchObject({
      pipelineId: "dynamic-parameter-v1",
      dynamicParsing: { enabled: true },
      contextBudget: { knowledgeTokens: 12000 },
    });
    expect(knowledgeView.ingest.knowledgeIngestTargetDisplaySummary.value).toBe("2 targets");
    expect(knowledgeView.page).toMatchObject({ pageId: "page" });
    expect(knowledgeView.page.activeKnowledgeTab.value).toBe("wordCloud");
    expect(knowledgeView.library.knowledgeLibraryCards.value).toEqual([{ id: "library-card" }]);
    expect(knowledgeView.maintenance).toMatchObject({ maintenanceId: "maintenance" });
    expect(knowledgeView.maintenance.knowledgeBackendProviderCards.value).toEqual([{ id: "provider-card" }]);
    expect(knowledgeView.rules).toEqual({ rulesId: "rules" });
    expect(knowledgeView.wordCloud).toMatchObject({ wordCloudId: "word-cloud" });
    expect(knowledgeView.wordCloud.expandedAdvancedIds.value).toEqual(["advanced-a"]);
  });
});
