import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const getBackgroundProcessStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/devops/process-status/background-process-status.mjs", () => ({
  getBackgroundProcessStatus: getBackgroundProcessStatusMock
}));

import {
  acknowledgeMonitorAlert,
  getMonitorAlertState,
  loadMonitorAlertConfig,
  monitorAlertConfigPath,
  monitorAlertShellConfigPath,
  monitorAlertStatePath,
  runMonitorAlertCycle,
  saveMonitorAlertConfig
} from "../../../server/platform/common/devops/monitor-alert-core/monitor-alerts.mjs";

const tempRoots = [];

beforeEach(() => {
  getBackgroundProcessStatusMock.mockReset();
});

afterEach(async () => {
  getBackgroundProcessStatusMock.mockReset();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true }))
  );
});

async function withTempUserData(handler) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-alert-extra-"));
  tempRoots.push(userDataPath);
  await handler(userDataPath);
}

function backgroundStatusFromProcesses(processes) {
  return {
    supervisor: { alive: true },
    processes
  };
}

describe("monitor-alert-core extra coverage", () => {
  it("creates and normalizes monitor alert configuration, then writes shell state files", async () => {
    await withTempUserData(async (userDataPath) => {
      await saveMonitorAlertConfig(userDataPath, {
        enabled: "0",
        intervalMs: "abc",
        heartbeatStaleMs: "abc",
        queueHeartbeatStaleMs: "900",
        recoverInterruptedQueues: "0",
        historyLimit: "7",
        rules: {
          processRestarted: { restartCountThreshold: "bad-value" }
        }
      });
      const loaded = await loadMonitorAlertConfig(userDataPath);

      expect(loaded).toMatchObject({
        enabled: false,
        intervalMs: 5000,
        heartbeatStaleMs: 15000,
        queueHeartbeatStaleMs: 5000,
        recoverInterruptedQueues: false,
        historyLimit: 10,
        rules: {
          processRestarted: {
            enabled: true,
            restartCountThreshold: 1
          }
        }
      });

      const savedConfig = JSON.parse(await fs.readFile(monitorAlertConfigPath(userDataPath), "utf8"));
      expect(savedConfig.schemaVersion).toBe(1);
      expect(savedConfig).toMatchObject({
        enabled: false,
        intervalMs: loaded.intervalMs
      });

      const shellConfig = await fs.readFile(monitorAlertShellConfigPath(userDataPath), "utf8");
      expect(shellConfig).toContain("ALERTS_ENABLED=0");
      expect(shellConfig).toContain("INTERVAL_SECONDS=5");
      expect(shellConfig).toContain(`HISTORY_LIMIT=${loaded.historyLimit}`);
    });
  });

  it("creates alerts from process state and filters by configured status sets", async () => {
    await withTempUserData(async (userDataPath) => {
      await saveMonitorAlertConfig(userDataPath, {
        enabled: true,
        rules: {
          supervisorStopped: { enabled: false },
          processNotRunning: { enabled: true, statuses: ["missing"] },
          processStale: { enabled: false },
          processRestarted: { enabled: true, restartCountThreshold: 2 },
          queueInterrupted: { enabled: false }
        }
      });
      getBackgroundProcessStatusMock.mockResolvedValue(
        backgroundStatusFromProcesses([
          {
            role: "import-worker",
            label: "导入解析 Worker",
            status: "stale",
            desired: true,
            restartCount: 0
          },
          {
            role: "source-watcher",
            label: "目录同步 Worker",
            status: "missing",
            desired: true,
            restartCount: 0
          },
          {
            role: "maintenance-worker",
            label: "智能巡检 Worker",
            status: "missing",
            desired: false,
            restartCount: 0
          }
        ])
      );

      const state = await runMonitorAlertCycle(userDataPath);
      const alertIds = state.activeAlerts.map((alert) => alert.alertId);

      expect(alertIds).toEqual(["monitor.process.source-watcher.not_running"]);
      expect(state.summary).toMatchObject({
        activeCount: 1,
        visibleCount: 1,
        criticalCount: 1,
        warningCount: 0
      });
    });
  });

  it("lists cached state without refreshing process status", async () => {
    await withTempUserData(async (userDataPath) => {
      await saveMonitorAlertConfig(userDataPath, {
        enabled: true,
        rules: {
          processNotRunning: { enabled: true, statuses: ["missing"] },
          processStale: { enabled: false },
          processRestarted: { enabled: false },
          queueInterrupted: { enabled: false },
          supervisorStopped: { enabled: false }
        }
      });
      getBackgroundProcessStatusMock.mockResolvedValue(
        backgroundStatusFromProcesses([
          {
            role: "agent-worker",
            label: "智能体 Worker",
            status: "missing",
            desired: true,
            restartCount: 0
          }
        ])
      );

      const fresh = await runMonitorAlertCycle(userDataPath);
      const cached = await getMonitorAlertState(userDataPath, { refresh: false });

      expect(cached.configPath).toBe(monitorAlertConfigPath(userDataPath));
      expect(cached.statePath).toBe(monitorAlertStatePath(userDataPath));
      expect(cached.activeAlerts.map((alert) => alert.alertId)).toEqual(fresh.activeAlerts.map((alert) => alert.alertId));
      expect(cached.summary.activeCount).toBe(1);
      expect(Array.isArray(cached.systemStatus?.registrations)).toBe(true);
      expect(cached.systemStatus.registrations.length).toBeGreaterThan(0);
    });
  });

  it("tracks status statistics and pushes resolved alerts into history", async () => {
    await withTempUserData(async (userDataPath) => {
      await saveMonitorAlertConfig(userDataPath, {
        enabled: true,
        rules: {
          supervisorStopped: { enabled: false },
          processNotRunning: { enabled: true, statuses: ["missing"] },
          processStale: { enabled: true, statuses: ["stale"] },
          processRestarted: { enabled: true, restartCountThreshold: 1 },
          queueInterrupted: { enabled: false }
        }
      });

      getBackgroundProcessStatusMock
        .mockResolvedValueOnce(
          backgroundStatusFromProcesses([
            {
              role: "import-worker",
              label: "导入解析 Worker",
              status: "missing",
              desired: true,
              restartCount: 0
            },
            {
              role: "source-watcher",
              label: "目录同步 Worker",
              status: "stale",
              desired: true,
              restartCount: 0
            },
            {
              role: "maintenance-worker",
              label: "智能巡检 Worker",
              status: "running",
              desired: true,
              restartCount: 3
            }
          ])
        )
        .mockResolvedValueOnce(
          backgroundStatusFromProcesses([
            {
              role: "import-worker",
              label: "导入解析 Worker",
              status: "running",
              desired: true,
              restartCount: 0
            },
            {
              role: "source-watcher",
              label: "目录同步 Worker",
              status: "running",
              desired: true,
              restartCount: 0
            },
            {
              role: "maintenance-worker",
              label: "智能巡检 Worker",
              status: "running",
              desired: true,
              restartCount: 0
            }
          ])
        );

      const triggered = await runMonitorAlertCycle(userDataPath);
      expect(triggered.summary).toMatchObject({
        activeCount: 3,
        visibleCount: 3,
        criticalCount: 1,
        warningCount: 2,
        historyCount: 3,
      });
      expect(triggered.status).toBe("alerting");

      const resolved = await runMonitorAlertCycle(userDataPath);
      const resolvedIds = resolved.history.filter((alert) => !alert.active).map((alert) => alert.alertId);

      expect(resolved.summary).toMatchObject({
        activeCount: 0,
        visibleCount: 0,
        criticalCount: 0,
        warningCount: 0
      });
      expect(resolved.summary.historyCount).toBe(3);
      expect(resolvedIds).toEqual(expect.arrayContaining([
        "monitor.process.import-worker.not_running",
        "monitor.process.source-watcher.stale",
        "monitor.process.maintenance-worker.restarted"
      ]));
      expect(resolved.history.every((alert) => alert.resolvedAt)).toBe(true);
    });
  });

  it("acknowledges recovered queue alerts and suppresses reappearence", async () => {
    await withTempUserData(async (userDataPath) => {
      await saveMonitorAlertConfig(userDataPath, {
        enabled: true,
        rules: {
          supervisorStopped: { enabled: false },
          processNotRunning: { enabled: false },
          processStale: { enabled: false },
          processRestarted: { enabled: false },
          queueInterrupted: { enabled: true }
        }
      });

      const queueInspect = vi.fn()
        .mockResolvedValueOnce({
          items: [
            {
              queueId: "import_parse_job:job-1",
              kind: "import_parse_job",
              ownerId: "job-1",
              label: "queue parse job",
              status: "interrupted",
              lifecycleStatus: "interrupted",
              interruptedAt: "2026-06-04T00:00:00.000Z",
              phase: "running",
              evidence: {
                checkpointStatus: "interrupted"
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          items: [
            {
              queueId: "import_parse_job:job-1",
              kind: "import_parse_job",
              ownerId: "job-1",
              label: "queue parse job",
              status: "recovered",
              lifecycleStatus: "recovered",
              interruptedAt: "2026-06-04T00:00:00.000Z",
              recoveredAt: "2026-06-04T00:01:00.000Z",
              recoveryStatus: "closed",
              phase: "running",
              evidence: {
                checkpointStatus: "recovered"
              }
            }
          ]
        })
        .mockResolvedValue({
          items: [
            {
              queueId: "import_parse_job:job-1",
              kind: "import_parse_job",
              ownerId: "job-1",
              label: "queue parse job",
              status: "recovered",
              lifecycleStatus: "recovered",
              interruptedAt: "2026-06-04T00:00:00.000Z",
              recoveredAt: "2026-06-04T00:01:00.000Z",
              recoveryStatus: "closed",
              phase: "running",
              evidence: {
                checkpointStatus: "recovered"
              }
            }
          ]
        });
      const queueAcknowledge = vi.fn();
      const queueMonitor = { inspect: queueInspect, acknowledge: queueAcknowledge };
      getBackgroundProcessStatusMock.mockResolvedValue({
        supervisor: { alive: true },
        processes: []
      });

      const interrupted = await runMonitorAlertCycle(userDataPath, { queueMonitor });
      const queueAlert = interrupted.activeAlerts.find((alert) => alert.ruleId === "queueInterrupted");
      expect(queueAlert).toBeTruthy();
      expect(queueAlert).toMatchObject({ active: true });

      const recovered = await runMonitorAlertCycle(userDataPath, { queueMonitor });
      const recoveredAlert = recovered.activeAlerts.find((alert) => alert.alertId === queueAlert.alertId);
      expect(recoveredAlert).toMatchObject({ active: false, ackRequired: true });

      const acknowledged = await acknowledgeMonitorAlert(userDataPath, queueAlert.alertId, { queueMonitor });
      expect(queueAcknowledge).toHaveBeenCalledWith(queueAlert.alertId);
      expect(acknowledged.activeAlerts.map((alert) => alert.alertId)).not.toContain(queueAlert.alertId);
      expect(acknowledged.history.find((alert) => alert.alertId === queueAlert.alertId).acknowledgedAt).toBeTruthy();

      const afterAckRun = await runMonitorAlertCycle(userDataPath, { queueMonitor });
      expect(afterAckRun.activeAlerts.map((alert) => alert.alertId)).not.toContain(queueAlert.alertId);
      expect(afterAckRun.summary.activeCount).toBe(0);
    });
  });

  it("rejects monitor-alert acknowledgement with empty id input", async () => {
    await withTempUserData(async (userDataPath) => {
      await expect(acknowledgeMonitorAlert(userDataPath, "  ")).rejects.toMatchObject({
        message: "缺少报警 ID。"
      });
    });
  });
});
