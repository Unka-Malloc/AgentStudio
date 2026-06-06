import { getJson, postJson } from "./bridge-http";
import type {
  EvidencePack,
  KnowledgeSearchResponse,
  RenderMarkdownResponse,
} from "./types";

export type {
  EvidencePack,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
} from "./types";

export function searchKnowledge(payload: Record<string, unknown>) {
  return postJson<KnowledgeSearchResponse>("/api/knowledge/search", payload);
}

export function connectKnowledgeBackend(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>("/api/knowledge/backend/connect", payload, {
    safetyConfirm: true,
  });
}

export function listKnowledgeSpaces(params: { provider?: string } = {}) {
  const query = new URLSearchParams();
  if (params.provider) {
    query.set("provider", params.provider);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return getJson<Record<string, unknown>>(`/api/knowledge/spaces${suffix}`);
}

export function recordKnowledgeFeedback(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>("/api/knowledge/feedback", payload);
}

export function requestKnowledgeExport(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>(
    "/api/knowledge/export/request",
    payload,
    { safetyConfirm: true },
  );
}

export function requestKnowledgePermission(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>(
    "/api/knowledge/permission/request",
    payload,
    { safetyConfirm: true },
  );
}

export function getKnowledgeEvidence(evidenceId: string) {
  return getJson<EvidencePack>(`/api/knowledge/evidence/${encodeURIComponent(evidenceId)}`);
}

export function renderKnowledgeMarkdown(payload: {
  evidenceId: string;
  format?: "markdown" | string;
}) {
  return postJson<RenderMarkdownResponse>("/api/knowledge/render/markdown", payload);
}

export function knowledgeAssetUrl(assetId: string) {
  return `/api/knowledge/assets/${encodeURIComponent(assetId)}`;
}
