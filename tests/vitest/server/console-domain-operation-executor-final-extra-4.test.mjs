import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeDependenciesMock = vi.hoisted(() => ({
  listRuntimeDependencies: vi.fn(async () => ({ dependencies: [{ id: "runtime-a" }] })),
  downloadRuntimeDependency: vi.fn(),
  updateRuntimeDependencyConfiguration: vi.fn()
}));

const repoOperationsMock = vi.hoisted(() => ({
  executeRepoOperation: vi.fn()
}));

const knowledgeBackendPortMock = vi.hoisted(() => ({
  createKnowledgeBackendPort: vi.fn()
}));

const cloudDriveMock = vi.hoisted(() => ({
  createCloudDriveUpstreamGateway: vi.fn(() => ({
    execute: vi.fn()
  })),
  isCloudDriveUpstreamGatewayOperation: vi.fn((operationId) => String(operationId || "").startsWith("external.cloudDrive."))
}));

const settingsMock = vi.hoisted(() => ({
  loadSettings: vi.fn(async () => ({ externalKnowledgeDistillationBaseUrl: "https://distill.example" })),
  normalizeSettings: vi.fn((settings) => settings),
  saveSettings: vi.fn(async (settings) => settings)
}));

const distillationMock = vi.hoisted(() => ({
  resolveExternalKnowledgeDistillationConfig: vi.fn(({ input = {}, settings = {} }) => ({
    baseUrl: input.baseUrl || settings.externalKnowledgeDistillationBaseUrl || "https://distill.example"
  })),
  createExternalKnowledgeDistillationClient: vi.fn()
}));

const backendPort = {
  connect: vi.fn(async () => ({ ok: true, connected: true })),
  listSpaces: vi.fn(async () => ({ ok: true, spaces: [{ id: "space-1" }] })),
  requestExport: vi.fn(async () => ({
    httpStatus: 202,
    exportId: "export-1",
    accessDecision: { decisionId: "decision-1" }
  })),
  requestPermission: vi.fn(async () => ({ ok: true, granted: true })),
  search: vi.fn(async () => ({ ok: true, items: [] })),
  getEvidence: vi.fn(async () => ({ ok: true, evidenceId: "kb-1" }))
};

const distillationClient = {
  baseUrl: "https://distill.example",
  health: vi.fn(async () => ({ ok: true, healthy: true })),
  capabilities: vi.fn(async () => ({ ok: true, capabilities: ["runs"] })),
  runtimeHealth: vi.fn(async () => ({ ok: true, runtime: "ready" })),
  listRuns: vi.fn(async () => ({ ok: true, items: [] })),
  createRun: vi.fn(async () => ({ ok: true, runId: "run-1" })),
  getRun: vi.fn(async () => ({ ok: true, runId: "run-1" })),
  cancelRun: vi.fn(async () => ({ ok: true, canceled: true })),
  queryEvidence: vi.fn(async () => ({ ok: true, evidence: [] })),
  queryProjectEvidence: vi.fn(async () => ({ ok: true, evidence: [] })),
  exportArtifact: vi.fn(async () => ({
    contentType: "text/plain",
    fileName: "artifact.txt",
    buffer: Buffer.from("artifact"),
    pactExternalServiceCall: {
      durationMs: 7,
      transferBytes: 9,
      bytesPerSecond: 11
    }
  }))
};

vi.mock("../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs", () => runtimeDependenciesMock);
vi.mock("../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs", () => repoOperationsMock);
vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => knowledgeBackendPortMock);
vi.mock("../../../server/platform/specialized/console/cloud-drive-upstream-gateway.mjs", () => cloudDriveMock);
vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => settingsMock);
vi.mock("../../../server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs", () => distillationMock);

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();

  runtimeDependenciesMock.listRuntimeDependencies.mockResolvedValue({ dependencies: [{ id: "runtime-a" }] });
  runtimeDependenciesMock.downloadRuntimeDependency.mockResolvedValue({ ok: true, dependencyId: "runtime-a" });
  runtimeDependenciesMock.updateRuntimeDependencyConfiguration.mockResolvedValue({ ok: true, saved: true });

  repoOperationsMock.executeRepoOperation.mockResolvedValue({ ok: true, repo: "delegated" });

  knowledgeBackendPortMock.createKnowledgeBackendPort.mockReturnValue(backendPort);
  distillationMock.createExternalKnowledgeDistillationClient.mockReturnValue(distillationClient);
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-domain-extra-4-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain executor final extra coverage 4", () => {
  it("returns the unregistered-operation payload for unknown operations", async () => {
    const result = await runOperation("console.unknown.operation", {
      input: { any: "value" },
      context: { userDataPath: "/tmp/unused" }
    });

    expect(result).toEqual({
      status: 501,
      payload: {
        ok: false,
        error: {
          code: "console_domain_operation_not_registered",
          message: "Console domain operation is not registered in the specialized executor.",
          details: { operationId: "console.unknown.operation" }
        }
      }
    });
  });

  it("passes auth, workspace, and runtime context through repo, knowledge backend, and tool delegation", async () => {
    await withTempDir(async (userDataPath) => {
      const authSession = {
        user: {
          userId: "u-1",
          username: "alice",
          roleId: "admin",
          scopes: ["console:read"]
        }
      };
      const knowledgeResult = await runOperation("knowledge.export.request", {
        input: {
          workspaceId: "ws-1"
        },
        context: {
          userDataPath,
          authSession
        }
      });

      expect(knowledgeBackendPortMock.createKnowledgeBackendPort).toHaveBeenCalledWith({ userDataPath });
      expect(backendPort.requestExport).toHaveBeenCalledWith(
        { workspaceId: "ws-1" },
        {
          subject: {
            type: "console-user",
            subjectId: "u-1",
            username: "alice",
            roleId: "admin",
            scopes: ["console:read"]
          },
          workspaceId: "ws-1"
        }
      );
      expect(knowledgeResult).toMatchObject({
        status: 202,
        payload: {
          exportId: "export-1"
        }
      });

      const repoResult = await runOperation("repo.status", {
        input: { ref: "main" },
        context: {
          authSession
        }
      });

      expect(repoOperationsMock.executeRepoOperation).toHaveBeenCalledWith({
        operationId: "repo.status",
        input: { ref: "main" },
        authSession
      });
      expect(repoResult).toMatchObject({
        status: 200,
        payload: {
          ok: true,
          repo: "delegated"
        }
      });

      const runtimeResult = await runOperation("runtime.dependencies.configure", {
        input: { targetId: "runtime-a" },
        context: {
          userDataPath
        }
      });

      expect(runtimeDependenciesMock.updateRuntimeDependencyConfiguration).toHaveBeenCalledWith({
        targetId: "runtime-a",
        userDataPath
      });
      expect(runtimeResult).toMatchObject({
        status: 200,
        payload: {
          ok: true,
          saved: true
        }
      });
    });
  });

  it("keeps external distillation working without an event bus and wraps backend or remote failures", async () => {
    await withTempDir(async (userDataPath) => {
      const authSession = {
        user: {
          userId: "u-2",
          username: "bob"
        }
      };

      const successResult = await runOperation("external.knowledge.distillation.runs.create", {
        input: {
          baseUrl: "https://distill.override"
        },
        context: {
          userDataPath
        }
      });

      expect(settingsMock.loadSettings).toHaveBeenCalledWith(userDataPath);
      expect(distillationMock.resolveExternalKnowledgeDistillationConfig).toHaveBeenCalledWith({
        input: { baseUrl: "https://distill.override" },
        settings: { externalKnowledgeDistillationBaseUrl: "https://distill.example" }
      });
      expect(distillationMock.createExternalKnowledgeDistillationClient).toHaveBeenCalledWith({
        baseUrl: "https://distill.override"
      });
      expect(successResult).toMatchObject({
        status: 201,
        payload: {
          ok: true,
          runId: "run-1"
        }
      });

      backendPort.requestExport.mockRejectedValueOnce(new Error("backend exploded"));

      const backendFailure = await runOperation("knowledge.export.request", {
        input: {
          workspaceId: "ws-1"
        },
        context: {
          userDataPath,
          authSession
        }
      });

      expect(backendFailure).toMatchObject({
        status: 400,
        payload: {
          ok: false,
          error: "backend exploded"
        }
      });

      distillationClient.createRun.mockRejectedValueOnce(Object.assign(new Error("remote exploded"), {
        statusCode: 700,
        payload: {
          code: "REMOTE_DOWN",
          details: ["offline"]
        },
        externalServiceCall: {
          durationMs: 3,
          transferBytes: 5,
          bytesPerSecond: 2
        }
      }));

      const remoteFailure = await runOperation("external.knowledge.distillation.runs.create", {
        input: {
          baseUrl: "https://distill.override"
        },
        context: {
          userDataPath
        }
      });

      expect(remoteFailure).toMatchObject({
        status: 502,
        payload: {
          ok: false,
          error: "remote exploded",
          service: "external.knowledge.distillation",
          code: "REMOTE_DOWN",
          details: ["offline"],
          pactExternalServiceCall: {
            durationMs: 3,
            transferBytes: 5,
            bytesPerSecond: 2
          }
        }
      });
    });
  });
});
