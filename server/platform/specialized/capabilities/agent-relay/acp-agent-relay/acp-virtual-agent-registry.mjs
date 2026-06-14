import fs from "node:fs";
import path from "node:path";

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePolicy(value = {}) {
  const policy = asObject(value);
  return {
    writes: asText(policy.writes, "deny"),
    terminal: asText(policy.terminal, "deny"),
    maxRisk: asText(policy.maxRisk, "read_only")
  };
}

function normalizeVisibilityPolicy(value = {}) {
  return {
    writes: normalizePolicy(value).writes,
    terminal: normalizePolicy(value).terminal,
    maxRisk: normalizePolicy(value).maxRisk
  };
}

function normalizeAgent(raw = {}) {
  const sourcePolicy = asObject(raw.capabilityPolicy, {
    writes: "deny",
    terminal: "deny",
    maxRisk: "read_only"
  });
  return {
    virtualAgentId: asText(raw.virtualAgentId || raw.id),
    targetId: asText(raw.targetId),
    profileId: asText(raw.profileId),
    displayName: asText(raw.displayName, raw.virtualAgentId || raw.id || "mock-virtual-agent"),
    description: asText(raw.description),
    advertisedModes: asArray(raw.advertisedModes),
    defaultMode: asText(raw.defaultMode, "ask"),
    advertisedModalities: asArray(raw.advertisedModalities),
    advertisedDataSources: asArray(raw.advertisedDataSources),
    advertisedTools: asArray(raw.advertisedTools),
    visibilityPolicy: asText(raw.visibilityPolicy || "public"),
    reasoningVisibilityPolicy: asText(raw.reasoningVisibilityPolicy, "requestable"),
    capabilityPolicy: normalizeVisibilityPolicy(sourcePolicy),
    enabled: raw.enabled !== false,
    disabledReason: asText(raw.disabledReason),
    revision: Number(raw.revision || 1),
    createdAt: asText(raw.createdAt),
    updatedAt: asText(raw.updatedAt),
    metadata: asObject(raw.metadata)
  };
}

function normalizeAgentState(state = {}) {
  const rawAgents = Array.isArray(state.virtualAgents || state.agents)
    ? Object.fromEntries((state.virtualAgents || state.agents).map((agent) => [asText(agent.virtualAgentId || agent.id), agent]))
    : asObject(state.virtualAgents || state.agents, state);
  const virtualAgents = {};
  for (const [virtualAgentId, raw] of Object.entries(rawAgents)) {
    const agent = normalizeAgent({ ...asObject(raw), virtualAgentId });
    if (agent.virtualAgentId) {
      virtualAgents[agent.virtualAgentId] = agent;
    }
  }
  return { virtualAgents };
}

function virtualAgentRegistryPath({ userDataPath = "", filePath = "" } = {}) {
  const explicitPath = asText(filePath);
  if (explicitPath) {
    return explicitPath;
  }
  const root = asText(userDataPath, process.cwd());
  return path.join(root, "agent-relay", "acp-virtual-agent-registry.json");
}

export function createFileAcpVirtualAgentRegistryAdapter(options = {}) {
  const storagePath = virtualAgentRegistryPath(options);

  function loadAgents() {
    try {
      const raw = fs.readFileSync(storagePath, "utf8");
      return normalizeAgentState(JSON.parse(raw)).virtualAgents;
    } catch {
      return {};
    }
  }

  function persistAgents(agents = {}) {
    const normalized = normalizeAgentState({ virtualAgents: agents });
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify({
      schemaVersion: "v0.0.1:agent:acp-agent-relay-virtual-agent-registry-1",
      updatedAt: nowIso(),
      virtualAgents: normalized.virtualAgents
    }, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, storagePath);
    return clone(normalized.virtualAgents);
  }

  return {
    storagePath,
    loadAgents,
    persistAgents
  };
}

const DEFAULT_VIRTUAL_AGENTS = {
  "antigravity.repo-analysis": {
    virtualAgentId: "antigravity.repo-analysis",
    targetId: "mock.repo-analysis:stdio",
    profileId: "pact.acp.antigravity.repo_analysis",
    displayName: "Antigravity Repo Analysis",
    description: "Read-only repo analysis ACP virtual profile.",
    advertisedModes: ["ask"],
    defaultMode: "ask",
    advertisedModalities: ["text"],
    advertisedDataSources: ["workspace.files", "pact.knowledge.local"],
    advertisedTools: ["pact.agentLibrary.search", "fs.readTextFile"],
    reasoningVisibilityPolicy: "requestable",
    capabilityPolicy: {
      writes: "deny",
      terminal: "deny",
      maxRisk: "read_only"
    },
    enabled: true,
    revision: 1
  },
  "antigravity.multimodal-coding": {
    virtualAgentId: "antigravity.multimodal-coding",
    targetId: "mock.antigravity:stdio",
    profileId: "pact.acp.antigravity.multimodal_coding",
    displayName: "Antigravity Multimodal Coding",
    description: "Write-capable coding ACP virtual profile.",
    advertisedModes: ["ask", "edit", "agent"],
    defaultMode: "agent",
    advertisedModalities: ["text", "image", "screenshot", "document"],
    advertisedDataSources: ["workspace.files", "pact.knowledge.local", "pact.document.runtime"],
    advertisedTools: ["pact.agentLibrary.search", "fs.readTextFile", "fs.writeTextFile"],
    reasoningVisibilityPolicy: "requestable",
    capabilityPolicy: {
      writes: "approval_required",
      terminal: "deny",
      maxRisk: "repair_write"
    },
    enabled: true,
    revision: 1
  }
};

export class AcpVirtualAgentRegistry {
  constructor(seedAgents = DEFAULT_VIRTUAL_AGENTS, options = {}) {
    this.agents = new Map();
    this.adapter = options.adapter || null;
    const persistedAgents = this.adapter && typeof this.adapter.loadAgents === "function"
      ? this.adapter.loadAgents()
      : {};
    for (const [agentId, raw] of Object.entries({
      ...(seedAgents || {}),
      ...asObject(persistedAgents)
    })) {
      const normalized = normalizeAgent({ ...raw, virtualAgentId: agentId });
      if (normalized.virtualAgentId) {
        this.agents.set(normalized.virtualAgentId, normalized);
      }
    }
  }

  persist() {
    if (this.adapter && typeof this.adapter.persistAgents === "function") {
      this.adapter.persistAgents(Object.fromEntries(this.agents));
    }
  }

  upsertAgent(raw = {}) {
    const normalized = normalizeAgent(raw);
    if (!normalized.virtualAgentId) {
      return null;
    }
    this.agents.set(normalized.virtualAgentId, normalized);
    this.persist();
    return normalized;
  }

  patchAgent(virtualAgentId = "", patch = {}) {
    const current = this.getAgent(virtualAgentId);
    if (!current) {
      return null;
    }
    return this.upsertAgent({
      ...current,
      ...asObject(patch),
      virtualAgentId: current.virtualAgentId,
      capabilityPolicy: {
        ...asObject(current.capabilityPolicy),
        ...asObject(patch.capabilityPolicy)
      },
      metadata: {
        ...asObject(current.metadata),
        ...asObject(patch.metadata)
      }
    });
  }

  disableAgent(virtualAgentId = "", disabledReason = "disabled") {
    return this.patchAgent(virtualAgentId, {
      enabled: false,
      disabledReason
    });
  }

  listAgents() {
    return [...this.agents.values()].map((agent) => ({ ...agent })).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getAgent(virtualAgentId = "") {
    return this.agents.get(asText(virtualAgentId)) || null;
  }

  isAgentEnabled(virtualAgentId = "") {
    const agent = this.getAgent(virtualAgentId);
    return Boolean(agent?.enabled);
  }

  listEnabled() {
    return this.listAgents().filter((agent) => agent.enabled !== false);
  }

  getToolsetForMode(agent, requestedMode = "ask") {
    const target = this.getAgent(agent);
    if (!target) {
      return [];
    }
    const effectiveMode = target.advertisedModes.includes(requestedMode) ? requestedMode : target.defaultMode;
    return {
      agent: target,
      effectiveMode,
      advertisedTools: asArray(target.advertisedTools)
    };
  }
}

export function createDefaultAcpVirtualAgentRegistry() {
  return new AcpVirtualAgentRegistry();
}
