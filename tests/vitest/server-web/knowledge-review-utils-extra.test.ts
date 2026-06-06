import { describe, expect, it } from "vitest";
import {
  jaccardSimilarity,
  knowledgeReviewCanResolveWithDocument,
  knowledgeReviewCurrentDocuments,
  knowledgeReviewDetailText,
  knowledgeReviewDocumentLine,
  knowledgeReviewFusionPrompt,
  knowledgeReviewIncomingDocument,
  knowledgeReviewPrimaryCurrentDocument,
  knowledgeReviewReasonLabel,
  knowledgeReviewRecordPreview,
  knowledgeReviewResolvedAction,
  knowledgeReviewSimilarity,
  knowledgeReviewSourceLabel,
  knowledgeReviewStatusLabel,
  knowledgeReviewTitle,
  knowledgeReviewTone,
  tokenizeKnowledgeReviewText,
} from "../../../server-web/composables/console-knowledge-review-utils";

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "review-1234567890abcdef",
    entityId: "entity-1",
    entityType: "document",
    title: "",
    reason: "source_path_content_conflict",
    severity: "high",
    status: "pending",
    source: "knowledge-core",
    summary: "Existing and incoming documents disagree.",
    evidenceRefs: ["ev-1"],
    currentRecord: {
      documents: [
        {
          title: "Quarterly Plan",
          sourcePath: "/plans/q1.md",
          sourceHash: "abcdef1234567890",
          batchId: "batch-1",
          documentId: "doc-current",
          summary: "Revenue plan and hiring plan.",
        },
      ],
    },
    incomingRecord: {
      document: {
        title: "Quarterly Plan",
        sourcePath: "/plans/q1.md",
        sourceHash: "ABCDEF1234567890",
        batchId: "batch-2",
        documentId: "doc-incoming",
        text: "Revenue plan and hiring plan.",
      },
      documentSnapshot: {
        documentId: "doc-incoming",
      },
    },
    resolution: {
      action: "merge",
    },
    ...overrides,
  } as any;
}

describe("console knowledge review utils", () => {
  it("maps reasons, statuses, tones, and source labels", () => {
    expect(knowledgeReviewReasonLabel("source_path_content_conflict")).toBe("同路径内容冲突");
    expect(knowledgeReviewReasonLabel("duplicate_source_document")).toBe("重复来源");
    expect(knowledgeReviewReasonLabel("revision_conflict")).toBe("版本冲突");
    expect(knowledgeReviewReasonLabel("missing_entity")).toBe("对象缺失");
    expect(knowledgeReviewReasonLabel("custom_reason")).toBe("custom_reason");
    expect(knowledgeReviewReasonLabel("")).toBe("待审核");

    expect(knowledgeReviewStatusLabel("pending")).toBe("待决策");
    expect(knowledgeReviewStatusLabel("resolved")).toBe("已解决");
    expect(knowledgeReviewStatusLabel("rejected")).toBe("已忽略");
    expect(knowledgeReviewStatusLabel("paused")).toBe("paused");
    expect(knowledgeReviewStatusLabel("")).toBe("未知");

    expect(knowledgeReviewTone(reviewItem({ status: "resolved" }))).toBe("success");
    expect(knowledgeReviewTone(reviewItem({ status: "rejected" }))).toBe("muted");
    expect(knowledgeReviewTone(reviewItem({ severity: "high", reason: "duplicate_source_document" }))).toBe("danger");
    expect(knowledgeReviewTone(reviewItem({ severity: "low", reason: "source_path_content_conflict" }))).toBe("danger");
    expect(knowledgeReviewTone(reviewItem({ severity: "low", reason: "duplicate_source_document" }))).toBe("warning");

    expect(knowledgeReviewSourceLabel(reviewItem({ source: "knowledge-core" }))).toBe("入库");
    expect(knowledgeReviewSourceLabel(reviewItem({ source: "metadata-store" }))).toBe("结构化变更");
    expect(knowledgeReviewSourceLabel(reviewItem({ source: "external" }))).toBe("external");
    expect(knowledgeReviewSourceLabel(reviewItem({ source: "" }))).toBe("知识库");
  });

  it("extracts current and incoming document records", () => {
    const item = reviewItem();

    expect(knowledgeReviewCurrentDocuments(item)).toHaveLength(1);
    expect(knowledgeReviewPrimaryCurrentDocument(item)).toMatchObject({
      title: "Quarterly Plan",
      documentId: "doc-current",
    });
    expect(knowledgeReviewIncomingDocument(item)).toMatchObject({
      title: "Quarterly Plan",
      documentId: "doc-incoming",
    });
    expect(knowledgeReviewTitle(item)).toBe("Quarterly Plan");

    const serverFallback = reviewItem({
      title: "",
      currentRecord: {},
      incomingRecord: {},
      serverRecord: { title: "Server Record", documentId: "server-doc" },
      fieldPatch: { title: "Incoming Patch", itemId: "patch-1" },
    });
    expect(knowledgeReviewCurrentDocuments(serverFallback)).toEqual([
      { title: "Server Record", documentId: "server-doc" },
    ]);
    expect(knowledgeReviewIncomingDocument(serverFallback)).toEqual({
      title: "Incoming Patch",
      itemId: "patch-1",
    });
    expect(knowledgeReviewTitle(serverFallback)).toBe("Incoming Patch");

    const entityFallback = reviewItem({
      title: "",
      entityId: "entity-title",
      currentRecord: {},
      incomingRecord: {},
      fieldPatch: null,
    });
    expect(knowledgeReviewTitle(entityFallback)).toBe("entity-title");
  });

  it("formats document lines and previews", () => {
    expect(knowledgeReviewDocumentLine(null)).toBe("无");
    expect(knowledgeReviewDocumentLine({
      documentId: "doc-1",
      sourcePath: "/knowledge/a.md",
      sourceHash: "0123456789abcdef9999",
    })).toBe("doc-1 / /knowledge/a.md / hash:01234567…9999");

    const emptyPreview = knowledgeReviewRecordPreview(null);
    expect(emptyPreview).toEqual({
      title: "无记录",
      sourcePath: "",
      sourceHash: "",
      batchId: "",
      documentId: "",
      text: "暂无可比较内容。",
    });

    const preview = knowledgeReviewRecordPreview({
      itemId: "item-1",
      sourcePath: "/knowledge/source.md",
      sourceHash: "hash-1",
      batchId: "batch-1",
      textPreview: " first line \n second line ",
      content: "fallback content",
    });
    expect(preview).toMatchObject({
      title: "item-1",
      sourcePath: "/knowledge/source.md",
      sourceHash: "hash-1",
      batchId: "batch-1",
      documentId: "item-1",
      text: "first line second line",
    });

    const longPreview = knowledgeReviewRecordPreview({
      title: "Long",
      text: "x".repeat(1300),
    });
    expect(longPreview.text).toHaveLength(1200);
    expect(longPreview.text.endsWith("…")).toBe(true);
  });

  it("tokenizes text and calculates review similarity buckets", () => {
    const tokens = tokenizeKnowledgeReviewText("Alpha-beta, beta!");
    expect(tokens.has("alpha")).toBe(true);
    expect(tokens.has("al")).toBe(true);
    expect(tokens.has("beta")).toBe(true);
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);

    const exact = knowledgeReviewSimilarity(reviewItem());
    expect(exact).toMatchObject({
      percent: "100%",
      label: "完全重合",
      tone: "danger",
      disableKeepBoth: true,
    });

    const samePathDifferentHash = knowledgeReviewSimilarity(reviewItem({
      currentRecord: {
        document: {
          title: "Revenue plan",
          sourcePath: "/plans/q2.md",
          sourceHash: "hash-a",
          text: "revenue renewal enterprise pipeline",
        },
      },
      incomingRecord: {
        document: {
          title: "Hiring plan",
          sourcePath: "/plans/q2.md",
          sourceHash: "hash-b",
          text: "support headcount onboarding plan",
        },
      },
    }));
    expect(samePathDifferentHash.label).toBe("部分重合");
    expect(samePathDifferentHash.percent).toBe("62%");
    expect(samePathDifferentHash.disableKeepBoth).toBe(false);

    const unrelated = knowledgeReviewSimilarity(reviewItem({
      currentRecord: {
        document: {
          title: "Revenue",
          sourcePath: "/finance/revenue.md",
          sourceHash: "hash-a",
          text: "enterprise renewal pipeline",
        },
      },
      incomingRecord: {
        document: {
          title: "Facilities",
          sourcePath: "/ops/facilities.md",
          sourceHash: "hash-b",
          text: "office seating badges",
        },
      },
    }));
    expect(unrelated.label).toBe("差异明显");
    expect(unrelated.tone).toBe("success");
  });

  it("builds prompts, detail text, and resolution helpers", () => {
    const item = reviewItem();
    const prompt = knowledgeReviewFusionPrompt(item);
    expect(prompt).toContain("请对以下知识入库冲突做融合分析");
    expect(prompt).toContain("同路径内容冲突");
    expect(prompt).toContain("doc-current");
    expect(prompt).toContain("doc-incoming");
    expect(prompt).toContain("review-1234567890abcdef");

    const detail = knowledgeReviewDetailText(item);
    expect(detail).toContain("当前：Quarterly Plan / /plans/q1.md");
    expect(detail).toContain("新录入：Quarterly Plan / /plans/q1.md");

    expect(knowledgeReviewCanResolveWithDocument(item)).toBe(true);
    expect(knowledgeReviewCanResolveWithDocument(reviewItem({ incomingRecord: {} }))).toBe(false);
    expect(knowledgeReviewResolvedAction(item)).toBe("merge");
    expect(knowledgeReviewResolvedAction(reviewItem({ resolution: { resolution: "keep_current" } }))).toBe("keep_current");
    expect(knowledgeReviewResolvedAction(reviewItem({ resolution: null }))).toBe("");
  });
});
