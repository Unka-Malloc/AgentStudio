import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  createAcpSessionUpdateParams,
  createError,
  createNotification,
  createSuccess,
  extractAcpPromptText,
  normalizeAcpStopReason,
  parseJsonRpcFrame,
  parseJsonRpcMessage
} from "../../../../common/protocols/acp/index.mjs";
import {
  normalizeAcpSourceAuthenticationContext,
  sourceAuthContextForOperation,
  sourcePublicIdentity
} from "./acp-source-auth-context.mjs";

const PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION = "pact.acp-agent-relay.v1";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_OPERATION_ERROR = -32002;
const JSON_RPC_INTERNAL_ERROR = -32603;

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function objectHasFields(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function sourceResponseKind(input = {}, eventType = "") {
  const payload = asObject(input);
  const summary = asObject(payload.communicationSummary, null);
  const summaryKind = asText(summary?.summaryKind);
  if (summaryKind) {
    return summaryKind;
  }
  const stopReason = asText(asObject(payload.stopReason, null)?.reason || payload.stopReason || payload.reason || payload.phase);
  const targetEvidence = asObject(payload.targetEvidence, null);
  const externalCompletionState = asText(payload.externalCompletionState || targetEvidence?.externalCompletionState);
  const outputSummary = asText(payload.outputSummary || payload.text || payload.message);
  const kind = asText(payload.type || payload.kind || eventType);
  if (
    externalCompletionState === "target_error" ||
    stopReason === "target_error" ||
    objectHasFields(payload.targetError) ||
    objectHasFields(targetEvidence?.targetError)
  ) {
    return "target_error";
  }
  if (stopReason === "approval_pending" || externalCompletionState === "approval_pending") {
    return "approval_pending";
  }
  if (stopReason === "approval_denied") {
    return "approval_denied";
  }
  if (stopReason === "cancelled" || stopReason === "canceled") {
    return "cancelled";
  }
  if (kind === "completion" && (externalCompletionState === "accepted_only" || stopReason === "accepted")) {
    return "acknowledgement";
  }
  if (payload.finalResponseAvailable === true || targetEvidence?.finalResponseAvailable === true) {
    return "final_response";
  }
  if (kind === "completion" && stopReason === "completed") {
    return outputSummary ? "final_response" : "none";
  }
  return outputSummary ? "status_summary" : "none";
}

function sourceAgentCapabilitiesFromProjection(operationData = {}) {
  const capabilities = asObject(operationData.capabilities || operationData.capabilitiesSnapshot?.capabilities);
  const modalities = new Set(asArray(capabilities.modalities).map((item) => asText(item)));
  const textSupported = modalities.size === 0 || modalities.has("text");
  const imageSupported = modalities.has("image") || modalities.has("screenshot");
  return {
    loadSession: true,
    promptCapabilities: {
      text: textSupported,
      image: imageSupported,
      audio: modalities.has("audio")
    }
  };
}

function sourceSessionCapabilitiesFromProjection(operationData = {}) {
  const snapshot = asObject(operationData.capabilitiesSnapshot || operationData.virtualAgent, null);
  const available = snapshot ? snapshot.enabled !== false && snapshot.availability?.ok !== false : true;
  return {
    load: true,
    resume: available,
    cancel: available,
    close: available
  };
}

function pickSessionId(params = {}) {
  return asText(
    params.relaySessionId ||
      params.sessionId ||
      params.session_id ||
      params.id ||
      params.resumeRef ||
      params.resume_ref
  );
}

function pickVirtualAgentId(params = {}, defaultVirtualAgentId = "") {
  return asText(
    params.virtualAgentId ||
      params.virtual_agent_id ||
      params.agentId ||
      params.agent_id ||
      params.id ||
      defaultVirtualAgentId
  );
}

function normalizeResult(operationResult = {}) {
  const result = asObject(operationResult);
  if (result.ok === false) {
    const error = asObject(result.error);
    return {
      ok: false,
      code: error.code || "operation_failed",
      message: error.message || "ACP relay operation failed.",
      data: error.details || error
    };
  }
  return {
    ok: true,
    data: asObject(result.data, result)
  };
}

function jsonRpcError(id, code, message, data = undefined) {
  return createError(id ?? null, code, message, data);
}

function relayOperationError(id, normalized = {}, extraData = {}) {
  return jsonRpcError(id, JSON_RPC_OPERATION_ERROR, normalized.message || "ACP relay operation failed.", {
    ...extraData,
    ...asObject(normalized.data),
    code: asText(normalized.code, "operation_failed"),
    operation: normalized
  });
}

function normalizeIncomingJsonRpcMessage(rawMessage) {
  if (Buffer.isBuffer(rawMessage)) {
    return rawMessage.toString("utf8");
  }
  if (rawMessage instanceof Uint8Array) {
    return Buffer.from(rawMessage).toString("utf8");
  }
  return rawMessage;
}

function isJsonRpcResponseMessage(message = {}) {
  return message && typeof message === "object" &&
    !Array.isArray(message) &&
    typeof message.method !== "string" &&
    (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));
}

function sanitizeFsPath(value = "") {
  return asText(value).replace(/^file:\/\//, "");
}

function sourceSessionKey(params = {}) {
  const sourceId = asText(params.sourceId || params.source_id || params.client || params.clientId, "source.acp");
  const sourceSessionId = asText(
    params.sourceSessionId ||
      params.source_session_id ||
      params.sessionId ||
      params.session_id ||
      params.id ||
      `source_${Date.now()}`
  );
  const workspaceId = asText(params.workspaceId || params.workspace_id, "default");
  const virtualAgentId = asText(params.virtualAgentId || params.virtual_agent_id || params.agentId || params.agent_id);
  return `${sourceId}::${workspaceId}::${sourceSessionId}::${virtualAgentId}`;
}

function sessionMatchesSourceContext(session = {}, sourceContext = {}) {
  const checks = [
    ["sourceId", asText(sourceContext.sourceId)],
    ["workspaceId", asText(sourceContext.workspaceId)],
    ["sourceSessionId", asText(sourceContext.sourceSessionId)],
    ["virtualAgentId", asText(sourceContext.virtualAgentId)]
  ];
  return checks.every(([key, expected]) => !expected || asText(session[key]) === expected);
}

function sourceUpdateFromRelayEvent(event = {}, { relaySessionId = "", turnId = "" } = {}) {
  const payload = asObject(event.redactedPayload);
  const stopReason = asObject(payload.stopReason);
  const phase = asText(payload.phase || stopReason.reason || payload.stopReason || event.type);
  const responseKind = sourceResponseKind({ ...payload, phase }, event.type);
  return createAcpSessionUpdateParams({
    sessionId: relaySessionId,
    relaySessionId,
    turnId,
    eventId: asText(event.eventId),
    sequence: Number(event.sequence || 0),
    type: asText(event.type, "session_update"),
    source: asText(event.source, "target"),
    phase,
    responseKind,
    text: asText(payload.text || payload.outputSummary || payload.message),
    payload,
    globalAuditId: asText(event.globalAuditId),
    artifactRef: asText(event.artifactRef),
    operationId: asText(event.operationId)
  });
}

function notificationDedupeKey(update = {}) {
  const params = asObject(update.params);
  if (asText(params.type) === "progress" && asText(params.phase) === "accepted") {
    return `${asText(update.method)}|progress|accepted`;
  }
  return [
    asText(update.method),
    asText(params.type),
    asText(params.phase),
    asText(params.text)
  ].join("|");
}

function sanitizePermissionRequest(request = {}) {
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

function sanitizePermissionRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).map((request) => sanitizePermissionRequest(request));
}

async function pendingPermissionRequestsForSession(store = null, session = {}) {
  const relaySessionId = asText(session?.relaySessionId);
  if (!store || !relaySessionId || typeof store.listTurns !== "function" || typeof store.listPermissionRequests !== "function") {
    return [];
  }
  const turns = await store.listTurns(relaySessionId);
  const pending = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    for (const request of await store.listPermissionRequests(turn.relayTurnId)) {
      if (asText(request.status) === "pending") {
        pending.push(request);
      }
    }
  }
  return pending;
}

function sourceCommunicationSummary(summary = null) {
  const input = asObject(summary, null);
  if (!input) {
    return null;
  }
  return {
    relaySessionId: asText(input.relaySessionId),
    relayTurnId: asText(input.relayTurnId),
    sourceId: asText(input.sourceId),
    sourceSessionId: asText(input.sourceSessionId),
    virtualAgentId: asText(input.virtualAgentId),
    targetId: asText(input.targetId),
    stopReason: asText(input.stopReason),
    lifecycleState: asText(input.lifecycleState),
    outputAvailable: input.outputAvailable === true,
    outputSummary: asText(input.outputSummary),
    summaryKind: asText(input.summaryKind),
    finalResponseSummary: asText(input.finalResponseSummary),
    acknowledgementSummary: asText(input.acknowledgementSummary),
    externalCompletionState: asText(input.externalCompletionState),
    finalResponseAvailable: input.finalResponseAvailable === true,
    finalResponsePolicy: asText(input.finalResponsePolicy),
    targetErrorCode: asText(input.targetErrorCode),
    targetErrorMessage: asText(input.targetErrorMessage),
    receiptCount: Number(input.receiptCount || 0),
    deniedReceiptCount: Number(input.deniedReceiptCount || 0),
    pendingPermissionRequestCount: Number(input.pendingPermissionRequestCount || 0),
    eventCount: Number(input.eventCount || 0),
    progressEventCount: Number(input.progressEventCount || 0),
    reasoningEventCount: Number(input.reasoningEventCount || 0),
    reasoningIncluded: input.reasoningIncluded === true,
    globalAuditId: asText(input.globalAuditId),
    artifactRef: asText(input.artifactRef),
    policyRevision: input.policyRevision ?? null
  };
}

function sourceTurnSummary(turn = {}) {
  const input = asObject(turn);
  const communicationSummary = sourceCommunicationSummary(input.communicationSummary);
  const summary = {
    relayTurnId: asText(input.relayTurnId),
    relaySessionId: asText(input.relaySessionId),
    operationId: asText(input.operationId),
    effectiveMode: asText(input.effectiveMode),
    progressVisibility: asText(input.progressVisibility),
    reasoningVisibility: input.reasoningVisibility === true,
    status: asText(input.status),
    stopReason: asText(input.stopReason),
    startedAt: asText(input.startedAt),
    updatedAt: asText(input.updatedAt),
    completedAt: asText(input.completedAt),
    idempotencyKey: asText(input.idempotencyKey),
    globalAuditId: asText(input.globalAuditId),
    artifactRef: asText(input.artifactRef),
    pendingPermissionCount: Number(input.pendingPermissionCount || 0),
    permissionRequestCount: Number(input.permissionRequestCount || 0),
    responseKind: asText(input.responseKind || communicationSummary?.summaryKind || sourceResponseKind(input)),
    communicationSummary
  };
  if (Array.isArray(input.pendingPermissionRequests)) {
    summary.pendingPermissionRequests = sanitizePermissionRequests(input.pendingPermissionRequests);
  }
  return summary;
}

function sourceWakeSummary(wake = null) {
  const input = asObject(wake, null);
  if (!input) {
    return null;
  }
  return {
    ok: input.ok !== false,
    wokenAt: asText(input.wokenAt),
    transportType: asText(input.transportType),
    finalResponsePolicy: asText(input.finalResponsePolicy)
  };
}

function sourceSessionSummary(session = {}) {
  const input = asObject(session);
  const summary = {
    relaySessionId: asText(input.relaySessionId),
    sourceId: asText(input.sourceId),
    sourceSessionId: asText(input.sourceSessionId),
    sourceSubjectId: asText(input.sourceSubjectId),
    workspaceId: asText(input.workspaceId),
    virtualAgentId: asText(input.virtualAgentId),
    targetId: asText(input.targetId),
    lifecycleState: asText(input.lifecycleState),
    wakePolicy: asText(input.wakePolicy),
    policyRevision: Number(input.policyRevision || 0),
    lastOperationId: asText(input.lastOperationId),
    lastWokenAt: asText(input.lastWokenAt),
    createdAt: asText(input.createdAt),
    updatedAt: asText(input.updatedAt),
    pendingPermissionCount: Number(input.pendingPermissionCount || 0),
    turnCount: Number(input.turnCount || 0),
    lastWakeResult: sourceWakeSummary(input.lastWakeResult),
    latestTurn: input.latestTurn ? sourceTurnSummary(input.latestTurn) : null,
    capabilitiesSnapshot: asObject(input.capabilitiesSnapshot, null)
  };
  if (Array.isArray(input.pendingPermissionRequests)) {
    summary.pendingPermissionRequests = sanitizePermissionRequests(input.pendingPermissionRequests);
  }
  return summary;
}

async function sourceCapabilitiesForSession(executor = null, session = {}, input = {}) {
  if (executor && typeof executor.capabilitySnapshotForSession === "function" && session) {
    try {
      const snapshot = await executor.capabilitySnapshotForSession(session, input);
      return {
        capabilities: snapshot?.capabilities || null,
        capabilitiesSnapshot: snapshot || null,
        route: snapshot?.route || null,
        capabilitiesSnapshotError: ""
      };
    } catch (error) {
      return {
        capabilities: null,
        capabilitiesSnapshot: null,
        route: null,
        capabilitiesSnapshotError: asText(error?.message || error)
      };
    }
  }
  return {
    capabilities: null,
    capabilitiesSnapshot: null,
    route: null,
    capabilitiesSnapshotError: "capability snapshot resolver is unavailable"
  };
}

function sourceCapabilitiesFromOperationOrSession(operationData = {}, session = {}, fallback = {}) {
  if (operationData.capabilitiesSnapshot) {
    return {
      capabilities: operationData.capabilities || operationData.capabilitiesSnapshot.capabilities || null,
      capabilitiesSnapshot: operationData.capabilitiesSnapshot,
      route: operationData.capabilitiesSnapshot.route || null,
      capabilitiesSnapshotError: asText(operationData.capabilitiesSnapshotError)
    };
  }
  const persistedSnapshot = asObject(session.capabilitiesSnapshot || session.metadata?.capabilitiesSnapshot, null);
  if (persistedSnapshot) {
    return {
      capabilities: persistedSnapshot.capabilities || null,
      capabilitiesSnapshot: persistedSnapshot,
      route: persistedSnapshot.route || null,
      capabilitiesSnapshotError: ""
    };
  }
  return fallback;
}

async function emitSourceUpdates(context = {}, events = [], { relaySessionId = "", turnId = "" } = {}) {
  if (typeof context.emitSourceNotification !== "function") {
    return [];
  }
  const emitted = [];
  let previousNotificationKey = "";
  for (const event of Array.isArray(events) ? events : []) {
    const notification = createNotification(
      ACP_METHODS.sessionUpdate,
      sourceUpdateFromRelayEvent(event, {
        relaySessionId,
        turnId
      })
    );
    const key = notificationDedupeKey(notification);
    if (key === previousNotificationKey) {
      continue;
    }
    previousNotificationKey = key;
    await context.emitSourceNotification(notification);
    emitted.push(notification);
  }
  return emitted;
}

async function emitSourceSessionReplay(context = {}, store = null, session = {}, options = {}) {
  if (typeof context.emitSourceNotification !== "function" || !store || typeof store.listTurns !== "function") {
    return [];
  }
  const includeReasoning = options.requestReasoning === true;
  const relaySessionId = asText(session.relaySessionId || session.sessionId || session.id);
  if (!relaySessionId) {
    return [];
  }
  const turns = await store.listTurns(relaySessionId).catch(() => []);
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .slice()
    .sort((a, b) => asText(a.startedAt || a.createdAt).localeCompare(asText(b.startedAt || b.createdAt)));
  const emitted = [];
  for (const turn of orderedTurns) {
    if (!turn?.relayTurnId || typeof store.listEvents !== "function") {
      continue;
    }
    const events = await store.listEvents(turn.relayTurnId).catch(() => []);
    const orderedEvents = (Array.isArray(events) ? events : [])
      .filter((event) => includeReasoning || event?.type !== "reasoning_trace")
      .slice()
      .sort((a, b) => {
        const sequenceDiff = Number(a.sequence || 0) - Number(b.sequence || 0);
        return sequenceDiff || asText(a.createdAt).localeCompare(asText(b.createdAt));
      });
    emitted.push(...await emitSourceUpdates(context, orderedEvents, {
      relaySessionId,
      turnId: asText(turn.relayTurnId)
    }));
  }
  return emitted;
}

export class AcpSourceJsonRpcBridge {
  constructor({
    inboundFacade,
    executor = null,
    store = null,
    defaultVirtualAgentId = "",
    defaultSourceId = "source.acp",
    defaultWorkspaceId = "default",
    logger = null
  } = {}) {
    this.inboundFacade = inboundFacade || (executor ? { executor } : null);
    this.executor = executor || inboundFacade?.executor || null;
    this.store = store || inboundFacade?.store || executor?.store || null;
    this.defaultVirtualAgentId = asText(defaultVirtualAgentId);
    this.defaultSourceId = asText(defaultSourceId, "source.acp");
    this.defaultWorkspaceId = asText(defaultWorkspaceId, "default");
    this.logger = logger;
    this.sourceSessions = new Map();
    this.sourceIdentity = {
      sourceId: this.defaultSourceId,
      workspaceId: this.defaultWorkspaceId,
      sourceSessionId: "",
      virtualAgentId: this.defaultVirtualAgentId,
      sourceSubjectId: ""
    };
    this.sourceIdentityLocked = false;
    this.sourceIdentitiesByContext = new WeakMap();
  }

  async handle(rawMessage, context = null) {
    let message;
    try {
      message = parseJsonRpcFrame(normalizeIncomingJsonRpcMessage(rawMessage));
    } catch (error) {
      return jsonRpcError(null, JSON_RPC_PARSE_ERROR, error.message || "Invalid JSON-RPC message.");
    }

    if (Array.isArray(message)) {
      return this.handleBatch(message, context);
    }

    try {
      message = parseJsonRpcMessage(message);
    } catch (error) {
      return jsonRpcError(null, JSON_RPC_INVALID_REQUEST, error.message || "Invalid JSON-RPC message.");
    }

    if (isJsonRpcResponseMessage(message)) {
      return null;
    }

    if (!message.method) {
      return jsonRpcError(Object.hasOwn(message, "id") ? message.id : null, JSON_RPC_INVALID_REQUEST, "JSON-RPC request method is required.");
    }

    const hasResponse = Object.hasOwn(message, "id");
    const response = await this.dispatch(message, context).catch((error) => {
      if (this.logger && typeof this.logger.error === "function") {
        this.logger.error("ACP source JSON-RPC bridge failed.", error);
      }
      return jsonRpcError(message.id, JSON_RPC_INTERNAL_ERROR, error.message || "ACP relay JSON-RPC bridge failed.", {
        method: message.method
      });
    });
    return hasResponse ? response : null;
  }

  async handleBatch(messages = [], context = null) {
    if (messages.length === 0) {
      return jsonRpcError(null, JSON_RPC_INVALID_REQUEST, "JSON-RPC batch must contain at least one message.");
    }
    const responses = await Promise.all(messages.map(async (rawMessage) => {
      let message;
      try {
        message = parseJsonRpcMessage(rawMessage);
      } catch (error) {
        return jsonRpcError(null, JSON_RPC_INVALID_REQUEST, error.message || "Invalid JSON-RPC batch message.");
      }
      if (isJsonRpcResponseMessage(message)) {
        return null;
      }
      if (!Object.hasOwn(message, "id")) {
        await this.dispatch(message, context).catch((error) => {
          if (this.logger && typeof this.logger.error === "function") {
            this.logger.error("ACP source JSON-RPC batch notification failed.", error);
          }
        });
        return null;
      }
      return this.dispatch(message, context).catch((error) => {
        if (this.logger && typeof this.logger.error === "function") {
          this.logger.error("ACP source JSON-RPC batch request failed.", error);
        }
        return jsonRpcError(message.id, JSON_RPC_INTERNAL_ERROR, error.message || "ACP relay JSON-RPC bridge failed.", {
          method: message.method
        });
      });
    }));
    const responseMessages = responses.filter((response) => response !== null && response !== undefined);
    return responseMessages.length > 0 ? responseMessages : null;
  }

  async dispatch(message = {}, context = null) {
    const params = asObject(message.params);
    switch (message.method) {
      case ACP_METHODS.initialize:
        return this.initialize(message.id, params, context);
      case ACP_METHODS.pactAgentList:
      case ACP_METHODS.agentList:
        return this.listAgents(message.id, params, context);
      case ACP_METHODS.pactTargetList:
      case ACP_METHODS.targetList:
        return this.listTargets(message.id, params, context);
      case ACP_METHODS.pactSessionList:
      case ACP_METHODS.sessionList:
        return this.listSessions(message.id, params, context);
      case ACP_METHODS.pactSessionGet:
      case ACP_METHODS.sessionGet:
        return this.getSession(message.id, params, context);
      case ACP_METHODS.pactTurnList:
      case ACP_METHODS.turnList:
        return this.listTurns(message.id, params, context);
      case ACP_METHODS.pactTurnObserve:
      case ACP_METHODS.turnObserve:
        return this.observeTurn(message.id, params, context);
      case ACP_METHODS.sessionNew:
        return this.newSession(message.id, params, context);
      case ACP_METHODS.sessionLoad:
        return this.loadSession(message.id, params, context);
      case ACP_METHODS.sessionResume:
        return this.resumeSession(message.id, params, context);
      case ACP_METHODS.sessionPrompt:
        return this.prompt(message.id, params, context);
      case ACP_METHODS.sessionRequestPermission:
        return this.resolvePermission(message.id, params, context);
      case ACP_METHODS.fsReadTextFile:
        return this.readTextFile(message.id, params, context);
      case ACP_METHODS.fsWriteTextFile:
        return this.writeTextFile(message.id, params, context);
      case ACP_METHODS.sessionCancel:
        return this.cancel(message.id, params, context);
      case ACP_METHODS.sessionClose:
        return this.close(message.id, params, context);
      default:
        return jsonRpcError(message.id, JSON_RPC_METHOD_NOT_FOUND, `Unsupported ACP method: ${message.method}`, {
          method: message.method
        });
    }
  }

  resolveSourceContext(params = {}, context = null) {
    const contextObject = context && typeof context === "object" && !Array.isArray(context) ? context : null;
    const contextState = contextObject ? asObject(this.sourceIdentitiesByContext.get(contextObject), null) : null;
    const authenticationIdentity = normalizeAcpSourceAuthenticationContext(contextObject || {});
    const contextIdentity = {
      ...asObject(contextObject),
      ...(asObject(contextObject?.sourceIdentity) || {}),
      ...authenticationIdentity,
      ...asObject(contextState?.identity)
    };
    const paramIdentity = {
      ...asObject(params.sourceIdentity),
      ...asObject(params)
    };
    const pick = (input = {}, keys = []) => {
      for (const key of keys) {
        const value = asText(input[key]);
        if (value) {
          return value;
        }
      }
      return "";
    };
    const chooseIdentity = (keys = [], fallback = "") => {
      const trusted = pick(contextIdentity, keys);
      if (trusted) {
        return trusted;
      }
      const remembered = !contextObject && this.sourceIdentityLocked ? pick(this.sourceIdentity, keys) : "";
      if (remembered) {
        return remembered;
      }
      return pick(paramIdentity, keys) || fallback;
    };
    const sourceId = chooseIdentity(["sourceId", "source_id"], this.defaultSourceId);
    const workspaceId = chooseIdentity(["workspaceId", "workspace_id"], this.defaultWorkspaceId);
    const sourceSessionId = chooseIdentity(["sourceSessionId", "source_session_id"], "");
    const virtualAgentId = chooseIdentity(
      ["virtualAgentId", "virtual_agent_id", "agentId", "agent_id"],
      this.defaultVirtualAgentId
    );
    const sourceSubjectId = chooseIdentity(["sourceSubjectId", "source_subject_id", "subjectId", "subject_id"], "");
    const agentProfileId = chooseIdentity(["agentProfileId", "agent_profile_id", "profileId", "profile_id"], "");
    const sourceIdentityTrusted = Boolean(
      contextState?.identity?.sourceIdentityTrusted === true ||
        authenticationIdentity.sourceIdentityTrusted === true ||
        authenticationIdentity.authContextTrusted === true ||
        contextObject?.sourceIdentityTrusted === true ||
        contextObject?.authContextTrusted === true ||
        asObject(contextObject?.sourceAuthContext).sourceIdentityTrusted === true ||
        asObject(contextObject?.sourceAuthContext).authContextTrusted === true ||
        this.sourceIdentity.sourceIdentityTrusted === true
    );
    const sourceAuthContext = sourceAuthContextForOperation({
      ...authenticationIdentity,
      ...asObject(contextState?.identity),
      sourceId,
      workspaceId,
      sourceSessionId,
      virtualAgentId,
      sourceSubjectId,
      agentProfileId,
      sourceIdentityTrusted
    });

    return {
      sourceId,
      workspaceId,
      sourceSessionId,
      virtualAgentId,
      sourceSubjectId,
      ...(agentProfileId ? { agentProfileId } : {}),
      ...(sourceIdentityTrusted ? { sourceIdentityTrusted } : {}),
      ...(Object.keys(sourceAuthContext).length > 0 ? { sourceAuthContext } : {})
    };
  }

  publicSourceIdentity(sourceContext = {}) {
    return sourcePublicIdentity(sourceContext);
  }

  rememberSourceContext(params = {}, context = null) {
    const next = this.resolveSourceContext(params, context);
    const identity = {
      sourceId: next.sourceId,
      workspaceId: next.workspaceId,
      sourceSessionId: next.sourceSessionId || this.sourceIdentity.sourceSessionId,
      virtualAgentId: next.virtualAgentId,
      sourceSubjectId: next.sourceSubjectId || this.sourceIdentity.sourceSubjectId,
      ...(next.agentProfileId ? { agentProfileId: next.agentProfileId } : {}),
      ...(next.sourceIdentityTrusted ? { sourceIdentityTrusted: true } : {}),
      ...(next.sourceAuthContext ? { sourceAuthContext: next.sourceAuthContext } : {})
    };
    const contextObject = context && typeof context === "object" && !Array.isArray(context) ? context : null;
    if (contextObject) {
      this.sourceIdentitiesByContext.set(contextObject, { identity });
    } else {
      this.sourceIdentity = identity;
      this.sourceIdentityLocked = true;
    }
    return identity;
  }

  rememberSession(session = {}, context = null) {
    const sourceContext = this.resolveSourceContext({ ...context, ...session });
    const sourceId = asText(session.sourceId || sourceContext.sourceId, this.defaultSourceId);
    const workspaceId = asText(session.workspaceId || sourceContext.workspaceId, this.defaultWorkspaceId);
    const sourceSessionId = asText(session.sourceSessionId || sourceContext.sourceSessionId);
    const virtualAgentId = asText(session.virtualAgentId || sourceContext.virtualAgentId || this.defaultVirtualAgentId);
    const key = sourceSessionKey({ sourceId, workspaceId, sourceSessionId, virtualAgentId });
    if (sourceSessionId) {
      this.sourceSessions.set(key, asText(session.relaySessionId || session.sessionId || session.id));
    }
    const identity = {
      sourceId,
      workspaceId,
      sourceSessionId: sourceSessionId || this.sourceIdentity.sourceSessionId,
      virtualAgentId,
      sourceSubjectId: asText(session.sourceSubjectId || sourceContext.sourceSubjectId || this.sourceIdentity.sourceSubjectId),
      ...(sourceContext.agentProfileId ? { agentProfileId: sourceContext.agentProfileId } : {}),
      ...(sourceContext.sourceIdentityTrusted ? { sourceIdentityTrusted: true } : {}),
      ...(sourceContext.sourceAuthContext ? { sourceAuthContext: sourceContext.sourceAuthContext } : {})
    };
    const contextObject = context && typeof context === "object" && !Array.isArray(context) ? context : null;
    if (contextObject) {
      this.sourceIdentitiesByContext.set(contextObject, { identity });
    } else {
      this.sourceIdentity = identity;
      this.sourceIdentityLocked = true;
    }
    return key;
  }

  async resolveSession(params = {}, context = null) {
    const sourceContext = this.resolveSourceContext(params, context);
    const directRelaySessionId = pickSessionId(params);
    if (directRelaySessionId && this.store?.getSession) {
      const directSession = await this.store.getSession(directRelaySessionId);
      if (directSession && sessionMatchesSourceContext(directSession, sourceContext)) {
        this.rememberSession(directSession, context);
        return directSession;
      }
      return null;
    }

    const key = sourceSessionKey(sourceContext);
    const mappedRelaySessionId = this.sourceSessions.get(key);
    if (mappedRelaySessionId && this.store?.getSession) {
      const mappedSession = await this.store.getSession(mappedRelaySessionId);
      if (mappedSession && sessionMatchesSourceContext(mappedSession, sourceContext)) {
        this.rememberSession(mappedSession, context);
        return mappedSession;
      }
      this.sourceSessions.delete(key);
    }

    if (this.store?.getSessionBySourceKey) {
      const session = await this.store.getSessionBySourceKey(sourceContext);
      if (session && sessionMatchesSourceContext(session, sourceContext)) {
        this.rememberSession(session, context);
        return session;
      }
    }

    return null;
  }

  async initialize(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const virtualAgentId = pickVirtualAgentId(params, sourceContext.virtualAgentId || this.defaultVirtualAgentId);
    if (!virtualAgentId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "initialize requires virtualAgentId.");
    }
    const operation = await this.inboundFacade.initialize(this.sourceBoundInput({ ...params, virtualAgentId }, sourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    const sourceIdentity = this.rememberSourceContext({ virtualAgentId }, context);
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceIdentity),
      virtualAgentId,
      agentCapabilities: sourceAgentCapabilitiesFromProjection(normalized.data),
      sessionCapabilities: sourceSessionCapabilitiesFromProjection(normalized.data),
      virtualAgent: normalized.data.virtualAgent,
      capabilities: normalized.data.capabilities,
      capabilitiesSnapshot: normalized.data.capabilitiesSnapshot || normalized.data.virtualAgent || null,
      virtualAgents: normalized.data.virtualAgents || []
    });
  }

  async listAgents(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.listVirtualAgents
      ? await this.inboundFacade.listVirtualAgents(input)
      : await this.executor.execute("acp_agent_relay.virtual_agents.list", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      virtualAgents: normalized.data.virtualAgents || []
    });
  }

  async listTargets(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.listTargets
      ? await this.inboundFacade.listTargets(input)
      : await this.executor.execute("acp_agent_relay.targets.list", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      targets: normalized.data.targets || []
    });
  }

  sourceBoundInput(params = {}, sourceContext = {}) {
    const authContext = sourceAuthContextForOperation(sourceContext);
    return {
      ...params,
      sourceId: sourceContext.sourceId,
      workspaceId: sourceContext.workspaceId,
      sourceSessionId: sourceContext.sourceSessionId || params.sourceSessionId || params.source_session_id,
      sourceSubjectId: sourceContext.sourceSubjectId || params.sourceSubjectId || params.source_subject_id || params.subjectId || params.subject_id,
      virtualAgentId: sourceContext.virtualAgentId || params.virtualAgentId || params.virtual_agent_id || params.agentId || params.agent_id,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      ...(Object.keys(authContext).length > 0 ? { sourceAuthContext: authContext } : {})
    };
  }

  async listSessions(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.listSessions
      ? await this.inboundFacade.listSessions(input)
      : await this.executor.execute("acp_agent_relay.sessions.list", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      sessions: (Array.isArray(normalized.data.sessions) ? normalized.data.sessions : []).map((session) => sourceSessionSummary(session)),
      count: Number(normalized.data.count || 0),
      limit: Number(normalized.data.limit || 0)
    });
  }

  async getSession(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.getSession
      ? await this.inboundFacade.getSession(input)
      : await this.executor.execute("acp_agent_relay.sessions.get", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      session: normalized.data.session ? sourceSessionSummary(normalized.data.session) : null,
      turns: (Array.isArray(normalized.data.turns) ? normalized.data.turns : []).map((turn) => sourceTurnSummary(turn))
    });
  }

  async listTurns(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.listTurns
      ? await this.inboundFacade.listTurns(input)
      : await this.executor.execute("acp_agent_relay.turns.list", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      relaySessionId: normalized.data.relaySessionId || params.relaySessionId || params.sessionId || params.id || "",
      turns: (Array.isArray(normalized.data.turns) ? normalized.data.turns : []).map((turn) => sourceTurnSummary(turn)),
      count: Number(normalized.data.count || 0),
      limit: Number(normalized.data.limit || 0)
    });
  }

  async observeTurn(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.observeTurn
      ? await this.inboundFacade.observeTurn(input)
      : await this.executor.execute("acp_agent_relay.turn.observe", input);
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized, {
        sourceIdentity: this.publicSourceIdentity(sourceContext)
      });
    }
    const communicationSummary = sourceCommunicationSummary(normalized.data.communicationSummary);
    return createSuccess(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      pactProtocolVersion: PACT_ACP_AGENT_RELAY_PROTOCOL_VERSION,
      sourceIdentity: this.publicSourceIdentity(sourceContext),
      relaySessionId: normalized.data.session?.relaySessionId || params.relaySessionId || params.sessionId || "",
      relayTurnId: normalized.data.turn?.relayTurnId || normalized.data.turnSummary?.relayTurnId || params.relayTurnId || params.turnId || "",
      turnId: normalized.data.turn?.relayTurnId || normalized.data.turnSummary?.relayTurnId || params.relayTurnId || params.turnId || "",
      observed: normalized.data.observed === true,
      observationAvailable: normalized.data.observationAvailable === true,
      refreshed: normalized.data.refreshed === true,
      reasonCode: asText(normalized.data.reasonCode),
      message: asText(normalized.data.message),
      stopReason: asText(normalized.data.stopReason),
      outputSummary: asText(normalized.data.outputSummary),
      responseKind: asText(
        normalized.data.responseKind ||
          communicationSummary?.summaryKind ||
          normalized.data.turnSummary?.responseKind ||
          normalized.data.turn?.responseKind ||
          sourceResponseKind(normalized.data)
      ),
      communicationSummary,
      externalCompletionState: asText(normalized.data.communicationSummary?.externalCompletionState),
      finalResponseAvailable: normalized.data.communicationSummary?.finalResponseAvailable === true,
      finalResponsePolicy: asText(normalized.data.communicationSummary?.finalResponsePolicy),
      turn: normalized.data.turnSummary
        ? sourceTurnSummary(normalized.data.turnSummary)
        : sourceTurnSummary(normalized.data.turn || {}),
      targetObservation: asObject(normalized.data.targetObservation, null)
    });
  }

  async newSession(id, params = {}, context = {}) {
    const sourceContext = this.rememberSourceContext(params, context);
    const virtualAgentId = pickVirtualAgentId(params, sourceContext.virtualAgentId || this.defaultVirtualAgentId);
    if (!virtualAgentId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "session/new requires virtualAgentId.");
    }
    const operation = await this.inboundFacade.newSession(this.sourceBoundInput({
      ...params,
      sourceId: sourceContext.sourceId,
      sourceSessionId: sourceContext.sourceSessionId || asText(`source_${Date.now()}`),
      virtualAgentId,
      workspaceId: sourceContext.workspaceId,
      sourceSubjectId: sourceContext.sourceSubjectId,
      requestedMode: params.mode || params.requestedMode || params.promptMode
    }, sourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, normalized.message, normalized);
    }
    const session = normalized.data.session;
    this.rememberSession(session, context);
    return createSuccess(id, {
      sessionId: session.relaySessionId,
      relaySessionId: session.relaySessionId,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId,
      targetSessionId: session.targetSessionId || "",
      targetResumeRef: session.targetResumeRef || "",
      lifecycleState: session.lifecycleState,
      capabilities: normalized.data.capabilities || normalized.data.capabilitiesSnapshot?.capabilities || null,
      capabilitiesSnapshot: normalized.data.capabilitiesSnapshot || null,
      session,
      route: normalized.data.capabilitiesSnapshot?.route || null
    });
  }

  async loadSession(id, params = {}, context = {}) {
    const sourceContext = this.resolveSourceContext(params, context);
    const input = this.sourceBoundInput(params, sourceContext);
    const operation = this.inboundFacade.loadSession
      ? await this.inboundFacade.loadSession(input)
      : { ok: true, data: { session: await this.resolveSession(params, context) } };
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized, {
        sourceIdentity: this.publicSourceIdentity(sourceContext),
      });
    }
    const session = normalized.data.session;
    if (!session) {
      return relayOperationError(id, {
        ok: false,
        code: "relay_session_not_found",
        message: "session/load could not find a matching session.",
        data: { code: "relay_session_not_found" }
      }, {
        sourceIdentity: this.publicSourceIdentity(sourceContext)
      });
    }
    const fallbackProjection = await sourceCapabilitiesForSession(this.executor, session, { ...params, ...sourceContext });
    const capabilityProjection = sourceCapabilitiesFromOperationOrSession(normalized.data, session, fallbackProjection);
    this.rememberSession(session, context);
	    const replayNotifications = await emitSourceSessionReplay(context, this.store, session, {
	      requestReasoning: params.requestReasoning === true
	    });
	    const pendingPermissionRequests = await pendingPermissionRequestsForSession(this.store, session);
	    return createSuccess(id, {
      sessionId: session.relaySessionId,
      relaySessionId: session.relaySessionId,
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      workspaceId: session.workspaceId,
      targetSessionId: session.targetSessionId || "",
      targetResumeRef: session.targetResumeRef || "",
      lifecycleState: session.lifecycleState,
      capabilities: capabilityProjection.capabilities,
      capabilitiesSnapshot: capabilityProjection.capabilitiesSnapshot,
      capabilitiesSnapshotError: capabilityProjection.capabilitiesSnapshotError,
	      route: capabilityProjection.route,
	      replayedUpdateCount: replayNotifications.length,
	      pendingPermissionRequests: sanitizePermissionRequests(pendingPermissionRequests),
	      pendingPermissionRequestCount: pendingPermissionRequests.length,
	      session
	    });
  }

  async resumeSession(id, params = {}, context = {}) {
    const session = await this.resolveSession(params, context);
    const relaySessionId = session?.relaySessionId || this.resolveRelaySessionId(params, context);
    if (!relaySessionId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "session/load or session/resume requires sessionId.");
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const boundSourceContext = {
      ...sourceContext,
      sourceId: session?.sourceId || sourceContext.sourceId,
      sourceSessionId: session?.sourceSessionId || sourceContext.sourceSessionId,
      workspaceId: session?.workspaceId || sourceContext.workspaceId,
      virtualAgentId: session?.virtualAgentId || sourceContext.virtualAgentId,
      sourceSubjectId: session?.sourceSubjectId || sourceContext.sourceSubjectId
    };
    const operation = await this.inboundFacade.resumeSession(this.sourceBoundInput({
      ...params,
      relaySessionId,
      sessionId: relaySessionId
    }, boundSourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized);
    }
	    const resumedSession = normalized.data.session;
	    this.rememberSession(resumedSession, context);
	    const capabilityProjection = sourceCapabilitiesFromOperationOrSession(normalized.data, resumedSession);
	    const pendingPermissionRequests = await pendingPermissionRequestsForSession(this.store, resumedSession);
	    return createSuccess(id, {
      sessionId: resumedSession.relaySessionId,
      relaySessionId: resumedSession.relaySessionId,
      sourceId: resumedSession.sourceId,
      sourceSessionId: resumedSession.sourceSessionId,
      virtualAgentId: resumedSession.virtualAgentId,
      workspaceId: resumedSession.workspaceId,
      targetSessionId: resumedSession.targetSessionId || "",
      targetResumeRef: resumedSession.targetResumeRef || "",
      lifecycleState: resumedSession.lifecycleState,
      capabilities: capabilityProjection.capabilities,
      capabilitiesSnapshot: capabilityProjection.capabilitiesSnapshot,
	      capabilitiesSnapshotError: capabilityProjection.capabilitiesSnapshotError,
	      route: capabilityProjection.route,
	      pendingPermissionRequests: sanitizePermissionRequests(pendingPermissionRequests),
	      pendingPermissionRequestCount: pendingPermissionRequests.length,
	      session: resumedSession
	    });
  }

  async prompt(id, params = {}, context = {}) {
    const session = await this.resolveSession(params, context);
    const relaySessionId = session?.relaySessionId || this.resolveRelaySessionId(params, context);
    if (!relaySessionId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "session/prompt requires sessionId.");
    }
    const promptText = extractAcpPromptText(params);
    const sourceContext = this.resolveSourceContext(params, context);
    const boundSourceContext = {
      ...sourceContext,
      sourceId: session?.sourceId || sourceContext.sourceId,
      sourceSessionId: session?.sourceSessionId || sourceContext.sourceSessionId,
      workspaceId: session?.workspaceId || sourceContext.workspaceId,
      virtualAgentId: session?.virtualAgentId || sourceContext.virtualAgentId,
      sourceSubjectId: session?.sourceSubjectId || sourceContext.sourceSubjectId
    };
    const operation = await this.inboundFacade.prompt(this.sourceBoundInput({
      ...params,
      relaySessionId,
      sessionId: relaySessionId,
      prompt: promptText,
      requestReasoning: params.requestReasoning === true
    }, boundSourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized);
    }
    if (typeof context.emitSourceNotification === "function") {
      const turnId = normalized.data.turn?.relayTurnId || "";
      const eventsToEmit = Object.hasOwn(normalized.data, "newEvents")
        ? normalized.data.newEvents
        : normalized.data.events;
      await emitSourceUpdates(context, eventsToEmit, { relaySessionId, turnId });
    }
    this.rememberSession(normalized.data.session || session || {}, context);
    const communicationSummary = normalized.data.communicationSummary || null;
    const responseKind = asText(
      normalized.data.responseKind ||
        asObject(communicationSummary, null)?.summaryKind ||
        sourceResponseKind(normalized.data)
    );
    return createSuccess(id, {
      sessionId: normalized.data.session?.relaySessionId || relaySessionId,
      relaySessionId,
      sourceId: normalized.data.session?.sourceId || session?.sourceId || "",
      sourceSessionId: normalized.data.session?.sourceSessionId || session?.sourceSessionId || "",
      virtualAgentId: normalized.data.session?.virtualAgentId || session?.virtualAgentId || "",
      workspaceId: normalized.data.session?.workspaceId || session?.workspaceId || "",
      turnId: normalized.data.turn?.relayTurnId || "",
      turn: normalized.data.turn ? sourceTurnSummary(normalized.data.turn) : null,
      stopReason: normalized.data.stopReason || "completed",
      acpStopReason: normalizeAcpStopReason(normalized.data.stopReason || "completed"),
      responseKind,
      output: normalized.data.outputSummary || "",
      content: normalized.data.outputSummary
        ? { type: "text", text: normalized.data.outputSummary }
        : null,
      events: normalized.data.events || [],
      newEvents: normalized.data.newEvents || [],
      receipts: normalized.data.receipts || [],
      pendingPermissionRequests: sanitizePermissionRequests(normalized.data.pendingPermissionRequests),
      idempotencyReplay: normalized.data.idempotencyReplay === true,
      audit: normalized.data.audit || null,
      targetEvidence: normalized.data.targetEvidence || null,
      communicationSummary,
      session: normalized.data.session || session || null
    });
  }

  async resolvePermission(id, params = {}, context = {}) {
    const session = await this.resolveSession(params, context);
    const relaySessionId = session?.relaySessionId || this.resolveRelaySessionId(params, context);
    const sourceContext = this.resolveSourceContext(params, context);
    const boundSourceContext = {
      ...sourceContext,
      sourceId: session?.sourceId || sourceContext.sourceId,
      sourceSessionId: session?.sourceSessionId || sourceContext.sourceSessionId,
      workspaceId: session?.workspaceId || sourceContext.workspaceId,
      virtualAgentId: session?.virtualAgentId || sourceContext.virtualAgentId,
      sourceSubjectId: session?.sourceSubjectId || sourceContext.sourceSubjectId
    };
    const operation = this.inboundFacade.resolvePermission
      ? await this.inboundFacade.resolvePermission(this.sourceBoundInput({
          ...params,
          relaySessionId,
          sessionId: relaySessionId
        }, boundSourceContext))
      : await this.executor.execute("acp_agent_relay.permission.resolve", this.sourceBoundInput({
          ...params,
          relaySessionId,
          sessionId: relaySessionId
        }, boundSourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized);
    }
    const resultSession = normalized.data.session || session || null;
    const resultRelaySessionId = resultSession?.relaySessionId || relaySessionId;
    const turnId = normalized.data.turn?.relayTurnId || "";
    const eventsToEmit = Object.hasOwn(normalized.data, "newEvents")
      ? normalized.data.newEvents
      : normalized.data.events;
    await emitSourceUpdates(context, eventsToEmit, {
      relaySessionId: resultRelaySessionId,
      turnId
    });
    if (resultSession) {
      this.rememberSession(resultSession, context);
    }
    const communicationSummary = normalized.data.communicationSummary || null;
    const responseKind = asText(
      normalized.data.responseKind ||
        asObject(communicationSummary, null)?.summaryKind ||
        sourceResponseKind(normalized.data)
    );
    return createSuccess(id, {
      sessionId: resultRelaySessionId,
      relaySessionId: resultRelaySessionId,
      requestId: normalized.data.permissionRequest?.requestId || params.requestId || "",
      permissionRequest: normalized.data.permissionRequest ? sanitizePermissionRequest(normalized.data.permissionRequest) : null,
      alreadyResolved: normalized.data.alreadyResolved === true,
      remainingPermissionRequests: sanitizePermissionRequests(normalized.data.remainingPermissionRequests),
      turnId,
      turn: normalized.data.turn ? sourceTurnSummary(normalized.data.turn) : null,
      stopReason: normalized.data.stopReason || "",
      acpStopReason: normalizeAcpStopReason(normalized.data.stopReason || ""),
      responseKind,
      output: normalized.data.outputSummary || "",
      content: normalized.data.outputSummary
        ? { type: "text", text: normalized.data.outputSummary }
        : null,
      events: normalized.data.events || [],
      newEvents: normalized.data.newEvents || [],
      receipts: normalized.data.receipts || (normalized.data.receipt ? [normalized.data.receipt] : []),
      audit: normalized.data.audit || null,
      targetEvidence: normalized.data.targetEvidence || null,
      communicationSummary,
      session: resultSession
    });
  }

  async cancel(id, params = {}, context = {}) {
    const session = await this.resolveSession(params, context);
    const relaySessionId = session?.relaySessionId || this.resolveRelaySessionId(params, context);
    if (!relaySessionId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "session/cancel requires sessionId.");
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const boundSourceContext = {
      ...sourceContext,
      sourceId: session?.sourceId || sourceContext.sourceId,
      sourceSessionId: session?.sourceSessionId || sourceContext.sourceSessionId,
      workspaceId: session?.workspaceId || sourceContext.workspaceId,
      virtualAgentId: session?.virtualAgentId || sourceContext.virtualAgentId,
      sourceSubjectId: session?.sourceSubjectId || sourceContext.sourceSubjectId
    };
    const operation = await this.inboundFacade.cancel(this.sourceBoundInput({
      ...params,
      relaySessionId,
      sessionId: relaySessionId
    }, boundSourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized);
    }
    return createSuccess(id, {
      sessionId: relaySessionId,
      relaySessionId,
      sourceId: normalized.data.session?.sourceId || session?.sourceId || "",
      sourceSessionId: normalized.data.session?.sourceSessionId || session?.sourceSessionId || "",
      cancel: normalized.data.cancel,
      cancelledTurns: normalized.data.cancelledTurns || [],
      lifecycleState: normalized.data.session?.lifecycleState || "",
      session: normalized.data.session || session || null
    });
  }

  async resolveRouteForSourceFs(params = {}, context = {}) {
    const sourceContext = this.resolveSourceContext(params, context);
    const virtualAgentId = pickVirtualAgentId(params, sourceContext.virtualAgentId || this.defaultVirtualAgentId);
    const router = this.executor?.router;
    if (!router || typeof router.resolveForSourceSession !== "function") {
      return { ok: false, error: { code: "relay_router_unavailable", message: "ACP relay router is unavailable." } };
    }
    return router.resolveForSourceSession(this.sourceBoundInput({
      ...params,
      virtualAgentId,
      sourceSubjectId: sourceContext.sourceSubjectId
    }, sourceContext));
  }

  async readTextFile(id, params = {}, context = {}) {
    if (!this.executor || typeof this.executor.execute !== "function") {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, "ACP relay file bridge is unavailable.", {
        method: ACP_METHODS.fsReadTextFile
      });
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const operation = await this.executor.execute("acp_agent_relay.fs.read_text_file", this.sourceBoundInput({
      ...params,
      virtualAgentId: pickVirtualAgentId(params, sourceContext.virtualAgentId || this.defaultVirtualAgentId),
      path: sanitizeFsPath(params.path || params.uri || params.filePath)
    }, sourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, -32003, normalized.message, normalized.data);
    }
    return createSuccess(id, {
      content: normalized.data.content,
      path: normalized.data.path,
      digest: normalized.data.digest,
      receipt: normalized.data.receipt
    });
  }

  async writeTextFile(id, params = {}, context = {}) {
    if (!this.executor || typeof this.executor.execute !== "function") {
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, "ACP relay file bridge is unavailable.", {
        method: ACP_METHODS.fsWriteTextFile
      });
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const operation = await this.executor.execute("acp_agent_relay.fs.write_text_file", this.sourceBoundInput({
      ...params,
      virtualAgentId: pickVirtualAgentId(params, sourceContext.virtualAgentId || this.defaultVirtualAgentId),
      path: sanitizeFsPath(params.path || params.uri || params.filePath),
      content: String(params.content ?? params.text ?? "")
    }, sourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return jsonRpcError(id, -32003, normalized.message, normalized.data);
    }
    return createSuccess(id, {
      ok: true,
      path: normalized.data.path,
      receipt: normalized.data.receipt
    });
  }

  async close(id, params = {}, context = {}) {
    const session = await this.resolveSession(params, context);
    const relaySessionId = session?.relaySessionId || this.resolveRelaySessionId(params, context);
    if (!relaySessionId) {
      return jsonRpcError(id, JSON_RPC_INVALID_REQUEST, "session/close requires sessionId.");
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const boundSourceContext = {
      ...sourceContext,
      sourceId: session?.sourceId || sourceContext.sourceId,
      sourceSessionId: session?.sourceSessionId || sourceContext.sourceSessionId,
      workspaceId: session?.workspaceId || sourceContext.workspaceId,
      virtualAgentId: session?.virtualAgentId || sourceContext.virtualAgentId,
      sourceSubjectId: session?.sourceSubjectId || sourceContext.sourceSubjectId
    };
    const operation = this.inboundFacade.closeSession
      ? await this.inboundFacade.closeSession(this.sourceBoundInput({
          ...params,
          relaySessionId,
          sessionId: relaySessionId
        }, boundSourceContext))
      : await this.executor.execute("acp_agent_relay.session.close", this.sourceBoundInput({
          ...params,
          relaySessionId,
          sessionId: relaySessionId
        }, boundSourceContext));
    const normalized = normalizeResult(operation);
    if (!normalized.ok) {
      return relayOperationError(id, normalized);
    }
    this.rememberSession(normalized.data.session || session || {}, context);
    return createSuccess(id, {
      sessionId: relaySessionId,
      relaySessionId,
      sourceId: normalized.data.session?.sourceId || session?.sourceId || "",
      sourceSessionId: normalized.data.session?.sourceSessionId || session?.sourceSessionId || "",
      close: normalized.data.close || null,
      lifecycleState: normalized.data.session?.lifecycleState || "closed",
      session: normalized.data.session || session || null
    });
  }

  resolveRelaySessionId(params = {}, context = {}) {
    const direct = pickSessionId(params);
    if (direct) {
      return direct;
    }
    const sourceContext = this.resolveSourceContext(params, context);
    const key = sourceSessionKey(sourceContext);
    return this.sourceSessions.get(key) || "";
  }
}

export function createAcpSourceJsonRpcBridge(options = {}) {
  return new AcpSourceJsonRpcBridge(options);
}
