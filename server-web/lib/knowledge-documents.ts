import { createKnowledgeUploadedFilesPayload } from "./knowledge-upload-session";
import {
  knowledgeDocxExportUrl,
  knowledgeHtmlExportUrl,
  knowledgeMarkdownExportUrl,
  normalizedDocumentUrl,
  parseDocument,
} from "./knowledge-documents-client";
import type { DocumentParseResponse, DocumentParsingConfig } from "./types";

export type KnowledgeDocumentExportFormat = "docx" | "markdown" | "html";

export type KnowledgeDocumentPreviewContract = {
  pipelineId: string;
  expectedOutputs: string[];
  contextBudget?: DocumentParsingConfig["contextBudget"];
  payloadBudget?: DocumentParsingConfig["payloadBudget"];
  granularity?: DocumentParsingConfig["granularity"];
  dynamicParsing?: DocumentParsingConfig["dynamicParsing"];
};

export function knowledgeExportUrl(format: KnowledgeDocumentExportFormat) {
  if (format === "markdown") return knowledgeMarkdownExportUrl();
  if (format === "html") return knowledgeHtmlExportUrl();
  return knowledgeDocxExportUrl();
}

export function normalizedKnowledgeDocumentUrl(batchId: string, documentId: string) {
  return normalizedDocumentUrl(batchId, documentId);
}

export async function previewKnowledgeDocuments(
  files: File[],
  contract: KnowledgeDocumentPreviewContract,
): Promise<DocumentParseResponse | null> {
  if (files.length === 0) {
    return null;
  }
  const uploadedFiles = await createKnowledgeUploadedFilesPayload(files);
  return parseDocument({
    pipelineId: contract.pipelineId,
    expectedOutputs: contract.expectedOutputs,
    uploadedFiles,
    dryRun: true,
    contextBudget: contract.contextBudget,
    payloadBudget: contract.payloadBudget,
    granularity: contract.granularity,
    dynamicParsing: contract.dynamicParsing,
  });
}
