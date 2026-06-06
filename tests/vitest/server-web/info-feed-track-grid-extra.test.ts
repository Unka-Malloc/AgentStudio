// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfoFeedTrackGrid from "../../../server-web/components/feed/InfoFeedTrackGrid.vue";

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

type StageStatus = "queued" | "running" | "completed" | "failed";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    agent: {
      error: "",
      progress: 0,
      status: "queued" as StageStatus,
    },
    attachments: [],
    keyword: {
      error: "",
      fromCache: false,
      progress: 0,
      status: "queued" as StageStatus,
    },
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    infoFeedAgentAnswer: ref(""),
    infoFeedAgentSteps: ref([]),
    infoFeedAllKeywordItems: ref([]),
    infoFeedContextGateNotice: ref({
      highCount: 0,
      includedHigh: 0,
      includedLow: 0,
      lowCount: 0,
      message: "",
      remainingTokens: 0,
    }),
    infoFeedCurrentRun: ref(null),
    infoFeedKeywordItems: ref([]),
    infoFeedKeywordProgressLabel: ref(""),
    infoFeedLowRelevanceKeywordItems: ref([]),
    openAgentEvidencePreview: vi.fn(),
    selectedInfoFeedModel: ref({ label: "GPT-5.4" }),
    ...overrides,
  };
}

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone || "" }, props.label || "");
  },
});

const InfoFeedResultRowStub = defineComponent({
  name: "InfoFeedResultRow",
  props: {
    item: {
      type: Object,
      required: true,
    },
    tier: String,
  },
  emits: ["open"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "info-feed-result-row-stub",
          "data-tier": props.tier || "high",
          type: "button",
          onClick: () => emit("open", props.item),
        },
        String((props.item as { title?: string }).title || "result"),
      );
  },
});

function mountGrid() {
  return mount(InfoFeedTrackGrid, {
    global: {
      stubs: {
        InfoFeedResultRow: InfoFeedResultRowStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

beforeEach(() => {
  feedContextMock.current = makeContext();
});

describe("InfoFeedTrackGrid extra coverage", () => {
  it("renders nothing before a current run is available", () => {
    const wrapper = mountGrid();
    expect(wrapper.find(".info-feed-track-grid").exists()).toBe(false);
  });

  it("renders attachments, running keyword state, agent steps, and answer snippets", () => {
    const longAttachmentText = "正文 ".repeat(80);
    feedContextMock.current = makeContext({
      infoFeedAgentAnswer: ref("答案 ".repeat(200)),
      infoFeedAgentSteps: ref([
        {
          iteration: 1,
          phase: "tool_result",
          toolCalls: [{ id: "call-a" }],
          toolResults: [{ id: "result-a" }],
        },
      ]),
      infoFeedCurrentRun: ref(makeRun({
        agent: {
          error: "模型暂时不可用",
          progress: 55,
          status: "running",
        },
        attachments: [
          {
            error: "PDF 读取失败",
            id: "att-error",
            name: "error.pdf",
            progress: 20,
            size: 512,
            status: "failed",
          },
          {
            id: "att-text",
            name: "mail.eml",
            progress: 100,
            size: 2048,
            status: "completed",
            text: longAttachmentText,
          },
        ],
        keyword: {
          error: "",
          fromCache: true,
          progress: 40,
          status: "running",
        },
      })),
      infoFeedKeywordProgressLabel: ref("正在扫描原始文件 4/10"),
      selectedInfoFeedModel: ref({ label: "GPT-5.5" }),
    });

    const wrapper = mountGrid();

    expect(wrapper.attributes("data-has-attachments")).toBe("true");
    expect(wrapper.text()).toContain("2 个附件");
    expect(wrapper.text()).toContain("error.pdf");
    expect(wrapper.text()).toContain("512 B · 失败");
    expect(wrapper.text()).toContain("PDF 读取失败");
    expect(wrapper.text()).toContain("mail.eml");
    expect(wrapper.text()).toContain("2.0 KB · 完成");
    expect(wrapper.text()).toContain("直接扫描服务端原始文件 · 缓存");
    expect(wrapper.text()).toContain("正在扫描原始文件 4/10");
    expect(wrapper.text()).toContain("GPT-5.5");
    expect(wrapper.text()).toContain("正在规划工具调用和检索证据。");
    expect(wrapper.text()).toContain("第 1 轮");
    expect(wrapper.text()).toContain("工具返回 · 工具 1 · 返回 1");
    expect(wrapper.text()).toContain("模型暂时不可用");
    expect(wrapper.text()).toContain("答案");
    expect(wrapper.find('[data-indeterminate="true"]').exists()).toBe(true);
  });

  it("renders completed keyword results, context gate details, low relevance panel, and open events", async () => {
    const openAgentEvidencePreview = vi.fn();
    const highItem = {
      documentId: "doc-high",
      evidenceId: "evidence-high",
      title: "高关联邮件",
    };
    const lowItem = {
      documentId: "doc-low",
      itemId: "item-low",
      title: "低关联邮件",
    };
    feedContextMock.current = makeContext({
      infoFeedAllKeywordItems: ref([highItem, lowItem]),
      infoFeedContextGateNotice: ref({
        highCount: 4,
        includedHigh: 2,
        includedLow: 1,
        lowCount: 3,
        message: "上下文预算已限制结果。",
        remainingTokens: 12345,
      }),
      infoFeedCurrentRun: ref(makeRun({
        keyword: {
          error: "",
          fromCache: true,
          progress: 100,
          status: "completed",
        },
      })),
      infoFeedKeywordItems: ref([highItem]),
      infoFeedKeywordProgressLabel: ref("检索完成，命中 2 封邮件"),
      infoFeedLowRelevanceKeywordItems: ref([lowItem]),
      openAgentEvidencePreview,
    });

    const wrapper = mountGrid();
    const rows = wrapper.findAll(".info-feed-result-row-stub");

    expect(wrapper.text()).toContain("高关联 1 · 低关联 1 · 缓存");
    expect(wrapper.text()).toContain("检索完成，命中 2 封邮件");
    expect(wrapper.text()).toContain("上下文门禁");
    expect(wrapper.text()).toContain("高关联 2/4");
    expect(wrapper.text()).toContain("低关联 1/3");
    expect(wrapper.text()).toContain("剩余约 12,345 tokens");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("data-tier")).toBe("high");
    expect(rows[1].attributes("data-tier")).toBe("low");
    expect(wrapper.find("details").attributes("open")).toBeUndefined();

    await rows[0].trigger("click");
    await rows[1].trigger("click");

    expect(openAgentEvidencePreview).toHaveBeenNthCalledWith(1, highItem);
    expect(openAgentEvidencePreview).toHaveBeenNthCalledWith(2, lowItem);
  });

  it("opens low relevance results and shows empty messages when only low relevance or no results exist", () => {
    const lowItem = {
      documentId: "doc-low",
      title: "低关联邮件",
    };
    feedContextMock.current = makeContext({
      infoFeedAllKeywordItems: ref([lowItem]),
      infoFeedCurrentRun: ref(makeRun({
        keyword: {
          error: "",
          fromCache: false,
          progress: 100,
          status: "completed",
        },
      })),
      infoFeedLowRelevanceKeywordItems: ref([lowItem]),
    });

    const lowOnly = mountGrid();
    expect(lowOnly.text()).toContain("未找到可读正文同时命中的高关联邮件");
    expect(lowOnly.find("details").attributes("open")).toBe("");

    feedContextMock.current = makeContext({
      infoFeedAllKeywordItems: ref([]),
      infoFeedCurrentRun: ref(makeRun({
        keyword: {
          error: "检索失败",
          fromCache: false,
          progress: 0,
          status: "failed",
        },
      })),
    });

    const failed = mountGrid();
    expect(failed.text()).toContain("检索失败");

    feedContextMock.current = makeContext({
      infoFeedAllKeywordItems: ref([]),
      infoFeedCurrentRun: ref(makeRun({
        keyword: {
          error: "",
          fromCache: false,
          progress: 100,
          status: "completed",
        },
      })),
    });

    const empty = mountGrid();
    expect(empty.text()).toContain("没有找到原文检索结果。");
  });
});
