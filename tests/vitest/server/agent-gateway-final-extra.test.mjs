import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentGatewayPayload,
  callAgentGateway,
  publicAgentGatewayConfig,
  publicAgentGatewayRegistry,
  parseDeepSeekStreamText,
  resolveAgentGatewayConfig,
  resolveAgentGatewayRegistry
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";

const runModelRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs");
  return {
    ...actual,
    runModelRouting: (...args) => runModelRoutingMock(...args)
  };
});

function createTextResponse(bodyText, {
  status = 200,
  ok = true,
  contentType = "text/plain; charset=utf-8"
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => bodyText
  };
}

describe("agent-gateway final coverage extras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the empty external-agent config when no adapters are configured", () => {
    expect(resolveAgentGatewayRegistry({})).toEqual([]);

    expect(publicAgentGatewayRegistry({})).toEqual({
      schemaVersion: 1,
      provider: "agent-gateway",
      defaultAlias: "",
      agents: []
    });

    expect(resolveAgentGatewayConfig({}, {})).toMatchObject({
      alias: "external-agent",
      provider: "custom-http",
      url: "",
      token: "",
      label: "自定义 HTTP Adapter"
    });

    expect(publicAgentGatewayConfig({})).toMatchObject({
      alias: "external-agent",
      provider: "custom-http",
      urlConfigured: false,
      tokenConfigured: false
    });
  });

  it("keeps unknown provider requests on the custom-http fallback path", () => {
    const settings = {
      customHttpAdapter: {
        uid: "primary-http",
        model: "gateway-lite",
        url: "https://gateway.local/call",
        token: "gateway-token"
      },
      modelLibraryAgents: [
        {
          provider: "openrouter",
          alias: "openrouter-route",
          model: "gpt-4o-mini",
          baseUrl: "https://openrouter.example",
          apiKey: "openrouter-token"
        }
      ]
    };

    expect(resolveAgentGatewayConfig(settings, { provider: "unknown-provider" })).toMatchObject({
      alias: "primary-http",
      provider: "custom-http",
      model: "gateway-lite"
    });

    expect(resolveAgentGatewayConfig(settings, { provider: "unknown-provider", alias: "standalone" })).toMatchObject({
      alias: "standalone",
      provider: "custom-http",
      url: ""
    });
  });

  it("normalizes payload aliases for query, profile, and grant fields", () => {
    const payload = buildAgentGatewayPayload(
      {
        query: "  用 query 字段  ",
        pluginList: "alpha, beta,",
        profileId: " profile-1 ",
        grantId: " grant-2 ",
        systemPrompt: "  custom system prompt  ",
        workspaceContext: {
          workspaceId: "workspace-1",
          currentGeneration: "7",
          contextFingerprint: "fingerprint-1",
          contextProfileId: "profile-ctx",
          modelAlias: "model-alias",
          toolGrantId: "grant-ctx",
          knowledgeSourceIds: "source-a, source-b"
        }
      },
      {
        customHttpAdapter: {
          uid: "primary-http",
          model: "gateway-lite",
          url: "https://gateway.local/call",
          token: "gateway-token",
          parameters: {
            temperature: 0.1
          }
        }
      }
    );

    expect(payload).toMatchObject({
      question: "用 query 字段",
      pluginList: ["alpha", "beta"],
      contextProfileId: "profile-1",
      toolGrantId: "grant-2",
      grantId: "grant-2",
      systemPrompt: "custom system prompt",
      engine: "gateway-lite"
    });
    expect(payload.parameters).toMatchObject({
      temperature: 0.1,
      systemPrompt: "custom system prompt"
    });
    expect(payload.workspaceContext).toMatchObject({
      workspaceId: "workspace-1",
      currentGeneration: 7,
      contextFingerprint: "fingerprint-1",
      contextProfileId: "profile-ctx",
      modelAlias: "model-alias",
      toolGrantId: "grant-ctx",
      knowledgeSourceIds: ["source-a", "source-b"]
    });
  });

  it("rejects before fetch when a selected adapter has no URL", async () => {
    const fetchImpl = vi.fn();

    await expect(
      callAgentGateway({
        settings: {},
        input: {
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("智能体 URL 未配置：external-agent");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces transport failures from fetch without masking the original error", async () => {
    const fetchError = new Error("socket closed");
    const fetchImpl = vi.fn(async () => {
      throw fetchError;
    });

    await expect(
      callAgentGateway({
        settings: {
          customHttpAdapter: {
            uid: "primary-http",
            model: "gateway-lite",
            url: "https://gateway.local/call",
            token: "gateway-token"
          }
        },
        input: {
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("socket closed");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces transport failures from openrouter-compatible execution", async () => {
    const fetchError = new Error("connection reset");
    const fetchImpl = vi.fn(async () => {
      throw fetchError;
    });

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "openrouter",
              alias: "openrouter-route",
              model: "gpt-4o-mini",
              baseUrl: "https://openrouter.example",
              apiKey: "openrouter-token"
            }
          ]
        },
        input: {
          provider: "openrouter",
          alias: "openrouter-route",
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("connection reset");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps openrouter-compatible HTTP failures into a labeled upstream error", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse("upstream failure", {
        ok: false,
        status: 503,
        contentType: "text/plain; charset=utf-8"
      })
    );

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "openrouter",
              alias: "openrouter-route",
              model: "gpt-4o-mini",
              baseUrl: "https://openrouter.example",
              apiKey: "openrouter-token"
            }
          ]
        },
        input: {
          provider: "openrouter",
          alias: "openrouter-route",
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("OpenRouter gpt-4o-mini 调用失败：503 upstream failure");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses deepseek stream responses with finish markers and ordered tool calls", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        [
          'data: {"id":"deepseek-stream-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"first","tool_calls":[{"index":1,"id":"tool-b","type":"function","function":{"name":"beta","arguments":"{\\"b\\":2}"}}]},"finish_reason":"stop"}]}',
          'data: {"id":"deepseek-stream-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"second","tool_calls":[{"index":0,"id":"tool-a","type":"function","function":{"name":"alpha","arguments":"{\\"a\\":1}"}}]}}]}',
          "data: [DONE]"
        ].join("\n"),
        {
          contentType: "text/event-stream; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "stream me"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "firstsecond",
      finish: true,
      upstream: {
        provider: "deepseek",
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        model: "deepseek-v4-pro"
      }
    });
    expect(result.toolCalls).toEqual([
      {
        id: "tool-a",
        type: "function",
        function: {
          name: "alpha",
          arguments: "{\"a\":1}"
        }
      },
      {
        id: "tool-b",
        type: "function",
        function: {
          name: "beta",
          arguments: "{\"b\":2}"
        }
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects deepseek execution when both question and messages are absent", async () => {
    const fetchImpl = vi.fn();

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "deepseek",
              alias: "deepseek-route",
              model: "deepseek-v4-pro",
              baseUrl: "https://deepseek.example",
              apiKey: "deepseek-token"
            }
          ]
        },
        input: {
          provider: "deepseek",
          alias: "deepseek-route"
        },
        fetchImpl
      })
    ).rejects.toThrow("question 不能为空。");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses deepseek stream text with non-data lines and function-call deltas", () => {
    const parsed = parseDeepSeekStreamText([
      "event: ping",
      "data:",
      'data: {"id":"deepseek-func","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"function_call":{"name":"lookup","arguments":"{\\"q\\":\\"x\\"}"}}}]}',
      "data: [DONE]"
    ].join("\n"));

    expect(parsed).toMatchObject({
      dialogId: "deepseek-func",
      payload: {
        id: "deepseek-func",
        model: "deepseek-v4-pro"
      }
    });
    expect(parsed.toolCalls).toEqual([
      {
        id: "tool_call_1",
        type: "function",
        function: {
          name: "lookup",
          arguments: '{"q":"x"}'
        }
      }
    ]);
  });

  it("parses deepseek stream text even when tool-call deltas include empty items", () => {
    const parsed = parseDeepSeekStreamText([
      'data: {"id":"deepseek-null-tool","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"tool_calls":[null,{"index":0,"id":"tool-1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":1}"}}]}}]}',
      "data: [DONE]"
    ].join("\n"));

    expect(parsed.toolCalls).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"q\":1}"
        }
      }
    ]);
  });

  it("merges extra_body parameters for openai-compatible requests", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "openrouter-1",
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: {
                content: "openrouter answer"
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
        contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "openrouter",
            alias: "openrouter-route",
            model: "gpt-4o-mini",
            baseUrl: "https://openrouter.example",
            apiKey: "openrouter-token"
          }
        ]
      },
      input: {
        provider: "openrouter",
        alias: "openrouter-route",
        question: "ping",
        parameters: {
          extra_body: {
            custom_flag: "yes",
            model: "should-not-win"
          },
          temperature: 0.2
        }
      },
      fetchImpl
    });

    expect(result.answer).toBe("openrouter answer");
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini",
      custom_flag: "yes",
      temperature: 0.2
    });
    expect(requestBody).not.toHaveProperty("model", "should-not-win");
  });

  it("applies thinking mode for qwen-compatible openai requests", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "local-model-1",
          model: "qwen2.5",
          choices: [
            {
              index: 0,
              message: {
                content: "local answer"
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "local-model",
            alias: "local-route",
            model: "qwen2.5",
            baseUrl: "http://localhost:11434/v1",
            token: "local-token"
          }
        ]
      },
      input: {
        provider: "local-model",
        alias: "local-route",
        systemPrompt: "system prompt",
        messages: [{ role: "user", content: "hello" }],
        question: "ping",
        parameters: {
          pact_thinking_mode: "enabled",
          temperature: 0.15
        }
      },
      fetchImpl
    });

    expect(result.answer).toBe("local answer");
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "qwen2.5",
      temperature: 0.15,
      chat_template_kwargs: {
        enable_thinking: true
      }
    });
    expect(requestBody.messages[0]).toMatchObject({
      role: "system",
      content: "system prompt"
    });
  });

  it("parses deepseek json responses on the success path", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-1",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "deepseek answer"
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "deepseek answer",
      upstream: {
        provider: "deepseek",
        status: 200,
        contentType: "application/json; charset=utf-8",
        model: "deepseek-v4-pro"
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects deepseek configs with an explicit empty model field", async () => {
    const fetchImpl = vi.fn();

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "deepseek",
              alias: "deepseek-route",
              model: "",
              baseUrl: "https://deepseek.example",
              apiKey: "deepseek-token"
            }
          ]
        },
        input: {
          provider: "deepseek",
          alias: "deepseek-route",
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("DeepSeek 模型 ID 为空，不能发起模型调用。");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the default deepseek model when none is configured", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-default-model",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "default answer"
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping"
      },
      fetchImpl
    });

    expect(result.answer).toBe("default answer");
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody.model).toBe("deepseek-v4-pro");
  });

  it("copies deepseek request parameters into the upstream payload", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-params",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "parameter answer"
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping",
        parameters: {
          temperature: 0.25,
          top_p: 0.8
        }
      },
      fetchImpl
    });

    expect(result.answer).toBe("parameter answer");
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-pro",
      temperature: 0.25,
      top_p: 0.8
    });
    expect(requestBody).not.toHaveProperty("extra_body");
  });

  it("captures deepseek audits for mixed messages and tool calls", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-audit-1",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "deepseek answer",
                reasoning_content: "thinking",
                tool_calls: [
                  null,
                  {
                    id: "tool-1",
                    function: {
                      name: "lookup",
                      arguments: "{\"q\":1}"
                    }
                  }
                ]
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );
    const userDataPath = `/tmp/pact-agent-gateway-audit-${process.pid}-${Date.now()}`;

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping",
        systemPrompt: "system prompt",
        messages: [
          null,
          {
            content: "orphan message"
          },
          {
            role: "assistant",
            content: "assistant note",
            reasoning: "chain of thought"
          },
          {
            role: "user",
            content: "user prompt",
            tool_calls: [
              {
                id: "message-tool",
                function: {
                  name: "lookup",
                  arguments: { q: 2 }
                }
              }
            ],
            tool_call_id: "tool-call-1",
            name: "helper"
          }
        ],
        parameters: {
          pact_thinking_mode: "disabled",
          temperature: 0.3,
          top_p: 0.9,
          tools: [
            {
              type: "function",
              function: {
                name: "lookup",
                description: "lookup helper",
                parameters: {
                  type: "object",
                  properties: {
                    q: { type: "number" }
                  }
                }
              }
            }
          ],
          tool_choice: {
            type: "function",
            function: {
              name: "lookup"
            }
          }
        }
      },
      fetchImpl,
      userDataPath
    });

    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-pro",
      temperature: 0.3,
      top_p: 0.9,
      thinking: {
        type: "disabled"
      }
    });
    expect(requestBody.messages[0]).toMatchObject({
      role: "system",
      content: "system prompt"
    });
    expect(requestBody.messages[1]).toMatchObject({
      role: "assistant",
      content: "assistant note",
      reasoning_content: "chain of thought"
    });
    expect(requestBody.tools).toHaveLength(1);
    expect(requestBody.tool_choice).toMatchObject({
      type: "function",
      function: {
        name: "lookup"
      }
    });
    expect(result).toMatchObject({
      ok: true,
      answer: "deepseek answer",
      upstream: {
        provider: "deepseek",
        status: 200,
        contentType: "application/json; charset=utf-8",
        model: "deepseek-v4-pro"
      }
    });
    expect(result.toolCalls).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"q\":1}"
        }
      }
    ]);
    expect(result.chunks.reasoning).toEqual(["thinking"]);
  });

  it("parses deepseek json responses with reasoning content and tool calls", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-2",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "deepseek answer",
                reasoning_content: "thinking",
                tool_calls: [
                  {
                    id: "tool-1",
                    function: {
                      name: "lookup",
                      arguments: "{\"q\":1}"
                    }
                  }
                ]
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "deepseek answer",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "lookup",
            arguments: "{\"q\":1}"
          }
        }
      ]
    });
    expect(result.chunks.reasoning).toEqual(["thinking"]);
  });

  it("records request failures for custom-http adapters when fetch throws", async () => {
    const fetchError = new Error("socket closed");
    const fetchImpl = vi.fn(async () => {
      throw fetchError;
    });
    const userDataPath = `/tmp/pact-agent-gateway-failure-${process.pid}-${Date.now()}`;

    await expect(
      callAgentGateway({
        settings: {
          customHttpAdapter: {
            uid: "primary-http",
            model: "gateway-lite",
            url: "https://gateway.local/call",
            token: "gateway-token",
            parameters: {
              apiKey: "secret-key",
              nested: {
                token: "inner-secret",
                values: ["Bearer abc", 2]
              }
            }
          }
        },
        input: {
          question: "Bearer hidden",
          parameters: {
            token: "masked-token",
            nested: {
              apiKey: "nested-secret"
            }
          }
        },
        fetchImpl,
        userDataPath
      })
    ).rejects.toThrow("socket closed");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps deepseek json tool-call normalization strict about missing names", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse(
        JSON.stringify({
          id: "deepseek-3",
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                content: "deepseek answer",
                tool_calls: [
                  null,
                  {},
                  {
                    id: "tool-1",
                    function: {
                      name: "lookup",
                      arguments: "{\"q\":1}"
                    }
                  }
                ],
                function_call: {
                  name: "lookup",
                  arguments: "{\"q\":1}"
                }
              },
              finish_reason: "stop"
            }
          ]
        }),
        {
          contentType: "application/json; charset=utf-8"
        }
      )
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping"
      },
      fetchImpl
    });

    expect(result.toolCalls).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"q\":1}"
        }
      },
      {
        id: "tool_call_2",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"q\":1}"
        }
      }
    ]);
  });

  it("drops null deepseek tool-call entries during normalization", () => {
    const parsed = parseDeepSeekStreamText([
      'data: {"id":"deepseek-null-call","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"tool_calls":[null]}}]}',
      "data: [DONE]"
    ].join("\n"));

    expect(parsed.toolCalls).toEqual([]);
  });

  it("treats deepseek plain-text responses as direct answers", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse("deepseek plain answer", {
        contentType: "text/plain; charset=utf-8"
      })
    );

    const result = await callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-route",
            model: "deepseek-v4-pro",
            baseUrl: "https://deepseek.example",
            apiKey: "deepseek-token"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-route",
        question: "ping"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "deepseek plain answer",
      text: "deepseek plain answer",
      upstream: {
        provider: "deepseek",
        status: 200,
        contentType: "text/plain; charset=utf-8",
        model: "deepseek-v4-pro"
      }
    });
  });

  it("surfaces deepseek transport failures without rewrapping the original error", async () => {
    const fetchError = new Error("deepseek transport dropped");
    const fetchImpl = vi.fn(async () => {
      throw fetchError;
    });

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "deepseek",
              alias: "deepseek-route",
              model: "deepseek-v4-pro",
              baseUrl: "https://deepseek.example",
              apiKey: "deepseek-token"
            }
          ]
        },
        input: {
          provider: "deepseek",
          alias: "deepseek-route",
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("deepseek transport dropped");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps deepseek HTTP failures into a labeled upstream error", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse("deepseek upstream failure", {
        ok: false,
        status: 502,
        contentType: "text/plain; charset=utf-8"
      })
    );

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "deepseek",
              alias: "deepseek-route",
              model: "deepseek-v4-pro",
              baseUrl: "https://deepseek.example",
              apiKey: "deepseek-token"
            }
          ]
        },
        input: {
          provider: "deepseek",
          alias: "deepseek-route",
          question: "ping"
        },
        fetchImpl
      })
    ).rejects.toThrow("DeepSeek 调用失败：502 deepseek upstream failure");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts plain-text responses as direct answers for custom-http execution", async () => {
    const fetchImpl = vi.fn(async () =>
      createTextResponse("plain text answer", {
        contentType: "text/plain; charset=utf-8"
      })
    );

    const result = await callAgentGateway({
      settings: {
        customHttpAdapter: {
          uid: "primary-http",
          model: "gateway-lite",
          url: "https://gateway.local/call",
          token: "gateway-token"
        }
      },
      input: {
        question: "ping"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "plain text answer",
      text: "plain text answer",
      upstream: {
        status: 200,
        contentType: "text/plain; charset=utf-8"
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects local-model execution when both question and messages are absent", async () => {
    const fetchImpl = vi.fn();

    await expect(
      callAgentGateway({
        settings: {
          modelLibraryAgents: [
            {
              provider: "local-model",
              alias: "local-qwen",
              model: "qwen2.5",
              baseUrl: "http://localhost:11434/v1",
              token: "local-token"
            }
          ]
        },
        input: {
          provider: "local-model",
          alias: "local-qwen"
        },
        fetchImpl
      })
    ).rejects.toThrow("question 不能为空。");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes when model routing is enabled even if the caller only supplies a routing policy", async () => {
    runModelRoutingMock.mockResolvedValue({
      routing: {
        protocolVersion: "pact.model-routing.v1",
        routeId: "route-1",
        selectedAlias: "primary-http",
        fallbackUsed: false
      },
      result: {
        ok: true,
        answer: "routed answer",
        request: {
          question: "route me"
        }
      }
    });

    const fetchImpl = vi.fn();
    const result = await callAgentGateway({
      settings: {
        customHttpAdapter: {
          uid: "primary-http",
          model: "gateway-lite",
          url: "https://gateway.local/call",
          token: "gateway-token"
        },
        modelRouting: {
          enabled: true,
          fallbackChain: ["primary-http"]
        }
      },
      input: {
        question: "route me"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "routed answer",
      modelRouting: {
        routeId: "route-1",
        selectedAlias: "primary-http"
      }
    });
    expect(runModelRoutingMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
