import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acknowledgeQueueMonitorAlert,
  getQueueMonitorState,
  inspectQueueMonitor,
  queueMonitorEventLogPath,
  queueMonitorId,
  queueMonitorStatePath,
  registerQueueClosed,
  registerQueueHeartbeat,
  registerQueueStarted
} from "../../../server/services/client/work-queue-core/queue-monitor.mjs";

const tempRoots = [];

const FIXED_NOW = new Date("2026-06-04T08:00:00.000Z");

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-queue-monitor-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function seedJob(userDataPath, jobId, meta = {}, payload = null) {
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await writeJson(path.join(jobDir, "meta.json"), {
    id: jobId,
    ...meta
  });
  if (payload !== null) {
    await writeJson(path.join(jobDir, "payload.json"), payload);
  }
}

async function seedQueueState(userDataPath, items = {}, updatedAt = FIXED_NOW.toISOString()) {
  await writeJson(queueMonitorStatePath(userDataPath), {
    schemaVersion: 1,
    updatedAt,
    statePath: queueMonitorStatePath(userDataPath),
    eventLogPath: queueMonitorEventLogPath(userDataPath),
    items
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("queue monitor extra coverage", () => {
  it("reports an empty monitor summary and stable system status for a fresh data dir", async () => {
    await withTempUserData(async (userDataPath) => {
      const state = await getQueueMonitorState(userDataPath);

      expect(state.statePath).toBe(queueMonitorStatePath(userDataPath));
      expect(state.eventLogPath).toBe(queueMonitorEventLogPath(userDataPath));
      expect(state.summary).toEqual({
        totalCount: 0,
        openCount: 0,
        interruptedCount: 0,
        recoveredCount: 0,
        closedCount: 0
      });
      expect(state.systemStatus.summary).toMatchObject({
        totalCount: 0,
        queueCount: 0,
        processCount: 0,
        taskCount: 0,
        monitorCount: 0,
        alertCount: 0
      });
      expect(state.items).toEqual([]);
      await expect(fs.stat(queueMonitorStatePath(userDataPath))).rejects.toThrow();
      await expect(fs.stat(queueMonitorEventLogPath(userDataPath))).rejects.toThrow();
    });
  });

  it("registers queue lifecycle events, normalizes identifiers, and clears queued state timers", async () => {
    await withTempUserData(async (userDataPath) => {
      const started = await registerQueueStarted(userDataPath, {
        jobId: "job-register-1",
        source: "ingest-worker",
        metadata: {
          batchId: "batch-a"
        }
      });
      expect(queueMonitorId("import_parse_job", "job-register-1")).toMatch(/^queue_item_[a-f0-9]{32}$/);
      expect(started).toMatchObject({
        queueId: queueMonitorId("import_parse_job", "job-register-1"),
        ownerId: "job-register-1",
        lifecycleStatus: "open",
        source: "ingest-worker",
        sources: ["ingest-worker"],
        metadata: { batchId: "batch-a" }
      });
      expect(vi.getTimerCount()).toBe(0);

      const heartbeat = await registerQueueHeartbeat(userDataPath, {
        jobId: "job-register-1",
        source: "watchdog",
        metadata: {
          attempt: 2
        }
      });
      expect(heartbeat).toMatchObject({
        queueId: started.queueId,
        lifecycleStatus: "open",
        sources: ["ingest-worker", "watchdog"],
        metadata: { batchId: "batch-a", attempt: 2 }
      });
      expect(vi.getTimerCount()).toBe(0);

      const closed = await registerQueueClosed(userDataPath, {
        jobId: "job-register-1",
        source: "watchdog",
        status: "completed"
      });
      expect(closed).toMatchObject({
        queueId: started.queueId,
        lifecycleStatus: "closed",
        status: "completed",
        phase: "closed"
      });
      expect(vi.getTimerCount()).toBe(0);

      const state = await getQueueMonitorState(userDataPath);
      expect(state.summary).toMatchObject({
        totalCount: 1,
        openCount: 0,
        interruptedCount: 0,
        recoveredCount: 0,
        closedCount: 1
      });
      expect(state.systemStatus.summary.queueCount).toBe(1);
      expect(state.items[0].unifiedRegistration.originalType).toBe("queue");

      const eventTypes = (await readJsonLines(queueMonitorEventLogPath(userDataPath))).map((entry) => entry.type);
      expect(eventTypes).toEqual([
        "queue.started",
        "queue.heartbeat",
        "queue.closed"
      ]);
    });
  });

  it("treats sub-second heartbeat gaps as fresh, but interrupts stale queues and queues recovery", async () => {
    await withTempUserData(async (userDataPath) => {
      const freshQueueId = queueMonitorId("import_parse_job", "job-fresh");
      const staleQueueId = queueMonitorId("import_parse_job", "job-stale");
      const freshHeartbeat = new Date(FIXED_NOW.getTime() - 500).toISOString();
      const staleHeartbeat = new Date(FIXED_NOW.getTime() - 5000).toISOString();

      await seedJob(
        userDataPath,
        "job-fresh",
        {
          status: "queued",
          updatedAt: freshHeartbeat
        },
        {
          inputText: "fresh payload"
        }
      );
      await seedJob(
        userDataPath,
        "job-stale",
        {
          status: "queued",
          updatedAt: staleHeartbeat
        },
        {
          inputText: "stale payload"
        }
      );
      await seedQueueState(userDataPath, {
        [freshQueueId]: {
          queueId: freshQueueId,
          ownerId: "job-fresh",
          kind: "import_parse_job",
          label: "导入解析队列 job-fresh",
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "open",
          phase: "queued",
          status: "queued",
          startedAt: freshHeartbeat,
          lastHeartbeatAt: freshHeartbeat,
          closedAt: "",
          checkpointId: "",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt: "",
          interruptedReason: "",
          acknowledgedAt: "",
          metadata: {}
        },
        [staleQueueId]: {
          queueId: staleQueueId,
          ownerId: "job-stale",
          kind: "import_parse_job",
          label: "导入解析队列 job-stale",
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "open",
          phase: "queued",
          status: "queued",
          startedAt: staleHeartbeat,
          lastHeartbeatAt: staleHeartbeat,
          closedAt: "",
          checkpointId: "",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt: "",
          interruptedReason: "",
          acknowledgedAt: "",
          metadata: {}
        }
      });

      const result = await inspectQueueMonitor({
        userDataPath,
        heartbeatStaleMs: 1,
        recoverInterruptedQueues: true
      });

      expect(result.summary).toMatchObject({
        totalCount: 2,
        openCount: 1,
        interruptedCount: 1,
        recoveredCount: 0,
        closedCount: 0
      });

      const freshItem = result.items.find((item) => item.queueId === freshQueueId);
      const staleItem = result.items.find((item) => item.queueId === staleQueueId);
      expect(freshItem?.lifecycleStatus).toBe("open");
      expect(staleItem).toMatchObject({
        lifecycleStatus: "interrupted",
        interruptedReason: "queue_heartbeat_stale",
        recoveryAttemptedAt: FIXED_NOW.toISOString(),
        recoveryQueuedAt: FIXED_NOW.toISOString(),
        recoveryStatus: "queued_for_recovery"
      });

      const persistedJob = await readJson(path.join(userDataPath, "jobs", "job-stale", "meta.json"));
      expect(persistedJob).toMatchObject({
        id: "job-stale",
        status: "queued",
        stage: "队列中断后等待后台 worker 恢复。",
        queueId: staleQueueId
      });
      expect(vi.getTimerCount()).toBe(0);

      const eventTypes = (await readJsonLines(queueMonitorEventLogPath(userDataPath))).map((entry) => entry.type);
      expect(eventTypes).toContain("queue.watchdog.inspected");
    });
  });

  it("marks interrupted queues recovered again when the job is running and closes failed jobs", async () => {
    await withTempUserData(async (userDataPath) => {
      const recoveredQueueId = queueMonitorId("import_parse_job", "job-recover");
      const failedQueueId = queueMonitorId("import_parse_job", "job-failed");
      const runningHeartbeat = FIXED_NOW.toISOString();
      const interruptedAt = new Date(FIXED_NOW.getTime() - 5000).toISOString();

      await seedJob(
        userDataPath,
        "job-recover",
        {
          status: "running",
          updatedAt: runningHeartbeat
        },
        {
          inputText: "recover payload"
        }
      );
      await seedJob(userDataPath, "job-failed", {
        status: "failed",
        updatedAt: runningHeartbeat
      });
      await seedQueueState(userDataPath, {
        [recoveredQueueId]: {
          queueId: recoveredQueueId,
          ownerId: "job-recover",
          kind: "import_parse_job",
          label: "导入解析队列 job-recover",
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "interrupted",
          phase: "running",
          status: "interrupted",
          startedAt: interruptedAt,
          lastHeartbeatAt: runningHeartbeat,
          closedAt: "",
          checkpointId: "",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt,
          interruptedReason: "queue_heartbeat_stale",
          acknowledgedAt: "",
          metadata: {}
        },
        [failedQueueId]: {
          queueId: failedQueueId,
          ownerId: "job-failed",
          kind: "import_parse_job",
          label: "导入解析队列 job-failed",
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "open",
          phase: "queued",
          status: "queued",
          startedAt: interruptedAt,
          lastHeartbeatAt: interruptedAt,
          closedAt: "",
          checkpointId: "",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: "",
          interruptedAt: "",
          interruptedReason: "",
          acknowledgedAt: "",
          metadata: {}
        }
      });

      const result = await inspectQueueMonitor({
        userDataPath,
        heartbeatStaleMs: 60000,
        recoverInterruptedQueues: false
      });

      const recoveredItem = result.items.find((item) => item.queueId === recoveredQueueId);
      const failedItem = result.items.find((item) => item.queueId === failedQueueId);
      expect(recoveredItem).toMatchObject({
        lifecycleStatus: "recovered",
        status: "recovered",
        phase: "recovered",
        recoveryStatus: "queue_running_again"
      });
      expect(failedItem).toMatchObject({
        lifecycleStatus: "closed",
        status: "failed",
        phase: "closed"
      });
      expect(result.summary).toMatchObject({
        totalCount: 2,
        openCount: 0,
        interruptedCount: 0,
        recoveredCount: 1,
        closedCount: 1
      });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("acknowledges matching monitor alerts and closes recovered queue items", async () => {
    await withTempUserData(async (userDataPath) => {
      const queueId = queueMonitorId("import_parse_job", "job-alert");
      const alertId = `monitor.queue.${queueId}.interrupted`;
      const acknowledgedAt = FIXED_NOW.toISOString();

      await seedQueueState(userDataPath, {
        [queueId]: {
          queueId,
          ownerId: "job-alert",
          kind: "import_parse_job",
          label: "导入解析队列 job-alert",
          source: "watchdog",
          sources: ["watchdog"],
          lifecycleStatus: "recovered",
          phase: "recovered",
          status: "recovered",
          startedAt: acknowledgedAt,
          lastHeartbeatAt: acknowledgedAt,
          closedAt: "",
          checkpointId: "",
          checkpointTreeId: "",
          lastCheckpointAt: "",
          recoveryAttemptedAt: "",
          recoveryQueuedAt: "",
          recoveredAt: acknowledgedAt,
          interruptedAt: "",
          interruptedReason: "",
          acknowledgedAt: "",
          metadata: {}
        }
      });

      await expect(acknowledgeQueueMonitorAlert(userDataPath, "not-an-alert")).resolves.toBeNull();
      const acknowledged = await acknowledgeQueueMonitorAlert(userDataPath, alertId);
      expect(acknowledged).toMatchObject({
        queueId,
        lifecycleStatus: "closed",
        acknowledgedAt: acknowledgedAt
      });

      const state = await getQueueMonitorState(userDataPath);
      expect(state.summary).toMatchObject({
        totalCount: 1,
        openCount: 0,
        interruptedCount: 0,
        recoveredCount: 0,
        closedCount: 1
      });
      expect(state.items[0]).toMatchObject({
        queueId,
        lifecycleStatus: "closed",
        acknowledgedAt: acknowledgedAt
      });

      const eventTypes = (await readJsonLines(queueMonitorEventLogPath(userDataPath))).map((entry) => entry.type);
      expect(eventTypes).toEqual(["queue.alert.acknowledged"]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
