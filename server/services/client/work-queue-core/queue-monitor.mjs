import fs from "node:fs/promises";
import path from "node:path";
import {
  appendJsonLine,
  atomicWriteJson,
  atomicWriteJsonThroughState,
  queueStateMutation,
  readJsonFile,
  stateFileKey
} from "../../../platform/interactive/product-api.mjs";
import {
  checkpointTreeId,
  loadCheckpointTree,
  upsertCheckpointNode
} from "../../../platform/interactive/product-api.mjs";
import {
  composeUnifiedSystemStatus,
  unifiedRegistrationForQueue
} from "../../../platform/interactive/product-api.mjs";
import { serverToken } from "../../../platform/interactive/product-api.mjs";

const QUEUE_MONITOR_SCHEMA_VERSION = "v0.0.1:workflow:queue-monitor-schema-1";
const DEFAULT_QUEUE_STALE_MS = 60000;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "canceled", "cancelled", "deleted"]);
const RECOVERY_STAGE_MESSAGE = "队列中断后等待后台 worker 恢复。";

function nowIso() {
  return new Date().toISOString();
}

function toMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxIso(...values) {
  const best = values
    .map((value) => ({ value: String(value || ""), ms: toMs(value) }))
    .filter((item) => item.ms > 0)
    .sort((left, right) => right.ms - left.ms)[0];
  return best?.value || "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSources(value, fallback = []) {
  return [
    ...new Set(
      [
        ...(Array.isArray(value) ? value : []),
        ...fallback
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ];
}

function backgroundDir(userDataPath) {
  return path.join(userDataPath, "background");
}

export function queueMonitorStatePath(userDataPath) {
  return path.join(backgroundDir(userDataPath), "queue-monitor-state.json");
}

export function queueMonitorEventLogPath(userDataPath) {
  return path.join(backgroundDir(userDataPath), "queue-monitor-events.jsonl");
}

function jobsRootPath(userDataPath) {
  return path.join(userDataPath, "jobs");
}

function jobMetaPath(userDataPath, jobId) {
  return path.join(jobsRootPath(userDataPath), String(jobId || ""), "meta.json");
}

function jobPayloadPath(userDataPath, jobId) {
  return path.join(jobsRootPath(userDataPath), String(jobId || ""), "payload.json");
}

export function queueMonitorId(kind, ownerId) {
  return serverToken("queue_item", kind, ownerId);
}

function normalizeQueueInput(input = {}) {
  const kind = String(input.kind || "import_parse_job").trim() || "import_parse_job";
  const ownerId = String(input.ownerId || input.jobId || "").trim();
  const queueId = String(input.queueId || "").trim() || queueMonitorId(kind, ownerId);
  return {
    ...input,
    queueId,
    kind,
    ownerId
  };
}

function emptyState() {
  return {
    schemaVersion: QUEUE_MONITOR_SCHEMA_VERSION,
    updatedAt: nowIso(),
    statePath: "",
    eventLogPath: "",
    items: {}
  };
}

function normalizeState(raw, userDataPath) {
  return {
    ...emptyState(),
    ...asObject(raw),
    schemaVersion: QUEUE_MONITOR_SCHEMA_VERSION,
    statePath: queueMonitorStatePath(userDataPath),
    eventLogPath: queueMonitorEventLogPath(userDataPath),
    items: asObject(raw?.items)
  };
}

async function loadState(userDataPath) {
  return normalizeState(
    await readJsonFile(queueMonitorStatePath(userDataPath), {}),
    userDataPath
  );
}

async function appendQueueMonitorEvent(userDataPath, event) {
  await appendJsonLine(queueMonitorEventLogPath(userDataPath), {
    eventId: serverToken("queue_monitor_event", Date.now(), Math.random()),
    at: nowIso(),
    ...event
  });
}

async function mutateQueueMonitorState(userDataPath, mutator, event = null) {
  const filePath = queueMonitorStatePath(userDataPath);
  return queueStateMutation(stateFileKey(filePath), async () => {
    const state = await loadState(userDataPath);
    const result = await mutator(state);
    state.updatedAt = nowIso();
    await atomicWriteJson(filePath, state);
    if (event) {
      await appendQueueMonitorEvent(userDataPath, event);
    }
    return result === undefined ? state : result;
  });
}

function queueItemFromInput(input = {}, existing = {}) {
  const normalized = normalizeQueueInput(input);
  const timestamp = nowIso();
  const metadata = {
    ...asObject(existing.metadata),
    ...asObject(input.metadata)
  };
  return {
    ...existing,
    queueId: normalized.queueId,
    kind: normalized.kind,
    ownerId: normalized.ownerId,
    label: String(input.label || existing.label || normalized.ownerId || normalized.queueId),
    source: String(input.source || existing.source || "function-self-check"),
    sources: normalizeSources(existing.sources, [input.source || "function-self-check"]),
    lifecycleStatus:
      existing.lifecycleStatus === "interrupted"
        ? "interrupted"
        : existing.lifecycleStatus === "recovered" && !existing.acknowledgedAt
          ? "recovered"
          : "open",
    phase: String(input.phase || existing.phase || "queued"),
    status: String(input.status || existing.status || "queued"),
    startedAt: existing.startedAt || input.startedAt || timestamp,
    closedAt: "",
    lastHeartbeatAt: input.lastHeartbeatAt || existing.lastHeartbeatAt || timestamp,
    checkpointId: String(input.checkpointId || existing.checkpointId || ""),
    checkpointTreeId: String(input.checkpointTreeId || existing.checkpointTreeId || ""),
    lastCheckpointAt: input.lastCheckpointAt || existing.lastCheckpointAt || "",
    recoveryAttemptedAt: existing.recoveryAttemptedAt || "",
    recoveryQueuedAt: existing.recoveryQueuedAt || "",
    recoveredAt: existing.recoveredAt || "",
    interruptedAt: existing.interruptedAt || "",
    interruptedReason: existing.interruptedReason || "",
    acknowledgedAt: existing.acknowledgedAt || "",
    metadata
  };
}

export async function registerQueueStarted(userDataPath, input = {}) {
  const normalized = normalizeQueueInput(input);
  return mutateQueueMonitorState(
    userDataPath,
    (state) => {
      const existing = asObject(state.items[normalized.queueId]);
      const item = queueItemFromInput(normalized, existing);
      state.items[normalized.queueId] = item;
      return item;
    },
    {
      type: "queue.started",
      queueId: normalized.queueId,
      kind: normalized.kind,
      ownerId: normalized.ownerId,
      source: input.source || "function-self-check"
    }
  );
}

export async function registerQueueHeartbeat(userDataPath, input = {}) {
  const normalized = normalizeQueueInput(input);
  return mutateQueueMonitorState(
    userDataPath,
    (state) => {
      const existing = asObject(state.items[normalized.queueId]);
      const timestamp = input.lastHeartbeatAt || nowIso();
      const item = queueItemFromInput(
        {
          ...normalized,
          lastHeartbeatAt: timestamp
        },
        existing
      );
      item.phase = String(input.phase || item.phase || "running");
      item.status = String(input.status || item.status || item.phase);
      item.lastHeartbeatAt = timestamp;
      item.lastCheckpointAt = input.lastCheckpointAt || item.lastCheckpointAt || "";
      item.sources = normalizeSources(item.sources, [input.source || "function-self-check"]);
      if (existing.lifecycleStatus === "interrupted") {
        item.lifecycleStatus = "recovered";
        item.recoveredAt = item.recoveredAt || timestamp;
      }
      state.items[normalized.queueId] = item;
      return item;
    },
    {
      type: "queue.heartbeat",
      queueId: normalized.queueId,
      kind: normalized.kind,
      ownerId: normalized.ownerId,
      phase: input.phase || "",
      source: input.source || "function-self-check"
    }
  );
}

export async function registerQueueClosed(userDataPath, input = {}) {
  const normalized = normalizeQueueInput(input);
  return mutateQueueMonitorState(
    userDataPath,
    (state) => {
      const existing = asObject(state.items[normalized.queueId]);
      const timestamp = input.closedAt || nowIso();
      const item = queueItemFromInput(normalized, existing);
      item.status = String(input.status || "closed");
      item.phase = "closed";
      item.closedAt = timestamp;
      item.lastHeartbeatAt = timestamp;
      item.sources = normalizeSources(item.sources, [input.source || "function-self-check"]);
      if (existing.lifecycleStatus === "interrupted" || existing.lifecycleStatus === "recovered") {
        item.lifecycleStatus = "recovered";
        item.recoveredAt = item.recoveredAt || timestamp;
      } else {
        item.lifecycleStatus = "closed";
      }
      state.items[normalized.queueId] = item;
      return item;
    },
    {
      type: "queue.closed",
      queueId: normalized.queueId,
      kind: normalized.kind,
      ownerId: normalized.ownerId,
      status: input.status || "closed",
      source: input.source || "function-self-check"
    }
  );
}

async function listPersistedJobs(userDataPath) {
  const rootPath = jobsRootPath(userDataPath);
  await fs.mkdir(rootPath, { recursive: true });
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const job = JSON.parse(await fs.readFile(jobMetaPath(userDataPath, entry.name), "utf8"));
      if (job?.id) {
        jobs.push(job);
      }
    } catch {
      // Ignore malformed job metadata during watchdog scans.
    }
  }
  return jobs;
}

async function payloadExists(userDataPath, jobId) {
  try {
    await fs.access(jobPayloadPath(userDataPath, jobId));
    return true;
  } catch {
    return false;
  }
}

async function loadJobCheckpoint({ userDataPath, job }) {
  const treeId = job?.checkpointTreeId || (job?.id ? checkpointTreeId("job", job.id) : "");
  if (!treeId) {
    return null;
  }
  return loadCheckpointTree({ userDataPath, treeId }).catch(() => null);
}

async function ensureJobQueueId(userDataPath, job) {
  const queueId = job.queueId || queueMonitorId("import_parse_job", job.id);
  if (job.queueId === queueId) {
    return queueId;
  }
  await atomicWriteJsonThroughState(
    jobMetaPath(userDataPath, job.id),
    {
      ...job,
      queueId,
      updatedAt: job.updatedAt || nowIso()
    },
    {
      trailingNewline: false,
      kind: "queue_monitor.job.queue_id.write",
      metadata: { jobId: job.id, queueId }
    }
  );
  job.queueId = queueId;
  return queueId;
}

async function recoverInterruptedJob({ userDataPath, job, item, now }) {
  if (!job?.id || !ACTIVE_JOB_STATUSES.has(String(job.status || ""))) {
    return {
      ok: false,
      reason: "job_not_active"
    };
  }
  if (!(await payloadExists(userDataPath, job.id))) {
    return {
      ok: false,
      reason: "missing_payload"
    };
  }
  const nextJob = {
    ...job,
    queueId: item.queueId,
    status: "queued",
    stage: RECOVERY_STAGE_MESSAGE,
    error: "",
    finishedAt: undefined,
    updatedAt: now
  };
  await atomicWriteJsonThroughState(jobMetaPath(userDataPath, job.id), nextJob, {
    trailingNewline: false,
    kind: "queue_monitor.job.recovery.write",
    metadata: { jobId: job.id, queueId: item.queueId }
  });
  if (job.checkpointTreeId) {
    await upsertCheckpointNode({
      userDataPath,
      treeId: job.checkpointTreeId,
      nodeId: "queue-recovery",
      parentId: "import-parse-job",
      label: RECOVERY_STAGE_MESSAGE,
      status: "running",
      cursor: {
        previousStatus: job.status,
        nextStatus: "queued",
        queueId: item.queueId
      },
      metadata: {
        interruptedAt: item.interruptedAt || "",
        recoveryAttemptedAt: now
      }
    }).catch(() => null);
  }
  return {
    ok: true,
    reason: "queued_for_recovery"
  };
}

function markInterrupted(item, { reason, now, evidence }) {
  item.lifecycleStatus = "interrupted";
  item.status = "interrupted";
  item.phase = item.phase || "running";
  item.interruptedAt = item.interruptedAt || now;
  item.interruptedReason = reason;
  item.evidence = evidence;
  item.sources = normalizeSources(item.sources, ["watchdog"]);
}

function markRecovered(item, { now, reason }) {
  item.lifecycleStatus = "recovered";
  item.status = "recovered";
  item.phase = "recovered";
  item.recoveredAt = item.recoveredAt || now;
  item.recoveryStatus = reason || item.recoveryStatus || "recovered";
}

function queueEvidence({ item, job, checkpoint, eventLogPath }) {
  return {
    queueStatePath: item.statePath || "",
    eventLogPath,
    jobId: job?.id || item.ownerId || "",
    jobStatus: job?.status || "",
    jobUpdatedAt: job?.updatedAt || "",
    checkpointTreeId: checkpoint?.treeId || item.checkpointTreeId || "",
    checkpointStatus: checkpoint?.status || "",
    checkpointUpdatedAt: checkpoint?.updatedAt || "",
    lastHeartbeatAt: item.lastHeartbeatAt || "",
    evidenceUpdatedAt: maxIso(item.lastHeartbeatAt, job?.updatedAt, checkpoint?.updatedAt)
  };
}

function attachQueueRegistration(item) {
  return {
    ...item,
    unifiedRegistration: unifiedRegistrationForQueue(item)
  };
}

function queueMonitorSummary(items) {
  return {
    totalCount: items.length,
    openCount: items.filter((item) => item.lifecycleStatus === "open").length,
    interruptedCount: items.filter((item) => item.lifecycleStatus === "interrupted").length,
    recoveredCount: items.filter((item) => item.lifecycleStatus === "recovered" && !item.acknowledgedAt).length,
    closedCount: items.filter((item) => item.lifecycleStatus === "closed").length
  };
}

function buildQueueSystemStatus(items, updatedAt = "") {
  return composeUnifiedSystemStatus(
    items.map((item) => item.unifiedRegistration || unifiedRegistrationForQueue(item)),
    {
      source: "queue-monitor",
      updatedAt: updatedAt || nowIso()
    }
  );
}

export async function inspectQueueMonitor({
  userDataPath,
  heartbeatStaleMs = DEFAULT_QUEUE_STALE_MS,
  recoverInterruptedQueues = true
} = {}) {
  const jobs = await listPersistedJobs(userDataPath);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const checkpointByJobId = new Map();
  for (const job of jobs) {
    checkpointByJobId.set(job.id, await loadJobCheckpoint({ userDataPath, job }));
  }
  const safeStaleMs = Math.max(1000, Number(heartbeatStaleMs || DEFAULT_QUEUE_STALE_MS));
  const now = nowIso();
  const nowMs = Date.parse(now);
  const state = await mutateQueueMonitorState(
    userDataPath,
    async (draft) => {
      for (const job of jobs) {
        const queueId = await ensureJobQueueId(userDataPath, job);
        const checkpoint = checkpointByJobId.get(job.id);
        const existing = asObject(draft.items[queueId]);
        if (ACTIVE_JOB_STATUSES.has(String(job.status || ""))) {
          const observedHeartbeatAt = existing.queueId
            ? maxIso(existing.lastHeartbeatAt, job.updatedAt, checkpoint?.updatedAt)
            : maxIso(job.updatedAt, checkpoint?.updatedAt, now);
          const item = queueItemFromInput(
            {
              queueId,
              kind: "import_parse_job",
              ownerId: job.id,
              label: `导入解析队列 ${job.id}`,
              source: existing.queueId ? "watchdog" : "watchdog-reconcile",
              status: job.status,
              phase: job.status,
              checkpointId: job.checkpointId || "",
              checkpointTreeId: job.checkpointTreeId || "",
              lastHeartbeatAt: observedHeartbeatAt,
              lastCheckpointAt: checkpoint?.updatedAt || "",
              metadata: {
                uploadSessionId: job.uploadSessionId || "",
                stage: job.stage || ""
              }
            },
            existing
          );
          item.statePath = queueMonitorStatePath(userDataPath);
          draft.items[queueId] = item;
        } else if (existing.queueId && existing.lifecycleStatus !== "closed") {
          const item = queueItemFromInput(
            {
              queueId,
              kind: existing.kind || "import_parse_job",
              ownerId: job.id,
              label: existing.label || `导入解析队列 ${job.id}`,
              source: "watchdog",
              status: job.status,
              checkpointId: job.checkpointId || existing.checkpointId || "",
              checkpointTreeId: job.checkpointTreeId || existing.checkpointTreeId || "",
              lastCheckpointAt: checkpoint?.updatedAt || existing.lastCheckpointAt || ""
            },
            existing
          );
          item.closedAt = job.finishedAt || job.updatedAt || now;
          item.lastHeartbeatAt = maxIso(item.lastHeartbeatAt, item.closedAt);
          if (existing.lifecycleStatus === "interrupted" || existing.lifecycleStatus === "recovered") {
            markRecovered(item, { now, reason: "terminal_job_observed" });
          } else {
            item.lifecycleStatus = "closed";
            item.phase = "closed";
          }
          draft.items[queueId] = item;
        }
      }

      for (const item of Object.values(draft.items)) {
        if (!item?.queueId || item.lifecycleStatus === "closed") {
          continue;
        }
        const job = jobById.get(item.ownerId);
        const checkpoint = job ? checkpointByJobId.get(job.id) : null;
        const evidence = queueEvidence({
          item,
          job,
          checkpoint,
          eventLogPath: queueMonitorEventLogPath(userDataPath)
        });
        const evidenceAtMs = toMs(evidence.evidenceUpdatedAt);
        const stale = evidenceAtMs <= 0 || nowMs - evidenceAtMs > safeStaleMs;
        if (item.lifecycleStatus === "interrupted") {
          const freshAfterInterrupt = toMs(evidence.evidenceUpdatedAt) > toMs(item.interruptedAt);
          if (
            (job && TERMINAL_JOB_STATUSES.has(String(job.status || ""))) ||
            (job?.status === "running" && freshAfterInterrupt && !stale)
          ) {
            markRecovered(item, {
              now,
              reason: job?.status === "running" ? "queue_running_again" : "terminal_job_observed"
            });
          }
          continue;
        }
        if (item.lifecycleStatus === "recovered") {
          continue;
        }
        if (!job) {
          if (!stale) {
            continue;
          }
          markInterrupted(item, {
            now,
            reason: item.kind === "import_parse_job" ? "job_metadata_missing" : "queue_heartbeat_stale",
            evidence
          });
          continue;
        }
        if (!ACTIVE_JOB_STATUSES.has(String(job.status || ""))) {
          continue;
        }
        if (!stale) {
          continue;
        }
        markInterrupted(item, {
          now,
          reason: "queue_heartbeat_stale",
          evidence
        });
        if (recoverInterruptedQueues && !item.recoveryAttemptedAt) {
          item.recoveryAttemptedAt = now;
          const recovery = await recoverInterruptedJob({ userDataPath, job, item, now });
          item.recoveryStatus = recovery.reason;
          if (recovery.ok) {
            item.recoveryQueuedAt = now;
          }
        }
      }

      return draft;
    },
    {
      type: "queue.watchdog.inspected",
      source: "watchdog",
      activeJobCount: jobs.filter((job) => ACTIVE_JOB_STATUSES.has(String(job.status || ""))).length
    }
  );

  const items = Object.values(state.items || {}).map(attachQueueRegistration);
  return {
    schemaVersion: QUEUE_MONITOR_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    statePath: state.statePath,
    eventLogPath: state.eventLogPath,
    summary: queueMonitorSummary(items),
    items,
    systemStatus: buildQueueSystemStatus(items, state.updatedAt)
  };
}

export async function getQueueMonitorState(userDataPath) {
  const state = await loadState(userDataPath);
  const items = Object.values(state.items || {}).map(attachQueueRegistration);
  return {
    ...state,
    items,
    summary: queueMonitorSummary(items),
    systemStatus: buildQueueSystemStatus(items, state.updatedAt)
  };
}

export async function acknowledgeQueueMonitorAlert(userDataPath, alertId) {
  const text = String(alertId || "");
  const match = text.match(/^monitor\.queue\.(queue_item_[a-f0-9]{32})\.interrupted$/);
  if (!match) {
    return null;
  }
  const queueId = match[1];
  const acknowledgedAt = nowIso();
  return mutateQueueMonitorState(
    userDataPath,
    (state) => {
      const item = asObject(state.items[queueId]);
      if (!item.queueId) {
        return null;
      }
      item.acknowledgedAt = acknowledgedAt;
      if (item.lifecycleStatus === "recovered") {
        item.lifecycleStatus = "closed";
        item.closedAt = item.closedAt || acknowledgedAt;
      }
      state.items[queueId] = item;
      return item;
    },
    {
      type: "queue.alert.acknowledged",
      source: "monitor-alerts",
      queueId,
      alertId: text
    }
  );
}
