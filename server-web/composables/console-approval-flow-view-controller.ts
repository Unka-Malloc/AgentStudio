import { computed, onMounted } from "vue";
import type { McpAuthorizationRequest } from "../lib/authorization-governance-client";
import type { KnowledgeReviewItem } from "../lib/types";
import {
  knowledgeReviewCanResolveWithDocument,
  knowledgeReviewReasonLabel,
  knowledgeReviewSimilarity,
  knowledgeReviewStatusLabel,
  knowledgeReviewTitle,
  knowledgeReviewTone,
} from "./console-knowledge-review-utils";
import { useServerConsoleShellContext } from "./serverConsoleShellContext";

type ApprovalFlowStatus = "all" | "pending" | "approved" | "rejected";

export type ApprovalFlowCard =
  | {
      key: string;
      kind: "authorization";
      tone: string;
      label: string;
      title: string;
      summary: string;
      meta: string[];
      request: McpAuthorizationRequest;
    }
  | {
      key: string;
      kind: "review";
      tone: string;
      label: string;
      title: string;
      summary: string;
      meta: string[];
      review: KnowledgeReviewItem;
    };

function mcpAuthorizationStatusLabel(status: unknown) {
  if (status === "pending") return "待审批";
  if (status === "approved") return "已批准";
  if (status === "rejected") return "已拒绝";
  return String(status || "未知状态");
}

function knowledgeReviewStatusFromApprovalStatus(status: ApprovalFlowStatus) {
  if (status === "approved") return "resolved";
  return status;
}

export function useApprovalFlowViewController() {
  const { approvalFlowConsole } = useServerConsoleShellContext();
  const {
    busyKey,
    fuseKnowledgeReview,
    knowledgeReviewItems,
    knowledgeReviewStatus,
    mcpAuthorizationRequests,
    mcpAuthorizationStatus,
    mcpAuthorizationStatusOptionBarOptions,
    refreshKnowledgeConflicts,
    refreshMcpAuthorizationRequests,
    resolveKnowledgeReview,
    resolveMcpAuthorizationRequest,
    selectedKnowledgeReviewFusionModel,
  } = approvalFlowConsole;

  const approvalFlowStatus = computed<ApprovalFlowStatus>({
    get: () => mcpAuthorizationStatus.value,
    set: (status) => {
      mcpAuthorizationStatus.value = status;
      knowledgeReviewStatus.value = knowledgeReviewStatusFromApprovalStatus(status);
      void refreshMcpAuthorizationRequests();
      void refreshKnowledgeConflicts();
    },
  });

  const approvalFlowCards = computed<ApprovalFlowCard[]>(() => [
    ...mcpAuthorizationRequests.value.map((request) => ({
      key: `authorization:${request.requestId}`,
      kind: "authorization" as const,
      tone: request.status === "pending" ? "warning" : request.status === "approved" ? "success" : "danger",
      label: "MCP 客户端授权",
      title: request.clientName || "Unknown Client",
      summary: `用途说明：${request.reason || "无"}`,
      meta: [
        mcpAuthorizationStatusLabel(request.status),
        `工具 ${request.requestedTools?.length || 0} 个`,
        `权限域 ${request.requestedScopes?.length || 0} 个`,
      ],
      request,
    })),
    ...knowledgeReviewItems.value.map((review) => ({
      key: `review:${review.reviewId}`,
      kind: "review" as const,
      tone: knowledgeReviewTone(review),
      label: "知识入库冲突",
      title: knowledgeReviewTitle(review),
      summary: review.summary || "系统检测到该记录需要人工确认。",
      meta: [
        knowledgeReviewStatusLabel(review.status),
        knowledgeReviewReasonLabel(review.reason),
        knowledgeReviewSimilarity(review).label,
      ],
      review,
    })),
  ]);

  function refreshApprovalFlow() {
    mcpAuthorizationStatus.value = "pending";
    knowledgeReviewStatus.value = "pending";
    void refreshMcpAuthorizationRequests();
    void refreshKnowledgeConflicts();
  }

  function authorizationBusy(request: McpAuthorizationRequest) {
    return busyKey.value === `mcp-authorization-requests:resolve:${request.requestId}`;
  }

  function reviewBusy(review: KnowledgeReviewItem) {
    return busyKey.value.startsWith(`knowledge:review:${review.reviewId}:`);
  }

  function reviewKeepBothDisabled(review: KnowledgeReviewItem) {
    return knowledgeReviewSimilarity(review).disableKeepBoth || reviewBusy(review);
  }

  function reviewFusionDisabled(review: KnowledgeReviewItem) {
    return reviewBusy(review) || !selectedKnowledgeReviewFusionModel.value.enabled;
  }

  function approveAuthorization(request: McpAuthorizationRequest) {
    void resolveMcpAuthorizationRequest(request.requestId, "approved");
  }

  function rejectAuthorization(request: McpAuthorizationRequest) {
    void resolveMcpAuthorizationRequest(request.requestId, "rejected");
  }

  function replaceKnowledgeReview(review: KnowledgeReviewItem) {
    void resolveKnowledgeReview(review, "replace");
  }

  function keepBothKnowledgeReview(review: KnowledgeReviewItem) {
    void resolveKnowledgeReview(review, "keep_both");
  }

  function acceptKnowledgeReview(review: KnowledgeReviewItem) {
    void resolveKnowledgeReview(review, "accept");
  }

  function rejectKnowledgeReview(review: KnowledgeReviewItem) {
    void resolveKnowledgeReview(review, "reject");
  }

  function fuseKnowledgeReviewItem(review: KnowledgeReviewItem) {
    void fuseKnowledgeReview(review);
  }

  onMounted(refreshApprovalFlow);

  return {
    acceptKnowledgeReview,
    approvalFlowCards,
    approvalFlowStatus,
    approveAuthorization,
    authorizationBusy,
    fuseKnowledgeReviewItem,
    keepBothKnowledgeReview,
    mcpAuthorizationStatusOptionBarOptions,
    refreshApprovalFlow,
    rejectAuthorization,
    rejectKnowledgeReview,
    replaceKnowledgeReview,
    reviewBusy,
    reviewFusionDisabled,
    reviewKeepBothDisabled,
  };
}
