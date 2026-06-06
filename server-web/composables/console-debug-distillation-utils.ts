import type { WorkbenchRun, WorkbenchStage } from "../lib/knowledge-distillation-workbench";
import type { FileListResultEntry } from "../lib/upload-file-list";

export type DebugDistillationModelOption = {
  agentUid?: unknown;
  value?: unknown;
  label?: unknown;
  selectable?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  reason?: unknown;
  disabledReason?: unknown;
};

export type DistillationStep = "idle" | "uploading" | "parsing" | "distilling" | "completed" | "failed";

export type DistillationRun = WorkbenchRun;

export type DistillationArtifact = Record<string, unknown> & {
  artifactId?: string;
  stageId?: string;
  format?: string;
  byteSize?: number;
  size?: number;
};

export type DistillationProgressSegment = {
  key: "upload" | "parse" | "distill";
  label: string;
  state: "complete" | "active" | "pending" | "failed";
};

export const defaultDistillationPrompt = [
  "对上传文件做核心知识提炼。",
  "优先保留关键事实、时间线、实体、决策依据、结论边界和不确定项。",
  "不要做小模型训练，不要扩写原文没有的信息。",
].join("\n");

export const DISTILLATION_STAGE_ID = "knowledge-distillation";
export const DISTILLATION_PARSE_POLL_INTERVAL_MS = 1500;
export const DISTILLATION_PARSE_MIN_TIMEOUT_MS = 20 * 60 * 1000;
export const DISTILLATION_PARSE_MAX_TIMEOUT_MS = 90 * 60 * 1000;
export const DISTILLATION_PDF_PARSE_BYTES_PER_MINUTE = 1024 * 1024;
export const DISTILLATION_GENERIC_PARSE_BYTES_PER_MINUTE = 2 * 1024 * 1024;
export const DISTILLATION_RUN_POLL_INTERVAL_MS = 1500;
export const DISTILLATION_RUN_TIMEOUT_MS = 90 * 60 * 1000;
export const DISTILLATION_TOKEN_BUDGET = 64000;
export const DISTILLATION_PAYLOAD_BUDGET = 500000;
export const DISTILLATION_RAW_CORPUS_BATCH_MAX_CHARACTERS = 160000;
export const DISTILLATION_RAW_BATCH_MODEL_MAX_CHARACTERS = 32000;
export const DISTILLATION_RAW_BATCH_RETRY_MODEL_MAX_CHARACTERS = 16000;

export function formatFileSize(bytes: number) {
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

export function encodedByteLength(value: string) {
  return new TextEncoder().encode(value || "").length;
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

export function formatDurationLabel(durationMs: number) {
  const minutes = Math.max(1, Math.ceil(Number(durationMs || 0) / 60000));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function distillationFileLooksLikePdf(file: File | null) {
  if (!file) return false;
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export function distillationParseTimeoutMs(file: File | null) {
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

export function extractDistillationArtifactSizes(value: Record<string, unknown> | null | undefined) {
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

export function stripFileExtension(name: string) {
  return String(name || "").replace(/\.[^/.]+$/, "");
}

export function safeDownloadFileName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "知识蒸馏结果";
}

export function debugModelOptionValue(option: DebugDistillationModelOption) {
  return String(option.agentUid ?? option.value ?? "").trim();
}

export function debugModelOptionEnabled(option: DebugDistillationModelOption) {
  return option.disabled !== true && option.selectable !== false && option.enabled !== false;
}

export function findDistillationCoreStage(run: DistillationRun | null | undefined) {
  return (run?.stages || []).find((stage) => String(stage.stageId || "") === DISTILLATION_STAGE_ID) || null;
}

export function getDistillationCoreOutput(stage: WorkbenchStage | null | undefined) {
  const output = stage?.output;
  return output && typeof output === "object" && !Array.isArray(output)
    ? output
    : {};
}

export function distillationMarkdownLength(output: Record<string, unknown>, markdown: string) {
  return Number(output.markdownLength || markdown.length || 0);
}

export function buildDistillationProgressSegments(options: {
  step: DistillationStep;
  uploadPercent: number;
  jobStatus: string;
  runStatus: string;
  coreStatus: string;
  markdownLength: number;
}): DistillationProgressSegment[] {
  const uploadCompleted =
    options.uploadPercent >= 100 ||
    options.step === "parsing" ||
    options.step === "distilling" ||
    options.step === "completed" ||
    (options.step === "failed" && options.uploadPercent >= 100);
  const parseCompleted =
    options.jobStatus === "completed" ||
    options.step === "distilling" ||
    options.step === "completed" ||
    (options.step === "failed" && options.jobStatus === "completed");
  const distillCompleted =
    options.step === "completed" &&
    options.runStatus === "completed" &&
    options.coreStatus === "completed" &&
    options.markdownLength > 0;
  return [
    {
      key: "upload",
      label: "上传",
      state: uploadCompleted ? "complete" : options.step === "uploading" ? "active" : "pending",
    },
    {
      key: "parse",
      label: "解析",
      state: parseCompleted
        ? "complete"
        : options.step === "parsing"
          ? "active"
          : options.jobStatus === "failed"
            ? "failed"
            : "pending",
    },
    {
      key: "distill",
      label: "蒸馏",
      state: distillCompleted
        ? "complete"
        : options.step === "failed"
          ? "failed"
          : options.step === "distilling"
            ? "active"
            : "pending",
    },
  ];
}

export function buildDistillationResultFiles(options: {
  downloadUrl: string;
  packageUrl: string;
  runId: string;
  baseName: string;
  coreOutput: Record<string, unknown>;
  markdown: string;
  artifactByteSize: (...keys: string[]) => number;
  exportUrl: (runId: string, stageId: string, format: string) => string;
}): FileListResultEntry[] {
  if (!options.downloadUrl) {
    return [];
  }
  const outputJson = options.coreOutput.json;
  const jsonText = outputJson && typeof outputJson === "object"
    ? JSON.stringify(outputJson, null, 2)
    : "";
  return [
    {
      key: "markdown",
      name: `${options.baseName}.md`,
      extension: "MD",
      size: options.artifactByteSize(`${DISTILLATION_STAGE_ID}:markdown`, "markdown") ||
        Number(options.coreOutput.markdownByteSize || 0) ||
        encodedByteLength(options.markdown),
      detail: "核心提炼文档",
      href: options.exportUrl(options.runId, DISTILLATION_STAGE_ID, "markdown"),
      actionLabel: "下载",
      downloadName: `${options.baseName}.md`,
    },
    {
      key: "docx",
      name: `${options.baseName}.docx`,
      extension: "DOCX",
      size: options.artifactByteSize(`${DISTILLATION_STAGE_ID}:docx`, "docx"),
      detail: "Word 文档",
      href: options.exportUrl(options.runId, DISTILLATION_STAGE_ID, "docx"),
      actionLabel: "下载",
      downloadName: `${options.baseName}.docx`,
    },
    {
      key: "json",
      name: `${options.baseName}.json`,
      extension: "JSON",
      size: options.artifactByteSize(`${DISTILLATION_STAGE_ID}:json`, "json") ||
        encodedByteLength(jsonText),
      detail: "结构化结果",
      href: options.exportUrl(options.runId, DISTILLATION_STAGE_ID, "json"),
      actionLabel: "下载",
      downloadName: `${options.baseName}.json`,
    },
    {
      key: "package",
      name: `${options.baseName}-workspace-package.zip`,
      extension: "ZIP",
      size: options.artifactByteSize("run:package", "package"),
      detail: "蒸馏整包",
      href: options.packageUrl,
      actionLabel: "下载",
      downloadName: `${options.baseName}-workspace-package.zip`,
    },
  ].filter((file) => file.href);
}
