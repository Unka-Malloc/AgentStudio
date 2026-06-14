import {
  createEvidenceSufficiencyGate,
  EVIDENCE_GATE_PROTOCOL_VERSION
} from "../../retrieval/evidence-sufficiency-gate/index.mjs";

export const KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION = "v0.0.1:knowledge:agent-skill-1";

const DEFAULT_TOOL_POLICY = {
  coarseToFineRequired: true,
  canonicalWritesAllowed: false,
  rawEvidenceRewriteAllowed: false,
  requiredStages: [
    "coarse_candidate_recognition",
    "fine_evidence_retrieval",
    "evidence_sufficiency_gate",
    "answer_or_review"
  ]
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getKnowledgeCore(runtime) {
  const mount = runtime?.mounts?.knowledgeBase;
  if (!mount || mount.enabled === false) {
    return null;
  }
  return mount;
}

function inferIntent(query) {
  const text = normalizeText(query).toLowerCase();
  if (/总结|摘要|概括|summary|summari[sz]e/.test(text)) {
    return "summarize";
  }
  if (/比较|对比|差异|compare|versus|vs/.test(text)) {
    return "compare";
  }
  if (/是否|真假|确认|核实|verify|fact/.test(text)) {
    return "fact_check";
  }
  if (/谁|什么|何时|什么时候|多少|where|when|who|what|how much/.test(text)) {
    return "lookup";
  }
  return "explore";
}

function queryTokens(query) {
  return normalizeText(query)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 16);
}

function buildQueryRewrites(query, intent) {
  const base = normalizeText(query);
  const tokens = queryTokens(base);
  const rewrites = new Set([base]);
  if (tokens.length) {
    rewrites.add(tokens.slice(0, 8).join(" "));
  }
  if (intent === "summarize") {
    rewrites.add(`${base} 关键事项 风险 时间 金额 责任 决策`);
  } else if (intent === "fact_check") {
    rewrites.add(`${base} 证据 来源 冲突 确认`);
  } else if (intent === "compare") {
    rewrites.add(`${base} 差异 版本 变化 决策依据`);
  } else {
    rewrites.add(`${base} 证据 时间 人物 金额 来源`);
  }
  return [...rewrites].filter(Boolean).slice(0, 4);
}

function evidenceNeedForIntent(intent) {
  const base = ["source_locator", "citation", "hierarchy_path"];
  if (intent === "summarize") {
    return [...base, "representative_evidence", "missing_important_evidence", "conflicts"];
  }
  if (intent === "fact_check") {
    return [...base, "supporting_evidence", "contradicting_evidence", "revision_or_date"];
  }
  if (intent === "compare") {
    return [...base, "side_a_evidence", "side_b_evidence", "changed_fields"];
  }
  return [...base, "direct_answer_evidence"];
}

function mergeSearchResults(results = [], query = "", limit = 20) {
  const byEvidenceId = new Map();
  for (const result of results) {
    for (const item of asArray(result.items)) {
      const key = item.evidenceId || item.itemId || `${item.title}::${item.snippet}`;
      const current = byEvidenceId.get(key);
      if (!current || Number(item.score || 0) > Number(current.score || 0)) {
        byEvidenceId.set(key, item);
      }
    }
  }
  const primary = results[0] || {};
  const items = [...byEvidenceId.values()]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, limit);
  return {
    ...primary,
    protocolVersion: primary.protocolVersion || "v0.0.1:knowledge:core-1",
    query,
    limit,
    mergedQueryCount: results.length,
    items,
    explain: {
      ...(primary.explain || {}),
      mergedQueryCount: results.length,
      mergedCandidateCount: byEvidenceId.size
    }
  };
}

export function createKnowledgeAgentSkillRuntime({
  runtime,
  evidenceGate = createEvidenceSufficiencyGate(),
  modelDecisionRuntime = null
} = {}) {
  function describe() {
    return {
      protocolVersion: KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION,
      name: "pact.knowledge.agent-skill",
      purpose: "Plan and execute evidence-grounded knowledge-base operations for stateless agents.",
      toolPolicy: DEFAULT_TOOL_POLICY,
      evidenceGateProtocolVersion: EVIDENCE_GATE_PROTOCOL_VERSION,
      modelDecisionProtocolVersion: modelDecisionRuntime?.protocolVersion || "",
      stages: [
        {
          id: "plan",
          rule: "Identify intent, coarse targets, evidence needs, query rewrites, and verification checks before searching."
        },
        {
          id: "retrieve",
          rule: "All retrieval must use coarse-to-fine hierarchy search before block/evidence use."
        },
        {
          id: "gate",
          rule: "Run EvidenceSufficiencyGate before answer, artifact publish, or canonical-change suggestion."
        },
        {
          id: "act",
          rule: "If gate fails, request more evidence or create review issue; do not assert unsupported claims."
        }
      ],
      modelRoles: modelDecisionRuntime?.describe?.().roles || [
        { roleId: "query_rewriter", fallback: "deterministic-query-rewrite" },
        { roleId: "evidence_entailment_judge", fallback: "deterministic-token-entailment" },
        { roleId: "failure_attributor", fallback: "deterministic-feedback-attribution" }
      ]
    };
  }

  function plan(input = {}) {
    const query = normalizeText(input.query || input.q || input.question || "");
    const intent = String(input.intent || inferIntent(query));
    const rewrites = buildQueryRewrites(query, intent);
    return {
      protocolVersion: KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION,
      skill: describe(),
      plan: {
        query,
        intent,
        coarseIndexFirst: true,
        evidenceNeeds: evidenceNeedForIntent(intent),
        queryRewrites: rewrites,
        retrieval: {
          endpoint: "/api/knowledge/search",
          method: "POST",
          requiredParams: {
            query,
            explain: true,
            learningEnabled: input.learningEnabled !== false
          },
          hierarchyBoundary: "collection/document/section -> block/evidence/asset"
        },
        verificationChecks: [
          "hierarchy_selected",
          "minimum_evidence",
          "source_diversity",
          "citation_coverage",
          "conflict_detection",
          "unsupported_claim_detection",
          "semantic_evidence_support"
        ],
        modelRolePlan: {
          queryRewriter: "query_rewriter",
          evidenceJudge: "evidence_entailment_judge",
          failureAttributor: "failure_attributor",
          explicitModelEnableRequired: true,
          fallback: "deterministic"
        },
        answerPolicy: {
          pass: "answer_with_citations",
          needs_more_evidence: "retrieve_more_or_report_insufficient_evidence",
          needs_review: "create_review_item_or_issue"
        }
      }
    };
  }

  async function run(input = {}) {
    const planned = plan(input);
    const knowledgeCore = getKnowledgeCore(runtime);
    if (!knowledgeCore || typeof knowledgeCore.search !== "function") {
      return {
        protocolVersion: KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION,
        ok: false,
        error: "knowledge_core_unavailable",
        ...planned
      };
    }
    let queryRewriteDecision = null;
    let queryRewrites = planned.plan.queryRewrites;
    if (modelDecisionRuntime && typeof modelDecisionRuntime.decide === "function") {
      queryRewriteDecision = await modelDecisionRuntime.decide({
        roleId: "query_rewriter",
        modelEnabled: input.modelEnabled === true,
        modelAlias: input.queryRewriterModelAlias || input.modelAlias || "",
        input: {
          query: planned.plan.query,
          intent: planned.plan.intent,
          modelEnabled: input.modelEnabled === true
        }
      });
      const modelRewrites = asArray(queryRewriteDecision?.decision?.queryRewrites)
        .map(normalizeText)
        .filter(Boolean);
      if (modelRewrites.length) {
        queryRewrites = [...new Set([...queryRewrites, ...modelRewrites])].slice(0, 6);
      }
    }
    const safeLimit = Math.max(1, Math.min(Number(input.limit || 20), 100));
    const results = [];
    for (const query of queryRewrites) {
      results.push(
        await knowledgeCore.search({
          query,
          limit: Math.max(safeLimit, Number(input.perQueryLimit || safeLimit)),
          batchId: input.batchId || "",
          retrievalProfileId: input.retrievalProfileId || input.profileId || "",
          profileKey: input.profileKey || "",
          clientId: input.clientId || "",
          learningEnabled: input.learningEnabled !== false,
          explain: input.explain !== false
        })
      );
    }
    const searchResult = mergeSearchResults(results, planned.plan.query, safeLimit);
    let semanticJudgement = null;
    const semanticSupportRequired =
      input.semanticSupportRequired === true ||
      input.thresholds?.semanticSupportRequired === true ||
      input.modelSemanticJudge === true;
    if (
      semanticSupportRequired &&
      modelDecisionRuntime &&
      typeof modelDecisionRuntime.decide === "function" &&
      String(input.answer || "").trim()
    ) {
      semanticJudgement = await modelDecisionRuntime.decide({
        roleId: "evidence_entailment_judge",
        modelEnabled: input.modelEnabled === true,
        modelAlias: input.evidenceJudgeModelAlias || input.modelAlias || "",
        input: {
          answer: input.answer || "",
          searchResult,
          evidenceItems: searchResult.items,
          minSupportScore: input.thresholds?.minSemanticSupportScore,
          modelEnabled: input.modelEnabled === true
        }
      });
    }
    const gate = evidenceGate.evaluate({
      query: planned.plan.query,
      searchResult,
      answer: input.answer || "",
      citations: input.citations || [],
      semanticJudgement,
      thresholds: {
        minEvidence: input.minEvidence ?? input.thresholds?.minEvidence ?? (planned.plan.intent === "lookup" ? 1 : 2),
        minSources: input.minSources ?? input.thresholds?.minSources ?? 1,
        requireHierarchy: input.requireHierarchy ?? input.thresholds?.requireHierarchy ?? true,
        requireCitationsForAnswer:
          input.requireCitationsForAnswer ?? input.thresholds?.requireCitationsForAnswer ?? Boolean(input.answer),
        semanticSupportRequired,
        ...asObject(input.thresholds)
      }
    });
    let failureAttribution = null;
    if (!gate.ok && modelDecisionRuntime && typeof modelDecisionRuntime.decide === "function") {
      failureAttribution = await modelDecisionRuntime.decide({
        roleId: "failure_attributor",
        modelEnabled: input.modelEnabled === true,
        modelAlias: input.failureAttributorModelAlias || input.modelAlias || "",
        input: {
          query: planned.plan.query,
          gate,
          searchResult,
          modelEnabled: input.modelEnabled === true
        }
      });
    }
    const answerPolicy = gate.decision === "pass"
      ? "answer_with_citations"
      : gate.decision === "needs_review"
        ? "create_review_item_or_issue"
        : "retrieve_more_or_report_insufficient_evidence";
    return {
      protocolVersion: KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION,
      ok: gate.ok,
      plan: {
        ...planned.plan,
        queryRewrites
      },
      searchResult,
      gate,
      modelDecisions: {
        queryRewrite: queryRewriteDecision,
        semanticJudgement,
        failureAttribution
      },
      answerPolicy,
      nextActions: gate.ok
        ? ["Use returned evidence IDs as citations.", "Do not add claims outside cited evidence."]
        : gate.recommendations
    };
  }

  return {
    protocolVersion: KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION,
    describe,
    plan,
    run
  };
}

export default createKnowledgeAgentSkillRuntime;
