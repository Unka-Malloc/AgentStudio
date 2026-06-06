import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createConsoleInfoFeedExpertFeedbackController } from "../../../server-web/composables/console-info-feed-expert-feedback-controller";
import {
  createConsoleIntervalController,
  createConsoleTimeoutController,
  waitForConsoleDelay,
} from "../../../server-web/composables/console-timer-controller";

const recordKnowledgeFeedbackMock = vi.hoisted(() => vi.fn());
const browserWindowMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  recordKnowledgeFeedback: recordKnowledgeFeedbackMock
}));

vi.mock("../../../server-web/lib/browser-window", () => ({
  browserWindow: browserWindowMock
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("console small composables local extra coverage", () => {
  it("syncs expert feedback success and failure with evidence context", async () => {
    const upsertInfoFeedHistory = vi.fn();
    const infoFeedRunEvidenceRefs = vi.fn(() => ["evidence-1", "evidence-2"]);
    const controller = createConsoleInfoFeedExpertFeedbackController({
      infoFeedRunEvidenceRefs,
      upsertInfoFeedHistory
    });
    const run = {
      runId: "run-1",
      query: "query",
      keyword: { response: { items: [{ id: "hit-1" }] } },
      agent: { runId: "agent-run-1" },
      summary: { modelAlias: "agent-a", status: "completed" }
    } as any;
    const feedback = {
      feedbackId: "feedback-1",
      createdAt: "2026-06-05T00:00:00.000Z",
      sourceQuery: "",
      questionId: "question-1",
      anchor: "anchor",
      prompt: "prompt",
      reason: "reason",
      selectedOptionId: "option-1",
      selectedLabel: "Label",
      selectedDescription: "Description",
      followUpQuestion: "Follow up"
    } as any;

    await controller.syncInfoFeedExpertFeedback(run, feedback);
    expect(recordKnowledgeFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({
      feedbackId: "feedback-1",
      evidenceId: "evidence-1",
      query: "query",
      context: expect.objectContaining({
        runId: "run-1",
        keywordCount: 1,
        evidenceRefs: ["evidence-1", "evidence-2"]
      })
    }));
    expect(feedback.syncStatus).toBe("synced");
    expect(upsertInfoFeedHistory).toHaveBeenCalledWith(run);

    recordKnowledgeFeedbackMock.mockRejectedValueOnce(new Error("network down"));
    const failed = { ...feedback, feedbackId: "feedback-2", syncStatus: "" } as any;
    await controller.syncInfoFeedExpertFeedback(run, failed);
    expect(failed.syncStatus).toBe("failed");
    expect(failed.syncError).toBe("network down");
  });

  it("starts, stops, and falls back for interval and timeout controllers", async () => {
    vi.useFakeTimers();
    const clearInterval = vi.fn();
    const clearTimeout = vi.fn();
    const setInterval = vi.fn(() => 101);
    const setTimeout = vi.fn((callback) => {
      globalThis.setTimeout(callback, 0);
      return 202;
    });
    browserWindowMock.mockReturnValue({ clearInterval, clearTimeout, setInterval, setTimeout });

    const interval = createConsoleIntervalController({ timer: ref<number | null>(7) });
    const callback = vi.fn();
    expect(interval.start(callback, -5)).toBe(101);
    expect(clearInterval).toHaveBeenCalledWith(7);
    expect(setInterval).toHaveBeenCalledWith(callback, 0);
    interval.stop();
    expect(clearInterval).toHaveBeenCalledWith(101);
    expect(interval.current()).toBeNull();

    const timeout = createConsoleTimeoutController({ timer: ref<number | null>(8) });
    const timeoutCallback = vi.fn();
    expect(timeout.schedule(timeoutCallback, -1)).toBe(202);
    expect(clearTimeout).toHaveBeenCalledWith(8);
    await vi.runAllTimersAsync();
    expect(timeoutCallback).toHaveBeenCalledTimes(1);
    expect(timeout.current()).toBeNull();

    browserWindowMock.mockReturnValue(null);
    expect(createConsoleIntervalController().start(vi.fn(), 1)).toBeNull();
    expect(createConsoleTimeoutController().schedule(vi.fn(), 1)).toBeNull();
    await expect(waitForConsoleDelay(1)).resolves.toBeUndefined();
  });
});
