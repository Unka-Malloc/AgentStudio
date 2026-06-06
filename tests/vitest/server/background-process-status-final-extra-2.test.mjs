import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

import {
  backgroundDefinitionForRole,
  backgroundStatePath,
  getBackgroundProcessStatus,
  inspectAgentWorkerDemand,
  inspectMaintenanceWorkerDemand,
  inspectSourceWatcherDemand,
  normalizeBackgroundRoleList,
  writeBackgroundProcessState
} from "../../../server/platform/common/devops/process-status/background-process-status.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-background-status-final-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
  delete process.env.PACT_FEATURES;
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
});

afterEach(async () => {
  delete process.env.PACT_FEATURES;
  loadSettingsMock.mockReset();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("background-process-status final extra coverage", () => {
  it("filters worker roles by PACT_FEATURES and returns fallback definitions for unknown roles", () => {
    process.env.PACT_FEATURES = "knowledge-core, agent-exploration";

    expect(normalizeBackgroundRoleList()).toEqual(["source-watcher", "agent-worker"]);
    expect(normalizeBackgroundRoleList("import-worker,source-watcher,agent-worker")).toEqual([
      "source-watcher",
      "agent-worker"
    ]);
    expect(backgroundDefinitionForRole("unknown-worker")).toEqual({
      role: "unknown-worker",
      label: "unknown-worker",
      description: "",
      processType: "service",
      responsibility: "",
      services: [],
      features: [],
      monitors: [],
      alerts: []
    });
  });

  it("reports demand inspection errors for malformed source, maintenance, and settings files", async () => {
    await withTempUserData(async (userDataPath) => {
      await writeText(path.join(userDataPath, "knowledge-sources", "sources.json"), "{bad");
      await writeText(path.join(userDataPath, "maintenance-agent.json"), "{bad-config");
      await writeText(path.join(userDataPath, "maintenance-agent-runs.jsonl"), JSON.stringify({
        run: { runId: "run-a", status: "queued" }
      }));
      loadSettingsMock.mockRejectedValueOnce(new Error("settings unavailable"));

      const sourceDemand = await inspectSourceWatcherDemand(userDataPath);
      const maintenanceDemand = await inspectMaintenanceWorkerDemand(userDataPath);
      const agentDemand = await inspectAgentWorkerDemand(userDataPath);

      expect(sourceDemand).toMatchObject({
        active: false,
        error: expect.any(String)
      });
      expect(maintenanceDemand).toMatchObject({
        active: true,
        enabled: false,
        activeRunCount: 1,
        queuedRunCount: 1,
        error: expect.any(String)
      });
      expect(agentDemand).toMatchObject({
        active: false,
        reason: "inspection_failed",
        error: "settings unavailable"
      });
    });
  });

  it("marks stale, stopped, and inactive-demand records while preserving demand details", async () => {
    await withTempUserData(async (userDataPath) => {
      const oldIso = new Date(Date.now() - 120_000).toISOString();
      await writeJson(path.join(userDataPath, "jobs", "job-1", "meta.json"), {
        id: "job-1",
        status: "queued"
      });
      loadSettingsMock.mockResolvedValue({
        modelLibraryAgents: [
          {
            uid: "local-missing-url",
            provider: "local-model",
            model: "mistral"
          }
        ]
      });
      const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
        if (Number(pid) === process.pid) {
          return true;
        }
        const error = new Error("no such process");
        error.code = "ESRCH";
        throw error;
      });

      try {
        await writeBackgroundProcessState(userDataPath, {
          supervisor: {
            pid: 999999,
            startedAt: oldIso,
            updatedAt: oldIso,
            intervalMs: 1000,
            restartDelayMs: 1000,
            roles: ["import-worker", "agent-worker"]
          },
          inspectionDaemon: {
            pid: 999998,
            startedAt: oldIso,
            lastHeartbeatAt: oldIso
          },
          processes: [
            {
              role: "import-worker",
              pid: process.pid,
              status: "running",
              desired: true,
              startedAt: oldIso,
              lastHeartbeatAt: oldIso
            },
            {
              role: "agent-worker",
              pid: 999997,
              status: "running",
              desired: false,
              startedAt: oldIso,
              lastHeartbeatAt: oldIso
            }
          ]
        });

        const status = await getBackgroundProcessStatus(userDataPath);
        const byRole = new Map(status.processes.map((item) => [item.role, item]));

        expect(status.statePath).toBe(backgroundStatePath(userDataPath));
        expect(byRole.get("background-supervisor")).toMatchObject({
          status: "stopped",
          alive: false
        });
        expect(byRole.get("import-worker")).toMatchObject({
          desired: true,
          alive: true,
          stale: true,
          status: "stale",
          details: {
            demand: expect.objectContaining({
              active: true,
              activeJobIds: ["job-1"]
            })
          }
        });
        expect(byRole.get("agent-worker")).toMatchObject({
          desired: false,
          pid: 0,
          status: "not_connected",
          details: {
            demand: expect.objectContaining({
              reason: "not_connected",
              unavailableAgentIds: ["local-missing-url"]
            })
          }
        });
        expect(byRole.get("system-inspection")).toMatchObject({
          status: "stopped",
          alive: false
        });
      } finally {
        killSpy.mockRestore();
      }
    });
  });
});
