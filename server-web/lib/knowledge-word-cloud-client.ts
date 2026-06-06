import { deleteJson, getJson, postJson } from "./bridge-http";
import type {
  KnowledgeWordBag,
  KnowledgeWordBagMutationResponse,
  KnowledgeWordBagSet,
  KnowledgeWordBagTermsResponse,
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudExportResponse,
  KnowledgeWordCloudImportResponse,
  KnowledgeWordCloudProposeResponse,
  KnowledgeWordCloudState,
} from "./types";

export type KnowledgeWordCloudQuery = {
  wordBagSetId?: string;
  wordBagId?: string;
  limit?: number;
  minFrequency?: number;
  query?: string;
  corpusPaths?: KnowledgeWordCloudCorpusPath[];
};

export type SaveKnowledgeWordCloudsPayload = {
  wordBagSet?: Partial<KnowledgeWordBagSet>;
  auditAction?: string;
  auditPaths?: KnowledgeWordCloudCorpusPath[];
  limit?: number;
  minFrequency?: number;
};

export type ImportKnowledgeWordCloudsPayload = {
  importPayload?: Record<string, unknown> | string;
  wordBagSet?: Partial<KnowledgeWordBagSet>;
  mode?: "copy" | "overwrite" | string;
  overwrite?: boolean;
};

export type AddKnowledgeWordBagPayload = {
  wordBagSetId: string;
  parentWordBagId?: string;
  wordBag: Partial<KnowledgeWordBag>;
};

export type UpdateKnowledgeWordBagPayload = {
  wordBagSetId: string;
  wordBag?: Partial<KnowledgeWordBag>;
  patch?: Partial<KnowledgeWordBag>;
};

export type KnowledgeWordBagTermsPayload = {
  wordBagSetId?: string;
  wordBagId?: string;
  wordBagIds?: string[];
  includeChildren?: boolean;
};

function wordCloudQueryString(params: KnowledgeWordCloudQuery = {}) {
  const query = new URLSearchParams();
  if (params.wordBagSetId) {
    query.set("wordBagSetId", params.wordBagSetId);
  }
  if (params.wordBagId) {
    query.set("wordBagId", params.wordBagId);
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.minFrequency !== undefined) {
    query.set("minFrequency", String(params.minFrequency));
  }
  if (params.query) {
    query.set("query", params.query);
  }
  for (const item of params.corpusPaths || []) {
    const selectedPath = String(item?.path || "").trim();
    if (!selectedPath) {
      continue;
    }
    query.append("corpusPath", `${item.type || ""}:${selectedPath}`);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export function getKnowledgeWordClouds(params: KnowledgeWordCloudQuery = {}) {
  return getJson<KnowledgeWordCloudState>(`/api/knowledge/word-clouds${wordCloudQueryString(params)}`);
}

export function saveKnowledgeWordClouds(payload: SaveKnowledgeWordCloudsPayload) {
  return postJson<{ ok: boolean; wordBagSet: KnowledgeWordBagSet }>(
    "/api/knowledge/word-clouds",
    payload,
    { safetyConfirm: true },
  );
}

export function exportKnowledgeWordClouds(payload: { wordBagSetId?: string } = {}) {
  return postJson<KnowledgeWordCloudExportResponse>("/api/knowledge/word-clouds/export", payload);
}

export function importKnowledgeWordClouds(payload: ImportKnowledgeWordCloudsPayload) {
  return postJson<KnowledgeWordCloudImportResponse>(
    "/api/knowledge/word-clouds/import",
    payload,
    { safetyConfirm: true },
  );
}

export function addKnowledgeWordBag(payload: AddKnowledgeWordBagPayload) {
  return postJson<KnowledgeWordBagMutationResponse>(
    "/api/knowledge/word-clouds/word-bags",
    payload,
    { safetyConfirm: true },
  );
}

export function updateKnowledgeWordBag(wordBagId: string, payload: UpdateKnowledgeWordBagPayload) {
  return postJson<KnowledgeWordBagMutationResponse>(
    `/api/knowledge/word-clouds/word-bags/${encodeURIComponent(wordBagId)}`,
    payload,
    { safetyConfirm: true },
  );
}

export function deleteKnowledgeWordBag(wordBagId: string, params: { wordBagSetId: string }) {
  const query = new URLSearchParams();
  query.set("wordBagSetId", params.wordBagSetId);
  return deleteJson<KnowledgeWordBagMutationResponse>(
    `/api/knowledge/word-clouds/word-bags/${encodeURIComponent(wordBagId)}?${query.toString()}`,
    { safetyConfirm: true },
  );
}

export function getKnowledgeWordBagTerms(payload: KnowledgeWordBagTermsPayload) {
  return postJson<KnowledgeWordBagTermsResponse>(
    "/api/knowledge/word-clouds/word-bags/terms",
    payload,
  );
}

export function proposeKnowledgeWordClouds(payload: Record<string, unknown>) {
  return postJson<KnowledgeWordCloudProposeResponse>(
    "/api/knowledge/word-clouds/propose",
    payload,
    { safetyConfirm: true },
  );
}

export function rebuildSourceVocabulary(payload: { confirm?: boolean; [key: string]: unknown } = { confirm: true }) {
  return postJson<Record<string, unknown>>(
    "/api/storage/source-vocabulary/rebuild",
    payload,
    { safetyConfirm: true },
  );
}
