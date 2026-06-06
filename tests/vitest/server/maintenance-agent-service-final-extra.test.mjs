import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const plannerPlanMock = vi.hoisted(() => vi.fn());
const toolRunMock = vi.hoisted(() => vi.fn());
const configStore = vi.hoisted(() => new Map());
const auditRunSnapshots = vi.hoisted(() => new Map());
const auditEntries = vi.hoisted(() => []);
let configSaveFailure = "";
let auditSnapshotFailure = "";

function createPlan({
  intent = "health_smoke",
  risk = "read_only",
  requiresApproval = false,
  approvalReason = "",
  steps = [{ toolId: "system.health", risk: "read_only", input: {}, reason: "check" }],
  summary = "Unit maintenance plan."
} = {}) {
  return {
    source: "runbook",
    intent,
    summary,
    risk,
    requiresApproval,
    approvalReason,
    steps: steps.map((step) => ({
      toolId: step.toolId,
      risk: step.risk,
      input: step.input || {},
      reason: step.reason || ""
    }))
  };
}

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-service-extra-"));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 50
    });
  }
}

async function waitUntil(factory, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await factory();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    getRuntimeLogger: vi.fn(() => loggerMock),
    summarizeError: vi.fn((error) => error?.message || String(error || "")),
    summarizeForLog: vi.fn((value) => value),
    serverToken: vi.fn(() => "mock-token"),
    unifiedRegistrationForTask: vi.fn((run) => ({
      taskType: "maintenance_agent_run",
      taskId: run?.runId || "",
      source: "maintenance-agent",
      feature: "maintenance_agent",
      kind: "task"
    }))
  };
});

vi.mock("../../../server/services/agent/maintenance-agent/config.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/agent/maintenance-agent/config.mjs");
  return {
    ...actual,
    loadMaintenanceAgentConfig: vi.fn(async (userDataPath) => {
      return configStore.get(userDataPath) || actual.DEFAULT_MAINTENANCE_AGENT_CONFIG;
    }),
    saveMaintenanceAgentConfig: vi.fn(async (userDataPath, input = {}) => {
      if (configSaveFailure) {
        throw new Error(configSaveFailure);
      }
      const normalized = actual.normalizeMaintenanceAgentConfig(input);
      configStore.set(userDataPath, normalized);
      return normalized;
    })
  };
});

vi.mock("../../../server/services/agent/maintenance-agent/audit-store.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/agent/maintenance-agent/audit-store.mjs");
  return {
    ...actual,
    createMaintenanceAgentAuditStore: vi.fn(({ userDataPath }) => ({
      auditPath: path.join(userDataPath, "maintenance-agent-audit.jsonl"),
      runsPath: path.join(userDataPath, "maintenance-agent-runs.jsonl"),
      async appendAudit(entry = {}) {
        const auditEntry = {
          auditId: entry.auditId || `audit_${auditEntries.length + 1}`,
          action: String(entry.action || "maintenance.agent.event"),
          runId: String(entry.runId || ""),
          stepId: String(entry.stepId || ""),
          status: String(entry.status || ""),
          risk: String(entry.risk || ""),
          details: entry.details || {}
        };
        auditEntries.push(auditEntry);
        return auditEntry;
      },
      async appendRunSnapshot(run) {
        if (auditSnapshotFailure) {
          throw new Error(auditSnapshotFailure);
        }
        auditRunSnapshots.set(run.runId, JSON.parse(JSON.stringify(run)));
        return { recordedAt: new Date().toISOString(), run };
      },
      async listAudit({ limit = 100 } = {}) {
        return auditEntries.slice(-Math.max(1, Math.min(500, Number(limit) || 100))).reverse();
      },
      async listLatestRuns({ limit = 50 } = {}) {
        return [...auditRunSnapshots.values()]
          .sort((left, right) =>
            String(right.updatedAt || right.createdAt || "").localeCompare(
              String(left.updatedAt || left.createdAt || "")
            )
          )
          .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
      }
    }))
  };
});

vi.mock("../../../server/services/agent/maintenance-agent/planner.mjs", () => ({
  createMaintenancePlanner: vi.fn(() => ({
    plan: plannerPlanMock
  }))
}));

vi.mock("../../../server/services/agent/maintenance-agent/tool-registry.mjs", () => ({
  createMaintenanceToolRegistry: vi.fn((options = {}) => ({
    listTools: () => [
      { id: "system.health", risk: "read_only", scopes: ["system:read"], timeoutMs: 5000 },
      { id: "knowledge.reindex", risk: "repair_write", scopes: ["knowledge:write"], timeoutMs: 180000 }
    ],
    getTool: (toolId) =>
      ({
        "system.health": { id: "system.health", risk: "read_only" },
        "knowledge.reindex": { id: "knowledge.reindex", risk: "repair_write" }
      }[toolId] || null),
    hasTool: (toolId) => Boolean({
      "system.health": true,
      "knowledge.reindex": true
    }[toolId]),
    async runTool(toolId, input = {}, context = {}) {
      if (!options.getControllers?.()) {
        throw new Error("维护工具无法取得 Operation controllers。");
      }
      return toolRunMock(toolId, input, context);
    }
  }))
}));

import { createMaintenanceAgentService } from "../../../server/services/agent/maintenance-agent/service.mjs";

describe("maintenance agent service final extra coverage", () => {
  beforeEach(() => {
    plannerPlanMock.mockReset();
    toolRunMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    configStore.clear();
    auditRunSnapshots.clear();
    auditEntries.length = 0;
    configSaveFailure = "";
    auditSnapshotFailure = "";
  });

  it("covers config persistence, run listing, and run lookup", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [{ toolId: "system.health", risk: "read_only", reason: "probe", input: {} }]
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} } })
      });

      const saved = await service.setConfig({
        enabled: true,
        plannerMode: "gateway",
        autoApproveRisk: "safe_write",
        schedules: [
          {
            id: "schedule-1",
            label: "nightly",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 15,
            nextRunAt: "2026-06-05T00:00:00.000Z"
          }
        ]
      });

      const started = await service.startRun({
        runbook: "health_smoke",
        wait: false
      });

      const finished = await waitUntil(async () => {
        const current = await service.getRun(started.runId);
        return current?.status === "completed" ? current : null;
      });

      const config = await service.getConfig();
      const runs = await service.listRuns({ limit: 1 });

      expect(saved.config.enabled).toBe(true);
      expect(config.path).toBe(path.join(userDataPath, "maintenance-agent.json"));
      expect(config.config.schedules[0].id).toBe("schedule-1");
      expect(runs.items).toHaveLength(1);
      expect(runs.items[0].runId).toBe(started.runId);
      expect(finished?.status).toBe("completed");
      expect((await service.getRun(started.runId))?.runId).toBe(started.runId);

      await service.close();
    });
  });

  it("rejects plans blocked by policy before creating a run", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "destructive",
        steps: [{ toolId: "knowledge.reindex", risk: "destructive", reason: "danger", input: {} }]
      })
    );

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} } })
      });

      await expect(
        service.chat({
          message: "直接执行高危维护",
          wait: false
        })
      ).rejects.toThrow("destructive 风险工具默认禁止由维护智能体执行。");

      expect(auditRunSnapshots.size).toBe(0);

      await service.close();
    });
  });

  it("supports approval flow and run completion after plan hash validation", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "repair_write 需要管理员批准。",
        steps: [{ toolId: "knowledge.reindex", risk: "repair_write", reason: "repair", input: {} }]
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ knowledge: { reindex: {} } })
      });

      const awaiting = await service.startRun({
        runbook: "knowledge_maintenance_review",
        wait: false
      });

      expect(awaiting.status).toBe("awaiting_approval");
      await expect(
        service.approveRun(awaiting.runId, {
          planHash: "bad-hash",
          wait: false
        })
      ).rejects.toThrow("审批 planHash 不匹配，计划变更后必须重新审批。");

      const approved = await service.approveRun(
        awaiting.runId,
        {
          planHash: awaiting.planHash,
          wait: true
        },
        {
          authSession: {
            user: {
              userId: "admin",
              username: "admin",
              roleId: "system_admin"
            }
          }
        }
      );

      expect(approved.status).toBe("completed");
      expect(approved.approvedBy).toMatchObject({
        userId: "admin",
        username: "admin",
        roleId: "system_admin"
      });
      expect(approved.steps[0].status).toBe("completed");

      await service.close();
    });
  });

  it("cancels a queued run and preserves terminal state", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          { toolId: "system.health", risk: "read_only", reason: "first", input: {} },
          { toolId: "system.health", risk: "read_only", reason: "second", input: {} }
        ]
      })
    );
    toolRunMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { ok: true };
    });

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} } })
      });

      const queued = await service.startRun({
        runbook: "health_smoke",
        wait: false
      });

      await service.cancelRun(
        queued.runId,
        { reason: "manual cancel" },
        {
          authSession: {
            user: {
              userId: "admin",
              username: "admin",
              roleId: "system_admin"
            }
          }
        }
      );

      const cancelled = await waitUntil(async () => {
        const current = await service.getRun(queued.runId);
        return current?.status === "cancelled" ? current : null;
      });

      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.error).toBe("管理员已取消维护运行。");

      await service.close();
    });
  });

  it("surfaces missing provider and storage failures", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "safe_write",
        steps: [{ toolId: "system.health", risk: "safe_write", reason: "probe", input: {} }]
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const missingProviderService = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => null
      });

      const failedRun = await missingProviderService.startRun({
        runbook: "health_smoke",
        wait: true
      });

      expect(failedRun.status).toBe("failed");
      expect(failedRun.error).toBe("维护工具无法取得 Operation controllers。");
      expect(failedRun.steps[0]).toMatchObject({
        status: "failed",
        error: "维护工具无法取得 Operation controllers。"
      });

      await missingProviderService.close();
    });

    configSaveFailure = "config storage failed";
    await withTempUserData(async (userDataPath) => {
      const storageService = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} } })
      });

      await expect(
        storageService.setConfig({
          enabled: true,
          plannerMode: "gateway",
          autoApproveRisk: "safe_write"
        })
      ).rejects.toThrow("config storage failed");

      await storageService.close();
    });
  });
});
