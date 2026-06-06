import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVE_RISKS,
  DEFAULT_MAINTENANCE_AGENT_CONFIG,
  computeNextRunAt,
  getMaintenanceAgentAuditPath,
  getMaintenanceAgentConfigPath,
  getMaintenanceAgentRunsPath,
  loadMaintenanceAgentConfig,
  maxRisk,
  normalizeMaintenanceAgentConfig,
  normalizeRisk,
  saveMaintenanceAgentConfig,
  riskRank,
} from "../../../server/services/agent/maintenance-agent/config.mjs";

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-config-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe("maintenance agent config normalization", () => {
  it("normalizes risk levels and auto-approval boundaries", () => {
    expect(AUTO_APPROVE_RISKS).toEqual(["read_only", "safe_write"]);
    expect(normalizeRisk(" destructive ")).toBe("destructive");
    expect(normalizeRisk("unknown", "safe_write")).toBe("safe_write");
    expect(riskRank("repair_write")).toBeGreaterThan(riskRank("safe_write"));
    expect(maxRisk("read_only", "destructive", "safe_write")).toBe("destructive");
  });

  it("sanitizes schedules and clamps scheduler intervals", () => {
    const config = normalizeMaintenanceAgentConfig({
      enabled: true,
      plannerMode: "invalid",
      autoApproveRisk: "destructive",
      scheduler: { tickSeconds: 0 },
      schedules: [
        {
          id: "custom",
          label: "Custom",
          enabled: true,
          runbook: "missing",
          intervalMinutes: 0,
          nextRunAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });

    expect(config.enabled).toBe(true);
    expect(config.plannerMode).toBe("gateway_fallback");
    expect(config.autoApproveRisk).toBe("safe_write");
    expect(config.scheduler.tickSeconds).toBe(1);
    expect(config.schedules[0]).toMatchObject({
      id: "custom",
      enabled: true,
      runbook: "health_smoke",
      intervalMinutes: 1,
    });
  });

  it("uses stable maintenance-agent state paths and next-run timestamps", () => {
    const root = "/tmp/pact-user-data";
    expect(getMaintenanceAgentConfigPath(root)).toBe("/tmp/pact-user-data/maintenance-agent.json");
    expect(getMaintenanceAgentAuditPath(root)).toBe("/tmp/pact-user-data/maintenance-agent-audit.jsonl");
    expect(getMaintenanceAgentRunsPath(root)).toBe("/tmp/pact-user-data/maintenance-agent-runs.jsonl");
    expect(computeNextRunAt({ intervalMinutes: 30 }, new Date("2026-06-03T00:00:00.000Z"))).toBe(
      "2026-06-03T00:30:00.000Z",
    );
  });

  it("persists normalized config and preserves scheduler clamp behavior through storage", async () => {
    await withTempUserData(async (root) => {
      const configPath = getMaintenanceAgentConfigPath(root);
      const baseline = normalizeMaintenanceAgentConfig({
        enabled: true,
        plannerMode: "invalid",
        autoApproveRisk: "destructive",
        scheduler: { tickSeconds: 0 },
      });

      await fs.writeFile(configPath, JSON.stringify({
        enabled: baseline.enabled,
        plannerMode: baseline.plannerMode,
        autoApproveRisk: baseline.autoApproveRisk,
        scheduler: baseline.scheduler,
        schedules: [
          {
            id: "custom",
            label: "Custom",
            enabled: true,
            runbook: "missing",
            intervalMinutes: 0,
            nextRunAt: "2026-06-03T00:00:00.000Z",
          },
        ],
      }));

      const loaded = await loadMaintenanceAgentConfig(root);
      expect(loaded.autoApproveRisk).toBe("safe_write");
      expect(loaded.scheduler.tickSeconds).toBe(1);
      expect(loaded.plannerMode).toBe("gateway_fallback");
      expect(loaded.schedules[0]).toMatchObject({
        id: "custom",
        runbook: "health_smoke",
      });

      const saved = await saveMaintenanceAgentConfig(root, {
        enabled: false,
        plannerMode: "gateway",
        autoApproveRisk: "unknown",
        scheduler: { tickSeconds: -1 },
      });
      expect(saved.enabled).toBe(false);
      expect(saved.scheduler.tickSeconds).toBe(1);
      expect(saved.autoApproveRisk).toBe(DEFAULT_MAINTENANCE_AGENT_CONFIG.autoApproveRisk);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(persisted.autoApproveRisk).toBe(DEFAULT_MAINTENANCE_AGENT_CONFIG.autoApproveRisk);
      expect(persisted.plannerMode).toBe("gateway");
    });
  });

  it("throws when local config file contains invalid JSON", async () => {
    await withTempUserData(async (root) => {
      const configPath = getMaintenanceAgentConfigPath(root);
      await fs.writeFile(configPath, "not-json", "utf8");
      await expect(loadMaintenanceAgentConfig(root)).rejects.toThrow(SyntaxError);
    });
  });
});
