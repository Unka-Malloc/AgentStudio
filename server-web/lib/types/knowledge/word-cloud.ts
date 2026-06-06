export type KnowledgeWordCloudTerm = {
  term: string;
  frequency: number;
  weight?: number;
  quality?: string;
  removed?: boolean;
};

export type KnowledgeWordCloudCorpusPath = {
  path: string;
  type?: "directory" | "file" | string;
};

export type KnowledgeWordBag = {
  wordBagId: string;
  label: string;
  summary?: string;
  relation?: "separate" | "overlap" | "contains" | string;
  absorbThreshold?: number;
  terms: KnowledgeWordCloudTerm[];
  removedTerms?: KnowledgeWordCloudTerm[];
  children?: KnowledgeWordBag[];
  parentWordBagId?: string;
  childWordBagIds?: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  zIndex?: number;
  layout?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    zIndex?: number;
  };
};

export type KnowledgeWordCloud = KnowledgeWordBag;

export type KnowledgeWordBagSet = {
  schemaVersion?: number;
  wordBagSetId: string;
  title: string;
  status: string;
  wordBagCount?: number;
  termsSnapshot?: KnowledgeWordCloudTerm[];
  wordBags: KnowledgeWordBag[];
  unassignedTerms?: KnowledgeWordCloudTerm[];
  corpusPaths?: KnowledgeWordCloudCorpusPath[];
  modelAlias?: string;
  agentResponse?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type KnowledgeWordCloudSet = KnowledgeWordBagSet;

export type KnowledgeWordCloudState = {
  ok?: boolean;
  schemaVersion?: number;
  terms: KnowledgeWordCloudTerm[];
  corpusPaths?: KnowledgeWordCloudCorpusPath[];
  wordBagSet: KnowledgeWordBagSet | null;
  wordBagSets?: KnowledgeWordBagSet[];
};

export type KnowledgeWordCloudProposeResponse = {
  ok: boolean;
  terms?: KnowledgeWordCloudTerm[];
  agentResponse?: Record<string, unknown>;
  wordBagSet: KnowledgeWordBagSet;
  run?: {
    runId: string;
    queueId?: string;
    status?: string;
    startedAt?: string;
  };
};

export type KnowledgeWordBagMutationResponse = {
  ok: boolean;
  action: "added" | "updated" | "deleted" | string;
  wordBag?: KnowledgeWordBag;
  wordBagSet: KnowledgeWordBagSet;
  deletedWordBagId?: string;
  returnedTermCount?: number;
  defaultWordBagId?: string;
  code?: string;
  error?: string;
};

export type KnowledgeWordBagTermsGroup = {
  wordBagId: string;
  label: string;
  parentWordBagId?: string;
  includeChildren: boolean;
  sourceWordBagIds: string[];
  childWordBagIds: string[];
  wordBags: Array<{
    wordBagId: string;
    label: string;
    parentWordBagId?: string;
    childWordBagIds: string[];
    terms: KnowledgeWordCloudTerm[];
    removedTerms?: KnowledgeWordCloudTerm[];
  }>;
  terms: KnowledgeWordCloudTerm[];
  removedTerms?: KnowledgeWordCloudTerm[];
};

export type KnowledgeWordBagTermsResponse = {
  ok: boolean;
  schemaVersion?: number;
  wordBagSetId: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  includeChildren: boolean;
  requestedWordBagIds: string[];
  missingWordBagIds: string[];
  groups: KnowledgeWordBagTermsGroup[];
  terms: KnowledgeWordCloudTerm[];
  removedTerms?: KnowledgeWordCloudTerm[];
};

export type KnowledgeWordCloudExportResponse = {
  ok: boolean;
  exportType: "pact.knowledge.word_bags.export" | string;
  schemaVersion?: number;
  exportedAt: string;
  wordBagSet: KnowledgeWordBagSet;
};

export type KnowledgeWordCloudImportResponse = {
  ok: boolean;
  action: "imported" | string;
  mode: "copy" | "overwrite" | string;
  importedFromWordBagSetId?: string;
  exportType?: string;
  wordBagSet: KnowledgeWordBagSet;
};
