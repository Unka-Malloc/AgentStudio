import type { AgentExploreRunResponse } from "../lib/types";
import type { AgentExploreSession } from "../types/app";
import { asRecord } from "./console-model-utils";
import {
  type AgentExploreFormDefaults,
  type AgentExploreFormState,
} from "./console-agent-explore-form-types";
import { agentExploreRunStatus } from "./console-agent-explore-run-normalization";

export function isAgentExploreDraftSession(
  session: AgentExploreSession | null | undefined,
) {
  return String(session?.runId || "").startsWith("draft:");
}

export function sanitizeAgentExploreSessionModelReference(
  session: AgentExploreSession,
  validAgentModelAlias: (value: string) => string,
): AgentExploreSession {
  return {
    ...session,
    modelAlias: validAgentModelAlias(session.modelAlias),
  };
}

export function agentExploreHistorySortValue(session: AgentExploreSession) {
  const value = Date.parse(String(session.updatedAt || ""));
  return Number.isFinite(value) ? value : 0;
}

export function normalizeAgentExploreHistoryListCore(
  sessions: AgentExploreSession[],
  options: {
    hiddenRunIds: Set<string>;
    validAgentModelAlias: (value: string) => string;
  },
) {
  const seen = new Set<string>();
  return sessions
    .filter((session) => {
      const runId = String(session.runId || "").trim();
      if (!runId || seen.has(runId) || options.hiddenRunIds.has(runId)) {
        return false;
      }
      seen.add(runId);
      return true;
    })
    .map((session) =>
      sanitizeAgentExploreSessionModelReference(session, options.validAgentModelAlias),
    )
    .sort((left, right) => agentExploreHistorySortValue(right) - agentExploreHistorySortValue(left))
    .slice(0, 20);
}

export function agentExploreSessionFromResultCore(
  result: AgentExploreRunResponse | null,
  options: {
    fallback?: Partial<AgentExploreSession>;
    currentForm: AgentExploreFormState;
    normalizeThinkingMode: (value?: string) => string;
  },
): AgentExploreSession | null {
  const fallback = options.fallback || {};
  const run = asRecord(result?.run) || {};
  const input = asRecord(run.input) || {};
  const workspace = asRecord(result?.workspace) || {};
  const runId = String(run.runId || fallback.runId || "").trim();
  const workspaceId = String(
    workspace.workspaceId ||
      run.workspaceId ||
      fallback.workspaceId ||
      options.currentForm.workspaceId ||
      "",
  ).trim();
  if (!runId || !workspaceId) {
    return null;
  }
  const query = String(input.query || fallback.query || options.currentForm.query || "").trim();
  return {
    runId,
    workspaceId,
    query,
    modelAlias: String(input.modelAlias || fallback.modelAlias || options.currentForm.modelAlias || ""),
    contextProfileId: String(
      input.contextProfileId ||
        fallback.contextProfileId ||
        options.currentForm.contextProfileId ||
        "context-128k",
    ),
    thinkingMode: options.normalizeThinkingMode(
      String(input.thinkingMode || fallback.thinkingMode || options.currentForm.thinkingMode || "default"),
    ),
    temperature: Number(input.temperature ?? fallback.temperature ?? options.currentForm.temperature ?? 0.2),
    maxTokens: Number(input.maxTokens || fallback.maxTokens || options.currentForm.maxTokens || 1800),
    maxIterations: Number(input.maxIterations || fallback.maxIterations || options.currentForm.maxIterations || 4),
    limit: Number(input.limit || fallback.limit || options.currentForm.limit || 8),
    toolChoice: String(input.toolChoice || fallback.toolChoice || options.currentForm.toolChoice || "auto"),
    status: agentExploreRunStatus(result),
    answerPreview: String(result?.answer || fallback.answerPreview || "").slice(0, 180),
    updatedAt: String(run.updatedAt || run.completedAt || fallback.updatedAt || new Date().toISOString()),
  };
}

export function createAgentExploreDraftSession(
  options: {
    form: AgentExploreFormState;
    contextProfileId: string;
    thinkingMode: string;
    defaults: AgentExploreFormDefaults;
    seed?: Partial<AgentExploreSession>;
  },
): AgentExploreSession {
  const timestamp = new Date().toISOString();
  return {
    runId: `draft:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: "",
    query: "",
    modelAlias: options.form.modelAlias || "",
    contextProfileId: options.contextProfileId,
    thinkingMode: options.thinkingMode,
    temperature: Number(options.form.temperature || options.defaults.temperature),
    maxTokens: Number(options.form.maxTokens || options.defaults.maxTokens),
    maxIterations: options.defaults.maxIterations,
    limit: options.defaults.limit,
    toolChoice: options.form.toolChoice || options.defaults.toolChoice,
    status: "draft",
    answerPreview: "",
    updatedAt: timestamp,
    ...(options.seed || {}),
  };
}

export function agentExploreFormFromSession(
  session: AgentExploreSession,
  options: {
    currentForm: AgentExploreFormState;
    defaults: AgentExploreFormDefaults;
    hasAgentModelOption: (value?: string) => boolean;
    normalizeThinkingMode: (value?: string) => string;
    preferCurrentLimits?: boolean;
    workspaceId?: string;
  },
): AgentExploreFormState {
  const preferCurrentLimits = options.preferCurrentLimits !== false;
  return {
    query: session.query,
    modelAlias: options.hasAgentModelOption(session.modelAlias) ? session.modelAlias : "",
    contextProfileId: session.contextProfileId || options.currentForm.contextProfileId,
    thinkingMode: options.normalizeThinkingMode(session.thinkingMode || options.currentForm.thinkingMode),
    temperature: Number(session.temperature || options.currentForm.temperature || options.defaults.temperature),
    maxTokens: Number(session.maxTokens || options.currentForm.maxTokens || options.defaults.maxTokens),
    maxIterations:
      session.maxIterations ||
      (preferCurrentLimits ? options.currentForm.maxIterations : 0) ||
      options.defaults.maxIterations,
    limit:
      session.limit ||
      (preferCurrentLimits ? options.currentForm.limit : 0) ||
      options.defaults.limit,
    toolChoice: session.toolChoice || options.currentForm.toolChoice || options.defaults.toolChoice,
    workspaceId: options.workspaceId ?? session.workspaceId,
  };
}

export function agentExploreSessionsFromWorkspaceDetailsCore(
  details: unknown[],
  options: {
    currentForm: AgentExploreFormState;
    normalizeThinkingMode: (value?: string) => string;
  },
) {
  return details
    .flatMap((detail) => {
      const detailValue = asRecord(detail);
      if (!detailValue) {
        return [];
      }
      const workspace = asRecord(detailValue.workspace) || {};
      const runs = Array.isArray(detailValue.runs) ? detailValue.runs : [];
      return runs
        .filter((run) => String(asRecord(run)?.runType || "") === "knowledge_agent_exploration")
        .map((run) =>
          agentExploreSessionFromResultCore({
            protocolVersion: "",
            ok: String(asRecord(run)?.status || "") !== "failed",
            workspace,
            run: asRecord(run) || {},
            answer: String(asRecord(asRecord(run)?.coverage)?.answer || ""),
          }, options),
        )
        .filter(Boolean) as AgentExploreSession[];
    })
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, 20);
}
