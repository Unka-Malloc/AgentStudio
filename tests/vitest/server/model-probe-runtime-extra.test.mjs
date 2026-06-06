import { beforeEach, describe, expect, it, vi } from "vitest";

const callAgentGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-gateway/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/index.mjs");
  return {
    ...actual,
    callAgentGateway: callAgentGatewayMock
  };
});

import { probeModelConnection } from "../../../server/platform/specialized/agent/agent-gateway/model-probe/index.mjs";
import {
  AGENT_RUNTIME_PROVIDER_PROTOCOL_VERSION,
  createAgentRuntimeProvider
} from "../../../server/platform/specialized/agent/agent-runtime-provider.mjs";

function createMockJsonResponse({
  status = 200,
  headers = { "content-type": "application/json; charset=utf-8" },
  bodyText = ""
}) {
  const normalizedHeaders = { ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => normalizedHeaders[String(key).toLowerCase()] || ""
    },
    text: async () => bodyText
  };
}

function createGatewayResult({ answer = "PactProbeOK", model = "probe-model", statusCode = 200, useChunks = false } = {}) {
  return {
    ok: true,
    upstream: { model, status: statusCode },
    ...(useChunks ? { chunks: { answer: [answer] } } : { answer })
  };
}

describe("probeModelConnection runtime behavior", () => {
  beforeEach(() => {
    callAgentGatewayMock.mockReset();
  });

  it("falls back to settings.defaultModelProvider when provider is not set", async () => {
    const fetchImpl = vi.fn(async () =>
      createMockJsonResponse({
        bodyText: JSON.stringify({
          choices: [{ message: { content: "PactProbeOK" } }]
        })
      })
    );

    const result = await probeModelConnection({
      settings: {
        defaultModelProvider: "openrouter",
        openRouterApiKey: "router-key",
        openRouterModel: "gpt-4.1-mini"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "openrouter",
      model: "gpt-4.1-mini",
      answerSnippet: "PactProbeOK"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("probes google-gemini success with response extraction", async () => {
    const result = await probeModelConnection({
      provider: "google-gemini",
      settings: {
        googleApiKey: "google-key",
        googleModel: "gemini-flash"
      },
      fetchImpl: async () =>
        createMockJsonResponse({
          bodyText: JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "思考片段" }, { text: "PactProbeOK" }]
                }
              }
            ]
          })
        })
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "google-gemini",
      model: "gemini-flash",
      statusCode: 200,
      answerSnippet: "思考片段PactProbeOK"
    });
  });

  it("marks google-gemini as unconfigured when api key missing", async () => {
    const result = await probeModelConnection({
      provider: "google-gemini",
      settings: { googleApiKey: "" }
    });

    expect(result).toMatchObject({
      ok: false,
      configured: false,
      provider: "google-gemini",
      model: "gemini-flash-lite-latest"
    });
    expect(result.message).toContain("Google API Key 未配置");
  });

  it("normalizes openrouter mixed content and normalizes chat/completions path", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (typeof url === "string") {
        expect(url.endsWith("/chat/completions")).toBe(true);
      }
      expect(JSON.parse(init.body).model).toBe("openai/gpt-4.1-mini");
      return createMockJsonResponse({
        bodyText: JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "reasoning", text: "reasoning..." },
                  { type: "text", text: "PactProbeOK" },
                  { type: "text", text: "!" }
                ]
              }
            }
          ]
        })
      });
    });

    const result = await probeModelConnection({
      provider: "openrouter",
      settings: {
        openRouterApiKey: "router-key",
        openRouterBaseUrl: "https://openrouter.example/api/v1/",
        openRouterModel: "openai/gpt-4.1-mini"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      answerSnippet: "PactProbeOK!"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts token-like material when openrouter returns failure payload", async () => {
    const result = await probeModelConnection({
      provider: "openrouter",
      settings: {
        openRouterApiKey: "router-key",
        openRouterModel: "openai/gpt-4.1-mini"
      },
      fetchImpl: async () =>
        createMockJsonResponse({
          status: 500,
          bodyText: "Bearer SECRET_OPENROUTER_TOKEN"
        })
    });

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      provider: "openrouter",
      statusCode: 500
    });
    expect(result.message).not.toContain("SECRET_OPENROUTER_TOKEN");
    expect(result.message).toContain("Bearer [REDACTED]");
  });

  it("probes openai-chatgpt with valid oauth and rejects with invalid oauth", async () => {
    const success = await probeModelConnection({
      provider: "openai-chatgpt",
      settings: { openAiModel: "gpt-5-mini" },
      getCodexOAuthStatus: async () => ({ valid: true }),
      callCodexChatGptJson: async () => ({ answer: "PactProbeOK" })
    });

    expect(success).toMatchObject({
      ok: true,
      configured: true,
      provider: "openai-chatgpt",
      model: "gpt-5-mini",
      answerSnippet: "PactProbeOK"
    });

    const failure = await probeModelConnection({
      provider: "openai-chatgpt",
      settings: { openAiModel: "gpt-5-mini" },
      getCodexOAuthStatus: async () => ({ valid: false, reason: "OAuth 未验证" })
    });

    expect(failure).toMatchObject({
      ok: false,
      configured: false,
      provider: "openai-chatgpt",
      model: "gpt-5-mini"
    });
    expect(failure.message).toContain("OAuth 未验证");
  });

  it("supports deepseek model library selection and normalizes gateway answer", async () => {
    callAgentGatewayMock.mockResolvedValue(
      createGatewayResult({ model: "deepseek-flash", answer: "PactProbeOK" })
    );

    const result = await probeModelConnection({
      provider: "deepseek",
      settings: {
        deepSeekModel: "deepseek-flash",
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-main",
            model: "deepseek-flash",
            apiKey: "deepseek-secret"
          }
        ]
      },
      modelAlias: "deepseek-main"
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "deepseek",
      model: "deepseek-flash",
      answerSnippet: "PactProbeOK"
    });
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(1);
    expect(callAgentGatewayMock.mock.calls[0][0].input.alias).toBe("deepseek-main");
    expect(callAgentGatewayMock.mock.calls[0][0].input.engine).toBe("deepseek-flash");
  });

  it("reports deepseek as unconfigured when selected entry lacks api key", async () => {
    const result = await probeModelConnection({
      provider: "deepseek",
      settings: {
        deepSeekModel: "deepseek-flash",
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-main",
            model: "deepseek-flash",
            apiKey: ""
          }
        ]
      },
      modelAlias: "deepseek-main"
    });

    expect(result).toMatchObject({
      ok: false,
      configured: false,
      provider: "deepseek",
      model: "deepseek-flash"
    });
    expect(result.message).toContain("DeepSeek API Key 未配置");
    expect(callAgentGatewayMock).not.toHaveBeenCalled();
  });

  it("supports custom-http alias lookup and chunk-style normalization", async () => {
    callAgentGatewayMock.mockResolvedValue(
      createGatewayResult({
        useChunks: true,
        model: "custom-http-model",
        answer: "PactProbeOK"
      })
    );

    const result = await probeModelConnection({
      provider: "custom-http",
      settings: {
        customHttpAdapter: {
          uid: "fallback",
          model: "fallback-model",
          url: "https://fallback.local"
        },
        customHttpAdapters: [
          {
            uid: "legacy",
            model: "legacy-model",
            url: "https://legacy.local"
          }
        ],
        modelLibraryAgents: [
          {
            provider: "custom-http",
            alias: "custom-main",
            model: "custom-http-model",
            url: "https://custom.local",
            token: "secret-token"
          }
        ]
      },
      modelAlias: "custom-main"
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "custom-http",
      model: "custom-main",
      answerSnippet: "PactProbeOK"
    });
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(1);
    expect(callAgentGatewayMock.mock.calls[0][0].input.alias).toBe("custom-main");
  });

  it("reports copilot timeout as fetch error when request is aborted", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      setTimeoutSpy.mockImplementation((handler) => {
        queueMicrotask(() => handler());
        return 1;
      });
      clearTimeoutSpy.mockImplementation(() => undefined);

      const fetchImpl = vi.fn(async (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new Error("AbortError"));
          });
        })
      );

      const probe = probeModelConnection({
        provider: "copilot",
        settings: {
          copilotEndpoint: "https://copilot.example/api",
          copilotModel: "copilot-mini"
        },
        fetchImpl
      });
      await expect(probe).rejects.toThrow("AbortError");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("reports local-model as unconfigured when endpoint missing", async () => {
    const result = await probeModelConnection({ provider: "local-model", settings: {} });

    expect(result).toMatchObject({
      ok: false,
      configured: false,
      provider: "local-model",
      model: "local-default"
    });
    expect(result.message).toContain("本地模型 Endpoint 未配置");
  });

  it("returns configured false for unsupported provider", async () => {
    const result = await probeModelConnection({ provider: "alien-ai", settings: {} });

    expect(result).toMatchObject({
      ok: false,
      configured: false,
      provider: "alien-ai",
      statusCode: 0
    });
    expect(result.message).toContain("不支持的模型类型");
  });

  it("exposes model-probe capability in runtime provider describe and delegates probes", async () => {
    const runtimeProvider = createAgentRuntimeProvider({
      getAgentConfigRegistry: () => ({
        refresh: vi.fn(),
        getModelLibraryAgents: () => [],
        getModelLibraryEntries: () => []
      }),
      loadAgentGatewayModule: async () => ({}),
      loadModelProbeModule: async () => ({ probeModelConnection })
    });
    const description = runtimeProvider.describe();

    expect(description).toMatchObject({
      schemaVersion: 1,
      protocolVersion: AGENT_RUNTIME_PROVIDER_PROTOCOL_VERSION
    });
    expect(description.capabilities).toEqual(expect.arrayContaining(["agent.model.probe"]));

    const result = await runtimeProvider.probeModelConnection({
      provider: "openrouter",
      settings: {
        openRouterApiKey: "router-key",
        openRouterModel: "gpt-4.1-mini"
      },
      fetchImpl: async () =>
        createMockJsonResponse({
          bodyText: JSON.stringify({
            choices: [{ message: { content: "PactProbeOK" } }]
          })
        })
    });

    expect(result.provider).toBe("openrouter");
  });
});
