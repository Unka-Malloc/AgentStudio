import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

const authorizationDecisionMock = vi.fn();

vi.mock("../../../server/platform/common/security/authorization/authorization-engine.mjs", () => ({
  createAuthorizationEngine: vi.fn(() => ({
    evaluate: authorizationDecisionMock
  }))
}));

let httpMcpAdapter;
let operationDispatcher;
let operationDecorators;

beforeAll(async () => {
  httpMcpAdapter = await import("../../../server/platform/common/mcp/http-mcp-adapter.mjs");
  operationDispatcher = await import("../../../server/platform/common/operation-dispatcher/operation-dispatcher.mjs");
  operationDecorators = await import("../../../server/platform/common/operation-dispatcher/operation-decorators.mjs");
});

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
    writeJson: vi.fn(),
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
  const text = response.body;
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function createOperationAuditStore() {
  return {
    append: vi.fn()
  };
}

describe("http-mcp-adapter：发现、握手、MCP 通道与入口路由", () => {
  it("builds discovery JSON and rejects wrong method on discovery endpoint", async () => {
    const request = createHttpRequest();
    const response = createHttpResponse();

    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response,
      requestBody: Buffer.from("", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/api/mcp/discovery"),
      listenUrl: "http://127.0.0.1:7228",
      discoveryState: null
    });

    const payload = parseBodyJson(response);
    expect(response.statusCode).toBe(200);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.sharedHub.canonicalMcpUrl).toBe("http://127.0.0.1:7228/mcp");
    expect(payload.identity).toBeNull();

    const wrongMethodResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: wrongMethodResponse,
      requestBody: Buffer.from("", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/discovery"),
      listenUrl: "http://127.0.0.1:7228"
    });

    expect(wrongMethodResponse.statusCode).toBe(405);
    expect(wrongMethodResponse.headers.Allow).toBe("GET");
  });

  it("rejects MCP handshake when identity missing or nonce invalid", async () => {
    const request = createHttpRequest();

    const missingIdentityResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: missingIdentityResponse,
      requestBody: Buffer.from(JSON.stringify({ nonce: "abcdefghijklmnopqrstuvwx" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/handshake")
    });
    const missingIdentityBody = parseBodyJson(missingIdentityResponse);
    expect(missingIdentityResponse.statusCode).toBe(503);
    expect(missingIdentityBody.ok).toBe(false);
    expect(missingIdentityBody.error).toBe("Pact MCP identity is not available.");

    const badNonceResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: badNonceResponse,
      requestBody: Buffer.from(JSON.stringify({ nonce: "short" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/handshake"),
      discoveryState: { mcpIdentity: { publicKey: "public", privateKey: "private" } }
    });
    const badNonceBody = parseBodyJson(badNonceResponse);
    expect(badNonceResponse.statusCode).toBe(400);
    expect(badNonceBody.ok).toBe(false);

    const keyPair = generateKeyPairSync("ed25519");
    const discoveryIdentity = {
      schemaVersion: "pact.mcp.identity.v1",
      algorithm: "Ed25519",
      keyId: "test-key",
      publicKeyJwk: keyPair.publicKey.export({ format: "jwk" }),
      privateKeyJwk: keyPair.privateKey.export({ format: "jwk" })
    };
    const validNonceResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: validNonceResponse,
      requestBody: Buffer.from(JSON.stringify({ nonce: "A1B2C3D4E5F6G7H8I9J0K1L2M" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/handshake"),
      discoveryState: { mcpIdentity: discoveryIdentity }
    });
    const validNonceBody = parseBodyJson(validNonceResponse);
    expect(validNonceResponse.statusCode).toBe(200);
    expect(validNonceBody.ok).toBe(true);
    expect(validNonceBody.payload.server.interfaceVersion).toBe(httpMcpAdapter.MCP_INTERFACE_VERSION);
    expect(validNonceBody.signature.value).toBeTypeOf("string");
  });

  it("rejects local grant/uninstall when tool-skill provider missing", async () => {
    const request = createHttpRequest();
    const grantResponse = createHttpResponse();

    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: grantResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });

    const grantBody = parseBodyJson(grantResponse);
    expect(grantResponse.statusCode).toBe(503);
    expect(grantBody.error.code).toBe("tool_skill_management_unavailable");

    const uninstallResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request,
      response: uninstallResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall")
    });

    const uninstallBody = parseBodyJson(uninstallResponse);
    expect(uninstallResponse.statusCode).toBe(503);
    expect(uninstallBody.error.code).toBe("tool_skill_management_unavailable");
  });

  it("enforces MCP origin policy and validates /mcp payload parsing", async () => {
    const disallowedResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          origin: "https://attacker.example"
        }
      }),
      response: disallowedResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn(),
        listVisibleTools: vi.fn(() => []),
        listVisibleSkills: vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
        resolveMcpWorkspaceInput: vi.fn(),
        executeTool: vi.fn(),
        publicMcpToolPayload: vi.fn(),
        visibleGrantSummary: vi.fn(() => ({}))
      }
    });

    const disallowedBody = parseBodyJson(disallowedResponse);
    expect(disallowedResponse.statusCode).toBe(403);
    expect(disallowedBody.error.code).toEqual(-32003);

    const sseResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: sseResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn().mockResolvedValue({ ok: false }),
        listVisibleTools: vi.fn(() => []),
        listVisibleSkills: vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
        resolveMcpWorkspaceInput: vi.fn(),
        executeTool: vi.fn(),
        publicMcpToolPayload: vi.fn(),
        visibleGrantSummary: vi.fn(() => ({}))
      }
    });

    expect(sseResponse.statusCode).toBe(200);
    expect(sseResponse.headers["Content-Type"]).toContain("text/event-stream");
    expect(sseResponse.body).toContain("event: message");

    const invalidJsonResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: invalidJsonResponse,
      requestBody: Buffer.from("not-json", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn().mockResolvedValue({ ok: false }),
        listVisibleTools: vi.fn(() => []),
        listVisibleSkills: vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
        resolveMcpWorkspaceInput: vi.fn(),
        executeTool: vi.fn(),
        publicMcpToolPayload: vi.fn(),
        visibleGrantSummary: vi.fn(() => ({}))
      }
    });

    const invalidJsonBody = parseBodyJson(invalidJsonResponse);
    expect(invalidJsonResponse.statusCode).toBe(400);
    expect(invalidJsonBody.error.code).toBe(-32700);
  });

  it("routes MCP tools/call and rejects outlet-name misuse", async () => {
    const provider = {
      authorizeRequest: vi.fn().mockResolvedValue({ ok: true }),
      listVisibleTools: vi.fn().mockReturnValue([
        {
          id: "knowledge.find",
          name: "knowledge.find",
          operationId: "knowledge.find",
          label: "knowledge find",
          description: "",
          requiredScopes: ["console:read"],
          inputSchema: { type: "object", properties: {} },
          risk: "read_only",
          readOnly: true,
          destructive: false,
          aspects: ["knowledge"],
          toolsets: ["knowledge"]
        }
      ]),
      listVisibleSkills: vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
      visibleGrantSummary: vi.fn(() => ({})),
      resolveMcpWorkspaceInput: vi.fn(async ({ input }) => ({
        input,
        workspaceDirectory: {
          byId: new Map([["workspace-001", { ref: "ws-001" }]])
        }
      })),
      executeTool: vi.fn(async () => ({
        ok: true,
        payload: {
          result: {
            ok: true
          }
        }
      })),
      publicMcpToolPayload: vi.fn(async ({ payload }) => payload)
    };

    const mismatchResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: mismatchResponse,
      requestBody: Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "tool-route-1",
          method: "tools/call",
          params: {
            name: httpMcpAdapter.MCP_DISCOVERY_TOOL_NAME,
            arguments: {
              apiVersion: httpMcpAdapter.MCP_INTERFACE_VERSION,
              operation: "knowledge.find",
              input: {}
            }
          }
        }),
        "utf8"
      ),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const mismatchBody = parseBodyJson(mismatchResponse);
    expect(mismatchResponse.statusCode).toBe(200);
    expect(mismatchBody.error.code).toBe(-32602);
    expect(mismatchBody.error.data.code).toBe("operation_outlet_mismatch");

    const stableToolResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: stableToolResponse,
      requestBody: Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "tool-route-2",
          method: "tools/call",
          params: {
            name: httpMcpAdapter.MCP_STABLE_TOOL_NAME,
            arguments: {
              apiVersion: httpMcpAdapter.MCP_INTERFACE_VERSION,
              operation: httpMcpAdapter.MCP_DISCOVERY_TOOL_NAME,
              input: {}
            }
          }
        }),
        "utf8"
      ),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const stableToolBody = parseBodyJson(stableToolResponse);
    expect(stableToolResponse.statusCode).toBe(200);
    expect(stableToolBody.error.code).toBe(-32602);
    expect(stableToolBody.error.data.code).toBe("outlet_name_used_as_operation");

    const executeResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: executeResponse,
      requestBody: Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "tool-route-3",
          method: "tools/call",
          params: {
            name: httpMcpAdapter.MCP_STABLE_TOOL_NAME,
            arguments: {
              apiVersion: httpMcpAdapter.MCP_INTERFACE_VERSION,
              operation: "knowledge.find",
              input: {},
              workspaceId: "workspace-001"
            }
          }
        }),
        "utf8"
      ),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const executeBody = parseBodyJson(executeResponse);
    expect(executeResponse.statusCode).toBe(200);
    expect(executeBody.result.structuredContent.operation).toBe("knowledge.find");
    expect(executeBody.result.structuredContent.target.workspaceId).toBe("workspace-001");
  });

  it("supports MCP notification batches and rejects missing provider on /mcp entry", async () => {
    const noProviderResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: noProviderResponse,
      requestBody: Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list"
        }),
        "utf8"
      ),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp")
    });

    const noProviderBody = parseBodyJson(noProviderResponse);
    expect(noProviderResponse.statusCode).toBe(503);
    expect(noProviderBody.error.code).toBe(-32004);

    const notificationResponse = createHttpResponse();
    await httpMcpAdapter.handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: notificationResponse,
      requestBody: Buffer.from(
        JSON.stringify([
          {
            jsonrpc: "2.0",
            method: "notifications/heartbeat"
          },
          {
            jsonrpc: "2.0",
            method: "notifications/updated"
          }
        ]),
        "utf8"
      ),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn().mockResolvedValue({ ok: false }),
        listVisibleTools: vi.fn(() => []),
        listVisibleSkills: vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
        resolveMcpWorkspaceInput: vi.fn(),
        executeTool: vi.fn(),
        publicMcpToolPayload: vi.fn(),
        visibleGrantSummary: vi.fn(() => ({}))
      }
    });

    expect(notificationResponse.statusCode).toBe(202);
    expect(notificationResponse.body).toBe("");
  });
});

describe("operation-dispatcher：路由、鉴权、安全审批与内核统一审计", () => {
  afterEach(() => {
    authorizationDecisionMock.mockReset();
  });

  it("matches HTTP and RPC definitions and dispatches to controller inputs with query coercion", async () => {
    const controllerMock = vi.fn(({}) => {});
    const operation = {
      id: "unit.item.get",
      target: { controller: "unit", method: "get" },
      http: {
        method: "GET",
        path: "/api/unit/:id",
        query: [{ name: "count", type: "number" }],
        coerce: { count: "number" }
      },
      rpc: {
        method: "unit.item.get",
        body: "params",
        params: [{ name: "id", type: "string", aliases: ["itemId"] }],
        query: [{ name: "count" }]
      },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      safety: { risk: "read_only" },
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          count: { type: "string" }
        }
      },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };
    const response = createHttpResponse();
    const auditStore = createOperationAuditStore();

    const match = operationDispatcher.findHttpOperation({
      operations: [operation],
      method: "GET",
      pathname: "/api/unit/abc"
    });
    expect(match.operation.id).toBe("unit.item.get");
    expect(match.pathParams).toMatchObject({ id: "abc" });

    await operationDispatcher.dispatchRegisteredHttpOperation({
      operations: [operation],
      controllers: {
        unit: {
          get: ({ id, count }) => {
            controllerMock({
              id,
              count
            });
          }
        }
      },
      method: "GET",
      url: new URL("http://127.0.0.1/api/unit/abc?count=3"),
      request: { headers: {} },
      response,
      requestBody: Buffer.from("{}", "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } }),
      operationAuditStore: auditStore,
      logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });

    expect(match).toBeDefined();
    expect(controllerMock).toHaveBeenCalledWith({ id: "abc", count: 3 });
    expect(auditStore.append).toHaveBeenCalled();
    expect(response.statusCode || 200).toBe(200);
  });

  it("returns false for non-registered HTTP route and throws for unknown internal operation", async () => {
    const response = createHttpResponse();

    await expect(
      operationDispatcher.dispatchRegisteredHttpOperation({
        operations: [],
        controllers: {},
        method: "GET",
        url: new URL("http://127.0.0.1/api/unknown"),
        request: {},
        response
      })
    ).resolves.toBe(false);

    await expect(
      operationDispatcher.dispatchInternalOperation({
        operationId: "unknown.operation"
      })
    ).rejects.toThrow("Internal operation not registered: unknown.operation");
  });

  it("rejects HTTP route dispatch when registered handler is missing", async () => {
    const operation = {
      id: "unit.missing-controller",
      target: { controller: "missing", method: "handle" },
      http: { method: "POST", path: "/api/unit/missing" },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      safety: { risk: "read_only" },
      inputSchema: { type: "object", properties: {} },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };

    await expect(
      operationDispatcher.dispatchRegisteredHttpOperation({
        operations: [operation],
        controllers: {},
        method: "POST",
        url: new URL("http://127.0.0.1/api/unit/missing"),
        request: { headers: {} },
        response: createHttpResponse(),
        requestBody: Buffer.from("{}", "utf8"),
        authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
      })
    ).rejects.toThrow("接口目标不存在：missing.handle");
  });

  it("enforces schema validation, external-auth credentials and authorization deny flows", async () => {
    const operation = {
      id: "unit.deny",
      target: { controller: "unit", method: "handle" },
      http: { method: "POST", path: "/api/deny" },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      safety: { risk: "read_only" },
      inputSchema: {
        type: "object",
        required: ["requiredField"],
        properties: {
          requiredField: { type: "string" },
          confirm: { type: "boolean" }
        }
      },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };

    const invalidSchemaResponse = createHttpResponse();
    await operationDispatcher.dispatchOperation({
      operation,
      controllers: { unit: { handle: vi.fn() } },
      request: {},
      response: invalidSchemaResponse,
      requestBody: Buffer.from("{}", "utf8"),
      url: new URL("http://127.0.0.1/api/deny"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } }),
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const invalidSchemaBody = parseBodyJson(invalidSchemaResponse);
    expect(invalidSchemaResponse.statusCode).toBe(400);
    expect(invalidSchemaBody.error).toContain("missing required input");

    const externalAuth = {
      id: "unit.external",
      target: { controller: "unit", method: "handle" },
      http: { method: "POST", path: "/api/external" },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      externalAuth: true,
      safety: { risk: "read_only" },
      inputSchema: { type: "object", properties: {} },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };
    const externalAuthResponse = createHttpResponse();
    await operationDispatcher.dispatchOperation({
      operation: externalAuth,
      controllers: { unit: { handle: vi.fn() } },
      request: { headers: {} },
      response: externalAuthResponse,
      requestBody: Buffer.from("{}", "utf8"),
      url: new URL("http://127.0.0.1/api/external"),
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const externalAuthBody = parseBodyJson(externalAuthResponse);
    expect(externalAuthResponse.statusCode).toBe(401);
    expect(externalAuthBody.error.code).toBe("missing_external_auth");

    const unauthorizedResponse = createHttpResponse();
    await operationDispatcher.dispatchOperation({
      operation,
      controllers: { unit: { handle: vi.fn() } },
      request: {},
      response: unauthorizedResponse,
      requestBody: Buffer.from(JSON.stringify({ requiredField: "x" }), "utf8"),
      url: new URL("http://127.0.0.1/api/deny"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: false, status: 403, error: "access denied", bootstrap: { status: "deny" } }),
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    const unauthorizedBody = parseBodyJson(unauthorizedResponse);
    expect(unauthorizedResponse.statusCode).toBe(403);
    expect(unauthorizedBody.error).toBe("access denied");
    expect(unauthorizedBody.bootstrap).toMatchObject({ status: "deny" });
    expect(unauthorizedBody).not.toHaveProperty("operationId");
  });

  it("supports skip-authorization mode with engine decision and risk-based approval gate", async () => {
    const authorizationSession = {
      user: {
        userId: "u-1",
        username: "owner",
        scopes: ["maintenance:approve"]
      }
    };

    const approvalOperation = {
      id: "unit.repair",
      target: { controller: "unit", method: "repair" },
      http: { method: "POST", path: "/api/repair" },
      requiredScopes: ["maintenance:approve"],
      readOnly: false,
      concurrencySafe: true,
      safety: {
        risk: "repair_write",
        requiresConfirmation: true,
        approvalScope: "maintenance:approve"
      },
      inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, confirm: { type: "boolean" } } },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };

    const deniedByEngineResponse = createHttpResponse();
    authorizationDecisionMock.mockReturnValue({
      allowed: false,
      reasonCode: "scope_mismatch",
      missingScopes: ["maintenance:approve"]
    });

    await operationDispatcher.dispatchOperation({
      operation: approvalOperation,
      controllers: { unit: { repair: vi.fn() } },
      request: { headers: {} },
      response: deniedByEngineResponse,
      requestBody: Buffer.from(JSON.stringify({ id: "id-1" }), "utf8"),
      url: new URL("http://127.0.0.1/api/repair"),
      skipAuthorization: true,
      authSession: authorizationSession,
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const deniedByEngineBody = parseBodyJson(deniedByEngineResponse);
    expect(deniedByEngineResponse.statusCode).toBe(403);
    expect(deniedByEngineBody.error).toContain("requires scopes");

    authorizationDecisionMock.mockReturnValue({ allowed: true });

    const confirmationMissingResponse = createHttpResponse();
    await operationDispatcher.dispatchOperation({
      operation: approvalOperation,
      controllers: { unit: { repair: vi.fn() } },
      request: { headers: {} },
      response: confirmationMissingResponse,
      requestBody: Buffer.from(JSON.stringify({ id: "id-1" }), "utf8"),
      url: new URL("http://127.0.0.1/api/repair"),
      skipAuthorization: true,
      authSession: authorizationSession,
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const confirmationMissingBody = parseBodyJson(confirmationMissingResponse);
    expect(confirmationMissingResponse.statusCode).toBe(428);
    expect(confirmationMissingBody.error).toContain("requires confirm=true");

    const confirmedResponse = createHttpResponse();
    const controller = vi.fn(({ response: res }) => {
      res.writeHead(202);
      res.end("done");
    });
    await operationDispatcher.dispatchOperation({
      operation: approvalOperation,
      controllers: { unit: { repair: controller } },
      request: { headers: {
        "x-pact-safety-confirm": "true"
      } },
      response: confirmedResponse,
      requestBody: Buffer.from(JSON.stringify({ id: "id-1", confirm: true }), "utf8"),
      url: new URL("http://127.0.0.1/api/repair"),
      skipAuthorization: true,
      authSession: authorizationSession,
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    expect(confirmedResponse.statusCode || 202).toBe(202);
    expect(controller).toHaveBeenCalledTimes(1);
  });

  it("processes RPC dispatch success and JSON error paths", async () => {
    const operation = {
      id: "unit.rpc",
      target: { controller: "unit", method: "rpcHandler" },
      http: { method: "POST", path: "/api/rpc/unit" },
      rpc: {
        method: "unit.rpc",
        body: "params",
        params: [{ name: "id", aliases: ["itemId"], required: true, type: "string" }],
        query: [{ name: "tag" }]
      },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      safety: { risk: "read_only" },
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, tag: { type: "string" } }
      },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" }
    };

    const invalidJsonResponse = createHttpResponse();
    await operationDispatcher.dispatchRpcOperation({
      operations: [operation],
      controllers: {
        unit: {
          rpcHandler: vi.fn()
        }
      },
      request: { headers: {} },
      response: invalidJsonResponse,
      requestBody: Buffer.from("bad", "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
    });
    const invalidJsonBody = parseBodyJson(invalidJsonResponse);
    expect(invalidJsonResponse.statusCode).toBe(400);
    expect(invalidJsonBody.error.code).toBe(400);

    const unknownMethodResponse = createHttpResponse();
    await operationDispatcher.dispatchRpcOperation({
      operations: [operation],
      controllers: {
        unit: {
          rpcHandler: vi.fn()
        }
      },
      request: { headers: {} },
      response: unknownMethodResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "unit.miss", id: 1 }), "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
    });
    const unknownMethodBody = parseBodyJson(unknownMethodResponse);
    expect(unknownMethodResponse.statusCode).toBe(404);
    expect(unknownMethodBody.error.code).toBe(404);

    const successResponse = createHttpResponse();
    const rpcHandler = vi.fn((ctx) => {
      ctx.response.writeHead(200, {
        "Content-Type": "application/json"
      });
      ctx.response.write(JSON.stringify({
        ok: true,
        query: ctx.url.searchParams.get("tag")
      }));
    });

    await operationDispatcher.dispatchRpcOperation({
      operations: [operation],
      controllers: {
        unit: {
          rpcHandler
        }
      },
      request: { headers: {} },
      response: successResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "unit.rpc", params: { id: "id-1", tag: "blue" }, id: 9 }), "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } }),
      operationAuditStore: createOperationAuditStore(),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const successBody = parseBodyJson(successResponse);
    expect(successResponse.statusCode).toBe(200);
    expect(successBody.result).toMatchObject({
      ok: true,
      query: "blue"
    });
    expect(rpcHandler).toHaveBeenCalledTimes(1);
  });

  it("maps RPC parameter errors and payload types (text and binary)", async () => {
    const operation = {
      id: "unit.rpc.param",
      target: { controller: "unit", method: "rpcHandler" },
      http: { method: "POST", path: "/api/rpc/unit-param" },
      rpc: {
        method: "unit.rpc.param",
        body: "params",
        params: [{ name: "id", required: true, type: "string" }]
      },
      requiredScopes: ["console:read"],
      readOnly: true,
      concurrencySafe: true,
      safety: { risk: "read_only" },
      inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" },
      binary: false
    };

    const missingParamResponse = createHttpResponse();
    await operationDispatcher.dispatchRpcOperation({
      operations: [operation],
      controllers: { unit: { rpcHandler: vi.fn() } },
      request: { headers: {} },
      response: missingParamResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "unit.rpc.param", id: 11, params: {} }), "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
    });
    const missingParamBody = parseBodyJson(missingParamResponse);
    expect(missingParamResponse.statusCode).toBe(200);
    expect(missingParamBody.error.code).toBe(500);
    expect(missingParamBody.error.message).toContain("RPC 参数缺少 id");

    const textResponse = createHttpResponse();
    const textOperation = {
      ...operation,
      id: "unit.rpc.text",
      rpc: { method: "unit.rpc.text", body: "params", params: [{ name: "id", required: true, type: "string" }] }
    };
    const textHandler = vi.fn((ctx) => {
      ctx.response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });
      ctx.response.write("<b>ok</b>");
    });
    await operationDispatcher.dispatchRpcOperation({
      operations: [textOperation],
      controllers: { unit: { rpcHandler: textHandler } },
      request: { headers: {} },
      response: textResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "unit.rpc.text", params: { id: "id-1" }, id: 12 }), "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
    });
    const textBody = parseBodyJson(textResponse);
    expect(textResponse.statusCode).toBe(200);
    expect(textBody.result.contentType).toMatch(/text\/html/);
    expect(textBody.result.text).toBe("<b>ok</b>");
    expect(textHandler).toHaveBeenCalledTimes(1);

    const binaryResponse = createHttpResponse();
    const binaryOperation = {
      ...operation,
      id: "unit.rpc.binary",
      binary: true,
      rpc: { method: "unit.rpc.binary", body: "params", params: [{ name: "id", required: true, type: "string" }] }
    };
    const binaryHandler = vi.fn((ctx) => {
      ctx.response.write(Buffer.from([0x31, 0x32, 0x33]));
    });
    await operationDispatcher.dispatchRpcOperation({
      operations: [binaryOperation],
      controllers: { unit: { rpcHandler: binaryHandler } },
      request: { headers: {} },
      response: binaryResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "unit.rpc.binary", params: { id: "id-2" }, id: 13 }), "utf8"),
      authorizeOperation: vi.fn().mockResolvedValue({ ok: true, session: { user: { scopes: ["console:read"] } } })
    });
    const binaryBody = parseBodyJson(binaryResponse);
    expect(binaryResponse.statusCode).toBe(200);
    expect(binaryBody.result.contentType).toBe("application/octet-stream");
    expect(binaryBody.result.byteLength).toBe(3);
    expect(binaryBody.result.base64).toBe("MTIz");
    expect(binaryHandler).toHaveBeenCalledTimes(1);
  });

  it("resolves operation and rpc metadata helpers for dispatcher utilities", () => {
    expect(operationDispatcher.shouldProxyRegisteredApiRequest({
      discoveryState: { mode: "forward", forwardBaseUrl: "https://upstream.service" },
      operations: [
        {
          id: "unit.health",
          http: {
            method: "GET",
            path: "/api/healthz"
          }
        }
      ],
      pathname: "/api/healthz"
    })).toBe(true);

    expect(operationDispatcher.shouldProxyRegisteredApiRequest({
      discoveryState: { mode: "local" },
      pathname: "/api/healthz"
    })).toBe(false);

    const match = operationDispatcher.findRpcOperation({
      operations: [{ id: "unit.rpc", rpc: { method: "unit.rpc" } }],
      method: "unit.rpc"
    });
    expect(match.id).toBe("unit.rpc");
  });
});

describe("operation-decorators：装饰链路、合同规范化与审批策略", () => {
  it("builds composable decorators with transport, scopes, safety and concurrency defaults", () => {
    const operation = operationDecorators.defineOperation(
      {
        id: "demo.operation",
        target: { controller: "demo", method: "run" },
        http: { method: "POST", path: "/api/demo" },
        rpc: { method: "demo.operation" },
        inputSchema: { type: "object", properties: { count: { type: "number" }, flag: { type: "boolean" } } },
        requiredScopes: ["scope:base", "scope:base"],
        readOnly: false,
        concurrencySafe: false,
        safety: { risk: "repair_write" },
        audit: { enabled: true, redaction: "default" },
        log: { enabled: true, redaction: "default" }
      },
      operationDecorators.withRequiredScopes(["console:read", "scope:base"]),
      operationDecorators.withTransport({
        http: { path: "/api/demo-v2", method: "GET", query: [] }
      }),
      operationDecorators.withSafety({ requiresConfirmation: false, approvalScope: "maintenance:approve" }),
      operationDecorators.withConcurrency({ concurrencySafe: true }),
      operationDecorators.withInputSchema({ required: ["count"] })
    );

    // order comes from set merge: base operation scope is prepended.
    expect(operation.requiredScopes).toEqual(["scope:base", "console:read"]);
    expect(operation.http.path).toBe("/api/demo-v2");
    expect(operation.http.method).toBe("GET");
    expect(operation.safety.approvalScope).toBe("maintenance:approve");
    expect(operation.inputSchema.required).toEqual(["count"]);
    expect(operation.concurrencySafe).toBe(true);
  });

  it("decorates server API operations and validates registry constraints", () => {
    const base = [
      {
        id: "decorators.ok",
        target: { controller: "a", method: "x" },
        http: { method: "GET", path: "/api/ok" },
        requiredScopes: ["console:read"],
        readOnly: true,
        safety: { risk: "read_only" },
        audit: { enabled: true },
        log: { enabled: true, redaction: "default" },
        inputSchema: { type: "object" }
      },
      {
        id: "decorators.ok2",
        target: { controller: "a", method: "y" },
        http: { method: "POST", path: "/api/ok2", localInForwardMode: true },
        rpc: { method: "decorators.ok2" },
        requiredScopes: ["console:read"],
        readOnly: false,
        concurrencySafe: false,
        safety: { risk: "repair_write", approvalScope: "maintenance:approve" },
        audit: { enabled: true },
        log: { enabled: true, redaction: "default" },
        inputSchema: { type: "object", properties: { reason: { type: "string" } } }
      }
    ];

    const decorated = operationDecorators.decorateServerApiOperations(base);
    const first = decorated.find((item) => item.id === "decorators.ok");
    const second = decorated.find((item) => item.id === "decorators.ok2");

    expect(first.aspects).toEqual(expect.arrayContaining([
      operationDecorators.OPERATION_ASPECTS.DISPATCH,
      operationDecorators.OPERATION_ASPECTS.AUTHORIZATION,
      operationDecorators.OPERATION_ASPECTS.SAFETY,
      operationDecorators.OPERATION_ASPECTS.AUDIT
    ]));
    expect(first.log.recordInput).toBe(false);
    expect(second.log.recordInput).toBe(true);
    expect(second.readOnly).toBe(false);
    expect(second.safety.requiresConfirmation).toBe(true);

    expect(() => operationDecorators.decorateServerApiOperations([
      {
        id: "decorators.bad",
        target: { controller: "a", method: "x" },
        requiredScopes: ["console:read"],
        readOnly: true,
        safety: { risk: "read_only" },
        audit: { enabled: true },
        log: { enabled: true, redaction: "default" },
        inputSchema: { type: "object" }
      }
    ])).toThrow("missing HTTP binding");
  });

  it("evaluates safety gates: blocked, scope and confirm requirements", () => {
    const missingAuth = operationDecorators.evaluateOperationSafety({
      operation: { id: "ops.block", safety: { risk: "destructive" } },
      requestBody: Buffer.from(JSON.stringify({ value: 1 }), "utf8")
    });
    expect(missingAuth.ok).toBe(false);
    expect(missingAuth.status).toBe(403);

    const approvalByScope = operationDecorators.evaluateOperationSafety({
      operation: { id: "ops.approve", safety: { risk: "repair_write", approvalScope: "maintenance:approve", requiresConfirmation: false } },
      requestBody: Buffer.from(JSON.stringify({ value: 1 }), "utf8"),
      authEnabled: true,
      request: { headers: {} }
    });
    expect(approvalByScope.ok).toBe(false);
    expect(approvalByScope.status).toBe(401);

    const approvalDenied = operationDecorators.evaluateOperationSafety({
      operation: { id: "ops.approve", safety: { risk: "repair_write", approvalScope: "maintenance:approve", requiresConfirmation: true } },
      requestBody: Buffer.from(JSON.stringify({ value: 1 }), "utf8"),
      authEnabled: true,
      authSession: { user: { scopes: ["maintenance:approve"] } },
      request: { headers: {} }
    });
    expect(approvalDenied.ok).toBe(false);
    expect(approvalDenied.status).toBe(428);

    const withSessionAndConfirm = operationDecorators.evaluateOperationSafety({
      operation: { id: "ops.approve", safety: { risk: "repair_write", approvalScope: "maintenance:approve", requiresConfirmation: true } },
      requestBody: Buffer.from(JSON.stringify({ value: 1, confirm: true }), "utf8"),
      authEnabled: true,
      authSession: { user: { scopes: ["maintenance:approve"] } }
    });
    expect(withSessionAndConfirm.ok).toBe(true);

    const serialized = operationDecorators.serializableOperationSafety({ id: "ops.approve", safety: { risk: "repair_write", approvalScope: "maintenance:approve" } });
    expect(serialized.risk).toBe("repair_write");
    expect(serialized.approvalScope).toBe("maintenance:approve");
  });

  it("validates operation contract constraints and duplicate operation ids", () => {
    const base = {
      id: "decorators.dup",
      target: { controller: "a", method: "x" },
      http: { method: "GET", path: "/api/dup" },
      requiredScopes: ["console:read"],
      readOnly: true,
      safety: { risk: "read_only" },
      audit: { enabled: true, redaction: "default" },
      log: { enabled: true, redaction: "default" },
      inputSchema: { type: "object" }
    };

    expect(() => operationDecorators.decorateServerApiOperations([
      base,
      { ...base, id: "decorators.dup" }
    ])).toThrow("duplicate id decorators.dup");

    expect(() => operationDecorators.decorateServerApiOperations([
      {
        ...base,
        id: "decorators.empty-scope",
        requiredScopes: []
      }
    ])).toThrow("has no requiredScopes and is not explicitly public/externalAuth");
  });
});
