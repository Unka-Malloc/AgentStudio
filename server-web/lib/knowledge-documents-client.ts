import { postJson } from "./bridge-http";
import type { DocumentParseResponse, SplitResult } from "./types";

export type KnowledgeDocumentExportParams = {
  documentId?: string;
  batchId?: string;
  sourceId?: string;
  limit?: number;
  includeMachineReadable?: boolean;
};

function knowledgeExportQuery(params: KnowledgeDocumentExportParams = {}, options: {
  includeMachineReadable?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (params.documentId) query.set("documentId", params.documentId);
  if (params.batchId) query.set("batchId", params.batchId);
  if (params.sourceId) query.set("sourceId", params.sourceId);
  if (params.limit) query.set("limit", String(params.limit));
  if (options.includeMachineReadable && typeof params.includeMachineReadable === "boolean") {
    query.set("includeMachineReadable", String(params.includeMachineReadable));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export function knowledgeDocxExportUrl(params: KnowledgeDocumentExportParams = {}) {
  return `/api/knowledge/export/docx${knowledgeExportQuery(params, { includeMachineReadable: true })}`;
}

export function knowledgeMarkdownExportUrl(params: KnowledgeDocumentExportParams = {}) {
  return `/api/knowledge/export/markdown${knowledgeExportQuery(params)}`;
}

export function knowledgeHtmlExportUrl(params: KnowledgeDocumentExportParams = {}) {
  return `/api/knowledge/export/html${knowledgeExportQuery(params)}`;
}

export function parseDocument(payload: Record<string, unknown>) {
  return postJson<DocumentParseResponse>("/api/knowledge/document-parser/parse", payload);
}

export function getNormalizedDocuments(jobId: string) {
  return postJson<SplitResult["normalizedDocuments"]>(
    `/api/jobs/${encodeURIComponent(jobId)}/normalized-documents`,
  );
}

export function normalizedDocumentUrl(jobId: string, documentId: string) {
  return `/api/jobs/${encodeURIComponent(jobId)}/normalized-documents/${encodeURIComponent(documentId)}`;
}
