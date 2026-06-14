export const INTERACTIVE_INTERFACE_MANIFEST = Object.freeze({
  version: "v0.0.1:platform:interactive-interface-1",
  layer: "server/platform/interactive",
  intent: "Product and service code should consume platform capabilities through the interactive layer first.",
  productApi: Object.freeze({
    module: "server/platform/interactive/product-api.mjs",
    interfaces: Object.freeze([
      // Settings
      Object.freeze({ name: "getSettingsPath", source: "../common/platform-core/settings.mjs" }),
      Object.freeze({ name: "loadSettings", source: "../common/platform-core/settings.mjs" }),
      Object.freeze({ name: "resolveModelForModule", source: "../common/platform-core/settings.mjs" }),
      Object.freeze({ name: "saveSettings", source: "../common/platform-core/settings.mjs" }),

      // State coordination
      Object.freeze({ name: "appendJsonLine", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "appendJsonLineSerialized", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "atomicWriteJson", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "atomicWriteJsonThroughState", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "mutateState", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "queueStateMutation", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "readJsonFile", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "stateFileKey", source: "../common/platform-core/state-coordinator.mjs" }),
      Object.freeze({ name: "waitForStateIdle", source: "../common/platform-core/state-coordinator.mjs" }),

      // Security and path guards
      Object.freeze({ name: "assertServerToken", source: "../common/security/client-strings.mjs" }),
      Object.freeze({ name: "hashClientString", source: "../common/security/client-strings.mjs" }),
      Object.freeze({ name: "isServerToken", source: "../common/security/client-strings.mjs" }),
      Object.freeze({ name: "resolveWithin", source: "../common/security/client-strings.mjs" }),
      Object.freeze({ name: "serverToken", source: "../common/security/client-strings.mjs" }),

      // Console and protocol helpers
      Object.freeze({ name: "sendJson", source: "../common/console/http/http-utils.mjs" }),

      // Knowledge runtime
      Object.freeze({ name: "createKnowledgePipeline", source: "../specialized/knowledge/preprocessing/chunking/pipeline.mjs" }),
      Object.freeze({ name: "summarizePreprocessResult", source: "../specialized/knowledge/preprocessing/preprocess-result.mjs" }),
      Object.freeze({ name: "listAvailableAnalysisModules", source: "../specialized/knowledge/preprocessing/analysis-engine-registry.mjs" }),
      Object.freeze({ name: "runConfiguredAnalysisModule", source: "../specialized/knowledge/preprocessing/analysis-engine-registry.mjs" }),
      Object.freeze({ name: "loadEmailRules", source: "../specialized/knowledge/preprocessing/domain/rules/email-rules.mjs" }),
      Object.freeze({ name: "createKnowledgeSourceService", source: "../specialized/knowledge/storage/knowledge-source-service.mjs" }),
      Object.freeze({ name: "callAgentGateway", source: "../specialized/agent/agent-gateway/index.mjs" }),
      Object.freeze({ name: "publicAgentGatewayConfig", source: "../specialized/agent/agent-gateway/index.mjs" }),
      Object.freeze({ name: "loadKnowledgeFileProcessorRuntime", source: "../specialized/knowledge/preprocessing/file-processor/index.mjs" }),
      Object.freeze({ name: "loadKnowledgeNormalizedDocumentsRuntime", source: "../specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs" }),

      // Observability and discovery
      Object.freeze({ name: "createRuntimeLogger", source: "../common/observability/runtime-logger.mjs" }),
      Object.freeze({ name: "getRuntimeLogger", source: "../common/observability/runtime-logger.mjs" }),
      Object.freeze({ name: "setRuntimeLogger", source: "../common/observability/runtime-logger.mjs" }),
      Object.freeze({ name: "summarizeError", source: "../common/observability/runtime-logger.mjs" }),
      Object.freeze({ name: "summarizeForLog", source: "../common/observability/runtime-logger.mjs" }),
      Object.freeze({ name: "buildBootstrapPayload", source: "../common/platform-core/discovery/config.mjs" }),
      Object.freeze({ name: "createCorePlatformProvider", source: "../common/platform-core/core-platform-provider.mjs" }),
      Object.freeze({ name: "getDiscoveryConfigPath", source: "../common/platform-core/discovery/config.mjs" }),
      Object.freeze({ name: "loadDiscoveryConfig", source: "../common/platform-core/discovery/config.mjs" }),
      Object.freeze({ name: "resolveDiscoveryState", source: "../common/platform-core/discovery/config.mjs" }),
      Object.freeze({ name: "saveDiscoveryConfig", source: "../common/platform-core/discovery/config.mjs" }),
      Object.freeze({ name: "createTraceContext", source: "../common/observability/trace-context.mjs" }),
      Object.freeze({ name: "setTraceContextOnRequest", source: "../common/observability/trace-context.mjs" }),
      Object.freeze({ name: "traceContextFromRequest", source: "../common/observability/trace-context.mjs" }),
      Object.freeze({ name: "traceDetails", source: "../common/observability/trace-context.mjs" }),

      // Runtime and storage
      Object.freeze({ name: "createServerRuntime", source: "../common/module-manager/server-runtime.mjs" }),
      Object.freeze({ name: "createClientRegistryService", source: "../common/storage/client-registry-repository.mjs" }),
      Object.freeze({ name: "cleanupImportArtifacts", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "collectProtectedRawObjectPaths", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "createImportEntryId", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "getImportCheckpointDirectory", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "hydrateImportCheckpointSources", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "listImportCheckpointEntries", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "loadImportCheckpointEntry", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "rawObjectPathsFromSources", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "removeImportCheckpoint", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "saveImportCheckpointEntry", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "validateImportCheckpointEntry", source: "../common/storage/import-resume-store.mjs" }),
      Object.freeze({ name: "resolveStoredObjectPath", source: "../common/storage/raw-object-store.mjs" }),

      // Operations and status
      Object.freeze({ name: "dispatchOperation", source: "../common/operation-dispatcher/operation-dispatcher.mjs" }),
      Object.freeze({ name: "SERVER_API_OPERATIONS", source: "../common/operation-dispatcher/operation-registry.mjs" }),
      Object.freeze({ name: "composeUnifiedSystemStatus", source: "../common/devops/unified-registration-core/unified-registration.mjs" }),
      Object.freeze({ name: "normalizeUnifiedRegistration", source: "../common/devops/unified-registration-core/unified-registration.mjs" }),
      Object.freeze({ name: "unifiedRegistrationForQueue", source: "../common/devops/unified-registration-core/unified-registration.mjs" }),
      Object.freeze({ name: "unifiedRegistrationForTask", source: "../common/devops/unified-registration-core/unified-registration.mjs" }),

      // Checkpoint tree
      Object.freeze({ name: "checkpointTreeId", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "checkpointTreeSummary", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "deleteCheckpointTree", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "finishCheckpointTree", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "listCheckpointTrees", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "loadCheckpointTree", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "startCheckpointTree", source: "../common/data-structure/checkpoint-tree-store.mjs" }),
      Object.freeze({ name: "upsertCheckpointNode", source: "../common/data-structure/checkpoint-tree-store.mjs" })
    ])
  }),
  platformRegistry: Object.freeze({
    module: "server/platform/interactive/platform-registry.mjs",
    interfaces: Object.freeze([
      Object.freeze({ id: "security.auth.console", platform: "security", source: "../common/security/register.mjs" }),
      Object.freeze({ id: "security.audit.operations", platform: "security", source: "../common/security/register.mjs" }),
      Object.freeze({ id: "core.provider", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "core.events.protocol", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "core.logging.runtime", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "core.features.runtime", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "core.operations.concurrencyScope", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "core.operations.registry", platform: "core", source: "../common/platform-core/register.mjs" }),
      Object.freeze({ id: "data-structure.provider", platform: "data-structure", source: "../common/data-structure/register.mjs" }),
      Object.freeze({ id: "data-structure.checkpointTree", platform: "data-structure", source: "../common/data-structure/register.mjs" }),
      Object.freeze({ id: "storage.provider", platform: "storage", source: "../common/storage/register.mjs" }),
      Object.freeze({ id: "storage.metadataStore", platform: "storage", source: "../common/storage/register.mjs" }),
      Object.freeze({ id: "module-management.provider", platform: "module-management", source: "../common/module-manager/register.mjs" }),
      Object.freeze({ id: "module-management.serverRuntime", platform: "module-management", source: "../common/module-manager/register.mjs" }),
      Object.freeze({ id: "module-management.mounts", platform: "module-management", source: "../common/module-manager/register.mjs" }),
      Object.freeze({ id: "devops.processStatus.get", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.provider", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.monitorAlerts.state", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.monitorAlerts.saveConfig", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.monitorAlerts.runCycle", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.monitorAlerts.acknowledge", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.unifiedRegistration.normalize", platform: "devops", source: "../common/devops/register.mjs" }),
      Object.freeze({ id: "devops.unifiedRegistration.composeStatus", platform: "devops", source: "../common/devops/register.mjs" })
    ])
  })
});

export function listInteractiveProductApiInterfaces() {
  return INTERACTIVE_INTERFACE_MANIFEST.productApi.interfaces.map((entry) => entry.name);
}

export function listInteractivePlatformRegistryInterfaces() {
  return INTERACTIVE_INTERFACE_MANIFEST.platformRegistry.interfaces.map((entry) => entry.id);
}
