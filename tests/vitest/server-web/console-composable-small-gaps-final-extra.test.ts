// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugDistillationRunner } from "../../../server-web/composables/console-debug-distillation-runner";
import { createConsoleInfoFeedHistoryController } from "../../../server-web/composables/console-info-feed-history-controller";
import { createConsoleInfoFeedTrackController } from "../../../server-web/composables/console-info-feed-track-controller";
import { createConsoleMaintenanceAgentController } from "../../../server-web/composables/console-maintenance-agent-controller";
import {
  analysisExecutionModeLabel,
  analysisModuleDescriptionForModule,
  backgroundProcessLabel,
  backgroundProcessTone,
  clientRuntimeCoolingLabel,
  clientRuntimeCoolingTone,
  clientRuntimeReasonLabel,
  clientRuntimeSurfaceText,
  clientRuntimeTaskText,
  maintenanceAgentStatusLabel,
  maintenanceAgentStatusTone,
  migrationProgress,
  migrationTone,
  monitorAlertSeverityLabel,
  monitorAlertSeverityTone,
  processRelationText,
  processTypeLabel,
  queueLifecycleLabel,
  queueLifecycleTone,
  queueMonitorDetail,
  queueSourceLabel,
} from "../../../server-web/composables/console-status-utils";
import { createInfoFeedRunState } from "../../../server-web/composables/console-info-feed-run-state-utils";
import type { AgentExploreRunResponse, KnowledgeSearchResponse, MaintenanceAgentRun } from "../../../server-web/lib/types";
import type { InfoFeedRunState } from "../../../server-web/types/app";

const searchMocks = vi.hoisted(() => ({
  searchKnowledge: vi.fn(),
  runKnowledgeAgentExplore: vi.fn(),
  getKnowledgeAgentExploreRun: vi.fn(),
}));

const jobMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
}));

const distillationMocks = vi.hoisted(() => ({
  createKnowledgeUploadSession: vi.fn(),
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRunArtifacts: vi.fn(),
  getSettings: vi.fn(),
  waitForConsoleDelay: vi.fn(async () => undefined),
}));

const maintenanceMocks = vi.hoisted(() => ({
  approveMaintenanceAgentRun: vi.fn(),
  cancelMaintenanceAgentRun: vi.fn(),
  chatMaintenanceAgent: vi.fn(),
  getMaintenanceAgentConfig: vi.fn(),
  listMaintenanceAgentRuns: vi.fn(),
  saveMaintenanceAgentConfig: vi.fn(),
  startMaintenanceAgentRun: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  searchKnowledge: searchMocks.searchKnowledge,
}));

vi.mock("../../../server-web/lib/agent-explore-client", () => ({
  getKnowledgeAgentExploreRun: searchMocks.getKnowledgeAgentExploreRun,
  runKnowledgeAgentExplore: searchMocks.runKnowledgeAgentExplore,
}));

vi.mock("../../../server-web/composables/console-info-feed-run-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/composables/console-info-feed-run-utils")>(
    "../../../server-web/composables/console-info-feed-run-utils",
  );
  return {
    ...actual,
    delayMs: vi.fn(() => Promise.resolve()),
    withInfoFeedFetchRetry: vi.fn(async (_run, _stage, operation) => operation()),
  };
});

vi.mock("../../../server-web/lib/jobs-client", () => ({
  createJob: jobMocks.createJob,
  getJob: jobMocks.getJob,
}));

vi.mock("../../../server-web/lib/knowledge-upload-session", () => ({
  createKnowledgeUploadSession: distillationMocks.createKnowledgeUploadSession,
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  getSettings: distillationMocks.getSettings,
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/lib/knowledge-distillation-workbench")>();
  return {
    ...actual,
    createKnowledgeDistillationWorkbenchRun: distillationMocks.createKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRun: distillationMocks.getKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRunArtifacts: distillationMocks.getKnowledgeDistillationWorkbenchRunArtifacts,
  };
});

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  waitForConsoleDelay: distillationMocks.waitForConsoleDelay,
}));

vi.mock("../../../server-web/lib/maintenance-agent-client", () => ({
  approveMaintenanceAgentRun: maintenanceMocks.approveMaintenanceAgentRun,
  cancelMaintenanceAgentRun: maintenanceMocks.cancelMaintenanceAgentRun,
  chatMaintenanceAgent: maintenanceMocks.chatMaintenanceAgent,
  getMaintenanceAgentConfig: maintenanceMocks.getMaintenanceAgentConfig,
  listMaintenanceAgentRuns: maintenanceMocks.listMaintenanceAgentRuns,
  saveMaintenanceAgentConfig: maintenanceMocks.saveMaintenanceAgentConfig,
  startMaintenanceAgentRun: maintenanceMocks.startMaintenanceAgentRun,
}));

function summaryDefaults() {
  return {
    modelAlias: "model-default",
    contextProfileId: "ctx-default",
    temperature: 0.2,
    maxTokens: 1800,
  };
}

function makeRun(overrides: Partial<InfoFeedRunState> = {}) {
  const run = createInfoFeedRunState(overrides.query || "问题", {
    attachments: [],
    summaryDefaults: summaryDefaults(),
  });
  return Object.assign(run, overrides);
}

function makeKeywordResponse(overrides: Partial<KnowledgeSearchResponse> = {}): KnowledgeSearchResponse {
  return {
    query: "source-query",
    items: [{ evidenceId: "ev-1", title: "结果一" }],
    explain: {
      candidateFileCount: 3,
      scannedFiles: 7,
      matchedUniqueFiles: 2,
      elapsedMs: 88,
    },
    ...overrides,
  };
}

function makeAgentResponse(
  status: "queued" | "running" | "completed" | "failed",
  overrides: Partial<AgentExploreRunResponse> = {},
): AgentExploreRunResponse {
  return {
    protocolVersion: "1",
    ok: status !== "failed",
    workspace: { workspaceId: "workspace-1" },
    run: {
      runId: "agent-run-1",
      workspaceId: "workspace-1",
      status,
      coverage: {
        answer: "Draft answer",
        evidenceRefs: ["ev-agent-1"],
      },
    },
    answer: "Draft answer",
    steps: [{ iteration: 1, phase: "answer_ready" }],
    ...overrides,
  };
}

function makeMaintenanceRun(id: string, status: MaintenanceAgentRun["status"], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: id,
    status,
    trigger: "manual",
    source: "user",
    intent: "inspection",
    summary: "inspection summary",
    risk: "safe_write",
    requiresApproval: false,
    approvalReason: "",
    planHash: "h1",
    plan: {
      schemaVersion: 1,
      source: "planner",
      intent: "intent",
      summary: "summary",
      risk: "safe_write",
      requiresApproval: false,
      approvalReason: "",
      steps: [],
    },
    steps: [],
    actor: null,
    input: {},
    createdAt: "2026-06-04T01:00:00.000Z",
    updatedAt: "2026-06-04T01:00:00.000Z",
    startedAt: "2026-06-04T01:01:00.000Z",
    completedAt: "2026-06-04T01:02:00.000Z",
    approvedAt: "",
    cancelRequested: false,
    error: "",
    ...overrides,
  } as MaintenanceAgentRun;
}

function makeConsoleState(overrides: Record<string, unknown> = {}) {
  return {
    server: { runtimeId: "runtime-01" },
    runtime: { mountModules: {}, info: "", pid: "123" },
    settings: {
      path: "/etc/settings",
      value: { schemaVersion: 1, openAiModel: "gpt" },
    },
    discovery: { path: "/etc/discovery", value: { items: [] }, bootstrap: { default: true } },
    emailRules: { path: "/etc/email-rules", rules: {} },
    expertVocabulary: { path: "/etc/vocab", vocabulary: {} },
    knowledgeTaxonomy: { schemaVersion: 1, topics: [] },
    storage: { summary: {} },
    jobs: {
      summary: {
        totalCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
      },
      items: [],
    },
    clients: {},
    maintenanceAgent: null,
    knowledgeConsole: { available: true, health: null, capabilities: null, maintenance: null, recentJobs: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("console-status-utils", () => {
  it("normalizes status labels, tones, and fallback text for empty data", () => {
    expect(queueLifecycleTone("RUNNING")).toBe("running");
    expect(queueLifecycleTone("standby")).toBe("queued");
    expect(queueLifecycleLabel("completed_with_errors")).toBe("有错误");
    expect(queueLifecycleLabel("")).toBe("未知");
    expect(queueSourceLabel("watchdog-reconcile")).toBe("守护进程补录");
    expect(queueSourceLabel("")).toBe("队列监控");
    expect(queueMonitorDetail({
      kind: "队列",
      interruptedReason: "",
      recoveryStatus: "",
      metadata: { stage: "导入" },
      checkpointTreeId: "tree-1",
    } as never)).toBe("阶段 导入 · checkpoint tree-1");

    expect(maintenanceAgentStatusTone("completed")).toBe("completed");
    expect(maintenanceAgentStatusTone("other")).toBe("failed");
    expect(maintenanceAgentStatusLabel("")).toBe("未知");

    expect(backgroundProcessTone("starting")).toBe("queued");
    expect(backgroundProcessTone("stale")).toBe("warning");
    expect(backgroundProcessLabel("missing")).toBe("缺失");
    expect(processTypeLabel("daemon")).toBe("守护进程");
    expect(processRelationText({ description: "fallback" } as never)).toBe("fallback");

    expect(clientRuntimeCoolingTone("hot")).toBe("running");
    expect(clientRuntimeCoolingLabel("missing")).toBe("missing");
    expect(clientRuntimeReasonLabel("outside-warm-client-limit")).toBe("超出保温上限");
    expect(clientRuntimeTaskText({ taskTypes: [] } as never)).toBe("无任务记录");
    expect(clientRuntimeSurfaceText({ surfaces: [] } as never)).toBe("无调用面记录");

    expect(monitorAlertSeverityTone("critical")).toBe("failed");
    expect(monitorAlertSeverityLabel("unknown")).toBe("unknown");

    expect(analysisExecutionModeLabel("HYBRID")).toBe("混合分析");
    expect(analysisExecutionModeLabel("custom")).toBe("custom");
    expect(analysisModuleDescriptionForModule(null)).toBe("未发现可用分析模块，将使用内置启发式分析。");
    expect(analysisModuleDescriptionForModule({ id: "custom" })).toBe("外置分析模块。");

    expect(migrationTone("offline" as never)).toBe("offline");
    expect(migrationProgress("bootstrap-only" as never)).toBe(12);
  });
});

describe("createDebugDistillationRunner", () => {
  function makeDistillationHarness(options: { modelReady?: boolean } = {}) {
    const distillationFile = ref<File | null>(null);
    const distillationStep = ref("idle");
    const distillationUploadPercent = ref(0);
    const distillationJob = ref<unknown>(null);
    const distillationRun = ref<unknown>(null);
    const distillationArtifactSizes = ref<Record<string, number>>({});
    const distillationError = ref("");
    const distillationStatusMessage = ref("");
    const distillationModelAlias = ref("model-a");
    distillationMocks.createKnowledgeUploadSession.mockResolvedValue({ session: { sessionId: "session-1" } });
    distillationMocks.getSettings.mockResolvedValue({ settings: { ok: true } });
    jobMocks.createJob.mockResolvedValue({ id: "job-1", status: "running", stage: "created" });
    jobMocks.getJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" });
    distillationMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValue({ runId: "run-1", status: "running" });
    distillationMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValue({
      runId: "run-1",
      status: "completed",
      stages: [{
        stageId: "knowledge-distillation",
        status: "completed",
        output: { markdown: "# Done\n", markdownLength: 7 },
      }],
    });
    distillationMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({ items: [] });

    const runner = createDebugDistillationRunner({
      distillationArtifactSizes,
      distillationError,
      distillationFile,
      distillationJob,
      distillationModelAlias,
      distillationModelReady: vi.fn(() => options.modelReady ?? true),
      distillationRun,
      distillationStatusMessage,
      distillationStep,
      distillationUploadPercent,
      selectedDistillationModel: vi.fn(() => ({ value: "model-a", label: "Model A", enabled: true })),
    });

    const file = new File(["hello"], "sample.md", { type: "text/markdown" });
    runner.handleDebugDistillationFileSelected([file]);

    return {
      distillationArtifactSizes,
      distillationError,
      distillationJob,
      distillationRun,
      distillationStatusMessage,
      distillationStep,
      distillationUploadPercent,
      file,
      runner,
    };
  }

  it("keeps empty submissions and unavailable models from starting the pipeline", async () => {
    const distillationFile = ref<File | null>(null);
    const distillationStep = ref("idle");
    const distillationUploadPercent = ref(17);
    const distillationJob = ref<unknown>(null);
    const distillationRun = ref<unknown>(null);
    const distillationArtifactSizes = ref<Record<string, number>>({ markdown: 1 });
    const distillationError = ref("旧错误");
    const distillationStatusMessage = ref("旧状态");
    const distillationModelAlias = ref("model-a");

    const runner = createDebugDistillationRunner({
      distillationArtifactSizes,
      distillationError,
      distillationFile,
      distillationJob,
      distillationModelAlias,
      distillationModelReady: vi.fn(() => false),
      distillationRun,
      distillationStatusMessage,
      distillationStep,
      distillationUploadPercent,
      selectedDistillationModel: vi.fn(() => ({ reason: "模型不可用" })),
    });

    runner.handleDebugDistillationFileSelected([]);
    expect(distillationFile.value).toBeNull();
    expect(distillationStep.value).toBe("idle");
    expect(distillationUploadPercent.value).toBe(0);
    expect(distillationJob.value).toBeNull();
    expect(distillationRun.value).toBeNull();
    expect(distillationArtifactSizes.value).toEqual({});
    expect(distillationError.value).toBe("");
    expect(distillationStatusMessage.value).toBe("等待文件");

    await runner.startDebugKnowledgeDistillation();
    expect(distillationError.value).toBe("请先选择文件。");
    expect(distillationMocks.createKnowledgeUploadSession).not.toHaveBeenCalled();

    const file = new File(["hello"], "sample.md", { type: "text/markdown" });
    runner.handleDebugDistillationFileSelected([file]);
    expect(distillationStatusMessage.value).toBe("文件已选择");
    await runner.startDebugKnowledgeDistillation();
    expect(distillationError.value).toBe("模型不可用");
    expect(distillationModelAlias.value).toBe("model-a");
    expect(distillationFile.value).toBe(file);
    expect(distillationStep.value).toBe("idle");
    expect(distillationUploadPercent.value).toBe(0);
    expect(distillationJob.value).toBeNull();
    expect(distillationRun.value).toBeNull();
    expect(distillationArtifactSizes.value).toEqual({});
  });

  it("surfaces parser and run validation failures", async () => {
    const missingJob = makeDistillationHarness();
    jobMocks.getJob.mockResolvedValueOnce(null);
    await missingJob.runner.startDebugKnowledgeDistillation();
    expect(missingJob.distillationStep.value).toBe("failed");
    expect(missingJob.distillationError.value).toBe("找不到解析任务。");

    const failedJob = makeDistillationHarness();
    jobMocks.getJob.mockResolvedValueOnce({ id: "job-1", status: "failed", error: "解析失败", stage: "parse" });
    await failedJob.runner.startDebugKnowledgeDistillation();
    expect(failedJob.distillationStep.value).toBe("failed");
    expect(failedJob.distillationError.value).toBe("解析失败");

    const missingRunId = makeDistillationHarness();
    distillationMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValueOnce({ status: "running", stages: [] });
    await missingRunId.runner.startDebugKnowledgeDistillation();
    expect(missingRunId.distillationStep.value).toBe("failed");
    expect(missingRunId.distillationError.value).toBe("知识蒸馏任务没有返回 runId。");
  });

  it("fails completed runs that do not include a generated markdown artifact", async () => {
    const harness = makeDistillationHarness();
    distillationMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValueOnce({
      runId: "run-1",
      status: "completed",
      stages: [{
        stageId: "knowledge-distillation",
        status: "completed",
        output: { markdown: "", markdownLength: 0 },
      }],
    });

    await harness.runner.startDebugKnowledgeDistillation();

    expect(harness.distillationStep.value).toBe("failed");
    expect(harness.distillationError.value).toBe("知识蒸馏已结束，但结果文档未生成。");
  });

  it("leaves stale cancellation state untouched when artifact refresh is interrupted", async () => {
    const harness = makeDistillationHarness();
    distillationMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockImplementationOnce(async () => {
      harness.runner.cancelDebugKnowledgeDistillation();
      throw new Error("artifact refresh failed");
    });

    await harness.runner.startDebugKnowledgeDistillation();

    expect(harness.distillationStep.value).toBe("distilling");
    expect(harness.distillationError.value).toBe("");
    expect(harness.distillationRun.value).toMatchObject({ runId: "run-1", status: "completed" });
  });
});

describe("console-info-feed-history-controller", () => {
  it("returns empty panels, ignores missing items, and surfaces attachment errors", async () => {
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
    const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(makeRun({ runId: "parent" }));
    const controller = createConsoleInfoFeedHistoryController({
      evidenceRefs: () => [],
      hasAgentModelOption: (value?: string) => value !== "removed",
      infoFeedAttachments,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedHistory,
      infoFeedParentRunSnapshot,
      storageKey: "history-controller-test",
      summaryDefaults,
      validAgentModelAlias: (value?: string) => value || "",
    });

    expect(controller.infoFeedHistoryPanelItems.value).toEqual([]);
    controller.selectInfoFeedHistoryItem("missing");
    expect(infoFeedCurrentRun.value).toBeNull();
    expect(infoFeedParentRunSnapshot.value?.runId).toBe("parent");

    const emptyFile = new File([""], "empty.txt", { type: "text/plain" });
    const unreadableFile = new File(["x"], "archive.bin", { type: "application/octet-stream" });
    const nulFile = new File(["hello\u0000world"], "broken.txt", { type: "text/plain" });
    const errorFile = new File(["oops"], "error.txt", { type: "text/plain" }) as File & { text: () => Promise<string> };
    Object.defineProperty(errorFile, "text", {
      configurable: true,
      value: () => Promise.reject(new Error("磁盘访问失败")),
    });

    await controller.handleInfoFeedAttachmentFiles([]);
    expect(infoFeedAttachments.value).toEqual([]);

    await controller.handleInfoFeedAttachmentFiles([emptyFile, unreadableFile, nulFile, errorFile]);
    expect(infoFeedAttachments.value).toHaveLength(4);
    expect(infoFeedAttachments.value[0].status).toBe("failed");
    expect(infoFeedAttachments.value[0].error).toBe("文件内容为空或疑似二进制内容。");
    expect(infoFeedAttachments.value[1].status).toBe("failed");
    expect(infoFeedAttachments.value[1].error).toBe("当前格式无法在页面侧直接读取。");
    expect(infoFeedAttachments.value[2].status).toBe("failed");
    expect(infoFeedAttachments.value[2].error).toBe("文件内容为空或疑似二进制内容。");
    expect(infoFeedAttachments.value[3].status).toBe("failed");
    expect(infoFeedAttachments.value[3].error).toBe("磁盘访问失败");
  });

  it("runs history helper branches for attachments, turns, storage, and model cleanup", () => {
    const attachment = {
      id: "attachment-1",
      name: "notes.md",
      size: 12,
      type: "text/markdown",
      status: "completed",
      progress: 100,
      text: "useful notes",
      error: "",
    } as InfoFeedRunState["attachments"][number];
    const infoFeedAttachments = ref([attachment]);
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(null);
    const infoFeedForm = ref({
      query: "initial",
      modelAlias: "removed",
      contextProfileId: "ctx-start",
      temperature: 0.2,
      maxTokens: 1800,
    });
    const infoFeedHistory = ref<InfoFeedRunState[]>([]);
    const infoFeedParentRunSnapshot = ref<InfoFeedRunState | null>(makeRun({ runId: "parent" }));
    const controller = createConsoleInfoFeedHistoryController({
      evidenceRefs: vi.fn(() => ["ev-1"]),
      hasAgentModelOption: (value?: string) => value !== "removed",
      infoFeedAttachments,
      infoFeedCurrentRun,
      infoFeedForm,
      infoFeedHistory,
      infoFeedParentRunSnapshot,
      storageKey: "history-controller-helpers-test",
      summaryDefaults,
      validAgentModelAlias: (value?: string) => (value === "removed" ? "" : value || ""),
    });

    expect(controller.snapshotInfoFeedAttachments()[0]).toMatchObject({ id: "attachment-1", text: "useful notes" });
    controller.removeInfoFeedAttachment("attachment-1");
    expect(infoFeedAttachments.value).toEqual([]);

    infoFeedAttachments.value = [attachment];
    const run = controller.createInfoFeedRun("Follow-up question", { parentRunId: "parent", question: "next" });
    run.runId = "run-helper";
    run.summary.answer = "Summary answer";
    run.summary.modelAlias = "removed";
    run.agent.response = {
      run: {
        input: {
          modelAlias: "model-default",
        },
      },
      answer: "Agent answer",
    } as never;
    expect(controller.initialInfoFeedKeywordState()).toMatchObject({ status: "idle", progress: 0 });
    expect(controller.initialInfoFeedAgentState()).toMatchObject({ status: "idle", runId: "" });
    expect(controller.initialInfoFeedSummaryState()).toMatchObject({ modelAlias: "model-default", contextProfileId: "ctx-default" });

    const snapshot = controller.snapshotInfoFeedTurn(run);
    expect(snapshot).toMatchObject({ query: "Follow-up question", evidenceRefs: ["ev-1"] });
    expect(controller.appendInfoFeedTurnSnapshot(run)).toMatchObject({ summaryAnswer: "Summary answer" });
    expect(run.turns).toHaveLength(1);

    controller.resetInfoFeedRunForContinuation(run, "next question");
    expect(run.followUp).toMatchObject({ parentRunId: "run-helper", question: "next question" });
    expect(run.summary.answer).toBe("");
    expect(run.keyword.status).toBe("idle");
    expect(run.attachments).toHaveLength(1);

    controller.upsertInfoFeedHistory(run);
    expect(infoFeedHistory.value).toHaveLength(1);
    infoFeedCurrentRun.value = run;
    infoFeedCurrentRun.value.summary.modelAlias = "removed";
    controller.clearInvalidInfoFeedModelReferences();
    expect(infoFeedCurrentRun.value?.summary.modelAlias).toBe("");

    controller.openInfoFeedHistoryRun({
      ...run,
      agent: {
        ...run.agent,
        response: {
          run: {
            input: {
              modelAlias: "model-default",
            },
          },
          answer: "Agent answer",
        } as never,
      },
      summary: {
        ...run.summary,
        modelAlias: "",
      },
    });
    expect(infoFeedParentRunSnapshot.value).toBeNull();
    expect(infoFeedForm.value.modelAlias).toBe("model-default");

    window.localStorage.setItem("history-controller-helpers-test", JSON.stringify({ version: 99, history: [run] }));
    controller.restoreInfoFeedHistory();
    expect(infoFeedHistory.value).toEqual([]);

    window.localStorage.setItem("history-controller-helpers-test", "{not valid json");
    controller.restoreInfoFeedHistory();
    expect(infoFeedHistory.value).toEqual([]);
  });
});

describe("console-info-feed-track-controller", () => {
  it("transfers action payloads and preserves stale-selection guards", async () => {
    const infoFeedCurrentRun = ref<InfoFeedRunState | null>(makeRun({ runId: "run-a", query: "问题A" }));
    const infoFeedRunSequence = ref(1);
    const keywordCache = new Map<string, { response: KnowledgeSearchResponse; cachedAt: number }>();
    const controller = createConsoleInfoFeedTrackController({
      agentExploreConfiguredLimit: ref(24),
      agentExploreConfiguredMaxIterations: ref(6),
      infoFeedAgentExpertGuidance: vi.fn(() => [{ feedbackId: "g-1" }]),
      infoFeedAgentProgressFromResult: vi.fn((result: AgentExploreRunResponse | null) => String(result?.run?.status || "") === "running" ? 71 : 100),
      infoFeedAgentRecentTurns: vi.fn(() => [{ role: "assistant", query: "上一轮" }]),
      infoFeedCurrentRun,
      infoFeedKeywordCache: keywordCache,
      infoFeedRunSequence,
      selectedInfoFeedContextProfile: ref({ value: "ctx-default" }),
      selectedInfoFeedModel: ref({ value: "model-default", enabled: true }),
      selectedThinkingMode: ref("balanced"),
    });

    searchMocks.searchKnowledge.mockResolvedValueOnce(makeKeywordResponse());
    await controller.runInfoFeedKeywordTrack(1, "run-a", " 原始检索问题 ");
    expect(searchMocks.searchKnowledge).toHaveBeenCalledWith({
      query: " 原始检索问题 ",
      limit: 12,
      retrievalMode: "raw-source-keyword",
      keywordOnly: true,
      rawSourceSearch: true,
      sourceSearch: true,
      returnAll: true,
      learningEnabled: false,
      explain: true,
    });
    expect(infoFeedCurrentRun.value?.keyword.status).toBe("completed");
    expect(infoFeedCurrentRun.value?.keyword.stage).toBe("候选 3 · 扫描 7 · 命中 2 · 88ms");

    const staleRun = makeRun({ runId: "run-stale", query: "旧问题" });
    infoFeedCurrentRun.value = staleRun;
    infoFeedRunSequence.value = 2;
    searchMocks.runKnowledgeAgentExplore.mockResolvedValueOnce(makeAgentResponse("queued"));
    searchMocks.getKnowledgeAgentExploreRun.mockResolvedValueOnce(makeAgentResponse("completed"));
    await controller.runInfoFeedAgentTrack(1, "run-a", "智能规划问题");
    expect(searchMocks.runKnowledgeAgentExplore).not.toHaveBeenCalled();

    infoFeedCurrentRun.value = makeRun({ runId: "run-b", query: "问题B" });
    searchMocks.runKnowledgeAgentExplore.mockRejectedValueOnce(new Error("模型 URL 未配置"));
    await controller.runInfoFeedAgentTrack(2, "run-b", "失败问题");
    expect(searchMocks.runKnowledgeAgentExplore).toHaveBeenCalledWith(expect.objectContaining({
      query: "失败问题",
      modelAlias: "model-default",
      contextProfileId: "ctx-default",
      thinkingMode: "balanced",
      maxIterations: 6,
      limit: 24,
      recentTurns: [{ role: "assistant", query: "上一轮" }],
      expertGuidance: [{ feedbackId: "g-1" }],
      async: true,
      realtime: true,
    }));
    expect(searchMocks.getKnowledgeAgentExploreRun).toHaveBeenCalledWith("agent-run-1", {
      workspaceId: "workspace-1",
    });
  });
});

describe("console-maintenance-agent-controller", () => {
  it("derives runbook/schedule labels and forwards action arguments", async () => {
    const consoleState = ref(makeConsoleState());
    const error = ref("");
    const controller = createConsoleMaintenanceAgentController({
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy: vi.fn(),
      consoleState,
      error,
      modelEntryStatusKey: vi.fn((entry: { uid?: string; alias?: string }) => entry.alias || entry.uid || ""),
      setBusy: vi.fn(),
      visibleModelEntries: computed(() => [
        { uid: "m-1", alias: "alias-1", label: "Alpha", agentName: "agent-alpha" },
      ] as never[]),
    });

    expect(controller.maintenanceAgentRunbooks.value).toEqual([]);
    expect(controller.maintenanceAgentRunbookOptionBarOptions.value).toEqual([]);
    expect(controller.maintenanceAgentSchedules.value).toEqual([]);
    expect(controller.nextMaintenanceAgentRunAt.value).toBe("");
    expect(controller.pendingMaintenanceApprovalCount.value).toBe(0);
    expect(controller.displayedMaintenanceAgentRuns.value).toEqual([]);
    expect(controller.latestMaintenanceAgentRun.value).toBeNull();

    expect(controller.applyMaintenanceAgentConfigFromEvent(null)).toBe(false);
    expect(controller.maintenanceAgentConfig.value).toBeNull();

    controller.patchMaintenanceAgentState({ latestRun: null });
    expect(consoleState.value?.maintenanceAgent).toBeNull();

    controller.maintenanceAgentMessage.value = "";
    await controller.chatMaintenanceAgent();
    expect(error.value).toBe("请输入维护指令。");

    const config = {
      schemaVersion: 1,
      enabled: true,
      plannerMode: "gateway",
      autoApproveRisk: "safe_write",
      scheduler: { tickSeconds: 60 },
      concurrency: { maxActiveRuns: 1 },
      schedules: [{ id: "s-1", label: "主计划", enabled: true, nextRunAt: "2026-06-04T01:00:00.000Z", runbook: "rb-1", intervalMinutes: 15 }],
      runbooks: {
        health_smoke: { id: "health_smoke", label: "健康巡检" },
        knowledge_maintenance_review: { id: "knowledge_maintenance_review", label: "知识复核巡检" },
      },
    };
    maintenanceMocks.getMaintenanceAgentConfig.mockResolvedValueOnce({ config });
    maintenanceMocks.listMaintenanceAgentRuns.mockResolvedValueOnce({
      items: [makeMaintenanceRun("run-1", "awaiting_approval"), makeMaintenanceRun("run-2", "completed")],
      activeRunId: "run-1",
      queuedRunIds: ["run-2"],
    });
    await controller.refreshMaintenanceAgent();
    expect(controller.maintenanceAgentRunbooks.value).toHaveLength(2);
    expect(controller.maintenanceAgentRunbookOptionBarOptions.value[0]).toEqual({
      value: "health_smoke",
      label: "健康巡检 / health_smoke",
    });
    expect(controller.nextMaintenanceAgentRunAt.value).toBe("2026-06-04T01:00:00.000Z");
    expect(controller.pendingMaintenanceApprovalCount.value).toBe(1);
    expect(controller.displayedMaintenanceAgentRuns.value[0].runId).toBe("run-1");
    expect(controller.latestMaintenanceAgentRun.value?.runId).toBe("run-1");

    maintenanceMocks.chatMaintenanceAgent.mockResolvedValueOnce({
      plan: makeMaintenanceRun("plan-1", "queued", { planHash: "plan-hash" }),
      run: makeMaintenanceRun("run-chat", "running"),
    });
    controller.maintenanceAgentMessage.value = "请执行巡检";
    controller.maintenanceAgentModelAlias.value = "alias-1";
    await controller.chatMaintenanceAgent();
    expect(maintenanceMocks.chatMaintenanceAgent).toHaveBeenCalledWith({
      message: "请执行巡检",
      modelAlias: "alias-1",
      agentName: "agent-alpha",
      wait: true,
    });

    maintenanceMocks.startMaintenanceAgentRun.mockResolvedValueOnce(makeMaintenanceRun("run-started", "running"));
    controller.maintenanceAgentRunbook.value = "knowledge_maintenance_review";
    await controller.runMaintenanceAgentKnowledgeMaintenance();
    expect(maintenanceMocks.startMaintenanceAgentRun).toHaveBeenCalledWith({
      runbook: "knowledge_maintenance_review",
      wait: true,
    });

    maintenanceMocks.approveMaintenanceAgentRun.mockResolvedValueOnce({
      run: makeMaintenanceRun("run-approved", "awaiting_approval"),
    });
    maintenanceMocks.cancelMaintenanceAgentRun.mockResolvedValueOnce({
      run: makeMaintenanceRun("run-cancel", "cancelled"),
    });
    await controller.approveMaintenanceAgentRun(makeMaintenanceRun("approve", "awaiting_approval"));
    await controller.cancelMaintenanceAgentRun(makeMaintenanceRun("cancel", "queued"));
    expect(maintenanceMocks.approveMaintenanceAgentRun).toHaveBeenCalledWith("approve", {
      planHash: "h1",
      wait: true,
    });
    expect(maintenanceMocks.cancelMaintenanceAgentRun).toHaveBeenCalledWith("cancel", { reason: "console" });
  });
});
