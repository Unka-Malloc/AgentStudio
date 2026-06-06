// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfoFeedSummaryPanels from "../../../server-web/components/feed/InfoFeedSummaryPanels.vue";

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

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

const SafeHtmlBlockStub = defineComponent({
  name: "SafeHtmlBlock",
  props: {
    html: String,
    source: String,
  },
  emits: ["click"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "safe-html-stub",
          "data-source": props.source || "",
          type: "button",
          onClick: () => emit("click", new MouseEvent("click")),
        },
        props.html || "",
      );
  },
});

const InfoFeedExpertFeedbackListStub = defineComponent({
  name: "InfoFeedExpertFeedbackList",
  props: {
    feedbackItems: Array,
  },
  setup(props) {
    return () =>
      h(
        "div",
        {
          class: "feedback-list-stub",
          "data-count": String((props.feedbackItems || []).length),
        },
        "feedback",
      );
  },
});

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      answer: "",
      error: "",
      fallback: false,
      progress: 0,
      status: "queued",
      ...((overrides.summary as Record<string, unknown> | undefined) || {}),
    },
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    chooseInfoFeedClarification: vi.fn(),
    copyInfoFeedSummary: vi.fn(),
    exportInfoFeedSummary: vi.fn(),
    handleAgentAnswerClick: vi.fn(),
    infoFeedClarification: ref(null),
    infoFeedCurrentRun: ref(null),
    infoFeedExpertFeedbackFor: vi.fn((scope: string) =>
      scope === "summary" ? [{ id: "feedback-summary" }] : [{ id: "feedback-report" }],
    ),
    infoFeedReadyForSummary: ref(false),
    infoFeedStreamingSummaryHtml: ref(""),
    infoFeedSummaryIsStreaming: ref(false),
    infoFeedSummaryMarkdown: ref(""),
    infoFeedSummaryRuntime: ref({
      maxTokens: 1200,
      model: "gpt-5.4-mini",
      temperature: 0.2,
    }),
    runInfoFeedSummaryAgent: vi.fn(),
    ...overrides,
  };
}

function mountPanels() {
  return mount(InfoFeedSummaryPanels, {
    global: {
      stubs: {
        InfoFeedExpertFeedbackList: InfoFeedExpertFeedbackListStub,
        SafeHtmlBlock: SafeHtmlBlockStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

beforeEach(() => {
  feedContextMock.current = makeContext();
});

describe("InfoFeedSummaryPanels extra coverage", () => {
  it("renders nothing before the run is ready for summary", () => {
    const wrapper = mountPanels();

    expect(wrapper.find(".info-feed-summary-filter").exists()).toBe(false);
    expect(wrapper.find(".info-feed-final-card").exists()).toBe(false);
    expect(wrapper.find(".info-feed-clarification-card").exists()).toBe(false);
  });

  it("renders summary metadata, status, feedback, and rerun action", async () => {
    const context = makeContext({
      infoFeedCurrentRun: ref(makeRun({ summary: { status: "completed" } })),
      infoFeedReadyForSummary: ref(true),
    });
    feedContextMock.current = context;
    const wrapper = mountPanels();

    expect(wrapper.text()).toContain("知识归纳");
    expect(wrapper.text()).toContain("融合原文检索");
    expect(wrapper.text()).toContain("gpt-5.4-mini");
    expect(wrapper.text()).toContain("0.2");
    expect(wrapper.text()).toContain("1200");
    expect(wrapper.find(".status-pill-stub").attributes("data-tone")).toBe("success");
    expect(wrapper.find(".status-pill-stub").text()).toBe("总结完成");
    expect(wrapper.find(".feedback-list-stub").attributes("data-count")).toBe("1");

    await wrapper.find("button.compact-action").trigger("click");
    expect(context.runInfoFeedSummaryAgent).toHaveBeenCalledTimes(1);
  });

  it("shows running summary progress and disables rerun and clarification options", async () => {
    const option = { description: "方向 A", label: "选项 A", optionId: "a" };
    const context = makeContext({
      infoFeedClarification: ref({
        options: [option],
        prompt: "请选择方向",
        reason: "问题不明确",
        selectedOptionId: "",
        status: "pending",
      }),
      infoFeedCurrentRun: ref(makeRun({
        summary: {
          answer: "streaming",
          progress: 42,
          status: "running",
        },
      })),
      infoFeedReadyForSummary: ref(true),
    });
    feedContextMock.current = context;
    const wrapper = mountPanels();

    expect(wrapper.text()).toContain("总结智能体正在融合两路结果。");
    expect(wrapper.find(".info-feed-progress-track span").attributes("style")).toContain("width: 42%");
    expect(wrapper.find("button.compact-action").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".info-feed-clarification-card").text()).toContain("问题不明确");
    expect(wrapper.find(".info-feed-clarification-card .status-pill-stub").attributes("data-tone")).toBe("warning");
    expect(wrapper.find(".info-feed-clarification-option").attributes("disabled")).toBeDefined();

    await wrapper.find(".info-feed-clarification-option").trigger("click");
    expect(context.chooseInfoFeedClarification).not.toHaveBeenCalled();
  });

  it("renders completed reports and triggers copy, export, and content click handlers", async () => {
    const context = makeContext({
      infoFeedCurrentRun: ref(makeRun({
        summary: {
          answer: "final",
          error: "minor warning",
          fallback: true,
          status: "completed",
        },
      })),
      infoFeedReadyForSummary: ref(false),
      infoFeedStreamingSummaryHtml: ref("<p>最终报告</p>"),
      infoFeedSummaryMarkdown: ref("# 最终报告"),
    });
    feedContextMock.current = context;
    const wrapper = mountPanels();
    const buttons = wrapper.findAll("button");

    expect(wrapper.text()).toContain("输出报告");
    expect(wrapper.text()).toContain("兜底摘要");
    expect(wrapper.text()).toContain("minor warning");
    expect(wrapper.find(".safe-html-stub").attributes("data-source")).toBe("markdownToSafeHtml");
    expect(wrapper.findAll(".feedback-list-stub").at(-1)?.attributes("data-count")).toBe("1");

    await buttons.find((button) => button.text().includes("复制"))?.trigger("click");
    await buttons.find((button) => button.text().includes("导出 Markdown"))?.trigger("click");
    await wrapper.find(".safe-html-stub").trigger("click");

    expect(context.copyInfoFeedSummary).toHaveBeenCalledTimes(1);
    expect(context.exportInfoFeedSummary).toHaveBeenCalledTimes(1);
    expect(context.handleAgentAnswerClick).toHaveBeenCalledTimes(1);
  });

  it("allows selecting clarification options when the summary is not running", async () => {
    const option = { description: "", followUpQuestion: "继续问什么？", label: "补充背景", optionId: "extra" };
    const context = makeContext({
      infoFeedClarification: ref({
        options: [option],
        prompt: "选择继续方向",
        reason: "",
        selectedOptionId: "extra",
        status: "answered",
      }),
      infoFeedCurrentRun: ref(makeRun({ summary: { status: "completed" } })),
      infoFeedReadyForSummary: ref(false),
    });
    feedContextMock.current = context;
    const wrapper = mountPanels();

    expect(wrapper.text()).toContain("选择一个方向继续。");
    expect(wrapper.find(".info-feed-clarification-card .status-pill-stub").attributes("data-tone")).toBe("success");
    expect(wrapper.find(".info-feed-clarification-option").attributes("data-selected")).toBe("true");
    expect(wrapper.text()).toContain("继续问什么？");

    await wrapper.find(".info-feed-clarification-option").trigger("click");
    expect(context.chooseInfoFeedClarification).toHaveBeenCalledWith(option);
  });
});
