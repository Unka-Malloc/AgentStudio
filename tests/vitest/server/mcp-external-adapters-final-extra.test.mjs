import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loadCompositionPresetsMock = vi.hoisted(() => vi.fn());
const describeExternalMcpToolCacheSyncMock = vi.hoisted(() => vi.fn());
const discoverExternalMcpToolsMock = vi.hoisted(() => vi.fn());
const discoverExternalHttpToolsMock = vi.hoisted(() => vi.fn());
const refreshExternalMcpToolCacheMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/composition-management/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/composition-management/index.mjs");
  return {
    ...actual,
    loadCompositionPresets: loadCompositionPresetsMock
  };
});

vi.mock("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs");
  return {
    ...actual,
    describeExternalMcpToolCacheSync: describeExternalMcpToolCacheSyncMock,
    discoverExternalHttpTools: discoverExternalHttpToolsMock,
    discoverExternalMcpTools: discoverExternalMcpToolsMock,
    refreshExternalMcpToolCache: refreshExternalMcpToolCacheMock
  };
});

import {
  describeExternalServices,
  externalServiceRegistryPath,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfigPayload
} from "../../../server/platform/common/composition-management/external-service-registry.mjs";
import {
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

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
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

function createMcpProvider({
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
  publicMcpToolPayload = vi.fn(async ({ payload }) => payload),
  createLocalMcpGrant = vi.fn(async () => ({
    status: 200,
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
    visibleGrantSummary,
    resolveMcpWorkspaceInput,
    executeTool,
    publicMcpToolPayload,
    createLocalMcpGrant,
    markLocalMcpGrantUninstalled
  };
}

afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("mcp and external service adapter final extras", () => {
  it("handles local grant and uninstall failures with the expected HTTP envelopes", async () => {
    const noProviderResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-missing-provider" }),
      response: noProviderResponse,
      requestBody: Buffer.from("{}", "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });

    expect(noProviderResponse.statusCode).toBe(503);
    expect(parseBodyJson(noProviderResponse)).toEqual({
      ok: false,
      error: {
        code: "tool_skill_management_unavailable",
        message: "Tool/Skill management provider is unavailable."
      }
    });

    const logger = { warn: vi.fn() };
    const provider = createMcpProvider({
      createLocalMcpGrant: vi.fn(() => {
        throw new Error("grant exploded");
      }),
      markLocalMcpGrantUninstalled: vi.fn(async () => {
        throw new Error("uninstall exploded");
      })
    });

    const grantResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-grant" }),
      response: grantResponse,
      requestBody: Buffer.from(JSON.stringify({ config: { serviceId: "saved-service" } }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      toolSkillManagementProvider: provider,
      logger
    });

    expect(grantResponse.statusCode).toBe(400);
    expect(parseBodyJson(grantResponse)).toEqual({
      ok: false,
      error: {
        code: "local_grant_failed",
        message: "MCP local grant request could not be processed."
      }
    });
    expect(logger.warn).toHaveBeenCalledWith("mcp.local_grant.failed", {
      requestId: "req-grant",
      error: "grant exploded"
    });

    const uninstallResponse = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({ requestId: "req-uninstall" }),
      response: uninstallResponse,
      requestBody: Buffer.from(JSON.stringify({ config: { serviceId: "saved-service" } }), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-uninstall"),
      toolSkillManagementProvider: provider,
      logger
    });

    expect(uninstallResponse.statusCode).toBe(400);
    expect(parseBodyJson(uninstallResponse)).toEqual({
      ok: false,
      error: {
        code: "local_uninstall_failed",
        message: "MCP local uninstall update could not be processed."
      }
    });
    expect(logger.warn).toHaveBeenCalledWith("mcp.local_uninstall.failed", {
      requestId: "req-uninstall",
      error: "uninstall exploded"
    });
  });

  it("parses batch MCP requests and preserves tool failure status codes", async () => {
    const provider = createMcpProvider({
      executeTool: vi.fn(async () => ({
        ok: false,
        status: 429,
        payload: {
          error: {
            code: "rate_limited",
            message: "Rate limited",
            details: {
              retryAfterSeconds: 3
            }
          }
        }
      }))
    });

    const response = createHttpResponse();
    await handlePactMcpHttpRequest({
      request: createHttpRequest({
        requestId: "req-batch",
        headers: {
          authorization: "Bearer granted-token"
        }
      }),
      response,
      requestBody: Buffer.from(JSON.stringify([
        {
          jsonrpc: "2.0",
          method: "notifications/ping"
        },
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: MCP_STABLE_TOOL_NAME,
            arguments: {
              apiVersion: MCP_INTERFACE_VERSION,
              operation: "knowledge.find",
              input: {
                query: "facts"
              }
            }
          }
        }
      ]), "utf8"),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/mcp"),
      toolSkillManagementProvider: provider
    });

    const body = parseBodyJson(response);
    expect(response.statusCode).toBe(429);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32000,
        message: "Rate limited",
        data: {
          code: "rate_limited",
          status: 429,
          details: {
            retryAfterSeconds: 3
          }
        }
      }
    });
  });

  it("covers adapter missing-config, invalid-file, and write-null boundaries", async () => {
    const cwd = await tempDir("pact-mcp-external-adapter-cwd-");
    const sourceRoot = await tempDir("pact-mcp-external-adapter-source-");

    expect(normalizeExternalServiceConfig(null)).toBeNull();
    expect(normalizeExternalServiceConfig(["not", "an", "object"])).toBeNull();

    const invalidValidation = await validateExternalServiceConfig({
      config: null,
      cwd,
      requireKnownPaths: false
    });
    expect(invalidValidation).toEqual({
      ok: false,
      errors: ["External service config must be a JSON object."],
      warnings: []
    });

    await expect(loadExternalServiceConfig(path.join(cwd, "missing", "external-service.json"))).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(writeExternalServiceArtifacts({ config: null, sourceRoot }))
      .resolves.toBeNull();
  });

  it("verifies, saves, refreshes, and describes external service configs across the registry boundary", async () => {
    const userDataPath = await tempDir("pact-mcp-external-registry-");
    const cwd = process.cwd();
    const registryPath = externalServiceRegistryPath(userDataPath);

    loadCompositionPresetsMock.mockResolvedValue([
      {
        filePath: path.join(cwd, "preset-service.preset.json"),
        preset: {
          presetId: "preset-service",
          displayName: "Preset Service",
          deploymentTarget: {
            serviceName: "preset.service"
          },
          intent: {
            serviceKind: "external-service",
            summary: "Preset-backed service"
          },
          externalService: normalizeExternalServiceConfig({
            serviceId: "preset-service",
            serviceName: "preset.service",
            displayName: "Preset Service",
            mode: "connected",
            startupPolicy: "external-only",
            upstream: {
              type: "openapi",
              baseUrl: "https://api.example.test:8443",
              spec: {
                openapi: "3.0.0",
                paths: {}
              }
            },
            binding: {
              mode: "compile",
              outlet: "pact.skillHub"
            }
          })
        }
      }
    ]);
    describeExternalMcpToolCacheSyncMock.mockReturnValue({
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: {
        "saved-service": { toolCount: 1 }
      }
    });
    discoverExternalMcpToolsMock.mockResolvedValue({
      ok: true,
      serviceId: "saved-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2024-02-03T04:05:06.000Z"
    });
    refreshExternalMcpToolCacheMock.mockResolvedValue({
      ok: true,
      serviceId: "saved-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2024-02-03T04:05:06.000Z",
      cachePath: path.join(userDataPath, "cache.json")
    });

    const invalidPayload = await verifyExternalServiceConfigPayload({
      payload: {
        configText: "{not-json"
      }
    });
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.validation.errors).toEqual([
      "External service config JSON parse failed."
    ]);

    const validPayload = await verifyExternalServiceConfigPayload({
      payload: {
        configText: JSON.stringify({
          serviceId: "saved-service",
          serviceName: "Saved Service",
          displayName: "Saved Service",
          mode: "connected",
          startupPolicy: "external-only",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "http://127.0.0.1:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub"
          }
        })
      }
    });
    expect(validPayload.ok).toBe(true);
    expect(validPayload.config.serviceId).toBe("saved-service");
    expect(validPayload.validation.ok).toBe(true);

    const invalidSave = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        configText: "{not-json"
      }
    });
    expect(invalidSave.ok).toBe(false);
    expect(invalidSave.validation.errors).toEqual([
      "External service config JSON parse failed."
    ]);
    await expect(fs.access(registryPath)).rejects.toMatchObject({
      code: "ENOENT"
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: validPayload.config
      }
    });
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));

    expect(saved.ok).toBe(true);
    expect(saved.activeServiceId).toBe("saved-service");
    expect(saved.externalMcpDiscovery).toMatchObject({
      ok: true,
      serviceId: "saved-service",
      toolCount: 1
    });
    expect(saved.externalToolDiscovery).toMatchObject({
      ok: true,
      toolCount: 1
    });
    expect(registry.activeServiceId).toBe("saved-service");
    expect(registry.services).toHaveLength(1);
    expect(discoverExternalMcpToolsMock).toHaveBeenCalledTimes(1);
    expect(refreshExternalMcpToolCacheMock).toHaveBeenCalledTimes(1);

    const refreshed = await refreshExternalServiceRuntime({
      userDataPath,
      serviceId: "saved-service"
    });

    expect(refreshed.ok).toBe(true);
    expect(refreshed.requestedServiceId).toBe("saved-service");
    expect(refreshed.results).toEqual([
      expect.objectContaining({
        serviceId: "saved-service",
        status: "refreshed",
        ok: true,
        toolCount: 1
      })
    ]);
    expect(refreshed.state.activeServiceId).toBe("saved-service");
    expect(refreshExternalMcpToolCacheMock).toHaveBeenCalledTimes(2);

    const described = await describeExternalServices({
      userDataPath,
      cwd
    });

    expect(described.ok).toBe(true);
    expect(described.activeServiceId).toBe("saved-service");
    expect(described.configuredCount).toBe(1);
    expect(described.presetCount).toBe(1);
    expect(described.externalMcpCache.serviceCount).toBe(1);
    expect(described.services.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(["saved-service", "preset-service", "pact.upstream.cloud-drive"])
    );
  });
});
