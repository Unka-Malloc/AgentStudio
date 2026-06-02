import {
  contentDispositionHeader,
  sendJson
} from "../http-utils.mjs";
import { createSystemControllerAgentSettingsHandlers } from "./system-controller-agent-settings-handlers.mjs";
import { createSystemControllerAuthHandlers } from "./system-controller-auth-handlers.mjs";
import { createSystemControllerCapabilityEcosystemHandlers } from "./system-controller-capability-ecosystem-handlers.mjs";
import { createSystemControllerContexts } from "./system-controller-contexts.mjs";
import { createSystemControllerExternalServiceHandlers } from "./system-controller-external-service-handlers.mjs";
import { createSystemControllerFoundationHandlers } from "./system-controller-foundation-handlers.mjs";
import { createSystemControllerKnowledgeOperationsHandlers } from "./system-controller-knowledge-operations-handlers.mjs";
import { createSystemControllerKnowledgeRuntimeHandlers } from "./system-controller-knowledge-runtime-handlers.mjs";
import { createSystemControllerOpsObservationHandlers } from "./system-controller-ops-observation-handlers.mjs";
import { createSystemControllerRuntimeHandlers } from "./system-controller-runtime-handlers.mjs";
import { createSystemControllerWorkspaceProtocolHandlers } from "./system-controller-workspace-protocol-handlers.mjs";
import { createSystemControllerWorkspaceRuntimeHandlers } from "./system-controller-workspace-runtime-handlers.mjs";
import { createSecurityPermissionsProvider } from "../../../security/security-permissions-provider.mjs";

function parseJsonBody(requestBody) {
  return requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
}

function sendJsonWithHeaders(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

export function createSystemController({
  userDataPath,
  distPath,
  runtime,
  moduleManagement,
  jobWorkflowProvider,
  metadataStore,
  storageProvider = null,
  serverLabel,
  getDiscoveryState,
  setDiscoveryState,
  getListenUrl,
  coreProvider = null,
  getControllers = () => null,
  protocolEventBus = null,
  consoleAuth = null,
  securityPermissions = null,
  operationAuditStore = null,
  maintenanceAgent = null,
  knowledgeSourceService = null,
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
  clientRuntimeBootstrap = null,
  checkpointTreeApi = null,
  queueMonitor = null,
  devopsProvider = null,
  getFeatureEntries = () => null,
  getToolSkillManagementProvider = () => null,
  getToolManagementPlatform = () => null,
  consoleDomainServices = null
}) {
  const effectiveSecurityPermissions =
    securityPermissions ||
    (consoleAuth ? createSecurityPermissionsProvider({ consoleAuth }) : null);
  const {
    executeConsoleDomainOperation,
    knowledgeDomainContext,
    knowledgeWorkflowContext,
    settingsAgentGatewayContext,
    authorizationFacadeContext,
    accessControlContext,
    appendConsoleOperationLog,
    isFeatureActive,
    resumeKnowledgeWordCloudTasks
  } = createSystemControllerContexts({
    userDataPath,
    runtime,
    moduleManagement,
    jobWorkflowProvider,
    metadataStore,
    storageProvider,
    protocolEventBus,
    securityPermissions: effectiveSecurityPermissions,
    operationAuditStore,
    agentWorkspace,
    contextRuntime,
    evidenceSufficiencyGate,
    knowledgeAgentSkill,
    goldenRuleRuntime,
    knowledgeRuleAuthoringRuntime,
    knowledgeSkillRuntime,
    agentEvaluationRuntime,
    modelDecisionRuntime,
    strategyManagementProvider,
    knowledgeEvolutionRuntime,
    summarizationRuntime,
    agentExplorationRuntime,
    clientRuntimeAllocator,
    queueMonitor,
    getFeatureEntries,
    consoleDomainServices
  });

  function protocolPayload(requestBody, url = null) {
    if (requestBody?.length > 0) {
      return parseJsonBody(requestBody);
    }
    return url ? Object.fromEntries(url.searchParams.entries()) : {};
  }

  function queryPayload(url = null) {
    if (!url) {
      return {};
    }
    const payload = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        payload[key] = Array.isArray(payload[key]) ? [...payload[key], value] : [payload[key], value];
      } else {
        payload[key] = value;
      }
    }
    return payload;
  }

  function workspaceIdFrom(input = {}, fallback = "") {
    return String(input.workspaceId || input.workspace || fallback || "default").trim() || "default";
  }

  async function sendConsoleDomainOperation({
    operationId,
    input = {},
    response,
    context = {},
    errorMessage = "Console domain operation failed."
  }) {
    try {
      const operationResult = await runConsoleDomainOperation({ operationId, input, context });
      if (operationResult.payload?.__responseHandled) {
        return;
      }
      if (operationResult.payload?.__binaryResponse) {
        const disposition = operationResult.payload.disposition || "inline";
        const buffer = Buffer.isBuffer(operationResult.payload.buffer)
          ? operationResult.payload.buffer
          : Buffer.alloc(0);
        response.writeHead(operationResult.status || 200, {
          "Content-Type": operationResult.payload.contentType || "application/octet-stream",
          "Content-Disposition": contentDispositionHeader(disposition, operationResult.payload.fileName || "asset.bin"),
          "Content-Length": String(buffer.length),
          "Cache-Control": "no-store",
          ...(operationResult.payload.headers || {})
        });
        response.end(buffer);
        return;
      }
      if (operationResult.payload?.__htmlResponse) {
        response.writeHead(operationResult.status || 200, {
          "Content-Type": operationResult.payload.contentType || "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          ...(operationResult.payload.headers || {})
        });
        response.end(String(operationResult.payload.body || ""));
        return;
      }
      if (operationResult.payload?.__headers) {
        const { __headers: headers, ...payload } = operationResult.payload;
        sendJsonWithHeaders(response, operationResult.status || 200, payload, headers);
        return;
      }
      sendJson(response, operationResult.status || 200, operationResult.payload ?? operationResult);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        operationId,
        error: error instanceof Error ? error.message : errorMessage
      });
    }
  }

  async function runConsoleDomainOperation({ operationId, input = {}, context = {} }) {
    return executeConsoleDomainOperation({
      operationId,
      input,
      context: {
        userDataPath,
        ...context
      }
    });
  }

  const controller = {
    ...createSystemControllerAuthHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      securityPermissions: effectiveSecurityPermissions,
      operationAuditStore,
      appendConsoleOperationLog
    }),
    ...createSystemControllerFoundationHandlers({
      sendConsoleDomainOperation,
      protocolPayload,
      workspaceIdFrom,
      authorizationFacadeContext,
      accessControlContext,
      getToolSkillManagementProvider,
      getStrategyManagementProvider: () => strategyManagementProvider,
      agentWorkspace,
      runtime
    }),
    ...createSystemControllerRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      queryPayload,
      isFeatureActive,
      knowledgeWorkflowContext,
      coreProvider,
      getControllers,
      getFeatureEntries,
      protocolEventBus,
      getDiscoveryState,
      setDiscoveryState,
      getListenUrl,
      serverLabel,
      distPath,
      runtime,
      moduleManagement,
      jobWorkflowProvider,
      storageProvider,
      securityPermissions: effectiveSecurityPermissions,
      maintenanceAgent,
      clientRuntimeAllocator,
      getToolSkillManagementProvider,
      consoleDomainServices
    }),
    ...createSystemControllerAgentSettingsHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      settingsAgentGatewayContext
    }),
    ...createSystemControllerWorkspaceProtocolHandlers({
      sendConsoleDomainOperation,
      protocolPayload,
      operationAuditStore,
      checkpointTreeApi,
      agentWorkspace,
      knowledgeWorkflowContext,
      accessControlContext
    }),
    ...createSystemControllerCapabilityEcosystemHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      moduleManagement,
      getToolSkillManagementProvider,
      getStrategyManagementProvider: () => strategyManagementProvider
    }),
    ...createSystemControllerExternalServiceHandlers({
      parseJsonBody,
      userDataPath,
      getToolManagementPlatform
    }),
    ...createSystemControllerKnowledgeOperationsHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      queryPayload,
      knowledgeWorkflowContext,
      storageProvider
    }),
    ...createSystemControllerOpsObservationHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      jobWorkflowProvider,
      checkpointTreeApi,
      queueMonitor,
      devopsProvider
    }),
    ...createSystemControllerKnowledgeRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      protocolPayload,
      queryPayload,
      knowledgeDomainContext,
      knowledgeWorkflowContext,
      runtime,
      jobWorkflowProvider,
      knowledgeSourceService,
      metadataStore,
      storageProvider,
      clientRuntimeAllocator,
      modelDecisionRuntime,
      strategyManagementProvider,
      agentWorkspace,
      accessControlContext,
      consoleDomainServices
    }),
    ...createSystemControllerWorkspaceRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      protocolPayload,
      contextRuntime,
      agentWorkspace,
      clientRuntimeAllocator,
      clientRuntimeBootstrap
    }),
  };
  setImmediate(() => {
    void resumeKnowledgeWordCloudTasks();
  });
  return controller;
}
