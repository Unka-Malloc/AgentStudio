import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compositionPresetFromExternalServiceConfig,
  externalServicePathRefs,
  loadExternalServiceConfig,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig,
  writeExternalServiceArtifacts
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import {
  createExternalMcpPassthroughRuntime,
  discoverExternalMcpTools,
  externalMcpToolCachePath,
  parseExplicitHttpUrl,
  refreshExternalMcpToolCache
} from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createResponse({ ok = true, status = 200, body = "", headers = {} } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || null;
      }
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("composition MCP extras", () => {
  it("normalizes, validates, and packages an external MCP composition", async () => {
    const cwd = await tempDir("pact-composition-mcp-cwd-");
    const sourceRoot = await tempDir("pact-composition-mcp-source-");
    const outputRoot = await tempDir("pact-composition-mcp-output-");

    await writeText(path.join(cwd, "scripts", "prepare.sh"), "#!/bin/sh\nexit 0\n");
    await writeText(path.join(cwd, "scripts", "start.sh"), "#!/bin/sh\nexit 0\n");
    await writeText(path.join(cwd, "service-root", "README.md"), "service root\n");

    const rawConfig = {
      serviceId: "mcp-gateway",
      serviceName: "MCP Gateway",
      displayName: "MCP Gateway",
      mode: "connected",
      startupPolicy: "external-only",
      policyPreset: "servicehub.development-local",
      scripts: {
        prepare: { path: "scripts/prepare.sh" },
        start: { path: "scripts/start.sh" }
      },
      scriptRoots: ["service-root"],
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.serviceHub"
      }
    };

    const config = normalizeExternalServiceConfig(rawConfig);
    expect(externalServicePathRefs(config)).toEqual([
      "scripts/prepare.sh",
      "scripts/start.sh",
      "service-root"
    ]);

    const validation = await validateExternalServiceConfig({ config, cwd });
    expect(validation).toMatchObject({
      ok: true,
      errors: [],
      warnings: []
    });

    const preset = compositionPresetFromExternalServiceConfig(config, {
      filePath: path.join(cwd, "external-service.json"),
      outputRoot
    });
    expect(preset).toMatchObject({
      kind: "pact.composition.preset",
      presetId: "mcp-gateway",
      deploymentTarget: {
        applicationId: "mcp-gateway",
        outputRoot
      },
      startupComposition: {
        enabled: true,
        fallbackPolicy: "external-endpoint-required"
      }
    });

    const artifactResult = await writeExternalServiceArtifacts({
      config,
      sourceRoot,
      outputRoot,
      cwd
    });

    expect(artifactResult).toMatchObject({
      ok: true,
      serviceId: "mcp-gateway",
      copiedPaths: [
        {
          id: "prepare",
          packagedPath: "composition/external-service-scripts/1-prepare.sh"
        },
        {
          id: "start",
          packagedPath: "composition/external-service-scripts/2-start.sh"
        }
      ],
      copiedRoots: [
        {
          packagedPath: "composition/external-service-scripts/root-1-service-root"
        }
      ]
    });

    const packagedConfig = JSON.parse(await fs.readFile(artifactResult.sourceConfigPath, "utf8"));
    expect(packagedConfig.scripts.prepare.path).toBe("composition/external-service-scripts/1-prepare.sh");
    expect(packagedConfig.scripts.start.path).toBe("composition/external-service-scripts/2-start.sh");
    expect(packagedConfig.scriptRoots).toEqual(["composition/external-service-scripts/root-1-service-root"]);

    await expect(fs.readFile(path.join(sourceRoot, "composition", "EXTERNAL_SERVICE.md"), "utf8"))
      .resolves.toContain("MCP Gateway");
    await expect(fs.readFile(path.join(outputRoot, "external-service.config.json"), "utf8"))
      .resolves.toContain("mcp-gateway");
  });

  it("rejects malformed composition inputs and skips no-op branches", async () => {
    const cwd = await tempDir("pact-composition-mcp-invalid-");
    const brokenConfigPath = path.join(cwd, "broken.json");
    await writeText(brokenConfigPath, "{");

    expect(normalizeExternalServiceConfig(["not", "a", "config"])).toBeNull();
    expect(() => parseExplicitHttpUrl("http://127.0.0.1/mcp", "upstream.url"))
      .toThrow("explicit port");
    expect(() => parseExplicitHttpUrl("ftp://127.0.0.1:8787/mcp", "upstream.url"))
      .toThrow("must use http or https");

    await expect(loadExternalServiceConfig(brokenConfigPath)).rejects.toBeInstanceOf(SyntaxError);

    const config = {
      kind: "wrong.kind",
      serviceId: "",
      serviceName: "",
      startupPolicy: "external-only",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "https://127.0.0.1/mcp"
      },
      binding: {
        mode: "bogus",
        outlet: "not-an-outlet",
        risk: "wild"
      }
    };

    const validation = await validateExternalServiceConfig({
      config,
      cwd,
      requireKnownPaths: false
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      "External service config kind must be pact.external-service.config.",
      "External service config is missing serviceId.",
      "External service config is missing serviceName.",
      "upstream.url must include an explicit port, for example http://127.0.0.1:8787/mcp.",
      "External service binding mode is not supported: bogus.",
      "External service binding outlet is not supported: not-an-outlet.",
      "External service binding risk is not supported: wild."
    ]));

    await expect(writeExternalServiceArtifacts({ config: null, sourceRoot: cwd }))
      .resolves.toBeNull();

    await expect(refreshExternalMcpToolCache({
      userDataPath: cwd,
      config: {
        serviceId: "ignored",
        upstream: { type: "mcp" },
        binding: { mode: "compile" }
      }
    })).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "not_external_tool_service"
    });

    await expect(discoverExternalMcpTools({
      serviceId: "ignored",
      upstream: { type: "mcp" },
      binding: { mode: "compile" }
    })).resolves.toMatchObject({
      ok: false,
      error: "Config is not an MCP passthrough external service."
    });
  });

  it("discovers MCP tools, refreshes the cache, converts call errors, and aborts on timeout", async () => {
    const userDataPath = await tempDir("pact-composition-mcp-runtime-");
    const serviceConfig = normalizeExternalServiceConfig({
      serviceId: "mcp-service",
      serviceName: "MCP Service",
      displayName: "MCP Service",
      policyPreset: "servicehub.development-local",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.serviceHub"
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: { tools: true } },
          headers: { "mcp-session-id": "session-123" }
        },
        headers: { "mcp-session-id": "session-123" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: "",
        headers: {}
      }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-tools-list",
          result: {
            tools: [{
              name: "  ping.tool  ",
              title: "  Ping Tool  ",
              description: "  Echo the input  ",
              input_schema: { type: "object", properties: { ok: { type: "boolean" } } }
            }]
          }
        }
      }));

    const discovery = await discoverExternalMcpTools(serviceConfig);
    expect(discovery).toMatchObject({
      ok: true,
      serviceId: "mcp-service",
      protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
      tools: [{
        name: "ping.tool",
        title: "Ping Tool",
        description: "Echo the input",
        inputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
      }],
      toolCount: 1
    });

    const refresh = await refreshExternalMcpToolCache({
      userDataPath,
      config: serviceConfig,
      discovery
    });
    expect(refresh).toMatchObject({
      ok: true,
      cachePath: externalMcpToolCachePath(userDataPath),
      serviceId: "mcp-service",
      toolCount: 1,
      activeToolCount: 0,
      candidateToolCount: 1,
      tools: ["ping.tool"]
    });

    const cache = JSON.parse(await fs.readFile(refresh.cachePath, "utf8"));
    expect(cache.kind).toBe("pact.external-mcp.tool-cache");
    expect(cache.services["mcp-service"].tools).toHaveLength(1);
    expect(cache.services["mcp-service"].adoption).toMatchObject({
      state: "candidate"
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    expect(runtime.listVirtualOperationsSync()).toEqual([]);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: { tools: true } },
          headers: { "mcp-session-id": "session-call" }
        },
        headers: { "mcp-session-id": "session-call" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: "",
        headers: {}
      }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-call",
          result: {
            ok: true,
            echoed: "hello"
          }
        }
      }));

    const result = await runtime.callTool({
      serviceId: "mcp-service",
      toolName: "ping.tool",
      input: {
        message: "hello"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      serviceId: "mcp-service",
      upstreamToolName: "ping.tool",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      result: {
        ok: true,
        echoed: "hello"
      }
    });
    expect(result.durationMs).toEqual(expect.any(Number));

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: { tools: true } },
          headers: { "mcp-session-id": "session-fail" }
        },
        headers: { "mcp-session-id": "session-fail" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: "",
        headers: {}
      }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-tools-list",
          error: {
            code: -32001,
            message: "upstream exploded"
          }
        }
      }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-error",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.serviceHub"
      }
    })).rejects.toMatchObject({
      message: "upstream exploded",
      code: -32001,
      payload: {
        code: -32001,
        message: "upstream exploded"
      }
    });

    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: "pact.external-mcp.tool-cache",
      updatedAt: "2026-06-05T00:00:00.000Z",
      services: {
        "http-service": {
          serviceId: "http-service",
          serviceName: "HTTP Service",
          displayName: "HTTP Service",
          upstream: {
            type: "openapi",
            baseUrl: "http://127.0.0.1:8787/api"
          },
          binding: {
            mode: "compile",
            outlet: "pact.serviceHub"
          },
          tools: [{
            name: "call_item",
            transport: {
              type: "http",
              method: "POST",
              url: "http://127.0.0.1:8787/api",
              path: "/items/{id}"
            },
            request: {
              body: {
                id: "$input.id"
              }
            },
            response: {
              resultPath: "result.value"
            }
          }]
        }
      }
    });

    const httpRuntime = createExternalMcpPassthroughRuntime({ userDataPath });
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 502,
      body: {
        error: "bad gateway"
      },
      headers: { "content-type": "application/json" }
    }));

    await expect(httpRuntime.callTool({
      serviceId: "http-service",
      toolName: "call_item",
      input: { id: "alpha" }
    })).rejects.toMatchObject({
      message: "External HTTP tool call_item returned HTTP 502.",
      statusCode: 502,
      payload: {
        error: "bad gateway"
      }
    });

    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((url, init = {}) => new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("Aborted"));
      });
    }));

    const timeoutCall = httpRuntime.callTool({
      serviceId: "http-service",
      toolName: "call_item",
      input: { id: "beta" },
      timeoutMs: 1
    });
    void timeoutCall.catch(() => null);
    await vi.advanceTimersByTimeAsync(5);
    await expect(timeoutCall).rejects.toThrow("Aborted");
  });
});
