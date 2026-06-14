import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJsonThroughState,
  mutateState,
  waitForStateIdle
} from "../../../platform/interactive/product-api.mjs";

export const MAINTENANCE_AGENT_SCHEMA_VERSION = "v0.0.1:platform:maintenance-agent-schema-1";
export const MAINTENANCE_AGENT_RISKS = [
  "read_only",
  "safe_write",
  "repair_write",
  "destructive"
];

export const AUTO_APPROVE_RISKS = ["read_only", "safe_write"];

export const DEFAULT_RUNBOOKS = {
  health_smoke: {
    id: "health_smoke",
    label: "健康冒烟巡检",
    description: "健康、运行时、存储摘要、最近任务和知识库健康检查。"
  },
  daily_storage_and_knowledge: {
    id: "daily_storage_and_knowledge",
    label: "每日存储与知识库维护",
    description: "健康冒烟巡检加安全级知识库派生数据维护。"
  },
  failed_jobs_review: {
    id: "failed_jobs_review",
    label: "失败任务复盘",
    description: "扫描近期失败任务并生成可执行建议，不自动重跑任务。"
  },
  knowledge_maintenance_review: {
    id: "knowledge_maintenance_review",
    label: "知识库维护复盘",
    description: "读取知识库健康与维护状态，必要时生成需要审批的重建计划。"
  }
};

export const DEFAULT_MAINTENANCE_AGENT_CONFIG = {
  schemaVersion: MAINTENANCE_AGENT_SCHEMA_VERSION,
  enabled: false,
  plannerMode: "gateway_fallback",
  autoApproveRisk: "safe_write",
  concurrency: {
    maxActiveRuns: 1
  },
  scheduler: {
    tickSeconds: 30
  },
  schedules: [
    {
      id: "hourly-health-smoke",
      label: "每小时健康巡检",
      enabled: false,
      runbook: "health_smoke",
      intervalMinutes: 60,
      nextRunAt: ""
    },
    {
      id: "daily-storage-and-knowledge",
      label: "每日存储与知识库维护",
      enabled: false,
      runbook: "daily_storage_and_knowledge",
      intervalMinutes: 1440,
      nextRunAt: ""
    },
    {
      id: "daily-failed-jobs-review",
      label: "每日失败任务复盘",
      enabled: false,
      runbook: "failed_jobs_review",
      intervalMinutes: 1440,
      nextRunAt: ""
    }
  ],
  runbooks: DEFAULT_RUNBOOKS
};

export function getMaintenanceAgentConfigPath(userDataPath) {
  return path.join(userDataPath, "maintenance-agent.json");
}

export function getMaintenanceAgentAuditPath(userDataPath) {
  return path.join(userDataPath, "maintenance-agent-audit.jsonl");
}

export function getMaintenanceAgentRunsPath(userDataPath) {
  return path.join(userDataPath, "maintenance-agent-runs.jsonl");
}

export function normalizeRisk(value, fallback = "read_only") {
  const risk = String(value || "").trim();
  return MAINTENANCE_AGENT_RISKS.includes(risk) ? risk : fallback;
}

export function riskRank(value) {
  const index = MAINTENANCE_AGENT_RISKS.indexOf(normalizeRisk(value));
  return index >= 0 ? index : 0;
}

export function maxRisk(...risks) {
  return risks
    .map((risk) => normalizeRisk(risk))
    .sort((left, right) => riskRank(right) - riskRank(left))[0] || "read_only";
}

function asPlainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function normalizePlannerMode(value) {
  const mode = String(value || "").trim();
  return ["gateway", "gateway_fallback", "fixed_runbook"].includes(mode)
    ? mode
    : DEFAULT_MAINTENANCE_AGENT_CONFIG.plannerMode;
}

function normalizeAutoApproveRisk(value) {
  const risk = normalizeRisk(value, DEFAULT_MAINTENANCE_AGENT_CONFIG.autoApproveRisk);
  return AUTO_APPROVE_RISKS.includes(risk) ? risk : DEFAULT_MAINTENANCE_AGENT_CONFIG.autoApproveRisk;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = 100000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeSchedule(input, fallback = {}) {
  const value = asPlainObject(input);
  const runbook = String(value.runbook || fallback.runbook || "health_smoke").trim();
  const id = String(value.id || fallback.id || `schedule_${crypto.randomUUID()}`).trim();
  return {
    id,
    label: String(value.label || fallback.label || id).trim(),
    enabled: value.enabled === true,
    runbook: DEFAULT_RUNBOOKS[runbook] ? runbook : "health_smoke",
    intervalMinutes: normalizePositiveInteger(
      value.intervalMinutes ?? fallback.intervalMinutes,
      fallback.intervalMinutes || 60,
      { min: 1, max: 525600 }
    ),
    nextRunAt: String(value.nextRunAt || fallback.nextRunAt || "").trim()
  };
}

export function normalizeMaintenanceAgentConfig(input = {}) {
  const value = asPlainObject(input);
  const defaultSchedules = DEFAULT_MAINTENANCE_AGENT_CONFIG.schedules;
  const incomingSchedules = Array.isArray(value.schedules) ? value.schedules : defaultSchedules;
  const schedules = incomingSchedules.map((item, index) =>
    normalizeSchedule(item, defaultSchedules[index] || {})
  );

  return {
    schemaVersion: MAINTENANCE_AGENT_SCHEMA_VERSION,
    enabled: value.enabled === true,
    plannerMode: normalizePlannerMode(value.plannerMode),
    autoApproveRisk: normalizeAutoApproveRisk(value.autoApproveRisk),
    concurrency: {
      maxActiveRuns: 1
    },
    scheduler: {
      tickSeconds: normalizePositiveInteger(
        asPlainObject(value.scheduler).tickSeconds,
        DEFAULT_MAINTENANCE_AGENT_CONFIG.scheduler.tickSeconds,
        { min: 1, max: 3600 }
      )
    },
    schedules,
    runbooks: DEFAULT_RUNBOOKS
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWriteJsonThroughState(filePath, value, {
    kind: "maintenance_agent.config.write"
  });
}

function maintenanceAgentConfigStateKey(userDataPath) {
  return `maintenance-agent-config:${path.resolve(userDataPath)}`;
}

async function loadMaintenanceAgentConfigUnlocked(userDataPath) {
  const filePath = getMaintenanceAgentConfigPath(userDataPath);
  const parsed = await readJsonIfExists(filePath);
  return normalizeMaintenanceAgentConfig(parsed || DEFAULT_MAINTENANCE_AGENT_CONFIG);
}

export async function loadMaintenanceAgentConfig(userDataPath) {
  await waitForStateIdle(maintenanceAgentConfigStateKey(userDataPath));
  return loadMaintenanceAgentConfigUnlocked(userDataPath);
}

async function saveMaintenanceAgentConfigUnlocked(userDataPath, input = {}) {
  const normalized = normalizeMaintenanceAgentConfig(input);
  await atomicWriteJson(getMaintenanceAgentConfigPath(userDataPath), normalized);
  return normalized;
}

export async function saveMaintenanceAgentConfig(userDataPath, input = {}) {
  return mutateState({
    key: maintenanceAgentConfigStateKey(userDataPath),
    kind: "maintenance_agent.config.save",
    metadata: { userDataPath },
    task: () => saveMaintenanceAgentConfigUnlocked(userDataPath, input)
  });
}

export function computeNextRunAt(schedule, fromDate = new Date()) {
  const intervalMinutes = normalizePositiveInteger(schedule?.intervalMinutes, 60, {
    min: 1,
    max: 525600
  });
  return new Date(fromDate.getTime() + intervalMinutes * 60 * 1000).toISOString();
}
