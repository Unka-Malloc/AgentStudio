#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  externalServiceRegistryPath,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig
} from "../../server/platform/common/composition-management/external-service-registry.mjs";
import {
  discoverExternalMcpTools
} from "../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
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
const IMAGE_TAG = "pact-external-mcp-fake-fastmcp:verify";

function quietLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

async function waitForExternalMcp(config, timeoutMs = 60_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const discovery = await discoverExternalMcpTools(config, { timeoutMs: 10_000 });
      if (discovery.ok && discovery.tools.some((tool) => tool.name === "echo")) {
        return discovery;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw lastError || new Error("External MCP service did not become ready.");
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

function venvPythonPath(venvPath) {
  return process.platform === "win32"
    ? path.join(venvPath, "Scripts", "python.exe")
    : path.join(venvPath, "bin", "python");
}

async function startContainerUpstream({ hostPort, containerCommand, containerEngine }) {
  const serviceContainerName = containerName("pact-external-mcp");
  await run(containerCommand, ["build", "-t", IMAGE_TAG, "."], { cwd: SCRIPT_DIR, timeoutMs: 180_000 });
  await run(containerCommand, [
    "run",
    "-d",
    "--rm",
    "--name",
    serviceContainerName,
    "-p",
    `127.0.0.1:${hostPort}:8787`,
    IMAGE_TAG
  ], { timeoutMs: 30_000 });
  return {
    mode: "container",
    containerEngine,
    image: IMAGE_TAG,
    containerName: serviceContainerName,
    mcpUrl: `http://127.0.0.1:${hostPort}/mcp/`,
    async close() {
      await run(containerCommand, ["rm", "-f", serviceContainerName]).catch(() => null);
    }
  };
}

async function startLocalUpstream({ hostPort, pythonCommand }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-mcp-local-"));
  const venvPath = path.join(tempRoot, "venv");
  const pythonPath = venvPythonPath(venvPath);
  let child = null;
  try {
    await run(pythonCommand, ["-m", "venv", venvPath], { cwd: SCRIPT_DIR, timeoutMs: 120_000 });
    await run(pythonPath, ["-m", "pip", "install", "-r", path.join(SCRIPT_DIR, "requirements.txt")], {
      cwd: SCRIPT_DIR,
      timeoutMs: 240_000
    });
    child = spawn(pythonPath, ["server.py"], {
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
      mcpUrl: `http://127.0.0.1:${hostPort}/mcp/`,
      tempRoot,
      logs,
      async close() {
        await stopChildProcess(child);
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
      }
    };
  } catch (error) {
    if (child) {
      await stopChildProcess(child);
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

async function main() {
  const probe = await probeExternalServiceRuntime({ kind: "mcp" });
  assert.equal(probe.ok, true, probe.error || "No usable external MCP verification runtime.");

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-mcp-"));
  const hostPort = await findFreePort();
  let platform = null;
  let upstream = null;

  try {
    upstream = probe.selectedMode === "container"
      ? await startContainerUpstream({
          hostPort,
          containerCommand: probe.container.command,
          containerEngine: probe.container.engine
        })
      : await startLocalUpstream({
          hostPort,
          pythonCommand: probe.local.executable || "python3"
        });

    const config = {
      schemaVersion: 2,
      kind: "pact.external-service.config",
      serviceId: "fake-upstream",
      serviceName: "external.fake.upstream",
      displayName: "Fake Upstream MCP",
      mode: "connected",
      startupPolicy: "external-only",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: upstream.mcpUrl
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read"],
        risk: "read_only"
      }
    };

    const liveDiscovery = await waitForExternalMcp(config);
    assert.equal(liveDiscovery.tools.some((tool) => tool.name === "echo"), true);

    const missingPort = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          ...config,
          serviceId: "fake-upstream-missing-port",
          upstream: {
            ...config.upstream,
            url: "http://127.0.0.1/mcp/"
          }
        }
      }
    });
    assert.equal(missingPort.ok, false, "external MCP URL without explicit port must be rejected");
    assert.match(
      JSON.stringify(missingPort.validation?.errors || []),
      /explicit port/,
      "explicit port validation error must be reported"
    );

    const deadPort = await findFreePort();
    const badEndpoint = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          ...config,
          serviceId: "fake-upstream-bad-endpoint",
          upstream: {
            ...config.upstream,
            url: `http://127.0.0.1:${deadPort}/mcp/`,
            timeoutMs: 500
          }
        }
      }
    });
    assert.equal(badEndpoint.ok, false, "unreachable external MCP endpoint must be rejected");
    await assert.rejects(
      () => fs.access(externalServiceRegistryPath(userDataPath)),
      /ENOENT/,
      "failed discovery must not write the external service registry"
    );

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: { config }
    });
    assert.equal(saved.ok, true, saved.error || "external service config should save");
    assert.equal(saved.externalMcpDiscovery.ok, true);
    assert.equal(saved.externalMcpDiscovery.tools.includes("echo"), true);

    const runtimeRefresh = await refreshExternalServiceRuntime({ userDataPath });
    assert.equal(runtimeRefresh.ok, true, JSON.stringify(runtimeRefresh.results));
    assert.equal(runtimeRefresh.refreshedCount, 1);
    assert.equal(runtimeRefresh.state.services[0].externalMcp.toolCount >= 2, true);

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
    assert.equal(refresh.externalMcpOperationCount >= 2, true);

    const catalog = platform.catalog();
    const echoTool = catalog.tools.find((tool) => tool.id === "pact.externalMcp.fake_upstream.echo");
    const addTool = catalog.tools.find((tool) => tool.id === "pact.externalMcp.fake_upstream.add");
    assert.ok(echoTool, "echo tool must be compiled into Tool Management catalog");
    assert.ok(addTool, "add tool must be compiled into Tool Management catalog");
    assert.deepEqual(echoTool.requiredScopes, ["knowledge:read"]);

    const grantResult = await platform.store.createGrant({
      label: "verify external MCP passthrough",
      scopes: ["knowledge:read"],
      toolsets: ["pact.knowledge.read"],
      toolAllow: [echoTool.id, addTool.id],
      reason: "External MCP passthrough verification."
    });
    const request = {
      headers: {
        authorization: `Bearer ${grantResult.token}`
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    };

    const echo = await platform.runtime.executeTool({
      toolId: echoTool.id,
      input: { message: "hello pact external mcp" },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-mcp"
      }
    });
    assert.equal(echo.ok, true, JSON.stringify(echo.payload?.error || echo.payload));
    const echoText = JSON.stringify(echo.payload);
    assert.match(echoText, /hello pact external mcp/);
    assert.match(echoText, /pact-fake-upstream-mcp/);

    const add = await platform.runtime.executeTool({
      toolId: addTool.id,
      input: { a: 20, b: 22 },
      request,
      context: {
        transport: "verify",
        profileId: "verify-external-mcp"
      }
    });
    assert.equal(add.ok, true, JSON.stringify(add.payload?.error || add.payload));
    assert.match(JSON.stringify(add.payload), /42/);

    const auditItems = platform.store.listAudit({ limit: 20 });
    assert.equal(
      auditItems.some((item) => item.toolId === echoTool.id && item.status === "ok"),
      true,
      "external MCP echo execution must be audited"
    );

    process.stdout.write(`${JSON.stringify({
      ok: true,
      runtimeMode: upstream.mode,
      containerEngine: upstream.containerEngine,
      requestedMode: probe.requestedMode,
      userDataPath,
      hostPort,
      image: upstream.image,
      containerName: upstream.containerName,
      serviceId: config.serviceId,
      tools: [echoTool.id, addTool.id],
      echoTraceId: echo.payload.traceId,
      addTraceId: add.payload.traceId
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

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
