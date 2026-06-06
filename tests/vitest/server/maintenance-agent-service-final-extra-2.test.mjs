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
const configStore = vi.hoisted(() => new Map());

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
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-extra-2-"));
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
    appendJsonLineSerialized: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    },
    createTraceContext: vi.fn(({ actor } = {}) => ({
      traceId: "trace-maintenance-agent",
      actor: actor || {}
    })),
    dispatchOperation: vi.fn(async ({ response, operation, input = {} }) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          result: {
            ok: true,
            operationId: operation.id,
            input
          }
        })
      );
    }),
    getRuntimeLogger: vi.fn(() => loggerMock),
    serverToken: vi.fn((...parts) => parts.filter(Boolean).join(":")),
    setTraceContextOnRequest: vi.fn(),
    summarizeError: vi.fn((error) => error?.message || String(error || "")),
    summarizeForLog: vi.fn((value) => value),
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
      const normalized = actual.normalizeMaintenanceAgentConfig(input);
      configStore.set(userDataPath, normalized);
      return normalized;
    })
  };
});

vi.mock("../../../server/services/agent/maintenance-agent/planner.mjs", () => ({
  createMaintenancePlanner: vi.fn(() => ({
    plan: plannerPlanMock
  }))
}));

import { createMaintenanceAgentAuditStore } from "../../../server/services/agent/maintenance-agent/audit-store.mjs";
import { createMaintenanceAgentService } from "../../../server/services/agent/maintenance-agent/service.mjs";
import { createMaintenanceToolRegistry } from "../../../server/services/agent/maintenance-agent/tool-registry.mjs";

describe("maintenance agent service final extra coverage 2", () => {
  beforeEach(() => {
    plannerPlanMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    configStore.clear();
  });

  it("advances due schedules when the scheduler ticks", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        summary: "Scheduled health check.",
        steps: [{ toolId: "system.health", risk: "read_only", reason: "probe", input: {} }]
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

      await service.setConfig({
        enabled: true,
        scheduler: { tickSeconds: 1 },
        schedules: [
          {
            id: "due-health",
            label: "Due health",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 15,
            nextRunAt: "2020-01-01T00:00:00.000Z"
          }
        ]
      });

      const run = await waitUntil(async () => {
        await service.tickScheduler();
        const result = await service.listRuns({ limit: 10 });
        const scheduled = result.items.find((item) => item.trigger === "schedule");
        if (!scheduled || scheduled.status !== "completed") {
          return null;
        }
        return scheduled;
      }, { timeoutMs: 10_000, intervalMs: 50 });

      const config = await service.getConfig();
      const schedule = config.config.schedules.find((item) => item.id === "due-health");

      expect(plannerPlanMock).toHaveBeenCalled();
      expect(plannerPlanMock.mock.calls[0][0]).toMatchObject({
        runbook: "health_smoke"
      });
      expect(run).toMatchObject({
        trigger: "schedule",
        status: "completed",
        summary: "Scheduled health check."
      });
      expect(Date.parse(schedule.nextRunAt)).toBeGreaterThan(Date.parse("2020-01-01T00:00:00.000Z"));

      await service.close();
    });
  });

  it("uses the default runbook when startRun receives empty input", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        summary: "Default health run.",
        steps: [{ toolId: "system.health", risk: "read_only", reason: "probe", input: {} }]
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

      const run = await service.startRun({});

      expect(plannerPlanMock).toHaveBeenCalledOnce();
      expect(plannerPlanMock.mock.calls[0][0]).toMatchObject({
        runbook: "health_smoke"
      });
      expect(run).toMatchObject({
        status: "completed",
        trigger: "manual",
        summary: "Default health run."
      });
      expect(run.steps[0]).toMatchObject({
        toolId: "system.health",
        status: "completed"
      });

      await service.close();
    });
  });

  it("rejects empty approval hashes and returns null for unknown runs", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "approval needed",
        steps: [{ toolId: "knowledge.reindex", risk: "repair_write", reason: "repair", input: {} }]
      })
    );

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

      await expect(
        service.approveRun(awaiting.runId, {
          planHash: ""
        })
      ).rejects.toThrow("审批 planHash 不匹配，计划变更后必须重新审批。");

      expect(
        await service.approveRun("missing-run-id", {
          planHash: awaiting.planHash
        })
      ).toBeNull();

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

      await service.close();
    });
  });

  it("builds a console summary from the latest run and scheduled next run", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "approval needed",
        summary: "Needs approval.",
        steps: [{ toolId: "knowledge.reindex", risk: "repair_write", reason: "repair", input: {} }]
      })
    );

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ knowledge: { reindex: {} } })
      });

      await service.setConfig({
        enabled: true,
        schedules: [
          {
            id: "future-summary",
            label: "Future summary",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 60,
            nextRunAt: "2026-06-05T08:00:00.000Z"
          }
        ]
      });

      const awaiting = await service.startRun({
        runbook: "knowledge_maintenance_review",
        wait: false
      });
      const summary = await service.getConsoleSummary();

      expect(summary.latestRun).toMatchObject({
        runId: awaiting.runId,
        status: "awaiting_approval",
        summary: "Needs approval."
      });
      expect(summary.pendingApprovalCount).toBe(1);
      expect(summary.nextRunAt).toBe("2026-06-05T08:00:00.000Z");
      expect(summary.auditPath).toBe(path.join(userDataPath, "maintenance-agent-audit.jsonl"));
      expect(summary.runsPath).toBe(path.join(userDataPath, "maintenance-agent-runs.jsonl"));
      expect(summary.tools.some((tool) => tool.id === "system.health")).toBe(true);

      await service.close();
    });
  });

  it("redacts secrets in audit-store payloads and keeps latest runs sorted", async () => {
    await withTempUserData(async (userDataPath) => {
      const auditStore = createMaintenanceAgentAuditStore({ userDataPath });

      const auditEntry = await auditStore.appendAudit({
        action: "run.started",
        runId: "run-a",
        actor: {
          userId: "admin",
          token: "secret-token"
        },
        details: {
          note: "see /Users/unka/private/report.txt",
          password: "top-secret",
          nested: {
            apiKey: "abc-123"
          }
        }
      });

      await auditStore.appendRunSnapshot({
        runId: "run-1",
        status: "queued",
        updatedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-05T00:00:00.000Z"
      });
      await auditStore.appendRunSnapshot({
        runId: "run-2",
        status: "completed",
        updatedAt: "2026-06-05T01:00:00.000Z",
        createdAt: "2026-06-05T01:00:00.000Z"
      });
      await auditStore.appendRunSnapshot({
        runId: "run-1",
        status: "completed",
        updatedAt: "2026-06-05T02:00:00.000Z",
        createdAt: "2026-06-05T02:00:00.000Z"
      });

      const latestRuns = await auditStore.listLatestRuns({ limit: 10 });

      expect(auditEntry.actor.token).toBe("<redacted>");
      expect(auditEntry.details.note).toContain("<redacted-path>");
      expect(auditEntry.details.password).toBe("<redacted>");
      expect(auditEntry.details.nested.apiKey).toBe("<redacted>");
      expect(latestRuns).toHaveLength(2);
      expect(latestRuns[0]).toMatchObject({
        runId: "run-1",
        status: "completed",
        updatedAt: "2026-06-05T02:00:00.000Z"
      });
      expect(latestRuns[1]).toMatchObject({
        runId: "run-2",
        status: "completed",
        updatedAt: "2026-06-05T01:00:00.000Z"
      });
    });
  });

  it("exposes tool registry boundaries for unknown tools and missing controllers", async () => {
    const registry = createMaintenanceToolRegistry({
      userDataPath: "/tmp/unused",
      runtime: {},
      jobManager: null,
      metadataStore: null,
      getControllers: () => null
    });

    const tools = registry.listTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.id === "system.health")).toBe(true);
    expect(registry.hasTool("missing.tool")).toBe(false);
    expect(registry.getTool("missing.tool")).toBeNull();
    await expect(registry.runTool("missing.tool", {})).rejects.toThrow("维护工具不存在：missing.tool");
    await expect(registry.runTool("system.health", {})).rejects.toThrow(
      "维护工具无法取得 Operation controllers。"
    );
  });

  it("keeps failed maintenance runs observable when queue monitor hooks reject", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "safe_write",
        summary: "Controller missing run.",
        steps: [{ toolId: "knowledge.reindex", risk: "safe_write", reason: "repair", input: {} }]
      })
    );

    await withTempUserData(async (userDataPath) => {
      const queueMonitor = {
        registerStarted: vi.fn(async () => {
          throw new Error("queue start failed");
        }),
        registerHeartbeat: vi.fn(async () => {
          throw new Error("queue heartbeat failed");
        }),
        registerClosed: vi.fn(async () => {
          throw new Error("queue close failed");
        })
      };
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        queueMonitor,
        getControllers: () => null
      });
      await service.setConfig({
        enabled: true,
        autoApproveRisk: "safe_write"
      });

      const failed = await service.startRun({
        runbook: "knowledge_maintenance_review",
        wait: true
      });

      expect(failed).toMatchObject({
        status: "failed",
        error: "维护工具无法取得 Operation controllers。"
      });
      expect(failed.steps[0]).toMatchObject({
        toolId: "knowledge.reindex",
        status: "failed"
      });
      expect(queueMonitor.registerStarted).toHaveBeenCalled();
      expect(queueMonitor.registerHeartbeat).toHaveBeenCalled();
      expect(queueMonitor.registerClosed).toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "maintenance.agent.queue_monitor.start.failed",
        expect.objectContaining({
          error: "queue start failed"
        })
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "maintenance.agent.queue_monitor.heartbeat.failed",
        expect.objectContaining({
          error: "queue heartbeat failed"
        })
      );
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "maintenance.agent.queue_monitor.close.failed",
        expect.objectContaining({
          error: "queue close failed"
        })
      );

      const stored = await service.getRun(failed.runId);
      expect(stored.status).toBe("failed");

      await service.close();
    });
  });

  it("covers scheduler lifecycle skips and cancellation of a non-running run", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "manual approval required",
        summary: "Awaiting approval run.",
        steps: [{ toolId: "knowledge.reindex", risk: "repair_write", reason: "repair", input: {} }]
      })
    );

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: true,
        getControllers: () => ({ knowledge: { reindex: {} }, system: { health: {} } })
      });

      await service.start();
      await service.start();
      await service.tickScheduler();
      expect(loggerMock.debug).toHaveBeenCalledWith(
        "maintenance.agent.start.skipped",
        expect.objectContaining({ reason: "already_started" })
      );
      expect(loggerMock.debug).toHaveBeenCalledWith(
        "maintenance.agent.scheduler.tick.skipped",
        expect.objectContaining({ reason: "config_disabled" })
      );

      await service.setConfig({
        enabled: true,
        scheduler: { tickSeconds: 1 },
        schedules: [
          {
            id: "disabled-schedule",
            label: "Disabled schedule",
            enabled: false,
            runbook: "health_smoke",
            intervalMinutes: 5,
            nextRunAt: "2020-01-01T00:00:00.000Z"
          },
          {
            id: "missing-next-run",
            label: "Missing next run",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 5,
            nextRunAt: ""
          }
        ]
      });
      await service.tickScheduler();

      const config = await service.getConfig();
      const missingNextRun = config.config.schedules.find((schedule) => schedule.id === "missing-next-run");
      expect(missingNextRun.nextRunAt).toBeTruthy();
      expect(plannerPlanMock).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        "maintenance.agent.scheduler.started",
        expect.objectContaining({ tickMs: 1000 })
      );

      const awaiting = await service.startRun({
        runbook: "knowledge_maintenance_review",
        wait: false
      });
      const cancelled = await service.cancelRun(awaiting.runId, {
        reason: "operator cancelled"
      });
      const repeatedCancel = await service.cancelRun(awaiting.runId, {
        reason: "already terminal"
      });

      expect(cancelled).toMatchObject({
        runId: awaiting.runId,
        status: "cancelled",
        cancelRequested: true
      });
      expect(repeatedCancel).toMatchObject({
        runId: awaiting.runId,
        status: "cancelled"
      });
      expect(await service.cancelRun("missing-run-id")).toBeNull();
      expect(loggerMock.debug).toHaveBeenCalledWith(
        "maintenance.agent.queue.remove.skipped",
        expect.objectContaining({
          runId: awaiting.runId,
          reason: "not_queued"
        })
      );

      await service.close();
    });
  });
});
