export const EVIDENCE_GATE_PROTOCOL_VERSION = "v0.0.1:knowledge:evidence-gate-1";

const DEFAULT_THRESHOLDS = {
  minEvidence: 2,
  minSources: 1,
  minAverageScore: 0,
  requireHierarchy: true,
  requireCitationsForAnswer: true,
  maxUncitedClaims: 0,
  maxConflicts: 0,
  semanticSupportRequired: false,
  minSemanticSupportScore: 0.5,
  maxSemanticUnsupportedClaims: 0
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(asObject(value)).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === "") {
        return false;
      }
      if (Array.isArray(entry) && entry.length === 0) {
        return false;
      }
      if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0) {
        return false;
      }
      return true;
    })
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function sourceLocatorForItem(item = {}) {
  const rawItem = asObject(item);
  const nestedItem = asObject(rawItem.item);
  const source = asObject(
    rawItem.sourceLocator ||
      rawItem.source ||
      rawItem.locator ||
      nestedItem.sourceLocator ||
      nestedItem.source ||
      nestedItem.locator
  );
  const metadata = asObject(rawItem.metadata || nestedItem.metadata || source.metadata);
  const unifiedSource = asObject(
    source.unifiedSource ||
      metadata.unifiedSource ||
      rawItem.unifiedSource ||
      nestedItem.unifiedSource
  );
  const chatRef = compactObject({
    ...asObject(unifiedSource.chatRef),
    ...asObject(source.chatRef)
  });
  const fileRef = compactObject({
    ...asObject(unifiedSource.fileRef),
    ...asObject(source.fileRef)
  });
  return compactObject({
    documentId: firstText(source.documentId, rawItem.documentId, nestedItem.documentId, rawItem.itemId),
    sectionId: firstText(source.sectionId, rawItem.sectionId, nestedItem.sectionId),
    blockId: firstText(source.blockId, rawItem.blockId, nestedItem.blockId),
    assetId: firstText(source.assetId, rawItem.assetId, nestedItem.assetId),
    sourcePath: firstText(source.sourcePath, source.path, unifiedSource.sourcePath, rawItem.sourcePath, nestedItem.sourcePath),
    sourceId: firstText(source.sourceId, unifiedSource.sourceId, rawItem.sourceId, nestedItem.sourceId),
    batchId: firstText(source.batchId, unifiedSource.batchId, rawItem.batchId, nestedItem.batchId),
    sourceType: firstText(source.sourceType, unifiedSource.sourceType, rawItem.sourceType, nestedItem.sourceType),
    providerId: firstText(source.providerId, unifiedSource.providerId, chatRef.providerId, fileRef.providerId),
    externalId: firstText(source.externalId, unifiedSource.externalId, chatRef.externalId, fileRef.externalId),
    syncBatchId: firstText(source.syncBatchId, unifiedSource.syncBatchId, chatRef.syncBatchId, fileRef.syncBatchId),
    contentHash: firstText(source.contentHash, unifiedSource.contentHash, source.sha256, rawItem.contentHash),
    capturedAt: firstText(source.capturedAt, unifiedSource.capturedAt, rawItem.capturedAt),
    originalFileName: firstText(source.originalFileName, unifiedSource.originalFileName, fileRef.originalFileName),
    chatRef,
    fileRef
  });
}

function sourceKey(item = {}) {
  const source = sourceLocatorForItem(item);
  const hierarchy = asObject(item.hierarchy || item.item?.hierarchy);
  const chatRef = asObject(source.chatRef);
  const fileRef = asObject(source.fileRef);
  return [
    source.sourceType,
    source.providerId || chatRef.providerId || fileRef.providerId,
    source.externalId || chatRef.externalId || fileRef.externalId,
    source.syncBatchId || chatRef.syncBatchId || fileRef.syncBatchId,
    chatRef.workspaceId,
    chatRef.conversationId,
    chatRef.messageId,
    chatRef.threadTs,
    fileRef.storageRelativePath,
    source.contentHash || fileRef.contentHash,
    item.documentId || hierarchy.documentId || source.documentId || item.itemId,
    item.batchId || source.batchId,
    source.sourcePath || source.rawObjectId || "",
    hierarchy.sectionId || source.sectionId || ""
  ].filter(Boolean).join("::") || item.evidenceId || item.id || "";
}

function normalizeEvidenceItems(input = {}) {
  const searchItems = asArray(input.searchResult?.items);
  const evidenceItems = asArray(input.evidenceItems || input.evidence || input.evidenceCards);
  return [...searchItems, ...evidenceItems]
    .map((item, index) => ({
      evidenceId: String(item.evidenceId || item.id || item.ref || `evidence-${index + 1}`),
      title: item.title || item.what || "",
      claim: item.claim || item.snippet || item.summary || item.title || "",
      score: Number(item.score || item.confidence || 0),
      sourceKey: sourceKey(item),
      sourceLocator: sourceLocatorForItem(item),
      hierarchy: item.hierarchy || null,
      item
    }))
    .filter((item) => item.evidenceId || item.claim);
}

function citationIds(input = {}) {
  const fromList = [
    ...asArray(input.citations),
    ...asArray(input.citationIds),
    ...asArray(input.answerCitations)
  ].map((item) => {
    if (typeof item === "string") {
      return item;
    }
    return item?.evidenceId || item?.id || item?.ref || "";
  });
  const fromAnswer = [...String(input.answer || input.content || "").matchAll(/\[([^\]\n]+)\]/g)]
    .map((match) => match[1])
    .filter(Boolean);
  return [...new Set([...fromList, ...fromAnswer].map((item) => String(item || "").trim()).filter(Boolean))];
}

function hierarchySelectedCount(searchResult = {}) {
  const selected = asObject(searchResult.hierarchy?.selected);
  return asArray(selected.collections).length + asArray(selected.documents).length + asArray(selected.sections).length;
}

function uncitedClaimLines(answer = "") {
  return String(answer || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[-*]\s+|^\d+[.)]\s+|^(结论|要点|风险|建议|事实)[:：]/.test(line))
    .filter((line) => !/\[[^\]]+\]/.test(line))
    .slice(0, 100);
}

function detectConflicts(evidenceItems = []) {
  const seen = new Map();
  const conflicts = [];
  for (const item of evidenceItems) {
    const claim = normalizeText(item.claim || item.title);
    if (!claim) {
      continue;
    }
    const negative = /不|未|没有|否认|取消|错误|失败|failed|fail|not|no/i.test(claim);
    const key = claim
      .replace(/不|未|没有|否认|取消|错误|失败|failed|fail|not|no/gi, "")
      .slice(0, 80)
      .toLowerCase();
    const previous = seen.get(key);
    if (previous && previous.negative !== negative) {
      conflicts.push({
        evidenceIds: [previous.evidenceId, item.evidenceId],
        claimA: previous.claim,
        claimB: claim
      });
    }
    if (!previous) {
      seen.set(key, {
        evidenceId: item.evidenceId,
        claim,
        negative
      });
    }
  }
  return conflicts;
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

function evidenceText(item = {}) {
  return normalizeText([
    item.claim,
    item.title,
    item.snippet,
    item.summary,
    item.text,
    item.item?.claim,
    item.item?.title,
    item.item?.snippet,
    item.item?.summary
  ].filter(Boolean).join(" "));
}

function answerClaimLines(answer = "") {
  return String(answer || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+|^\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 80);
}

function claimCitationIds(claim = "") {
  return [...String(claim || "").matchAll(/\[([^\]\n]+)\]/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function tokenOverlapScore(claim = "", evidence = "") {
  const claimTokens = tokenize(claim.replace(/\[[^\]]+\]/g, ""));
  if (!claimTokens.length) {
    return 1;
  }
  const evidenceTokens = new Set(tokenize(evidence));
  const evidenceLower = String(evidence || "").toLowerCase();
  const hitCount = claimTokens.filter((token) => evidenceTokens.has(token) || evidenceLower.includes(token)).length;
  return hitCount / claimTokens.length;
}

function normalizeSemanticJudgements(input = {}) {
  const source =
    input.semanticJudgement?.decision?.judgements ||
    input.semanticJudgement?.judgements ||
    input.semanticJudgements ||
    input.semanticSupport?.judgements ||
    [];
  return asArray(source).map((item) => ({
    claimId: String(item.claimId || item.id || ""),
    claim: normalizeText(item.claim || ""),
    citedEvidenceIds: asArray(item.citedEvidenceIds || item.evidenceIds).map(String),
    supported: item.supported === true || item.verdict === "supported",
    contradiction: item.contradiction === true || item.verdict === "contradiction",
    supportScore: Number(item.supportScore || item.score || 0),
    source: item.source || "model-or-external"
  }));
}

function evaluateSemanticSupport({ input = {}, evidenceItems = [], thresholds = {} } = {}) {
  const answer = String(input.answer || input.content || "");
  const claims = answerClaimLines(answer);
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidenceId, evidenceText(item)]));
  const externalJudgements = normalizeSemanticJudgements(input);
  const externalByClaim = new Map(
    externalJudgements
      .filter((item) => item.claim)
      .map((item) => [normalizeText(item.claim).toLowerCase(), item])
  );
  const externalByClaimId = new Map(
    externalJudgements
      .filter((item) => item.claimId)
      .map((item) => [item.claimId, item])
  );
  const minSupportScore = Number(thresholds.minSemanticSupportScore ?? DEFAULT_THRESHOLDS.minSemanticSupportScore);
  const judgements = claims.map((claim, index) => {
    const claimId = `claim-${index + 1}`;
    const external =
      externalByClaimId.get(claimId) ||
      externalByClaim.get(normalizeText(claim).toLowerCase());
    if (external) {
      return {
        claimId,
        claim,
        citedEvidenceIds: external.citedEvidenceIds.length ? external.citedEvidenceIds : claimCitationIds(claim),
        supportScore: Number(external.supportScore || 0),
        supported: external.supported,
        contradiction: external.contradiction,
        source: external.source
      };
    }
    const citedEvidenceIds = claimCitationIds(claim);
    const citedEvidence = citedEvidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    const supportScore = Number(Math.max(0, ...citedEvidence.map((text) => tokenOverlapScore(claim, text))).toFixed(6));
    const contradiction =
      citedEvidence.length > 0 &&
      /\bnot\b|\bno\b|\bcancel(?:led|ed|s|lation)?\b|\bterminate(?:d|s|ion)?\b|不|未|没有|否认|取消|终止|错误|失败/i.test(claim) &&
      citedEvidence.some((text) => !/\bnot\b|\bno\b|\bcancel(?:led|ed|s|lation)?\b|\bterminate(?:d|s|ion)?\b|不|未|没有|否认|取消|终止|错误|失败/i.test(text));
    return {
      claimId,
      claim,
      citedEvidenceIds,
      supportScore,
      supported: citedEvidence.length > 0 && supportScore >= minSupportScore && !contradiction,
      contradiction,
      source: "deterministic-token-overlap"
    };
  });
  const unsupportedClaims = judgements.filter((item) => !item.supported);
  const contradictoryClaims = judgements.filter((item) => item.contradiction);
  return {
    required: thresholds.semanticSupportRequired === true,
    minSupportScore,
    claimCount: judgements.length,
    supportedClaimCount: judgements.filter((item) => item.supported).length,
    unsupportedClaimCount: unsupportedClaims.length,
    contradictoryClaimCount: contradictoryClaims.length,
    judgements,
    unsupportedClaims,
    contradictoryClaims,
    verdict: judgements.length === 0 || unsupportedClaims.length === 0 ? "supported" : "unsupported"
  };
}

function recommendationForFailure(code) {
  const mapping = {
    insufficient_evidence: "扩大检索范围或增加 query rewrite，至少找到足够数量的证据。",
    insufficient_source_diversity: "优先补查其他文档、章节或来源，避免单一片段支撑结论。",
    weak_score: "提高召回质量，尝试更具体的实体、时间、金额或事务关键词。",
    hierarchy_not_selected: "必须先命中 collection/document/section 粗层候选，再读取细粒度证据。",
    missing_answer_citations: "回答前补充 evidence citation；没有引用的结论不能发布。",
    unsupported_claims: "删除或补证无引用结论。",
    conflicting_evidence: "存在冲突证据，应进入 Reviewer/ReviewItem，而不是自动合并。",
    semantic_unsupported_claims: "语义支持不足：用模型裁判/NLI 或人工审核复核引用是否真的支撑结论。"
  };
  return mapping[code] || "需要补查或人工审核。";
}

export function createEvidenceSufficiencyGate(options = {}) {
  const defaults = {
    ...DEFAULT_THRESHOLDS,
    ...asObject(options.thresholds)
  };

  function evaluate(input = {}) {
    const thresholds = {
      ...defaults,
      ...asObject(input.thresholds)
    };
    const evidenceItems = normalizeEvidenceItems(input);
    const evidenceIds = new Set(evidenceItems.map((item) => item.evidenceId).filter(Boolean));
    const citations = citationIds(input);
    const citedEvidenceCount = citations.filter((id) => evidenceIds.has(id)).length;
    const sources = new Set(evidenceItems.map((item) => item.sourceKey).filter(Boolean));
    const sourceTypes = new Set(evidenceItems.map((item) => item.sourceLocator.sourceType).filter(Boolean));
    const providerIds = new Set(evidenceItems.map((item) => item.sourceLocator.providerId).filter(Boolean));
    const syncBatchIds = new Set(evidenceItems.map((item) => item.sourceLocator.syncBatchId).filter(Boolean));
    const averageScore = evidenceItems.length
      ? evidenceItems.reduce((sum, item) => sum + Number(item.score || 0), 0) / evidenceItems.length
      : 0;
    const hierarchyCount = hierarchySelectedCount(input.searchResult || {});
    const conflicts = detectConflicts(evidenceItems);
    const uncitedClaims = uncitedClaimLines(input.answer || input.content || "");
    const semanticSupport = evaluateSemanticSupport({
      input,
      evidenceItems,
      thresholds
    });
    const failures = [];

    if (evidenceItems.length < Number(thresholds.minEvidence || 0)) {
      failures.push({
        code: "insufficient_evidence",
        actual: evidenceItems.length,
        expected: Number(thresholds.minEvidence || 0)
      });
    }
    if (sources.size < Number(thresholds.minSources || 0)) {
      failures.push({
        code: "insufficient_source_diversity",
        actual: sources.size,
        expected: Number(thresholds.minSources || 0)
      });
    }
    if (averageScore < Number(thresholds.minAverageScore || 0)) {
      failures.push({
        code: "weak_score",
        actual: Number(averageScore.toFixed(6)),
        expected: Number(thresholds.minAverageScore || 0)
      });
    }
    if (thresholds.requireHierarchy !== false && input.searchResult && hierarchyCount === 0) {
      failures.push({
        code: "hierarchy_not_selected",
        actual: hierarchyCount,
        expected: 1
      });
    }
    if (
      thresholds.requireCitationsForAnswer !== false &&
      String(input.answer || input.content || "").trim() &&
      citedEvidenceCount === 0
    ) {
      failures.push({
        code: "missing_answer_citations",
        actual: citedEvidenceCount,
        expected: 1
      });
    }
    if (uncitedClaims.length > Number(thresholds.maxUncitedClaims || 0)) {
      failures.push({
        code: "unsupported_claims",
        actual: uncitedClaims.length,
        expected: Number(thresholds.maxUncitedClaims || 0)
      });
    }
    if (conflicts.length > Number(thresholds.maxConflicts || 0)) {
      failures.push({
        code: "conflicting_evidence",
        actual: conflicts.length,
        expected: Number(thresholds.maxConflicts || 0)
      });
    }
    if (
      thresholds.semanticSupportRequired === true &&
      semanticSupport.unsupportedClaimCount > Number(thresholds.maxSemanticUnsupportedClaims || 0)
    ) {
      failures.push({
        code: "semantic_unsupported_claims",
        actual: semanticSupport.unsupportedClaimCount,
        expected: Number(thresholds.maxSemanticUnsupportedClaims || 0)
      });
    }

    const hasConflict = failures.some((item) => item.code === "conflicting_evidence");
    const decision = failures.length === 0
      ? "pass"
      : hasConflict
        ? "needs_review"
        : "needs_more_evidence";
    const answerability = decision === "pass"
      ? "answerable"
      : hasConflict
        ? "conflicting"
        : "not_enough_evidence";

    return {
      protocolVersion: EVIDENCE_GATE_PROTOCOL_VERSION,
      ok: decision === "pass",
      decision,
      answerability,
      metrics: {
        evidenceCount: evidenceItems.length,
        sourceCount: sources.size,
        sourceTypes: [...sourceTypes].sort(),
        providerIds: [...providerIds].sort(),
        syncBatchIds: [...syncBatchIds].sort(),
        citedEvidenceCount,
        citationCount: citations.length,
        averageScore: Number(averageScore.toFixed(6)),
        maxScore: Number(Math.max(0, ...evidenceItems.map((item) => item.score || 0)).toFixed(6)),
        hierarchySelectedCount: hierarchyCount,
        uncitedClaimCount: uncitedClaims.length,
        conflictCount: conflicts.length,
        semanticClaimCount: semanticSupport.claimCount,
        semanticSupportedClaimCount: semanticSupport.supportedClaimCount,
        semanticUnsupportedClaimCount: semanticSupport.unsupportedClaimCount,
        semanticContradictoryClaimCount: semanticSupport.contradictoryClaimCount
      },
      thresholds,
      failures,
      conflicts,
      uncitedClaims,
      semanticSupport,
      recommendations: [...new Set(failures.map((failure) => recommendationForFailure(failure.code)))]
    };
  }

  return {
    protocolVersion: EVIDENCE_GATE_PROTOCOL_VERSION,
    defaults,
    evaluate
  };
}

export default createEvidenceSufficiencyGate;
