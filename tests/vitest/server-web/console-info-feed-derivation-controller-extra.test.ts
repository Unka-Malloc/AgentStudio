// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createConsoleInfoFeedDerivationController } from "../../../server-web/composables/console-info-feed-derivation-controller";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type {
  InfoFeedClarification,
  InfoFeedClarificationOption,
  InfoFeedRunState,
} from "../../../server-web/types/app";

function summaryDefaults() {
  return {
    modelAlias: "summary-agent",
    contextProfileId: "tiny-profile",
    temperature: 0.2,
    maxTokens: 1200,
  };
}

function createController() {
  return createConsoleInfoFeedDerivationController({
    contextProfileRows: ref([
      {
        profileId: "tiny-profile",
        contextWindowTokens: 1000,
        knowledgeBudget: 100,
      },
      {
        profileId: "large-profile",
        contextWindowTokens: 128000,
        knowledgeBudget: 0,
      },
    ]),
    fallbackProfileId: () => "large-profile",
  });
}

function createRun(): InfoFeedRunState {
  const run = createInfoFeedRunState("What changed in the renewal emails?", {
    attachments: [
      {
        id: "attachment-1",
        name: "renewal.txt",
        size: 2048,
        type: "text/plain",
        status: "completed",
        progress: 100,
        text: "Attachment excerpt with source context.",
        error: "",
      },
    ],
    summaryDefaults: summaryDefaults(),
  });
  run.summary.contextProfileId = "tiny-profile";
  run.keyword.response = {
    items: [
      {
        title: "High relevance source",
        evidenceId: "ev_high",
        score: 0.91,
        snippet: "Direct renewal evidence.",
      },
      {
        title: "Low relevance source",
        evidenceId: "ev_low",
        score: 0.2,
        snippet: "Background noise.",
        relevanceTier: "low",
      },
    ],
  } as never;
  run.agent.response = {
    run: { status: "running" },
    steps: [{ iteration: 2, phase: "tool_result" }],
    answer: "Agent answer keeps evidence::ev_agent.",
  } as never;
  run.summary.answer = "Existing summary evidence::ev_summary";
  run.followUp = {
    parentRunId: "run-parent",
    parentQuery: "Original renewal question",
    question: "Focus on price deltas",
    parentSummary: "Parent summary.",
    parentEvidenceRefs: ["ev_parent"],
  };
  run.turns = [
    {
      turnId: "turn-1",
      query: "Original renewal question",
      followUpQuestion: "",
      attachments: [],
      completedAt: "2026-06-04T00:00:00.000Z",
      summaryAnswer: "Prior answer with evidence::ev_prior",
      summaryError: "",
      summaryFallback: false,
      summaryModelAlias: "summary-agent",
      evidenceRefs: ["ev_prior"],
      expertFeedback: [
        {
          feedbackId: "feedback-prior",
          questionId: "question-prior",
          anchor: "report",
          prompt: "Prior prompt",
          reason: "Prior reason",
          selectedOptionId: "prior-option",
          selectedLabel: "Prior choice",
          selectedDescription: "Prior description",
          followUpQuestion: "Prefer direct evidence.",
          sourceQuery: "Original renewal question",
          createdAt: "2026-06-04T00:00:00.000Z",
          syncedAt: "",
          syncStatus: "pending",
          syncError: "",
        },
      ],
    },
  ];
  return run;
}

describe("console info feed derivation controller extra coverage", () => {
  it("delegates source context, search, agent, summary, and evidence derivations", () => {
    const controller = createController();
    const run = createRun();
    const lowItem = (run.keyword.response?.items || [])[1] as never;

    expect(controller.isLowRelevanceSourceResult(lowItem)).toBe(true);
    expect(controller.infoFeedSourceResultLine((run.keyword.response?.items || [])[0] as never, 0))
      .toContain("ev_high");
    expect(controller.estimateInfoFeedContextTokens(0)).toBe(0);
    expect(controller.infoFeedSourceContextBudgetChars(run)).toBe(4000);
    expect(controller.infoFeedSourceContextBudgetChars(null)).toBeGreaterThan(100000);

    const context = controller.buildInfoFeedSourceContext(run);
    expect(context.text).toContain("High relevance source");
    expect(context.text).toContain("Low relevance source");
    expect(context.report.highCount).toBe(1);
    expect(context.report.lowCount).toBe(1);

    expect(controller.buildInfoFeedSourceSearchQuery(run)).toContain("Focus on price deltas");
    expect(controller.buildInfoFeedAgentQuery(run)).toContain("Parent summary.");
    expect(controller.infoFeedAgentRecentTurns(run)).toMatchObject([
      { role: "assistant", evidenceRefs: ["ev_prior"] },
      { role: "user", query: "Focus on price deltas" },
    ]);
    expect(controller.infoFeedAgentExpertGuidance(run)).toMatchObject([
      {
        feedbackId: "feedback-prior",
        label: "Prior choice",
        instruction: "Prefer direct evidence.",
      },
    ]);

    const summary = controller.infoFeedSourceSummary(run);
    expect(summary).toContain("renewal.txt");
    expect(summary).toContain("Agent answer keeps evidence::ev_agent.");
    expect(controller.buildInfoFeedSummaryQuestion(run)).toContain("Focus on price deltas");
    expect(controller.fallbackInfoFeedSummary(run)).toContain("High relevance source");
    expect(controller.infoFeedRunEvidenceRefs(run)).toEqual([
      "ev_high",
      "ev_low",
      "evidence::ev_agent",
      "evidence::ev_summary",
    ]);
  });

  it("delegates clarification extraction, fallback prompts, answer application, and feedback archiving", () => {
    const controller = createController();
    const run = createRun();
    const answer = [
      "Final answer before choices.",
      "```pact_user_options",
      JSON.stringify({
        questionId: "question-1",
        prompt: "Choose next step",
        reason: "Evidence is incomplete",
        anchor: "summary",
        options: [
          {
            id: "option-a",
            title: "Continue search",
            reason: "Find direct proof",
            query: "Search again for direct proof.",
          },
          {
            label: "",
            followUpQuestion: "",
          },
        ],
      }),
      "```",
    ].join("\n");

    expect(controller.normalizeInfoFeedClarificationOption({ label: "", value: "" }, 0)).toBeNull();
    expect(controller.normalizeInfoFeedClarificationOption({ label: "Use current evidence" }, 1)).toMatchObject({
      optionId: "option-2",
      label: "Use current evidence",
      followUpQuestion: "Use current evidence",
    });

    const extracted = controller.extractInfoFeedClarification(answer);
    expect(extracted.answer).toBe("Final answer before choices.");
    expect(extracted.clarification).toMatchObject({
      questionId: "question-1",
      prompt: "Choose next step",
      reason: "Evidence is incomplete",
      anchor: "summary",
      options: [{ optionId: "option-a" }],
    });

    expect(controller.buildFallbackInfoFeedClarification(run)).toBeUndefined();
    run.summary.fallback = true;
    run.summary.error = "Model unavailable";
    expect(controller.buildFallbackInfoFeedClarification(run)?.options.map((option) => option.optionId))
      .toEqual(["more-evidence", "strict-only", "change-angle"]);

    controller.applyInfoFeedSummaryAnswer(run, answer, false, "");
    expect(run.summary.answer).toBe("Final answer before choices.");
    expect(run.clarification?.questionId).toBe("question-1");

    const clarification = run.clarification as InfoFeedClarification;
    const selected = clarification.options[0] as InfoFeedClarificationOption;
    const archived = controller.archiveInfoFeedExpertFeedback(run, clarification, selected);
    expect(archived).toMatchObject({
      questionId: "question-1",
      selectedOptionId: "option-a",
      selectedLabel: "Continue search",
      sourceQuery: "Focus on price deltas",
      syncStatus: "pending",
    });

    controller.archiveInfoFeedExpertFeedback(run, clarification, selected);
    expect(run.expertFeedback.filter((item) => item.feedbackId === archived.feedbackId)).toHaveLength(1);
  });

  it("delegates agent progress derivation for completed, failed, and active runs", () => {
    const controller = createController();

    expect(controller.infoFeedAgentProgressFromResult({ run: { status: "completed" } } as never, 4)).toBe(100);
    expect(controller.infoFeedAgentProgressFromResult({ run: { status: "failed" } } as never, 4)).toBe(100);
    expect(controller.infoFeedAgentProgressFromResult({
      run: { status: "running" },
      steps: [{ iteration: 2, phase: "tool_result" }],
    } as never, 4)).toBeGreaterThan(40);
  });
});
