import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPactMcpDiscovery,
  broadcastMcpToolListChanged,
  handlePactMcpHttpRequest,
  MCP_CONNECTOR_PACKAGE_NAME,
  MCP_INTERFACE_VERSION,
  MCP_KNOWLEDGE_TOOL_NAME,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  MCP_STABLE_TOOL_NAME
} from "../../../server/platform/common/mcp/http-mcp-adapter.mjs";

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
    setHeader: vi.fn(),
    getHeader: vi.fn(),
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

function createProvider({
  authorizeRequest = vi.fn(async () => ({
    ok: true,
    grant: {
      id: "grant-1",
      label: "grant-1",
      metadata: { autoUpdate: true }
    }
  })),
  listVisibleTools = vi.fn(() => [
    {
      id: "knowledge.find",
      name: "knowledge.find",
      operationId: "knowledge.find",
      label: "Knowledge find",
      description: "Search knowledge",
      inputSchema: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string" },
          query: { type: "string" }
        }
      },
      requiredScopes: ["knowledge:read"],
      risk: "read_only",
      readOnly: true,
      destructive: false,
      aspects: ["knowledge"],
      toolsets: ["knowledge"]
    }
  ]),
  listVisibleSkills,
  visibleGrantSummary = vi.fn(() => ({
    protocolVersion: 1,
    revision: "grant-revision",
    summary: { activeSkillCount: 0, visibleSkillCount: 0 },
    skills: []
  })),
  resolveMcpWorkspaceInput = vi.fn(async ({ input } = {}) => ({
    input,
    workspaceDirectory: {
      byId: new Map([["workspace_abc", { ref: "workspace-public" }]])
    }
  })),
  executeTool = vi.fn(async () => ({
    ok: true,
    payload: {
      result: {
        ok: true
      }
    }
  })),
  publicMcpToolPayload = vi.fn(async ({ payload }) => payload)
} = {}) {
  const provider = {
    authorizeRequest,
    listVisibleTools,
    visibleGrantSummary,
    resolveMcpWorkspaceInput,
    executeTool,
    publicMcpToolPayload
  };
  if (listVisibleSkills !== undefined) {
    provider.listVisibleSkills = listVisibleSkills;
  }
  return provider;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("http-mcp-adapter final extra coverage", () => {
  it("rejects invalid handshake bodies and malformed /mcp JSON with the expected error envelopes", async () => {
    const provider = createProvider();

    const handshakeMethodResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: handshakeMethodResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/api/mcp/handshake"),
      toolSkillManagementProvider: provider
    });

    expect(handshakeMethodResponse.statusCode).toBe(405);
    expect(handshakeMethodResponse.headers.Allow).toBe("POST");

    const handshakeJsonResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: handshakeJsonResponse,
      requestBody: Buffer.from("{", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/handshake"),
      toolSkillManagementProvider: provider,
      discoveryState: {
        mcpIdentity: {}
      }
    });

    expect(handshakeJsonResponse.statusCode).toBe(400);
    expect(parseBodyJson(handshakeJsonResponse)).toEqual({
      ok: false,
      error: "MCP handshake body must be valid JSON."
    });

    const invalidJsonLogger = { warn: vi.fn() };
    const invalidJsonResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-invalid-json" }),
      response: invalidJsonResponse,
      requestBody: Buffer.from("{", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      logger: invalidJsonLogger
    });

    expect(invalidJsonResponse.statusCode).toBe(400);
    expect(parseBodyJson(invalidJsonResponse)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "MCP request body must be valid JSON.",
        data: {}
      }
    });
    expect(invalidJsonLogger.warn).toHaveBeenCalledWith("mcp.http.invalid_json", {
      requestId: "req-invalid-json"
    });

    const wrongMethodResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: wrongMethodResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "PATCH",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(wrongMethodResponse.statusCode).toBe(405);
    expect(wrongMethodResponse.headers.Allow).toBe("POST");
  });

  it("serves SSE and HEAD responses, then falls back to a 202 ack for notification-only batches", async () => {
    const provider = createProvider({
      authorizeRequest: vi.fn(async () => ({ ok: false }))
    });

    const headResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: headResponse,
      requestBody: Buffer.from("", "utf8"),
      method: "HEAD",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(headResponse.statusCode).toBe(200);
    expect(headResponse.headers["Content-Type"]).toContain("text/event-stream");
    expect(headResponse.body).toBe("");

    let closeHandler;
    const getResponse = createHttpResponse();
    const getRequest = createHttpRequest({
      onClose: (handler) => {
        closeHandler = handler;
      }
    });
    await handlePactMcpHttpRequest({
      request: getRequest,
      response: getResponse,
      requestBody: Buffer.from("", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.headers["Content-Type"]).toContain("text/event-stream");
    expect(getResponse.body).toContain("event: endpoint");
    expect(getResponse.body).toContain("event: message");
    expect(getResponse.body).toContain("notifications/tools/list_changed");
    expect(provider.authorizeRequest).not.toHaveBeenCalled();
    expect(getRequest.on).toHaveBeenCalledWith("close", expect.any(Function));

    if (closeHandler) {
      closeHandler();
    }

    const batchResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: batchResponse,
      requestBody: Buffer.from(JSON.stringify([
        {
          jsonrpc: "2.0",
          method: "notifications/heartbeat"
        },
        {
          jsonrpc: "2.0",
          method: "notifications/updated"
        }
      ]), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(batchResponse.statusCode).toBe(202);
    expect(batchResponse.body).toBe("");
  });

  it("broadcasts tools/list_changed to live SSE clients after catalog or grant changes", async () => {
    const provider = createProvider();
    let closeHandler;
    const getResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        },
        onClose: (handler) => {
          closeHandler = handler;
        }
      }),
      response: getResponse,
      requestBody: Buffer.from("", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const initialLength = getResponse.body.length;
    const globalDelivery = broadcastMcpToolListChanged({
      reasonCode: "external_service_catalog_refreshed",
      reason: "External service tools changed for tests."
    });
    const scopedDelivery = broadcastMcpToolListChanged({
      grantId: "grant-1",
      reasonCode: "grant_revoked",
      reason: "Tool grant was revoked for tests."
    });

    const broadcastTail = getResponse.body.slice(initialLength);
    expect(globalDelivery.deliveredConnectionCount).toBe(1);
    expect(scopedDelivery.deliveredConnectionCount).toBe(1);
    expect(broadcastTail).toContain("notifications/tools/list_changed");
    expect(broadcastTail).toContain("external_service_catalog_refreshed");
    expect(broadcastTail).toContain("grant_revoked");
    expect(broadcastTail).not.toContain("granted-token");

    closeHandler?.();

    const afterCloseDelivery = broadcastMcpToolListChanged({
      grantId: "grant-1",
      reasonCode: "grant_revoked"
    });
    expect(afterCloseDelivery.deliveredConnectionCount).toBe(0);
  });

  it("falls back to default discovery and initialize metadata when no discovery state is provided", async () => {
    const discovery = buildPactMcpDiscovery({});
    expect(discovery.serverId).toBe("");
    expect(discovery.identity).toBeNull();
    expect(discovery.sharedHub.canonicalMcpUrl).toBe("/mcp");
    expect(discovery.installer.localGrantEndpoint).toBe("/api/mcp/local-grant");

    const provider = createProvider({
      listVisibleSkills: undefined
    });

    const initializeResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: initializeResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: MCP_INTERFACE_VERSION,
          capabilities: {},
          clientInfo: {
            name: "test-client",
            version: "1.0.0"
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const initializeBody = parseBodyJson(initializeResponse);
    expect(initializeResponse.statusCode).toBe(200);
    expect(initializeBody.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(initializeBody.result.serverInfo).toEqual({
      name: "Pact",
      version: MCP_SERVER_VERSION
    });
    expect(initializeBody.result._meta.sharedHub.canonicalMcpUrl).toBe("/mcp");
    expect(initializeBody.result._meta.connector.packageName).toBe(MCP_CONNECTOR_PACKAGE_NAME);
  });

  it("returns capability metadata with skill catalog fallback and validates tool-call envelopes", async () => {
    const provider = createProvider({
      listVisibleSkills: undefined
    });

    const versionResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: versionResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "version-1",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.mcp.version",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const versionBody = parseBodyJson(versionResponse);
    expect(versionResponse.statusCode).toBe(200);
    expect(versionBody.result.structuredContent.serverVersion).toBe(MCP_SERVER_VERSION);
    expect(versionBody.result.structuredContent.connector.packageName).toBe(MCP_CONNECTOR_PACKAGE_NAME);
    expect(versionBody.result.structuredContent.sharedHub.canonicalMcpUrl).toBe("/mcp");

    const capabilitiesResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: capabilitiesResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "cap-1",
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

    const capabilitiesBody = parseBodyJson(capabilitiesResponse);
    expect(capabilitiesResponse.statusCode).toBe(200);
    expect(capabilitiesBody.result.structuredContent.skillCatalog).toEqual({
      schemaVersion: 1,
      status: "unavailable",
      summary: {
        activeSkillCount: 0,
        visibleSkillCount: 0
      },
      skills: []
    });
    expect(capabilitiesBody.result.structuredContent.operations[0]).toMatchObject({
      name: "knowledge.find",
      title: "Knowledge find",
      _meta: {
        mcpOutlet: "pact.knowledge",
        architectureCategory: "Knowledge"
      }
    });
    expect(capabilitiesBody.result.structuredContent.outlets[MCP_KNOWLEDGE_TOOL_NAME]).toMatchObject({
      toolName: MCP_KNOWLEDGE_TOOL_NAME,
      architectureCategory: "Knowledge"
    });

    const missingNameResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: missingNameResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "call-missing-name",
        method: "tools/call",
        params: {
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.mcp.version",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(parseBodyJson(missingNameResponse)).toEqual({
      jsonrpc: "2.0",
      id: "call-missing-name",
      error: {
        code: -32602,
        message: "tools/call requires params.name.",
        data: {}
      }
    });

    const wrongVersionResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: wrongVersionResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "call-wrong-version",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: "2024-01-01",
            operation: "pact.mcp.version",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const wrongVersionBody = parseBodyJson(wrongVersionResponse);
    expect(wrongVersionBody.error.code).toBe(-32602);
    expect(wrongVersionBody.error.message).toBe("Unsupported Pact MCP apiVersion: 2024-01-01");
    expect(wrongVersionBody.error.data.expectedApiVersion).toBe(MCP_INTERFACE_VERSION);
    expect(wrongVersionBody.error.data.toolsetVersion).toBeDefined();
    expect(wrongVersionBody.error.data.upgrade.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(wrongVersionBody.error.data.upgrade.connector.packageName).toBe(MCP_CONNECTOR_PACKAGE_NAME);
  });
});
