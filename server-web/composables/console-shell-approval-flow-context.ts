import type { useConsole } from "./useConsole";

type ConsoleContext = ReturnType<typeof useConsole>;

const approvalFlowShellKeys = [
  "busyKey",
  "fuseKnowledgeReview",
  "knowledgeReviewItems",
  "knowledgeReviewStatus",
  "mcpAuthorizationRequests",
  "mcpAuthorizationStatus",
  "mcpAuthorizationStatusOptionBarOptions",
  "refreshKnowledgeConflicts",
  "refreshMcpAuthorizationRequests",
  "resolveKnowledgeReview",
  "resolveMcpAuthorizationRequest",
  "selectedKnowledgeReviewFusionModel",
] as const satisfies readonly (keyof ConsoleContext)[];

export type ApprovalFlowShellContext = Pick<ConsoleContext, (typeof approvalFlowShellKeys)[number]>;

export function pickApprovalFlowShellContext(context: ConsoleContext): ApprovalFlowShellContext {
  return Object.fromEntries(approvalFlowShellKeys.map((key) => [key, context[key]])) as ApprovalFlowShellContext;
}
