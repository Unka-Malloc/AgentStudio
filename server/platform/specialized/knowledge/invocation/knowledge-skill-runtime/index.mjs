import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export const KNOWLEDGE_SKILL_PROTOCOL_VERSION = "v0.0.1:knowledge:skill-1";
export const AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION = "v0.0.1:knowledge:playbook-1";

const ENTITY_PLAYBOOK_FRAMEWORK_PATH = fileURLToPath(
  new URL("../../../../../config/entity-config/playbooks/knowledge-playbook-framework/framework.json", import.meta.url)
);
const ENTITY_DEFAULT_FRAMEWORK_PATH = fileURLToPath(
  new URL("../../../../../config/entity-config/skills/knowledge-skill-framework/framework.json", import.meta.url)
);
const DEFAULT_FRAMEWORK_PATHS = Object.freeze([ENTITY_PLAYBOOK_FRAMEWORK_PATH, ENTITY_DEFAULT_FRAMEWORK_PATH]);
const DEFAULT_STATUS = "pending_review";

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

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
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

function getKnowledgeCore(runtime) {
  const mount = runtime?.mounts?.knowledgeBase;
  if (!mount || mount.enabled === false) {
    return null;
  }
  return mount;
}

function tokenize(value, options = {}) {
  const minLength = Math.max(1, Number(options.minTokenLength || 2));
  const maxLength = Math.max(minLength, Number(options.maxTokenLength || 64));
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu) || []
    )
  ].filter((token) => token.length >= minLength && token.length <= maxLength);
}

function extractTerms(value, limit = 16, options = {}) {
  const stopWords = new Set(asArray(options.stopWords).map((item) => String(item).toLowerCase()));
  const counts = new Map();
  for (const token of tokenize(value, options)) {
    if (stopWords.has(token) || /^\d+$/.test(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function truncateText(value, maxLength = 800) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 18)).trim()}...[truncated]`;
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

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeSourceLocator(locator = {}, item = {}) {
  const rawLocator = asObject(locator);
  const rawItem = asObject(item);
  const payload = asObject(rawItem.payload);
  const document = asObject(payload.document || rawItem.document);
  const documentMetadata = asObject(document.metadata);
  const metadata = asObject(rawItem.metadata || rawLocator.metadata);
  const unifiedSource = asObject(
    rawLocator.unifiedSource ||
      metadata.unifiedSource ||
      documentMetadata.unifiedSource ||
      rawItem.unifiedSource
  );
  const chatRef = compactObject({
    ...asObject(unifiedSource.chatRef),
    ...asObject(rawLocator.chatRef)
  });
  const fileRef = compactObject({
    ...asObject(unifiedSource.fileRef),
    ...asObject(rawLocator.fileRef)
  });
  return compactObject({
    documentId: firstText(rawLocator.documentId, rawItem.documentId, rawItem.itemId, document.documentId),
    sectionId: firstText(rawLocator.sectionId, rawItem.sectionId),
    blockId: firstText(rawLocator.blockId, rawItem.blockId),
    assetId: firstText(rawLocator.assetId, rawItem.assetId),
    sourcePath: firstText(rawLocator.sourcePath, rawLocator.path, unifiedSource.sourcePath, rawItem.sourcePath, document.sourcePath),
    sourceId: firstText(rawLocator.sourceId, unifiedSource.sourceId, rawItem.sourceId, document.sourceId),
    batchId: firstText(rawLocator.batchId, unifiedSource.batchId, rawItem.batchId, rawItem.syncBatchId, document.batchId),
    sourceType: firstText(rawLocator.sourceType, unifiedSource.sourceType, rawItem.sourceType, rawItem.kind, document.documentType),
    providerId: firstText(rawLocator.providerId, unifiedSource.providerId, chatRef.providerId, fileRef.providerId),
    externalId: firstText(rawLocator.externalId, unifiedSource.externalId, chatRef.externalId, fileRef.externalId),
    syncBatchId: firstText(rawLocator.syncBatchId, unifiedSource.syncBatchId, chatRef.syncBatchId, fileRef.syncBatchId),
    contentHash: firstText(rawLocator.contentHash, unifiedSource.contentHash, rawLocator.sha256, document.sourceHash),
    capturedAt: firstText(rawLocator.capturedAt, unifiedSource.capturedAt, document.updatedAt, rawItem.capturedAt),
    originalFileName: firstText(rawLocator.originalFileName, unifiedSource.originalFileName, fileRef.originalFileName),
    chatRef,
    fileRef
  });
}

function sourceFingerprintForLocator(locator = {}) {
  const source = asObject(locator);
  const chatRef = asObject(source.chatRef);
  const fileRef = asObject(source.fileRef);
  const chatIdentity = [
    chatRef.workspaceId,
    chatRef.conversationId,
    chatRef.messageId,
    chatRef.threadTs || chatRef.replyThreadTs,
    chatRef.externalId
  ].filter(Boolean);
  if (source.sourceType === "chat" || chatIdentity.length > 0) {
    return `chat:${[
      source.providerId || chatRef.providerId,
      ...chatIdentity,
      source.externalId,
      source.syncBatchId || chatRef.syncBatchId
    ].filter(Boolean).join(":")}`;
  }
  const fileIdentity = [
    fileRef.externalId,
    fileRef.storageRelativePath,
    source.originalFileName || fileRef.originalFileName,
    source.contentHash || fileRef.contentHash
  ].filter(Boolean);
  if (source.sourceType === "file" || Object.keys(fileRef).length > 0 || fileIdentity.length > 0) {
    return `file:${[
      source.providerId || fileRef.providerId,
      source.sourceType === "file" ? source.externalId : "",
      ...fileIdentity,
      source.syncBatchId || fileRef.syncBatchId
    ].filter(Boolean).join(":")}`;
  }
  return [
    source.sourceType,
    source.providerId,
    source.externalId,
    source.syncBatchId,
    source.contentHash,
    source.sourcePath,
    source.documentId,
    source.sectionId,
    source.blockId,
    source.assetId
  ].filter(Boolean).join(":") || "unknown-source";
}

function citationForEvidenceItem(item = {}) {
  return compactObject({
    evidenceId: normalizeText(item.evidenceId || item.id || ""),
    documentId: normalizeText(item.documentId || item.itemId || ""),
    title: normalizeText(item.title || ""),
    snippet: truncateText(item.snippet || item.summary || item.text || "", 420),
    source: normalizeSourceLocator(item.sourceLocator || item.source || item.locator || {}, item)
  });
}

function sourceTraceForEvidenceItems(items = []) {
  const bySource = new Map();
  for (const item of asArray(items)) {
    const locator = normalizeSourceLocator(item.sourceLocator || item.source || item.locator || {}, item);
    const key = sourceFingerprintForLocator(locator);
    const previous = bySource.get(key) || {
      sourceKey: key,
      sourceType: locator.sourceType || "",
      providerId: locator.providerId || "",
      externalId: locator.externalId || "",
      syncBatchId: locator.syncBatchId || "",
      sourcePath: locator.sourcePath || "",
      originalFileName: locator.originalFileName || "",
      documentIds: [],
      evidenceRefs: [],
      chatRef: locator.chatRef || undefined,
      fileRef: locator.fileRef || undefined
    };
    if (locator.documentId && !previous.documentIds.includes(locator.documentId)) {
      previous.documentIds.push(locator.documentId);
    }
    if (item.evidenceId && !previous.evidenceRefs.includes(item.evidenceId)) {
      previous.evidenceRefs.push(item.evidenceId);
    }
    bySource.set(key, compactObject(previous));
  }
  const sources = [...bySource.values()].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return {
    evidenceRefs: uniqueEvidenceRefs(items),
    citations: asArray(items).map(citationForEvidenceItem).filter((item) => item.evidenceId),
    sourceCount: sources.length,
    sourceTypes: [...new Set(sources.map((item) => item.sourceType).filter(Boolean))].sort(),
    providerIds: [...new Set(sources.map((item) => item.providerId).filter(Boolean))].sort(),
    syncBatchIds: [...new Set(sources.map((item) => item.syncBatchId).filter(Boolean))].sort(),
    sources
  };
}

function compactEvidenceItem(item = {}, index = 0) {
  const sourceLocator = normalizeSourceLocator(item.sourceLocator || item.source || item.locator || {}, item);
  return {
    rank: index + 1,
    evidenceId: String(item.evidenceId || item.id || ""),
    itemId: String(item.itemId || item.documentId || sourceLocator.documentId || ""),
    documentId: String(item.documentId || item.itemId || sourceLocator.documentId || ""),
    title: normalizeText(item.title || ""),
    snippet: truncateText(item.snippet || item.summary || item.text || "", 900),
    score: Number(item.score || item.finalScore || item.relevanceScore || 0),
    hierarchy: item.hierarchy || null,
    sourceLocator,
    sourceKey: sourceFingerprintForLocator(sourceLocator),
    modalities: asArray(item.modalities),
    reasons: asArray(item.reasons).slice(0, 6)
  };
}

function compactOpenedEvidence(evidence = {}) {
  const payload = asObject(evidence.payload);
  const document = asObject(payload.document || evidence.document);
  const sourceLocator = normalizeSourceLocator(evidence.locator || evidence.sourceLocator || {}, {
    ...evidence,
    document
  });
  const blocks = asArray(payload.blocks || evidence.blocks)
    .slice(0, 4)
    .map((block) => truncateText(block.text || block.snippet || block.summary || "", 1200))
    .filter(Boolean);
  return {
    evidenceId: String(evidence.evidenceId || ""),
    title: normalizeText(evidence.title || document.title || ""),
    snippet: truncateText(evidence.snippet || "", 800),
    documentId: String(document.documentId || ""),
    documentType: String(document.documentType || ""),
    sourcePath: String(sourceLocator.sourcePath || document.sourcePath || ""),
    sourceLocator,
    locator: sourceLocator,
    text: truncateText(blocks.join("\n\n"), 2400)
  };
}

function uniqueEvidenceRefs(items = []) {
  return [
    ...new Set(
      asArray(items)
        .map((item) => String(item.evidenceId || item.id || "").trim())
        .filter(Boolean)
    )
  ];
}

function distinctDocumentIds(items = []) {
  return [
    ...new Set(
      asArray(items)
        .map((item) => String(item.documentId || item.itemId || "").trim())
        .filter(Boolean)
    )
  ];
}

function hydrateSkill(row) {
  if (!row) {
    return null;
  }
  return withPlaybookAliases({
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    skillId: row.skill_id,
    version: Number(row.version || 1),
    status: row.status,
    title: row.title,
    sourceQuery: row.source_query,
    scope: parseJson(row.scope_json, {}),
    summary: row.summary,
    skill: parseJson(row.skill_json, {}),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    qualityReport: parseJson(row.quality_json, {}),
    modelDecision: parseJson(row.model_decision_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  });
}

function hydratePlaybook(row) {
  if (!row) {
    return null;
  }
  return withPlaybookAliases({
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    skillId: row.legacy_skill_id || row.playbook_id,
    playbookId: row.playbook_id,
    legacySkillId: row.legacy_skill_id || row.playbook_id,
    version: Number(row.version || 1),
    status: row.status,
    title: row.title,
    sourceQuery: row.source_query,
    scope: parseJson(row.scope_json, {}),
    summary: row.summary,
    skill: parseJson(row.playbook_json || row.skill_json, {}),
    playbook: parseJson(row.playbook_json || row.skill_json, {}),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    qualityReport: parseJson(row.quality_json, {}),
    modelDecision: parseJson(row.model_decision_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  });
}

function withPlaybookAliases(skill = {}) {
  if (!skill) {
    return null;
  }
  const skillId = normalizeText(skill.skillId || skill.legacySkillId || skill.playbookId || "");
  const playbookId = normalizeText(skill.playbookId || skillId);
  const playbookPayload = asObject(skill.playbook || skill.skill);
  return {
    ...skill,
    protocolVersion: skill.protocolVersion || KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    skillId,
    playbookId,
    legacySkillId: normalizeText(skill.legacySkillId || skillId),
    skill: playbookPayload,
    playbook: playbookPayload
  };
}

function normalizeFramework(value = {}) {
  const raw = asObject(value);
  const gates = asObject(raw.qualityGates);
  const termExtraction = asObject(raw.termExtraction);
  const fallbackTemplates = asObject(raw.fallbackTemplates);
  const agentCreation = asObject(raw.agentCreation);
  return {
    schemaVersion: String(raw.schemaVersion || "v0.0.1:schema:definition-1"),
    frameworkId: normalizeText(raw.frameworkId || "pact.default-knowledge-skill-framework"),
    version: Number(raw.version || 1),
    layers: asArray(raw.layers),
    qualityGates: {
      minEvidence: Math.max(1, Number(gates.minEvidence || 2)),
      minDistinctDocuments: Math.max(1, Number(gates.minDistinctDocuments || 1)),
      requireCitations: gates.requireCitations !== false,
      requireHierarchy: gates.requireHierarchy !== false,
      minQualityScore: Math.max(0, Math.min(1, Number(gates.minQualityScore ?? 0.68)))
    },
    termExtraction: {
      minTokenLength: Math.max(1, Number(termExtraction.minTokenLength || 2)),
      maxTokenLength: Math.max(
        Math.max(1, Number(termExtraction.minTokenLength || 2)),
        Number(termExtraction.maxTokenLength || 64)
      ),
      stopWords: asArray(termExtraction.stopWords).map(normalizeText).filter(Boolean)
    },
    fallbackTemplates: {
      titleTemplate: normalizeText(fallbackTemplates.titleTemplate || "{{query}}"),
      summaryParts: asArray(fallbackTemplates.summaryParts).map(normalizeText).filter(Boolean),
      useWhen: asArray(fallbackTemplates.useWhen).map(normalizeText).filter(Boolean),
      avoidWhen: asArray(fallbackTemplates.avoidWhen).map(normalizeText).filter(Boolean),
      decisionHeuristics: asArray(fallbackTemplates.decisionHeuristics).map(normalizeText).filter(Boolean),
      honestBoundaries: asArray(fallbackTemplates.honestBoundaries).map(normalizeText).filter(Boolean),
      hierarchyStatus: {
        available: normalizeText(asObject(fallbackTemplates.hierarchyStatus).available || ""),
        missing: normalizeText(asObject(fallbackTemplates.hierarchyStatus).missing || "")
      }
    },
    agentCreation: {
      defaultStatus: normalizeText(agentCreation.defaultStatus || "pending_review") || "pending_review",
      autoPublishAllowed: agentCreation.autoPublishAllowed === true,
      allowedSourceTypes: asArray(agentCreation.allowedSourceTypes).map(normalizeText).filter(Boolean),
      requiredFields: asArray(agentCreation.requiredFields).map(normalizeText).filter(Boolean),
      blockedFields: asArray(agentCreation.blockedFields).map(normalizeText).filter(Boolean),
      reuseSignals: asArray(agentCreation.reuseSignals).map(normalizeText).filter(Boolean),
      recommendationMessages: {
        blockedCanonicalMutations: normalizeText(
          asObject(agentCreation.recommendationMessages).blockedCanonicalMutations || ""
        ),
        evidenceRefsResolved: normalizeText(asObject(agentCreation.recommendationMessages).evidenceRefsResolved || ""),
        sourceTypeAllowed: normalizeText(asObject(agentCreation.recommendationMessages).sourceTypeAllowed || ""),
        requiredFieldMissing: normalizeText(asObject(agentCreation.recommendationMessages).requiredFieldMissing || "")
      },
      reviewPolicy: normalizeText(agentCreation.reviewPolicy || "")
    },
    defaultHeuristicTemplates: asArray(raw.defaultHeuristicTemplates).map(normalizeText).filter(Boolean),
    defaultAntiPatterns: asArray(raw.defaultAntiPatterns).map(normalizeText).filter(Boolean),
    defaultBoundaryRules: asArray(raw.defaultBoundaryRules).map(normalizeText).filter(Boolean),
    verificationQuestionTemplates: asArray(raw.verificationQuestionTemplates).map(normalizeText).filter(Boolean)
  };
}

function safeEntityFileId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "entity";
}

function writeJsonFileSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function writeTextFileSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, value, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function knowledgeSkillBundleDirectory(rootPath, skillId) {
  return path.join(rootPath, "bundles", safeEntityFileId(skillId));
}

function agentLibraryPlaybookBundleDirectory(rootPath, playbookId) {
  return path.join(rootPath, "bundles", safeEntityFileId(playbookId));
}

function knowledgeSkillDependencies(skill = {}) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    dependencyType: "pact.knowledge-skill.dependencies",
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    runtimeModules: [
      "KnowledgeSkillRuntime",
      "KnowledgeAgentSkillRuntime",
      "EvidenceSufficiencyGate"
    ],
    requiredTools: [
      {
        toolId: "pact.agentLibrary.search",
        reason: "Retrieve coarse-to-fine evidence before applying the skill."
      },
      {
        toolId: "pact.agentLibrary.evidence",
        reason: "Open cited evidence references when validating or answering."
      },
      {
        toolId: "pact.agentLibrary.renderMarkdown",
        reason: "Render evidence packs into readable context when needed."
      }
    ],
    requiredProtocols: [
      "v0.0.1:knowledge:core-1",
      "v0.0.1:knowledge:agent-skill-1",
      KNOWLEDGE_SKILL_PROTOCOL_VERSION
    ],
    heavyDependencies: [],
    manifestOnlyDependencies: [],
    evidenceRefs: asArray(skill.evidenceRefs),
    scope: asObject(skill.scope)
  };
}

function playbookRecordFromSkill(skill = {}) {
  const normalized = withPlaybookAliases(skill);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    playbookId: normalized.playbookId,
    legacySkillId: normalized.legacySkillId,
    version: normalized.version,
    status: normalized.status,
    title: normalized.title,
    sourceQuery: normalized.sourceQuery,
    scope: normalized.scope,
    summary: normalized.summary,
    playbook: normalized.playbook,
    evidenceRefs: asArray(normalized.evidenceRefs),
    qualityReport: asObject(normalized.qualityReport),
    modelDecision: normalized.modelDecision || null,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    publishedAt: normalized.publishedAt || ""
  };
}

function writeAgentLibraryPlaybookBundle(rootPath, skill) {
  const playbook = playbookRecordFromSkill(skill);
  if (!playbook.playbookId) {
    return;
  }
  const bundleDir = agentLibraryPlaybookBundleDirectory(rootPath, playbook.playbookId);
  const dependencies = knowledgeSkillDependencies({
    ...skill,
    evidenceRefs: playbook.evidenceRefs
  });
  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    bundleType: "pact.agentlibrary-playbook.bundle",
    protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    playbookId: playbook.playbookId,
    legacySkillId: playbook.legacySkillId,
    version: playbook.version,
    status: playbook.status,
    title: playbook.title,
    sourceQuery: playbook.sourceQuery,
    lightweightBundle: true,
    files: {
      manifest: "manifest.json",
      playbook: "playbook.json",
      legacySkillProjection: "skill.json",
      dependencies: "dependencies.json",
      evidenceRefs: "evidence-refs.json",
      quality: "quality.json",
      readme: "README.md"
    },
    dependencySummary: {
      requiredToolCount: dependencies.requiredTools.length,
      evidenceRefCount: dependencies.evidenceRefs.length,
      heavyDependencyCount: dependencies.heavyDependencies.length,
      manifestOnlyDependencyCount: dependencies.manifestOnlyDependencies.length
    },
    createdAt: playbook.createdAt,
    updatedAt: playbook.updatedAt,
    publishedAt: playbook.publishedAt
  };
  writeJsonFileSync(path.join(bundleDir, "manifest.json"), manifest);
  writeJsonFileSync(path.join(bundleDir, "playbook.json"), playbook);
  writeJsonFileSync(path.join(bundleDir, "skill.json"), withPlaybookAliases(skill));
  writeJsonFileSync(path.join(bundleDir, "dependencies.json"), {
    ...dependencies,
    dependencyType: "pact.agentlibrary-playbook.dependencies",
    protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    legacyProtocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION
  });
  writeJsonFileSync(path.join(bundleDir, "evidence-refs.json"), {
    protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    playbookId: playbook.playbookId,
    legacySkillId: playbook.legacySkillId,
    evidenceRefs: asArray(playbook.evidenceRefs)
  });
  writeJsonFileSync(path.join(bundleDir, "quality.json"), {
    protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
    playbookId: playbook.playbookId,
    legacySkillId: playbook.legacySkillId,
    qualityReport: asObject(playbook.qualityReport),
    modelDecision: playbook.modelDecision || null
  });
  writeTextFileSync(
    path.join(bundleDir, "README.md"),
    [
      `# ${playbook.title || playbook.playbookId}`,
      "",
      `Playbook ID: \`${playbook.playbookId}\``,
      `Legacy Skill ID: \`${playbook.legacySkillId}\``,
      `Version: \`${playbook.version}\``,
      `Status: \`${playbook.status}\``,
      "",
      playbook.summary || "",
      "",
      "This is a lightweight Pact AgentLibrary Playbook bundle. The runnable tool contracts and local dependencies are declared in `dependencies.json`; large evidence payloads are referenced by id instead of being copied into the bundle.",
      ""
    ].join("\n")
  );
}

function writeKnowledgeSkillBundle(rootPath, skill) {
  if (!skill?.skillId) {
    return;
  }
  const bundleDir = knowledgeSkillBundleDirectory(rootPath, skill.skillId);
  const dependencies = knowledgeSkillDependencies(skill);
  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    bundleType: "pact.knowledge-skill.bundle",
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    skillId: skill.skillId,
    version: skill.version,
    status: skill.status,
    title: skill.title,
    sourceQuery: skill.sourceQuery,
    lightweightBundle: true,
    files: {
      manifest: "manifest.json",
      skill: "skill.json",
      dependencies: "dependencies.json",
      evidenceRefs: "evidence-refs.json",
      quality: "quality.json",
      readme: "README.md"
    },
    dependencySummary: {
      requiredToolCount: dependencies.requiredTools.length,
      evidenceRefCount: dependencies.evidenceRefs.length,
      heavyDependencyCount: dependencies.heavyDependencies.length,
      manifestOnlyDependencyCount: dependencies.manifestOnlyDependencies.length
    },
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    publishedAt: skill.publishedAt
  };
  writeJsonFileSync(path.join(bundleDir, "manifest.json"), manifest);
  writeJsonFileSync(path.join(bundleDir, "skill.json"), skill);
  writeJsonFileSync(path.join(bundleDir, "dependencies.json"), dependencies);
  writeJsonFileSync(path.join(bundleDir, "evidence-refs.json"), {
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    skillId: skill.skillId,
    evidenceRefs: asArray(skill.evidenceRefs)
  });
  writeJsonFileSync(path.join(bundleDir, "quality.json"), {
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    skillId: skill.skillId,
    qualityReport: asObject(skill.qualityReport),
    modelDecision: skill.modelDecision || null
  });
  writeTextFileSync(
    path.join(bundleDir, "README.md"),
    [
      `# ${skill.title || skill.skillId}`,
      "",
      `Skill ID: \`${skill.skillId}\``,
      `Version: \`${skill.version}\``,
      `Status: \`${skill.status}\``,
      "",
      skill.summary || "",
      "",
      "This is a lightweight Pact KnowledgeSkill bundle. The runnable tool contracts and local dependencies are declared in `dependencies.json`; large evidence payloads are referenced by id instead of being copied into the bundle.",
      ""
    ].join("\n")
  );
}

function renderTemplate(template, variables = {}) {
  return normalizeText(
    String(template || "").replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_match, key) =>
      String(variables[key] ?? "")
    )
  );
}

function renderTemplates(templates = [], variables = {}) {
  return asArray(templates)
    .map((template) => renderTemplate(template, variables))
    .filter(Boolean);
}

function normalizeTextArray(value, limit = 24) {
  return asArray(value)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeCoreConcepts(value = []) {
  return asArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return { term: normalizeText(item), weight: 1, evidenceRefs: [] };
      }
      const raw = asObject(item);
      return {
        term: normalizeText(raw.term || raw.label || raw.name),
        weight: Number(raw.weight || raw.score || raw.confidence || 1),
        evidenceRefs: uniqueEvidenceRefs(asArray(raw.evidenceRefs).map((evidenceId) => ({ evidenceId }))).slice(0, 8)
      };
    })
    .filter((item) => item.term)
    .slice(0, 32);
}

function normalizeSkillDraft(proposal = {}, fallbackSkill = {}) {
  const raw = asObject(proposal);
  const fallbackApplicability = asObject(fallbackSkill.applicability);
  const rawApplicability = asObject(raw.applicability);
  const evidenceRefs = uniqueEvidenceRefs([
    ...asArray(raw.evidenceRefs).map((evidenceId) => ({ evidenceId })),
    ...asArray(fallbackSkill.evidenceRefs).map((evidenceId) => ({ evidenceId }))
  ]);
  return {
    title: normalizeText(raw.title || fallbackSkill.title),
    summary: normalizeText(raw.summary || fallbackSkill.summary),
    applicability: {
      useWhen: normalizeTextArray(rawApplicability.useWhen, 16).length
        ? normalizeTextArray(rawApplicability.useWhen, 16)
        : normalizeTextArray(fallbackApplicability.useWhen, 16),
      avoidWhen: normalizeTextArray(rawApplicability.avoidWhen, 16).length
        ? normalizeTextArray(rawApplicability.avoidWhen, 16)
        : normalizeTextArray(fallbackApplicability.avoidWhen, 16)
    },
    coreConcepts: normalizeCoreConcepts(raw.coreConcepts).length
      ? normalizeCoreConcepts(raw.coreConcepts)
      : normalizeCoreConcepts(fallbackSkill.coreConcepts),
    decisionHeuristics: normalizeTextArray(raw.decisionHeuristics, 24).length
      ? normalizeTextArray(raw.decisionHeuristics, 24)
      : normalizeTextArray(fallbackSkill.decisionHeuristics, 24),
    antiPatterns: normalizeTextArray(raw.antiPatterns, 24).length
      ? normalizeTextArray(raw.antiPatterns, 24)
      : normalizeTextArray(fallbackSkill.antiPatterns, 24),
    honestBoundaries: normalizeTextArray(raw.honestBoundaries, 24).length
      ? normalizeTextArray(raw.honestBoundaries, 24)
      : normalizeTextArray(fallbackSkill.honestBoundaries, 24),
    verificationQuestions: normalizeTextArray(raw.verificationQuestions, 24).length
      ? normalizeTextArray(raw.verificationQuestions, 24)
      : normalizeTextArray(fallbackSkill.verificationQuestions, 24),
    evidenceRefs,
    evidenceDigest: asArray(raw.evidenceDigest).length
      ? asArray(raw.evidenceDigest).slice(0, 32)
      : asArray(fallbackSkill.evidenceDigest).slice(0, 32),
    sourceTrace: Object.keys(asObject(raw.sourceTrace)).length
      ? raw.sourceTrace
      : asObject(fallbackSkill.sourceTrace),
    distilledOutputs: Object.keys(asObject(raw.distilledOutputs)).length
      ? raw.distilledOutputs
      : asObject(fallbackSkill.distilledOutputs)
  };
}

function proposalHasBlockedFields(proposal = {}, blockedFields = []) {
  const raw = asObject(proposal);
  return asArray(blockedFields)
    .filter(Boolean)
    .filter((field) => raw[field] !== undefined && raw[field] !== null);
}

function createDefaultSkill({
  query,
  title,
  searchResult,
  evidenceItems,
  openedEvidence,
  framework
}) {
  const evidenceText = [
    query,
    ...evidenceItems.flatMap((item) => [item.title, item.snippet]),
    ...openedEvidence.flatMap((item) => [item.title, item.snippet, item.text])
  ].join("\n");
  const terms = extractTerms(evidenceText, 18, framework.termExtraction);
  const topTitles = evidenceItems
    .map((item) => item.title)
    .filter(Boolean)
    .slice(0, 5);
  const coreConcepts = terms.slice(0, 10).map((item) => ({
    term: item.term,
    weight: item.count,
    evidenceRefs: uniqueEvidenceRefs(evidenceItems).slice(0, 4)
  }));
  const evidenceRefs = uniqueEvidenceRefs(evidenceItems);
  const hierarchyStatus =
    searchResult?.hierarchy?.enforced || searchResult?.hierarchy?.selected
      ? framework.fallbackTemplates.hierarchyStatus.available
      : framework.fallbackTemplates.hierarchyStatus.missing;
  const templateVariables = {
    query,
    terms: terms.slice(0, 4).map((item) => item.term).join(" "),
    titles: topTitles.join("；"),
    evidenceCount: String(evidenceRefs.length),
    hierarchyStatus
  };
  const safeTitle =
    normalizeText(title) ||
    renderTemplate(framework.fallbackTemplates.titleTemplate, templateVariables) ||
    query;
  const summary = normalizeText(renderTemplates(framework.fallbackTemplates.summaryParts, templateVariables).join(" "));
  const sourceTrace = sourceTraceForEvidenceItems(evidenceItems);
  return {
    title: safeTitle,
    summary,
    applicability: {
      useWhen: renderTemplates(framework.fallbackTemplates.useWhen, templateVariables),
      avoidWhen: renderTemplates(framework.fallbackTemplates.avoidWhen, templateVariables)
    },
    coreConcepts,
    decisionHeuristics: [
      ...framework.defaultHeuristicTemplates,
      ...renderTemplates(framework.fallbackTemplates.decisionHeuristics, templateVariables)
    ],
    antiPatterns: framework.defaultAntiPatterns,
    honestBoundaries: [
      ...framework.defaultBoundaryRules,
      ...renderTemplates(framework.fallbackTemplates.honestBoundaries, templateVariables)
    ],
    verificationQuestions: renderTemplates(framework.verificationQuestionTemplates, {
      ...templateVariables,
      title: safeTitle
    }),
    evidenceRefs,
    sourceTrace,
    evidenceDigest: evidenceItems.slice(0, 8).map((item) => ({
      evidenceId: item.evidenceId,
      title: item.title,
      snippet: item.snippet,
      score: item.score,
      hierarchy: item.hierarchy,
      source: item.sourceLocator,
      citation: citationForEvidenceItem(item)
    }))
  };
}

function normalizeModelSkill(decision = {}, fallbackSkill) {
  const rawSkill = asObject(decision.skill || decision.knowledgeSkill || decision);
  if (!Object.keys(rawSkill).length || rawSkill.verdict === "unsupported_role") {
    return fallbackSkill;
  }
  return {
    ...fallbackSkill,
    ...rawSkill,
    title: normalizeText(rawSkill.title || fallbackSkill.title),
    summary: normalizeText(rawSkill.summary || fallbackSkill.summary),
    applicability: {
      ...asObject(fallbackSkill.applicability),
      ...asObject(rawSkill.applicability)
    },
    coreConcepts: asArray(rawSkill.coreConcepts).length
      ? asArray(rawSkill.coreConcepts)
      : fallbackSkill.coreConcepts,
    decisionHeuristics: asArray(rawSkill.decisionHeuristics).length
      ? asArray(rawSkill.decisionHeuristics).map(normalizeText).filter(Boolean)
      : fallbackSkill.decisionHeuristics,
    antiPatterns: asArray(rawSkill.antiPatterns).length
      ? asArray(rawSkill.antiPatterns).map(normalizeText).filter(Boolean)
      : fallbackSkill.antiPatterns,
    honestBoundaries: asArray(rawSkill.honestBoundaries).length
      ? asArray(rawSkill.honestBoundaries).map(normalizeText).filter(Boolean)
      : fallbackSkill.honestBoundaries,
    verificationQuestions: asArray(rawSkill.verificationQuestions).length
      ? asArray(rawSkill.verificationQuestions).map(normalizeText).filter(Boolean)
      : fallbackSkill.verificationQuestions,
    evidenceRefs: uniqueEvidenceRefs([
      ...asArray(rawSkill.evidenceRefs).map((evidenceId) => ({ evidenceId })),
      ...asArray(fallbackSkill.evidenceRefs).map((evidenceId) => ({ evidenceId }))
    ])
  };
}

function evaluateSkillQuality({ skill, searchResult, evidenceItems, framework }) {
  const gates = framework.qualityGates;
  const evidenceRefs = uniqueEvidenceRefs(evidenceItems);
  const documentIds = distinctDocumentIds(evidenceItems);
  const hierarchyAvailable = Boolean(
    searchResult?.hierarchy?.enforced ||
      searchResult?.hierarchy?.selected ||
      searchResult?.hierarchy?.policy === "coarse_to_fine" ||
      evidenceItems.some((item) => item.hierarchy)
  );
  const checks = [
    {
      id: "minimum_evidence",
      passed: evidenceRefs.length >= gates.minEvidence,
      actual: evidenceRefs.length,
      expected: gates.minEvidence
    },
    {
      id: "distinct_documents",
      passed: documentIds.length >= gates.minDistinctDocuments,
      actual: documentIds.length,
      expected: gates.minDistinctDocuments
    },
    {
      id: "citation_coverage",
      passed: !gates.requireCitations || asArray(skill.evidenceRefs).length > 0,
      actual: asArray(skill.evidenceRefs).length,
      expected: gates.requireCitations ? 1 : 0
    },
    {
      id: "hierarchy_context",
      passed: !gates.requireHierarchy || hierarchyAvailable,
      actual: hierarchyAvailable,
      expected: gates.requireHierarchy
    },
    {
      id: "skill_operability",
      passed:
        normalizeText(skill.summary) &&
        asArray(skill.decisionHeuristics).length > 0 &&
        asArray(skill.honestBoundaries).length > 0,
      actual: {
        hasSummary: Boolean(normalizeText(skill.summary)),
        heuristicCount: asArray(skill.decisionHeuristics).length,
        boundaryCount: asArray(skill.honestBoundaries).length
      },
      expected: "summary + heuristics + honest boundaries"
    }
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  const score = Number((passedCount / checks.length).toFixed(4));
  return {
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    score,
    passed: score >= gates.minQualityScore && checks.every((check) => check.passed),
    checks,
    gates,
    evidenceCount: evidenceRefs.length,
    distinctDocumentCount: documentIds.length,
    sourceTrace: sourceTraceForEvidenceItems(evidenceItems),
    recommendations: checks
      .filter((check) => !check.passed)
      .map((check) => {
        if (check.id === "minimum_evidence") {
          return "增加证据召回或降低发布范围，避免单证据 Skill 自动发布。";
        }
        if (check.id === "hierarchy_context") {
          return "先修正粗层索引或重新执行分层召回，再发布 Skill。";
        }
        if (check.id === "citation_coverage") {
          return "补齐 evidenceId 引用后再发布。";
        }
        return "进入人工审核后再发布。";
      })
  };
}

function evaluateAgentCreation({ proposal, skill, sourceType, evidenceRefs, evidenceItems, framework }) {
  const creation = framework.agentCreation || {};
  const allowedSourceTypes = new Set(asArray(creation.allowedSourceTypes).filter(Boolean));
  const blockedFields = proposalHasBlockedFields(proposal, creation.blockedFields);
  const getRequiredValue = (field) => {
    if (field === "evidenceRefs") {
      return evidenceRefs;
    }
    if (field === "decisionHeuristics" || field === "honestBoundaries" || field === "antiPatterns") {
      return asArray(skill[field]);
    }
    if (field === "useWhen" || field === "avoidWhen") {
      return asArray(skill.applicability?.[field]);
    }
    return skill[field];
  };
  const requiredChecks = asArray(creation.requiredFields).map((field) => {
    const value = getRequiredValue(field);
    const count = Array.isArray(value) ? value.filter(Boolean).length : Number(Boolean(normalizeText(value)));
    return {
      id: `required_${field}`,
      passed: count > 0,
      actual: count,
      expected: "non_empty"
    };
  });
  const checks = [
    {
      id: "source_type_allowed",
      passed: !allowedSourceTypes.size || allowedSourceTypes.has(sourceType),
      actual: sourceType,
      expected: [...allowedSourceTypes]
    },
    {
      id: "blocked_canonical_mutations_absent",
      passed: blockedFields.length === 0,
      actual: blockedFields,
      expected: []
    },
    {
      id: "evidence_refs_resolved",
      passed: evidenceRefs.length > 0 && evidenceItems.length > 0,
      actual: {
        proposedEvidenceRefs: evidenceRefs.length,
        resolvedEvidenceRefs: evidenceItems.length
      },
      expected: "at least one resolvable evidenceRef"
    },
    ...requiredChecks
  ];
  return {
    sourceType,
    passed: checks.every((check) => check.passed),
    checks,
    blockedFields,
    reviewPolicy: creation.reviewPolicy || "",
    reuseSignals: asArray(creation.reuseSignals),
    recommendationMessages: asObject(creation.recommendationMessages)
  };
}

function mergeQualityReports(baseReport, creationReport) {
  const checks = [...asArray(baseReport.checks), ...asArray(creationReport.checks)];
  return {
    ...baseReport,
    passed: baseReport.passed === true && creationReport.passed === true,
    checks,
    creation: creationReport,
    recommendations: [
      ...asArray(baseReport.recommendations),
      ...asArray(creationReport.checks)
        .filter((check) => !check.passed)
        .map((check) => {
          const messages = asObject(creationReport.recommendationMessages);
          if (check.id === "blocked_canonical_mutations_absent") {
            return messages.blockedCanonicalMutations || "blocked canonical mutation fields";
          }
          if (check.id === "evidence_refs_resolved") {
            return messages.evidenceRefsResolved || "evidence refs must resolve";
          }
          if (check.id === "source_type_allowed") {
            return messages.sourceTypeAllowed || "source type is not allowed";
          }
          return messages.requiredFieldMissing || "required field is missing";
        })
    ]
  };
}

export function createKnowledgeSkillRuntime({
  userDataPath,
  runtime,
  modelDecisionRuntime = null,
  goldenRuleRuntime = null
} = {}) {
  const rootPath = path.join(userDataPath, "knowledge-skills");
  const playbookRootPath = path.join(userDataPath, "agentlibrary-playbooks");
  fs.mkdirSync(rootPath, { recursive: true });
  fs.mkdirSync(playbookRootPath, { recursive: true });
  const db = new Database(path.join(rootPath, "knowledge-skills.sqlite"));
  const playbookDb = new Database(path.join(playbookRootPath, "agentlibrary-playbooks.sqlite"));
  const skillEvaluationRunsPath = path.join(rootPath, "skill-evaluation-runs.json");
  const skillDeploymentsPath = path.join(rootPath, "skill-deployments.json");
  const playbookEvaluationRunsPath = path.join(playbookRootPath, "playbook-evaluation-runs.json");
  const playbookDeploymentsPath = path.join(playbookRootPath, "playbook-deployments.json");
  db.pragma("journal_mode = WAL");
  playbookDb.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_skills (
      skill_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      source_query TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '',
      skill_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      quality_json TEXT NOT NULL DEFAULT '{}',
      model_decision_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_skills_status_updated
      ON knowledge_skills(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_skills_source_query
      ON knowledge_skills(source_query);
  `);
  playbookDb.exec(`
    CREATE TABLE IF NOT EXISTS agentlibrary_playbooks (
      playbook_id TEXT PRIMARY KEY,
      legacy_skill_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      source_query TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '',
      playbook_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      quality_json TEXT NOT NULL DEFAULT '{}',
      model_decision_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_agentlibrary_playbooks_status_updated
      ON agentlibrary_playbooks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agentlibrary_playbooks_legacy_skill
      ON agentlibrary_playbooks(legacy_skill_id);
    CREATE INDEX IF NOT EXISTS idx_agentlibrary_playbooks_source_query
      ON agentlibrary_playbooks(source_query);
  `);

  const insertSkillStmt = db.prepare(`
    INSERT INTO knowledge_skills (
      skill_id, version, status, title, source_query, scope_json, summary,
      skill_json, evidence_refs_json, quality_json, model_decision_json,
      created_at, updated_at, published_at
    ) VALUES (
      @skillId, @version, @status, @title, @sourceQuery, @scopeJson, @summary,
      @skillJson, @evidenceRefsJson, @qualityJson, @modelDecisionJson,
      @createdAt, @updatedAt, @publishedAt
    )
    ON CONFLICT(skill_id) DO UPDATE SET
      version = excluded.version,
      status = excluded.status,
      title = excluded.title,
      source_query = excluded.source_query,
      scope_json = excluded.scope_json,
      summary = excluded.summary,
      skill_json = excluded.skill_json,
      evidence_refs_json = excluded.evidence_refs_json,
      quality_json = excluded.quality_json,
      model_decision_json = excluded.model_decision_json,
      updated_at = excluded.updated_at,
      published_at = excluded.published_at
  `);
  const insertPlaybookStmt = playbookDb.prepare(`
    INSERT INTO agentlibrary_playbooks (
      playbook_id, legacy_skill_id, version, status, title, source_query, scope_json, summary,
      playbook_json, evidence_refs_json, quality_json, model_decision_json,
      created_at, updated_at, published_at
    ) VALUES (
      @playbookId, @legacySkillId, @version, @status, @title, @sourceQuery, @scopeJson, @summary,
      @playbookJson, @evidenceRefsJson, @qualityJson, @modelDecisionJson,
      @createdAt, @updatedAt, @publishedAt
    )
    ON CONFLICT(playbook_id) DO UPDATE SET
      legacy_skill_id = excluded.legacy_skill_id,
      version = excluded.version,
      status = excluded.status,
      title = excluded.title,
      source_query = excluded.source_query,
      scope_json = excluded.scope_json,
      summary = excluded.summary,
      playbook_json = excluded.playbook_json,
      evidence_refs_json = excluded.evidence_refs_json,
      quality_json = excluded.quality_json,
      model_decision_json = excluded.model_decision_json,
      updated_at = excluded.updated_at,
      published_at = excluded.published_at
  `);
  const selectSkillStmt = db.prepare("SELECT * FROM knowledge_skills WHERE skill_id = ?");
  const selectPlaybookStmt = playbookDb.prepare(`
    SELECT * FROM agentlibrary_playbooks
    WHERE playbook_id = ? OR legacy_skill_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  const listSkillsStmt = db.prepare(`
    SELECT * FROM knowledge_skills
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC, title ASC
    LIMIT ?
  `);
  const listPlaybooksStmt = playbookDb.prepare(`
    SELECT * FROM agentlibrary_playbooks
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC, title ASC
    LIMIT ?
  `);
  const updateStatusStmt = db.prepare(`
    UPDATE knowledge_skills
    SET status = ?, updated_at = ?, published_at = ?
    WHERE skill_id = ?
  `);
  const updatePlaybookStatusStmt = playbookDb.prepare(`
    UPDATE agentlibrary_playbooks
    SET status = ?, updated_at = ?, published_at = ?
    WHERE playbook_id = ? OR legacy_skill_id = ?
  `);

  function upsertSkillIndex(record = {}) {
    insertSkillStmt.run({
      skillId: record.skillId,
      version: record.version,
      status: record.status,
      title: record.title,
      sourceQuery: record.sourceQuery,
      scopeJson: JSON.stringify(record.scope || {}),
      summary: record.summary || "",
      skillJson: JSON.stringify(record.skill || {}),
      evidenceRefsJson: JSON.stringify(record.evidenceRefs || []),
      qualityJson: JSON.stringify(record.qualityReport || {}),
      modelDecisionJson: JSON.stringify(record.modelDecision || null),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      publishedAt: record.publishedAt || ""
    });
    upsertPlaybookIndex(record);
  }

  function upsertPlaybookIndex(record = {}) {
    const normalized = withPlaybookAliases(record);
    if (!normalized?.playbookId) {
      return;
    }
    insertPlaybookStmt.run({
      playbookId: normalized.playbookId,
      legacySkillId: normalized.legacySkillId || normalized.skillId,
      version: normalized.version,
      status: normalized.status,
      title: normalized.title,
      sourceQuery: normalized.sourceQuery,
      scopeJson: JSON.stringify(normalized.scope || {}),
      summary: normalized.summary || "",
      playbookJson: JSON.stringify(normalized.playbook || normalized.skill || {}),
      evidenceRefsJson: JSON.stringify(normalized.evidenceRefs || []),
      qualityJson: JSON.stringify(normalized.qualityReport || {}),
      modelDecisionJson: JSON.stringify(normalized.modelDecision || null),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      publishedAt: normalized.publishedAt || ""
    });
  }

  function normalizeSkillBundleRecord(skill = {}) {
    const skillId = normalizeText(skill.skillId || skill.legacySkillId || skill.playbookId || skill.id || "");
    if (!skillId) {
      return null;
    }
    const timestamp = nowIso();
    return {
      skillId,
      playbookId: normalizeText(skill.playbookId || skillId),
      legacySkillId: normalizeText(skill.legacySkillId || skillId),
      version: Math.max(1, Number(skill.version || 1)),
      status: normalizeText(skill.status || DEFAULT_STATUS) || DEFAULT_STATUS,
      title: normalizeText(skill.title || skill.skill?.title || skill.playbook?.title || skillId),
      sourceQuery: normalizeText(skill.sourceQuery || skill.scope?.query || skill.title || ""),
      scope: asObject(skill.scope),
      summary: normalizeText(skill.summary || skill.skill?.summary || skill.playbook?.summary || ""),
      skill: asObject(skill.playbook || skill.skill),
      evidenceRefs: asArray(skill.evidenceRefs),
      qualityReport: asObject(skill.qualityReport),
      modelDecision: skill.modelDecision || null,
      createdAt: normalizeText(skill.createdAt || timestamp),
      updatedAt: normalizeText(skill.updatedAt || timestamp),
      publishedAt: normalizeText(skill.publishedAt || "")
    };
  }

  function syncSkillBundlesIntoIndex() {
    const bundlesRoot = path.join(rootPath, "bundles");
    let entries = [];
    try {
      entries = fs.readdirSync(bundlesRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillPath = path.join(bundlesRoot, entry.name, "skill.json");
      try {
        const record = normalizeSkillBundleRecord(
          JSON.parse(fs.readFileSync(skillPath, "utf8"))
        );
        if (record) {
          upsertSkillIndex(record);
        }
      } catch {
        // Ignore incomplete drafts; verification catches malformed committed bundles.
      }
    }
  }

  function syncPlaybookBundlesIntoIndex() {
    const bundlesRoot = path.join(playbookRootPath, "bundles");
    let entries = [];
    try {
      entries = fs.readdirSync(bundlesRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const playbookPath = path.join(bundlesRoot, entry.name, "playbook.json");
      try {
        const record = normalizeSkillBundleRecord(
          JSON.parse(fs.readFileSync(playbookPath, "utf8"))
        );
        if (record) {
          upsertPlaybookIndex(record);
        }
      } catch {
        // New Playbook bundles are best-effort during migration.
      }
    }
  }

  function syncLegacySkillIndexIntoPlaybooks() {
    const rows = listSkillsStmt.all("", "", 10000);
    for (const row of rows) {
      const record = hydrateSkill(row);
      if (record) {
        const existing = hydratePlaybook(selectPlaybookStmt.get(record.playbookId, record.skillId));
        const existingUpdatedAt = Date.parse(existing?.updatedAt || "");
        const legacyUpdatedAt = Date.parse(record.updatedAt || "");
        if (
          existing &&
          Number.isFinite(existingUpdatedAt) &&
          Number.isFinite(legacyUpdatedAt) &&
          existingUpdatedAt >= legacyUpdatedAt
        ) {
          continue;
        }
        upsertPlaybookIndex(record);
      }
    }
  }

  function syncAllSkillIndexes() {
    syncSkillBundlesIntoIndex();
    syncPlaybookBundlesIntoIndex();
    syncLegacySkillIndexIntoPlaybooks();
  }

  function migrateLegacySkillsToPlaybooks({ writeBundles = true } = {}) {
    syncSkillBundlesIntoIndex();
    const rows = listSkillsStmt.all("", "", 10000);
    const migrated = [];
    for (const row of rows) {
      const record = hydrateSkill(row);
      if (!record) {
        continue;
      }
      upsertPlaybookIndex(record);
      if (writeBundles) {
        writeAgentLibraryPlaybookBundle(playbookRootPath, record);
      }
      migrated.push(record.playbookId || record.skillId);
    }
    return {
      protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      legacyProtocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      ok: true,
      migratedCount: migrated.length,
      migratedPlaybookIds: migrated,
      storagePath: path.join(playbookRootPath, "agentlibrary-playbooks.sqlite"),
      legacyStoragePath: path.join(rootPath, "knowledge-skills.sqlite"),
      bundleRootPath: path.join(playbookRootPath, "bundles")
    };
  }

  async function loadFramework() {
    const overridePath = path.join(rootPath, "framework.json");
    const playbookOverridePath = path.join(playbookRootPath, "framework.json");
    const loadJson = async (filePath) => JSON.parse(await fsp.readFile(filePath, "utf8"));
    for (const candidate of [playbookOverridePath, overridePath, ...DEFAULT_FRAMEWORK_PATHS]) {
      try {
        return normalizeFramework(await loadJson(candidate));
      } catch {
        // Try the next compatibility path.
      }
    }
    throw new Error("AgentLibrary Playbook framework config is unavailable.");
  }

  async function saveFramework(input = {}) {
    const framework = normalizeFramework(input);
    await fsp.mkdir(rootPath, { recursive: true });
    await fsp.mkdir(playbookRootPath, { recursive: true });
    await Promise.all([
      fsp.writeFile(
        path.join(rootPath, "framework.json"),
        JSON.stringify(framework, null, 2),
        "utf8"
      ),
      fsp.writeFile(
        path.join(playbookRootPath, "framework.json"),
        JSON.stringify({
          ...framework,
          playbookFrameworkId: framework.frameworkId === "pact.default-knowledge-skill-framework"
            ? "pact.default-agentlibrary-playbook-framework"
            : framework.frameworkId,
          legacyFrameworkId: framework.frameworkId
        }, null, 2),
        "utf8"
      )
    ]);
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      framework
    };
  }

  function persistSkill(record) {
    upsertSkillIndex(record);
    const skill = getSkill(record.skillId);
    writeKnowledgeSkillBundle(rootPath, skill);
    writeAgentLibraryPlaybookBundle(playbookRootPath, skill);
    return skill;
  }

  function listSkills(input = {}) {
    syncAllSkillIndexes();
    const status = normalizeText(input.status || "");
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 200));
    const items = listPlaybooksStmt.all(status, status, limit).map(hydratePlaybook);
    const query = normalizeText(input.query || input.q || "");
    const filtered = query ? rankSkillsForQuery(items, query).map((item) => item.skill) : items;
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      items: filtered,
      summary: {
        totalReturned: filtered.length,
        status: status || "all"
      }
    };
  }

  function getSkill(skillId) {
    syncAllSkillIndexes();
    const id = String(skillId || "");
    const playbook = hydratePlaybook(selectPlaybookStmt.get(id, id));
    if (playbook) {
      return playbook;
    }
    const legacy = hydrateSkill(selectSkillStmt.get(id));
    if (legacy) {
      upsertPlaybookIndex(legacy);
    }
    return legacy;
  }

  function rankSkillsForQuery(skills = [], query = "") {
    const queryTokens = new Set(tokenize(query));
    return asArray(skills)
      .map((skill) => {
        const haystack = [
          skill.title,
          skill.summary,
          skill.sourceQuery,
          ...asArray(skill.skill?.coreConcepts).map((item) => item.term || item.label || item),
          ...asArray(skill.skill?.decisionHeuristics),
          ...asArray(skill.skill?.antiPatterns)
        ].join(" ");
        const tokens = new Set(tokenize(haystack));
        let hits = 0;
        for (const token of queryTokens) {
          if (tokens.has(token) || haystack.toLowerCase().includes(token)) {
            hits += 1;
          }
        }
        const score = queryTokens.size ? hits / queryTokens.size : 0;
        return { skill, score };
      })
      .filter((item) => item.score > 0 || !queryTokens.size)
      .sort((left, right) => right.score - left.score || right.skill.updatedAt.localeCompare(left.skill.updatedAt));
  }

  function searchSkills(input = {}) {
    const status = normalizeText(input.status || "published");
    const limit = Math.max(1, Math.min(Number(input.limit || 5), 20));
    const candidates = listSkills({ status, limit: 200 }).items;
    const ranked = rankSkillsForQuery(candidates, input.query || input.q || "");
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      query: normalizeText(input.query || input.q || ""),
      items: ranked.slice(0, limit).map((item) => ({
        ...item.skill,
        matchScore: Number(item.score.toFixed(4))
      }))
    };
  }

  async function collectOpenedEvidence(knowledgeCore, evidenceItems, maxOpen = 5) {
    if (!knowledgeCore || typeof knowledgeCore.getEvidence !== "function") {
      return [];
    }
    const opened = [];
    for (const item of evidenceItems.slice(0, maxOpen)) {
      if (!item.evidenceId) {
        continue;
      }
      try {
        const evidence = await knowledgeCore.getEvidence({ evidenceId: item.evidenceId });
        if (evidence) {
          opened.push(compactOpenedEvidence(evidence));
        }
      } catch {
        // Best-effort evidence opening; search snippets are still usable.
      }
    }
    return opened;
  }

  async function collectOpenedEvidenceByIds(knowledgeCore, evidenceRefs, maxOpen = 8) {
    if (!knowledgeCore || typeof knowledgeCore.getEvidence !== "function") {
      return [];
    }
    const opened = [];
    for (const evidenceId of asArray(evidenceRefs).slice(0, maxOpen)) {
      const id = normalizeText(evidenceId);
      if (!id) {
        continue;
      }
      try {
        const evidence = await knowledgeCore.getEvidence({ evidenceId: id });
        if (evidence) {
          opened.push(compactOpenedEvidence({ ...evidence, evidenceId: id }));
        }
      } catch {
        // A missing evidence pack should fail the quality gate, not the whole proposal.
      }
    }
    return opened;
  }

  function evidenceItemsFromOpened(openedEvidence = []) {
    return asArray(openedEvidence)
      .map((evidence, index) => {
        const sourceLocator = normalizeSourceLocator(evidence.sourceLocator || evidence.locator || {}, evidence);
        return {
          rank: index + 1,
          evidenceId: normalizeText(evidence.evidenceId),
          itemId: normalizeText(evidence.documentId || sourceLocator.documentId),
          documentId: normalizeText(evidence.documentId || sourceLocator.documentId || evidence.evidenceId),
          title: normalizeText(evidence.title || evidence.evidenceId),
          snippet: truncateText(evidence.snippet || evidence.text || "", 900),
          score: 1,
          hierarchy: null,
          sourceLocator,
          sourceKey: sourceFingerprintForLocator(sourceLocator),
          modalities: evidence.documentType ? [evidence.documentType] : [],
          reasons: [{ kind: "agent-proposed-evidence" }]
        };
      })
      .filter((item) => item.evidenceId);
  }

  async function generateSkill(input = {}) {
    const query = normalizeText(input.query || input.q || input.topic || "");
    if (!query) {
      throw new Error("生成知识 Skill 需要 query。");
    }
    const framework = await loadFramework();
    const knowledgeCore = getKnowledgeCore(runtime);
    if (!knowledgeCore || typeof knowledgeCore.search !== "function") {
      throw new Error("KnowledgeCore search 不可用，无法生成知识 Skill。");
    }
    const limit = Math.max(1, Math.min(Number(input.limit || 12), 50));
    const searchResult = await knowledgeCore.search({
      query,
      limit,
      batchId: input.batchId || "",
      retrievalProfileId: input.retrievalProfileId || input.profileId || "",
      profileKey: input.profileKey || "",
      learningEnabled: input.learningEnabled !== false,
      explain: true,
      modalityPolicy: "multimodal"
    });
    const evidenceItems = asArray(searchResult.items || searchResult.results)
      .map(compactEvidenceItem)
      .filter((item) => item.evidenceId || item.snippet || item.title);
    const openedEvidence = await collectOpenedEvidence(
      knowledgeCore,
      evidenceItems,
      Number(input.maxOpenedEvidence || 5)
    );
    const fallbackSkill = createDefaultSkill({
      query,
      title: input.title || "",
      searchResult,
      evidenceItems,
      openedEvidence,
      framework
    });
    let modelDecision = null;
    let skill = fallbackSkill;
    if (modelDecisionRuntime && typeof modelDecisionRuntime.decide === "function") {
      modelDecision = await modelDecisionRuntime.decide({
        roleId: input.modelRoleId || "knowledge_playbook_distiller",
        legacyRoleId: "knowledge_skill_distiller",
        modelEnabled: input.modelEnabled === true,
        modelAlias: input.modelAlias || "",
        input: {
          query,
          title: input.title || "",
          framework,
          evidenceItems,
          openedEvidence,
          fallbackSkill,
          modelEnabled: input.modelEnabled === true
        }
      });
      skill = normalizeModelSkill(modelDecision?.decision, fallbackSkill);
    }
    const qualityReport = evaluateSkillQuality({
      skill,
      searchResult,
      evidenceItems,
      framework
    });
    const requestedStatus = normalizeText(input.status || "");
    const publishRequested = input.publish === true || requestedStatus === "published";
    const allowDirectPublish =
      (input.allowDirectPublish === true || input.deploymentApproved === true) &&
      publishRequested &&
      qualityReport.passed;
    const status =
      allowDirectPublish
        ? "published"
        : requestedStatus && requestedStatus !== "published"
          ? requestedStatus
          : DEFAULT_STATUS;
    const now = nowIso();
    const skillId =
      normalizeText(input.playbookId || input["playbook-id"] || input.skillId || "") ||
      stableId("agentlibrary_playbook", query, JSON.stringify(skill.evidenceRefs || []));
    const previous = getSkill(skillId);
    const record = persistSkill({
      skillId,
      version: previous ? Number(previous.version || 1) + 1 : 1,
      status,
      title: skill.title,
      sourceQuery: query,
      scope: {
        query,
        batchId: input.batchId || "",
        retrievalProfileId: input.retrievalProfileId || input.profileId || "",
        frameworkId: framework.frameworkId,
        frameworkVersion: framework.version
      },
      summary: skill.summary,
      skill: {
        ...skill,
        framework: {
          frameworkId: framework.frameworkId,
          version: framework.version,
          layers: framework.layers
        }
      },
      evidenceRefs: asArray(skill.evidenceRefs),
      qualityReport,
      modelDecision,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      publishedAt: status === "published" ? now : previous?.publishedAt || ""
    });
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      ok: true,
      playbook: record,
      skill: record,
      searchResult: {
        ...searchResult,
        items: evidenceItems
      },
      openedEvidence,
      qualityReport,
      statusReason: allowDirectPublish
        ? "quality_gate_passed_and_direct_publish_allowed"
        : qualityReport.passed
          ? "quality_gate_passed_pending_review_until_skillset_deployment"
          : "quality_gate_requires_review"
    };
  }

  async function proposeSkill(input = {}) {
    const proposal = asObject(input.proposal || input.skill || input.knowledgeSkill || input);
    const query = normalizeText(
      input.query || proposal.sourceQuery || proposal.query || proposal.topic || proposal.title || ""
    );
    if (!query && !normalizeText(proposal.title)) {
      throw new Error("创建知识 Skill 提案需要 query 或 title。");
    }
    const framework = await loadFramework();
    const knowledgeCore = getKnowledgeCore(runtime);
    const sourceType = normalizeText(input.sourceType || proposal.sourceType || "agent_exploration");
    const proposedEvidenceRefs = uniqueEvidenceRefs([
      ...asArray(input.evidenceRefs).map((evidenceId) => ({ evidenceId })),
      ...asArray(proposal.evidenceRefs).map((evidenceId) => ({ evidenceId }))
    ]);
    const openedEvidence = await collectOpenedEvidenceByIds(
      knowledgeCore,
      proposedEvidenceRefs,
      Number(input.maxOpenedEvidence || 12)
    );
    const evidenceItems = evidenceItemsFromOpened(openedEvidence);
    const fallbackSkill = createDefaultSkill({
      query: query || normalizeText(proposal.title),
      title: proposal.title || input.title || "",
      searchResult: {
        hierarchy: proposal.hierarchy || input.hierarchy || null
      },
      evidenceItems,
      openedEvidence,
      framework
    });
    const skill = normalizeSkillDraft(
      {
        ...proposal,
        evidenceRefs: proposedEvidenceRefs
      },
      fallbackSkill
    );
    const baseQualityReport = evaluateSkillQuality({
      skill,
      searchResult: {
        hierarchy: proposal.hierarchy || input.hierarchy || null
      },
      evidenceItems,
      framework
    });
    const creationReport = evaluateAgentCreation({
      proposal,
      skill,
      sourceType,
      evidenceRefs: proposedEvidenceRefs,
      evidenceItems,
      framework
    });
    const qualityReport = mergeQualityReports(baseQualityReport, creationReport);
    const requestedStatus = normalizeText(input.status || proposal.status || "");
    const publishRequested = input.publish === true || requestedStatus === "published";
    const allowAutoPublish = input.allowAutoPublish === true || framework.agentCreation.autoPublishAllowed === true;
    const defaultStatus = framework.agentCreation.defaultStatus || DEFAULT_STATUS;
    const status =
      publishRequested && allowAutoPublish && qualityReport.passed
        ? "published"
        : requestedStatus && requestedStatus !== "published"
          ? requestedStatus
          : defaultStatus;
    const now = nowIso();
    const skillId =
      normalizeText(input.playbookId || input["playbook-id"] || input.skillId || proposal.playbookId || proposal.skillId || "") ||
      stableId(
        "agentlibrary_playbook",
        "agent_proposal",
        sourceType,
        query,
        skill.title,
        JSON.stringify(skill.evidenceRefs || [])
      );
    const previous = getSkill(skillId);
    const agentId = normalizeText(input.agentId || proposal.agentId || "");
    const runId = normalizeText(input.runId || proposal.runId || "");
    const record = persistSkill({
      skillId,
      version: previous ? Number(previous.version || 1) + 1 : 1,
      status,
      title: skill.title,
      sourceQuery: query || skill.title,
      scope: {
        query: query || skill.title,
        sourceType,
        agentId,
        runId,
        frameworkId: framework.frameworkId,
        frameworkVersion: framework.version,
        createdByAgent: Boolean(agentId || sourceType.startsWith("agent"))
      },
      summary: skill.summary,
      skill: {
        ...skill,
        creationPolicy: {
          sourceType,
          defaultStatus,
          autoPublishAllowed: allowAutoPublish,
          reviewPolicy: framework.agentCreation.reviewPolicy
        },
        framework: {
          frameworkId: framework.frameworkId,
          version: framework.version,
          layers: framework.layers
        }
      },
      evidenceRefs: asArray(skill.evidenceRefs),
      qualityReport,
      modelDecision: {
        kind: "agent_skill_proposal",
        sourceType,
        agentId,
        runId,
        confidence: Number(input.confidence || proposal.confidence || 0),
        reuseReason: normalizeText(input.reuseReason || proposal.reuseReason || ""),
        proposedAt: now
      },
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      publishedAt: status === "published" ? now : previous?.publishedAt || ""
    });
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      ok: true,
      playbook: record,
      skill: record,
      openedEvidence,
      qualityReport,
      creationReport,
      statusReason:
        status === "published"
          ? "quality_gate_passed_and_auto_publish_allowed"
          : qualityReport.passed
            ? "created_for_review"
            : "quality_gate_requires_review"
    };
  }

  function resolveSkill(input = {}) {
    const skillId = normalizeText(input.playbookId || input["playbook-id"] || input.skillId || input.id || "");
    const action = normalizeText(input.action || input.resolution || "");
    const skill = getSkill(skillId);
    if (!skill) {
      return null;
    }
    let status = skill.status;
    if (["publish", "accept", "published"].includes(action)) {
      if (!skill.qualityReport?.passed && input.force !== true) {
        return {
          protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
          playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
          ok: false,
          error: "quality_gate_not_passed",
          skill,
          qualityReport: skill.qualityReport
        };
      }
      status = "published";
    } else if (["reject", "rejected"].includes(action)) {
      status = "rejected";
    } else if (["archive", "archived"].includes(action)) {
      status = "archived";
    } else if (["draft", "pending_review"].includes(action)) {
      status = action;
    } else {
      return {
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
        ok: false,
        error: "unsupported_skill_resolution",
        allowedActions: ["publish", "reject", "archive", "draft", "pending_review"]
      };
    }
    const now = nowIso();
    updateStatusStmt.run(status, now, status === "published" ? now : skill.publishedAt || "", skill.legacySkillId || skill.skillId || skillId);
    updatePlaybookStatusStmt.run(
      status,
      now,
      status === "published" ? now : skill.publishedAt || "",
      skill.playbookId || skillId,
      skill.legacySkillId || skill.skillId || skillId
    );
    const resolvedSkill = withPlaybookAliases({
      ...skill,
      status,
      updatedAt: now,
      publishedAt: status === "published" ? now : skill.publishedAt || ""
    });
    upsertSkillIndex(resolvedSkill);
    writeKnowledgeSkillBundle(rootPath, resolvedSkill);
    writeAgentLibraryPlaybookBundle(playbookRootPath, resolvedSkill);
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      ok: true,
      action,
      playbook: resolvedSkill,
      skill: resolvedSkill
    };
  }

  async function readJsonStore(filePath, fallback) {
    try {
      return JSON.parse(await fsp.readFile(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  async function writeJsonStore(filePath, value) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fsp.rename(tmpPath, filePath);
  }

  async function readSkillEvaluationRuns() {
    const playbookStore = await readJsonStore(playbookEvaluationRunsPath, null);
    if (playbookStore && Array.isArray(playbookStore.runs)) {
      return playbookStore;
    }
    return readJsonStore(skillEvaluationRunsPath, {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      runs: []
    });
  }

  async function writeSkillEvaluationRuns(runs = []) {
    const normalizedRuns = asArray(runs).slice(-200);
    await writeJsonStore(skillEvaluationRunsPath, {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      runs: normalizedRuns
    });
    await writeJsonStore(playbookEvaluationRunsPath, {
      protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      legacyProtocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      runs: normalizedRuns.map((run) => ({
        ...run,
        playbookSetVersion: run.playbookSetVersion || run.skillSetVersion || "",
        legacySkillSetVersion: run.skillSetVersion || "",
        caseResults: asArray(run.caseResults).map((item) => ({
          ...item,
          expectedPlaybookId: item.expectedPlaybookId || item.expectedSkillId || "",
          rankedPlaybookIds: asArray(item.rankedPlaybookIds || item.rankedSkillIds),
          expectedSkillId: item.expectedSkillId || item.expectedPlaybookId || "",
          rankedSkillIds: asArray(item.rankedSkillIds || item.rankedPlaybookIds)
        }))
      }))
    });
  }

  async function readSkillDeployments() {
    const playbookStore = await readJsonStore(playbookDeploymentsPath, null);
    if (playbookStore && Array.isArray(playbookStore.deployments)) {
      return playbookStore;
    }
    return readJsonStore(skillDeploymentsPath, {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      deployments: []
    });
  }

  async function writeSkillDeployments(deployments = []) {
    const normalizedDeployments = asArray(deployments).slice(-200);
    await writeJsonStore(skillDeploymentsPath, {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      deployments: normalizedDeployments
    });
    await writeJsonStore(playbookDeploymentsPath, {
      protocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      legacyProtocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      deployments: normalizedDeployments.map((deployment) => ({
        ...deployment,
        playbookSetVersion: deployment.playbookSetVersion || deployment.skillSetVersion || "",
        legacySkillSetVersion: deployment.skillSetVersion || "",
        playbookIds: asArray(deployment.playbookIds || deployment.skillIds),
        publishedPlaybookIds: asArray(deployment.publishedPlaybookIds || deployment.publishedSkillIds),
        skillIds: asArray(deployment.skillIds || deployment.playbookIds),
        publishedSkillIds: asArray(deployment.publishedSkillIds || deployment.publishedPlaybookIds)
      }))
    });
  }

  async function runSkillEvaluation(input = {}) {
    const startedAt = nowIso();
    const runId = normalizeText(input.runId || "") || stableId("skill_eval", startedAt, JSON.stringify(input.cases || []));
    const k = Math.max(1, Math.min(Number(input.k || input.limit || 10), 50));
    const goldCases = asArray(input.cases).length
      ? { items: asArray(input.cases) }
      : goldenRuleRuntime && typeof goldenRuleRuntime.listGoldCases === "function"
        ? await goldenRuleRuntime.listGoldCases({ limit: input.caseLimit || 100 })
        : { items: [] };
    const cases = asArray(goldCases.items).map((item, index) => ({
      caseId: normalizeText(item.caseId || item.id || `case-${index + 1}`),
      query: normalizeText(item.query || item.q || item.question || ""),
      expectedPlaybookId: normalizeText(item.expectedPlaybookId || item.playbookId || item.expectedSkillId || item.skillId || ""),
      expectedSkillId: normalizeText(item.expectedSkillId || item.skillId || item.expectedPlaybookId || item.playbookId || ""),
      requiredEvidenceIds: uniqueEvidenceRefs(asArray(item.requiredEvidenceIds || item.evidenceRefs).map((evidenceId) => ({ evidenceId }))),
      forbiddenEvidenceIds: uniqueEvidenceRefs(asArray(item.forbiddenEvidenceIds).map((evidenceId) => ({ evidenceId })))
    })).filter((item) => item.query);
    const caseResults = [];
    for (const testCase of cases) {
      const ranked = searchSkills({
        query: testCase.query,
        status: input.status || "",
        limit: k
      }).items;
      const rankedPlaybookIds = ranked.map((skill) => skill.playbookId || skill.skillId).filter(Boolean);
      const rankedSkillIds = ranked.map((skill) => skill.skillId || skill.legacySkillId || skill.playbookId).filter(Boolean);
      const rankedEvidenceIds = [
        ...new Set(ranked.flatMap((skill) => asArray(skill.evidenceRefs || skill.skill?.evidenceRefs)).filter(Boolean))
      ];
      const expectedPlaybookId = testCase.expectedPlaybookId || testCase.expectedSkillId;
      const skillHitIndex = expectedPlaybookId
        ? rankedPlaybookIds.findIndex((playbookId) => playbookId === expectedPlaybookId) >= 0
          ? rankedPlaybookIds.findIndex((playbookId) => playbookId === expectedPlaybookId)
          : rankedSkillIds.findIndex((skillId) => skillId === expectedPlaybookId)
        : -1;
      const requiredEvidence = new Set(testCase.requiredEvidenceIds);
      const evidenceHitCount = rankedEvidenceIds.filter((evidenceId) => requiredEvidence.has(evidenceId)).length;
      const forbiddenHitCount = rankedEvidenceIds.filter((evidenceId) => testCase.forbiddenEvidenceIds.includes(evidenceId)).length;
      caseResults.push({
        caseId: testCase.caseId,
        query: testCase.query,
        expectedPlaybookId,
        expectedSkillId: testCase.expectedSkillId,
        rankedPlaybookIds,
        rankedSkillIds,
        rankedEvidenceIds,
        metrics: {
          skillHit: !testCase.expectedSkillId || skillHitIndex >= 0,
          skillMrr: skillHitIndex >= 0 ? Number((1 / (skillHitIndex + 1)).toFixed(6)) : 0,
          evidenceRecall: requiredEvidence.size ? Number((evidenceHitCount / requiredEvidence.size).toFixed(6)) : 1,
          forbiddenEvidenceHitCount: forbiddenHitCount
        }
      });
    }
    const count = Math.max(1, caseResults.length);
    const metrics = {
      caseCount: caseResults.length,
      skillHitRate: Number((caseResults.filter((item) => item.metrics.skillHit).length / count).toFixed(6)),
      skillMrr: Number((caseResults.reduce((sum, item) => sum + item.metrics.skillMrr, 0) / count).toFixed(6)),
      evidenceRecall: Number((caseResults.reduce((sum, item) => sum + item.metrics.evidenceRecall, 0) / count).toFixed(6)),
      forbiddenEvidenceHitRate: Number((caseResults.filter((item) => item.metrics.forbiddenEvidenceHitCount > 0).length / count).toFixed(6))
    };
    const thresholds = {
      minSkillHitRate: Number(input.thresholds?.minSkillHitRate ?? 0),
      minEvidenceRecall: Number(input.thresholds?.minEvidenceRecall ?? 0),
      maxForbiddenEvidenceHitRate: Number(input.thresholds?.maxForbiddenEvidenceHitRate ?? 0)
    };
    const passed =
      caseResults.length > 0 &&
      metrics.skillHitRate >= thresholds.minSkillHitRate &&
      metrics.evidenceRecall >= thresholds.minEvidenceRecall &&
      metrics.forbiddenEvidenceHitRate <= thresholds.maxForbiddenEvidenceHitRate;
    const run = {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      runId,
      status: "completed",
      passed,
      k,
      playbookSetVersion: normalizeText(input.playbookSetVersion || input.skillSetVersion || ""),
      skillSetVersion: normalizeText(input.skillSetVersion || input.playbookSetVersion || ""),
      metrics,
      thresholds,
      caseResults,
      startedAt,
      finishedAt: nowIso(),
      recommendations: passed
        ? []
        : ["不要发布候选 PlaybookSet；先补充黄金样本、证据引用或专家规则。"]
    };
    const store = await readSkillEvaluationRuns();
    await writeSkillEvaluationRuns([...asArray(store.runs).filter((item) => item.runId !== runId), run]);
    return run;
  }

  async function listSkillEvaluationRuns(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 200));
    const store = await readSkillEvaluationRuns();
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      runs: asArray(store.runs)
        .slice()
        .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))
        .slice(0, limit)
        .map((run) => ({
          ...run,
          caseResults: input.includeCases === true ? run.caseResults : undefined
        }))
    };
  }

  async function createSkillDeployment(input = {}) {
    const startedAt = nowIso();
    const skillIds = uniqueEvidenceRefs(asArray(input.playbookIds || input.skillIds || input.playbooks || input.skills).map((skillId) => ({
      evidenceId: typeof skillId === "string" ? skillId : skillId?.playbookId || skillId?.skillId
    })));
    const playbookIds = skillIds;
    const status = normalizeText(input.status || input.publishMode || "canary") || "canary";
    const deploymentId = normalizeText(input.deploymentId || "") || stableId("playbook_deployment", status, startedAt, JSON.stringify(playbookIds));
    const skillSetVersion = normalizeText(input.skillSetVersion || input.playbookSetVersion || "") || `playbookset-${Date.now().toString(36)}`;
    const playbookSetVersion = normalizeText(input.playbookSetVersion || input.skillSetVersion || "") || skillSetVersion;
    let evaluationRun = null;
    if (input.evaluationRunId) {
      evaluationRun = asArray((await readSkillEvaluationRuns()).runs).find((run) => run.runId === input.evaluationRunId) || null;
    }
    if (input.force !== true && evaluationRun && evaluationRun.passed !== true) {
      return {
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
        ok: false,
        error: "skill_evaluation_not_passed",
        evaluationRun
      };
    }
    const skills = skillIds.map((skillId) => getSkill(skillId)).filter(Boolean);
    const publishable = skills.filter((skill) => skill.qualityReport?.passed === true);
    if (status === "active") {
      for (const skill of publishable) {
        resolveSkill({ skillId: skill.skillId, action: "publish", force: input.force === true });
      }
    }
    const deployment = {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      deploymentId,
      playbookSetVersion,
      skillSetVersion,
      status,
      trafficPercent: status === "active" ? 100 : Math.max(1, Math.min(Number(input.trafficPercent || 10), 100)),
      playbookIds,
      skillIds,
      publishedPlaybookIds: status === "active" ? publishable.map((skill) => skill.playbookId || skill.skillId) : [],
      publishedSkillIds: status === "active" ? publishable.map((skill) => skill.skillId) : [],
      baseline: input.baseline || null,
      metrics: evaluationRun?.metrics || input.metrics || {},
      gate: {
        evaluationRunId: input.evaluationRunId || "",
        evaluationPassed: evaluationRun ? evaluationRun.passed === true : input.force === true,
        forced: input.force === true
      },
      rollbackOf: normalizeText(input.rollbackOf || ""),
      createdAt: startedAt,
      updatedAt: startedAt
    };
    const store = await readSkillDeployments();
    await writeSkillDeployments([...asArray(store.deployments).filter((item) => item.deploymentId !== deploymentId), deployment]);
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      ok: true,
      deployment
    };
  }

  async function rollbackSkillDeployment(input = {}) {
    const deploymentId = normalizeText(input.deploymentId || input.id || "");
    const store = await readSkillDeployments();
    const current = asArray(store.deployments).find((item) => item.deploymentId === deploymentId);
    if (!current) {
      return null;
    }
    const timestamp = nowIso();
    const rollback = {
      ...current,
      deploymentId: normalizeText(input.rollbackDeploymentId || "") || stableId("playbook_deployment_rollback", deploymentId, timestamp),
      status: "rolled_back",
      rollbackOf: deploymentId,
      reason: normalizeText(input.reason || "manual_or_metric_rollback"),
      updatedAt: timestamp
    };
    await writeSkillDeployments([
      ...asArray(store.deployments).filter((item) => item.deploymentId !== rollback.deploymentId),
      rollback
    ]);
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      ok: true,
      deployment: rollback
    };
  }

  async function listSkillDeployments(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 200));
    const store = await readSkillDeployments();
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      deployments: asArray(store.deployments)
        .slice()
        .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
        .slice(0, limit)
    };
  }

  function buildContextForQuery(input = {}) {
    const result = searchSkills({
      query: input.query || input.q || "",
      status: input.status || "published",
      limit: input.limit || 3
    });
    const playbooks = result.items.map((item) => ({
      playbookId: item.playbookId || item.skillId,
      legacySkillId: item.legacySkillId || item.skillId,
      skillId: item.skillId,
      title: item.title,
      summary: item.summary,
      matchScore: item.matchScore,
      applicability: item.playbook?.applicability || item.skill?.applicability || {},
      coreConcepts: asArray(item.playbook?.coreConcepts || item.skill?.coreConcepts).slice(0, 8),
      decisionHeuristics: asArray(item.playbook?.decisionHeuristics || item.skill?.decisionHeuristics).slice(0, 8),
      antiPatterns: asArray(item.playbook?.antiPatterns || item.skill?.antiPatterns).slice(0, 6),
      honestBoundaries: asArray(item.playbook?.honestBoundaries || item.skill?.honestBoundaries).slice(0, 6),
      evidenceRefs: asArray(item.evidenceRefs).slice(0, 10)
    }));
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      query: result.query,
      playbooks,
      skills: playbooks
    };
  }

  function describe() {
    return {
      protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
      playbookProtocolVersion: AGENT_LIBRARY_PLAYBOOK_PROTOCOL_VERSION,
      name: "pact.agentLibrary.playbook-runtime",
      legacyName: "pact.knowledge.skill-runtime",
      purpose:
        "Distill evidence-backed knowledge into reusable, reviewable, and publishable AgentLibrary Playbook units.",
      storagePath: path.join(playbookRootPath, "agentlibrary-playbooks.sqlite"),
      legacyStoragePath: path.join(rootPath, "knowledge-skills.sqlite"),
      bundleRootPath: path.join(playbookRootPath, "bundles"),
      legacyBundleRootPath: path.join(rootPath, "bundles"),
      frameworkPath: path.join(rootPath, "framework.json"),
      playbookFrameworkPath: path.join(playbookRootPath, "framework.json"),
      migration: {
        primaryStore: "agentlibrary-playbooks",
        legacyStore: "knowledge-skills",
        dualWrite: true,
        legacyReadFallback: true,
        legacyDeleteAllowed: false
      },
      bundlePolicy: {
        enabled: true,
        lightweight: true,
        largeEvidencePayloadsCopied: false,
        manifestFile: "manifest.json",
        playbookFile: "playbook.json",
        legacySkillProjectionFile: "skill.json",
        dependencyManifestFile: "dependencies.json"
      },
      policies: {
        canonicalWritesAllowed: false,
        publishedPlaybookRequiresQualityGate: true,
        publishedSkillRequiresQualityGate: true,
        evidenceRefsRequired: true,
        modelUseRequiresExplicitEnable: true
      }
    };
  }

  return {
    protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
    describe,
    loadFramework,
    saveFramework,
    generateSkill,
    proposeSkill,
    listSkills,
    getSkill,
    searchSkills,
    runSkillEvaluation,
    listSkillEvaluationRuns,
    createSkillDeployment,
    rollbackSkillDeployment,
    listSkillDeployments,
    buildContextForQuery,
    resolveSkill,
    migrateLegacySkillsToPlaybooks,
    close() {
      db.close();
      playbookDb.close();
    }
  };
}

export function createAgentLibraryPlaybookRuntime(options = {}) {
  return createKnowledgeSkillRuntime(options);
}

export default createKnowledgeSkillRuntime;
