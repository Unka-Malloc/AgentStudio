export type NormalizedDocumentEntry = {
  documentId: string;
  artifactType: "docx" | "source-material";
  adapterId: string;
  sourceId: string;
  granularity: string;
  title: string;
  relativePath: string;
  sha256: string;
  byteSize: number;
  machineReadableFormat?: "yaml";
  machineReadableRelativePath?: string;
  machineReadableSha256?: string;
  machineReadableByteSize?: number;
  sourceMaterialRelativePath: string;
  warnings: string[];
};

export type NormalizedDocumentsManifest = {
  schemaVersion: string;
  packageType: "pact.normalized-documents";
  batchId: string;
  generatedAt: string;
  rootRelativePath: string;
  humanReadable?: {
    format: "docx";
    purpose: string;
    policy: string;
  };
  machineReadable?: {
    format: "yaml";
    purpose: string;
    manifestRelativePath: string;
    sidecarPattern: string;
  };
  documents: NormalizedDocumentEntry[];
  sourceMaterials: NormalizedDocumentEntry[];
  summary: {
    documentCount: number;
    sourceMaterialCount: number;
    byGranularity: Record<string, number>;
  };
  warnings: string[];
};

export type DocumentParsingConfig = {
  pipelineId?: string;
  expectedOutput?: "sources" | "blocks" | "chunks" | "preprocessResult" | string;
  expectedOutputs?: string[];
  chunking?: {
    maxTokens?: number;
    maxChars?: number;
    overlapTokens?: number;
    sectionLevel?: number;
  };
  contextBudget?: {
    knowledgeTokens?: number;
    budgetScope?: string;
  };
  payloadBudget?: {
    maxResponseBytes?: number;
    maxEvidenceBytes?: number;
    continuationToken?: string;
  };
  granularity?: {
    preferOriginalStructure?: boolean;
    allowPartialEvidence?: boolean;
    targetTokens?: number;
    targetChars?: number;
    tableGranularity?: string;
    secondaryParse?: {
      enabled?: boolean;
      algorithm?: string;
      targetTokens?: number;
      targetChars?: number;
    };
  };
  dynamicParsing?: {
    enabled?: boolean;
    preserveStructureArtifacts?: boolean;
    algorithmRegistry?: Record<string, string>;
    tableGranularity?: string;
  };
};

export type DocumentParseChunk = {
  id: string;
  sourceId?: string;
  sourceName?: string;
  title?: string;
  titlePath?: string[];
  headingPath?: string[];
  chunkType?: string;
  content?: string;
  text?: string;
  tokenCount?: number;
  charCount?: number;
  overlapTokenCount?: number;
  sourceStartLine?: number;
  sourceEndLine?: number;
  sourceRange?: {
    startLine?: number;
    endLine?: number;
  };
  sectionId?: string;
  blockIds?: string[];
  metadata?: Record<string, unknown>;
};

export type DocumentParseResponse = {
  schemaVersion: string;
  generatedAt: string;
  pipelineId: string;
  expectedOutputs: string[];
  sources: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  chunks: DocumentParseChunk[];
  structureArtifacts?: Array<Record<string, unknown>>;
  granularityFragments?: Array<Record<string, unknown>>;
  preprocessResult: Record<string, unknown> | null;
  dynamicParsing?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  backendTrace?: Record<string, unknown> | null;
  warnings: string[];
  summary: {
    sources: number;
    blocks: number;
    chunks: number;
    structureArtifacts?: number;
    granularityFragments?: number;
    warnings: number;
  };
  pipelines: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
};
