import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeExternalServiceConfig,
  validateExternalServiceConfig,
  writeExternalServiceArtifacts
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import {
  EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
  EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION,
  createExternalMcpPassthroughRuntime,
  describeExternalMcpToolCacheSync,
  discoverExternalHttpTools,
  externalMcpToolCachePath,
  listExternalMcpVirtualOperationsSync,
  parseExplicitHttpUrl,
  refreshExternalMcpToolCache
} from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
import {
  downloadRuntimeDependency,
  runtimeDependencySourceConfigPath,
  updateRuntimeDependencyConfiguration
} from "../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

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
    async json() {
      return typeof body === "string" ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("composition and runtime final extra 5", () => {
  it("validates external service error branches and packages no-path scripts", async () => {
    await expect(validateExternalServiceConfig({ config: null })).resolves.toMatchObject({
      ok: false,
      errors: ["External service config must be a JSON object."]
    });

    const invalid = normalizeExternalServiceConfig({
      id: "",
      serviceName: "",
      kind: "wrong.kind",
      startupPolicy: "with-platform",
      prepareCommand: { args: ["missing-executable"] },
      upstream: {
        type: "cloud-drive",
        provider: "box",
        mode: "remote-live",
        endpointUrl: "ftp://example.invalid/root",
        secretRef: "plain-secret"
      },
      binding: {
        mode: "bad-mode",
        outlet: "bad.outlet",
        risk: "bad-risk"
      },
      healthCheck: {
        type: "unknown"
      }
    });

    const invalidResult = await validateExternalServiceConfig({ config: invalid, requireKnownPaths: false });
    expect(invalidResult.errors).toEqual(expect.arrayContaining([
      "External service config kind must be pact.external-service.config.",
      "External service config is missing serviceId.",
      "External service config is missing serviceName.",
      "External service script prepare must declare path or command.executable.",
      "External service startupPolicy with-platform requires scripts.start.",
      "External cloud-drive upstream provider is not supported: box.",
      "External cloud-drive OAuth provider secret must use a secret:// secretRef."
    ]));

    const mcp = normalizeExternalServiceConfig({
      serviceId: "mcp-stdio",
      serviceName: "MCP stdio",
      upstream: {
        type: "mcp",
        transport: "stdio"
      }
    });
    await expect(validateExternalServiceConfig({ config: mcp, requireKnownPaths: false }))
      .resolves.toMatchObject({
        errors: expect.arrayContaining(["External MCP upstream transport must be streamable-http or sse; stdio is not allowed for ServiceHub."])
      });

    expect(await writeExternalServiceArtifacts({ config: null })).toBeNull();
    const sourceRoot = await tempDir("pact-composition-runtime-source-");
    const cwd = await tempDir("pact-composition-runtime-cwd-");
    const artifacts = await writeExternalServiceArtifacts({
      sourceRoot,
      cwd,
      config: normalizeExternalServiceConfig({
        serviceId: "no-path-script",
        serviceName: "No Path Script",
        scripts: {
          prepare: {
            command: {
              executable: "node",
              args: ["prepare.mjs"]
            }
          }
        },
        upstream: {
          type: "other"
        }
      })
    });
    expect(artifacts).toMatchObject({ ok: true, serviceId: "no-path-script", copiedPaths: [] });
  });

  it("compiles OpenAPI and RPC tools from specs, files, and endpoint maps", async () => {
    const specRoot = await tempDir("pact-composition-runtime-spec-");
    const specFile = path.join(specRoot, "openapi.json");
    await writeJson(specFile, {
      openapi: "3.0.0",
      paths: {
        "/items/{id}": {
          parameters: [{ name: "tenant", in: "query", schema: { type: "string" } }],
          get: {
            operationId: "getItem",
            summary: "Get Item",
            parameters: [
              { name: "id", in: "path", schema: { type: "string" } },
              { name: "", in: "query", schema: { type: "string" } }
            ],
            responses: {}
          },
          post: {
            operationId: "postItem",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "string" }
                }
              }
            },
            responses: {}
          },
          head: {
            operationId: "ignoredHead"
          }
        }
      }
    });

    const openapi = await discoverExternalHttpTools({
      serviceId: "openapi-file",
      serviceName: "OpenAPI File",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api",
        specFile
      },
      binding: {
        mode: "compile",
        requiredScopes: ["items:read"],
        risk: "safe_write"
      }
    });
    expect(openapi).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_HTTP_COMPILE_PROTOCOL_VERSION,
      toolCount: 2
    });
    expect(openapi.tools.map((tool) => tool.name).sort()).toEqual(["getItem", "postItem"]);
    expect(openapi.tools.find((tool) => tool.name === "postItem").inputSchema).toMatchObject({
      required: ["body"],
      properties: {
        body: { type: "string" }
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(createFetchResponse({
      ok: false,
      status: 503,
      body: { error: "no spec" }
    }));
    await expect(discoverExternalHttpTools({
      serviceId: "openapi-spec-url",
      upstream: {
        type: "openapi",
        baseUrl: "http://127.0.0.1:8787/api",
        specUrl: "http://127.0.0.1:8787/openapi.json"
      },
      binding: { mode: "compile" }
    })).rejects.toThrow("External OpenAPI spec fetch failed with HTTP 503.");
    fetchMock.mockRestore();

    await expect(discoverExternalHttpTools({
      serviceId: "not-compile",
      upstream: { type: "http", url: "http://127.0.0.1:8787" },
      binding: { mode: "passthrough" }
    })).resolves.toMatchObject({
      ok: false,
      error: "Config is not an HTTP compile external service."
    });

    const rpc = await discoverExternalHttpTools({
      serviceId: "rpc-map",
      upstream: {
        type: "rpc",
        baseUrl: "http://127.0.0.1:8787/root",
        rpcEndpoints: {
          primary: "http://127.0.0.1:8787/rpc"
        }
      },
      binding: {
        mode: "compile"
      },
      tools: [
        { operationId: "math.add", rpc: { endpointRef: "primary", method: "math.add" } }
      ]
    });
    expect(rpc).toMatchObject({
      ok: true,
      protocolVersion: EXTERNAL_RPC_COMPILE_PROTOCOL_VERSION,
      tools: [expect.objectContaining({
        name: "math.add",
        rpc: expect.objectContaining({
          endpointRef: "primary",
          method: "math.add"
        })
      })]
    });

    await expect(discoverExternalHttpTools({
      serviceId: "rpc-missing-path",
      upstream: {
        type: "rpc",
        baseUrl: "http://127.0.0.1:8787"
      },
      binding: { mode: "compile" },
      tools: [
        { operationId: "rpc.noPath", rpc: { method: "noPath" } }
      ]
    })).rejects.toThrow("External RPC tools require an explicit endpoint path");
  });

  it("calls cached compiled HTTP tools with templates, query values, result paths, and errors", async () => {
    const userDataPath = await tempDir("pact-composition-runtime-cache-");
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: "pact.external-mcp.tool-cache",
      updatedAt: "2026-06-05T00:00:00.000Z",
      services: {
        "compiled-http": {
          serviceId: "compiled-http",
          serviceName: "Compiled HTTP",
          upstream: {
            type: "openapi",
            url: "http://127.0.0.1:8787/api"
          },
          binding: {
            mode: "compile",
            requiredScopes: ["items:read"],
            risk: "read_only"
          },
          tools: [
            {
              name: "listItems",
              transport: { method: "GET", path: "/items/:id" },
              request: {
                query: {
                  filter: "$input.filter",
                  tags: "$input.tags",
                  object: "$input.object"
                },
                headers: {
                  "x-tool": "$tool.name",
                  "x-operation": "$operationId"
                }
              },
              response: {
                resultPath: "$.data.items"
              },
              openapi: {
                operationId: "listItems",
                parameters: [{ name: "q", in: "query" }]
              }
            },
            {
              name: "createItem",
              transport: { method: "POST", path: "/items/{id}" },
              request: {
                body: {
                  payload: "$input",
                  requestId: "$request.id"
                }
              },
              response: {
                resultPath: "data.created"
              }
            },
            {
              name: "plainText",
              transport: { method: "DELETE", path: "" },
              request: {},
              response: {}
            }
          ],
          toolCount: 3,
          discoveredAt: "2026-06-05T00:00:00.000Z",
          fingerprint: "fingerprint"
        }
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(createFetchResponse({
        headers: { "content-type": "application/json" },
        body: { data: { items: ["a", "b"] } }
      }))
      .mockResolvedValueOnce(createFetchResponse({
        headers: { "content-type": "application/json" },
        body: { data: { created: true } }
      }))
      .mockResolvedValueOnce(createFetchResponse({
        headers: { "content-type": "text/plain" },
        body: "deleted"
      }))
      .mockResolvedValueOnce(createFetchResponse({
        ok: false,
        status: 418,
        headers: { "content-type": "application/json" },
        body: { error: "teapot" }
      }));

    const runtime = createExternalMcpPassthroughRuntime({ userDataPath });
    await expect(runtime.callTool({
      serviceId: "compiled-http",
      toolName: "listItems",
      input: {
        id: "item 1",
        filter: "active",
        tags: ["one", "two"],
        object: { nested: true }
      }
    })).resolves.toMatchObject({
      ok: true,
      result: ["a", "b"]
    });
    expect(fetchMock.mock.calls[0][0]).toContain("/items/item%201");
    expect(fetchMock.mock.calls[0][0]).toContain("filter=active");
    expect(fetchMock.mock.calls[0][0]).toContain("tags=two");
    expect(fetchMock.mock.calls[0][1].headers["x-tool"]).toBe("listItems");

    await expect(runtime.callTool({
      serviceId: "compiled-http",
      toolName: "createItem",
      input: { id: "created", name: "Created Item" }
    })).resolves.toMatchObject({
      ok: true,
      result: true
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      payload: { id: "created", name: "Created Item" }
    });

    await expect(runtime.callTool({
      serviceId: "compiled-http",
      toolName: "plainText",
      input: { ignored: true }
    })).resolves.toMatchObject({
      ok: true,
      result: "deleted"
    });

    await expect(runtime.callTool({
      serviceId: "compiled-http",
      toolName: "missing"
    })).rejects.toMatchObject({
      code: "external_http_tool_not_registered"
    });

    await expect(runtime.callTool({
      serviceId: "compiled-http",
      toolName: "listItems",
      input: { id: "boom" }
    })).rejects.toMatchObject({
      statusCode: 418,
      payload: { error: "teapot" }
    });
  });

  it("refreshes and describes cache entries while skipping invalid services", async () => {
    const userDataPath = await tempDir("pact-composition-runtime-cache-sync-");
    const skipped = await refreshExternalMcpToolCache({
      userDataPath,
      config: {
        serviceId: "plain",
        upstream: { type: "other" },
        binding: { mode: "compile" }
      }
    });
    expect(skipped).toMatchObject({
      ok: true,
      skipped: true,
      reason: "not_external_tool_service"
    });

    await refreshExternalMcpToolCache({
      userDataPath,
      config: {
        serviceId: "compiled",
        serviceName: "Compiled",
        upstream: { type: "http", url: "http://127.0.0.1:8787/api" },
        binding: { mode: "compile", requiredScopes: ["compiled:call"] },
        tools: [
          { name: "bad" },
          { name: "okTool", method: "GET", path: "/ok" }
        ]
      }
    });

    const cache = describeExternalMcpToolCacheSync({ userDataPath });
    expect(cache.services.compiled).toMatchObject({
      serviceId: "compiled",
      toolCount: 1,
      activeToolCount: 0,
      candidateToolCount: 1,
      tools: ["okTool"],
      activeTools: [],
      candidateTools: ["okTool"]
    });
    expect(listExternalMcpVirtualOperationsSync({ userDataPath }).map((operation) => operation.id))
      .toEqual([]);
  });

  it("updates runtime dependency source config and returns dry-run download plans", async () => {
    const userDataPath = await tempDir("pact-composition-runtime-dependencies-");

    await expect(updateRuntimeDependencyConfiguration({
      userDataPath,
      entries: []
    })).rejects.toThrow("Runtime dependency configuration update requires entries.");
    await expect(updateRuntimeDependencyConfiguration({
      userDataPath,
      entries: [{ key: "bad.key", value: "x" }]
    })).rejects.toThrow("Unsupported runtime dependency configuration key: bad.key");
    await expect(downloadRuntimeDependency({
      userDataPath,
      targetId: "not-a-runtime"
    })).rejects.toThrow("Unsupported runtime dependency target: not-a-runtime");

    const update = await updateRuntimeDependencyConfiguration({
      userDataPath,
      entries: [
        { key: "sources.gerrit.warUrl", value: "https://example.invalid/gerrit.war" },
        { key: "sources.gerrit.mirrors", value: "https://m1.invalid/war\nhttps://m2.invalid/war" },
        { key: "sources.caddy.url", value: "https://example.invalid/caddy.tar.gz" },
        { key: "sources.caddy.version", value: "2.9.0" }
      ]
    });
    expect(update).toMatchObject({
      ok: true,
      updated: 4,
      sourceConfigPath: runtimeDependencySourceConfigPath({ userDataPath })
    });

    const config = JSON.parse(await fs.readFile(update.sourceConfigPath, "utf8"));
    expect(config.sources.gerrit.default.warUrl).toBe("https://example.invalid/gerrit.war");
    expect(config.sources.gerrit.mirrors).toEqual(["https://m1.invalid/war", "https://m2.invalid/war"]);
    expect(config.sources.caddy.default.url).toBe("https://example.invalid/caddy.tar.gz");
    expect(config.sources.caddy.version).toBe("2.9.0");

    const gerritPlan = await downloadRuntimeDependency({
      userDataPath,
      targetId: "gerrit",
      dryRun: true,
      version: "3.11.0",
      root: path.join(userDataPath, "gerrit-root")
    });
    expect(gerritPlan).toMatchObject({
      ok: true,
      targetId: "gerrit",
      status: "installed",
      planned: true
    });
    expect(gerritPlan.command).toEqual([process.execPath, "server/scripts/gerrit-local.mjs", "download"]);

    const caddyPlan = await downloadRuntimeDependency({
      userDataPath,
      targetId: "caddy",
      dryRun: true,
      gatewayRuntimeCacheRoot: path.join(userDataPath, "gateway-cache")
    });
    expect(caddyPlan).toMatchObject({
      ok: true,
      targetId: "caddy",
      status: "installed",
      planned: true
    });
    expect(caddyPlan.command).toContain("--gateway");
  });

  it("parses explicit HTTP URLs with edge ports and rejects malformed values", () => {
    expect(parseExplicitHttpUrl("http://[::1]:8787/mcp").explicitPort).toBe("8787");
    expect(parseExplicitHttpUrl("https://example.test:65535/path").parsed.pathname).toBe("/path");
    expect(() => parseExplicitHttpUrl("https://example.test/no-port", "upstream.url"))
      .toThrow("upstream.url must include an explicit port");
    expect(() => parseExplicitHttpUrl("ftp://example.test:21/file", "upstream.url"))
      .toThrow("upstream.url must use http or https.");
    expect(() => parseExplicitHttpUrl("http://example.test:99999/file", "upstream.url"))
      .toThrow("upstream.url must be a valid http(s) URL.");
  });
});
