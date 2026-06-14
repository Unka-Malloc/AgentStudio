import {
  loadSettings,
  saveSettings
} from "../../../platform-core/settings.mjs";
import { logRuntimeEvent } from "../../../observability/runtime-logger.mjs";

export function createSystemControllerContexts({
  userDataPath,
  runtime,
  moduleManagement = null,
  jobWorkflowProvider,
  metadataStore,
  storageProvider = null,
  protocolEventBus = null,
  securityPermissions = null,
  operationAuditStore = null,
  agentWorkspace = null,
  contextRuntime = null,
  evidenceSufficiencyGate = null,
  knowledgeAgentSkill = null,
  goldenRuleRuntime = null,
  knowledgeRuleAuthoringRuntime = null,
  knowledgeSkillRuntime = null,
  agentEvaluationRuntime = null,
  modelDecisionRuntime = null,
  strategyManagementProvider = null,
  knowledgeEvolutionRuntime = null,
  summarizationRuntime = null,
  agentExplorationRuntime = null,
  clientRuntimeAllocator = null,
  queueMonitor = null,
  getFeatureEntries = () => null,
  consoleDomainServices = null
} = {}) {
  const requireDomainService = (name) => {
    const service = consoleDomainServices?.[name];
    if (typeof service !== "function") {
      throw new Error(`${name} provider is not configured.`);
    }
    return service;
  };
  const requireDomainProvider = (name, validate) => {
    const provider = consoleDomainServices?.[name];
    if (!validate(provider)) {
      throw new Error(`${name} provider is not configured.`);
    }
    return provider;
  };
  const agentRuntimeProvider = requireDomainProvider(
    "agentRuntimeProvider",
    (provider) =>
      provider &&
      typeof provider.getAgentConfigRegistry === "function" &&
      typeof provider.callAgentGateway === "function" &&
      typeof provider.probeModelConnection === "function" &&
      typeof provider.inspectAgentModelRouting === "function"
  );
  const getEmailRulesPath = requireDomainService("getEmailRulesPath");
  const loadEmailRules = requireDomainService("loadEmailRules");
  const saveEmailRules = requireDomainService("saveEmailRules");
  const getExpertVocabularyPath = requireDomainService("getExpertVocabularyPath");
  const getExpertVocabularySummary = requireDomainService("getExpertVocabularySummary");
  const listExpertVocabularyVersions = requireDomainService("listExpertVocabularyVersions");
  const loadExpertVocabulary = requireDomainService("loadExpertVocabulary");
  const saveExpertVocabulary = requireDomainService("saveExpertVocabulary");
  const getKnowledgeGuidanceSummary = requireDomainService("getKnowledgeGuidanceSummary");
  const getKnowledgeTaxonomyPath = requireDomainService("getKnowledgeTaxonomyPath");
  const listKnowledgeTaxonomyVersions = requireDomainService("listKnowledgeTaxonomyVersions");
  const loadKnowledgeTaxonomy = requireDomainService("loadKnowledgeTaxonomy");
  const saveKnowledgeTaxonomy = requireDomainService("saveKnowledgeTaxonomy");
  const preprocessWordCloudVocabulary = requireDomainService("preprocessWordCloudVocabulary");
  const createDocumentParsingRuntime = requireDomainService("createDocumentParsingRuntime");
  const toPublicDocumentParsingResult = requireDomainService("toPublicDocumentParsingResult");
  const enhanceAffairTaxonomy = requireDomainService("enhanceAffairTaxonomy");
  const executeConsoleDomainOperation = requireDomainService("executeConsoleDomainOperation");
  const uploadSessionStore = requireDomainProvider(
    "uploadSessionStore",
    (provider) =>
      provider &&
      typeof provider.resolveUploadSessionFiles === "function" &&
      typeof provider.deleteUploadSession === "function"
  );
  function appendConsoleOperationLog(entry = {}) {
    if (operationAuditStore) {
      try {
        operationAuditStore.append({
          transport: "http",
          risk: entry.risk || "",
          readOnly: entry.readOnly === true,
          status: entry.status || "ok",
          actor: entry.authSession || entry.actor || {},
          operationId: entry.operationId || "console.operation",
          input: entry.input || {},
          output: entry.output,
          error: entry.error || ""
        });
      } catch {
        // Runtime logging below is best-effort and must not break the console path.
      }
    }
    logRuntimeEvent(entry.level || (entry.status === "failed" ? "warn" : "info"), entry.event || entry.operationId || "console.operation", {
      operationId: entry.operationId || "console.operation",
      status: entry.status || "ok",
      actor: entry.authSession?.user || entry.actor || {},
      input: entry.input || {},
      output: entry.output || {},
      error: entry.error || ""
    });
  }

  function knowledgeDomainContext(authSession = null) {
    return {
      runtime,
      metadataStore,
      storageProvider,
      protocolEventBus,
      saveSettings,
      authSession
    };
  }

  function knowledgeWorkflowContext(authSession = null) {
    return {
      protocolEventBus,
      metadataStore,
      storageProvider,
      runtime,
      loadSettings,
      resolveUploadSessionFiles: uploadSessionStore.resolveUploadSessionFiles,
      deleteUploadSession: uploadSessionStore.deleteUploadSession,
      getEmailRulesPath,
      loadEmailRules,
      saveEmailRules,
      getExpertVocabularyPath,
      getExpertVocabularySummary,
      loadExpertVocabulary,
      saveExpertVocabulary,
      listExpertVocabularyVersions,
      getKnowledgeTaxonomyPath,
      loadKnowledgeTaxonomy,
      saveKnowledgeTaxonomy,
      listKnowledgeTaxonomyVersions,
      getKnowledgeGuidanceSummary,
      createDocumentParsingRuntime,
      toPublicDocumentParsingResult,
      enhanceAffairTaxonomy,
      preprocessWordCloudVocabulary,
      evidenceSufficiencyGate,
      knowledgeAgentSkill,
      goldenRuleRuntime,
      knowledgeRuleAuthoringRuntime,
      knowledgeSkillRuntime,
      agentEvaluationRuntime,
      modelDecisionRuntime,
      strategyManagementProvider,
      knowledgeEvolutionRuntime,
      jobWorkflowProvider,
      queueMonitor,
      contextRuntime,
      clientRuntimeAllocator,
      agentRuntimeProvider,
      appendConsoleOperationLog,
      summarizationRuntime,
      agentExplorationRuntime,
      authSession
    };
  }

  function settingsAgentGatewayContext(authSession = null, extra = {}) {
    return {
      runtime,
      moduleManagement,
      protocolEventBus,
      contextRuntime,
      agentWorkspace,
      clientRuntimeAllocator,
      agentRuntimeProvider,
      appendConsoleOperationLog,
      authSession,
      ...extra
    };
  }

  function authorizationFacadeContext(authSession = null, extra = {}) {
    return {
      securityPermissions,
      protocolEventBus,
      authSession,
      ...extra
    };
  }

  function accessControlContext(authSession = null, extra = {}) {
    return {
      securityPermissions,
      authSession,
      ...extra
    };
  }

  function isFeatureActive(featureId) {
    const features = getFeatureEntries ? getFeatureEntries() : null;
    const active = Array.isArray(features?.activeFeatureIds) ? features.activeFeatureIds : [];
    return active.length === 0 || active.includes(featureId);
  }

  return Object.freeze({
    executeConsoleDomainOperation,
    knowledgeDomainContext,
    knowledgeWorkflowContext,
    settingsAgentGatewayContext,
    authorizationFacadeContext,
    accessControlContext,
    appendConsoleOperationLog,
    isFeatureActive
  });
}
