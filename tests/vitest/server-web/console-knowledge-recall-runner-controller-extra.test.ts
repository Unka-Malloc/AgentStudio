// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeRecallRunnerController } from "../../../server-web/composables/console-knowledge-recall-runner-controller";
import type {
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  MaintenanceSettings,
} from "../../../server-web/lib/types";
import type {
  DebugTab,
  KnowledgeRecallDebugTarget,
  OptionBarOption,
} from "../../../server-web/types/app";
import { searchKnowledge as searchKnowledgeApi } from "../../../server-web/lib/knowledge-search-client";

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  searchKnowledge: vi.fn(),
}));

const mockedSearchKnowledgeApi = vi.mocked(searchKnowledgeApi);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createSearchResponse(overrides: Partial<KnowledgeSearchResponse> = {}): KnowledgeSearchResponse {
  return {
    query: "knowledge query",
    responseProfile: "console",
    items: [
      {
        evidenceId: "evidence-1",
        itemId: "item-1",
        title: "First result",
        score: 0.98,
      } as KnowledgeSearchResult,
    ],
    ...overrides,
  };
}

function createTarget(overrides: Partial<KnowledgeRecallDebugTarget> = {}): KnowledgeRecallDebugTarget {
  return {
    value: "internal:global",
    label: "全局知识空间",
    kind: "internal",
    modeOptions: [
      { value: "hybrid", label: "Hybrid" },
      { value: "keyword", label: "Keyword" },
    ],
    ...overrides,
  };
}

function createHarness(overrides: {
  canReadKnowledge?: boolean;
  knowledgeMaintenanceDraft?: Partial<MaintenanceSettings> & Record<string, unknown>;
  knowledgeRecallDebugForm?: Record<string, unknown>;
  knowledgeRecallDebugModeOptionBarOptions?: OptionBarOption[];
  selectedKnowledgeRecallDebugTarget?: KnowledgeRecallDebugTarget;
  knowledgeSearchForm?: { query: string };
} = {}) {
  const error = ref("");
  const busyState = ref("");
  const clearAllBusy = vi.fn(() => {
    busyState.value = "";
  });
  const setBusy = vi.fn((key: string) => {
    busyState.value = key;
  });
  const clearSelectedEvidence = vi.fn();
  const loadEvidence = vi.fn(async () => {});
  const openDebugTab = vi.fn((_tab: DebugTab) => {});
  const knowledgeSearchResponse = ref<KnowledgeSearchResponse | null>(null);
  const knowledgeSearchResults = ref<KnowledgeSearchResult[]>([]);
  const lastKnowledgeSearchQuery = ref("");
  const knowledgeMaintenanceDraft = ref({
    retrieval: {
      topK: 20,
      retrievalProfileId: "profile-1",
      learningEnabled: true,
    },
    learning: {
      enabled: true,
    },
    ...overrides.knowledgeMaintenanceDraft,
  } as MaintenanceSettings & Record<string, unknown>);
  const knowledgeRecallDebugForm = ref({
    query: "debug query",
    targetId: "internal:global",
    retrievalMode: "hybrid",
    keywordOnly: false,
    learningEnabled: true,
    explain: true,
    ...overrides.knowledgeRecallDebugForm,
  });
  const modeOptions = ref<OptionBarOption[]>(
    overrides.knowledgeRecallDebugModeOptionBarOptions || [
      { value: "hybrid", label: "Hybrid" },
      { value: "keyword", label: "Keyword" },
    ],
  );
  const selectedTarget = ref(
    overrides.selectedKnowledgeRecallDebugTarget || createTarget(),
  );
  const knowledgeSearchForm = ref(
    overrides.knowledgeSearchForm || { query: " knowledge query " },
  );

  const controller = createConsoleKnowledgeRecallRunnerController({
    canReadKnowledge: computed(() => overrides.canReadKnowledge ?? true),
    clearAllBusy,
    clearSelectedEvidence,
    error,
    knowledgeMaintenanceDraft,
    knowledgeRecallDebugForm,
    knowledgeRecallDebugModeOptionBarOptions: computed(() => modeOptions.value),
    knowledgeSearchForm,
    knowledgeSearchResponse,
    knowledgeSearchResults,
    lastKnowledgeSearchQuery,
    loadEvidence,
    openDebugTab,
    selectedKnowledgeRecallDebugTarget: computed(() => selectedTarget.value),
    setBusy,
  });

  return {
    clearAllBusy,
    clearSelectedEvidence,
    controller,
    error,
    knowledgeMaintenanceDraft,
    knowledgeRecallDebugForm,
    knowledgeSearchForm,
    knowledgeSearchResponse,
    knowledgeSearchResults,
    lastKnowledgeSearchQuery,
    loadEvidence,
    modeOptions,
    openDebugTab,
    selectedTarget,
    setBusy,
    busyState,
  };
}

describe("console knowledge recall runner controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates empty query and read permission before searching", async () => {
    const emptyHarness = createHarness();
    emptyHarness.knowledgeSearchForm.value.query = "   ";

    await emptyHarness.controller.searchKnowledge();

    expect(emptyHarness.error.value).toBe("请输入知识召回调试问题。");
    expect(mockedSearchKnowledgeApi).not.toHaveBeenCalled();
    expect(emptyHarness.setBusy).not.toHaveBeenCalled();
    expect(emptyHarness.openDebugTab).not.toHaveBeenCalled();

    const deniedHarness = createHarness({ canReadKnowledge: false });

    await deniedHarness.controller.searchKnowledge();

    expect(deniedHarness.error.value).toBe("当前账号没有知识库读取权限。");
    expect(mockedSearchKnowledgeApi).not.toHaveBeenCalled();
    expect(deniedHarness.setBusy).not.toHaveBeenCalled();
    expect(deniedHarness.clearAllBusy).not.toHaveBeenCalled();
  });

  it("searches knowledge, normalizes results, loads the first evidence, and clears busy state", async () => {
    mockedSearchKnowledgeApi.mockResolvedValueOnce(
      createSearchResponse({
        items: [
          {
            evidenceId: "evidence-1",
            itemId: "item-1",
            title: "First result",
            score: 0.98,
          } as KnowledgeSearchResult,
          {
            evidenceId: "evidence-2",
            itemId: "item-2",
            title: "Second result",
            score: 0.73,
          } as KnowledgeSearchResult,
        ],
      }),
    );
    const harness = createHarness({
      knowledgeMaintenanceDraft: {
        retrieval: {
          topK: 22,
          retrievalProfileId: "profile-9",
          learningEnabled: false,
        },
        learning: {
          enabled: true,
        },
      },
      knowledgeSearchForm: {
        query: "  Explain the search path  ",
      },
    });

    await harness.controller.searchKnowledge();

    expect(mockedSearchKnowledgeApi).toHaveBeenCalledWith({
      query: "Explain the search path",
      limit: 22,
      retrievalMode: "hybrid",
      keywordOnly: false,
      retrievalProfile: {
        topK: 22,
        retrievalProfileId: "profile-9",
        learningEnabled: false,
      },
      profile: {
        retrieval: {
          topK: 22,
          retrievalProfileId: "profile-9",
          learningEnabled: false,
        },
      },
      retrievalProfileId: "profile-9",
      clientId: "server-console-knowledge-recall",
      requestSurface: "console",
      responseProfile: "console",
      explain: true,
      learningEnabled: false,
    });
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:search");
    expect(harness.clearSelectedEvidence).toHaveBeenCalledTimes(1);
    expect(harness.openDebugTab).toHaveBeenCalledWith("knowledgeRecall");
    expect(harness.knowledgeSearchResponse.value).toEqual(createSearchResponse({
      items: [
        {
          evidenceId: "evidence-1",
          itemId: "item-1",
          title: "First result",
          score: 0.98,
        } as KnowledgeSearchResult,
        {
          evidenceId: "evidence-2",
          itemId: "item-2",
          title: "Second result",
          score: 0.73,
        } as KnowledgeSearchResult,
      ],
    }));
    expect(harness.knowledgeSearchResults.value).toHaveLength(2);
    expect(harness.lastKnowledgeSearchQuery.value).toBe("Explain the search path");
    expect(harness.loadEvidence).toHaveBeenCalledWith("evidence-1");
    expect(harness.error.value).toBe("");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busyState.value).toBe("");
  });

  it("reports search errors and preserves cleanup", async () => {
    mockedSearchKnowledgeApi.mockRejectedValueOnce(new Error("search failed"));
    const harness = createHarness();

    await harness.controller.searchKnowledge();

    expect(harness.error.value).toBe("search failed");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busyState.value).toBe("");
    expect(harness.knowledgeSearchResponse.value).toBeNull();
    expect(harness.knowledgeSearchResults.value).toEqual([]);
    expect(harness.lastKnowledgeSearchQuery.value).toBe("");
  });

  it("clamps search limits and builds target-specific debug payloads", () => {
    const harness = createHarness({
      knowledgeMaintenanceDraft: {
        retrieval: {
          topK: -5,
          retrievalProfileId: "profile-77",
          learningEnabled: true,
        },
        learning: {
          enabled: false,
        },
      },
      knowledgeRecallDebugForm: {
        query: "debug query",
        targetId: "external:space-9",
        retrievalMode: "bogus",
        keywordOnly: true,
        learningEnabled: false,
        explain: false,
      },
      selectedKnowledgeRecallDebugTarget: createTarget({
        value: "external:space-9",
        label: "外部知识库",
        kind: "external",
        provider: "custom-provider",
        spaceId: "space-9",
        modeOptions: [{ value: "backendContract", label: "Backend Contract" }],
      }),
    });

    expect(harness.controller.currentKnowledgeLearningEnabled()).toBe(false);
    expect(harness.controller.currentKnowledgeSearchLimit()).toBe(1);

    harness.knowledgeMaintenanceDraft.value.retrieval = {
      topK: 150,
      retrievalProfileId: "profile-77",
      learningEnabled: true,
    };

    harness.modeOptions.value = [{ value: "backendContract", label: "Backend Contract" }];
    const externalPayload = harness.controller.buildKnowledgeRecallSearchPayload("  trimmed query  ");
    expect(externalPayload).toEqual(expect.objectContaining({
      query: "  trimmed query  ",
      limit: 100,
      retrievalMode: "backendContract",
      keywordOnly: true,
      retrievalProfile: {
        topK: 100,
        retrievalProfileId: "profile-77",
        learningEnabled: true,
      },
      profile: {
        retrieval: {
          topK: 100,
          retrievalProfileId: "profile-77",
          learningEnabled: true,
        },
      },
      retrievalProfileId: "profile-77",
      clientId: "server-console-debug-knowledge-recall",
      explain: false,
      learningEnabled: false,
      knowledgeBackend: true,
      externalKnowledgeBase: true,
      provider: "custom-provider",
      spaceId: "space-9",
      backendRef: "space-9",
    }));

    harness.selectedTarget.value = createTarget({
      value: "source:source-1",
      label: "受管目录",
      kind: "source",
      sourceId: "source-1",
      modeOptions: [{ value: "keyword", label: "Keyword" }],
    });
    harness.modeOptions.value = [{ value: "keyword", label: "Keyword" }];
    harness.knowledgeRecallDebugForm.value.retrievalMode = "keyword";

    const sourcePayload = harness.controller.buildKnowledgeRecallSearchPayload("source query");
    expect(sourcePayload).toEqual(expect.objectContaining({
      retrievalMode: "keyword",
      sourceIds: ["source-1"],
      scopeSourceIds: ["source-1"],
    }));
    expect(harness.controller.knowledgeRecallDebugGridStyle.value).toEqual({
      "--debug-compare-columns": "1",
    });
  });

  it("runs the debug batch, updates run state, and skips stale cleanup", async () => {
    const firstRun = createDeferred<KnowledgeSearchResponse>();
    mockedSearchKnowledgeApi
      .mockImplementationOnce(() => firstRun.promise)
      .mockResolvedValueOnce(
        createSearchResponse({
          items: [
            {
              evidenceId: "batch-evidence-1",
              itemId: "batch-item-1",
              title: "Batch result",
            } as KnowledgeSearchResult,
          ],
        }),
      );
    const harness = createHarness({
      knowledgeMaintenanceDraft: {
        retrieval: {
          topK: 150,
          retrievalProfileId: "profile-batch",
          learningEnabled: true,
        },
        learning: {
          enabled: true,
        },
      },
      knowledgeRecallDebugForm: {
        query: "  batch query  ",
        targetId: "internal:global",
        retrievalMode: "hybrid",
        keywordOnly: false,
        learningEnabled: true,
        explain: true,
      },
    });

    const firstCall = harness.controller.runKnowledgeRecallDebugBatch();
    expect(harness.setBusy).toHaveBeenCalledWith("debug:knowledge-recall");
    expect(harness.controller.knowledgeRecallDebugRuns.value).toHaveLength(1);
    expect(harness.controller.knowledgeRecallDebugRuns.value[0].status).toBe("running");

    const secondCall = harness.controller.runKnowledgeRecallDebugBatch();
    await secondCall;
    expect(harness.controller.knowledgeRecallDebugRuns.value[0]).toMatchObject({
      status: "completed",
      error: "",
      topK: 100,
      items: [
        {
          evidenceId: "batch-evidence-1",
          itemId: "batch-item-1",
          title: "Batch result",
        },
      ],
    });
    expect(harness.lastKnowledgeSearchQuery.value).toBe("batch query");

    firstRun.resolve(createSearchResponse({
      items: [
        {
          evidenceId: "stale-evidence",
          itemId: "stale-item",
          title: "Stale result",
        } as KnowledgeSearchResult,
      ],
    }));
    await firstCall;

    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busyState.value).toBe("");
  });

  it("marks the debug batch as failed when the search request rejects", async () => {
    mockedSearchKnowledgeApi.mockRejectedValueOnce(new Error("batch failed"));
    const harness = createHarness({
      knowledgeRecallDebugForm: {
        query: "batch failure",
        targetId: "internal:global",
        retrievalMode: "hybrid",
        keywordOnly: false,
        learningEnabled: true,
        explain: true,
      },
    });

    await harness.controller.runKnowledgeRecallDebugBatch();

    expect(harness.controller.knowledgeRecallDebugRuns.value).toHaveLength(1);
    expect(harness.controller.knowledgeRecallDebugRuns.value[0]).toMatchObject({
      status: "failed",
      error: "batch failed",
      label: "召回结果",
      topK: 20,
    });
    expect(harness.lastKnowledgeSearchQuery.value).toBe("batch failure");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busyState.value).toBe("");
  });
});
