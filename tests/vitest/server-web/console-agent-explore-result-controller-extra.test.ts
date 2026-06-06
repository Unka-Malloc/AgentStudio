// @vitest-environment jsdom
import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConsoleAgentExploreResultController } from "../../../server-web/composables/console-agent-explore-result-controller";

function form(overrides = {}) {
  return ref({
    query: "fallback query",
    modelAlias: "",
    contextProfileId: "context-128k",
    thinkingMode: "default",
    temperature: 0.2,
    maxTokens: 1800,
    maxIterations: 4,
    limit: 8,
    toolChoice: "auto",
    workspaceId: "workspace-from-form",
    ...overrides,
  });
}

describe("console agent explore result controller extra coverage", () => {
  it("returns empty progress and fallback query/workspace before a run exists", () => {
    const agentExploreForm = form();
    const agentExploreResult = ref(null);
    const busyKey = ref("");
    const controller = createConsoleAgentExploreResultController({
      agentExploreForm,
      agentExploreResult,
      busyKey,
    });

    expect(controller.agentExploreSteps.value).toEqual([]);
    expect(controller.agentExploreWorkspaceId.value).toBe("workspace-from-form");
    expect(controller.agentExploreMaxIterations.value).toBe(4);
    expect(controller.agentExploreActiveIteration.value).toBe(0);
    expect(controller.agentExploreProgress.value).toEqual({ percent: 0, label: "未开始" });
    expect(controller.agentExploreProgressVisible.value).toBe(false);
    expect(controller.currentAgentExploreQuery()).toBe("fallback query");

    busyKey.value = "knowledge:agent-explore";
    expect(controller.agentExploreProgress.value).toEqual({ percent: 4, label: "准备检索" });
    expect(controller.agentExploreProgressVisible.value).toBe(true);
  });

  it("derives running progress, active iteration, step open state, workspace, and query from run input", () => {
    const agentExploreResult = ref({
      answer: "Answer mentions ev_2 and [ev_3].",
      evidenceRefs: ["ev_1"],
      workspace: { workspaceId: "workspace-from-result" },
      contextPack: { contextBuildRecordId: "context-record-1" },
      run: {
        status: "running",
        input: { query: "run query", maxIterations: 6 },
        coverage: { activeIteration: 2, activePhase: "tool_calling" },
      },
      steps: [
        { iteration: 1, phase: "model_calling" },
        { iteration: 2, phase: "tool_calling" },
      ],
    });
    const controller = createConsoleAgentExploreResultController({
      agentExploreForm: form(),
      agentExploreResult,
      busyKey: ref(""),
    });

    expect(controller.agentExploreWorkspaceId.value).toBe("workspace-from-result");
    expect(controller.currentAgentExploreQuery()).toBe("run query");
    expect(controller.agentExploreMaxIterations.value).toBe(6);
    expect(controller.agentExploreActiveIteration.value).toBe(2);
    expect(controller.agentExploreProgress.value).toEqual({
      percent: 28,
      label: "第 2 / 6 轮 · 调用工具",
    });
    expect(controller.agentExploreProgressVisible.value).toBe(true);
    expect(controller.agentExploreStepOpen({ iteration: 2 })).toBe(true);
    expect(controller.agentExploreStepOpen({ iteration: 1 })).toBe(false);
    expect(controller.agentExploreContextBuildRecordId()).toBe("context-record-1");
    expect(controller.agentExploreLinkedEvidenceRefs.value).toEqual(["ev_1", "ev_2", "ev_3"]);
    expect(controller.agentExploreAnswerHtml.value).toContain("ev_2");
  });

  it("falls back to the last step iteration and clamps failed or completed progress", () => {
    const agentExploreResult = ref({
      answer: "",
      run: {
        status: "failed",
        input: { maxIterations: 3 },
        coverage: {},
      },
      steps: [
        { iteration: 5, phase: "answer_ready" },
      ],
    });
    const controller = createConsoleAgentExploreResultController({
      agentExploreForm: form({ maxIterations: 3 }),
      agentExploreResult,
      busyKey: ref(""),
    });

    expect(controller.agentExploreActiveIteration.value).toBe(3);
    expect(controller.agentExploreProgress.value).toEqual({
      percent: 79,
      label: "第 3 / 3 轮 · 生成答案",
    });
    expect(controller.agentExploreProgressVisible.value).toBe(false);

    agentExploreResult.value = {
      run: { status: "completed", input: { maxIterations: 2 }, coverage: {} },
      steps: [],
      answer: "",
    };
    expect(controller.agentExploreProgress.value).toEqual({
      percent: 100,
      label: "已完成 2 轮上限",
    });
    expect(controller.agentExploreProgressVisible.value).toBe(false);
  });

  it("formats event time and returns empty context record ids for missing context packs", () => {
    const controller = createConsoleAgentExploreResultController({
      agentExploreForm: form(),
      agentExploreResult: ref({
        answer: "",
        run: { status: "running", input: {}, coverage: {} },
        steps: [],
      }),
      busyKey: ref(""),
    });

    expect(controller.agentExploreEventTime({ createdAt: "2026-06-04T10:11:00.000Z" })).toMatch(/06\/04|06-04|04/);
    expect(controller.agentExploreEventTime({})).toBe("未记录");
    expect(controller.agentExploreContextBuildRecordId()).toBe("");
  });
});
