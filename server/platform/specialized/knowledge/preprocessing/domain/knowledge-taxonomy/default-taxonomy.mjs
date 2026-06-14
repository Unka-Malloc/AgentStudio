import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_TAXONOMY_SCHEMA_VERSION = "v0.0.1:knowledge:taxonomy-schema-1";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_KNOWLEDGE_TAXONOMY_PATH = path.resolve(
  moduleDirectory,
  "../../../../../../config/default-knowledge-taxonomy.json"
);

let bundledTaxonomyCache = null;

function uniqueStrings(values = [], limit = 120) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const item = normalizeTaxonomyText(value);
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

function readJsonFileSync(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function normalizeTaxonomyText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function tokenizeTaxonomyText(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[\p{L}\p{N}_+-]+/gu) || []
    )
  ].filter((token) => token.length > 0 && token.length <= 64);
}

export function taxonomyIncludesTerm(text, term) {
  const normalizedText = normalizeTaxonomyText(text).toLowerCase();
  const normalizedTerm = normalizeTaxonomyText(term).toLowerCase();
  if (!normalizedText || !normalizedTerm) {
    return false;
  }
  if (normalizedTerm.includes(" ")) {
    return normalizedText.includes(normalizedTerm);
  }
  return normalizedText.includes(normalizedTerm) || new Set(tokenizeTaxonomyText(normalizedText)).has(normalizedTerm);
}

export function matchedTaxonomyTerms(text, terms = []) {
  return uniqueStrings(terms).filter((term) => taxonomyIncludesTerm(text, term));
}

function normalizeTriggerAliases(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([trigger, aliases]) => [
      normalizeTaxonomyText(trigger).toLowerCase(),
      uniqueStrings(aliases)
    ])
  );
}

function normalizePathSegments(entry = {}) {
  const rawSegments = Array.isArray(entry.pathSegments)
    ? entry.pathSegments
    : normalizeTaxonomyText(entry.path || entry.categoryPath || entry.label).split("/");
  return rawSegments.map(normalizeTaxonomyText).filter(Boolean);
}

function normalizeCategory(entry = {}, index = 0) {
  const pathSegments = normalizePathSegments(entry);
  const categoryId = normalizeTaxonomyText(entry.categoryId || entry.id) || `category-${index + 1}`;
  const keywords = uniqueStrings(entry.keywords || entry.terms || []);
  const strongTerms = uniqueStrings(
    entry.strongTerms?.length ? entry.strongTerms : [...keywords, ...(entry.primaryTerms || []), ...(entry.queryTriggers || [])]
  );
  const weakTerms = uniqueStrings(entry.weakTerms || []);
  const queryTriggers = uniqueStrings(entry.queryTriggers || []);
  const expansionTerms = uniqueStrings(
    entry.expansionTerms?.length ? entry.expansionTerms : [...strongTerms, ...weakTerms],
    100
  );
  const primaryTerms = uniqueStrings(
    entry.primaryTerms?.length ? entry.primaryTerms : [...queryTriggers, ...strongTerms, ...keywords],
    80
  );
  const anchorTerms = uniqueStrings(
    entry.anchorTerms?.length ? entry.anchorTerms : [...primaryTerms, ...strongTerms],
    80
  );
  const requiredTerms = uniqueStrings(
    entry.requiredTerms?.length ? entry.requiredTerms : [...strongTerms, ...weakTerms]
  );

  return {
    categoryId,
    pathSegments,
    path: pathSegments.join("/"),
    label: normalizeTaxonomyText(entry.label) || pathSegments.at(-1) || categoryId,
    keywords,
    domains: uniqueStrings(entry.domains || entry.emailDomains || []),
    strongTerms,
    weakTerms,
    negativeTerms: uniqueStrings(entry.negativeTerms || []),
    queryTriggers,
    triggerAliases: normalizeTriggerAliases(entry.triggerAliases || {}),
    expansionTerms,
    primaryTerms,
    anchorTerms,
    requiredTerms,
    contextSignals: uniqueStrings(entry.contextSignals || []),
    intentLabel: normalizeTaxonomyText(entry.intentLabel) || pathSegments.join("/"),
    minAlignmentScore: Number.isFinite(Number(entry.minAlignmentScore)) ? Number(entry.minAlignmentScore) : 0.25,
    minPrimaryHits: Number.isFinite(Number(entry.minPrimaryHits)) ? Number(entry.minPrimaryHits) : 1,
    minPositiveHits: Number.isFinite(Number(entry.minPositiveHits)) ? Number(entry.minPositiveHits) : 1,
    negativeDominance: Number.isFinite(Number(entry.negativeDominance)) ? Number(entry.negativeDominance) : 2,
    notes: normalizeTaxonomyText(entry.notes)
  };
}

function normalizeFallbackIntent(entry = {}, index = 0) {
  return {
    intent: normalizeTaxonomyText(entry.intent || entry.label) || `intent-${index + 1}`,
    terms: uniqueStrings(entry.terms || entry.keywords || [])
  };
}

export function normalizeKnowledgeTaxonomy(value = {}, context = {}) {
  const categories = (Array.isArray(value.categories) ? value.categories : [])
    .map(normalizeCategory)
    .filter((entry) => entry.categoryId && entry.pathSegments.length > 0);
  return {
    schemaVersion: KNOWLEDGE_TAXONOMY_SCHEMA_VERSION,
    version: Math.max(1, Number(value.version || context.version || 1)),
    source: normalizeTaxonomyText(value.source || context.source),
    updatedAt: normalizeTaxonomyText(value.updatedAt || context.updatedAt),
    publishedAt: normalizeTaxonomyText(value.publishedAt || context.publishedAt || value.updatedAt),
    fallbackPath: normalizeTaxonomyText(value.fallbackPath || context.fallbackPath),
    defaultIntent: normalizeTaxonomyText(value.defaultIntent || context.defaultIntent),
    keywordStopwords: uniqueStrings(value.keywordStopwords || []),
    classifierPrompt: value.classifierPrompt && typeof value.classifierPrompt === "object"
      ? value.classifierPrompt
      : {},
    fallbackIntents: (Array.isArray(value.fallbackIntents) ? value.fallbackIntents : [])
      .map(normalizeFallbackIntent)
      .filter((entry) => entry.intent && entry.terms.length > 0),
    categories
  };
}

export function loadBundledKnowledgeTaxonomy({ reload = false } = {}) {
  if (!bundledTaxonomyCache || reload) {
    bundledTaxonomyCache = normalizeKnowledgeTaxonomy(
      readJsonFileSync(BUNDLED_KNOWLEDGE_TAXONOMY_PATH, {}),
      { source: "bundled-knowledge-taxonomy" }
    );
  }
  return bundledTaxonomyCache;
}

function taxonomyFromInput(taxonomy = null) {
  if (taxonomy?.categories) {
    return taxonomy;
  }
  return loadBundledKnowledgeTaxonomy();
}

export function taxonomyPaths(taxonomy = null) {
  const activeTaxonomy = taxonomyFromInput(taxonomy);
  return [
    ...activeTaxonomy.categories.map((entry) => entry.path),
    activeTaxonomy.fallbackPath
  ].filter(Boolean);
}

export function taxonomyToExpertVocabularyEntries(taxonomy = null) {
  const activeTaxonomy = taxonomyFromInput(taxonomy);
  return activeTaxonomy.categories.map((entry) => ({
    path: entry.path,
    keywords: uniqueStrings([...entry.keywords, ...entry.strongTerms, ...entry.weakTerms], 40),
    domains: entry.domains,
    notes: entry.notes
  }));
}

export function localClassificationRulesFromTaxonomy(taxonomy = null) {
  const activeTaxonomy = taxonomyFromInput(taxonomy);
  return activeTaxonomy.categories.map((entry) => ({
    path: entry.path,
    keywords: uniqueStrings([...entry.strongTerms, ...entry.weakTerms], 60),
    negativeTerms: entry.negativeTerms,
    categoryId: entry.categoryId,
    intentLabel: entry.intentLabel
  }));
}

export function queryIntentProfilesFromTaxonomy(taxonomy = null) {
  const activeTaxonomy = taxonomyFromInput(taxonomy);
  return activeTaxonomy.categories
    .filter((entry) => entry.queryTriggers.length > 0)
    .map((entry) => ({
      intentId: entry.categoryId,
      label: entry.intentLabel,
      taxonomyPath: entry.path,
      triggers: entry.queryTriggers,
      triggerAliases: entry.triggerAliases,
      expansionTerms: entry.expansionTerms,
      primaryTerms: entry.primaryTerms,
      anchorTerms: entry.anchorTerms,
      requiredTerms: entry.requiredTerms,
      weakTerms: entry.weakTerms,
      negativeTerms: entry.negativeTerms,
      contextSignals: entry.contextSignals,
      minAlignmentScore: entry.minAlignmentScore,
      minPrimaryHits: entry.minPrimaryHits,
      minPositiveHits: entry.minPositiveHits,
      negativeDominance: entry.negativeDominance
    }));
}

function profilesFromInput(taxonomyOrProfiles = null) {
  if (Array.isArray(taxonomyOrProfiles)) {
    return taxonomyOrProfiles;
  }
  return queryIntentProfilesFromTaxonomy(taxonomyOrProfiles);
}

export function resolveQueryIntentProfile(query, taxonomyOrProfiles = null) {
  const normalized = normalizeTaxonomyText(query).toLowerCase();
  if (!normalized) {
    return null;
  }
  const profiles = profilesFromInput(taxonomyOrProfiles);
  const queryTokenSet = new Set(tokenizeTaxonomyText(normalized));
  const resolved = profiles.find((profile) =>
    (profile.triggers || []).some((trigger) => {
      const term = normalizeTaxonomyText(trigger).toLowerCase();
      return term && (normalized.includes(term) || queryTokenSet.has(term));
    })
  );
  if (!resolved) {
    return null;
  }
  const matchedTriggers = (resolved.triggers || []).filter((trigger) => {
    const term = normalizeTaxonomyText(trigger).toLowerCase();
    return term && (normalized.includes(term) || queryTokenSet.has(term));
  });
  const queryAnchorTerms = uniqueStrings(
    matchedTriggers.flatMap((trigger) => {
      const key = normalizeTaxonomyText(trigger).toLowerCase();
      return resolved.triggerAliases?.[key]?.length
        ? resolved.triggerAliases[key]
        : [trigger, ...(resolved.anchorTerms || [])];
    }),
    80
  );
  return {
    ...resolved,
    matchedTriggers,
    queryAnchorTerms
  };
}

export function queryTermsForIntentSearch(baseTerms = [], intentProfile = null, limit = 80) {
  if (!intentProfile) {
    return uniqueStrings(baseTerms, limit);
  }
  if (intentProfile.queryAnchorTerms?.length) {
    return uniqueStrings([
      ...baseTerms,
      ...intentProfile.queryAnchorTerms
    ], limit);
  }
  return uniqueStrings([
    ...baseTerms,
    ...(intentProfile.expansionTerms || []),
    ...(intentProfile.primaryTerms || [])
  ], limit);
}

function detectContextSignals(text, signals = []) {
  const normalized = normalizeTaxonomyText(text);
  const hits = [];
  if (signals.includes("money") && /[$€£¥]\s*\d|\b\d+(?:[.,]\d{2})?\s*(usd|gbp|eur|cny|rmb)\b/i.test(normalized)) {
    hits.push("money");
  }
  return hits;
}

export function evaluateQueryIntentText(text, intentProfile = null) {
  if (!intentProfile) {
    return {
      intentId: "",
      aligned: true,
      score: 0,
      positiveHits: [],
      negativeHits: [],
      weakHits: [],
      contextHits: []
    };
  }
  const primaryHits = matchedTaxonomyTerms(text, intentProfile.primaryTerms);
  const anchorHits = matchedTaxonomyTerms(text, intentProfile.anchorTerms || intentProfile.primaryTerms);
  const queryAnchorHits = matchedTaxonomyTerms(text, intentProfile.queryAnchorTerms || []);
  const requiredHits = matchedTaxonomyTerms(text, intentProfile.requiredTerms);
  const weakHits = matchedTaxonomyTerms(text, intentProfile.weakTerms);
  const negativeHits = matchedTaxonomyTerms(text, intentProfile.negativeTerms);
  const contextHits = detectContextSignals(text, intentProfile.contextSignals);
  const positiveHits = uniqueStrings([...primaryHits, ...requiredHits]);
  const primaryScore = primaryHits.length * 0.18 + anchorHits.length * 0.14 + queryAnchorHits.length * 0.28;
  const requiredScore = requiredHits.length * 0.16;
  const weakScore = weakHits.length * 0.07;
  const contextScore = contextHits.length * 0.14;
  const negativeScore = negativeHits.length * 0.16;
  const score = Math.max(-1, Math.min(1, primaryScore + requiredScore + weakScore + contextScore - negativeScore));
  const minScore = Number(intentProfile.minAlignmentScore ?? 0.25);
  const minPrimaryHits = Number(intentProfile.minPrimaryHits ?? 1);
  const minPositiveHits = Number(intentProfile.minPositiveHits ?? 1);
  const negativeDominance = Number(intentProfile.negativeDominance ?? 2);
  const blockingNegativeHits = negativeHits.filter((term) =>
    !["unsubscribe", "marketing"].includes(normalizeTaxonomyText(term).toLowerCase())
  );
  const hasPrimarySignal = anchorHits.length >= minPrimaryHits;
  const hasQueryAnchor = !intentProfile.queryAnchorTerms?.length || queryAnchorHits.length > 0;
  const hasPositiveSignal = positiveHits.length >= minPositiveHits;
  const negativeDominates =
    negativeHits.length >= negativeDominance &&
    (
      primaryHits.length < minPrimaryHits + 1 ||
      (blockingNegativeHits.length >= negativeDominance && primaryHits.length < minPrimaryHits + 2)
    );
  const aligned = hasQueryAnchor && hasPrimarySignal && hasPositiveSignal && score >= minScore && !negativeDominates;

  return {
    intentId: intentProfile.intentId,
    label: intentProfile.label,
    taxonomyPath: intentProfile.taxonomyPath,
    aligned,
    score: Number(score.toFixed(6)),
    positiveHits: positiveHits.slice(0, 8),
    primaryHits: primaryHits.slice(0, 8),
    anchorHits: anchorHits.slice(0, 8),
    queryAnchorHits: queryAnchorHits.slice(0, 8),
    weakHits: weakHits.slice(0, 8),
    negativeHits: negativeHits.slice(0, 8),
    contextHits
  };
}

export function classifyTextByKnowledgeTaxonomy(text, { taxonomy = null, fallbackPath = "" } = {}) {
  const activeTaxonomy = taxonomyFromInput(taxonomy);
  let best = {
    categoryId: "",
    path: normalizeTaxonomyText(fallbackPath || activeTaxonomy.fallbackPath),
    score: 0,
    confidence: 0.35,
    positiveHits: [],
    negativeHits: [],
    intentLabel: activeTaxonomy.defaultIntent
  };
  const profiles = queryIntentProfilesFromTaxonomy(activeTaxonomy);
  for (const categoryEntry of activeTaxonomy.categories) {
    const profile = profiles.find((entry) => entry.intentId === categoryEntry.categoryId) || {
      intentId: categoryEntry.categoryId,
      label: categoryEntry.intentLabel,
      taxonomyPath: categoryEntry.path,
      primaryTerms: categoryEntry.primaryTerms,
      anchorTerms: categoryEntry.anchorTerms,
      requiredTerms: categoryEntry.requiredTerms,
      weakTerms: categoryEntry.weakTerms,
      negativeTerms: categoryEntry.negativeTerms,
      contextSignals: categoryEntry.contextSignals,
      minAlignmentScore: categoryEntry.minAlignmentScore,
      minPrimaryHits: categoryEntry.minPrimaryHits,
      minPositiveHits: categoryEntry.minPositiveHits,
      negativeDominance: categoryEntry.negativeDominance
    };
    const evaluation = evaluateQueryIntentText(text, profile);
    if (evaluation.score > best.score) {
      best = {
        categoryId: categoryEntry.categoryId,
        path: categoryEntry.path,
        score: evaluation.score,
        confidence: Math.max(0.4, Math.min(0.92, 0.42 + evaluation.score * 0.42)),
        positiveHits: evaluation.positiveHits,
        negativeHits: evaluation.negativeHits,
        intentLabel: categoryEntry.intentLabel
      };
    }
  }
  return best;
}
