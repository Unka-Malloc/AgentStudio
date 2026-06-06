import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { getBackgroundProcessStatus } from "../process-status/background-process-status.mjs";
import {
  composeUnifiedSystemStatus,
  unifiedRegistrationForAlert,
  unifiedRegistrationForMonitor
} from "../unified-registration-core/unified-registration.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../../../../config/default-monitor-alerts.json");
const ALERT_DIR = "background";
const ALERT_CONFIG_FILE = "monitor-alerts.json";
const ALERT_SHELL_CONFIG_FILE = "monitor-alerts.sh.conf";
const ALERT_STATE_FILE = "monitor-alerts-state.json";
const DEFAULT_SERVICE_LABEL = "dev.pact.background-supervisor";

function nowIso() {
  return new Date().toISOString();
}

export function monitorAlertConfigPath(userDataPath) {
  return path.join(userDataPath, ALERT_DIR, ALERT_CONFIG_FILE);
}

export function monitorAlertShellConfigPath(userDataPath) {
  return path.join(userDataPath, ALERT_DIR, ALERT_SHELL_CONFIG_FILE);
}

export function monitorAlertStatePath(userDataPath) {
  return path.join(userDataPath, ALERT_DIR, ALERT_STATE_FILE);
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value === true || value === "true" || value === "1" || value === "yes";
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function normalizeRule(input = {}, fallback = {}) {
  return {
    ...fallback,
    ...input,
    enabled: normalizeBoolean(input.enabled, fallback.enabled !== false),
    severity: String(input.severity || fallback.severity || "warning").trim() || "warning",
    statuses: normalizeStringArray(input.statuses || fallback.statuses),
    restartCountThreshold: normalizeInteger(
      input.restartCountThreshold ?? fallback.restartCountThreshold,
      Number(fallback.restartCountThreshold || 1),
      1,
      100000
    ),
    titleTemplate: String(input.titleTemplate || fallback.titleTemplate || "{{label}} 告警"),
    messageTemplate: String(input.messageTemplate || fallback.messageTemplate || "{{label}} {{status}}")
  };
}

function normalizeSupervisorRecovery(input = {}, fallback = {}) {
  return {
    ...fallback,
    ...input,
    enabled: normalizeBoolean(input.enabled, fallback.enabled !== false),
    cooldownMs: normalizeInteger(input.cooldownMs ?? fallback.cooldownMs, 30000, 1000, 3600000),
    startupWaitMs: normalizeInteger(input.startupWaitMs ?? fallback.startupWaitMs, 1200, 0, 60000),
    plistPath: String(input.plistPath || fallback.plistPath || "").trim()
  };
}

export async function loadMonitorAlertConfig(userDataPath) {
  const defaults = asObject(await readJsonIfExists(DEFAULT_CONFIG_PATH, {}));
  const override = asObject(await readJsonIfExists(monitorAlertConfigPath(userDataPath), {}));
  const defaultRules = asObject(defaults.rules);
  const overrideRules = asObject(override.rules);
  const ruleIds = [...new Set([...Object.keys(defaultRules), ...Object.keys(overrideRules)])];
  const rules = {};
  for (const ruleId of ruleIds) {
    rules[ruleId] = normalizeRule(asObject(overrideRules[ruleId]), asObject(defaultRules[ruleId]));
  }
  return {
    ...defaults,
    ...override,
    schemaVersion: 1,
    enabled: normalizeBoolean(override.enabled, defaults.enabled !== false),
    intervalMs: normalizeInteger(override.intervalMs ?? defaults.intervalMs, 5000, 1000, 600000),
    heartbeatStaleMs: normalizeInteger(
      override.heartbeatStaleMs ?? defaults.heartbeatStaleMs,
      15000,
      1000,
      600000
    ),
    queueHeartbeatStaleMs: normalizeInteger(
      override.queueHeartbeatStaleMs ?? defaults.queueHeartbeatStaleMs,
      60000,
      5000,
      3600000
    ),
    recoverInterruptedQueues: normalizeBoolean(
      override.recoverInterruptedQueues,
      defaults.recoverInterruptedQueues !== false
    ),
    historyLimit: normalizeInteger(override.historyLimit ?? defaults.historyLimit, 200, 10, 5000),
    serviceLabel: String(override.serviceLabel || defaults.serviceLabel || DEFAULT_SERVICE_LABEL),
    supervisorRecovery: normalizeSupervisorRecovery(
      asObject(override.supervisorRecovery),
      asObject(defaults.supervisorRecovery)
    ),
    rules
  };
}

export async function saveMonitorAlertConfig(userDataPath, input = {}) {
  const config = await normalizeMonitorAlertConfig(input);
  await atomicWriteJson(monitorAlertConfigPath(userDataPath), config);
  await writeMonitorAlertShellConfig(userDataPath, config);
  return config;
}

async function normalizeMonitorAlertConfig(input = {}) {
  const defaults = await readJsonIfExists(DEFAULT_CONFIG_PATH, {});
  const merged = {
    ...asObject(defaults),
    ...asObject(input),
    rules: {
      ...asObject(defaults.rules),
      ...asObject(input.rules)
    }
  };
  const ruleIds = Object.keys(asObject(merged.rules));
  const rules = {};
  for (const ruleId of ruleIds) {
    rules[ruleId] = normalizeRule(asObject(merged.rules[ruleId]), asObject(defaults.rules?.[ruleId]));
  }
  return {
    schemaVersion: 1,
    enabled: normalizeBoolean(merged.enabled, true),
    intervalMs: normalizeInteger(merged.intervalMs, 5000, 1000, 600000),
    heartbeatStaleMs: normalizeInteger(merged.heartbeatStaleMs, 15000, 1000, 600000),
    queueHeartbeatStaleMs: normalizeInteger(merged.queueHeartbeatStaleMs, 60000, 5000, 3600000),
    recoverInterruptedQueues: normalizeBoolean(merged.recoverInterruptedQueues, true),
    supervisorRecovery: normalizeSupervisorRecovery(
      asObject(merged.supervisorRecovery),
      asObject(defaults.supervisorRecovery)
    ),
    historyLimit: normalizeInteger(merged.historyLimit, 200, 10, 5000),
    serviceLabel: String(merged.serviceLabel || DEFAULT_SERVICE_LABEL),
    rules
  };
}

function renderTemplate(template, variables = {}) {
  return String(template || "").replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null || value === "" ? "—" : String(value);
  });
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

async function writeMonitorAlertShellConfig(userDataPath, config) {
  const rule = config.rules?.processNotRunning || {};
  const payload = [
    `ALERTS_ENABLED=${config.enabled ? "1" : "0"}`,
    `INTERVAL_SECONDS=${Math.max(1, Math.round(Number(config.intervalMs || 5000) / 1000))}`,
    `HISTORY_LIMIT=${Number(config.historyLimit || 200)}`,
    `QUEUE_HEARTBEAT_STALE_SECONDS=${Math.max(5, Math.round(Number(config.queueHeartbeatStaleMs || 60000) / 1000))}`,
    `RECOVER_INTERRUPTED_QUEUES=${config.recoverInterruptedQueues === false ? "0" : "1"}`,
    `SERVICE_LABEL=${shellQuote(config.serviceLabel || DEFAULT_SERVICE_LABEL)}`,
    `PROCESS_NOT_RUNNING_ENABLED=${rule.enabled === false ? "0" : "1"}`,
    `PROCESS_NOT_RUNNING_SEVERITY=${shellQuote(rule.severity || "critical")}`,
    `PROCESS_NOT_RUNNING_TITLE_TEMPLATE=${shellQuote(rule.titleTemplate || "{{label}} 未正常运行")}`,
    `PROCESS_NOT_RUNNING_MESSAGE_TEMPLATE=${shellQuote(rule.messageTemplate || "{{label}} 当前状态为 {{status}}，PID {{pid}}。")}`,
    ""
  ].join("\n");
  const filePath = monitorAlertShellConfigPath(userDataPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, payload, "utf8");
}

function buildAlert({ alertId, ruleId, rule, variables, active = true, extra = {} }) {
  return {
    alertId,
    ruleId,
    severity: rule.severity,
    title: renderTemplate(rule.titleTemplate, variables),
    message: renderTemplate(rule.messageTemplate, variables),
    source: variables.source || "",
    role: variables.role || "",
    status: variables.status || "",
    active,
    firstSeenAt: nowIso(),
    lastSeenAt: nowIso(),
    variables,
    ...extra
  };
}

function normalizeLegacyAlertText(value) {
  let normalized = String(value || "")
    .replaceAll("后台进程守护器", "后台 Worker 管理进程")
    .replaceAll("后台守护进程", "后台 Worker 管理进程")
    .replaceAll("维护任务 Worker", "智能巡检 Worker")
    .replaceAll("智能体 Worker 未正常运行", "智能体未配置或未接通")
    .replaceAll("维护任务队列", "智能巡检队列")
    .replaceAll("维护任务和智能巡检", "智能巡检")
    .replaceAll("已被守护进程重启", "已由后台 Worker 管理进程重启")
    .replaceAll("工作队列", "任务队列");
  normalized = normalized.replace(
    /智能体 Worker 当前状态为 (?:missing|stopped|stale|failed|exited).*?[。.]/g,
    "智能体模型库未配置或未接通，请在智能体仓库配置并探测可用模型。"
  );
  const supervisorMessage = normalized.match(
    /^后台 Worker 管理进程未运行[，,]\s*PID\s+(.+?)[。.]请检查 launchd 服务\s+(.+?)[。.]$/
  );
  if (supervisorMessage) {
    normalized =
      `后台 Worker 管理进程未运行，PID ${supervisorMessage[1]}。` +
      `它负责拉起和管理导入解析、目录同步、智能巡检和智能体 Worker；请检查 launchd 服务 ${supervisorMessage[2]}。`;
  }
  return normalized;
}

function normalizeLegacyAlertCopy(value) {
  if (typeof value === "string") {
    return normalizeLegacyAlertText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyAlertCopy(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeLegacyAlertCopy(item)])
    );
  }
  return value;
}

function attachAlertRegistration(alert) {
  return {
    ...alert,
    unifiedRegistration: unifiedRegistrationForAlert(alert)
  };
}

function attachAlertRegistrations(alerts = []) {
  return alerts.map(attachAlertRegistration);
}

async function loadState(userDataPath) {
  const state = await readJsonIfExists(monitorAlertStatePath(userDataPath), {});
  return asObject(normalizeLegacyAlertCopy(state));
}

function existingSystemRegistrations(state, originalType) {
  return (Array.isArray(state?.systemStatus?.registrations) ? state.systemStatus.registrations : [])
    .filter((registration) => registration?.originalType === originalType);
}

function buildMonitorSystemStatus({
  backgroundStatus = null,
  queueMonitor = null,
  state = {},
  activeAlerts = [],
  history = [],
  config = {},
  updatedAt = ""
} = {}) {
  const registrations = [
    ...(backgroundStatus?.processes || []).map((item) => item.unifiedRegistration),
    ...(backgroundStatus ? [] : existingSystemRegistrations(state, "process")),
    ...(queueMonitor?.items || []).map((item) => item.unifiedRegistration),
    ...(queueMonitor ? [] : existingSystemRegistrations(state, "queue")),
    ...existingSystemRegistrations(state, "task"),
    unifiedRegistrationForMonitor({
      monitorId: "monitor-alerts",
      label: "监控报警",
      source: "system-inspection",
      status: state.status || (config.enabled === false ? "disabled" : "unknown"),
      ok: state.ok !== false,
      updatedAt: updatedAt || state.updatedAt || nowIso(),
      statePath: state.statePath || "",
      configPath: state.configPath || "",
      summary: state.summary || {},
      features: ["运维监控", "报警"],
      monitors: ["后台进程状态", "任务队列闭环", "中断恢复"],
      alerts: Object.keys(config.rules || {})
    }),
    ...activeAlerts.map((alert) => alert.unifiedRegistration || unifiedRegistrationForAlert(alert)),
    ...history
      .filter((alert) => alert.active === false && alert.ackRequired)
      .map((alert) => alert.unifiedRegistration || unifiedRegistrationForAlert(alert))
  ].filter(Boolean);
  return composeUnifiedSystemStatus(registrations, {
    source: "monitor-alerts",
    updatedAt: updatedAt || state.updatedAt || nowIso()
  });
}

function mergeAlertHistory({ previous = {}, activeAlerts = [], limit }) {
  const acknowledgedAlerts = asObject(previous.acknowledgedAlerts);
  const visibleAlerts = activeAlerts.filter((alert) => {
    if (alert?.ackRequired && acknowledgedAlerts[alert.alertId]) {
      return false;
    }
    return true;
  });
  const previousById = new Map((previous.activeAlerts || []).map((alert) => [alert.alertId, alert]));
  const active = visibleAlerts.map((alert) => {
    const previousAlert = previousById.get(alert.alertId);
    return {
      ...alert,
      firstSeenAt: previousAlert?.firstSeenAt || alert.firstSeenAt,
      acknowledgedAt: alert.ackRequired ? previousAlert?.acknowledgedAt || "" : "",
      lastSeenAt: nowIso()
    };
  });
  const activeIds = new Set(active.map((alert) => alert.alertId));
  const resolved = (previous.activeAlerts || [])
    .filter((alert) => !activeIds.has(alert.alertId))
    .map((alert) => ({
      ...alert,
      active: false,
      resolvedAt: nowIso()
    }));
  const cycleIds = new Set([
    ...active.map((alert) => alert.alertId),
    ...resolved.map((alert) => alert.alertId)
  ]);
  const retainedHistory = dedupeAlertHistory(Array.isArray(previous.history) ? previous.history : [])
    .filter((alert) => !cycleIds.has(alert.alertId));
  const history = [
    ...active,
    ...resolved,
    ...retainedHistory
  ].slice(0, limit);
  return { active, history, acknowledgedAlerts };
}

function dedupeAlertHistory(history = []) {
  const seen = new Set();
  return history.filter((alert) => {
    const key = String(alert.alertId || "");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function queueAlertId(queueId) {
  return `monitor.queue.${queueId}.interrupted`;
}

function queueAlertVariables(item) {
  const evidence = asObject(item.evidence);
  return {
    source: "queue-monitor",
    role: item.kind || "queue",
    queueId: item.queueId || "",
    queueLabel: item.label || item.queueId || "",
    queueKind: item.kind || "",
    ownerId: item.ownerId || "",
    status: item.lifecycleStatus === "recovered" ? "recovered" : "interrupted",
    phase: item.phase || "",
    interruptedReason: item.interruptedReason || "",
    interruptedAt: item.interruptedAt || "",
    recoveredAt: item.recoveredAt || "",
    recoveryStatus: item.recoveryStatus || "",
    recoveryAttemptedAt: item.recoveryAttemptedAt || "",
    checkpointTreeId: item.checkpointTreeId || evidence.checkpointTreeId || "",
    checkpointStatus: evidence.checkpointStatus || "",
    evidenceUpdatedAt: evidence.evidenceUpdatedAt || "",
    eventLogPath: evidence.eventLogPath || ""
  };
}

function evaluateQueueAlerts({ queueMonitor, config }) {
  if (!config.enabled || !queueMonitor) {
    return [];
  }
  const alerts = [];
  const rule = config.rules?.queueInterrupted || {};
  if (!rule.enabled) {
    return alerts;
  }
  const seenQueueIds = new Set();
  for (const item of queueMonitor.items || []) {
    const queueId = String(item.queueId || "");
    if (!queueId || seenQueueIds.has(queueId)) {
      continue;
    }
    if (item.lifecycleStatus !== "interrupted" && item.lifecycleStatus !== "recovered") {
      continue;
    }
    if (item.lifecycleStatus === "recovered" && item.acknowledgedAt) {
      continue;
    }
    seenQueueIds.add(queueId);
    const recovered = item.lifecycleStatus === "recovered";
    const variables = queueAlertVariables(item);
    alerts.push(buildAlert({
      alertId: queueAlertId(queueId),
      ruleId: "queueInterrupted",
      rule: recovered
        ? {
            ...rule,
            severity: "info",
            titleTemplate: "{{queueLabel}} 已恢复",
            messageTemplate:
              "{{queueLabel}} 的中断状态已恢复，恢复状态 {{recoveryStatus}}。确认后可关闭此信息。"
          }
        : rule,
      variables,
      active: !recovered,
      extra: {
        queueId,
        ackRequired: recovered,
        recoveredAt: item.recoveredAt || "",
        interruptedAt: item.interruptedAt || "",
        evidence: item.evidence || {},
        tone: recovered ? "success" : ""
      }
    }));
  }
  return alerts;
}

function evaluateAlerts({ backgroundStatus, queueMonitor, config }) {
  if (!config.enabled) {
    return [];
  }
  const alerts = [];
  const rules = config.rules || {};
  const supervisorRule = rules.supervisorStopped || {};
  if (supervisorRule.enabled && !backgroundStatus.supervisor?.alive) {
    alerts.push(buildAlert({
      alertId: "monitor.supervisor.stopped",
      ruleId: "supervisorStopped",
      rule: supervisorRule,
      variables: {
        source: "supervisor",
        status: backgroundStatus.supervisor?.status || "stopped",
        pid: backgroundStatus.supervisor?.pid || "",
        serviceLabel: config.serviceLabel || DEFAULT_SERVICE_LABEL
      }
    }));
  }
  for (const processItem of backgroundStatus.processes || []) {
    if (processItem.role === "background-supervisor" && supervisorRule.enabled) {
      continue;
    }
    if (processItem.desired === false) {
      continue;
    }
    const variables = {
      source: "background-process",
      role: processItem.role,
      label: processItem.label || processItem.role,
      description: processItem.description || "",
      status: processItem.status || "",
      mode: processItem.mode || "",
      pid: processItem.pid || "",
      restartCount: processItem.restartCount || 0,
      lastHeartbeatAt: processItem.lastHeartbeatAt || "",
      heartbeatAgeMs: processItem.heartbeatAgeMs ?? "",
      heartbeatAgeSeconds:
        processItem.heartbeatAgeMs === null || processItem.heartbeatAgeMs === undefined
          ? ""
          : Math.round(Number(processItem.heartbeatAgeMs || 0) / 1000)
    };
    const notRunningRule = rules.processNotRunning || {};
    if (
      notRunningRule.enabled &&
      normalizeStringArray(notRunningRule.statuses).includes(processItem.status)
    ) {
      alerts.push(buildAlert({
        alertId: `monitor.process.${processItem.role}.not_running`,
        ruleId: "processNotRunning",
        rule: notRunningRule,
        variables
      }));
    }
    const staleRule = rules.processStale || {};
    if (
      staleRule.enabled &&
      normalizeStringArray(staleRule.statuses).includes(processItem.status)
    ) {
      alerts.push(buildAlert({
        alertId: `monitor.process.${processItem.role}.stale`,
        ruleId: "processStale",
        rule: staleRule,
        variables
      }));
    }
    const restartedRule = rules.processRestarted || {};
    if (
      restartedRule.enabled &&
      Number(processItem.restartCount || 0) >= Number(restartedRule.restartCountThreshold || 1)
    ) {
      alerts.push(buildAlert({
        alertId: `monitor.process.${processItem.role}.restarted`,
        ruleId: "processRestarted",
        rule: restartedRule,
        variables
      }));
    }
  }
  alerts.push(...evaluateQueueAlerts({ queueMonitor, config }));
  return alerts;
}

export async function runMonitorAlertCycle(userDataPath, options = {}) {
  const config = await loadMonitorAlertConfig(userDataPath);
  const backgroundStatus = await getBackgroundProcessStatus(userDataPath);
  if (options.inspectionDaemon && Array.isArray(backgroundStatus.processes)) {
    backgroundStatus.processes = backgroundStatus.processes.map((item) =>
      item.role === "system-inspection"
        ? {
            ...item,
            pid: Number(options.inspectionDaemon.pid || 0),
            status: "running",
            alive: true,
            stale: false,
            lastHeartbeatAt: options.inspectionDaemon.updatedAt || nowIso(),
            heartbeatAgeMs: 0,
            details: {
              ...(item.details || {}),
              alertStatus: "running"
            }
          }
        : item
    );
  }
  const queueMonitor = typeof options.queueMonitor?.inspect === "function"
    ? await options.queueMonitor.inspect({
        heartbeatStaleMs: config.queueHeartbeatStaleMs,
        recoverInterruptedQueues: config.recoverInterruptedQueues
      })
    : null;
  const previous = await loadState(userDataPath);
  const evaluated = evaluateAlerts({ backgroundStatus, queueMonitor, config });
  const merged = mergeAlertHistory({
    previous,
    activeAlerts: evaluated,
    limit: config.historyLimit
  });
  const active = attachAlertRegistrations(merged.active);
  const history = attachAlertRegistrations(merged.history);
  const acknowledgedAlerts = merged.acknowledgedAlerts;
  const activeProblemCount = active.filter((alert) => alert.active !== false).length;
  const recoveredInfoCount = active.filter((alert) => alert.ackRequired).length;
  const state = {
    schemaVersion: 1,
    ok: activeProblemCount === 0,
    status: !config.enabled
      ? "disabled"
      : activeProblemCount === 0
        ? recoveredInfoCount > 0
          ? "recovered"
          : "healthy"
        : "alerting",
    updatedAt: nowIso(),
    configPath: monitorAlertConfigPath(userDataPath),
    shellConfigPath: monitorAlertShellConfigPath(userDataPath),
    statePath: monitorAlertStatePath(userDataPath),
    inspectionDaemon: options.inspectionDaemon || previous.inspectionDaemon || null,
    config,
    queueMonitor,
    acknowledgedAlerts,
    summary: {
      activeCount: activeProblemCount,
      visibleCount: active.length,
      recoveredCount: recoveredInfoCount,
      criticalCount: active.filter((alert) => alert.active !== false && alert.severity === "critical").length,
      warningCount: active.filter((alert) => alert.active !== false && alert.severity === "warning").length,
      historyCount: history.length
    },
    activeAlerts: active,
    history
  };
  state.systemStatus = buildMonitorSystemStatus({
    backgroundStatus,
    queueMonitor,
    state,
    activeAlerts: active,
    history,
    config,
    updatedAt: state.updatedAt
  });
  await atomicWriteJson(monitorAlertStatePath(userDataPath), state);
  return state;
}

export async function acknowledgeMonitorAlert(userDataPath, alertId, options = {}) {
  const normalizedAlertId = String(alertId || "").trim();
  if (!normalizedAlertId) {
    throw new Error("缺少报警 ID。");
  }
  if (typeof options.queueMonitor?.acknowledge === "function") {
    await options.queueMonitor.acknowledge(normalizedAlertId);
  }
  const state = await loadState(userDataPath);
  const acknowledgedAt = nowIso();
  const acknowledgedAlerts = {
    ...asObject(state.acknowledgedAlerts),
    [normalizedAlertId]: acknowledgedAt
  };
  const activeAlerts = attachAlertRegistrations(
    (Array.isArray(state.activeAlerts) ? state.activeAlerts : [])
      .filter((alert) => !(alert.alertId === normalizedAlertId && alert.ackRequired))
  );
  const history = attachAlertRegistrations(dedupeAlertHistory([
    ...(Array.isArray(state.history) ? state.history : []).map((alert) =>
      alert.alertId === normalizedAlertId
        ? {
            ...alert,
            acknowledgedAt,
            active: false
        }
        : alert
    )
  ]));
  const nextState = {
    ...state,
    acknowledgedAlerts,
    activeAlerts,
    history,
    updatedAt: acknowledgedAt,
    summary: {
      ...(state.summary || {}),
      activeCount: activeAlerts.filter((alert) => alert.active !== false).length,
      visibleCount: activeAlerts.length,
      recoveredCount: activeAlerts.filter((alert) => alert.ackRequired).length,
      criticalCount: activeAlerts.filter((alert) => alert.active !== false && alert.severity === "critical").length,
      warningCount: activeAlerts.filter((alert) => alert.active !== false && alert.severity === "warning").length,
      historyCount: history.length
    }
  };
  nextState.ok = nextState.summary.activeCount === 0;
  nextState.status = nextState.summary.activeCount > 0
    ? "alerting"
    : nextState.summary.recoveredCount > 0
      ? "recovered"
      : "healthy";
  nextState.systemStatus = buildMonitorSystemStatus({
    state: nextState,
    activeAlerts,
    history,
    config: nextState.config || {},
    updatedAt: acknowledgedAt
  });
  await atomicWriteJson(monitorAlertStatePath(userDataPath), nextState);
  return nextState;
}

export async function getMonitorAlertState(userDataPath, options = {}) {
  if (options.refresh !== false) {
    return runMonitorAlertCycle(userDataPath, options);
  }
  const config = await loadMonitorAlertConfig(userDataPath);
  const state = await loadState(userDataPath);
  const activeAlerts = attachAlertRegistrations(Array.isArray(state.activeAlerts) ? state.activeAlerts : []);
  const history = attachAlertRegistrations(dedupeAlertHistory(Array.isArray(state.history) ? state.history : []));
  const result = {
    schemaVersion: 1,
    ok: state.ok !== false,
    status: state.status || (config.enabled ? "unknown" : "disabled"),
    updatedAt: state.updatedAt || "",
    configPath: monitorAlertConfigPath(userDataPath),
    shellConfigPath: state.shellConfigPath || monitorAlertShellConfigPath(userDataPath),
    statePath: monitorAlertStatePath(userDataPath),
    config,
    queueMonitor: state.queueMonitor || null,
    acknowledgedAlerts: asObject(state.acknowledgedAlerts),
    summary: state.summary || {
      activeCount: 0,
      visibleCount: 0,
      recoveredCount: 0,
      criticalCount: 0,
      warningCount: 0,
      historyCount: 0
    },
    activeAlerts,
    history
  };
  result.systemStatus = state.systemStatus || buildMonitorSystemStatus({
    state: result,
    activeAlerts,
    history,
    config,
    updatedAt: result.updatedAt
  });
  return result;
}
