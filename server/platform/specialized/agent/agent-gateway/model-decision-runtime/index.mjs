import { createHash } from "node:crypto";

export const MODEL_DECISION_PROTOCOL_VERSION = "pact.model-decision.v1";

const DEFAULT_ROLE_PROFILES = [
  {
    roleId: "query_rewriter",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-query-rewrite",
    purpose: "Generate safe query rewrites before hierarchical retrieval.",
    budget: {
      maxInputTokens: 2400,
      maxOutputTokens: 600,
      maxCallsPerRun: 4
    }
  },
  {
    roleId: "failure_attributor",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-feedback-attribution",
    purpose: "Attribute failed searches, weak rankings, and gate failures to actionable causes.",
    budget: {
      maxInputTokens: 6000,
      maxOutputTokens: 1000,
      maxCallsPerRun: 3
    }
  },
  {
    roleId: "evidence_entailment_judge",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-token-entailment",
    purpose: "Judge whether cited evidence semantically supports answer claims.",
    budget: {
      maxInputTokens: 8000,
      maxOutputTokens: 1200,
      maxCallsPerRun: 8
    }
  },
  {
    roleId: "conflict_explainer",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-conflict-summary",
    purpose: "Explain contradicting evidence pairs without mutating canonical facts.",
    budget: {
      maxInputTokens: 5000,
      maxOutputTokens: 800,
      maxCallsPerRun: 4
    }
  },
  {
    roleId: "profile_proposer",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-profile-proposal",
    purpose: "Propose candidate retrieval profile changes from failure attribution and evaluation.",
    budget: {
      maxInputTokens: 8000,
      maxOutputTokens: 1200,
      maxCallsPerRun: 2
    }
  },
  {
    roleId: "hierarchy_quality_reviewer",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-hierarchy-quality-review",
    purpose: "Suggest reviewable hierarchy split, merge, and reclassification work.",
    budget: {
      maxInputTokens: 8000,
      maxOutputTokens: 1200,
      maxCallsPerRun: 2
    }
  },
  {
    roleId: "hierarchy_tree_router",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-hierarchy-tree-router",
    purpose: "Select compact hierarchy tree nodes for optional long-document retrieval routing without mutating knowledge.",
    budget: {
      maxInputTokens: 8000,
      maxOutputTokens: 900,
      maxCallsPerRun: 4
    }
  },
  {
    roleId: "knowledge_skill_distiller",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-knowledge-skill-distillation",
    purpose: "Distill evidence-backed knowledge into reusable Skill structure without changing canonical facts.",
    budget: {
      maxInputTokens: 10000,
      maxOutputTokens: 1800,
      maxCallsPerRun: 2
    }
  },
  {
    roleId: "knowledge_raw_batch_extractor",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-raw-batch-extraction",
    purpose: "Extract compact core findings from one bounded raw-corpus batch for later knowledge distillation.",
    budget: {
      maxInputTokens: 14000,
      maxOutputTokens: 1600,
      maxCallsPerRun: 40
    }
  },
  {
    roleId: "gold_rule_applier",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-gold-rule-application",
    purpose: "Apply human-authored golden rules to candidate knowledge changes without mutating canonical facts.",
    budget: {
      maxInputTokens: 6000,
      maxOutputTokens: 1000,
      maxCallsPerRun: 6
    }
  },
  {
    roleId: "skill_reviewer",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-skill-review",
    purpose: "Review candidate KnowledgeSkills against evidence, golden rules, and replay metrics.",
    budget: {
      maxInputTokens: 10000,
      maxOutputTokens: 1600,
      maxCallsPerRun: 4
    }
  },
  {
    roleId: "semantic_entailment_judge",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-token-entailment",
    purpose: "Judge semantic support using the same contract as evidence_entailment_judge.",
    budget: {
      maxInputTokens: 8000,
      maxOutputTokens: 1200,
      maxCallsPerRun: 8
    }
  },
  {
    roleId: "topic_cluster_namer",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-topic-cluster-name",
    purpose: "Name evidence clusters for reviewable skill distillation candidates.",
    budget: {
      maxInputTokens: 5000,
      maxOutputTokens: 600,
      maxCallsPerRun: 8
    }
  },
  {
    roleId: "gold_case_builder",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-gold-case-build",
    purpose: "Convert human expert feedback and resolved reviews into replayable gold cases.",
    budget: {
      maxInputTokens: 5000,
      maxOutputTokens: 900,
      maxCallsPerRun: 6
    }
  },
  {
    roleId: "rule_authoring_intent",
    modelAlias: "qwen-v3-32b",
    fallback: "deterministic-rule-authoring-intent",
    purpose: "Decide whether a user message should generate a reviewable GoldenRulePackage from an existing JSON template.",
    budget: {
      maxInputTokens: 4000,
      maxOutputTokens: 600,
      maxCallsPerRun: 4
    }
  },
  {
    roleId: "golden_rule_generator",
    modelAlias: "deepseek-v3-671b",
    fallback: "deterministic-golden-rule-template-generation",
    purpose: "Select variables for an existing GoldenRule JSON template without bypassing the GoldenRule gate.",
    budget: {
      maxInputTokens: 6000,
      maxOutputTokens: 900,
      maxCallsPerRun: 3
    }
  }
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashText(value, length = 24) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

function tokenize(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu) || []
    )
  ].filter((token) => token.length >= 2 && token.length <= 64);
}

function tryParseJson(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function mergeRoleProfiles(overrides = []) {
  const byRole = new Map(DEFAULT_ROLE_PROFILES.map((role) => [role.roleId, role]));
  for (const override of asArray(overrides)) {
    const roleId = String(override?.roleId || "").trim();
    if (!roleId) {
      continue;
    }
    const current = byRole.get(roleId) || {};
    byRole.set(roleId, {
      ...current,
      ...override,
      budget: {
        ...(current.budget || {}),
        ...(override.budget || {})
      }
    });
  }
  return [...byRole.values()];
}

function splitClaimLines(answer = "") {
  return String(answer || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+|^\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

function citedIdsForClaim(claim = "") {
  return [...String(claim || "").matchAll(/\[([^\]\n]+)\]/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function evidenceText(item = {}) {
  return normalizeText([
    item.claim,
    item.title,
    item.snippet,
    item.summary,
    item.text,
    item.item?.claim,
    item.item?.title,
    item.item?.snippet
  ].filter(Boolean).join(" "));
}

function tokenOverlap(claim, evidence) {
  const claimTokens = tokenize(claim).filter((token) => !/^\d+$/.test(token));
  if (!claimTokens.length) {
    return 1;
  }
  const evidenceTokens = new Set(tokenize(evidence));
  const hitCount = claimTokens.filter((token) => evidenceTokens.has(token) || evidence.includes(token)).length;
  return hitCount / claimTokens.length;
}

function normalizeEvidenceItems(input = {}) {
  return [
    ...asArray(input.evidenceItems || input.evidence || input.evidenceCards),
    ...asArray(input.searchResult?.items)
  ].map((item, index) => ({
    evidenceId: String(item.evidenceId || item.id || item.ref || `evidence-${index + 1}`),
    title: item.title || "",
    claim: item.claim || item.snippet || item.summary || item.title || "",
    score: Number(item.score || item.confidence || 0),
    item
  }));
}

function deterministicQueryRewrite(input = {}) {
  const query = normalizeText(input.query || input.q || input.question || "");
  const intent = String(input.intent || "lookup");
  const tokens = tokenize(query).slice(0, 10);
  const rewrites = new Set([query]);
  if (tokens.length) {
    rewrites.add(tokens.join(" "));
  }
  if (intent === "summarize") {
    rewrites.add(`${query} key points risks dates amounts people decisions`);
  } else if (intent === "fact_check") {
    rewrites.add(`${query} evidence source contradiction revision date`);
  } else if (intent === "compare") {
    rewrites.add(`${query} difference change version basis`);
  } else {
    rewrites.add(`${query} evidence time person amount source`);
  }
  return {
    query,
    intent,
    queryRewrites: [...rewrites].filter(Boolean).slice(0, 6),
    notes: ["deterministic fallback; no model output was used"]
  };
}

function deterministicFailureAttribution(input = {}) {
  const feedback = asArray(input.feedback);
  const gateFailures = asArray(input.gate?.failures || input.gateFailures);
  const evaluationCases = asArray(input.evaluation?.caseResults || input.caseResults);
  const counts = {
    searchMiss: 0,
    lowRankOpen: 0,
    negativeFeedback: 0,
    humanExpertGuidance: 0,
    insufficientEvidence: 0,
    sourceDiversity: 0,
    hierarchyMiss: 0,
    unsupportedClaims: 0,
    conflicts: 0,
    evaluationMiss: 0
  };
  for (const item of feedback) {
    const action = String(item.action || "").replace(/-/g, "_");
    if (["search_miss", "searchMiss"].includes(action)) {
      counts.searchMiss += 1;
    }
    if (["thumb_down", "thumbDown", "bad_result"].includes(action)) {
      counts.negativeFeedback += 1;
    }
    if (["open", "copy", "export"].includes(action) && Number(item.resultRank || 0) > 3) {
      counts.lowRankOpen += 1;
    }
    if (
      item.context?.gold === true ||
      item.context?.humanExpert === true ||
      ["human_expert_clarification", "human_expert_correction", "expert_choice", "expert_feedback"].includes(action)
    ) {
      counts.humanExpertGuidance += 1;
    }
  }
  for (const failure of gateFailures) {
    if (failure.code === "insufficient_evidence") counts.insufficientEvidence += 1;
    if (failure.code === "insufficient_source_diversity") counts.sourceDiversity += 1;
    if (failure.code === "hierarchy_not_selected") counts.hierarchyMiss += 1;
    if (failure.code === "unsupported_claims" || failure.code === "semantic_unsupported_claims") {
      counts.unsupportedClaims += 1;
    }
    if (failure.code === "conflicting_evidence") counts.conflicts += 1;
  }
  for (const testCase of evaluationCases) {
    if (Number(testCase.metrics?.recallAtK || 0) < 1) {
      counts.evaluationMiss += 1;
    }
  }

  const attributions = [];
  const add = (cause, count, recommendation) => {
    if (count <= 0) return;
    attributions.push({
      cause,
      count,
      confidence: Number(Math.min(0.95, 0.55 + count * 0.08).toFixed(2)),
      recommendation
    });
  };
  add("low_recall", counts.searchMiss + counts.insufficientEvidence + counts.evaluationMiss, "Increase candidate breadth and add query rewrites before rerank.");
  add("ranking_miss", counts.lowRankOpen, "Boost routes that contain clicked evidence and evaluate rerank thresholds.");
  add("semantic_mismatch", counts.negativeFeedback + counts.unsupportedClaims, "Add semantic support checks before answer publication.");
  add("source_diversity_gap", counts.sourceDiversity, "Require more document or section diversity for publishable answers.");
  add("hierarchy_misroute", counts.hierarchyMiss, "Audit coarse hierarchy branch selection and rebuild weak nodes.");
  add("evidence_conflict", counts.conflicts, "Route contradictions to review instead of automatic merge.");

  return {
    counts,
    attributions,
    primaryCause: attributions[0]?.cause || "no_clear_failure",
    notes: ["generic deterministic attribution; not trained on a specific dataset"]
  };
}

function deterministicEntailment(input = {}) {
  const answer = String(input.answer || input.content || "");
  const claims = asArray(input.claims).length ? asArray(input.claims).map(String) : splitClaimLines(answer);
  const evidenceItems = normalizeEvidenceItems(input);
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceId, evidenceText(item)]));
  const minSupportScore = Number(input.minSupportScore ?? 0.5);
  const judgements = claims.map((claim, index) => {
    const citations = citedIdsForClaim(claim);
    const citedEvidence = citations.map((id) => evidenceById.get(id)).filter(Boolean);
    const supportScores = citedEvidence.map((text) => tokenOverlap(claim, text));
    const maxScore = Number(Math.max(0, ...supportScores).toFixed(6));
    const supported = citedEvidence.length > 0 && maxScore >= minSupportScore;
    return {
      claimId: `claim-${index + 1}`,
      claim,
      citedEvidenceIds: citations,
      supportScore: maxScore,
      supported,
      contradiction:
        /\bnot\b|\bno\b|\bcancel(?:led|ed|s|lation)?\b|\bterminate(?:d|s|ion)?\b|不|未|没有|否认|取消|终止/i.test(claim) &&
        citedEvidence.some((text) => !/\bnot\b|\bno\b|\bcancel(?:led|ed|s|lation)?\b|\bterminate(?:d|s|ion)?\b|不|未|没有|否认|取消|终止/i.test(text))
    };
  });
  return {
    minSupportScore,
    judgements,
    unsupportedClaims: judgements.filter((item) => !item.supported),
    contradictoryClaims: judgements.filter((item) => item.contradiction),
    verdict: judgements.every((item) => item.supported) ? "supported" : "unsupported"
  };
}

function deterministicConflictSummary(input = {}) {
  const conflicts = asArray(input.conflicts);
  return {
    conflicts: conflicts.map((conflict, index) => ({
      conflictId: conflict.conflictId || `conflict-${index + 1}`,
      evidenceIds: asArray(conflict.evidenceIds),
      explanation: "The evidence pair contains opposite polarity or incompatible claims.",
      action: "needs_review"
    })),
    verdict: conflicts.length ? "needs_review" : "no_conflict"
  };
}

function deterministicProfileProposal(input = {}) {
  const activeProfile = asObject(input.activeProfile || input.profile);
  const attributions = asArray(input.attributions || input.failureAttribution?.attributions);
  const causes = new Set(attributions.map((item) => item.cause));
  const weights = {
    ...(activeProfile.weights || {})
  };
  let topK = Number(activeProfile.topK || 20);
  if (causes.has("low_recall")) {
    topK = Math.min(100, topK + 8);
    weights.vector = Number(((weights.vector ?? 0.3) + 0.04).toFixed(4));
  }
  if (causes.has("ranking_miss")) {
    weights.feedbackBoost = Number(((weights.feedbackBoost ?? 0.08) + 0.04).toFixed(4));
  }
  if (causes.has("hierarchy_misroute")) {
    weights.graph = Number(((weights.graph ?? 0.05) + 0.02).toFixed(4));
  }
  if (causes.has("source_diversity_gap")) {
    weights.bm25 = Number(((weights.bm25 ?? 0.55) + 0.03).toFixed(4));
  }
  return {
    candidatePatch: {
      profileId: activeProfile.profileId || "balanced",
      version: Number(activeProfile.version || 1) + 1,
      active: false,
      weights,
      topK,
      fusionMode: activeProfile.fusionMode || "reciprocal_rank",
      reranker: activeProfile.reranker || {},
      thresholds: activeProfile.thresholds || {},
      metrics: activeProfile.metrics || {},
      provenance: {
        proposedBy: "deterministic-profile-proposal",
        causes: [...causes]
      }
    },
    autoPublishRisk: causes.has("semantic_mismatch") || causes.has("evidence_conflict") ? "medium" : "low"
  };
}

function deterministicHierarchyReview(input = {}) {
  const audit = asObject(input.audit || input.hierarchyAudit);
  const findings = asArray(audit.findings);
  return {
    suggestions: findings.map((finding, index) => ({
      suggestionId: finding.suggestionId || `hierarchy-suggestion-${index + 1}`,
      type: finding.suggestionType || "hierarchyReview",
      confidence: finding.confidence || 0.62,
      proposedPatch: finding.proposedPatch || {
        findingCode: finding.code,
        action: finding.recommendedAction || "review_hierarchy"
      },
      evidenceRefs: asArray(finding.evidenceRefs),
      status: "pending"
    })),
    verdict: findings.length ? "needs_review" : "healthy"
  };
}

function deterministicHierarchyTreeRouter(input = {}) {
  const query = normalizeText(input.query || input.q || "");
  const queryTokens = tokenize(query).filter((token) => !/^\d+$/.test(token));
  const tree = asArray(input.nodes || input.compactTree || input.tree);
  const scored = tree
    .map((node) => {
      const text = normalizeText([
        node.title,
        node.summary,
        node.nodeType,
        node.documentId,
        node.sectionId,
        JSON.stringify(node.sourceRange || {})
      ].filter(Boolean).join(" "));
      const score = queryTokens.length ? tokenOverlap(queryTokens.join(" "), text) : 0;
      return {
        nodeId: normalizeText(node.nodeId || node.hierarchyId || node.targetId),
        targetId: normalizeText(node.targetId || ""),
        title: normalizeText(node.title || ""),
        score
      };
    })
    .filter((node) => node.nodeId && node.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  return {
    selectedNodeIds: scored.map((node) => node.nodeId),
    nodeScores: Object.fromEntries(scored.map((node) => [node.nodeId, Number(node.score.toFixed(6))])),
    reason: scored.length
      ? "deterministic compact tree token overlap"
      : "no compact tree node matched query terms",
    confidence: scored.length ? Number(scored[0].score.toFixed(6)) : 0,
    notes: ["deterministic fallback; no model output was used"]
  };
}

function deterministicKnowledgeSkillDistillation(input = {}) {
  const fallbackSkill = asObject(input.fallbackSkill);
  const evidenceItems = normalizeEvidenceItems({
    evidenceItems: input.evidenceItems
  });
  const query = normalizeText(input.query || fallbackSkill.sourceQuery || "");
  return {
    skill: {
      ...fallbackSkill,
      title: normalizeText(fallbackSkill.title || query),
      summary: normalizeText(fallbackSkill.summary),
      evidenceRefs: asArray(fallbackSkill.evidenceRefs).length
        ? fallbackSkill.evidenceRefs
        : evidenceItems.map((item) => item.evidenceId).filter(Boolean)
    },
    notes: ["deterministic fallback; no model output was used"]
  };
}

function deterministicRawBatchExtraction(input = {}) {
  const batch = asObject(input.batch);
  const documents = asArray(batch.documents);
  const coreFindings = documents.slice(0, 12).map((document, index) => {
    const body = normalizeText(document.text || document.snippet || "");
    return {
      findingId: `batch_${batch.batchNumber || 1}_finding_${index + 1}`,
      statement: body
        ? `${normalizeText(document.title || `Document ${index + 1}`)}：${body.slice(0, 240)}`
        : normalizeText(document.title || `Document ${index + 1}`),
      importance: index === 0 ? "primary" : "supporting",
      confidence: 0.55,
      citations: [normalizeText(document.title || document.sourceLocator?.sourcePath || "")].filter(Boolean)
    };
  });
  return {
    summary: `批次 ${batch.batchNumber || 1} 覆盖 ${Number(batch.documentCount || documents.length)} 份材料，形成 ${coreFindings.length} 条候选核心点。`,
    coreFindings,
    sourceCoverage: {
      batchNumber: Number(batch.batchNumber || 1),
      documentCount: Number(batch.documentCount || documents.length),
      characterCount: Number(batch.characterCount || 0),
      modelCharacterCount: Number(batch.modelCharacterCount || 0),
      truncatedForModel: batch.truncatedForModel === true
    },
    risks: batch.truncatedForModel === true ? ["batch_text_truncated_for_model_budget"] : [],
    notes: ["deterministic fallback; no model output was used"]
  };
}

function deterministicGoldRuleApplication(input = {}) {
  const goldenRule = asObject(input.goldenRule || input.goldenRuleDecision);
  return {
    decision: goldenRule.decision || "needs_human_review",
    selectedRuleId: goldenRule.selectedRule?.ruleId || "",
    confidence: goldenRule.ok === true ? 0.72 : 0.62,
    notes: ["deterministic fallback; golden rule runtime remains the authority"]
  };
}

function deterministicSkillReview(input = {}) {
  const quality = asObject(input.qualityReportV2 || input.qualityReport);
  const goldenRule = asObject(input.goldenRule);
  const evidenceGate = asObject(input.evidenceGate);
  const decision =
    goldenRule.decision === "auto_reject"
      ? "auto_reject"
      : evidenceGate.decision === "needs_review" || goldenRule.decision === "needs_human_review"
        ? "needs_human_review"
        : quality.passed === true
          ? "canary_allowed"
          : "needs_human_review";
  return {
    decision,
    confidence: decision === "canary_allowed" ? 0.7 : 0.6,
    reasons: [
      goldenRule.selectedRule?.reason || goldenRule.selectedRule?.label || "",
      evidenceGate.decision ? `evidence_gate:${evidenceGate.decision}` : "",
      quality.passed === false ? "quality_report_not_passed" : ""
    ].filter(Boolean)
  };
}

function deterministicTopicClusterName(input = {}) {
  const cluster = asObject(input.cluster);
  const terms = asArray(cluster.terms)
    .map((item) => normalizeText(item.term || item))
    .filter(Boolean)
    .slice(0, 4);
  return {
    title: terms.join(" ") || normalizeText(cluster.label || input.query || "knowledge topic"),
    confidence: terms.length ? 0.66 : 0.45,
    notes: ["deterministic fallback; no model output was used"]
  };
}

function deterministicGoldCaseBuild(input = {}) {
  const skill = asObject(input.skill);
  const query = normalizeText(input.query || skill.sourceQuery || skill.title || "");
  return {
    query,
    expectedSkillId: normalizeText(skill.skillId || input.skillId || ""),
    requiredEvidenceIds: asArray(input.evidenceRefs || skill.evidenceRefs || skill.skill?.evidenceRefs).map(String).filter(Boolean),
    answerRubric: normalizeText(input.answerRubric || skill.summary || ""),
    tags: ["golden", "human-expert"],
    source: "deterministic-gold-case-build"
  };
}

function deterministicRuleAuthoringIntent(input = {}) {
  const fallback = asObject(input.fallbackIntent);
  if (Object.keys(fallback).length) {
    return fallback;
  }
  const templates = asArray(input.templates);
  const message = normalizeText(input.message || input.query || "");
  const scored = templates
    .map((template) => {
      const keywords = asArray(template.intentKeywords);
      const score = keywords.filter((keyword) =>
        message.toLowerCase().includes(normalizeText(keyword).toLowerCase())
      ).length;
      return {
        templateId: normalizeText(template.templateId),
        score
      };
    })
    .filter((item) => item.templateId)
    .sort((left, right) => right.score - left.score);
  const best = scored[0] || null;
  return {
    needsRule: Boolean(best && best.score > 0),
    intent: best && best.score > 0 ? "golden_rule_authoring" : "none",
    templateId: best && best.score > 0 ? best.templateId : "",
    confidence: best && best.score > 0 ? Math.min(0.9, 0.5 + best.score * 0.1) : 0.35,
    reason: best && best.score > 0 ? "matched template intent keywords" : "no template keyword matched"
  };
}

function deterministicGoldenRuleGeneration(input = {}) {
  const template = asObject(input.template);
  return {
    templateId: normalizeText(template.templateId || input.templateId || ""),
    variables: {},
    notes: ["deterministic fallback; runtime fills template variables and gate validates the package"]
  };
}

function fallbackDecision(roleId, input) {
  if (roleId === "query_rewriter") {
    return deterministicQueryRewrite(input);
  }
  if (roleId === "failure_attributor") {
    return deterministicFailureAttribution(input);
  }
  if (roleId === "evidence_entailment_judge") {
    return deterministicEntailment(input);
  }
  if (roleId === "semantic_entailment_judge") {
    return deterministicEntailment(input);
  }
  if (roleId === "conflict_explainer") {
    return deterministicConflictSummary(input);
  }
  if (roleId === "profile_proposer") {
    return deterministicProfileProposal(input);
  }
  if (roleId === "hierarchy_quality_reviewer") {
    return deterministicHierarchyReview(input);
  }
  if (roleId === "hierarchy_tree_router") {
    return deterministicHierarchyTreeRouter(input);
  }
  if (roleId === "knowledge_skill_distiller") {
    return deterministicKnowledgeSkillDistillation(input);
  }
  if (roleId === "knowledge_raw_batch_extractor") {
    return deterministicRawBatchExtraction(input);
  }
  if (roleId === "gold_rule_applier") {
    return deterministicGoldRuleApplication(input);
  }
  if (roleId === "skill_reviewer") {
    return deterministicSkillReview(input);
  }
  if (roleId === "topic_cluster_namer") {
    return deterministicTopicClusterName(input);
  }
  if (roleId === "gold_case_builder") {
    return deterministicGoldCaseBuild(input);
  }
  if (roleId === "rule_authoring_intent") {
    return deterministicRuleAuthoringIntent(input);
  }
  if (roleId === "golden_rule_generator") {
    return deterministicGoldenRuleGeneration(input);
  }
  return {
    verdict: "unsupported_role",
    roleId
  };
}

function buildPrompt(role, input) {
  return [
    "You are a Pact knowledge-base decision helper.",
    "Return only compact JSON. Do not rewrite facts. Do not make canonical knowledge mutations.",
    `Role: ${role.roleId}`,
    `Purpose: ${role.purpose}`,
    `Input JSON: ${JSON.stringify(input)}`
  ].join("\n");
}

export function createModelDecisionRuntime({
  roleProfiles = [],
  agentGatewayCall = null
} = {}) {
  let profiles = mergeRoleProfiles(roleProfiles);

  function describe() {
    return {
      protocolVersion: MODEL_DECISION_PROTOCOL_VERSION,
      explicitModelEnableRequired: true,
      noImplicitDownloads: true,
      defaultFallback: "deterministic-auditable",
      roles: profiles.map((role) => ({
        ...role,
        configured: Boolean(agentGatewayCall && role.modelAlias)
      }))
    };
  }

  function resolveRole(roleId) {
    const normalized = String(roleId || "").trim();
    return profiles.find((role) => role.roleId === normalized) || profiles[0];
  }

  async function decide(input = {}) {
    const role = resolveRole(input.roleId || input.role);
    const payload = asObject(input.input || input.payload || input);
    const modelAlias = String(input.modelAlias || payload.modelAlias || role.modelAlias || "").trim();
    const budget = {
      ...(role.budget || {}),
      ...(input.budget || payload.budget || {})
    };
    const estimatedInputTokens = estimateTokens(payload);
    const budgetReport = {
      estimatedInputTokens,
      maxInputTokens: Number(budget.maxInputTokens || 0),
      maxOutputTokens: Number(budget.maxOutputTokens || 0),
      withinInputBudget: !budget.maxInputTokens || estimatedInputTokens <= Number(budget.maxInputTokens || 0)
    };
    const modelEnabled = input.modelEnabled === true || payload.modelEnabled === true;
    const auditBase = {
      roleId: role.roleId,
      modelAlias,
      inputHash: hashText(JSON.stringify(payload)),
      promptHash: hashText(buildPrompt(role, payload)),
      budgetReport
    };

    if (modelEnabled && agentGatewayCall && modelAlias && budgetReport.withinInputBudget) {
      try {
        const result = await agentGatewayCall({
          modelAlias,
          moduleId: input.moduleId || payload.moduleId || "agentTools",
          taskId: input.taskId || payload.taskId || "",
          sessionId: input.sessionId || payload.sessionId || "",
          question: buildPrompt(role, payload),
          modelRouting: {
            ...(payload.modelRouting || input.modelRouting || {}),
            enabled: true,
            routeId: String(
              payload.modelRouting?.routeId ||
                input.modelRouting?.routeId ||
                input.routeId ||
                payload.routeId ||
                `model-decision.${role.roleId}`
            ),
            promptVersion: String(
              payload.promptVersion ||
                input.promptVersion ||
                payload.modelRouting?.promptVersion ||
                input.modelRouting?.promptVersion ||
                `role:${role.roleId}`
            ),
            fallbackChain: uniqueStrings([
              modelAlias,
              ...asArray(payload.fallbackChain || input.fallbackChain),
              ...asArray(payload.modelRouting?.fallbackChain || input.modelRouting?.fallbackChain)
            ]),
            budget: {
              ...(payload.modelRouting?.budget || input.modelRouting?.budget || {}),
              maxInputTokens: Number(budget.maxInputTokens || 0),
              maxOutputTokens: Number(budget.maxOutputTokens || 0),
              maxEstimatedTotalTokens: Number(budget.maxInputTokens || 0) + Number(budget.maxOutputTokens || 0)
            }
          },
          parameters: {
            response_format: { type: "json_object" },
            max_tokens: Number(budget.maxOutputTokens || 800)
          }
        });
        const parsed = tryParseJson(result?.answer || result?.text || "");
        return {
          protocolVersion: MODEL_DECISION_PROTOCOL_VERSION,
          roleId: role.roleId,
          usedModel: true,
          degraded: false,
          decision: parsed || { rawText: result?.answer || result?.text || "" },
          audit: {
            ...auditBase,
            outputHash: hashText(result?.answer || result?.text || ""),
            upstream: result?.upstream || null
          }
        };
      } catch (error) {
        return {
          protocolVersion: MODEL_DECISION_PROTOCOL_VERSION,
          roleId: role.roleId,
          usedModel: false,
          degraded: true,
          decision: fallbackDecision(role.roleId, payload),
          audit: {
            ...auditBase,
            fallback: role.fallback,
            fallbackReason: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    return {
      protocolVersion: MODEL_DECISION_PROTOCOL_VERSION,
      roleId: role.roleId,
      usedModel: false,
      degraded: modelEnabled && !budgetReport.withinInputBudget,
      decision: fallbackDecision(role.roleId, payload),
      audit: {
        ...auditBase,
        fallback: role.fallback,
        fallbackReason: modelEnabled
          ? budgetReport.withinInputBudget
            ? "agent_gateway_not_configured_or_role_missing_alias"
            : "input_over_budget"
          : "model_not_explicitly_enabled"
      }
    };
  }

  return {
    protocolVersion: MODEL_DECISION_PROTOCOL_VERSION,
    describe,
    decide,
    setRoleProfiles(nextProfiles = []) {
      profiles = mergeRoleProfiles(nextProfiles);
      return describe();
    }
  };
}

export default createModelDecisionRuntime;
