import { describe, expect, it, vi } from "vitest";

import {
  callAgentGateway,
  publicAgentGatewayConfig,
  resolveAgentGatewayConfig
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";

function jsonResponse(body, {
  status = 200,
  ok = true,
  contentType = "application/json; charset=utf-8"
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => body
  };
}

function textResponse(body, {
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
    text: async () => body
  };
}

function localModelSettings() {
  return {
    modelLibraryAgents: [
      {
        provider: "local-model",
        alias: "local-route",
        model: "qwen2.5",
        baseUrl: "http://localhost:11434/v1"
      }
    ]
  };
}

describe("agent-gateway compaction and response normalization extras", () => {
  it("falls back to the external-agent config when no adapters are configured", () => {
    expect(resolveAgentGatewayConfig({}, {})).toMatchObject({
      alias: "external-agent",
      provider: "custom-http",
      url: "",
      token: ""
    });

    expect(publicAgentGatewayConfig({})).toMatchObject({
      alias: "external-agent",
      provider: "custom-http",
      urlConfigured: false,
      tokenConfigured: false
    });
  });

  it("compacts recent turns, rehydrates messages, and preserves allocation metadata", async () => {
    const allocator = {
      apply: vi.fn(async (input, meta) => ({
        input: {
          ...input,
          sessionId: "allocated-session"
        },
        allocation: {
          runtime: "shared",
          surface: meta.surface
        }
      }))
    };
    const runCompaction = vi.fn(async (input) => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "completed",
      compacted: true,
      strategy: "extractive-rewrite",
      triggerReason: "forced",
      degraded: false,
      degradedReasons: [],
      boundary: { boundaryId: "boundary-1" },
      summary: "compact-summary",
      reinjection: {
        items: [{ key: "activePlan", value: { step: "keep" } }]
      },
      messagesToKeep: [
        { role: "system", content: "kept-system" },
        { role: "assistant", content: { text: "kept-assistant" } }
      ],
      tokenReport: { savedTokens: 21 },
      input
    }));
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        JSON.stringify({
          id: "local-model-1",
          model: "qwen2.5",
          choices: [
            {
              index: 0,
              message: {
                content: "gateway answer"
              },
              finish_reason: "stop"
            }
          ]
        })
      )
    );

    const result = await callAgentGateway({
      settings: localModelSettings(),
      input: {
        provider: "local-model",
        alias: "local-route",
        query: "  当前问题  ",
        sessionId: "session-1",
        userId: "user-1",
        projectId: "project-1",
        pluginList: ["cli"],
        recentTurns: [
          { role: "assistant", content: "old assistant" },
          { role: "user", content: "old user" }
        ],
        history: "older summary",
        runtimeState: {
          activePlan: { step: "keep" },
          enabledTools: ["search"],
          operationCatalog: ["catalog"],
          userConstraints: ["constraint"]
        },
        parameters: {
          temperature: 0.15
        },
        contextCompaction: {
          force: true
        }
      },
      fetchImpl,
      contextRuntime: { runCompaction },
      clientRuntimeAllocator: allocator,
      contextCompactionSource: "unit-test"
    });

    expect(allocator.apply).toHaveBeenCalledTimes(1);
    expect(runCompaction).toHaveBeenCalledWith(expect.objectContaining({
      inputSource: "unit-test",
      sessionId: "allocated-session",
      taskBrief: "当前问题",
      force: true,
      persist: true,
      useSessionMemory: true,
      compactionPolicy: {
        recentMessageProtectionCount: 1,
        recentTurnProtectionCount: 1
      },
      messages: [
        expect.objectContaining({
          id: "gateway-history",
          role: "system",
          content: "older summary"
        }),
        expect.objectContaining({
          role: "assistant",
          content: "old assistant"
        }),
        expect.objectContaining({
          role: "user",
          content: "old user"
        }),
        expect.objectContaining({
          id: "gateway-current-question",
          role: "user",
          content: "当前问题"
        })
      ]
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "qwen2.5"
    });
    expect(requestBody.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("compact-summary")
      })
    ]);
    expect(result).toMatchObject({
      ok: true,
      answer: "gateway answer",
      clientRuntimeAllocation: {
        runtime: "shared",
        surface: "unit-test"
      },
      contextCompaction: {
        compacted: true,
        boundaryId: "boundary-1",
        strategy: "extractive-rewrite",
        tokenReport: { savedTokens: 21 }
      }
    });
  });

  it("skips compaction when disabled and still normalizes plain-text responses", async () => {
    const runCompaction = vi.fn();
    const fetchImpl = vi.fn(async () => textResponse("plain text answer"));

    const result = await callAgentGateway({
      settings: localModelSettings(),
      input: {
        provider: "local-model",
        alias: "local-route",
        messages: [{ role: "user", content: "原始消息" }],
        query: "still raw",
        skipContextCompaction: true,
        contextCompaction: {
          force: true
        }
      },
      fetchImpl,
      contextRuntime: { runCompaction }
    });

    expect(runCompaction).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody.messages).toEqual([
      {
        role: "user",
        content: "原始消息"
      }
    ]);
    expect(result).toMatchObject({
      ok: true,
      answer: "plain text answer",
      text: "plain text answer",
      finish: true
    });
    expect(result.contextCompaction).toBeUndefined();
  });

  it("normalizes custom-http JSON responses from nested data and choice tool-call branches", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        JSON.stringify({
          dialogId: "dlg-7",
          finish: false,
          toolCalls: [
            {
              id: "outer-call",
              function: {
                name: "outer",
                arguments: { q: 4 }
              }
            }
          ],
          data: {
            tool_calls: [
              {
                id: "data-top-call",
                function: {
                  name: "dataTop",
                  arguments: { q: 3 }
                }
              }
            ],
            choices: [
              {
                message: {
                  content: "data choice answer",
                  tool_calls: [
                    {
                      id: "data-call",
                      function: {
                        name: "lookup",
                        arguments: { q: 1 }
                      }
                    }
                  ],
                  function_call: {
                    name: "fallback",
                    arguments: { q: 2 }
                  }
                }
              }
            ]
          },
          choices: []
        })
      )
    );

    const result = await callAgentGateway({
      settings: {
        customHttpAdapter: {
          uid: "custom-route",
          model: "gateway-lite",
          url: "https://gateway.local/call",
          token: "token-1"
        }
      },
      input: {
        question: "ping",
        sessionId: "session-1"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      answer: "data choice answer",
      text: "data choice answer",
      dialogId: "dlg-7",
      finish: false,
      upstream: {
        status: 200,
        contentType: "application/json; charset=utf-8"
      }
    });
    expect(result.toolCalls).toEqual([
      {
        id: "outer-call",
        type: "function",
        function: {
          name: "outer",
          arguments: "{\"q\":4}"
        }
      },
      {
        id: "data-top-call",
        type: "function",
        function: {
          name: "dataTop",
          arguments: "{\"q\":3}"
        }
      },
      {
        id: "data-call",
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
          name: "fallback",
          arguments: "{\"q\":2}"
        }
      }
    ]);
  });

  it("propagates compaction runtime failures before any upstream fetch is attempted", async () => {
    const fetchImpl = vi.fn();
    const runCompaction = vi.fn(async () => {
      throw new Error("compaction failed");
    });

    await expect(
      callAgentGateway({
        settings: localModelSettings(),
        input: {
          provider: "local-model",
          alias: "local-route",
          query: "需要压缩",
          contextCompaction: {
            force: true
          }
        },
        fetchImpl,
        contextRuntime: { runCompaction }
      })
    ).rejects.toThrow("compaction failed");

    expect(runCompaction).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
