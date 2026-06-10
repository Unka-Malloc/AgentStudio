import { describe, expect, it, vi } from "vitest";

import {
  EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION,
  createExternalKnowledgeDistillationClient,
  resolveExternalKnowledgeDistillationConfig
} from "../../../server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs";

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
}

describe("external distillation service extra coverage", () => {
  it("resolves config from input, settings, and env with validation and timeout fallback", () => {
    expect(resolveExternalKnowledgeDistillationConfig({
      input: {
        baseUrl: " https://input.example.test/api/ ",
        token: "input-token",
        timeoutMs: "1200"
      },
      settings: {
        externalKnowledgeDistillation: {
          baseUrl: "https://settings.example.test",
          token: "settings-token"
        }
      },
      env: {
        PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL: "https://env.example.test",
        PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_TOKEN: "env-token"
      }
    })).toEqual({
      protocolVersion: EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION,
      baseUrl: "https://input.example.test/api",
      token: "input-token",
      timeoutMs: 1200
    });

    expect(resolveExternalKnowledgeDistillationConfig({
      input: {},
      settings: {
        externalKnowledgeDistillation: {
          endpoint: "https://settings.example.test/root/",
          apiKey: "settings-key",
          timeoutMs: "-1"
        }
      },
      env: {}
    })).toMatchObject({
      baseUrl: "https://settings.example.test/root",
      token: "settings-key",
      timeoutMs: 30000
    });

    expect(resolveExternalKnowledgeDistillationConfig({
      input: {},
      settings: {},
      env: {
        PACT_EXTERNAL_DISTILLATION_URL: "http://env.example.test",
        PACT_EXTERNAL_DISTILLATION_TOKEN: "env-token",
        PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_TIMEOUT_MS: "250"
      }
    })).toMatchObject({
      baseUrl: "http://env.example.test",
      token: "env-token",
      timeoutMs: 250
    });

    expect(() => resolveExternalKnowledgeDistillationConfig({
      input: { baseUrl: "file:///tmp/service" },
      settings: {},
      env: {}
    })).toThrow("HTTP(S) URL");
  });

  it("performs JSON requests with authorization, body filtering, query aliases, and call telemetry", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith("/v1/distillation/runs?limit=200")) {
        return jsonResponse({ runs: ["a"] });
      }
      if (url.endsWith("/v1/distillation/runs")) {
        expect(JSON.parse(init.body)).toEqual({
          projectId: "project-a",
          inputDocuments: ["doc-a"]
        });
        return jsonResponse({ runId: "run-a" });
      }
      if (url.includes("/evidence?")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("entity")).toBe("Acme");
        expect(parsed.searchParams.get("relationship")).toBe("owns");
        expect(parsed.searchParams.get("sourceId")).toBe("doc-1");
        expect(parsed.searchParams.get("limit")).toBe("10");
        return jsonResponse({ items: [{ id: "ev-1" }] });
      }
      return jsonResponse({ ok: true });
    });

    const client = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test/",
      token: "token-1",
      timeoutMs: 1000,
      fetchImpl
    });

    expect(client.protocolVersion).toBe(EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION);
    expect(client.baseUrl).toBe("https://service.example.test");

    const health = await client.health();
    expect(health).toMatchObject({
      ok: true,
      pactExternalServiceCall: {
        service: "external.knowledge.distillation",
        method: "GET",
        path: "/health",
        statusCode: 200
      }
    });

    await expect(client.capabilities()).resolves.toMatchObject({ ok: true });
    await expect(client.runtimeHealth()).resolves.toMatchObject({ ok: true });
    await expect(client.listRuns({ limit: 999 })).resolves.toMatchObject({ runs: ["a"] });
    await expect(client.createRun({
      baseUrl: "ignored",
      token: "ignored",
      timeoutMs: 1,
      projectId: "project-a",
      inputDocuments: ["doc-a"]
    })).resolves.toMatchObject({ runId: "run-a" });
    await expect(client.queryEvidence({
      runId: "run/a",
      entityQuery: "Acme",
      relationshipQuery: "owns",
      documentId: "doc-1",
      pageSize: "10"
    })).resolves.toMatchObject({ items: [{ id: "ev-1" }] });

    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall[0]).toBe("https://service.example.test/health");
    expect(firstCall[1].headers.get("accept")).toBe("application/json");
    expect(firstCall[1].headers.get("authorization")).toBe("Bearer token-1");
  });

  it("validates required ids and returns binary artifacts with decoded filenames", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/artifacts/")) {
        return new Response(Buffer.from("artifact-body"), {
          status: 200,
          headers: {
            "content-type": "text/markdown",
            "content-disposition": "attachment; filename*=UTF-8''report%20final.md"
          }
        });
      }
      return jsonResponse({ ok: true });
    });
    const client = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test",
      fetchImpl
    });

    expect(() => createExternalKnowledgeDistillationClient({ baseUrl: "" })).toThrow("未配置");
    expect(() => client.getRun()).toThrow("runId");
    expect(() => client.cancelRun({ id: "" })).toThrow("runId");
    expect(() => client.queryEvidence({})).toThrow("runId");
    expect(() => client.queryProjectEvidence({})).toThrow("projectId");
    expect(() => client.exportArtifact({})).toThrow("runId");

    await expect(client.getRun({ "run-id": "run/a" })).resolves.toMatchObject({ ok: true });
    await expect(client.cancelRun({ id: "run-a", message: "stop" })).resolves.toMatchObject({ ok: true });
    await expect(client.queryProjectEvidence({ "project-id": "project/a", claimStatus: "supported" }))
      .resolves.toMatchObject({ ok: true });

    const artifact = await client.exportArtifact({ runId: "run/a", artifact: "portable markdown" });
    expect(artifact).toMatchObject({
      contentType: "text/markdown",
      fileName: "report final.md",
      pactExternalServiceCall: {
        method: "GET",
        statusCode: 200,
        path: "/v1/distillation/runs/run%2Fa/artifacts/portable%20markdown"
      }
    });
    expect(artifact.buffer.toString("utf8")).toBe("artifact-body");
  });

  it("attaches telemetry to HTTP errors and classifies them", async () => {
    const httpClient = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test",
      fetchImpl: vi.fn(async () => jsonResponse({ error: "bad request" }, { status: 400 }))
    });

    await expect(httpClient.health()).rejects.toMatchObject({
      message: "bad request",
      statusCode: 400,
      errorCode: "KD_UPSTREAM_BAD_RESPONSE",
      payload: { error: "bad request" },
      externalServiceCall: {
        baseUrl: "https://service.example.test",
        path: "/health",
        statusCode: 400,
        contentType: "application/json"
      }
    });

    const authClient = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test",
      fetchImpl: vi.fn(async () => jsonResponse({ error: "forbidden" }, { status: 401 }))
    });

    await expect(authClient.capabilities()).rejects.toMatchObject({
      message: "forbidden",
      statusCode: 401,
      errorCode: "KD_AUTHENTICATION_ERROR",
    });

    const serverErrorClient = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test",
      fetchImpl: vi.fn(async () => jsonResponse({ error: "down" }, { status: 503 }))
    });

    await expect(serverErrorClient.health()).rejects.toMatchObject({
      errorCode: "KD_UPSTREAM_UNAVAILABLE",
    });

    const fetchError = new Error("network down");
    const networkClient = createExternalKnowledgeDistillationClient({
      baseUrl: "https://service.example.test",
      fetchImpl: vi.fn(async () => {
        throw fetchError;
      })
    });

    await expect(networkClient.listRuns({ limit: 0 })).rejects.toMatchObject({
      message: "[KD_UPSTREAM_UNAVAILABLE] network down",
      errorCode: "KD_UPSTREAM_UNAVAILABLE",
      externalServiceCall: {
        path: "/v1/distillation/runs?limit=50",
        statusCode: 0,
        error: "network down"
      }
    });
  });
});
