import { bridge } from "./bridge";
import type { AgentModelConfig, AgentSettings, ModelProbeResponse } from "./types";

export type WorkbenchStage = {
  stageId: string;
  title: string;
  actionLabel: string;
  description: string;
  status: string;
  tone?: string;
  progressPercent?: number;
  preview?: string;
  exportFormats?: string[];
  metrics?: Record<string, unknown>;
  versions?: Array<{
    versionId?: string;
    archivedAt?: string;
    status?: string;
    markdownLength?: number;
    jsonAvailable?: boolean;
  }>;
  checkpoint?: {
    durable?: boolean;
    resumable?: boolean;
    continuationToken?: string;
  };
  error?: string;
};

export type WorkbenchRun = {
  runId: string;
  title: string;
  status: string;
  progressPercent?: number;
  jobId?: string;
  batchId?: string;
  createdAt?: string;
  updatedAt?: string;
  waitingFor?: Record<string, unknown> | null;
  error?: string;
  priority?: string;
  modelAlias?: string;
  modelEnabled?: boolean;
  prompt?: string;
  tokenBudget?: number;
  payloadBudget?: number;
  rawCorpusBatchMaxCharacters?: number;
  mergeStrategy?: string;
  maxRounds?: number;
  strategyVersion?: string;
  timeDecayHalfLifeDays?: number;
  timeDecayFloor?: number;
  taskManagement?: Record<string, unknown>;
  stages: WorkbenchStage[];
  storage?: {
    durable?: boolean;
    rootRelativePath?: string;
    checkpointFile?: string;
  };
};

export type AgentModelOption = {
  agentUid?: string;
  value?: string | number | boolean;
  label?: string;
  selectable?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  reason?: string;
  disabledReason?: string;
  provider?: string;
  model?: string;
};

export type DistillationModelProbeStatus = {
  state: "online" | "offline" | "unconfigured";
  checkedAt: string;
  message: string;
};

type CreateWorkbenchRunPayload = Record<string, unknown> & {
  workflowScope: "document" | "corpus" | "project";
};

export function asWorkbenchRun(value: unknown): WorkbenchRun {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    runId: String(record.runId || ""),
    title: String(record.title || "知识蒸馏工作台"),
    status: String(record.status || "unknown"),
    progressPercent: Number(record.progressPercent || 0),
    jobId: String(record.jobId || ""),
    batchId: String(record.batchId || ""),
    createdAt: String(record.createdAt || ""),
    updatedAt: String(record.updatedAt || ""),
    waitingFor: record.waitingFor && typeof record.waitingFor === "object" ? record.waitingFor as Record<string, unknown> : null,
    error: String(record.error || ""),
    priority: String(record.priority || "normal"),
    modelAlias: String(record.modelAlias || ""),
    modelEnabled: record.modelEnabled === true,
    prompt: String(record.prompt || ""),
    tokenBudget: Number(record.tokenBudget || 0),
    payloadBudget: Number(record.payloadBudget || 0),
    rawCorpusBatchMaxCharacters: Number(record.rawCorpusBatchMaxCharacters || 0),
    mergeStrategy: String(record.mergeStrategy || ""),
    maxRounds: Number(record.maxRounds || 0),
    strategyVersion: String(record.strategyVersion || ""),
    timeDecayHalfLifeDays: Number(record.timeDecayHalfLifeDays || 0),
    timeDecayFloor: Number(record.timeDecayFloor || 0),
    taskManagement: record.taskManagement && typeof record.taskManagement === "object" ? record.taskManagement as Record<string, unknown> : undefined,
    stages: Array.isArray(record.stages) ? record.stages.map((stage) => stage as WorkbenchStage) : [],
    storage: record.storage && typeof record.storage === "object" ? record.storage as WorkbenchRun["storage"] : undefined,
  };
}

export function statusLabel(status = "") {
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    waiting: "等待",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
    archived: "已归档",
    pending: "未开始",
  };
  return labels[status] || status || "未知";
}

export function statusTone(status = "") {
  if (status === "completed") return "success";
  if (status === "running" || status === "queued") return "warning";
  if (status === "failed" || status === "canceled") return "danger";
  return "muted";
}

export function optionValue(option: AgentModelOption) {
  return String(option.agentUid ?? option.value ?? "").trim();
}

export function optionSelectable(option: AgentModelOption) {
  return option.disabled !== true && option.selectable !== false && option.enabled !== false;
}

function modelEntryKey(entry: AgentModelConfig) {
  return String(entry.uid || entry.instanceId || entry.alias || "").trim();
}

function findModelEntry(settings: AgentSettings, alias = "") {
  const normalizedAlias = String(alias || "").trim();
  const models = Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : [];
  return models.find((entry) => {
    const identifiers = [
      modelEntryKey(entry),
      entry.alias,
      entry.instanceId,
      entry.uid,
      entry.model,
      entry.engine,
    ].map((value) => String(value || "").trim());
    return identifiers.includes(normalizedAlias);
  }) || null;
}

function providerForModel(settings: AgentSettings, alias = "", entry: AgentModelConfig | null = null) {
  if (entry?.provider) {
    return String(entry.provider);
  }
  const normalizedAlias = String(alias || "").trim().toLowerCase();
  if (normalizedAlias.startsWith("deepseek")) {
    return "deepseek";
  }
  return String(settings.defaultModelProvider || "deepseek");
}

function probeSettingsForModel(settings: AgentSettings, alias = "", entry: AgentModelConfig | null = null) {
  const provider = providerForModel(settings, alias, entry);
  const nextSettings = {
    ...settings,
    modelLibraryAgents: Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : [],
  };
  if (provider === "deepseek") {
    nextSettings.deepSeekModel = String(entry?.model || entry?.engine || alias || settings.deepSeekModel || "").trim();
  }
  if (provider === "custom-http" && entry) {
    nextSettings.customHttpAdapter = {
      ...(settings.customHttpAdapter || {}),
      ...entry,
      alias: modelEntryKey(entry) || entry.alias || alias,
      engine: String(entry.engine || entry.model || "").trim(),
    };
  }
  return nextSettings;
}

function normalizeProbeResult(result: ModelProbeResponse): DistillationModelProbeStatus {
  if (result.ok) {
    return {
      state: "online",
      checkedAt: result.checkedAt || "",
      message: result.message || "",
    };
  }
  return {
    state: result.configured === false ? "unconfigured" : "offline",
    checkedAt: result.checkedAt || "",
    message: result.message || "",
  };
}

export async function probeDistillationModelStatus(alias = ""): Promise<DistillationModelProbeStatus> {
  const settings = await bridge.getSettings();
  const normalizedAlias = String(alias || "").trim();
  if (!normalizedAlias) {
    return {
      state: "unconfigured",
      checkedAt: new Date().toISOString(),
      message: "当前模型库为空，请先配置模型/智能体。",
    };
  }
  const entry = findModelEntry(settings, normalizedAlias);
  const provider = providerForModel(settings, normalizedAlias, entry);
  const result = await bridge.probeModel({
    provider,
    modelAlias: entry ? modelEntryKey(entry) : normalizedAlias,
    settings: probeSettingsForModel(settings, normalizedAlias, entry),
  });
  return normalizeProbeResult(result);
}

export async function listKnowledgeDistillationWorkbenchRuns(limit = 50): Promise<WorkbenchRun[]> {
  const result = await bridge.listKnowledgeDistillationWorkbenchRuns(limit);
  return Array.isArray((result as { items?: unknown[] }).items)
    ? (result as { items: unknown[] }).items.map(asWorkbenchRun)
    : [];
}

export async function getKnowledgeDistillationWorkbenchRun(runId: string): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.getKnowledgeDistillationWorkbenchRun(runId));
}

export async function createKnowledgeDistillationWorkbenchRun(payload: CreateWorkbenchRunPayload): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.createKnowledgeDistillationWorkbenchRun(payload));
}

export async function cancelKnowledgeDistillationWorkbenchRun(runId: string, reason: string): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.cancelKnowledgeDistillationWorkbenchRun(runId, reason));
}

export async function archiveKnowledgeDistillationWorkbenchRun(runId: string): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.archiveKnowledgeDistillationWorkbenchRun(runId));
}

export function deleteKnowledgeDistillationWorkbenchRun(runId: string) {
  return bridge.deleteKnowledgeDistillationWorkbenchRun(runId);
}

export async function rerunKnowledgeDistillationWorkbenchStage(runId: string, stageId: string): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.rerunKnowledgeDistillationWorkbenchStage(runId, stageId));
}

export async function resumeKnowledgeDistillationWorkbenchRun(runId: string): Promise<WorkbenchRun> {
  return asWorkbenchRun(await bridge.resumeKnowledgeDistillationWorkbenchRun(runId));
}

export function compareKnowledgeDistillationWorkbenchRuns(leftRunId: string, rightRunId: string) {
  return bridge.compareKnowledgeDistillationWorkbenchRuns(leftRunId, rightRunId);
}

export function knowledgeDistillationWorkbenchExportUrl(runId: string, stageId: string, format: string) {
  return bridge.knowledgeDistillationWorkbenchExportUrl(runId, stageId, format);
}

export function knowledgeDistillationWorkbenchPackageUrl(runId: string) {
  return bridge.knowledgeDistillationWorkbenchPackageUrl(runId);
}
