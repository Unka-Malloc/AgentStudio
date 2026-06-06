// @vitest-environment jsdom
import { computed, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeRecallTargetController } from "../../../server-web/composables/console-knowledge-recall-target-controller";
import { listKnowledgeSpaces as listKnowledgeSpacesApi } from "../../../server-web/lib/knowledge-search-client";
import type { KnowledgeConsoleState, KnowledgeSource } from "../../../server-web/lib/types";

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  listKnowledgeSpaces: vi.fn(),
}));

const mockedListKnowledgeSpaces = vi.mocked(listKnowledgeSpacesApi);

function makeConsoleState(overrides: Partial<KnowledgeConsoleState> = {}): KnowledgeConsoleState {
  return {
    available: true,
    health: null,
    capabilities: null,
    maintenance: null,
    recentJobs: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    sourceId: "source-1",
    label: "Source One",
    directoryPath: "/srv/source-one",
    enabled: true,
    autoSync: true,
    recursive: true,
    debounceMs: 1000,
    status: "idle",
    watcherStatus: "watching",
    watcherCount: 1,
    lastFileCount: 0,
    lastTotalBytes: 0,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

function createFixture(overrides: {
  consoleState?: KnowledgeConsoleState | null;
  sources?: KnowledgeSource[];
} = {}) {
  const knowledgeConsole = ref<KnowledgeConsoleState | null>(overrides.consoleState ?? makeConsoleState());
  const activeKnowledgeSources = computed(() => overrides.sources ?? [
    makeSource(),
    makeSource({
      sourceId: "source-2",
      label: "",
      directoryPath: "/srv/source-two",
    }),
  ]);

  const controller = createConsoleKnowledgeRecallTargetController({
    activeKnowledgeSources,
    knowledgeConsole,
  });

  return {
    controller,
    knowledgeConsole,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListKnowledgeSpaces.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("console knowledge recall target controller extra coverage", () => {
  it("builds targets from mixed console capabilities, sources, and backend spaces", async () => {
    mockedListKnowledgeSpaces.mockResolvedValueOnce({
      spaces: [
        {
          provider: " ragflow ",
          spaceId: "space-1",
          label: "Alpha",
          searchModes: [
            { id: "exact", label: "Exact" },
            "keyword",
            { mode: "exact", title: "Duplicate exact" },
          ],
        },
        {
          provider: "",
          spaceId: "space-2",
          retrievalModes: [{ name: "semantic", title: "Semantic" }],
        },
        {
          provider: "skip",
          spaceId: "",
          label: "Ignored",
        },
      ],
    });

    const { controller } = createFixture({
      consoleState: makeConsoleState({
        capabilities: {
          retrievalModes: [
            { id: "hybrid", label: "Hybrid label" },
            { value: "keyword", title: "Keyword label" },
            { mode: "hybrid", label: "Duplicate hybrid" },
            "",
          ],
        },
      }),
      sources: [
        makeSource({
          sourceId: "source-1",
          label: "Source One",
          directoryPath: "/srv/source-one",
        }),
        makeSource({
          sourceId: "source-2",
          label: "",
          directoryPath: "/srv/source-two",
        }),
      ],
    });

    await controller.refreshKnowledgeRecallBackendSpaces();
    await nextTick();

    expect(mockedListKnowledgeSpaces).toHaveBeenCalledTimes(1);
    expect(controller.knowledgeRecallDebugTargetOptions.value).toEqual([
      { value: "internal:global", label: "全局知识空间" },
      { value: "source:source-1", label: "Source One" },
      { value: "source:source-2", label: "/srv/source-two" },
      { value: "external:space-1", label: "Alpha · ragflow" },
      { value: "external:space-2", label: "外部知识库 · external" },
    ]);
    expect(controller.selectedKnowledgeRecallDebugTarget.value).toMatchObject({
      value: "internal:global",
      kind: "internal",
    });
    expect(controller.knowledgeRecallDebugModeOptionBarOptions.value).toEqual([
      { value: "hybrid", label: "Hybrid label" },
      { value: "keyword", label: "Keyword label" },
    ]);

    controller.knowledgeRecallDebugForm.value.targetId = "missing-target";
    controller.knowledgeRecallDebugForm.value.retrievalMode = "missing-mode";
    await nextTick();

    expect(controller.knowledgeRecallDebugForm.value.targetId).toBe("internal:global");
    expect(controller.knowledgeRecallDebugForm.value.retrievalMode).toBe("hybrid");
    expect(controller.selectedKnowledgeRecallDebugTarget.value).toMatchObject({
      value: "internal:global",
      kind: "internal",
      modeOptions: [
        { value: "hybrid", label: "Hybrid label" },
        { value: "keyword", label: "Keyword label" },
      ],
    });
  });

  it("falls back to health retrieval policy modes and survives backend refresh failures", async () => {
    mockedListKnowledgeSpaces.mockRejectedValueOnce(new Error("spaces failed"));

    const { controller } = createFixture({
      consoleState: makeConsoleState({
        health: {
          capabilities: {
            retrievalPolicy: {
              modes: [
                { name: "semantic", title: "Semantic" },
                { value: "hybrid", label: "Hybrid" },
                { id: "semantic", label: "Duplicate semantic" },
              ],
            },
          },
        } as KnowledgeConsoleState["health"],
      }),
    });

    controller.knowledgeRecallDebugForm.value.targetId = "external:missing";
    controller.knowledgeRecallDebugForm.value.retrievalMode = "unknown";

    await controller.refreshKnowledgeRecallBackendSpaces();
    await nextTick();

    expect(mockedListKnowledgeSpaces).toHaveBeenCalledTimes(1);
    expect(controller.knowledgeRecallDebugTargetOptions.value).toEqual([
      { value: "internal:global", label: "全局知识空间" },
      { value: "source:source-1", label: "Source One" },
      { value: "source:source-2", label: "/srv/source-two" },
    ]);
    expect(controller.knowledgeRecallDebugModeOptionBarOptions.value).toEqual([
      { value: "semantic", label: "Semantic" },
      { value: "hybrid", label: "Hybrid" },
    ]);
    expect(controller.knowledgeRecallDebugForm.value.targetId).toBe("internal:global");
    expect(controller.knowledgeRecallDebugForm.value.retrievalMode).toBe("semantic");
    expect(controller.selectedKnowledgeRecallDebugTarget.value).toMatchObject({
      value: "internal:global",
      kind: "internal",
    });
  });
});
