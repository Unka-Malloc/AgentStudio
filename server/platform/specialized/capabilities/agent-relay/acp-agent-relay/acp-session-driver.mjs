import { spawn } from "node:child_process";

import { AcpClientConnection } from "./acp-client-connection.mjs";
import { createAcpSourceJsonRpcLineTransport } from "./acp-source-json-rpc-service.mjs";
import { AntigravityAgentApiConnection } from "./antigravity-agent-api-connection.mjs";
import { CodexCliExecConnection } from "./codex-cli-exec-connection.mjs";

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

function isAntigravityAgentApiTarget(target = {}) {
  const type = asText(target?.transport?.type || target?.transportType).toLowerCase();
  return ["antigravity-agentapi", "antigravity.agentapi", "agentapi"].includes(type);
}

function isCodexCliExecTarget(target = {}) {
  const type = asText(target?.transport?.type || target?.transportType).toLowerCase();
  return ["codex-cli-exec", "codex.exec", "codex-cli"].includes(type);
}

function isAcpStdioTarget(target = {}) {
  const type = asText(target?.transport?.type || target?.transportType).toLowerCase();
  return ["stdio", "acp-stdio", "acp.stdio"].includes(type);
}

function sanitizeDiagnosticText(value = "") {
  return asText(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/((?:csrf|token|secret|password|credential)[\w.-]*\s*[:=]\s*)[^\s]+/gi, "$1<redacted>")
    .slice(0, 1000);
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

function createAcpStdioTargetTransport({ target = {}, logger = null } = {}) {
  const transport = asObject(target.transport);
  const command = asObject(transport.command);
  const executable = asText(command.executable || transport.binaryPath || transport.commandPath);
  if (!executable) {
    throw new Error("ACP stdio target requires transport.command.executable.");
  }
  const args = asArray(command.args).map((arg) => String(arg));
  const child = spawn(executable, args, {
    cwd: asText(command.cwd || transport.cwd || process.cwd()),
    env: {
      ...process.env,
      ...asObject(command.env)
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lineTransport = createAcpSourceJsonRpcLineTransport({
    input: child.stdout,
    output: child.stdin
  });
  const closeListeners = [];
  let closed = false;
  let lastError = "";
  const notifyClose = (event = {}) => {
    for (const listener of closeListeners.splice(0)) {
      listener(event);
    }
  };
  const closeInternal = ({ error = "", code = null, signal = "", terminate = false } = {}) => {
    if (closed) {
      return;
    }
    closed = true;
    lastError = asText(error);
    lineTransport.close();
    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.end();
    }
    if (terminate && child.pid && !child.killed) {
      child.kill("SIGTERM");
    }
    notifyClose({
      error: lastError,
      code,
      signal,
      closedAt: nowIso()
    });
  };
  if (child.stderr && typeof child.stderr.setEncoding === "function") {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (logger && typeof logger.warn === "function") {
        logger.warn("ACP stdio target diagnostic.", {
          targetId: target.targetId || "",
          text: sanitizeDiagnosticText(chunk)
        });
      }
    });
  }
  child.once("error", (error) => {
    closeInternal({ error: error instanceof Error ? error.message : String(error) });
  });
  child.once("exit", (code, signal) => {
    closeInternal({ code, signal });
  });
  return {
    child,
    get closed() {
      return closed;
    },
    get lastError() {
      return lastError;
    },
    onClose(listener) {
      if (typeof listener !== "function") {
        return;
      }
      if (closed) {
        listener({ error: lastError, closedAt: nowIso() });
      } else {
        closeListeners.push(listener);
      }
    },
    async send(payload) {
      if (closed || !child.pid) {
        return false;
      }
      return lineTransport.send(payload);
    },
    async receive() {
      return lineTransport.receive();
    },
    close() {
      closeInternal({ terminate: true });
    }
  };
}

export function createAcpTargetConnection(options = {}) {
  if (isAntigravityAgentApiTarget(options.target)) {
    return new AntigravityAgentApiConnection(options);
  }
  if (isCodexCliExecTarget(options.target)) {
    return new CodexCliExecConnection(options);
  }
  if (isAcpStdioTarget(options.target)) {
    return new AcpClientConnection({
      ...options,
      transport: options.transport || createAcpStdioTargetTransport(options),
      requestTimeoutMs: options.target?.transport?.timeoutMs
    });
  }
  return new AcpClientConnection(options);
}

export class AcpSessionDriver {
  constructor({ connectionFactory = null } = {}) {
    this.connectionFactory = connectionFactory || ((options) => createAcpTargetConnection(options));
    this.connections = new Map();
  }

  connectionKey(target = {}, relaySession = {}) {
    return `${asText(target.targetId)}::${asText(relaySession.relaySessionId)}`;
  }

  connectionIsReusable(connection = null) {
    if (!connection || connection.closed) {
      return false;
    }
    if (typeof connection.isReusable === "function") {
      try {
        return connection.isReusable() !== false;
      } catch {
        return false;
      }
    }
    if (!transportIsReusable(connection.transport)) {
      return false;
    }
    return true;
  }

  async discardConnection(key = "", connection = null) {
    this.connections.delete(key);
    if (connection && typeof connection.close === "function" && connection.closed !== true) {
      await connection.close().catch(() => null);
    }
  }

  async wake({ target = {}, relaySession = {}, route = {} } = {}) {
    const key = this.connectionKey(target, relaySession);
    let connection = this.connections.get(key);
    let wakeMode = "reused";
    if (connection && !this.connectionIsReusable(connection)) {
      await this.discardConnection(key, connection);
      connection = null;
    }
    if (!connection) {
      try {
        connection = this.connectionFactory({ target, relaySession, route });
        this.connections.set(key, connection);
        wakeMode = relaySession.targetResumeRef ? "resumed" : "created";
        const initialize = await connection.initialize({
          relaySessionId: relaySession.relaySessionId,
          relayTurnId: relaySession.relayTurnId || "",
          virtualAgentId: route.virtualAgent?.virtualAgentId || "",
          targetId: route.target?.targetId || "",
          traceId: relaySession.relayTraceId || "",
          operationId: relaySession.relayOperationId || "",
          targetResumeRef: relaySession.targetResumeRef || "",
          relayMcpGrantId: relaySession.relayMcpGrantId || "",
          relayMcpToken: relaySession.relayMcpToken || "",
          relayMcpUrl: route.relayMcpUrl || route.target?.mcp?.url || route.target?.mcp?.endpoint || "/mcp"
        });
        if (initialize?.ok === false) {
          const error = new Error(asText(initialize.errorMessage || initialize.message || initialize.error, "Target ACP wake failed."));
          error.code = asText(initialize.errorCode || initialize.code, "target_wake_failed");
          error.wakeResult = initialize;
          throw error;
        }
        connection.lastInitializeResult = initialize;
        wakeMode = asText(initialize.wakeMode, wakeMode);
      } catch (error) {
        await this.discardConnection(key, connection);
        throw error;
      }
    }
    const initializeResult = asObject(connection.lastInitializeResult);
    const fallbackTargetSessionId = isAntigravityAgentApiTarget(target)
      ? ""
      : `target_session_${relaySession.relaySessionId}`;
    const fallbackTargetResumeRef = isAntigravityAgentApiTarget(target)
      ? ""
      : `resume_${relaySession.relaySessionId}`;
    return {
      ok: true,
      connection,
      wakeMode,
      targetSessionId: initializeResult.targetSessionId || relaySession.targetSessionId || fallbackTargetSessionId,
      targetResumeRef: initializeResult.targetResumeRef || relaySession.targetResumeRef || fallbackTargetResumeRef,
      wokenAt: nowIso()
    };
  }

  async prompt({ connection, prompt = {}, route = {}, relaySession = {} } = {}) {
    return connection.sendPrompt({
      ...asObject(prompt),
      relaySessionId: relaySession.relaySessionId || "",
      relayMcpGrantId: relaySession.relayMcpGrantId || "",
      relayMcpToken: relaySession.relayMcpToken || "",
      relayMcpUrl: route.relayMcpUrl || route.target?.mcp?.url || route.target?.mcp?.endpoint || "/mcp",
      virtualAgentId: route.virtualAgent?.virtualAgentId || "",
      targetId: route.target?.targetId || "",
      mode: route.effectiveMode || "ask"
    });
  }

  async cancel({ target = {}, relaySession = {} } = {}) {
    const key = this.connectionKey(target, relaySession);
    const connection = this.connections.get(key);
    if (!connection) {
      return { ok: true, cancelledAt: nowIso(), alreadyClosed: true };
    }
    return connection.cancel({ relaySessionId: relaySession.relaySessionId });
  }

  async closeSession({ target = {}, relaySession = {} } = {}) {
    const key = this.connectionKey(target, relaySession);
    const connection = this.connections.get(key);
    if (!connection) {
      this.connections.delete(key);
      return { ok: true, closedAt: nowIso(), alreadyClosed: true, key };
    }
    const result = typeof connection.close === "function"
      ? await connection.close().catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }))
      : { ok: true, closedAt: nowIso(), noCloseMethod: true };
    this.connections.delete(key);
    return {
      ok: result?.ok !== false,
      closedAt: nowIso(),
      key,
      result
    };
  }

  async invalidateRelayMcpGrant({ relayMcpGrantId = "", reason = "relay_mcp_grant_changed" } = {}) {
    const scopedGrantId = asText(relayMcpGrantId);
    if (!scopedGrantId) {
      return {
        ok: false,
        closedConnections: 0,
        reasonCode: "relay_mcp_grant_id_required"
      };
    }
    const results = [];
    for (const [key, connection] of [...this.connections.entries()]) {
      if (asText(connection?.relayMcpGrantId) !== scopedGrantId) {
        continue;
      }
      await this.discardConnection(key, connection);
      results.push({
        key,
        grantId: scopedGrantId,
        reason
      });
    }
    return {
      ok: true,
      grantId: scopedGrantId,
      reason,
      closedConnections: results.length,
      results
    };
  }

  async closeAll() {
    const results = [];
    for (const [key, connection] of this.connections.entries()) {
      if (!connection || typeof connection.close !== "function") {
        continue;
      }
      const result = await connection.close().catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
      results.push({ key, result });
    }
    this.connections.clear();
    return {
      ok: results.every((entry) => entry.result?.ok !== false),
      closedConnections: results.length,
      results
    };
  }
}

export function createAcpSessionDriver(options = {}) {
  return new AcpSessionDriver(options);
}
