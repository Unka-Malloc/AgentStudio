import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadBundledKnowledgeTaxonomy,
  taxonomyToExpertVocabularyEntries
} from "../knowledge-taxonomy/default-taxonomy.mjs";
import {
  atomicWriteFile,
  atomicWriteJsonThroughState,
  mutateState
} from "../../../../../common/platform-core/state-coordinator.mjs";

export const EXPERT_VOCABULARY_SCHEMA_VERSION = "v0.0.1:knowledge:expert-vocabulary-schema-1";
export const DEFAULT_EXPERT_VOCABULARY_ENTRIES = taxonomyToExpertVocabularyEntries(
  loadBundledKnowledgeTaxonomy()
);

const LIFECYCLE_STATES = new Set(["draft", "active", "retired"]);

function expertVocabularyStateKey(userDataPath) {
  return `expert-vocabulary:${path.resolve(userDataPath)}`;
}

function getRulesDirectory(userDataPath) {
  return path.join(userDataPath, "rules");
}

export function getExpertVocabularyPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "expert-vocabulary.json");
}

function getExpertVocabularyHistoryDirectory(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "history", "expert-vocabulary");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function asList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function normalizePathSegments(entry = {}) {
  const rawSegments = Array.isArray(entry.pathSegments)
    ? entry.pathSegments
    : normalizeText(entry.path || entry.categoryPath || entry.label).split("/");
  return rawSegments.map(normalizeText).filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of asList(values)) {
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

function normalizeDomain(value) {
  return normalizeText(value)
    .replace(/^@+/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function uniqueDomains(values) {
  return uniqueStrings(asList(values).map(normalizeDomain)).filter(Boolean);
}

function stableEntryId(pathSegments, index) {
  const key = pathSegments.join("/").toLowerCase() || `entry-${index + 1}`;
  return `vocab-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function normalizeEntry(entry = {}, index = 0) {
  const pathSegments = normalizePathSegments(entry);
  const status = LIFECYCLE_STATES.has(entry.status) ? entry.status : "active";
  const id = normalizeText(entry.id) || stableEntryId(pathSegments, index);

  return {
    id,
    pathSegments,
    label: normalizeText(entry.label) || pathSegments.at(-1) || `词条 ${index + 1}`,
    keywords: uniqueStrings(entry.keywords || entry.terms || []),
    domains: uniqueDomains(entry.domains || entry.emailDomains || []),
    status,
    notes: normalizeText(entry.notes)
  };
}

function checksumVocabulary(value) {
  const canonical = JSON.stringify({
    schemaVersion: EXPERT_VOCABULARY_SCHEMA_VERSION,
    entries: value.entries.map((entry) => ({
      pathSegments: entry.pathSegments,
      label: entry.label,
      keywords: entry.keywords,
      domains: entry.domains,
      status: entry.status,
      notes: entry.notes
    }))
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeExpertVocabulary(value = {}, context = {}) {
  const now = normalizeText(context.updatedAt || value.updatedAt) || new Date().toISOString();
  const entries = (value.entries || DEFAULT_EXPERT_VOCABULARY_ENTRIES)
    .map(normalizeEntry)
    .filter((entry) => entry.pathSegments.length > 0);
  const normalized = {
    schemaVersion: EXPERT_VOCABULARY_SCHEMA_VERSION,
    version: Math.max(1, Number(value.version || context.version || 1)),
    updatedAt: now,
    publishedAt: normalizeText(value.publishedAt || context.publishedAt || now),
    source: normalizeText(value.source || context.source || "macos-mail-index-taxonomy"),
    entries
  };
  return {
    ...normalized,
    checksum: checksumVocabulary(normalized)
  };
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeVocabularyFile(vocabularyPath, vocabulary) {
  await atomicWriteJsonThroughState(vocabularyPath, vocabulary, {
    kind: "expert_vocabulary.write"
  });
}

async function seedExpertVocabulary(userDataPath) {
  const now = new Date().toISOString();
  const vocabulary = normalizeExpertVocabulary(
    {
      entries: DEFAULT_EXPERT_VOCABULARY_ENTRIES,
      updatedAt: now,
      publishedAt: now
    },
    { version: 1 }
  );
  await writeVocabularyFile(getExpertVocabularyPath(userDataPath), vocabulary);
  return vocabulary;
}

async function ensureVocabularyFile(userDataPath) {
  const vocabularyPath = getExpertVocabularyPath(userDataPath);
  try {
    await fs.access(vocabularyPath);
  } catch {
    await seedExpertVocabulary(userDataPath);
  }
  return vocabularyPath;
}

async function archiveCurrentVocabulary(vocabularyPath, currentVersion) {
  try {
    const previousContent = await fs.readFile(vocabularyPath, "utf8");
    const historyPath = path.join(
      getExpertVocabularyHistoryDirectory(path.dirname(path.dirname(vocabularyPath))),
      `expert-vocabulary.v${currentVersion}.${Date.now()}.json`
    );
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await atomicWriteFile(historyPath, previousContent, "utf8");
  } catch {
    // The first save has no previous version to archive.
  }
}

export async function loadExpertVocabulary(userDataPath) {
  const vocabularyPath = await ensureVocabularyFile(userDataPath);
  const parsed = await readJsonFile(vocabularyPath, null);
  const normalized = normalizeExpertVocabulary(parsed || {
    entries: DEFAULT_EXPERT_VOCABULARY_ENTRIES,
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString()
  });
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await writeVocabularyFile(vocabularyPath, normalized);
  }
  return normalized;
}

export async function saveExpertVocabulary(userDataPath, incomingVocabulary) {
  return mutateState({
    key: expertVocabularyStateKey(userDataPath),
    kind: "expert_vocabulary.save",
    metadata: { userDataPath },
    task: async () => {
      const vocabularyPath = await ensureVocabularyFile(userDataPath);
      const current = await loadExpertVocabulary(userDataPath);
      const now = new Date().toISOString();
      const next = normalizeExpertVocabulary(
        {
          ...current,
          ...(incomingVocabulary || {}),
          entries:
            incomingVocabulary?.entries === undefined
              ? current.entries
              : incomingVocabulary.entries,
          version: current.version + 1,
          updatedAt: now,
          publishedAt: now
        },
        { version: current.version + 1, updatedAt: now, publishedAt: now }
      );

      await archiveCurrentVocabulary(vocabularyPath, current.version);
      await writeVocabularyFile(vocabularyPath, next);
      return next;
    }
  });
}

export async function getExpertVocabularySummary(userDataPath) {
  const vocabulary = await loadExpertVocabulary(userDataPath);
  return {
    path: getExpertVocabularyPath(userDataPath),
    schemaVersion: vocabulary.schemaVersion,
    version: vocabulary.version,
    updatedAt: vocabulary.updatedAt,
    publishedAt: vocabulary.publishedAt,
    checksum: vocabulary.checksum,
    entryCount: vocabulary.entries.length,
    activeEntryCount: vocabulary.entries.filter((entry) => entry.status === "active").length
  };
}

export async function listExpertVocabularyVersions(userDataPath) {
  const current = await getExpertVocabularySummary(userDataPath);
  let history = [];
  try {
    const historyDirectory = getExpertVocabularyHistoryDirectory(userDataPath);
    const names = await fs.readdir(historyDirectory);
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
