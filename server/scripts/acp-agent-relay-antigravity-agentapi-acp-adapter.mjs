#!/usr/bin/env node
import { createInterface } from "node:readline";

import {
  ACP_METHODS,
  createError,
  createNotification,
  createSuccess,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";
import {
  AntigravityAgentApiClient,
  extractAntigravityConversationId,
  normalizeAntigravityAgentApiResponse
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

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

function readConfig() {
  const raw = asText(process.env.PACT_ANTIGRAVITY_AGENTAPI_ACP_ADAPTER_CONFIG_JSON);
  if (!raw) {
    return {};
  }
  return asObject(JSON.parse(raw));
}

function promptTextFromBlocks(prompt = []) {
  if (typeof prompt === "string") {
    return prompt;
  }
  return asArray(prompt)
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      const input = asObject(block);
      return asText(input.text || input.content || input.message);
    })
    .filter(Boolean)
    .join("");
}

function redactedResponseKeys(value = {}) {
  return Object.keys(asObject(value)).filter((key) => !/token|secret|csrf|authorization|password/i.test(key));
}

class AntigravityAgentApiAcpAdapter {
  constructor(config = {}) {
    this.config = config;
    this.client = new AntigravityAgentApiClient({
      ...config,
      env: {
        ...process.env,
        ...asObject(config.env)
      }
    });
    this.sessions = new Map();
  }

  sessionFor(id = "") {
    const sessionId = asText(id) || `antigravity-agentapi-acp-${Date.now()}`;
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        conversationId: sessionId.startsWith("antigravity-agentapi-acp-")
          ? asText(this.config.conversationId)
          : sessionId,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    }
    return this.sessions.get(sessionId);
  }

  async handle(message = {}) {
    switch (message.method) {
      case ACP_METHODS.initialize:
        return createSuccess(message.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
              image: false,
              audio: false,
              embeddedContext: false
            }
          },
          capabilities: {
            session: ["new", "load", "resume", "close"],
            updates: ["progress"],
            fs: [],
            terminal: false,
            mcp: false,
            agentApi: true
          },
          adapter: {
            id: "antigravity-agentapi-acp-stdio-wrapper",
            targetCommunicationMode: "antigravity_agentapi_acp_stdio_wrapper",
            nativeAntigravityAcp: false
          }
        });
      case ACP_METHODS.sessionNew:
        return this.createOrRestoreSession(message, "new");
      case ACP_METHODS.sessionLoad:
        return this.createOrRestoreSession(message, "load");
      case ACP_METHODS.sessionResume:
        return this.createOrRestoreSession(message, "resume");
      case ACP_METHODS.sessionPrompt:
        return this.prompt(message);
      case ACP_METHODS.sessionClose:
        return this.close(message);
      case ACP_METHODS.sessionCancel:
        return createSuccess(message.id, {
          ok: true,
          cancelledAt: nowIso()
        });
      default:
        return createError(message.id, -32601, `Unsupported ACP method: ${message.method}`, {
          method: message.method
        });
    }
  }

  createOrRestoreSession(message = {}, method = "new") {
    const params = asObject(message.params);
    const requestedId = asText(params.sessionId || params.resumeRef || params.targetResumeRef || params._meta?.targetResumeRef);
    const configuredConversationId = asText(this.config.conversationId || process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONVERSATION_ID || process.env.ANTIGRAVITY_CONVERSATION_ID);
    const session = this.sessionFor(requestedId || configuredConversationId || "");
    session.updatedAt = nowIso();
    if (requestedId && !session.conversationId) {
      session.conversationId = requestedId;
    }
    return createSuccess(message.id, {
      ok: true,
      sessionId: session.sessionId,
      targetSessionId: session.conversationId || session.sessionId,
      targetResumeRef: session.conversationId || session.sessionId,
      resumeRef: session.conversationId || session.sessionId,
      method,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    });
  }

  async prompt(message = {}) {
    const params = asObject(message.params);
    const session = this.sessionFor(params.sessionId);
    const prompt = promptTextFromBlocks(params.prompt || params.text || params.content);
    const marker = asText(params._meta?.localObservationMarker || params._meta?.marker);
    const content = [
      "[Pact ACP Antigravity Agent API Adapter]",
      marker ? `marker: ${marker}` : "",
      prompt
    ].filter(Boolean).join("\n\n");
    process.stdout.write(`${JSON.stringify(createNotification(ACP_METHODS.sessionUpdate, {
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "progress",
        content: {
          type: "text",
          text: "Antigravity Agent API adapter accepted delegated prompt."
        }
      }
    }))}\n`);
    const response = session.conversationId
      ? await this.client.sendMessage({ recipientId: session.conversationId, content })
      : await this.client.newConversation({ prompt: content, model: this.config.model });
    const normalized = normalizeAntigravityAgentApiResponse(response, {
      stdout: response.stdout,
      stderr: response.stderr
    });
    const conversationId = normalized.conversationId || extractAntigravityConversationId(response) || session.conversationId;
    if (conversationId) {
      session.conversationId = conversationId;
    }
    session.updatedAt = nowIso();
    return createSuccess(message.id, {
      ok: true,
      sessionId: session.sessionId,
      targetSessionId: session.conversationId || session.sessionId,
      targetResumeRef: session.conversationId || session.sessionId,
      resumeRef: session.conversationId || session.sessionId,
      stopReason: "accepted",
      externalCompletionState: "accepted_only",
      finalResponseAvailable: false,
      finalResponsePolicy: "accepted_only",
      updates: [
        {
          type: "progress",
          phase: "accepted",
          text: "Antigravity Agent API accepted the delegated prompt through the ACP stdio wrapper.",
          responseKind: "status_summary"
        }
      ],
      targetResponse: {
        provider: "antigravity-agentapi-acp-stdio-wrapper",
        conversationId: session.conversationId || "",
        responseKeys: redactedResponseKeys(response.response || response)
      }
    });
  }

  close(message = {}) {
    const params = asObject(message.params);
    const sessionId = asText(params.sessionId || params.targetSessionId);
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
    return createSuccess(message.id, {
      ok: true,
      closedAt: nowIso()
    });
  }
}

const adapter = new AntigravityAgentApiAcpAdapter(readConfig());
const reader = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

for await (const line of reader) {
  const raw = asText(line);
  if (!raw) {
    continue;
  }
  try {
    const message = parseJsonRpcMessage(raw);
    if (!Object.hasOwn(message, "id")) {
      continue;
    }
    const response = await adapter.handle(message);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response = createError(null, -32603, error instanceof Error ? error.message : String(error));
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
