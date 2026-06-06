import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callAgentGateway,
  inspectAgentModelRouting,
  publicAgentGatewayConfig,
  publicAgentGatewayRegistry,
  resolveAgentGatewayConfig,
  resolveAgentGatewayRegistry
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";
import { probeModelConnection } from "../../../server/platform/specialized/agent/agent-gateway/model-probe/index.mjs";
import { MODEL_ROUTING_PROTOCOL_VERSION } from "../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs";

function jsonHeaders(contentType = "application/json") {
  return {
    get(name) {
      return String(name || "").toLowerCase() === "content-type" ? contentType : "";
    }
  };
}

function makeResponse({
  ok = true,
  status = 200,
  body = "{}",
  contentType = "application/json"
} = {}) {
  return {
    ok,
    status,
    headers: jsonHeaders(contentType),
    async text() {
      return body;
    }
  };
}

function abortError(message = "The operation was aborted.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-gateway-routing-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent gateway routing final extra coverage", () => {
  it("normalizes model library entries for the supported provider families", () => {
    const settings = {
      customHttpAdapter: {
        uid: " custom-main ",
        url: " https://custom.example/v1 ",
        token: " custom-token ",
        model: " custom-engine ",
        label: " Custom Gateway "
      },
      deepSeekBaseUrl: " https://api.deepseek.example ",
      deepSeekModel: " deepseek-chat ",
      deepSeekApiKey: " deepseek-key ",
      localModelEndpoint: " http://localhost:11434 ",
      openRouterBaseUrl: " https://openrouter.ai/api/v1 ",
      openRouterApiKey: " openrouter-key ",
      copilotEndpoint: " https://copilot.example ",
      copilotApiKey: " copilot-key ",
      modelLibraryAgents: [
        {
          uid: " custom-main ",
          provider: "custom-http",
          url: " https://custom.example/v1 ",
          token: " custom-token ",
          model: " custom-engine ",
          label: " Custom Gateway "
        },
        {
          uid: " deepseek-main ",
          provider: "deepseek",
          label: " DeepSeek Main "
        },
        {
          uid: " openrouter-main ",
          provider: "openrouter",
          model: " openai/gpt-4.1-mini "
        },
        {
          uid: " copilot-main ",
          provider: "copilot",
          model: " copilot-default "
        },
        {
          uid: " local-main ",
          provider: "local-model",
          model: " local-qwen "
        }
      ]
    };

    const registry = resolveAgentGatewayRegistry(settings);
    expect(registry.map((entry) => entry.provider)).toEqual([
      "custom-http",
      "deepseek",
      "openrouter",
      "copilot",
      "local-model"
    ]);
    expect(registry[0]).toMatchObject({
      alias: "custom-main",
      provider: "custom-http",
      label: "Custom Gateway",
      url: "https://custom.example/v1",
      token: "custom-token",
      engine: "custom-engine"
    });
    expect(registry[1]).toMatchObject({
      alias: "deepseek-main",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.example",
      model: "",
      token: "deepseek-key"
    });
    expect(registry[2]).toMatchObject({
      alias: "openrouter-main",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      url: "https://openrouter.ai/api/v1/chat/completions",
      token: "openrouter-key"
    });
    expect(registry[3]).toMatchObject({
      alias: "copilot-main",
      provider: "copilot",
      baseUrl: "https://copilot.example",
      url: "https://copilot.example/chat/completions",
      token: "copilot-key"
    });
    expect(registry[4]).toMatchObject({
      alias: "local-main",
      provider: "local-model",
      baseUrl: "http://localhost:11434",
      url: "http://localhost:11434/chat/completions",
      token: ""
    });

    const publicRegistry = publicAgentGatewayRegistry(settings);
    expect(publicRegistry).toMatchObject({
      provider: "agent-gateway",
      schemaVersion: 1,
      defaultAlias: "custom-main"
    });
    expect(publicRegistry.agents).toHaveLength(5);
    expect(publicRegistry.agents[2]).toMatchObject({
      provider: "openrouter",
      alias: "openrouter-main",
      urlConfigured: true,
      tokenConfigured: true,
      callMode: "server-proxy",
      serverHttpPath: "/api/agent-gateway/call"
    });

    expect(resolveAgentGatewayConfig(settings, { provider: "local-model" })).toMatchObject({
      provider: "local-model",
      alias: "local-main",
      url: "http://localhost:11434/chat/completions",
      engine: "local-qwen"
    });
    expect(resolveAgentGatewayConfig(settings, { provider: "deepseek" })).toMatchObject({
      provider: "deepseek",
      alias: "deepseek-main",
      model: "",
      url: "https://api.deepseek.example/chat/completions"
    });
    expect(publicAgentGatewayConfig(settings)).toMatchObject({
      provider: "custom-http",
      alias: "custom-main",
      token: ""
    });
  });

  it("returns configured-false probe results when provider configuration is missing", async () => {
    await expect(
      probeModelConnection({ provider: "custom-http", settings: {}, fetchImpl: vi.fn() })
    ).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: "custom-http",
      message: "自定义 HTTP Adapter URL 未配置。"
    });

    await expect(
      probeModelConnection({ provider: "local-model", settings: {}, fetchImpl: vi.fn() })
    ).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: "local-model",
      message: "本地模型 Endpoint 未配置。"
    });

    await expect(
      probeModelConnection({
        provider: "deepseek",
        settings: { deepSeekModel: "deepseek-chat" },
        fetchImpl: vi.fn()
      })
    ).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: "deepseek",
      message: "DeepSeek API Key 未配置。"
    });

    await expect(
      probeModelConnection({
        provider: "openrouter",
        settings: { openRouterBaseUrl: "https://openrouter.ai/api/v1", openRouterModel: "openai/gpt-4.1-mini" },
        fetchImpl: vi.fn()
      })
    ).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: "openrouter",
      message: "OpenRouter API Key 未配置。"
    });

    await expect(
      probeModelConnection({ provider: "copilot", settings: {}, fetchImpl: vi.fn() })
    ).resolves.toMatchObject({
      ok: false,
      configured: false,
      provider: "copilot",
      message: "Copilot / 企业代理 Endpoint 未配置。"
    });
  });

  it("covers probe success, failure, timeout, and plain-text responses", async () => {
    const successFetch = vi.fn(async () =>
      makeResponse({
        ok: true,
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: "PactProbeOK" } }]
        })
      })
    );
    await expect(
      probeModelConnection({
        provider: "local-model",
        settings: { localModelEndpoint: "https://local.example", localModelName: "local-qwen" },
        fetchImpl: successFetch
      })
    ).resolves.toMatchObject({
      ok: true,
      provider: "local-model",
      model: "local-qwen",
      statusCode: 200,
      answerSnippet: "PactProbeOK"
    });
    expect(successFetch).toHaveBeenCalledTimes(1);

    const failureFetch = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 503,
        body: "upstream says no",
        contentType: "text/plain"
      })
    );
    await expect(
      probeModelConnection({
        provider: "openrouter",
        settings: {
          openRouterBaseUrl: "https://openrouter.ai/api/v1",
          openRouterApiKey: "openrouter-key",
          openRouterModel: "openai/gpt-4.1-mini"
        },
        fetchImpl: failureFetch
      })
    ).resolves.toMatchObject({
      ok: false,
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      statusCode: 503,
      message: "upstream says no"
    });

    const plainTextFetch = vi.fn(async () =>
      makeResponse({
        ok: true,
        status: 200,
        body: "PactProbeOK",
        contentType: "text/plain"
      })
    );
    await expect(
      probeModelConnection({
        provider: "openrouter",
        settings: {
          openRouterBaseUrl: "https://openrouter.ai/api/v1",
          openRouterApiKey: "openrouter-key",
          openRouterModel: "openai/gpt-4.1-mini"
        },
        fetchImpl: plainTextFetch
      })
    ).resolves.toMatchObject({
      ok: true,
      provider: "openrouter",
      statusCode: 200,
      answerSnippet: "PactProbeOK"
    });

    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url, { signal } = {}) => new Promise((_, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    }));
    const timeoutPromise = probeModelConnection({
      provider: "local-model",
      settings: { localModelEndpoint: "https://local.example", localModelName: "local-qwen" },
      fetchImpl: timeoutFetch
    });
    void timeoutPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(timeoutPromise).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("returns a routing health summary from the on-disk model routing state", async () => {
    await withTempDir(async (userDataPath) => {
      await fs.mkdir(path.join(userDataPath, "state"), { recursive: true });
      await fs.mkdir(path.join(userDataPath, "logs"), { recursive: true });
      await fs.writeFile(
        path.join(userDataPath, "state", "model-routing-state.json"),
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: MODEL_ROUTING_PROTOCOL_VERSION,
          updatedAt: "2026-06-05T00:00:00.000Z",
          circuits: {
            alpha: {
              state: "closed",
              failureCount: 0,
              lastSuccessAt: "2026-06-05T00:00:00.000Z"
            },
            beta: {
              state: "open",
              failureCount: 3,
              openUntil: "2099-01-01T00:00:00.000Z",
              lastError: "boom"
            }
          }
        }, null, 2)
      );
      await fs.writeFile(
        path.join(userDataPath, "logs", "model-routing-ledger.jsonl"),
        [
          JSON.stringify({
            status: "success",
            alias: "alpha",
            actualEstimatedUsd: 0.12
          }),
          JSON.stringify({
            status: "failed",
            alias: "beta",
            actualEstimatedUsd: 0.03
          }),
          JSON.stringify({
            status: "skipped",
            alias: "beta",
            actualEstimatedUsd: 0
          })
        ].join("\n") + "\n",
        "utf8"
      );

      const summary = await inspectAgentModelRouting({ userDataPath, limit: 2 });
      expect(summary).toMatchObject({
        schemaVersion: 1,
        protocolVersion: MODEL_ROUTING_PROTOCOL_VERSION,
        statePath: "state/model-routing-state.json",
        ledgerPath: "logs/model-routing-ledger.jsonl"
      });
      expect(summary.state.circuits.alpha.state).toBe("closed");
      expect(summary.state.circuits.beta.state).toBe("open");
      expect(summary.ledgerSummary).toMatchObject({
        total: 2,
        byStatus: {
          failed: 1,
          skipped: 1
        },
        byAlias: {
          beta: 2
        }
      });
      expect(summary.ledgerSummary.estimatedUsdTotal).toBeCloseTo(0.03, 8);
      expect(summary.recentLedger).toHaveLength(2);
    });
  });

  it("rejects unknown agents, bad payloads, and provider errors in gateway calls", async () => {
    await expect(
      callAgentGateway({
        settings: {},
        input: {
          alias: "missing-agent",
          question: "hello"
        },
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow("智能体 URL 未配置：missing-agent");

    await expect(
      callAgentGateway({
        settings: {
          localModelEndpoint: "https://local.example",
          localModelName: "local-qwen"
        },
        input: {
          provider: "local-model",
          alias: "local-model",
          question: ""
        },
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow("question 不能为空。");

    await expect(
      callAgentGateway({
        settings: {
          localModelEndpoint: "https://local.example",
          localModelName: "local-qwen"
        },
        input: {
          provider: "local-model",
          alias: "local-model",
          question: "hello"
        },
        fetchImpl: vi.fn(async () =>
          makeResponse({
            ok: false,
            status: 502,
            body: "upstream says no",
            contentType: "text/plain"
          })
        )
      })
    ).rejects.toThrow("Local Model 调用失败：502 upstream says no");
  });
});
