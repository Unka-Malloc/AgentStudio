import { getJson, postJson } from "./bridge-http";
import type {
  ToolManagementAuditResponse,
  ToolManagementCatalog,
  ToolManagementGrant,
  ToolManagementGrantIssue,
  ToolManagementGrantsResponse,
  ToolManagementMetricsResponse,
} from "./types";

export type {
  ToolManagementAuditItem,
  ToolManagementAuditResponse,
  ToolManagementCatalog,
  ToolManagementGrant,
  ToolManagementGrantIssue,
  ToolManagementGrantsResponse,
  ToolManagementMetrics,
  ToolManagementMetricsResponse,
  ToolManagementProfile,
  ToolManagementScope,
  ToolManagementTool,
  ToolManagementToolGroup,
  ToolManagementToolset,
} from "./types";

export type CreateToolGrantPayload = {
  label: string;
  scopes?: string[];
  toolsets?: string[];
};

export type UpdateToolGrantPayload = Partial<
  Pick<
    ToolManagementGrant,
    "enabled" | "label" | "scopes" | "toolAllow" | "toolDeny" | "toolsets"
  >
>;

export function getToolManagementCatalog() {
  return getJson<ToolManagementCatalog>("/api/tool-management/v1/catalog");
}

export function getToolManagementAudit(limit = 50) {
  return postJson<ToolManagementAuditResponse>(
    `/api/tool-management/v1/audit?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function getToolManagementMetrics() {
  return getJson<ToolManagementMetricsResponse>("/api/tool-management/v1/metrics/summary");
}

export function previewToolPolicy(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>("/api/tool-management/v1/policy/preview", payload);
}

export function getToolManagementGrants() {
  return getJson<ToolManagementGrantsResponse>("/api/tool-management/v1/grants");
}

export function createToolGrant(payload: CreateToolGrantPayload) {
  return postJson<ToolManagementGrantIssue>("/api/tool-management/v1/grants", payload, {
    safetyConfirm: true,
  });
}

export function updateToolGrant(grantId: string, payload: UpdateToolGrantPayload) {
  return postJson<{ grant: ToolManagementGrant }>(
    `/api/tool-management/v1/grants/${encodeURIComponent(grantId)}`,
    payload,
    { safetyConfirm: true },
  );
}

export function deleteToolGrant(grantId: string) {
  return postJson<{ grant: ToolManagementGrant }>(
    `/api/tool-management/v1/grants/${encodeURIComponent(grantId)}/revoke`,
    { reason: "revoked_from_console" },
    { safetyConfirm: true },
  );
}

export function rotateToolGrantToken(grantId: string) {
  return postJson<ToolManagementGrantIssue>(
    `/api/tool-management/v1/grants/${encodeURIComponent(grantId)}/rotate`,
    {},
    { safetyConfirm: true },
  );
}
