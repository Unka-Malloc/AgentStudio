import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  waitForStateIdle
} from "../../../../../common/platform-core/state-coordinator.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_SOURCE_SEARCH_RULES_PATH = path.resolve(
  moduleDirectory,
  "../../../../../../config/default-source-search-rules.json"
);

function loadBundledSourceSearchRules() {
  try {
    return JSON.parse(fsSync.readFileSync(BUNDLED_SOURCE_SEARCH_RULES_PATH, "utf8"));
  } catch {
    return {
      schemaVersion: "v0.0.1:schema:definition-1",
      updatedAt: "",
      maxFileBytes: 5 * 1024 * 1024,
      maxEvidenceBytes: 512 * 1024,
      maxScanFiles: 1000000,
	      readConcurrency: 64,
	      indexConcurrency: 32,
	      indexMaxTermsPerFile: 20000,
	      cacheTtlMs: 5 * 60 * 1000,
	      includeKnowledgeSources: true,
	      useInvertedIndex: true,
	      scanFallbackWhenIndexMissing: false,
	      knowledgeSourceExtensions: [".eml"],
	      ignoredDirectories: [],
	      scanRoots: [],
	      queryExpansions: [],
      snippetWindow: 220
    };
  }
}

export const DEFAULT_SOURCE_SEARCH_RULES = loadBundledSourceSearchRules();

function getRulesDirectory(userDataPath) {
  return path.join(userDataPath, "rules");
}

export function getSourceSearchRulesPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "source-search-rules.json");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeExtension(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function normalizeScanRoots(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const relativePath = normalizeText(entry?.relativePath || entry?.path);
      return {
        id: normalizeText(entry?.id) || `source-root-${index + 1}`,
        label: normalizeText(entry?.label) || normalizeText(entry?.id) || `Source root ${index + 1}`,
        relativePath,
        extensions: uniqueStrings(entry?.extensions || []).map(normalizeExtension).filter(Boolean),
        enabled: entry?.enabled !== false
      };
    })
    .filter((entry) => entry.relativePath && entry.extensions.length > 0);
}

function normalizeQueryExpansions(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => ({
      id: normalizeText(entry?.id) || `query-expansion-${index + 1}`,
      label: normalizeText(entry?.label) || normalizeText(entry?.id) || `Query expansion ${index + 1}`,
      triggers: uniqueStrings(entry?.triggers || []),
      terms: uniqueStrings(entry?.terms || [])
    }))
    .filter((entry) => entry.triggers.length > 0 && entry.terms.length > 0);
}

export function normalizeSourceSearchRules(value = {}) {
  return {
    schemaVersion: DEFAULT_SOURCE_SEARCH_RULES.schemaVersion || "v0.0.1:schema:definition-1",
    updatedAt: normalizeText(value.updatedAt),
    maxFileBytes: normalizePositiveInteger(
      value.maxFileBytes,
      DEFAULT_SOURCE_SEARCH_RULES.maxFileBytes || 5 * 1024 * 1024,
      { min: 1024, max: 100 * 1024 * 1024 }
    ),
    maxEvidenceBytes: normalizePositiveInteger(
      value.maxEvidenceBytes,
      DEFAULT_SOURCE_SEARCH_RULES.maxEvidenceBytes || 512 * 1024,
      { min: 16 * 1024, max: 10 * 1024 * 1024 }
    ),
    maxScanFiles: normalizePositiveInteger(
      value.maxScanFiles,
      DEFAULT_SOURCE_SEARCH_RULES.maxScanFiles || 1000000,
      { min: 100, max: 1000000 }
    ),
	    readConcurrency: normalizePositiveInteger(
	      value.readConcurrency,
	      DEFAULT_SOURCE_SEARCH_RULES.readConcurrency || 64,
	      { min: 1, max: 256 }
	    ),
	    indexConcurrency: normalizePositiveInteger(
	      value.indexConcurrency,
	      DEFAULT_SOURCE_SEARCH_RULES.indexConcurrency || 32,
	      { min: 1, max: 256 }
	    ),
	    indexMaxTermsPerFile: normalizePositiveInteger(
	      value.indexMaxTermsPerFile,
	      DEFAULT_SOURCE_SEARCH_RULES.indexMaxTermsPerFile || 20000,
	      { min: 1000, max: 100000 }
	    ),
	    cacheTtlMs: normalizePositiveInteger(
	      value.cacheTtlMs,
	      DEFAULT_SOURCE_SEARCH_RULES.cacheTtlMs || 5 * 60 * 1000,
	      { min: 1000, max: 60 * 60 * 1000 }
	    ),
	    includeKnowledgeSources: value.includeKnowledgeSources !== false,
	    useInvertedIndex: value.useInvertedIndex !== false,
	    scanFallbackWhenIndexMissing: value.scanFallbackWhenIndexMissing === true,
	    knowledgeSourceExtensions: uniqueStrings(
	      value.knowledgeSourceExtensions || DEFAULT_SOURCE_SEARCH_RULES.knowledgeSourceExtensions || []
	    ).map(normalizeExtension).filter(Boolean),
	    ignoredDirectories: uniqueStrings(
	      value.ignoredDirectories || DEFAULT_SOURCE_SEARCH_RULES.ignoredDirectories || []
	    ),
    scanRoots: normalizeScanRoots(value.scanRoots || DEFAULT_SOURCE_SEARCH_RULES.scanRoots),
    queryExpansions: normalizeQueryExpansions(
      value.queryExpansions || DEFAULT_SOURCE_SEARCH_RULES.queryExpansions
    ),
    snippetWindow: normalizePositiveInteger(
      value.snippetWindow,
      DEFAULT_SOURCE_SEARCH_RULES.snippetWindow || 220,
      { min: 80, max: 2000 }
    )
  };
}

async function writeRulesFile(rulesPath, rules) {
  await atomicWriteJson(rulesPath, rules);
}

function sourceSearchRulesStateKey(userDataPath) {
  return `source-search-rules:${path.resolve(userDataPath)}`;
}

async function ensureSourceSearchRulesFile(userDataPath) {
  const rulesPath = getSourceSearchRulesPath(userDataPath);
  try {
    await fs.access(rulesPath);
  } catch {
    await writeRulesFile(rulesPath, normalizeSourceSearchRules({
      ...DEFAULT_SOURCE_SEARCH_RULES,
      updatedAt: new Date().toISOString()
    }));
  }
  return rulesPath;
}

async function loadSourceSearchRulesUnlocked(userDataPath) {
  const rulesPath = await ensureSourceSearchRulesFile(userDataPath);
  try {
    const parsed = JSON.parse(await fs.readFile(rulesPath, "utf8"));
    const normalized = normalizeSourceSearchRules(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeRulesFile(rulesPath, {
        ...normalized,
        updatedAt: normalized.updatedAt || new Date().toISOString()
      });
    }
    return normalized;
  } catch {
    const fallback = normalizeSourceSearchRules({
      ...DEFAULT_SOURCE_SEARCH_RULES,
      updatedAt: new Date().toISOString()
    });
    await writeRulesFile(rulesPath, fallback);
    return fallback;
  }
}

export async function loadSourceSearchRules(userDataPath) {
  await waitForStateIdle(sourceSearchRulesStateKey(userDataPath));
  return loadSourceSearchRulesUnlocked(userDataPath);
}
