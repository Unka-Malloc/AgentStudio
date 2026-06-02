import { postJson } from "./bridge-http";
import type {
  KnowledgeReviewItem,
  KnowledgeReviewItemsResponse,
} from "./types";

export type {
  KnowledgeReviewItem,
  KnowledgeReviewItemsResponse,
} from "./types";

export type KnowledgeReviewListParams = {
  limit?: number;
  status?: string;
};

export type ResolveKnowledgeReviewPayload = {
  patch?: Record<string, unknown>;
  resolution: string;
};

export function listKnowledgeReviewItems(params: KnowledgeReviewListParams = {}) {
  return postJson<KnowledgeReviewItemsResponse>(
    `/api/knowledge/review-items?status=${encodeURIComponent(params.status || "pending")}&limit=${encodeURIComponent(String(params.limit || 100))}`,
  );
}

export function resolveKnowledgeReviewItem(
  reviewId: string,
  payload: ResolveKnowledgeReviewPayload,
) {
  return postJson<KnowledgeReviewItem>(
    `/api/knowledge/review-items/${encodeURIComponent(reviewId)}/resolve`,
    payload,
    { safetyConfirm: true },
  );
}
