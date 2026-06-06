import {
  ACP_METHODS,
  createError,
  createRequest,
  createSuccess,
  parseJsonRpcMessage
} from "../../../../common/protocols/acp/index.mjs";

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INTERNAL_ERROR = -32603;

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasJsonRpcTransport(transport) {
  return transport && typeof transport.send === "function" && typeof transport.receive === "function";
}

function transportIsReusable(transport = null) {
  if (!transport) {
    return true;
  }
  if (transport.closed === true) {
    return false;
  }
  const child = asObject(transport.child, null);
  if (child && (child.exitCode !== null || child.signalCode !== null)) {
    return false;
  }
  return true;
}

function outputTextFromResult(result = {}) {
  const payload = asObject(result);
  return asText(payload.output || payload.outputSummary || payload.text || payload.message || payload.content);
}

function textFromContentBlock(value = null) {
  if (typeof value === "string") {
    return asText(value);
  }
  const input = asObject(value, null);
  if (!input) {
    return "";
  }
  if (asText(input.type) === "text" && typeof input.text === "string") {
    return input.text;
  }
  return asText(input.text || input.content || input.message);
}

function textFromContentBlocks(values = []) {
  return asArray(values)
    .map((entry) => textFromContentBlock(entry))
    .filter(Boolean)
    .join("");
}

function normalizeAgentClientProtocolUpdate(entry = {}) {
  const input = asObject(entry);
  const update = asObject(input.update, null);
  if (!update) {
    return null;
  }
  const updateKind = asText(update.sessionUpdate || update.type || update.kind);
  const contentText = textFromContentBlock(update.content) || textFromContentBlocks(update.content);
  const text = asText(update.text || contentText || input.text);
  if (updateKind === "agent_message_chunk") {
    return {
      type: "message",
      phase: "agent_message_chunk",
      text,
      responseKind: "status_summary",
      metadata: {
        acpSessionUpdate: updateKind,
        messageId: asText(update.messageId)
      }
    };
  }
  if (updateKind === "completion") {
    return {
      type: "completion",
      phase: asText(update.status || input.phase || input.type || "completed"),
      text,
      responseKind: text ? "final_response" : "none",
      metadata: {
        acpSessionUpdate: updateKind
      }
    };
  }
  if (text) {
    return {
      type: "progress",
      phase: updateKind || asText(input.phase || input.type || "progress"),
      text,
      responseKind: asText(input.responseKind || "status_summary"),
      metadata: {
        acpSessionUpdate: updateKind
      }
    };
  }
  return null;
}

function normalizeTargetUpdates(values = []) {
  return asArray(values)
    .map((entry) => {
      if (typeof entry === "string") {
        return { type: "progress", phase: "working", text: entry };
      }
      const acpUpdate = normalizeAgentClientProtocolUpdate(entry);
      if (acpUpdate) {
        return acpUpdate;
      }
      return asObject(entry, null);
    })
    .filter((entry) => entry && Object.keys(entry).length > 0);
}

function outputTextFromUpdates(updates = []) {
  return asArray(updates)
    .filter((entry) => asText(entry.phase) === "agent_message_chunk" || asText(entry.type) === "message")
    .map((entry) => asText(entry.text))
    .filter(Boolean)
    .join("");
}

function normalizeTargetStopReason(stopReason = "", target = {}) {
  const raw = asText(stopReason || "completed");
  if (targetUsesAgentClientProtocolV1(target) && raw === "end_turn") {
    return "completed";
  }
  return raw;
}

function isTargetJsonRpcRequest(message = {}) {
  return typeof message.method === "string" && Object.hasOwn(message, "id");
}

function isTargetJsonRpcNotification(message = {}) {
  return typeof message.method === "string" && !Object.hasOwn(message, "id");
}

function isPendingTargetApprovalResult(value = {}) {
  return value && typeof value === "object" && value.__pactTargetApprovalPending === true;
}

function targetCallbackParentRequestId(message = {}) {
  const params = asObject(message.params);
  return asText(
    params.pactParentRequestId ||
      params.parentRequestId ||
      params.parent_request_id ||
      params.acpParentRequestId ||
      params.parentId
  );
}

function pendingTargetApprovalError(pendingApproval = {}) {
  const error = new Error("Target ACP callback is waiting for source approval.");
  error.code = "target_callback_approval_pending";
  error.pendingTargetApproval = true;
  error.pendingApproval = asObject(pendingApproval);
  return error;
}

function supportsSessionCapability(capabilities = {}, capability = "", method = "") {
  const input = asObject(capabilities);
  const session = input.session || input.sessions || input.sessionCapabilities;
  if (Array.isArray(session)) {
    return session.includes(capability) || Boolean(method && session.includes(method));
  }
  const sessionObject = asObject(session, null);
  if (sessionObject) {
    return sessionObject[capability] === true ||
      Boolean(method && sessionObject[method] === true);
  }
  return input[capability] === true;
}

function supportsSessionClose(capabilities = {}) {
  return supportsSessionCapability(capabilities, "close", ACP_METHODS.sessionClose) ||
    supportsSessionCapability(capabilities, "closeSession", ACP_METHODS.sessionClose) ||
    supportsSessionCapability(capabilities, "sessionClose", ACP_METHODS.sessionClose);
}

function targetProtocolStyle(target = {}) {
  const transport = asObject(target.transport);
  const style = asText(
    transport.protocolStyle ||
      transport.protocolSchema ||
      transport.protocol ||
      target.protocolStyle ||
      target.protocolSchema
  ).toLowerCase();
  if ([
    "agent-client-protocol-v1",
    "acp-v1",
    "acp.v1",
    "zed-acp-v1",
    "strict-acp-v1"
  ].includes(style)) {
    return "agent-client-protocol-v1";
  }
  const command = asObject(transport.command);
  const executable = asText(command.executable);
  const args = asArray(command.args).map(String).join(" ");
  if (/(^|[/\s])codex-acp(\s|$)/.test(`${executable} ${args}`) || args.includes("@zed-industries/codex-acp")) {
    return "agent-client-protocol-v1";
  }
  return "pact-legacy";
}

function targetUsesAgentClientProtocolV1(target = {}) {
  return targetProtocolStyle(target) === "agent-client-protocol-v1";
}

function targetCommandCwd(target = {}) {
  const transport = asObject(target.transport);
  const command = asObject(transport.command);
  return asText(command.cwd || transport.cwd || process.cwd(), process.cwd());
}

function pactMeta(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, value])
      .filter(([, value]) => value !== undefined && value !== null && asText(value) !== "")
  );
}

function jsonRpcErrorFromValue(id, value, fallbackMessage = "Target ACP callback failed.") {
  const input = asObject(value);
  const nested = asObject(input.error, input);
  return createError(
    id,
    Number.isFinite(Number(nested.code)) ? Number(nested.code) : JSON_RPC_INTERNAL_ERROR,
    asText(nested.message || input.message, fallbackMessage),
    nested.data || input.data || undefined
  );
}

function errorMessage(value, fallback = "") {
  if (value instanceof Error) {
    return value.message;
  }
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function targetResponseError(method, parsed = {}) {
  const error = new Error(parsed.error?.message || `Target ACP ${method} failed.`);
  error.code = parsed.error?.code;
  error.data = parsed.error?.data;
  return error;
}

function targetSessionRequestParams({ params = {}, target = {}, targetResumeRef = "", sessionMethod = "" } = {}) {
  if (targetUsesAgentClientProtocolV1(target)) {
    const sessionId = asText(targetResumeRef || params.targetSessionId || params.sessionId);
    return {
      ...(sessionMethod === ACP_METHODS.sessionNew ? { cwd: targetCommandCwd(target) } : {}),
      ...(sessionMethod !== ACP_METHODS.sessionNew && sessionId ? { sessionId } : {}),
      mcpServers: [],
      _meta: pactMeta({
        relaySessionId: params.relaySessionId || "",
        targetId: target.targetId || "",
        targetResumeRef,
        staleTargetResumeRef: params.staleTargetResumeRef || ""
      })
    };
  }
  return {
    relaySessionId: params.relaySessionId || "",
    targetId: target.targetId || "",
    targetResumeRef,
    ...(sessionMethod === ACP_METHODS.sessionLoad
      ? {
          sessionId: targetResumeRef,
          resumeRef: targetResumeRef
        }
      : {})
  };
}

function targetInitializeRequestParams({ params = {}, target = {} } = {}) {
  if (targetUsesAgentClientProtocolV1(target)) {
    const transport = asObject(target.transport);
    const clientCapabilities = {
      fs: {
        readTextFile: true,
        writeTextFile: true
      },
      terminal: false,
      mcpCapabilities: {
        http: true,
        sse: false
      }
    };
    return {
      protocolVersion: 1,
      clientCapabilities,
      clientInfo: {
        name: "pact-acp-agent-relay",
        title: "Pact ACP Agent Relay",
        version: asText(transport.clientVersion || "1.0.0")
      },
      _meta: pactMeta({
        targetId: target.targetId || "",
        relaySessionId: params.relaySessionId || "",
        targetResumeRef: params.targetResumeRef || ""
      })
    };
  }
  const input = asObject(params);
  const request = {
    client: "pact.acp-agent-relay",
    targetId: asText(target.targetId)
  };
  const relaySessionId = asText(input.relaySessionId);
  const targetResumeRef = asText(input.targetResumeRef);
  const relayMcp = targetRelayMcpProxyParams({ params: input, target });
  if (relaySessionId) {
    request.relaySessionId = relaySessionId;
  }
  if (targetResumeRef) {
    request.targetResumeRef = targetResumeRef;
  }
  if (relayMcp) {
    request.relayMcp = relayMcp;
    request.mcpServers = relayMcp.mcpServers;
  }
  return request;
}

function targetRelayMcpProxyParams({ params = {}, target = {} } = {}) {
  const input = asObject(params);
  const targetMcp = asObject(target.mcp);
  const relayMcpGrantId = asText(
    input.relayMcpGrantId ||
      input.relayMcp?.grantId ||
      input.relayMcp?.relayMcpGrantId ||
      input.mcp?.relayMcpGrantId
  );
  if (!relayMcpGrantId) {
    return null;
  }
  const relayMcpToken = asText(input.relayMcpToken || input.relayMcp?.token || input.relayMcp?.accessToken);
  const relaySessionId = asText(input.relaySessionId);
  const relayTurnId = asText(input.relayTurnId || input.relayMcp?.relayTurnId || input.relayMcp?.childOperation?.relayTurnId);
  const virtualAgentId = asText(input.virtualAgentId || input.relayMcp?.virtualAgentId || input.relayMcp?.childOperation?.virtualAgentId);
  const targetId = asText(target.targetId || input.targetId);
  const traceId = asText(input.traceId || input.relayMcp?.traceId || input.relayMcp?.childOperation?.traceId);
  const parentOperationId = asText(input.operationId || input.relayMcp?.operationId || input.relayMcp?.childOperation?.parentOperationId);
  const childOperation = {
    schemaVersion: 1,
    binding: "pact.acp-agent-relay.child-operation.v1",
    relaySessionId,
    relayTurnId,
    virtualAgentId,
    targetId,
    relayMcpGrantId,
    traceId,
    parentOperationId
  };
  const childOperationHeaders = Object.fromEntries(
    Object.entries({
      "X-Pact-Relay-Session-Id": relaySessionId,
      "X-Pact-Relay-Turn-Id": relayTurnId,
      "X-Pact-Virtual-Agent-Id": virtualAgentId,
      "X-Pact-Target-Agent-Id": targetId,
      "X-Pact-Relay-Operation-Id": parentOperationId,
      "X-Pact-Trace-Id": traceId
    }).filter(([, value]) => asText(value))
  );
  const url = asText(
    input.relayMcpUrl ||
      input.pactMcpUrl ||
      targetMcp.url ||
      targetMcp.endpoint ||
      "/mcp"
  );
  const server = {
    type: "http",
    url,
    headers: {
      "X-Pact-Relay-Mcp-Grant-Id": relayMcpGrantId,
      ...childOperationHeaders,
      ...(relayMcpToken ? { Authorization: `Bearer ${relayMcpToken}` } : {})
    },
    authorization: {
      mode: "relay-managed",
      grantId: relayMcpGrantId,
      credential: relayMcpToken ? "bearer" : "grant-reference"
    }
  };
  return {
    schemaVersion: 1,
    protocol: "mcp",
    source: "pact.acp-agent-relay",
    relaySessionId,
    relayTurnId,
    virtualAgentId,
    targetId,
    grantId: relayMcpGrantId,
    childOperation,
    refresh: {
      notification: "notifications/tools/list_changed",
      fallback: "reconnect"
    },
    mcpServers: {
      pact: server
    }
  };
}

function targetPromptRequestParams(params = {}, connection = {}) {
  const input = asObject(params);
  if (targetUsesAgentClientProtocolV1(connection.target)) {
    const prompt = input.prompt;
    const promptBlocks = Array.isArray(prompt)
      ? prompt
      : [{ type: "text", text: asText(prompt || input.text || input.content) }];
    const request = {
      sessionId: asText(connection.targetSessionId || input.sessionId || input.relaySessionId),
      prompt: promptBlocks,
      _meta: pactMeta({
        mode: input.mode || "",
        requestReasoning: input.requestReasoning === true ? "true" : "",
        localObservationMarker: input.localObservationMarker || "",
        relaySessionId: input.relaySessionId || "",
        relayTurnId: input.relayTurnId || "",
        virtualAgentId: input.virtualAgentId || "",
        targetId: input.targetId || "",
        traceId: input.traceId || "",
        operationId: input.operationId || "",
        targetSessionId: connection.targetSessionId || "",
        targetResumeRef: connection.targetResumeRef || ""
      })
    };
    const relayMcp = targetRelayMcpProxyParams({ params: input, target: connection.target });
    if (relayMcp) {
      request._meta.relayMcp = relayMcp;
    }
    return request;
  }
  const request = {};
  for (const key of [
    "prompt",
    "text",
    "content",
    "mode",
    "requestReasoning",
    "localObservationMarker",
    "receipts",
    "relaySessionId",
    "relayTurnId",
    "virtualAgentId",
    "targetId",
    "traceId",
    "operationId"
  ]) {
    if (input[key] !== undefined) {
      request[key] = input[key];
    }
  }
  const relayMcp = targetRelayMcpProxyParams({ params: input, target: connection.target });
  if (relayMcp) {
    request.relayMcp = relayMcp;
    request.mcpServers = relayMcp.mcpServers;
  }
  request.sessionId = asText(connection.targetSessionId || input.sessionId || input.relaySessionId);
  request.targetSessionId = asText(connection.targetSessionId);
  request.targetResumeRef = asText(connection.targetResumeRef);
  return request;
}

function targetCancelRequestParams(params = {}, connection = {}) {
  const input = asObject(params);
  const request = {
    sessionId: asText(connection.targetSessionId || input.sessionId || input.relaySessionId),
    targetSessionId: asText(connection.targetSessionId)
  };
  const reason = asText(input.reason);
  if (reason) {
    request.reason = reason;
  }
  return request;
}

function targetCloseRequestParams(params = {}, connection = {}) {
  const input = asObject(params);
  const request = {
    sessionId: asText(connection.targetSessionId || input.sessionId || input.relaySessionId),
    targetSessionId: asText(connection.targetSessionId),
    targetResumeRef: asText(connection.targetResumeRef)
  };
  const reason = asText(input.reason);
  if (reason) {
    request.reason = reason;
  }
  return request;
}

export class AcpClientConnection {
  constructor({ target = {}, transport = null, requestTimeoutMs = 120000 } = {}) {
    this.target = asObject(target);
    this.transport = transport;
    this.initialized = false;
    this.closed = false;
    this.lastTransportError = null;
    this.messages = [];
    this.requestTimeoutMs = Number.isFinite(Number(requestTimeoutMs)) ? Number(requestTimeoutMs) : 120000;
    this.pendingRequests = new Map();
    this.readerPromise = null;
    this.targetSessionId = "";
    this.targetResumeRef = "";
    this.targetCapabilities = {};
    this.relayMcpGrantId = "";
    if (this.transport && typeof this.transport.onClose === "function") {
      this.transport.onClose((event = {}) => {
        this.closed = true;
        this.initialized = false;
        this.lastTransportError = errorMessage(event.error);
        const suffix = this.lastTransportError ? `: ${this.lastTransportError}` : "";
        this.rejectAllPending(new Error(`Target ACP transport is closed${suffix}.`));
      });
    }
  }

  hasTransport() {
    return hasJsonRpcTransport(this.transport);
  }

  isReusable() {
    if (this.closed) {
      return false;
    }
    if (!transportIsReusable(this.transport)) {
      return false;
    }
    return true;
  }

  markTransportClosed(error) {
    this.closed = true;
    this.initialized = false;
    this.lastTransportError = errorMessage(error);
  }

	  createPendingRequest(message, { method = "", collectUpdates = false, handleRequest = null } = {}) {
	    const entry = {
	      id: asText(message.id),
      method,
      message,
      collectUpdates: collectUpdates === true,
      handleRequest,
      updates: [],
      targetRequests: [],
      targetNotifications: [],
      done: false,
      timer: null,
      promise: null,
      resolve: null,
      reject: null
    };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = (value) => {
        if (entry.done) {
          return;
        }
        entry.done = true;
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        this.pendingRequests.delete(entry.id);
        resolve(value);
      };
      entry.reject = (error) => {
        if (entry.done) {
          return;
        }
        entry.done = true;
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        this.pendingRequests.delete(entry.id);
        reject(error);
      };
    });
    if (this.requestTimeoutMs > 0) {
      entry.timer = setTimeout(() => {
        const error = new Error(`Timed out waiting for target ACP ${method} response after ${this.requestTimeoutMs}ms.`);
        this.markTransportClosed(error);
        if (this.transport && typeof this.transport.close === "function") {
          this.transport.close();
        }
        this.rejectAllPending(error);
      }, this.requestTimeoutMs);
      if (typeof entry.timer.unref === "function") {
        entry.timer.unref();
      }
    }
    this.pendingRequests.set(entry.id, entry);
    return entry;
  }

	  resolvePendingRequest(id, value) {
	    const entry = this.pendingRequests.get(asText(id));
    if (!entry) {
      return false;
    }
    entry.resolve(value);
    return true;
  }

	  rejectPendingRequest(id, error) {
	    const entry = this.pendingRequests.get(asText(id));
    if (!entry) {
      return false;
    }
    entry.reject(error);
    return true;
  }

	  dropPendingRequest(id) {
	    const key = asText(id);
	    const entry = this.pendingRequests.get(key);
    if (!entry) {
      return false;
    }
    entry.done = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
	    this.pendingRequests.delete(key);
    return true;
  }

  rejectAllPending(error) {
    for (const entry of [...this.pendingRequests.values()]) {
      entry.reject(error);
    }
  }

  chooseCallbackRequestEntry(message = {}) {
    const entries = [...this.pendingRequests.values()].filter((entry) => !entry.done);
    const callbackEntries = entries.filter((entry) => typeof entry.handleRequest === "function");
    const parentRequestId = targetCallbackParentRequestId(message);
    if (parentRequestId) {
      const entry = this.pendingRequests.get(parentRequestId);
      return entry && !entry.done && typeof entry.handleRequest === "function" ? entry : null;
    }
    return callbackEntries.length === 1 ? callbackEntries[0] : null;
  }

  async sendUnroutableTargetRequestError(parsed = {}, reasonCode = "target_callback_parent_unresolved") {
    const response = createError(
      parsed.id,
      JSON_RPC_METHOD_NOT_FOUND,
      "Target ACP callback has no unique parent request.",
      {
        method: asText(parsed.method),
        reasonCode
      }
    );
    this.messages.push({ direction: "out", message: response, at: nowIso(), kind: "target_callback_response" });
    await this.transport.send(response);
    return response;
  }

  ensureReader() {
    if (this.readerPromise) {
      return this.readerPromise;
    }
    this.readerPromise = (async () => {
      try {
        while (!this.closed && this.hasTransport()) {
          const raw = await this.transport.receive();
          if (raw === null || raw === undefined) {
            const suffix = this.lastTransportError ? `: ${this.lastTransportError}` : "";
            const entries = [...this.pendingRequests.values()];
            if (entries.length > 0) {
              for (const entry of entries) {
                entry.reject(new Error(`Target ACP transport closed before response for ${entry.method}${suffix}.`));
              }
            }
            return;
          }
          const parsed = parseJsonRpcMessage(raw);
          this.messages.push({ direction: "in", message: parsed, at: nowIso() });
          await this.dispatchIncomingMessage(parsed);
        }
      } catch (error) {
        this.markTransportClosed(error);
        if (this.transport && typeof this.transport.close === "function") {
          this.transport.close();
        }
        this.rejectAllPending(error);
      } finally {
        this.readerPromise = null;
      }
    })();
    return this.readerPromise;
  }

  async dispatchIncomingMessage(parsed = {}) {
    if (parsed.method === ACP_METHODS.sessionUpdate) {
      for (const entry of this.pendingRequests.values()) {
        if (entry.collectUpdates) {
          entry.updates.push(asObject(parsed.params));
        }
      }
      return;
    }
    if (isTargetJsonRpcRequest(parsed)) {
      const entry = this.chooseCallbackRequestEntry(parsed);
      if (!entry) {
        await this.sendUnroutableTargetRequestError(parsed, targetCallbackParentRequestId(parsed)
          ? "target_callback_parent_not_found"
          : "target_callback_parent_ambiguous");
        return;
      }
      const targetRequests = entry?.targetRequests || [];
      try {
        await this.handleTargetRequest(parsed, {
          method: entry?.method || "",
          handleRequest: entry?.handleRequest || null,
          targetRequests
        });
      } catch (error) {
        if (!error?.pendingTargetApproval || !entry) {
          throw error;
        }
        const pendingApproval = asObject(error.pendingApproval);
        const receipts = asArray(pendingApproval.receipts);
        const pendingPermissionRequests = asArray(pendingApproval.pendingPermissionRequests);
        targetRequests.push({
          method: parsed.method,
          params: asObject(parsed.params),
          response: null,
          pendingApproval,
          at: nowIso()
        });
        this.resolvePendingRequest(entry.id, {
          result: {
            ok: true,
            stopReason: "approval_pending",
            outputSummary: pendingApproval.outputSummary || "Relay turn is waiting for target callback approval.",
            text: pendingApproval.outputSummary || "Relay turn is waiting for target callback approval.",
            pendingPermissionRequests,
            receipts,
            externalCompletionState: "approval_pending",
            finalResponseAvailable: false,
            targetResponse: {
              pendingApproval: true,
              requestIds: pendingPermissionRequests.map((request) => request.requestId).filter(Boolean)
            }
          },
          updates: [
            {
              type: "progress",
              phase: "approval_pending",
              text: pendingApproval.outputSummary || "Relay turn is waiting for target callback approval."
            }
          ],
          targetRequests,
          targetNotifications: entry.targetNotifications
        });
        this.markTransportClosed(error);
        if (this.transport && typeof this.transport.close === "function") {
          this.transport.close();
        }
      }
      return;
    }
    if (isTargetJsonRpcNotification(parsed)) {
      for (const entry of this.pendingRequests.values()) {
        entry.targetNotifications.push(asObject(parsed));
      }
      return;
    }
    const entry = this.pendingRequests.get(asText(parsed.id));
    if (!entry) {
      return;
    }
    if (parsed.error) {
      this.rejectPendingRequest(parsed.id, targetResponseError(entry.method, parsed));
      return;
    }
    this.resolvePendingRequest(parsed.id, {
      result: asObject(parsed.result),
      updates: entry.updates,
      targetRequests: entry.targetRequests,
      targetNotifications: entry.targetNotifications
    });
  }

  async handleTargetRequest(parsed = {}, { method = "", handleRequest = null, targetRequests = [] } = {}) {
    let response;
    let handled;
    try {
      if (typeof handleRequest !== "function") {
        response = createError(parsed.id, JSON_RPC_METHOD_NOT_FOUND, `Unsupported target ACP callback method: ${parsed.method}`, {
          method: parsed.method
        });
      } else {
        handled = await handleRequest(parsed, {
          connection: this,
          parentMethod: method
        });
      }
    } catch (error) {
      response = createError(parsed.id, JSON_RPC_INTERNAL_ERROR, error instanceof Error ? error.message : String(error), {
        method: parsed.method
      });
    }
    if (isPendingTargetApprovalResult(handled)) {
      throw pendingTargetApprovalError(handled.pendingApproval);
    }
    if (!response) {
      if (handled && handled.jsonrpc === "2.0") {
        response = handled;
      } else if (handled && handled.error) {
        response = jsonRpcErrorFromValue(parsed.id, handled);
      } else {
        response = createSuccess(parsed.id, Object.hasOwn(asObject(handled), "result") ? handled.result : handled);
      }
    }
    this.messages.push({ direction: "out", message: response, at: nowIso(), kind: "target_callback_response" });
    await this.transport.send(response);
    targetRequests.push({
      method: parsed.method,
      params: asObject(parsed.params),
      response: asObject(response),
      at: nowIso()
    });
  }

  async request(method, params = {}, { collectUpdates = false, handleRequest = null } = {}) {
    if (!this.hasTransport()) {
      throw new Error("Target ACP transport is not configured.");
    }
    if (this.closed) {
      const suffix = this.lastTransportError ? `: ${this.lastTransportError}` : "";
      throw new Error(`Target ACP transport is closed${suffix}.`);
    }
    const message = createRequest(method, params);
	    if (typeof handleRequest === "function") {
	      message.params = {
	        ...asObject(message.params),
	        pactParentRequestId: asText(message.id)
	      };
	    }
    const pending = this.createPendingRequest(message, { method, collectUpdates, handleRequest });
    this.messages.push({ direction: "out", message, at: nowIso() });
    let sent = false;
    try {
      sent = await this.transport.send(message);
    } catch (error) {
      this.markTransportClosed(error);
      this.dropPendingRequest(message.id);
      if (this.transport && typeof this.transport.close === "function") {
        this.transport.close();
      }
      throw error;
    }
    if (sent === false) {
      const error = new Error(`Target ACP transport refused ${method} request.`);
      this.markTransportClosed(error);
      this.dropPendingRequest(message.id);
      if (this.transport && typeof this.transport.close === "function") {
        this.transport.close();
      }
      throw error;
    }
    this.ensureReader();
    return pending.promise;
  }

  async initialize(params = {}) {
    this.relayMcpGrantId = asText(params.relayMcpGrantId || this.relayMcpGrantId);
    if (this.hasTransport()) {
      try {
        const initialize = await this.request(ACP_METHODS.initialize, targetInitializeRequestParams({
          params,
          target: this.target
        }));
        this.targetCapabilities = asObject(initialize.result.capabilities || initialize.result.agentCapabilities);
        const targetResumeRef = asText(params.targetResumeRef);
        const sessionMethod = targetResumeRef && supportsSessionCapability(this.targetCapabilities, "load", ACP_METHODS.sessionLoad) &&
          !supportsSessionCapability(this.targetCapabilities, "resume", ACP_METHODS.sessionResume)
          ? ACP_METHODS.sessionLoad
          : targetResumeRef
            ? ACP_METHODS.sessionResume
            : ACP_METHODS.sessionNew;
        let effectiveSessionMethod = sessionMethod;
        let wakeMode = targetResumeRef ? "resumed" : "created";
        let sessionFallback = null;
        let session = null;
        try {
          session = await this.request(sessionMethod, targetSessionRequestParams({
            params,
            target: this.target,
            targetResumeRef,
            sessionMethod
          }));
        } catch (error) {
          if (!targetResumeRef || sessionMethod === ACP_METHODS.sessionNew) {
            throw error;
          }
          sessionFallback = {
            from: sessionMethod,
            to: ACP_METHODS.sessionNew,
            reasonCode: "target_resume_failed",
            message: error instanceof Error ? error.message : String(error),
            code: error?.code
          };
          effectiveSessionMethod = ACP_METHODS.sessionNew;
          wakeMode = "recreated";
          session = await this.request(ACP_METHODS.sessionNew, {
            relaySessionId: params.relaySessionId || "",
            targetId: this.target.targetId || "",
            staleTargetResumeRef: targetResumeRef
          });
        }
        const sessionResult = asObject(session.result);
        this.targetSessionId = asText(
          sessionResult.targetSessionId ||
            sessionResult.sessionId ||
            sessionResult.relaySessionId ||
            sessionResult.id
        );
        this.targetResumeRef = asText(sessionResult.targetResumeRef || sessionResult.resumeRef || this.targetSessionId);
        this.initialized = true;
        return {
          ok: true,
          targetId: this.target.targetId || "",
          capabilities: this.targetCapabilities,
          agentCapabilities: asObject(initialize.result.agentCapabilities),
          protocolVersion: asText(initialize.result.protocolVersion),
          targetSessionId: this.targetSessionId,
          targetResumeRef: this.targetResumeRef,
          sessionMethod: effectiveSessionMethod,
          wakeMode,
          ...(sessionFallback ? { sessionFallback } : {}),
          initializedAt: nowIso(),
          initialize: initialize.result,
          session: sessionResult
        };
      } catch (error) {
        this.initialized = false;
        throw error;
      }
    }

    this.initialized = true;
    const message = createRequest(ACP_METHODS.initialize, targetInitializeRequestParams({
      params,
      target: this.target
    }));
    this.messages.push({ direction: "out", message, at: nowIso() });
    return {
      ok: true,
      targetId: this.target.targetId || "",
      capabilities: {
        session: ["new", "resume", "cancel"],
        updates: ["progress", "reasoning_trace"],
        fs: ["read_text_file", "write_text_file"],
        terminal: false,
        mcp: true
      },
      initializedAt: nowIso()
    };
  }

  async sendPrompt(params = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    this.relayMcpGrantId = asText(params.relayMcpGrantId || this.relayMcpGrantId);
    if (this.hasTransport()) {
      const {
        targetRequestHandler,
      } = asObject(params);
      const prompt = targetPromptRequestParams(params, this);
      const response = await this.request(ACP_METHODS.sessionPrompt, prompt, {
        collectUpdates: true,
        handleRequest: targetRequestHandler
      });
      const result = asObject(response.result);
      const updates = [
        ...response.updates,
        ...normalizeTargetUpdates(result.updates || result.events)
      ];
      const normalizedUpdates = normalizeTargetUpdates(updates);
      const output = outputTextFromResult(result) || outputTextFromUpdates(normalizedUpdates);
      const reasoning = asArray(result.reasoning || result.reasoningTraces || result.reasoning_trace);
      const stopReason = normalizeTargetStopReason(result.stopReason || result.stop_reason || "completed", this.target);
      const finalResponseAvailable = result.finalResponseAvailable === false
        ? false
        : output.length > 0 || result.finalResponseAvailable === true;
      return {
        ok: result.ok !== false,
        updates: normalizedUpdates,
        reasoning,
        stopReason,
        acpStopReason: asText(result.stopReason || result.stop_reason),
        text: output,
        outputSummary: output,
        targetSessionId: asText(result.targetSessionId || result.sessionId || this.targetSessionId),
        targetResumeRef: asText(result.targetResumeRef || result.resumeRef || this.targetResumeRef),
        externalCompletionState: asText(result.externalCompletionState || "completed"),
        finalResponseAvailable,
        finalResponsePolicy: finalResponseAvailable ? "target_acp_completion" : asText(result.finalResponsePolicy),
        targetRequestReceipts: response.targetRequests
          .map((entry) => entry.response?.result?.receipt || entry.response?.result?.receipts)
          .flat()
          .filter((entry) => entry && typeof entry === "object")
          .concat(asArray(result.receipts)),
        pendingPermissionRequests: asArray(result.pendingPermissionRequests),
        targetRequests: response.targetRequests,
        targetNotifications: response.targetNotifications,
        targetResponse: result
      };
    }

    const message = createRequest(ACP_METHODS.sessionPrompt, targetPromptRequestParams(params, this));
    this.messages.push({ direction: "out", message, at: nowIso() });
    const promptText = String(params.prompt || params.text || "");
    return {
      ok: true,
      updates: [
        { type: "progress", phase: "accepted", text: "Target accepted delegated prompt." },
        { type: "progress", phase: "working", text: "Target produced a governed response." }
      ],
      reasoning: [
        {
          type: "reasoning_trace",
          reason: "mock-target",
          text: "Mock target considered the delegated request under relay policy."
        }
      ],
      stopReason: "completed",
      text: promptText ? `Mock ACP target completed: ${promptText}` : "Mock ACP target completed."
    };
  }

  async cancel(params = {}) {
    if (this.hasTransport()) {
      const response = await this.request(ACP_METHODS.sessionCancel, targetCancelRequestParams(params, this)).catch((error) => ({
        result: {
          ok: false,
          error: error.message
        }
      }));
      return {
        ok: response.result?.ok !== false,
        cancelledAt: nowIso(),
        targetSessionId: this.targetSessionId,
        result: response.result
      };
    }
    const message = createRequest(ACP_METHODS.sessionCancel, targetCancelRequestParams(params, this));
    this.messages.push({ direction: "out", message, at: nowIso() });
    return { ok: true, cancelledAt: nowIso() };
  }

  async close(params = {}) {
    let targetClose = null;
    if (this.hasTransport() && !this.closed && this.initialized && supportsSessionClose(this.targetCapabilities)) {
      targetClose = await this.request(ACP_METHODS.sessionClose, targetCloseRequestParams(params, this)).catch((error) => ({
        result: {
          ok: false,
          error: error.message,
          code: error.code,
          data: error.data
        }
      }));
    }
    this.closed = true;
    if (this.transport && typeof this.transport.close === "function") {
      this.transport.close();
    }
    this.rejectAllPending(new Error("Target ACP transport is closed."));
    const result = asObject(targetClose?.result);
    return {
      ok: result.ok !== false,
      closedAt: nowIso(),
      ...(targetClose ? { targetClose: result } : {})
    };
  }
}

export function createAcpClientConnection(options = {}) {
  return new AcpClientConnection(options);
}
