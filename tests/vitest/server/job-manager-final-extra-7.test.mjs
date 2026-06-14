import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const forkBehavior = vi.hoisted(() => ({
  throwOnFork: false
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

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => {
    if (forkBehavior.throwOnFork) {
      throw new Error("mock worker start failure");
    }

    throw new Error("worker fork should not be reached outside the worker failure test");
  })
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    deleteCheckpointTree: vi.fn(async () => null),
    finishCheckpointTree: vi.fn(async () => {
      throw new Error("mock checkpoint finish failure");
    }),
    getRuntimeLogger: vi.fn(() => loggerMock),
    removeImportCheckpoint: vi.fn(async () => null),
    startCheckpointTree: vi.fn(async () => null),
    summarizeError: vi.fn((error) => error?.message || String(error || "")),
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" })),
    upsertCheckpointNode: vi.fn(async () => {
      throw new Error("mock checkpoint upsert failure");
    })
  };
});

import {
  acknowledgeQueueMonitorAlert,
  getQueueMonitorState,
  inspectQueueMonitor,
  queueMonitorEventLogPath,
  queueMonitorId,
  queueMonitorStatePath,
  registerQueueClosed,
  registerQueueHeartbeat
} from "../../../server/services/client/work-queue-core/queue-monitor.mjs";
import {
  createJobManager
} from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { checkpointTreeId, serverToken } from "../../../server/platform/interactive/product-api.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-job-manager-final-extra-7-"));
  tempRoots.push(userDataPath);
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedJob(userDataPath, jobId, meta, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify(meta), "utf8");
  if (payload !== null) {
    await fs.writeFile(path.join(jobDir, "payload.json"), JSON.stringify(payload), "utf8");
  }
}

async function seedQueueState(userDataPath, items, updatedAt = "2026-06-05T08:00:00.000Z") {
  await writeJson(queueMonitorStatePath(userDataPath), {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt,
    statePath: queueMonitorStatePath(userDataPath),
    eventLogPath: queueMonitorEventLogPath(userDataPath),
    items
  });
}

function baseQueueItem(queueId, ownerId, overrides = {}) {
  const now = "2026-06-05T08:00:00.000Z";
  return {
    queueId,
    ownerId,
    kind: "import_parse_job",
    label: `导入解析队列 ${ownerId}`,
    source: "watchdog",
    sources: ["watchdog"],
    lifecycleStatus: "open",
    phase: "queued",
    status: "queued",
    startedAt: now,
    closedAt: "",
    lastHeartbeatAt: now,
    checkpointId: "",
    checkpointTreeId: "",
    lastCheckpointAt: "",
    recoveryAttemptedAt: "",
    recoveryQueuedAt: "",
    recoveredAt: "",
    interruptedAt: "",
    interruptedReason: "",
    acknowledgedAt: "",
    metadata: {},
    ...overrides
  };
}

async function waitForJobStatus(manager, jobId, status, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await manager.getJob(jobId);
    if (job?.status === status) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
}

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
  forkBehavior.throwOnFork = false;
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("queue monitor branches", () => {
  it("handles interrupted items, recovered closures, and stale recovery decisions", async () => {
    await withTempUserData(async (userDataPath) => {
      const interruptedQueueId = queueMonitorId("import_parse_job", "queue-lifecycle-job");
      const interruptedAt = new Date(Date.now() - 60_000).toISOString();

      await seedQueueState(
        userDataPath,
        {
          [interruptedQueueId]: baseQueueItem(interruptedQueueId, "queue-lifecycle-job", {
            lifecycleStatus: "interrupted",
            status: "queued",
            phase: "queued",
            interruptedAt,
            lastHeartbeatAt: interruptedAt
          })
        }
      );

      const heartbeat = await registerQueueHeartbeat(userDataPath, {
        queueId: interruptedQueueId,
        ownerId: "queue-lifecycle-job",
        source: "watchdog",
        status: "running"
      });
      expect(heartbeat).toMatchObject({
        queueId: interruptedQueueId,
        lifecycleStatus: "recovered",
        recoveredAt: expect.any(String)
      });

      const closed = await registerQueueClosed(userDataPath, {
        queueId: interruptedQueueId,
        ownerId: "queue-lifecycle-job",
        source: "watchdog",
        status: "completed"
      });
      expect(closed).toMatchObject({
        queueId: interruptedQueueId,
        lifecycleStatus: "recovered",
        closedAt: expect.any(String),
        recoveredAt: expect.any(String)
      });
    });
  });

  it("inspects stale queue entries, recovers interrupted jobs, and keeps fresh entries stable", async () => {
    await withTempUserData(async (userDataPath) => {
      const freshQueueId = queueMonitorId("import_parse_job", "job-fresh");
      const orphanFreshQueueId = queueMonitorId("import_parse_job", "orphan-fresh");
      const orphanStaleQueueId = queueMonitorId("import_parse_job", "orphan-stale");
      const activeQueueId = queueMonitorId("import_parse_job", "job-active");
      const missingQueueId = queueMonitorId("import_parse_job", "job-missing");
      const interruptedQueueId = queueMonitorId("import_parse_job", "job-interrupted");
      const recoveredQueueId = queueMonitorId("import_parse_job", "job-recovered");
      const treeQueueId = queueMonitorId("import_parse_job", "job-tree");
      const fresh = new Date(Date.now() - 500).toISOString();
      const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      await seedQueueState(userDataPath, {
        [freshQueueId]: baseQueueItem(freshQueueId, "job-fresh", {
          lastHeartbeatAt: fresh,
          startedAt: fresh
        }),
        [orphanFreshQueueId]: baseQueueItem(orphanFreshQueueId, "orphan-fresh", {
          lastHeartbeatAt: fresh,
          startedAt: fresh
        }),
        [orphanStaleQueueId]: baseQueueItem(orphanStaleQueueId, "orphan-stale", {
          lastHeartbeatAt: stale,
          startedAt: stale
        }),
        [activeQueueId]: baseQueueItem(activeQueueId, "job-active", {
          lastHeartbeatAt: stale,
          startedAt: stale
        }),
        [missingQueueId]: baseQueueItem(missingQueueId, "job-missing", {
          lastHeartbeatAt: stale,
          startedAt: stale
        }),
        [interruptedQueueId]: baseQueueItem(interruptedQueueId, "job-interrupted", {
          lifecycleStatus: "interrupted",
          status: "queued",
          phase: "queued",
          interruptedAt: stale,
          lastHeartbeatAt: stale
        }),
        [recoveredQueueId]: baseQueueItem(recoveredQueueId, "job-recovered", {
          lifecycleStatus: "recovered",
          status: "recovered",
          phase: "recovered",
          recoveredAt: stale,
          lastHeartbeatAt: stale
        }),
        [treeQueueId]: baseQueueItem(treeQueueId, "job-tree", {
          lastHeartbeatAt: stale,
          startedAt: stale,
          checkpointTreeId: checkpointTreeId("job", "job-tree")
        })
      });

      await fs.mkdir(path.join(userDataPath, "jobs"), { recursive: true });
      await fs.writeFile(path.join(userDataPath, "jobs", "notes.txt"), "ignore", "utf8");

      await seedJob(
        userDataPath,
        "job-fresh",
        {
          id: "job-fresh",
          status: "queued",
          createdAt: fresh,
          updatedAt: fresh,
          queueId: freshQueueId
        }
      );
      await seedJob(
        userDataPath,
        "job-active",
        {
          id: "job-active",
          status: "completed",
          createdAt: stale,
          updatedAt: fresh,
          finishedAt: fresh
        }
      );
      await seedJob(
        userDataPath,
        "job-missing",
        {
          id: "job-missing",
          status: "queued",
          createdAt: stale,
          updatedAt: stale
        }
      );
      await seedJob(
        userDataPath,
        "job-interrupted",
        {
          id: "job-interrupted",
          status: "completed",
          createdAt: stale,
          updatedAt: fresh,
          finishedAt: fresh
        }
      );
      await seedJob(
        userDataPath,
        "job-tree",
        {
          id: "job-tree",
          status: "queued",
          createdAt: stale,
          updatedAt: stale,
          checkpointTreeId: checkpointTreeId("job", "job-tree")
        },
        {
          inputText: "recover me"
        }
      );

      const result = await inspectQueueMonitor({
        userDataPath,
        heartbeatStaleMs: 1,
        recoverInterruptedQueues: true
      });
      const byOwnerId = new Map(result.items.map((item) => [item.ownerId, item]));

      expect(result.statePath).toBe(queueMonitorStatePath(userDataPath));
      expect(result.eventLogPath).toBe(queueMonitorEventLogPath(userDataPath));
      expect(byOwnerId.get("job-fresh")).toMatchObject({
        lifecycleStatus: "open",
        status: "queued"
      });
      expect(byOwnerId.get("orphan-fresh")).toMatchObject({
        lifecycleStatus: "open",
        status: "queued"
      });
      expect(byOwnerId.get("orphan-stale")).toMatchObject({
        lifecycleStatus: "interrupted",
        interruptedReason: "job_metadata_missing"
      });
      expect(byOwnerId.get("job-active")).toMatchObject({
        lifecycleStatus: "closed",
        status: "completed"
      });
      expect(byOwnerId.get("job-missing")).toMatchObject({
        lifecycleStatus: "interrupted",
        recoveryStatus: "missing_payload"
      });
      expect(byOwnerId.get("job-interrupted")).toMatchObject({
        lifecycleStatus: "recovered",
        recoveredAt: expect.any(String)
      });
      expect(byOwnerId.get("job-recovered")).toMatchObject({
        lifecycleStatus: "recovered"
      });
      expect(byOwnerId.get("job-tree")).toMatchObject({
        lifecycleStatus: "interrupted",
        recoveryStatus: "queued_for_recovery",
        recoveryQueuedAt: expect.any(String)
      });
    });
  });

  it("returns null when acknowledging an incomplete alert item", async () => {
    await withTempUserData(async (userDataPath) => {
      const queueId = queueMonitorId("import_parse_job", "ack-missing");
      await seedQueueState(userDataPath, {
        [queueId]: {
          ownerId: "ack-missing",
          kind: "import_parse_job",
          lifecycleStatus: "recovered",
          phase: "recovered",
          status: "recovered",
          lastHeartbeatAt: "2026-06-05T08:00:00.000Z"
        }
      });

      const acknowledged = await acknowledgeQueueMonitorAlert(
        userDataPath,
        `monitor.queue.${queueId}.interrupted`
      );

      expect(acknowledged).toBeNull();
    });
  });
});

describe("job manager branches", () => {
  it("tracks version families across checkpoint and manifest inputs", async () => {
    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = {
        publish: vi.fn(async () => null)
      };
      const checkpointSourceId = "family-checkpoint";
      const manifestSha256 = "B".repeat(64);

      await seedJob(userDataPath, "seeded-checkpoint-job", {
        id: "seeded-checkpoint-job",
        status: "completed",
        createdAt: "2026-06-05T06:00:00.000Z",
        updatedAt: "2026-06-05T06:10:00.000Z",
        checkpointId: serverToken("checkpoint", checkpointSourceId)
      });
      await seedJob(userDataPath, "seeded-manifest-job", {
        id: "seeded-manifest-job",
        status: "completed",
        createdAt: "2026-06-05T05:00:00.000Z",
        updatedAt: "2026-06-05T05:10:00.000Z",
        checkpointReceipt: {
          manifestSha256
        }
      });

      const manager = createJobManager({
        userDataPath,
        protocolEventBus,
        processingEnabled: false
      });

      const first = await manager.createJob({
        checkpointId: checkpointSourceId,
        parentJobId: " parent-1 ",
        inputText: "checkpoint-family"
      });
      const second = await manager.createJob({
        checkpointReceipt: {
          manifestSha256
        },
        parentJobId: "parent-2",
        inputText: "manifest-family"
      });
      const third = await manager.createJob({
        checkpointId: checkpointSourceId,
        parentJobId: "parent-3",
        inputText: "checkpoint-family-again"
      });

      expect(first.checkpointId).toBe(serverToken("checkpoint", checkpointSourceId));
      expect(first.parentJobId).toBe("parent-1");
      expect(first.versionNumber).toBe(2);
      expect(second.versionNumber).toBe(2);
      expect(third.versionNumber).toBe(3);
      expect(third.versionGroupId).toBe(first.versionGroupId);
      expect(protocolEventBus.publish).toHaveBeenCalled();
    });
  });

  it("marks a persisted queued job failed when startup recovery cannot find its payload", async () => {
    await withTempUserData(async (userDataPath) => {
      const jobId = "missing-payload-job";

      await seedJob(userDataPath, jobId, {
        id: jobId,
        status: "queued",
        createdAt: "2026-06-05T07:00:00.000Z",
        updatedAt: "2026-06-05T07:05:00.000Z",
        checkpointId: serverToken("checkpoint", jobId)
      });

      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });

      const job = await waitForJobStatus(manager, jobId, "failed");
      expect(job).toMatchObject({
        id: jobId,
        status: "failed"
      });
      expect(job?.error).toContain("payload");
    });
  });

  it("fails a queued job when the worker spawn path throws", async () => {
    forkBehavior.throwOnFork = true;

    await withTempUserData(async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: {
          workerConcurrency: 1
        }
      });

      const created = await manager.createJob({
        checkpointId: "spawn-checkpoint",
        inputText: "spawn me"
      });
      const failed = await waitForJobStatus(manager, created.id, "failed");

      expect(failed).toMatchObject({
        id: created.id,
        status: "failed",
        stage: "任务启动失败"
      });
      expect(failed?.error).toContain("mock worker start failure");
      expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
      expect(durableWorkflowRuntimeMock.failActivity).toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalled();
    });
  });

  it("deletes a queued persisted job and removes its on-disk directory", async () => {
    await withTempUserData(async (userDataPath) => {
      const jobId = "queued-delete-job";
      const checkpointId = serverToken("checkpoint", jobId);
      const checkpointTreeIdValue = checkpointTreeId("job", jobId);

      await seedJob(
        userDataPath,
        jobId,
        {
          id: jobId,
          status: "queued",
          createdAt: "2026-06-05T07:00:00.000Z",
          updatedAt: "2026-06-05T07:05:00.000Z",
          checkpointId,
          checkpointTreeId: checkpointTreeIdValue
        },
        {
          inputText: "delete me"
        }
      );

      const manager = createJobManager({
        userDataPath,
        processingEnabled: false
      });

      const deleted = await manager.deleteJob(jobId);
      const afterDelete = await manager.getJob(jobId);

      expect(deleted).toMatchObject({
        id: jobId,
        status: "queued",
        checkpointId
      });
      expect(afterDelete).toBeNull();
      await expect(fs.stat(path.join(userDataPath, "jobs", jobId))).rejects.toThrow();
      expect(durableWorkflowRuntimeMock.failWorkflow).toHaveBeenCalled();
    });
  });
});
