import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SERVICE_MODEL_PROTOCOL,
  EXTERNAL_SERVICE_UPSTREAM_TYPE,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";

describe("external service adapter final extra coverage", () => {
  it("normalizes model providers and protocol aliases from common endpoint URLs", () => {
    const cases = [
      ["https://api.openai.com/v1/responses", "openai", EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES],
      ["https://api.anthropic.com/v1/messages", "anthropic", EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES],
      ["https://generativelanguage.googleapis.com/v1/models/gemini:generateContent", "google", EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT],
      ["https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/l/publishers/google/models/gemini:predict", "google-vertex", EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION],
      ["https://bedrock-runtime.us-east-1.amazonaws.com/model/x/converse", "aws-bedrock", EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE],
      ["https://api.cohere.com/v2/chat", "cohere", EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT],
      ["http://127.0.0.1:11434/api/chat", "", EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE],
      ["https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", "dashscope", EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE],
      ["https://api-inference.huggingface.co/models/demo", "huggingface", EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI],
      ["https://demo.services.ai.azure.com/models/chat/completions", "azure-ai", EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE]
    ];

    for (const [url, provider, modelProtocol] of cases) {
      expect(normalizeExternalServiceConfig({
        serviceId: `model-${modelProtocol}`,
        serviceName: `Model ${modelProtocol}`,
        upstream: {
          type: "llm",
          url
        }
      }).upstream).toMatchObject({
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
        provider,
        modelProtocol
      });
    }

    expect(normalizeExternalServiceConfig({
      serviceId: "custom-protocol",
      serviceName: "Custom",
      upstream: {
        type: "llm",
        protocol: "json-http",
        url: "https://custom.example/v1"
      }
    }).upstream.modelProtocol).toBe(EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP);
  });

  it("normalizes explicit model protocol aliases without relying on endpoint inference", () => {
    const cases = [
      ["openai-chat", EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE],
      ["responses", EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES],
      ["claude", EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES],
      ["generate-content", EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT],
      ["aws-bedrock", EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE],
      ["cohere", EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT],
      ["ollama", EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE],
      ["qwen-dashscope", EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE],
      ["text-generation-inference", EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI],
      ["azure-model-inference", EXTERNAL_SERVICE_MODEL_PROTOCOL.AZURE_AI_INFERENCE],
      ["vertex-ai", EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION],
      ["custom", EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP]
    ];

    for (const [protocol, expected] of cases) {
      expect(normalizeExternalServiceConfig({
        serviceId: `explicit-${protocol}`,
        serviceName: `Explicit ${protocol}`,
        upstream: {
          modelProtocol: protocol,
          provider: " Example Provider "
        }
      }).upstream).toMatchObject({
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
        provider: "example-provider",
        modelProtocol: expected
      });
    }

    expect(normalizeExternalServiceConfig({
      serviceId: "plain-http",
      serviceName: "Plain HTTP",
      upstream: {
        type: "http",
        url: "https://example.test"
      },
      binding: "not-an-object"
    })).toMatchObject({
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP
      },
      binding: null
    });
  });

  it("validates OpenAPI, RPC endpoint references, and custom model protocol warnings", async () => {
    const openapi = normalizeExternalServiceConfig({
      serviceId: "openapi",
      serviceName: "OpenAPI",
      upstream: {
        type: "openapi"
      }
    });
    await expect(validateExternalServiceConfig({ config: openapi, requireKnownPaths: false }))
      .resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          "External OpenAPI upstream requires upstream.baseUrl or upstream.url.",
          "External OpenAPI upstream requires upstream.spec, upstream.specUrl, or upstream.specFile."
        ])
      });

    const rpc = normalizeExternalServiceConfig({
      serviceId: "rpc",
      serviceName: "RPC",
      upstream: {
        type: "rpc",
        baseUrl: "https://rpc.example/root",
        endpoints: [
          { name: "primary", baseUrl: "https://rpc.example/primary" },
          { id: "secondary", path: "/secondary" },
          "ignored"
        ]
      },
      tools: [
        { operationId: "rpc.primary", rpc: { endpointRef: "primary", method: "call" } },
        { operationId: "rpc.secondary", rpc: { endpointRef: "secondary", method: "call" } },
        { operationId: "rpc.missing", rpc: { endpointRef: "missing", method: "call" } }
      ]
    });
    const rpcValidation = await validateExternalServiceConfig({ config: rpc, requireKnownPaths: false });
    expect(rpc.upstream.endpoints).toMatchObject([
      { name: "primary" },
      { id: "secondary" },
      {}
    ]);
    expect(rpcValidation.errors).toContain("External RPC tool rpc.missing references unknown endpointRef: missing.");

    const customModel = normalizeExternalServiceConfig({
      serviceId: "model",
      serviceName: "Model",
      upstream: {
        type: "llm",
        modelProtocol: "bespoke-protocol",
        url: "https://model.example"
      }
    });
    await expect(validateExternalServiceConfig({ config: customModel, requireKnownPaths: false }))
      .resolves.toMatchObject({
        warnings: expect.arrayContaining([
          "External LLM service modelProtocol is custom: bespoke-protocol."
        ])
      });
  });

  it("validates cloud-drive aliases, missing package paths, binding enums, and health checks", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-service-adapter-"));
    try {
      const cloudDrive = normalizeExternalServiceConfig({
        serviceId: "drive-service",
        serviceName: "Drive Service",
        scripts: {
          start: { path: "missing/start.mjs" }
        },
        scriptRoots: ["missing-root"],
        upstream: {
          type: "cloud-drive",
          provider: "one-drive",
          providers: ["google", "icloud-drive"],
          mode: "remote",
          endpointUrl: "https://drive.example/gateway",
          secretRef: "plain-secret-ref"
        },
        health: {
          type: "http"
        }
      });

      expect(cloudDrive.upstream).toMatchObject({
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.CLOUD_DRIVE,
        provider: "onedrive",
        providers: ["google-drive", "icloud", "onedrive"],
        mode: "remote-live"
      });

      const validation = await validateExternalServiceConfig({
        config: cloudDrive,
        cwd,
        requireKnownPaths: true
      });
      expect(validation.ok).toBe(false);
      expect(validation.errors).toEqual(expect.arrayContaining([
        "External cloud-drive OAuth provider secret must use a secret:// secretRef.",
        "External service references missing path missing/start.mjs.",
        "External service references missing path missing-root."
      ]));
      expect(validation.warnings).toContain("External service HTTP health check has no url or port.");
      expect(validation.missingPaths).toEqual(expect.arrayContaining(["missing/start.mjs", "missing-root"]));

      const invalidEnums = {
        ...cloudDrive,
        binding: {
          mode: "invalid-mode",
          outlet: "invalid-outlet",
          risk: "invalid-risk"
        },
        healthCheck: {
          type: "invalid-health"
        }
      };
      await expect(validateExternalServiceConfig({
        config: invalidEnums,
        cwd,
        requireKnownPaths: false
      })).resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          "External service binding mode is not supported: invalid-mode.",
          "External service binding outlet is not supported: invalid-outlet.",
          "External service binding risk is not supported: invalid-risk.",
          "External service health check type is not supported: invalid-health."
        ])
      });

      const aggregateCloud = normalizeExternalServiceConfig({
        serviceId: "aggregate-drive",
        serviceName: "Aggregate Drive",
        upstream: {
          type: "cloud-drive",
          mode: "remote-live",
          endpointUrl: "https://drive.example/root"
        }
      });
      await expect(validateExternalServiceConfig({
        config: aggregateCloud,
        cwd,
        requireKnownPaths: false
      })).resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          "upstream.endpointUrl must include an explicit port, for example http://127.0.0.1:8787/mcp."
        ]),
        warnings: expect.arrayContaining([
          "External cloud-drive upstream does not declare provider; Pact will treat it as a gateway aggregate."
        ])
      });

      const rpcWithoutPath = normalizeExternalServiceConfig({
        serviceId: "rpc-without-path",
        serviceName: "RPC Without Path",
        upstream: {
          type: "rpc",
          baseUrl: "https://rpc.example",
          endpoints: {
            primary: "https://rpc.example"
          }
        },
        tools: [
          { name: "callPrimary", rpc: { endpointRef: "primary", method: "call" } }
        ]
      });
      await expect(validateExternalServiceConfig({
        config: rpcWithoutPath,
        cwd,
        requireKnownPaths: false
      })).resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          "External RPC tool call requires an explicit RPC endpoint path in tools[].rpc.url, tools[].rpc.path, tools[].rpc.endpointRef, upstream.url, upstream.path, or upstream.rpcPath."
        ])
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
