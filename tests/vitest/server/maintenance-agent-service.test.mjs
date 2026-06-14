import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMaintenanceAgentAuditStore } from "../../../server/services/agent/maintenance-agent/audit-store.mjs";
import { createMaintenanceAgentService } from "../../../server/services/agent/maintenance-agent/service.mjs";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => error?.message || String(error || "")));
const toolRunMock = vi.hoisted(() => vi.fn());
const plannerPlanMock = vi.hoisted(() => vi.fn());
const toolListMock = vi.hoisted(() => [
  { id: "system.health", risk: "read_only", scopes: ["system:read"], timeoutMs: 5000 },
  { id: "knowledge.reindex", risk: "repair_write", scopes: ["knowledge:write"], timeoutMs: 180000 }
]);

function createEventBus() {
  return {
    publish: vi.fn(async () => null),
  };
}

function createToolManagementStore() {
  return {
    appendExecution: vi.fn(),
    appendMetric: vi.fn(),
    close: vi.fn(),
  };
}

function normalizeToolList() {
  return toolListMock.map((item) => ({ ...item }));
}

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
      reason: step.reason || "",
    })),
  };
}

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-maintenance-agent-service-"));
  try {
    return await callback(userDataPath);
  } finally {
    await fs.rm(userDataPath, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 50,
    });
  }
}

async function waitUntil(factory, {
  timeoutMs = 3000,
  intervalMs = 20,
} = {}) {
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
    summarizeError: summarizeErrorMock,
    summarizeForLog: vi.fn((value) => value),
    serverToken: vi.fn(() => "mock-token"),
    unifiedRegistrationForTask: vi.fn((run) => ({
      taskType: "maintenance_agent_run",
      taskId: run?.runId || "",
      source: "maintenance-agent",
      feature: "maintenance_agent",
      kind: "task",
    })),
  };
});

vi.mock("../../../server/services/agent/maintenance-agent/planner.mjs", () => ({
  createMaintenancePlanner: vi.fn(() => ({
    plan: plannerPlanMock,
  })),
}));

vi.mock("../../../server/services/agent/maintenance-agent/tool-registry.mjs", () => ({
  createMaintenanceToolRegistry: vi.fn(() => ({
    runTool: toolRunMock,
    listTools: () => normalizeToolList(),
    hasTool: (toolId) => normalizeToolList().some((item) => item.id === toolId),
    getTool: (toolId) => normalizeToolList().find((item) => item.id === toolId) || null,
  })),
}));

describe("maintenance agent service", () => {
  beforeEach(() => {
    toolRunMock.mockReset();
    plannerPlanMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    summarizeErrorMock.mockClear();
  });

  it("导出所有服务能力接口且能被实例化", async () => {
    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      await expect(service).toMatchObject({
        start: expect.any(Function),
        close: expect.any(Function),
        getConfig: expect.any(Function),
        setConfig: expect.any(Function),
        chat: expect.any(Function),
        startRun: expect.any(Function),
        listRuns: expect.any(Function),
        getRun: expect.any(Function),
        approveRun: expect.any(Function),
        cancelRun: expect.any(Function),
        getConsoleSummary: expect.any(Function),
        tickScheduler: expect.any(Function),
        toolRegistry: expect.any(Object),
      });

      await service.close();
    });
  });

  it("startRun 正常分支会执行所有步骤并完成 run", async () => {
    plannerPlanMock.mockResolvedValue(createPlan({ risk: "read_only", steps: [
      { toolId: "system.health", risk: "read_only", reason: "health probe", input: {} },
    ]}));
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBus();
      const toolManagementStore = createToolManagementStore();
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        protocolEventBus,
        schedulerEnabled: false,
        toolManagementStore,
      });

      const result = await service.startRun({ runbook: "health_smoke", wait: true });

      expect(result.status).toBe("completed");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({
        status: "completed",
        toolId: "system.health",
        error: "",
      });
      expect(toolManagementStore.appendExecution).toHaveBeenCalledOnce();
      expect(toolManagementStore.appendMetric).toHaveBeenCalledOnce();
      const topics = protocolEventBus.publish.mock.calls.map((item) => item[0]);
      expect(topics).toEqual(expect.arrayContaining([
        "maintenance.agent.plan.created",
        "maintenance.agent.run.started",
        "maintenance.agent.tool.started",
        "maintenance.agent.tool.completed",
        "maintenance.agent.run.completed",
      ]));

      await service.close();
    });
  });

  it("read_only 分支失败会进入 completed_with_errors 且保持非致命错误", async () => {
    plannerPlanMock.mockResolvedValue(createPlan({
      risk: "read_only",
      steps: [
        { toolId: "system.health", risk: "read_only", reason: "probe", input: {} },
      ],
    }));
    toolRunMock.mockRejectedValueOnce(new Error("temporary transport issue"));

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const result = await service.startRun({ runbook: "health_smoke", wait: true });

      expect(result.status).toBe("completed_with_errors");
      expect(result.error).toBe("");
      expect(result.steps[0]).toMatchObject({
        status: "failed",
        error: "temporary transport issue",
      });
      await service.close();
    });
  });

  it("高风险步骤失败会进入 failed 并带错误信息", async () => {
    plannerPlanMock.mockResolvedValue(createPlan({
      risk: "safe_write",
      steps: [
        { toolId: "system.health", risk: "safe_write", reason: "write check", input: {} },
      ],
    }));
    toolRunMock.mockRejectedValueOnce(new Error("io timeout"));

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const result = await service.startRun({ runbook: "knowledge_maintenance_review", wait: true });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("io timeout");
      expect(result.steps[0]).toMatchObject({
        status: "failed",
        error: "io timeout",
      });
      await service.close();
    });
  });

  it("chat 与审批路径：先返回等待审批，再校验 planHash 并在正确审批后继续执行", async () => {
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
            input: {},
          },
        ],
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
      });

      const awaiting = await service.chat({
        message: "请执行知识库重建",
        wait: false,
      });

      expect(awaiting.run.status).toBe("awaiting_approval");
      await expect(
        service.approveRun(awaiting.run.runId, {
          planHash: "bad-hash",
          wait: false,
        })
      ).rejects.toThrow("审批 planHash 不匹配，计划变更后必须重新审批。") ;

      const approved = await service.approveRun(
        awaiting.run.runId,
        {
          planHash: awaiting.run.planHash,
          wait: true,
        },
        {
          authSession: {
            user: {
              userId: "admin",
              username: "admin",
              roleId: "system_admin",
            },
          },
        }
      );

      expect(approved.status).toBe("completed");
      expect(approved.approvedBy).toMatchObject({
        userId: "admin",
        username: "admin",
        roleId: "system_admin",
      });
      expect(approved.steps[0].status).toBe("completed");
      await service.close();
    });
  });

  it("cancelRun 能在提交后终止运行", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          { toolId: "system.health", risk: "read_only", reason: "first", input: {} },
          { toolId: "system.health", risk: "read_only", reason: "second", input: {} },
        ],
      })
    );

    let invoked = 0;
    toolRunMock.mockImplementation(async () => {
      invoked += 1;
      if (invoked === 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      return { ok: true };
    });

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const queued = await service.startRun({ runbook: "health_smoke", wait: false });

      await service.cancelRun(
        queued.runId,
        {
          reason: "manual cancel",
        },
        {
          authSession: {
            user: {
              userId: "admin",
              username: "admin",
              roleId: "system_admin",
            },
          },
        }
      );

      const queuedAfter = await waitUntil(async () => {
        const current = await service.getRun(queued.runId);
        return current?.status === "cancelled" ? current : null;
      }, { timeoutMs: 1200, intervalMs: 20 });
      expect(queuedAfter?.status).toBe("cancelled");
      expect(queuedAfter?.error).toBe("管理员已取消维护运行。",);
      await service.close();
    });
  });

  it("cancelRun 在运行阶段会将运行降级为 cancelled", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          { toolId: "system.health", risk: "read_only", reason: "first", input: {} },
          { toolId: "system.health", risk: "read_only", reason: "second", input: {} },
        ],
      })
    );

    let invoked = 0;
    toolRunMock.mockImplementation(async () => {
      invoked += 1;
      if (invoked === 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      return { ok: true };
    });

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const running = await service.startRun({ runbook: "health_smoke", wait: false });
      const started = await waitUntil(async () => {
        const current = await service.getRun(running.runId);
        return current?.status === "running" ? current : null;
      }, { timeoutMs: 600, intervalMs: 20 });

      expect(started).toBeTruthy();

      const afterCancel = await service.cancelRun(
        running.runId,
        {
          reason: "manual cancel",
        },
        {
          authSession: {
            user: {
              userId: "admin",
              username: "admin",
              roleId: "system_admin",
            },
          },
        }
      );

      const cancelled = await waitUntil(async () => {
        const current = await service.getRun(running.runId);
        return current?.status === "cancelled" ? current : null;
      }, { timeoutMs: 1200, intervalMs: 20 });

      expect(afterCancel).toMatchObject({
        runId: running.runId,
        status: "cancelled",
      });
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.error).toBe("管理员已取消维护运行。",);
      expect(cancelled?.steps[1].status).toBe("cancelled");
      await service.close();
    });
  });

  it("getConfig/getConsoleSummary 结合状态衍生字段验证待审批数与最近计划时间", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "需人工确认。",
      })
    );

    await withTempUserData(async (userDataPath) => {
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const config = await service.setConfig({
        enabled: true,
        plannerMode: "gateway_fallback",
        autoApproveRisk: "safe_write",
        schedules: [
          {
            id: "schedule-1",
            label: "单元测试任务",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 20,
            nextRunAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      await service.startRun({ message: "需要审批", wait: false });
      const summary = await service.getConsoleSummary();
      const latestConfig = await service.getConfig();

      expect(summary.pendingApprovalCount).toBe(1);
      expect(summary.nextRunAt).toBe("2026-01-01T00:00:00.000Z");
      expect(summary.config.enabled).toBe(true);
      expect(Array.isArray(summary.tools)).toBe(true);
      expect(summary.auditPath).toBe(path.join(userDataPath, "maintenance-agent-audit.jsonl"));
      expect(latestConfig.path).toBe(path.join(userDataPath, "maintenance-agent.json"));
      expect(config.config.enabled).toBe(true);

      await service.close();
    });
  });

  it("tickScheduler 会调度到期 schedule，更新下一次运行时间并发布配置更新", async () => {
    plannerPlanMock.mockResolvedValue(
      createPlan({
        risk: "read_only",
        steps: [
          { toolId: "system.health", risk: "read_only", reason: "scheduled", input: {} },
        ],
      })
    );
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const protocolEventBus = createEventBus();
      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        protocolEventBus,
        schedulerEnabled: false,
      });

      await service.setConfig({
        enabled: true,
        autoApproveRisk: "safe_write",
        scheduler: { tickSeconds: 999 },
        schedules: [
          {
            id: "minute-tick",
            label: "分钟调度",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 1,
            nextRunAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      });

      await service.tickScheduler();
      const run = await waitUntil(async () => {
        const list = await service.listRuns({ limit: 5 });
        return list.items.find((item) => item.intent === "health_smoke");
      });
      const config = await service.getConfig();

      expect(run).toBeTruthy();
      expect(run.status).not.toBe("awaiting_approval");
      expect(config.config.schedules[0].nextRunAt).not.toBe("2000-01-01T00:00:00.000Z");
      const configEvents = protocolEventBus.publish.mock.calls.filter((call) =>
        call[0] === "maintenance.agent.config"
      );
      const configUpdated = configEvents.find((call) =>
        call[1]?.config?.schedules?.some((item) => item?.id === "minute-tick") &&
        call[2]?.type === "maintenance.agent.config.updated"
      );
      expect(configUpdated).toBeTruthy();
      const terminalRun = await waitUntil(async () => {
        if (!run?.runId) {
          return null;
        }
        const current = await service.getRun(run.runId);
        if (!current) {
          return null;
        }
        return ["completed", "completed_with_errors", "failed", "cancelled", "rejected"].includes(current.status)
          ? current
          : null;
      }, { timeoutMs: 3000, intervalMs: 20 });
      expect(terminalRun).toBeTruthy();

      await service.close();
    });
  });

  it("不会为未知运行重放配置错误：恢复运行快照会保持数据可读且包含审计记录", async () => {
    plannerPlanMock.mockResolvedValue(createPlan());
    toolRunMock.mockResolvedValue({ ok: true });

    await withTempUserData(async (userDataPath) => {
      const now = new Date().toISOString();
      const store = createMaintenanceAgentAuditStore({ userDataPath });
      await store.appendRunSnapshot({
        schemaVersion: "v0.0.1:schema:definition-1",
        runId: "maintenance_run_recover",
        status: "running",
        trigger: "manual",
        source: "runbook",
        intent: "health_smoke",
        summary: "恢复场景",
        risk: "read_only",
        requiresApproval: false,
        approvalReason: "",
        planHash: "restore-hash",
        plan: createPlan(),
        steps: [
          {
            stepId: "maintenance_run_recover_step_1",
            index: 0,
            toolId: "system.health",
            input: {},
            risk: "read_only",
            reason: "bootstrap",
            status: "running",
            startedAt: now,
            completedAt: "",
            durationMs: 0,
            output: null,
            error: "",
          },
        ],
        actor: null,
        input: {},
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: "",
        approvedAt: "",
        approvedBy: null,
        cancelRequested: false,
        error: "pending failure",
        auditIds: [],
      });
      await store.appendAudit({ action: "maintenance.agent.bootstrap", runId: "maintenance_run_recover", status: "ok" });

      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
      });

      const runs = await service.listRuns({ limit: 10 });
      const recovered = runs.items.find((item) => item.runId === "maintenance_run_recover");
      const audits = await service.getConsoleSummary();

      expect(recovered).toMatchObject({
        runId: "maintenance_run_recover",
        status: expect.any(String),
        error: "",
      });
      expect(["queued", "running", "completed"]).toContain(recovered.status);
      expect(typeof audits.activeRunId).toBe("string");
      expect(audits.runs[0]).toMatchObject({
        runId: "maintenance_run_recover",
      });

      await service.close();
    });
  });
});
