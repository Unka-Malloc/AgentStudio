import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXTERNAL_SERVICE_CONFIG_KIND,
  loadExternalServiceConfig,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig,
  writeExternalServiceArtifacts
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import {
  handlePactMcpHttpRequest,
  MCP_INTERFACE_VERSION,
  MCP_STABLE_TOOL_NAME
} from "../../../server/platform/common/mcp/http-mcp-adapter.mjs";

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
      metadata: {
        autoUpdate: true,
        operatorId: "operator-1",
        agentProfileId: "profile-1"
      }
    }
  })),
  listVisibleTools = vi.fn(() => [
    {
      id: "sharedspace.file.write",
      name: "sharedspace.file.write",
      operationId: "sharedspace.file.write",
      label: "Sharedspace write",
      description: "Write a sharedspace file",
      inputSchema: {
        type: "object",
        required: ["workspaceId", "path"],
        properties: {
          workspaceId: { type: "string" },
          path: { type: "string" }
        }
      },
      requiredScopes: ["sharedspace:write"],
      risk: "safe_write",
      readOnly: false,
      destructive: false,
      aspects: ["sharedspace"],
      toolsets: ["sharedspace"]
    },
    {
      id: "knowledge.find",
      name: "knowledge.find",
      operationId: "knowledge.find",
      label: "Knowledge find",
      description: "Search knowledge",
      inputSchema: {
        type: "object",
        properties: {
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
  listVisibleSkills = vi.fn(async () => ({
    protocolVersion: 1,
    revision: "grant-revision",
    summary: { activeSkillCount: 2, visibleSkillCount: 3 },
    skills: [{ id: "skill-1" }]
  })),
  visibleGrantSummary = vi.fn(() => ({
    protocolVersion: 1,
    revision: "grant-revision",
    summary: { activeSkillCount: 2, visibleSkillCount: 3 },
    skills: [{ id: "skill-1" }]
  })),
  resolveMcpWorkspaceInput = vi.fn(async ({ input } = {}) => ({
    input,
    workspaceDirectory: {
      byId: new Map([["workspace_abc", { ref: "workspace-public" }]])
    }
  })),
  executeTool = vi.fn(async ({ toolId } = {}) => {
    if (toolId === "sharedspace.file.write") {
      return {
        ok: true,
        payload: {
          result: {
            ok: true,
            action: "file-written",
            path: "notes/report.md",
            workspaceRef: "workspace-public"
          }
        }
      };
    }
    if (toolId === "knowledge.find") {
      return {
        ok: false,
        status: 429,
        payload: {
          error: {
            code: "knowledge_busy",
            message: "Knowledge service busy.",
            details: {
              retryAfter: 30
            }
          },
          traceId: "trace-knowledge"
        }
      };
    }
    return {
      ok: true,
      payload: {
        result: {
          ok: true
        }
      }
    };
  }),
  publicMcpToolPayload = vi.fn(async ({ payload }) => payload),
  createLocalMcpGrant = vi.fn(async () => ({
    status: 201,
    body: {
      ok: true,
      grant: {
        id: "local-grant-1"
      }
    }
  })),
  markLocalMcpGrantUninstalled = vi.fn(async () => ({
    status: 200,
    body: {
      ok: true,
      uninstalled: true
    }
  }))
} = {}) {
  return {
    authorizeRequest,
    listVisibleTools,
    listVisibleSkills,
    visibleGrantSummary,
    resolveMcpWorkspaceInput,
    executeTool,
    publicMcpToolPayload,
    createLocalMcpGrant,
    markLocalMcpGrantUninstalled
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("server adapter extra coverage", () => {
  it("covers external service validation branches and load fallbacks", async () => {
    expect(normalizeExternalServiceConfig(null)).toBeNull();
    expect(normalizeExternalServiceConfig(["bad"])).toBeNull();

    const cwd = await tempDir("pact-external-service-adapter-validate-");

    const mcpValidation = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "mcp-service",
        serviceName: "MCP Service",
        startupPolicy: "with-platform",
        upstream: {
          type: "mcp",
          transport: "bogus"
        }
      },
      cwd,
      requireKnownPaths: false
    });
    expect(mcpValidation.errors).toEqual(expect.arrayContaining([
      "External MCP upstream transport is not supported: bogus.",
      "External service startupPolicy with-platform requires scripts.start."
    ]));

    const mcpStdioValidation = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "mcp-stdio",
        serviceName: "MCP Stdio",
        upstream: {
          type: "mcp",
          transport: "stdio"
        }
      },
      cwd,
      requireKnownPaths: false
    });
    expect(mcpStdioValidation.errors).toContain("External MCP stdio upstream requires upstream.command.executable.");

    const cloudValidation = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "cloud-drive",
        serviceName: "Cloud Drive",
        upstream: {
          type: "cloud-drive",
          provider: "box",
          mode: "remote-live",
          secretRef: "plain-secret"
        }
      },
      cwd,
      requireKnownPaths: false
    });
    expect(cloudValidation.errors).toEqual(expect.arrayContaining([
      "External cloud-drive upstream provider is not supported: box.",
      "External cloud-drive remote-live upstream requires endpointUrl or url.",
      "External cloud-drive OAuth provider secret must use a secret:// secretRef."
    ]));

    const openApiValidation = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "openapi-service",
        serviceName: "OpenAPI Service",
        healthCheck: {
          type: "bogus"
        },
        upstream: {
          type: "openapi"
        }
      },
      cwd,
      requireKnownPaths: false
    });
    expect(openApiValidation.errors).toEqual(expect.arrayContaining([
      "External OpenAPI upstream requires upstream.baseUrl or upstream.url.",
      "External OpenAPI upstream requires upstream.spec, upstream.specUrl, or upstream.specFile.",
      "External service health check type is not supported: bogus."
    ]));

    const rpcValidation = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "rpc-service",
        serviceName: "RPC Service",
        upstream: {
          type: "rpc"
        },
        tools: [
          {
            operationId: "rpc.echo",
            rpc: {
              endpointRef: "primary"
            }
          }
        ]
      },
      cwd,
      requireKnownPaths: false
    });
    expect(rpcValidation.errors).toEqual(expect.arrayContaining([
      "External RPC upstream requires upstream.url or upstream.baseUrl.",
      "External RPC tool rpc.echo references unknown endpointRef: primary.",
      expect.stringContaining("External RPC tool rpc.echo requires an explicit RPC endpoint path")
    ]));

    const healthWarning = await validateExternalServiceConfig({
      config: {
        kind: EXTERNAL_SERVICE_CONFIG_KIND,
        serviceId: "health-service",
        serviceName: "Health Service",
        healthCheck: {
          type: "http"
        }
      },
      cwd,
      requireKnownPaths: false
    });
    expect(healthWarning.warnings).toContain("External service HTTP health check has no url or port.");

    const configPath = path.join(cwd, "fallback-service.json");
    await writeText(configPath, JSON.stringify({
      serviceName: "Fallback Service"
    }, null, 2));
    const loaded = await loadExternalServiceConfig(configPath);
    expect(loaded.filePath).toBe(configPath);
    expect(loaded.config.serviceId).toBe("fallback-service");
  });

  it("reuses source-root scripts and packages external artifacts", async () => {
    const cwd = await tempDir("pact-external-service-adapter-artifacts-cwd-");
    const sourceRoot = await tempDir("pact-external-service-adapter-artifacts-source-");
    const outputRoot = await tempDir("pact-external-service-adapter-artifacts-output-");
    const externalScriptRoot = await tempDir("pact-external-service-adapter-artifacts-script-");

    await writeText(path.join(sourceRoot, "scripts", "keep.sh"), "#!/bin/sh\nexit 0\n");
    await writeText(path.join(cwd, "service-root", "README.md"), "service root\n");
    await writeText(path.join(externalScriptRoot, "start.sh"), "#!/bin/sh\necho start\n");

    const config = normalizeExternalServiceConfig({
      serviceId: "artifact-service",
      serviceName: "Artifact Service",
      displayName: "Artifact Service",
      mode: "connected",
      scripts: {
        prepare: {
          path: "scripts/keep.sh"
        },
        start: {
          path: path.join(externalScriptRoot, "start.sh")
        }
      },
      scriptRoots: ["service-root"],
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

    const result = await writeExternalServiceArtifacts({
      config,
      sourceRoot,
      outputRoot,
      cwd
    });

    expect(result).toMatchObject({
      ok: true,
      serviceId: "artifact-service",
      copiedPaths: [
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

    const packagedConfig = JSON.parse(await fs.readFile(result.sourceConfigPath, "utf8"));
    expect(packagedConfig.scripts.prepare.path).toBe("scripts/keep.sh");
    expect(packagedConfig.scripts.start.path).toBe("composition/external-service-scripts/2-start.sh");
    expect(packagedConfig.scriptRoots).toEqual(["composition/external-service-scripts/root-1-service-root"]);
    await expect(fs.readFile(path.join(sourceRoot, "composition", "EXTERNAL_SERVICE.md"), "utf8"))
      .resolves.toContain("Artifact Service");
    await expect(fs.readFile(path.join(outputRoot, "external-service.config.json"), "utf8"))
      .resolves.toContain("artifact-service");
  });

  it("awaits local grant and uninstall providers", async () => {
    const provider = createProvider({
      createLocalMcpGrant: vi.fn(async () => ({
        status: 201,
        body: {
          ok: true,
          grant: {
            id: "local-grant-async"
          }
        }
      })),
      markLocalMcpGrantUninstalled: vi.fn(async () => ({
        status: 202,
        body: {
          ok: true,
          uninstalled: true
        }
      }))
    });

    const grantResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-grant" }),
      response: grantResponse,
      requestBody: Buffer.from(JSON.stringify({ config: { serviceId: "saved-service" } }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: provider
    });
    expect(grantResponse.statusCode).toBe(201);
    expect(parseBodyJson(grantResponse)).toEqual({
      ok: true,
      grant: {
        id: "local-grant-async"
      }
    });

    const uninstallResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-uninstall" }),
      response: uninstallResponse,
      requestBody: Buffer.from(JSON.stringify({ config: { serviceId: "saved-service" } }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: provider
    });
    expect(uninstallResponse.statusCode).toBe(202);
    expect(parseBodyJson(uninstallResponse)).toEqual({
      ok: true,
      uninstalled: true
    });
  });

  it("normalizes MCP request envelopes and returns tool call fallbacks", async () => {
    const provider = createProvider();

    const batchResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-batch" }),
      response: batchResponse,
      requestBody: Buffer.from(JSON.stringify([
        {
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: {}
        },
        {
          jsonrpc: "2.0",
          id: "ping-1",
          method: "ping",
          params: {}
        }
      ]), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    expect(batchResponse.statusCode).toBe(200);
    expect(parseBodyJson(batchResponse)).toEqual([
      {
        jsonrpc: "2.0",
        id: "init-1",
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {
              listChanged: true
            }
          },
          serverInfo: {
            name: "Pact",
            version: expect.any(String)
          },
          _meta: expect.objectContaining({
            interfaceVersion: MCP_INTERFACE_VERSION
          })
        }
      },
      {
        jsonrpc: "2.0",
        id: "ping-1",
        result: {}
      }
    ]);

    const toolsListResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-tools-list",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: toolsListResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
        params: {}
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const toolsListBody = parseBodyJson(toolsListResponse);
    expect(toolsListResponse.statusCode).toBe(200);
    expect(toolsListBody.result.tools).toHaveLength(5);
    expect(toolsListBody.result.tools[0]).toHaveProperty("name", "pact.discovery");
    expect(toolsListBody.result._meta).toEqual(expect.objectContaining({
      interfaceVersion: MCP_INTERFACE_VERSION
    }));

    const metaResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-meta",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: metaResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "meta-1",
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
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const metaBody = parseBodyJson(metaResponse);
    expect(metaResponse.statusCode).toBe(200);
    expect(metaBody.result.structuredContent.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "sharedspace.file.write" }),
      expect.objectContaining({ name: "knowledge.find" })
    ]));
    expect(metaBody.result.structuredContent.outlets["pact.sharedspace"].operationCount).toBe(1);
    expect(metaBody.result.structuredContent.outlets["pact.knowledge"].operationCount).toBe(1);

    const updateResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-update",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: updateResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "update-1",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.update",
            input: {
              clientVersion: "0.0.0"
            }
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const updateBody = parseBodyJson(updateResponse);
    expect(updateResponse.statusCode).toBe(200);
    expect(updateBody.result.structuredContent.updateAvailable).toBe(true);
    expect(updateBody.result.structuredContent.autoUpdate).toBe(true);
    expect(updateBody.result.content[0].text).toContain("Pact MCP connector");
  });

  it("surfaces invalid envelopes, outlet mismatches, and tool execution fallbacks", async () => {
    const provider = createProvider();

    const invalidVersionResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-invalid-version" }),
      response: invalidVersionResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "bad-version",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: "2024-01-01",
            operation: "pact.capabilities.list",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });
    expect(parseBodyJson(invalidVersionResponse)).toEqual({
      jsonrpc: "2.0",
      id: "bad-version",
      error: {
        code: -32602,
        message: "Unsupported Pact MCP apiVersion: 2024-01-01",
        data: {
          expectedApiVersion: MCP_INTERFACE_VERSION,
          toolsetVersion: expect.any(String),
          upgrade: expect.any(Object)
        }
      }
    });

    const missingOperationResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-missing-operation" }),
      response: missingOperationResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "missing-operation",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });
    expect(parseBodyJson(missingOperationResponse).error).toEqual({
      code: -32602,
      message: "pact.call requires arguments.operation.",
      data: {
        expectedApiVersion: MCP_INTERFACE_VERSION
      }
    });

    const outletNameResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-outlet-name" }),
      response: outletNameResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "outlet-name",
        method: "tools/call",
        params: {
          name: MCP_STABLE_TOOL_NAME,
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "pact.discovery",
            input: {}
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });
    expect(parseBodyJson(outletNameResponse).error.code).toBe(-32602);
    expect(parseBodyJson(outletNameResponse).error.data.code).toBe("outlet_name_used_as_operation");

    const mismatchResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-mismatch",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: mismatchResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "mismatch",
        method: "tools/call",
        params: {
          name: "pact.knowledge",
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "sharedspace.file.write",
            input: {
              workspaceId: "workspace_abc",
              path: "notes/report.md"
            }
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const mismatchBody = parseBodyJson(mismatchResponse);
    expect(mismatchBody.error).toEqual(expect.objectContaining({
      code: -32602,
      message: "Operation sharedspace.file.write must be called through pact.sharedspace, not pact.knowledge.",
      data: expect.objectContaining({
        code: "operation_outlet_mismatch",
        operation: "sharedspace.file.write",
        requestedTool: "pact.knowledge",
        expectedTool: "pact.sharedspace",
        architectureCategory: "Sharedspace",
        discoveryTool: "pact.discovery",
        discoveryOperation: "pact.capabilities.list"
      })
    }));

    const sharedspaceResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-sharedspace",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: sharedspaceResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "sharedspace",
        method: "tools/call",
        params: {
          name: "pact.sharedspace",
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "sharedspace.file.write",
            input: {
              workspaceId: "workspace_abc",
              path: "notes/report.md"
            }
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const sharedspaceBody = parseBodyJson(sharedspaceResponse);
    expect(sharedspaceResponse.statusCode).toBe(200);
    expect(sharedspaceBody.result.structuredContent.operation).toBe("sharedspace.file.write");
    expect(sharedspaceBody.result.structuredContent.exchange).toMatchObject({
      action: "file-written",
      outlet: "pact.sharedspace",
      path: "notes/report.md"
    });
    expect(sharedspaceBody.result.structuredContent.target).toMatchObject({
      targetKind: "sharedspace",
      targetProvider: "pact",
      status: "ok"
    });

    const failureResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-failure",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response: failureResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "failure",
        method: "tools/call",
        params: {
          name: "pact.knowledge",
          arguments: {
            apiVersion: MCP_INTERFACE_VERSION,
            operation: "knowledge.find",
            input: {
              query: "pact"
            }
          }
        }
      }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider,
      listenUrl: "http://127.0.0.1:7228/"
    });
    const failureBody = parseBodyJson(failureResponse);
    expect(failureResponse.statusCode).toBe(429);
    expect(failureBody.error).toEqual({
      code: -32000,
      message: "Knowledge service busy.",
      data: {
        code: "knowledge_busy",
        status: 429,
        details: {
          retryAfter: 30
        },
        traceId: "trace-knowledge",
        target: expect.any(Object)
      }
    });
    expect(failureBody.error.data.target).toMatchObject({
      targetKind: "knowledge",
      targetProvider: "pact"
    });
    expect(provider.publicMcpToolPayload).toHaveBeenCalled();
    expect(provider.executeTool).toHaveBeenCalled();
  });
});
