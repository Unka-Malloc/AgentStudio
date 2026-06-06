import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMkdirMock = vi.hoisted(() => vi.fn());
const fsAppendFileMock = vi.hoisted(() => vi.fn());
const runModelRoutingMock = vi.hoisted(() => vi.fn());
const inspectModelRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  return {
    ...actual,
    mkdir: fsMkdirMock,
    appendFile: fsAppendFileMock
  };
});

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs");
  return {
    ...actual,
    runModelRouting: runModelRoutingMock,
    inspectModelRouting: inspectModelRoutingMock
  };
});

import {
  buildAgentGatewayPayload,
  callAgentGateway,
  createAgentStreamAccumulator,
  inspectAgentModelRouting,
  parseAgentGatewayStreamText,
  parseDeepSeekStreamText,
  publicAgentGatewayConfig,
  publicAgentGatewayRegistry,
  resolveAgentGatewayConfig,
  resolveAgentGatewayRegistry
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";

const TEXT_ENCODER = new TextEncoder();

function createJsonResponse({
  status = 200,
  ok = true,
  contentType = "application/json; charset=utf-8",
  bodyText = ""
}) {
  return {
    ok,
    status,
    headers: {
      get: (key) => {
        if (String(key).toLowerCase() === "content-type") {
          return contentType;
        }
        return "";
      }
    },
    text: async () => bodyText
  };
}

function createStreamBody(text = "") {
  return {
    async *[Symbol.asyncIterator]() {
      if (!text) {
        return;
      }
      yield TEXT_ENCODER.encode(text);
    }
  };
}

function sharedGatewaySettings() {
  return {
    customHttpAdapter: {
      uid: "unit-http",
      model: "gateway-lite",
      url: "https://agent.local/call",
      token: "token-1",
      tokenHeader: "x-token",
      tokenPrefix: "Bearer ",
      pluginList: "alpha,beta",
      parameters: { temperature: 0.3 },
      systemPrompt: "Unit prompt"
    },
    customHttpAdapters: [
      {
        uid: "unit-http",
        model: "duplicate-will-ignore",
        url: "https://agent.local/duplicate",
        token: "should-ignore"
      },
      {
        uid: "backup-http",
        model: "gateway-backup",
        url: "https://agent.local/backup",
        token: "token-2"
      }
    ],
    modelLibraryAgents: [
      {
        provider: "deepseek",
        alias: "deepseek-lib",
        model: "deepseek-v4-pro",
        baseUrl: "https://deepseek.example",
        apiKey: "deepseek-token",
        pluginList: "r1,r2"
      },
      {
        provider: "openrouter",
        alias: "openrouter-lib",
        model: "gpt-4o-mini",
        apiKey: "openrouter-token",
        baseUrl: "https://openrouter.example"
      },
      {
        provider: "copilot",
        alias: "copilot-lib",
        model: "copilot-lite",
        token: "copilot-token",
        baseUrl: "https://copilot.example"
      },
      {
        provider: "local-model",
        alias: "local-lib",
        model: "local-1",
        token: "local-token",
        baseUrl: "http://localhost:11434/v1"
      },
      {
        provider: "unrelated-provider",
        alias: "ignore-me",
        model: "ignored-model"
      }
    ]
  };
}

describe("agent-gateway normalization and registry exports", () => {
  beforeEach(() => {
    fsMkdirMock.mockReset();
    fsAppendFileMock.mockReset();
    runModelRoutingMock.mockReset();
    inspectModelRoutingMock.mockReset();
  });

  it("resolves registry with deduped aliases and normalized providers", () => {
    const settings = sharedGatewaySettings();
    const registry = resolveAgentGatewayRegistry(settings);

    expect(registry).toMatchObject([
      expect.objectContaining({
        alias: "unit-http",
        provider: "custom-http",
        model: "gateway-lite",
        label: "自定义 HTTP Adapter",
        token: "token-1",
        timeoutMs: 120000
      }),
      expect.objectContaining({
        alias: "backup-http",
        provider: "custom-http",
        model: "gateway-backup",
        url: "https://agent.local/backup"
      }),
      expect.objectContaining({
        alias: "deepseek-lib",
        provider: "deepseek",
        model: "deepseek-v4-pro"
      }),
      expect.objectContaining({
        alias: "openrouter-lib",
        provider: "openrouter",
        model: "gpt-4o-mini",
        tokenHeader: "Authorization"
      }),
      expect.objectContaining({
        alias: "copilot-lib",
        provider: "copilot",
        model: "copilot-lite"
      }),
      expect.objectContaining({
        alias: "local-lib",
        provider: "local-model",
        model: "local-1",
        tokenHeader: "Authorization"
      })
    ]);
    expect(registry.find((item) => item.alias === "unit-http").url).toBe("https://agent.local/call");
  });

  it("computes public registry payload and default alias correctly", () => {
    const publicRegistry = publicAgentGatewayRegistry(sharedGatewaySettings());

    expect(publicRegistry.schemaVersion).toBe(1);
    expect(publicRegistry.provider).toBe("agent-gateway");
    expect(publicRegistry.defaultAlias).toBe("unit-http");
    expect(publicRegistry.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alias: "unit-http", callMode: "server-proxy", systemPromptConfigured: true }),
        expect.objectContaining({ alias: "deepseek-lib", callMode: "server-proxy", capabilities: ["agent.invoke", "knowledge.agent.answer"] })
      ])
    );
  });

  it("resolves config using provider/alias fallback order", () => {
    const settings = sharedGatewaySettings();

    const byProvider = resolveAgentGatewayConfig(settings, { provider: "openrouter" });
    expect(byProvider).toMatchObject({ provider: "openrouter", alias: "openrouter-lib", model: "gpt-4o-mini" });

    const byAlias = resolveAgentGatewayConfig(settings, { alias: "local-lib" });
    expect(byAlias).toMatchObject({ provider: "local-model", alias: "local-lib" });

    const deepSeekAlias = resolveAgentGatewayConfig(settings, { alias: "deepseek" });
    expect(deepSeekAlias.provider).toBe("deepseek");

    const fallbackMissingAlias = resolveAgentGatewayConfig(settings, { alias: "unknown", model: "deepseek" });
    expect(fallbackMissingAlias.provider).toBe("custom-http");
    expect(fallbackMissingAlias.alias).toBe("unknown");
  });

  it("removes token from public config while preserving capability flags", () => {
    const publicConfig = publicAgentGatewayConfig(sharedGatewaySettings());

    expect(publicConfig.token).toBe("");
    expect(publicConfig.urlConfigured).toBe(true);
    expect(publicConfig.tokenConfigured).toBe(true);
    expect(publicConfig.provider).toBe("custom-http");
  });

  it("builds gateway payload with input merge and workspace context normalization", () => {
    const settings = sharedGatewaySettings();
    const payload = buildAgentGatewayPayload(
      {
        question: "  你好  ",
        pluginList: ["user-a"],
        sessionId: "  session-1  ",
        userId: "user-1",
        projectId: "p-1",
        parameters: { temperature: 0.2 },
        workspaceContext: {
          workspaceId: "workspace-1",
          currentGeneration: "12",
          contextFingerprint: "fp",
          modelAlias: "alias"
        }
      },
      settings
    );

    expect(payload).toMatchObject({
      question: "你好",
      pluginList: ["user-a"],
      sessionId: "session-1",
      userId: "user-1",
      projectId: "p-1",
      engine: "gateway-lite"
    });
    expect(payload.parameters).toMatchObject({
      temperature: 0.2,
      systemPrompt: "Unit prompt"
    });
    expect(payload.workspaceContext).toMatchObject({
      workspaceId: "workspace-1",
      currentGeneration: 12,
      contextFingerprint: "fp",
      modelAlias: "alias"
    });
  });
});

describe("agent-gateway stream parsers and accumulators", () => {
  it("accumulates stream events and exposes precedence between answer and text chunks", () => {
    const accumulator = createAgentStreamAccumulator();

    accumulator.push({ type: "text", data: { content: "前置文本 " } });
    accumulator.push({ type: "answer", data: { content: "最终答案" } });
    accumulator.push({ type: "dialogId", data: { content: "dialog-1" } });
    accumulator.push({ type: "finish", data: {} } );

    const result = accumulator.result();

    expect(result.answer).toBe("最终答案");
    expect(result.text).toBe("最终答案");
    expect(result.dialogId).toBe("dialog-1");
    expect(result.finish).toBe(true);
    expect(result.chunks.text).toEqual(["前置文本 "]);
    expect(result.chunks.answer).toEqual(["最终答案"]);
  });

  it("parses generic gateway SSE text safely and ignores non-data lines", () => {
    const streamText = [
      "event: ping",
      "data: {\"type\":\"text\",\"data\":{\"content\":\"a\"}}",
      "data: {\"type\":\"answer\",\"data\":{\"content\":\"b\"}}",
      "data: [DONE]",
      "data: invalid-json",
      "data: {\"type\":\"dialogId\",\"data\":{\"content\":\"dg\"}}"
    ].join("\n");

    const parsed = parseAgentGatewayStreamText(streamText);

    expect(parsed.answer).toBe("b");
    expect(parsed.dialogId).toBe("dg");
    expect(parsed.events[0]).toMatchObject({ type: "text", content: "a", nodeId: null });
  });

  it("keeps accumulator resilient for raw and non-object stream events", () => {
    const accumulator = createAgentStreamAccumulator();

    accumulator.push(null);
    accumulator.push("ignored");
    accumulator.push({ type: "rawData", data: { content: "{\"text\":\"raw fallback\"}" } });
    accumulator.push({ type: "rawData", data: { content: "not-json" } });
    accumulator.push({ type: "dialogId", data: { content: "dialog-raw" } });
    accumulator.push({ type: "finish", finish: true, data: {} });

    expect(accumulator.result()).toMatchObject({
      answer: "raw fallback",
      dialogId: "dialog-raw",
      finish: true,
      chunks: {
        rawText: ["raw fallback"]
      }
    });
  });

  it("parses deepseek stream text and merges tool-call delta arguments", () => {
    const streamText = [
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"reasoning_content":"思路:"}}]}',
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello "}}]}',
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"world","tool_calls":[{"index":0,"id":"tool-1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"query\\"}"}}]}}]}',
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"!","finish_reason":"stop"}}]}',
      "data: [DONE]"
    ].join("\n");

    const parsed = parseDeepSeekStreamText(streamText);

    expect(parsed.dialogId).toBe("evt-deep");
    expect(parsed.payload.model).toBe("deepseek-chat");
    expect(parsed.answer).toBe("Hello world!");
    expect(parsed.chunks.reasoning).toEqual(["思路:"]);
    expect(parsed.toolCalls).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"q\":\"query\"}"
        }
      }
    ]);
  });

  it("keeps deepseek parser resilient on malformed SSE payloads", () => {
    const parsed = parseDeepSeekStreamText(["data: invalid-json", "data: {\"id\":\"ok\",\"model\":\"d\",\"choices\":[{\"delta\":{\"content\":\"可用\"}}]}", "data: [DONE]"].join("\n"));

    expect(parsed.answer).toBe("可用");
    expect(parsed.dialogId).toBe("ok");
  });
});

describe("agent-gateway invocation paths", () => {
  beforeEach(() => {
    fsMkdirMock.mockReset();
    fsAppendFileMock.mockReset();
    runModelRoutingMock.mockReset();
    inspectModelRoutingMock.mockReset();
  });

  it("calls configured custom-http provider and parses json response", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        bodyText: JSON.stringify({
          answer: "自定义网关回复",
          toolCalls: [
            {
              id: "call-1",
              function: { name: "lookup", arguments: "{\"q\":1}" }
            }
          ]
        })
      })
    );

    const result = await callAgentGateway({
      settings: sharedGatewaySettings(),
      input: {
        question: "请总结最近事件",
        sessionId: "session-1",
        pluginList: ["cli"],
        parameters: { temperature: 0.5 }
      },
      fetchImpl,
      userDataPath: "/tmp/pact-agent-gateway"
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("自定义网关回复");
    expect(result.toolCalls).toEqual([
      {
        id: "call-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: '{"q":1}'
        }
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody).toMatchObject({
      question: "请总结最近事件",
      pluginList: ["cli"],
      engine: "gateway-lite",
      parameters: { temperature: 0.5 }
    });
  });

  it("parses custom-http streaming body and data-prefixed text responses", async () => {
    const streamFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (key) =>
          String(key).toLowerCase() === "content-type"
            ? "text/event-stream; charset=utf-8"
            : ""
      },
      body: createStreamBody([
        'data: {"type":"text","data":{"content":"stream text"}}',
        'data: {"type":"rawData","data":{"content":"{\\"text\\":\\"raw stream\\"}"}}',
        'data: {"type":"answer","data":{"content":"stream answer"}}',
        'data: {"type":"finish","data":{}}'
      ].join("\n")),
      text: async () => ""
    }));

    const streamed = await callAgentGateway({
      settings: sharedGatewaySettings(),
      input: { question: "stream please" },
      fetchImpl: streamFetch
    });

    expect(streamed).toMatchObject({
      ok: true,
      answer: "stream answer",
      finish: true,
      chunks: {
        rawText: ["raw stream"]
      }
    });

    const textFetch = vi.fn(async () =>
      createJsonResponse({
        contentType: "text/plain; charset=utf-8",
        bodyText: [
          'data: {"type":"rawData","data":{"content":"{\\"text\\":\\"text fallback\\"}"}}',
          "data: [DONE]"
        ].join("\n")
      })
    );

    const textResult = await callAgentGateway({
      settings: sharedGatewaySettings(),
      input: { question: "text stream please" },
      fetchImpl: textFetch
    });

    expect(textResult).toMatchObject({
      ok: true,
      answer: "text fallback",
      chunks: {
        rawText: ["text fallback"]
      }
    });
  });

  it("does not append chat completions twice for compatible providers", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        bodyText: JSON.stringify({
          choices: [{ message: { content: "compatible answer" } }]
        })
      })
    );

    await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-direct",
            model: "deepseek-chat",
            baseUrl: "https://deepseek.example/chat/completions",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: { provider: "deepseek", alias: "deepseek-direct", question: "ping" },
      fetchImpl
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://deepseek.example/chat/completions");

    await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "openrouter",
            alias: "openrouter-direct",
            model: "openrouter-chat",
            baseUrl: "https://router.example/v1/chat/completions",
            apiKey: "router-token"
          }
        ]
      },
      input: { provider: "openrouter", alias: "openrouter-direct", question: "ping" },
      fetchImpl
    });

    expect(fetchImpl.mock.calls[1][0]).toBe("https://router.example/v1/chat/completions");
  });

  it("rejects on missing question for custom-http execution", async () => {
    const fetchImpl = vi.fn();

    await expect(
      callAgentGateway({
        settings: sharedGatewaySettings(),
        input: {},
        fetchImpl
      })
    ).rejects.toThrow("question 不能为空。");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps non-OK http responses to structured caller failure", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({ ok: false, status: 502, bodyText: "downstream failure" })
    );

    await expect(
      callAgentGateway({
        settings: sharedGatewaySettings(),
        input: { question: "hello" },
        fetchImpl
      })
    ).rejects.toThrow("智能体调用失败：502 downstream failure");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("validates DeepSeek API key before sending request", async () => {
    const settings = {
      modelLibraryAgents: [
        {
          provider: "deepseek",
          alias: "deepseek-route",
          model: "deepseek-v4",
          url: "https://deepseek.example"
        }
      ]
    };

    await expect(
      callAgentGateway({
        settings,
        input: { question: "test deepseek" },
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow("DeepSeek API Key 未配置。");
  });

  it("uses model routing branch and attaches routing summary metadata", async () => {
    runModelRoutingMock.mockResolvedValue({
      result: {
        ok: true,
        answer: "路由结果",
        request: { question: "路由问题" }
      },
      routing: {
        protocolVersion: "pact.model-routing.v1",
        routeCallId: "route-call",
        routeId: "agent_gateway.default",
        selectedAlias: "unit-http",
        fallbackUsed: false,
        attempts: [
          {
            alias: "unit-http",
            status: "success",
            reason: "",
            startedAt: "",
            completedAt: "",
          }
        ]
      }
    });

    const fetchImpl = vi.fn();
    const result = await callAgentGateway({
      settings: {
        ...sharedGatewaySettings(),
        modelRouting: {
          enabled: true
        }
      },
      input: { question: "路由问题" },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "路由结果",
      modelRouting: {
        selectedAlias: "unit-http",
        routeCallId: "route-call"
      }
    });
    expect(runModelRoutingMock).toHaveBeenCalledTimes(1);
    const routingInput = runModelRoutingMock.mock.calls[0][0];
    expect(routingInput.input.question).toBe("路由问题");
    expect(routingInput.registry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alias: "unit-http" }),
        expect.objectContaining({ alias: "backup-http" })
      ])
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("supports strategy provider overrides for routing execution", async () => {
    const strategyProvider = {
      runModelRouting: vi.fn(async () => ({
        result: {
          ok: true,
          answer: "策略路由答案"
        },
        routing: {
          selectedAlias: "strategy-alias",
          attempts: []
        }
      }))
    };

    const fetchImpl = vi.fn();

    const result = await callAgentGateway({
      settings: {
        ...sharedGatewaySettings(),
        modelRouting: {
          enabled: true
        }
      },
      input: { question: "策略问题" },
      fetchImpl,
      strategyProvider
    });

    expect(result.modelRouting).toMatchObject({ selectedAlias: "strategy-alias" });
    expect(strategyProvider.runModelRouting).toHaveBeenCalledTimes(1);
    expect(runModelRoutingMock).not.toHaveBeenCalled();
  });

  it("returns model-routing inspect snapshot via passthrough mock", async () => {
    const snapshot = {
      schemaVersion: 1,
      protocolVersion: "pact.model-routing.v1",
      ledgerSummary: { total: 2 }
    };
    inspectModelRoutingMock.mockResolvedValue(snapshot);

    const result = await inspectAgentModelRouting({ userDataPath: "/tmp/pact-agent-gateway", limit: 5 });

    expect(inspectModelRoutingMock).toHaveBeenCalledWith({ userDataPath: "/tmp/pact-agent-gateway", limit: 5 });
    expect(result).toEqual(snapshot);
  });

  it("propagates model-routing inspection errors", async () => {
    const error = new Error("routing inspect failed");
    inspectModelRoutingMock.mockRejectedValue(error);

    await expect(inspectAgentModelRouting({ userDataPath: "/tmp/pact-agent-gateway" })).rejects.toThrow(
      "routing inspect failed"
    );
  });
});
