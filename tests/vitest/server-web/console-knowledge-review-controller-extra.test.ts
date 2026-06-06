import { computed, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAgentGateway } from "../../../server-web/lib/agent-gateway-client";
import {
  listKnowledgeReviewItems,
  resolveKnowledgeReviewItem,
} from "../../../server-web/lib/knowledge-review-client";
import { createConsoleKnowledgeReviewController } from "../../../server-web/composables/console-knowledge-review-controller";
import type { KnowledgeReviewItem } from "../../../server-web/lib/types";
import type { AppView } from "../../../server-web/types/app";

vi.mock("../../../server-web/lib/agent-gateway-client", () => ({
  callAgentGateway: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-review-client", () => ({
  listKnowledgeReviewItems: vi.fn(),
  resolveKnowledgeReviewItem: vi.fn(),
}));

const mockedCallAgentGateway = vi.mocked(callAgentGateway);
const mockedListKnowledgeReviewItems = vi.mocked(listKnowledgeReviewItems);
const mockedResolveKnowledgeReviewItem = vi.mocked(resolveKnowledgeReviewItem);

function makeReviewItem(overrides: Partial<KnowledgeReviewItem> = {}): KnowledgeReviewItem {
  return {
    reviewId: "review-1",
    entityId: "entity-1",
    entityType: "document",
    status: "pending",
    reason: "source_path_content_conflict",
    title: "知识冲突 1",
    summary: "Existing and incoming documents disagree.",
    currentRecord: {
      document: {
        documentId: "doc-current",
        title: "Current title",
        sourcePath: "/docs/current.md",
        sourceHash: "hash-current",
        text: "current body",
      },
    },
    incomingRecord: {
      document: {
        documentId: "doc-incoming",
        title: "Incoming title",
        sourcePath: "/docs/incoming.md",
        sourceHash: "hash-incoming",
        text: "incoming body",
      },
    },
    createdAt: "2026-06-04T08:00:00.000Z",
    updatedAt: "2026-06-04T08:30:00.000Z",
    ...overrides,
  };
}

function makeHarness(overrides: {
  canReadKnowledge?: boolean;
  canMaintainKnowledge?: boolean;
  canAdminKnowledge?: boolean;
  currentView?: AppView;
  reviewFusionModelAlias?: string;
  reviewFusionModelEnabled?: boolean;
  pendingReviewItems?: number;
  items?: KnowledgeReviewItem[];
} = {}) {
  const busyKeys: string[] = [];
  const busy = ref("");
  const error = ref("");
  const currentView = ref<AppView>(overrides.currentView || "dashboard");
  const knowledgeConsole = ref({
    available: true,
    health: {
      counts: {
        pendingReviewItems: overrides.pendingReviewItems ?? 0,
      },
    },
    capabilities: null,
    maintenance: null,
    recentJobs: [],
  });
  const knowledgeReviewItems = ref<KnowledgeReviewItem[]>(overrides.items || []);
  const settingsDraft = ref({
    agentExploreDefaults: {
      systemPrompt: "",
      toolPolicyPrompt: "",
      continuationPrompt: "",
      answerTemplate: "",
      contextProfileId: "context-1",
      thinkingMode: "balanced",
      temperature: 0.3,
      maxTokens: 1600,
      maxIterations: 3,
      limit: 5,
      toolChoice: "auto",
      reviewFusionModelAlias: overrides.reviewFusionModelAlias ?? "review-fusion",
      reviewFusionSystemPrompt: "fusion system prompt",
      reviewFusionTemperature: 0.25,
      reviewFusionMaxTokens: 900,
    },
  } as any);
  const agentSelectorOptions = computed(() => [
    {
      value: "review-fusion",
      agentUid: "agent-review-fusion",
      label: "知识融合智能体",
      provider: "openai",
      model: "gpt-4.1",
      moduleIds: ["agentTools"],
      capabilities: ["knowledge-review"],
      status: "available",
      enabled: overrides.reviewFusionModelEnabled ?? true,
      selectable: true,
      disabledReason: "未分配",
      reason: "可用",
    },
    {
      value: "disabled-fusion",
      agentUid: "agent-disabled-fusion",
      label: "已禁用智能体",
      provider: "openai",
      model: "gpt-4.1-mini",
      moduleIds: ["agentTools"],
      capabilities: ["knowledge-review"],
      status: "unconfigured",
      enabled: false,
      selectable: false,
      disabledReason: "已禁用",
      reason: "已禁用",
    },
  ]);
  const clearAllBusy = vi.fn(() => {
    busy.value = "";
  });
  const setBusy = vi.fn((key: string) => {
    busy.value = key;
    busyKeys.push(key);
  });
  const refreshKnowledgeConsole = vi.fn(async () => undefined);
  const controller = createConsoleKnowledgeReviewController({
    agentExploreThinkingParameters: () => ({ top_p: 0.8 }),
    agentSelectorOptions,
    canAdminKnowledge: computed(() => overrides.canAdminKnowledge ?? false),
    canMaintainKnowledge: computed(() => overrides.canMaintainKnowledge ?? true),
    canReadKnowledge: computed(() => overrides.canReadKnowledge ?? true),
    clearAllBusy,
    currentView,
    error,
    knowledgeConsole,
    refreshKnowledgeConsole,
    setBusy,
    settingsDraft,
  });

  return {
    agentSelectorOptions,
    busy,
    busyKeys,
    clearAllBusy,
    controller,
    currentView,
    error,
    knowledgeConsole,
    knowledgeReviewItems,
    refreshKnowledgeConsole,
    setBusy,
    settingsDraft,
  };
}

describe("console knowledge review controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads review items, keeps the first selection, clears selection when empty, and refreshes on status change", async () => {
    const first = makeReviewItem({ reviewId: "review-1", status: "pending" });
    const second = makeReviewItem({ reviewId: "review-2", status: "resolved" });
    mockedListKnowledgeReviewItems.mockResolvedValue({
      status: "ok",
      items: [first, second],
    } as any);

    const harness = makeHarness();

    await harness.controller.refreshKnowledgeConflicts();
    await nextTick();

    expect(mockedListKnowledgeReviewItems).toHaveBeenCalledWith({
      status: "pending",
      limit: 100,
    });
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:review-items");
    expect(harness.clearAllBusy).toHaveBeenCalled();
    expect(harness.controller.knowledgeReviewItems.value).toEqual([first, second]);
    expect(harness.controller.selectedKnowledgeReviewId.value).toBe("review-1");
    expect(harness.controller.selectedKnowledgeReviewItem.value).toEqual(first);
    expect(harness.controller.pendingKnowledgeReviewCount.value).toBe(1);
    expect(harness.controller.knowledgeReviewRowClassName({ row: first })).toBe("is-selected-review-row");
    expect(harness.controller.knowledgeReviewRowClassName({ row: second })).toBe("");

    harness.controller.selectKnowledgeReviewItem(second);
    expect(harness.controller.selectedKnowledgeReviewId.value).toBe("review-2");
    expect(harness.controller.selectedKnowledgeReviewItem.value).toEqual(second);
    expect(harness.controller.knowledgeReviewRowClassName({ row: second })).toBe("is-selected-review-row");

    harness.controller.knowledgeReviewItems.value = [];
    await nextTick();
    expect(harness.controller.selectedKnowledgeReviewId.value).toBe("");
    expect(harness.controller.selectedKnowledgeReviewItem.value).toBeNull();

    harness.controller.knowledgeReviewItems.value = [first, second];
    await nextTick();
    harness.currentView.value = "dashboard";
    harness.controller.knowledgeReviewStatus.value = "resolved";
    await nextTick();

    expect(mockedListKnowledgeReviewItems).toHaveBeenLastCalledWith({
      status: "resolved",
      limit: 100,
    });
  });

  it("uses console counts when no pending items are loaded and skips refresh when unreadable", async () => {
    const harness = makeHarness({
      pendingReviewItems: 4,
      canReadKnowledge: false,
      items: [],
    });

    expect(harness.controller.pendingKnowledgeReviewCount.value).toBe(4);

    await harness.controller.refreshKnowledgeConflicts();

    expect(mockedListKnowledgeReviewItems).not.toHaveBeenCalled();
    expect(harness.controller.knowledgeReviewRequestGeneration.value).toBe(1);
    expect(harness.setBusy).not.toHaveBeenCalled();
    expect(harness.clearAllBusy).not.toHaveBeenCalled();
  });

  it("reports load errors and preserves the current error when suppression is requested", async () => {
    mockedListKnowledgeReviewItems.mockRejectedValueOnce(new Error("加载失败"));
    const harness = makeHarness();
    harness.error.value = "keep me";

    await harness.controller.refreshKnowledgeConflicts({ suppressError: true });

    expect(harness.error.value).toBe("keep me");
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:review-items");
    expect(harness.clearAllBusy).toHaveBeenCalled();

    mockedListKnowledgeReviewItems.mockRejectedValueOnce("boom");
    await harness.controller.refreshKnowledgeConflicts();

    expect(harness.error.value).toBe("加载知识冲突列表失败。");
  });

  it("resolves accept, reject, and empty-id items, then refreshes the console", async () => {
    mockedListKnowledgeReviewItems.mockResolvedValue({
      status: "ok",
      items: [],
    } as any);
    mockedResolveKnowledgeReviewItem.mockResolvedValue({} as any);
    const harness = makeHarness();
    const acceptItem = makeReviewItem({ reviewId: "review-accept" });
    const rejectItem = makeReviewItem({ reviewId: "review-reject" });
    const emptyItem = makeReviewItem({ reviewId: "" });

    await harness.controller.resolveKnowledgeReview(acceptItem, "accept", {
      decision: "keep both",
    });
    await harness.controller.resolveKnowledgeReview(rejectItem, "reject");
    await harness.controller.resolveKnowledgeReview(emptyItem, "merge");

    expect(mockedResolveKnowledgeReviewItem).toHaveBeenCalledTimes(2);
    expect(mockedResolveKnowledgeReviewItem).toHaveBeenNthCalledWith(1, "review-accept", {
      resolution: "accept",
      patch: {
        decision: "keep both",
      },
    });
    expect(mockedResolveKnowledgeReviewItem).toHaveBeenNthCalledWith(2, "review-reject", {
      resolution: "reject",
      patch: {},
    });
    expect(harness.refreshKnowledgeConsole).toHaveBeenNthCalledWith(1, { skipReviewItems: true });
    expect(harness.refreshKnowledgeConsole).toHaveBeenNthCalledWith(2, { skipReviewItems: true });
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:review:review-accept:accept");
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:review:review-reject:reject");
    expect(harness.error.value).toBe("");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(2);
  });

  it("blocks resolution when maintain permission is missing and reports resolve failures", async () => {
    const harness = makeHarness({
      canMaintainKnowledge: false,
      canAdminKnowledge: false,
    });
    const item = makeReviewItem({ reviewId: "review-denied" });

    await harness.controller.resolveKnowledgeReview(item, "accept");

    expect(harness.error.value).toBe("需要 knowledge:maintain 权限才能处理冲突。");
    expect(mockedResolveKnowledgeReviewItem).not.toHaveBeenCalled();
    expect(harness.setBusy).not.toHaveBeenCalled();
    expect(harness.clearAllBusy).not.toHaveBeenCalled();

    const resolvingHarness = makeHarness();
    resolvingHarness.error.value = "";
    mockedResolveKnowledgeReviewItem.mockRejectedValueOnce(new Error("resolve failed"));
    await resolvingHarness.controller.resolveKnowledgeReview(item, "reject");
    expect(resolvingHarness.error.value).toBe("resolve failed");

    mockedResolveKnowledgeReviewItem.mockRejectedValueOnce("boom");
    await resolvingHarness.controller.resolveKnowledgeReview(item, "merge");
    expect(resolvingHarness.error.value).toBe("处理知识冲突失败。");
  });

  it("fuses a review through the selected model and handles missing or failing models", async () => {
    mockedCallAgentGateway.mockResolvedValue({
      answer: "  Fusion answer  ",
    } as any);
    mockedResolveKnowledgeReviewItem.mockResolvedValue({} as any);
    mockedListKnowledgeReviewItems.mockResolvedValue({
      status: "ok",
      items: [],
    } as any);

    const harness = makeHarness({
      reviewFusionModelAlias: "review-fusion",
      reviewFusionModelEnabled: true,
    });
    const item = makeReviewItem({ reviewId: "review-fuse" });

    await harness.controller.fuseKnowledgeReview(item);

    expect(mockedCallAgentGateway).toHaveBeenCalledWith({
      modelAlias: "review-fusion",
      alias: "review-fusion",
      moduleId: "agentTools",
      taskId: "review-fuse",
      sessionId: "review-fuse",
      question: expect.stringContaining("请对以下知识入库冲突做融合分析"),
      systemPrompt: "fusion system prompt",
      parameters: {
        top_p: 0.8,
        temperature: 0.25,
        max_tokens: 900,
      },
    });
    expect(mockedResolveKnowledgeReviewItem).toHaveBeenCalledWith("review-fuse", {
      resolution: "merge",
      patch: {
        fusionAgent: {
          modelAlias: "review-fusion",
          generatedAt: "2026-06-04T12:00:00.000Z",
          answer: "Fusion answer",
        },
      },
    });
    expect(harness.error.value).toBe("");
    expect(harness.setBusy).toHaveBeenCalledWith("knowledge:review:review-fuse:merge");
    expect(harness.clearAllBusy).toHaveBeenCalled();

    const missingModelHarness = makeHarness({
      reviewFusionModelAlias: "missing-model",
      reviewFusionModelEnabled: false,
    });
    await missingModelHarness.controller.fuseKnowledgeReview(item);
    expect(missingModelHarness.error.value).toBe("知识融合智能体未配置可用模型，请先在智能体分配中选择模型。");
    expect(mockedCallAgentGateway).toHaveBeenCalledTimes(1);

    mockedCallAgentGateway.mockRejectedValueOnce(new Error("gateway failed"));
    await harness.controller.fuseKnowledgeReview(item);
    expect(harness.error.value).toBe("gateway failed");
  });
});
