import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import EventEmitter from "node:events";
import os from "node:os";
import path from "node:path";

import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
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
const workerPidCounter = vi.hoisted(() => ({ value: 1_600 }));

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
    const behavior = nextWorkerBehavior();
    return createFakeWorkerFromPlan(behavior);
  })
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
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
  emails: [
    { email: "a@example.com", confidence: 0.9 }
  ],
  transactions: [
    { id: "t-1" }
  ],
  people: [{ name: "Alice" }],
  warnings: [{ code: "w-1" }]
};

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-extra-"));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
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

async function waitForMockCall(mockFn, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    if (mockFn.mock.calls.length > 0) {
      return mockFn.mock.calls;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return [];
}

async function seedPersistedJob(userDataPath, jobId, meta, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta), "utf8");
  if (payload !== null) {
    await fs.writeFile(path.join(jobDir, "payload.json"), JSON.stringify(payload), "utf8");
  }
}

describe("job manager extra", () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    queueMonitorStarted.mockClear();
    queueMonitorHeartbeat.mockClear();
    queueMonitorClosed.mockClear();
    queueMonitorId.mockClear?.();
    workerBehaviorQueue.length = 0;
    workerPidCounter.value = 1_600;
  });

  it("创建、列举与读取：持久化元数据与 payload，支持 checkpoint 去重", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        processingEnabled: false,
        protocolEventBus
      });

      const payload = {
        checkpointReceipt: {
          checkpointId: "demo-checkpoint"
        },
        checkpointId: "demo-checkpoint",
        inputText: "hello world",
        sourceType: "upload"
      };

      const created = await manager.createJob(payload);
      const listed = await manager.listJobs({ limit: 10 });
      const duplicate = await manager.createJob(payload);
      const byId = await manager.getJob(created.id);
      const byCheckpoint = await manager.getJobByCheckpointId("demo-checkpoint");
      const resultPath = path.join(userDataPath, "jobs", created.id, "result.json");
      const metaPath = path.join(userDataPath, "jobs", created.id, "meta.json");
      const payloadPath = path.join(userDataPath, "jobs", created.id, "payload.json");

      expect(created.id).toBe(duplicate.id);
      expect(created.status).toBe("queued");
      expect(byId).toMatchObject({
        id: created.id,
        status: "queued",
        checkpointId: expect.any(String)
      });
      expect(byCheckpoint).toMatchObject({ id: created.id });
      expect(listed.summary).toMatchObject({
        totalCount: 1,
        queuedCount: 1,
        completedCount: 0,
        failedCount: 0,
        processingMode: "external"
      });
      expect(Array.isArray(listed.items)).toBe(true);
      await expect(fs.stat(metaPath)).resolves.toBeTruthy();
      await expect(fs.stat(payloadPath)).resolves.toBeTruthy();
      await expect(fs.stat(resultPath)).rejects.toThrow();
      await expect(fs.readFile(payloadPath, "utf8")).resolves.toContain("hello world");
      await expect(manager.getJobResult(created.id)).rejects.toThrow("任务尚未完成，暂时不能读取结果。");
      await expect(manager.getJob("not-exists")).resolves.toBeNull();
    });
  });

  it("运行流程：从 queued 转到 running 再到 completed 并持久化 result", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior((worker, message) => {
        expect(message.type).toBe("run");
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 55,
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
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "complete-checkpoint"
        },
        checkpointId: "complete-checkpoint",
        inputText: "complete"
      });

      const running = await waitForJobStatus(manager, created.id, "running");
      expect(running).not.toBeNull();

      const completed = await waitForJobStatus(manager, created.id, "completed");
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

      const finalResult = await manager.getJobResult(created.id);
      expect(finalResult).toMatchObject(COMPLETED_RESULT);

      const list = await manager.listJobs({ limit: 20 });
      expect(list.summary.completedCount).toBe(1);
      expect(list.summary.queuedCount).toBe(0);
      expect(list.summary.processingMode).toBe("internal");

      const resultPath = path.join(userDataPath, "jobs", created.id, "result.json");
      const persisted = JSON.parse(await fs.readFile(resultPath, "utf8"));
      expect(persisted).toMatchObject(COMPLETED_RESULT);
      await expect(waitForMockCall(queueMonitorClosed)).resolves.not.toHaveLength(0);
    });
  });

  it("失败路径：worker 回报失败后 job 变为 failed 且不能读取 result", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "failed",
            error: "mock worker failed"
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "failed-checkpoint"
        },
        checkpointId: "failed-checkpoint",
        inputText: "fail now"
      });
      const failed = await waitForJobStatus(manager, created.id, "failed");

      expect(failed).not.toBeNull();
      expect(failed).toMatchObject({
        status: "failed",
        error: "mock worker failed"
      });
      await expect(manager.getJobResult(created.id)).rejects.toThrow("任务尚未完成，暂时不能读取结果。");
      await expect(waitForMockCall(queueMonitorClosed)).resolves.not.toHaveLength(0);
    });
  });

  it("取消进行中任务：deleteJob 会清理运行中任务目录和内存并返回任务快照", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 20,
            stage: "处理中文件"
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "delete-checkpoint"
        },
        checkpointId: "delete-checkpoint",
        inputText: "cancel me"
      });
      const running = await waitForJobStatus(manager, created.id, "running");
      expect(running).not.toBeNull();

      const deleted = await manager.deleteJob(created.id);
      expect(deleted).toMatchObject({ id: created.id });

      const afterDelete = await manager.getJob(created.id);
      expect(afterDelete).toBeNull();

      const jobDir = path.join(userDataPath, "jobs", created.id);
      await expect(fs.stat(jobDir)).rejects.toThrow();
    });
  });

  it("关闭管理器时会将运行中任务置为 queued 以便后续重试恢复", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 31,
            stage: "准备回退"
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "recover-checkpoint"
        },
        checkpointId: "recover-checkpoint",
        inputText: "recover later"
      });

      const running = await waitForJobStatus(manager, created.id, "running");
      expect(running).not.toBeNull();

      await manager.close();
      const recovered = await waitForJobStatus(manager, created.id, "queued");

      expect(recovered).toMatchObject({
        status: "queued",
        stage: "服务已恢复，任务等待重试。"
      });
      await expect(queueMonitorHeartbeat).toHaveBeenCalled();
      await expect(queueMonitorClosed).not.toHaveBeenCalled();
    });
  });

  it("外部模式：queued 任务可直接删除，scanPersistedQueue 会跳过外部模式", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: false
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "external-delete-checkpoint"
        },
        checkpointId: "external-delete-checkpoint",
        inputText: "external queued job"
      });

      const scan = await manager.scanPersistedQueue();
      const deleted = await manager.deleteJob(created.id);
      const list = await manager.listJobs({ limit: 10 });

      expect(created.status).toBe("queued");
      expect(scan).toMatchObject({
        scanned: false,
        reason: "external"
      });
      expect(deleted).toMatchObject({
        id: created.id,
        status: "queued"
      });
      expect(list.summary).toMatchObject({
        totalCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        processingMode: "external",
        workerConcurrency: 0
      });
      await expect(manager.getJob(created.id)).resolves.toBeNull();
      await expect(fs.stat(path.join(userDataPath, "jobs", created.id))).rejects.toThrow();
    });
  });

  it("worker 异常退出时会将任务落为 failed 并记录错误信息", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior((worker) => {
        setTimeout(() => {
          worker.emit("exit", 2, null);
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "abnormal-exit-checkpoint"
        },
        checkpointId: "abnormal-exit-checkpoint",
        inputText: "exit without result"
      });

      const failed = await waitForJobStatus(manager, created.id, "failed");

      expect(failed).not.toBeNull();
      expect(failed).toMatchObject({
        status: "failed",
        stage: "执行失败"
      });
      expect(String(failed.error || "")).toContain("code=2");
      await expect(waitForMockCall(queueMonitorClosed)).resolves.not.toHaveLength(0);
    });
  });

  it("启动恢复：磁盘上缺少 payload 的 queued 任务会被标记为 failed", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const jobId = "persisted-missing-payload";

      await seedPersistedJob(userDataPath, jobId, {
        id: jobId,
        status: "queued",
        createdAt: "2026-06-04T08:00:00.000Z",
        updatedAt: "2026-06-04T08:00:00.000Z",
        progressPercent: 27,
        stage: "等待执行",
        checkpointId: "persisted-missing-payload-checkpoint"
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const recovered = await waitForJobStatus(manager, jobId, "failed");
      const list = await manager.listJobs({ limit: 10 });

      expect(recovered).not.toBeNull();
      expect(recovered).toMatchObject({
        id: jobId,
        status: "failed",
        stage: "任务恢复失败",
        error: "服务重启后缺少任务 payload，不能继续恢复。"
      });
      expect(list.summary.failedCount).toBe(1);
      expect(list.summary.queuedCount).toBe(0);
    });
  });

  it("重解析：completed 历史任务会生成新的版本并重新进入队列", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
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
        protocolEventBus,
        processingEnabled: true
      });

      const source = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "reparse-checkpoint"
        },
        checkpointId: "reparse-checkpoint",
        inputText: "retry me",
        sourceType: "upload"
      });

      const sourceCompleted = await waitForJobStatus(manager, source.id, "completed");
      expect(sourceCompleted).not.toBeNull();

      const reparsed = await manager.reparseJob(source.id, {
        settings: {
          mode: "retry"
        }
      });

      expect(reparsed).toMatchObject({
        parentJobId: source.id,
        reparseFromJobId: source.id,
        checkpointId: source.checkpointId,
        versionGroupId: source.versionGroupId,
        versionNumber: source.versionNumber + 1
      });
      expect(reparsed.status).toBe("queued");

      const reparsedCompleted = await waitForJobStatus(manager, reparsed.id, "completed");
      const list = await manager.listJobs({ limit: 10 });

      expect(reparsedCompleted).not.toBeNull();
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
      expect(list.summary.completedCount).toBe(2);
      expect(list.summary.failedCount).toBe(0);
    });
  });
});
