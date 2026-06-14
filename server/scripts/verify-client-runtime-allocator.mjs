import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createClientRuntimeAllocator } from "../services/client/client-runtime-core/client-runtime-allocator.mjs";
import { createContextRuntime } from "../platform/specialized/agent/agent-context/interface/index.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

function createRuntimeConfig(clientUid = "client-a") {
  return {
    defaultProfile: {
      profileId: "default",
      contextProfileId: "balanced",
      retrievalProfileId: "balanced",
      workspaceStrategy: "client",
      workspacePrefix: "client-workspace"
    },
    coolingPolicy: {
      enabled: true,
      strategy: "lru-lfu-v1",
      minHotCalls: 3,
      maxWarmClients: 1,
      coldAfterMs: 60000,
      coldContextProfileId: "small-context",
      coldWorkspaceStrategy: "shared"
    },
    profiles: [
      {
        profileId: `${clientUid}-runtime`,
        label: `${clientUid} runtime`,
        clientUid,
        taskTypes: [
          "agent_gateway.call",
          "context.assemble",
          "knowledge.search",
          "knowledge.summarization",
          "knowledge.agent_exploration"
        ],
        priority: 10,
        modelAlias: "client-model",
        contextProfileId: `${clientUid}-context`,
        retrievalProfileId: `${clientUid}-retrieval`,
        retrievalProfileKey: `${clientUid}-retrieval-key`,
        workspaceStrategy: "client-task",
        workspacePrefix: "tenant-workspace",
        toolGrantId: `${clientUid}-grant`
      }
    ]
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

async function createMockGateway() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const payload = body ? JSON.parse(body) : {};
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        payload
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        answer: `mock-answer:${payload.model || ""}`,
        model: payload.model || "",
        receivedQuestion: payload.question || ""
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/agent`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

const roots = [];
const mockGateway = await createMockGateway();
let httpServer = null;

try {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-client-runtime-"));
  roots.push(userDataPath);
  const allocator = createClientRuntimeAllocator({ userDataPath });
  await allocator.saveProfiles(createRuntimeConfig("client-a"));

  const allocation = await allocator.resolve({
    clientUid: "client-a",
    taskType: "knowledge.search"
  });
  assert.equal(allocation.profileId, "client-a-runtime");
  assert.equal(allocation.modelAlias, "client-model");
  assert.equal(allocation.contextProfileId, "client-a-context");
  assert.equal(allocation.retrievalProfileId, "client-a-retrieval");
  assert.match(allocation.workspaceId, /^tenant-workspace-client-a-knowledge\.search-/);

  const applied = await allocator.apply({
    clientUid: "client-a",
    query: "三月巡检记录"
  }, {
    taskType: "knowledge.search",
    surface: "verify"
  });
  assert.equal(applied.input.modelAlias, "client-model");
  assert.equal(applied.input.alias, "client-model");
  assert.equal(applied.input.contextProfileId, "client-a-context");
  assert.equal(applied.input.retrievalProfileId, "client-a-retrieval");
  assert.equal(applied.input.profileKey, "client-a-retrieval-key");
  assert.equal(applied.input.sessionId, applied.input.workspaceId);
  assert.equal(applied.input.clientRuntimeAllocation.profileId, "client-a-runtime");

  const initialStatus = await allocator.getStatus();
  const clientAHeatRow = initialStatus.heatmap.clients.find((row) => row.clientUid === "client-a");
  assert.ok(clientAHeatRow, "expected client-a to be recorded in runtime heatmap");
  assert.equal(clientAHeatRow.workspaceId, applied.input.workspaceId);
  assert.equal(clientAHeatRow.contextProfileId, "client-a-context");
  assert.equal(clientAHeatRow.recentCalls, 1);
  assert.equal(initialStatus.summary.totalClients, 1);
  assert.equal(initialStatus.summary.totalCalls, 1);

  const explicit = await allocator.apply({
    clientUid: "client-a",
    modelAlias: "explicit-model",
    contextProfileId: "explicit-context",
    retrievalProfileId: "explicit-retrieval",
    workspaceId: "explicit-workspace"
  }, {
    taskType: "knowledge.search",
    surface: "verify"
  });
  assert.equal(explicit.input.modelAlias, "explicit-model");
  assert.equal(explicit.input.contextProfileId, "explicit-context");
  assert.equal(explicit.input.retrievalProfileId, "explicit-retrieval");
  assert.equal(explicit.input.workspaceId, "explicit-workspace");
  assert.equal(explicit.allocation.overrides.modelAlias, true);
  assert.equal(explicit.allocation.overrides.workspaceId, true);

  const contextRuntime = createContextRuntime({
    userDataPath,
    clientRuntimeAllocator: allocator
  });
  await contextRuntime.saveProfiles({
    profiles: [
      {
        profileId: "client-a-context",
        label: "Client A Context",
        contextWindowTokens: 16000,
        outputReserveTokens: 1000,
        toolReserveTokens: 1000,
        fixedMemoryBudget: 200,
        knowledgeBudget: 1200,
        historyBudget: 1200,
        recentTurnBudget: 800
      }
    ]
  });
  const preview = await contextRuntime.preview({
    clientUid: "client-a",
    taskBrief: "回答三月巡检记录",
    retrievedEvidence: [
      {
        evidenceId: "ev-client-runtime",
        title: "三月巡检记录",
        snippet: "三月巡检记录包含 12 个检查项。"
      }
    ],
    record: false
  });
  assert.equal(preview.contextPack.profileId, "client-a-context");
  assert.equal(preview.contextPack.clientRuntimeAllocation.profileId, "client-a-runtime");

  const { callAgentGateway } = await import("../platform/specialized/agent/agent-gateway/index.mjs");
  const gatewayResult = await callAgentGateway({
    settings: {
      customHttpAdapters: [
        {
          alias: "client-model",
          provider: "custom-http",
          model: "mock-model",
          url: mockGateway.url,
          token: "mock-token"
        }
      ]
    },
    input: {
      clientUid: "client-a",
      question: "hello"
    },
    userDataPath,
    clientRuntimeAllocator: allocator
  });
  assert.equal(gatewayResult.clientRuntimeAllocation.profileId, "client-a-runtime");
  assert.equal(gatewayResult.request.engine, "mock-model");
  assert.equal(mockGateway.requests.at(-1).payload.question, "hello");

  await allocator.apply({
    clientUid: "low-frequency-client",
    query: "cold"
  }, {
    taskType: "knowledge.search",
    surface: "verify"
  });
  for (let index = 0; index < 4; index += 1) {
    await allocator.apply({
      clientUid: "client-a",
      query: `hot-${index}`
    }, {
      taskType: "knowledge.search",
      surface: "verify"
    });
  }
  const cooled = await allocator.apply({
    clientUid: "low-frequency-client",
    query: "cold-again"
  }, {
    taskType: "knowledge.search",
    surface: "verify"
  });
  assert.equal(cooled.allocation.cooling.state, "cooled");
  assert.equal(cooled.input.contextProfileId, "small-context");
  assert.equal(cooled.input.workspaceId, "client-workspace-shared");
  const cooledStatus = await allocator.getStatus();
  assert.ok(cooledStatus.cooledClients.some((row) => row.clientUid === "low-frequency-client"));

  const httpUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-client-runtime-http-"));
  roots.push(httpUserDataPath);
  httpServer = await startHttpServer({
    userDataPath: httpUserDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  await installAuthenticatedFetch(httpServer);

  const saveProfiles = await fetchJson(`${httpServer.url}/api/client-runtime/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createRuntimeConfig("web-client"))
  });
  assert.equal(saveProfiles.status, 200);
  assert.equal(saveProfiles.payload.profiles[0].profileId, "web-client-runtime");

  const resolveHttp = await fetchJson(`${httpServer.url}/api/client-runtime/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientUid: "web-client",
      taskType: "context.assemble"
    })
  });
  assert.equal(resolveHttp.status, 200);
  assert.equal(resolveHttp.payload.contextProfileId, "web-client-context");

  const saveContextProfiles = await fetchJson(`${httpServer.url}/api/context/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles: [
        {
          profileId: "web-client-context",
          label: "Web Client Context",
          contextWindowTokens: 16000,
          outputReserveTokens: 1000,
          toolReserveTokens: 1000
        }
      ]
    })
  });
  assert.equal(saveContextProfiles.status, 200);

  const previewHttp = await fetchJson(`${httpServer.url}/api/context/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientUid: "web-client",
      taskBrief: "客户端上下文热切换",
      record: false
    })
  });
  assert.equal(previewHttp.status, 200);
  assert.equal(previewHttp.payload.contextPack.profileId, "web-client-context");
  assert.equal(previewHttp.payload.contextPack.clientRuntimeAllocation.profileId, "web-client-runtime");

  const statusHttp = await fetchJson(`${httpServer.url}/api/client-runtime/status`);
  assert.equal(statusHttp.status, 200);
  assert.equal(statusHttp.payload.summary.totalClients, 1);
  assert.ok(statusHttp.payload.heatmap.clients.some((row) => row.clientUid === "web-client"));

  const consoleStateHttp = await fetchJson(`${httpServer.url}/api/console/state`);
  assert.equal(consoleStateHttp.status, 200);
  assert.equal(consoleStateHttp.payload.clientRuntime.summary.totalClients, 1);
  assert.ok(
    consoleStateHttp.payload.clientRuntime.heatmap.clients.some((row) => row.clientUid === "web-client")
  );

  console.log("ClientRuntimeAllocator verification passed.");
} finally {
  if (httpServer) {
    await httpServer.close();
  }
  await mockGateway.close();
  if (!process.env.PACT_KEEP_TEST_DATA) {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  }
}
