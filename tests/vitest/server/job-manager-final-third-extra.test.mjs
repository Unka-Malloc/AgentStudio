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
const workerPidCounter = vi.hoisted(() => ({ value: 8_000 }));

function scheduleWorkerBehavior(behavior) {
  workerBehaviorQueue.push(behavior);
}

function nextWorkerBehavior() {
  return workerBehaviorQueue.shift() || null;
}

function createFakeWorkerFromPlan(plan = {}) {
  const behavior = typeof plan === "function" ? { onSend: plan } : plan;
  const worker = new EventEmitter();

  worker.pid = workerPidCounter.value++;
  worker.killed = false;
  worker.exitCode = null;
  worker.signalCode = null;
  worker.killedBy = null;

  worker.send = vi.fn((message) => {
    if (typeof behavior.onSend === "function") {
      behavior.onSend(worker, message);
    }
  });

  worker.kill = vi.fn((signal = "SIGTERM") => {
    if (worker.killed) {
      return false;
    }
    worker.killed = true;
    worker.killedBy = signal;
    if (behavior.suppressKillExit === true) {
      return true;
    }
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

const RECOVERY_STAGE_MESSAGE = "服务已恢复，任务等待重试。";

const COMPLETED_RESULT = {
  emails: [{ email: "a@example.com", confidence: 0.97 }],
  transactions: [{ id: "tx-1" }],
  people: [{ name: "Alice" }],
  warnings: [{ code: "w-1" }]
};

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-final-third-extra-"));
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

async function waitForJobStatus(manager, jobId, status, timeoutMs = 5000) {
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

async function waitForLogCall(logMock, eventName, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const call = logMock.mock.calls.find((entry) => entry?.[0] === eventName);
    if (call) {
      return call;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

async function waitForLogCount(logMock, eventName, count, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const matches = logMock.mock.calls.filter((entry) => entry?.[0] === eventName);
    if (matches.length >= count) {
      return matches;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return logMock.mock.calls.filter((entry) => entry?.[0] === eventName);
}

async function seedPersistedJob(userDataPath, jobId, meta, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta), "utf8");
  if (payload !== null) {
    await fs.writeFile(path.join(jobDir, "payload.json"), JSON.stringify(payload), "utf8");
  }
}

describe("job manager final third extra", () => {
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
    workerPidCounter.value = 8_000;
  });

  it("关闭管理器时会将 running 和 queued 任务都恢复为 queued，并保留恢复态", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 51,
            stage: "恢复执行中"
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        },
        protocolEventBus: createEventBusSpy()
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "recovery-running-checkpoint"
        },
        checkpointId: "recovery-running-checkpoint",
        inputText: "running recovery"
      });
      const running = await waitForJobStatus(manager, first.id, "running");

      const second = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "recovery-queued-checkpoint"
        },
        checkpointId: "recovery-queued-checkpoint",
        inputText: "queued recovery"
      });
      const queuedBeforeClose = await waitForJobStatus(manager, second.id, "queued");

      expect(running).not.toBeNull();
      expect(queuedBeforeClose).not.toBeNull();

      await manager.close();

      const recoveredRunning = await waitForJobStatus(manager, first.id, "queued");
      const recoveredQueued = await waitForJobStatus(manager, second.id, "queued");

      expect(recoveredRunning).toMatchObject({
        id: first.id,
        status: "queued",
        stage: RECOVERY_STAGE_MESSAGE
      });
      expect(recoveredQueued).toMatchObject({
        id: second.id,
        status: "queued",
        stage: RECOVERY_STAGE_MESSAGE
      });
      await waitForLogCount(loggerMock.info, "jobs.worker.exited", 1);
    });
  });

  it("scanPersistedQueue 在缺少 payload 时会把历史队列项标记为 failed", async () => {
    await withTempUserData(async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus: createEventBusSpy()
      });

      await manager.listJobs({ limit: 1 });

      const jobId = "scan-missing-payload-job";
      await seedPersistedJob(userDataPath, jobId, {
        id: jobId,
        status: "queued",
        createdAt: "2026-06-05T09:00:00.000Z",
        updatedAt: "2026-06-05T09:00:00.000Z",
        progressPercent: 0,
        stage: "等待执行",
        checkpointId: "scan-missing-payload-checkpoint"
      });

      const scanResult = await manager.scanPersistedQueue();
      const failed = await waitForJobStatus(manager, jobId, "failed");

      expect(scanResult).toMatchObject({
        scanned: true,
        enqueued: 0
      });
      expect(failed).toMatchObject({
        id: jobId,
        status: "failed",
        stage: "任务恢复失败",
        error: "任务缺少 payload，不能由后台 worker 执行。"
      });
    });
  });

  it("队列监控写入失败会被吞掉，任务仍可完成并保留结果", async () => {
    await withTempUserData(async (userDataPath) => {
      queueMonitorStarted.mockRejectedValueOnce(new Error("start monitor failed"));
      queueMonitorHeartbeat.mockRejectedValueOnce(new Error("heartbeat monitor failed"));
      queueMonitorClosed.mockRejectedValueOnce(new Error("close monitor failed"));

      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 66,
            stage: "解析中"
          });
        }, 0);
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 20);
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus: createEventBusSpy()
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "queue-monitor-failure-checkpoint"
        },
        checkpointId: "queue-monitor-failure-checkpoint",
        inputText: "queue monitor failure"
      });

      const completed = await waitForJobStatus(manager, created.id, "completed");
      const startLog = await waitForLogCall(loggerMock.warn, "jobs.queue_monitor.start.failed");
      const heartbeatLog = await waitForLogCall(loggerMock.warn, "jobs.queue_monitor.heartbeat.failed");
      const closeLog = await waitForLogCall(loggerMock.warn, "jobs.queue_monitor.close.failed");

      expect(completed).toMatchObject({
        id: created.id,
        status: "completed",
        resultSummary: {
          emails: 1,
          transactions: 1,
          people: 1,
          warnings: 1
        }
      });
      expect(startLog?.[1]).toMatchObject({
        jobId: created.id,
        error: "start monitor failed"
      });
      expect(heartbeatLog?.[1]).toMatchObject({
        jobId: created.id,
        error: "heartbeat monitor failed"
      });
      expect(closeLog?.[1]).toMatchObject({
        jobId: created.id,
        error: "close monitor failed"
      });
      const persistedResult = JSON.parse(
        await fs.readFile(path.join(userDataPath, "jobs", created.id, "result.json"), "utf8")
      );
      expect(persistedResult).toMatchObject({
        emails: [{ email: "a@example.com" }]
      });
      await waitForLogCount(loggerMock.info, "jobs.worker.exited", 1);
    });
  });

  it("worker failed 消息和 error 事件都会被记录，默认失败文案也会落盘", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("error", new Error("worker socket error"));
        }, 0);
        setTimeout(() => {
          worker.emit("message", {
            type: "failed",
            error: ""
          });
        }, 15);
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus: createEventBusSpy()
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "worker-failed-message-checkpoint"
        },
        checkpointId: "worker-failed-message-checkpoint",
        inputText: "fail me"
      });

      const failed = await waitForJobStatus(manager, created.id, "failed");
      const errorLog = await waitForLogCall(loggerMock.error, "jobs.worker.error");
      const failedMessageLog = await waitForLogCall(loggerMock.error, "jobs.worker.failed_message");

      expect(failed).toMatchObject({
        id: created.id,
        status: "failed",
        stage: "执行失败"
      });
      expect(String(failed?.error || "")).toContain("后台任务执行失败。");
      expect(errorLog?.[1]).toMatchObject({
        jobId: created.id,
        error: "worker socket error"
      });
      expect(failedMessageLog?.[1]).toMatchObject({
        jobId: created.id,
        error: "后台任务执行失败。"
      });
      await waitForLogCount(loggerMock.info, "jobs.worker.exited", 1);
    });
  });

  it("重解析时即使 result.json 缺失，也能从 payload 回退并创建新版本", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 0);
      });
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus: createEventBusSpy()
      });

      const source = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "reparse-result-missing-checkpoint"
        },
        checkpointId: "reparse-result-missing-checkpoint",
        inputText: "retry me"
      });

      const sourceCompleted = await waitForJobStatus(manager, source.id, "completed");
      expect(sourceCompleted).toMatchObject({
        id: source.id,
        status: "completed"
      });

      await fs.rm(path.join(userDataPath, "jobs", source.id, "result.json"), {
        force: true
      });

      const reparsed = await manager.reparseJob(source.id, {
        settings: {
          mode: "retry"
        }
      });

      const reparsedCompleted = await waitForJobStatus(manager, reparsed.id, "completed");

      expect(reparsed).toMatchObject({
        parentJobId: source.id,
        reparseFromJobId: source.id,
        checkpointId: source.checkpointId,
        versionGroupId: source.versionGroupId,
        versionNumber: source.versionNumber + 1
      });
      expect(reparsedCompleted).toMatchObject({
        id: reparsed.id,
        status: "completed",
        parentJobId: source.id,
        reparseFromJobId: source.id,
        resultSummary: {
          emails: 1,
          transactions: 1,
          people: 1,
          warnings: 1
        }
      });
      await waitForLogCount(loggerMock.info, "jobs.worker.exited", 2);
    });
  });

  it("队列内的 queued 任务可以在运行中删除，并会清理队列登记", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 25,
            stage: "处理中文件"
          });
        }, 0);
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 300);
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        },
        protocolEventBus: createEventBusSpy()
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "delete-queued-first-checkpoint"
        },
        checkpointId: "delete-queued-first-checkpoint",
        inputText: "first"
      });
      const running = await waitForJobStatus(manager, first.id, "running");
      expect(running).not.toBeNull();

      const second = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "delete-queued-second-checkpoint"
        },
        checkpointId: "delete-queued-second-checkpoint",
        inputText: "second"
      });
      const queued = await waitForJobStatus(manager, second.id, "queued");
      expect(queued).not.toBeNull();

      const deleted = await manager.deleteJob(second.id);
      const afterDelete = await manager.getJob(second.id);
      const queueClosedLog = await waitForLogCall(loggerMock.info, "jobs.job.deleted");

      expect(deleted).toMatchObject({
        id: second.id,
        status: "queued"
      });
      expect(afterDelete).toBeNull();
      expect(queueClosedLog?.[1]).toMatchObject({
        jobId: second.id,
        wasRunning: false,
        status: "queued"
      });

      const jobDir = path.join(userDataPath, "jobs", second.id);
      await expect(fs.stat(jobDir)).rejects.toThrow();
      const completedFirst = await waitForJobStatus(manager, first.id, "completed");
      expect(completedFirst).toMatchObject({
        id: first.id,
        status: "completed"
      });
      await waitForLogCount(loggerMock.info, "jobs.worker.exited", 1);
    });
  });

  it("运行中的任务删除会在 worker 未退出时升级为强制终止并清理持久化状态", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior({
        suppressKillExit: true,
        onSend(worker) {
          setTimeout(() => {
            worker.emit("message", {
              type: "progress",
              progressPercent: 45,
              stage: "等待删除"
            });
          }, 0);
        }
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        },
        protocolEventBus: createEventBusSpy()
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "delete-running-checkpoint"
        },
        checkpointId: "delete-running-checkpoint",
        inputText: "delete while running"
      });

      const running = await waitForJobStatus(manager, created.id, "running");
      expect(running).not.toBeNull();

      const deleted = await manager.deleteJob(created.id);
      const afterDelete = await manager.getJob(created.id);
      const deleteLog = await waitForLogCall(loggerMock.info, "jobs.job.deleted");

      expect(deleted).toMatchObject({
        id: created.id,
        status: "running"
      });
      expect(afterDelete).toBeNull();
      expect(deleteLog?.[1]).toMatchObject({
        jobId: created.id,
        wasRunning: true
      });
      expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
      await expect(fs.stat(path.join(userDataPath, "jobs", created.id))).rejects.toThrow();
    });
  }, 10_000);
});
