import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadCompositionPresetsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/composition-management/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/composition-management/index.mjs");
  return {
    ...actual,
    loadCompositionPresets: loadCompositionPresetsMock
  };
});

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
  describeExternalMcpToolCacheSync,
  discoverExternalMcpTools,
  EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
  EXTERNAL_MCP_CACHE_KIND,
  externalMcpToolCachePath,
  listExternalMcpVirtualOperationsSync
} from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
import {
  describeExternalServices,
  externalServiceRegistryPath,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfigPayload
} from "../../../server/platform/common/composition-management/external-service-registry.mjs";

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

function createFetchResponse({ ok = true, status = 200, body = "", headers = {} } = {}) {
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

beforeEach(() => {
  loadCompositionPresetsMock.mockResolvedValue([]);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("external service composition final extra 3", () => {
  it("normalizes adapter boundaries and packages artifact paths", async () => {
    const cwd = await tempDir("pact-external-service-composition-adapter-cwd-");
    const sourceRoot = await tempDir("pact-external-service-composition-adapter-source-");
    const outputRoot = await tempDir("pact-external-service-composition-adapter-output-");

    await writeText(path.join(cwd, "service-config.json"), JSON.stringify({
      serviceName: "File Config",
      displayName: "File Config",
      startupPolicy: "with-platform",
      scripts: {
        start: {
          path: "scripts/start.sh"
        }
      },
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
        outlet: "pact.skillHub",
        scopes: ["models:invoke", "models:invoke", "workspace:read"]
      },
      health: {
        path: "/health",
        port: 8787
      }
    }, null, 2));

    await writeText(path.join(cwd, "scripts", "prepare.sh"), "#!/bin/sh\n");
    await writeText(path.join(sourceRoot, "cached", "start.sh"), "#!/bin/sh\n");
    await writeText(path.join(cwd, "shared-root", "README.md"), "shared root\n");

    expect(normalizeExternalServiceConfig(null)).toBeNull();
    expect(normalizeExternalServiceConfig(["bad"])).toBeNull();

    const normalized = normalizeExternalServiceConfig({
      serviceId: "artifact-service",
      serviceName: "Artifact Service",
      displayName: "Artifact Service",
      scripts: {
        prepare: {
          path: "scripts/prepare.sh"
        },
        start: {
          command: {
            executable: "node",
            args: ["server.mjs"]
          },
          path: "cached/start.sh"
        }
      },
      scriptRoots: ["shared-root"],
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
        outlet: "pact.skillHub",
        scopes: ["models:invoke", "models:invoke", "workspace:read"]
      },
      health: {
        path: "/health",
        port: 8787
      }
    });

    expect(normalized.serviceId).toBe("artifact-service");
    expect(normalized.scripts.prepare.path).toBe("scripts/prepare.sh");
    expect(normalized.scripts.start.command.executable).toBe("node");
    expect(normalized.binding.requiredScopes).toEqual(["models:invoke", "workspace:read"]);
    expect(normalized.healthCheck).toMatchObject({
      type: "http",
      host: "127.0.0.1",
      port: 8787,
      path: "/health"
    });
    expect(externalServicePathRefs(normalized)).toEqual([
      "cached/start.sh",
      "scripts/prepare.sh",
      "shared-root"
    ]);

    const loaded = await loadExternalServiceConfig(path.join(cwd, "service-config.json"), { cwd });
    expect(loaded.filePath).toBe(path.join(cwd, "service-config.json"));
    expect(loaded.config.serviceId).toBe("service-config");
    expect(loaded.config.serviceName).toBe("File Config");

    const validation = await validateExternalServiceConfig({
      config: normalized,
      cwd,
      requireKnownPaths: false
    });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);

    const preset = compositionPresetFromExternalServiceConfig(normalized, {
      filePath: loaded.filePath,
      outputRoot
    });
    expect(preset.presetId).toBe("artifact-service");
    expect(preset.deploymentTarget.outputRoot).toBe(outputRoot);
    expect(preset.applicationDependencyPackage.requiredOperations).toEqual([]);

    const artifacts = await writeExternalServiceArtifacts({
      config: normalized,
      sourceRoot,
      outputRoot,
      cwd
    });

    expect(artifacts).toMatchObject({
      ok: true,
      serviceId: "artifact-service"
    });
    expect(artifacts.copiedPaths).toHaveLength(1);
    expect(artifacts.copiedPaths[0]).toMatchObject({
      id: "prepare"
    });
    expect(artifacts.copiedRoots).toHaveLength(1);

    const packagedConfig = JSON.parse(
      await fs.readFile(path.join(sourceRoot, "composition", "external-service.config.json"), "utf8")
    );
    expect(packagedConfig.scripts.prepare.path).toContain("composition/external-service-scripts");
    expect(packagedConfig.scripts.start.path).toBe("cached/start.sh");
    expect(await fs.readFile(path.join(outputRoot, "external-service.config.json"), "utf8")).toContain(
      "\"artifact-service\""
    );
  });

  it("times out and rejects bad MCP discovery responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();

    fetchMock.mockImplementation((_url, init = {}) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("fetch aborted"));
      });
    }));

    const timeoutPromise = discoverExternalMcpTools({
      serviceId: "mcp-timeout",
      serviceName: "MCP Timeout",
      displayName: "MCP Timeout",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "https://mcp.example.test:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub"
      }
    }, { timeoutMs: 5 });

    const timeoutAssertion = expect(timeoutPromise).rejects.toThrow("fetch aborted");
    await vi.advanceTimersByTimeAsync(10);
    await timeoutAssertion;

    vi.useRealTimers();
    fetchMock.mockReset();

    fetchMock
      .mockResolvedValueOnce(createFetchResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-1"
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
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        status: 200,
        headers: {
          "content-type": "application/json"
        },
        body: ""
      }))
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        status: 200,
        headers: {
          "content-type": "application/json"
        },
        body: "{not-valid-json"
      }));

    await expect(discoverExternalMcpTools({
      serviceId: "mcp-bad-response",
      serviceName: "MCP Bad Response",
      displayName: "MCP Bad Response",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "https://mcp.example.test:8787/mcp"
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub"
      }
    })).rejects.toBeInstanceOf(SyntaxError);
  });

  it("maps runtime tools, compiled calls, and error codes from cache entries", async () => {
    const userDataPath = await tempDir("pact-external-service-composition-runtime-cache-");
    const cachePath = externalMcpToolCachePath(userDataPath);

    await writeJson(cachePath, {
      schemaVersion: 1,
      kind: EXTERNAL_MCP_CACHE_KIND,
      updatedAt: "2026-06-05T00:00:00.000Z",
      services: {
        "mcp-service": {
          serviceId: "mcp-service",
          serviceName: "MCP Service",
          displayName: "MCP Service",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://mcp.example.test:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub"
          },
          tools: [
            {
              name: "echo",
              title: "Echo",
              description: "Echo tool",
              inputSchema: {
                type: "object",
                properties: {
                  message: {
                    type: "string"
                  }
                }
              }
            }
          ],
          toolCount: 1,
          discoveredAt: "2026-06-05T00:00:00.000Z",
          fingerprint: "mcp-fingerprint"
        },
        "http-service": {
          serviceId: "http-service",
          serviceName: "HTTP Service",
          displayName: "HTTP Service",
          upstream: {
            type: "openapi",
            transport: "http",
            url: "https://http.example.test:8443/api"
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub"
          },
          tools: [
            {
              name: "http.echo",
              title: "HTTP Echo",
              description: "HTTP echo tool",
              inputSchema: {
                type: "object",
                properties: {
                  id: {
                    type: "string"
                  }
                }
              },
              transport: {
                type: "http",
                method: "POST",
                path: "/echo/{id}"
              },
              response: {
                resultPath: "$.data.answer"
              }
            }
          ],
          toolCount: 1,
          discoveredAt: "2026-06-05T00:00:00.000Z",
          fingerprint: "http-fingerprint"
        },
        "rpc-service": {
          serviceId: "rpc-service",
          serviceName: "RPC Service",
          displayName: "RPC Service",
          upstream: {
            type: "rpc",
            transport: "http",
            url: "https://rpc.example.test:9443/rpc",
            baseUrl: "https://rpc.example.test:9443/rpc",
            path: "/rpc",
            endpoints: {
              primary: {
                id: "primary",
                url: "https://rpc.example.test:9443/rpc"
              }
            }
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub"
          },
          tools: [
            {
              name: "rpc.echo",
              title: "RPC Echo",
              description: "RPC echo tool",
              inputSchema: {
                type: "object",
                properties: {
                  id: {
                    type: "string"
                  }
                }
              },
              rpc: {
                method: "echo",
                endpointRef: "primary",
                path: "/rpc"
              }
            }
          ],
          toolCount: 1,
          discoveredAt: "2026-06-05T00:00:00.000Z",
          fingerprint: "rpc-fingerprint"
        }
      }
    });

    const runtime = createExternalMcpPassthroughRuntime({
      userDataPath,
      logger: {
        info: vi.fn()
      }
    });

    const operations = listExternalMcpVirtualOperationsSync({ userDataPath });
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        featureId: "external-mcp",
        toolId: "pact.externalMcp.mcp_service.echo"
      }),
      expect.objectContaining({
        featureId: "external-http",
        toolId: "pact.externalHttp.http_service.http_echo"
      }),
      expect.objectContaining({
        featureId: "external-rpc",
        toolId: "pact.externalRpc.rpc_service.rpc_echo"
      })
    ]));

    const cacheSummary = describeExternalMcpToolCacheSync({ userDataPath });
    expect(cacheSummary.kind).toBe(EXTERNAL_MCP_CACHE_KIND);
    expect(cacheSummary.services["mcp-service"].tools).toEqual(["echo"]);
    expect(cacheSummary.services["rpc-service"].toolCount).toBe(1);

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createFetchResponse({
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-1"
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
      .mockRejectedValueOnce(new Error("notification failed"))
      .mockResolvedValueOnce(createFetchResponse({
        headers: {
          "content-type": "application/json"
        },
        body: {
          jsonrpc: "2.0",
          id: "pact-call-1",
          result: {
            content: [
              {
                type: "text",
                text: "hello"
              }
            ]
          }
        }
      }));

    const mcpResult = await runtime.callTool({
      serviceId: "mcp-service",
      toolName: "echo",
      input: {
        message: "hello"
      }
    });

    expect(mcpResult).toMatchObject({
      ok: true,
      serviceId: "mcp-service",
      upstreamToolName: "echo",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "https://mcp.example.test:8787/mcp"
      },
      result: {
        content: [
          {
            type: "text",
            text: "hello"
          }
        ]
      }
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createFetchResponse({
      headers: {
        "content-type": "application/json"
      },
      body: {
        data: {
          answer: 42
        }
      }
    }));

    const httpResult = await runtime.callTool({
      serviceId: "http-service",
      toolName: "http.echo",
      input: {
        id: "alpha",
        extra: "kept"
      }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://http.example.test:8443/api/echo/alpha");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        extra: "kept"
      })
    });
    expect(httpResult).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      serviceId: "http-service",
      upstreamToolName: "http.echo",
      result: 42
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(createFetchResponse({
      ok: false,
      status: 502,
      headers: {
        "content-type": "application/json"
      },
      body: {
        error: "bad gateway"
      }
    }));

    await expect(runtime.callTool({
      serviceId: "rpc-service",
      toolName: "rpc.echo",
      input: {
        id: "alpha"
      }
    })).rejects.toMatchObject({
      message: "External HTTP tool rpc.echo returned HTTP 502.",
      statusCode: 502,
      payload: {
        error: "bad gateway"
      }
    });

    await expect(runtime.callTool({
      serviceId: "missing-service",
      toolName: "echo"
    })).rejects.toMatchObject({
      code: "external_mcp_service_not_registered"
    });

    await expect(runtime.callTool({
      serviceId: "http-service",
      toolName: "missing-tool"
    })).rejects.toMatchObject({
      code: "external_http_tool_not_registered"
    });
  });

  it("saves, queries, and rejects registry updates across success and failure paths", async () => {
    const userDataPath = await tempDir("pact-external-service-composition-registry-");
    const cwd = await tempDir("pact-external-service-composition-registry-cwd-");
    const registryPath = externalServiceRegistryPath(userDataPath);

    const successSpecPath = path.join(cwd, "openapi-success.json");
    const failureSpecPath = path.join(cwd, "openapi-empty.json");

    await writeJson(successSpecPath, {
      openapi: "3.0.0",
      paths: {
        "/echo/{id}": {
          get: {
            operationId: "echo item",
            summary: "Echo item",
            parameters: [
              {
                name: "id",
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
    await writeJson(failureSpecPath, {
      openapi: "3.0.0",
      paths: {}
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          serviceId: "http-service",
          serviceName: "HTTP Service",
          displayName: "HTTP Service",
          mode: "connected",
          upstream: {
            type: "openapi",
            baseUrl: "https://api.example.test:8443",
            specFile: successSpecPath
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub"
          }
        }
      }
    });

    expect(saved.ok).toBe(true);
    expect(saved.externalToolDiscovery).toMatchObject({
      ok: true,
      toolCount: 1
    });
    expect(await fs.readFile(registryPath, "utf8")).toContain("\"http-service\"");
    expect(await fs.readFile(externalMcpToolCachePath(userDataPath), "utf8")).toContain("\"http-service\"");

    const described = await describeExternalServices({ userDataPath, cwd });
    expect(described.ok).toBe(true);
    expect(described.registryKind).toBe("pact.external-service.registry");
    expect(described.configuredCount).toBe(1);
    expect(described.gatewayCount).toBe(1);
    expect(described.presetCount).toBe(0);
    expect(described.activeServiceId).toBe("http-service");
    expect(described.activeConfig.serviceId).toBe("http-service");

    const filteredRefresh = await refreshExternalServiceRuntime({
      userDataPath,
      cwd,
      serviceId: "missing-service"
    });
    expect(filteredRefresh.ok).toBe(true);
    expect(filteredRefresh.requestedServiceId).toBe("missing-service");
    expect(filteredRefresh.results).toHaveLength(0);

    const failed = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          serviceId: "empty-http",
          serviceName: "Empty HTTP",
          displayName: "Empty HTTP",
          mode: "connected",
          upstream: {
            type: "openapi",
            baseUrl: "https://api.example.test:8443",
            specFile: failureSpecPath
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub"
          }
        }
      }
    });

    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("did not produce any tools");
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
    expect(registry.activeServiceId).toBe("http-service");
    expect(registry.services.map((item) => item.serviceId)).toEqual(["http-service"]);

    const payloadParseFailure = await verifyExternalServiceConfigPayload({
      payload: {
        configText: "{not-json"
      }
    });
    expect(payloadParseFailure.ok).toBe(false);
    expect(payloadParseFailure.validation.errors).toEqual([
      "External service config JSON parse failed."
    ]);
  });
});
