import type { KnowledgeReviewItem } from "../lib/types";
import { asRecord } from "./console-model-utils";

function shortReviewId(value: unknown) {
  const text = String(value || "").trim();
  if (text.length <= 16) {
    return text || "--";
  }
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function truncateReviewText(value: unknown, maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function knowledgeReviewReasonLabel(reason: unknown) {
  const value = String(reason || "");
  if (value === "source_path_content_conflict") {
    return "同路径内容冲突";
  }
  if (value === "duplicate_source_document") {
    return "重复来源";
  }
  if (value === "revision_conflict") {
    return "版本冲突";
  }
  if (value === "missing_entity") {
    return "对象缺失";
  }
  return value || "待审核";
}

export function knowledgeReviewStatusLabel(status: unknown) {
  const value = String(status || "");
  if (value === "pending") return "待决策";
  if (value === "resolved") return "已解决";
  if (value === "rejected") return "已忽略";
  return value || "未知";
}

export function knowledgeReviewTone(item: KnowledgeReviewItem) {
  if (item.status === "resolved") return "success";
  if (item.status === "rejected") return "muted";
  if (item.severity === "high" || item.reason === "source_path_content_conflict") return "danger";
  return "warning";
}

export function knowledgeReviewCurrentDocuments(item: KnowledgeReviewItem) {
  const currentRecord = asRecord(item.currentRecord) || {};
  const documents = Array.isArray(currentRecord.documents)
    ? currentRecord.documents
    : currentRecord.document
      ? [currentRecord.document]
      : item.serverRecord
        ? [item.serverRecord]
        : [];
  return documents.map((entry) => asRecord(entry)).filter(Boolean) as Record<string, unknown>[];
}

export function knowledgeReviewIncomingDocument(item: KnowledgeReviewItem) {
  const incomingRecord = asRecord(item.incomingRecord) || {};
  return asRecord(incomingRecord.document) || asRecord(item.fieldPatch) || null;
}

export function knowledgeReviewTitle(item: KnowledgeReviewItem) {
  const incoming = knowledgeReviewIncomingDocument(item);
  const current = knowledgeReviewCurrentDocuments(item)[0];
  return (
    item.title ||
    String(incoming?.title || current?.title || item.entityId || item.reviewId || "知识冲突")
  );
}

export function knowledgeReviewDocumentLine(record: Record<string, unknown> | null | undefined) {
  if (!record) {
    return "无";
  }
  const title = String(record.title || record.documentId || record.itemId || "未命名");
  const path = String(record.sourcePath || "");
  const hash = String(record.sourceHash || "");
  return [title, path, hash ? `hash:${shortReviewId(hash)}` : ""].filter(Boolean).join(" / ");
}

export function knowledgeReviewPrimaryCurrentDocument(item: KnowledgeReviewItem) {
  return knowledgeReviewCurrentDocuments(item)[0] || null;
}

export function knowledgeReviewRecordPreview(record: Record<string, unknown> | null | undefined) {
  if (!record) {
    return {
      title: "无记录",
      sourcePath: "",
      sourceHash: "",
      batchId: "",
      documentId: "",
      text: "暂无可比较内容。",
    };
  }
  const title = String(record.title || record.documentId || record.itemId || "未命名");
  const sourcePath = String(record.sourcePath || "");
  const sourceHash = String(record.sourceHash || "");
  const batchId = String(record.batchId || "");
  const documentId = String(record.documentId || record.itemId || "");
  const text = truncateReviewText(
    [
      record.summary,
      record.textPreview,
      record.bodyPreview,
      record.contentPreview,
      record.excerpt,
      record.text,
      record.content,
    ]
      .map((value) => String(value || "").trim())
      .find(Boolean) || knowledgeReviewDocumentLine(record),
    1200,
  );
  return {
    title,
    sourcePath,
    sourceHash,
    batchId,
    documentId,
    text,
  };
}

export function tokenizeKnowledgeReviewText(value: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set<string>();
  for (const token of normalized.split(" ").filter(Boolean)) {
    tokens.add(token);
    if (token.length > 3) {
      for (let index = 0; index < token.length - 1; index += 1) {
        tokens.add(token.slice(index, index + 2));
      }
    }
  }
  return tokens;
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(1, left.size + right.size - intersection);
}

export function knowledgeReviewSimilarity(item: KnowledgeReviewItem) {
  const current = knowledgeReviewRecordPreview(knowledgeReviewPrimaryCurrentDocument(item));
  const incoming = knowledgeReviewRecordPreview(knowledgeReviewIncomingDocument(item));
  const sameHash = Boolean(
    current.sourceHash &&
      incoming.sourceHash &&
      current.sourceHash.toLowerCase() === incoming.sourceHash.toLowerCase(),
  );
  const samePath = Boolean(
    current.sourcePath &&
      incoming.sourcePath &&
      current.sourcePath.toLowerCase() === incoming.sourcePath.toLowerCase(),
  );
  const left = tokenizeKnowledgeReviewText(
    [current.title, current.sourcePath, current.sourceHash, current.text].join("\n"),
  );
  const right = tokenizeKnowledgeReviewText(
    [incoming.title, incoming.sourcePath, incoming.sourceHash, incoming.text].join("\n"),
  );
  const score = sameHash ? 1 : Math.max(jaccardSimilarity(left, right), samePath ? 0.62 : 0);
  const roundedScore = Math.round(score * 100);
  if (score >= 0.98) {
    return {
      score,
      percent: `${roundedScore}%`,
      label: "完全重合",
      tone: "danger",
      disableKeepBoth: true,
      suggestion: "两份记录可判定为同一内容，建议放弃新知识或覆盖旧知识；不建议保留两者。",
    };
  }
  if (score >= 0.5) {
    return {
      score,
      percent: `${roundedScore}%`,
      label: "部分重合",
      tone: "warning",
      disableKeepBoth: false,
      suggestion: "两份记录存在重叠但仍有差异，建议优先执行知识融合，或人工核对后再覆盖。",
    };
  }
  return {
    score,
    percent: `${roundedScore}%`,
    label: "差异明显",
    tone: "success",
    disableKeepBoth: false,
    suggestion: "两份记录差异较大，建议保留两者；如果属于同一业务对象，再使用知识融合生成合并建议。",
  };
}

export function knowledgeReviewFusionPrompt(item: KnowledgeReviewItem) {
  const current = knowledgeReviewRecordPreview(knowledgeReviewPrimaryCurrentDocument(item));
  const incoming = knowledgeReviewRecordPreview(knowledgeReviewIncomingDocument(item));
  return [
    "请对以下知识入库冲突做融合分析，并输出 Markdown。",
    "",
    "必须包含：",
    "1. 重合判定：完全重合 / 部分重合 / 差异明显。",
    "2. 相似度估计和依据。",
    "3. 建议审核动作：保留两者 / 覆盖旧知识 / 放弃新知识 / 知识融合。",
    "4. 如果建议融合，列出应保留的字段、应保留的证据、需要人工确认的差异。",
    "",
    `冲突原因：${knowledgeReviewReasonLabel(item.reason)}`,
    `当前记录：${JSON.stringify(current, null, 2)}`,
    `新录入记录：${JSON.stringify(incoming, null, 2)}`,
    `审核项：${JSON.stringify(
      {
        reviewId: item.reviewId,
        entityId: item.entityId,
        entityType: item.entityType,
        summary: item.summary,
        evidenceRefs: item.evidenceRefs,
      },
      null,
      2,
    )}`,
  ].join("\n");
}

export function knowledgeReviewDetailText(item: KnowledgeReviewItem) {
  const current = knowledgeReviewCurrentDocuments(item)
    .map(knowledgeReviewDocumentLine)
    .join("\n");
  const incoming = knowledgeReviewDocumentLine(knowledgeReviewIncomingDocument(item));
  return [`当前：${current || "无"}`, `新录入：${incoming}`].join("\n");
}

export function knowledgeReviewSourceLabel(item: KnowledgeReviewItem) {
  if (item.source === "knowledge-core") {
    return "入库";
  }
  if (item.source === "metadata-store") {
    return "结构化变更";
  }
  return item.source || "知识库";
}

export function knowledgeReviewCanResolveWithDocument(item: KnowledgeReviewItem) {
  const incomingRecord = asRecord(item.incomingRecord) || {};
  return Boolean(asRecord(incomingRecord.documentSnapshot));
}

export function knowledgeReviewResolvedAction(item: KnowledgeReviewItem) {
  const resolution = asRecord(item.resolution) || {};
  return String(resolution.resolution || resolution.action || "");
}
