export type KnowledgeReviewItem = {
  reviewId: string;
  source?: string;
  operationId?: string;
  entityId: string;
  entityType: string;
  status: string;
  reason: string;
  severity?: string;
  batchId?: string;
  title?: string;
  summary?: string;
  baseRevision?: number;
  currentRevision?: number;
  clientId?: string;
  fieldPatch?: Record<string, unknown>;
  serverRecord?: Record<string, unknown> | null;
  currentRecord?: Record<string, unknown>;
  incomingRecord?: Record<string, unknown>;
  evidenceRefs?: Array<Record<string, unknown> | string>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolution?: Record<string, unknown>;
};

export type KnowledgeReviewItemsResponse = {
  status: string;
  count?: number;
  sources?: Record<string, number>;
  items: KnowledgeReviewItem[];
};
