function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
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

export class AcpInboundFacade {
  constructor({ executor, store = null }) {
    this.executor = executor;
    this.store = store;
  }

  async initialize(input = {}) {
    return this.executor.execute("acp_agent_relay.virtual_agent.initialize", input);
  }

  async listVirtualAgents(input = {}) {
    return this.executor.execute("acp_agent_relay.virtual_agents.list", input);
  }

  async listTargets(input = {}) {
    return this.executor.execute("acp_agent_relay.targets.list", input);
  }

  async listSessions(input = {}) {
    return this.executor.execute("acp_agent_relay.sessions.list", input);
  }

  async getSession(input = {}) {
    return this.executor.execute("acp_agent_relay.sessions.get", input);
  }

  async listTurns(input = {}) {
    return this.executor.execute("acp_agent_relay.turns.list", input);
  }

  async observeTurn(input = {}) {
    return this.executor.execute("acp_agent_relay.turn.observe", input);
  }

  async newSession(input = {}) {
    return this.executor.execute("acp_agent_relay.session.create", input);
  }

  async resumeSession(input = {}) {
    return this.executor.execute("acp_agent_relay.session.resume", input);
  }

  async loadSession(input = {}) {
    if (!this.store) {
      return { ok: false, error: { code: "relay_session_store_unavailable", message: "Relay session store is unavailable." } };
    }
    const payload = asObject(input);
    const relaySessionId = asText(payload.relaySessionId || payload.sessionId || payload.id);
    const session = relaySessionId
      ? await this.store.getSession(relaySessionId)
      : await this.store.getSessionBySourceKey(payload);
    if (!session || !sessionBelongsToInput(session, payload)) {
      return { ok: false, error: { code: "relay_session_not_found", message: "Relay session not found." } };
    }
    return { ok: true, data: { session } };
  }

  async prompt(input = {}) {
    const payload = asObject(input);
    return this.executor.execute("acp_agent_relay.prompt.send", {
      ...payload,
      sessionId: asText(payload.sessionId || payload.relaySessionId)
    });
  }

  async resolvePermission(input = {}) {
    return this.executor.execute("acp_agent_relay.permission.resolve", asObject(input));
  }

  async cancel(input = {}) {
    return this.executor.execute("acp_agent_relay.session.cancel", input);
  }

  async closeSession(input = {}) {
    return this.executor.execute("acp_agent_relay.session.close", input);
  }
}

export function createAcpInboundFacade(options = {}) {
  return new AcpInboundFacade(options);
}
