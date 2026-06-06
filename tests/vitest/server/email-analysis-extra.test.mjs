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

describe("email-analysis deterministic parsing and classification", () => {
  it("returns empty analysis for empty inputs", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [],
      chunks: [],
      settings: BASE_SETTINGS,
      rules: {}
    });

    expect(result.overview).toEqual({
      emailCount: 0,
      threadCount: 0,
      transactionCount: 0,
      peopleCount: 0,
      timelineCount: 0,
      currentCount: 0,
      agingCount: 0,
      historicalCount: 0
    });
    expect(result.emails).toHaveLength(0);
    expect(result.threads).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
    expect(result.people).toHaveLength(0);
    expect(result.timeline).toHaveLength(0);
    expect(result.network).toEqual({ nodes: [], edges: [] });
    expect(result.associations.summary).toEqual({
      totalCount: 0,
      strongCount: 0,
      continuationCount: 0,
      crossDepartmentCount: 0
    });
    expect(result.associations.items).toHaveLength(0);
    expect(result.retrieval).toMatchObject({
      referenceTime: GENERATED_AT,
      halfLifeDays: BASE_SETTINGS.retrievalHalfLifeDays,
      staleAfterDays: BASE_SETTINGS.staleAfterDays,
      items: [],
      reviewQueue: [],
      searchPreview: []
    });
  });

  it("parses metadata-based email and applies report rule/category with boundary freshness", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-meta-001",
          kind: "email",
          name: "合同续签通知",
          text: "This text should be ignored if metadata body exists.",
          sourceUpdatedAt: "2026-05-05T00:00:00.000Z",
          rawObject: { objectId: "obj-001", sha256: "sha-001" },
          documentMetadata: {
            "message:raw-header:subject": "Re: 合同续签周报",
            "message:from": "Alice Zhang <alice@acme.com>",
            "message:raw-header:from": "Alice Zhang <alice@acme.com>",
            "message:raw-header:to": "Bob Lee <bob@acme.com>; Carol Sun <carol@acme.com>",
            "message:raw-header:cc": "Ops Team <ops@acme.com>",
            "message:raw-header:bcc": "Audit <audit@acme.com>",
            "message:raw-header:date": "2026-05-05T00:00:00.000Z",
            "message:raw-header:message-id": "<MSG-100@ACME.COM>",
            "message:raw-header:in-reply-to": "<PARENT@ACME.COM>",
            "message:raw-header:references":
              "<PARENT@ACME.COM> <ROOT@ACME.COM> <PARENT@ACME.COM>",
            "message:to": "Bob Lee <bob@acme.com>, Carol Sun <carol@acme.com>",
            "message:cc": "Ops Team <ops@acme.com>"
          },
          embeddedDocuments: [
            {
              text: "本周报：合同续签进展，第一阶段已完成。",
              metadata: { "content-type": "text/plain; charset=utf-8" }
            },
            {
              text: "<div>legacy html</div>",
              metadata: { "content-type": "text/html; charset=utf-8" }
            }
          ]
        }
      ],
      chunks: [
        {
          id: "chunk-meta-001",
          sourceId: "src-meta-001"
        }
      ],
      rules: {
        reportSeries: [
          {
            id: "weekly-report",
            label: "周报",
            cadence: "weekly",
            keywords: ["周报", "周进展"]
          }
        ],
        departmentDictionary: [
          {
            department: "销售一部",
            keywords: ["Alice", "Bob"],
            emailKeywords: ["ops@acme.com"]
          }
        ]
      }
    });

    const message = result.emails.at(0);
    const thread = result.threads.at(0);
    const transaction = result.transactions.at(0);

    expect(result.overview.emailCount).toBe(1);
    expect(message).toMatchObject({
      sourceId: "src-meta-001",
      subject: "合同续签周报",
      normalizedSubject: "合同续签周报",
      sentAt: "2026-05-05T00:00:00.000Z",
      status: "report",
      freshness: "aging",
      chunkIds: ["chunk-meta-001"],
      messageIdHeader: "msg-100@acme.com",
      inReplyTo: "parent@acme.com",
      references: ["parent@acme.com", "root@acme.com"],
      formalUseAllowed: true
    });
    expect(message.from).toMatchObject({
      id: "person::alice@acme.com",
      name: "Alice Zhang",
      address: "alice@acme.com",
      department: "销售一部",
      relation: "internal"
    });
    expect(message.to).toHaveLength(2);
    expect(message.to?.[0].name).toMatch(/Bob/);
    expect(message.cc).toHaveLength(1);
    expect(message.cc?.[0].department).toBe("销售一部");
    expect(message.body).toBe("本周报：合同续签进展，第一阶段已完成。");
    expect(thread).toMatchObject({
      cadence: "weekly",
      status: "active"
    });
    expect(transaction).toMatchObject({
      status: "active",
      cadence: "weekly",
      freshness: "aging",
      formalUseAllowed: true,
      sourceSpread: 1
    });
    expect(result.retrieval.reviewQueue.every((item) => item.freshness === "aging")).toBe(true);
  });

  it("parses raw header text and classifies mixed watch/closed thread states", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-header-old",
          kind: "email",
          name: "周报线程",
          text: [
            "From: 李总 <lead@acme.com>",
            "To: 小赵 <zhao@acme.com>",
            "Subject: 周报进展",
            "Date: 2026-05-21T00:00:00.000Z",
            "",
            "已完成：本阶段工作已处理。"
          ].join("\n")
        },
        {
          id: "src-header-new",
          kind: "email",
          name: "周报线程",
          text: [
            "From: 李总 <lead@acme.com>",
            "To: 小赵 <zhao@acme.com>",
            "Cc: QA Team <qa@acme.com>",
            "Subject: Re: 周报进展",
            "Date: 2026-05-28T00:00:00.000Z",
            "",
            "> 已完成：本阶段工作已处理。",
            "待确认：请回复审批材料。",
            "On 2026-05-21, 李总 wrote:",
            "ignore this line"
          ].join("\n")
        }
      ],
      chunks: [],
      settings: { staleAfterDays: 14 },
      rules: {}
    });

    expect(result.emails).toHaveLength(2);
    expect(result.emails.map((item) => item.status)).toEqual(["closed", "watch"]);
    expect(result.emails[0].body).toBe("已完成：本阶段工作已处理。");
    expect(result.emails[1].body).toBe("待确认：请回复审批材料。");
    expect(result.emails[1].to).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({
      cadence: "weekly",
      status: "watch"
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      cadence: "weekly",
      status: "watch",
      formalUseAllowed: true
    });
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].timestamp).toBe("2026-05-21T00:00:00.000Z");
    expect(result.timeline[1].timestamp).toBe("2026-05-28T00:00:00.000Z");
    expect(result.timeline[1].type).toBe("follow-up");
  });

  it("is tolerant to dirty metadata and missing settings", () => {
    const result = runEmailAnalysis({
      sources: [
        { kind: "doc", id: "src-ignore", name: "ignore-me", text: "not email content" },
        { kind: "email", id: "src-edge", name: "bad-date", text: null, sourceCreatedAt: null },
        {
          kind: "email",
          id: "src-edge-2",
          name: "风险告警",
          text: [
            "From: 风险检测 <risk@ops.com>",
            "To: 收件人 <owner@ops.com>",
            "Subject: 风险事件",
            "Date: this is invalid",
            "",
            "系统异常风控：存在风险，需跟进。"
          ].join("\n"),
          documentMetadata: {},
          sourceUpdatedAt: "not-a-date",
          sourceCreatedAt: "also-invalid",
          rawObject: { objectId: "obj-edge", sha256: "sha-edge" }
        }
      ],
      chunks: [
        { id: "chunk-edge", sourceId: "src-edge-2" }
      ],
      settings: {
        retrievalHalfLifeDays: NaN,
        staleAfterDays: 30
      },
      generatedAt: GENERATED_AT,
      rules: {}
    });

    expect(result.emails).toHaveLength(1);
    expect(result.overview.emailCount).toBe(1);
    expect(result.emails[0]).toMatchObject({
      sourceId: "src-edge-2",
      subject: "风险事件",
      sentAt: GENERATED_AT,
      status: "watch",
      chunkIds: ["chunk-edge"],
      freshness: "current"
    });
    expect(result.emails[0].from).toMatchObject({
      name: "风险检测"
    });
  });

  it("covers fallback email parsing, localized headers, metadata arrays, html body, and monthly associations", () => {
    const fallbackOnly = runEmailAnalysisWithDefaults({
      sources: [
        {
          kind: "email",
          id: "src-fallback-body",
          name: "Fallback Body",
          text: "just a body without enough header signals",
          sourceUpdatedAt: "2026-02-01T00:00:00.000Z"
        }
      ],
      chunks: []
    });
    expect(fallbackOnly.emails).toHaveLength(1);
    expect(fallbackOnly.emails[0]).toMatchObject({
      sourceId: "src-fallback-body",
      subject: "Fallback Body"
    });

    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          kind: "email",
          id: "src-localized-header-a",
          name: "月报 A",
          text: [
            "发件人: 决策人 <approver@external.example>",
            "收件人: 内部用户 <owner@acme.com>",
            "抄送: 观察员 <observer@acme.com>",
            "密送: 秘密审计 <secret@acme.com>",
            "Subject: 月报决定",
            "  预算批准",
            "Date: 2026-01-01T00:00:00.000Z",
            "MessageID: <month-a@external.example>",
            "",
            "决定：预算审批通过。"
          ].join("\n")
        },
        {
          kind: "email",
          id: "src-localized-header-b",
          name: "月报 B",
          text: [
            "From: 决策人 <approver@external.example>",
            "To: 内部用户 <owner@acme.com>",
            "Cc: 观察员 <observer@acme.com>",
            "Subject: Re: 月报决定 预算批准",
            "Date: 2026-01-31T00:00:00.000Z",
            "InReplyTo: <month-a@external.example>",
            "References: <month-a@external.example> owner@acme.com",
            "",
            "决定：按这个方案继续执行。"
          ].join("\n")
        },
        {
          kind: "email",
          id: "src-metadata-html",
          name: "HTML metadata",
          text: "<p>fallback html</p>",
          sourceUpdatedAt: "2026-03-01T00:00:00.000Z",
          documentMetadata: {
            "message:from-email": [["director@acme.com"], null, { ignored: true }],
            "message:from-name": "Director",
            "message:to-email": ["owner@acme.com"],
            "message:raw-header:subject": "HTML 风险提醒",
            "message:raw-header:date": "2026-03-01T00:00:00.000Z"
          },
          embeddedDocuments: [
            {
              text: "<html><body><p>风险&nbsp;提醒</p><p>待确认</p></body></html>",
              metadata: { "content-type": "text/html" }
            }
          ]
        }
      ],
      chunks: [
        { id: "chunk-html", sourceId: "src-metadata-html" }
      ],
      rules: {
        departmentDictionary: [
          { department: "审批部", keywords: ["决策人", "Director"], emailKeywords: ["approver@external.example"] },
          { department: "观察组", keywords: ["观察员"], emailKeywords: ["observer@acme.com"] }
        ]
      }
    });

    expect(result.emails.map((item) => item.sourceId)).toEqual([
      "src-localized-header-a",
      "src-localized-header-b",
      "src-metadata-html"
    ]);
    expect(result.emails[0]).toMatchObject({
      subject: "月报决定 预算批准",
      messageIdHeader: "month-a@external.example",
      status: "active"
    });
    expect(result.emails[0].bcc[0]).toMatchObject({
      name: "秘密审计",
      address: "secret@acme.com"
    });
    const reply = result.emails.find((item) => item.sourceId === "src-localized-header-b");
    expect(reply).toMatchObject({
      inReplyTo: "month-a@external.example",
      references: ["month-a@external.example", "owner@acme.com"],
      previousMessageIds: ["email-1"]
    });
    expect(result.emails.find((item) => item.sourceId === "src-metadata-html")).toMatchObject({
      sourceId: "src-metadata-html",
      body: "风险 提醒 待确认",
      chunkIds: ["chunk-html"],
      status: "watch"
    });

    const monthly = result.transactions.find((transaction) => transaction.title.includes("月报决定"));
    expect(monthly).toMatchObject({
      cadence: "monthly",
      status: "closed"
    });
    expect(monthly.summary).toContain("月报 / 月进展");
    expect(result.people.find((person) => person.primaryEmail === "observer@acme.com")).toMatchObject({
      role: "observer",
      primaryDepartment: "观察组"
    });
    expect(result.associations.summary.totalCount).toBeGreaterThanOrEqual(0);
  });
});
