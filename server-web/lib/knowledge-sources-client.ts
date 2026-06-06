import { deleteJson, getJson, postJson } from "./bridge-http";
import type {
  KnowledgeSourceMutationResponse,
  KnowledgeSourceState,
} from "./types";

export type {
  KnowledgeSource,
  KnowledgeSourceMutationResponse,
  KnowledgeSourceState,
} from "./types";

export function getKnowledgeSources() {
  return getJson<KnowledgeSourceState>("/api/knowledge/sources");
}

export function createKnowledgeSource(payload: Record<string, unknown>) {
  return postJson<KnowledgeSourceMutationResponse>("/api/knowledge/sources", payload, {
    safetyConfirm: true,
  });
}

export function updateKnowledgeSource(sourceId: string, payload: Record<string, unknown>) {
  return postJson<KnowledgeSourceMutationResponse>(
    `/api/knowledge/sources/${encodeURIComponent(sourceId)}`,
    payload,
    { safetyConfirm: true },
  );
}

export function deleteKnowledgeSource(sourceId: string) {
  return deleteJson<KnowledgeSourceMutationResponse>(
    `/api/knowledge/sources/${encodeURIComponent(sourceId)}`,
    { safetyConfirm: true },
  );
}

export function refreshKnowledgeSource(sourceId: string, payload: Record<string, unknown> = {}) {
  return postJson<KnowledgeSourceMutationResponse>(
    `/api/knowledge/sources/${encodeURIComponent(sourceId)}/refresh`,
    payload,
  );
}

export function refreshAllKnowledgeSources(payload: Record<string, unknown> = {}) {
  return postJson<KnowledgeSourceMutationResponse>("/api/knowledge/sources-refresh", payload);
}
