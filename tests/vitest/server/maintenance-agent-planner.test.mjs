import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMaintenancePlanner } from "../../../server/services/agent/maintenance-agent/planner.mjs";
import { createMaintenanceToolRegistry } from "../../../server/services/agent/maintenance-agent/tool-registry.mjs";

const callAgentGatewayMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const publicAgentGatewayConfigMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  callAgentGatewayMock.mockReset();
  loadSettingsMock.mockReset();
  publicAgentGatewayConfigMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
  publicAgentGatewayConfigMock.mockResolvedValue({ urlConfigured: true, agentName: "unit-test-agent" });
});

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    callAgentGateway: callAgentGatewayMock,
    loadSettings: loadSettingsMock,
    publicAgentGatewayConfig: publicAgentGatewayConfigMock,
  };
});

describe("maintenance planner behavior", () => {
  it("uses knowledge runbook branch for explicit keyword intent and plain fallback mode", async () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan({ message: "请帮我查看知识库维护情况" });

    expect(plan.intent).toBe("knowledge_maintenance_review");
    expect(plan.risk).toBe("safe_write");
    expect(plan.requiresApproval).toBe(false);
    expect(plan.steps.some((step) => step.toolId === "knowledge.maintenance.settings")).toBe(true);
  });

  it("builds storage and knowledge plan for storage keywords", async () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.fallbackPlan({ message: "storage" });

    expect(plan.intent).toBe("daily_storage_and_knowledge");
    expect(plan.steps.map((item) => item.toolId)).toContain("storage.doctor");
    expect(plan.requiresApproval).toBe(false);
  });

  it("builds runbook fallback plans and normalizes risks", async () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.fallbackPlan({ runbook: "knowledge_maintenance_review", options: { includeReindex: true } });

    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("knowledge_maintenance_review");
    expect(plan.risk).toBe("repair_write");
    expect(plan.requiresApproval).toBe(true);
    expect(plan.steps.some((step) => step.toolId === "knowledge.reindex")).toBe(true);
    expect(plan.approvalReason).toBe("knowledge.reindex 属于 repair_write，必须管理员审批。");
  });

  it("selects runbook from message keywords and applies fixed_runbook mode", async () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan({ message: "最近任务频繁失败，请帮我检查" }, { plannerMode: "fixed_runbook" });
    expect(plan.intent).toBe("failed_jobs_review");
    expect(plan.source).toBe("runbook");
  });

  it("uses gateway plan when gateway is configured in gateway mode", async () => {
    callAgentGatewayMock.mockResolvedValue({
      answer: JSON.stringify({
        intent: "health_smoke",
        summary: "网关下发计划。",
        risk: "safe_write",
        requiresApproval: false,
        approvalReason: "",
        steps: [{
          toolId: "jobs.list",
          input: { limit: 20 },
          risk: "read_only",
          reason: "查看最近任务。"
        }],
      }),
    });

    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan({ message: "帮我做一次健康检查" }, { plannerMode: "gateway" });

    expect(plan.source).toBe("agent_gateway");
    expect(plan.intent).toBe("health_smoke");
    expect(plan.summary).toBe("网关下发计划。");
    expect(plan.steps).toEqual([
      {
        toolId: "jobs.list",
        input: { limit: 20 },
        risk: "read_only",
        reason: "查看最近任务。",
      },
    ]);
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to runbook when gateway response is invalid in fallback mode", async () => {
    callAgentGatewayMock.mockResolvedValue({ answer: "not json at all" });
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan({ message: "health" }, { plannerMode: "gateway_fallback" });

    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("health_smoke");
    expect(plan.summary).toContain("已使用固定 runbook");
    expect(plan.steps.map((item) => item.toolId).includes("system.health")).toBe(true);
  });

  it("throws on gateway parse errors when gateway mode is strict", async () => {
    callAgentGatewayMock.mockResolvedValue({ answer: "not json at all" });
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    await expect(planner.plan({ message: "health" }, { plannerMode: "gateway" })).rejects.toThrow(
      "agent-gateway 未返回有效 JSON 计划。"
    );
  });

  it("invokes context compaction when run-time context runtime provides it", async () => {
    const compaction = vi.fn(async () => ({
      compacted: true,
      summary: "管理员最近上下文已压缩。",
      tokenReport: { total: 12 },
      boundary: { boundaryId: "boundary-1" },
      reinjection: { items: [{ key: "k1", value: "v1" }] },
    }));

    callAgentGatewayMock.mockResolvedValue({
      answer: JSON.stringify({
        intent: "health_smoke",
        summary: "网关下发计划。",
        risk: "read_only",
        requiresApproval: false,
        steps: [{ toolId: "system.health", risk: "read_only", input: {}, reason: "冒烟检查。" }],
      }),
    });

    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: { runCompaction: compaction },
    });

    const plan = await planner.plan(
      {
        message: "健康",
        recentTurns: [{ role: "user", content: "上次我提过系统异常" }],
      },
      { plannerMode: "gateway" }
    );

    expect(compaction).toHaveBeenCalledTimes(1);
    expect(compaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contextProfileId: "balanced",
        taskBrief: "健康",
        sessionId: "maintenance-agent",
      })
    );
    expect(plan.steps[0]).toMatchObject({
      toolId: "system.health",
      input: {},
      risk: "read_only",
    });
    expect(plan.source).toBe("agent_gateway");
  });

  it("returns unchanged message when compaction is disabled by runtime result", async () => {
    const compaction = vi.fn(async () => ({
      compacted: false,
      summary: "不会注入"
    }));

    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: { runCompaction: compaction },
    });

    const plan = await planner.plan(
      {
        message: "健康",
        recentTurns: [{ role: "user", content: "上次讨论过巡检" }],
      },
      { plannerMode: "gateway_fallback" }
    );

    expect(compaction).toHaveBeenCalledTimes(1);
    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("health_smoke");
    expect(plan.contextCompactionResult).toBeUndefined();
  });

  it("reports missing gateway config when gateway is enabled in strict mode", async () => {
    publicAgentGatewayConfigMock.mockResolvedValue({ urlConfigured: false });

    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    await expect(
      planner.plan({ message: "health" }, { plannerMode: "gateway" })
    ).rejects.toThrow("agent-gateway 未配置。");
  });

  it("falls back to runbook when gateway config is missing in fallback mode", async () => {
    publicAgentGatewayConfigMock.mockResolvedValue({ urlConfigured: false });

    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan(
      { message: "storage doctor" },
      { plannerMode: "gateway_fallback" }
    );

    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("daily_storage_and_knowledge");
    expect(plan.summary).toContain("已使用固定 runbook");
  });

  it("defaults to fallback mode when planner mode is omitted", async () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    const plan = await planner.plan({ message: "这是一次普通巡检请求" });
    expect(plan.intent).toBe("health_smoke");
    expect(plan.source).toBe("runbook");
  });

  it("passes through compact input when compaction is explicitly disabled", async () => {
    const compaction = vi.fn(async () => ({
      compacted: true,
      summary: "never used",
    }));
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: { runCompaction: compaction },
    });

    const plan = await planner.plan(
      {
        message: "健康",
        contextCompaction: false,
      },
      { plannerMode: "gateway_fallback" }
    );

    expect(compaction).not.toHaveBeenCalled();
    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("health_smoke");
  });

  it("skips compaction for short context when threshold is not met", async () => {
    const compaction = vi.fn(async () => ({
      compacted: true,
      summary: "never used",
    }));
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: { runCompaction: compaction },
    });

    const plan = await planner.plan(
      { message: "只有一句话" },
      { plannerMode: "gateway_fallback" }
    );

    expect(compaction).not.toHaveBeenCalled();
    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("health_smoke");
  });

  it("passes history branch into compaction input context", async () => {
    const compaction = vi.fn(async () => ({
      compacted: true,
      summary: "history branch",
    }));
    callAgentGatewayMock.mockResolvedValue({
      answer: JSON.stringify({
        intent: "health_smoke",
        summary: "历史分支覆盖",
        risk: "read_only",
        steps: [{
          toolId: "system.health",
          input: {},
          risk: "read_only",
          reason: "历史上下文测试。"
        }],
      }),
    });
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: { runCompaction: compaction },
    });

    await planner.plan(
      {
        history: "上次请求：检查 storage 与 jobs。",
        message: "health",
        contextProfileId: "balanced",
      },
      { plannerMode: "gateway" }
    );

    expect(compaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contextProfileId: "balanced",
        inputSource: "maintenance-agent-planner",
      })
    );
  });

  it("can parse JSON embedded in answer wrapper text", async () => {
    callAgentGatewayMock.mockResolvedValue({
      answer: "prefix text {\"intent\":\"daily_storage_and_knowledge\",\"risk\":\"safe_write\",\"steps\":[]}",
    });
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });
    const planner = createMaintenancePlanner({
      userDataPath: "/tmp/pact-maintenance-agent-planner",
      toolRegistry: registry,
      contextRuntime: null,
    });

    await expect(
      planner.plan({ message: "health" }, { plannerMode: "gateway" })
    ).rejects.toThrow("维护计划至少需要一个工具步骤。");
  });
});
