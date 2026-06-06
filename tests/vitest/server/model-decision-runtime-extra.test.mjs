import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  MODEL_DECISION_PROTOCOL_VERSION,
  createModelDecisionRuntime
} from "../../../server/platform/specialized/agent/agent-gateway/model-decision-runtime/index.mjs";

describe("model decision runtime describe and role management", () => {
  it("exposes merged role profiles and live-updates configuration", () => {
    const runtime = createModelDecisionRuntime({
      roleProfiles: [
        {
          roleId: "query_rewriter",
          modelAlias: "override-qwen",
          budget: { maxInputTokens: 1200 }
        },
        {
          roleId: "custom_writer",
          modelAlias: "custom-provider",
          fallback: "custom-fallback",
          purpose: "用于实验的定制角色。"
        }
      ]
    });

    const description = runtime.describe();
    const customRole = description.roles.find((role) => role.roleId === "custom_writer");

    expect(description.protocolVersion).toBe(MODEL_DECISION_PROTOCOL_VERSION);
    expect(description.explicitModelEnableRequired).toBe(true);
    expect(description.noImplicitDownloads).toBe(true);
    expect(customRole).toMatchObject({
      purpose: "用于实验的定制角色。",
      fallback: "custom-fallback",
      configured: false
    });

    const updated = runtime.setRoleProfiles([
      {
        roleId: "custom_writer",
        modelAlias: "custom-updated",
        purpose: "更新后的定制角色。"
      }
    ]);

    expect(updated.roles).toContainEqual(
      expect.objectContaining({
        roleId: "custom_writer",
        modelAlias: "custom-updated",
        purpose: "更新后的定制角色。"
      })
    );
  });

  it("resolves role from roleId and fallback to default role", async () => {
    const runtime = createModelDecisionRuntime();

    const byRole = await runtime.decide({
      role: "query_rewriter",
      query: "采购流程"
    });
    const byUnknown = await runtime.decide({
      roleId: "unknown-role",
      query: "采购流程"
    });

    expect(byRole.roleId).toBe("query_rewriter");
    expect(byUnknown.roleId).toBe("query_rewriter");
    expect(byUnknown.decision.query).toBe("采购流程");
  });
});

describe("deterministic fallback decisions across major roles", () => {
  const runtime = createModelDecisionRuntime();

  it("builds deterministic query rewrites for summarize intent", async () => {
    const result = await runtime.decide({
      roleId: "query_rewriter",
      query: "最近的采购异常",
      intent: "summarize"
    });

    expect(result.usedModel).toBe(false);
    expect(result.degraded).toBe(false);
    expect(result.decision.intent).toBe("summarize");
    expect(result.decision.queryRewrites).toContain("最近的采购异常");
    expect(result.decision.notes).toEqual(["deterministic fallback; no model output was used"]);
  });

  it("covers non-default query rewrite intent branches", async () => {
    const compare = await runtime.decide({
      roleId: "query_rewriter",
      query: "采购流程差异",
      intent: "compare"
    });

    expect(compare.decision.notes).toEqual(["deterministic fallback; no model output was used"]);
    expect(compare.decision.queryRewrites).toContain("采购流程差异 difference change version basis");
  });

  it("returns deterministic failure attribution and reason counts", async () => {
    const result = await runtime.decide({
      roleId: "failure_attributor",
      feedback: [
        { action: "search_miss" },
        { action: "open", resultRank: 4 },
        { action: "thumb_down", context: { humanExpert: true } }
      ],
      gate: {
        failures: [{ code: "insufficient_evidence" }, { code: "conflicting_evidence" }]
      },
      evaluation: {
        caseResults: [{ metrics: { recallAtK: 0.1 } }, { metrics: { recallAtK: 2 } }]
      }
    });

    expect(result.decision.counts).toMatchObject({
      searchMiss: 1,
      lowRankOpen: 1,
      negativeFeedback: 1,
      humanExpertGuidance: 1,
      insufficientEvidence: 1,
      conflicts: 1,
      evaluationMiss: 1
    });
    expect(result.decision.primaryCause).toBe("low_recall");
    expect(result.decision.attributions.length).toBeGreaterThan(0);
  });

  it("normalizes evidence and computes entailment metadata", async () => {
    const result = await runtime.decide({
      roleId: "evidence_entailment_judge",
      answer: [
        "Revenue increased by 20 percent in Q2.[ev-1]",
        "The audit chain is complete and consistent.[ev-2]"
      ].join("\n"),
      searchResult: {
        items: [
          {
            id: "ev-2",
            claim: "The audit chain is complete and consistent.",
            snippet: "The audit chain is complete and consistent."
          }
        ]
      },
      evidenceItems: [
        {
          evidenceId: "ev-1",
          snippet: "Revenue increased by 20 percent in Q2 with validated financial reports."
        }
      ],
      minSupportScore: 0.3
    });

    expect(result.decision.judgements.length).toBe(2);
    expect(result.decision.verdict).toBe("supported");
    expect(result.decision.judgements[0].citedEvidenceIds).toContain("ev-1");
  });

  it("builds contradictory entailment flags in semantic entailment branch", async () => {
    const result = await runtime.decide({
      roleId: "semantic_entailment_judge",
      answer: "The budget was not approved. [ev-1]",
      evidenceItems: [
        {
          evidenceId: "ev-1",
          claim: "Auditor note confirmed with independent validation."
        }
      ],
      minSupportScore: 0.4
    });

    expect(result.decision.verdict).toBe("unsupported");
    expect(result.decision.judgements[0].contradiction).toBe(true);
  });

  it("returns deterministic conflict summary and rule-generation fallbacks", async () => {
    const conflict = await runtime.decide({
      roleId: "conflict_explainer",
      conflicts: [
        {
          conflictId: "c-1",
          evidenceIds: ["ev-a", "ev-b"]
        }
      ]
    });

    expect(conflict.decision.verdict).toBe("needs_review");
    expect(conflict.decision.conflicts[0]).toEqual(
      expect.objectContaining({
        conflictId: "c-1",
        evidenceIds: ["ev-a", "ev-b"],
        action: "needs_review"
      })
    );

    const generator = await runtime.decide({
      roleId: "golden_rule_generator",
      template: {
        templateId: "tpl-gold-rule"
      }
    });

    expect(generator.decision).toEqual({
      templateId: "tpl-gold-rule",
      variables: {},
      notes: ["deterministic fallback; runtime fills template variables and gate validates the package"]
    });
  });

  it("records unsupported claims and conflicting evidence attribution in fallback mode", async () => {
    const result = await runtime.decide({
      roleId: "failure_attributor",
      gate: {
        failures: [{ code: "unsupported_claims" }, { code: "semantic_unsupported_claims" }]
      },
      evaluation: { caseResults: [{ metrics: { recallAtK: 0.7 } }] },
      feedback: [{ action: "open", resultRank: 10 }]
    });

    expect(result.decision.counts.unsupportedClaims).toBe(2);
    expect(result.decision.counts.lowRankOpen).toBe(1);
  });

  it("produces deterministic profile proposals and hierarchy router outputs", async () => {
    const profile = await runtime.decide({
      roleId: "profile_proposer",
      activeProfile: {
        profileId: "base",
        version: 2,
        weights: {
          vector: 0.2,
          feedbackBoost: 0.08,
          graph: 0.05,
          bm25: 0.6
        },
        topK: 20
      },
      attributions: [
        { cause: "low_recall" },
        { cause: "ranking_miss" },
        { cause: "hierarchy_misroute" },
        { cause: "source_diversity_gap" }
      ]
    });

    expect(profile.decision.candidatePatch.profileId).toBe("base");
    expect(profile.decision.candidatePatch.topK).toBe(28);
    expect(profile.decision.candidatePatch.version).toBe(3);
    expect(profile.decision.autoPublishRisk).toBe("low");

    const router = await runtime.decide({
      roleId: "hierarchy_tree_router",
      query: "采购 合规 审批",
      nodes: [
        { nodeId: "n1", title: "采购审批合规树" },
        { nodeId: "n2", title: "人事流程树" }
      ]
    });

    expect(router.decision.selectedNodeIds).toEqual(["n1"]);
    expect(router.decision.nodeScores.n1).toBeGreaterThan(0);
  });

  it("covers additional deterministic role fallbacks", async () => {
    const runtime = createModelDecisionRuntime();

    const skillReview = await runtime.decide({
      roleId: "skill_reviewer",
      qualityReportV2: { passed: false },
      goldenRule: {
        decision: "needs_human_review",
        selectedRule: { ruleId: "rule-101", reason: "policy requires manual review" }
      },
      evidenceGate: { decision: "needs_review" }
    });

    expect(skillReview.decision.decision).toBe("needs_human_review");
    expect(skillReview.decision.confidence).toBe(0.6);

    const topicCluster = await runtime.decide({
      roleId: "topic_cluster_namer",
      cluster: {
        terms: [{ term: "合规" }, { term: "采购" }, { term: "流程" }]
      }
    });

    expect(topicCluster.decision.title).toBe("合规 采购 流程");
    expect(topicCluster.decision.confidence).toBe(0.66);

    const goldCase = await runtime.decide({
      roleId: "gold_case_builder",
      query: "采购付款流程",
      skill: {
        skillId: "skill-112",
        sourceQuery: "源查询",
        summary: "建立付款归因知识"
      },
      evidenceRefs: ["ev-1", "ev-2"]
    });

    expect(goldCase.decision.expectedSkillId).toBe("skill-112");
    expect(goldCase.decision.query).toBe("采购付款流程");
    expect(goldCase.decision.requiredEvidenceIds).toEqual(["ev-1", "ev-2"]);

    const ruleIntent = await runtime.decide({
      roleId: "rule_authoring_intent",
      message: "Need a rule for policy and review templates",
      templates: [{ templateId: "tpl-rule", intentKeywords: ["rule", "review", "policy"] }]
    });

    expect(ruleIntent.decision.needsRule).toBe(true);
    expect(ruleIntent.decision.templateId).toBe("tpl-rule");
    expect(ruleIntent.decision.confidence).toBeGreaterThan(0.5);
  });

  it("covers knowledge/safety utility fallbacks", async () => {
    const runtime = createModelDecisionRuntime();

    const hierarchyReview = await runtime.decide({
      roleId: "hierarchy_quality_reviewer",
      audit: {
        findings: [
          {
            suggestionType: "restructure",
            confidence: 0.71,
            evidenceRefs: ["ev-a"],
            proposedPatch: { findingCode: "h-review", action: "merge_related_nodes" }
          }
        ]
      }
    });

    expect(hierarchyReview.decision.verdict).toBe("needs_review");
    expect(hierarchyReview.decision.suggestions[0]).toEqual(
      expect.objectContaining({
        suggestionId: "hierarchy-suggestion-1",
        type: "restructure",
        confidence: 0.71
      })
    );

    const skillDistill = await runtime.decide({
      roleId: "knowledge_skill_distiller",
      query: "采购流程",
      fallbackSkill: {
        title: "采购流程",
        summary: "采购合规相关的归纳"
      },
      evidenceItems: [{ evidenceId: "ev-1", snippet: "证据1" }, { evidenceId: "ev-2", snippet: "证据2" }]
    });

    expect(skillDistill.decision.skill.title).toBe("采购流程");
    expect(skillDistill.decision.skill.evidenceRefs).toEqual(["ev-1", "ev-2"]);

    const rawBatch = await runtime.decide({
      roleId: "knowledge_raw_batch_extractor",
      batch: {
        batchNumber: 8,
        documentCount: 2,
        documents: [
          { title: "doc-1", text: "第一份材料内容较长。" },
          { title: "doc-2", text: "第二份材料也提供了关键索引。" }
        ]
      }
    });

    expect(rawBatch.decision.summary).toContain("批次 8 覆盖 2 份材料");
    expect(rawBatch.decision.sourceCoverage.documentCount).toBe(2);
    expect(rawBatch.decision.coreFindings).toHaveLength(2);

    const goldRuleApply = await runtime.decide({
      roleId: "gold_rule_applier",
      goldenRule: {
        decision: "approved",
        ok: true,
        selectedRule: { ruleId: "r-01" }
      }
    });

    expect(goldRuleApply.decision.decision).toBe("approved");
    expect(goldRuleApply.decision.selectedRuleId).toBe("r-01");
    expect(goldRuleApply.decision.confidence).toBe(0.72);
  });

  it("covers fallback intent and deterministic router sorting branches", async () => {
    const runtime = createModelDecisionRuntime();

    const route = await runtime.decide({
      roleId: "hierarchy_tree_router",
      query: "采购 合规 流程 流程",
      nodes: [
        { nodeId: "n2", title: "审核流程与合规", summary: "风险审查", documentId: "d2" },
        { nodeId: "n1", title: "采购流程", summary: "采购审批", documentId: "d1" }
      ]
    });

    expect(route.decision.selectedNodeIds).toHaveLength(2);
    expect(route.decision.selectedNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(route.decision.nodeScores.n1).toBeGreaterThan(0);
    expect(route.decision.nodeScores.n2).toBeGreaterThan(0);

    const ruleAuthorFromFallback = await runtime.decide({
      roleId: "rule_authoring_intent",
      fallbackIntent: {
        needsRule: false,
        intent: "none",
        templateId: ""
      }
    });

    expect(ruleAuthorFromFallback.decision.needsRule).toBe(false);
    expect(ruleAuthorFromFallback.decision.templateId).toBe("");

    const ruleAuthorFromScoring = await runtime.decide({
      roleId: "rule_authoring_intent",
      message: "Need policy review and compliance process",
      templates: [
        { templateId: "tpl-b", intentKeywords: ["template"] },
        { templateId: "tpl-a", intentKeywords: ["policy", "review"] }
      ]
    });

    expect(ruleAuthorFromScoring.decision.templateId).toBe("tpl-a");
  });
});

describe("model provider integration", () => {
  it("uses model gateway and parses plain JSON response", async () => {
    const agentGatewayCall = vi.fn(async () => ({
      answer: JSON.stringify({ fromMock: true }),
      upstream: { provider: "unit" }
    }));
    const runtime = createModelDecisionRuntime({ agentGatewayCall });

    const result = await runtime.decide({
      roleId: "query_rewriter",
      modelEnabled: true,
      query: "采购结算冲突排查"
    });

    expect(agentGatewayCall).toHaveBeenCalledTimes(1);
    expect(agentGatewayCall).toHaveBeenCalledWith(
      expect.objectContaining({
        modelAlias: "qwen-v3-32b",
        moduleId: "agentTools",
        question: expect.stringContaining("Role: query_rewriter"),
        modelRouting: expect.objectContaining({
          routeId: "model-decision.query_rewriter",
          promptVersion: "role:query_rewriter"
        }),
        parameters: {
          response_format: { type: "json_object" },
          max_tokens: expect.any(Number)
        }
      })
    );
    expect(result.usedModel).toBe(true);
    expect(result.decision).toEqual({ fromMock: true });
    expect(result.audit.upstream).toEqual({ provider: "unit" });
  });

  it("parses fenced JSON from model provider and keeps fallback path stable", async () => {
    const agentGatewayCall = vi.fn(async () => ({
      answer: "```json\n{\"status\":\"ok\",\"type\":\"model\"}\n```"
    }));
    const runtime = createModelDecisionRuntime({ agentGatewayCall });

    const result = await runtime.decide({
      roleId: "query_rewriter",
      modelEnabled: true,
      query: "财务审计结论"
    });

    expect(result.usedModel).toBe(true);
    expect(result.decision).toEqual({ status: "ok", type: "model" });
  });

  it("falls back when model output is not parseable", async () => {
    const agentGatewayCall = vi.fn(async () => ({
      answer: "not-json"
    }));
    const runtime = createModelDecisionRuntime({ agentGatewayCall });

    const result = await runtime.decide({
      roleId: "query_rewriter",
      modelEnabled: true,
      query: "财务审计结论"
    });

    expect(result.usedModel).toBe(true);
    expect(result.decision.rawText).toBe("not-json");
  });

  it("degrades deterministically when provider throws", async () => {
    const agentGatewayCall = vi.fn(async () => {
      throw new Error("provider offline");
    });
    const runtime = createModelDecisionRuntime({ agentGatewayCall });

    const result = await runtime.decide({
      roleId: "query_rewriter",
      modelEnabled: true,
      query: "财务审计结论"
    });

    expect(result.usedModel).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.audit.fallbackReason).toBe("provider offline");
    expect(result.decision).toMatchObject({ queryRewrites: expect.any(Array) });
  });

  it("falls back when not enabled or over budget", async () => {
    const agentGatewayCall = vi.fn(async () => ({ answer: "{}" }));
    const runtime = createModelDecisionRuntime({
      agentGatewayCall,
      roleProfiles: [
        {
          roleId: "query_rewriter",
          budget: { maxInputTokens: 1 }
        }
      ]
    });

    const overBudget = await runtime.decide({
      roleId: "query_rewriter",
      modelEnabled: true,
      query: "这是一个很长的输入用于触发 token 上限分支的测试。"
    });
    const disabled = await runtime.decide({
      roleId: "query_rewriter",
      query: "短文本",
      modelEnabled: false
    });

    expect(overBudget.degraded).toBe(true);
    expect(overBudget.audit.fallbackReason).toBe("input_over_budget");
    expect(disabled.audit.fallbackReason).toBe("model_not_explicitly_enabled");
    expect(agentGatewayCall).not.toHaveBeenCalled();
  });

  it("builds deterministic audit hashes", async () => {
    const payload = {
      roleId: "query_rewriter",
      query: "审核规则",
      intent: "summarize"
    };
    const prompt = [
      "You are a Pact knowledge-base decision helper.",
      "Return only compact JSON. Do not rewrite facts. Do not make canonical knowledge mutations.",
      "Role: query_rewriter",
      "Purpose: Generate safe query rewrites before hierarchical retrieval.",
      `Input JSON: ${JSON.stringify(payload)}`
    ].join("\n");

    const runtime = createModelDecisionRuntime();
    const result = await runtime.decide(payload);

    const expectedInputHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
    const expectedPromptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 24);

    expect(result.audit.inputHash).toBe(expectedInputHash);
    expect(result.audit.promptHash).toBe(expectedPromptHash);
  });
});
