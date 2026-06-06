import path from "node:path";
import { getAgentConfigRegistry } from "../agent/agent-configs/config-registry.mjs";
import { createAgentRuntimeProvider } from "../agent/agent-runtime-provider.mjs";
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

async function loadAnalysisEngineRegistry() {
  return import("../knowledge/preprocessing/analysis-engine-registry.mjs");
}

async function loadEmailRulesModule() {
  return import("../knowledge/preprocessing/domain/rules/email-rules.mjs");
}

async function loadExpertVocabularyModule() {
  return import("../knowledge/preprocessing/domain/rules/expert-vocabulary.mjs");
}

async function loadKnowledgeTaxonomyModule() {
  return import("../knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs");
}

async function loadDocumentParsingRuntimeModule() {
  return import("../knowledge/preprocessing/document-parsing-runtime.mjs");
}

function getRulesDirectory(userDataPath) {
  return path.join(userDataPath, "rules");
}

function getEmailRulesPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "email-rules.json");
}

function getExpertVocabularyPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "expert-vocabulary.json");
}

function getKnowledgeTaxonomyPath(userDataPath) {
  return path.join(getRulesDirectory(userDataPath), "knowledge-taxonomy.json");
}

async function listAvailableAnalysisModules(...args) {
  const module = await loadAnalysisEngineRegistry();
  return module.listAvailableAnalysisModules(...args);
}

async function loadEmailRules(...args) {
  const module = await loadEmailRulesModule();
  return module.loadEmailRules(...args);
}

async function saveEmailRules(...args) {
  const module = await loadEmailRulesModule();
  return module.saveEmailRules(...args);
}

async function getExpertVocabularySummary(...args) {
  const module = await loadExpertVocabularyModule();
  return module.getExpertVocabularySummary(...args);
}

async function listExpertVocabularyVersions(...args) {
  const module = await loadExpertVocabularyModule();
  return module.listExpertVocabularyVersions(...args);
}

async function loadExpertVocabulary(...args) {
  const module = await loadExpertVocabularyModule();
  return module.loadExpertVocabulary(...args);
}

async function saveExpertVocabulary(...args) {
  const module = await loadExpertVocabularyModule();
  return module.saveExpertVocabulary(...args);
}

async function getKnowledgeGuidanceSummary(...args) {
  const module = await loadKnowledgeTaxonomyModule();
  return module.getKnowledgeGuidanceSummary(...args);
}

async function listKnowledgeTaxonomyVersions(...args) {
  const module = await loadKnowledgeTaxonomyModule();
  return module.listKnowledgeTaxonomyVersions(...args);
}

async function loadKnowledgeTaxonomy(...args) {
  const module = await loadKnowledgeTaxonomyModule();
  return module.loadKnowledgeTaxonomy(...args);
}

async function saveKnowledgeTaxonomy(...args) {
  const module = await loadKnowledgeTaxonomyModule();
  return module.saveKnowledgeTaxonomy(...args);
}

async function preprocessWordCloudVocabulary(...args) {
  const module = await import("../knowledge/preprocessing/word-cloud/preprocess.mjs");
  return module.preprocessWordCloudVocabulary(...args);
}

async function createDocumentParsingRuntime(...args) {
  const module = await loadDocumentParsingRuntimeModule();
  return module.createDocumentParsingRuntime(...args);
}

async function toPublicDocumentParsingResult(...args) {
  const module = await loadDocumentParsingRuntimeModule();
  return module.toPublicDocumentParsingResult(...args);
}

async function enhanceAffairTaxonomy(...args) {
  const module = await import("../knowledge/preprocessing/domain/knowledge-taxonomy/service.mjs");
  return module.enhanceAffairTaxonomy(...args);
}

async function resumeKnowledgeWordCloudClassificationTasks(...args) {
  const module = await import("./knowledge-word-cloud-operation-executor.mjs");
  return module.resumeKnowledgeWordCloudClassificationTasks(...args);
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
