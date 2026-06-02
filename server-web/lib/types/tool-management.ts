export type ToolManagementScope = {
  id: string;
  label: string;
  description: string;
};

export type ToolManagementGrant = {
  id: string;
  label: string;
  type?: string;
  enabled: boolean;
  toolsets?: string[];
  toolAllow?: string[];
  toolDeny?: string[];
  scopes: string[];
  expiresAt?: string;
  maxUses?: number;
  rateLimit?: Record<string, unknown>;
  allowedOrigins?: string[];
  allowedCidrs?: string[];
  metadata?: Record<string, unknown>;
  reason?: string;
  tokenPrefix: string;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  lastUsedAt: string;
};

export type ToolManagementGrantsResponse = {
  schemaVersion: number;
  grants: ToolManagementGrant[];
};

export type ToolManagementGrantIssue = {
  grant: ToolManagementGrant;
  token: string;
};

export type ToolManagementRisk =
  | "read_only"
  | "safe_write"
  | "repair_write"
  | "destructive"
  | string;

export type ToolManagementToolset = {
  id: string;
  label: string;
  requiredScopes: string[];
  maxRisk: ToolManagementRisk;
  grantable?: boolean;
  defaultForAgents?: boolean;
};

export type ToolManagementProfile = {
  id: string;
  label: string;
  agentType: string;
  toolsets: string[];
  toolAllow: string[];
  toolDeny: string[];
  maxRisk: ToolManagementRisk;
  approvalPolicy: string;
  concurrencyLimit: number;
  sandboxPolicy: string;
  auditTags: string[];
};

export type ToolManagementTool = {
  id: string;
  version: string;
  label: string;
  description: string;
  owner: string;
  source: string;
  operationId: string;
  handlerId: string;
  toolsets: string[];
  requiredScopes: string[];
  risk: ToolManagementRisk;
  readOnly: boolean;
  destructive: boolean;
  concurrencySafe: boolean;
  requiresApproval: boolean;
  approvalScope: string;
  timeoutMs: number;
  maxResultBytes: number;
  status: string;
  tags: string[];
};

export type ToolManagementCatalog = {
  schemaVersion: number;
  generatedAt: string;
  fingerprint: string;
  scopes: ToolManagementScope[];
  toolsets: ToolManagementToolset[];
  profiles: ToolManagementProfile[];
  tools: ToolManagementTool[];
};

export type ToolManagementAuditItem = {
  toolExecutionId: string;
  traceId: string;
  toolId: string;
  toolVersion: string;
  toolsetIds: string[];
  subjectType: string;
  subjectId: string;
  grantId: string;
  agentId: string;
  profileId: string;
  operationId: string;
  risk: ToolManagementRisk;
  decision: string;
  resultSummary?: Record<string, unknown>;
  status: string;
  errorCode: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  policyDecisionId: string;
};

export type ToolManagementAuditResponse = {
  schemaVersion: number;
  items: ToolManagementAuditItem[];
};

export type ToolManagementMetrics = {
  callsTotal: number;
  byStatus: Record<string, number>;
  byTool: Record<string, number>;
  byProfile: Record<string, number>;
  byGrant: Record<string, number>;
  byRisk: Record<string, number>;
  deniedByReason: Record<string, number>;
  timeoutTotal: number;
  rateLimitedTotal: number;
  activeExecutions: number;
  averageDurationMs: number;
  resultBytesTotal: number;
};

export type ToolManagementMetricsResponse = {
  schemaVersion: number;
  metrics: ToolManagementMetrics;
};
