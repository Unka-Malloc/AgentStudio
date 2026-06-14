import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const GOLDEN_RULE_PROTOCOL_VERSION = "v0.0.1:knowledge:golden-rule-1";
export const DEFAULT_GOLDEN_RULE_PACKAGE_ID = "default-golden-rules";

function nowIso() {
  return new Date().toISOString();
}

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

function stableHash(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\n"))
    .digest("hex");
}

function stableId(prefix, ...parts) {
  return `${prefix}_${stableHash(prefix, ...parts).slice(0, 24)}`;
}

function normalizePackageId(value) {
  const normalized = normalizeText(value || DEFAULT_GOLDEN_RULE_PACKAGE_ID)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_GOLDEN_RULE_PACKAGE_ID;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(text);
  }
  return output;
}

function defaultRules() {
  return [
    {
      ruleId: "golden_rule_no_evidence_auto_reject",
      label: "无证据自动拒绝",
      priority: 100,
      targetTypes: ["knowledgeSkill", "knowledgeSkillSet", "goldenRulePackage", "taxonomyPackage", "expertVocabularyPackage"],
      when: { evidenceCountLessThan: 1 },
      action: "auto_reject",
      reason: "候选没有可解析 evidenceRefs，不能进入自动发布链路。"
    },
    {
      ruleId: "golden_rule_canonical_mutation_review",
      label: "权威知识变更必须人工审核",
      priority: 95,
      targetTypes: ["*"],
      when: {
        forbiddenFieldsPresent: [
          "canonicalPatch",
          "entityPatch",
          "relationPatch",
          "taxonomyPatch",
          "rawEvidencePatch",
          "normalizedTextPatch"
        ]
      },
      action: "needs_human_review",
      reason: "涉及 canonical fact/entity/relation/taxonomy/raw evidence 变更，智能体不能直接通过。"
    },
    {
      ruleId: "golden_rule_semantic_unsupported_auto_reject",
      label: "语义不支持自动拒绝",
      priority: 90,
      targetTypes: ["knowledgeSkill", "knowledgeSkillSet"],
      when: { semanticVerdict: "unsupported" },
      action: "auto_reject",
      reason: "候选结论未被引用证据语义支持。"
    },
    {
      ruleId: "golden_rule_conflict_human_review",
      label: "冲突证据人工审核",
      priority: 85,
      targetTypes: ["*"],
      when: { evidenceGateDecision: "needs_review" },
      action: "needs_human_review",
      reason: "证据存在冲突或需要人工裁决。"
    },
    {
      ruleId: "golden_rule_quality_failed_review",
      label: "质量门禁失败待审",
      priority: 75,
      targetTypes: ["knowledgeSkill", "knowledgeSkillSet"],
      when: { qualityPassed: false },
      action: "needs_human_review",
      reason: "结构、证据或层级质量不足，不能自动发布。"
    },
    {
      ruleId: "golden_rule_low_risk_skillset_canary",
      label: "低风险 SkillSet 允许灰度",
      priority: 20,
      targetTypes: ["knowledgeSkill", "knowledgeSkillSet"],
      when: {
        evidenceGateOk: true,
        qualityPassed: true,
        canonicalMutationAbsent: true
      },
      action: "canary_allowed",
      reason: "候选只影响可回滚 Skill/检索辅助能力，并通过证据与质量门禁。"
    }
  ];
}

function createDefaultPackage() {
  const timestamp = nowIso();
  return {
    protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
    schemaVersion: "v0.0.1:schema:definition-1",
    packageId: DEFAULT_GOLDEN_RULE_PACKAGE_ID,
    version: 1,
    status: "active",
    source: "builtin-default",
    scope: {
      targets: ["knowledgeSkill", "knowledgeSkillSet", "retrievalProfile", "taxonomyPackage", "expertVocabularyPackage", "contextProfile"]
    },
    automationPolicy: {
      humanReviewIsFinalAuthority: true,
      agentMayTriage: true,
      canonicalMutationRequiresReview: true,
      canaryBeforeActive: true
    },
    rules: defaultRules(),
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function packageDir(rootPath, packageId) {
  return path.join(rootPath, "packages", normalizePackageId(packageId));
}

function manifestPath(rootPath, packageId) {
  return path.join(packageDir(rootPath, packageId), "manifest.json");
}

function versionPath(rootPath, packageId, version) {
  return path.join(packageDir(rootPath, packageId), "versions", `v${Number(version || 1)}.json`);
}

function hasNestedField(value, field) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, field)) {
    return true;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && hasNestedField(child, field)) {
      return true;
    }
  }
  return false;
}

function candidateEvidenceCount(candidate = {}) {
  const refs = [
    ...asArray(candidate.evidenceRefs),
    ...asArray(candidate.skill?.evidenceRefs),
    ...asArray(candidate.candidate?.evidenceRefs)
  ].filter(Boolean);
  const reportCount = Number(candidate.qualityReport?.evidenceCount || candidate.qualityReportV2?.evidenceCoverage?.evidenceCount || 0);
  const gateCount = Number(candidate.evidenceGate?.metrics?.evidenceCount || 0);
  return Math.max(refs.length, reportCount, gateCount);
}

function semanticVerdict(candidate = {}) {
  return normalizeText(
    candidate.evidenceGate?.semanticSupport?.verdict ||
      candidate.qualityReportV2?.semanticSupport?.verdict ||
      candidate.semanticSupport?.verdict ||
      ""
  );
}

function qualityPassed(candidate = {}) {
  if (candidate.qualityReportV2?.passed !== undefined) {
    return candidate.qualityReportV2.passed === true;
  }
  if (candidate.qualityReport?.passed !== undefined) {
    return candidate.qualityReport.passed === true;
  }
  return undefined;
}

function canonicalMutationPresent(candidate = {}) {
  const fields = [
    "canonicalPatch",
    "entityPatch",
    "relationPatch",
    "taxonomyPatch",
    "rawEvidencePatch",
    "normalizedTextPatch"
  ];
  return fields.some((field) => hasNestedField(candidate, field));
}

function duplicateContext(candidate = {}) {
  const duplicate = asObject(
    candidate.duplicate ||
      candidate.deduplication ||
      candidate.qualityReportV2?.duplicate ||
      candidate.qualityReport?.duplicate ||
      candidate.existingMatch
  );
  const score = Number(
    duplicate.score ??
      duplicate.similarity ??
      duplicate.similarityScore ??
      duplicate.exactMatchScore ??
      duplicate.confidence ??
      0
  );
  const verdict = normalizeText(
    duplicate.verdict ||
      duplicate.mode ||
      duplicate.kind ||
      duplicate.matchType ||
      duplicate.decision ||
      ""
  ).toLowerCase();
  const matchedFields = uniqueStrings([
    ...asArray(duplicate.matchedFields),
    duplicate.sameSourceFingerprint === true ? "sourceFingerprint" : "",
    duplicate.sameNormalizedContentHash === true ? "normalizedContentHash" : "",
    duplicate.sameCanonicalHash === true ? "canonicalHash" : "",
    duplicate.sameEvidenceHash === true ? "evidenceHash" : ""
  ]);
  const exact =
    duplicate.exact === true ||
    duplicate.isExactDuplicate === true ||
    duplicate.sameCanonicalHash === true ||
    duplicate.sameNormalizedContentHash === true ||
    verdict === "exact" ||
    verdict === "exact_duplicate" ||
    score >= 1;
  return {
    ...duplicate,
    score,
    verdict,
    matchedFields,
    exact,
    existingId: normalizeText(duplicate.existingId || duplicate.existingItemId || duplicate.existingSkillId || ""),
    existingRevision: normalizeText(duplicate.existingRevision || "")
  };
}

function ruleTargetMatches(rule = {}, targetType = "") {
  const targets = asArray(rule.targetTypes);
  return !targets.length || targets.includes("*") || targets.includes(targetType);
}

function duplicateRuleMatches(whenDuplicate = {}, contextDuplicate = {}) {
  const condition = asObject(whenDuplicate);
  if (!Object.keys(condition).length) {
    return true;
  }
  if (condition.mode || condition.verdict || condition.matchType) {
    const expected = normalizeText(condition.mode || condition.verdict || condition.matchType).toLowerCase();
    const actual = normalizeText(contextDuplicate.verdict).toLowerCase();
    if (expected === "exact") {
      if (contextDuplicate.exact !== true && !["exact", "exact_duplicate"].includes(actual)) {
        return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  if (condition.exact !== undefined && contextDuplicate.exact !== Boolean(condition.exact)) {
    return false;
  }
  const minScore = condition.scoreAtLeast ?? condition.minScore ?? condition.similarityAtLeast;
  if (minScore !== undefined && !(Number(contextDuplicate.score || 0) >= Number(minScore))) {
    return false;
  }
  const allFields = uniqueStrings(condition.requireMatchedFieldsAll || condition.matchedFieldsAll);
  if (allFields.length && !allFields.every((field) => asArray(contextDuplicate.matchedFields).includes(field))) {
    return false;
  }
  const anyFields = uniqueStrings(condition.requireMatchedFieldsAny || condition.matchedFieldsAny);
  if (anyFields.length && !anyFields.some((field) => asArray(contextDuplicate.matchedFields).includes(field))) {
    return false;
  }
  if (condition.existingIdRequired !== undefined && Boolean(contextDuplicate.existingId) !== Boolean(condition.existingIdRequired)) {
    return false;
  }
  return true;
}

function ruleConditionMatches(rule = {}, context = {}) {
  const when = asObject(rule.when);
  if (when.evidenceCountLessThan !== undefined && !(context.evidenceCount < Number(when.evidenceCountLessThan))) {
    return false;
  }
  if (when.semanticVerdict && context.semanticVerdict !== when.semanticVerdict) {
    return false;
  }
  if (when.evidenceGateDecision && context.evidenceGateDecision !== when.evidenceGateDecision) {
    return false;
  }
  if (when.evidenceGateOk !== undefined && context.evidenceGateOk !== Boolean(when.evidenceGateOk)) {
    return false;
  }
  if (when.qualityPassed !== undefined && context.qualityPassed !== Boolean(when.qualityPassed)) {
    return false;
  }
  if (when.canonicalMutationAbsent !== undefined && context.canonicalMutationPresent === Boolean(when.canonicalMutationAbsent)) {
    return false;
  }
  if (when.exactDuplicate !== undefined && context.duplicate.exact !== Boolean(when.exactDuplicate)) {
    return false;
  }
  if (when.duplicateVerdict && context.duplicate.verdict !== normalizeText(when.duplicateVerdict).toLowerCase()) {
    return false;
  }
  if (when.duplicateScoreAtLeast !== undefined && !(Number(context.duplicate.score || 0) >= Number(when.duplicateScoreAtLeast))) {
    return false;
  }
  if (Object.keys(asObject(when.duplicate)).length && !duplicateRuleMatches(when.duplicate, context.duplicate)) {
    return false;
  }
  if (asArray(when.forbiddenFieldsPresent).length) {
    const present = asArray(when.forbiddenFieldsPresent).filter((field) => hasNestedField(context.candidate, field));
    if (!present.length) {
      return false;
    }
  }
  return true;
}

function buildRuleContext({ targetType = "", candidate = {}, evidenceGate = null } = {}) {
  return {
    targetType,
    candidate,
    evidenceCount: candidateEvidenceCount(candidate),
    semanticVerdict: semanticVerdict(candidate),
    evidenceGateDecision: normalizeText(candidate.evidenceGate?.decision || evidenceGate?.decision || ""),
    evidenceGateOk: (candidate.evidenceGate || evidenceGate)?.ok === true,
    qualityPassed: qualityPassed(candidate),
    canonicalMutationPresent: canonicalMutationPresent(candidate),
    duplicate: duplicateContext(candidate)
  };
}

function evaluateRulesInPackage({ pkg = {}, targetType = "knowledgeSkill", candidate = {}, evidenceGate = null } = {}) {
  const context = buildRuleContext({ targetType, candidate, evidenceGate });
  const matches = asArray(pkg.rules)
    .filter((rule) => rule.enabled !== false)
    .filter((rule) => ruleTargetMatches(rule, targetType))
    .filter((rule) => ruleConditionMatches(rule, context))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  const selected = matches[0] || {
    ruleId: "golden_rule_default_human_review",
    label: "默认人工审核",
    priority: 0,
    action: "needs_human_review",
    reason: "没有黄金规则明确允许自动处理。"
  };
  return {
    targetType,
    decision: selected.action,
    ok: ["canary_allowed", "auto_accept_low_risk", "skip_existing", "auto_skip"].includes(selected.action),
    selectedRule: selected,
    matchedRules: matches,
    context,
    recommendations: [selected.reason].filter(Boolean)
  };
}

function normalizePackage(input = {}, fallback = null) {
  const base = fallback || createDefaultPackage();
  const timestamp = nowIso();
  const packageId = normalizePackageId(input.packageId || base.packageId);
  const version = Math.max(1, Number(input.version || base.version || 1));
  return {
    protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
    schemaVersion: "v0.0.1:schema:definition-1",
    packageId,
    version,
    status: normalizeText(input.status || base.status || "draft") || "draft",
    source: normalizeText(input.source || base.source || "manual"),
    scope: asObject(input.scope || base.scope),
    automationPolicy: {
      ...asObject(base.automationPolicy),
      ...asObject(input.automationPolicy)
    },
    rules: asArray(input.rules || base.rules).map((rule, index) => ({
      ruleId: normalizeText(rule.ruleId || rule.id) || stableId("golden_rule", packageId, version, index, rule.label || rule.reason),
      label: normalizeText(rule.label || rule.name || `规则 ${index + 1}`),
      enabled: rule.enabled === undefined ? true : rule.enabled !== false,
      priority: Number(rule.priority ?? 0),
      targetTypes: uniqueStrings(rule.targetTypes || ["*"]),
      when: asObject(rule.when),
      action: normalizeText(rule.action || "needs_human_review"),
      reason: normalizeText(rule.reason || ""),
      severity: normalizeText(rule.severity || ""),
      description: normalizeText(rule.description || ""),
      owner: normalizeText(rule.owner || ""),
      tags: uniqueStrings(rule.tags || []),
      effect: asObject(rule.effect),
      audit: asObject(rule.audit),
      examples: asArray(rule.examples).slice(0, 20)
    })),
    createdAt: normalizeText(input.createdAt || base.createdAt || timestamp),
    updatedAt: timestamp,
    publishedAt: normalizeText(input.publishedAt || base.publishedAt || "")
  };
}

export function createGoldenRuleRuntime({ userDataPath, knowledgeCore = null } = {}) {
  const rootPath = path.join(userDataPath, "knowledge-golden");
  const goldCasesPath = path.join(rootPath, "gold-cases.json");

  async function ensureDefaultPackage() {
    const manifest = await readJson(manifestPath(rootPath, DEFAULT_GOLDEN_RULE_PACKAGE_ID), null);
    if (manifest) {
      return manifest;
    }
    const pkg = createDefaultPackage();
    await writeJson(versionPath(rootPath, pkg.packageId, pkg.version), pkg);
    const nextManifest = {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      schemaVersion: "v0.0.1:schema:definition-1",
      packageId: pkg.packageId,
      activeVersion: pkg.version,
      versions: [
        {
          version: pkg.version,
          status: "active",
          createdAt: pkg.createdAt,
          publishedAt: pkg.publishedAt
        }
      ]
    };
    await writeJson(manifestPath(rootPath, pkg.packageId), nextManifest);
    return nextManifest;
  }

  async function listRulePackages() {
    await ensureDefaultPackage();
    const packagesRoot = path.join(rootPath, "packages");
    let entries = [];
    try {
      entries = await fs.readdir(packagesRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifest = await readJson(path.join(packagesRoot, entry.name, "manifest.json"), null);
      if (manifest) {
        items.push(manifest);
      }
    }
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      items: items.sort((left, right) => String(left.packageId).localeCompare(String(right.packageId)))
    };
  }

  async function getRulePackage({ packageId = DEFAULT_GOLDEN_RULE_PACKAGE_ID, version = "" } = {}) {
    await ensureDefaultPackage();
    const normalizedPackageId = normalizePackageId(packageId);
    const manifest = await readJson(manifestPath(rootPath, normalizedPackageId), null);
    if (!manifest) {
      return null;
    }
    const selectedVersion = Number(version || manifest.activeVersion || 1);
    return readJson(versionPath(rootPath, normalizedPackageId, selectedVersion), null);
  }

  async function getActiveRulePackage() {
    return getRulePackage({ packageId: DEFAULT_GOLDEN_RULE_PACKAGE_ID });
  }

  async function saveRulePackage(input = {}) {
    const packageId = normalizePackageId(input.packageId || DEFAULT_GOLDEN_RULE_PACKAGE_ID);
    const manifest = await readJson(manifestPath(rootPath, packageId), null);
    const previousVersion = Math.max(0, ...asArray(manifest?.versions).map((item) => Number(item.version || 0)));
    const current = manifest?.activeVersion ? await getRulePackage({ packageId, version: manifest.activeVersion }) : createDefaultPackage();
    const pkg = normalizePackage(
      {
        ...input,
        packageId,
        version: Number(input.version || previousVersion + 1 || 1),
        status: input.status || "draft",
        publishedAt: ""
      },
      current
    );
    await writeJson(versionPath(rootPath, packageId, pkg.version), pkg);
    const nextManifest = {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      schemaVersion: "v0.0.1:schema:definition-1",
      packageId,
      activeVersion: Number(manifest?.activeVersion || 0),
      versions: [
        ...asArray(manifest?.versions).filter((item) => Number(item.version) !== pkg.version),
        {
          version: pkg.version,
          status: pkg.status,
          createdAt: pkg.createdAt,
          updatedAt: pkg.updatedAt,
          publishedAt: pkg.publishedAt
        }
      ].sort((left, right) => Number(left.version) - Number(right.version))
    };
    await writeJson(manifestPath(rootPath, packageId), nextManifest);
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      package: pkg,
      manifest: nextManifest
    };
  }

  async function publishRulePackage(input = {}) {
    const packageId = normalizePackageId(input.packageId || input.id || DEFAULT_GOLDEN_RULE_PACKAGE_ID);
    const manifest = await readJson(manifestPath(rootPath, packageId), null);
    if (!manifest) {
      return null;
    }
    const version = Number(input.version || manifest.activeVersion || 1);
    const pkg = await getRulePackage({ packageId, version });
    if (!pkg) {
      return null;
    }
    const published = {
      ...pkg,
      status: "active",
      updatedAt: nowIso(),
      publishedAt: nowIso()
    };
    await writeJson(versionPath(rootPath, packageId, version), published);
    const nextManifest = {
      ...manifest,
      schemaVersion: String(manifest.schemaVersion || "v0.0.1:schema:definition-1"),
      activeVersion: version,
      versions: asArray(manifest.versions).map((item) => ({
        ...item,
        status: Number(item.version) === version ? "active" : item.status === "active" ? "retired" : item.status,
        publishedAt: Number(item.version) === version ? published.publishedAt : item.publishedAt
      }))
    };
    await writeJson(manifestPath(rootPath, packageId), nextManifest);
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      package: published,
      manifest: nextManifest
    };
  }

  async function rollbackRulePackage(input = {}) {
    return publishRulePackage(input);
  }

  async function applyRules(input = {}) {
    const targetType = normalizeText(input.targetType || input.target || "knowledgeSkill");
    const candidate = asObject(input.candidate || input.skill || input);
    const pkg = await getRulePackage({
      packageId: input.packageId || DEFAULT_GOLDEN_RULE_PACKAGE_ID,
      version: input.version || ""
    }) || createDefaultPackage();
    const evaluated = evaluateRulesInPackage({
      pkg,
      targetType,
      candidate,
      evidenceGate: input.evidenceGate || null
    });
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      packageId: pkg.packageId,
      packageVersion: pkg.version,
      ...evaluated
    };
  }

  async function validateRulePackage(input = {}) {
    const rawPackage = asObject(input.package || input.rulePackage || input);
    const rawRules = asArray(rawPackage.rules);
    const pkg = normalizePackage(rawPackage, createDefaultPackage());
    const structuralChecks = [
      {
        checkId: "protocol_version",
        passed: rawPackage.protocolVersion === GOLDEN_RULE_PROTOCOL_VERSION,
        message: `protocolVersion 必须是 ${GOLDEN_RULE_PROTOCOL_VERSION}。`
      },
      {
        checkId: "package_id",
        passed: Boolean(rawPackage.packageId),
        message: "packageId 不能为空。"
      },
      {
        checkId: "rules_present",
        passed: rawRules.length > 0,
        message: "rules 至少需要一条规则。"
      },
      {
        checkId: "rule_actions",
        passed: rawRules.every((rule) => Boolean(rule.action)),
        message: "每条规则都必须包含 action。"
      },
      {
        checkId: "rule_conditions",
        passed: rawRules.every((rule) => Object.keys(asObject(rule.when)).length > 0),
        message: "每条规则都必须包含 when 条件。"
      }
    ];
    const scenarios = asArray(input.testScenarios || input.scenarios).map((scenario, index) => {
      const targetType = normalizeText(scenario.targetType || scenario.target || "knowledgeItem");
      const result = evaluateRulesInPackage({
        pkg,
        targetType,
        candidate: asObject(scenario.candidate || scenario.input || {}),
        evidenceGate: scenario.evidenceGate || null
      });
      const expectedDecision = normalizeText(scenario.expectedDecision || scenario.expectedAction || "");
      const passed =
        result.selectedRule.ruleId !== "golden_rule_default_human_review" &&
        (!expectedDecision || result.decision === expectedDecision);
      return {
        scenarioId: normalizeText(scenario.scenarioId || scenario.id || `scenario-${index + 1}`),
        targetType,
        expectedDecision,
        passed,
        result
      };
    });
    const passed =
      structuralChecks.every((check) => check.passed) &&
      (scenarios.length ? scenarios.every((scenario) => scenario.passed) : true);
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      ok: passed,
      package: pkg,
      checks: structuralChecks,
      scenarios,
      recommendations: [
        ...structuralChecks.filter((check) => !check.passed).map((check) => check.message),
        ...scenarios
          .filter((scenario) => !scenario.passed)
          .map((scenario) =>
            scenario.expectedDecision
              ? `场景 ${scenario.scenarioId} 未触发 ${scenario.expectedDecision}。`
              : `场景 ${scenario.scenarioId} 没有命中候选规则。`
          )
      ]
    };
  }

  async function readGoldCases() {
    const store = await readJson(goldCasesPath, null);
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      cases: asArray(store?.cases)
    };
  }

  async function writeGoldCases(cases = []) {
    const payload = {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      cases: asArray(cases).slice(-10000)
    };
    await writeJson(goldCasesPath, payload);
    return payload;
  }

  async function listGoldCases(input = {}) {
    const store = await readGoldCases();
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const tag = normalizeText(input.tag || "");
    const items = store.cases
      .filter((item) => !tag || asArray(item.tags).includes(tag))
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, limit);
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      items,
      count: items.length
    };
  }

  async function saveGoldCase(input = {}) {
    const source = asObject(input.case || input.goldCase || input);
    const timestamp = nowIso();
    const query = normalizeText(source.query || source.q || source.question || "");
    const caseId = normalizeText(source.caseId || source.id) || stableId(
      "gold_case",
      query,
      JSON.stringify(source.requiredEvidenceIds || source.evidenceRefs || []),
      source.expectedSkillId || ""
    );
    const item = {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      caseId,
      query,
      expectedCategory: normalizeText(source.expectedCategory || ""),
      expectedSkillId: normalizeText(source.expectedSkillId || source.skillId || ""),
      requiredEvidenceIds: uniqueStrings(source.requiredEvidenceIds || source.evidenceRefs || []),
      forbiddenEvidenceIds: uniqueStrings(source.forbiddenEvidenceIds || []),
      answerRubric: normalizeText(source.answerRubric || source.rubric || ""),
      tags: uniqueStrings([
        ...asArray(source.tags),
        source.humanExpert === false ? "" : "human-expert",
        source.gold === false ? "" : "golden"
      ]),
      expert: asObject(source.expert),
      source: normalizeText(source.source || "manual"),
      metadata: asObject(source.metadata),
      createdAt: normalizeText(source.createdAt || timestamp),
      updatedAt: timestamp
    };
    const store = await readGoldCases();
    const nextCases = [...store.cases.filter((entry) => entry.caseId !== caseId), item];
    await writeGoldCases(nextCases);
    if (knowledgeCore && typeof knowledgeCore.recordFeedback === "function" && query) {
      knowledgeCore.recordFeedback({
        feedbackId: stableId("feedback", "gold_case", caseId),
        query,
        action: "expert_feedback",
        evidenceId: item.requiredEvidenceIds[0] || "",
        context: {
          gold: true,
          humanExpert: true,
          caseId,
          evidenceRefs: item.requiredEvidenceIds,
          expectedSkillId: item.expectedSkillId
        }
      });
    }
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      goldCase: item
    };
  }

  async function saveGoldCaseFromSkillResolution(input = {}) {
    const skill = asObject(input.skill);
    return saveGoldCase({
      query: skill.sourceQuery || input.query || skill.title || "",
      expectedSkillId: skill.skillId || input.skillId || "",
      requiredEvidenceIds: asArray(skill.evidenceRefs || skill.skill?.evidenceRefs),
      answerRubric: skill.summary || "",
      source: "skill_review_resolution",
      tags: ["skill-review", normalizeText(input.action || input.resolution || "review")],
      metadata: {
        action: input.action || input.resolution || "",
        status: skill.status || "",
        qualityReport: skill.qualityReport || {}
      }
    });
  }

  async function exportTrainingSet(input = {}) {
    const taskTypes = uniqueStrings(input.taskTypes || [
      "query_rewrite",
      "evidence_judgment",
      "skill_generation",
      "answer_synthesis"
    ]);
    const store = await readGoldCases();
    const records = [];
    for (const goldCase of store.cases) {
      for (const taskType of taskTypes) {
        records.push({
          protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
          taskType,
          source: "gold_case",
          caseId: goldCase.caseId,
          input: {
            query: goldCase.query,
            evidenceRefs: goldCase.requiredEvidenceIds,
            forbiddenEvidenceRefs: goldCase.forbiddenEvidenceIds,
            expectedCategory: goldCase.expectedCategory
          },
          output: {
            expectedSkillId: goldCase.expectedSkillId,
            requiredEvidenceIds: goldCase.requiredEvidenceIds,
            answerRubric: goldCase.answerRubric
          },
          labels: {
            gold: true,
            humanExpert: true,
            tags: goldCase.tags
          },
          audit: {
            createdAt: goldCase.createdAt,
            updatedAt: goldCase.updatedAt,
            source: goldCase.source
          }
        });
      }
    }
    const outputDir = path.join(rootPath, "training-sets");
    const fileName = `gold-training-set-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    const filePath = path.join(outputDir, fileName);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    return {
      protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
      ok: true,
      filePath,
      fileName,
      recordCount: records.length,
      taskTypes,
      preview: records.slice(0, 5)
    };
  }

  return {
    protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
    listRulePackages,
    getRulePackage,
    getActiveRulePackage,
    saveRulePackage,
    publishRulePackage,
    rollbackRulePackage,
    applyRules,
    validateRulePackage,
    listGoldCases,
    saveGoldCase,
    saveGoldCaseFromSkillResolution,
    exportTrainingSet
  };
}

export default createGoldenRuleRuntime;
