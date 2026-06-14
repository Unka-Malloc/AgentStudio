import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const evaluateKnowledgeAccessMock = vi.hoisted(() => vi.fn());
const createKnowledgeBackendPortMock = vi.hoisted(() => vi.fn());
const searchSourceFilesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/knowledge/agent-library/access-policy.mjs", async () => ({
  evaluateKnowledgeAccess: evaluateKnowledgeAccessMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => ({
  createKnowledgeBackendPort: createKnowledgeBackendPortMock
}));
vi.mock("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs", () => ({
  searchSourceFiles: searchSourceFilesMock
}));

const publishMock = vi.hoisted(() => vi.fn());
const createPublishEvent = (topic) => ({ id: `evt-${topic}`, topic, offset: 1 });

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import("../../../server/platform/specialized/console/console-domain-operation-executor.mjs"));
});

beforeEach(() => {
  evaluateKnowledgeAccessMock.mockReset();
  createKnowledgeBackendPortMock.mockReset();
  searchSourceFilesMock.mockReset();
  publishMock.mockClear();
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-domain-op-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe("console-domain operation dispatch", () => {
  it("returns unregistered operation error when no executor matches", async () => {
    const result = await executeConsoleDomainOperation({
      operationId: "unknown.operation",
      input: {}
    });

    expect(result).toEqual({
      status: 501,
      payload: {
        ok: false,
        error: {
          code: "console_domain_operation_not_registered",
          message: "Console domain operation is not registered in the specialized executor.",
          details: {
            operationId: "unknown.operation"
          }
        }
      }
    });
  });

  it("dispatches storage.summary to storage operation handler", async () => {
    const getStorageSummary = vi.fn(() => ({ totalBytes: 1024 }));

    const result = await executeConsoleDomainOperation({
      operationId: "storage.summary",
      context: { storageProvider: { getStorageSummary } }
    });

    expect(result).toEqual({
      status: 200,
      payload: {
        totalBytes: 1024
      }
    });
    expect(getStorageSummary).toHaveBeenCalledTimes(1);
  });

  it("returns missing-provider validation error for storage operation", async () => {
    const result = await executeConsoleDomainOperation({
      operationId: "storage.summary",
      context: {}
    });

    expect(result).toEqual({
      status: 503,
      payload: {
        error: "存储 provider 不可用。"
      }
    });
  });
});

describe("runtime and knowledge execution branches", () => {
  it("checks runtime path browse inputs and returns a directory snapshot", async () => {
    await withTempDir(async (root) => {
      const targetDir = path.join(root, "browse");
      await fs.mkdir(targetDir);
      await fs.writeFile(path.join(targetDir, "visible.txt"), "v");
      await fs.writeFile(path.join(targetDir, ".hidden.txt"), "h");
      await fs.mkdir(path.join(targetDir, "sub"));

      const result = await executeConsoleDomainOperation({
        operationId: "runtime.path_browse",
        input: {
          path: targetDir,
          mode: "file",
          extensions: ["txt"],
          includeHidden: false
        },
        context: { userDataPath: root, distPath: root }
      });

      expect(result.status).toBe(200);
      expect(result.payload.currentPath).toBe(targetDir);
      expect(result.payload.mode).toBe("file");
      expect(result.payload.entries).toEqual([
        {
          name: "sub",
          path: path.join(targetDir, "sub"),
          type: "directory",
          byteSize: 0,
          modifiedAt: expect.any(String),
          hidden: false,
          selectable: false,
          browsable: true
        },
        {
          name: "visible.txt",
          path: path.join(targetDir, "visible.txt"),
          type: "file",
          byteSize: 1,
          modifiedAt: expect.any(String),
          hidden: false,
          selectable: true,
          browsable: false
        }
      ]);
    });
  });

  it("routes knowledge search through external knowledge backend provider mode", async () => {
    const searchMock = vi.fn(async () => ({ items: [], count: 0 }));
    createKnowledgeBackendPortMock.mockReturnValue({ search: searchMock, connect: vi.fn() });

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.search",
      input: { query: "design", backend: "ragflow", limit: 3 },
      context: { userDataPath: "/tmp/pact-console-domain-test" }
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ items: [], count: 0 });
    expect(createKnowledgeBackendPortMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "design",
        limit: 3
      }),
      expect.objectContaining({
        subject: expect.objectContaining({
          type: "anonymous",
          subjectId: "",
          username: "",
          roleId: "",
          scopes: []
        }),
        workspaceId: "default"
      })
    );
  });

  it("routes knowledge search through source-file search mode", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-source-search-"));
    searchSourceFilesMock.mockResolvedValue({ items: [{ id: "sf-1" }] });

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.search",
      input: {
        query: "analysis",
        sourceSearch: true,
        limit: 1,
        all: true
      },
      context: { userDataPath }
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ items: [{ id: "sf-1" }] });
    expect(searchSourceFilesMock).toHaveBeenCalledWith({
      userDataPath,
      query: "analysis",
      limit: 1,
      returnAll: true
    });
    expect(createKnowledgeBackendPortMock).not.toHaveBeenCalled();
  });

  it("returns paginated knowledge access receipts from security storage", async () => {
    const listReceipts = vi.fn(() => [{ id: "r-1" }, { id: "r-2" }]);
    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.access.receipt.list",
      context: { securityPermissions: { listReceipts } }
    });

    expect(result).toEqual({
      status: 200,
      payload: {
        ok: true,
        schemaVersion: "v0.0.1:schema:definition-1",
        items: [{ id: "r-1" }, { id: "r-2" }],
        count: 2
      }
    });
    expect(listReceipts).toHaveBeenCalledWith({ limit: 100, subjectId: "" });
  });

  it("returns 503 for knowledge access list operations when security storage is missing", async () => {
    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.access.loan_record.list",
      context: {}
    });

    expect(result).toEqual({
      status: 503,
      payload: { error: "授权记录存储不可用。" }
    });
  });

  it("returns knowledge access decision and writes receipt/loan artifacts", async () => {
    const appendReceipt = vi.fn();
    const appendLoanRecord = vi.fn();
    const appendDeniedRequest = vi.fn();
    evaluateKnowledgeAccessMock.mockReturnValue({
      decisionId: "k-approval-1",
      knowledgeAccessReceipt: {
        id: "receipt-1",
        subject: { subjectId: "user-1" }
      },
      loanRecord: {
        id: "loan-1",
        subject: { subjectId: "user-1" }
      },
      deniedRequestAudit: {
        reason: "暂不具备读取权限。"
      }
    });

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.access.evaluate",
      input: { resourceId: "res-1" },
      context: {
        authSession: { user: { userId: "user-1", username: "alice", roleId: "owner" } },
        securityPermissions: {
          appendReceipt,
          appendLoanRecord,
          appendDeniedRequest
        }
      }
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      decision: {
        decisionId: "k-approval-1",
        knowledgeAccessReceipt: {
          id: "receipt-1",
          subject: { subjectId: "user-1" }
        },
        loanRecord: {
          id: "loan-1",
          subject: { subjectId: "user-1" }
        },
        deniedRequestAudit: {
          reason: "暂不具备读取权限。"
        }
      }
    });
    expect(appendReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "receipt-1", subject: { subjectId: "user-1" } }),
      expect.objectContaining({ decisionId: "k-approval-1", subjectId: "user-1" })
    );
    expect(appendLoanRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "loan-1", subject: { subjectId: "user-1" } }),
      expect.objectContaining({ decisionId: "k-approval-1", subjectId: "user-1" })
    );
    expect(appendDeniedRequest).toHaveBeenCalledWith({
      decisionId: "k-approval-1",
      subjectId: "user-1",
      operationId: "knowledge.access.evaluate",
      reasonCode: "knowledge_access_denied",
      deniedRequest: { reason: "暂不具备读取权限。" }
    });
  });

  it("returns 400 when knowledge access evaluation throws", async () => {
    evaluateKnowledgeAccessMock.mockImplementation(() => {
      throw new Error("policy service unavailable");
    });

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.access.evaluate",
      context: { authSession: null }
    });

    expect(result.status).toBe(400);
    expect(result.payload).toEqual({
      ok: false,
      error: "policy service unavailable"
    });
  });
});

describe("authorization and approval operations", () => {
  it("upserts approval and publishes governance refresh events", async () => {
    const securityPermissions = {
      getGovernancePolicyRevision: vi.fn(() => "rev-1"),
      upsertGovernanceApproval: vi.fn(() => ({ approvalId: "approval-1" }))
    };
    const protocolEventBus = {
      publish: publishMock.mockImplementation((_, __, opts) => createPublishEvent(opts.type))
    };

    const result = await executeConsoleDomainOperation({
      operationId: "authorization.approvals.upsert",
      input: { approvalId: "approval-1", approved: true },
      context: {
        securityPermissions,
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "owner" } }
      }
    });

    expect(result.status).toBe(200);
    expect(result.payload.approval).toEqual({ approvalId: "approval-1" });
    expect(result.payload.events).toEqual({
      governance: { id: "evt-authorization.governance.updated", offset: 1, topic: "authorization.governance.updated" },
      permissions: { id: "evt-permissions.updated", offset: 1, topic: "permissions.updated" }
    });
    expect(securityPermissions.upsertGovernanceApproval).toHaveBeenCalledWith({
      approvalId: "approval-1",
      approved: true
    });
    expect(protocolEventBus.publish).toHaveBeenCalledTimes(2);
  });

  it("returns not-found when revoking a missing approval", async () => {
    const securityPermissions = {
      revokeGovernanceApproval: vi.fn(() => null)
    };

    const result = await executeConsoleDomainOperation({
      operationId: "authorization.approvals.revoke",
      input: { approvalId: "missing" },
      context: { securityPermissions }
    });

    expect(result).toEqual({
      status: 404,
      payload: { error: "审批授权不存在。" }
    });
    expect(securityPermissions.revokeGovernanceApproval).toHaveBeenCalledWith("missing", "");
  });

  it("revokes approval and publishes governance refresh events", async () => {
    const securityPermissions = {
      revokeGovernanceApproval: vi.fn(() => ({ approvalId: "approval-1" }))
    };
    const protocolEventBus = {
      publish: publishMock.mockImplementation((_, __, opts) => createPublishEvent(opts.type))
    };

    const result = await executeConsoleDomainOperation({
      operationId: "authorization.approvals.revoke",
      input: { approvalId: "approval-1", reason: "manual" },
      context: {
        securityPermissions,
        protocolEventBus,
        authSession: null
      }
    });

    expect(result.status).toBe(200);
    expect(result.payload.approval).toEqual({ approvalId: "approval-1" });
    expect(result.payload.events).toMatchObject({
      governance: { id: "evt-authorization.governance.updated", offset: 1, topic: "authorization.governance.updated" },
      permissions: { id: "evt-permissions.updated", offset: 1, topic: "permissions.updated" }
    });
    expect(securityPermissions.revokeGovernanceApproval).toHaveBeenCalledWith("approval-1", "manual");
    expect(protocolEventBus.publish).toHaveBeenCalledTimes(2);
  });
});

describe("knowledge backend provider operations", () => {
  it("requests knowledge backend permission and returns 201", async () => {
    const requestPermission = vi.fn(async () => ({ ok: true, permissionId: "p-1" }));
    createKnowledgeBackendPortMock.mockReturnValue({
      requestPermission
    });

    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-permission-"));
    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.permission.request",
      input: { resourceId: "res-1", reason: "audit" },
      context: { userDataPath }
    });

    expect(result.status).toBe(201);
    expect(result.payload).toEqual({ ok: true, permissionId: "p-1" });
    expect(requestPermission).toHaveBeenCalledWith(
      { resourceId: "res-1", reason: "audit" },
      { subject: expect.objectContaining({ type: "anonymous", subjectId: "", username: "" }), workspaceId: "default" }
    );
  });

  it("maps unsupported knowledge backend provider errors to 404", async () => {
    const unsupportedError = Object.assign(new Error("unsupported provider"), { code: "UNSUPPORTED_PROVIDER" });
    createKnowledgeBackendPortMock.mockReturnValue({
      requestExport: vi.fn(async () => {
        throw unsupportedError;
      })
    });

    const result = await executeConsoleDomainOperation({
      operationId: "knowledge.export.request",
      input: { backend: "not-supported" },
      context: { userDataPath: "/tmp/pact-knowledge-backend-error-test" }
    });

    expect(result.status).toBe(404);
    expect(result.payload).toMatchObject({
      ok: false,
      error: "unsupported provider"
    });
  });
});

describe("tool-management passthrough dispatch", () => {
  it("dispatches tool management passthrough request and marks response handled", async () => {
    const request = { method: "POST", headers: { "x": "y" } };
    const response = {};
    const handleToolManagementHttpRequest = vi.fn(async () => true);
    const operationUrl = new URL("https://example.local/internal/tool-management");

    const result = await executeConsoleDomainOperation({
      operationId: "tool_management.http.passthrough",
      context: {
        toolSkillManagementProvider: { handleToolManagementHttpRequest },
        request,
        response,
        requestBody: Buffer.from("payload"),
        url: operationUrl,
        method: "GET"
      }
    });

    expect(result).toEqual({
      status: 200,
      payload: {
        __responseHandled: true
      }
    });
    expect(handleToolManagementHttpRequest).toHaveBeenCalledWith({
      request,
      response,
      requestBody: Buffer.from("payload"),
      url: operationUrl,
      method: "GET",
      dispatched: true
    });
  });

  it("maps missing tool-management route to 404", async () => {
    const handleToolManagementHttpRequest = vi.fn(async () => false);

    const result = await executeConsoleDomainOperation({
      operationId: "tool_management.http.passthrough",
      context: {
        toolSkillManagementProvider: { handleToolManagementHttpRequest }
      }
    });

    expect(result).toEqual({
      status: 404,
      payload: {
        error: "Tool Management API route not found."
      }
    });
  });

  it("maps missing tool-management provider to 503", async () => {
    const result = await executeConsoleDomainOperation({
      operationId: "tool_management.http.passthrough",
      context: {}
    });

    expect(result).toEqual({
      status: 503,
      payload: {
        error: "Tool/Skill management provider is unavailable."
      }
    });
  });
});

describe("validation branches", () => {
  it("rejects unsafe discovery config values before persistence", async () => {
    const result = await executeConsoleDomainOperation({
      operationId: "discovery.set_config",
      input: {
        bootstrapBaseUrl: "https://forbidden.example"
      },
      context: { userDataPath: await fs.mkdtemp(path.join(os.tmpdir(), "pact-discovery-config-")) }
    });

    expect(result).toEqual({
      status: 400,
      payload: {
        error: "discovery 配置不接受客户端传入的 URL、服务标识或标签字符串。"
      }
    });
  });
});
