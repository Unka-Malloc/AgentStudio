import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const dispatchOperationMock = vi.hoisted(() => vi.fn());
const createTraceContextMock = vi.hoisted(() =>
  vi.fn(() => ({
    traceId: "trace-maintenance-agent-test",
    actor: {
      type: "maintenance-agent",
      userId: "maintenance-agent",
      username: "maintenance-agent",
      roleId: "maintenance-agent",
      scopes: ["maintenance:run"]
    }
  }))
);
const setTraceContextOnRequestMock = vi.hoisted(() => vi.fn());
const summarizeErrorMock = vi.hoisted(() => vi.fn((error) => error?.message || String(error || "")));
const summarizeForLogMock = vi.hoisted(() => vi.fn((value) => value));
const serverTokenMock = vi.hoisted(() => vi.fn((kind, scope, id) => `${kind}:${scope}:${id}`));
const unifiedRegistrationForTaskMock = vi.hoisted(() =>
  vi.fn((run) => ({
    taskType: "maintenance_agent_run",
    taskId: run?.runId || "",
    source: "maintenance-agent",
    feature: "智能巡检",
    kind: "task"
  }))
);
const loadSettingsMock = vi.hoisted(() => vi.fn(async () => ({})));
const resolveGatewayRuntimePlanMock = vi.hoisted(() =>
  vi.fn(({ adapterId, runtimeUrl, cacheRoot }) => ({
    adapterId,
    runtimeUrl: runtimeUrl || `https://example.invalid/${adapterId}.tgz`,
    executableName: adapterId,
    configuredBinary: "",
    cachedExecutablePath: path.join(cacheRoot || "", `${adapterId}.bin`)
  }))
);
const cloudDriveConfigPathMock = vi.hoisted(() =>
  vi.fn((userDataPath = "") => path.join(userDataPath, "cloud-drive.json"))
);
const knowledgeBackendConfigPathMock = vi.hoisted(() =>
  vi.fn((userDataPath = "") => path.join(userDataPath, "knowledge-backend.json"))
);
const spawnMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("spawn should not be called in runtime-maintenance final extra tests");
  })
);
const spawnSyncMock = vi.hoisted(() =>
  vi.fn((command, args = []) => {
    if (String(command) === "sh" && args[0] === "-c") {
      return { status: 1, signal: null, stdout: "", stderr: "" };
    }
    return { status: 1, signal: null, stdout: "", stderr: "" };
  })
);
const plannerPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    createTraceContext: createTraceContextMock,
    dispatchOperation: dispatchOperationMock,
    getRuntimeLogger: vi.fn(() => loggerMock),
    serverToken: serverTokenMock,
    setTraceContextOnRequest: setTraceContextOnRequestMock,
    summarizeError: summarizeErrorMock,
    summarizeForLog: summarizeForLogMock,
    unifiedRegistrationForTask: unifiedRegistrationForTaskMock
  };
});

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent/cloud-drive-port/index.mjs", () => ({
  cloudDriveConfigPath: cloudDriveConfigPathMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs", () => ({
  resolveGatewayRuntimePlan: resolveGatewayRuntimePlanMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => ({
  knowledgeBackendConfigPath: knowledgeBackendConfigPathMock
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock
}));

vi.mock("../../../server/services/agent/maintenance-agent/planner.mjs", () => ({
  createMaintenancePlanner: vi.fn(() => ({
    plan: plannerPlanMock
  }))
}));

import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  listRuntimeDependencyDownloadRuns,
  runtimeDependencySourceConfigPath,
  startRuntimeDependencyDownload,
  updateRuntimeDependencyConfiguration
} from "../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";
import { createMaintenanceAgentService } from "../../../server/services/agent/maintenance-agent/service.mjs";
import { createMaintenanceToolRegistry } from "../../../server/services/agent/maintenance-agent/tool-registry.mjs";

const tempDirs = [];

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function withTempDir(prefix, callback) {
  const dir = await makeTempDir(prefix);
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
}

async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function createPlan({
  intent = "health_smoke",
  risk = "read_only",
  requiresApproval = false,
  approvalReason = "",
  summary = "Maintenance plan",
  steps = [{ toolId: "system.health", risk: "read_only", reason: "probe", input: {} }]
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
      reason: step.reason || "",
      input: step.input || {}
    }))
  };
}

beforeEach(() => {
  dispatchOperationMock.mockReset();
  dispatchOperationMock.mockImplementation(async ({ operation, response }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write(JSON.stringify({ result: { ok: true, operationId: operation.id } }));
    response.end();
  });
  createTraceContextMock.mockClear();
  setTraceContextOnRequestMock.mockClear();
  summarizeErrorMock.mockClear();
  summarizeForLogMock.mockClear();
  serverTokenMock.mockClear();
  unifiedRegistrationForTaskMock.mockClear();
  loadSettingsMock.mockClear();
  resolveGatewayRuntimePlanMock.mockClear();
  cloudDriveConfigPathMock.mockClear();
  knowledgeBackendConfigPathMock.mockClear();
  spawnMock.mockClear();
  spawnSyncMock.mockClear();
  plannerPlanMock.mockReset();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
});

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { force: true, recursive: true })));
});

describe("runtime dependencies and maintenance agent final extra coverage", () => {
  it("repairs a bad runtime dependency manifest, updates list-style config fields, and tracks failed background downloads", async () => {
    await withTempDir("pact-runtime-maintenance-extra-3-", async (userDataPath) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath });
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "{ invalid json", "utf8");

      const listed = await listRuntimeDependencies({ userDataPath });
      const written = JSON.parse(await fs.readFile(configPath, "utf8"));

      expect(listed.ok).toBe(true);
      expect(listed.sourceConfigPath).toBe(configPath);
      expect(written.lastReadError).toContain("JSON");
      expect(written.protocolVersion).toBe("pact.runtime-dependencies.v1");

      const updated = await updateRuntimeDependencyConfiguration({
        userDataPath,
        entries: [
          { key: "sources.gerrit.mirrors", value: "https://mirror-a.invalid\nhttps://mirror-b.invalid" },
          { key: "sources.docker.url", value: "https://example.invalid/Docker.dmg" }
        ]
      });

      const merged = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(updated.ok).toBe(true);
      expect(updated.updated).toBe(2);
      expect(merged.sources.gerrit.mirrors).toEqual([
        "https://mirror-a.invalid",
        "https://mirror-b.invalid"
      ]);
      expect(merged.sources.docker.default.url).toBe("https://example.invalid/Docker.dmg");

      await expect(
        updateRuntimeDependencyConfiguration({
          userDataPath,
          entries: [{ key: "sources.unknown.default.url", value: "https://example.invalid" }]
        })
      ).rejects.toThrow("Unsupported runtime dependency source target: unknown");

      const queued = await startRuntimeDependencyDownload({
        userDataPath,
        targetId: "mystery-target"
      });

      expect(queued.ok).toBe(true);
      expect(queued.status).toBe("queued");
      expect(queued.run.status).toBe("queued");

      const failedRun = await waitUntil(() => {
        const run = listRuntimeDependencyDownloadRuns().downloads.find((item) => item.runId === queued.runId);
        return run && run.status === "failed" ? run : null;
      });

      expect(failedRun?.status).toBe("failed");
      expect(failedRun?.result?.error).toContain("Unsupported runtime dependency target");
      expect(failedRun?.steps.some((step) => step.status === "failed")).toBe(true);
    });
  });

  it("covers maintenance agent config, listing, approval, and cancellation boundary cases", async () => {
    await withTempDir("pact-maintenance-agent-extra-3-", async (userDataPath) => {
      plannerPlanMock.mockImplementation((input = {}) => {
        const runbook = String(input.runbook || input.intent || "").trim();
        if (runbook === "knowledge_maintenance_review") {
          return createPlan({
            intent: runbook,
            risk: "repair_write",
            requiresApproval: true,
            approvalReason: "repair_write 需要管理员批准。",
            summary: "Approval required maintenance plan.",
            steps: [{ toolId: "knowledge.reindex", risk: "repair_write", reason: "repair", input: {} }]
          });
        }
        return createPlan({
          intent: runbook || "health_smoke",
          risk: "read_only",
          summary: "Routine health plan.",
          steps: [{ toolId: "system.health", risk: "read_only", reason: "probe", input: {} }]
        });
      });

      const service = createMaintenanceAgentService({
        userDataPath,
        runtime: {},
        jobManager: null,
        metadataStore: null,
        schedulerEnabled: false,
        getControllers: () => ({ system: { health: {} }, knowledge: { reindex: {} } })
      });

      const configResult = await service.setConfig({
        enabled: true,
        plannerMode: "gateway",
        autoApproveRisk: "safe_write",
        schedules: [
          {
            id: "hourly-health",
            label: "Hourly health",
            enabled: true,
            runbook: "health_smoke",
            intervalMinutes: 30,
            nextRunAt: ""
          }
        ]
      });

      expect(configResult.config.enabled).toBe(true);
      expect(configResult.config.schedules[0].nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

      const config = await service.getConfig();
      expect(config.path).toBe(path.join(userDataPath, "maintenance-agent.json"));
      expect(config.config.plannerMode).toBe("gateway");

      const firstRun = await service.startRun({ runbook: "health_smoke", wait: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondRun = await service.startRun({ runbook: "health_smoke", wait: true });

      expect(firstRun.status).toBe("completed");
      expect(secondRun.status).toBe("completed");

      const latestOnly = await service.listRuns({ limit: -1 });
      expect(latestOnly.items).toHaveLength(1);
      expect(latestOnly.items[0].runId).toBe(secondRun.runId);

      const awaiting = await service.startRun({ runbook: "knowledge_maintenance_review", wait: false });
      expect(awaiting.status).toBe("awaiting_approval");
      expect(awaiting.requiresApproval).toBe(true);

      expect(await service.getRun("missing-run")).toBeNull();
      expect(await service.approveRun("missing-run", { planHash: awaiting.planHash })).toBeNull();
      await expect(
        service.approveRun(awaiting.runId, { planHash: "wrong-hash" })
      ).rejects.toThrow("审批 planHash 不匹配，计划变更后必须重新审批。");

      const approved = await service.approveRun(
        awaiting.runId,
        { planHash: awaiting.planHash, wait: true },
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

      await expect(
        service.approveRun(approved.runId, { planHash: approved.planHash })
      ).rejects.toThrow("只有 awaiting_approval 状态的维护运行可以审批。");

      expect(await service.cancelRun("missing-run")).toBeNull();
      const cancelledTerminal = await service.cancelRun(firstRun.runId, { reason: "too late" });
      expect(cancelledTerminal.status).toBe("completed");
      expect(cancelledTerminal.runId).toBe(firstRun.runId);

      await service.close();
    });
  });

  it("handles tool registry unknown-tool and execution-failure paths", async () => {
    const registry = createMaintenanceToolRegistry({
      userDataPath: "/tmp",
      getControllers: () => ({ system: { health: {} } }),
      logger: loggerMock
    });

    await expect(registry.runTool("maintenance-agent.unknown", {}, {})).rejects.toThrow(
      "维护工具不存在：maintenance-agent.unknown"
    );

    dispatchOperationMock.mockImplementationOnce(async ({ response }) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.write(JSON.stringify({ error: "operation failed" }));
      response.end();
    });

    await expect(registry.runTool("system.health", {}, { run: { runId: "run-1" } })).rejects.toThrow(
      "operation failed"
    );
  });
});
