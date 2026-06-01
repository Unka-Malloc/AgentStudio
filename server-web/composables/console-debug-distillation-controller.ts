import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { bridge } from "../lib/bridge";
import { createKnowledgeUploadSession } from "../lib/knowledge-upload-session";
import type { SplitJob } from "../lib/types";

type FileListResultEntry = {
  key?: string;
  name: string;
  relativePath?: string;
  extension?: string;
  size?: number;
  detail?: string;
  href?: string;
  actionLabel?: string;
  downloadName?: string;
  statusLabel?: string;
  statusTone?: string;
};

type DebugDistillationModelOption = {
  agentUid?: unknown;
  value?: unknown;
  label?: unknown;
  selectable?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  reason?: unknown;
  disabledReason?: unknown;
};

type DistillationStep = "idle" | "uploading" | "parsing" | "distilling" | "completed" | "failed";

type DistillationRun = Record<string, unknown> & {
  runId?: string;
  status?: string;
  progressPercent?: number;
  error?: string;
  stages?: Array<Record<string, unknown>>;
};

type DistillationArtifact = Record<string, unknown> & {
  artifactId?: string;
  stageId?: string;
  format?: string;
  byteSize?: number;
  size?: number;
};

type DebugDistillationControllerOptions = {
  infoFeedModelOptions: Readonly<Ref<DebugDistillationModelOption[]>>;
};

const defaultDistillationPrompt = [
  "对上传文件做核心知识提炼。",
  "优先保留关键事实、时间线、实体、决策依据、结论边界和不确定项。",
  "不要做小模型训练，不要扩写原文没有的信息。",
].join("\n");

const DISTILLATION_PARSE_POLL_INTERVAL_MS = 1500;
const DISTILLATION_PARSE_MIN_TIMEOUT_MS = 20 * 60 * 1000;
const DISTILLATION_PARSE_MAX_TIMEOUT_MS = 90 * 60 * 1000;
const DISTILLATION_PDF_PARSE_BYTES_PER_MINUTE = 1024 * 1024;
const DISTILLATION_GENERIC_PARSE_BYTES_PER_MINUTE = 2 * 1024 * 1024;
const DISTILLATION_RUN_POLL_INTERVAL_MS = 1500;
const DISTILLATION_RUN_TIMEOUT_MS = 90 * 60 * 1000;
const DISTILLATION_TOKEN_BUDGET = 64000;
const DISTILLATION_PAYLOAD_BUDGET = 500000;
const DISTILLATION_RAW_CORPUS_BATCH_MAX_CHARACTERS = 160000;
const DISTILLATION_RAW_BATCH_MODEL_MAX_CHARACTERS = 32000;
const DISTILLATION_RAW_BATCH_RETRY_MODEL_MAX_CHARACTERS = 16000;

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function encodedByteLength(value: string) {
  return new TextEncoder().encode(value || "").length;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function formatDurationLabel(durationMs: number) {
  const minutes = Math.max(1, Math.ceil(Number(durationMs || 0) / 60000));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function distillationFileLooksLikePdf(file: File | null) {
  if (!file) return false;
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

function extractDistillationArtifactSizes(value: Record<string, unknown> | null | undefined) {
  const sizes: Record<string, number> = {};
  const items = Array.isArray(value?.items) ? value.items as DistillationArtifact[] : [];
  for (const item of items) {
    const byteSize = Number(item.byteSize ?? item.size ?? 0);
    if (!Number.isFinite(byteSize) || byteSize <= 0) continue;
    const artifactId = String(item.artifactId || "").trim();
    const stageId = String(item.stageId || "").trim();
    const format = String(item.format || "").trim();
    if (artifactId) sizes[artifactId] = byteSize;
    if (format) sizes[format] = byteSize;
    if (stageId && format) sizes[`${stageId}:${format}`] = byteSize;
  }
  return sizes;
}

function stripFileExtension(name: string) {
  return String(name || "").replace(/\.[^/.]+$/, "");
}

function safeDownloadFileName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "知识蒸馏结果";
}

function asDistillationRun(value: Record<string, unknown> | null | undefined): DistillationRun {
  return (value && typeof value === "object" ? value : {}) as DistillationRun;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function debugModelOptionValue(option: DebugDistillationModelOption) {
  return String(option.agentUid ?? option.value ?? "").trim();
}

function debugModelOptionEnabled(option: DebugDistillationModelOption) {
  return option.disabled !== true && option.selectable !== false && option.enabled !== false;
}

export function useDebugDistillationController(options: DebugDistillationControllerOptions) {
  const distillationFile = ref<File | null>(null);
  const distillationStep = ref<DistillationStep>("idle");
  const distillationUploadPercent = ref(0);
  const distillationJob = ref<SplitJob | null>(null);
  const distillationRun = ref<DistillationRun | null>(null);
  const distillationArtifactSizes = ref<Record<string, number>>({});
  const distillationError = ref("");
  const distillationStatusMessage = ref("等待文件");
  const distillationModelAlias = ref("");
  let distillationSequence = 0;

  const distillationBusy = computed(() =>
    distillationStep.value === "uploading" ||
    distillationStep.value === "parsing" ||
    distillationStep.value === "distilling"
  );

  const distillationFileLabel = computed(() => {
    if (!distillationFile.value) return "未选择文件";
    return `${distillationFile.value.name} · ${formatFileSize(distillationFile.value.size)}`;
  });

  const distillationRunId = computed(() => String(distillationRun.value?.runId || ""));
  const distillationCoreStage = computed(() =>
    (distillationRun.value?.stages || []).find((stage) => String(stage.stageId || "") === "knowledge-distillation") || null
  );
  const distillationCoreOutput = computed<Record<string, unknown>>(() => {
    const output = distillationCoreStage.value?.output;
    return output && typeof output === "object" && !Array.isArray(output)
      ? output as Record<string, unknown>
      : {};
  });
  const distillationResultMarkdown = computed(() => String(distillationCoreOutput.value.markdown || ""));
  const distillationResultMarkdownLength = computed(() => {
    return Number(distillationCoreOutput.value.markdownLength || distillationResultMarkdown.value.length || 0);
  });
  const distillationDownloadUrl = computed(() => {
    if (
      !distillationRunId.value ||
      distillationCoreStage.value?.status !== "completed" ||
      distillationResultMarkdownLength.value <= 0
    ) return "";
    return bridge.knowledgeDistillationWorkbenchExportUrl(distillationRunId.value, "knowledge-distillation", "markdown");
  });
  const distillationPackageUrl = computed(() =>
    distillationRunId.value &&
      distillationRun.value?.status === "completed" &&
      distillationResultMarkdownLength.value > 0
      ? bridge.knowledgeDistillationWorkbenchPackageUrl(distillationRunId.value)
      : ""
  );
  const distillationResultBaseName = computed(() => {
    const sourceName = distillationFile.value?.name || String(distillationRun.value?.title || "知识蒸馏结果");
    return safeDownloadFileName(stripFileExtension(sourceName) || "知识蒸馏结果");
  });
  const distillationResultFiles = computed<FileListResultEntry[]>(() => {
    if (!distillationDownloadUrl.value) {
      return [];
    }
    const runId = distillationRunId.value;
    const baseName = distillationResultBaseName.value;
    const outputJson = distillationCoreOutput.value.json;
    const jsonText = outputJson && typeof outputJson === "object"
      ? JSON.stringify(outputJson, null, 2)
      : "";
    return [
      {
        key: "markdown",
        name: `${baseName}.md`,
        extension: "MD",
        size: distillationArtifactByteSize("knowledge-distillation:markdown", "markdown") ||
          Number(distillationCoreOutput.value.markdownByteSize || 0) ||
          encodedByteLength(distillationResultMarkdown.value),
        detail: "核心提炼文档",
        href: bridge.knowledgeDistillationWorkbenchExportUrl(runId, "knowledge-distillation", "markdown"),
        actionLabel: "下载",
        downloadName: `${baseName}.md`,
      },
      {
        key: "docx",
        name: `${baseName}.docx`,
        extension: "DOCX",
        size: distillationArtifactByteSize("knowledge-distillation:docx", "docx"),
        detail: "Word 文档",
        href: bridge.knowledgeDistillationWorkbenchExportUrl(runId, "knowledge-distillation", "docx"),
        actionLabel: "下载",
        downloadName: `${baseName}.docx`,
      },
      {
        key: "json",
        name: `${baseName}.json`,
        extension: "JSON",
        size: distillationArtifactByteSize("knowledge-distillation:json", "json") ||
          encodedByteLength(jsonText),
        detail: "结构化结果",
        href: bridge.knowledgeDistillationWorkbenchExportUrl(runId, "knowledge-distillation", "json"),
        actionLabel: "下载",
        downloadName: `${baseName}.json`,
      },
      {
        key: "package",
        name: `${baseName}-workspace-package.zip`,
        extension: "ZIP",
        size: distillationArtifactByteSize("run:package", "package"),
        detail: "蒸馏整包",
        href: distillationPackageUrl.value,
        actionLabel: "下载",
        downloadName: `${baseName}-workspace-package.zip`,
      },
    ].filter((file) => file.href);
  });
  const distillationProgressSegments = computed(() => {
    const step = distillationStep.value;
    const jobStatus = String(distillationJob.value?.status || "");
    const runStatus = String(distillationRun.value?.status || "");
    const coreStatus = String(distillationCoreStage.value?.status || "");
    const uploadCompleted =
      distillationUploadPercent.value >= 100 ||
      step === "parsing" ||
      step === "distilling" ||
      step === "completed" ||
      (step === "failed" && distillationUploadPercent.value >= 100);
    const parseCompleted =
      jobStatus === "completed" ||
      step === "distilling" ||
      step === "completed" ||
      (step === "failed" && jobStatus === "completed");
    const distillCompleted =
      step === "completed" &&
      runStatus === "completed" &&
      coreStatus === "completed" &&
      distillationResultMarkdownLength.value > 0;
    return [
      {
        key: "upload",
        label: "上传",
        state: uploadCompleted ? "complete" : step === "uploading" ? "active" : "pending",
      },
      {
        key: "parse",
        label: "解析",
        state: parseCompleted ? "complete" : step === "parsing" ? "active" : jobStatus === "failed" ? "failed" : "pending",
      },
      {
        key: "distill",
        label: "蒸馏",
        state: distillCompleted ? "complete" : step === "failed" ? "failed" : step === "distilling" ? "active" : "pending",
      },
    ];
  });
  const distillationProgressSummary = computed(() => {
    const completed = distillationProgressSegments.value.filter((segment) => segment.state === "complete").length;
    return `${completed}/${distillationProgressSegments.value.length}`;
  });
  const distillationModelOptions = computed(() => options.infoFeedModelOptions.value || []);
  const selectedDistillationModel = computed(() =>
    distillationModelOptions.value.find((option) => debugModelOptionValue(option) === distillationModelAlias.value) || null,
  );
  const distillationModelReady = computed(() =>
    Boolean(selectedDistillationModel.value && debugModelOptionEnabled(selectedDistillationModel.value)),
  );
  const distillationModelLabel = computed(() => String(selectedDistillationModel.value?.label || "").trim());

  function distillationParseTimeoutMs(file: File | null = distillationFile.value) {
    const bytes = Math.max(0, Number(file?.size || 0));
    const bytesPerMinute = distillationFileLooksLikePdf(file)
      ? DISTILLATION_PDF_PARSE_BYTES_PER_MINUTE
      : DISTILLATION_GENERIC_PARSE_BYTES_PER_MINUTE;
    const sizeBasedMs = Math.ceil(bytes / Math.max(1, bytesPerMinute)) * 60 * 1000 + 5 * 60 * 1000;
    return clampNumber(
      Math.max(DISTILLATION_PARSE_MIN_TIMEOUT_MS, sizeBasedMs),
      DISTILLATION_PARSE_MIN_TIMEOUT_MS,
      DISTILLATION_PARSE_MAX_TIMEOUT_MS
    );
  }

  function distillationArtifactByteSize(...keys: string[]) {
    for (const key of keys) {
      const value = Number(distillationArtifactSizes.value[key] || 0);
      if (value > 0) return value;
    }
    return 0;
  }

  function normalizeDistillationModelSelection() {
    const current = String(distillationModelAlias.value || "").trim();
    if (current && distillationModelOptions.value.some((option) => debugModelOptionValue(option) === current)) {
      return;
    }
    const fallback = distillationModelOptions.value.find(debugModelOptionEnabled) || distillationModelOptions.value[0];
    distillationModelAlias.value = fallback ? debugModelOptionValue(fallback) : "";
  }

  function assertCurrentDistillation(sequence: number) {
    if (sequence !== distillationSequence) {
      throw new Error("知识蒸馏任务已取消。");
    }
  }

  function handleDebugDistillationFileSelected(files: File[]) {
    distillationFile.value = files[0] || null;
    distillationStep.value = "idle";
    distillationUploadPercent.value = 0;
    distillationJob.value = null;
    distillationRun.value = null;
    distillationArtifactSizes.value = {};
    distillationError.value = "";
    distillationStatusMessage.value = distillationFile.value ? "文件已选择" : "等待文件";
  }

  async function refreshDistillationArtifactSizes(runId: string, sequence: number) {
    if (!runId) {
      distillationArtifactSizes.value = {};
      return;
    }
    try {
      const artifacts = await bridge.getKnowledgeDistillationWorkbenchRunArtifacts(runId);
      assertCurrentDistillation(sequence);
      distillationArtifactSizes.value = extractDistillationArtifactSizes(artifacts);
    } catch (nextError) {
      if (sequence !== distillationSequence) {
        throw nextError;
      }
      distillationArtifactSizes.value = {};
    }
  }

  async function waitForDistillationJob(jobId: string, sequence: number) {
    const timeoutMs = distillationParseTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertCurrentDistillation(sequence);
      const job = await bridge.getJob(jobId);
      if (!job) {
        throw new Error("找不到解析任务。");
      }
      distillationJob.value = job;
      distillationStatusMessage.value = `文件解析：${job.stage || job.status}（上限 ${formatDurationLabel(timeoutMs)}）`;
      if (job.status === "completed") return job;
      if (job.status === "failed") {
        throw new Error(job.error || "文件解析失败。");
      }
      await delay(DISTILLATION_PARSE_POLL_INTERVAL_MS);
    }
    throw new Error(`文件解析超时（已等待 ${formatDurationLabel(timeoutMs)}）。任务可能仍在后台运行，可稍后查看任务状态。`);
  }

  async function waitForDistillationRun(runId: string, sequence: number) {
    const deadline = Date.now() + DISTILLATION_RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      assertCurrentDistillation(sequence);
      const run = asDistillationRun(await bridge.getKnowledgeDistillationWorkbenchRun(runId));
      distillationRun.value = run;
      distillationStatusMessage.value = `知识蒸馏：${String(run.status || "running")}（上限 ${formatDurationLabel(DISTILLATION_RUN_TIMEOUT_MS)}）`;
      const status = String(run.status || "");
      if (status === "completed") {
        const coreStage = (run.stages || []).find((stage) => String(stage.stageId || "") === "knowledge-distillation");
        const output = coreStage?.output;
        const markdownLength =
          output && typeof output === "object" && !Array.isArray(output)
            ? Number((output as { markdownLength?: unknown }).markdownLength || 0)
            : 0;
        if (coreStage?.status !== "completed" || markdownLength <= 0) {
          throw new Error("知识蒸馏已结束，但结果文档未生成。");
        }
        return run;
      }
      if (status === "failed" || status === "canceled") {
        throw new Error(run.error || "知识蒸馏失败。");
      }
      await delay(DISTILLATION_RUN_POLL_INTERVAL_MS);
    }
    throw new Error(`知识蒸馏超时（已等待 ${formatDurationLabel(DISTILLATION_RUN_TIMEOUT_MS)}）。`);
  }

  async function startDebugKnowledgeDistillation() {
    const file = distillationFile.value;
    if (!file) {
      distillationError.value = "请先选择文件。";
      return;
    }
    if (!distillationModelReady.value) {
      distillationError.value =
        String(selectedDistillationModel.value?.reason || selectedDistillationModel.value?.disabledReason || "").trim() ||
        "请选择一个可用模型。";
      return;
    }
    const sequence = ++distillationSequence;
    distillationStep.value = "uploading";
    distillationUploadPercent.value = 0;
    distillationJob.value = null;
    distillationRun.value = null;
    distillationArtifactSizes.value = {};
    distillationError.value = "";
    distillationStatusMessage.value = "上传文件";
    try {
      const [{ session }, settings] = await Promise.all([
        createKnowledgeUploadSession([file], {
          checkpointPrefix: "knowledge-distillation-debug",
          checkpointMode: "debug-panel",
          checkpointSource: "knowledge-distillation-debug",
          onProgress: (progress) => {
            distillationUploadPercent.value = progress.percent;
            distillationStatusMessage.value = progress.message;
          },
        }),
        bridge.getSettings(),
      ]);
      assertCurrentDistillation(sequence);
      distillationStep.value = "parsing";
      distillationStatusMessage.value = "创建解析任务";
      const job = await bridge.createJob({
        inputText: "",
        filePaths: [],
        uploadedFiles: [],
        uploadSessionId: session.sessionId,
        settings,
      });
      distillationJob.value = job;
      const completedJob = await waitForDistillationJob(job.id, sequence);
      distillationStep.value = "distilling";
      distillationStatusMessage.value = "创建知识蒸馏任务";
      const run = asDistillationRun(await bridge.createKnowledgeDistillationWorkbenchRun({
        title: `${file.name} 知识蒸馏`,
        jobId: completedJob.id,
        batchId: completedJob.id,
        query: "上传文件核心知识提炼",
        workflowScope: "document",
        fileName: file.name,
        prompt: defaultDistillationPrompt,
        modelAlias: distillationModelAlias.value,
        tokenBudget: DISTILLATION_TOKEN_BUDGET,
        payloadBudget: DISTILLATION_PAYLOAD_BUDGET,
        rawCorpusBatchMaxCharacters: DISTILLATION_RAW_CORPUS_BATCH_MAX_CHARACTERS,
        rawCorpusBatchModelMaxCharacters: DISTILLATION_RAW_BATCH_MODEL_MAX_CHARACTERS,
        rawCorpusBatchRetryModelMaxCharacters: DISTILLATION_RAW_BATCH_RETRY_MODEL_MAX_CHARACTERS,
        mergeStrategy: "timeline_then_topic",
        maxRounds: 3,
        priority: "normal",
        modelEnabled: true,
      }));
      distillationRun.value = run;
      if (!run.runId) {
        throw new Error("知识蒸馏任务没有返回 runId。");
      }
      const completedRun = await waitForDistillationRun(run.runId, sequence);
      distillationRun.value = completedRun;
      await refreshDistillationArtifactSizes(completedRun.runId || run.runId, sequence);
      distillationStep.value = "completed";
      distillationStatusMessage.value = "知识蒸馏完成，可下载结果";
    } catch (nextError) {
      if (sequence !== distillationSequence) return;
      distillationStep.value = "failed";
      distillationError.value = nextError instanceof Error ? nextError.message : "知识蒸馏失败。";
      distillationStatusMessage.value = "任务失败";
    }
  }

  watch(distillationModelOptions, normalizeDistillationModelSelection, { immediate: true });

  onBeforeUnmount(() => {
    distillationSequence += 1;
  });

  return {
    distillationFile,
    distillationStep,
    distillationUploadPercent,
    distillationJob,
    distillationRun,
    distillationArtifactSizes,
    distillationError,
    distillationStatusMessage,
    distillationModelAlias,
    distillationBusy,
    distillationFileLabel,
    distillationRunId,
    distillationCoreStage,
    distillationCoreOutput,
    distillationResultMarkdown,
    distillationResultMarkdownLength,
    distillationDownloadUrl,
    distillationPackageUrl,
    distillationResultBaseName,
    distillationResultFiles,
    distillationProgressSegments,
    distillationProgressSummary,
    distillationModelOptions,
    selectedDistillationModel,
    distillationModelReady,
    distillationModelLabel,
    formatFileSize,
    handleDebugDistillationFileSelected,
    startDebugKnowledgeDistillation,
  };
}
