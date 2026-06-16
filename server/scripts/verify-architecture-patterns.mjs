import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertTextIncludes(text, needle, message) {
  assert.equal(text.includes(needle), true, message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertTextExcludes(text, needles, file) {
  const found = needles.filter((needle) => {
    const hasCallOrMemberShape = /[.({]/.test(needle);
    return hasCallOrMemberShape
      ? text.includes(needle)
      : new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(text);
  });
  assert.deepEqual(found, [], `${file} must keep platform assembly behind the composition root`);
}

async function assertHttpServerUsesCompositionRoot() {
  const file = "server/services/server-runtime/http-server.mjs";
  const text = await read(file);
  assertTextIncludes(
    text,
    "createServerCompositionRoot",
    "server/services/server-runtime/http-server.mjs must create its runtime through the composition root"
  );
  assertTextIncludes(
    text,
    "ensureConsoleOwner",
    "server/services/server-runtime/http-server.mjs must delegate owner bootstrapping to the composition root helper"
  );
  assertTextIncludes(
    text,
    "createServerRuntimeProviders",
    "server/services/server-runtime/http-server.mjs must create feature runtime services through the provider registry"
  );
  assertTextIncludes(
    text,
    "createServerToolManagementPlatform",
    "server/services/server-runtime/http-server.mjs must create Tool Management through the provider registry"
  );
  assertTextIncludes(
    text,
    "registeredCoreProvider.dispatchInternalOperation",
    "server/services/server-runtime/http-server.mjs must publish internal snapshots through the core provider"
  );
  for (const needle of [
    "dispatchStartupSnapshot(\"system.interfaces\")",
    "dispatchStartupSnapshot(\"discovery.get_config\")",
    "dispatchStartupSnapshot(\"agent_sync.config.get\"",
    "dispatchStartupSnapshot(\"system.console_state\")",
    "dispatchStartupSnapshot(\"storage.summary\")"
  ]) {
    assertTextIncludes(
      text,
      needle,
      `server/services/server-runtime/http-server.mjs must publish startup snapshot through ${needle}`
    );
  }
  assertTextExcludes(
    text,
    [
      "createOptionalRuntime",
      "createPlatformRegistry",
      "registerCorePlatformServices",
      "registerSecurityPlatformServices",
      "registerDataStructurePlatformServices",
      "registerModuleManagementPlatformServices",
      "registerStoragePlatformServices",
      "registerDevopsPlatformServices",
      "createConsoleAuth",
      "createOperationAuditStore",
      "createServerRuntime",
      "createProtocolEventBus",
      "resolveFeatureRuntimeFromEnv",
      "filterOperationsForFeatures",
      "publicFeatureRuntime",
      "SERVER_API_OPERATIONS",
      "getAgentConfigRegistry",
      "createAgentMemory",
      "createContextRuntime",
      "callAgentGatewayIfAvailable",
      "agent-gateway/index.mjs",
      "createToolManagementPlatform",
      "tool-management-core/index.mjs",
      "monitor-alert-core/monitor-alerts.mjs",
      "operation-dispatcher/operation-dispatcher.mjs",
      "operation-dispatcher/operation-registry.mjs",
      "buildConsoleState",
      "loadSettings(userDataPath)",
      "loadAgentSyncConfig(userDataPath)",
      "metadataStore.getStorageSummary(),",
      "interfaces: listInterfaceCatalog(activeApiOperations)",
      "checkpoint-tree-store.mjs"
    ],
    file
  );
}

async function assertCompositionRootOwnsAssembly() {
  const file = "server/platform/interactive/composition-root.mjs";
  const text = await read(file);
  for (const needle of [
    "createPlatformRegistry",
    "registerCorePlatformServices",
    "registerSecurityPlatformServices",
    "registerDataStructurePlatformServices",
    "createDataStructureProvider",
    "registerModuleManagementPlatformServices",
    "registerStoragePlatformServices",
    "createStorageProvider",
    "registerDevopsPlatformServices",
    "createCorePlatformProvider",
    "createDevopsProvider",
    "createConsoleAuth",
    "createSecurityPermissionsProvider",
    "createModuleManagementProvider",
    "createOperationAuditStore",
    "createServerRuntime",
    "createProtocolEventBus",
    "resolveFeatureRuntimeFromEnv",
    "filterOperationsForFeatures",
    "publicFeatureRuntime",
    "SERVER_API_OPERATIONS",
    "getAgentConfigRegistry",
    "loadSettings(userDataPath)"
  ]) {
    assertTextIncludes(text, needle, `${file} must own ${needle}`);
  }
}

async function assertRuntimeProvidersOwnProviderImports() {
  const file = "server/platform/interactive/server-runtime-providers.mjs";
  const text = await read(file);
  for (const needle of [
    "createProvider",
    "createServerRuntimeProviders",
    "createServerToolManagementPlatform",
    "securityPermissions",
    "createStrategyManagementProvider",
    "strategyManagementProvider",
    "createModelDecisionRuntimePort",
    "createAgentMemory",
    "createContextRuntime",
    "callAgentGatewayIfAvailable",
    "agent-gateway/index.mjs",
    "createToolManagementPlatform",
    "tool-management-core/index.mjs",
    "maintenance-agent-runbooks",
    "knowledge-distillation",
    "agent-exploration",
    "await import(specifier)"
  ]) {
    assertTextIncludes(text, needle, `${file} must own runtime provider selection`);
  }
}

async function assertDataStructureProviderOwnsPorts() {
  const file = "server/platform/common/data-structure/data-structure-provider.mjs";
  const text = await read(file);
  for (const needle of [
    "v0.0.1:storage:data-structure-1",
    "createDataStructureProvider",
    "checkpointTree",
    "textNormalization",
    "listCapabilities",
    "diffCheckpointTree",
    "queryCheckpointScope",
    "previewCheckpointRestore",
    "restoreCheckpointTree",
    "uniqueNormalizedStrings"
  ]) {
    assertTextIncludes(text, needle, `${file} must own data structure provider port ${needle}`);
  }
}

async function assertCorePlatformProviderOwnsPorts() {
  const file = "server/platform/common/platform-core/core-platform-provider.mjs";
  const text = await read(file);
  for (const needle of [
    "v0.0.1:platform:core-1",
    "createCorePlatformProvider",
    "dispatchRegisteredHttpOperation",
    "dispatchRpcOperation",
    "dispatchInternalOperation",
    "findProxyRegisteredApiRequest",
    "shouldProxyRegisteredApiRequest",
    "describeOperationRegistry",
    "buildSystemInterfaces",
    "registered",
    "wired",
    "implemented",
    "verified",
    "listCapabilities"
  ]) {
    assertTextIncludes(text, needle, `${file} must own core platform provider port ${needle}`);
  }
  const executor = await read("server/platform/specialized/console/console-domain-operation-executor.mjs");
  assertTextIncludes(
    executor,
    "context.coreProvider.buildSystemInterfaces",
    "system.interfaces must be built through core provider"
  );
}

async function assertStorageProviderOwnsPorts() {
  const file = "server/platform/common/storage/storage-provider.mjs";
  const text = await read(file);
  for (const needle of [
    "v0.0.1:storage:core-1",
    "createStorageProvider",
    "getStorageSummary",
    "readRawObjectById",
    "resolveStoredObjectPath",
    "recordClientCheckIn",
    "listClientRegistrations",
    "findClientRegistration",
    "runDoctor",
    "reconcile",
    "listBackups",
    "createBackup",
    "restoreBackupPreview",
    "restoreBackup",
    "rebuildSourceVocabulary",
    "getSignificantSourceTerms",
    "search",
    "listCapabilities"
  ]) {
    assertTextIncludes(text, needle, `${file} must own storage provider port ${needle}`);
  }
}

async function assertDevopsProviderOwnsPorts() {
  const file = "server/platform/common/devops/devops-provider.mjs";
  const text = await read(file);
  for (const needle of [
    "v0.0.1:platform:devops-1",
    "createDevopsProvider",
    "getBackgroundProcessStatus",
    "getMonitorAlertState",
    "saveMonitorAlertConfig",
    "runMonitorAlertCycle",
    "acknowledgeMonitorAlert",
    "createMonitorAlertApi",
    "normalizeUnifiedRegistration",
    "composeUnifiedSystemStatus",
    "listCapabilities"
  ]) {
    assertTextIncludes(text, needle, `${file} must own devops provider port ${needle}`);
  }
  const httpServer = await read("server/services/server-runtime/http-server.mjs");
  const executor = await read("server/platform/specialized/console/console-domain-operation-executor.mjs");
  assertTextExcludes(
    httpServer,
    [
      "monitor-alert-core/monitor-alerts.mjs"
    ],
    "server/services/server-runtime/http-server.mjs"
  );
  assertTextExcludes(
    executor,
    [
      "process-status/background-process-status.mjs",
      "await getBackgroundProcessStatus(",
      "monitorAlertApi."
    ],
    "server/platform/specialized/console/console-domain-operation-executor.mjs"
  );
}

async function assertCommonConsoleDelegatesSpecializedOperations() {
  const dispatcherFile = "server/platform/common/operation-dispatcher/operation-dispatcher.mjs";
  const apiFacadeFile = "server/platform/common/console/http/api-facade.mjs";
  const jobsControllerFile = "server/platform/common/console/http/controllers/jobs-controller.mjs";
  const controllerFile = "server/platform/common/console/http/controllers/system-controller.mjs";
  const contextFile = "server/platform/common/console/http/controllers/system-controller-contexts.mjs";
  const agentSettingsHandlersFile = "server/platform/common/console/http/controllers/system-controller-agent-settings-handlers.mjs";
  const authHandlersFile = "server/platform/common/console/http/controllers/system-controller-auth-handlers.mjs";
  const capabilityEcosystemHandlersFile = "server/platform/common/console/http/controllers/system-controller-capability-ecosystem-handlers.mjs";
  const foundationHandlersFile = "server/platform/common/console/http/controllers/system-controller-foundation-handlers.mjs";
  const knowledgeOperationsHandlersFile = "server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs";
  const knowledgeRuntimeHandlersFile = "server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs";
  const opsObservationHandlersFile = "server/platform/common/console/http/controllers/system-controller-ops-observation-handlers.mjs";
  const runtimeHandlersFile = "server/platform/common/console/http/controllers/system-controller-runtime-handlers.mjs";
  const workspaceProtocolHandlersFile = "server/platform/common/console/http/controllers/system-controller-workspace-protocol-handlers.mjs";
  const workspaceRuntimeHandlersFile = "server/platform/common/console/http/controllers/system-controller-workspace-runtime-handlers.mjs";
  const executorFile = "server/platform/specialized/console/console-domain-operation-executor.mjs";
  const providerFile = "server/platform/specialized/console/console-domain-services.mjs";
  const clientConnectionListFile = "server/platform/common/console/http/client-connection-list.mjs";
  const consoleStateProjectionFile = "server/platform/specialized/console/console-state-projections.mjs";
  const jobWorkflowProviderFile = "server/platform/specialized/console/job-workflow-provider.mjs";
  const knowledgeConsoleSummaryFile = "server/platform/specialized/console/knowledge-console-summary.mjs";
  const runtimeConsoleSummaryFile = "server/platform/specialized/console/runtime-console-summary.mjs";
  const toolManagementConnectionsFile = "server/platform/specialized/console/tool-management-client-connections.mjs";
  const agentRuntimeProviderFile = "server/platform/specialized/agent/agent-runtime-provider.mjs";
  const toolSkillManagementProviderFile = "server/platform/specialized/capabilities/skills/tool-skill-management-provider.mjs";
  const securityPermissionsProviderFile = "server/platform/common/security/security-permissions-provider.mjs";
  const moduleManagementProviderFile = "server/platform/common/module-manager/module-management-provider.mjs";
  const wordCloudFile = "server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs";
  const codespaceModuleFile = "server/platform/specialized/capabilities/code-management/codespace/module.json";
  const knowledgeTransformationModuleFile = "server/platform/specialized/knowledge/transformation/module.json";
  const strategyManagementProviderFile = "server/platform/specialized/capabilities/strategy-management/strategy-management-provider.mjs";
  const dispatcher = await read(dispatcherFile);
  const apiFacade = await read(apiFacadeFile);
  const jobsController = await read(jobsControllerFile);
  const controller = await read(controllerFile);
  const contextFactory = await read(contextFile);
  const agentSettingsHandlers = await read(agentSettingsHandlersFile);
  const authHandlers = await read(authHandlersFile);
  const capabilityEcosystemHandlers = await read(capabilityEcosystemHandlersFile);
  const foundationHandlers = await read(foundationHandlersFile);
  const knowledgeOperationsHandlers = await read(knowledgeOperationsHandlersFile);
  const knowledgeRuntimeHandlers = await read(knowledgeRuntimeHandlersFile);
  const opsObservationHandlers = await read(opsObservationHandlersFile);
  const runtimeHandlers = await read(runtimeHandlersFile);
  const workspaceProtocolHandlers = await read(workspaceProtocolHandlersFile);
  const workspaceRuntimeHandlers = await read(workspaceRuntimeHandlersFile);
  const executor = await read(executorFile);
  const provider = await read(providerFile);
  const clientConnectionList = await read(clientConnectionListFile);
  const consoleStateProjection = await read(consoleStateProjectionFile);
  const jobWorkflowProvider = await read(jobWorkflowProviderFile);
  const knowledgeConsoleSummary = await read(knowledgeConsoleSummaryFile);
  const runtimeConsoleSummary = await read(runtimeConsoleSummaryFile);
  const toolManagementConnections = await read(toolManagementConnectionsFile);
  const agentRuntimeProvider = await read(agentRuntimeProviderFile);
  const toolSkillManagementProvider = await read(toolSkillManagementProviderFile);
  const securityPermissionsProvider = await read(securityPermissionsProviderFile);
  const moduleManagementProvider = await read(moduleManagementProviderFile);
  const wordCloud = await read(wordCloudFile);
  const codespaceModule = await read(codespaceModuleFile);
  const knowledgeTransformationModule = await read(knowledgeTransformationModuleFile);
  const strategyManagementProvider = await read(strategyManagementProviderFile);

  for (const needle of [
    "dispatchInternalOperation",
    "transport: \"internal\"",
    "parseCapturedResult"
  ]) {
    assertTextIncludes(dispatcher, needle, `${dispatcherFile} must support internal workflow dispatch through registered operations`);
  }

  assertTextIncludes(
    controller,
    "createSystemControllerContexts",
    `${controllerFile} must get domain contexts from the controller context factory`
  );
  assertTextIncludes(
    jobsController,
    "jobWorkflowProvider",
    `${jobsControllerFile} must receive job workflow protocol functions through an injected provider`
  );
  assertTextIncludes(
    jobsController,
    "uploadSessionStore",
    `${jobsControllerFile} must receive checkpoint upload session protocol functions through injected domain services`
  );
  assertTextIncludes(
    jobsController,
    "storageProvider",
    `${jobsControllerFile} must receive storage protocol functions through injected platform services`
  );
  assertTextExcludes(
    jobsController,
    [
      "upload-session-store.mjs",
      "resolveStoredObjectPath",
      "metadataStore.",
      "jobManager."
    ],
    jobsControllerFile
  );
  assertTextIncludes(
    apiFacade,
    "buildAgentSettingsConsoleProjection",
    `${apiFacadeFile} must get settings and agent selector projections through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildConsoleJobsSummary",
    `${apiFacadeFile} must get job summaries through the job workflow provider projection`
  );
  assertTextIncludes(
    apiFacade,
    "buildConsoleClientConnections",
    `${apiFacadeFile} must get client connection projections through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildMaintenanceAgentConsoleSummary",
    `${apiFacadeFile} must get maintenance summaries through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildClientRuntimeConsoleSummary",
    `${apiFacadeFile} must get client runtime status through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildRuntimeInfoSettings",
    `${apiFacadeFile} must get runtime info settings through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildToolManagementClientConnectionRows",
    `${apiFacadeFile} must get Tool Management client connection rows through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildKnowledgeConsoleSummary",
    `${apiFacadeFile} must get knowledge console summaries through domain services`
  );
  assertTextIncludes(
    apiFacade,
    "buildRuntimeConsoleSummary",
    `${apiFacadeFile} must get runtime console summaries through domain services`
  );
  assertTextExcludes(
    apiFacade,
    [
      "listGrants",
      "mcpGrantRows",
      "isMcpPluginGrant",
      "toolManagementPlatform?.store",
      "metadata.connectorVersion",
      "sourceGrantId: grant.id",
      "runtime?.mounts?.knowledgeBase",
      "knowledgeBase?.health",
      "knowledgeBase?.capabilities",
      "knowledgeBase?.getMaintenance",
      "redactModulePaths",
      "summarizeMount",
      "runtime.runtimeOptions",
      "runtime.mounts ||",
      "getMountConfigPath",
      "getMountConfigPaths",
      "loadMountConfig(userDataPath)",
      "metadataStore.",
      "getStorageSummary(),",
      "loadSettings(userDataPath",
      "getSettingsPath(userDataPath",
      "getAgentConfigRegistry",
      "buildAgentSelector",
      "agentSelectorStatus",
      "jobManager.listJobs({",
      "maintenanceAgent.getConsoleSummary",
      "clientRuntimeAllocator.getStatus",
      "listClientRegistrations("
    ],
    apiFacadeFile
  );
  for (const needle of [
    "buildClientConnectionList",
    "normalizePactClientRow",
    "buildClientConnectionSummary"
  ]) {
    assertTextIncludes(clientConnectionList, needle, `${clientConnectionListFile} must own client connection list projection ${needle}`);
  }
  for (const needle of [
    "buildAgentSettingsConsoleProjection",
    "buildConsoleJobsSummary",
    "buildConsoleClientConnections",
    "buildMaintenanceAgentConsoleSummary",
    "buildClientRuntimeConsoleSummary",
    "buildRuntimeInfoSettings"
  ]) {
    assertTextIncludes(consoleStateProjection, needle, `${consoleStateProjectionFile} must own console state projection ${needle}`);
    assertTextIncludes(provider, needle, `${providerFile} must expose console state projection ${needle}`);
  }
  for (const needle of [
    "v0.0.1:workflow:job-workflow-1",
    "createJobWorkflowProvider",
    "createJob",
    "getJob",
    "getJobByCheckpointId",
    "getJobResult",
    "listJobs",
    "reparseJob"
  ]) {
    assertTextIncludes(jobWorkflowProvider, needle, `${jobWorkflowProviderFile} must own job workflow provider port ${needle}`);
  }
  for (const needle of [
    "v0.0.1:agent:runtime-1",
    "createAgentRuntimeProvider",
    "getAgentConfigRegistry",
    "publicAgentGatewayConfig",
    "publicAgentGatewayRegistry",
    "callAgentGateway",
    "callGatewayWithRuntimeSettings",
    "probeModelConnection",
    "inspectAgentModelRouting"
  ]) {
    assertTextIncludes(agentRuntimeProvider, needle, `${agentRuntimeProviderFile} must own agent runtime provider port ${needle}`);
  }
  assertTextIncludes(provider, "agentRuntimeProvider", `${providerFile} must expose agent runtime provider`);
  assertTextIncludes(executor, "agentRuntimeProviderFrom", `${executorFile} must resolve agent operations through agent runtime provider`);
  assertTextExcludes(
    executor,
    [
      "context.loadAgentGatewayModule",
      "context.loadModelProbeModule",
      "context.agentConfigRegistry",
      "context.getAgentConfigRegistry"
    ],
    executorFile
  );
  assertTextExcludes(
    wordCloud,
    [
      "loadAgentGatewayModule",
      "getAgentConfigRegistry",
      "agentRuntimeProvider",
      "loadSettings("
    ],
    wordCloudFile
  );
  assertTextIncludes(
    controller,
    "createSystemControllerFoundationHandlers",
    `${controllerFile} must compose foundation protocol handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerAuthHandlers",
    `${controllerFile} must compose console auth handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerCapabilityEcosystemHandlers",
    `${controllerFile} must compose capability ecosystem handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerAgentSettingsHandlers",
    `${controllerFile} must compose settings and Agent Gateway handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerRuntimeHandlers",
    `${controllerFile} must compose runtime/system protocol handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerKnowledgeOperationsHandlers",
    `${controllerFile} must compose knowledge operation handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerKnowledgeRuntimeHandlers",
    `${controllerFile} must compose knowledge runtime handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerOpsObservationHandlers",
    `${controllerFile} must compose ops/system observation handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerWorkspaceProtocolHandlers",
    `${controllerFile} must compose workspace protocol façade handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "createSystemControllerWorkspaceRuntimeHandlers",
    `${controllerFile} must compose workspace runtime handlers from a dedicated handler module`
  );
  assertTextIncludes(
    controller,
    "executeConsoleDomainOperation",
    `${controllerFile} must delegate specialized console operations through the domain operation executor`
  );
  assertTextExcludes(
    controller,
    [
      "createWorkspaceGovernanceRegistry",
      "createCapabilityPackageRegistry",
      "createAssetLineageRegistry",
      "executeGerritCommonOperation",
      "uploadGerritGitChange",
      "executeRepoOperation",
      "createDataConnectorGovernance",
      "runPerformanceCapacityBenchmark",
      "createContributionRegistry",
      "evaluateKnowledgeAccess",
      "contextRuntime.preview",
      "contextRuntime.previewCompaction",
      "contextRuntime.runCompaction",
      "contextRuntime.listCompactionRecords",
      "contextRuntime.listSessionMemory",
      "contextRuntime.clearSessionMemory",
      "contextRuntime.listBuildRecords",
      "contextRuntime.runEvaluation",
      "agentWorkspace.createWorkspaceFolder",
      "agentWorkspace.listWorkspaceFiles",
      "agentWorkspace.workspaceFileMetadata",
      "agentWorkspace.downloadWorkspaceFile",
      "agentWorkspace.uploadWorkspaceFile",
      "agentWorkspace.writeWorkspaceFile",
      "agentWorkspace.deleteWorkspaceFile",
      "agentWorkspace.moveWorkspaceFile",
      "agentWorkspace.listWorkspaces",
      "agentWorkspace.getWorkspace({",
      "agentWorkspace.createWorkspace",
      "agentWorkspace.deleteWorkspace",
      "agentWorkspace.listSessions",
      "agentWorkspace.getSession({",
      "agentWorkspace.appendSessionEvent",
      "agentWorkspace.forkSession",
      "agentWorkspace.compareSessions",
      "agentWorkspace.createSessionMergeProposal",
      "agentWorkspace.archiveSession",
      "agentWorkspace.resolveSubmission",
      "agentWorkspace.updateIssue",
      "agentWorkspace.listLocks",
      "agentWorkspace.releaseLock",
      "agentWorkspace.acquireLock",
      "agentWorkspace.exportWorkspaceContextBundle",
      "agentWorkspace.restoreWorkspaceContextBundle",
      "agentWorkspace.resolveWorkspaceChain",
      "agentWorkspace.resolveWorkspaceSourceIds",
      "agentWorkspace.resolveWorkspaceProfile",
      "agentWorkspace.setWorkspaceParent",
      "agentWorkspace.hotSwapProfile",
      "agentWorkspace.setOwnedSourceIds",
      "agentWorkspace.shareWorkspace",
      "agentWorkspace.unshareWorkspace",
      "getKnowledgeCore(",
      "knowledgeCore.",
      "knowledgeCore.search",
      "knowledgeCore.prepareHierarchyReasoning",
      "knowledgeCore.renderMarkdown",
      "knowledgeCore.getDocumentStructure",
      "knowledgeCore.getItem",
      "knowledgeCore.getEvidence",
      "knowledgeCore.getAssetContent",
      "knowledgeSourceService.listSources",
      "knowledgeSourceService.createSource",
      "knowledgeSourceService.updateSource",
      "knowledgeSourceService.deleteSource",
      "knowledgeSourceService.refreshSource",
      "knowledgeSourceService.refreshAll",
      "searchSourceFiles(",
      "getSourceFileEvidence(",
      "isSourceEvidenceId(",
      "goldenRuleRuntime.listRulePackages",
      "goldenRuleRuntime.getRulePackage",
      "goldenRuleRuntime.saveRulePackage",
      "goldenRuleRuntime.publishRulePackage",
      "goldenRuleRuntime.rollbackRulePackage",
      "goldenRuleRuntime.listGoldCases",
      "goldenRuleRuntime.saveGoldCase",
      "goldenRuleRuntime.saveGoldCaseFromSkillResolution",
      "goldenRuleRuntime.exportTrainingSet",
      "knowledgeRuleAuthoringRuntime.chat",
      "knowledgeRuleAuthoringRuntime.getRun",
      "knowledgeSkillRuntime.",
      "external.knowledge.distillation",
      "externalKnowledgeDistillationClient",
      "agentExplorationRuntime.",
      "evidenceSufficiencyGate.",
      "knowledgeAgentSkill.",
      "agentEvaluationRuntime.",
      "modelDecisionRuntime.",
      "knowledgeEvolutionRuntime.",
      "summarizationRuntime.",
      "getExpertVocabularySummary(userDataPath)",
      "getKnowledgeGuidanceSummary(userDataPath)",
      "loadEmailRules(userDataPath)",
      "saveEmailRules(userDataPath",
      "loadExpertVocabulary(userDataPath",
      "saveExpertVocabulary(userDataPath",
      "loadKnowledgeTaxonomy(userDataPath",
      "saveKnowledgeTaxonomy(userDataPath",
      "documentParsingRuntime.",
      "metadataStore.search({",
      "metadataStore.getKnowledgeGraph",
      "metadataStore.getSignificantSourceTerms",
      "metadataStore.rebuildSourceVocabulary",
      "metadataStore.getKnowledgeWordCloudState",
      "metadataStore.saveKnowledgeWordCloudSet",
      "metadataStore.getKnowledgeWordBagTerms",
      "metadataStore.exportKnowledgeWordCloudSet",
      "metadataStore.importKnowledgeWordCloudSet",
      "metadataStore.addKnowledgeWordBag",
      "metadataStore.updateKnowledgeWordBag",
      "metadataStore.deleteKnowledgeWordBag",
      "metadataStore.listSourceCorpusRawTerms",
      "metadataStore.getStorageSummary(",
      "runStorageDoctor(",
      "reconcileStorage(",
      "listStorageBackups(",
      "createStorageBackup(",
      "restoreStorageBackup(",
      "clientRuntimeAllocator.",
      "clientRuntimeBootstrap.",
      "runtime.runtimeOptions.mountModules",
      "runtime.runtimeOptions.mountRouting",
      "runtime.mounts ||",
      "runtime.applyMountConfig",
      "loadMountConfig(userDataPath)",
      "saveMountConfig(userDataPath",
      "mergeMountRouting(",
      "metadataStore.recordClientCheckIn",
      "metadataStore.listClientRegistrations",
      "buildClientConnectionList(",
      "saveDiscoveryConfig(userDataPath",
      "setDiscoveryState(",
      "monitorAlertApi.getState",
      "monitorAlertApi.saveConfig",
      "monitorAlertApi.acknowledge",
      "getBackgroundProcessStatus(",
      "consoleAuth.getSummary",
      "consoleAuth.login",
      "consoleAuth.logout",
      "consoleAuth.audit",
      "consoleAuth.roleList",
      "consoleAuth.listUsers",
      "consoleAuth.updateUser",
      "consoleAuth.getOidcConfig",
      "consoleAuth.setOidcConfig",
      "consoleAuth.listAudit",
      "consoleAuth.listSessions",
      "consoleAuth.revokeSession",
      "operationAuditStore.list({",
      "authorizationEngine.resolveSubject",
      "authorizationEngine.evaluate",
      "authorizationStore.listReceipts",
      "authorizationStore.listLoanRecords",
      "authorizationStore.listDeniedRequests",
      "workspaceAssetPolicies.set",
      "getCodexOAuthStatus(",
      "startCodexDeviceLogin(",
      "buildProductionHealthReport(",
      "createExecutiveReportStore(",
      "buildExecutiveReport(",
      "buildArchitectureLiveMap(",
      "createSampleBusinessPackStore(",
      "../../common/module-manager/module-ecosystem/index.mjs",
      "loadAgentSyncPolicy",
      "protocolEventBus.subscribe({",
      "requireToolManagementScope",
      "publishAgentSyncEvent({",
      "loadAgentSyncConfig(userDataPath)",
      "saveAgentSyncConfig(userDataPath",
      "platform.store.createGrant",
      "platform.store.revokeGrant",
      "platform.store.createMcpAuthorizationRequest",
      "platform.store.listMcpAuthorizationRequests",
      "platform.store.resolveMcpAuthorizationRequest",
      "platform.router.handleToolManagementHttpRequest",
      "handleToolManagementHttpRequest({",
      "maintenanceAgent.getConfig",
      "maintenanceAgent.setConfig",
      "maintenanceAgent.chat",
      "maintenanceAgent.listRuns",
      "maintenanceAgent.startRun",
      "maintenanceAgent.getRun",
      "maintenanceAgent.approveRun",
      "maintenanceAgent.cancelRun",
      "checkpointTreeApi.listCheckpointTrees",
      "checkpointTreeApi.checkpointTreeSummary",
      "checkpointTreeApi.loadCheckpointTree",
      "checkpointTreeApi.diffCheckpointTree",
      "checkpointTreeApi.previewCheckpointRestore",
      "checkpointTreeApi.queryCheckpointScope",
      "checkpointTreeApi.restoreCheckpointTree",
      "jobManager.listJobs({",
      "buildRuntimeInfo({",
      "buildConsoleState({",
      "buildBootstrapPayload(getDiscoveryState())",
      "loadAgentRuntimeSettings(",
      "runtime.refreshMounts({",
      "agentConfigRegistry.replaceFromModelLibraryAgents",
      "agentConfigRegistry.getModelLibraryAgents",
      "agentConfigRegistry.getModelLibraryEntries",
      "probeModelConnection({",
      "publicAgentGatewayConfig",
      "publicAgentGatewayRegistry",
      "callAgentGateway({",
      "inspectAgentModelRouting({",
      "saveAgentModelLibrary(",
      "mergeSettingsForModelProbe(",
      "normalizeAgentModelPayload(",
      "preprocessWordCloudVocabulary({",
      "requireDomainService",
      "createAuthorizationEngine",
      "createAuthorizationStore",
      "logRuntimeEvent(",
      "function knowledgeDomainContext",
      "function knowledgeWorkflowContext",
      "function settingsAgentGatewayContext",
      "function authorizationFacadeContext",
      "function appendConsoleOperationLog",
      "function isFeatureActive",
      "async handle",
      "async handleBootstrap",
      "async handleAuthSession",
      "async handleAuthLogin",
      "async handleAuthLogout",
      "async handleAuthUsers",
      "async handleAuthUpdateUser",
      "async handleAuthOidc",
      "async handleAuthAudit",
      "async handleAuthSessions",
      "async handleAuthRevokeSession",
      "async handleCapabilityPackagePlan",
      "async handleCapabilityPackages",
      "async handleCapabilityPackageLifecycle",
      "async handleGetCodexOAuthStatus",
      "async handleStartCodexOAuthLogin",
      "async handleCodexOAuthReturn",
      "async handleAuthorizationSubjectResolve",
      "async handleCreateMcpAuthorizationRequest",
      "async handleListMcpAuthorizationRequests",
      "async handleResolveMcpAuthorizationRequest",
      "async handleToolManagementPassthrough",
      "async handleWorkspaceProtocolInfo",
      "async handleWorkspaceContributionSubmit",
      "async handleKnowledgeAccessEvaluate",
      "async handleWorkspaceSkillUpload",
      "async handleGetSettings",
      "async handleSetSettings",
      "async handleProbeModel",
      "async handleAgentGatewayConfig",
      "async handleAgentGatewayCall",
      "async handleAgentRegistry",
      "async handleModelRoutingHealth",
      "async handleCreateAgent",
      "async handleUpdateAgent",
      "async handleDeleteAgent",
      "async handleListInterfaces",
      "async handleSubscribeEvents",
      "async handleAgentSyncConfig",
      "async handleAgentSyncPublish",
      "async handleAgentSyncSubscribe",
      "async handleDiscoveryCheckIn",
      "async handleListDiscoveryClients",
      "async handleRequestClientMigration",
      "async handleGetDiscoveryConfig",
      "async handleSetDiscoveryConfig",
      "async handleGetRuntimeInfo",
      "async handleBrowseServerPath",
      "async handleGetMounts",
      "async handleSetMounts",
      "async handleReloadMounts",
      "async handleGetConsoleState",
      "async handleMaintenanceAgentConfig",
      "async handleMaintenanceAgentChat",
      "async handleMaintenanceAgentRuns",
      "async handleMaintenanceAgentRun",
      "async handleMaintenanceAgentApprove",
      "async handleMaintenanceAgentCancel",
      "async handleWorkspaceAuditQuery",
      "async handleWorkspaceOperationHistory",
      "async handleWorkspaceCheckpointTreeList",
      "async handleWorkspaceCheckpointNodeGet",
      "async handleWorkspaceCheckpointDiff",
      "async handleWorkspaceCheckpointRestorePreview",
      "async handleWorkspaceCheckpointRestore",
      "async handleWorkspaceCheckpointScopeQuery",
      "async handleWorkspaceOperationRevertScope",
      "async handleWorkspaceCodeTargetEvaluate",
      "async handleWorkspaceCodeChangePrepare",
      "async handleWorkspaceCodeChangeUpload",
      "async handleWorkspaceCodeChangeLink",
      "async handleWorkspaceCodeChangeStatusSync",
      "async handleRawCorpusFormatConvert",
      "async handleKnowledgeDossierExport",
      "async handleGetRules",
      "async handleSetRules",
      "async handleGetExpertVocabulary",
      "async handleSetExpertVocabulary",
      "async handleListExpertVocabularyVersions",
      "async handleGetKnowledgeTaxonomy",
      "async handleSetKnowledgeTaxonomy",
      "async handleListKnowledgeTaxonomyVersions",
      "async handleGetStorageSummary",
      "async handleRebuildSourceVocabulary",
      "async handleGetSignificantSourceTerms",
      "async handleKnowledgeDocumentParse",
      "async handleKnowledgeWordClouds",
      "async handleGetKnowledgeWordBagTerms",
      "async handleSaveKnowledgeWordClouds",
      "async handleExportKnowledgeWordClouds",
      "async handleImportKnowledgeWordClouds",
      "async handleAddKnowledgeWordBag",
      "async handleUpdateKnowledgeWordBag",
      "async handleDeleteKnowledgeWordBag",
      "async handleProposeKnowledgeWordClouds",
      "async handleStorageDoctor",
      "async handleStorageReconcile",
      "async handleStorageBackups",
      "async handleStorageBackupCreate",
      "async handleStorageBackupRestorePreview",
      "async handleStorageBackupRestore",
      "async handleEnhanceAffairTaxonomy",
      "async handleFailedJobsReview",
      "async handleGetBackgroundProcesses",
      "async handleListCheckpointTrees",
      "async handleGetCheckpointTree",
      "async handleMonitorAlerts",
      "async handleAcknowledgeMonitorAlert",
      "async handleProductionHealth",
      "async handleExecutiveReport",
      "async handleExecutiveReportGenerate",
      "async handleExecutiveReportPreview",
      "async handleArchitectureLiveMap",
      "async handleSampleBusinessPacks",
      "async handleSampleBusinessPack",
      "async handleSampleBusinessPackMaterialize",
      "async handleModuleTemplates",
      "async handleModuleScaffoldPlan",
      "async handleModuleScaffold",
      "async handleModuleContractTest",
      "async handleWorkspaceGovernance",
      "async handleWorkspaceGovernancePolicy",
      "async handleWorkspaceGovernanceEvaluate",
      "async handleWorkspaceGovernanceShareGrant",
      "async handleGerritRead",
      "async handleGerritWrite",
      "async handleGerritMaintain",
      "async handleGerritGitUpload",
      "async handleRepoOperation",
      "async handleAssetLineage",
      "async handleAssetLineageRecord",
      "async handleAssetLineageTrace",
      "async handleAssetLineageReparsePlan",
      "async handleDataConnectorGovernance",
      "async handleDataConnectorGovernancePlan",
      "async handleDataConnectorGovernanceConformance",
      "async handlePerformanceCapacityTargets",
      "async handlePerformanceCapacityBenchmark",
      "async handleKnowledgeConsole",
      "async handleKnowledgeSources",
      "async handleCreateKnowledgeSource",
      "async handleUpdateKnowledgeSource",
      "async handleDeleteKnowledgeSource",
      "async handleRefreshKnowledgeSource",
      "async handleRefreshAllKnowledgeSources",
      "async handleKnowledgeConfigSchema",
      "async handleKnowledgeCapabilities",
      "async handleKnowledgeDocxExport",
      "async handleKnowledgeMarkdownExport",
      "async handleKnowledgeHtmlExport",
      "async handleKnowledgeHealth",
      "async handleKnowledgeMaintenanceGet",
      "async handleKnowledgeMaintenanceSet",
      "async handleKnowledgeReindex",
      "async handleKnowledgeMaintenanceRun",
      "async handleKnowledgeSync",
      "async handleKnowledgeChanges",
      "async handleKnowledgeReviewItems",
      "async handleResolveKnowledgeReviewItem",
      "async handleKnowledgeFeedback",
      "async handleKnowledgeSuggestions",
      "async handleGoldenRules",
      "async handleSaveGoldenRules",
      "async handlePublishGoldenRules",
      "async handleRollbackGoldenRules",
      "async handleKnowledgeRuleAuthoringChat",
      "async handleKnowledgeRuleAuthoringRunGet",
      "async handleGoldCases",
      "async handleSaveGoldCase",
      "async handleResolveKnowledgeSuggestion",
      "async handleKnowledgeLearningJob",
      "async handleKnowledgeLearningHealth",
      "async handleEvidenceGateEvaluate",
      "async handleKnowledgeAgentSkill",
      "async handleKnowledgeSkills",
      "async handleKnowledgeSkill",
      "async handleSaveKnowledgeSkillFramework",
      "async handleAgentEvaluation",
      "async handleModelDecision",
      "async handleKnowledgeEvolution",
      "async handleKnowledgeHierarchyAudit",
      "async handleKnowledgeSummarization",
      "async handleGetKnowledgeSummarization",
      "async handleApproveKnowledgeSummarization",
      "async handleKnowledgeAgentExplore",
      "async handleGetKnowledgeAgentExplore",
      "async handleKnowledgeSearch",
      "async handleKnowledgeDocumentStructure",
      "async handleGetKnowledgeItem",
      "async handleGetKnowledgeEvidence",
      "async handleGetKnowledgeAsset",
      "async handleRenderKnowledgeMarkdown",
      "async handleKnowledgeGraph",
      "async handleSearch",
      "async handleHealthz",
      "async handleContextProfiles",
      "async handleClientRuntimeProfiles",
      "async handleClientRuntimeResolve",
      "async handleClientRuntimeBootstrapPlan",
      "async handleClientRuntimeBootstrapPull",
      "async handleClientRuntimeStatus",
      "async handleContextPreview",
      "async handleContextCompactionPreview",
      "async handleContextCompactionRun",
      "async handleContextCompactionRecords",
      "async handleContextSessionMemory",
      "async handleContextSessionMemoryClear",
      "async handleContextBuildRecords",
      "async handleContextEvaluationRuns",
      "async handleAgentWorkspaces",
      "async handleAgentWorkspace",
      "async handleAgentSessions",
      "async handleAgentSession",
      "async handleGetAgentSessionContext",
      "async handleAppendAgentSessionEvent",
      "async handleForkAgentSession",
      "async handleCompareAgentSessions",
      "async handleAgentSessionMergeProposal",
      "async handleArchiveAgentSession",
      "async handleResolveAgentWorkspaceSubmission",
      "async handleResolveAgentWorkspaceIssue",
      "async handleCreateAgentWorkspace",
      "async handleDeleteAgentWorkspace",
      "async handleAgentWorkspaceLocks",
      "async handleAgentWorkspaceLock",
      "async handleGetWorkspaceContext",
      "async handleExportWorkspaceContextBundle",
      "async handleRestoreWorkspaceContextBundle",
      "async handleGetWorkspaceChain",
      "async handleSetWorkspaceParent",
      "async handleHotSwapWorkspaceProfile",
      "async handleSetWorkspaceOwnedSources",
      "async handleShareWorkspace",
      "async handleUnshareWorkspace",
      "async handleCreateWorkspaceFolder",
      "async handleListWorkspaceFiles",
      "async handleGetWorkspaceFile",
      "async handleDownloadWorkspaceFile",
      "async handleUploadWorkspaceFile",
      "async handleWriteWorkspaceFile",
      "async handleDeleteWorkspaceFile",
      "async handleMoveWorkspaceFile",
      "createPathBrowserRoots",
      "resolvePathBrowserDirectory",
      "statPathBrowserEntry",
      "browseServerPath({",
      "fs.readdir(",
      "fs.stat(",
      "fsSync.readdirSync(",
      "getInterfaceCatalog()",
      "protocolSuccess(",
      "protocolNotImplemented(",
      "controller.handle",
      "applyWorkspaceRuntimeContext(",
      "workspaceAccessOptions(",
      "parseKnowledgeSearchInput",
      "enforceMultimodalKnowledgeSearch",
      "parseWordCloudRequestPayload",
      "parseTopicQuery",
      "parseEntityTypes(",
      "parseBooleanFlag(",
      "modalityPolicy: \"multimodal\"",
      "publishProtocolEvent(",
      "agentWorkspace.getSessionContext",
      "agentWorkspace.getWorkspaceContext",
      "code_route_",
      "code_change_",
      "code_prepare_",
      "code_link_",
      "code_status_",
      "retrieval.bm25Weight",
      "maintenanceTasks: ["
    ],
    controllerFile
  );
  for (const needle of [
    "createSystemControllerContexts",
    "requireDomainService",
    "requireDomainProvider",
    "securityPermissions",
    "agentRuntimeProvider",
    "appendConsoleOperationLog",
    "knowledgeWorkflowContext",
    "settingsAgentGatewayContext",
    "authorizationFacadeContext",
    "accessControlContext"
  ]) {
    assertTextIncludes(contextFactory, needle, `${contextFile} must own console context assembly ${needle}`);
  }
  assertTextExcludes(
    contextFactory,
    [
      "const loadAgentGatewayModule",
      "const loadModelProbeModule",
      "const getAgentConfigRegistry",
      "const agentConfigRegistry",
      "loadAgentGatewayModule,",
      "loadModelProbeModule,",
      "getAgentConfigRegistry,"
    ],
    contextFile
  );
  for (const needle of [
    "createSystemControllerAgentSettingsHandlers",
    "settings.get",
    "settings.set",
    "settings.model_probe",
    "agent_gateway.config.get",
    "agent_gateway.config.set",
    "agent_gateway.call",
    "agents.list",
    "agents.create",
    "agents.update",
    "agents.delete",
    "model_routing.health"
  ]) {
    assertTextIncludes(agentSettingsHandlers, needle, `${agentSettingsHandlersFile} must own settings and Agent Gateway handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerAuthHandlers",
    "auth.session",
    "auth.login",
    "auth.logout",
    "auth.users.create",
    "auth.users.update",
    "auth.oidc.set",
    "auth.audit",
    "auth.sessions.revoke"
  ]) {
    assertTextIncludes(authHandlers, needle, `${authHandlersFile} must own console auth handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerCapabilityEcosystemHandlers",
    "capability_packages.plan",
    "capability_packages.list",
    "capability_packages.submit",
    "capability_packages.lifecycle",
    "oauth.codex_status",
    "oauth.codex_login",
    "oauth.codex_return",
    "production.health",
    "executive_report.list",
    "executive_report.generate",
    "executive_report.preview",
    "architecture.live_map",
    "sample_business_pack.list",
    "sample_business_pack.get",
    "sample_business_pack.materialize",
    "module_ecosystem.templates",
    "module_ecosystem.plan",
    "module_ecosystem.scaffold",
    "module_ecosystem.contract_test",
    "strategy.describe",
    "strategy.workflow_policy.evaluate",
    "strategy.agent_policy.evaluate",
    "strategy.tool_policy.preview",
    "async handleStrategyManagement",
    "workspace_governance.describe",
    "workspace_governance.policy.set",
    "workspace_governance.evaluate",
    "workspace_governance.share_grant",
    "gerrit.read",
    "gerrit.write",
    "gerrit.maintain",
    "gerrit.git_upload",
    "async handleRepoOperation",
    "asset_lineage.describe",
    "asset_lineage.record",
    "asset_lineage.trace",
    "asset_lineage.reparse_plan",
    "data_connectors.governance.describe",
    "data_connectors.governance.plan",
    "data_connectors.governance.conformance",
    "performance.capacity.targets",
    "performance.capacity.benchmark"
  ]) {
    assertTextIncludes(capabilityEcosystemHandlers, needle, `${capabilityEcosystemHandlersFile} must own capability ecosystem handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerFoundationHandlers",
    "authorization.subject.resolve",
    "authorization.policy.evaluate",
    "authorization.grants.create",
    "tool_management.mcp.request_authorization",
    "tool_management.mcp.list_requests",
    "tool_management.mcp.resolve_request",
    "tool_management.http.passthrough",
    "workspace.info",
    "workspace.file.upload",
    "workspace.contribution.submit",
    "knowledge.access.evaluate",
    "knowledge.evidence",
    "workspace.skill.upload",
      "workspace.asset.permission.check"
  ]) {
    assertTextIncludes(foundationHandlers, needle, `${foundationHandlersFile} must own foundation protocol handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerKnowledgeOperationsHandlers",
    "email_rules.get",
    "email_rules.set",
    "expert_vocabulary.get",
    "expert_vocabulary.set",
    "expert_vocabulary.versions",
    "knowledge_taxonomy.get",
    "knowledge_taxonomy.set",
    "knowledge_taxonomy.versions",
    "storage.summary",
    "storage.source_vocabulary.rebuild",
    "knowledge.corpus.significant_terms",
    "knowledge.document_parse",
    "knowledge.word_clouds.get",
    "knowledge.word_bags.terms",
    "knowledge.word_clouds.save",
    "knowledge.word_clouds.export",
    "knowledge.word_clouds.import",
    "knowledge.word_bags.add",
    "knowledge.word_bags.update",
    "knowledge.word_bags.delete",
    "storage.doctor",
    "storage.reconcile",
    "storage.backups.list",
    "storage.backups.create",
    "storage.backups.restore_preview",
    "storage.backups.restore",
    "knowledge.affair_taxonomy"
  ]) {
    assertTextIncludes(knowledgeOperationsHandlers, needle, `${knowledgeOperationsHandlersFile} must own knowledge operation handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerKnowledgeRuntimeHandlers",
    "knowledge.console",
    "knowledge.sources.list",
    "knowledge.sources.create",
    "knowledge.sources.update",
    "knowledge.sources.delete",
    "knowledge.sources.refresh",
    "knowledge.sources.refresh_all",
    "knowledge.config_schema",
    "knowledge.capabilities",
    "knowledge.export_docx",
    "knowledge.export_markdown",
    "knowledge.export_html",
    "knowledge.health",
    "knowledge.maintenance.get",
    "knowledge.maintenance.set",
    "knowledge.reindex",
    "knowledge.maintenance.run",
    "knowledge.sync",
    "knowledge.changes",
    "knowledge.review_items",
    "knowledge.review_resolve",
    "knowledge.feedback",
    "knowledge.suggestions",
    "knowledge.golden_rules.list",
    "knowledge.golden_rules.save",
    "knowledge.golden_rules.publish",
    "knowledge.golden_rules.rollback",
    "knowledge.rule_authoring.chat",
    "knowledge.rule_authoring.runs.get",
    "knowledge.gold_cases.list",
    "knowledge.gold_cases.save",
    "knowledge.suggestion_resolve",
    "knowledge.learning.jobs",
    "knowledge.learning.health",
    "knowledge.evidence_gate.evaluate",
    "knowledge.agent_skill.run",
    "knowledge.skills.list",
    "knowledge.skills.resolve",
    "knowledge.skills.evaluation.runs.create",
    "knowledge.training_sets.export",
    "knowledge.evaluation.runs.create",
    "knowledge.model_decision",
    "knowledge.evolution.runs.create",
    "knowledge.evolution.deployments.promote",
    "knowledge.summarization.runs.create",
    "knowledge.agent_explore.runs.create",
    "knowledge.search",
    "knowledge.document_structure",
    "knowledge.item",
    "knowledge.evidence",
    "knowledge.asset",
    "knowledge.render_markdown",
    "knowledge.graph",
    "search.query"
  ]) {
    assertTextIncludes(knowledgeRuntimeHandlers, needle, `${knowledgeRuntimeHandlersFile} must own knowledge runtime handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerOpsObservationHandlers",
    "jobs.failed_review",
    "system.background_processes",
    "system.checkpoint_trees.list",
    "system.checkpoint_trees.get",
    "system.monitor_alerts.get",
    "system.monitor_alerts.set",
    "system.monitor_alerts.ack"
  ]) {
    assertTextIncludes(opsObservationHandlers, needle, `${opsObservationHandlersFile} must own ops/system observation handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerRuntimeHandlers",
    "system.bootstrap",
    "system.health",
    "system.interfaces",
    "events.subscribe",
    "agent_sync.config.get",
    "agent_sync.config.set",
    "agent_sync.publish",
    "agent_sync.subscribe",
    "discovery.check_in",
    "discovery.clients",
    "discovery.clients.migration",
    "discovery.get_config",
    "discovery.set_config",
    "runtime.info",
    "runtime.path_browse",
    "runtime.mounts",
    "runtime.set_mounts",
    "runtime.reload_mounts",
    "system.console_state",
    "maintenance_agent.config.get",
    "maintenance_agent.chat",
    "maintenance_agent.runs.create",
    "maintenance_agent.runs.approve",
    "maintenance_agent.runs.cancel"
  ]) {
    assertTextIncludes(runtimeHandlers, needle, `${runtimeHandlersFile} must own runtime/system protocol handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerWorkspaceProtocolHandlers",
    "workspace.audit.query",
    "workspace.operation.history",
    "workspace.checkpoint.tree.list",
    "workspace.checkpoint.node.get",
    "workspace.checkpoint.diff",
    "workspace.checkpoint.restore.preview",
    "workspace.checkpoint.restore",
    "workspace.checkpoint.scope.query",
    "workspace.operation.revert.scope",
    "workspace.proposal.create",
    "workspace.proposal.apply",
    "workspace.code.target.evaluate",
    "workspace.code.change.prepare",
    "workspace.code.change.upload",
    "workspace.code.change.link",
    "workspace.code.change.status.sync",
    "knowledgeTransformationContext",
    "knowledgeWorkflowContext",
    "accessControlContext",
    "raw-corpus.format.convert",
    "knowledge.dossier.export"
  ]) {
    assertTextIncludes(workspaceProtocolHandlers, needle, `${workspaceProtocolHandlersFile} must own workspace protocol façade handler ${needle}`);
  }
  for (const needle of [
    "createSystemControllerWorkspaceRuntimeHandlers",
    "context.profiles.get",
    "context.profiles.set",
    "client_runtime.profiles.get",
    "client_runtime.profiles.set",
    "client_runtime.resolve",
    "client_runtime.bootstrap.plan",
    "client_runtime.bootstrap.pull",
    "client_runtime.status",
    "context.preview",
    "context.compaction.preview",
    "context.compaction.run",
    "context.compaction.records",
    "context.session_memory.get",
    "context.session_memory.clear",
    "context.build_records",
    "context.evaluation.runs.create",
    "agent_workspaces.list",
    "agent_workspaces.get",
    "agent_sessions.list",
    "agent_sessions.get",
    "agent_sessions.context.get",
    "agent_sessions.events.append",
    "agent_sessions.fork",
    "agent_sessions.compare",
    "agent_sessions.merge_proposal",
    "agent_sessions.archive",
    "agent_workspaces.submissions.resolve",
    "agent_workspaces.issues.resolve",
    "agent_workspaces.create",
    "agent_workspaces.delete",
    "agent_workspaces.locks.list",
    "agent_workspaces.locks.write",
    "agent_workspaces.context.get",
    "agent_workspaces.context_bundle.export",
    "agent_workspaces.context_bundle.restore",
    "agent_workspaces.chain.get",
    "agent_workspaces.parent.set",
    "agent_workspaces.profile.hotswap",
    "agent_workspaces.sources.set",
    "agent_workspaces.share",
    "agent_workspaces.unshare",
    "agent_workspaces.folder.create",
    "agent_workspaces.files.list",
    "agent_workspaces.file.stat",
    "agent_workspaces.file.download",
    "agent_workspaces.file.upload",
    "agent_workspaces.file.write",
    "agent_workspaces.file.delete",
    "agent_workspaces.file.move"
  ]) {
    assertTextIncludes(workspaceRuntimeHandlers, needle, `${workspaceRuntimeHandlersFile} must own workspace runtime handler ${needle}`);
  }
  for (const needle of [
    "createWorkspaceGovernanceRegistry",
    "createCapabilityPackageRegistry",
    "createAssetLineageRegistry",
    "executeGerritCommonOperation",
    "uploadGerritGitChange",
    "executeRepoOperation",
    "createDataConnectorGovernance",
    "runPerformanceCapacityBenchmark",
    "createContributionRegistry",
    "createCodespaceRegistry",
    "evaluateKnowledgeAccess",
    "executeWorkspaceContributionOperation",
    "executeKnowledgeAccessOperation",
    "executeContextRuntimeOperation",
    "context.profiles.get",
    "context.preview",
    "previewCompaction",
    "runCompaction",
    "listSessionMemory",
    "runEvaluation",
    "executeAgentWorkspaceFileOperation",
    "agent_workspaces.file.upload",
    "uploadWorkspaceFile",
    "downloadWorkspaceFile",
    "executeAgentWorkspaceManagementOperation",
    "workspace.info",
    "agent_workspaces.create",
    "agent_sessions.fork",
    "agent_workspaces.parent.set",
    "listWorkspaces",
    "setWorkspaceParent",
    "resolveWorkspaceChain",
    "executeKnowledgeRetrievalOperation",
    "knowledge.search",
    "knowledge.evidence",
    "normalizeKnowledgeSearchInput",
    "modalityPolicy: \"multimodal\"",
    "searchSourceFiles",
    "getSourceFileEvidence",
    "getAssetContent",
    "executeKnowledgeManagementOperation",
    "knowledge.config_schema",
    "knowledge.export_docx",
    "knowledge.maintenance.run",
    "knowledge.learning.jobs",
    "recordFeedback",
    "executeGoldenRuleOperation",
    "knowledge.golden_rules.publish",
    "executeKnowledgeSkillOperation",
    "knowledge.skills.resolve",
    "saveGoldCaseFromSkillResolution",
    "executeAgentExplorationOperation",
    "knowledge.agent_explore.runs.create",
    "executeKnowledgeGraphOperation",
    "knowledge.graph",
    "metadataStore.getKnowledgeGraph",
    "executeKnowledgeAgentSupportOperation",
    "knowledge.evidence_gate.evaluate",
    "knowledge.agent_skill.run",
    "executeKnowledgeEvaluationOperation",
    "knowledge.evaluation.runs.create",
    "knowledge.model_decision",
    "executeKnowledgeEvolutionOperation",
    "knowledge.evolution.runs.create",
    "knowledge.hierarchy.audit",
    "executeKnowledgeSummarizationOperation",
    "knowledge.summarization.runs.create",
    "executeKnowledgePreprocessingRulesOperation",
    "email_rules.set",
    "expert_vocabulary.summary",
    "knowledge.guidance.summary",
    "knowledge_taxonomy.set",
    "executeKnowledgeDocumentParsingOperation",
    "knowledge.document_parse",
    "executeKnowledgeCorpusOperation",
    "storage.source_vocabulary.rebuild",
    "knowledge.corpus.significant_terms",
    "knowledge.affair_taxonomy",
    "search.query",
    "normalizeSearchQueryInput",
    "executeKnowledgeSourceOperation",
    "knowledge.console",
    "knowledge.sources.list",
    "knowledge.sources.create",
    "knowledge.sources.update",
    "knowledge.sources.delete",
    "knowledge.sources.refresh",
    "knowledge.sources.refresh_all",
    "executeKnowledgeWordCloudOperation",
    "executeStorageOperation",
    "storage.summary",
    "storage.doctor",
    "storage.reconcile",
    "storage.backups.restore",
    "executeClientRuntimeOperation",
    "client_runtime.profiles.get",
    "client_runtime.bootstrap.pull",
    "client_runtime.status",
    "executeRuntimeMountOperation",
    "runtime.mounts",
    "runtime.set_mounts",
    "runtime.reload_mounts",
    "moduleManagement.setMounts",
    "executeDiscoveryOperation",
    "discovery.check_in",
    "discovery.clients",
    "discovery.clients.migration",
    "discovery.set_config",
    "recordClientCheckIn",
    "buildClientConnectionList",
    "saveDiscoveryConfig",
    "executeMonitorAlertOperation",
    "system.monitor_alerts.get",
    "system.monitor_alerts.ack",
      "executeSystemObservationOperation",
      "system.background_processes",
      "system.checkpoint_trees.list",
      "system.checkpoint_trees.get",
      "workspace.checkpoint.tree.list",
      "workspace.checkpoint.node.get",
      "executeJobObservationOperation",
      "jobs.failed_review",
      "executeSystemCoreOperation",
      "system.bootstrap",
      "system.health",
      "executeConsoleStateOperation",
      "runtime.info",
      "system.console_state",
      "buildRuntimeInfo",
      "buildConsoleState",
      "executeSystemInterfaceOperation",
      "system.interfaces",
      "executeRuntimePathBrowseOperation",
      "runtime.path_browse",
      "browseServerPath",
      "executeProductionReadinessOperation",
      "production.health",
      "architecture.live_map",
      "executive_report.list",
      "executive_report.preview",
      "executive_report.generate",
      "sample_business_pack.list",
      "sample_business_pack.get",
      "sample_business_pack.materialize",
      "executeModuleEcosystemOperation",
      "module_ecosystem.templates",
      "module_ecosystem.plan",
      "module_ecosystem.scaffold",
      "module_ecosystem.contract_test",
      "executeCodexOAuthOperation",
      "oauth.codex_status",
      "oauth.codex_login",
      "oauth.codex_return",
      "executeSettingsAgentGatewayOperation",
      "settings.get",
      "settings.set",
      "settings.model_probe",
      "agent_gateway.config.get",
      "agent_gateway.config.set",
      "agent_gateway.call",
      "model_routing.health",
      "agents.create",
      "agents.update",
      "agents.delete",
      "moduleManagement.refreshMounts",
      "probeModelConnection",
      "publicAgentGatewayRegistry",
      "executeWorkspaceAuditOperation",
      "workspace.audit.query",
      "workspace.operation.history",
      "operationAuditStore.list",
      "executeAuthorizationFacadeOperation",
      "authorization.subject.resolve",
      "authorization.policy.evaluate",
      "authorization.receipts.list",
      "authorization.loan_records.list",
      "authorization.denied_requests.list",
      "workspace.asset.policy.set",
      "workspace.asset.permission.check",
      "securityPermissions",
      "executeAgentSyncOperation",
      "events.subscribe",
      "agent_sync.config.get",
      "agent_sync.config.set",
      "agent_sync.publish",
      "agent_sync.subscribe",
      "normalizeAgentSubscriptionInput",
      "loadAgentSyncPolicy",
      "filterRequestedSubscriptionTopics",
      "publishAgentSyncEvent",
      "executeToolManagementAuthorizationOperation",
    "authorization.grants.create",
      "authorization.grants.revoke",
      "tool_management.mcp.request_authorization",
      "tool_management.mcp.resolve_request",
      "createMcpAuthorizationRequest",
      "resolveMcpAuthorizationRequest",
      "executeToolManagementPassthroughOperation",
      "tool_management.http.passthrough",
      "handleToolManagementHttpRequest",
      "__responseHandled",
      "executeStrategyManagementOperation",
      "strategy.describe",
      "strategy.workflow_policy.evaluate",
      "strategy.agent_policy.evaluate",
      "strategy.tool_policy.preview",
      "strategyManagementProvider.createModelDecisionRuntimePort",
      "executeCodeManagementOperation",
      "createKnowledgeTransformationProvider",
      "executeKnowledgeTransformationOperation",
      "appendKnowledgeAccessDecisionArtifacts",
      "executeProtocolFacadeOperation",
      "workspace.file.patch",
      "workspace.checkpoint.diff",
      "workspace.checkpoint.restore.preview",
      "workspace.checkpoint.restore",
      "workspace.checkpoint.scope.query",
      "workspace.operation.revert.scope",
      "workspace.proposal.create",
      "workspace.proposal.apply",
      "workspace.code.target.evaluate",
      "workspace.code.change.prepare",
      "workspace.code.change.link",
      "workspace.code.change.status.sync",
      "raw-corpus.format.convert",
      "knowledge.dossier.export",
      "executeConsoleAuthOperation",
    "auth.login",
    "auth.users.update",
    "auth.oidc.set",
    "auth.sessions.revoke",
    "executeMaintenanceAgentOperation",
    "maintenance_agent.config.get",
    "maintenance_agent.chat",
    "maintenance_agent.runs.approve",
    "executeConsoleDomainOperation"
  ]) {
    assertTextIncludes(executor, needle, `${executorFile} must own specialized console operation ${needle}`);
  }
  for (const needle of [
    "v0.0.1:risk-control:permissions-1",
    "createSecurityPermissionsProvider",
    "authorizeOperation",
    "getConsoleSummary",
    "evaluatePolicy",
    "appendDecision",
    "setWorkspaceAssetPolicy",
    "checkWorkspaceAssetPermission",
    "authorizationEngine",
    "authorizationStore"
  ]) {
    assertTextIncludes(
      securityPermissionsProvider,
      needle,
      `${securityPermissionsProviderFile} must declare the unified security permissions provider ${needle}`
    );
  }
  for (const needle of [
    "v0.0.1:strategy:strategy-management-1",
    "createStrategyManagementProvider",
    "evaluateWorkflowPolicy",
    "evaluateAgentPolicy",
    "createModelDecisionRuntimePort",
    "runModelRouting",
    "evaluateToolPolicy",
    "strategy_management"
  ]) {
    assertTextIncludes(
      strategyManagementProvider,
      needle,
      `${strategyManagementProviderFile} must own strategy management provider contract ${needle}`
    );
  }
  for (const needle of [
    "CodespaceManagement",
    "v0.0.1:platform:codespace-1",
    "workspace.code.change.prepare",
    "workspace.code.change.status.sync",
    "code-management/codespace-registry.json"
  ]) {
    assertTextIncludes(codespaceModule, needle, `${codespaceModuleFile} must declare the Codespace provider contract ${needle}`);
  }
  for (const needle of [
    "KnowledgeTransformation",
    "v0.0.1:knowledge:transformation-1",
    "createKnowledgeTransformationProvider",
    "raw-corpus.format.convert",
    "knowledge.dossier.export"
  ]) {
    assertTextIncludes(
      knowledgeTransformationModule,
      needle,
      `${knowledgeTransformationModuleFile} must declare the Knowledge Transformation provider contract ${needle}`
    );
  }
  for (const needle of [
    "executeKnowledgeWordCloudOperation",
    "normalizeWordCloudOperationInput",
    "normalizeWordCloudCorpusPaths",
    "knowledge.word_clouds.save",
    "knowledge.word_bags.update"
  ]) {
    assertTextIncludes(wordCloud, needle, `${wordCloudFile} must own word-cloud operation ${needle}`);
  }
  assertTextIncludes(
    provider,
    "executeConsoleDomainOperation",
    `${providerFile} must expose the specialized console operation executor to common console`
  );
  assertTextIncludes(
    provider,
    "uploadSessionStore",
    `${providerFile} must expose checkpoint upload session protocol functions to common console through a provider boundary`
  );
  assertTextIncludes(
    provider,
    "buildToolManagementClientConnectionRows",
    `${providerFile} must expose Tool Management client connection projection through a provider boundary`
  );
  assertTextIncludes(
    provider,
    "buildKnowledgeConsoleSummary",
    `${providerFile} must expose knowledge console summary projection through a provider boundary`
  );
  assertTextIncludes(
    provider,
    "buildRuntimeConsoleSummary",
    `${providerFile} must expose runtime console summary projection through a provider boundary`
  );
  for (const needle of [
    "buildKnowledgeConsoleSummary",
    "runtime?.mounts?.knowledgeBase",
    "knowledgeBase?.health",
    "knowledgeBase?.capabilities",
    "knowledgeBase?.getMaintenance",
    "redactModulePaths"
  ]) {
    assertTextIncludes(
      knowledgeConsoleSummary,
      needle,
      `${knowledgeConsoleSummaryFile} must own knowledge console summary projection ${needle}`
    );
  }
  for (const needle of [
    "buildRuntimeConsoleSummary",
    "moduleManagement.buildRuntimeConsoleSummary"
  ]) {
    assertTextIncludes(
      runtimeConsoleSummary,
      needle,
      `${runtimeConsoleSummaryFile} must delegate runtime console summary projection through module management ${needle}`
    );
  }
  assertTextExcludes(
    runtimeConsoleSummary,
    [
      "runtime.runtimeOptions",
      "runtime.mounts ||",
      "getMountConfigPath",
      "getMountConfigPaths",
      "loadMountConfig(userDataPath)"
    ],
    runtimeConsoleSummaryFile
  );
  for (const needle of [
    "v0.0.1:tool:module-management-1",
    "createModuleManagementProvider",
    "buildRuntimeConsoleSummary",
    "getMountsSnapshot",
    "setMounts",
    "reloadMounts",
    "refreshMounts",
    "listModuleTemplates",
    "planModuleScaffold",
    "scaffoldModule",
    "runModuleContractTest",
    "validateCapabilityPackageScaffoldManifest",
    "runtime.applyMountConfig"
  ]) {
    assertTextIncludes(
      moduleManagementProvider,
      needle,
      `${moduleManagementProviderFile} must own module management provider contract ${needle}`
    );
  }
  for (const needle of [
    "buildToolManagementClientConnectionRows",
    "listMcpClientConnections"
  ]) {
    assertTextIncludes(
      toolManagementConnections,
      needle,
      `${toolManagementConnectionsFile} must delegate Tool Management grant-to-client connection projection through provider ${needle}`
    );
  }
  for (const needle of [
    "TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION",
    "listMcpClientConnections",
    "listVisibleSkills",
    "authorizeRequest",
    "createLocalMcpGrant",
    "markLocalMcpGrantUninstalled",
    "resolveMcpWorkspaceInput",
    "publicMcpToolPayload",
    "sourceGrantId: grant.id"
  ]) {
    assertTextIncludes(
      toolSkillManagementProvider,
      needle,
      `${toolSkillManagementProviderFile} must own Tool/Skill provider projection ${needle}`
    );
  }
  assertTextExcludes(
    contextFactory,
    ["upload-session-store.mjs"],
    contextFile
  );
}

async function assertCoreArchitectureDocsCoverMainline() {
  const architectureFile = "docs/architecture/ARCHITECTURE.md";
  const workspaceFile = "docs/functionality/WORKSPACE-ASSETS.md";
  const protocolsFile = "docs/protocols/PROTOCOLS.md";
  const architecture = await read(architectureFile);
  const workspace = await read(workspaceFile);
  const protocols = await read(protocolsFile);

  for (const needle of [
    "Team Workspace Asset Governance System",
    "中间狭窄地带",
    "两个问题，一个能力，三个兼容",
    "知识库缺少面向智能体的权限管控",
    "本地智能体相对独立，难以协同",
    "工作空间管理",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "资产贡献统计报表",
    "上游知识库太粗",
    "下游本地智能体太细",
    "权限精加工",
    "共享工作空间",
    "AgentLibrary",
    "图书馆",
    "资产是主体",
    "不信任智能体",
    "权限从源头治理",
    "图书馆",
    "derivedKnowledgeSpace",
    "上游知识库的信息和资源权限再分配",
    "authorizationOverlay",
    "上游知识库 A/B 权限再授权演示",
    "对话页面",
    "权限错误",
    "公共工作空间",
    "终端贡献是第二信息源",
    "ContributionRegistry",
    "SkillLibrary",
    "LeaderboardRuntime",
    "Operation Ledger",
    "Checkpoint Tree",
    "统一 Checkpoint Tree",
    "所有访问请求",
    "所有文件变动",
    "所有知识贡献",
    "所有技能调用",
    "checkpointNodeId",
    "effectKind",
    "恢复到此节点",
    "git worktree",
    "Context Compiler",
    "OpenClaw",
    "OpenClaw 文档互通演示",
    "Skill 贡献排行榜演示",
    "Pact MCP service",
    "rankScoreV0",
    "usageCount * successRate",
    "A2A",
    "MCP",
    "不复制外部实现代码"
  ]) {
    assertTextIncludes(architecture, needle, `${architectureFile} must keep workspace-first architecture evidence for ${needle}`);
  }

  for (const needle of [
    "Workspace Asset Governance System",
    "中间狭窄地带",
    "两个问题，一个能力，三个兼容",
    "知识库缺少面向智能体的权限管控",
    "本地智能体相对独立，难以协同",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "上游知识库太粗",
    "下游本地智能体太细",
    "终端贡献型资产",
    "排行榜与统计面板",
    "资产贡献统计报表",
    "assetContributionReportV0",
    "贡献授权",
    "演示场景：OpenClaw 文档互通",
    "演示场景：Skill 贡献排行榜",
    "workspace.contribution.submit",
    "workspace.skill.list",
    "rankScoreV0",
    "usageCount * successRate",
    "goldenRule",
    "expertOpinion",
    "Operation Ledger",
    "统一 Checkpoint Tree",
    "所有的一切都必须进入同一棵树",
    "访问请求",
    "文件变动",
    "知识贡献",
    "技能调用",
    "checkpointNode",
    "effectKind",
    "Snapshot Boundary",
    "演示场景：Checkpoint Tree 安全恢复",
    "workspace.checkpoint.restore",
    "恢复到此节点",
    "git worktree",
    "Proposal To Decision",
    "资产门禁模型",
    "knowledgeAccessReceipt",
    "loanRecord",
    "上游知识库隔离",
    "上游知识库的信息和资源权限再分配",
    "upstreamKnowledgeRef",
    "authorizationOverlay",
    "演示场景：上游知识库 A/B 权限再授权",
    "管控台",
    "权限错误",
    "controlledView",
    "checkoutAllowed",
    "Context Compiler",
    "智能体不能直接覆盖 canonical state"
  ]) {
    assertTextIncludes(workspace, needle, `${workspaceFile} must keep asset governance evidence for ${needle}`);
  }

  for (const needle of [
    "v0.0.1:workspace:core-1",
    "v0.0.1:operation:core-1",
    "v0.0.1:knowledge:core-1",
    "v0.0.1:agent:context-bundle-1",
    "v0.0.1:knowledge:access-1",
    "v0.0.1:agent:library-1",
    "v0.0.1:workspace:contribution-1",
    "Middle Layer Strategy",
    "Compatibility Strategy",
    "两个问题，一个能力，三个兼容",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "Pact 管理软件",
    "上游资源经过 Pact 后变细",
    "下游本地智能体经过 Pact 后能共享部分资产和能力",
    "Workspace Contribution Protocol",
    "contributionGrant",
    "rankScore",
    "assetContributionReportV0",
    "/api/agent-workspaces",
    "/api/workspace/contributions/report",
    "v0.0.1:storage:checkpoint-tree-1",
    "Unified Checkpoint Tree Protocol",
    "checkpointNodeId",
    "effectKind",
    "access.requested",
    "access.denied",
    "file.changed",
    "skill.invoked",
    "workspace.checkpoint.restore.preview",
    "workspace.operation.revert.scope",
    "checkpoint.restored",
    "git worktree",
    "MCP Demo Flows",
    "Pact MCP service",
    "OpenClaw 文档互通演示",
    "Skill 贡献排行榜演示",
    "workspace.skill.usage.report",
    "rankScoreV0",
    "usageCount * successRate",
    "Knowledge Access Protocol",
    "knowledgeAccessReceipt",
    "loanRecord",
    "upstreamKnowledgeRef",
    "derivedViewRef",
    "upstreamAccessDenied",
    "Upstream Permission Demo Flow",
    "上游知识库 A/B 权限再授权演示",
    "requestedEgress=exportFile",
    "权限错误",
    "denied request audit",
    "A2A adapter",
    "MCP server",
    "Agent traffic/load gateway",
    "OpenAI-compatible model gateway"
  ]) {
    assertTextIncludes(protocols, needle, `${protocolsFile} must keep protocol adapter evidence for ${needle}`);
  }
}

async function main() {
  await assertHttpServerUsesCompositionRoot();
  await assertCompositionRootOwnsAssembly();
  await assertRuntimeProvidersOwnProviderImports();
  await assertCorePlatformProviderOwnsPorts();
  await assertDataStructureProviderOwnsPorts();
  await assertStorageProviderOwnsPorts();
  await assertDevopsProviderOwnsPorts();
  await assertCommonConsoleDelegatesSpecializedOperations();
  await assertCoreArchitectureDocsCoverMainline();
}

await main();
console.log("architecture-patterns verification passed");
