import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeEvidenceLoaderController } from "../../../server-web/composables/console-knowledge-evidence-loader-controller";
import { getKnowledgeEvidence } from "../../../server-web/lib/knowledge-search-client";
import type { EvidencePack, KnowledgeSearchResult } from "../../../server-web/lib/types";

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  getKnowledgeEvidence: vi.fn(),
}));

const mockedGetKnowledgeEvidence = vi.mocked(getKnowledgeEvidence);

function makeEvidence(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    evidenceId: "ev-1",
    title: "Fetched title",
    text: "Updated body",
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    title: "Original title",
    itemId: "ev-1",
    snippet: "Original snippet",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createHarness(overrides: {
  currentAgentExploreQuery?: () => string;
  infoFeedQuery?: () => string;
  agentExploreContextBuildRecordId?: () => string;
} = {}) {
  const busy = ref("");
  const busyKey = computed(() => busy.value);
  const agentEvidencePreviewOpen = ref(false);
  const error = ref("");
  const evidenceLoadError = ref("");
  const evidenceLoadSequence = ref(0);
  const knowledgeSearchResults = ref<KnowledgeSearchResult[]>([
    makeSearchResult(),
    {
      title: "Keep me",
      evidenceId: "ev-2",
      snippet: "Keep me",
    },
  ]);
  const selectedEvidence = ref<EvidencePack | null>(null);
  const selectedEvidenceId = ref("");
  const clearAllBusy = vi.fn(() => {
    busy.value = "";
  });
  const openDebugTab = vi.fn();
  const recordFeedback = vi.fn();
  const setBusy = vi.fn((key: string) => {
    busy.value = key;
  });

  const controller = createConsoleKnowledgeEvidenceLoaderController({
    agentEvidencePreviewOpen,
    agentExploreContextBuildRecordId: overrides.agentExploreContextBuildRecordId || (() => "context-1"),
    busyKey,
    clearAllBusy,
    currentAgentExploreQuery: overrides.currentAgentExploreQuery || (() => "current query"),
    error,
    evidenceLoadError,
    evidenceLoadSequence,
    infoFeedQuery: overrides.infoFeedQuery || (() => "info fallback"),
    knowledgeSearchResults,
    openDebugTab,
    recordFeedback,
    selectedEvidence,
    selectedEvidenceId,
    setBusy,
  });

  return {
    agentEvidencePreviewOpen,
    busy,
    clearAllBusy,
    controller,
    error,
    evidenceLoadError,
    knowledgeSearchResults,
    openDebugTab,
    recordFeedback,
    selectedEvidence,
    selectedEvidenceId,
    setBusy,
  };
}

describe("console knowledge evidence loader controller extra coverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads evidence, hydrates the matching search result, opens the debug tab, and clears busy state", async () => {
    mockedGetKnowledgeEvidence.mockResolvedValueOnce(
      makeEvidence({
        evidenceId: "ev-1",
        title: "Fetched title",
        text: "Updated body",
      }),
    );

    const harness = createHarness();

    await harness.controller.loadEvidence("  ev-1  ");

    expect(mockedGetKnowledgeEvidence).toHaveBeenCalledWith("ev-1");
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:evidence:ev-1");
    expect(harness.selectedEvidence.value).toEqual({
      evidenceId: "ev-1",
      title: "Fetched title",
      text: "Updated body",
    });
    expect(harness.selectedEvidenceId.value).toBe("ev-1");
    expect(harness.evidenceLoadError.value).toBe("");
    expect(harness.error.value).toBe("");
    expect(harness.openDebugTab).toHaveBeenCalledWith("knowledgeRecall");
    expect(harness.knowledgeSearchResults.value[0]).toMatchObject({
      title: "Fetched title",
      snippet: "Updated body",
    });
    expect(harness.knowledgeSearchResults.value[1]).toMatchObject({
      title: "Keep me",
      snippet: "Keep me",
    });
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busy.value).toBe("");
  });

  it("rejects empty evidence ids and missing result ids without calling the backend", async () => {
    const harness = createHarness({
      currentAgentExploreQuery: () => "",
      infoFeedQuery: () => "info query fallback",
      agentExploreContextBuildRecordId: () => "build-1",
    });

    await harness.controller.loadEvidence("   ");
    expect(mockedGetKnowledgeEvidence).not.toHaveBeenCalled();
    expect(harness.setBusy).not.toHaveBeenCalled();

    await harness.controller.openKnowledgeSearchResult({ title: "No evidence id" } as any);
    expect(harness.error.value).toBe("这个检索结果没有可打开的 evidenceId。");
    expect(harness.evidenceLoadError.value).toBe("");
    expect(harness.setBusy).not.toHaveBeenCalled();
    expect(harness.clearAllBusy).not.toHaveBeenCalled();

    await harness.controller.openAgentEvidencePreview(" ");
    expect(harness.agentEvidencePreviewOpen.value).toBe(false);
    expect(harness.recordFeedback).not.toHaveBeenCalled();
  });

  it("surfaces backend and malformed payload errors while still clearing busy state", async () => {
    mockedGetKnowledgeEvidence
      .mockResolvedValueOnce(null as any)
      .mockRejectedValueOnce(new Error("加载失败"));

    const harness = createHarness();

    await harness.controller.loadEvidence("ev-null");

    expect(harness.selectedEvidence.value).toBeNull();
    expect(harness.selectedEvidenceId.value).toBe("ev-null");
    expect(harness.evidenceLoadError.value).toBe("服务端没有返回可展示的证据内容。");
    expect(harness.error.value).toBe("服务端没有返回可展示的证据内容。");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);

    await harness.controller.loadEvidence("ev-fail");

    expect(harness.selectedEvidence.value).toBeNull();
    expect(harness.selectedEvidenceId.value).toBe("ev-fail");
    expect(harness.evidenceLoadError.value).toBe("加载失败");
    expect(harness.error.value).toBe("加载失败");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest evidence when requests overlap and ignores stale completions", async () => {
    const first = createDeferred<EvidencePack>();
    const second = createDeferred<EvidencePack>();
    mockedGetKnowledgeEvidence
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const harness = createHarness();

    const firstLoad = harness.controller.loadEvidence("ev-old");
    expect(harness.busy.value).toBe("knowledge:evidence:ev-old");
    expect(harness.selectedEvidence.value).toBeNull();

    const secondLoad = harness.controller.loadEvidence("ev-new");
    expect(harness.busy.value).toBe("knowledge:evidence:ev-new");
    expect(harness.selectedEvidence.value).toBeNull();

    first.resolve(
      makeEvidence({
        evidenceId: "ev-old",
        title: "Old title",
        text: "Old body",
      }),
    );
    await firstLoad;

    expect(harness.selectedEvidence.value).toBeNull();
    expect(harness.selectedEvidenceId.value).toBe("ev-new");
    expect(harness.clearAllBusy).not.toHaveBeenCalled();

    second.resolve(
      makeEvidence({
        evidenceId: "ev-new",
        title: "Newest title",
        text: "Newest body",
      }),
    );
    await secondLoad;

    expect(harness.selectedEvidence.value).toEqual({
      evidenceId: "ev-new",
      title: "Newest title",
      text: "Newest body",
    });
    expect(harness.selectedEvidenceId.value).toBe("ev-new");
    expect(harness.openDebugTab).toHaveBeenCalledWith("knowledgeRecall");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(harness.busy.value).toBe("");
  });

  it("records preview opens with the fallback query and suppresses debug tab reveal", async () => {
    mockedGetKnowledgeEvidence.mockResolvedValueOnce(
      makeEvidence({
        evidenceId: "ev-preview",
        title: "Preview title",
        text: "Preview body",
      }),
    );

    const harness = createHarness({
      currentAgentExploreQuery: () => "",
      infoFeedQuery: () => "fallback info query",
      agentExploreContextBuildRecordId: () => "context-build-7",
    });

    await harness.controller.openAgentEvidencePreview("ev-preview");

    expect(harness.agentEvidencePreviewOpen.value).toBe(true);
    expect(harness.selectedEvidenceId.value).toBe("ev-preview");
    expect(harness.selectedEvidence.value).toEqual({
      evidenceId: "ev-preview",
      title: "Preview title",
      text: "Preview body",
    });
    expect(harness.openDebugTab).not.toHaveBeenCalled();
    expect(harness.recordFeedback).toHaveBeenCalledWith("open", {
      surface: "evidence_preview",
      evidenceId: "ev-preview",
      query: "fallback info query",
      contextBuildRecordId: "context-build-7",
    });
  });

  it("covers hydrate no-op, normal search-result open, preview close, and answer-link clicks", async () => {
    mockedGetKnowledgeEvidence
      .mockResolvedValueOnce(makeEvidence({
        evidenceId: "ev-2",
        title: "Second title",
        text: "Second body",
      }))
      .mockResolvedValueOnce(makeEvidence({
        evidenceId: "ev-link",
        title: "Linked title",
        text: "Linked body",
      }));

    const harness = createHarness();

    harness.controller.hydrateSearchResultPreview({ title: "No id" } as any);
    expect(harness.knowledgeSearchResults.value[0]).toMatchObject({
      title: "Original title",
      snippet: "Original snippet",
    });

    await harness.controller.openKnowledgeSearchResult({
      title: "Open me",
      evidenceId: "ev-2",
      snippet: "old",
    } as any);
    expect(mockedGetKnowledgeEvidence).toHaveBeenCalledWith("ev-2");
    expect(harness.selectedEvidenceId.value).toBe("ev-2");

    harness.agentEvidencePreviewOpen.value = true;
    harness.controller.closeAgentEvidencePreview();
    expect(harness.agentEvidencePreviewOpen.value).toBe(false);

    const plainEvent = {
      preventDefault: vi.fn(),
      target: {
        closest: vi.fn(() => null),
      },
    } as unknown as MouseEvent;
    harness.controller.handleAgentAnswerClick(plainEvent);
    expect(plainEvent.preventDefault).not.toHaveBeenCalled();

    const linkEvent = {
      preventDefault: vi.fn(),
      target: {
        closest: vi.fn(() => ({
          getAttribute: vi.fn(() => "#pact-evidence-ev-link"),
        })),
      },
    } as unknown as MouseEvent;
    harness.controller.handleAgentAnswerClick(linkEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(linkEvent.preventDefault).toHaveBeenCalled();
    expect(mockedGetKnowledgeEvidence).toHaveBeenCalledWith("ev-link");
    expect(harness.agentEvidencePreviewOpen.value).toBe(true);
  });
});
