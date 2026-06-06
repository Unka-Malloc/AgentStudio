import { describe, expect, it, vi } from "vitest";
import { createSystemControllerWorkspaceProtocolHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-workspace-protocol-handlers.mjs";

function createFixture() {
  const sendConsoleDomainOperation = vi.fn(async () => null);
  const protocolPayload = vi.fn((body, url = null) => ({ body, url }));
  const operationAuditStore = { service: "audit" };
  const checkpointTreeApi = { service: "checkpoint" };
  const agentWorkspace = { service: "workspace" };
  const knowledgeWorkflowContext = vi.fn((authSession) => ({
    workflow: true,
    authFromWorkflow: authSession?.actor || ""
  }));
  const accessControlContext = vi.fn((authSession) => ({
    access: true,
    authFromAccess: authSession?.actor || ""
  }));
  const handlers = createSystemControllerWorkspaceProtocolHandlers({
    sendConsoleDomainOperation,
    protocolPayload,
    operationAuditStore,
    checkpointTreeApi,
    agentWorkspace,
    knowledgeWorkflowContext,
    accessControlContext
  });
  return {
    accessControlContext,
    agentWorkspace,
    checkpointTreeApi,
    handlers,
    knowledgeWorkflowContext,
    operationAuditStore,
    protocolPayload,
    sendConsoleDomainOperation
  };
}

describe("system controller workspace protocol handlers", () => {
  it("forwards workspace audit and checkpoint handlers with expected payloads and contexts", async () => {
    const fixture = createFixture();
    const response = { statusCode: 200 };
    const url = new URL("http://localhost/api/workspace/audit?workspaceId=ws-1");
    const requestBody = Buffer.from(JSON.stringify({ workspaceId: "ws-1" }));
    const authSession = { actor: "owner" };

    await fixture.handlers.handleWorkspaceAuditQuery({ operation: null, url, response });
    await fixture.handlers.handleWorkspaceOperationHistory({ operation: { id: "custom.operation.history" }, url, response });
    await fixture.handlers.handleWorkspaceCheckpointTreeList({ operation: null, url, response });
    await fixture.handlers.handleWorkspaceCheckpointNodeGet({ operation: null, treeId: "tree-1", response });
    await fixture.handlers.handleWorkspaceCheckpointDiff({ operation: null, requestBody, response });
    await fixture.handlers.handleWorkspaceCheckpointRestorePreview({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleWorkspaceCheckpointRestore({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleWorkspaceCheckpointScopeQuery({ operation: null, requestBody, response });
    await fixture.handlers.handleWorkspaceOperationRevertScope({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleWorkspaceProposalCreate({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleWorkspaceProposalApply({ operation: null, requestBody, response, authSession });

    const calls = fixture.sendConsoleDomainOperation.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.operationId)).toEqual([
      "workspace.audit.query",
      "custom.operation.history",
      "workspace.checkpoint.tree.list",
      "workspace.checkpoint.node.get",
      "workspace.checkpoint.diff",
      "workspace.checkpoint.restore.preview",
      "workspace.checkpoint.restore",
      "workspace.checkpoint.scope.query",
      "workspace.operation.revert.scope",
      "workspace.proposal.create",
      "workspace.proposal.apply"
    ]);
    expect(calls[0]).toMatchObject({
      input: { body: Buffer.alloc(0), url },
      response,
      context: { operationAuditStore: fixture.operationAuditStore },
      errorMessage: "查询 workspace 审计失败。"
    });
    expect(calls[3]).toMatchObject({
      input: { treeId: "tree-1" },
      context: { checkpointTreeApi: fixture.checkpointTreeApi },
      errorMessage: "读取 workspace checkpoint 节点失败。"
    });
    expect(calls[5].context).toEqual({
      checkpointTreeApi: fixture.checkpointTreeApi,
      agentWorkspace: fixture.agentWorkspace,
      authSession
    });
    expect(calls[8].context).toEqual({
      operationAuditStore: fixture.operationAuditStore,
      authSession
    });
    expect(calls[9].context).toEqual({
      agentWorkspace: fixture.agentWorkspace,
      authSession
    });
    expect(fixture.protocolPayload).toHaveBeenCalledWith(Buffer.alloc(0), url);
    expect(fixture.protocolPayload).toHaveBeenCalledWith(requestBody);
  });

  it("forwards workspace code and codespace protocol handlers with auth context", async () => {
    const fixture = createFixture();
    const response = { statusCode: 200 };
    const requestBody = Buffer.from("{}");
    const authSession = { actor: "reviewer" };
    const cases = [
      ["handleWorkspaceCodeTargetEvaluate", "workspace.code.target.evaluate"],
      ["handleWorkspaceCodeChangePrepare", "workspace.code.change.prepare"],
      ["handleWorkspaceCodeChangeUpload", "workspace.code.change.upload"],
      ["handleWorkspaceCodeChangeLink", "workspace.code.change.link"],
      ["handleWorkspaceCodeChangeStatusSync", "workspace.code.change.status.sync"],
      ["handleCodespaceProvidersManifest", "codespace.providers.manifest"],
      ["handleCodespaceRepositoryStatus", "codespace.repository.status"],
      ["handleCodespaceTreeList", "codespace.tree.list"],
      ["handleCodespaceFileRead", "codespace.file.read"],
      ["handleCodespaceDiffRead", "codespace.diff.read"],
      ["handleCodespaceChangePrepare", "codespace.change.prepare"],
      ["handleCodespaceChangeUpload", "codespace.change.upload"],
      ["handleCodespaceReviewComment", "codespace.review.comment"],
      ["handleCodespaceReviewRequestChanges", "codespace.review.requestChanges"],
      ["handleCodespaceReviewApprove", "codespace.review.approve"],
      ["handleCodespaceReviewStatusSync", "codespace.review.status.sync"]
    ];

    for (const [handlerName, operationId] of cases) {
      await fixture.handlers[handlerName]({
        operation: null,
        requestBody,
        response,
        authSession
      });
      const call = fixture.sendConsoleDomainOperation.mock.calls.at(-1)?.[0];
      expect(call).toMatchObject({
        operationId,
        input: { body: requestBody, url: null },
        response,
        context: { authSession }
      });
    }

    expect(fixture.sendConsoleDomainOperation.mock.calls.find((call) =>
      call[0].operationId === "workspace.code.change.upload"
    )?.[0].errorMessage).toBe("Workspace code change upload failed.");
  });

  it("merges knowledge workflow and access control context for transformation exports", async () => {
    const fixture = createFixture();
    const response = { statusCode: 200 };
    const requestBody = Buffer.from("{}");
    const authSession = { actor: "distiller" };

    await fixture.handlers.handleRawCorpusFormatConvert({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleKnowledgeDossierExport({ operation: null, requestBody, response, authSession });
    await fixture.handlers.handleKnowledgeDistillationExport({ operation: { id: "custom.distill.export" }, requestBody, response, authSession });

    const calls = fixture.sendConsoleDomainOperation.mock.calls.slice(-3).map((call) => call[0]);
    expect(calls.map((call) => call.operationId)).toEqual([
      "raw-corpus.format.convert",
      "knowledge.dossier.export",
      "custom.distill.export"
    ]);
    expect(calls.every((call) => call.context.workflow === true && call.context.access === true)).toBe(true);
    expect(calls[0].context).toMatchObject({
      authFromWorkflow: "distiller",
      authFromAccess: "distiller"
    });
    expect(fixture.knowledgeWorkflowContext).toHaveBeenCalledTimes(3);
    expect(fixture.accessControlContext).toHaveBeenCalledTimes(3);
  });
});
