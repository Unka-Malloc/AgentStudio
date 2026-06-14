import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  BUNDLED_KNOWLEDGE_TAXONOMY_PATH,
  loadBundledKnowledgeTaxonomy,
  normalizeKnowledgeTaxonomy,
  taxonomyToExpertVocabularyEntries
} from "./default-taxonomy.mjs";
import { getEmailRulesPath, BUNDLED_EMAIL_RULES_PATH } from "../rules/email-rules.mjs";
import { getExpertVocabularyPath } from "../rules/expert-vocabulary.mjs";
import {
  atomicWriteFile,
  atomicWriteJson,
  queueStateMutation,
  waitForStateIdle
} from "../../../../../common/platform-core/state-coordinator.mjs";

export const KNOWLEDGE_TAXONOMY_FILE_NAME = "knowledge-taxonomy.json";

function getRulesDirectory(userDataPath) {
  return path.join(userDataPath, "rules");
}

export function getKnowledgeTaxonomyPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), KNOWLEDGE_TAXONOMY_FILE_NAME);
}

function getKnowledgeTaxonomyHistoryDirectory(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "history", "knowledge-taxonomy");
}

function checksumTaxonomy(value = {}) {
  const canonical = JSON.stringify({
    schemaVersion: value.schemaVersion,
    version: value.version,
    source: value.source,
    fallbackPath: value.fallbackPath,
    defaultIntent: value.defaultIntent,
    keywordStopwords: value.keywordStopwords || [],
    classifierPrompt: value.classifierPrompt || {},
    fallbackIntents: value.fallbackIntents || [],
    categories: (value.categories || []).map((entry) => ({
      categoryId: entry.categoryId,
      pathSegments: entry.pathSegments,
      label: entry.label,
      keywords: entry.keywords,
      domains: entry.domains,
      strongTerms: entry.strongTerms,
      weakTerms: entry.weakTerms,
      negativeTerms: entry.negativeTerms,
      queryTriggers: entry.queryTriggers,
      triggerAliases: entry.triggerAliases,
      expansionTerms: entry.expansionTerms,
      primaryTerms: entry.primaryTerms,
      anchorTerms: entry.anchorTerms,
      requiredTerms: entry.requiredTerms,
      contextSignals: entry.contextSignals,
      intentLabel: entry.intentLabel,
      minAlignmentScore: entry.minAlignmentScore,
      minPrimaryHits: entry.minPrimaryHits,
      minPositiveHits: entry.minPositiveHits,
      negativeDominance: entry.negativeDominance,
      notes: entry.notes
    }))
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function readJsonFileSync(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFileSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function uniqueStrings(values = [], limit = 160) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const item = normalizeText(value);
    if (!item) {
      continue;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function normalizePathSegments(value = {}) {
  const rawSegments = Array.isArray(value.pathSegments)
    ? value.pathSegments
    : normalizeText(value.path || value.categoryPath || value.label).split("/");
  return rawSegments.map(normalizeText).filter(Boolean);
}

function shortHash(value, length = 12) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function decorateTaxonomy(value = {}) {
  const normalized = normalizeKnowledgeTaxonomy(value);
  return {
    ...normalized,
    guidance: value.guidance && typeof value.guidance === "object" ? value.guidance : null,
    checksum: checksumTaxonomy(normalized)
  };
}

function seedExpertVocabularyForTaxonomy(taxonomy) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    version: 1,
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    source: "knowledge-taxonomy-derived",
    entries: taxonomyToExpertVocabularyEntries(taxonomy)
  };
}

function ensureJsonFileSync(filePath, seed) {
  if (!fs.existsSync(filePath)) {
    writeJsonFileSync(filePath, typeof seed === "function" ? seed() : seed);
  }
}

function normalizeExpertVocabularyForGuidance(value = {}) {
  return {
    schemaVersion: String(value.schemaVersion || "v0.0.1:schema:definition-1"),
    version: Number(value.version || 1),
    source: normalizeText(value.source || ""),
    updatedAt: normalizeText(value.updatedAt || ""),
    checksum: normalizeText(value.checksum || ""),
    entries: (Array.isArray(value.entries) ? value.entries : [])
      .map((entry, index) => {
        const pathSegments = normalizePathSegments(entry);
        const label = normalizeText(entry.label) || pathSegments.at(-1) || `专家词条 ${index + 1}`;
        return {
          id: normalizeText(entry.id) || `expert-vocab-${shortHash(pathSegments.join("/"))}`,
          pathSegments,
          path: pathSegments.join("/"),
          label,
          keywords: uniqueStrings(entry.keywords || entry.terms || []),
          domains: uniqueStrings(entry.domains || entry.emailDomains || []),
          status: normalizeText(entry.status || "active"),
          notes: normalizeText(entry.notes)
        };
      })
      .filter((entry) => entry.status !== "retired" && entry.pathSegments.length > 0)
  };
}

function normalizeEmailRulesForGuidance(value = {}) {
  return {
    schemaVersion: String(value.schemaVersion || "v0.0.1:schema:definition-1"),
    updatedAt: normalizeText(value.updatedAt || ""),
    reportSeries: (Array.isArray(value.reportSeries) ? value.reportSeries : [])
      .filter((entry) => entry?.enabled !== false)
      .map((entry, index) => ({
        id: normalizeText(entry.id) || `report-series-${index + 1}`,
        label: normalizeText(entry.label) || `报告序列 ${index + 1}`,
        enabled: entry.enabled === undefined ? true : entry.enabled !== false,
        cadence: normalizeText(entry.cadence || "irregular"),
        keywords: uniqueStrings(entry.keywords || [])
      }))
      .filter((entry) => entry.keywords.length > 0),
    synonymDictionary: (Array.isArray(value.synonymDictionary) ? value.synonymDictionary : [])
      .filter((entry) => entry?.enabled !== false)
      .map((entry) => {
        const canonical = normalizeText(entry.canonical);
        return {
          canonical,
          enabled: entry.enabled === undefined ? true : entry.enabled !== false,
          terms: uniqueStrings([canonical, ...(entry.terms || [])])
        };
      })
      .filter((entry) => entry.canonical && entry.terms.length > 0),
    departmentDictionary: (Array.isArray(value.departmentDictionary) ? value.departmentDictionary : [])
      .filter((entry) => entry?.enabled !== false)
      .map((entry) => ({
        department: normalizeText(entry.department),
        enabled: entry.enabled === undefined ? true : entry.enabled !== false,
        keywords: uniqueStrings(entry.keywords || []),
        emailKeywords: uniqueStrings(entry.emailKeywords || [])
      }))
      .filter((entry) => entry.department && (entry.keywords.length > 0 || entry.emailKeywords.length > 0)),
    keywordStopwords: uniqueStrings(value.keywordStopwords || [])
  };
}

function mergeCategoryTerms(category, terms = [], domains = []) {
  const safeTerms = uniqueStrings(terms, 160);
  const safeDomains = uniqueStrings(domains, 80);
  return {
    ...category,
    keywords: uniqueStrings([...(category.keywords || []), ...safeTerms], 160),
    domains: uniqueStrings([...(category.domains || []), ...safeDomains], 100),
    strongTerms: uniqueStrings([...(category.strongTerms || []), ...safeTerms], 160),
    expansionTerms: uniqueStrings([...(category.expansionTerms || []), ...safeTerms], 160),
    queryTriggers: uniqueStrings([...(category.queryTriggers || []), ...safeTerms], 160),
    primaryTerms: uniqueStrings([...(category.primaryTerms || []), ...safeTerms], 160),
    anchorTerms: uniqueStrings([...(category.anchorTerms || []), ...safeTerms], 160),
    requiredTerms: uniqueStrings([...(category.requiredTerms || []), ...safeTerms], 160)
  };
}

function existingCategoryTermKeys(category = {}) {
  return new Set(
    uniqueStrings([
      category.label,
      ...(category.pathSegments || []),
      ...(category.keywords || []),
      ...(category.strongTerms || []),
      ...(category.weakTerms || []),
      ...(category.queryTriggers || []),
      ...(category.expansionTerms || []),
      ...(category.primaryTerms || []),
      ...(category.anchorTerms || []),
      ...(category.requiredTerms || [])
    ], 320).map((item) => item.toLowerCase())
  );
}

function newExpertTermsForExistingCategory(entry, category) {
  const existingKeys = existingCategoryTermKeys(category);
  return uniqueStrings([
    entry.label,
    ...entry.keywords
  ], 160).filter((term) => !existingKeys.has(term.toLowerCase()));
}

function dynamicCategory({
  categoryId,
  pathSegments,
  label,
  terms = [],
  queryTerms = terms,
  domains = [],
  notes = "",
  intentLabel = ""
}) {
  const safeTerms = uniqueStrings(terms, 160);
  const safeQueryTerms = uniqueStrings(queryTerms, 80);
  return {
    categoryId,
    pathSegments,
    path: pathSegments.join("/"),
    label: label || pathSegments.at(-1) || categoryId,
    keywords: safeTerms,
    domains: uniqueStrings(domains, 80),
    strongTerms: safeTerms,
    weakTerms: [],
    negativeTerms: [],
    queryTriggers: safeQueryTerms,
    triggerAliases: {},
    expansionTerms: safeTerms,
    primaryTerms: safeTerms,
    anchorTerms: safeTerms,
    requiredTerms: safeTerms,
    contextSignals: [],
    intentLabel: intentLabel || pathSegments.join("/"),
    minAlignmentScore: 0.2,
    minPrimaryHits: 1,
    minPositiveHits: 1,
    negativeDominance: 2,
    notes
  };
}

export function compileKnowledgeGuidance({ taxonomy, expertVocabulary = {}, emailRules = {} } = {}) {
  const baseTaxonomy = decorateTaxonomy(taxonomy || loadBundledKnowledgeTaxonomy());
  const vocabulary = normalizeExpertVocabularyForGuidance(expertVocabulary);
  const rules = normalizeEmailRulesForGuidance(emailRules);
  const categoriesByPath = new Map(baseTaxonomy.categories.map((entry) => [entry.path, { ...entry }]));

  for (const entry of vocabulary.entries) {
    const dynamicCategoryTerms = uniqueStrings([
      entry.label,
      ...entry.pathSegments,
      ...entry.keywords
    ], 160);
    const existing = categoriesByPath.get(entry.path);
    if (existing) {
      const addedTerms = newExpertTermsForExistingCategory(entry, existing);
      categoriesByPath.set(entry.path, mergeCategoryTerms(existing, addedTerms, entry.domains));
      continue;
    }
    categoriesByPath.set(entry.path, dynamicCategory({
      categoryId: `expert_${shortHash(entry.path)}`,
      pathSegments: entry.pathSegments,
      label: entry.label,
      terms: dynamicCategoryTerms,
      queryTerms: uniqueStrings([entry.label, ...entry.keywords], 80),
      domains: entry.domains,
      notes: entry.notes,
      intentLabel: entry.path
    }));
  }

  for (const series of rules.reportSeries) {
    const pathSegments = ["邮件规则", "报告序列", series.label];
    const pathKey = pathSegments.join("/");
    categoriesByPath.set(pathKey, dynamicCategory({
      categoryId: `email_report_${shortHash(series.id || series.label)}`,
      pathSegments,
      label: series.label,
      terms: [series.label, series.cadence, ...series.keywords],
      notes: "由 email-rules.json reportSeries 动态生成。",
      intentLabel: series.label
    }));
  }

  for (const synonym of rules.synonymDictionary) {
    const pathSegments = ["邮件规则", "同义词", synonym.canonical];
    const pathKey = pathSegments.join("/");
    categoriesByPath.set(pathKey, dynamicCategory({
      categoryId: `email_synonym_${shortHash(synonym.canonical)}`,
      pathSegments,
      label: synonym.canonical,
      terms: synonym.terms,
      notes: "由 email-rules.json synonymDictionary 动态生成。",
      intentLabel: synonym.canonical
    }));
  }

  for (const department of rules.departmentDictionary) {
    const pathSegments = ["组织", "部门", department.department];
    const pathKey = pathSegments.join("/");
    categoriesByPath.set(pathKey, dynamicCategory({
      categoryId: `email_department_${shortHash(department.department)}`,
      pathSegments,
      label: department.department,
      terms: [department.department, ...department.keywords, ...department.emailKeywords],
      notes: "由 email-rules.json departmentDictionary 动态生成。",
      intentLabel: department.department
    }));
  }

  const guidance = {
    taxonomy: {
      version: baseTaxonomy.version,
      checksum: baseTaxonomy.checksum || "",
      categoryCount: baseTaxonomy.categories.length
    },
    expertVocabulary: {
      version: vocabulary.version,
      source: vocabulary.source,
      updatedAt: vocabulary.updatedAt,
      entryCount: vocabulary.entries.length
    },
    emailRules: {
      updatedAt: rules.updatedAt,
      reportSeriesCount: rules.reportSeries.length,
      synonymCount: rules.synonymDictionary.length,
      departmentCount: rules.departmentDictionary.length
    }
  };
  const compiled = decorateTaxonomy({
    ...baseTaxonomy,
    source: `${baseTaxonomy.source || "knowledge-taxonomy"}+expert-vocabulary+email-rules`,
    keywordStopwords: uniqueStrings([
      ...(baseTaxonomy.keywordStopwords || []),
      ...rules.keywordStopwords
    ]),
    categories: [...categoriesByPath.values()],
    guidance
  });
  return {
    ...compiled,
    guidance: {
      ...guidance,
      compiled: {
        categoryCount: compiled.categories.length,
        checksum: compiled.checksum || ""
      }
    }
  };
}

function loadBundledEmailRules() {
  return readJsonFileSync(BUNDLED_EMAIL_RULES_PATH, {});
}

function ensureExpertVocabularyFileSync(userDataPath, taxonomy) {
  const vocabularyPath = getExpertVocabularyPath(userDataPath);
  ensureJsonFileSync(vocabularyPath, () => seedExpertVocabularyForTaxonomy(taxonomy));
  return vocabularyPath;
}

function ensureEmailRulesFileSync(userDataPath) {
  const rulesPath = getEmailRulesPath(userDataPath);
  ensureJsonFileSync(rulesPath, () => ({
    ...loadBundledEmailRules(),
    updatedAt: new Date().toISOString()
  }));
  return rulesPath;
}

function loadBaseTaxonomySync(userDataPath) {
  const taxonomyPath = ensureKnowledgeTaxonomyFileSync(userDataPath);
  try {
    return decorateTaxonomy(JSON.parse(fs.readFileSync(taxonomyPath, "utf8")));
  } catch {
    const fallback = decorateTaxonomy(loadBundledKnowledgeTaxonomy({ reload: true }));
    writeTaxonomyFileSync(taxonomyPath, fallback);
    return fallback;
  }
}

function loadExpertVocabularySync(userDataPath, taxonomy) {
  const vocabularyPath = ensureExpertVocabularyFileSync(userDataPath, taxonomy);
  return readJsonFileSync(vocabularyPath, seedExpertVocabularyForTaxonomy(taxonomy));
}

function loadEmailRulesSync(userDataPath) {
  const rulesPath = ensureEmailRulesFileSync(userDataPath);
  return readJsonFileSync(rulesPath, loadBundledEmailRules());
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

function runtimeSignature(paths = []) {
  return paths.map((filePath) => `${filePath}:${fileMtimeMs(filePath)}`).join("|");
}

async function writeTaxonomyFile(taxonomyPath, taxonomy) {
  await atomicWriteJson(taxonomyPath, taxonomy);
}

function writeTaxonomyFileSync(taxonomyPath, taxonomy) {
  fs.mkdirSync(path.dirname(taxonomyPath), { recursive: true });
  fs.writeFileSync(taxonomyPath, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
}

export async function ensureKnowledgeTaxonomyFile(userDataPath) {
  const taxonomyPath = getKnowledgeTaxonomyPath(userDataPath);
  try {
    await fsp.access(taxonomyPath);
  } catch {
    const now = new Date().toISOString();
    const seed = decorateTaxonomy({
      ...loadBundledKnowledgeTaxonomy(),
      updatedAt: now,
      publishedAt: now
    });
    await writeTaxonomyFile(taxonomyPath, seed);
  }
  return taxonomyPath;
}

export function ensureKnowledgeTaxonomyFileSync(userDataPath) {
  const taxonomyPath = getKnowledgeTaxonomyPath(userDataPath);
  if (!fs.existsSync(taxonomyPath)) {
    const now = new Date().toISOString();
    const seed = decorateTaxonomy({
      ...loadBundledKnowledgeTaxonomy(),
      updatedAt: now,
      publishedAt: now
    });
    writeTaxonomyFileSync(taxonomyPath, seed);
  }
  return taxonomyPath;
}

function knowledgeTaxonomyStateKey(userDataPath) {
  return `knowledge-taxonomy:${path.resolve(userDataPath)}`;
}

async function loadKnowledgeTaxonomyUnlocked(userDataPath) {
  const taxonomyPath = await ensureKnowledgeTaxonomyFile(userDataPath);
  try {
    const parsed = JSON.parse(await fsp.readFile(taxonomyPath, "utf8"));
    const normalized = decorateTaxonomy(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeTaxonomyFile(taxonomyPath, normalized);
    }
    return normalized;
  } catch {
    const fallback = decorateTaxonomy(loadBundledKnowledgeTaxonomy({ reload: true }));
    await writeTaxonomyFile(taxonomyPath, fallback);
    return fallback;
  }
}

export async function loadKnowledgeTaxonomy(userDataPath) {
  await waitForStateIdle(knowledgeTaxonomyStateKey(userDataPath));
  return loadKnowledgeTaxonomyUnlocked(userDataPath);
}

export async function loadKnowledgeGuidance(userDataPath) {
  if (!userDataPath) {
    const bundledTaxonomy = loadBundledKnowledgeTaxonomy();
    return compileKnowledgeGuidance({
      taxonomy: bundledTaxonomy,
      expertVocabulary: seedExpertVocabularyForTaxonomy(bundledTaxonomy),
      emailRules: loadBundledEmailRules()
    });
  }
  const taxonomy = await loadKnowledgeTaxonomy(userDataPath);
  const expertVocabulary = loadExpertVocabularySync(userDataPath, taxonomy);
  const emailRules = loadEmailRulesSync(userDataPath);
  return compileKnowledgeGuidance({
    taxonomy,
    expertVocabulary,
    emailRules
  });
}

export async function saveKnowledgeTaxonomy(userDataPath, incomingTaxonomy) {
  return queueStateMutation(knowledgeTaxonomyStateKey(userDataPath), async () => {
  const taxonomyPath = await ensureKnowledgeTaxonomyFile(userDataPath);
  const current = await loadKnowledgeTaxonomyUnlocked(userDataPath);
  const now = new Date().toISOString();
  const next = decorateTaxonomy({
    ...current,
    ...(incomingTaxonomy || {}),
    categories:
      incomingTaxonomy?.categories === undefined
        ? current.categories
        : incomingTaxonomy.categories,
    version: current.version + 1,
    updatedAt: now,
    publishedAt: now
  });

  try {
    const previousContent = await fsp.readFile(taxonomyPath, "utf8");
    const historyPath = path.join(
      getKnowledgeTaxonomyHistoryDirectory(userDataPath),
      `knowledge-taxonomy.v${current.version}.${Date.now()}.json`
    );
    await fsp.mkdir(path.dirname(historyPath), { recursive: true });
    await atomicWriteFile(historyPath, previousContent, "utf8");
  } catch {
    // The first save has no previous version to archive.
  }

  await writeTaxonomyFile(taxonomyPath, next);
  return next;
  });
}

export async function getKnowledgeTaxonomySummary(userDataPath) {
  const taxonomy = await loadKnowledgeTaxonomy(userDataPath);
  return {
    path: getKnowledgeTaxonomyPath(userDataPath),
    bundledPath: BUNDLED_KNOWLEDGE_TAXONOMY_PATH,
    schemaVersion: taxonomy.schemaVersion,
    version: taxonomy.version,
    source: taxonomy.source,
    updatedAt: taxonomy.updatedAt,
    publishedAt: taxonomy.publishedAt,
    checksum: taxonomy.checksum,
    categoryCount: taxonomy.categories.length
  };
}

export async function getKnowledgeGuidanceSummary(userDataPath) {
  const guidance = await loadKnowledgeGuidance(userDataPath);
  return {
    taxonomyPath: getKnowledgeTaxonomyPath(userDataPath),
    expertVocabularyPath: getExpertVocabularyPath(userDataPath),
    emailRulesPath: getEmailRulesPath(userDataPath),
    schemaVersion: guidance.schemaVersion,
    version: guidance.version,
    source: guidance.source,
    checksum: guidance.checksum,
    categoryCount: guidance.categories.length,
    guidance: guidance.guidance
  };
}

export async function listKnowledgeTaxonomyVersions(userDataPath) {
  const current = await getKnowledgeTaxonomySummary(userDataPath);
  let history = [];
  try {
    const historyDirectory = getKnowledgeTaxonomyHistoryDirectory(userDataPath);
    const names = await fsp.readdir(historyDirectory);
    history = names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50)
      .map((name) => {
        const match = name.match(/\.v(\d+)\.(\d+)\.json$/);
        return {
          version: match ? Number(match[1]) : 0,
          archivedAt: match ? new Date(Number(match[2])).toISOString() : "",
          path: path.join(historyDirectory, name)
        };
      });
  } catch {
    history = [];
  }
  return {
    current,
    history
  };
}

export function createKnowledgeTaxonomyRuntime(userDataPath) {
  const taxonomyPath = ensureKnowledgeTaxonomyFileSync(userDataPath);
  let cachedGuidance = null;
  let cachedSignature = "";

  function loadSync() {
    const baseTaxonomy = loadBaseTaxonomySync(userDataPath);
    const expertVocabularyPath = ensureExpertVocabularyFileSync(userDataPath, baseTaxonomy);
    const emailRulesPath = ensureEmailRulesFileSync(userDataPath);
    const signature = runtimeSignature([taxonomyPath, expertVocabularyPath, emailRulesPath]);
    if (cachedGuidance && cachedSignature === signature) {
      return cachedGuidance;
    }
    try {
      cachedGuidance = compileKnowledgeGuidance({
        taxonomy: baseTaxonomy,
        expertVocabulary: readJsonFileSync(expertVocabularyPath, seedExpertVocabularyForTaxonomy(baseTaxonomy)),
        emailRules: readJsonFileSync(emailRulesPath, loadBundledEmailRules())
      });
      cachedSignature = signature;
      return cachedGuidance;
    } catch {
      const bundledTaxonomy = loadBundledKnowledgeTaxonomy();
      cachedGuidance = compileKnowledgeGuidance({
        taxonomy: bundledTaxonomy,
        expertVocabulary: seedExpertVocabularyForTaxonomy(bundledTaxonomy),
        emailRules: loadBundledEmailRules()
      });
      cachedSignature = "";
      return cachedGuidance;
    }
  }

  return {
    path: taxonomyPath,
    taxonomyPath,
    expertVocabularyPath: getExpertVocabularyPath(userDataPath),
    emailRulesPath: getEmailRulesPath(userDataPath),
    loadSync
  };
}
