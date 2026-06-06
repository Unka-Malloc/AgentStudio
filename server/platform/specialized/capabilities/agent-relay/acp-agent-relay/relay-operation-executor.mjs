import crypto from "node:crypto";

import { ACP_METHODS } from "../../../../common/protocols/acp/index.mjs";
import {
  normalizeAcpSourceAuthenticationContext,
  sourceAuthContextForOperation
} from "./acp-source-auth-context.mjs";
import {
  observeAntigravityConversation,
  waitForAntigravityConversationObservation
} from "./antigravity-agent-api-client.mjs";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }
  const text = asText(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(text)) {
    return false;
  }
  return fallback;
}

function operationResult(ok, data = {}, error = null) {
  return {
    ok,
    schemaVersion: 1,
    protocol: "pact.acp-agent-relay.v1",
    ...(ok ? { data } : { error: error || data })
  };
}

function pathDenied(path = "") {
  return path.includes("..") || path.startsWith("/") || path.startsWith("\\");
}

function sanitizeFsPath(value = "") {
  return asText(value).replace(/^file:\/\//, "");
}

function hasDirectSessionId(input = {}) {
  return Boolean(asText(input.relaySessionId || input.sessionId || input.session_id || input.id));
}

function includePendingPermissionRequests(input = {}) {
  return asBoolean(
    input.includePendingPermissionRequests ??
      input.includePendingPermissionRequestDetails ??
      input.includePendingPermissions ??
      input.includePendingRequests ??
      input.includePermissionRequests,
    false
  );
}

function randomId(prefix = "id") {
  return `${asText(prefix, "id")}_${Date.now().toString(36)}_${crypto.randomBytes(9).toString("hex")}`;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sensitivePayloadRef(kind = "", id = "") {
  return `sensitive://pact/acp-agent-relay/${asText(kind, "payload")}/${asText(id, randomId("payload"))}`;
}

function normalizedApprovalFingerprint(approval = {}) {
  const input = asObject(approval);
  return {
    approved: input.approved === true,
    payloadHash: asText(input.payloadHash)
  };
}

function normalizedWriteFingerprint(write = {}) {
  const input = asObject(write);
  return {
    path: asText(input.path),
    contentHash: crypto.createHash("sha256").update(String(input.content ?? "")).digest("hex"),
    toolCallId: asText(input.toolCallId || input.id),
    approval: normalizedApprovalFingerprint(input.approval)
  };
}

function promptRequestFingerprint(input = {}, promptText = "") {
  return hashJson({
    promptText,
    requestedMode: asText(input.requestedMode || input.mode || input.promptMode),
    requestReasoning: input.requestReasoning === true,
    terminal: asObject(input.terminal),
    command: asText(input.command),
    approval: normalizedApprovalFingerprint(input.approval),
    fileWrites: (Array.isArray(input.fileWrites) ? input.fileWrites : []).map((write) => normalizedWriteFingerprint(write))
  });
}

function createAuditEvidence({ input = {}, session = {}, turn = {}, route = {} } = {}) {
  void input;
  const relayTurnId = asText(turn.relayTurnId);
  const globalAuditId = `audit://pact/acp-agent-relay/${relayTurnId}`;
  const artifactRef = `artifact://pact/acp-agent-relay/${relayTurnId}`;
  return {
    globalAuditId,
    artifactRef,
    relayTurnId,
    relaySessionId: asText(session.relaySessionId),
    operationId: "acp_agent_relay.prompt.send",
    policyRevision: route.policyRevision,
    relayMcpGrantId: asText(session.relayMcpGrantId)
  };
}

function withAuditEvidence(event = {}, audit = {}) {
  return {
    ...event,
    globalAuditId: audit.globalAuditId,
    artifactRef: audit.artifactRef,
    operationId: asText(event.operationId, audit.operationId)
  };
}

function buildTargetEvidence({ route = {}, session = {}, promptResult = {}, audit = {} } = {}) {
  const communication = targetCommunicationDescriptor(route.target);
  return {
    targetId: route.target?.targetId || "",
    externalServiceId: route.target?.externalServiceId || "",
    transportType: communication.transportType,
    protocolStyle: communication.protocolStyle,
    targetCommunicationMode: communication.targetCommunicationMode,
    nativeAcpTargetSupported: communication.nativeAcpTargetSupported,
    nativeAcpTargetVerified: communication.nativeAcpTargetVerified,
    nativeAcpSourceSupported: communication.nativeAcpSourceSupported,
    nativeAcpSourceVerified: communication.nativeAcpSourceVerified,
    communication,
    targetSessionId: asText(promptResult.targetSessionId || session.targetSessionId),
    targetResumeRef: asText(promptResult.targetResumeRef || session.targetResumeRef),
    externalAccepted: Boolean(promptResult.externalResponse),
    externalCompletionState: asText(promptResult.externalCompletionState || (promptResult.stopReason === "accepted" ? "accepted_only" : "")),
    finalResponseAvailable: promptResult.finalResponseAvailable === true,
    finalResponsePolicy: asText(
      promptResult.finalResponsePolicy ||
        (promptResult.finalResponseAvailable === true
          ? "inline_response"
          : promptResult.stopReason === "accepted"
            ? "accepted_only"
            : "")
    ),
    agentApiCapabilitySnapshot: asObject(promptResult.agentApiCapabilitySnapshot),
    targetError: asObject(promptResult.targetError, null),
    localConversationObservation: asObject(promptResult.localConversationObservation, null),
    localObservationError: asText(promptResult.localObservationError),
    connectConversationObservation: asObject(promptResult.connectConversationObservation, null),
    connectObservationError: asText(promptResult.connectObservationError),
    targetAdapterProvider: asText(
      promptResult.targetAdapterProvider ||
        promptResult.targetResponse?.provider ||
        promptResult.targetResponse?.targetResponse?.provider ||
        promptResult.provider
    ),
    targetInteractionReceipts: Array.isArray(promptResult.targetInteractionReceipts)
      ? promptResult.targetInteractionReceipts
      : [],
    externalResponseKeys: Object.keys(asObject(promptResult.externalResponse)),
    advertisedTools: route.decision?.advertisedTools || [],
    effectiveWrites: route.decision?.writesPolicy?.writes || "",
    effectiveTerminal: route.decision?.terminalPolicy?.terminal || "",
    effectiveMaxRisk: route.decision?.maxRisk || "",
    capabilitiesSnapshot: virtualAgentCapabilityDescriptor({
      agent: route.virtualAgent,
      route
    }),
    globalAuditId: audit.globalAuditId,
    artifactRef: audit.artifactRef,
    relayTurnId: audit.relayTurnId,
    policyRevision: audit.policyRevision,
    relayMcpGrantId: audit.relayMcpGrantId
  };
}

function isAntigravityAgentApiTarget(target = {}, targetEvidence = {}) {
  const type = asText(target?.transport?.type || targetEvidence.transportType).toLowerCase();
  return ["antigravity-agentapi", "antigravity.agentapi", "agentapi"].includes(type);
}

function redactedAntigravityObservation(observation = {}) {
  const input = asObject(observation, null);
  if (!input) {
    return null;
  }
  const compactTranscriptEntry = (entry = null) => {
    const value = asObject(entry, null);
    return value
      ? {
          lineIndex: value.lineIndex,
          stepIndex: value.stepIndex,
          source: asText(value.source),
          type: asText(value.type),
          status: asText(value.status),
          createdAt: asText(value.createdAt),
          contentPreview: asText(value.contentPreview),
          errorPreview: asText(value.errorPreview)
        }
      : null;
  };
  const compactMessage = (message = null) => {
    const value = asObject(message, null);
    return value
      ? {
          id: asText(value.id),
          sender: asText(value.sender),
          recipient: asText(value.recipient),
          timestamp: asText(value.timestamp),
          mtimeMs: Number(value.mtimeMs || 0),
          contentPreview: asText(value.contentPreview)
        }
      : null;
  };
  const compactTextEvent = (event = null) => {
    const value = asObject(event, null);
    return value
      ? {
          lineIndex: value.lineIndex,
          stepIndex: value.stepIndex,
          createdAt: asText(value.createdAt),
          textPreview: asText(value.textPreview || value.contentPreview || value.text)
        }
      : null;
  };
  return {
    provider: "antigravity-local-observation",
    conversationId: asText(input.conversationId),
    transcriptLineCount: Number(input.transcriptLineCount || 0),
    messageCount: Number(input.messageCount || 0),
    afterTranscriptLineCount: Number(input.afterTranscriptLineCount || 0),
    afterMessageMtimeMs: Number(input.afterMessageMtimeMs || 0),
    markerObserved: input.markerObserved === true,
    markerMessageObserved: input.markerMessageObserved === true,
    markerTranscriptObserved: input.markerTranscriptObserved === true,
    markerMessageCount: Number(input.markerMessageCount || 0),
    transcriptAdvanced: input.transcriptAdvanced === true,
    progressAvailable: input.progressAvailable === true,
    finalResponseAvailable: input.finalResponseAvailable === true,
    errorAvailable: input.errorAvailable === true,
    knownErrorAvailable: input.knownErrorAvailable === true,
    latestMessage: compactMessage(input.latestMessage),
    latestProgress: compactTextEvent(input.latestProgress),
    latestFinalResponse: compactTextEvent(input.latestFinalResponse),
    latestError: compactTranscriptEntry(input.latestError),
    latestKnownError: compactTranscriptEntry(input.latestKnownError),
    latestTranscriptEntry: compactTranscriptEntry(input.latestTranscriptEntry),
    latestMarkerMessage: compactMessage(input.latestMarkerMessage)
  };
}

function antigravityObservationFingerprint(observation = null) {
  const input = asObject(observation, null);
  if (!input) {
    return "";
  }
  return hashJson({
    conversationId: asText(input.conversationId),
    transcriptLineCount: Number(input.transcriptLineCount || 0),
    messageCount: Number(input.messageCount || 0),
    finalResponseAvailable: input.finalResponseAvailable === true,
    errorAvailable: input.errorAvailable === true,
    latestProgress: asText(input.latestProgress?.textPreview || input.latestProgress?.contentPreview),
    latestFinalResponse: asText(input.latestFinalResponse?.textPreview || input.latestFinalResponse?.contentPreview),
    latestError: asText(input.latestError?.errorPreview || input.latestError?.contentPreview)
  });
}

function targetFinalResponseCapability(target = {}) {
  const transport = asObject(target.transport);
  const type = asText(transport.type || "mock");
  if (type === "antigravity-agentapi") {
    return {
      policy: transport.connectEnabled === true ? "connect_trajectory_if_observed" : "accepted_only",
      agentApiFinalResponseReadSupported: false,
      connectTrajectorySupported: transport.connectEnabled === true,
      waitForFinalResponse: transport.connectWaitForFinalResponse !== false
    };
  }
  if (type === "mock") {
    return {
      policy: "inline_response",
      agentApiFinalResponseReadSupported: false,
      connectTrajectorySupported: false,
      waitForFinalResponse: false
    };
  }
  if (type === "codex-cli-exec") {
    return {
      policy: "codex_cli_exec_final_message",
      agentApiFinalResponseReadSupported: false,
      connectTrajectorySupported: false,
      waitForFinalResponse: true
    };
  }
  return {
    policy: "target_acp_completion",
    agentApiFinalResponseReadSupported: false,
    connectTrajectorySupported: false,
    waitForFinalResponse: false
  };
}

function targetCommunicationDescriptor(target = {}) {
  const input = asObject(target);
  const transport = asObject(input.transport);
  const metadata = asObject(input.metadata?.public || input.metadata?.safe || {});
  const transportType = asText(transport.type || input.transportType);
  const protocolStyle = asText(transport.protocolStyle);
  const normalizedType = transportType.toLowerCase();
  let targetCommunicationMode = normalizedType;
  let nativeAcpTargetSupported = false;
  let nativeAcpTargetVerified = false;
  let nativeAcpSourceSupported = asBoolean(transport.nativeAcpSourceSupported ?? metadata.nativeAcpSourceSupported, false);
  let nativeAcpSourceVerified = false;
  if (normalizedType === "stdio" && protocolStyle === "agent-client-protocol-v1") {
    targetCommunicationMode = "native_acp_stdio";
    nativeAcpTargetSupported = true;
  } else if (normalizedType === "codex-cli-exec") {
    targetCommunicationMode = "codex_cli_exec_proxy";
    nativeAcpSourceSupported = false;
  } else if (normalizedType === "antigravity-agentapi") {
    targetCommunicationMode = "agent_api_proxy";
    nativeAcpSourceSupported = false;
  } else if (normalizedType === "mock") {
    targetCommunicationMode = "contract_mock";
    nativeAcpSourceSupported = false;
  }
  return {
    protocol: nativeAcpTargetSupported ? "acp" : "",
    protocolStyle,
    transportType,
    targetCommunicationMode,
    nativeAcpTargetSupported,
    nativeAcpTargetVerified,
    nativeAcpSourceSupported,
    nativeAcpSourceVerified
  };
}

function targetCapabilityDescriptor(target = {}) {
  const input = asObject(target);
  const transport = asObject(input.transport);
  const capabilityPolicy = asObject(input.capabilityPolicy);
  const communication = targetCommunicationDescriptor(input);
  return {
    targetId: asText(input.targetId),
    label: asText(input.label),
    agentProfileId: asText(input.agentProfileId),
    enabled: input.enabled !== false,
    disabledReason: asText(input.disabledReason),
    externalServiceId: asText(input.externalServiceId),
    transportType: communication.transportType,
    protocolStyle: communication.protocolStyle,
    targetCommunicationMode: communication.targetCommunicationMode,
    nativeAcpTargetSupported: communication.nativeAcpTargetSupported,
    nativeAcpTargetVerified: communication.nativeAcpTargetVerified,
    nativeAcpSourceSupported: communication.nativeAcpSourceSupported,
    nativeAcpSourceVerified: communication.nativeAcpSourceVerified,
    communication,
    advertisedToolsets: Array.isArray(input.advertisedToolsets) ? input.advertisedToolsets : [],
    capabilityPolicy: {
      writes: asText(capabilityPolicy.writes, "deny"),
      terminal: asText(capabilityPolicy.terminal, "deny"),
      maxRisk: asText(capabilityPolicy.maxRisk, "read_only")
    },
    capabilities: {
      toolsets: Array.isArray(input.advertisedToolsets) ? input.advertisedToolsets : [],
      writes: asText(capabilityPolicy.writes, "deny"),
      terminal: asText(capabilityPolicy.terminal, "deny"),
      maxRisk: asText(capabilityPolicy.maxRisk, "read_only"),
      finalResponse: targetFinalResponseCapability(input)
    },
    lastHandshakeAt: asText(input.lastHandshakeAt),
    revision: Number(input.revision || 1),
    metadata: asObject(input.metadata?.public || input.metadata?.safe || {})
  };
}

function registeredVirtualAgentDescriptor(agent = {}, target = {}) {
  const capabilityPolicy = asObject(agent.capabilityPolicy);
  return virtualAgentCapabilityDescriptor({
    agent,
    target,
    route: {
      target,
      effectiveMode: asText(agent.defaultMode, "ask"),
      policyRevision: agent.revision,
      decision: {
        advertisedTools: Array.isArray(agent.advertisedTools) ? agent.advertisedTools : [],
        reasoningAllowed: false,
        progressOnly: asText(agent.reasoningVisibilityPolicy, "requestable") === "never",
        writesPolicy: {
          writes: asText(capabilityPolicy.writes, "deny")
        },
        terminalPolicy: {
          terminal: asText(capabilityPolicy.terminal, "deny")
        },
        maxRisk: asText(capabilityPolicy.maxRisk, "read_only")
      }
    }
  });
}

function downstreamClientAssemblyDescriptor(record = {}) {
  const acpRelay = asObject(record.acpRelay);
  const target = asObject(acpRelay.target);
  const virtualAgent = asObject(acpRelay.virtualAgent);
  const capabilities = asObject(record.capabilities);
  const communication = asObject(record.communication);
  return {
    protocol: asText(record.protocol),
    layerId: asText(record.layerId),
    adapterKind: asText(record.adapterKind),
    frameworkId: asText(record.frameworkId),
    frameworkLabel: asText(record.frameworkLabel),
    frameworkKind: asText(record.frameworkKind),
    adapterId: asText(record.adapterId),
    profileId: asText(record.profileId),
    status: asText(record.status),
    reasonCode: asText(record.reasonCode),
    communication: {
      protocol: asText(communication.protocol),
      direction: asText(communication.direction),
      transport: asText(communication.transport),
      targetRole: asText(communication.targetRole)
    },
    capabilities: {
      configurationStrategy: asText(capabilities.configurationStrategy),
      modes: Array.isArray(capabilities.modes) ? capabilities.modes : [],
      defaultMode: asText(capabilities.defaultMode),
      modalities: Array.isArray(capabilities.modalities) ? capabilities.modalities : [],
      dataSources: Array.isArray(capabilities.dataSources) ? capabilities.dataSources : [],
      tools: Array.isArray(capabilities.tools) ? capabilities.tools : [],
      reasoningVisibilityPolicy: asText(capabilities.reasoningVisibilityPolicy),
      connectObservationSupported: capabilities.connectObservationSupported === true,
      protocolBoundary: asText(capabilities.protocolBoundary),
      toolBoundary: asText(capabilities.toolBoundary),
      mcpInterfaceVersion: asText(capabilities.mcpInterfaceVersion)
    },
    acpRelay: target.targetId || virtualAgent.virtualAgentId
      ? {
          targetId: asText(target.targetId),
          virtualAgentId: asText(virtualAgent.virtualAgentId),
          externalServiceId: asText(target.externalServiceId),
          targetEnabled: target.enabled === true,
          virtualAgentEnabled: virtualAgent.enabled === true
        }
      : null,
    startup: {
      sequence: Number(record.startup?.sequence || 0),
      assembledAt: asText(record.startup?.assembledAt)
    }
  };
}

function downstreamAspectPublicMetadata(value = {}) {
  return asObject(value.metadata?.public || value.metadata?.safe || value.metadata);
}

function isDownstreamAspectOwned(value = {}) {
  const metadata = downstreamAspectPublicMetadata(value);
  return asText(metadata.fromAspect) === "downstream-client-aspect" ||
    (
      asText(metadata.protocol) === "acp" &&
      asText(metadata.frameworkId) &&
      asText(metadata.adapterId) &&
      asText(metadata.serviceKind) === "downstream-client-aspect"
    );
}

function matchesDownstreamFramework(value = {}, frameworkId = "") {
  const expected = asText(frameworkId);
  if (!expected) {
    return true;
  }
  const metadata = downstreamAspectPublicMetadata(value);
  return asText(metadata.frameworkId) === expected;
}

function summarizeWakeResult(session = {}) {
  const metadata = asObject(session.metadata);
  const wake = asObject(metadata.lastWakeResult || metadata.wakeResult, null);
  if (!wake) {
    return null;
  }
  return {
    ok: wake.ok !== false,
    targetSessionId: asText(wake.targetSessionId),
    targetResumeRef: asText(wake.targetResumeRef),
    wokenAt: asText(wake.wokenAt || session.lastWokenAt),
    transportType: asText(wake.transportType),
    finalResponsePolicy: asText(wake.finalResponsePolicy)
  };
}

function sessionMatchesFilters(session = {}, input = {}) {
  const filters = [
    ["sourceId", asText(input.sourceId || input.source_id)],
    ["workspaceId", asText(input.workspaceId || input.workspace_id)],
    ["virtualAgentId", asText(input.virtualAgentId || input.virtual_agent_id || input.agentId || input.agent_id)],
    ["targetId", asText(input.targetId || input.target_id)],
    ["lifecycleState", asText(input.lifecycleState || input.status || input.state)]
  ];
  return filters.every(([key, expected]) => !expected || asText(session[key]) === expected);
}

function virtualAgentCapabilityDescriptor({ agent = {}, route = null, target = null, error = null } = {}) {
  const routeDecision = asObject(route?.decision);
  const effectiveTarget = asObject(target || route?.target);
  const communication = targetCommunicationDescriptor(effectiveTarget);
  const effectiveTools = Array.isArray(routeDecision.advertisedTools) ? routeDecision.advertisedTools : [];
  const writesPolicy = asObject(routeDecision.writesPolicy);
  const terminalPolicy = asObject(routeDecision.terminalPolicy);
  return {
    virtualAgentId: asText(agent.virtualAgentId),
    targetId: asText(agent.targetId),
    profileId: asText(agent.profileId),
    displayName: asText(agent.displayName),
    description: asText(agent.description),
    defaultMode: asText(agent.defaultMode, "ask"),
    advertisedModes: Array.isArray(agent.advertisedModes) ? agent.advertisedModes : [],
    advertisedModalities: Array.isArray(agent.advertisedModalities) ? agent.advertisedModalities : [],
    advertisedDataSources: Array.isArray(agent.advertisedDataSources) ? agent.advertisedDataSources : [],
    advertisedTools: Array.isArray(agent.advertisedTools) ? agent.advertisedTools : [],
    reasoningVisibilityPolicy: asText(agent.reasoningVisibilityPolicy, "requestable"),
    visibilityPolicy: asText(agent.visibilityPolicy, "public"),
    capabilityPolicy: asObject(agent.capabilityPolicy),
    enabled: agent.enabled !== false && !error,
    revision: Number(agent.revision || 1),
    metadata: asObject(agent.metadata?.public || agent.metadata?.safe || {}),
    capabilities: {
      modes: Array.isArray(agent.advertisedModes) ? agent.advertisedModes : [],
      defaultMode: asText(agent.defaultMode, "ask"),
      modalities: Array.isArray(agent.advertisedModalities) ? agent.advertisedModalities : [],
      dataSources: Array.isArray(agent.advertisedDataSources) ? agent.advertisedDataSources : [],
      tools: effectiveTools,
      reasoningVisibilityPolicy: asText(agent.reasoningVisibilityPolicy, "requestable"),
      writes: asText(writesPolicy.writes || agent.capabilityPolicy?.writes, "deny"),
      terminal: asText(terminalPolicy.terminal || agent.capabilityPolicy?.terminal, "deny"),
      maxRisk: asText(routeDecision.maxRisk || agent.capabilityPolicy?.maxRisk, "read_only"),
      finalResponse: targetFinalResponseCapability(effectiveTarget)
    },
    target: {
      targetId: asText(effectiveTarget.targetId || agent.targetId),
      label: asText(effectiveTarget.label),
      externalServiceId: asText(effectiveTarget.externalServiceId),
      transportType: communication.transportType,
      protocolStyle: communication.protocolStyle,
      targetCommunicationMode: communication.targetCommunicationMode,
      nativeAcpTargetSupported: communication.nativeAcpTargetSupported,
      nativeAcpTargetVerified: communication.nativeAcpTargetVerified,
      nativeAcpSourceSupported: communication.nativeAcpSourceSupported,
      nativeAcpSourceVerified: communication.nativeAcpSourceVerified,
      communication,
      enabled: effectiveTarget.enabled !== false
    },
    route: route
      ? {
          effectiveMode: asText(route.effectiveMode),
          policyRevision: route.policyRevision,
          reasoningAllowed: routeDecision.reasoningAllowed === true,
          progressOnly: routeDecision.progressOnly === true
        }
      : null,
    availability: error
      ? {
          ok: false,
          reasonCode: asText(error.code || error.reasonCode || "unavailable"),
          message: asText(error.message, "Virtual agent is unavailable.")
        }
      : {
          ok: true,
          reasonCode: "",
          message: ""
        }
  };
}

function sourceRouteSummary(route = {}) {
  const decision = asObject(route.decision);
  const communication = targetCommunicationDescriptor(route.target);
  return {
    effectiveMode: asText(route.effectiveMode),
    policyRevision: route.policyRevision,
    workspaceId: asText(route.workspaceId),
    sourceSubjectId: asText(route.sourceSubjectId),
    sourceIdentity: asObject(route.sourceIdentity),
    virtualAgentId: asText(route.virtualAgent?.virtualAgentId),
    targetId: asText(route.target?.targetId),
    target: {
      targetId: asText(route.target?.targetId),
      label: asText(route.target?.label),
      externalServiceId: asText(route.target?.externalServiceId),
      transportType: communication.transportType,
      protocolStyle: communication.protocolStyle,
      targetCommunicationMode: communication.targetCommunicationMode,
      nativeAcpTargetSupported: communication.nativeAcpTargetSupported,
      nativeAcpTargetVerified: communication.nativeAcpTargetVerified,
      nativeAcpSourceSupported: communication.nativeAcpSourceSupported,
      nativeAcpSourceVerified: communication.nativeAcpSourceVerified,
      communication,
      enabled: route.target?.enabled !== false
    },
    decision: {
      advertisedTools: Array.isArray(decision.advertisedTools) ? decision.advertisedTools : [],
      reasoningAllowed: decision.reasoningAllowed === true,
      writesPolicy: asObject(decision.writesPolicy),
      terminalPolicy: asObject(decision.terminalPolicy),
      maxRisk: asText(decision.maxRisk, "read_only")
    }
  };
}

function nonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isClosedSession(session = {}) {
  return asText(session.lifecycleState) === "closed";
}

function isCancellableTurn(turn = {}) {
  return ["pending", "running", "approval_pending"].includes(asText(turn.status));
}

function isCancelledTurn(turn = {}) {
  return asText(turn.status) === "cancelled" || asText(turn.stopReason) === "cancelled";
}

function closedSessionError(session = {}) {
  return {
    code: "relay_session_closed",
    message: "Relay session is closed.",
    details: {
      relaySessionId: asText(session.relaySessionId),
      reasonCode: "relay_session_closed",
      lifecycleState: asText(session.lifecycleState)
    }
  };
}

function connectInteractionStepFromObservation(observation = {}) {
  const input = asObject(observation);
  return asObject(input.handledInteractionStep, null) ||
    asObject(input.waitingInteractionStep, null) ||
    null;
}

function permissionFromConnectInteractionStep(step = {}) {
  const input = asObject(step, null);
  return input ? asObject(input.requestedInteraction?.permission, null) : null;
}

function targetInteractionReceiptsFromPromptResult({ promptResult = {}, permissionBridge = null } = {}) {
  const observation = asObject(promptResult.connectConversationObservation);
  const step = connectInteractionStepFromObservation(observation);
  const permission = permissionFromConnectInteractionStep(step);
  if (!permission) {
    return [];
  }
  const action = asText(permission.action);
  if (action !== "command") {
    return [{
      ok: false,
      status: "unsupported",
      action: `target.${action || "interaction"}`,
      reasonCode: "target_interaction_unsupported",
      targetAction: action,
      targetPreview: asText(permission.targetPreview || permission.target).slice(0, 280),
      targetToolCallId: asText(step.toolCall?.id),
      connectStepIndex: step.stepIndex,
      connectStepType: asText(step.type)
    }];
  }
  const command = asText(permission.targetPreview || permission.target || step.runCommand?.commandLinePreview || step.runCommand?.commandLine);
  const denial = permissionBridge?.denyTerminal
    ? permissionBridge.denyTerminal({ command })
    : {
        ok: false,
        status: "denied",
        action: "terminal",
        reasonCode: "phase1_terminal_denied"
      };
  return [{
    ...denial,
    action: "terminal",
    targetAction: "command",
    targetPreview: command.slice(0, 280),
    targetToolCallId: asText(step.toolCall?.id),
    connectStepIndex: step.stepIndex,
    connectStepType: asText(step.type),
    externalInteraction: {
      provider: "antigravity-connect",
      kind: "permission",
      persistSuggestionType: asText(permission.persistSuggestionType),
      suggestedPersistPattern: asText(permission.suggestedPersistPattern)
    }
  }];
}

function sessionBelongsToInput(session = {}, input = {}) {
  const checks = [
    ["sourceId", asText(input.sourceId || input.source_id)],
    ["workspaceId", asText(input.workspaceId || input.workspace_id)],
    ["sourceSessionId", asText(input.sourceSessionId || input.source_session_id)],
    ["virtualAgentId", asText(input.virtualAgentId || input.virtual_agent_id || input.agentId || input.agent_id)]
  ];
  return checks.every(([key, expected]) => !expected || asText(session[key]) === expected);
}

function auditFromTurn(turn = {}, session = {}) {
  const metadataAudit = asObject(turn.metadata?.audit);
  if (nonEmptyObject(metadataAudit)) {
    return metadataAudit;
  }
  return {
    globalAuditId: turn.globalAuditId,
    artifactRef: turn.artifactRef,
    relayTurnId: turn.relayTurnId,
    relaySessionId: turn.relaySessionId || session.relaySessionId,
    operationId: turn.operationId || "acp_agent_relay.prompt.send",
    policyRevision: session.policyRevision,
    relayMcpGrantId: session.relayMcpGrantId
  };
}

function receiptsFromEvents(events = []) {
  const receipts = [];
  for (const event of Array.isArray(events) ? events : []) {
    const payload = asObject(event.redactedPayload);
    if ((event.type === "receipt" || event.type === "denial") && nonEmptyObject(payload)) {
      receipts.push(payload);
    }
    if (event.type === "completion" && Array.isArray(payload.receipts)) {
      receipts.push(...payload.receipts);
    }
  }
  return receipts;
}

function outputSummaryFromEvents(events = []) {
  const completion = [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((event) => event.type === "completion");
  const payload = asObject(completion?.redactedPayload);
  return asText(payload.outputSummary || payload.text || payload.message);
}

function communicationSummaryKind({ stopReason = "", targetEvidence = {}, outputSummary = "" } = {}) {
  const evidence = asObject(targetEvidence);
  const reason = asText(stopReason);
  const externalCompletionState = asText(evidence.externalCompletionState);
  if (externalCompletionState === "target_error" || reason === "target_error" || nonEmptyObject(asObject(evidence.targetError, null))) {
    return "target_error";
  }
  if (reason === "approval_denied") {
    return "approval_denied";
  }
  if (reason === "cancelled") {
    return "cancelled";
  }
  if (reason === "approval_pending" || externalCompletionState === "approval_pending") {
    return "approval_pending";
  }
  if (externalCompletionState === "accepted_only" || reason === "accepted") {
    return "acknowledgement";
  }
  if (evidence.finalResponseAvailable === true) {
    return "final_response";
  }
  return asText(outputSummary) ? "status_summary" : "none";
}

function summarizePermissionRequestForSource(request = {}) {
  const input = asObject(request);
  const details = asObject(input.details);
  return {
    requestId: asText(input.requestId),
    relayTurnId: asText(input.relayTurnId),
    targetToolCallId: asText(input.targetToolCallId),
    requestedAction: asText(input.requestedAction),
    risk: asText(input.risk),
    status: asText(input.status),
    pendingOperationId: asText(input.pendingOperationId),
    decisionId: asText(input.decisionId),
    requestedAt: asText(input.requestedAt),
    decidedAt: asText(input.decidedAt),
    details: {
      relaySessionId: asText(details.relaySessionId),
      action: asText(details.action),
      path: asText(details.path),
      payloadHash: asText(details.payloadHash),
      requestReasoning: details.requestReasoning === true,
      receipt: asObject(details.receipt)
    }
  };
}

function buildCommunicationSummary({
  session = {},
  turn = {},
  events = [],
  receipts = [],
  pendingPermissionRequests = [],
  stopReason = "",
  outputSummary = "",
  audit = {},
  targetEvidence = {}
} = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const safePending = Array.isArray(pendingPermissionRequests) ? pendingPermissionRequests : [];
  const evidence = asObject(targetEvidence);
  const targetError = asObject(evidence.targetError, null);
  const summaryText = asText(outputSummary).replace(/\s+/g, " ").slice(0, 1000);
  const summaryKind = communicationSummaryKind({
    stopReason: stopReason || turn.stopReason || turn.status,
    targetEvidence: evidence,
    outputSummary: summaryText
  });
  const deniedReceiptCount = safeReceipts.filter(
    (receipt) => asText(receipt?.status) === "denied" || receipt?.ok === false
  ).length;
  return {
    relaySessionId: asText(session.relaySessionId || turn.relaySessionId),
    relayTurnId: asText(turn.relayTurnId || evidence.relayTurnId || audit.relayTurnId),
    sourceId: asText(session.sourceId),
    sourceSessionId: asText(session.sourceSessionId),
    virtualAgentId: asText(session.virtualAgentId || evidence.capabilitiesSnapshot?.virtualAgentId),
    targetId: asText(evidence.targetId || session.targetId),
    targetSessionId: asText(evidence.targetSessionId || session.targetSessionId),
    targetResumeRef: asText(evidence.targetResumeRef || session.targetResumeRef),
    stopReason: asText(stopReason || turn.stopReason || turn.status),
    lifecycleState: asText(session.lifecycleState),
    outputAvailable: summaryText.length > 0,
    outputSummary: summaryText,
    summaryKind,
    finalResponseSummary: summaryKind === "final_response" ? summaryText : "",
    acknowledgementSummary: summaryKind === "acknowledgement" ? summaryText : "",
    externalCompletionState: asText(evidence.externalCompletionState),
    finalResponseAvailable: evidence.finalResponseAvailable === true,
    finalResponsePolicy: asText(evidence.finalResponsePolicy),
    targetErrorCode: asText(targetError?.code),
    targetErrorMessage: asText(targetError?.message).replace(/\s+/g, " ").slice(0, 500),
    receiptCount: safeReceipts.length,
    deniedReceiptCount,
    pendingPermissionRequestCount: safePending.length,
    eventCount: safeEvents.length,
    progressEventCount: safeEvents.filter((event) => event.type === "progress").length,
    reasoningEventCount: safeEvents.filter((event) => event.type === "reasoning_trace").length,
    reasoningIncluded: safeEvents.some((event) => event.type === "reasoning_trace"),
    globalAuditId: asText(audit.globalAuditId || evidence.globalAuditId || turn.globalAuditId),
    artifactRef: asText(audit.artifactRef || evidence.artifactRef || turn.artifactRef),
    policyRevision: audit.policyRevision ?? evidence.policyRevision ?? session.policyRevision ?? null,
    relayMcpGrantId: asText(audit.relayMcpGrantId || evidence.relayMcpGrantId || session.relayMcpGrantId)
  };
}

function responseKindFromCommunicationSummary(communicationSummary = {}) {
  return asText(asObject(communicationSummary).summaryKind, "none") || "none";
}

function targetRequestParams(request = {}) {
  return asObject(request.params);
}

function targetRequestToolCallId(params = {}) {
  return asText(params.toolCallId || params.tool_call_id || params.requestId || params.id);
}

function targetPermissionPayload(params = {}) {
  return asObject(params.permission, params);
}

function targetPermissionAction(params = {}, fallback = "") {
  const permission = targetPermissionPayload(params);
  return asText(
    permission.action ||
      permission.kind ||
      permission.type ||
      params.action ||
      params.kind ||
      fallback
  );
}

function targetPermissionPath(params = {}) {
  const permission = targetPermissionPayload(params);
  return asText(permission.path || permission.filePath || permission.uri || params.path || params.filePath || params.uri)
    .replace(/^file:\/\//, "");
}

function targetPermissionCommand(params = {}) {
  const permission = targetPermissionPayload(params);
  return asText(
    permission.command ||
      permission.target ||
      permission.targetPreview ||
      params.command ||
      params.target ||
      params.targetPreview
  );
}

function targetErrorFromRuntimeError(error, fallbackCode = "target_runtime_error") {
  const input = asObject(error);
  const message = error instanceof Error
    ? error.message
    : asText(input.message || input.errorMessage || error, "Target runtime failed.");
  return {
    code: asText(input.code || input.errorCode, fallbackCode),
    message,
    provider: "target-acp",
    transportType: "acp",
    diagnosticMessage: message
  };
}

function targetWriteContent(params = {}) {
  const permission = targetPermissionPayload(params);
  return String(permission.content ?? permission.text ?? params.content ?? params.text ?? "");
}

function permissionRequestMatchesTargetWrite(request = {}, { targetToolCallId = "", payloadHash = "", path = "" } = {}) {
  const details = asObject(request.details);
  return asText(request.requestedAction) === "fs.writeTextFile" &&
    (!targetToolCallId || asText(request.targetToolCallId || details.targetToolCallId) === targetToolCallId) &&
    (!payloadHash || asText(details.payloadHash || details.receipt?.payloadHash) === payloadHash) &&
    (!path || asText(details.path) === path);
}

function receiptDedupeKey(receipt = {}) {
  const input = asObject(receipt);
  return asText(input.requestId) ||
    [
      asText(input.action),
      asText(input.targetToolCallId),
      asText(input.path),
      asText(input.payloadHash),
      asText(input.status),
      asText(input.reasonCode)
    ].join("|");
}

function mergeReceipts(...groups) {
  const merged = [];
  const indexes = new Map();
  for (const group of groups) {
    for (const receipt of Array.isArray(group) ? group : []) {
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
        continue;
      }
      const key = receiptDedupeKey(receipt);
      if (indexes.has(key)) {
        merged[indexes.get(key)] = {
          ...merged[indexes.get(key)],
          ...receipt
        };
      } else {
        indexes.set(key, merged.length);
        merged.push(receipt);
      }
    }
  }
  return merged;
}

function auditSafeTargetReceipt(receipt = {}) {
  const input = asObject(receipt);
  const output = { ...input };
  if (typeof output.content === "string") {
    output.contentLength = output.content.length;
    output.contentDigest = asText(output.digest) ||
      crypto.createHash("sha256").update(output.content).digest("hex");
    delete output.content;
  }
  return output;
}

function sourceAuthorizationFromContext(context = {}) {
  const direct = asObject(context.sourceAuthorization || context.toolRuntimeAuthorization, null);
  if (direct?.ok === true || direct?.grant) {
    return direct;
  }
  const requestAuthorization = asObject(context.request?.__pactToolRuntimeAuthorization, null);
  if (requestAuthorization?.ok === true || requestAuthorization?.grant) {
    return requestAuthorization;
  }
  return {};
}

function sourceBoundInput(input = {}, context = {}) {
  const raw = asObject(input);
  const sourceAuthorization = sourceAuthorizationFromContext(context);
  const authenticated = normalizeAcpSourceAuthenticationContext({
    ...asObject(context),
    sourceAuthContext: context.sourceAuthContext,
    sourceIdentity: context.sourceIdentity,
    authSession: context.authSession,
    grant: sourceAuthorization.grant || context.grant,
    profile: context.profile,
    authorizationSubject: context.authorizationSubject
  });
  if (authenticated.authContextTrusted !== true && authenticated.sourceIdentityTrusted !== true) {
    return raw;
  }
  const sourceAuthContext = sourceAuthContextForOperation(authenticated);
  return {
    ...raw,
    ...(authenticated.sourceId ? { sourceId: authenticated.sourceId } : {}),
    ...(authenticated.workspaceId ? { workspaceId: authenticated.workspaceId } : {}),
    ...(authenticated.sourceSessionId ? { sourceSessionId: authenticated.sourceSessionId } : {}),
    ...(authenticated.virtualAgentId ? { virtualAgentId: authenticated.virtualAgentId } : {}),
    ...(authenticated.sourceSubjectId ? { sourceSubjectId: authenticated.sourceSubjectId } : {}),
    ...(authenticated.agentProfileId ? { agentProfileId: authenticated.agentProfileId } : {}),
    ...(Object.keys(sourceAuthContext).length > 0
      ? {
          sourceAuthContext,
          authenticatedSourceIdentity: sourceAuthContext
        }
      : {})
  };
}

function sourceAuthContextFromRelay({ input = {}, session = {} } = {}) {
  return asObject(
    input.sourceAuthContext ||
      session.sourceAuthContext ||
      session.metadata?.sourceAuthContext,
    {}
  );
}

function traceContextFromRelayContext(context = {}) {
  return asObject(context.traceContext || context.request?.__pactTraceContext, {});
}

function relayMcpGrantMetadataPatch({
  session = {},
  sourceAuthContext = {},
  sourceAuthorization = {},
  grant = {},
  issuedAt = nowIso()
} = {}) {
  const sourceGrant = asObject(sourceAuthorization.grant);
  return {
    grantId: asText(grant.id || session.relayMcpGrantId),
    issued: true,
    tokenIssued: true,
    tokenPersisted: false,
    issuedAt,
    sourceGrantId: asText(sourceGrant.id || sourceAuthContext.grantId),
    sourceAuthSessionId: asText(sourceAuthContext.authSessionId),
    sourceCredentialRef: asText(sourceAuthContext.credentialRef)
  };
}

function relayMcpGrantIssueFailure(error, fallbackCode = "relay_mcp_grant_issue_failed") {
  const message = error instanceof Error ? error.message : asText(error, "Relay MCP grant issue failed.");
  return {
    code: asText(error?.code, fallbackCode),
    message,
    details: {
      reasonCode: asText(error?.code, fallbackCode)
    }
  };
}

export class RelayOperationExecutor {
  constructor({
    virtualAgentRegistry,
    targetRegistry,
    downstreamClientAspect = null,
    router,
    store,
    sessionDriver,
    eventNormalizer,
    permissionBridge,
    operationGuard = null,
    sensitivePayloadStore = null,
    relayMcpGrantIssuer = null,
    targetCallbackHandlers = null
  }) {
    this.virtualAgentRegistry = virtualAgentRegistry;
    this.targetRegistry = targetRegistry;
    this.downstreamClientAspect = downstreamClientAspect;
    this.router = router;
    this.store = store;
    this.sessionDriver = sessionDriver;
    this.eventNormalizer = eventNormalizer;
    this.permissionBridge = permissionBridge;
    this.operationGuard = operationGuard;
    this.relayMcpGrantIssuer = relayMcpGrantIssuer;
    this.idempotencyLocks = new Map();
    this.sessionPromptLocks = new Map();
    this.permissionResolveLocks = new Map();
    this.sessionCancelGenerations = new Map();
    this.sensitivePayloads = new Map();
    this.sensitivePayloadStore = sensitivePayloadStore;
    this.targetCallbackHandlers = new Map();
    this.registerDefaultTargetCallbackHandlers();
    for (const [method, handler] of Object.entries(asObject(targetCallbackHandlers))) {
      this.registerTargetCallbackHandler(method, handler);
    }
  }

  registerTargetCallbackHandler(method = "", handler = null) {
    const key = asText(method);
    if (!key || typeof handler !== "function") {
      return false;
    }
    this.targetCallbackHandlers.set(key, handler);
    return true;
  }

  registerDefaultTargetCallbackHandlers() {
    this.registerTargetCallbackHandler(
      ACP_METHODS.sessionRequestPermission,
      (context) => this.handleTargetSessionRequestPermission(context)
    );
    this.registerTargetCallbackHandler(
      ACP_METHODS.fsReadTextFile,
      (context) => this.handleTargetFsReadTextFile(context)
    );
    this.registerTargetCallbackHandler(
      ACP_METHODS.fsWriteTextFile,
      (context) => this.handleTargetFsWriteTextFile(context)
    );
  }

	  async rememberSensitivePayload(ref = "", payload = {}) {
	    const key = asText(ref);
	    if (!key) {
	      return "";
	    }
	    const storedPayload = {
	      ...asObject(payload),
	      storedAt: nowIso()
	    };
	    this.sensitivePayloads.set(key, storedPayload);
	    if (this.sensitivePayloadStore && typeof this.sensitivePayloadStore.set === "function") {
	      await this.sensitivePayloadStore.set(key, storedPayload);
	    }
	    return key;
	  }
	
	  async getSensitivePayload(ref = "") {
	    const key = asText(ref);
	    const cached = asObject(this.sensitivePayloads.get(key), null);
	    if (cached) {
	      return cached;
	    }
	    if (this.sensitivePayloadStore && typeof this.sensitivePayloadStore.get === "function") {
	      const persisted = asObject(await this.sensitivePayloadStore.get(key), null);
	      if (persisted) {
	        this.sensitivePayloads.set(key, persisted);
	        return persisted;
	      }
	    }
	    return null;
	  }
	
	  async forgetSensitivePayload(ref = "") {
	    const key = asText(ref);
	    if (!key) {
	      return false;
	    }
	    this.sensitivePayloads.delete(key);
	    if (this.sensitivePayloadStore && typeof this.sensitivePayloadStore.delete === "function") {
	      return this.sensitivePayloadStore.delete(key);
	    }
	    return true;
	  }
	
	  async forgetPermissionSensitivePayloads(details = {}, options = {}) {
	    const input = asObject(details);
	    await this.forgetSensitivePayload(input.contentRef || input.writeContentRef);
	    if (options.prompt === true) {
	      await this.forgetSensitivePayload(input.promptRef);
	    }
	  }
	
	  async listPendingPermissionRequestsForSession(session = {}) {
	    const relaySessionId = asText(session.relaySessionId);
	    if (!relaySessionId || !this.store || typeof this.store.listTurns !== "function") {
	      return [];
	    }
	    const pending = [];
	    for (const turn of await this.store.listTurns(relaySessionId)) {
	      for (const request of await this.store.listPermissionRequests(turn.relayTurnId)) {
	        if (asText(request.status) === "pending") {
	          pending.push(request);
	        }
	      }
	    }
	    return pending;
	  }
	
	  async resolvePendingPromptText(pendingPrompt = {}, details = {}) {
	    const promptPayload = await this.getSensitivePayload(pendingPrompt.promptRef || details.promptRef);
	    return asText(promptPayload?.promptText);
	  }
	
	  async resolvePendingWriteContent(details = {}) {
	    const writePayload = await this.getSensitivePayload(details.contentRef || details.writeContentRef);
	    return Object.hasOwn(writePayload || {}, "content")
	      ? String(writePayload.content ?? "")
	      : null;
  }

  relayMcpGrantIssuerForContext(context = {}) {
    return (
      context.relayMcpGrantIssuer ||
      context.toolSkillManagementProvider ||
      this.relayMcpGrantIssuer ||
      null
    );
  }

  async ensureRelayMcpGrant({ input = {}, session = {}, route = {}, context = {} } = {}) {
    const fallbackGrantId = asText(session.relayMcpGrantId || input.relayMcpGrantId || randomId("relay_mcp"));
    const sourceAuthContext = sourceAuthContextFromRelay({ input, session });
    const issuer = this.relayMcpGrantIssuerForContext(context);
    if (!issuer || typeof issuer.createRelayMcpGrant !== "function") {
      return {
        ok: true,
        issued: false,
        grantId: fallbackGrantId,
        token: "",
        session,
        relaySession: {
          ...session,
          relayMcpGrantId: fallbackGrantId
        }
      };
    }

    const sourceAuthorization = sourceAuthorizationFromContext(context);
    if (!asText(sourceAuthorization.grant?.id)) {
      return {
        ok: true,
        issued: false,
        grantId: fallbackGrantId,
        token: "",
        session,
        relaySession: {
          ...session,
          relayMcpGrantId: fallbackGrantId
        }
      };
    }

    let issued;
    try {
      issued = await issuer.createRelayMcpGrant({
        grantId: fallbackGrantId,
        relayMcpGrantId: fallbackGrantId,
        session,
        route,
        sourceAuthorization,
        sourceAuthContext,
        traceContext: traceContextFromRelayContext(context),
        scopes: input.relayMcpScopes || input.scopes,
        toolsets: input.relayMcpToolsets || input.toolsets,
        toolAllow: input.relayMcpToolAllow || input.toolAllow,
        capabilities: input.relayMcpCapabilities || input.capabilities || input.capabilityIds,
        expiresAt: input.relayMcpExpiresAt || input.expiresAt,
        relayTurnId: input.relayTurnId,
        parentOperationId: input.parentOperationId || input.relayOperationId || input.operationId,
        reason: input.relayMcpReason || `ACP relay MCP child grant for ${session.relaySessionId || "relay session"}`
      });
    } catch (error) {
      return operationResult(false, {}, relayMcpGrantIssueFailure(error));
    }
    if (!issued?.ok) {
      return operationResult(false, {}, {
        code: asText(issued?.error?.code, "relay_mcp_grant_issue_failed"),
        message: asText(issued?.error?.message, "Relay MCP grant issue failed."),
        details: {
          ...asObject(issued?.error?.details),
          reasonCode: asText(issued?.error?.code, "relay_mcp_grant_issue_failed")
        }
      });
    }

    const grantId = asText(issued.grant?.id || fallbackGrantId);
    const metadata = {
      ...asObject(session.metadata),
      ...(Object.keys(sourceAuthContext).length > 0 ? { sourceAuthContext } : {}),
      relayMcpGrant: relayMcpGrantMetadataPatch({
        session: { ...session, relayMcpGrantId: grantId },
        sourceAuthContext,
        sourceAuthorization,
        grant: issued.grant
      })
    };
    const needsSessionPatch = grantId !== asText(session.relayMcpGrantId) ||
      JSON.stringify(asObject(session.metadata?.relayMcpGrant)) !== JSON.stringify(metadata.relayMcpGrant) ||
      (Object.keys(sourceAuthContext).length > 0 && !session.metadata?.sourceAuthContext);
    const storedSession = needsSessionPatch
      ? await this.store.updateSession(session.relaySessionId, {
          relayMcpGrantId: grantId,
          metadata
        })
      : session;
    const safeSession = storedSession || {
      ...session,
      relayMcpGrantId: grantId,
      metadata
    };
    return {
      ok: true,
      issued: true,
      grantId,
      token: asText(issued.token),
      grant: issued.grant,
      session: safeSession,
      relaySession: {
        ...safeSession,
        relayMcpGrantId: grantId,
        relayMcpToken: asText(issued.token),
        relayTurnId: asText(input.relayTurnId),
        relayTraceId: asText(input.traceId),
        relayOperationId: asText(input.parentOperationId || input.relayOperationId || input.operationId)
      }
    };
  }

  async revokeRelayMcpGrant({ session = {}, context = {}, reason = "ACP relay session closed." } = {}) {
    const grantId = asText(session.relayMcpGrantId || session.metadata?.relayMcpGrant?.grantId);
    if (!grantId || session.metadata?.relayMcpGrant?.issued !== true) {
      return null;
    }
    const issuer = this.relayMcpGrantIssuerForContext(context);
    if (!issuer || typeof issuer.revokeRelayMcpGrant !== "function") {
      return null;
    }
    return issuer.revokeRelayMcpGrant({
      grantId,
      relayMcpGrantId: grantId,
      session,
      reason
    });
  }

  async execute(operationId, input = {}, context = {}) {
    const effectiveInput = sourceBoundInput(input, context);
    if (this.operationGuard && typeof this.operationGuard.preflight === "function") {
      const guard = await this.operationGuard.preflight({ operationId, input: effectiveInput, context });
      if (!guard.ok) {
        return operationResult(false, {}, {
          ...asObject(guard.error),
          details: {
            ...asObject(guard.error?.details),
            sourceAuthorizationDecision: guard.decision || null
          }
        });
      }
    }
    switch (operationId) {
      case "acp_agent_relay.virtual_agents.list":
        return this.listVirtualAgents(effectiveInput);
      case "acp_agent_relay.virtual_agents.upsert":
        return this.upsertVirtualAgent(effectiveInput);
      case "acp_agent_relay.targets.list":
        return operationResult(true, {
          targets: this.targetRegistry.listTargets().map((target) => targetCapabilityDescriptor(target))
        });
      case "acp_agent_relay.targets.upsert":
        return this.upsertTarget(effectiveInput);
      case "acp_agent_relay.downstream_clients.refresh":
        return this.refreshDownstreamClients(effectiveInput);
      case "acp_agent_relay.sessions.list":
        return this.listSessions(effectiveInput);
      case "acp_agent_relay.sessions.get":
        return this.getSession(effectiveInput);
      case "acp_agent_relay.turns.list":
        return this.listTurns(effectiveInput);
      case "acp_agent_relay.turn.observe":
        return this.observeTurn(effectiveInput, context);
      case "acp_agent_relay.virtual_agent.initialize":
        return this.initializeVirtualAgent(effectiveInput);
      case "acp_agent_relay.session.create":
        return this.createSession(effectiveInput, context);
      case "acp_agent_relay.session.resume":
        return this.resumeSession(effectiveInput);
      case "acp_agent_relay.session.wake":
        return this.wakeSession(effectiveInput, context);
      case "acp_agent_relay.prompt.send":
        return this.sendPrompt(effectiveInput, context);
      case "acp_agent_relay.fs.read_text_file":
        return this.readTextFile(effectiveInput);
      case "acp_agent_relay.fs.write_text_file":
        return this.writeTextFile(effectiveInput);
      case "acp_agent_relay.session.cancel":
        return this.cancelSession(effectiveInput);
      case "acp_agent_relay.session.close":
        return this.closeSession(effectiveInput, context);
      case "acp_agent_relay.permission.resolve":
        return this.resolvePermission(effectiveInput, context);
      default:
        return operationResult(false, {}, { code: "unknown_operation", message: `Unknown ACP relay operation: ${operationId}` });
    }
  }

  async buildVirtualAgentCatalog(input = {}) {
    const agents = this.virtualAgentRegistry.listEnabled();
    const descriptors = [];
    for (const agent of agents) {
      const routeDecision = await this.router.resolveForSourceSession({
        ...input,
        virtualAgentId: agent.virtualAgentId,
        requestedMode: input.mode || input.requestedMode || input.promptMode || agent.defaultMode || "ask",
        prompt: asText(input.prompt)
      });
      if (routeDecision.ok) {
        descriptors.push(virtualAgentCapabilityDescriptor({
          agent,
          route: routeDecision.route
        }));
      } else {
        descriptors.push(virtualAgentCapabilityDescriptor({
          agent,
          target: this.targetRegistry.getTarget(agent.targetId),
          error: routeDecision.error
        }));
      }
    }
    return descriptors.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async upsertTarget(input = {}) {
    const targetInput = asObject(input.target || input.targetDescriptor || input);
    const targetId = asText(input.targetId || input.target_id || targetInput.targetId || targetInput.id);
    const virtualAgentInput = asObject(input.virtualAgent || input.virtualAgentDescriptor, null);
    if (nonEmptyObject(virtualAgentInput) && !asText(virtualAgentInput.virtualAgentId || virtualAgentInput.id)) {
      return operationResult(false, {}, {
        code: "virtual_agent_descriptor_invalid",
        message: "ACP target registration virtualAgent requires virtualAgentId."
      });
    }
    const registeredTarget = this.targetRegistry.upsertTarget({
      ...targetInput,
      targetId
    });
    if (!registeredTarget) {
      return operationResult(false, {}, {
        code: "target_descriptor_invalid",
        message: "ACP target registration requires targetId."
      });
    }

    const registeredVirtualAgent = nonEmptyObject(virtualAgentInput)
      ? this.virtualAgentRegistry.upsertAgent({
          ...virtualAgentInput,
          targetId: asText(virtualAgentInput.targetId, registeredTarget.targetId)
        })
      : null;

    return operationResult(true, {
      target: targetCapabilityDescriptor(registeredTarget),
      ...(registeredVirtualAgent
        ? {
            virtualAgent: registeredVirtualAgentDescriptor(registeredVirtualAgent, registeredTarget)
          }
        : {}),
      persisted: typeof this.targetRegistry.persist === "function"
    });
  }

  async upsertVirtualAgent(input = {}) {
    const agentInput = asObject(input.virtualAgent || input.virtualAgentDescriptor || input);
    const virtualAgentId = asText(input.virtualAgentId || input.virtual_agent_id || agentInput.virtualAgentId || agentInput.id);
    const targetId = asText(input.targetId || input.target_id || agentInput.targetId);
    if (!virtualAgentId) {
      return operationResult(false, {}, {
        code: "virtual_agent_descriptor_invalid",
        message: "ACP virtual-agent registration requires virtualAgentId."
      });
    }
    const target = this.targetRegistry.getTarget(targetId);
    if (!target) {
      return operationResult(false, {}, {
        code: "target_not_found",
        message: "ACP virtual-agent registration requires an existing target.",
        details: { targetId }
      });
    }
    const registeredVirtualAgent = this.virtualAgentRegistry.upsertAgent({
      ...agentInput,
      virtualAgentId,
      targetId
    });
    return operationResult(true, {
      virtualAgent: registeredVirtualAgentDescriptor(registeredVirtualAgent, target),
      target: targetCapabilityDescriptor(target),
      persisted: typeof this.virtualAgentRegistry.persist === "function"
    });
  }

  async refreshDownstreamClients(input = {}) {
    if (!this.downstreamClientAspect || typeof this.downstreamClientAspect.start !== "function") {
      return operationResult(false, {}, {
        code: "downstream_client_aspect_unavailable",
        message: "Downstream client aspect is not available for this ACP relay runtime."
      });
    }
    const nowText = asText(input.now || input.refreshedAt);
    const refreshInput = nowText ? { now: new Date(nowText) } : {};
    const summary = this.downstreamClientAspect.start(refreshInput);
    const protocolFilter = asText(input.protocol);
    const frameworkFilter = asText(input.frameworkId || input.framework_id);
    const capabilities = typeof this.downstreamClientAspect.listCapabilities === "function"
      ? this.downstreamClientAspect.listCapabilities({
          protocol: protocolFilter,
          frameworkId: frameworkFilter,
          includeUnavailable: input.includeUnavailable !== false
        })
      : [];
    const acpAssemblies = capabilities
      .filter((record) => !protocolFilter || asText(record.protocol) === protocolFilter)
      .map((record) => downstreamClientAssemblyDescriptor(record));
    const reconcile = this.reconcileDownstreamClientDescriptors({
      protocol: protocolFilter,
      frameworkId: frameworkFilter,
      disableMissing: input.reconcile !== false && input.disableMissing !== false
    });
    return operationResult(true, {
      summary,
      assemblies: acpAssemblies,
      assemblyCount: acpAssemblies.length,
      reconcile,
      targetCount: this.targetRegistry.listTargets().length,
      virtualAgentCount: this.virtualAgentRegistry.listAgents().length,
      registeredAcpRelayDescriptors: this.downstreamClientAspect.registerAcpRelayDescriptors !== false
    });
  }

  reconcileDownstreamClientDescriptors({ protocol = "", frameworkId = "", disableMissing = true } = {}) {
    if (!disableMissing || (protocol && protocol !== "acp")) {
      return {
        ok: true,
        disabledTargetIds: [],
        disabledVirtualAgentIds: [],
        currentTargetIds: [],
        currentVirtualAgentIds: [],
        disabled: false
      };
    }
    const currentTargetIds = new Set();
    const currentVirtualAgentIds = new Set();
    const records = typeof this.downstreamClientAspect?.listCapabilities === "function"
      ? this.downstreamClientAspect.listCapabilities({
          protocol: "acp",
          frameworkId,
          includeUnavailable: true
        })
      : [];
    for (const record of records) {
      const targetId = asText(record.acpRelay?.target?.targetId || record._internalAcpRelay?.target?.targetId);
      const virtualAgentId = asText(record.acpRelay?.virtualAgent?.virtualAgentId || record._internalAcpRelay?.virtualAgent?.virtualAgentId);
      if (targetId) {
        currentTargetIds.add(targetId);
      }
      if (virtualAgentId) {
        currentVirtualAgentIds.add(virtualAgentId);
      }
    }

    const disabledTargetIds = [];
    for (const target of this.targetRegistry.listTargets()) {
      if (
        isDownstreamAspectOwned(target) &&
        matchesDownstreamFramework(target, frameworkId) &&
        !currentTargetIds.has(target.targetId)
      ) {
        const disabled = typeof this.targetRegistry.disableTarget === "function"
          ? this.targetRegistry.disableTarget(target.targetId, "downstream_client_aspect_not_assembled")
          : null;
        if (disabled) {
          disabledTargetIds.push(target.targetId);
        }
      }
    }

    const disabledVirtualAgentIds = [];
    for (const agent of this.virtualAgentRegistry.listAgents()) {
      if (
        isDownstreamAspectOwned(agent) &&
        matchesDownstreamFramework(agent, frameworkId) &&
        !currentVirtualAgentIds.has(agent.virtualAgentId)
      ) {
        const disabled = typeof this.virtualAgentRegistry.disableAgent === "function"
          ? this.virtualAgentRegistry.disableAgent(agent.virtualAgentId, "downstream_client_aspect_not_assembled")
          : null;
        if (disabled) {
          disabledVirtualAgentIds.push(agent.virtualAgentId);
        }
      }
    }

    return {
      ok: true,
      disabled: true,
      disabledTargetIds,
      disabledVirtualAgentIds,
      currentTargetIds: [...currentTargetIds].sort(),
      currentVirtualAgentIds: [...currentVirtualAgentIds].sort()
    };
  }

  async listVirtualAgents(input = {}) {
    return operationResult(true, {
      virtualAgents: await this.buildVirtualAgentCatalog(input)
    });
  }

  async summarizeTurn(turn = {}, options = {}) {
    const permissionRequests = turn.relayTurnId
      ? await this.store.listPermissionRequests(turn.relayTurnId)
      : [];
    const pendingPermissionRequests = permissionRequests.filter((request) => asText(request.status) === "pending");
    const communicationSummary = asObject(turn.metadata?.result?.communicationSummary, null);
    const summary = {
      relayTurnId: asText(turn.relayTurnId),
      relaySessionId: asText(turn.relaySessionId),
      operationId: asText(turn.operationId),
      effectiveMode: asText(turn.effectiveMode),
      progressVisibility: asText(turn.progressVisibility),
      reasoningVisibility: turn.reasoningVisibility === true,
      status: asText(turn.status),
      stopReason: asText(turn.stopReason),
      startedAt: asText(turn.startedAt),
      updatedAt: asText(turn.updatedAt),
      completedAt: asText(turn.completedAt),
      idempotencyKey: asText(turn.idempotencyKey),
      globalAuditId: asText(turn.globalAuditId),
      artifactRef: asText(turn.artifactRef),
      pendingPermissionCount: pendingPermissionRequests.length,
      permissionRequestCount: permissionRequests.length,
      responseKind: responseKindFromCommunicationSummary(communicationSummary),
      communicationSummary
    };
    if (includePendingPermissionRequests(options)) {
      summary.pendingPermissionRequests = pendingPermissionRequests.map((request) => summarizePermissionRequestForSource(request));
    }
    return summary;
  }

  async summarizeSession(session = {}, options = {}) {
    const includeLatestTurn = options.includeLatestTurn !== false;
    const includePendingDetails = includePendingPermissionRequests(options);
    const turns = session.relaySessionId ? await this.store.listTurns(session.relaySessionId) : [];
    const turnSummaries = [];
    const pendingPermissionRequests = [];
    let pendingPermissionCount = 0;
    for (const turn of turns) {
      const summary = await this.summarizeTurn(turn, { includePendingPermissionRequests: includePendingDetails });
      pendingPermissionCount += summary.pendingPermissionCount;
      if (includePendingDetails && Array.isArray(summary.pendingPermissionRequests)) {
        pendingPermissionRequests.push(...summary.pendingPermissionRequests);
      }
      turnSummaries.push(summary);
    }
    const latestTurn = turnSummaries
      .sort((a, b) => asText(b.updatedAt || b.completedAt || b.startedAt).localeCompare(asText(a.updatedAt || a.completedAt || a.startedAt)))[0] || null;
    const summary = {
      relaySessionId: asText(session.relaySessionId),
      sourceId: asText(session.sourceId),
      sourceSessionId: asText(session.sourceSessionId),
      sourceSubjectId: asText(session.sourceSubjectId),
      workspaceId: asText(session.workspaceId),
      virtualAgentId: asText(session.virtualAgentId),
      targetId: asText(session.targetId),
      lifecycleState: asText(session.lifecycleState),
      wakePolicy: asText(session.wakePolicy),
      targetSessionId: asText(session.targetSessionId),
      targetResumeRef: asText(session.targetResumeRef),
      policyRevision: Number(session.policyRevision || 0),
      relayMcpGrantId: asText(session.relayMcpGrantId),
      lastOperationId: asText(session.lastOperationId),
      lastWokenAt: asText(session.lastWokenAt),
      createdAt: asText(session.createdAt),
      updatedAt: asText(session.updatedAt),
      pendingPermissionCount,
      turnCount: turnSummaries.length,
      lastWakeResult: summarizeWakeResult(session),
      latestTurn: includeLatestTurn ? latestTurn : null,
      capabilitiesSnapshot: asObject(session.capabilitiesSnapshot || session.metadata?.capabilitiesSnapshot, null)
    };
    if (includePendingDetails) {
      summary.pendingPermissionRequests = pendingPermissionRequests;
    }
    return summary;
  }

  async listSessions(input = {}) {
    const limit = Math.max(0, Math.min(Number(input.limit || 100) || 100, 500));
    const includePendingDetails = includePendingPermissionRequests(input);
    const sessions = (await this.store.listSessions())
      .filter((session) => sessionMatchesFilters(session, input))
      .sort((a, b) => asText(b.updatedAt || b.lastWokenAt || b.createdAt).localeCompare(asText(a.updatedAt || a.lastWokenAt || a.createdAt)))
      .slice(0, limit);
    return operationResult(true, {
      sessions: await Promise.all(sessions.map((session) => this.summarizeSession(session, {
        includePendingPermissionRequests: includePendingDetails
      }))),
      count: sessions.length,
      limit
    });
  }

  async getSession(input = {}) {
    const relaySessionId = asText(input.relaySessionId || input.sessionId || input.id);
    if (!relaySessionId) {
      return operationResult(false, {}, { code: "relay_session_id_required", message: "Relay session id is required." });
    }
    const session = await this.store.getSession(relaySessionId);
    if (!session || !sessionMatchesFilters(session, input)) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    const includePendingDetails = includePendingPermissionRequests(input);
    const turns = await this.store.listTurns(relaySessionId);
    return operationResult(true, {
      session: await this.summarizeSession(session, { includePendingPermissionRequests: includePendingDetails }),
      turns: await Promise.all(turns.map((turn) => this.summarizeTurn(turn, {
        includePendingPermissionRequests: includePendingDetails
      })))
    });
  }

  async listTurns(input = {}) {
    const relaySessionId = asText(input.relaySessionId || input.sessionId || input.id);
    if (!relaySessionId) {
      return operationResult(false, {}, { code: "relay_session_id_required", message: "Relay session id is required." });
    }
    const session = await this.store.getSession(relaySessionId);
    if (!session || !sessionMatchesFilters(session, input)) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    const limit = Math.max(0, Math.min(Number(input.limit || 100) || 100, 500));
    const includePendingDetails = includePendingPermissionRequests(input);
    const turns = (await this.store.listTurns(relaySessionId))
      .sort((a, b) => asText(b.updatedAt || b.completedAt || b.startedAt).localeCompare(asText(a.updatedAt || a.completedAt || a.startedAt)))
      .slice(0, limit);
    return operationResult(true, {
      relaySessionId,
      turns: await Promise.all(turns.map((turn) => this.summarizeTurn(turn, {
        includePendingPermissionRequests: includePendingDetails
      }))),
      count: turns.length,
      limit
    });
  }

  async observeTurn(input = {}, context = {}) {
    void context;
    const session = await this.resolveSession(input);
    if (!session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    const relayTurnId = asText(input.relayTurnId || input.turnId || input.turn_id);
    if (!relayTurnId) {
      return operationResult(false, {}, { code: "relay_turn_id_required", message: "Relay turn id is required." });
    }
    const turn = await this.store.getTurn(relayTurnId);
    if (!turn || asText(turn.relaySessionId) !== asText(session.relaySessionId)) {
      return operationResult(false, {}, { code: "relay_turn_not_found", message: "Relay turn not found." });
    }
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId
    });
    if (!routeDecision.ok) {
      return operationResult(false, { session }, routeDecision.error);
    }
    const route = routeDecision.route || {};
    const result = asObject(turn.metadata?.result);
    const targetEvidence = asObject(result.targetEvidence);
    if (!isAntigravityAgentApiTarget(route.target, targetEvidence)) {
      return operationResult(true, {
        session,
        turn: await this.summarizeTurn(turn, {
          includePendingPermissionRequests: includePendingPermissionRequests(input)
        }),
        observed: false,
        observationAvailable: false,
        reasonCode: "target_observation_unsupported",
        message: "Target observation refresh is currently implemented for Antigravity Agent API targets."
      });
    }
    const transport = asObject(route.target?.transport);
    if (transport.localObservationEnabled !== true) {
      return operationResult(true, {
        session,
        turn: await this.summarizeTurn(turn, {
          includePendingPermissionRequests: includePendingPermissionRequests(input)
        }),
        observed: false,
        observationAvailable: false,
        reasonCode: "target_local_observation_disabled",
        message: "Target local observation is disabled by target configuration."
      });
    }
    const previousLocalObservation = asObject(targetEvidence.localConversationObservation, null);
    const conversationId = asText(
      input.conversationId ||
        targetEvidence.targetSessionId ||
        session.targetSessionId ||
        targetEvidence.targetResumeRef ||
        session.targetResumeRef ||
        transport.conversationId ||
        transport.recipientId
    );
    if (!conversationId) {
      return operationResult(false, {}, {
        code: "target_conversation_id_required",
        message: "Target conversation id is required before observing a relay turn."
      });
    }
    const observationInput = {
      conversationId,
      brainRoot: asText(transport.localObservationBrainRoot || input.brainRoot),
      marker: asText(input.observationMarker || input.marker),
      afterTranscriptLineCount: Number(
        input.afterTranscriptLineCount ??
          previousLocalObservation?.afterTranscriptLineCount ??
          0
      ) || 0,
      afterMessageMtimeMs: Number(
        input.afterMessageMtimeMs ??
          previousLocalObservation?.afterMessageMtimeMs ??
          0
      ) || 0,
      maxTranscriptEntries: Number(input.maxTranscriptEntries || 0) || 0,
      maxMessageEntries: Number(input.maxMessageEntries || 0) || 0
    };
    const wait = input.wait === true || input.waitForObservation === true || input.waitForFinalResponse === true;
    const until = asText(
      input.until ||
        input.waitUntil ||
        (input.waitForFinalResponse === true ? "final" : "progress"),
      "progress"
    );
    const observation = wait
      ? await waitForAntigravityConversationObservation({
          ...observationInput,
          until,
          timeoutMs: Number(input.timeoutMs || input.observationTimeoutMs || transport.localObservationTimeoutMs || 12000) || 12000,
          pollIntervalMs: Number(input.pollIntervalMs || input.observationPollIntervalMs || transport.localObservationPollIntervalMs || 1000) || 1000
        })
      : await observeAntigravityConversation(observationInput);
    const targetObservation = redactedAntigravityObservation(observation);
    const fingerprint = antigravityObservationFingerprint(targetObservation);
    const previousFingerprint = asText(turn.metadata?.observationRefresh?.fingerprint);
    const targetError = observation?.errorAvailable === true || observation?.knownErrorAvailable === true
      ? {
          code: "antigravity_transcript_error",
          message: asText(
            targetObservation?.latestKnownError?.errorPreview ||
              targetObservation?.latestError?.errorPreview ||
              "Antigravity transcript reported an error for the delegated prompt."
          ),
          provider: "antigravity-local-observation",
          conversationId
        }
      : asObject(targetEvidence.targetError, null);
    const finalObserved = targetObservation?.finalResponseAvailable === true;
    const progressObserved = targetObservation?.progressAvailable === true || targetObservation?.transcriptAdvanced === true;
    const observedStopReason = targetError
      ? "target_error"
      : finalObserved
        ? "completed"
        : asText(result.stopReason || turn.stopReason || "accepted");
    const outputSummary = targetError
      ? targetError.message
      : finalObserved
        ? asText(
            targetObservation?.latestFinalResponse?.textPreview,
            "Antigravity local observation exposed a final target response."
          )
        : progressObserved
          ? asText(
              targetObservation?.latestProgress?.textPreview,
              result.outputSummary || "Antigravity local observation detected target progress."
            )
          : asText(result.outputSummary || outputSummaryFromEvents(await this.store.listEvents(turn.relayTurnId)));
    const audit = auditFromTurn(turn, session);
    const nextTargetEvidence = {
      ...targetEvidence,
      targetSessionId: asText(targetEvidence.targetSessionId || session.targetSessionId || conversationId),
      targetResumeRef: asText(targetEvidence.targetResumeRef || session.targetResumeRef || conversationId),
      externalCompletionState: targetError
        ? "target_error"
        : finalObserved
          ? "completed"
          : asText(targetEvidence.externalCompletionState || "accepted_only"),
      finalResponseAvailable: targetEvidence.finalResponseAvailable === true || finalObserved,
      finalResponsePolicy: targetError
        ? "target_error"
        : finalObserved
          ? "local_conversation_observation"
          : asText(targetEvidence.finalResponsePolicy || "accepted_only"),
      targetError,
      localConversationObservation: targetObservation,
      localObservationError: "",
      globalAuditId: audit.globalAuditId,
      artifactRef: audit.artifactRef,
      relayTurnId: audit.relayTurnId,
      policyRevision: audit.policyRevision,
      relayMcpGrantId: audit.relayMcpGrantId
    };
    const eventChanged = fingerprint && fingerprint !== previousFingerprint;
    if (eventChanged) {
      const event = targetError
        ? this.eventNormalizer.completion({ stopReason: "target_error", outputSummary, receipts: [] })
        : finalObserved
          ? this.eventNormalizer.completion({ stopReason: "completed", outputSummary, receipts: [] })
          : this.eventNormalizer.progress({ phase: "target_observation", text: outputSummary });
      await this.store.recordEvent(turn.relayTurnId, withAuditEvidence({
        ...event,
        source: "operation",
        operationId: "acp_agent_relay.turn.observe"
      }, audit));
    }
    const events = await this.store.listEvents(turn.relayTurnId);
    const receipts = Array.isArray(result.receipts) ? result.receipts : receiptsFromEvents(events);
    const pendingPermissionRequests = (await this.store.listPermissionRequests(turn.relayTurnId))
      .filter((request) => request.status === "pending");
    const communicationSummary = buildCommunicationSummary({
      session,
      turn: {
        ...turn,
        status: "completed",
        stopReason: observedStopReason
      },
      events,
      receipts,
      pendingPermissionRequests,
      stopReason: observedStopReason,
      outputSummary,
      audit,
      targetEvidence: nextTargetEvidence
    });
    const updatedTurn = await this.store.updateTurn(turn.relayTurnId, {
      status: targetError || finalObserved ? "completed" : turn.status,
      stopReason: targetError || finalObserved ? observedStopReason : turn.stopReason,
      completedAt: targetError || finalObserved ? asText(turn.completedAt || nowIso()) : turn.completedAt,
      metadata: {
        ...asObject(turn.metadata),
        observationRefresh: {
          provider: "antigravity-local-observation",
          fingerprint,
          refreshedAt: nowIso(),
          observedFinalResponse: finalObserved,
          observedError: Boolean(targetError)
        },
        result: {
          ...result,
          stopReason: targetError || finalObserved ? observedStopReason : asText(result.stopReason || turn.stopReason),
          outputSummary,
          receipts,
          targetEvidence: nextTargetEvidence,
          pendingPermissionRequestIds: pendingPermissionRequests.map((request) => request.requestId),
          communicationSummary
        }
      }
    });
    return operationResult(true, {
      session,
      turn: updatedTurn,
      turnSummary: await this.summarizeTurn(updatedTurn),
      events,
      observed: true,
      refreshed: eventChanged,
      targetObservation,
      targetEvidence: nextTargetEvidence,
      stopReason: communicationSummary.stopReason,
      outputSummary,
      responseKind: responseKindFromCommunicationSummary(communicationSummary),
      communicationSummary
    });
  }

  async initializeVirtualAgent(input = {}) {
    const virtualAgentId = asText(input.virtualAgentId || input.id);
    const agent = this.virtualAgentRegistry.getAgent(virtualAgentId);
    if (!agent || agent.enabled === false) {
      return operationResult(false, {}, { code: "virtual_agent_unavailable", message: "Virtual agent is unavailable." });
    }
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      virtualAgentId,
      requestedMode: input.mode || input.requestedMode || input.promptMode || undefined
    });
    if (!routeDecision.ok) {
      return operationResult(false, {}, routeDecision.error);
    }
    const capabilitiesSnapshot = virtualAgentCapabilityDescriptor({
      agent,
      route: routeDecision.route
    });
    return operationResult(true, {
      virtualAgent: capabilitiesSnapshot,
      capabilities: capabilitiesSnapshot.capabilities,
      capabilitiesSnapshot,
      virtualAgents: await this.buildVirtualAgentCatalog(input),
      route: sourceRouteSummary(routeDecision.route)
    });
  }

  async createSession(input = {}, context = {}) {
    void context;
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      requestedMode: input.mode || input.requestedMode || input.promptMode || undefined
    });
    if (!routeDecision.ok) {
      return operationResult(false, {}, routeDecision.error);
    }
    const { route } = routeDecision;
    const capabilitiesSnapshot = virtualAgentCapabilityDescriptor({
      agent: route.virtualAgent,
      route
    });
    let session = await this.store.createSession({
      ...input,
      sourceId: asText(input.sourceId, "source.agent"),
      sourceSessionId: asText(input.sourceSessionId || input.sessionId, `source_${Date.now()}`),
      virtualAgentId: route.virtualAgent.virtualAgentId,
      targetId: route.target.targetId,
      workspaceId: route.workspaceId,
      sourceSubjectId: route.sourceSubjectId,
      policyRevision: route.policyRevision,
      lifecycleState: "dormant",
      relayMcpGrantId: randomId("relay_mcp"),
      capabilitiesSnapshot,
      metadata: {
        capabilitiesSnapshot,
        ...(Object.keys(asObject(input.sourceAuthContext)).length > 0
          ? { sourceAuthContext: asObject(input.sourceAuthContext) }
          : {})
      }
    });
    if (!asObject(session.capabilitiesSnapshot || session.metadata?.capabilitiesSnapshot, null)) {
      session = await this.store.updateSession(session.relaySessionId, {
        capabilitiesSnapshot,
        metadata: {
          ...asObject(session.metadata),
          capabilitiesSnapshot
        }
      });
    }
    return operationResult(true, {
      session,
      route: sourceRouteSummary(route),
      capabilities: capabilitiesSnapshot.capabilities,
      capabilitiesSnapshot
    });
  }

  sessionRouteInput(session = {}, input = {}) {
    return {
      ...input,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId,
      sourceSubjectId: session.sourceSubjectId,
      requestedMode: input.mode || input.requestedMode || input.promptMode || undefined
    };
  }

  async resolveCurrentSessionRoute(session = {}, input = {}) {
    return this.router.resolveForSourceSession(this.sessionRouteInput(session, input));
  }

  async capabilitySnapshotForSession(session = {}, input = {}, options = {}) {
    const refreshPolicy = options.refreshPolicy === true;
    const persistedSnapshot = asObject(session.capabilitiesSnapshot || session.metadata?.capabilitiesSnapshot, null);
    if (persistedSnapshot && !refreshPolicy) {
      return persistedSnapshot;
    }
    const agent = this.virtualAgentRegistry.getAgent(session.virtualAgentId);
    if (!agent) {
      return persistedSnapshot || null;
    }
    const routeDecision = await this.resolveCurrentSessionRoute(session, input);
    if (routeDecision.ok) {
      return virtualAgentCapabilityDescriptor({
        agent,
        route: routeDecision.route
      });
    }
    return virtualAgentCapabilityDescriptor({
      agent,
      target: this.targetRegistry.getTarget(agent.targetId),
      error: routeDecision.error
    });
  }

  async resumeSession(input = {}) {
    const session = await this.resolveSession(input);
    if (!session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    if (isClosedSession(session)) {
      return operationResult(false, { session }, closedSessionError(session));
    }
    const routeDecision = await this.resolveCurrentSessionRoute(session, input);
    if (!routeDecision.ok) {
      const blocked = await this.store.updateSession(session.relaySessionId, {
        lifecycleState: "blocked",
        metadata: {
          ...asObject(session.metadata),
          lastResumeResult: {
            ok: false,
            code: asText(routeDecision.error?.code || routeDecision.error?.reasonCode || "route_unavailable"),
            message: asText(routeDecision.error?.message || "Current route policy does not allow this session to resume."),
            checkedAt: nowIso(),
            policyRevision: session.policyRevision
          }
        }
      });
      return operationResult(false, { session: blocked || session }, {
        ...asObject(routeDecision.error),
        details: {
          ...asObject(routeDecision.error?.details),
          relaySessionId: session.relaySessionId,
          lifecycleState: "blocked",
          policyRevision: session.policyRevision
        }
      });
    }
	    const capabilitiesSnapshot = virtualAgentCapabilityDescriptor({
	      agent: routeDecision.route.virtualAgent,
	      route: routeDecision.route
	    });
	    const pendingPermissionRequests = await this.listPendingPermissionRequestsForSession(session);
	    const nextLifecycleState = pendingPermissionRequests.length > 0 || session.lifecycleState === "approval_pending"
	      ? "approval_pending"
	      : "dormant";
	    const resumed = await this.store.updateSession(session.relaySessionId, {
	      lifecycleState: nextLifecycleState,
	      policyRevision: routeDecision.route.policyRevision,
	      capabilitiesSnapshot,
      metadata: {
        ...asObject(session.metadata),
        capabilitiesSnapshot,
        lastResumeResult: {
          ok: true,
          checkedAt: nowIso(),
          policyRevision: routeDecision.route.policyRevision,
          targetId: asText(routeDecision.route.target?.targetId),
          targetSessionId: asText(session.targetSessionId),
          targetResumeRef: asText(session.targetResumeRef)
        }
      }
    });
	    return operationResult(true, {
	      session: resumed,
	      capabilities: capabilitiesSnapshot?.capabilities || null,
	      capabilitiesSnapshot,
	      pendingPermissionRequests,
	      route: sourceRouteSummary(routeDecision.route)
	    });
  }

  async resolveSessionRoute(input = {}) {
    const session = await this.resolveSession(input);
    if (!session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    if (isClosedSession(session)) {
      return operationResult(false, { session }, closedSessionError(session));
    }
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId
    });
    if (!routeDecision.ok) {
      const blocked = await this.store.updateSession(session.relaySessionId, { lifecycleState: "blocked" });
      return operationResult(false, { session: blocked }, routeDecision.error);
    }
    return operationResult(true, { session, route: routeDecision.route });
  }

  async wakeSession(input = {}, context = {}) {
    const routed = await this.resolveSessionRoute(input);
    if (!routed.ok) {
      return routed;
    }
    let { session, route } = routed.data;
    const relayMcp = await this.ensureRelayMcpGrant({ input, session, route, context });
    if (!relayMcp.ok) {
      return relayMcp;
    }
    session = relayMcp.session || session;
    const targetRelaySession = relayMcp.relaySession || session;
    const previousLifecycleState = asText(session.lifecycleState, "dormant");
    const failureLifecycleState = previousLifecycleState === "waking" ? "dormant" : previousLifecycleState;
    await this.store.updateSession(session.relaySessionId, { lifecycleState: "waking" });
    let wake;
    try {
      wake = await this.sessionDriver.wake({
        target: route.target,
        relaySession: targetRelaySession,
        route
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Target ACP wake failed.");
      const code = asText(error?.code, "target_wake_failed");
      const failedSession = await this.store.updateSession(session.relaySessionId, {
        lifecycleState: failureLifecycleState,
        metadata: {
            ...asObject(session.metadata),
            lastWakeResult: {
            ok: false,
            code,
            message,
            targetSessionId: asText(session.targetSessionId),
            targetResumeRef: asText(session.targetResumeRef),
            wokenAt: nowIso(),
            transportType: asText(route.target?.transport?.type),
            finalResponsePolicy: targetFinalResponseCapability(route.target).policy
          }
        }
      });
      return operationResult(false, { session: failedSession, route: sourceRouteSummary(route) }, {
        code,
        message,
        details: {
          reasonCode: code,
          relaySessionId: session.relaySessionId,
          lifecycleState: failedSession?.lifecycleState || failureLifecycleState
        }
      });
    }
    if (wake?.ok === false) {
      const code = asText(wake.errorCode || wake.code, "target_wake_failed");
      const message = asText(wake.errorMessage || wake.message || wake.error, "Target ACP wake failed.");
      const failedSession = await this.store.updateSession(session.relaySessionId, {
        lifecycleState: failureLifecycleState,
        metadata: {
          ...asObject(session.metadata),
          lastWakeResult: {
            ok: false,
            code,
            message,
            targetSessionId: asText(session.targetSessionId),
            targetResumeRef: asText(session.targetResumeRef),
            wokenAt: asText(wake.wokenAt || nowIso()),
            transportType: asText(route.target?.transport?.type),
            finalResponsePolicy: targetFinalResponseCapability(route.target).policy
          }
        }
      });
      return operationResult(false, { session: failedSession, wake: { ...wake, connection: undefined }, route: sourceRouteSummary(route) }, {
        code,
        message,
        details: {
          reasonCode: code,
          relaySessionId: session.relaySessionId,
          lifecycleState: failedSession?.lifecycleState || failureLifecycleState
        }
      });
    }
    const updated = await this.store.updateSession(session.relaySessionId, {
      lifecycleState: "active",
      targetSessionId: wake.targetSessionId,
      targetResumeRef: wake.targetResumeRef,
      policyRevision: route.policyRevision,
      lastWokenAt: wake.wokenAt,
      metadata: {
        ...asObject(session.metadata),
        lastWakeResult: {
          ok: wake.ok !== false,
          targetSessionId: asText(wake.targetSessionId),
          targetResumeRef: asText(wake.targetResumeRef),
          wokenAt: asText(wake.wokenAt),
          transportType: asText(route.target?.transport?.type),
          finalResponsePolicy: targetFinalResponseCapability(route.target).policy
        }
      }
    });
    return operationResult(true, { session: updated, wake: { ...wake, connection: undefined }, route: sourceRouteSummary(route) });
  }

  async resolveSourceFileRoute(input = {}) {
    const session = await this.resolveSession(input);
    if (hasDirectSessionId(input) && !session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    if (session && isClosedSession(session)) {
      return operationResult(false, { session }, closedSessionError(session));
    }
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      sourceId: session?.sourceId || input.sourceId,
      sourceSessionId: session?.sourceSessionId || input.sourceSessionId,
      virtualAgentId: session?.virtualAgentId || input.virtualAgentId,
      workspaceId: session?.workspaceId || input.workspaceId,
      sourceSubjectId: session?.sourceSubjectId || input.sourceSubjectId
    });
    if (!routeDecision.ok) {
      return operationResult(false, { session }, routeDecision.error);
    }
    return operationResult(true, { session, route: routeDecision.route });
  }

  async readTextFile(input = {}) {
    const routed = await this.resolveSourceFileRoute(input);
    if (!routed.ok) {
      return routed;
    }
    const route = routed.data.route || {};
    const tools = Array.isArray(route.decision?.advertisedTools) ? route.decision.advertisedTools : [];
    if (!tools.includes("fs.readTextFile") && !tools.includes("fs/read_text_file")) {
      return operationResult(false, {}, {
        code: "source_fs_read_not_advertised",
        message: "Source-facing ACP file read is not allowed for this virtual agent.",
        details: {
          reasonCode: "source_fs_read_not_advertised",
          virtualAgentId: route.virtualAgent?.virtualAgentId || ""
        }
      });
    }
    const path = sanitizeFsPath(input.path || input.uri || input.filePath);
    const receipt = await this.permissionBridge.readTextFile({ path }).catch((error) => ({
      ok: false,
      status: "denied",
      action: "fs.readTextFile",
      reasonCode: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path
    }));
    if (!receipt.ok) {
      return operationResult(false, { receipt }, {
        code: receipt.reasonCode || "source_fs_read_denied",
        message: "Source-facing ACP file read was denied.",
        details: { receipt }
      });
    }
    return operationResult(true, {
      content: receipt.content,
      path: receipt.path,
      digest: receipt.digest,
      receipt: {
        ok: true,
        status: "completed",
        action: receipt.action,
        path: receipt.path,
        digest: receipt.digest
      },
      session: routed.data.session || null
    });
  }

  async writeTextFile(input = {}) {
    const routed = await this.resolveSourceFileRoute(input);
    if (!routed.ok) {
      return routed;
    }
    const route = routed.data.route || {};
    const tools = Array.isArray(route.decision?.advertisedTools) ? route.decision.advertisedTools : [];
    if (!tools.includes("fs.writeTextFile") && !tools.includes("fs/write_text_file")) {
      return operationResult(false, {}, {
        code: "source_fs_write_not_advertised",
        message: "Source-facing ACP file write is not allowed for this virtual agent.",
        details: {
          reasonCode: "source_fs_write_not_advertised",
          virtualAgentId: route.virtualAgent?.virtualAgentId || ""
        }
      });
    }
    const receipt = await this.permissionBridge.requestWriteTextFile({
      route,
      write: {
        path: sanitizeFsPath(input.path || input.uri || input.filePath),
        content: String(input.content ?? input.text ?? "")
      },
      approval: asObject(input.approval)
    });
    if (!receipt.ok) {
      return operationResult(false, { receipt }, {
        code: receipt.reasonCode || "source_fs_write_denied",
        message: "Source-facing ACP file write was denied.",
        details: { receipt }
      });
    }
    return operationResult(true, {
      ok: true,
      path: receipt.path,
      receipt,
      session: routed.data.session || null
    });
  }

  async sendPrompt(input = {}, context = {}) {
    const idempotencyKey = asText(input.idempotencyKey);
    const existingSession = await this.resolveSession(input);
    if (existingSession) {
      const relaySessionId = existingSession.relaySessionId;
      const queuedCancelGeneration = this.sessionCancelGeneration(relaySessionId);
      return this.withSessionPromptLock(relaySessionId, () => {
        if (this.sessionCancelGeneration(relaySessionId) !== queuedCancelGeneration) {
          return this.cancelQueuedPrompt({ ...input, relaySessionId }, existingSession);
        }
        if (!idempotencyKey) {
          return this.sendPromptOnce({ ...input, relaySessionId }, context);
        }
        return this.withIdempotencyLock(
          `${relaySessionId}::${idempotencyKey}`,
          () => this.sendPromptOnce({ ...input, relaySessionId }, context)
        );
      });
    }
    return this.sendPromptOnce(input, context);
  }

  sessionCancelGeneration(relaySessionId = "") {
    return Number(this.sessionCancelGenerations.get(asText(relaySessionId)) || 0);
  }

  advanceSessionCancelGeneration(relaySessionId = "") {
    const key = asText(relaySessionId);
    if (!key) {
      return 0;
    }
    const next = this.sessionCancelGeneration(key) + 1;
    this.sessionCancelGenerations.set(key, next);
    return next;
  }

  async withSessionPromptLock(relaySessionId = "", run) {
    const lockKey = asText(relaySessionId);
    if (!lockKey) {
      return run();
    }
    const previous = this.sessionPromptLocks.get(lockKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(run).finally(() => {
      if (this.sessionPromptLocks.get(lockKey) === current) {
        this.sessionPromptLocks.delete(lockKey);
      }
    });
    this.sessionPromptLocks.set(lockKey, current);
    return current;
  }

	  async withIdempotencyLock(lockKey, run) {
	    const previous = this.idempotencyLocks.get(lockKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(run).finally(() => {
      if (this.idempotencyLocks.get(lockKey) === current) {
        this.idempotencyLocks.delete(lockKey);
      }
    });
	    this.idempotencyLocks.set(lockKey, current);
	    return current;
	  }
	
	  async withPermissionResolveLock(lockKey, run) {
	    const key = asText(lockKey);
	    if (!key) {
	      return run();
	    }
	    const previous = this.permissionResolveLocks.get(key) || Promise.resolve();
	    const current = previous.catch(() => {}).then(run).finally(() => {
	      if (this.permissionResolveLocks.get(key) === current) {
	        this.permissionResolveLocks.delete(key);
	      }
	    });
	    this.permissionResolveLocks.set(key, current);
	    return current;
	  }

  async cancelQueuedPrompt(input = {}, session = {}) {
    const promptText = asText(input.prompt || input.text || input.message);
    const idempotencyKey = asText(input.idempotencyKey);
    const routed = await this.resolveSessionRoute(input);
    if (!routed.ok) {
      return routed;
    }
    const route = routed.data.route || {};
    const relaySession = routed.data.session || session;
    const turn = await this.store.createTurn({
      relaySessionId: relaySession.relaySessionId,
      operationId: asText(input.operationId, "acp_agent_relay.prompt.send"),
      promptFingerprint: route.turnFingerprint,
      effectiveMode: route.effectiveMode,
      reasoningVisibility: route.decision?.reasoningAllowed === true,
      status: "cancelled",
      stopReason: "cancelled",
      completedAt: nowIso(),
      idempotencyKey,
      metadata: idempotencyKey
        ? {
            idempotency: {
              key: idempotencyKey,
              promptHash: sha256Text(promptText),
              requestFingerprint: promptRequestFingerprint(input, promptText),
              requestedMode: asText(input.requestedMode),
              createdAt: nowIso()
            }
          }
        : {}
    });
    const audit = createAuditEvidence({ input, session: relaySession, turn, route });
    const cancelledAt = asText(turn.completedAt, nowIso());
    const receipt = {
      ok: true,
      status: "cancelled",
      action: "session.cancel",
      reasonCode: "source_session_cancelled_before_target_prompt",
      relaySessionId: relaySession.relaySessionId,
      targetSessionId: asText(relaySession.targetSessionId),
      cancelledAt
    };
    const outputSummary = "Relay turn was cancelled by the source agent before it reached the target.";
    const targetEvidence = buildTargetEvidence({
      route,
      session: relaySession,
      promptResult: {
        stopReason: "cancelled",
        text: outputSummary,
        targetSessionId: relaySession.targetSessionId,
        targetResumeRef: relaySession.targetResumeRef
      },
      audit
    });
    let cancelledTurn = await this.store.updateTurn(turn.relayTurnId, {
      globalAuditId: audit.globalAuditId,
      artifactRef: audit.artifactRef,
      status: "cancelled",
      stopReason: "cancelled",
      completedAt: cancelledAt,
      metadata: {
        ...asObject(turn.metadata),
        audit,
        cancellation: {
          cancelledAt,
          source: "source_session_cancel_queue",
          generation: this.sessionCancelGeneration(relaySession.relaySessionId)
        },
        result: {
          stopReason: "cancelled",
          outputSummary,
          receipts: [receipt],
          targetEvidence
        }
      }
    });
    await this.store.recordEvent(
      turn.relayTurnId,
      withAuditEvidence(this.eventNormalizer.receipt(receipt, "operation"), audit)
    );
    await this.store.recordEvent(
      turn.relayTurnId,
      withAuditEvidence(
        {
          ...this.eventNormalizer.completion({
            stopReason: "cancelled",
            outputSummary,
            receipts: [receipt]
          }),
          source: "operation"
        },
        audit
      )
    );
    const cancelledEvents = await this.store.listEvents(turn.relayTurnId);
    const communicationSummary = buildCommunicationSummary({
      session: relaySession,
      turn: cancelledTurn,
      events: cancelledEvents,
      receipts: [receipt],
      pendingPermissionRequests: [],
      stopReason: "cancelled",
      outputSummary,
      audit,
      targetEvidence
    });
    cancelledTurn = await this.store.updateTurn(turn.relayTurnId, {
      metadata: {
        ...asObject(cancelledTurn.metadata),
        result: {
          ...asObject(cancelledTurn.metadata?.result),
          communicationSummary
        }
      }
    });
    return operationResult(true, {
      session: relaySession,
      turn: cancelledTurn,
      events: cancelledEvents,
      receipts: [receipt],
      pendingPermissionRequests: [],
      stopReason: "cancelled",
      outputSummary,
      audit,
      targetEvidence,
      responseKind: responseKindFromCommunicationSummary(communicationSummary),
      communicationSummary
    });
  }

  async sendPromptOnce(input = {}, context = {}) {
    const promptText = asText(input.prompt || input.text || input.message);
    const idempotencyKey = asText(input.idempotencyKey);
    const requestFingerprint = promptRequestFingerprint(input, promptText);
    if (idempotencyKey) {
      const existingSession = await this.resolveSession(input);
      if (existingSession) {
        const existingTurn = await this.store.getTurnByIdempotencyKey?.(existingSession.relaySessionId, idempotencyKey);
        if (existingTurn) {
          const existingRequest = asObject(existingTurn.metadata?.idempotency);
          const conflict = asText(existingRequest.requestFingerprint)
            ? existingRequest.requestFingerprint !== requestFingerprint
            : asText(existingRequest.promptText) && asText(existingRequest.promptText) !== promptText;
          if (conflict) {
            return operationResult(false, {}, {
              code: "idempotency_key_conflict",
              message: "Idempotency key was already used for a different prompt or side effect.",
              details: {
                relaySessionId: existingSession.relaySessionId,
                idempotencyKey
              }
            });
          }
          return operationResult(true, await this.restorePromptResultFromTurn(existingTurn, existingSession));
        }
      }
    }
    const routed = await this.resolveSessionRoute(input);
    if (!routed.ok) {
      return routed;
    }
    const { session, route } = routed.data;
    const turn = await this.store.createTurn({
      relaySessionId: session.relaySessionId,
      operationId: asText(input.operationId, "acp_agent_relay.prompt.send"),
      promptFingerprint: route.turnFingerprint,
      effectiveMode: route.effectiveMode,
      reasoningVisibility: route.decision.reasoningAllowed,
      status: "running",
      idempotencyKey,
      metadata: idempotencyKey
        ? {
            idempotency: {
              key: idempotencyKey,
              promptHash: sha256Text(promptText),
              requestFingerprint,
              requestedMode: asText(input.requestedMode),
              createdAt: nowIso()
            }
          }
        : {}
    });
    const audit = createAuditEvidence({ input, session, turn, route });
    const promptRef = sensitivePayloadRef("prompt", turn.relayTurnId);
    const promptHash = sha256Text(promptText);
	    await this.rememberSensitivePayload(promptRef, {
      kind: "prompt",
      relayTurnId: turn.relayTurnId,
      promptText
    });
    await this.store.updateTurn(turn.relayTurnId, {
      globalAuditId: audit.globalAuditId,
      artifactRef: audit.artifactRef,
      metadata: {
        ...asObject(turn.metadata),
        audit
      }
    });
    await this.store.recordEvent(
      turn.relayTurnId,
      withAuditEvidence(this.eventNormalizer.progress({ phase: "accepted", text: "Relay turn accepted." }), audit)
    );

    const receipts = [];
    const pendingRequests = [];
    if (input.terminal || input.command) {
      const denial = this.permissionBridge.denyTerminal({ command: input.command || input.terminal?.command || "" });
      await this.store.recordEvent(turn.relayTurnId, withAuditEvidence(this.eventNormalizer.denial(denial, "permission"), audit));
      receipts.push(denial);
    }
    for (const write of Array.isArray(input.fileWrites) ? input.fileWrites : []) {
      if (pathDenied(asText(write.path))) {
        const denial = { ok: false, status: "denied", action: "fs.writeTextFile", reasonCode: "path_denied", path: asText(write.path) };
        await this.store.recordEvent(turn.relayTurnId, withAuditEvidence(this.eventNormalizer.denial(denial, "permission"), audit));
        receipts.push(denial);
      } else {
        const receipt = await this.permissionBridge.requestWriteTextFile({
          route,
          write,
          approval: asObject(write.approval || input.approval)
        });
        if (receipt.status === "pending_approval") {
          const requestId = randomId("relay_perm");
          const content = String(write.content ?? "");
          const contentRef = sensitivePayloadRef("write-content", requestId);
	          await this.rememberSensitivePayload(contentRef, {
            kind: "write-content",
            requestId,
            relayTurnId: turn.relayTurnId,
            content,
            promptRef
          });
          const pendingRequest = await this.store.createPermissionRequest({
            requestId,
            relayTurnId: turn.relayTurnId,
            targetToolCallId: asText(write.toolCallId || write.id),
            requestedAction: "fs.writeTextFile",
            risk: route.decision?.maxRisk || "repair_write",
            status: "pending",
            pendingOperationId: "acp_agent_relay.permission.resolve",
            details: {
              relaySessionId: session.relaySessionId,
              action: "fs.writeTextFile",
              path: receipt.path,
              contentHash: sha256Text(content),
              contentRef,
              payloadHash: receipt.payloadHash,
              promptHash,
              promptRef,
              requestReasoning: input.requestReasoning === true,
              receipt
            }
          });
          receipt.requestId = pendingRequest.requestId;
          pendingRequests.push(pendingRequest);
        }
        await this.store.recordEvent(
          turn.relayTurnId,
          withAuditEvidence(
            receipt.ok ? this.eventNormalizer.receipt(receipt, "permission") : this.eventNormalizer.denial(receipt, "permission"),
            audit
          )
        );
        receipts.push(receipt);
      }
    }

    if (pendingRequests.length > 0) {
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(this.eventNormalizer.progress({ phase: "approval_pending", text: "Relay turn is waiting for approval." }), audit)
      );
      const updatedSession = await this.store.updateSession(session.relaySessionId, {
        lifecycleState: "approval_pending",
        policyRevision: route.policyRevision
      });
      const pendingTargetEvidence = buildTargetEvidence({ route, session: updatedSession || session, promptResult: {}, audit });
      const pendingOutputSummary = "Relay turn is waiting for approval.";
      const pendingEvents = await this.store.listEvents(turn.relayTurnId);
      const communicationSummary = buildCommunicationSummary({
        session: updatedSession || session,
        turn: {
          ...turn,
          status: "approval_pending",
          stopReason: "approval_pending"
        },
        events: pendingEvents,
        receipts,
        pendingPermissionRequests: pendingRequests,
        stopReason: "approval_pending",
        outputSummary: pendingOutputSummary,
        audit,
        targetEvidence: pendingTargetEvidence
      });
      const pendingTurn = await this.store.updateTurn(turn.relayTurnId, {
        status: "approval_pending",
        stopReason: "approval_pending",
        metadata: {
          ...asObject(turn.metadata),
          audit,
          pendingPrompt: {
            promptHash,
            promptRef,
            requestReasoning: input.requestReasoning === true,
            localObservationMarker: asText(input.localObservationMarker || input.observationMarker || input.marker),
            receipts,
            route: {
              virtualAgentId: route.virtualAgent?.virtualAgentId || "",
              targetId: route.target?.targetId || "",
              effectiveMode: route.effectiveMode || "",
              policyRevision: route.policyRevision,
              decision: route.decision || {}
            },
            pendingRequestIds: pendingRequests.map((request) => request.requestId)
          },
          result: {
            stopReason: "approval_pending",
            outputSummary: pendingOutputSummary,
            receipts,
            targetEvidence: pendingTargetEvidence,
            pendingPermissionRequestIds: pendingRequests.map((request) => request.requestId),
            communicationSummary
          }
        }
      });
      return operationResult(true, {
        session: updatedSession || session,
        turn: pendingTurn,
        events: pendingEvents,
        receipts,
        pendingPermissionRequests: pendingRequests,
        stopReason: "approval_pending",
        outputSummary: pendingOutputSummary,
        audit,
        targetEvidence: pendingTargetEvidence,
        responseKind: responseKindFromCommunicationSummary(communicationSummary),
        communicationSummary
      });
    }

    return operationResult(true, await this.finishPromptWithTarget({
      session,
      route,
      turn,
      audit,
      promptText,
      requestReasoning: input.requestReasoning === true,
      localObservationMarker: asText(input.localObservationMarker || input.observationMarker || input.marker),
      receipts,
      input,
      context
    }));
  }

  async recordTargetAcpCallbackReceipt({
    request = {},
    receipt = {},
    route = {},
    session = {},
    turn = {},
    audit = {},
    action = ""
  } = {}) {
    const params = targetRequestParams(request);
    const safeReceipt = auditSafeTargetReceipt(receipt);
    const status = safeReceipt.status === "pending_approval"
      ? "pending"
      : safeReceipt.ok === true
        ? "completed"
        : "denied";
    const permissionRequest = await this.store.createPermissionRequest({
      requestId: randomId("relay_perm"),
      relayTurnId: turn.relayTurnId,
      targetToolCallId: targetRequestToolCallId(params),
      requestedAction: action || safeReceipt.action || request.method || "target.acp.callback",
      risk: route.decision?.maxRisk || "read_only",
      status,
      pendingOperationId: status === "pending" ? "acp_agent_relay.permission.resolve" : "",
      decisionId: status === "pending" ? "" : "target-acp-callback-policy",
      details: {
        relaySessionId: session.relaySessionId,
        action: action || safeReceipt.action || request.method || "target.acp.callback",
        targetAcpMethod: request.method || "",
        targetToolCallId: targetRequestToolCallId(params),
        path: safeReceipt.path || targetPermissionPath(params),
        targetPreview: targetPermissionCommand(params).slice(0, 280),
        payloadHash: safeReceipt.payloadHash || "",
        receipt: safeReceipt
      },
      decidedAt: status === "pending" ? "" : nowIso()
    });
    const receiptWithRequest = {
      ...safeReceipt,
      requestId: permissionRequest.requestId,
      targetAcpMethod: request.method || ""
    };
    await this.store.recordEvent(
      turn.relayTurnId,
      withAuditEvidence(
        receiptWithRequest.ok
          ? this.eventNormalizer.receipt(receiptWithRequest, "permission")
          : this.eventNormalizer.denial(receiptWithRequest, "permission"),
        audit
      )
    );
    return receiptWithRequest;
  }

  async handleTargetSessionRequestPermission({
    request = {},
    params = targetRequestParams(request),
    route = {},
    session = {},
    turn = {},
    audit = {}
  } = {}) {
    const action = targetPermissionAction(params, "target.permission");
    const command = targetPermissionCommand(params);
    let receipt;
    if (action === "command" || action === "terminal" || action === "run_command" || command) {
      receipt = {
        ...this.permissionBridge.denyTerminal({ command }),
        action: "terminal",
        targetAction: action || "command",
        targetPreview: command.slice(0, 280)
      };
    } else if (action === "fs.read_text_file" || action === "fs.readTextFile" || action === "read_text_file") {
      const path = targetPermissionPath(params);
      receipt = pathDenied(path)
        ? {
            ok: false,
            status: "denied",
            action: "fs.readTextFile",
            reasonCode: "path_denied",
            path
          }
        : {
            ok: true,
            status: "completed",
            action: "fs.readTextFile",
            reasonCode: "read_permission_granted",
            path
          };
    } else {
      receipt = {
        ok: false,
        status: "denied",
        action: action || "target.permission",
        reasonCode: "target_permission_action_unsupported",
        targetPreview: targetPermissionCommand(params).slice(0, 280)
      };
    }
    const auditReceipt = await this.recordTargetAcpCallbackReceipt({
      request,
      receipt,
      route,
      session,
      turn,
      audit,
      action: receipt.action || action
    });
    return {
      result: {
        approved: auditReceipt.ok === true,
        allowed: auditReceipt.ok === true,
        requestId: auditReceipt.requestId,
        reasonCode: auditReceipt.reasonCode || "",
        receipt: auditReceipt
      }
    };
  }

  async handleTargetFsReadTextFile({
    request = {},
    params = targetRequestParams(request),
    route = {},
    session = {},
    turn = {},
    audit = {}
  } = {}) {
    const receipt = await this.permissionBridge.readTextFile({
      path: targetPermissionPath(params)
    }).catch((error) => ({
      ok: false,
      status: "denied",
      action: "fs.readTextFile",
      reasonCode: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path: targetPermissionPath(params)
    }));
    const auditReceipt = await this.recordTargetAcpCallbackReceipt({
      request,
      receipt,
      route,
      session,
      turn,
      audit,
      action: "fs.readTextFile"
    });
    if (!receipt.ok) {
      return {
        error: {
          code: -32003,
          message: "Target ACP file read was denied.",
          data: { receipt: auditReceipt }
        }
      };
    }
    return {
      result: {
        content: receipt.content,
        path: receipt.path,
        digest: receipt.digest,
        receipt: auditReceipt
      }
    };
  }

  async handleTargetFsWriteTextFile({
    request = {},
    params = targetRequestParams(request),
    route = {},
    session = {},
    turn = {},
    audit = {},
    promptContext = {},
    method = ACP_METHODS.fsWriteTextFile
  } = {}) {
    const initialReceipt = await this.permissionBridge.requestWriteTextFile({
      route,
      write: {
        path: targetPermissionPath(params),
        content: targetWriteContent(params)
      },
      approval: asObject(params.approval)
    });
    if (initialReceipt.status === "pending_approval") {
      const targetToolCallId = targetRequestToolCallId(params);
      const existingRequests = await this.store.listPermissionRequests(turn.relayTurnId);
      const existing = existingRequests.find((candidate) =>
        permissionRequestMatchesTargetWrite(candidate, {
          targetToolCallId,
          payloadHash: initialReceipt.payloadHash,
          path: initialReceipt.path
        })
      );
      if (existing && existing.status === "completed") {
        const completedReceipt = {
          ...asObject(existing.details?.receipt),
          ok: true,
          status: "completed",
          action: "fs.writeTextFile",
          requestId: existing.requestId,
          targetAcpMethod: method,
          targetToolCallId
        };
        return {
          result: {
            ok: true,
            path: completedReceipt.path || initialReceipt.path,
            receipt: completedReceipt
          }
        };
      }
      if (existing && existing.status === "pending") {
        return {
          __pactTargetApprovalPending: true,
          pendingApproval: {
            pendingPermissionRequests: [existing],
            receipts: [asObject(existing.details?.receipt)],
            outputSummary: "Relay turn is waiting for target callback approval."
          }
        };
      }
      const requestId = randomId("relay_perm");
      const content = targetWriteContent(params);
      const contentRef = sensitivePayloadRef("write-content", requestId);
      const promptRef = asText(promptContext.promptRef) || sensitivePayloadRef("prompt", turn.relayTurnId);
	      await this.rememberSensitivePayload(contentRef, {
        kind: "write-content",
        requestId,
        relayTurnId: turn.relayTurnId,
        content,
        promptRef
      });
	      await this.rememberSensitivePayload(promptRef, {
        kind: "prompt",
        relayTurnId: turn.relayTurnId,
        promptText: asText(promptContext.promptText)
      });
      const receiptWithRequest = {
        ...initialReceipt,
        requestId,
        targetAcpMethod: method,
        targetToolCallId
      };
      const permissionRequest = await this.store.createPermissionRequest({
        requestId,
        relayTurnId: turn.relayTurnId,
        targetToolCallId,
        requestedAction: "fs.writeTextFile",
        risk: route.decision?.maxRisk || "repair_write",
        status: "pending",
        pendingOperationId: "acp_agent_relay.permission.resolve",
        details: {
          relaySessionId: session.relaySessionId,
          action: "fs.writeTextFile",
          targetAcpMethod: method,
          targetToolCallId,
          path: initialReceipt.path || targetPermissionPath(params),
          contentHash: sha256Text(content),
          contentRef,
          payloadHash: initialReceipt.payloadHash,
          promptHash: sha256Text(promptContext.promptText),
          promptRef,
          requestReasoning: promptContext.requestReasoning === true,
          localObservationMarker: asText(promptContext.localObservationMarker),
          source: "target_acp_callback",
          receipt: receiptWithRequest
        }
      });
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(this.eventNormalizer.receipt(receiptWithRequest, "permission"), audit)
      );
      return {
        __pactTargetApprovalPending: true,
        pendingApproval: {
          pendingPermissionRequests: [permissionRequest],
          receipts: [receiptWithRequest],
          outputSummary: "Relay turn is waiting for target callback approval."
        }
      };
    }
    const receipt = initialReceipt;
    const auditReceipt = await this.recordTargetAcpCallbackReceipt({
      request,
      receipt,
      route,
      session,
      turn,
      audit,
      action: "fs.writeTextFile"
    });
    if (!receipt.ok) {
      return {
        error: {
          code: -32003,
          message: "Target ACP file write was denied.",
          data: { receipt: auditReceipt }
        }
      };
    }
    return {
      result: {
        ok: true,
        path: receipt.path,
        receipt: auditReceipt
      }
    };
  }

  async handleUnsupportedTargetAcpRequest({
    request = {},
    params = targetRequestParams(request),
    route = {},
    session = {},
    turn = {},
    audit = {},
    method = ""
  } = {}) {
    const receipt = {
      ok: false,
      status: "denied",
      action: `target.${asText(method, "callback")}`,
      reasonCode: "target_acp_callback_unsupported",
      targetToolCallId: targetRequestToolCallId(params),
      targetPreview: targetPermissionCommand(params).slice(0, 280)
    };
    const auditReceipt = await this.recordTargetAcpCallbackReceipt({
      request,
      receipt,
      route,
      session,
      turn,
      audit,
      action: receipt.action
    });
    return {
      error: {
        code: -32601,
        message: `Unsupported target ACP callback method: ${asText(method, "unknown")}`,
        data: { method, receipt: auditReceipt }
      }
    };
  }

  async handleTargetAcpRequest({
    request = {},
    route = {},
    session = {},
    turn = {},
    audit = {},
    promptContext = {}
  } = {}) {
    const params = targetRequestParams(request);
    const method = asText(request.method);
    const handler = this.targetCallbackHandlers.get(method) ||
      ((context) => this.handleUnsupportedTargetAcpRequest(context));
    return handler({
      request,
      params,
      route,
      session,
      turn,
      audit,
      promptContext,
      method,
      executor: this,
      recordReceipt: (receipt = {}, action = "") => this.recordTargetAcpCallbackReceipt({
        request,
        receipt,
        route,
        session,
        turn,
        audit,
        action
      })
    });
  }

  async finishPromptWithTarget({
    session = {},
    route = {},
    turn = {},
    audit = {},
    promptText = "",
    requestReasoning = false,
    localObservationMarker = "",
    receipts = [],
    input = {},
    context = {}
  } = {}) {
    const promptRef = sensitivePayloadRef("prompt", turn.relayTurnId);
    const promptHash = sha256Text(promptText);
	    await this.rememberSensitivePayload(promptRef, {
      kind: "prompt",
      relayTurnId: turn.relayTurnId,
      promptText
    });
    let promptWake = null;
    let promptResult = null;
    let promptSession = session;
    let targetRelaySession = session;
    const traceContext = traceContextFromRelayContext(context);
    try {
      const relayMcpInput = {
        ...input,
        relayTurnId: turn.relayTurnId,
        traceId: traceContext.traceId || context.traceId || audit.globalAuditId || turn.globalAuditId || "",
        parentOperationId: turn.operationId || audit.operationId || "acp_agent_relay.prompt.send"
      };
      const relayMcp = await this.ensureRelayMcpGrant({ input: relayMcpInput, session, route, context });
      if (!relayMcp.ok) {
        throw Object.assign(new Error(relayMcp.error?.message || "Relay MCP grant issue failed."), {
          code: relayMcp.error?.code || "relay_mcp_grant_issue_failed",
          relayError: relayMcp.error
        });
      }
      promptSession = relayMcp.session || session;
      targetRelaySession = relayMcp.relaySession || promptSession;
      promptWake = await this.sessionDriver.wake({
        target: route.target,
        relaySession: targetRelaySession,
        route
      });
      promptResult = await this.sessionDriver.prompt({
        connection: promptWake.connection,
        prompt: {
          prompt: promptText,
          relayTurnId: turn.relayTurnId,
          traceId: traceContext.traceId || context.traceId || audit.globalAuditId || turn.globalAuditId || "",
          operationId: turn.operationId || audit.operationId || "acp_agent_relay.prompt.send",
          requestReasoning,
          localObservationMarker,
          receipts,
          targetRequestHandler: (request) => this.handleTargetAcpRequest({
            request,
            route,
            session: promptSession,
            turn,
            audit,
            promptContext: {
              promptText,
              promptHash,
              promptRef,
              requestReasoning,
              localObservationMarker
            }
          })
        },
        route,
        relaySession: targetRelaySession
      });
    } catch (error) {
      const targetError = targetErrorFromRuntimeError(error, promptWake ? "target_prompt_failed" : "target_wake_failed");
      const failedSession = await this.store.updateSession(promptSession.relaySessionId, {
        lifecycleState: promptWake ? "active" : asText(promptSession.lifecycleState, "dormant"),
        policyRevision: route.policyRevision,
        ...(promptWake?.targetSessionId ? { targetSessionId: promptWake.targetSessionId } : {}),
        ...(promptWake?.targetResumeRef ? { targetResumeRef: promptWake.targetResumeRef } : {}),
        metadata: {
          ...asObject(promptSession.metadata),
          lastWakeResult: {
            ok: false,
            code: targetError.code,
            message: targetError.message,
            targetSessionId: asText(promptWake?.targetSessionId || promptSession.targetSessionId),
            targetResumeRef: asText(promptWake?.targetResumeRef || promptSession.targetResumeRef),
            wokenAt: asText(promptWake?.wokenAt || nowIso()),
            transportType: asText(route.target?.transport?.type),
            finalResponsePolicy: targetFinalResponseCapability(route.target).policy
          }
        }
      });
      const failurePromptResult = {
        stopReason: "target_error",
        text: targetError.message,
        outputSummary: targetError.message,
        externalCompletionState: "target_error",
        finalResponseAvailable: false,
        finalResponsePolicy: "target_error",
        targetError,
        targetSessionId: asText(promptWake?.targetSessionId || failedSession?.targetSessionId || promptSession.targetSessionId),
        targetResumeRef: asText(promptWake?.targetResumeRef || failedSession?.targetResumeRef || promptSession.targetResumeRef),
        updates: [],
        reasoning: []
      };
      const targetEvidence = buildTargetEvidence({
        route,
        session: failedSession || promptSession,
        promptResult: failurePromptResult,
        audit
      });
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(this.eventNormalizer.completion({ ...failurePromptResult, receipts }), audit)
      );
      const failedEvents = await this.store.listEvents(turn.relayTurnId);
      const communicationSummary = buildCommunicationSummary({
        session: failedSession || promptSession,
        turn: {
          ...turn,
          status: "completed",
          stopReason: "target_error"
        },
        events: failedEvents,
        receipts,
        pendingPermissionRequests: [],
        stopReason: "target_error",
        outputSummary: targetError.message,
        audit,
        targetEvidence
      });
      const failedTurn = await this.store.updateTurn(turn.relayTurnId, {
        status: "completed",
        stopReason: "target_error",
        completedAt: nowIso(),
        metadata: {
          ...asObject(turn.metadata),
          audit,
          result: {
            stopReason: "target_error",
            outputSummary: targetError.message,
            receipts,
            targetEvidence,
            communicationSummary
          }
        }
      });
      return {
        session: failedSession || promptSession,
        turn: failedTurn,
        events: failedEvents,
        receipts,
        pendingPermissionRequests: [],
        stopReason: "target_error",
        outputSummary: targetError.message,
        audit,
        targetEvidence,
        responseKind: responseKindFromCommunicationSummary(communicationSummary),
        communicationSummary
      };
    }
    const latestTurn = await this.store.getTurn(turn.relayTurnId);
    if (isCancelledTurn(latestTurn)) {
      return this.restorePromptResultFromTurn(latestTurn, await this.store.getSession(promptSession.relaySessionId), {
        idempotencyReplay: false
      });
    }
    const targetSessionPatch = {};
    const approvalPending = promptResult.stopReason === "approval_pending";
    targetSessionPatch.lifecycleState = approvalPending ? "approval_pending" : "active";
    targetSessionPatch.policyRevision = route.policyRevision;
    targetSessionPatch.lastWokenAt = asText(promptWake.wokenAt, nowIso());
    const targetSessionId = asText(promptResult.targetSessionId || promptWake.targetSessionId);
    const targetResumeRef = asText(promptResult.targetResumeRef || promptWake.targetResumeRef);
    if (targetSessionId) {
      targetSessionPatch.targetSessionId = targetSessionId;
    }
    if (targetResumeRef) {
      targetSessionPatch.targetResumeRef = targetResumeRef;
    }
    if (Object.keys(targetSessionPatch).length > 0) {
      await this.store.updateSession(promptSession.relaySessionId, targetSessionPatch);
    }
    for (const update of promptResult.updates || []) {
      await this.store.recordEvent(turn.relayTurnId, withAuditEvidence(this.eventNormalizer.progress(update), audit));
    }
    if (route.decision.reasoningAllowed) {
      for (const reasoning of promptResult.reasoning || []) {
        await this.store.recordEvent(turn.relayTurnId, withAuditEvidence(this.eventNormalizer.reasoning(reasoning), audit));
      }
    }
    const targetInteractionReceipts = targetInteractionReceiptsFromPromptResult({
      promptResult,
      permissionBridge: this.permissionBridge
    });
    for (const receipt of targetInteractionReceipts) {
      const request = await this.store.createPermissionRequest({
        requestId: randomId("relay_perm"),
        relayTurnId: turn.relayTurnId,
        targetToolCallId: asText(receipt.targetToolCallId),
        requestedAction: receipt.action || "target.interaction",
        risk: route.decision?.maxRisk || "read_only",
        status: receipt.status === "denied" ? "denied" : "completed",
        decisionId: "target-interaction-policy",
        details: {
          relaySessionId: promptSession.relaySessionId,
          action: receipt.action,
          targetAction: receipt.targetAction,
          targetPreview: receipt.targetPreview,
          connectStepIndex: receipt.connectStepIndex,
          connectStepType: receipt.connectStepType,
          externalInteraction: receipt.externalInteraction,
          receipt
        },
        decidedAt: nowIso()
      });
      receipt.requestId = request.requestId;
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(
          receipt.ok ? this.eventNormalizer.receipt(receipt, "permission") : this.eventNormalizer.denial(receipt, "permission"),
          audit
        )
      );
    }
    const targetRequestReceipts = Array.isArray(promptResult.targetRequestReceipts) ? promptResult.targetRequestReceipts : [];
    const finalReceipts = mergeReceipts(receipts, targetInteractionReceipts, targetRequestReceipts);
    promptResult.targetInteractionReceipts = [...targetInteractionReceipts, ...targetRequestReceipts];
    const resultSession = Object.keys(targetSessionPatch).length > 0
      ? await this.store.getSession(promptSession.relaySessionId)
      : promptSession;
    const targetEvidence = buildTargetEvidence({ route, session: resultSession, promptResult, audit });
    if (approvalPending) {
      const pendingPermissionRequests = Array.isArray(promptResult.pendingPermissionRequests)
        ? promptResult.pendingPermissionRequests
        : [];
      const outputSummary = promptResult.text || "Relay turn is waiting for target callback approval.";
      const pendingEvents = await this.store.listEvents(turn.relayTurnId);
      const communicationSummary = buildCommunicationSummary({
        session: resultSession,
        turn: {
          ...turn,
          status: "approval_pending",
          stopReason: "approval_pending"
        },
        events: pendingEvents,
        receipts: finalReceipts,
        pendingPermissionRequests,
        stopReason: "approval_pending",
        outputSummary,
        audit,
        targetEvidence
      });
      const pendingTurn = await this.store.updateTurn(turn.relayTurnId, {
        status: "approval_pending",
        stopReason: "approval_pending",
        metadata: {
          ...asObject(turn.metadata),
          audit,
          pendingPrompt: {
            promptHash,
            promptRef,
            requestReasoning,
            localObservationMarker,
            receipts: finalReceipts,
            route: {
              virtualAgentId: route.virtualAgent?.virtualAgentId || "",
              targetId: route.target?.targetId || "",
              effectiveMode: route.effectiveMode || "",
              policyRevision: route.policyRevision,
              decision: route.decision || {}
            },
            pendingRequestIds: pendingPermissionRequests.map((request) => request.requestId)
          },
          result: {
            stopReason: "approval_pending",
            outputSummary,
            receipts: finalReceipts,
            targetEvidence,
            pendingPermissionRequestIds: pendingPermissionRequests.map((request) => request.requestId),
            communicationSummary
          }
        }
      });
      return {
        session: resultSession,
        turn: pendingTurn,
        events: pendingEvents,
        receipts: finalReceipts,
        pendingPermissionRequests,
        stopReason: "approval_pending",
        outputSummary,
        audit,
        targetEvidence,
        responseKind: responseKindFromCommunicationSummary(communicationSummary),
        communicationSummary
      };
    }
    await this.store.recordEvent(turn.relayTurnId, withAuditEvidence(this.eventNormalizer.completion({ ...promptResult, receipts: finalReceipts }), audit));
    const completedEvents = await this.store.listEvents(turn.relayTurnId);
    const completedStopReason = promptResult.stopReason || "completed";
    const completedOutputSummary = promptResult.text || "";
    const communicationSummary = buildCommunicationSummary({
      session: resultSession,
      turn: {
        ...turn,
        status: "completed",
        stopReason: completedStopReason
      },
      events: completedEvents,
      receipts: finalReceipts,
      pendingPermissionRequests: [],
      stopReason: completedStopReason,
      outputSummary: completedOutputSummary,
      audit,
      targetEvidence
    });
    const completed = await this.store.updateTurn(turn.relayTurnId, {
      status: "completed",
      stopReason: completedStopReason,
      completedAt: nowIso(),
      metadata: {
        ...asObject(turn.metadata),
        audit,
        result: {
          stopReason: completedStopReason,
          outputSummary: completedOutputSummary,
          receipts: finalReceipts,
          targetEvidence,
          communicationSummary
        }
      }
    });
    return {
      session: resultSession,
      turn: completed,
      events: completedEvents,
      receipts: finalReceipts,
      stopReason: completedStopReason,
      outputSummary: completedOutputSummary,
      audit,
      targetEvidence,
      responseKind: responseKindFromCommunicationSummary(communicationSummary),
      communicationSummary
    };
  }

  async restorePromptResultFromTurn(turn = {}, session = null, options = {}) {
    const relaySession = session || await this.store.getSession(turn.relaySessionId);
    const events = await this.store.listEvents(turn.relayTurnId);
    const result = asObject(turn.metadata?.result);
    const pendingPermissionRequests = (await this.store.listPermissionRequests(turn.relayTurnId))
      .filter((request) => request.status === "pending");
    const stopReason = asText(result.stopReason || turn.stopReason || (turn.status === "completed" ? "completed" : turn.status));
    const receipts = Array.isArray(result.receipts) ? result.receipts : receiptsFromEvents(events);
    const audit = auditFromTurn(turn, relaySession || {});
    const targetEvidence = asObject(result.targetEvidence);
    const outputSummary = asText(result.outputSummary || outputSummaryFromEvents(events));
    const communicationSummary = nonEmptyObject(asObject(result.communicationSummary))
      ? asObject(result.communicationSummary)
      : buildCommunicationSummary({
          session: relaySession || {},
          turn,
          events,
          receipts,
          pendingPermissionRequests,
          stopReason,
          outputSummary,
          audit,
          targetEvidence
        });
    return {
      session: relaySession,
      turn,
      events,
      receipts,
      pendingPermissionRequests,
      newEvents: [],
      stopReason,
      outputSummary,
      audit,
      targetEvidence,
      idempotencyReplay: options.idempotencyReplay !== false,
      responseKind: responseKindFromCommunicationSummary(communicationSummary),
      communicationSummary
    };
  }

  async cancelIncompleteTurns(session = {}, cancel = {}) {
    const turns = (await this.store.listTurns(session.relaySessionId)).filter((turn) => isCancellableTurn(turn));
    const cancelledTurns = [];
    for (const turn of turns) {
      const audit = auditFromTurn(turn, session);
      const cancelledAt = asText(cancel.cancelledAt, nowIso());
      const action = asText(cancel.action, "session.cancel");
      const reasonCode = asText(cancel.reasonCode, "source_session_cancelled");
      const cancellationSource = asText(cancel.source, "source_session_cancel");
      const decisionId = asText(cancel.decisionId, "source-session-cancel");
      const outputSummary = asText(cancel.outputSummary, "Relay turn was cancelled by the source agent.");
      const cancellationReceipt = {
        ok: true,
        status: "cancelled",
        action,
        reasonCode,
        relaySessionId: session.relaySessionId,
        targetSessionId: asText(cancel.targetSessionId || session.targetSessionId),
        cancelledAt
      };
      await this.store.updateTurn(turn.relayTurnId, {
        status: "cancelled",
        stopReason: "cancelled",
        completedAt: cancelledAt,
        metadata: {
          ...asObject(turn.metadata),
          audit,
          cancellation: {
            cancelledAt,
            source: cancellationSource,
            cancel
          },
          result: {
            stopReason: "cancelled",
            outputSummary,
            receipts: [cancellationReceipt],
            targetEvidence: asObject(turn.metadata?.result?.targetEvidence)
          }
        }
      });
      const pendingPermissionRequests = (await this.store.listPermissionRequests(turn.relayTurnId))
        .filter((request) => request.status === "pending");
      const cancelledPermissionRequests = [];
      for (const request of pendingPermissionRequests) {
        const requestReceipt = {
          ...cancellationReceipt,
          ok: false,
          action: request.requestedAction || "permission",
          requestId: request.requestId
        };
	        const cancelledRequest = await this.store.updatePermissionRequest(request.requestId, {
          status: "cancelled",
          decisionId,
          details: {
            ...asObject(request.details),
            cancelledBy: cancellationSource,
            receipt: requestReceipt
          }
	        });
	        await this.forgetPermissionSensitivePayloads(request.details, { prompt: true });
	        if (cancelledRequest) {
          cancelledPermissionRequests.push(cancelledRequest);
        }
      }
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(this.eventNormalizer.receipt(cancellationReceipt, "operation"), audit)
      );
      await this.store.recordEvent(
        turn.relayTurnId,
        withAuditEvidence(
          {
            ...this.eventNormalizer.completion({
              stopReason: "cancelled",
              outputSummary,
              receipts: [cancellationReceipt]
            }),
            source: "operation"
          },
          audit
        )
      );
      const targetEvidence = asObject(turn.metadata?.result?.targetEvidence);
      const events = await this.store.listEvents(turn.relayTurnId);
      const communicationSummary = buildCommunicationSummary({
        session,
        turn: {
          ...turn,
          status: "cancelled",
          stopReason: "cancelled"
        },
        events,
        receipts: [cancellationReceipt],
        pendingPermissionRequests: [],
        stopReason: "cancelled",
        outputSummary,
        audit,
        targetEvidence
      });
      const cancelledTurn = await this.store.updateTurn(turn.relayTurnId, {
        status: "cancelled",
        stopReason: "cancelled",
        completedAt: cancelledAt,
        metadata: {
          ...asObject(turn.metadata),
          audit,
          cancellation: {
            cancelledAt,
            source: cancellationSource,
            cancel
          },
          result: {
            stopReason: "cancelled",
            outputSummary,
            receipts: [cancellationReceipt],
            targetEvidence,
            communicationSummary
          }
        }
      });
      cancelledTurns.push({
        turn: cancelledTurn,
        permissionRequests: cancelledPermissionRequests,
        receipt: cancellationReceipt,
        responseKind: responseKindFromCommunicationSummary(communicationSummary),
        communicationSummary
      });
    }
    return cancelledTurns;
  }

  async resolvePermission(input = {}, context = {}) {
    const requestId = asText(input.requestId || input.permissionRequestId || input.id);
    if (!requestId) {
      return operationResult(false, {}, { code: "permission_request_required", message: "Permission resolve requires requestId." });
    }
	    const permissionRequest = await this.store.getPermissionRequest?.(requestId);
	    if (!permissionRequest) {
	      return operationResult(false, {}, { code: "permission_request_not_found", message: "Permission request not found." });
	    }
	    if (input.__permissionResolveLocked !== true) {
	      return this.withPermissionResolveLock(permissionRequest.relayTurnId || requestId, () =>
	        this.resolvePermission({ ...input, __permissionResolveLocked: true })
	      );
	    }
	    const permissionSessionId = asText(permissionRequest.details?.relaySessionId || input.relaySessionId || input.sessionId);
    const permissionSession = permissionSessionId ? await this.store.getSession(permissionSessionId) : null;
    if (permissionSessionId && (!permissionSession || !sessionBelongsToInput(permissionSession, input))) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    if (permissionSession && isClosedSession(permissionSession) && permissionRequest.status === "pending") {
      const details = asObject(permissionRequest.details);
      const closedReceipt = {
        ok: false,
        status: "cancelled",
        action: details.action || permissionRequest.requestedAction,
        reasonCode: "relay_session_closed",
        requestId,
        path: details.path || "",
        message: "Permission request belongs to a closed relay session."
      };
	      const cancelledRequest = await this.store.updatePermissionRequest(requestId, {
        status: "cancelled",
        decisionId: "source-session-close",
        details: {
          ...details,
          cancelledBy: "source_session_close",
          receipt: closedReceipt
        }
	      });
	      await this.forgetPermissionSensitivePayloads(details, { prompt: true });
	      return operationResult(false, { permissionRequest: cancelledRequest }, closedSessionError(permissionSession));
    }
    if (permissionRequest.status === "completed") {
      return operationResult(true, {
        permissionRequest,
        receipt: permissionRequest.details?.receipt || null,
        alreadyResolved: true,
        turn: await this.store.getTurn(permissionRequest.relayTurnId),
        events: await this.store.listEvents(permissionRequest.relayTurnId),
        newEvents: [],
        stopReason: "completed"
      });
    }
    if (permissionRequest.status !== "pending") {
      return operationResult(false, {}, {
        code: "permission_request_not_pending",
        message: "Permission request is not pending.",
        details: { requestId, status: permissionRequest.status }
      });
    }
    const details = asObject(permissionRequest.details);
    const approval = asObject(input.approval || input);
    const eventsBeforeResolve = await this.store.listEvents(permissionRequest.relayTurnId);
    if (approval.approved !== true) {
      const turnBeforeDeny = await this.store.getTurn(permissionRequest.relayTurnId);
      const audit = {
        globalAuditId: turnBeforeDeny?.globalAuditId,
        artifactRef: turnBeforeDeny?.artifactRef,
        relayTurnId: permissionRequest.relayTurnId,
        relaySessionId: details.relaySessionId,
        operationId: turnBeforeDeny?.operationId || "acp_agent_relay.prompt.send",
        policyRevision: turnBeforeDeny?.metadata?.audit?.policyRevision,
        relayMcpGrantId: turnBeforeDeny?.metadata?.audit?.relayMcpGrantId
      };
      const denialReceipt = {
        ok: false,
        status: "denied",
        action: details.action || permissionRequest.requestedAction,
        reasonCode: "approval_denied",
        requestId,
        path: details.path || "",
        message: asText(approval.reason || input.reason, "Permission request was denied.")
      };
	      const denied = await this.store.updatePermissionRequest(requestId, {
        status: "denied",
        decisionId: asText(approval.approvalId || input.decisionId, "approval-denied"),
        details: {
          ...details,
          denialReason: asText(approval.reason || input.reason, "approval_denied"),
          receipt: denialReceipt
        }
	      });
	      await this.forgetPermissionSensitivePayloads(details, { prompt: true });
	      const targetEvidence = asObject(turnBeforeDeny?.metadata?.result?.targetEvidence);
      let turn = await this.store.updateTurn(permissionRequest.relayTurnId, {
        status: "approval_denied",
        stopReason: "approval_denied",
        completedAt: nowIso(),
        metadata: {
          ...asObject(turnBeforeDeny?.metadata),
          audit: nonEmptyObject(asObject(turnBeforeDeny?.metadata?.audit))
            ? asObject(turnBeforeDeny?.metadata?.audit)
            : audit,
          result: {
            stopReason: "approval_denied",
            outputSummary: "Permission request was denied.",
            receipts: [denialReceipt],
            targetEvidence
          }
        }
      });
      await this.store.recordEvent(
        permissionRequest.relayTurnId,
        withAuditEvidence(this.eventNormalizer.denial(denialReceipt, "permission"), {
          ...audit,
          globalAuditId: turn.globalAuditId || audit.globalAuditId,
          artifactRef: turn.artifactRef || audit.artifactRef,
          operationId: turn.operationId || audit.operationId
        })
      );
      await this.store.recordEvent(
        permissionRequest.relayTurnId,
        withAuditEvidence(
          {
            ...this.eventNormalizer.completion({
              stopReason: "approval_denied",
              outputSummary: "Permission request was denied.",
              receipts: [denialReceipt]
            }),
            source: "permission"
          },
          {
            ...audit,
            globalAuditId: turn.globalAuditId || audit.globalAuditId,
            artifactRef: turn.artifactRef || audit.artifactRef,
            operationId: turn.operationId || audit.operationId
          }
        )
      );
      const events = await this.store.listEvents(permissionRequest.relayTurnId);
      const communicationSummary = buildCommunicationSummary({
        session: permissionSession || {},
        turn,
        events,
        receipts: [denialReceipt],
        pendingPermissionRequests: [],
        stopReason: "approval_denied",
        outputSummary: "Permission request was denied.",
        audit: {
          ...audit,
          globalAuditId: turn.globalAuditId || audit.globalAuditId,
          artifactRef: turn.artifactRef || audit.artifactRef,
          operationId: turn.operationId || audit.operationId
        },
        targetEvidence
      });
      turn = await this.store.updateTurn(permissionRequest.relayTurnId, {
        metadata: {
          ...asObject(turn.metadata),
          result: {
            ...asObject(turn.metadata?.result),
            communicationSummary
          }
        }
      });
      return operationResult(true, {
        permissionRequest: denied,
        turn,
        events,
        newEvents: events.slice(eventsBeforeResolve.length),
        receipt: denialReceipt,
        receipts: [denialReceipt],
        stopReason: "approval_denied",
        outputSummary: "Permission request was denied.",
        responseKind: responseKindFromCommunicationSummary(communicationSummary),
        communicationSummary
      });
    }
    const expectedPayloadHash = asText(details.payloadHash);
    const approvedPayloadHash = asText(approval.payloadHash || input.payloadHash);
    if (approvedPayloadHash && approvedPayloadHash !== expectedPayloadHash) {
      return operationResult(false, {}, {
        code: "approval_payload_mismatch",
        message: "Permission approval payload hash does not match the pending request.",
        details: { requestId }
      });
    }
    const session = permissionSession || await this.store.getSession(details.relaySessionId);
    const turn = await this.store.getTurn(permissionRequest.relayTurnId);
    if (!session || !turn) {
      return operationResult(false, {}, { code: "permission_context_missing", message: "Permission resume context is missing." });
    }
    if (isCancelledTurn(turn)) {
      const cancelledReceipt = {
        ok: false,
        status: "cancelled",
        action: details.action || permissionRequest.requestedAction,
        reasonCode: "turn_cancelled",
        requestId,
        path: details.path || "",
        message: "Permission request belongs to a cancelled relay turn."
      };
	      const cancelledRequest = await this.store.updatePermissionRequest(requestId, {
        status: "cancelled",
        decisionId: "source-session-cancel",
        details: {
          ...details,
          cancelledBy: "turn_cancelled",
          receipt: cancelledReceipt
        }
	      });
	      await this.forgetPermissionSensitivePayloads(details, { prompt: true });
	      return operationResult(false, { permissionRequest: cancelledRequest, turn }, {
        code: "permission_request_not_pending",
        message: "Permission request is not pending.",
        details: { requestId, status: "cancelled", reasonCode: "turn_cancelled" }
      });
    }
    const pendingPrompt = asObject(turn.metadata?.pendingPrompt);
	    const promptText = await this.resolvePendingPromptText(pendingPrompt, details);
	    const writeContent = await this.resolvePendingWriteContent(details);
    if (writeContent === null) {
      return operationResult(false, {}, {
        code: "permission_payload_unavailable",
        message: "Permission payload is no longer available for guarded resume.",
        details: {
          requestId,
          contentRef: asText(details.contentRef || details.writeContentRef)
        }
      });
    }
    const routeDecision = await this.router.resolveForSourceSession({
      ...input,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId,
      sourceSubjectId: session.sourceSubjectId,
      requestReasoning: Boolean(details.requestReasoning || turn.metadata?.pendingPrompt?.requestReasoning),
      prompt: promptText
    });
    if (!routeDecision.ok) {
      await this.store.updatePermissionRequest(requestId, { status: "denied", details: { ...details, routeError: routeDecision.error } });
      await this.store.updateTurn(turn.relayTurnId, { status: "blocked", stopReason: routeDecision.error?.code || "route_blocked" });
      return operationResult(false, {}, routeDecision.error);
    }
    const route = routeDecision.route;
    const audit = asObject(turn.metadata?.audit) || {
      globalAuditId: turn.globalAuditId,
      artifactRef: turn.artifactRef,
      relayTurnId: turn.relayTurnId,
      relaySessionId: session.relaySessionId,
      operationId: turn.operationId,
      policyRevision: route.policyRevision,
      relayMcpGrantId: session.relayMcpGrantId
    };
    const receipt = await this.permissionBridge.requestWriteTextFile({
      route,
      write: {
        path: details.path,
        content: writeContent
      },
      approval: {
        approved: true,
        approvalId: asText(approval.approvalId || input.decisionId, "approval-resume"),
        payloadHash: expectedPayloadHash
      }
    });
    await this.store.recordEvent(
      turn.relayTurnId,
      withAuditEvidence(
        receipt.ok ? this.eventNormalizer.receipt(receipt, "permission") : this.eventNormalizer.denial(receipt, "permission"),
        audit
      )
    );
    if (!receipt.ok) {
      const denied = await this.store.updatePermissionRequest(requestId, {
        status: "denied",
        decisionId: asText(approval.approvalId || input.decisionId, "approval-resume"),
        details: { ...details, receipt }
      });
      return operationResult(false, { permissionRequest: denied, receipt }, {
        code: receipt.reasonCode || "permission_resume_denied",
        message: "Permission resume was denied.",
        details: { requestId }
      });
    }
	    const resolvedRequest = await this.store.updatePermissionRequest(requestId, {
	      status: "completed",
	      decisionId: asText(approval.approvalId || input.decisionId, "approval-resume"),
	      details: { ...details, receipt }
	    });
	    await this.forgetPermissionSensitivePayloads(details);
    const remaining = (await this.store.listPermissionRequests(turn.relayTurnId)).filter((request) => request.status === "pending");
    if (remaining.length > 0) {
      const events = await this.store.listEvents(turn.relayTurnId);
      return operationResult(true, {
        permissionRequest: resolvedRequest,
        remainingPermissionRequests: remaining,
        receipt,
        turn: await this.store.getTurn(turn.relayTurnId),
        events,
        newEvents: events.slice(eventsBeforeResolve.length),
        stopReason: "approval_pending"
      });
    }
    const priorReceipts = Array.isArray(pendingPrompt.receipts) ? pendingPrompt.receipts : [];
    const receipts = priorReceipts.map((candidate) =>
      candidate.requestId === requestId ? { ...receipt, requestId } : candidate
    );
    if (!receipts.some((candidate) => candidate.requestId === requestId)) {
      receipts.push({ ...receipt, requestId });
    }
    await this.store.updateTurn(turn.relayTurnId, {
      status: "running",
      metadata: {
        ...asObject(turn.metadata),
        pendingPrompt: {
          ...pendingPrompt,
          receipts
        }
      }
    });
    const updatedSession = await this.store.updateSession(session.relaySessionId, { lifecycleState: "active" });
	    const completed = await this.finishPromptWithTarget({
      session: updatedSession || session,
      route,
      turn: await this.store.getTurn(turn.relayTurnId),
      audit,
      promptText,
      requestReasoning: Boolean(pendingPrompt.requestReasoning || details.requestReasoning),
      localObservationMarker: asText(pendingPrompt.localObservationMarker || details.localObservationMarker),
      receipts,
      input,
      context
	    });
	    if (completed.stopReason !== "approval_pending") {
	      await this.forgetSensitivePayload(pendingPrompt.promptRef || details.promptRef);
	    }
	    return operationResult(true, {
      permissionRequest: resolvedRequest,
      ...completed,
      newEvents: completed.events.slice(eventsBeforeResolve.length)
    });
  }

  async cancelSession(input = {}) {
    const session = await this.resolveSession(input);
    if (!session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    if (isClosedSession(session)) {
      return operationResult(false, { session }, closedSessionError(session));
    }
    this.advanceSessionCancelGeneration(session.relaySessionId);
    const target = this.targetRegistry.getTarget(session.targetId);
    const cancel = await this.sessionDriver.cancel({ target, relaySession: session });
    const cancelledTurns = await this.cancelIncompleteTurns(session, cancel);
    const updated = await this.store.updateSession(session.relaySessionId, { lifecycleState: "dormant" });
    return operationResult(true, { session: updated, cancel, cancelledTurns });
  }

  async closeSession(input = {}, context = {}) {
    const session = await this.resolveSession(input);
    if (!session) {
      return operationResult(false, {}, { code: "relay_session_not_found", message: "Relay session not found." });
    }
    this.advanceSessionCancelGeneration(session.relaySessionId);
    const target = this.targetRegistry.getTarget(session.targetId);
    const close = this.sessionDriver && typeof this.sessionDriver.closeSession === "function"
      ? await this.sessionDriver.closeSession({ target, relaySession: session })
      : { ok: true, alreadyClosed: true };
    const cancelledTurns = await this.cancelIncompleteTurns(session, {
      ...close,
      action: "session.close",
      reasonCode: "source_session_closed",
      source: "source_session_close",
      decisionId: "source-session-close",
      outputSummary: "Relay turn was closed by the source agent.",
      cancelledAt: close.closedAt || nowIso()
    });
    const relayMcpGrantRevoke = await this.revokeRelayMcpGrant({
      session,
      context,
      reason: input.reason || "ACP relay session closed."
    }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error || "Relay MCP grant revoke failed.")
    }));
    const updated = await this.store.updateSession(session.relaySessionId, { lifecycleState: "closed" });
    return operationResult(true, { session: updated, close, cancelledTurns, relayMcpGrantRevoke });
  }

  async resolveSession(input = {}) {
    const relaySessionId = asText(input.relaySessionId || input.sessionId || input.id);
    if (relaySessionId) {
      const session = await this.store.getSession(relaySessionId);
      return session && sessionBelongsToInput(session, input) ? session : null;
    }
    return this.store.getSessionBySourceKey(input);
  }
}

export function createRelayOperationExecutor(options = {}) {
  return new RelayOperationExecutor(options);
}
