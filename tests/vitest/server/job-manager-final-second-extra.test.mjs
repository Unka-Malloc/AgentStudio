import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import EventEmitter from "node:events";
import os from "node:os";
import path from "node:path";

import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";

const workerShouldThrow = vi.hoisted(() => ({ value: false }));
const workerBehaviorQueue = vi.hoisted(() => []);
const workerPidCounter = vi.hoisted(() => ({ value: 5_000 }));

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
  fork: vi.fn(() => {
    if (workerShouldThrow.value) {
      throw new Error("mock worker start failure");
    }
    const behavior = nextWorkerBehavior();
    return createFakeWorkerFromPlan(behavior);
  })
}));

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

const COMPLETED_RESULT = {
  emails: [{ email: "alice@example.com", confidence: 0.97 }],
  transactions: [{ id: "tx-1" }],
  people: [{ name: "Alice" }],
  warnings: [{ code: "w-1" }]
};

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-final-second-extra-"));
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

function waitForJobStatus(manager, jobId, status, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < end) {
      const job = await manager.getJob(jobId);
      if (job && job.status === status) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  })();
}

function waitForPublishedEvent(protocolEventBus, type, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < end) {
      const eventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
      if (eventTypes.includes(type)) {
        return eventTypes;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
  })();
}

async function seedPersistedJob(userDataPath, jobId, meta, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta), "utf8");
  if (payload !== null) {
    await fs.writeFile(path.join(jobDir, "payload.json"), JSON.stringify(payload), "utf8");
  }
}

describe("job manager final second extra", () => {
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
    workerPidCounter.value = 5_000;
    workerShouldThrow.value = false;
  });

  it("会接受无效输入，默认生成 checkpoint，并对错误 checkpoint 查询给出空结果", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: false,
        protocolEventBus
      });

      const created = await manager.createJob({});

      expect(created.checkpointId).toBe("");
      expect(created.checkpointReceipt).toBeNull();
      expect(created.versionNumber).toBe(1);
      expect(await manager.getJobByCheckpointId(null)).toBeNull();
      expect(await manager.getJobByCheckpointId({ checkpointReceipt: { checkpointId: "" } })).toBeNull();
      await expect(manager.deleteJob(created.id)).resolves.toMatchObject({ id: created.id });
      await expect(manager.getJob(created.id)).resolves.toBeNull();
      const calls = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);
      expect(calls).toContain("jobs.job.created");
      expect(calls).not.toContain("jobs.job.failed");
    });
  });

  it("会在 worker 启动失败时进入 failed 且正确发布失败事件", async () => {
    await withTempUserData(async (userDataPath) => {
      workerShouldThrow.value = true;
      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "worker-spawn-fail-checkpoint"
        },
        checkpointId: "worker-spawn-fail-checkpoint",
        inputText: "fail-spawn"
      });

      const failed = await waitForJobStatus(manager, created.id, "failed");
      const eventTypes = await waitForPublishedEvent(protocolEventBus, "jobs.job.updated");

      expect(failed).not.toBeNull();
      expect(failed).toMatchObject({
        status: "failed",
        stage: "任务启动失败"
      });
      expect((failed?.error || "")).toContain("mock worker start failure");
      expect(eventTypes).toContain("jobs.job.updated");
      expect(eventTypes).not.toContain("jobs.job.failed");
      expect(eventTypes).toContain("jobs.job.created");
    });
  });

  it("会忽略无效 worker 消息，仍能在有效完成后持久化结果并发布 started/progress/completed 事件", async () => {
    await withTempUserData(async (userDataPath) => {
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", "invalid-payload");
        }, 0);
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            stage: "自定义进度"
          });
        }, 10);
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 20);
      });

      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        protocolEventBus
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "invalid-message-checkpoint"
        },
        checkpointId: "invalid-message-checkpoint",
        inputText: "ignore-invalid-message"
      });
      const completed = await waitForJobStatus(manager, created.id, "completed");
      const eventTypes = await waitForPublishedEvent(protocolEventBus, "jobs.job.completed");

      expect(completed).not.toBeNull();
      expect(completed).toMatchObject({
        status: "completed",
        stage: "任务已完成",
        resultSummary: {
          emails: 1,
          transactions: 1,
          people: 1,
          warnings: 1
        }
      });
      expect(eventTypes).toContain("jobs.job.started");
      expect(eventTypes).toContain("jobs.job.progress");
      expect(eventTypes).toContain("jobs.job.completed");
      expect(eventTypes).not.toContain("jobs.job.failed");
      const content = await fs.readFile(path.join(userDataPath, "jobs", created.id, "result.json"), "utf8");
      expect(JSON.parse(content)).toMatchObject(COMPLETED_RESULT);
    });
  });

  it("扫描已落地队列时遇到可恢复任务的已入队项会跳过，不重复入队", async () => {
    await withTempUserData(async (userDataPath) => {
      const jobId = "persisted-scan-missing-payload";
      await seedPersistedJob(
        userDataPath,
        jobId,
        {
          id: jobId,
          status: "queued",
          createdAt: "2026-06-06T12:00:00.000Z",
          updatedAt: "2026-06-06T12:00:00.000Z",
          progressPercent: 0,
          stage: "等待执行",
          checkpointId: "scan-missing-payload"
        },
        {
          inputText: "scan-missing"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });
      await waitForJobStatus(manager, jobId, "queued");
      await fs.rm(path.join(userDataPath, "jobs", jobId, "payload.json"), { force: true });

      const scanResult = await manager.scanPersistedQueue();
      const after = await manager.getJob(jobId);

      expect(scanResult).toMatchObject({
        scanned: true,
        enqueued: 0,
        queuedCount: expect.any(Number)
      });
      expect(after).toMatchObject({
        id: jobId,
        status: "queued",
        stage: "服务已恢复，任务等待重试。"
      });
      await manager.close();
    });
  });

  it("关闭状态下扫描不会重新调度，返回 closed 原因", async () => {
    await withTempUserData(async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "scan-closed-checkpoint"
        },
        checkpointId: "scan-closed-checkpoint",
        inputText: "closed scan"
      });
      await manager.close();

      const scan = await manager.scanPersistedQueue();

      expect(scan).toMatchObject({
        scanned: false,
        reason: "closed"
      });
      const recovered = await manager.getJob(created.id);
      expect(recovered).toMatchObject({
        id: created.id,
        status: "queued"
      });
    });
  });

  it("会拒绝外部运行态任务删除，并返回 null 处理不存在任务", async () => {
    await withTempUserData(async (userDataPath) => {
      const runningJobId = "persisted-running-job";
      await seedPersistedJob(
        userDataPath,
        runningJobId,
        {
          id: runningJobId,
          status: "running",
          createdAt: "2026-06-06T12:10:00.000Z",
          updatedAt: "2026-06-06T12:10:00.000Z",
          progressPercent: 50,
          stage: "后台任务已启动",
          checkpointId: "running-delete-checkpoint"
        },
        {
          inputText: "running-delete"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });

      await expect(manager.deleteJob(runningJobId)).rejects.toThrow(
        "任务由外部后台 worker 执行，当前不能从 API 进程直接删除运行中的任务。"
      );
      await expect(manager.deleteJob("missing-job-id")).resolves.toBeNull();
    });
  });
});
