import { describe, expect, it } from "vitest";

import {
  EVIDENCE_GATE_PROTOCOL_VERSION,
  createEvidenceSufficiencyGate
} from "../../../server/platform/specialized/knowledge/retrieval/evidence-sufficiency-gate/index.mjs";

function sourceLocator({ externalId, providerId = "mail", syncBatchId = "sync-1", sourceType = "email" } = {}) {
  return {
    sourceType,
    providerId,
    externalId,
    syncBatchId,
    documentId: externalId,
    sectionId: "section-a",
    unifiedSource: {
      sourceType,
      providerId,
      externalId,
      syncBatchId
    }
  };
}

describe("evidence sufficiency gate extra coverage", () => {
  it("passes answerable results with hierarchy, diverse sources, citations, and deterministic semantic support", () => {
    const gate = createEvidenceSufficiencyGate({
      thresholds: {
        minEvidence: 2,
        minSources: 2,
        minAverageScore: 0.7,
        semanticSupportRequired: true
      }
    });

    const result = gate.evaluate({
      searchResult: {
        hierarchy: {
          selected: {
            documents: ["doc-1"],
            sections: ["section-a"]
          }
        },
        items: [
          {
            evidenceId: "ev-1",
            title: "Invoice renewal approved",
            claim: "Invoice renewal approved by Acme.",
            score: 0.95,
            sourceLocator: sourceLocator({ externalId: "mail-1" })
          }
        ]
      },
      evidenceItems: [
        {
          id: "ev-2",
          summary: "Contract clause remains active.",
          confidence: 0.85,
          source: sourceLocator({ externalId: "mail-2", providerId: "drive", syncBatchId: "sync-2", sourceType: "file" })
        }
      ],
      answer: [
        "- Invoice renewal approved [ev-1]",
        "- Contract clause remains active [ev-2]"
      ].join("\n")
    });

    expect(result).toMatchObject({
      protocolVersion: EVIDENCE_GATE_PROTOCOL_VERSION,
      ok: true,
      decision: "pass",
      answerability: "answerable",
      failures: []
    });
    expect(result.metrics).toMatchObject({
      evidenceCount: 2,
      sourceCount: 2,
      citedEvidenceCount: 2,
      citationCount: 2,
      averageScore: 0.9,
      maxScore: 0.95,
      hierarchySelectedCount: 2,
      uncitedClaimCount: 0,
      semanticClaimCount: 2,
      semanticUnsupportedClaimCount: 0
    });
    expect(result.metrics.sourceTypes).toEqual(["email", "file"]);
    expect(result.metrics.providerIds).toEqual(["drive", "mail"]);
    expect(result.metrics.syncBatchIds).toEqual(["sync-1", "sync-2"]);
    expect(result.semanticSupport.judgements.map((item) => item.source)).toEqual([
      "deterministic-token-overlap",
      "deterministic-token-overlap"
    ]);
  });

  it("returns needs_more_evidence with recommendations for missing evidence, hierarchy, citations, score, and semantic support", () => {
    const gate = createEvidenceSufficiencyGate();

    const result = gate.evaluate({
      searchResult: {
        hierarchy: {
          selected: {}
        },
        items: []
      },
      answer: "- Unsupported renewal claim without citation",
      thresholds: {
        minEvidence: 2,
        minSources: 1,
        minAverageScore: 0.8,
        semanticSupportRequired: true,
        maxSemanticUnsupportedClaims: 0
      }
    });

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("needs_more_evidence");
    expect(result.answerability).toBe("not_enough_evidence");
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "insufficient_evidence",
      "insufficient_source_diversity",
      "weak_score",
      "hierarchy_not_selected",
      "missing_answer_citations",
      "unsupported_claims",
      "semantic_unsupported_claims"
    ]);
    expect(result.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining("扩大检索范围"),
      expect.stringContaining("回答前补充 evidence citation"),
      expect.stringContaining("语义支持不足")
    ]));
  });

  it("routes conflicting evidence to reviewer instead of automatic answer publication", () => {
    const gate = createEvidenceSufficiencyGate({
      thresholds: {
        minEvidence: 2,
        minSources: 0,
        requireHierarchy: false,
        requireCitationsForAnswer: false
      }
    });

    const result = gate.evaluate({
      evidenceCards: [
        {
          evidenceId: "ev-positive",
          claim: "付款批准",
          score: 0.7,
          sourceLocator: sourceLocator({ externalId: "mail-positive" })
        },
        {
          evidenceId: "ev-negative",
          claim: "付款未批准",
          score: 0.8,
          sourceLocator: sourceLocator({ externalId: "mail-negative" })
        }
      ],
      thresholds: {
        maxConflicts: 0
      }
    });

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("needs_review");
    expect(result.answerability).toBe("conflicting");
    expect(result.metrics.conflictCount).toBe(1);
    expect(result.failures).toEqual([
      {
        code: "conflicting_evidence",
        actual: 1,
        expected: 0
      }
    ]);
    expect(result.conflicts[0]).toMatchObject({
      evidenceIds: ["ev-positive", "ev-negative"],
      claimA: "付款批准",
      claimB: "付款未批准"
    });
  });

  it("uses external semantic judgements and nested source locators when supplied", () => {
    const gate = createEvidenceSufficiencyGate({
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireHierarchy: false,
        semanticSupportRequired: true,
        maxSemanticUnsupportedClaims: 0
      }
    });

    const result = gate.evaluate({
      evidence: [
        {
          ref: "ev-x",
          title: "Price changed",
          snippet: "The quoted price changed in the renewal notice.",
          score: 0.9,
          item: {
            metadata: {
              unifiedSource: {
                fileRef: {
                  providerId: "box",
                  externalId: "file-1",
                  syncBatchId: "sync-box",
                  storageRelativePath: "renewals/notice.txt",
                  contentHash: "hash-1"
                }
              }
            },
            hierarchy: {
              documentId: "doc-x",
              sectionId: "section-x"
            }
          }
        }
      ],
      citations: [{ evidenceId: "ev-x" }],
      answer: "1. Price changed [ev-x]",
      semanticJudgement: {
        decision: {
          judgements: [
            {
              claimId: "claim-1",
              claim: "Price changed [ev-x]",
              citedEvidenceIds: ["ev-x"],
              verdict: "supported",
              score: 0.99,
              source: "nli-test-double"
            }
          ]
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.metrics.providerIds).toEqual(["box"]);
    expect(result.metrics.syncBatchIds).toEqual(["sync-box"]);
    expect(result.semanticSupport.judgements).toMatchObject([
      {
        claimId: "claim-1",
        citedEvidenceIds: ["ev-x"],
        supportScore: 0.99,
        supported: true,
        source: "nli-test-double"
      }
    ]);
  });
});
