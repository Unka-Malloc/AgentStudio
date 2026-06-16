#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  decorateOperationsWithFeatures,
  resolveFeatureRuntime
} from "../platform/interactive/features/feature-manifest.mjs";
import {
  STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
  createStrategyManagementProvider
} from "../platform/specialized/capabilities/strategy-management/strategy-management-provider.mjs";
import { createToolPolicyEngine } from "../platform/specialized/capabilities/tools/tool-management-core/policy.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

function appendFeatureEnv(...featureIds) {
  const existing = String(process.env.PACT_FEATURES || "");
  const values = new Set(existing.split(",").map((item) => item.trim()).filter(Boolean));
  for (const featureId of featureIds) {
    values.add(featureId);
  }
  return [...values].join(",");
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const rawText = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function startRoutingMockServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    requests.push({
      url: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      answer: "strategy-routing-ok",
      payload: { usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }
    }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function fixtureToolPlatform(decisions) {
  const tool = {
    id: "pact.runtime.info",
    requiredScopes: ["console:read"],
    toolsets: ["pact.runtime.read"],
    safety: { risk: "read_only" }
  };
  return {
    registry: {
      getTool: (toolId) => (toolId === tool.id ? tool : null),
      listProfiles: () => [{ id: "default", toolsets: ["pact.runtime.read"] }]
    },
    store: {
      getRawGrant: (grantId) => ({ id: grantId, scopes: ["console:read"], toolsets: ["pact.runtime.read"] }),
      appendPolicyDecision: (decision) => decisions.push(decision)
    },
    securityPermissions: {
      evaluatePolicy: () => ({
        effect: "allow",
        allowed: true,
        reasonCode: "verify_allowed",
        missingScopes: [],
        missingToolsets: [],
        evaluatedLayers: ["security_permissions"],
        createdAt: "2026-05-25T00:00:00.000Z"
      })
    }
  };
}

async function verifyProviderBoundary() {
  const policyDecisions = [];
  const platform = fixtureToolPlatform(policyDecisions);
  const provider = createStrategyManagementProvider({
    userDataPath: "",
    modelDecisionRuntime: {
      protocolVersion: "pact.model-decision.verify",
      describe: () => ({ protocolVersion: "pact.model-decision.verify", roles: [{ roleId: "writer" }] }),
      decide: async (input) => ({ protocolVersion: "pact.model-decision.verify", usedModel: false, roleId: input.roleId })
    },
    getToolManagementPlatform: () => platform
  });

  assert.equal(provider.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(provider.describe().protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);

  const workflow = provider.evaluateWorkflowPolicy({
    workflowId: "verify.workflow",
    risk: "destructive"
  });
  assert.equal(workflow.effect, "require_confirmation");
  assert.equal(workflow.strategyProtocolVersion, undefined);
  assert.equal(workflow.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);

  const agent = provider.evaluateAgentPolicy({ roleId: "writer" });
  assert.equal(agent.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(agent.effect, "allow");

  const routePolicy = provider.evaluateRoutePolicy({
    routeId: "downstream.acp.codex",
    fromAspect: "downstream-client-aspect",
    protocol: "acp",
    internalCapabilityId: "acp-agent-relay"
  });
  assert.equal(routePolicy.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(routePolicy.policyType, "route-policy");
  assert.equal(routePolicy.effect, "allow");
  assert.equal(routePolicy.fromAspect, "downstream-client-aspect");
  assert.equal(routePolicy.internalCapabilityId, "acp-agent-relay");

  const queuePolicy = provider.evaluateQueuePolicy({
    queueDefinitionId: "verify.queue",
    queueLabel: "verify.jobs",
    operationId: "jobs.create"
  });
  assert.equal(queuePolicy.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(queuePolicy.policyType, "queue-policy");
  assert.equal(queuePolicy.effect, "allow");
  assert.equal(queuePolicy.queueDefinitionId, "verify.queue");

  const deniedRoutePolicy = provider.evaluateRoutePolicy({
    routeId: "upstream.external.missing",
    fromAspect: "upstream-service-aspect",
    routeKind: "external-service"
  });
  assert.equal(deniedRoutePolicy.effect, "deny");
  assert.equal(deniedRoutePolicy.reasonCode, "route_target_missing");

  const modelDecision = await provider.createModelDecisionRuntimePort().decide({ roleId: "writer" });
  assert.equal(modelDecision.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(modelDecision.strategyPolicyDecision.policyType, "agent-policy");

  const toolDecision = provider.evaluateToolPolicy({
    toolId: "pact.runtime.info",
    grantId: "verify-grant",
    input: {}
  });
  assert.equal(toolDecision.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  assert.equal(toolDecision.effect, "allow");
  assert.ok(toolDecision.evaluatedLayers.includes("strategy_management"));
  assert.ok(policyDecisions.some((decision) => decision.decisionId === toolDecision.decisionId));

  const policyEngine = createToolPolicyEngine({
    registry: platform.registry,
    store: platform.store,
    securityPermissions: platform.securityPermissions,
    strategyManagementProvider: provider
  });
  const preview = policyEngine.preview({ toolId: "pact.runtime.info", grantId: "verify-grant" });
  assert.equal(preview.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
}

async function verifyGatewayRoutingBoundary() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-strategy-routing-"));
  const mock = await startRoutingMockServer();
  try {
    const { callAgentGateway } = await import("../platform/specialized/agent/agent-gateway/index.mjs");
    const strategyProvider = createStrategyManagementProvider({ userDataPath: tempRoot });
    const response = await callAgentGateway({
      userDataPath: tempRoot,
      strategyProvider,
      settings: {
        customHttpAdapter: {
          alias: "verify-agent",
          label: "Verify Agent",
          url: `${mock.baseUrl}/agent`,
          token: "verify-token",
          tokenHeader: "token",
          agentName: "verify-agent",
          engine: "verify-engine",
          timeoutMs: 5000
        }
      },
      input: {
        alias: "verify-agent",
        question: "route through strategy provider",
        modelRouting: {
          enabled: true,
          routeId: "verify.strategy-routing",
          fallbackChain: ["verify-agent"],
          budget: { maxInputTokens: 2000, maxOutputTokens: 64 }
        }
      },
      contextCompactionSource: "agent_gateway.call"
    });
    assert.equal(response.ok, true);
    assert.equal(response.modelRouting.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.equal(response.modelRouting.strategyPolicyDecision.policyType, "agent-policy");
    assert.equal(mock.requests.length, 1);
  } finally {
    await mock.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyHttpOperations() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-strategy-management-"));
  const previousFeatures = process.env.PACT_FEATURES;
  process.env.PACT_FEATURES = appendFeatureEnv("knowledge-distillation");
  const server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    await installAuthenticatedFetch(server);
    const describe = await fetchJson(`${server.url}/api/strategy`);
    assert.equal(describe.status, 200);
    assert.equal(describe.payload.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.ok(describe.payload.capabilities.includes("workflow-policy.evaluate"));

    const workflow = await fetchJson(`${server.url}/api/strategy/workflow-policy/evaluate`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ workflowId: "verify.http.workflow", risk: "repair_write" })
    });
    assert.equal(workflow.status, 200);
    assert.equal(workflow.payload.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.equal(workflow.payload.effect, "require_confirmation");

    const agent = await fetchJson(`${server.url}/api/strategy/agent-policy/evaluate`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ roleId: "verify-agent" })
    });
    assert.equal(agent.status, 200);
    assert.equal(agent.payload.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.equal(agent.payload.policyType, "agent-policy");

    const route = await fetchJson(`${server.url}/api/strategy/route-policy/evaluate`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        routeId: "verify.downstream.mcp",
        fromAspect: "downstream-client-aspect",
        protocol: "mcp",
        internalCapabilityId: "mcp-server-side"
      })
    });
    assert.equal(route.status, 200);
    assert.equal(route.payload.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.equal(route.payload.policyType, "route-policy");
    assert.equal(route.payload.effect, "allow");
    assert.equal(route.payload.internalCapabilityId, "mcp-server-side");

    const queue = await fetchJson(`${server.url}/api/strategy/queue-policy/evaluate`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        queueDefinitionId: "verify.queue",
        queueLabel: "verify.jobs",
        operationId: "jobs.create"
      })
    });
    assert.equal(queue.status, 200);
    assert.equal(queue.payload.protocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.equal(queue.payload.policyType, "queue-policy");
    assert.equal(queue.payload.effect, "allow");

    const strategyTool = await fetchJson(`${server.url}/api/strategy/tool-policy/preview`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ toolId: "pact.runtime.info" })
    });
    assert.equal(strategyTool.status, 200);
    assert.equal(strategyTool.payload.decision.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
    assert.ok(strategyTool.payload.decision.evaluatedLayers.includes("strategy_management"));

    const toolManagementPolicy = await fetchJson(`${server.url}/api/tool-management/v1/policy/preview`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ toolId: "pact.runtime.info" })
    });
    assert.equal(toolManagementPolicy.status, 200);
    assert.equal(toolManagementPolicy.payload.decision.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);

    const roles = await fetchJson(`${server.url}/api/knowledge/model-roles`);
    assert.equal(roles.status, 200);
    assert.equal(roles.payload.strategyProtocolVersion, STRATEGY_MANAGEMENT_PROTOCOL_VERSION);
  } finally {
    await server.close();
    if (previousFeatures === undefined) {
      delete process.env.PACT_FEATURES;
    } else {
      process.env.PACT_FEATURES = previousFeatures;
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function verifyOperationRegistry() {
  const expectedOperations = [
    "strategy.describe",
    "strategy.workflow_policy.evaluate",
    "strategy.agent_policy.evaluate",
    "strategy.route_policy.evaluate",
    "strategy.queue_policy.evaluate",
    "strategy.tool_policy.preview"
  ];
  const byId = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  for (const operationId of expectedOperations) {
    const operation = byId.get(operationId);
    assert.ok(operation, `${operationId} must be registered`);
    assert.equal(operation.feature, "strategy_management");
    assert.equal(operation.target.method, "handleStrategyManagement");
    assert.ok(operation.requiredScopes.includes("console:read"));
  }
  const decorated = decorateOperationsWithFeatures(SERVER_API_OPERATIONS);
  for (const operationId of expectedOperations) {
    assert.equal(
      decorated.find((operation) => operation.id === operationId)?.featureId,
      "strategy-management"
    );
  }
  const featureRuntime = resolveFeatureRuntime({ edition: "enterprise" });
  assert.ok(featureRuntime.activeFeatureIds.includes("strategy-management"));
}

await verifyProviderBoundary();
await verifyGatewayRoutingBoundary();
await verifyHttpOperations();
verifyOperationRegistry();

console.log("[strategy-management] ok");
