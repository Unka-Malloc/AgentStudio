#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  refreshExternalServiceRuntime,
  saveExternalServiceConfig
} from "../../server/platform/common/composition-management/external-service-registry.mjs";
import { createAuthorizationEngine } from "../../server/platform/common/security/authorization/authorization-engine.mjs";
import { createSecurityPermissionsProvider } from "../../server/platform/common/security/security-permissions-provider.mjs";
import { createToolManagementPlatform } from "../../server/platform/specialized/capabilities/tools/tool-management-core/index.mjs";
import {
  containerName,
  delay,
  findFreePort,
  probeExternalServiceRuntime,
  run
} from "../external-service-env-probe.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_TAG = "pact-external-http-adapters:verify";

function quietLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

async function waitForHttpUpstream(baseUrl, timeoutMs = 60_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw lastError || new Error("External HTTP service did not become ready.");
}

async function readUpstreamCalls(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/__calls`);
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    return Array.isArray(payload.calls) ? payload.calls : [];
  } catch {
    return [];
  }
}

async function stopChildProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3000).unref();
  });
}

async function startContainerUpstream({ hostPort, containerCommand, containerEngine }) {
  const serviceContainerName = containerName("pact-external-http");
  await run(containerCommand, ["build", "-t", IMAGE_TAG, "."], { cwd: SCRIPT_DIR, timeoutMs: 120_000 });
  await run(containerCommand, [
    "run",
    "-d",
    "--rm",
    "--name",
    serviceContainerName,
    "-p",
    `127.0.0.1:${hostPort}:8788`,
    IMAGE_TAG
  ], { timeoutMs: 30_000 });
  return {
    mode: "container",
    containerEngine,
    image: IMAGE_TAG,
    containerName: serviceContainerName,
    baseUrl: `http://127.0.0.1:${hostPort}`,
    async close() {
      await run(containerCommand, ["rm", "-f", serviceContainerName]).catch(() => null);
    }
  };
}

async function startLocalUpstream({ hostPort }) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: SCRIPT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(hostPort)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  return {
    mode: "local",
    containerEngine: "",
    image: "",
    containerName: "",
    baseUrl: `http://127.0.0.1:${hostPort}`,
    logs,
    async close() {
      await stopChildProcess(child);
    }
  };
}

function baseExternalConfig({ serviceId, serviceName, upstream, tools = [] }) {
  return {
    schemaVersion: 2,
    kind: "pact.external-service.config",
    serviceId,
    serviceName,
    mode: "connected",
    startupPolicy: "external-only",
    upstream,
    binding: {
      mode: "compile",
      outlet: "pact.skillHub",
      requiredScopes: ["knowledge:read"],
      risk: "read_only"
    },
    ...(tools.length ? { tools } : {})
  };
}

function openApiConfig(baseUrl) {
  return baseExternalConfig({
    serviceId: "openapi-service",
    serviceName: "external.http.openapi",
    upstream: {
      type: "openapi",
      baseUrl,
      spec: {
        openapi: "3.0.0",
        info: {
          title: "Fake OpenAPI service",
          version: "1.0.0"
        },
        paths: {
          "/openapi/items/{id}": {
            get: {
              operationId: "getItem",
              summary: "Get item",
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                },
                {
                  name: "includeMeta",
                  in: "query",
                  required: false,
                  schema: { type: "boolean" }
                }
              ],
              responses: {
                200: {
                  description: "Item",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
}

function restConfig(baseUrl) {
  return baseExternalConfig({
    serviceId: "rest-service",
    serviceName: "external.http.rest",
    upstream: {
      type: "http",
      url: baseUrl
    },
    tools: [
      {
        operationId: "search",
        label: "REST Search",
        description: "Call the external REST search endpoint.",
        transport: {
          type: "http",
          method: "POST",
          path: "/rest/search"
        },
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"]
        },
        readOnly: true,
        risk: "read_only"
      }
    ]
  });
}

function jsonRpcConfig(baseUrl) {
  return baseExternalConfig({
    serviceId: "json-rpc-service",
    serviceName: "external.http.jsonRpc",
    upstream: {
      type: "http",
      url: baseUrl
    },
    tools: [
      {
        operationId: "classify",
        label: "JSON Endpoint Classify",
        description: "Wrap a single JSON endpoint with an explicit request envelope.",
        transport: {
          type: "http",
          method: "POST",
          path: "/rpc"
        },
        request: {
          body: {
            action: "classify",
            payload: "$input"
          }
        },
        response: {
          resultPath: "result"
        },
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" }
          },
          required: ["text"]
        },
        readOnly: true,
        risk: "read_only"
      }
    ]
  });
}

function rpcConfig(baseUrl) {
  return baseExternalConfig({
    serviceId: "rpc-service",
    serviceName: "external.rpc.lookup",
    upstream: {
      type: "rpc",
      protocol: "json-rpc-2.0",
      url: baseUrl,
      endpoints: {
        primary: {
          path: "/gateway/invoke"
        },
        v2: {
          path: "/gateway/v2/invoke",
          protocol: "json-rpc-2.0"
        }
      }
    },
    tools: [
      {
        operationId: "lookup",
        label: "RPC Lookup",
        description: "Call a canonical JSON-RPC operation through Pact.",
        rpc: {
          endpointRef: "primary",
          method: "lookup",
          params: "$input",
          resultPath: "result"
        },
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "number" }
          },
          required: ["value"]
        },
        readOnly: true,
        risk: "read_only"
      },
      {
        operationId: "lookupV2",
        label: "RPC Lookup v2",
        description: "Call a versioned JSON-RPC operation through Pact.",
        rpc: {
          endpointRef: "v2",
          method: "lookupV2",
          params: "$input",
          resultPath: "result"
        },
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "number" }
          },
          required: ["value"]
        },
        readOnly: true,
        risk: "read_only"
      }
    ]
  });
}

function rpcConfigMissingPath(baseUrl) {
  const config = rpcConfig(baseUrl);
  return {
    ...config,
    serviceId: "rpc-service-missing-path",
    upstream: {
      type: "rpc",
      protocol: "json-rpc-2.0",
      url: baseUrl
    },
    tools: [
      {
        operationId: "lookup",
        rpc: {
          method: "lookup",
          params: "$input",
          resultPath: "result"
        },
        inputSchema: {
          type: "object"
        }
      }
    ]
  };
}

async function saveAndAssert(userDataPath, config) {
  const saved = await saveExternalServiceConfig({
    userDataPath,
    payload: { config }
  });
  assert.equal(saved.ok, true, saved.error || JSON.stringify(saved.validation));
  const expectedToolCount = Array.isArray(config.tools) && config.tools.length ? config.tools.length : 1;
  assert.equal(saved.externalToolDiscovery?.toolCount, expectedToolCount);
  return saved;
}

async function main() {
  const probe = await probeExternalServiceRuntime({ kind: "http" });
  assert.equal(probe.ok, true, probe.error || "No usable external HTTP verification runtime.");

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-http-"));
  const hostPort = await findFreePort();
  let platform = null;
  let upstream = null;
  let upstreamCalls = [];

  try {
    upstream = probe.selectedMode === "container"
      ? await startContainerUpstream({
          hostPort,
          containerCommand: probe.container.command,
          containerEngine: probe.container.engine
        })
      : await startLocalUpstream({ hostPort });
    const baseUrl = upstream.baseUrl;
    await waitForHttpUpstream(baseUrl);

    const missingRpcPath = await saveExternalServiceConfig({
      userDataPath,
      payload: { config: rpcConfigMissingPath(baseUrl) }
    });
    assert.equal(missingRpcPath.ok, false, "RPC upstream without explicit endpoint path must be rejected");
    assert.match(
      JSON.stringify(missingRpcPath.validation?.errors || []),
      /explicit RPC endpoint path/,
      "explicit RPC endpoint path validation error must be reported"
    );

    const configs = [
      openApiConfig(baseUrl),
      restConfig(baseUrl),
      jsonRpcConfig(baseUrl),
      rpcConfig(baseUrl)
    ];
    for (const config of configs) {
      await saveAndAssert(userDataPath, config);
    }

    const runtimeRefresh = await refreshExternalServiceRuntime({ userDataPath });
    assert.equal(runtimeRefresh.ok, true, JSON.stringify(runtimeRefresh.results));
    assert.equal(runtimeRefresh.refreshedCount, 4);

    platform = createToolManagementPlatform({
      userDataPath,
      operations: [],
      controllers: {},
      securityPermissions: createSecurityPermissionsProvider({
        authorizationEngine: createAuthorizationEngine()
      }),
      logger: quietLogger()
    });
    const refresh = platform.refreshExternalServiceTools();
    assert.equal(refresh.ok, true);

    const catalog = platform.catalog();
    const openApiTool = catalog.tools.find((tool) => tool.id === "pact.externalHttp.openapi_service.getItem");
    const restTool = catalog.tools.find((tool) => tool.id === "pact.externalHttp.rest_service.search");
    const jsonRpcTool = catalog.tools.find((tool) => tool.id === "pact.externalHttp.json_rpc_service.classify");
    const rpcTool = catalog.tools.find((tool) => tool.id === "pact.externalRpc.rpc_service.lookup");
    const rpcV2Tool = catalog.tools.find((tool) => tool.id === "pact.externalRpc.rpc_service.lookupV2");
    assert.ok(openApiTool, "OpenAPI operation must compile into a Pact external HTTP tool");
    assert.ok(restTool, "Explicit REST mapping must compile into a Pact external HTTP tool");
    assert.ok(jsonRpcTool, "JSON endpoint mapping must compile into a Pact external HTTP tool");
    assert.ok(rpcTool, "RPC mapping must compile into a Pact external RPC tool");
    assert.ok(rpcV2Tool, "Versioned RPC mapping must compile into a Pact external RPC tool");

    const grantResult = await platform.store.createGrant({
      label: "verify external HTTP adapters",
      scopes: ["knowledge:read"],
      toolsets: ["pact.knowledge.read"],
      toolAllow: [openApiTool.id, restTool.id, jsonRpcTool.id, rpcTool.id, rpcV2Tool.id],
      reason: "External HTTP adapter verification."
    });
    const request = {
      headers: {
        authorization: `Bearer ${grantResult.token}`
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    };

    const openApiResult = await platform.runtime.executeTool({
      toolId: openApiTool.id,
      input: { id: "42", includeMeta: true },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-http"
      }
    });
    assert.equal(openApiResult.ok, true, JSON.stringify(openApiResult.payload?.error || openApiResult.payload));
    assert.equal(openApiResult.payload.result.protocolVersion, "pact.external-http-compile.v1");
    assert.deepEqual(openApiResult.payload.result.result, {
      source: "openapi",
      id: "42",
      includeMeta: true,
      name: "item-42"
    });

    const restResult = await platform.runtime.executeTool({
      toolId: restTool.id,
      input: { query: "pact" },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-http"
      }
    });
    assert.equal(restResult.ok, true, JSON.stringify(restResult.payload?.error || restResult.payload));
    assert.deepEqual(restResult.payload.result.result, {
      source: "rest",
      query: "pact",
      results: ["PACT"]
    });

    const jsonRpcResult = await platform.runtime.executeTool({
      toolId: jsonRpcTool.id,
      input: { text: "hello pact platform" },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-http"
      }
    });
    assert.equal(jsonRpcResult.ok, true, JSON.stringify(jsonRpcResult.payload?.error || jsonRpcResult.payload));
    assert.deepEqual(jsonRpcResult.payload.result.result, {
      source: "json-rpc",
      label: "long",
      text: "hello pact platform"
    });

    const rpcResult = await platform.runtime.executeTool({
      toolId: rpcTool.id,
      input: { value: 21 },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-http"
      }
    });
    assert.equal(rpcResult.ok, true, JSON.stringify(rpcResult.payload?.error || rpcResult.payload));
    assert.equal(rpcResult.payload.result.protocolVersion, "pact.external-rpc-compile.v1");
    assert.deepEqual(rpcResult.payload.result.result, {
      source: "rpc",
      value: 21,
      doubled: 42
    });

    const rpcV2Result = await platform.runtime.executeTool({
      toolId: rpcV2Tool.id,
      input: { value: 14 },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-http"
      }
    });
    assert.equal(rpcV2Result.ok, true, JSON.stringify(rpcV2Result.payload?.error || rpcV2Result.payload));
    assert.equal(rpcV2Result.payload.result.protocolVersion, "pact.external-rpc-compile.v1");
    assert.deepEqual(rpcV2Result.payload.result.result, {
      source: "rpc",
      version: "v2",
      value: 14,
      tripled: 42
    });

    const auditItems = platform.store.listAudit({ limit: 20 });
    for (const tool of [openApiTool, restTool, jsonRpcTool, rpcTool, rpcV2Tool]) {
      assert.equal(
        auditItems.some((item) => item.toolId === tool.id && item.status === "ok"),
        true,
        `${tool.id} execution must be audited`
      );
    }

    upstreamCalls = await readUpstreamCalls(baseUrl);
    assert.deepEqual(upstreamCalls.map((call) => `${call.method} ${call.path}${call.search || ""}`), [
      "GET /openapi/items/42?includeMeta=true",
      "POST /rest/search",
      "POST /rpc",
      "POST /gateway/invoke",
      "POST /gateway/v2/invoke"
    ]);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      runtimeMode: upstream.mode,
      containerEngine: upstream.containerEngine,
      requestedMode: probe.requestedMode,
      userDataPath,
      baseUrl,
      image: upstream.image,
      containerName: upstream.containerName,
      tools: [openApiTool.id, restTool.id, jsonRpcTool.id, rpcTool.id, rpcV2Tool.id],
      upstreamCalls
    }, null, 2)}\n`);
  } finally {
    if (platform) {
      platform.close();
    }
    if (upstream) {
      await upstream.close();
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
