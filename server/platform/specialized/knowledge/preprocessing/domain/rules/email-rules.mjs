import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteFile,
  atomicWriteJson,
  queueStateMutation,
  waitForStateIdle
} from "../../../../../common/platform-core/state-coordinator.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_EMAIL_RULES_PATH = path.resolve(moduleDirectory, "../../../../../../config/default-email-rules.json");

function loadBundledEmailRules() {
  try {
    return JSON.parse(fsSync.readFileSync(BUNDLED_EMAIL_RULES_PATH, "utf8"));
  } catch {
    return {
      schemaVersion: "v0.0.1:schema:definition-1",
      updatedAt: "",
      reportSeries: [],
      synonymDictionary: [],
      departmentDictionary: [],
      keywordStopwords: [],
      transactionMergeRules: {
        highSimilarity: 0.32,
        mediumSimilarity: 0.18,
        mediumParticipantOverlap: 0.34,
        highParticipantOverlap: 0.6
      }
    };
  }
}

export const DEFAULT_EMAIL_RULES = loadBundledEmailRules();

function getRulesDirectory(userDataPath) {
  return path.join(userDataPath, "rules");
}

export function getEmailRulesPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "email-rules.json");
}

function getRulesHistoryDirectory(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "history");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values || []) {
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

function sanitizeRatio(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }

  return Number(parsed.toFixed(4));
}

function normalizeReportSeries(entries) {
  return (entries || [])
    .map((entry, index) => ({
      id: normalizeText(entry?.id) || `report-series-${index + 1}`,
      label: normalizeText(entry?.label) || `规则 ${index + 1}`,
      enabled: entry?.enabled === undefined ? true : entry.enabled !== false,
      cadence:
        entry?.cadence === "weekly" || entry?.cadence === "monthly"
          ? entry.cadence
          : "irregular",
      keywords: uniqueStrings(entry?.keywords)
    }))
    .filter((entry) => entry.keywords.length > 0);
}

function normalizeSynonymDictionary(entries) {
  return (entries || [])
    .map((entry) => {
      const canonical = normalizeText(entry?.canonical);
      const terms = uniqueStrings([canonical, ...(entry?.terms || [])]);

      return {
        canonical,
        enabled: entry?.enabled === undefined ? true : entry.enabled !== false,
        terms
      };
    })
    .filter((entry) => entry.canonical && entry.terms.length > 0);
}

function normalizeDepartmentDictionary(entries) {
  return (entries || [])
    .map((entry) => ({
      department: normalizeText(entry?.department),
      enabled: entry?.enabled === undefined ? true : entry.enabled !== false,
      keywords: uniqueStrings(entry?.keywords),
      emailKeywords: uniqueStrings(entry?.emailKeywords)
    }))
    .filter(
      (entry) =>
        entry.department && (entry.keywords.length > 0 || entry.emailKeywords.length > 0)
    );
}

function normalizeTransactionMergeRules(rules) {
  return {
    highSimilarity: sanitizeRatio(
      rules?.highSimilarity,
      DEFAULT_EMAIL_RULES.transactionMergeRules.highSimilarity
    ),
    mediumSimilarity: sanitizeRatio(
      rules?.mediumSimilarity,
      DEFAULT_EMAIL_RULES.transactionMergeRules.mediumSimilarity
    ),
    mediumParticipantOverlap: sanitizeRatio(
      rules?.mediumParticipantOverlap,
      DEFAULT_EMAIL_RULES.transactionMergeRules.mediumParticipantOverlap
    ),
    highParticipantOverlap: sanitizeRatio(
      rules?.highParticipantOverlap,
      DEFAULT_EMAIL_RULES.transactionMergeRules.highParticipantOverlap
    )
  };
}

function normalizeEmailRules(value) {
  return {
    schemaVersion: DEFAULT_EMAIL_RULES.schemaVersion,
    updatedAt: normalizeText(value?.updatedAt),
    reportSeries: normalizeReportSeries(value?.reportSeries || DEFAULT_EMAIL_RULES.reportSeries),
    synonymDictionary: normalizeSynonymDictionary(
      value?.synonymDictionary || DEFAULT_EMAIL_RULES.synonymDictionary
    ),
    departmentDictionary: normalizeDepartmentDictionary(
      value?.departmentDictionary || DEFAULT_EMAIL_RULES.departmentDictionary
    ),
    keywordStopwords: uniqueStrings(value?.keywordStopwords || DEFAULT_EMAIL_RULES.keywordStopwords),
    transactionMergeRules: normalizeTransactionMergeRules(
      value?.transactionMergeRules || DEFAULT_EMAIL_RULES.transactionMergeRules
    )
  };
}

async function writeRulesFile(rulesPath, rules) {
  await atomicWriteJson(rulesPath, rules);
}

function emailRulesStateKey(userDataPath) {
  return `email-rules:${path.resolve(userDataPath)}`;
}

async function ensureRulesFile(userDataPath) {
  const rulesPath = getEmailRulesPath(userDataPath);

  try {
    await fs.access(rulesPath);
  } catch {
    const seededRules = normalizeEmailRules({
      ...DEFAULT_EMAIL_RULES,
      updatedAt: new Date().toISOString()
    });
    await writeRulesFile(rulesPath, seededRules);
  }

  return rulesPath;
}

async function loadEmailRulesUnlocked(userDataPath) {
  const rulesPath = await ensureRulesFile(userDataPath);

  try {
    const content = await fs.readFile(rulesPath, "utf8");
    const parsed = JSON.parse(content);
    const normalized = normalizeEmailRules(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeRulesFile(
        rulesPath,
        normalized.updatedAt
          ? normalized
          : {
              ...normalized,
              updatedAt: new Date().toISOString()
            }
      );
    }

    return normalized;
  } catch {
    const fallback = normalizeEmailRules({
      ...DEFAULT_EMAIL_RULES,
      updatedAt: new Date().toISOString()
    });
    await writeRulesFile(rulesPath, fallback);
    return fallback;
  }
}

export async function loadEmailRules(userDataPath) {
  await waitForStateIdle(emailRulesStateKey(userDataPath));
  return loadEmailRulesUnlocked(userDataPath);
}

async function saveEmailRulesUnlocked(userDataPath, incomingRules) {
  const rulesPath = await ensureRulesFile(userDataPath);
  const current = await loadEmailRulesUnlocked(userDataPath);
  const next = normalizeEmailRules({
    ...current,
    ...(incomingRules || {}),
    reportSeries:
      incomingRules?.reportSeries === undefined
        ? current.reportSeries
        : incomingRules.reportSeries,
    synonymDictionary:
      incomingRules?.synonymDictionary === undefined
        ? current.synonymDictionary
        : incomingRules.synonymDictionary,
    departmentDictionary:
      incomingRules?.departmentDictionary === undefined
        ? current.departmentDictionary
        : incomingRules.departmentDictionary,
    keywordStopwords:
      incomingRules?.keywordStopwords === undefined
        ? current.keywordStopwords
        : incomingRules.keywordStopwords,
    transactionMergeRules:
      incomingRules?.transactionMergeRules === undefined
        ? current.transactionMergeRules
        : {
            ...current.transactionMergeRules,
            ...(incomingRules.transactionMergeRules || {})
          },
    updatedAt: new Date().toISOString()
  });

  try {
    const previousContent = await fs.readFile(rulesPath, "utf8");
    const historyPath = path.join(
      getRulesHistoryDirectory(userDataPath),
      `email-rules.${Date.now()}.json`
    );
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await atomicWriteFile(historyPath, previousContent, "utf8");
  } catch {
    // The first save has no history to preserve.
  }

  await writeRulesFile(rulesPath, next);
  return next;
}

export async function saveEmailRules(userDataPath, incomingRules) {
  return queueStateMutation(emailRulesStateKey(userDataPath), () =>
    saveEmailRulesUnlocked(userDataPath, incomingRules)
  );
}
