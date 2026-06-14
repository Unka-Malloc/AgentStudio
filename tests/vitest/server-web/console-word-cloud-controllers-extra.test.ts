// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleWordCloudController } from "../../../server-web/composables/console-word-cloud-controller";
import { createConsoleWordCloudWorkflowController } from "../../../server-web/composables/console-word-cloud-workflow-controller";

const wordCloudClient = vi.hoisted(() => ({
  getKnowledgeWordClouds: vi.fn(),
  saveKnowledgeWordClouds: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-word-cloud-client", () => ({
  getKnowledgeWordClouds: wordCloudClient.getKnowledgeWordClouds,
  saveKnowledgeWordClouds: wordCloudClient.saveKnowledgeWordClouds,
}));

function createWordBagSet(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    wordBagSetId: "set-1",
    title: "语料词云",
    status: "draft",
    wordBagCount: 1,
    termsSnapshot: [{ term: "alpha", frequency: 1 }],
    wordBags: [
      {
        wordBagId: "bag-1",
        label: "词云 1",
        summary: "",
        relation: "overlap",
        absorbThreshold: 5,
        terms: [{ term: "alpha", frequency: 1 }],
        removedTerms: [],
        children: [
          {
            wordBagId: "bag-1-1",
            label: "词云 1-1",
            summary: "",
            relation: "contains",
            absorbThreshold: 5,
            terms: [{ term: "beta", frequency: 2 }],
            removedTerms: [],
            children: [],
          },
        ],
      },
    ],
    unassignedTerms: [{ term: "alpha", frequency: 1 }],
    corpusPaths: [{ path: "/corpus", type: "directory" }],
    modelAlias: "agent-1",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

function createWorkflowStateFixture(overrides: Record<string, unknown> = {}) {
  const busyKey = ref("");
  const error = ref("");
  const wordCloudCorpusPaths = ref([{ path: "/corpus", type: "directory" }]);
  const wordCloudDraft = ref<any>(createWordBagSet());
  const wordCloudMessages = ref<any[]>([]);
  const wordCloudModelAlias = ref("agent-1");
  const wordCloudState = ref<any>(null);
  const wordCloudTerms = ref([{ term: "alpha", frequency: 1 }]);

  const options = {
    addTermToCloud: vi.fn(),
    applySavedWordCloudSet: vi.fn(),
    autoAbsorbWordCloudTerms: vi.fn(() => 0),
    busyKey,
    canReadKnowledge: ref(true),
    canWriteKnowledge: ref(true),
    clearAllBusy: vi.fn(() => {
      busyKey.value = "";
    }),
    createDefaultWordCloudSet: vi.fn((terms: any[] = []) => createWordBagSet({
      wordBagSetId: "default-set",
      wordBagCount: 0,
      termsSnapshot: [...terms],
      wordBags: [],
      unassignedTerms: [...terms],
      corpusPaths: [],
      modelAlias: "agent-1",
    })),
    error,
    resolveWordCloudCorpusPathsForQuery: vi.fn(() => [{ path: "/corpus", type: "directory" }]),
    setBusy: vi.fn((key: string) => {
      busyKey.value = key;
    }),
    setWordCloudDraftFromState: vi.fn(),
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudState,
    wordCloudTerms,
    ...overrides,
  };

  return {
    controller: createConsoleWordCloudWorkflowController(options as any),
    options: options as typeof options & Record<string, any>,
  };
}

function createControllerFixture(overrides: Record<string, unknown> = {}) {
  const busyKey = ref("");
  const error = ref("");

  const options = {
    busyKey,
    canReadKnowledge: ref(true),
    canWriteKnowledge: ref(true),
    clearAllBusy: vi.fn(() => {
      busyKey.value = "";
    }),
    error,
    setBusy: vi.fn((key: string) => {
      busyKey.value = key;
    }),
    ...overrides,
  };

  return {
    controller: createConsoleWordCloudController(options as any),
    options: options as typeof options & Record<string, any>,
  };
}

describe("console word cloud controllers extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps word-cloud state manual and does not expose agent proposal controls", () => {
    const { controller } = createControllerFixture();

    expect(controller.wordCloudModelAlias.value).toBe("");
    expect("wordCloudModelOptions" in controller).toBe(false);
    expect("selectedWordCloudModel" in controller).toBe(false);
    expect("proposeWordCloud" in controller).toBe(false);
    expect("autoFillCloudWithAgent" in controller).toBe(false);
  });

  it("refreshWordCloud seeds a system message once and clears busy state", async () => {
    const { controller, options } = createWorkflowStateFixture();
    const state = {
      terms: [{ term: "alpha", frequency: 1 }],
      corpusPaths: [{ path: "/corpus", type: "directory" }],
      wordBagSet: null,
    };
    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce(state);

    await controller.refreshWordCloud();

    expect(wordCloudClient.getKnowledgeWordClouds).toHaveBeenCalledWith({
      limit: 100000,
      minFrequency: 1,
      corpusPaths: [{ path: "/corpus", type: "directory" }],
    });
    expect(options.setWordCloudDraftFromState).toHaveBeenCalledWith(state);
    expect(options.wordCloudMessages.value).toHaveLength(1);
    expect(options.wordCloudMessages.value[0]).toMatchObject({
      role: "system",
      text: "已读取 1 个语料词。",
    });
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    wordCloudClient.getKnowledgeWordClouds.mockResolvedValueOnce({
      terms: [{ term: "beta", frequency: 2 }],
      corpusPaths: [{ path: "/corpus", type: "directory" }],
      wordBagSet: null,
    });
    await controller.refreshWordCloud({ silent: true });

    expect(options.wordCloudMessages.value).toHaveLength(1);
    expect(options.setBusy).toHaveBeenCalledTimes(1);
  });

  it("refreshWordCloud reports errors from the fetch layer", async () => {
    const { controller, options } = createWorkflowStateFixture();
    options.wordCloudMessages.value = [{ id: "keep", role: "agent", text: "existing", at: "2026-06-04T00:00:00.000Z" }];
    wordCloudClient.getKnowledgeWordClouds.mockRejectedValueOnce(new Error("加载失败"));

    await controller.refreshWordCloud();

    expect(options.error.value).toBe("加载失败");
    expect(options.wordCloudMessages.value).toHaveLength(1);
    expect(options.wordCloudMessages.value[0].text).toBe("existing");
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("saveWordCloud creates a default draft when needed and resets busy state", async () => {
    const { controller, options } = createWorkflowStateFixture({
      wordCloudDraft: ref(null),
    });
    const savedSet = createWordBagSet({
      wordBagSetId: "saved-set",
      status: "ready",
      wordBags: [],
    });
    wordCloudClient.saveKnowledgeWordClouds.mockResolvedValueOnce({
      ok: true,
      wordBagSet: savedSet,
    });

    await controller.saveWordCloud();

    expect(options.createDefaultWordCloudSet).toHaveBeenCalledWith(options.wordCloudTerms.value);
    expect(options.autoAbsorbWordCloudTerms).toHaveBeenCalledTimes(1);
    expect(wordCloudClient.saveKnowledgeWordClouds).toHaveBeenCalledWith({
      wordBagSet: expect.objectContaining({
        wordBagCount: 0,
        termsSnapshot: options.wordCloudTerms.value,
        corpusPaths: options.wordCloudCorpusPaths.value,
        modelAlias: "agent-1",
      }),
      limit: 100000,
      minFrequency: 1,
    });
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(savedSet);
    expect(options.wordCloudMessages.value[0]).toMatchObject({
      role: "system",
      text: "词云已保存到本地。",
    });
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("saveWordCloud reports failures without leaving the save busy key behind", async () => {
    const { controller, options } = createWorkflowStateFixture();
    wordCloudClient.saveKnowledgeWordClouds.mockRejectedValueOnce(new Error("保存失败"));

    await controller.saveWordCloud();

    expect(options.error.value).toBe("保存失败");
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("applyWordCloudEvent delegates unrelated payloads to applySavedWordCloudSet", () => {
    const { controller, options } = createWorkflowStateFixture();
    const payload = createWordBagSet({
      wordBagSetId: "other-set",
      status: "ready",
      wordBags: [],
    });
    expect(controller.applyWordCloudEvent(payload)).toBe(true);
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(payload);
  });
});
