import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  MCP_INTERFACE_VERSION,
  MCP_STABLE_TOOL_NAME,
  buildPactMcpDiscovery,
  handlePactMcpHttpRequest
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
    writeJson: vi.fn(),
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
  return text ? JSON.parse(text) : null;
}

function createToolSkillManagementProvider({
  authorizeRequest = vi.fn(),
  listVisibleTools = vi.fn(() => []),
  listVisibleSkills = vi.fn(() => ({ protocolVersion: 1, summary: { activeSkillCount: 0, visibleSkillCount: 0 }, skills: [] })),
  visibleGrantSummary = vi.fn(() => ({})),
  resolveMcpWorkspaceInput = vi.fn(async ({ input } = {}) => ({
    input,
    workspaceDirectory: {
      byId: new Map([["workspace_abc", { ref: "workspace-public" }]])
    }
  })),
  executeTool = vi.fn(async () => ({ ok: true, payload: { result: { ok: true } } })),
  publicMcpToolPayload = vi.fn(async ({ payload }) => payload)
} = {}) {
  return {
    authorizeRequest,
    listVisibleTools,
    listVisibleSkills,
    visibleGrantSummary,
    resolveMcpWorkspaceInput,
    executeTool,
    publicMcpToolPayload
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("http-mcp-adapter extra coverage", () => {
  it("builds discovery/install metadata helpers from discovery state", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const discovery = buildPactMcpDiscovery({
      listenUrl: "http://127.0.0.1:7228/",
      discoveryState: {
        serverId: "server-42",
        mcpIdentity: {
          schemaVersion: "pact.mcp.identity.v1",
          algorithm: "Ed25519",
          keyId: "test-key",
          publicKeyJwk: keyPair.publicKey.export({ format: "jwk" }),
          privateKeyJwk: keyPair.privateKey.export({ format: "jwk" })
        }
      }
    });

    expect(discovery.serverId).toBe("server-42");
    expect(discovery.identity).toEqual({
      schemaVersion: "pact.mcp.identity.v1",
      algorithm: "Ed25519",
      keyId: "test-key",
      publicKeyJwk: expect.any(Object)
    });
    expect(discovery.localDiscovery.env.PACT_MCP_URL).toBe("http://127.0.0.1:7228/mcp");
    expect(discovery.installer.localGrantEndpoint).toBe("http://127.0.0.1:7228/api/mcp/local-grant");
    expect(discovery.installer.clientInstallCommand).toContain("pact-mcp-connector@latest install --target <client> --url 'http://127.0.0.1:7228'");
    expect(discovery.installer.clientInstallJsonCommand).toContain("--json");
    expect(discovery.installer.portable.autoInstallCommand).toContain("./pact-mcp install --target auto");
    expect(discovery.upgrade.notification).toBe("notifications/tools/list_changed");
    expect(discovery.mcpServers.pact.httpUrl).toBe("http://127.0.0.1:7228/mcp");
    expect(discovery.codex.mcp_servers.pact.bearer_token_env_var).toBe("PACT_MCP_TOKEN");
    expect(discovery.geminiCli.mcpServers.pact.headers["X-Pact-Api-Key"]).toBe("${PACT_MCP_TOKEN}");
    expect(discovery.installer.supportedTargets.map((item) => item.target)).toEqual(expect.arrayContaining(["codex", "claude-code", "openclaw"]));
  });

  it("rejects disallowed origins and invalid JSON-RPC payloads on /mcp", async () => {
    const provider = createToolSkillManagementProvider();

    const originResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          origin: "https://attacker.example"
        }
      }),
      response: originResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const originBody = parseBodyJson(originResponse);
    expect(originResponse.statusCode).toBe(403);
    expect(originBody.error.code).toBe(-32003);
    expect(originBody.error.message).toBe("MCP request origin is not allowed.");

    const invalidJsonResponse = createHttpResponse();
    const invalidJsonLogger = { warn: vi.fn() };
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-invalid-json" }),
      response: invalidJsonResponse,
      requestBody: Buffer.from("{", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      logger: invalidJsonLogger
    });

    const invalidJsonBody = parseBodyJson(invalidJsonResponse);
    expect(invalidJsonResponse.statusCode).toBe(400);
    expect(invalidJsonBody.error.code).toBe(-32700);
    expect(invalidJsonLogger.warn).toHaveBeenCalledWith("mcp.http.invalid_json", { requestId: "req-invalid-json" });

    const unsupportedResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: unsupportedResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, params: {} }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const unsupportedBody = parseBodyJson(unsupportedResponse);
    expect(unsupportedResponse.statusCode).toBe(200);
    expect(unsupportedBody.error.code).toBe(-32600);
    expect(unsupportedBody.error.message).toBe("MCP request is missing method.");

    const notFoundResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: notFoundResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "unit.unknown" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const notFoundBody = parseBodyJson(notFoundResponse);
    expect(notFoundResponse.statusCode).toBe(200);
    expect(notFoundBody.error.code).toBe(-32601);
    expect(notFoundBody.error.message).toBe("MCP method not found: unit.unknown");
  });

  it("streams the SSE version event and only authorizes when a token is present", async () => {
    let closeHandler;
    const provider = createToolSkillManagementProvider({
      authorizeRequest: vi.fn(async ({ request }) => {
        return request.headers.authorization
          ? {
              ok: true,
              grant: {
                id: "grant-1",
                label: "grant-1",
                metadata: { autoUpdate: true }
              }
            }
          : { ok: false };
      })
    });

    const noTokenResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        onClose: (handler) => {
          closeHandler = handler;
        }
      }),
      response: noTokenResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(noTokenResponse.statusCode).toBe(200);
    expect(noTokenResponse.headers["Content-Type"]).toContain("text/event-stream");
    expect(noTokenResponse.body).toContain("event: endpoint");
    expect(noTokenResponse.body).toContain("event: message");
    expect(noTokenResponse.body).toContain("notifications/tools/list_changed");
    expect(provider.authorizeRequest).not.toHaveBeenCalled();

    closeHandler();

    const tokenResponse = createHttpResponse();
    let tokenCloseHandler;
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        },
        onClose: (handler) => {
          tokenCloseHandler = handler;
        }
      }),
      response: tokenResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    expect(provider.authorizeRequest).toHaveBeenCalledWith({
      request: expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer granted-token"
        })
      }),
      requiredScopes: []
    });
    expect(tokenResponse.body).toContain("notifications/tools/list_changed");
    expect(tokenResponse.body).toContain("pact.mcp.v1");

    tokenCloseHandler();
  });

  it("returns authorization errors for tools/list and redacts failure payloads for tools/call", async () => {
    const provider = createToolSkillManagementProvider({
      authorizeRequest: vi.fn(async ({ request }) => {
        if (!request.headers.authorization) {
          return {
            ok: false,
            status: 401,
            error: "Missing MCP grant token.",
            reasonCode: "missing_token"
          };
        }
        return {
          ok: true,
          grant: {
            id: "grant-7",
            label: "grant-7",
            metadata: {
              autoUpdate: true,
              targets: ["codex"]
            }
          }
        };
      }),
      listVisibleTools: vi.fn(() => [
        {
          id: "pact.sharedspace.file.read",
          name: "pact.sharedspace.file.read",
          operationId: "pact.sharedspace.file.read",
          label: "Sharedspace file read",
          description: "read",
          requiredScopes: ["console:read"],
          inputSchema: {
            type: "object",
            properties: {
              workspaceId: { type: "string" },
              path: { type: "string" }
            }
          },
          risk: "read_only",
          readOnly: true,
          destructive: false,
          aspects: ["sharedspace"],
          toolsets: ["sharedspace"]
        }
      ]),
      resolveMcpWorkspaceInput: vi.fn(async ({ input }) => ({
        input,
        workspaceDirectory: {
          byId: new Map([["workspace_abc", { ref: "workspace-public" }]])
        }
      })),
      executeTool: vi.fn(async () => ({
        ok: false,
        status: 500,
        payload: {
          error: {
            code: "sharedspace_failure",
            message: "The tool failed.",
            details: {
              note: "Authorization: Bearer secret-token; X-Pact-Api-Key: key-123; path=/Users/unka/DevSpace/Unka-Malloc/Pact/private.txt; workspace_abc"
            }
          }
        }
      }))
    });

    const listDeniedResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: listDeniedResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const listDeniedBody = parseBodyJson(listDeniedResponse);
    expect(listDeniedResponse.statusCode).toBe(401);
    expect(listDeniedBody.error.code).toBe(-32001);
    expect(listDeniedBody.error.data.code).toBe("missing_token");
    expect(listDeniedBody.error.data.localGrantEndpoint).toContain("/api/mcp/local-grant");
    expect(listDeniedBody.error.data.connector.oneCommandAutoInstall).toContain("pact-mcp-install.sh");

    const listSuccessResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: listSuccessResponse,
      requestBody: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const listSuccessBody = parseBodyJson(listSuccessResponse);
    expect(listSuccessResponse.statusCode).toBe(200);
    expect(listSuccessBody.result._meta.connector.oneCommandAutoInstall).toContain("pact-mcp-install.sh");
    expect(listSuccessBody.result._meta.sharedHub.canonicalMcpUrl).toBe("/mcp");
    expect(listSuccessBody.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "pact.discovery",
      "pact.knowledge",
      "pact.sharedspace",
      "pact.codespace",
      "pact.skillHub"
    ]));

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
        id: 3,
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.sharedspace.file.read",
            input: {
              workspaceRef: "workspace_abc",
              workspaceId: "workspace_abc",
              path: "/Users/unka/DevSpace/Unka-Malloc/Pact/private.txt"
            }
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const callBody = parseBodyJson(callResponse);
    expect(callResponse.statusCode).toBe(200);
    expect(callBody.error.code).toBe(-32000);
    expect(callBody.error.data.code).toBe("sharedspace_failure");
    expect(callBody.error.data.details.note).toContain("[server-internal-path]");
    expect(callBody.error.data.details.note).toContain("<redacted-token>");
    expect(callBody.error.data.details.note).toContain("workspace-public");
    expect(callBody.error.data.target.workspaceId).toBe("workspace-public");
    expect(callBody.error.data.exchange.path).toBe("[server-internal-path]");
    expect(callBody.error.data.exchange.workspaceRef).toBe("workspace-public");
    expect(callBody.error.data.exchange.nextOperations).toEqual(expect.arrayContaining([
      "pact.sharedspace.file.read",
      "pact.sharedspace.item.list"
    ]));
  });

  it("handles local MCP grant and uninstall endpoint boundaries", async () => {
    const methodResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: methodResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: createToolSkillManagementProvider()
    });
    expect(methodResponse.statusCode).toBe(405);
    expect(methodResponse.headers.Allow).toBe("POST");

    const unavailableGrantResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: unavailableGrantResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: null
    });
    expect(unavailableGrantResponse.statusCode).toBe(503);
    expect(parseBodyJson(unavailableGrantResponse).error.code).toBe("tool_skill_management_unavailable");

    const provider = {
      ...createToolSkillManagementProvider(),
      createLocalMcpGrant: vi.fn(async () => ({
        status: 201,
        body: {
          ok: true,
          grantId: "grant-local"
        }
      })),
      markLocalMcpGrantUninstalled: vi.fn(async () => ({
        status: 200,
        body: {
          ok: true,
          grantId: "grant-local",
          uninstalled: true
        }
      }))
    };

    const grantResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-local-grant" }),
      response: grantResponse,
      requestBody: Buffer.from(JSON.stringify({ target: "codex" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: provider,
      discoveryState: { serverId: "server-local" }
    });
    expect(grantResponse.statusCode).toBe(201);
    expect(parseBodyJson(grantResponse)).toEqual({ ok: true, grantId: "grant-local" });
    expect(provider.createLocalMcpGrant).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.any(Buffer),
      discoveryState: { serverId: "server-local" },
      url: expect.any(URL)
    }));

    const uninstallMethodResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: uninstallMethodResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: provider
    });
    expect(uninstallMethodResponse.statusCode).toBe(405);
    expect(uninstallMethodResponse.headers.Allow).toBe("POST");

    const uninstallResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: uninstallResponse,
      requestBody: Buffer.from(JSON.stringify({ grantId: "grant-local" }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: provider
    });
    expect(uninstallResponse.statusCode).toBe(200);
    expect(parseBodyJson(uninstallResponse)).toMatchObject({
      ok: true,
      uninstalled: true
    });

    const unavailableUninstallResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: unavailableUninstallResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: null
    });
    expect(unavailableUninstallResponse.statusCode).toBe(503);
  });

  it("maps local MCP endpoint exceptions and missing provider /mcp requests", async () => {
    const logger = { warn: vi.fn() };
    const failingProvider = {
      ...createToolSkillManagementProvider(),
      createLocalMcpGrant: vi.fn(() => {
        throw new Error("grant exploded");
      }),
      markLocalMcpGrantUninstalled: vi.fn(async () => {
        throw new Error("uninstall exploded");
      })
    };

    const failedGrantResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-grant-failed" }),
      response: failedGrantResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: failingProvider,
      logger
    });
    expect(failedGrantResponse.statusCode).toBe(400);
    expect(parseBodyJson(failedGrantResponse).error.code).toBe("local_grant_failed");

    const failedUninstallResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-uninstall-failed" }),
      response: failedUninstallResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: failingProvider,
      logger
    });
    expect(failedUninstallResponse.statusCode).toBe(400);
    expect(parseBodyJson(failedUninstallResponse).error.code).toBe("local_uninstall_failed");
    expect(logger.warn).toHaveBeenCalledWith("mcp.local_grant.failed", expect.objectContaining({
      requestId: "req-grant-failed"
    }));
    expect(logger.warn).toHaveBeenCalledWith("mcp.local_uninstall.failed", expect.objectContaining({
      requestId: "req-uninstall-failed"
    }));

    const missingProviderResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: missingProviderResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: null
    });
    expect(missingProviderResponse.statusCode).toBe(503);
    expect(parseBodyJson(missingProviderResponse).error.code).toBe(-32004);

    const unmatchedResponse = createHttpResponse();
    const handled = await handlePactMcpHttpRequest({
      request: createHttpRequest(),
      response: unmatchedResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "GET",
      url: new URL("http://127.0.0.1:7228/not-mcp"),
      toolSkillManagementProvider: failingProvider
    });
    expect(handled).toBe(false);
    expect(unmatchedResponse.ended).toBe(false);
  });
});
