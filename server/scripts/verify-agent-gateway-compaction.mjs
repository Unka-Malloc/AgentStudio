import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveSettings } from "../platform/common/platform-core/settings.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { callAgentGateway } from "../platform/specialized/agent/agent-gateway/index.mjs";
import { createContextRuntime } from "../platform/specialized/agent/agent-context/interface/index.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function startMockGateway() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push(body);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ answer: "gateway ok" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/agent`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function messages() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `gateway-${index}`,
    role: index % 2 ? "assistant" : "user",
    apiRoundId: `gateway-round-${Math.floor(index / 2)}`,
    content: `Round ${index}: preserve evidence:gateway-${index}, risk gateway-risk, TODO gateway todo, 2026-05-02. `.repeat(120)
  }));
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-gateway-compaction-"));
try {
  const gatewayCalls = [];
  const runtime = createContextRuntime({
    userDataPath,
    agentGatewayCall: async (input = {}) => {
      gatewayCalls.push(input);
      return {
        answer: JSON.stringify({
          summary: "Gateway compacted summary keeps evidence:gateway-1, gateway-risk, and TODO gateway todo.",
          constraints: ["preserve tool ids"],
          decisions: ["use agent-gateway model assisted compaction"],
          risks: ["gateway-risk"],
          todos: ["gateway todo"],
          evidenceRefs: ["evidence:gateway-1"],
          fileRefs: ["server/platform/specialized/agent/agent-context/interface/index.mjs"],
          knowledgeRefs: []
        })
      };
    }
  });
  await runtime.saveProfiles({
    profiles: [
      {
        profileId: "gateway-compaction",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        compression: {
          mode: "model-assisted",
          summaryMaxTokens: 600
        },
        modelCompression: {
          enabled: true,
          alias: "gateway-mock",
          maxOutputTokens: 400
        },
        compactionPolicy: {
          strategy: "model-assisted",
          summaryReserveTokens: 512,
          reservedBufferTokens: 512,
          recentMessageProtectionCount: 2,
          modelMaxInputTokens: 50000
        }
      }
    ]
  });
  const result = await runtime.runCompaction({
    contextProfileId: "gateway-compaction",
    sessionId: "gateway-session",
    messages: messages(),
    taskBrief: "verify gateway assisted compaction",
    useSessionMemory: false
  });
  assert.equal(result.strategy.id, "model-assisted");
  assert.match(result.summary, /gateway-1/);
  assert.equal(gatewayCalls.length, 1);
  assert.match(gatewayCalls[0].question, /Return strict JSON/);
  assert.equal(gatewayCalls[0].alias, "gateway-mock");

  const fallbackRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "fallback"),
    agentGatewayCall: async () => ({ answer: "{}" })
  });
  await fallbackRuntime.saveProfiles({
    profiles: [
      {
        profileId: "gateway-fallback",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        compression: { mode: "model-assisted", summaryMaxTokens: 600 },
        modelCompression: { enabled: true, alias: "gateway-mock" },
        compactionPolicy: {
          strategy: "model-assisted",
          summaryReserveTokens: 512,
          reservedBufferTokens: 512,
          recentMessageProtectionCount: 2
        }
      }
    ]
  });
  const fallback = await fallbackRuntime.runCompaction({
    contextProfileId: "gateway-fallback",
    sessionId: "gateway-fallback-session",
    messages: messages(),
    taskBrief: "verify gateway fallback",
    useSessionMemory: false
  });
  assert.equal(fallback.strategy.id, "model-assisted");
  assert.equal(fallback.executionMode, "deterministic-extractive");
  assert.equal(fallback.degraded, true);
  assert.ok(fallback.degradedReasons.length > 0);

  const capturedPayloads = [];
  const gatewayContextRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "gateway-direct")
  });
  const gatewayResult = await callAgentGateway({
    settings: {
      customHttpAdapter: {
        provider: "custom-http",
        alias: "direct-gateway",
        url: "http://127.0.0.1/agent",
        token: "",
        agentName: "direct",
        timeoutMs: 30000
      },
      modelLibraryEntries: ["custom-http"]
    },
    input: {
      question: "当前问题：请总结维护状态。",
      sessionId: "direct-gateway-session",
      contextCompaction: { force: true },
      messages: [
        {
          id: "direct-1",
          role: "user",
          apiRoundId: "direct-round-0",
          content: "必须保留 direct-evidence 和 direct-risk。".repeat(300)
        },
        {
          id: "direct-2",
          role: "assistant",
          apiRoundId: "direct-round-0",
          content: "Decision: compact before direct AgentGateway transport."
        },
        {
          id: "direct-3",
          role: "user",
          apiRoundId: "direct-round-1",
          content: "当前问题：请总结维护状态。"
        }
      ]
    },
    contextRuntime: gatewayContextRuntime,
    contextCompactionSource: "agent_gateway.call",
    userDataPath: path.join(userDataPath, "gateway-direct"),
    fetchImpl: async (_url, options = {}) => {
      capturedPayloads.push(JSON.parse(String(options.body || "{}")));
      return new Response(
        JSON.stringify({
          ok: true,
          answer: "direct gateway ok"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  });
  assert.equal(gatewayResult.contextCompaction.compacted, true);
  assert.equal(capturedPayloads.length, 1);
  assert.match(capturedPayloads[0].question, /Pact compacted prior context/);
  assert.match(capturedPayloads[0].question, /direct-evidence|direct-risk/);

  const mockGateway = await startMockGateway();
  const serverDataPath = path.join(userDataPath, "gateway-http-server");
  await saveSettings(serverDataPath, {
    defaultModelProvider: "custom-http",
    modelLibraryEntries: ["custom-http"],
    customHttpAdapter: {
      provider: "custom-http",
      alias: "http-gateway",
      url: mockGateway.url,
      token: "",
      agentName: "http-gateway",
      timeoutMs: 30000
    },
    customHttpAdapter: {
      provider: "custom-http",
      alias: "http-gateway",
      url: mockGateway.url,
      token: "",
      agentName: "http-gateway",
      timeoutMs: 30000
    }
  });
  const server = await startHttpServer({
    userDataPath: serverDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    await installAuthenticatedFetch(server);
    const response = await requestJson(`${server.url}/api/agent-gateway/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "HTTP AgentGateway 当前问题。",
        sessionId: "http-gateway-session",
        contextCompaction: { force: true },
        messages: [
          {
            id: "http-gateway-1",
            role: "user",
            apiRoundId: "http-gateway-round-0",
            content: "必须保留 http-gateway-evidence 和 http-gateway-risk。".repeat(260)
          },
          {
            id: "http-gateway-2",
            role: "user",
            apiRoundId: "http-gateway-round-1",
            content: "HTTP AgentGateway 当前问题。"
          }
        ]
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.contextCompaction.compacted, true);
    assert.ok(mockGateway.requests.length >= 1);
    assert.match(String(mockGateway.requests.at(-1).question || ""), /Pact compacted prior context/);
    assert.match(String(mockGateway.requests.at(-1).question || ""), /http-gateway-evidence|http-gateway-risk/);
  } finally {
    await server.close();
    await mockGateway.close();
  }
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("Agent gateway compaction verification passed.");
