import { describe, expect, it, vi } from "vitest";
import { createJobWorkflowProvider } from "../../../server/platform/specialized/console/job-workflow-provider.mjs";
import { buildKnowledgeConsoleSummary } from "../../../server/platform/specialized/console/knowledge-console-summary.mjs";
import { buildRuntimeConsoleSummary } from "../../../server/platform/specialized/console/runtime-console-summary.mjs";
import { buildToolManagementClientConnectionRows } from "../../../server/platform/specialized/console/tool-management-client-connections.mjs";

describe("console summary and connection services", () => {
  it("creates a job workflow provider that forwards calls and reports optional capabilities", () => {
    const jobManager = {
      createJob: vi.fn((input) => ({ created: input })),
      getJob: vi.fn((jobId) => ({ jobId })),
      getJobByCheckpointId: vi.fn((checkpointId) => ({ checkpointId })),
      getJobResult: vi.fn((jobId) => ({ resultFor: jobId })),
      listJobs: vi.fn((input) => ({ items: [{ id: "job-1" }], input })),
      reparseJob: vi.fn((jobId, input) => ({ jobId, input })),
      getJobWorkflow: vi.fn((jobId) => ({ workflowFor: jobId })),
      listJobWorkflows: vi.fn((input) => [{ workflow: "workflow-1", input }])
    };

    const provider = createJobWorkflowProvider({ jobManager });

    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider.protocolVersion).toBe("pact.job-workflow.v1");
    expect(provider.describe()).toEqual({
      schemaVersion: 1,
      protocolVersion: "pact.job-workflow.v1",
      capabilities: [
        "jobs.create",
        "jobs.list",
        "jobs.get",
        "jobs.result",
        "jobs.reparse",
        "jobs.checkpoint.lookup",
        "jobs.workflow.get",
        "jobs.workflow.list",
        "workflow.durable_execution"
      ]
    });

    expect(provider.createJob({ title: "demo" })).toEqual({ created: { title: "demo" } });
    expect(provider.getJob("job-1")).toEqual({ jobId: "job-1" });
    expect(provider.getJobWorkflow("job-1")).toEqual({ workflowFor: "job-1" });
    expect(provider.listJobWorkflows({ limit: 2 })).toEqual([{ workflow: "workflow-1", input: { limit: 2 } }]);
    expect(provider.getJobByCheckpointId("checkpoint-1")).toEqual({ checkpointId: "checkpoint-1" });
    expect(provider.getJobResult("job-1")).toEqual({ resultFor: "job-1" });
    expect(provider.listJobs({ limit: 3 })).toEqual({ items: [{ id: "job-1" }], input: { limit: 3 } });
    expect(provider.reparseJob("job-1", { refresh: true })).toEqual({ jobId: "job-1", input: { refresh: true } });

    expect(jobManager.createJob).toHaveBeenCalledWith({ title: "demo" });
    expect(jobManager.listJobs).toHaveBeenCalledWith({ limit: 3 });
  });

  it("rejects missing job manager methods with a clear error", () => {
    expect(() => createJobWorkflowProvider({ jobManager: { createJob: vi.fn() } })).toThrow(
      "job workflow provider is not connected to jobManager: getJob, getJobByCheckpointId, getJobResult, listJobs, reparseJob"
    );
  });

  it("builds a knowledge console summary with redacted module paths and recent jobs", async () => {
    const knowledgeBase = {
      enabled: true,
      health: vi.fn(async () => ({
        rootPath: "/tmp/knowledge",
        nested: {
          databasePath: "/tmp/knowledge/db.sqlite",
          children: [{ extensionPath: "/tmp/knowledge/extensions/one" }]
        }
      })),
      capabilities: vi.fn(async () => ({
        extensionPath: "/tmp/knowledge/extensions/main",
        modules: [{ rootPath: "/tmp/knowledge/modules/a" }]
      })),
      getMaintenance: vi.fn(async () => ({ status: "ok" }))
    };
    const jobWorkflowProvider = {
      listJobs: vi.fn(async (input) => ({
        items: [{ id: "job-1", title: "demo" }],
        input
      }))
    };

    const summary = await buildKnowledgeConsoleSummary(
      { mounts: { knowledgeBase } },
      jobWorkflowProvider
    );

    expect(summary).toEqual({
      available: true,
      health: {
        nested: {
          children: [{}]
        }
      },
      capabilities: {
        modules: [{}]
      },
      maintenance: { status: "ok" },
      recentJobs: [{ id: "job-1", title: "demo" }]
    });
    expect(knowledgeBase.health).toHaveBeenCalledOnce();
    expect(knowledgeBase.capabilities).toHaveBeenCalledOnce();
    expect(knowledgeBase.getMaintenance).toHaveBeenCalledOnce();
    expect(jobWorkflowProvider.listJobs).toHaveBeenCalledWith({ limit: 8 });
  });

  it("falls back cleanly when the knowledge base or job workflow provider is absent", async () => {
    await expect(buildKnowledgeConsoleSummary({}, null)).resolves.toEqual({
      available: false,
      health: null,
      capabilities: null,
      maintenance: null,
      recentJobs: []
    });
  });

  it("returns null for runtime summaries without a module management provider", async () => {
    await expect(
      buildRuntimeConsoleSummary({
        settings: { runtime: true },
        features: ["feature-a"]
      })
    ).resolves.toBeNull();
  });

  it("delegates runtime summaries to the module management provider", async () => {
    const listAvailableAnalysisModules = vi.fn(async () => ["analysis-a"]);
    const moduleManagement = {
      buildRuntimeConsoleSummary: vi.fn(async (input) => ({
        ...input,
        provider: "module-management"
      }))
    };

    await expect(
      buildRuntimeConsoleSummary({
        moduleManagement,
        settings: { runtime: true },
        features: ["feature-a"],
        listAvailableAnalysisModules
      })
    ).resolves.toEqual({
      provider: "module-management",
      settings: { runtime: true },
      features: ["feature-a"],
      listAvailableAnalysisModules
    });

    expect(moduleManagement.buildRuntimeConsoleSummary).toHaveBeenCalledWith({
      settings: { runtime: true },
      features: ["feature-a"],
      listAvailableAnalysisModules
    });
  });

  it("passes through connection rows and tolerates missing or failing providers", async () => {
    const provider = {
      listMcpClientConnections: vi.fn(async ({ offlineAfterSeconds }) => [
        {
          clientId: "mcp:grant-1:codex",
          connectionState: offlineAfterSeconds > 30 ? "offline" : "connected",
          platform: "MCP 插件"
        }
      ])
    };

    await expect(
      buildToolManagementClientConnectionRows(provider, { offlineAfterSeconds: 45 })
    ).resolves.toEqual([
      {
        clientId: "mcp:grant-1:codex",
        connectionState: "offline",
        platform: "MCP 插件"
      }
    ]);
    expect(provider.listMcpClientConnections).toHaveBeenCalledWith({ offlineAfterSeconds: 45 });

    expect(buildToolManagementClientConnectionRows(null)).toEqual([]);
    expect(
      buildToolManagementClientConnectionRows({
        listMcpClientConnections: vi.fn(() => {
          throw new Error("connection projection failed");
        })
      })
    ).toEqual([]);
  });
});
