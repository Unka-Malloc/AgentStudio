import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const EVENT_SOURCES = Object.freeze(["target", "verifier", "operation", "permission", "policy"]);

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeRisk(value = "read_only") {
  const risk = ensureString(value, "read_only");
  if (risk === "safe_write" || risk === "repair_write" || risk === "destructive") {
    return risk;
  }
  return "read_only";
}

function randomId(prefix) {
  const raw = crypto.randomBytes(9).toString("hex");
  return `${ensureString(prefix, "id").replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now().toString(36)}_${raw}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSession(raw = {}) {
  return {
    relaySessionId: ensureString(raw.relaySessionId, randomId("relay_session")),
    sourceId: ensureString(raw.sourceId, "system"),
    sourceSessionId: ensureString(raw.sourceSessionId, ""),
    virtualAgentId: ensureString(raw.virtualAgentId, ""),
    targetId: ensureString(raw.targetId, ""),
    sourceSubjectId: ensureString(raw.sourceSubjectId, ""),
    workspaceId: ensureString(raw.workspaceId, "default"),
    cwd: ensureString(raw.cwd, "."),
    lifecycleState: ensureString(raw.lifecycleState || "dormant"),
    wakePolicy: ensureString(raw.wakePolicy || "manual"),
    targetResumeRef: ensureString(raw.targetResumeRef),
    relayMcpGrantId: ensureString(raw.relayMcpGrantId),
    policyRevision: Number(raw.policyRevision || 1),
    targetSessionId: ensureString(raw.targetSessionId),
    lastWokenAt: ensureString(raw.lastWokenAt),
    capabilitiesSnapshot: asObject(raw.capabilitiesSnapshot || raw.metadata?.capabilitiesSnapshot, null),
    createdAt: ensureString(raw.createdAt, nowIso()),
    updatedAt: ensureString(raw.updatedAt, nowIso()),
    lastOperationId: ensureString(raw.lastOperationId),
    metadata: asObject(raw.metadata)
  };
}

function normalizeTurn(raw = {}) {
  return {
    relayTurnId: ensureString(raw.relayTurnId, randomId("relay_turn")),
    relaySessionId: ensureString(raw.relaySessionId, ""),
    operationId: ensureString(raw.operationId, ""),
    promptFingerprint: ensureString(raw.promptFingerprint, ""),
    effectiveMode: ensureString(raw.effectiveMode, "ask"),
    progressVisibility: ensureString(raw.progressVisibility, "default_progress_only"),
    reasoningVisibility: Boolean(raw.reasoningVisibility),
    status: ensureString(raw.status, "pending"),
    stopReason: ensureString(raw.stopReason),
    startedAt: ensureString(raw.startedAt, nowIso()),
    updatedAt: ensureString(raw.updatedAt, raw.completedAt || raw.startedAt || nowIso()),
    completedAt: ensureString(raw.completedAt),
    idempotencyKey: ensureString(raw.idempotencyKey),
    globalAuditId: ensureString(raw.globalAuditId),
    artifactRef: ensureString(raw.artifactRef),
    metadata: asObject(raw.metadata)
  };
}

function normalizeEvent(raw = {}) {
  return {
    eventId: ensureString(raw.eventId, randomId("relay_event")),
    relayTurnId: ensureString(raw.relayTurnId, ""),
    type: ensureString(raw.type, "session_update"),
    sequence: Number(raw.sequence || 0),
    redactedPayload: asObject(raw.redactedPayload),
    globalAuditId: ensureString(raw.globalAuditId),
    artifactRef: ensureString(raw.artifactRef),
    source: EVENT_SOURCES.includes(raw.source) ? raw.source : "target",
    operationId: ensureString(raw.operationId),
    createdAt: ensureString(raw.createdAt, nowIso())
  };
}

function sanitizePermissionDetails(details = {}) {
  const input = asObject(details);
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (/^(content|text|promptText|rawPrompt|rawResponse|rawTranscript)$/i.test(key)) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function normalizePermissionRequest(raw = {}) {
  return {
    requestId: ensureString(raw.requestId, randomId("relay_perm")),
    relayTurnId: ensureString(raw.relayTurnId, ""),
    targetToolCallId: ensureString(raw.targetToolCallId),
    requestedAction: ensureString(raw.requestedAction, "unknown"),
    risk: normalizeRisk(raw.risk || "read_only"),
    status: ensureString(raw.status, "pending"),
    pendingOperationId: ensureString(raw.pendingOperationId),
    decisionId: ensureString(raw.decisionId),
    details: sanitizePermissionDetails(raw.details),
    requestedAt: ensureString(raw.requestedAt, nowIso()),
    decidedAt: ensureString(raw.decidedAt)
  };
}

function normalizeStoreState(state = {}) {
  return {
    sessions: asObject(state.sessions, {}),
    turns: asObject(state.turns, {}),
    events: asObject(state.events, {}),
    permissionRequests: asObject(state.permissionRequests, {}),
    sessionIndexBySource: asObject(state.sessionIndexBySource, {})
  };
}

function createInMemoryRelaySessionAdapter(seed = {}) {
  const state = normalizeStoreState(seed);
  return {
    async upsertSession(session) {
      const next = normalizeSession(session);
      state.sessions[next.relaySessionId] = next;
      const sourceKey = `${next.sourceId}||${next.workspaceId}||${next.sourceSessionId}||${next.virtualAgentId}`;
      state.sessionIndexBySource[sourceKey] = next.relaySessionId;
      return clone(next);
    },
    async findSessionBySource({ sourceId, workspaceId, sourceSessionId, virtualAgentId }) {
      const sourceKey = `${ensureString(sourceId)}||${ensureString(workspaceId, "default")}||${ensureString(
        sourceSessionId
      )}||${ensureString(virtualAgentId)}`;
      const relaySessionId = state.sessionIndexBySource[sourceKey];
      const session = relaySessionId ? state.sessions[relaySessionId] : null;
      return session ? clone(session) : null;
    },
    async getSession(relaySessionId) {
      return state.sessions[relaySessionId] ? clone(state.sessions[relaySessionId]) : null;
    },
    async listSessions() {
      return Object.values(state.sessions).map((session) => clone(session));
    },
    async updateSession(relaySessionId, patch = {}) {
      const current = state.sessions[relaySessionId];
      if (!current) {
        return null;
      }
      const next = {
        ...current,
        ...asObject(patch),
        relaySessionId,
        updatedAt: nowIso()
      };
      state.sessions[relaySessionId] = normalizeSession(next);
      return clone(state.sessions[relaySessionId]);
    },
    async addTurn(turn) {
      const next = normalizeTurn(turn);
      state.turns[next.relayTurnId] = next;
      return clone(next);
    },
    async updateTurn(relayTurnId, patch = {}) {
      const current = state.turns[relayTurnId];
      if (!current) {
        return null;
      }
      const next = { ...current, ...asObject(patch), relayTurnId };
      state.turns[relayTurnId] = normalizeTurn(next);
      return clone(state.turns[relayTurnId]);
    },
    async getTurn(relayTurnId) {
      return state.turns[relayTurnId] ? clone(state.turns[relayTurnId]) : null;
    },
    async listTurnsBySession(relaySessionId) {
      return Object.values(state.turns)
        .filter((turn) => turn.relaySessionId === relaySessionId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((turn) => clone(turn));
    },
    async appendEvent(event) {
      const next = normalizeEvent(event);
      if (!state.events[next.relayTurnId]) {
        state.events[next.relayTurnId] = [];
      }
      state.events[next.relayTurnId].push(next);
      return clone(next);
    },
    async listEventsByTurn(relayTurnId) {
      return asArray(state.events[relayTurnId]).map((event) => clone(event));
    },
    async nextEventSequence(relayTurnId) {
      return asArray(state.events[relayTurnId]).length;
    },
    async createPermissionRequest(permissionRequest) {
      const next = normalizePermissionRequest(permissionRequest);
      state.permissionRequests[next.requestId] = next;
      return clone(next);
    },
    async getPermissionRequest(requestId) {
      const request = state.permissionRequests[requestId];
      return request ? clone(request) : null;
    },
    async updatePermissionRequest(requestId, patch = {}) {
      const current = state.permissionRequests[requestId];
      if (!current) {
        return null;
      }
      const next = {
        ...current,
        ...asObject(patch),
        requestId
      };
      state.permissionRequests[requestId] = normalizePermissionRequest(next);
      return clone(state.permissionRequests[requestId]);
    },
    async listPermissionRequestsByTurn(relayTurnId) {
      return Object.values(state.permissionRequests)
        .filter((request) => request.relayTurnId === relayTurnId)
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
        .map((request) => clone(request));
    }
  };
}

function relayStorePath({ userDataPath = "", filePath = "" } = {}) {
  const explicitPath = ensureString(filePath);
  if (explicitPath) {
    return explicitPath;
  }
  const root = ensureString(userDataPath, process.cwd());
  return path.join(root, "agent-relay", "acp-relay-store.json");
}

export function createFileRelaySessionAdapter(options = {}) {
  const storagePath = relayStorePath(options);
  let loaded = false;
  let state = normalizeStoreState({});

  async function load() {
    if (loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(storagePath, "utf8");
      state = normalizeStoreState(JSON.parse(raw));
    } catch {
      state = normalizeStoreState({});
    }
    loaded = true;
  }

  async function save() {
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, storagePath);
  }

  function indexSession(session) {
    const sourceKey = `${session.sourceId}||${session.workspaceId}||${session.sourceSessionId}||${session.virtualAgentId}`;
    state.sessionIndexBySource[sourceKey] = session.relaySessionId;
  }

  return {
    storagePath,
    async upsertSession(session) {
      await load();
      const next = normalizeSession(session);
      state.sessions[next.relaySessionId] = next;
      indexSession(next);
      await save();
      return clone(next);
    },
    async findSessionBySource({ sourceId, workspaceId, sourceSessionId, virtualAgentId }) {
      await load();
      const sourceKey = `${ensureString(sourceId)}||${ensureString(workspaceId, "default")}||${ensureString(
        sourceSessionId
      )}||${ensureString(virtualAgentId)}`;
      const relaySessionId = state.sessionIndexBySource[sourceKey];
      const session = relaySessionId ? state.sessions[relaySessionId] : null;
      return session ? clone(session) : null;
    },
    async getSession(relaySessionId) {
      await load();
      return state.sessions[relaySessionId] ? clone(state.sessions[relaySessionId]) : null;
    },
    async listSessions() {
      await load();
      return Object.values(state.sessions).map((session) => clone(session));
    },
    async updateSession(relaySessionId, patch = {}) {
      await load();
      const current = state.sessions[relaySessionId];
      if (!current) {
        return null;
      }
      const next = normalizeSession({
        ...current,
        ...asObject(patch),
        relaySessionId,
        updatedAt: nowIso()
      });
      state.sessions[relaySessionId] = next;
      indexSession(next);
      await save();
      return clone(next);
    },
    async addTurn(turn) {
      await load();
      const next = normalizeTurn(turn);
      state.turns[next.relayTurnId] = next;
      await save();
      return clone(next);
    },
    async updateTurn(relayTurnId, patch = {}) {
      await load();
      const current = state.turns[relayTurnId];
      if (!current) {
        return null;
      }
      const next = normalizeTurn({ ...current, ...asObject(patch), relayTurnId });
      state.turns[relayTurnId] = next;
      await save();
      return clone(next);
    },
    async getTurn(relayTurnId) {
      await load();
      return state.turns[relayTurnId] ? clone(state.turns[relayTurnId]) : null;
    },
    async listTurnsBySession(relaySessionId) {
      await load();
      return Object.values(state.turns)
        .filter((turn) => turn.relaySessionId === relaySessionId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((turn) => clone(turn));
    },
    async appendEvent(event) {
      await load();
      const next = normalizeEvent(event);
      if (!state.events[next.relayTurnId]) {
        state.events[next.relayTurnId] = [];
      }
      state.events[next.relayTurnId].push(next);
      await save();
      return clone(next);
    },
    async listEventsByTurn(relayTurnId) {
      await load();
      return asArray(state.events[relayTurnId]).map((event) => clone(event));
    },
    async nextEventSequence(relayTurnId) {
      await load();
      return asArray(state.events[relayTurnId]).length;
    },
    async createPermissionRequest(permissionRequest) {
      await load();
      const next = normalizePermissionRequest(permissionRequest);
      state.permissionRequests[next.requestId] = next;
      await save();
      return clone(next);
    },
    async getPermissionRequest(requestId) {
      await load();
      const request = state.permissionRequests[requestId];
      return request ? clone(request) : null;
    },
    async updatePermissionRequest(requestId, patch = {}) {
      await load();
      const current = state.permissionRequests[requestId];
      if (!current) {
        return null;
      }
      const next = normalizePermissionRequest({ ...current, ...asObject(patch), requestId });
      state.permissionRequests[requestId] = next;
      await save();
      return clone(state.permissionRequests[requestId]);
    },
    async listPermissionRequestsByTurn(relayTurnId) {
      await load();
      return Object.values(state.permissionRequests)
        .filter((request) => request.relayTurnId === relayTurnId)
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
        .map((request) => clone(request));
    }
  };
}

function resolveAdapter(adapter = {}) {
  if (typeof adapter.upsertSession === "function" && typeof adapter.findSessionBySource === "function") {
    return adapter;
  }
  return createInMemoryRelaySessionAdapter(asObject(adapter.state || adapter.initialState));
}

export class RelaySessionStore {
  constructor({ adapter = {} } = {}) {
    this.adapter = resolveAdapter(adapter);
  }

  async createSession(input = {}) {
    const existing = await this.getSessionBySourceKey(input);
    if (existing) {
      return existing;
    }
    const sourcePayload = asObject(input.sourcePayload);
    const session = normalizeSession({
      sourceId: ensureString(input.sourceId, sourcePayload.subjectId || sourcePayload.subject?.subjectId || "system"),
      sourceSessionId: ensureString(input.sourceSessionId),
      virtualAgentId: ensureString(input.virtualAgentId),
      targetId: ensureString(input.targetId),
      sourceSubjectId: ensureString(input.sourceSubjectId, sourcePayload.subjectId || sourcePayload.subject?.subjectId || ""),
      workspaceId: ensureString(input.workspaceId || sourcePayload.workspaceId || "default"),
      cwd: ensureString(input.cwd || sourcePayload.cwd || "."),
      lifecycleState: ensureString(input.lifecycleState || "dormant"),
      wakePolicy: ensureString(input.wakePolicy || "manual"),
      policyRevision: Number(input.policyRevision || 1),
      relayMcpGrantId: ensureString(input.relayMcpGrantId),
      capabilitiesSnapshot: asObject(input.capabilitiesSnapshot, null),
      metadata: {
        ...(sourcePayload.metadata || {}),
        ...(asObject(input.metadata)),
        createdBy: ensureString(input.createdBy || sourcePayload.createdBy),
        adapterHint: sourcePayload.adapterHint || "memory"
      }
    });
    return this.adapter.upsertSession(session);
  }

  async getSession(relaySessionId) {
    return this.adapter.getSession(relaySessionId);
  }

  async listSessions() {
    return this.adapter.listSessions();
  }

  async getSessionBySourceKey(input = {}) {
    return this.adapter.findSessionBySource({
      sourceId: ensureString(input.sourceId),
      workspaceId: ensureString(input.workspaceId, "default"),
      sourceSessionId: ensureString(input.sourceSessionId),
      virtualAgentId: ensureString(input.virtualAgentId)
    });
  }

  async updateSession(relaySessionId, patch = {}) {
    return this.adapter.updateSession(relaySessionId, {
      ...asObject(patch),
      updatedAt: nowIso()
    });
  }

  async createTurn(input = {}) {
    const turn = normalizeTurn({
      ...input,
      status: ensureString(input.status || "running"),
      progressVisibility: ensureString(input.progressVisibility || "default_progress_only"),
      reasoningVisibility: Boolean(input.reasoningVisibility)
    });
    return this.adapter.addTurn(turn);
  }

  async getTurn(relayTurnId) {
    return this.adapter.getTurn(relayTurnId);
  }

  async listTurns(relaySessionId) {
    return this.adapter.listTurnsBySession(relaySessionId);
  }

  async getTurnByIdempotencyKey(relaySessionId, idempotencyKey) {
    const key = ensureString(idempotencyKey);
    if (!key) {
      return null;
    }
    const turns = await this.listTurns(relaySessionId);
    return turns
      .filter((turn) => turn.idempotencyKey === key)
      .sort((a, b) =>
        ensureString(b.updatedAt || b.completedAt || b.startedAt).localeCompare(
          ensureString(a.updatedAt || a.completedAt || a.startedAt)
        )
      )[0] || null;
  }

  async updateTurn(relayTurnId, patch = {}) {
    return this.adapter.updateTurn(relayTurnId, {
      ...asObject(patch),
      updatedAt: nowIso()
    });
  }

  async recordEvent(relayTurnId, eventInput = {}) {
    const sequence = await this.adapter.nextEventSequence(relayTurnId);
    const event = normalizeEvent({
      ...eventInput,
      relayTurnId,
      sequence: Number(eventInput.sequence || 0) || sequence,
      source: EVENT_SOURCES.includes(eventInput.source) ? eventInput.source : "target"
    });
    return this.adapter.appendEvent(event);
  }

  async listEvents(relayTurnId) {
    return this.adapter.listEventsByTurn(relayTurnId);
  }

  async createPermissionRequest(input = {}) {
    return this.adapter.createPermissionRequest(input);
  }

  async getPermissionRequest(requestId) {
    return this.adapter.getPermissionRequest(requestId);
  }

  async updatePermissionRequest(requestId, patch = {}) {
    return this.adapter.updatePermissionRequest(requestId, {
      ...asObject(patch),
      decidedAt: nowIso()
    });
  }

  async listPermissionRequests(relayTurnId) {
    return this.adapter.listPermissionRequestsByTurn(relayTurnId);
  }
}

export function createRelaySessionStore(seed = {}) {
  return new RelaySessionStore({
    adapter: createInMemoryRelaySessionAdapter(seed.state || seed)
  });
}

export { randomId };
