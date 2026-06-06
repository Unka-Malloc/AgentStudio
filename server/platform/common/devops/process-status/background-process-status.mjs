import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  queueStateMutation,
  stateFileKey
} from "../../platform-core/state-coordinator.mjs";
import { loadSettings } from "../../platform-core/settings.mjs";
import {
  composeUnifiedSystemStatus,
  unifiedRegistrationForProcess
} from "../unified-registration-core/unified-registration.mjs";

export const BACKGROUND_PROCESS_SCHEMA_VERSION = 1;
const IMPORT_PARSE_ACTIVE_STATUSES = new Set(["queued", "running"]);
const MAINTENANCE_ACTIVE_STATUSES = new Set(["queued", "running"]);
const AGENT_WORKER_SUPPORTED_PROVIDERS = new Set([
  "deepseek",
  "openrouter",
  "copilot",
  "custom-http",
  "local-model"
]);

export const BACKGROUND_PROCESS_DEFINITIONS = [
  {
    role: "import-worker",
    label: "导入解析 Worker",
    description: "轮询导入队列并执行解析、断点续传和入库。",
    processType: "service",
    responsibility: "运行导入解析队列服务。",
    services: ["导入解析队列", "断点续传恢复", "知识入库"],
    features: ["任务队列", "知识库入库", "checkpoint 恢复"],
    monitors: ["import_parse_job 队列心跳", "checkpoint tree 更新"],
    alerts: ["queueInterrupted", "processNotRunning", "processStale", "processRestarted"]
  },
  {
    role: "source-watcher",
    label: "目录同步 Worker",
    description: "监听持续同步目录并提交导入任务。",
    processType: "service",
    responsibility: "运行数据源目录同步服务。",
    services: ["目录同步", "数据源变更扫描", "导入任务提交"],
    features: ["数据源", "知识库入库", "任务队列"],
    monitors: ["source watcher tick", "导入任务提交状态"],
    alerts: ["processNotRunning", "processStale", "processRestarted"]
  },
  {
    role: "maintenance-worker",
    label: "智能巡检 Worker",
    description: "调度智能巡检 runbook，恢复排队中的巡检运行，并写入审批和审计链路。",
    processType: "service",
    responsibility: "运行智能巡检调度服务。",
    services: ["智能巡检调度", "巡检 runbook", "审批与审计"],
    features: ["智能巡检", "任务队列"],
    monitors: ["maintenance-agent runs", "智能巡检队列"],
    alerts: ["processNotRunning", "processStale", "processRestarted"]
  },
  {
    role: "agent-worker",
    label: "智能体 Worker",
    description: "执行智能检索、多智能体总结和评估任务。",
    processType: "service",
    responsibility: "运行智能体任务服务。",
    services: ["智能检索", "多智能体总结", "评估任务"],
    features: ["智能体", "信息流", "知识检索"],
    monitors: ["agent task tick", "智能体运行状态"],
    alerts: ["processNotRunning", "processStale", "processRestarted"]
  }
];

const ROLE_FEATURE_IDS = Object.freeze({
  "import-worker": ["work-queue-core"],
  "source-watcher": ["knowledge-core"],
  "maintenance-worker": ["maintenance-agent-runbooks"],
  "agent-worker": ["agent-exploration", "knowledge-distillation"]
});

function activeConsoleFeatureIdsFromEnv() {
  const explicit = String(process.env.PACT_FEATURES || "").trim();
  if (!explicit) {
    return null;
  }
  return new Set(explicit.split(",").map((item) => item.trim()).filter(Boolean));
}

function isRoleEnabledByFeatures(role = "") {
  const active = activeConsoleFeatureIdsFromEnv();
  if (!active) {
    return true;
  }
  const requiredAny = ROLE_FEATURE_IDS[role] || [];
  return requiredAny.length === 0 || requiredAny.some((featureId) => active.has(featureId));
}

const SERVER_PROCESS_DEFINITIONS = [
  {
    role: "server-main",
    label: "Pact 服务端",
    description: "承载控制台、HTTP API、JSON-RPC、CLI 转发和本地运行时的主服务进程。",
    processType: "service",
    responsibility: "运行服务端主调用面和控制台 API。",
    services: ["HTTP API", "JSON-RPC", "CLI 转发", "Server Console"],
    features: ["系统配置", "任务队列", "知识库", "智能体", "运维监控"],
    monitors: ["进程存活", "请求入口"],
    alerts: ["processNotRunning", "processStale"]
  },
  {
    role: "background-supervisor",
    label: "后台 Worker 管理进程",
    description: "管理并按需拉起导入解析、目录同步、智能巡检和智能体 Worker，持续写入后台进程状态。",
    processType: "daemon",
    responsibility: "管理后台 Worker 进程。",
    services: [],
    features: ["运维监控", "任务队列"],
    monitors: ["import-worker", "source-watcher", "maintenance-worker", "agent-worker"],
    alerts: ["supervisorStopped", "processNotRunning", "processRestarted"]
  },
  {
    role: "system-inspection",
    label: "系统巡检",
    description: "由 Node.js 执行的系统巡检守护进程，负责写入后台告警状态。",
    processType: "daemon",
    responsibility: "巡检服务端进程和任务队列，生成运维报警。",
    services: [],
    features: ["运维监控", "报警", "任务队列恢复"],
    monitors: ["后台进程状态", "queue-monitor 队列闭环", "checkpoint/log 证据"],
    alerts: ["processNotRunning", "processStale", "queueInterrupted"]
  }
];

function nowIso() {
  return new Date().toISOString();
}

function stringValue(value) {
  return String(value || "").trim();
}

export function backgroundStateDirectory(userDataPath) {
  return path.join(userDataPath, "background");
}

export function backgroundStatePath(userDataPath) {
  return path.join(backgroundStateDirectory(userDataPath), "processes.json");
}

function systemInspectionStatePath(userDataPath) {
  return path.join(backgroundStateDirectory(userDataPath), "monitor-alerts-state.json");
}

function importJobsRootPath(userDataPath) {
  return path.join(userDataPath, "jobs");
}

function knowledgeSourcesPath(userDataPath) {
  return path.join(userDataPath, "knowledge-sources", "sources.json");
}

function maintenanceAgentConfigPath(userDataPath) {
  return path.join(userDataPath, "maintenance-agent.json");
}

function maintenanceAgentRunsPath(userDataPath) {
  return path.join(userDataPath, "maintenance-agent-runs.jsonl");
}

function importJobMetaPath(userDataPath, jobId) {
  return path.join(importJobsRootPath(userDataPath), jobId, "meta.json");
}

export async function inspectImportParseWorkerDemand(userDataPath) {
  const jobsRootPath = importJobsRootPath(userDataPath);
  const demand = {
    kind: "import_parse_job",
    active: false,
    activeCount: 0,
    queuedCount: 0,
    runningCount: 0,
    activeJobIds: [],
    jobsRootPath,
    checkedAt: nowIso()
  };
  try {
    await fs.mkdir(jobsRootPath, { recursive: true });
    const entries = await fs.readdir(jobsRootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const meta = JSON.parse(await fs.readFile(importJobMetaPath(userDataPath, entry.name), "utf8"));
        const status = String(meta.status || "").trim();
        if (!IMPORT_PARSE_ACTIVE_STATUSES.has(status)) {
          continue;
        }
        const jobId = String(meta.id || entry.name || "").trim();
        demand.activeJobIds.push(jobId);
        if (status === "queued") {
          demand.queuedCount += 1;
        } else if (status === "running") {
          demand.runningCount += 1;
        }
      } catch {
        // Ignore malformed historical job entries.
      }
    }
  } catch (error) {
    demand.error = error instanceof Error ? error.message : String(error);
  }
  demand.activeCount = demand.queuedCount + demand.runningCount;
  demand.active = demand.activeCount > 0;
  demand.activeJobIds = demand.activeJobIds.filter(Boolean).sort();
  return demand;
}

export async function inspectSourceWatcherDemand(userDataPath) {
  const sourceConfigPath = knowledgeSourcesPath(userDataPath);
  const demand = {
    kind: "knowledge_sources",
    active: false,
    sourceConfigPath,
    totalCount: 0,
    enabledCount: 0,
    autoSyncCount: 0,
    watchableCount: 0,
    watchableSourceIds: [],
    checkedAt: nowIso()
  };
  try {
    const parsed = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    demand.totalCount = sources.length;
    for (const source of sources) {
      const directoryPath = String(source?.directoryPath || "").trim();
      const enabled = source?.enabled !== false;
      const autoSync = source?.autoSync !== false;
      if (enabled) {
        demand.enabledCount += 1;
      }
      if (autoSync) {
        demand.autoSyncCount += 1;
      }
      if (!directoryPath || !enabled || !autoSync) {
        continue;
      }
      demand.watchableCount += 1;
      demand.watchableSourceIds.push(String(source.sourceId || directoryPath).trim());
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      demand.error = error instanceof Error ? error.message : String(error);
    }
  }
  demand.active = demand.watchableCount > 0;
  demand.watchableSourceIds = demand.watchableSourceIds.filter(Boolean).sort();
  return demand;
}

async function readLatestMaintenanceRuns(userDataPath) {
  let content = "";
  try {
    content = await fs.readFile(maintenanceAgentRunsPath(userDataPath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const latest = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const run = parsed?.run;
      if (run?.runId) {
        latest.set(run.runId, run);
      }
    } catch {
      // Ignore malformed historical run snapshots.
    }
  }
  return [...latest.values()];
}

export async function inspectMaintenanceWorkerDemand(userDataPath) {
  const configPath = maintenanceAgentConfigPath(userDataPath);
  const runsPath = maintenanceAgentRunsPath(userDataPath);
  const demand = {
    kind: "maintenance_agent",
    active: false,
    configPath,
    runsPath,
    enabled: false,
    enabledScheduleCount: 0,
    activeRunCount: 0,
    queuedRunCount: 0,
    runningRunCount: 0,
    activeRunIds: [],
    checkedAt: nowIso()
  };
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    demand.enabled = parsed?.enabled === true;
    const schedules = Array.isArray(parsed?.schedules) ? parsed.schedules : [];
    demand.enabledScheduleCount = schedules.filter((schedule) => schedule?.enabled === true).length;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      demand.error = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    for (const run of await readLatestMaintenanceRuns(userDataPath)) {
      const status = String(run.status || "").trim();
      if (!MAINTENANCE_ACTIVE_STATUSES.has(status)) {
        continue;
      }
      demand.activeRunIds.push(String(run.runId || "").trim());
      if (status === "queued") {
        demand.queuedRunCount += 1;
      } else if (status === "running") {
        demand.runningRunCount += 1;
      }
    }
  } catch (error) {
    demand.error = demand.error || (error instanceof Error ? error.message : String(error));
  }
  demand.activeRunCount = demand.queuedRunCount + demand.runningRunCount;
  demand.activeRunIds = demand.activeRunIds.filter(Boolean).sort();
  demand.active = (demand.enabled && demand.enabledScheduleCount > 0) || demand.activeRunCount > 0;
  return demand;
}

function agentEntryUid(entry = {}) {
  return stringValue(entry.uid || entry.instanceId || entry.alias);
}

function inspectAgentEntryAvailability(settings = {}, entry = {}) {
  const provider = stringValue(entry.provider);
  const model = stringValue(entry.model || entry.engine);
  const hasModel = Boolean(model);
  if (!AGENT_WORKER_SUPPORTED_PROVIDERS.has(provider)) {
    return {
      status: "unsupported",
      selectable: false,
      reason: "该智能体来源尚未接入服务端调用链路。"
    };
  }
  if (provider === "custom-http") {
    const hasUrl = Boolean(stringValue(entry.url || entry.baseUrl || settings.customHttpAdapter?.url));
    const hasToken = Boolean(
      entry.tokenConfigured ||
        entry.apiKeyConfigured ||
        stringValue(entry.token || entry.apiKey)
    );
    if (!hasUrl || !hasToken) {
      return {
        status: "unconfigured",
        selectable: false,
        reason: "缺少调用地址或凭据。"
      };
    }
    return { status: "available", selectable: true, reason: "" };
  }
  if (provider === "local-model") {
    const hasUrl = Boolean(stringValue(entry.url || entry.baseUrl || settings.localModelEndpoint));
    if (!hasModel || !hasUrl) {
      return {
        status: "unconfigured",
        selectable: false,
        reason: "缺少本地模型名称或调用地址。"
      };
    }
    return { status: "available", selectable: true, reason: "" };
  }
  const providerCredentialConfigured =
    provider === "deepseek"
      ? Boolean(settings.deepSeekApiKeyConfigured || stringValue(settings.deepSeekApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
      : provider === "openrouter"
        ? Boolean(settings.openRouterApiKeyConfigured || stringValue(settings.openRouterApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
        : provider === "copilot"
          ? Boolean(settings.copilotApiKeyConfigured || stringValue(settings.copilotApiKey) || entry.apiKeyConfigured || stringValue(entry.apiKey))
          : Boolean(entry.apiKeyConfigured || stringValue(entry.apiKey || entry.token));
  if (!hasModel || !providerCredentialConfigured) {
    return {
      status: "unconfigured",
      selectable: false,
      reason: "缺少模型或凭据。"
    };
  }
  return { status: "available", selectable: true, reason: "" };
}

export async function inspectAgentWorkerDemand(userDataPath) {
  const demand = {
    kind: "agent_runtime",
    active: false,
    reason: "not_configured",
    configured: false,
    connected: false,
    modelCount: 0,
    availableModelCount: 0,
    unavailableModelCount: 0,
    unsupportedModelCount: 0,
    activeTaskCount: 0,
    availableAgentIds: [],
    unavailableAgentIds: [],
    unsupportedAgentIds: [],
    checkedAt: nowIso()
  };
  try {
    const settings = await loadSettings(userDataPath, { redactSecrets: false });
    const entries = Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : [];
    demand.modelCount = entries.length;
    demand.configured = entries.length > 0;
    for (const entry of entries) {
      const uid = agentEntryUid(entry);
      const availability = inspectAgentEntryAvailability(settings, entry);
      if (availability.status === "available") {
        demand.availableModelCount += 1;
        demand.availableAgentIds.push(uid);
        continue;
      }
      if (availability.status === "unsupported") {
        demand.unsupportedModelCount += 1;
        demand.unsupportedAgentIds.push(uid);
      } else {
        demand.unavailableModelCount += 1;
        demand.unavailableAgentIds.push(uid);
      }
    }
    demand.connected = demand.availableModelCount > 0;
    demand.reason = !demand.configured
      ? "not_configured"
      : demand.connected
        ? "idle"
        : "not_connected";
  } catch (error) {
    demand.reason = "inspection_failed";
    demand.error = error instanceof Error ? error.message : String(error);
  }
  demand.availableAgentIds = demand.availableAgentIds.filter(Boolean).sort();
  demand.unavailableAgentIds = demand.unavailableAgentIds.filter(Boolean).sort();
  demand.unsupportedAgentIds = demand.unsupportedAgentIds.filter(Boolean).sort();
  return demand;
}

export function statusForInactiveDemand(demand = {}) {
  const reason = stringValue(demand.reason);
  if (reason === "not_configured" || reason === "not_connected" || reason === "inspection_failed") {
    return reason;
  }
  return "standby";
}

export function normalizeBackgroundRoleList(value) {
  const requested = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const known = new Set(BACKGROUND_PROCESS_DEFINITIONS.map((item) => item.role));
  const roles = requested.length
    ? requested.filter((item) => known.has(item))
    : BACKGROUND_PROCESS_DEFINITIONS.map((item) => item.role);
  return [...new Set(roles)].filter(isRoleEnabledByFeatures);
}

export function backgroundDefinitionForRole(role) {
  return [...BACKGROUND_PROCESS_DEFINITIONS, ...SERVER_PROCESS_DEFINITIONS].find((item) => item.role === role) || {
    role,
    label: role,
    description: "",
    processType: "service",
    responsibility: "",
    services: [],
    features: [],
    monitors: [],
    alerts: []
  };
}

export async function writeBackgroundProcessState(userDataPath, state) {
  const filePath = backgroundStatePath(userDataPath);
  const payload = {
    schemaVersion: BACKGROUND_PROCESS_SCHEMA_VERSION,
    updatedAt: nowIso(),
    ...state
  };
  return queueStateMutation(stateFileKey(filePath), async () => {
    await atomicWriteJson(filePath, payload);
    return payload;
  });
}

async function readStateFile(userDataPath) {
  try {
    return JSON.parse(await fs.readFile(backgroundStatePath(userDataPath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isPidAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function withRuntimeStatus(processRecord, nowMs) {
  const lastHeartbeatAt = String(processRecord.lastHeartbeatAt || "");
  const heartbeatMs = Date.parse(lastHeartbeatAt);
  const startedAtMs = Date.parse(String(processRecord.startedAt || ""));
  const withinStartupGrace =
    Number.isFinite(startedAtMs) && nowMs - startedAtMs <= 15000;
  const heartbeatAgeMs = Number.isFinite(heartbeatMs) ? Math.max(0, nowMs - heartbeatMs) : null;
  const alive = isPidAlive(processRecord.pid);
  const stale = !withinStartupGrace && (heartbeatAgeMs === null || heartbeatAgeMs > 15000);
  const desired = processRecord.desired !== false;
  let status = String(processRecord.status || "unknown");
  if (desired && (!alive || stale)) {
    status = alive ? "stale" : "stopped";
  }
  return {
    ...processRecord,
    alive,
    stale,
    status,
    heartbeatAgeMs
  };
}

function demandForRole(role, demandByRole = {}) {
  if (role === "import-worker") {
    return demandByRole.importWorker || null;
  }
  if (role === "source-watcher") {
    return demandByRole.sourceWatcher || null;
  }
  if (role === "maintenance-worker") {
    return demandByRole.maintenanceWorker || null;
  }
  if (role === "agent-worker") {
    return demandByRole.agentWorker || null;
  }
  return null;
}

function desiredForRole(role, demandByRole = {}) {
  const demand = demandForRole(role, demandByRole);
  return demand ? demand.active : true;
}

function attachDemandDetails(processRecord, role, demandByRole = {}) {
  const demand = demandForRole(role, demandByRole);
  if (!demand) {
    return processRecord;
  }
  return {
    ...processRecord,
    details: {
      ...(processRecord.details || {}),
      demand
    }
  };
}

function processRecordForDefinition(definition, existing = {}, demandByRole = {}) {
  const desired = desiredForRole(definition.role, demandByRole);
  const alive = isPidAlive(existing.pid);
  const inactiveStatus = statusForInactiveDemand(demandForRole(definition.role, demandByRole) || {});
  const status = desired
    ? String(existing.status || "missing")
    : alive
      ? String(existing.status || inactiveStatus)
      : inactiveStatus;
  return attachDemandDetails(
    {
      ...definition,
      pid: 0,
      restartCount: 0,
      ...existing,
      desired,
      status,
      pid: desired || alive ? Number(existing.pid || 0) : 0,
      stale: desired ? existing.stale : false
    },
    definition.role,
    demandByRole
  );
}

function serverMainProcess(nowMs) {
  const definition = backgroundDefinitionForRole("server-main");
  return withRuntimeStatus(
    {
      ...definition,
      desired: true,
      pid: process.pid,
      alive: true,
      stale: false,
      status: "running",
      mode: "node-service",
      startedAt: new Date(nowMs - Math.round(process.uptime() * 1000)).toISOString(),
      lastHeartbeatAt: nowIso(),
      restartCount: 0,
      lastExit: null,
      details: {
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd()
      },
      error: ""
    },
    nowMs
  );
}

function backgroundSupervisorProcess(supervisor, nowMs, stateUpdatedAt = "") {
  const definition = backgroundDefinitionForRole("background-supervisor");
  const alive = isPidAlive(supervisor?.pid);
  return withRuntimeStatus(
    {
      ...definition,
      desired: true,
      pid: Number(supervisor?.pid || 0),
      alive,
      stale: !alive,
      status: alive ? "running" : "stopped",
      mode: "node-daemon",
      startedAt: supervisor?.startedAt || "",
      lastHeartbeatAt: stateUpdatedAt || supervisor?.updatedAt || supervisor?.startedAt || "",
      restartCount: 0,
      lastExit: null,
      details: {
        intervalMs: supervisor?.intervalMs || 0,
        restartDelayMs: supervisor?.restartDelayMs || 0,
        roles: supervisor?.roles || []
      },
      error: ""
    },
    nowMs
  );
}

function attachProcessRegistration(processItem) {
  return {
    ...processItem,
    unifiedRegistration: unifiedRegistrationForProcess(processItem)
  };
}

function buildProcessSystemStatus(processes, updatedAt = "") {
  return composeUnifiedSystemStatus(
    processes.map((item) => item.unifiedRegistration || unifiedRegistrationForProcess(item)),
    {
      source: "background-process-status",
      updatedAt: updatedAt || nowIso()
    }
  );
}

export async function getBackgroundProcessStatus(userDataPath) {
  const state = await readStateFile(userDataPath);
  const nowMs = Date.now();
  const definitions = BACKGROUND_PROCESS_DEFINITIONS;
  const demandByRole = {
    importWorker: await inspectImportParseWorkerDemand(userDataPath),
    sourceWatcher: await inspectSourceWatcherDemand(userDataPath),
    maintenanceWorker: await inspectMaintenanceWorkerDemand(userDataPath),
    agentWorker: await inspectAgentWorkerDemand(userDataPath)
  };
  if (!state) {
    const supervisor = {
      pid: 0,
      alive: false,
      status: "stopped"
    };
    const processes = [
      serverMainProcess(nowMs),
      backgroundSupervisorProcess(supervisor, nowMs),
      ...definitions.map((definition) => attachDemandDetails({
        ...definition,
        desired: desiredForRole(definition.role, demandByRole),
        pid: 0,
        alive: false,
        stale: desiredForRole(definition.role, demandByRole),
        status: desiredForRole(definition.role, demandByRole)
          ? "missing"
          : statusForInactiveDemand(demandForRole(definition.role, demandByRole) || {}),
        restartCount: 0,
        heartbeatAgeMs: null
      }, definition.role, demandByRole)),
      await getSystemInspectionProcess(userDataPath, nowMs)
    ].map(attachProcessRegistration);
    return {
      schemaVersion: BACKGROUND_PROCESS_SCHEMA_VERSION,
      ok: false,
      status: "unavailable",
      updatedAt: "",
      statePath: backgroundStatePath(userDataPath),
      supervisor,
      processes,
      systemStatus: buildProcessSystemStatus(processes)
    };
  }

  const supervisor = {
    ...(state.supervisor || {}),
    alive: isPidAlive(state.supervisor?.pid),
    status: isPidAlive(state.supervisor?.pid) ? "running" : "stopped"
  };
  const byRole = new Map((state.processes || []).map((item) => [item.role, item]));
  const processes = definitions.map((definition) =>
    withRuntimeStatus(
      processRecordForDefinition(definition, byRole.get(definition.role) || {}, demandByRole),
      nowMs
    )
  );
  processes.unshift(backgroundSupervisorProcess(supervisor, nowMs, state.updatedAt || ""));
  processes.unshift(serverMainProcess(nowMs));
  processes.push(await getSystemInspectionProcess(userDataPath, nowMs));
  const registeredProcesses = processes.map(attachProcessRegistration);
  const failedCount = registeredProcesses.filter((item) =>
    item.desired && !["running", "standby"].includes(item.status)
  ).length;
  return {
    ...state,
    ok: supervisor.alive && failedCount === 0,
    status: supervisor.alive
      ? failedCount === 0
        ? "healthy"
        : "degraded"
      : "supervisor_stopped",
    statePath: backgroundStatePath(userDataPath),
    supervisor,
    processes: registeredProcesses,
    systemStatus: buildProcessSystemStatus(registeredProcesses, state.updatedAt || "")
  };
}

async function getSystemInspectionProcess(userDataPath, nowMs) {
  let state = null;
  try {
    state = JSON.parse(await fs.readFile(systemInspectionStatePath(userDataPath), "utf8"));
  } catch {
    state = null;
  }
  const daemon = state?.inspectionDaemon || {};
  const definition = backgroundDefinitionForRole("system-inspection");
  return withRuntimeStatus(
    {
      ...definition,
      role: "system-inspection",
      desired: true,
      pid: Number(daemon.pid || 0),
      status: state ? "running" : "missing",
      mode: "system-js",
      startedAt: "",
      lastHeartbeatAt: state?.updatedAt || "",
      restartCount: 0,
      lastExit: null,
      details: {
        alertStatus: state?.status || "unknown",
        activeCount: state?.summary?.activeCount || 0,
        criticalCount: state?.summary?.criticalCount || 0,
        warningCount: state?.summary?.warningCount || 0,
        shellConfigPath: state?.shellConfigPath || "",
        statePath: state?.statePath || systemInspectionStatePath(userDataPath)
      },
      error: ""
    },
    nowMs
  );
}
