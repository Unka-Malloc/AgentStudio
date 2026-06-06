import crypto from "node:crypto";

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function reasonError(code, message, details = {}) {
  return {
    ok: false,
    code,
    message,
    details,
    timestamp: nowIso()
  };
}

function hashInput(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function chooseMode(agent, requestedMode = "") {
  if (!agent?.advertisedModes?.length) {
    return "ask";
  }
  if (requestedMode && agent.advertisedModes.includes(requestedMode)) {
    return requestedMode;
  }
  if (agent.defaultMode) {
    return agent.defaultMode || agent.advertisedModes[0];
  }
  return agent.advertisedModes[0] || "ask";
}

function resolveReasoningVisibility(agent, input = {}) {
  const policy = asText(agent?.reasoningVisibilityPolicy, "requestable");
  const requestVisible = Boolean(input?.requestReasoning === true);
  if (policy === "never") {
    return false;
  }
  return requestVisible === true;
}

function resolveWritesPolicy(agent) {
  return {
    writes: asText(agent?.capabilityPolicy?.writes, "deny")
  };
}

function resolveTerminalPolicy(agent) {
  return {
    terminal: asText(agent?.capabilityPolicy?.terminal, "deny")
  };
}

function buildPolicyRevision(agent, target) {
  return Number(((agent?.revision || 0) + (target?.revision || 0) || 1));
}

const RISK_ORDER = Object.freeze(["read_only", "safe_write", "repair_write", "destructive"]);

function stricterRisk(left = "read_only", right = "read_only") {
  const leftRisk = asText(left, "read_only");
  const rightRisk = asText(right, "read_only");
  const leftIndex = RISK_ORDER.includes(leftRisk) ? RISK_ORDER.indexOf(leftRisk) : 0;
  const rightIndex = RISK_ORDER.includes(rightRisk) ? RISK_ORDER.indexOf(rightRisk) : 0;
  return RISK_ORDER[Math.min(leftIndex, rightIndex)] || "read_only";
}

function stricterWritesPolicy(virtualPolicy = {}, targetPolicy = {}) {
  const values = [asText(virtualPolicy.writes, "deny"), asText(targetPolicy.writes, "deny")];
  if (values.includes("deny")) {
    return "deny";
  }
  if (values.includes("approval_required")) {
    return "approval_required";
  }
  return values[0] || values[1] || "deny";
}

function stricterTerminalPolicy(virtualPolicy = {}, targetPolicy = {}) {
  const values = [asText(virtualPolicy.terminal, "deny"), asText(targetPolicy.terminal, "deny")];
  return values.includes("deny") ? "deny" : values[0] || values[1] || "deny";
}

function intersectTools(virtualTools = [], targetTools = []) {
  const targetSet = new Set(Array.isArray(targetTools) ? targetTools : []);
  return (Array.isArray(virtualTools) ? virtualTools : []).filter((tool) => targetSet.has(tool));
}

function resolveEffectivePolicyAndTools(virtualAgent = {}, target = {}) {
  const virtualPolicy = asObject(virtualAgent.capabilityPolicy);
  const targetPolicy = asObject(target.capabilityPolicy);
  const advertisedTools = intersectTools(virtualAgent.advertisedTools, target.advertisedToolsets);
  return {
    advertisedTools,
    writesPolicy: { writes: stricterWritesPolicy(virtualPolicy, targetPolicy) },
    terminalPolicy: { terminal: stricterTerminalPolicy(virtualPolicy, targetPolicy) },
    maxRisk: stricterRisk(virtualPolicy.maxRisk, targetPolicy.maxRisk)
  };
}

function sourceIdentityForRoute(input = {}) {
  const raw = asObject(input.sourceIdentity);
  return {
    sourceId: asText(raw.sourceId || input.sourceId),
    sourceSessionId: asText(raw.sourceSessionId || input.sourceSessionId),
    workspaceId: asText(raw.workspaceId || input.workspaceId, "default"),
    virtualAgentId: asText(raw.virtualAgentId || input.virtualAgentId),
    sourceSubjectId: asText(raw.sourceSubjectId || raw.subjectId || input.sourceSubjectId || input.subjectId)
  };
}

export class AcpRelayRouter {
  constructor({ virtualAgentRegistry, targetRegistry }) {
    this.virtualAgentRegistry = virtualAgentRegistry;
    this.targetRegistry = targetRegistry;
  }

  async resolveForSourceSession(input = {}) {
    const virtualAgentId = asText(input.virtualAgentId);
    const workspaceId = asText(input.workspaceId, "default");
    const requestedMode = asText(input.requestedMode);
    const virtualAgent = this.virtualAgentRegistry?.getAgent(virtualAgentId);
    if (!virtualAgent) {
      return {
        ok: false,
        status: 404,
        error: reasonError("virtual_agent_unknown", "Unknown virtual agent.", { virtualAgentId })
      };
    }
    if (virtualAgent.enabled === false) {
      return {
        ok: false,
        status: 403,
        error: reasonError("virtual_agent_disabled", "Virtual agent is disabled.", {
          virtualAgentId
        })
      };
    }

    const target = this.targetRegistry?.getTarget(virtualAgent.targetId);
    if (!target) {
      return {
        ok: false,
        status: 404,
        error: reasonError("target_unknown", "Target not found for virtual agent.", {
          targetId: virtualAgent.targetId
        })
      };
    }
    if (target.enabled === false) {
      return {
        ok: false,
        status: 403,
        error: reasonError("target_disabled", "Target disabled.", {
          targetId: target.targetId
        })
      };
    }

    const effectiveMode = chooseMode(virtualAgent, requestedMode);
    const effective = resolveEffectivePolicyAndTools(virtualAgent, target);
    if (asText(target.externalServiceId) && asText(virtualAgent.metadata?.expectedExternalServiceId) && target.externalServiceId !== virtualAgent.metadata.expectedExternalServiceId) {
      return {
        ok: false,
        status: 403,
        error: reasonError("target_external_service_mismatch", "Target external service binding does not match the virtual agent.", {
          targetId: target.targetId,
          externalServiceId: target.externalServiceId
        })
      };
    }
    if (asText(virtualAgent.metadata?.expectedExternalServiceId) && !asText(target.externalServiceId)) {
      return {
        ok: false,
        status: 403,
        error: reasonError("target_external_service_missing", "Target external service binding is required for this virtual agent.", {
          targetId: target.targetId
        })
      };
    }
    const policyRevision = buildPolicyRevision(virtualAgent, target);
    const reasoningAllowed = resolveReasoningVisibility(virtualAgent, input);
    const turnFingerprint = hashInput(`${virtualAgentId}|${requestedMode}|${workspaceId}|${asText(input.prompt)}`);

    return {
      ok: true,
      status: 200,
      route: {
        virtualAgent: { ...virtualAgent },
        target: { ...target },
        workspaceId,
        effectiveMode,
        modeRequested: requestedMode,
        sourceSessionFingerprint: hashInput(`${asText(input.sourceSessionId)}|${asText(input.sourceId)}`),
        policyRevision,
        decision: {
          writesPolicy: effective.writesPolicy,
          terminalPolicy: effective.terminalPolicy,
          maxRisk: effective.maxRisk,
          advertisedTools: effective.advertisedTools,
          reasoningAllowed,
          progressOnly: true
        },
        turnFingerprint,
        sourceSubjectId: asText(input.sourceSubjectId || input.subjectId),
        sourceIdentity: sourceIdentityForRoute(input),
        requestId: asText(input.requestId)
      }
    };
  }
}

export function createAcpRelayRouter(deps = {}) {
  return new AcpRelayRouter(deps);
}
