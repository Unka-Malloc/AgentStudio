import { AcpInboundFacade } from "./acp-inbound-facade.mjs";
import { createDownstreamClientAspectService } from "../../../../common/downstream-client-aspect/index.mjs";
import { AcpSourceJsonRpcBridge, createAcpSourceJsonRpcBridge } from "./acp-source-json-rpc-bridge.mjs";
import {
  AcpSourceJsonRpcService,
  createAcpSourceJsonRpcLineTransport,
  createAcpSourceJsonRpcService,
  createAcpSourceJsonRpcTransportPair
} from "./acp-source-json-rpc-service.mjs";
import {
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv,
  runAcpSourceStdioServerFromEnv
} from "./acp-source-stdio-server.mjs";
import { AcpVirtualAgentRegistry, createFileAcpVirtualAgentRegistryAdapter } from "./acp-virtual-agent-registry.mjs";
import { AcpTargetRegistry, createFileAcpTargetRegistryAdapter } from "./acp-target-registry.mjs";
import { RelaySessionStore, createFileRelaySessionAdapter } from "./relay-session-store.mjs";
import { AcpRelayRouter } from "./acp-relay-router.mjs";
import { AcpSessionDriver, createAcpTargetConnection } from "./acp-session-driver.mjs";
import { AcpClientConnection } from "./acp-client-connection.mjs";
import {
  AntigravityAgentApiClient,
  buildAntigravityCascadeUserInteractionDecision,
  callAntigravityConnectRpc,
  createAntigravityAgentApiClient,
  createAntigravityAgentApiCapabilitySnapshot,
  discoverAntigravityAgentApiEndpoint,
  discoverAntigravityConnectEndpoint,
  extractAntigravityCsrfToken,
  listAntigravityLanguageServers,
  listAntigravityListenPorts,
  normalizeAntigravityCascadeTrajectory,
  observeAntigravityConversation,
  parseAntigravityAgentApiCommands,
  probeAntigravityIdeCliCapabilities,
  probeAntigravityAgentApiCapabilities,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  redactAntigravityConnectEndpoint,
  resolveAntigravityConversationBrainPath,
  resolveAntigravityAgentApiBinary,
  resolveAntigravityIdeCliBinary,
  resolveAntigravityMessagesDir,
  resolveAntigravityTranscriptPath,
  summarizeAntigravityConnectObservation,
  summarizeAntigravityConversationObservation,
  waitForAntigravityConversationObservation,
  workspaceFlagForRoot
} from "./antigravity-agent-api-client.mjs";
import {
  AntigravityAgentApiConnection,
  createAntigravityAgentApiConnection
} from "./antigravity-agent-api-connection.mjs";
import {
  CodexCliExecConnection,
  createCodexCliExecConnection
} from "./codex-cli-exec-connection.mjs";
import { AcpEventNormalizer } from "./acp-event-normalizer.mjs";
import { AcpPermissionBridge } from "./acp-permission-bridge.mjs";
import { AcpSourceOperationGuard, createAcpSourceOperationGuard } from "./acp-source-operation-guard.mjs";
import {
  createFileSensitivePayloadStore,
  createInMemorySensitivePayloadStore
} from "./sensitive-payload-store.mjs";
import {
  normalizeAcpSourceAuthenticationContext,
  sourceAuthContextForOperation,
  sourcePublicIdentity
} from "./acp-source-auth-context.mjs";
import { RelayOperationExecutor } from "./relay-operation-executor.mjs";

export const ACP_AGENT_RELAY_PROTOCOL_VERSION = "pact.acp-agent-relay.v1";

export {
  AcpInboundFacade,
  AcpSourceJsonRpcBridge,
  AcpSourceJsonRpcService,
  AcpVirtualAgentRegistry,
  createFileAcpVirtualAgentRegistryAdapter,
  AcpTargetRegistry,
  createFileAcpTargetRegistryAdapter,
  RelaySessionStore,
  createFileRelaySessionAdapter,
  createFileSensitivePayloadStore,
  createInMemorySensitivePayloadStore,
  AcpRelayRouter,
  AcpSessionDriver,
  createAcpTargetConnection,
  AcpClientConnection,
  AntigravityAgentApiClient,
  buildAntigravityCascadeUserInteractionDecision,
  callAntigravityConnectRpc,
  createAntigravityAgentApiClient,
  createAntigravityAgentApiCapabilitySnapshot,
  discoverAntigravityAgentApiEndpoint,
  discoverAntigravityConnectEndpoint,
  extractAntigravityCsrfToken,
  listAntigravityLanguageServers,
  listAntigravityListenPorts,
  normalizeAntigravityCascadeTrajectory,
  observeAntigravityConversation,
  parseAntigravityAgentApiCommands,
  probeAntigravityIdeCliCapabilities,
  probeAntigravityAgentApiCapabilities,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  redactAntigravityConnectEndpoint,
  resolveAntigravityConversationBrainPath,
  resolveAntigravityAgentApiBinary,
  resolveAntigravityIdeCliBinary,
  resolveAntigravityMessagesDir,
  resolveAntigravityTranscriptPath,
  summarizeAntigravityConnectObservation,
  summarizeAntigravityConversationObservation,
  waitForAntigravityConversationObservation,
  workspaceFlagForRoot,
  AntigravityAgentApiConnection,
  createAntigravityAgentApiConnection,
  CodexCliExecConnection,
  createCodexCliExecConnection,
  AcpEventNormalizer,
  AcpPermissionBridge,
  AcpSourceOperationGuard,
  createAcpSourceOperationGuard,
  normalizeAcpSourceAuthenticationContext,
  sourceAuthContextForOperation,
  sourcePublicIdentity,
  RelayOperationExecutor,
  createAcpSourceJsonRpcBridge,
  createAcpSourceJsonRpcLineTransport,
  createAcpSourceJsonRpcService,
  createAcpSourceJsonRpcTransportPair,
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv,
  runAcpSourceStdioServerFromEnv
};

function resolveStoreAdapter(options = {}) {
  if (options.storeAdapter) {
    return options.storeAdapter;
  }
  const filePath = String(options.storePath || options.storeFilePath || "").trim();
  const userDataPath = String(options.userDataPath || "").trim();
  if (filePath || userDataPath) {
    return createFileRelaySessionAdapter({ filePath, userDataPath });
  }
  return options.storeState || {};
}

function resolveSensitivePayloadStore(options = {}) {
  if (options.sensitivePayloadStore) {
    return options.sensitivePayloadStore;
  }
  if (options.sensitivePayloadStore === false) {
    return null;
  }
  const filePath = String(options.sensitivePayloadStorePath || options.sensitivePayloadFilePath || "").trim();
  const userDataPath = String(options.userDataPath || "").trim();
  if (filePath || userDataPath) {
    return createFileSensitivePayloadStore({ filePath, userDataPath });
  }
  if (options.sensitivePayloadStoreState) {
    return createInMemorySensitivePayloadStore(options.sensitivePayloadStoreState);
  }
  return null;
}

function resolveTargetRegistryAdapter(options = {}) {
  if (options.targetRegistryAdapter) {
    return options.targetRegistryAdapter;
  }
  const filePath = String(options.targetRegistryPath || options.targetRegistryFilePath || "").trim();
  const userDataPath = String(options.userDataPath || "").trim();
  if (filePath || userDataPath) {
    return createFileAcpTargetRegistryAdapter({ filePath, userDataPath });
  }
  return null;
}

function resolveVirtualAgentRegistryAdapter(options = {}) {
  if (options.virtualAgentRegistryAdapter) {
    return options.virtualAgentRegistryAdapter;
  }
  const filePath = String(options.virtualAgentRegistryPath || options.virtualAgentRegistryFilePath || "").trim();
  const userDataPath = String(options.userDataPath || "").trim();
  if (filePath || userDataPath) {
    return createFileAcpVirtualAgentRegistryAdapter({ filePath, userDataPath });
  }
  return null;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function shouldInvalidateRelayMcpConnection(event = {}) {
  const reasonCode = asText(event.reasonCode || event.type);
  return [
    "grant_updated",
    "grant_deleted",
    "grant_revoked",
    "grant_token_rotated"
  ].includes(reasonCode);
}

function createRuntimeDownstreamClientAspect({
  options = {},
  targetRegistry,
  virtualAgentRegistry,
  logger = null
} = {}) {
  if (options.downstreamClientAspect === false || options.enableDownstreamClientAspect === false) {
    return null;
  }
  const configuredService = options.downstreamClientAspectService ||
    (options.downstreamClientAspect && typeof options.downstreamClientAspect.start === "function"
      ? options.downstreamClientAspect
      : null);
  const service = configuredService || createDownstreamClientAspectService({
    ...asObject(options.downstreamClientAspectOptions),
    targetRegistry: options.downstreamClientAspectOptions?.targetRegistry || targetRegistry,
    virtualAgentRegistry: options.downstreamClientAspectOptions?.virtualAgentRegistry || virtualAgentRegistry,
    frameworkOverrides: options.downstreamClientFrameworkOverrides ||
      options.downstreamClientAspectOptions?.frameworkOverrides ||
      [],
    env: options.downstreamClientEnv ||
      options.downstreamClientAspectOptions?.env ||
      options.env ||
      process.env,
    logger: options.downstreamClientAspectOptions?.logger || logger
  });
  if (options.startDownstreamClientAspect !== false && service && service.started !== true) {
    service.start(options.downstreamClientAspectStart || options.downstreamClientAspectOptions?.start || {});
  }
  return service;
}

export function createAcpAgentRelayRuntimeServices(options = {}) {
  const virtualAgentRegistry = options.virtualAgentRegistry || new AcpVirtualAgentRegistry(options.virtualAgents, {
    adapter: resolveVirtualAgentRegistryAdapter(options)
  });
  const targetRegistry = options.targetRegistry || new AcpTargetRegistry(options.targets, {
    adapter: resolveTargetRegistryAdapter(options)
  });
  const downstreamClientAspect = createRuntimeDownstreamClientAspect({
    options,
    targetRegistry,
    virtualAgentRegistry,
    logger: options.logger
  });
  const store = options.store || new RelaySessionStore({ adapter: resolveStoreAdapter(options) });
  const sensitivePayloadStore = resolveSensitivePayloadStore(options);
  const router = options.router || new AcpRelayRouter({ virtualAgentRegistry, targetRegistry });
  const sessionDriver = options.sessionDriver || new AcpSessionDriver({ connectionFactory: options.connectionFactory });
  const eventNormalizer = options.eventNormalizer || new AcpEventNormalizer();
  const permissionBridge = options.permissionBridge || new AcpPermissionBridge({ workspaceRoot: options.workspaceRoot });
  const operationGuard = options.operationGuard || (options.securityPermissions
    ? new AcpSourceOperationGuard({
        securityPermissions: options.securityPermissions,
        operations: options.operations,
        subject: options.authorizationSubject || options.sourceAuthorizationSubject,
        actor: options.authorizationActor,
        authSession: options.authSession,
        grant: options.authorizationGrant,
        profile: options.authorizationProfile,
        request: options.request,
        context: options.authorizationContext || options.sourceAuthorizationContext,
        grantRequired: options.sourceAuthorizationGrantRequired === true,
        enforceConfirmation: options.sourceAuthorizationEnforceConfirmation === true
      })
    : null);
  const executor = options.executor || new RelayOperationExecutor({
    virtualAgentRegistry,
    targetRegistry,
    downstreamClientAspect,
    router,
    store,
    sessionDriver,
    eventNormalizer,
    permissionBridge,
    operationGuard,
    sensitivePayloadStore,
    relayMcpGrantIssuer: options.relayMcpGrantIssuer,
    targetCallbackHandlers: options.targetCallbackHandlers
  });
  const inboundFacade = options.inboundFacade || new AcpInboundFacade({ executor, store });
  const sourceJsonRpcBridge = options.sourceJsonRpcBridge || new AcpSourceJsonRpcBridge({
    inboundFacade,
    executor,
    store,
    defaultVirtualAgentId: options.defaultVirtualAgentId,
    defaultSourceId: options.defaultSourceId,
    defaultWorkspaceId: options.defaultWorkspaceId,
    logger: options.logger
  });
  const sourceJsonRpcService = options.sourceJsonRpcService || new AcpSourceJsonRpcService({
    runtime: null,
    bridge: sourceJsonRpcBridge,
    context: options.sourceJsonRpcContext,
    contextResolver: options.sourceJsonRpcContextResolver,
    logger: options.logger
  });
  return {
    protocolVersion: ACP_AGENT_RELAY_PROTOCOL_VERSION,
    virtualAgentRegistry,
    targetRegistry,
    store,
    router,
    sessionDriver,
    eventNormalizer,
    permissionBridge,
    operationGuard,
    sensitivePayloadStore,
    downstreamClientAspect,
    executor,
    inboundFacade,
    sourceJsonRpcBridge,
    sourceJsonRpcService
  };
}

export function createAcpRelayRuntime(options = {}) {
  const services = createAcpAgentRelayRuntimeServices(options);
  return {
    ...services,
    async execute(operationId, input = {}, context = {}) {
      return services.executor.execute(operationId, input, context);
    },
    async handleSourceAcpMessage(message, context = {}) {
      return services.sourceJsonRpcBridge.handle(message, context);
    },
    async handleSourceAcpFrame(frame, context = {}) {
      return services.sourceJsonRpcService.handleFrame(frame, context);
    },
    async serveSourceAcpTransport(transport, context = {}) {
      return services.sourceJsonRpcService.serveTransport(transport, context);
    },
    async invalidateRelayMcpGrant(input = {}) {
      if (typeof services.sessionDriver?.invalidateRelayMcpGrant !== "function") {
        return {
          ok: false,
          closedConnections: 0,
          reasonCode: "relay_mcp_invalidation_unavailable"
        };
      }
      return services.sessionDriver.invalidateRelayMcpGrant(input);
    },
    async handleToolManagementChange(event = {}) {
      if (!shouldInvalidateRelayMcpConnection(event)) {
        return {
          ok: true,
          ignored: true,
          reasonCode: asText(event.reasonCode || event.type || "tool_management_change_ignored")
        };
      }
      return services.sessionDriver.invalidateRelayMcpGrant({
        relayMcpGrantId: event.grantId,
        reason: asText(event.reasonCode || event.type || "tool_management_change")
      });
    },
    async close() {
      if (services.sourceJsonRpcService && typeof services.sourceJsonRpcService.close === "function") {
        services.sourceJsonRpcService.close();
      }
      if (services.sessionDriver && typeof services.sessionDriver.closeAll === "function") {
        return services.sessionDriver.closeAll();
      }
      return { ok: true, closedConnections: 0 };
    }
  };
}

export async function executeAcpAgentRelayOperation(operationId, input = {}, options = {}) {
  const runtime = options.runtime || createAcpRelayRuntime(options);
  return runtime.execute(operationId, input, options.context || {});
}
