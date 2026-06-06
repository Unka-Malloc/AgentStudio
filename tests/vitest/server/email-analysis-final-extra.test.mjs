import { describe, expect, it } from "vitest";
import { runEmailAnalysis } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-analysis.mjs";

const GENERATED_AT = "2026-06-04T00:00:00.000Z";
const BASE_SETTINGS = {
  retrievalHalfLifeDays: 14,
  staleAfterDays: 30
};

function runEmailAnalysisWithDefaults({
  sources = [],
  chunks = [],
  settings = {},
  rules = {}
}) {
  return runEmailAnalysis({
    sources,
    chunks,
    settings: {
      ...BASE_SETTINGS,
      ...settings
    },
    generatedAt: GENERATED_AT,
    rules
  });
}

function findMessage(result, sourceId) {
  return result.emails.find((item) => item.sourceId === sourceId);
}

function findPersonByEmail(result, email) {
  return result.people.find((item) => item.primaryEmail === email);
}

describe("email-analysis final extra coverage", () => {
  it("resolves metadata aliases, department dictionaries, report series, html bodies, and stopwords", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-rule-meta",
          kind: "email",
          name: "周报同步",
          text: "ignored fallback text",
          sourceUpdatedAt: "2026-05-19T00:00:00.000Z",
          documentMetadata: {
            "message:from-name": "Finance Lead",
            "message:from-email": "finance@acme.com",
            "message:to-email": "ops@acme.com",
            "message:raw-header:subject": "Re: 周报：invoice sync 付款确认",
            "message:raw-header:date": "2026-05-19T00:00:00.000Z"
          },
          embeddedDocuments: [
            {
              text: "<div>invoice sync the 付款确认 周报</div>",
              metadata: { "content-type": "text/html; charset=utf-8" }
            }
          ]
        },
        {
          id: "src-rule-header",
          kind: "email",
          name: "周报边界",
          text: [
            "发件人: F. Lead <finance@acme.com>",
            "收件人: 架构二组 <arch@acme.com>",
            "主题: 回复：周报：invoice sync 付款确认",
            "  第2行",
            "日期: 2026-05-20T00:00:00.000Z",
            "Content-Type: text/plain; charset=utf-8",
            "正文第二段",
            "Content-Type: text/html; charset=utf-8",
            "> 这行应该被忽略",
            "-----Original Message-----",
            "不应保留"
          ].join("\n")
        }
      ],
      chunks: [
        { id: "chunk-rule-meta", sourceId: "src-rule-meta" },
        { id: "chunk-rule-header", sourceId: "src-rule-header" }
      ],
      rules: {
        reportSeries: [
          {
            id: "weekly-sync",
            label: "周报",
            cadence: "weekly",
            keywords: ["周报", "周进展"]
          }
        ],
        synonymDictionary: [
          {
            canonical: "invoice-sync",
            terms: ["invoice sync", "发票同步"]
          }
        ],
        departmentDictionary: [
          {
            department: "财务中心",
            keywords: ["Finance Lead"],
            emailKeywords: ["finance@acme.com"]
          }
        ],
        keywordStopwords: ["the", "付款"]
      }
    });

    const metaMessage = findMessage(result, "src-rule-meta");
    const headerMessage = findMessage(result, "src-rule-header");
    const financePerson = findPersonByEmail(result, "finance@acme.com");
    const archPerson = findPersonByEmail(result, "arch@acme.com");

    expect(result.overview.emailCount).toBe(2);
    expect(metaMessage).toMatchObject({
      subject: "周报：invoice sync 付款确认",
      normalizedSubject: "周报：invoice sync 付款确认",
      status: "report",
      chunkIds: ["chunk-rule-meta"]
    });
    expect(metaMessage?.body).toContain("invoice sync");
    expect(metaMessage?.keywords).toEqual(
      expect.arrayContaining(["invoice-sync", "周报", "确认"])
    );
    expect(metaMessage?.keywords).not.toEqual(expect.arrayContaining(["the", "付款"]));
    expect(headerMessage).toMatchObject({
      subject: "周报：invoice sync 付款确认 第2行",
      status: "report",
      chunkIds: ["chunk-rule-header"]
    });
    expect(headerMessage?.body).toBe("正文第二段");
    expect(result.timeline.map((item) => item.type)).toEqual(["report", "report"]);
    expect(result.threads.length).toBeGreaterThanOrEqual(1);
    expect(result.transactions.length).toBeGreaterThanOrEqual(1);
    expect(financePerson).toMatchObject({
      primaryDepartment: "财务中心",
      relation: "internal"
    });
    expect(financePerson?.aliases).toEqual(expect.arrayContaining(["F. Lead"]));
    expect(archPerson).toMatchObject({
      primaryDepartment: "架构二组"
    });
  });

  it("falls back for sparse email-like sources and ignores empty bodies without throwing", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-empty-text",
          kind: "email",
          name: "空白忽略",
          text: "",
          sourceUpdatedAt: "2026-05-18T00:00:00.000Z"
        },
        {
          id: "src-sparse",
          kind: "email",
          name: "单信号边界",
          text: "只是一段说明",
          sourceUpdatedAt: "2026-05-18T00:00:00.000Z"
        }
      ],
      chunks: [],
      rules: {}
    });

    expect(result.overview).toMatchObject({
      emailCount: 1,
      threadCount: 1,
      transactionCount: 1
    });
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0]).toMatchObject({
      sourceId: "src-sparse",
      subject: "单信号边界",
      normalizedSubject: "单信号边界",
      body: "只是一段说明",
      status: "active"
    });
    expect(result.people).toHaveLength(0);
    expect(result.timeline).toHaveLength(1);
  });

  it("merges amount-heavy threads into a single transaction by participant overlap and content similarity", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-merge-a",
          kind: "email",
          name: "付款对账 A",
          text: [
            "From: Alice Chen <alice@acme.com>",
            "To: Bob Li <bob@acme.com>",
            "Subject: 付款对账 1200 元",
            "Date: 2026-05-22T00:00:00.000Z",
            "",
            "金额 1200 元，付款确认，对账完成。"
          ].join("\n")
        },
        {
          id: "src-merge-b",
          kind: "email",
          name: "付款对账 B",
          text: [
            "From: Carol Chen <carol@acme.com>",
            "To: Bob Li <bob@acme.com>",
            "Subject: 付款对账 1800 元",
            "Date: 2026-05-23T00:00:00.000Z",
            "",
            "金额 1800 元，付款确认，对账完成。"
          ].join("\n")
        }
      ],
      chunks: [],
      settings: {
        transactionWindowDays: 7
      },
      rules: {
        transactionMergeRules: {
          mediumSimilarity: 0.01,
          mediumParticipantOverlap: 0.2,
          highParticipantOverlap: 0.9
        }
      }
    });

    expect(result.overview.emailCount).toBe(2);
    expect(result.threads).toHaveLength(2);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      threadIds: ["thread-1", "thread-2"],
      sourceSpread: 2
    });
    expect(result.transactions[0].categories).toEqual(
      expect.arrayContaining(["multi-source"])
    );
    expect(result.emails.map((item) => item.subject)).toEqual([
      "付款对账 1200 元",
      "付款对账 1800 元"
    ]);
    expect(result.people.map((item) => item.primaryEmail)).toEqual(
      expect.arrayContaining(["alice@acme.com", "bob@acme.com", "carol@acme.com"])
    );
  });

  it("keeps association sorting stable when multiple pairs have identical strength", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-assoc-a",
          kind: "email",
          name: "关联序列 A",
          text: [
            "From: Alice Chen <alice@acme.com>",
            "To: Bob Li <bob@acme.com>",
            "Subject: 付款对账 A",
            "Date: 2026-05-22T00:00:00.000Z",
            "",
            "金额待核对，付款确认，对账完成。"
          ].join("\n")
        },
        {
          id: "src-assoc-b",
          kind: "email",
          name: "关联序列 B",
          text: [
            "From: Carol Chen <carol@acme.com>",
            "To: Bob Li <bob@acme.com>",
            "Subject: 付款对账 B",
            "Date: 2026-05-23T00:00:00.000Z",
            "",
            "金额待核对，付款确认，对账完成。"
          ].join("\n")
        },
        {
          id: "src-assoc-c",
          kind: "email",
          name: "关联序列 C",
          text: [
            "From: Dave Chen <dave@acme.com>",
            "To: Bob Li <bob@acme.com>",
            "Subject: 付款对账 C",
            "Date: 2026-05-24T00:00:00.000Z",
            "",
            "金额待核对，付款确认，对账完成。"
          ].join("\n")
        }
      ],
      chunks: [],
      settings: {
        transactionWindowDays: 0
      },
      rules: {}
    });

    expect(result.transactions).toHaveLength(3);
    expect(result.associations.items).toHaveLength(3);
    expect(new Set(result.associations.items.map((item) => item.strength)).size).toBe(1);
    expect(result.associations.summary).toMatchObject({
      totalCount: 3,
      strongCount: 3,
      continuationCount: 3,
      crossDepartmentCount: 0
    });
  });

});
