import { getAgentConfigRegistry } from "../agent/agent-configs/config-registry.mjs";
import { createAgentRuntimeProvider } from "../agent/agent-runtime-provider.mjs";
import { listAvailableAnalysisModules } from "../knowledge/preprocessing/analysis-engine-registry.mjs";
import {
  getEmailRulesPath,
  loadEmailRules,
  saveEmailRules
} from "../knowledge/preprocessing/domain/rules/email-rules.mjs";
import {
  getExpertVocabularyPath,
  getExpertVocabularySummary,
  listExpertVocabularyVersions,
  loadExpertVocabulary,
  saveExpertVocabulary
} from "../knowledge/preprocessing/domain/rules/expert-vocabulary.mjs";
import {
  getKnowledgeGuidanceSummary,
  getKnowledgeTaxonomyPath,
  listKnowledgeTaxonomyVersions,
  loadKnowledgeTaxonomy,
  saveKnowledgeTaxonomy
} from "../knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs";
import { preprocessWordCloudVocabulary } from "../knowledge/preprocessing/word-cloud/preprocess.mjs";
import {
  createDocumentParsingRuntime,
  toPublicDocumentParsingResult
} from "../knowledge/preprocessing/document-parsing-runtime.mjs";
import { enhanceAffairTaxonomy } from "../knowledge/preprocessing/domain/knowledge-taxonomy/service.mjs";
import { executeConsoleDomainOperation } from "./console-domain-operation-executor.mjs";
import {
  buildAgentSettingsConsoleProjection as buildAgentSettingsConsoleProjectionBase,
  buildClientRuntimeConsoleSummary,
  buildConsoleClientConnections,
  buildConsoleJobsSummary,
  buildMaintenanceAgentConsoleSummary,
  buildRuntimeInfoSettings
} from "./console-state-projections.mjs";
import { buildKnowledgeConsoleSummary } from "./knowledge-console-summary.mjs";
import { resumeKnowledgeWordCloudClassificationTasks } from "./knowledge-word-cloud-operation-executor.mjs";
import { buildRuntimeConsoleSummary } from "./runtime-console-summary.mjs";
import { buildToolManagementClientConnectionRows } from "./tool-management-client-connections.mjs";
import {
  appendUploadSessionChunk,
  buildCheckpointReceiptFromUploadSession,
  createOrResumeUploadSession,
  deleteUploadSession,
  getUploadSession,
  resolveUploadSessionFiles
} from "../../../protocols/checkpoint/upload-session-store.mjs";

async function loadNormalizedDocumentStore() {
  return import("../knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs");
}

async function loadAgentGatewayModule() {
  return import("../agent/agent-gateway/index.mjs");
}

async function loadModelProbeModule() {
  return import("../agent/agent-gateway/model-probe/index.mjs");
}

export function createConsoleDomainServices() {
  const agentRuntimeProvider = createAgentRuntimeProvider({
    getAgentConfigRegistry,
    loadAgentGatewayModule,
    loadModelProbeModule
  });
  const uploadSessionStore = Object.freeze({
    appendUploadSessionChunk,
    buildCheckpointReceiptFromUploadSession,
    createOrResumeUploadSession,
    deleteUploadSession,
    getUploadSession,
    resolveUploadSessionFiles
  });

  return Object.freeze({
    getAgentConfigRegistry,
    agentRuntimeProvider,
    listAvailableAnalysisModules,
    getEmailRulesPath,
    loadEmailRules,
    saveEmailRules,
    getExpertVocabularyPath,
    getExpertVocabularySummary,
    listExpertVocabularyVersions,
    loadExpertVocabulary,
    saveExpertVocabulary,
    getKnowledgeGuidanceSummary,
    getKnowledgeTaxonomyPath,
    listKnowledgeTaxonomyVersions,
    loadKnowledgeTaxonomy,
    saveKnowledgeTaxonomy,
    preprocessWordCloudVocabulary,
    createDocumentParsingRuntime,
    toPublicDocumentParsingResult,
    enhanceAffairTaxonomy,
    buildAgentSettingsConsoleProjection: (input = {}) =>
      buildAgentSettingsConsoleProjectionBase({
        ...input,
        getAgentConfigRegistry
      }),
    buildClientRuntimeConsoleSummary,
    buildConsoleClientConnections,
    buildConsoleJobsSummary,
    buildMaintenanceAgentConsoleSummary,
    buildRuntimeInfoSettings,
    buildKnowledgeConsoleSummary,
    buildRuntimeConsoleSummary,
    executeConsoleDomainOperation,
    resumeKnowledgeWordCloudClassificationTasks,
    buildToolManagementClientConnectionRows,
    uploadSessionStore,
    loadNormalizedDocumentStore,
    loadAgentGatewayModule,
    loadModelProbeModule
  });
}
