import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClientRuntimeBootstrapPlan,
  buildClientRuntimeBootstrapPull,
  planClientRuntimeTransports,
} from "../../../server/services/client/client-runtime-core/client-runtime-bootstrap.mjs";
import {
  CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
  createClientRuntimeAllocator,
} from "../../../server/services/client/client-runtime-core/client-runtime-allocator.mjs";
import {
  buildRunbookPlan,
  normalizeMaintenancePlan,
} from "../../../server/services/agent/maintenance-agent/planner.mjs";
import { createMaintenanceToolRegistry } from "../../../server/services/agent/maintenance-agent/tool-registry.mjs";

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-server-extra-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe("maintenance planner pure normalization", () => {
  it("normalizes runbook output with safe defaults and deterministic risk merge", () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });

    const plan = normalizeMaintenancePlan(
      {
        summary: 0,
        steps: [
          {
            toolId: "knowledge.reindex",
            risk: "unsafe",
            input: "invalid",
            reason: "",
          },
        ],
      },
      registry
    );

    expect(plan.source).toBe("runbook");
    expect(plan.intent).toBe("health_smoke");
    expect(plan.summary).toBe("执行维护巡检。");
    expect(plan.risk).toBe("repair_write");
    expect(plan.requiresApproval).toBe(true);
    expect(plan.steps[0]).toMatchObject({
      toolId: "knowledge.reindex",
      input: {},
      risk: "repair_write",
      reason: "执行 knowledge.reindex",
    });
  });

  it("builds knowledge maintenance runbook with explicit reindex and approval metadata", () => {
    const reviewPlan = buildRunbookPlan("knowledge_maintenance_review", { includeReindex: true });

    expect(reviewPlan.intent).toBe("knowledge_maintenance_review");
    expect(reviewPlan.requiresApproval).toBe(true);
    expect(reviewPlan.approvalReason).toContain("repair_write");
    expect(reviewPlan.steps.find((item) => item.toolId === "knowledge.reindex")).toBeTruthy();
  });

  it("falls back to health-smoke plan for unknown runbook ids", () => {
    const plan = buildRunbookPlan("unknown.runbook");

    expect(plan.intent).toBe("health_smoke");
    expect(plan.steps.map((item) => item.toolId)).toContain("system.health");
  });

  it("rejects normalized plans with unknown tool identifiers", () => {
    const registry = createMaintenanceToolRegistry({ getControllers: () => ({}) });

    expect(() =>
      normalizeMaintenancePlan(
        {
          steps: [{ toolId: "not.exists" }],
        },
        registry
      )
    ).toThrow("维护计划包含未知工具：not.exists");
  });
});

describe("client runtime bootstrap transport and module planning", () => {
  it("reports blocked transport candidates and keeps HTTP upload as deterministic fallback", () => {
    const transportPlan = planClientRuntimeTransports({
      client: { commands: ["sftp"] },
      serverCapabilities: { ssh: false, rsync: false, scp: false, sftp: true },
      transfer: { totalBytes: 16, fileCount: 2 },
    });

    expect(transportPlan.selected).toBe("pact-http-upload-session");
    expect(transportPlan.fallbackOrder).toEqual([
      "pact-http-upload-session",
      "mcp-inline-content",
    ]);
    const sftp = transportPlan.candidates.find((item) => item.id === "sftp");
    expect(sftp).toMatchObject({
      id: "sftp",
      available: false,
    });
    expect(sftp.blockedBy).toEqual(expect.arrayContaining(["client-ssh-missing", "server-ssh-not-declared"]));
  });

  it("expands module dependencies and keeps transport selection consistent", () => {
    const plan = buildClientRuntimeBootstrapPlan({
      clientUid: "desktop-a",
      client: { commands: ["ssh", "rsync"] },
      modules: ["mcp-local-bridge"],
      serverCapabilities: { ssh: true, rsync: true },
      transfer: { totalBytes: 2048, fileCount: 1 },
    });

    const moduleIds = new Set(plan.modules.map((item) => item.moduleId));
    expect(plan.transportPlan.selected).toBe("rsync-over-ssh");
    expect(moduleIds).toContain("mcp-local-bridge");
    expect(moduleIds).toContain("upload-queue");
    expect(moduleIds).toContain("transport-rsync");

    const pull = buildClientRuntimeBootstrapPull({
      clientUid: "desktop-a",
      client: { commands: ["ssh", "rsync"] },
      modules: ["mcp-local-bridge"],
      serverCapabilities: { ssh: true, rsync: true },
      transfer: { totalBytes: 2048, fileCount: 1 },
    });

    expect(pull.operation).toBe("client_runtime.bootstrap.pull");
    expect(pull.artifacts.length).toBe(pull.bundle.manifest.modules.length);
  });
});

describe("client runtime allocator persistence and deterministic allocation", () => {
  it("saves runtime profiles to temp user data and reloads normalized results", async () => {
    await withTempUserData(async (root) => {
      const allocator = createClientRuntimeAllocator({ userDataPath: root });
      await allocator.saveProfiles({
        version: 5,
        defaultProfile: {
          profileId: "default",
          modelAlias: "global-model",
          contextProfileId: "global-ctx",
          retrievalProfileId: "global-ret",
        },
        profiles: [
          {
            profileId: "low-priority",
            priority: 1,
            clientUid: "other",
            modelAlias: "other-model",
          },
          {
            profileId: "high-priority",
            priority: 9,
            clientUid: "agent-42",
            modelAlias: "agent-model",
            taskTypes: ["reindex"],
            contextProfileId: "agent-ctx",
            retrievalProfileId: "agent-ret",
            workspacePrefix: "agent-workspace",
          },
        ],
      });

      const reloaded = await createClientRuntimeAllocator({ userDataPath: root }).listProfiles();

      expect(reloaded.protocolVersion).toBe(CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION);
      expect(reloaded.version).toBe(5);
      expect(reloaded.configPath).toBe(path.join(root, "client-runtime", "client-runtime-allocator.json"));
      expect(reloaded.profiles.map((profile) => profile.profileId)).toEqual([
        "high-priority",
        "low-priority",
      ]);
      expect(reloaded.defaultProfile.modelAlias).toBe("global-model");
    });
  });

  it("resolves matched profiles, injects defaults, and writes usage state", async () => {
    await withTempUserData(async (root) => {
      const allocator = createClientRuntimeAllocator({ userDataPath: root });
      await allocator.saveProfiles({
        version: 7,
        defaultProfile: {
          profileId: "default",
          modelAlias: "global-model",
          contextProfileId: "global-ctx",
          retrievalProfileId: "global-ret",
          workspacePrefix: "client-workspace",
        },
        profiles: [
          {
            profileId: "agent",
            priority: 5,
            clientUid: "agent-42",
            modelAlias: "agent-model",
            contextProfileId: "agent-ctx",
            retrievalProfileId: "agent-ret",
            taskTypes: ["reindex", "repair"],
            workspacePrefix: "agent-workspace",
          },
        ],
      });

      const applyResult = await allocator.apply({
        clientUid: "agent-42",
        taskType: "reindex",
      }, { surface: "runtime-unit" });

      expect(applyResult.input.clientUid).toBe("agent-42");
      expect(applyResult.input.modelAlias).toBe("agent-model");
      expect(applyResult.input.alias).toBe("agent-model");
      expect(applyResult.input.contextProfileId).toBe("agent-ctx");
      expect(applyResult.input.retrievalProfileId).toBe("agent-ret");
      expect(applyResult.input.workspaceId).toMatch(/^agent-workspace-agent-42-[a-f0-9]{12}$/);
      expect(applyResult.input.sessionId).toBe(applyResult.input.workspaceId);
      expect(applyResult.allocation.applied.modelAlias).toBe(true);
      expect(applyResult.allocation.applied.contextProfileId).toBe(true);

      const status = await allocator.getStatus();
      expect(status.summary.totalCalls).toBe(1);
      expect(status.heatmap.clients[0].clientUid).toBe("agent-42");
      expect(status.heatmap.clients[0].totalCalls).toBe(1);
    });
  });
});
