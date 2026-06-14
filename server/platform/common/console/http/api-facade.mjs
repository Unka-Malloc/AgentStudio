import os from "node:os";
import { buildBootstrapPayload, getDiscoveryConfigPath } from "../../platform-core/discovery/config.mjs";
import { createV001BaselineProvider } from "../../v001/baseline-provider.mjs";
export { buildClientConnectionList } from "./client-connection-list.mjs";

function emptyAgentSettingsProjection() {
  return {
    settings: {
      path: "",
      value: {}
    },
    agentSelector: {
      schemaVersion: "v0.0.1:schema:definition-1",
      source: "agent-configs",
      updatedAt: new Date().toISOString(),
      options: []
    },
    agentConfigs: {
      rootPath: "",
      modelListPath: "",
      agentListPath: "",
      modelManifest: {},
      agentManifest: {}
    }
  };
}

function normalizeConsoleDomainServices(services = {}) {
  return {
    listAvailableAnalysisModules:
      typeof services.listAvailableAnalysisModules === "function"
        ? services.listAvailableAnalysisModules
        : async () => [],
    getEmailRulesPath:
      typeof services.getEmailRulesPath === "function" ? services.getEmailRulesPath : () => "",
    loadEmailRules:
      typeof services.loadEmailRules === "function" ? services.loadEmailRules : async () => ({}),
    getExpertVocabularyPath:
      typeof services.getExpertVocabularyPath === "function" ? services.getExpertVocabularyPath : () => "",
    loadExpertVocabulary:
      typeof services.loadExpertVocabulary === "function" ? services.loadExpertVocabulary : async () => ({}),
    getKnowledgeGuidanceSummary:
      typeof services.getKnowledgeGuidanceSummary === "function"
        ? services.getKnowledgeGuidanceSummary
        : async () => ({}),
    getKnowledgeTaxonomyPath:
      typeof services.getKnowledgeTaxonomyPath === "function" ? services.getKnowledgeTaxonomyPath : () => "",
    loadKnowledgeTaxonomy:
      typeof services.loadKnowledgeTaxonomy === "function" ? services.loadKnowledgeTaxonomy : async () => ({}),
    buildToolManagementClientConnectionRows:
      typeof services.buildToolManagementClientConnectionRows === "function"
        ? services.buildToolManagementClientConnectionRows
        : () => [],
    buildAgentSettingsConsoleProjection:
      typeof services.buildAgentSettingsConsoleProjection === "function"
        ? services.buildAgentSettingsConsoleProjection
        : async () => emptyAgentSettingsProjection(),
    buildConsoleJobsSummary:
      typeof services.buildConsoleJobsSummary === "function"
        ? services.buildConsoleJobsSummary
        : async () => ({ summary: {}, items: [] }),
    buildConsoleClientConnections:
      typeof services.buildConsoleClientConnections === "function"
        ? services.buildConsoleClientConnections
        : async () => ({ summary: {}, items: [] }),
    buildMaintenanceAgentConsoleSummary:
      typeof services.buildMaintenanceAgentConsoleSummary === "function"
        ? services.buildMaintenanceAgentConsoleSummary
        : async () => null,
    buildClientRuntimeConsoleSummary:
      typeof services.buildClientRuntimeConsoleSummary === "function"
        ? services.buildClientRuntimeConsoleSummary
        : async () => null,
    buildRuntimeInfoSettings:
      typeof services.buildRuntimeInfoSettings === "function"
        ? services.buildRuntimeInfoSettings
        : async () => ({}),
    buildKnowledgeConsoleSummary:
      typeof services.buildKnowledgeConsoleSummary === "function"
        ? services.buildKnowledgeConsoleSummary
        : async () => null,
    buildRuntimeConsoleSummary:
      typeof services.buildRuntimeConsoleSummary === "function"
        ? services.buildRuntimeConsoleSummary
        : async () => null
  };
}

function featureEnabled(features, featureId) {
  const active = Array.isArray(features?.activeFeatureIds) ? features.activeFeatureIds : [];
  return active.length === 0 || active.includes(featureId);
}

function storageSummaryFrom(storageProvider = null) {
  return typeof storageProvider?.getStorageSummary === "function"
    ? storageProvider.getStorageSummary()
    : null;
}

export async function buildConsoleState({
  userDataPath,
  distPath,
  runtime,
  moduleManagement = null,
  discoveryState,
  jobWorkflowProvider = null,
  storageProvider = null,
  serverUrl,
  securityPermissions = null,
  request = null,
  maintenanceAgent = null,
  clientRuntimeAllocator = null,
  features = null,
  toolSkillManagementProvider = null,
  consoleDomainServices = null
}) {
  const domainServices = normalizeConsoleDomainServices(consoleDomainServices);
  const knowledgeCoreEnabled = featureEnabled(features, "knowledge-core");
  const [
    agentSettingsProjection,
    rules,
    expertVocabulary,
    knowledgeTaxonomy,
    knowledgeGuidance,
    jobs,
    clients,
    maintenanceAgentSummary,
    clientRuntimeSummary
  ] = await Promise.all([
    domainServices.buildAgentSettingsConsoleProjection({ userDataPath }),
    knowledgeCoreEnabled ? domainServices.loadEmailRules(userDataPath) : Promise.resolve({}),
    knowledgeCoreEnabled ? domainServices.loadExpertVocabulary(userDataPath) : Promise.resolve({}),
    knowledgeCoreEnabled ? domainServices.loadKnowledgeTaxonomy(userDataPath) : Promise.resolve({}),
    knowledgeCoreEnabled ? domainServices.getKnowledgeGuidanceSummary(userDataPath) : Promise.resolve({}),
    domainServices.buildConsoleJobsSummary({
      jobWorkflowProvider,
      limit: 50
    }),
    domainServices.buildConsoleClientConnections({
      storageProvider,
      offlineAfterSeconds: discoveryState.offlineAfterSeconds,
      toolSkillManagementProvider,
      buildToolManagementClientConnectionRows: domainServices.buildToolManagementClientConnectionRows
    }),
    domainServices.buildMaintenanceAgentConsoleSummary({ maintenanceAgent }),
    domainServices.buildClientRuntimeConsoleSummary({ clientRuntimeAllocator })
  ]);
  const projectedSettings = agentSettingsProjection.settings.value;
  const runtimeSummary = await domainServices.buildRuntimeConsoleSummary({
    userDataPath,
    runtime,
    moduleManagement,
    settings: projectedSettings,
    features,
    listAvailableAnalysisModules: domainServices.listAvailableAnalysisModules
  });

  return {
    server: {
      url: serverUrl,
      userDataPath,
      distPath: distPath || "",
      hostname: os.hostname()
    },
    runtime: runtimeSummary,
    settings: agentSettingsProjection.settings,
    agentSelector: agentSettingsProjection.agentSelector,
    agentConfigs: agentSettingsProjection.agentConfigs,
    discovery: {
      path: getDiscoveryConfigPath(userDataPath),
      value: discoveryState,
      bootstrap: buildBootstrapPayload(discoveryState)
    },
    emailRules: {
      path: domainServices.getEmailRulesPath(userDataPath),
      rules
    },
    expertVocabulary: {
      path: domainServices.getExpertVocabularyPath(userDataPath),
      vocabulary: expertVocabulary
    },
    knowledgeTaxonomy: {
      path: domainServices.getKnowledgeTaxonomyPath(userDataPath),
      taxonomy: knowledgeTaxonomy,
      guidance: knowledgeGuidance
    },
    auth: securityPermissions?.getConsoleSummary
      ? securityPermissions.getConsoleSummary(request)
      : null,
    maintenanceAgent: maintenanceAgentSummary,
    knowledgeConsole: knowledgeCoreEnabled
      ? await domainServices.buildKnowledgeConsoleSummary(runtime, jobWorkflowProvider)
      : null,
    storage: storageSummaryFrom(storageProvider),
    v001Baseline: await createV001BaselineProvider({ userDataPath }).status(),
    jobs,
    clients,
    clientRuntime: clientRuntimeSummary,
    features
  };
}

export async function buildRuntimeInfo({
  userDataPath,
  distPath,
  runtime,
  moduleManagement = null,
  discoveryState,
  storageProvider = null,
  serverUrl,
  securityPermissions = null,
  request = null,
  features = null,
  consoleDomainServices = null
}) {
  const domainServices = normalizeConsoleDomainServices(consoleDomainServices);
  const settings = await domainServices.buildRuntimeInfoSettings({ userDataPath });
  const runtimeSummary = await domainServices.buildRuntimeConsoleSummary({
    userDataPath,
    runtime,
    moduleManagement,
    settings,
    features,
    listAvailableAnalysisModules: domainServices.listAvailableAnalysisModules
  });
  return {
    server: {
      url: serverUrl,
      userDataPath,
      distPath: distPath || "",
      hostname: os.hostname()
    },
    runtime: runtimeSummary,
    auth: securityPermissions?.getConsoleSummary
      ? securityPermissions.getConsoleSummary(request)
      : null,
    storage: storageSummaryFrom(storageProvider),
    v001Baseline: await createV001BaselineProvider({ userDataPath }).status(),
    discovery: buildBootstrapPayload(discoveryState),
    features
  };
}
