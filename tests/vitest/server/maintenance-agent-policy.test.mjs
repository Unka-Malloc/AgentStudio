import { describe, expect, it } from "vitest";
import {
  computePlanRisk,
  evaluateMaintenancePlanPolicy,
  ensurePlanAllowed,
  planHashableShape,
} from "../../../server/services/agent/maintenance-agent/policy.mjs";

describe("maintenance agent policy normalization", () => {
  it("derives plan risk from explicit and step risks", () => {
    const plan = {
      risk: "read_only",
      steps: [
        { toolId: "system.health", risk: "safe_write" },
        { toolId: "knowledge.reindex", risk: "repair_write" },
      ],
    };

    expect(computePlanRisk(plan)).toBe("repair_write");
  });

  it("renders hashable shape with string-safe normalization", () => {
    const shape = planHashableShape({
      intent: "health",
      summary: "demo",
      steps: [
        { toolId: "system.health", input: { verbose: true }, risk: "read_only", reason: "ok" },
        { toolId: "jobs.list", input: "invalid", risk: "safe_write", reason: 1 },
      ],
    });

    expect(shape).toEqual({
      intent: "health",
      summary: "demo",
      risk: "safe_write",
      steps: [
        {
          toolId: "system.health",
          input: { verbose: true },
          risk: "read_only",
          reason: "ok",
        },
        {
          toolId: "jobs.list",
          input: {},
          risk: "safe_write",
          reason: "1",
        },
      ],
    });
  });

  it("marks high risk plans as requiring administrative approval", () => {
    const policy = evaluateMaintenancePlanPolicy({
      plan: {
        risk: "safe_write",
        steps: [{ toolId: "knowledge.reindex", risk: "destructive" }],
      },
      config: { autoApproveRisk: "destructive" },
    });

    expect(policy).toMatchObject({
      ok: false,
      ok: false,
      risk: "destructive",
    });
    expect(policy.reason).toContain("默认禁止");
  });

  it("requires approval when plan risk exceeds configured auto-approve threshold", () => {
    const policy = evaluateMaintenancePlanPolicy({
      plan: {
        risk: "repair_write",
        steps: [{ toolId: "knowledge.reindex", risk: "repair_write" }],
      },
      config: { autoApproveRisk: "safe_write" },
    });

    expect(policy).toMatchObject({
      ok: true,
      risk: "repair_write",
      requiresApproval: true,
    });
    expect(policy.reason).toMatch(/repair_write 风险计划需要管理员批准/);
  });

  it("passes policy with explicit user approval hint", () => {
    const policy = evaluateMaintenancePlanPolicy({
      plan: {
        risk: "safe_write",
        requiresApproval: true,
        approvalReason: "人工确认流程被显式开启。",
      },
      config: { autoApproveRisk: "destructive" },
    });

    expect(policy).toMatchObject({
      ok: true,
      risk: "safe_write",
      requiresApproval: true,
    });
    expect(policy.reason).toBe("人工确认流程被显式开启。");
  });

  it("throws for prohibited plans and returns policy for allowed plans", () => {
    expect(() => ensurePlanAllowed({
      plan: {
        risk: "destructive",
        steps: [{ risk: "destructive" }],
      },
    })).toThrow("destructive 风险工具默认禁止由维护智能体执行。");

    expect(ensurePlanAllowed({
      plan: {
        risk: "safe_write",
        steps: [{ risk: "safe_write" }],
      },
      config: { autoApproveRisk: "safe_write" },
    })).toEqual({
      ok: true,
      risk: "safe_write",
      requiresApproval: false,
      reason: "",
    });
  });
});
