import type {
  EvidencePack,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
} from "../lib/types";
import {
  decodeMimeWords,
  emailHeaderValue,
  parseEmailHeaders,
} from "../lib/rendering";
import { asRecord } from "./console-model-utils";

export function normalizeSearchResults(payload: unknown): KnowledgeSearchResult[] {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const items = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(record.evidencePacks)
        ? record.evidencePacks
        : [];
  return items.map((item) => item as KnowledgeSearchResult);
}

export function compactReadableText(value: string, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function htmlMetaHeader(rawHtml: string, headerName: string) {
  if (!/<meta[\s>]/i.test(rawHtml)) {
    return "";
  }
  try {
    const doc = new DOMParser().parseFromString(String(rawHtml || ""), "text/html");
    const wanted = `message:raw-header:${headerName}`.toLowerCase();
    for (const meta of Array.from(doc.querySelectorAll("meta"))) {
      if (String(meta.getAttribute("name") || "").toLowerCase() === wanted) {
        return decodeMimeWords(String(meta.getAttribute("content") || "").trim());
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function htmlToReadableText(rawHtml: string) {
  try {
    const doc = new DOMParser().parseFromString(
      String(rawHtml || "").replace(/<head[\s\S]*?<\/head>/i, ""),
      "text/html",
    );
    for (const element of Array.from(doc.querySelectorAll("script, style, noscript, template"))) {
      element.remove();
    }
    return compactReadableText(doc.body?.textContent || doc.documentElement.textContent || "");
  } catch {
    return compactReadableText(String(rawHtml || "").replace(/<[^>]+>/g, " "));
  }
}

export function candidateTextFromRecord(
  record: Record<string, unknown> | KnowledgeSearchResult | EvidencePack | null | undefined,
) {
  if (!record) {
    return "";
  }
  const payload = asRecord(record.payload);
  const blocks = Array.isArray(record.blocks)
    ? record.blocks
    : Array.isArray(payload?.blocks)
      ? payload?.blocks
      : [];
  const blockText = blocks
    .map((block) => asRecord(block))
    .filter(Boolean)
    .map((block) => String(block?.text || block?.snippet || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return String(
    blockText ||
    record.text ||
    record.summary ||
    record.snippet ||
    "",
  ).trim();
}

export function emailSubjectFromText(text: string) {
  return (
    htmlMetaHeader(text, "Subject") ||
    emailHeaderValue(parseEmailHeaders(text).headers, "Subject") ||
    ""
  );
}

export function readableSnippetFromText(text: string) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  if (/<\/?[a-z][\s\S]*>/i.test(value)) {
    return htmlToReadableText(value);
  }
  return compactReadableText(value);
}

export function evidenceDisplayTitle(
  record: Record<string, unknown> | KnowledgeSearchResult | EvidencePack,
) {
  const text = candidateTextFromRecord(record);
  const subject = emailSubjectFromText(text);
  return subject || String(record.title || record.documentId || record.itemId || record.evidenceId || "来源详情");
}

export function knowledgeResultTitle(item: KnowledgeSearchResult) {
  return evidenceDisplayTitle(item);
}

export function knowledgeResultSnippet(item: KnowledgeSearchResult) {
  const text = candidateTextFromRecord(item);
  return readableSnippetFromText(text);
}

export function knowledgeResultEvidenceId(item: KnowledgeSearchResult) {
  return String(item.evidenceId || item.itemId || "");
}

export function knowledgeResultAssetCount(item: KnowledgeSearchResult) {
  if (Array.isArray(item.assets)) {
    return item.assets.length;
  }
  if (Array.isArray(item.relatedAssetIds)) {
    return item.relatedAssetIds.length;
  }
  if (Array.isArray(item.assetIds)) {
    return item.assetIds.length;
  }
  return 0;
}

export function knowledgeResultScore(item: KnowledgeSearchResult) {
  return Number(item.score || item.finalScore || item.relevanceScore || 0).toFixed(3);
}

export function knowledgeResultHierarchyPath(item: KnowledgeSearchResult) {
  const hierarchy = item.hierarchy || null;
  if (!hierarchy) {
    return "";
  }
  if (hierarchy.path) {
    return hierarchy.path;
  }
  return [
    hierarchy.documentId ? `document:${hierarchy.documentId}` : "",
    hierarchy.sectionId ? `section:${hierarchy.sectionId}` : "",
  ]
    .filter(Boolean)
    .join(" > ");
}

export function knowledgeFusionSummary(response: KnowledgeSearchResponse | null | undefined) {
  const fusion = asRecord(response?.fusion);
  if (!fusion) {
    return "";
  }
  const mode = String(fusion.mode || "server-index-only");
  const localHitCount = Number(fusion.localHitCount || 0);
  const localMergedCount = Number(fusion.localMergedCount || 0);
  const localAppendedCount = Number(fusion.localAppendedCount || 0);
  if (!localHitCount) {
    return `${mode} · 无本地 mirror 命中`;
  }
  return `${mode} · 本地 mirror ${localHitCount} 条，合并 ${localMergedCount} 条，补充 ${localAppendedCount} 条`;
}
