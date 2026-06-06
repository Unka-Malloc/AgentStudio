import { createHash } from "node:crypto";

export const STRATEGY_MANAGEMENT_PROTOCOL_VERSION = "pact.strategy-management.v1";
export const STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION = "pact.model-routing.v1";
export const STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION = "pact.model-decision.v1";

function nowIso() {
  return new Date().toISOString();
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function randomDecisionId(prefix = "strategy") {
  const entropy = createHash("sha256")
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest("hex")
    .slice(0, 12);
  return `${prefix}_${entropy}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

function riskFrom(input = {}) {
  return compactText(input.risk || input.safety?.risk || input.operation?.safety?.risk || "");
}

function workflowEffect(input = {}) {
  if (input.blocked === true || input.operation?.safety?.blocked === true) {
    return {
      effect: "deny",
      reasonCode: "workflow_blocked",
      requiresApproval: false
    };
  }
  const risk = riskFrom(input);
  if (
    input.requiresConfirmation === true ||
    input.operation?.safety?.requiresConfirmation === true ||
    risk === "repair_write" ||
    risk === "destructive"
  ) {
    return {
      effect: "require_confirmation",
      reasonCode: "workflow_confirmation_required",
      requiresApproval: true
    };
  }
  return {
    effect: "allow",
    reasonCode: "workflow_allowed",
    requiresApproval: false
  };
}

function shouldUseModelRouting(input = {}, settings = {}) {
  return Boolean(
    input.modelRouting?.enabled === true ||
      input.routing?.enabled === true ||
      settings.modelRouting?.enabled === true
  );
}

function routeTargetFrom(input = {}) {
  const target = input.target || {};
  const route = input.route || {};
  return {
    routeId: compactText(input.routeId || route.routeId || target.routeId || "route.default"),
    fromAspect: compactText(input.fromAspect || input.gatewayId || route.fromAspect || "aspect.unspecified"),
    protocol: compactText(input.protocol || route.protocol || target.protocol || ""),
    routeKind: compactText(input.routeKind || route.kind || target.kind || (
      input.externalServiceId || target.externalServiceId || input.endpointRef || target.endpointRef
        ? "external-service"
        : "platform-capability"
    )),
    internalCapabilityId: compactText(
      input.internalCapabilityId ||
        input.platformCapabilityId ||
        target.internalCapabilityId ||
        target.platformCapabilityId ||
        target.capabilityId ||
        ""
    ),
    externalServiceId: compactText(input.externalServiceId || target.externalServiceId || target.serviceId || ""),
    endpointRef: compactText(input.endpointRef || target.endpointRef || "")
  };
}

function routePolicyEffect(route = {}, input = {}) {
  if (input.blocked === true || input.route?.blocked === true || input.target?.blocked === true) {
    return {
      effect: "deny",
      reasonCode: "route_blocked",
      allowed: false
    };
  }
  if (!route.internalCapabilityId && !route.externalServiceId && !route.endpointRef) {
    return {
      effect: "deny",
      reasonCode: "route_target_missing",
      allowed: false
    };
  }
  if (route.routeKind === "external-service" && !route.externalServiceId && !route.endpointRef) {
    return {
      effect: "deny",
      reasonCode: "route_external_target_missing",
      allowed: false
    };
  }
  return {
    effect: "allow",
    reasonCode: "route_allowed",
    allowed: true
  };
}

async function loadModelRoutingCore() {
  return import("../../agent/agent-gateway/model-routing/index.mjs");
}

function localToolPolicyDecision({
  tool = null,
  grant = null,
  profile = null,
  input = {},
  request = null,
  context = {},
  dryRun = false,
  traceId = "",
  toolExecutionId = "",
  securityPermissions = null,
  store = null
} = {}) {
  const evaluatedLayers = [
    "platform_default",
    "server_policy",
    grant ? "grant_policy" : "",
    profile ? "agent_profile_policy" : "",
    "session_task_policy",
    "runtime_safety_policy"
  ].filter(Boolean);
  const authorizationDecision = (typeof securityPermissions?.evaluatePolicy === "function"
    ? securityPermissions.evaluatePolicy({
        tool,
        grant,
        profile,
        input,
        request,
        context: {
          ...context,
          toolExpected: true
        },
        dryRun,
        traceId,
        toolExecutionId,
        grantRequired: true
      })
    : null) || {
      effect: "deny",
      allowed: false,
      reasonCode: "authorization_provider_unavailable",
      redactedReason: "Security permissions provider is unavailable.",
      missingScopes: [],
      missingToolsets: [],
      evaluatedLayers: [],
      createdAt: nowIso()
    };
  const decision = {
    ...authorizationDecision,
    decisionId: `policy_${randomDecisionId("tool")}`,
    strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
    policyType: "tool-policy",
    toolExecutionId,
    traceId,
    toolId: tool?.id || "",
    grantId: grant?.id || "",
    missingScopes: uniqueStrings(authorizationDecision.missingScopes || []),
    missingToolsets: authorizationDecision.effect === "deny"
      ? uniqueStrings(authorizationDecision.missingToolsets || [])
      : [],
    evaluatedLayers: uniqueStrings([...(authorizationDecision.evaluatedLayers || []), ...evaluatedLayers, "strategy_management"]),
    createdAt: authorizationDecision.createdAt || nowIso()
  };
  if (store && typeof store.appendPolicyDecision === "function") {
    store.appendPolicyDecision(decision);
  }
  return decision;
}

function toolPolicyInput(input = {}) {
  const platform = input.toolManagementPlatform || null;
  const registry = input.registry || platform?.registry || null;
  const store = input.store || platform?.store || null;
  const tool = input.tool || registry?.getTool?.(input.toolId);
  const grant = input.grant ||
    (input.grantId && typeof store?.getRawGrant === "function" ? store.getRawGrant(input.grantId) : null);
  const profile = input.profile ||
    (input.profileId && typeof registry?.listProfiles === "function"
      ? registry.listProfiles().find((item) => item.id === input.profileId)
      : null);
  return {
    ...input,
    tool,
    grant,
    profile,
    registry,
    store,
    securityPermissions: input.securityPermissions || platform?.securityPermissions || null
  };
}

export function createStrategyManagementProvider({
  userDataPath = "",
  modelDecisionRuntime = null,
  getToolManagementPlatform = () => null
} = {}) {
  function describe() {
    return {
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      capabilities: [
        "workflow-policy.evaluate",
        "agent-policy.evaluate",
        "route-policy.evaluate",
        "model-routing.run",
        "model-routing.inspect",
        "model-decision.decide",
        "tool-policy.evaluate"
      ],
      delegatedProtocols: {
        modelRouting: STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION,
        modelDecision: modelDecisionRuntime?.protocolVersion || STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
        toolPolicy: "pact.authorization.v1"
      }
    };
  }

  function evaluateWorkflowPolicy(input = {}) {
    const effect = workflowEffect(input);
    return {
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "workflow-policy",
      decisionId: randomDecisionId("workflow"),
      workflowId: compactText(input.workflowId || input.operationId || input.operation?.id || "workflow.default"),
      stage: compactText(input.stage || input.action || "evaluate"),
      risk: riskFrom(input) || "read_only",
      ...effect,
      createdAt: nowIso()
    };
  }

  function evaluateAgentPolicy(input = {}) {
    const roleId = compactText(input.roleId || input.routeId || input.agentId || "agent.default");
    return {
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "agent-policy",
      decisionId: randomDecisionId("agent"),
      roleId,
      routeId: compactText(input.routeId || input.modelRouting?.routeId || roleId),
      effect: "allow",
      reasonCode: "agent_policy_allowed",
      createdAt: nowIso()
    };
  }

  function evaluateRoutePolicy(input = {}) {
    const route = routeTargetFrom(input);
    const effect = routePolicyEffect(route, input);
    return {
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "route-policy",
      decisionId: randomDecisionId("route"),
      routeId: route.routeId,
      fromAspect: route.fromAspect,
      protocol: route.protocol,
      routeKind: route.routeKind,
      internalCapabilityId: route.internalCapabilityId,
      externalServiceId: route.externalServiceId,
      endpointRef: route.endpointRef,
      evaluatedLayers: ["strategy_management", "route_policy"],
      ...effect,
      createdAt: nowIso()
    };
  }

  async function decideWithModel(input = {}) {
    const policyDecision = evaluateAgentPolicy({
      ...input,
      policyKind: "model-decision",
      roleId: input.roleId
    });
    if (!modelDecisionRuntime || typeof modelDecisionRuntime.decide !== "function") {
      return {
        protocolVersion: STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
        strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
        usedModel: false,
        roleId: compactText(input.roleId || ""),
        fallbackReason: "model_decision_runtime_unavailable",
        strategyPolicyDecision: policyDecision
      };
    }
    const decision = await modelDecisionRuntime.decide(input);
    return {
      ...decision,
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      strategyPolicyDecision: policyDecision
    };
  }

  function createModelDecisionRuntimePort() {
    return {
      protocolVersion: modelDecisionRuntime?.protocolVersion || STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
      describe() {
        const description = typeof modelDecisionRuntime?.describe === "function"
          ? modelDecisionRuntime.describe()
          : { protocolVersion: STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION, roles: [] };
        return {
          ...description,
          strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION
        };
      },
      decide: decideWithModel
    };
  }

  async function runModelRouting(input = {}) {
    const policyDecision = evaluateAgentPolicy({
      ...input.input,
      policyKind: "model-routing",
      routeId: input.input?.routeId || input.input?.moduleId || "agent_gateway.default"
    });
    const runner = typeof input.baseRunModelRouting === "function"
      ? input.baseRunModelRouting
      : (await loadModelRoutingCore()).runModelRouting;
    const routed = await runner(input);
    return {
      ...routed,
      routing: {
        ...(routed.routing || {}),
        strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
        strategyPolicyDecision: policyDecision
      }
    };
  }

  async function inspectRouting(input = {}) {
    const { inspectModelRouting } = await loadModelRoutingCore();
    return inspectModelRouting({
      userDataPath: input.userDataPath || userDataPath,
      limit: Number(input.limit || 50)
    });
  }

  function evaluateToolPolicy(input = {}) {
    const normalized = toolPolicyInput({
      ...input,
      toolManagementPlatform: input.toolManagementPlatform || getToolManagementPlatform()
    });
    const baseDecision = typeof input.baseEvaluate === "function"
      ? input.baseEvaluate(normalized)
      : localToolPolicyDecision(normalized);
    return {
      ...baseDecision,
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: baseDecision.policyType || "tool-policy",
      evaluatedLayers: uniqueStrings([...(baseDecision.evaluatedLayers || []), "strategy_management"])
    };
  }

  return Object.freeze({
    protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
    describe,
    evaluateWorkflowPolicy,
    evaluateAgentPolicy,
    evaluateRoutePolicy,
    decideWithModel,
    createModelDecisionRuntimePort,
    shouldUseModelRouting,
    runModelRouting,
    inspectModelRouting: inspectRouting,
    evaluateToolPolicy
  });
}
