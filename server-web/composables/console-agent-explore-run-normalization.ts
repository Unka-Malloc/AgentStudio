import type { AgentExploreRunResponse } from "../lib/types";
import { asRecord } from "./console-model-utils";

export function agentExploreRunStatus(result: AgentExploreRunResponse | null) {
  return String(asRecord(result?.run)?.status || "");
}

export function normalizeAgentExploreRun(
  result: AgentExploreRunResponse,
): AgentExploreRunResponse {
  const run = asRecord(result.run);
  const coverage = asRecord(run?.coverage) || {};
  return {
    ...result,
    steps: result.steps || (Array.isArray(run?.steps) ? run.steps as AgentExploreRunResponse["steps"] : []),
    answer: result.answer || String(coverage.answer || ""),
    evidenceRefs: result.evidenceRefs || (Array.isArray(coverage.evidenceRefs) ? coverage.evidenceRefs as string[] : []),
    toolResults:
      result.toolResults ||
      (Array.isArray(coverage.toolResults)
        ? coverage.toolResults as AgentExploreRunResponse["toolResults"]
        : []),
    contextPack:
      result.contextPack ||
      (asRecord(coverage.contextPack) as AgentExploreRunResponse["contextPack"] | null) ||
      undefined,
    degraded: result.degraded ?? Boolean(run?.degraded),
    error: result.error || String(run?.error || ""),
  };
}
