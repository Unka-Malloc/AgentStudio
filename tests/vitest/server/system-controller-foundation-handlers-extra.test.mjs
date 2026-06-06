import { afterEach, describe, expect, it, vi } from "vitest";

import { createSystemControllerFoundationHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-foundation-handlers.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function payloadFrom(requestBody, url = null) {
  const payload = {};
  if (requestBody?.length > 0) {
    Object.assign(payload, JSON.parse(requestBody.toString("utf8")));
  }
  if (url) {
    for (const [key, value] of url.searchParams.entries()) {
      payload[key] = value;
    }
  }
  return payload;
}

function createHarness(overrides = {}) {
  const agentWorkspace = overrides.agentWorkspace || { name: "agent-workspace" };
  const runtime = overrides.runtime || { name: "runtime" };
  const toolSkillManagementProvider = overrides.toolSkillManagementProvider || { name: "tool-skill-provider" };
  const strategyManagementProvider = overrides.strategyManagementProvider || { name: "strategy-provider" };

  const sendConsoleDomainOperation =
    overrides.sendConsoleDomainOperation ||
    vi.fn(async (payload) => ({ ok: true, payload }));
  const protocolPayload = overrides.protocolPayload || vi.fn(payloadFrom);
  const workspaceIdFrom =
    overrides.workspaceIdFrom ||
    vi.fn((payload) => `resolved:${payload.workspaceId || payload.path || "default"}`);
  const authorizationFacadeContext =
    overrides.authorizationFacadeContext ||
    vi.fn((authSession, extra = {}) => ({ scope: "authorization", authSession, ...extra }));
  const accessControlContext =
    overrides.accessControlContext ||
    vi.fn((authSession, extra = {}) => ({ scope: "access-control", authSession, ...extra }));
  const getToolSkillManagementProvider =
    overrides.getToolSkillManagementProvider ||
    vi.fn(() => toolSkillManagementProvider);
  const getStrategyManagementProvider =
    overrides.getStrategyManagementProvider ||
    vi.fn(() => strategyManagementProvider);

  const handlers = createSystemControllerFoundationHandlers({
    sendConsoleDomainOperation,
    protocolPayload,
    workspaceIdFrom,
    authorizationFacadeContext,
    accessControlContext,
    getToolSkillManagementProvider,
    getStrategyManagementProvider,
    agentWorkspace,
    runtime
  });

  return {
    accessControlContext,
    agentWorkspace,
    authorizationFacadeContext,
    getStrategyManagementProvider,
    getToolSkillManagementProvider,
    handlers,
    protocolPayload,
    runtime,
    sendConsoleDomainOperation,
    strategyManagementProvider,
    toolSkillManagementProvider,
    workspaceIdFrom
  };
}

const handlerExpectations = [
  ["handleAuthorizationSubjectResolve", "authorization.subject.resolve"],
  ["handleAuthorizationPolicyEvaluate", "authorization.policy.evaluate"],
  ["handleAuthorizationGovernanceSummary", "authorization.governance.summary"],
  ["handleAuthorizationRolesList", "authorization.roles.list"],
  ["handleAuthorizationRoleUpsert", "authorization.roles.upsert"],
  ["handleAuthorizationTeamsList", "authorization.teams.list"],
  ["handleAuthorizationTeamUpsert", "authorization.teams.upsert"],
  ["handleAuthorizationUserPoliciesList", "authorization.users.policies.list"],
  ["handleAuthorizationUserPolicyUpsert", "authorization.users.policy.upsert"],
  ["handleAuthorizationAgentGroupsList", "authorization.agent_groups.list"],
  ["handleAuthorizationAgentGroupUpsert", "authorization.agent_groups.upsert"],
  ["handleAuthorizationAgentBindingsList", "authorization.agents.bindings.list"],
  ["handleAuthorizationAgentBindingUpsert", "authorization.agents.binding.upsert"],
  ["handleAuthorizationApprovalsList", "authorization.approvals.list"],
  ["handleAuthorizationApprovalUpsert", "authorization.approvals.upsert"],
  ["handleAuthorizationApprovalRevoke", "authorization.approvals.revoke"],
  ["handleAuthorizationReceiptsList", "authorization.receipts.list"],
  ["handleAuthorizationLoanRecordsList", "authorization.loan_records.list"],
  ["handleAuthorizationDeniedRequestsList", "authorization.denied_requests.list"],
  ["handleAuthorizationGrantCreate", "authorization.grants.create"],
  ["handleAuthorizationGrantRevoke", "authorization.grants.revoke"],
  ["handleCreateMcpAuthorizationRequest", "tool_management.mcp.request_authorization"],
  ["handleListMcpAuthorizationRequests", "tool_management.mcp.list_requests"],
  ["handleResolveMcpAuthorizationRequest", "tool_management.mcp.resolve_request"],
  ["handleToolManagementPassthrough", "tool_management.http.passthrough"],
  ["handleWorkspaceProtocolInfo", "workspace.info"],
  ["handleWorkspaceProtocolFileUpload", "workspace.file.upload"],
  ["handleWorkspaceProtocolFileList", "workspace.file.list"],
  ["handleWorkspaceProtocolFileDownload", "workspace.file.download"],
  ["handleWorkspaceProtocolFileWrite", "workspace.file.write"],
  ["handleWorkspaceProtocolFilePatch", "workspace.file.patch"],
  ["handleWorkspaceContributionSubmit", "workspace.contribution.submit"],
  ["handleWorkspaceContributionList", "workspace.contribution.list"],
  ["handleWorkspaceContributionLeaderboard", "workspace.contribution.leaderboard"],
  ["handleWorkspaceContributionStats", "workspace.contribution.stats"],
  ["handleWorkspaceContributionReport", "workspace.contribution.report"],
  ["handleWorkspaceContributionAssetsList", "workspace.contribution.assets.list"],
  ["handleWorkspaceContributionPermissionRequest", "workspace.contribution.permission.request"],
  ["handleWorkspaceContributionPermissionGrant", "workspace.contribution.permission.grant"],
  ["handleWorkspaceContributionScan", "workspace.contribution.scan"],
  ["handleWorkspaceContributionReview", "workspace.contribution.review"],
  ["handleWorkspaceContributionPreview", "workspace.contribution.preview"],
  ["handleWorkspaceContributionPublish", "workspace.contribution.publish"],
  ["handleWorkspaceContributionAdopt", "workspace.contribution.adopt"],
  ["handleWorkspaceContributionReject", "workspace.contribution.reject"],
  ["handleWorkspaceContributionRequestChanges", "workspace.contribution.request_changes"],
  ["handleWorkspaceContributionRevoke", "workspace.contribution.revoke"],
  ["handleKnowledgeAccessEvaluate", "knowledge.access.evaluate"],
  ["handleKnowledgeAccessReceiptList", "knowledge.access.receipt.list"],
  ["handleKnowledgeAccessLoanRecordList", "knowledge.access.loan_record.list"],
  ["handleKnowledgeAccessDeniedRequestList", "knowledge.access.denied_request.list"],
  ["handleKnowledgeProtocolEvidenceGet", "knowledge.evidence"],
  ["handleKnowledgeBackendConnect", "knowledge.backend.connect"],
  ["handleKnowledgeSpaceList", "knowledge.space.list"],
  ["handleKnowledgeExportRequest", "knowledge.export.request"],
  ["handleKnowledgePermissionRequest", "knowledge.permission.request"],
  ["handleWorkspaceSkillUpload", "workspace.skill.upload"],
  ["handleWorkspaceSkillList", "workspace.skill.list"],
  ["handleWorkspaceSkillDownload", "workspace.skill.download"],
  ["handleWorkspaceSkillUsageReport", "workspace.skill.usage.report"],
  ["handleWorkspaceAssetPolicySet", "workspace.asset.policy.set"],
  ["handleWorkspaceAssetPermissionCheck", "workspace.asset.permission.check"]
];

function baseHandlerArgs() {
  return {
    approvalId: "approval-1",
    authSession: { sessionId: "session-1" },
    contributionId: "contribution-1",
    grantId: "grant-1",
    params: { passthroughParam: "from-route" },
    request: { method: "POST", requestId: "request-1" },
    requestBody: jsonBody({ workspaceId: "workspace-body", value: "from-body" }),
    requestId: "mcp-request-1",
    response: { tag: "response" },
    url: new URL("http://example.test/console?workspaceId=workspace-url&limit=2")
  };
}

describe("system controller foundation handlers", () => {
  it("registers all expected foundation handler methods", () => {
    const { handlers } = createHarness();

    expect(Object.keys(handlers).sort()).toEqual(handlerExpectations.map(([name]) => name).sort());
  });

  it("forwards every handler to its fallback domain operation", async () => {
    const harness = createHarness();

    for (const [name] of handlerExpectations) {
      await harness.handlers[name](baseHandlerArgs());
    }

    expect(harness.sendConsoleDomainOperation).toHaveBeenCalledTimes(handlerExpectations.length);
    expect(harness.sendConsoleDomainOperation.mock.calls.map(([payload]) => payload.operationId)).toEqual(
      handlerExpectations.map(([, operationId]) => operationId)
    );
  });

  it("merges identifiers, request data, providers, and contexts for key handler groups", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-2" };
    const request = { method: "PUT", requestId: "request-2" };
    const requestBody = jsonBody({ workspaceId: "workspace-body", value: "payload" });
    const url = new URL("http://example.test/console?workspaceId=workspace-url&path=/docs/readme.md");

    await harness.handlers.handleAuthorizationPolicyEvaluate({
      operation: { id: "authorization.policy.custom" },
      request,
      requestBody,
      response,
      authSession
    });
    await harness.handlers.handleAuthorizationApprovalRevoke({
      approvalId: "approval-from-route",
      requestBody,
      response,
      authSession
    });
    await harness.handlers.handleAuthorizationGrantRevoke({
      operation: { id: "authorization.grants.revoke.custom" },
      grantId: "grant-from-route",
      requestBody,
      response
    });
    await harness.handlers.handleToolManagementPassthrough({
      request,
      requestBody,
      url,
      response,
      params: { routeParam: "tools" }
    });
    await harness.handlers.handleWorkspaceProtocolFileUpload({
      requestBody,
      response,
      authSession
    });
    await harness.handlers.handleKnowledgeProtocolEvidenceGet({
      url,
      response,
      authSession
    });
    await harness.handlers.handleWorkspaceAssetPermissionCheck({
      request,
      requestBody,
      response,
      authSession
    });

    expect(harness.authorizationFacadeContext).toHaveBeenCalledWith(authSession, { request });
    expect(harness.authorizationFacadeContext).toHaveBeenCalledWith(authSession, {});
    expect(harness.accessControlContext).toHaveBeenCalledWith(authSession, { runtime: harness.runtime });
    expect(harness.workspaceIdFrom).toHaveBeenCalledWith({ workspaceId: "workspace-body", value: "payload" });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "authorization.policy.custom",
      input: {
        workspaceId: "workspace-body",
        value: "payload"
      },
      response,
      context: {
        scope: "authorization",
        authSession,
        request
      },
      errorMessage: "统一授权策略裁决失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "authorization.approvals.revoke",
      input: {
        workspaceId: "workspace-body",
        value: "payload",
        approvalId: "approval-from-route"
      },
      response,
      context: {
        scope: "authorization",
        authSession
      },
      errorMessage: "撤销智能体审批失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "authorization.grants.revoke.custom",
      input: {
        workspaceId: "workspace-body",
        value: "payload",
        grantId: "grant-from-route"
      },
      response,
      context: {
        toolSkillManagementProvider: harness.toolSkillManagementProvider
      },
      errorMessage: "撤销统一授权 grant 失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, {
      operationId: "tool_management.http.passthrough",
      input: {
        workspaceId: "workspace-url",
        value: "payload",
        path: "/docs/readme.md",
        routeParam: "tools"
      },
      response,
      context: {
        toolSkillManagementProvider: harness.toolSkillManagementProvider,
        strategyManagementProvider: harness.strategyManagementProvider,
        request,
        response,
        requestBody,
        url,
        method: "PUT"
      },
      errorMessage: "Tool Management API request failed."
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(5, {
      operationId: "workspace.file.upload",
      input: {
        workspaceId: "resolved:workspace-body",
        value: "payload"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "上传 workspace 文件失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(6, {
      operationId: "knowledge.evidence",
      input: {
        workspaceId: "workspace-url",
        path: "/docs/readme.md"
      },
      response,
      context: {
        scope: "access-control",
        authSession,
        runtime: harness.runtime
      },
      errorMessage: "读取知识证据失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(7, {
      operationId: "workspace.asset.permission.check",
      input: {
        workspaceId: "workspace-body",
        value: "payload"
      },
      response,
      context: {
        scope: "authorization",
        authSession,
        request
      },
      errorMessage: "检查工作空间资产权限失败。"
    });
  });

  it("propagates sendConsoleDomainOperation failures without swallowing the error", async () => {
    const error = new Error("foundation boom");
    const sendConsoleDomainOperation = vi.fn(async () => {
      throw error;
    });
    const harness = createHarness({ sendConsoleDomainOperation });

    await expect(harness.handlers.handleWorkspaceContributionReport({
      requestBody: jsonBody({ format: "json" }),
      response: {},
      authSession: { sessionId: "session-3" }
    })).rejects.toThrow("foundation boom");

    expect(sendConsoleDomainOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "workspace.contribution.report",
      input: { format: "json" },
      errorMessage: "生成贡献报告失败。"
    }));
  });
});
