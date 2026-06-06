import fs from "node:fs";
import path from "node:path";

const DEFAULT_TARGET_STATUS = Object.freeze({
  enabled: true,
  disabledReason: ""
});

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
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

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCapabilityPolicy(value = {}) {
  const raw = asObject(value);
  return {
    writes: asText(raw.writes, "deny"),
    terminal: asText(raw.terminal, "deny"),
    maxRisk: asText(raw.maxRisk, "read_only")
  };
}

function normalizeTransport(value = {}) {
  const raw = asObject(value);
  return {
    type: asText(raw.type || raw.transport || "mock"),
    protocolStyle: asText(raw.protocolStyle || raw.protocolSchema || raw.protocol),
    nativeAcpTargetSupported: asBoolean(raw.nativeAcpTargetSupported, false),
    nativeAcpTargetVerified: asBoolean(raw.nativeAcpTargetVerified, false),
    nativeAcpSourceSupported: asBoolean(raw.nativeAcpSourceSupported, false),
    nativeAcpSourceVerified: asBoolean(raw.nativeAcpSourceVerified, false),
    url: asText(raw.url),
    address: asText(raw.address || raw.lsAddress),
    csrfToken: asText(raw.csrfToken || raw.token),
    binaryPath: asText(raw.binaryPath || raw.commandPath),
    conversationId: asText(raw.conversationId || raw.recipientId),
    model: asText(raw.model),
    command: asObject(raw.command),
    agentApi: asObject(raw.agentApi),
    timeoutMs: Number(raw.timeoutMs || 0) || 120000,
    localObservationEnabled: raw.localObservationEnabled === true || raw.observeLocalConversation === true,
    localObservationBrainRoot: asText(raw.localObservationBrainRoot || raw.brainRoot),
    localObservationTimeoutMs: Number(raw.localObservationTimeoutMs || raw.observationTimeoutMs || 0) || 12000,
    localObservationPollIntervalMs: Number(raw.localObservationPollIntervalMs || raw.observationPollIntervalMs || 0) || 1000,
    connectEnabled: asBoolean(raw.connectEnabled ?? raw.connectObservationEnabled ?? raw.observeConnectConversation, false),
    connectAddress: asText(raw.connectAddress || raw.rpcAddress),
    connectCsrfToken: asText(raw.connectCsrfToken || raw.rpcCsrfToken),
    connectTimeoutMs: Number(raw.connectTimeoutMs || raw.rpcTimeoutMs || 0) || 8000,
    connectObservationTimeoutMs: Number(raw.connectObservationTimeoutMs || raw.connectObserveTimeoutMs || 0) || 12000,
    connectObservationPollIntervalMs: Number(raw.connectObservationPollIntervalMs || raw.connectObservePollIntervalMs || 0) || 1000,
    connectWaitForFinalResponse: asBoolean(
      raw.connectWaitForFinalResponse ?? raw.waitForConnectFinalResponse ?? raw.connectWaitForFinal,
      true
    ),
    connectFlushQueuedMessages: asBoolean(raw.connectFlushQueuedMessages ?? raw.flushQueuedMessages, false),
    connectDenyPendingCommandInteractions: asBoolean(
      raw.connectDenyPendingCommandInteractions ??
        raw.connectDenyPendingCommandInteraction ??
        raw.denyPendingCommandInteractions ??
        raw.denyPendingCommandInteraction,
      false
    ),
    connectForceStopStuckCascade: asBoolean(raw.connectForceStopStuckCascade ?? raw.forceStopStuckCascade, false)
  };
}

function normalizeTarget(raw = {}) {
  const transport = normalizeTransport(raw.transport || raw);
  const status = asObject(raw.status, DEFAULT_TARGET_STATUS);
  return {
    targetId: asText(raw.targetId || raw.id),
    label: asText(raw.label || raw.targetId || raw.id || "unknown-target"),
    transport,
    agentProfileId: asText(raw.agentProfileId),
    enabled: raw.enabled === false ? false : status.enabled !== false,
    disabledReason: asText(raw.disabledReason || status.disabledReason),
    capabilityPolicy: normalizeCapabilityPolicy(raw.capabilityPolicy),
    externalServiceId: asText(raw.externalServiceId),
    advertisedToolsets: asArray(raw.advertisedToolsets),
    lastHandshakeAt: asText(raw.lastHandshakeAt),
    revision: Number(raw.revision || 1),
    metadata: asObject(raw.metadata)
  };
}

function normalizeTargetState(state = {}) {
  const rawTargets = Array.isArray(state.targets)
    ? Object.fromEntries(state.targets.map((target) => [asText(target.targetId || target.id), target]))
    : asObject(state.targets, state);
  const targets = {};
  for (const [targetId, raw] of Object.entries(rawTargets)) {
    const target = normalizeTarget({ ...asObject(raw), targetId });
    if (target.targetId) {
      targets[target.targetId] = target;
    }
  }
  return { targets };
}

function targetRegistryPath({ userDataPath = "", filePath = "" } = {}) {
  const explicitPath = asText(filePath);
  if (explicitPath) {
    return explicitPath;
  }
  const root = asText(userDataPath, process.cwd());
  return path.join(root, "agent-relay", "acp-target-registry.json");
}

export function createFileAcpTargetRegistryAdapter(options = {}) {
  const storagePath = targetRegistryPath(options);

  function loadTargets() {
    try {
      const raw = fs.readFileSync(storagePath, "utf8");
      return normalizeTargetState(JSON.parse(raw)).targets;
    } catch {
      return {};
    }
  }

  function persistTargets(targets = {}) {
    const normalized = normalizeTargetState({ targets });
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify({
      schemaVersion: "pact.acp-agent-relay.target-registry.v1",
      updatedAt: nowIso(),
      targets: normalized.targets
    }, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, storagePath);
    return clone(normalized.targets);
  }

  return {
    storagePath,
    loadTargets,
    persistTargets
  };
}

const DEFAULT_MOCK_TARGETS = {
  "mock.antigravity:stdio": {
    targetId: "mock.antigravity:stdio",
    label: "Antigravity Mock ACP Target",
    transport: { type: "mock" },
    agentProfileId: "pact.acp.antigravity.mock",
    enabled: true,
    externalServiceId: "mock.acp.antigravity",
    capabilityPolicy: {
      writes: "approval_required",
      terminal: "deny",
      maxRisk: "repair_write"
    },
    advertisedToolsets: ["fs.readTextFile", "fs.writeTextFile", "repo.suggest"]
  },
  "mock.repo-analysis:stdio": {
    targetId: "mock.repo-analysis:stdio",
    label: "Repo-Analysis Mock ACP Target",
    transport: { type: "mock" },
    agentProfileId: "pact.acp.repo-analysis.mock",
    enabled: true,
    externalServiceId: "mock.acp.repo-analysis",
    capabilityPolicy: {
      writes: "deny",
      terminal: "deny",
      maxRisk: "read_only"
    },
    advertisedToolsets: ["fs.readTextFile"]
  }
};

export class AcpTargetRegistry {
  constructor(seedTargets = DEFAULT_MOCK_TARGETS, options = {}) {
    this.targets = new Map();
    this.adapter = options.adapter || null;
    const persistedTargets = this.adapter && typeof this.adapter.loadTargets === "function"
      ? this.adapter.loadTargets()
      : {};
    for (const [targetId, raw] of Object.entries({
      ...(seedTargets || {}),
      ...asObject(persistedTargets)
    })) {
      const target = normalizeTarget({ ...raw, targetId });
      if (target.targetId) {
        this.targets.set(target.targetId, target);
      }
    }
  }

  persist() {
    if (this.adapter && typeof this.adapter.persistTargets === "function") {
      this.adapter.persistTargets(Object.fromEntries(this.targets));
    }
  }

  upsertTarget(raw = {}) {
    const target = normalizeTarget(raw);
    if (!target.targetId) {
      return null;
    }
    this.targets.set(target.targetId, target);
    this.persist();
    return target;
  }

  patchTarget(targetId = "", patch = {}) {
    const current = this.getTarget(targetId);
    if (!current) {
      return null;
    }
    return this.upsertTarget({
      ...current,
      ...asObject(patch),
      targetId: current.targetId,
      transport: {
        ...asObject(current.transport),
        ...asObject(patch.transport)
      },
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

  disableTarget(targetId = "", disabledReason = "disabled") {
    return this.patchTarget(targetId, {
      enabled: false,
      disabledReason
    });
  }

  listTargets() {
    return [...this.targets.values()]
      .map((target) => ({ ...target }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  getTarget(targetId = "") {
    return this.targets.get(asText(targetId)) || null;
  }

  isTargetEnabled(targetId = "") {
    const target = this.getTarget(targetId);
    return Boolean(target?.enabled);
  }

  getAdvertisedToolsets(targetId = "") {
    const target = this.getTarget(targetId);
    return target ? asArray(target.advertisedToolsets) : [];
  }

  getPolicy(targetId = "") {
    const target = this.getTarget(targetId);
    return target ? target.capabilityPolicy : null;
  }
}

export function createDefaultAcpTargetRegistry() {
  return new AcpTargetRegistry();
}
