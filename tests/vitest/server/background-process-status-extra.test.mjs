import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const loadSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

import {
  backgroundStateDirectory,
  backgroundStatePath,
  getBackgroundProcessStatus,
  inspectAgentWorkerDemand,
  inspectImportParseWorkerDemand,
  inspectMaintenanceWorkerDemand,
  inspectSourceWatcherDemand,
  normalizeBackgroundRoleList,
  statusForInactiveDemand,
  writeBackgroundProcessState
} from "../../../server/platform/common/devops/process-status/background-process-status.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-background-status-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function seedDemandFixtures(userDataPath) {
  await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
    sources: [
      {
        sourceId: "source-a",
        directoryPath: "/tmp/source-a",
        enabled: true,
        autoSync: true
      },
      {
        sourceId: "source-b",
        directoryPath: "/tmp/source-b",
        enabled: false,
        autoSync: true
      },
      {
        sourceId: "source-c",
        directoryPath: "",
        enabled: true,
        autoSync: true
      }
    ]
  });

  await writeJson(path.join(userDataPath, "maintenance-agent.json"), {
    enabled: true,
    schedules: [
      { scheduleId: "run-a", enabled: true },
      { scheduleId: "run-b", enabled: false }
    ]
  });

  await writeText(
    path.join(userDataPath, "maintenance-agent-runs.jsonl"),
    [
      JSON.stringify({ run: { runId: "run-1", status: "queued" } }),
      "not-json",
      JSON.stringify({ run: { runId: "run-1", status: "running" } }),
      JSON.stringify({ run: { runId: "run-2", status: "queued" } }),
      ""
    ].join("\n")
  );

  const jobsRoot = path.join(userDataPath, "jobs");
  await writeJson(path.join(jobsRoot, "job-queued", "meta.json"), {
    id: "job-queued",
    status: "queued"
  });
  await writeJson(path.join(jobsRoot, "job-running", "meta.json"), {
    id: "job-running",
    status: "running"
  });
  await writeText(path.join(jobsRoot, "broken-job", "meta.json"), "{");

  loadSettingsMock.mockResolvedValue({
    modelLibraryAgents: [
      {
        uid: "alpha",
        provider: "deepseek",
        model: "deepseek-chat",
        apiKeyConfigured: true
      },
      {
        uid: "beta",
        provider: "custom-http",
        model: "demo-model",
        url: "https://agent.example.invalid",
        tokenConfigured: true
      },
      {
        uid: "gamma",
        provider: "openrouter",
        apiKeyConfigured: true
      },
      {
        uid: "delta",
        provider: "unsupported-provider",
        model: "demo"
      }
    ]
  });
}

beforeEach(() => {
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
});

afterEach(async () => {
  loadSettingsMock.mockReset();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("background-process-status extra coverage", () => {
  it("normalizes roles and inactive-demand status labels", () => {
    expect(backgroundStateDirectory("/tmp/user-data")).toBe("/tmp/user-data/background");
    expect(backgroundStatePath("/tmp/user-data")).toBe("/tmp/user-data/background/processes.json");

    expect(normalizeBackgroundRoleList("agent-worker, import-worker, invalid, agent-worker"))
      .toEqual(["agent-worker", "import-worker"]);
    expect(normalizeBackgroundRoleList(["source-watcher", "source-watcher", "missing"]))
      .toEqual(["source-watcher"]);

    expect(statusForInactiveDemand({ reason: "not_configured" })).toBe("not_configured");
    expect(statusForInactiveDemand({ reason: "not_connected" })).toBe("not_connected");
    expect(statusForInactiveDemand({ reason: "inspection_failed" })).toBe("inspection_failed");
    expect(statusForInactiveDemand({ reason: "other" })).toBe("standby");
  });

  it("inspects demand from temp files and ignores malformed historical records", async () => {
    await withTempUserData(async (userDataPath) => {
      await seedDemandFixtures(userDataPath);

      const importDemand = await inspectImportParseWorkerDemand(userDataPath);
      const sourceDemand = await inspectSourceWatcherDemand(userDataPath);
      const maintenanceDemand = await inspectMaintenanceWorkerDemand(userDataPath);
      const agentDemand = await inspectAgentWorkerDemand(userDataPath);

      expect(importDemand).toMatchObject({
        active: true,
        activeCount: 2,
        queuedCount: 1,
        runningCount: 1,
        activeJobIds: ["job-queued", "job-running"]
      });
      expect(sourceDemand).toMatchObject({
        active: true,
        totalCount: 3,
        enabledCount: 2,
        autoSyncCount: 3,
        watchableCount: 1,
        watchableSourceIds: ["source-a"]
      });
      expect(maintenanceDemand).toMatchObject({
        active: true,
        enabled: true,
        enabledScheduleCount: 1,
        activeRunCount: 2,
        queuedRunCount: 1,
        runningRunCount: 1,
        activeRunIds: ["run-1", "run-2"]
      });
      expect(agentDemand).toMatchObject({
        active: false,
        configured: true,
        connected: true,
        reason: "idle",
        modelCount: 4,
        availableModelCount: 2,
        unavailableModelCount: 1,
        unsupportedModelCount: 1,
        availableAgentIds: ["alpha", "beta"],
        unavailableAgentIds: ["gamma"],
        unsupportedAgentIds: ["delta"]
      });
    });
  });

  it("writes background process state and reads it back through the status composer", async () => {
    await withTempUserData(async (userDataPath) => {
      await seedDemandFixtures(userDataPath);
      const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => Number(pid) === process.pid);

      try {
        const nowIso = new Date().toISOString();
        const state = {
          updatedAt: nowIso,
          supervisor: {
            pid: process.pid,
            startedAt: nowIso,
            intervalMs: 5000,
            restartDelayMs: 1000,
            roles: ["import-worker", "source-watcher", "maintenance-worker", "agent-worker"]
          },
          inspectionDaemon: {
            pid: process.pid
          },
          status: "healthy",
          processes: [
            {
              role: "import-worker",
              label: "导入解析 Worker",
              processType: "service",
              pid: process.pid,
              status: "running",
              desired: true,
              stale: false,
              startedAt: nowIso,
              lastHeartbeatAt: nowIso,
              restartCount: 1,
              details: { note: "kept" }
            },
            {
              role: "source-watcher",
              label: "目录同步 Worker",
              processType: "service",
              pid: process.pid,
              status: "running",
              desired: true,
              stale: false,
              startedAt: nowIso,
              lastHeartbeatAt: nowIso
            },
            {
              role: "maintenance-worker",
              label: "智能巡检 Worker",
              processType: "service",
              pid: process.pid,
              status: "running",
              desired: true,
              stale: false,
              startedAt: nowIso,
              lastHeartbeatAt: nowIso
            },
            {
              role: "agent-worker",
              label: "智能体 Worker",
              processType: "service",
              pid: process.pid,
              status: "running",
              desired: true,
              stale: false,
              startedAt: nowIso,
              lastHeartbeatAt: nowIso
            },
            {
              role: "mystery-worker",
              label: "未知 Worker",
              processType: "service",
              pid: 99999,
              status: "running",
              desired: true,
              stale: false,
              startedAt: nowIso,
              lastHeartbeatAt: nowIso
            }
          ]
        };

        const written = await writeBackgroundProcessState(userDataPath, state);
        expect(written.schemaVersion).toBe(1);
        expect(written.updatedAt).toBeTruthy();

        const stored = JSON.parse(await fs.readFile(backgroundStatePath(userDataPath), "utf8"));
        expect(stored.schemaVersion).toBe(1);
        expect(stored.supervisor.pid).toBe(process.pid);
        expect(stored.processes).toHaveLength(5);

        const status = await getBackgroundProcessStatus(userDataPath);
        expect(status.statePath).toBe(backgroundStatePath(userDataPath));
        expect(status.processes.some((item) => item.role === "mystery-worker")).toBe(false);
        expect(status.processes.map((item) => item.role)).toEqual([
          "server-main",
          "background-supervisor",
          "import-worker",
          "source-watcher",
          "maintenance-worker",
          "agent-worker",
          "system-inspection"
        ]);
        expect(status.systemStatus.summary).toMatchObject({
          totalCount: 7,
          processCount: 7,
          queueCount: 0,
          taskCount: 0,
          monitorCount: 0,
          alertCount: 0
        });
        expect(status.processes.find((item) => item.role === "import-worker")).toMatchObject({
          status: "running",
          desired: true,
          details: {
            note: "kept"
          }
        });
        expect(status.processes.find((item) => item.role === "system-inspection")).toBeTruthy();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("returns unavailable when the state file is missing and reports missing worker records", async () => {
    await withTempUserData(async (userDataPath) => {
      await seedDemandFixtures(userDataPath);

      const status = await getBackgroundProcessStatus(userDataPath);
      const processByRole = new Map(status.processes.map((item) => [item.role, item]));

      expect(status.ok).toBe(false);
      expect(status.status).toBe("unavailable");
      expect(processByRole.get("server-main")).toMatchObject({ status: "running" });
      expect(processByRole.get("background-supervisor")).toMatchObject({ status: "stopped" });
      expect(processByRole.get("import-worker")).toMatchObject({ status: "missing" });
      expect(processByRole.get("source-watcher")).toMatchObject({ status: "missing" });
      expect(processByRole.get("maintenance-worker")).toMatchObject({ status: "missing" });
      expect(processByRole.get("agent-worker")).toMatchObject({ status: "standby" });
      expect(processByRole.get("system-inspection")).toMatchObject({ status: "stopped" });
      expect(status.systemStatus.summary).toMatchObject({
        totalCount: 7,
        processCount: 7
      });
    });
  });

  it("fails fast on malformed persisted state files", async () => {
    await withTempUserData(async (userDataPath) => {
      await seedDemandFixtures(userDataPath);
      await fs.mkdir(path.dirname(backgroundStatePath(userDataPath)), { recursive: true });
      await writeText(backgroundStatePath(userDataPath), "{");

      await expect(getBackgroundProcessStatus(userDataPath)).rejects.toThrow();
    });
  });
});
