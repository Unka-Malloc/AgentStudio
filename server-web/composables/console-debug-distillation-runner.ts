import type { Ref } from "vue";
import { getSettings } from "../lib/agent-settings-client";
import { createJob, getJob } from "../lib/jobs-client";
import {
  createKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts,
} from "../lib/knowledge-distillation-workbench";
import { createKnowledgeUploadSession } from "../lib/knowledge-upload-session";
import type { SplitJob } from "../lib/types";
import {
  defaultDistillationPrompt,
  distillationMarkdownLength,
  distillationParseTimeoutMs,
  DISTILLATION_PAYLOAD_BUDGET,
  DISTILLATION_RAW_BATCH_MODEL_MAX_CHARACTERS,
  DISTILLATION_RAW_BATCH_RETRY_MODEL_MAX_CHARACTERS,
  DISTILLATION_RAW_CORPUS_BATCH_MAX_CHARACTERS,
  DISTILLATION_RUN_POLL_INTERVAL_MS,
  DISTILLATION_RUN_TIMEOUT_MS,
  DISTILLATION_TOKEN_BUDGET,
  DISTILLATION_PARSE_POLL_INTERVAL_MS,
  extractDistillationArtifactSizes,
  findDistillationCoreStage,
  formatDurationLabel,
  getDistillationCoreOutput,
  type DebugDistillationModelOption,
  type DistillationRun,
  type DistillationStep,
} from "./console-debug-distillation-utils";
import { waitForConsoleDelay } from "./console-timer-controller";

type DebugDistillationRunnerOptions = {
  distillationFile: Ref<File | null>;
  distillationStep: Ref<DistillationStep>;
  distillationUploadPercent: Ref<number>;
  distillationJob: Ref<SplitJob | null>;
  distillationRun: Ref<DistillationRun | null>;
  distillationArtifactSizes: Ref<Record<string, number>>;
  distillationError: Ref<string>;
  distillationStatusMessage: Ref<string>;
  distillationModelAlias: Ref<string>;
  distillationModelReady: () => boolean;
  selectedDistillationModel: () => DebugDistillationModelOption | null;
};

export function createDebugDistillationRunner(options: DebugDistillationRunnerOptions) {
  let distillationSequence = 0;

  function assertCurrentDistillation(sequence: number) {
    if (sequence !== distillationSequence) {
      throw new Error("知识蒸馏任务已取消。");
    }
  }

  function resetDistillationProgress(statusMessage: string) {
    options.distillationStep.value = "idle";
    options.distillationUploadPercent.value = 0;
    options.distillationJob.value = null;
    options.distillationRun.value = null;
    options.distillationArtifactSizes.value = {};
    options.distillationError.value = "";
    options.distillationStatusMessage.value = statusMessage;
  }

  function handleDebugDistillationFileSelected(files: File[]) {
    distillationSequence += 1;
    options.distillationFile.value = files[0] || null;
    resetDistillationProgress(options.distillationFile.value ? "文件已选择" : "等待文件");
  }

  function cancelDebugKnowledgeDistillation() {
    distillationSequence += 1;
  }

  async function refreshDistillationArtifactSizes(runId: string, sequence: number) {
    if (!runId) {
      options.distillationArtifactSizes.value = {};
      return;
    }
    try {
      const artifacts = await getKnowledgeDistillationWorkbenchRunArtifacts(runId);
      assertCurrentDistillation(sequence);
      options.distillationArtifactSizes.value = extractDistillationArtifactSizes(artifacts);
    } catch (nextError) {
      if (sequence !== distillationSequence) {
        throw nextError;
      }
      options.distillationArtifactSizes.value = {};
    }
  }

  async function waitForDistillationJob(jobId: string, file: File, sequence: number) {
    const timeoutMs = distillationParseTimeoutMs(file);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertCurrentDistillation(sequence);
      const job = await getJob(jobId);
      if (!job) {
        throw new Error("找不到解析任务。");
      }
      options.distillationJob.value = job;
      options.distillationStatusMessage.value = `文件解析：${job.stage || job.status}（上限 ${formatDurationLabel(timeoutMs)}）`;
      if (job.status === "completed") return job;
      if (job.status === "failed") {
        throw new Error(job.error || "文件解析失败。");
      }
      await waitForConsoleDelay(DISTILLATION_PARSE_POLL_INTERVAL_MS);
    }
    throw new Error(`文件解析超时（已等待 ${formatDurationLabel(timeoutMs)}）。任务可能仍在后台运行，可稍后查看任务状态。`);
  }

  async function waitForDistillationRun(runId: string, sequence: number) {
    const deadline = Date.now() + DISTILLATION_RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      assertCurrentDistillation(sequence);
      const run = await getKnowledgeDistillationWorkbenchRun(runId);
      options.distillationRun.value = run;
      options.distillationStatusMessage.value = `知识蒸馏：${String(run.status || "running")}（上限 ${formatDurationLabel(DISTILLATION_RUN_TIMEOUT_MS)}）`;
      const status = String(run.status || "");
      if (status === "completed") {
        const coreStage = findDistillationCoreStage(run);
        const output = getDistillationCoreOutput(coreStage);
        const markdownLength = distillationMarkdownLength(output, String(output.markdown || ""));
        if (coreStage?.status !== "completed" || markdownLength <= 0) {
          throw new Error("知识蒸馏已结束，但结果文档未生成。");
        }
        return run;
      }
      if (status === "failed" || status === "canceled") {
        throw new Error(run.error || "知识蒸馏失败。");
      }
      await waitForConsoleDelay(DISTILLATION_RUN_POLL_INTERVAL_MS);
    }
    throw new Error(`知识蒸馏超时（已等待 ${formatDurationLabel(DISTILLATION_RUN_TIMEOUT_MS)}）。`);
  }

  async function startDebugKnowledgeDistillation() {
    const file = options.distillationFile.value;
    if (!file) {
      options.distillationError.value = "请先选择文件。";
      return;
    }
    if (!options.distillationModelReady()) {
      const selectedModel = options.selectedDistillationModel();
      options.distillationError.value =
        String(selectedModel?.reason || selectedModel?.disabledReason || "").trim() ||
        "请选择一个可用模型。";
      return;
    }
    const sequence = ++distillationSequence;
    options.distillationStep.value = "uploading";
    options.distillationUploadPercent.value = 0;
    options.distillationJob.value = null;
    options.distillationRun.value = null;
    options.distillationArtifactSizes.value = {};
    options.distillationError.value = "";
    options.distillationStatusMessage.value = "上传文件";
    try {
      const [{ session }, settings] = await Promise.all([
        createKnowledgeUploadSession([file], {
          checkpointPrefix: "knowledge-distillation-debug",
          checkpointMode: "debug-panel",
          checkpointSource: "knowledge-distillation-debug",
          onProgress: (progress) => {
            if (sequence !== distillationSequence) return;
            options.distillationUploadPercent.value = progress.percent;
            options.distillationStatusMessage.value = progress.message;
          },
        }),
        getSettings(),
      ]);
      assertCurrentDistillation(sequence);
      options.distillationStep.value = "parsing";
      options.distillationStatusMessage.value = "创建解析任务";
      const job = await createJob({
        inputText: "",
        filePaths: [],
        uploadedFiles: [],
        uploadSessionId: session.sessionId,
        settings,
      });
      options.distillationJob.value = job;
      const completedJob = await waitForDistillationJob(job.id, file, sequence);
      options.distillationStep.value = "distilling";
      options.distillationStatusMessage.value = "创建知识蒸馏任务";
      const run = await createKnowledgeDistillationWorkbenchRun({
        title: `${file.name} 知识蒸馏`,
        jobId: completedJob.id,
        batchId: completedJob.id,
        query: "上传文件核心知识提炼",
        workflowScope: "document",
        fileName: file.name,
        prompt: defaultDistillationPrompt,
        modelAlias: options.distillationModelAlias.value,
        tokenBudget: DISTILLATION_TOKEN_BUDGET,
        payloadBudget: DISTILLATION_PAYLOAD_BUDGET,
        rawCorpusBatchMaxCharacters: DISTILLATION_RAW_CORPUS_BATCH_MAX_CHARACTERS,
        rawCorpusBatchModelMaxCharacters: DISTILLATION_RAW_BATCH_MODEL_MAX_CHARACTERS,
        rawCorpusBatchRetryModelMaxCharacters: DISTILLATION_RAW_BATCH_RETRY_MODEL_MAX_CHARACTERS,
        mergeStrategy: "timeline_then_topic",
        maxRounds: 3,
        priority: "normal",
        modelEnabled: true,
      });
      options.distillationRun.value = run;
      if (!run.runId) {
        throw new Error("知识蒸馏任务没有返回 runId。");
      }
      const completedRun = await waitForDistillationRun(run.runId, sequence);
      options.distillationRun.value = completedRun;
      await refreshDistillationArtifactSizes(completedRun.runId || run.runId, sequence);
      options.distillationStep.value = "completed";
      options.distillationStatusMessage.value = "知识蒸馏完成，可下载结果";
    } catch (nextError) {
      if (sequence !== distillationSequence) return;
      options.distillationStep.value = "failed";
      options.distillationError.value = nextError instanceof Error ? nextError.message : "知识蒸馏失败。";
      options.distillationStatusMessage.value = "任务失败";
    }
  }

  return {
    cancelDebugKnowledgeDistillation,
    handleDebugDistillationFileSelected,
    startDebugKnowledgeDistillation,
  };
}
