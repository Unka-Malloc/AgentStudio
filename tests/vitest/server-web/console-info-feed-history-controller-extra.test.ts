// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfoFeedRunState } from "../../../server-web/types/app";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";

const STORAGE_KEY = "test-info-feed-history-controller";

function summaryDefaults() {
  return {
    modelAlias: "model-default",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function createRun(overrides: {
  runId?: string;
  query?: string;
  answer?: string;
  completedAt?: string;
  summaryModelAlias?: string;
  summaryStatus?: string;
  contextProfileId?: string;
}) {
  const run = createInfoFeedRunState(overrides.query || "问题", {
    attachments: [],
    summaryDefaults: summaryDefaults(),
  });
  run.runId = overrides.runId || run.runId;
  if (overrides.query !== undefined) {
    run.query = overrides.query;
  }
  run.completedAt = overrides.completedAt || run.startedAt;
  run.summary.answer = overrides.answer ?? "";
  run.summary.status = overrides.summaryStatus || "completed";
  run.summary.modelAlias = overrides.summaryModelAlias || "model-default";
  run.summary.contextProfileId = overrides.contextProfileId || "ctx-default";
  return run;
}

function createHistoryFixture(overrides: {
  storageKey?: string;
  validAgentModelAlias?: (value?: string) => string;
} = {}) {
  const infoFeedAttachments = ref([] as InfoFeedRunState["attachments"]);
  const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
  const infoFeedForm = ref({
    query: "",
    modelAlias: "",
    contextProfileId: "ctx-start",
    temperature: 0.2,
    maxTokens: 1800,
  });
  const infoFeedHistory = ref<InfoFeedRunState[]>([]);
  const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(null);

  const options = {
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
    storageKey: overrides.storageKey || STORAGE_KEY,
    evidenceRefs: vi.fn(() => ["evidence-1"]),
    hasAgentModelOption: vi.fn((value?: string) => value !== "removed"),
    summaryDefaults,
    validAgentModelAlias: overrides.validAgentModelAlias || ((value?: string) => value === "removed" ? "model-default" : (value || "")),
  } as const;

  return {
    controller: createConsoleInfoFeedHistoryController(options),
    infoFeedAttachments,
    infoFeedCurrentRun,
    infoFeedForm,
    infoFeedHistory,
    infoFeedParentRunSnapshot,
    options,
  };
}

describe("console info feed history controller", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("列表计算会基于历史与当前运行状态返回面板项，空历史返回空列表", () => {
    const { controller, infoFeedCurrentRun, infoFeedHistory } = createHistoryFixture();
    const runA = createRun({
      runId: "run-a",
      query: "如何生成摘要",
      answer: "先理解问题，再查询证据。",
      completedAt: "2026-06-04T00:00:00.000Z",
    });
    const runB = createRun({
      runId: "run-b",
      query: "",
      answer: "",
      completedAt: "2026-06-03T00:00:00.000Z",
    });

    infoFeedHistory.value = [runA, runB];
    infoFeedCurrentRun.value = runA;

    expect(controller.infoFeedHistoryPanelItems.value).toHaveLength(2);
    expect(controller.infoFeedHistoryPanelItems.value[0]).toMatchObject({
      id: "run-a",
      title: "如何生成摘要",
      active: true,
      preview: "先理解问题，再查询证据。",
    });
    expect(controller.infoFeedHistoryPanelItems.value[1]).toMatchObject({
      id: "run-b",
      title: "未命名问题",
      active: false,
      preview: "",
    });
    expect(controller.infoFeedHistoryPanelItems.value[0].meta).toContain("completed");

    const { infoFeedHistoryPanelItems } = createHistoryFixture().controller;
    expect(infoFeedHistoryPanelItems.value).toHaveLength(0);
  });

  it("选择历史条目会恢复运行、同步表单并清除父级快照，未命中项不改动状态", async () => {
    const { controller, infoFeedCurrentRun, infoFeedHistory, infoFeedForm, infoFeedParentRunSnapshot } = createHistoryFixture({
      validAgentModelAlias: (value?: string) => value === "removed" ? "fallback-model" : (value || ""),
    });
    const parent = createRun({ runId: "parent", query: "父问题", answer: "父答案" });
    const selected = createRun({
      runId: "selected",
      query: "子问题",
      answer: "子答案",
      contextProfileId: "ctx-selected",
      summaryModelAlias: "removed",
    });

    infoFeedParentRunSnapshot.value = parent;
    infoFeedHistory.value = [selected];
    infoFeedCurrentRun.value = null;
    infoFeedForm.value.query = "待提交";
    infoFeedForm.value.contextProfileId = "ctx-old";

    controller.selectInfoFeedHistoryItem("selected");
    expect(infoFeedCurrentRun.value?.runId).toBe("selected");
    expect(infoFeedParentRunSnapshot.value).toBeNull();
    expect(infoFeedForm.value.query).toBe("");
    expect(infoFeedForm.value.modelAlias).toBe("fallback-model");
    expect(infoFeedForm.value.contextProfileId).toBe("ctx-selected");

    controller.selectInfoFeedHistoryItem("missing");
    expect(infoFeedCurrentRun.value?.runId).toBe("selected");
  });

  it("删除历史会清理当前选中项并写入持久化", () => {
    const { controller, infoFeedCurrentRun, infoFeedHistory, options } = createHistoryFixture({
      validAgentModelAlias: (value?: string) => value || "model-default",
    });
    const runA = createRun({ runId: "a", query: "A", answer: "A 的回答" });
    const runB = createRun({ runId: "b", query: "B", answer: "B 的回答" });

    infoFeedHistory.value = [runA, runB];
    infoFeedCurrentRun.value = runA;
    controller.deleteInfoFeedHistoryItem("a");

    expect(infoFeedHistory.value.map((run) => run.runId)).toEqual(["b"]);
    expect(infoFeedCurrentRun.value).toBeNull();

    const payload = JSON.parse(window.localStorage.getItem(options.storageKey) || "{}");
    expect(payload.version).toBe(1);
    expect(payload.history).toHaveLength(1);
  });

  it("恢复历史持久化分支覆盖版本兼容、异常与去重", () => {
    const { controller, options, infoFeedHistory } = createHistoryFixture({
      validAgentModelAlias: (value?: string) => value === "removed" ? "fallback-model" : (value || ""),
    });

    window.localStorage.setItem(options.storageKey, "not-json");
    controller.restoreInfoFeedHistory();
    expect(infoFeedHistory.value).toHaveLength(0);

    window.localStorage.setItem(options.storageKey, JSON.stringify({
      version: 2,
      history: [createRun({ runId: "unsupported" })],
    }));
    controller.restoreInfoFeedHistory();
    expect(infoFeedHistory.value).toHaveLength(0);

    const first = createRun({
      runId: "dup",
      summaryModelAlias: "removed",
      completedAt: "2026-06-04T00:00:00.000Z",
    });
    const second = createRun({
      runId: "dup",
      summaryModelAlias: "removed",
      completedAt: "2026-06-05T00:00:00.000Z",
    });
    window.localStorage.setItem(
      options.storageKey,
      JSON.stringify({
        version: 1,
        history: [first, second],
      }),
    );
    controller.restoreInfoFeedHistory();

    expect(infoFeedHistory.value).toHaveLength(1);
    expect(infoFeedHistory.value[0].runId).toBe("dup");
    expect(infoFeedHistory.value[0].summary.modelAlias).toBe("fallback-model");

    const persisted = JSON.parse(window.localStorage.getItem(options.storageKey) || "{}");
    expect(persisted.version).toBe(1);
    expect(persisted.history).toHaveLength(1);
  });

  it("读取附件失败会落到错误状态分支", async () => {
    const { controller } = createHistoryFixture();
    const brokenFile = new File(["x"], "broken.txt", { type: "text/plain" }) as File & {
      text: () => Promise<string>;
    };
    Object.defineProperty(brokenFile, "text", {
      configurable: true,
      value: () => Promise.reject(new Error("磁盘访问失败")),
    });

    const result = await controller.readInfoFeedAttachment(brokenFile);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("磁盘访问失败");
  });
});
