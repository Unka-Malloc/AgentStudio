import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleContextCompilerController } from "../../../server-web/composables/console-context-compiler-controller";

const clientMock = vi.hoisted(() => ({
  getContextProfiles: vi.fn(),
  listContextBuildRecords: vi.fn(),
  previewContextPack: vi.fn(),
  runContextEvaluation: vi.fn(),
}));

const browserEffectsMock = vi.hoisted(() => ({
  downloadTextFile: vi.fn(),
}));

vi.mock("../../../server-web/lib/context-compiler-client", () => ({
  getContextProfiles: clientMock.getContextProfiles,
  listContextBuildRecords: clientMock.listContextBuildRecords,
  previewContextPack: clientMock.previewContextPack,
  runContextEvaluation: clientMock.runContextEvaluation,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  downloadTextFile: browserEffectsMock.downloadTextFile,
}));

function makeFixture() {
  const error = ref("seed");
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();
  const controller = createConsoleContextCompilerController({
    clearAllBusy,
    error,
    recentTurns: () => [
      { role: "user", text: "最近部署风险？" },
      { role: "assistant", text: "需要证据。" },
    ],
    selectedContextProfileId: () => "balanced",
    setBusy,
  });

  return {
    clearAllBusy,
    controller,
    error,
    setBusy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.getContextProfiles.mockResolvedValue({
    profiles: [
      {
        profileId: "balanced",
        label: "Balanced",
        contextWindowTokens: 128000,
        compression: { mode: "hybrid", strategy: "evidence-first" },
        knowledgeBudget: 20000,
        historyBudget: 8000,
        recentTurnBudget: 4000,
        budgetPolicy: { expertGuidanceRatio: 0.2 },
        protectedEvidenceFields: ["evidenceId", 42],
        modelCompression: { enabled: true, alias: "compact-model" },
      },
    ],
  });
  clientMock.listContextBuildRecords.mockResolvedValue({
    records: [
      {
        recordId: "record-1",
        createdAt: "2026-06-04T00:00:00.000Z",
        profileId: "balanced",
        totalTokens: 1234,
        sourceTokens: 900,
        triggerReason: "preview",
        compressionMode: "hybrid",
        preservedEvidenceIds: ["ev-1", 2],
        droppedKnowledgeCount: 3,
        humanExpertGuidanceCount: 1,
      },
    ],
  });
  clientMock.previewContextPack.mockResolvedValue({ ok: true, preview: "context pack" });
  clientMock.runContextEvaluation.mockResolvedValue({ ok: true, runId: "eval-1" });
});

describe("console context compiler controller extra coverage", () => {
  it("refreshes profiles and build records, deriving normalized table rows", async () => {
    const { clearAllBusy, controller, error, setBusy } = makeFixture();

    await controller.refreshContextCompiler();

    expect(setBusy).toHaveBeenCalledWith("context:refresh");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(error.value).toBe("seed");
    expect(clientMock.getContextProfiles).toHaveBeenCalledTimes(1);
    expect(clientMock.listContextBuildRecords).toHaveBeenCalledWith(20);
    expect(controller.contextProfileRows.value).toEqual([
      {
        profileId: "balanced",
        label: "Balanced",
        contextWindowTokens: 128000,
        compressionMode: "hybrid",
        strategy: "evidence-first",
        knowledgeBudget: 20000,
        historyBudget: 8000,
        recentTurnBudget: 4000,
        expertGuidanceRatio: 0.2,
        protectedEvidenceFields: ["evidenceId", "42"],
        modelCompressionAlias: "compact-model",
        modelCompressionEnabled: true,
      },
    ]);
    expect(controller.contextBuildRecordRows.value).toEqual([
      {
        recordId: "record-1",
        createdAt: "2026-06-04T00:00:00.000Z",
        profileId: "balanced",
        totalTokens: 1234,
        sourceTokens: 900,
        triggerReason: "preview",
        compressionMode: "hybrid",
        preservedEvidenceIds: ["ev-1", "2"],
        droppedKnowledgeCount: 3,
        humanExpertGuidanceCount: 1,
      },
    ]);
  });

  it("keeps silent refresh failures out of the visible error state", async () => {
    const { clearAllBusy, controller, error, setBusy } = makeFixture();
    clientMock.getContextProfiles.mockRejectedValueOnce(new Error("profiles failed"));

    await controller.refreshContextCompiler({ silent: true });

    expect(setBusy).not.toHaveBeenCalled();
    expect(clearAllBusy).not.toHaveBeenCalled();
    expect(error.value).toBe("seed");
  });

  it("builds preview payloads with parsed evidence ids and submits preview requests", async () => {
    const { clearAllBusy, controller, error, setBusy } = makeFixture();
    controller.contextPreviewTask.value = "  inspect invoice risk  ";
    controller.contextPreviewRequiredEvidence.value = "ev-1, ev-2，ev-3\n ev-4";

    const payload = controller.contextPreviewPayload();

    expect(payload).toMatchObject({
      contextProfileId: "balanced",
      inputSource: "server-console-context-preview",
      taskBrief: "  inspect invoice risk  ",
      expertGuidance: [
        expect.objectContaining({
          evidenceRefs: ["ev-1", "ev-2", "ev-3", "ev-4"],
        }),
      ],
      retrievedEvidence: [
        expect.objectContaining({ evidenceId: "ev-1", sourceLocator: "preview/ev-1" }),
        expect.objectContaining({ evidenceId: "ev-2", sourceLocator: "preview/ev-2" }),
        expect.objectContaining({ evidenceId: "ev-3", sourceLocator: "preview/ev-3" }),
        expect.objectContaining({ evidenceId: "ev-4", sourceLocator: "preview/ev-4" }),
      ],
      recentTurns: [
        { role: "user", text: "最近部署风险？" },
        { role: "assistant", text: "需要证据。" },
      ],
    });

    await controller.previewContextCompiler();

    expect(setBusy).toHaveBeenCalledWith("context:preview");
    expect(clientMock.previewContextPack).toHaveBeenCalledWith(expect.objectContaining({
      contextProfileId: "balanced",
      retrievedEvidence: expect.arrayContaining([
        expect.objectContaining({ evidenceId: "ev-4" }),
      ]),
    }));
    expect(clientMock.getContextProfiles).toHaveBeenCalledTimes(1);
    expect(clientMock.listContextBuildRecords).toHaveBeenCalledWith(20);
    expect(controller.contextPreviewResult.value).toEqual({ ok: true, preview: "context pack" });
    expect(error.value).toBe("");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("runs replay evaluation and reports failures with fallback messages", async () => {
    const { clearAllBusy, controller, error, setBusy } = makeFixture();
    controller.contextPreviewRequiredEvidence.value = "";

    await controller.runContextReplayEvaluation();

    expect(setBusy).toHaveBeenCalledWith("context:evaluation");
    expect(clientMock.runContextEvaluation).toHaveBeenCalledWith({
      profiles: ["balanced"],
      cases: [
        expect.objectContaining({
          caseId: expect.stringMatching(/^console-preview-/),
          requiredEvidenceIds: ["preview-evidence-1"],
          contextProfileId: "balanced",
        }),
      ],
    });
    expect(controller.contextEvaluationResult.value).toEqual({ ok: true, runId: "eval-1" });
    expect(error.value).toBe("");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);

    clientMock.runContextEvaluation.mockRejectedValueOnce("bad evaluation");
    await controller.runContextReplayEvaluation();
    expect(error.value).toBe("上下文 replay 评估失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(2);
  });

  it("exports build records as a JSON download", () => {
    const { controller } = makeFixture();
    controller.contextBuildRecordsResponse.value = {
      records: [{ recordId: "record-1" }],
    };

    controller.exportContextBuildRecords();

    expect(browserEffectsMock.downloadTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^context-build-records-.+\.json$/),
      `${JSON.stringify({ records: [{ recordId: "record-1" }] }, null, 2)}\n`,
      "application/json;charset=utf-8",
    );
  });
});
