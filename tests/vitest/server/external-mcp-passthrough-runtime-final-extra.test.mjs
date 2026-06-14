import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXTERNAL_MCP_CACHE_KIND,
  EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
  EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION,
  createExternalMcpPassthroughRuntime,
  describeExternalMcpToolCacheSync,
  discoverExternalMcpTools,
  discoverExternalHttpTools,
  externalMcpToolCachePath,
  refreshExternalMcpToolCache
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

function adoptedCacheService(service = {}) {
  const adoptedAt = "2026-06-14T00:00:00.000Z";
  const tools = Array.isArray(service.tools)
    ? service.tools.map((tool) => ({
        ...tool,
        adoption: {
          protocolVersion: "v0.0.1:external-service:servicehub-tool-adoption-1",
          state: "adopted",
          adoptedAt,
          adoptedBy: "test-operator",
          fingerprint: `test-fingerprint-${String(tool?.name || "tool").trim() || "unnamed"}`,
          reasonCode: "test_fixture_adopted"
        }
      }))
    : [];
	  return {
	    policyPreset: "servicehub.development-local",
	    ...service,
	    adoption: {
      protocolVersion: "v0.0.1:external-service:servicehub-tool-adoption-1",
      state: "adopted",
      adoptedAt,
      adoptedBy: "test-operator",
      activeToolCount: tools.filter((tool) => String(tool?.name || "").trim()).length,
      candidateToolCount: 0,
      reasonCode: "test_fixture_adopted"
    },
    tools,
    activeToolCount: tools.filter((tool) => String(tool?.name || "").trim()).length,
    candidateToolCount: 0
  };
}

function createStreamingResponse({ ok = true, status = 200, body = "", headers = {} } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  const chunks = Array.isArray(body) ? body : [body];
  let index = 0;
  let cancelled = false;
  return {
    ok,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || null;
      }
    },
    get cancelled() {
      return cancelled;
    },
    body: {
      getReader() {
        return {
          async read() {
            if (cancelled || index >= chunks.length) {
              return { done: true, value: undefined };
            }
            const value = Buffer.from(String(chunks[index++]), "utf8");
            return { done: false, value };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {}
        };
      },
      async cancel() {
        cancelled = true;
      }
    },
    async text() {
      return chunks.join("");
    }
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("external mcp passthrough runtime final extras", () => {
  it("parses SSE discovery responses, swallows notification failures, and clears timers", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "session-sse"
        },
        body: [
          "event: ping",
          "data: not-json",
          "",
          "data: {\"jsonrpc\":\"2.0\",\"id\":\"pact-init\",\"result\":{\"capabilities\":{\"tools\":true}}}",
          ""
        ].join("\n")
      }))
      .mockRejectedValueOnce(new Error("notification failed"))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "session-sse"
        },
        body: [
          "data: ignored",
          "",
          "data: {\"jsonrpc\":\"2.0\",\"id\":\"pact-tools-list\",\"result\":{\"tools\":[{\"name\":\" ping.tool \",\"title\":\" Ping Tool \",\"description\":\" Echo \",\"input_schema\":{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}}}}]}}",
          ""
        ].join("\n")
      }));

    const discovery = await discoverExternalMcpTools({
      serviceId: "mcp-sse",
      serviceName: "MCP SSE",
      displayName: "MCP SSE",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.serviceHub"
      }
    }, { timeoutMs: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(discovery).toMatchObject({
      ok: true,
      protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
      initializeResult: {
        capabilities: {
          tools: true
        }
      },
      tools: [{
        name: "ping.tool",
        title: "Ping Tool",
        description: "Echo",
        inputSchema: {
          type: "object",
          properties: {
            ok: {
              type: "boolean"
            }
          }
        }
      }]
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects startup transport failures and non-ok initialize responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-failure",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough"
      }
    })).rejects.toThrow("socket hang up");

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 503,
      headers: {
        "content-type": "application/json"
      },
      body: {
        error: "service unavailable"
      }
    }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-unavailable",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough"
      }
    })).rejects.toMatchObject({
      message: "External MCP HTTP 503 for initialize.",
      statusCode: 503,
      payload: {
        error: "service unavailable"
      }
    });
  });

  it("rejects malformed JSON-RPC payloads and empty-message errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-json"
        },
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: {
            capabilities: {
              tools: true
            }
          }
        }
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-json"
        },
        body: ""
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json"
        },
        body: "{not-valid-json"
      }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-json-error",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough"
      }
    })).rejects.toBeInstanceOf(SyntaxError);

    const userDataPath = await tempDir("pact-external-mcp-json-error-");
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-05T00:00:00.000Z",
      services: {
        "mcp-json-service": adoptedCacheService({
          serviceId: "mcp-json-service",
          serviceName: "MCP JSON Service",
          displayName: "MCP JSON Service",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "http://127.0.0.1:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.serviceHub"
          },
          tools: [{
            name: "ping.tool",
            title: "Ping Tool",
            description: "Echo",
            inputSchema: {
              type: "object"
            }
          }]
        })
      }
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-call"
        },
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: {
            capabilities: {
              tools: true
            }
          }
        }
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-call"
        },
        body: ""
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "application/json"
        },
        body: {
          jsonrpc: "2.0",
          id: "pact-call",
          error: {
            code: -32002,
            message: ""
          }
        }
      }));

    await expect(runtime.callTool({
      serviceId: "mcp-json-service",
      toolName: "ping.tool",
      input: {
        message: "hello"
      }
    })).rejects.toMatchObject({
      message: "External MCP JSON-RPC error for tools/call.",
      code: -32002,
      payload: {
        code: -32002,
        message: ""
      }
    });
  });

  it("compiles openapi and rpc tools from files and endpoint refs, then executes them", async () => {
    const cwd = await tempDir("pact-external-mcp-http-rpc-");
    const userDataPath = await tempDir("pact-external-mcp-http-rpc-cache-");
    const specPath = path.join(cwd, "openapi-spec.json");

    await writeJson(specPath, {
      openapi: "3.0.0",
      paths: {
        "/things/{id}": {
          parameters: [
            {
              name: "tenant",
              in: "header",
              schema: {
                type: "string"
              }
            }
          ],
          get: {
            operationId: "get thing",
            summary: "Get thing",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: {
                  type: "string"
                }
              },
              {
                name: "verbose",
                in: "query",
                schema: {
                  type: "boolean"
                }
              },
              {
                name: "tags",
                in: "query",
                schema: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              },
              {
                name: "filter",
                in: "query",
                schema: {
                  type: "object",
                  properties: {
                    kind: {
                      type: "string"
                    }
                  }
                }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      payload: {
                        type: "string"
                      }
                    },
                    required: ["payload"]
                  }
                }
              }
            }
          },
          post: {
            operationId: "create thing",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: {
                  type: "string"
                }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "string"
                  }
                }
              }
            }
          },
          head: {
            operationId: "ignored head"
          },
          options: {
            operationId: "ignored options"
          }
        },
        "/echo/{name}": {
          get: {
            operationId: "echo thing",
            parameters: [
              {
                name: "name",
                in: "path",
                required: true,
                schema: {
                  type: "string"
                }
              }
            ]
          }
        }
      }
    });

    const httpConfig = {
      serviceId: "http-file",
      serviceName: "HTTP File",
      displayName: "HTTP File",
      policyPreset: "servicehub.development-local",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api",
        specFile: path.relative(process.cwd(), specPath)
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub"
      }
    };

    const httpDiscovery = await discoverExternalHttpTools(httpConfig);
    expect(httpDiscovery).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "get_thing" }),
        expect.objectContaining({ name: "create_thing" }),
        expect.objectContaining({ name: "echo_thing" })
      ])
    });

    await refreshExternalMcpToolCache({
      userDataPath,
      config: httpConfig,
      discovery: httpDiscovery
    });

    const httpRuntime = createExternalMcpPassthroughRuntime({ userDataPath });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: {
        "content-type": "text/plain"
      },
      body: ""
    }));

    const httpResult = await httpRuntime.callTool({
      serviceId: "http-file",
      toolName: "get_thing",
      input: {
        id: "alpha",
        tenant: "acme",
        verbose: true,
        tags: ["one", "two"],
        filter: {
          kind: "primary"
        },
        payload: "declared"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8787/api/things/alpha?verbose=true&tags=two&filter=%7B%22kind%22%3A%22primary%22%7D"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Accept: "application/json, text/plain"
      })
    });
    expect(httpResult).toMatchObject({
      ok: true,
      serviceId: "http-file",
      upstreamToolName: "get_thing",
      upstream: {
        type: "openapi",
        transport: "http",
        url: "http://127.0.0.1:8787/api"
      },
      result: null
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: {
        "content-type": "application/json"
      },
      body: {
        data: {
          answer: 42
        }
      }
    }));

    const postResult = await httpRuntime.callTool({
      serviceId: "http-file",
      toolName: "create_thing",
      input: {
        id: "alpha",
        body: "hello"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/things/alpha");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        body: "hello"
      })
    });
    expect(postResult.result).toEqual({
      data: {
        answer: 42
      }
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: {
        "content-type": "text/plain"
      },
      body: "pong"
    }));

    const echoResult = await httpRuntime.callTool({
      serviceId: "http-file",
      toolName: "echo_thing",
      input: {
        name: "beta"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/echo/beta");
    expect(echoResult.result).toBe("pong");

    const rpcObjectDiscovery = await discoverExternalHttpTools({
      serviceId: "rpc-object",
      serviceName: "RPC Object",
      displayName: "RPC Object",
      upstream: {
        type: "rpc",
        url: "http://127.0.0.1:8787/rpc",
        endpoints: {
          primary: {
            url: "http://127.0.0.1:8787/rpc",
            path: "/jsonrpc",
            protocol: "json-rpc-2.0"
          }
        }
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub"
      },
      tools: [{
        name: "rpc.object",
        rpc: {
          endpointRef: "primary",
          method: "demo.call",
          params: {
            payload: "$input.payload"
          },
          id: "$request.id",
          resultPath: "data.answer"
        }
      }]
    });

    expect(rpcObjectDiscovery).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION,
      tools: [{
        name: "rpc.object",
        rpc: {
          endpointRef: "primary",
          method: "demo.call",
          resultPath: "data.answer"
        }
      }]
    });

    await refreshExternalMcpToolCache({
      userDataPath,
      config: {
        serviceId: "rpc-object",
        serviceName: "RPC Object",
        displayName: "RPC Object",
        upstream: {
          type: "rpc",
          url: "http://127.0.0.1:8787/rpc",
          endpoints: {
            primary: {
              url: "http://127.0.0.1:8787/rpc",
              path: "/jsonrpc",
              protocol: "json-rpc-2.0"
            }
          }
        },
        binding: {
          mode: "compile",
          outlet: "pact.serviceHub"
        },
        tools: rpcObjectDiscovery.tools
      },
      discovery: rpcObjectDiscovery
    });
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        "rpc-object": adoptedCacheService({
          serviceId: "rpc-object",
          serviceName: "RPC Object",
          displayName: "RPC Object",
          upstream: rpcObjectDiscovery.upstream,
          binding: rpcObjectDiscovery.binding,
          tools: rpcObjectDiscovery.tools,
          toolCount: rpcObjectDiscovery.tools.length,
          discoveredAt: rpcObjectDiscovery.discoveredAt,
          fingerprint: rpcObjectDiscovery.fingerprint
        })
      }
    });

    expect(describeExternalMcpToolCacheSync({ userDataPath })).toMatchObject({
      services: {
        "rpc-object": {
          toolCount: 1,
          tools: ["rpc.object"]
        }
      }
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: {
        "content-type": "application/json"
      },
      body: {
        data: {
          answer: 42
        }
      }
    }));

    const rpcRuntime = createExternalMcpPassthroughRuntime({ userDataPath });
    const rpcResult = await rpcRuntime.callTool({
      serviceId: "rpc-object",
      toolName: "rpc.object",
      input: {
        payload: "hello"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/rpc/jsonrpc");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json"
      })
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "demo.call",
      params: {
        payload: "hello"
      }
    });
    expect(rpcResult).toMatchObject({
      ok: true,
      serviceId: "rpc-object",
      upstreamToolName: "rpc.object",
      result: 42
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      headers: {
        "content-type": "application/json"
      },
      body: {
        jsonrpc: "2.0",
        id: "pact-error",
        error: {
          code: -32602,
          message: "Invalid params"
        }
      }
    }));

    await expect(rpcRuntime.callTool({
      serviceId: "rpc-object",
      toolName: "rpc.object",
      input: {
        payload: "bad"
      }
    })).rejects.toMatchObject({
      message: "Invalid params",
      code: "external_rpc_error",
      rpcCode: -32602,
      statusCode: 502,
      payload: {
        error: {
          code: -32602,
          message: "Invalid params"
        }
      }
    });

    const sseDiscovery = await discoverExternalHttpTools({
      serviceId: "events",
      serviceName: "Events",
      displayName: "Events",
      upstream: {
        type: "sse",
        url: "http://127.0.0.1:8787/events",
        eventFormat: "json-data"
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub"
      },
      tools: [{
        name: "watchEvents"
      }]
    });

    expect(sseDiscovery).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      tools: [{
        name: "watchEvents",
        transport: {
          type: "sse",
          method: "GET"
        },
        sse: {
          eventFormat: "json-data",
          maxEvents: 1
        }
      }]
    });

    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        events: adoptedCacheService({
          serviceId: "events",
          serviceName: "Events",
          displayName: "Events",
          upstream: sseDiscovery.upstream,
          binding: sseDiscovery.binding,
          tools: sseDiscovery.tools,
          toolCount: sseDiscovery.tools.length,
          discoveredAt: sseDiscovery.discoveredAt,
          fingerprint: sseDiscovery.fingerprint
        })
      }
    });

    fetchMock.mockReset();
    const sseResponse = createStreamingResponse({
      headers: {
        "content-type": "text/event-stream"
      },
      body: [
        "event: update",
        "id: evt-1",
        "data: {\"ok\":true}",
        "",
        "event: ignored",
        "data: {\"ok\":false}",
        ""
      ].join("\n")
    });
    fetchMock.mockResolvedValueOnce(sseResponse);

    const sseRuntime = createExternalMcpPassthroughRuntime({ userDataPath });
    const sseResult = await sseRuntime.callTool({
      serviceId: "events",
      toolName: "watchEvents",
      input: {
        cursor: "latest"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/events?cursor=latest");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET"
    });
    expect(sseResult).toMatchObject({
      ok: true,
      serviceId: "events",
      upstreamToolName: "watchEvents",
      result: {
        events: [
          {
            event: "update",
            id: "evt-1",
            data: {
              ok: true
            }
          }
        ]
      }
    });
    expect(sseResponse.cancelled).toBe(true);

    const rpcArrayDiscovery = await discoverExternalHttpTools({
      serviceId: "rpc-array",
      serviceName: "RPC Array",
      displayName: "RPC Array",
      upstream: {
        type: "rpc",
        url: "http://127.0.0.1:8787/rpc",
        endpoints: [
          {
            id: "array-endpoint",
            url: "http://127.0.0.1:8787/rpc",
            path: "/jsonrpc"
          }
        ]
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub"
      },
      tools: [{
        name: "rpc.array",
        rpc: {
          endpointRef: "array-endpoint",
          method: "demo.array"
        }
      }]
    });

    expect(rpcArrayDiscovery.tools).toHaveLength(1);

    const rpcPathDiscovery = await discoverExternalHttpTools({
      serviceId: "rpc-path",
      serviceName: "RPC Path",
      displayName: "RPC Path",
      upstream: {
        type: "rpc",
        url: "http://127.0.0.1:8787/rpc/v2"
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub"
      },
      tools: [{
        name: "rpc.path",
        rpc: {
          method: "demo.path"
        }
      }]
    });

    expect(rpcPathDiscovery.tools[0].transport.path).toBe("");
  });

  it("handles empty SSE payloads and discovery configs that produce no tools", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "session-empty"
        },
        body: [
          "data: {\"jsonrpc\":\"2.0\",\"id\":\"pact-init\",\"result\":{\"capabilities\":{\"tools\":true}}}",
          ""
        ].join("\n")
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "text/event-stream"
        },
        body: [
          "event: ping",
          "data: not-json",
          ""
        ].join("\n")
      }))
      .mockResolvedValueOnce(createResponse({
        headers: {
          "content-type": "text/event-stream"
        },
        body: [
          "event: ping",
          "data: not-json",
          ""
        ].join("\n")
      }));

    const discovery = await discoverExternalMcpTools({
      serviceId: "mcp-empty",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough"
      }
    });

    expect(discovery).toMatchObject({
      ok: true,
      toolCount: 0,
      tools: []
    });

    await expect(discoverExternalHttpTools({
      serviceId: "http-empty",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api",
        spec: {
          openapi: "3.0.0",
          paths: {
            "/health": {
              head: {
                operationId: "skip head"
              },
              options: {
                operationId: "skip options"
              }
            }
          }
        }
      },
      binding: {
        mode: "compile"
      }
    })).rejects.toThrow("did not produce any tools");
  });

  it("refreshes cache, preserves prior services, and filters sorted virtual operations", async () => {
    const userDataPath = await tempDir("pact-external-mcp-refresh-");
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-04T00:00:00.000Z",
      services: {
        "broken-service": {
          serviceId: "",
          tools: [{
            name: "ignored.tool"
          }]
        },
        "legacy-http": {
          serviceId: "legacy-http",
          serviceName: "Legacy HTTP",
          displayName: "Legacy HTTP",
          upstream: {
            type: "openapi",
            baseUrl: "http://127.0.0.1:8787/api"
          },
          binding: {
            mode: "compile",
            outlet: "pact.serviceHub"
          },
          tools: [
            {
              name: " ",
              title: "Skip me"
            },
            {
              name: "legacy.tool",
              title: "Legacy Tool",
              description: "Legacy",
              inputSchema: {
                type: "object"
              }
            }
          ]
        }
      }
    });

    const discovery = {
      ok: true,
      protocolVersion: "v0.0.1:external-service:mcp-passthrough-1",
      serviceId: "mcp-runtime",
      serviceName: "MCP Runtime",
      displayName: "MCP Runtime",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.serviceHub"
      },
      initializeResult: {},
      tools: [{
        name: "ping.tool",
        title: "Ping Tool",
        description: "Echo",
        inputSchema: {
          type: "object"
        }
      }],
      toolCount: 1,
      discoveredAt: "2026-06-05T00:00:00.000Z",
      fingerprint: "fingerprint"
    };

    const refresh = await refreshExternalMcpToolCache({
      userDataPath,
      config: {
        serviceId: "mcp-runtime",
        serviceName: "MCP Runtime",
        displayName: "MCP Runtime",
        upstream: {
          type: "mcp",
          transport: "streamable-http",
          url: "http://127.0.0.1:8787/mcp"
        },
        binding: {
          mode: "passthrough",
          outlet: "pact.serviceHub"
        }
      },
      discovery
    });

    expect(refresh).toMatchObject({
      ok: true,
      cachePath: externalMcpToolCachePath(userDataPath),
      serviceId: "mcp-runtime",
      toolCount: 1,
      activeToolCount: 0,
      candidateToolCount: 1,
      tools: ["ping.tool"]
    });

    const snapshot = describeExternalMcpToolCacheSync({ userDataPath });
    expect(snapshot).toMatchObject({
      kind: EXTERNAL_MCP_CACHE_KIND,
      services: {
        "legacy-http": {
          toolCount: 2,
          activeToolCount: 0,
          candidateToolCount: 1,
          tools: ["legacy.tool"],
          activeTools: [],
          candidateTools: ["legacy.tool"],
          legacyMigration: {
            required: true,
            state: "requires_readoption",
            reasonCode: "legacy_cache_requires_tool_adoption"
          }
        },
        "mcp-runtime": {
          toolCount: 1,
          activeToolCount: 0,
          candidateToolCount: 1,
          tools: ["ping.tool"],
          activeTools: [],
          candidateTools: ["ping.tool"]
        }
      }
    });
    expect(snapshot.services["broken-service"]).toBeUndefined();

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    const operations = runtime.listVirtualOperationsSync();
    expect(operations).toEqual([]);

    await expect(runtime.callTool({
      serviceId: "missing-service",
      toolName: "anything",
      input: {}
    })).rejects.toMatchObject({
      message: "External MCP service is not registered: missing-service",
      code: "external_mcp_service_not_registered"
    });

    await expect(runtime.callTool({
      serviceId: "legacy-http",
      toolName: "missing.tool",
      input: {}
    })).rejects.toMatchObject({
      message: "External HTTP tool is not registered: legacy-http/missing.tool",
      code: "external_http_tool_not_registered"
    });

    await expect(runtime.callTool({
      serviceId: "legacy-http",
      toolName: "legacy.tool",
      input: {}
    })).rejects.toMatchObject({
      message: "ServiceHub external tool is not active or adopted: legacy-http/legacy.tool",
      code: "servicehub_tool_not_active",
      statusCode: 404
    });
  });
});
