import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import {
  getAgentToolExecutionSettingsPath,
  getModelProviderSettingsPath,
  getSettingsPath,
  loadSettings,
  normalizeSettings,
  resolveModelForModule
} from "../platform/common/platform-core/settings.mjs";
import {
  callAgentGateway,
  parseAgentGatewayStreamText,
  parseDeepSeekStreamText
} from "../platform/specialized/agent/agent-gateway/index.mjs";
import { probeModelConnection } from "../platform/specialized/agent/agent-gateway/model-probe/index.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${rawText}`);
  }
  return payload;
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runPactCli(serverUrl, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("./pact.mjs", import.meta.url).pathname,
        ...args,
        "--server-url",
        serverUrl
      ],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `pact CLI exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(new Error(`pact CLI JSON parse failed: ${error.message}\n${stdout}\n${stderr}`));
      }
    });
  });
}

function startMockAgentServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body
    });
    if (String(request.url || "").endsWith("/chat/completions")) {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(
        JSON.stringify({
          id: "deepseek-chatcmpl-001",
          model: body.model || "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                reasoning_content: "Checking the probe response.",
                content: [{ type: "text", text: "DeepSeek hello" }]
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 2,
            total_tokens: 10
          }
        })
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store"
    });
    for (const content of ["$", " echo", " \"", "Hello", " \"", " $"]) {
      response.write(
        `data:${JSON.stringify({
          type: "answer",
          data: {
            content,
            nodeId: "node_end",
            riskDescription: null
          },
          finish: false
        })}\n\n`
      );
    }
    response.write(
      `data:${JSON.stringify({
        type: "dialogId",
        data: { content: "dialog-001", nodeId: null, riskDescription: null },
        finish: false
      })}\n\n`
    );
    response.write(
      `data:${JSON.stringify({
        type: "finish",
        data: { content: "", nodeId: null, riskDescription: null },
        finish: true
      })}\n\n`
    );
    response.end();
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

const sample = [
  'data:{"type":"answer","data":{"content":"Hello","nodeId":"node_end","riskDescription":null},"finish":false}',
  'data:{"type":"answer","data":{"content":" world","nodeId":"node_end","riskDescription":null},"finish":false}',
  'data:{"type":"finish","data":{"content":"","nodeId":null,"riskDescription":null},"finish":true}'
].join("\n\n");
const parsed = parseAgentGatewayStreamText(sample);
assert.equal(parsed.answer, "Hello world");
assert.equal(parsed.finish, true);

const toolStream = [
  {
    id: "chatcmpl-tool-stream",
    model: "deepseek-v4-pro",
    choices: [
      {
        delta: {
          reasoning_content: "Need a local lookup.",
          tool_calls: [
            {
              index: 0,
              id: "call_stream_1",
              type: "function",
              function: {
                name: "keyword_search",
                arguments: "{\"query\""
              }
            }
          ]
        }
      }
    ]
  },
  {
    id: "chatcmpl-tool-stream",
    model: "deepseek-v4-pro",
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                arguments: ":\"账单\",\"limit\":2}"
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ]
  }
]
  .map((payload) => `data:${JSON.stringify(payload)}`)
  .concat("data:[DONE]")
  .join("\n\n");
const parsedToolStream = parseDeepSeekStreamText(toolStream);
assert.equal(parsedToolStream.chunks.reasoning.join(""), "Need a local lookup.");
assert.equal(parsedToolStream.toolCalls[0].id, "call_stream_1");
assert.equal(parsedToolStream.toolCalls[0].function.name, "keyword_search");
assert.equal(
  parsedToolStream.toolCalls[0].function.arguments,
  "{\"query\":\"账单\",\"limit\":2}"
);

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-gateway-"));
const mockAgent = await startMockAgentServer();
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const config = await fetchJson(`${server.url}/api/agent-gateway/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alias: "custom-http-agent",
      url: mockAgent.url,
      token: "secret-token",
      tokenHeader: "token",
      agentName: "default-agent",
      pluginList: ["knowledge"],
      engine: "default-engine",
      parameters: { fromSettings: true },
      timeoutMs: 30000
    })
  });
  assert.equal(config.config.alias, "custom-http-agent");
  assert.equal(config.config.url, mockAgent.url);
  assert.equal(config.config.token, "");
  assert.equal(config.config.tokenConfigured, true);

  const settings = await fetchJson(`${server.url}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customModelAlias: "kb-http",
      customModelLabel: "Knowledge HTTP Adapter",
      moduleModelAssignments: {
        knowledgeTaxonomy: { provider: "custom-http", model: "" },
        agentTools: { provider: "custom-http", model: "kb-http" }
      },
      customHttpAdapter: {
        alias: "kb-http",
        label: "Knowledge HTTP Adapter",
        url: mockAgent.url,
        token: "secret-token",
        tokenHeader: "token",
        agentName: "default-agent",
        pluginList: ["knowledge"],
        engine: "default-engine",
        parameters: { fromSettings: true },
        timeoutMs: 30000
      },
      customHttpAdapters: [
        {
          alias: "qa-http",
          label: "QA HTTP Adapter",
          url: mockAgent.url,
          token: "second-token",
          tokenHeader: "token",
          agentName: "second-agent",
          pluginList: ["qa"],
          engine: "second-engine",
          parameters: { fromSecondSettings: true },
          timeoutMs: 30000
        }
      ],
      deepSeekApiKey: "deepseek-secret",
      deepSeekBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
      deepSeekModel: "deepseek-v4-flash",
      deepSeekTimeoutMs: 30000,
      modelLibraryAgents: [
        {
          provider: "deepseek",
          label: "Flash Analyst",
          model: "deepseek-v4-flash",
          baseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
          apiKey: "deepseek-secret",
          timeoutMs: 30000
        },
        {
          provider: "custom-http",
          label: "HTTP Analyst",
          model: "http-engine",
          url: mockAgent.url,
          token: "third-token",
          tokenHeader: "token",
          timeoutMs: 30000
        }
      ],
      agentToolExecution: {
        http: {
          enabled: true,
          allowedHosts: ["127.0.0.1", "localhost"],
          timeoutMs: 11000,
          maxResponseBytes: 4096
        },
        functionCallSchema: {
          local_command: {
            commandId: "node-version",
            variables: {
              flag: "--version"
            }
          }
        },
        local: {
          enabled: true,
          allowDirectCommands: false,
          timeoutMs: 12000,
          maxOutputBytes: 8192,
          commands: [
            {
              commandId: "node-version-test",
              label: "Node version test",
              command: "node",
              args: ["--version"],
              cwd: "",
              description: "test command"
            }
          ]
        }
      }
    })
  });
  assert.equal(settings.defaultModelProvider, "");
  assert.equal(settings.defaultModel, "");
  assert.equal(settings.moduleModelAssignments.knowledgeTaxonomy, undefined);
  assert.equal(settings.moduleModelAssignments.agentTools.provider, "custom-http");
  assert.equal(settings.moduleModelAssignments.agentTools.model, "kb-http");
  const unassignedModule = resolveModelForModule(
    normalizeSettings({
      moduleModelAssignments: {}
    }),
    "knowledgeTaxonomy"
  );
  assert.equal(unassignedModule.enabled, false);
  assert.equal(unassignedModule.provider, "");
  assert.equal(unassignedModule.model, "");
  assert.equal(settings.customHttpAdapter.alias, "kb-http");
  assert.equal(settings.customHttpAdapter.token, "");
  assert.equal(settings.customHttpAdapter.tokenConfigured, true);
  assert.equal(settings.customHttpAdapters.length, 2);
  assert.equal(settings.customHttpAdapters[1].alias, "qa-http");
  assert.equal(settings.customHttpAdapters[1].token, "");
  assert.equal(settings.customHttpAdapters[1].tokenConfigured, true);
  assert.equal(settings.deepSeekApiKey, "");
  assert.equal(settings.deepSeekApiKeyConfigured, true);
  assert.equal(settings.deepSeekBaseUrl, `http://127.0.0.1:${new URL(mockAgent.url).port}`);
  assert.equal(settings.deepSeekModel, "deepseek-v4-flash");
  assert.equal(settings.modelLibraryEntries.includes("custom-http"), true);
  assert.equal(settings.modelLibraryEntries.includes("deepseek"), true);
  assert.equal(settings.modelLibraryAgents.length, 2);
  const libraryAliases = settings.modelLibraryAgents.map((model) => model.alias);
  assert.equal(libraryAliases.every((alias) => /^agent_[0-9a-f]{16}$/.test(alias)), true);
  assert.deepEqual(
    settings.modelLibraryAgents.map((model) => model.uid),
    libraryAliases
  );
  assert.deepEqual(
    settings.modelLibraryAgents.map((model) => model.instanceId),
    libraryAliases
  );
  assert.equal(settings.modelLibraryAgents[0].agentName, "Flash Analyst");
  assert.equal(settings.modelLibraryAgents[1].agentName, "HTTP Analyst");
  assert.equal(settings.agentToolExecution.http.timeoutMs, 11000);
  assert.equal(
    settings.agentToolExecution.functionCallSchema.local_command.variables.flag,
    "--version"
  );
  assert.equal(settings.agentToolExecution.local.commands[0].commandId, "node-version-test");
  assert.equal(settings.agentToolExecution.local.commands[0].command, "node");

  const originalNodeCommandEnv = process.env.PACT_AGENT_LOCAL_NODE_COMMAND;
  try {
    delete process.env.PACT_AGENT_LOCAL_NODE_COMMAND;

    const migratedNodeTemplate = normalizeSettings({
      agentToolExecution: {
        local: {
          commands: [
            {
              commandId: "node-version",
              label: "Node.js version",
              command: process.execPath,
              args: ["--version"],
              cwd: "",
              description: "legacy generated template"
            }
          ]
        }
      }
    }).agentToolExecution.local.commands[0];
    assert.equal(migratedNodeTemplate.command, "node");
    assert.deepEqual(migratedNodeTemplate.args, ["{{flag}}"]);
    assert.equal(migratedNodeTemplate.variables[0].name, "flag");
    assert.equal(migratedNodeTemplate.variables[0].defaultValue, "--version");
    assert.equal(migratedNodeTemplate.allowExtraArgs, false);

    const configuredNodeTemplate = normalizeSettings({
      agentToolExecution: {
        local: {
          nodeCommand: "node-from-config",
          commands: [
            {
              commandId: "node-version",
              label: "Node.js version",
              command: process.execPath,
              args: ["--version"],
              cwd: "",
              description: "config controlled template"
            }
          ]
        }
      }
    }).agentToolExecution.local.commands[0];
    assert.equal(configuredNodeTemplate.command, "node-from-config");
    assert.deepEqual(configuredNodeTemplate.args, ["{{flag}}"]);

    process.env.PACT_AGENT_LOCAL_NODE_COMMAND = "node-from-env";
    const envNodeTemplate = normalizeSettings({
      agentToolExecution: {
        local: {
          nodeCommand: "node-from-config",
          commands: [
            {
              commandId: "node-version",
              label: "Node.js version",
              command: process.execPath,
              args: ["--version"],
              cwd: "",
              description: "env controlled template"
            }
          ]
        }
      }
    }).agentToolExecution.local.commands[0];
    assert.equal(envNodeTemplate.command, "node-from-env");
    assert.deepEqual(envNodeTemplate.args, ["{{flag}}"]);
  } finally {
    if (originalNodeCommandEnv === undefined) {
      delete process.env.PACT_AGENT_LOCAL_NODE_COMMAND;
    } else {
      process.env.PACT_AGENT_LOCAL_NODE_COMMAND = originalNodeCommandEnv;
    }
  }

  const rootSettingsPath = getSettingsPath(userDataPath);
  const deepSeekSettingsPath = getModelProviderSettingsPath(userDataPath, "deepseek");
  const customHttpSettingsPath = getModelProviderSettingsPath(userDataPath, "custom-http");
  const agentToolExecutionSettingsPath = getAgentToolExecutionSettingsPath(userDataPath);
  const rootSettings = JSON.parse(await fs.readFile(rootSettingsPath, "utf8"));
  const deepSeekSettings = JSON.parse(await fs.readFile(deepSeekSettingsPath, "utf8"));
  const customHttpSettings = JSON.parse(await fs.readFile(customHttpSettingsPath, "utf8"));
  const agentToolExecutionSettings = JSON.parse(await fs.readFile(agentToolExecutionSettingsPath, "utf8"));
  assert.equal(rootSettings.deepSeekApiKey, undefined);
  assert.equal(rootSettings.customHttpAdapter, undefined);
  assert.equal(rootSettings.agentToolExecution, undefined);
  assert.equal(deepSeekSettings.deepSeekModel, "deepseek-v4-flash");
  assert.equal(deepSeekSettings.deepSeekApiKey, "deepseek-secret");
  assert.equal(customHttpSettings.customHttpAdapter.alias, "kb-http");
  assert.equal(customHttpSettings.customHttpAdapter.token, "secret-token");
  assert.equal(agentToolExecutionSettings.http.timeoutMs, 11000);
  assert.equal(agentToolExecutionSettings.functionCallSchema.local_command.variables.flag, "--version");
  assert.equal(agentToolExecutionSettings.local.commands[0].commandId, "node-version-test");
  const loadedSettings = await loadSettings(userDataPath);
  assert.equal(loadedSettings.agentToolExecution.local.commands[0].command, "node");
  assert.equal(loadedSettings.agentToolExecution.functionCallSchema.local_command.variables.flag, "--version");

  const registry = await fetchJson(`${server.url}/api/agents`);
  assert.equal(registry.defaultAlias, "kb-http");
  assert.deepEqual(
    registry.agents.map((agent) => agent.alias),
    ["kb-http", "qa-http", ...libraryAliases]
  );
  assert.equal(registry.agents[0].callMode, "server-proxy");
  assert.equal(registry.agents[0].urlConfigured, true);
  assert.equal(registry.agents[0].tokenConfigured, true);
  assert.equal(registry.agents[0].token, undefined);
  assert.equal(registry.agents.some((agent) => agent.alias === "deepseek"), false);
  const libraryDeepSeekAgent = registry.agents.find((agent) => agent.alias === libraryAliases[0]);
  assert.equal(libraryDeepSeekAgent.provider, "deepseek");
  assert.equal(libraryDeepSeekAgent.model, "deepseek-v4-flash");
  assert.equal(libraryDeepSeekAgent.agentName, "Flash Analyst");
  const libraryHttpAgent = registry.agents.find((agent) => agent.alias === libraryAliases[1]);
  assert.equal(libraryHttpAgent.provider, "custom-http");
  assert.equal(libraryHttpAgent.model, "http-engine");
  assert.equal(libraryHttpAgent.agentName, "HTTP Analyst");

  const createdAgent = await runPactCli(server.url, [
    "agents",
    "create",
    "--name",
    "CLI Managed Agent",
    "--provider",
    "deepseek",
    "--model",
    "deepseek-v4-flash",
    "--base-url",
    `http://127.0.0.1:${new URL(mockAgent.url).port}`,
    "--api-key",
    "managed-secret",
    "--parameters",
    "{\"temperature\":0.1}"
  ]);
  assert.equal(createdAgent.ok, true);
  assert.match(createdAgent.agentId, /^agent_[0-9a-f]{16}$/);
  assert.equal(createdAgent.agent.agentName, "CLI Managed Agent");
  assert.equal(createdAgent.agent.model, "deepseek-v4-flash");
  const updatedAgent = await runPactCli(server.url, [
    "agents",
    "update",
    "--id",
    createdAgent.agentId,
    "--name",
    "CLI Managed Agent Renamed",
    "--system-prompt",
    "Answer with citations.",
    "--parameters",
    "{\"temperature\":0.2}"
  ]);
  assert.equal(updatedAgent.ok, true);
  assert.equal(updatedAgent.agent.agentName, "CLI Managed Agent Renamed");
  assert.equal(updatedAgent.agent.systemPromptConfigured, true);
  assert.deepEqual(updatedAgent.agent.parameterKeys, ["temperature"]);
  const settingsAfterCliUpdate = await loadSettings(userDataPath);
  const managedAgentSettings = settingsAfterCliUpdate.modelLibraryAgents.find(
    (model) => model.uid === createdAgent.agentId
  );
  assert.equal(managedAgentSettings.apiKey, "managed-secret");
  assert.equal(managedAgentSettings.parameters.temperature, 0.2);
  const deletedAgent = await runPactCli(server.url, [
    "agents",
    "delete",
    "--id",
    createdAgent.agentId
  ]);
  assert.equal(deletedAgent.ok, true);
  const registryAfterDelete = await fetchJson(`${server.url}/api/agents`);
  assert.equal(
    registryAfterDelete.agents.some((agent) => agent.alias === createdAgent.agentId),
    false
  );

  const result = await fetchJson(`${server.url}/api/agent-gateway/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentName: "kb-agent",
      pluginList: ["search", "render"],
      question: "Say hello",
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
      engine: "engine-a",
      parameters: { fromCall: true }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, '$ echo "Hello " $');
  assert.equal(result.dialogId, "dialog-001");
  assert.equal(result.finish, true);
  assert.equal(mockAgent.requests.length, 1);
  assert.equal(mockAgent.requests[0].method, "POST");
  assert.match(String(mockAgent.requests[0].headers["content-type"] || ""), /application\/json/);
  assert.equal(mockAgent.requests[0].headers.token, "secret-token");
  assert.deepEqual(mockAgent.requests[0].body, {
    agentName: "kb-agent",
    pluginList: ["search", "render"],
    question: "Say hello",
    sessionId: "session-1",
    userId: "user-1",
    projectId: "project-1",
    engine: "engine-a",
    parameters: {
      fromSettings: true,
      fromCall: true
    }
  });

  const secondResult = await fetchJson(`${server.url}/api/agent-gateway/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alias: "qa-http",
      question: "Use second adapter"
    })
  });
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.answer, '$ echo "Hello " $');
  assert.equal(mockAgent.requests.length, 2);
  assert.equal(mockAgent.requests[1].headers.token, "second-token");
  assert.deepEqual(mockAgent.requests[1].body, {
    agentName: "second-agent",
    pluginList: ["qa"],
    question: "Use second adapter",
    sessionId: "",
    userId: "",
    projectId: "",
    engine: "second-engine",
    parameters: {
      fromSecondSettings: true
    }
  });

  const deepSeekResult = await fetchJson(`${server.url}/api/agent-gateway/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alias: "deepseek",
      question: "Use DeepSeek",
      parameters: {
        temperature: 0.2
      }
    })
  });
  assert.equal(deepSeekResult.ok, true);
  assert.equal(deepSeekResult.answer, "DeepSeek hello");
  assert.equal(deepSeekResult.upstream.provider, "deepseek");
  assert.equal(deepSeekResult.upstream.model, "deepseek-v4-flash");
  assert.equal(mockAgent.requests.length, 3);
  assert.equal(mockAgent.requests[2].url, "/chat/completions");
  assert.equal(mockAgent.requests[2].headers.authorization, "Bearer deepseek-secret");
  assert.deepEqual(mockAgent.requests[2].body, {
    model: "deepseek-v4-flash",
    messages: [
      {
        role: "user",
        content: "Use DeepSeek"
      }
    ],
    stream: false,
    temperature: 0.2
  });

  const deepSeekHistoryResult = await fetchJson(`${server.url}/api/agent-gateway/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alias: "deepseek",
      messages: [
        {
          role: "assistant",
          content: "Let me check that.",
          reasoning_content: "I should call the lookup tool.",
          tool_calls: [
            {
              id: "call_001",
              type: "function",
              function: { name: "lookup", arguments: "{}" }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_001",
          content: "lookup result"
        },
        {
          role: "user",
          content: "Continue"
        }
      ],
      parameters: {
        thinking: { type: "enabled" },
        reasoning_effort: "high"
      }
    })
  });
  assert.equal(deepSeekHistoryResult.ok, true);
  assert.equal(deepSeekHistoryResult.answer, "DeepSeek hello");
  assert.equal(mockAgent.requests.length, 4);
  assert.equal(mockAgent.requests[3].url, "/chat/completions");
  assert.deepEqual(mockAgent.requests[3].body.messages[0], {
    role: "assistant",
    content: "Let me check that.",
    reasoning_content: "I should call the lookup tool.",
    tool_calls: [
      {
        id: "call_001",
        type: "function",
        function: { name: "lookup", arguments: "{}" }
      }
    ]
  });
  assert.deepEqual(mockAgent.requests[3].body.messages[1], {
    role: "tool",
    content: "lookup result",
    tool_call_id: "call_001"
  });
  assert.deepEqual(mockAgent.requests[3].body.thinking, { type: "enabled" });
  assert.equal(mockAgent.requests[3].body.reasoning_effort, "high");

  const deepSeekProbe = await fetchJson(`${server.url}/api/settings/model-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      settings: {
        deepSeekBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
        defaultModelProvider: "deepseek",
        defaultModel: "stale-deepseek-model",
        deepSeekModel: "deepseek-v4-flash"
      }
    })
  });
  assert.equal(deepSeekProbe.ok, true);
  assert.equal(deepSeekProbe.provider, "deepseek");
  assert.equal(deepSeekProbe.model, "deepseek-v4-flash");
  assert.equal(deepSeekProbe.answerSnippet, "DeepSeek hello");
  assert.match(deepSeekProbe.message, /模型已返回回答/);
  assert.equal(mockAgent.requests.length, 5);
  assert.equal(mockAgent.requests[4].url, "/chat/completions");
  assert.equal(mockAgent.requests[4].headers.authorization, "Bearer deepseek-secret");
  assert.equal(mockAgent.requests[4].body.messages[0].content.includes("Pact 模型库连通性探测"), true);
  assert.equal(mockAgent.requests[4].body.max_tokens, 128);
  assert.deepEqual(mockAgent.requests[4].body.thinking, { type: "disabled" });

  const localProbe = await fetchJson(`${server.url}/api/settings/model-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "local-model",
      settings: {
        localModelEndpoint: mockAgent.url,
        localModelName: "local-smoke"
      }
    })
  });
  assert.equal(localProbe.ok, true);
  assert.equal(localProbe.answerSnippet, "DeepSeek hello");
  assert.equal(mockAgent.requests.length, 6);
  assert.equal(mockAgent.requests[5].method, "POST");
  assert.equal(mockAgent.requests[5].url, "/agent/chat/completions");
  assert.equal(mockAgent.requests[5].body.model, "local-smoke");

  const openRouterAlias = "agent_openrouter_test";
  const openRouterGatewayResult = await callAgentGateway({
    settings: {
      openRouterApiKey: "router-secret",
      openRouterBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
      modelLibraryAgents: [
        {
          uid: openRouterAlias,
          instanceId: openRouterAlias,
          provider: "openrouter",
          label: "OpenRouter Analyst",
          model: "openrouter/tool-model",
          parameters: { temperature: 0.1 }
        }
      ]
    },
    input: {
      alias: openRouterAlias,
      messages: [{ role: "user", content: "Use OpenRouter tools" }],
      parameters: {
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              parameters: { type: "object", properties: {} }
            }
          }
        ],
        tool_choice: "auto"
      }
    },
    contextCompactionSource: "agent_gateway.call",
    userDataPath
  });
  assert.equal(openRouterGatewayResult.ok, true);
  assert.equal(openRouterGatewayResult.upstream.provider, "openrouter");
  assert.equal(openRouterGatewayResult.upstream.model, "openrouter/tool-model");
  assert.equal(mockAgent.requests.length, 7);
  assert.equal(mockAgent.requests[6].url, "/chat/completions");
  assert.equal(mockAgent.requests[6].headers.authorization, "Bearer router-secret");
  assert.equal(mockAgent.requests[6].body.model, "openrouter/tool-model");
  assert.equal(mockAgent.requests[6].body.tool_choice, "auto");
  assert.equal(mockAgent.requests[6].body.tools[0].function.name, "lookup");

  const qwenLocalAlias = "agent_qwen3_32b_test";
  const qwenGatewayResult = await callAgentGateway({
    settings: {
      modelLibraryAgents: [
        {
          uid: qwenLocalAlias,
          instanceId: qwenLocalAlias,
          provider: "local-model",
          label: "Qwen3 32B 32K",
          model: "Qwen/Qwen3-32B",
          baseUrl: mockAgent.url,
          parameters: {
            extra_body: {
              chat_template_kwargs: { enable_thinking: false },
              repetition_penalty: 1.05
            }
          },
          timeoutMs: 30000
        }
      ]
    },
    input: {
      alias: qwenLocalAlias,
      messages: [{ role: "user", content: "Use Qwen Hermes tools" }],
      parameters: {
        max_tokens: 64,
        tools: [
          {
            type: "function",
            function: {
              name: "keyword_search",
              parameters: { type: "object", properties: {} }
            }
          }
        ],
        tool_choice: "auto"
      }
    },
    contextCompactionSource: "agent_gateway.call",
    userDataPath
  });
  assert.equal(qwenGatewayResult.ok, true);
  assert.equal(qwenGatewayResult.upstream.provider, "local-model");
  assert.equal(mockAgent.requests.length, 8);
  assert.equal(mockAgent.requests[7].url, "/agent/chat/completions");
  assert.equal(mockAgent.requests[7].body.model, "Qwen/Qwen3-32B");
  assert.equal(mockAgent.requests[7].body.tool_choice, "auto");
  assert.equal(mockAgent.requests[7].body.max_tokens, 64);
  assert.equal(mockAgent.requests[7].body.tools[0].function.name, "keyword_search");
  assert.deepEqual(mockAgent.requests[7].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(mockAgent.requests[7].body.repetition_penalty, 1.05);

  const layeredAlias = "agent_module_layer_test";
  const layeredSettings = normalizeSettings({
    modelLibraryAgents: [
      {
        uid: layeredAlias,
        instanceId: layeredAlias,
        provider: "local-model",
        label: "Layered Module Agent",
        model: "module-layer-model",
        baseUrl: mockAgent.url,
        moduleAccess: { mode: "selected", moduleIds: ["agentTools"] }
      },
      {
        uid: "agent_taxonomy_only",
        instanceId: "agent_taxonomy_only",
        provider: "local-model",
        label: "Taxonomy Only",
        model: "taxonomy-model",
        baseUrl: mockAgent.url,
        moduleAccess: { mode: "selected", moduleIds: ["knowledgeTaxonomy"] }
      }
    ],
    moduleModelAssignments: {
      agentTools: { provider: "local-model", model: layeredAlias },
      graphInsight: { provider: "local-model", model: layeredAlias },
      knowledgeTaxonomy: { provider: "local-model", model: "agent_taxonomy_only" }
    },
    moduleAgentProfiles: {
      agentTools: {
        primaryAgent: layeredAlias,
        agents: {
          [layeredAlias]: {
            role: "planner",
            systemPrompt: "MODULE_AGENT_PROMPT",
            parameters: { temperature: 0.77, max_tokens: 33 },
            dependencyContext: { retrievalMode: "hybrid" }
          }
        }
      }
    }
  });
  assert.equal(resolveModelForModule(layeredSettings, "agentTools").model, layeredAlias);
  assert.equal(resolveModelForModule(layeredSettings, "graphInsight").enabled, false);
  assert.equal(resolveModelForModule(layeredSettings, "knowledgeTaxonomy").model, "agent_taxonomy_only");
  await callAgentGateway({
    settings: layeredSettings,
    input: {
      alias: layeredAlias,
      modelAlias: layeredAlias,
      moduleId: "agentTools",
      question: "Layered module call"
    },
    contextCompactionSource: "agent_gateway.call",
    userDataPath
  });
  assert.equal(mockAgent.requests.length, 9);
  assert.equal(mockAgent.requests[8].body.model, "module-layer-model");
  assert.equal(mockAgent.requests[8].body.temperature, 0.77);
  assert.equal(mockAgent.requests[8].body.max_tokens, 33);
  assert.equal(mockAgent.requests[8].body.messages[0].content.includes("MODULE_AGENT_PROMPT"), true);
  assert.equal(mockAgent.requests[8].body.messages[0].content.includes("retrievalMode"), true);

  const emptyAnswerProbe = await probeModelConnection({
    provider: "openrouter",
    settings: {
      openRouterApiKey: "test-key",
      openRouterBaseUrl: "http://127.0.0.1/mock",
      openRouterModel: "empty-answer-model"
    },
    contextCompactionSource: "settings.model_probe",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-empty",
          choices: [
            {
              message: {
                role: "assistant",
                content: ""
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      )
  });
  assert.equal(emptyAnswerProbe.ok, false);
  assert.match(emptyAnswerProbe.message, /没有返回可用回答/);

  const contentArrayProbe = await probeModelConnection({
    provider: "openrouter",
    settings: {
      openRouterApiKey: "test-key",
      openRouterBaseUrl: "http://127.0.0.1/mock",
      openRouterModel: "content-array-model"
    },
    contextCompactionSource: "settings.model_probe",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-content-array",
          choices: [
            {
              message: {
                role: "assistant",
                reasoning_content: "Internal reasoning should not be treated as the final answer.",
                content: [
                  { type: "reasoning", text: "not the visible answer" },
                  { type: "text", text: "PactProbeOK" }
                ]
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      )
  });
  assert.equal(contentArrayProbe.ok, true);
  assert.equal(contentArrayProbe.answerSnippet, "PactProbeOK");

  const gatewayWorkspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Gateway Workspace",
      objective: "Verify workspace model and tool context reaches agent gateway"
    })
  });
  await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(gatewayWorkspace.workspace.workspaceId)}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contextProfileId: "gateway-workspace-context",
      modelAlias: "qa-http",
      toolGrantId: "gateway-workspace-tool-grant",
      knowledgeScope: {
        includeSourceIds: ["gateway-workspace-source"]
      }
    })
  });
  const workspaceGatewayRequestCount = mockAgent.requests.length;
  const workspaceGatewayResult = await fetchJson(`${server.url}/api/agent-gateway/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: gatewayWorkspace.workspace.workspaceId,
      question: "Use workspace-selected gateway adapter"
    })
  });
  assert.equal(workspaceGatewayResult.ok, true);
  assert.equal(workspaceGatewayResult.workspaceContext.workspaceId, gatewayWorkspace.workspace.workspaceId);
  assert.equal(workspaceGatewayResult.workspaceContext.contextProfileId, "gateway-workspace-context");
  assert.equal(workspaceGatewayResult.workspaceContext.modelAlias, "qa-http");
  assert.equal(workspaceGatewayResult.workspaceContext.toolGrantId, "gateway-workspace-tool-grant");
  assert.deepEqual(workspaceGatewayResult.workspaceContext.knowledgeSourceIds, ["gateway-workspace-source"]);
  assert.equal(mockAgent.requests.length, workspaceGatewayRequestCount + 1);
  const workspaceGatewayRequest = mockAgent.requests.at(-1);
  assert.equal(workspaceGatewayRequest.headers.token, "second-token");
  assert.equal(workspaceGatewayRequest.body.agentName, "second-agent");
  assert.deepEqual(workspaceGatewayRequest.body.pluginList, ["qa"]);
  assert.equal(workspaceGatewayRequest.body.question, "Use workspace-selected gateway adapter");
  assert.equal(workspaceGatewayRequest.body.contextProfileId, "gateway-workspace-context");
  assert.equal(workspaceGatewayRequest.body.toolGrantId, "gateway-workspace-tool-grant");
  assert.equal(workspaceGatewayRequest.body.workspaceContext.workspaceId, gatewayWorkspace.workspace.workspaceId);
  assert.equal(workspaceGatewayRequest.body.workspaceContext.contextFingerprint, workspaceGatewayResult.workspaceContext.contextFingerprint);
  assert.deepEqual(workspaceGatewayRequest.body.workspaceContext.knowledgeSourceIds, ["gateway-workspace-source"]);

  const savedDeepSeekAlias = settings.modelLibraryAgents[0].alias;
  const redactedDeepSeekProbeBefore = mockAgent.requests.length;
  const redactedDeepSeekProbe = await fetchJson(`${server.url}/api/settings/model-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      modelAlias: savedDeepSeekAlias,
      settings: {
        deepSeekBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
        deepSeekApiKey: "",
        deepSeekApiKeyConfigured: false,
        deepSeekModel: "deepseek-v4-flash",
        modelLibraryAgents: [
          {
            ...settings.modelLibraryAgents[0],
            baseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
            apiKey: "",
            apiKeyConfigured: true
          }
        ]
      }
    })
  });
  assert.equal(redactedDeepSeekProbe.ok, true);
  assert.equal(mockAgent.requests.length, redactedDeepSeekProbeBefore + 1);
  assert.equal(mockAgent.requests.at(-1).headers.authorization, "Bearer deepseek-secret");

  const unsavedDeepSeekAlias = "agent_unsaved_probe_secret";
  const missingDeepSeekSecretProbe = await fetchJson(`${server.url}/api/settings/model-probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      modelAlias: unsavedDeepSeekAlias,
      settings: {
        deepSeekBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
        deepSeekApiKey: "",
        deepSeekApiKeyConfigured: false,
        deepSeekModel: "deepseek-v4-flash",
        modelLibraryAgents: [
          {
            uid: unsavedDeepSeekAlias,
            instanceId: unsavedDeepSeekAlias,
            alias: unsavedDeepSeekAlias,
            provider: "deepseek",
            label: "Unsaved DeepSeek",
            model: "deepseek-v4-flash",
            baseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
            apiKey: "",
            apiKeyConfigured: false
          }
        ]
      }
    })
  });
  assert.equal(missingDeepSeekSecretProbe.ok, false);
  assert.match(missingDeepSeekSecretProbe.message, /API Key 未配置/);
  assert.equal(mockAgent.requests.length, redactedDeepSeekProbeBefore + 1);

  const afterRemove = await fetchJson(`${server.url}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...settings,
      modelLibraryEntries: settings.modelLibraryEntries.filter((provider) => provider !== "deepseek")
    })
  });
  assert.equal(afterRemove.modelLibraryEntries.includes("deepseek"), false);
  await assert.rejects(fs.stat(deepSeekSettingsPath));
  const rootAfterRemove = JSON.parse(await fs.readFile(rootSettingsPath, "utf8"));
  assert.equal(rootAfterRemove.deepSeekApiKey, undefined);
  assert.equal(rootAfterRemove.deepSeekModel, undefined);

  await assert.rejects(
    callAgentGateway({
      settings: {
        deepSeekBaseUrl: `http://127.0.0.1:${new URL(mockAgent.url).port}`,
        modelLibraryAgents: [
          {
            uid: "deepseek",
            instanceId: "deepseek",
            alias: "deepseek",
            provider: "deepseek",
            model: "deepseek-v4-pro",
            apiKey: "deepseek-secret"
          }
        ]
      },
      input: {
        alias: "deepseek",
        question: "Trigger a DeepSeek error for audit verification"
      },
      contextCompactionSource: "agent_gateway.call",
      userDataPath,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "The `reasoning_content` in the thinking mode must be passed back to the API.",
              type: "invalid_request_error",
              code: "invalid_request_error"
            }
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        )
    }),
    /DeepSeek 调用失败：400/
  );

  const auditPath = path.join(userDataPath, "logs", "agent-gateway.jsonl");
  const auditText = await fs.readFile(auditPath, "utf8");
  assert.equal(auditText.includes("deepseek-secret"), false);
  assert.equal(auditText.includes("secret-token"), false);
  const auditEntries = await readJsonl(auditPath);
  assert.ok(
    auditEntries.some(
      (entry) =>
        entry.event === "request_started" &&
        entry.provider === "deepseek" &&
        entry.request?.messages?.[0]?.role === "user"
    )
  );
  assert.ok(
    auditEntries.some(
      (entry) =>
        entry.event === "request_completed" &&
        entry.provider === "deepseek" &&
        entry.response?.hasReasoningContent === true
    )
  );
  assert.ok(
    auditEntries.some(
      (entry) =>
        entry.event === "request_failed" &&
        entry.provider === "deepseek" &&
        entry.status === 400 &&
        String(entry.error || "").includes("reasoning_content")
    )
  );

  console.log("Agent gateway verification passed.");
} finally {
  await server.close();
  await mockAgent.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
