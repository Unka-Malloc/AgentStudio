import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendInfoFeedTurnSnapshotCore,
  createInfoFeedFollowUpContext,
  createInfoFeedRunState,
  createInitialInfoFeedAgentState,
  createInitialInfoFeedKeywordState,
  createInitialInfoFeedSummaryState,
  resetInfoFeedRunForContinuationCore,
  snapshotInfoFeedTurnCore,
} from "../../../server-web/composables/console-info-feed-run-state-utils";
import type { InfoFeedAttachment, InfoFeedRunState } from "../../../server-web/types/app";

const summaryDefaults = {
  contextProfileId: "balanced",
  maxTokens: 2048,
  modelAlias: "gpt-5.4",
  temperature: 0.2,
};

function makeAttachment(overrides: Partial<InfoFeedAttachment> = {}): InfoFeedAttachment {
  return {
    error: "",
    id: "attachment-a",
    name: "mail.eml",
    progress: 100,
    size: 42,
    status: "completed",
    text: "mail body",
    ...overrides,
  } as InfoFeedAttachment;
}

function makeRun(query = "初始问题", overrides: Partial<InfoFeedRunState> = {}): InfoFeedRunState {
  return {
    ...createInfoFeedRunState(query, {
      attachments: [makeAttachment()],
      summaryDefaults,
    }),
    ...overrides,
  } as InfoFeedRunState;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("console info feed run state utils extra coverage", () => {
  it("creates initial run state and default stage states", () => {
    const keyword = createInitialInfoFeedKeywordState();
    const agent = createInitialInfoFeedAgentState();
    const summary = createInitialInfoFeedSummaryState(summaryDefaults);
    const followUp = {
      parentEvidenceRefs: ["ev-parent"],
      parentQuery: "父问题",
      parentRunId: "run-parent",
      parentSummary: "父摘要",
      question: "追问？",
    };
    const run = createInfoFeedRunState("新问题", {
      attachments: [makeAttachment({ id: "attachment-source" })],
      followUp,
      summaryDefaults,
    });

    expect(keyword).toEqual({
      error: "",
      fromCache: false,
      progress: 0,
      response: null,
      stage: "",
      status: "idle",
    });
    expect(agent).toEqual({
      error: "",
      progress: 0,
      response: null,
      runId: "",
      status: "idle",
      workspaceId: "",
    });
    expect(summary).toMatchObject({
      answer: "",
      contextProfileId: "balanced",
      fallback: false,
      maxTokens: 2048,
      modelAlias: "gpt-5.4",
      parametersOpen: false,
      progress: 0,
      status: "idle",
      temperature: 0.2,
    });
    expect(run.runId).toMatch(/^run-/);
    expect(run.startedAt).toBe("2026-06-04T12:00:00.000Z");
    expect(run.attachments).toMatchObject([{ id: "attachment-source", name: "mail.eml" }]);
    expect(run.followUp).toEqual(followUp);
    expect(run.keyword).toEqual(keyword);
    expect(run.agent).toEqual(agent);
    expect(run.summary).toEqual(summary);
    expect(run.expertFeedback).toEqual([]);
    expect(run.turns).toEqual([]);
  });

  it("builds follow-up context from summary, keyword evidence, agent text, and summary text", () => {
    const longSummary = "摘要 ".repeat(1000);
    const previousRun = makeRun("父问题", {
      agent: {
        ...createInitialInfoFeedAgentState(),
        response: { answer: "请参考 evidence::agent-1 和 ev_agent_2。" },
      },
      keyword: {
        ...createInitialInfoFeedKeywordState(),
        response: {
          items: [
            { evidenceId: "keyword-1" },
            { evidenceId: "" },
          ],
          results: [{ evidenceId: "ignored-when-items-present" }],
        },
      },
      runId: "run-parent",
      summary: {
        ...createInitialInfoFeedSummaryState(summaryDefaults),
        answer: `${longSummary} source-evidence::summary-1 evidence::agent-1`,
      },
    } as Partial<InfoFeedRunState>);

    const followUp = createInfoFeedFollowUpContext(previousRun, "继续解释？");

    expect(followUp).toMatchObject({
      parentEvidenceRefs: ["keyword-1", "evidence::agent-1", "ev_agent_2", "source-evidence::summary-1"],
      parentQuery: "父问题",
      parentRunId: "run-parent",
      question: "继续解释？",
    });
    expect(followUp?.parentSummary.length).toBeLessThanOrEqual(2600);
    expect(createInfoFeedFollowUpContext(null, "无上文")).toBeUndefined();
    expect(createInfoFeedFollowUpContext(makeRun("空摘要"), "无摘要")).toBeUndefined();
  });

  it("uses results fallback and caps follow-up evidence refs at sixteen unique values", () => {
    const previousRun = makeRun("父问题", {
      keyword: {
        ...createInitialInfoFeedKeywordState(),
        response: {
          results: Array.from({ length: 20 }, (_, index) => ({ evidenceId: `ev-${index}` })),
        },
      },
      summary: {
        ...createInitialInfoFeedSummaryState(summaryDefaults),
        answer: "摘要可用",
      },
    } as Partial<InfoFeedRunState>);

    expect(createInfoFeedFollowUpContext(previousRun, "继续")?.parentEvidenceRefs).toEqual(
      Array.from({ length: 16 }, (_, index) => `ev-${index}`),
    );
  });

  it("creates turn snapshots only when summary or expert feedback exists", () => {
    const emptyRun = makeRun("空轮次");
    expect(snapshotInfoFeedTurnCore(emptyRun, {
      evidenceRefs: () => ["ev-empty"],
      summaryModelAlias: "fallback-model",
    })).toBeNull();

    const run = makeRun("有摘要", {
      completedAt: "2026-06-04T11:00:00.000Z",
      expertFeedback: [{ feedbackId: "feedback-a", answer: "yes" }] as never,
      followUp: {
        parentEvidenceRefs: [],
        parentQuery: "父问题",
        parentRunId: "run-parent",
        parentSummary: "父摘要",
        question: "补充问题",
      },
      summary: {
        ...createInitialInfoFeedSummaryState(summaryDefaults),
        answer: " 摘要答案 ",
        error: "summary warning",
        fallback: true,
        modelAlias: "",
      },
    } as Partial<InfoFeedRunState>);

    const snapshot = snapshotInfoFeedTurnCore(run, {
      evidenceRefs: () => ["ev-a"],
      summaryModelAlias: "fallback-model",
    });

    expect(snapshot).toMatchObject({
      attachments: [{ id: "attachment-a", name: "mail.eml" }],
      completedAt: "2026-06-04T11:00:00.000Z",
      evidenceRefs: ["ev-a"],
      expertFeedback: [{ feedbackId: "feedback-a", answer: "yes" }],
      followUpQuestion: "补充问题",
      query: "有摘要",
      summaryAnswer: "摘要答案",
      summaryError: "summary warning",
      summaryFallback: true,
      summaryModelAlias: "fallback-model",
    });
    expect(snapshot?.turnId).toMatch(/^turn-/);
  });

  it("appends turn snapshots, keeps the latest eight, and resets a run for continuation", () => {
    const run = makeRun("追问前", {
      agent: {
        ...createInitialInfoFeedAgentState(),
        error: "agent old",
        response: { answer: "agent evidence::agent-ref" },
      },
      completedAt: "2026-06-04T10:30:00.000Z",
      expertFeedback: [{ feedbackId: "feedback-old" }] as never,
      keyword: {
        ...createInitialInfoFeedKeywordState(),
        error: "keyword old",
        response: { items: [{ evidenceId: "keyword-ref" }] },
      },
      summary: {
        ...createInitialInfoFeedSummaryState(summaryDefaults),
        answer: "旧摘要 ev_summary_ref",
        error: "summary old",
        fallback: true,
      },
      turns: Array.from({ length: 8 }, (_, index) => ({
        attachments: [],
        completedAt: `2026-06-03T0${index}:00:00.000Z`,
        evidenceRefs: [],
        expertFeedback: [],
        followUpQuestion: "",
        query: `old-${index}`,
        summaryAnswer: `old answer ${index}`,
        summaryError: "",
        summaryFallback: false,
        summaryModelAlias: "old-model",
        turnId: `turn-old-${index}`,
      })),
    } as Partial<InfoFeedRunState>);
    const evidenceRefs = vi.fn(() => ["custom-ev"]);

    const snapshot = appendInfoFeedTurnSnapshotCore(run, {
      evidenceRefs,
      summaryModelAlias: "fallback-model",
    });

    expect(snapshot?.summaryAnswer).toBe("旧摘要 ev_summary_ref");
    expect(run.turns).toHaveLength(8);
    expect(run.turns[0].turnId).toBe("turn-old-1");
    expect(run.turns.at(-1)?.turnId).toMatch(/^turn-/);

    resetInfoFeedRunForContinuationCore(run, "新的追问", {
      attachments: [makeAttachment({ id: "attachment-new", name: "new.pdf" })],
      evidenceRefs,
      summaryDefaults: {
        ...summaryDefaults,
        modelAlias: "gpt-5.5",
      },
    });

    expect(run.followUp).toMatchObject({
      parentEvidenceRefs: ["keyword-ref", "evidence::agent-ref", "ev_summary_ref"],
      parentQuery: "追问前",
      question: "新的追问",
    });
    expect(run.completedAt).toBe("");
    expect(run.attachments).toMatchObject([{ id: "attachment-new", name: "new.pdf" }]);
    expect(run.clarification).toBeUndefined();
    expect(run.expertFeedback).toEqual([]);
    expect(run.keyword).toEqual(createInitialInfoFeedKeywordState());
    expect(run.agent).toEqual(createInitialInfoFeedAgentState());
    expect(run.summary).toMatchObject({
      answer: "",
      modelAlias: "gpt-5.5",
      status: "idle",
    });
    expect(run.pausedForModelSelection).toBe("");
    expect(run.pausedForRetry).toBe("");
    expect(run.retry).toBeUndefined();
  });
});
