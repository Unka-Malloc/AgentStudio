// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleWordCloudController } from "../../../server-web/composables/console-word-cloud-controller";
import { createConsoleWordCloudWorkflowController } from "../../../server-web/composables/console-word-cloud-workflow-controller";

const wordCloudClient = vi.hoisted(() => ({
  getKnowledgeWordClouds: vi.fn(),
  proposeKnowledgeWordClouds: vi.fn(),
  saveKnowledgeWordClouds: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-word-cloud-client", () => ({
  getKnowledgeWordClouds: wordCloudClient.getKnowledgeWordClouds,
  proposeKnowledgeWordClouds: wordCloudClient.proposeKnowledgeWordClouds,
  saveKnowledgeWordClouds: wordCloudClient.saveKnowledgeWordClouds,
}));

function createAgentOption(value: string, overrides: Record<string, unknown> = {}) {
  return {
    value,
    agentUid: value,
    label: `智能体 ${value}`,
    provider: "provider",
    model: "model",
    moduleIds: [],
    capabilities: [],
    status: "ready",
    enabled: true,
    selectable: true,
    disabledReason: "",
    reason: "",
    ...overrides,
  };
}

function createWordBagSet(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
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
  const wordCloudPrompt = ref("");
  const wordCloudState = ref<any>(null);
  const wordCloudTerms = ref([{ term: "alpha", frequency: 1 }]);
  const fillingWordBagIds = ref(new Set<string>());
  const fillTargetWordBagId = ref<string | null>(null);
  const fillSourceWordBagSetId = ref<string | null>(null);

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
    fillingWordBagIds,
    fillSourceWordBagSetId,
    fillTargetWordBagId,
    refreshWordCloudCorpusTerms: vi.fn(),
    resolveWordCloudCorpusPathsForQuery: vi.fn(() => [{ path: "/corpus", type: "directory" }]),
    selectedWordCloudModel: computed(() => ({
      value: wordCloudModelAlias.value,
      enabled: true,
      disabledReason: "",
    })),
    setBusy: vi.fn((key: string) => {
      busyKey.value = key;
    }),
    setWordCloudDraftFromState: vi.fn(),
    wordCloudCorpusPaths,
    wordCloudDraft,
    wordCloudMessages,
    wordCloudModelAlias,
    wordCloudPrompt,
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
  const agentSelectorOptions = ref([
    createAgentOption("agent-1"),
    createAgentOption("retired-agent", {
      label: "已移除的智能体",
      enabled: false,
      selectable: false,
      disabledReason: "已从智能体列表删除",
      reason: "已从智能体列表删除",
    }),
  ]);

  const options = {
    agentSelectorOptions,
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

  it("resolves the active model and falls back to inert placeholders", () => {
    const { controller, options } = createControllerFixture();

    expect(controller.wordCloudModelOptions.value).toEqual(options.agentSelectorOptions.value);
    expect(controller.selectedWordCloudModel.value).toMatchObject({
      value: "",
      label: "未选择智能体",
      enabled: false,
      disabledReason: "未分配",
    });

    controller.wordCloudModelAlias.value = "agent-1";
    expect(controller.selectedWordCloudModel.value).toBe(options.agentSelectorOptions.value[0]);

    controller.wordCloudModelAlias.value = "missing-agent";
    expect(controller.selectedWordCloudModel.value).toMatchObject({
      value: "missing-agent",
      label: "已移除的智能体",
      enabled: false,
      disabledReason: "已从智能体列表删除",
    });
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

  it("proposeWordCloud rejects blank prompts and missing corpus scopes before calling the agent", async () => {
    const { controller, options } = createWorkflowStateFixture({
      resolveWordCloudCorpusPathsForQuery: vi.fn(() => []),
    });

    options.wordCloudPrompt.value = "   ";
    await controller.proposeWordCloud();

    expect(options.error.value).toBe("请输入词云分组意图。");
    expect(options.resolveWordCloudCorpusPathsForQuery).not.toHaveBeenCalled();
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    options.error.value = "";
    options.clearAllBusy.mockClear();
    options.wordCloudPrompt.value = "按主题聚类";

    await controller.proposeWordCloud();

    expect(options.error.value).toBe("请先添加语料范围后再启动分类任务。");
    expect(options.wordCloudMessages.value[0]).toMatchObject({
      role: "system",
      text: "请先添加语料范围后再启动分类任务。",
    });
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("proposeWordCloud rejects permission, disabled model, and empty prepared terms", async () => {
    const noWrite = createWorkflowStateFixture({
      canWriteKnowledge: ref(false),
    });
    await noWrite.controller.proposeWordCloud();
    expect(noWrite.options.error.value).toBe("需要 knowledge:write 权限才能调用智能体生成词云。");
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();

    const disabledModel = createWorkflowStateFixture({
      selectedWordCloudModel: ref({
        value: "agent-disabled",
        enabled: false,
        disabledReason: "模型离线",
      }),
    });
    await disabledModel.controller.proposeWordCloud();
    expect(disabledModel.options.error.value).toBe("模型离线");
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();

    const emptyTerms = createWorkflowStateFixture({
      resolveWordCloudCorpusPathsForQuery: vi.fn(() => [{ path: "/corpus", type: "directory" }]),
      refreshWordCloudCorpusTerms: vi.fn(async () => []),
    });
    emptyTerms.options.wordCloudPrompt.value = "按主题聚类";

    await emptyTerms.controller.proposeWordCloud();

    expect(emptyTerms.options.error.value).toBe("已扫描语料范围但未发现可用词频，建议确认目录下有已入库文档并重新启动该任务。");
    expect(emptyTerms.options.wordCloudMessages.value[0]).toMatchObject({
      role: "system",
      text: "已扫描语料范围但未发现可用词频，建议确认目录下有已入库文档并重新启动该任务。",
    });
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();
    expect(emptyTerms.options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("proposeWordCloud generates a draft, resets the prompt, and clears busy state", async () => {
    const { controller, options } = createWorkflowStateFixture({
      resolveWordCloudCorpusPathsForQuery: vi.fn(() => [{ path: "/corpus", type: "directory" }]),
      refreshWordCloudCorpusTerms: vi.fn(async () => [{ term: "alpha", frequency: 1 }]),
    });
    const generatedSet = createWordBagSet({
      wordBagSetId: "generated-set",
      status: "ready",
      wordBags: [
        {
          wordBagId: "generated-bag",
          label: "生成词云",
          terms: [{ term: "gamma", frequency: 3 }],
          children: [],
        },
      ],
    });
    options.wordCloudPrompt.value = "按主题聚类";
    wordCloudClient.proposeKnowledgeWordClouds.mockResolvedValueOnce({
      ok: true,
      wordBagSet: generatedSet,
      run: { runId: "run-1" },
    });

    await controller.proposeWordCloud();

    expect(wordCloudClient.proposeKnowledgeWordClouds).toHaveBeenCalledWith({
      modelAlias: "agent-1",
      prompt: "按主题聚类",
      minFrequency: 1,
      corpusPaths: [{ path: "/corpus", type: "directory" }],
    });
    expect(options.wordCloudPrompt.value).toBe("");
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(generatedSet);
    expect(options.wordCloudMessages.value[0]).toMatchObject({
      role: "agent",
      text: "词云分类后台任务已启动。",
    });
    expect(options.wordCloudMessages.value[1]).toMatchObject({
      role: "user",
      text: "按主题聚类",
    });
    expect(options.busyKey.value).toBe("");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("proposeWordCloud surfaces agent failures as system messages", async () => {
    const { controller, options } = createWorkflowStateFixture({
      resolveWordCloudCorpusPathsForQuery: vi.fn(() => [{ path: "/corpus", type: "directory" }]),
      refreshWordCloudCorpusTerms: vi.fn(async () => [{ term: "alpha", frequency: 1 }]),
    });
    options.wordCloudPrompt.value = "按主题聚类";
    wordCloudClient.proposeKnowledgeWordClouds.mockRejectedValueOnce(new Error("生成失败"));

    await controller.proposeWordCloud();

    expect(options.error.value).toBe("生成失败");
    expect(options.wordCloudMessages.value[0]).toMatchObject({
      role: "system",
      text: "生成失败",
    });
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

  it("autoFillCloudWithAgent prepares a fill session and applyWordCloudEvent completes it", async () => {
    const { controller, options } = createWorkflowStateFixture();
    options.wordCloudDraft.value = createWordBagSet({
      wordBagSetId: "draft-set",
      wordBags: [
        {
          wordBagId: "target-bag",
          label: "电商",
          summary: "",
          relation: "overlap",
          absorbThreshold: 5,
          terms: [],
          removedTerms: [],
          children: [],
        },
      ],
    });
    wordCloudClient.proposeKnowledgeWordClouds.mockResolvedValueOnce({
      ok: true,
      wordBagSet: createWordBagSet({
        wordBagSetId: "source-set",
        status: "ready",
        wordBags: [
          {
            wordBagId: "source-root",
            label: "source",
            terms: [{ term: "alpha", frequency: 1 }],
            children: [
              {
                wordBagId: "source-child",
                label: "child",
                terms: [{ term: "beta", frequency: 2 }],
                children: [],
              },
            ],
          },
        ],
      }),
    });

    await controller.autoFillCloudWithAgent("target-bag");

    expect(wordCloudClient.proposeKnowledgeWordClouds).toHaveBeenCalledWith({
      modelAlias: "agent-1",
      prompt: "电商",
      minFrequency: 1,
      corpusPaths: [{ path: "/corpus", type: "directory" }],
    });
    expect(options.fillingWordBagIds.value.has("target-bag")).toBe(true);
    expect(options.fillTargetWordBagId.value).toBe("target-bag");
    expect(options.fillSourceWordBagSetId.value).toBe("source-set");

    const handled = controller.applyWordCloudEvent({
      wordBagSetId: "source-set",
      title: "source",
      status: "ready",
      wordBagCount: 1,
      wordBags: [
        {
          wordBagId: "source-root",
          label: "source",
          terms: [{ term: "alpha", frequency: 1 }],
          children: [
            {
              wordBagId: "source-child",
              label: "child",
              terms: [{ term: "beta", frequency: 2 }],
              children: [],
            },
          ],
        },
      ],
    });

    expect(handled).toBe(true);
    expect(options.addTermToCloud).toHaveBeenNthCalledWith(1, "target-bag", { term: "alpha", frequency: 1 });
    expect(options.addTermToCloud).toHaveBeenNthCalledWith(2, "target-bag", { term: "beta", frequency: 2 });
    expect(options.fillTargetWordBagId.value).toBeNull();
    expect(options.fillSourceWordBagSetId.value).toBeNull();
    expect(options.fillingWordBagIds.value.has("target-bag")).toBe(false);
  });

  it("autoFillCloudWithAgent removes the bag from the filling set when proposal fails", async () => {
    const { controller, options } = createWorkflowStateFixture();
    options.wordCloudDraft.value = createWordBagSet({
      wordBagSetId: "draft-set",
      wordBags: [
        {
          wordBagId: "target-bag",
          label: "电商",
          summary: "",
          relation: "overlap",
          absorbThreshold: 5,
          terms: [],
          removedTerms: [],
          children: [],
        },
      ],
    });
    wordCloudClient.proposeKnowledgeWordClouds.mockRejectedValueOnce(new Error("填充失败"));

    await controller.autoFillCloudWithAgent("target-bag");

    expect(options.error.value).toBe("填充失败");
    expect(options.fillingWordBagIds.value.has("target-bag")).toBe(false);
  });

  it("autoFillCloudWithAgent rejects missing cloud, blank labels, disabled models, and missing corpus scopes", async () => {
    const missing = createWorkflowStateFixture();
    await missing.controller.autoFillCloudWithAgent("missing-bag");
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();
    expect(missing.options.error.value).toBe("");

    const blankLabel = createWorkflowStateFixture();
    blankLabel.options.wordCloudDraft.value = createWordBagSet({
      wordBags: [{
        wordBagId: "target-bag",
        label: "   ",
        summary: "",
        relation: "overlap",
        absorbThreshold: 5,
        terms: [],
        removedTerms: [],
        children: [],
      }],
    });
    await blankLabel.controller.autoFillCloudWithAgent("target-bag");
    expect(blankLabel.options.error.value).toBe("请先填写词云名称后再调用智能体填充。");

    const disabled = createWorkflowStateFixture({
      selectedWordCloudModel: ref({
        value: "agent-disabled",
        enabled: false,
        disabledReason: "模型不可用",
      }),
    });
    disabled.options.wordCloudDraft.value = createWordBagSet({
      wordBags: [{
        wordBagId: "target-bag",
        label: "电商",
        summary: "",
        relation: "overlap",
        absorbThreshold: 5,
        terms: [],
        removedTerms: [],
        children: [],
      }],
    });
    await disabled.controller.autoFillCloudWithAgent("target-bag");
    expect(disabled.options.error.value).toBe("模型不可用");

    const noCorpus = createWorkflowStateFixture({
      resolveWordCloudCorpusPathsForQuery: vi.fn(() => []),
    });
    noCorpus.options.wordCloudDraft.value = createWordBagSet({
      wordBags: [{
        wordBagId: "target-bag",
        label: "电商",
        summary: "",
        relation: "overlap",
        absorbThreshold: 5,
        terms: [],
        removedTerms: [],
        children: [],
      }],
    });
    await noCorpus.controller.autoFillCloudWithAgent("target-bag");
    expect(noCorpus.options.error.value).toBe("请先添加语料范围后再启动填充任务。");
    expect(wordCloudClient.proposeKnowledgeWordClouds).not.toHaveBeenCalled();
  });

  it("applyWordCloudEvent delegates unrelated payloads to applySavedWordCloudSet", () => {
    const { controller, options } = createWorkflowStateFixture();
    const payload = createWordBagSet({
      wordBagSetId: "other-set",
      status: "ready",
      wordBags: [],
    });
    options.fillSourceWordBagSetId.value = "source-set";
    options.fillTargetWordBagId.value = "target-bag";
    options.fillingWordBagIds.value = new Set(["target-bag"]);

    expect(controller.applyWordCloudEvent(payload)).toBe(true);
    expect(options.applySavedWordCloudSet).toHaveBeenCalledWith(payload);
  });
});
