import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMaintenanceAgentAuditStore } from "../../../server/services/agent/maintenance-agent/audit-store.mjs";
import { createMaintenanceAgentService } from "../../../server/services/agent/maintenance-agent/service.mjs";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const plannerPlanMock = vi.hoisted(() => vi.fn());
const toolRunMock = vi.hoisted(() => vi.fn());

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
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-focused-"));
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

vi.mock("../../../server/services/agent/maintenance-agent/planner.mjs", () => ({
  createMaintenancePlanner: vi.fn(() => ({
    plan: plannerPlanMock
  }))
}));

vi.mock("../../../server/services/agent/maintenance-agent/tool-registry.mjs", () => ({
  createMaintenanceToolRegistry: vi.fn(() => ({
    runTool: toolRunMock,
    listTools: () => [
      { id: "system.health", risk: "read_only", scopes: ["system:read"], timeoutMs: 5000 },
      { id: "knowledge.reindex", risk: "repair_write", scopes: ["knowledge:write"], timeoutMs: 180000 }
    ],
    hasTool: (toolId) => ["system.health", "knowledge.reindex"].includes(toolId),
    getTool: (toolId) =>
      ({
        "system.health": { id: "system.health", risk: "read_only" },
        "knowledge.reindex": { id: "knowledge.reindex", risk: "repair_write" }
      })[toolId] || null
  }))
}));

describe("maintenance agent service focused extra coverage", () => {
  beforeEach(() => {
    plannerPlanMock.mockReset();
    toolRunMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
  });

  it("loads defaults when config is missing and normalizes boundary config inputs", async () => {
    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false
      });

      const initial = await service.getConfig();

      expect(initial.path).toBe(path.join(userDataPath, "maintenance-agent.json"));
      expect(initial.config.enabled).toBe(false);
      expect(initial.config.plannerMode).toBe("gateway_fallback");
      expect(initial.config.schedules).toHaveLength(3);

      const saved = await service.setConfig({
        enabled: true,
        plannerMode: "not-a-real-mode",
        autoApproveRisk: "destructive",
        scheduler: { tickSeconds: 0 },
        schedules: [
          {
            id: "custom-schedule",
            label: "  boundary schedule  ",
            enabled: true,
            runbook: "made-up",
            intervalMinutes: 0,
            nextRunAt: "   "
          }
        ]
      });

      expect(saved.config.enabled).toBe(true);
      expect(saved.config.plannerMode).toBe("gateway_fallback");
      expect(saved.config.autoApproveRisk).toBe("safe_write");
      expect(saved.config.scheduler.tickSeconds).toBe(1);
      expect(saved.config.schedules).toHaveLength(1);
      expect(saved.config.schedules[0]).toMatchObject({
        id: "custom-schedule",
        label: "boundary schedule",
        runbook: "health_smoke",
        intervalMinutes: 1,
        enabled: true
      });
      expect(saved.config.schedules[0].nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

      await service.close();
    });
  });

  it("records approval-required status, audit events, and run transition events", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "repair_write 需要管理员批准。",
        steps: [
          {
            toolId: "knowledge.reindex",
            risk: "repair_write",
            reason: "repair",
            input: { target: "knowledge-base" }
          }
        ]
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = {
        publish: vi.fn(async () => null)
      };
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        protocolEventBus,
        schedulerEnabled: false
      });
      const auditStore = createMaintenanceAgentAuditStore({ userDataPath });

      const awaiting = await service.startRun({
        runbook: "knowledge_maintenance_review",
        wait: false
      });

      expect(awaiting.status).toBe("awaiting_approval");
      expect(protocolEventBus.publish.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          "maintenance.agent.plan.created",
          "maintenance.agent.approval.required"
        ])
      );

      const auditBeforeApproval = await auditStore.listAudit({ limit: 10 });
      expect(auditBeforeApproval.map((item) => item.action)).toEqual(
        expect.arrayContaining(["plan.created", "approval.required"])
      );

      await expect(
        service.approveRun(awaiting.runId, {
          planHash: "wrong-hash",
          wait: false
        })
      ).rejects.toThrow("审批 planHash 不匹配，计划变更后必须重新审批。");

      const completed = await service.approveRun(
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

      expect(completed.status).toBe("completed");
      expect(completed.approvedBy).toMatchObject({
        userId: "admin",
        username: "admin",
        roleId: "system_admin"
      });
      expect(toolRunMock).toHaveBeenCalledOnce();
      expect(protocolEventBus.publish.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          "maintenance.agent.run.started",
          "maintenance.agent.tool.started",
          "maintenance.agent.tool.completed",
          "maintenance.agent.run.completed"
        ])
      );

      const auditActions = (await auditStore.listAudit({ limit: 20 })).map((item) => item.action);
      expect(auditActions).toEqual(
        expect.arrayContaining([
          "plan.created",
          "approval.required",
          "approval.approved",
          "run.started",
          "tool.started",
          "tool.completed",
          "run.completed"
        ])
      );

      const boundedRuns = await service.listRuns({ limit: 0 });
      expect(boundedRuns.items).toHaveLength(1);
      expect(boundedRuns.items[0].runId).toBe(awaiting.runId);
      expect(await service.getRun("")).toBeNull();

      const cancelledClone = await service.cancelRun(awaiting.runId, {
        reason: "terminal no-op"
      });
      expect(cancelledClone.status).toBe("completed");

      await service.close();
    });
  });

  it("logs queue monitor failures without breaking execution", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          {
            toolId: "system.health",
            risk: "read_only",
            reason: "probe",
            input: {}
          }
        ]
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const queueMonitor = {
        registerStarted: vi.fn(async () => {
          throw new Error("queue monitor down");
        }),
        registerHeartbeat: vi.fn(async () => {
          throw new Error("queue monitor down");
        }),
        registerClosed: vi.fn(async () => {
          throw new Error("queue monitor down");
        })
      };
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        queueMonitor,
        schedulerEnabled: false
      });

      const result = await service.startRun({
        runbook: "health_smoke",
        wait: true
      });

      expect(result.status).toBe("completed");
      expect(queueMonitor.registerStarted).toHaveBeenCalled();
      expect(queueMonitor.registerHeartbeat).toHaveBeenCalled();
      expect(queueMonitor.registerClosed).toHaveBeenCalled();
      expect(loggerMock.warn.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          "maintenance.agent.queue_monitor.start.failed",
          "maintenance.agent.queue_monitor.heartbeat.failed",
          "maintenance.agent.queue_monitor.close.failed"
        ])
      );

      const run = await waitUntil(async () => service.getRun(result.runId));
      expect(run?.status).toBe("completed");

      await service.close();
    });
  });

  it("marks a read-only run as completed_with_errors when an earlier step fails and a later step still runs", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          {
            toolId: "system.health",
            risk: "read_only",
            reason: "first",
            input: {}
          },
          {
            toolId: "system.health",
            risk: "read_only",
            reason: "second",
            input: {}
          }
        ]
      })
    );
    toolRunMock
      .mockRejectedValueOnce(new Error("first step failed"))
      .mockResolvedValueOnce({ ok: true, detail: "second step ok" });

    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = {
        publish: vi.fn(async () => null)
      };
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        protocolEventBus,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} } })
      });

      const completed = await service.startRun({
        runbook: "health_smoke",
        wait: true
      });

      expect(completed.status).toBe("completed_with_errors");
      expect(completed.steps[0]).toMatchObject({
        status: "failed",
        error: "first step failed"
      });
      expect(completed.steps[1]).toMatchObject({
        status: "completed"
      });
      expect(protocolEventBus.publish.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          "maintenance.agent.tool.failed",
          "maintenance.agent.tool.completed",
          "maintenance.agent.run.completed"
        ])
      );

      await service.close();
    });
  });

  it("handles missing approvals and cancellation boundaries around awaiting-approval runs", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "repair_write 需要管理员批准。",
        steps: [
          {
            toolId: "knowledge.reindex",
            risk: "repair_write",
            reason: "repair",
            input: { target: "knowledge-base" }
          }
        ]
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
      expect(await service.approveRun("missing-run-id", { planHash: awaiting.planHash })).toBeNull();

      const cancelled = await service.cancelRun(awaiting.runId, {
        reason: "no longer needed"
      });
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelRequested).toBe(true);

      await expect(
        service.approveRun(awaiting.runId, {
          planHash: awaiting.planHash
        })
      ).rejects.toThrow("只有 awaiting_approval 状态的维护运行可以审批。");

      const summary = await service.getConsoleSummary();
      expect(summary.pendingApprovalCount).toBe(0);
      expect(summary.latestRun?.runId).toBe(awaiting.runId);
      expect(summary.runs[0]?.status).toBe("cancelled");

      await service.close();
    });
  });
});
