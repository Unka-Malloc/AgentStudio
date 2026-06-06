export {
  getSettingsPath,
  loadSettings,
  resolveModelForModule,
  saveSettings
} from "../common/platform-core/settings.mjs";
export {
  appendJsonLine,
  appendJsonLineSerialized,
  atomicWriteJson,
  atomicWriteJsonThroughState,
  mutateState,
  queueStateMutation,
  readJsonFile,
  stateFileKey,
  waitForStateIdle
} from "../common/platform-core/state-coordinator.mjs";
export {
  assertServerToken,
  hashClientString,
  isServerToken,
  resolveWithin,
  serverToken
} from "../common/security/client-strings.mjs";
export { sendJson } from "../common/console/http/http-utils.mjs";
export async function callAgentGateway(...args) {
  const module = await import("../specialized/agent/agent-gateway/index.mjs");
  return module.callAgentGateway(...args);
}
export async function publicAgentGatewayConfig(...args) {
  const module = await import("../specialized/agent/agent-gateway/index.mjs");
  return module.publicAgentGatewayConfig(...args);
}
export async function loadKnowledgeFileProcessorRuntime() {
  return import("../specialized/knowledge/preprocessing/file-processor/index.mjs");
}
export async function loadKnowledgeNormalizedDocumentsRuntime() {
  return import("../specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs");
}
export {
  createRuntimeLogger,
  getRuntimeLogger,
  setRuntimeLogger,
  summarizeError,
  summarizeForLog
} from "../common/observability/runtime-logger.mjs";
export {
  buildBootstrapPayload,
  getDiscoveryConfigPath,
  loadDiscoveryConfig,
  resolveDiscoveryState,
  saveDiscoveryConfig
} from "../common/platform-core/discovery/config.mjs";
export { createCorePlatformProvider } from "../common/platform-core/core-platform-provider.mjs";
export {
  createTraceContext,
  setTraceContextOnRequest,
  traceContextFromRequest,
  traceDetails
} from "../common/observability/trace-context.mjs";
export { createClientRegistryService } from "../common/storage/client-registry-repository.mjs";
export {
  cleanupImportArtifacts,
  collectProtectedRawObjectPaths,
  createImportEntryId,
  getImportCheckpointDirectory,
  hydrateImportCheckpointSources,
  listImportCheckpointEntries,
  loadImportCheckpointEntry,
  rawObjectPathsFromSources,
  removeImportCheckpoint,
  saveImportCheckpointEntry,
  validateImportCheckpointEntry
} from "../common/storage/import-resume-store.mjs";
export { resolveStoredObjectPath } from "../common/storage/raw-object-store.mjs";
export { dispatchOperation } from "../common/operation-dispatcher/operation-dispatcher.mjs";
export { SERVER_API_OPERATIONS } from "../common/operation-dispatcher/operation-registry.mjs";
export {
  composeUnifiedSystemStatus,
  normalizeUnifiedRegistration,
  unifiedRegistrationForQueue,
  unifiedRegistrationForTask
} from "../common/devops/unified-registration-core/unified-registration.mjs";
export {
  checkpointTreeId,
  checkpointTreeSummary,
  deleteCheckpointTree,
  finishCheckpointTree,
  listCheckpointTrees,
  loadCheckpointTree,
  startCheckpointTree,
  upsertCheckpointNode
} from "../common/data-structure/checkpoint-tree-store.mjs";
export {
  createDurableWorkflowRuntime,
  DURABLE_WORKFLOW_PROTOCOL_VERSION,
  verifyWorkflowHistory,
  workflowId
} from "../common/workflow/durable-workflow-store.mjs";

import { createServerRuntime as createCommonServerRuntime } from "../common/module-manager/server-runtime.mjs";

function isRuntimeFeatureActive(runtimeOptions = {}, featureId = "") {
  const activeFeatureIds = runtimeOptions.featureRuntime?.activeFeatureIds;
  return !Array.isArray(activeFeatureIds) || activeFeatureIds.length === 0 || activeFeatureIds.includes(featureId);
}

export async function loadKnowledgePipelineRuntime() {
  return import("../specialized/knowledge/preprocessing/chunking/pipeline.mjs");
}

export async function loadKnowledgeDocumentParsingRuntime() {
  return import("../specialized/knowledge/preprocessing/document-parsing-runtime.mjs");
}

export async function loadKnowledgePreprocessResultRuntime() {
  return import("../specialized/knowledge/preprocessing/preprocess-result.mjs");
}

export async function loadKnowledgeAnalysisRuntime() {
  return import("../specialized/knowledge/preprocessing/analysis-engine-registry.mjs");
}

export async function loadKnowledgeEmailRulesRuntime() {
  return import("../specialized/knowledge/preprocessing/domain/rules/email-rules.mjs");
}

export async function loadKnowledgeSourceServiceRuntime() {
  return import("../specialized/knowledge/storage/knowledge-source-service.mjs");
}

export async function createKnowledgeSourceService(...args) {
  const module = await loadKnowledgeSourceServiceRuntime();
  return module.createKnowledgeSourceService(...args);
}

export async function createServerRuntime(options = {}) {
  const runtimeOptions = options.runtimeOptions || {};
  const metadataStoreDomainServices = options.metadataStoreDomainServices ||
    (isRuntimeFeatureActive(runtimeOptions, "knowledge-core")
      ? (await import("../specialized/knowledge/storage/metadata-store-domain-services.mjs"))
          .createKnowledgeMetadataStoreDomainServices()
      : {});
  const builtinMountProviders = options.builtinMountProviders ||
    (isRuntimeFeatureActive(runtimeOptions, "knowledge-core")
      ? (await import("../specialized/knowledge/storage/builtin-mount-providers.mjs"))
          .createKnowledgeBuiltinMountProviders({
            userDataPath: options.userDataPath
          })
      : {});
  return createCommonServerRuntime({
    ...options,
    metadataStoreDomainServices,
    builtinMountProviders
  });
}
