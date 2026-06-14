import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PQueue from "p-queue";
import {
  checkpointTreeId,
  createDurableWorkflowRuntime,
  deleteCheckpointTree,
  finishCheckpointTree,
  startCheckpointTree,
  upsertCheckpointNode,
  workflowId
} from "../../../../platform/interactive/product-api.mjs";
import {
  atomicWriteJsonThroughState,
  getRuntimeLogger,
  removeImportCheckpoint,
  summarizeError,
  summarizeForLog,
  traceDetails
} from "../../../../platform/interactive/product-api.mjs";
import { resolveArchiveBatchIdentity } from "../archive-batch-id.mjs";
import {
  queueMonitorId,
  registerQueueClosed,
  registerQueueHeartbeat,
  registerQueueStarted
} from "../queue-monitor.mjs";
import { unifiedRegistrationForTask } from "../../../../platform/interactive/product-api.mjs";
import { deleteUploadSession } from "../../../../protocols/checkpoint/upload-session-store.mjs";
import {
  isServerToken,
  resolveStoredObjectPath,
  serverToken
} from "../../../../platform/interactive/product-api.mjs";

const workerEntryPath = fileURLToPath(new URL("./job-worker.mjs", import.meta.url));
const CLOSE_ABORT_MESSAGE = "服务已关闭，任务已中止。";
const RECOVERY_STAGE_MESSAGE = "服务已恢复，任务等待重试。";
const DEFAULT_WORKER_CONCURRENCY = 4;
const MAX_WORKER_CONCURRENCY = 16;
const CHECKPOINT_FILE_SAMPLE_LIMIT = 5;
const QUEUE_HEARTBEAT_INTERVAL_MS = 5000;

function normalizeWorkerConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WORKER_CONCURRENCY;
  }
  return Math.max(1, Math.min(MAX_WORKER_CONCURRENCY, Math.trunc(parsed)));
}

function getJobsRootPath(userDataPath) {
  return path.join(userDataPath, "jobs");
}

function getJobDirectory(userDataPath, jobId) {
  return path.join(getJobsRootPath(userDataPath), jobId);
}

function getJobMetaPath(userDataPath, jobId) {
  return path.join(getJobDirectory(userDataPath, jobId), "meta.json");
}

function getJobResultPath(userDataPath, jobId) {
  return path.join(getJobDirectory(userDataPath, jobId), "result.json");
}

function getJobPayloadPath(userDataPath, jobId) {
  return path.join(getJobDirectory(userDataPath, jobId), "payload.json");
}

function cloneCheckpointReceipt(receipt, { includeFiles = false } = {}) {
  if (!receipt || typeof receipt !== "object") {
    return receipt || null;
  }

  const files = Array.isArray(receipt.files) ? receipt.files : [];
  const cloned = {
    ...receipt
  };

  if (includeFiles || files.length <= CHECKPOINT_FILE_SAMPLE_LIMIT) {
    cloned.files = files.map((file) => ({
      ...file
    }));
    return cloned;
  }

  delete cloned.files;
  cloned.fileSamples = files.slice(0, CHECKPOINT_FILE_SAMPLE_LIMIT).map((file) => ({
    ...file
  }));
  cloned.filesTruncated = true;
  cloned.filesReturned = CHECKPOINT_FILE_SAMPLE_LIMIT;
  cloned.filesTotal = Number(receipt.fileCount || files.length || 0);
  return cloned;
}

function cloneJob(job, { includeCheckpointFiles = false, queueState = null } = {}) {
  if (!job) {
    return null;
  }

  const cloned = {
    ...job,
    checkpointReceipt: cloneCheckpointReceipt(job.checkpointReceipt, {
      includeFiles: includeCheckpointFiles
    }),
    queueState: queueState || undefined,
    resultSummary: job.resultSummary
      ? {
          ...job.resultSummary
        }
      : undefined
  };
  cloned.unifiedRegistration = unifiedRegistrationForTask(cloned, {
    taskType: "import_parse_job",
    taskId: cloned.id,
    queueId: cloned.queueId || (cloned.id ? queueMonitorId("import_parse_job", cloned.id) : ""),
    source: "jobs",
    feature: "工作队列"
  });
  return cloned;
}

function normalizeCheckpointId(payloadOrValue) {
  const value =
    payloadOrValue && typeof payloadOrValue === "object"
      ? payloadOrValue?.checkpointReceipt?.checkpointId ||
        payloadOrValue?.checkpointId ||
        payloadOrValue?.checkpoint?.checkpointId ||
        ""
      : payloadOrValue;
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return isServerToken(text, "checkpoint") ? text : serverToken("checkpoint", text);
}

function normalizeManifestKey(payloadOrJob) {
  const value =
    payloadOrJob && typeof payloadOrJob === "object"
      ? payloadOrJob?.checkpointReceipt?.manifestSha256 ||
        payloadOrJob?.checkpointReceipt?.manifestDigest ||
        payloadOrJob?.checkpoint?.manifestDigest ||
        payloadOrJob?.manifestSha256 ||
        ""
      : payloadOrJob;
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function normalizeArchiveBatchId(payloadOrJob) {
  const identity = resolveArchiveBatchIdentity({
    archiveBatchId:
      payloadOrJob?.checkpointReceipt?.archiveBatchId ||
      payloadOrJob?.archiveBatchId ||
      payloadOrJob?.checkpoint?.archiveBatchId ||
      "",
    batchId: payloadOrJob?.batchId || payloadOrJob?.checkpoint?.batchId || "",
    clientBatchId: payloadOrJob?.clientBatchId || payloadOrJob?.checkpoint?.clientBatchId || "",
    checkpointId:
      payloadOrJob?.checkpointReceipt?.checkpointId ||
      payloadOrJob?.checkpointId ||
      payloadOrJob?.checkpoint?.checkpointId ||
      "",
    manifestDigest:
      payloadOrJob?.checkpointReceipt?.manifestSha256 ||
      payloadOrJob?.checkpointReceipt?.manifestDigest ||
      payloadOrJob?.checkpoint?.manifestDigest ||
      payloadOrJob?.manifestSha256 ||
      "",
    inputDigest:
      payloadOrJob?.checkpoint?.inputDigest ||
      payloadOrJob?.inputDigest ||
      ""
  });
  return identity.archiveBatchId;
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function shouldForceNewJobVersion(payload) {
  return Boolean(
    isTruthyFlag(payload?.forceNewVersion) ||
      isTruthyFlag(payload?.reparse) ||
      isTruthyFlag(payload?.createNewVersion) ||
      payload?.reparseFromJobId ||
      payload?.parentJobId
  );
}

function normalizeVersionGroupId(payloadOrJob, { checkpointId = "", manifestKey = "", archiveBatchId = "" } = {}) {
  const value =
    payloadOrJob && typeof payloadOrJob === "object"
      ? payloadOrJob?.versionGroupId ||
        payloadOrJob?.parseVersionGroupId ||
        payloadOrJob?.checkpointReceipt?.versionGroupId ||
        ""
      : payloadOrJob;
  const explicit = String(value || "").trim();
  if (explicit) {
    return isServerToken(explicit, "parse_version_group")
      ? explicit
      : serverToken("parse_version_group", explicit);
  }
  const stableKey = checkpointId || manifestKey || archiveBatchId || "";
  return stableKey ? serverToken("parse_version_group", stableKey) : serverToken("parse_version_group", randomUUID());
}

function normalizeParentJobId(payloadOrJob) {
  return String(payloadOrJob?.reparseFromJobId || payloadOrJob?.parentJobId || "").trim();
}

function jobMatchesVersionFamily(job, { versionGroupId = "", checkpointId = "", manifestKey = "" } = {}) {
  if (!job) {
    return false;
  }
  if (versionGroupId && String(job.versionGroupId || "") === versionGroupId) {
    return true;
  }
  if (!job.versionGroupId && checkpointId && normalizeCheckpointId(job) === checkpointId) {
    return true;
  }
  if (!job.versionGroupId && manifestKey && normalizeManifestKey(job) === manifestKey) {
    return true;
  }
  return false;
}

function nextVersionNumberForJobs(jobs, family) {
  let maxVersion = 0;
  for (const job of jobs.values()) {
    if (!jobMatchesVersionFamily(job, family)) {
      continue;
    }
    const version = Number(job.versionNumber || 1);
    maxVersion = Math.max(maxVersion, Number.isFinite(version) && version > 0 ? version : 1);
  }
  return maxVersion + 1;
}

async function persistJobMeta(userDataPath, job) {
  const jobDirectory = getJobDirectory(userDataPath, job.id);
  await fs.mkdir(jobDirectory, { recursive: true });
  await atomicWriteJsonThroughState(getJobMetaPath(userDataPath, job.id), job, {
    trailingNewline: false,
    kind: "jobs.meta.write",
    metadata: { jobId: job.id }
  });
}

async function persistJobResult(userDataPath, jobId, result) {
  const jobDirectory = getJobDirectory(userDataPath, jobId);
  await fs.mkdir(jobDirectory, { recursive: true });
  await atomicWriteJsonThroughState(getJobResultPath(userDataPath, jobId), result, {
    trailingNewline: false,
    kind: "jobs.result.write",
    metadata: { jobId }
  });
}

async function persistJobPayload(userDataPath, jobId, payload) {
  const jobDirectory = getJobDirectory(userDataPath, jobId);
  await fs.mkdir(jobDirectory, { recursive: true });
  await atomicWriteJsonThroughState(getJobPayloadPath(userDataPath, jobId), payload, {
    trailingNewline: false,
    kind: "jobs.payload.write",
    metadata: { jobId }
  });
}

async function loadJobPayload(userDataPath, jobId) {
  try {
    const raw = await fs.readFile(getJobPayloadPath(userDataPath, jobId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function loadPersistedJobs(userDataPath, { recoverActive = true } = {}) {
  const rootPath = getJobsRootPath(userDataPath);
  await fs.mkdir(rootPath, { recursive: true });
  const directoryEntries = await fs.readdir(rootPath, {
    withFileTypes: true
  });
  const jobs = [];
  const recoverableEntries = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) {
      continue;
    }

    try {
      const metaPath = getJobMetaPath(userDataPath, directoryEntry.name);
      const content = await fs.readFile(metaPath, "utf8");
      const parsed = JSON.parse(content);

      if (recoverActive && (parsed.status === "queued" || parsed.status === "running")) {
        const payload = await loadJobPayload(userDataPath, parsed.id);
        const now = new Date().toISOString();
        if (payload) {
          parsed.status = "queued";
          parsed.stage = RECOVERY_STAGE_MESSAGE;
          parsed.error = "";
          parsed.finishedAt = undefined;
          parsed.updatedAt = now;
          await persistJobMeta(userDataPath, parsed);
          recoverableEntries.push({
            jobId: parsed.id,
            payload
          });
        } else {
          parsed.status = "failed";
          parsed.stage = "任务恢复失败";
          parsed.error = "服务重启后缺少任务 payload，不能继续恢复。";
          parsed.finishedAt = now;
          parsed.updatedAt = now;
          await persistJobMeta(userDataPath, parsed);
        }
      }

      jobs.push(parsed);
    } catch {
      // Ignore malformed historical entries.
    }
  }

  jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  recoverableEntries.sort((left, right) => {
    const leftJob = jobs.find((job) => job.id === left.jobId);
    const rightJob = jobs.find((job) => job.id === right.jobId);
    return String(leftJob?.createdAt || "").localeCompare(String(rightJob?.createdAt || ""));
  });
  return {
    jobs,
    recoverableEntries
  };
}

async function listPersistedJobMetas(userDataPath) {
  const rootPath = getJobsRootPath(userDataPath);
  await fs.mkdir(rootPath, { recursive: true });
  const directoryEntries = await fs.readdir(rootPath, {
    withFileTypes: true
  });
  const jobs = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) {
      continue;
    }

    try {
      const content = await fs.readFile(
        getJobMetaPath(userDataPath, directoryEntry.name),
        "utf8"
      );
      jobs.push(JSON.parse(content));
    } catch {
      // Ignore malformed historical entries.
    }
  }

  jobs.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return jobs;
}

async function waitForWorkerExit(workerExitPromise, timeoutMs) {
  const didExit = await Promise.race([
    workerExitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
  return Boolean(didExit);
}

export function createJobManager({
  userDataPath,
  runtimeOptions = {},
  getRuntimeOptions = null,
  protocolEventBus = null,
  processingEnabled = process.env.PACT_IMPORT_WORKER_EXTERNAL !== "1",
  externalScheduler = process.env.PACT_PLATFORM_WORK_QUEUE === "1",
  logger = getRuntimeLogger()
}) {
  const jobs = new Map();
  const checkpointJobs = new Map();
  const activeManifestJobs = new Map();
  const durableWorkflows = createDurableWorkflowRuntime({ userDataPath });
  const workerConcurrency = normalizeWorkerConcurrency(
    runtimeOptions?.workerConcurrency || process.env.PACT_JOB_WORKER_CONCURRENCY
  );
  const importQueue = new PQueue({
    concurrency: workerConcurrency,
    autoStart: false
  });
  const queuedEntries = [];
  const queuedEntryIds = new Set();
  const activeControllers = new Map();
  let readyComplete = false;
  let closed = false;

  function logJob(level, event, details = {}) {
    if (!logger || typeof logger[level] !== "function") {
      return;
    }
    logger[level](event, {
      processingEnabled,
      workerConcurrency,
      activeCount: activeControllers.size,
      queuedCount: queuedEntries.length,
      ...details
    });
  }

  logJob("info", "jobs.manager.created", {
    userDataPath,
    processingMode: processingEnabled ? "internal" : "external",
    schedulerMode: externalScheduler ? "platform-work-queue" : "internal-pqueue"
  });

  function rememberActiveManifestJob(job) {
    if (!job || !["queued", "running"].includes(job.status)) {
      return;
    }
    const manifestKey = normalizeManifestKey(job);
    if (!manifestKey) {
      return;
    }
    const activeManifestKey = `${manifestKey}::${job.archiveBatchId || ""}`;
    const existingJobId = activeManifestJobs.get(activeManifestKey);
    const existingJob = existingJobId ? jobs.get(existingJobId) : null;
    if (!existingJob || String(job.createdAt || "") < String(existingJob.createdAt || "")) {
      activeManifestJobs.set(activeManifestKey, job.id);
    }
  }

  function forgetActiveManifestJob(job) {
    const manifestKey = normalizeManifestKey(job);
    const activeManifestKey = `${manifestKey}::${job?.archiveBatchId || ""}`;
    if (manifestKey && activeManifestJobs.get(activeManifestKey) === job?.id) {
      activeManifestJobs.delete(activeManifestKey);
    }
  }

  function getActiveManifestJob(manifestKey, archiveBatchId = "") {
    if (!manifestKey) {
      return null;
    }
    const activeManifestKey = `${manifestKey}::${archiveBatchId || ""}`;
    const existingJobId = activeManifestJobs.get(activeManifestKey);
    const existingJob = existingJobId ? jobs.get(existingJobId) : null;
    if (!existingJob || !["queued", "running"].includes(existingJob.status)) {
      activeManifestJobs.delete(activeManifestKey);
      return null;
    }
    return existingJob;
  }

  function buildQueueState(job) {
    if (!job || !["queued", "running"].includes(job.status)) {
      return null;
    }

    const queuedIds = queuedEntries.map((entry) => entry.jobId);
    const activeJobIds = [...activeControllers.keys()];
    const activeJobId = activeJobIds[0] || "";

    if (job.status === "running") {
      return {
        workerConcurrency,
        active: true,
        activeJobId: job.id,
        activeJobIds,
        activeSlotCount: activeControllers.size,
        queuePosition: 0,
        queuedAhead: 0,
        queuedBehind: queuedIds.length,
        waitingReason: "running"
      };
    }

    const index = queuedIds.indexOf(job.id);
    const queuePosition = index >= 0 ? index + 1 : 0;
    const queuedAhead = index >= 0 ? index : 0;
    const queuedBehind = index >= 0 ? Math.max(0, queuedIds.length - index - 1) : 0;
    const blockedByJobId =
      activeControllers.size >= workerConcurrency
        ? activeJobIds[activeJobIds.length - 1] || activeJobId
        : index > 0
          ? queuedIds[index - 1] || ""
          : "";

    return {
      workerConcurrency,
      active: false,
      activeJobId,
      activeJobIds,
      activeSlotCount: activeControllers.size,
      blockedByJobId,
      queuePosition,
      queuedAhead,
      queuedBehind,
      waitingReason: activeControllers.size >= workerConcurrency
        ? "waiting_for_available_worker"
        : queuedAhead > 0
          ? "waiting_for_earlier_queued_job"
          : "ready_to_start",
      waitingSince: job.createdAt || ""
    };
  }

  function cloneJobForApi(job, options = {}) {
    return cloneJob(job, {
      ...options,
      queueState: buildQueueState(job)
    });
  }

  function checkpointTreeIdForJob(job) {
    return job?.checkpointTreeId || (job?.id ? checkpointTreeId("job", job.id) : "");
  }

  function queueIdForJob(job) {
    return job?.queueId || (job?.id ? queueMonitorId("import_parse_job", job.id) : "");
  }

  function workflowIdForJob(job) {
    return job?.workflowId || (job?.id ? workflowId("import_parse_job", job.id) : "");
  }

  function queueMonitorInputForJob(job, input = {}) {
    const queueId = queueIdForJob(job);
    return {
      queueId,
      kind: "import_parse_job",
      ownerId: job?.id || "",
      label: `导入解析队列 ${job?.id || ""}`,
      checkpointId: job?.checkpointId || "",
      checkpointTreeId: checkpointTreeIdForJob(job),
      status: job?.status || input.status || "",
      phase: input.phase || job?.status || "",
      source: input.source || "function-self-check",
      metadata: {
        uploadSessionId: job?.uploadSessionId || "",
        archiveBatchId: job?.archiveBatchId || "",
        progressPercent: Number(job?.progressPercent || 0),
        stage: job?.stage || "",
        ...(input.metadata || {})
      }
    };
  }

  async function registerJobQueueStarted(job, input = {}) {
    if (!job?.id) {
      return null;
    }
    job.queueId = queueIdForJob(job);
    return registerQueueStarted(userDataPath, queueMonitorInputForJob(job, input)).catch((error) => {
      logJob("warn", "jobs.queue_monitor.start.failed", {
        jobId: job.id,
        queueId: job.queueId,
        error: summarizeError(error)
      });
      return null;
    });
  }

  async function registerJobQueueHeartbeat(job, input = {}) {
    if (!job?.id) {
      return null;
    }
    job.queueId = queueIdForJob(job);
    return registerQueueHeartbeat(userDataPath, queueMonitorInputForJob(job, input)).catch((error) => {
      logJob("warn", "jobs.queue_monitor.heartbeat.failed", {
        jobId: job.id,
        queueId: job.queueId,
        error: summarizeError(error)
      });
      return null;
    });
  }

  async function registerJobQueueClosed(job, input = {}) {
    if (!job?.id) {
      return null;
    }
    job.queueId = queueIdForJob(job);
    return registerQueueClosed(
      userDataPath,
      queueMonitorInputForJob(job, {
        ...input,
        phase: "closed",
        status: input.status || job.status || "closed"
      })
    ).catch((error) => {
      logJob("warn", "jobs.queue_monitor.close.failed", {
        jobId: job.id,
        queueId: job.queueId,
        error: summarizeError(error)
      });
      return null;
    });
  }

  async function ensureJobCheckpointTree(job, payload = null) {
    if (!job?.id) {
      return "";
    }
    job.queueId = queueIdForJob(job);
    const treeId = checkpointTreeIdForJob(job);
    const manifestKey = normalizeManifestKey(payload || job);
    await startCheckpointTree({
      userDataPath,
      treeId,
      kind: "import_parse_job",
      ownerId: job.id,
      inputHash: manifestKey || job.checkpointId || job.id,
      rootNodeId: "import-parse-job",
      rootLabel: "导入解析任务",
      metadata: {
        jobId: job.id,
        queueId: job.queueId,
        workflowId: workflowIdForJob(job),
        checkpointId: job.checkpointId || "",
        archiveBatchId: job.archiveBatchId || "",
        uploadSessionId: job.uploadSessionId || "",
        manifestSha256: manifestKey,
        knowledgeSourceId: payload?.knowledgeSource?.sourceId || ""
      },
      resumePolicy: {
        mode: "job-payload+import-entry-checkpoint",
        idempotencyKey: "checkpointId/manifestSha256",
        reusableState: "jobs/<jobId>/payload.json + jobs/<jobId>/import-checkpoint"
      },
      resetOnInputHashChange: false
    });
    return treeId;
  }

  async function updateJobCheckpointNode(job, node) {
    const treeId = checkpointTreeIdForJob(job);
    if (!treeId) {
      return null;
    }
    return upsertCheckpointNode({
      userDataPath,
      treeId,
      ...node
    }).catch(() => null);
  }

  async function finishJobCheckpoint(job, input = {}) {
    const treeId = checkpointTreeIdForJob(job);
    if (!treeId) {
      return null;
    }
    return finishCheckpointTree({
      userDataPath,
      treeId,
      ...input
    }).catch(() => null);
  }

  function resolveCurrentRuntimeOptions() {
    if (typeof getRuntimeOptions === "function") {
      return getRuntimeOptions() || runtimeOptions;
    }

    return runtimeOptions;
  }

  async function refreshPersistedJobs() {
    const persistedJobs = await listPersistedJobMetas(userDataPath);
    const knownIds = new Set(persistedJobs.map((job) => job.id).filter(Boolean));

    for (const job of persistedJobs) {
      if (!job.archiveBatchId && job.id) {
        job.archiveBatchId = normalizeArchiveBatchId(job) || serverToken("archive_batch", job.checkpointId || job.id);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.queueId && job.id) {
        job.queueId = queueIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.checkpointTreeId && job.id) {
        job.checkpointTreeId = checkpointTreeIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.workflowId && job.id) {
        job.workflowId = workflowIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (job.checkpointTreeId && ["queued", "running"].includes(job.status)) {
        await ensureJobCheckpointTree(job).catch(() => null);
        await updateJobCheckpointNode(job, {
          nodeId: "recovered-queue",
          parentId: "import-parse-job",
          label: RECOVERY_STAGE_MESSAGE,
          status: "running",
          cursor: {
            status: job.status,
            progressPercent: Number(job.progressPercent || 0),
            stage: job.stage || ""
          }
        });
      }
      jobs.set(job.id, job);
      if (job.checkpointId) {
        checkpointJobs.set(job.checkpointId, job.id);
      }
      if (["queued", "running"].includes(job.status)) {
        rememberActiveManifestJob(job);
        await durableWorkflows.recoverWorkflow(job.workflowId, {
          reason: "job_manager_refresh_recovery"
        }).catch(() => null);
        await registerJobQueueStarted(job, {
          phase: job.status,
          source: "function-self-check",
          metadata: { recoveredFromDisk: true }
        });
      } else {
        forgetActiveManifestJob(job);
        await registerJobQueueClosed(job, {
          status: job.status || "closed",
          source: "function-self-check"
        });
      }
    }

    for (const jobId of [...jobs.keys()]) {
      if (!knownIds.has(jobId)) {
        const current = jobs.get(jobId);
        jobs.delete(jobId);
        if (current?.checkpointId) {
          checkpointJobs.delete(current.checkpointId);
        }
        forgetActiveManifestJob(current);
      }
    }
  }

  function removeQueuedEntry(jobId) {
    if (!jobId || !queuedEntryIds.has(jobId)) {
      logJob("debug", "jobs.queue.remove.skipped", {
        jobId,
        reason: !jobId ? "missing_job_id" : "not_queued"
      });
      return false;
    }
    queuedEntryIds.delete(jobId);
    const index = queuedEntries.findIndex((entry) => entry.jobId === jobId);
    if (index >= 0) {
      queuedEntries.splice(index, 1);
    }
    logJob("info", "jobs.queue.removed", {
      jobId,
      removedIndex: index
    });
    return true;
  }

  async function runQueuedJob(entry, options = {}) {
    if (!processingEnabled || closed || !entry?.jobId) {
      logJob("warn", "jobs.queue.dispatch.skipped", {
        jobId: entry?.jobId || "",
        reason: !processingEnabled ? "processing_disabled" : closed ? "closed" : "missing_job_id",
        externalSchedulerDispatch: options.externalSchedulerDispatch === true
      });
      removeQueuedEntry(entry?.jobId);
      return false;
    }
    const queuedJob = jobs.get(entry.jobId);
    if (!queuedJob || queuedJob.status !== "queued") {
      logJob("warn", "jobs.queue.dispatch.skipped", {
        jobId: entry.jobId,
        reason: !queuedJob ? "job_missing" : `status_${queuedJob.status}`
      });
      removeQueuedEntry(entry.jobId);
      return false;
    }
    logJob("info", "jobs.queue.dispatch.started", {
      jobId: entry.jobId,
      checkpointId: queuedJob.checkpointId || "",
      uploadSessionId: queuedJob.uploadSessionId || ""
    });
    void registerJobQueueHeartbeat(queuedJob, {
      phase: "dispatching",
      source: "function-self-check"
    });
    return startQueuedJob(entry);
  }

  function enqueueQueueEntry(entry) {
    if (!processingEnabled || closed || !entry?.jobId) {
      logJob("warn", "jobs.queue.enqueue.skipped", {
        jobId: entry?.jobId || "",
        reason: !processingEnabled ? "processing_disabled" : closed ? "closed" : "missing_job_id"
      });
      return false;
    }
    if (queuedEntryIds.has(entry.jobId) || activeControllers.has(entry.jobId)) {
      logJob("info", "jobs.queue.enqueue.deduped", {
        jobId: entry.jobId,
        alreadyQueued: queuedEntryIds.has(entry.jobId),
        alreadyActive: activeControllers.has(entry.jobId)
      });
      return false;
    }

    queuedEntries.push(entry);
    queuedEntryIds.add(entry.jobId);
    const queuedJob = jobs.get(entry.jobId);
    if (queuedJob) {
      void registerJobQueueHeartbeat(queuedJob, {
        phase: "queued",
        source: "function-self-check"
      });
    }
    logJob("info", "jobs.queue.enqueued", {
      jobId: entry.jobId,
      payload: summarizeForLog(entry.payload)
    });
    void importQueue.add(() => runQueuedJob(entry), { id: entry.jobId }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error || "任务队列执行失败。");
      logJob("error", "jobs.queue.task_failed", {
        jobId: entry.jobId,
        error: summarizeError(error)
      });
      const queuedJob = jobs.get(entry.jobId);
      if (queuedJob && ["queued", "running"].includes(queuedJob.status)) {
        await failJob(entry.jobId, message, "任务队列执行失败");
      }
    });
    if (readyComplete && !closed) {
      importQueue.start();
      logJob("debug", "jobs.queue.started", {
        reason: "entry_enqueued"
      });
    }
    return true;
  }

  const ready = (async () => {
    logJob("info", "jobs.queue.recovery.started", {
      recoverActive: processingEnabled
    });
    const { jobs: persistedJobs, recoverableEntries } = await loadPersistedJobs(userDataPath, {
      recoverActive: processingEnabled
    });

    for (const job of persistedJobs) {
      if (!job.archiveBatchId && job.id) {
        job.archiveBatchId = normalizeArchiveBatchId(job) || serverToken("archive_batch", job.checkpointId || job.id);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.queueId && job.id) {
        job.queueId = queueIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.checkpointTreeId && job.id) {
        job.checkpointTreeId = checkpointTreeIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (!job.workflowId && job.id) {
        job.workflowId = workflowIdForJob(job);
        await persistJobMeta(userDataPath, job);
      }
      if (job.checkpointTreeId && ["queued", "running"].includes(job.status)) {
        await ensureJobCheckpointTree(job).catch(() => null);
        await updateJobCheckpointNode(job, {
          nodeId: "recovered-queue",
          parentId: "import-parse-job",
          label: RECOVERY_STAGE_MESSAGE,
          status: "running",
          cursor: {
            status: job.status,
            progressPercent: Number(job.progressPercent || 0),
            stage: job.stage || ""
          }
        });
      }
      jobs.set(job.id, job);
      if (job.checkpointId) {
        checkpointJobs.set(job.checkpointId, job.id);
      }
      rememberActiveManifestJob(job);
      if (["queued", "running"].includes(job.status)) {
        await durableWorkflows.recoverWorkflow(job.workflowId, {
          reason: "job_manager_startup_recovery"
        }).catch(() => null);
        await registerJobQueueStarted(job, {
          phase: job.status,
          source: "function-self-check",
          metadata: { recoveredFromDisk: true }
        });
      } else {
        await registerJobQueueClosed(job, {
          status: job.status || "closed",
          source: "function-self-check"
        });
      }
    }

    if (processingEnabled && !externalScheduler) {
      for (const entry of recoverableEntries) {
        enqueueQueueEntry(entry);
      }

      readyComplete = true;
      importQueue.start();
    } else if (processingEnabled && externalScheduler) {
      readyComplete = true;
    } else {
      readyComplete = true;
    }
    logJob("info", "jobs.queue.recovery.completed", {
      persistedJobCount: persistedJobs.length,
      recoverableCount: recoverableEntries.length,
      recoveredQueuedCount: queuedEntries.length
    });
  })();

  async function publishJobEvent(job, type = "jobs.job.updated") {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return null;
    }
    return protocolEventBus.publish(
      "jobs.job",
      {
        job: cloneJobForApi(job)
      },
      { type, trace: job.trace || null }
    );
  }

  async function publishDeletedJobEvent(job) {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return null;
    }
    return protocolEventBus.publish(
      "jobs.deleted",
      {
        job: cloneJobForApi(job)
      },
      { type: "jobs.deleted", trace: job.trace || null }
    );
  }

  async function updateJob(jobId, patch) {
    const currentJob = jobs.get(jobId);

    if (!currentJob) {
      logJob("warn", "jobs.job.update.skipped", {
        jobId,
        reason: "job_missing",
        patch
      });
      return null;
    }

    const { eventType, ...jobPatch } = patch;
    Object.assign(currentJob, jobPatch, {
      updatedAt: new Date().toISOString()
    });
    if (["queued", "running"].includes(currentJob.status)) {
      rememberActiveManifestJob(currentJob);
    } else {
      forgetActiveManifestJob(currentJob);
    }
    await persistJobMeta(userDataPath, currentJob);
    await publishJobEvent(currentJob, eventType || "jobs.job.updated");
    logJob("info", "jobs.job.updated", {
      jobId,
      status: currentJob.status,
      stage: currentJob.stage,
      progressPercent: currentJob.progressPercent,
      eventType: eventType || "jobs.job.updated",
      patch
    });
    return currentJob;
  }

  async function failJob(jobId, errorMessage, stage) {
    const finishedAt = new Date().toISOString();
    const currentJob = jobs.get(jobId);
    if (currentJob) {
      await updateJobCheckpointNode(currentJob, {
        nodeId: "job-failed",
        parentId: "import-parse-job",
        label: stage || "任务失败",
        status: "failed",
        error: errorMessage || "",
        cursor: {
          progressPercent: Number(currentJob.progressPercent || 0),
          stage: stage || ""
        }
      });
      await finishJobCheckpoint(currentJob, {
        status: "failed",
        message: errorMessage || stage || "Job failed.",
        metadata: {
          stage: stage || "",
          progressPercent: Number(currentJob.progressPercent || 0)
        }
      });
      await durableWorkflows.failActivity(currentJob.workflowId || workflowIdForJob(currentJob), "worker-run", errorMessage || stage || "Job failed.").catch(() => null);
      await durableWorkflows.failWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), errorMessage || stage || "Job failed.").catch(() => null);
    }
    logJob("error", "jobs.job.fail_requested", {
      jobId,
      stage,
      errorMessage
    });
    const failedJob = await updateJob(jobId, {
      status: "failed",
      stage,
      error: errorMessage,
      finishedAt
    });
    if (failedJob) {
      await registerJobQueueClosed(failedJob, {
        status: "failed",
        source: "function-self-check",
        metadata: {
          stage,
          error: errorMessage || ""
        }
      });
    }
    return failedJob;
  }

  async function startQueuedJob(nextEntry) {
    const currentJob = jobs.get(nextEntry.jobId);
    if (!currentJob || currentJob.status !== "queued") {
      logJob("warn", "jobs.worker.start.skipped", {
        jobId: nextEntry?.jobId || "",
        reason: !currentJob ? "job_missing" : `status_${currentJob.status}`
      });
      return false;
    }

    let worker;

    try {
      logJob("info", "jobs.worker.spawn.requested", {
        jobId: currentJob.id,
        checkpointId: currentJob.checkpointId || "",
        uploadSessionId: currentJob.uploadSessionId || ""
      });
      worker = fork(workerEntryPath, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
      logJob("info", "jobs.worker.spawned", {
        jobId: currentJob.id,
        pid: worker.pid || 0
      });
      await durableWorkflows.scheduleActivity(currentJob.workflowId || workflowIdForJob(currentJob), {
        activityId: "worker-run",
        activityType: "import_parse_worker",
        idempotencyKey: `${currentJob.id}:worker-run:${currentJob.versionNumber || 1}`,
        inputHash: currentJob.checkpointId || currentJob.archiveBatchId || currentJob.id,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "job_manager_requeue"
        },
        compensation: {
          action: "preserve_payload_and_requeue"
        }
      }).catch((error) => {
        logJob("warn", "jobs.workflow.activity_schedule.failed", {
          jobId: currentJob.id,
          error: summarizeError(error)
        });
      });
      await durableWorkflows.startActivity(currentJob.workflowId || workflowIdForJob(currentJob), "worker-run").catch((error) => {
        logJob("warn", "jobs.workflow.activity_start.failed", {
          jobId: currentJob.id,
          error: summarizeError(error)
        });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "后台执行进程启动失败。";
      logJob("error", "jobs.worker.spawn.failed", {
        jobId: currentJob.id,
        error: summarizeError(error)
      });
      await updateJobCheckpointNode(currentJob, {
        nodeId: "start-worker",
        parentId: "import-parse-job",
        label: "启动后台 worker",
        status: "failed",
        error: message
      });
      await finishJobCheckpoint(currentJob, {
        status: "failed",
        message,
        metadata: {
          stage: "任务启动失败"
        }
      });
      removeQueuedEntry(currentJob.id);
      await failJob(currentJob.id, message, "任务启动失败");
      return false;
    }

    let settled = false;
    let deleted = false;
    let workerExited = false;
    let preservedForRecovery = false;
    let resolveWorkerExit = null;
    let resolveQueueTask = null;
    let queueTaskSettled = false;
    let queueHeartbeatTimer = null;
    const workerExitPromise = new Promise((resolve) => {
      resolveWorkerExit = resolve;
    });
    const queueTaskPromise = new Promise((resolve) => {
      resolveQueueTask = resolve;
    });
    const markWorkerExited = () => {
      if (workerExited) {
        return;
      }

      workerExited = true;
      resolveWorkerExit?.();
    };
    const completeQueueTask = (value) => {
      if (queueTaskSettled) {
        return;
      }
      if (queueHeartbeatTimer) {
        clearInterval(queueHeartbeatTimer);
        queueHeartbeatTimer = null;
      }
      queueTaskSettled = true;
      resolveQueueTask?.(value);
    };
    const finalizeJob = async ({
      status,
      stage,
      errorMessage,
      result
    }) => {
      if (settled) {
        logJob("debug", "jobs.job.finalize.skipped", {
          jobId: currentJob.id,
          reason: "already_settled",
          status,
          stage
        });
        return;
      }

      settled = true;

      activeControllers.delete(currentJob.id);
      logJob(status === "completed" ? "info" : "error", "jobs.job.finalize.started", {
        jobId: currentJob.id,
        status,
        stage,
        errorMessage,
        resultSummary: result
          ? {
              emails: result.emails?.length || 0,
              transactions: result.transactions?.length || 0,
              people: result.people?.length || 0,
              warnings: result.warnings?.length || 0
            }
          : null
      });

      if (deleted) {
        if (!worker.killed) {
          try {
            worker.kill("SIGTERM");
          } catch {
            // Ignore late kill failures.
          }
        }
        completeQueueTask(false);
        logJob("warn", "jobs.job.finalize.deleted", {
          jobId: currentJob.id,
          status,
          stage
        });
        return;
      }

      const finishedAt = new Date().toISOString();

      if (result) {
        await persistJobResult(userDataPath, currentJob.id, result);
      }

      await updateJobCheckpointNode(currentJob, {
        nodeId: "worker-run",
        parentId: "import-parse-job",
        label: status === "completed" ? "后台 worker 执行完成" : "后台 worker 执行失败",
        status: status === "completed" ? "completed" : "failed",
        error: errorMessage || "",
        cursor: {
          progressPercent: status === "completed" ? 100 : Number(currentJob.progressPercent || 0),
          stage
        },
        metadata: result
          ? {
              emails: result.emails?.length || 0,
              transactions: result.transactions?.length || 0,
              people: result.people?.length || 0,
              warnings: result.warnings?.length || 0
            }
          : {}
      });
      await finishJobCheckpoint(currentJob, {
        status: status === "completed" ? "completed" : "failed",
        message: stage || (status === "completed" ? "Job completed." : "Job failed."),
        metadata: {
          error: errorMessage || "",
          progressPercent: status === "completed" ? 100 : Number(currentJob.progressPercent || 0)
        }
      });
      if (status === "completed") {
        await durableWorkflows.completeActivity(currentJob.workflowId || workflowIdForJob(currentJob), "worker-run", {
          resultSummary: result
            ? {
                emails: result.emails?.length || 0,
                transactions: result.transactions?.length || 0,
                people: result.people?.length || 0,
                warnings: result.warnings?.length || 0
              }
            : {}
        }).catch(() => null);
        await durableWorkflows.completeWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), {
          status,
          jobId: currentJob.id
        }).catch(() => null);
      } else {
        await durableWorkflows.failActivity(currentJob.workflowId || workflowIdForJob(currentJob), "worker-run", errorMessage || stage || "Job failed.").catch(() => null);
        await durableWorkflows.failWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), errorMessage || stage || "Job failed.").catch(() => null);
      }

      if (currentJob.uploadSessionId) {
        await deleteUploadSession(userDataPath, currentJob.uploadSessionId);
      }

      if (status === "completed") {
        await removeImportCheckpoint({
          userDataPath,
          batchId: currentJob.id
        });
      }

      await updateJob(currentJob.id, {
        status,
        stage,
        error: errorMessage,
        finishedAt,
        progressPercent: status === "completed" ? 100 : currentJob.progressPercent,
        resultSummary: result
          ? {
              emails: result.emails.length,
              transactions: result.transactions.length,
              people: result.people.length,
              warnings: result.warnings.length
            }
          : currentJob.resultSummary,
        eventType: status === "completed" ? "jobs.job.completed" : "jobs.job.failed"
      });
      await registerJobQueueClosed(currentJob, {
        status,
        source: "function-self-check",
        metadata: {
          stage,
          error: errorMessage || ""
        }
      });

      if (!worker.killed) {
        try {
          worker.kill("SIGTERM");
        } catch {
          // Ignore late kill failures.
        }
      }

      completeQueueTask(status === "completed");
      logJob(status === "completed" ? "info" : "error", "jobs.job.finalized", {
        jobId: currentJob.id,
        status,
        stage,
        errorMessage,
        finishedAt
      });
    };

    activeControllers.set(currentJob.id, {
      jobId: currentJob.id,
      stop: async () => {
        logJob("warn", "jobs.worker.stop_requested", {
          jobId: currentJob.id
        });
        await finalizeJob({
          status: "failed",
          stage: "任务已中止",
          errorMessage: CLOSE_ABORT_MESSAGE
        });
      },
      delete: async () => {
        logJob("warn", "jobs.worker.delete_requested", {
          jobId: currentJob.id,
          pid: worker.pid || 0
        });
        deleted = true;
        settled = true;

        if (!workerExited) {
          try {
            worker.kill("SIGTERM");
          } catch {
            // Ignore kill failures during deletion.
          }
        }

        let didExit = workerExited;
        if (!didExit) {
          didExit = await waitForWorkerExit(workerExitPromise, 3000);
        }

        if (!didExit && !workerExited) {
          try {
            worker.kill("SIGKILL");
          } catch {
            // Ignore force kill failures.
          }
          await waitForWorkerExit(workerExitPromise, 1000);
        }

        activeControllers.delete(currentJob.id);
        await registerJobQueueClosed(currentJob, {
          status: "deleted",
          source: "function-self-check"
        });

        forgetActiveManifestJob(currentJob);
        jobs.delete(currentJob.id);
        if (currentJob.checkpointId) {
          checkpointJobs.delete(currentJob.checkpointId);
        }
        if (currentJob.uploadSessionId) {
          await deleteUploadSession(userDataPath, currentJob.uploadSessionId);
        }
        if (currentJob.checkpointTreeId) {
          await deleteCheckpointTree({
            userDataPath,
            treeId: currentJob.checkpointTreeId
          }).catch(() => null);
        }
        await durableWorkflows.failWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), "Job deleted.").catch(() => null);
        await fs.rm(getJobDirectory(userDataPath, currentJob.id), {
          recursive: true,
          force: true
        });
        await publishDeletedJobEvent(currentJob);
        completeQueueTask(false);
        logJob("info", "jobs.job.deleted", {
          jobId: currentJob.id,
          wasRunning: true
        });
        return cloneJobForApi(currentJob);
      },
      preserveForRecovery: async () => {
        logJob("info", "jobs.worker.preserve_for_recovery.started", {
          jobId: currentJob.id,
          pid: worker.pid || 0
        });
        preservedForRecovery = true;
        await updateJobCheckpointNode(currentJob, {
          nodeId: "worker-run",
          parentId: "import-parse-job",
          label: RECOVERY_STAGE_MESSAGE,
          status: "paused",
          cursor: {
            progressPercent: Number(currentJob.progressPercent || 0),
            stage: currentJob.stage || ""
          }
        });
        await finishJobCheckpoint(currentJob, {
          status: "paused",
          message: RECOVERY_STAGE_MESSAGE,
          metadata: {
            progressPercent: Number(currentJob.progressPercent || 0),
            stage: currentJob.stage || ""
          }
        });
        await updateJob(currentJob.id, {
          status: "queued",
          stage: RECOVERY_STAGE_MESSAGE,
          error: "",
          finishedAt: undefined,
          eventType: "jobs.job.recovered"
        });
        await durableWorkflows.recordSignal(currentJob.workflowId || workflowIdForJob(currentJob), "job.preserve_for_recovery", {
          jobId: currentJob.id,
          progressPercent: Number(currentJob.progressPercent || 0),
          stage: currentJob.stage || ""
        }).catch(() => null);
        await durableWorkflows.recoverWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), {
          reason: "worker_preserved_for_recovery"
        }).catch(() => null);
        await registerJobQueueHeartbeat(currentJob, {
          phase: "queued",
          source: "function-self-check",
          metadata: {
            preservedForRecovery: true
          }
        });

        if (!workerExited) {
          try {
            worker.kill("SIGTERM");
          } catch {
            // Ignore kill failures during shutdown recovery.
          }
        }

        let didExit = workerExited;
        if (!didExit) {
          didExit = await waitForWorkerExit(workerExitPromise, 3000);
        }

        if (!didExit && !workerExited) {
          try {
            worker.kill("SIGKILL");
          } catch {
            // Ignore force kill failures during shutdown recovery.
          }
          await waitForWorkerExit(workerExitPromise, 1000);
        }

        activeControllers.delete(currentJob.id);
        completeQueueTask(false);
        logJob("info", "jobs.worker.preserve_for_recovery.completed", {
          jobId: currentJob.id
        });
      }
    });

    await updateJobCheckpointNode(currentJob, {
      nodeId: "queued",
      parentId: "import-parse-job",
      label: "等待后台 worker",
      status: "completed",
      cursor: {
        workerConcurrency
      }
    });
    await updateJobCheckpointNode(currentJob, {
      nodeId: "start-worker",
      parentId: "import-parse-job",
      label: "启动后台 worker",
      status: "completed",
      metadata: {
        pid: worker.pid || 0
      }
    });
    await updateJobCheckpointNode(currentJob, {
      nodeId: "worker-run",
      parentId: "import-parse-job",
      label: "后台 worker 执行",
      status: "running",
      cursor: {
        progressPercent: 3,
        stage: "后台任务已启动"
      }
    });

    await updateJob(currentJob.id, {
        status: "running",
        stage: "后台任务已启动",
        startedAt: new Date().toISOString(),
        finishedAt: undefined,
        error: "",
        progressPercent: 3,
        eventType: "jobs.job.started"
      });
    await registerJobQueueHeartbeat(currentJob, {
      phase: "running",
      source: "function-self-check"
    });
    queueHeartbeatTimer = setInterval(() => {
      void registerJobQueueHeartbeat(currentJob, {
        phase: "running",
        source: "function-self-check"
      });
    }, QUEUE_HEARTBEAT_INTERVAL_MS);
    queueHeartbeatTimer.unref?.();
    removeQueuedEntry(currentJob.id);
    logJob("info", "jobs.worker.started", {
      jobId: currentJob.id,
      pid: worker.pid || 0
    });

    worker.on("message", (message) => {
      if (!message || typeof message !== "object") {
        logJob("warn", "jobs.worker.message.ignored", {
          jobId: currentJob.id,
          reason: "invalid_message"
        });
        return;
      }

      if (message.type === "progress") {
        logJob("debug", "jobs.worker.progress", {
          jobId: currentJob.id,
          progressPercent:
            typeof message.progressPercent === "number"
              ? message.progressPercent
              : currentJob.progressPercent,
          stage: message.stage || "处理中"
        });
        void updateJobCheckpointNode(currentJob, {
          nodeId: "worker-run",
          parentId: "import-parse-job",
          label: message.stage || "处理中",
          status: "running",
          cursor: {
            progressPercent:
              typeof message.progressPercent === "number"
                ? message.progressPercent
                : currentJob.progressPercent,
            stage: message.stage || "处理中"
          }
        });
        void updateJob(currentJob.id, {
          stage: message.stage || "处理中",
          progressPercent:
            typeof message.progressPercent === "number"
              ? message.progressPercent
              : currentJob.progressPercent,
          eventType: "jobs.job.progress"
        });
        void durableWorkflows.heartbeatActivity(currentJob.workflowId || workflowIdForJob(currentJob), "worker-run", {
          progressPercent:
            typeof message.progressPercent === "number"
              ? message.progressPercent
              : currentJob.progressPercent,
          stage: message.stage || "处理中"
        }).catch(() => null);
        void registerJobQueueHeartbeat(currentJob, {
          phase: "running",
          source: "function-self-check",
          metadata: {
            progressMessage: message.stage || "处理中"
          }
        });
        return;
      }

      if (message.type === "completed") {
        logJob("info", "jobs.worker.completed_message", {
          jobId: currentJob.id,
          resultSummary: {
            emails: message.result?.emails?.length || 0,
            transactions: message.result?.transactions?.length || 0,
            people: message.result?.people?.length || 0,
            warnings: message.result?.warnings?.length || 0
          }
        });
        void finalizeJob({
          status: "completed",
          stage: "任务已完成",
          result: message.result
        });
        return;
      }

      if (message.type === "failed") {
        logJob("error", "jobs.worker.failed_message", {
          jobId: currentJob.id,
          error: message.error || "后台任务执行失败。"
        });
        void finalizeJob({
          status: "failed",
          stage: "执行失败",
          errorMessage: message.error || "后台任务执行失败。"
        });
      }
    });

    worker.once("error", (error) => {
      logJob("error", "jobs.worker.error", {
        jobId: currentJob.id,
        pid: worker.pid || 0,
        error: summarizeError(error)
      });
      markWorkerExited();
    });

    worker.once("exit", (code, signal) => {
      markWorkerExited();
      logJob(settled || deleted || preservedForRecovery ? "info" : "error", "jobs.worker.exited", {
        jobId: currentJob.id,
        pid: worker.pid || 0,
        code,
        signal,
        settled,
        deleted,
        preservedForRecovery
      });

      if (deleted) {
        return;
      }

      if (preservedForRecovery) {
        return;
      }

      if (settled) {
        return;
      }

      const codeText = typeof code === "number" ? String(code) : "null";
      const signalText = signal || "none";
      void finalizeJob({
        status: "failed",
        stage: "执行失败",
        errorMessage: `后台执行进程异常退出（code=${codeText}, signal=${signalText}）。`
      });
    });

    const workerPayload = {
      type: "run",
      jobId: currentJob.id,
      trace: currentJob.trace || traceDetails(),
      userDataPath,
      runtimeOptions: resolveCurrentRuntimeOptions(),
      payload: nextEntry.payload
    };
    logJob("info", "jobs.worker.run_message.sent", {
      jobId: currentJob.id,
      pid: worker.pid || 0,
      message: summarizeForLog(workerPayload)
    });
    worker.send(workerPayload);

    return queueTaskPromise;
  }

  return {
    async createJob(payload) {
      logJob("info", "jobs.job.create.requested", {
        payload: summarizeForLog(payload)
      });
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }

      if (closed) {
        logJob("error", "jobs.job.create.rejected", {
          reason: "closed"
        });
        throw new Error("后台任务管理器已经关闭。");
      }

      const checkpointId = normalizeCheckpointId(payload);
      const manifestKey = normalizeManifestKey(payload);
      const archiveBatchId = normalizeArchiveBatchId(payload) || serverToken("archive_batch", checkpointId || manifestKey || randomUUID());
      const forceNewVersion = shouldForceNewJobVersion(payload);
      const versionGroupId = normalizeVersionGroupId(payload, {
        checkpointId,
        manifestKey,
        archiveBatchId
      });
      const versionNumber = nextVersionNumberForJobs(jobs, {
        versionGroupId,
        checkpointId,
        manifestKey
      });
      const parentJobId = normalizeParentJobId(payload);
      const existingJobId = checkpointId ? checkpointJobs.get(checkpointId) : "";
      if (!forceNewVersion && existingJobId) {
        const existingJob = jobs.get(existingJobId) || null;
        if (existingJob) {
          await publishJobEvent(existingJob, "jobs.job.reused");
        }
        logJob("info", "jobs.job.create.reused", {
          jobId: existingJobId,
          checkpointId,
          reason: "checkpoint_id"
        });
        return cloneJobForApi(existingJob);
      }
      const existingManifestJob = getActiveManifestJob(manifestKey, archiveBatchId);
      if (!forceNewVersion && existingManifestJob) {
        if (checkpointId) {
          checkpointJobs.set(checkpointId, existingManifestJob.id);
        }
        await publishJobEvent(existingManifestJob, "jobs.job.reused");
        logJob("info", "jobs.job.create.reused", {
          jobId: existingManifestJob.id,
          manifestKey,
          reason: "manifest_key"
        });
        return cloneJobForApi(existingManifestJob);
      }

      const now = new Date().toISOString();
      const trace = traceDetails();
      const job = {
        id: randomUUID(),
        trace,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        progressPercent: 0,
        stage: "等待执行",
        checkpointId,
        checkpointTreeId: "",
        workflowId: "",
        queueId: "",
        checkpointReceipt: payload?.checkpointReceipt || null,
        uploadSessionId: String(payload?.uploadSessionId || ""),
        archiveBatchId,
        versionGroupId,
        versionNumber,
        parentJobId,
        reparseFromJobId: String(payload?.reparseFromJobId || "")
      };
      job.queueId = queueIdForJob(job);
      job.checkpointTreeId = checkpointTreeIdForJob(job);
      job.workflowId = workflowIdForJob(job);
      await ensureJobCheckpointTree(job, payload);
      await durableWorkflows.startWorkflow({
        workflowId: job.workflowId,
        workflowType: "import_parse_job",
        ownerKind: "import_parse_job",
        ownerId: job.id,
        idempotencyKey: checkpointId || manifestKey || archiveBatchId,
        inputHash: manifestKey || checkpointId || archiveBatchId,
        input: {
          checkpointId,
          archiveBatchId,
          uploadSessionId: job.uploadSessionId || "",
          manifestSha256: manifestKey
        },
        checkpointTreeId: job.checkpointTreeId
      });
      await durableWorkflows.scheduleActivity(job.workflowId, {
        activityId: "queue-wait",
        activityType: "queue_wait",
        idempotencyKey: `${job.id}:queue-wait`,
        input: {
          queueId: job.queueId,
          queuePosition: queuedEntries.length + 1
        },
        retryPolicy: {
          maxAttempts: 1
        }
      });
      await durableWorkflows.completeActivity(job.workflowId, "queue-wait", {
        queuedAt: now
      });
      await updateJobCheckpointNode(job, {
        nodeId: "queued",
        parentId: "import-parse-job",
        label: "等待后台 worker",
        status: "running",
        cursor: {
          queuePosition: queuedEntries.length + 1
        },
        metadata: {
          checkpointId,
          manifestSha256: manifestKey
        }
      });

      jobs.set(job.id, job);
      if (checkpointId) {
        checkpointJobs.set(checkpointId, job.id);
      }
      rememberActiveManifestJob(job);
      await persistJobMeta(userDataPath, job);
      await persistJobPayload(userDataPath, job.id, payload);
      await registerJobQueueStarted(job, {
        phase: "queued",
        source: "function-self-check",
        metadata: {
          manifestSha256: manifestKey
        }
      });
      if (processingEnabled && !externalScheduler) {
        enqueueQueueEntry({
          jobId: job.id,
          payload
        });
      }
      await publishJobEvent(job, "jobs.job.created");
      logJob("info", "jobs.job.created", {
        jobId: job.id,
        checkpointId,
        archiveBatchId,
        manifestKey,
        uploadSessionId: job.uploadSessionId || "",
        processingEnabled
      });
      return cloneJobForApi(job);
    },

    async reparseJob(jobId, options = {}) {
      logJob("info", "jobs.job.reparse.requested", {
        jobId,
        options: summarizeForLog(options)
      });
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const sourceJob = jobs.get(jobId);
      if (!sourceJob) {
        throw new Error("历史任务不存在，不能重新解析。");
      }

      const sourcePayload = await loadJobPayload(userDataPath, sourceJob.id);
      const sourceResult = sourceJob.status === "completed"
        ? await this.getJobResult(sourceJob.id).catch(() => null)
        : null;
      const sourceFiles = Array.isArray(sourceResult?.sourceFiles) ? sourceResult.sourceFiles : [];
      const replayUploadedFiles = [];
      const replayTextSections = [];

      for (const [index, source] of sourceFiles.entries()) {
        const record = source && typeof source === "object" ? source : {};
        const storageRelativePath = String(record.storageRelativePath || "").trim();
        if (storageRelativePath) {
          const stagedPath = resolveStoredObjectPath(userDataPath, storageRelativePath);
          try {
            const stats = await fs.stat(stagedPath);
            if (stats.isFile()) {
              const originalName = String(
                record.originalFileName ||
                  record.originalRelativePath ||
                  record.name ||
                  `source-${index + 1}`
              );
              replayUploadedFiles.push({
                name: String(record.rawObjectId || record.id || originalName),
                relativePath: String(record.originalRelativePath || originalName),
                originalFileName: originalName,
                mediaType: String(record.mediaType || "application/octet-stream"),
                stagedPath,
                sha256: String(record.rawObjectSha256 || record.contentHash || ""),
                byteSize: Number(record.rawObjectByteSize || stats.size || 0),
                clientUid: String(record.clientUid || sourcePayload?.clientUid || ""),
                sourceType: String(record.sourceType || sourcePayload?.sourceType || "upload"),
                providerId: String(record.providerId || ""),
                externalId: String(record.externalId || ""),
                syncBatchId: String(record.syncBatchId || ""),
                contentHash: String(record.contentHash || record.rawObjectSha256 || ""),
                capturedAt: String(record.capturedAt || ""),
                sourceMetadata:
                  record.sourceMetadata && typeof record.sourceMetadata === "object" && !Array.isArray(record.sourceMetadata)
                    ? record.sourceMetadata
                    : {}
              });
              continue;
            }
          } catch {
            // Fall back to the parsed text snapshot below when the raw object is no longer available.
          }
        }

        const text = String(record.text || "").trim();
        if (text) {
          const name = String(record.originalFileName || record.name || `source-${index + 1}`);
          replayTextSections.push(`# ${name}\n\n${text}`);
        }
      }

      const replayInputText =
        replayTextSections.length > 0
          ? replayTextSections.join("\n\n---\n\n")
          : String(sourcePayload?.inputText || "").trim();
      const hasReplayInput =
        replayUploadedFiles.length > 0 ||
          replayInputText.length > 0;

      if (!hasReplayInput) {
        throw new Error("历史任务没有保留可重新解析的原始文件或正文。请重新上传原文件后再解析。");
      }

      const checkpointId = normalizeCheckpointId(sourcePayload || sourceJob);
      const manifestKey = normalizeManifestKey(sourcePayload || sourceJob);
      const versionGroupId = normalizeVersionGroupId(sourceJob.versionGroupId ? sourceJob : sourcePayload || sourceJob, {
        checkpointId,
        manifestKey,
        archiveBatchId: sourceJob.archiveBatchId || ""
      });
      const archiveBatchId = serverToken("archive_batch", versionGroupId, randomUUID());
      const checkpointReceipt = {
        ...(sourcePayload?.checkpointReceipt || sourceJob.checkpointReceipt || {}),
        checkpointId,
        archiveBatchId,
        versionGroupId,
        reparseFromJobId: sourceJob.id
      };
      const checkpoint = {
        ...(sourcePayload?.checkpoint || {}),
        checkpointId,
        archiveBatchId
      };
      const reparsePayload = {
        ...(sourcePayload || {}),
        inputText: replayUploadedFiles.length > 0
          ? ""
          : replayInputText,
        filePaths: [],
        uploadedFiles: replayUploadedFiles,
        uploadSessionId: "",
        checkpoint,
        checkpointId,
        archiveBatchId,
        checkpointReceipt,
        settings: options?.settings || sourcePayload?.settings || {},
        documentParsing: options?.documentParsing || sourcePayload?.documentParsing || {},
        forceNewVersion: true,
        reparseFromJobId: sourceJob.id,
        parentJobId: sourceJob.id,
        versionGroupId
      };
      const job = await this.createJob(reparsePayload);
      logJob("info", "jobs.job.reparse.created", {
        parentJobId: sourceJob.id,
        jobId: job?.id || "",
        versionGroupId,
        archiveBatchId
      });
      return job;
    },

    async dispatchQueuedJob(jobId, options = {}) {
      await ready;
      if (!processingEnabled) {
        throw new Error("后台任务执行器未启用，不能调度业务任务。");
      }
      if (closed) {
        throw new Error("后台任务管理器已经关闭。");
      }
      const normalizedJobId = String(jobId || options.jobId || "").trim();
      if (!normalizedJobId) {
        throw new Error("jobId is required.");
      }
      const currentJob = jobs.get(normalizedJobId) || null;
      if (!currentJob) {
        throw new Error(`任务不存在，不能调度：${normalizedJobId}`);
      }
      if (currentJob.status !== "queued") {
        return {
          dispatched: false,
          skipped: true,
          job: cloneJobForApi(currentJob),
          reason: `status_${currentJob.status || "unknown"}`
        };
      }
      const payload = options.payload || await loadJobPayload(userDataPath, normalizedJobId);
      if (!payload) {
        throw new Error(`任务缺少 payload，不能调度：${normalizedJobId}`);
      }
      const completed = await runQueuedJob({
        jobId: normalizedJobId,
        payload
      }, {
        externalSchedulerDispatch: true
      });
      return {
        dispatched: true,
        completed: Boolean(completed),
        job: cloneJobForApi(jobs.get(normalizedJobId) || currentJob)
      };
    },

    async getJob(jobId) {
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      return cloneJobForApi(jobs.get(jobId) || null);
    },

    async getJobWorkflow(jobId) {
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const currentJob = jobs.get(jobId);
      if (!currentJob) {
        return null;
      }
      return durableWorkflows.getWorkflow(currentJob.workflowId || workflowIdForJob(currentJob));
    },

    async listJobWorkflows(input = {}) {
      await ready;
      return durableWorkflows.listWorkflows({
        ownerKind: "import_parse_job",
        ...input
      });
    },

    async listJobs({ limit = 50 } = {}) {
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
      const items = [...jobs.values()]
        .map((job) => cloneJobForApi(job))
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, safeLimit);

      const activeJobIds = [...activeControllers.keys()];

      return {
        summary: {
          totalCount: jobs.size,
          queuedCount: [...jobs.values()].filter((job) => job.status === "queued").length,
          runningCount: [...jobs.values()].filter((job) => job.status === "running").length,
          completedCount: [...jobs.values()].filter((job) => job.status === "completed").length,
          failedCount: [...jobs.values()].filter((job) => job.status === "failed").length,
          activeJobId: activeJobIds[0] || "",
          activeJobIds,
          workerConcurrency: processingEnabled ? workerConcurrency : 0,
          processingMode: processingEnabled ? "internal" : "external",
          queuedJobIds: queuedEntries.map((entry) => entry.jobId)
        },
        items
      };
    },

    async getJobByCheckpointId(checkpointId) {
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const jobId = checkpointJobs.get(normalizeCheckpointId(checkpointId));
      if (!jobId) {
        return null;
      }

      return cloneJobForApi(jobs.get(jobId) || null);
    },

    async getJobResult(jobId) {
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const currentJob = jobs.get(jobId);

      if (!currentJob) {
        return null;
      }

      if (currentJob.status !== "completed") {
        throw new Error("任务尚未完成，暂时不能读取结果。");
      }

      const content = await fs.readFile(getJobResultPath(userDataPath, jobId), "utf8");
      return JSON.parse(content);
    },

    async deleteJob(jobId) {
      logJob("warn", "jobs.job.delete.requested", {
        jobId
      });
      await ready;
      if (!processingEnabled) {
        await refreshPersistedJobs();
      }
      const currentJob = jobs.get(jobId);

      if (!currentJob) {
        logJob("warn", "jobs.job.delete.skipped", {
          jobId,
          reason: "job_missing"
        });
        return null;
      }

      if (currentJob.status === "queued") {
        removeQueuedEntry(jobId);
        await registerJobQueueClosed(currentJob, {
          status: "deleted",
          source: "function-self-check"
        });
      }

      if (currentJob.status === "running") {
        if (!processingEnabled) {
          throw new Error("任务由外部后台 worker 执行，当前不能从 API 进程直接删除运行中的任务。");
        }
        const activeController = activeControllers.get(jobId);
        if (!activeController || typeof activeController.delete !== "function") {
          throw new Error("运行中的任务当前不可删除。");
        }

        return activeController.delete();
      }

      jobs.delete(jobId);
      forgetActiveManifestJob(currentJob);
      if (currentJob.checkpointId) {
        checkpointJobs.delete(currentJob.checkpointId);
      }
      if (currentJob.uploadSessionId) {
        await deleteUploadSession(userDataPath, currentJob.uploadSessionId);
      }
      if (currentJob.checkpointTreeId) {
        await deleteCheckpointTree({
          userDataPath,
          treeId: currentJob.checkpointTreeId
        }).catch(() => null);
      }
      if (currentJob.status !== "completed") {
        await durableWorkflows.failWorkflow(currentJob.workflowId || workflowIdForJob(currentJob), "Job deleted.").catch(() => null);
      }
      await fs.rm(getJobDirectory(userDataPath, jobId), {
        recursive: true,
        force: true
      });
      await publishDeletedJobEvent(currentJob);
      await registerJobQueueClosed(currentJob, {
        status: "deleted",
        source: "function-self-check"
      });
      logJob("info", "jobs.job.deleted", {
        jobId,
        wasRunning: false,
        status: currentJob.status
      });
      return cloneJobForApi(currentJob);
    },

    async scanPersistedQueue() {
      logJob("info", "jobs.queue.scan.requested", {});
      await ready;
      if (!processingEnabled || closed) {
        logJob("warn", "jobs.queue.scan.skipped", {
          reason: processingEnabled ? "closed" : "external"
        });
        return {
          scanned: false,
          reason: processingEnabled ? "closed" : "external"
        };
      }

      await refreshPersistedJobs();
      const queuedIds = new Set(queuedEntries.map((entry) => entry.jobId));
      const activeJobIds = [...activeControllers.keys()];
      let enqueued = 0;
      const candidates = [...jobs.values()]
        .filter((job) => job.status === "queued")
        .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));

      for (const job of candidates) {
        await registerJobQueueHeartbeat(job, {
          phase: "queued",
          source: "function-self-check",
          metadata: {
            scan: true
          }
        });
        if (!job?.id || queuedIds.has(job.id) || activeControllers.has(job.id)) {
          continue;
        }
        const payload = await loadJobPayload(userDataPath, job.id);
        if (!payload) {
          await failJob(job.id, "任务缺少 payload，不能由后台 worker 执行。", "任务恢复失败");
          continue;
        }
        if (externalScheduler) {
          queuedIds.add(job.id);
          enqueued += 1;
          continue;
        }
        const queued = enqueueQueueEntry({
          jobId: job.id,
          payload
        });
        if (queued) {
          queuedIds.add(job.id);
          enqueued += 1;
        }
      }
      logJob("info", "jobs.queue.scan.completed", {
        enqueued,
        queuedCount: queuedEntries.length,
        activeJobIds
      });
      return {
        scanned: true,
        enqueued,
        queuedCount: queuedEntries.length,
        activeJobId: activeJobIds[0] || "",
        activeJobIds
      };
    },

    async close() {
      logJob("info", "jobs.manager.close.started", {});
      await ready;
      closed = true;
      importQueue.pause();
      importQueue.clear();

      for (const queuedEntry of [...queuedEntries]) {
        const queuedJob = jobs.get(queuedEntry.jobId);
        if (queuedJob) {
          await updateJobCheckpointNode(queuedJob, {
            nodeId: "queued",
            parentId: "import-parse-job",
            label: RECOVERY_STAGE_MESSAGE,
            status: "paused",
            cursor: {
              stage: RECOVERY_STAGE_MESSAGE
            }
          });
          await finishJobCheckpoint(queuedJob, {
            status: "paused",
            message: RECOVERY_STAGE_MESSAGE
          });
        }
        await updateJob(queuedEntry.jobId, {
          status: "queued",
          stage: RECOVERY_STAGE_MESSAGE,
          error: "",
          finishedAt: undefined,
          eventType: "jobs.job.recovered"
        });
      }
      queuedEntries.length = 0;
      queuedEntryIds.clear();

      await Promise.all(
        [...activeControllers.values()].map((activeController) =>
          activeController.preserveForRecovery()
        )
      );
      logJob("info", "jobs.manager.close.completed", {});
    }
  };
}
