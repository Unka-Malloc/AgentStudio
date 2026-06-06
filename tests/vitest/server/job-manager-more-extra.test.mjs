import { beforeEach, describe, expect, it, vi } from "vitest";
import EventEmitter from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const durableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async () => null),
  recoverWorkflow: vi.fn(async () => null),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  heartbeatActivity: vi.fn(async () => null),
  getWorkflow: vi.fn(async () => null),
  listWorkflows: vi.fn(async () => ({ items: [] }))
}));

const queueMonitorStarted = vi.hoisted(() => vi.fn(async (_userDataPath, input = {}) => ({
  queueId: input.queueId || "",
  status: String(input.status || input.phase || "queued")
})));

const queueMonitorHeartbeat = vi.hoisted(() => vi.fn(async (_userDataPath, input = {}) => ({
  queueId: input.queueId || "",
  stage: input.stage || ""
})));

const queueMonitorClosed = vi.hoisted(() => vi.fn(async (_userDataPath, input = {}) => ({
  queueId: input.queueId || "",
  status: input.status || "closed"
})));

const queueMonitorId = vi.hoisted(() => vi.fn((kind, ownerId) => `queue_${kind}_${ownerId}`));

const workerBehaviorQueue = vi.hoisted(() => []);
const workerPidCounter = vi.hoisted(() => ({ value: 9_000 }));

function scheduleWorkerBehavior(behavior) {
  workerBehaviorQueue.push(behavior);
}

function nextWorkerBehavior() {
  return workerBehaviorQueue.shift() || null;
}

function createFakeWorkerFromPlan(plan = {}) {
  const behavior = typeof plan === "function" ? { onSend: plan } : plan;
  const worker = new EventEmitter();
  const pid = workerPidCounter.value++;

  worker.pid = pid;
  worker.killed = false;
  worker.exitCode = null;
  worker.signalCode = null;
  worker.killedBy = null;

  worker.send = vi.fn((message) => {
    if (behavior && typeof behavior.onSend === "function") {
      behavior.onSend(worker, message);
    }
  });

  worker.kill = vi.fn((signal = "SIGTERM") => {
    if (worker.killed) {
      return false;
    }
    worker.killed = true;
    worker.killedBy = signal;
    setTimeout(() => {
      if (!worker.exitCode && !worker.signalCode) {
        worker.exitCode = 0;
        worker.signalCode = signal;
        worker.emit("exit", 0, signal);
      }
    }, 0);
    return true;
  });

  worker.unref = vi.fn();
  return worker;
}

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => createFakeWorkerFromPlan(nextWorkerBehavior()))
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    deleteCheckpointTree: vi.fn(async () => null),
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: vi.fn((error) => error?.message || String(error || "")),
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" }))
  };
});

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/client/work-queue-core/queue-monitor.mjs");
  return {
    ...actual,
    queueMonitorId,
    registerQueueStarted: queueMonitorStarted,
    registerQueueHeartbeat: queueMonitorHeartbeat,
    registerQueueClosed: queueMonitorClosed
  };
});

import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { serverToken } from "../../../server/platform/interactive/product-api.mjs";

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-more-extra-"));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
}

function createEventBusSpy() {
  return {
    publish: vi.fn(async () => null)
  };
}

async function waitForJobStatus(manager, jobId, status, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const job = await manager.getJob(jobId);
    if (job && job.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

async function waitForPublishedEvent(protocolEventBus, predicate, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
    if (eventTypes.some(predicate)) {
      return eventTypes;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
}

describe("job manager more extra", () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    durableWorkflowRuntimeMock.startWorkflow.mockClear();
    durableWorkflowRuntimeMock.recoverWorkflow.mockClear();
    durableWorkflowRuntimeMock.scheduleActivity.mockClear();
    durableWorkflowRuntimeMock.startActivity.mockClear();
    durableWorkflowRuntimeMock.completeActivity.mockClear();
    durableWorkflowRuntimeMock.failActivity.mockClear();
    durableWorkflowRuntimeMock.failWorkflow.mockClear();
    durableWorkflowRuntimeMock.completeWorkflow.mockClear();
    durableWorkflowRuntimeMock.recordSignal.mockClear();
    durableWorkflowRuntimeMock.heartbeatActivity.mockClear();
    durableWorkflowRuntimeMock.getWorkflow.mockClear();
    durableWorkflowRuntimeMock.listWorkflows.mockClear();
    queueMonitorStarted.mockClear();
    queueMonitorHeartbeat.mockClear();
    queueMonitorClosed.mockClear();
    queueMonitorId.mockClear?.();
    workerBehaviorQueue.length = 0;
    workerPidCounter.value = 9_000;
  });

  it("会复用同一 manifest 的活跃任务，并在强制新版本时创建新任务", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manifestSha256 = "a".repeat(64);
      const archiveBatchId = serverToken("archive_batch", "shared-archive");
      const versionGroupId = serverToken("parse_version_group", "shared-group");
      const manager = createJobManager({
        userDataPath,
        processingEnabled: false,
        protocolEventBus
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "manifest-first",
          manifestSha256,
          archiveBatchId,
          versionGroupId
        },
        checkpointId: "manifest-first",
        manifestSha256,
        archiveBatchId,
        versionGroupId,
        inputText: "first"
      });
      const reused = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "manifest-second",
          manifestSha256,
          archiveBatchId,
          versionGroupId
        },
        checkpointId: "manifest-second",
        manifestSha256,
        archiveBatchId,
        versionGroupId,
        inputText: "second"
      });
      const forced = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "manifest-second",
          manifestSha256,
          archiveBatchId,
          versionGroupId
        },
        checkpointId: "manifest-second",
        manifestSha256,
        archiveBatchId,
        versionGroupId,
        forceNewVersion: true,
        inputText: "forced"
      });
      const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);

      expect(reused.id).toBe(first.id);
      expect(forced.id).not.toBe(first.id);
      expect(forced.versionNumber).toBe(2);
      expect(eventTypes).toContain("jobs.job.reused");
      expect(eventTypes).toContain("jobs.job.created");
    });
  });

  it("worker 意外退出时会落入失败分支并保留退出码与信号", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("exit", 7, "SIGABRT");
        }, 0);
      });

      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "unexpected-exit-checkpoint"
        },
        checkpointId: "unexpected-exit-checkpoint",
        inputText: "unexpected exit"
      });

      const failed = await waitForJobStatus(manager, created.id, "failed");
      const eventTypes = await waitForPublishedEvent(
        protocolEventBus,
        (type) => type === "jobs.job.updated" || type === "jobs.job.failed"
      );

      expect(failed).toMatchObject({
        id: created.id,
        status: "failed",
        stage: "执行失败"
      });
      expect(String(failed?.error || "")).toContain("code=7");
      expect(String(failed?.error || "")).toContain("signal=SIGABRT");
      expect(eventTypes).toContain("jobs.job.created");
      expect(eventTypes.some((type) => type === "jobs.job.updated" || type === "jobs.job.failed")).toBe(true);
    });
  });

  it("删除已完成任务时不会再走 failWorkflow，并会清理落盘目录", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: {
              emails: [{ email: "done@example.com", confidence: 0.99 }],
              transactions: [],
              people: [],
              warnings: []
            }
          });
        }, 0);
      });

      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "completed-delete-checkpoint"
        },
        checkpointId: "completed-delete-checkpoint",
        inputText: "complete me"
      });
      const completed = await waitForJobStatus(manager, created.id, "completed");
      const result = await manager.getJobResult(created.id);
      const deleted = await manager.deleteJob(created.id);
      const afterDelete = await manager.getJob(created.id);
      const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);

      expect(completed).toMatchObject({
        id: created.id,
        status: "completed"
      });
      expect(result).toMatchObject({
        emails: [{ email: "done@example.com", confidence: 0.99 }]
      });
      expect(deleted).toMatchObject({
        id: created.id,
        status: "completed"
      });
      expect(afterDelete).toBeNull();
      expect(durableWorkflowRuntimeMock.failWorkflow).not.toHaveBeenCalled();
      expect(eventTypes).toContain("jobs.job.completed");
      expect(eventTypes).toContain("jobs.deleted");
      await expect(fs.stat(path.join(userDataPath, "jobs", created.id))).rejects.toThrow();
    });
  });

  it("缺失任务和工作流查询会返回空值，并允许无参列举 workflow", async () => {
    await withTempUserData(async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });

      await expect(manager.getJob("missing-job")).resolves.toBeNull();
      await expect(manager.getJobWorkflow("missing-job")).resolves.toBeNull();
      await expect(manager.getJobResult("missing-job")).resolves.toBeNull();
      const workflows = await manager.listJobWorkflows();

      expect(workflows).toMatchObject({
        items: []
      });
      expect(durableWorkflowRuntimeMock.listWorkflows).toHaveBeenCalledWith({
        ownerKind: "import_parse_job"
      });
    });
  });
});
