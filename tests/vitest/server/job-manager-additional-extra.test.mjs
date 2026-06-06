import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import EventEmitter from "node:events";
import os from "node:os";
import path from "node:path";

const durableWorkflowRecords = vi.hoisted(() => new Map());

const durableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async (input = {}) => {
    const workflowId = String(input.workflowId || "");
    const record = {
      ...input,
      workflowId
    };
    if (workflowId) {
      durableWorkflowRecords.set(workflowId, record);
    }
    return record;
  }),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  heartbeatActivity: vi.fn(async () => null),
  recoverWorkflow: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  getWorkflow: vi.fn(async (workflowId) => durableWorkflowRecords.get(String(workflowId || "")) || null),
  listWorkflows: vi.fn(async (input = {}) => {
    const items = [...durableWorkflowRecords.values()].filter((workflow) =>
      !input.ownerKind || workflow.ownerKind === input.ownerKind
    );
    const limit = Math.max(1, Math.min(200, Number(input.limit) || items.length || 50));
    return {
      items: items.slice(0, limit),
      totalCount: items.length,
      ownerKind: input.ownerKind || "",
      input
    };
  })
}));

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
const workerPidCounter = vi.hoisted(() => ({ value: 4_200 }));

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
    const behavior = nextWorkerBehavior();
    return createFakeWorkerFromPlan(behavior);
  })
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

const COMPLETED_RESULT = {
  emails: [{ email: "a@example.com", confidence: 0.9 }],
  transactions: [{ id: "t-1" }],
  people: [{ name: "Alice" }],
  warnings: [{ code: "w-1" }]
};

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-additional-extra-"));
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

async function waitForMockCall(mock, predicate, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const match = mock.mock.calls.find((call) => predicate(...call));
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

async function seedPersistedJob(userDataPath, jobId, meta, { payload = undefined, result = undefined } = {}) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta), "utf8");
  if (payload !== undefined) {
    await fs.writeFile(
      path.join(jobDir, "payload.json"),
      typeof payload === "string" ? payload : JSON.stringify(payload),
      "utf8"
    );
  }
  if (result !== undefined) {
    await fs.writeFile(
      path.join(jobDir, "result.json"),
      typeof result === "string" ? result : JSON.stringify(result),
      "utf8"
    );
  }
}

describe("job manager additional extra", () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    queueMonitorStarted.mockClear();
    queueMonitorHeartbeat.mockClear();
    queueMonitorClosed.mockClear();
    queueMonitorId.mockClear?.();
    durableWorkflowRecords.clear();
    durableWorkflowRuntimeMock.startWorkflow.mockClear();
    durableWorkflowRuntimeMock.scheduleActivity.mockClear();
    durableWorkflowRuntimeMock.startActivity.mockClear();
    durableWorkflowRuntimeMock.completeActivity.mockClear();
    durableWorkflowRuntimeMock.heartbeatActivity.mockClear();
    durableWorkflowRuntimeMock.recoverWorkflow.mockClear();
    durableWorkflowRuntimeMock.failActivity.mockClear();
    durableWorkflowRuntimeMock.failWorkflow.mockClear();
    durableWorkflowRuntimeMock.completeWorkflow.mockClear();
    durableWorkflowRuntimeMock.recordSignal.mockClear();
    durableWorkflowRuntimeMock.getWorkflow.mockClear();
    durableWorkflowRuntimeMock.listWorkflows.mockClear();
    workerBehaviorQueue.length = 0;
    workerPidCounter.value = 4_200;
  });

  it("会截断 checkpointReceipt.files，并在 create/get/list 中保留摘要与队列状态", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const files = Array.from({ length: 6 }, (_, index) => ({
        name: `input-${index + 1}.txt`,
        relativePath: `input-${index + 1}.txt`,
        mediaType: "text/plain"
      }));

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: false
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "truncated-checkpoint",
          fileCount: files.length,
          files
        },
        checkpointId: "truncated-checkpoint",
        inputText: "truncate me"
      });

      const byId = await manager.getJob(created.id);
      const listed = await manager.listJobs({ limit: 10 });

      expect(created.checkpointReceipt).toMatchObject({
        checkpointId: "truncated-checkpoint",
        filesTruncated: true,
        filesReturned: 5,
        filesTotal: 6
      });
      expect(created.checkpointReceipt.files).toBeUndefined();
      expect(created.checkpointReceipt.fileSamples).toHaveLength(5);
      expect(byId?.checkpointReceipt).toMatchObject({
        checkpointId: "truncated-checkpoint",
        filesTruncated: true,
        filesReturned: 5,
        filesTotal: 6
      });
      expect(byId?.checkpointReceipt.files).toBeUndefined();
      expect(listed.items[0].checkpointReceipt.fileSamples).toHaveLength(5);
      expect(listed.summary).toMatchObject({
        totalCount: 1,
        queuedCount: 1,
        completedCount: 0,
        failedCount: 0,
        processingMode: "external",
        workerConcurrency: 0
      });
    });
  });

  it("会通过 public workflow 方法读取和列举 durable workflow", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: false
      });

      const created = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "workflow-checkpoint"
        },
        checkpointId: "workflow-checkpoint",
        inputText: "workflow lookup"
      });

      const workflow = await manager.getJobWorkflow(created.id);
      const workflowList = await manager.listJobWorkflows({
        limit: 5,
        status: "running"
      });

      expect(workflow).toMatchObject({
        workflowId: created.workflowId,
        ownerId: created.id,
        ownerKind: "import_parse_job"
      });
      expect(workflowList.items).toHaveLength(1);
      expect(workflowList.items[0]).toMatchObject({
        workflowId: created.workflowId,
        ownerId: created.id
      });
      expect(durableWorkflowRuntimeMock.listWorkflows).toHaveBeenCalledWith({
        ownerKind: "import_parse_job",
        limit: 5,
        status: "running"
      });
    });
  });

  it("会忽略损坏的 meta/payload，并在结果文件缺失或损坏时让 getJobResult 失败", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();

      await seedPersistedJob(userDataPath, "broken-meta", "{");

      await seedPersistedJob(userDataPath, "broken-payload", {
        id: "broken-payload",
        status: "queued",
        createdAt: "2026-06-04T07:59:00.000Z",
        updatedAt: "2026-06-04T07:59:00.000Z",
        progressPercent: 0,
        stage: "等待执行",
        checkpointId: "broken-payload-checkpoint"
      }, {
        payload: "not-json"
      });

      await seedPersistedJob(userDataPath, "missing-result", {
        id: "missing-result",
        status: "completed",
        createdAt: "2026-06-04T07:58:00.000Z",
        updatedAt: "2026-06-04T07:58:00.000Z",
        finishedAt: "2026-06-04T07:58:00.000Z",
        progressPercent: 100,
        stage: "任务已完成",
        checkpointId: "missing-result-checkpoint"
      });

      await seedPersistedJob(userDataPath, "broken-result", {
        id: "broken-result",
        status: "completed",
        createdAt: "2026-06-04T07:57:00.000Z",
        updatedAt: "2026-06-04T07:57:00.000Z",
        finishedAt: "2026-06-04T07:57:00.000Z",
        progressPercent: 100,
        stage: "任务已完成",
        checkpointId: "broken-result-checkpoint"
      }, {
        result: "not-json"
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true
      });

      const list = await manager.listJobs({ limit: 20 });
      const brokenMeta = await manager.getJob("broken-meta");
      const brokenPayload = await manager.getJob("broken-payload");

      expect(list.summary).toMatchObject({
        totalCount: 2,
        queuedCount: 0,
        completedCount: 2,
        failedCount: 0,
        processingMode: "internal"
      });
      expect(list.items.map((item) => item.id)).toEqual([
        "missing-result",
        "broken-result"
      ]);
      expect(brokenMeta).toBeNull();
      expect(brokenPayload).toBeNull();
      await expect(manager.getJobResult("missing-result")).rejects.toThrow();
      await expect(manager.getJobResult("broken-result")).rejects.toThrow();
    });
  });

  it("close 会把 queued 与 running 任务都保留为可恢复状态", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      scheduleWorkerBehavior();

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        runtimeOptions: {
          workerConcurrency: 1
        },
        processingEnabled: true
      });

      const first = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "close-first"
        },
        checkpointId: "close-first",
        inputText: "keep running"
      });

      const running = await waitForJobStatus(manager, first.id, "running");
      expect(running).not.toBeNull();

      const second = await manager.createJob({
        checkpointReceipt: {
          checkpointId: "close-second"
        },
        checkpointId: "close-second",
        inputText: "keep queued"
      });

      expect(second.status).toBe("queued");

      await manager.close();

      const firstRecovered = await waitForJobStatus(manager, first.id, "queued");
      const secondRecovered = await waitForJobStatus(manager, second.id, "queued");
      const list = await manager.listJobs({ limit: 20 });

      expect(firstRecovered).toMatchObject({
        id: first.id,
        status: "queued",
        stage: "服务已恢复，任务等待重试。"
      });
      expect(secondRecovered).toMatchObject({
        id: second.id,
        status: "queued",
        stage: "服务已恢复，任务等待重试。"
      });
      expect(list.summary).toMatchObject({
        queuedCount: 2,
        runningCount: 0,
        activeJobIds: [],
        processingMode: "internal"
      });
      expect(list.summary.queuedJobIds).toEqual([]);
      expect(queueMonitorHeartbeat).toHaveBeenCalled();
      expect(queueMonitorClosed).not.toHaveBeenCalled();
    });
  });

  it("按创建时间恢复持久化 queued 任务并派发到 worker", async () => {
    await withTempUserData(async (userDataPath) => {
      const dispatched = [];
      const completeRecoveredWorker = (worker, message) => {
        dispatched.push(message.jobId);
        setTimeout(() => {
          worker.emit("message", {
            type: "completed",
            result: COMPLETED_RESULT
          });
        }, 0);
      };
      scheduleWorkerBehavior(completeRecoveredWorker);
      scheduleWorkerBehavior(completeRecoveredWorker);

      await seedPersistedJob(userDataPath, "recover-newer", {
        id: "recover-newer",
        status: "queued",
        createdAt: "2026-06-05T08:10:00.000Z",
        updatedAt: "2026-06-05T08:10:00.000Z",
        checkpointId: "recover-newer-checkpoint"
      }, {
        payload: {
          checkpointId: "recover-newer-checkpoint",
          inputText: "newer"
        }
      });
      await seedPersistedJob(userDataPath, "recover-older", {
        id: "recover-older",
        status: "queued",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z",
        checkpointId: "recover-older-checkpoint"
      }, {
        payload: {
          checkpointId: "recover-older-checkpoint",
          inputText: "older"
        }
      });
      await fs.writeFile(path.join(userDataPath, "jobs", "notes.txt"), "ignored", "utf8");

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        }
      });

      const olderCompleted = await waitForJobStatus(manager, "recover-older", "completed");
      const newerCompleted = await waitForJobStatus(manager, "recover-newer", "completed");
      const list = await manager.listJobs({ limit: 10 });

      expect(olderCompleted).toMatchObject({
        id: "recover-older",
        status: "completed"
      });
      expect(newerCompleted).toMatchObject({
        id: "recover-newer",
        status: "completed"
      });
      expect(dispatched).toEqual(["recover-older", "recover-newer"]);
      expect(list.summary).toMatchObject({
        completedCount: 2,
        failedCount: 0,
        queuedCount: 0
      });
    });
  });

  it("记录 queue monitor 写入失败但不阻断 worker 完成", async () => {
    await withTempUserData(async (userDataPath) => {
      queueMonitorStarted.mockRejectedValueOnce(new Error("start monitor unavailable"));
      queueMonitorHeartbeat.mockRejectedValueOnce(new Error("heartbeat monitor unavailable"));
      queueMonitorClosed.mockRejectedValueOnce(new Error("close monitor unavailable"));
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
        runtimeOptions: {
          workerConcurrency: 1
        }
      });

      const created = await manager.createJob({
        checkpointId: "monitor-reject-checkpoint",
        inputText: "monitor rejects"
      });
      const completed = await waitForJobStatus(manager, created.id, "completed");
      const warnStart = await waitForMockCall(
        loggerMock.warn,
        (event) => event === "jobs.queue_monitor.start.failed"
      );
      const warnHeartbeat = await waitForMockCall(
        loggerMock.warn,
        (event) => event === "jobs.queue_monitor.heartbeat.failed"
      );
      const warnClose = await waitForMockCall(
        loggerMock.warn,
        (event) => event === "jobs.queue_monitor.close.failed"
      );

      expect(completed).toMatchObject({
        id: created.id,
        status: "completed"
      });
      expect(warnStart).not.toBeNull();
      expect(warnHeartbeat).not.toBeNull();
      expect(warnClose).not.toBeNull();
    });
  });

  it("运行中的任务可通过 deleteJob 终止并清理持久化状态", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBusSpy();
      let activeWorker = null;
      scheduleWorkerBehavior((worker) => {
        activeWorker = worker;
        setTimeout(() => {
          worker.emit("message", {
            type: "progress",
            progressPercent: 31,
            stage: "处理中"
          });
        }, 0);
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        }
      });

      const created = await manager.createJob({
        checkpointId: "running-delete-checkpoint",
        uploadSessionId: "upload_session_11111111111111111111111111111111",
        inputText: "delete while running"
      });
      const running = await waitForJobStatus(manager, created.id, "running");

      expect(running).toMatchObject({
        id: created.id,
        status: "running"
      });

      const deleted = await manager.deleteJob(created.id);
      const afterDelete = await manager.getJob(created.id);
      const deleteEventTypes = protocolEventBus.publish.mock.calls.map((call) => call?.[2]?.type);

      expect(deleted).toMatchObject({
        id: created.id,
        status: "running"
      });
      expect(afterDelete).toBeNull();
      expect(activeWorker?.kill).toHaveBeenCalledWith("SIGTERM");
      expect(queueMonitorClosed).toHaveBeenCalledWith(
        userDataPath,
        expect.objectContaining({
          ownerId: created.id,
          phase: "closed",
          status: "running"
        })
      );
      expect(deleteEventTypes).toContain("jobs.deleted");
      expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
      await expect(fs.stat(path.join(userDataPath, "jobs", created.id))).rejects.toThrow();
    });
  });

  it("reparse 会优先复用可读 raw object，并回退到 sourceFiles 文本快照", async () => {
    await withTempUserData(async (userDataPath) => {
      const sourceJobId = "reparse-raw-source";
      const storedRelativePath = "objects/reparse/source.eml";
      const storedPath = path.join(userDataPath, storedRelativePath);
      await fs.mkdir(path.dirname(storedPath), { recursive: true });
      await fs.writeFile(storedPath, "Subject: Stored\n\nbody", "utf8");

      await seedPersistedJob(userDataPath, sourceJobId, {
        id: sourceJobId,
        status: "completed",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:05:00.000Z",
        finishedAt: "2026-06-05T08:05:00.000Z",
        progressPercent: 100,
        stage: "任务已完成",
        checkpointId: "reparse-raw-checkpoint",
        versionGroupId: "parse_version_group_22222222222222222222222222222222"
      }, {
        payload: {
          checkpointId: "reparse-raw-checkpoint",
          inputText: "fallback payload text",
          clientUid: "client-reparse",
          sourceType: "mail",
          settings: {
            old: true
          }
        },
        result: {
          sourceFiles: [
            {
              storageRelativePath: storedRelativePath,
              rawObjectId: "raw-stored-1",
              rawObjectSha256: "sha-stored",
              rawObjectByteSize: 21,
              originalFileName: "stored.eml",
              originalRelativePath: "Inbox/stored.eml",
              mediaType: "message/rfc822",
              providerId: "mail",
              externalId: "message-1",
              syncBatchId: "batch-1",
              capturedAt: "2026-06-05T07:59:00.000Z",
              sourceMetadata: {
                mailbox: "Inbox"
              }
            },
            {
              storageRelativePath: "objects/reparse/missing.txt",
              originalFileName: "missing.txt",
              text: "snapshot body"
            }
          ]
        }
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });

      const reparsed = await manager.reparseJob(sourceJobId, {
        settings: {
          retry: true
        },
        documentParsing: {
          mode: "strict"
        }
      });
      const reparsePayload = JSON.parse(
        await fs.readFile(path.join(userDataPath, "jobs", reparsed.id, "payload.json"), "utf8")
      );

      expect(reparsed).toMatchObject({
        status: "queued",
        parentJobId: sourceJobId,
        reparseFromJobId: sourceJobId,
        versionGroupId: "parse_version_group_22222222222222222222222222222222"
      });
      expect(reparsePayload.inputText).toBe("");
      expect(reparsePayload.uploadedFiles).toHaveLength(1);
      expect(reparsePayload.uploadedFiles[0]).toMatchObject({
        name: "raw-stored-1",
        relativePath: "Inbox/stored.eml",
        originalFileName: "stored.eml",
        mediaType: "message/rfc822",
        stagedPath: storedPath,
        clientUid: "client-reparse",
        sourceType: "mail",
        providerId: "mail",
        externalId: "message-1",
        syncBatchId: "batch-1",
        sourceMetadata: {
          mailbox: "Inbox"
        }
      });
      expect(reparsePayload.settings).toEqual({
        retry: true
      });
      expect(reparsePayload.documentParsing).toEqual({
        mode: "strict"
      });
    });
  });
});
