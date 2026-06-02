import { postJson } from "./bridge-http";
import type { AgentExploreRunResponse } from "./types";

export type { AgentExploreRunResponse } from "./types";

export type AgentWorkspaceListResponse = {
  count: number;
  workspaces: Array<Record<string, unknown>>;
};

export type GetAgentExploreRunParams = {
  workspaceId?: string;
};

export type ListAgentWorkspacesParams = {
  includeSummary?: boolean;
  limit?: number;
};

export type GetAgentWorkspaceParams = {
  includePrivate?: boolean;
};

export function runKnowledgeAgentExplore(payload: Record<string, unknown>) {
  return postJson<AgentExploreRunResponse>("/api/knowledge/agent-explore/runs", payload);
}

export function getKnowledgeAgentExploreRun(
  runId: string,
  params: GetAgentExploreRunParams = {},
) {
  const query = new URLSearchParams();
  if (params.workspaceId) {
    query.set("workspaceId", params.workspaceId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return postJson<AgentExploreRunResponse>(
    `/api/knowledge/agent-explore/runs/${encodeURIComponent(runId)}${suffix}`,
  );
}

export function listAgentWorkspaces(params: ListAgentWorkspacesParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.includeSummary !== undefined) {
    query.set("includeSummary", String(params.includeSummary));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return postJson<AgentWorkspaceListResponse>(`/api/agent-workspaces${suffix}`);
}

export function getAgentWorkspace(
  workspaceId: string,
  params: GetAgentWorkspaceParams = {},
) {
  const query = new URLSearchParams();
  if (params.includePrivate !== undefined) {
    query.set("includePrivate", String(params.includePrivate));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return postJson<Record<string, unknown>>(
    `/api/agent-workspaces/${encodeURIComponent(workspaceId)}${suffix}`,
  );
}
