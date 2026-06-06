// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfoFeedCurrentUserCard from "../../../server-web/components/feed/InfoFeedCurrentUserCard.vue";
import InfoFeedFlowPanel from "../../../server-web/components/feed/InfoFeedFlowPanel.vue";
import InfoFeedTurnCards from "../../../server-web/components/feed/InfoFeedTurnCards.vue";
import JobsView from "../../../server-web/views/admin/JobsView.vue";

const feedContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const shellContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: () => feedContextMock.current,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => shellContextMock.current,
}));

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
          class: "safe-html-block-stub",
          "data-source": props.source || "",
          type: "button",
          onClick: () => emit("click", new MouseEvent("click")),
        },
        props.html || "",
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () =>
      h(
        "span",
        {
          class: "status-pill-stub",
          "data-tone": props.tone || "",
        },
        props.label || "",
      );
  },
});

const FlowChildStub = (name: string) =>
  defineComponent({
    name,
    props: {
      turn: Object,
      turnIndex: Number,
    },
    setup(props) {
      return () =>
        h(
          "div",
          {
            class: `${name}-stub`,
            "data-turn-id": String((props.turn as { turnId?: string } | undefined)?.turnId || ""),
            "data-turn-index": String(props.turnIndex ?? ""),
          },
          name,
        );
    },
  });

function makeFeedContext(overrides: Record<string, unknown> = {}) {
  return {
    handleAgentAnswerClick: vi.fn(),
    infoFeedCurrentRun: ref(null),
    infoFeedCurrentUserQuestion: vi.fn((run: { question?: string }) => run.question || "当前问题"),
    infoFeedExpertFeedbackForRun: vi.fn(() => []),
    infoFeedParentRunForCurrent: ref(null),
    infoFeedParentSummaryHtml: ref(""),
    infoFeedReadyForSummary: ref(false),
    infoFeedTurnAttachments: vi.fn(() => []),
    infoFeedTurnQuestion: vi.fn((turn: { question?: string }) => turn.question || "追问"),
    infoFeedTurnSummaryHtml: vi.fn(() => ""),
    infoFeedTurnTitle: vi.fn((_turn: unknown, turnIndex: number) => `第 ${turnIndex + 1} 轮`),
    infoFeedUserCardTitle: vi.fn(() => "当前轮次"),
    ...overrides,
  };
}

function makeJobsShellContext(overrides: Record<string, unknown> = {}) {
  return {
    adminView: ref("jobs"),
    busyKey: ref(""),
    consoleState: ref({
      jobs: {
        summary: {
          completedCount: 0,
          failedCount: 0,
          totalCount: 0,
        },
      },
    }),
    currentView: ref("admin"),
    deleteJob: vi.fn(),
    isAuthenticated: ref(true),
    queueMonitorState: ref({
      summary: {
        openCount: 0,
        totalCount: 0,
      },
    }),
    recentJobs: ref([]),
    workQueueRows: ref([]),
    workQueueSummary: ref({
      active: 0,
      interrupted: 0,
      recovered: 0,
      total: 0,
    }),
    ...overrides,
  };
}

function mountTurnCards(overrides: Record<string, unknown> = {}) {
  feedContextMock.current = makeFeedContext(overrides);
  return mount(InfoFeedTurnCards, {
    props: {
      turn: {
        attachments: [],
        completedAt: "2026-06-05T08:00:00.000Z",
        expertFeedback: [],
        question: "原始问题",
        summaryAnswer: "",
        summaryError: "",
        summaryFallback: false,
        turnId: "turn-1",
      },
      turnIndex: 0,
    },
    global: {
      stubs: {
        InfoFeedExpertFeedbackList: true,
        SafeHtmlBlock: SafeHtmlBlockStub,
      },
    },
  });
}

function mountCurrentUserCard(overrides: Record<string, unknown> = {}) {
  feedContextMock.current = makeFeedContext(overrides);
  return mount(InfoFeedCurrentUserCard);
}

function mountFlowPanel(overrides: Record<string, unknown> = {}) {
  feedContextMock.current = makeFeedContext(overrides);
  return mount(InfoFeedFlowPanel, {
    global: {
      stubs: {
        InfoFeedCurrentUserCard: defineComponent({
          name: "InfoFeedCurrentUserCard",
          setup() {
            return () => h("div", { class: "current-user-card-stub" }, "current-user");
          },
        }),
        InfoFeedParentContextCards: defineComponent({
          name: "InfoFeedParentContextCards",
          setup() {
            return () => h("div", { class: "parent-context-card-stub" }, "parent-context");
          },
        }),
        InfoFeedPausePanels: defineComponent({
          name: "InfoFeedPausePanels",
          setup() {
            return () => h("div", { class: "pause-panels-stub" }, "pause-panels");
          },
        }),
        InfoFeedSummaryPanels: defineComponent({
          name: "InfoFeedSummaryPanels",
          setup() {
            return () => h("div", { class: "summary-panels-stub" }, "summary-panels");
          },
        }),
        InfoFeedTrackGrid: defineComponent({
          name: "InfoFeedTrackGrid",
          setup() {
            return () => h("div", { class: "track-grid-stub" }, "track-grid");
          },
        }),
        InfoFeedTurnCards: FlowChildStub("InfoFeedTurnCards"),
      },
    },
  });
}

function mountJobsView(overrides: Record<string, unknown> = {}) {
  shellContextMock.current = makeJobsShellContext(overrides);
  return mount(JobsView, {
    global: {
      stubs: {
        StatusPill: StatusPillStub,
      },
    },
  });
}

beforeEach(() => {
  feedContextMock.current = null;
  shellContextMock.current = null;
});

describe("server-web feed cards and jobs view extra coverage", () => {
  it("renders the current user card with attachments and suppresses output when there is no current run", () => {
    const wrapper = mountCurrentUserCard({
      infoFeedCurrentRun: ref({
        attachments: [
          {
            id: "att-1",
            name: "source.eml",
            size: 2048,
            status: "completed",
          },
          {
            id: "att-2",
            name: "notes.txt",
            size: 17,
            status: "failed",
          },
        ],
        followUp: true,
        question: "需要补充哪些证据？",
        startedAt: "2026-06-05T07:30:00.000Z",
      }),
      infoFeedCurrentUserQuestion: vi.fn((run: { question?: string }) => run.question || ""),
      infoFeedUserCardTitle: vi.fn(() => "当前轮次"),
    });

    expect(wrapper.text()).toContain("当前轮次");
    expect(wrapper.text()).toContain("本轮追问");
    expect(wrapper.text()).toContain("需要补充哪些证据？");
    expect(wrapper.text()).toContain("source.eml");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(wrapper.text()).toContain("完成");
    expect(wrapper.text()).toContain("notes.txt");
    expect(wrapper.text()).toContain("17 B");
    expect(wrapper.text()).toContain("失败");

    feedContextMock.current = makeFeedContext({
      infoFeedCurrentRun: ref(null),
    });
    const emptyWrapper = mount(InfoFeedCurrentUserCard);
    expect(emptyWrapper.html()).toBe("<!--v-if-->");
  });

  it("renders turn cards, summary content, feedback, and answer clicks", async () => {
    const context = makeFeedContext({
      handleAgentAnswerClick: vi.fn(),
      infoFeedTurnAttachments: vi.fn(() => [
        {
          id: "turn-att-1",
          name: "evidence.pdf",
          size: 3000,
          status: "completed",
        },
      ]),
      infoFeedTurnQuestion: vi.fn(() => "这轮问了什么？"),
      infoFeedTurnSummaryHtml: vi.fn(() => "<p>已生成摘要</p>"),
      infoFeedTurnTitle: vi.fn((_turn: unknown, turnIndex: number) => `回合 ${turnIndex + 1}`),
      infoFeedUserCardTitle: vi.fn(() => "用户回合"),
    });
    feedContextMock.current = context;
    const wrapper = mount(InfoFeedTurnCards, {
      props: {
        turn: {
          attachments: [],
          completedAt: "2026-06-05T08:10:00.000Z",
          expertFeedback: [
            {
              feedbackId: "fb-1",
              followUpQuestion: "补充来源",
              prompt: "请补充原始邮件。",
              selectedLabel: "继续追问",
              syncStatus: "synced",
            },
          ],
          question: "原始问题",
          summaryAnswer: "final",
          summaryError: "摘要存在警告",
          summaryFallback: true,
          turnId: "turn-1",
        },
        turnIndex: 1,
      },
      global: {
        stubs: {
          SafeHtmlBlock: SafeHtmlBlockStub,
        },
      },
    });

    expect(wrapper.text()).toContain("用户回合");
    expect(wrapper.text()).toContain("回合 2");
    expect(wrapper.text()).toContain("这轮问了什么？");
    expect(wrapper.text()).toContain("evidence.pdf");
    expect(wrapper.text()).toContain("2.9 KB");
    expect(wrapper.text()).toContain("输出报告");
    expect(wrapper.text()).toContain("兜底摘要");
    expect(wrapper.text()).toContain("摘要存在警告");
    expect(wrapper.find(".safe-html-block-stub").attributes("data-source")).toBe("markdownToSafeHtml");
    expect(wrapper.text()).toContain("人类专家意见");
    expect(wrapper.text()).toContain("继续追问");

    await wrapper.find(".safe-html-block-stub").trigger("click");

    expect(context.handleAgentAnswerClick).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for turn cards when the summary is absent", () => {
    feedContextMock.current = makeFeedContext({
      infoFeedTurnAttachments: vi.fn(() => []),
      infoFeedTurnSummaryHtml: vi.fn(() => ""),
    });
    const wrapper = mount(InfoFeedTurnCards, {
      props: {
        turn: {
          attachments: [],
          completedAt: "2026-06-05T08:10:00.000Z",
          expertFeedback: [],
          question: "原始问题",
          summaryAnswer: "",
          summaryError: "",
          summaryFallback: false,
          turnId: "turn-2",
        },
        turnIndex: 0,
      },
      global: {
        stubs: {
          SafeHtmlBlock: SafeHtmlBlockStub,
        },
      },
    });

    expect(wrapper.text()).toContain("输出报告");
    expect(wrapper.find(".safe-html-block-stub").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("人类专家意见");
    expect(wrapper.text()).not.toContain("兜底摘要");
  });

  it("renders the flow panel only when a current run exists and forwards turn cards", () => {
    const emptyWrapper = mountFlowPanel({
      infoFeedCurrentRun: ref(null),
    });

    expect(emptyWrapper.html()).toBe("<!--v-if-->");

    const wrapper = mountFlowPanel({
      infoFeedCurrentRun: ref({
        turns: [
          { turnId: "turn-a" },
          { turnId: "turn-b" },
        ],
      }),
    });

    expect(wrapper.text()).toContain("parent-context");
    expect(wrapper.text()).toContain("current-user");
    expect(wrapper.text()).toContain("track-grid");
    expect(wrapper.text()).toContain("pause-panels");
    expect(wrapper.text()).toContain("summary-panels");
    expect(wrapper.findAll(".InfoFeedTurnCards-stub")).toHaveLength(2);
    expect(wrapper.find('[data-turn-id="turn-a"]').exists()).toBe(true);
    expect(wrapper.find('[data-turn-id="turn-b"]').exists()).toBe(true);
  });

  it("renders job rows, empty states, and delete interactions", async () => {
    const context = makeJobsShellContext({
      busyKey: ref(""),
      consoleState: ref({
        jobs: {
          summary: {
            completedCount: 2,
            failedCount: 1,
            totalCount: 3,
          },
        },
      }),
      queueMonitorState: ref({
        summary: {
          openCount: 1,
          totalCount: 4,
        },
      }),
      recentJobs: ref([
        {
          id: "job-1",
          progressPercent: 75,
          queueId: "queue-a",
          stage: "parse",
          status: "running",
          updatedAt: "2026-06-05T08:00:00.000Z",
        },
      ]),
      workQueueRows: ref([
        {
          detail: "等待解析",
          kind: "document",
          label: "导入队列",
          lifecycleStatus: "running",
          lastHeartbeatAt: "2026-06-05T08:00:00.000Z",
          ownerId: "",
          phase: "处理中",
          queueId: "queue-a",
          rowId: "row-1",
          sourceLabel: "文档解析",
          startedAt: "2026-06-05T07:50:00.000Z",
          status: "open",
          tone: "running",
          updatedAt: "2026-06-05T08:01:00.000Z",
        },
      ]),
      workQueueSummary: ref({
        active: 1,
        interrupted: 0,
        recovered: 1,
        total: 1,
      }),
    });
    shellContextMock.current = context;
    const wrapper = mount(JobsView, {
      global: {
        stubs: {
          StatusPill: StatusPillStub,
        },
      },
    });

    expect(wrapper.text()).toContain("任务队列");
    expect(wrapper.text()).toContain("队列 1");
    expect(wrapper.text()).toContain("活跃 1");
    expect(wrapper.text()).toContain("恢复 1");
    expect(wrapper.text()).toContain("队列状态");
    expect(wrapper.text()).toContain("监控项 4");
    expect(wrapper.text()).toContain("打开 1");
    expect(wrapper.text()).toContain("导入队列");
    expect(wrapper.text()).toContain("queue-a");
    expect(wrapper.text()).toContain("文档解析");
    expect(wrapper.text()).toContain("无 owner");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("处理中");
    expect(wrapper.text()).toContain("任务记录");
    expect(wrapper.text()).toContain("job-1");
    expect(wrapper.text()).toContain("queue-a");
    expect(wrapper.text()).toContain("75%");
    expect(wrapper.find(".table-action").text()).toBe("删除");

    await wrapper.find(".table-action").trigger("click");
    expect(context.deleteJob).toHaveBeenCalledWith("job-1");

    context.busyKey.value = "job:job-1";
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".table-action").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".table-action").text()).toBe("处理中");

    const emptyWrapper = mountJobsView({
      consoleState: ref({
        jobs: {
          summary: {
            completedCount: 0,
            failedCount: 0,
            totalCount: 0,
          },
        },
      }),
      recentJobs: ref([]),
      workQueueRows: ref([]),
      workQueueSummary: ref({
        active: 0,
        interrupted: 0,
        recovered: 0,
        total: 0,
      }),
      queueMonitorState: ref({
        summary: {
          openCount: 0,
          totalCount: 0,
        },
      }),
    });

    expect(emptyWrapper.text()).toContain("暂无队列记录");
    expect(emptyWrapper.text()).toContain("暂无任务记录");
  });
});
