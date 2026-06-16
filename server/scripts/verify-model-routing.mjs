#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  callAgentGateway,
  inspectAgentModelRouting
} from "../platform/specialized/agent/agent-gateway/index.mjs";
import {
  MODEL_ROUTING_PROTOCOL_VERSION,
  normalizeModelRoutingPolicy
} from "../platform/specialized/agent/agent-gateway/model-routing/index.mjs";

function startRoutingMockServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({
      url: request.url,
      headers: request.headers,
      body
    });
    if (String(request.url || "").includes("/primary")) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "primary unavailable" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      answer: "fallback-ok",
      finish: true,
      payload: {
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16
        }
      }
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

function startOversizedGatewayMockServer() {
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request body before sending the oversized response.
    }
    const body = "x".repeat((4 * 1024 * 1024) + 1);
    response.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": String(Buffer.byteLength(body))
    });
    response.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function routingSettings(mock) {
  return {
    customHttpAdapter: {
      alias: "primary-agent",
      label: "Primary Agent",
      url: `${mock.baseUrl}/primary`,
      token: "primary-token",
      tokenHeader: "token",
      agentName: "primary",
      engine: "primary-engine",
      timeoutMs: 5000
    },
    customHttpAdapters: [
      {
        alias: "fallback-agent",
        label: "Fallback Agent",
        url: `${mock.baseUrl}/fallback`,
        token: "fallback-token",
        tokenHeader: "token",
        agentName: "fallback",
        engine: "fallback-engine",
        timeoutMs: 5000
      }
    ]
  };
}

function routingPolicy() {
  return {
    enabled: true,
    routeId: "verify.model-routing",
    promptVersion: "prompt-v1",
    fallbackChain: ["primary-agent", "fallback-agent"],
    budget: {
      maxInputTokens: 2000,
      maxOutputTokens: 128,
      maxEstimatedTotalTokens: 2400,
      maxEstimatedUsd: 1
    },
    circuitBreaker: {
      failureThreshold: 1,
      openMs: 600000
    },
    priceTable: {
      "primary-agent": { inputUsdPer1MTokens: 1, outputUsdPer1MTokens: 2 },
      "fallback-agent": { inputUsdPer1MTokens: 1, outputUsdPer1MTokens: 2 }
    }
  };
}

function verifyPolicyNormalization() {
  const policy = normalizeModelRoutingPolicy({
    input: {
      alias: "primary-agent",
      userId: "user-a",
      workspaceId: "workspace-a",
      modelRouting: routingPolicy()
    },
    defaultAlias: "fallback-agent"
  });
  assert.equal(policy.protocolVersion, MODEL_ROUTING_PROTOCOL_VERSION);
  assert.equal(policy.enabled, true);
  assert.equal(policy.routeId, "verify.model-routing");
  assert.equal(policy.promptVersion, "prompt-v1");
  assert.deepEqual(policy.fallbackChain, ["primary-agent", "fallback-agent"]);
  assert.equal(policy.budget.maxOutputTokens, 128);
}

async function verifyGatewayRouting() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-model-routing-"));
  const mock = await startRoutingMockServer();
  try {
    const settings = routingSettings(mock);
    const result = await callAgentGateway({
      settings,
      userDataPath: tempRoot,
      input: {
        alias: "primary-agent",
        question: "route this request",
        userId: "user-a",
        workspaceId: "workspace-a",
        modelRouting: routingPolicy(),
        parameters: {
          max_tokens: 64
        }
      },
      contextCompactionSource: "agent_gateway.call"
    });

    assert.equal(result.ok, true);
    assert.equal(result.answer, "fallback-ok");
    assert.equal(result.modelRouting.protocolVersion, MODEL_ROUTING_PROTOCOL_VERSION);
    assert.equal(result.modelRouting.selectedAlias, "fallback-agent");
    assert.equal(result.modelRouting.promptVersion, "prompt-v1");
    assert.equal(result.modelRouting.fallbackUsed, true);
    assert.equal(result.modelRouting.attempts[0].status, "failed");
    assert.equal(result.modelRouting.attempts[1].status, "success");
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].headers.token, "primary-token");
    assert.equal(mock.requests[1].headers.token, "fallback-token");

    const second = await callAgentGateway({
      settings,
      userDataPath: tempRoot,
      input: {
        alias: "primary-agent",
        question: "route again",
        modelRouting: routingPolicy()
      },
      contextCompactionSource: "agent_gateway.call"
    });
    assert.equal(second.modelRouting.selectedAlias, "fallback-agent");
    assert.equal(second.modelRouting.attempts[0].status, "skipped");
    assert.equal(second.modelRouting.attempts[0].reason, "circuit_open");
    assert.equal(mock.requests.filter((item) => item.url === "/primary").length, 1);

    await assert.rejects(
      () => callAgentGateway({
        settings,
        userDataPath: tempRoot,
        input: {
          alias: "primary-agent",
          question: "this call is too expensive for the policy",
          modelRouting: {
            ...routingPolicy(),
            circuitBreaker: { failureThreshold: 99, openMs: 600000 },
            budget: { maxInputTokens: 1 }
          }
        },
        contextCompactionSource: "agent_gateway.call"
      }),
      /Model routing found no available candidate/
    );

    const inspection = await inspectAgentModelRouting({ userDataPath: tempRoot, limit: 20 });
    assert.equal(inspection.protocolVersion, MODEL_ROUTING_PROTOCOL_VERSION);
    assert.ok(inspection.ledgerSummary.total >= 4);
    assert.equal(inspection.state.circuits["primary-agent"].state, "open");
    assert.ok(inspection.ledgerSummary.byStatus.failed >= 1);
    assert.ok(inspection.ledgerSummary.byStatus.success >= 2);
    assert.ok(inspection.ledgerSummary.estimatedUsdTotal > 0);
  } finally {
    await mock.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyGatewayResponseLimit() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-model-routing-response-limit-"));
  const mock = await startOversizedGatewayMockServer();
  try {
    await assert.rejects(
      () => callAgentGateway({
        settings: {
          customHttpAdapter: {
            alias: "oversized-agent",
            label: "Oversized Agent",
            url: `${mock.baseUrl}/oversized`,
            token: "oversized-token",
            tokenHeader: "token",
            agentName: "oversized",
            engine: "oversized-engine",
            timeoutMs: 5000
          }
        },
        userDataPath: tempRoot,
        input: {
          alias: "oversized-agent",
          question: "return too much data"
        },
        contextCompactionSource: "agent_gateway.call"
      }),
      /Agent gateway upstream response exceeded the 4194304 byte response limit/,
      "agent gateway upstream responses must be size-limited"
    );
  } finally {
    await mock.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function verifyOperationRegistry() {
  const operation = SERVER_API_OPERATIONS.find((item) => item.id === "model_routing.health");
  assert.ok(operation, "model_routing.health operation must be registered");
  assert.equal(operation.http.method, "GET");
  assert.equal(operation.http.path, "/api/model-routing/health");
  assert.equal(operation.target.method, "handleModelRoutingHealth");
  assert.ok(operation.requiredScopes.includes("console:read"));
}

async function main() {
  verifyPolicyNormalization();
  await verifyGatewayRouting();
  await verifyGatewayResponseLimit();
  verifyOperationRegistry();
  console.log("[model-routing] ok");
}

await main();
