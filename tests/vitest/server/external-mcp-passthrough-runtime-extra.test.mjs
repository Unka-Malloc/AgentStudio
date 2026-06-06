import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
  EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT,
  EXTERNAL_MCP_CACHE_KIND,
  EXTERNAL_MCP_PROTOCOL_VERSION,
  EXTERNAL_MCP_VIRTUAL_OPERATION_ASPECT,
  createExternalMcpPassthroughRuntime,
  describeExternalMcpToolCacheSync,
  discoverExternalHttpTools,
  discoverExternalMcpTools,
  externalMcpToolCachePath,
  isExternalHttpCompileConfig,
  isExternalMcpPassthroughConfig,
  parseExplicitHttpUrl,
  refreshExternalMcpToolCache,
} from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

describe("external mcp passthrough runtime", () => {
  it("validates explicit http URLs and config guards", () => {
    expect(parseExplicitHttpUrl("http://127.0.0.1:8787/mcp", "upstream.url")).toMatchObject({
      url: "http://127.0.0.1:8787/mcp",
      explicitPort: "8787"
    });

    expect(() => parseExplicitHttpUrl("https://127.0.0.1/mcp", "upstream.url"))
      .toThrow("explicit port");
    expect(() => parseExplicitHttpUrl("ftp://127.0.0.1:8787/mcp", "upstream.url"))
      .toThrow("must use http or https");
    expect(() => parseExplicitHttpUrl("http://127.0.0.1:0/mcp", "upstream.url"))
      .toThrow("between 1 and 65535");

    expect(isExternalMcpPassthroughConfig({
      upstream: { type: "mcp" },
      binding: { mode: "passthrough" }
    })).toBe(true);
    expect(isExternalMcpPassthroughConfig({
      upstream: { type: "mcp" },
      binding: { mode: "compile" }
    })).toBe(false);

    expect(isExternalHttpCompileConfig({
      upstream: { type: "openapi", spec: { openapi: "3.0.0", paths: {} } },
      binding: { mode: "compile" },
      tools: []
    })).toBe(true);
    expect(isExternalHttpCompileConfig({
      upstream: { type: "mcp" },
      binding: { mode: "passthrough" },
      tools: [{}]
    })).toBe(false);
  });

  it("discovers and normalizes mcp tools over a mocked json-rpc session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: { tools: true } }
        },
        headers: { "mcp-session-id": "session-123" }
      }))
      .mockResolvedValueOnce(createResponse({ body: "", headers: {} }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-tools-list",
          result: {
            tools: [{
              name: "  ping.tool  ",
              title: "  Ping Tool  ",
              description: "  Echo the input  ",
              input_schema: { type: "object", properties: { ok: { type: "boolean" } } },
              annotations: { stable: true }
            }]
          }
        }
      }));

    const discovery = await discoverExternalMcpTools({
      serviceId: "mcp-service",
      serviceName: "MCP Service",
      displayName: "MCP Display",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub"
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(discovery).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_MCP_PROTOCOL_VERSION,
      serviceId: "mcp-service",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub"
      },
      tools: [{
        name: "ping.tool",
        title: "Ping Tool",
        description: "Echo the input",
        inputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
        annotations: { stable: true }
      }],
      toolCount: 1
    });

    expect(discovery.fingerprint).toEqual(expect.any(String));
  });

  it("surfaces json-rpc upstream errors during discovery", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: {} }
        },
        headers: { "mcp-session-id": "session-err" }
      }))
      .mockResolvedValueOnce(createResponse({ body: "", headers: {} }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-tools-list",
          error: { code: -32001, message: "upstream exploded" }
        }
      }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-error",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: { mode: "passthrough" }
    })).rejects.toMatchObject({
      message: "upstream exploded",
      code: -32001,
      payload: { code: -32001, message: "upstream exploded" }
    });
  });

  it("compiles openapi tools, persists the cache, and exposes describe/list views", async () => {
    const userDataPath = await tempDir("pact-external-mcp-cache-");
    const config = {
      serviceId: "http-service",
      serviceName: "HTTP Service",
      displayName: "HTTP Display",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api",
        spec: {
          openapi: "3.0.0",
          paths: {
            "/items/{id}": {
              parameters: [{ name: "tenant", in: "header", schema: { type: "string" } }],
              get: {
                operationId: "get item",
                summary: "Get item",
                parameters: [
                  { name: "id", in: "path", required: true, schema: { type: "string" } },
                  { name: "verbose", in: "query", schema: { type: "boolean" } }
                ]
              }
            },
            "/items": {
              post: {
                operationId: "create.item",
                description: "Create item",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          name: { type: "string" }
                        },
                        required: ["name"]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      binding: {
        mode: "compile",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read", "knowledge:read"]
      }
    };

    const discovery = await discoverExternalHttpTools(config);
    expect(discovery).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      serviceId: "http-service",
      upstream: {
        type: "openapi",
        transport: "http",
        url: "http://127.0.0.1:8787/api",
        baseUrl: "http://127.0.0.1:8787/api"
      },
      binding: {
        mode: "compile",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read"]
      },
      toolCount: 2
    });
    expect(discovery.tools.map((tool) => tool.name).sort()).toEqual(["create_item", "get_item"]);

    const refresh = await refreshExternalMcpToolCache({
      userDataPath,
      config,
      discovery
    });
    expect(refresh.ok).toBe(true);
    expect(refresh.cachePath).toBe(externalMcpToolCachePath(userDataPath));

    const cache = await fs.readFile(refresh.cachePath, "utf8");
    expect(JSON.parse(cache)).toMatchObject({
      kind: EXTERNAL_MCP_CACHE_KIND,
      services: {
        "http-service": {
          serviceId: "http-service",
          toolCount: 2
        }
      }
    });

    const snapshot = describeExternalMcpToolCacheSync({ userDataPath });
    expect(snapshot).toMatchObject({
      kind: EXTERNAL_MCP_CACHE_KIND,
      services: {
        "http-service": {
          toolCount: 2,
          tools: ["create_item", "get_item"]
        }
      }
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    const virtualOperations = runtime.listVirtualOperationsSync();
    expect(virtualOperations).toHaveLength(2);
    expect(virtualOperations.map((operation) => operation.id)).toEqual([
      "external.http.http_service.create_item",
      "external.http.http_service.get_item"
    ]);
    expect(virtualOperations[0]).toMatchObject({
      aspects: [
        EXTERNAL_HTTP_COMPILE_VIRTUAL_OPERATION_ASPECT,
        "external-service",
        "skill-hub"
      ]
    });
  });

  it("forwards compiled http requests and returns the applied result path", async () => {
    const userDataPath = await tempDir("pact-external-mcp-http-");
    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    const service = {
      serviceId: "http-service",
      serviceName: "HTTP Service",
      displayName: "HTTP Display",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api"
      },
      binding: {
        mode: "compile",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read"]
      },
      tools: [{
        name: "get_item",
        title: "Get item",
        description: "Get item",
        requiredScopes: ["knowledge:read"],
        readOnly: true,
        transport: {
          type: "http",
          method: "POST",
          url: "http://127.0.0.1:8787/api",
          path: "/items/{id}",
          headers: {
            "X-Tool": "yes"
          }
        },
        request: {
          query: {
            verbose: "$input.verbose"
          },
          headers: {
            "X-Request": "$tool.name"
          },
          body: {
            name: "$input.name"
          }
        },
        response: {
          resultPath: "data.value"
        }
      }]
    };

    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: 1,
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        [service.serviceId]: service
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: { "content-type": "application/json" },
      body: {
        data: {
          value: 42
        }
      }
    }));

    const result = await runtime.callTool({
      serviceId: "http-service",
      toolName: "get_item",
      input: {
        id: "alpha",
        verbose: true,
        name: "Alpha",
        extra: "kept"
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/items/alpha?verbose=true");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "X-Tool": "yes",
        "X-Request": "get_item",
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        name: "Alpha"
      })
    });
    expect(result).toMatchObject({
      ok: true,
      serviceId: "http-service",
      upstreamToolName: "get_item",
      upstream: {
        type: "openapi",
        transport: "http",
        url: "http://127.0.0.1:8787/api"
      },
      result: 42
    });
    expect(result.protocolVersion).toBe(EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION);
    expect(result.durationMs).toEqual(expect.any(Number));
  });

  it("surfaces upstream http failures, invalid json payloads, and timeout aborts", async () => {
    const userDataPath = await tempDir("pact-external-mcp-failures-");
    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: 1,
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        "http-service": {
          serviceId: "http-service",
          serviceName: "HTTP Service",
          displayName: "HTTP Display",
          upstream: {
            type: "openapi",
            baseUrl: "http://127.0.0.1:8787/api"
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub"
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

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 502,
      headers: { "content-type": "application/json" },
      body: {
        error: "bad gateway"
      }
    }));

    await expect(runtime.callTool({
      serviceId: "http-service",
      toolName: "call_item",
      input: { id: "alpha" }
    })).rejects.toMatchObject({
      message: "External HTTP tool call_item returned HTTP 502.",
      statusCode: 502,
      payload: { error: "bad gateway" }
    });

    fetchMock.mockResolvedValueOnce(createResponse({
      body: "{not valid json}",
      headers: { "content-type": "application/json" }
    }));

    await expect(runtime.callTool({
      serviceId: "http-service",
      toolName: "call_item",
      input: { id: "beta" }
    })).rejects.toThrow(SyntaxError);

    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((url, init = {}) => new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("Aborted"));
      });
    }));

    const timeoutCall = runtime.callTool({
      serviceId: "http-service",
      toolName: "call_item",
      input: { id: "gamma" },
      timeoutMs: 1
    });
    void timeoutCall.catch(() => null);
    await vi.advanceTimersByTimeAsync(5);
    await expect(timeoutCall).rejects.toThrow("Aborted");
  });

  it("skips refreshes for non-external configs and preserves cached descriptions", async () => {
    const userDataPath = await tempDir("pact-external-mcp-skip-");
    const skipped = await refreshExternalMcpToolCache({
      userDataPath,
      config: {
        serviceId: "ignored",
        upstream: { type: "mcp" },
        binding: { mode: "compile" }
      }
    });
    expect(skipped).toMatchObject({
      ok: true,
      skipped: true,
      reason: "not_external_tool_service"
    });

    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: 1,
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        "mcp-service": {
          serviceId: "mcp-service",
          serviceName: "MCP Service",
          displayName: "MCP Display",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "http://127.0.0.1:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub"
          },
          tools: [{
            name: " ping.tool ",
            title: "Ping Tool",
            description: "Echo",
            inputSchema: { type: "object" }
          }],
          toolCount: 1,
          discoveredAt: "2026-06-04T00:00:00.000Z",
          fingerprint: "abc123"
        }
      }
    });

    const snapshot = describeExternalMcpToolCacheSync({ userDataPath });
    expect(snapshot).toMatchObject({
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        "mcp-service": {
          serviceId: "mcp-service",
          toolCount: 1,
          tools: ["ping.tool"],
          discoveredAt: "2026-06-04T00:00:00.000Z",
          fingerprint: "abc123"
        }
      }
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    const operations = runtime.listVirtualOperationsSync();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: "external.mcp.mcp_service.ping_tool",
      toolId: "pact.externalMcp.mcp_service.ping_tool"
    });
    expect(operations[0].aspects).toEqual([
      EXTERNAL_MCP_VIRTUAL_OPERATION_ASPECT,
      "external-service",
      "skill-hub"
    ]);
  });
});
