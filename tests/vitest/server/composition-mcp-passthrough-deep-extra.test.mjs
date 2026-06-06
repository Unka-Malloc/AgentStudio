import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import {
  createExternalMcpPassthroughRuntime,
  discoverExternalMcpTools,
  externalMcpToolCachePath,
  refreshExternalMcpToolCache
} from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
import {
  MCP_INTERFACE_VERSION,
  MCP_STABLE_TOOL_NAME,
  handlePactMcpHttpRequest
} from "../../../server/platform/common/mcp/http-mcp-adapter.mjs";

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

function createHttpResponse() {
  const response = {
    statusCode: null,
    headers: {},
    chunks: [],
    ended: false,
    writeHead: vi.fn((statusCode, headers = {}) => {
      response.statusCode = statusCode;
      response.headers = { ...response.headers, ...headers };
    }),
    end: vi.fn((chunk) => {
      if (chunk !== undefined && chunk !== null) {
        response.chunks.push(typeof chunk === "string" ? chunk : String(chunk));
      }
      response.ended = true;
    }),
    write: vi.fn((chunk) => {
      if (chunk !== undefined && chunk !== null) {
        response.chunks.push(typeof chunk === "string" ? chunk : String(chunk));
      }
    }),
    get body() {
      return response.chunks.join("");
    }
  };
  return response;
}

function createHttpRequest({ headers = {}, requestId = "", onClose = null } = {}) {
  return {
    headers,
    __pactRequestId: requestId,
    on: vi.fn((event, handler) => {
      if (event === "close" && typeof onClose === "function") {
        onClose(handler);
      }
    })
  };
}

function parseBodyJson(response) {
  return response.body ? JSON.parse(response.body) : null;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("composition MCP passthrough deep extras", () => {
  it("rejects malformed configs and exposes public capability shapes", async () => {
    const cwd = await tempDir("pact-composition-mcp-deep-invalid-");

    expect(normalizeExternalServiceConfig(["not", "a", "config"])).toBeNull();

    const malformedRawConfig = {
      serviceId: "bad-mcp",
      serviceName: "Bad MCP",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "not-an-outlet",
        risk: "wild"
      }
    };
    const invalidConfig = normalizeExternalServiceConfig(malformedRawConfig);

    const validation = await validateExternalServiceConfig({
      config: malformedRawConfig,
      cwd,
      requireKnownPaths: false
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      "upstream.url must include an explicit port, for example http://127.0.0.1:8787/mcp.",
      "External service binding outlet is not supported: not-an-outlet.",
      "External service binding risk is not supported: wild."
    ]));

    await expect(discoverExternalMcpTools({
      serviceId: "not-passthrough",
      upstream: { type: "mcp", transport: "streamable-http", url: "http://127.0.0.1:8787/mcp" },
      binding: { mode: "compile" }
    })).resolves.toMatchObject({
      ok: false,
      error: "Config is not an MCP passthrough external service."
    });

    const provider = {
      authorizeRequest: vi.fn(async () => ({
        ok: true,
        grant: {
          id: "grant-1",
          label: "grant-1",
          metadata: { autoUpdate: true }
        }
      })),
      visibleGrantSummary: vi.fn(() => ({})),
      listVisibleTools: vi.fn(() => ([
        {
          id: "sharedspace.file.write",
          name: "sharedspace.file.write",
          operationId: "sharedspace.file.write",
          label: "Sharedspace file write",
          description: "write file",
          requiredScopes: ["workspace:write"],
          inputSchema: {
            type: "object",
            required: ["workspaceId", "path"],
            properties: {
              workspaceId: { type: "string" },
              path: { type: "string" },
              nested: {
                type: "object",
                properties: {
                  workspaceId: { type: "string" }
                }
              }
            }
          },
          risk: "safe_write",
          readOnly: false,
          destructive: false,
          aspects: ["sharedspace"],
          toolsets: ["sharedspace"]
        }
      ])),
      listVisibleSkills: vi.fn(async () => ({
        protocolVersion: 1,
        revision: "1",
        summary: { activeSkillCount: 0, visibleSkillCount: 0 },
        skills: []
      })),
      resolveMcpWorkspaceInput: vi.fn(),
      executeTool: vi.fn(),
      publicMcpToolPayload: vi.fn()
    };

    const response = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.capabilities.list",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const body = parseBodyJson(response);
    expect(response.statusCode).toBe(200);
    expect(body.result.structuredContent.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(body.result.structuredContent.operations[0].name).toBe("sharedspace.file.write");
    expect(body.result.structuredContent.operations[0].inputSchema.properties.workspaceRef).toEqual({
      type: "string",
      description: expect.stringContaining("workspace reference")
    });
    expect(body.result.structuredContent.operations[0].inputSchema.properties.workspaceIndex).toEqual({
      type: "integer",
      description: expect.stringContaining("workspace index")
    });
    expect(body.result.structuredContent.operations[0].inputSchema.properties.workspaceName).toEqual({
      type: "string",
      description: expect.stringContaining("Workspace title")
    });
    expect(body.result.structuredContent.operations[0].inputSchema.required).not.toContain("workspaceId");
    expect(body.result.structuredContent.operations[0].inputSchema.properties.nested.properties.workspaceRef).toEqual({
      type: "string",
      description: expect.stringContaining("workspace reference")
    });

    const callResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: callResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.capabilities.list",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const callBody = parseBodyJson(callResponse);
    expect(callResponse.statusCode).toBe(200);
    expect(callBody.result.structuredContent.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(callBody.result.structuredContent.operations).toEqual(expect.any(Array));
    expect(callBody.result.structuredContent.operations[0]).toMatchObject({
      name: "sharedspace.file.write",
      _meta: {
        mcpOutlet: "pact.sharedspace",
        architectureCategory: "Sharedspace"
      }
    });
  });

  it("passthroughs MCP tools/list and tools/call with upstream session headers and error mapping", async () => {
    const userDataPath = await tempDir("pact-composition-mcp-runtime-");
    const serviceConfig = normalizeExternalServiceConfig({
      serviceId: "mcp-service",
      serviceName: "MCP Service",
      displayName: "MCP Service",
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

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: {
            capabilities: { tools: true },
            serverInfo: { name: "upstream" }
          }
        },
        headers: { "mcp-session-id": "session-alpha", "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: "",
        headers: { "mcp-session-id": "session-alpha" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-tools-list",
          result: {
            tools: [
              {
                name: "  ping.tool  ",
                title: "  Ping Tool  ",
                description: "  Echo the input  ",
                input_schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" }
                  }
                }
              }
            ]
          }
        },
        headers: { "content-type": "application/json" }
      }));

    const discovery = await discoverExternalMcpTools(serviceConfig);
    expect(discovery).toMatchObject({
      ok: true,
      protocolVersion: "pact.external-mcp-passthrough.v1",
      serviceId: "mcp-service",
      initializeResult: {
        capabilities: { tools: true },
        serverInfo: { name: "upstream" }
      },
      tools: [
        {
          name: "ping.tool",
          title: "Ping Tool",
          description: "Echo the input",
          inputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
        }
      ]
    });

    const initRequest = fetchMock.mock.calls[0];
    expect(initRequest[0]).toBe("http://127.0.0.1:8787/mcp");
    expect(initRequest[1].headers).toMatchObject({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18"
    });
    expect(JSON.parse(initRequest[1].body)).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      id: "pact-init",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "pact-external-mcp-passthrough",
          version: "0.0.1"
        }
      }
    });

    const listRequest = fetchMock.mock.calls[2];
    expect(listRequest[1].headers).toMatchObject({
      "Mcp-Session-Id": "session-alpha"
    });
    expect(JSON.parse(listRequest[1].body)).toMatchObject({
      method: "tools/list",
      id: "pact-tools-list"
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
      tools: ["ping.tool"]
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    expect(runtime.listVirtualOperationsSync()).toEqual([
      expect.objectContaining({
        id: "external.mcp.mcp_service.ping_tool",
        toolId: "pact.externalMcp.mcp_service.ping_tool",
        featureId: "external-mcp",
        aspects: expect.arrayContaining(["external-mcp-passthrough", "external-service", "skill-hub"])
      })
    ]);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-init",
          result: { capabilities: { tools: true } }
        },
        headers: { "mcp-session-id": "session-beta", "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: "",
        headers: { "mcp-session-id": "session-beta" }
      }))
      .mockResolvedValueOnce(createResponse({
        body: {
          jsonrpc: "2.0",
          id: "pact-call",
          result: {
            ok: true,
            echoed: { message: "hello" }
          }
        },
        headers: { "content-type": "application/json" }
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
        echoed: { message: "hello" }
      }
    });
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({
      "Mcp-Session-Id": "session-beta"
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 502,
      body: {
        error: "bad gateway"
      },
      headers: { "content-type": "application/json" }
    }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-error",
      serviceName: "MCP Error",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub"
      }
    })).rejects.toMatchObject({
      message: "External MCP HTTP 502 for initialize.",
      statusCode: 502,
      payload: {
        error: "bad gateway"
      }
    });
  });

  it("normalizes compiled HTTP requests, maps HTTP failures, and aborts on timeout", async () => {
    const userDataPath = await tempDir("pact-composition-http-runtime-");
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: 1,
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
            outlet: "pact.skillHub"
          },
          tools: [
            {
              name: "lookup_item",
              title: "Lookup Item",
              description: "Look up an item",
              transport: {
                type: "http",
                method: "POST",
                url: "http://127.0.0.1:8787/api",
                path: "/items/{workspaceId}/{itemId}",
                headers: {
                  "X-Transport-Name": "lookup_item"
                }
              },
              request: {
                query: {
                  include: "$input.include",
                  filter: "$input.filter"
                },
                headers: {
                  "X-Request-Id": "$request.id",
                  "X-Operation": "$operationId",
                  "X-Tool-Name": "$tool.name"
                },
                body: {
                  payload: "$input.payload",
                  untouched: "$input.untouched"
                }
              },
              response: {
                resultPath: "result.value"
              }
            }
          ],
          toolCount: 1,
          discoveredAt: "2026-06-05T00:00:00.000Z",
          fingerprint: "fingerprint"
        }
      }
    });

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 502,
      body: {
        error: "bad gateway"
      },
      headers: { "content-type": "application/json" }
    }));

    await expect(runtime.callTool({
      serviceId: "http-service",
      toolName: "lookup_item",
      input: {
        workspaceId: "workspace-1",
        itemId: "item-9",
        include: ["detail", "summary"],
        filter: { kind: "active" },
        payload: { message: "hello" },
        untouched: "keep"
      }
    })).rejects.toMatchObject({
      message: "External HTTP tool lookup_item returned HTTP 502.",
      statusCode: 502,
      payload: {
        error: "bad gateway"
      }
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: true,
      status: 200,
      body: {
        result: {
          value: {
            ok: true
          }
        }
      },
      headers: { "content-type": "application/json" }
    }));

    const result = await runtime.callTool({
      serviceId: "http-service",
      toolName: "lookup_item",
      input: {
        workspaceId: "workspace-1",
        itemId: "item-9",
        include: ["detail", "summary"],
        filter: { kind: "active" },
        payload: { message: "hello" },
        untouched: "keep"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      protocolVersion: "pact.external-http-compile.v1",
      serviceId: "http-service",
      upstreamToolName: "lookup_item",
      upstream: {
        type: "openapi",
        transport: "http",
        url: "http://127.0.0.1:8787/api"
      },
      result: {
        ok: true
      }
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/items/workspace-1/item-9?include=summary&filter=%7B%22kind%22%3A%22active%22%7D");

    const normalizedRequest = fetchMock.mock.calls[0][1];
    expect(normalizedRequest.method).toBe("POST");
    expect(normalizedRequest.headers).toMatchObject({
      Accept: "application/json, text/plain",
      "X-Transport-Name": "lookup_item",
      "X-Tool-Name": "lookup_item",
      "X-Operation": "lookup_item"
    });
    expect(JSON.parse(normalizedRequest.body)).toEqual({
      payload: {
        message: "hello"
      },
      untouched: "keep"
    });

    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce((url, init = {}) => new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("Aborted"));
      });
    }));

    const timeoutCall = runtime.callTool({
      serviceId: "http-service",
      toolName: "lookup_item",
      input: {
        workspaceId: "workspace-1",
        itemId: "item-9"
      },
      timeoutMs: 1
    });
    void timeoutCall.catch(() => null);
    await vi.advanceTimersByTimeAsync(5);
    await expect(timeoutCall).rejects.toThrow("Aborted");
  });
});
