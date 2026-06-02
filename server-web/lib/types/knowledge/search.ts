export type KnowledgeHierarchyNode = {
  hierarchyId?: string;
  nodeType?: "collection" | "document" | "section" | string;
  level?: number;
  targetId?: string;
  documentId?: string;
  sectionId?: string;
  title?: string;
  categoryPath?: string;
  score?: number;
};

export type KnowledgeHierarchyPlan = {
  enabled: boolean;
  policy?: string;
  enforced?: boolean;
  topScore?: number;
  threshold?: number;
  selected?: {
    collections?: KnowledgeHierarchyNode[];
    documents?: KnowledgeHierarchyNode[];
    sections?: KnowledgeHierarchyNode[];
  };
  candidates?: KnowledgeHierarchyNode[];
};

export type KnowledgeSearchResult = {
  evidenceId?: string;
  itemId?: string;
  documentId?: string;
  title: string;
  snippet?: string;
  score?: number;
  finalScore?: number;
  relevanceScore?: number;
  retrievalPath?: string[];
  sourceLocator?: Record<string, unknown> | string;
  relatedAssetIds?: string[];
  assetIds?: string[];
  assets?: KnowledgeAssetRef[];
  modalities?: string[];
  localMirror?: {
    matched?: boolean;
    openable?: boolean;
    sourceType?: string;
    providerId?: string;
    externalId?: string;
    syncBatchId?: string;
    timestamp?: string;
    status?: string;
  };
  fusion?: Record<string, unknown>;
  hierarchy?: {
    documentId?: string;
    sectionId?: string;
    score?: number;
    path?: string;
  } | null;
  reasons?: Array<Record<string, unknown> | string>;
  [key: string]: unknown;
};

export type KnowledgeSearchResponse = {
  query?: string;
  items?: KnowledgeSearchResult[];
  results?: KnowledgeSearchResult[];
  evidencePacks?: EvidencePack[];
  markdown?: string;
  responseProfile?: "agent" | "api" | "console" | string;
  agentMessage?: Record<string, unknown>;
  hierarchy?: KnowledgeHierarchyPlan;
  retrievalProfileId?: string;
  retrievalProfileVersion?: number;
  learningRuntime?: Record<string, unknown>;
  fusion?: Record<string, unknown>;
  explain?: Record<string, unknown>;
  [key: string]: unknown;
};

export type KnowledgeAssetRef = {
  assetId: string;
  mediaType?: string;
  title?: string;
  caption?: string;
  ocrText?: string;
  sourceLocator?: Record<string, unknown> | string;
  thumbnailAssetId?: string;
};

export type EvidencePack = {
  evidenceId: string;
  title?: string;
  summary?: string;
  text?: string;
  snippet?: string;
  document?: Record<string, unknown>;
  section?: Record<string, unknown>;
  block?: Record<string, unknown>;
  assets?: KnowledgeAssetRef[];
  reasons?: string[];
  sourceLocator?: Record<string, unknown> | string;
  [key: string]: unknown;
};

export type RenderMarkdownResponse = {
  evidenceId?: string;
  markdown?: string;
  content?: string;
  format?: string;
};
