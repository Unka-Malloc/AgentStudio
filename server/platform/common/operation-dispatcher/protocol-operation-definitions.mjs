const DEFAULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true
});

function schema(required = [], properties = {}) {
  return {
    type: "object",
    required,
    additionalProperties: true,
    properties
  };
}

function protocolOperation({
  id,
  feature,
  label,
  description = "",
  targetMethod,
  method = "POST",
  path = "",
  query = [],
  params = [],
  scopes = [],
  risk = "read_only",
  readOnly = undefined,
  requiresConfirmation = false,
  approvalScope = "",
  inputSchema = DEFAULT_SCHEMA,
  aliases = [],
  deprecated = false,
  replacementService = "",
  replacementOperationPrefix = "",
  lifecycle = {},
  aspects = []
}) {
  const command = id.split(".");
  const normalizedMethod = String(method || "POST").toUpperCase();
  const bodyBound = !["GET", "HEAD", "OPTIONS"].includes(normalizedMethod);
  const httpPath = path || `/api/protocol/${command.join("/")}`;
  return {
    id,
    feature,
    label,
    description: description || `Protocol operation for ${id}.`,
    aliases,
    target: { controller: "system", method: targetMethod },
    http: { method: normalizedMethod, path: httpPath, query, localInForwardMode: true },
    rpc: bodyBound
      ? { method: id, body: "params", params }
      : { method: id, params, query },
    cli: {
      command,
      usage: bodyBound
        ? `${command.join(" ")} --body request.json`
        : `${command.join(" ")}`
    },
    requiredScopes: scopes,
    inputSchema,
    safety: {
      risk,
      requiresConfirmation,
      requiresConfirmationExplicit: true,
      approvalScope: approvalScope || (risk === "read_only" ? "" : scopes[0] || "maintenance:approve")
    },
    deprecated: deprecated === true,
    replacementService,
    replacementOperationPrefix,
    lifecycle,
    aspects,
    ...(readOnly === undefined ? {} : { readOnly })
  };
}

const WORKSPACE_ID_QUERY = [
  { name: "workspaceId", aliases: ["workspace-id", "workspaceId", "id"] }
];

const FILE_QUERY = [
  ...WORKSPACE_ID_QUERY,
  { name: "path", aliases: ["path", "filePath", "file-path"] },
  { name: "limit", aliases: ["limit"] },
  { name: "recursive", aliases: ["recursive"] }
];

const DRIVE_QUERY = [
  ...WORKSPACE_ID_QUERY,
  { name: "provider", aliases: ["provider", "driveProvider", "drive-provider"] },
  { name: "driveRef", aliases: ["drive-ref", "driveRef", "driveId", "drive-id"] },
  { name: "path", aliases: ["path", "filePath", "file-path", "folderPath", "folder-path"] },
  { name: "clientId", aliases: ["client-id", "clientId", "client", "subjectId", "subject-id"] }
];

const CLOUD_DRIVE_PROVIDER_SCHEMA = { type: "string", enum: ["icloud", "onedrive", "google-drive", "dropbox"] };
const CLOUD_DRIVE_MODE_SCHEMA = { type: "string", enum: ["local", "contract", "remote-live", "live"] };
const CLOUD_DRIVE_CONNECT_SCHEMA = schema(["provider"], {
  workspaceId: { type: "string" },
  provider: CLOUD_DRIVE_PROVIDER_SCHEMA,
  rootPath: { type: "string" },
  secretRef: { type: "string" },
  endpointRef: { type: "string" },
  endpointUrl: { type: "string" },
  mode: CLOUD_DRIVE_MODE_SCHEMA,
  managedFolder: { type: "boolean" },
  managedFolderRoot: { type: "string" },
  publicFolder: { type: "string" },
  allowedClients: { type: "array" },
  defaultClient: { type: "string" },
  directoryMappings: { type: "array" },
  exposedDirectories: { type: "array" }
});
const CLOUD_DRIVE_UPLOAD_SCHEMA = schema(["driveRef"], {
  workspaceId: { type: "string" },
  provider: { type: "string" },
  driveRef: { type: "string" },
  clientId: { type: "string" },
  path: { type: "string" },
  name: { type: "string" },
  parentPath: { type: "string" },
  content: { type: "string" },
  contentBase64: { type: "string" },
  overwrite: { type: "boolean" }
});
const CLOUD_DRIVE_SYNC_SCHEMA = schema(["driveRef"], {
  workspaceId: { type: "string" },
  provider: { type: "string" },
  driveRef: { type: "string" },
  clientId: { type: "string" },
  path: { type: "string" },
  direction: { type: "string" },
  targetPath: { type: "string" },
  limit: { type: "number" },
  confirm: { type: "boolean" }
});
const CLOUD_DRIVE_UPSTREAM_ASPECTS = Object.freeze(["external-service", "cloud-drive-upstream", "skill-hub"]);
const CLOUD_DRIVE_LEGACY_ASPECTS = Object.freeze(["cloud-drive-legacy-shim", "internal-deprecated", "external-replaced"]);
const CLOUD_DRIVE_REPLACEMENT_SERVICE = "external.cloudDrive";
const CLOUD_DRIVE_REPLACEMENT_PREFIX = "external.cloudDrive.";
const CLOUD_DRIVE_LEGACY_LIFECYCLE = Object.freeze({
  status: "deprecated",
  reason: "Cloud Drive Port has moved to the upstream service aspect gateway.",
  maintenancePolicy: "compatibility-shim-only",
  replacementService: CLOUD_DRIVE_REPLACEMENT_SERVICE
});

function cloudDriveUpstreamOperation(options = {}) {
  return protocolOperation({
    feature: "external",
    aspects: CLOUD_DRIVE_UPSTREAM_ASPECTS,
    ...options
  });
}

function cloudDriveLegacyOperation(options = {}) {
  return protocolOperation({
    feature: "agent_workspace",
    deprecated: true,
    replacementService: CLOUD_DRIVE_REPLACEMENT_SERVICE,
    replacementOperationPrefix: CLOUD_DRIVE_REPLACEMENT_PREFIX,
    lifecycle: CLOUD_DRIVE_LEGACY_LIFECYCLE,
    aspects: CLOUD_DRIVE_LEGACY_ASPECTS,
    ...options
  });
}

export const PROTOCOL_OPERATION_DEFINITIONS = Object.freeze([
  protocolOperation({
    id: "v001.baseline.status",
    feature: "system",
    label: "v0.0.1 基线状态",
    targetMethod: "handleV001BaselineStatus",
    method: "GET",
    path: "/api/v001/baseline/status",
    scopes: ["console:read"],
    readOnly: true,
    inputSchema: schema([], {
      includePorts: { type: "boolean" }
    })
  }),
  protocolOperation({
    id: "authorization.subject.resolve",
    feature: "auth",
    label: "解析授权主体",
    targetMethod: "handleAuthorizationSubjectResolve",
    method: "POST",
    path: "/api/authorization/subject/resolve",
    scopes: ["auth:admin"],
    inputSchema: schema([], {
      subject: { type: "object" },
      actor: { type: "object" }
    })
  }),
  protocolOperation({
    id: "authorization.policy.evaluate",
    feature: "auth",
    label: "统一授权策略裁决",
    targetMethod: "handleAuthorizationPolicyEvaluate",
    method: "POST",
    path: "/api/authorization/policy/evaluate",
    scopes: ["auth:admin"],
    inputSchema: schema([], {
      operationId: { type: "string" },
      operation: { type: "object" },
      tool: { type: "object" },
      subject: { type: "object" },
      resource: { type: "object" },
      requestedAction: { type: "string" },
      requestedEgress: { type: "string" }
    })
  }),
  protocolOperation({
    id: "authorization.governance.summary",
    feature: "auth",
    label: "统一权限治理摘要",
    targetMethod: "handleAuthorizationGovernanceSummary",
    method: "GET",
    path: "/api/authorization/governance",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.roles.list",
    feature: "auth",
    label: "列出权限角色",
    targetMethod: "handleAuthorizationRolesList",
    method: "GET",
    path: "/api/authorization/roles",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.roles.upsert",
    feature: "auth",
    label: "保存权限角色",
    targetMethod: "handleAuthorizationRoleUpsert",
    method: "POST",
    path: "/api/authorization/roles",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.teams.list",
    feature: "auth",
    label: "列出权限团队",
    targetMethod: "handleAuthorizationTeamsList",
    method: "GET",
    path: "/api/authorization/teams",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.teams.upsert",
    feature: "auth",
    label: "保存权限团队",
    targetMethod: "handleAuthorizationTeamUpsert",
    method: "POST",
    path: "/api/authorization/teams",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.users.policies.list",
    feature: "auth",
    label: "列出用户授权策略",
    targetMethod: "handleAuthorizationUserPoliciesList",
    method: "GET",
    path: "/api/authorization/users/policies",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.users.policy.upsert",
    feature: "auth",
    label: "保存用户授权策略",
    targetMethod: "handleAuthorizationUserPolicyUpsert",
    method: "POST",
    path: "/api/authorization/users/policy",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.agent_groups.list",
    feature: "auth",
    label: "列出智能体分组",
    targetMethod: "handleAuthorizationAgentGroupsList",
    method: "GET",
    path: "/api/authorization/agent-groups",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.agent_groups.upsert",
    feature: "auth",
    label: "保存智能体分组",
    targetMethod: "handleAuthorizationAgentGroupUpsert",
    method: "POST",
    path: "/api/authorization/agent-groups",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.agents.bindings.list",
    feature: "auth",
    label: "列出智能体绑定",
    targetMethod: "handleAuthorizationAgentBindingsList",
    method: "GET",
    path: "/api/authorization/agents/bindings",
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.agents.binding.upsert",
    feature: "auth",
    label: "保存智能体绑定",
    targetMethod: "handleAuthorizationAgentBindingUpsert",
    method: "POST",
    path: "/api/authorization/agents/binding",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.approvals.list",
    feature: "auth",
    label: "列出智能体审批",
    targetMethod: "handleAuthorizationApprovalsList",
    method: "GET",
    path: "/api/authorization/approvals",
    query: [
      { name: "userId", aliases: ["user-id", "userId"] },
      { name: "agentId", aliases: ["agent-id", "agentId"] },
      { name: "includeRevoked", aliases: ["include-revoked", "includeRevoked"] }
    ],
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.approvals.upsert",
    feature: "auth",
    label: "保存智能体审批",
    targetMethod: "handleAuthorizationApprovalUpsert",
    method: "POST",
    path: "/api/authorization/approvals",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.approvals.revoke",
    feature: "auth",
    label: "撤销智能体审批",
    targetMethod: "handleAuthorizationApprovalRevoke",
    method: "POST",
    path: "/api/authorization/approvals/:approvalId/revoke",
    params: [{ name: "approvalId", aliases: ["approval-id", "id"], required: true }],
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin"
  }),
  protocolOperation({
    id: "authorization.receipts.list",
    feature: "auth",
    label: "列出授权回执",
    targetMethod: "handleAuthorizationReceiptsList",
    method: "GET",
    path: "/api/authorization/receipts",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.loan_records.list",
    feature: "auth",
    label: "列出授权借用记录",
    targetMethod: "handleAuthorizationLoanRecordsList",
    method: "GET",
    path: "/api/authorization/loan-records",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.denied_requests.list",
    feature: "auth",
    label: "列出授权拒绝请求",
    targetMethod: "handleAuthorizationDeniedRequestsList",
    method: "GET",
    path: "/api/authorization/denied-requests",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["auth:admin"]
  }),
  protocolOperation({
    id: "authorization.grants.create",
    feature: "auth",
    label: "创建统一授权 grant",
    targetMethod: "handleAuthorizationGrantCreate",
    method: "POST",
    path: "/api/authorization/grants",
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin",
    inputSchema: schema([], {
      label: { type: "string" },
      scopes: { type: "array" },
      toolsets: { type: "array" },
      expiresAt: { type: "string" }
    })
  }),
  protocolOperation({
    id: "authorization.grants.revoke",
    feature: "auth",
    label: "撤销统一授权 grant",
    targetMethod: "handleAuthorizationGrantRevoke",
    method: "POST",
    path: "/api/authorization/grants/:grantId/revoke",
    params: [{ name: "grantId", aliases: ["grant-id", "id"], required: true }],
    scopes: ["auth:admin"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "auth:admin",
    inputSchema: schema([], {
      reason: { type: "string" }
    })
  }),

  protocolOperation({
    id: "workspace.info",
    feature: "agent_workspace",
    label: "读取 workspace 信息",
    targetMethod: "handleWorkspaceProtocolInfo",
    method: "GET",
    path: "/api/workspace/info",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.file.upload",
    feature: "agent_workspace",
    label: "上传 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFileUpload",
    path: "/api/workspace/files/upload",
    scopes: ["storage:write"],
    risk: "safe_write",
    inputSchema: schema(["workspaceId"], {
      workspaceId: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      contentBase64: { type: "string" }
    })
  }),
  protocolOperation({
    id: "workspace.file.list",
    feature: "agent_workspace",
    label: "列出 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFileList",
    method: "GET",
    path: "/api/workspace/files",
    query: FILE_QUERY,
    scopes: ["storage:read"]
  }),
  protocolOperation({
    id: "workspace.file.download",
    feature: "agent_workspace",
    label: "下载 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFileDownload",
    method: "GET",
    path: "/api/workspace/files/download",
    query: FILE_QUERY,
    scopes: ["storage:read"]
  }),
  protocolOperation({
    id: "workspace.file.read",
    feature: "agent_workspace",
    label: "读取 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFileDownload",
    method: "GET",
    path: "/api/workspace/files/read",
    query: FILE_QUERY,
    scopes: ["storage:read"]
  }),
  protocolOperation({
    id: "workspace.file.write",
    feature: "agent_workspace",
    label: "写入 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFileWrite",
    path: "/api/workspace/files/write",
    scopes: ["storage:write"],
    risk: "safe_write",
    inputSchema: schema(["workspaceId", "path"], {
      workspaceId: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      contentBase64: { type: "string" }
    })
  }),
  protocolOperation({
    id: "workspace.file.patch",
    feature: "agent_workspace",
    label: "补丁更新 workspace 文件",
    targetMethod: "handleWorkspaceProtocolFilePatch",
    path: "/api/workspace/files/patch",
    scopes: ["storage:write"],
    risk: "safe_write",
    inputSchema: schema(["workspaceId", "path"], {
      workspaceId: { type: "string" },
      path: { type: "string" },
      patch: { type: "string" },
      hunks: { type: "array" }
    })
  }),

  protocolOperation({
    id: "workspace.contribution.submit",
    feature: "agent_workspace",
    label: "提交 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionSubmit",
    path: "/api/workspace/contributions/submit",
    scopes: ["workspace:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "knowledge.contribution.submit",
    feature: "knowledge",
    label: "提交知识贡献资产",
    targetMethod: "handleWorkspaceContributionSubmit",
    path: "/api/knowledge/contributions/submit",
    scopes: ["knowledge:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.list",
    feature: "agent_workspace",
    label: "列出 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionList",
    method: "GET",
    path: "/api/workspace/contributions",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.contribution.leaderboard",
    feature: "agent_workspace",
    label: "读取 workspace 贡献排行榜",
    targetMethod: "handleWorkspaceContributionLeaderboard",
    method: "GET",
    path: "/api/workspace/contributions/leaderboard",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.contribution.stats",
    feature: "agent_workspace",
    label: "读取 workspace 贡献统计",
    targetMethod: "handleWorkspaceContributionStats",
    method: "GET",
    path: "/api/workspace/contributions/stats",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.contribution.report",
    feature: "agent_workspace",
    label: "生成 workspace 贡献报告",
    targetMethod: "handleWorkspaceContributionReport",
    path: "/api/workspace/contributions/report",
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.contribution.assets.list",
    feature: "agent_workspace",
    label: "列出已物化 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionAssetsList",
    method: "GET",
    path: "/api/workspace/contributions/assets",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.contribution.permission.request",
    feature: "agent_workspace",
    label: "请求 workspace 贡献资产权限",
    targetMethod: "handleWorkspaceContributionPermissionRequest",
    path: "/api/workspace/contributions/:contributionId/permission/request",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.permission.grant",
    feature: "agent_workspace",
    label: "授予 workspace 贡献资产权限",
    targetMethod: "handleWorkspaceContributionPermissionGrant",
    path: "/api/workspace/contributions/:contributionId/permission/grant",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),
  protocolOperation({
    id: "workspace.contribution.scan",
    feature: "agent_workspace",
    label: "扫描 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionScan",
    path: "/api/workspace/contributions/:contributionId/scan",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.review",
    feature: "agent_workspace",
    label: "审核 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionReview",
    path: "/api/workspace/contributions/:contributionId/review",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.preview",
    feature: "agent_workspace",
    label: "生成 workspace 贡献资产发布预览",
    targetMethod: "handleWorkspaceContributionPreview",
    path: "/api/workspace/contributions/:contributionId/preview",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.publish",
    feature: "agent_workspace",
    label: "发布 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionPublish",
    path: "/api/workspace/contributions/:contributionId/publish",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),
  protocolOperation({
    id: "workspace.contribution.adopt",
    feature: "agent_workspace",
    label: "跨 workspace 采用贡献资产",
    targetMethod: "handleWorkspaceContributionAdopt",
    path: "/api/workspace/contributions/:contributionId/adopt",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.reject",
    feature: "agent_workspace",
    label: "拒绝 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionReject",
    path: "/api/workspace/contributions/:contributionId/reject",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "repair_write"
  }),
  protocolOperation({
    id: "workspace.contribution.request_changes",
    feature: "agent_workspace",
    label: "要求修改 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionRequestChanges",
    path: "/api/workspace/contributions/:contributionId/request-changes",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.contribution.revoke",
    feature: "agent_workspace",
    label: "撤销 workspace 贡献资产",
    targetMethod: "handleWorkspaceContributionRevoke",
    path: "/api/workspace/contributions/:contributionId/revoke",
    params: [{ name: "contributionId", aliases: ["contribution-id", "id"], required: true }],
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),

  protocolOperation({
    id: "workspace.proposal.create",
    feature: "agent_workspace",
    label: "创建 workspace 提案",
    targetMethod: "handleWorkspaceProposalCreate",
    path: "/api/workspace/proposals/create",
    scopes: ["workspace:write"],
    risk: "safe_write",
    inputSchema: schema(["workspaceId", "title"], {
      workspaceId: { type: "string" },
      runId: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      proposal: { type: "object" },
      evidenceRefs: { type: "array" }
    })
  }),
  protocolOperation({
    id: "workspace.proposal.apply",
    feature: "agent_workspace",
    label: "审核并应用 workspace 提案",
    targetMethod: "handleWorkspaceProposalApply",
    path: "/api/workspace/proposals/apply",
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain",
    inputSchema: schema(["workspaceId", "proposalId"], {
      workspaceId: { type: "string" },
      proposalId: { type: "string" },
      submissionId: { type: "string" },
      resolution: { type: "string" },
      note: { type: "string" },
      decision: { type: "object" }
    })
  }),

  protocolOperation({
    id: "knowledge.access.evaluate",
    feature: "knowledge",
    label: "AgentLibrary 知识访问裁决",
    targetMethod: "handleKnowledgeAccessEvaluate",
    path: "/api/knowledge/access/evaluate",
    scopes: ["knowledge:read"]
  }),
  protocolOperation({
    id: "knowledge.access.receipt.list",
    feature: "knowledge",
    label: "列出知识访问回执",
    targetMethod: "handleKnowledgeAccessReceiptList",
    method: "GET",
    path: "/api/knowledge/access/receipts",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["knowledge:read"]
  }),
  protocolOperation({
    id: "knowledge.access.loan_record.list",
    feature: "knowledge",
    label: "列出知识访问借用记录",
    targetMethod: "handleKnowledgeAccessLoanRecordList",
    method: "GET",
    path: "/api/knowledge/access/loan-records",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["knowledge:read"]
  }),
  protocolOperation({
    id: "knowledge.access.denied_request.list",
    feature: "knowledge",
    label: "列出知识访问拒绝请求",
    targetMethod: "handleKnowledgeAccessDeniedRequestList",
    method: "GET",
    path: "/api/knowledge/access/denied-requests",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "subjectId", aliases: ["subject-id", "subjectId"] }],
    scopes: ["knowledge:read"]
  }),
  protocolOperation({
    id: "knowledge.evidence.get",
    feature: "knowledge",
    label: "读取知识证据",
    targetMethod: "handleKnowledgeProtocolEvidenceGet",
    method: "GET",
    path: "/api/knowledge/evidence-read",
    query: [
      { name: "id", aliases: ["id", "evidenceId", "evidence-id"] },
      { name: "batchId", aliases: ["batch-id", "batchId"] },
      { name: "subjectId", aliases: ["subject-id", "subjectId"] },
      { name: "username", aliases: ["username"] }
    ],
    scopes: ["knowledge:read"]
  }),
  protocolOperation({
    id: "knowledge.backend.connect",
    feature: "knowledge",
    label: "连接外部知识库后端",
    targetMethod: "handleKnowledgeBackendConnect",
    path: "/api/knowledge/backend/connect",
    scopes: ["knowledge:maintain"],
    risk: "safe_write",
    inputSchema: schema(["provider", "secretRef"], {
      provider: { type: "string", enum: ["dify", "ragflow"] },
      secretRef: { type: "string" },
      endpointRef: { type: "string" },
      mode: { type: "string", enum: ["contract", "live"] }
    })
  }),
  protocolOperation({
    id: "knowledge.space.list",
    feature: "knowledge",
    label: "列出外部知识库派生空间",
    targetMethod: "handleKnowledgeSpaceList",
    method: "GET",
    path: "/api/knowledge/spaces",
    query: [{ name: "provider", aliases: ["provider", "backend"] }],
    scopes: ["knowledge:read"],
    readOnly: true,
    inputSchema: schema([], {
      provider: { type: "string", enum: ["dify", "ragflow"] }
    })
  }),
  protocolOperation({
    id: "knowledge.export.request",
    feature: "knowledge",
    label: "申请外部知识库导出",
    targetMethod: "handleKnowledgeExportRequest",
    path: "/api/knowledge/export/request",
    scopes: ["knowledge:write"],
    risk: "safe_write",
    requiresConfirmation: true,
    approvalScope: "knowledge:write",
    inputSchema: schema(["provider"], {
      provider: { type: "string", enum: ["dify", "ragflow"] },
      format: { type: "string" },
      confirm: { type: "boolean" },
      authorization: { type: "object" }
    })
  }),
  protocolOperation({
    id: "knowledge.permission.request",
    feature: "knowledge",
    label: "申请外部知识库权限",
    targetMethod: "handleKnowledgePermissionRequest",
    path: "/api/knowledge/permission/request",
    scopes: ["knowledge:write"],
    risk: "safe_write",
    inputSchema: schema(["provider", "requestedEgress"], {
      provider: { type: "string", enum: ["dify", "ragflow"] },
      requestedAccessMode: { type: "string" },
      requestedEgress: { type: "string" },
      reason: { type: "string" }
    })
  }),

  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.connect",
    label: "连接上游云盘服务",
    targetMethod: "handleSharedspaceDriveConnect",
    path: "/api/external/cloud-drive/connect",
    scopes: ["drive:write"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_CONNECT_SCHEMA
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.status",
    label: "读取上游云盘连接状态",
    targetMethod: "handleSharedspaceDriveStatus",
    method: "GET",
    path: "/api/external/cloud-drive/status",
    query: DRIVE_QUERY,
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.item.list",
    label: "列出上游云盘安全元数据",
    targetMethod: "handleSharedspaceDriveItemList",
    method: "GET",
    path: "/api/external/cloud-drive/items",
    query: [
      ...DRIVE_QUERY,
      { name: "recursive", aliases: ["recursive"] },
      { name: "includeHash", aliases: ["include-hash", "includeHash"] },
      { name: "limit", aliases: ["limit"] }
    ],
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.file.download",
    label: "下载上游云盘文件",
    targetMethod: "handleSharedspaceDriveFileDownload",
    method: "GET",
    path: "/api/external/cloud-drive/files/download",
    query: [
      ...DRIVE_QUERY,
      { name: "includeText", aliases: ["include-text", "includeText"] },
      { name: "encoding", aliases: ["encoding"] }
    ],
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.file.upload",
    label: "上传上游云盘文件",
    targetMethod: "handleSharedspaceDriveFileUpload",
    path: "/api/external/cloud-drive/files/upload",
    scopes: ["drive:write"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_UPLOAD_SCHEMA
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.sync.plan",
    label: "生成上游云盘同步计划",
    targetMethod: "handleSharedspaceDriveSyncPlan",
    path: "/api/external/cloud-drive/sync/plan",
    scopes: ["drive:sync"],
    risk: "read_only",
    readOnly: true,
    inputSchema: CLOUD_DRIVE_SYNC_SCHEMA
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.sync.apply",
    label: "应用上游云盘同步计划",
    targetMethod: "handleSharedspaceDriveSyncApply",
    path: "/api/external/cloud-drive/sync/apply",
    scopes: ["drive:sync"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_SYNC_SCHEMA
  }),
  cloudDriveUpstreamOperation({
    id: "external.cloudDrive.permission.list",
    label: "读取上游云盘权限元数据",
    targetMethod: "handleSharedspaceDrivePermissionList",
    method: "GET",
    path: "/api/external/cloud-drive/permissions",
    query: DRIVE_QUERY,
    scopes: ["drive:share"],
    readOnly: true
  }),

  cloudDriveLegacyOperation({
    id: "sharedspace.drive.connect",
    label: "连接云盘适配器",
    targetMethod: "handleSharedspaceDriveConnect",
    path: "/api/sharedspace/drive/connect",
    scopes: ["drive:write"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_CONNECT_SCHEMA
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.status",
    label: "读取云盘连接状态",
    targetMethod: "handleSharedspaceDriveStatus",
    method: "GET",
    path: "/api/sharedspace/drive/status",
    query: DRIVE_QUERY,
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.item.list",
    label: "列出云盘安全元数据",
    targetMethod: "handleSharedspaceDriveItemList",
    method: "GET",
    path: "/api/sharedspace/drive/items",
    query: [
      ...DRIVE_QUERY,
      { name: "recursive", aliases: ["recursive"] },
      { name: "includeHash", aliases: ["include-hash", "includeHash"] },
      { name: "limit", aliases: ["limit"] }
    ],
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.file.download",
    label: "下载云盘文件",
    targetMethod: "handleSharedspaceDriveFileDownload",
    method: "GET",
    path: "/api/sharedspace/drive/files/download",
    query: [
      ...DRIVE_QUERY,
      { name: "includeText", aliases: ["include-text", "includeText"] },
      { name: "encoding", aliases: ["encoding"] }
    ],
    scopes: ["drive:read"],
    readOnly: true
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.file.upload",
    label: "上传云盘文件",
    targetMethod: "handleSharedspaceDriveFileUpload",
    path: "/api/sharedspace/drive/files/upload",
    scopes: ["drive:write"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_UPLOAD_SCHEMA
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.sync.plan",
    label: "生成云盘同步计划",
    targetMethod: "handleSharedspaceDriveSyncPlan",
    path: "/api/sharedspace/drive/sync/plan",
    scopes: ["drive:sync"],
    risk: "read_only",
    readOnly: true,
    inputSchema: CLOUD_DRIVE_SYNC_SCHEMA
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.sync.apply",
    label: "应用云盘同步计划",
    targetMethod: "handleSharedspaceDriveSyncApply",
    path: "/api/sharedspace/drive/sync/apply",
    scopes: ["drive:sync"],
    risk: "safe_write",
    inputSchema: CLOUD_DRIVE_SYNC_SCHEMA
  }),
  cloudDriveLegacyOperation({
    id: "sharedspace.drive.permission.list",
    label: "读取云盘权限元数据",
    targetMethod: "handleSharedspaceDrivePermissionList",
    method: "GET",
    path: "/api/sharedspace/drive/permissions",
    query: DRIVE_QUERY,
    scopes: ["drive:share"],
    readOnly: true
  }),

  protocolOperation({
    id: "workspace.skill.upload",
    feature: "agent_workspace",
    label: "上传 workspace skill",
    targetMethod: "handleWorkspaceSkillUpload",
    path: "/api/workspace/skills/upload",
    scopes: ["workspace:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.skill.list",
    feature: "agent_workspace",
    label: "列出 workspace skill",
    targetMethod: "handleWorkspaceSkillList",
    method: "GET",
    path: "/api/workspace/skills",
    query: WORKSPACE_ID_QUERY,
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.skill.download",
    feature: "agent_workspace",
    label: "下载 workspace skill",
    targetMethod: "handleWorkspaceSkillDownload",
    method: "GET",
    path: "/api/workspace/skills/download",
    query: [{ name: "skillId", aliases: ["skill-id", "skillId", "id"] }, ...WORKSPACE_ID_QUERY],
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.skill.usage.report",
    feature: "agent_workspace",
    label: "上报 workspace skill 使用",
    targetMethod: "handleWorkspaceSkillUsageReport",
    path: "/api/workspace/skills/usage/report",
    scopes: ["workspace:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.asset.policy.set",
    feature: "agent_workspace",
    label: "设置 workspace 资产策略",
    targetMethod: "handleWorkspaceAssetPolicySet",
    path: "/api/workspace/assets/policy",
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),
  protocolOperation({
    id: "workspace.asset.permission.check",
    feature: "agent_workspace",
    label: "检查 workspace 资产权限",
    targetMethod: "handleWorkspaceAssetPermissionCheck",
    path: "/api/workspace/assets/permission/check",
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.audit.query",
    feature: "agent_workspace",
    label: "查询 workspace 审计",
    targetMethod: "handleWorkspaceAuditQuery",
    method: "GET",
    path: "/api/workspace/audit",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "operationId", aliases: ["operation-id", "operationId"] }],
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.operation.history",
    feature: "agent_workspace",
    label: "查询 workspace 操作历史",
    targetMethod: "handleWorkspaceOperationHistory",
    method: "GET",
    path: "/api/workspace/operations/history",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "operationId", aliases: ["operation-id", "operationId"] }],
    scopes: ["workspace:read"]
  }),

  protocolOperation({
    id: "workspace.checkpoint.tree.list",
    feature: "agent_workspace",
    label: "列出 workspace checkpoint tree",
    targetMethod: "handleWorkspaceCheckpointTreeList",
    method: "GET",
    path: "/api/workspace/checkpoints/trees",
    query: [{ name: "limit", aliases: ["limit"] }, { name: "kind", aliases: ["kind"] }, { name: "ownerId", aliases: ["owner-id", "ownerId"] }],
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.checkpoint.node.get",
    feature: "agent_workspace",
    label: "读取 workspace checkpoint 节点",
    targetMethod: "handleWorkspaceCheckpointNodeGet",
    method: "GET",
    path: "/api/workspace/checkpoints/nodes/:treeId",
    params: [{ name: "treeId", aliases: ["tree-id", "id"], required: true }],
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.checkpoint.diff",
    feature: "agent_workspace",
    label: "生成 workspace checkpoint diff",
    targetMethod: "handleWorkspaceCheckpointDiff",
    path: "/api/workspace/checkpoints/diff",
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.checkpoint.restore.preview",
    feature: "agent_workspace",
    label: "预览 workspace checkpoint 恢复",
    targetMethod: "handleWorkspaceCheckpointRestorePreview",
    path: "/api/workspace/checkpoints/restore/preview",
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),
  protocolOperation({
    id: "workspace.checkpoint.restore",
    feature: "agent_workspace",
    label: "恢复 workspace checkpoint",
    targetMethod: "handleWorkspaceCheckpointRestore",
    path: "/api/workspace/checkpoints/restore",
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),
  protocolOperation({
    id: "workspace.checkpoint.scope.query",
    feature: "agent_workspace",
    label: "查询 workspace checkpoint 影响范围",
    targetMethod: "handleWorkspaceCheckpointScopeQuery",
    path: "/api/workspace/checkpoints/scope/query",
    scopes: ["workspace:read"]
  }),
  protocolOperation({
    id: "workspace.operation.revert.scope",
    feature: "agent_workspace",
    label: "预览 workspace 操作回滚范围",
    targetMethod: "handleWorkspaceOperationRevertScope",
    path: "/api/workspace/operations/revert/scope",
    scopes: ["workspace:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "workspace:maintain"
  }),

  protocolOperation({
    id: "workspace.code.target.evaluate",
    feature: "agent_workspace",
    label: "评估代码变更目标",
    targetMethod: "handleWorkspaceCodeTargetEvaluate",
    path: "/api/workspace/code/target/evaluate",
    scopes: ["repo:read"]
  }),
  protocolOperation({
    id: "workspace.code.change.prepare",
    feature: "agent_workspace",
    label: "准备代码变更",
    targetMethod: "handleWorkspaceCodeChangePrepare",
    path: "/api/workspace/code/change/prepare",
    scopes: ["repo:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.code.change.upload",
    feature: "agent_workspace",
    label: "上传代码变更到评审系统",
    targetMethod: "handleWorkspaceCodeChangeUpload",
    path: "/api/workspace/code/change/upload",
    scopes: ["repo:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "repo:maintain"
  }),
  protocolOperation({
    id: "workspace.code.change.link",
    feature: "agent_workspace",
    label: "关联代码变更与 workspace",
    targetMethod: "handleWorkspaceCodeChangeLink",
    path: "/api/workspace/code/change/link",
    scopes: ["repo:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "workspace.code.change.status.sync",
    feature: "agent_workspace",
    label: "同步代码评审状态",
    targetMethod: "handleWorkspaceCodeChangeStatusSync",
    path: "/api/workspace/code/change/status/sync",
    scopes: ["repo:read"]
  }),

  protocolOperation({
    id: "codespace.providers.manifest",
    feature: "codespace",
    label: "读取 Codespace provider manifest",
    targetMethod: "handleCodespaceProvidersManifest",
    method: "GET",
    path: "/api/codespace/providers/manifest",
    scopes: ["repo:read"],
    readOnly: true
  }),
  protocolOperation({
    id: "codespace.repository.status",
    feature: "codespace",
    label: "读取代码库状态",
    targetMethod: "handleCodespaceRepositoryStatus",
    path: "/api/codespace/repository/status",
    scopes: ["repo:read"],
    readOnly: true,
    inputSchema: schema([], {
      provider: { type: "string" },
      repoId: { type: "string" },
      repositoryRef: { type: "string" },
      branch: { type: "string" },
      targetType: { type: "string" }
    })
  }),
  protocolOperation({
    id: "codespace.tree.list",
    feature: "codespace",
    label: "列出代码库目录",
    targetMethod: "handleCodespaceTreeList",
    path: "/api/codespace/tree/list",
    scopes: ["repo:read"],
    readOnly: true,
    inputSchema: schema([], {
      provider: { type: "string" },
      repoId: { type: "string" },
      repositoryRef: { type: "string" },
      ref: { type: "string" },
      path: { type: "string" }
    })
  }),
  protocolOperation({
    id: "codespace.file.read",
    feature: "codespace",
    label: "读取代码库文件",
    targetMethod: "handleCodespaceFileRead",
    path: "/api/codespace/file/read",
    scopes: ["repo:read"],
    readOnly: true,
    inputSchema: schema(["path"], {
      provider: { type: "string" },
      repoId: { type: "string" },
      repositoryRef: { type: "string" },
      ref: { type: "string" },
      path: { type: "string" }
    })
  }),
  protocolOperation({
    id: "codespace.diff.read",
    feature: "codespace",
    label: "读取代码库 diff",
    targetMethod: "handleCodespaceDiffRead",
    path: "/api/codespace/diff/read",
    scopes: ["repo:read"],
    readOnly: true,
    inputSchema: schema(["baseRef", "headRef"], {
      provider: { type: "string" },
      repoId: { type: "string" },
      repositoryRef: { type: "string" },
      baseRef: { type: "string" },
      headRef: { type: "string" }
    })
  }),
  protocolOperation({
    id: "codespace.change.prepare",
    feature: "codespace",
    label: "准备 Codespace changeSet",
    targetMethod: "handleCodespaceChangePrepare",
    path: "/api/codespace/change/prepare",
    scopes: ["repo:write"],
    risk: "safe_write",
    inputSchema: schema([], {
      workspaceId: { type: "string" },
      targetId: { type: "string" },
      provider: { type: "string" },
      repositoryRef: { type: "string" },
      branch: { type: "string" },
      diff: { type: "string" },
      files: { type: "array" },
      commitPlan: { type: "array" },
      dataClass: { type: "string" },
      policy: { type: "object" },
      checkpoint: { type: "object" }
    })
  }),
  protocolOperation({
    id: "codespace.change.upload",
    feature: "codespace",
    label: "上传 Codespace change 到评审系统",
    targetMethod: "handleCodespaceChangeUpload",
    path: "/api/codespace/change/upload",
    scopes: ["repo:maintain"],
    risk: "repair_write",
    requiresConfirmation: true,
    approvalScope: "repo:maintain",
    inputSchema: schema([], {
      workspaceId: { type: "string" },
      codeChangeId: { type: "string" },
      provider: { type: "string" },
      repositoryRef: { type: "string" },
      repoId: { type: "string" },
      worktreePath: { type: "string" },
      branch: { type: "string" },
      sourceRef: { type: "string" },
      targetRef: { type: "string" },
      title: { type: "string" },
      dryRun: { type: "boolean" },
      confirm: { type: "boolean" }
    })
  }),
  protocolOperation({
    id: "codespace.review.comment",
    feature: "codespace",
    label: "提交 Codespace review 评论",
    targetMethod: "handleCodespaceReviewComment",
    path: "/api/codespace/review/comment",
    scopes: ["repo:review"],
    risk: "safe_write",
    inputSchema: schema([], {
      provider: { type: "string" },
      repoId: { type: "string" },
      codeChangeId: { type: "string" },
      reviewTarget: { type: "string" },
      body: { type: "string" },
      comments: { type: "object" },
      dryRun: { type: "boolean" }
    })
  }),
  protocolOperation({
    id: "codespace.review.requestChanges",
    feature: "codespace",
    label: "请求 Codespace review 修改",
    targetMethod: "handleCodespaceReviewRequestChanges",
    path: "/api/codespace/review/request-changes",
    scopes: ["repo:review"],
    risk: "safe_write",
    inputSchema: schema([], {
      provider: { type: "string" },
      repoId: { type: "string" },
      codeChangeId: { type: "string" },
      reviewTarget: { type: "string" },
      body: { type: "string" },
      dryRun: { type: "boolean" }
    })
  }),
  protocolOperation({
    id: "codespace.review.approve",
    feature: "codespace",
    label: "批准 Codespace review",
    targetMethod: "handleCodespaceReviewApprove",
    path: "/api/codespace/review/approve",
    scopes: ["repo:approve"],
    risk: "safe_write",
    inputSchema: schema([], {
      provider: { type: "string" },
      repoId: { type: "string" },
      codeChangeId: { type: "string" },
      reviewTarget: { type: "string" },
      body: { type: "string" },
      label: { type: "string" },
      value: { type: "number" },
      dryRun: { type: "boolean" }
    })
  }),
  protocolOperation({
    id: "codespace.review.status.sync",
    feature: "codespace",
    label: "同步 Codespace review 状态",
    targetMethod: "handleCodespaceReviewStatusSync",
    path: "/api/codespace/review/status/sync",
    scopes: ["repo:read"],
    inputSchema: schema([], {
      provider: { type: "string" },
      codeChangeId: { type: "string" },
      changeId: { type: "string" },
      reviewStatus: { type: "string" },
      submitStatus: { type: "string" },
      providerReceipt: { type: "object" }
    })
  }),

  protocolOperation({
    id: "raw-corpus.format.convert",
    feature: "knowledge",
    label: "转换原始语料格式",
    targetMethod: "handleRawCorpusFormatConvert",
    path: "/api/raw-corpus/format/convert",
    scopes: ["knowledge:write"],
    risk: "safe_write"
  }),
  protocolOperation({
    id: "knowledge.dossier.export",
    feature: "knowledge",
    label: "导出统一事项 dossier",
    targetMethod: "handleKnowledgeDossierExport",
    path: "/api/knowledge/dossier/export",
    scopes: ["knowledge:read"]
  }),
]);

export const PROTOCOL_OPERATION_IDS = Object.freeze(
  PROTOCOL_OPERATION_DEFINITIONS.map((operation) => operation.id)
);
