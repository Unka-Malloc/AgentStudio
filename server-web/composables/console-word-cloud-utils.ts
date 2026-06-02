import type {
  KnowledgeWordCloud,
  KnowledgeWordCloudCorpusPath,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudTerm,
} from "../lib/types";

export type WordCloudTreeMatch = {
  cloud: KnowledgeWordCloud;
  parent: KnowledgeWordCloud | null;
  path: KnowledgeWordCloud[];
};

export type WordCloudCardRow = {
  cloud: KnowledgeWordCloud;
  depth: number;
  parent: KnowledgeWordCloud | null;
};

type WordCloudAbsorptionCandidate = {
  cloud: KnowledgeWordCloud;
  depth: number;
  threshold: number;
  labelText: string;
  summaryText: string;
  termTexts: string[];
};

export const DEFAULT_WORD_CLOUD_ABSORB_THRESHOLD = 0.78;

const WORD_CLOUD_TAIL_LABELS = new Set(["default", "其它", "others"]);

export function cloneWordCloudSet(value: KnowledgeWordCloudSet): KnowledgeWordCloudSet {
  return JSON.parse(JSON.stringify(value)) as KnowledgeWordCloudSet;
}

export function normalizeWordCloudTermForUi(
  value: Partial<KnowledgeWordCloudTerm> | string,
): KnowledgeWordCloudTerm {
  const record = typeof value === "string" ? { term: value } : value || {};
  return {
    term: String(record.term || "").trim(),
    frequency: Math.max(0, Number(record.frequency || 0)),
    weight: record.weight === undefined ? undefined : Number(record.weight),
  };
}

export function wordCloudTermIdentity(value: Partial<KnowledgeWordCloudTerm> | string) {
  return normalizeWordCloudTermForUi(value).term.toLowerCase();
}

export function normalizeWordCloudCorpusPathForUi(
  value: Partial<KnowledgeWordCloudCorpusPath> | string,
): KnowledgeWordCloudCorpusPath | null {
  const record = typeof value === "string" ? { path: value } : value || {};
  const selectedPath = String(record.path || "").trim();
  if (!selectedPath) {
    return null;
  }
  const type = String(record.type || "").trim();
  return {
    path: selectedPath,
    type: type === "file" || type === "directory" ? type : "",
  };
}

export function normalizeWordCloudCorpusPathsForUi(
  values: Array<Partial<KnowledgeWordCloudCorpusPath> | string> = [],
) {
  const seen = new Set<string>();
  const paths: KnowledgeWordCloudCorpusPath[] = [];
  for (const value of values || []) {
    const normalized = normalizeWordCloudCorpusPathForUi(value);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.type || ""}:${normalized.path}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(normalized);
  }
  return paths;
}

export function normalizeWordCloudThreshold(
  value: unknown,
  fallback = DEFAULT_WORD_CLOUD_ABSORB_THRESHOLD,
) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, next));
}

export function formatWordCloudThreshold(value: unknown) {
  return normalizeWordCloudThreshold(value).toFixed(2);
}

function normalizeWordCloudText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function wordCloudCharacterSet(value: string) {
  return new Set(Array.from(normalizeWordCloudText(value)).filter(Boolean));
}

function wordCloudCharacterOverlapScore(leftText: string, rightText: string) {
  const leftSet = wordCloudCharacterSet(leftText);
  const rightSet = wordCloudCharacterSet(rightText);
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const character of leftSet) {
    if (rightSet.has(character)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftSet.size, rightSet.size);
}

function collectWordCloudAbsorptionCandidates(
  wordBags: KnowledgeWordCloud[] = [],
  depth = 0,
  target: WordCloudAbsorptionCandidate[] = [],
) {
  for (const cloud of wordBags) {
    target.push({
      cloud,
      depth,
      threshold: normalizeWordCloudThreshold(cloud.absorbThreshold),
      labelText: normalizeWordCloudText(cloud.label),
      summaryText: normalizeWordCloudText(cloud.summary || ""),
      termTexts: (cloud.terms || []).map((term) => normalizeWordCloudText(term.term)).filter(Boolean),
    });
    collectWordCloudAbsorptionCandidates(cloud.children || [], depth + 1, target);
  }
  return target;
}

function wordCloudAffinityScore(candidate: WordCloudAbsorptionCandidate, term: KnowledgeWordCloudTerm) {
  const termText = normalizeWordCloudText(term.term);
  if (!termText) {
    return 0;
  }
  let score = 0;
  const sources = [candidate.labelText, candidate.summaryText, ...candidate.termTexts];
  for (const sourceText of sources) {
    if (!sourceText) {
      continue;
    }
    if (sourceText === termText) {
      return 1;
    }
    if (sourceText.includes(termText) || termText.includes(sourceText)) {
      score = Math.max(score, 0.95);
    }
    score = Math.max(score, wordCloudCharacterOverlapScore(sourceText, termText) * 0.82);
  }
  if (candidate.cloud.relation === "contains") {
    score += 0.03;
  } else if (candidate.cloud.relation === "overlap") {
    score += 0.02;
  }
  return Math.min(1, score);
}

export function autoAbsorbWordCloudTerms(
  draft: KnowledgeWordCloudSet,
  options: {
    termWithFrequency?: (term: KnowledgeWordCloudTerm) => KnowledgeWordCloudTerm;
  } = {},
) {
  const unassignedTerms = Array.isArray(draft.unassignedTerms) ? [...draft.unassignedTerms] : [];
  if (unassignedTerms.length === 0) {
    return 0;
  }
  const candidates = collectWordCloudAbsorptionCandidates(draft.wordBags || []);
  if (candidates.length === 0) {
    return 0;
  }
  const termWithFrequency = options.termWithFrequency || ((term: KnowledgeWordCloudTerm) => term);
  const absorbedTermIds = new Set<string>();
  const absorbedByCloud = new Map<string, KnowledgeWordCloudTerm[]>();
  for (const term of unassignedTerms) {
    const identity = wordCloudTermIdentity(term);
    if (!identity) {
      continue;
    }
    let bestCandidate: WordCloudAbsorptionCandidate | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = wordCloudAffinityScore(candidate, term);
      if (score < candidate.threshold) {
        continue;
      }
      if (!bestCandidate || score > bestScore || (score === bestScore && candidate.depth > bestCandidate.depth)) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }
    if (!bestCandidate) {
      continue;
    }
    absorbedTermIds.add(identity);
    const nextTerms = absorbedByCloud.get(bestCandidate.cloud.wordBagId) || [];
    nextTerms.push(termWithFrequency(term));
    absorbedByCloud.set(bestCandidate.cloud.wordBagId, nextTerms);
  }
  if (absorbedTermIds.size === 0) {
    return 0;
  }
  const absorbIntoClouds = (wordBags: KnowledgeWordCloud[]) => {
    for (const cloud of wordBags) {
      const nextTerms = absorbedByCloud.get(cloud.wordBagId);
      if (nextTerms?.length) {
        const existingIds = new Set((cloud.terms || []).map((item) => wordCloudTermIdentity(item)));
        cloud.terms = [
          ...(cloud.terms || []),
          ...nextTerms.filter((item) => !existingIds.has(wordCloudTermIdentity(item))),
        ];
      }
      absorbIntoClouds(cloud.children || []);
    }
  };
  absorbIntoClouds(draft.wordBags || []);
  draft.unassignedTerms = unassignedTerms.filter((term) => !absorbedTermIds.has(wordCloudTermIdentity(term)));
  return absorbedTermIds.size;
}

export function normalizeWordCloudCloudForUi(
  cloud: KnowledgeWordCloud,
  parentWordBagId = "",
): KnowledgeWordCloud {
  const wordBagId = String(cloud.wordBagId || `word-bag-${Date.now().toString(36)}`).trim();
  return {
    ...cloud,
    wordBagId,
    label: String(cloud.label || "词云").trim() || "词云",
    parentWordBagId,
    terms: (cloud.terms || []).map((term) => normalizeWordCloudTermForUi(term)).filter((term) => term.term),
    removedTerms: (cloud.removedTerms || [])
      .map((term) => ({ ...normalizeWordCloudTermForUi(term), removed: true }))
      .filter((term) => term.term),
    children: (cloud.children || []).map((child) => normalizeWordCloudCloudForUi(child, wordBagId)),
  };
}

export function normalizeWordCloudSetForUi(value: KnowledgeWordCloudSet): KnowledgeWordCloudSet {
  return {
    ...value,
    termsSnapshot: (value.termsSnapshot || []).map((term) => normalizeWordCloudTermForUi(term)).filter((term) => term.term),
    unassignedTerms: (value.unassignedTerms || []).map((term) => normalizeWordCloudTermForUi(term)).filter((term) => term.term),
    corpusPaths: normalizeWordCloudCorpusPathsForUi(value.corpusPaths || []),
    wordBags: (value.wordBags || []).map((cloud) => normalizeWordCloudCloudForUi(cloud)),
  };
}

export function findWordCloudInTree(
  wordBags: KnowledgeWordCloud[] = [],
  wordBagId = "",
  parent: KnowledgeWordCloud | null = null,
  path: KnowledgeWordCloud[] = [],
): WordCloudTreeMatch | null {
  for (const cloud of wordBags) {
    const nextPath = [...path, cloud];
    if (cloud.wordBagId === wordBagId) {
      return { cloud, parent, path: nextPath };
    }
    const child = findWordCloudInTree(cloud.children || [], wordBagId, cloud, nextPath);
    if (child) {
      return child;
    }
  }
  return null;
}

export function flattenWordCloudCards(
  wordBags: KnowledgeWordCloud[] = [],
  options: { collapsedWordBagIds?: Set<string> } = {},
  depth = 0,
  parent: KnowledgeWordCloud | null = null,
): WordCloudCardRow[] {
  const rows: WordCloudCardRow[] = [];
  const collapsedWordBagIds = options.collapsedWordBagIds || new Set<string>();
  for (const cloud of wordBags) {
    rows.push({ cloud, depth, parent });
    if (!collapsedWordBagIds.has(cloud.wordBagId)) {
      rows.push(...flattenWordCloudCards(cloud.children || [], options, depth + 1, cloud));
    }
  }
  return rows;
}

export function createDefaultWordCloudSet(
  terms: KnowledgeWordCloudTerm[] = [],
  options: {
    corpusPaths?: Array<Partial<KnowledgeWordCloudCorpusPath> | string>;
    modelAlias?: string;
  } = {},
): KnowledgeWordCloudSet {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    wordBagSetId: `word-cloud-${Date.now().toString(36)}`,
    title: "语料词云",
    status: "draft",
    wordBagCount: 0,
    termsSnapshot: terms,
    wordBags: [],
    unassignedTerms: terms,
    corpusPaths: normalizeWordCloudCorpusPathsForUi(options.corpusPaths || []),
    modelAlias: options.modelAlias || "",
    agentResponse: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function preferredWordCloudCorpusPaths(
  remotePaths: Array<Partial<KnowledgeWordCloudCorpusPath> | string> = [],
  fallbackPaths: Array<Partial<KnowledgeWordCloudCorpusPath> | string> = [],
) {
  const normalizedRemotePaths = normalizeWordCloudCorpusPathsForUi(remotePaths);
  if (normalizedRemotePaths.length > 0) {
    return normalizedRemotePaths;
  }
  return normalizeWordCloudCorpusPathsForUi(fallbackPaths);
}

export function isWordCloudTailCard(cloud: KnowledgeWordCloud): boolean {
  return WORD_CLOUD_TAIL_LABELS.has(String(cloud.label || "").trim().toLowerCase());
}
