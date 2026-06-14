export type ReportSeriesRule = {
  id: string;
  label: string;
  enabled?: boolean;
  cadence: "weekly" | "monthly" | "irregular";
  keywords: string[];
};

export type SynonymDictionaryEntry = {
  canonical: string;
  enabled?: boolean;
  terms: string[];
};

export type DepartmentDictionaryEntry = {
  department: string;
  enabled?: boolean;
  keywords: string[];
  emailKeywords: string[];
};

export type TransactionMergeRules = {
  highSimilarity: number;
  mediumSimilarity: number;
  mediumParticipantOverlap: number;
  highParticipantOverlap: number;
};

export type EmailRuleSet = {
  schemaVersion: string;
  updatedAt: string;
  reportSeries: ReportSeriesRule[];
  synonymDictionary: SynonymDictionaryEntry[];
  departmentDictionary: DepartmentDictionaryEntry[];
  keywordStopwords: string[];
  transactionMergeRules: TransactionMergeRules;
};

export type EmailRuleSetResponse = {
  path: string;
  rules: EmailRuleSet;
};

export type ExpertVocabularyEntry = {
  id: string;
  pathSegments: string[];
  label: string;
  keywords: string[];
  domains: string[];
  status: "draft" | "active" | "retired";
  notes: string;
};

export type ExpertVocabulary = {
  schemaVersion: string;
  version: number;
  updatedAt: string;
  publishedAt: string;
  source: string;
  checksum: string;
  entries: ExpertVocabularyEntry[];
};

export type ExpertVocabularyResponse = {
  path: string;
  vocabulary: ExpertVocabulary;
};

export type KnowledgeTaxonomyCategory = {
  categoryId: string;
  pathSegments: string[];
  path: string;
  label: string;
  keywords: string[];
  domains: string[];
  strongTerms: string[];
  weakTerms: string[];
  negativeTerms: string[];
  queryTriggers: string[];
  triggerAliases: Record<string, string[]>;
  expansionTerms: string[];
  primaryTerms: string[];
  anchorTerms: string[];
  requiredTerms: string[];
  contextSignals: string[];
  intentLabel: string;
  minAlignmentScore: number;
  minPrimaryHits: number;
  minPositiveHits: number;
  negativeDominance: number;
  notes: string;
};

export type KnowledgeTaxonomy = {
  schemaVersion: string;
  version: number;
  source: string;
  updatedAt: string;
  publishedAt: string;
  fallbackPath: string;
  defaultIntent: string;
  keywordStopwords: string[];
  classifierPrompt: Record<string, unknown>;
  fallbackIntents: Array<{
    intent: string;
    terms: string[];
  }>;
  categories: KnowledgeTaxonomyCategory[];
  checksum: string;
};

export type KnowledgeGuidanceSummary = {
  taxonomyPath: string;
  expertVocabularyPath: string;
  emailRulesPath: string;
  schemaVersion: string;
  version: number;
  source: string;
  checksum: string;
  categoryCount: number;
  guidance: {
    taxonomy: {
      version: number;
      checksum: string;
      categoryCount: number;
    };
    expertVocabulary: {
      version: number;
      source: string;
      updatedAt: string;
      entryCount: number;
    };
    emailRules: {
      updatedAt: string;
      reportSeriesCount: number;
      synonymCount: number;
      departmentCount: number;
    };
    compiled: {
      categoryCount: number;
      checksum: string;
    };
  } | null;
};

export type KnowledgeTaxonomyResponse = {
  path: string;
  taxonomy: KnowledgeTaxonomy;
  guidance?: KnowledgeGuidanceSummary;
};

export type ExpertVocabularyHistoryResponse = {
  current: {
    path: string;
    schemaVersion: string;
    version: number;
    updatedAt: string;
    publishedAt: string;
    checksum: string;
    entryCount: number;
    activeEntryCount: number;
  };
  history: Array<{
    version: number;
    archivedAt: string;
    path: string;
  }>;
};

export type EmailRuleSetPayload = {
  path: string;
  rules: EmailRuleSet;
};

export type KnowledgeRuleAuthoringResponse = {
  protocolVersion: string;
  ok: boolean;
  status: string;
  runId?: string;
  message?: string;
  intent?: Record<string, unknown>;
  template?: Record<string, unknown>;
  package?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  gate?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
  confirmation?: {
    packageId: string;
    version: number;
    publishEndpoint: string;
    action?: string;
  };
  answer?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};
